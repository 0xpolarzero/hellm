import type { ChatBlock } from "./ChatSession";

/**
 * One newline-delimited delta streamed from `POST /chat/message`.
 *
 * Matches `src/workspace/chatApi.ts`'s `ChatStreamDelta` so `useAgentChat`
 * assembles the assistant block from the real agent runtime's stdout exactly
 * as it does in the e2e path.
 */
export type ChatStreamDelta =
  | { type: "block"; block: ChatBlock }
  | { type: "delta"; id: string; content: string }
  | { type: "done"; id: string }
  | { type: "error"; message: string };
