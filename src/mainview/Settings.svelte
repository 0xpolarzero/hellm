<script lang="ts">
	import CheckIcon from "@lucide/svelte/icons/check";
	import CheckCircle2Icon from "@lucide/svelte/icons/check-circle-2";
	import CircleIcon from "@lucide/svelte/icons/circle";
	import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
	import InfoIcon from "@lucide/svelte/icons/info";
	import KeyIcon from "@lucide/svelte/icons/key";
	import ShieldIcon from "@lucide/svelte/icons/shield";
	import Trash2Icon from "@lucide/svelte/icons/trash-2";
	import { onMount } from "svelte";
	import { searchScore } from "./chat-format";
	import type { GeneratedAgentContextExternalSource } from "../shared/generated-agent-context";
	import type { ProviderAuthInfo } from "../shared/workspace-contract";
	import type { AppAppearance, AppPreferences } from "../shared/agent-settings";
	import AppPreferencesForm from "./AppPreferencesForm.svelte";
	import { rpc } from "./rpc";
	import ProviderApiKeyForm from "./ProviderApiKeyForm.svelte";
	import Button from "./ui/Button.svelte";
	import Input from "./ui/Input.svelte";
	import Tooltip from "./ui/Tooltip.svelte";
	import { dismissConfirmation } from "./ui/dismiss-confirmation";

	type Props = {
		workspaceId: string | null;
		onProviderAuthChanged?: (providerId: string) => void | Promise<void>;
		onAppAppearanceChanged?: (appearance: AppAppearance) => void;
	};

	type SettingsSection = "general" | "providers";

	let {
		workspaceId,
		onProviderAuthChanged,
		onAppAppearanceChanged,
	}: Props = $props();

	let activeSection = $state<SettingsSection>("general");
	let providers = $state<ProviderAuthInfo[]>([]);
	let appPreferences = $state<AppPreferences | null>(null);
	let externalInstructionSources = $state<GeneratedAgentContextExternalSource[]>([]);
	let providersLoading = $state(true);
	let appPreferencesLoading = $state(true);
	let error = $state<string | null>(null);
	let appPreferencesError = $state<string | null>(null);
	let searchQuery = $state("");
	let editingProvider = $state<string | null>(null);
	let confirmingProviderRemoval = $state<string | null>(null);
	let oauthLoading = $state<Record<string, boolean>>({});
	let saveMessage = $state<Record<string, string>>({});

	async function refreshProviders(options: { showLoading?: boolean } = {}) {
		if (options.showLoading) providersLoading = true;
		error = null;
		try {
			providers = await rpc.request.listProviderAuths();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to load providers";
		} finally {
			providersLoading = false;
		}
	}

	async function refreshAppPreferences(options: { showLoading?: boolean } = {}) {
		if (options.showLoading) appPreferencesLoading = true;
		appPreferencesError = null;
		try {
			appPreferences = await rpc.request.getAppPreferences();
		} catch (err) {
			appPreferencesError = err instanceof Error ? err.message : "Failed to load app preferences";
		} finally {
			appPreferencesLoading = false;
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

	function serializeAppPreferences(preferences: AppPreferences): AppPreferences {
		return {
			appAppearance: preferences.appAppearance,
			preferredExternalEditor: preferences.preferredExternalEditor,
			customExternalEditorCommand: preferences.customExternalEditorCommand,
			artifactDirectory: preferences.artifactDirectory,
			approvalMode: preferences.approvalMode,
			networkAccess: preferences.networkAccess,
			externalInstructions: preferences.externalInstructions,
			ambientAgentResources: preferences.ambientAgentResources,
		};
	}

	async function refreshExternalInstructionSources() {
		if (!workspaceId) {
			externalInstructionSources = [];
			return;
		}
		try {
			externalInstructionSources = await rpc.request.getGeneratedAgentContextExternalSources({
				workspaceId,
			});
		} catch {
			externalInstructionSources = [];
		}
	}

	function providerCredentialLabel(info: ProviderAuthInfo): string {
		if (!info.hasKey) return info.supportsOAuth ? "OAuth or API key available" : "API key required";
		if (info.keyType === "env") return "Loaded from environment";
		if (info.keyType === "oauth") return "Connected with OAuth";
		return "Stored API key";
	}

	function providerSectionLabel(info: ProviderAuthInfo): string {
		if (info.hasKey && info.keyType === "env") return "Environment-backed credentials";
		if (info.hasKey && info.keyType === "oauth") return "OAuth connections";
		return "AI providers";
	}

	function providerInfo(providerId: string): ProviderAuthInfo | null {
		return providers.find((provider) => provider.provider === providerId) ?? null;
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

	const providerGroups = $derived.by(() => {
		const aiProviders = filteredProviders.filter((info) => info.keyType !== "env");
		const envProviders = filteredProviders.filter((info) => info.keyType === "env");
		return [
			{ title: "AI Providers", providers: aiProviders, warning: false },
			{ title: "Environment-backed Credentials", providers: envProviders, warning: true },
		].filter((group) => group.providers.length > 0);
	});

	onMount(() => {
		void Promise.allSettled([
			refreshProviders({ showLoading: true }),
			refreshAppPreferences({ showLoading: true }),
			refreshExternalInstructionSources(),
		]);
	});

	async function saveAppPreferences(preferences: AppPreferences): Promise<AppPreferences> {
		try {
			const nextSettings = await rpc.request.updateAppPreferences(serializeAppPreferences(preferences));
			appPreferences = serializeAppPreferences(nextSettings.appPreferences);
			await refreshExternalInstructionSources();
			onAppAppearanceChanged?.(nextSettings.appPreferences.appAppearance);
			return appPreferences;
		} catch (err) {
			throw err instanceof Error ? err : new Error("Save failed");
		}
	}

	async function handleSaveApiKey(providerId: string, apiKey: string) {
		try {
			await rpc.request.setProviderApiKey({ providerId, apiKey });
			editingProvider = null;
			await refreshProviders();
			await notifyAuthChanged(providerId);
			setTimedSaveMessage(providerId, "Saved", 2000);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed";
			saveMessage[providerId] = message;
			throw new Error(message, { cause: err });
		}
	}

	async function handleOAuth(providerId: string) {
		confirmingProviderRemoval = null;
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
		if (confirmingProviderRemoval !== providerId) {
			confirmingProviderRemoval = providerId;
			saveMessage[providerId] = "";
			return;
		}
		try {
			await rpc.request.removeProviderAuth({ providerId });
			confirmingProviderRemoval = null;
			await refreshProviders();
			await notifyAuthChanged(providerId);
			setTimedSaveMessage(providerId, "Removed", 2000);
		} catch (err) {
			saveMessage[providerId] = err instanceof Error ? err.message : "Failed to remove provider";
		}
	}

	function cancelProviderRemovalConfirmation() {
		confirmingProviderRemoval = null;
	}
</script>

<section class="settings-pane-shell" data-testid="settings-pane">
	<header class="settings-pane-header">
		<div>
			<p>Workbench</p>
			<h2>Settings</h2>
		</div>
		<span>App preferences and credentials stay local.</span>
	</header>
	{@render settingsContent()}
</section>

{#snippet settingsContent()}
	<div class="settings-shell">
		<aside class="settings-nav" aria-label="Settings sections">
			<p class="settings-nav-label">Sections</p>
			<button
				class={`settings-nav-item ${activeSection === "general" ? "active" : ""}`.trim()}
				type="button"
				aria-current={activeSection === "general" ? "page" : undefined}
				onclick={() => (activeSection = "general")}
			>
				<span>General</span>
				<span>{appPreferences?.appAppearance ?? "system"}</span>
			</button>
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
			{#if activeSection === "general"}
				{#if appPreferencesLoading}
					<p class="loading">Loading settings...</p>
				{:else if appPreferencesError}
					<p class="error">{appPreferencesError}</p>
				{:else if !appPreferences}
					<p class="error">Settings are unavailable for this workspace.</p>
				{:else}
					<AppPreferencesForm
						preferences={appPreferences}
						workspaceKey={workspaceId ?? ""}
						externalInstructionSources={externalInstructionSources}
						onOpenExternalInstructionSource={async (path) => {
							if (!workspaceId) return false;
							const result =
								await rpc.request.openGeneratedAgentContextExternalSourceInEditor({
									workspaceId,
									path,
								});
							return result.opened;
						}}
						onSave={saveAppPreferences}
					/>
				{/if}
			{/if}
			{#if activeSection === "providers"}
				<div class="settings-search">
					<Input bind:value={searchQuery} placeholder="Search providers, auth types, or access state" />
					<p class="settings-search-summary">
						{filteredProviders.length} match{filteredProviders.length === 1 ? "" : "es"}
					</p>
				</div>

				{#if providersLoading}
					<p class="loading">Loading providers...</p>
				{:else if error}
					<p class="error">{error}</p>
				{:else}
					<div class="provider-list" role="list">
						{#if filteredProviders.length === 0}
							<p class="provider-empty">No providers match the current search.</p>
						{/if}

						{#each providerGroups as group (group.title)}
							<section class="settings-group" aria-label={group.title}>
								<div class="settings-group-heading">
									<h3>{group.title}</h3>
									<span>{group.providers.length}</span>
								</div>
								{#if group.warning}
									<div class="settings-section-note tone-warning">
										<ShieldIcon aria-hidden="true" size={15} strokeWidth={1.8} />
										<p>Loaded from the shell environment. Edit them outside svvy.</p>
									</div>
								{/if}
								<div class="settings-row-stack">
									{#each group.providers as info (info.provider)}
										{@const status = providerStatus(info)}
										{@const isEditing = editingProvider === info.provider}
										{@const isConfirmingRemoval = confirmingProviderRemoval === info.provider}
										<article class="provider-row">
											<div class="provider-main">
												<div class="provider-heading">
													<span class={`provider-icon tone-${status.tone}`} aria-hidden="true">
														{#if info.hasKey}
															<CheckCircle2Icon size={14} strokeWidth={1.9} />
														{:else}
															<CircleIcon size={14} strokeWidth={1.9} />
														{/if}
													</span>
													<span class="provider-name">{info.provider}</span>
													<span class={`provider-status tone-${status.tone}`.trim()}>{status.text}</span>
												</div>
												<p class="provider-meta">
													<span>{providerSectionLabel(info)}</span>
													<span>{providerCredentialLabel(info)}</span>
												</p>
												{#if saveMessage[info.provider]}
													<p class={`save-msg ${isConfirmingRemoval ? "tone-danger" : ""}`.trim()}>
														{saveMessage[info.provider]}
													</p>
												{/if}
											</div>

											<div
												class="provider-actions"
												use:dismissConfirmation={{
													active: isConfirmingRemoval,
													onDismiss: cancelProviderRemovalConfirmation,
												}}
											>
												{#if isEditing}
													<ProviderApiKeyForm
														onSave={(apiKey) => handleSaveApiKey(info.provider, apiKey)}
														onCancel={() => (editingProvider = null)}
													/>
												{:else}
													{#if info.keyType !== "env"}
														<Tooltip label={info.hasKey ? "Change API key" : "Add API key"}>
															<Button
																variant="ghost"
																size="xs"
																iconOnly
																class="row-action"
																aria-label={info.hasKey ? `Change ${info.provider} API key` : `Add ${info.provider} API key`}
																onclick={() => {
																	confirmingProviderRemoval = null;
																	editingProvider = info.provider;
																}}
															>
																<KeyIcon aria-hidden="true" size={12} strokeWidth={1.9} />
															</Button>
														</Tooltip>
													{/if}
													{#if info.supportsOAuth && info.keyType !== "env"}
														<Tooltip label={oauthLoading[info.provider] ? "Waiting for OAuth" : "Connect with OAuth"}>
															<Button
																variant="ghost"
																size="xs"
																iconOnly
																class="row-action action-success"
																disabled={oauthLoading[info.provider]}
																loading={oauthLoading[info.provider]}
																aria-label={`Connect ${info.provider} with OAuth`}
																onclick={() => handleOAuth(info.provider)}
															>
																<ExternalLinkIcon aria-hidden="true" size={12} strokeWidth={1.9} />
															</Button>
														</Tooltip>
													{/if}
													{#if info.hasKey && info.keyType !== "env"}
														{#if isConfirmingRemoval}
															<Tooltip label="Confirm remove">
																<Button
																	variant="ghost"
																	size="xs"
																	iconOnly
																	class="row-action action-danger"
																	aria-label={`Confirm removing ${info.provider} credentials`}
																	onclick={() => handleRemove(info.provider)}
																>
																	<CheckIcon aria-hidden="true" size={12} strokeWidth={1.9} />
																</Button>
															</Tooltip>
														{:else}
															<Tooltip label="Remove credentials">
																<Button
																	variant="ghost"
																	size="xs"
																	iconOnly
																	class="row-action action-danger"
																	aria-label={`Remove ${info.provider} credentials`}
																	onclick={() => handleRemove(info.provider)}
																>
																	<Trash2Icon aria-hidden="true" size={12} strokeWidth={1.9} />
																</Button>
															</Tooltip>
														{/if}
													{/if}
												{/if}
											</div>
										</article>
									{/each}
								</div>
							</section>
						{/each}
					</div>
				{/if}
			{/if}
		</section>
	</div>
{/snippet}

<style>
	.settings-pane-shell {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 0.72rem;
		min-height: 0;
		height: 100%;
		padding: 0.78rem;
		background: var(--ui-surface);
		color: var(--ui-text-primary);
		overflow: auto;
	}

	.settings-pane-header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
		padding-bottom: 0.62rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
	}

	.settings-pane-header p,
	.settings-pane-header h2,
	.settings-pane-header span {
		margin: 0;
	}

	.settings-pane-header p,
	.settings-pane-header span {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ui-text-secondary);
	}

	.settings-pane-header h2 {
		font-size: var(--text-lg);
		line-height: 1.2;
		letter-spacing: 0;
	}

	.settings-shell {
		display: grid;
		grid-template-columns: minmax(10.5rem, 11.5rem) minmax(0, 42rem);
		gap: 0.72rem;
		min-height: 0;
		justify-content: start;
	}

	.settings-nav {
		display: grid;
		align-content: start;
		gap: 0.12rem;
		padding: 0.2rem 0.2rem 0 0;
		border-right: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
	}

	.settings-nav-label,
	.settings-search-summary,
	.save-msg {
		margin: 0;
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--ui-text-secondary);
	}

	.settings-nav-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.55rem;
		padding: 0.42rem 0.55rem;
		border: 1px solid transparent;
		border-radius: var(--ui-radius-sm);
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
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.settings-nav-item span:last-child {
		font-size: var(--text-xs);
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
		border-color: color-mix(in oklab, var(--ui-border-soft) 86%, transparent);
		background: color-mix(in oklab, var(--ui-surface-raised) 86%, transparent);
	}

	.settings-pane {
		display: grid;
		align-content: start;
		gap: 0.72rem;
		min-width: 0;
		min-height: 0;
	}

	.settings-search {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.6rem;
		position: sticky;
		top: 0;
		z-index: var(--ui-z-sticky);
		padding: 0.38rem 0.48rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-surface-subtle) 92%, transparent);
		box-shadow: none;
	}

	.loading,
	.error,
	.provider-empty {
		margin: 0;
		font-size: var(--text-base);
		color: var(--ui-text-secondary);
	}

	.error {
		color: color-mix(in oklab, var(--ui-danger) 84%, var(--ui-text-primary));
	}

	.provider-list {
		display: flex;
		flex-direction: column;
		gap: 0.78rem;
	}

	.settings-group {
		display: grid;
		gap: 0.34rem;
	}

	.settings-group-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
	}

	.settings-group-heading h3 {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0;
		color: var(--ui-text-secondary);
	}

	.settings-group-heading span {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ui-text-tertiary);
	}

	.settings-row-stack {
		display: grid;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-sm);
		overflow: hidden;
	}

	.provider-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(11.25rem, 13rem);
		align-items: center;
		gap: 0.55rem 0.75rem;
		padding: 0.42rem 0.58rem;
		border: 0;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: 0;
		background: var(--ui-surface);
		box-shadow: none;
		transition:
			background-color 170ms cubic-bezier(0.19, 1, 0.22, 1),
			border-color 170ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.provider-row:last-child {
		border-bottom: 0;
	}

	.provider-row:hover {
		background: color-mix(in oklab, var(--ui-surface-raised) 84%, var(--ui-surface));
	}

	.provider-main {
		display: grid;
		grid-template-columns: minmax(8.5rem, 1.1fr) minmax(7rem, 0.78fr) minmax(9rem, 1fr);
		align-items: center;
		gap: 0.24rem 0.68rem;
		min-width: 0;
	}

	.general-row {
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
		gap: 0.7rem;
	}

	.general-main {
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
		gap: 0.2rem;
	}

	.agent-list {
		display: grid;
		gap: 0.62rem;
	}

	.provider-heading {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.provider-name {
		font-size: var(--text-base);
		font-weight: 600;
		letter-spacing: 0;
	}

	.provider-icon {
		display: inline-flex;
		align-items: center;
		color: var(--ui-text-tertiary);
	}

	.provider-status {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--ui-text-secondary);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 84%, transparent);
		border-radius: var(--ui-radius-sm);
		padding: 0.04rem 0.26rem;
	}

	.provider-status.tone-success {
		border-color: color-mix(in oklab, var(--ui-success) 24%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-success-soft) 72%, transparent);
	}

	.provider-status.tone-warning {
		border-color: color-mix(in oklab, var(--ui-warning) 28%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-warning-soft) 72%, transparent);
	}

	.provider-status.tone-info {
		border-color: color-mix(in oklab, var(--ui-info) 24%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-info-soft) 72%, transparent);
	}

	.provider-status.tone-success,
	.provider-icon.tone-success {
		color: color-mix(in oklab, var(--ui-success) 78%, var(--ui-text-primary));
	}

	.provider-status.tone-warning,
	.provider-icon.tone-warning {
		color: color-mix(in oklab, var(--ui-warning) 82%, var(--ui-text-primary));
	}

	.provider-status.tone-info,
	.provider-icon.tone-info {
		color: color-mix(in oklab, var(--ui-info) 78%, var(--ui-text-primary));
	}

	.provider-status.tone-neutral,
	.provider-icon.tone-neutral {
		color: var(--ui-text-tertiary);
	}

	.provider-meta {
		margin: 0;
		display: contents;
		font-size: var(--text-sm);
		line-height: 1.35;
		color: var(--ui-text-secondary);
	}

	.provider-meta.general-meta {
		display: block;
	}

	.provider-meta span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.save-msg {
		grid-column: 1 / -1;
		color: var(--ui-accent-strong);
	}

	.save-msg.tone-danger {
		color: color-mix(in oklab, var(--ui-danger) 84%, var(--ui-text-primary));
	}

	.provider-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.18rem;
		min-width: 11.25rem;
		padding-left: 0.62rem;
		border-left: 1px solid color-mix(in oklab, var(--ui-border-soft) 72%, transparent);
		flex-wrap: wrap;
	}

	.provider-actions :global(.row-action.ui-button) {
		box-shadow: none;
		font-weight: 500;
	}

	.provider-actions :global(.action-success.ui-button) {
		color: color-mix(in oklab, var(--ui-success) 78%, var(--ui-text-primary));
	}

	.provider-actions :global(.action-danger.ui-button:not(.variant-danger)) {
		color: color-mix(in oklab, var(--ui-danger) 78%, var(--ui-text-primary));
	}

	.settings-section-note {
		display: flex;
		align-items: flex-start;
		gap: 0.42rem;
		padding: 0.42rem 0.55rem;
		border: 1px solid color-mix(in oklab, var(--ui-info) 18%, var(--ui-border-soft));
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-info-soft) 58%, transparent);
		color: var(--ui-text-secondary);
	}

	.settings-section-note.tone-warning {
		border-color: color-mix(in oklab, var(--ui-warning) 20%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-warning-soft) 60%, transparent);
	}

	.settings-section-note p {
		margin: 0;
		font-size: var(--text-sm);
		line-height: 1.38;
	}

	:global(.key-input-row .ui-input) {
		font-size: var(--text-sm);
		width: min(260px, 70vw);
	}

	@media (max-width: 760px) {
		.settings-shell {
			grid-template-columns: minmax(0, 1fr);
		}

		.settings-search {
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

		.provider-main {
			grid-template-columns: 1fr;
		}

		.provider-meta {
			display: flex;
			gap: 0.38rem;
			flex-wrap: wrap;
		}

		.provider-meta span {
			white-space: normal;
		}

		.agent-grid {
			grid-template-columns: 1fr;
		}

		.agent-meta-grid {
			grid-template-columns: 1fr;
		}

		.provider-actions {
			width: 100%;
			min-width: 0;
			justify-content: flex-start;
			padding-left: 0;
			border-left: none;
		}

		:global(.key-input-row .ui-input) {
			width: 100%;
		}
	}
</style>
