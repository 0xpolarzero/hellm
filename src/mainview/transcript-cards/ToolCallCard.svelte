<script lang="ts" module>
  export type {
    TranscriptStatus,
    TranscriptToolArtifact,
    TranscriptToolCall,
    TranscriptToolChild,
    TranscriptToolLifecycleItem,
    TranscriptToolMetric,
    TranscriptToolSection,
  } from "../transcript-tool-card-model";
</script>

<script lang="ts">
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import FileCodeIcon from "@lucide/svelte/icons/file-code";
  import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import StatusBadge from "./StatusBadge.svelte";
  import Button from "../ui/Button.svelte";
  import type {
    TranscriptStatus,
    TranscriptToolArtifact,
    TranscriptToolCall,
    TranscriptToolSection,
  } from "../transcript-tool-card-model";

  type Props = {
    toolCall: TranscriptToolCall;
    class?: string;
    onopen?: (artifact: TranscriptToolArtifact) => void;
    oninspect?: (commandId: string) => void;
    oncopy?: (text: string) => void | Promise<void>;
  };

  let { toolCall, class: className = "", onopen, oninspect, oncopy }: Props = $props();

  const sections = $derived(
    toolCall.sections?.length
      ? toolCall.sections
      : [
          ...(toolCall.body
            ? [{ id: "input", title: "Input", content: toolCall.body } satisfies TranscriptToolSection]
            : []),
          ...(toolCall.result
            ? [
                {
                  id: toolCall.isError ? "error-output" : "output",
                  title: toolCall.isError ? "Error output" : "Output",
                  content: toolCall.result,
                  tone: toolCall.isError ? "failed" : undefined,
                  defaultOpen: toolCall.isError,
                } satisfies TranscriptToolSection,
              ]
            : []),
        ],
  );
  let expanded = $state(false);
  let defaultOpenInitializedFor = $state<string | null>(null);
  let copiedTarget = $state<string | null>(null);
  const bodyId = $derived(`tool-card-body-${toolCall.id}`);

  $effect(() => {
    if (defaultOpenInitializedFor === toolCall.id) return;
    expanded = Boolean(sections.some((section) => section.defaultOpen));
    defaultOpenInitializedFor = toolCall.id;
  });
  const attemptLabel = $derived(
    toolCall.totalAttempts && toolCall.totalAttempts > 1
      ? `Attempt ${toolCall.attempt} of ${toolCall.totalAttempts}`
      : null
  );
  const canExpand = $derived(
    sections.length > 0 ||
      Boolean(toolCall.children?.length) ||
      Boolean(toolCall.lifecycle?.length) ||
      Boolean(toolCall.artifacts?.length),
  );
  const toolTitle = $derived(toolCall.title || `Run ${toolCall.name}`);
  const toolMeta = $derived(
    [toolCall.target, toolCall.duration, toolCall.commandId ? toolCall.commandId.slice(0, 12) : null]
      .filter(Boolean)
      .join(" · ") || toolCall.name,
  );
  const outcomeText = $derived(toolCall.outcome || toolCall.summary || null);

  function toggle() {
    if (canExpand) {
      expanded = !expanded;
    }
  }

  function lifecycleToneClass(tone: TranscriptStatus | undefined): string {
    if (tone === "failed") return "tone-danger";
    if (tone === "done") return "tone-success";
    if (tone === "running" || tone === "waiting") return "tone-warning";
    return "";
  }

  function sectionToneClass(tone: TranscriptStatus | undefined): string {
    if (tone === "failed") return "section-danger";
    if (tone === "waiting") return "section-waiting";
    return "";
  }

  async function copyText(text: string, target: string) {
    await (oncopy ? oncopy(text) : navigator.clipboard?.writeText(text));
    copiedTarget = target;
    setTimeout(() => {
      if (copiedTarget === target) copiedTarget = null;
    }, 1400);
  }

  function copyToolReference() {
    const reference = toolCall.commandId
      ? `${toolTitle} (${toolCall.name}, ${toolCall.commandId})`
      : `${toolTitle} (${toolCall.name})`;
    void copyText(reference, "reference");
  }
</script>

<div
  class={`transcript-tool-card border border-border/80 bg-muted/30 transition-all duration-200 ${toolCall.isError ? "bg-destructive/5 border-destructive/30" : ""} ${className}`}
  data-testid={`tool-card-${toolCall.id}`}
>
  <header class="flex items-start justify-between gap-3 p-3">
    <div class="flex items-start gap-3 min-w-0">
      <div class={`transcript-tool-icon p-1.5 bg-muted border border-border/50 ${toolCall.isError ? "text-destructive" : "text-muted-foreground"}`}>
        {#if toolCall.name === "execute_typescript"}
          <FileCodeIcon size={14} strokeWidth={2.2} />
        {:else}
          <TerminalIcon size={14} strokeWidth={2.2} />
        {/if}
      </div>
      <div class="flex flex-col gap-0.5 min-w-0">
        <strong class="text-sm font-semibold text-foreground truncate">
          {toolTitle}
        </strong>
        <span class="text-xs font-mono text-muted-foreground truncate">{toolMeta}</span>
      </div>
    </div>

    <div class="flex items-center gap-2 flex-shrink-0">
      {#if attemptLabel}
        <span class="text-xs font-mono text-muted-foreground/60 uppercase tracking-normal">{attemptLabel}</span>
      {/if}
      <StatusBadge status={toolCall.status} size="xs" />
      {#if toolCall.commandId}
        <button
          type="button"
          class="transcript-tool-icon-button"
          onclick={copyToolReference}
          aria-label={copiedTarget === "reference" ? "Copied tool reference" : "Copy tool reference"}
          title={copiedTarget === "reference" ? "Copied" : "Copy tool reference"}
        >
          <CopyIcon size={13} />
        </button>
      {/if}
      {#if toolCall.commandId && oninspect}
        <Button size="sm" variant="ghost" onclick={() => oninspect?.(toolCall.commandId!)}>
          Inspect
        </Button>
      {/if}
      {#if canExpand}
        <button
          type="button"
          class="transcript-tool-toggle text-muted-foreground/40 hover:text-muted-foreground transition-colors p-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onclick={toggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={`${expanded ? "Hide" : "Show"} tool details for ${toolTitle}`}
          title={`${expanded ? "Hide" : "Show"} tool details`}
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

  {#if outcomeText || (toolCall.metrics && toolCall.metrics.length > 0) || (toolCall.artifacts && toolCall.artifacts.length > 0)}
    <div class="tool-card-summary">
      {#if outcomeText}
        <p>{outcomeText}</p>
      {/if}
      {#if toolCall.metrics && toolCall.metrics.length > 0}
        <dl class="tool-card-lifecycle" aria-label="Tool summary">
          {#each toolCall.metrics as item (`${item.label}:${item.value}`)}
            <div class={lifecycleToneClass(item.tone)}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          {/each}
        </dl>
      {/if}
      {#if toolCall.artifacts && toolCall.artifacts.length > 0}
        <div class="tool-card-artifacts" aria-label="Artifacts">
          {#each toolCall.artifacts.slice(0, 3) as artifact (artifact.id)}
            <Button size="sm" variant="ghost" onclick={() => onopen?.(artifact)}>
              {artifact.name}
            </Button>
          {/each}
          {#if toolCall.artifacts.length > 3}
            {#if toolCall.commandId && oninspect}
              <Button size="sm" variant="ghost" onclick={() => oninspect?.(toolCall.commandId!)}>
                {toolCall.artifacts.length - 3} more
              </Button>
            {:else}
              <button type="button" class="tool-card-artifact-overflow" onclick={toggle}>
                {toolCall.artifacts.length - 3} more
              </button>
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if expanded}
    <div
      class="tool-card-details"
      id={bodyId}
      role="region"
      aria-label={`Tool details for ${toolTitle}`}
    >
      {#if toolCall.lifecycle && toolCall.lifecycle.length > 0}
        <dl class="tool-card-lifecycle tool-card-lifecycle-expanded" aria-label="Tool lifecycle">
          {#each toolCall.lifecycle as item (`expanded:${item.label}:${item.value}`)}
            <div class={lifecycleToneClass(item.tone)}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          {/each}
        </dl>
      {/if}

      {#if toolCall.children && toolCall.children.length > 0}
        <div class="tool-card-children" aria-label="Child commands">
          <span class="tool-card-section-label">Child commands</span>
          {#each toolCall.children as child (child.id)}
            <div class="tool-card-child-row">
              <GitPullRequestIcon size={13} />
              <StatusBadge status={child.status} size="xs" />
              <div>
                <strong>{child.title}</strong>
                {#if child.summary}
                  <p>{child.summary}</p>
                {/if}
              </div>
              {#if child.duration}
                <small>{child.duration}</small>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#each sections as section (section.id)}
        <div class={`tool-card-section ${sectionToneClass(section.tone)}`}>
          <div class="tool-card-section-header">
            <span class="tool-card-section-label">{section.title}</span>
            <button
              type="button"
              class="transcript-tool-icon-button"
              onclick={() => void copyText(section.content, section.id)}
              aria-label={copiedTarget === section.id ? `Copied ${section.title}` : `Copy ${section.title}`}
              title={copiedTarget === section.id ? "Copied" : `Copy ${section.title}`}
            >
              <CopyIcon size={13} />
            </button>
          </div>
          <pre class="transcript-tool-pre">{section.content}</pre>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .transcript-tool-card {
    width: 100%;
    max-width: 100%;
    border-radius: var(--ui-radius-md);
  }

  .transcript-tool-icon,
  .transcript-tool-pre {
    border-radius: var(--ui-radius-sm);
  }

  .transcript-tool-toggle {
    border-radius: var(--ui-radius-xs);
  }

  .transcript-tool-icon-button {
    display: inline-flex;
    width: 1.55rem;
    height: 1.55rem;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-xs);
    color: color-mix(in oklab, var(--ui-text-tertiary) 88%, transparent);
    transition:
      color 150ms ease,
      border-color 150ms ease,
      background-color 150ms ease;
  }

  .transcript-tool-icon-button:hover {
    border-color: var(--ui-border-soft);
    background: color-mix(in oklab, var(--ui-surface-subtle) 68%, transparent);
    color: var(--ui-text-secondary);
  }

  .transcript-tool-icon-button:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .tool-card-summary {
    display: grid;
    gap: 0.48rem;
    padding: 0 0.78rem 0.72rem 3.2rem;
  }

  .tool-card-summary p {
    margin: 0;
    color: var(--ui-text-secondary);
    font-size: var(--text-sm);
    line-height: 1.42;
  }

  .tool-card-lifecycle {
    display: flex;
    flex-wrap: wrap;
    gap: 0.36rem;
    margin: 0;
  }

  .tool-card-lifecycle div {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    max-width: 100%;
    padding: 0.18rem 0.42rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-xs);
    background: color-mix(in oklab, var(--ui-surface-subtle) 72%, transparent);
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.35;
  }

  .tool-card-lifecycle dt,
  .tool-card-lifecycle dd {
    margin: 0;
    min-width: 0;
  }

  .tool-card-lifecycle dd {
    color: var(--ui-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-card-lifecycle .tone-success dd {
    color: color-mix(in oklab, var(--ui-success) 78%, var(--ui-text-primary));
  }

  .tool-card-lifecycle .tone-warning dd {
    color: color-mix(in oklab, var(--ui-warning) 82%, var(--ui-text-primary));
  }

  .tool-card-lifecycle .tone-danger dd {
    color: color-mix(in oklab, var(--ui-danger) 82%, var(--ui-text-primary));
  }

  .tool-card-artifacts {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.36rem;
  }

  .tool-card-artifacts span,
  .tool-card-artifact-overflow {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
  }

  .tool-card-artifact-overflow {
    border-radius: var(--ui-radius-xs);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .tool-card-artifact-overflow:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .tool-card-details {
    display: grid;
    gap: 0.78rem;
    border-top: 1px solid color-mix(in oklab, var(--ui-border-soft) 74%, transparent);
    padding: 0.78rem;
    background: color-mix(in oklab, var(--ui-surface-subtle) 54%, transparent);
  }

  .tool-card-lifecycle-expanded {
    padding-bottom: 0.1rem;
  }

  .tool-card-children {
    display: grid;
    gap: 0.42rem;
  }

  .tool-card-child-row {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.45rem;
    padding: 0.48rem 0.55rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--ui-panel) 58%, transparent);
    color: var(--ui-text-secondary);
  }

  .tool-card-child-row strong,
  .tool-card-child-row p {
    margin: 0;
  }

  .tool-card-child-row strong {
    display: block;
    overflow: hidden;
    color: var(--ui-text-primary);
    font-size: var(--text-sm);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-card-child-row p {
    color: var(--ui-text-tertiary);
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .tool-card-child-row small {
    color: var(--ui-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .tool-card-section {
    display: grid;
    gap: 0.36rem;
  }

  .tool-card-section-header {
    display: flex;
    min-height: 1.55rem;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .tool-card-section-label {
    color: color-mix(in oklab, var(--ui-text-tertiary) 82%, var(--ui-text-primary));
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0;
    line-height: 1.3;
    text-transform: uppercase;
  }

  .tool-card-section.section-danger .tool-card-section-label {
    color: color-mix(in oklab, var(--ui-danger) 76%, var(--ui-text-primary));
  }

  .tool-card-section.section-waiting .tool-card-section-label {
    color: color-mix(in oklab, var(--ui-status-waiting) 76%, var(--ui-text-primary));
  }

  .transcript-tool-pre {
    max-height: 18rem;
    margin: 0;
    overflow: auto;
    padding: 0.62rem;
    border: 1px solid var(--ui-border-soft);
    background-color: var(--ui-code);
    color: var(--ui-text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .bg-code {
    background-color: var(--ui-code);
  }

  @media (max-width: 760px) {
    .transcript-tool-icon-button,
    .transcript-tool-toggle {
      width: 2.75rem;
      height: 2.75rem;
      padding: 0;
    }
  }
</style>
