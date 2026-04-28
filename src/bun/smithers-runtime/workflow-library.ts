import { getModels, getProviders } from "@mariozechner/pi-ai";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import * as ts from "typescript";
import { z } from "zod";
import { getProviderEnvVar, resolveAuthState } from "../auth-store";
import { loadRunnableWorkflowEntryAtPath, loadRunnableWorkflowRegistry } from "./workflow-registry";
import type {
  WorkspaceSavedWorkflowLibraryDiagnostic,
  WorkspaceSavedWorkflowLibraryItem,
  WorkspaceSavedWorkflowLibraryItemKind,
  WorkspaceSavedWorkflowLibraryReadModel,
} from "../../shared/workspace-contract";

export type WorkflowAssetKind = "definition" | "prompt" | "component";
export type WorkflowAssetScope = "saved" | "artifact";

export type WorkflowAssetMetadata = {
  id: string;
  kind: WorkflowAssetKind;
  title: string;
  summary: string;
  path: string;
  scope: WorkflowAssetScope;
};

export type WorkflowAssetFilter = {
  kind?: WorkflowAssetKind;
  pathPrefix?: string;
  scope?: WorkflowAssetScope | "both";
};

export type WorkflowModelInfo = {
  providerId: string;
  modelId: string;
  authAvailable: boolean;
  authSource: string;
  capabilityFlags: string[];
};

export type WorkflowValidationDiagnostic = {
  severity: "error" | "warning";
  message: string;
  path?: string;
  line?: number;
  column?: number;
  code?: string;
};

export type WorkflowWriteValidationResult = {
  checked: boolean;
  ok: boolean;
  path: string;
  diagnostics: WorkflowValidationDiagnostic[];
};

export type WorkflowLibrary = {
  listAssets(input?: WorkflowAssetFilter): WorkflowAssetMetadata[];
  listModels(): WorkflowModelInfo[];
  readSavedWorkflowLibrary(): Promise<WorkspaceSavedWorkflowLibraryReadModel>;
  deleteSavedWorkflowLibraryItem(path: string): Promise<WorkspaceSavedWorkflowLibraryReadModel>;
  validateSavedWorkflowWrite(path: string): Promise<WorkflowWriteValidationResult | null>;
};

type WorkflowLibraryDependencies = {
  getProviders?: typeof getProviders;
  getModels?: typeof getModels;
  resolveAuthState?: typeof resolveAuthState;
  getProviderEnvVar?: typeof getProviderEnvVar;
};

type ValidationWorkspace = {
  root: string;
  cleanup: () => void;
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

function parseAssetMetadata(
  workspaceRoot: string,
  path: string,
  scope: WorkflowAssetScope,
): WorkflowAssetMetadata {
  const text = readFileSync(path, "utf8");
  if (extname(path) === ".mdx") {
    const frontmatter = parseFrontmatter(text);
    return {
      id: String(frontmatter.svvyId ?? relativeWorkspacePath(workspaceRoot, path)),
      kind: "prompt",
      title: String(frontmatter.title ?? relativeWorkspacePath(workspaceRoot, path)),
      summary: String(frontmatter.summary ?? ""),
      path: relativeWorkspacePath(workspaceRoot, path),
      scope,
    };
  }

  const header = text.match(/\/\*\*[\s\S]*?\*\//)?.[0] ?? "";
  return {
    id: readTsJsdocTag(header, "svvyId") ?? relativeWorkspacePath(workspaceRoot, path),
    kind: (readTsJsdocTag(header, "svvyAssetKind") as WorkflowAssetKind | undefined) ?? "component",
    title: readTsJsdocTag(header, "svvyTitle") ?? relativeWorkspacePath(workspaceRoot, path),
    summary: readTsJsdocTag(header, "svvySummary") ?? "",
    path: relativeWorkspacePath(workspaceRoot, path),
    scope,
  };
}

function listAssetFiles(workspaceRoot: string, scope: WorkflowAssetScope): string[] {
  const root =
    scope === "saved"
      ? join(workspaceRoot, ".svvy", "workflows")
      : join(workspaceRoot, ".svvy", "artifacts", "workflows");
  return walkFiles(root).filter((path) =>
    ["/definitions/", "/prompts/", "/components/"].some((segment) => path.includes(segment)),
  );
}

function listSavedEntryFiles(workspaceRoot: string): string[] {
  return walkFiles(join(workspaceRoot, ".svvy", "workflows", "entries"))
    .filter((path) => [".ts", ".tsx"].includes(extname(path)))
    .map((path) => relativeWorkspacePath(workspaceRoot, path))
    .toSorted();
}

function readSourcePreview(workspaceRoot: string, path: string): string | null {
  const absolutePath = join(workspaceRoot, path);
  if (!existsSync(absolutePath)) {
    return null;
  }
  const source = readFileSync(absolutePath, "utf8");
  const maxLength = 12_000;
  return source.length > maxLength ? `${source.slice(0, maxLength)}\n...` : source;
}

export function listWorkflowAssets(
  workspaceRoot: string,
  input: WorkflowAssetFilter = {},
): WorkflowAssetMetadata[] {
  const scopes =
    input.scope === "artifact"
      ? (["artifact"] as const)
      : input.scope === "both"
        ? (["saved", "artifact"] as const)
        : (["saved"] as const);

  return scopes
    .flatMap((scope) =>
      listAssetFiles(workspaceRoot, scope)
        .filter((path) => [".ts", ".tsx", ".mdx"].includes(extname(path)))
        .map((path) => parseAssetMetadata(workspaceRoot, path, scope)),
    )
    .filter((asset) => (input.kind ? asset.kind === input.kind : true))
    .filter((asset) => (input.pathPrefix ? asset.path.startsWith(input.pathPrefix) : true))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

function readCapabilityFlags(model: {
  reasoning: boolean;
  input: string[];
  api: string;
}): string[] {
  return [
    model.reasoning ? "reasoning" : null,
    model.input.includes("image") ? "vision" : null,
    [
      "anthropic-messages",
      "google-generative-ai",
      "mistral-conversations",
      "openai-completions",
      "openai-responses",
    ].includes(model.api)
      ? "tool-calling"
      : null,
  ].filter((flag): flag is string => Boolean(flag));
}

export function listWorkflowModels(
  dependencies: WorkflowLibraryDependencies = {},
): WorkflowModelInfo[] {
  const resolveProviders = dependencies.getProviders ?? getProviders;
  const resolveModels = dependencies.getModels ?? getModels;
  const resolveAuth = dependencies.resolveAuthState ?? resolveAuthState;
  const resolveEnvVar = dependencies.getProviderEnvVar ?? getProviderEnvVar;

  return resolveProviders()
    .flatMap((providerId) =>
      resolveModels(providerId).map((model) => {
        const authState = resolveAuth(providerId);
        const authSource =
          authState.keyType === "none"
            ? `missing:${resolveEnvVar(providerId) ?? providerId}`
            : authState.keyType;
        return {
          providerId,
          modelId: model.id,
          authAvailable: authState.connected,
          authSource,
          capabilityFlags: readCapabilityFlags(model),
        };
      }),
    )
    .toSorted(
      (left, right) =>
        left.providerId.localeCompare(right.providerId) ||
        left.modelId.localeCompare(right.modelId),
    );
}

function createValidationWorkspace(workspaceRoot: string): ValidationWorkspace {
  const root = mkdtempSync(join(tmpdir(), "svvy-workflow-validation-"));
  for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (entry.name === ".svvy") {
      continue;
    }
    symlinkSync(join(workspaceRoot, entry.name), join(root, entry.name));
  }

  mkdirSync(join(root, ".svvy"), { recursive: true });
  const savedLibraryRoot = join(workspaceRoot, ".svvy", "workflows");
  if (existsSync(savedLibraryRoot)) {
    cpSync(savedLibraryRoot, join(root, ".svvy", "workflows"), { recursive: true });
  } else {
    mkdirSync(join(root, ".svvy", "workflows"), { recursive: true });
  }

  return {
    root,
    cleanup: () => {
      rmSync(root, { force: true, recursive: true });
    },
  };
}

function validatePromptAsset(workspaceRoot: string, path: string): WorkflowValidationDiagnostic[] {
  const text = readFileSync(join(workspaceRoot, path), "utf8");
  const frontmatter = parseFrontmatter(text);
  const diagnostics: WorkflowValidationDiagnostic[] = [];
  if (frontmatter.svvyAssetKind !== "prompt") {
    diagnostics.push({
      severity: "error",
      path,
      line: 1,
      message: "Prompt assets must declare `svvyAssetKind: prompt` in frontmatter.",
    });
  }
  for (const field of ["svvyId", "title", "summary"] as const) {
    if (typeof frontmatter[field] !== "string" || frontmatter[field].trim().length === 0) {
      diagnostics.push({
        severity: "error",
        path,
        line: 1,
        message: `Prompt assets must declare a non-empty \`${field}\` frontmatter field.`,
      });
    }
  }
  return diagnostics;
}

function validateSourceAssetHeader(
  workspaceRoot: string,
  path: string,
  expectedKind: WorkflowAssetKind,
): WorkflowValidationDiagnostic[] {
  const text = readFileSync(join(workspaceRoot, path), "utf8");
  const header = text.match(/\/\*\*[\s\S]*?\*\//)?.[0] ?? "";
  const diagnostics: WorkflowValidationDiagnostic[] = [];
  const actualKind = readTsJsdocTag(header, "svvyAssetKind");
  if (actualKind !== expectedKind) {
    diagnostics.push({
      severity: "error",
      path,
      line: 1,
      message: `Expected @svvyAssetKind ${expectedKind} in the leading JSDoc header.`,
    });
  }
  for (const tag of ["svvyId", "svvyTitle", "svvySummary"] as const) {
    if (!readTsJsdocTag(header, tag)) {
      diagnostics.push({
        severity: "error",
        path,
        line: 1,
        message: `Expected @${tag} in the leading JSDoc header.`,
      });
    }
  }
  return diagnostics;
}

function mapTypecheckDiagnostic(
  diagnostic: ts.Diagnostic,
  validationRoot: string,
): WorkflowValidationDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const severity = diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "error";
  const fileName = diagnostic.file?.fileName;
  let path: string | undefined;
  let line: number | undefined;
  let column: number | undefined;
  if (fileName) {
    const relativeToValidation = relative(validationRoot, fileName).replace(/\\/g, "/");
    path = relativeToValidation.startsWith("..") ? basename(fileName) : relativeToValidation;
  }
  if (diagnostic.file && diagnostic.start !== undefined) {
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    line = position.line + 1;
    column = position.character + 1;
  }
  return {
    severity,
    path,
    line,
    column,
    code: diagnostic.code ? String(diagnostic.code) : undefined,
    message,
  };
}

function typecheckTypescriptAssets(
  validationRoot: string,
  assetPaths: string[],
): WorkflowValidationDiagnostic[] {
  if (assetPaths.length === 0) {
    return [];
  }

  const configPath = ts.findConfigFile(validationRoot, ts.sys.fileExists, "tsconfig.json");
  let options: ts.CompilerOptions = {
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true,
  };
  let projectReferences: readonly ts.ProjectReference[] | undefined;
  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      dirname(configPath),
      { noEmit: true },
      configPath,
    );
    options = {
      ...parsed.options,
      noEmit: true,
    };
    projectReferences = parsed.projectReferences;
  }

  const program = ts.createProgram({
    rootNames: assetPaths.map((path) => join(validationRoot, path)),
    options,
    projectReferences,
  });
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => mapTypecheckDiagnostic(diagnostic, validationRoot))
    .filter((diagnostic) => diagnostic.severity === "error");
}

async function validateSavedEntries(
  validationRoot: string,
  entryPaths: string[],
): Promise<WorkflowValidationDiagnostic[]> {
  const diagnostics: WorkflowValidationDiagnostic[] = [];

  for (const entryPath of entryPaths) {
    try {
      const entry = await loadRunnableWorkflowEntryAtPath(validationRoot, entryPath);
      if (!entry.assetPaths.every((path) => path.startsWith(".svvy/workflows/"))) {
        diagnostics.push({
          severity: "error",
          path: entryPath,
          message:
            "Saved runnable entries may only declare grouped asset refs under `.svvy/workflows/...`.",
        });
      }
    } catch (error) {
      diagnostics.push({
        severity: "error",
        path: entryPath,
        message: error instanceof Error ? error.message : "Saved runnable entry validation failed.",
      });
    }
  }

  return diagnostics;
}

function dedupeDiagnostics(
  diagnostics: WorkflowValidationDiagnostic[],
): WorkflowValidationDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function validateSavedWorkflowLibrary(
  workspaceRoot: string,
  changedPath: string,
): Promise<WorkflowWriteValidationResult | null> {
  const normalizedPath = relativeWorkspacePath(workspaceRoot, join(workspaceRoot, changedPath));
  if (!normalizedPath.startsWith(".svvy/workflows/")) {
    return null;
  }

  const diagnostics: WorkflowValidationDiagnostic[] = [];
  const promptPaths = listWorkflowAssets(workspaceRoot, { kind: "prompt", scope: "saved" }).map(
    (asset) => asset.path,
  );
  const definitionPaths = listWorkflowAssets(workspaceRoot, {
    kind: "definition",
    scope: "saved",
  }).map((asset) => asset.path);
  const componentPaths = listWorkflowAssets(workspaceRoot, {
    kind: "component",
    scope: "saved",
  }).map((asset) => asset.path);
  const entryPaths = listSavedEntryFiles(workspaceRoot);

  for (const path of promptPaths) {
    diagnostics.push(...validatePromptAsset(workspaceRoot, path));
  }
  for (const path of definitionPaths) {
    diagnostics.push(...validateSourceAssetHeader(workspaceRoot, path, "definition"));
  }
  for (const path of componentPaths) {
    diagnostics.push(...validateSourceAssetHeader(workspaceRoot, path, "component"));
  }

  const validationWorkspace = createValidationWorkspace(workspaceRoot);
  try {
    diagnostics.push(
      ...typecheckTypescriptAssets(validationWorkspace.root, [
        ...definitionPaths,
        ...componentPaths,
        ...entryPaths,
      ]),
    );
    diagnostics.push(...(await validateSavedEntries(validationWorkspace.root, entryPaths)));
  } finally {
    validationWorkspace.cleanup();
  }

  const dedupedDiagnostics = dedupeDiagnostics(diagnostics);
  return {
    checked: true,
    ok: !dedupedDiagnostics.some((diagnostic) => diagnostic.severity === "error"),
    path: normalizedPath,
    diagnostics: dedupedDiagnostics,
  };
}

function mapDiagnostic(
  diagnostic: WorkflowValidationDiagnostic,
): WorkspaceSavedWorkflowLibraryDiagnostic {
  return {
    severity: diagnostic.severity,
    message: diagnostic.message,
    path: diagnostic.path,
    line: diagnostic.line,
    column: diagnostic.column,
    code: diagnostic.code,
  };
}

function validationStatus(
  diagnostics: WorkspaceSavedWorkflowLibraryDiagnostic[],
): WorkspaceSavedWorkflowLibraryItem["validationStatus"] {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "error";
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    return "warning";
  }
  return "valid";
}

function diagnosticsForPath(
  diagnostics: WorkspaceSavedWorkflowLibraryDiagnostic[],
  path: string,
): WorkspaceSavedWorkflowLibraryDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.path === path);
}

function schemaPreview(schema: z.ZodTypeAny | undefined): string | undefined {
  if (!schema) {
    return undefined;
  }
  return JSON.stringify(z.toJSONSchema(schema as any, { io: "input" }), null, 2);
}

async function readSavedWorkflowLibrary(
  workspaceRoot: string,
  settings: { preferredExternalEditor: string; customExternalEditorCommand: string },
): Promise<WorkspaceSavedWorkflowLibraryReadModel> {
  const savedValidation = await validateSavedWorkflowLibrary(workspaceRoot, ".svvy/workflows");
  const diagnostics = (savedValidation?.diagnostics ?? []).map(mapDiagnostic);
  const items: WorkspaceSavedWorkflowLibraryItem[] = [];

  for (const asset of listWorkflowAssets(workspaceRoot, { scope: "saved" })) {
    const itemDiagnostics = diagnosticsForPath(diagnostics, asset.path);
    items.push({
      id: `asset:${asset.path}`,
      kind: asset.kind,
      scope: "saved",
      title: asset.title,
      summary: asset.summary,
      path: asset.path,
      sourcePath: asset.path,
      sourcePreview: readSourcePreview(workspaceRoot, asset.path),
      validationStatus: validationStatus(itemDiagnostics),
      diagnostics: itemDiagnostics,
    });
  }

  try {
    const entries = await loadRunnableWorkflowRegistry(workspaceRoot);
    for (const entry of entries) {
      const itemDiagnostics = diagnosticsForPath(diagnostics, entry.entryPath);
      items.push({
        id: `entry:${entry.entryPath}`,
        kind: "entry",
        scope: entry.sourceScope,
        title: entry.label,
        label: entry.label,
        summary: entry.summary,
        path: entry.entryPath,
        sourcePath: entry.entryPath,
        sourcePreview: readSourcePreview(workspaceRoot, entry.entryPath),
        validationStatus:
          entry.sourceScope === "saved" ? validationStatus(itemDiagnostics) : "unknown",
        diagnostics: entry.sourceScope === "saved" ? itemDiagnostics : [],
        workflowId: entry.workflowId,
        productKind: entry.productKind,
        launchSchema: schemaPreview(entry.launchSchema),
        resultSchema: schemaPreview(entry.resultSchema),
        groupedAssetRefs: {
          definitions: entry.definitionPaths,
          prompts: entry.promptPaths,
          components: entry.componentPaths,
        },
        assetPaths: entry.assetPaths,
      });
    }
  } catch (error) {
    diagnostics.push({
      severity: "error",
      message:
        error instanceof Error ? error.message : "Unable to load runnable workflow registry.",
    });
  }

  const artifactRoot = join(workspaceRoot, ".svvy", "artifacts", "workflows");
  for (const artifactPath of existsSync(artifactRoot)
    ? readdirSync(artifactRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(artifactRoot, entry.name))
        .toSorted()
    : []) {
    const path = relativeWorkspacePath(workspaceRoot, artifactPath);
    const artifactWorkflowId = basename(artifactPath);
    const files = walkFiles(artifactPath).filter((file) =>
      [".ts", ".tsx", ".mdx", ".json"].includes(extname(file)),
    );
    const entryCount = files.filter((file) => file.includes("/entries/")).length;
    const assetCount = files.filter((file) =>
      ["/definitions/", "/prompts/", "/components/"].some((segment) => file.includes(segment)),
    ).length;
    items.push({
      id: `artifact-workflow:${artifactWorkflowId}`,
      kind: "artifact-workflow",
      scope: "artifact",
      title: artifactWorkflowId,
      summary: `${entryCount} entries, ${assetCount} assets`,
      path,
      sourcePath: path,
      sourcePreview: readSourcePreview(workspaceRoot, `${path}/metadata.json`),
      validationStatus: "unknown",
      diagnostics: [],
      artifactWorkflowId,
      entryCount,
      assetCount,
    });
  }

  const counts = {
    definition: 0,
    prompt: 0,
    component: 0,
    entry: 0,
    "artifact-workflow": 0,
  } satisfies Record<WorkspaceSavedWorkflowLibraryItemKind, number>;
  for (const item of items) {
    counts[item.kind] += 1;
  }

  return {
    rootPath: ".svvy/workflows",
    artifactRootPath: ".svvy/artifacts/workflows",
    items: items.toSorted(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.scope.localeCompare(right.scope) ||
        left.path.localeCompare(right.path),
    ),
    counts,
    diagnostics,
    preferredExternalEditor: settings.preferredExternalEditor as never,
    customExternalEditorCommand: settings.customExternalEditorCommand,
    updatedAt: new Date().toISOString(),
  };
}

function assertSavedWorkflowDeletionPath(workspaceRoot: string, path: string): string {
  const normalizedPath = relativeWorkspacePath(workspaceRoot, join(workspaceRoot, path));
  if (
    !normalizedPath.startsWith(".svvy/workflows/definitions/") &&
    !normalizedPath.startsWith(".svvy/workflows/prompts/") &&
    !normalizedPath.startsWith(".svvy/workflows/components/") &&
    !normalizedPath.startsWith(".svvy/workflows/entries/")
  ) {
    throw new Error(
      "Only saved workflow definitions, prompts, components, and entries can be deleted.",
    );
  }
  return normalizedPath;
}

export function createWorkflowLibrary(
  workspaceRoot: string,
  dependencies: WorkflowLibraryDependencies = {},
): WorkflowLibrary {
  return {
    listAssets: (input) => listWorkflowAssets(workspaceRoot, input),
    listModels: () => listWorkflowModels(dependencies),
    readSavedWorkflowLibrary: async () =>
      await readSavedWorkflowLibrary(workspaceRoot, {
        preferredExternalEditor: "system",
        customExternalEditorCommand: "",
      }),
    deleteSavedWorkflowLibraryItem: async (path) => {
      const normalizedPath = assertSavedWorkflowDeletionPath(workspaceRoot, path);
      rmSync(join(workspaceRoot, normalizedPath), { force: true, recursive: true });
      return await readSavedWorkflowLibrary(workspaceRoot, {
        preferredExternalEditor: "system",
        customExternalEditorCommand: "",
      });
    },
    validateSavedWorkflowWrite: async (path) =>
      await validateSavedWorkflowLibrary(workspaceRoot, path),
  };
}

export async function readSavedWorkflowLibraryReadModel(
  workspaceRoot: string,
  settings: { preferredExternalEditor: string; customExternalEditorCommand: string },
): Promise<WorkspaceSavedWorkflowLibraryReadModel> {
  return await readSavedWorkflowLibrary(workspaceRoot, settings);
}

export async function deleteSavedWorkflowLibraryPath(
  workspaceRoot: string,
  path: string,
  settings: { preferredExternalEditor: string; customExternalEditorCommand: string },
): Promise<WorkspaceSavedWorkflowLibraryReadModel> {
  const normalizedPath = assertSavedWorkflowDeletionPath(workspaceRoot, path);
  rmSync(join(workspaceRoot, normalizedPath), { force: true, recursive: true });
  return await readSavedWorkflowLibrary(workspaceRoot, settings);
}
