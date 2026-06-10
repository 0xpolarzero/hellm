import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  existsSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve as resolvePath } from "node:path";
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
import {
  createMacOsKeychainExtensionEnvSecretStore,
  type ExtensionEnvSecretStore,
} from "./extension-env-secret-store";
import { getWorkflowsGeneratedPackagePath } from "./smithers-runtime/workflow-library";
import { effectiveExtensionsGeneratedPackagePath } from "./generated-extensions-package";
import type {
  StructuredArtifactRecord,
  StructuredCommandRecord,
  StructuredSessionStateStore,
} from "./structured-session-state";
import {
  formatSvvyxArtifactsError,
  isSvvyxArtifactsCommand,
  runSvvyxArtifactsCommand,
  type SvvyxArtifactOpenHandler,
} from "./svvyx-artifacts-command";
import {
  formatSvvyxExtensionsError,
  isSvvyxExtensionsCommand,
  runSvvyxExtensionsCommand,
  type SvvyxExtensionsCliProbe,
} from "./svvyx-extensions-command";
import {
  formatSvvyxRuntimeError,
  isSvvyxRuntimeCommand,
  runSvvyxRuntimeCommand,
  type SvvyxRuntimeEnvValues,
} from "./svvyx-runtime-command";
import {
  formatSvvyxWorkflowsError,
  isSvvyxWorkflowsCommand,
  runSvvyxWorkflowsCommand,
  type SvvyxWorkflowsModelCatalogReader,
} from "./svvyx-workflows-command";
import type { ApprovalMode } from "../shared/agent-settings";

type RunningCommandSession = {
  process: ChildProcessWithoutNullStreams;
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  protectedWriteSnapshot: ProtectedWriteSnapshot;
  liveProjection: LiveCommandProjection | null;
};

type LiveCommandProjection = {
  store: StructuredSessionStateStore;
  sessionId: string;
  commandId: string;
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
  fingerprint: string;
  allowedRoots: string[];
};

type ProtectedWriteRootSnapshot = {
  root: string;
  existed: boolean;
  entries: ProtectedWriteEntry[];
  allowedRoots: string[];
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
const NETWORK_DISABLED_SANDBOX_PROFILE = ["(version 1)", "(allow default)", "(deny network*)"].join(
  "\n",
);
const WORKFLOWS_GENERATED_DIRECT_EDIT_MESSAGE =
  "Generated Workflows output, workspace @svvy/workflows/@svvy/extensions package links, internal Extension files, and immutable or non-active-session Artifacts are read-only. Edit Workflows source, Extension source/manifest/package.json, or the active session's mutable artifact files through the intended command path instead.";
const MANAGED_FILESYSTEM_DENIED_WRITE_MESSAGE =
  "Managed filesystem policy allows writes only inside the workspace, configured writable roots, active mutable artifacts, and explicit app-owned source roots.";

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
  networkAccess?: boolean | (() => boolean);
  onAppLog?: (event: AppLoggerEvent) => void;
};

type DirectToolSet = {
  codingTools: AgentTool<any>[];
};

export type DirectToolApprovalBoundary = RuntimeApprovalBoundary;

type DirectToolCommandFamily =
  | "svvyx_artifacts"
  | "svvyx_extensions"
  | "svvyx_runtime"
  | "svvyx_workflows";

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
      const result = spawnSync("patch", ["-p0", "--forward"], {
        cwd: options.cwd,
        input: params.patch,
        encoding: "utf8",
      });
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      if (result.status !== 0) {
        const message = output || `apply_patch failed with exit code ${result.status ?? "null"}.`;
        throw new Error(
          JSON.stringify({
            error: {
              code: "apply_patch_failed",
              message,
            },
            commandFacts: parseApplyPatchCommandFacts(params.patch, [message]),
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
        commandFamily: directToolCommandFamily(params.cmd),
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
              outputEventBytes: { stderr: 0, stdout: 0 },
              outputEventRetainedStreams: new Set<"stderr" | "stdout">(),
            }
          : null;
      if (isSvvyxArtifactsCommand(params.cmd)) {
        const runtime = options.runtime?.current;
        if (!runtime || !options.store) {
          throw new Error(
            JSON.stringify(
              formatSvvyxArtifactsError(
                new Error("Artifacts commands can only run during an active prompt."),
              ),
            ),
          );
        }
        const sourceCommand = activeCommand;
        if (!sourceCommand) {
          throw new Error(
            JSON.stringify(
              formatSvvyxArtifactsError(
                new Error("Artifacts command is missing its source command record."),
              ),
            ),
          );
        }
        recordSvvyxCommandProgress(activeLiveProjection, {
          command: params.cmd,
          family: "artifacts",
          phase: "started",
        });
        try {
          const result = await runSvvyxArtifactsCommand({
            cwd: commandCwd,
            command: params.cmd,
            runtime,
            store: options.store,
            sourceCommand,
            openArtifact: options.openArtifact,
            onAppLog: options.onAppLog,
          });
          recordSvvyxCommandProgress(activeLiveProjection, {
            command: params.cmd,
            family: "artifacts",
            phase: "succeeded",
            facts: result.commandFacts,
          });
          const retainedOutputArtifacts = recordSvvyxCommandOutput(
            activeLiveProjection,
            result.output,
            "stdout",
          );
          const commandFacts = commandFactsWithRetainedOutputArtifacts(
            result.commandFacts,
            retainedOutputArtifacts,
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result.output, null, 2) }],
            details: {
              ...(isRecord(result.output) ? result.output : { result: result.output }),
              commandFacts,
            },
          };
        } catch (error) {
          const output = formatSvvyxArtifactsError(error);
          recordSvvyxCommandProgress(activeLiveProjection, {
            command: params.cmd,
            family: "artifacts",
            phase: "failed",
            facts: isRecord(output) ? output : null,
          });
          const retainedOutputArtifacts = recordSvvyxCommandOutput(
            activeLiveProjection,
            output,
            "stderr",
          );
          throw new Error(
            JSON.stringify({
              ...output,
              ...(retainedOutputArtifacts.length > 0 ? { retainedOutputArtifacts } : {}),
            }),
            {
              cause: error,
            },
          );
        }
      }
      if (isSvvyxWorkflowsCommand(params.cmd)) {
        const workflowRuntime = options.runtime?.current;
        const workflowSourceCommand = workflowRuntime ? activeCommand : null;
        recordSvvyxCommandProgress(activeLiveProjection, {
          command: params.cmd,
          family: "workflows",
          phase: "started",
        });
        try {
          const result = await runSvvyxWorkflowsCommand({
            agentSettingsStore: options.agentSettingsStore,
            command: params.cmd,
            cwd: commandCwd,
            envSecretStore: resolveExtensionEnvSecretStore(options),
            extensionsBuildRoot: options.extensionsBuildRoot,
            extensionsCliProbe: options.extensionsCliProbe,
            extensionsRoot: options.extensionsRoot,
            extensionsGeneratedPackagePath: options.workflowsExtensionsGeneratedPackagePath,
            generatedPackagePath: options.workflowsGeneratedPackagePath,
            readModelCatalog: options.workflowsModelCatalog,
            sourceRoot: options.workflowsSourceRoot,
            workspaceCwd: options.cwd,
            workspaceCwds: options.workflowsWorkspaceCwds?.(),
          });
          if (result.commandFacts.workflowBuildOk === true) {
            options.onAppLog?.({
              level: "info",
              source: "workflow.library",
              message: "Workflows build validation passed.",
              details: workflowLogDetails(params.cmd, workflowRuntime, workflowSourceCommand?.id, {
                ...pickWorkflowLogFacts(result.commandFacts),
              }),
            });
            await options.onWorkflowsGeneratedPackageChanged?.({
              reason:
                typeof result.commandFacts.workflowSavedExportName === "string"
                  ? "svvyx-workflows-save"
                  : "svvyx-workflows-build",
              commandFacts: result.commandFacts,
            });
          }
          recordSvvyxCommandProgress(activeLiveProjection, {
            command: params.cmd,
            family: "workflows",
            phase: "succeeded",
            facts: result.commandFacts,
          });
          const retainedOutputArtifacts = recordSvvyxCommandOutput(
            activeLiveProjection,
            result.output,
            "stdout",
          );
          const commandFacts = commandFactsWithRetainedOutputArtifacts(
            result.commandFacts,
            retainedOutputArtifacts,
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result.output, null, 2) }],
            details: {
              ...(isRecord(result.output) ? result.output : { result: result.output }),
              commandFacts,
            },
          };
        } catch (error) {
          const output = formatSvvyxWorkflowsError(error);
          const commandFacts = workflowErrorCommandFacts(params.cmd, output);
          options.onAppLog?.({
            level: "warning",
            source: "workflow.library",
            message: "Workflows build validation failed.",
            details: workflowLogDetails(params.cmd, workflowRuntime, workflowSourceCommand?.id, {
              errorCode: output.error.code,
              errorMessage: output.error.message,
              ...(output.error.diagnostics
                ? { workflowDiagnosticCount: output.error.diagnostics.length }
                : {}),
            }),
          });
          recordSvvyxCommandProgress(activeLiveProjection, {
            command: params.cmd,
            family: "workflows",
            phase: "failed",
            facts: commandFacts,
          });
          const retainedOutputArtifacts = recordSvvyxCommandOutput(
            activeLiveProjection,
            { ...output, commandFacts },
            "stderr",
          );
          const retainedCommandFacts = commandFactsWithRetainedOutputArtifacts(
            commandFacts,
            retainedOutputArtifacts,
          );
          throw new Error(JSON.stringify({ ...output, commandFacts: retainedCommandFacts }), {
            cause: error,
          });
        }
      }
      if (isSvvyxExtensionsCommand(params.cmd)) {
        recordSvvyxCommandProgress(activeLiveProjection, {
          command: params.cmd,
          family: "extensions",
          phase: "started",
        });
        try {
          const result = await runSvvyxExtensionsCommand({
            agentSettingsStore: options.agentSettingsStore,
            buildRoot: options.extensionsBuildRoot,
            cliProbe: options.extensionsCliProbe,
            command: params.cmd,
            cwd: commandCwd,
            envSecretStore: resolveExtensionEnvSecretStore(options),
            externalInstructionSources: options.runtime?.current?.externalInstructionSources ?? [],
            extensionsRoot: options.extensionsRoot,
            structuredSessionStore: options.store,
          });
          recordSvvyxCommandProgress(activeLiveProjection, {
            command: params.cmd,
            family: "extensions",
            phase: "succeeded",
            facts: result.commandFacts,
          });
          const retainedOutputArtifacts = recordSvvyxCommandOutput(
            activeLiveProjection,
            result.output,
            "stdout",
          );
          const commandFacts = commandFactsWithRetainedOutputArtifacts(
            result.commandFacts,
            retainedOutputArtifacts,
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result.output, null, 2) }],
            details: {
              ...(isRecord(result.output) ? result.output : { result: result.output }),
              commandFacts,
            },
          };
        } catch (error) {
          const output = formatSvvyxExtensionsError(error);
          recordSvvyxCommandProgress(activeLiveProjection, {
            command: params.cmd,
            family: "extensions",
            phase: "failed",
            facts: isRecord(output) ? output : null,
          });
          const retainedOutputArtifacts = recordSvvyxCommandOutput(
            activeLiveProjection,
            output,
            "stderr",
          );
          return {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
            details: {
              ...output,
              ...(retainedOutputArtifacts.length > 0 ? { retainedOutputArtifacts } : {}),
            },
          };
        }
      }
      if (isSvvyxRuntimeCommand(params.cmd)) {
        recordSvvyxCommandProgress(activeLiveProjection, {
          command: params.cmd,
          family: "runtime",
          phase: "started",
        });
        try {
          const result = await runSvvyxRuntimeCommand({
            command: params.cmd,
            envSecretStore: resolveExtensionEnvSecretStore(options),
            envValues: resolveExtensionsEnvValues(options),
            extensionsRoot: options.extensionsRoot,
          });
          recordSvvyxCommandProgress(activeLiveProjection, {
            command: params.cmd,
            family: "runtime",
            phase:
              result.output && isRecord(result.output) && result.output.ok === false
                ? "failed"
                : "succeeded",
            facts: result.commandFacts,
          });
          const retainedOutputArtifacts = recordSvvyxCommandOutput(
            activeLiveProjection,
            result.output,
            result.output && isRecord(result.output) && result.output.ok === false
              ? "stderr"
              : "stdout",
          );
          const commandFacts = commandFactsWithRetainedOutputArtifacts(
            result.commandFacts,
            retainedOutputArtifacts,
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result.output, null, 2) }],
            details: {
              ...(isRecord(result.output) ? result.output : { result: result.output }),
              commandFacts,
            },
          };
        } catch (error) {
          const output = formatSvvyxRuntimeError(error);
          recordSvvyxCommandProgress(activeLiveProjection, {
            command: params.cmd,
            family: "runtime",
            phase: "failed",
            facts: isRecord(output) ? output : null,
          });
          const retainedOutputArtifacts = recordSvvyxCommandOutput(
            activeLiveProjection,
            output,
            "stderr",
          );
          return {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
            details: {
              ...output,
              ...(retainedOutputArtifacts.length > 0 ? { retainedOutputArtifacts } : {}),
            },
          };
        }
      }
      return await runExecCommand({
        cwd: commandCwd,
        cmd: params.cmd,
        networkAccess: resolveNetworkAccess(options),
        protectedWriteRoots: protectedDirectEditRoots(options),
        protectedWriteAllowedRoots: protectedDirectEditAllowedRoots(options),
        timeoutMs:
          typeof params.timeout === "number"
            ? Math.max(1, params.timeout) * 1000
            : DEFAULT_COMMAND_TIMEOUT_MS,
        signal,
        liveProjection: activeLiveProjection,
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

function resolveExtensionEnvSecretStore(options: DirectToolOptions): ExtensionEnvSecretStore {
  return options.extensionEnvSecretStore ?? createMacOsKeychainExtensionEnvSecretStore();
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

function pickWorkflowLogFacts(facts: Record<string, unknown>): Record<string, unknown> {
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

function workflowLogDetails(
  command: string,
  runtime: NonNullable<PromptExecutionRuntimeHandle["current"]> | null | undefined,
  commandId: string | undefined,
  facts: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(runtime
      ? {
          workspaceSessionId: runtime.sessionId,
          surfacePiSessionId: runtime.surfacePiSessionId,
          ...(runtime.surfaceThreadId ? { threadId: runtime.surfaceThreadId } : {}),
        }
      : {}),
    ...(commandId ? { commandId } : {}),
    command,
    ...facts,
  };
}

function workflowErrorCommandFacts(
  command: string,
  output: ReturnType<typeof formatSvvyxWorkflowsError>,
): Record<string, unknown> {
  const words = splitCommandPreview(command);
  const workflowCommand = words[2];
  return {
    svvyxDispatch: true,
    extensionId: "workflows",
    extensionArgv: words.slice(2),
    ...(workflowCommand ? { workflowCommand } : {}),
    workflowBuildOk: false,
    errorCode: output.error.code,
    ...(output.error.diagnostics
      ? { workflowDiagnosticCount: output.error.diagnostics.length }
      : {}),
  };
}

function splitCommandPreview(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

async function assertDirectToolApproved(input: {
  command?: string;
  commandCwd?: string;
  commandFamily?: DirectToolCommandFamily;
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

function directToolCommandFamily(command: string): DirectToolCommandFamily | undefined {
  if (isSvvyxArtifactsCommand(command)) {
    return "svvyx_artifacts";
  }
  if (isSvvyxExtensionsCommand(command)) {
    return "svvyx_extensions";
  }
  if (isSvvyxWorkflowsCommand(command)) {
    return "svvyx_workflows";
  }
  if (isSvvyxRuntimeCommand(command)) {
    return "svvyx_runtime";
  }
  return undefined;
}

function assertCommandDoesNotEditWorkflowsGeneratedOutput(input: {
  command: string;
  commandCwd: string;
  options: WorkflowsGeneratedProtectionOptions;
}): void {
  if (isSvvyxWorkflowsCommand(input.command) || isSvvyxExtensionsCommand(input.command)) {
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
    resolvePath(extensionsRoot, "sources", "builtin-overlays"),
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
    networkAccess: input.networkAccess,
  });
  const session: RunningCommandSession = {
    process: child,
    stdout: [],
    stderr: [],
    exitCode: null,
    exitSignal: null,
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

function recordSvvyxCommandOutput(
  liveProjection: LiveCommandProjection | null,
  output: unknown,
  stream: "stdout" | "stderr",
): RetainedCommandOutputArtifact[] {
  const text = JSON.stringify(output, null, 2);
  recordLiveCommandOutput(liveProjection, stream, text);
  return retainCommandOutputArtifacts(liveProjection, { [stream]: text });
}

function commandFactsWithRetainedOutputArtifacts(
  commandFacts: Record<string, unknown>,
  retainedOutputArtifacts: RetainedCommandOutputArtifact[],
): Record<string, unknown> {
  return retainedOutputArtifacts.length > 0
    ? { ...commandFacts, retainedOutputArtifacts }
    : commandFacts;
}

function recordSvvyxCommandProgress(
  liveProjection: LiveCommandProjection | null,
  input: {
    command: string;
    facts?: Record<string, unknown> | null;
    family: "artifacts" | "extensions" | "runtime" | "workflows";
    phase: "started" | "succeeded" | "failed";
  },
): void {
  if (!liveProjection) {
    return;
  }
  liveProjection.store.recordLifecycleEvent({
    sessionId: liveProjection.sessionId,
    kind: "command.progress",
    subjectKind: "command",
    subjectId: liveProjection.commandId,
    data: {
      command: input.command,
      family: input.family,
      phase: input.phase,
      source: "svvyx-dispatch",
      ...(input.facts ? { facts: input.facts } : {}),
    },
  });
}

function finishLiveCommandProjection(
  liveProjection: LiveCommandProjection | null,
  result: {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    exitSignal: NodeJS.Signals | null;
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

function spawnShellCommand(input: {
  cwd: string;
  cmd: string;
  networkAccess: boolean;
}): ChildProcessWithoutNullStreams {
  const shell = getShell();
  if (input.networkAccess) {
    return spawn(shell, ["-lc", input.cmd], {
      cwd: input.cwd,
      env: process.env,
    });
  }
  if (!existsSync("/usr/bin/sandbox-exec")) {
    throw new Error("networkAccess=false requires /usr/bin/sandbox-exec to restrict networking.");
  }
  return spawn(
    "/usr/bin/sandbox-exec",
    ["-p", NETWORK_DISABLED_SANDBOX_PROFILE, shell, "-lc", input.cmd],
    {
      cwd: input.cwd,
      env: process.env,
    },
  );
}

function resolveNetworkAccess(options: DirectToolOptions): boolean {
  if (typeof options.networkAccess === "function") {
    return options.networkAccess() !== false;
  }
  return options.networkAccess !== false;
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
    fingerprint: fingerprintProtectedWriteRootSnapshots(rootSnapshots),
    allowedRoots: normalizedAllowedRoots,
  };
}

function assertProtectedWriteSnapshotUnchanged(snapshot: ProtectedWriteSnapshot): void {
  const current = captureProtectedWriteSnapshot(
    snapshot.roots.map((root) => root.root),
    snapshot.allowedRoots,
  );
  if (current.fingerprint === snapshot.fingerprint) {
    return;
  }
  restoreProtectedWriteSnapshot(snapshot);
  throw new Error(WORKFLOWS_GENERATED_DIRECT_EDIT_MESSAGE);
}

function captureProtectedWriteRootSnapshot(
  root: string,
  allowedRoots: readonly string[],
): ProtectedWriteRootSnapshot {
  const rootAllowedRoots = allowedRoots.filter((allowedRoot) => isPathInside(root, allowedRoot));
  const entries: ProtectedWriteEntry[] = [];
  captureProtectedWriteEntry(root, root, rootAllowedRoots, entries);
  return {
    root,
    existed: entries.length > 0,
    entries: entries.toSorted((left, right) => left.path.localeCompare(right.path)),
    allowedRoots: rootAllowedRoots,
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

function fingerprintProtectedWriteRootSnapshots(roots: readonly ProtectedWriteRootSnapshot[]) {
  return JSON.stringify(
    roots.map((root) => ({
      root: root.root,
      existed: root.existed,
      entries: root.entries.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        data: entry.data?.toString("base64"),
        linkTarget: entry.linkTarget,
      })),
    })),
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
