<script lang="ts" module>
  import type { TranscriptStatus } from "./StatusBadge.svelte";
  import type { TranscriptSubagent } from "./SubagentCard.svelte";
  import type { TranscriptWorkflow } from "./WorkflowCard.svelte";

	export type TranscriptThread = {
		id: string;
		title: string;
		objective: string;
		status: TranscriptStatus;
		elapsed: string;
		progress?: number;
		worktree?: string;
		model: string;
		currentActivity?: {
			title: string;
			summary: string;
			status?: TranscriptStatus;
			updatedAt?: string;
			commandId?: string;
		};
		latestReport?: {
			episodeId: string;
			kind: string;
			title: string;
			summary: string;
			createdAt: string;
		};
		metrics?: string[];
		latestWorkflowRun?: TranscriptWorkflow;
	};
</script>

<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import ClockIcon from "@lucide/svelte/icons/clock";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
	import StatusBadge from "./StatusBadge.svelte";
	import ModelBadge from "./ModelBadge.svelte";
	import SubagentCard from "./SubagentCard.svelte";
	import WorkflowCard, { type TranscriptWorkflow } from "./WorkflowCard.svelte";
	import { slide } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import Tooltip from "../ui/Tooltip.svelte";

  type Props = {
    thread: TranscriptThread;
    subagents?: TranscriptSubagent[];
    class?: string;
    defaultExpanded?: boolean;
		onopen?: (thread: TranscriptThread) => void;
		onworkflowopen?: (workflow: TranscriptWorkflow) => void;
		onsubagentopen?: (agent: TranscriptSubagent) => void;
	};

  let {
    thread,
    subagents = [],
    class: className = "",
    defaultExpanded = true,
		onopen,
		onworkflowopen,
		onsubagentopen,
	}: Props = $props();

  let expanded = $state(true);
  const bodyId = $derived(`thread-card-body-${thread.id}`);
  const progress = $derived(Math.max(0, Math.min(100, thread.progress ?? 0)));

  $effect(() => {
    expanded = defaultExpanded;
  });

  const statusColor = $derived(
    thread.status === "running" ? "var(--ui-status-running)" :
    thread.status === "done" ? "var(--ui-status-success)" :
    thread.status === "waiting" ? "var(--ui-status-waiting)" :
    thread.status === "failed" ? "var(--ui-status-danger)" :
    "var(--ui-border-soft)"
  );

  const statusBg = $derived(
    thread.status === "running" ? "var(--ui-status-running-soft)" :
    thread.status === "done" ? "var(--ui-status-success-soft)" :
    thread.status === "waiting" ? "var(--ui-status-waiting-soft)" :
    thread.status === "failed" ? "var(--ui-status-danger-soft)" :
    "transparent"
  );
</script>

<article
  class={`reference-thread-card ${className}`}
  style={`--thread-status-color: ${statusColor}; --thread-status-bg: ${statusBg};`}
  data-testid={`thread-card-${thread.id}`}
>
  <header class="flex items-center gap-2 px-3 py-2.5">
    <button
      type="button"
      class="text-muted-foreground hover:text-foreground"
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
      class="text-sm font-medium text-foreground flex-1 truncate text-left"
      onclick={() => (expanded = !expanded)}
      aria-expanded={expanded}
      aria-controls={bodyId}
    >
      {thread.title}
    </button>
    <StatusBadge status={thread.status} size="xs" />
    <span class="font-mono text-xs text-muted-foreground tabular-nums">
      {thread.elapsed}
    </span>
    <Tooltip label="Open handler thread">
      <button
        type="button"
        class="text-muted-foreground/40 hover:text-muted-foreground"
        aria-label="Open handler thread"
        onclick={() => onopen?.(thread)}
        data-testid={`thread-open-pane-${thread.id}`}
      >
        <ExternalLinkIcon size={13} strokeWidth={2.1} />
      </button>
    </Tooltip>
  </header>

  {#if thread.status === "running"}
    <div class="progress-bar-container" aria-hidden="true">
      <div
        class="progress-bar"
        style={`width: ${progress}%`}
      ></div>
    </div>
  {/if}

  {#if expanded}
    <div
      class="card-body"
      id={bodyId}
      transition:slide={{ duration: 150, easing: quintOut }}
    >
      <section class="thread-section">
        <span>Objective</span>
        <p>{thread.objective}</p>
      </section>

      {#if thread.currentActivity}
        <section class="thread-section current-activity">
          <div class="thread-section-header">
            <span>Current activity</span>
            {#if thread.currentActivity.status}
              <StatusBadge status={thread.currentActivity.status} size="xs" />
            {/if}
          </div>
          <strong>{thread.currentActivity.title}</strong>
          <p>{thread.currentActivity.summary}</p>
        </section>
      {/if}

      {#if thread.latestReport}
        <section class="thread-section latest-report">
          <div class="thread-section-header">
            <span>Latest report</span>
            <small>{thread.latestReport.kind} · {thread.latestReport.createdAt}</small>
          </div>
          <strong>{thread.latestReport.title}</strong>
          <p>{thread.latestReport.summary}</p>
        </section>
      {/if}

      {#if thread.latestWorkflowRun}
        <WorkflowCard
          workflow={thread.latestWorkflowRun}
          onclick={onworkflowopen}
        />
      {/if}

      {#if subagents.length > 0}
        <div class="space-y-1.5">
          {#each subagents as agent (agent.id)}
            <SubagentCard agent={agent} onclick={onsubagentopen} />
          {/each}
        </div>
      {/if}

      <footer>
        {#if thread.worktree}
          <div class="footer-item">
            <GitBranchIcon size={11} strokeWidth={2} />{thread.worktree}
          </div>
        {/if}
        <div class="footer-item">
          <ClockIcon size={11} strokeWidth={2} />{thread.elapsed}
        </div>
        {#if thread.metrics && thread.metrics.length > 0}
          {#each thread.metrics as metric (metric)}
            <div class="footer-item">{metric}</div>
          {/each}
        {/if}
        <ModelBadge model={thread.model} size="xs" />
      </footer>
    </div>
  {/if}
</article>
<style>
  .reference-thread-card {
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in oklab, var(--thread-status-color) 34%, var(--ui-border-soft));
    border-radius: var(--ui-radius-md);
    background: color-mix(in oklab, var(--ui-surface) 92%, var(--thread-status-bg));
    box-shadow: var(--ui-shadow-soft);
    transition:
      border-color 0.2s cubic-bezier(0.23, 1, 0.32, 1),
      background-color 0.2s cubic-bezier(0.23, 1, 0.32, 1);
    overflow: hidden;
  }

  .reference-thread-card:hover {
    border-color: color-mix(in oklab, var(--ui-border-soft) 80%, var(--thread-status-color));
    background: color-mix(in oklab, var(--ui-surface) 88%, var(--thread-status-bg));
  }

  header {
    background: color-mix(in oklab, var(--ui-surface-subtle) 40%, transparent);
  }

  .progress-bar-container {
    height: 2px;
    background: var(--ui-surface-muted);
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: var(--ui-accent);
    transition: width 0.6s cubic-bezier(0.65, 0, 0.35, 1);
  }

  .card-body {
    border-top: 1px solid var(--ui-border-soft);
    padding: 0.75rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: color-mix(in oklab, var(--ui-surface-raised) 30%, transparent);
  }

  .thread-section {
    display: grid;
    gap: 0.24rem;
  }

  .thread-section > span,
  .thread-section-header span {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
  }

  .thread-section p {
    margin: 0;
    color: var(--ui-text-secondary);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .thread-section strong {
    color: var(--ui-text);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.35;
  }

  .thread-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .thread-section-header small {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .current-activity,
  .latest-report {
    padding: 0.56rem 0.62rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-surface-subtle) 54%, transparent);
  }

  footer {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding-top: 0.25rem;
    flex-wrap: wrap;
    opacity: 0.8;
  }

  .footer-item {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ui-text-tertiary);
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  button {
    all: unset;
    position: relative;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s ease;
  }

  button::before {
    content: "";
    position: absolute;
    inset: 50% auto auto 50%;
    width: max(100%, 1.75rem);
    height: max(100%, 1.75rem);
    transform: translate(-50%, -50%);
    border-radius: var(--ui-radius-sm);
  }

  button:focus-visible {
    outline: 2px solid var(--ui-accent);
    outline-offset: 1px;
    border-radius: var(--ui-radius-xs);
  }
</style>
