<script lang="ts">
	import { getModels, getProviders, supportsXhigh, type Model } from "@mariozechner/pi-ai";
	import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
	import { onMount } from "svelte";
	import { searchScore } from "./chat-format";
	import type { ProviderAuthInfo } from "../shared/workspace-contract";
	import type {
		AgentSettingsState,
		SessionAgentKey,
		SessionAgentSettings,
		WorkflowAgentKey,
		WorkflowAgentSettings,
	} from "../shared/agent-settings";
	import { rpc } from "./rpc";
	import Button from "./ui/Button.svelte";
	import Dialog from "./ui/Dialog.svelte";
	import Input from "./ui/Input.svelte";

	type Props = {
		onClose: () => void;
		onProviderAuthChanged?: (providerId: string) => void | Promise<void>;
	};

	type SettingsSection = "providers" | "agents" | "workflow-agents";
	type EditableAgentSettings = SessionAgentSettings | WorkflowAgentSettings;
	type ModelOption = {
		key: string;
		provider: string;
		model: Model<any>;
	};

	const BASE_REASONING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

	let { onClose, onProviderAuthChanged }: Props = $props();

	let activeSection = $state<SettingsSection>("providers");
	let providers = $state<ProviderAuthInfo[]>([]);
	let agentSettings = $state<AgentSettingsState | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let searchQuery = $state("");
	let editingProvider = $state<string | null>(null);
	let apiKeyInput = $state<Record<string, string>>({});
	let oauthLoading = $state<Record<string, boolean>>({});
	let saveMessage = $state<Record<string, string>>({});
	let agentSaveMessage = $state<Record<string, string>>({});
	let agentSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

	const connectedProviderIds = $derived(
		new Set(providers.filter((provider) => provider.hasKey).map((provider) => provider.provider)),
	);

	const availableModelOptions = $derived.by(() => {
		const options: ModelOption[] = [];
		for (const provider of getProviders()) {
			if (!connectedProviderIds.has(provider)) continue;
			for (const model of getModels(provider)) {
				options.push({
					key: `${provider}:${model.id}`,
					provider,
					model,
				});
			}
		}
		return options.toSorted((left, right) => {
			const providerComparison = left.provider.localeCompare(right.provider);
			return providerComparison === 0 ? left.model.name.localeCompare(right.model.name) : providerComparison;
		});
	});

	const availableModelsByKey = $derived(
		new Map(availableModelOptions.map((option) => [option.key, option.model] as const)),
	);

	async function refreshProviders() {
		error = null;
		try {
			providers = await rpc.request.listProviderAuths();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to load providers";
		}
	}

	async function refreshAgentSettings() {
		agentSettings = await rpc.request.getAgentSettings();
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

	function selectedModelKey(settings: EditableAgentSettings): string {
		return `${settings.provider}:${settings.model}`;
	}

	function selectedModel(settings: EditableAgentSettings): Model<any> | null {
		return availableModelsByKey.get(selectedModelKey(settings)) ?? null;
	}

	function modelLabel(provider: string, model: Model<any>): string {
		return `${provider} / ${model.name}`;
	}

	function reasoningLevels(settings: EditableAgentSettings): ThinkingLevel[] {
		const model = selectedModel(settings);
		return model && supportsXhigh(model) ? [...BASE_REASONING_LEVELS, "xhigh"] : BASE_REASONING_LEVELS;
	}

	function selectModel(settings: EditableAgentSettings, value: string): boolean {
		const option = availableModelOptions.find((entry) => entry.key === value);
		if (!option) return false;
		if (settings.provider === option.provider && settings.model === option.model.id) return false;
		settings.provider = option.provider;
		settings.model = option.model.id;
		if (!reasoningLevels(settings).includes(settings.reasoningEffort)) {
			settings.reasoningEffort = "medium";
		}
		return true;
	}

	function selectReasoning(settings: EditableAgentSettings, value: string): boolean {
		const levels = reasoningLevels(settings);
		if (!levels.includes(value as ThinkingLevel)) return false;
		if (settings.reasoningEffort === value) return false;
		settings.reasoningEffort = value as ThinkingLevel;
		return true;
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
		await Promise.all([refreshProviders(), refreshAgentSettings()]);
		loading = false;
	});

	function setAgentSaveMessage(statusKey: string, message: string, timeoutMs = 0) {
		agentSaveMessage[statusKey] = message;
		if (timeoutMs > 0) {
			setTimeout(() => {
				if (agentSaveMessage[statusKey] === message) {
					agentSaveMessage[statusKey] = "";
				}
			}, timeoutMs);
		}
	}

	async function saveSessionAgent(key: SessionAgentKey) {
		if (!agentSettings) return;
		const statusKey = `session:${key}`;
		try {
			setAgentSaveMessage(statusKey, "Saving");
			await rpc.request.updateSessionAgentDefault({
				key,
				settings: structuredClone(agentSettings.sessionAgents[key]),
			});
			setAgentSaveMessage(statusKey, "Saved", 1800);
		} catch (err) {
			setAgentSaveMessage(statusKey, err instanceof Error ? err.message : "Save failed");
		}
	}

	async function saveWorkflowAgent(key: WorkflowAgentKey) {
		if (!agentSettings) return;
		const statusKey = `workflow:${key}`;
		try {
			setAgentSaveMessage(statusKey, "Saving");
			await rpc.request.updateWorkflowAgent({
				key,
				settings: structuredClone(agentSettings.workflowAgents[key]),
			});
			setAgentSaveMessage(statusKey, "Saved", 1800);
		} catch (err) {
			setAgentSaveMessage(statusKey, err instanceof Error ? err.message : "Save failed");
		}
	}

	function scheduleSessionAgentSave(key: SessionAgentKey) {
		const statusKey = `session:${key}`;
		clearTimeout(agentSaveTimers.get(statusKey));
		agentSaveTimers.set(statusKey, setTimeout(() => void saveSessionAgent(key), 450));
	}

	function scheduleWorkflowAgentSave(key: WorkflowAgentKey) {
		const statusKey = `workflow:${key}`;
		clearTimeout(agentSaveTimers.get(statusKey));
		agentSaveTimers.set(statusKey, setTimeout(() => void saveWorkflowAgent(key), 450));
	}

	async function seedWorkflowAgents() {
		await rpc.request.ensureWorkflowAgentsComponent();
		await refreshAgentSettings();
	}

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
			<button
				class={`settings-nav-item ${activeSection === "agents" ? "active" : ""}`.trim()}
				type="button"
				aria-current={activeSection === "agents" ? "page" : undefined}
				onclick={() => (activeSection = "agents")}
			>
				<span>Session Agents</span>
				<span>3</span>
			</button>
			<button
				class={`settings-nav-item ${activeSection === "workflow-agents" ? "active" : ""}`.trim()}
				type="button"
				aria-current={activeSection === "workflow-agents" ? "page" : undefined}
				onclick={() => (activeSection = "workflow-agents")}
			>
				<span>Workflow Agents</span>
				<span>3</span>
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
			{#if activeSection === "agents" && agentSettings}
				<div class="agent-list">
					{#each ["defaultSession", "quickSession", "namer"] as key (key)}
						{@const settings = agentSettings.sessionAgents[key as SessionAgentKey]}
						<article class="provider-row agent-row">
							<div class="provider-main">
								<div class="provider-heading">
									<span class="provider-name"
										>{key === "defaultSession"
											? "Default Session"
											: key === "quickSession"
												? "Quick Session"
												: "Namer"}</span
									>
									<span class="provider-status tone-info">{settings.reasoningEffort}</span>
									{#if agentSaveMessage[`session:${key}`]}
										<span class="provider-status">{agentSaveMessage[`session:${key}`]}</span>
									{/if}
								</div>
								<div class="agent-grid">
									<label class="agent-field">
										<span>Model</span>
										<select
											value={selectedModelKey(settings)}
											disabled={availableModelOptions.length === 0}
											onchange={(event) => {
												if (selectModel(settings, event.currentTarget.value)) {
													void saveSessionAgent(key as SessionAgentKey);
												}
											}}
										>
											{#if !selectedModel(settings)}
												<option value={selectedModelKey(settings)}>{settings.provider} / {settings.model}</option>
											{/if}
											{#each availableModelOptions as option (option.key)}
												<option value={option.key}>{modelLabel(option.provider, option.model)}</option>
											{/each}
										</select>
									</label>
									<label class="agent-field">
										<span>Reasoning</span>
										<select
											value={settings.reasoningEffort}
											onchange={(event) => {
												if (selectReasoning(settings, event.currentTarget.value)) {
													void saveSessionAgent(key as SessionAgentKey);
												}
											}}
										>
											{#each reasoningLevels(settings) as level}
												<option value={level}>{level}</option>
											{/each}
										</select>
									</label>
								</div>
								<textarea
									bind:value={settings.systemPrompt}
									class="agent-prompt"
									rows="5"
									oninput={() => scheduleSessionAgentSave(key as SessionAgentKey)}
								></textarea>
							</div>
						</article>
					{/each}
				</div>
			{/if}
			{#if activeSection === "workflow-agents" && agentSettings}
				<div class="settings-search">
					<Button variant="primary" size="sm" onclick={seedWorkflowAgents}>Seed agents.ts</Button>
					<p class="settings-search-summary">Syncs conventional workflow agents to .svvy/workflows/components/agents.ts</p>
				</div>
				<div class="agent-list">
					{#each ["explorer", "implementer", "reviewer"] as key (key)}
						{@const settings = agentSettings.workflowAgents[key as WorkflowAgentKey]}
						<article class="provider-row agent-row">
							<div class="provider-main">
								<div class="provider-heading">
									<span class="provider-name">{settings.label}</span>
									<span class="provider-status tone-info">{settings.reasoningEffort}</span>
									{#if agentSaveMessage[`workflow:${key}`]}
										<span class="provider-status">{agentSaveMessage[`workflow:${key}`]}</span>
									{/if}
								</div>
								<div class="agent-grid">
									<label class="agent-field">
										<span>Model</span>
										<select
											value={selectedModelKey(settings)}
											disabled={availableModelOptions.length === 0}
											onchange={(event) => {
												if (selectModel(settings, event.currentTarget.value)) {
													void saveWorkflowAgent(key as WorkflowAgentKey);
												}
											}}
										>
											{#if !selectedModel(settings)}
												<option value={selectedModelKey(settings)}>{settings.provider} / {settings.model}</option>
											{/if}
											{#each availableModelOptions as option (option.key)}
												<option value={option.key}>{modelLabel(option.provider, option.model)}</option>
											{/each}
										</select>
									</label>
									<label class="agent-field">
										<span>Reasoning</span>
										<select
											value={settings.reasoningEffort}
											onchange={(event) => {
												if (selectReasoning(settings, event.currentTarget.value)) {
													void saveWorkflowAgent(key as WorkflowAgentKey);
												}
											}}
										>
											{#each reasoningLevels(settings) as level}
												<option value={level}>{level}</option>
											{/each}
										</select>
									</label>
								</div>
								<textarea
									bind:value={settings.systemPrompt}
									class="agent-prompt"
									rows="5"
									oninput={() => scheduleWorkflowAgentSave(key as WorkflowAgentKey)}
								></textarea>
							</div>
						</article>
					{/each}
				</div>
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

	.agent-list {
		display: grid;
		gap: 0.75rem;
	}

	.agent-row {
		grid-template-columns: minmax(0, 1fr);
	}

	.agent-grid {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(9rem, 1fr);
		gap: 0.5rem;
		margin-top: 0.35rem;
	}

	.agent-field {
		display: grid;
		gap: 0.28rem;
		min-width: 0;
	}

	.agent-field span {
		font-size: 0.68rem;
		font-family: var(--font-mono);
		color: var(--ui-text-secondary);
	}

	.agent-field select {
		width: 100%;
		min-width: 0;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-md);
		padding: 0.58rem 0.65rem;
		background: color-mix(in oklab, var(--ui-surface-subtle) 82%, transparent);
		color: var(--ui-text-primary);
		font: inherit;
		font-size: 0.8rem;
	}

	.agent-field select:disabled {
		opacity: 0.58;
		cursor: not-allowed;
	}

	.agent-prompt {
		width: 100%;
		min-width: 0;
		margin-top: 0.4rem;
		resize: vertical;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-md);
		padding: 0.7rem;
		background: color-mix(in oklab, var(--ui-surface-subtle) 82%, transparent);
		color: var(--ui-text-primary);
		font: inherit;
		line-height: 1.5;
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

		.agent-grid {
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
