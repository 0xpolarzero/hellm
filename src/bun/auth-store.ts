import type { OAuthCredentials } from "@mariozechner/pi-ai";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type StoredCredential =
  | { type: "apikey"; key: string }
  | {
      type: "oauth";
      credentials: OAuthCredentials;
      refreshFailure?: OAuthRefreshFailure | null;
    };

export interface OAuthRefreshFailure {
  occurredAt: string;
  message: string;
}

export type AuthStoreData = Record<string, StoredCredential>;

const CONFIG_DIR =
  process.platform === "win32"
    ? join(process.env.APPDATA ?? homedir(), "svvy")
    : join(homedir(), ".config", "svvy");

const AUTH_FILE = join(CONFIG_DIR, "auth.json");
const AUTH_TMP = join(CONFIG_DIR, "auth.json.tmp");

const PROVIDER_ENV_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  "azure-openai-responses": "AZURE_OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
  zai: "ZAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  minimax: "MINIMAX_API_KEY",
  "minimax-cn": "MINIMAX_CN_API_KEY",
  huggingface: "HF_TOKEN",
  opencode: "OPENCODE_API_KEY",
  "opencode-go": "OPENCODE_API_KEY",
  "kimi-coding": "KIMI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  "github-copilot": "GH_TOKEN",
  "openai-codex": "OPENAI_API_KEY",
  "gemini-cli": "GEMINI_API_KEY",
};

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function readStore(): AuthStoreData {
  try {
    if (!existsSync(AUTH_FILE)) return {};
    return JSON.parse(readFileSync(AUTH_FILE, "utf-8")) as AuthStoreData;
  } catch {
    return {};
  }
}

function writeStore(store: AuthStoreData): void {
  ensureConfigDir();
  writeFileSync(AUTH_TMP, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(AUTH_TMP, AUTH_FILE);
}

export function setApiKey(providerId: string, apiKey: string): void {
  const store = readStore();
  store[providerId] = { type: "apikey", key: apiKey };
  writeStore(store);
}

export function setOAuthCredentials(providerId: string, credentials: OAuthCredentials): void {
  const store = readStore();
  store[providerId] = { type: "oauth", credentials };
  writeStore(store);
}

export function updateOAuthCredentials(providerId: string, credentials: OAuthCredentials): void {
  setOAuthCredentials(providerId, credentials);
}

export function removeCredential(providerId: string): void {
  const store = readStore();
  delete store[providerId];
  writeStore(store);
}

export function getCredential(providerId: string): StoredCredential | undefined {
  return readStore()[providerId];
}

export function getOAuthRefreshFailure(providerId: string): OAuthRefreshFailure | null {
  const stored = getCredential(providerId);
  if (!stored || stored.type !== "oauth") return null;
  return stored.refreshFailure ?? null;
}

export function recordOAuthRefreshFailure(providerId: string, message: string): void {
  const store = readStore();
  const stored = store[providerId];
  if (!stored || stored.type !== "oauth") return;
  store[providerId] = {
    ...stored,
    refreshFailure: {
      occurredAt: new Date().toISOString(),
      message,
    },
  };
  writeStore(store);
}

export function resolveApiKey(providerId: string): string | undefined {
  const stored = getCredential(providerId);
  if (stored) {
    if (stored.type === "apikey") return stored.key;
    if (
      stored.type === "oauth" &&
      stored.credentials.expires > Date.now() &&
      !stored.refreshFailure
    ) {
      return stored.credentials.access;
    }
  }
  const envVar = PROVIDER_ENV_VARS[providerId];
  if (envVar) {
    const value = process.env[envVar];
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

export type AuthKeyType = "apikey" | "oauth" | "env" | "none";

export function resolveAuthState(providerId: string): {
  connected: boolean;
  keyType: AuthKeyType;
  usable: boolean;
  expiresAt?: string | null;
  refreshFailure?: OAuthRefreshFailure | null;
} {
  const stored = getCredential(providerId);
  if (stored?.type === "apikey") return { connected: true, keyType: "apikey", usable: true };
  if (stored?.type === "oauth") {
    const expiresAt = new Date(stored.credentials.expires).toISOString();
    return {
      connected: true,
      keyType: "oauth",
      usable: stored.credentials.expires > Date.now() && !stored.refreshFailure,
      expiresAt,
      refreshFailure: stored.refreshFailure ?? null,
    };
  }
  const envVar = PROVIDER_ENV_VARS[providerId];
  if (envVar && process.env[envVar]?.trim()) {
    return { connected: true, keyType: "env", usable: true };
  }
  return { connected: false, keyType: "none", usable: false };
}

export function getProviderEnvVar(providerId: string): string | undefined {
  return PROVIDER_ENV_VARS[providerId];
}
