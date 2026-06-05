import type { DevToolsNode } from "./DevToolsNode";
import type { DevToolsRunState, DevToolsSnapshot } from "./DevToolsSnapshot";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseTask(raw: unknown): DevToolsNode["task"] | undefined {
  const record = asRecord(raw);
  const nodeId = asString(record.nodeId);
  if (!nodeId) return undefined;
  const kind = record.kind === "agent" || record.kind === "compute" ? record.kind : "static";
  return {
    nodeId,
    kind,
    agent: asString(record.agent),
    label: asString(record.label),
    outputTableName: asString(record.outputTableName),
    iteration:
      typeof record.iteration === "number" && Number.isFinite(record.iteration)
        ? record.iteration
        : undefined,
  };
}

function parseNode(raw: unknown, fallbackDepth: number): DevToolsNode {
  const record = asRecord(raw);
  const childrenRaw = Array.isArray(record.children) ? record.children : [];
  const depth =
    typeof record.depth === "number" && Number.isFinite(record.depth) ? record.depth : fallbackDepth;
  return {
    id: typeof record.id === "number" ? record.id : 0,
    type: asString(record.type) ?? "unknown",
    name: asString(record.name) ?? "unknown",
    props: asRecord(record.props),
    task: parseTask(record.task),
    children: childrenRaw.map((child) => parseNode(child, depth + 1)),
    depth,
  };
}

function parseRunState(raw: unknown): DevToolsRunState | undefined {
  const record = asRecord(raw);
  const runId = asString(record.runId);
  const state = asString(record.state);
  if (!runId || !state) return undefined;
  const blockedRecord = asRecord(record.blocked);
  const blockedNodeId = asString(blockedRecord.nodeId);
  const blockedKind = asString(blockedRecord.kind);
  const unhealthyRecord = asRecord(record.unhealthy);
  const unhealthyKind = asString(unhealthyRecord.kind);
  return {
    runId,
    state,
    computedAt: asString(record.computedAt),
    ...(blockedKind && blockedNodeId
      ? { blocked: { kind: blockedKind, nodeId: blockedNodeId } }
      : {}),
    ...(unhealthyKind
      ? { unhealthy: { kind: unhealthyKind, nodeId: asString(unhealthyRecord.nodeId) } }
      : {}),
  };
}

/**
 * Parse a raw `getDevToolsSnapshot` RPC payload into the typed
 * {@link DevToolsSnapshot}. This is the single choke point both the developer
 * DevTools surface and the Runs surface drive their node tree through, so the
 * gateway's wire shape is validated in exactly one place.
 */
export function parseDevToolsSnapshot(payload: unknown): DevToolsSnapshot | null {
  const record = asRecord(payload);
  if (!record.root) return null;
  const runState = parseRunState(record.runState);
  return {
    version: 1,
    runId: asString(record.runId) ?? "",
    frameNo: typeof record.frameNo === "number" ? record.frameNo : 0,
    seq: typeof record.seq === "number" ? record.seq : 0,
    root: parseNode(record.root, 0),
    ...(runState ? { runState } : {}),
  };
}
