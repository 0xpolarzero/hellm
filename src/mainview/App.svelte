<script lang="ts">
	import { onMount } from "svelte";
	import {
		AppStorage,
		ChatPanel,
		CustomProvidersStore,
		IndexedDBStorageBackend,
		ModelSelector,
		ProviderKeysStore,
		SessionsStore,
		SettingsStore,
		defaultConvertToLlm,
		setAppStorage,
	} from "@mariozechner/pi-web-ui";
	import { Agent, type StreamFn } from "@mariozechner/pi-agent-core";
	import {
		createAssistantMessageEventStream,
		getModel,
		type AssistantMessage,
		type AssistantMessageEvent,
		type Message,
	} from "@mariozechner/pi-ai";
	import type { SendPromptRequest } from "./chat-rpc";
	import { DEFAULT_CHAT_SETTINGS, type ReasoningEffort } from "./chat-settings";
	import Settings from "./Settings.svelte";
	import { rpc } from "./rpc";

	type UsageStats = {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		totalTokens: number;
		cost: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
			total: number;
		};
	};

	const ZERO_USAGE: UsageStats = {
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

	function createRpcStreamId(): string {
		if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
			return crypto.randomUUID();
		}
		return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	}

	let container: HTMLDivElement | null = null;
	let agent: Agent | null = null;
	let panel = $state<ChatPanel | null>(null);
	let bootstrapError = $state<string | null>(null);
	let showSettings = $state(false);
	let disposed = false;

	function createFailureMessage(
		error: unknown,
		provider: string,
		model: string,
		stopReason: "aborted" | "error" = "error",
	): AssistantMessage {
		const message = error instanceof Error ? error.message : "Unable to generate a response.";
		return {
			role: "assistant",
			content: [{ type: "text", text: message }],
			api: `${provider}-responses`,
			provider,
			model,
			timestamp: Date.now(),
			usage: ZERO_USAGE,
			stopReason,
			errorMessage: message,
		};
	}

	async function cancelPrompt(sessionId?: string): Promise<void> {
		if (!sessionId) return;
		try {
			await rpc.request.cancelPrompt({ sessionId });
		} catch (error) {
			console.error("Failed to cancel prompt:", error);
		}
	}

	async function syncSessionModel(modelId: string): Promise<void> {
		const sessionId = agent?.sessionId;
		if (!agent || !sessionId) return;

		try {
			const response = await rpc.request.setSessionModel({ sessionId, model: modelId });
			if (response.ok) {
				agent.sessionId = response.sessionId;
			}
		} catch (error) {
			console.error("Failed to sync session model:", error);
		}
	}

	async function syncSessionThoughtLevel(level: ReasoningEffort): Promise<void> {
		const sessionId = agent?.sessionId;
		if (!agent || !sessionId) return;

		try {
			const response = await rpc.request.setSessionThoughtLevel({ sessionId, level });
			if (response.ok) {
				agent.sessionId = response.sessionId;
			}
		} catch (error) {
			console.error("Failed to sync session thought level:", error);
		}
	}

	const streamFromRpc: StreamFn = async (model, context, options) => {
		const stream = createAssistantMessageEventStream();
		const reasoningEffort = (options?.reasoning as ReasoningEffort | undefined) ?? DEFAULT_CHAT_SETTINGS.reasoningEffort;
		const request: SendPromptRequest = {
			streamId: createRpcStreamId(),
			messages: context.messages as Message[],
			provider: model.provider,
			model: model.id,
			reasoningEffort,
			sessionId: agent?.sessionId,
			systemPrompt: context.systemPrompt,
		};
		const provider = request.provider ?? DEFAULT_CHAT_SETTINGS.provider;
		const modelId = request.model ?? DEFAULT_CHAT_SETTINGS.model;
		const activeStreamId = request.streamId;
		let activeSessionId = request.sessionId ?? agent?.sessionId;
		let completed = false;

		const cleanup = () => {
			rpc.removeMessageListener("sendStreamEvent", streamListener);
			if (options?.signal) {
				options.signal.removeEventListener("abort", abort);
			}
		};

		const finishWithError = (stopReason: "aborted" | "error", error: unknown): void => {
			if (completed) return;
			completed = true;
			cleanup();
			stream.push({
				type: "error",
				reason: stopReason,
				error: createFailureMessage(error, provider, modelId, stopReason),
			});
		};

		const handleStreamPayload = (payload: { streamId: string; event: AssistantMessageEvent }) => {
			if (completed) return;
			if (payload.streamId !== activeStreamId) return;

			stream.push(payload.event);
			if (payload.event.type === "done" || payload.event.type === "error") {
				completed = true;
				cleanup();
			}
		};

		const streamListener = (payload: { streamId: string; event: AssistantMessageEvent }) => {
			handleStreamPayload(payload);
		};

		const abort = (): void => {
			if (completed) return;
			void cancelPrompt(activeSessionId);
			finishWithError("aborted", new Error("Request aborted by user"));
		};

		rpc.addMessageListener("sendStreamEvent", streamListener);
		if (options?.signal) {
			options.signal.addEventListener("abort", abort, { once: true });
			if (options.signal.aborted) {
				abort();
			}
		}

		void (async () => {
			try {
				const response = await rpc.request.sendPrompt(request);
				activeSessionId = response.sessionId;
				if (agent) {
					agent.sessionId = response.sessionId;
				}

				if (options?.signal?.aborted) {
					abort();
				}
			} catch (error) {
				finishWithError("error", error);
			}
		})();

		return stream;
	};

	function initializeStorage() {
		const settings = new SettingsStore();
		const providerKeys = new ProviderKeysStore();
		const sessions = new SessionsStore();
		const customProviders = new CustomProvidersStore();
		const backend = new IndexedDBStorageBackend({
			dbName: "hellm-desktop-chat",
			version: 2,
			stores: [
				settings.getConfig(),
				providerKeys.getConfig(),
				sessions.getConfig(),
				customProviders.getConfig(),
				SessionsStore.getMetadataConfig(),
			],
		});

		settings.setBackend(backend);
		providerKeys.setBackend(backend);
		sessions.setBackend(backend);
		customProviders.setBackend(backend);

		const storage = new AppStorage(settings, providerKeys, sessions, customProviders, backend);
		setAppStorage(storage);
		return storage;
	}

	async function bootstrap() {
		const storage = initializeStorage();

		try {
			const defaults = await rpc.request.getDefaults();
			if (disposed) return;

			const auth = await rpc.request.getProviderAuthState({ providerId: defaults.provider });
			if (disposed) return;

			if (auth.connected) {
				await storage.providerKeys.set(defaults.provider, auth.accountId || "oauth");
			}
			if (disposed) return;

			agent = new Agent({
				initialState: {
					systemPrompt: "You are hellm, a pragmatic software engineering assistant.",
					model: getModel(
						defaults.provider as Parameters<typeof getModel>[0],
						defaults.model as Parameters<typeof getModel>[1],
					),
					thinkingLevel: defaults.reasoningEffort,
					messages: [],
					tools: [],
				},
				convertToLlm: defaultConvertToLlm,
				streamFn: streamFromRpc,
			});
			if (disposed || !agent) return;

			const originalSetModel = agent.setModel.bind(agent);
			agent.setModel = (nextModel) => {
				originalSetModel(nextModel);
				void syncSessionModel(nextModel.id);
			};

			const originalSetThinkingLevel = agent.setThinkingLevel.bind(agent);
			agent.setThinkingLevel = (level) => {
				originalSetThinkingLevel(level);
				void syncSessionThoughtLevel(level);
			};

			const chatPanel = new ChatPanel();
			const currentAgent = agent;
			await chatPanel.setAgent(currentAgent, {
				onModelSelect: async () => {
					const auths = await rpc.request.listProviderAuths();
					const allowed = auths.filter((authInfo) => authInfo.hasKey).map((authInfo) => authInfo.provider);
					ModelSelector.open(
						currentAgent.state.model,
						(modelChoice) => currentAgent.setModel(modelChoice),
						allowed,
					);
				},
				onApiKeyRequired: async (provider) => {
					const authState = await rpc.request.getProviderAuthState({ providerId: provider });
					if (!authState.connected) {
						showSettings = true;
						return false;
					}
					await storage.providerKeys.set(provider, authState.accountId || "oauth");
					return true;
				},
			});

			if (!container || disposed) return;

			container.innerHTML = "";
			container.append(chatPanel);
			panel = chatPanel;
			bootstrapError = null;
		} catch (error) {
			if (!disposed) {
				bootstrapError = error instanceof Error ? error.message : "Unable to initialize hellm.";
			}
		}
	}

	onMount(() => {
		void bootstrap();

		return () => {
			disposed = true;
			if (container) {
				container.innerHTML = "";
			}
			if (panel) {
				panel.remove();
				panel = null;
			}
			agent = null;
		};
	});
</script>

<div class="app-shell">
	<header class="topbar">
		<div>
			<p class="eyebrow">Desktop Bootstrap</p>
			<h1>hellm</h1>
		</div>
		<div class="topbar-actions">
			<button class="settings-btn" onclick={() => (showSettings = true)} title="Provider settings">
				Providers
			</button>
		</div>
	</header>

	<div class="workspace">
		<div bind:this={container} class="chat-area">
			{#if bootstrapError}
				<div class="status-card error-card">
					<h2>Startup failed</h2>
					<p>{bootstrapError}</p>
				</div>
			{/if}
			{#if !panel && !bootstrapError}
				<div class="status-card">
					<h2>Starting hellm</h2>
					<p>Booting the Bun-side pi host and initializing the desktop chat surface.</p>
				</div>
			{/if}
		</div>
	</div>
</div>

{#if showSettings}
	<Settings onClose={() => (showSettings = false)} />
{/if}

<style>
	.app-shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100%;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.2rem 0.95rem;
		border-bottom: 1px solid rgba(148, 163, 184, 0.2);
		background: rgba(255, 255, 255, 0.58);
		backdrop-filter: blur(18px);
	}

	.eyebrow {
		margin: 0 0 0.2rem;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #0f766e;
	}

	h1 {
		margin: 0;
		font-size: 1.35rem;
		font-weight: 720;
		letter-spacing: -0.03em;
		color: #0f172a;
	}

	.topbar-actions {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	.settings-btn {
		background: linear-gradient(135deg, #0f172a, #1d4ed8);
		border: none;
		color: #fff;
		cursor: pointer;
		padding: 0.62rem 0.95rem;
		border-radius: 999px;
		font-weight: 600;
		box-shadow: 0 10px 20px rgba(29, 78, 216, 0.16);
	}

	.workspace {
		position: relative;
		flex: 1;
		min-height: 0;
		padding: 1rem;
	}

	.chat-area {
		height: 100%;
		min-height: 0;
		border-radius: 1.2rem;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.72);
		border: 1px solid rgba(226, 232, 240, 0.92);
		box-shadow: 0 28px 70px rgba(15, 23, 42, 0.1);
	}

	.status-card {
		display: grid;
		place-content: center;
		height: 100%;
		padding: 2rem;
		text-align: center;
		color: #334155;
		background:
			radial-gradient(circle at top, rgba(125, 211, 252, 0.16), transparent 35%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(248, 250, 252, 0.96));
	}

	.status-card h2 {
		margin: 0 0 0.35rem;
		font-size: 1.1rem;
		color: #0f172a;
	}

	.status-card p {
		margin: 0;
		max-width: 32rem;
		line-height: 1.5;
	}

	.error-card h2,
	.error-card p {
		color: #991b1b;
	}

	@media (max-width: 720px) {
		.workspace {
			padding: 0.75rem;
		}

		.topbar {
			padding: 0.9rem 0.95rem;
		}
	}
</style>
