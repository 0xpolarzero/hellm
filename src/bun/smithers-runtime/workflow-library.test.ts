import { afterEach, describe, expect, it } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  deleteSavedWorkflowLibraryPath,
  readSavedWorkflowLibraryReadModel,
} from "./workflow-library";

const runtimeRequire = createRequire(import.meta.url);
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "svvy-workflow-library-"));
  tempDirs.push(root);
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(
    dirname(runtimeRequire.resolve("zod/package.json")),
    join(root, "node_modules", "zod"),
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: true,
        noEmit: true,
      },
    }),
  );
  return root;
}

function writeValidSavedWorkflow(root: string): void {
  const definitionPath = join(root, ".svvy", "workflows", "definitions", "review.ts");
  const promptPath = join(root, ".svvy", "workflows", "prompts", "review.mdx");
  const componentPath = join(root, ".svvy", "workflows", "components", "helpers.ts");
  const entryPath = join(root, ".svvy", "workflows", "entries", "review.ts");
  for (const path of [definitionPath, promptPath, componentPath, entryPath]) {
    mkdirSync(dirname(path), { recursive: true });
  }
  writeFileSync(
    definitionPath,
    [
      "/**",
      " * @svvyAssetKind definition",
      " * @svvyId review_definition",
      " * @svvyTitle Review Definition",
      " * @svvySummary Builds the review workflow.",
      " */",
      "export const definition = true;",
      "",
    ].join("\n"),
  );
  writeFileSync(
    promptPath,
    [
      "---",
      "svvyAssetKind: prompt",
      "svvyId: review_prompt",
      "title: Review Prompt",
      "summary: Guides review work.",
      "---",
      "Review the change.",
      "",
    ].join("\n"),
  );
  writeFileSync(
    componentPath,
    [
      "/**",
      " * @svvyAssetKind component",
      " * @svvyId review_helpers",
      " * @svvyTitle Review Helpers",
      " * @svvySummary Shared helper exports.",
      " */",
      "export const helper = true;",
      "",
    ].join("\n"),
  );
  writeFileSync(
    entryPath,
    [
      'import { z } from "zod";',
      'export const workflowId = "review";',
      'export const label = "Review";',
      'export const summary = "Run a reusable review workflow."; ',
      "export const launchSchema = z.object({ target: z.string() });",
      'export const definitionPaths = [".svvy/workflows/definitions/review.ts"];',
      'export const promptPaths = [".svvy/workflows/prompts/review.mdx"];',
      'export const componentPaths = [".svvy/workflows/components/helpers.ts"];',
      "export function createRunnableEntry() {",
      "  return { workflowId, workflowSource: 'saved', launchSchema, workflow: {} as any };",
      "}",
      "",
    ].join("\n"),
  );
}

describe("saved workflow library read model", () => {
  it("lists saved assets, runnable entries, source previews, validation, and artifact groups", async () => {
    const root = createWorkspace();
    writeValidSavedWorkflow(root);
    const artifactRoot = join(root, ".svvy", "artifacts", "workflows", "artifact-1");
    mkdirSync(join(artifactRoot, "entries"), { recursive: true });
    writeFileSync(join(artifactRoot, "metadata.json"), JSON.stringify({ title: "Artifact" }));

    const readModel = await readSavedWorkflowLibraryReadModel(root, {
      preferredExternalEditor: "code",
      customExternalEditorCommand: "",
    });

    expect(readModel.preferredExternalEditor).toBe("code");
    expect(readModel.counts.definition).toBe(1);
    expect(readModel.counts.prompt).toBe(1);
    expect(readModel.counts.component).toBe(1);
    expect(readModel.counts.entry).toBe(1);
    expect(readModel.counts["artifact-workflow"]).toBe(1);
    expect(readModel.diagnostics).toEqual([]);
    expect(readModel.items.find((item) => item.kind === "entry")).toMatchObject({
      workflowId: "review",
      title: "Review",
      validationStatus: "valid",
      groupedAssetRefs: {
        definitions: [".svvy/workflows/definitions/review.ts"],
        prompts: [".svvy/workflows/prompts/review.mdx"],
        components: [".svvy/workflows/components/helpers.ts"],
      },
    });
    expect(readModel.items.find((item) => item.kind === "definition")?.sourcePreview).toContain(
      "@svvyTitle Review Definition",
    );
  });

  it("deletes saved workflow files without deleting historical artifact workflows", async () => {
    const root = createWorkspace();
    writeValidSavedWorkflow(root);
    const artifactMetadata = join(
      root,
      ".svvy",
      "artifacts",
      "workflows",
      "artifact-1",
      "metadata.json",
    );
    mkdirSync(dirname(artifactMetadata), { recursive: true });
    writeFileSync(artifactMetadata, "{}");

    const readModel = await deleteSavedWorkflowLibraryPath(
      root,
      ".svvy/workflows/prompts/review.mdx",
      {
        preferredExternalEditor: "system",
        customExternalEditorCommand: "",
      },
    );

    expect(existsSync(join(root, ".svvy", "workflows", "prompts", "review.mdx"))).toBe(false);
    expect(existsSync(artifactMetadata)).toBe(true);
    expect(readModel.counts["artifact-workflow"]).toBe(1);
  });
});
