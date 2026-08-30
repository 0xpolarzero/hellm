import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
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
import type { WorkspaceId } from "@svvy/core";
import { createStructuredSessionStateStore } from "@svvy/state/structured-session-state";
import { resolveElectrobunWorkspaceDir } from "electrobun-e2e";
import { DEFAULT_AGENT_SETTINGS } from "../src/shared/agent-settings";
import { createAppLogStore, type AppendAppLogEntry } from "../packages/state/src/app-log-store";

export function resolveAppWorkspaceDir(rootDir = process.cwd()): string {
  return resolveElectrobunWorkspaceDir(rootDir);
}

export const ROOT_WORKSPACE_DIR = resolveAppWorkspaceDir();

export const STRUCTURED_SESSION_DB_FILENAME = "structured-session-state-v8.sqlite";

const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

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
  return join(homeDir, ".config", "svvy", "pi");
}

export function getTestExtensionsRoot(homeDir: string): string {
  return join(homeDir, ".config", "svvy", "extensions");
}

// The app bootstraps an "Initial" extension snapshot on the first extensions-inventory read.
// That bootstrap calls the macOS-keychain-backed secret store, which throws on the Linux e2e
// lane and leaves a partial snapshot that fails every later inventory read. Seeding a valid
// initial snapshot skips the bootstrap so extension surfaces stay available in e2e.
export async function seedInitialExtensionSnapshot(homeDir: string): Promise<void> {
  const snapshotRoot = join(getTestExtensionsRoot(homeDir), "snapshots", "snap_initial");
  await mkdir(snapshotRoot, { recursive: true });
  await writeFile(
    join(snapshotRoot, "metadata.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: "snap_initial",
        name: "Initial",
        extensionCount: 0,
        hasSecretState: false,
        status: "available",
      },
      null,
      2,
    )}\n`,
  );
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
  const canonicalWorkspace = realpathSync.native(workspaceDir);
  return join(
    getTestAgentDir(homeDir),
    "sessions",
    `--${canonicalWorkspace.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`,
  );
}

export function getTestWorkspaceId(workspaceDir: string): WorkspaceId {
  const canonicalWorkspace = realpathSync.native(workspaceDir);
  const hash = createHash("sha256").update(canonicalWorkspace).digest("hex").slice(0, 24);
  return `workspace:${hash}` as WorkspaceId;
}

export function getTestWorkspaceRuntimeDir(
  homeDir: string,
  workspaceDir = ROOT_WORKSPACE_DIR,
): string {
  return join(
    getTestAgentDir(homeDir),
    "workspace-runtimes",
    workspaceDir.replace(/^[/\\]/, "").replace(/[/\\:#]/g, "-"),
  );
}

export async function seedAppLogs(
  homeDir: string,
  entries: AppendAppLogEntry[],
  workspaceDir = ROOT_WORKSPACE_DIR,
): Promise<void> {
  const runtimeDir = getTestWorkspaceRuntimeDir(homeDir, workspaceDir);
  const store = createAppLogStore({
    databasePath: join(runtimeDir, "app-logs-v1.sqlite"),
    digest: testDigest,
    now: () => new Date().toISOString(),
  });
  try {
    for (const entry of entries) {
      store.append(entry);
    }
  } finally {
    store.close();
  }
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
  const canonicalWorkspace = realpathSync.native(workspaceDir);
  const sessionDir = getTestSessionDir(homeDir, canonicalWorkspace);
  let structuredNow = new Date(
    sessions
      .flatMap((session) => session.messages.map((message) => message.timestamp))
      .find((timestamp): timestamp is number => typeof timestamp === "number") ?? Date.now(),
  ).toISOString();
  await mkdir(sessionDir, { recursive: true });

  const seededSessions: SeededSession[] = [];
  const seededByKey = new Map<string, SeededSession>();

  for (const [index, session] of sessions.entries()) {
    const manager = SessionManager.create(canonicalWorkspace, sessionDir);
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

    const file = manager.getSessionFile();
    if (!file) {
      throw new Error("Pi did not create a durable session file for the seeded e2e session.");
    }
    const seededSession: SeededSession = {
      file,
      id: manager.getSessionId(),
      key: session.key ?? `session-${index + 1}`,
    };
    seededSessions.push(seededSession);
    seededByKey.set(seededSession.key, seededSession);
  }

  const store = createStructuredSessionStateStore({
    databasePath: join(sessionDir, STRUCTURED_SESSION_DB_FILENAME),
    digest: testDigest,
    now: () => structuredNow,
    workspace: {
      id: getTestWorkspaceId(canonicalWorkspace),
      label: basename(canonicalWorkspace),
      cwd: canonicalWorkspace,
    },
  });
  try {
    for (const [index, session] of sessions.entries()) {
      const seeded = seededSessions[index];
      if (!seeded) continue;
      const timestamps = session.messages
        .map((message) => message.timestamp)
        .filter((timestamp): timestamp is number => typeof timestamp === "number");
      const createdAt = new Date(timestamps[0] ?? Date.now()).toISOString();
      const updatedAt = new Date(timestamps.at(-1) ?? timestamps[0] ?? Date.now()).toISOString();
      const parentSessionId = session.parentKey
        ? seededByKey.get(session.parentKey)?.id
        : undefined;
      store.upsertPiSession({
        sessionId: seeded.id,
        ...(parentSessionId ? { parentSessionId } : {}),
        title: session.title?.trim() || "New orchestrator",
        titleAutoFrozen: Boolean(session.title?.trim()),
        titleManualOverride: Boolean(session.title?.trim()),
        provider: session.provider ?? DEFAULT_AGENT_SETTINGS.provider,
        model: session.model ?? DEFAULT_AGENT_SETTINGS.model,
        reasoningEffort: session.thinkingLevel ?? DEFAULT_AGENT_SETTINGS.reasoningEffort,
        messageCount: session.messages.length,
        status: "idle",
        createdAt,
        updatedAt,
      });
      store.savePiSessionReference({
        surfacePiSessionId: seeded.id as never,
        reference: {
          surfacePiSessionId: seeded.id as never,
          referenceFingerprint: `svvy-pi-adapter:0.0.0:${getTestWorkspaceId(canonicalWorkspace)}:${seeded.id}:${seeded.id}:seeded-e2e-context`,
          adapterKind: "svvy-pi-adapter",
          adapterVersion: "0.0.0",
          storageLocator: seeded.file,
          piSessionId: seeded.id,
          metadata: {
            actorKind: "orchestrator",
            generatedContextFingerprint: "seeded-e2e-context",
            modelId: session.model ?? DEFAULT_AGENT_SETTINGS.model,
            providerId: session.provider ?? DEFAULT_AGENT_SETTINGS.provider,
            reasoningEffort: session.thinkingLevel ?? DEFAULT_AGENT_SETTINGS.reasoningEffort,
            workspaceId: getTestWorkspaceId(canonicalWorkspace),
            workspaceSessionId: seeded.id,
          },
        },
      });
      let activeTurn: ReturnType<typeof store.startTurn> | null = null;
      let transcriptCursor:
        | ReturnType<typeof store.commitRuntimeTranscriptUserMessage>["cursor"]
        | null = null;
      let lastAssistantMessageId: string | undefined;
      let lastAssistantText: string | undefined;
      const toolCommands = new Map<string, string>();
      const streamGenerationId = `seed-stream-${seeded.id}` as never;
      const finishActiveTurn = () => {
        if (!activeTurn) return;
        store.finishTurn({
          turnId: activeTurn.id,
          status: "completed",
          ...(lastAssistantMessageId ? { assistantMessageId: lastAssistantMessageId } : {}),
          ...(lastAssistantText ? { assistantText: lastAssistantText } : {}),
        });
        activeTurn = null;
        lastAssistantMessageId = undefined;
        lastAssistantText = undefined;
      };
      for (const message of session.messages) {
        const messageTimestamp =
          typeof message.timestamp === "number"
            ? new Date(message.timestamp).toISOString()
            : updatedAt;
        structuredNow = messageTimestamp;
        if (message.role === "user") {
          finishActiveTurn();
          const text =
            typeof message.content === "string"
              ? message.content
              : message.content
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("\n");
          activeTurn = store.startTurn({
            sessionId: seeded.id,
            surfacePiSessionId: seeded.id,
            requestSummary: text.trim(),
          });
          const committed = store.commitRuntimeTranscriptUserMessage({
            workspaceSessionId: seeded.id as never,
            surfacePiSessionId: seeded.id as never,
            turnId: activeTurn.id as never,
            queueItemId: `seed-queue-${seeded.id}-${activeTurn.id}` as never,
            message: { text },
            submittedAt: messageTimestamp as never,
            committedAt: messageTimestamp as never,
            streamGenerationId,
            expectedCursor: transcriptCursor,
          });
          transcriptCursor = committed.cursor;
          continue;
        }
        if (message.role === "toolResult") {
          const commandId = toolCommands.get(message.toolCallId);
          if (!commandId) continue;
          const text = message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
          store.recordLifecycleEvent({
            sessionId: seeded.id,
            kind: "command.output",
            subjectKind: "command",
            subjectId: commandId,
            at: messageTimestamp,
            data: {
              stream: message.isError ? "stderr" : "stdout",
              source: "final-result",
              text,
            },
          });
          store.finishCommand({
            commandId,
            status: message.isError ? "failed" : "succeeded",
            summary: text,
            error: message.isError ? text : null,
            at: messageTimestamp,
          });
          continue;
        }
        if (message.role !== "assistant" || !activeTurn) continue;

        let assistant = store.beginRuntimeTranscriptAssistantMessage({
          workspaceSessionId: seeded.id as never,
          surfacePiSessionId: seeded.id as never,
          turnId: activeTurn.id as never,
          api: message.api ?? null,
          providerId: message.provider as never,
          modelId: message.model as never,
          startedAt: messageTimestamp as never,
          streamGenerationId,
          expectedCursor: transcriptCursor,
        });
        for (const [contentIndex, content] of message.content.entries()) {
          if (content.type === "text" || content.type === "thinking") {
            assistant = store.appendRuntimeTranscriptAssistantContentDelta({
              messageId: assistant.message.messageId,
              surfacePiSessionId: seeded.id as never,
              streamGenerationId,
              expectedCursor: assistant.cursor,
              contentIndex,
              kind: content.type,
              delta: content.type === "text" ? content.text : content.thinking,
              ...(content.type === "thinking" && content.redacted ? { redacted: true } : {}),
              ...(content.type === "thinking" && content.thinkingSignature
                ? { thinkingSignature: content.thinkingSignature }
                : {}),
            });
            continue;
          }
          if (content.type === "toolCall") {
            const command = store.createOrReuseStreamingCommand({
              toolCallId: content.id,
              turnId: activeTurn.id,
              surfacePiSessionId: seeded.id,
              toolName: content.name,
              executor: "orchestrator",
              visibility: "summary",
              title: `Run ${content.name}`,
              summary: `${content.name} is running.`,
              arguments: content.arguments,
            });
            store.startCommand(command.id);
            toolCommands.set(content.id, command.id);
            assistant = store.upsertRuntimeTranscriptAssistantToolCall({
              messageId: assistant.message.messageId,
              surfacePiSessionId: seeded.id as never,
              streamGenerationId,
              expectedCursor: assistant.cursor,
              contentIndex,
              toolCallId: content.id as never,
              toolName: content.name,
              argumentsJson: JSON.stringify(content.arguments),
              argumentsStatus: "accepted",
              ...(content.thoughtSignature ? { thoughtSignature: content.thoughtSignature } : {}),
            });
            assistant = store.linkRuntimeTranscriptAssistantToolCallCommand({
              messageId: assistant.message.messageId,
              surfacePiSessionId: seeded.id as never,
              streamGenerationId,
              expectedCursor: assistant.cursor,
              contentIndex,
              toolCallId: content.id as never,
              commandId: command.id as never,
            });
          }
        }
        const terminalInput = {
          messageId: assistant.message.messageId,
          surfacePiSessionId: seeded.id as never,
          streamGenerationId,
          expectedCursor: assistant.cursor,
          api: message.api ?? null,
          providerId: message.provider as never,
          modelId: message.model as never,
          responseId: null,
          usage: message.usage,
          stopReason: message.stopReason,
          errorMessage: message.errorMessage ?? null,
          piHistoryEntry: null,
          messageTimestamp: messageTimestamp as never,
          finishedAt: messageTimestamp as never,
        } as const;
        const terminal =
          message.stopReason === "error" || message.stopReason === "aborted"
            ? store.failRuntimeTranscriptAssistantMessage({
                ...terminalInput,
                status: message.stopReason === "error" ? "failed" : "cancelled",
              })
            : store.commitRuntimeTranscriptAssistantMessage({
                ...terminalInput,
                content: assistant.message.content,
              });
        transcriptCursor = terminal.cursor;
        lastAssistantMessageId = terminal.message.messageId;
        lastAssistantText = terminal.message.content
          .filter((content) => content.kind === "text")
          .map((content) => content.text)
          .join("\n");
      }
      finishActiveTurn();
    }
  } finally {
    store.close();
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
