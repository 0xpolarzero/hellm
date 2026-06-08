import { useCallback, useRef, useSyncExternalStore } from "react";
import type { SyncMutationOptions } from "@smithers-orchestrator/gateway-client";
import { useSyncClient } from "./useSyncClient.ts";

/**
 * A mutation hook with optimistic updates + invalidate-on-success. Mirrors the
 * SDK's `client.mutate` but exposes status (`idle | loading | success | error`)
 * so consumers can disable buttons mid-flight without juggling local state.
 *
 * Status is tracked in a tiny vanilla observer (not React state) so the hook
 * stays useEffect-free and re-renders are driven by `useSyncExternalStore`.
 */

export type UseSyncMutationStatus = "idle" | "loading" | "success" | "error";

export type UseSyncMutationResult<TVars, TData> = {
  mutate: (vars: TVars) => Promise<TData>;
  /** Like `mutate` but swallows errors and returns undefined on failure. */
  mutateSafe: (vars: TVars) => Promise<TData | undefined>;
  status: UseSyncMutationStatus;
  isLoading: boolean;
  data: TData | undefined;
  error: Error | undefined;
  reset: () => void;
};

type State<TData> = {
  status: UseSyncMutationStatus;
  data: TData | undefined;
  error: Error | undefined;
};

function createMutationStore<TData>() {
  let state: State<TData> = { status: "idle", data: undefined, error: undefined };
  const listeners = new Set<() => void>();
  return {
    get(): State<TData> {
      return state;
    },
    set(next: State<TData>): void {
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useSyncMutation<TVars, TData, TContext = unknown>(
  runner: (vars: TVars) => Promise<TData>,
  options: SyncMutationOptions<TVars, TData, TContext> = {},
): UseSyncMutationResult<TVars, TData> {
  const client = useSyncClient();
  const runnerRef = useRef(runner);
  runnerRef.current = runner;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const storeRef = useRef<ReturnType<typeof createMutationStore<TData>> | null>(null);
  if (!storeRef.current) storeRef.current = createMutationStore<TData>();
  const store = storeRef.current;

  const state = useSyncExternalStore(store.subscribe, store.get, store.get);

  const mutate = useCallback(
    async (vars: TVars) => {
      store.set({ status: "loading", data: undefined, error: undefined });
      try {
        const data = await client.mutate<TVars, TData, TContext>(
          runnerRef.current,
          vars,
          optionsRef.current,
        );
        store.set({ status: "success", data, error: undefined });
        return data;
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        store.set({ status: "error", data: undefined, error });
        throw error;
      }
    },
    [client, store],
  );

  const mutateSafe = useCallback(
    async (vars: TVars) => {
      try {
        return await mutate(vars);
      } catch {
        return undefined;
      }
    },
    [mutate],
  );

  const reset = useCallback(() => {
    store.set({ status: "idle", data: undefined, error: undefined });
  }, [store]);

  return {
    mutate,
    mutateSafe,
    status: state.status,
    isLoading: state.status === "loading",
    data: state.data,
    error: state.error,
    reset,
  };
}
