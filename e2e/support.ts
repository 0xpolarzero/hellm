import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  Message,
  StopReason,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@mariozechner/pi-ai";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type {
  E2ePromptScenario,
  E2ePromptStep,
  HellmE2eControl,
} from "../src/bun/e2e-control";
import { resolveElectrobunWorkspaceDir } from "electrobun-e2e";
import type { CustomProvider } from "../src/mainview/chat-storage";
import { DEFAULT_CHAT_SETTINGS } from "../src/mainview/chat-settings";
import type { PromptHistoryEntry } from "../src/mainview/prompt-history";

export function resolveAppWorkspaceDir(rootDir = process.cwd()): string {
  return resolveElectrobunWorkspaceDir(rootDir);
}

export const ROOT_WORKSPACE_DIR = resolveAppWorkspaceDir();

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

export interface SeedSessionInput {
  key?: string;
  messages: Message[];
  model?: string;
  parentKey?: string;
  provider?: string;
  thinkingLevel?: ThinkingLevel;
  title?: string;
}

export interface SeededSession {
  file: string;
  id: string;
  key: string;
}

export function getTestAgentDir(homeDir: string): string {
  return join(homeDir, ".config", "hellm", "pi-agent");
}

export function getTestSessionDir(
  homeDir: string,
  workspaceDir = ROOT_WORKSPACE_DIR,
): string {
  return join(
    getTestAgentDir(homeDir),
    "sessions",
    `--${workspaceDir.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`,
  );
}

export function getTestAuthFile(homeDir: string): string {
  return join(homeDir, ".config", "hellm", "auth.json");
}

export function getRendererSeedFile(homeDir: string): string {
  return join(homeDir, ".config", "hellm", "renderer-seed.json");
}

export function getE2eControlFile(homeDir: string): string {
  return join(homeDir, ".config", "hellm", "e2e-control.json");
}

export async function seedProviderApiKeys(
  homeDir: string,
  apiKeys: Record<string, string>,
): Promise<void> {
  const authFile = getTestAuthFile(homeDir);
  await mkdir(join(homeDir, ".config", "hellm"), { recursive: true });

  const serialized = Object.fromEntries(
    Object.entries(apiKeys).map(([providerId, key]) => [providerId, { type: "apikey", key }]),
  );
  await writeFile(authFile, `${JSON.stringify(serialized, null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function writeRendererSeed(
  homeDir: string,
  seed: {
    customProviders?: CustomProvider[];
    promptHistory?: PromptHistoryEntry[];
  },
): Promise<string> {
  const seedFile = getRendererSeedFile(homeDir);
  await mkdir(join(homeDir, ".config", "hellm"), { recursive: true });
  await writeFile(seedFile, `${JSON.stringify(seed, null, 2)}\n`, {
    mode: 0o600,
  });
  return seedFile;
}

export async function writeE2eControl(
  homeDir: string,
  control: HellmE2eControl,
): Promise<string> {
  const controlFile = getE2eControlFile(homeDir);
  await mkdir(join(homeDir, ".config", "hellm"), { recursive: true });
  await writeFile(controlFile, `${JSON.stringify(control, null, 2)}\n`, {
    mode: 0o600,
  });
  return controlFile;
}

export async function seedSessions(
  homeDir: string,
  sessions: SeedSessionInput[],
  workspaceDir = ROOT_WORKSPACE_DIR,
): Promise<SeededSession[]> {
  const sessionDir = getTestSessionDir(homeDir, workspaceDir);
  await mkdir(sessionDir, { recursive: true });

  const seededSessions: SeededSession[] = [];
  const seededByKey = new Map<string, SeededSession>();

  for (const [index, session] of sessions.entries()) {
    const manager = SessionManager.create(workspaceDir, sessionDir);
    if (session.parentKey) {
      const parent = seededByKey.get(session.parentKey);
      if (!parent) {
        throw new Error(`Unknown parentKey "${session.parentKey}" while seeding sessions.`);
      }
      manager.newSession({ parentSession: parent.file });
    }

    if (session.title?.trim()) {
      manager.appendSessionInfo(session.title.trim());
    }
    manager.appendModelChange(
      session.provider ?? DEFAULT_CHAT_SETTINGS.provider,
      session.model ?? DEFAULT_CHAT_SETTINGS.model,
    );
    manager.appendThinkingLevelChange(
      session.thinkingLevel ?? DEFAULT_CHAT_SETTINGS.reasoningEffort,
    );
    for (const message of session.messages) {
      manager.appendMessage(message);
    }

    const seededSession = {
      file: manager.getSessionFile(),
      id: manager.getSessionId(),
      key: session.key ?? `session-${index + 1}`,
    };
    seededSessions.push(seededSession);
    seededByKey.set(seededSession.key, seededSession);
  }

  return seededSessions;
}

export function userMessage(text: string, timestamp = Date.now()): UserMessage {
  return {
    role: "user",
    timestamp,
    content: [{ type: "text", text }],
  };
}

export function assistantTextMessage(
  text: string,
  options: {
    model?: string;
    provider?: string;
    stopReason?: StopReason;
    timestamp?: number;
    thinking?: string;
    toolCalls?: ToolCall[];
  } = {},
): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  if (options.thinking) {
    content.push({ type: "thinking", thinking: options.thinking });
  }
  content.push({ type: "text", text });
  if (options.toolCalls) {
    content.push(...options.toolCalls);
  }

  return {
    role: "assistant",
    timestamp: options.timestamp ?? Date.now(),
    api: "openai-responses",
    provider: options.provider ?? DEFAULT_CHAT_SETTINGS.provider,
    model: options.model ?? DEFAULT_CHAT_SETTINGS.model,
    usage: ZERO_USAGE,
    stopReason: options.stopReason ?? "stop",
    content,
  };
}

export function toolCall(name: string, argumentsValue: Record<string, unknown>): ToolCall {
  return {
    type: "toolCall",
    id: crypto.randomUUID(),
    name,
    arguments: argumentsValue,
  };
}

export function toolResultMessage(
  toolCallId: string,
  toolName: string,
  text: string,
  options: {
    isError?: boolean;
    timestamp?: number;
  } = {},
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    timestamp: options.timestamp ?? Date.now(),
    isError: options.isError ?? false,
    content: [{ type: "text", text }],
  };
}

export function e2eTextStep(
  text: string,
  options: {
    chunkDelayMs?: number;
    chunks?: string[];
  } = {},
): E2ePromptStep {
  return {
    type: "text",
    text,
    chunkDelayMs: options.chunkDelayMs,
    chunks: options.chunks,
  };
}

export function e2eThinkingStep(
  text: string,
  options: {
    chunkDelayMs?: number;
    chunks?: string[];
  } = {},
): E2ePromptStep {
  return {
    type: "thinking",
    text,
    chunkDelayMs: options.chunkDelayMs,
    chunks: options.chunks,
  };
}

export function e2eToolCallStep(
  name: string,
  argumentsValue: Record<string, unknown>,
  options: {
    chunkDelayMs?: number;
    chunks?: string[];
    id?: string;
  } = {},
): E2ePromptStep {
  return {
    type: "toolCall",
    name,
    arguments: argumentsValue,
    chunkDelayMs: options.chunkDelayMs,
    chunks: options.chunks,
    id: options.id,
  };
}

export function e2eDelayStep(ms: number): E2ePromptStep {
  return {
    type: "delay",
    ms,
  };
}

export function e2ePromptScenario(
  scenario: E2ePromptScenario,
): E2ePromptScenario {
  return scenario;
}

export function artifactCreateConversation(options: {
  content: string;
  filename: string;
  prompt: string;
  thinking?: string;
  timestamp?: number;
}): Message[] {
  const startedAt = options.timestamp ?? Date.now();
  const artifactCall = toolCall("artifacts", {
    command: "create",
    filename: options.filename,
    content: options.content,
  });

  return [
    userMessage(options.prompt, startedAt),
    assistantTextMessage("Created artifact.", {
      thinking: options.thinking,
      timestamp: startedAt + 1,
      toolCalls: [artifactCall],
      stopReason: "toolUse",
    }),
    toolResultMessage(
      artifactCall.id,
      "artifacts",
      `Created file ${options.filename}`,
      { timestamp: startedAt + 2 },
    ),
    assistantTextMessage(`Done. Open ${options.filename}.`, {
      timestamp: startedAt + 3,
    }),
  ];
}

export function resolveHomeDir(homeDir?: string): string {
  return homeDir ?? homedir();
}
