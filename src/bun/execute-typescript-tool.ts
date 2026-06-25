import type { NativeToolDefinition } from "@svvy/extensions";
import { Client } from "incur/client";
import { Type, type Static } from "typebox";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename } from "node:path";
import { join } from "node:path";
import { inspect } from "node:util";
import * as ts from "typescript";
import type { SvvyActorKind } from "./actor-capabilities";
import type { AgentSettingsStore } from "./agent-settings-store";
import type { AppLoggerEvent } from "./app-logger";
import type { RuntimeApprovalBoundary } from "./approval-boundary";
import { buildExecuteTypescriptApiDeclaration } from "./execute-typescript-api-declaration";
import {
  buildExecuteTypescriptLaunchPolicy,
  buildSandboxHelperArgs,
  resolveSandboxHelperPath,
  sandboxLaunchFacts,
  type FileSystemSandboxPolicy,
  type SandboxLaunchPolicy,
} from "@svvy/sandbox";
import {
  createMacOsKeychainExtensionEnvSecretStore,
  type ExtensionEnvSecretStore,
} from "./extension-env-secret-store";
import type { PromptExecutionRuntimeHandle } from "@svvy/core";
import type {
  CommandId,
  CommandFactsPayload,
  JsonValue,
  PromptExecutionSurfaceKind,
  RuntimeArtifactStatePortService,
  RuntimeCommandRecord,
  RuntimeCommandStatePortService,
  RuntimeCommandStatus,
  RuntimeCommandVisibility,
  RuntimeThreadStatePortService,
  RuntimeTurnStatePortService,
  SurfacePiSessionId,
  StateContractError,
  ThreadId,
  WorkflowTaskAttemptId,
  WorkspaceSessionId,
} from "@svvy/core";
import type * as Effect from "effect/Effect";
import {
  formatSvvyxArtifactsError,
  runSvvyxArtifactsOperation,
  type SvvyxArtifactOpenHandler,
  type SvvyxArtifactsOperationInput,
  type SvvyxArtifactsRuntimeContext,
} from "./svvyx-artifacts-command";
import {
  formatSvvyxWorkflowsError,
  runSvvyxWorkflowsCommand,
  type SvvyxWorkflowsModelCatalogReader,
} from "./svvyx-workflows-command";
import type { SvvyxExtensionsCliProbe } from "./svvyx-extensions-command";
import type { SvvyxRuntimeEnvValues } from "./svvyx-runtime-command";
import { resolveExtensionRecords } from "./svvyx-extensions-command";
import { resolveActorExtensionState } from "@svvy/extensions";
import type { ApprovalMode } from "../shared/agent-settings";

export const EXECUTE_TYPESCRIPT_TOOL_NAME = "execute_typescript";

export type StructuredDiagnostic = {
  severity: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
};

export type ExecuteTypescriptInput = {
  typescriptCode: string;
};

export type ExecuteTypescriptResult = {
  success: boolean;
  result?: unknown;
  logs?: string[];
  error?: {
    message: string;
    name?: string;
    stage?: "approval" | "compile" | "typecheck" | "runtime";
    diagnostics?: StructuredDiagnostic[];
    line?: number;
  };
};

export const executeTypescriptParamsSchema = Type.Object(
  {
    typescriptCode: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ExecuteTypescriptParams = Static<typeof executeTypescriptParamsSchema>;

const EXECUTE_TYPESCRIPT_DESCRIPTION = [
  "Run a bounded TypeScript program against actor-local generated extension runtime facades.",
  "Use this only when TypeScript control flow is needed for batching, looping, filtering, aggregation, or transforming structured extension results.",
  "Inside the snippet, use generated extension runtime facades and console; do not assume a global svvy client, broad api helper, Node.js built-ins, or node:* imports.",
  "The runtime persists the submitted snippet before execution and typechecks before running.",
].join(" ");

const EXECUTE_TYPESCRIPT_SUMMARY = "Execute bounded TypeScript.";
const API_DECLARATIONS_FILE = "svvy-api.d.ts";
const SOURCE_FILE = "execute-typescript.ts";
const DIAGNOSTICS_FILE = "execute-typescript.diagnostics.json";
const LOGS_FILE = "execute-typescript.logs.log";
const WRAPPER_PREFIX =
  "export default async function __svvy(extensions: LoadedExtensionsFacade, console: SvvyConsole, __svvyAllowedModules: Record<string, Record<string, unknown>>) {";
const WRAPPER_SUFFIX = "}";
const WRAPPER_LINE_OFFSET = 1;
const INCUR_CLIENT_MODULE = "incur/client";
const ALLOWED_INCUR_CLIENT_IMPORTS = new Set(["Client", "Resources", "Run"]);
const INCUR_MODULE = "incur";
const ALLOWED_INCUR_IMPORTS = new Set(["Cli", "z"]);
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
const EXECUTE_TYPESCRIPT_SECRET_KEY_PATTERN =
  /(^|[-_])(api[-_]?key|access[-_]?token|refresh[-_]?token|auth|authorization|cookie|secret|password|token|credential)([-_]|$)/i;
const EXECUTE_TYPESCRIPT_BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const EXECUTE_TYPESCRIPT_KEY_VALUE_SECRET_PATTERN =
  /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|AUTH)[A-Z0-9_]*)\s*=\s*([^\s"'`]{6,}|["'`][^"'`]{6,}["'`])/gi;
const EXECUTE_TYPESCRIPT_RUNTIME_ENV_ALLOWLIST = [
  "BUN_INSTALL",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TMP",
  "TMPDIR",
  "TEMP",
  "USER",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const;

export type ExecuteTypescriptContext = {
  sessionId: string;
  actor: SvvyActorKind;
  turnId?: string | null;
  workflowTaskAttemptId?: string | null;
  surfacePiSessionId: string;
  threadId: string | null;
  workflowRunId?: string | null;
  executor?: RuntimeCommandRecord["executor"];
  visibility?: RuntimeCommandVisibility;
  loadedExtensionIds?: readonly string[];
};

type CapturedConsoleLevel = "log" | "info" | "warn" | "error";

export type ExecuteTypescriptRuntimeProcessSpawner = (input: {
  command: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  fileSystemPolicy: FileSystemSandboxPolicy;
  managedSandbox: boolean;
  networkAccess: boolean;
}) => ChildProcessWithoutNullStreams;

type ExecuteTypescriptToolOptions = {
  cwd: string;
  runtime: PromptExecutionRuntimeHandle;
  artifactState: RuntimeArtifactStatePortService;
  commandState: RuntimeCommandStatePortService;
  threadState: RuntimeThreadStatePortService;
  turnState: RuntimeTurnStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
  openArtifact?: SvvyxArtifactOpenHandler;
  onWorkflowsGeneratedPackageChanged?: (input: {
    reason: "svvyx-workflows-build" | "svvyx-workflows-save";
    commandFacts: Record<string, unknown>;
  }) => void | Promise<void>;
  workflowsExtensionsGeneratedPackagePath?: string;
  extensionsRoot?: string;
  workflowsGeneratedPackagePath?: string;
  workflowsModelCatalog?: SvvyxWorkflowsModelCatalogReader;
  workflowsSourceRoot?: string;
  workflowsWorkspaceCwds?: () => readonly string[];
  agentSettingsStore?: AgentSettingsStore;
  env?: NodeJS.ProcessEnv;
  extensionsBuildRoot?: string;
  extensionsCliProbe?: SvvyxExtensionsCliProbe;
  extensionEnvSecretStore?: ExtensionEnvSecretStore;
  extensionsEnvValues?: SvvyxRuntimeEnvValues | (() => SvvyxRuntimeEnvValues);
  onAppLog?: (event: AppLoggerEvent) => void;
  approvalBoundary?: ExecuteTypescriptApprovalBoundary;
  approvalMode?: ApprovalMode | (() => ApprovalMode);
  managedSandbox?: boolean | (() => boolean);
  networkAccess?: boolean | (() => boolean);
  runtimeProcessSpawner?: ExecuteTypescriptRuntimeProcessSpawner;
};

export type ExecuteTypescriptApprovalBoundary = RuntimeApprovalBoundary;

type GeneratedClientRunOutput = {
  format: "toon" | "json" | "yaml" | "md" | "jsonl";
  text: string;
  tokenCount?: number;
  tokenLimit?: number;
  tokenOffset?: number;
};
type GeneratedClientRunResult<T> = {
  ok: true;
  data: T;
  output: T | GeneratedClientRunOutput;
  meta: {
    commandFacts: Record<string, unknown>;
    [key: string]: unknown;
  };
};
type GeneratedUserClientInput = {
  args?: Record<string, unknown>;
  options?: Record<string, unknown>;
  selection?: string[];
  outputFormat?: "toon" | "json" | "yaml" | "md" | "jsonl";
  outputTokenCount?: boolean;
  outputTokenLimit?: number;
  outputTokenOffset?: number;
};
type GeneratedUserExtensionFacade = {
  run: (commandId: string, input?: GeneratedUserClientInput) => Promise<unknown>;
};
type ExecuteTypescriptExtensions = {
  artifacts?: {
    run: (
      commandId: string,
      input: { options?: Record<string, unknown> },
    ) => Promise<GeneratedClientRunResult<unknown>>;
  };
  workflows?: {
    run: (
      commandId: string,
      input: { options?: Record<string, unknown> },
    ) => Promise<GeneratedClientRunResult<unknown>>;
  };
} & Record<string, GeneratedUserExtensionFacade | undefined>;
type IncurClientModuleRuntime = {
  Client: {
    ClientError: typeof Client.ClientError;
  };
  Resources: Record<string, unknown>;
  Run: Record<string, unknown>;
};
type IncurClientImportBinding = {
  importedName: string;
  localName: string;
};
type GeneratedModuleImportBinding = IncurClientImportBinding & {
  moduleName: string;
};

function resolveExecuteTypescriptRuntimeModule(moduleName: string): string | undefined {
  try {
    return Bun.resolveSync(moduleName, import.meta.dir);
  } catch {
    return undefined;
  }
}

type ExecuteTypescriptCommandFacts = CommandFactsPayload;

export function createExecuteTypescriptTool(
  options: ExecuteTypescriptToolOptions,
): NativeToolDefinition<ExecuteTypescriptParams, ExecuteTypescriptResult> {
  return {
    label: "Code Mode",
    name: EXECUTE_TYPESCRIPT_TOOL_NAME,
    description: EXECUTE_TYPESCRIPT_DESCRIPTION,
    parameters: executeTypescriptParamsSchema,
    execute: async (_toolCallId, params, signal) => {
      const runtime = options.runtime.current;
      if (!runtime) {
        throw new Error(`${EXECUTE_TYPESCRIPT_TOOL_NAME} can only run during an active prompt.`);
      }

      if (runtime.turnId) {
        options.runState(
          options.turnState.setTurnDecision({
            turnId: runtime.turnId,
            decision: "execute_typescript",
            onlyIfPending: true,
          }),
        );
      }
      if (runtime.rootThreadId) {
        options.runState(
          options.threadState.ensureHandlerThreadRunnable({
            workspaceSessionId: runtime.workspaceSessionId as WorkspaceSessionId,
            surfacePiSessionId: runtime.surfacePiSessionId as SurfacePiSessionId,
            threadId: runtime.rootThreadId as ThreadId,
          }),
        );
      }

      const actor = actorForPromptRuntime(runtime.surfaceKind);
      const executor = executorForPromptRuntime(runtime.surfaceKind);
      const result = await runExecuteTypescript({
        cwd: options.cwd,
        artifactState: options.artifactState,
        commandState: options.commandState,
        runState: options.runState,
        signal,
        typescriptCode: params.typescriptCode,
        context: {
          sessionId: runtime.workspaceSessionId,
          turnId: runtime.turnId,
          workflowTaskAttemptId: runtime.workflowTaskAttemptId,
          workflowRunId: runtime.workflowRunId,
          actor,
          surfacePiSessionId: runtime.surfacePiSessionId,
          threadId: runtime.surfaceKind === "handler" ? runtime.rootThreadId : null,
          executor,
          loadedExtensionIds: runtime.loadedExtensionIds,
        },
        openArtifact: options.openArtifact,
        onWorkflowsGeneratedPackageChanged: options.onWorkflowsGeneratedPackageChanged,
        workflowsExtensionsGeneratedPackagePath: options.workflowsExtensionsGeneratedPackagePath,
        extensionsRoot: options.extensionsRoot,
        workflowsGeneratedPackagePath: options.workflowsGeneratedPackagePath,
        workflowsModelCatalog: options.workflowsModelCatalog,
        workflowsSourceRoot: options.workflowsSourceRoot,
        workflowsWorkspaceCwds: options.workflowsWorkspaceCwds,
        agentSettingsStore: options.agentSettingsStore,
        env: options.env,
        extensionsBuildRoot: options.extensionsBuildRoot,
        extensionsCliProbe: options.extensionsCliProbe,
        extensionEnvSecretStore: options.extensionEnvSecretStore,
        extensionsEnvValues: options.extensionsEnvValues,
        onAppLog: options.onAppLog,
        approvalBoundary: options.approvalBoundary,
        approvalMode: options.approvalMode,
        managedSandbox: options.managedSandbox,
        networkAccess: options.networkAccess,
        runtimeProcessSpawner: options.runtimeProcessSpawner,
        toolCallId: _toolCallId,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
        details: result,
      };
    },
  };
}

export async function runExecuteTypescript(input: {
  cwd: string;
  artifactState: RuntimeArtifactStatePortService;
  commandState: RuntimeCommandStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
  signal?: AbortSignal;
  typescriptCode: string;
  context: ExecuteTypescriptContext;
  openArtifact?: SvvyxArtifactOpenHandler;
  onWorkflowsGeneratedPackageChanged?: (input: {
    reason: "svvyx-workflows-build" | "svvyx-workflows-save";
    commandFacts: Record<string, unknown>;
  }) => void | Promise<void>;
  workflowsExtensionsGeneratedPackagePath?: string;
  extensionsRoot?: string;
  workflowsGeneratedPackagePath?: string;
  workflowsModelCatalog?: SvvyxWorkflowsModelCatalogReader;
  workflowsSourceRoot?: string;
  workflowsWorkspaceCwds?: () => readonly string[];
  agentSettingsStore?: AgentSettingsStore;
  env?: NodeJS.ProcessEnv;
  extensionsBuildRoot?: string;
  extensionsCliProbe?: SvvyxExtensionsCliProbe;
  extensionEnvSecretStore?: ExtensionEnvSecretStore;
  extensionsEnvValues?: SvvyxRuntimeEnvValues | (() => SvvyxRuntimeEnvValues);
  onAppLog?: (event: AppLoggerEvent) => void;
  approvalBoundary?: ExecuteTypescriptApprovalBoundary;
  approvalMode?: ApprovalMode | (() => ApprovalMode);
  managedSandbox?: boolean | (() => boolean);
  networkAccess?: boolean | (() => boolean);
  runtimeProcessSpawner?: ExecuteTypescriptRuntimeProcessSpawner;
  toolCallId: string;
}): Promise<ExecuteTypescriptResult> {
  const parentCommand = input.runState(
    input.commandState.createOrReuseStreamingCommand({
      toolCallId: input.toolCallId,
      turnId: input.context.turnId ?? null,
      workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? null,
      surfacePiSessionId: input.context.surfacePiSessionId,
      threadId: input.context.threadId,
      workflowRunId: input.context.workflowRunId ?? null,
      toolName: EXECUTE_TYPESCRIPT_TOOL_NAME,
      executor: input.context.executor ?? "orchestrator",
      visibility: input.context.visibility ?? "summary",
      title: "Run execute_typescript",
      summary: EXECUTE_TYPESCRIPT_SUMMARY,
      arguments: {
        typescriptCode: input.typescriptCode,
      },
    }),
  ).value;
  input.runState(input.commandState.startCommand({ commandId: parentCommand.id }));
  const artifactNamePrefix = `${parentCommand.id}-`;
  const snippetArtifact = input.runState(
    input.artifactState.createArtifact({
      workflowTaskAttemptId:
        (input.context.workflowTaskAttemptId as WorkflowTaskAttemptId | null | undefined) ?? null,
      sourceCommandId: parentCommand.id as CommandId,
      kind: "text",
      name: `${artifactNamePrefix}${SOURCE_FILE}`,
      content: input.typescriptCode,
    }),
  ).value;
  input.onAppLog?.({
    level: "info",
    source: "execute_typescript",
    message: "Execute TypeScript started.",
    details: {
      workspaceSessionId: input.context.sessionId,
      surfacePiSessionId: input.context.surfacePiSessionId,
      threadId: input.context.threadId ?? undefined,
      workflowRunId: input.context.workflowRunId ?? undefined,
      workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? undefined,
      commandId: parentCommand.id,
      artifactId: snippetArtifact.id,
      actor: input.context.actor,
    },
  });

  const approvalMode = resolveExecuteTypescriptApprovalMode(input);
  const approval =
    approvalMode === "full-access" || !input.approvalBoundary
      ? { approved: true as const }
      : await input.approvalBoundary({
          approvalMode,
          commandId: parentCommand.id,
          context: input.context,
          cwd: input.cwd,
          snippetArtifactId: snippetArtifact.id,
          toolCallId: input.toolCallId,
          toolName: EXECUTE_TYPESCRIPT_TOOL_NAME,
          typescriptCode: input.typescriptCode,
        });
  if (approval?.approved === false) {
    const reason = approval.reason?.trim() || "Execute TypeScript was not approved.";
    input.runState(
      input.commandState.finishCommand({
        commandId: parentCommand.id,
        status: "cancelled",
        summary: reason,
        facts: {
          approval: "denied",
          snippetArtifactId: snippetArtifact.id,
        },
        error: reason,
      }),
    );
    input.onAppLog?.({
      level: "warning",
      source: "execute_typescript",
      message: "Execute TypeScript blocked by approval boundary.",
      details: {
        workspaceSessionId: input.context.sessionId,
        surfacePiSessionId: input.context.surfacePiSessionId,
        threadId: input.context.threadId ?? undefined,
        workflowRunId: input.context.workflowRunId ?? undefined,
        workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? undefined,
        commandId: parentCommand.id,
        artifactId: snippetArtifact.id,
        approval: "denied",
      },
    });
    return {
      success: false,
      error: {
        message: reason,
        stage: "approval",
      },
    };
  }

  const preflight = compileAndTypecheck(input.typescriptCode, {
    context: input.context,
    extensionsRoot: input.extensionsRoot,
  });
  if (preflight.errors.length > 0) {
    const diagnosticsArtifact = input.runState(
      input.artifactState.createArtifact({
        workflowTaskAttemptId:
          (input.context.workflowTaskAttemptId as WorkflowTaskAttemptId | null | undefined) ?? null,
        sourceCommandId: parentCommand.id as CommandId,
        kind: "json",
        name: `${artifactNamePrefix}${DIAGNOSTICS_FILE}`,
        content: JSON.stringify(preflight.errors, null, 2),
      }),
    ).value;
    recordExecuteTypescriptDiagnostics({
      commandState: input.commandState,
      runState: input.runState,
      sessionId: input.context.sessionId,
      commandId: parentCommand.id,
      stage: preflight.stage,
      diagnostics: preflight.errors,
    });
    const errorMessage = preflight.errors[0]?.message ?? "Static diagnostics blocked execution.";
    input.runState(
      input.commandState.finishCommand({
        commandId: parentCommand.id,
        status: "failed",
        summary: errorMessage,
        facts: {
          diagnosticsCount: preflight.errors.length,
          snippetArtifactId: snippetArtifact.id,
          diagnosticsArtifactId: diagnosticsArtifact.id,
        },
        error: errorMessage,
      }),
    );
    input.onAppLog?.({
      level: "warning",
      source: "execute_typescript",
      message: "Execute TypeScript blocked by static diagnostics.",
      details: {
        workspaceSessionId: input.context.sessionId,
        surfacePiSessionId: input.context.surfacePiSessionId,
        threadId: input.context.threadId ?? undefined,
        workflowRunId: input.context.workflowRunId ?? undefined,
        workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? undefined,
        commandId: parentCommand.id,
        artifactId: diagnosticsArtifact.id,
        diagnosticsCount: preflight.errors.length,
        stage: preflight.stage,
      },
    });
    const result: ExecuteTypescriptResult = {
      success: false,
      error: {
        message: errorMessage,
        stage: preflight.stage,
        diagnostics: preflight.errors,
      },
    };
    return result;
  }

  const logs: string[] = [];
  const childCommandFacts: Array<{ status: RuntimeCommandStatus }> = [];
  const incurClientModule = createIncurClientModule();
  const runtimeSandbox = buildExecuteTypescriptLaunchPolicy({
    approvalMode,
    cwd: input.cwd,
    managedSandbox: resolveExecuteTypescriptManagedSandbox(input),
    networkAccess: resolveExecuteTypescriptNetworkAccess(input),
    tmpdir: process.env.TMPDIR ?? null,
  });
  const extensions = createExecuteTypescriptExtensions({
    cwd: input.cwd,
    artifactState: input.artifactState,
    commandState: input.commandState,
    runState: input.runState,
    context: input.context,
    parentCommand,
    childCommandFacts,
    incurClientModule,
    openArtifact: input.openArtifact,
    onWorkflowsGeneratedPackageChanged: input.onWorkflowsGeneratedPackageChanged,
    workflowsGeneratedPackagePath: input.workflowsGeneratedPackagePath,
    extensionsRoot: input.extensionsRoot,
    workflowsModelCatalog: input.workflowsModelCatalog,
    workflowsSourceRoot: input.workflowsSourceRoot,
    workflowsWorkspaceCwds: input.workflowsWorkspaceCwds,
    agentSettingsStore: input.agentSettingsStore,
    env: input.env,
    extensionsBuildRoot: input.extensionsBuildRoot,
    extensionsCliProbe: input.extensionsCliProbe,
    extensionEnvSecretStore: input.extensionEnvSecretStore,
    extensionsEnvValues: input.extensionsEnvValues,
    onAppLog: input.onAppLog,
  });
  try {
    const resultValue = await runCompiledSnippetInRuntimeProcess(preflight.javascript, {
      cwd: input.cwd,
      signal: input.signal,
      logs,
      onConsoleLine: (line) => {
        recordExecuteTypescriptOutputEvent({
          commandState: input.commandState,
          runState: input.runState,
          sessionId: input.context.sessionId,
          commandId: parentCommand.id,
          line,
        });
      },
      incurClientModule,
      extensions,
      runtimeProcessSpawner: input.runtimeProcessSpawner,
      runtimeExtensionIds: Object.keys(extensions),
      runtimeModulePaths: {
        [INCUR_MODULE]: resolveExecuteTypescriptRuntimeModule(INCUR_MODULE),
      },
      runtimeSandbox,
    });
    const redactedResultValue = redactExecuteTypescriptValue(resultValue);
    const logsArtifact =
      logs.length > 0
        ? input.runState(
            input.artifactState.createArtifact({
              workflowTaskAttemptId:
                (input.context.workflowTaskAttemptId as WorkflowTaskAttemptId | null | undefined) ??
                null,
              sourceCommandId: parentCommand.id as CommandId,
              kind: "log",
              name: `${artifactNamePrefix}${LOGS_FILE}`,
              content: logs.join("\n"),
            }),
          ).value
        : null;
    const parentRollup = buildExecuteTypescriptParentRollup({
      snippetArtifactId: snippetArtifact.id,
      logsArtifactId: logsArtifact?.id,
      childCommandFacts,
    });
    input.runState(
      input.commandState.finishCommand({
        commandId: parentCommand.id,
        status: "succeeded",
        summary: parentRollup.summary ?? summarizeResult(redactedResultValue),
        facts: {
          ...parentRollup.facts,
          ...executeTypescriptSandboxFacts(runtimeSandbox),
        } as CommandFactsPayload,
      }),
    );
    input.onAppLog?.({
      level: "info",
      source: "execute_typescript",
      message: "Execute TypeScript finished.",
      details: {
        workspaceSessionId: input.context.sessionId,
        surfacePiSessionId: input.context.surfacePiSessionId,
        threadId: input.context.threadId ?? undefined,
        workflowRunId: input.context.workflowRunId ?? undefined,
        workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? undefined,
        commandId: parentCommand.id,
        artifactId: logsArtifact?.id ?? snippetArtifact.id,
        childCommandCount: childCommandFacts.length,
        logsCount: logs.length,
      },
    });

    const result: ExecuteTypescriptResult = {
      success: true,
      result: redactedResultValue,
      logs: logs.length > 0 ? logs : undefined,
    };
    return result;
  } catch (error) {
    const logsArtifact =
      logs.length > 0
        ? input.runState(
            input.artifactState.createArtifact({
              workflowTaskAttemptId:
                (input.context.workflowTaskAttemptId as WorkflowTaskAttemptId | null | undefined) ??
                null,
              sourceCommandId: parentCommand.id as CommandId,
              kind: "log",
              name: `${artifactNamePrefix}${LOGS_FILE}`,
              content: logs.join("\n"),
            }),
          ).value
        : null;
    const message = redactExecuteTypescriptString(
      error instanceof Error ? error.message : "execute_typescript failed at runtime.",
    );
    const parentRollup = buildExecuteTypescriptParentRollup({
      snippetArtifactId: snippetArtifact.id,
      logsArtifactId: logsArtifact?.id,
      childCommandFacts,
    });
    input.runState(
      input.commandState.finishCommand({
        commandId: parentCommand.id,
        status: "failed",
        summary: message,
        facts: {
          ...parentRollup.facts,
          ...executeTypescriptSandboxFacts(runtimeSandbox),
        } as CommandFactsPayload,
        error: message,
      }),
    );
    input.onAppLog?.({
      level: "error",
      source: "execute_typescript",
      message: "Execute TypeScript failed.",
      error,
      details: {
        workspaceSessionId: input.context.sessionId,
        surfacePiSessionId: input.context.surfacePiSessionId,
        threadId: input.context.threadId ?? undefined,
        workflowRunId: input.context.workflowRunId ?? undefined,
        workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? undefined,
        commandId: parentCommand.id,
        artifactId: logsArtifact?.id ?? snippetArtifact.id,
        childCommandCount: childCommandFacts.length,
        logsCount: logs.length,
      },
    });
    const result: ExecuteTypescriptResult = {
      success: false,
      logs: logs.length > 0 ? logs : undefined,
      error: {
        message,
        name: error instanceof Error ? error.name : undefined,
        stage: "runtime",
        line: getRuntimeErrorLine(error),
      },
    };
    return result;
  }
}

function resolveExecuteTypescriptApprovalMode(input: {
  approvalMode?: ApprovalMode | (() => ApprovalMode);
}): ApprovalMode {
  if (typeof input.approvalMode === "function") {
    return input.approvalMode();
  }
  return input.approvalMode ?? "auto-review";
}

function resolveExecuteTypescriptManagedSandbox(input: {
  managedSandbox?: boolean | (() => boolean);
}): boolean {
  if (typeof input.managedSandbox === "function") {
    return input.managedSandbox() !== false;
  }
  return input.managedSandbox !== false;
}

function resolveExecuteTypescriptNetworkAccess(input: {
  networkAccess?: boolean | (() => boolean);
}): boolean {
  if (typeof input.networkAccess === "function") {
    return input.networkAccess() !== false;
  }
  return input.networkAccess !== false;
}

const executeTypescriptSandboxFacts = (input: SandboxLaunchPolicy): Record<string, unknown> =>
  sandboxLaunchFacts(input);

function compileAndTypecheck(
  typescriptCode: string,
  input: {
    context: Pick<ExecuteTypescriptContext, "actor" | "loadedExtensionIds">;
    extensionsRoot?: string;
  },
): {
  javascript: string;
  errors: StructuredDiagnostic[];
  warnings: StructuredDiagnostic[];
  stage: "compile" | "typecheck";
} {
  const prepared = prepareTypescriptSnippet(typescriptCode);
  const context = input.context;
  if (prepared.error) {
    return {
      javascript: "",
      errors: [prepared.error],
      warnings: [],
      stage: "compile",
    };
  }
  const wrappedSource = [
    WRAPPER_PREFIX,
    ...prepared.moduleImportBindings.map(
      (binding) =>
        `const ${binding.localName} = __svvyAllowedModules[${JSON.stringify(binding.moduleName)}].${binding.importedName} as typeof import(${JSON.stringify(binding.moduleName)})[${JSON.stringify(binding.importedName)}];`,
    ),
    prepared.typescriptCode,
    WRAPPER_SUFFIX,
  ].join("\n");
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    lib: ["lib.es2022.d.ts"],
  };
  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const sourceFiles = new Map<string, string>([
    [SOURCE_FILE, wrappedSource],
    [
      API_DECLARATIONS_FILE,
      buildExecuteTypescriptApiDeclaration(context.actor, {
        extensionsRoot: input.extensionsRoot,
        loadedExtensionIds: context.loadedExtensionIds,
        loadedExtensionRecords: resolveExtensionRecords(
          context.loadedExtensionIds ?? [],
          input.extensionsRoot,
        ),
      }),
    ],
  ]);

  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists(fileName) {
      return sourceFiles.has(fileName) || defaultHost.fileExists(fileName);
    },
    readFile(fileName) {
      return sourceFiles.get(fileName) ?? defaultHost.readFile(fileName);
    },
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      const contents = sourceFiles.get(fileName);
      if (contents !== undefined) {
        return ts.createSourceFile(fileName, contents, languageVersion, true);
      }
      return defaultHost.getSourceFile(
        fileName,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
    },
    writeFile() {},
  };

  const program = ts.createProgram([SOURCE_FILE, API_DECLARATIONS_FILE], compilerOptions, host);
  const syntactic = program
    .getSyntacticDiagnostics(program.getSourceFile(SOURCE_FILE))
    .map((diagnostic) => mapDiagnostic(diagnostic));
  const semantic = program
    .getSemanticDiagnostics(program.getSourceFile(SOURCE_FILE))
    .map((diagnostic) => mapDiagnostic(diagnostic));
  const optionsDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName !== SOURCE_FILE)
    .map((diagnostic) => mapDiagnostic(diagnostic));
  const diagnostics = [...syntactic, ...semantic, ...optionsDiagnostics];
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const stage = syntactic.some((diagnostic) => diagnostic.severity === "error")
    ? "compile"
    : "typecheck";

  const javascript = ts.transpileModule(wrappedSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    fileName: SOURCE_FILE,
  }).outputText;

  return {
    javascript,
    errors,
    warnings,
    stage,
  };
}

function prepareTypescriptSnippet(typescriptCode: string): {
  typescriptCode: string;
  moduleImportBindings: GeneratedModuleImportBinding[];
  error?: StructuredDiagnostic;
} {
  const moduleImportBindings: GeneratedModuleImportBinding[] = [];
  const localNames = new Set<string>();
  let firstError = detectUnsupportedImports(typescriptCode);
  const importPattern = /^\s*import\s+(type\s+)?\{([^}]+)\}\s*from\s*["']([^"']+)["'];?\s*$/gm;
  const rewrittenCode = typescriptCode.replace(
    importPattern,
    (
      statement,
      typeOnly: string | undefined,
      importList: string,
      moduleName: string,
      offset: number,
    ) => {
      const line = lineNumberAtOffset(typescriptCode, offset);
      const modulePolicy = allowedImportPolicy(moduleName);
      if (!modulePolicy) {
        firstError ??= {
          severity: "error",
          message: `Unsupported execute_typescript import declaration: ${moduleName}.`,
          file: basename(SOURCE_FILE),
          line,
          column: 1,
          code: "svvy-import",
        };
        return statement;
      }
      if (modulePolicy.available === false) {
        firstError ??= {
          severity: "error",
          message: `Import "${moduleName}" is not available in this execute_typescript context.`,
          file: basename(SOURCE_FILE),
          line,
          column: 1,
          code: "svvy-import-unavailable",
        };
        return statement;
      }
      const parsed = parseGeneratedModuleImportList(
        importList,
        localNames,
        modulePolicy.allowedNames,
      );
      if (!parsed.success) {
        firstError ??= {
          severity: "error",
          message: `Only named imports ${[...modulePolicy.allowedNames].join(", ")} are supported from "${moduleName}".`,
          file: basename(SOURCE_FILE),
          line,
          column: 1,
          code: "svvy-import",
        };
        return statement;
      }
      if (!typeOnly) {
        moduleImportBindings.push(
          ...parsed.bindings.map((binding) => ({ ...binding, moduleName })),
        );
      }
      return "";
    },
  );

  if (firstError) {
    return {
      typescriptCode,
      moduleImportBindings: [],
      error: firstError,
    };
  }

  return {
    typescriptCode: rewrittenCode,
    moduleImportBindings,
  };
}

function detectUnsupportedImports(typescriptCode: string): StructuredDiagnostic | undefined {
  const sourceFile = ts.createSourceFile(
    SOURCE_FILE,
    typescriptCode,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  let firstError: StructuredDiagnostic | undefined;

  const visit = (node: ts.Node) => {
    if (firstError) return;
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleName = node.moduleSpecifier.text;
      const modulePolicy = allowedImportPolicy(moduleName);
      const line = lineNumberAtOffset(typescriptCode, node.getStart(sourceFile));
      if (!modulePolicy) {
        firstError = unsupportedImportDiagnostic(moduleName, line);
        return;
      }
      if (
        !node.importClause ||
        node.importClause.name ||
        !node.importClause.namedBindings ||
        !ts.isNamedImports(node.importClause.namedBindings)
      ) {
        firstError = namedImportsOnlyDiagnostic(moduleName, modulePolicy.allowedNames, line);
        return;
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const moduleSpecifier = node.arguments[0];
      if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
        firstError = unsupportedImportDiagnostic(
          moduleSpecifier.text,
          lineNumberAtOffset(typescriptCode, node.getStart(sourceFile)),
        );
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return firstError;
}

function unsupportedImportDiagnostic(moduleName: string, line: number): StructuredDiagnostic {
  return {
    severity: "error",
    message: `Unsupported execute_typescript import declaration: ${moduleName}.`,
    file: basename(SOURCE_FILE),
    line,
    column: 1,
    code: "svvy-import",
  };
}

function namedImportsOnlyDiagnostic(
  moduleName: string,
  allowedNames: ReadonlySet<string>,
  line: number,
): StructuredDiagnostic {
  return {
    severity: "error",
    message: `Only named imports ${[...allowedNames].join(", ")} are supported from "${moduleName}".`,
    file: basename(SOURCE_FILE),
    line,
    column: 1,
    code: "svvy-import",
  };
}

function allowedImportPolicy(
  moduleName: string,
): { allowedNames: ReadonlySet<string>; available: boolean } | null {
  if (moduleName === INCUR_CLIENT_MODULE) {
    return { allowedNames: ALLOWED_INCUR_CLIENT_IMPORTS, available: true };
  }
  if (moduleName === INCUR_MODULE) {
    return { allowedNames: ALLOWED_INCUR_IMPORTS, available: true };
  }
  return null;
}

function parseGeneratedModuleImportList(
  importList: string,
  localNames: Set<string>,
  allowedNames: ReadonlySet<string>,
): { success: true; bindings: IncurClientImportBinding[] } | { success: false } {
  const bindings: IncurClientImportBinding[] = [];
  for (const rawSpecifier of importList.split(",")) {
    const specifier = rawSpecifier.trim();
    if (!specifier) {
      return { success: false };
    }
    const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(specifier);
    if (!match) {
      return { success: false };
    }
    const importedName = match[1];
    if (!importedName) {
      return { success: false };
    }
    const localName = match[2] ?? importedName;
    if (
      !allowedNames.has(importedName) ||
      !IDENTIFIER_PATTERN.test(localName) ||
      localNames.has(localName)
    ) {
      return { success: false };
    }
    localNames.add(localName);
    bindings.push({ importedName, localName });
  }
  return { success: true, bindings };
}

function lineNumberAtOffset(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

function mapDiagnostic(diagnostic: ts.Diagnostic): StructuredDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const severity = diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "error";
  let line: number | undefined;
  let column: number | undefined;
  if (diagnostic.file && diagnostic.start !== undefined) {
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    line = Math.max(position.line + 1 - WRAPPER_LINE_OFFSET, 1);
    column = position.character + 1;
  }

  return {
    severity,
    message,
    file: diagnostic.file ? basename(diagnostic.file.fileName) : undefined,
    line,
    column,
    code: diagnostic.code ? String(diagnostic.code) : undefined,
  };
}

type ExecuteTypescriptRuntimeToHostMessage =
  | {
      type: "console";
      level: CapturedConsoleLevel;
      args: unknown[];
    }
  | {
      type: "extensionRun";
      requestId: number;
      extensionId: string;
      commandId: string;
      input?: GeneratedUserClientInput | { options?: Record<string, unknown> };
    }
  | {
      type: "result";
      value?: unknown;
    }
  | {
      type: "error";
      error: {
        message: string;
        name?: string;
        stack?: string;
      };
    };

type ExecuteTypescriptHostToRuntimeMessage =
  | {
      type: "extensionResult";
      requestId: number;
      value?: unknown;
    }
  | {
      type: "extensionError";
      requestId: number;
      error: {
        message: string;
        name?: string;
        code?: string;
        data?: unknown;
        fieldErrors?: unknown;
      };
    };

async function runCompiledSnippetInRuntimeProcess(
  javascript: string,
  runtime: {
    cwd: string;
    signal?: AbortSignal;
    logs: string[];
    onConsoleLine?: (line: string) => void;
    extensions: ExecuteTypescriptExtensions;
    incurClientModule: IncurClientModuleRuntime;
    runtimeProcessSpawner?: ExecuteTypescriptRuntimeProcessSpawner;
    runtimeExtensionIds: readonly string[];
    runtimeModulePaths: Record<string, string | undefined>;
    runtimeSandbox: {
      fileSystemPolicy: FileSystemSandboxPolicy;
      managedSandbox: boolean;
      networkAccess: boolean;
    };
  },
): Promise<unknown> {
  const runtimeDir = mkdtempSync(join(tmpdir(), "svvy-execute-typescript-runtime-"));
  const runtimePath = join(runtimeDir, "runtime.js");
  writeFileSync(
    runtimePath,
    buildExecuteTypescriptRuntimeProcessSource({
      javascript,
      runtimeExtensionIds: runtime.runtimeExtensionIds,
      runtimeModulePaths: runtime.runtimeModulePaths,
    }),
  );
  const child = spawnExecuteTypescriptRuntimeProcess({
    cwd: runtime.cwd,
    env: buildExecuteTypescriptRuntimeEnv(process.env),
    fileSystemPolicy: runtime.runtimeSandbox.fileSystemPolicy,
    managedSandbox: runtime.runtimeSandbox.managedSandbox,
    networkAccess: runtime.runtimeSandbox.networkAccess,
    runtimeProcessSpawner: runtime.runtimeProcessSpawner,
    runtimePath,
  });
  const sendResponse = (message: ExecuteTypescriptHostToRuntimeMessage) => {
    if (!child.stdin.writable) {
      throw new Error("execute_typescript runtime is not accepting extension responses.");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const messagePromises: Promise<void>[] = [];
  let stdoutBuffer = "";
  let resultSettled = false;
  let resultValue: unknown;
  let runtimeError: Error | null = null;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    stdout.push(text);
    stdoutBuffer += text;
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex);
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line.trim().length > 0) {
        const messagePromise = handleExecuteTypescriptRuntimeMessage(line, runtime, sendResponse)
          .then((messageResult) => {
            if (messageResult.kind === "result") {
              resultSettled = true;
              resultValue = messageResult.value;
            } else if (messageResult.kind === "error") {
              resultSettled = true;
              runtimeError = messageResult.error;
            }
          })
          .catch((error) => {
            resultSettled = true;
            runtimeError =
              error instanceof Error ? error : new Error("execute_typescript runtime failed.");
          });
        messagePromises.push(messagePromise);
      }
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr.push(String(chunk));
  });
  const abortHandler = () => child.kill();
  runtime.signal?.addEventListener("abort", abortHandler, { once: true });
  try {
    const exit = await waitForExecuteTypescriptRuntimeProcess(child);
    await Promise.all(messagePromises);
    if (stdoutBuffer.trim().length > 0) {
      const messageResult = await handleExecuteTypescriptRuntimeMessage(
        stdoutBuffer,
        runtime,
        sendResponse,
      );
      if (messageResult.kind === "result") {
        resultSettled = true;
        resultValue = messageResult.value;
      } else if (messageResult.kind === "error") {
        resultSettled = true;
        runtimeError = messageResult.error;
      }
    }
    if (runtimeError) {
      throw runtimeError;
    }
    if (!resultSettled) {
      const errorText = stderr.join("").trim() || stdout.join("").trim();
      throw new Error(
        errorText ||
          `execute_typescript runtime exited without a result (${formatRuntimeExit(exit)}).`,
      );
    }
    if (exit.signal !== null || (exit.code !== null && exit.code !== 0)) {
      throw new Error(
        stderr.join("").trim() ||
          `execute_typescript runtime failed with ${formatRuntimeExit(exit)}.`,
      );
    }
    return resultValue;
  } finally {
    runtime.signal?.removeEventListener("abort", abortHandler);
    rmSync(runtimeDir, { force: true, recursive: true });
  }
}

async function handleExecuteTypescriptRuntimeMessage(
  line: string,
  runtime: {
    logs: string[];
    onConsoleLine?: (line: string) => void;
    extensions: ExecuteTypescriptExtensions;
  },
  sendResponse: (message: ExecuteTypescriptHostToRuntimeMessage) => void,
): Promise<
  { kind: "pending" } | { kind: "result"; value: unknown } | { kind: "error"; error: Error }
> {
  let message: ExecuteTypescriptRuntimeToHostMessage;
  try {
    message = JSON.parse(line) as ExecuteTypescriptRuntimeToHostMessage;
  } catch {
    throw new Error(`execute_typescript runtime emitted invalid protocol output: ${line}`);
  }
  if (message.type === "console") {
    const capturedLine = appendCapturedConsoleLine(runtime.logs, message.level, ...message.args);
    if (capturedLine) {
      runtime.onConsoleLine?.(capturedLine);
    }
    return { kind: "pending" };
  }
  if (message.type === "extensionRun") {
    await handleExecuteTypescriptExtensionRunMessage(message, runtime.extensions, sendResponse);
    return { kind: "pending" };
  }
  if (message.type === "result") {
    return { kind: "result", value: message.value };
  }
  if (message.type === "error") {
    const error = new Error(message.error.message);
    error.name = message.error.name ?? "Error";
    if (message.error.stack) {
      error.stack = message.error.stack;
    }
    return { kind: "error", error };
  }
  throw new Error("execute_typescript runtime emitted an unsupported protocol message.");
}

async function handleExecuteTypescriptExtensionRunMessage(
  message: Extract<ExecuteTypescriptRuntimeToHostMessage, { type: "extensionRun" }>,
  extensions: ExecuteTypescriptExtensions,
  sendResponse: (message: ExecuteTypescriptHostToRuntimeMessage) => void,
): Promise<void> {
  const client = extensions[message.extensionId];
  if (!client) {
    sendResponse({
      type: "extensionError",
      requestId: message.requestId,
      error: {
        message: `Extension is not loaded for execute_typescript: ${message.extensionId}`,
        name: "Incur.ClientError",
        code: "extension_not_loaded",
      },
    });
    return;
  }
  try {
    const value = await client.run(message.commandId, message.input as never);
    sendResponse({ type: "extensionResult", requestId: message.requestId, value });
  } catch (error) {
    const clientError = error as {
      code?: string;
      data?: unknown;
      fieldErrors?: unknown;
      message?: string;
      name?: string;
    };
    sendResponse({
      type: "extensionError",
      requestId: message.requestId,
      error: {
        message: clientError.message ?? "Extension command failed.",
        name: clientError.name,
        code: clientError.code,
        data: clientError.data,
        fieldErrors: clientError.fieldErrors,
      },
    });
  }
}

function spawnExecuteTypescriptRuntimeProcess(input: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  fileSystemPolicy: FileSystemSandboxPolicy;
  managedSandbox: boolean;
  networkAccess: boolean;
  runtimeProcessSpawner?: ExecuteTypescriptRuntimeProcessSpawner;
  runtimePath: string;
}): ChildProcessWithoutNullStreams {
  const env = input.env ?? {};
  const command = [process.execPath, input.runtimePath];
  if (input.runtimeProcessSpawner) {
    return input.runtimeProcessSpawner({
      command,
      cwd: input.cwd,
      env,
      fileSystemPolicy: input.fileSystemPolicy,
      managedSandbox: input.managedSandbox,
      networkAccess: input.networkAccess,
    });
  }
  const child = input.managedSandbox
    ? spawn(
        resolveSandboxHelperPath({
          configuredPath: process.env.SVVY_SANDBOX_HELPER_PATH,
          executablePath: process.execPath,
        }),
        buildSandboxHelperArgs({
          command,
          cwd: input.cwd,
          fileSystemPolicy: input.fileSystemPolicy,
          networkAccess: input.networkAccess,
        }),
        { cwd: input.cwd, env },
      )
    : spawn(command[0]!, command.slice(1), { cwd: input.cwd, env });
  return child;
}

function buildExecuteTypescriptRuntimeEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of EXECUTE_TYPESCRIPT_RUNTIME_ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function waitForExecuteTypescriptRuntimeProcess(
  child: ChildProcessWithoutNullStreams,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

function formatRuntimeExit(exit: { code: number | null; signal: NodeJS.Signals | null }): string {
  return exit.signal ? `signal ${exit.signal}` : `exit code ${exit.code}`;
}

function buildExecuteTypescriptRuntimeProcessSource(input: {
  javascript: string;
  runtimeExtensionIds: readonly string[];
  runtimeModulePaths: Record<string, string | undefined>;
}): string {
  return `
const compiledJavascript = ${JSON.stringify(input.javascript)};
const runtimeExtensionIds = ${JSON.stringify([...new Set(input.runtimeExtensionIds)])};
const runtimeModulePaths = ${JSON.stringify(input.runtimeModulePaths)};
let nextRequestId = 1;
const pending = new Map();
let stdinBuffer = "";

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function sendFinal(message, code) {
  process.stdout.write(JSON.stringify(message) + "\\n", () => process.exit(code));
}

function createClientError(error) {
  return new ClientError(error?.message || "Extension command failed.", {
    code: error?.code,
    data: error?.data,
    fieldErrors: error?.fieldErrors,
  });
}

class ClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "Incur.ClientError";
    this.code = options.code;
    this.data = options.data;
    this.fieldErrors = options.fieldErrors;
  }
}

function runtimeConsole(level) {
  return (...args) => send({ type: "console", level, args });
}

function extensionClient(extensionId) {
  return Object.freeze({
    run(commandId, input) {
      const requestId = nextRequestId++;
      send({ type: "extensionRun", requestId, extensionId, commandId, input });
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
      });
    },
  });
}

function buildExtensions() {
  const extensions = {};
  for (const extensionId of runtimeExtensionIds) {
    extensions[extensionId] = extensionClient(extensionId);
  }
  return Object.freeze(extensions);
}

function optionalModuleFromPath(moduleName) {
  const modulePath = runtimeModulePaths[moduleName];
  if (!modulePath) return Object.freeze({});
  if (!require("node:fs").existsSync(modulePath)) return Object.freeze({});
  return Object.freeze({ ...require(modulePath) });
}

function buildAllowedModules() {
  return Object.freeze({
    "incur/client": Object.freeze({
      Client: Object.freeze({ ClientError }),
      Resources: Object.freeze({}),
      Run: Object.freeze({}),
    }),
    "incur": optionalModuleFromPath("incur"),
  });
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdinBuffer += String(chunk);
  let newlineIndex = stdinBuffer.indexOf("\\n");
  while (newlineIndex >= 0) {
    const line = stdinBuffer.slice(0, newlineIndex);
    stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
    if (line.trim()) {
      const message = JSON.parse(line);
      const request = pending.get(message.requestId);
      if (request) {
        pending.delete(message.requestId);
        if (message.type === "extensionResult") {
          request.resolve(message.value);
        } else {
          request.reject(createClientError(message.error));
        }
      }
    }
    newlineIndex = stdinBuffer.indexOf("\\n");
  }
});

(async () => {
  const module = { exports: {} };
  const execute = new Function("module", "exports", compiledJavascript);
  execute(module, module.exports);
  if (typeof module.exports.default !== "function") {
    throw new Error("execute_typescript did not produce an executable function.");
  }
  const value = await module.exports.default(
    buildExtensions(),
    Object.freeze({
      log: runtimeConsole("log"),
      info: runtimeConsole("info"),
      warn: runtimeConsole("warn"),
      error: runtimeConsole("error"),
    }),
    buildAllowedModules(),
  );
  sendFinal({ type: "result", value }, 0);
})().catch((error) => {
  sendFinal({
    type: "error",
    error: {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : undefined,
      stack: error instanceof Error ? error.stack : undefined,
    },
  }, 1);
});
`;
}

function createIncurClientModule(): IncurClientModuleRuntime {
  return Object.freeze({
    Client: Object.freeze({
      ClientError: Client.ClientError,
    }),
    Resources: Object.freeze({}),
    Run: Object.freeze({}),
  });
}

function createExecuteTypescriptExtensions(input: {
  cwd: string;
  artifactState: RuntimeArtifactStatePortService;
  commandState: RuntimeCommandStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
  context: ExecuteTypescriptContext;
  parentCommand: Pick<RuntimeCommandRecord, "id">;
  childCommandFacts: Array<{ status: RuntimeCommandStatus }>;
  incurClientModule: IncurClientModuleRuntime;
  openArtifact?: SvvyxArtifactOpenHandler;
  onWorkflowsGeneratedPackageChanged?: (input: {
    reason: "svvyx-workflows-build" | "svvyx-workflows-save";
    commandFacts: Record<string, unknown>;
  }) => void | Promise<void>;
  workflowsExtensionsGeneratedPackagePath?: string;
  extensionsRoot?: string;
  workflowsGeneratedPackagePath?: string;
  workflowsModelCatalog?: SvvyxWorkflowsModelCatalogReader;
  workflowsSourceRoot?: string;
  workflowsWorkspaceCwds?: () => readonly string[];
  agentSettingsStore?: AgentSettingsStore;
  env?: NodeJS.ProcessEnv;
  extensionsBuildRoot?: string;
  extensionsCliProbe?: SvvyxExtensionsCliProbe;
  extensionEnvSecretStore?: ExtensionEnvSecretStore;
  extensionsEnvValues?: SvvyxRuntimeEnvValues | (() => SvvyxRuntimeEnvValues);
  onAppLog?: (event: AppLoggerEvent) => void;
}): ExecuteTypescriptExtensions {
  const loadedExtensionIds = effectiveLoadedExtensionIds(input.context);

  const extensions: ExecuteTypescriptExtensions = {};
  if (loadedExtensionIds.includes("artifacts")) {
    extensions.artifacts = Object.freeze({
      run: async (
        commandId: string,
        rawInput: { options?: Record<string, unknown> } = {},
      ): Promise<GeneratedClientRunResult<unknown>> => {
        const childCommand = input.runState(
          input.commandState.createCommand({
            turnId: input.context.turnId ?? null,
            workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? null,
            surfacePiSessionId: input.context.surfacePiSessionId,
            threadId: input.context.threadId,
            workflowRunId: input.context.workflowRunId ?? null,
            parentCommandId: input.parentCommand.id,
            toolName: "extensions.artifacts.run",
            executor: input.context.executor ?? "orchestrator",
            visibility:
              commandId === "inspect" || commandId === "list"
                ? "trace"
                : (input.context.visibility ?? "summary"),
            title: "Run extensions.artifacts.run",
            summary: `artifacts.${commandId}`,
            arguments: {
              commandId,
              input: redactExecuteTypescriptValue(rawInput) as JsonValue,
            },
            facts: {
              extensionId: "artifacts",
              commandId,
            },
          }),
        ).value;
        input.runState(input.commandState.startCommand({ commandId: childCommand.id }));
        let operationStarted = false;
        try {
          const operation = normalizeArtifactsClientOperation(commandId, rawInput);
          operationStarted = true;
          const result = await runSvvyxArtifactsOperation({
            cwd: input.cwd,
            operation,
            runtime: artifactsRuntimeContext(input.context),
            artifactState: input.artifactState,
            runState: input.runState,
            sourceCommand: { id: childCommand.id as CommandId },
            openArtifact: input.openArtifact,
            onAppLog: input.onAppLog,
          });
          input.runState(
            input.commandState.finishCommand({
              commandId: childCommand.id,
              status: "succeeded",
              summary: summarizeResult(result.output),
              facts: {
                extensionId: "artifacts",
                commandId,
                ...result.commandFacts,
              } as CommandFactsPayload,
            }),
          );
          input.childCommandFacts.push({ status: "succeeded" });
          return Object.freeze({
            ok: true,
            data: result.output,
            output: result.output,
            meta: Object.freeze({
              commandFacts: Object.freeze({ ...result.commandFacts }),
            }),
          });
        } catch (error) {
          const formatted = formatSvvyxArtifactsError(error).error;
          if (!operationStarted) {
            input.onAppLog?.({
              level: "warning",
              source: "artifact",
              message: "Artifact command failed.",
              details: {
                workspaceSessionId: input.context.sessionId,
                surfacePiSessionId: input.context.surfacePiSessionId,
                ...(input.context.threadId ? { threadId: input.context.threadId } : {}),
                commandId: childCommand.id,
                artifactCommandId: commandId,
                errorCode: formatted.code,
                errorMessage: formatted.message,
                ...(formatted.id ? { artifactId: formatted.id } : {}),
                ...(formatted.path ? { artifactPath: formatted.path } : {}),
                ...(formatted.name ? { artifactName: formatted.name } : {}),
              },
            });
          }
          input.runState(
            input.commandState.finishCommand({
              commandId: childCommand.id,
              status: "failed",
              summary: formatted.message,
              facts: {
                extensionId: "artifacts",
                commandId,
                errorCode: formatted.code,
              },
              error: JSON.stringify({ error: formatted }),
            }),
          );
          input.childCommandFacts.push({ status: "failed" });
          const ClientError = input.incurClientModule.Client.ClientError;
          throw new ClientError(formatted.message);
        }
      },
    });
  }

  if (loadedExtensionIds.includes("workflows")) {
    extensions.workflows = Object.freeze({
      run: async (
        commandId: string,
        rawInput: { options?: Record<string, unknown> } = {},
      ): Promise<GeneratedClientRunResult<unknown>> => {
        const childCommand = input.runState(
          input.commandState.createCommand({
            turnId: input.context.turnId ?? null,
            workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? null,
            surfacePiSessionId: input.context.surfacePiSessionId,
            threadId: input.context.threadId,
            workflowRunId: input.context.workflowRunId ?? null,
            parentCommandId: input.parentCommand.id,
            toolName: "extensions.workflows.run",
            executor: input.context.executor ?? "orchestrator",
            visibility:
              commandId === "list" || commandId === "models list"
                ? "trace"
                : (input.context.visibility ?? "summary"),
            title: "Run extensions.workflows.run",
            summary: `workflows.${commandId}`,
            arguments: {
              commandId,
              input: redactExecuteTypescriptValue(rawInput) as JsonValue,
            },
            facts: {
              extensionId: "workflows",
              commandId,
            },
          }),
        ).value;
        input.runState(input.commandState.startCommand({ commandId: childCommand.id }));
        let command: string | null = null;
        try {
          command = normalizeWorkflowsClientCommand(commandId, rawInput);
          const result = await runSvvyxWorkflowsCommand({
            agentSettingsStore: input.agentSettingsStore,
            command,
            cwd: input.cwd,
            env: input.env,
            envSecretStore: resolveExecuteTypescriptExtensionEnvSecretStore(input),
            extensionsBuildRoot: input.extensionsBuildRoot,
            extensionsCliProbe: input.extensionsCliProbe,
            extensionsRoot: input.extensionsRoot,
            extensionsGeneratedPackagePath: input.workflowsExtensionsGeneratedPackagePath,
            generatedPackagePath: input.workflowsGeneratedPackagePath,
            readModelCatalog: input.workflowsModelCatalog,
            sourceRoot: input.workflowsSourceRoot,
            workspaceCwds: input.workflowsWorkspaceCwds?.(),
          });
          if (result.commandFacts.workflowBuildOk === true) {
            input.onAppLog?.({
              level: "info",
              source: "workflow.library",
              message: "Workflows build validation passed.",
              details: executeTypescriptWorkflowLogDetails(
                input.context,
                childCommand.id,
                command,
                pickExecuteTypescriptWorkflowLogFacts(result.commandFacts),
              ),
            });
            await input.onWorkflowsGeneratedPackageChanged?.({
              reason:
                typeof result.commandFacts.workflowSavedExportName === "string"
                  ? "svvyx-workflows-save"
                  : "svvyx-workflows-build",
              commandFacts: result.commandFacts,
            });
          }
          input.runState(
            input.commandState.finishCommand({
              commandId: childCommand.id,
              status: "succeeded",
              summary: summarizeResult(result.output),
              facts: {
                extensionId: "workflows",
                commandId,
                ...result.commandFacts,
              } as CommandFactsPayload,
            }),
          );
          input.childCommandFacts.push({ status: "succeeded" });
          return Object.freeze({
            ok: true,
            data: result.output,
            output: result.output,
            meta: Object.freeze({
              commandFacts: Object.freeze({ ...result.commandFacts }),
            }),
          });
        } catch (error) {
          const formatted = formatSvvyxWorkflowsError(error).error;
          if (commandId === "build" || commandId === "save" || formatted.diagnostics) {
            input.onAppLog?.({
              level: "warning",
              source: "workflow.library",
              message: "Workflows build validation failed.",
              details: executeTypescriptWorkflowLogDetails(
                input.context,
                childCommand.id,
                command ?? `extensions.workflows.run(${JSON.stringify(commandId)})`,
                {
                  errorCode: formatted.code,
                  errorMessage: formatted.message,
                  ...(formatted.diagnostics
                    ? { workflowDiagnosticCount: formatted.diagnostics.length }
                    : {}),
                },
              ),
            });
          }
          input.runState(
            input.commandState.finishCommand({
              commandId: childCommand.id,
              status: "failed",
              summary: formatted.message,
              facts: {
                extensionId: "workflows",
                commandId,
                errorCode: formatted.code,
              },
              error: JSON.stringify({ error: formatted }),
            }),
          );
          input.childCommandFacts.push({ status: "failed" });
          const ClientError = input.incurClientModule.Client.ClientError;
          throw new ClientError(formatted.message);
        }
      },
    });
  }

  return Object.freeze(extensions);
}

function artifactsRuntimeContext(context: ExecuteTypescriptContext): SvvyxArtifactsRuntimeContext {
  return {
    sessionId: context.sessionId,
    surfacePiSessionId: context.surfacePiSessionId,
    surfaceKind: context.actor === "handler" ? "handler" : "orchestrator",
    surfaceThreadId: context.actor === "handler" ? context.threadId : null,
  };
}

function actorForPromptRuntime(surfaceKind: PromptExecutionSurfaceKind): SvvyActorKind {
  if (surfaceKind === "workflow-task") {
    return "workflow-task";
  }
  return surfaceKind === "handler" ? "handler" : "orchestrator";
}

function executorForPromptRuntime(
  surfaceKind: PromptExecutionSurfaceKind,
): RuntimeCommandRecord["executor"] {
  if (surfaceKind === "workflow-task") {
    return "workflow-task-agent";
  }
  return surfaceKind === "handler" ? "handler" : "orchestrator";
}

function executeTypescriptWorkflowLogDetails(
  context: ExecuteTypescriptContext,
  commandId: string,
  command: string,
  facts: Record<string, unknown>,
): Record<string, unknown> {
  return {
    workspaceSessionId: context.sessionId,
    surfacePiSessionId: context.surfacePiSessionId,
    ...(context.threadId ? { threadId: context.threadId } : {}),
    ...(context.workflowRunId ? { workflowRunId: context.workflowRunId } : {}),
    ...(context.workflowTaskAttemptId
      ? { workflowTaskAttemptId: context.workflowTaskAttemptId }
      : {}),
    commandId,
    command,
    ...facts,
  };
}

function pickExecuteTypescriptWorkflowLogFacts(
  facts: Record<string, unknown>,
): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  for (const key of [
    "workflowBuildOk",
    "workflowDiagnosticCount",
    "workflowExportCount",
    "workflowLinkedWorkspaceCount",
    "workflowSavedExportName",
    "workflowSavedKind",
    "workflowSourcePath",
  ]) {
    const value = facts[key];
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
      details[key] = value;
    }
  }
  return details;
}

function effectiveLoadedExtensionIds(context: ExecuteTypescriptContext): string[] {
  return [
    ...(context.loadedExtensionIds ??
      resolveActorExtensionState({ actor: context.actor }).loadedExtensionIds),
  ];
}

function resolveExecuteTypescriptExtensionEnvSecretStore(input: {
  extensionEnvSecretStore?: ExtensionEnvSecretStore;
}): ExtensionEnvSecretStore {
  return input.extensionEnvSecretStore ?? createMacOsKeychainExtensionEnvSecretStore();
}

function normalizeArtifactsClientOperation(
  commandId: string,
  input: { options?: Record<string, unknown> },
): SvvyxArtifactsOperationInput {
  const options = isRecord(input.options) ? input.options : {};
  if (commandId === "create") {
    rejectUnknownArtifactsOptions(options, ["name", "path", "immutable", "mimeType"]);
    const name = optionalString(options.name, "name");
    const sourcePath = optionalString(options.path, "path");
    const mimeType = optionalString(options.mimeType, "mimeType");
    const immutable = optionalBoolean(options.immutable, "immutable");
    return {
      commandId,
      options: {
        ...(name ? { name } : {}),
        ...(sourcePath ? { path: sourcePath } : {}),
        ...(immutable === true ? { immutable } : {}),
        ...(mimeType ? { mimeType } : {}),
      },
    };
  }
  if (commandId === "inspect" || commandId === "open" || commandId === "delete") {
    rejectUnknownArtifactsOptions(options, ["id"]);
    return {
      commandId,
      options: {
        id: requiredString(options.id, "id"),
      },
    };
  }
  if (commandId === "list") {
    rejectUnknownArtifactsOptions(options, ["threadId", "limit"]);
    const threadId = optionalString(options.threadId, "threadId");
    const limit = optionalNumber(options.limit, "limit");
    return {
      commandId,
      options: {
        ...(threadId ? { threadId } : {}),
        ...(limit !== undefined ? { limit } : {}),
      },
    };
  }
  throw invalidArtifactsClientInput(`Unsupported Artifacts command: ${commandId}`);
}

function rejectUnknownArtifactsOptions(
  options: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  for (const name of Object.keys(options)) {
    if (!allowedSet.has(name)) {
      throw invalidArtifactsClientInput(`Unsupported Artifacts option: ${name}`);
    }
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidArtifactsClientInput(`${name} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw invalidArtifactsClientInput(`${name} must be a non-empty string when provided.`);
  }
  return value;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw invalidArtifactsClientInput(`${name} must be a boolean when provided.`);
  }
  return value;
}

function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw invalidArtifactsClientInput(`${name} must be a number when provided.`);
  }
  return value;
}

function invalidArtifactsClientInput(message: string): Error {
  return new Error(`INVALID_ARGUMENT: ${message}`);
}

function normalizeWorkflowsClientCommand(
  commandId: string,
  input: { options?: Record<string, unknown> },
): string {
  const options = isRecord(input?.options) ? input.options : {};
  if (commandId === "list") {
    rejectUnknownWorkflowsOptions(options, ["kind"]);
    const kind = optionalWorkflowKind(options.kind, "kind");
    return [
      "svvyx workflows list",
      ...(kind ? ["--kind", quoteWorkflowsArg(kind)] : []),
      "--json",
    ].join(" ");
  }
  if (commandId === "models list") {
    rejectUnknownWorkflowsOptions(options, []);
    return "svvyx workflows models list --json";
  }
  if (commandId === "build") {
    rejectUnknownWorkflowsOptions(options, []);
    return "svvyx workflows build --json";
  }
  if (commandId === "save") {
    rejectUnknownWorkflowsOptions(options, ["from", "kind", "as", "export", "overwrite"]);
    const from = requiredWorkflowString(options.from, "from");
    const kind = requiredWorkflowKind(options.kind, "kind");
    const exportName = requiredWorkflowString(options.as, "as");
    const sourceExportName = optionalWorkflowString(options.export, "export");
    const overwrite = optionalWorkflowBoolean(options.overwrite, "overwrite");
    return [
      "svvyx workflows save",
      "--from",
      quoteWorkflowsArg(from),
      "--kind",
      quoteWorkflowsArg(kind),
      "--as",
      quoteWorkflowsArg(exportName),
      ...(sourceExportName ? ["--export", quoteWorkflowsArg(sourceExportName)] : []),
      ...(overwrite === true ? ["--overwrite"] : []),
      "--json",
    ].join(" ");
  }
  throw invalidWorkflowsClientInput(`Unsupported Workflows command: ${commandId}`);
}

function rejectUnknownWorkflowsOptions(
  options: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  for (const name of Object.keys(options)) {
    if (!allowedSet.has(name)) {
      throw invalidWorkflowsClientInput(`Unsupported Workflows option: ${name}`);
    }
  }
}

function requiredWorkflowString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidWorkflowsClientInput(`${name} must be a non-empty string.`);
  }
  return value;
}

function optionalWorkflowString(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw invalidWorkflowsClientInput(`${name} must be a non-empty string when provided.`);
  }
  return value;
}

function optionalWorkflowBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw invalidWorkflowsClientInput(`${name} must be a boolean when provided.`);
  }
  return value;
}

function requiredWorkflowKind(value: unknown, name: string): string {
  const kind = requiredWorkflowString(value, name);
  if (!["agent", "prompt", "component", "workflow"].includes(kind)) {
    throw invalidWorkflowsClientInput(
      `${name} must be one of agent, prompt, component, or workflow.`,
    );
  }
  return kind;
}

function optionalWorkflowKind(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredWorkflowKind(value, name);
}

function quoteWorkflowsArg(value: string): string {
  return JSON.stringify(value);
}

function invalidWorkflowsClientInput(message: string): Error {
  return new Error(`INVALID_ARGUMENT: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatConsoleValue(value: unknown): string {
  const formatted =
    typeof value === "string" ? value : inspect(value, { depth: 5, breakLength: Infinity });
  return redactExecuteTypescriptString(formatted);
}

function redactExecuteTypescriptString(value: string): string {
  return value
    .replace(EXECUTE_TYPESCRIPT_BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(EXECUTE_TYPESCRIPT_KEY_VALUE_SECRET_PATTERN, "$1=[REDACTED]");
}

function redactExecuteTypescriptValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactExecuteTypescriptString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactExecuteTypescriptValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = EXECUTE_TYPESCRIPT_SECRET_KEY_PATTERN.test(key)
      ? "[REDACTED]"
      : redactExecuteTypescriptValue(child);
  }
  return output;
}

function appendCapturedConsoleLine(
  logs: string[],
  level: CapturedConsoleLevel,
  ...args: unknown[]
): string | null {
  const text = args.map(formatConsoleValue).join(" ");
  if (!text) {
    return null;
  }
  const prefix = level === "error" ? "[error] " : level === "warn" ? "[warn] " : "";
  const line = `${prefix}${text}`;
  logs.push(line);
  return line;
}

function recordExecuteTypescriptOutputEvent(input: {
  commandState: RuntimeCommandStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
  sessionId: string;
  commandId: string;
  line: string;
}): void {
  input.runState(
    input.commandState.recordCommandEvent({
      sessionId: input.sessionId,
      commandId: input.commandId,
      kind: "command.output",
      data: {
        stream:
          input.line.startsWith("[error] ") || input.line.startsWith("[warn] ")
            ? "stderr"
            : "stdout",
        text: input.line,
        source: "execute_typescript",
      },
    }),
  );
}

function recordExecuteTypescriptDiagnostics(input: {
  commandState: RuntimeCommandStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
  sessionId: string;
  commandId: string;
  stage: "compile" | "typecheck";
  diagnostics: readonly StructuredDiagnostic[];
}): void {
  if (input.diagnostics.length === 0) {
    return;
  }
  input.runState(
    input.commandState.recordCommandEvent({
      sessionId: input.sessionId,
      commandId: input.commandId,
      kind: "command.diagnostics",
      data: {
        source: "execute_typescript",
        stage: input.stage,
        diagnostics: input.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      },
    }),
  );
}

function summarizeResult(value: unknown): string {
  if (value === undefined) {
    return "execute_typescript completed successfully.";
  }
  const preview = JSON.stringify(value);
  if (!preview) {
    return "execute_typescript completed successfully.";
  }
  return preview.length <= 160 ? preview : `${preview.slice(0, 159).trimEnd()}…`;
}

function buildExecuteTypescriptParentRollup(input: {
  snippetArtifactId: string;
  logsArtifactId?: string;
  childCommandFacts: Array<{ status: RuntimeCommandStatus }>;
}): {
  summary?: string;
  facts: ExecuteTypescriptCommandFacts;
} {
  const failedChildCommandCount = input.childCommandFacts.filter(
    (command) => command.status === "failed",
  ).length;
  return {
    summary: undefined,
    facts: {
      snippetArtifactId: input.snippetArtifactId,
      ...(input.logsArtifactId ? { logsArtifactId: input.logsArtifactId } : {}),
      childCommandCount: input.childCommandFacts.length,
      failedChildCommandCount,
    },
  };
}

function getRuntimeErrorLine(error: unknown): number | undefined {
  if (!(error instanceof Error) || !error.stack) {
    return undefined;
  }
  const match = error.stack.match(/execute-typescript\.ts:(\d+):(\d+)/);
  if (!match) {
    return undefined;
  }
  const line = Number(match[1]);
  return Number.isFinite(line) ? line : undefined;
}
