<script lang="ts">
	import { onMount } from "svelte";
	import type { ProviderAuthInfo } from "./chat-rpc";
	import { rpc } from "./rpc";
	import Badge from "./ui/Badge.svelte";
	import Button from "./ui/Button.svelte";
	import Dialog from "./ui/Dialog.svelte";
	import Input from "./ui/Input.svelte";

	type Props = {
		onClose: () => void;
		onProviderAuthChanged?: (providerId: string) => void | Promise<void>;
	};

	let { onClose, onProviderAuthChanged }: Props = $props();

	let providers = $state<ProviderAuthInfo[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
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

	function statusBadge(info: ProviderAuthInfo) {
		if (!info.hasKey) return { text: "Not configured", tone: "neutral" as const };
		if (info.keyType === "oauth") return { text: "OAuth", tone: "success" as const };
		if (info.keyType === "env") return { text: "Env var", tone: "warning" as const };
		return { text: "API key", tone: "info" as const };
	}
</script>

<Dialog
	title="Configure AI providers"
	eyebrow="Provider Access"
	description="Store credentials locally in ~/.config/hellm/auth.json. Environment variables still take precedence when present."
	onClose={onClose}
>
	{#if loading}
		<p class="loading">Loading providers...</p>
	{:else if error}
		<p class="error">{error}</p>
	{:else}
		<div class="provider-list">
			{#each providers as info (info.provider)}
				{@const badge = statusBadge(info)}
				{@const isEditing = editingProvider === info.provider}
				<article class="provider-row">
					<div class="provider-main">
						<div class="provider-info">
							<span class="provider-name">{info.provider}</span>
							<Badge tone={badge.tone}>{badge.text}</Badge>
							{#if saveMessage[info.provider]}
								<span class="save-msg">{saveMessage[info.provider]}</span>
							{/if}
						</div>
						<p class="provider-meta">
							{#if info.supportsOAuth}
								Supports OAuth and API-key login.
							{:else}
								Uses API-key authentication only.
							{/if}
						</p>
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
								Set Key
							</Button>
							{#if info.supportsOAuth}
								<Button
									variant="success"
									size="sm"
									disabled={oauthLoading[info.provider]}
									onclick={() => handleOAuth(info.provider)}
								>
									{oauthLoading[info.provider] ? "Waiting..." : "Login with OAuth"}
								</Button>
							{/if}
							{/if}
						</div>
				</article>
			{/each}
		</div>
	{/if}
</Dialog>

<style>
	.loading,
	.error {
		margin: 0;
		font-size: 0.9rem;
		color: var(--ui-text-secondary);
	}

	.error {
		color: color-mix(in oklab, var(--ui-danger) 84%, var(--ui-text-primary));
	}

	.provider-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.provider-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(13rem, auto);
		align-items: start;
		padding: 1.15rem 1rem 1.15rem 1.15rem;
		gap: 1.2rem 1.35rem;
		border: none;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 82%, transparent);
		border-radius: 0;
		box-shadow: none;
		background: transparent;
	}

	.provider-main {
		display: grid;
		gap: 0.46rem;
		min-width: 0;
	}

	.provider-info {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.provider-name {
		font-size: 1rem;
		font-weight: 710;
		letter-spacing: -0.02em;
		white-space: nowrap;
	}

	.provider-meta {
		margin: 0;
		max-width: 38rem;
		font-size: 0.84rem;
		line-height: 1.6;
		color: var(--ui-text-secondary);
	}

	.save-msg {
		font-size: 0.73rem;
		font-weight: 680;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ui-accent-strong);
	}

	.provider-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.65rem;
		min-width: 13rem;
		padding-left: 1rem;
		border-left: 1px solid color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
		flex-shrink: 0;
		flex-wrap: wrap;
		padding-top: 0.08rem;
	}

	.key-input-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	:global(.key-input-row .ui-input) {
		font-size: 0.84rem;
		width: min(340px, 70vw);
	}

	@media (max-width: 720px) {
		.provider-row {
			grid-template-columns: 1fr;
			align-items: start;
			padding-right: 0.9rem;
		}

		.provider-actions {
			width: 100%;
			justify-content: flex-start;
			min-width: 0;
			padding-left: 0;
			border-left: none;
		}

		.key-input-row {
			width: 100%;
		}

		:global(.key-input-row .ui-input) {
			width: 100%;
		}
	}
</style>
