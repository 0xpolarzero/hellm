import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

describe("context budget UI surfaces", () => {
  it("renders focused, unfocused, handler, workflow task, and assistant-message context meters", async () => {
    const chatWorkspaceSource = await readFile(
      new URL("./ChatWorkspace.svelte", import.meta.url),
      "utf8",
    );
    const composerSource = await readFile(
      new URL("./ChatComposer.svelte", import.meta.url),
      "utf8",
    );
    const sessionListItemSource = await readFile(
      new URL("./SessionListItem.svelte", import.meta.url),
      "utf8",
    );
    const sessionSidebarSource = await readFile(
      new URL("./SessionSidebar.svelte", import.meta.url),
      "utf8",
    );
    const relatedInspectorSource = await readFile(
      new URL("./RelatedInspectorPane.svelte", import.meta.url),
      "utf8",
    );
    const transcriptSource = await readFile(
      new URL("./ChatTranscript.svelte", import.meta.url),
      "utf8",
    );

    expect(chatWorkspaceSource).toContain("buildSurfaceContextBudget(");
    expect(chatWorkspaceSource).toContain("getPaneContextBudget(paneController)");
    expect(composerSource).toContain('class="focused-context-budget"');
    expect(composerSource).toContain('variant="full"');
    expect(composerSource).toContain("tooltipDetails={contextBudgetTooltipDetails}");
    expect(sessionListItemSource).toContain('class="session-context-budget"');
    expect(sessionListItemSource).toContain('variant="compact"');
    expect(sessionSidebarSource).toContain('class="sidebar-child-context"');
    expect(sessionSidebarSource).toContain("threadPrimaryPane.contextBudget");
    expect(relatedInspectorSource).toContain("content.contextBudget");
    expect(relatedInspectorSource).toContain(
      '<ContextBudgetBar budget={content.contextBudget} label="Context" />',
    );
    expect(transcriptSource).toContain("assistantMessageContextBudget(message)");
    expect(transcriptSource).toContain('variant="inline"');
    expect(transcriptSource).toContain('label="Message context"');
  });
});
