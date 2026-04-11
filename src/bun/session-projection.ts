import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { SessionStatus, WorkspaceSessionSummary } from "../mainview/chat-rpc";

const PREVIEW_LIMIT = 140;
const TITLE_LIMIT = 72;
const NEW_SESSION_TITLE = "New Session";

export interface SessionProjectionSource {
  id: string;
  name?: string;
  firstMessage?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  messageCount: number;
  messages: AgentMessage[];
  sessionFile?: string;
  parentSessionFile?: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
  isActive?: boolean;
  isStreaming?: boolean;
}

function normalizeText(value: string | undefined, limit: number): string {
  const collapsed = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!collapsed) return "";
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

function flattenMessageText(message: AgentMessage | undefined): string {
  if (!message) return "";

  switch (message.role) {
    case "user":
      if (typeof message.content === "string") {
        return message.content;
      }
      return message.content
        .map((block) => {
          if (block.type === "text") return block.text;
          if (block.type === "image") return "[image]";
          return "";
        })
        .filter(Boolean)
        .join("\n");
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
    default:
      return "";
  }
}

function getFirstUserMessage(messages: AgentMessage[]): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = flattenMessageText(message);
    if (text.trim()) {
      return text;
    }
  }
  return "";
}

function getLatestVisibleMessage(messages: AgentMessage[]): AgentMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult"
    ) {
      return message;
    }
  }
  return undefined;
}

function getLatestMessageTimestamp(messages: AgentMessage[]): number | null {
  const latest = getLatestVisibleMessage(messages);
  if (!latest || typeof latest.timestamp !== "number") {
    return null;
  }
  return latest.timestamp;
}

export function getSessionParentId(parentSessionFile: string | undefined): string | undefined {
  if (!parentSessionFile) return undefined;

  const normalized = parentSessionFile.replace(/\\/g, "/");
  const match = normalized.match(/_([^/]+)\.jsonl$/);
  return match?.[1];
}

export function getSessionTitle(source: Pick<SessionProjectionSource, "name" | "firstMessage" | "messages">): string {
  const explicitName = normalizeText(source.name, TITLE_LIMIT);
  if (explicitName) {
    return explicitName;
  }

  const firstUserMessage = normalizeText(
    getFirstUserMessage(source.messages) || source.firstMessage,
    TITLE_LIMIT,
  );
  if (firstUserMessage) {
    return firstUserMessage;
  }

  return NEW_SESSION_TITLE;
}

export function getSessionPreview(source: Pick<SessionProjectionSource, "firstMessage" | "messages">): string {
  const latestText = normalizeText(flattenMessageText(getLatestVisibleMessage(source.messages)), PREVIEW_LIMIT);
  if (latestText) {
    return latestText;
  }

  const firstMessage = normalizeText(source.firstMessage, PREVIEW_LIMIT);
  if (firstMessage) {
    return firstMessage;
  }

  return "Waiting for first turn";
}

export function deriveSessionStatus(source: Pick<SessionProjectionSource, "messages" | "isActive" | "isStreaming">): SessionStatus {
  if (source.isActive && source.isStreaming) {
    return "running";
  }

  const latest = getLatestVisibleMessage(source.messages);
  if (!latest) {
    return "idle";
  }

  if (latest.role === "assistant" && (latest.stopReason === "error" || latest.stopReason === "aborted")) {
    return "error";
  }

  if (latest.role === "toolResult" && latest.isError) {
    return "error";
  }

  return "idle";
}

export function projectWorkspaceSessionSummary(source: SessionProjectionSource): WorkspaceSessionSummary {
  const createdAt = new Date(source.createdAt);
  const updatedAt = new Date(source.updatedAt);
  const latestMessageTimestamp = getLatestMessageTimestamp(source.messages);
  const latestUpdatedAt =
    latestMessageTimestamp !== null && latestMessageTimestamp > updatedAt.getTime()
      ? new Date(latestMessageTimestamp)
      : updatedAt;

  return {
    id: source.id,
    title: getSessionTitle(source),
    preview: getSessionPreview(source),
    createdAt: createdAt.toISOString(),
    updatedAt: latestUpdatedAt.toISOString(),
    messageCount: source.messageCount,
    status: deriveSessionStatus(source),
    sessionFile: source.sessionFile,
    parentSessionId: getSessionParentId(source.parentSessionFile),
    parentSessionFile: source.parentSessionFile,
    modelId: source.modelId,
    provider: source.provider,
    thinkingLevel: source.thinkingLevel,
  };
}
