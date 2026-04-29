<script lang="ts">
  import BotIcon from "@lucide/svelte/icons/bot";
  import CheckCircle2Icon from "@lucide/svelte/icons/check-circle-2";
  import ClockIcon from "@lucide/svelte/icons/clock";
  import FlagIcon from "@lucide/svelte/icons/flag";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import ShieldIcon from "@lucide/svelte/icons/shield";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import ZapIcon from "@lucide/svelte/icons/zap";
  import type { WorkspaceWorkflowInspectorNode } from "../shared/workspace-contract";

  type Props = {
    nodes: WorkspaceWorkflowInspectorNode[];
    selectedNodeKey: string | null;
    onSelect: (key: string) => void;
  };

  type PositionedNode = WorkspaceWorkflowInspectorNode & {
    x: number;
    y: number;
  };

  const NODE_W = 150;
  const NODE_H = 52;
  const COLUMN_GAP = 62;
  const ROW_GAP = 42;

  let { nodes, selectedNodeKey, onSelect }: Props = $props();

  const positionedNodes = $derived.by(() => layoutNodes(nodes));
  const graphWidth = $derived(Math.max(420, ...positionedNodes.map((node) => node.x + NODE_W + 24)));
  const graphHeight = $derived(Math.max(260, ...positionedNodes.map((node) => node.y + NODE_H + 24)));
  const nodeByKey = $derived(new Map(positionedNodes.map((node) => [node.key, node])));
  const edges = $derived(
    positionedNodes
      .map((node) => {
        const parent = node.parentKey ? nodeByKey.get(node.parentKey) : null;
        return parent ? { from: parent, to: node } : null;
      })
      .filter((edge): edge is { from: PositionedNode; to: PositionedNode } => Boolean(edge)),
  );

  function layoutNodes(input: WorkspaceWorkflowInspectorNode[]): PositionedNode[] {
    const childrenByParent = new Map<string | null, WorkspaceWorkflowInspectorNode[]>();
    for (const node of input) {
      const siblings = childrenByParent.get(node.parentKey) ?? [];
      siblings.push(node);
      childrenByParent.set(node.parentKey, siblings);
    }

    const positioned = new Map<string, PositionedNode>();
    let nextRow = 0;

    function place(node: WorkspaceWorkflowInspectorNode, depth: number): number {
      const children = childrenByParent.get(node.key) ?? [];
      const childRows = children.map((child) => place(child, depth + 1));
      const row = childRows.length
        ? (Math.min(...childRows) + Math.max(...childRows)) / 2
        : nextRow++;
      positioned.set(node.key, {
        ...node,
        x: 18 + depth * (NODE_W + COLUMN_GAP),
        y: 18 + row * (NODE_H + ROW_GAP),
      });
      return row;
    }

    const roots = childrenByParent.get(null) ?? input.filter((node) => !node.parentKey);
    for (const root of roots) place(root, 0);

    return input.map((node) => positioned.get(node.key)).filter((node): node is PositionedNode => Boolean(node));
  }

  function typeLabel(type: WorkspaceWorkflowInspectorNode["type"]): string {
    if (type === "task-agent") return "agent";
    if (type === "project-ci-check") return "verify";
    if (type === "terminal-result") return "terminal";
    return type.replace(/-/g, " ");
  }

  function formatElapsed(ms: number | null): string | null {
    if (ms == null) return null;
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  }

  function edgeClass(status: WorkspaceWorkflowInspectorNode["status"]): string {
    if (status === "completed") return "done";
    if (status === "running" || status === "retrying") return "active";
    if (status === "failed" || status === "cancelled") return "failed";
    if (status === "waiting") return "waiting";
    return "pending";
  }
</script>

<div class="workflow-graph" data-testid="workflow-graph">
  <div class="workflow-graph-canvas">
    <div class="workflow-graph-inner" style={`width: ${graphWidth}px; height: ${graphHeight}px`}>
      <svg class="workflow-graph-edges" width={graphWidth} height={graphHeight} aria-hidden="true">
        {#each edges as edge (`${edge.from.key}-${edge.to.key}`)}
          {@const x1 = edge.from.x + NODE_W / 2}
          {@const y1 = edge.from.y + NODE_H}
          {@const x2 = edge.to.x + NODE_W / 2}
          {@const y2 = edge.to.y}
          {@const curve = Math.max(34, Math.abs(y2 - y1) * 0.45)}
          <path
            class={`workflow-edge ${edgeClass(edge.from.status)}`}
            d={`M ${x1} ${y1} C ${x1} ${y1 + curve}, ${x2} ${y2 - curve}, ${x2} ${y2}`}
          />
        {/each}
      </svg>

      {#each positionedNodes as node (node.key)}
        {@const elapsed = formatElapsed(node.timing.elapsedMs)}
        <button
          type="button"
          class={`workflow-graph-node type-${node.type} status-${node.status} ${node.key === selectedNodeKey ? "selected" : ""}`.trim()}
          style={`left: ${node.x}px; top: ${node.y}px; width: ${NODE_W}px; height: ${NODE_H}px`}
          aria-pressed={node.key === selectedNodeKey}
          onclick={() => onSelect(node.key)}
        >
          <span class="workflow-graph-icon" aria-hidden="true">
            {#if node.type === "task-agent"}
              <BotIcon size={14} />
            {:else if node.type === "script"}
              <TerminalIcon size={14} />
            {:else if node.type === "project-ci-check"}
              <CheckCircle2Icon size={14} />
            {:else if node.type === "wait" || node.type === "approval"}
              <ClockIcon size={14} />
            {:else if node.type === "retry"}
              <RefreshCwIcon size={14} />
            {:else if node.type === "terminal-result"}
              <FlagIcon size={14} />
            {:else if node.type === "conditional"}
              <GitBranchIcon size={14} />
            {:else if node.type === "workflow"}
              <ShieldIcon size={14} />
            {:else}
              <ZapIcon size={14} />
            {/if}
          </span>
          <span class="workflow-graph-node-copy">
            <span class="workflow-graph-label">{node.label}</span>
            <span class="workflow-graph-status">
              {#if node.status === "running" || node.status === "retrying"}
                <span class="workflow-graph-pulse" aria-hidden="true"></span>
              {/if}
              {node.status}
            </span>
          </span>
          {#if elapsed}
            <span class="workflow-graph-elapsed">{elapsed}</span>
          {/if}
          <span class="workflow-graph-type">{typeLabel(node.type)}</span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .workflow-graph {
    min-height: 0;
    height: 100%;
    background:
      linear-gradient(color-mix(in oklab, var(--ui-border-soft) 18%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in oklab, var(--ui-border-soft) 18%, transparent) 1px, transparent 1px),
      color-mix(in oklab, var(--ui-surface) 94%, var(--ui-surface-subtle));
    background-size: 24px 24px;
  }

  .workflow-graph-canvas {
    min-height: 0;
    height: 100%;
    overflow: auto;
    padding: 0.85rem;
  }

  .workflow-graph-inner {
    position: relative;
  }

  .workflow-graph-edges {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .workflow-edge {
    fill: none;
    stroke: color-mix(in oklab, var(--ui-text-tertiary) 28%, transparent);
    stroke-width: 1.4;
  }

  .workflow-edge.done {
    stroke: color-mix(in oklab, var(--ui-success) 50%, transparent);
  }

  .workflow-edge.active {
    stroke: color-mix(in oklab, var(--ui-warning) 58%, transparent);
  }

  .workflow-edge.failed {
    stroke: color-mix(in oklab, var(--ui-danger) 54%, transparent);
  }

  .workflow-edge.waiting {
    stroke-dasharray: 4 4;
  }

  .workflow-graph-node {
    position: absolute;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-rows: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.12rem 0.45rem;
    padding: 0.42rem 0.52rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-raised) 82%, transparent);
    color: var(--ui-text-primary);
    cursor: pointer;
    text-align: left;
    transition:
      border-color 140ms cubic-bezier(0.19, 1, 0.22, 1),
      background-color 140ms cubic-bezier(0.19, 1, 0.22, 1),
      transform 140ms cubic-bezier(0.19, 1, 0.22, 1);
  }

  .workflow-graph-node:hover,
  .workflow-graph-node.selected {
    border-color: color-mix(in oklab, var(--ui-border-accent) 72%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-surface-raised) 94%, var(--ui-accent-soft));
  }

  .workflow-graph-node:hover {
    transform: translateY(-1px);
  }

  .workflow-graph-node.selected {
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--ui-border-accent) 44%, transparent),
      0 10px 24px hsl(0 0% 0% / 0.22);
  }

  .workflow-graph-icon {
    grid-row: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.35rem;
    height: 1.35rem;
    color: var(--ui-text-secondary);
  }

  .workflow-graph-node-copy {
    min-width: 0;
  }

  .workflow-graph-label {
    display: block;
    overflow: hidden;
    color: var(--ui-text-primary);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    line-height: 1.18;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workflow-graph-status,
  .workflow-graph-elapsed,
  .workflow-graph-type {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.56rem;
    line-height: 1;
    text-transform: uppercase;
  }

  .workflow-graph-status {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-top: 0.24rem;
  }

  .workflow-graph-elapsed {
    justify-self: end;
    text-transform: none;
  }

  .workflow-graph-type {
    grid-column: 1 / -1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workflow-graph-pulse {
    width: 0.32rem;
    height: 0.32rem;
    border-radius: 999px;
    background: var(--ui-warning);
    animation: workflow-graph-pulse 1.35s ease-in-out infinite;
  }

  .status-completed {
    border-color: color-mix(in oklab, var(--ui-success) 36%, var(--ui-border-soft));
  }

  .status-running,
  .status-retrying {
    border-color: color-mix(in oklab, var(--ui-warning) 58%, var(--ui-border-soft));
  }

  .status-failed,
  .status-cancelled {
    border-color: color-mix(in oklab, var(--ui-danger) 58%, var(--ui-border-soft));
  }

  .status-waiting {
    opacity: 0.72;
  }

  .type-task-agent .workflow-graph-icon {
    color: color-mix(in oklab, var(--ui-info) 72%, var(--ui-text-primary));
  }

  .type-script .workflow-graph-icon {
    color: color-mix(in oklab, var(--ui-accent) 70%, var(--ui-text-primary));
  }

  .type-project-ci-check .workflow-graph-icon,
  .type-terminal-result .workflow-graph-icon {
    color: color-mix(in oklab, var(--ui-success) 74%, var(--ui-text-primary));
  }

  .type-wait .workflow-graph-icon,
  .type-approval .workflow-graph-icon,
  .type-retry .workflow-graph-icon {
    color: color-mix(in oklab, var(--ui-warning) 76%, var(--ui-text-primary));
  }

  @keyframes workflow-graph-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in oklab, var(--ui-warning) 38%, transparent);
    }
    50% {
      box-shadow: 0 0 0 0.26rem color-mix(in oklab, var(--ui-warning) 0%, transparent);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .workflow-graph-node {
      transition: none;
    }

    .workflow-graph-node:hover {
      transform: none;
    }

    .workflow-graph-pulse {
      animation: none;
    }
  }
</style>
