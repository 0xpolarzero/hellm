import {
	ApplicationMenu,
	BrowserWindow,
	Updater,
	defineElectrobunRPC,
} from "electrobun/bun";
import { getModel, getModels, getProviders } from "@mariozechner/pi-ai";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	AuthStateResponse,
	ChatRPCSchema,
	ProviderAuthInfo,
	SendPromptRequest,
	StreamEventMessage,
} from "../mainview/chat-rpc";
import {
	DEFAULT_CHAT_SETTINGS,
	type ChatDefaults,
	type ReasoningEffort,
} from "../mainview/chat-settings";
import {
	getProviderEnvVar,
	removeCredential,
	resolveApiKey,
	resolveAuthState,
	setApiKey as storeApiKey,
} from "./auth-store";
import { refreshIfNeeded, startOAuthLogin, supportsOAuth } from "./oauth-login";
import {
	cancelAgentSession,
	initPiHost,
	sendAgentPrompt,
	setSessionModel,
	setSessionThoughtLevel,
} from "./pi-host";

type SessionMutationResponse = {
	ok: boolean;
	sessionId: string;
};

type BackendRPCSchema = ChatRPCSchema & {
	bun: ChatRPCSchema["bun"] & {
		messages: {
			sendStreamEvent: StreamEventMessage;
		};
	};
};

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const DEFAULT_RPC_TIMEOUT_MS = 120000;
const DEFAULT_SYSTEM_PROMPT =
	"You are hellm, a pragmatic software engineering assistant running inside the hellm desktop app.";
const ENV_FILES = [".env.local", ".env"];
const PREFERRED_PROVIDERS = ["zai", "openai", "anthropic", "google"];
const PREFERRED_MODEL_FRAGMENTS = [
	"glm-5-turbo",
	"glm-4.7-flashx",
	"glm-4.7-flash",
	"gpt-5.4-mini",
	"gpt-5.4",
	"gpt-5",
	"gpt-4o",
	"claude-sonnet",
	"gemini-2.5",
	"glm-4.7",
	"glm-4.5",
];

let resolvedDefaults: ChatDefaults | null = null;

function loadEnvFile(filePath: string): void {
	if (!existsSync(filePath)) return;

	try {
		const content = readFileSync(filePath, "utf8");
		for (const rawLine of content.split(/\r?\n/)) {
			const line = rawLine.trim();
			if (!line || line.startsWith("#")) continue;

			const equalsIndex = line.indexOf("=");
			if (equalsIndex < 0) continue;

			const key = line.slice(0, equalsIndex).trim();
			if (!key || process.env[key] !== undefined) continue;

			let value = line.slice(equalsIndex + 1).trim();
			if (
				(value.startsWith("\"") && value.endsWith("\"")) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}

			if (value) process.env[key] = value;
		}
	} catch {
		// Ignore malformed or unreadable env files.
	}
}

function loadRuntimeEnv(): void {
	const cwd = process.cwd();
	for (const file of ENV_FILES) {
		loadEnvFile(join(cwd, file));
	}
}

function getRpcRequestTimeoutMs(): number {
	const source =
		process.env.ELECTROBUN_RPC_TIMEOUT_MS ??
		process.env.ELECTROBUN_RPC_REQUEST_TIMEOUT_MS ??
		process.env.VITE_ELECTROBUN_RPC_TIMEOUT_MS;

	const parsed = Number(source);
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RPC_TIMEOUT_MS;

	return Math.trunc(parsed);
}

function getApiKeyMissingError(provider: string): string {
	const envVar = getProviderEnvVar(provider);
	if (!envVar) {
		return `No API key configured for provider "${provider}".`;
	}
	return `Missing ${envVar} for provider "${provider}". Add one in Provider settings.`;
}

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log("Vite dev server not running. Run `bun run dev:hmr` for HMR.");
		}
	}
	return "views://mainview/index.html";
}

function resolveSendDefaults(request: SendPromptRequest): ChatDefaults {
	const defaults = getDefaultChatSettings();
	return {
		provider: request.provider || defaults.provider,
		model: request.model || defaults.model,
		reasoningEffort: request.reasoningEffort || defaults.reasoningEffort,
	};
}

function getDefaultChatSettings(): ChatDefaults {
	if (resolvedDefaults) {
		return resolvedDefaults;
	}

	const providers = getProviders();
	const preferredProviders = PREFERRED_PROVIDERS.filter(
		(provider): provider is (typeof providers)[number] => providers.includes(provider as (typeof providers)[number]),
	);
	const orderedProviders = [
		...preferredProviders,
		...providers.filter((provider) => !PREFERRED_PROVIDERS.includes(provider)),
	];

	for (const provider of orderedProviders) {
		const models = getModels(provider);
		if (models.length === 0) continue;

		const preferredModel =
			PREFERRED_MODEL_FRAGMENTS.flatMap((fragment) => models.filter((model) => model.id.includes(fragment)))[0] ??
			models[0];
		if (!preferredModel) continue;

		resolvedDefaults = {
			provider,
			model: preferredModel.id,
			reasoningEffort: DEFAULT_CHAT_SETTINGS.reasoningEffort,
		};
		return resolvedDefaults;
	}

	resolvedDefaults = DEFAULT_CHAT_SETTINGS;
	return resolvedDefaults;
}

function createAuthState(provider: string): AuthStateResponse {
	const state = resolveAuthState(provider);
	if (!state.connected) {
		return {
			connected: false,
			message: getApiKeyMissingError(provider),
		};
	}

	return {
		connected: true,
		accountId: `${provider}-${state.keyType}`,
	};
}

const rpc = defineElectrobunRPC<BackendRPCSchema>("bun", {
	maxRequestTime: getRpcRequestTimeoutMs(),
	handlers: {
		requests: {
			getDefaults: () => getDefaultChatSettings(),
			getProviderAuthState: async ({ providerId }: { providerId?: string }): Promise<AuthStateResponse> => {
				const defaults = getDefaultChatSettings();
				return createAuthState(providerId || defaults.provider);
			},
			sendPrompt: async (payload: SendPromptRequest): Promise<{ sessionId: string }> => {
				const resolved = resolveSendDefaults(payload);

				if (supportsOAuth(resolved.provider)) {
					await refreshIfNeeded(resolved.provider);
				}

				const apiKey = resolveApiKey(resolved.provider);
				if (!apiKey) {
					throw new Error(getApiKeyMissingError(resolved.provider));
				}

				const model = getModel(
					resolved.provider as Parameters<typeof getModel>[0],
					resolved.model as Parameters<typeof getModel>[1],
				);
				let sessionId = payload.sessionId ?? "";

				const session = await sendAgentPrompt({
					sessionId: payload.sessionId,
					provider: resolved.provider,
					model: model.id,
					thinkingLevel: resolved.reasoningEffort,
					messages: payload.messages,
					systemPrompt: payload.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
					onEvent: (event) => {
						rpc.send.sendStreamEvent({ streamId: payload.streamId, event });
					},
				});

				sessionId = session.sessionId;
				return { sessionId };
			},
			cancelPrompt: async ({ sessionId }: { sessionId: string }): Promise<{ ok: boolean }> => {
				await cancelAgentSession(sessionId);
				return { ok: true };
			},
			setSessionModel: async ({
				sessionId,
				model,
			}: {
				sessionId: string;
				model: string;
			}): Promise<SessionMutationResponse> => {
				const result = await setSessionModel(sessionId, model);
				return { ok: result.ok, sessionId: result.sessionId };
			},
			setSessionThoughtLevel: async ({
				sessionId,
				level,
			}: {
				sessionId: string;
				level: ReasoningEffort;
			}): Promise<SessionMutationResponse> => {
				const result = await setSessionThoughtLevel(sessionId, level);
				return { ok: result.ok, sessionId: result.sessionId };
			},
			listProviderAuths: async (): Promise<ProviderAuthInfo[]> => {
				const providers = getProviders();
				return providers.map((provider) => {
					const state = resolveAuthState(provider);
					return {
						provider,
						hasKey: state.connected,
						keyType: state.keyType,
						supportsOAuth: supportsOAuth(provider),
					};
				});
			},
			setProviderApiKey: async ({
				providerId,
				apiKey,
			}: {
				providerId: string;
				apiKey: string;
			}): Promise<{ ok: boolean }> => {
				storeApiKey(providerId, apiKey);
				return { ok: true };
			},
			startOAuth: async ({ providerId }: { providerId: string }): Promise<{ ok: boolean; error?: string }> => {
				try {
					await startOAuthLogin(providerId);
					return { ok: true };
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			},
			removeProviderAuth: async ({ providerId }: { providerId: string }): Promise<{ ok: boolean }> => {
				removeCredential(providerId);
				return { ok: true };
			},
		},
	},
});

const appMenu: Parameters<typeof ApplicationMenu.setApplicationMenu>[0] = [
	{
		label: "hellm",
		submenu: [
			{ role: "about" },
			{ type: "separator" },
			{ role: "hide", accelerator: "CommandOrControl+H" },
			{ role: "hideOthers", accelerator: "CommandOrControl+Option+H" },
			{ role: "showAll" },
			{ type: "separator" },
			{ role: "quit", accelerator: "CommandOrControl+Q" },
		],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo", accelerator: "CommandOrControl+Z" },
			{ role: "redo", accelerator: "CommandOrControl+Shift+Z" },
			{ type: "separator" },
			{ role: "cut", accelerator: "CommandOrControl+X" },
			{ role: "copy", accelerator: "CommandOrControl+C" },
			{ role: "paste", accelerator: "CommandOrControl+V" },
			{ role: "pasteAndMatchStyle" },
			{ role: "delete" },
			{ type: "separator" },
			{ role: "selectAll", accelerator: "CommandOrControl+A" },
		],
	},
	{
		label: "Window",
		submenu: [
			{ role: "close" },
			{ role: "minimize" },
			{ role: "zoom" },
			{ type: "separator" },
			{ role: "bringAllToFront" },
		],
	},
];

ApplicationMenu.setApplicationMenu(appMenu);

loadRuntimeEnv();

await initPiHost();

const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
	title: "hellm",
	frame: {
		x: 0,
		y: 0,
		width: 1180,
		height: 820,
	},
	url,
	rpc,
});

void mainWindow;

console.log("hellm desktop app started");
