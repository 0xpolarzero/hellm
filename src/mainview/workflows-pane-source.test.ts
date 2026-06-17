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

    expect(source).toContain("<PaneHeader");
    expect(source).toContain("<PaneFilterTabs");
    expect(source).toContain("<PaneListRow");
    expect(source).toContain("Generated Code (read-only)");
    expect(source).toContain('targetLabel="read-only generated code"');
    expect(source).toContain("Customize Agent");
    expect(source).not.toContain("svvyx workflows run");
  });
});
