import { getModels, getProviders, getSupportedThinkingLevels } from "@mariozechner/pi-ai";
import {
  decodeUnknownTaskAgentParametersSourceExit,
  type SvvyxWorkflowsRuntimeRequest,
  type SvvyxWorkflowsRuntimeResponse,
} from "@svvy/core";
import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import * as Exit from "effect/Exit";
import type { ReasoningEffort } from "../shared/agent-settings";
import type { AuthKeyType, WorkspaceWorkflowsGeneratedKind } from "../shared/workspace-contract";
import type { AgentProfileMutationStore } from "./agent-profile-mutation-store";
import { resolveAuthState } from "./auth-store";
import {
  copyWorkflowSourceItem,
  extractWorkflowAgentParametersFromSource,
  extractWorkflowSourceExportItem,
  getWorkflowSourcePath,
  readWorkflowsGeneratedReadModel,
  WorkflowLibraryError,
  type WorkflowsBuildDiagnostic,
} from "./smithers-runtime/workflow-library";

export type SvvyxWorkflowsCommandResult = {
  output: unknown;
  commandFacts: Record<string, unknown>;
};

export type SvvyxWorkflowsAuthSource = Exclude<AuthKeyType, "none"> | "missing";

export type SvvyxWorkflowsModelChoice = {
  providerId: string;
  modelId: string;
  providerAuthenticated: boolean;
  authSource: SvvyxWorkflowsAuthSource;
  supportedReasoning: ReasoningEffort[];
  capabilities: {
    reasoning: boolean;
    vision: boolean;
    toolCalling: boolean;
  };
};

export type SvvyxWorkflowsModelCatalogReader = () => SvvyxWorkflowsModelChoice[];

export type AgentModelSelection = {
  providerId: string;
  modelId: string;
  reasoningEffort: ReasoningEffort;
};

export class AgentModelSelectionError extends Error {
  constructor(
    readonly code:
      | "invalid_agent_model"
      | "invalid_agent_reasoning"
      | "invalid_agent_provider_auth",
    message: string,
    readonly selection: AgentModelSelection,
    readonly supportedReasoning: ReasoningEffort[] = [],
  ) {
    super(message);
    this.name = "AgentModelSelectionError";
  }
}

export function assertAgentModelSelection(
  selection: AgentModelSelection,
  modelCatalog: readonly SvvyxWorkflowsModelChoice[] = readDefaultModelCatalog(),
): SvvyxWorkflowsModelChoice {
  const modelChoice = modelCatalog.find(
    (choice) => choice.providerId === selection.providerId && choice.modelId === selection.modelId,
  );
  if (!modelChoice) {
    throw new AgentModelSelectionError(
      "invalid_agent_model",
      `Agent profile references unavailable model ${selection.providerId}/${selection.modelId}.`,
      selection,
    );
  }
  if (!modelChoice.supportedReasoning.includes(selection.reasoningEffort)) {
    throw new AgentModelSelectionError(
      "invalid_agent_reasoning",
      `Agent profile references unsupported reasoning level ${selection.reasoningEffort} for ${selection.providerId}/${selection.modelId}.`,
      selection,
      [...modelChoice.supportedReasoning],
    );
  }
  if (!modelChoice.providerAuthenticated) {
    throw new AgentModelSelectionError(
      "invalid_agent_provider_auth",
      `Agent profile references unauthenticated provider ${selection.providerId}.`,
      selection,
      [...modelChoice.supportedReasoning],
    );
  }
  return modelChoice;
}

export async function runSvvyxWorkflowsCommand(input: {
  agentProfileStore?: AgentProfileMutationStore;
  command: string;
  cwd?: string;
  extensionsRoot?: string;
  extensionsGeneratedPackagePath?: string;
  generatedPackagePath?: string;
  readModelCatalog?: SvvyxWorkflowsModelCatalogReader;
  sourceRoot?: string;
  sourceCommandId?: string;
  requestWorkflowsRuntime?: (
    request: SvvyxWorkflowsRuntimeRequest,
  ) => Promise<SvvyxWorkflowsRuntimeResponse>;
  workspaceCwd?: string;
}): Promise<SvvyxWorkflowsCommandResult> {
  const words = splitCommandLine(input.command);
  if (words[0] !== "svvyx" || words[1] !== "workflows") {
    throw workflowsCommandError("invalid_argument", "Expected svvyx workflows command.");
  }
  if (hasShellControlSyntax(input.command)) {
    throw workflowsCommandError(
      "invalid_argument",
      "svvyx workflows commands must be invoked as a standalone command.",
    );
  }
  const commandId = words[2];
  if (!commandId) {
    throw workflowsCommandError("invalid_argument", "Missing Workflows command.");
  }

  if (commandId === "models") {
    return runModelsCommand(words.slice(3), input.readModelCatalog ?? readDefaultModelCatalog);
  }
  if (commandId === "build") {
    return await runBuildCommand(words.slice(3), {
      requestWorkflowsRuntime: input.requestWorkflowsRuntime,
      sourceCommandId: input.sourceCommandId,
    });
  }
  if (commandId === "save") {
    return await runSaveCommand(words.slice(3), {
      agentProfileStore: input.agentProfileStore,
      cwd: input.cwd,
      extensionsRoot: input.extensionsRoot,
      extensionsGeneratedPackagePath: input.extensionsGeneratedPackagePath,
      generatedPackagePath: input.generatedPackagePath,
      modelCatalog: (input.readModelCatalog ?? readDefaultModelCatalog)(),
      sourceRoot: input.sourceRoot,
      sourceCommandId: input.sourceCommandId,
      requestWorkflowsRuntime: input.requestWorkflowsRuntime,
      workspaceCwd: input.workspaceCwd,
    });
  }

  if (commandId !== "list") {
    throw workflowsCommandError(
      "unsupported_command",
      `Unsupported Workflows command: ${commandId}`,
    );
  }
  const flags = parseFlags(words.slice(3));
  requireJson(flags);
  rejectUnknownFlags(flags, ["kind", "json"]);
  const kind = parseKind(singleFlag(flags, "kind"));
  const model = await readWorkflowsGeneratedReadModel(input.generatedPackagePath, {
    sourceRoot: input.sourceRoot,
  });
  const items = model.items
    .filter((item) => !kind || item.kind === kind)
    .map((item) => ({
      kind: item.kind,
      namespace: item.namespace,
      exportName: item.exportName,
      qualifiedName: item.qualifiedName,
      workflowAgentId: item.workflowAgentId,
      sourcePath: item.sourcePath,
      generatedPath: item.generatedPath,
    }));
  return {
    output: { items },
    commandFacts: {
      workflowExportCount: items.length,
      ...(kind ? { workflowExportKind: kind } : {}),
    },
  };
}

async function runBuildCommand(
  words: string[],
  options: {
    requestWorkflowsRuntime?: (
      request: SvvyxWorkflowsRuntimeRequest,
    ) => Promise<SvvyxWorkflowsRuntimeResponse>;
    sourceCommandId?: string;
  },
): Promise<SvvyxWorkflowsCommandResult> {
  const flags = parseFlags(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["json"]);
  if (!options.requestWorkflowsRuntime) {
    throw workflowsCommandError(
      "runtime_authority_unavailable",
      "Workflows builds require the runtime-owned generated-package authority.",
    );
  }
  const response = await options.requestWorkflowsRuntime({
    operation: "build",
    input: options.sourceCommandId ? { sourceCommandId: options.sourceCommandId as never } : {},
  });
  assertWorkflowsRuntimeBuildSucceeded(response);
  return response;
}

async function runSaveCommand(
  words: string[],
  options: {
    agentProfileStore?: AgentProfileMutationStore;
    cwd?: string;
    extensionsRoot?: string;
    extensionsGeneratedPackagePath?: string;
    generatedPackagePath?: string;
    modelCatalog: readonly SvvyxWorkflowsModelChoice[];
    sourceRoot?: string;
    sourceCommandId?: string;
    requestWorkflowsRuntime?: (
      request: SvvyxWorkflowsRuntimeRequest,
    ) => Promise<SvvyxWorkflowsRuntimeResponse>;
    workspaceCwd?: string;
  },
): Promise<SvvyxWorkflowsCommandResult> {
  const flags = parseFlags(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["as", "export", "from", "json", "kind", "overwrite"]);
  const from = requiredFlag(flags, "from");
  const kind = parseRequiredKind(requiredFlag(flags, "kind"));
  const exportName = requiredFlag(flags, "as");
  const sourceExportName = singleFlag(flags, "export");
  const overwrite = flags.has("overwrite");
  const fromPath = resolve(options.cwd ?? process.cwd(), from);
  if (!existsSync(fromPath)) {
    throw workflowsCommandError("source_not_found", `Workflows source not found: ${fromPath}`);
  }
  if (!statSync(fromPath).isFile()) {
    throw workflowsCommandError("invalid_source", `Workflows source is not a file: ${fromPath}`);
  }
  assertWorkspaceSmithersSourcePath(fromPath, options.workspaceCwd ?? options.cwd ?? process.cwd());

  const sourceExtension = kind === "agent" ? ".agent.json" : extname(fromPath);
  const targetPath = getWorkflowSourcePath({
    exportName,
    kind,
    sourceExtension,
    sourceRoot: options.sourceRoot,
  });

  if (kind === "agent") {
    let extracted: ReturnType<typeof extractWorkflowAgentParametersFromSource>;
    try {
      extracted = extractWorkflowAgentParametersFromSource({
        exportName: sourceExportName,
        path: fromPath,
        sourceRoot: options.sourceRoot,
      });
    } catch (error) {
      if (error instanceof WorkflowLibraryError) {
        throw workflowsCommandError(error.code, error.message, [
          {
            code: error.code,
            message: error.message,
            path: error.path,
            exportName: error.exportName,
          },
        ]);
      }
      throw error;
    }
    const source: Record<string, unknown> = { ...extracted.parameters, id: exportName };
    const { extensionOrder: rawExtensionOrder, ...parameters } = source;
    const decoded = decodeUnknownTaskAgentParametersSourceExit(parameters);
    if (
      Exit.isFailure(decoded) ||
      (rawExtensionOrder !== undefined &&
        (!Array.isArray(rawExtensionOrder) ||
          !rawExtensionOrder.every((extensionId) => typeof extensionId === "string")))
    ) {
      throw workflowsCommandError(
        "invalid_agent_source",
        `Workflow agent ${exportName} must match TaskAgentParametersSource.`,
      );
    }
    const agentProfileStore = options.agentProfileStore;
    if (!agentProfileStore) {
      throw workflowsCommandError(
        "runtime_authority_unavailable",
        "Workflow-agent saves require the runtime-owned source edit authority.",
      );
    }
    const agent = decoded.value;
    const sourceText = `${JSON.stringify(source, null, 2)}\n`;
    agentProfileStore.upsertWorkflowAgentSource({
      sourceId: exportName,
      overwrite,
      draft: {
        label: agent.label,
        provider: agent.provider,
        model: agent.model,
        reasoningEffort: agent.reasoning.effort,
        instructions: agent.instructions,
        overrides: { ...agent.overrides },
        extensionOrder: (rawExtensionOrder as string[] | undefined) ?? [],
      },
      text: sourceText,
      ...(options.sourceCommandId ? { sourceCommandId: options.sourceCommandId } : {}),
    });
    return {
      output: {
        ok: true,
        sourcePath: targetPath,
        exportName,
        kind,
      },
      commandFacts: {
        workflowSavedExportName: exportName,
        workflowSavedKind: kind,
        workflowSourcePath: targetPath,
        workflowSourceSaveRequested: true,
      },
    };
  }

  const previous = existsSync(targetPath) ? readFileSync(targetPath) : null;

  try {
    if (sourceExportName && kind === "prompt") {
      throw workflowsCommandError(
        "invalid_argument",
        "Workflows prompt sources are direct MDX and do not support --export.",
      );
    } else if (sourceExportName && (kind === "component" || kind === "workflow")) {
      extractWorkflowSourceExportItem({
        exportName,
        fromPath,
        kind,
        overwrite,
        sourceExportName,
        sourceRoot: options.sourceRoot,
      });
    } else {
      copyWorkflowSourceItem({
        exportName,
        fromPath,
        kind,
        overwrite,
        sourceRoot: options.sourceRoot,
      });
    }

    if (!options.requestWorkflowsRuntime) {
      restoreSourceAfterFailedSave(targetPath, previous);
      throw workflowsCommandError(
        "runtime_authority_unavailable",
        "Workflows saves require the runtime-owned generated-package authority.",
      );
    }
    const build = await options.requestWorkflowsRuntime({
      operation: "build",
      input: options.sourceCommandId ? { sourceCommandId: options.sourceCommandId as never } : {},
    });
    assertWorkflowsRuntimeBuildSucceeded(build);
    return {
      output: {
        ...(build.output as Record<string, unknown>),
        sourcePath: targetPath,
        exportName,
        kind,
      },
      commandFacts: {
        ...build.commandFacts,
        workflowSavedExportName: exportName,
        workflowSavedKind: kind,
        workflowSourcePath: targetPath,
      },
    };
  } catch (error) {
    restoreSourceAfterFailedSave(targetPath, previous);
    if (error instanceof WorkflowLibraryError) {
      throw workflowsCommandError(error.code, error.message, [
        {
          code: error.code,
          message: error.message,
          path: error.path,
          exportName: error.exportName,
        },
      ]);
    }
    throw error;
  }
}

function runtimeBuildFailure(output: unknown): {
  message: string;
  diagnostics?: WorkflowsBuildDiagnostic[];
} | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const candidate = output as {
    ok?: unknown;
    error?: { message?: unknown; diagnostics?: unknown };
  };
  if (candidate.ok !== false) return null;
  const diagnostics = Array.isArray(candidate.error?.diagnostics)
    ? candidate.error.diagnostics.filter((value): value is WorkflowsBuildDiagnostic =>
        Boolean(value && typeof value === "object" && typeof value.message === "string"),
      )
    : undefined;
  return {
    message:
      typeof candidate.error?.message === "string"
        ? candidate.error.message
        : "Workflows build failed.",
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export function assertWorkflowsRuntimeBuildSucceeded(
  response: SvvyxWorkflowsRuntimeResponse,
): void {
  const failure = runtimeBuildFailure(response.output);
  if (failure) {
    throw workflowsCommandError("build_failed", failure.message, failure.diagnostics);
  }
}

function restoreSourceAfterFailedSave(targetPath: string, previous: Buffer | null): void {
  if (previous === null) {
    rmSync(targetPath, { force: true });
    return;
  }
  writeFileSync(targetPath, previous);
}

function assertWorkspaceSmithersSourcePath(fromPath: string, cwd: string): void {
  const workspaceRoot = realpathSync(cwd);
  const sourceRealPath = realpathSync(fromPath);
  const smithersRoot = join(workspaceRoot, ".smithers");
  const relativeToSmithers = relative(smithersRoot, sourceRealPath).replace(/\\/g, "/");
  if (
    relativeToSmithers === "" ||
    relativeToSmithers.startsWith("../") ||
    relativeToSmithers.startsWith("/") ||
    relativeToSmithers.startsWith("node_modules/")
  ) {
    throw workflowsCommandError(
      "invalid_source",
      "Workflows save source must be a workspace .smithers source file, not repository source, generated output, or package-link plumbing.",
      [
        {
          code: "invalid_source",
          message:
            "Workflows save source must be a workspace .smithers source file, not repository source, generated output, or package-link plumbing.",
          path: fromPath,
        },
      ],
    );
  }
}

function runModelsCommand(
  words: string[],
  readModelCatalog: SvvyxWorkflowsModelCatalogReader,
): SvvyxWorkflowsCommandResult {
  const commandId = words[0];
  if (commandId !== "list") {
    throw workflowsCommandError(
      "unsupported_command",
      `Unsupported Workflows models command: ${commandId ?? "<missing>"}`,
    );
  }
  const flags = parseFlags(words.slice(1));
  requireJson(flags);
  rejectUnknownFlags(flags, ["json"]);
  const items = readModelCatalog().map((item) => ({
    providerId: item.providerId,
    modelId: item.modelId,
    providerAuthenticated: item.providerAuthenticated,
    authSource: item.authSource,
    supportedReasoning: item.supportedReasoning,
    capabilities: item.capabilities,
  }));
  return {
    output: { items },
    commandFacts: {
      workflowModelChoiceCount: items.length,
      workflowProviderCount: new Set(items.map((item) => item.providerId)).size,
    },
  };
}

export function readDefaultModelCatalog(): SvvyxWorkflowsModelChoice[] {
  const items: SvvyxWorkflowsModelChoice[] = [];
  for (const providerId of getProviders()) {
    const authState = resolveAuthState(providerId);
    for (const model of getModels(providerId)) {
      items.push({
        providerId,
        modelId: model.id,
        providerAuthenticated: authState.usable,
        authSource: authState.keyType === "none" ? "missing" : authState.keyType,
        supportedReasoning: getSupportedThinkingLevels(model) as ReasoningEffort[],
        capabilities: {
          reasoning: model.reasoning === true,
          vision: model.input.includes("image"),
          // pi-ai documents its model registry as tool-calling-only; it has no per-model flag.
          toolCalling: true,
        },
      });
    }
  }
  return items;
}

export function formatSvvyxWorkflowsError(error: unknown): {
  error: {
    code: string;
    diagnostics?: WorkflowsBuildDiagnostic[];
    message: string;
  };
} {
  if (error instanceof WorkflowsCommandError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.diagnostics.length > 0 ? { diagnostics: error.diagnostics } : {}),
      },
    };
  }
  if (error instanceof Error && error.message.startsWith("INVALID_ARGUMENT:")) {
    return {
      error: {
        code: "INVALID_ARGUMENT",
        message: error.message,
      },
    };
  }
  return {
    error: {
      code: "internal_error",
      message: error instanceof Error ? error.message : "Workflows command failed.",
    },
  };
}

class WorkflowsCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly diagnostics: WorkflowsBuildDiagnostic[] = [],
  ) {
    super(message);
    this.name = "WorkflowsCommandError";
  }
}

function workflowsCommandError(
  code: string,
  message: string,
  diagnostics: WorkflowsBuildDiagnostic[] = [],
): WorkflowsCommandError {
  return new WorkflowsCommandError(code, message, diagnostics);
}

function splitCommandLine(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of command.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaped) {
    current += "\\";
  }
  if (quote) {
    throw workflowsCommandError("invalid_argument", "Unterminated quoted argument.");
  }
  if (current) {
    words.push(current);
  }
  return words;
}

function hasShellControlSyntax(command: string): boolean {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (!quote && ["|", ";", "&", ">", "<"].includes(char)) {
      return true;
    }
  }
  return false;
}

function parseFlags(words: string[]): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (!word.startsWith("--")) {
      throw workflowsCommandError("invalid_argument", `Unexpected positional argument: ${word}`);
    }
    const [rawName, inlineValue] = word.slice(2).split("=", 2);
    if (!rawName) {
      throw workflowsCommandError("invalid_argument", "Invalid option.");
    }
    if (rawName === "json" || rawName === "overwrite") {
      pushFlag(flags, rawName, "true");
      continue;
    }
    const nextWord = words[index + 1];
    const value = inlineValue ?? (nextWord && !nextWord.startsWith("--") ? nextWord : undefined);
    if (!value) {
      throw workflowsCommandError("invalid_argument", `--${rawName} requires a value.`);
    }
    if (value === nextWord) {
      index += 1;
    }
    pushFlag(flags, rawName, value);
  }
  return flags;
}

function pushFlag(flags: Map<string, string[]>, name: string, value: string): void {
  const values = flags.get(name) ?? [];
  values.push(value);
  flags.set(name, values);
}

function requireJson(flags: Map<string, string[]>): void {
  if (!flags.has("json")) {
    throw workflowsCommandError("invalid_argument", "Workflows commands require --json.");
  }
}

function singleFlag(flags: Map<string, string[]>, name: string): string | undefined {
  const values = flags.get(name) ?? [];
  if (values.length > 1) {
    throw workflowsCommandError("invalid_argument", `--${name} may be provided only once.`);
  }
  return values[0];
}

function requiredFlag(flags: Map<string, string[]>, name: string): string {
  const value = singleFlag(flags, name);
  if (!value) {
    throw workflowsCommandError("invalid_argument", `--${name} is required.`);
  }
  return value;
}

function rejectUnknownFlags(flags: Map<string, string[]>, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  for (const name of flags.keys()) {
    if (!allowedSet.has(name)) {
      throw workflowsCommandError("invalid_argument", `Unsupported option: --${name}`);
    }
  }
}

function parseKind(value: string | undefined): WorkspaceWorkflowsGeneratedKind | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "agent" || value === "prompt" || value === "component" || value === "workflow") {
    return value;
  }
  throw workflowsCommandError(
    "invalid_argument",
    "kind must be agent, prompt, component, or workflow.",
  );
}

function parseRequiredKind(value: string): WorkspaceWorkflowsGeneratedKind {
  const kind = parseKind(value);
  if (!kind) {
    throw workflowsCommandError("invalid_argument", "kind must be provided.");
  }
  return kind;
}
