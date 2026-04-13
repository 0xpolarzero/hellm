<script lang="ts">
	import { onMount } from "svelte";
	import { searchScore } from "./chat-format";
	import type { ProviderAuthInfo } from "./chat-rpc";
	import { rpc } from "./rpc";
	import Button from "./ui/Button.svelte";
	import Dialog from "./ui/Dialog.svelte";
	import Input from "./ui/Input.svelte";

	type Props = {
		onClose: () => void;
		onProviderAuthChanged?: (providerId: string) => void | Promise<void>;
	};

	type SettingsSection = "providers";

	let { onClose, onProviderAuthChanged }: Props = $props();

	let activeSection = $state<SettingsSection>("providers");
	let providers = $state<ProviderAuthInfo[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let searchQuery = $state("");
	let editingProvider = $state<string | null>(null);
	let apiKeyInput = $state<Record<string, string>>({});
	let oauthLoading = $state<Record<string, boolean>>({});
	let saveMessage = $state<Record<string, string>>({});

	async function refreshProviders() {
		error = null;
		try {
			providers = await rpc.request.listProviderAuths();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to load providers";
		}
	}

	async function notifyAuthChanged(providerId: string) {
		await onProviderAuthChanged?.(providerId);
	}

	function setTimedSaveMessage(providerId: string, message: string, timeoutMs: number) {
		saveMessage[providerId] = message;
		setTimeout(() => {
			saveMessage[providerId] = "";
		}, timeoutMs);
	}

	function providerStatus(info: ProviderAuthInfo) {
		if (!info.hasKey) return { text: "Not configured", tone: "neutral" as const };
		if (info.keyType === "oauth") return { text: "OAuth", tone: "success" as const };
		if (info.keyType === "env") return { text: "Env var", tone: "warning" as const };
		return { text: "API key", tone: "info" as const };
	}

	const filteredProviders = $derived.by(() => {
		if (!searchQuery.trim()) {
			return [...providers].toSorted((left, right) => {
				if (left.hasKey !== right.hasKey) return left.hasKey ? -1 : 1;
				return left.provider.localeCompare(right.provider);
			});
		}

		return providers
			.map((info) => {
				const status = providerStatus(info);
				const haystack = [
					info.provider,
					status.text,
					info.supportsOAuth ? "oauth api key" : "api key only",
					info.keyType,
				]
					.join(" ")
					.toLowerCase();

				return {
					info,
					score: searchScore(searchQuery, [haystack]),
				};
			})
			.filter((entry) => entry.score > 0)
			.toSorted((left, right) => {
				if (right.score !== left.score) return right.score - left.score;
				if (left.info.hasKey !== right.info.hasKey) return left.info.hasKey ? -1 : 1;
				return left.info.provider.localeCompare(right.info.provider);
			})
			.map((entry) => entry.info);
	});

	onMount(async () => {
		await refreshProviders();
		loading = false;
	});

	async function handleSaveApiKey(providerId: string) {
		const key = apiKeyInput[providerId]?.trim();
		if (!key) return;
		try {
			await rpc.request.setProviderApiKey({ providerId, apiKey: key });
			apiKeyInput[providerId] = "";
			editingProvider = null;
			await refreshProviders();
			await notifyAuthChanged(providerId);
			setTimedSaveMessage(providerId, "Saved", 2000);
		} catch (err) {
			saveMessage[providerId] = err instanceof Error ? err.message : "Failed";
		}
	}

	async function handleOAuth(providerId: string) {
		oauthLoading[providerId] = true;
		saveMessage[providerId] = "";
		try {
			const result = await rpc.request.startOAuth({ providerId });
			if (result.ok) {
				await refreshProviders();
				await notifyAuthChanged(providerId);
				setTimedSaveMessage(providerId, "Connected", 3000);
			} else {
				saveMessage[providerId] = result.error ?? "OAuth failed";
			}
		} catch (err) {
			saveMessage[providerId] = err instanceof Error ? err.message : "OAuth failed";
		} finally {
			oauthLoading[providerId] = false;
		}
	}

	async function handleRemove(providerId: string) {
		try {
			await rpc.request.removeProviderAuth({ providerId });
			await refreshProviders();
			await notifyAuthChanged(providerId);
			setTimedSaveMessage(providerId, "Removed", 2000);
		} catch (err) {
			saveMessage[providerId] = err instanceof Error ? err.message : "Failed to remove provider";
		}
	}
</script>

<Dialog
	title="Settings"
	eyebrow="Workbench"
	description="Configure runtime integrations and account access. Credentials stay local in ~/.config/svvy/auth.json, and environment variables still take precedence."
	width="lg"
	onClose={onClose}
>
	<div class="settings-shell">
		<aside class="settings-nav" aria-label="Settings sections">
			<p class="settings-nav-label">Sections</p>
			<button
				class={`settings-nav-item ${activeSection === "providers" ? "active" : ""}`.trim()}
				type="button"
				aria-current={activeSection === "providers" ? "page" : undefined}
				onclick={() => (activeSection = "providers")}
			>
				<span>Providers</span>
				<span>{providers.length}</span>
			</button>
		</aside>

		<section class="settings-pane">
			{#if activeSection === "providers"}
				<div class="settings-search">
					<Input bind:value={searchQuery} placeholder="Search providers, auth types, or access state" />
					<p class="settings-search-summary">
						{filteredProviders.length} match{filteredProviders.length === 1 ? "" : "es"}
					</p>
				</div>

				{#if loading}
					<p class="loading">Loading providers...</p>
				{:else if error}
					<p class="error">{error}</p>
				{:else}
					<div class="provider-list" role="list">
						{#if filteredProviders.length === 0}
							<p class="provider-empty">No providers match the current search.</p>
						{/if}

						{#each filteredProviders as info (info.provider)}
							{@const status = providerStatus(info)}
							{@const isEditing = editingProvider === info.provider}
							<article class="provider-row">
								<div class="provider-main">
									<div class="provider-heading">
										<span class="provider-name">{info.provider}</span>
										<span class={`provider-status tone-${status.tone}`.trim()}>{status.text}</span>
									</div>
									<p class="provider-meta">
										{#if info.supportsOAuth}
											OAuth and API-key login supported.
										{:else}
											API-key authentication only.
										{/if}
									</p>
									{#if saveMessage[info.provider]}
										<p class="save-msg">{saveMessage[info.provider]}</p>
									{/if}
								</div>

								<div class="provider-actions">
									{#if isEditing}
										<div class="key-input-row">
											<Input
												type="password"
												placeholder="Paste API key..."
												bind:value={apiKeyInput[info.provider]}
												onkeydown={(event) => event.key === "Enter" && handleSaveApiKey(info.provider)}
											/>
											<Button variant="primary" size="sm" onclick={() => handleSaveApiKey(info.provider)}>
												Save
											</Button>
											<Button
												size="sm"
												onclick={() => {
													editingProvider = null;
													apiKeyInput[info.provider] = "";
												}}
											>
												Cancel
											</Button>
										</div>
									{:else}
										{#if info.hasKey}
											<Button variant="danger" size="sm" onclick={() => handleRemove(info.provider)}>
												Remove
											</Button>
										{/if}
										<Button
											size="sm"
											onclick={() => {
												editingProvider = info.provider;
												apiKeyInput[info.provider] = "";
											}}
										>
											API Key
										</Button>
										{#if info.supportsOAuth}
											<Button
												variant="success"
												size="sm"
												disabled={oauthLoading[info.provider]}
												onclick={() => handleOAuth(info.provider)}
											>
												{oauthLoading[info.provider] ? "Waiting..." : "OAuth"}
											</Button>
										{/if}
									{/if}
								</div>
							</article>
						{/each}
					</div>
				{/if}
			{/if}
		</section>
	</div>
</Dialog>

<style>
	.settings-shell {
		display: grid;
		grid-template-columns: minmax(10.5rem, 11.75rem) minmax(0, 1fr);
		gap: 1rem;
		min-height: 0;
	}

	.settings-nav {
		display: grid;
		align-content: start;
		gap: 0.45rem;
		padding: 0.3rem 0.25rem 0 0;
		border-right: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
	}

	.settings-nav-label,
	.settings-search-summary,
	.save-msg {
		margin: 0;
		font-size: 0.68rem;
		font-family: var(--font-mono);
		color: var(--ui-text-secondary);
	}

	.settings-nav-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.7rem;
		padding: 0.66rem 0.72rem;
		border: 1px solid transparent;
		border-radius: var(--ui-radius-md);
		background: transparent;
		color: var(--ui-text-primary);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			color 170ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.settings-nav-item span:first-child {
		font-size: 0.8rem;
		font-weight: 620;
	}

	.settings-nav-item span:last-child {
		font-size: 0.66rem;
		font-family: var(--font-mono);
		color: var(--ui-text-tertiary);
	}

	.settings-nav-item:hover,
	.settings-nav-item:focus-visible {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-border-strong) 76%, transparent);
		background: color-mix(in oklab, var(--ui-surface-raised) 72%, transparent);
	}

	.settings-nav-item.active {
		border-color: color-mix(in oklab, var(--ui-border-accent) 78%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-accent-soft) 72%, var(--ui-surface-raised));
	}

	.settings-pane {
		display: grid;
		align-content: start;
		gap: 0.95rem;
		min-width: 0;
		min-height: 0;
	}

	.settings-search {
		display: grid;
		gap: 0.46rem;
		position: sticky;
		top: 0;
		z-index: var(--ui-z-sticky);
		padding: 0.85rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-md);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-raised) 74%, transparent), transparent),
			var(--ui-surface-subtle);
		box-shadow: var(--ui-shadow-soft);
	}

	.loading,
	.error,
	.provider-empty {
		margin: 0;
		font-size: 0.84rem;
		color: var(--ui-text-secondary);
	}

	.error {
		color: color-mix(in oklab, var(--ui-danger) 84%, var(--ui-text-primary));
	}

	.provider-list {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.provider-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(13rem, auto);
		align-items: start;
		gap: 0.9rem 1.2rem;
		padding: 1rem 1rem 1rem 1.05rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-md);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-raised) 74%, transparent), transparent),
			var(--ui-surface);
		box-shadow: var(--ui-shadow-soft);
	}

	.provider-main {
		display: grid;
		gap: 0.3rem;
		min-width: 0;
	}

	.provider-heading {
		display: flex;
		align-items: center;
		gap: 0.45rem 0.6rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.provider-name {
		font-size: 0.9rem;
		font-weight: 660;
		letter-spacing: -0.02em;
	}

	.provider-status {
		font-size: 0.68rem;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ui-text-secondary);
	}

	.provider-status.tone-success {
		color: color-mix(in oklab, var(--ui-success) 78%, var(--ui-text-primary));
	}

	.provider-status.tone-warning {
		color: color-mix(in oklab, var(--ui-warning) 82%, var(--ui-text-primary));
	}

	.provider-status.tone-info {
		color: color-mix(in oklab, var(--ui-info) 78%, var(--ui-text-primary));
	}

	.provider-meta {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.6;
		color: var(--ui-text-secondary);
	}

	.save-msg {
		color: var(--ui-accent-strong);
	}

	.provider-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.45rem;
		min-width: 13rem;
		padding-left: 1.05rem;
		border-left: 1px solid color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
		flex-wrap: wrap;
	}

	.key-input-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	:global(.key-input-row .ui-input) {
		font-size: 0.8rem;
		width: min(340px, 70vw);
	}

	@media (max-width: 760px) {
		.settings-shell {
			grid-template-columns: minmax(0, 1fr);
		}

		.settings-nav {
			padding: 0 0 0.2rem;
			border-right: none;
			border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		}

		.provider-row {
			grid-template-columns: 1fr;
		}

		.provider-actions {
			width: 100%;
			min-width: 0;
			justify-content: flex-start;
			padding-left: 0;
			border-left: none;
		}

		.key-input-row {
			width: 100%;
			justify-content: flex-start;
		}

		:global(.key-input-row .ui-input) {
			width: 100%;
		}
	}
</style>
