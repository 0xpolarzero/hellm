import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
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
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type { AppLoggerEvent } from "./app-logger";
import type { RuntimeApprovalBoundary } from "./approval-boundary";
import type { AgentSettingsStore } from "./agent-settings-store";
import {
  buildManagedWorkspaceWriteFileSystemPolicy,
  canWriteFileSystemPath,
  unrestrictedFileSystemPolicy,
  type FileSystemSandboxPolicy,
} from "./filesystem-sandbox-policy";
import { buildSandboxHelperArgs, resolveSandboxHelperPath } from "./sandbox-helper";
import type { ExtensionEnvSecretStore } from "./extension-env-secret-store";
import { getWorkflowsGeneratedPackagePath } from "./smithers-runtime/workflow-library";
import { effectiveExtensionsGeneratedPackagePath } from "./generated-extensions-package";
import type {
  StructuredArtifactRecord,
  StructuredCommandRecord,
  StructuredSessionStateStore,
} from "./structured-session-state";
import type { SvvyxArtifactOpenHandler } from "./svvyx-artifacts-command";
import type { SvvyxExtensionsCliProbe } from "./svvyx-extensions-command";
import type { SvvyxRuntimeEnvValues } from "./svvyx-runtime-command";
import type { SvvyxWorkflowsModelCatalogReader } from "./svvyx-workflows-command";
import type { AgentSettingsState, ApprovalMode } from "../shared/agent-settings";

type RunningCommandSession = {
  process: ChildProcessWithoutNullStreams;
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  managedSandbox: boolean;
  protectedWriteSnapshot: ProtectedWriteSnapshot;
  liveProjection: LiveCommandProjection | null;
};

type LiveCommandProjection = {
  store: StructuredSessionStateStore;
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
  "Generated Workflows output, workspace @svvy/workflows/@svvy/extensions package links, internal Extension files, and immutable or non-active-session Artifacts are read-only. Edit Workflows source, Extension source/manifest/package.json, or the active session's mutable artifact files through the intended command path instead.";
const MANAGED_FILESYSTEM_DENIED_WRITE_MESSAGE =
  "Managed filesystem policy allows writes only inside the workspace, configured writable roots, active mutable artifacts, and explicit extension source roots.";

type DirectToolOptions = {
  cwd: string;
  runtime?: PromptExecutionRuntimeHandle;
  store?: StructuredSessionStateStore;
  openArtifact?: SvvyxArtifactOpenHandler;
  onWorkflowsGeneratedPackageChanged?: (input: {
    reason: "svvyx-workflows-build" | "svvyx-workflows-save";
    commandFacts: Record<string, unknown>;
  }) => void | Promise<void>;
  workflowsExtensionsGeneratedPackagePath?: string;
  workflowsGeneratedPackagePath?: string;
  workflowsModelCatalog?: SvvyxWorkflowsModelCatalogReader;
  workflowsSourceRoot?: string;
  workflowsWorkspaceCwds?: () => readonly string[];
  extensionsBuildRoot?: string;
  extensionsCliProbe?: SvvyxExtensionsCliProbe;
  extensionEnvSecretStore?: ExtensionEnvSecretStore;
  extensionsEnvValues?: SvvyxRuntimeEnvValues;
  extensionsRoot?: string;
  agentSettingsStore?: AgentSettingsStore;
  approvalBoundary?: DirectToolApprovalBoundary;
  approvalMode?: ApprovalMode | (() => ApprovalMode);
  managedSandbox?: boolean | (() => boolean);
  networkAccess?: boolean | (() => boolean);
  onAppLog?: (event: AppLoggerEvent) => void;
};

type DirectToolSet = {
  codingTools: AgentTool<any>[];
};

export type DirectToolApprovalBoundary = RuntimeApprovalBoundary;

export function createSvvyDirectTools(options: DirectToolOptions): DirectToolSet {
  return {
    codingTools: [
      createExecCommandTool(options),
      createWriteStdinTool(),
      createApplyPatchTool(options),
    ],
  };
}

function createWriteStdinTool(): AgentTool<any> {
  return {
    name: "write_stdin",
    label: "write_stdin",
    description:
      "Write text to a running exec_command session. This is only valid for command sessions that returned a session_id.",
    parameters: Type.Object(
      {
        session_id: Type.String({ minLength: 1, description: "Running exec_command session id." }),
        input: Type.String({ description: "Text to write to the process stdin." }),
      },
      { additionalProperties: false },
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
          details: {
            sessionId: params.session_id,
            exitCode: session.exitCode,
            exitSignal: session.exitSignal,
          },
        };
      }
      session.process.stdin.write(params.input);
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
        details: { sessionId: params.session_id },
      };
    },
  };
}

function createApplyPatchTool(options: DirectToolOptions): AgentTool<any> {
  return {
    name: "apply_patch",
    label: "apply_patch",
    description:
      "Apply a unified patch to files in the current workspace. Use this for targeted source edits.",
    parameters: Type.Object(
      {
        patch: Type.String({ minLength: 1, description: "Patch text to apply." }),
      },
      { additionalProperties: false },
    ),
    async execute(toolCallId, input) {
      const params = input as { patch?: unknown };
      if (typeof params.patch !== "string" || params.patch.length === 0) {
        throw new Error("apply_patch requires patch.");
      }
      assertPatchDoesNotEditWorkflowsGeneratedOutput(params.patch, options);
      assertPatchRespectsManagedFilesystemPolicy(params.patch, options);
      await assertDirectToolApproved({
        options,
        patch: params.patch,
        toolCallId,
        toolName: "apply_patch",
      });
      const patchCommandInput = {
        cwd: options.cwd,
        fileSystemPolicy: directToolFileSystemPolicy(options),
        managedSandbox:
          resolveApprovalMode(options) !== "full-access" && resolveManagedSandbox(options),
        patch: params.patch,
      };
      let result = spawnPatchCommand(patchCommandInput);
      let resultManagedSandbox = patchCommandInput.managedSandbox;
      if (isEscalatableSandboxDeniedPatchResult(result, patchCommandInput.managedSandbox)) {
        await assertSandboxEscalationApproved({
          options,
          patch: params.patch,
          result,
          toolCallId,
          toolName: "apply_patch",
        });
        result = spawnPatchCommand({ ...patchCommandInput, managedSandbox: false });
        resultManagedSandbox = false;
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

function createExecCommandTool(options: DirectToolOptions): AgentTool<any> {
  return {
    name: "exec_command",
    label: "exec_command",
    description:
      "Execute a shell command in the current workspace. Returns stdout and stderr. Use this for command-family work such as svvyx, git, gh, cx, smithers, tests, and builds.",
    parameters: Type.Object(
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
      const activeCommand =
        options.runtime?.current && options.store
          ? findActiveExecCommand({
              store: options.store,
              sessionId: options.runtime.current.sessionId,
              turnId: options.runtime.current.turnId,
              toolCallId,
            })
          : null;
      const activeLiveProjection =
        activeCommand && options.store
          ? {
              store: options.store,
              sessionId: activeCommand.sessionId,
              commandId: activeCommand.id,
              managedSandbox:
                resolveApprovalMode(options) !== "full-access" && resolveManagedSandbox(options),
              outputEventBytes: { stderr: 0, stdout: 0 },
              outputEventRetainedStreams: new Set<"stderr" | "stdout">(),
            }
          : null;
      const svvyxSubprocess = prepareSvvyxSubprocess({
        activeCommand,
        command: params.cmd,
        commandCwd,
        options,
      });
      const execInput = {
        cwd: commandCwd,
        cmd: params.cmd,
        env: svvyxSubprocess?.env,
        fileSystemPolicy: svvyxSubprocess
          ? svvyxSubprocessFileSystemPolicy(options)
          : directToolFileSystemPolicy(options),
        managedSandbox:
          resolveApprovalMode(options) !== "full-access" && resolveManagedSandbox(options),
        networkAccess: resolveNetworkAccess(options),
        protectedWriteRoots: svvyxSubprocess ? [] : protectedDirectEditRoots(options),
        protectedWriteAllowedRoots: svvyxSubprocess ? [] : protectedDirectEditAllowedRoots(options),
        timeoutMs:
          typeof params.timeout === "number"
            ? Math.max(1, params.timeout) * 1000
            : DEFAULT_COMMAND_TIMEOUT_MS,
        signal,
        liveProjection: activeLiveProjection,
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
  env: NodeJS.ProcessEnv;
  replaySidecar: boolean;
  resultKey: string;
  resultPath: string;
  shimDir: string;
};

type SvvyxSubprocessAppAction = {
  kind: "artifact.open";
  artifactId: string;
  sessionId: string;
};

type SvvyxSubprocessSidecar = {
  agentSettingsState?: AgentSettingsState;
  appActions: SvvyxSubprocessAppAction[];
  appLogEvents: AppLoggerEvent[];
  commandFacts?: Record<string, unknown>;
  ok: boolean;
};

type SignedSvvyxSubprocessSidecar = {
  payload?: unknown;
  signature?: unknown;
};

function prepareSvvyxSubprocess(input: {
  activeCommand: Pick<StructuredCommandRecord, "id"> | null;
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
  const runtime = input.options.runtime?.current ?? null;
  let workspace: unknown = null;
  if (runtime && input.options.store) {
    try {
      workspace = input.options.store.getSessionState(runtime.sessionId).workspace;
    } catch {
      workspace = null;
    }
  }
  const context = {
    agentSettingsState: input.options.agentSettingsStore?.getState() ?? null,
    canRequestArtifactOpen: input.options.openArtifact !== undefined,
    cwd: input.commandCwd,
    databasePath: input.options.store?.databasePath ?? null,
    // This env-visible context is intentionally non-secret. Extension secret values are never
    // serialized here; svvyx subprocesses read secrets through the app-owned secret store only.
    extensionEnvValues: resolveExtensionsEnvValues(input.options),
    extensionsBuildRoot: input.options.extensionsBuildRoot,
    extensionsGeneratedPackagePath: input.options.workflowsExtensionsGeneratedPackagePath,
    extensionsRoot: input.options.extensionsRoot,
    externalInstructionSources: runtime?.externalInstructionSources ?? [],
    resultPath,
    runtime,
    sourceCommandId: input.activeCommand?.id ?? null,
    workflowModelCatalog: input.options.workflowsModelCatalog?.() ?? null,
    workflowsGeneratedPackagePath: input.options.workflowsGeneratedPackagePath,
    workflowsSourceRoot: input.options.workflowsSourceRoot,
    workflowsWorkspaceCwds: input.options.workflowsWorkspaceCwds?.() ?? null,
    workspace,
    workspaceCwd: input.options.cwd,
  };
  return {
    env: {
      PATH: `${shim.dir}:${process.env.PATH ?? ""}`,
      SVVY_SVVYX_SUBPROCESS_CONTEXT: JSON.stringify(context),
      SVVY_SVVYX_SUBPROCESS_RESULT_KEY: resultKey,
    },
    replaySidecar: invocation.replaySidecar,
    resultKey,
    resultPath,
    shimDir: shim.dir,
  };
}

type SvvyxShellInvocation =
  | { kind: "none" }
  | { kind: "trusted"; replaySidecar: boolean }
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
  return { kind: "trusted", replaySidecar: isTrustedSvvyxSidecarNamespace(words[index + 1]) };
}

function isTrustedSvvyxSidecarNamespace(namespace: string | undefined): boolean {
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
    if (!input.svvyxSubprocess.replaySidecar) {
      return input.result;
    }
    const sidecar = readSvvyxSubprocessResult(
      input.svvyxSubprocess.resultPath,
      input.svvyxSubprocess.resultKey,
    );
    replaySvvyxSubprocessAppLogEvents(input.options, sidecar.appLogEvents);
    await replaySvvyxSubprocessAppActions(input.options, sidecar.appActions);
    replaySvvyxSubprocessAgentSettings(input.options, sidecar.agentSettingsState);
    const retainedOutputArtifacts = Array.isArray(input.result.details.retainedOutputArtifacts)
      ? { retainedOutputArtifacts: input.result.details.retainedOutputArtifacts }
      : {};
    const commandFacts: Record<string, unknown> | undefined =
      sidecar.commandFacts || Object.keys(retainedOutputArtifacts).length > 0
        ? {
            ...sidecar.commandFacts,
            ...retainedOutputArtifacts,
          }
        : undefined;
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
    if (sidecar.ok === false) {
      const stderr =
        typeof input.result.details.stderr === "string" ? input.result.details.stderr : "";
      throw new Error(
        (stderr || stripCommandExitTrailer(readTextContent(input.result))).trim() ||
          "svvyx command failed.",
      );
    }
    const stdout =
      typeof input.result.details.stdout === "string"
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

function readSvvyxSubprocessResult(path: string, resultKey: string): SvvyxSubprocessSidecar {
  try {
    const signed = JSON.parse(readFileSync(path, "utf8")) as SignedSvvyxSubprocessSidecar;
    if (!isValidSvvyxSubprocessSignature(signed, resultKey)) {
      return { appActions: [], appLogEvents: [], ok: false };
    }
    const parsed = signed.payload;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { appActions: [], appLogEvents: [], ok: false };
    }
    const appActions = Array.isArray((parsed as { appActions?: unknown }).appActions)
      ? (parsed as { appActions: SvvyxSubprocessAppAction[] }).appActions
      : [];
    const appLogEvents = Array.isArray((parsed as { appLogEvents?: unknown }).appLogEvents)
      ? (parsed as { appLogEvents: AppLoggerEvent[] }).appLogEvents
      : [];
    const commandFacts = (parsed as { commandFacts?: unknown }).commandFacts;
    const agentSettingsState = (parsed as { agentSettingsState?: unknown }).agentSettingsState;
    return {
      appActions,
      appLogEvents,
      ...(agentSettingsState && typeof agentSettingsState === "object"
        ? { agentSettingsState: agentSettingsState as AgentSettingsState }
        : {}),
      ...(commandFacts && typeof commandFacts === "object" && !Array.isArray(commandFacts)
        ? { commandFacts: commandFacts as Record<string, unknown> }
        : {}),
      ok: (parsed as { ok?: unknown }).ok === true,
    };
  } catch {
    return { appActions: [], appLogEvents: [], ok: false };
  }
}

function isValidSvvyxSubprocessSignature(
  signed: SignedSvvyxSubprocessSidecar,
  resultKey: string,
): boolean {
  if (!signed || typeof signed !== "object") {
    return false;
  }
  if (typeof signed.signature !== "string") {
    return false;
  }
  const payloadJson = JSON.stringify(signed.payload);
  const expected = createHmac("sha256", resultKey).update(payloadJson).digest("base64url");
  const actualBuffer = Buffer.from(signed.signature);
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

async function replaySvvyxSubprocessAppActions(
  options: DirectToolOptions,
  actions: SvvyxSubprocessAppAction[],
): Promise<void> {
  for (const action of actions) {
    if (action.kind === "artifact.open") {
      const opened = await options.openArtifact?.({
        sessionId: action.sessionId,
        artifactId: action.artifactId,
      });
      if (!opened) {
        throw new Error(
          JSON.stringify({
            error: {
              code: "UI_UNAVAILABLE",
              message: "Artifact inspector UI is not attached to this command runtime.",
              id: action.artifactId,
            },
          }),
        );
      }
    }
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
  const current = store.getState();
  store.setExtensionEnv(nextState.extensionEnv);
  store.setRequestUserInput(nextState.requestUserInput);
  store.setAppPreferences(nextState.appPreferences);
  store.setAgentProfile(nextState.agents.special.threadHandler);
  for (const profile of nextState.agents.orchestrators) {
    store.setAgentProfile(profile);
  }
  for (const profile of current.agents.orchestrators) {
    if (!profile.locked && !nextState.agents.orchestrators.some((next) => next.id === profile.id)) {
      store.deleteAgentProfile(profile.id);
    }
  }
  store.reorderOrchestratorProfiles(nextState.agents.orchestrators.map((profile) => profile.id));
  for (const [key, settings] of Object.entries(nextState.workflowAgents)) {
    store.setWorkflowAgent(key, settings);
  }
  for (const key of Object.keys(current.workflowAgents)) {
    if (!Object.prototype.hasOwnProperty.call(nextState.workflowAgents, key)) {
      store.deleteWorkflowAgent(key);
    }
  }
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

function assertPatchRespectsManagedFilesystemPolicy(
  patch: string,
  options: WorkflowsGeneratedProtectionOptions,
): void {
  const policy = directToolFileSystemPolicy(options);
  for (const path of readPatchTouchedPaths(patch)) {
    if (!canWriteFileSystemPath(policy, path, options.cwd)) {
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
  const approval = await input.options.approvalBoundary({
    approvalMode,
    command: input.command,
    commandFamily: input.commandFamily,
    cwd: input.commandCwd ?? input.options.cwd,
    patch: input.patch,
    toolCallId: input.toolCallId,
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
  const approval = await input.options.approvalBoundary({
    approvalMode,
    command: input.command,
    context: {
      reason: "sandbox_denial_escalation",
      sandboxDenied: true,
      result: sandboxEscalationResultContext(input.result),
    },
    cwd: input.commandCwd ?? input.options.cwd,
    patch: input.patch,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
  });
  if (approval.approved === false) {
    throw new Error(approval.reason?.trim() || "Unsandboxed retry was not approved.");
  }
}

function sandboxEscalationResultContext(
  result:
    | ReturnType<typeof spawnSync>
    | { content: { type: "text"; text: string }[]; details: Record<string, unknown> },
): Record<string, unknown> {
  if ("details" in result) {
    return {
      exitCode: result.details.exitCode,
      exitSignal: result.details.exitSignal,
      stderr: result.details.stderr,
      stdout: result.details.stdout,
    };
  }
  return {
    exitCode: result.status,
    exitSignal: result.signal,
    stderr: typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? ""),
    stdout: typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? ""),
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
    ".smithers/node_modules/@svvy/extensions",
    ".smithers/node_modules/@svvy/workflows",
  ].filter((needle) => needle.length > 0 && needle !== ".");
}

type WorkflowsGeneratedProtectionOptions = Pick<
  DirectToolOptions,
  | "approvalMode"
  | "cwd"
  | "extensionsRoot"
  | "runtime"
  | "store"
  | "workflowsExtensionsGeneratedPackagePath"
  | "workflowsGeneratedPackagePath"
  | "workflowsSourceRoot"
>;

function directToolFileSystemPolicy(
  options: WorkflowsGeneratedProtectionOptions,
): FileSystemSandboxPolicy {
  if (resolveApprovalMode(options) === "full-access") {
    return unrestrictedFileSystemPolicy();
  }
  const directEditPolicy = protectedDirectEditPolicy(options);
  const extensionsRoot = resolvePath(options.extensionsRoot ?? defaultExtensionsRoot());
  return buildManagedWorkspaceWriteFileSystemPolicy({
    cwd: options.cwd,
    writableRoots: [
      ...(options.workflowsSourceRoot ? [resolvePath(options.workflowsSourceRoot)] : []),
      resolvePath(extensionsRoot, "sources"),
      resolvePath(extensionsRoot, "package"),
      ...directEditPolicy.allowedRoots,
    ],
    readOnlyRoots: [...directEditPolicy.protectedRoots, ...directEditPolicy.alwaysProtectedRoots],
    includeSlashTmp: true,
    tmpdir: process.env.TMPDIR ?? null,
  });
}

function svvyxSubprocessFileSystemPolicy(
  options: WorkflowsGeneratedProtectionOptions,
): FileSystemSandboxPolicy {
  if (resolveApprovalMode(options) === "full-access") {
    return unrestrictedFileSystemPolicy();
  }
  const extensionsRoot = resolvePath(options.extensionsRoot ?? defaultExtensionsRoot());
  const artifactPolicy = protectedArtifactDirectEditPolicy(options);
  return buildManagedWorkspaceWriteFileSystemPolicy({
    cwd: options.cwd,
    writableRoots: [
      ...(options.workflowsSourceRoot ? [resolvePath(options.workflowsSourceRoot)] : []),
      resolvePath(options.workflowsGeneratedPackagePath ?? getWorkflowsGeneratedPackagePath()),
      effectiveExtensionsGeneratedPackagePath({
        extensionsGeneratedPackagePath: options.workflowsExtensionsGeneratedPackagePath,
        generatedPackagePath: options.workflowsGeneratedPackagePath,
      }),
      extensionsRoot,
      ...artifactPolicy.allowedRoots,
    ],
    includeSlashTmp: true,
    tmpdir: process.env.TMPDIR ?? null,
  });
}

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
  if (!runtime || !options.store) {
    return { protectedRoots: [], alwaysProtectedRoots: [], allowedRoots: [] };
  }
  let artifactDir: string;
  try {
    artifactDir = options.store.getSessionState(runtime.sessionId).workspace.artifactDir;
  } catch {
    return { protectedRoots: [], alwaysProtectedRoots: [], allowedRoots: [] };
  }
  const artifactRoot = resolvePath(artifactDir);
  const sessionArtifactRoot = resolvePath(artifactRoot, runtime.sessionId);
  return {
    protectedRoots: [artifactRoot],
    alwaysProtectedRoots: [resolvePath(sessionArtifactRoot, "immutable")],
    allowedRoots: [sessionArtifactRoot],
  };
}

function protectedWorkflowsGeneratedRoots(options: WorkflowsGeneratedProtectionOptions): string[] {
  const workflowsPackagePath = resolvePath(
    options.workflowsGeneratedPackagePath ?? getWorkflowsGeneratedPackagePath(),
  );
  const extensionsPackagePath = resolvePath(
    effectiveExtensionsGeneratedPackagePath({
      extensionsGeneratedPackagePath: options.workflowsExtensionsGeneratedPackagePath,
      generatedPackagePath: options.workflowsGeneratedPackagePath
        ? workflowsPackagePath
        : undefined,
    }),
  );
  return [
    workflowsPackagePath,
    extensionsPackagePath,
    resolvePath(options.cwd, ".smithers", "node_modules", "@svvy", "extensions"),
    resolvePath(options.cwd, ".smithers", "node_modules", "@svvy", "workflows"),
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
  fileSystemPolicy: FileSystemSandboxPolicy;
  managedSandbox: boolean;
  networkAccess: boolean;
  protectedWriteRoots: readonly string[];
  protectedWriteAllowedRoots: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
  liveProjection?: LiveCommandProjection | null;
}): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }> {
  const protectedWriteSnapshot = captureProtectedWriteSnapshot(
    input.protectedWriteRoots,
    input.protectedWriteAllowedRoots,
  );
  const child = spawnShellCommand({
    cwd: input.cwd,
    cmd: input.cmd,
    env: input.env,
    fileSystemPolicy: input.fileSystemPolicy,
    managedSandbox: input.managedSandbox,
    networkAccess: input.networkAccess,
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
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    session.stdout.push(text);
    recordLiveCommandOutput(input.liveProjection, "stdout", text);
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    session.stderr.push(text);
    recordLiveCommandOutput(input.liveProjection, "stderr", text);
  });
  child.on("exit", (code, signal) => {
    session.exitCode = code;
    session.exitSignal = signal;
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
    recordRetainedCommandOutputEvent(liveProjection, stream, nextBytes);
    liveProjection.outputEventBytes[stream] = nextBytes;
    return;
  }
  const eventText =
    nextBytes > RETAINED_COMMAND_OUTPUT_ARTIFACT_THRESHOLD_BYTES
      ? truncateUtf8(text, remainingEventBytes)
      : text;
  if (eventText.length > 0) {
    liveProjection.store.recordLifecycleEvent({
      sessionId: liveProjection.sessionId,
      kind: "command.output",
      subjectKind: "command",
      subjectId: liveProjection.commandId,
      data: {
        stream,
        source: "live-stream",
        text: eventText,
      },
    });
  }
  liveProjection.outputEventBytes[stream] = nextBytes;
  if (nextBytes > RETAINED_COMMAND_OUTPUT_ARTIFACT_THRESHOLD_BYTES) {
    recordRetainedCommandOutputEvent(liveProjection, stream, nextBytes);
  }
}

function recordRetainedCommandOutputEvent(
  liveProjection: LiveCommandProjection,
  stream: "stdout" | "stderr",
  bytes: number,
): void {
  if (liveProjection.outputEventRetainedStreams.has(stream)) {
    return;
  }
  liveProjection.outputEventRetainedStreams.add(stream);
  liveProjection.store.recordLifecycleEvent({
    sessionId: liveProjection.sessionId,
    kind: "command.output",
    subjectKind: "command",
    subjectId: liveProjection.commandId,
    data: {
      stream,
      source: "retained-log-artifact",
      text: RETAINED_COMMAND_OUTPUT_EVENT_MESSAGE,
      bytes,
    },
  });
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
    const artifact = liveProjection.store.createArtifact({
      sessionId: liveProjection.sessionId,
      sourceCommandId: liveProjection.commandId,
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
  artifact: StructuredArtifactRecord,
): RetainedCommandOutputArtifact {
  return {
    artifactId: artifact.id,
    bytes: artifact.bytes,
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
  liveProjection.store.finishCommand({
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
  });
}

function sandboxDenialFacts(input: {
  exitCode: number | null;
  managedSandbox: boolean;
  stderr: string;
  stdout: string;
}): Record<string, unknown> {
  if (!isSandboxDenialOutput(input)) {
    return {};
  }
  return {
    sandboxDenied: true,
    sandboxEngine: "macos-seatbelt",
  };
}

function isSandboxDenialOutput(input: {
  exitCode: number | null;
  managedSandbox: boolean;
  stderr: string;
  stdout: string;
}): boolean {
  if (!input.managedSandbox || input.exitCode === 0 || input.exitCode === 127) {
    return false;
  }
  const combined = `${input.stdout}\n${input.stderr}`;
  const normalized = combined.toLowerCase();
  if (!hasSandboxHelperOriginMarker(combined)) {
    return false;
  }
  if (/\b(command not found|parse error|syntax error)\b/.test(normalized)) {
    return false;
  }
  return (
    normalized.includes("sandbox-exec: sandbox_apply:") ||
    normalized.includes("operation not permitted") ||
    normalized.includes("permission denied") ||
    normalized.includes("read-only file system") ||
    normalized.includes("failed to write file") ||
    normalized.includes("deny(")
  );
}

function isSandboxHelperBootstrapFailure(output: string): boolean {
  return output.toLowerCase().includes("sandbox-exec: sandbox_apply:");
}

function hasSandboxHelperOriginMarker(output: string): boolean {
  return output.includes("sandbox-exec:") || /^Sandbox:/m.test(output);
}

function spawnShellCommand(input: {
  cwd: string;
  cmd: string;
  env?: NodeJS.ProcessEnv;
  fileSystemPolicy: FileSystemSandboxPolicy;
  managedSandbox: boolean;
  networkAccess: boolean;
}): ChildProcessWithoutNullStreams {
  const shell = getShell();
  const env = { ...process.env, ...input.env };
  if (!input.managedSandbox) {
    return spawn(shell, ["-lc", input.cmd], {
      cwd: input.cwd,
      env,
    });
  }
  return spawn(
    resolveSandboxHelperPath(),
    buildSandboxHelperArgs({
      command: [shell, "-lc", input.cmd],
      cwd: input.cwd,
      fileSystemPolicy: input.fileSystemPolicy,
      networkAccess: input.networkAccess,
    }),
    {
      cwd: input.cwd,
      env,
    },
  );
}

function spawnPatchCommand(input: {
  cwd: string;
  fileSystemPolicy: FileSystemSandboxPolicy;
  managedSandbox: boolean;
  patch: string;
}): ReturnType<typeof spawnSync> {
  const command = ["patch", "-p0", "--forward"] as const;
  if (!input.managedSandbox) {
    return spawnSync("patch", command.slice(1), {
      cwd: input.cwd,
      input: input.patch,
      encoding: "utf8",
    });
  }
  return spawnSync(
    resolveSandboxHelperPath(),
    buildSandboxHelperArgs({
      command,
      cwd: input.cwd,
      fileSystemPolicy: input.fileSystemPolicy,
      networkAccess: false,
    }),
    {
      cwd: input.cwd,
      input: input.patch,
      encoding: "utf8",
    },
  );
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
  if (typeof options.networkAccess === "function") {
    return options.networkAccess() !== false;
  }
  return options.networkAccess !== false;
}

function resolveManagedSandbox(options: DirectToolOptions): boolean {
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

function findActiveExecCommand(input: {
  store: StructuredSessionStateStore;
  sessionId: string;
  turnId: string;
  toolCallId: string;
}): StructuredCommandRecord | null {
  const snapshot = input.store.getSessionState(input.sessionId);
  return (
    snapshot.commands
      .filter(
        (command) =>
          command.turnId === input.turnId &&
          command.toolName === "exec_command" &&
          command.status === "running" &&
          command.facts?.toolCallId === input.toolCallId,
      )
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  );
}
