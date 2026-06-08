import { useMemo } from "react";
import { gatewayKeys } from "@smithers-orchestrator/gateway-client";
import { useSyncSubscription, type UseSyncSubscriptionResult } from "./useSyncSubscription.ts";

/**
 * Subscribe to a run's event stream. Delegates to the shared subscription hub
 * so N components watching the same run share one connection, and lastSeq is
 * persisted across reconnect via the cache. Pass `enabled=false` (or
 * `runId=undefined`) to skip the subscription entirely.
 */
export function useGatewayRunStream(
  runId: string | undefined,
  options: { maxFrames?: number } = {},
): UseSyncSubscriptionResult {
  const key = useMemo(
    () => (runId ? gatewayKeys.runEvents(runId) : (["gateway:streamRunEvents:idle"] as const)),
    [runId],
  );
  return useSyncSubscription(
    key,
    "streamRunEvents",
    runId ? { runId } : {},
    { enabled: Boolean(runId), maxFrames: options.maxFrames },
  );
}
