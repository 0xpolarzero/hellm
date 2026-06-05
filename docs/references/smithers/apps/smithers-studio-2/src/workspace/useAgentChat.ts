import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ChatBlock,
  type ChatStreamDelta,
  loadChatSession,
  sendChatMessage,
} from "./chatApi";

export type AgentChatStatus = "loading" | "ready" | "streaming" | "error";

export type AgentChatState = {
  status: AgentChatStatus;
  error: string | null;
  blocks: ChatBlock[];
  model: string | null;
  mode: string | null;
  send: (content: string) => void;
};

/**
 * Surface-local chat state. Detail state for the chat half lives HERE (inside
 * the workspace folder), never in useStudioStore — per the foundation rule that
 * the global store holds only top-level nav + terminal tabs + palette.
 */
export function useAgentChat(active: boolean): AgentChatState {
  const [status, setStatus] = useState<AgentChatStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<ChatBlock[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Set true when the in-flight stream emitted an `error` delta. The stream
  // still resolves normally afterward (the transport closed cleanly), so the
  // send()'s trailing `.then` would otherwise overwrite the error status with
  // "ready". This ref lets that `.then` know the response actually failed.
  const streamErroredRef = useRef(false);

  useEffect(() => {
    // Load once the chat segment is active and we have no session yet. We guard
    // with sessionIdRef (not a "started" ref) so React 18 StrictMode's mount →
    // cleanup → remount double-invoke cannot strand us in "loading": the second
    // mount simply re-fetches because the first run was cancelled before it
    // could record a session.
    if (!active || sessionIdRef.current) return;
    let cancelled = false;
    setStatus("loading");
    loadChatSession()
      .then((session) => {
        if (cancelled) return;
        sessionIdRef.current = session.sessionId;
        setBlocks(session.blocks);
        setModel(session.model);
        setMode(session.mode);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const applyDelta = useCallback((delta: ChatStreamDelta) => {
    setBlocks((current) => {
      switch (delta.type) {
        case "block": {
          const existing = current.findIndex((block) => block.id === delta.block.id);
          if (existing === -1) return [...current, delta.block];
          const next = current.slice();
          next[existing] = delta.block;
          return next;
        }
        case "delta": {
          const index = current.findIndex((block) => block.id === delta.id);
          if (index === -1) {
            // Only a freshly-created streaming block starts pending. Appending to
            // an existing block must NOT force pending back on — a late delta
            // after `done` (or against an already-finalized block) would
            // otherwise re-mark it as still streaming.
            return [
              ...current,
              { id: delta.id, role: "assistant", content: delta.content, timestampMs: Date.now(), pending: true },
            ];
          }
          const next = current.slice();
          next[index] = { ...next[index], content: next[index].content + delta.content };
          return next;
        }
        case "done": {
          // Finalize the named block AND any leftover synthetic "stream" block.
          // Non-JSON stream lines are emitted under the id "stream" (see
          // chatApi.emitLine), but the runtime's `done` carries its real block
          // id — so without also clearing "stream" that synthetic block would
          // stay pending forever.
          const ids = new Set([delta.id, "stream"]);
          let changed = false;
          const next = current.map((block) => {
            if (ids.has(block.id) && block.pending) {
              changed = true;
              return { ...block, pending: false };
            }
            return block;
          });
          return changed ? next : current;
        }
        case "error": {
          // An error delta ends the response: finalize EVERY still-pending
          // block (the named runtime block and any synthetic "stream" block) so
          // nothing spins forever, then surface the error below. Without this
          // the assistant bubble stays in its pending/streaming state.
          let changed = false;
          const next = current.map((block) => {
            if (block.pending) {
              changed = true;
              return { ...block, pending: false };
            }
            return block;
          });
          return changed ? next : current;
        }
      }
    });
    if (delta.type === "error") {
      streamErroredRef.current = true;
      setError(delta.message);
      setStatus("error");
    }
  }, []);

  const send = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      const sessionId = sessionIdRef.current;
      if (!trimmed || !sessionId) return;

      const userBlock: ChatBlock = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestampMs: Date.now(),
      };
      setBlocks((current) => {
        // Retire any leftover synthetic "stream" block from a PRIOR turn before
        // starting this one. Non-JSON stream lines render into a block with the
        // fixed id "stream" (see chatApi.emitLine). If a previous turn left such
        // a block behind, a new turn's "stream" deltas would re-target it —
        // appending this turn's text onto the old, finalized bubble with no
        // pending indicator. Renaming it to a unique id frees "stream" so the
        // next non-JSON delta mints a fresh, correctly-pending block while the
        // prior transcript is preserved verbatim.
        const next = current.map((block) =>
          block.id === "stream"
            ? { ...block, id: `stream-${block.timestampMs ?? Date.now()}`, pending: false }
            : block,
        );
        next.push(userBlock);
        return next;
      });
      setStatus("streaming");
      setError(null);
      streamErroredRef.current = false;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      sendChatMessage(sessionId, trimmed, applyDelta, controller.signal)
        .then(() => {
          // The stream can close cleanly AFTER emitting an `error` delta (the
          // transport succeeded; the agent reported a failure). Don't reset to
          // "ready" in that case — applyDelta already moved us to "error".
          if (streamErroredRef.current) return;
          setStatus("ready");
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted) return;
          setError(reason instanceof Error ? reason.message : String(reason));
          setStatus("error");
        });
    },
    [applyDelta],
  );

  return { status, error, blocks, model, mode, send };
}
