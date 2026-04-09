<script lang="ts">
	import { onMount } from "svelte";
	import type { ProviderAuthInfo } from "./chat-rpc";
	import { rpc } from "./rpc";

	type Props = { onClose: () => void };
	let { onClose }: Props = $props();

	let providers = $state<ProviderAuthInfo[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let editingProvider = $state<string | null>(null);
	let apiKeyInput = $state<Record<string, string>>({});
	let oauthLoading = $state<Record<string, boolean>>({});
	let saveMessage = $state<Record<string, string>>({});

	async function refreshProviders() {
		try {
			providers = await rpc.request.listProviderAuths();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to load providers";
		}
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
			saveMessage[providerId] = "Saved";
			await refreshProviders();
			setTimeout(() => {
				saveMessage[providerId] = "";
			}, 2000);
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
				saveMessage[providerId] = "Connected";
				await refreshProviders();
			} else {
				saveMessage[providerId] = result.error ?? "OAuth failed";
			}
		} catch (err) {
			saveMessage[providerId] = err instanceof Error ? err.message : "OAuth failed";
		} finally {
			oauthLoading[providerId] = false;
			setTimeout(() => {
				saveMessage[providerId] = "";
			}, 3000);
		}
	}

	async function handleRemove(providerId: string) {
		await rpc.request.removeProviderAuth({ providerId });
		saveMessage[providerId] = "Removed";
		await refreshProviders();
		setTimeout(() => {
			saveMessage[providerId] = "";
		}, 2000);
	}

	function statusBadge(info: ProviderAuthInfo) {
		if (!info.hasKey) return { text: "Not configured", cls: "badge-none" };
		if (info.keyType === "oauth") return { text: "OAuth", cls: "badge-oauth" };
		if (info.keyType === "env") return { text: "Env var", cls: "badge-env" };
		return { text: "API key", cls: "badge-key" };
	}
</script>

<div
	class="settings-overlay"
	role="button"
	tabindex="0"
	aria-label="Close settings"
	onclick={onClose}
	onkeydown={(event) => {
		if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
			onClose();
		}
	}}
>
	<div
		class="settings-panel"
		role="dialog"
		aria-modal="true"
		tabindex="0"
		onclick={(event) => event.stopPropagation()}
		onkeydown={(event) => {
			if (event.key === "Escape") {
				onClose();
			}
		}}
	>
		<div class="settings-header">
			<div>
				<p class="eyebrow">Provider Access</p>
				<h2>Configure AI providers</h2>
			</div>
			<button class="close-btn" onclick={onClose} aria-label="Close settings">&times;</button>
		</div>

		<div class="settings-body">
			{#if loading}
				<p class="loading">Loading providers...</p>
			{:else if error}
				<p class="error">{error}</p>
			{:else}
				<p class="hint">
					Store credentials locally in <code>~/.config/hellm/auth.json</code>. Environment
					vars still take precedence when present.
				</p>
				<div class="provider-list">
					{#each providers as info (info.provider)}
						{@const badge = statusBadge(info)}
						{@const isEditing = editingProvider === info.provider}
						<div class="provider-row">
							<div class="provider-info">
								<span class="provider-name">{info.provider}</span>
								<span class="badge {badge.cls}">{badge.text}</span>
								{#if saveMessage[info.provider]}
									<span class="save-msg">{saveMessage[info.provider]}</span>
								{/if}
							</div>
							<div class="provider-actions">
								{#if isEditing}
									<div class="key-input-row">
										<input
											type="password"
											placeholder="Paste API key..."
											bind:value={apiKeyInput[info.provider]}
											onkeydown={(event) => event.key === "Enter" && handleSaveApiKey(info.provider)}
										/>
										<button class="btn btn-primary" onclick={() => handleSaveApiKey(info.provider)}>
											Save
										</button>
										<button
											class="btn"
											onclick={() => {
												editingProvider = null;
												apiKeyInput[info.provider] = "";
											}}
										>
											Cancel
										</button>
									</div>
								{:else}
									{#if info.hasKey}
										<button class="btn btn-sm" onclick={() => handleRemove(info.provider)}>
											Remove
										</button>
									{/if}
									<button
										class="btn btn-sm"
										onclick={() => {
											editingProvider = info.provider;
											apiKeyInput[info.provider] = "";
										}}
									>
										Set Key
									</button>
									{#if info.supportsOAuth}
										<button
											class="btn btn-sm btn-oauth"
											disabled={oauthLoading[info.provider]}
											onclick={() => handleOAuth(info.provider)}
										>
											{oauthLoading[info.provider] ? "Waiting..." : "Login with OAuth"}
										</button>
									{/if}
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.settings-overlay {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.42);
		backdrop-filter: blur(10px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1.25rem;
	}

	.settings-panel {
		background: rgba(255, 255, 255, 0.94);
		border: 1px solid rgba(148, 163, 184, 0.3);
		border-radius: 20px;
		width: min(760px, 92vw);
		max-height: 82vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 32px 80px rgba(15, 23, 42, 0.24);
	}

	.settings-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 1.1rem 1.4rem;
		border-bottom: 1px solid rgba(226, 232, 240, 0.9);
	}

	.eyebrow {
		margin: 0 0 0.2rem;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #0f766e;
	}

	.settings-header h2 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 650;
		color: #0f172a;
	}

	.close-btn {
		background: rgba(241, 245, 249, 0.9);
		border: 1px solid rgba(203, 213, 225, 0.8);
		border-radius: 999px;
		font-size: 1.4rem;
		cursor: pointer;
		color: #475569;
		width: 2rem;
		height: 2rem;
		line-height: 1;
	}

	.settings-body {
		padding: 1.1rem 1.4rem 1.4rem;
		overflow-y: auto;
		flex: 1;
	}

	.hint {
		font-size: 0.84rem;
		color: #475569;
		margin: 0 0 1rem;
	}

	.hint code {
		font-size: 0.78rem;
		background: #e2e8f0;
		padding: 0.15rem 0.4rem;
		border-radius: 0.4rem;
	}

	.loading,
	.error {
		font-size: 0.9rem;
		color: #64748b;
	}

	.error {
		color: #b91c1c;
	}

	.provider-list {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.provider-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.8rem 0.9rem;
		border-radius: 0.85rem;
		gap: 0.9rem;
		flex-wrap: wrap;
		background: rgba(248, 250, 252, 0.8);
		border: 1px solid rgba(226, 232, 240, 0.9);
	}

	.provider-info {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
	}

	.provider-name {
		font-size: 0.92rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.badge {
		font-size: 0.68rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		font-weight: 700;
		white-space: nowrap;
	}

	.badge-none {
		background: #e2e8f0;
		color: #64748b;
	}

	.badge-key {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.badge-oauth {
		background: #dcfce7;
		color: #15803d;
	}

	.badge-env {
		background: #fef3c7;
		color: #92400e;
	}

	.save-msg {
		font-size: 0.76rem;
		color: #15803d;
		font-weight: 600;
	}

	.provider-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.key-input-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.key-input-row input {
		font-size: 0.84rem;
		padding: 0.45rem 0.7rem;
		border: 1px solid rgba(148, 163, 184, 0.55);
		border-radius: 0.7rem;
		width: 240px;
		outline: none;
	}

	.key-input-row input:focus {
		border-color: #38bdf8;
		box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.14);
	}

	.btn {
		font-size: 0.82rem;
		padding: 0.42rem 0.72rem;
		border-radius: 0.7rem;
		border: 1px solid rgba(148, 163, 184, 0.35);
		background: #fff;
		cursor: pointer;
		white-space: nowrap;
		color: #0f172a;
	}

	.btn-sm {
		font-size: 0.78rem;
		padding: 0.38rem 0.68rem;
	}

	.btn-primary {
		background: linear-gradient(135deg, #0f766e, #2563eb);
		color: #fff;
		border-color: transparent;
	}

	.btn-oauth {
		background: #f0fdf4;
		color: #166534;
		border-color: #bbf7d0;
	}

	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
