import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import type { SmithersWorkflow } from "smithers-orchestrator";
import { z } from "zod";

export type RunnableWorkflowSourceScope = "saved" | "artifact";

export type RunnableWorkflowRuntimeEntry = {
  workflowId: string;
  workflowSource: RunnableWorkflowSourceScope;
  launchSchema: z.ZodTypeAny;
  workflow: SmithersWorkflow<any>;
};

export type RunnableWorkflowRegistryEntry = {
  workflowId: string;
  label: string;
  summary: string;
  sourceScope: RunnableWorkflowSourceScope;
  entryPath: string;
  launchSchema: z.ZodTypeAny;
  definitionPaths: string[];
  promptPaths: string[];
  componentPaths: string[];
  assetPaths: string[];
  createRunnableEntry: (input: { dbPath: string }) => RunnableWorkflowRuntimeEntry;
};

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
  const absoluteEntryPath = join(workspaceRoot, entryPath);
  const sourceScope = deriveEntryScope(entryPath);
  const module = await importFresh(absoluteEntryPath);

  const workflowId = String(module.workflowId ?? "");
  const label = String(module.label ?? "");
  const summary = String(module.summary ?? "");
  const launchSchema = module.launchSchema as z.ZodTypeAny | undefined;
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
    if (schemaFingerprint(runtimeEntry.launchSchema) !== schemaFingerprint(launchSchema)) {
      throw new Error(
        `Runnable workflow entry ${entryPath} returned a launchSchema that does not match the exported launchSchema.`,
      );
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
    launchSchema,
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
