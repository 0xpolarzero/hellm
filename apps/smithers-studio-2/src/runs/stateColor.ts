import type { RunNodeState } from "./runState";

/**
 * Map a run/node state to its design-token CSS variable. Color is a *signal*
 * (DESIGN.md): only running/blocked/failed/approved states glow; everything
 * else stays tertiary so the eye is pulled to the one thing that changed.
 */
export function stateColor(state: RunNodeState): string {
  switch (state) {
    case "running":
      return "var(--accent)";
    case "waiting-approval":
    case "waiting-event":
    case "waiting-timer":
      return "var(--warning)";
    case "succeeded":
      return "var(--success)";
    case "failed":
      return "var(--danger)";
    case "cancelled":
      return "var(--text-tertiary)";
    case "pending":
      return "var(--info)";
    default:
      return "var(--text-tertiary)";
  }
}

/** Short human label for a state, shown in pills and the history list. */
export function stateLabel(state: RunNodeState): string {
  switch (state) {
    case "running":
      return "Running";
    case "waiting-approval":
      return "Approval";
    case "waiting-event":
      return "Waiting event";
    case "waiting-timer":
      return "Waiting timer";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "pending":
      return "Pending";
    default:
      return "Unknown";
  }
}
