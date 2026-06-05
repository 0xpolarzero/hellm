import type { DevToolsNode } from "./DevToolsNode";

/**
 * A full DevTools snapshot for one run — the payload returned by the gateway
 * `getDevToolsSnapshot` RPC. `runState` is present when the gateway could
 * compute it (run-level lifecycle state + the blocked reason that names the
 * node a paused run is waiting on).
 */
export type DevToolsSnapshot = {
  version: 1;
  runId: string;
  frameNo: number;
  seq: number;
  root: DevToolsNode;
  runState?: DevToolsRunState;
};

/**
 * The run-level state the gateway folds into `getDevToolsSnapshot` (shape
 * `{runId,state,blocked,unhealthy,computedAt}`). The snapshot tree carries node
 * structure + labels but no per-node lifecycle state, so the blocked reason here
 * is the only signal for which node a paused run is waiting on.
 */
export type DevToolsRunState = {
  runId: string;
  state: string;
  computedAt?: string;
  blocked?: { kind: string; nodeId: string };
  unhealthy?: { kind: string; nodeId?: string };
};
