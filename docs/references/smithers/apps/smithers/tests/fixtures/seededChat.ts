/**
 * Deterministic chat fixture data shared by the upstream SSE server, the worker
 * integration test, and the chat e2e spec. Keeping it in one place means the
 * server that streams the reply and the specs that assert it can never drift.
 */

/** The model id the fixture upstream echoes back. */
export const SEEDED_CHAT_MODEL = "gpt-oss-120b";

/**
 * The fixed assistant reply the upstream streams for any prompt. It carries a
 * heading, bold, inline code, and a fenced code block so the chat e2e doubles
 * as a Markdown-rendering check.
 */
export const SEEDED_CHAT_REPLY = [
  "Here is your plan:",
  "",
  "1. **Scaffold** the test harness.",
  "2. Wire the `gateway` to Cerebras.",
  "",
  "```ts",
  "const ok = true;",
  "```",
  "",
  "All set.",
].join("\n");

/** A phrase from the reply that survives Markdown rendering as plain text. */
export const SEEDED_CHAT_REPLY_PHRASE = "Here is your plan:";

/** A bolded word in the reply, used to assert `<strong>` rendering. */
export const SEEDED_CHAT_BOLD_WORD = "Scaffold";

/** An inline-code token in the reply, used to assert `<code>` rendering. */
export const SEEDED_CHAT_INLINE_CODE = "gateway";

/** A line inside the fenced code block, used to assert `<pre>` rendering. */
export const SEEDED_CHAT_CODE_LINE = "const ok = true;";

/**
 * Split the reply into stream chunks that re-concatenate to exactly the reply.
 * Whitespace runs are preserved as their own chunks so the streamed deltas are
 * byte-for-byte identical to {@link SEEDED_CHAT_REPLY}.
 */
export function seededReplyChunks(): string[] {
  return SEEDED_CHAT_REPLY.match(/\s+|\S+/g) ?? [];
}
