import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { SessionStatus, WorkspaceSessionSummary } from "../shared/workspace-contract";

const PREVIEW_LIMIT = 140;
const TITLE_LIMIT = 72;
const NEW_ORCHESTRATOR_TITLE = "New orchestrator";

interface SessionSummaryBase {
  id: string;
  createdAt: Date | string;
  messageCount: number;
  parentSessionFile?: string;
}

export interface ActiveSessionProjectionSource extends SessionSummaryBase {
  name?: string;
  firstMessage?: string;
  updatedAt: Date | string;
  messages: AgentMessage[];
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
}

export interface SessionInfoProjectionSource {
  id: string;
  name?: string;
  firstMessage?: string;
  created: Date | string;
  modified: Date | string;
  messageCount: number;
  parentSessionPath?: string;
}

function normalizeText(value: string | undefined, limit: number): string {
  const collapsed = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!collapsed) return "";
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

export function getSessionParentId(parentSessionFile: string | undefined): string | undefined {
  if (!parentSessionFile) return undefined;

  const normalized = parentSessionFile.replace(/\\/g, "/");
  const match = normalized.match(/_([^/]+)\.jsonl$/);
  return match?.[1];
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

function getLatestUserMessage(messages: AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;
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
    if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
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

export function getSessionTitle(source: {
  name?: string;
  firstMessage?: string;
  messages?: AgentMessage[];
}): string {
  const explicitName = normalizeText(source.name, TITLE_LIMIT);
  if (explicitName) {
    return explicitName;
  }

  const firstUserMessage = normalizeText(
    (source.messages ? getFirstUserMessage(source.messages) : "") || source.firstMessage,
    TITLE_LIMIT,
  );
  if (firstUserMessage) {
    return firstUserMessage;
  }

  return NEW_ORCHESTRATOR_TITLE;
}

export function getSessionPreview(source: {
  firstMessage?: string;
  messages?: AgentMessage[];
}): string {
  if (source.messages) {
    const latestText = normalizeText(getLatestUserMessage(source.messages), PREVIEW_LIMIT);
    if (latestText) {
      return latestText;
    }
  }

  const firstMessage = normalizeText(source.firstMessage, PREVIEW_LIMIT);
  if (firstMessage) {
    return firstMessage;
  }

  return "";
}

function buildWorkspaceSessionSummary(
  source: SessionSummaryBase,
  options: {
    title: string;
    preview: string;
    status: SessionStatus;
    updatedAt: string;
    provider?: string;
    modelId?: string;
    thinkingLevel?: string;
  },
): WorkspaceSessionSummary {
  const createdAt = new Date(source.createdAt);
  const parentSessionId = getSessionParentId(source.parentSessionFile);

  return {
    id: source.id,
    ...(parentSessionId ? { parentSessionId } : {}),
    title: options.title,
    preview: options.preview,
    createdAt: createdAt.toISOString(),
    updatedAt: options.updatedAt,
    messageCount: source.messageCount,
    status: options.status,
    isPinned: false,
    pinnedAt: null,
    isArchived: false,
    archivedAt: null,
    isUnread: false,
    unreadAt: null,
    unreadReason: null,
    lastReadAt: null,
    modelId: options.modelId,
    provider: options.provider,
    thinkingLevel: options.thinkingLevel,
  };
}

export function projectWorkspaceSessionSummaryFromInfo(
  source: SessionInfoProjectionSource,
): WorkspaceSessionSummary {
  return buildWorkspaceSessionSummary(
    {
      id: source.id,
      createdAt: source.created,
      messageCount: source.messageCount,
      parentSessionFile: source.parentSessionPath,
    },
    {
      title: getSessionTitle(source),
      preview: getSessionPreview(source),
      status: "idle",
      updatedAt: new Date(source.modified).toISOString(),
    },
  );
}

export function projectWorkspaceSessionSummary(
  source: ActiveSessionProjectionSource,
): WorkspaceSessionSummary {
  const updatedAt = new Date(source.updatedAt);
  const latestMessageTimestamp = getLatestMessageTimestamp(source.messages);
  const latestUpdatedAt =
    latestMessageTimestamp !== null && latestMessageTimestamp > updatedAt.getTime()
      ? new Date(latestMessageTimestamp)
      : updatedAt;

  return buildWorkspaceSessionSummary(source, {
    title: getSessionTitle(source),
    preview: getSessionPreview(source),
    status: "idle" satisfies SessionStatus,
    updatedAt: latestUpdatedAt.toISOString(),
    provider: source.provider,
    modelId: source.modelId,
    thinkingLevel: source.thinkingLevel,
  });
}
