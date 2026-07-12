import type {
  RuntimeTranscriptAssistantContentBlock,
  RuntimeTranscriptAssistantMessage,
  RuntimeTranscriptMessage,
} from "@svvy/core";

/**
 * Renderer-facing transcript projection types.
 *
 * These types preserve the display shape consumed by the Svelte transcript while deriving their
 * durable semantics from the core runtime transcript contract. They are not pi message aliases or
 * authoritative state/runtime read-model contracts; the user entry is also the renderer-safe
 * payload used by committed-message editing.
 */

type CoreTranscriptUsage = NonNullable<RuntimeTranscriptAssistantMessage["usage"]>;

export interface RendererTranscriptUsage {
  input: CoreTranscriptUsage["input"];
  output: CoreTranscriptUsage["output"];
  cacheRead: CoreTranscriptUsage["cacheRead"];
  cacheWrite: CoreTranscriptUsage["cacheWrite"];
  totalTokens: CoreTranscriptUsage["totalTokens"];
  cost: {
    input: CoreTranscriptUsage["cost"]["input"];
    output: CoreTranscriptUsage["cost"]["output"];
    cacheRead: CoreTranscriptUsage["cost"]["cacheRead"];
    cacheWrite: CoreTranscriptUsage["cost"]["cacheWrite"];
    total: CoreTranscriptUsage["cost"]["total"];
  };
}

export interface RendererTranscriptTextContent {
  type: Extract<RuntimeTranscriptAssistantContentBlock, { kind: "text" }>["kind"];
  text: string;
  textSignature?: string;
}

export interface RendererTranscriptImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface RendererTranscriptReasoningContent {
  type: Extract<RuntimeTranscriptAssistantContentBlock, { kind: "thinking" }>["kind"];
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}

export interface RendererTranscriptToolCallContent {
  type: Extract<RuntimeTranscriptAssistantContentBlock, { kind: "tool-call" }>["kind"];
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thoughtSignature?: string;
  commandId?: string;
}

export type RendererTranscriptAssistantContent =
  | RendererTranscriptTextContent
  | RendererTranscriptReasoningContent
  | RendererTranscriptToolCallContent;

export interface RendererTranscriptUserEntry {
  role: Extract<RuntimeTranscriptMessage, { role: "user" }>["role"];
  content: string | Array<RendererTranscriptTextContent | RendererTranscriptImageContent>;
  timestamp: number;
  messageId?: string;
  turnId?: string;
}

export interface RendererTranscriptAssistantEntry {
  role: RuntimeTranscriptAssistantMessage["role"];
  content: RendererTranscriptAssistantContent[];
  api: string;
  provider: string;
  model: string;
  timestamp: number;
  usage: RendererTranscriptUsage;
  stopReason: NonNullable<RuntimeTranscriptAssistantMessage["stopReason"]>;
  errorMessage?: string;
  responseId?: string;
  messageId?: string;
  turnId?: string;
}

/** A renderer-only command-result projection used by transcript presentation and export helpers. */
export interface RendererCommandResultEntry {
  role: "command-result";
  toolCallId: string;
  toolName: string;
  content: Array<RendererTranscriptTextContent | RendererTranscriptImageContent>;
  isError: boolean;
  timestamp: number;
  details?: unknown;
}

export type RendererTranscriptEntry =
  | RendererTranscriptUserEntry
  | RendererTranscriptAssistantEntry;

export type RendererConversationEntry = RendererTranscriptEntry | RendererCommandResultEntry;

export interface RendererTranscriptModel {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  input: readonly ("text" | "image")[];
}
