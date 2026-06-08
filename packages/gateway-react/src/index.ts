export { createGatewayReactRoot } from "./createGatewayReactRoot.ts";
export { SmithersGatewayContext } from "./SmithersGatewayContext.ts";
export { SmithersGatewayProvider } from "./SmithersGatewayProvider.ts";
export { useGatewayActions } from "./useGatewayActions.ts";
export { useGatewayApprovals } from "./useGatewayApprovals.ts";
export { useGatewayNodeOutput } from "./useGatewayNodeOutput.ts";
export { useGatewayRpc } from "./useGatewayRpc.ts";
export { useGatewayRun } from "./useGatewayRun.ts";
export { useGatewayRunEvents } from "./useGatewayRunEvents.ts";
export { useGatewayRuns } from "./useGatewayRuns.ts";
export { useGatewayWorkflows } from "./useGatewayWorkflows.ts";
export { useSmithersGateway } from "./useSmithersGateway.ts";
export { useGatewayExtensionResource } from "./useGatewayExtensionResource.ts";
export { useGatewayExtensionAction } from "./useGatewayExtensionAction.ts";
export { useGatewayExtensionStream, type GatewayExtensionStreamState } from "./useGatewayExtensionStream.ts";
export type { GatewayAsyncState } from "./GatewayAsyncState.ts";

// Declarative sync SDK React surface. The vanilla core lives in
// `@smithers-orchestrator/gateway-client`; this layer adds the React context,
// provider, and hooks (`useSyncQuery` / `useSyncMutation` / `useSyncSubscription`
// + typed gateway shortcuts) backed by `useSyncExternalStore`.
export { SyncContext } from "./sync/SyncContext.ts";
export { SyncProvider } from "./sync/SyncProvider.ts";
export { useSyncClient } from "./sync/useSyncClient.ts";
export { useSyncQuery } from "./sync/useSyncQuery.ts";
export type { UseSyncQueryOptions, UseSyncQueryResult } from "./sync/useSyncQuery.ts";
export { useSyncMutation } from "./sync/useSyncMutation.ts";
export type {
  UseSyncMutationResult,
  UseSyncMutationStatus,
} from "./sync/useSyncMutation.ts";
export { useSyncSubscription } from "./sync/useSyncSubscription.ts";
export type {
  UseSyncSubscriptionOptions,
  UseSyncSubscriptionResult,
} from "./sync/useSyncSubscription.ts";
export { useGatewayQuery } from "./sync/useGatewayQuery.ts";
export { useGatewayMutation } from "./sync/useGatewayMutation.ts";
export { useGatewayRunStream } from "./sync/useGatewayRunStream.ts";
