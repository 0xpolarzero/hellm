import type { SessionStatus, WorkspaceSessionSummary } from "./chat-rpc";

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatRelativeSessionTime(value: string | number | Date): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const diffMs = timestamp - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);

  if (Math.abs(diffMinutes) < 60) {
    return RELATIVE_TIME_FORMATTER.format(diffMinutes, "minute");
  }
  if (Math.abs(diffHours) < 24) {
    return RELATIVE_TIME_FORMATTER.format(diffHours, "hour");
  }
  return RELATIVE_TIME_FORMATTER.format(diffDays, "day");
}

export function sessionStatusTone(status: SessionStatus): "neutral" | "warning" | "danger" {
  switch (status) {
    case "running":
    case "waiting":
      return "warning";
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}

export function formatSessionStatusLabel(summary: WorkspaceSessionSummary): string {
  switch (summary.status) {
    case "running":
      return summary.threadIdsByStatus?.runningWorkflow.length ||
        summary.threadIdsByStatus?.runningHandler.length
        ? "Threading"
        : "Running";
    case "waiting":
      return "Waiting";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

export function formatSessionModel(summary: WorkspaceSessionSummary): string {
  if (summary.provider && summary.modelId) {
    return `${summary.provider}:${summary.modelId}`;
  }
  if (summary.modelId) {
    return summary.modelId;
  }
  return "";
}
