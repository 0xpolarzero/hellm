import type { SessionStatus, WorkspaceSessionSummary } from "../shared/workspace-contract";

function formatRelativeUnit(value: number, unit: "min" | "hr" | "day"): string {
  if (value === 0) {
    return "just now";
  }

  const absoluteValue = Math.abs(value);
  const unitLabel = unit === "day" && absoluteValue !== 1 ? "days" : unit;
  const label = `${absoluteValue} ${unitLabel}`;
  return value < 0 ? `${label} ago` : `in ${label}`;
}

export function formatRelativeSessionTime(value: string | number | Date): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const diffMs = timestamp - Date.now();
  if (Math.abs(diffMs) < 60000) {
    return "just now";
  }

  const diffMinutes = Math.round(diffMs / 60000);
  if (Math.abs(diffMinutes) < 60) {
    return formatRelativeUnit(diffMinutes, "min");
  }

  const diffHours = Math.round(diffMs / 3600000);
  if (Math.abs(diffHours) < 24) {
    return formatRelativeUnit(diffHours, "hr");
  }

  const diffDays = Math.round(diffMs / 86400000);
  return formatRelativeUnit(diffDays, "day");
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
