import type { NativeToolDefinition } from "@svvy/extensions";
import * as Exit from "effect/Exit";
import { Type } from "typebox";
import { nativeToolParameters } from "./native-tool-parameters";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import type { PromptExecutionRuntimeHandle } from "@svvy/runtime/prompt-execution-context";
import type {
  AbsolutePath,
  CommandId,
  CommandEventPayload,
  JsonValue,
  RuntimeArtifactStatePortService,
  RuntimeCommandRecord,
  RuntimeCommandStatePortService,
  StateContractError,
  SurfacePiSessionId,
  SvvyxExtensionManagementRuntimeIntent,
  SvvyxExtensionManagementRuntimeRequest,
  SvvyxExtensionManagementRuntimeResponse,
  SvvyxWorkflowsRuntimeIntent,
  SvvyxWorkflowsRuntimeRequest,
  SvvyxWorkflowsRuntimeResponse,
  ThreadId,
  ToolItemId,
  TurnId,
  WorkspaceId,
  WorkspaceSessionId,
  BuildLaunchPolicyInput,
  SandboxLaunchFacts,
} from "@svvy/core";
import {
  decodeUnknownSvvyxExtensionManagementRuntimeIntentExit,
  decodeUnknownSvvyxWorkflowsRuntimeIntentExit,
} from "@svvy/core";
import type { AppLoggerEvent } from "./app-logger";
import type { RuntimeApprovalBoundary } from "./approval-boundary";
import type { AgentSettingsStore } from "./agent-settings-store";
import {
  readAgentProfileMutation,
  type AgentProfileAuthoritySnapshot,
  type AgentProfileMutation,
} from "./agent-profile-mutation-store";
import {
  isSandboxDenialOutput,
  isSandboxHelperBootstrapFailure,
  sandboxDenialFacts,
} from "@svvy/sandbox/diagnostics";
import { checkSandboxPathAccess } from "@svvy/sandbox";
import type { ExtensionEnvSecretStore } from "./extension-env-secret-store";
import type {
  LiveCommandCancelResult,
  LiveCommandStdinAdmissionResult,
  LiveCommandStdinRegistry,
} from "./live-command-stdin-registry";
import { extensionsGeneratedPackagePath, workflowsGeneratedPackagePath } from "./extension-paths";
import {
  formatSvvyxArtifactsError,
  runSvvyxArtifactsOperation,
  type SvvyxArtifactsOperationInput,
  type SvvyxArtifactsRuntimeContext,
} from "./svvyx-artifacts-command";
import {
  artifactRootForSession,
  materializeRuntimeArtifact,
  type RuntimeArtifactMaterializedRecord,
} from "./runtime-artifact-materializer";
import type { SvvyxRuntimeEnvValues, SvvyxRuntimeExtensionPlan } from "./svvyx-runtime-command";
import type { SvvyxWorkflowsModelCatalogReader } from "./svvyx-workflows-command";
import type { AgentSettingsState, ApprovalMode } from "../shared/agent-settings";
import type * as Effect from "effect/Effect";

type RunningCommandSession = {
  process: ChildProcessWithoutNullStreams;
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  managedSandbox: boolean;
  protectedWriteSnapshot: ProtectedWriteSnapshot;
  liveProjection: LiveCommandProjection | null;
  outputRedactions: readonly string[];
  closeLaunchFacts?: () => Promise<void>;
};

type LiveCommandProjection = {
  artifactState: RuntimeArtifactStatePortService;
  commandState: RuntimeCommandStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
  cwd: string;
  readArtifactRootForSession?: (sessionId: string) => string | null;
  sessionId: string;
  commandId: string;
  managedSandbox: boolean;
  outputEventBytes: Record<"stderr" | "stdout", number>;
  outputEventRetainedStreams: Set<"stderr" | "stdout">;
};

type RetainedCommandOutputArtifact = {
  artifactId: string;
  bytes: number;
  name: string;
  stream: "stderr" | "stdout";
};

type ProtectedWriteSnapshot = {
  roots: ProtectedWriteRootSnapshot[];
  allowedRoots: string[];
};

type ProtectedWriteRootSnapshot = {
  root: string;
  existed: boolean;
  entries: ProtectedWriteEntry[];
  allowedRoots: string[];
  fingerprint: string;
};

type ProtectedWriteEntry = {
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
  data?: Buffer;
  linkTarget?: string;
};

const runningCommandSessions = new Map<string, RunningCommandSession>();
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const RETAINED_COMMAND_OUTPUT_ARTIFACT_THRESHOLD_BYTES = 64 * 1024;
const RETAINED_COMMAND_OUTPUT_EVENT_MESSAGE = "Output exceeded the live event retention limit.";
const WORKFLOWS_GENERATED_DIRECT_EDIT_MESSAGE =
  "Generated Workflows output, workspace @svvyx/workflows/@svvyx/extensions package links, internal Extension files, and immutable or non-active-session Artifacts are read-only. Edit Workflows source, Extension source/manifest/package.json, or the active session's mutable artifact files through the intended command path instead.";
const MANAGED_FILESYSTEM_DENIED_WRITE_MESSAGE =
  "Managed filesystem policy allows writes only inside the workspace, configured writable roots, active mutable artifacts, and explicit extension source roots.";

type DirectToolOptions = {
  cwd: string;
  workspaceId?: string;
  runtime?: PromptExecutionRuntimeHandle;
  artifactState?: RuntimeArtifactStatePortService;
  commandState?: RuntimeCommandStatePortService;
  readArtifactRootForSession?: (sessionId: string) => string | null;
  runState?: <A>(effect: Effect.Effect<A, StateContractError>) => A;
  onWorkflowsGeneratedPackageChanged?: (input: {
    reason: "svvyx-workflows-build" | "svvyx-workflows-save";
    commandFacts: Record<string, unknown>;
  }) => void | Promise<void>;
  workflowsExtensionsGeneratedPackagePath?: string;
  workflowsGeneratedPackagePath?: string;
  workflowsModelCatalog?: SvvyxWorkflowsModelCatalogReader;
  workflowsSourceRoot?: string;
  extensionsBuildRoot?: string;
  applyExtensionManagementRuntimeRequest?: (
    request: SvvyxExtensionManagementRuntimeRequest,
  ) => Promise<SvvyxExtensionManagementRuntimeResponse>;
  applyWorkflowsRuntimeRequest?: (
    request: SvvyxWorkflowsRuntimeRequest,
  ) => Promise<SvvyxWorkflowsRuntimeResponse>;
  extensionEnvSecretStore?: ExtensionEnvSecretStore;
  extensionsEnvValues?: SvvyxRuntimeEnvValues;
  extensionsRuntimePlans?: () => readonly SvvyxRuntimeExtensionPlan[];
  extensionsRoot?: string;
  agentSettingsStore?: AgentSettingsStore;
  agentProfileSnapshot?: AgentProfileAuthoritySnapshot;
  applyAgentProfileMutations?: (mutations: readonly AgentProfileMutation[]) => Promise<void>;
  approvalBoundary?: DirectToolApprovalBoundary;
  approvalMode?: ApprovalMode | (() => ApprovalMode);
  managedSandbox?: boolean | (() => boolean);
  networkAccess?: boolean | (() => boolean);
  acquireDirectToolLaunch?: (
    input: Omit<BuildLaunchPolicyInput, "launchKind"> & {
      toolName: "exec_command" | "apply_patch" | "execute_typescript";
    },
  ) => Promise<{
    facts: SandboxLaunchFacts;
    close(): Promise<void>;
  }>;
  onAppLog?: (event: AppLoggerEvent) => void;
  runTaskAgentBridge?: runTaskAgentBridgeEnvProvider;
  runtimeCommandStdin?: LiveCommandStdinRegistry;
};

export type runTaskAgentBridgeEnvProvider = (input: {
  command: string;
  commandCwd: string;
  runtime: PromptExecutionRuntimeHandle["current"];
  sourceCommandId: string | null;
}) => Record<string, string> | null;

type DirectToolSet = {
  codingTools: NativeToolDefinition<unknown>[];
};

export type DirectToolApprovalBoundary = RuntimeApprovalBoundary;

export function createSvvyDirectTools(options: DirectToolOptions): DirectToolSet {
  return {
    codingTools: [
      createExecCommandTool(options),
      createWriteStdinTool(options),
      createApplyPatchTool(options),
    ],
  };
}

function createWriteStdinTool(options: DirectToolOptions): NativeToolDefinition<unknown> {
  return {
    name: "write_stdin",
    label: "write_stdin",
    description:
      "Write text to a running exec_command session. This is only valid for command sessions that returned a session_id.",
    parameters: nativeToolParameters(
      Type.Object(
        {
          session_id: Type.String({
            minLength: 1,
            description: "Running exec_command session id.",
          }),
          input: Type.String({ description: "Text to write to the process stdin." }),
        },
        { additionalProperties: false },
      ),
    ),
    async execute(_toolCallId, input) {
      const params = input as { session_id?: unknown; input?: unknown };
      if (typeof params.session_id !== "string" || params.session_id.length === 0) {
        throw new Error("write_stdin requires session_id.");
      }
      if (typeof params.input !== "string") {
        throw new Error("write_stdin requires input.");
      }
      const session = runningCommandSessions.get(params.session_id);
      if (!session) {
        throw new Error(`exec_command session not found: ${params.session_id}`);
      }
      if (session.exitCode !== null || session.exitSignal !== null) {
        runningCommandSessions.delete(params.session_id);
        unregisterRuntimeCommandStdinSession(
          options.runtimeCommandStdin,
          params.session_id,
          session,
        );
        assertProtectedWriteSnapshotUnchanged(session.protectedWriteSnapshot);
        finishLiveCommandProjection(session.liveProjection, {
          stdout: session.stdout.join(""),
          stderr: session.stderr.join(""),
          exitCode: session.exitCode,
          exitSignal: session.exitSignal,
          managedSandbox: session.managedSandbox,
        });
        return {
          content: [
            {
              type: "text",
              text: formatCommandOutput({
                stdout: drain(session.stdout),
                stderr: drain(session.stderr),
                exitCode: session.exitCode,
                exitSignal: session.exitSignal,
              }),
            },
          ],
        };
      }
      const writeResult = writeRunningCommandSessionStdin(session, params.input);
      if (writeResult.status !== "accepted") {
        throw new Error(`exec_command session stdin is not writable: ${writeResult.status}`);
      }
      return {
        content: [
          {
            type: "text",
            text: formatRunningSessionOutput(
              params.session_id,
              drain(session.stdout),
              drain(session.stderr),
            ),
          },
        ],
      };
    },
  };
}

function registerRuntimeCommandStdinSession(
  registry: LiveCommandStdinRegistry | undefined,
  sessionId: string,
  session: RunningCommandSession,
): void {
  const commandId = session.liveProjection?.commandId;
  if (!registry || !commandId) {
    return;
  }
  registry.register({
    commandId,
    sessionId,
    cancel: (reason) => cancelRunningCommandSession(session, reason),
    writeStdin: (text) => writeRunningCommandSessionStdin(session, text),
  });
}

function unregisterRuntimeCommandStdinSession(
  registry: LiveCommandStdinRegistry | undefined,
  sessionId: string,
  session: RunningCommandSession,
): void {
  const commandId = session.liveProjection?.commandId;
  if (!registry || !commandId) {
    return;
  }
  registry.unregister({ commandId, sessionId });
}

function writeRunningCommandSessionStdin(
  session: RunningCommandSession,
  text: string,
): LiveCommandStdinAdmissionResult {
  if (session.exitCode !== null || session.exitSignal !== null) {
    return { status: "already_terminal" };
  }
  const stdin = session.process.stdin;
  if (!stdin.writable || stdin.writableEnded || stdin.destroyed) {
    return { status: "stdin_closed" };
  }
  try {
    stdin.write(text);
    return { status: "accepted", acceptedBytes: Buffer.byteLength(text, "utf8") };
  } catch {
    return { status: "stdin_closed" };
  }
}

function cancelRunningCommandSession(
  session: RunningCommandSession,
  _reason?: string,
): LiveCommandCancelResult {
  if (session.exitCode !== null || session.exitSignal !== null) {
    return { status: "already_terminal" };
  }
  const killed = session.process.kill("SIGTERM");
  void session.closeLaunchFacts?.();
  session.closeLaunchFacts = undefined;
  return { status: killed ? "cancelled" : "cancelling" };
}

function createApplyPatchTool(options: DirectToolOptions): NativeToolDefinition<unknown> {
  return {
    name: "apply_patch",
    label: "apply_patch",
    description:
      "Apply a unified patch to files in the current workspace. Use this for targeted source edits.",
    parameters: nativeToolParameters(
      Type.Object(
        {
          patch: Type.String({ minLength: 1, description: "Patch text to apply." }),
        },
        { additionalProperties: false },
      ),
    ),
    async execute(toolCallId, input) {
      const params = input as { patch?: unknown };
      if (typeof params.patch !== "string" || params.patch.length === 0) {
        throw new Error("apply_patch requires patch.");
      }
      assertPatchDoesNotEditWorkflowsGeneratedOutput(params.patch, options);
      await assertDirectToolApproved({
        options,
        patch: params.patch,
        toolCallId,
        toolName: "apply_patch",
      });
      const activeCommand = findActiveDirectToolCommandForOptions({
        options,
        toolCallId,
        toolName: "apply_patch",
      });
      const launchHandle = await acquireRuntimeDirectToolLaunchFacts({
        activeCommand,
        command: ["patch", "-p0", "--forward"],
        cwd: options.cwd,
        envFacts: [],
        options,
        toolName: "apply_patch",
      });
      const patchCommandInput = {
        cwd: options.cwd,
        launchFacts: launchHandle?.facts ?? null,
        managedSandbox: launchFactsManagedSandbox(launchHandle?.facts),
        patch: params.patch,
      };
      let result: ReturnType<typeof spawnPatchCommand>;
      let resultManagedSandbox = patchCommandInput.managedSandbox;
      try {
        assertPatchRespectsRuntimeLaunchFacts(params.patch, launchHandle?.facts ?? null);
        result = spawnPatchCommand(patchCommandInput);
        if (isEscalatableSandboxDeniedPatchResult(result, patchCommandInput.managedSandbox)) {
          await assertSandboxEscalationApproved({
            options,
            patch: params.patch,
            result,
            toolCallId,
            toolName: "apply_patch",
          });
          result = spawnPatchCommand({
            ...patchCommandInput,
            launchFacts: null,
          });
          resultManagedSandbox = false;
        }
      } finally {
        await launchHandle?.close();
      }
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      if (result.status !== 0) {
        const message = output || `apply_patch failed with exit code ${result.status ?? "null"}.`;
        const stderr = typeof result.stderr === "string" ? result.stderr : String(result.stderr);
        const stdout = typeof result.stdout === "string" ? result.stdout : String(result.stdout);
        throw new Error(
          JSON.stringify({
            error: {
              code: "apply_patch_failed",
              message,
            },
            commandFacts: {
              ...parseApplyPatchCommandFacts(params.patch, [message]),
              ...sandboxDenialFacts({
                exitCode: result.status,
                managedSandbox: resultManagedSandbox,
                stderr,
                stdout,
              }),
            },
          }),
        );
      }
      return {
        content: [{ type: "text", text: output || "Patch applied." }],
        details: {
          exitCode: result.status,
          commandFacts: parseApplyPatchCommandFacts(params.patch),
        },
      };
    },
  };
}

function parseApplyPatchCommandFacts(
  patch: string,
  errors: string[] = [],
): {
  changedFiles: string[];
  createdFiles: string[];
  deletedFiles: string[];
  errors: string[];
} {
  const changedFiles = new Set<string>();
  const createdFiles = new Set<string>();
  const deletedFiles = new Set<string>();
  const lines = patch.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const oldPath = parseUnifiedDiffHeaderPath(lines[index], "--- ");
    if (oldPath === undefined) {
      continue;
    }
    const nextLine = lines[index + 1];
    const newPath = parseUnifiedDiffHeaderPath(nextLine, "+++ ");
    if (newPath === undefined) {
      continue;
    }

    if (oldPath === null && newPath) {
      createdFiles.add(newPath);
    } else if (newPath === null && oldPath) {
      deletedFiles.add(oldPath);
    } else if (newPath) {
      changedFiles.add(newPath);
    } else if (oldPath) {
      changedFiles.add(oldPath);
    }
  }

  return {
    changedFiles: Array.from(changedFiles).toSorted(),
    createdFiles: Array.from(createdFiles).toSorted(),
    deletedFiles: Array.from(deletedFiles).toSorted(),
    errors,
  };
}

function parseUnifiedDiffHeaderPath(
  line: string | undefined,
  prefix: "--- " | "+++ ",
): string | null | undefined {
  if (!line?.startsWith(prefix)) {
    return undefined;
  }
  const rawPath = line.slice(prefix.length).split(/\t| /, 1)[0]?.trim();
  if (!rawPath) {
    return undefined;
  }
  if (rawPath === "/dev/null") {
    return null;
  }
  return rawPath.startsWith("a/") || rawPath.startsWith("b/") ? rawPath.slice(2) : rawPath;
}

function createExecCommandTool(options: DirectToolOptions): NativeToolDefinition<unknown> {
  return {
    name: "exec_command",
    label: "exec_command",
    description:
      "Execute a shell command in the current workspace. Returns stdout and stderr. Use this for command-family work such as svvyx, git, gh, cx, smithers, tests, and builds.",
    parameters: nativeToolParameters(
      Type.Object(
        {
          cmd: Type.String({ minLength: 1, description: "Shell command to execute." }),
          workdir: Type.Optional(
            Type.String({
              minLength: 1,
              description: "Working directory for the command. Defaults to the workspace root.",
            }),
          ),
          timeout: Type.Optional(Type.Number({ description: "Timeout in seconds." })),
        },
        { additionalProperties: false },
      ),
    ),
    async execute(toolCallId, input, signal, _onUpdate) {
      const params = input as { cmd?: unknown; timeout?: unknown; workdir?: unknown };
      if (typeof params.cmd !== "string" || params.cmd.length === 0) {
        throw new Error("exec_command requires cmd.");
      }
      if (params.workdir !== undefined && typeof params.workdir !== "string") {
        throw new Error("exec_command workdir must be a string when provided.");
      }
      const commandCwd =
        typeof params.workdir === "string" && params.workdir.length > 0
          ? params.workdir
          : options.cwd;
      assertCommandDoesNotEditWorkflowsGeneratedOutput({
        command: params.cmd,
        commandCwd,
        options,
      });
      await assertDirectToolApproved({
        command: params.cmd,
        commandCwd,
        commandFamily: undefined,
        options,
        toolCallId,
        toolName: "exec_command",
      });
      const activeCommand = findActiveDirectToolCommandForOptions({
        options,
        toolCallId,
        toolName: "exec_command",
      });
      const svvyxSubprocess = prepareSvvyxSubprocess({
        activeCommand,
        command: params.cmd,
        commandCwd,
        options,
      });
      const runTaskAgentBridgeEnv = preparerunTaskAgentBridgeEnv({
        activeCommand,
        command: params.cmd,
        commandCwd,
        options,
      });
      const env = { ...runTaskAgentBridgeEnv, ...svvyxSubprocess?.env };
      const launchHandle = await acquireRuntimeDirectToolLaunchFacts({
        activeCommand,
        command: [getShell(), "-lc", params.cmd],
        cwd: commandCwd,
        envFacts: environmentFactsForEnv(env),
        options,
        toolName: "exec_command",
      });
      const managedSandbox = launchFactsManagedSandbox(launchHandle?.facts);
      const activeLiveProjection =
        activeCommand && options.artifactState && options.commandState && options.runState
          ? {
              artifactState: options.artifactState,
              commandState: options.commandState,
              runState: options.runState,
              cwd: commandCwd,
              readArtifactRootForSession: options.readArtifactRootForSession,
              sessionId: activeCommand.sessionId,
              commandId: activeCommand.id,
              managedSandbox,
              outputEventBytes: { stderr: 0, stdout: 0 },
              outputEventRetainedStreams: new Set<"stderr" | "stdout">(),
            }
          : null;
      const execInput = {
        cwd: commandCwd,
        cmd: params.cmd,
        env,
        launchFacts: launchHandle?.facts ?? null,
        managedSandbox,
        networkAccess: launchFactsNetworkAccess(launchHandle?.facts, options),
        protectedWriteRoots: svvyxSubprocess ? [] : protectedDirectEditRoots(options),
        protectedWriteAllowedRoots: svvyxSubprocess ? [] : protectedDirectEditAllowedRoots(options),
        timeoutMs:
          typeof params.timeout === "number"
            ? Math.max(1, params.timeout) * 1000
            : DEFAULT_COMMAND_TIMEOUT_MS,
        signal,
        liveProjection: activeLiveProjection,
        outputRedactions: runTaskAgentBridgeOutputRedactions(runTaskAgentBridgeEnv),
        runtimeCommandStdin: options.runtimeCommandStdin,
        closeLaunchFacts: launchHandle?.close,
      };
      const result = await runExecCommandWithSandboxEscalation({
        input: execInput,
        options,
        toolCallId,
      });
      return await finalizeSvvyxSubprocessResult({
        options,
        result,
        svvyxSubprocess,
      });
    },
  };
}

function resolveExtensionsEnvValues(options: DirectToolOptions): SvvyxRuntimeEnvValues {
  const values: SvvyxRuntimeEnvValues = {};
  for (const source of [
    options.agentSettingsStore?.getState().extensionEnv.nonSecretOverrides,
    options.extensionsEnvValues,
  ]) {
    for (const [extensionId, extensionValues] of Object.entries(source ?? {})) {
      values[extensionId] = {
        ...values[extensionId],
        ...extensionValues,
      };
    }
  }
  return values;
}

type PreparedSvvyxSubprocess = {
  command: string;
  commandCwd: string;
  env: NodeJS.ProcessEnv;
  replayTransport: boolean;
  resultKey: string;
  resultPath: string;
  runtime: SvvyxArtifactsRuntimeContext | null;
  shimDir: string;
  sourceCommandId: string | null;
};

const RUN_TASK_AGENT_BRIDGE_TOKEN_ENV = "SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN";

type SvvyxSubprocessTransport = {
  agentProfileMutations: readonly AgentProfileMutation[];
  agentSettingsState?: AgentSettingsState;
  appLogEvents: AppLoggerEvent[];
  commandFacts?: Record<string, unknown>;
  intents: SvvyxSubprocessIntent[];
  ok: boolean;
  output?: unknown;
  progressEvents: SvvyxSubprocessProgressEvent[];
};

type SvvyxSubprocessIntent =
  | {
      id: string;
      kind: "artifact.operation";
      operation: SvvyxArtifactsOperationInput;
    }
  | SvvyxExtensionManagementRuntimeIntent
  | SvvyxWorkflowsRuntimeIntent;

type SvvyxSubprocessProgressEvent = {
  facts?: Record<string, JsonValue>;
  family: string;
  phase: "failed" | "started" | "succeeded";
};

type SignedSvvyxSubprocessTransport = {
  envelopeVersion?: unknown;
  invocationId?: unknown;
  commandId?: unknown;
  extensionId?: unknown;
  createdAt?: unknown;
  payload?: unknown;
  signature?: {
    algorithm?: unknown;
    keyId?: unknown;
    digest?: unknown;
  };
};

function prepareSvvyxSubprocess(input: {
  activeCommand: Pick<RuntimeCommandRecord, "id"> | null;
  command: string;
  commandCwd: string;
  options: DirectToolOptions;
}): PreparedSvvyxSubprocess | null {
  const invocation = classifySvvyxShellInvocation(input.command);
  if (invocation.kind === "none") {
    return null;
  }
  if (invocation.kind === "invalid") {
    throw new Error(invocation.message);
  }
  const shim = createSvvyxSubprocessShim();
  const resultPath = join(shim.dir, `svvyx-result-${randomUUID()}.json`);
  const resultKey = randomBytes(32).toString("base64url");
  const sourceCommandId = input.activeCommand?.id ?? `svvyx_transport_${randomUUID()}`;
  const promptRuntime = input.options.runtime?.current ?? null;
  const runtime = promptRuntime
    ? {
        sessionId: promptRuntime.workspaceSessionId,
        surfacePiSessionId: promptRuntime.surfacePiSessionId,
        surfaceKind: promptRuntime.surfaceKind,
        surfaceThreadId:
          promptRuntime.surfaceKind === "handler" ? (promptRuntime.threadId ?? null) : null,
      }
    : null;
  const context = {
    agentProfileSnapshot: input.options.agentProfileSnapshot ?? null,
    agentSettingsState: input.options.agentSettingsStore?.getState() ?? null,
    cwd: input.commandCwd,
    // This env-visible context is intentionally non-secret. Extension secret values are never
    // serialized here; svvyx subprocesses read secrets through the app-owned secret store only.
    extensionEnvValues: resolveExtensionsEnvValues(input.options),
    extensionRuntimePlans: input.options.extensionsRuntimePlans?.() ?? [],
    extensionsBuildRoot: input.options.extensionsBuildRoot,
    extensionsGeneratedPackagePath: input.options.workflowsExtensionsGeneratedPackagePath,
    extensionsRoot: input.options.extensionsRoot,
    externalInstructionSources: promptRuntime?.externalInstructionSources ?? [],
    resultPath,
    runtime,
    sourceCommandId,
    workflowModelCatalog: input.options.workflowsModelCatalog?.() ?? null,
    workflowsGeneratedPackagePath: input.options.workflowsGeneratedPackagePath,
    workflowsSourceRoot: input.options.workflowsSourceRoot,
    workspaceId: input.options.workspaceId,
    workspaceCwd: input.options.cwd,
  };
  return {
    command: input.command,
    commandCwd: input.commandCwd,
    env: {
      PATH: `${shim.dir}:${process.env.PATH ?? ""}`,
      SVVY_SVVYX_SUBPROCESS_CONTEXT: JSON.stringify(context),
      SVVY_SVVYX_SUBPROCESS_RESULT_KEY: resultKey,
    },
    replayTransport: invocation.replayTransport,
    resultKey,
    resultPath,
    runtime,
    shimDir: shim.dir,
    sourceCommandId,
  };
}

function preparerunTaskAgentBridgeEnv(input: {
  activeCommand: Pick<RuntimeCommandRecord, "id"> | null;
  command: string;
  commandCwd: string;
  options: DirectToolOptions;
}): Record<string, string> | null {
  const runtime = input.options.runtime?.current ?? null;
  if (
    runtime?.surfaceKind !== "handler" ||
    !input.activeCommand ||
    !input.options.runTaskAgentBridge
  ) {
    return null;
  }
  return input.options.runTaskAgentBridge({
    command: input.command,
    commandCwd: input.commandCwd,
    runtime,
    sourceCommandId: input.activeCommand?.id ?? null,
  });
}

function runTaskAgentBridgeOutputRedactions(env: Record<string, string> | null): readonly string[] {
  const token = env?.[RUN_TASK_AGENT_BRIDGE_TOKEN_ENV];
  return token ? [token] : [];
}

function redactCommandOutput(text: string, redactions: readonly string[] | undefined): string {
  let redacted = text;
  for (const value of redactions ?? []) {
    if (value.length > 0) {
      redacted = redacted.replaceAll(value, "[REDACTED]");
    }
  }
  return redacted;
}

type SvvyxShellInvocation =
  | { kind: "none" }
  | { kind: "trusted"; replayTransport: boolean }
  | { kind: "invalid"; message: string };

function classifySvvyxShellInvocation(command: string): SvvyxShellInvocation {
  const trimmed = command.trim();
  const words = splitSimpleShellWords(trimmed);
  if (!words) {
    return { kind: "none" };
  }
  let index = 0;
  if (words[index] === "env") {
    index += 1;
    while (index < words.length && isShellEnvAssignment(words[index]!)) {
      const envName = words[index]!.slice(0, words[index]!.indexOf("="));
      if (envName.startsWith("SVVY_SVVYX_SUBPROCESS_")) {
        return {
          kind: "invalid",
          message: "svvyx subprocess environment variables are app-owned and cannot be overridden.",
        };
      }
      index += 1;
    }
  } else {
    while (index < words.length && isShellEnvAssignment(words[index]!)) {
      const envName = words[index]!.slice(0, words[index]!.indexOf("="));
      if (envName.startsWith("SVVY_SVVYX_SUBPROCESS_")) {
        return {
          kind: "invalid",
          message: "svvyx subprocess environment variables are app-owned and cannot be overridden.",
        };
      }
      index += 1;
    }
  }
  if (words[index] === "command") {
    index += 1;
  }
  if (words[index] !== "svvyx") {
    return { kind: "none" };
  }
  return { kind: "trusted", replayTransport: isTrustedSvvyxTransportNamespace(words[index + 1]) };
}

function isTrustedSvvyxTransportNamespace(namespace: string | undefined): boolean {
  return namespace === "artifacts" || namespace === "extensions" || namespace === "workflows";
}

function isShellEnvAssignment(word: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}

function splitSimpleShellWords(command: string): string[] | null {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (quote === '"' && char === "\\") {
        index += 1;
        if (index >= command.length) return null;
        current += command[index]!;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\n" || char === "\r") {
      return null;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
      continue;
    }
    if (";&|<>()`".includes(char)) {
      return null;
    }
    if (char === "\\") {
      index += 1;
      if (index >= command.length) return null;
      current += command[index]!;
      continue;
    }
    current += char;
  }
  if (quote) {
    return null;
  }
  if (current.length > 0) {
    words.push(current);
  }
  return words.length > 0 ? words : null;
}

async function finalizeSvvyxSubprocessResult(input: {
  options: DirectToolOptions;
  result: { content: { type: "text"; text: string }[]; details: Record<string, unknown> };
  svvyxSubprocess: PreparedSvvyxSubprocess | null;
}): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }> {
  if (!input.svvyxSubprocess) {
    return input.result;
  }
  try {
    if (!input.svvyxSubprocess.replayTransport) {
      return input.result;
    }
    const transport = readSvvyxSubprocessResult(
      input.svvyxSubprocess.resultPath,
      input.svvyxSubprocess.resultKey,
    );
    if (transport.ok && transport.agentProfileMutations.length > 0) {
      if (!input.options.applyAgentProfileMutations) {
        throw new Error("Agent profile mutations require the DB-backed runtime authority.");
      }
      await input.options.applyAgentProfileMutations(transport.agentProfileMutations);
    }
    const workflowAgentSaveResponse =
      transport.ok && transport.commandFacts?.workflowSourceSaveRequested === true
        ? await applyWorkflowsRuntimeRequestForTransport(
            {
              operation: "build",
              input: input.svvyxSubprocess.sourceCommandId
                ? { sourceCommandId: input.svvyxSubprocess.sourceCommandId as CommandId }
                : {},
            },
            input.options.applyWorkflowsRuntimeRequest,
          )
        : null;
    const intentResult = transport.ok
      ? await applySvvyxSubprocessIntents(
          input.options,
          input.svvyxSubprocess,
          transport.intents,
          transport.output,
          transport.commandFacts,
        )
      : {};
    const retainedOutputArtifacts = Array.isArray(input.result.details.retainedOutputArtifacts)
      ? { retainedOutputArtifacts: input.result.details.retainedOutputArtifacts }
      : {};
    const commandFacts: Record<string, unknown> | undefined =
      transport.commandFacts ||
      intentResult.commandFacts ||
      Object.keys(retainedOutputArtifacts).length > 0
        ? {
            ...transport.commandFacts,
            ...workflowAgentSaveResponse?.commandFacts,
            ...intentResult.commandFacts,
            ...retainedOutputArtifacts,
          }
        : undefined;
    replaySvvyxSubprocessProgressEvents(
      input.options,
      input.svvyxSubprocess,
      transport.progressEvents,
      commandFacts,
    );
    replaySvvyxSubprocessAppLogEvents(input.options, transport.appLogEvents);
    replaySvvyxSubprocessAgentSettings(input.options, transport.agentSettingsState);
    if (commandFacts?.workflowBuildOk === true) {
      await input.options.onWorkflowsGeneratedPackageChanged?.({
        reason:
          typeof commandFacts.workflowSavedExportName === "string"
            ? "svvyx-workflows-save"
            : "svvyx-workflows-build",
        commandFacts,
      });
    }
    const details = {
      ...input.result.details,
      ...(commandFacts ? { commandFacts } : {}),
    };
    if (transport.ok === false) {
      const stderr =
        typeof input.result.details.stderr === "string" ? input.result.details.stderr : "";
      throw new Error(
        (stderr || stripCommandExitTrailer(readTextContent(input.result))).trim() ||
          "svvyx command failed.",
      );
    }
    const stdout =
      workflowAgentSaveResponse?.output !== undefined
        ? JSON.stringify(
            {
              ...(workflowAgentSaveResponse.output as Record<string, unknown>),
              ...(transport.output as Record<string, unknown>),
            },
            null,
            2,
          )
        : intentResult.output !== undefined
          ? JSON.stringify(intentResult.output, null, 2)
          : transport.output !== undefined
            ? JSON.stringify(transport.output, null, 2)
            : typeof input.result.details.stdout === "string"
              ? input.result.details.stdout
              : stripCommandExitTrailer(readTextContent(input.result));
    return {
      ...input.result,
      content: stdout ? [{ type: "text", text: stdout.trimEnd() }] : input.result.content,
      details,
    };
  } finally {
    rmSync(input.svvyxSubprocess.shimDir, { force: true, recursive: true });
  }
}

async function applySvvyxSubprocessIntents(
  options: DirectToolOptions,
  subprocess: PreparedSvvyxSubprocess,
  intents: readonly SvvyxSubprocessIntent[],
  transportOutput: unknown,
  transportCommandFacts: Record<string, unknown> | undefined,
): Promise<{ commandFacts?: Record<string, unknown>; output?: unknown }> {
  let output = cloneJsonObject(transportOutput);
  let commandFacts: Record<string, unknown> | undefined = transportCommandFacts
    ? { ...transportCommandFacts }
    : undefined;
  for (const intent of intents) {
    if (intent.kind === "extension_management.runtime_request") {
      const response = await applyExtensionManagementRuntimeRequestForTransport(
        intent.request,
        options.applyExtensionManagementRuntimeRequest,
      );
      output = response.output;
      commandFacts = { ...response.commandFacts };
      continue;
    }
    if (intent.kind === "workflows.runtime_request") {
      if (!options.applyWorkflowsRuntimeRequest) {
        throw new Error("Workflows Runtime request application is unavailable.");
      }
      const response = await options.applyWorkflowsRuntimeRequest(intent.request);
      output = response.output;
      commandFacts = { ...response.commandFacts };
      continue;
    }
    if (intent.kind === "artifact.operation") {
      if (
        !subprocess.runtime ||
        !subprocess.sourceCommandId ||
        !options.artifactState ||
        !options.runState
      ) {
        throw new Error("Artifacts commands require active prompt command context.");
      }
      const result = await runSvvyxArtifactsOperation({
        artifactState: options.artifactState,
        cwd: subprocess.commandCwd,
        operation: intent.operation,
        runtime: subprocess.runtime,
        runState: options.runState,
        readArtifactRootForSession: options.readArtifactRootForSession,
        sourceCommand: { id: subprocess.sourceCommandId as CommandId },
        onAppLog: options.onAppLog,
      }).catch((error) => {
        throw new Error(JSON.stringify(formatSvvyxArtifactsError(error)));
      });
      output = result.output;
      commandFacts = {
        ...commandFacts,
        ...result.commandFacts,
      };
      continue;
    }
  }
  return {
    ...(commandFacts ? { commandFacts } : {}),
    ...(output !== undefined ? { output } : {}),
  };
}

export async function applyExtensionManagementRuntimeRequestForTransport(
  request: SvvyxExtensionManagementRuntimeRequest,
  apply:
    | ((
        request: SvvyxExtensionManagementRuntimeRequest,
      ) => Promise<SvvyxExtensionManagementRuntimeResponse>)
    | undefined,
): Promise<SvvyxExtensionManagementRuntimeResponse> {
  if (!apply) {
    throw new Error("Extension Managing Runtime request application is unavailable.");
  }
  try {
    return await apply(request);
  } catch {
    const build = request.operation === "build";
    const snapshot = request.operation.startsWith("snapshots.");
    return {
      output: {
        ok: false,
        error: {
          code: build
            ? "EXTENSION_BUILD_FAILED"
            : snapshot
              ? "EXTENSION_SNAPSHOT_FAILED"
              : "EXTENSION_MANAGEMENT_FAILED",
          message: build
            ? "The extension build did not complete. Inspect Extensions readiness for details."
            : snapshot
              ? "The extension snapshot operation did not complete. Refresh snapshots and retry."
              : "The Extension Managing operation did not complete. Refresh extension state and retry.",
        },
      },
      commandFacts: {
        extensionManagementRuntimeRequest: request.operation,
        extensionManagementRuntimeOk: false,
      },
    };
  }
}

export async function applyWorkflowsRuntimeRequestForTransport(
  request: SvvyxWorkflowsRuntimeRequest,
  apply:
    | ((request: SvvyxWorkflowsRuntimeRequest) => Promise<SvvyxWorkflowsRuntimeResponse>)
    | undefined,
): Promise<SvvyxWorkflowsRuntimeResponse> {
  if (!apply) {
    throw new Error("Workflows Runtime request application is unavailable.");
  }
  return apply(request);
}

function replaySvvyxSubprocessProgressEvents(
  options: DirectToolOptions,
  subprocess: PreparedSvvyxSubprocess,
  events: readonly SvvyxSubprocessProgressEvent[],
  finalCommandFacts: Record<string, unknown> | undefined,
): void {
  if (
    !options.commandState ||
    !options.runState ||
    !subprocess.runtime ||
    !subprocess.sourceCommandId
  ) {
    return;
  }
  for (const event of events) {
    const facts = event.phase === "succeeded" ? finalCommandFacts : event.facts;
    const data: CommandEventPayload = {
      command: subprocess.command,
      family: event.family,
      phase: event.phase,
      source: "svvyx-cli-subprocess",
      ...(isJsonRecord(facts) ? { facts } : {}),
    };
    options.runState(
      options.commandState.recordCommandEvent({
        sessionId: subprocess.runtime.sessionId,
        commandId: subprocess.sourceCommandId,
        kind: "command.progress",
        data,
      }),
    );
  }
}

function cloneJsonObject(value: unknown): unknown {
  return value === undefined ? undefined : structuredClone(value);
}

function createSvvyxSubprocessShim(): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "svvyx-subprocess-"));
  const shimPath = join(dir, "svvyx");
  const entrypoint = join(import.meta.dir, "svvyx-subprocess.ts");
  writeFileSync(
    shimPath,
    [
      "#!/bin/sh",
      `exec ${shellSingleQuote(process.execPath)} ${shellSingleQuote(entrypoint)} "$@"`,
    ].join("\n") + "\n",
  );
  chmodSync(shimPath, 0o755);
  return { dir };
}

export function readSvvyxSubprocessResult(
  path: string,
  resultKey: string,
): SvvyxSubprocessTransport {
  try {
    const signed = JSON.parse(readFileSync(path, "utf8")) as SignedSvvyxSubprocessTransport;
    if (!isValidSvvyxSubprocessSignature(signed, resultKey)) {
      return {
        agentProfileMutations: [],
        appLogEvents: [],
        intents: [],
        ok: false,
        progressEvents: [],
      };
    }
    const parsed = signed.payload;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        agentProfileMutations: [],
        appLogEvents: [],
        intents: [],
        ok: false,
        progressEvents: [],
      };
    }
    const appLogEvents = Array.isArray((parsed as { appLogEvents?: unknown }).appLogEvents)
      ? (parsed as { appLogEvents: AppLoggerEvent[] }).appLogEvents
      : [];
    const commandFacts = (parsed as { commandFacts?: unknown }).commandFacts;
    const agentProfileMutations = Array.isArray(
      (parsed as { agentProfileMutations?: unknown }).agentProfileMutations,
    )
      ? (parsed as { agentProfileMutations: unknown[] }).agentProfileMutations.flatMap((value) => {
          const mutation = readAgentProfileMutation(value);
          return mutation ? [mutation] : [];
        })
      : [];
    const agentSettingsState = (parsed as { agentSettingsState?: unknown }).agentSettingsState;
    const intents = Array.isArray((parsed as { intents?: unknown }).intents)
      ? (parsed as { intents: unknown[] }).intents.flatMap(readSvvyxSubprocessIntent)
      : [];
    const progressEvents = Array.isArray((parsed as { progressEvents?: unknown }).progressEvents)
      ? (parsed as { progressEvents: unknown[] }).progressEvents.flatMap(
          readSvvyxSubprocessProgressEvent,
        )
      : [];
    const output = (parsed as { output?: unknown }).output;
    return {
      agentProfileMutations,
      appLogEvents,
      ...(agentSettingsState && typeof agentSettingsState === "object"
        ? { agentSettingsState: agentSettingsState as AgentSettingsState }
        : {}),
      ...(commandFacts && typeof commandFacts === "object" && !Array.isArray(commandFacts)
        ? { commandFacts: commandFacts as Record<string, unknown> }
        : {}),
      intents,
      ok:
        (parsed as { status?: unknown }).status === "succeeded" ||
        (parsed as { ok?: unknown }).ok === true,
      ...(output !== undefined ? { output } : {}),
      progressEvents,
    };
  } catch {
    return {
      agentProfileMutations: [],
      appLogEvents: [],
      intents: [],
      ok: false,
      progressEvents: [],
    };
  }
}

function readSvvyxSubprocessIntent(value: unknown): SvvyxSubprocessIntent[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const intent = value as {
    id?: unknown;
    input?: unknown;
    kind?: unknown;
    operation?: unknown;
    request?: unknown;
    target?: unknown;
  };
  if (
    intent.kind === "artifact.operation" &&
    intent.operation &&
    typeof intent.operation === "object" &&
    !Array.isArray(intent.operation) &&
    isSvvyxArtifactsOperationInput(intent.operation)
  ) {
    return [
      {
        id: typeof intent.id === "string" ? intent.id : "artifact.operation",
        kind: "artifact.operation",
        operation: intent.operation,
      },
    ];
  }
  if (intent.kind === "extension_management.runtime_request") {
    const decoded = decodeUnknownSvvyxExtensionManagementRuntimeIntentExit(intent);
    if (!Exit.isSuccess(decoded)) {
      throw new Error("Invalid Extension Managing Runtime request intent.");
    }
    return [decoded.value];
  }
  if (intent.kind === "workflows.runtime_request") {
    const decoded = decodeUnknownSvvyxWorkflowsRuntimeIntentExit(intent);
    if (!Exit.isSuccess(decoded)) return [];
    return [decoded.value];
  }
  return [];
}

function isSvvyxArtifactsOperationInput(
  operation: unknown,
): operation is SvvyxArtifactsOperationInput {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    return false;
  }
  const candidate = operation as { commandId?: unknown; options?: unknown };
  if (candidate.commandId === "create") {
    return Boolean(candidate.options && typeof candidate.options === "object");
  }
  if (
    candidate.commandId === "inspect" ||
    candidate.commandId === "open" ||
    candidate.commandId === "delete"
  ) {
    const options = candidate.options as { id?: unknown } | undefined;
    return options !== undefined && typeof options === "object" && typeof options.id === "string";
  }
  if (candidate.commandId === "list") {
    return candidate.options === undefined || typeof candidate.options === "object";
  }
  return false;
}

function readSvvyxSubprocessProgressEvent(value: unknown): SvvyxSubprocessProgressEvent[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const event = value as { facts?: unknown; family?: unknown; phase?: unknown };
  if (
    typeof event.family !== "string" ||
    (event.phase !== "started" && event.phase !== "succeeded" && event.phase !== "failed")
  ) {
    return [];
  }
  if (event.facts !== undefined && !isJsonRecord(event.facts)) {
    return [];
  }
  return [
    {
      family: event.family,
      phase: event.phase,
      ...(event.facts ? { facts: event.facts } : {}),
    },
  ];
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return (
    Boolean(value && typeof value === "object" && !Array.isArray(value)) &&
    Object.values(value as Record<string, unknown>).every(isJsonValue)
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

function isValidSvvyxSubprocessSignature(
  signed: SignedSvvyxSubprocessTransport,
  resultKey: string,
): boolean {
  if (!signed || typeof signed !== "object") {
    return false;
  }
  if (
    signed.envelopeVersion !== 1 ||
    typeof signed.invocationId !== "string" ||
    typeof signed.commandId !== "string" ||
    typeof signed.extensionId !== "string" ||
    typeof signed.createdAt !== "string" ||
    !signed.signature ||
    signed.signature.algorithm !== "hmac-sha256" ||
    signed.signature.keyId !== "svvyx-subprocess-result" ||
    typeof signed.signature.digest !== "string"
  ) {
    return false;
  }
  const signatureMaterial = {
    envelopeVersion: signed.envelopeVersion,
    invocationId: signed.invocationId,
    commandId: signed.commandId,
    extensionId: signed.extensionId,
    createdAt: signed.createdAt,
    payload: signed.payload,
  };
  const expected = createHmac("sha256", resultKey)
    .update(JSON.stringify(signatureMaterial))
    .digest("base64url");
  const actualBuffer = Buffer.from(signed.signature.digest);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function replaySvvyxSubprocessAppLogEvents(
  options: DirectToolOptions,
  events: AppLoggerEvent[],
): void {
  for (const event of events) {
    options.onAppLog?.(event);
  }
}

function replaySvvyxSubprocessAgentSettings(
  options: DirectToolOptions,
  nextState: AgentSettingsState | undefined,
): void {
  const store = options.agentSettingsStore;
  if (!store || !nextState) {
    return;
  }
  store.setExtensionEnv(nextState.extensionEnv);
  store.hydrateStateOwnedAppPreferences(nextState.appPreferences);
}

function readTextContent(result: { content: { type: "text"; text: string }[] }): string {
  return result.content.map((block) => block.text).join("\n");
}

function stripCommandExitTrailer(text: string): string {
  return text.replace(/\nexit code: 0\s*$/, "");
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function assertPatchDoesNotEditWorkflowsGeneratedOutput(
  patch: string,
  options: WorkflowsGeneratedProtectionOptions,
): void {
  for (const path of readPatchTouchedPaths(patch)) {
    if (isProtectedDirectEditPath(path, options.cwd, options)) {
      throw new Error(WORKFLOWS_GENERATED_DIRECT_EDIT_MESSAGE);
    }
  }
}

function assertPatchRespectsRuntimeLaunchFacts(
  patch: string,
  launchFacts: SandboxLaunchFacts | null,
): void {
  if (!launchFacts || launchFacts.mode !== "managed") {
    return;
  }
  for (const path of readPatchTouchedPaths(patch)) {
    const candidatePath = isAbsolute(path)
      ? resolvePath(path)
      : resolvePath(launchFacts.policySnapshot.cwd, path);
    const decision = checkSandboxPathAccess({
      cwd: launchFacts.policySnapshot.cwd as AbsolutePath,
      followSymlinks: false,
      operation: "write",
      path: candidatePath as AbsolutePath,
      snapshot: launchFacts.policySnapshot,
    });
    if (decision.status !== "allowed") {
      throw new Error(MANAGED_FILESYSTEM_DENIED_WRITE_MESSAGE);
    }
  }
}

async function assertDirectToolApproved(input: {
  command?: string;
  commandCwd?: string;
  commandFamily?: string;
  options: DirectToolOptions;
  patch?: string;
  toolCallId: string;
  toolName: "apply_patch" | "exec_command";
}): Promise<void> {
  const approvalMode = resolveApprovalMode(input.options);
  if (approvalMode === "full-access" || !input.options.approvalBoundary) {
    return;
  }
  const activeCommand = findActiveDirectToolCommandForOptions({
    options: input.options,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
  });
  const approval = await input.options.approvalBoundary({
    approvalMode,
    command: input.command,
    commandFamily: input.commandFamily,
    cwd: input.commandCwd ?? input.options.cwd,
    patch: input.patch,
    ...directToolApprovalTarget({
      activeCommand,
      options: input.options,
      toolCallId: input.toolCallId,
    }),
    toolName: input.toolName,
  });
  if (approval.approved === false) {
    throw new Error(approval.reason?.trim() || `${input.toolName} was not approved.`);
  }
}

async function assertSandboxEscalationApproved(input: {
  command?: string;
  commandCwd?: string;
  options: DirectToolOptions;
  patch?: string;
  result:
    | ReturnType<typeof spawnSync>
    | { content: { type: "text"; text: string }[]; details: Record<string, unknown> };
  toolCallId: string;
  toolName: "apply_patch" | "exec_command";
}): Promise<void> {
  const approvalMode = resolveApprovalMode(input.options);
  if (approvalMode === "full-access") {
    return;
  }
  if (!input.options.approvalBoundary) {
    throw new Error("Unsandboxed retry after sandbox denial requires approval.");
  }
  const activeCommand = findActiveDirectToolCommandForOptions({
    options: input.options,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
  });
  const approval = await input.options.approvalBoundary({
    approvalMode,
    command: input.command,
    context: {
      reason: "sandbox_denial_escalation",
      sandboxDenied: true,
    },
    cwd: input.commandCwd ?? input.options.cwd,
    patch: input.patch,
    ...directToolApprovalTarget({
      activeCommand,
      options: input.options,
      toolCallId: input.toolCallId,
    }),
    toolName: input.toolName,
  });
  if (approval.approved === false) {
    throw new Error(approval.reason?.trim() || "Unsandboxed retry was not approved.");
  }
}

function directToolApprovalTarget(input: {
  activeCommand: RuntimeCommandRecord | null;
  options: DirectToolOptions;
  toolCallId: string;
}): {
  commandId?: CommandId | null;
  sessionId?: WorkspaceSessionId;
  surfacePiSessionId?: SurfacePiSessionId;
  threadId?: ThreadId | null;
  toolCallId: ToolItemId;
  turnId?: TurnId | null;
} {
  const runtime = input.options.runtime?.current;
  return {
    commandId: input.activeCommand?.id as CommandId | undefined,
    sessionId: (input.activeCommand?.sessionId ?? runtime?.workspaceSessionId) as
      | WorkspaceSessionId
      | undefined,
    surfacePiSessionId: (input.activeCommand?.surfacePiSessionId ?? runtime?.surfacePiSessionId) as
      | SurfacePiSessionId
      | undefined,
    threadId: (input.activeCommand?.threadId ?? runtime?.threadId ?? null) as ThreadId | null,
    toolCallId: input.toolCallId as ToolItemId,
    turnId: (input.activeCommand?.turnId ?? runtime?.turnId ?? null) as TurnId | null,
  };
}

function assertCommandDoesNotEditWorkflowsGeneratedOutput(input: {
  command: string;
  commandCwd: string;
  options: WorkflowsGeneratedProtectionOptions;
}): void {
  if (/^svvyx\s+(?:workflows|extensions)(?:\s|$)/.test(input.command.trim())) {
    return;
  }
  if (
    commandLooksLikeWorkflowsGeneratedMutation(input.command) &&
    commandMentionsProtectedDirectEditPath(input.command, input.commandCwd, input.options)
  ) {
    throw new Error(WORKFLOWS_GENERATED_DIRECT_EDIT_MESSAGE);
  }
}

function readPatchTouchedPaths(patch: string): string[] {
  const paths: string[] = [];
  for (const line of patch.split("\n")) {
    if (!line.startsWith("--- ") && !line.startsWith("+++ ")) {
      continue;
    }
    const rawPath = line.slice(4).trim().split(/\s+/)[0] ?? "";
    if (!rawPath || rawPath === "/dev/null") {
      continue;
    }
    paths.push(rawPath.replace(/^([ab])\//, ""));
  }
  return paths;
}

function isProtectedDirectEditPath(
  path: string,
  cwd: string,
  options: WorkflowsGeneratedProtectionOptions,
): boolean {
  const absolutePath = isAbsolute(path) ? resolvePath(path) : resolvePath(cwd, path);
  const policy = protectedDirectEditPolicy(options);
  if (policy.alwaysProtectedRoots.some((root) => isPathInside(root, absolutePath))) {
    return true;
  }
  return (
    policy.protectedRoots.some((root) => isPathInside(root, absolutePath)) &&
    !policy.allowedRoots.some((root) => isPathInside(root, absolutePath))
  );
}

function commandLooksLikeWorkflowsGeneratedMutation(command: string): boolean {
  return /\b(rm|mv|cp|touch|mkdir|tee|install|sed|perl)\b|>{1,2}/.test(command);
}

function commandMentionsProtectedDirectEditPath(
  command: string,
  commandCwd: string,
  options: WorkflowsGeneratedProtectionOptions,
): boolean {
  const policy = protectedDirectEditPolicy(options);
  if (
    policy.alwaysProtectedRoots.some((root) =>
      commandPathNeedles(root, commandCwd, options.cwd).some((needle) => command.includes(needle)),
    )
  ) {
    return true;
  }
  return policy.protectedRoots.some(
    (root) =>
      !policy.allowedRoots.some((allowedRoot) => isPathInside(root, allowedRoot)) &&
      commandPathNeedles(root, commandCwd, options.cwd).some((needle) => command.includes(needle)),
  );
}

function commandPathNeedles(root: string, commandCwd: string, workspaceCwd: string): string[] {
  return [
    root,
    relative(commandCwd, root),
    relative(workspaceCwd, root),
    ".smithers/node_modules/@svvyx/extensions",
    ".smithers/node_modules/@svvyx/workflows",
  ].filter((needle) => needle.length > 0 && needle !== ".");
}

type WorkflowsGeneratedProtectionOptions = Pick<
  DirectToolOptions,
  | "approvalMode"
  | "cwd"
  | "extensionsRoot"
  | "readArtifactRootForSession"
  | "runtime"
  | "workflowsExtensionsGeneratedPackagePath"
  | "workflowsGeneratedPackagePath"
  | "workflowsSourceRoot"
>;

function protectedDirectEditRoots(options: WorkflowsGeneratedProtectionOptions): string[] {
  const policy = protectedDirectEditPolicy(options);
  return [...policy.protectedRoots, ...policy.alwaysProtectedRoots];
}

function protectedDirectEditAllowedRoots(options: WorkflowsGeneratedProtectionOptions): string[] {
  return protectedDirectEditPolicy(options).allowedRoots;
}

function protectedDirectEditPolicy(options: WorkflowsGeneratedProtectionOptions): {
  protectedRoots: string[];
  alwaysProtectedRoots: string[];
  allowedRoots: string[];
} {
  if (resolveApprovalMode(options) === "full-access") {
    return { protectedRoots: [], alwaysProtectedRoots: [], allowedRoots: [] };
  }
  const artifactPolicy = protectedArtifactDirectEditPolicy(options);
  return {
    protectedRoots: [
      ...protectedWorkflowsGeneratedRoots(options),
      ...protectedExtensionInternalRoots(options.extensionsRoot),
      ...artifactPolicy.protectedRoots,
    ],
    alwaysProtectedRoots: artifactPolicy.alwaysProtectedRoots,
    allowedRoots: artifactPolicy.allowedRoots,
  };
}

function protectedArtifactDirectEditPolicy(options: WorkflowsGeneratedProtectionOptions): {
  protectedRoots: string[];
  alwaysProtectedRoots: string[];
  allowedRoots: string[];
} {
  const runtime = options.runtime?.current;
  if (!runtime || !options.readArtifactRootForSession) {
    return { protectedRoots: [], alwaysProtectedRoots: [], allowedRoots: [] };
  }
  let artifactDir: string;
  try {
    const candidate = options.readArtifactRootForSession(runtime.workspaceSessionId);
    if (typeof candidate !== "string" || candidate.length === 0) {
      return { protectedRoots: [], alwaysProtectedRoots: [], allowedRoots: [] };
    }
    artifactDir = candidate;
  } catch {
    return { protectedRoots: [], alwaysProtectedRoots: [], allowedRoots: [] };
  }
  const artifactRoot = resolvePath(artifactDir);
  const sessionArtifactRoot = resolvePath(artifactRoot, runtime.workspaceSessionId);
  return {
    protectedRoots: [artifactRoot],
    alwaysProtectedRoots: [resolvePath(sessionArtifactRoot, "immutable")],
    allowedRoots: [sessionArtifactRoot],
  };
}

function protectedWorkflowsGeneratedRoots(options: WorkflowsGeneratedProtectionOptions): string[] {
  const workflowsPackagePath = resolvePath(
    options.workflowsGeneratedPackagePath ?? workflowsGeneratedPackagePath(),
  );
  const extensionsPackagePath = resolvePath(
    extensionsGeneratedPackagePath({
      extensionsGeneratedPackagePath: options.workflowsExtensionsGeneratedPackagePath,
      generatedPackagePath: options.workflowsGeneratedPackagePath
        ? workflowsPackagePath
        : undefined,
    }),
  );
  return [
    workflowsPackagePath,
    extensionsPackagePath,
    resolvePath(options.cwd, ".smithers", "node_modules", "@svvyx", "extensions"),
    resolvePath(options.cwd, ".smithers", "node_modules", "@svvyx", "workflows"),
  ];
}

function protectedExtensionInternalRoots(extensionsRoot: string | undefined): string[] {
  const root = resolvePath(extensionsRoot ?? defaultExtensionsRoot());
  return [
    resolvePath(root, "generated"),
    resolvePath(root, "builds"),
    resolvePath(root, "trash"),
    resolvePath(root, "snapshots"),
    resolvePath(root, "package", "bun.lock"),
    resolvePath(root, "package", "node_modules"),
    ...generatedInstructionOutputPaths(root),
  ];
}

function generatedInstructionOutputPaths(extensionsRoot: string): string[] {
  const outputs: string[] = [];
  for (const sourcesRoot of [
    resolvePath(extensionsRoot, "sources", "user"),
    resolvePath(extensionsRoot, "sources", "builtin"),
  ]) {
    let extensionIds: string[];
    try {
      extensionIds = readdirSync(sourcesRoot);
    } catch {
      continue;
    }
    for (const extensionId of extensionIds) {
      const sourceRoot = resolvePath(sourcesRoot, extensionId);
      try {
        if (!lstatSync(sourceRoot).isDirectory()) continue;
      } catch {
        continue;
      }
      let manifest: unknown;
      try {
        manifest = JSON.parse(readFileSync(resolvePath(sourceRoot, "manifest.json"), "utf8"));
      } catch {
        continue;
      }
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        continue;
      }
      const generatedInstructions = (manifest as { generatedInstructions?: unknown })
        .generatedInstructions;
      if (!Array.isArray(generatedInstructions)) {
        continue;
      }
      for (const generatedInstruction of generatedInstructions) {
        if (
          !generatedInstruction ||
          typeof generatedInstruction !== "object" ||
          Array.isArray(generatedInstruction)
        ) {
          continue;
        }
        const output = (generatedInstruction as { output?: unknown }).output;
        if (typeof output !== "string") {
          continue;
        }
        const outputPath = resolvePath(sourceRoot, output);
        if (isPathInside(sourceRoot, outputPath)) {
          outputs.push(outputPath);
        }
      }
    }
  }
  return outputs;
}

function defaultExtensionsRoot(): string {
  return resolvePath(homedir(), ".config", "svvy", "extensions");
}

function isPathInside(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function runExecCommand(input: {
  cwd: string;
  cmd: string;
  env?: NodeJS.ProcessEnv;
  launchFacts?: SandboxLaunchFacts | null;
  managedSandbox: boolean;
  networkAccess: boolean;
  protectedWriteRoots: readonly string[];
  protectedWriteAllowedRoots: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
  liveProjection?: LiveCommandProjection | null;
  outputRedactions?: readonly string[];
  runtimeCommandStdin?: LiveCommandStdinRegistry;
  closeLaunchFacts?: () => Promise<void>;
}): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }> {
  const protectedWriteSnapshot = captureProtectedWriteSnapshot(
    input.protectedWriteRoots,
    input.protectedWriteAllowedRoots,
  );
  const child = spawnShellCommand({
    cwd: input.cwd as AbsolutePath,
    cmd: input.cmd,
    env: input.env,
    launchFacts: input.launchFacts ?? null,
  });
  const session: RunningCommandSession = {
    process: child,
    stdout: [],
    stderr: [],
    exitCode: null,
    exitSignal: null,
    managedSandbox: input.managedSandbox,
    protectedWriteSnapshot,
    liveProjection: input.liveProjection ?? null,
    outputRedactions: input.outputRedactions ?? [],
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    const text = redactCommandOutput(String(chunk), input.outputRedactions);
    session.stdout.push(text);
    recordLiveCommandOutput(input.liveProjection, "stdout", text);
  });
  child.stderr.on("data", (chunk) => {
    const text = redactCommandOutput(String(chunk), input.outputRedactions);
    session.stderr.push(text);
    recordLiveCommandOutput(input.liveProjection, "stderr", text);
  });
  child.on("exit", (code, signal) => {
    session.exitCode = code;
    session.exitSignal = signal;
  });
  let launchFactsClosed = false;
  const closeLaunchFacts = async () => {
    if (launchFactsClosed) {
      return;
    }
    launchFactsClosed = true;
    await input.closeLaunchFacts?.();
  };
  session.closeLaunchFacts = closeLaunchFacts;
  child.once("close", () => {
    void closeLaunchFacts();
  });

  const abortHandler = () => child.kill();
  input.signal?.addEventListener("abort", abortHandler, { once: true });
  try {
    const completed = await waitForProcess(child, input.timeoutMs);
    if (completed) {
      assertProtectedWriteSnapshotUnchanged(protectedWriteSnapshot);
      const stdout = drain(session.stdout);
      const stderr = drain(session.stderr);
      const retainedOutputArtifacts = retainCommandOutputArtifacts(input.liveProjection, {
        stdout,
        stderr,
      });
      return {
        content: [
          {
            type: "text",
            text: formatCommandOutput({
              stdout,
              stderr,
              exitCode: session.exitCode,
              exitSignal: session.exitSignal,
            }),
          },
        ],
        details: {
          ...commandOutputFactStreams({
            retainedOutputArtifacts,
            stderr,
            stdout,
          }),
          ...sandboxDenialFacts({
            exitCode: session.exitCode,
            managedSandbox: input.managedSandbox,
            stderr,
            stdout,
          }),
          exitCode: session.exitCode,
          exitSignal: session.exitSignal,
          ...(retainedOutputArtifacts.length > 0 ? { retainedOutputArtifacts } : {}),
        },
      };
    }

    const sessionId = `exec_${randomUUID()}`;
    runningCommandSessions.set(sessionId, session);
    registerRuntimeCommandStdinSession(input.runtimeCommandStdin, sessionId, session);
    return {
      content: [
        {
          type: "text",
          text: formatRunningSessionOutput(sessionId, drain(session.stdout), drain(session.stderr)),
        },
      ],
      details: { sessionId, running: true },
    };
  } finally {
    input.signal?.removeEventListener("abort", abortHandler);
    if (session.exitCode !== null || session.exitSignal !== null) {
      await closeLaunchFacts();
    }
  }
}

async function runExecCommandWithSandboxEscalation(input: {
  input: Parameters<typeof runExecCommand>[0];
  options: DirectToolOptions;
  toolCallId: string;
}): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }> {
  const result = await runExecCommand(input.input);
  if (
    result.details.running === true ||
    result.details.sandboxDenied !== true ||
    isSandboxHelperBootstrapFailure(
      `${String(result.details.stdout ?? "")}\n${String(result.details.stderr ?? "")}`,
    )
  ) {
    return result;
  }
  await assertSandboxEscalationApproved({
    command: input.input.cmd,
    commandCwd: input.input.cwd,
    options: input.options,
    result,
    toolCallId: input.toolCallId,
    toolName: "exec_command",
  });
  return await runExecCommand({
    ...input.input,
    closeLaunchFacts: undefined,
    launchFacts: null,
    managedSandbox: false,
  });
}

function recordLiveCommandOutput(
  liveProjection: LiveCommandProjection | null | undefined,
  stream: "stdout" | "stderr",
  text: string,
): void {
  if (!liveProjection || text.length === 0) {
    return;
  }
  const bytes = Buffer.byteLength(text, "utf8");
  const previousBytes = liveProjection.outputEventBytes[stream];
  const nextBytes = previousBytes + bytes;
  const remainingEventBytes = RETAINED_COMMAND_OUTPUT_ARTIFACT_THRESHOLD_BYTES - previousBytes;
  if (remainingEventBytes <= 0) {
    recordRetainedCommandOutputEvent(liveProjection, stream);
    liveProjection.outputEventBytes[stream] = nextBytes;
    return;
  }
  const eventText =
    nextBytes > RETAINED_COMMAND_OUTPUT_ARTIFACT_THRESHOLD_BYTES
      ? truncateUtf8(text, remainingEventBytes)
      : text;
  if (eventText.length > 0) {
    liveProjection.runState(
      liveProjection.commandState.recordCommandEvent({
        sessionId: liveProjection.sessionId,
        kind: "command.output",
        commandId: liveProjection.commandId,
        data: {
          stream,
          source: "live-stream",
          text: eventText,
        },
      }),
    );
  }
  liveProjection.outputEventBytes[stream] = nextBytes;
  if (nextBytes > RETAINED_COMMAND_OUTPUT_ARTIFACT_THRESHOLD_BYTES) {
    recordRetainedCommandOutputEvent(liveProjection, stream);
  }
}

function recordRetainedCommandOutputEvent(
  liveProjection: LiveCommandProjection,
  stream: "stdout" | "stderr",
): void {
  if (liveProjection.outputEventRetainedStreams.has(stream)) {
    return;
  }
  liveProjection.outputEventRetainedStreams.add(stream);
  liveProjection.runState(
    liveProjection.commandState.recordCommandEvent({
      sessionId: liveProjection.sessionId,
      kind: "command.output",
      commandId: liveProjection.commandId,
      data: {
        stream,
        source: "retained-log-artifact",
        text: RETAINED_COMMAND_OUTPUT_EVENT_MESSAGE,
      },
    }),
  );
}

function truncateUtf8(text: string, bytes: number): string {
  if (bytes <= 0 || Buffer.byteLength(text, "utf8") <= bytes) {
    return bytes <= 0 ? "" : text;
  }
  return Buffer.from(text, "utf8").subarray(0, bytes).toString("utf8");
}

function retainCommandOutputArtifacts(
  liveProjection: LiveCommandProjection | null | undefined,
  output: {
    stderr?: string;
    stdout?: string;
  },
): RetainedCommandOutputArtifact[] {
  if (!liveProjection) {
    return [];
  }
  const retained: RetainedCommandOutputArtifact[] = [];
  for (const stream of ["stdout", "stderr"] as const) {
    const text = output[stream];
    if (
      !text ||
      Buffer.byteLength(text, "utf8") <= RETAINED_COMMAND_OUTPUT_ARTIFACT_THRESHOLD_BYTES
    ) {
      continue;
    }
    const artifact = materializeRuntimeArtifact({
      artifactRoot: artifactRootForSession({
        cwd: liveProjection.cwd,
        sessionId: liveProjection.sessionId,
        readArtifactRootForSession: liveProjection.readArtifactRootForSession,
      }),
      artifactState: liveProjection.artifactState,
      runState: liveProjection.runState,
      workspaceSessionId: liveProjection.sessionId as WorkspaceSessionId,
      sourceCommandId: liveProjection.commandId as CommandId,
      kind: "log",
      name: `command-output-${stream}-${randomUUID()}.log`,
      content: text,
      mimeType: "text/plain",
      immutable: true,
    });
    retained.push(retainedCommandOutputArtifact(stream, artifact));
  }
  return retained;
}

function retainedCommandOutputArtifact(
  stream: "stderr" | "stdout",
  artifact: RuntimeArtifactMaterializedRecord,
): RetainedCommandOutputArtifact {
  return {
    artifactId: artifact.artifactId,
    bytes: artifact.byteSize,
    name: artifact.name,
    stream,
  };
}

function commandOutputFactStreams(input: {
  retainedOutputArtifacts: RetainedCommandOutputArtifact[];
  stderr: string;
  stdout: string;
}): {
  stderr?: string;
  stdout?: string;
} {
  const retainedStreams = new Set(input.retainedOutputArtifacts.map((artifact) => artifact.stream));
  return {
    ...(retainedStreams.has("stdout") ? {} : { stdout: input.stdout }),
    ...(retainedStreams.has("stderr") ? {} : { stderr: input.stderr }),
  };
}

function finishLiveCommandProjection(
  liveProjection: LiveCommandProjection | null,
  result: {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    exitSignal: NodeJS.Signals | null;
    managedSandbox?: boolean;
  },
): void {
  if (!liveProjection) {
    return;
  }
  const failed = result.exitSignal !== null || (result.exitCode !== null && result.exitCode !== 0);
  const retainedOutputArtifacts = retainCommandOutputArtifacts(liveProjection, {
    stdout: result.stdout,
    stderr: result.stderr,
  });
  liveProjection.runState(
    liveProjection.commandState.finishCommand({
      commandId: liveProjection.commandId,
      status: failed ? "failed" : "succeeded",
      summary: failed
        ? `Command finished with ${result.exitSignal ? `signal ${result.exitSignal}` : `exit code ${result.exitCode}`}.`
        : "Command completed successfully.",
      facts: {
        ...commandOutputFactStreams({
          retainedOutputArtifacts,
          stderr: result.stderr,
          stdout: result.stdout,
        }),
        ...sandboxDenialFacts({
          exitCode: result.exitCode,
          managedSandbox: result.managedSandbox ?? liveProjection.managedSandbox,
          stderr: result.stderr,
          stdout: result.stdout,
        }),
        exitCode: result.exitCode,
        exitSignal: result.exitSignal,
        ...(retainedOutputArtifacts.length > 0 ? { retainedOutputArtifacts } : {}),
      },
      error: failed
        ? result.stderr.trim() ||
          (result.exitSignal
            ? `Command terminated by signal ${result.exitSignal}.`
            : `Command exited with code ${result.exitCode}.`)
        : null,
    }),
  );
}

function spawnShellCommand(input: {
  cwd: string;
  cmd: string;
  env?: NodeJS.ProcessEnv;
  launchFacts?: SandboxLaunchFacts | null;
}): ChildProcessWithoutNullStreams {
  const shell = getShell();
  const env = { ...process.env, ...input.env };
  if (input.launchFacts) {
    return spawn(input.launchFacts.spawn.executable, input.launchFacts.spawn.args, {
      cwd: input.launchFacts.spawn.cwd,
      env,
    });
  }
  return spawn(shell, ["-lc", input.cmd], {
    cwd: input.cwd,
    env,
  });
}

function spawnPatchCommand(input: {
  cwd: string;
  launchFacts?: SandboxLaunchFacts | null;
  patch: string;
}): ReturnType<typeof spawnSync> {
  const command = ["patch", "-p0", "--forward"] as const;
  if (input.launchFacts) {
    return spawnSync(input.launchFacts.spawn.executable, input.launchFacts.spawn.args, {
      cwd: input.launchFacts.spawn.cwd,
      input: input.patch,
      encoding: "utf8",
    });
  }
  return spawnSync("patch", command.slice(1), {
    cwd: input.cwd,
    input: input.patch,
    encoding: "utf8",
  });
}

function isEscalatableSandboxDeniedPatchResult(
  result: ReturnType<typeof spawnSync>,
  managedSandbox: boolean,
): boolean {
  const stderr = typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? "");
  const stdout = typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? "");
  return (
    isSandboxDenialOutput({
      exitCode: result.status,
      managedSandbox,
      stderr,
      stdout,
    }) && !isSandboxHelperBootstrapFailure(`${stdout}\n${stderr}`)
  );
}

function resolveNetworkAccess(options: DirectToolOptions): boolean {
  if (resolveApprovalMode(options) === "full-access") {
    return true;
  }
  if (typeof options.networkAccess === "function") {
    return options.networkAccess() !== false;
  }
  return options.networkAccess !== false;
}

function resolveManagedSandbox(options: DirectToolOptions): boolean {
  if (resolveApprovalMode(options) === "full-access") {
    return false;
  }
  if (typeof options.managedSandbox === "function") {
    return options.managedSandbox() !== false;
  }
  return options.managedSandbox !== false;
}

function resolveApprovalMode(options: Pick<DirectToolOptions, "approvalMode">): ApprovalMode {
  if (typeof options.approvalMode === "function") {
    return options.approvalMode();
  }
  return options.approvalMode ?? "auto-review";
}

function captureProtectedWriteSnapshot(
  roots: readonly string[],
  allowedRoots: readonly string[] = [],
): ProtectedWriteSnapshot {
  const normalizedAllowedRoots = [
    ...new Set(allowedRoots.map((root) => resolvePath(root))),
  ].toSorted();
  const rootSnapshots = [...new Set(roots)]
    .toSorted()
    .map((root) => captureProtectedWriteRootSnapshot(root, normalizedAllowedRoots));
  return {
    roots: rootSnapshots,
    allowedRoots: normalizedAllowedRoots,
  };
}

function assertProtectedWriteSnapshotUnchanged(snapshot: ProtectedWriteSnapshot): void {
  const current = captureProtectedWriteSnapshot(
    snapshot.roots.map((root) => root.root),
    snapshot.allowedRoots,
  );
  const changedRoots = snapshot.roots.filter((root, index) => {
    const currentRoot = current.roots[index];
    return !currentRoot || root.fingerprint !== currentRoot.fingerprint;
  });
  if (changedRoots.length === 0) {
    return;
  }
  restoreProtectedWriteSnapshot({ ...snapshot, roots: changedRoots });
  throw new Error(WORKFLOWS_GENERATED_DIRECT_EDIT_MESSAGE);
}

function captureProtectedWriteRootSnapshot(
  root: string,
  allowedRoots: readonly string[],
): ProtectedWriteRootSnapshot {
  const rootAllowedRoots = allowedRoots.filter((allowedRoot) => isPathInside(root, allowedRoot));
  const entries: ProtectedWriteEntry[] = [];
  captureProtectedWriteEntry(root, root, rootAllowedRoots, entries);
  const sortedEntries = entries.toSorted((left, right) => left.path.localeCompare(right.path));
  return {
    root,
    existed: entries.length > 0,
    entries: sortedEntries,
    allowedRoots: rootAllowedRoots,
    fingerprint: JSON.stringify({
      root,
      existed: entries.length > 0,
      entries: sortedEntries.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        data: entry.data?.toString("base64"),
        linkTarget: entry.linkTarget,
      })),
    }),
  };
}

function captureProtectedWriteEntry(
  root: string,
  absolutePath: string,
  allowedRoots: readonly string[],
  entries: ProtectedWriteEntry[],
): void {
  if (
    absolutePath !== root &&
    allowedRoots.some((allowedRoot) => isPathInside(allowedRoot, absolutePath))
  ) {
    return;
  }
  let stat;
  try {
    stat = lstatSync(absolutePath);
  } catch {
    return;
  }
  const path = relative(root, absolutePath) || ".";
  if (stat.isSymbolicLink()) {
    entries.push({ path, kind: "symlink", linkTarget: readlinkSync(absolutePath) });
    return;
  }
  if (stat.isDirectory()) {
    entries.push({ path, kind: "directory" });
    for (const child of readdirSync(absolutePath).toSorted()) {
      captureProtectedWriteEntry(root, resolvePath(absolutePath, child), allowedRoots, entries);
    }
    return;
  }
  if (stat.isFile()) {
    entries.push({ path, kind: "file", data: readFileSync(absolutePath) });
    return;
  }
  entries.push({ path, kind: "other" });
}

function restoreProtectedWriteSnapshot(snapshot: ProtectedWriteSnapshot): void {
  for (const root of snapshot.roots) {
    if (root.allowedRoots.length > 0) {
      removeProtectedWritePathOutsideAllowedRoots(root.root, root.root, root.allowedRoots);
    } else {
      rmSync(root.root, { force: true, recursive: true });
    }
    if (!root.existed) {
      continue;
    }
    for (const entry of root.entries) {
      const path = entry.path === "." ? root.root : resolvePath(root.root, entry.path);
      if (root.allowedRoots.some((allowedRoot) => isPathInside(allowedRoot, path))) {
        continue;
      }
      if (entry.kind === "directory") {
        mkdirSync(path, { recursive: true });
      } else if (entry.kind === "file") {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, entry.data ?? Buffer.alloc(0));
      } else if (entry.kind === "symlink" && entry.linkTarget !== undefined) {
        mkdirSync(dirname(path), { recursive: true });
        symlinkSync(entry.linkTarget, path);
      }
    }
  }
}

function removeProtectedWritePathOutsideAllowedRoots(
  root: string,
  absolutePath: string,
  allowedRoots: readonly string[],
): void {
  if (absolutePath !== root) {
    if (allowedRoots.some((allowedRoot) => isPathInside(allowedRoot, absolutePath))) {
      return;
    }
    if (!allowedRoots.some((allowedRoot) => isPathInside(absolutePath, allowedRoot))) {
      rmSync(absolutePath, { force: true, recursive: true });
      return;
    }
  }
  let stat;
  try {
    stat = lstatSync(absolutePath);
  } catch {
    return;
  }
  if (!stat.isDirectory()) {
    if (absolutePath !== root) {
      rmSync(absolutePath, { force: true, recursive: true });
    }
    return;
  }
  for (const child of readdirSync(absolutePath)) {
    removeProtectedWritePathOutsideAllowedRoots(
      root,
      resolvePath(absolutePath, child),
      allowedRoots,
    );
  }
}

function waitForProcess(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once("close", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

function getShell(): string {
  return process.env.SHELL || "/bin/sh";
}

function drain(chunks: string[]): string {
  const output = chunks.join("");
  chunks.length = 0;
  return output;
}

function formatRunningSessionOutput(sessionId: string, stdout: string, stderr: string): string {
  const output = formatCommandOutput({ stdout, stderr, exitCode: null, exitSignal: null }).trim();
  return [output, `Command is still running. session_id: ${sessionId}`].filter(Boolean).join("\n");
}

function formatCommandOutput(input: {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
}): string {
  const parts = [];
  if (input.stdout) parts.push(input.stdout.trimEnd());
  if (input.stderr) parts.push(input.stderr.trimEnd());
  if (input.exitSignal) {
    parts.push(`terminated by signal: ${input.exitSignal}`);
  } else if (input.exitCode !== null) {
    parts.push(`exit code: ${input.exitCode}`);
  }
  return parts.filter(Boolean).join("\n");
}

function findActiveDirectToolCommandForOptions(input: {
  options: DirectToolOptions;
  toolCallId: string;
  toolName: "exec_command" | "apply_patch";
}): RuntimeCommandRecord | null {
  const runtime = input.options.runtime?.current;
  if (!runtime || !input.options.commandState || !input.options.runState) {
    return null;
  }
  return findActiveDirectToolCommand({
    commandState: input.options.commandState,
    runState: input.options.runState,
    sessionId: runtime.workspaceSessionId,
    surfacePiSessionId: runtime.surfacePiSessionId as SurfacePiSessionId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    turnId: runtime.turnId,
    workflowTaskAttemptId: runtime.workflowTaskAttemptId ?? null,
  });
}

function findActiveDirectToolCommand(input: {
  commandState: RuntimeCommandStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
  sessionId: string;
  surfacePiSessionId: SurfacePiSessionId;
  turnId: string | null;
  workflowTaskAttemptId: string | null;
  toolCallId: string;
  toolName: "exec_command" | "apply_patch";
}): RuntimeCommandRecord | null {
  const command = input.runState(
    input.commandState.findCommandByToolCallId({
      toolCallId: input.toolCallId,
      surfacePiSessionId: input.surfacePiSessionId,
    }),
  );
  if (
    !command ||
    command.sessionId !== input.sessionId ||
    command.turnId !== input.turnId ||
    command.workflowTaskAttemptId !== input.workflowTaskAttemptId ||
    command.toolName !== input.toolName ||
    command.status !== "running" ||
    command.facts?.toolCallId !== input.toolCallId
  ) {
    return null;
  }
  return command;
}

async function acquireRuntimeDirectToolLaunchFacts(input: {
  activeCommand: RuntimeCommandRecord | null;
  command: readonly string[];
  cwd: string;
  envFacts: BuildLaunchPolicyInput["envFacts"];
  options: DirectToolOptions;
  toolName: "exec_command" | "apply_patch";
}): Promise<{ facts: SandboxLaunchFacts; close(): Promise<void> } | null> {
  if (!input.options.acquireDirectToolLaunch) {
    if (resolveManagedSandbox(input.options)) {
      throw new Error(`Runtime launch acquisition for ${input.toolName} is required.`);
    }
    return null;
  }
  const runtime = input.options.runtime?.current;
  if (!runtime) {
    throw new Error(`Runtime launch acquisition for ${input.toolName} requires prompt context.`);
  }
  if (!input.options.workspaceId) {
    throw new Error(`Runtime launch acquisition for ${input.toolName} requires workspaceId.`);
  }
  if (!input.activeCommand) {
    throw new Error(`Runtime launch acquisition for ${input.toolName} requires an active command.`);
  }
  return input.options.acquireDirectToolLaunch({
    scope: {
      kind: "workspace",
      workspaceId: input.options.workspaceId as WorkspaceId,
    },
    surfacePiSessionId: runtime.surfacePiSessionId as SurfacePiSessionId,
    commandId: input.activeCommand.id as CommandId,
    toolName: input.toolName,
    command: [...input.command],
    cwd: input.cwd as AbsolutePath,
    envFacts: input.envFacts,
  });
}

function launchFactsManagedSandbox(facts: SandboxLaunchFacts | undefined): boolean {
  return facts?.mode === "managed";
}

function launchFactsNetworkAccess(
  facts: SandboxLaunchFacts | undefined,
  options: DirectToolOptions,
): boolean {
  return facts ? facts.policySnapshot.networkPolicy === "allow" : resolveNetworkAccess(options);
}

function environmentFactsForEnv(env: NodeJS.ProcessEnv): BuildLaunchPolicyInput["envFacts"] {
  return Object.keys(env)
    .toSorted()
    .map((key) => ({
      key,
      redactionLabel: "direct_tool_env",
    }));
}
