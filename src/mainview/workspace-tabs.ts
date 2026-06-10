import type {
  AppLogSummary,
  WorkspaceSessionSummary,
  WorkspaceTabInfo,
} from "../shared/workspace-contract";

export type WorkspaceTabCounts = {
  running: number;
  unread: number;
  waiting: number;
  warning: number;
  error: number;
};

export type WorkspaceTabCountKind = keyof WorkspaceTabCounts;

export type WorkspaceTabVisibleCount = {
  kind: WorkspaceTabCountKind;
  value: number;
  label: string;
};

export const EMPTY_WORKSPACE_TAB_COUNTS: WorkspaceTabCounts = {
  running: 0,
  unread: 0,
  waiting: 0,
  warning: 0,
  error: 0,
};

export const WORKSPACE_TAB_COUNT_LABELS: Record<WorkspaceTabCountKind, string> = {
  running: "running",
  unread: "unread",
  waiting: "waiting",
  warning: "warnings",
  error: "errors",
};

export const WORKSPACE_TAB_COUNT_ORDER: WorkspaceTabCountKind[] = [
  "running",
  "unread",
  "waiting",
  "warning",
  "error",
];

export type WorkspaceTabSummaryInput = {
  sessions: readonly Pick<WorkspaceSessionSummary, "status" | "isUnread" | "threadIdsByStatus">[];
  appLogSummary?: Pick<AppLogSummary, "unread"> | null;
};

export function summarizeWorkspaceTabCounts(input: WorkspaceTabSummaryInput): WorkspaceTabCounts {
  const counts = { ...EMPTY_WORKSPACE_TAB_COUNTS };
  for (const session of input.sessions) {
    if (session.status === "running") counts.running += 1;
    if (session.isUnread) counts.unread += 1;
    if (session.status === "waiting") counts.waiting += 1;
    if (session.status === "error") counts.error += 1;
    counts.waiting += session.threadIdsByStatus?.waiting.length ?? 0;
    counts.error += session.threadIdsByStatus?.troubleshooting.length ?? 0;
    counts.running +=
      (session.threadIdsByStatus?.runningHandler.length ?? 0) +
      (session.threadIdsByStatus?.runningWorkflow.length ?? 0);
  }
  counts.warning += input.appLogSummary?.unread.warn ?? 0;
  counts.error += input.appLogSummary?.unread.error ?? 0;
  return counts;
}

export function getVisibleWorkspaceTabCounts(
  counts: WorkspaceTabCounts,
): WorkspaceTabVisibleCount[] {
  return WORKSPACE_TAB_COUNT_ORDER.flatMap((kind) => {
    const value = counts[kind];
    if (value <= 0) return [];
    return [{ kind, value, label: WORKSPACE_TAB_COUNT_LABELS[kind] }];
  });
}

export function formatWorkspaceTabAriaLabel(
  workspace: Pick<WorkspaceTabInfo, "workspaceLabel">,
  counts: WorkspaceTabCounts,
): string {
  const visibleCounts = getVisibleWorkspaceTabCounts(counts);
  if (!visibleCounts.length) return workspace.workspaceLabel;
  return `${workspace.workspaceLabel}. ${visibleCounts
    .map((count) => `${count.value} ${count.label}`)
    .join(", ")}`;
}

export function reorderWorkspaceTabs<
  T extends { workspace: Pick<WorkspaceTabInfo, "workspaceTabId"> },
>(tabs: readonly T[], workspaceTabId: string, beforeWorkspaceTabId: string | null): T[] {
  if (workspaceTabId === beforeWorkspaceTabId) return [...tabs];
  const movingTab = tabs.find((tab) => tab.workspace.workspaceTabId === workspaceTabId);
  if (!movingTab) return [...tabs];

  const remainingTabs = tabs.filter((tab) => tab.workspace.workspaceTabId !== workspaceTabId);
  const beforeIndex = beforeWorkspaceTabId
    ? remainingTabs.findIndex((tab) => tab.workspace.workspaceTabId === beforeWorkspaceTabId)
    : -1;
  const nextTabs = [...remainingTabs];
  nextTabs.splice(beforeIndex >= 0 ? beforeIndex : nextTabs.length, 0, movingTab);
  return nextTabs;
}
