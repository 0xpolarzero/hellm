import type {
  AppLogEntry,
  AppLogLevel,
  AppLogReadModel,
  AppLogSource,
  AppLogSummary,
} from "../shared/workspace-contract";

export const APP_LOG_LEVELS: AppLogLevel[] = ["debug", "info", "warn", "error"];

export const APP_LOG_SOURCES: AppLogSource[] = [
  "app.lifecycle",
  "app.bridge",
  "app.rpc",
  "auth.provider",
  "settings",
  "workspace",
  "session",
  "session.title",
  "source.graph",
  "surface",
  "prompt",
  "thread",
  "smithers",
  "workflow.library",
  "workflow.run",
  "workflow.task",
  "direct-tool",
  "execute_typescript",
  "artifact",
  "external-editor",
  "renderer",
];

export function formatAppLogCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function getVisibleAppLogUnreadBadges(
  summary: AppLogSummary | null | undefined,
): Array<{ level: Extract<AppLogLevel, "warn" | "error">; count: number }> {
  if (!summary) return [];
  return [
    { level: "error" as const, count: summary.unread.error },
    { level: "warn" as const, count: summary.unread.warn },
  ].filter((badge) => badge.count > 0);
}

export function formatAppLogUnreadTitle(summary: AppLogSummary | null | undefined): string {
  const badges = getVisibleAppLogUnreadBadges(summary);
  if (badges.length === 0) return "Open app logs";
  return `Open app logs: ${badges
    .map((badge) => `${badge.count} ${badge.level === "error" ? "errors" : "warnings"}`)
    .join(", ")} unread`;
}

export function filterAppLogEntries(
  entries: AppLogEntry[],
  filters: { level: AppLogLevel | "all"; sources?: AppLogSource[]; query: string },
): AppLogEntry[] {
  const query = filters.query.trim().toLowerCase();
  const sourceSet = filters.sources?.length ? new Set(filters.sources) : null;
  return entries.filter((entry) => {
    if (filters.level !== "all" && entry.level !== filters.level) return false;
    if (sourceSet && !sourceSet.has(entry.source)) return false;
    if (!query) return true;
    return [
      entry.message,
      entry.source,
      entry.level,
      entry.workspaceSessionId,
      entry.surfacePiSessionId,
      entry.threadId,
      entry.workflowRunId,
      entry.workflowTaskAttemptId,
      entry.commandId,
      entry.artifactId,
      entry.details ? JSON.stringify(entry.details) : "",
      entry.error?.message ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

export function mergeAppLogEntries(current: AppLogEntry[], incoming: AppLogEntry[]): AppLogEntry[] {
  const byId = new Map<string, AppLogEntry>();
  for (const entry of current) byId.set(entry.id, entry);
  for (const entry of incoming) byId.set(entry.id, entry);
  return [...byId.values()].toSorted((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
}

export function applyAppLogLiveUpdate({
  current,
  incomingEntries,
  incomingSummary,
  filters,
  currentNewLogsWhileAway,
  maxLoaded,
}: {
  current: AppLogReadModel;
  incomingEntries: AppLogEntry[];
  incomingSummary: AppLogSummary;
  filters: { level: AppLogLevel | "all"; sources?: AppLogSource[]; query: string };
  currentNewLogsWhileAway: number;
  maxLoaded: number;
}): {
  readModel: AppLogReadModel;
  matchingNewEntries: AppLogEntry[];
  shouldFollowTail: boolean;
  newLogsWhileAway: number;
} {
  const knownIds = new Set(current.entries.map((entry) => entry.id));
  const appendedEntries = incomingEntries.filter((entry) => !knownIds.has(entry.id));
  const matchingNewEntries = filterAppLogEntries(appendedEntries, filters);
  const shouldFollowTail = false;
  const entries = mergeAppLogEntries(current.entries, matchingNewEntries).slice(-maxLoaded);
  const readModel = {
    ...current,
    entries,
    summary: incomingSummary,
    pageInfo: {
      ...current.pageInfo,
      returned: entries.length,
      total: Math.max(current.pageInfo.total, entries.length),
      newestSeq: entries.at(-1)?.seq ?? current.pageInfo.newestSeq,
    },
    readState: {
      ...current.readState,
      seenSeq: incomingSummary.seenSeq,
      unread: incomingSummary.unread,
    },
  };

  return {
    readModel,
    matchingNewEntries,
    shouldFollowTail,
    newLogsWhileAway:
      matchingNewEntries.length > 0
        ? currentNewLogsWhileAway + matchingNewEntries.length
        : currentNewLogsWhileAway,
  };
}
