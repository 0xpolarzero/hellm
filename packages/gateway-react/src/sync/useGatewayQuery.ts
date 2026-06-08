import { useMemo } from "react";
import { syncKeyFingerprint, type SyncKey } from "@smithers-orchestrator/gateway-client";
import { useSyncClient } from "./useSyncClient.ts";
import { useSyncQuery, type UseSyncQueryOptions, type UseSyncQueryResult } from "./useSyncQuery.ts";

/**
 * A typed convenience over `useSyncQuery` for known gateway RPCs. Picks the
 * cache key from `gatewayKeys`, wires the fetcher to `client.rpc`, and gives
 * consumers the same `{data, error, status, refetch, isLoading}` shape they
 * already get from `useGatewayRpc` in `packages/gateway-react`.
 */
export function useGatewayQuery<T = unknown>(
  key: SyncKey,
  method: string,
  params: Record<string, unknown>,
  options: UseSyncQueryOptions = {},
): UseSyncQueryResult<T> {
  const client = useSyncClient();
  // Memoize the fetcher so identical calls don't churn the entry's stored
  // fetcher reference (which would defeat `invalidate`'s refetch lookup).
  const paramsKey = syncKeyFingerprint(["params", params ?? {}]);
  const queryKey = useMemo(() => [...key, { params: params ?? {} }] as SyncKey, [key, paramsKey]);
  const fetcher = useMemo(
    () => () => client.rpc<T>(method, params),
    [client, method, paramsKey],
  );
  return useSyncQuery<T>(queryKey, fetcher, options);
}
