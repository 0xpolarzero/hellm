import { describe, expect, it } from "bun:test";

const paneSource = await Bun.file(`${import.meta.dir}/AppLogsPane.svelte`).text();
const workspaceSource = await Bun.file(`${import.meta.dir}/ChatWorkspace.svelte`).text();
const sidebarSource = await Bun.file(`${import.meta.dir}/SessionSidebar.svelte`).text();

describe("AppLogsPane virtualized log list contract", () => {
  it("uses TanStack Virtual with stable log sequence keys and variable-height measurement", () => {
    expect(paneSource).toContain('import { createVirtualizer } from "@tanstack/svelte-virtual";');
    expect(paneSource).toContain(
      "const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({",
    );
    expect(paneSource).toContain("getItemKey: (index) => visibleEntries[index]?.seq ?? index");
    expect(paneSource).toContain("instance.measureElement(node)");
    expect(paneSource).toContain("const observer = new ResizeObserver(measure)");
  });

  it("anchors explicit latest jumps through the virtualizer with reduced-motion fallback", () => {
    expect(paneSource).toContain('anchorTo: "end"');
    expect(paneSource).toContain("get(virtualizer).scrollToEnd({ behavior })");
    expect(paneSource).toContain('smooth && !prefersReducedMotion() ? "smooth" : "auto"');
  });

  it("keeps older-page loading and persisted scroll state wired to TanStack helpers", () => {
    expect(paneSource).toContain("beforeSeq: firstSeq");
    expect(paneSource).toContain("bottomPinned = instance.isAtEnd(APP_LOG_TAIL_THRESHOLD_PX)");
    expect(paneSource).toContain("instance.getDistanceFromEnd()");
    expect(paneSource).toContain("get(virtualizer).scrollToOffset(scrollOffset)");
    expect(paneSource).toContain("LOG_SCROLL_OFFSET_BY_PANEL.set(panelId, listElement.scrollTop)");
    expect(paneSource).toContain("followOnAppend: false");
    expect(paneSource).not.toContain("scrollHeight");
    expect(paneSource).not.toContain("previousTotalSize");
  });

  it("renders related artifact ids through the same linked detail path as commands", () => {
    expect(paneSource).toContain("entry.artifactId && entry.workspaceSessionId");
    expect(paneSource).toContain(
      '{ label: "artifact", value: entry.artifactId, action: "artifact" }',
    );
    expect(paneSource).toContain('surface: "artifact", artifactId: target.value');
  });

  it("keeps pane filtering, viewport mark-read, expandable detail, and stack trace controls wired", () => {
    expect(paneSource).toContain('ariaLabel="Filter app logs by source"');
    expect(paneSource).toContain('aria-label="Search app logs"');
    expect(paneSource).toContain("<PaneFilterTabs");
    expect(paneSource).toContain(
      "onSelect={(value) => (levelFilter = value as typeof levelFilter)}",
    );
    expect(paneSource).toContain("logs-severity-tabs .ui-pane-filter-tab.active");
    expect(paneSource).not.toContain("showDots");
    expect(paneSource).toContain("<CompactSelect");
    expect(paneSource).toContain("function highestVisibleLogSeq(): number");
    expect(paneSource).toContain("row.end <= viewportStart || row.start >= viewportEnd");
    expect(paneSource).toContain("runtime.markAppLogsSeen(boundedSeq)");
    expect(paneSource).not.toContain("runtime.markAppLogsSeen(summary.latestSeq)");
    expect(paneSource).toContain("function toggleExpanded(id: string)");
    expect(paneSource).toContain("expandedIds = next");
    expect(paneSource).toContain("<ExtensionListRow");
    expect(paneSource).toContain("class={`log-row-shell level-${entry.level}`.trim()}");
    expect(paneSource).not.toContain("log-level-dot");
    expect(paneSource).toContain("{#if entry.details}");
    expect(paneSource).toContain("{#if entry.error}");
  });

  it("does not mark logs read when the pane is merely opened", () => {
    expect(workspaceSource).not.toContain(
      "runtime.markAppLogsSeen(runtime.appLogSummary.latestSeq)",
    );
  });

  it("exposes every contract app-log source in the source filter", async () => {
    const appLogsSource = await Bun.file(`${import.meta.dir}/app-logs.ts`).text();

    expect(appLogsSource).toContain('"source.graph"');
  });

  it("keeps the sidebar Logs action before app-global source-library actions with action-worthy badges", () => {
    const logsIndex = sidebarSource.indexOf("{#if onOpenAppLogs}");
    const agentsIndex = sidebarSource.indexOf("{#if onOpenAgents}");
    const extensionsIndex = sidebarSource.indexOf("{#if onOpenExtensions}");
    const workflowsIndex = sidebarSource.indexOf("{#if onOpenWorkflowLibrary}");

    expect(logsIndex).toBeGreaterThanOrEqual(0);
    expect(agentsIndex).toBeGreaterThan(logsIndex);
    expect(extensionsIndex).toBeGreaterThan(agentsIndex);
    expect(workflowsIndex).toBeGreaterThan(extensionsIndex);
    expect(sidebarSource).toContain("getVisibleAppLogUnreadBadges(appLogSummary)");
    expect(sidebarSource).toContain("formatAppLogCount(badge.count)");
    expect(sidebarSource).toContain(".log-badge.warn");
    expect(sidebarSource).toContain(".log-badge.error");
  });
});
