<script lang="ts">
	import { onMount } from "svelte";
	import type { ProviderAuthInfo } from "./chat-rpc";
	import { rpc } from "./rpc";
	import Badge from "./ui/Badge.svelte";
	import Button from "./ui/Button.svelte";
	import Dialog from "./ui/Dialog.svelte";
	import Input from "./ui/Input.svelte";
	import Surface from "./ui/Surface.svelte";

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
				<Surface tone="muted" padding="none" class="provider-row">
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
				</Surface>
			{/each}
		</div>
	{/if}
</Dialog>

<style>
	.loading,
	.error {
		font-size: 0.9rem;
		color: var(--ui-text-secondary);
	}

	.error {
		color: #b91c1c;
	}

	.provider-list {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	:global(.provider-row) {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 0.95rem 1rem;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.provider-main {
		display: grid;
		gap: 0.32rem;
		min-width: 0;
	}

	.provider-info {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.provider-name {
		font-size: 0.94rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.provider-meta {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--ui-text-secondary);
	}

	.save-msg {
		font-size: 0.74rem;
		color: var(--ui-accent-strong);
		font-weight: 600;
	}

	.provider-actions {
		display: flex;
		align-items: flex-start;
		justify-content: flex-end;
		gap: 0.5rem;
		flex-shrink: 0;
		flex-wrap: wrap;
	}

	.key-input-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	:global(.key-input-row .ui-input) {
		font-size: 0.84rem;
		width: min(320px, 70vw);
	}

	@media (max-width: 720px) {
		.provider-actions {
			width: 100%;
			justify-content: flex-start;
		}

		.key-input-row {
			width: 100%;
		}

		:global(.key-input-row .ui-input) {
			width: 100%;
		}
	}
</style>
