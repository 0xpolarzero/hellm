<script lang="ts">
	import { onMount } from "svelte";
	import type { AssistantMessage, Model, Usage } from "@mariozechner/pi-ai";
	import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
	import ArtifactsPanel from "./ArtifactsPanel.svelte";
	import { ArtifactsController, type ArtifactsSnapshot } from "./artifacts";
	import ChatComposer from "./ChatComposer.svelte";
	import { formatTimestamp, formatUsage } from "./chat-format";
	import type { PromptHistoryEntry } from "./prompt-history";
	import ChatTranscript from "./ChatTranscript.svelte";
	import type { ChatRuntime } from "./chat-runtime";
	import ModelPickerDialog from "./ModelPickerDialog.svelte";
	import Badge from "./ui/Badge.svelte";

	const DESKTOP_SPLIT_BREAKPOINT = 1220;
	const STACKED_SIDEBAR_BREAKPOINT = 940;

	type Props = {
		runtime: ChatRuntime;
	};

	let { runtime }: Props = $props();

	const ZERO_USAGE: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};

	let controller = $state<ArtifactsController | null>(null);
	let messages = $state<ChatRuntime["agent"]["state"]["messages"]>([]);
	let streamingMessage = $state<AssistantMessage | null>(null);
	let pendingToolCalls = $state(new Set<string>());
	let isStreaming = $state(false);
	let errorMessage = $state<string | undefined>(undefined);
	let currentModel = $state<Model<any> | null>(null);
	let currentThinkingLevel = $state<ThinkingLevel>("off");
	let artifactsSnapshot = $state<ArtifactsSnapshot>({
		activeFilename: null,
		artifacts: [],
		logsByFilename: {},
	});
	let showArtifactsPanel = $state(false);
	let showModelPicker = $state(false);
	let allowedProviders = $state<string[]>([]);
	let promptHistory = $state<PromptHistoryEntry[]>([]);
	let windowWidth = $state(0);

	const artifactCount = $derived(artifactsSnapshot.artifacts.length);
	const hasArtifacts = $derived(artifactCount > 0);
	const showDesktopSplit = $derived(windowWidth >= DESKTOP_SPLIT_BREAKPOINT && showArtifactsPanel && hasArtifacts);
	const showOverlayArtifacts = $derived(windowWidth < DESKTOP_SPLIT_BREAKPOINT && showArtifactsPanel && hasArtifacts);
	const stackSidebar = $derived(windowWidth < STACKED_SIDEBAR_BREAKPOINT);
	const workspaceStatusText = $derived(errorMessage ? "Attention" : isStreaming ? "Streaming" : "Ready");
	const workspaceStatusTone = $derived(errorMessage ? "danger" : isStreaming ? "warning" : "neutral");
	const totalUsage = $derived.by(() =>
		messages
			.filter((message): message is AssistantMessage => message.role === "assistant")
			.reduce(
				(usage, message) => ({
					input: usage.input + message.usage.input,
					output: usage.output + message.usage.output,
					cacheRead: usage.cacheRead + message.usage.cacheRead,
					cacheWrite: usage.cacheWrite + message.usage.cacheWrite,
					totalTokens: usage.totalTokens + message.usage.totalTokens,
					cost: {
						input: usage.cost.input + message.usage.cost.input,
						output: usage.cost.output + message.usage.cost.output,
						cacheRead: usage.cost.cacheRead + message.usage.cost.cacheRead,
						cacheWrite: usage.cost.cacheWrite + message.usage.cost.cacheWrite,
						total: usage.cost.total + message.usage.cost.total,
					},
				}),
				ZERO_USAGE,
			),
	);
	const usageText = $derived(formatUsage(totalUsage));
	const messageCount = $derived(
		messages.filter((message) => message.role === "user" || message.role === "assistant").length + (streamingMessage ? 1 : 0),
	);
	const toolCallCount = $derived.by(() => {
		let count = 0;
		for (const message of messages) {
			if (message.role !== "assistant") continue;
			count += message.content.filter((block) => block.type === "toolCall").length;
		}
		if (streamingMessage) {
			count += streamingMessage.content.filter((block) => block.type === "toolCall").length;
		}
		return count;
	});
	const lastActivity = $derived.by(() => {
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
			if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
				return message.timestamp;
			}
		}
		return null;
	});
	const lastActivityLabel = $derived(lastActivity ? `Last activity ${formatTimestamp(lastActivity)}` : "Waiting for first turn");

	async function openModelSelector() {
		showModelPicker = true;
		allowedProviders = [currentModel.provider];
		try {
			const configuredProviders = await runtime.listConfiguredProviders();
			allowedProviders = Array.from(new Set([currentModel.provider, ...configuredProviders]));
		} catch {
			allowedProviders = [currentModel.provider];
		}
	}

	function syncAgentState() {
		messages = [...runtime.agent.state.messages];
		streamingMessage = runtime.agent.state.streamingMessage?.role === "assistant" ? runtime.agent.state.streamingMessage : null;
		pendingToolCalls = new Set(runtime.agent.state.pendingToolCalls);
		isStreaming = runtime.agent.state.isStreaming;
		errorMessage = runtime.agent.state.errorMessage;
		currentModel = runtime.agent.state.model;
		currentThinkingLevel = runtime.agent.state.thinkingLevel as ThinkingLevel;
	}

	function syncArtifacts(snapshot: ArtifactsSnapshot) {
		const createdNewArtifact = snapshot.artifacts.length > artifactsSnapshot.artifacts.length;
		artifactsSnapshot = snapshot;
		if (snapshot.artifacts.length === 0) {
			showArtifactsPanel = false;
			return;
		}
		if (createdNewArtifact) {
			showArtifactsPanel = true;
		}
	}

	async function handleSend(input: string): Promise<boolean> {
		if (!input.trim() || runtime.agent.state.isStreaming) return false;

		const hasProviderAccess = await runtime.requireProviderAccess(runtime.agent.state.model.provider);
		if (!hasProviderAccess) return false;

		await runtime.agent.prompt(input);
		try {
			const entry = await runtime.storage.promptHistory.append({
				text: input,
				sentAt: Date.now(),
				workspaceId: runtime.workspaceId,
				sessionId: runtime.agent.sessionId ?? undefined,
			});
			promptHistory = [...promptHistory, entry];
		} catch (error) {
			console.error("Failed to persist prompt history:", error);
		}
		return true;
	}

	function handleOpenArtifact(filename: string) {
		controller?.selectArtifact(filename);
		showArtifactsPanel = true;
	}

	syncAgentState();

	onMount(() => {
		windowWidth = window.innerWidth;
		const nextController = new ArtifactsController();
		controller = nextController;
		const handleResize = () => {
			windowWidth = window.innerWidth;
		};
		window.addEventListener("resize", handleResize);

		runtime.agent.state.tools = [nextController.tool];
		syncAgentState();
		void runtime.storage.promptHistory
			.list(runtime.workspaceId)
			.then((entries) => {
				promptHistory = entries;
			})
			.catch((error) => {
				console.error("Failed to load prompt history:", error);
			});

		const unsubscribeAgent = runtime.agent.subscribe(() => {
			syncAgentState();
		});
		const unsubscribeArtifacts = nextController.subscribe((snapshot) => {
			syncArtifacts(snapshot);
		});
		void nextController.reconstructFromMessages(runtime.agent.state.messages);

		return () => {
			unsubscribeAgent();
			unsubscribeArtifacts();
			nextController.dispose();
			window.removeEventListener("resize", handleResize);
			controller = null;
		};
	});
</script>

<div class={`chat-workspace ${showDesktopSplit ? "split" : ""} ${stackSidebar ? "stacked" : ""}`.trim()}>
	<aside class="workspace-sidebar">
		<div class="sidebar-surface">
			<div class="sidebar-copy">
				<p class="sidebar-eyebrow">Session Shell</p>
				<h2>Local orchestration</h2>
				<p>
					One strategic thread, one pi-backed runtime, and a docked inspector for generated artifacts and
					verification output.
				</p>
			</div>

			<section class="sidebar-section">
				<p class="sidebar-section-label">Navigate</p>
				<div class="sidebar-nav">
					<a class="sidebar-link current" href="#conversation">
						<span>Conversation</span>
						<span>{messageCount}</span>
					</a>
					<button
						class={`sidebar-link ${showArtifactsPanel ? "current" : ""}`.trim()}
						type="button"
						disabled={!hasArtifacts}
						onclick={() => (showArtifactsPanel = !showArtifactsPanel)}
					>
						<span>Artifacts</span>
						<span>{artifactCount}</span>
					</button>
				</div>
			</section>

			<section class="sidebar-section">
				<p class="sidebar-section-label">Runtime</p>
				<dl class="sidebar-metrics">
					<div>
						<dt>Status</dt>
						<dd><Badge tone={workspaceStatusTone}>{workspaceStatusText}</Badge></dd>
					</div>
					<div>
						<dt>Turns</dt>
						<dd>{messageCount}</dd>
					</div>
					<div>
						<dt>Tool runs</dt>
						<dd>{toolCallCount}</dd>
					</div>
				</dl>
			</section>

			<section class="sidebar-note">
				<p class="sidebar-section-label">Pulse</p>
				<p>{lastActivityLabel}</p>
			</section>
		</div>
	</aside>

	<section class="workspace-main">
		<section class="chat-pane" id="conversation">
			<div class="chat-pane-shell">
				<ChatTranscript
					{messages}
					streamingMessage={streamingMessage ?? undefined}
					{pendingToolCalls}
					{isStreaming}
					onOpenArtifact={handleOpenArtifact}
				/>
				<ChatComposer
					currentModel={currentModel ?? runtime.agent.state.model}
					thinkingLevel={currentThinkingLevel}
					{isStreaming}
					{errorMessage}
					{promptHistory}
					usageText={usageText || undefined}
					onAbort={() => runtime.agent.abort()}
					onOpenModelPicker={() => void openModelSelector()}
					onSend={handleSend}
					onThinkingChange={(level) => {
						currentThinkingLevel = level;
						runtime.agent.setThinkingLevel(level);
					}}
				/>
			</div>
		</section>
	</section>

	{#if controller && hasArtifacts}
		{#if showDesktopSplit}
			<aside class="artifacts-slot desktop-open">
				<ArtifactsPanel
					{controller}
					snapshot={artifactsSnapshot}
					onClose={() => (showArtifactsPanel = false)}
				/>
			</aside>
		{/if}

		{#if showOverlayArtifacts}
			<aside class="artifacts-slot mobile-slot">
				<div class="mobile-overlay">
					<ArtifactsPanel
						{controller}
						snapshot={artifactsSnapshot}
						overlay
						onClose={() => (showArtifactsPanel = false)}
					/>
				</div>
			</aside>
		{/if}
	{/if}
</div>

{#if showModelPicker}
	<ModelPickerDialog
		currentModel={currentModel ?? runtime.agent.state.model}
		allowedProviders={allowedProviders}
		storage={runtime.storage}
		onClose={() => (showModelPicker = false)}
		onSelect={(model) => {
			currentModel = model;
			runtime.agent.setModel(model);
			showModelPicker = false;
		}}
	/>
{/if}

<style>
	.chat-workspace {
		position: relative;
		display: grid;
		grid-template-columns: clamp(15rem, 18vw, 17.5rem) minmax(0, 1fr);
		gap: 1rem;
		height: 100%;
		min-height: 0;
		padding: 1rem;
		background: transparent;
		overflow: hidden;
	}

	.stacked {
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto minmax(0, 1fr);
	}

	.split {
		grid-template-columns: clamp(15rem, 18vw, 17.5rem) minmax(0, 1fr) clamp(21rem, 29vw, 31rem);
	}

	.workspace-sidebar,
	.workspace-main,
	.artifacts-slot {
		min-width: 0;
		min-height: 0;
	}

	.workspace-sidebar,
	.workspace-main {
		overflow: hidden;
	}

	.sidebar-surface {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		height: 100%;
		padding: 0.95rem;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		border-radius: var(--ui-radius-lg);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-panel) 88%, transparent), color-mix(in oklab, var(--ui-surface-subtle) 82%, transparent)),
			var(--ui-panel);
		box-shadow: var(--ui-shadow-soft);
	}

	.sidebar-copy,
	.sidebar-section,
	.sidebar-note {
		display: grid;
		gap: 0.5rem;
	}

	.sidebar-eyebrow,
	.sidebar-section-label {
		margin: 0;
		font-size: 0.67rem;
		font-family: var(--font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ui-text-tertiary);
	}

	.sidebar-copy h2 {
		margin: 0;
		font-size: clamp(1.05rem, 1vw + 0.95rem, 1.35rem);
		font-weight: 670;
		letter-spacing: -0.04em;
		color: var(--ui-text-primary);
	}

	.sidebar-copy p:last-child,
	.sidebar-note p:last-child {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.6;
		color: var(--ui-text-secondary);
	}

	.sidebar-nav {
		display: grid;
		gap: 0.4rem;
	}

	.sidebar-link {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.8rem;
		padding: 0.72rem 0.8rem;
		border: 1px solid transparent;
		border-radius: var(--ui-radius-md);
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
		transition:
			border-color 180ms cubic-bezier(0.19, 1, 0.22, 1),
			background-color 180ms cubic-bezier(0.19, 1, 0.22, 1),
			color 180ms cubic-bezier(0.19, 1, 0.22, 1);
	}

	.sidebar-link:hover:not(:disabled),
	.sidebar-link:focus-visible {
		outline: none;
		border-color: color-mix(in oklab, var(--ui-border-strong) 76%, transparent);
		background: color-mix(in oklab, var(--ui-surface-raised) 72%, transparent);
	}

	.sidebar-link.current {
		border-color: color-mix(in oklab, var(--ui-border-accent) 78%, var(--ui-border-soft));
		background: color-mix(in oklab, var(--ui-accent-soft) 72%, var(--ui-surface-raised));
	}

	.sidebar-link:disabled {
		opacity: 0.48;
		cursor: not-allowed;
	}

	.sidebar-link span:first-child {
		font-size: 0.8rem;
		font-weight: 620;
		color: var(--ui-text-primary);
	}

	.sidebar-link span:last-child {
		font-size: 0.68rem;
		font-family: var(--font-mono);
		color: var(--ui-text-secondary);
	}

	.sidebar-metrics {
		display: grid;
		gap: 0.55rem;
		margin: 0;
	}

	.sidebar-metrics div {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.7rem;
		align-items: center;
		padding: 0.1rem 0;
	}

	.sidebar-metrics dt,
	.sidebar-metrics dd {
		margin: 0;
	}

	.sidebar-metrics dt {
		font-size: 0.72rem;
		color: var(--ui-text-secondary);
	}

	.sidebar-metrics dd {
		font-size: 0.74rem;
		font-weight: 600;
		text-align: right;
		color: var(--ui-text-primary);
	}

	.workspace-main {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.chat-pane {
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
	}

	.chat-pane-shell {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 94%, transparent);
		border-radius: var(--ui-radius-lg);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-raised) 74%, transparent), transparent 14%),
			var(--ui-surface);
		box-shadow: var(--ui-shadow-soft);
		overflow: hidden;
	}

	.desktop-open {
		display: block;
		border: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		border-radius: var(--ui-radius-lg);
		background: var(--ui-surface);
		box-shadow: var(--ui-shadow-soft);
		overflow: hidden;
	}

	.mobile-slot {
		position: absolute;
		inset: 0;
		z-index: var(--ui-z-overlay);
	}

	.mobile-overlay {
		display: flex;
		align-items: flex-end;
		justify-content: stretch;
		height: 100%;
		padding: 0.9rem;
		background:
			linear-gradient(180deg, color-mix(in oklab, black 8%, transparent), color-mix(in oklab, black 32%, transparent));
	}

	@media (max-width: 1220px) {
		.chat-workspace {
			padding: 0.9rem;
		}
	}

	@media (max-width: 940px) {
		.chat-workspace {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		.chat-workspace {
			gap: 0.75rem;
			padding: 0.75rem;
		}

		.sidebar-surface,
		.desktop-open,
		.chat-pane-shell {
			border-radius: var(--ui-radius-lg);
		}

		.mobile-overlay {
			padding: 0.45rem;
		}
	}
</style>
