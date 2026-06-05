import type { ServerResponse } from "node:http";
import type { ChatBlock, ChatSession } from "./ChatSession";
import type { ChatStreamDelta } from "./ChatStreamDelta";
import { createChatAgent } from "./createChatAgent";
import { chatSessionPath, coerceSession, detectChatAgentId, loadChatSession, saveChatSession } from "./loadChatSession";
import { resolveChatWorkspaceRoot } from "./resolveChatWorkspaceRoot";
import { existsSync, readFileSync } from "node:fs";

function writeDelta(res: ServerResponse, delta: ChatStreamDelta): void {
  res.write(`${JSON.stringify(delta)}\n`);
}

/**
 * Load the session by id from disk, falling back to the workspace's active
 * session. The frontend always sends the id it loaded, so this resolves the
 * same persisted transcript.
 */
function loadSessionById(root: string, sessionId: string): ChatSession {
  const path = chatSessionPath(root);
  if (existsSync(path)) {
    try {
      const parsed = coerceSession(JSON.parse(readFileSync(path, "utf8")) as unknown, root);
      if (parsed && parsed.sessionId === sessionId) {
        return parsed;
      }
    } catch {
      // Corrupt/partial transcript on disk: fall back to the active session
      // below instead of throwing mid-stream (the ndjson response has already
      // started, so a thrown error could not be surfaced cleanly).
    }
  }
  return loadChatSession();
}

/** Build the agent prompt from the persisted transcript plus the new turn. */
function buildPrompt(session: ChatSession, content: string): string {
  const history = session.blocks
    .filter((block) => block.role === "user" || block.role === "assistant")
    .map((block) => `${block.role === "user" ? "User" : "Assistant"}: ${block.content}`)
    .join("\n\n");
  return history ? `${history}\n\nUser: ${content}` : content;
}

/**
 * Run a chat turn against the REAL agent runtime, streaming its stdout to the
 * client as `application/x-ndjson` `ChatStreamDelta` lines, then persist the
 * assistant block to the session transcript.
 *
 * This is not a canned reply: it constructs the detected agent (claude, codex,
 * …), invokes its `generate` with an `onStdout` callback, and forwards each
 * chunk as a `delta`. Any runtime failure is surfaced as an `error` delta.
 */
export async function streamChatMessage(
  res: ServerResponse,
  body: { sessionId?: unknown; content?: unknown },
): Promise<void> {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";

  // Empty content is a clean validation fault: surface it as a 200 ndjson error
  // delta (the client always reads this route as a stream). This needs no
  // workspace/session, so it is handled before any throwing resolution.
  if (!content) {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    writeDelta(res, { type: "error", message: "content is required." });
    res.end();
    return;
  }

  // Resolve the workspace + session and stage the initial transcript blocks
  // BEFORE sending any bytes. resolveChatWorkspaceRoot() (404 when no
  // .smithers) and loadSessionById() can throw; doing this work pre-stream lets
  // the handler's catch return a proper non-200 JSON error instead of a
  // headers-already-sent response with no error delta. Once writeHead runs the
  // response is committed and failures must be surfaced as error deltas.
  const root = resolveChatWorkspaceRoot();
  const session = sessionId ? loadSessionById(root, sessionId) : loadChatSession();

  const userBlock: ChatBlock = {
    id: `user-${Date.now()}`,
    role: "user",
    content,
    timestampMs: Date.now(),
  };
  session.blocks.push(userBlock);

  const assistantId = `assistant-${Date.now()}`;
  const assistantBlock: ChatBlock = {
    id: assistantId,
    role: "assistant",
    content: "",
    timestampMs: Date.now(),
    pending: true,
  };
  session.blocks.push(assistantBlock);

  res.writeHead(200, { "content-type": "application/x-ndjson" });
  writeDelta(res, { type: "block", block: { ...assistantBlock } });

  try {
    const agentId = session.model ?? detectChatAgentId(root);
    const agent = createChatAgent(agentId, root);

    // The CLI agents emit their assistant text via the structured `completed`
    // event's `answer` field — the authoritative final message. We use that as
    // the source of truth (raw stdout from stream-json agents can repeat the
    // text across a streaming + a final-message frame). `onStdout` still drives
    // a live "thinking" pulse, but the rendered content is the clean answer.
    let answer = "";
    const result = await agent.generate({
      prompt: buildPrompt(session, content),
      rootDir: root,
      onEvent: (event: unknown) => {
        if (event && typeof event === "object" && (event as { type?: unknown }).type === "completed") {
          const candidate = (event as { answer?: unknown }).answer;
          if (typeof candidate === "string" && candidate) {
            answer = candidate;
          }
        }
      },
    });

    // Fall back to the assembled text result if no `completed.answer` arrived.
    if (!answer) {
      const resultText = typeof (result as { text?: unknown })?.text === "string"
        ? (result as { text: string }).text
        : "";
      answer = resultText;
    }

    if (answer) {
      writeDelta(res, { type: "delta", id: assistantId, content: answer });
    }
    assistantBlock.content = answer;
    assistantBlock.pending = false;
    writeDelta(res, { type: "done", id: assistantId });
    saveChatSession(root, session);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    assistantBlock.content = assistantBlock.content || `Agent error: ${message}`;
    assistantBlock.pending = false;
    writeDelta(res, { type: "error", message });
    saveChatSession(root, session);
  } finally {
    res.end();
  }
}
