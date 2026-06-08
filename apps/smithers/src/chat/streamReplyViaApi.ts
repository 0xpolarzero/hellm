import { authFetch } from "../auth/authClient";

export type ApiChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * An SSE client for the chat backend. POSTs the conversation to /api/chat,
 * where the Cloudflare Worker runs the model server-side and streams back
 * Server-Sent Events. This parses those events and yields the assistant's
 * answer one delta at a time so the UI can render as it arrives.
 *
 * No API key is involved on the client: the key lives only on the Worker.
 * `signal` cancels the in-flight request.
 */
export async function* streamReplyViaApi({
  messages,
  system,
  signal,
  endpoint = "/api/chat",
}: {
  messages: ApiChatMessage[];
  system?: string;
  signal?: AbortSignal;
  endpoint?: string;
}): AsyncGenerator<string> {
  const response = await authFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, system }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Chat request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        return;
      }
      let chunk: { type?: string; delta?: unknown; message?: unknown };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.type === "TEXT_MESSAGE_CONTENT" && typeof chunk.delta === "string") {
        yield chunk.delta;
      } else if (chunk.type === "RUN_ERROR") {
        throw new Error(
          typeof chunk.message === "string" ? chunk.message : "Chat failed.",
        );
      }
    }
  }
}
