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

test("loads declared Project CI entries with result schema metadata", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "svvy-workflow-registry-ci-test-"));
  tempDirs.push(workspaceRoot);

  const entryPath = join(workspaceRoot, ".svvy", "workflows", "entries", "ci", "project-ci.ts");
  const definitionPath = join(
    workspaceRoot,
    ".svvy",
    "workflows",
    "definitions",
    "ci",
    "project-ci.ts",
  );
  const promptPath = join(workspaceRoot, ".svvy", "workflows", "prompts", "ci", "project-ci.mdx");
  const componentPath = join(
    workspaceRoot,
    ".svvy",
    "workflows",
    "components",
    "ci",
    "project-ci.ts",
  );

  await mkdir(dirname(entryPath), { recursive: true });
  await mkdir(dirname(definitionPath), { recursive: true });
  await mkdir(dirname(promptPath), { recursive: true });
  await mkdir(dirname(componentPath), { recursive: true });
  await writeFile(definitionPath, "export const definition = true;\n");
  await writeFile(promptPath, "# Project CI\n");
  await writeFile(componentPath, "export const component = true;\n");
  await writeFile(
    entryPath,
    [
      'import { z } from "zod";',
      "",
      'export const workflowId = "project_ci";',
      'export const label = "Project CI";',
      'export const summary = "Runs the workspace Project CI checks."; ',
      'export const productKind = "project-ci";',
      "export const launchSchema = z.object({ scope: z.enum(['fast', 'full']).default('fast') });",
      "export const resultSchema = z.object({",
      "  status: z.enum(['passed', 'failed', 'cancelled', 'blocked']),",
      "  summary: z.string().min(1),",
      "  checks: z.array(z.object({",
      "    checkId: z.string().min(1),",
      "    label: z.string().min(1),",
      "    kind: z.string().min(1),",
      "    status: z.enum(['passed', 'failed', 'cancelled', 'skipped', 'blocked']),",
      "    required: z.boolean().default(true),",
      "    summary: z.string().min(1),",
      "    artifactIds: z.array(z.string()).default([]),",
      "  })),",
      "});",
      'export const definitionPaths = [".svvy/workflows/definitions/ci/project-ci.ts"];',
      'export const promptPaths = [".svvy/workflows/prompts/ci/project-ci.mdx"];',
      'export const componentPaths = [".svvy/workflows/components/ci/project-ci.ts"];',
      "",
      "export function createRunnableEntry() {",
      "  return {",
      "    workflowId,",
      '    workflowSource: "saved",',
      "    productKind,",
      "    launchSchema,",
      "    resultSchema,",
      "    workflow: {} as any,",
      "  };",
      "}",
      "",
    ].join("\n"),
  );

  const entry = await loadRunnableWorkflowEntryAtPath(
    workspaceRoot,
    ".svvy/workflows/entries/ci/project-ci.ts",
  );

  expect(entry).toMatchObject({
    workflowId: "project_ci",
    productKind: "project-ci",
    entryPath: ".svvy/workflows/entries/ci/project-ci.ts",
    sourceScope: "saved",
    assetPaths: [
      ".svvy/workflows/components/ci/project-ci.ts",
      ".svvy/workflows/definitions/ci/project-ci.ts",
      ".svvy/workflows/prompts/ci/project-ci.mdx",
    ],
  });
  expect(entry.resultSchema).toBeTruthy();
  expect(
    entry.resultSchema?.safeParse({
      status: "passed",
      summary: "Project CI passed.",
      checks: [
        {
          checkId: "typecheck",
          label: "Typecheck",
          kind: "typecheck",
          status: "passed",
          summary: "Typecheck passed.",
        },
      ],
    }).success,
  ).toBe(true);
});
