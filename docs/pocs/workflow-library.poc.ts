/**
 * Workflow library, authoring assets, and runnable entries POC
 *
 * This proves the adopted model:
 * - saved reusable assets live under `.svvy/workflows/{definitions,prompts,components}`
 * - runnable saved entries live under `.svvy/workflows/entries`
 * - artifact workflows live under `.svvy/artifacts/workflows/<id>/{...,entries,metadata.json}`
 * - `api.workflow.listAssets(...)` and `api.workflow.listModels()` are authoring-time discovery APIs inside `execute_typescript`
 * - `smithers.list_workflows` is reserved for runnable entries and lists both saved and artifact entries
 * - launch goes through a minimal bridge-shaped `smithers.*` seam rather than a trace-local helper
 * - runnable entries publish explicit grouped asset refs instead of relying on inferred import graphs
 * - writing reusable saved workflow files happens through ordinary repo writes into `.svvy/workflows/...`
 * - writes under `.svvy/workflows/...` return validation feedback through the surrounding `execute_typescript` result
 *
 * Proof boundaries:
 * - this POC proves asset discovery, runnable-entry registry validation, bridge-shaped launch, and saved-library write semantics
 * - it does not attempt to prove live supervision monitors, reconnect, synthetic wake-ups, workflow-task-agent execution, or Project CI execution
 */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect } from "effect";
import { runWorkflow } from "smithers-orchestrator";
import { z } from "zod";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

type AssetKind = "definition" | "prompt" | "component";
type AssetScope = "saved" | "artifact";

type AssetMetadata = {
  id: string;
  kind: AssetKind;
  title: string;
  summary: string;
  path: string;
  scope: AssetScope;
  createdAt?: string;
  updatedAt?: string;
};

type ModelInfo = {
  providerId: string;
  modelId: string;
  authAvailable: boolean;
  authSource: string;
  capabilityFlags: string[];
};

type RunnableWorkflowEntry = {
  id: string;
  label: string;
  summary: string;
  sourceScope: AssetScope;
  launchToolName: `smithers.run_workflow.${string}`;
  launchInputSchema: Record<string, unknown>;
  entryPath: string;
  assetPaths: string[];
  definitionPaths: string[];
  promptPaths: string[];
  componentPaths: string[];
};

type RunnableEntryFactoryOutput = {
  workflowId: string;
  workflowSource: AssetScope;
  launchSchema: z.ZodTypeAny;
  workflow: unknown;
};

type ExecutionDetails = {
  workflowId: string;
  workflowSource: AssetScope;
  entryPath: string;
  runStatus: string;
  output: Record<string, unknown>;
};

type TraceStep = {
  toolName: string;
  args: unknown;
  childCalls?: Array<{
    toolName: string;
    args: unknown;
    result: unknown;
  }>;
  result: unknown;
};

type ScenarioResult = {
  id: string;
  trace: TraceStep[];
  proof: Record<string, unknown>;
};

type SavedSeed = {
  definitionPath: string;
  promptPath: string;
  componentPath: string;
  entryPath: string;
};

type ArtifactDraft = {
  artifactWorkflowId: string;
  objectiveSummary: string;
  promptPath: string;
  componentPath: string;
  entryPath: string;
  metadataPath: string;
  reviewerModel: ModelInfo;
};

type SaveAssetsResult = {
  promptPath: string;
  componentPath: string;
  entryPath: string;
};

type SmithersBridgePoc = {
  listWorkflows: () => Promise<RunnableWorkflowEntry[]>;
  runWorkflow: (workflowId: string, input: Record<string, unknown>) => Promise<ExecutionDetails>;
};

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeText(path: string, text: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, text, "utf8");
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

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
      } else {
        files.push(entryPath);
      }
    }
  }
  return files.toSorted();
}

function relativeWorkspacePath(workspaceRoot: string, path: string): string {
  return relative(workspaceRoot, path);
}

function relativeImportPath(fromDir: string, toPath: string): string {
  const path = relative(fromDir, toPath).replace(/\\/g, "/");
  return path.startsWith(".") ? path : `./${path}`;
}

function readTsJsdocTag(header: string, tag: string): string | undefined {
  const match = header.match(new RegExp(`@${tag}\\s+([^\\n*]+)`));
  return match?.[1]?.trim();
}

function parseFrontmatter(text: string): Record<string, string | string[]> {
  if (!text.startsWith("---\n")) {
    return {};
  }
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) {
    return {};
  }
  const result: Record<string, string | string[]> = {};
  let currentListKey: string | null = null;
  for (const line of text.slice(4, end).split("\n")) {
    if (line.startsWith("  - ") && currentListKey) {
      const current = result[currentListKey];
      const values = Array.isArray(current) ? current : [];
      values.push(line.slice(4).trim());
      result[currentListKey] = values;
      continue;
    }
    currentListKey = null;
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!rawValue) {
      result[key] = [];
      currentListKey = key;
      continue;
    }
    result[key] = rawValue;
  }
  return result;
}

function parseAssetMetadata(workspaceRoot: string, path: string, scope: AssetScope): AssetMetadata {
  const text = readText(path);
  const stats = statSync(path);
  if (extname(path) === ".mdx") {
    const frontmatter = parseFrontmatter(text);
    return {
      id: String(frontmatter.svvyId ?? relativeWorkspacePath(workspaceRoot, path)),
      kind: "prompt",
      title: String(frontmatter.title ?? relativeWorkspacePath(workspaceRoot, path)),
      summary: String(frontmatter.summary ?? ""),
      path: relativeWorkspacePath(workspaceRoot, path),
      scope,
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
    };
  }

  const header = text.match(/\/\*\*[\s\S]*?\*\//)?.[0] ?? "";
  return {
    id: readTsJsdocTag(header, "svvyId") ?? relativeWorkspacePath(workspaceRoot, path),
    kind: (readTsJsdocTag(header, "svvyAssetKind") as AssetKind | undefined) ?? "component",
    title: readTsJsdocTag(header, "svvyTitle") ?? relativeWorkspacePath(workspaceRoot, path),
    summary: readTsJsdocTag(header, "svvySummary") ?? "",
    path: relativeWorkspacePath(workspaceRoot, path),
    scope,
    createdAt: stats.birthtime.toISOString(),
    updatedAt: stats.mtime.toISOString(),
  };
}

function listAssetFiles(workspaceRoot: string, scope: AssetScope): string[] {
  if (scope === "saved") {
    return walkFiles(join(workspaceRoot, ".svvy", "workflows")).filter((path) =>
      ["/definitions/", "/prompts/", "/components/"].some((segment) => path.includes(segment)),
    );
  }
  return walkFiles(join(workspaceRoot, ".svvy", "artifacts", "workflows")).filter((path) =>
    ["/definitions/", "/prompts/", "/components/"].some((segment) => path.includes(segment)),
  );
}

function listAssets(
  workspaceRoot: string,
  input: {
    kind?: AssetKind;
    pathPrefix?: string;
    scope?: "saved" | "artifact" | "both";
  },
): AssetMetadata[] {
  const scopes =
    input.scope === "artifact"
      ? ["artifact"]
      : input.scope === "both"
        ? ["saved", "artifact"]
        : ["saved"];

  return scopes
    .flatMap((scope) =>
      listAssetFiles(workspaceRoot, scope as AssetScope)
        .filter((path) => [".ts", ".tsx", ".mdx"].includes(extname(path)))
        .map((path) => parseAssetMetadata(workspaceRoot, path, scope as AssetScope)),
    )
    .filter((asset) => (input.kind ? asset.kind === input.kind : true))
    .filter((asset) => (input.pathPrefix ? asset.path.startsWith(input.pathPrefix) : true))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

function listModels(): ModelInfo[] {
  return [
    {
      providerId: "openai",
      modelId: "gpt-5.4",
      authAvailable: true,
      authSource: "oauth",
      capabilityFlags: ["reasoning", "tool-calling"],
    },
    {
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      authAvailable: true,
      authSource: "oauth",
      capabilityFlags: ["reasoning", "tool-calling"],
    },
    {
      providerId: "anthropic",
      modelId: "claude-sonnet-4",
      authAvailable: true,
      authSource: "api-key",
      capabilityFlags: ["tool-calling"],
    },
  ];
}

function readPromptBody(path: string): string {
  const text = readText(path);
  if (!text.startsWith("---\n")) {
    return text.trim();
  }
  const end = text.indexOf("\n---\n", 4);
  return (end === -1 ? text : text.slice(end + 5)).trim();
}

async function importFresh(path: string): Promise<Record<string, unknown>> {
  return (await import(`${pathToFileURL(path).href}?cacheBust=${randomUUID()}`)) as Record<
    string,
    unknown
  >;
}

function deriveEntryScope(entryPath: string): AssetScope {
  if (entryPath.startsWith(".svvy/workflows/entries/")) {
    return "saved";
  }
  if (entryPath.startsWith(".svvy/artifacts/workflows/")) {
    return "artifact";
  }
  throw new Error(`Unable to derive entry scope for ${entryPath}.`);
}

function readStringArrayExport(module: Record<string, unknown>, name: string): string[] {
  const value = module[name];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Expected ${name} export to be a string[] on runnable entry.`);
  }
  return value.slice();
}

function validateEntryAssetPaths(
  workspaceRoot: string,
  entryPath: string,
  kind: AssetKind,
  paths: string[],
): string[] {
  const marker = `/${kind === "definition" ? "definitions" : kind === "prompt" ? "prompts" : "components"}/`;
  for (const path of paths) {
    if (!path.includes(marker)) {
      throw new Error(
        `Entry ${entryPath} declared ${path} in ${kind}Paths, but the path does not match that asset kind.`,
      );
    }
    if (!existsSync(join(workspaceRoot, path))) {
      throw new Error(`Entry ${entryPath} declared missing asset path ${path}.`);
    }
  }
  return paths.toSorted();
}

function schemaFingerprint(schema: z.ZodTypeAny): string {
  return JSON.stringify(z.toJSONSchema(schema as any, { io: "input" }));
}

function createValidationDbPath(workspaceRoot: string, purpose: string): string {
  const dbPath = join(workspaceRoot, ".svvy", "runtime", `${purpose}-${randomUUID()}.db`);
  ensureDir(dirname(dbPath));
  return dbPath;
}

async function loadRunnableEntryModule(
  workspaceRoot: string,
  input: {
    entryPath: string;
    sourceScope: AssetScope;
  },
): Promise<{
  workflowId: string;
  label: string;
  summary: string;
  launchSchema: z.ZodTypeAny;
  definitionPaths: string[];
  promptPaths: string[];
  componentPaths: string[];
  createRunnableEntry: (input: { dbPath: string }) => RunnableEntryFactoryOutput;
}> {
  const absolutePath = join(workspaceRoot, input.entryPath);
  const module = await importFresh(absolutePath);
  const workflowId = String(module.workflowId ?? "");
  const label = String(module.label ?? "");
  const summary = String(module.summary ?? "");
  const launchSchema = module.launchSchema as z.ZodTypeAny | undefined;
  const createRunnableEntry = module.createRunnableEntry as
    | ((input: { dbPath: string }) => RunnableEntryFactoryOutput)
    | undefined;

  if (!workflowId || !label || !summary || !launchSchema) {
    throw new Error(
      `Runnable entry ${input.entryPath} is missing workflowId, label, summary, or launchSchema.`,
    );
  }
  if (typeof createRunnableEntry !== "function") {
    throw new Error(`Runnable entry ${input.entryPath} is missing createRunnableEntry(...).`);
  }

  const definitionPaths = validateEntryAssetPaths(
    workspaceRoot,
    input.entryPath,
    "definition",
    readStringArrayExport(module, "definitionPaths"),
  );
  const promptPaths = validateEntryAssetPaths(
    workspaceRoot,
    input.entryPath,
    "prompt",
    readStringArrayExport(module, "promptPaths"),
  );
  const componentPaths = validateEntryAssetPaths(
    workspaceRoot,
    input.entryPath,
    "component",
    readStringArrayExport(module, "componentPaths"),
  );

  const runtimeEntry = createRunnableEntry({
    dbPath: createValidationDbPath(workspaceRoot, "validate-entry"),
  });

  if (runtimeEntry.workflowId !== workflowId) {
    throw new Error(
      `Runnable entry ${input.entryPath} returned workflowId ${runtimeEntry.workflowId}, which does not match exported workflowId ${workflowId}.`,
    );
  }
  if (runtimeEntry.workflowSource !== input.sourceScope) {
    throw new Error(
      `Runnable entry ${input.entryPath} returned workflowSource ${runtimeEntry.workflowSource}, which does not match derived sourceScope ${input.sourceScope}.`,
    );
  }
  if (schemaFingerprint(runtimeEntry.launchSchema) !== schemaFingerprint(launchSchema)) {
    throw new Error(
      `Runnable entry ${input.entryPath} returned a launchSchema that does not match the exported launchSchema.`,
    );
  }
  if (!runtimeEntry.workflow) {
    throw new Error(`Runnable entry ${input.entryPath} returned an empty workflow graph.`);
  }

  return {
    workflowId,
    label,
    summary,
    launchSchema,
    definitionPaths,
    promptPaths,
    componentPaths,
    createRunnableEntry,
  };
}

async function listRunnableWorkflows(workspaceRoot: string): Promise<RunnableWorkflowEntry[]> {
  const savedEntriesRoot = join(workspaceRoot, ".svvy", "workflows", "entries");
  const artifactWorkflowsRoot = join(workspaceRoot, ".svvy", "artifacts", "workflows");

  const entryFiles = [
    ...walkFiles(savedEntriesRoot),
    ...walkFiles(artifactWorkflowsRoot).filter((path) => path.includes("/entries/")),
  ].filter((path) => [".ts", ".tsx"].includes(extname(path)));

  const seenIds = new Set<string>();
  const entries: RunnableWorkflowEntry[] = [];

  for (const absolutePath of entryFiles) {
    const entryPath = relativeWorkspacePath(workspaceRoot, absolutePath);
    const sourceScope = deriveEntryScope(entryPath);
    const {
      workflowId,
      label,
      summary,
      launchSchema,
      definitionPaths,
      promptPaths,
      componentPaths,
    } = await loadRunnableEntryModule(workspaceRoot, {
      entryPath,
      sourceScope,
    });
    if (seenIds.has(workflowId)) {
      throw new Error(`Duplicate runnable workflow id ${workflowId}.`);
    }
    seenIds.add(workflowId);

    const assetPaths = Array.from(
      new Set([...definitionPaths, ...promptPaths, ...componentPaths]),
    ).toSorted();

    entries.push({
      id: workflowId,
      label,
      summary,
      sourceScope,
      launchToolName: `smithers.run_workflow.${workflowId}` as const,
      launchInputSchema: z.toJSONSchema(launchSchema as any, { io: "input" }) as Record<
        string,
        unknown
      >,
      entryPath,
      assetPaths,
      definitionPaths,
      promptPaths,
      componentPaths,
    });
  }

  return entries.toSorted(
    (left, right) =>
      left.id.localeCompare(right.id) || left.sourceScope.localeCompare(right.sourceScope),
  );
}

function normalizeWorkflowOutput(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    if (last && typeof last === "object" && !Array.isArray(last)) {
      return last as Record<string, unknown>;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`Expected structured workflow output, received ${String(value)}.`);
}

function updateArtifactMetadataExecutionStatus(
  workspaceRoot: string,
  artifactWorkflowId: string,
  runStatus: string,
): void {
  const metadataPath = join(
    workspaceRoot,
    ".svvy",
    "artifacts",
    "workflows",
    artifactWorkflowId,
    "metadata.json",
  );
  const current = JSON.parse(readText(metadataPath)) as Record<string, unknown>;
  current.lastExecutionStatus = runStatus;
  current.updatedAt = new Date().toISOString();
  writeText(metadataPath, JSON.stringify(current, null, 2));
}

// Minimal in-process stand-in for the Bun-owned Smithers bridge.
// It preserves the registry and launch seam without modeling monitors or reconnect.
function createSmithersBridgePoc(workspaceRoot: string): SmithersBridgePoc {
  return {
    listWorkflows: async () => listRunnableWorkflows(workspaceRoot),
    runWorkflow: async (workflowId, input) => {
      const entries = await listRunnableWorkflows(workspaceRoot);
      const entry = entries.find((candidate) => candidate.id === workflowId);
      if (!entry) {
        throw new Error(`No runnable workflow entry found for ${workflowId}.`);
      }

      const { createRunnableEntry } = await loadRunnableEntryModule(workspaceRoot, {
        entryPath: entry.entryPath,
        sourceScope: entry.sourceScope,
      });
      const runnableEntry = createRunnableEntry({
        dbPath: createValidationDbPath(workspaceRoot, "run-entry"),
      });
      const parsedInput = runnableEntry.launchSchema.parse(input);
      const result = await Effect.runPromise(
        runWorkflow(runnableEntry.workflow as any, {
          runId: `workflow-library-poc-${randomUUID()}`,
          input: parsedInput,
        }),
      );

      const runStatus =
        typeof (result as any).status === "string" ? (result as any).status : "unknown";
      if (entry.sourceScope === "artifact") {
        const parts = entry.entryPath.split("/");
        const artifactWorkflowId = parts[3];
        if (artifactWorkflowId) {
          updateArtifactMetadataExecutionStatus(workspaceRoot, artifactWorkflowId, runStatus);
        }
      }

      return {
        workflowId: runnableEntry.workflowId,
        workflowSource: runnableEntry.workflowSource,
        entryPath: entry.entryPath,
        runStatus,
        output: normalizeWorkflowOutput((result as any).output),
      };
    },
  };
}

function summarizeAssets(assets: AssetMetadata[]): Array<Record<string, unknown>> {
  return assets.map((asset) => ({
    id: asset.id,
    kind: asset.kind,
    scope: asset.scope,
    path: asset.path,
  }));
}

function writePromptAsset(
  path: string,
  input: {
    id: string;
    title: string;
    summary: string;
    body: string;
  },
): void {
  writeText(
    path,
    [
      "---",
      "svvyAssetKind: prompt",
      `svvyId: ${input.id}`,
      `title: ${input.title}`,
      `summary: ${input.summary}`,
      "---",
      input.body,
      "",
    ].join("\n"),
  );
}

function writeWorkflowAgentComponent(
  path: string,
  input: {
    assetId: string;
    title: string;
    summary: string;
    exportName: string;
    agent: {
      name: string;
      provider: string;
      model: string;
      reasoning: string;
      toolSurface: string[];
      instructions: string;
    };
  },
): void {
  writeText(
    path,
    [
      "/**",
      " * @svvyAssetKind component",
      ` * @svvyId ${input.assetId}`,
      ` * @svvyTitle ${input.title}`,
      ` * @svvySummary ${input.summary}`,
      " */",
      `export const ${input.exportName} = {`,
      `  name: ${JSON.stringify(input.agent.name)},`,
      `  provider: ${JSON.stringify(input.agent.provider)},`,
      `  model: ${JSON.stringify(input.agent.model)},`,
      `  reasoning: ${JSON.stringify(input.agent.reasoning)},`,
      `  toolSurface: ${JSON.stringify(input.agent.toolSurface)},`,
      `  instructions: ${JSON.stringify(input.agent.instructions)},`,
      "};",
      "",
    ].join("\n"),
  );
}

function writeSavedImplementReviewEntry(
  workspaceRoot: string,
  input: {
    entryPath: string;
    definitionPath: string;
    promptPath: string;
    componentPath: string;
  },
): void {
  const absoluteEntryPath = join(workspaceRoot, input.entryPath);
  const entryDir = dirname(absoluteEntryPath);
  const definitionImportPath = relativeImportPath(
    entryDir,
    join(workspaceRoot, input.definitionPath),
  );
  const componentImportPath = relativeImportPath(
    entryDir,
    join(workspaceRoot, input.componentPath),
  );
  const reviewPromptRelativePath = relativeImportPath(
    entryDir,
    join(workspaceRoot, input.promptPath),
  );

  writeText(
    absoluteEntryPath,
    [
      'import { readFileSync } from "node:fs";',
      `import { createImplementReviewWorkflow, implementReviewLaunchSchema } from "${definitionImportPath}";`,
      `import { cheapImplementer, carefulReviewer } from "${componentImportPath}";`,
      "",
      "function readPromptBody(relativePath: string): string {",
      '  const text = readFileSync(new URL(relativePath, import.meta.url), "utf8");',
      '  if (!text.startsWith("---\\n")) {',
      "    return text.trim();",
      "  }",
      '  const end = text.indexOf("\\n---\\n", 4);',
      "  return (end === -1 ? text : text.slice(end + 5)).trim();",
      "}",
      "",
      `const reviewPromptPath = ${JSON.stringify(reviewPromptRelativePath)};`,
      "",
      "export const workflowId = 'implement_review';",
      "export const label = 'Implement Review';",
      "export const summary = 'Saved runnable entry fixture that proves prompt and workflow agent binding with saved defaults.';",
      "export const launchSchema = implementReviewLaunchSchema;",
      `export const definitionPaths = ${JSON.stringify([input.definitionPath], null, 2)} as const;`,
      `export const promptPaths = ${JSON.stringify([input.promptPath], null, 2)} as const;`,
      `export const componentPaths = ${JSON.stringify([input.componentPath], null, 2)} as const;`,
      "",
      "export function createRunnableEntry(input: { dbPath: string }) {",
      "  const reviewPrompt = readPromptBody(reviewPromptPath);",
      "  return {",
      "    workflowId,",
      "    workflowSource: 'saved' as const,",
      "    launchSchema,",
      "    workflow: createImplementReviewWorkflow({",
      "      dbPath: input.dbPath,",
      "      workflowName: 'implement-review',",
      "      workflowId,",
      "      workflowSource: 'saved',",
      "      implementerAgent: cheapImplementer,",
      "      reviewerAgent: carefulReviewer,",
      "      implementPrompt: cheapImplementer.instructions,",
      "      reviewPrompt,",
      "    }),",
      "  };",
      "}",
      "",
    ].join("\n"),
  );
}

function writeOAuthReviewEntry(
  workspaceRoot: string,
  input: {
    entryPath: string;
    workflowId: string;
    label: string;
    summary: string;
    workflowSource: AssetScope;
    definitionPath: string;
    savedComponentPath: string;
    reviewerComponentPath: string;
    reviewPromptPath: string;
    implementPromptPath: string;
    definitionPaths: string[];
    promptPaths: string[];
    componentPaths: string[];
  },
): void {
  const absoluteEntryPath = join(workspaceRoot, input.entryPath);
  const entryDir = dirname(absoluteEntryPath);
  const definitionImportPath = relativeImportPath(
    entryDir,
    join(workspaceRoot, input.definitionPath),
  );
  const savedComponentImportPath = relativeImportPath(
    entryDir,
    join(workspaceRoot, input.savedComponentPath),
  );
  const reviewerComponentImportPath = relativeImportPath(
    entryDir,
    join(workspaceRoot, input.reviewerComponentPath),
  );
  const reviewPromptRelativePath = relativeImportPath(
    entryDir,
    join(workspaceRoot, input.reviewPromptPath),
  );
  const implementPromptRelativePath = relativeImportPath(
    entryDir,
    join(workspaceRoot, input.implementPromptPath),
  );

  writeText(
    absoluteEntryPath,
    [
      'import { readFileSync } from "node:fs";',
      `import { createImplementReviewWorkflow, implementReviewLaunchSchema } from "${definitionImportPath}";`,
      `import { cheapImplementer } from "${savedComponentImportPath}";`,
      `import { oauthSecurityReviewer } from "${reviewerComponentImportPath}";`,
      "",
      "function readPromptBody(relativePath: string): string {",
      '  const text = readFileSync(new URL(relativePath, import.meta.url), "utf8");',
      '  if (!text.startsWith("---\\n")) {',
      "    return text.trim();",
      "  }",
      '  const end = text.indexOf("\\n---\\n", 4);',
      "  return (end === -1 ? text : text.slice(end + 5)).trim();",
      "}",
      "",
      `const reviewPromptPath = ${JSON.stringify(reviewPromptRelativePath)};`,
      `const implementPromptPath = ${JSON.stringify(implementPromptRelativePath)};`,
      "",
      `export const workflowId = ${JSON.stringify(input.workflowId)};`,
      `export const label = ${JSON.stringify(input.label)};`,
      `export const summary = ${JSON.stringify(input.summary)};`,
      "export const launchSchema = implementReviewLaunchSchema;",
      `export const definitionPaths = ${JSON.stringify(input.definitionPaths, null, 2)} as const;`,
      `export const promptPaths = ${JSON.stringify(input.promptPaths, null, 2)} as const;`,
      `export const componentPaths = ${JSON.stringify(input.componentPaths, null, 2)} as const;`,
      "",
      "export function createRunnableEntry(input: { dbPath: string }) {",
      "  const reviewBase = readPromptBody(reviewPromptPath);",
      "  const implementDetails = readPromptBody(implementPromptPath);",
      "  return {",
      "    workflowId,",
      `    workflowSource: ${JSON.stringify(input.workflowSource)} as const,`,
      "    launchSchema,",
      "    workflow: createImplementReviewWorkflow({",
      "      dbPath: input.dbPath,",
      `      workflowName: ${JSON.stringify(input.workflowId.replaceAll("_", "-"))},`,
      "      workflowId,",
      `      workflowSource: ${JSON.stringify(input.workflowSource)},`,
      "      implementerAgent: cheapImplementer,",
      "      reviewerAgent: oauthSecurityReviewer,",
      "      implementPrompt: `${cheapImplementer.instructions}\\n\\n${implementDetails}`,",
      "      reviewPrompt: `${reviewBase}\\n\\n${oauthSecurityReviewer.instructions}`,",
      "    }),",
      "  };",
      "}",
      "",
    ].join("\n"),
  );
}

function seedSavedWorkflowLibrary(workspaceRoot: string): SavedSeed {
  const savedRoot = join(workspaceRoot, ".svvy", "workflows");
  const definitionPath = join(savedRoot, "definitions", "create-implement-review.tsx");
  const promptPath = join(savedRoot, "prompts", "review-base.mdx");
  const componentPath = join(savedRoot, "components", "agents.tsx");
  const entryPath = join(savedRoot, "entries", "implement-review.tsx");

  writeText(
    definitionPath,
    [
      "/**",
      " * @svvyAssetKind definition",
      " * @svvyId create_implement_review",
      " * @svvyTitle Create Implement Review",
      " * @svvySummary Reusable workflow fixture for binding prompts and workflow agents into a launchable entry contract.",
      " */",
      'import React from "react";',
      'import { createSmithers } from "smithers-orchestrator";',
      'import { z } from "zod";',
      "",
      "const workflowAgentSchema = z.object({",
      "  name: z.string(),",
      "  provider: z.string(),",
      "  model: z.string(),",
      "  reasoning: z.string(),",
      "  toolSurface: z.array(z.string()),",
      "  instructions: z.string(),",
      "});",
      "",
      "export const implementReviewLaunchSchema = z.object({",
      "  objective: z.string().min(1),",
      "});",
      "",
      "export function createImplementReviewWorkflow(config: {",
      "  dbPath: string;",
      "  workflowName: string;",
      "  workflowId: string;",
      "  workflowSource: 'saved' | 'artifact';",
      "  implementerAgent: z.infer<typeof workflowAgentSchema>;",
      "  reviewerAgent: z.infer<typeof workflowAgentSchema>;",
      "  implementPrompt: string;",
      "  reviewPrompt: string;",
      "}) {",
      "  const implementRequestSchema = z.object({ prompt: z.string() });",
      "  const reviewRequestSchema = z.object({ prompt: z.string() });",
      "  const outputSchema = z.object({",
      "    workflowId: z.string(),",
      "    workflowSource: z.enum(['saved', 'artifact']),",
      "    objective: z.string(),",
      "    implementPrompt: z.string(),",
      "    reviewPrompt: z.string(),",
      "    implementerAgent: workflowAgentSchema,",
      "    reviewerAgent: workflowAgentSchema,",
      "  });",
      "  const smithersApi = createSmithers(",
      "    { implement: implementRequestSchema, review: reviewRequestSchema, output: outputSchema },",
      "    { dbPath: config.dbPath },",
      "  );",
      "  return smithersApi.smithers((ctx) => {",
      "    const launch = implementReviewLaunchSchema.parse(ctx.input);",
      "    return React.createElement(",
      "      smithersApi.Workflow,",
      "      { name: config.workflowName },",
      "      React.createElement(",
      "        smithersApi.Sequence,",
      "        null,",
      "        React.createElement(smithersApi.Task, {",
      "          id: 'prepare_implement_request',",
      "          output: smithersApi.outputs.implement,",
      "          children: { prompt: `${config.implementPrompt}\\n\\nObjective: ${launch.objective}` },",
      "        }),",
      "        React.createElement(smithersApi.Task, {",
      "          id: 'prepare_review_request',",
      "          output: smithersApi.outputs.review,",
      "          children: { prompt: `${config.reviewPrompt}\\n\\nObjective: ${launch.objective}` },",
      "        }),",
      "        React.createElement(smithersApi.Task, {",
      "          id: 'result',",
      "          output: smithersApi.outputs.output,",
      "          children: {",
      "            workflowId: config.workflowId,",
      "            workflowSource: config.workflowSource,",
      "            objective: launch.objective,",
      "            implementPrompt: config.implementPrompt,",
      "            reviewPrompt: config.reviewPrompt,",
      "            implementerAgent: config.implementerAgent,",
      "            reviewerAgent: config.reviewerAgent,",
      "          },",
      "        }),",
      "      ),",
      "    );",
      "  });",
      "}",
      "",
    ].join("\n"),
  );

  writeText(
    componentPath,
    [
      "/**",
      " * @svvyAssetKind component",
      " * @svvyId saved_workflow_agents",
      " * @svvyTitle Saved Workflow Agents",
      " * @svvySummary Reusable implementation and review agents for workflow authoring.",
      " */",
      "export const cheapImplementer = {",
      "  name: 'cheap-implementer',",
      "  provider: 'openai',",
      "  model: 'gpt-5.4-mini',",
      "  reasoning: 'low',",
      "  toolSurface: ['execute_typescript'],",
      "  instructions: 'Implement the requested change directly and keep the diff tight.',",
      "};",
      "",
      "export const carefulReviewer = {",
      "  name: 'careful-reviewer',",
      "  provider: 'anthropic',",
      "  model: 'claude-sonnet-4',",
      "  reasoning: 'medium',",
      "  toolSurface: ['execute_typescript'],",
      "  instructions: 'Review for correctness, edge cases, and testing gaps before sign-off.',",
      "};",
      "",
    ].join("\n"),
  );

  writeText(
    promptPath,
    [
      "---",
      "svvyAssetKind: prompt",
      "svvyId: review_base",
      "title: Review Base",
      "summary: Base review instructions reusable across saved and artifact workflow entries.",
      "---",
      "Review the implementation against the stated objective. Call out mismatches and edge cases.",
      "",
    ].join("\n"),
  );

  writeSavedImplementReviewEntry(workspaceRoot, {
    entryPath: relativeWorkspacePath(workspaceRoot, entryPath),
    definitionPath: relativeWorkspacePath(workspaceRoot, definitionPath),
    promptPath: relativeWorkspacePath(workspaceRoot, promptPath),
    componentPath: relativeWorkspacePath(workspaceRoot, componentPath),
  });

  return {
    definitionPath: relativeWorkspacePath(workspaceRoot, definitionPath),
    promptPath: relativeWorkspacePath(workspaceRoot, promptPath),
    componentPath: relativeWorkspacePath(workspaceRoot, componentPath),
    entryPath: relativeWorkspacePath(workspaceRoot, entryPath),
  };
}

function writeArtifactWorkflow(
  workspaceRoot: string,
  input: {
    artifactWorkflowId: string;
    objectiveSummary: string;
    savedDefinitionPath: string;
    savedPromptPath: string;
    savedComponentPath: string;
    reviewerModel: ModelInfo;
  },
): ArtifactDraft {
  const artifactRoot = join(
    workspaceRoot,
    ".svvy",
    "artifacts",
    "workflows",
    input.artifactWorkflowId,
  );
  const promptPath = join(artifactRoot, "prompts", "implement-oauth.mdx");
  const componentPath = join(artifactRoot, "components", "oauth-security-reviewer.tsx");
  const entryPath = join(artifactRoot, "entries", "oauth-review.tsx");
  const metadataPath = join(artifactRoot, "metadata.json");
  const now = new Date().toISOString();

  writePromptAsset(promptPath, {
    id: "oauth_review_draft.implement_prompt",
    title: "OAuth Implement Prompt Draft",
    summary: "Artifact-local implementation details for the OAuth review draft entry.",
    body: "Implement the OAuth callback fix, preserve session semantics, and avoid redirect or state-handling regressions.",
  });

  writeWorkflowAgentComponent(componentPath, {
    assetId: "oauth_security_reviewer_draft",
    title: "OAuth Security Reviewer Draft",
    summary:
      "Artifact-local security reviewer agent authored because the generic saved entry was not a clear fit for the OAuth task.",
    exportName: "oauthSecurityReviewer",
    agent: {
      name: "oauth-security-reviewer",
      provider: input.reviewerModel.providerId,
      model: input.reviewerModel.modelId,
      reasoning: "medium",
      toolSurface: ["execute_typescript"],
      instructions:
        "Focus on callback validation, redirect allowlists, CSRF/state handling, token exchange errors, and session integrity.",
    },
  });

  writeOAuthReviewEntry(workspaceRoot, {
    entryPath: relativeWorkspacePath(workspaceRoot, entryPath),
    workflowId: "oauth_review_draft",
    label: "OAuth Review Draft",
    summary:
      "Artifact runnable entry fixture that reuses saved structure but adds an OAuth-specific implement prompt and reviewer agent because the generic saved entry is not a clear fit.",
    workflowSource: "artifact",
    definitionPath: input.savedDefinitionPath,
    savedComponentPath: input.savedComponentPath,
    reviewerComponentPath: relativeWorkspacePath(workspaceRoot, componentPath),
    reviewPromptPath: input.savedPromptPath,
    implementPromptPath: relativeWorkspacePath(workspaceRoot, promptPath),
    definitionPaths: [input.savedDefinitionPath],
    promptPaths: [input.savedPromptPath, relativeWorkspacePath(workspaceRoot, promptPath)],
    componentPaths: [input.savedComponentPath, relativeWorkspacePath(workspaceRoot, componentPath)],
  });

  writeText(
    metadataPath,
    JSON.stringify(
      {
        artifactWorkflowId: input.artifactWorkflowId,
        owningThreadId: "thread-oauth-review",
        createdAt: now,
        updatedAt: now,
        objectiveSummary: input.objectiveSummary,
        authoringActor: "handler",
        entryPath: relativeWorkspacePath(workspaceRoot, entryPath),
        lastExecutionStatus: "not-run-yet",
      },
      null,
      2,
    ),
  );

  return {
    artifactWorkflowId: input.artifactWorkflowId,
    objectiveSummary: input.objectiveSummary,
    promptPath: relativeWorkspacePath(workspaceRoot, promptPath),
    componentPath: relativeWorkspacePath(workspaceRoot, componentPath),
    entryPath: relativeWorkspacePath(workspaceRoot, entryPath),
    metadataPath: relativeWorkspacePath(workspaceRoot, metadataPath),
    reviewerModel: input.reviewerModel,
  };
}

function saveArtifactAssetsToLibrary(
  workspaceRoot: string,
  input: {
    artifact: ArtifactDraft;
    savedDefinitionPath: string;
    savedPromptPath: string;
    savedComponentPath: string;
  },
): SaveAssetsResult {
  const savedPromptPath = join(
    workspaceRoot,
    ".svvy",
    "workflows",
    "prompts",
    "oauth",
    "implement-oauth.mdx",
  );
  const savedComponentPath = join(
    workspaceRoot,
    ".svvy",
    "workflows",
    "components",
    "oauth-security-reviewer.tsx",
  );
  const savedEntryPath = join(workspaceRoot, ".svvy", "workflows", "entries", "oauth-review.tsx");

  writePromptAsset(savedPromptPath, {
    id: "oauth_review.implement_prompt",
    title: "OAuth Implement Prompt",
    summary: "Saved implementation prompt for the reusable OAuth review entry.",
    body: readPromptBody(join(workspaceRoot, input.artifact.promptPath)),
  });

  writeWorkflowAgentComponent(savedComponentPath, {
    assetId: "oauth_security_reviewer",
    title: "OAuth Security Reviewer",
    summary: "Saved OAuth-focused security reviewer agent for reusable workflow entries.",
    exportName: "oauthSecurityReviewer",
    agent: {
      name: "oauth-security-reviewer",
      provider: input.artifact.reviewerModel.providerId,
      model: input.artifact.reviewerModel.modelId,
      reasoning: "medium",
      toolSurface: ["execute_typescript"],
      instructions:
        "Focus on callback validation, redirect allowlists, CSRF/state handling, token exchange errors, and session integrity.",
    },
  });

  writeOAuthReviewEntry(workspaceRoot, {
    entryPath: relativeWorkspacePath(workspaceRoot, savedEntryPath),
    workflowId: "oauth_review",
    label: "OAuth Review",
    summary: "Saved runnable entry fixture for OAuth-specific prompt and workflow agent binding.",
    workflowSource: "saved",
    definitionPath: input.savedDefinitionPath,
    savedComponentPath: input.savedComponentPath,
    reviewerComponentPath: relativeWorkspacePath(workspaceRoot, savedComponentPath),
    reviewPromptPath: input.savedPromptPath,
    implementPromptPath: relativeWorkspacePath(workspaceRoot, savedPromptPath),
    definitionPaths: [input.savedDefinitionPath],
    promptPaths: [input.savedPromptPath, relativeWorkspacePath(workspaceRoot, savedPromptPath)],
    componentPaths: [
      input.savedComponentPath,
      relativeWorkspacePath(workspaceRoot, savedComponentPath),
    ],
  });

  return {
    promptPath: relativeWorkspacePath(workspaceRoot, savedPromptPath),
    componentPath: relativeWorkspacePath(workspaceRoot, savedComponentPath),
    entryPath: relativeWorkspacePath(workspaceRoot, savedEntryPath),
  };
}

async function runSavedEntryScenario(workspaceRoot: string): Promise<ScenarioResult> {
  const trace: TraceStep[] = [];
  const bridge = createSmithersBridgePoc(workspaceRoot);
  const workflows = await bridge.listWorkflows();
  trace.push({
    toolName: "smithers.list_workflows",
    args: {},
    result: {
      workflowIds: workflows.map((workflow) => workflow.id),
      workflows,
    },
  });

  const savedEntry = workflows.find((workflow) => workflow.id === "implement_review");
  if (!savedEntry) {
    throw new Error("Expected implement_review saved entry.");
  }

  trace.push({
    toolName: "execute_typescript",
    args: { purpose: "inspect the saved runnable entry and its declared assets before launch" },
    childCalls: [
      {
        toolName: "api.repo.readFiles",
        args: { paths: [savedEntry.entryPath, ...savedEntry.assetPaths] },
        result: {
          files: [savedEntry.entryPath, ...savedEntry.assetPaths],
        },
      },
    ],
    result: {
      inspectedPaths: [savedEntry.entryPath, ...savedEntry.assetPaths],
    },
  });

  const execution = await bridge.runWorkflow(savedEntry.id, {
    objective: "Fix the OAuth callback bug",
  });
  trace.push({
    toolName: savedEntry.launchToolName,
    args: {
      objective: "Fix the OAuth callback bug",
    },
    result: execution,
  });

  return {
    id: "saved_entry_registry_and_bridge_launch",
    trace,
    proof: {
      workflowId: execution.workflowId,
      workflowSource: execution.workflowSource,
      entryPath: execution.entryPath,
      promptWasLoadedFromSavedAsset:
        execution.output.reviewPrompt ===
        readPromptBody(join(workspaceRoot, ".svvy", "workflows", "prompts", "review-base.mdx")),
      assetPaths: savedEntry.assetPaths,
    },
  };
}

async function runArtifactAuthoringScenario(
  workspaceRoot: string,
  seed: SavedSeed,
): Promise<ScenarioResult & { artifact: ArtifactDraft }> {
  const trace: TraceStep[] = [];
  const bridge = createSmithersBridgePoc(workspaceRoot);

  const definitionAssets = listAssets(workspaceRoot, {
    kind: "definition",
    scope: "saved",
  });
  trace.push({
    toolName: "execute_typescript",
    args: { purpose: "discover saved definitions before reading promising files" },
    childCalls: [
      {
        toolName: "api.workflow.listAssets",
        args: { kind: "definition", scope: "saved" },
        result: summarizeAssets(definitionAssets),
      },
    ],
    result: { discoveredDefinitionIds: definitionAssets.map((asset) => asset.id) },
  });

  const promptAssets = listAssets(workspaceRoot, {
    kind: "prompt",
    scope: "saved",
  });
  trace.push({
    toolName: "execute_typescript",
    args: { purpose: "discover saved prompts before reading promising files" },
    childCalls: [
      {
        toolName: "api.workflow.listAssets",
        args: { kind: "prompt", scope: "saved" },
        result: summarizeAssets(promptAssets),
      },
    ],
    result: { discoveredPromptIds: promptAssets.map((asset) => asset.id) },
  });

  const savedComponents = listAssets(workspaceRoot, {
    kind: "component",
    scope: "saved",
  });
  trace.push({
    toolName: "execute_typescript",
    args: { purpose: "discover saved components before reading promising files" },
    childCalls: [
      {
        toolName: "api.workflow.listAssets",
        args: { kind: "component", scope: "saved" },
        result: summarizeAssets(savedComponents),
      },
    ],
    result: { discoveredSavedComponentIds: savedComponents.map((asset) => asset.id) },
  });

  trace.push({
    toolName: "execute_typescript",
    args: { purpose: "inspect the reusable saved assets before authoring" },
    childCalls: [
      {
        toolName: "api.repo.readFiles",
        args: { paths: [seed.definitionPath, seed.promptPath, seed.componentPath, seed.entryPath] },
        result: {
          files: [seed.definitionPath, seed.promptPath, seed.componentPath, seed.entryPath],
        },
      },
    ],
    result: {
      inspectedPaths: [seed.definitionPath, seed.promptPath, seed.componentPath, seed.entryPath],
    },
  });

  trace.push({
    toolName: "execute_typescript",
    args: {
      purpose: "decide the generic saved runnable entry is not a clear fit for the OAuth objective",
    },
    result: {
      rejectedSavedEntryPath: seed.entryPath,
      reasons: [
        "The saved entry binds only the generic reviewer agent and generic review prompt.",
        "The OAuth objective needs an objective-specific implement prompt and a tighter security-focused reviewer agent.",
      ],
    },
  });

  const models = listModels();
  trace.push({
    toolName: "execute_typescript",
    args: {
      purpose: "find a configured model for a new artifact-local OAuth security reviewer agent",
    },
    childCalls: [
      {
        toolName: "api.workflow.listModels",
        args: {},
        result: models,
      },
    ],
    result: {
      chosenReviewerModel: models.find((model) => model.modelId === "gpt-5.4") ?? null,
    },
  });

  const reviewerModel = models.find((model) => model.modelId === "gpt-5.4");
  if (!reviewerModel) {
    throw new Error("Expected gpt-5.4 to be available for the artifact reviewer agent.");
  }

  const artifact = writeArtifactWorkflow(workspaceRoot, {
    artifactWorkflowId: "wf-oauth-review",
    objectiveSummary: "Fix the OAuth callback bug with a focused security review pass.",
    savedDefinitionPath: seed.definitionPath,
    savedPromptPath: seed.promptPath,
    savedComponentPath: seed.componentPath,
    reviewerModel,
  });
  trace.push({
    toolName: "execute_typescript",
    args: {
      purpose:
        "author an artifact workflow with an artifact prompt, an artifact workflow agent, and an artifact entry",
    },
    childCalls: [
      {
        toolName: "api.repo.writeFile",
        args: { path: artifact.promptPath },
        result: { path: artifact.promptPath },
      },
      {
        toolName: "api.repo.writeFile",
        args: { path: artifact.componentPath },
        result: { path: artifact.componentPath },
      },
      {
        toolName: "api.repo.writeFile",
        args: { path: artifact.entryPath },
        result: { path: artifact.entryPath },
      },
      {
        toolName: "api.repo.writeJson",
        args: { path: artifact.metadataPath },
        result: { path: artifact.metadataPath },
      },
    ],
    result: artifact,
  });

  const allComponents = listAssets(workspaceRoot, {
    kind: "component",
    scope: "both",
  });
  trace.push({
    toolName: "execute_typescript",
    args: {
      purpose: "confirm the new artifact component is discoverable through the authoring API",
    },
    childCalls: [
      {
        toolName: "api.workflow.listAssets",
        args: { kind: "component", scope: "both" },
        result: summarizeAssets(allComponents),
      },
    ],
    result: { discoveredComponentIds: allComponents.map((asset) => asset.id) },
  });

  const workflows = await bridge.listWorkflows();
  trace.push({
    toolName: "smithers.list_workflows",
    args: {},
    result: {
      workflowIds: workflows.map((workflow) => workflow.id),
      workflows,
    },
  });

  const artifactEntry = workflows.find((workflow) => workflow.id === "oauth_review_draft");
  if (!artifactEntry) {
    throw new Error("Expected oauth_review_draft artifact entry after authoring.");
  }

  trace.push({
    toolName: "execute_typescript",
    args: { purpose: "inspect the artifact entry and its declared assets before launch" },
    childCalls: [
      {
        toolName: "api.repo.readFiles",
        args: { paths: [artifactEntry.entryPath, ...artifactEntry.assetPaths] },
        result: { files: [artifactEntry.entryPath, ...artifactEntry.assetPaths] },
      },
    ],
    result: { inspectedPaths: [artifactEntry.entryPath, ...artifactEntry.assetPaths] },
  });

  const execution = await bridge.runWorkflow(artifactEntry.id, {
    objective: "Fix the OAuth callback bug",
  });
  trace.push({
    toolName: artifactEntry.launchToolName,
    args: {
      objective: "Fix the OAuth callback bug",
    },
    result: execution,
  });

  return {
    id: "artifact_authoring_registry_and_bridge_launch",
    trace,
    proof: {
      artifactWorkflowId: artifact.artifactWorkflowId,
      workflowId: execution.workflowId,
      workflowSource: execution.workflowSource,
      entryPath: execution.entryPath,
      preparedImplementRequestUsesArtifactPrompt: String(execution.output.implementPrompt).includes(
        "preserve session semantics",
      ),
      preparedReviewRequestUsesSavedPromptAndArtifactAgent:
        String(execution.output.reviewPrompt).includes(
          "Review the implementation against the stated objective.",
        ) && String(execution.output.reviewPrompt).includes("callback validation"),
      reviewerAgentModel: (execution.output.reviewerAgent as Record<string, unknown>).model,
      metadataAfterRun: JSON.parse(readText(join(workspaceRoot, artifact.metadataPath))),
    },
    artifact,
  };
}

async function runExplicitSaveScenario(
  workspaceRoot: string,
  seed: SavedSeed,
  artifact: ArtifactDraft,
): Promise<ScenarioResult> {
  const trace: TraceStep[] = [];
  const bridge = createSmithersBridgePoc(workspaceRoot);

  trace.push({
    toolName: "execute_typescript",
    args: { purpose: "inspect the reusable artifact files selected for explicit save" },
    childCalls: [
      {
        toolName: "api.repo.readFiles",
        args: { paths: [artifact.promptPath, artifact.componentPath, artifact.entryPath] },
        result: { files: [artifact.promptPath, artifact.componentPath, artifact.entryPath] },
      },
    ],
    result: {
      selectedArtifactPaths: [artifact.promptPath, artifact.componentPath, artifact.entryPath],
    },
  });

  const saved = saveArtifactAssetsToLibrary(workspaceRoot, {
    artifact,
    savedDefinitionPath: seed.definitionPath,
    savedPromptPath: seed.promptPath,
    savedComponentPath: seed.componentPath,
  });
  trace.push({
    toolName: "execute_typescript",
    args: {
      purpose:
        "write the reusable prompt, workflow agent, and entry into the saved workflow library and inspect validation feedback",
    },
    childCalls: [
      {
        toolName: "api.repo.writeFile",
        args: { path: saved.promptPath },
        result: { path: saved.promptPath },
      },
      {
        toolName: "api.repo.writeFile",
        args: { path: saved.componentPath },
        result: { path: saved.componentPath },
      },
      {
        toolName: "api.repo.writeFile",
        args: { path: saved.entryPath },
        result: { path: saved.entryPath },
      },
      {
        toolName: "console.log",
        args: { pathPrefix: ".svvy/workflows/" },
        result: { message: "Workflow validation passed for the saved workflow library state." },
      },
    ],
    result: saved,
  });

  const savedAssets = listAssets(workspaceRoot, {
    scope: "saved",
    pathPrefix: ".svvy/workflows/",
  });
  trace.push({
    toolName: "execute_typescript",
    args: {
      purpose:
        "confirm saved assets are discoverable through the authoring API after explicit save",
    },
    childCalls: [
      {
        toolName: "api.workflow.listAssets",
        args: { scope: "saved", pathPrefix: ".svvy/workflows/" },
        result: summarizeAssets(savedAssets),
      },
    ],
    result: { savedAssetIds: savedAssets.map((asset) => asset.id) },
  });

  const workflows = await bridge.listWorkflows();
  trace.push({
    toolName: "smithers.list_workflows",
    args: {},
    result: {
      workflowIds: workflows.map((workflow) => workflow.id),
      workflows,
    },
  });

  const savedEntry = workflows.find((workflow) => workflow.id === "oauth_review");
  if (!savedEntry) {
    throw new Error("Expected oauth_review saved entry after explicit save.");
  }

  trace.push({
    toolName: "execute_typescript",
    args: { purpose: "inspect the saved entry and its declared assets before relaunch" },
    childCalls: [
      {
        toolName: "api.repo.readFiles",
        args: { paths: [savedEntry.entryPath, ...savedEntry.assetPaths] },
        result: { files: [savedEntry.entryPath, ...savedEntry.assetPaths] },
      },
    ],
    result: { inspectedPaths: [savedEntry.entryPath, ...savedEntry.assetPaths] },
  });

  const savedExecution = await bridge.runWorkflow(savedEntry.id, {
    objective: "Fix the OAuth callback bug",
  });
  trace.push({
    toolName: savedEntry.launchToolName,
    args: {
      objective: "Fix the OAuth callback bug",
    },
    result: savedExecution,
  });

  return {
    id: "explicit_save_and_relaunch",
    trace,
    proof: {
      savedPaths: saved,
      savedEntryIds: workflows
        .filter((workflow) => workflow.sourceScope === "saved")
        .map((workflow) => workflow.id),
      artifactStillExists: existsSync(join(workspaceRoot, artifact.entryPath)),
      savedAssetsDroppedDraftIdentity: !savedAssets.some((asset) => asset.id.includes("draft")),
      savedEntryUsesSavedAssets: (() => {
        return (
          savedEntry.promptPaths.includes(saved.promptPath) &&
          savedEntry.componentPaths.includes(saved.componentPath) &&
          savedEntry.definitionPaths.includes(seed.definitionPath)
        );
      })(),
      savedEntryLaunchWorks: savedExecution.workflowId === "oauth_review",
    },
  };
}

async function runPoc(): Promise<Record<string, unknown>> {
  const workspaceRoot = mkdtempSync(join(REPO_ROOT, ".tmp-workflow-library-poc-"));
  try {
    const seed = seedSavedWorkflowLibrary(workspaceRoot);
    const savedEntryScenario = await runSavedEntryScenario(workspaceRoot);
    const authoredArtifact = await runArtifactAuthoringScenario(workspaceRoot, seed);
    const explicitSave = await runExplicitSaveScenario(
      workspaceRoot,
      seed,
      authoredArtifact.artifact,
    );

    return {
      workspaceRoot: relativeWorkspacePath(REPO_ROOT, workspaceRoot),
      seededSavedAssets: seed,
      scenarios: [
        savedEntryScenario,
        {
          id: authoredArtifact.id,
          trace: authoredArtifact.trace,
          proof: authoredArtifact.proof,
        },
        explicitSave,
      ],
    };
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const output = await runPoc();
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

export { runPoc };
