<script lang="ts">
	import CheckCircle2Icon from "@lucide/svelte/icons/check-circle-2";
	import CircleIcon from "@lucide/svelte/icons/circle";
	import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
	import InfoIcon from "@lucide/svelte/icons/info";
	import KeyIcon from "@lucide/svelte/icons/key";
	import ShieldIcon from "@lucide/svelte/icons/shield";
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
		AppPreferences,
		PreferredExternalEditor,
	} from "../shared/agent-settings";
	import { rpc } from "./rpc";
	import Button from "./ui/Button.svelte";
	import Dialog from "./ui/Dialog.svelte";
	import Input from "./ui/Input.svelte";

	type Props = {
		onClose: () => void;
		onProviderAuthChanged?: (providerId: string) => void | Promise<void>;
	};

	type SettingsSection = "providers" | "agents" | "workflow-agents" | "preferences";
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
	let confirmingProviderRemoval = $state<string | null>(null);
	let apiKeyInput = $state<Record<string, string>>({});
	let oauthLoading = $state<Record<string, boolean>>({});
	let saveMessage = $state<Record<string, string>>({});
	let agentSaveMessage = $state<Record<string, string>>({});
	let agentSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
	let preferencesSaveMessage = $state("");

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

	const sessionAgentLabels = {
		defaultSession: "Default Session",
		quickSession: "Quick Session",
		namer: "Namer",
	} satisfies Record<SessionAgentKey, string>;

	const sessionAgentSummaries = {
		defaultSession: "Used for normal repository sessions and long-running orchestrator turns.",
		quickSession: "Used when a fast prompt should start with the lightweight session defaults.",
		namer: "Generates session and handler-thread titles from the saved naming instruction.",
	} satisfies Record<SessionAgentKey, string>;

	const workflowAgentSummaries = {
		explorer: "Conventional saved workflow agent for bounded investigation tasks.",
		implementer: "Conventional saved workflow agent for production code changes.",
		reviewer: "Conventional saved workflow agent for verification and review tasks.",
	} satisfies Record<WorkflowAgentKey, string>;

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

	const providerGroups = $derived.by(() => {
		const aiProviders = filteredProviders.filter((info) => info.keyType !== "env");
		const envProviders = filteredProviders.filter((info) => info.keyType === "env");
		return [
			{ title: "AI Providers", providers: aiProviders, warning: false },
			{ title: "Environment-backed Credentials", providers: envProviders, warning: true },
		].filter((group) => group.providers.length > 0);
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

	async function saveAppPreferences(preferences: AppPreferences) {
		try {
			preferencesSaveMessage = "Saving";
			agentSettings = await rpc.request.updateAppPreferences(structuredClone(preferences));
			preferencesSaveMessage = "Saved";
			setTimeout(() => {
				if (preferencesSaveMessage === "Saved") {
					preferencesSaveMessage = "";
				}
			}, 1800);
		} catch (err) {
			preferencesSaveMessage = err instanceof Error ? err.message : "Save failed";
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
		if (confirmingProviderRemoval !== providerId) {
			confirmingProviderRemoval = providerId;
			saveMessage[providerId] = "Click Confirm remove to revoke this credential.";
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
</script>

<Dialog
	title="Settings"
	eyebrow="Workbench"
	description="Credentials stay local. Environment variables override saved keys."
	width="lg"
	class="settings-dialog"
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
			<button
				class={`settings-nav-item ${activeSection === "preferences" ? "active" : ""}`.trim()}
				type="button"
				aria-current={activeSection === "preferences" ? "page" : undefined}
				onclick={() => (activeSection = "preferences")}
			>
				<span>Preferences</span>
				<span>Editor</span>
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

											<div class="provider-actions">
												{#if isEditing}
													<div class="key-input-row">
														<Input
															type="password"
															placeholder="Paste API key..."
															bind:value={apiKeyInput[info.provider]}
															onkeydown={(event) =>
																event.key === "Enter" && handleSaveApiKey(info.provider)}
														/>
														<Button variant="primary" size="xs" onclick={() => handleSaveApiKey(info.provider)}>
															Save
														</Button>
														<Button
															variant="ghost"
															size="xs"
															onclick={() => {
																editingProvider = null;
																apiKeyInput[info.provider] = "";
															}}
														>
															Cancel
														</Button>
													</div>
												{:else}
													{#if info.hasKey && info.keyType !== "env"}
														<Button
															variant={isConfirmingRemoval ? "danger" : "ghost"}
															size="xs"
															class="row-action action-danger"
															onclick={() => handleRemove(info.provider)}
															aria-label={isConfirmingRemoval
																? `Confirm removing ${info.provider} credentials`
																: `Remove ${info.provider} credentials`}
														>
															{isConfirmingRemoval ? "Confirm remove" : "Remove"}
														</Button>
													{/if}
													{#if info.keyType !== "env"}
														<Button
															variant="ghost"
															size="xs"
															class="row-action"
															aria-label={info.hasKey ? "Change API key" : "Add API key"}
															onclick={() => {
																editingProvider = info.provider;
																apiKeyInput[info.provider] = "";
															}}
														>
															<KeyIcon aria-hidden="true" size={12} strokeWidth={1.9} />
															{info.hasKey ? "Key" : "Add key"}
														</Button>
													{/if}
													{#if info.supportsOAuth && info.keyType !== "env"}
														<Button
															variant="ghost"
															size="xs"
															class="row-action action-success"
															disabled={oauthLoading[info.provider]}
															onclick={() => handleOAuth(info.provider)}
														>
															<ExternalLinkIcon aria-hidden="true" size={12} strokeWidth={1.9} />
															{oauthLoading[info.provider] ? "Waiting" : "OAuth"}
														</Button>
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
			{#if activeSection === "agents" && agentSettings}
				<div class="settings-section-note">
					<InfoIcon aria-hidden="true" size={15} strokeWidth={1.8} />
					<p>Session agent changes save directly to workspace settings.</p>
				</div>
				<div class="agent-list">
					{#each ["defaultSession", "quickSession", "namer"] as key (key)}
						{@const settings = agentSettings.sessionAgents[key as SessionAgentKey]}
						<article class="provider-row agent-row">
							<div class="provider-main">
								<div class="provider-heading">
									<span class="provider-name">{sessionAgentLabels[key as SessionAgentKey]}</span>
									<span class="model-chip">{settings.provider} / {settings.model}</span>
									<span class="provider-status tone-info">{settings.reasoningEffort}</span>
									{#if agentSaveMessage[`session:${key}`]}
										<span class="provider-status">{agentSaveMessage[`session:${key}`]}</span>
									{/if}
								</div>
								<p class="provider-meta">{sessionAgentSummaries[key as SessionAgentKey]}</p>
								<div class="agent-meta-grid">
									<div><span>Model</span><strong>{settings.model}</strong></div>
									<div><span>Provider</span><strong>{settings.provider}</strong></div>
									<div><span>Reasoning</span><strong>{settings.reasoningEffort}</strong></div>
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
									aria-label={`${sessionAgentLabels[key as SessionAgentKey]} system prompt`}
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
					<p class="settings-search-summary">Sync conventional workflow agents to .svvy/workflows/components/agents.ts</p>
				</div>
				<div class="agent-list">
					{#each ["explorer", "implementer", "reviewer"] as key (key)}
						{@const settings = agentSettings.workflowAgents[key as WorkflowAgentKey]}
						<article class="provider-row agent-row">
							<div class="provider-main">
								<div class="provider-heading">
									<span class="provider-name">{settings.label}</span>
									<span class="model-chip">{settings.provider} / {settings.model}</span>
									<span class="provider-status tone-info">{settings.reasoningEffort}</span>
									{#if agentSaveMessage[`workflow:${key}`]}
										<span class="provider-status">{agentSaveMessage[`workflow:${key}`]}</span>
									{/if}
								</div>
								<p class="provider-meta">{workflowAgentSummaries[key as WorkflowAgentKey]}</p>
								<div class="agent-meta-grid">
									<div><span>Model</span><strong>{settings.model}</strong></div>
									<div><span>Provider</span><strong>{settings.provider}</strong></div>
									<div><span>Tool surface</span><strong>execute_typescript</strong></div>
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
									aria-label={`${settings.label} system prompt`}
									oninput={() => scheduleWorkflowAgentSave(key as WorkflowAgentKey)}
								></textarea>
							</div>
						</article>
					{/each}
				</div>
			{/if}
			{#if activeSection === "preferences" && agentSettings}
				<div class="settings-section-note">
					<InfoIcon aria-hidden="true" size={15} strokeWidth={1.8} />
					<p>Used when opening saved and artifact-local workflow files.</p>
				</div>
				<article class="provider-row agent-row">
					<div class="provider-main">
						<div class="provider-heading">
							<span class="provider-name">External Editor</span>
							<span class="provider-status tone-info">
								{agentSettings.appPreferences.preferredExternalEditor}
							</span>
							{#if preferencesSaveMessage}
								<span class="provider-status">{preferencesSaveMessage}</span>
							{/if}
						</div>
						<p class="provider-meta">
							Workflow source opens in this editor from read-only library and artifact surfaces.
						</p>
						<div class="agent-grid">
							<label class="agent-field">
								<span>Editor</span>
								<select
									value={agentSettings.appPreferences.preferredExternalEditor}
									onchange={(event) => {
										agentSettings!.appPreferences.preferredExternalEditor = event.currentTarget
											.value as PreferredExternalEditor;
										void saveAppPreferences(agentSettings!.appPreferences);
									}}
								>
									<option value="system">System default</option>
									<option value="code">Visual Studio Code</option>
									<option value="cursor">Cursor</option>
									<option value="zed">Zed</option>
									<option value="sublime">Sublime Text</option>
									<option value="custom">Custom command</option>
								</select>
							</label>
							<label class="agent-field">
								<span>Custom command</span>
								<input
									value={agentSettings.appPreferences.customExternalEditorCommand}
									placeholder="editor-command --reuse-window"
									disabled={agentSettings.appPreferences.preferredExternalEditor !== "custom"}
									oninput={(event) => {
										agentSettings!.appPreferences.customExternalEditorCommand =
											event.currentTarget.value;
									}}
									onchange={() => void saveAppPreferences(agentSettings!.appPreferences)}
								/>
							</label>
						</div>
					</div>
				</article>
			{/if}
		</section>
	</div>
</Dialog>

<style>
	:global(.settings-dialog.ui-dialog-panel) {
		width: min(96vw, 980px);
		max-width: 980px;
		max-height: min(92vh, 64rem);
	}

	:global(.settings-dialog .ui-dialog-header) {
		padding-block: 0.76rem 0.62rem;
	}

	:global(.settings-dialog .ui-dialog-description) {
		max-width: 42rem;
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
		font-size: 0.68rem;
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
		font-size: 0.76rem;
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
		font-size: 0.84rem;
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
		font-size: 0.68rem;
		font-weight: 680;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--ui-text-secondary);
	}

	.settings-group-heading span {
		font-family: var(--font-mono);
		font-size: 0.64rem;
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

	.agent-list {
		display: grid;
		gap: 0.62rem;
	}

	.agent-row {
		grid-template-columns: minmax(0, 1fr);
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-sm);
		background: color-mix(in oklab, var(--ui-surface) 92%, transparent);
		box-shadow: none;
	}

	.agent-row .provider-main {
		grid-template-columns: minmax(0, 1fr);
		gap: 0.32rem;
	}

	.agent-grid {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(9rem, 1fr);
		gap: 0.45rem;
		margin-top: 0.22rem;
	}

	.agent-meta-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.25rem 0.8rem;
		margin-top: 0.2rem;
		padding: 0.26rem 0;
	}

	.agent-meta-grid div {
		display: flex;
		align-items: center;
		gap: 0.38rem;
		min-width: 0;
	}

	.agent-meta-grid span {
		font-size: 0.66rem;
		color: var(--ui-text-tertiary);
	}

	.agent-meta-grid strong,
	.model-chip {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: 0.66rem;
		font-weight: 520;
		color: var(--ui-text-secondary);
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

	.agent-field select,
	.agent-field input {
		width: 100%;
		min-width: 0;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-sm);
		padding: 0.38rem 0.48rem;
		background: color-mix(in oklab, var(--ui-surface-subtle) 82%, transparent);
		color: var(--ui-text-primary);
		font: inherit;
		font-size: 0.72rem;
	}

	.agent-field select:disabled {
		opacity: 0.58;
		cursor: not-allowed;
	}

	.agent-prompt {
		width: 100%;
		min-width: 0;
		margin-top: 0.26rem;
		resize: vertical;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 88%, transparent);
		border-radius: var(--ui-radius-sm);
		padding: 0.5rem;
		background: color-mix(in oklab, var(--ui-code) 92%, transparent);
		color: var(--ui-text-primary);
		font-family: var(--font-mono);
		font-size: 0.7rem;
		line-height: 1.52;
	}

	.provider-heading {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.provider-name {
		font-size: 0.78rem;
		font-weight: 660;
		letter-spacing: 0;
	}

	.provider-icon {
		display: inline-flex;
		align-items: center;
		color: var(--ui-text-tertiary);
	}

	.provider-status {
		font-size: 0.64rem;
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
		font-size: 0.72rem;
		line-height: 1.35;
		color: var(--ui-text-secondary);
	}

	.provider-meta span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.agent-row .provider-meta {
		display: block;
		font-size: 0.75rem;
		line-height: 1.4;
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
		font-weight: 560;
	}

	.provider-actions :global(.action-success.ui-button) {
		color: color-mix(in oklab, var(--ui-success) 78%, var(--ui-text-primary));
	}

	.provider-actions :global(.action-danger.ui-button:not(.variant-danger)) {
		color: color-mix(in oklab, var(--ui-danger) 78%, var(--ui-text-primary));
	}

	.key-input-row {
		display: flex;
		align-items: center;
		gap: 0.24rem;
		flex-wrap: wrap;
		justify-content: flex-end;
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
		font-size: 0.7rem;
		line-height: 1.38;
	}

	:global(.key-input-row .ui-input) {
		font-size: 0.76rem;
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

		.key-input-row {
			width: 100%;
			justify-content: flex-start;
		}

		:global(.key-input-row .ui-input) {
			width: 100%;
		}
	}
</style>
