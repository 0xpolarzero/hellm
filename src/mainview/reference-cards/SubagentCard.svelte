<script lang="ts" module>
  import type { ReferenceStatus } from "./StatusBadge.svelte";

  export type ReferenceAgentType =
    | "orchestrator"
    | "handler-thread"
    | "workflow-task-agent"
    | "dumb"
    | "explorer"
    | "implementer"
    | "reviewer"
    | "workflow-writer";

  export type ReferenceSubagent = {
    id: string;
    type: ReferenceAgentType;
    headline: string;
    status: ReferenceStatus;
    model: string;
    tokens?: number;
  };
</script>

<script lang="ts">
  import BotIcon from "@lucide/svelte/icons/bot";
  import Code2Icon from "@lucide/svelte/icons/code-2";
  import EyeIcon from "@lucide/svelte/icons/eye";
  import SearchIcon from "@lucide/svelte/icons/search";
  import WorkflowIcon from "@lucide/svelte/icons/workflow";
  import ZapIcon from "@lucide/svelte/icons/zap";
  import ModelBadge from "./ModelBadge.svelte";
  import StatusBadge from "./StatusBadge.svelte";

  type Props = {
    agent: ReferenceSubagent;
    class?: string;
    expandable?: boolean;
    onclick?: (agent: ReferenceSubagent) => void;
  };

  let { agent, class: className = "", expandable = true, onclick }: Props = $props();

  const agentConfig = {
    orchestrator: { icon: BotIcon, label: "orchestrator", tone: "orange" },
    "handler-thread": { icon: BotIcon, label: "handler", tone: "blue" },
    "workflow-task-agent": { icon: WorkflowIcon, label: "task-agent", tone: "cyan" },
    dumb: { icon: ZapIcon, label: "dumb", tone: "yellow" },
    explorer: { icon: SearchIcon, label: "explorer", tone: "blue" },
    implementer: { icon: Code2Icon, label: "implementer", tone: "purple" },
    reviewer: { icon: EyeIcon, label: "reviewer", tone: "cyan" },
    "workflow-writer": { icon: WorkflowIcon, label: "workflow-writer", tone: "muted" },
  } as const;

  const config = $derived(agentConfig[agent.type] ?? agentConfig["handler-thread"]);
  const Icon = $derived(config.icon);
  const tokenLabel = $derived(agent.tokens ? `${(agent.tokens / 1000).toFixed(1)}k` : null);

  function open() {
    if (!expandable) return;
    onclick?.(agent);
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  }
</script>

<button
  type="button"
  class={`reference-subagent-card ${expandable ? "is-expandable" : ""} tone-${config.tone} ${className}`.trim()}
  aria-disabled={!expandable}
  onclick={open}
  onkeydown={keydown}
  data-testid={`subagent-card-${agent.id}`}
>
  <Icon size={13} strokeWidth={2.1} class="agent-icon" />
  <span class="agent-label">{config.label}</span>
  <span class="agent-headline">{agent.headline}</span>
  <div class="agent-meta">
    <StatusBadge status={agent.status} dotOnly size="xs" />
    {#if tokenLabel}
      <span class="agent-tokens">{tokenLabel}</span>
    {/if}
    <ModelBadge model={agent.model} size="xs" />
    {#if expandable}
      <span class="agent-arrow" aria-hidden="true">-&gt;</span>
    {/if}
  </div>
</button>

<style>
  .reference-subagent-card {
    --agent-color: var(--ui-text-tertiary);
    display: flex;
    align-items: center;
    gap: 0.48rem;
    min-width: 0;
    min-height: 1.85rem;
    padding: 0.38rem 0.5rem;
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface-muted) 42%, transparent);
    color: var(--ui-text-primary);
    text-align: left;
  }

  .is-expandable {
    cursor: pointer;
    transition:
      background-color 140ms ease,
      border-color 140ms ease;
  }

  .is-expandable:hover {
    border-color: color-mix(in oklab, var(--agent-color) 24%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-surface-muted) 70%, transparent);
  }

  .is-expandable:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .agent-icon,
  .agent-label {
    color: var(--agent-color);
    flex: 0 0 auto;
  }

  .agent-label,
  .agent-tokens,
  .agent-arrow {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 650;
    line-height: 1;
  }

  .agent-headline {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: color-mix(in oklab, var(--ui-text-primary) 82%, transparent);
    font-size: 0.68rem;
    line-height: 1.25;
  }

  .agent-meta {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    flex: 0 0 auto;
  }

  .agent-tokens,
  .agent-arrow {
    color: var(--ui-text-tertiary);
  }

  .agent-arrow {
    opacity: 0.48;
  }

  .tone-orange {
    --agent-color: var(--ui-accent);
  }

  .tone-yellow {
    --agent-color: var(--ui-warning);
  }

  .tone-blue {
    --agent-color: var(--ui-info);
  }

  .tone-purple {
    --agent-color: hsl(268 83% 65%);
  }

  .tone-cyan {
    --agent-color: hsl(188 86% 45%);
  }
</style>
