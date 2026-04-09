	<script lang="ts">
	import { getModels, getProviders, modelsAreEqual, type Model } from "@mariozechner/pi-ai";
	import { onMount } from "svelte";
	import { discoverModels } from "./model-discovery";
	import { subsequenceScore, formatModelCost, formatTokenCount } from "./chat-format";
	import type { ChatStorage } from "./chat-storage";
	import Badge from "./ui/Badge.svelte";
	import Button from "./ui/Button.svelte";
	import Dialog from "./ui/Dialog.svelte";
	import Input from "./ui/Input.svelte";

	type Props = {
		currentModel: Model<any>;
		allowedProviders?: string[];
		storage?: ChatStorage;
		onClose: () => void;
		onSelect: (model: Model<any>) => void;
	};

	type ModelEntry = {
		id: string;
		provider: string;
		model: Model<any>;
	};

	let { currentModel, allowedProviders = [], storage, onClose, onSelect }: Props = $props();

	let searchQuery = $state("");
	let filterThinking = $state(false);
	let filterVision = $state(false);
	let customProviderModels = $state<ModelEntry[]>([]);
	let loadingCustomProviders = $state(false);

	onMount(() => {
		void loadCustomProviders();
	});

	async function loadCustomProviders() {
		if (!storage) return;
		loadingCustomProviders = true;
		const loaded: ModelEntry[] = [];

		try {
			const customProviders = await storage.customProviders.getAll();
			for (const provider of customProviders) {
				if (
					(provider.type === "ollama" ||
						provider.type === "llama.cpp" ||
						provider.type === "vllm" ||
						provider.type === "lmstudio") &&
					provider.baseUrl
				) {
					try {
						const discovered = await discoverModels(provider.type, provider.baseUrl, provider.apiKey);
						loaded.push(
							...discovered.map((model) => ({
								id: model.id,
								provider: provider.name,
								model: { ...model, provider: provider.name },
							})),
						);
					} catch (error) {
						console.debug(`Failed to discover models for ${provider.name}:`, error);
					}
					continue;
				}

				if (!provider.models) continue;
				loaded.push(
					...provider.models.map((model) => ({
						id: model.id,
						provider: provider.name,
						model: { ...model, provider: provider.name },
					})),
				);
			}
		} catch (error) {
			console.error("Failed to load custom providers:", error);
		} finally {
			customProviderModels = loaded;
			loadingCustomProviders = false;
		}
	}

	const filteredModels = $derived.by(() => {
		const providerAllowlist = new Set(allowedProviders);
		if (currentModel.provider) {
			providerAllowlist.add(currentModel.provider);
		}

		const entries: ModelEntry[] = [];
		for (const provider of getProviders()) {
			for (const model of getModels(provider)) {
				entries.push({ id: model.id, provider, model });
			}
		}
		entries.push(...customProviderModels);

		let visible = providerAllowlist.size > 0 ? entries.filter((entry) => providerAllowlist.has(entry.provider)) : entries;

		const normalizedQuery = searchQuery.toLowerCase().replace(/\s+/g, "");
		if (normalizedQuery) {
			const scored = visible
				.map((entry) => ({
					entry,
					score: subsequenceScore(
						normalizedQuery,
						`${entry.provider} ${entry.id} ${entry.model.name}`.toLowerCase(),
					),
				}))
				.filter((entry) => entry.score > 0)
				.sort((left, right) => right.score - left.score);
			visible = scored.map((entry) => entry.entry);
		}

		if (filterThinking) {
			visible = visible.filter((entry) => entry.model.reasoning);
		}
		if (filterVision) {
			visible = visible.filter((entry) => entry.model.input.includes("image"));
		}

		visible.sort((left, right) => {
			const leftIsCurrent = modelsAreEqual(currentModel, left.model);
			const rightIsCurrent = modelsAreEqual(currentModel, right.model);
			if (leftIsCurrent && !rightIsCurrent) return -1;
			if (!leftIsCurrent && rightIsCurrent) return 1;
			const providerComparison = left.provider.localeCompare(right.provider);
			return providerComparison === 0 ? left.model.name.localeCompare(right.model.name) : providerComparison;
		});

		return visible;
	});
</script>

<Dialog
	title="Select a model"
	eyebrow="Runtime Model"
	description="Choose the model hellm should use for future turns. Provider availability comes from Bun-side auth state plus any saved custom providers."
	width="lg"
	onClose={onClose}
>
	<div class="picker-header">
		<Input bind:value={searchQuery} placeholder="Search model families, providers, or ids" />
		<div class="picker-filters">
			<Button
				size="sm"
				variant={filterThinking ? "primary" : "secondary"}
				onclick={() => (filterThinking = !filterThinking)}
			>
				Thinking
			</Button>
			<Button size="sm" variant={filterVision ? "primary" : "secondary"} onclick={() => (filterVision = !filterVision)}>
				Vision
			</Button>
		</div>
	</div>
	<p class="picker-summary">{filteredModels.length} match{filteredModels.length === 1 ? "" : "es"}</p>

	{#if loadingCustomProviders}
		<p class="picker-status">Loading custom providers...</p>
	{/if}

	<div class="model-list" role="list">
		{#if filteredModels.length === 0}
			<p class="picker-status">No models match the current filters.</p>
		{/if}

		{#each filteredModels as entry (`${entry.provider}:${entry.id}`)}
			{@const isCurrent = modelsAreEqual(currentModel, entry.model)}
			<button class={`model-row ${isCurrent ? "current" : ""}`.trim()} type="button" onclick={() => onSelect(entry.model)}>
				<div class="model-copy">
					<div class="model-title">
						<strong>{entry.model.name}</strong>
						{#if isCurrent}
							<Badge tone="success">Current</Badge>
						{/if}
						{#if entry.model.reasoning}
							<Badge tone="info">Thinking</Badge>
						{/if}
						{#if entry.model.input.includes("image")}
							<Badge tone="warning">Vision</Badge>
						{/if}
					</div>
					<p>{entry.provider} · {entry.id}</p>
				</div>
				<div class="model-metrics">
					<span>{formatModelCost(entry.model)}</span>
					<span>{formatTokenCount(entry.model.contextWindow)} ctx</span>
				</div>
			</button>
		{/each}
	</div>
</Dialog>

<style>
	.picker-header {
		display: grid;
		gap: 0.8rem;
		padding: 0.9rem;
		margin-bottom: 0.8rem;
		border-radius: var(--ui-radius-md);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		background: color-mix(in oklab, var(--ui-surface-subtle) 72%, transparent);
	}

	.picker-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
	}

	.picker-summary {
		margin: 0 0 0.8rem;
		font-size: 0.74rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ui-text-secondary);
	}

	.model-list {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.model-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(8rem, auto);
		align-items: center;
		gap: 1.25rem;
		padding: 1.05rem 1rem 1.05rem 1.15rem;
		border-radius: 0;
		border: none;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
		border-left: 2px solid transparent;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition:
			transform 170ms cubic-bezier(0.19, 1, 0.22, 1),
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			box-shadow 170ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.model-row:hover {
		transform: none;
		border-left-color: color-mix(in oklab, var(--ui-border-strong) 72%, transparent);
		background: color-mix(in oklab, var(--ui-surface-subtle) 56%, transparent);
		box-shadow: none;
	}

	.model-row:focus-visible {
		outline: none;
		box-shadow: var(--ui-focus-ring);
	}

	.current {
		border-left-color: color-mix(in oklab, var(--ui-accent) 72%, var(--ui-accent-strong));
		background: color-mix(in oklab, var(--ui-accent-soft) 42%, transparent);
	}

	.model-copy {
		min-width: 0;
	}

	.model-title {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.model-title strong {
		font-size: 1rem;
		font-weight: 710;
		letter-spacing: -0.025em;
		color: var(--ui-text-primary);
	}

	.model-copy p,
	.picker-status {
		margin: 0.38rem 0 0;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--ui-text-secondary);
		font-family: var(--font-mono);
	}

	.model-metrics {
		display: grid;
		gap: 0.36rem;
		align-content: center;
		justify-items: end;
		min-width: 8rem;
		padding-left: 1rem;
		padding-right: 0.15rem;
		border-left: 1px solid color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
		font-size: 0.76rem;
		font-weight: 620;
		color: var(--ui-text-secondary);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 720px) {
		.model-row {
			grid-template-columns: 1fr;
			padding-right: 0.85rem;
		}

		.model-metrics {
			min-width: 0;
			padding-left: 0;
			padding-right: 0;
			border-left: none;
			justify-items: start;
		}
	}
</style>
