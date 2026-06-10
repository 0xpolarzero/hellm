import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const SOURCE_ROOT = import.meta.dir;

describe("Workflows pane source contract", () => {
  it("loads generated workflow data on mount instead of a reactive reload loop", async () => {
    const source = await readFile(join(SOURCE_ROOT, "WorkflowsPane.svelte"), "utf8");

    expect(source).toContain("onMount(() => {");
    expect(source).toContain("void loadWorkflows();");
    expect(source).toContain("return runtime.subscribeAppLogUpdate");
    expect(source).not.toContain("$effect(() => {\n    void loadWorkflows();");
  });
});
