<script lang="ts" module>
  import type { ReferenceArtifact } from "./ArtifactChip.svelte";

  export type ReferenceEpisode = {
    id: string;
    title: string;
    summary: string;
    thread?: string;
    verified?: boolean;
    artifacts?: ReferenceArtifact[];
  };
</script>

<script lang="ts">
  import AlertTriangleIcon from "@lucide/svelte/icons/alert-triangle";
  import BookOpenIcon from "@lucide/svelte/icons/book-open";
  import CheckCircle2Icon from "@lucide/svelte/icons/check-circle-2";
  import ArtifactChip from "./ArtifactChip.svelte";

  type Props = {
    episode: ReferenceEpisode;
    class?: string;
    onartifactopen?: (artifact: ReferenceArtifact) => void;
  };

  let { episode, class: className = "", onartifactopen }: Props = $props();
</script>

<article class={`reference-episode-card ${className}`.trim()} data-testid={`episode-card-${episode.id}`}>
  <BookOpenIcon size={14} strokeWidth={2} class="episode-icon" />
  <div class="episode-copy">
    <header>
      <strong>{episode.title}</strong>
      <span class:verified={episode.verified}>
        {#if episode.verified}
          <CheckCircle2Icon size={11} strokeWidth={2} />
          verified
        {:else}
          <AlertTriangleIcon size={11} strokeWidth={2} />
          review
        {/if}
      </span>
    </header>
    <p>{episode.summary}</p>
    {#if episode.artifacts?.length}
      <div class="episode-artifacts">
        {#each episode.artifacts as artifact (artifact.id)}
          <ArtifactChip name={artifact.name} type={artifact.type} {artifact} onclick={onartifactopen} />
        {/each}
      </div>
    {/if}
    {#if episode.thread}
      <footer><small>Thread:</small><span>{episode.thread}</span></footer>
    {/if}
  </div>
</article>

<style>
  .reference-episode-card {
    display: flex;
    align-items: flex-start;
    gap: 0.56rem;
    padding: 0.68rem 0.78rem;
    border: 1px solid var(--ui-border-soft);
    border-radius: var(--ui-radius-md);
    background: var(--ui-surface);
  }

  .episode-icon {
    flex: 0 0 auto;
    margin-top: 0.12rem;
    color: var(--ui-text-tertiary);
  }

  .episode-copy {
    display: grid;
    gap: 0.42rem;
    min-width: 0;
    flex: 1;
  }

  header,
  header span,
  footer,
  .episode-artifacts {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  header {
    justify-content: space-between;
    gap: 0.6rem;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-primary);
    font-size: 0.74rem;
    font-weight: 650;
  }

  header span {
    gap: 0.22rem;
    flex: 0 0 auto;
    padding: 0.08rem 0.36rem;
    border: 1px solid color-mix(in oklab, var(--ui-warning) 25%, var(--ui-border-soft));
    border-radius: var(--ui-radius-sm);
    background: var(--ui-warning-soft);
    color: color-mix(in oklab, var(--ui-warning) 82%, var(--ui-text-primary));
    font-family: var(--font-mono);
    font-size: 0.56rem;
  }

  header span.verified {
    border-color: color-mix(in oklab, var(--ui-success) 25%, var(--ui-border-soft));
    background: var(--ui-success-soft);
    color: color-mix(in oklab, var(--ui-success) 78%, var(--ui-text-primary));
  }

  p {
    margin: 0;
    color: var(--ui-text-secondary);
    font-size: 0.68rem;
    line-height: 1.48;
  }

  .episode-artifacts {
    gap: 0.3rem;
    flex-wrap: wrap;
  }

  footer {
    gap: 0.28rem;
    color: var(--ui-text-tertiary);
    font-size: 0.58rem;
  }

  footer small,
  footer span {
    font-family: var(--font-mono);
  }
</style>
