import { useEffect, useState } from "react";
import { SmithersGatewayClient } from "@smithers-orchestrator/gateway-client";
import type { RunEventLine } from "./runState";

const MAX_LINES = 500;

/**
 * The Gateway accepts a WebSocket upgrade on any path; its default `wsPath` is
 * `/`, which in dev collides with Vite's HMR socket and in the SPA shell has no
 * boot config to override it. We instead route the run-event socket through the
 * SAME `/v1/rpc` prefix the RPC client already uses — that path is proxied to
 * the real Gateway in dev (and e2e), and is a real Gateway upgrade endpoint in
 * production. This subclass rewrites only the path so the client's connect/
 * subscribe handshake reaches the Gateway instead of Vite.
 */
const RPC_WS_PATH = "/v1/rpc";

class RpcPathWebSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    const next = new URL(url);
    next.pathname = RPC_WS_PATH;
    next.search = "";
    super(next.toString(), protocols);
  }
}

let cachedClient: SmithersGatewayClient | undefined;

/**
 * The Gateway client the live run-event stream rides on. It is the SAME wire
 * protocol the rest of the Runs surface speaks over `/v1/rpc`, but here we need
 * the WebSocket transport (RPC-over-WS `connect` handshake + `streamRunEvents`
 * subscription) so the Gateway actually delivers `run.event` frames. A raw
 * `?subscribe=` socket receives nothing because the Gateway only fans events to
 * streams registered via the `streamRunEvents` RPC after a `connect` frame.
 */
function runEventsClient(): SmithersGatewayClient {
  if (!cachedClient) {
    cachedClient = new SmithersGatewayClient({ WebSocket: RpcPathWebSocket });
  }
  return cachedClient;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Map a real Gateway run-event stream payload onto a {@link RunEventLine}. The
 * stream frame's `payload` is `{ streamId, runId, seq, event, payload }`, where
 * the inner `event` is the run event name (`node.started`, `task.output`, …)
 * and the inner `payload` carries `nodeId` plus event-specific fields (the
 * NodeOutput `output` text is the live log line; some events carry no text).
 */
function toLine(streamPayload: Record<string, unknown>): RunEventLine {
  const inner = asRecord(streamPayload.payload);
  const eventName = typeof streamPayload.event === "string" ? streamPayload.event : "event";
  const nodeId = typeof inner.nodeId === "string" ? inner.nodeId : undefined;
  const message =
    typeof inner.output === "string"
      ? inner.output
      : typeof inner.message === "string"
        ? inner.message
        : typeof inner.text === "string"
          ? inner.text
          : typeof inner.error === "string"
            ? inner.error
            : eventName;
  return {
    seq: typeof streamPayload.seq === "number" ? streamPayload.seq : 0,
    nodeId,
    event: eventName,
    message,
    atMs: Date.now(),
  };
}

/**
 * Subscribe to a run's live event stream over the Gateway WebSocket.
 *
 * This drives the REAL Gateway protocol via {@link SmithersGatewayClient}: it
 * opens the RPC-over-WS transport, sends the `connect` handshake (subscribing
 * to the run), and registers a `streamRunEvents` subscription — the only way
 * the Gateway fans `run.event` frames to a client. Frames map onto the logs
 * tab (`lines`), the per-node running cursor (`lastLogByNode`), and a monotonic
 * `eventEpoch` the data layer watches to debounce a live getRun/snapshot
 * refresh. `streamRunEventsResilient` reconnects + resumes from the last seq on
 * a silent drop, so the stream survives transient socket loss.
 *
 * Streaming is best-effort: when no socket opens (no live Gateway) the hook
 * yields an empty list and never throws, so the surface degrades to a static
 * tree + inspector (polling in useRunsData is the floor).
 *
 * Out-of-process runs: runs launched detached (`smithers up --detach`) execute
 * in a separate process, so their events never reach the gateway's in-process
 * event pump. The dev gateway bridges those in by tailing the persisted
 * `_smithers_events` log and replaying each row through its event ingestion
 * (see `server/startGatewayServer.ts`), so `streamRunEvents` delivers REAL per-
 * node frames for detached runs too — `streaming` flips true and the logs tab
 * fills exactly as it does for in-process runs. If that bridge is ever absent
 * (a gateway with no event relay), the stream is heartbeat-only: `streaming`
 * stays false (the badge shows "polling", not "live") and the logs tab stays
 * honestly empty while the 2s poll keeps the tree/state progressing.
 */
export function useRunEvents(runId: string | undefined): {
  lines: RunEventLine[];
  lastLogByNode: Map<string, string>;
  /**
   * True only after a REAL run-event frame (`run.event` / `run.gap_resync` /
   * `run.error`) has actually arrived over the live socket — NOT merely because
   * the socket connected or a heartbeat was received. A `run.heartbeat`-only
   * stream (e.g. a run whose events the gateway is not relaying) leaves this
   * false, so the "live" badge never lies. Drops to false when the socket closes
   * or the stream ends.
   */
  streaming: boolean;
  /**
   * Monotonic counter bumped once per ingested `run.event` frame. The data
   * layer watches this to debounce-refresh getRun/getDevToolsSnapshot, so new
   * approvals, state transitions, and completion appear live without the user
   * re-selecting the run. Resets to 0 when the run changes.
   */
  eventEpoch: number;
} {
  const [lines, setLines] = useState<RunEventLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [lastLogByNode, setLastLogByNode] = useState<Map<string, string>>(new Map());
  const [eventEpoch, setEventEpoch] = useState(0);

  useEffect(() => {
    setLastLogByNode(new Map());
    setLines([]);
    setEventEpoch(0);
    setStreaming(false);
    if (!runId || typeof WebSocket === "undefined") {
      return;
    }

    const abort = new AbortController();

    // Batch frame application. A connect-time backlog replay (afterSeq:0) — and
    // any burst of frames — would otherwise force ONE re-render per frame: the
    // async for-await loop crosses await boundaries, so React cannot auto-batch
    // the per-frame setState calls. We accumulate into buffers and flush once
    // per animation frame, so a burst collapses into a single render (which also
    // keeps a backlog replay from churning the tree/inspector mid-interaction).
    let pendingLines: RunEventLine[] = [];
    const pendingLastLog = new Map<string, string>();
    let pendingEpoch = 0;
    let sawReal = false;
    let ended = false;
    let scheduled = false;
    let rafHandle = 0;

    const flush = () => {
      scheduled = false;
      if (abort.signal.aborted) return;
      // Only (re-)assert "live" while the stream is still open. A flush can be
      // scheduled by the final run.completed frame and then run AFTER the
      // generator returns and `finally` set streaming false — without this
      // guard it would flip the badge back to "live" on a finished run forever.
      if (sawReal && !ended) setStreaming(true);
      if (pendingLines.length > 0) {
        const batch = pendingLines;
        pendingLines = [];
        setLines((current) => {
          const next = current.concat(batch);
          return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
        });
      }
      if (pendingLastLog.size > 0) {
        const entries = [...pendingLastLog];
        pendingLastLog.clear();
        setLastLogByNode((current) => {
          const next = new Map(current);
          for (const [nodeId, message] of entries) next.set(nodeId, message);
          return next;
        });
      }
      if (pendingEpoch > 0) {
        const bump = pendingEpoch;
        pendingEpoch = 0;
        setEventEpoch((epoch) => epoch + bump);
      }
    };
    const scheduleFlush = () => {
      if (scheduled) return;
      scheduled = true;
      if (typeof requestAnimationFrame === "function") rafHandle = requestAnimationFrame(flush);
      else queueMicrotask(flush);
    };

    void (async () => {
      try {
        for await (const frame of runEventsClient().streamRunEventsResilient(
          // afterSeq:0 requests the gateway's FULL run-event window on first
          // connect: without it the subscription starts at "now" and every
          // event the run emitted before we subscribed is lost (a blank logs
          // tab for an already-running run). 0 means "everything after seq 0",
          // i.e. the entire retained backlog. streamRunEventsResilient then
          // advances afterSeq to the last seq it saw, so reconnects resume
          // without re-replaying.
          { runId, afterSeq: 0 },
          { signal: abort.signal },
        )) {
          // Heartbeats keep the socket alive but prove NOTHING about the run
          // producing events. They must NOT flip the live badge — a heartbeat-
          // only stream is exactly the out-of-process case the badge used to
          // lie about. Skip them entirely (no liveness, no epoch bump).
          if (frame.event === "run.heartbeat") continue;

          // gap_resync: the run advanced past the retained window before we
          // could replay it. It carries a snapshot, not a log line — use it for
          // liveness + a state refresh (bump the epoch so the data layer re-
          // fetches getRun/snapshot) but DO NOT synthesize a generic log line.
          if (frame.event === "run.gap_resync") {
            sawReal = true;
            pendingEpoch += 1;
            scheduleFlush();
            continue;
          }

          // run.error: a stream-level error frame (replay failed, etc.). Render
          // it distinctly as an error line rather than letting toLine collapse
          // it into a generic "event" row, and do not bump the refresh epoch.
          if (frame.event === "run.error") {
            const errorPayload = asRecord(frame.payload);
            const errorInfo = asRecord(errorPayload.error);
            const errorMessage =
              typeof errorInfo.message === "string"
                ? errorInfo.message
                : typeof errorPayload.message === "string"
                  ? errorPayload.message
                  : "run event stream error";
            sawReal = true;
            pendingLines.push({
              seq: typeof errorPayload.seq === "number" ? errorPayload.seq : 0,
              event: "run.error",
              message: errorMessage,
              atMs: Date.now(),
            });
            scheduleFlush();
            continue;
          }

          // A real run.event frame: the live badge can now honestly claim live,
          // because a genuine per-node event (not a heartbeat) has arrived.
          sawReal = true;
          const line = toLine(asRecord(frame.payload));
          if (line.nodeId && line.message) pendingLastLog.set(line.nodeId, line.message);
          pendingLines.push(line);
          pendingEpoch += 1;
          scheduleFlush();
        }
      } catch {
        // A real drop/failure (connect refused, invalid frame). Best-effort:
        // fall through to the static + polling surface without throwing.
      } finally {
        // Mark ended BEFORE clearing streaming so a still-scheduled flush (from
        // the final frame) cannot re-assert "live" after the stream closed.
        ended = true;
        if (!abort.signal.aborted) setStreaming(false);
      }
    })();

    return () => {
      setStreaming(false);
      abort.abort();
      if (rafHandle && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafHandle);
    };
  }, [runId]);

  return { lines, lastLogByNode, streaming, eventEpoch };
}
