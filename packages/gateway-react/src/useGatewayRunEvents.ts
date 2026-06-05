import { useEffect, useState } from "react";
import type { GatewayEventFrame } from "@smithers-orchestrator/gateway-client";
import { useSmithersGateway } from "./useSmithersGateway.ts";

const DEFAULT_MAX_EVENTS = 1000;

export function useGatewayRunEvents(
  runId: string | undefined,
  options: { afterSeq?: number; maxEvents?: number } = {},
) {
  const client = useSmithersGateway();
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const [events, setEvents] = useState<GatewayEventFrame[]>([]);
  const [lastHeartbeat, setLastHeartbeat] = useState<GatewayEventFrame>();
  const [error, setError] = useState<Error>();
  const [streaming, setStreaming] = useState(Boolean(runId));

  useEffect(() => {
    if (!runId) {
      setStreaming(false);
      return;
    }
    const abort = new AbortController();
    setEvents([]);
    setLastHeartbeat(undefined);
    setStreaming(true);
    setError(undefined);
    void (async () => {
      try {
        for await (const frame of client.streamRunEventsResilient(
          { runId, ...(typeof options.afterSeq === "number" ? { afterSeq: options.afterSeq } : {}) },
          { signal: abort.signal },
        )) {
          if (frame.event === "run.heartbeat") {
            setLastHeartbeat(frame);
            continue;
          }
          setEvents((current) => {
            const next = current.length >= maxEvents
              ? current.slice(current.length - maxEvents + 1)
              : current.slice();
            next.push(frame);
            return next;
          });
        }
      } catch (cause) {
        if (!abort.signal.aborted) {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      } finally {
        if (!abort.signal.aborted) {
          setStreaming(false);
        }
      }
    })();
    return () => abort.abort();
  }, [client, runId, options.afterSeq, maxEvents]);

  return { events, lastHeartbeat, error, streaming };
}
