/**
 * Run-state domain model for the Runs surface. These types mirror the Gateway
 * RPC payloads (listRuns / getRun / listApprovals / getNodeOutput) but are
 * declared locally so the surface stays self-contained and never couples to an
 * undeclared package. The Gateway's RunStateView is `additionalProperties:true`,
 * so the live tree it returns deserializes straight into `RunNode`.
 */

/** Canonical run/node lifecycle states, mapped 1:1 to signal colors. */
export type RunNodeState =
  | "running"
  | "waiting-approval"
  | "waiting-event"
  | "waiting-timer"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "pending"
  | "unknown";

/** One node in the live run tree. Mirrors the DevTools node shape. */
export type RunNode = {
  id: string;
  /** Smithers node type: "workflow" | "task" | "sequence" | ... */
  type: string;
  /** Display tag rendered in the tree row. */
  name: string;
  state: RunNodeState;
  /** Key props summarized 11px mono after the node tag. */
  keyProps?: string;
  /**
   * The task's current iteration, from the snapshot's `task.iteration`. The
   * gateway's getNodeOutput/getNodeDiff require an explicit iteration (they
   * reject undefined as InvalidIteration); the inspector threads this through
   * so it reads the node's REAL iteration rather than assuming 0.
   */
  iteration?: number;
  children: RunNode[];
};

/**
 * Run-level state of one run, as returned by the gateway `getRun` RPC. The real
 * gateway's getRun returns run metadata + `summary` + a `runState`
 * ({runId,state,blocked,unhealthy,computedAt}) and carries NO node tree — the
 * tree comes from the separate `getDevToolsSnapshot` RPC and is merged in by the
 * data layer (see {@link snapshotToRunTree}).
 */
export type RunStateView = {
  runId: string;
  workflowKey?: string;
  state: RunNodeState;
  createdAtMs?: number;
  /** The live node tree, merged in from the DevTools snapshot. */
  tree: RunNode | null;
  /** Logical id of the node a paused run is blocked on, from runState.blocked. */
  blockedNodeId?: string;
  /** Latest committed frame number, for the time-travel scrubber. */
  currentFrame?: number;
  frameCount?: number;
};

/** Row in the run-history list, returned by listRuns. */
export type RunSummary = {
  runId: string;
  workflowKey?: string;
  status: RunNodeState;
  createdAtMs?: number;
};

/** A pending approval gate, returned by listApprovals. */
export type ApprovalSummary = {
  runId: string;
  workflowKey?: string;
  nodeId: string;
  iteration: number;
  requestTitle?: string;
  requestSummary?: string;
  requestedAtMs: number | null;
};

/** Inspector tab payloads. */
export type NodeOutput = {
  status?: string;
  row?: unknown;
  schema?: unknown;
};

export type NodeDiff = {
  summary?: { filesChanged?: number };
  files?: Array<{ path: string; patch?: string }>;
};

/** A single streamed run-event line (for the logs tab + running cursor). */
export type RunEventLine = {
  seq: number;
  nodeId?: string;
  event: string;
  message: string;
  atMs: number;
};

const RUNNING_STATES: ReadonlySet<RunNodeState> = new Set([
  "running",
  "waiting-approval",
  "waiting-event",
  "waiting-timer",
]);

const TERMINAL_STATES: ReadonlySet<RunNodeState> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

export function isRunningState(state: RunNodeState): boolean {
  return RUNNING_STATES.has(state);
}

export function isTerminalState(state: RunNodeState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Normalize an arbitrary status string from the wire into a `RunNodeState`.
 * The Gateway uses a wider, hyphen/underscore-inconsistent vocabulary; this is
 * the single choke point that collapses it to the surface's color states.
 */
export function normalizeState(raw: unknown): RunNodeState {
  const value = String(raw ?? "").toLowerCase().replace(/_/g, "-");
  switch (value) {
    case "running":
    case "active":
    case "recovering":
      return "running";
    case "waiting-approval":
    case "waitingapproval":
    case "blocked-approval":
      return "waiting-approval";
    case "waiting-event":
    case "waitingevent":
      return "waiting-event";
    case "waiting-timer":
    case "waitingtimer":
      return "waiting-timer";
    case "succeeded":
    case "success":
    case "finished":
    case "completed":
    case "done":
      return "succeeded";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "pending":
    case "queued":
    case "scheduled":
      return "pending";
    default:
      return "unknown";
  }
}
