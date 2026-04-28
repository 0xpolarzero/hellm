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
        <div class="workflow-inspector-frame-strip">
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
        <div class="workflow-tree-rows" tabindex="0" role="tree" onkeydown={handleTreeKeydown}>
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
            {#if selectedNode.task?.workflowTaskAttemptId}<span>{selectedNode.task.workflowTaskAttemptId}</span>{/if}
            {#if selectedNode.projectCi}<span>{selectedNode.projectCi.checkId}</span>{/if}
          </div>
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
