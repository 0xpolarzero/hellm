import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type {
  RunnableWorkflowProductKind,
  RunnableWorkflowRegistryEntry,
  RunnableWorkflowRuntimeEntry,
  RunnableWorkflowSourceScope,
} from "./workflow-authoring-contract";

const runtimeRequire = createRequire(import.meta.url);
const importSandboxByWorkspaceRoot = new Map<string, string>();
const RUNTIME_PACKAGES = ["react", "react-dom", "smithers-orchestrator", "zod"] as const;
const RUNTIME_SCOPES = ["@smithers-orchestrator"] as const;

function walkFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      files.push(entryPath);
    }
  }

  return files.toSorted();
}

function relativeWorkspacePath(workspaceRoot: string, path: string): string {
  return relative(workspaceRoot, path).replace(/\\/g, "/");
}

function resolvePackageRootFrom(startPath: string, packageName: string): string | null {
  if (!existsSync(startPath)) {
    return null;
  }
  let current = lstatSync(startPath).isDirectory() ? startPath : dirname(startPath);

  while (true) {
    const candidate = join(current, "node_modules", packageName, "package.json");
    if (existsSync(candidate)) {
      return dirname(candidate);
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function deriveEntryScope(entryPath: string): RunnableWorkflowSourceScope {
  if (entryPath.startsWith(".svvy/workflows/entries/")) {
    return "saved";
  }
  if (entryPath.startsWith(".svvy/artifacts/workflows/")) {
    return "artifact";
  }

  throw new Error(`Unable to derive workflow entry scope for ${entryPath}.`);
}

async function importFresh(path: string): Promise<Record<string, unknown>> {
  return (await import(`${pathToFileURL(path).href}?cacheBust=${Date.now()}`)) as Record<
    string,
    unknown
  >;
}

function resolveRuntimePackageRoot(packageName: (typeof RUNTIME_PACKAGES)[number]): string {
  const resolutionAnchors = [
    typeof process.argv[1] === "string" && process.argv[1].length > 0 ? process.argv[1] : null,
    import.meta.url.startsWith("file:") ? fileURLToPath(import.meta.url) : null,
    typeof process.execPath === "string" && process.execPath.length > 0 ? process.execPath : null,
  ];

  for (const anchor of resolutionAnchors) {
    if (!anchor) {
      continue;
    }
    const packageRoot = resolvePackageRootFrom(anchor, packageName);
    if (packageRoot) {
      return packageRoot;
    }
  }

  return dirname(runtimeRequire.resolve(`${packageName}/package.json`));
}

function syncWorkflowTreeIntoSandbox(sourceRoot: string, destinationRoot: string): void {
  rmSync(destinationRoot, { recursive: true, force: true });
  if (!existsSync(sourceRoot)) {
    mkdirSync(destinationRoot, { recursive: true });
    return;
  }

  cpSync(sourceRoot, destinationRoot, {
    recursive: true,
    dereference: true,
  });
}

function ensureWorkspaceImportSandbox(workspaceRoot: string): string {
  const existing = importSandboxByWorkspaceRoot.get(workspaceRoot);
  if (existing && existsSync(existing)) {
    syncWorkflowTreeIntoSandbox(
      join(workspaceRoot, ".svvy", "workflows"),
      join(existing, ".svvy", "workflows"),
    );
    syncWorkflowTreeIntoSandbox(
      join(workspaceRoot, ".svvy", "artifacts", "workflows"),
      join(existing, ".svvy", "artifacts", "workflows"),
    );
    return existing;
  }

  const sandboxRoot = mkdtempSync(join(tmpdir(), "svvy-workflow-import-"));
  mkdirSync(join(sandboxRoot, ".svvy", "artifacts"), { recursive: true });
  mkdirSync(join(sandboxRoot, "node_modules"), { recursive: true });

  syncWorkflowTreeIntoSandbox(
    join(workspaceRoot, ".svvy", "workflows"),
    join(sandboxRoot, ".svvy", "workflows"),
  );
  syncWorkflowTreeIntoSandbox(
    join(workspaceRoot, ".svvy", "artifacts", "workflows"),
    join(sandboxRoot, ".svvy", "artifacts", "workflows"),
  );

  for (const packageName of RUNTIME_PACKAGES) {
    symlinkSync(
      resolveRuntimePackageRoot(packageName),
      join(sandboxRoot, "node_modules", packageName),
    );
  }

  const runtimeNodeModulesRoot = dirname(resolveRuntimePackageRoot("smithers-orchestrator"));
  for (const scopeName of RUNTIME_SCOPES) {
    const scopeRoot = join(runtimeNodeModulesRoot, scopeName);
    if (existsSync(scopeRoot)) {
      symlinkSync(scopeRoot, join(sandboxRoot, "node_modules", scopeName));
    }
  }

  importSandboxByWorkspaceRoot.set(workspaceRoot, sandboxRoot);
  return sandboxRoot;
}

function readStringArrayExport(module: Record<string, unknown>, exportName: string): string[] {
  const value = module[exportName];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Expected ${exportName} export to be a string[] on runnable workflow entry.`);
  }

  return value.slice().toSorted();
}

function validateEntryAssetPaths(
  workspaceRoot: string,
  entryPath: string,
  kind: "definition" | "prompt" | "component",
  paths: string[],
): string[] {
  const marker =
    kind === "definition" ? "/definitions/" : kind === "prompt" ? "/prompts/" : "/components/";

  for (const path of paths) {
    if (!path.includes(marker)) {
      throw new Error(
        `Runnable workflow entry ${entryPath} declared ${path} in ${kind}Paths, but the path does not match that asset kind.`,
      );
    }

    if (!existsSync(join(workspaceRoot, path))) {
      throw new Error(`Runnable workflow entry ${entryPath} declared missing asset path ${path}.`);
    }
  }

  return paths.toSorted();
}

function schemaFingerprint(schema: z.ZodTypeAny): string {
  return JSON.stringify(z.toJSONSchema(schema as any, { io: "input" }));
}

function readProductKind(
  module: Record<string, unknown>,
  entryPath: string,
): RunnableWorkflowProductKind | undefined {
  const value = module.productKind;
  if (value === undefined) {
    return undefined;
  }
  if (value !== "project-ci") {
    throw new Error(
      `Runnable workflow entry ${entryPath} declared unsupported productKind ${String(value)}.`,
    );
  }
  return value;
}

function createValidationDbPath(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "svvy-workflow-entry-"));
  return {
    dir,
    dbPath: join(dir, "registry-validation.db"),
  };
}

async function loadRunnableWorkflowEntryModule(
  workspaceRoot: string,
  entryPath: string,
): Promise<RunnableWorkflowRegistryEntry> {
  const importSandboxRoot = ensureWorkspaceImportSandbox(workspaceRoot);
  const absoluteEntryPath = join(importSandboxRoot, entryPath);
  const sourceScope = deriveEntryScope(entryPath);
  const module = await importFresh(absoluteEntryPath);

  const workflowId = String(module.workflowId ?? "");
  const label = String(module.label ?? "");
  const summary = String(module.summary ?? "");
  const launchSchema = module.launchSchema as z.ZodTypeAny | undefined;
  const productKind = readProductKind(module, entryPath);
  const resultSchema = module.resultSchema as z.ZodTypeAny | undefined;
  const createRunnableEntry = module.createRunnableEntry as
    | ((input: { dbPath: string }) => RunnableWorkflowRuntimeEntry)
    | undefined;

  if (!workflowId || !label || !summary || !launchSchema) {
    throw new Error(
      `Runnable workflow entry ${entryPath} is missing workflowId, label, summary, or launchSchema.`,
    );
  }
  if (typeof createRunnableEntry !== "function") {
    throw new Error(`Runnable workflow entry ${entryPath} is missing createRunnableEntry(...).`);
  }
  if (productKind === "project-ci" && !resultSchema) {
    throw new Error(
      `Runnable workflow entry ${entryPath} declares productKind "project-ci" but is missing resultSchema.`,
    );
  }

  const definitionPaths = validateEntryAssetPaths(
    workspaceRoot,
    entryPath,
    "definition",
    readStringArrayExport(module, "definitionPaths"),
  );
  const promptPaths = validateEntryAssetPaths(
    workspaceRoot,
    entryPath,
    "prompt",
    readStringArrayExport(module, "promptPaths"),
  );
  const componentPaths = validateEntryAssetPaths(
    workspaceRoot,
    entryPath,
    "component",
    readStringArrayExport(module, "componentPaths"),
  );

  const validation = createValidationDbPath();
  try {
    const runtimeEntry = createRunnableEntry({
      dbPath: validation.dbPath,
    });

    if (runtimeEntry.workflowId !== workflowId) {
      throw new Error(
        `Runnable workflow entry ${entryPath} returned workflowId ${runtimeEntry.workflowId}, which does not match exported workflowId ${workflowId}.`,
      );
    }
    if (runtimeEntry.workflowSource !== sourceScope) {
      throw new Error(
        `Runnable workflow entry ${entryPath} returned workflowSource ${runtimeEntry.workflowSource}, which does not match derived scope ${sourceScope}.`,
      );
    }
    if (runtimeEntry.productKind !== productKind) {
      throw new Error(
        `Runnable workflow entry ${entryPath} returned productKind ${String(runtimeEntry.productKind)}, which does not match exported productKind ${String(productKind)}.`,
      );
    }
    if (schemaFingerprint(runtimeEntry.launchSchema) !== schemaFingerprint(launchSchema)) {
      throw new Error(
        `Runnable workflow entry ${entryPath} returned a launchSchema that does not match the exported launchSchema.`,
      );
    }
    if (productKind === "project-ci") {
      if (!runtimeEntry.resultSchema) {
        throw new Error(
          `Runnable workflow entry ${entryPath} returned productKind "project-ci" without resultSchema.`,
        );
      }
      if (schemaFingerprint(runtimeEntry.resultSchema) !== schemaFingerprint(resultSchema!)) {
        throw new Error(
          `Runnable workflow entry ${entryPath} returned a resultSchema that does not match the exported resultSchema.`,
        );
      }
    }
    if (!runtimeEntry.workflow) {
      throw new Error(`Runnable workflow entry ${entryPath} returned an empty workflow graph.`);
    }
  } finally {
    rmSync(validation.dir, { recursive: true, force: true });
  }

  return {
    workflowId,
    label,
    summary,
    sourceScope,
    entryPath,
    productKind,
    launchSchema,
    resultSchema,
    definitionPaths,
    promptPaths,
    componentPaths,
    assetPaths: Array.from(
      new Set([...definitionPaths, ...promptPaths, ...componentPaths]),
    ).toSorted(),
    createRunnableEntry,
  };
}

function listEntryFiles(workspaceRoot: string): string[] {
  const savedEntriesRoot = join(workspaceRoot, ".svvy", "workflows", "entries");
  const artifactWorkflowsRoot = join(workspaceRoot, ".svvy", "artifacts", "workflows");

  return [
    ...walkFiles(savedEntriesRoot),
    ...walkFiles(artifactWorkflowsRoot).filter((path) => path.includes("/entries/")),
  ]
    .filter((path) => [".ts", ".tsx"].includes(extname(path)))
    .map((path) => relativeWorkspacePath(workspaceRoot, path))
    .toSorted();
}

export async function loadRunnableWorkflowRegistry(
  workspaceRoot: string,
): Promise<RunnableWorkflowRegistryEntry[]> {
  const entries = await Promise.all(
    listEntryFiles(workspaceRoot).map(
      async (entryPath) => await loadRunnableWorkflowEntryModule(workspaceRoot, entryPath),
    ),
  );

  const seenWorkflowIds = new Set<string>();
  for (const entry of entries) {
    if (seenWorkflowIds.has(entry.workflowId)) {
      throw new Error(`Duplicate runnable workflow id ${entry.workflowId}.`);
    }
    seenWorkflowIds.add(entry.workflowId);
  }

  return entries.toSorted(
    (left, right) =>
      left.workflowId.localeCompare(right.workflowId) ||
      left.sourceScope.localeCompare(right.sourceScope) ||
      left.entryPath.localeCompare(right.entryPath),
  );
}

export async function loadRunnableWorkflowEntryAtPath(
  workspaceRoot: string,
  entryPath: string,
): Promise<RunnableWorkflowRegistryEntry> {
  return await loadRunnableWorkflowEntryModule(workspaceRoot, entryPath);
}

export async function loadRunnableWorkflowById(
  workspaceRoot: string,
  workflowId: string,
): Promise<RunnableWorkflowRegistryEntry> {
  const registry = await loadRunnableWorkflowRegistry(workspaceRoot);
  const entry = registry.find((candidate) => candidate.workflowId === workflowId);
  if (!entry) {
    throw new Error(`Runnable Smithers workflow entry not found: ${workflowId}`);
  }

  return entry;
}
