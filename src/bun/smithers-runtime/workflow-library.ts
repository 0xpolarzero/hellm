import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";
import * as Exit from "effect/Exit";
import ts from "typescript";
import { BUILTIN_EXTENSIONS, resolveActorExtensionState } from "@svvy/extensions";
import type { AgentSettingsStore } from "../agent-settings-store";
import type { ExtensionEnvSecretStore } from "../extension-env-secret-store";
import {
  resolveExtensionRecord,
  runSvvyxExtensionsCommand,
  type ExtensionDependencyCommittedApprovalState,
  type SvvyxExtensionsCliProbe,
  validateExtensionBuildInput,
} from "../svvyx-extensions-command";
import {
  GENERATED_EXTENSIONS_PACKAGE_NAME,
  effectiveExtensionsGeneratedPackagePath,
  generatedExtensionExportIds,
  generatedExtensionReferenceExpression,
  writeGeneratedExtensionsPackage,
} from "../generated-extensions-package";
export { getExtensionsGeneratedPackagePath } from "../generated-extensions-package";
import { decodeUnknownTaskAgentParametersSourceExit } from "@svvy/core";
import type { ReasoningEffort } from "../../shared/agent-settings";
import type {
  WorkspaceWorkflowsGeneratedExport,
  WorkspaceWorkflowsGeneratedKind,
  WorkspaceWorkflowsGeneratedNamespace,
  WorkspaceWorkflowsGeneratedReadModel,
} from "../../shared/workspace-contract";
import type { SvvyxWorkflowsModelChoice } from "../svvyx-workflows-command";
import { isValidWorkflowExportName } from "../../shared/workflows-export-name";

const WORKFLOW_NAMESPACE_BY_DIR = {
  agents: { kind: "agent", namespace: "Agents" },
  components: { kind: "component", namespace: "Components" },
  prompts: { kind: "prompt", namespace: "Prompts" },
  workflows: { kind: "workflow", namespace: "Workflows" },
} satisfies Record<
  string,
  { kind: WorkspaceWorkflowsGeneratedKind; namespace: WorkspaceWorkflowsGeneratedNamespace }
>;

export function getWorkflowsSourceRoot(): string {
  return join(homedir(), ".config", "svvy", "workflows");
}

export function getWorkflowsGeneratedPackagePath(): string {
  return join(getWorkflowsSourceRoot(), "generated", "package");
}

export type WorkflowsBuildDiagnostic = {
  code: string;
  message: string;
  path?: string;
  exportName?: string;
};

export type WorkflowsBuildResult = {
  ok: boolean;
  generatedPackagePath: string;
  diagnostics: WorkflowsBuildDiagnostic[];
  items: WorkspaceWorkflowsGeneratedExport[];
};

type WorkflowSourceItem = {
  kind: WorkspaceWorkflowsGeneratedKind;
  exportName: string;
  sourcePath: string;
  generatedPath: string;
  sourceCode: string;
  agentParameters?: Record<string, unknown>;
};

type WorkflowGeneratedManifest = {
  items: Array<{
    generatedPath: string;
    sourcePath: string;
  }>;
};

const GENERATED_MANIFEST_FILE = ".svvy-workflows-manifest.json";
const TASK_AGENT_OVERRIDE_STATES = ["loaded", "available", "unavailable"] as const;
export const GENERATED_WORKFLOWS_PACKAGE_NAME = "@svvyx/workflows";

type TaskAgentExtensionOverrideState = (typeof TASK_AGENT_OVERRIDE_STATES)[number];

const SOURCE_DIR_BY_KIND = {
  agent: "agents",
  component: "components",
  prompt: "prompts",
  workflow: "workflows",
} satisfies Record<WorkspaceWorkflowsGeneratedKind, string>;

export async function buildWorkflowsGeneratedPackage(options: {
  agentSettingsStore?: AgentSettingsStore;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  envSecretStore?: ExtensionEnvSecretStore;
  extensionDependencyApprovalState?: ExtensionDependencyCommittedApprovalState;
  extensionsBuildRoot?: string;
  extensionsCliProbe?: SvvyxExtensionsCliProbe;
  extensionsRoot?: string;
  extensionsGeneratedPackagePath?: string;
  generatedPackagePath?: string;
  modelCatalog?: readonly SvvyxWorkflowsModelChoice[];
  sourceRoot?: string;
}): Promise<WorkflowsBuildResult> {
  const sourceRoot = options.sourceRoot ?? getWorkflowsSourceRoot();
  const generatedPackagePath = options.generatedPackagePath ?? getWorkflowsGeneratedPackagePath();
  const extensionsGeneratedPackagePath = effectiveExtensionsGeneratedPackagePath(options);
  const diagnostics: WorkflowsBuildDiagnostic[] = [];
  validateUserExtensionSourcesForWorkflowBuild(options.extensionsRoot, diagnostics);
  if (diagnostics.length > 0) {
    return { ok: false, generatedPackagePath, diagnostics, items: [] };
  }
  await buildUserExtensionsForWorkflowBuild(options, diagnostics);
  if (diagnostics.length > 0) {
    return { ok: false, generatedPackagePath, diagnostics, items: [] };
  }
  validateUserExtensionsForWorkflowBuild(options.extensionsRoot, diagnostics);
  if (diagnostics.length > 0) {
    return { ok: false, generatedPackagePath, diagnostics, items: [] };
  }

  const sourceItems = readWorkflowSourceItems(sourceRoot, generatedPackagePath, diagnostics);
  const extensionExportIds = generatedExtensionExportIds({
    dependencyApprovalState: options.extensionDependencyApprovalState,
    extensionsRoot: options.extensionsRoot,
  });
  validateWorkflowSourceItems(
    sourceItems,
    options.modelCatalog ?? [],
    extensionExportIds,
    diagnostics,
  );

  if (diagnostics.length > 0) {
    return { ok: false, generatedPackagePath, diagnostics, items: [] };
  }

  const backupPath = nextGeneratedPackageBackupPath(generatedPackagePath);
  const extensionsBackupPath = nextGeneratedPackageBackupPath(extensionsGeneratedPackagePath);
  const hadPreviousPackage = existsSync(generatedPackagePath);
  const hadPreviousExtensionsPackage = existsSync(extensionsGeneratedPackagePath);
  try {
    if (hadPreviousPackage) {
      renameSync(generatedPackagePath, backupPath);
    } else {
      rmSync(generatedPackagePath, { force: true, recursive: true });
    }
    if (hadPreviousExtensionsPackage) {
      renameSync(extensionsGeneratedPackagePath, extensionsBackupPath);
    } else {
      rmSync(extensionsGeneratedPackagePath, { force: true, recursive: true });
    }
    writeGeneratedExtensionsPackage(extensionsGeneratedPackagePath, extensionExportIds);
    writeGeneratedPackage(generatedPackagePath, sourceItems);
    const readModel = await readWorkflowsGeneratedReadModel(generatedPackagePath, { sourceRoot });
    if (hadPreviousPackage) {
      rmSync(backupPath, { force: true, recursive: true });
    }
    if (hadPreviousExtensionsPackage) {
      rmSync(extensionsBackupPath, { force: true, recursive: true });
    }
    return {
      ok: true,
      generatedPackagePath,
      diagnostics: [],
      items: readModel.items,
    };
  } catch (error) {
    rmSync(generatedPackagePath, { force: true, recursive: true });
    rmSync(extensionsGeneratedPackagePath, { force: true, recursive: true });
    if (hadPreviousPackage && existsSync(backupPath)) {
      renameSync(backupPath, generatedPackagePath);
    }
    if (hadPreviousExtensionsPackage && existsSync(extensionsBackupPath)) {
      renameSync(extensionsBackupPath, extensionsGeneratedPackagePath);
    }
    throw error;
  }
}

function validateUserExtensionSourcesForWorkflowBuild(
  extensionsRoot: string | undefined,
  diagnostics: WorkflowsBuildDiagnostic[],
): void {
  for (const extensionId of readUserExtensionSourceIds(extensionsRoot)) {
    const extension = resolveUserExtensionForWorkflowBuild(
      extensionId,
      extensionsRoot,
      diagnostics,
    );
    if (!extension) {
      continue;
    }
    const validationError = validateExtensionBuildInput(extension, extensionsRoot);
    if (validationError) {
      diagnostics.push({
        code: "invalid_extension_source",
        message: String(validationError.error.message),
        path: stringDiagnosticPath(validationError.error.path) ?? extension.sourceRoot,
        exportName: extension.id,
      });
    }
  }
}

async function buildUserExtensionsForWorkflowBuild(
  options: {
    agentSettingsStore?: AgentSettingsStore;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    envSecretStore?: ExtensionEnvSecretStore;
    extensionDependencyApprovalState?: ExtensionDependencyCommittedApprovalState;
    extensionsBuildRoot?: string;
    extensionsCliProbe?: SvvyxExtensionsCliProbe;
    extensionsRoot?: string;
  },
  diagnostics: WorkflowsBuildDiagnostic[],
): Promise<void> {
  const extensionsRoot = options.extensionsRoot;
  for (const extensionId of readUserExtensionSourceIds(extensionsRoot)) {
    const extension = resolveUserExtensionForWorkflowBuild(extensionId, extensionsRoot);
    if (!extension) {
      continue;
    }
    if (
      extension.interface !== "svvyx" ||
      !extension.typescriptApiEnabled ||
      !extensionBuildIsRequired(extension, extensionsRoot)
    ) {
      continue;
    }

    try {
      const result = await runSvvyxExtensionsCommand({
        agentSettingsStore: options.agentSettingsStore,
        buildRoot: options.extensionsBuildRoot,
        cliProbe: options.extensionsCliProbe,
        command: `svvyx extensions build ${quoteCommandWord(extension.id)} --json`,
        cwd: options.cwd,
        dependencyApprovalState: options.extensionDependencyApprovalState,
        env: options.env,
        envSecretStore: options.envSecretStore,
        extensionsRoot,
      });
      const buildOutput = result.output;
      if (!extensionBuildOutputSucceeded(buildOutput)) {
        diagnostics.push({
          code: "extension_build_failed",
          message: extensionBuildOutputMessage(
            buildOutput,
            `Extension ${extension.id} could not be built before Workflows build.`,
          ),
          path: extension.sourceRoot,
          exportName: extension.id,
        });
      }
    } catch (error) {
      diagnostics.push({
        code: "extension_build_failed",
        message:
          error instanceof Error
            ? error.message
            : `Extension ${extension.id} could not be built before Workflows build.`,
        path: extension.sourceRoot,
        exportName: extension.id,
      });
    }
  }
}

function validateUserExtensionsForWorkflowBuild(
  extensionsRoot: string | undefined,
  diagnostics: WorkflowsBuildDiagnostic[],
): void {
  for (const extensionId of readUserExtensionSourceIds(extensionsRoot)) {
    const extension = resolveUserExtensionForWorkflowBuild(
      extensionId,
      extensionsRoot,
      diagnostics,
    );
    if (!extension) {
      continue;
    }

    const validationError = validateExtensionBuildInput(extension, extensionsRoot);
    if (validationError) {
      diagnostics.push({
        code: "invalid_extension_source",
        message: String(validationError.error.message),
        path: stringDiagnosticPath(validationError.error.path) ?? extension.sourceRoot,
        exportName: extension.id,
      });
      continue;
    }

    if (
      extension.interface === "svvyx" &&
      extension.typescriptApiEnabled &&
      extensionBuildIsRequired(extension, extensionsRoot)
    ) {
      diagnostics.push({
        code: "extension_build_required",
        message: `Extension ${extension.id} must have a current successful build before Workflows build can validate workflow-agent extension references.`,
        path: extension.sourceRoot,
        exportName: extension.id,
      });
    }
  }
}

function resolveUserExtensionForWorkflowBuild(
  extensionId: string,
  extensionsRoot: string | undefined,
  diagnostics?: WorkflowsBuildDiagnostic[],
): ReturnType<typeof resolveExtensionRecord> {
  try {
    const extension = resolveExtensionRecord(extensionId, extensionsRoot);
    if (!extension) {
      diagnostics?.push({
        code: "invalid_extension_source",
        message: `Extension ${extensionId} source cannot be resolved.`,
        path: userExtensionSourcePath(extensionsRoot, extensionId),
        exportName: extensionId,
      });
    }
    return extension;
  } catch (error) {
    diagnostics?.push({
      code: "invalid_extension_source",
      message:
        error instanceof Error ? error.message : `Extension ${extensionId} source cannot be read.`,
      path: userExtensionSourcePath(extensionsRoot, extensionId),
      exportName: extensionId,
    });
    return null;
  }
}

function readUserExtensionSourceIds(extensionsRoot: string | undefined): string[] {
  const sourceRoot = join(extensionsRoot ?? defaultExtensionsRoot(), "sources", "user");
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    return [];
  }
  return readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function userExtensionSourcePath(extensionsRoot: string | undefined, extensionId: string): string {
  return join(extensionsRoot ?? defaultExtensionsRoot(), "sources", "user", extensionId);
}

function extensionBuildIsRequired(
  extension: NonNullable<ReturnType<typeof resolveExtensionRecord>>,
  extensionsRoot: string | undefined,
): boolean {
  const sourceFingerprint = extension.extensionBuildFingerprint;
  if (!sourceFingerprint) {
    return false;
  }
  const manifestPath = join(
    extensionsRoot ?? defaultExtensionsRoot(),
    "builds",
    "extensions",
    extension.id,
    "current",
    "manifest.json",
  );
  if (!existsSync(manifestPath)) {
    return true;
  }
  const manifest = readJsonObjectOrNull(manifestPath);
  return (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    manifest.extensionId !== extension.id ||
    manifest.interface !== extension.interface ||
    manifest.sourceFingerprint !== sourceFingerprint
  );
}

function extensionBuildOutputSucceeded(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.ok === true &&
    isRecord(value.build) &&
    value.build.status === "success"
  );
}

function extensionBuildOutputMessage(value: unknown, fallback: string): string {
  if (isRecord(value)) {
    const error = value.error;
    if (isRecord(error) && typeof error.message === "string") {
      return error.message;
    }
  }
  return fallback;
}

function quoteCommandWord(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function readJsonObjectOrNull(path: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringDiagnosticPath(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function defaultExtensionsRoot(): string {
  return join(homedir(), ".config", "svvy", "extensions");
}

function nextGeneratedPackageBackupPath(generatedPackagePath: string): string {
  const parent = dirname(generatedPackagePath);
  const name = basename(generatedPackagePath);
  for (let index = 0; index < 100; index += 1) {
    const backupPath = join(parent, `.${name}.previous-${Date.now()}-${index}`);
    if (!existsSync(backupPath)) return backupPath;
  }
  throw workflowLibraryError(
    "build_failed",
    `Unable to allocate Workflows generated package backup path for ${generatedPackagePath}`,
    generatedPackagePath,
  );
}

export function getWorkflowSourcePath(input: {
  exportName: string;
  kind: WorkspaceWorkflowsGeneratedKind;
  sourceExtension?: string;
  sourceRoot?: string;
}): string {
  assertValidExportName(input.exportName);
  return workflowSourcePath({
    exportName: input.exportName,
    kind: input.kind,
    sourceExtension: input.sourceExtension,
    sourceRoot: input.sourceRoot ?? getWorkflowsSourceRoot(),
  });
}

export function copyWorkflowSourceItem(input: {
  exportName: string;
  fromPath: string;
  kind: Exclude<WorkspaceWorkflowsGeneratedKind, "agent">;
  overwrite?: boolean;
  sourceRoot?: string;
}): { sourcePath: string } {
  assertValidExportName(input.exportName);
  const extension = extname(input.fromPath);
  validateSourceExtension(input.kind, extension, input.fromPath);
  const sourceRoot = input.sourceRoot ?? getWorkflowsSourceRoot();
  const sourcePath = workflowSourcePath({
    exportName: input.exportName,
    kind: input.kind,
    sourceExtension: extension,
    sourceRoot,
  });
  if (existsSync(sourcePath) && !input.overwrite) {
    throw workflowLibraryError(
      "target_exists",
      `Workflows source target already exists: ${sourcePath}`,
      sourcePath,
      input.exportName,
    );
  }
  mkdirSync(dirname(sourcePath), { recursive: true });
  copyFileSync(input.fromPath, sourcePath);
  return { sourcePath };
}

export function extractWorkflowSourceExportItem(input: {
  exportName: string;
  fromPath: string;
  kind: "component" | "workflow";
  overwrite?: boolean;
  sourceExportName: string;
  sourceRoot?: string;
}): { sourcePath: string } {
  assertValidExportName(input.exportName);
  assertValidExportName(input.sourceExportName);
  const extension = extname(input.fromPath);
  validateSourceExtension(input.kind, extension, input.fromPath);
  const sourceRoot = input.sourceRoot ?? getWorkflowsSourceRoot();
  const sourcePath = workflowSourcePath({
    exportName: input.exportName,
    kind: input.kind,
    sourceExtension: extension,
    sourceRoot,
  });
  if (existsSync(sourcePath) && !input.overwrite) {
    throw workflowLibraryError(
      "target_exists",
      `Workflows source target already exists: ${sourcePath}`,
      sourcePath,
      input.exportName,
    );
  }
  const sourceCode = extractNamedWorkflowSourceExport({
    exportName: input.exportName,
    fromPath: input.fromPath,
    sourceExportName: input.sourceExportName,
  });
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, sourceCode);
  return { sourcePath };
}

export function extractWorkflowAgentParametersFromSource(input: {
  exportName?: string;
  path: string;
  sourceRoot?: string;
}): { exportName: string; parameters: Record<string, unknown> } {
  const source = readFileSync(input.path, "utf8");
  const sourceFile = ts.createSourceFile(input.path, source, ts.ScriptTarget.Latest, true);
  const staticContext: WorkflowAgentStaticContext = {
    sourceFile,
    sourceRoot: input.sourceRoot ?? getWorkflowsSourceRoot(),
  };
  const matches: Array<{ exportName: string; parameters: Record<string, unknown> }> = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (input.exportName && declaration.name.text !== input.exportName) continue;
      const initializer = unwrapLiteralExpression(declaration.initializer);
      if (!ts.isCallExpression(initializer) || !isDefineTaskAgentCall(initializer.expression)) {
        continue;
      }
      const argument = initializer.arguments[0];
      if (!argument) {
        throw workflowLibraryError(
          "invalid_agent_source",
          `Workflow agent export ${declaration.name.text} must pass a literal object to defineTaskAgent.`,
          input.path,
          declaration.name.text,
        );
      }
      const literal = unwrapLiteralExpression(argument);
      if (!ts.isObjectLiteralExpression(literal)) {
        throw workflowLibraryError(
          "invalid_agent_source",
          `Workflow agent export ${declaration.name.text} must pass a literal object to defineTaskAgent.`,
          input.path,
          declaration.name.text,
        );
      }
      const parameters = literalExpressionToStaticValue(literal, staticContext);
      if (!isRecord(parameters)) {
        throw workflowLibraryError(
          "invalid_agent_source",
          `Workflow agent export ${declaration.name.text} must resolve to an object.`,
          input.path,
          declaration.name.text,
        );
      }
      matches.push({ exportName: declaration.name.text, parameters });
    }
  }

  if (input.exportName && matches.length === 0) {
    throw workflowLibraryError(
      "invalid_agent_source",
      `No static defineTaskAgent export named ${input.exportName} found.`,
      input.path,
      input.exportName,
    );
  }
  if (matches.length !== 1) {
    throw workflowLibraryError(
      "invalid_agent_source",
      matches.length === 0
        ? "No static defineTaskAgent export found."
        : "Multiple static defineTaskAgent exports found; pass --export.",
      input.path,
    );
  }
  return matches[0]!;
}

export async function readWorkflowsGeneratedReadModel(
  generatedPackagePath = getWorkflowsGeneratedPackagePath(),
  options: { sourceRoot?: string } = {},
): Promise<WorkspaceWorkflowsGeneratedReadModel> {
  const sourceRoot = options.sourceRoot ?? getWorkflowsSourceRoot();
  const items = readGeneratedExports(generatedPackagePath, sourceRoot);
  const counts = {
    agent: 0,
    component: 0,
    prompt: 0,
    workflow: 0,
  } satisfies Record<WorkspaceWorkflowsGeneratedKind, number>;
  for (const item of items) {
    counts[item.kind] += 1;
  }
  return {
    generatedPackagePath,
    items,
    counts,
    updatedAt: readGeneratedUpdatedAt(generatedPackagePath),
  };
}

function readGeneratedExports(
  generatedPackagePath: string,
  sourceRoot: string,
): WorkspaceWorkflowsGeneratedExport[] {
  if (!existsSync(generatedPackagePath)) {
    return [];
  }
  const manifest = readGeneratedManifest(generatedPackagePath);
  return Object.entries(WORKFLOW_NAMESPACE_BY_DIR).flatMap(([dirName, meta]) => {
    const namespaceRoot = join(generatedPackagePath, dirName);
    if (!existsSync(namespaceRoot)) {
      return [];
    }
    return walkFiles(namespaceRoot)
      .filter((path) => /\.(ts|tsx|js|jsx|mdx|json)$/.test(path))
      .filter((path) => basename(path, extname(path)) !== "index")
      .flatMap((path) => readExportRows(generatedPackagePath, sourceRoot, path, meta, manifest));
  });
}

function readExportRows(
  generatedPackagePath: string,
  sourceRoot: string,
  generatedPath: string,
  meta: { kind: WorkspaceWorkflowsGeneratedKind; namespace: WorkspaceWorkflowsGeneratedNamespace },
  manifest: Map<string, string>,
): WorkspaceWorkflowsGeneratedExport[] {
  const generatedCode = readFileSync(generatedPath, "utf8");
  const exportNames = extractExportNames(generatedCode);
  return exportNames.map((exportName) => {
    const agentParameters =
      meta.kind === "agent" ? readAgentParameters(generatedCode, exportName) : null;
    const workflowAgentId =
      typeof agentParameters?.id === "string" && agentParameters.id.trim()
        ? agentParameters.id
        : null;
    return {
      id: `${meta.namespace}.${exportName}`,
      kind: meta.kind,
      namespace: meta.namespace,
      exportName,
      qualifiedName: `${meta.namespace}.${exportName}`,
      sourcePath:
        manifest.get(generatedPath) ??
        inferSourcePath(generatedPackagePath, sourceRoot, generatedPath, meta.kind),
      generatedPath,
      generatedCode,
      agentParameters,
      workflowAgentId,
    };
  });
}

function extractExportNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /\bexport\s+(?:const|let|var|(?:async\s+)?function|class)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]!);
  }
  for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const raw of match[1]!.split(",")) {
      const [left, right] = raw.split(/\s+as\s+/).map((part) => part.trim());
      const name = right || left;
      if (name && !name.startsWith("type ")) {
        names.add(name);
      }
    }
  }
  return [...names].toSorted();
}

function inferSourcePath(
  generatedPackagePath: string,
  sourceRoot: string,
  generatedPath: string,
  kind: WorkspaceWorkflowsGeneratedKind,
): string {
  const relativeGenerated = relative(generatedPackagePath, generatedPath).replace(/\\/g, "/");
  const withoutNamespace = relativeGenerated.split("/").slice(1).join("/");
  const sourceDir = sourceDirForKind(kind);
  const sourceRelative =
    kind === "agent" ? agentSourceRelativePath(withoutNamespace) : withoutNamespace;
  return join(sourceRoot, sourceDir, sourceRelative).replace(/\\/g, "/");
}

function sourceDirForKind(kind: WorkspaceWorkflowsGeneratedKind): string {
  if (kind === "agent") return "agents";
  if (kind === "component") return "components";
  if (kind === "prompt") return "prompts";
  return "workflows";
}

function agentSourceRelativePath(generatedRelativePath: string): string {
  const extension = extname(generatedRelativePath);
  const base = basename(generatedRelativePath, extension);
  const parent = generatedRelativePath.slice(
    0,
    generatedRelativePath.length - basename(generatedRelativePath).length,
  );
  return `${parent}${base}.agent.json`;
}

function readAgentParameters(source: string, exportName: string): Record<string, unknown> | null {
  const sourceFile = ts.createSourceFile(
    "generated-agent.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue;
      if (!declaration.initializer) return null;
      const initializer = unwrapLiteralExpression(declaration.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) return null;
      const value = literalExpressionToValue(initializer, sourceFile);
      return isRecord(value) ? value : null;
    }
  }
  return null;
}

function extractNamedWorkflowSourceExport(input: {
  exportName: string;
  fromPath: string;
  sourceExportName: string;
}): string {
  const source = readFileSync(input.fromPath, "utf8");
  const sourceFile = ts.createSourceFile(input.fromPath, source, ts.ScriptTarget.Latest, true);
  const retainedStatements: string[] = [];
  const skippedExportNames: string[] = [];
  let selectedStatement: string | null = null;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      rejectRelativeWorkflowSourceImport(statement, input.fromPath, input.sourceExportName);
      retainedStatements.push(statement.getText(sourceFile));
      continue;
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      retainedStatements.push(stripExportModifier(statement.getText(sourceFile)));
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const selectedDeclaration = statement.declarationList.declarations.find(
        (declaration) =>
          ts.isIdentifier(declaration.name) && declaration.name.text === input.sourceExportName,
      );
      if (selectedDeclaration && hasExportModifier(statement)) {
        if (statement.declarationList.declarations.length !== 1) {
          throw workflowLibraryError(
            "invalid_source_export",
            `Workflow source export ${input.sourceExportName} must be the only declaration in its statement.`,
            input.fromPath,
            input.sourceExportName,
          );
        }
        selectedStatement = renderSelectedVariableExport({
          declaration: selectedDeclaration,
          declarationList: statement.declarationList,
          exportName: input.exportName,
          sourceExportName: input.sourceExportName,
          sourceFile,
        });
        continue;
      }
      throw ambiguousWorkflowSourceExport(input.fromPath, input.sourceExportName, statement);
    }
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name?.text === input.sourceExportName && hasExportModifier(statement)) {
        if (hasDefaultModifier(statement)) {
          throw workflowLibraryError(
            "invalid_source_export",
            `Workflow source export ${input.sourceExportName} must be a named export, not a default export.`,
            input.fromPath,
            input.sourceExportName,
          );
        }
        selectedStatement = renameSelectedNamedExport({
          exportName: input.exportName,
          sourceExportName: input.sourceExportName,
          sourceFile,
          statement,
        });
        continue;
      }
      if (statement.name && hasExportModifier(statement)) {
        skippedExportNames.push(statement.name.text);
        continue;
      }
      throw ambiguousWorkflowSourceExport(input.fromPath, input.sourceExportName, statement);
    }
    if (ts.isEmptyStatement(statement)) continue;
    throw ambiguousWorkflowSourceExport(input.fromPath, input.sourceExportName, statement);
  }

  if (!selectedStatement) {
    throw workflowLibraryError(
      "invalid_source_export",
      `No extractable source export named ${input.sourceExportName} found.`,
      input.fromPath,
      input.sourceExportName,
    );
  }
  for (const skippedName of skippedExportNames) {
    if (new RegExp(`\\b${skippedName}\\b`).test(selectedStatement)) {
      throw workflowLibraryError(
        "invalid_source_export",
        `Workflow source export ${input.sourceExportName} references skipped export ${skippedName}.`,
        input.fromPath,
        input.sourceExportName,
      );
    }
  }

  return [...retainedStatements, selectedStatement, ""].join("\n\n");
}

function renderSelectedVariableExport(input: {
  declaration: ts.VariableDeclaration;
  declarationList: ts.VariableDeclarationList;
  exportName: string;
  sourceExportName: string;
  sourceFile: ts.SourceFile;
}): string {
  if (!ts.isIdentifier(input.declaration.name) || !input.declaration.initializer) {
    throw workflowLibraryError(
      "invalid_source_export",
      "Workflow source variable exports must use named initialized declarations.",
      input.sourceFile.fileName,
    );
  }
  const declarationKind =
    input.declarationList.flags & ts.NodeFlags.Const
      ? "const"
      : input.declarationList.flags & ts.NodeFlags.Let
        ? "let"
        : "var";
  const typeText = input.declaration.type
    ? `: ${input.declaration.type.getText(input.sourceFile)}`
    : "";
  if (
    input.exportName !== input.sourceExportName &&
    identifierAppearsInNode(input.declaration.initializer, input.sourceExportName)
  ) {
    throw workflowLibraryError(
      "invalid_source_export",
      `Workflow source export ${input.sourceExportName} references itself and cannot be renamed safely.`,
      input.sourceFile.fileName,
      input.sourceExportName,
    );
  }
  return [
    `export ${declarationKind} ${input.exportName}${typeText} = ${input.declaration.initializer.getText(
      input.sourceFile,
    )};`,
  ].join("\n");
}

function renameSelectedNamedExport(input: {
  exportName: string;
  sourceExportName: string;
  sourceFile: ts.SourceFile;
  statement: ts.ClassDeclaration | ts.FunctionDeclaration;
}): string {
  const bodyNodes = ts.isFunctionDeclaration(input.statement)
    ? input.statement.body
      ? [input.statement.body]
      : []
    : Array.from(input.statement.members);
  if (
    input.exportName !== input.sourceExportName &&
    bodyNodes.some((node) => identifierAppearsInNode(node, input.sourceExportName))
  ) {
    throw workflowLibraryError(
      "invalid_source_export",
      `Workflow source export ${input.sourceExportName} references itself and cannot be renamed safely.`,
      input.sourceFile.fileName,
      input.sourceExportName,
    );
  }
  const text = input.statement.getText(input.sourceFile);
  const declarationKeyword =
    input.statement.kind === ts.SyntaxKind.ClassDeclaration ? "class" : "function";
  return text.replace(
    new RegExp(`\\b${declarationKeyword}\\s+${input.sourceExportName}\\b`),
    `${declarationKeyword} ${input.exportName}`,
  );
}

function stripExportModifier(text: string): string {
  return text.replace(/^export\s+/, "");
}

function rejectRelativeWorkflowSourceImport(
  statement: ts.ImportDeclaration,
  path: string,
  exportName: string,
): void {
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return;
  if (!statement.moduleSpecifier.text.startsWith(".")) return;
  throw workflowLibraryError(
    "invalid_source_export",
    `Workflow source export ${exportName} cannot be extracted safely because relative imports change meaning after relocation.`,
    path,
    exportName,
  );
}

function identifierAppearsInNode(node: ts.Node, identifierName: string): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(child) && child.text === identifierName) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function ambiguousWorkflowSourceExport(
  path: string,
  exportName: string,
  statement: ts.Statement,
): WorkflowLibraryError {
  return workflowLibraryError(
    "invalid_source_export",
    `Workflow source export ${exportName} cannot be extracted safely because the source contains another runtime top-level statement: ${statement.getText().slice(0, 80)}`,
    path,
    exportName,
  );
}

function unwrapLiteralExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function literalExpressionToValue(expression: ts.Expression, sourceFile: ts.SourceFile): unknown {
  const current = unwrapLiteralExpression(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (current.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.map((element) => literalExpressionToValue(element, sourceFile));
  }
  if (ts.isObjectLiteralExpression(current)) {
    const record: Record<string, unknown> = {};
    for (const property of current.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = propertyNameToString(property.name);
      if (!name) continue;
      record[name] = literalExpressionToValue(property.initializer, sourceFile);
    }
    return record;
  }
  const extensionId = extensionReferenceToId(current);
  if (extensionId) return extensionId;
  if (ts.isIdentifier(current) || ts.isPropertyAccessExpression(current)) {
    return current.getText(sourceFile);
  }
  return current.getText(sourceFile);
}

type WorkflowAgentStaticContext = {
  sourceFile: ts.SourceFile;
  sourceRoot: string;
};

function literalExpressionToStaticValue(
  expression: ts.Expression,
  context: WorkflowAgentStaticContext,
): unknown {
  const current = unwrapLiteralExpression(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (current.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(current)) {
    return current.elements.map((element) => literalExpressionToStaticValue(element, context));
  }
  if (ts.isObjectLiteralExpression(current)) {
    const record: Record<string, unknown> = {};
    for (const property of current.properties) {
      if (ts.isSpreadAssignment(property)) {
        Object.assign(record, resolveWorkflowAgentSpread(property.expression, context));
        continue;
      }
      if (!ts.isPropertyAssignment(property)) {
        throw workflowLibraryError(
          "invalid_agent_source",
          "Workflow agent source must use static property assignments.",
        );
      }
      const name = propertyNameToString(property.name);
      if (!name) {
        throw workflowLibraryError(
          "invalid_agent_source",
          "Workflow agent source must use static property names.",
        );
      }
      record[name] = literalExpressionToStaticValue(property.initializer, context);
    }
    return record;
  }
  const extensionId = extensionReferenceToId(current);
  if (extensionId) return extensionId;
  throw workflowLibraryError(
    "invalid_agent_source",
    `Workflow agent source contains dynamic expression: ${current.getText(context.sourceFile)}`,
  );
}

function extensionReferenceToId(expression: ts.Expression): string | null {
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "id" &&
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "Extensions"
  ) {
    return expression.expression.name.text;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "id" &&
    ts.isElementAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "Extensions" &&
    ts.isStringLiteralLike(expression.expression.argumentExpression)
  ) {
    return expression.expression.argumentExpression.text;
  }
  return null;
}

function resolveWorkflowAgentSpread(
  expression: ts.Expression,
  context: WorkflowAgentStaticContext,
): Record<string, unknown> {
  const current = unwrapLiteralExpression(expression);
  if (
    !ts.isPropertyAccessExpression(current) ||
    !ts.isIdentifier(current.expression) ||
    current.expression.text !== "Agents"
  ) {
    throw workflowLibraryError(
      "invalid_agent_source",
      `Workflow agent source contains unresolved spread: ${current.getText(context.sourceFile)}`,
    );
  }

  const sourcePath = getWorkflowSourcePath({
    exportName: current.name.text,
    kind: "agent",
    sourceExtension: ".agent.json",
    sourceRoot: context.sourceRoot,
  });
  if (!existsSync(sourcePath)) {
    throw workflowLibraryError(
      "invalid_agent_source",
      `Workflow agent source references unknown saved agent ${current.getText(context.sourceFile)}.`,
      sourcePath,
      current.name.text,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as unknown;
  } catch (error) {
    throw workflowLibraryError(
      "invalid_agent_source",
      error instanceof Error
        ? error.message
        : "Workflow agent saved agent source is not valid JSON.",
      sourcePath,
      current.name.text,
    );
  }
  if (!isRecord(parsed)) {
    throw workflowLibraryError(
      "invalid_agent_source",
      `Workflow agent source references invalid saved agent ${current.getText(context.sourceFile)}.`,
      sourcePath,
      current.name.text,
    );
  }
  return parsed;
}

function hasExportModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

function hasDefaultModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true
  );
}

function isDefineTaskAgentCall(expression: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      expression.name.text === "defineTaskAgent" &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "Agents"
    );
  }
  return false;
}

function propertyNameToString(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    return extensionReferenceToId(name.expression);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readGeneratedUpdatedAt(generatedPackagePath: string): string {
  if (!existsSync(generatedPackagePath)) {
    return new Date(0).toISOString();
  }
  return new Date(statSync(generatedPackagePath).mtimeMs).toISOString();
}

function readWorkflowSourceItems(
  sourceRoot: string,
  generatedPackagePath: string,
  diagnostics: WorkflowsBuildDiagnostic[],
): WorkflowSourceItem[] {
  const items: WorkflowSourceItem[] = [];
  for (const [kind, dirName] of Object.entries(SOURCE_DIR_BY_KIND) as Array<
    [WorkspaceWorkflowsGeneratedKind, string]
  >) {
    const root = join(sourceRoot, dirName);
    if (!existsSync(root)) continue;
    for (const sourcePath of walkFiles(root)) {
      const extension = extname(sourcePath);
      if (!sourceExtensionMatchesKind(kind, extension, sourcePath)) continue;
      const exportName =
        kind === "agent" ? basename(sourcePath, ".agent.json") : basename(sourcePath, extension);
      if (!isValidExportName(exportName)) {
        diagnostics.push({
          code: "invalid_export_name",
          message: `Invalid Workflows export name: ${exportName}`,
          path: sourcePath,
          exportName,
        });
        continue;
      }
      if (kind === "agent") {
        const agentParameters = readAgentSourceRecord(sourcePath, diagnostics);
        if (!agentParameters) continue;
        if (stringProperty(agentParameters, "id") !== exportName) {
          diagnostics.push({
            code: "invalid_agent_parameters",
            message: `Workflow agent ${exportName} id must match its source filename.`,
            path: sourcePath,
            exportName,
          });
          continue;
        }
        items.push({
          kind,
          exportName,
          sourcePath,
          generatedPath: join(generatedPackagePath, "agents", `${exportName}.ts`),
          sourceCode: "",
          agentParameters,
        });
        continue;
      }
      items.push({
        kind,
        exportName,
        sourcePath,
        generatedPath: join(
          generatedPackagePath,
          dirName,
          `${exportName}${generatedExtensionForSource(kind, extension)}`,
        ),
        sourceCode: readFileSync(sourcePath, "utf8"),
      });
    }
  }
  return items.toSorted((left, right) => left.generatedPath.localeCompare(right.generatedPath));
}

function readAgentSourceRecord(
  sourcePath: string,
  diagnostics: WorkflowsBuildDiagnostic[],
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      diagnostics.push({
        code: "invalid_agent_source",
        message: "Workflow agent source must be a JSON object.",
        path: sourcePath,
      });
      return null;
    }
    return parsed;
  } catch (error) {
    diagnostics.push({
      code: "invalid_agent_source",
      message: error instanceof Error ? error.message : "Workflow agent source is not valid JSON.",
      path: sourcePath,
    });
    return null;
  }
}

function taskAgentOverridesProperty(
  record: Record<string, unknown>,
): Record<string, TaskAgentExtensionOverrideState> | null | undefined {
  if (!Object.hasOwn(record, "overrides")) {
    return undefined;
  }
  const value = record.overrides;
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return null;
  }
  const overrides: Record<string, TaskAgentExtensionOverrideState> = {};
  for (const [rawId, rawState] of Object.entries(value)) {
    const id = rawId.trim();
    if (!id || !isTaskAgentExtensionOverrideState(rawState)) {
      return null;
    }
    overrides[id] = rawState;
  }
  return overrides;
}

function isTaskAgentExtensionOverrideState(
  value: unknown,
): value is TaskAgentExtensionOverrideState {
  return (
    typeof value === "string" &&
    TASK_AGENT_OVERRIDE_STATES.includes(value as TaskAgentExtensionOverrideState)
  );
}

function validateTaskAgentParametersSourceContract(
  item: WorkflowSourceItem,
  diagnostics: WorkflowsBuildDiagnostic[],
): void {
  const parameters = item.agentParameters ?? {};
  const { extensionOrder, ...bridgeParameters } = parameters;
  if (
    extensionOrder !== undefined &&
    (!Array.isArray(extensionOrder) || !extensionOrder.every((value) => typeof value === "string"))
  ) {
    diagnostics.push({
      code: "invalid_agent_parameters",
      message: `Workflow agent ${item.exportName} extensionOrder must be an array of extension ids.`,
      path: item.sourcePath,
      exportName: item.exportName,
    });
    return;
  }
  if (Exit.isFailure(decodeUnknownTaskAgentParametersSourceExit(bridgeParameters))) {
    diagnostics.push({
      code: "invalid_agent_parameters",
      message: `Workflow agent ${item.exportName} must match TaskAgentParametersSource.`,
      path: item.sourcePath,
      exportName: item.exportName,
    });
  }
}

function reasoningEffortProperty(parameters: Record<string, unknown>): ReasoningEffort | null {
  const reasoning = parameters.reasoning;
  if (!isRecord(reasoning)) return null;
  return typeof reasoning.effort === "string" ? (reasoning.effort as ReasoningEffort) : null;
}

function validateWorkflowSourceItems(
  items: WorkflowSourceItem[],
  modelCatalog: readonly SvvyxWorkflowsModelChoice[],
  extensionExportIds: ReadonlySet<string>,
  diagnostics: WorkflowsBuildDiagnostic[],
): void {
  const seen = new Set<string>();
  const modelsByProvider = new Map<string, Map<string, SvvyxWorkflowsModelChoice>>();
  for (const model of modelCatalog) {
    const providerModels = modelsByProvider.get(model.providerId) ?? new Map();
    providerModels.set(model.modelId, model);
    modelsByProvider.set(model.providerId, providerModels);
  }

  for (const item of items) {
    const id = `${item.kind}:${item.exportName}`;
    if (seen.has(id)) {
      diagnostics.push({
        code: "duplicate_export",
        message: `Duplicate Workflows export: ${item.exportName}`,
        path: item.sourcePath,
        exportName: item.exportName,
      });
      continue;
    }
    seen.add(id);

    if (item.kind !== "agent") continue;
    const parameters = item.agentParameters ?? {};
    validateTaskAgentParametersSourceContract(item, diagnostics);
    const provider = stringProperty(parameters, "provider");
    const model = stringProperty(parameters, "model");
    const reasoningEffort = reasoningEffortProperty(parameters);
    const instructions = stringProperty(parameters, "instructions");
    const overrides = taskAgentOverridesProperty(parameters);

    for (const [field, value] of [
      ["id", stringProperty(parameters, "id")],
      ["label", stringProperty(parameters, "label")],
      ["provider", provider],
      ["model", model],
      ["reasoning.effort", reasoningEffort],
      ["instructions", instructions],
    ]) {
      if (!value) {
        diagnostics.push({
          code: "invalid_agent_parameters",
          message: `Workflow agent ${item.exportName} is missing string field ${field}.`,
          path: item.sourcePath,
          exportName: item.exportName,
        });
      }
    }
    if (Object.hasOwn(parameters, "extensions")) {
      diagnostics.push({
        code: "invalid_agent_parameters",
        message: `Workflow agent ${item.exportName} must use overrides, not extensions.`,
        path: item.sourcePath,
        exportName: item.exportName,
      });
    }
    if (Object.hasOwn(parameters, "reasoningEffort")) {
      diagnostics.push({
        code: "invalid_agent_parameters",
        message: `Workflow agent ${item.exportName} must use reasoning.effort, not reasoningEffort.`,
        path: item.sourcePath,
        exportName: item.exportName,
      });
    }
    if (Object.hasOwn(parameters, "extensionUsage")) {
      diagnostics.push({
        code: "invalid_agent_parameters",
        message: `Workflow agent ${item.exportName} must use overrides, not extensionUsage.`,
        path: item.sourcePath,
        exportName: item.exportName,
      });
    }
    if (overrides === null) {
      diagnostics.push({
        code: "invalid_agent_parameters",
        message: `Workflow agent ${item.exportName} overrides must be an object whose values are loaded, available, or unavailable.`,
        path: item.sourcePath,
        exportName: item.exportName,
      });
    }
    if (!provider || !model || !reasoningEffort) continue;
    const modelChoice = modelsByProvider.get(provider)?.get(model);
    if (!modelChoice) {
      diagnostics.push({
        code: "invalid_agent_model",
        message: `Workflow agent ${item.exportName} references unavailable model ${provider}/${model}.`,
        path: item.sourcePath,
        exportName: item.exportName,
      });
    } else if (!modelChoice.supportedReasoning.includes(reasoningEffort)) {
      diagnostics.push({
        code: "invalid_agent_reasoning",
        message: `Workflow agent ${item.exportName} references unsupported reasoning level ${reasoningEffort} for ${provider}/${model}.`,
        path: item.sourcePath,
        exportName: item.exportName,
      });
    } else if (!modelChoice.providerAuthenticated) {
      diagnostics.push({
        code: "invalid_agent_provider_auth",
        message: `Workflow agent ${item.exportName} references unauthenticated provider ${provider}.`,
        path: item.sourcePath,
        exportName: item.exportName,
      });
    }
    const userGeneratedExtensions = new Set(
      [...extensionExportIds].filter((extensionId) => !isBuiltinExtensionId(extensionId)),
    );
    const resolvedBuiltinOverrides = resolveActorExtensionState({
      actor: "workflow-task",
      overrides: Object.fromEntries(
        Object.entries(overrides ?? {}).filter(([extensionId]) =>
          isBuiltinExtensionId(extensionId),
        ),
      ),
    });
    const resolvedBuiltinOverrideIds = new Set([
      ...resolvedBuiltinOverrides.loadedExtensionIds,
      ...resolvedBuiltinOverrides.availableExtensionIds,
    ]);
    for (const [extensionId, state] of Object.entries(overrides ?? {})) {
      const builtinAllowed =
        isBuiltinExtensionId(extensionId) &&
        (state === "unavailable" || resolvedBuiltinOverrideIds.has(extensionId));
      const userAllowed =
        userGeneratedExtensions.has(extensionId) ||
        (state === "unavailable" && !isBuiltinExtensionId(extensionId));
      if (!extensionExportIds.has(extensionId) || (!builtinAllowed && !userAllowed)) {
        diagnostics.push({
          code: "invalid_agent_extension",
          message: `Workflow agent ${item.exportName} references unavailable extension ${extensionId}.`,
          path: item.sourcePath,
          exportName: item.exportName,
        });
      }
    }
  }
}

function writeGeneratedPackage(generatedPackagePath: string, items: readonly WorkflowSourceItem[]) {
  mkdirSync(generatedPackagePath, { recursive: true });
  writeGeneratedManifest(generatedPackagePath, items);
  writeFileSync(
    join(generatedPackagePath, "package.json"),
    JSON.stringify(
      {
        name: GENERATED_WORKFLOWS_PACKAGE_NAME,
        type: "module",
        exports: {
          ".": "./index.ts",
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(generatedPackagePath, "index.ts"),
    [
      'export * as Agents from "./agents";',
      'export * as Components from "./components";',
      'export * as Prompts from "./prompts";',
      'export * as Workflows from "./workflows";',
      "",
    ].join("\n"),
  );
  writeAgentsIndex(
    generatedPackagePath,
    items.filter((item) => item.kind === "agent"),
  );
  writeNamespaceFiles(generatedPackagePath, "components", items);
  writeNamespaceFiles(generatedPackagePath, "prompts", items);
  writeNamespaceFiles(generatedPackagePath, "workflows", items);
}

function isBuiltinExtensionId(extensionId: string): boolean {
  return BUILTIN_EXTENSIONS.some((extension) => extension.id === extensionId);
}

function writeGeneratedManifest(
  generatedPackagePath: string,
  items: readonly WorkflowSourceItem[],
): void {
  const manifest: WorkflowGeneratedManifest = {
    items: items.map((item) => ({
      generatedPath: item.generatedPath,
      sourcePath: item.sourcePath,
    })),
  };
  writeFileSync(
    join(generatedPackagePath, GENERATED_MANIFEST_FILE),
    JSON.stringify(manifest, null, 2),
  );
}

function readGeneratedManifest(generatedPackagePath: string): Map<string, string> {
  try {
    const path = join(generatedPackagePath, GENERATED_MANIFEST_FILE);
    if (!existsSync(path)) return new Map();
    const parsed = JSON.parse(readFileSync(path, "utf8")) as WorkflowGeneratedManifest;
    if (!Array.isArray(parsed.items)) return new Map();
    return new Map(
      parsed.items
        .filter(
          (item) => typeof item.generatedPath === "string" && typeof item.sourcePath === "string",
        )
        .map((item) => [item.generatedPath, item.sourcePath]),
    );
  } catch {
    return new Map();
  }
}

function writeAgentsIndex(
  generatedPackagePath: string,
  agents: readonly WorkflowSourceItem[],
): void {
  const agentsRoot = join(generatedPackagePath, "agents");
  mkdirSync(agentsRoot, { recursive: true });
  writeFileSync(
    join(agentsRoot, "index.ts"),
    [
      'import type { RunTaskAgentError, RunTaskAgentResult, RunTaskAgentSourceInput } from "@svvy/core";',
      'import type { AgentLike } from "smithers-orchestrator";',
      `import type { ExtensionId } from "${GENERATED_EXTENSIONS_PACKAGE_NAME}";`,
      "",
      'export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";',
      "export type ReasoningSelection = { effort: ReasoningEffort };",
      "export type TaskAgentExtensionId = ExtensionId;",
      'export type TaskAgentExtensionOverrideState = "loaded" | "available" | "unavailable";',
      "export interface TaskAgentParametersSource {",
      "  id: string;",
      "  label: string;",
      "  provider: string;",
      "  model: string;",
      "  reasoning: ReasoningSelection;",
      "  instructions: string;",
      "  overrides?: Record<TaskAgentExtensionId, TaskAgentExtensionOverrideState>;",
      "}",
      "declare const process: { env?: Record<string, string | undefined> } | undefined;",
      "type GenerateArgs = {",
      "  prompt?: unknown;",
      "  messages?: unknown;",
      "  rootDir?: unknown;",
      "  resumeSession?: unknown;",
      "  continueSession?: unknown;",
      "  taskContext?: unknown;",
      "  run?: unknown;",
      "  node?: unknown;",
      "  iteration?: unknown;",
      "  attempt?: unknown;",
      "  maxOutputBytes?: unknown;",
      "  onEvent?: (text: string) => void;",
      "  onStdout?: (text: string) => void;",
      "  onStderr?: (text: string) => void;",
      "};",
      "const WORKFLOW_TASK_AGENT_BRIDGE_MAX_RESPONSE_BYTES = 1048576;",
      "function readRequiredEnv(name: string): string {",
      '  const value = typeof process === "undefined" ? undefined : process.env?.[name];',
      "  if (!value) {",
      "    throw new Error(`Missing required svvy workflow task-agent bridge env var: ${name}`);",
      "  }",
      "  return value;",
      "}",
      "function readOptionalPositiveIntegerEnv(name: string): number | undefined {",
      '  const value = typeof process === "undefined" ? undefined : process.env?.[name];',
      '  if (value === undefined || value === "") {',
      "    return undefined;",
      "  }",
      "  const parsed = Number(value);",
      "  if (!Number.isSafeInteger(parsed) || parsed <= 0) {",
      "    throw new Error(`Invalid svvy workflow task-agent bridge env var: ${name} must be a positive integer.`);",
      "  }",
      "  return parsed;",
      "}",
      "function readOptionalPositiveIntegerValue(name: string, value: unknown): number | undefined {",
      "  if (value === undefined) {",
      "    return undefined;",
      "  }",
      '  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {',
      "    throw new Error(`Invalid svvy workflow task-agent bridge option: ${name} must be a positive integer.`);",
      "  }",
      "  return value;",
      "}",
      "function isBridgeRecord(value: unknown): value is Record<string, unknown> {",
      '  return Boolean(value) && typeof value === "object" && !Array.isArray(value);',
      "}",
      "function stringField(value: unknown, key: string): string | undefined {",
      '  return isBridgeRecord(value) && typeof value[key] === "string" ? value[key] : undefined;',
      "}",
      "function readSmithersTaskIdentity(args: GenerateArgs): Record<string, unknown> {",
      "  const taskContext = isBridgeRecord(args.taskContext) ? args.taskContext : {};",
      "  const run = isBridgeRecord(args.run) ? args.run : isBridgeRecord(taskContext.run) ? taskContext.run : {};",
      "  const node = isBridgeRecord(args.node) ? args.node : isBridgeRecord(taskContext.node) ? taskContext.node : {};",
      "  const fields: Record<string, unknown> = {};",
      '  const runId = stringField(taskContext, "smithersRunId") ?? stringField(taskContext, "runId") ?? stringField(run, "id") ?? stringField(run, "runId");',
      "  if (runId !== undefined) fields.runId = runId;",
      '  const nodeId = stringField(taskContext, "nodeId") ?? stringField(node, "id") ?? stringField(node, "nodeId") ?? stringField(taskContext, "taskId");',
      "  if (nodeId !== undefined) fields.nodeId = nodeId;",
      '  const iteration = typeof args.iteration === "number" ? args.iteration : isBridgeRecord(args.iteration) && typeof args.iteration.index === "number" ? args.iteration.index : typeof taskContext.iteration === "number" ? taskContext.iteration : isBridgeRecord(taskContext.iteration) && typeof taskContext.iteration.index === "number" ? taskContext.iteration.index : undefined;',
      "  if (iteration !== undefined) fields.iteration = iteration;",
      '  const attempt = typeof args.attempt === "number" ? args.attempt : isBridgeRecord(args.attempt) && typeof args.attempt.index === "number" ? args.attempt.index : typeof taskContext.attempt === "number" ? taskContext.attempt : isBridgeRecord(taskContext.attempt) && typeof taskContext.attempt.index === "number" ? taskContext.attempt.index : undefined;',
      "  if (attempt !== undefined) fields.attempt = attempt;",
      "  return fields;",
      "}",
      "function readSmithersContext(args: GenerateArgs): Record<string, unknown> | undefined {",
      "  const context: Record<string, unknown> = {};",
      "  if (args.run !== undefined) context.run = args.run;",
      "  if (args.node !== undefined) context.node = args.node;",
      '  if (typeof args.rootDir === "string") context.rootDir = args.rootDir;',
      "  return Object.keys(context).length > 0 ? context : undefined;",
      "}",
      "function normalizeBridgeMessages(value: unknown): unknown {",
      "  if (!Array.isArray(value)) return value;",
      "  return value.map((message) => {",
      "    if (!isBridgeRecord(message)) return message;",
      '    const text = typeof message.text === "string" ? message.text : message.content;',
      "    return { role: message.role, text };",
      "  });",
      "}",
      "function readPromptSource(args: GenerateArgs): Record<string, unknown> {",
      '  const hasPrompt = typeof args.prompt === "string";',
      "  const hasMessages = args.messages !== undefined;",
      "  if (hasPrompt && !hasMessages) {",
      '    return { kind: "prompt", prompt: args.prompt };',
      "  }",
      "  if (!hasPrompt && hasMessages) {",
      '    return { kind: "messages", messages: normalizeBridgeMessages(args.messages) };',
      "  }",
      '  throw new Error("svvy workflow task-agent requires exactly one prompt source: provide either prompt or messages.");',
      "}",
      "function bridgeErrorMessage(value: unknown): string {",
      "  const error = value as Partial<RunTaskAgentError>;",
      '  return typeof error.message === "string" ? error.message : "Malformed bridge error response";',
      "}",
      "function bridgeErrorCode(value: unknown): string {",
      "  const error = value as Partial<RunTaskAgentError>;",
      '  return typeof error.error === "string" ? error.error : "unknown";',
      "}",
      "function decodeBridgeResult(value: unknown): RunTaskAgentResult {",
      '  if (!isBridgeRecord(value) || typeof value.text !== "string") {',
      '    throw new Error("Malformed svvy workflow task-agent bridge success response");',
      "  }",
      "  return value as RunTaskAgentResult;",
      "}",
      "function emitGenerateText(args: GenerateArgs, text: string): void {",
      "  args.onEvent?.(text);",
      "  args.onStdout?.(`${text}\\n`);",
      "}",
      "function emitGenerateError(args: GenerateArgs, text: string): void {",
      "  args.onEvent?.(text);",
      "  args.onStderr?.(`${text}\\n`);",
      "}",
      "async function readBridgeResponseText(response: Response, maxResponseBytes: number): Promise<string> {",
      "  if (!response.body) {",
      '    return "";',
      "  }",
      "  const reader = response.body.getReader();",
      "  const chunks: Uint8Array[] = [];",
      "  let totalBytes = 0;",
      "  while (true) {",
      "    const { done, value } = await reader.read();",
      "    if (done) {",
      "      break;",
      "    }",
      "    if (!value) {",
      "      continue;",
      "    }",
      "    totalBytes += value.byteLength;",
      "    if (totalBytes > maxResponseBytes) {",
      "      await reader.cancel().catch(() => undefined);",
      '      throw new Error("svvy workflow task-agent bridge response exceeded the configured byte limit.");',
      "    }",
      "    chunks.push(value);",
      "  }",
      "  const body = new Uint8Array(totalBytes);",
      "  let offset = 0;",
      "  for (const chunk of chunks) {",
      "    body.set(chunk, offset);",
      "    offset += chunk.byteLength;",
      "  }",
      "  return new TextDecoder().decode(body);",
      "}",
      "async function callTaskAgentBridge(parameters: TaskAgentParametersSource, rawArgs: unknown): Promise<RunTaskAgentResult> {",
      '  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as GenerateArgs;',
      '  const bridgeUrl = readRequiredEnv("SVVY_WORKFLOW_AGENT_BRIDGE_URL");',
      '  const bridgeToken = readRequiredEnv("SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN");',
      '  const workspaceSessionId = readRequiredEnv("SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID");',
      '  const sourceCommandId = readRequiredEnv("SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID");',
      '  const timeoutMs = readOptionalPositiveIntegerEnv("SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS");',
      '  const configuredMaxResponseBytes = readOptionalPositiveIntegerEnv("SVVY_WORKFLOW_AGENT_BRIDGE_MAX_RESPONSE_BYTES");',
      '  const maxResponseBytes = readOptionalPositiveIntegerValue("maxOutputBytes", args.maxOutputBytes) ?? configuredMaxResponseBytes ?? WORKFLOW_TASK_AGENT_BRIDGE_MAX_RESPONSE_BYTES;',
      "  const smithersContext = readSmithersContext(args);",
      "  const promptSource = readPromptSource(args);",
      "  const payload = {",
      '    operation: "runTaskAgent",',
      "    agent: parameters,",
      "    taskIdentity: readSmithersTaskIdentity(args),",
      "    ...(smithersContext ? { smithersContext } : {}),",
      "    promptSource,",
      "    workspaceSessionId,",
      "    sourceCommandId,",
      "  } as RunTaskAgentSourceInput;",
      "  let body: string;",
      "  try {",
      "    body = JSON.stringify(payload);",
      "  } catch (error) {",
      '    const message = error instanceof Error ? error.message : "Unknown serialization error";',
      "    throw new Error(`Unable to serialize svvy workflow task-agent bridge payload: ${message}`);",
      "  }",
      "  const timeoutController = timeoutMs === undefined ? undefined : new AbortController();",
      "  const timeoutHandle = timeoutMs === undefined ? undefined : setTimeout(() => timeoutController?.abort(), timeoutMs);",
      "  emitGenerateText(args, `svvy task agent ${parameters.id} started`);",
      "  try {",
      "    const response = await fetch(bridgeUrl, {",
      '      method: "POST",',
      "      headers: {",
      '        "authorization": `Bearer ${bridgeToken}`,',
      '        "content-type": "application/json",',
      "      },",
      "      body,",
      "      ...(timeoutController ? { signal: timeoutController.signal } : {}),",
      "    });",
      "    const responseText = await readBridgeResponseText(response, maxResponseBytes);",
      "    const responseBody = responseText.length > 0 ? parseBridgeJson(responseText) : {};",
      "    if (!response.ok) {",
      "      throw new Error(`svvy workflow task-agent bridge rejected runTaskAgent (${response.status} ${bridgeErrorCode(responseBody)}): ${bridgeErrorMessage(responseBody)}`);",
      "    }",
      "    const result = decodeBridgeResult(responseBody);",
      "    emitGenerateText(args, `svvy task agent ${parameters.id} finished`);",
      "    return result;",
      "  } catch (error) {",
      "    const message = error instanceof Error ? error.message : String(error);",
      "    emitGenerateError(args, `svvy task agent ${parameters.id} failed: ${message}`);",
      "    throw error;",
      "  } finally {",
      "    if (timeoutHandle !== undefined) {",
      "      clearTimeout(timeoutHandle);",
      "    }",
      "  }",
      "}",
      "function parseBridgeJson(text: string): unknown {",
      "  try {",
      "    return JSON.parse(text);",
      "  } catch (error) {",
      '    const message = error instanceof Error ? error.message : "Unknown JSON parse error";',
      "    throw new Error(`Malformed svvy workflow task-agent bridge response: ${message}`);",
      "  }",
      "}",
      "export function defineTaskAgent<T extends TaskAgentParametersSource>(parameters: T): AgentLike {",
      "  return {",
      "    id: parameters.id,",
      "    generate: (args: unknown) => callTaskAgentBridge(parameters, args),",
      "  };",
      "}",
      ...agents.map((item) => `export { ${item.exportName} } from "./${item.exportName}";`),
      "",
    ].join("\n"),
  );
  for (const agent of agents) {
    mkdirSync(dirname(agent.generatedPath), { recursive: true });
    writeFileSync(
      agent.generatedPath,
      [
        'import type { TaskAgentParametersSource } from "./index";',
        `import { Extensions } from "${GENERATED_EXTENSIONS_PACKAGE_NAME}";`,
        "",
        `export const ${agent.exportName} = ${serializeAgentParameters(agent.agentParameters ?? {})} satisfies TaskAgentParametersSource;`,
        "",
      ].join("\n"),
    );
  }
}

function serializeAgentParameters(parameters: Record<string, unknown>): string {
  const { overrides, extensionOrder: _extensionOrder, ...rest } = parameters;
  const overrideEntries = isRecord(overrides)
    ? Object.entries(overrides).filter(
        (entry): entry is [string, TaskAgentExtensionOverrideState] =>
          isTaskAgentExtensionOverrideState(entry[1]),
      )
    : [];
  const prefix = JSON.stringify(rest, null, 2).replace(/\n}$/, "");
  if (overrideEntries.length === 0) {
    return `${prefix}\n}`;
  }
  const separator = prefix === "{" ? "" : ",";
  return [
    prefix,
    `${separator}\n  "overrides": {${overrideEntries.map(([id, state]) => `\n    [${generatedExtensionReferenceExpression(id)}]: ${JSON.stringify(state)},`).join("")}\n  }`,
    "}",
  ].join("");
}

function writeNamespaceFiles(
  generatedPackagePath: string,
  namespaceDir: "components" | "prompts" | "workflows",
  items: readonly WorkflowSourceItem[],
): void {
  const root = join(generatedPackagePath, namespaceDir);
  const kind = WORKFLOW_NAMESPACE_BY_DIR[namespaceDir].kind;
  const namespaceItems = items.filter((item) => item.kind === kind);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "index.ts"),
    [...namespaceItems.map((item) => `export * from "./${item.exportName}";`), ""].join("\n"),
  );
  for (const item of namespaceItems) {
    mkdirSync(dirname(item.generatedPath), { recursive: true });
    if (item.kind === "prompt") {
      writeFileSync(
        item.generatedPath,
        [`export const ${item.exportName} = ${JSON.stringify(item.sourceCode)};`, ""].join("\n"),
      );
    } else {
      writeFileSync(item.generatedPath, item.sourceCode);
    }
  }
}

function workflowSourcePath(input: {
  exportName: string;
  kind: WorkspaceWorkflowsGeneratedKind;
  sourceExtension?: string;
  sourceRoot: string;
}): string {
  const dirName = SOURCE_DIR_BY_KIND[input.kind];
  const extension =
    input.kind === "agent"
      ? ".agent.json"
      : (input.sourceExtension ?? defaultSourceExtension(input.kind));
  return join(input.sourceRoot, dirName, `${input.exportName}${extension}`);
}

function defaultSourceExtension(kind: WorkspaceWorkflowsGeneratedKind): string {
  if (kind === "prompt") return ".mdx";
  if (kind === "workflow") return ".tsx";
  if (kind === "component") return ".ts";
  return ".agent.json";
}

function generatedExtensionForSource(
  kind: WorkspaceWorkflowsGeneratedKind,
  sourceExtension: string,
): string {
  if (kind === "prompt") return ".ts";
  if (kind === "workflow") return ".tsx";
  if (kind === "component") return sourceExtension === ".tsx" ? ".tsx" : ".ts";
  return ".ts";
}

function validateSourceExtension(
  kind: Exclude<WorkspaceWorkflowsGeneratedKind, "agent">,
  extension: string,
  path: string,
): void {
  if (!sourceExtensionMatchesKind(kind, extension, path)) {
    throw workflowLibraryError(
      "invalid_source",
      `Unsupported ${kind} source extension: ${extension}`,
      path,
    );
  }
}

function sourceExtensionMatchesKind(
  kind: WorkspaceWorkflowsGeneratedKind,
  extension: string,
  path: string,
): boolean {
  if (kind === "agent") return path.endsWith(".agent.json");
  if (kind === "prompt") return extension === ".mdx";
  if (kind === "workflow") return extension === ".tsx";
  return extension === ".ts" || extension === ".tsx";
}

function assertValidExportName(exportName: string): void {
  if (!isValidExportName(exportName)) {
    throw workflowLibraryError("invalid_argument", `Invalid Workflows export name: ${exportName}`);
  }
}

function isValidExportName(exportName: string): boolean {
  return isValidWorkflowExportName(exportName);
}

function stringProperty(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class WorkflowLibraryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path?: string,
    readonly exportName?: string,
  ) {
    super(message);
    this.name = "WorkflowLibraryError";
  }
}

function workflowLibraryError(
  code: string,
  message: string,
  path?: string,
  exportName?: string,
): WorkflowLibraryError {
  return new WorkflowLibraryError(code, message, path, exportName);
}

function walkFiles(root: string): string[] {
  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else {
        files.push(path);
      }
    }
  }
  return files.toSorted();
}
