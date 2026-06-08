/**
 * The minimal surface a transport must expose to back the sync cache. Any
 * object that can do request/response and stream subscriptions works: tests
 * pass a stub; production code passes a `SmithersGatewayClient` adapter from
 * `gateway-client`. Keeping the SDK transport-agnostic is what lets it back
 * apps/smithers AND third-party custom UIs without dragging the WS protocol
 * into the consumer.
 */

export type SyncRpcOptions = {
  signal?: AbortSignal;
};

/** A streamed event the cache forwards to subscribers. */
export type SyncStreamFrame = {
  /** The cache key the event applies to (e.g. `["run", runId]`). */
  key: ReadonlyArray<unknown>;
  /** Server sequence number for last-seq tracking; missing on heartbeats. */
  seq?: number;
  /** Event name, mirroring the gateway frame's `event` field. */
  event: string;
  /** Opaque payload — interpreted by the subscriber. */
  payload: unknown;
};

export type SyncStreamOptions = {
  signal?: AbortSignal;
  /** Last seq the caller already observed; lets the transport resume. */
  afterSeq?: number;
};

export type SyncTransport = {
  rpc(method: string, params: unknown, options?: SyncRpcOptions): Promise<unknown>;
  /**
   * Open a stream. Implementations should resume from `afterSeq` and handle
   * reconnection internally; the SDK still tracks lastSeq and bumps it across
   * reconnect via `afterSeq` so transports that don't reconnect still recover.
   */
  stream?(scope: string, params: unknown, options: SyncStreamOptions): AsyncIterable<SyncStreamFrame>;
};
