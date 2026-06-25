import type * as Effect from "effect/Effect";
import type { StateContractError } from "@svvy/core";

export interface RuntimeStateWriteLane {
  run<A>(effect: Effect.Effect<A, StateContractError>): Promise<A>;
  enqueue<A>(label: string, effect: Effect.Effect<A, StateContractError>): Promise<A>;
  drain(): Promise<void>;
  close(reason?: string): Promise<void>;
}

export function createOrderedRuntimeStateWriteLane(options: {
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => Promise<A>;
  onError?: (event: { label: string; error: unknown }) => void;
}): RuntimeStateWriteLane {
  let tail: Promise<void> = Promise.resolve();
  let closed = false;

  const enqueue = <A>(label: string, effect: Effect.Effect<A, StateContractError>): Promise<A> => {
    if (closed) {
      return Promise.reject(new Error(`Runtime state write lane is closed: ${label}`));
    }

    const task = tail.then(
      () => options.runState(effect),
      () => options.runState(effect),
    );
    const observed = task.catch((error: unknown) => {
      options.onError?.({ label, error });
      throw error;
    });
    tail = observed.then(
      () => undefined,
      () => undefined,
    );
    return observed;
  };

  return {
    run(effect) {
      return enqueue("runtime-state.write", effect);
    },
    enqueue,
    async drain() {
      await tail;
    },
    async close(reason) {
      void reason;
      closed = true;
      await tail;
    },
  };
}
