<script lang="ts">
	import { onMount } from "svelte";
	import type { AssistantMessage, Usage } from "@mariozechner/pi-ai";
	import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
	import ArtifactsPanel from "./ArtifactsPanel.svelte";
	import { ArtifactsController, type ArtifactsSnapshot } from "./artifacts";
	import ChatComposer from "./ChatComposer.svelte";
	import { formatUsage } from "./chat-format";
	import ChatTranscript from "./ChatTranscript.svelte";
	import type { ChatRuntime } from "./chat-runtime";
	import ModelPickerDialog from "./ModelPickerDialog.svelte";
	import Button from "./ui/Button.svelte";
	import Badge from "./ui/Badge.svelte";

	const ARTIFACTS_BREAKPOINT = 800;

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
	let agentRevision = $state(0);
	let artifactsSnapshot = $state<ArtifactsSnapshot>({
		activeFilename: null,
		artifacts: [],
		logsByFilename: {},
	});
	let showArtifactsPanel = $state(false);
	let showModelPicker = $state(false);
	let allowedProviders = $state<string[]>([]);
	let windowWidth = $state(0);

	const isMobile = $derived(windowWidth < ARTIFACTS_BREAKPOINT);
	const artifactCount = $derived(artifactsSnapshot.artifacts.length);
	const hasArtifacts = $derived(artifactCount > 0);
	const showDesktopSplit = $derived(!isMobile && showArtifactsPanel && hasArtifacts);
	const workspaceStatusText = $derived(errorMessage ? "Attention" : isStreaming ? "Streaming" : "Ready");
	const workspaceStatusTone = $derived(errorMessage ? "danger" : isStreaming ? "warning" : "neutral");
	const currentModel = $derived.by(() => {
		agentRevision;
		return runtime.agent.state.model;
	});
	const thinkingLevel = $derived.by(() => {
		agentRevision;
		return runtime.agent.state.thinkingLevel as ThinkingLevel;
	});
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

	async function openModelSelector() {
		const configuredProviders = await runtime.listConfiguredProviders();
		allowedProviders = Array.from(new Set([runtime.agent.state.model.provider, ...configuredProviders]));
		showModelPicker = true;
	}

	function syncAgentState() {
		messages = [...runtime.agent.state.messages];
		streamingMessage = runtime.agent.state.streamingMessage?.role === "assistant" ? runtime.agent.state.streamingMessage : null;
		pendingToolCalls = new Set(runtime.agent.state.pendingToolCalls);
		isStreaming = runtime.agent.state.isStreaming;
		errorMessage = runtime.agent.state.errorMessage;
		agentRevision += 1;
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
		return true;
	}

	function handleOpenArtifact(filename: string) {
		controller?.selectArtifact(filename);
		showArtifactsPanel = true;
	}

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

<div class={`chat-workspace ${showDesktopSplit ? "split" : ""}`.trim()}>
	<section class="workspace-main">
		<header class="workspace-header">
			<div class="workspace-heading">
				<p class="workspace-eyebrow">Session Surface</p>
				<h2>Conversation</h2>
				<p class="workspace-summary">Inspect, change, verify, and keep the working thread visible.</p>
			</div>
			<div class="workspace-controls">
				<Badge tone={workspaceStatusTone}>{workspaceStatusText}</Badge>
				{#if usageText}
					<p class="workspace-usage">Total {usageText}</p>
				{/if}
				{#if hasArtifacts}
					<Button
						variant={showArtifactsPanel ? "secondary" : "ghost"}
						size="sm"
						onclick={() => (showArtifactsPanel = !showArtifactsPanel)}
					>
						Artifacts
						<Badge tone="info">{artifactCount}</Badge>
					</Button>
				{/if}
			</div>
		</header>

		<section class="chat-pane">
			<div class="chat-pane-shell">
			<ChatTranscript
				{messages}
				streamingMessage={streamingMessage ?? undefined}
				{pendingToolCalls}
				{isStreaming}
				onOpenArtifact={handleOpenArtifact}
			/>
			<ChatComposer
				{currentModel}
				{thinkingLevel}
				{isStreaming}
				{errorMessage}
				usageText={usageText || undefined}
				onAbort={() => runtime.agent.abort()}
				onOpenModelPicker={() => void openModelSelector()}
				onSend={handleSend}
				onThinkingChange={(level) => runtime.agent.setThinkingLevel(level)}
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

		{#if isMobile && showArtifactsPanel}
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
		currentModel={currentModel}
		allowedProviders={allowedProviders}
		storage={runtime.storage}
		onClose={() => (showModelPicker = false)}
		onSelect={(model) => {
			runtime.agent.setModel(model);
			showModelPicker = false;
		}}
	/>
{/if}

<style>
	.chat-workspace {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		height: 100%;
		min-height: 0;
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-panel-accent) 48%, transparent), transparent 8rem),
			linear-gradient(180deg, color-mix(in oklab, var(--ui-bg-elevated) 96%, transparent), var(--ui-surface));
	}

	.workspace-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}

	.workspace-header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.15rem 0.95rem;
		border-bottom: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-subtle) 92%, transparent), transparent);
	}

	.workspace-heading {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}

	.workspace-eyebrow {
		margin: 0;
		font-size: 0.66rem;
		font-weight: 760;
		letter-spacing: 0.17em;
		text-transform: uppercase;
		color: var(--ui-accent-strong);
	}

	.workspace-heading h2 {
		margin: 0;
		font-size: 1.12rem;
		font-weight: 720;
		letter-spacing: -0.03em;
		color: var(--ui-text-primary);
	}

	.workspace-summary {
		margin: 0;
		font-size: 0.84rem;
		line-height: 1.5;
		color: var(--ui-text-secondary);
	}

	.workspace-controls {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.7rem;
		flex-wrap: wrap;
	}

	.workspace-usage {
		margin: 0;
		font-size: 0.77rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--ui-text-secondary);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.chat-pane {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
	}

	.chat-pane-shell {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.split {
		grid-template-columns: minmax(0, 1fr) clamp(22rem, 31vw, 34rem);
	}

	.artifacts-slot {
		min-height: 0;
	}

	.desktop-open {
		display: block;
		min-width: 0;
		border-left: 1px solid color-mix(in oklab, var(--ui-border-soft) 92%, transparent);
		background:
			linear-gradient(180deg, color-mix(in oklab, var(--ui-surface-subtle) 95%, transparent), var(--ui-surface));
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
		padding: 0.7rem;
		background:
			linear-gradient(180deg, color-mix(in oklab, black 8%, transparent), color-mix(in oklab, black 28%, transparent));
	}

	@media (max-width: 960px) {
		.workspace-header {
			align-items: start;
			flex-direction: column;
		}

		.workspace-controls {
			justify-content: flex-start;
		}
	}

	@media (max-width: 720px) {
		.workspace-header {
			padding-inline: 0.9rem;
		}

		.workspace-summary {
			font-size: 0.82rem;
		}

		.mobile-overlay {
			padding: 0.45rem;
		}
	}
</style>
