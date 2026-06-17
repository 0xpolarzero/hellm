import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const SOURCE_ROOT = import.meta.dir;

describe("Workflows pane source contract", () => {
  it("loads generated workflow data on mount instead of a reactive reload loop", async () => {
    const source = await readFile(join(SOURCE_ROOT, "WorkflowsPane.svelte"), "utf8");

    expect(source).toContain("onMount(() => {");
    expect(source).toContain("runtime.workflowsGeneratedSnapshot");
    expect(source).toContain("runtime.subscribe(syncRuntimeSnapshots)");
    expect(source).toContain("void loadWorkflows();");
    expect(source).not.toContain("runtime.subscribeAppLogUpdate");
    expect(source).not.toContain("$effect(() => {\n    void loadWorkflows();");
  });

  it("keeps generated output read-only and routes generated agents back to Agents", async () => {
    const source = await readFile(join(SOURCE_ROOT, "WorkflowsPane.svelte"), "utf8");

    expect(source).toContain("<PaneFilterTabs");
    expect(source).toContain("<Input");
    expect(source).toContain("<ExtensionListRow");
    expect(source).toContain("<SourceMetadataTextArea");
    expect(source).toContain("readonly");
    expect(source).toContain("sourceLabel={fileName(item.sourcePath)}");
    expect(source).toContain("sourceLabel={fileName(item.generatedPath)}");
    expect(source).toContain("workflow-expanded-meta");
    expect(source).toContain("updatedLabel(readModel.updatedAt)");
    expect(source).toContain("workflow-agent-parameters-preview");
    expect(source).toContain("workflow-generated-code-preview");
    expect(source).toContain("onOpenAgentProfile");
    expect(source).toContain("Refresh generated workflows");
    expect(source).toContain("scrollbar-gutter: stable");
    expect(source).not.toContain("{#snippet meta()}");
    expect(source).not.toContain("Opened ${path}");
    expect(source).not.toContain("workflow-export-meta");
    expect(source).not.toContain("workflow-source-target");
    expect(source).not.toContain("<PaneHeader");
    expect(source).not.toContain("<PaneListRow");
    expect(source).not.toContain("workflows-detail");
    expect(source).not.toContain("detail-grid");
    expect(source).not.toContain("svvyx workflows run");
  });
});
