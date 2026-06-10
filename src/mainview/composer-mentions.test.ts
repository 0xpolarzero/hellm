import { describe, expect, it } from "bun:test";
import {
  caretAfterSnippetMentionToken,
  commitTypedSnippetMention,
  expandComposerSnippetMention,
  getActiveMentionQuery,
  nextSnippetArgumentKeyboardTarget,
  parseTranscriptMentionLinks,
  removeComposerSnippetMentionToken,
  searchComposerMentionResults,
  searchMentionPaths,
  selectMentionPath,
  selectMentionSnippet,
  serializeComposerDraft,
  type WorkspacePathIndexEntry,
} from "./composer-mentions";
import type { ManagedSnippet } from "../shared/snippets";

const INDEX: WorkspacePathIndexEntry[] = [
  { kind: "file", workspaceRelativePath: "docs/progress.md" },
  { kind: "file", workspaceRelativePath: "src/mainview/ChatComposer.svelte" },
  { kind: "file", workspaceRelativePath: "src/mainview/prompt-history.ts" },
  { kind: "file", workspaceRelativePath: "src/bun/prompt-history.ts" },
  { kind: "folder", workspaceRelativePath: "src/bun/" },
  { kind: "folder", workspaceRelativePath: "docs/specs/" },
];

const SNIPPET: ManagedSnippet = {
  id: "snippet-review",
  source: "svvy",
  title: "Review Plan",
  body: "Review $1 and produce a plan for $ARGUMENTS.",
  metadata: {
    description: "Ask for a review plan",
    argumentHint: "target",
  },
  createdAt: "2026-06-10T10:00:00.000Z",
  updatedAt: "2026-06-10T10:00:00.000Z",
  readOnly: false,
};

describe("composer mention query detection", () => {
  it("detects an active token-boundary @query at the caret", () => {
    const draft = "Compare @src/main";
    expect(getActiveMentionQuery(draft, draft.length)).toEqual({
      start: 8,
      end: draft.length,
      query: "src/main",
    });
  });

  it("does not activate inside email-like text or after the caret leaves the query", () => {
    expect(getActiveMentionQuery("me@example.com", "me@example".length)).toBeNull();
    expect(
      getActiveMentionQuery(
        "Open @docs/progress.md please",
        "Open @docs/progress.md please".length,
      ),
    ).toBeNull();
  });
});

describe("composer mention picker search", () => {
  it("ranks basename matches deterministically and includes folders", () => {
    const results = searchMentionPaths(INDEX, "prompt", 5);

    expect(results.map((result) => result.workspaceRelativePath)).toEqual([
      "src/bun/prompt-history.ts",
      "src/mainview/prompt-history.ts",
    ]);
  });

  it("adds parent path disambiguation for duplicate basenames", () => {
    const results = searchMentionPaths(INDEX, "prompt-history");

    expect(results).toMatchObject([
      { basename: "prompt-history.ts", disambiguation: "src/bun" },
      { basename: "prompt-history.ts", disambiguation: "src/mainview" },
    ]);
  });

  it("searches files, folders, and snippets in one result list", () => {
    const results = searchComposerMentionResults({
      paths: INDEX,
      snippets: [SNIPPET],
      query: "review",
      limit: 5,
    });

    expect(results).toMatchObject([
      {
        type: "snippet",
        basename: "Review Plan",
        disambiguation: "Ask for a review plan",
      },
    ]);
  });
});

describe("composer mention serialization", () => {
  it("selects a mention as normal inline @path text", () => {
    const draft = "Please inspect @prog.";
    const query = getActiveMentionQuery(draft, "Please inspect @prog".length);
    expect(query).not.toBeNull();

    const selection = selectMentionPath(draft, query!, INDEX[0]!);

    expect(selection.draft).toBe("Please inspect @docs/progress.md.");
    expect(serializeComposerDraft(selection.draft).text).toBe("Please inspect @docs/progress.md.");
  });

  it("does not append chip-only attachments into the draft text", () => {
    expect(serializeComposerDraft("Please inspect @docs/progress.md").text).toBe(
      "Please inspect @docs/progress.md",
    );
  });

  it("selects snippets as structured mention tokens and expands clean text before send", () => {
    const draft = "Please @review.";
    const query = getActiveMentionQuery(draft, "Please @review".length);
    expect(query).not.toBeNull();

    const selection = selectMentionSnippet(draft, query!, SNIPPET);
    const mention = {
      ...selection.mention,
      arguments: ["docs/prd.md"],
    };
    const serialized = serializeComposerDraft(selection.draft, [mention]);

    expect(selection.draft).toBe("Please @Review Plan.");
    expect(serialized.text).toBe("Please Review docs/prd.md and produce a plan for docs/prd.md..");
    expect(serialized.snippetProvenance).toMatchObject([
      {
        snippetId: "snippet-review",
        source: "svvy",
        title: "Review Plan",
        arguments: ["docs/prd.md"],
        resolvedText: "Review docs/prd.md and produce a plan for docs/prd.md.",
      },
    ]);
  });

  it("creates unique snippet mention tokens for duplicate uses", () => {
    const draft = "@review and @review";
    const firstQuery = getActiveMentionQuery(draft, "@review".length);
    expect(firstQuery).not.toBeNull();
    const first = selectMentionSnippet(draft, firstQuery!, SNIPPET);
    const secondQuery = getActiveMentionQuery(first.draft, first.draft.length);
    expect(secondQuery).not.toBeNull();
    const second = selectMentionSnippet(first.draft, secondQuery!, SNIPPET, [first.mention]);

    expect(first.mention.token).toBe("@Review Plan");
    expect(second.mention.token).toBe("@Review Plan#2");
  });

  it("expands a structured snippet mention into editable composer text", () => {
    const selection = selectMentionSnippet(
      "@review",
      getActiveMentionQuery("@review", 7)!,
      SNIPPET,
    );
    const mention = {
      ...selection.mention,
      arguments: ["src/mainview/ChatComposer.svelte"],
    };

    expect(expandComposerSnippetMention(selection.draft, mention).draft).toBe(
      "Review src/mainview/ChatComposer.svelte and produce a plan for src/mainview/ChatComposer.svelte.",
    );
  });

  it("removes the structured snippet token when the chip is removed", () => {
    const draft = "Please @review today";
    const selection = selectMentionSnippet(
      draft,
      getActiveMentionQuery(draft, "Please @review".length)!,
      SNIPPET,
    );

    expect(removeComposerSnippetMentionToken(selection.draft, selection.mention).draft).toBe(
      "Please today",
    );
  });

  it("commits a fully typed snippet mention followed by space as a structured mention", () => {
    const committed = commitTypedSnippetMention({
      value: "Please @Review Plan ",
      caret: "Please @Review Plan ".length,
      snippets: [SNIPPET],
    });

    expect(committed).not.toBeNull();
    expect(committed?.draft).toBe("Please @Review Plan ");
    expect(committed?.mention.token).toBe("@Review Plan");
    expect(serializeComposerDraft(committed!.draft, [committed!.mention]).text).toBe(
      "Please Review  and produce a plan for .",
    );
  });

  it("creates unique structured tokens for duplicate typed snippet mentions", () => {
    const first = commitTypedSnippetMention({
      value: "@Review Plan ",
      caret: "@Review Plan ".length,
      snippets: [SNIPPET],
    });
    expect(first).not.toBeNull();
    const second = commitTypedSnippetMention({
      value: "@Review Plan and @Review Plan ",
      caret: "@Review Plan and @Review Plan ".length,
      snippets: [SNIPPET],
      existingMentions: [first!.mention],
    });

    expect(second?.draft).toBe("@Review Plan and @Review Plan#2 ");
    expect(second?.mention.token).toBe("@Review Plan#2");
  });

  it("does not structure non-matching typed mentions or path-like @ text", () => {
    expect(
      commitTypedSnippetMention({
        value: "Please @Review Planish ",
        caret: "Please @Review Planish ".length,
        snippets: [SNIPPET],
      }),
    ).toBeNull();
    expect(
      commitTypedSnippetMention({
        value: "Please @docs/progress.md ",
        caret: "Please @docs/progress.md ".length,
        snippets: [SNIPPET],
      }),
    ).toBeNull();
  });

  it("moves through snippet arguments with Tab, Enter, and final Enter", () => {
    expect(
      nextSnippetArgumentKeyboardTarget({
        key: "Tab",
        argumentIndex: 0,
        argumentCount: 2,
      }),
    ).toEqual({ kind: "argument", argumentIndex: 1 });
    expect(
      nextSnippetArgumentKeyboardTarget({
        key: "Enter",
        argumentIndex: 1,
        argumentCount: 2,
      }),
    ).toEqual({ kind: "composer" });
    expect(
      nextSnippetArgumentKeyboardTarget({
        key: "Tab",
        argumentIndex: 1,
        argumentCount: 2,
        shiftKey: true,
      }),
    ).toBeNull();
    expect(
      nextSnippetArgumentKeyboardTarget({
        key: "Enter",
        argumentIndex: 0,
        argumentCount: 2,
        metaKey: true,
      }),
    ).toBeNull();
  });

  it("returns composer focus after immediate snippet-token whitespace", () => {
    expect(
      caretAfterSnippetMentionToken("Please @Review Plan next", { token: "@Review Plan" }),
    ).toBe("Please @Review Plan ".length);
    expect(caretAfterSnippetMentionToken("Please @Review Plan.", { token: "@Review Plan" })).toBe(
      "Please @Review Plan".length,
    );
  });
});

describe("transcript mention links", () => {
  it("renders sent mentions as workspace link segments", () => {
    expect(parseTranscriptMentionLinks("Compare @src/mainview/ChatComposer.svelte now")).toEqual([
      { type: "text", text: "Compare " },
      {
        type: "mention",
        text: "@src/mainview/ChatComposer.svelte",
        path: "src/mainview/ChatComposer.svelte",
        missing: false,
      },
      { type: "text", text: " now" },
    ]);
  });

  it("marks stale links missing when the cached index no longer contains them", () => {
    const segments = parseTranscriptMentionLinks(
      "Read @deleted/file.ts.",
      new Set(["docs/progress.md"]),
    );

    expect(segments).toEqual([
      { type: "text", text: "Read " },
      { type: "mention", text: "@deleted/file.ts", path: "deleted/file.ts", missing: true },
      { type: "text", text: "." },
    ]);
  });
});

describe("composer mentions stay agent-neutral", () => {
  it("serializes only ordinary user text with no context target payload", () => {
    const text = serializeComposerDraft("Please inspect @docs/progress.md").text;

    expect(text).toBe("Please inspect @docs/progress.md");
    expect(JSON.stringify({ role: "user", content: text })).not.toContain("contextTargets");
    expect(JSON.stringify({ role: "user", content: text })).not.toContain("fileContents");
    expect(JSON.stringify({ role: "user", content: text })).not.toContain("folderExpansion");
  });

  it("keeps chip-only attachments out of composer text serialization", () => {
    const text = serializeComposerDraft("Please inspect @docs/progress.md").text;

    expect(text).toBe("Please inspect @docs/progress.md");
  });
});
