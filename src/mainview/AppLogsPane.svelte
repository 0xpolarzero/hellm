<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import CheckIcon from "@lucide/svelte/icons/check";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import PauseIcon from "@lucide/svelte/icons/pause";
  import RadioIcon from "@lucide/svelte/icons/radio";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
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
  import type { AppLogLiveMode } from "./app-logs";
  import {
    APP_LOG_SOURCES,
    applyAppLogLiveUpdate,
    filterAppLogEntries,
    formatAppLogCount,
    mergeAppLogEntries,
  } from "./app-logs";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";
  import CompactSelect from "./ui/CompactSelect.svelte";
  import Dialog from "./ui/Dialog.svelte";
  import Input from "./ui/Input.svelte";
  import MetadataChip from "./ui/MetadataChip.svelte";
  import PaneFilterTabs, { type PaneFilterTabOption } from "./ui/PaneFilterTabs.svelte";
  import PaneHeader from "./ui/PaneHeader.svelte";
  import StatusCard from "./ui/StatusCard.svelte";
  import Tooltip from "./ui/Tooltip.svelte";

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

  let readModel = $state<AppLogReadModel | null>(null);
  let expandedIds = $state(new Set<string>());
  let levelFilter = $state<AppLogLevel | "all">("all");
  let sourceFilter = $state<AppLogSource | "all">("all");
  let query = $state("");
  let loading = $state(true);
  let error = $state<string | null>(null);
  let newLogsWhileAway = $state(0);
  let liveMode = $state<AppLogLiveMode>("live");
  let bottomPinned = $state(true);
  let listElement = $state<HTMLDivElement | null>(null);
  let loadingOlder = $state(false);
  let hasOlderLogs = $state(true);
  let copiedTarget = $state<"all" | string | null>(null);
  let showCopyAllWarning = $state(false);
  let skipCopyAllWarning = $state(false);
  let copyResetTimer: number | null = null;
  let scrollStateFrame: number | null = null;
  let unsubscribeLogUpdate: (() => void) | null = null;
  let unsubscribeRuntime: (() => void) | null = null;

  const LOG_LIST_LIMIT = 600;
  const LOG_PAGE_LIMIT = 300;
  const LOG_MAX_LOADED = 2_000;
  const LOG_COPY_LIMIT = 10_000;
  const COPY_ALL_WARNING_STORAGE_KEY = "svvy.appLogs.copyAllWarningDismissed";
  const LOG_ROW_ESTIMATE_PX = 76;
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
      source: sourceFilter,
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

  const sourceFilterOptions = $derived([
    { value: "all", label: "All sources" },
    ...APP_LOG_SOURCES.map((source) => ({ value: source, label: source })),
  ]);

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

  function handleLogRowKeydown(event: KeyboardEvent, entry: AppLogEntry) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleLogRow(entry);
    }
  }

  function syncTailFollowState() {
    if (!listElement) return;
    const instance = get(virtualizer);
    bottomPinned = instance.isAtEnd(APP_LOG_TAIL_THRESHOLD_PX);
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
      syncTailFollowState();
      if (listElement && listElement.scrollTop < 120) {
        void loadOlderLogs();
      }
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
      if (markRead) {
        void markReadThroughLatest();
      }
    });
  }

  function setLiveMode(nextLive: boolean) {
    if (nextLive) {
      liveMode = "live";
      bottomPinned = true;
      newLogsWhileAway = 0;
      void loadLogs({ forceTail: true, smoothTail: true });
      return;
    }
    liveMode = "frozen";
  }

  function toggleLiveMode() {
    setLiveMode(liveMode !== "live");
  }

  async function markReadThroughLatest() {
    const summary = readModel?.summary ?? runtime.appLogSummary;
    if (summary.latestSeq <= 0 || summary.latestSeq <= summary.seenSeq) {
      return;
    }
    const nextSummary = await runtime.markAppLogsSeen(summary.latestSeq);
    if (readModel) {
      readModel = { ...readModel, summary: nextSummary };
    }
  }

  function restoreDistanceFromEnd(distanceFromEnd: number) {
    requestAnimationFrame(() => {
      if (!listElement) return;
      const instance = get(virtualizer);
      instance.scrollToOffset(Math.max(instance.getTotalSize() - instance.getSize() - distanceFromEnd, 0));
    });
  }

  async function loadLogs(options: { forceTail?: boolean; smoothTail?: boolean } = {}) {
    const shouldFollowTail = options.forceTail === undefined ? liveMode === "live" && bottomPinned : options.forceTail;
    const distanceFromEnd = shouldFollowTail || !listElement ? 0 : get(virtualizer).getDistanceFromEnd();
    loading = !readModel;
    error = null;
    try {
      const next = await runtime.getAppLogs({
        limit: LOG_LIST_LIMIT,
        levels: levelFilter === "all" ? undefined : [levelFilter],
        sources: sourceFilter === "all" ? undefined : [sourceFilter],
        query: query.trim() || undefined,
      });
      readModel = next;
      hasOlderLogs = next.entries.length >= LOG_LIST_LIMIT;
      if (shouldFollowTail) {
        scrollToTail({ smooth: options.smoothTail });
      } else {
        restoreDistanceFromEnd(distanceFromEnd);
        void markReadThroughLatest();
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
        sources: sourceFilter === "all" ? undefined : [sourceFilter],
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
    void loadLogs({ forceTail: true });
    unsubscribeLogUpdate = runtime.subscribeAppLogUpdate((payload) => {
      if (!readModel) return;
      const next = applyAppLogLiveUpdate({
        current: readModel,
        incomingEntries: payload.entries,
        incomingSummary: payload.summary,
        liveMode,
        bottomPinned,
        filters: { level: levelFilter, source: sourceFilter, query },
        currentNewLogsWhileAway: newLogsWhileAway,
        maxLoaded: LOG_MAX_LOADED,
      });
      readModel = next.readModel;
      newLogsWhileAway = next.newLogsWhileAway;
    });
    unsubscribeRuntime = runtime.subscribe(() => {
      syncRuntimeSnapshot();
      if (runtime.paneLayout.focusedPanelId === panelId) {
        void markReadThroughLatest();
      }
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
      for (const node of listElement?.querySelectorAll<HTMLDivElement>(".log-row[data-index]") ?? []) {
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
      followOnAppend: liveMode === "live" && bottomPinned ? "auto" : false,
    });
  });

  $effect(() => {
    void levelFilter;
    void sourceFilter;
    void query;
    untrack(() => {
      void loadLogs({ forceTail: liveMode === "live" && bottomPinned });
    });
  });

  $effect(() => {
    void expandedIds;
    void measureVisibleLogRows();
  });
</script>

<section class="app-logs-pane" aria-label="App logs">
  <PaneHeader
    eyebrow="App Logs"
    title={readModel ? `${readModel.summary.totals.total} entries` : "Loading logs"}
    subtitle={readModel ? `Latest #${readModel.summary.latestSeq} · seen #${readModel.summary.seenSeq}` : "Structured product observability"}
  >
    {#snippet actions()}
      <Tooltip label={liveMode === "live" ? "Freeze log updates" : "Resume live log updates"}>
        <Button
          size="sm"
          variant={liveMode === "live" ? "primary" : "secondary"}
          aria-pressed={liveMode === "live"}
          aria-label={liveMode === "live" ? "Freeze log updates" : "Resume live log updates"}
          onclick={toggleLiveMode}
        >
          {#if liveMode === "live"}
            <RadioIcon aria-hidden="true" size={14} />
            Live
          {:else}
            <PauseIcon aria-hidden="true" size={14} />
            Frozen
          {/if}
        </Button>
      </Tooltip>
      <Tooltip label="Refresh logs">
        <Button size="sm" variant="ghost" iconOnly aria-label="Refresh logs" onclick={() => loadLogs()}>
          <RefreshCwIcon aria-hidden="true" size={14} />
        </Button>
      </Tooltip>
      <Button size="sm" onclick={markReadThroughLatest}>Mark all read</Button>
      <Tooltip label="Copy all logs">
        <Button size="sm" variant="ghost" iconOnly aria-label="Copy all logs" onclick={requestCopyAllLogs}>
          {#if copiedTarget === "all"}
            <CheckIcon aria-hidden="true" size={14} />
          {:else}
            <CopyIcon aria-hidden="true" size={14} />
          {/if}
        </Button>
      </Tooltip>
    {/snippet}
  </PaneHeader>

  <div class="logs-toolbar">
    <PaneFilterTabs
      label="Severity"
      value={levelFilter}
      options={levelFilterOptions}
      showDots
      aria-label="Severity filters"
      onSelect={(value) => (levelFilter = value as typeof levelFilter)}
    />
    <Input bind:value={query} placeholder="Search message, source, id" aria-label="Search app logs" />
    <CompactSelect
      value={sourceFilter}
      options={sourceFilterOptions}
      ariaLabel="Filter app logs by source"
      triggerClass="logs-source-select"
      menuClass="logs-source-menu"
      placement="below"
      onSelect={(value) => (sourceFilter = value as typeof sourceFilter)}
    />
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
                  class:expanded={expandedIds.has(entry.id)}
                  class={`log-row level-${entry.level}`.trim()}
                  role="button"
                  tabindex="0"
                  aria-expanded={expandedIds.has(entry.id)}
                  onclick={() => toggleLogRow(entry)}
                  onkeydown={(event) => handleLogRowKeydown(event, entry)}
                >
                  <div class="row-main">
                    <span class="expand-indicator" aria-hidden="true">
                      {#if expandedIds.has(entry.id)}
                        <ChevronDownIcon size={14} />
                      {:else}
                        <ChevronRightIcon size={14} />
                      {/if}
                    </span>
                    <span class="row-copy">
                      <span class="row-title">
                        <Badge tone={levelTone(entry.level)}>{entry.level}</Badge>
                        <code>{entry.source}</code>
                        <strong>{entry.message}</strong>
                      </span>
                      {#if relatedIds(entry).length > 0}
                        <span class="related-chips">
                            {#each relatedIds(entry) as related (`${entry.id}:${related.label}`)}
                            {#if related.action}
                              <button type="button" onclick={(event) => { event.stopPropagation(); void openRelated(entry, related); }}>
                                <MetadataChip label={related.label} value={related.value} tone="accent" />
                              </button>
                            {:else}
                              <MetadataChip label={related.label} value={related.value} />
                            {/if}
                          {/each}
                        </span>
                      {/if}
                    </span>
                    <span class="row-meta"><time>{formatTime(entry.createdAt)}</time><code>#{entry.seq}</code></span>
                  </div>
                  <Tooltip label="Copy log entry" side="left">
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
                  </Tooltip>
                  {#if expandedIds.has(entry.id)}
                    <div class="row-details">
                      <dl class="row-detail-facts">
                        <dt>Sequence</dt><dd>#{entry.seq}</dd>
                        <dt>Created</dt><dd>{entry.createdAt}</dd>
                        {#each relatedIds(entry) as related (`expanded:${entry.id}:${related.label}`)}
                          <dt>{related.label}</dt><dd><code>{related.value}</code></dd>
                        {/each}
                      </dl>
                      {#if entry.details}
                        <pre>{JSON.stringify(entry.details, null, 2)}</pre>
                      {/if}
                      {#if entry.error}
                        <pre class="error-block">{JSON.stringify(entry.error, null, 2)}</pre>
                      {/if}
                      {#if !entry.details && !entry.error && relatedIds(entry).length === 0}
                        <span>No extra details.</span>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
          </div>
        </div>
        {#if newLogsWhileAway > 0}
          <button type="button" class="new-logs-button" onclick={() => setLiveMode(true)}>
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
    grid-template-rows: auto auto minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    background: var(--ui-panel);
    color: var(--ui-text-primary);
  }

  .logs-toolbar {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
    padding: 0.58rem 0.78rem;
    border-bottom: 1px solid var(--ui-border-soft);
  }

  .logs-message,
  .logs-empty {
    margin: 0;
  }

  .header-actions,
  .related-chips {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .logs-toolbar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) minmax(7rem, 12rem);
  }

  :global(.logs-source-select) {
    width: 100%;
    min-height: 1.95rem;
    justify-content: space-between;
    border-color: var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-surface-raised) 74%, transparent);
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
    padding: 0.5rem;
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

  .log-row {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    width: 100%;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    cursor: pointer;
    transition:
      border-color 150ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 150ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .log-row:hover {
    border-color: color-mix(in oklab, var(--ui-border-strong) 45%, transparent);
    background: color-mix(in oklab, var(--ui-surface-subtle) 62%, transparent);
  }

  .row-main {
    display: grid;
    grid-template-columns: 0.9rem minmax(0, 1fr) auto;
    gap: 0.4rem;
    width: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    padding: 0.42rem;
  }

  .log-row:focus-visible,
  .new-logs-button:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .expand-indicator {
    display: grid;
    place-items: center;
    color: var(--ui-text-tertiary);
  }

  .row-copy {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }

  .row-title {
    display: flex;
    align-items: center;
    gap: 0.38rem;
    min-width: 0;
  }

  .row-title strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
  }

  code,
  .row-meta,
  .related-chips {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  code {
    color: var(--ui-text-tertiary);
  }

  .related-chips {
    flex-wrap: wrap;
    color: var(--ui-text-tertiary);
  }

  .related-chips button {
    max-width: 15rem;
    padding: 0;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .related-chips button:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .related-chips code,
  dd code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-meta {
    display: grid;
    justify-items: end;
    gap: 0.2rem;
    color: var(--ui-text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  .row-copy-button {
    align-self: start;
    margin-top: 0.32rem;
    margin-right: 0.28rem;
  }

  .row-details {
    grid-column: 1 / -1;
    display: grid;
    gap: 0.4rem;
    cursor: auto;
    padding: 0 0.48rem 0.48rem 2.9rem;
  }

  .row-detail-facts {
    grid-template-columns: 4.5rem minmax(0, 1fr);
    padding: 0.46rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface) 62%, transparent);
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
    .logs-toolbar {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
