import type { DevToolsNode } from "../devtools/DevToolsNode";
import type { DevToolsSnapshot } from "../devtools/DevToolsSnapshot";
import { normalizeState, type RunNode, type RunNodeState } from "./runState";

/**
 * The logical node id used to key tree rows, inspector RPCs, and approval
 * matching. The DevTools snapshot gives every node a numeric structural id, but
 * `getNodeOutput` / `getNodeDiff` / `submitApproval` and the `listApprovals`
 * rows all speak the *logical* node id (e.g. `approve-deploy`). So we key the
 * Runs tree on `task.nodeId` when present, falling back to the numeric id for
 * structural nodes (workflow / sequence / parallel) that have no task identity.
 */
export function runNodeId(node: DevToolsNode): string {
  return node.task?.nodeId ?? String(node.id);
}

/** Prefer a human label, then the logical node id, then the raw tag name. */
function runNodeName(node: DevToolsNode): string {
  const label =
    node.task?.label ??
    (typeof node.props.label === "string" ? node.props.label : undefined) ??
    (typeof node.props.name === "string" ? node.props.name : undefined);
  return label ?? node.task?.nodeId ?? node.name;
}

/** A compact key-prop summary mirroring the developer tree's prop preview. */
function runNodeKeyProps(node: DevToolsNode): string | undefined {
  const keys = Object.keys(node.props).filter((key) => key !== "name" && key !== "label");
  if (keys.length === 0) return undefined;
  return keys.slice(0, 4).join(" ");
}

/**
 * Derive a per-node lifecycle state. The snapshot tree carries no per-node
 * state, so the only honest signals are the run-level state and the blocked
 * reason that names the node a paused run waits on. A node that is the blocked
 * approval node — or that has a pending approval row — is `waiting-approval`;
 * the root mirrors the run-level state; everything else is left `unknown`
 * (rendered neutral) rather than fabricating a state we do not have.
 */
function runNodeState(
  node: DevToolsNode,
  isRoot: boolean,
  runLevelState: RunNodeState,
  blockedNodeId: string | undefined,
  pendingApprovalNodeIds: ReadonlySet<string>,
): RunNodeState {
  const id = runNodeId(node);
  if (node.props.needsApproval === true && (id === blockedNodeId || pendingApprovalNodeIds.has(id))) {
    return "waiting-approval";
  }
  if (id === blockedNodeId) {
    return "waiting-approval";
  }
  if (pendingApprovalNodeIds.has(id)) {
    return "waiting-approval";
  }
  if (isRoot) {
    return runLevelState;
  }
  return "unknown";
}

function mapNode(
  node: DevToolsNode,
  isRoot: boolean,
  runLevelState: RunNodeState,
  blockedNodeId: string | undefined,
  pendingApprovalNodeIds: ReadonlySet<string>,
): RunNode {
  return {
    id: runNodeId(node),
    type: node.type,
    name: runNodeName(node),
    state: runNodeState(node, isRoot, runLevelState, blockedNodeId, pendingApprovalNodeIds),
    keyProps: runNodeKeyProps(node),
    iteration: node.task?.iteration,
    children: node.children.map((child) =>
      mapNode(child, false, runLevelState, blockedNodeId, pendingApprovalNodeIds),
    ),
  };
}

/**
 * Map a real `getDevToolsSnapshot` snapshot into the Runs surface `RunNode`
 * tree. Returns null for the gateway's empty-root placeholder (a run with no
 * execution frames yet), so the tree pane shows its "no tree yet" empty state.
 */
export function snapshotToRunTree(
  snapshot: DevToolsSnapshot | null,
  pendingApprovalNodeIds: ReadonlySet<string> = new Set(),
): RunNode | null {
  if (!snapshot) return null;
  const root = snapshot.root;
  // The gateway returns this sentinel root for runs with no frames.
  if (root.id === 0 && root.name === "(empty)" && root.children.length === 0) {
    return null;
  }
  const runLevelState = normalizeState(snapshot.runState?.state);
  const blockedNodeId = snapshot.runState?.blocked?.nodeId;
  return mapNode(root, true, runLevelState, blockedNodeId, pendingApprovalNodeIds);
}
