import {
  normalizeState,
  type ApprovalSummary,
  type RunStateView,
  type RunSummary,
} from "./runState";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Parse a `listWorkflows` payload into a `workflowKey → uiPath` map, keeping
 * only workflows that actually mount a custom UI (`hasUi` + a non-empty
 * `uiPath`). This is the authoritative source for "does this run's workflow ship
 * its own UI, and where is it served" — the Runs surface keys off `workflowKey`
 * to decide whether to default a live run into the workflow's own UI.
 */
export function parseWorkflowUiPaths(payload: unknown): Record<string, string> {
  if (!Array.isArray(payload)) return {};
  const paths: Record<string, string> = {};
  for (const raw of payload) {
    const record = asRecord(raw);
    const key = asString(record.key);
    const uiPath = asString(record.uiPath);
    if (key && record.hasUi === true && uiPath) paths[key] = uiPath;
  }
  return paths;
}

/** Parse a listRuns payload (array of run summaries) into RunSummary rows. */
export function parseRunSummaries(payload: unknown): RunSummary[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((raw) => {
    const record = asRecord(raw);
    return {
      runId: String(record.runId ?? ""),
      workflowKey: asString(record.workflowKey),
      status: normalizeState(record.status),
      createdAtMs: asNumber(record.createdAtMs),
    } satisfies RunSummary;
  }).filter((row) => row.runId.length > 0);
}

/**
 * Parse a `getRun` payload into the run-level surface model. The REAL gateway's
 * getRun returns run metadata + `summary` + a `runState`
 * ({runId,state,blocked,unhealthy,computedAt}) and carries NO node tree, so this
 * reads only run-level fields. `state` is taken from `runState.state` (the
 * computed lifecycle state) when present, falling back to the raw row `status`;
 * `tree` is left null here and merged in by the data layer from the separate
 * `getDevToolsSnapshot` RPC. Frame fields (`currentFrame`/`frameCount`) are
 * likewise left undefined here — getRun carries no frame ledger; they are
 * derived from the snapshot's `frameNo` by the data layer.
 */
export function parseRunState(payload: unknown): RunStateView {
  const record = asRecord(payload);
  const runState = asRecord(record.runState);
  const blocked = asRecord(runState.blocked);
  const runId = String(record.runId ?? runState.runId ?? "");
  return {
    runId,
    workflowKey: asString(record.workflowKey),
    state: normalizeState(runState.state ?? record.state ?? record.status),
    createdAtMs: asNumber(record.createdAtMs),
    tree: null,
    blockedNodeId: asString(blocked.nodeId),
  } satisfies RunStateView;
}

/** Parse a listApprovals payload (array of approval summaries). */
export function parseApprovals(payload: unknown): ApprovalSummary[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((raw) => {
    const record = asRecord(raw);
    return {
      runId: String(record.runId ?? ""),
      workflowKey: asString(record.workflowKey),
      nodeId: String(record.nodeId ?? ""),
      iteration: asNumber(record.iteration) ?? 0,
      requestTitle: asString(record.requestTitle),
      requestSummary: asString(record.requestSummary),
      requestedAtMs: asNumber(record.requestedAtMs) ?? null,
    } satisfies ApprovalSummary;
  }).filter((row) => row.runId.length > 0 && row.nodeId.length > 0);
}
