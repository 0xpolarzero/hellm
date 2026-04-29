<script lang="ts" module>
  export type ArtifactType = "diff" | "log" | "screenshot" | "report" | "html" | "json" | "file";

  export type ReferenceArtifact = {
    id: string;
    name: string;
    type: ArtifactType;
    size?: string;
    age?: string;
    path?: string;
  };
</script>

<script lang="ts">
  import BarChart2Icon from "@lucide/svelte/icons/bar-chart-2";
  import FileCodeIcon from "@lucide/svelte/icons/file-code";
  import FileJsonIcon from "@lucide/svelte/icons/file-json";
  import FileTextIcon from "@lucide/svelte/icons/file-text";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import ImageIcon from "@lucide/svelte/icons/image";

  type Props = {
    name: string;
    type?: ArtifactType;
    artifact?: ReferenceArtifact;
    class?: string;
    onclick?: (artifact: ReferenceArtifact) => void;
  };

  let { name, type = "log", artifact, class: className = "", onclick }: Props = $props();

  const typeConfig = {
    diff: { icon: GitBranchIcon, label: "diff" },
    log: { icon: FileTextIcon, label: "log" },
    screenshot: { icon: ImageIcon, label: "png" },
    report: { icon: BarChart2Icon, label: "report" },
    html: { icon: FileCodeIcon, label: "html" },
    json: { icon: FileJsonIcon, label: "json" },
    file: { icon: FileTextIcon, label: "file" },
  } as const;

  const config = $derived(typeConfig[type] ?? typeConfig.log);
  const target = $derived(artifact ?? { id: name, name, type });

  function handleClick() {
    onclick?.(target);
  }
</script>

<button
  type="button"
  class={`reference-artifact-chip tone-${type} ${className}`.trim()}
  onclick={handleClick}
  data-testid={`artifact-chip-${name}`}
  title={`${config.label}: ${name}`}
>
  <config.icon size={11} strokeWidth={2} />
  <span>{name}</span>
</button>

<style>
  .reference-artifact-chip {
    --artifact-color: var(--ui-text-tertiary);
    --artifact-soft: var(--ui-surface-muted);
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    max-width: 12rem;
    min-height: 1.18rem;
    padding: 0.08rem 0.38rem;
    border: 1px solid color-mix(in oklab, var(--artifact-color) 24%, var(--ui-border-soft));
    border-radius: var(--ui-radius-sm);
    background: color-mix(in oklab, var(--artifact-soft) 82%, transparent);
    color: color-mix(in oklab, var(--artifact-color) 78%, var(--ui-text-primary));
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 650;
    line-height: 1;
    cursor: pointer;
    transition:
      border-color 140ms ease,
      background-color 140ms ease,
      color 140ms ease,
      opacity 140ms ease;
  }

  .reference-artifact-chip:hover {
    opacity: 0.82;
  }

  .reference-artifact-chip:focus-visible {
    outline: none;
    box-shadow: var(--ui-focus-ring);
  }

  .reference-artifact-chip span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tone-diff {
    --artifact-color: var(--ui-info);
    --artifact-soft: var(--ui-info-soft);
  }

  .tone-screenshot {
    --artifact-color: hsl(268 83% 65%);
    --artifact-soft: hsl(268 83% 65% / 0.1);
  }

  .tone-report {
    --artifact-color: hsl(188 86% 45%);
    --artifact-soft: hsl(188 86% 45% / 0.1);
  }

  .tone-html {
    --artifact-color: var(--ui-accent);
    --artifact-soft: var(--ui-accent-soft);
  }

  .tone-json {
    --artifact-color: var(--ui-warning);
    --artifact-soft: var(--ui-warning-soft);
  }
</style>
