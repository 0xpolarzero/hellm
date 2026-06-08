export { gatewayBackoffDelay, type GatewayBackoffOptions } from "./gatewayBackoffDelay.ts";
export { GatewayRpcError } from "./GatewayRpcError.ts";
export { SmithersGatewayClient } from "./SmithersGatewayClient.ts";
export type { GatewayStreamReconnectEvent } from "./SmithersGatewayClient.ts";
export { SmithersGatewayConnection } from "./SmithersGatewayConnection.ts";
export type { GatewayEventFrame } from "./GatewayEventFrame.ts";
export type { GatewayRequestFrame } from "./GatewayRequestFrame.ts";
export type { GatewayResponseFrame } from "./GatewayResponseFrame.ts";
export type { GatewayRpcParams, GatewayRpcPayload, GatewayRpcRequestMap, GatewayRpcResponseMap } from "./GatewayRpcTypeMap.ts";
export type { GatewayUiBootConfig } from "./GatewayUiBootConfig.ts";
export type { SmithersGatewayClientOptions } from "./SmithersGatewayClientOptions.ts";

export {
  GATEWAY_EXTENSION_METHOD_PREFIX,
  GATEWAY_EXTENSION_STREAM_METHOD_PREFIX,
  GATEWAY_EXTENSION_STREAM_EVENT,
  GATEWAY_EXTENSION_STREAM_ERROR,
  GATEWAY_EXTENSION_METHOD_NOT_FOUND_CODE,
  GATEWAY_EXTENSION_BACKPRESSURE_DISCONNECT_CODE,
  GATEWAY_EXTENSION_PAYLOAD_TOO_LARGE_CODE,
  extensionMethodName,
  extensionStreamMethodName,
} from "./GatewayExtensionEnvelope.ts";
export type {
  GatewayExtensionStreamErrorFrame,
  GatewayExtensionStreamFrame,
  GatewayExtensionSubscribeResponse,
} from "./GatewayExtensionEnvelope.ts";

// Declarative sync SDK: typed cache keys, vanilla cache + subscription hub, and
// the gateway-backed transport wiring. The React surface lives in
// `@smithers-orchestrator/gateway-react` so the core stays framework-free.
export { SyncCache } from "./sync/SyncCache.ts";
export type { SyncCacheEntry, SyncCacheOptions, SyncCacheStatus } from "./sync/SyncCache.ts";
export { SyncClient } from "./sync/SyncClient.ts";
export type {
  SyncClientOptions,
  SyncFetcher,
  SyncMutationOptions,
  SyncQueryOptions,
} from "./sync/SyncClient.ts";
export { SyncSubscriptionHub } from "./sync/SyncSubscriptionHub.ts";
export type {
  SyncSubscriptionListener,
  SyncSubscriptionOptions,
} from "./sync/SyncSubscriptionHub.ts";
export { syncBackoffDelay } from "./sync/SyncBackoff.ts";
export type { SyncBackoffOptions } from "./sync/SyncBackoff.ts";
export { syncKeyFingerprint, syncKeyMatches } from "./sync/SyncKey.ts";
export type { SyncKey } from "./sync/SyncKey.ts";
export type {
  SyncRpcOptions,
  SyncStreamFrame,
  SyncStreamOptions,
  SyncTransport,
} from "./sync/SyncTransport.ts";
export { gatewayKeys } from "./sync/gatewayKeys.ts";
export {
  createSmithersGatewayTransport,
  type CreateSmithersGatewayTransportOptions,
  type SmithersGatewayStreamScope,
} from "./sync/createSmithersGatewayTransport.ts";
