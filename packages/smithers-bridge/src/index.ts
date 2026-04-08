import type {
  Episode,
  ThreadRef,
  WorkflowRunReference,
} from "@hellm/session-model";

const NOT_IMPLEMENTED = "Not implemented";

export interface WorkflowTaskSpec {
  id: string;
  outputKey: string;
  prompt: string;
  agent: "pi" | "static" | "verification";
  needsApproval?: boolean;
  retryLimit?: number;
  worktreePath?: string;
}

export interface AuthoredWorkflow {
  workflowId: string;
  name: string;
  objective: string;
  inputEpisodeIds: string[];
  tasks: WorkflowTaskSpec[];
}

export interface SmithersTypedOutput {
  nodeId: string;
  schema: string;
  value: Record<string, unknown>;
}

export interface SmithersApprovalRequest {
  nodeId: string;
  title: string;
  summary: string;
  mode: "needsApproval" | "approval-node";
}

export interface SmithersApprovalDecision {
  approved: boolean;
  note?: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface SmithersIsolationState {
  runId: string;
  runStateStore: string;
  sessionEntryIds: string[];
}

export interface SmithersRunRequest {
  path: "smithers-workflow";
  thread: ThreadRef;
  objective: string;
  cwd: string;
  workflow: AuthoredWorkflow;
  worktreePath?: string;
}

export interface SmithersResumeRequest {
  runId: string;
  thread: ThreadRef;
  objective: string;
}

export type SmithersRunStatus =
  | "completed"
  | "waiting_approval"
  | "waiting_resume"
  | "blocked"
  | "failed";

export interface SmithersRunResult {
  run: WorkflowRunReference;
  status: SmithersRunStatus;
  outputs: SmithersTypedOutput[];
  episode: Episode;
  approval?: SmithersApprovalRequest;
  waitReason?: string;
  retryCount?: number;
  isolation?: SmithersIsolationState;
}

export interface SmithersWorkflowBridge {
  readonly enabled: boolean;
  readonly engine: "smithers";
  runWorkflow(request: SmithersRunRequest): Promise<SmithersRunResult>;
  resumeWorkflow(request: SmithersResumeRequest): Promise<SmithersRunResult>;
  approveRun(runId: string, decision: SmithersApprovalDecision): Promise<void>;
  denyRun(runId: string, decision: SmithersApprovalDecision): Promise<void>;
}

export function authorWorkflow(input: {
  thread: ThreadRef;
  objective: string;
  inputEpisodeIds: string[];
  tasks: WorkflowTaskSpec[];
}): AuthoredWorkflow {
  return {
    workflowId: `workflow:${input.thread.id}`,
    name: input.objective,
    objective: input.objective,
    inputEpisodeIds: input.inputEpisodeIds,
    tasks: input.tasks,
  };
}

export function translateSmithersRunToEpisode(result: SmithersRunResult): Episode {
  return result.episode;
}

export function createSmithersWorkflowBridge(): SmithersWorkflowBridge {
  return {
    enabled: false,
    engine: "smithers",
    async runWorkflow() {
      throw new Error(NOT_IMPLEMENTED);
    },
    async resumeWorkflow() {
      throw new Error(NOT_IMPLEMENTED);
    },
    async approveRun() {
      throw new Error(NOT_IMPLEMENTED);
    },
    async denyRun() {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
