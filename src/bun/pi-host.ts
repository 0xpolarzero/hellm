import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import { getModel, getProviders, type AssistantMessage, type AssistantMessageEvent, type Message } from "@mariozechner/pi-ai";
import {
	AuthStorage,
	createAgentSession,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type AgentSession,
} from "@mariozechner/pi-coding-agent";
import { resolveApiKey } from "./auth-store";

const ZERO_USAGE: AssistantMessage["usage"] = {
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

interface ManagedSession {
	sessionId: string;
	provider: string;
	model: string;
	thinkingLevel: ThinkingLevel;
	systemPrompt?: string;
	syncedMessages: Message[];
	session: AgentSession;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	activePrompt: boolean;
	recreateOnNextPrompt: boolean;
	abortRequested: boolean;
}

interface SendAgentPromptOptions {
	sessionId?: string;
	systemPrompt?: string;
	messages: Message[];
	provider: string;
	model: string;
	thinkingLevel: ThinkingLevel;
	onEvent: (event: AssistantMessageEvent) => void;
}

interface VisibleStreamState {
	partial: AssistantMessage;
	activeTextIndex: number | null;
	activeThinkingIndex: number | null;
}

const sessions = new Map<string, ManagedSession>();

export async function initPiHost(): Promise<void> {}

export async function disposePiHost(): Promise<void> {
	for (const session of sessions.values()) {
		session.session.dispose();
	}
	sessions.clear();
}

export async function sendAgentPrompt(options: SendAgentPromptOptions): Promise<{ sessionId: string }> {
	const session = await ensureSession(options);
	if (session.activePrompt) {
		throw new Error(`Session ${session.sessionId} is already streaming.`);
	}

	session.abortRequested = false;
	session.activePrompt = true;

	setTimeout(() => {
		void runAgentPrompt(session.sessionId, options);
	}, 0);

	return { sessionId: session.sessionId };
}

export async function destroyAgentSession(sessionId: string): Promise<void> {
	const session = sessions.get(sessionId);
	if (!session) return;
	session.session.dispose();
	sessions.delete(sessionId);
}

export async function cancelAgentSession(sessionId: string): Promise<void> {
	const session = sessions.get(sessionId);
	if (!session || !session.activePrompt) return;
	session.abortRequested = true;
	await session.session.abort();
}

export async function setSessionModel(
	sessionId: string,
	model: string,
): Promise<{ ok: boolean; sessionId: string }> {
	const session = sessions.get(sessionId);
	if (!session) {
		return { ok: false, sessionId };
	}

	session.model = model;
	session.recreateOnNextPrompt = true;

	if (session.activePrompt) {
		return { ok: true, sessionId };
	}

	try {
		syncAuthStorage(session.authStorage);
		const resolvedModel = getResolvedModel(session.provider, model);
		if (resolvedModel) {
			await session.session.setModel(resolvedModel);
			session.recreateOnNextPrompt = false;
		}
	} catch {
		// Fall back to recreating on the next prompt.
	}

	return { ok: true, sessionId };
}

export async function setSessionThoughtLevel(
	sessionId: string,
	level: ThinkingLevel,
): Promise<{ ok: boolean; sessionId: string }> {
	const session = sessions.get(sessionId);
	if (!session) {
		return { ok: false, sessionId };
	}

	session.thinkingLevel = level;

	if (session.activePrompt) {
		session.recreateOnNextPrompt = true;
		return { ok: true, sessionId };
	}

	session.session.setThinkingLevel(level);
	return { ok: true, sessionId };
}

async function ensureSession(options: SendAgentPromptOptions): Promise<ManagedSession> {
	let session = options.sessionId ? sessions.get(options.sessionId) : undefined;
	if (!session) {
		const sessionId = options.sessionId ?? randomUUID();
		return createManagedSession(sessionId, options.provider, options.model, options.thinkingLevel, options.systemPrompt);
	}

	if (session.provider !== options.provider) {
		session = await recreateSession(session, {
			provider: options.provider,
			model: options.model,
			thinkingLevel: options.thinkingLevel,
			systemPrompt: options.systemPrompt,
		});
	} else if (session.model !== options.model || session.recreateOnNextPrompt) {
		session = await recreateSession(session, {
			model: options.model,
			thinkingLevel: options.thinkingLevel,
			systemPrompt: options.systemPrompt,
		});
	} else if (session.thinkingLevel !== options.thinkingLevel) {
		session.thinkingLevel = options.thinkingLevel;
		session.session.setThinkingLevel(options.thinkingLevel);
	}

	if (session.systemPrompt !== options.systemPrompt) {
		session = await recreateSession(session, { systemPrompt: options.systemPrompt });
	}

	if (!canAppendLatestUserTurn(session.syncedMessages, options.messages)) {
		session = await recreateSession(session, { systemPrompt: options.systemPrompt });
	}

	return session;
}

async function createManagedSession(
	sessionId: string,
	provider: string,
	model: string,
	thinkingLevel: ThinkingLevel,
	systemPrompt?: string,
): Promise<ManagedSession> {
	const cwd = process.cwd();
	const agentDir = getHellmAgentDir();
	mkdirSync(agentDir, { recursive: true });

	const authStorage = AuthStorage.inMemory();
	syncAuthStorage(authStorage);
	const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
	const resolvedModel = getResolvedModel(provider, model);
	if (!resolvedModel) {
		throw new Error(`Model not found: ${provider}/${model}`);
	}

	const sessionManager = SessionManager.create(cwd, getHellmSessionDir(cwd));
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		authStorage,
		modelRegistry,
		sessionManager,
		settingsManager,
		model: resolvedModel,
		thinkingLevel,
	});

	const managed: ManagedSession = {
		sessionId,
		provider,
		model,
		thinkingLevel,
		systemPrompt,
		syncedMessages: [],
		session,
		authStorage,
		modelRegistry,
		activePrompt: false,
		recreateOnNextPrompt: false,
		abortRequested: false,
	};

	sessions.set(sessionId, managed);
	return managed;
}

async function recreateSession(
	session: ManagedSession,
	overrides: Partial<Pick<ManagedSession, "provider" | "model" | "thinkingLevel" | "systemPrompt">>,
): Promise<ManagedSession> {
	session.session.dispose();
	sessions.delete(session.sessionId);
	return createManagedSession(
		session.sessionId,
		overrides.provider ?? session.provider,
		overrides.model ?? session.model,
		overrides.thinkingLevel ?? session.thinkingLevel,
		overrides.systemPrompt ?? session.systemPrompt,
	);
}

async function runAgentPrompt(sessionId: string, options: SendAgentPromptOptions): Promise<void> {
	const session = sessions.get(sessionId);
	if (!session) return;

	const streamState = createVisibleStreamState(options.provider, options.model);
	options.onEvent({ type: "start", partial: streamState.partial });
	const unsubscribe = session.session.subscribe((event) => {
		if (event.type !== "message_update") {
			return;
		}
		applyVisibleAssistantEvent(streamState, event.assistantMessageEvent, options.onEvent);
	});

	try {
		syncAuthStorage(session.authStorage);

		const promptText = buildPromptText(session, options.messages, options.systemPrompt);
		if (!promptText) {
			throw new Error("No user message to send.");
		}

		const previousMessageCount = session.session.agent.state.messages.length;
		await session.session.prompt(promptText, { expandPromptTemplates: false });
		finishOpenVisibleBlocks(streamState, options.onEvent);

		const emittedMessage = getLatestAssistantMessage(session.session.agent.state.messages.slice(previousMessageCount))
			?? getLatestAssistantMessage(session.session.agent.state.messages);

		if (!emittedMessage) {
			throw new Error("The pi session finished without producing an assistant message.");
		}

		const visibleMessage = finalizeVisibleAssistantMessage(streamState, emittedMessage, options.provider, options.model);

		if (visibleMessage.stopReason === "error" || visibleMessage.stopReason === "aborted") {
			options.onEvent({
				type: "error",
				reason: visibleMessage.stopReason,
				error: visibleMessage,
			});
		} else {
			options.onEvent({
				type: "done",
				reason: visibleMessage.stopReason === "toolUse" ? "stop" : visibleMessage.stopReason,
				message: visibleMessage,
			});
		}

		session.syncedMessages = cloneMessages([...options.messages, visibleMessage]);
		session.provider = options.provider;
		session.model = options.model;
		session.thinkingLevel = options.thinkingLevel;
		session.systemPrompt = options.systemPrompt;
		session.recreateOnNextPrompt = false;
	} catch (error) {
		const reason = session.abortRequested ? "aborted" : "error";
		finishOpenVisibleBlocks(streamState, options.onEvent);
		const failure = finalizeVisibleAssistantMessage(
			streamState,
			createErrorMessage(
				options.provider,
				options.model,
				error instanceof Error ? error.message : "pi prompt failed.",
				reason,
			),
			options.provider,
			options.model,
		);

		options.onEvent({
			type: "error",
			reason,
			error: failure,
		});

		session.syncedMessages = cloneMessages([...options.messages, failure]);
		session.provider = options.provider;
		session.model = options.model;
		session.thinkingLevel = options.thinkingLevel;
		session.systemPrompt = options.systemPrompt;
	} finally {
		unsubscribe();
		session.abortRequested = false;
		session.activePrompt = false;
	}
}

function createVisibleStreamState(provider: string, model: string): VisibleStreamState {
	return {
		partial: createPartialAssistantMessage(provider, model),
		activeTextIndex: null,
		activeThinkingIndex: null,
	};
}

function applyVisibleAssistantEvent(
	streamState: VisibleStreamState,
	event: AssistantMessageEvent,
	onEvent: (event: AssistantMessageEvent) => void,
): void {
	switch (event.type) {
		case "text_start": {
			streamState.activeTextIndex = streamState.partial.content.length;
			streamState.partial.content.push({ type: "text", text: "" });
			onEvent({
				type: "text_start",
				contentIndex: streamState.activeTextIndex,
				partial: streamState.partial,
			});
			return;
		}

		case "text_delta": {
			if (streamState.activeTextIndex === null) {
				applyVisibleAssistantEvent(streamState, { type: "text_start", contentIndex: 0, partial: event.partial }, onEvent);
			}

			const contentIndex = streamState.activeTextIndex;
			if (contentIndex === null) return;

			const block = streamState.partial.content[contentIndex];
			if (!block || block.type !== "text") return;

			block.text += event.delta;
			onEvent({
				type: "text_delta",
				contentIndex,
				delta: event.delta,
				partial: streamState.partial,
			});
			return;
		}

		case "text_end": {
			const contentIndex = streamState.activeTextIndex;
			if (contentIndex === null) return;

			const block = streamState.partial.content[contentIndex];
			if (!block || block.type !== "text") return;

			onEvent({
				type: "text_end",
				contentIndex,
				content: block.text,
				partial: streamState.partial,
			});
			streamState.activeTextIndex = null;
			return;
		}

		case "thinking_start": {
			streamState.activeThinkingIndex = streamState.partial.content.length;
			streamState.partial.content.push({ type: "thinking", thinking: "" });
			onEvent({
				type: "thinking_start",
				contentIndex: streamState.activeThinkingIndex,
				partial: streamState.partial,
			});
			return;
		}

		case "thinking_delta": {
			if (streamState.activeThinkingIndex === null) {
				applyVisibleAssistantEvent(
					streamState,
					{ type: "thinking_start", contentIndex: 0, partial: event.partial },
					onEvent,
				);
			}

			const contentIndex = streamState.activeThinkingIndex;
			if (contentIndex === null) return;

			const block = streamState.partial.content[contentIndex];
			if (!block || block.type !== "thinking") return;

			block.thinking += event.delta;
			onEvent({
				type: "thinking_delta",
				contentIndex,
				delta: event.delta,
				partial: streamState.partial,
			});
			return;
		}

		case "thinking_end": {
			const contentIndex = streamState.activeThinkingIndex;
			if (contentIndex === null) return;

			const block = streamState.partial.content[contentIndex];
			if (!block || block.type !== "thinking") return;

			onEvent({
				type: "thinking_end",
				contentIndex,
				content: block.thinking,
				partial: streamState.partial,
			});
			streamState.activeThinkingIndex = null;
			return;
		}

		case "toolcall_start":
		case "toolcall_delta":
		case "toolcall_end":
			finishOpenVisibleBlocks(streamState, onEvent);
			return;

		case "start":
		case "done":
		case "error":
			return;
	}
}

function finishOpenVisibleBlocks(
	streamState: VisibleStreamState,
	onEvent: (event: AssistantMessageEvent) => void,
): void {
	if (streamState.activeThinkingIndex !== null) {
		const block = streamState.partial.content[streamState.activeThinkingIndex];
		if (block && block.type === "thinking") {
			onEvent({
				type: "thinking_end",
				contentIndex: streamState.activeThinkingIndex,
				content: block.thinking,
				partial: streamState.partial,
			});
		}
		streamState.activeThinkingIndex = null;
	}

	if (streamState.activeTextIndex !== null) {
		const block = streamState.partial.content[streamState.activeTextIndex];
		if (block && block.type === "text") {
			onEvent({
				type: "text_end",
				contentIndex: streamState.activeTextIndex,
				content: block.text,
				partial: streamState.partial,
			});
		}
		streamState.activeTextIndex = null;
	}
}

function finalizeVisibleAssistantMessage(
	streamState: VisibleStreamState,
	message: AssistantMessage,
	provider: string,
	model: string,
): AssistantMessage {
	const visibleContent = streamState.partial.content.length > 0
		? structuredClone(streamState.partial.content)
		: sanitizeAssistantMessage(message, provider, model).content;

	return {
		...message,
		api: `${provider}-responses`,
		provider,
		model,
		content: visibleContent,
		stopReason: message.stopReason === "toolUse" ? "stop" : message.stopReason,
	};
}

function sanitizeAssistantMessage(message: AssistantMessage, provider: string, model: string): AssistantMessage {
	const content = message.content.filter((block) => block.type === "text" || block.type === "thinking");
	return {
		...message,
		provider,
		model,
		content: content.length > 0 ? content : [{ type: "text", text: "" }],
	};
}

function getLatestAssistantMessage(messages: AgentMessage[]): AssistantMessage | undefined {
	const assistantMessages = messages.filter((message): message is AssistantMessage => message.role === "assistant");
	return assistantMessages.at(-1);
}

function syncAuthStorage(authStorage: AuthStorage): void {
	for (const provider of getProviders()) {
		const apiKey = resolveApiKey(provider);
		if (apiKey) {
			authStorage.setRuntimeApiKey(provider, apiKey);
		} else {
			authStorage.removeRuntimeApiKey(provider);
		}
	}
}

function getResolvedModel(provider: string, model: string) {
	return getModel(provider as Parameters<typeof getModel>[0], model as Parameters<typeof getModel>[1]);
}

function getHellmAgentDir(): string {
	return process.platform === "win32"
		? join(process.env.APPDATA ?? homedir(), "hellm", "pi-agent")
		: join(homedir(), ".config", "hellm", "pi-agent");
}

function getHellmSessionDir(cwd: string): string {
	return join(getHellmAgentDir(), "sessions", `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
}

function buildPromptText(session: ManagedSession, messages: Message[], systemPrompt?: string): string {
	if (session.syncedMessages.length === 0 || !canAppendLatestUserTurn(session.syncedMessages, messages)) {
		return buildTranscript(systemPrompt, messages);
	}

	const nextMessage = messages[session.syncedMessages.length];
	if (!nextMessage || nextMessage.role !== "user") {
		return buildTranscript(systemPrompt, messages);
	}

	return messageToPlainText(nextMessage);
}

function buildTranscript(systemPrompt: string | undefined, messages: Message[]): string {
	const parts: string[] = [];
	const prompt = systemPrompt?.trim();
	if (prompt) {
		parts.push("System:");
		parts.push(prompt);
		parts.push("");
	}

	for (const message of messages) {
		const text = messageToPlainText(message).trim();
		if (!text) continue;

		const label =
			message.role === "user"
				? "User"
				: message.role === "assistant"
					? "Assistant"
					: `Tool Result (${message.toolName})`;
		parts.push(`${label}:`);
		parts.push(text);
		parts.push("");
	}

	parts.push("Continue the conversation from the latest user message. Respond only as the assistant.");
	return parts.join("\n").trim();
}

function canAppendLatestUserTurn(previousMessages: Message[], currentMessages: Message[]): boolean {
	if (previousMessages.length >= currentMessages.length) {
		return false;
	}

	for (let index = 0; index < previousMessages.length; index += 1) {
		const previousMessage = previousMessages[index];
		const currentMessage = currentMessages[index];
		if (!previousMessage || !currentMessage || !messagesEqual(previousMessage, currentMessage)) {
			return false;
		}
	}

	return currentMessages.at(-1)?.role === "user";
}

function messagesEqual(left: Message, right: Message): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function cloneMessages(messages: Message[]): Message[] {
	return structuredClone(messages);
}

function messageToPlainText(message: Message): string {
	switch (message.role) {
		case "user":
			return flattenUserContent(message.content);
		case "assistant":
			return message.content
				.map((block) => {
					if (block.type === "text") return block.text;
					if (block.type === "thinking") return block.thinking;
					if (block.type === "toolCall") return `[tool call: ${block.name}]`;
					return "";
				})
				.filter(Boolean)
				.join("\n");
		case "toolResult":
			return message.content
				.map((block) => {
					if (block.type === "text") return block.text;
					if (block.type === "image") return "[image]";
					return "";
				})
				.filter(Boolean)
				.join("\n");
	}
}

function flattenUserContent(content: Message["content"]): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.map((block) => {
			if (block.type === "text") return block.text;
			if (block.type === "image") return "[image]";
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function createPartialAssistantMessage(provider: string, model: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: `${provider}-responses`,
		provider,
		model,
		usage: ZERO_USAGE,
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createErrorMessage(
	provider: string,
	model: string,
	message: string,
	stopReason: "aborted" | "error",
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: message }],
		api: `${provider}-responses`,
		provider,
		model,
		usage: ZERO_USAGE,
		stopReason,
		errorMessage: message,
		timestamp: Date.now(),
	};
}
