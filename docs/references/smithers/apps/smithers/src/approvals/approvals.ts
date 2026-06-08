/**
 * The approvals surface: the queue of pending approval gates plus the history of
 * resolved decisions, ported from the Swift ApprovalsView (the gate-inspection
 * pane that watches `<Approval>` nodes). One card and one canvas render the same
 * seeded data; the Pending/History toggle mirrors the Swift `showHistory` pill.
 *
 * apps/smithers has no gateway yet, so the queue is seeded with believable gates
 * spanning the three wait-time escalation bands. Every timestamp is a fixed
 * millisecond offset from a single exported {@link NOW_MS} anchor, so wait-times
 * render identically every run and the pure helpers below are deterministically
 * unit-tested without a DOM (see approvalsDomain.test.ts).
 */

/** Where an approval was discovered. `synthetic` is the inspection fallback. */
export type ApprovalSource = "http" | "sqlite" | "exec" | "synthetic";

export type ApprovalStatus = "pending" | "approved" | "denied";

/** One approval gate the engine paused on, with the metadata the detail shows. */
export type ApprovalGate = {
  id: string;
  runId: string;
  nodeId: string;
  /** The loop iteration the gate fired on, when the node is inside a loop. */
  iteration?: number;
  /** The workflow file the gate lives in. */
  workflowPath?: string;
  /** The gate's human name; falls back to `nodeId` when absent (Swift `gate ?? nodeId`). */
  gate?: string;
  status: ApprovalStatus;
  source: ApprovalSource;
  /** The decision context, a JSON string the detail pretty-prints. */
  payload?: string;
  requestedAtMs: number;
  resolvedAtMs?: number;
  resolvedBy?: string;
  note?: string;
  reason?: string;
};

/** A resolved gate, recorded in the History pane. `action` is the outcome. */
export type ApprovalDecision = {
  id: string;
  runId: string;
  nodeId: string;
  gate?: string;
  workflowPath?: string;
  iteration?: number;
  source: ApprovalSource;
  payload?: string;
  action: "approved" | "denied";
  requestedAtMs: number;
  resolvedAtMs: number;
  resolvedBy: string;
  note?: string;
  reason?: string;
};

/**
 * The fixed clock anchor. All seeded timestamps are `NOW_MS - <fixed offset>`,
 * so wait-times never touch `Date.now()` and the surface is reproducible.
 * 2024-12-06T15:46:40Z.
 */
export const NOW_MS = 1_733_500_000_000;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The pending queue, ordered oldest-first by `requestedAtMs` once sorted. The
 * three gates straddle the wait-time bands: fresh (<5m), warn (5–30m), and stale
 * (>30m), so every escalation color is visible at once.
 */
export const SEEDED_GATES: ApprovalGate[] = [
  {
    // Stale: requested 47m ago → danger tone. The most-overdue, surfaces at top.
    id: "gate-deploy-prod",
    runId: "run_8f3a91c2d4e5f6a7",
    nodeId: "deploy-prod",
    gate: "deploy-to-prod",
    workflowPath: ".smithers/workflows/ship-pipeline.tsx",
    status: "pending",
    source: "http",
    payload:
      '{"environment":"production","service":"auth","files_changed":8,"checks":"green","image":"ghcr.io/smithers/auth@sha256:9f2c"}',
    requestedAtMs: NOW_MS - (47 * MINUTE + 12 * SECOND),
  },
  {
    // Warn: requested 14m ago → warning tone.
    id: "gate-merge-main",
    runId: "run_2b8e4d1077aa33bc",
    nodeId: "merge-to-main",
    iteration: 2,
    gate: "merge-to-main",
    workflowPath: ".smithers/workflows/landings.tsx",
    status: "pending",
    source: "sqlite",
    payload:
      '{"branch":"feat/vcs-dashboard","base":"main","ahead":3,"behind":0,"conflicts":0,"reviewers":["ada"]}',
    requestedAtMs: NOW_MS - (14 * MINUTE + 5 * SECOND),
  },
  {
    // Fresh: requested 42s ago → muted tone; gate name absent so label falls back
    // to nodeId, and the source is the inspection fallback so the SYNTHETIC badge
    // shows and the detail explains the derivation.
    id: "gate-send-email",
    runId: "run_c4f10a99e0b15522",
    nodeId: "notify-customers",
    workflowPath: ".smithers/workflows/outreach.tsx",
    status: "pending",
    source: "synthetic",
    payload: '{"audience":"all-customers","template":"launch-2026","count":18234}',
    requestedAtMs: NOW_MS - 42 * SECOND,
  },
];

/**
 * The resolved history, newest-first once ordered. Mixes approvals and denials
 * with notes/reasons so every detail field below renders.
 */
export const SEEDED_DECISIONS: ApprovalDecision[] = [
  {
    id: "dec-rotate-keys",
    runId: "run_71aa90ce4d220f18",
    nodeId: "rotate-signing-keys",
    gate: "rotate-signing-keys",
    workflowPath: ".smithers/workflows/security-audit.tsx",
    source: "http",
    payload: '{"keys":2,"provider":"kms","rotation":"quarterly"}',
    action: "approved",
    requestedAtMs: NOW_MS - (2 * HOUR + 8 * MINUTE),
    resolvedAtMs: NOW_MS - (2 * HOUR + 3 * MINUTE),
    resolvedBy: "will",
    note: "Quarterly rotation, no active sessions affected.",
  },
  {
    id: "dec-drop-table",
    runId: "run_5f2a9c14b8e70d31",
    nodeId: "migrate-drop-legacy",
    gate: "drop-legacy-tables",
    workflowPath: ".smithers/workflows/migrate.tsx",
    iteration: 1,
    source: "sqlite",
    payload: '{"tables":["sessions_v1","tokens_v1"],"rows":182004,"backup":"pending"}',
    action: "denied",
    requestedAtMs: NOW_MS - (5 * HOUR + 40 * MINUTE),
    resolvedAtMs: NOW_MS - (5 * HOUR + 31 * MINUTE),
    resolvedBy: "ada",
    note: "Hold until the backup snapshot lands.",
    reason: "No verified backup of the legacy tables yet.",
  },
  {
    id: "dec-publish-pkg",
    runId: "run_9d0c11ff2ab34457",
    nodeId: "publish-npm",
    gate: "publish-to-npm",
    workflowPath: ".smithers/workflows/release.tsx",
    source: "exec",
    payload: '{"package":"@smithers/core","version":"0.9.0","tag":"latest"}',
    action: "approved",
    requestedAtMs: NOW_MS - (1 * DAY + 1 * HOUR),
    resolvedAtMs: NOW_MS - (1 * DAY + 54 * MINUTE),
    resolvedBy: "will",
  },
  {
    id: "dec-charge-card",
    runId: "run_3e7b220a9c1d6e80",
    nodeId: "charge-customer",
    workflowPath: ".smithers/workflows/billing.tsx",
    source: "synthetic",
    payload: '{"customer":"acme","amount_usd":4200,"invoice":"INV-2031"}',
    action: "denied",
    requestedAtMs: NOW_MS - (3 * DAY + 2 * HOUR),
    resolvedAtMs: NOW_MS - (3 * DAY + 1 * HOUR + 49 * MINUTE),
    resolvedBy: "ada",
    reason: "Amount exceeds the auto-charge ceiling; needs finance sign-off.",
  },
];

/** The label a gate or decision shows: its gate name, falling back to nodeId. */
export function gateLabel(item: { gate?: string; nodeId: string }): string {
  return item.gate && item.gate.trim() !== "" ? item.gate : item.nodeId;
}

/** Short run id for the mono `Run: <8>` subline (Swift's prefix(8)). */
export function shortRunId(runId: string): string {
  return runId.slice(0, 8);
}

/** Keep only the gates still waiting on a decision (Swift filterPendingApprovals). */
export function filterPending(gates: ApprovalGate[]): ApprovalGate[] {
  return gates
    .filter((gate) => gate.status === "pending")
    .sort((a, b) => a.requestedAtMs - b.requestedAtMs);
}

/** History newest-first by resolution time (most recent decision on top). */
export function orderHistory(decisions: ApprovalDecision[]): ApprovalDecision[] {
  return decisions.slice().sort((a, b) => b.resolvedAtMs - a.resolvedAtMs);
}

/**
 * Format the elapsed wait from a fixed `nowMs` anchor, porting Swift waitTime():
 * under a minute -> 'Ns'; under an hour -> 'Mm' or 'Mm Ss'; else 'Hh Mm'.
 * Negative spans (anchor before the request) clamp to 0.
 */
export function waitTime(requestedAtMs: number, nowMs: number): string {
  const totalSeconds = Math.max(0, Math.floor((nowMs - requestedAtMs) / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/**
 * Escalate the wait-time badge tone by age, porting Swift waitTimeColor():
 * under 5 min -> 'is-fresh' (muted), 5–30 min -> 'is-warn', over 30 min ->
 * 'is-stale' (danger). The boundaries are inclusive of the lower band.
 */
export function waitTimeTone(requestedAtMs: number, nowMs: number): "is-fresh" | "is-warn" | "is-stale" {
  const minutes = Math.max(0, (nowMs - requestedAtMs) / 60000);
  if (minutes < 5) return "is-fresh";
  if (minutes <= 30) return "is-warn";
  return "is-stale";
}

/**
 * Pretty-print a payload as 2-space-indented JSON, porting Swift prettyJSON():
 * fall back to the raw string (trimmed) when it does not parse, and to an empty
 * string when the input is nullish.
 */
export function prettyJson(raw: string | undefined): string {
  if (raw === undefined) return "";
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

/**
 * Format a millisecond timestamp deterministically as an ISO-style
 * `YYYY-MM-DD HH:MM:SS` in UTC. Uses Date only as a pure formatter over a fixed
 * seeded millis value — never `Date.now()` — so the rendered string is stable.
 */
export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** Pending + decided headline counts for the surface-sub and the card. */
export function summarizeApprovals(
  gates: ApprovalGate[],
  decisions: ApprovalDecision[],
): { pending: number; decided: number } {
  return { pending: filterPending(gates).length, decided: decisions.length };
}
