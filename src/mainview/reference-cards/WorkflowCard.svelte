<script lang="ts" module>
  import type { ReferenceStatus } from "./StatusBadge.svelte";

  export type ReferenceWorkflow = {
    id: string;
    name: string;
    status: ReferenceStatus;
    elapsed?: string;
    stepsDone?: number;
    stepsTotal?: number;
    currentStep?: string;
    runId?: string;
  };
</script>

<script lang="ts">
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import WorkflowIcon from "@lucide/svelte/icons/workflow";
  import StatusBadge from "./StatusBadge.svelte";

  type Props = {
    workflow: ReferenceWorkflow;
    class?: string;
    onclick?: (workflow: ReferenceWorkflow) => void;
  };

  let { workflow, class: className = "", onclick }: Props = $props();

  const stepsDone = $derived(workflow.stepsDone ?? 0);
  const stepsTotal = $derived(Math.max(1, workflow.stepsTotal ?? 1));
  const dots = $derived(
    Array.from({ length: stepsTotal }, (_, index) => ({
      done: index < stepsDone,
      active: index === stepsDone && workflow.status === "running",
    })),
  );
</script>

<button
  type="button"
  class={`reference-workflow-card ${className}`.trim()}
  onclick={() => onclick?.(workflow)}
  data-testid={`workflow-card-${workflow.id}`}
>
  <WorkflowIcon size={14} strokeWidth={2} class="workflow-icon" />
  <div class="workflow-copy">
    <header>
      <strong>{workflow.name}</strong>
      <span>
        <StatusBadge status={workflow.status} size="xs" />
        {#if workflow.elapsed}<small>{workflow.elapsed}</small>{/if}
      </span>
    </header>
    <div class="workflow-progress">
      <span class="workflow-dots" aria-hidden="true">
        {#each dots as dot, index (`${workflow.id}:${index}`)}
          <i class:done={dot.done} class:active={dot.active}></i>
        {/each}
      </span>
      <small>{stepsDone}/{stepsTotal}</small>
    </div>
    <footer>
      <ArrowRightIcon size={11} strokeWidth={2} />
      <span>{workflow.status === "running" ? workflow.currentStep || "Running" : workflow.currentStep || "Completed"}</span>
      {#if workflow.runId}<small>{workflow.runId}</small>{/if}
    </footer>
  </div>
</button>

<style>
  .reference-workflow-card {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    width: 100%;
    padding: 0.68rem 0.78rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-md);
    background: var(--ui-surface);
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .reference-workflow-card:hover,
  .reference-workflow-card:focus-visible {
    outline: none;
    border-color: color-mix(in oklab, var(--ui-border-accent) 70%, var(--ui-border-soft));
    background: color-mix(in oklab, var(--ui-surface-subtle) 42%, var(--ui-surface));
  }

  .workflow-icon {
    flex: 0 0 auto;
    margin-top: 0.12rem;
    color: var(--ui-text-tertiary);
  }

  .workflow-copy {
    display: grid;
    gap: 0.34rem;
    min-width: 0;
    flex: 1;
  }

  header,
  header span,
  footer,
  .workflow-progress,
  .workflow-dots {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  header {
    justify-content: space-between;
    gap: 0.6rem;
  }

  header strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 650;
  }

  header span {
    gap: 0.34rem;
    flex: 0 0 auto;
  }

  small {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: 0.54rem;
    white-space: nowrap;
  }

  .workflow-progress {
    gap: 0.42rem;
  }

  .workflow-dots {
    gap: 0.12rem;
  }

  .workflow-dots i {
    width: 0.34rem;
    height: 0.34rem;
    border-radius: 999px;
    background: color-mix(in oklab, var(--ui-text-tertiary) 22%, transparent);
  }

  .workflow-dots i.done {
    background: var(--ui-success);
  }

  .workflow-dots i.active {
    background: var(--ui-accent);
    animation: pulse-dot 1.4s ease-in-out infinite;
  }

  footer {
    gap: 0.3rem;
    color: var(--ui-text-tertiary);
    font-size: 0.64rem;
  }

  footer span {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
