<script lang="ts" module>
  import type { ReferenceStatus } from "./StatusBadge.svelte";
  import type { ReferenceSubagent } from "./SubagentCard.svelte";

  export type ReferenceThread = {
    id: string;
    title: string;
    objective: string;
    status: ReferenceStatus;
    elapsed: string;
    progress?: number;
    worktree?: string;
    model: string;
  };
</script>

<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import ClockIcon from "@lucide/svelte/icons/clock";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import ModelBadge from "./ModelBadge.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import SubagentCard from "./SubagentCard.svelte";

  type Props = {
    thread: ReferenceThread;
    subagents?: ReferenceSubagent[];
    class?: string;
    defaultExpanded?: boolean;
    onopen?: (thread: ReferenceThread) => void;
    onsubagentopen?: (agent: ReferenceSubagent) => void;
  };

  let {
    thread,
    subagents = [],
    class: className = "",
    defaultExpanded = true,
    onopen,
    onsubagentopen,
  }: Props = $props();

  let expanded = $state(true);
  const bodyId = $derived(`thread-card-body-${thread.id}`);
  const progress = $derived(Math.max(0, Math.min(100, thread.progress ?? 0)));

  $effect(() => {
    expanded = defaultExpanded;
  });
</script>

<article
  class={`reference-thread-card status-${thread.status} ${className}`.trim()}
  data-testid={`thread-card-${thread.id}`}
>
  <header class="thread-header">
    <button
      type="button"
      class="icon-button"
      onclick={() => (expanded = !expanded)}
      data-testid={`thread-card-toggle-${thread.id}`}
      aria-label={expanded ? "Collapse handler thread" : "Expand handler thread"}
      aria-expanded={expanded}
      aria-controls={bodyId}
    >
      {#if expanded}
        <ChevronDownIcon size={13} strokeWidth={2.2} />
      {:else}
        <ChevronRightIcon size={13} strokeWidth={2.2} />
      {/if}
    </button>
    <button
      type="button"
      class="thread-title"
      onclick={() => (expanded = !expanded)}
      aria-expanded={expanded}
      aria-controls={bodyId}
    >
      {thread.title}
    </button>
    <StatusBadge status={thread.status} size="xs" />
    <span class="thread-elapsed">{thread.elapsed}</span>
    <button
      type="button"
      class="icon-button open-button"
      title="Open handler thread"
      aria-label="Open handler thread"
      onclick={() => onopen?.(thread)}
      data-testid={`thread-open-pane-${thread.id}`}
    >
      <ExternalLinkIcon size={13} strokeWidth={2.1} />
    </button>
  </header>

  {#if thread.status === "running"}
    <div class="thread-progress" aria-hidden="true">
      <span style={`width: ${progress}%`}></span>
    </div>
  {/if}

  {#if expanded}
    <div class="thread-body" id={bodyId}>
      <p>{thread.objective}</p>

      {#if subagents.length > 0}
        <div class="thread-subagents">
          {#each subagents as agent (agent.id)}
            <SubagentCard agent={agent} onclick={onsubagentopen} />
          {/each}
        </div>
      {/if}

      <footer class="thread-footer">
        {#if thread.worktree}
          <span><GitBranchIcon size={11} strokeWidth={2} />{thread.worktree}</span>
        {/if}
        <span><ClockIcon size={11} strokeWidth={2} />{thread.elapsed}</span>
        <ModelBadge model={thread.model} size="xs" />
      </footer>
    </div>
  {/if}
</article>

<style>
  .reference-thread-card {
    --thread-color: var(--ui-status-idle);
    border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
    border-left: 2px solid var(--thread-color);
    border-radius: var(--ui-radius-md);
    background: var(--ui-surface);
    box-shadow: var(--ui-shadow-soft);
    overflow: hidden;
  }

  .status-running,
  .status-active {
    --thread-color: var(--ui-status-running);
  }

  .status-done,
  .status-verified,
  .status-passed {
    --thread-color: color-mix(in oklab, var(--ui-status-success) 62%, transparent);
  }

  .status-waiting,
  .status-blocked {
    --thread-color: var(--ui-status-waiting);
  }

  .status-failed,
  .status-cancelled {
    --thread-color: var(--ui-status-danger);
  }

  .thread-header {
    display: flex;
    align-items: center;
    gap: 0.48rem;
    min-width: 0;
    padding: 0.6rem 0.72rem;
  }

  .icon-button,
  .thread-title {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .icon-button {
    display: inline-grid;
    place-items: center;
    width: 1.2rem;
    height: 1.2rem;
    padding: 0;
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-tertiary);
    flex: 0 0 auto;
  }

  .icon-button:hover,
  .thread-title:hover {
    color: var(--ui-text-primary);
  }

  .icon-button:focus-visible,
  .thread-title:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .thread-title {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    padding: 0;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.74rem;
    font-weight: 650;
  }

  .thread-elapsed,
  .thread-footer span {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .open-button {
    opacity: 0.62;
  }

  .thread-progress {
    margin: 0 0.72rem 0.22rem;
    height: 0.14rem;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-surface-muted) 90%, transparent);
  }

  .thread-progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--ui-status-running);
    transition: width 500ms ease;
  }

  .thread-body {
    display: grid;
    gap: 0.55rem;
    padding: 0.62rem 0.72rem 0.7rem;
    border-top: 1px solid color-mix(in oklab, var(--ui-border-soft) 78%, transparent);
  }

  .thread-body p {
    margin: 0;
    color: var(--ui-text-secondary);
    font-size: 0.68rem;
    line-height: 1.48;
  }

  .thread-subagents {
    display: grid;
    gap: 0.28rem;
  }

  .thread-footer {
    display: flex;
    align-items: center;
    gap: 0.72rem;
    min-width: 0;
    padding-top: 0.1rem;
    flex-wrap: wrap;
  }

  .thread-footer span {
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
  }
</style>
