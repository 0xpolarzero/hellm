import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const SOURCE_ROOT = import.meta.dir;

describe("Snippets pane source contract", () => {
  it("uses shared pane primitives while keeping snippets as prompt macros", async () => {
    const source = await readFile(join(SOURCE_ROOT, "SnippetsPane.svelte"), "utf8");

    expect(source).toContain("<ExtensionListRow");
    expect(source).toContain("expandedContent");
    expect(source).toContain("<PaneFilterTabs");
    expect(source).toContain("<SourceMetadataTextArea");
    expect(source).toContain("<Checkbox");
    expect(source).toContain('aria-label="Snippet source filters"');
    expect(source).toContain("sourceFilterOptions");
    expect(source).toContain("sourceFilterCount");
    expect(source).toContain("visibleSnippets");
    expect(source).toContain("snippetArgumentInsight");
    expect(source).toContain("inferSnippetArgumentCount");
    expect(source).toContain("setSnippetEnabled");
    expect(source).toContain("subdued={!snippet.enabled}");
    expect(source).toContain("checked={snippet.enabled}");
    expect(source).toContain('"args"');
    expect(source).not.toContain("variable args");
    expect(source).not.toContain('"0 args"');
    expect(source).not.toContain("snippets-source-tabs .ui-pane-filter-tab.active");
    expect(source).toContain("discardDraftChanges");
    expect(source).toContain("detachedDraftSnippet");
    expect(source).toContain("syncSelectionToVisibleSnippets");
    expect(source).toContain("Save or discard your current changes before switching snippets.");
    expect(source).toContain('label: "Managed"');
    expect(source).toContain('label: "Claude"');
    expect(source).toContain('label: "pi"');
    expect(source).toContain("<MetadataChip");
    expect(source).toContain("snippet-source-chip");
    expect(source).not.toContain("snippet-reference-chip");
    expect(source).not.toContain("snippet-state-chip");
    expect(source).not.toContain("width: 4.75rem");
    expect(source).not.toContain("width: 100%");
    expect(source).not.toContain("snippetMentionToken");
    expect(source).not.toContain("snippet.scope");
    expect(source).not.toContain('label="args"');
    expect(source).not.toContain('label="token"');
    expect(source).not.toContain('label="scope"');
    expect(source).not.toContain("<PaneHeader");
    expect(source).not.toContain("<PaneListRow");
    expect(source).not.toContain("<Badge");
    expect(source).not.toContain("snippet-detail");
    expect(source).not.toContain("readonly-meta");
    expect(source).not.toContain('<section class="preview">');
    expect(source).not.toContain("group-header");
    expect(source).not.toContain("No managed snippets match.");
    expect(source).not.toContain("No discovered snippets match.");
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
