import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { syncKeyFingerprint, type SyncKey } from "@smithers-orchestrator/gateway-client";
import { useSyncClient } from "./useSyncClient.ts";

/**
 * Declarative data fetching for the sync cache. Backed by `useSyncExternalStore`
 * so React subscribes / unsubscribes through React's own concurrent-mode
 * machinery — no `useEffect`, no manual cleanup, no tearing across transitions.
 *
 * Behavior:
 *  - On mount the hook subscribes (refcounting the cache entry) and triggers
 *    a fetch when the entry is stale.
 *  - Concurrent components with the same key share one in-flight request.
 *  - `refetch()` forces a refetch ignoring stale time.
 *  - Unmount drops the refcount; the cache entry GCs after `cacheTimeMs`.
 *
 * Snapshot freshness: the cache mutates entries in place, so returning the
 * entry reference from `getSnapshot` would cause `useSyncExternalStore` to
 * `Object.is`-bail and miss updates. We track the entry's monotonic `version`
 * and rebuild a stable result object whenever the version advances, which is
 * what makes loading→success, refetch, invalidate, and data updates all
 * actually re-render the consumer.
 */

export type UseSyncQueryResult<T> = {
  data: T | undefined;
  error: Error | undefined;
  status: "idle" | "loading" | "success" | "error";
  /** True when no data yet and a fetch is in flight. */
  isLoading: boolean;
  /** True when data exists and a refetch is in flight. */
  isRefreshing: boolean;
  refetch: () => Promise<T | undefined>;
};

export type UseSyncQueryOptions = {
  /** Disable the query (skip subscribe + fetch). Used for conditional loads. */
  enabled?: boolean;
  /** Treat cached data as fresh for this long. Default 0. */
  staleTimeMs?: number;
};

function emptyResult<T>(enabled: boolean, refetch: () => Promise<T | undefined>): UseSyncQueryResult<T> {
  return {
    data: undefined,
    error: undefined,
    status: enabled ? "loading" : "idle",
    isLoading: enabled,
    isRefreshing: false,
    refetch,
  };
}

export function useSyncQuery<T>(
  key: SyncKey,
  fetcher: () => Promise<T>,
  options: UseSyncQueryOptions = {},
): UseSyncQueryResult<T> {
  const client = useSyncClient();
  const enabled = options.enabled ?? true;
  const staleTimeMs = options.staleTimeMs ?? 0;
  const fingerprint = useMemo(() => syncKeyFingerprint(key), [key]);
  // Pin the latest fetcher / key in refs so the subscribe callback stays
  // referentially stable; otherwise every render would re-subscribe.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef<SyncKey>(key);
  keyRef.current = key;

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!enabled) return () => {};
      const unsubscribe = client.cache.subscribe<T>(keyRef.current, () => notify());
      // Trigger an initial fetch if stale; the cache handles dedupe.
      void client
        .query(keyRef.current, fetcherRef.current, { staleTimeMs })
        .catch(() => undefined);
      return unsubscribe;
    },
    [client, enabled, staleTimeMs, fingerprint],
  );

  const refetch = useCallback(async () => {
    return client.query(keyRef.current, fetcherRef.current, { staleTimeMs: 0 }).catch(() => undefined);
  }, [client]);

  // Cached snapshot keyed by the entry's monotonic version. `getSnapshot` must
  // return a referentially-stable value when nothing changed (React calls it
  // many times per commit) but a new value when the cache mutated, so we
  // compare versions and only re-derive on change.
  const snapshotRef = useRef<{
    version: number;
    fingerprint: string;
    enabled: boolean;
    value: UseSyncQueryResult<T>;
  } | null>(null);

  const getSnapshot = useCallback((): UseSyncQueryResult<T> => {
    const entry = client.cache.peek<T>(keyRef.current);
    const version = entry?.version ?? -1;
    const cached = snapshotRef.current;
    if (
      cached &&
      cached.fingerprint === fingerprint &&
      cached.enabled === enabled &&
      cached.version === version &&
      cached.value.refetch === refetch
    ) {
      return cached.value;
    }
    const value: UseSyncQueryResult<T> = entry
      ? {
          data: entry.data,
          error: entry.error,
          status: entry.status,
          isLoading: entry.status === "loading" && entry.data === undefined,
          isRefreshing: entry.status === "loading" && entry.data !== undefined,
          refetch,
        }
      : emptyResult<T>(enabled, refetch);
    snapshotRef.current = { version, fingerprint, enabled, value };
    return value;
  }, [client, fingerprint, enabled, refetch]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
