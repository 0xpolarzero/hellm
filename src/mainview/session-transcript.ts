import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { WorkspaceSessionSummary } from "../shared/workspace-contract";
import { projectConversation, type ProjectedToolCall } from "./conversation-projection";

export interface SessionTranscriptExportInput {
  session: Pick<WorkspaceSessionSummary, "id" | "title" | "status" | "createdAt" | "updatedAt">;
  target?: {
    workspaceSessionId: string;
    surface: "orchestrator" | "thread";
    surfacePiSessionId: string;
    threadId?: string;
  };
  provider: string;
  model: string;
  reasoningEffort: string;
  systemPrompt?: string;
  messages: AgentMessage[];
  streamMessage?: AssistantMessage | null;
}

export function buildSessionTranscriptExport(input: SessionTranscriptExportInput): string {
  const lines: string[] = [];
  const conversation = projectConversation(input.messages);

  lines.push("# svvy transcript export");
  lines.push("");
  lines.push("## session");
  lines.push(`id: ${input.session.id}`);
  lines.push(`title: ${input.session.title}`);
  lines.push(`status: ${input.session.status}`);
  lines.push(`createdAt: ${input.session.createdAt}`);
  lines.push(`updatedAt: ${input.session.updatedAt}`);
  if (input.target) {
    lines.push("");
    lines.push("## surface");
    lines.push(`workspaceSessionId: ${input.target.workspaceSessionId}`);
    lines.push(`surface: ${input.target.surface}`);
    lines.push(`surfacePiSessionId: ${input.target.surfacePiSessionId}`);
    if (input.target.threadId) {
      lines.push(`threadId: ${input.target.threadId}`);
    }
  }
  lines.push("");
  lines.push("## model");
  lines.push(`provider: ${input.provider}`);
  lines.push(`model: ${input.model}`);
  lines.push(`reasoningEffort: ${input.reasoningEffort}`);
  lines.push(`committedMessages: ${input.messages.length}`);

  if (input.streamMessage) {
    lines.push("streamingMessage: present");
  }

  lines.push("");
  lines.push("## system prompt");
  appendCodeBlock(lines, "text", input.systemPrompt?.trim() || "(empty)");
  lines.push("");
  lines.push("## committed transcript");

  if (input.messages.length === 0) {
    lines.push("(empty)");
  } else {
    input.messages.forEach((message, index) => {
      appendMessage(lines, message, index + 1, conversation.toolCallsById);
    });
  }

  if (input.streamMessage) {
    lines.push("");
    lines.push("## streaming assistant snapshot");
    appendAssistantMessage(lines, input.streamMessage, "streaming");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function appendMessage(
  lines: string[],
  message: AgentMessage,
  index: number,
  toolCallsById: ReadonlyMap<string, ProjectedToolCall>,
): void {
  if (isUserMessage(message)) {
    appendUserMessage(lines, message, index);
    return;
  }

  if (isAssistantMessage(message)) {
    appendAssistantMessage(lines, message, index, toolCallsById);
    return;
  }

  if (isToolResultMessage(message)) {
    appendToolResultMessage(lines, message, index);
    return;
  }

  lines.push("");
  lines.push(`### [${index}] custom message @ ${formatTimestamp(getTimestamp(message))}`);
  appendCodeBlock(lines, "json", safeJson(message));
}

function appendUserMessage(lines: string[], message: UserMessage, index: number): void {
  lines.push("");
  lines.push(`### [${index}] user @ ${formatTimestamp(message.timestamp)}`);
  appendContentBlocks(lines, normalizeUserContent(message.content), "user");
}

function appendAssistantMessage(
  lines: string[],
  message: AssistantMessage,
  index: number | "streaming",
  toolCallsById: ReadonlyMap<string, ProjectedToolCall> = new Map(),
): void {
  const label = index === "streaming" ? "[streaming]" : `[${index}]`;
  lines.push("");
  lines.push(`### ${label} assistant @ ${formatTimestamp(message.timestamp)}`);
  lines.push(`api: ${message.api}`);
  lines.push(`provider: ${message.provider}`);
  lines.push(`model: ${message.model}`);
  lines.push(`stopReason: ${message.stopReason}`);

  if (message.responseId) {
    lines.push(`responseId: ${message.responseId}`);
  }

  if (message.errorMessage) {
    lines.push(`errorMessage: ${message.errorMessage}`);
  }

  lines.push("usage:");
  appendCodeBlock(lines, "json", safeJson(message.usage));

  let blockIndex = 0;
  for (const block of message.content) {
    blockIndex += 1;

    if (block.type === "text") {
      lines.push(`text[${blockIndex}]:`);
      appendCodeBlock(lines, "text", block.text || "(empty)");
      continue;
    }

    if (block.type === "thinking") {
      lines.push(`thinking[${blockIndex}]:`);
      appendCodeBlock(lines, "text", block.thinking || (block.redacted ? "[redacted]" : "(empty)"));
      if (block.redacted) {
        lines.push("thinkingRedacted: true");
      }
      if (block.thinkingSignature) {
        lines.push(`thinkingSignature: ${block.thinkingSignature}`);
      }
      continue;
    }

    lines.push(
      `toolCall[${blockIndex}]: ${formatToolCallLabel(block, toolCallsById.get(block.id))}`,
    );
    lines.push("arguments:");
    appendCodeBlock(lines, "json", safeJson(block.arguments));
    if (block.thoughtSignature) {
      lines.push(`thoughtSignature: ${block.thoughtSignature}`);
    }
  }
}

function appendToolResultMessage(lines: string[], message: ToolResultMessage, index: number): void {
  lines.push("");
  lines.push(`### [${index}] tool result @ ${formatTimestamp(message.timestamp)}`);
  lines.push(`toolName: ${message.toolName}`);
  lines.push(`toolCallId: ${message.toolCallId}`);
  lines.push(`isError: ${message.isError}`);

  appendContentBlocks(lines, message.content, "result");

  if (typeof message.details !== "undefined") {
    lines.push("details:");
    appendCodeBlock(lines, "json", safeJson(message.details));
  }
}

function appendContentBlocks(
  lines: string[],
  blocks: Array<TextContent | ImageContent>,
  label: string,
): void {
  if (blocks.length === 0) {
    lines.push(`${label}Content: (empty)`);
    return;
  }

  let blockIndex = 0;
  for (const block of blocks) {
    blockIndex += 1;

    if (block.type === "text") {
      lines.push(`${label}Text[${blockIndex}]:`);
      appendCodeBlock(lines, "text", block.text || "(empty)");
      continue;
    }

    lines.push(`${label}Image[${blockIndex}]: ${formatImageSummary(block)}`);
  }
}

function appendCodeBlock(lines: string[], language: string, body: string): void {
  lines.push(`\`\`\`${language}`);
  lines.push(body);
  lines.push("```");
}

function normalizeUserContent(content: UserMessage["content"]): Array<TextContent | ImageContent> {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

function formatToolCallLabel(block: ToolCall, projectedToolCall?: ProjectedToolCall): string {
  if (!projectedToolCall || projectedToolCall.totalAttempts <= 1) {
    return `${block.name} (${block.id})`;
  }

  return `${block.name} (${block.id}) [attempt ${projectedToolCall.attempt}/${projectedToolCall.totalAttempts}]`;
}

function formatImageSummary(block: ImageContent): string {
  return `[image ${block.mimeType}, ${block.data.length} bytes base64 omitted]`;
}

function formatTimestamp(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function getTimestamp(message: AgentMessage): number {
  const candidate = (message as { timestamp?: unknown }).timestamp;
  return typeof candidate === "number" ? candidate : Number.NaN;
}

function isUserMessage(message: AgentMessage): message is UserMessage {
  return (message as { role?: unknown }).role === "user";
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return (message as { role?: unknown }).role === "assistant";
}

function isToolResultMessage(message: AgentMessage): message is ToolResultMessage {
  return (message as { role?: unknown }).role === "toolResult";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}
