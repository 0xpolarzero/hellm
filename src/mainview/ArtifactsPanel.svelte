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
			<p class="eyebrow">Artifacts</p>
			<h2>{snapshot.artifacts.length} file{snapshot.artifacts.length === 1 ? "" : "s"}</h2>
		</div>
		<Button size="sm" variant="ghost" onclick={onClose}>Close</Button>
	</div>

	<div class="tab-strip" role="tablist" aria-label="Artifacts">
		{#each snapshot.artifacts as artifact (artifact.filename)}
			<button
				class={`tab ${artifact.filename === activeArtifact?.filename ? "active" : ""}`.trim()}
				type="button"
				role="tab"
				aria-selected={artifact.filename === activeArtifact?.filename}
				onclick={() => openArtifact(artifact.filename)}
			>
				{artifact.filename}
			</button>
		{/each}
	</div>

	{#if activeArtifact}
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
	{/if}
</section>

<style>
	.artifacts-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		background:
			radial-gradient(circle at top left, rgba(14, 165, 233, 0.08), transparent 34%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.98));
	}

	.overlay {
		border-left: none;
	}

	.artifacts-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 1rem 1rem 0.8rem;
		border-bottom: 1px solid rgba(203, 213, 225, 0.86);
	}

	.eyebrow {
		margin: 0 0 0.22rem;
		font-size: 0.7rem;
		font-weight: 760;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ui-accent-strong);
	}

	h2 {
		margin: 0;
		font-size: 1.02rem;
		font-weight: 730;
		color: var(--ui-text-primary);
	}

	.tab-strip {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem 1rem 0;
		overflow-x: auto;
	}

	.tab {
		padding: 0.55rem 0.78rem;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.26);
		background: rgba(255, 255, 255, 0.78);
		color: var(--ui-text-secondary);
		font-family: "SF Mono", "Menlo", monospace;
		font-size: 0.75rem;
		cursor: pointer;
		white-space: nowrap;
		transition:
			border-color 140ms ease,
			background-color 140ms ease,
			color 140ms ease;
	}

	.tab:hover {
		border-color: rgba(14, 116, 144, 0.3);
		color: var(--ui-text-primary);
	}

	.tab.active {
		border-color: rgba(14, 116, 144, 0.34);
		background: rgba(224, 242, 254, 0.9);
		color: #0f172a;
	}

	.artifact-stage {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.85rem 1rem 1rem;
	}

	.artifact-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.8rem 0.9rem;
		border-radius: calc(var(--ui-radius-md) + 0.08rem);
		background: rgba(255, 255, 255, 0.76);
		border: 1px solid rgba(203, 213, 225, 0.7);
	}

	.artifact-name,
	.artifact-updated,
	.artifact-logs p {
		margin: 0;
	}

	.artifact-name {
		font-size: 0.92rem;
		font-weight: 700;
		color: var(--ui-text-primary);
	}

	.artifact-updated,
	.artifact-logs p {
		margin-top: 0.2rem;
		font-size: 0.76rem;
		color: var(--ui-text-secondary);
	}

	.artifact-kind {
		padding: 0.3rem 0.58rem;
		border-radius: 999px;
		background: rgba(226, 232, 240, 0.9);
		font-size: 0.7rem;
		font-weight: 720;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #475569;
	}

	.artifact-preview,
	.artifact-code,
	.artifact-media-shell,
	.artifact-logs {
		border-radius: calc(var(--ui-radius-md) + 0.12rem);
		border: 1px solid rgba(203, 213, 225, 0.76);
		background: rgba(255, 255, 255, 0.84);
	}

	.html-preview {
		flex: 1;
		min-height: 24rem;
		width: 100%;
		border: 1px solid rgba(203, 213, 225, 0.82);
		background: white;
	}

	.artifact-code,
	.artifact-logs pre {
		margin: 0;
		padding: 1rem;
		overflow: auto;
		font-family: "SF Mono", "Menlo", monospace;
		font-size: 0.8rem;
		line-height: 1.65;
		color: #0f172a;
		white-space: pre-wrap;
	}

	.artifact-media-shell,
	.artifact-logs {
		padding: 1rem;
	}

	.artifact-image {
		display: block;
		max-width: 100%;
		max-height: 65vh;
		margin: 0 auto;
		object-fit: contain;
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
