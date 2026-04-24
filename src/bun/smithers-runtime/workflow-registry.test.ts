import { afterEach, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadRunnableWorkflowEntryAtPath } from "./workflow-registry";

const runtimeRequire = createRequire(import.meta.url);
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("loads authored workflow entries from the import sandbox instead of the workspace realpath", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "svvy-workflow-registry-test-"));
  tempDirs.push(workspaceRoot);

  const artifactRoot = join(workspaceRoot, ".svvy", "artifacts", "workflows", "sandbox-proof");
  const entryPath = join(artifactRoot, "entries", "sandbox-proof.ts");
  const definitionPath = join(artifactRoot, "definitions", "sandbox-proof.ts");
  const promptPath = join(artifactRoot, "prompts", "sandbox-proof.mdx");
  const componentPath = join(artifactRoot, "components", "sandbox-proof.ts");
  const fakeWorkspaceReactRoot = join(workspaceRoot, "node_modules", "react");
  const fakeWorkspaceReactPackageJsonPath = join(fakeWorkspaceReactRoot, "package.json");

  await mkdir(join(artifactRoot, "entries"), { recursive: true });
  await mkdir(join(artifactRoot, "definitions"), { recursive: true });
  await mkdir(join(artifactRoot, "prompts"), { recursive: true });
  await mkdir(join(artifactRoot, "components"), { recursive: true });
  await mkdir(fakeWorkspaceReactRoot, { recursive: true });
  await mkdir(join(workspaceRoot, "node_modules"), { recursive: true });

  await writeFile(
    fakeWorkspaceReactPackageJsonPath,
    JSON.stringify({ name: "react", version: "0.0.0-workspace-fake" }),
  );
  await symlink(
    dirname(runtimeRequire.resolve("zod/package.json")),
    join(workspaceRoot, "node_modules", "zod"),
  );

  await writeFile(definitionPath, "export const proof = true;\n");
  await writeFile(promptPath, "# Sandbox proof\n");
  await writeFile(componentPath, "export const componentProof = true;\n");
  await writeFile(
    entryPath,
    [
      'import { createRequire } from "node:module";',
      'import { z } from "zod";',
      "",
      'const reactPackagePath = createRequire(import.meta.url).resolve("react/package.json");',
      'export const workflowId = "sandbox_path_proof";',
      'export const label = "Sandbox Path Proof";',
      "export const summary = reactPackagePath;",
      "export const launchSchema = z.object({});",
      'export const definitionPaths = [".svvy/artifacts/workflows/sandbox-proof/definitions/sandbox-proof.ts"];',
      'export const promptPaths = [".svvy/artifacts/workflows/sandbox-proof/prompts/sandbox-proof.mdx"];',
      'export const componentPaths = [".svvy/artifacts/workflows/sandbox-proof/components/sandbox-proof.ts"];',
      "",
      "export function createRunnableEntry() {",
      "  return {",
      "    workflowId,",
      '    workflowSource: "artifact",',
      "    launchSchema,",
      "    workflow: {} as any,",
      "  };",
      "}",
      "",
    ].join("\n"),
  );

  const entry = await loadRunnableWorkflowEntryAtPath(
    workspaceRoot,
    ".svvy/artifacts/workflows/sandbox-proof/entries/sandbox-proof.ts",
  );

  expect(entry.summary).toBe(runtimeRequire.resolve("react/package.json"));
  expect(entry.summary).not.toBe(fakeWorkspaceReactPackageJsonPath);
  expect(entry.summary).not.toContain(workspaceRoot);
});
