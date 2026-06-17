<script module lang="ts">
  const LOG_SCROLL_OFFSET_BY_PANEL = new Map<string, number>();
</script>

<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import { createVirtualizer } from "@tanstack/svelte-virtual";
  import { onMount, tick, untrack } from "svelte";
  import { get } from "svelte/store";
  import type {
    AppLogEntry,
    AppLogLevel,
    AppLogReadModel,
    AppLogSource,
  } from "../shared/workspace-contract";
  import type { ChatRuntime } from "./chat-runtime";
  import {
    applyAppLogLiveUpdate,
    filterAppLogEntries,
    formatAppLogCount,
    mergeAppLogEntries,
  } from "./app-logs";
  import ExtensionListRow from "./ExtensionListRow.svelte";
  import Button from "./ui/Button.svelte";
  import CompactSelect from "./ui/CompactSelect.svelte";
  import Dialog from "./ui/Dialog.svelte";
  import Input from "./ui/Input.svelte";
  import MetadataChip from "./ui/MetadataChip.svelte";
  import PaneFilterTabs, { type PaneFilterTabOption } from "./ui/PaneFilterTabs.svelte";
  import StatusCard from "./ui/StatusCard.svelte";

  type Props = {
    runtime: ChatRuntime;
    panelId: string;
  };

  let { runtime, panelId }: Props = $props();

  const LEVEL_FILTERS: Array<{ level: AppLogLevel | "all"; label: string; shortLabel: string }> = [
    { level: "all", label: "All levels", shortLabel: "All" },
    { level: "debug", label: "Debug logs", shortLabel: "Debug" },
    { level: "info", label: "Info logs", shortLabel: "Info" },
    { level: "warn", label: "Warning logs", shortLabel: "Warnings" },
    { level: "error", label: "Error logs", shortLabel: "Errors" },
  ];

  type SourceFilterId =
    | "all"
    | "app"
    | "sessions"
    | "prompts"
    | "threads"
    | "workflows"
    | "tools"
    | "artifacts"
    | "renderer";

  const SOURCE_FILTERS: Array<{
    id: SourceFilterId;
    label: string;
    sources?: AppLogSource[];
  }> = [
    { id: "all", label: "All sources" },
    {
      id: "app",
      label: "App runtime",
      sources: ["app.lifecycle", "app.bridge", "app.rpc", "auth.provider", "settings", "workspace"],
    },
    {
      id: "sessions",
      label: "Sessions",
      sources: ["session", "session.title", "surface", "source.graph"],
    },
    { id: "prompts", label: "Prompts", sources: ["prompt"] },
    { id: "threads", label: "Threads", sources: ["thread"] },
    {
      id: "workflows",
      label: "Workflows",
      sources: ["smithers", "workflow.library", "workflow.run", "workflow.task"],
    },
    { id: "tools", label: "Tools", sources: ["direct-tool", "execute_typescript"] },
    { id: "artifacts", label: "Artifacts", sources: ["artifact", "external-editor"] },
    { id: "renderer", label: "Renderer", sources: ["renderer"] },
  ];


  let readModel = $state<AppLogReadModel | null>(null);
  let expandedIds = $state(new Set<string>());
  let levelFilter = $state<AppLogLevel | "all">("all");
  let sourceFilter = $state<SourceFilterId>("all");
  let query = $state("");
  let loading = $state(true);
  let error = $state<string | null>(null);
  let newLogsWhileAway = $state(0);
  let bottomPinned = $state(true);
  let listElement = $state<HTMLDivElement | null>(null);
  let loadingOlder = $state(false);
  let hasOlderLogs = $state(true);
  let copiedTarget = $state<"all" | string | null>(null);
  let showCopyAllWarning = $state(false);
  let skipCopyAllWarning = $state(false);
  let lastMarkedVisibleSeq = $state(0);
  let copyResetTimer: number | null = null;
  let scrollStateFrame: number | null = null;
  let unsubscribeLogUpdate: (() => void) | null = null;
  let unsubscribeRuntime: (() => void) | null = null;

  const LOG_LIST_LIMIT = 600;
  const LOG_PAGE_LIMIT = 300;
  const LOG_MAX_LOADED = 2_000;
  const LOG_COPY_LIMIT = 10_000;
  const COPY_ALL_WARNING_STORAGE_KEY = "svvy.appLogs.copyAllWarningDismissed";
  const LOG_ROW_ESTIMATE_PX = 72;
  const APP_LOG_TAIL_THRESHOLD_PX = 40;

  function syncRuntimeSnapshot(): void {
    const snapshot = runtime.appLogsSnapshot;
    if (snapshot && levelFilter === "all" && sourceFilter === "all" && !query.trim()) {
      readModel = snapshot;
      loading = false;
    }
  }

  syncRuntimeSnapshot();

  const visibleEntries = $derived(
    filterAppLogEntries(readModel?.entries ?? [], {
      level: levelFilter,
      sources: selectedLogSources(),
      query,
    }),
  );
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => listElement,
    estimateSize: () => LOG_ROW_ESTIMATE_PX,
    getItemKey: (index) => visibleEntries[index]?.seq ?? index,
    overscan: 12,
    gap: 8,
    anchorTo: "end",
    scrollEndThreshold: APP_LOG_TAIL_THRESHOLD_PX,
    followOnAppend: false,
  });
  const virtualRows = $derived($virtualizer.getVirtualItems());
  const totalVirtualSize = $derived($virtualizer.getTotalSize());
  const virtualBlockOffset = $derived(virtualRows[0]?.start ?? 0);

  function levelTone(level: AppLogLevel): "info" | "warning" | "danger" {
    if (level === "error") return "danger";
    if (level === "warn") return "warning";
    return "info";
  }

  function levelFilterCount(level: AppLogLevel | "all"): number {
    if (!readModel) return 0;
    return level === "all" ? readModel.summary.totals.total : readModel.summary.totals[level];
  }

  function levelFilterTone(level: AppLogLevel | "all"): PaneFilterTabOption["tone"] {
    if (level === "error") return "danger";
    if (level === "warn") return "warning";
    if (level === "info") return "info";
    return "neutral";
  }

  const levelFilterOptions = $derived(
    LEVEL_FILTERS.map((filter) => ({
      value: filter.level,
      label: filter.shortLabel,
      count: readModel ? levelFilterCount(filter.level) : null,
      tone: levelFilterTone(filter.level),
      ariaLabel: `${filter.label}: ${levelFilterCount(filter.level)} log${levelFilterCount(filter.level) === 1 ? "" : "s"}`,
    })),
  );

  const sourceFilterOptions = $derived(
    SOURCE_FILTERS.map((filter) => ({ value: filter.id, label: filter.label })),
  );

  function selectedLogSources(): AppLogSource[] | undefined {
    return SOURCE_FILTERS.find((filter) => filter.id === sourceFilter)?.sources;
  }

  function formatTime(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  }

  type RelatedLogTarget = {
    label: string;
    value: string;
    action?: "session" | "workflow-task" | "command" | "artifact";
  };

  function relatedIds(entry: AppLogEntry): RelatedLogTarget[] {
    return [
      entry.workspaceSessionId
        ? { label: "session", value: entry.workspaceSessionId, action: "session" }
        : null,
      entry.surfacePiSessionId ? { label: "surface", value: entry.surfacePiSessionId } : null,
      entry.threadId ? { label: "thread", value: entry.threadId } : null,
      entry.workflowRunId ? { label: "workflow", value: entry.workflowRunId } : null,
      entry.workflowTaskAttemptId && entry.workspaceSessionId
        ? { label: "task", value: entry.workflowTaskAttemptId, action: "workflow-task" }
        : entry.workflowTaskAttemptId
          ? { label: "task", value: entry.workflowTaskAttemptId }
          : null,
      entry.commandId && entry.workspaceSessionId
        ? { label: "command", value: entry.commandId, action: "command" }
        : entry.commandId
          ? { label: "command", value: entry.commandId }
          : null,
      entry.artifactId && entry.workspaceSessionId
        ? { label: "artifact", value: entry.artifactId, action: "artifact" }
        : entry.artifactId
          ? { label: "artifact", value: entry.artifactId }
          : null,
    ].filter((item): item is RelatedLogTarget => !!item);
  }

  async function openRelated(entry: AppLogEntry, target: RelatedLogTarget) {
    if (target.action === "session") {
      await runtime.openSession(target.value, { kind: "new-panel", direction: "right" });
    } else if (target.action === "workflow-task" && entry.workspaceSessionId) {
      await runtime.openSurface(
        {
          workspaceSessionId: entry.workspaceSessionId,
          surface: "workflow-task-attempt",
          workflowTaskAttemptId: target.value,
        },
        { kind: "new-panel", direction: "right" },
      );
    } else if (target.action === "command" && entry.workspaceSessionId) {
      await runtime.openSurface(
        { workspaceSessionId: entry.workspaceSessionId, surface: "command", commandId: target.value },
        { kind: "new-panel", direction: "right" },
      );
    } else if (target.action === "artifact" && entry.workspaceSessionId) {
      await runtime.openSurface(
        { workspaceSessionId: entry.workspaceSessionId, surface: "artifact", artifactId: target.value },
        { kind: "new-panel", direction: "right" },
      );
    }
  }

  function toggleExpanded(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    expandedIds = next;
    void measureVisibleLogRows();
  }

  function toggleLogRow(entry: AppLogEntry) {
    toggleExpanded(entry.id);
  }

  function syncScrollState() {
    if (!listElement) return;
    const instance = get(virtualizer);
    bottomPinned = instance.isAtEnd(APP_LOG_TAIL_THRESHOLD_PX);
    LOG_SCROLL_OFFSET_BY_PANEL.set(panelId, listElement.scrollTop);
    if (bottomPinned || instance.getDistanceFromEnd() <= 0) {
      newLogsWhileAway = 0;
    }
  }

  function handleListScroll() {
    if (scrollStateFrame !== null) {
      cancelAnimationFrame(scrollStateFrame);
    }
    scrollStateFrame = requestAnimationFrame(() => {
      scrollStateFrame = null;
      syncScrollState();
      if (listElement && listElement.scrollTop < 120) {
        void loadOlderLogs();
      }
      void markVisibleLogsRead();
    });
  }

  function prefersReducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function scrollToTail(options: { smooth?: boolean; markRead?: boolean } = {}) {
    const { smooth = false, markRead = true } = options;
    requestAnimationFrame(() => {
      if (!listElement) return;
      bottomPinned = true;
      newLogsWhileAway = 0;
      const behavior: ScrollBehavior = smooth && !prefersReducedMotion() ? "smooth" : "auto";
      get(virtualizer).scrollToEnd({ behavior });
      LOG_SCROLL_OFFSET_BY_PANEL.set(panelId, listElement.scrollTop);
      if (markRead) {
        void markVisibleLogsRead();
      }
    });
  }

  async function markReadThroughSeq(throughSeq: number) {
    const summary = readModel?.summary ?? runtime.appLogSummary;
    const boundedSeq = Math.min(throughSeq, summary.latestSeq);
    if (boundedSeq <= 0 || boundedSeq <= summary.seenSeq || boundedSeq <= lastMarkedVisibleSeq) {
      return;
    }
    lastMarkedVisibleSeq = boundedSeq;
    const nextSummary = await runtime.markAppLogsSeen(boundedSeq);
    if (readModel) {
      readModel = { ...readModel, summary: nextSummary };
    }
  }

  function highestVisibleLogSeq(): number {
    if (!listElement || levelFilter !== "all" || sourceFilter !== "all" || query.trim()) {
      return 0;
    }
    const viewportStart = listElement.scrollTop;
    const viewportEnd = viewportStart + listElement.clientHeight;
    let highestSeq = 0;
    for (const row of get(virtualizer).getVirtualItems()) {
      if (row.end <= viewportStart || row.start >= viewportEnd) continue;
      const entry = visibleEntries[row.index];
      if (entry) highestSeq = Math.max(highestSeq, entry.seq);
    }
    return highestSeq;
  }

  async function markVisibleLogsRead() {
    await markReadThroughSeq(highestVisibleLogSeq());
  }

  function restoreScrollOffset(scrollOffset: number) {
    requestAnimationFrame(() => {
      if (!listElement) return;
      get(virtualizer).scrollToOffset(scrollOffset);
      void markVisibleLogsRead();
    });
  }

  async function loadLogs(options: { forceTail?: boolean; smoothTail?: boolean } = {}) {
    const shouldFollowTail = options.forceTail === true;
    const scrollOffset = listElement?.scrollTop ?? LOG_SCROLL_OFFSET_BY_PANEL.get(panelId) ?? 0;
    loading = !readModel;
    error = null;
    try {
      const next = await runtime.getAppLogs({
        limit: LOG_LIST_LIMIT,
        levels: levelFilter === "all" ? undefined : [levelFilter],
        sources: selectedLogSources(),
        query: query.trim() || undefined,
      });
      readModel = next;
      hasOlderLogs = next.entries.length >= LOG_LIST_LIMIT;
      if (shouldFollowTail) {
        scrollToTail({ smooth: options.smoothTail });
      } else {
        restoreScrollOffset(scrollOffset);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Unable to load app logs.";
    } finally {
      loading = false;
    }
  }

  function formatLogEntryText(entry: AppLogEntry): string {
    const related = relatedIds(entry)
      .map((target) => `${target.label}=${target.value}`)
      .join(" ");
    const blocks = [
      `[${entry.seq}] ${entry.createdAt} ${entry.level} ${entry.source} ${entry.message}${related ? ` ${related}` : ""}`,
    ];
    if (entry.details) {
      blocks.push(`details=${JSON.stringify(entry.details, null, 2)}`);
    }
    if (entry.error) {
      blocks.push(`error=${JSON.stringify(entry.error, null, 2)}`);
    }
    return blocks.join("\n");
  }

  async function loadOlderLogs() {
    if (!readModel || loadingOlder || !hasOlderLogs || visibleEntries.length === 0) return;
    const firstSeq = readModel.entries[0]?.seq;
    if (!firstSeq) return;
    loadingOlder = true;
    try {
      const older = await runtime.getAppLogs({
        limit: LOG_PAGE_LIMIT,
        beforeSeq: firstSeq,
        levels: levelFilter === "all" ? undefined : [levelFilter],
        sources: selectedLogSources(),
        query: query.trim() || undefined,
      });
      hasOlderLogs = older.entries.length >= LOG_PAGE_LIMIT;
      if (older.entries.length === 0) return;
      readModel = {
        entries: mergeAppLogEntries(readModel.entries, older.entries).slice(-LOG_MAX_LOADED),
        summary: older.summary,
      };
    } catch (err) {
      error = err instanceof Error ? err.message : "Unable to load older app logs.";
    } finally {
      loadingOlder = false;
    }
  }

  async function copyTextToClipboard(text: string): Promise<void> {
    try {
      await runtime.writeClipboardText(text);
      return;
    } catch (rpcError) {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          return;
        } catch (clipboardError) {
          throw new Error("Native and browser clipboard writes failed.", {
            cause: clipboardError,
          });
        }
      }
      if (!document.queryCommandSupported?.("copy")) {
        throw rpcError;
      }
    }

    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "true");
    fallback.style.position = "fixed";
    fallback.style.top = "0";
    fallback.style.left = "0";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.focus();
    fallback.select();
    try {
      const copied = document.execCommand("copy");
      if (!copied) {
        throw new Error("Copy command was not accepted.");
      }
    } finally {
      fallback.remove();
    }
  }

  function markCopied(target: "all" | string) {
    copiedTarget = target;
    if (copyResetTimer !== null) {
      window.clearTimeout(copyResetTimer);
    }
    copyResetTimer = window.setTimeout(() => {
      copiedTarget = null;
      copyResetTimer = null;
    }, 1800);
  }

  function shouldShowCopyAllWarning(): boolean {
    return localStorage.getItem(COPY_ALL_WARNING_STORAGE_KEY) !== "true";
  }

  function requestCopyAllLogs() {
    if (shouldShowCopyAllWarning()) {
      skipCopyAllWarning = false;
      showCopyAllWarning = true;
      return;
    }
    void copyAllLogs();
  }

  function closeCopyAllWarning() {
    showCopyAllWarning = false;
    skipCopyAllWarning = false;
  }

  async function confirmCopyAllLogs() {
    if (skipCopyAllWarning) {
      localStorage.setItem(COPY_ALL_WARNING_STORAGE_KEY, "true");
    }
    showCopyAllWarning = false;
    await copyAllLogs();
  }

  async function copyAllLogs() {
    const model = await runtime.getAppLogs({ limit: LOG_COPY_LIMIT });
    await copyTextToClipboard(model.entries.map(formatLogEntryText).join("\n\n"));
    markCopied("all");
  }

  async function copyLogEntry(entry: AppLogEntry) {
    await copyTextToClipboard(formatLogEntryText(entry));
    markCopied(entry.id);
  }

  onMount(() => {
    void loadLogs({ forceTail: !LOG_SCROLL_OFFSET_BY_PANEL.has(panelId) });
    unsubscribeLogUpdate = runtime.subscribeAppLogUpdate((payload) => {
      if (!readModel) return;
      const next = applyAppLogLiveUpdate({
        current: readModel,
        incomingEntries: payload.entries,
        incomingSummary: payload.summary,
        filters: { level: levelFilter, sources: selectedLogSources(), query },
        currentNewLogsWhileAway: newLogsWhileAway,
        maxLoaded: LOG_MAX_LOADED,
      });
      readModel = next.readModel;
      newLogsWhileAway = next.newLogsWhileAway;
    });
    unsubscribeRuntime = runtime.subscribe(() => {
      syncRuntimeSnapshot();
    });
    return () => {
      if (scrollStateFrame !== null) {
        cancelAnimationFrame(scrollStateFrame);
      }
      if (copyResetTimer !== null) {
        window.clearTimeout(copyResetTimer);
      }
      unsubscribeLogUpdate?.();
      unsubscribeRuntime?.();
    };
  });

  async function measureVisibleLogRows() {
    await tick();
    requestAnimationFrame(() => {
      const instance = get(virtualizer);
      for (const node of listElement?.querySelectorAll<HTMLDivElement>(".log-row-shell[data-index]") ?? []) {
        instance.measureElement(node);
      }
    });
  }

  function measureLogRow(node: HTMLDivElement) {
    const measure = () => get(virtualizer).measureElement(node);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return {
      update() {
        measure();
      },
      destroy() {
        observer.disconnect();
      },
    };
  }

  $effect(() => {
    void visibleEntries.length;
    void listElement;
    get(virtualizer).setOptions({
      count: visibleEntries.length,
      getScrollElement: () => listElement,
      getItemKey: (index) => visibleEntries[index]?.seq ?? index,
      anchorTo: "end",
      scrollEndThreshold: APP_LOG_TAIL_THRESHOLD_PX,
      followOnAppend: false,
    });
  });

  $effect(() => {
    void levelFilter;
    void sourceFilter;
    void query;
    untrack(() => {
      void loadLogs();
    });
  });

  $effect(() => {
    void expandedIds;
    void measureVisibleLogRows();
  });

  $effect(() => {
    void virtualRows;
    void visibleEntries;
    untrack(() => {
      void markVisibleLogsRead();
    });
  });
</script>

<section class="app-logs-pane" aria-label="App logs">
  <div class="logs-header">
    <div class="logs-filter-row">
      <div class="logs-filter-start">
        <PaneFilterTabs
          class="logs-severity-tabs"
          value={levelFilter}
          options={levelFilterOptions}
          aria-label="Severity filters"
          onSelect={(value) => (levelFilter = value as typeof levelFilter)}
        />
        <CompactSelect
          value={sourceFilter}
          options={sourceFilterOptions}
          ariaLabel="Filter app logs by source"
          triggerClass="logs-source-select"
          menuClass="logs-source-menu"
          optionClass="logs-source-option"
          placement="below"
          onSelect={(value) => (sourceFilter = value as typeof sourceFilter)}
        />
      </div>
      <Button class="copy-all-logs-button" size="xs" variant="ghost" onclick={requestCopyAllLogs}>
        {#if copiedTarget === "all"}
          <CheckIcon aria-hidden="true" size={13} />
        {:else}
          <CopyIcon aria-hidden="true" size={13} />
        {/if}
        <span>copy all logs</span>
      </Button>
    </div>
    <div class="logs-search-row">
      <Input bind:value={query} placeholder="Search message, source, id, details" aria-label="Search app logs" />
    </div>
  </div>

  {#if error}
    <div class="logs-status">
      <StatusCard eyebrow="App logs" title="Unable to load logs" message={error} tone="error" />
    </div>
  {:else if loading && !readModel}
    <p class="logs-message">Loading app logs...</p>
  {:else if readModel}
    <div class="logs-body">
      <div class="logs-list" bind:this={listElement} role="list" onscroll={handleListScroll}>
        {#if readModel.entries.length === 0}
          <p class="logs-empty">No app logs yet.</p>
        {:else if visibleEntries.length === 0}
          <p class="logs-empty">No logs match these filters.</p>
        {/if}
        {#if loadingOlder}
          <p class="logs-loading-older">Loading older logs...</p>
        {/if}
        <div class="logs-virtual-spacer" style={`height: ${totalVirtualSize}px;`}>
          <div class="logs-virtual-block" style={`transform: translate3d(0, ${virtualBlockOffset}px, 0);`}>
            {#each virtualRows as row (row.key)}
              {@const entry = visibleEntries[row.index]}
              {#if entry}
                <div
                  data-index={row.index}
                  use:measureLogRow
                  class={`log-row-shell level-${entry.level}`.trim()}
                >
                  <ExtensionListRow
                    id={entry.id}
                    title={entry.message}
                    description={`${entry.source} · ${formatTime(entry.createdAt)} · #${entry.seq}`}
                    expanded={expandedIds.has(entry.id)}
                    expandedInset={false}
                    showDragHandle={false}
                    showLeading={false}
                    onToggle={() => toggleLogRow(entry)}
                  >
                    {#snippet meta()}
                      <MetadataChip label="level" value={entry.level} tone={levelTone(entry.level)} mono={false} />
                      <MetadataChip label="source" value={entry.source} mono={false} />
                      {#if relatedIds(entry).length > 0}
                        <MetadataChip label="links" value={String(relatedIds(entry).length)} tone="accent" mono={false} />
                      {/if}
                    {/snippet}
                    {#snippet actions()}
                      <Button
                        variant="ghost"
                        size="xs"
                        iconOnly
                        class="row-copy-button"
                        aria-label="Copy log entry"
                        onclick={(event) => {
                          event.stopPropagation();
                          void copyLogEntry(entry);
                        }}
                      >
                        {#if copiedTarget === entry.id}
                          <CheckIcon aria-hidden="true" size={13} />
                        {:else}
                          <CopyIcon aria-hidden="true" size={13} />
                        {/if}
                      </Button>
                    {/snippet}
                    {#snippet expandedContent()}
                      <div class="row-details">
                      <dl class="row-detail-facts">
                        <dt>Sequence</dt><dd>#{entry.seq}</dd>
                        <dt>Created</dt><dd>{entry.createdAt}</dd>
                        <dt>Source</dt><dd>{entry.source}</dd>
                        <dt>Level</dt><dd>{entry.level}</dd>
                        {#each relatedIds(entry) as related (`expanded:${entry.id}:${related.label}`)}
                          <dt>{related.label}</dt>
                          <dd>
                            {#if related.action}
                              <button type="button" class="related-link-button" onclick={() => void openRelated(entry, related)}>
                                <MetadataChip value={related.value} tone="accent" />
                              </button>
                            {:else}
                              <code>{related.value}</code>
                            {/if}
                          </dd>
                        {/each}
                      </dl>
                      {#if entry.details}
                        <pre>{JSON.stringify(entry.details, null, 2)}</pre>
                      {/if}
                      {#if entry.error}
                        <pre class="error-block">{JSON.stringify(entry.error, null, 2)}</pre>
                      {/if}
                    </div>
                    {/snippet}
                  </ExtensionListRow>
                </div>
              {/if}
            {/each}
          </div>
        </div>
        {#if newLogsWhileAway > 0}
          <button type="button" class="new-logs-button" onclick={() => loadLogs({ forceTail: true, smoothTail: true })}>
            {formatAppLogCount(newLogsWhileAway)} new logs. Jump to latest
          </button>
        {/if}
      </div>
    </div>
  {/if}
</section>

{#if showCopyAllWarning}
  <Dialog
    title="Review logs before sharing"
    eyebrow="App logs"
    description="svvy redacts known sensitive values before logs are stored and copied, but automated redaction cannot guarantee that every private value is removed. Before pasting logs into a public issue, chat, or document, review the copied content and remove anything sensitive."
    width="md"
    onClose={closeCopyAllWarning}
  >
    <div class="copy-warning-body">
      <label class="copy-warning-checkbox">
        <input type="checkbox" bind:checked={skipCopyAllWarning} />
        <span>Don't show this again</span>
      </label>
      <div class="copy-warning-actions">
        <Button size="sm" variant="ghost" onclick={closeCopyAllWarning}>Cancel</Button>
        <Button size="sm" variant="primary" onclick={() => void confirmCopyAllLogs()}>Copy logs</Button>
      </div>
    </div>
  </Dialog>
{/if}

<style>
  .app-logs-pane {
    container-type: inline-size;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    background: var(--ui-panel);
    color: var(--ui-text-primary);
  }

  .logs-header {
    display: grid;
    gap: 0.42rem;
    min-width: 0;
    padding: 0.58rem 0.72rem 0.62rem;
    border-bottom: 1px solid var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-panel) 82%, var(--ui-surface));
  }

  .logs-filter-row,
  .logs-filter-start {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .logs-filter-row {
    justify-content: space-between;
    gap: 0.35rem;
  }

  .logs-filter-start {
    flex: 1 1 auto;
    gap: 0.42rem;
    overflow: hidden;
  }

  .logs-search-row {
    min-width: 0;
  }

  :global(.logs-severity-tabs) {
    background: transparent;
    padding: 0;
    gap: 0.22rem;
  }

  :global(.logs-severity-tabs .ui-pane-filter-tab) {
    min-height: 1.58rem;
    padding-inline: 0.52rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 62%, transparent);
    background: color-mix(in oklab, var(--ui-surface-raised) 78%, transparent);
    color: var(--ui-text-secondary);
    box-shadow: none;
  }

  :global(.logs-severity-tabs .ui-pane-filter-tab:hover) {
    border-color: color-mix(in oklab, var(--ui-border-strong) 48%, transparent);
    background: color-mix(in oklab, var(--ui-surface-raised) 96%, transparent);
    color: var(--ui-text-primary);
  }

  :global(.logs-severity-tabs .ui-pane-filter-tab.active) {
    border-color: color-mix(in oklab, var(--ui-accent) 32%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-accent-soft) 22%, var(--ui-surface-raised));
    color: var(--ui-text-primary);
  }

  :global(.logs-severity-tabs .ui-pane-filter-tab.tone-info.active) {
    border-color: color-mix(in oklab, var(--ui-info) 30%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-info-soft) 36%, var(--ui-surface-raised));
  }

  :global(.logs-severity-tabs .ui-pane-filter-tab.tone-warning.active) {
    border-color: color-mix(in oklab, var(--ui-warning) 32%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-warning-soft) 42%, var(--ui-surface-raised));
  }

  :global(.logs-severity-tabs .ui-pane-filter-tab.tone-danger.active) {
    border-color: color-mix(in oklab, var(--ui-danger) 34%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-danger-soft) 44%, var(--ui-surface-raised));
  }

  :global(.logs-source-select) {
    width: 9.8rem;
    min-height: 1.58rem;
    padding: 0 0.42rem;
    justify-content: space-between;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-raised) 82%, transparent);
    color: var(--ui-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
  }

  :global(.logs-source-option) {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  :global(.logs-source-select:hover),
  :global(.logs-source-select:focus-visible) {
    outline: none;
    border-color: color-mix(in oklab, var(--ui-border-strong) 48%, transparent);
    background: color-mix(in oklab, var(--ui-surface-raised) 96%, transparent);
    color: var(--ui-text-primary);
  }

  :global(.logs-source-select:focus-visible) {
    box-shadow: var(--ui-focus-ring);
  }

  :global(.copy-all-logs-button) {
    flex: 0 0 auto;
    height: 1.58rem;
    min-height: 1.58rem;
    padding: 0 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: none;
  }

  .logs-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
  }

  .logs-list {
    position: relative;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 0.48rem;
  }

  .logs-virtual-spacer {
    position: relative;
    min-height: 100%;
  }

  .logs-virtual-block {
    position: absolute;
    top: 0;
    inset-inline: 0;
    display: grid;
    gap: 8px;
  }

  .logs-loading-older {
    position: sticky;
    top: 0;
    z-index: 2;
    margin: 0;
    padding: 0.35rem;
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface-raised);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: center;
  }

  .log-row-shell {
    width: 100%;
  }

  .log-row-shell :global(.shared-extension-row) {
    background: color-mix(in oklab, var(--ui-surface-raised) 74%, transparent);
  }

  .log-row-shell :global(.shared-extension-row:hover) {
    border-color: color-mix(in oklab, var(--ui-border-strong) 44%, transparent);
    background: color-mix(in oklab, var(--ui-surface-raised) 92%, transparent);
  }

  .log-row-shell.level-info :global(.shared-extension-row) {
    background: color-mix(in oklab, var(--ui-info-soft) 16%, var(--ui-surface-raised));
  }

  .log-row-shell.level-warn :global(.shared-extension-row) {
    border-color: color-mix(in oklab, var(--ui-warning) 18%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-warning-soft) 28%, var(--ui-surface-raised));
  }

  .log-row-shell.level-error :global(.shared-extension-row) {
    border-color: color-mix(in oklab, var(--ui-danger) 22%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-danger-soft) 30%, var(--ui-surface-raised));
  }

  .log-row-shell.level-debug :global(.shared-extension-row) {
    background: color-mix(in oklab, var(--ui-surface-muted) 34%, var(--ui-surface-raised));
  }

  .log-row-shell.level-info :global(.shared-extension-row:hover) {
    background: color-mix(in oklab, var(--ui-info-soft) 24%, var(--ui-surface-raised));
  }

  .log-row-shell.level-warn :global(.shared-extension-row:hover) {
    background: color-mix(in oklab, var(--ui-warning-soft) 38%, var(--ui-surface-raised));
  }

  .log-row-shell.level-error :global(.shared-extension-row:hover) {
    background: color-mix(in oklab, var(--ui-danger-soft) 40%, var(--ui-surface-raised));
  }

  .log-row-shell :global(.shared-extension-expanded.no-inset) {
    padding-inline: 0;
  }

  .log-row-shell :global(.ui-metadata-chip) {
    font-family: var(--font-sans);
  }

  .new-logs-button:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ui-text-tertiary);
  }

  dd code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-copy-button {
    align-self: center;
  }

  .row-details {
    display: grid;
    gap: 0.4rem;
    cursor: auto;
    padding: 0.12rem 0 0.08rem;
  }

  .row-detail-facts {
    grid-template-columns: 4.5rem minmax(0, 1fr);
    box-sizing: border-box;
    width: 100%;
    padding: 0.46rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface) 62%, transparent);
    font-family: var(--font-sans);
  }

  .related-link-button {
    max-width: 100%;
    padding: 0;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .related-link-button:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  dl {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr);
    gap: 0.34rem 0.5rem;
    margin: 0;
    font-size: var(--text-xs);
  }

  dt {
    color: var(--ui-text-tertiary);
  }

  dd {
    margin: 0;
    min-width: 0;
  }

  pre {
    max-height: 18rem;
    overflow: auto;
    margin: 0;
    padding: 0.58rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-code);
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
  }

  .error-block {
    border-color: color-mix(in oklab, var(--ui-danger) 34%, var(--ui-border-soft));
  }

  .logs-message,
  .logs-empty {
    margin: 0;
    padding: 0.75rem;
    color: var(--ui-text-tertiary);
    font-size: var(--text-sm);
  }

  .logs-message.error {
    color: var(--ui-danger);
  }

  .logs-status {
    padding: 0.7rem;
  }

  .new-logs-button {
    position: sticky;
    bottom: 0.55rem;
    left: 50%;
    transform: translateX(-50%);
    justify-self: center;
    z-index: 3;
    border: 1px solid var(--ui-border-accent);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface-raised);
    color: var(--ui-accent);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    padding: 0.32rem 0.52rem;
  }

  .copy-warning-body {
    display: grid;
    gap: 0.82rem;
  }

  .copy-warning-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 0.42rem;
    color: var(--ui-text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .copy-warning-checkbox input {
    width: 0.92rem;
    height: 0.92rem;
    accent-color: var(--ui-accent);
  }

  .copy-warning-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.45rem;
  }

  @container (max-width: 44rem) {
    .logs-filter-row,
    .logs-filter-start {
      align-items: stretch;
      flex-direction: column;
    }

    .logs-filter-row {
      gap: 0.42rem;
    }

    :global(.logs-severity-tabs),
    :global(.logs-source-select),
    :global(.copy-all-logs-button) {
      width: 100%;
    }
  }
</style>
