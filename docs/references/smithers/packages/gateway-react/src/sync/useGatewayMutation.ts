import { useMemo } from "react";
import type { SyncMutationOptions } from "@smithers-orchestrator/gateway-client";
import { useSyncClient } from "./useSyncClient.ts";
import { useSyncMutation, type UseSyncMutationResult } from "./useSyncMutation.ts";

/**
 * A typed mutation hook for known gateway RPCs. Caller passes the method name
 * (`launchRun`, `submitApproval`, …) and the SDK does the rest, including
 * optimistic cache writes, rollback, and invalidate-on-success.
 */
export function useGatewayMutation<TVars extends Record<string, unknown>, TData = unknown>(
  method: string,
  options: SyncMutationOptions<TVars, TData> = {},
): UseSyncMutationResult<TVars, TData> {
  const client = useSyncClient();
  const runner = useMemo(
    () => (vars: TVars) => client.rpc<TData>(method, vars),
    [client, method],
  );
  return useSyncMutation<TVars, TData>(runner, options);
}
