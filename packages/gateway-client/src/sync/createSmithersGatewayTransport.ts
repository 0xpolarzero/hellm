import type { SmithersGatewayClient } from "../SmithersGatewayClient.ts";
import type { SyncRpcOptions, SyncStreamFrame, SyncStreamOptions, SyncTransport } from "./SyncTransport.ts";

/**
 * Build a `SyncTransport` backed by a `SmithersGatewayClient`. RPC is wired
 * straight through. Stream subscriptions use the client's resilient streaming
 * generators (`streamRunEventsResilient` / `streamDevTools`) so reconnect +
 * resume from the cached `afterSeq` happens at the gateway layer rather than
 * being re-invented inside the hub.
 *
 * The returned transport is intentionally narrow: it ignores stream scopes the
 * client does not know about so a typo in a hook gets a "Transport does not
 * support stream subscriptions" error from the hub rather than a silent stall.
 */

export type SmithersGatewayStreamScope = "streamRunEvents" | "streamDevTools";

export type CreateSmithersGatewayTransportOptions = {
  /**
   * Override per-stream healthyAfterMs / backoff for the resilient generator.
   * The hub will still pass `afterSeq` so reconnects stay incremental.
   */
  streamHealthyAfterMs?: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRunId(params: unknown): string {
  if (!isObject(params) || typeof params.runId !== "string") {
    throw new Error(`Smithers gateway transport: stream params must include { runId: string }, got ${JSON.stringify(params)}`);
  }
  return params.runId;
}

export function createSmithersGatewayTransport(
  client: SmithersGatewayClient,
  options: CreateSmithersGatewayTransportOptions = {},
): SyncTransport {
  return {
    rpc(method: string, params: unknown, opts: SyncRpcOptions = {}): Promise<unknown> {
      return client.rpcRaw(method, params, { signal: opts.signal });
    },
    async *stream(scope: string, params: unknown, streamOptions: SyncStreamOptions): AsyncIterable<SyncStreamFrame> {
      if (scope === "streamRunEvents") {
        const runId = asRunId(params);
        const iterator = client.streamRunEventsResilient(
          {
            runId,
            ...(typeof streamOptions.afterSeq === "number" ? { afterSeq: streamOptions.afterSeq } : {}),
          },
          {
            signal: streamOptions.signal,
            healthyAfterMs: options.streamHealthyAfterMs,
          },
        );
        for await (const frame of iterator) {
          const seq = isObject(frame.payload) && typeof frame.payload.seq === "number"
            ? frame.payload.seq
            : typeof frame.seq === "number"
              ? frame.seq
              : undefined;
          yield {
            key: ["gateway:streamRunEvents", { runId }],
            event: frame.event,
            payload: frame.payload,
            ...(typeof seq === "number" ? { seq } : {}),
          };
        }
        return;
      }
      if (scope === "streamDevTools") {
        const runId = asRunId(params);
        const iterator = client.streamDevTools({ runId }, { signal: streamOptions.signal });
        for await (const frame of iterator) {
          const seq = typeof frame.seq === "number" ? frame.seq : undefined;
          yield {
            key: ["gateway:streamDevTools", { runId }],
            event: frame.event,
            payload: frame.payload,
            ...(typeof seq === "number" ? { seq } : {}),
          };
        }
        return;
      }
      throw new Error(`Smithers gateway transport: unknown stream scope ${scope}`);
    },
  };
}
