import { createElement, type ReactNode } from "react";
import type { SyncClient } from "@smithers-orchestrator/gateway-client";
import { SyncContext } from "./SyncContext.ts";

/**
 * Wraps a React subtree with a `SyncClient` so descendants can call
 * `useSyncQuery` / `useSyncMutation` / `useSyncSubscription` against the same
 * cache. apps/smithers mounts a single provider at the root; embedded custom
 * UIs can mount their own per-workflow client when they want isolation.
 */
export function SyncProvider(props: { client: SyncClient; children?: ReactNode }) {
  return createElement(SyncContext.Provider, { value: props.client }, props.children);
}
