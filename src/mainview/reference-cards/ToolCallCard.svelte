<script lang="ts" module>
  import type { ReferenceStatus } from "./StatusBadge.svelte";

  export type ToolCallParams = {
    command: string;
    filename: string;
  };

  export type ReferenceToolCall = {
    id: string;
    name: string;
    status: ReferenceStatus;
    params?: ToolCallParams | null;
    body?: string | null;
    result?: string | null;
    isError?: boolean;
    attempt?: number;
    totalAttempts?: number;
  };
</script>

<script lang="ts">
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import FileCodeIcon from "@lucide/svelte/icons/file-code";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import StatusBadge from "./StatusBadge.svelte";
  import Button from "../ui/Button.svelte";
  import { slide } from "svelte/transition";
  import { quintOut } from "svelte/easing";

  type Props = {
    toolCall: ReferenceToolCall;
    class?: string;
    onopen?: (filename: string) => void;
  };

  let { toolCall, class: className = "", onopen }: Props = $props();

  let expanded = $state(false);
  const bodyId = $derived(`tool-card-body-${toolCall.id}`);

  const statusTone = $derived(
    toolCall.status === "failed" || toolCall.isError ? "danger" :
    toolCall.status === "done" ? "success" :
    toolCall.status === "running" ? "warning" :
    "neutral"
  );

  const attemptLabel = $derived(
    toolCall.totalAttempts && toolCall.totalAttempts > 1
      ? `Attempt ${toolCall.attempt} of ${toolCall.totalAttempts}`
      : null
  );

  function toggle() {
    if (toolCall.body || toolCall.result) {
      expanded = !expanded;
    }
  }
</script>

<div
  class={`reference-tool-card border border-border/80 rounded-md bg-muted/30 transition-all duration-200 ${toolCall.isError ? "bg-destructive/5 border-destructive/30" : ""} ${className}`}
  data-testid={`tool-card-${toolCall.id}`}
>
  <header class="flex items-start justify-between gap-3 p-3">
    <div class="flex items-start gap-3 min-w-0">
      <div class={`p-1.5 rounded bg-muted border border-border/50 ${toolCall.isError ? "text-destructive" : "text-muted-foreground"}`}>
        {#if toolCall.name === "execute_typescript"}
          <FileCodeIcon size={14} strokeWidth={2.2} />
        {:else}
          <TerminalIcon size={14} strokeWidth={2.2} />
        {/if}
      </div>
      <div class="flex flex-col gap-0.5 min-w-0">
        <strong class="text-[12px] font-semibold text-foreground truncate">
          {toolCall.params?.command || `Ran ${toolCall.name}`}
        </strong>
        {#if toolCall.params?.filename}
          <span class="text-[10px] font-mono text-muted-foreground truncate">{toolCall.params.filename}</span>
        {:else}
          <span class="text-[10px] font-mono text-muted-foreground truncate">{toolCall.name}</span>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-2 flex-shrink-0">
      {#if attemptLabel}
        <span class="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-tight">{attemptLabel}</span>
      {/if}
      <StatusBadge status={toolCall.status} size="xs" />
      {#if toolCall.params?.filename}
        <Button size="sm" variant="ghost" onclick={() => onopen?.(toolCall.params!.filename)}>
          Open
        </Button>
      {/if}
      {#if toolCall.body || toolCall.result}
        <button
          type="button"
          class="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-1 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onclick={toggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
        >
          {#if expanded}
            <ChevronDownIcon size={14} />
          {:else}
            <ChevronRightIcon size={14} />
          {/if}
        </button>
      {/if}
    </div>
  </header>

  {#if expanded}
    <div
      class="border-t border-border/40 p-3 space-y-3 bg-muted/20"
      id={bodyId}
      transition:slide={{ duration: 150, easing: quintOut }}
    >
      {#if toolCall.body}
        <div class="space-y-1.5">
          <span class="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">Input</span>
          <pre class="m-0 max-h-64 overflow-auto p-2.5 rounded border border-border/60 bg-code text-[11.5px] leading-relaxed text-foreground whitespace-pre-wrap break-words">{toolCall.body}</pre>
        </div>
      {/if}

      {#if toolCall.result}
        <div class="space-y-1.5">
          <span class="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">{toolCall.isError ? "Error Output" : "Output"}</span>
          <pre class={`m-0 max-h-64 overflow-auto p-2.5 rounded border border-border/60 bg-code text-[11.5px] leading-relaxed whitespace-pre-wrap break-words ${toolCall.isError ? "text-destructive" : "text-foreground"}`}>{toolCall.result}</pre>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .reference-tool-card {
    width: 100%;
    max-width: 100%;
  }

  .bg-code {
    background-color: var(--ui-code);
  }
</style>
