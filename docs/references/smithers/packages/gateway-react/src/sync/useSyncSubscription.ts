import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { syncKeyFingerprint, type SyncKey, type SyncStreamFrame } from "@smithers-orchestrator/gateway-client";
import { useSyncClient } from "./useSyncClient.ts";

/**
 * Subscribe to a streaming source (run events, devtools, …) through the
 * `SyncSubscriptionHub`. Returns the rolling buffer of frames + connection
 * stats. Heavy bursts are bounded by `maxFrames`; older frames drop off the
 * front so render time stays predictable on a hot run.
 *
 * The hub deduplicates: N components subscribing to the same key share ONE
 * upstream connection. Disabling (`enabled: false`) unsubscribes and frees the
 * upstream when this was the last observer.
 */

export type UseSyncSubscriptionOptions = {
  enabled?: boolean;
  /** Bounded buffer of recent frames the consumer can render. Default 200. */
  maxFrames?: number;
};

export type UseSyncSubscriptionResult = {
  frames: ReadonlyArray<SyncStreamFrame>;
  last: SyncStreamFrame | undefined;
  /** Frames dropped due to the consumer's bounded buffer (not the hub's). */
  dropped: number;
};

type SnapshotState = {
  frames: SyncStreamFrame[];
  last: SyncStreamFrame | undefined;
  dropped: number;
  version: number;
};

function createSubscriptionStore(maxFrames: number) {
  let state: SnapshotState = { frames: [], last: undefined, dropped: 0, version: 0 };
  const listeners = new Set<() => void>();
  return {
    get(): SnapshotState {
      return state;
    },
    push(frame: SyncStreamFrame): void {
      const overflow = state.frames.length >= maxFrames;
      const frames = overflow
        ? state.frames.slice(state.frames.length - maxFrames + 1)
        : state.frames.slice();
      frames.push(frame);
      state = {
        frames,
        last: frame,
        dropped: state.dropped + (overflow ? 1 : 0),
        version: state.version + 1,
      };
      for (const listener of listeners) listener();
    },
    reset(): void {
      state = { frames: [], last: undefined, dropped: 0, version: state.version + 1 };
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useSyncSubscription(
  key: SyncKey,
  scope: string,
  params: unknown,
  options: UseSyncSubscriptionOptions = {},
): UseSyncSubscriptionResult {
  const client = useSyncClient();
  const enabled = options.enabled ?? true;
  const maxFrames = options.maxFrames ?? 200;
  const paramsFingerprint = syncKeyFingerprint(["params", params]);
  const fingerprint = useMemo(
    () => syncKeyFingerprint(key) + "|" + scope + "|" + paramsFingerprint,
    [key, scope, paramsFingerprint],
  );
  const storeRef = useRef<{
    fingerprint: string;
    maxFrames: number;
    store: ReturnType<typeof createSubscriptionStore>;
  } | null>(null);
  if (
    !storeRef.current ||
    storeRef.current.fingerprint !== fingerprint ||
    storeRef.current.maxFrames !== maxFrames
  ) {
    storeRef.current = { fingerprint, maxFrames, store: createSubscriptionStore(maxFrames) };
  }
  const store = storeRef.current.store;
  const keyRef = useRef<SyncKey>(key);
  keyRef.current = key;
  const paramsRef = useRef<unknown>(params);
  paramsRef.current = params;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const subscribe = useCallback(
    (notify: () => void) => {
      const listenersUnsubscribe = store.subscribe(notify);
      if (!enabled) {
        return () => {
          listenersUnsubscribe();
        };
      }
      store.reset();
      const hubUnsubscribe = client.subscribe(
        keyRef.current,
        scopeRef.current,
        paramsRef.current,
        (frame) => store.push(frame),
      );
      return () => {
        hubUnsubscribe();
        listenersUnsubscribe();
      };
    },
    [client, enabled, fingerprint, store],
  );

  const getSnapshot = useCallback(() => store.get(), [store]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { frames: state.frames, last: state.last, dropped: state.dropped };
}
