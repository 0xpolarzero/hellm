<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import XIcon from "@lucide/svelte/icons/x";
  import type {
    AnswerRuntimeApprovalRequest,
    WorkspaceRuntimeApprovalRequest,
  } from "../shared/workspace-contract";
  import Button from "./ui/Button.svelte";

  type Props = {
    requests: WorkspaceRuntimeApprovalRequest[];
    onAnswer: (request: AnswerRuntimeApprovalRequest) => Promise<void> | void;
    onOpenOwner?: (request: WorkspaceRuntimeApprovalRequest) => void;
  };

  let { requests, onAnswer, onOpenOwner }: Props = $props();
  let pendingRequestId = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);

  async function answer(request: WorkspaceRuntimeApprovalRequest, approved: boolean): Promise<void> {
    if (pendingRequestId) return;
    pendingRequestId = request.requestId;
    errorMessage = null;
    try {
      await onAnswer({
        requestId: request.requestId,
        approved,
        reason: approved ? "Approved by user." : "Denied by user.",
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Failed to answer approval request.";
    } finally {
      pendingRequestId = null;
    }
  }
</script>

<aside class="runtime-approval-panel" aria-label="Runtime approval requests">
  <header>
    <div>
      <strong>Approvals</strong>
      <span>{requests.length} pending</span>
    </div>
  </header>

  {#if errorMessage}
    <p class="runtime-approval-error" role="alert">{errorMessage}</p>
  {/if}

  <div class="runtime-approval-list">
    {#each requests as request (request.requestId)}
      <article class="runtime-approval-card">
        <button
          class="runtime-approval-owner"
          type="button"
          onclick={() => onOpenOwner?.(request)}
        >
          <span>{request.ownerTitle}</span>
          <small>{request.toolName}</small>
        </button>
        <p>{request.summary}</p>
        <div class="runtime-approval-meta">
          <span>{request.cwd}</span>
          {#if request.commandFamily}
            <span>{request.commandFamily}</span>
          {/if}
        </div>
        <div class="runtime-approval-actions">
          <Button
            size="xs"
            variant="ghost"
            disabled={pendingRequestId === request.requestId}
            onclick={() => void answer(request, false)}
          >
            <XIcon aria-hidden="true" size={13} />
            Deny
          </Button>
          <Button
            size="xs"
            disabled={pendingRequestId === request.requestId}
            onclick={() => void answer(request, true)}
          >
            <CheckIcon aria-hidden="true" size={13} />
            Approve
          </Button>
        </div>
      </article>
    {/each}
  </div>
</aside>

<style>
  .runtime-approval-panel {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    min-width: 260px;
    max-width: 340px;
    min-height: 0;
    border-left: 1px solid var(--ui-shell-edge);
    background: var(--ui-chrome);
  }

  header {
    padding: 12px;
    border-bottom: 1px solid var(--ui-shell-edge);
  }

  header div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  header strong {
    font-size: 12px;
    color: var(--ui-text);
  }

  header span,
  .runtime-approval-owner small,
  .runtime-approval-meta {
    font-size: 11px;
    color: var(--ui-text-muted);
  }

  .runtime-approval-error {
    margin: 0;
    padding: 8px 12px;
    border-bottom: 1px solid var(--ui-shell-edge);
    color: var(--ui-danger);
    font-size: 12px;
  }

  .runtime-approval-list {
    display: grid;
    align-content: start;
    gap: 8px;
    min-height: 0;
    overflow: auto;
    padding: 10px;
  }

  .runtime-approval-card {
    display: grid;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--ui-shell-edge);
    border-radius: 8px;
    background: var(--ui-surface);
  }

  .runtime-approval-owner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    border: 0;
    padding: 0;
    color: inherit;
    background: transparent;
    cursor: pointer;
    text-align: left;
  }

  .runtime-approval-owner span,
  .runtime-approval-card p {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .runtime-approval-card p {
    margin: 0;
    font-size: 12px;
    color: var(--ui-text);
  }

  .runtime-approval-meta {
    display: grid;
    gap: 3px;
  }

  .runtime-approval-meta span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .runtime-approval-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
</style>
