import { useContext } from "react";
import type { SyncClient } from "@smithers-orchestrator/gateway-client";
import { SyncContext } from "./SyncContext.ts";

/**
 * The hook every other SDK hook calls. Throws an explicit error when used
 * outside `<SyncProvider>` — a silent fallback would hide a wiring bug behind
 * confusing "data is undefined" symptoms.
 */
export function useSyncClient(): SyncClient {
  const client = useContext(SyncContext);
  if (!client) {
    throw new Error("useSyncClient: missing <SyncProvider>. Wrap your tree in a SyncProvider.");
  }
  return client;
}
