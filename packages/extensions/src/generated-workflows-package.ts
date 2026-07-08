import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  ExtensionError as CoreExtensionError,
  decodeUnknownTaskAgentParametersSourceEffect,
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

const WorkflowAgentSourceExtensionOrderSchema = Schema.Array(
  Schema.String.pipe(Schema.brand("ExtensionId")),
);
const decodeWorkflowAgentSourceExtensionOrderEffect = Schema.decodeUnknownEffect(
  WorkflowAgentSourceExtensionOrderSchema,
);

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
  readonly coreTypeContractPackageRoot: AbsolutePath;
  readonly workflowsSourceRoot: AbsolutePath;
  readonly extensionsBuildId: GeneratedPackageBuildId;
  readonly extensionIds: readonly string[];
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

export type WorkflowSourceKind = "agent" | "component" | "prompt" | "workflow";

export type WorkflowSourceItem = {
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
  const items = yield* readWorkflowSourceItems(
    input.workflowsSourceRoot,
    new Set(input.extensionIds),
  );
  const files = renderGeneratedWorkflowsPackageFiles(items, {
    createdAt,
    coreTypeContractPackageDependencySpecifier: coreTypeContractPackageDependencySpecifier({
      coreTypeContractPackageRoot: input.coreTypeContractPackageRoot,
      path,
      workflowsPackageRoot: input.generatedPackagePath,
    }),
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

export function renderGeneratedWorkflowsPackageFiles(
  items: readonly WorkflowSourceItem[],
  options: {
    createdAt: IsoDateTimeString;
    coreTypeContractPackageDependencySpecifier: string;
    extensionsBuildId: GeneratedPackageBuildId;
  },
): readonly GeneratedWorkflowsPackageFile[] {
  const dependencies = generatedWorkflowsPackageDependencies(items, options.extensionsBuildId);
  const packageJson = renderGeneratedWorkflowsPackageJson(dependencies, {
    coreTypeContractPackageDependencySpecifier: options.coreTypeContractPackageDependencySpecifier,
  });
  const ambientTypes = renderGeneratedWorkflowsAmbientTypes();
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
    { relativePath: "smithers-orchestrator.ambient.d.ts", contents: ambientTypes },
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

function renderGeneratedWorkflowsPackageJson(
  dependencies: readonly GeneratedPackageDependencyEvidence[],
  options: { coreTypeContractPackageDependencySpecifier: string },
): string {
  const devDependencies = Object.fromEntries(
    dependencies
      .filter(
        (dependency) =>
          dependency.manifestDependency === "dev-type-dependency" &&
          dependency.specifier === SVVY_CORE_PACKAGE_NAME,
      )
      .map(
        (dependency) =>
          [dependency.specifier, options.coreTypeContractPackageDependencySpecifier] as const,
      ),
  );
  return JSON.stringify(
    {
      name: GENERATED_WORKFLOWS_PACKAGE_NAME,
      type: "module",
      exports: {
        ".": "./index.ts",
      },
      ...(Object.keys(devDependencies).length > 0 ? { devDependencies } : {}),
    },
    null,
    2,
  );
}

function coreTypeContractPackageDependencySpecifier(input: {
  readonly coreTypeContractPackageRoot: AbsolutePath;
  readonly path: Path.Path;
  readonly workflowsPackageRoot: AbsolutePath;
}): string {
  const relativePath = input.path.relative(
    input.workflowsPackageRoot,
    input.coreTypeContractPackageRoot,
  );
  const packagePath = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
  return `file:${packagePath}`;
}

function renderGeneratedWorkflowsAmbientTypes(): string {
  return [
    'declare module "smithers-orchestrator" {',
    "  export type AgentLike = {",
    "    id?: string;",
    "    tools?: Record<string, unknown>;",
    "    supportsNativeStructuredOutput?: boolean;",
    "    capabilities?: unknown;",
    "    generate: (args: unknown) => Promise<unknown>;",
    "  };",
    "}",
    "",
  ].join("\n");
}

function renderAgentsFiles(agents: readonly WorkflowSourceItem[]): GeneratedWorkflowsPackageFile[] {
  return [
    {
      relativePath: "agents/index.ts",
      contents: [
        renderTypeImport(
          "{ RunTaskAgentError, RunTaskAgentPromptSource, RunTaskAgentResult, RunTaskAgentSourceInput }",
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
        "  overrides?: Partial<Record<TaskAgentExtensionId, TaskAgentExtensionOverrideState>>;",
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
        "  maxOutputBytes?: unknown;",
        "  onEvent?: (text: string) => void;",
        "  onStdout?: (text: string) => void;",
        "  onStderr?: (text: string) => void;",
        "};",
        "const WORKFLOW_TASK_AGENT_BRIDGE_MAX_RESPONSE_BYTES = 1048576;",
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
        "function readOptionalPositiveIntegerValue(name: string, value: unknown): number | undefined {",
        "  if (value === undefined) return undefined;",
        '  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid svvy workflow task-agent bridge option: ${name} must be a positive integer.`);',
        "  return value;",
        "}",
        "function isBridgeRecord(value: unknown): value is Record<string, unknown> {",
        '  return Boolean(value) && typeof value === "object" && !Array.isArray(value);',
        "}",
        "function stringField(value: unknown, key: string): string | undefined {",
        '  return isBridgeRecord(value) && typeof value[key] === "string" ? value[key] : undefined;',
        "}",
        "function readRequiredSmithersString(name: string, value: string | undefined): string {",
        '  if (typeof value !== "string" || value.length === 0) throw new Error(`svvy workflow task-agent requires Smithers task identity field: ${name}`);',
        "  return value;",
        "}",
        "function readRequiredSmithersNonNegativeInteger(name: string, value: unknown): number {",
        '  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`svvy workflow task-agent requires non-negative integer Smithers task identity field: ${name}`);',
        "  return value;",
        "}",
        'function readSmithersTaskIdentity(args: GenerateArgs): RunTaskAgentSourceInput["taskIdentity"] {',
        "  const taskContext = isBridgeRecord(args.taskContext) ? args.taskContext : {};",
        "  const run = isBridgeRecord(args.run) ? args.run : isBridgeRecord(taskContext.run) ? taskContext.run : {};",
        "  const node = isBridgeRecord(args.node) ? args.node : isBridgeRecord(taskContext.node) ? taskContext.node : {};",
        '  const runId = stringField(taskContext, "smithersRunId") ?? stringField(taskContext, "runId") ?? stringField(run, "id") ?? stringField(run, "runId");',
        '  const nodeId = stringField(taskContext, "nodeId") ?? stringField(node, "id") ?? stringField(node, "nodeId") ?? stringField(taskContext, "taskId");',
        '  const iteration = typeof args.iteration === "number" ? args.iteration : typeof taskContext.iteration === "number" ? taskContext.iteration : undefined;',
        '  const attempt = typeof args.attempt === "number" ? args.attempt : typeof taskContext.attempt === "number" ? taskContext.attempt : undefined;',
        "  return {",
        '    runId: readRequiredSmithersString("runId", runId),',
        '    nodeId: readRequiredSmithersString("nodeId", nodeId),',
        '    iteration: readRequiredSmithersNonNegativeInteger("iteration", iteration),',
        '    attempt: readRequiredSmithersNonNegativeInteger("attempt", attempt),',
        "  };",
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
        "function readPromptSource(args: GenerateArgs): RunTaskAgentPromptSource {",
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
        "async function readBridgeResponseText(response: Response, maxResponseBytes: number): Promise<string> {",
        '  if (!response.body) return "";',
        "  const reader = response.body.getReader();",
        "  const chunks: Uint8Array[] = [];",
        "  let totalBytes = 0;",
        "  while (true) {",
        "    const { done, value } = await reader.read();",
        "    if (done) break;",
        "    if (!value) continue;",
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
        "  } satisfies RunTaskAgentSourceInput;",
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
        "    const responseText = await readBridgeResponseText(response, maxResponseBytes);",
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
        ...(agentHasExtensionOverrides(agent.sourceText)
          ? [renderValueImport("{ Extensions }", GENERATED_EXTENSIONS_PACKAGE_NAME)]
          : []),
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
  const { overrides: _overrides, extensionOrder: _extensionOrder, ...rest } = parsed;
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

function agentHasExtensionOverrides(sourceText: string): boolean {
  const parsed = parseJsonObject(sourceText, "workflow-agent source");
  return isRecord(parsed.overrides) && Object.keys(parsed.overrides).length > 0;
}

function readWorkflowSourceItems(
  workflowsSourceRoot: AbsolutePath,
  generatedExtensionIds: ReadonlySet<string>,
): Effect.Effect<readonly WorkflowSourceItem[], ExtensionError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const items: WorkflowSourceItem[] = [];
    for (const kind of ["agent", "component", "prompt", "workflow"] as const) {
      const sourceItems = yield* readWorkflowSourceItemsForKind(
        workflowsSourceRoot,
        kind,
        generatedExtensionIds,
      );
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
  generatedExtensionIds: ReadonlySet<string>,
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
      if (kind === "agent") {
        yield* validateWorkflowAgentSource(sourceText, generatedExtensionIds);
      }
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

function validateWorkflowAgentSource(
  sourceText: string,
  generatedExtensionIds: ReadonlySet<string>,
): Effect.Effect<void, ExtensionError> {
  return Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => parseJsonObject(sourceText, "workflow-agent source"),
      catch: (cause) =>
        new CoreExtensionError({
          operation: "extensions.generated-workflows.validate-agent-source",
          reason: "invalid-input",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    const { extensionOrder: _extensionOrder, ...bridgeParameters } = parsed;
    if (_extensionOrder !== undefined) {
      const extensionOrder = yield* decodeWorkflowAgentSourceExtensionOrderEffect(
        _extensionOrder,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new CoreExtensionError({
              operation: "extensions.generated-workflows.validate-agent-source",
              reason: "invalid-input",
              message: "Workflow agent source extensionOrder must be an array of extension ids.",
              cause,
            }),
        ),
      );
      yield* validateWorkflowAgentExtensionIds(
        "extensionOrder",
        extensionOrder,
        generatedExtensionIds,
      );
    }
    if (isRecord(parsed.overrides)) {
      yield* validateWorkflowAgentExtensionIds(
        "overrides",
        Object.keys(parsed.overrides),
        generatedExtensionIds,
      );
    }
    yield* decodeUnknownTaskAgentParametersSourceEffect(bridgeParameters).pipe(
      Effect.mapError(
        (cause) =>
          new CoreExtensionError({
            operation: "extensions.generated-workflows.validate-agent-source",
            reason: "invalid-input",
            message: "Workflow agent source must match TaskAgentParametersSource.",
            cause,
          }),
      ),
    );
  });
}

function validateWorkflowAgentExtensionIds(
  field: "extensionOrder" | "overrides",
  extensionIds: readonly string[],
  generatedExtensionIds: ReadonlySet<string>,
): Effect.Effect<void, ExtensionError> {
  const unresolved = extensionIds.filter((extensionId) => !generatedExtensionIds.has(extensionId));
  if (unresolved.length === 0) return Effect.void;
  return Effect.fail(
    new CoreExtensionError({
      operation: "extensions.generated-workflows.validate-agent-source",
      reason: "invalid-input",
      message: `Workflow agent source ${field} references unknown generated extension ids: ${[...new Set(unresolved)].toSorted().join(", ")}`,
    }),
  );
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
  if (input.kind !== "component" && input.kind !== "workflow" && input.kind !== "prompt") {
    return Effect.void;
  }

  const importSourceText =
    input.kind === "prompt" ? stripMarkdownFencedCodeBlocks(input.sourceText) : input.sourceText;
  const forbidden = importedSpecifiers(importSourceText).filter((specifier) =>
    isForbiddenPersistentWorkflowImport(specifier, input.kind),
  );
  if (forbidden.length > 0) {
    const uniqueForbidden = [...new Set(forbidden)].toSorted();
    return Effect.fail(
      new CoreExtensionError({
        operation: "extensions.generated-workflows.validate-source-imports",
        reason: "invalid-input",
        message: `Workflows ${input.kind} ${input.exportName} imports forbidden generated-package or product modules from ${input.sourcePath}: ${uniqueForbidden.join(", ")}`,
      }),
    );
  }

  const unsupportedNonRelative = importedSpecifiers(importSourceText).filter(
    (specifier) =>
      !isRelativeImportSpecifier(specifier) && !isAllowedWorkflowSourceImport(specifier),
  );
  if (unsupportedNonRelative.length === 0) {
    return Effect.void;
  }

  const uniqueUnsupported = [...new Set(unsupportedNonRelative)].toSorted();
  return Effect.fail(
    new CoreExtensionError({
      operation: "extensions.generated-workflows.validate-source-imports",
      reason: "invalid-input",
      message: `Workflows ${input.kind} ${input.exportName} imports unsupported non-relative modules from ${input.sourcePath}: ${uniqueUnsupported.join(", ")}`,
    }),
  );
}

const COMPUTED_MODULE_SPECIFIER = "<computed module specifier>";

function stripMarkdownFencedCodeBlocks(sourceText: string): string {
  return sourceText.replace(/^(```+|~~~+)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "");
}

function importedSpecifiers(sourceText: string): readonly string[] {
  const specifiers: string[] = [];
  let index = 0;
  while (index < sourceText.length) {
    if (sourceText.startsWith("///", index)) {
      const lineEnd = sourceText.indexOf("\n", index);
      const line = sourceText.slice(index, lineEnd === -1 ? sourceText.length : lineEnd);
      const reference = line.match(/\/\/\/\s*<reference\s+(?:types|path)=["']([^"']+)["']\s*\/>/);
      if (reference?.[1]) specifiers.push(reference[1]);
      index = lineEnd === -1 ? sourceText.length : lineEnd + 1;
      continue;
    }
    const skipped = skipNonCode(sourceText, index);
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    const identifier = readIdentifier(sourceText, index);
    if (!identifier) {
      index += 1;
      continue;
    }
    if (identifier.text === "import") {
      const next = skipWhitespaceAndComments(sourceText, identifier.end);
      if (sourceText[next] === "(") {
        const argumentIndex = skipWhitespaceAndComments(sourceText, next + 1);
        specifiers.push(
          readDynamicModuleSpecifier(sourceText, argumentIndex) ?? COMPUTED_MODULE_SPECIFIER,
        );
      } else {
        const specifier = readModuleSpecifierAfterFrom(sourceText, next);
        if (specifier) specifiers.push(specifier);
        const bareSpecifier = readStringLiteral(sourceText, next);
        if (bareSpecifier) specifiers.push(bareSpecifier.value);
      }
    } else if (identifier.text === "export") {
      const specifier = readModuleSpecifierAfterFrom(sourceText, identifier.end);
      if (specifier) specifiers.push(specifier);
    } else if (identifier.text === "require") {
      const next = skipWhitespaceAndComments(sourceText, identifier.end);
      if (sourceText[next] === "(") {
        const argumentIndex = skipWhitespaceAndComments(sourceText, next + 1);
        specifiers.push(
          readDynamicModuleSpecifier(sourceText, argumentIndex) ?? COMPUTED_MODULE_SPECIFIER,
        );
      }
    }
    index = identifier.end;
  }
  return specifiers;
}

function skipNonCode(sourceText: string, index: number): number {
  const char = sourceText[index];
  if (char === "'" || char === '"' || char === "`") {
    return char === "`"
      ? skipTemplateLiteralStaticText(sourceText, index)
      : skipStringLiteral(sourceText, index);
  }
  if (sourceText.startsWith("//", index)) {
    const lineEnd = sourceText.indexOf("\n", index + 2);
    return lineEnd === -1 ? sourceText.length : lineEnd + 1;
  }
  if (sourceText.startsWith("/*", index)) {
    const commentEnd = sourceText.indexOf("*/", index + 2);
    return commentEnd === -1 ? sourceText.length : commentEnd + 2;
  }
  return index;
}

function skipWhitespaceAndComments(sourceText: string, index: number): number {
  let cursor = index;
  while (cursor < sourceText.length) {
    while (/\s/.test(sourceText[cursor] ?? "")) cursor += 1;
    if (sourceText.startsWith("//", cursor) || sourceText.startsWith("/*", cursor)) {
      const next = skipNonCode(sourceText, cursor);
      if (next === cursor) return cursor;
      cursor = next;
      continue;
    }
    return cursor;
  }
  return cursor;
}

function readDynamicModuleSpecifier(sourceText: string, index: number): string | null {
  const specifier = readStringLiteral(sourceText, index);
  if (!specifier) return null;
  const afterSpecifier = skipWhitespaceAndComments(sourceText, specifier.end);
  return sourceText[afterSpecifier] === ")" ? specifier.value : null;
}

function readIdentifier(
  sourceText: string,
  index: number,
): { readonly text: string; readonly end: number } | null {
  const match = /^[A-Za-z_$][\w$]*/.exec(sourceText.slice(index));
  if (!match) return null;
  const before = sourceText[index - 1];
  if (before && (/[\w$]/.test(before) || before === ".")) return null;
  return { text: match[0], end: index + match[0].length };
}

function readModuleSpecifierAfterFrom(sourceText: string, index: number): string | null {
  let cursor = index;
  while (cursor < sourceText.length) {
    const skipped = skipWhitespaceAndComments(sourceText, cursor);
    cursor = skipped;
    const stringLiteral = readStringLiteral(sourceText, cursor);
    if (stringLiteral) return null;
    const identifier = readIdentifier(sourceText, cursor);
    if (!identifier) {
      cursor += 1;
      continue;
    }
    if (identifier.text === "from") {
      const specifier = readStringLiteral(
        sourceText,
        skipWhitespaceAndComments(sourceText, identifier.end),
      );
      return specifier?.value ?? null;
    }
    cursor = identifier.end;
  }
  return null;
}

function readStringLiteral(
  sourceText: string,
  index: number,
): { readonly value: string; readonly end: number } | null {
  const quote = sourceText[index];
  if (quote !== "'" && quote !== '"' && quote !== "`") return null;
  let cursor = index + 1;
  let value = "";
  while (cursor < sourceText.length) {
    const char = sourceText[cursor]!;
    if (quote === "`" && char === "$" && sourceText[cursor + 1] === "{") {
      return null;
    }
    if (char === "\\") {
      value += sourceText[cursor + 1] ?? "";
      cursor += 2;
      continue;
    }
    if (char === quote) {
      return { value, end: cursor + 1 };
    }
    value += char;
    cursor += 1;
  }
  return null;
}

function skipStringLiteral(sourceText: string, index: number): number {
  const quote = sourceText[index];
  let cursor = index + 1;
  while (cursor < sourceText.length) {
    const char = sourceText[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === quote) return cursor + 1;
    cursor += 1;
  }
  return sourceText.length;
}

function skipTemplateLiteralStaticText(sourceText: string, index: number): number {
  let cursor = index + 1;
  while (cursor < sourceText.length) {
    const char = sourceText[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "$" && sourceText[cursor + 1] === "{") return cursor + 2;
    if (char === "`") return cursor + 1;
    cursor += 1;
  }
  return sourceText.length;
}

function isForbiddenPersistentWorkflowImport(specifier: string, kind: WorkflowSourceKind): boolean {
  if (specifier === COMPUTED_MODULE_SPECIFIER) {
    return true;
  }
  if (
    specifier.startsWith(`${GENERATED_EXTENSIONS_PACKAGE_NAME}/`) ||
    (kind === "prompt" &&
      (specifier === GENERATED_EXTENSIONS_PACKAGE_NAME ||
        specifier === SMITHERS_ORCHESTRATOR_PACKAGE_NAME ||
        specifier.startsWith(`${SMITHERS_ORCHESTRATOR_PACKAGE_NAME}/`)))
  ) {
    return true;
  }

  return (
    specifier === GENERATED_WORKFLOWS_PACKAGE_NAME ||
    specifier.startsWith(`${GENERATED_WORKFLOWS_PACKAGE_NAME}/`) ||
    specifier === "effect" ||
    specifier.startsWith("effect/") ||
    specifier.startsWith("@effect/") ||
    specifier.startsWith("@svvy/")
  );
}

function isRelativeImportSpecifier(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  );
}

function isAllowedWorkflowSourceImport(specifier: string): boolean {
  return (
    specifier === GENERATED_EXTENSIONS_PACKAGE_NAME ||
    specifier === SMITHERS_ORCHESTRATOR_PACKAGE_NAME
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
  const sourceFingerprint = stableFingerprint(
    "source",
    input.sourceItems.map(
      (item) => `${item.kind}\0${item.exportName}\0${item.sourcePath}\0${item.sourceText}`,
    ),
  );
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
  items: readonly WorkflowSourceItem[],
  extensionsBuildId: GeneratedPackageBuildId,
): readonly GeneratedPackageDependencyEvidence[] {
  const dependencies: GeneratedPackageDependencyEvidence[] = [
    {
      specifier: SVVY_CORE_PACKAGE_NAME,
      importKind: "type-only",
      dependencyClass: "app-owned-type-contract",
      resolutionAuthority: "app-owned-type-contract",
      manifestDependency: "dev-type-dependency",
    },
    {
      specifier: SMITHERS_ORCHESTRATOR_PACKAGE_NAME,
      importKind: items.some((item) => workflowSourceUsesSmithersValues(item))
        ? "runtime"
        : "type-only",
      dependencyClass: "workspace-authoring-external",
      resolutionAuthority: "workspace-smithers-package",
      manifestDependency: "ambient-declaration",
      version: "0.22.0",
    },
    {
      specifier: GENERATED_EXTENSIONS_PACKAGE_NAME,
      importKind: "type-only",
      dependencyClass: "generated-package",
      resolutionAuthority: "generated-package-link",
      manifestDependency: "none-generated-package-link",
      buildId: extensionsBuildId,
    },
  ];
  if (items.some((item) => workflowSourceUsesGeneratedExtensionValues(item))) {
    dependencies.push({
      specifier: GENERATED_EXTENSIONS_PACKAGE_NAME,
      importKind: "runtime",
      dependencyClass: "generated-package",
      resolutionAuthority: "generated-package-link",
      manifestDependency: "none-generated-package-link",
      buildId: extensionsBuildId,
    });
  }
  return dependencies;
}

function workflowSourceUsesSmithersValues(item: WorkflowSourceItem): boolean {
  return (
    (item.kind === "component" || item.kind === "workflow") &&
    sourceImportsSpecifier(item.sourceText, SMITHERS_ORCHESTRATOR_PACKAGE_NAME)
  );
}

function generatedPackageDependencyFingerprintPart(
  dependency: GeneratedPackageDependencyEvidence,
): string {
  return JSON.stringify(dependency);
}

function isGeneratedPackageDependencyEvidence(
  value: unknown,
): value is GeneratedPackageDependencyEvidence {
  if (
    !isRecord(value) ||
    typeof value.specifier !== "string" ||
    (value.importKind !== "type-only" && value.importKind !== "runtime")
  ) {
    return false;
  }
  if (value.dependencyClass === "app-owned-type-contract") {
    return (
      value.specifier === SVVY_CORE_PACKAGE_NAME &&
      value.importKind === "type-only" &&
      value.resolutionAuthority === "app-owned-type-contract" &&
      value.manifestDependency === "dev-type-dependency"
    );
  }
  return (
    (value.dependencyClass === "generated-package" &&
      (value.specifier === GENERATED_EXTENSIONS_PACKAGE_NAME ||
        value.specifier === GENERATED_WORKFLOWS_PACKAGE_NAME) &&
      value.resolutionAuthority === "generated-package-link" &&
      value.manifestDependency === "none-generated-package-link" &&
      typeof value.buildId === "string") ||
    (value.dependencyClass === "workspace-authoring-external" &&
      typeof value.version === "string" &&
      (value.resolutionAuthority === "workspace-smithers-package" ||
        value.resolutionAuthority === "external-ambient-declaration") &&
      (value.manifestDependency === "dependency" ||
        value.manifestDependency === "dev-type-dependency" ||
        value.manifestDependency === "peer-workspace-expectation" ||
        value.manifestDependency === "ambient-declaration")) ||
    (value.dependencyClass === "forbidden" &&
      value.resolutionAuthority === "forbidden" &&
      value.manifestDependency === "none-forbidden")
  );
}

function workflowSourceUsesGeneratedExtensionValues(item: WorkflowSourceItem): boolean {
  if (item.kind === "agent") {
    return agentHasExtensionOverrides(item.sourceText);
  }
  return (
    (item.kind === "component" || item.kind === "workflow") &&
    sourceImportsSpecifier(item.sourceText, GENERATED_EXTENSIONS_PACKAGE_NAME)
  );
}

function sourceImportsSpecifier(sourceText: string, specifier: string): boolean {
  const escaped = escapeRegExp(specifier);
  return new RegExp(
    String.raw`\b(?:import|export)\s+(?!type\b)[\s\S]*?\bfrom\s*["']${escaped}["']|import\s*\(\s*["']${escaped}["']\s*\)`,
  ).test(sourceText);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
