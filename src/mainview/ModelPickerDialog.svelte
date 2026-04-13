<script lang="ts">
	import { getModels, getProviders, modelsAreEqual, type Model } from "@mariozechner/pi-ai";
	import { onMount } from "svelte";
	import { discoverModels } from "./model-discovery";
	import { searchScore, formatModelCost, formatTokenCount } from "./chat-format";
	import type { ChatStorage } from "./chat-storage";
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

	type ModelGroup = {
		key: string;
		provider: string;
		entries: ModelEntry[];
		topScore: number;
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

	function compareModelEntries(left: ModelEntry, right: ModelEntry): number {
		const leftIsCurrent = modelsAreEqual(currentModel, left.model);
		const rightIsCurrent = modelsAreEqual(currentModel, right.model);
		if (leftIsCurrent && !rightIsCurrent) return -1;
		if (!leftIsCurrent && rightIsCurrent) return 1;
		const providerComparison = left.provider.localeCompare(right.provider);
		return providerComparison === 0 ? left.model.name.localeCompare(right.model.name) : providerComparison;
	}

	function compareProviderNames(left: string, right: string): number {
		const leftIsCurrentProvider = left === currentModel.provider;
		const rightIsCurrentProvider = right === currentModel.provider;
		if (leftIsCurrentProvider && !rightIsCurrentProvider) return -1;
		if (!leftIsCurrentProvider && rightIsCurrentProvider) return 1;
		return left.localeCompare(right);
	}

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

	const groupedModels = $derived.by(() => {
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

		let visible = providerAllowlist.size > 0 ? entries.filter((entry) => providerAllowlist.has(entry.provider)) : [...entries];

		if (filterThinking) {
			visible = visible.filter((entry) => entry.model.reasoning);
		}
		if (filterVision) {
			visible = visible.filter((entry) => entry.model.input.includes("image"));
		}

		const searching = searchQuery.trim().length > 0;
		const scoredEntries = searching
			? visible
					.map((entry) => ({
						entry,
						score: searchScore(searchQuery, [entry.model.name, entry.id, entry.provider]),
					}))
					.filter((entry) => entry.score > 0)
			: visible.map((entry) => ({ entry, score: 0 }));

		const groupsByProvider = new Map<string, { provider: string; entries: typeof scoredEntries; topScore: number }>();
		for (const scoredEntry of scoredEntries) {
			const existing = groupsByProvider.get(scoredEntry.entry.provider);
			if (existing) {
				existing.entries.push(scoredEntry);
				existing.topScore = Math.max(existing.topScore, scoredEntry.score);
				continue;
			}
			groupsByProvider.set(scoredEntry.entry.provider, {
				provider: scoredEntry.entry.provider,
				entries: [scoredEntry],
				topScore: scoredEntry.score,
			});
		}

		const groups: ModelGroup[] = [];
		for (const group of groupsByProvider.values()) {
			groups.push({
				key: group.provider,
				provider: group.provider,
				topScore: group.topScore,
				entries: group.entries
					.toSorted((left, right) => {
						if (searching && right.score !== left.score) return right.score - left.score;
						return compareModelEntries(left.entry, right.entry);
					})
					.map((entry) => entry.entry),
			});
		}

		return groups.toSorted((left, right) => {
			if (searching && right.topScore !== left.topScore) return right.topScore - left.topScore;
			return compareProviderNames(left.provider, right.provider);
		});
	});

	const filteredModelCount = $derived.by(() =>
		groupedModels.reduce((count, group) => count + group.entries.length, 0),
	);
</script>

<Dialog
	title="Select a model"
	eyebrow="Runtime Model"
	description="Choose the model svvy should use for future turns. Provider availability comes from Bun-side auth state plus any saved custom providers."
	width="lg"
	onClose={onClose}
>
	<div class="picker-header">
		<div class="picker-search">
			<Input bind:value={searchQuery} placeholder="Search model families, providers, or ids" />
			<p class="picker-summary">{filteredModelCount} match{filteredModelCount === 1 ? "" : "es"}</p>
		</div>
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

	{#if loadingCustomProviders}
		<p class="picker-status">Loading custom providers...</p>
	{/if}

	<div class="model-list" role="list">
		{#if filteredModelCount === 0}
			<p class="picker-status">No models match the current filters.</p>
		{/if}

		{#each groupedModels as group (group.key)}
			<section class="model-group" aria-label={group.provider}>
				<header class="model-group-header">
					<h3>{group.provider}</h3>
					<span>{group.entries.length}</span>
				</header>
				<div class="model-group-rows">
					{#each group.entries as entry (`${entry.provider}:${entry.id}`)}
						{@const isCurrent = modelsAreEqual(currentModel, entry.model)}
						<button class={`model-row ${isCurrent ? "current" : ""}`.trim()} type="button" onclick={() => onSelect(entry.model)}>
							<div class="model-copy">
								<div class="model-title">
									<strong>{entry.model.name}</strong>
								</div>
								<p>
									{entry.id}
									{#if entry.model.reasoning}
										· thinking
									{/if}
									{#if entry.model.input.includes("image")}
										· vision
									{/if}
								</p>
							</div>
							<div class="model-metrics">
								{#if isCurrent}
									<span class="model-state">Current</span>
								{/if}
								<span>{formatModelCost(entry.model)}</span>
								<span>{formatTokenCount(entry.model.contextWindow)} ctx</span>
							</div>
						</button>
					{/each}
				</div>
			</section>
		{/each}
	</div>
</Dialog>

<style>
	.picker-header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.8rem;
		position: sticky;
		top: 0;
		z-index: var(--ui-z-sticky);
		margin-bottom: 0.95rem;
		padding: 0.9rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-md);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-raised) 74%, transparent), transparent),
			var(--ui-surface-subtle);
		box-shadow: var(--ui-shadow-soft);
	}

	.picker-search {
		display: grid;
		gap: 0.46rem;
		flex: 1;
		min-width: 0;
	}

	.picker-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.picker-summary {
		margin: 0;
		font-size: 0.68rem;
		font-family: var(--font-mono);
		color: var(--ui-text-secondary);
	}

	.model-list {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}

	.model-group {
		display: grid;
		gap: 0.42rem;
	}

	.model-group-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.65rem;
		padding: 0 0.2rem;
	}

	.model-group-header h3 {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 620;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--ui-text-secondary);
	}

	.model-group-header span {
		font-size: 0.66rem;
		font-family: var(--font-mono);
		color: var(--ui-text-tertiary);
	}

	.model-group-rows {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.model-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(10.5rem, auto);
		align-items: center;
		gap: 1.1rem;
		padding: 0.9rem 0.95rem 0.9rem 1rem;
		border-radius: var(--ui-radius-md);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-raised) 74%, transparent), transparent),
			var(--ui-surface);
		text-align: left;
		cursor: pointer;
		transition:
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.model-row:hover {
		border-color: color-mix(in oklab, var(--ui-border-strong) 72%, transparent);
		background: color-mix(in oklab, var(--ui-surface-raised) 90%, transparent);
	}

	.model-row:focus-visible {
		outline: none;
		box-shadow: var(--ui-focus-ring);
	}

	.current {
		border-color: color-mix(in oklab, var(--ui-border-accent) 82%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-accent-soft) 72%, var(--ui-surface-raised));
	}

	.model-copy {
		min-width: 0;
	}

	.model-title strong {
		font-size: 0.9rem;
		font-weight: 660;
		letter-spacing: -0.015em;
		color: var(--ui-text-primary);
	}

	.model-copy p,
	.picker-status {
		margin: 0.26rem 0 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: var(--ui-text-secondary);
		font-family: var(--font-mono);
	}

	.model-metrics {
		display: grid;
		gap: 0.22rem;
		align-content: center;
		justify-items: end;
		min-width: 10.5rem;
		padding-left: 1.1rem;
		padding-right: 0.2rem;
		border-left: 1px solid color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
		font-size: 0.72rem;
		font-weight: 540;
		color: var(--ui-text-secondary);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}

	.model-state {
		color: color-mix(in oklab, var(--ui-accent-strong) 82%, var(--ui-text-primary));
	}

	@media (max-width: 760px) {
		.picker-header {
			flex-direction: column;
			align-items: stretch;
		}

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
