import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { buildSnippetsReadModel, discoverSnippets } from "./snippet-library";
import {
  expandSnippetBody,
  parseSnippetMarkdown,
  type DiscoveredSnippet,
  type ManagedSnippet,
} from "../shared/snippets";

describe("snippet discovery", () => {
  it("discovers Claude snippets recursively and pi snippets non-recursively", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-snippets-"));
    try {
      const home = join(root, "home");
      const workspace = join(root, "workspace");
      writeMarkdown(join(home, ".claude", "commands", "review.md"), "Review $1");
      writeMarkdown(join(home, ".claude", "commands", "nested", "fix.md"), "Fix $@");
      writeMarkdown(join(workspace, ".claude", "commands", "work.md"), "Workspace command");
      writeMarkdown(join(home, ".pi", "agent", "prompts", "pi-user.md"), "Pi user");
      writeMarkdown(join(home, ".pi", "agent", "prompts", "nested", "ignored.md"), "Nested pi");
      writeMarkdown(join(workspace, ".pi", "prompts", "pi-work.md"), "Pi workspace");
      writeMarkdown(
        join(workspace, ".pi", "prompts", "nested", "ignored.md"),
        "Nested pi workspace",
      );
      writeMarkdown(join(home, ".codex", "skills", "sample", "SKILL.md"), "Codex skill");
      writeMarkdown(
        join(home, ".codex", "plugins", "sample", "commands", "ignored.md"),
        "Codex plugin",
      );
      writeMarkdown(join(home, ".codex", "commands", "ignored.md"), "Codex command");
      writeMarkdown(join(home, ".mcp", "prompts", "ignored.md"), "MCP prompt");
      writeMarkdown(join(workspace, ".mcp", "prompts", "ignored.md"), "Workspace MCP prompt");
      writeMarkdown(join(home, ".claude", "hooks", "ignored.md"), "Claude hook");
      writeMarkdown(join(home, ".claude", "plugins", "ignored.md"), "Claude plugin");

      const snippets = discoverSnippets({ homeDir: home, workspaceDir: workspace });

      expect(
        snippets.map((snippet) => `${snippet.source}:${snippet.scope}:${snippet.title}`),
      ).toEqual([
        "claude:user:nested/fix",
        "claude:user:review",
        "claude:workspace:work",
        "pi:user:pi-user",
        "pi:workspace:pi-work",
      ]);
      expect(snippets.every((snippet) => snippet.readOnly)).toBe(true);
      expect(snippets.some((snippet) => snippet.path.endsWith("SKILL.md"))).toBe(false);
      expect(
        snippets.some((snippet) => snippet.path.includes(`${sep}.codex${sep}plugins${sep}`)),
      ).toBe(false);
      expect(
        snippets.some(
          (snippet) =>
            snippet.path.includes(`${sep}.codex${sep}`) ||
            snippet.path.includes(`${sep}.mcp${sep}`) ||
            snippet.path.includes(`${sep}.claude${sep}hooks${sep}`) ||
            snippet.path.includes(`${sep}.claude${sep}plugins${sep}`),
        ),
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads supported metadata and ignores behavior-changing frontmatter", () => {
    const parsed = parseSnippetMarkdown(`---
description: "Useful review prompt"
argument-hint: files and scope
allowed-tools: Bash(*)
model: opus
disable-model-invocation: true
tools: [mcp__filesystem__read_file]
permissions: full-access
mcp: filesystem
plugin: shell-commands
command: /dangerous
execution-policy: full-access
provider: anthropic
reasoning: high
---
Review $ARGUMENTS`);

    expect(parsed.metadata).toEqual({
      description: "Useful review prompt",
      argumentHint: "files and scope",
    });
    expect(parsed.body).toBe("Review $ARGUMENTS");
    expect(parsed.metadata).not.toHaveProperty("allowed-tools");
    expect(parsed.metadata).not.toHaveProperty("model");
    expect(parsed.metadata).not.toHaveProperty("tools");
    expect(parsed.metadata).not.toHaveProperty("permissions");
    expect(parsed.metadata).not.toHaveProperty("mcp");
    expect(parsed.metadata).not.toHaveProperty("plugin");
    expect(parsed.metadata).not.toHaveProperty("command");
    expect(parsed.metadata).not.toHaveProperty("execution-policy");
    expect(parsed.metadata).not.toHaveProperty("provider");
    expect(parsed.metadata).not.toHaveProperty("reasoning");
  });

  it("merges managed and discovered snippets without making external files editable", () => {
    const discovered: DiscoveredSnippet[] = [
      {
        id: "claude:user:/tmp/review.md",
        source: "claude",
        scope: "user",
        title: "review",
        path: "/tmp/review.md",
        body: "Review $1",
        metadata: { description: "Review", argumentHint: "file" },
        readOnly: true,
      },
    ];
    const managed: ManagedSnippet[] = [
      {
        id: "managed-1",
        source: "svvy",
        title: "Plan",
        body: "Plan $ARGUMENTS",
        metadata: { description: null, argumentHint: "scope" },
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        readOnly: false,
      },
    ];

    const readModel = buildSnippetsReadModel({ managed, discovered });

    expect(readModel.managed).toEqual(managed);
    expect(readModel.discovered).toEqual(discovered);
    expect(readModel.snippets.map((snippet) => `${snippet.source}:${snippet.title}`)).toEqual([
      "svvy:Plan",
      "claude:review",
    ]);
    expect(readModel.discovered.every((snippet) => snippet.readOnly)).toBe(true);
  });
});

describe("snippet expansion", () => {
  it("substitutes supported placeholders without host command execution", () => {
    const expanded = expandSnippetBody(
      "One=$1 Missing=$3 Args=$ARGUMENTS All=$@ Tail=${@:2} Pair=${@:1:2}\n!echo do-not-run",
      ["alpha", "beta"],
    );

    expect(expanded).toBe(
      "One=alpha Missing= Args=alpha beta All=alpha beta Tail=beta Pair=alpha beta\n!echo do-not-run",
    );
  });
});

function writeMarkdown(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}
