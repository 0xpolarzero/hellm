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
  import { slide } from "svelte/transition";
  import { quintOut } from "svelte/easing";

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

  const borderColor = $derived(
    thread.status === "running" ? "border-l-orange-500" :
    thread.status === "done" ? "border-l-emerald-500/50" :
    thread.status === "waiting" ? "border-l-amber-500" :
    thread.status === "failed" ? "border-l-red-500" :
    "border-l-border"
  );
</script>

<article
  class={`border border-border rounded-md bg-card border-l-2 transition-colors ${borderColor} ${className}`}
  data-testid={`thread-card-${thread.id}`}
>
  <header class="flex items-center gap-2 px-3 py-2.5">
    <button
      type="button"
      class="text-muted-foreground flex-shrink-0 cursor-pointer hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
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
      class="text-[12px] font-medium text-foreground flex-1 truncate text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      onclick={() => (expanded = !expanded)}
      aria-expanded={expanded}
      aria-controls={bodyId}
    >
      {thread.title}
    </button>
    <StatusBadge status={thread.status} size="xs" />
    <span class="font-mono text-[10px] text-muted-foreground tabular-nums">
      {thread.elapsed}
    </span>
    <button
      type="button"
      class="text-muted-foreground/40 hover:text-muted-foreground transition-colors flex-shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      title="Open handler thread"
      aria-label="Open handler thread"
      onclick={() => onopen?.(thread)}
      data-testid={`thread-open-pane-${thread.id}`}
    >
      <ExternalLinkIcon size={13} strokeWidth={2.1} />
    </button>
  </header>

  {#if thread.status === "running"}
    <div class="px-3 pb-1" aria-hidden="true">
      <div class="h-0.5 bg-muted rounded-full overflow-hidden">
        <div
          class="h-full bg-orange-500 rounded-full transition-all duration-500"
          style={`width: ${progress}%`}
        ></div>
      </div>
    </div>
  {/if}

  {#if expanded}
    <div
      class="border-t border-border px-3 py-2 space-y-2"
      id={bodyId}
      transition:slide={{ duration: 150, easing: quintOut }}
    >
      <p class="text-[11px] text-muted-foreground leading-relaxed">
        {thread.objective}
      </p>

      {#if subagents.length > 0}
        <div class="space-y-1">
          {#each subagents as agent (agent.id)}
            <SubagentCard agent={agent} onclick={onsubagentopen} />
          {/each}
        </div>
      {/if}

      <footer class="flex items-center gap-3 pt-1 flex-wrap">
        {#if thread.worktree}
          <span class="font-mono text-[10px] text-muted-foreground flex items-center gap-1">
            <GitBranchIcon size={11} strokeWidth={2} />{thread.worktree}
          </span>
        {/if}
        <span class="font-mono text-[10px] text-muted-foreground flex items-center gap-1 tabular-nums">
          <ClockIcon size={11} strokeWidth={2} />{thread.elapsed}
        </span>
        <ModelBadge model={thread.model} size="xs" />
      </footer>
    </div>
  {/if}
</article>
