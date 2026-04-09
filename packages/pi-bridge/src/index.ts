import {
  createEpisode,
  type Episode,
  type ThreadRef,
} from "@hellm/session-model";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type PiRuntimeTransitionReason = "new" | "resume" | "fork" | "import";

export interface PiWorkerScopedContext {
  sessionHistory: string[];
  relevantPaths: string[];
  agentsInstructions: string[];
  relevantSkills: string[];
  priorEpisodeIds: string[];
}

export interface PiWorkerToolScope {
  allow: string[];
  deny?: string[];
  writeRoots?: string[];
  readOnly?: boolean;
}

export interface PiWorkerCompletionCondition {
  type: "episode-produced" | "verification-only" | "needs-input";
  maxTurns?: number;
}

export interface PiRuntimeTransition {
  reason: PiRuntimeTransitionReason;
  toSessionId: string;
  aligned: boolean;
  fromSessionId?: string;
  fromWorktreePath?: string;
  toWorktreePath?: string;
}

export interface PiWorkerRequest {
  path: "pi-worker";
  thread: ThreadRef;
  objective: string;
  cwd: string;
  inputEpisodeIds: string[];
  scopedContext: PiWorkerScopedContext;
  toolScope: PiWorkerToolScope;
  completion: PiWorkerCompletionCondition;
  runtimeTransition?: PiRuntimeTransition;
}

export type PiWorkerRunStatus = "completed" | "blocked" | "waiting_input" | "failed";

export interface PiWorkerResult {
  status: PiWorkerRunStatus;
  episode: Episode;
  runtimeTransition?: PiRuntimeTransition;
  outputSummary?: string;
}

export interface PiRuntimeBridge {
  readonly connected: boolean;
  readonly runtime: "pi";
  runWorker(request: PiWorkerRequest): Promise<PiWorkerResult>;
  switchRuntime(transition: PiRuntimeTransition): Promise<PiRuntimeTransition>;
}

export function createPiWorkerRequest(input: PiWorkerRequest): PiWorkerRequest {
  return {
    ...input,
    path: "pi-worker",
  };
}

export function normalizePiWorkerResult(result: PiWorkerResult): Episode {
  return result.episode;
}

type PiSdkWorkerStatus = "completed" | "blocked" | "waiting_input" | "failed";

interface PiSdkWorkerExecution {
  status?: PiSdkWorkerStatus;
  outputSummary?: string;
  conclusions?: string[];
  unresolvedIssues?: string[];
}

interface PiSdkWorkerRuntime {
  runWorker?: (request: PiWorkerRequest) => Promise<PiSdkWorkerExecution | string> | PiSdkWorkerExecution | string;
  executeWorker?: (request: PiWorkerRequest) => Promise<PiSdkWorkerExecution | string> | PiSdkWorkerExecution | string;
  run?: (request: PiWorkerRequest) => Promise<PiSdkWorkerExecution | string> | PiSdkWorkerExecution | string;
}

interface PiSdkSessionRuntime {
  replaceSession?: (transition: PiRuntimeTransition & { cwd?: string }) => Promise<unknown> | unknown;
  replaceActiveSession?: (transition: PiRuntimeTransition & { cwd?: string }) => Promise<unknown> | unknown;
  switchSession?: (transition: PiRuntimeTransition & { cwd?: string }) => Promise<unknown> | unknown;
  transitionToSession?: (transition: PiRuntimeTransition & { cwd?: string }) => Promise<unknown> | unknown;
}

interface PiSdkModule {
  createPiWorkerRuntime?: () => PiSdkWorkerRuntime;
  createPiRuntime?: () => PiSdkWorkerRuntime;
  createRuntime?: () => PiSdkWorkerRuntime;
  createAgentSessionRuntime?: () => PiSdkSessionRuntime;
  AgentSessionRuntime?: new () => PiSdkSessionRuntime;
  runtime?: PiSdkWorkerRuntime & { sessionRuntime?: PiSdkSessionRuntime };
  sessionRuntime?: PiSdkSessionRuntime;
  runWorker?: PiSdkWorkerRuntime["runWorker"];
  default?: unknown;
}

function readPiWorkerStatus(value: unknown): PiWorkerRunStatus {
  if (
    value === "completed" ||
    value === "blocked" ||
    value === "waiting_input" ||
    value === "failed"
  ) {
    return value;
  }
  return "completed";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const handle = setTimeout(() => {
        clearTimeout(handle);
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    }),
  ]);
}

function toImportSpecifier(moduleId: string): string {
  if (moduleId.startsWith(".") || moduleId.startsWith("/")) {
    return pathToFileURL(resolve(moduleId)).href;
  }
  return moduleId;
}

function inferWorkerRuntime(module: PiSdkModule): PiSdkWorkerRuntime | undefined {
  if (typeof module.createPiWorkerRuntime === "function") {
    return module.createPiWorkerRuntime();
  }
  if (typeof module.createPiRuntime === "function") {
    return module.createPiRuntime();
  }
  if (typeof module.createRuntime === "function") {
    return module.createRuntime();
  }
  if (module.runtime) {
    return module.runtime;
  }
  if (typeof module.runWorker === "function") {
    return {
      runWorker: module.runWorker.bind(module),
    };
  }
  const defaultExport = module.default;
  if (defaultExport && typeof defaultExport === "object") {
    const candidate = defaultExport as PiSdkWorkerRuntime;
    if (
      typeof candidate.runWorker === "function" ||
      typeof candidate.executeWorker === "function" ||
      typeof candidate.run === "function"
    ) {
      return candidate;
    }
  }
  return undefined;
}

function inferSessionRuntime(
  module: PiSdkModule,
  workerRuntime: PiSdkWorkerRuntime | undefined,
): PiSdkSessionRuntime | undefined {
  if (typeof module.createAgentSessionRuntime === "function") {
    return module.createAgentSessionRuntime();
  }
  if (typeof module.AgentSessionRuntime === "function") {
    return new module.AgentSessionRuntime();
  }
  if (module.sessionRuntime) {
    return module.sessionRuntime;
  }
  if (workerRuntime && "sessionRuntime" in workerRuntime) {
    const embedded = (workerRuntime as PiSdkModule["runtime"])?.sessionRuntime;
    if (embedded) {
      return embedded;
    }
  }
  return undefined;
}

async function invokeWorkerRuntime(
  runtime: PiSdkWorkerRuntime,
  request: PiWorkerRequest,
): Promise<PiSdkWorkerExecution> {
  const raw =
    (typeof runtime.runWorker === "function"
      ? await runtime.runWorker(request)
      : typeof runtime.executeWorker === "function"
        ? await runtime.executeWorker(request)
        : typeof runtime.run === "function"
          ? await runtime.run(request)
          : undefined) ?? "";

  if (typeof raw === "string") {
    return {
      status: "completed",
      outputSummary: raw,
      conclusions: raw.trim() ? raw.trim().split("\n").slice(0, 5) : [],
    };
  }

  return raw;
}

async function applyRuntimeTransition(
  runtime: PiSdkSessionRuntime | undefined,
  transition: PiRuntimeTransition,
  cwd: string,
): Promise<void> {
  if (!runtime) {
    return;
  }

  const payload = {
    ...transition,
    cwd,
  };
  if (typeof runtime.replaceSession === "function") {
    await runtime.replaceSession(payload);
    return;
  }
  if (typeof runtime.replaceActiveSession === "function") {
    await runtime.replaceActiveSession(payload);
    return;
  }
  if (typeof runtime.switchSession === "function") {
    await runtime.switchSession(payload);
    return;
  }
  if (typeof runtime.transitionToSession === "function") {
    await runtime.transitionToSession(payload);
  }
}

export interface PiSdkRuntimeConfig {
  sdkModule?: string;
  timeoutMs?: number;
  piBinary?: string;
  piSessionDir?: string;
}

export function createSdkPiRuntimeBridge(
  config: PiSdkRuntimeConfig = {},
): PiRuntimeBridge {
  const timeoutMs = config.timeoutMs ?? 30_000;
  const sdkModuleId =
    config.sdkModule ??
    process.env.HELLM_PI_SDK_MODULE ??
    "@mariozechner/pi-agent-core";
  let connected = true;

  let loadedSdkModule: Promise<PiSdkModule | undefined> | undefined;
  let loadedWorkerRuntime: Promise<PiSdkWorkerRuntime | undefined> | undefined;
  let loadedSessionRuntime: Promise<PiSdkSessionRuntime | undefined> | undefined;

  const getSdkModule = () => {
    loadedSdkModule ??= (async () => {
      try {
        return (await import(toImportSpecifier(sdkModuleId))) as PiSdkModule;
      } catch {
        connected = false;
        return undefined;
      }
    })();
    return loadedSdkModule;
  };

  const getWorkerRuntime = () => {
    loadedWorkerRuntime ??= (async () => {
      const module = await getSdkModule();
      if (!module) {
        return undefined;
      }
      return inferWorkerRuntime(module);
    })();
    return loadedWorkerRuntime;
  };

  const getSessionRuntime = () => {
    loadedSessionRuntime ??= (async () => {
      const [module, workerRuntime] = await Promise.all([
        getSdkModule(),
        getWorkerRuntime(),
      ]);
      if (!module) {
        return undefined;
      }
      return inferSessionRuntime(module, workerRuntime);
    })();
    return loadedSessionRuntime;
  };

  return {
    get connected() {
      return connected;
    },
    runtime: "pi",
    async runWorker(request) {
      const now = new Date().toISOString();
      try {
        const [workerRuntime, sessionRuntime] = await Promise.all([
          getWorkerRuntime(),
          getSessionRuntime(),
        ]);
        if (!workerRuntime) {
          connected = false;
          return {
            status: "failed",
            episode: createEpisode({
              id: `${request.thread.id}:pi-worker:${now}`,
              threadId: request.thread.id,
              source: "pi-worker",
              objective: request.objective,
              status: "failed",
              conclusions: ["Pi runtime SDK is unavailable."],
              unresolvedIssues: [
                `Unable to import pi runtime module "${sdkModuleId}".`,
              ],
              provenance: {
                executionPath: "pi-worker",
                actor: "pi-worker",
                notes: "Pi runtime SDK module load failed.",
              },
              startedAt: now,
              completedAt: now,
              inputEpisodeIds: request.inputEpisodeIds,
              ...(request.thread.worktreePath
                ? { worktreePath: request.thread.worktreePath }
                : {}),
            }),
          };
        }

        if (request.runtimeTransition) {
          await withTimeout(
            applyRuntimeTransition(sessionRuntime, request.runtimeTransition, request.cwd),
            timeoutMs,
            "pi runtime transition",
          );
        }

        const execution = await withTimeout(
          invokeWorkerRuntime(workerRuntime, request),
          timeoutMs,
          "pi worker execution",
        );

        const status = readPiWorkerStatus(execution.status);
        const conclusions =
          execution.conclusions && execution.conclusions.length > 0
            ? execution.conclusions
            : execution.outputSummary?.trim()
              ? execution.outputSummary.trim().split("\n").slice(0, 5)
              : status === "completed"
                ? ["Pi runtime worker completed."]
                : ["Pi runtime worker did not complete successfully."];
        const unresolvedIssues =
          status === "failed" || status === "blocked"
            ? execution.unresolvedIssues ?? []
            : [];

        const result: PiWorkerResult = {
          status,
          episode: createEpisode({
            id: `${request.thread.id}:pi-worker:${now}`,
            threadId: request.thread.id,
            source: "pi-worker",
            objective: request.objective,
            status,
            conclusions,
            unresolvedIssues,
            provenance: {
              executionPath: "pi-worker",
              actor: "pi-worker",
              notes: "Pi runtime SDK worker execution.",
            },
            startedAt: now,
            completedAt: now,
            inputEpisodeIds: request.inputEpisodeIds,
            ...(request.thread.worktreePath
              ? { worktreePath: request.thread.worktreePath }
              : {}),
          }),
          ...(execution.outputSummary !== undefined
            ? { outputSummary: execution.outputSummary }
            : {}),
        };
        if (request.runtimeTransition) {
          result.runtimeTransition = request.runtimeTransition;
        }
        return result;
      } catch (error) {
        return {
          status: "failed",
          episode: createEpisode({
            id: `${request.thread.id}:pi-worker:${now}`,
            threadId: request.thread.id,
            source: "pi-worker",
            objective: request.objective,
            status: "failed",
            conclusions: ["Pi runtime worker execution failed."],
            unresolvedIssues: [error instanceof Error ? error.message : String(error)],
            provenance: {
              executionPath: "pi-worker",
              actor: "pi-worker",
              notes: "Pi runtime SDK worker invocation failed.",
            },
            startedAt: now,
            completedAt: now,
            inputEpisodeIds: request.inputEpisodeIds,
            ...(request.thread.worktreePath
              ? { worktreePath: request.thread.worktreePath }
              : {}),
          }),
        };
      }
    },
    async switchRuntime(transition) {
      const sessionRuntime = await getSessionRuntime();
      await withTimeout(
        applyRuntimeTransition(sessionRuntime, transition, transition.toWorktreePath ?? process.cwd()),
        timeoutMs,
        "pi runtime switch",
      );
      return transition;
    },
  };
}

export function createSubprocessPiRuntimeBridge(
  config: PiSdkRuntimeConfig = {},
): PiRuntimeBridge {
  const timeoutMs = config.timeoutMs ?? 30_000;
  const piBinary = config.piBinary ?? process.env.HELLM_PI_BINARY ?? "pi";
  let connected = true;

  return {
    get connected() {
      return connected;
    },
    runtime: "pi",
    async runWorker(request) {
      const now = new Date().toISOString();
      const tools = request.toolScope.readOnly
        ? ["read", "grep", "find", "ls"]
        : ["read", "bash", "edit", "write"];
      const piSessionDir =
        config.piSessionDir ??
        resolve(request.cwd, ".hellm", "pi-runtime");

      try {
        mkdirSync(piSessionDir, { recursive: true });
      } catch {
        // best effort; pi will still try to run
      }

      try {
        const proc = Bun.spawn(
          [
            piBinary,
            "-p",
            "--mode",
            "text",
            "--no-session",
            "--offline",
            "--tools",
            tools.join(","),
            request.objective,
          ],
          {
            cwd: request.cwd,
            stdout: "pipe",
            stderr: "pipe",
            env: {
              ...process.env,
              PI_CODING_AGENT_DIR: piSessionDir,
              PI_OFFLINE: "1",
            },
          },
        );
        const completion = withTimeout(proc.exited, timeoutMs, "pi subprocess execution");
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          completion,
        ]);
        const output = stdout.trim();
        const issue = stderr.trim();

        let status: PiWorkerRunStatus = exitCode === 0 ? "completed" : "failed";
        if (
          /No models available|Set an API key|no api key/i.test(output) ||
          /No models available|api key/i.test(issue)
        ) {
          status = "failed";
        }

        const result: PiWorkerResult = {
          status,
          episode: createEpisode({
            id: `${request.thread.id}:pi-worker:${now}`,
            threadId: request.thread.id,
            source: "pi-worker",
            objective: request.objective,
            status,
            conclusions:
              output.length > 0
                ? output.split("\n").slice(0, 5)
                : status === "completed"
                  ? ["Pi worker subprocess completed."]
                  : ["Pi worker subprocess failed."],
            unresolvedIssues:
              status === "failed"
                ? [issue || output || `pi exited with code ${exitCode}.`]
                : [],
            provenance: {
              executionPath: "pi-worker",
              actor: "pi-worker",
              notes: "Pi worker subprocess execution.",
            },
            startedAt: now,
            completedAt: now,
            inputEpisodeIds: request.inputEpisodeIds,
            ...(request.thread.worktreePath
              ? { worktreePath: request.thread.worktreePath }
              : {}),
          }),
          ...(output.length > 0 ? { outputSummary: output } : {}),
        };
        if (request.runtimeTransition) {
          result.runtimeTransition = request.runtimeTransition;
        }
        return result;
      } catch (error) {
        connected = false;
        return {
          status: "failed",
          episode: createEpisode({
            id: `${request.thread.id}:pi-worker:${now}`,
            threadId: request.thread.id,
            source: "pi-worker",
            objective: request.objective,
            status: "failed",
            conclusions: ["Pi runtime subprocess execution failed."],
            unresolvedIssues: [
              error instanceof Error ? error.message : String(error),
            ],
            provenance: {
              executionPath: "pi-worker",
              actor: "pi-worker",
              notes: "Pi runtime subprocess invocation failed.",
            },
            startedAt: now,
            completedAt: now,
            inputEpisodeIds: request.inputEpisodeIds,
            ...(request.thread.worktreePath
              ? { worktreePath: request.thread.worktreePath }
              : {}),
          }),
        };
      }
    },
    async switchRuntime(transition) {
      return transition;
    },
  };
}

export function createPiRuntimeBridge(
  config?: PiSdkRuntimeConfig,
): PiRuntimeBridge {
  const sdkModuleId = config?.sdkModule ?? process.env.HELLM_PI_SDK_MODULE;
  if (sdkModuleId) {
    return createSdkPiRuntimeBridge({
      ...config,
      sdkModule: sdkModuleId,
    });
  }
  return createSubprocessPiRuntimeBridge(config);
}
