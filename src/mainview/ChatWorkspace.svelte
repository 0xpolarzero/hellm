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

	{#if hasArtifacts && !showArtifactsPanel}
		<div class="artifacts-launcher">
			<Button variant="secondary" size="sm" onclick={() => (showArtifactsPanel = true)}>
				Artifacts
				<Badge tone="info">{artifactCount}</Badge>
			</Button>
		</div>
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
		display: flex;
		height: 100%;
		min-height: 0;
		background:
			radial-gradient(circle at top, rgba(125, 211, 252, 0.12), transparent 32%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(248, 250, 252, 0.96));
	}

	.chat-pane {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		transition: width 180ms ease;
	}

	.chat-pane-shell {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.split .chat-pane {
		width: 50%;
	}

	.artifacts-slot {
		min-height: 0;
	}

	.desktop-open {
		display: block;
		width: 50%;
		min-width: 0;
		border-left: 1px solid rgba(203, 213, 225, 0.72);
		background: rgba(255, 255, 255, 0.88);
	}

	.desktop-closed {
		display: none;
	}

	.mobile-slot {
		position: absolute;
		inset: 0;
		z-index: 40;
	}

	.mobile-overlay {
		height: 100%;
	}

	.artifacts-launcher {
		position: absolute;
		top: 1rem;
		left: 50%;
		z-index: 20;
		transform: translateX(-50%);
	}

	@media (max-width: 720px) {
		.artifacts-launcher {
			top: 0.8rem;
		}
	}
</style>
