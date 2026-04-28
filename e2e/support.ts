import { existsSync, readFileSync } from "node:fs";
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
import { resolveElectrobunWorkspaceDir } from "electrobun-e2e";
import { DEFAULT_AGENT_SETTINGS } from "../src/shared/agent-settings";

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
  return join(homeDir, ".config", "svvy", "pi-agent");
}

export async function writeAgentModelsConfig(
  homeDir: string,
  config: Record<string, unknown>,
): Promise<void> {
  const agentDir = getTestAgentDir(homeDir);
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "models.json"), `${JSON.stringify(config, null, 2)}\n`);
}

export function resolveProjectEnvValue(key: string, rootDir = process.cwd()): string | null {
  const envFiles = [".env.local", ".env"];
  for (const fileName of envFiles) {
    const filePath = join(rootDir, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    const value = readEnvFileValue(filePath, key);
    if (value) {
      return value;
    }
  }

  const processValue = process.env[key]?.trim();
  return processValue ? processValue : null;
}

export async function writeWorkspaceEnvFile(
  workspaceDir: string,
  values: Record<string, string>,
): Promise<void> {
  const filePath = join(workspaceDir, ".env");
  const contents = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  await writeFile(filePath, `${contents}\n`);
}

function readEnvFileValue(filePath: string, key: string): string | null {
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex < 0) {
      continue;
    }

    const candidateKey = line.slice(0, equalsIndex).trim();
    if (candidateKey !== key) {
      continue;
    }

    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    return value || null;
  }

  return null;
}

export function getTestSessionDir(homeDir: string, workspaceDir = ROOT_WORKSPACE_DIR): string {
  return join(
    getTestAgentDir(homeDir),
    "sessions",
    `--${workspaceDir.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`,
  );
}

export function getTestAuthFile(homeDir: string): string {
  return join(homeDir, ".config", "svvy", "auth.json");
}

export async function seedProviderApiKeys(
  homeDir: string,
  apiKeys: Record<string, string>,
): Promise<void> {
  const authFile = getTestAuthFile(homeDir);
  await mkdir(join(homeDir, ".config", "svvy"), { recursive: true });

  const serialized = Object.fromEntries(
    Object.entries(apiKeys).map(([providerId, key]) => [providerId, { type: "apikey", key }]),
  );
  await writeFile(authFile, `${JSON.stringify(serialized, null, 2)}\n`, {
    mode: 0o600,
  });
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
      session.provider ?? DEFAULT_AGENT_SETTINGS.provider,
      session.model ?? DEFAULT_AGENT_SETTINGS.model,
    );
    manager.appendThinkingLevelChange(
      session.thinkingLevel ?? DEFAULT_AGENT_SETTINGS.reasoningEffort,
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
    provider: options.provider ?? DEFAULT_AGENT_SETTINGS.provider,
    model: options.model ?? DEFAULT_AGENT_SETTINGS.model,
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
    toolResultMessage(artifactCall.id, "artifacts", `Created file ${options.filename}`, {
      timestamp: startedAt + 2,
    }),
    assistantTextMessage(`Done. Open ${options.filename}.`, {
      timestamp: startedAt + 3,
    }),
  ];
}

export function resolveHomeDir(homeDir?: string): string {
  return homeDir ?? homedir();
}
