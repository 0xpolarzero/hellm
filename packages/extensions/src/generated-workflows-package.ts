import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  ExtensionError as CoreExtensionError,
  type AbsolutePath,
  type ExtensionError,
  type GeneratedPackageDependencyEvidence,
  type GeneratedPackageBuildId,
  type IsoDateTimeString,
} from "@svvy/core";
import {
  GENERATED_EXTENSIONS_PACKAGE_NAME,
  GENERATED_PACKAGE_EVIDENCE_MANIFEST,
  generatedExtensionReferenceExpression,
} from "./generated-extensions-package";
import { replaceGeneratedPackageDirectory } from "./generated-package-writer";

export const GENERATED_WORKFLOWS_PACKAGE_NAME = "@svvyx/workflows";

const currentGeneratedPackageTimestamp = Effect.map(DateTime.now, DateTime.formatIso);
const SMITHERS_ORCHESTRATOR_PACKAGE_NAME = "smithers-orchestrator";
const SVVY_CORE_PACKAGE_NAME = "@svvy/core";

export interface GeneratedWorkflowsPackageEvidence {
  readonly buildId: GeneratedPackageBuildId;
  readonly sourceFingerprint: string;
  readonly outputFingerprint: string;
  readonly dependencies: readonly GeneratedPackageDependencyEvidence[];
  readonly createdAt: IsoDateTimeString;
}

export interface GeneratedWorkflowsPackageFile {
  readonly relativePath: string;
  readonly contents: string;
}

export interface RefreshGeneratedWorkflowsPackageInput {
  readonly generatedPackagePath: AbsolutePath;
  readonly workflowsSourceRoot: AbsolutePath;
  readonly extensionsBuildId: GeneratedPackageBuildId;
}

export interface RefreshGeneratedWorkflowsPackageResult {
  readonly generatedPackagePath: AbsolutePath;
  readonly manifestPath: AbsolutePath;
  readonly evidence: GeneratedWorkflowsPackageEvidence;
  readonly generatedFiles: readonly {
    readonly relativePath: string;
    readonly path: AbsolutePath;
  }[];
}

type WorkflowSourceKind = "agent" | "component" | "prompt" | "workflow";

type WorkflowSourceItem = {
  readonly exportName: string;
  readonly kind: WorkflowSourceKind;
  readonly sourcePath: AbsolutePath;
  readonly sourceText: string;
  readonly relativeGeneratedPath: string;
};

const SOURCE_DIR_BY_KIND = {
  agent: "agents",
  component: "components",
  prompt: "prompts",
  workflow: "workflows",
} as const satisfies Record<WorkflowSourceKind, string>;

const SOURCE_EXTENSIONS_BY_KIND = {
  agent: [".agent.json"],
  component: [".ts", ".tsx"],
  prompt: [".mdx"],
  workflow: [".tsx"],
} as const satisfies Record<WorkflowSourceKind, readonly string[]>;
const IMPORT_KEYWORD = "import";
const FROM_KEYWORD = "from";
const GENERATED_PROCESS_ENV_EXPRESSION = ["process", "env"].join(".");

export const refreshGeneratedWorkflowsPackage = Effect.fn(
  "@svvy/extensions/refreshGeneratedWorkflowsPackage",
)(function* (input: RefreshGeneratedWorkflowsPackageInput) {
  const path = yield* Path.Path;
  const createdAt = yield* currentGeneratedPackageTimestamp;
  const items = yield* readWorkflowSourceItems(input.workflowsSourceRoot);
  const files = renderGeneratedWorkflowsPackageFiles(items, {
    createdAt,
    extensionsBuildId: input.extensionsBuildId,
  });
  const manifest = files.find((file) => file.relativePath === GENERATED_PACKAGE_EVIDENCE_MANIFEST);
  const evidence = readGeneratedWorkflowsPackageEvidenceManifest(manifest?.contents);

  yield* replaceGeneratedPackageDirectory({
    generatedPackagePath: input.generatedPackagePath,
    files,
  });

  return {
    generatedPackagePath: input.generatedPackagePath,
    manifestPath: path.join(
      input.generatedPackagePath,
      GENERATED_PACKAGE_EVIDENCE_MANIFEST,
    ) as AbsolutePath,
    evidence,
    generatedFiles: files.map((file) => ({
      relativePath: file.relativePath,
      path: path.join(input.generatedPackagePath, file.relativePath) as AbsolutePath,
    })),
  };
});

function renderGeneratedWorkflowsPackageFiles(
  items: readonly WorkflowSourceItem[],
  options: { createdAt: IsoDateTimeString; extensionsBuildId: GeneratedPackageBuildId },
): readonly GeneratedWorkflowsPackageFile[] {
  const dependencies = generatedWorkflowsPackageDependencies(options.extensionsBuildId);
  const packageJson = renderGeneratedWorkflowsPackageJson();
  const index = [
    'export * as Agents from "./agents";',
    'export * as Components from "./components";',
    'export * as Prompts from "./prompts";',
    'export * as Workflows from "./workflows";',
    "",
  ].join("\n");
  const sourceFiles = [
    ...renderAgentsFiles(items.filter((item) => item.kind === "agent")),
    ...renderNamespaceFiles(
      "components",
      items.filter((item) => item.kind === "component"),
    ),
    ...renderNamespaceFiles(
      "prompts",
      items.filter((item) => item.kind === "prompt"),
    ),
    ...renderNamespaceFiles(
      "workflows",
      items.filter((item) => item.kind === "workflow"),
    ),
  ];
  const outputFiles = [
    { relativePath: "package.json", contents: packageJson },
    { relativePath: "index.ts", contents: index },
    ...sourceFiles,
  ];
  const evidence = generatedWorkflowsPackageEvidence({
    createdAt: options.createdAt,
    dependencies,
    generatedFiles: outputFiles,
    sourceItems: items,
  });
  return [
    ...outputFiles,
    {
      relativePath: GENERATED_PACKAGE_EVIDENCE_MANIFEST,
      contents: renderGeneratedWorkflowsPackageEvidenceManifest({
        evidence,
        generatedFiles: outputFiles.map((file) => file.relativePath),
        sourceItems: items,
      }),
    },
  ];
}

function renderGeneratedWorkflowsPackageJson(): string {
  return JSON.stringify(
    {
      name: GENERATED_WORKFLOWS_PACKAGE_NAME,
      type: "module",
      exports: {
        ".": "./index.ts",
      },
    },
    null,
    2,
  );
}

function renderAgentsFiles(agents: readonly WorkflowSourceItem[]): GeneratedWorkflowsPackageFile[] {
  return [
    {
      relativePath: "agents/index.ts",
      contents: [
        renderTypeImport(
          "{ RunTaskAgentError, RunTaskAgentResult, RunTaskAgentSourceInput }",
          "@svvy/core",
        ),
        renderTypeImport("{ AgentLike }", SMITHERS_ORCHESTRATOR_PACKAGE_NAME),
        renderTypeImport("{ ExtensionId }", GENERATED_EXTENSIONS_PACKAGE_NAME),
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
        "  taskContext?: unknown;",
        "  run?: unknown;",
        "  node?: unknown;",
        "  iteration?: unknown;",
        "  attempt?: unknown;",
        "  onEvent?: (text: string) => void;",
        "  onStdout?: (text: string) => void;",
        "  onStderr?: (text: string) => void;",
        "};",
        "function readRequiredEnv(name: string): string {",
        `  const value = typeof process === "undefined" ? undefined : ${GENERATED_PROCESS_ENV_EXPRESSION}?.[name];`,
        "  if (!value) throw new Error(`Missing required svvy workflow task-agent bridge env var: ${name}`);",
        "  return value;",
        "}",
        "function readOptionalPositiveIntegerEnv(name: string): number | undefined {",
        `  const value = typeof process === "undefined" ? undefined : ${GENERATED_PROCESS_ENV_EXPRESSION}?.[name];`,
        '  if (value === undefined || value === "") return undefined;',
        "  const parsed = Number(value);",
        "  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid svvy workflow task-agent bridge env var: ${name} must be a positive integer.`);",
        "  return parsed;",
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
        '  const iteration = typeof args.iteration === "number" ? args.iteration : typeof taskContext.iteration === "number" ? taskContext.iteration : undefined;',
        "  if (iteration !== undefined) fields.iteration = iteration;",
        '  const attempt = typeof args.attempt === "number" ? args.attempt : typeof taskContext.attempt === "number" ? taskContext.attempt : undefined;',
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
        '  if (hasPrompt && !hasMessages) return { kind: "prompt", prompt: args.prompt };',
        '  if (!hasPrompt && hasMessages) return { kind: "messages", messages: normalizeBridgeMessages(args.messages) };',
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
        "async function callTaskAgentBridge(parameters: TaskAgentParametersSource, rawArgs: unknown): Promise<RunTaskAgentResult> {",
        '  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as GenerateArgs;',
        '  const bridgeUrl = readRequiredEnv("SVVY_WORKFLOW_AGENT_BRIDGE_URL");',
        '  const bridgeToken = readRequiredEnv("SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN");',
        '  const workspaceSessionId = readRequiredEnv("SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID");',
        '  const sourceCommandId = readRequiredEnv("SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID");',
        '  const timeoutMs = readOptionalPositiveIntegerEnv("SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS");',
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
        "  const body = JSON.stringify(payload);",
        "  const timeoutController = timeoutMs === undefined ? undefined : new AbortController();",
        "  const timeoutHandle = timeoutMs === undefined ? undefined : setTimeout(() => timeoutController?.abort(), timeoutMs);",
        "  emitGenerateText(args, `svvy task agent ${parameters.id} started`);",
        "  try {",
        "    const response = await fetch(bridgeUrl, {",
        '      method: "POST",',
        '      headers: { "authorization": `Bearer ${bridgeToken}`, "content-type": "application/json" },',
        "      body,",
        "      ...(timeoutController ? { signal: timeoutController.signal } : {}),",
        "    });",
        '    const responseText = await response.text().catch(() => "");',
        "    const responseBody = responseText.length > 0 ? parseBridgeJson(responseText) : {};",
        "    if (!response.ok) throw new Error(`svvy workflow task-agent bridge rejected runTaskAgent (${response.status} ${bridgeErrorCode(responseBody)}): ${bridgeErrorMessage(responseBody)}`);",
        "    emitGenerateText(args, `svvy task agent ${parameters.id} finished`);",
        "    return decodeBridgeResult(responseBody);",
        "  } catch (error) {",
        "    const message = error instanceof Error ? error.message : String(error);",
        "    emitGenerateError(args, `svvy task agent ${parameters.id} failed: ${message}`);",
        "    throw error;",
        "  } finally {",
        "    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);",
        "  }",
        "}",
        "function parseBridgeJson(text: string): unknown {",
        "  try { return JSON.parse(text); }",
        '  catch (error) { throw new Error(`Malformed svvy workflow task-agent bridge response: ${error instanceof Error ? error.message : "Unknown JSON parse error"}`); }',
        "}",
        "export function defineTaskAgent<T extends TaskAgentParametersSource>(parameters: T): AgentLike {",
        "  return { id: parameters.id, generate: (args: unknown) => callTaskAgentBridge(parameters, args) };",
        "}",
        ...agents.map((item) => `export { ${item.exportName} } from "./${item.exportName}";`),
        "",
      ].join("\n"),
    },
    ...agents.map((agent) => ({
      relativePath: agent.relativeGeneratedPath,
      contents: [
        renderTypeImport("{ TaskAgentParametersSource }", "./index"),
        renderValueImport("{ Extensions }", GENERATED_EXTENSIONS_PACKAGE_NAME),
        "",
        `export const ${agent.exportName} = ${serializeAgentParameters(agent.sourceText)} satisfies TaskAgentParametersSource;`,
        "",
      ].join("\n"),
    })),
  ];
}

function renderTypeImport(clause: string, specifier: string): string {
  return `${IMPORT_KEYWORD} type ${clause} ${FROM_KEYWORD} ${JSON.stringify(specifier)};`;
}

function renderValueImport(clause: string, specifier: string): string {
  return `${IMPORT_KEYWORD} ${clause} ${FROM_KEYWORD} ${JSON.stringify(specifier)};`;
}

function renderNamespaceFiles(
  namespace: "components" | "prompts" | "workflows",
  items: readonly WorkflowSourceItem[],
): GeneratedWorkflowsPackageFile[] {
  return [
    {
      relativePath: `${namespace}/index.ts`,
      contents: [...items.map((item) => `export * from "./${item.exportName}";`), ""].join("\n"),
    },
    ...items.map((item) => ({
      relativePath: item.relativeGeneratedPath,
      contents:
        item.kind === "prompt"
          ? [`export const ${item.exportName} = ${JSON.stringify(item.sourceText)};`, ""].join("\n")
          : item.sourceText,
    })),
  ];
}

function serializeAgentParameters(sourceText: string): string {
  const parsed = parseJsonObject(sourceText, "workflow-agent source");
  const overrides = isRecord(parsed.overrides) ? Object.entries(parsed.overrides) : [];
  const { overrides: _overrides, ...rest } = parsed;
  const prefix = JSON.stringify(rest, null, 2).replace(/\n}$/, "");
  if (overrides.length === 0) {
    return `${prefix}\n}`;
  }
  const separator = prefix === "{" ? "" : ",";
  return [
    prefix,
    `${separator}\n  "overrides": {${overrides.map(([id, state]) => `\n    [${generatedExtensionReferenceExpression(id)}]: ${JSON.stringify(state)},`).join("")}\n  }`,
    "}",
  ].join("");
}

function readWorkflowSourceItems(
  workflowsSourceRoot: AbsolutePath,
): Effect.Effect<readonly WorkflowSourceItem[], ExtensionError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const items: WorkflowSourceItem[] = [];
    for (const kind of ["agent", "component", "prompt", "workflow"] as const) {
      const sourceItems = yield* readWorkflowSourceItemsForKind(workflowsSourceRoot, kind);
      items.push(...sourceItems);
    }
    return items.toSorted((left, right) =>
      `${left.kind}:${left.exportName}`.localeCompare(`${right.kind}:${right.exportName}`),
    );
  });
}

function readWorkflowSourceItemsForKind(
  workflowsSourceRoot: AbsolutePath,
  kind: WorkflowSourceKind,
): Effect.Effect<readonly WorkflowSourceItem[], ExtensionError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sourceDir = path.join(workflowsSourceRoot, SOURCE_DIR_BY_KIND[kind]);
    const entries = yield* fs.readDirectory(sourceDir).pipe(Effect.catch(() => Effect.succeed([])));
    const items: WorkflowSourceItem[] = [];
    for (const entry of entries.toSorted()) {
      const sourcePath = path.join(sourceDir, entry);
      const stat = yield* fs.stat(sourcePath).pipe(Effect.catch(() => Effect.succeed(null)));
      if (stat?.type !== "File") {
        continue;
      }
      const sourceExtension = SOURCE_EXTENSIONS_BY_KIND[kind].find((extension) =>
        entry.endsWith(extension),
      );
      if (!sourceExtension) {
        continue;
      }
      const exportName = entry.slice(0, -sourceExtension.length);
      if (!isValidExportName(exportName)) {
        return yield* Effect.fail(
          new CoreExtensionError({
            operation: "extensions.generated-workflows.read-source",
            reason: "invalid-input",
            message: `Invalid Workflows export name: ${exportName}`,
          }),
        );
      }
      const sourceText = yield* fs.readFileString(sourcePath).pipe(
        Effect.mapError(
          (cause) =>
            new CoreExtensionError({
              operation: "extensions.generated-workflows.read-source",
              reason: "execution-failed",
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        ),
      );
      yield* validateWorkflowSourceImports({
        exportName,
        kind,
        sourcePath: sourcePath as AbsolutePath,
        sourceText,
      });
      items.push({
        exportName,
        kind,
        sourcePath: sourcePath as AbsolutePath,
        sourceText,
        relativeGeneratedPath: `${SOURCE_DIR_BY_KIND[kind]}/${exportName}${generatedExtension(kind, sourceExtension)}`,
      });
    }
    return items;
  });
}

function generatedExtension(kind: WorkflowSourceKind, sourceExtension: string): string {
  if (kind === "prompt" || kind === "agent") {
    return ".ts";
  }
  return sourceExtension === ".tsx" ? ".tsx" : ".ts";
}

function validateWorkflowSourceImports(input: {
  readonly exportName: string;
  readonly kind: WorkflowSourceKind;
  readonly sourcePath: AbsolutePath;
  readonly sourceText: string;
}): Effect.Effect<void, ExtensionError> {
  if (input.kind !== "component" && input.kind !== "workflow") {
    return Effect.void;
  }

  const forbidden = importedSpecifiers(input.sourceText).filter((specifier) =>
    isForbiddenPersistentWorkflowImport(specifier),
  );
  if (forbidden.length === 0) {
    return Effect.void;
  }

  const uniqueForbidden = [...new Set(forbidden)].toSorted();
  return Effect.fail(
    new CoreExtensionError({
      operation: "extensions.generated-workflows.validate-source-imports",
      reason: "invalid-input",
      message: `Workflows ${input.kind} ${input.exportName} imports forbidden generated-package or product modules from ${input.sourcePath}: ${uniqueForbidden.join(", ")}`,
    }),
  );
}

function importedSpecifiers(sourceText: string): readonly string[] {
  const specifiers: string[] = [];
  const importPattern =
    /\bimport\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']|\bexport\s+(?:type\s+)?[^"'`]*?\s+from\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of sourceText.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

function isForbiddenPersistentWorkflowImport(specifier: string): boolean {
  return (
    specifier === GENERATED_WORKFLOWS_PACKAGE_NAME ||
    specifier.startsWith(`${GENERATED_WORKFLOWS_PACKAGE_NAME}/`) ||
    specifier === "effect" ||
    specifier.startsWith("effect/") ||
    specifier.startsWith("@effect/") ||
    specifier.startsWith("@svvy/")
  );
}

function renderGeneratedWorkflowsPackageEvidenceManifest(input: {
  evidence: GeneratedWorkflowsPackageEvidence;
  generatedFiles: readonly string[];
  sourceItems: readonly WorkflowSourceItem[];
}): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      packageName: GENERATED_WORKFLOWS_PACKAGE_NAME,
      buildId: input.evidence.buildId,
      sourceFingerprint: input.evidence.sourceFingerprint,
      outputFingerprint: input.evidence.outputFingerprint,
      dependencies: input.evidence.dependencies,
      createdAt: input.evidence.createdAt,
      sourceItems: input.sourceItems.map((item) => ({
        kind: item.kind,
        exportName: item.exportName,
        sourcePath: item.sourcePath,
        generatedPath: item.relativeGeneratedPath,
      })),
      generatedFiles: [...input.generatedFiles],
    },
    null,
    2,
  );
}

function generatedWorkflowsPackageEvidence(input: {
  createdAt: IsoDateTimeString;
  dependencies: readonly GeneratedPackageDependencyEvidence[];
  generatedFiles: readonly { readonly relativePath: string; readonly contents: string }[];
  sourceItems: readonly WorkflowSourceItem[];
}): GeneratedWorkflowsPackageEvidence {
  const sourceFingerprint = stableFingerprint("source", [
    ...input.sourceItems.map((item) => `${item.kind}\0${item.exportName}\0${item.sourceText}`),
    ...input.dependencies.map(generatedPackageDependencyFingerprintPart),
  ]);
  const outputFingerprint = stableFingerprint("output", [
    ...input.generatedFiles.map((file) => `${file.relativePath}\0${file.contents}`),
    ...input.dependencies.map(generatedPackageDependencyFingerprintPart),
  ]);
  return {
    buildId: `${GENERATED_WORKFLOWS_PACKAGE_NAME}:${outputFingerprint}` as GeneratedPackageBuildId,
    createdAt: input.createdAt,
    dependencies: input.dependencies,
    outputFingerprint,
    sourceFingerprint,
  };
}

function readGeneratedWorkflowsPackageEvidenceManifest(
  contents: string | undefined,
): GeneratedWorkflowsPackageEvidence {
  const manifest = contents ? (JSON.parse(contents) as Record<string, unknown>) : {};
  return {
    buildId: manifest.buildId as GeneratedPackageBuildId,
    createdAt: manifest.createdAt as IsoDateTimeString,
    dependencies: Array.isArray(manifest.dependencies)
      ? manifest.dependencies
          .filter(isGeneratedPackageDependencyEvidence)
          .map((dependency) => ({ ...dependency }))
      : [],
    outputFingerprint: String(manifest.outputFingerprint ?? ""),
    sourceFingerprint: String(manifest.sourceFingerprint ?? ""),
  };
}

function generatedWorkflowsPackageDependencies(
  extensionsBuildId: GeneratedPackageBuildId,
): readonly GeneratedPackageDependencyEvidence[] {
  return [
    {
      kind: "package",
      name: SVVY_CORE_PACKAGE_NAME,
      resolution: "app-owned-package",
      version: "workspace",
    },
    {
      kind: "generated-package",
      name: GENERATED_EXTENSIONS_PACKAGE_NAME,
      buildId: extensionsBuildId,
      resolution: "generated-package-link",
    },
  ];
}

function generatedPackageDependencyFingerprintPart(
  dependency: GeneratedPackageDependencyEvidence,
): string {
  if (dependency.kind === "generated-package") {
    return `${dependency.resolution}:${dependency.name}:${dependency.buildId}`;
  }
  return `${dependency.resolution}:${dependency.name}@${dependency.version}`;
}

function isGeneratedPackageDependencyEvidence(
  value: unknown,
): value is GeneratedPackageDependencyEvidence {
  if (!isRecord(value) || typeof value.name !== "string") {
    return false;
  }
  if (value.kind === "package") {
    return (
      typeof value.version === "string" &&
      (value.resolution === "app-owned-package" || value.resolution === "package-manager")
    );
  }
  return (
    value.kind === "generated-package" &&
    (value.name === GENERATED_EXTENSIONS_PACKAGE_NAME ||
      value.name === GENERATED_WORKFLOWS_PACKAGE_NAME) &&
    typeof value.buildId === "string" &&
    value.resolution === "generated-package-link"
  );
}

function stableFingerprint(kind: string, parts: readonly string[]): string {
  let hash = 0xcbf29ce484222325n;
  for (const part of [kind, ...parts]) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= BigInt(part.charCodeAt(index));
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    hash ^= 0xffn;
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `svvy-fnv64-v1:${hash.toString(16).padStart(16, "0")}`;
}

function parseJsonObject(sourceText: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(sourceText) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidExportName(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}
