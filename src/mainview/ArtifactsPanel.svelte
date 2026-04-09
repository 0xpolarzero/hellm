<script lang="ts">
	import type { ArtifactsController, ArtifactsSnapshot, ArtifactRecord } from "./artifacts";
	import { formatTimestamp } from "./chat-format";
	import { getArtifactKind } from "./artifacts";
	import Button from "./ui/Button.svelte";

	type Props = {
		controller: ArtifactsController;
		snapshot: ArtifactsSnapshot;
		overlay?: boolean;
		onClose: () => void;
	};

	let { controller, snapshot, overlay = false, onClose }: Props = $props();

	const activeArtifact = $derived.by(() => {
		if (snapshot.artifacts.length === 0) return null;
		return (
			snapshot.artifacts.find((artifact) => artifact.filename === snapshot.activeFilename) ??
			snapshot.artifacts[0] ??
			null
		);
	});

	function openArtifact(filename: string) {
		controller.selectArtifact(filename);
	}

	function svgDataUrl(artifact: ArtifactRecord): string {
		return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artifact.content)}`;
	}

	function imageSource(artifact: ArtifactRecord): string | null {
		if (artifact.content.startsWith("data:image/")) return artifact.content;
		if (getArtifactKind(artifact.filename) === "svg") return svgDataUrl(artifact);
		return null;
	}

	const activeKind = $derived(activeArtifact ? getArtifactKind(activeArtifact.filename) : null);
</script>

<section class={`artifacts-panel ${overlay ? "overlay" : ""}`.trim()}>
	<div class="artifacts-header">
		<div class="artifacts-heading">
			<p class="eyebrow">Artifact Deck</p>
			<h2>{snapshot.artifacts.length} output{snapshot.artifacts.length === 1 ? "" : "s"}</h2>
		</div>
		<Button size="sm" variant="ghost" onclick={onClose}>Close</Button>
	</div>

	{#if activeArtifact}
		<div class="artifacts-body">
			<div class="artifact-list" role="tablist" aria-label="Artifacts">
				{#each snapshot.artifacts as artifact (artifact.filename)}
					<button
						class={`tab ${artifact.filename === activeArtifact?.filename ? "active" : ""}`.trim()}
						type="button"
						role="tab"
						aria-selected={artifact.filename === activeArtifact?.filename}
						onclick={() => openArtifact(artifact.filename)}
					>
						<strong>{artifact.filename}</strong>
						<span>{getArtifactKind(artifact.filename)} · {formatTimestamp(artifact.updatedAt)}</span>
					</button>
				{/each}
			</div>

			<div class="artifact-stage">
				<div class="artifact-meta">
					<div>
						<p class="artifact-name">{activeArtifact.filename}</p>
						<p class="artifact-updated">Updated {formatTimestamp(activeArtifact.updatedAt)}</p>
					</div>
					<span class="artifact-kind">{activeKind}</span>
				</div>

				{#if activeKind === "html"}
					<iframe class="artifact-preview html-preview" title={activeArtifact.filename} srcdoc={controller.getPreviewDocument(activeArtifact.filename)}></iframe>
					{#if snapshot.logsByFilename[activeArtifact.filename]}
						<div class="artifact-logs">
							<p>Runtime logs</p>
							<pre>{snapshot.logsByFilename[activeArtifact.filename]}</pre>
						</div>
					{/if}
				{:else if activeKind === "image" || activeKind === "svg"}
					{@const source = imageSource(activeArtifact)}
					{#if source}
						<div class="artifact-media-shell">
							<img class="artifact-image" src={source} alt={activeArtifact.filename} />
						</div>
					{:else}
						<pre class="artifact-code">{activeArtifact.content}</pre>
					{/if}
				{:else}
					<pre class="artifact-code">{activeArtifact.content}</pre>
				{/if}
			</div>
		</div>
	{/if}
</section>

<style>
	.artifacts-panel {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		height: 100%;
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-panel-accent) 48%, transparent), transparent 7rem),
			linear-gradient(180deg, color-mix(in oklab, var(--ui-bg-elevated) 96%, transparent), var(--ui-surface));
	}

	.overlay {
		height: min(82vh, 44rem);
		border: 1px solid var(--ui-border-soft);
		border-radius: var(--ui-radius-lg);
		box-shadow: var(--ui-shadow-strong);
	}

	.artifacts-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 1rem 1rem 0.9rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
	}

	.eyebrow {
		margin: 0 0 0.22rem;
		font-size: 0.68rem;
		font-weight: 760;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ui-accent-strong);
	}

	h2 {
		margin: 0;
		font-size: 1.08rem;
		font-weight: 720;
		letter-spacing: -0.025em;
		color: var(--ui-text-primary);
	}

	.artifacts-body {
		display: grid;
		grid-template-columns: minmax(12rem, 15.5rem) minmax(0, 1fr);
		flex: 1;
		min-height: 0;
	}

	.artifact-list {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.8rem;
		border-right: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
		overflow: auto;
	}

	.tab {
		display: grid;
		gap: 0.18rem;
		padding: 0.72rem 0.82rem 0.72rem 0.9rem;
		border-radius: 0;
		border: none;
		border-left: 2px solid transparent;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			transform 170ms cubic-bezier(0.19, 1, 0.22, 1),
			box-shadow 170ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.tab:hover {
		transform: none;
		border-color: color-mix(in oklab, var(--ui-border-strong) 72%, transparent);
		background: color-mix(in oklab, var(--ui-surface-subtle) 68%, transparent);
		box-shadow: none;
	}

	.tab.active {
		border-color: color-mix(in oklab, var(--ui-accent) 34%, var(--ui-border-strong));
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-accent-soft) 68%, transparent), transparent);
	}

	.tab strong {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--ui-text-primary);
		word-break: break-word;
	}

	.tab span {
		font-size: 0.72rem;
		font-family: var(--font-mono);
		line-height: 1.45;
		color: var(--ui-text-secondary);
		word-break: break-word;
	}

	.artifact-stage {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 0.9rem 1rem 1rem;
	}

	.artifact-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.2rem 0 0.9rem;
		border-radius: 0;
		background: transparent;
		border: none;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
	}

	.artifact-name,
	.artifact-updated,
	.artifact-logs p {
		margin: 0;
	}

	.artifact-name {
		font-size: 0.96rem;
		font-weight: 710;
		letter-spacing: -0.02em;
		color: var(--ui-text-primary);
	}

	.artifact-updated,
	.artifact-logs p {
		margin-top: 0.2rem;
		font-size: 0.74rem;
		color: var(--ui-text-secondary);
		font-family: var(--font-mono);
	}

	.artifact-kind {
		padding: 0.36rem 0.62rem;
		border-radius: 999px;
		border: 1px solid color-mix(in oklab, var(--ui-accent) 22%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-accent-soft) 88%, transparent);
		font-size: 0.68rem;
		font-weight: 740;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: color-mix(in oklab, var(--ui-accent-strong) 84%, var(--ui-text-primary));
	}

	.artifact-preview,
	.artifact-code,
	.artifact-media-shell,
	.artifact-logs {
		border-radius: var(--ui-radius-sm);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
		background: color-mix(in oklab, var(--ui-bg-elevated) 96%, transparent);
	}

	.html-preview {
		flex: 1;
		min-height: 24rem;
		width: 100%;
		background: white;
	}

	.artifact-code,
	.artifact-logs pre {
		margin: 0;
		padding: 1rem 1.05rem;
		overflow: auto;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		line-height: 1.65;
		color: var(--ui-text-primary);
		white-space: pre-wrap;
	}

	.artifact-media-shell,
	.artifact-logs {
		padding: 1rem 1.05rem;
	}

	.artifact-image {
		display: block;
		max-width: 100%;
		max-height: 65vh;
		margin: 0 auto;
		object-fit: contain;
	}

	@container (max-width: 41rem) {
		.artifacts-body {
			grid-template-columns: 1fr;
		}

		.artifact-list {
			flex-direction: row;
			border-right: none;
			border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
			overflow-x: auto;
			overflow-y: hidden;
		}

		.tab {
			min-inline-size: 13rem;
		}
	}

	@media (max-width: 720px) {
		.artifact-stage {
			padding-inline: 0.8rem;
		}

		.artifact-meta {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
