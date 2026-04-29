<script lang="ts">
  import { onMount } from "svelte";
  import SearchIcon from "@lucide/svelte/icons/search";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import type {
    WorkspaceWorkflowInspectorMode,
    WorkspaceWorkflowInspectorNode,
    WorkspaceWorkflowInspectorReadModel,
    WorkspaceWorkflowInspectorRelatedSurfaceTarget,
  } from "../shared/workspace-contract";
  import type { ChatRuntime } from "./chat-runtime";
  import Badge from "./ui/Badge.svelte";
  import Button from "./ui/Button.svelte";

  type Props = {
    runtime: ChatRuntime;
    sessionId: string;
    workflowRunId: string;
    paneId: string;
  };

  let { runtime, sessionId, workflowRunId, paneId }: Props = $props();

  let inspector = $state<WorkspaceWorkflowInspectorReadModel | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let selectedNodeKey = $state<string | null>(null);
  let expandedNodeKeys = $state<string[]>([]);
  let userCollapsedNodeKeys = $state<string[]>([]);
  let searchQuery = $state("");
  let mode = $state<WorkspaceWorkflowInspectorMode>({ kind: "live" });
  let liveSeq = $state<number | null>(null);
  let activeTab = $state<WorkspaceWorkflowInspectorReadModel["detailTabs"][number]["id"]>("output");
  let searchInput = $state<HTMLInputElement | null>(null);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const nodesByKey = $derived(new Map((inspector?.tree.nodes ?? []).map((node) => [node.key, node])));
  const selectedNode = $derived(inspector?.selectedNode ?? null);
  const visibleNodes = $derived(
    (inspector?.tree.visibleNodeKeys ?? [])
      .map((key) => nodesByKey.get(key))
      .filter((node): node is WorkspaceWorkflowInspectorNode => Boolean(node)),
  );
  const activeTabs = $derived((inspector?.detailTabs ?? []).filter((tab) => !tab.empty || tab.id === "raw"));

  onMount(() => {
    void loadInspector();
    return () => {
      if (pollTimer) clearTimeout(pollTimer);
    };
  });

  async function loadInspector(): Promise<void> {
    loading = !inspector;
    error = null;
    try {
      const next = await runtime.getWorkflowInspector(workflowRunId, {
        sessionId,
        selectedNodeKey,
        expandedNodeKeys,
        userCollapsedNodeKeys,
        searchQuery,
        mode,
      });
      inspector = next;
      selectedNodeKey = next.selectedNodeKey;
      expandedNodeKeys = next.expandedNodeKeys;
      if (!next.detailTabs.some((tab) => tab.id === activeTab && !tab.empty)) {
        activeTab = next.detailTabs.find((tab) => !tab.empty)?.id ?? "raw";
      }
      scheduleLivePoll(next);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Unable to load workflow inspector.";
    } finally {
      loading = false;
    }
  }

  function scheduleLivePoll(next: WorkspaceWorkflowInspectorReadModel): void {
    if (pollTimer) clearTimeout(pollTimer);
    if (next.mode.kind !== "live") return;
    if (["completed", "failed", "cancelled", "continued"].includes(next.runHeader.svvyStatus)) return;
    pollTimer = setTimeout(() => void streamInspector(), 100);
  }

  async function streamInspector(): Promise<void> {
    if (mode.kind !== "live") return;
    try {
      const update = await runtime.streamWorkflowInspector(workflowRunId, {
        sessionId,
        selectedNodeKey,
        expandedNodeKeys,
        userCollapsedNodeKeys,
        searchQuery,
        mode,
        fromSeq: liveSeq,
      });
      inspector = update.inspector;
      liveSeq = update.lastSeq ?? update.inspector.runHeader.lastSeq ?? liveSeq;
      selectedNodeKey = update.inspector.selectedNodeKey;
      expandedNodeKeys = update.inspector.expandedNodeKeys;
      scheduleLivePoll(update.inspector);
    } catch {
      pollTimer = setTimeout(() => void loadInspector(), 1500);
    }
  }

  function selectNode(key: string): void {
    selectedNodeKey = key;
    void loadInspector();
  }

  function toggleNode(node: WorkspaceWorkflowInspectorNode): void {
    const expanded = new Set(expandedNodeKeys);
    const collapsed = new Set(userCollapsedNodeKeys);
    if (expanded.has(node.key)) {
      expanded.delete(node.key);
      collapsed.add(node.key);
    } else {
      expanded.add(node.key);
      collapsed.delete(node.key);
    }
    expandedNodeKeys = [...expanded];
    userCollapsedNodeKeys = [...collapsed];
    void loadInspector();
  }

  function handleTreeKeydown(event: KeyboardEvent): void {
    const keys = visibleNodes.map((node) => node.key);
    const index = selectedNodeKey ? keys.indexOf(selectedNodeKey) : -1;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      searchInput?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedNodeKey = keys[Math.min(keys.length - 1, Math.max(0, index + 1))] ?? null;
      void loadInspector();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedNodeKey = keys[Math.max(0, index - 1)] ?? null;
      void loadInspector();
    } else if (event.key === "Home") {
      event.preventDefault();
      selectedNodeKey = keys[0] ?? null;
      void loadInspector();
    } else if (event.key === "End") {
      event.preventDefault();
      selectedNodeKey = keys.at(-1) ?? null;
      void loadInspector();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (searchQuery) searchQuery = "";
      else selectedNodeKey = null;
      void loadInspector();
    } else if (event.key === "ArrowLeft" && selectedNode) {
      event.preventDefault();
      if (expandedNodeKeys.includes(selectedNode.key)) {
        expandedNodeKeys = expandedNodeKeys.filter((key) => key !== selectedNode.key);
        userCollapsedNodeKeys = [...new Set([...userCollapsedNodeKeys, selectedNode.key])];
      } else {
        selectedNodeKey = selectedNode.parentKey;
      }
      void loadInspector();
    } else if (event.key === "ArrowRight" && selectedNode) {
      event.preventDefault();
      const hasChildren = inspector?.tree.nodes.some((node) => node.parentKey === selectedNode.key);
      if (hasChildren && !expandedNodeKeys.includes(selectedNode.key)) {
        expandedNodeKeys = [...expandedNodeKeys, selectedNode.key];
        userCollapsedNodeKeys = userCollapsedNodeKeys.filter((key) => key !== selectedNode.key);
        void loadInspector();
      }
    } else if (event.key === "Enter" && selectedNode) {
      event.preventDefault();
      activeTab = inspector?.detailTabs.find((tab) => !tab.empty)?.id ?? "raw";
    }
  }

  function depthFor(node: WorkspaceWorkflowInspectorNode): number {
    let depth = 0;
    let parent = node.parentKey;
    while (parent) {
      depth += 1;
      parent = nodesByKey.get(parent)?.parentKey ?? null;
    }
    return depth;
  }

  function hasChildren(node: WorkspaceWorkflowInspectorNode): boolean {
    return inspector?.tree.nodes.some((candidate) => candidate.parentKey === node.key) ?? false;
  }

  function formatContent(content: unknown): string {
    if (content == null) return "";
    if (typeof content === "string") return content;
    return JSON.stringify(content, null, 2);
  }

  function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
    if (status === "completed" || status === "passed") return "success";
    if (status === "running" || status === "waiting" || status === "retrying") return "warning";
    if (status === "failed" || status === "cancelled") return "danger";
    return "neutral";
  }

  function openRelated(target: WorkspaceWorkflowInspectorRelatedSurfaceTarget): void {
    if (target.kind === "handler-thread") {
      const thread = inspector?.owningThreadId === target.threadId ? inspector.runHeader.owningHandlerThreadTitle : target.threadId;
      void runtime
        .listHandlerThreads(sessionId)
        .then((threads) => threads.find((candidate) => candidate.threadId === target.threadId))
        .then((summary) => {
          if (!summary) throw new Error(`Handler thread not found: ${thread}`);
          return runtime.openSurface(
            {
              workspaceSessionId: sessionId,
              surface: "thread",
              surfacePiSessionId: summary.surfacePiSessionId,
              threadId: summary.threadId,
            },
            { kind: "split", paneId, direction: "right" },
          );
        });
    } else if (target.kind === "task-agent") {
      void runtime.openSurface(
        {
          workspaceSessionId: sessionId,
          surface: "workflow-task-attempt",
          workflowTaskAttemptId: target.workflowTaskAttemptId,
        },
        { kind: "split", paneId, direction: "right" },
      );
    } else if (target.kind === "command") {
      void runtime.openSurface(
        { workspaceSessionId: sessionId, surface: "command", commandId: target.commandId },
        { kind: "split", paneId, direction: "right" },
      );
    } else if (target.kind === "artifact") {
      void runtime.openSurface(
        { workspaceSessionId: sessionId, surface: "artifact", artifactId: target.artifactId },
        { kind: "split", paneId, direction: "right" },
      );
    } else if (target.kind === "project-ci-check") {
      void runtime.openSurface(
        {
          workspaceSessionId: sessionId,
          surface: "project-ci-check",
          checkResultId: target.checkResultId,
        },
        { kind: "split", paneId, direction: "right" },
      );
    }
  }
</script>

<section class="workflow-inspector" aria-label="Workflow inspector">
  {#if error}
    <div class="workflow-inspector-error">{error}</div>
  {:else if inspector}
    <header class="workflow-inspector-header">
      <div>
        <p>Workflow Inspector</p>
        <h3>{inspector.runHeader.workflowLabel}</h3>
      </div>
      <div class="workflow-inspector-header-meta">
        <Badge tone={statusTone(inspector.runHeader.svvyStatus)}>{inspector.runHeader.svvyStatus}</Badge>
        <span>{inspector.runHeader.smithersStatus}</span>
        <code>{inspector.runHeader.runId}</code>
        <span>{inspector.runHeader.owningHandlerThreadTitle}</span>
        {#if inspector.mode.kind === "historical"}
          <Button variant="ghost" size="sm" onclick={() => { mode = { kind: "live" }; void loadInspector(); }}>
            Return live
          </Button>
        {/if}
        <Button variant="ghost" size="sm" onclick={() => void loadInspector()} disabled={loading}>
          Refresh
        </Button>
      </div>
    </header>

    <div class="workflow-inspector-body">
      <aside class="workflow-inspector-tree">
        <label class="workflow-inspector-search">
          <SearchIcon aria-hidden="true" size={14} />
          <input
            bind:this={searchInput}
            bind:value={searchQuery}
            placeholder="Search nodes"
            oninput={() => void loadInspector()}
          />
        </label>
        <div class="workflow-inspector-frame-strip" aria-label="Workflow frames">
          {#each inspector.frames.slice(0, 18) as frame (frame.frameNo)}
            <button
              type="button"
              class:active={inspector.mode.kind === "historical" && inspector.mode.frameNo === frame.frameNo}
              onclick={() => { mode = { kind: "historical", frameNo: frame.frameNo }; void loadInspector(); }}
            >
              {frame.frameNo}
            </button>
          {/each}
        </div>
        <div
          class="workflow-tree-rows"
          tabindex="0"
          role="tree"
          aria-label="Workflow node tree"
          onkeydown={handleTreeKeydown}
        >
          {#each visibleNodes as node (node.key)}
            <div
              role="treeitem"
              tabindex="-1"
              aria-selected={node.key === selectedNodeKey}
              class={`workflow-tree-row ${node.key === selectedNodeKey ? "selected" : ""} status-${node.status}`.trim()}
              style={`--depth: ${depthFor(node)}`}
              onclick={() => selectNode(node.key)}
              onkeydown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectNode(node.key);
                }
              }}
            >
              <span class="workflow-tree-twist">
                {#if hasChildren(node)}
                  <button
                    type="button"
                    class="workflow-tree-toggle"
                    aria-label={expandedNodeKeys.includes(node.key) ? "Collapse node" : "Expand node"}
                    onclick={(event) => { event.stopPropagation(); toggleNode(node); }}
                  >
                    {#if expandedNodeKeys.includes(node.key)}
                      <ChevronDownIcon size={13} />
                    {:else}
                      <ChevronRightIcon size={13} />
                    {/if}
                  </button>
                {/if}
              </span>
              <span class="workflow-tree-status-dot" aria-hidden="true"></span>
              <span class="workflow-tree-type">{node.type}</span>
              <span class="workflow-tree-label">{node.label}</span>
              {#if node.latestActivity}
                <span class="workflow-tree-preview">{node.latestActivity}</span>
              {/if}
              {#if node.hasFailedDescendant}<span class="workflow-descendant failed">failed</span>{/if}
              {#if node.hasWaitingDescendant}<span class="workflow-descendant waiting">waiting</span>{/if}
              <Badge tone={statusTone(node.status)}>{node.status}</Badge>
            </div>
          {/each}
        </div>
      </aside>

      <section class="workflow-node-inspector">
        {#if selectedNode}
          <header class="workflow-node-header">
            <div>
              <p>{selectedNode.type}</p>
              <h4>{selectedNode.label}</h4>
            </div>
            <Badge tone={statusTone(selectedNode.status)}>{selectedNode.status}</Badge>
          </header>
          <div class="workflow-node-meta">
            <span>{selectedNode.smithersNodeId ?? "run root"}</span>
            {#if selectedNode.detail.worktree}<span>{selectedNode.detail.worktree}</span>{/if}
            {#if selectedNode.task?.workflowTaskAttemptId}<span>{selectedNode.task.workflowTaskAttemptId}</span>{/if}
            {#if selectedNode.projectCi}<span>{selectedNode.projectCi.checkId}</span>{/if}
          </div>
          {#if selectedNode.detail.latestOutput || selectedNode.detail.partialOutput || selectedNode.waitReason}
            <div class="workflow-node-output">
              {#if selectedNode.waitReason}
                <p class="workflow-node-wait">{selectedNode.waitReason}</p>
              {/if}
              {#if selectedNode.detail.latestOutput}
                <p>{selectedNode.detail.latestOutput}</p>
              {:else if selectedNode.detail.partialOutput}
                <p>{selectedNode.detail.partialOutput}</p>
              {/if}
            </div>
          {/if}
          <div class="workflow-node-related">
            {#each selectedNode.relatedSurfaceTargets as target}
              <Button variant="ghost" size="sm" onclick={() => openRelated(target)}>
                Open {target.kind}
              </Button>
            {/each}
          </div>
          <div class="workflow-node-props">
            <pre>{formatContent({ detail: selectedNode.detail, props: selectedNode.props, launchArguments: selectedNode.launchArguments, task: selectedNode.task, projectCi: selectedNode.projectCi })}</pre>
          </div>
          <div class="workflow-node-tabs">
            {#each activeTabs as tab (tab.id)}
              <button type="button" class:active={activeTab === tab.id} onclick={() => (activeTab = tab.id)}>
                {tab.label}
              </button>
            {/each}
          </div>
          {#each activeTabs as tab (tab.id)}
            {#if activeTab === tab.id}
              <pre class="workflow-node-tab-content">{formatContent(tab.content)}</pre>
            {/if}
          {/each}
        {:else}
          <div class="workflow-inspector-empty">Select a workflow node.</div>
        {/if}
      </section>
    </div>
  {:else}
    <div class="workflow-inspector-empty">Loading workflow inspector...</div>
  {/if}
</section>

<style>
  .workflow-inspector {
    container-type: inline-size;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    height: 100%;
    background: var(--ui-surface);
    color: var(--ui-text-primary);
  }

  .workflow-inspector-header,
  .workflow-node-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.85rem;
    min-width: 0;
  }

  .workflow-inspector-header {
    padding: 0.78rem 0.9rem;
    border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
    background: color-mix(in oklab, var(--ui-surface-subtle) 88%, transparent);
  }

  .workflow-inspector-header p,
  .workflow-node-header p {
    margin: 0 0 0.18rem;
    color: var(--ui-text-secondary);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    text-transform: uppercase;
  }

  .workflow-inspector-header h3,
  .workflow-node-header h4 {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 0.92rem;
    line-height: 1.22;
    font-weight: 660;
  }

  .workflow-inspector-header-meta,
  .workflow-node-meta,
  .workflow-node-related,
  .workflow-node-tabs {
    display: flex;
    align-items: center;
    gap: 0.42rem;
    flex-wrap: wrap;
    justify-content: flex-end;
    min-width: 0;
  }

  .workflow-inspector-header-meta span,
  .workflow-inspector-header-meta code,
  .workflow-node-meta span {
    min-width: 0;
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.66rem;
  }

  .workflow-inspector-body {
    display: grid;
    grid-template-columns: minmax(18rem, 0.82fr) minmax(0, 1.18fr);
    min-height: 0;
  }

  .workflow-inspector-tree,
  .workflow-node-inspector {
    min-height: 0;
    overflow: auto;
  }

  .workflow-inspector-tree {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 0.58rem;
    padding: 0.72rem;
    border-right: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
    background: color-mix(in oklab, var(--ui-surface-subtle) 78%, transparent);
  }

  .workflow-inspector-search {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    padding: 0.42rem 0.54rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface) 88%, transparent);
    color: var(--ui-text-tertiary);
  }

  .workflow-inspector-search:focus-within {
    border-color: color-mix(in oklab, var(--ui-border-accent) 78%, var(--ui-border-soft));
    box-shadow: var(--ui-focus-ring);
  }

  .workflow-inspector-search input {
    min-width: 0;
    width: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--ui-text-primary);
    font: inherit;
    font-size: 0.76rem;
  }

  .workflow-inspector-frame-strip {
    display: flex;
    gap: 0.28rem;
    min-width: 0;
    overflow-x: auto;
    padding-bottom: 0.08rem;
  }

  .workflow-inspector-frame-strip button,
  .workflow-node-tabs button {
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-raised) 78%, transparent);
    color: var(--ui-text-secondary);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.66rem;
  }

  .workflow-inspector-frame-strip button {
    min-width: 2rem;
    min-height: 1.55rem;
    padding: 0 0.4rem;
  }

  .workflow-inspector-frame-strip button.active,
  .workflow-node-tabs button.active {
    border-color: color-mix(in oklab, var(--ui-border-accent) 74%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-accent-soft) 64%, var(--ui-surface-raised));
    color: var(--ui-text-primary);
  }

  .workflow-tree-rows {
    display: grid;
    align-content: start;
    gap: 0.24rem;
    min-height: 0;
    overflow: auto;
  }

  .workflow-tree-rows:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .workflow-tree-row {
    display: grid;
    grid-template-columns: 1.1rem 0.5rem auto minmax(6rem, 1fr) auto auto auto;
    align-items: center;
    gap: 0.38rem;
    min-width: 0;
    min-height: 2.2rem;
    padding: 0.38rem 0.42rem 0.38rem calc(0.42rem + var(--depth) * 0.85rem);
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    cursor: pointer;
    color: var(--ui-text-secondary);
    transition:
      border-color 160ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 160ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .workflow-tree-row:hover,
  .workflow-tree-row.selected {
    border-color: color-mix(in oklab, var(--ui-border-strong) 72%, transparent);
    background: color-mix(in oklab, var(--ui-surface-raised) 84%, transparent);
  }

  .workflow-tree-row.selected {
    border-color: color-mix(in oklab, var(--ui-border-accent) 72%, var(--ui-border-soft));
    box-shadow: inset 2px 0 0 var(--ui-accent);
  }

  .workflow-tree-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    border: 0;
    border-radius: var(--ui-radius-sm);
    background: transparent;
    color: var(--ui-text-tertiary);
    cursor: pointer;
  }

  .workflow-tree-toggle:hover {
    background: color-mix(in oklab, var(--ui-surface-subtle) 86%, transparent);
    color: var(--ui-text-primary);
  }

  .workflow-tree-status-dot {
    width: 0.42rem;
    height: 0.42rem;
    border-radius: 999px;
    background: var(--ui-text-tertiary);
  }

  .status-completed .workflow-tree-status-dot,
  .status-passed .workflow-tree-status-dot {
    background: var(--ui-success);
  }

  .status-running .workflow-tree-status-dot,
  .status-retrying .workflow-tree-status-dot {
    background: var(--ui-warning);
    animation: workflow-pulse 1.5s ease-in-out infinite;
  }

  .status-waiting .workflow-tree-status-dot {
    background: var(--ui-warning);
  }

  .status-failed .workflow-tree-status-dot,
  .status-cancelled .workflow-tree-status-dot {
    background: var(--ui-danger);
  }

  .workflow-tree-type,
  .workflow-descendant {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.62rem;
    text-transform: uppercase;
  }

  .workflow-tree-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-primary);
    font-size: 0.76rem;
    font-weight: 610;
  }

  .workflow-tree-preview {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-tertiary);
    font-size: 0.68rem;
  }

  .workflow-descendant {
    padding: 0.1rem 0.32rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-surface-muted) 80%, transparent);
  }

  .workflow-descendant.failed {
    color: color-mix(in oklab, var(--ui-danger) 84%, var(--ui-text-primary));
  }

  .workflow-descendant.waiting {
    color: color-mix(in oklab, var(--ui-warning) 84%, var(--ui-text-primary));
  }

  .workflow-node-inspector {
    display: grid;
    align-content: start;
    gap: 0.74rem;
    padding: 0.84rem;
  }

  .workflow-node-header,
  .workflow-node-output,
  .workflow-node-props,
  .workflow-node-tab-content {
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface-subtle) 74%, transparent);
  }

  .workflow-node-header,
  .workflow-node-output {
    padding: 0.78rem 0.84rem;
  }

  .workflow-node-meta {
    justify-content: flex-start;
  }

  .workflow-node-meta span {
    max-width: 100%;
    padding: 0.14rem 0.42rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-surface-subtle) 82%, transparent);
  }

  .workflow-node-output {
    display: grid;
    gap: 0.36rem;
    color: var(--ui-text-primary);
    font-size: 0.76rem;
    line-height: 1.55;
  }

  .workflow-node-output p {
    margin: 0;
  }

  .workflow-node-wait {
    color: color-mix(in oklab, var(--ui-warning) 84%, var(--ui-text-primary));
  }

  .workflow-node-related {
    justify-content: flex-start;
  }

  .workflow-node-props pre,
  .workflow-node-tab-content {
    margin: 0;
    max-height: 22rem;
    overflow: auto;
    padding: 0.76rem 0.82rem;
    background: color-mix(in oklab, var(--ui-code) 94%, transparent);
    color: var(--ui-text-primary);
    font-family: var(--font-mono);
    font-size: 0.7rem;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .workflow-node-tabs {
    justify-content: flex-start;
    padding-top: 0.12rem;
  }

  .workflow-node-tabs button {
    min-height: 1.7rem;
    padding: 0.18rem 0.54rem;
  }

  .workflow-inspector-error,
  .workflow-inspector-empty {
    margin: 0.9rem;
    padding: 0.9rem;
    border: 1px dashed color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface-subtle) 72%, transparent);
    color: var(--ui-text-secondary);
    font-size: 0.76rem;
  }

  .workflow-inspector-error {
    border-color: color-mix(in oklab, var(--ui-danger) 32%, transparent);
    color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
  }

  @keyframes workflow-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in oklab, var(--ui-warning) 38%, transparent);
    }
    50% {
      box-shadow: 0 0 0 0.28rem color-mix(in oklab, var(--ui-warning) 0%, transparent);
    }
  }

  @container (max-width: 48rem) {
    .workflow-inspector-body {
      grid-template-columns: 1fr;
    }

    .workflow-inspector-tree {
      max-height: 42vh;
      border-right: 0;
      border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
    }

    .workflow-tree-row {
      grid-template-columns: 1.1rem 0.5rem auto minmax(4rem, 1fr) auto;
    }

    .workflow-tree-preview,
    .workflow-descendant {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .workflow-tree-status-dot {
      animation: none;
    }
  }
</style>
