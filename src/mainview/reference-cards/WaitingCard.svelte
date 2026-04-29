<script lang="ts">
  import ClockIcon from "@lucide/svelte/icons/clock";

  type Props = {
    question: string;
    context?: string;
    class?: string;
    onreply?: (text: string) => void;
  };

  let { question, context, class: className = "", onreply }: Props = $props();
  let reply = $state("");

  function send() {
    const text = reply.trim();
    if (!text) return;
    onreply?.(text);
    reply = "";
  }
</script>

<article class={`reference-waiting-card ${className}`.trim()} data-testid="waiting-card">
  <header>
    <span class="pulse-dot"></span>
    <ClockIcon size={14} strokeWidth={2} />
    <strong>Waiting for input</strong>
  </header>
  <div class="waiting-body">
    {#if context}<p class="context">{context}</p>{/if}
    <p>{question}</p>
    {#if onreply}
      <div class="reply-row">
        <input
          bind:value={reply}
          placeholder="Type your response..."
          onkeydown={(event) => {
            if (event.key === "Enter") send();
          }}
        />
        <button type="button" disabled={!reply.trim()} onclick={send}>Reply</button>
      </div>
    {/if}
  </div>
</article>

<style>
  .reference-waiting-card {
    border: 1px solid var(--ui-border-soft);
    border-left: 2px solid var(--ui-warning);
    border-radius: var(--ui-radius-md);
    background: var(--ui-surface);
    overflow: hidden;
  }

  header,
  .reply-row {
    display: flex;
    align-items: center;
  }

  header {
    gap: 0.45rem;
    padding: 0.62rem 0.72rem;
    border-bottom: 1px solid var(--ui-border-soft);
    color: color-mix(in oklab, var(--ui-warning) 84%, var(--ui-text-primary));
  }

  .pulse-dot {
    width: 0.42rem;
    height: 0.42rem;
    border-radius: 999px;
    background: var(--ui-warning);
    animation: pulse-dot 1.4s ease-in-out infinite;
  }

  strong {
    font-size: 0.74rem;
    font-weight: 650;
  }

  .waiting-body {
    display: grid;
    gap: 0.62rem;
    padding: 0.7rem 0.78rem;
  }

  p {
    margin: 0;
    color: var(--ui-text-primary);
    font-size: 0.76rem;
    line-height: 1.5;
  }

  .context {
    color: var(--ui-text-secondary);
    font-size: 0.66rem;
  }

  .reply-row {
    gap: 0.45rem;
  }

  input {
    flex: 1;
    min-width: 0;
    min-height: 1.8rem;
    padding: 0.28rem 0.52rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-surface-subtle);
    color: var(--ui-text-primary);
    font: inherit;
    font-size: 0.68rem;
  }

  button {
    min-height: 1.8rem;
    padding: 0.24rem 0.68rem;
    border: 1px solid var(--ui-accent);
    border-radius: var(--ui-radius-sm);
    background: var(--ui-accent);
    color: var(--ui-accent-ink);
    font-size: 0.66rem;
    font-weight: 650;
    cursor: pointer;
  }

  button:disabled {
    border-color: var(--ui-border-soft);
    background: var(--ui-surface-muted);
    color: var(--ui-text-tertiary);
    cursor: not-allowed;
  }
</style>
