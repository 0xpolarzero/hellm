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
	let activeView = $state<"preview" | "raw" | "metadata">("preview");

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
		activeView = "preview";
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
			<h2>Artifacts</h2>
			<p class="artifact-count">{snapshot.artifacts.length} output{snapshot.artifacts.length === 1 ? "" : "s"}</p>
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

				<div class="artifact-view-tabs" aria-label="Artifact preview modes">
					<button type="button" class:active={activeView === "preview"} onclick={() => (activeView = "preview")}>
						Preview
					</button>
					<button type="button" class:active={activeView === "raw"} onclick={() => (activeView = "raw")}>
						Raw
					</button>
					<button type="button" class:active={activeView === "metadata"} onclick={() => (activeView = "metadata")}>
						Metadata
					</button>
				</div>

				{#if activeView === "metadata"}
					<pre class="artifact-code">{JSON.stringify({ filename: activeArtifact.filename, kind: activeKind, updatedAt: activeArtifact.updatedAt, bytes: activeArtifact.content.length }, null, 2)}</pre>
				{:else if activeView === "raw"}
					<pre class="artifact-code">{activeArtifact.content}</pre>
				{:else if activeKind === "html"}
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
			linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-raised) 78%, transparent), transparent),
			var(--ui-surface);
	}

	.overlay {
		height: min(82vh, 44rem);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		border-radius: var(--ui-radius-lg);
		box-shadow: var(--ui-shadow-strong);
	}

	.artifacts-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.82rem 0.9rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
		background: color-mix(in oklab, var(--ui-surface-subtle) 92%, transparent);
	}

	.artifacts-heading {
		display: grid;
		gap: 0.16rem;
	}

	h2 {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 660;
		letter-spacing: -0.03em;
		color: var(--ui-text-primary);
	}

	.artifact-count {
		margin: 0;
		font-size: 0.68rem;
		font-family: var(--font-mono);
		color: var(--ui-text-secondary);
	}

	.artifacts-body {
		display: grid;
		grid-template-columns: minmax(13rem, 16rem) minmax(0, 1fr);
		flex: 1;
		min-height: 0;
	}

	.artifact-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.7rem;
		border-right: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
		overflow: auto;
		background: color-mix(in oklab, var(--ui-surface-subtle) 84%, transparent);
	}

	.tab {
		display: grid;
		gap: 0.22rem;
		padding: 0.68rem 0.82rem;
		border-radius: var(--ui-radius-md);
		border: 1px solid transparent;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.tab:hover {
		border-color: color-mix(in oklab, var(--ui-border-strong) 72%, transparent);
		background: color-mix(in oklab, var(--ui-surface-raised) 82%, transparent);
	}

	.tab.active {
		border-color: color-mix(in oklab, var(--ui-border-accent) 76%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-accent-soft) 72%, var(--ui-surface-raised));
	}

	.tab strong {
		font-size: 0.78rem;
		font-weight: 640;
		color: var(--ui-text-primary);
		word-break: break-word;
	}

	.tab span {
		font-size: 0.69rem;
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
		padding: 0.9rem;
	}

	.artifact-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.82rem 0.88rem;
		border-radius: var(--ui-radius-md);
		background: color-mix(in oklab, var(--ui-surface-subtle) 88%, transparent);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
	}

	.artifact-view-tabs {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		overflow-x: auto;
	}

	.artifact-view-tabs button {
		min-height: 1.7rem;
		padding: 0.18rem 0.58rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: var(--ui-text-secondary);
		font: inherit;
		font-size: 0.7rem;
		cursor: pointer;
	}

	.artifact-view-tabs button:hover,
	.artifact-view-tabs button.active {
		background: color-mix(in oklab, var(--ui-surface-raised) 84%, transparent);
		color: var(--ui-text-primary);
	}

	.artifact-view-tabs button.active {
		border-color: color-mix(in oklab, var(--ui-border-accent) 72%, var(--ui-border-soft));
	}

	.artifact-name,
	.artifact-updated,
	.artifact-logs p {
		margin: 0;
	}

	.artifact-name {
		font-size: 0.94rem;
		font-weight: 660;
		letter-spacing: -0.02em;
		color: var(--ui-text-primary);
	}

	.artifact-updated,
	.artifact-logs p {
		margin-top: 0.2rem;
		font-size: 0.68rem;
		color: var(--ui-text-secondary);
		font-family: var(--font-mono);
	}

	.artifact-kind {
		font-size: 0.68rem;
		font-family: var(--font-mono);
		padding: 0.3rem 0.55rem;
		border-radius: var(--ui-radius-sm);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 90%, transparent);
		background: color-mix(in oklab, var(--ui-surface-raised) 82%, transparent);
		color: var(--ui-text-secondary);
	}

	.artifact-preview,
	.artifact-code,
	.artifact-media-shell,
	.artifact-logs {
		border-radius: var(--ui-radius-md);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		background: color-mix(in oklab, var(--ui-code) 94%, transparent);
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
		font-size: 0.76rem;
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

	@media (max-width: 760px) {
		.artifact-stage {
			padding-inline: 0.8rem;
		}

		.artifact-meta {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
