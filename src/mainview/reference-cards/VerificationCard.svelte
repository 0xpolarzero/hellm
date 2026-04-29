<script lang="ts" module>
  export type ReferenceCheckStatus = "pass" | "fail" | "skip" | "blocked" | "cancelled";
  export type ReferenceVerification = {
    id: string;
    passed: boolean;
    testsPassed: number;
    testsTotal: number;
    summary: string;
    checks: { label: string; status: ReferenceCheckStatus }[];
  };
</script>

<script lang="ts">
  import CheckCircle2Icon from "@lucide/svelte/icons/check-circle-2";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import MinusCircleIcon from "@lucide/svelte/icons/minus-circle";
  import XCircleIcon from "@lucide/svelte/icons/x-circle";

  type Props = {
    result: ReferenceVerification;
    class?: string;
    onreportopen?: () => void;
  };

  let { result, class: className = "", onreportopen }: Props = $props();
</script>

<article
  class={`reference-verification-card ${result.passed ? "passed" : "failed"} ${className}`.trim()}
  data-testid={`verification-card-${result.id}`}
>
  <header>
    {#if result.passed}<CheckCircle2Icon size={14} strokeWidth={2} />{:else}<XCircleIcon size={14} strokeWidth={2} />{/if}
    <strong>Verification</strong>
    <span>{result.passed ? "passed" : "failed"}</span>
    <small>{result.testsPassed}/{result.testsTotal} tests</small>
  </header>
  <div class="check-list">
    {#each result.checks as check (check.label)}
      <div class={`check-row status-${check.status}`.trim()}>
        {#if check.status === "pass"}<CheckCircle2Icon size={12} />{:else if check.status === "fail" || check.status === "blocked"}<XCircleIcon size={12} />{:else}<MinusCircleIcon size={12} />{/if}
        <span>{check.label}</span>
        <small>{check.status}</small>
      </div>
    {/each}
  </div>
  <p>{result.summary}</p>
  {#if onreportopen}
    <button type="button" onclick={onreportopen}><ExternalLinkIcon size={11} />View report</button>
  {/if}
</article>

<style>
  .reference-verification-card {
    --verify-color: var(--ui-danger);
    display: grid;
    gap: 0.55rem;
    border: 1px solid var(--ui-border-soft);
    border-left: 2px solid var(--verify-color);
    border-radius: var(--ui-radius-md);
    background: var(--ui-surface);
    overflow: hidden;
  }

  .passed {
    --verify-color: var(--ui-success);
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.62rem 0.72rem;
    border-bottom: 1px solid var(--ui-border-soft);
    color: var(--verify-color);
  }

  strong {
    color: var(--ui-text-primary);
    font-size: 0.74rem;
    font-weight: 650;
  }

  header span,
  header small,
  .check-row small {
    font-family: var(--font-mono);
    font-size: 0.56rem;
  }

  header span {
    padding: 0.08rem 0.34rem;
    border: 1px solid color-mix(in oklab, var(--verify-color) 24%, var(--ui-border-soft));
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--verify-color) 9%, transparent);
    color: var(--verify-color);
  }

  header small {
    margin-left: auto;
    color: var(--ui-text-tertiary);
  }

  .check-list {
    display: grid;
    gap: 0.12rem;
    padding: 0 0.72rem;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--ui-text-secondary);
    font-size: 0.66rem;
  }

  .check-row.status-pass {
    color: color-mix(in oklab, var(--ui-success) 82%, var(--ui-text-primary));
  }

  .check-row.status-fail {
    color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
  }

  .check-row.status-blocked {
    color: color-mix(in oklab, var(--ui-warning) 86%, var(--ui-text-primary));
  }

  .check-row.status-cancelled {
    color: var(--ui-text-tertiary);
  }

  .check-row span {
    flex: 1;
    color: var(--ui-text-secondary);
  }

  p {
    margin: 0;
    padding: 0 0.72rem 0.62rem;
    color: var(--ui-text-secondary);
    font-size: 0.68rem;
    line-height: 1.45;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
    justify-self: flex-start;
    margin: -0.2rem 0.72rem 0.72rem;
    border: 0;
    background: transparent;
    color: var(--ui-text-tertiary);
    font-size: 0.6rem;
    cursor: pointer;
  }
</style>
