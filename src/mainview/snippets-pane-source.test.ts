import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const SOURCE_ROOT = import.meta.dir;

describe("Snippets pane source contract", () => {
  it("uses shared pane primitives while keeping snippets as prompt macros", async () => {
    const source = await readFile(join(SOURCE_ROOT, "SnippetsPane.svelte"), "utf8");

    expect(source).toContain("<PaneHeader");
    expect(source).toContain("<PaneListRow");
    expect(source).toContain("snippetMentionToken");
    expect(source).toContain("inferSnippetArgumentCount");
    expect(source).not.toContain("ExtensionStateButtons");
    expect(source).not.toContain("load_extension");
  });

  it("requires inline confirmation before deleting managed snippets", async () => {
    const source = await readFile(join(SOURCE_ROOT, "SnippetsPane.svelte"), "utf8");

    expect(source).toContain("confirmingDeleteSnippetId");
    expect(source).toContain("use:dismissConfirmation");
    expect(source).toContain("requestDeleteSnippet");
    expect(source).toContain("Confirm");
  });
});
