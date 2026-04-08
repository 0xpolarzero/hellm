import type { Episode, ThreadRef } from "@hellm/session-model";

const NOT_IMPLEMENTED = "Not implemented";

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

export function createPiRuntimeBridge(): PiRuntimeBridge {
  return {
    connected: false,
    runtime: "pi",
    async runWorker() {
      throw new Error(NOT_IMPLEMENTED);
    },
    async switchRuntime() {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
