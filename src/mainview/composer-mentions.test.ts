import { describe, expect, it } from "bun:test";
import {
  getActiveMentionQuery,
  parseTranscriptMentionLinks,
  removeMentionFromDraft,
  searchMentionPaths,
  selectMentionPath,
  serializeComposerDraft,
  type WorkspacePathIndexEntry,
} from "./composer-mentions";

const INDEX: WorkspacePathIndexEntry[] = [
  { kind: "file", workspaceRelativePath: "docs/progress.md" },
  { kind: "file", workspaceRelativePath: "src/mainview/ChatComposer.svelte" },
  { kind: "file", workspaceRelativePath: "src/mainview/prompt-history.ts" },
  { kind: "file", workspaceRelativePath: "src/bun/prompt-history.ts" },
  { kind: "folder", workspaceRelativePath: "src/bun/" },
  { kind: "folder", workspaceRelativePath: "docs/specs/" },
];

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
});

describe("composer mention serialization", () => {
  it("selects a mention as normal @path text and removable chip metadata", () => {
    const draft = "Please inspect @prog.";
    const query = getActiveMentionQuery(draft, "Please inspect @prog".length);
    expect(query).not.toBeNull();

    const selection = selectMentionPath(draft, query!, INDEX[0]!);

    expect(selection.draft).toBe("Please inspect @docs/progress.md.");
    expect(selection.mention).toEqual({
      id: "file:docs/progress.md",
      kind: "file",
      label: "progress.md",
      workspaceRelativePath: "docs/progress.md",
    });
    expect(serializeComposerDraft(selection.draft)).toBe("Please inspect @docs/progress.md.");
  });

  it("removes a chip without disrupting normal multiline editing", () => {
    const next = removeMentionFromDraft("Read @docs/progress.md\nThen update notes", {
      id: "file:docs/progress.md",
      kind: "file",
      label: "progress.md",
      workspaceRelativePath: "docs/progress.md",
    });

    expect(next).toBe("Read\nThen update notes");
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
    const text = serializeComposerDraft("Please inspect @docs/progress.md");

    expect(text).toBe("Please inspect @docs/progress.md");
    expect(JSON.stringify({ role: "user", content: text })).not.toContain("contextTargets");
    expect(JSON.stringify({ role: "user", content: text })).not.toContain("fileContents");
    expect(JSON.stringify({ role: "user", content: text })).not.toContain("folderExpansion");
  });
});
