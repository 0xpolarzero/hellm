// Drives the real sync hooks through React's real reconciler under a real DOM
// (happy-dom) so that useSyncExternalStore actually re-renders. The cache and
// transport are the real ones; the transport's request/stream handlers are the
// only seam — they return real promises and real async iterables.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// happy-dom errors if registered twice across test files in the same bun run;
// guard so this file composes with `gatewayReactBehavior.test.ts`.
if (typeof globalThis.document === "undefined") {
  GlobalRegistrator.register();
}

import { describe, expect, test } from "bun:test";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  SyncClient,
  type SyncStreamFrame,
  type SyncStreamOptions,
  type SyncTransport,
} from "@smithers-orchestrator/gateway-client";
import {
  SyncProvider,
  useGatewayQuery,
  useSyncMutation,
  useSyncQuery,
  useSyncSubscription,
  type UseSyncSubscriptionResult,
} from "../../src/index.ts";

// React's act() needs this flag to flush updates synchronously and silence
// warnings under bun + happy-dom.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Harness = {
  render: (element: ReactElement) => Promise<void>;
  unmount: () => Promise<void>;
};

async function mountHarness(): Promise<Harness> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
  });
  return {
    render: async (element) => {
      await act(async () => {
        root.render(element);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function rpcTransport(handlers: Record<string, (params: unknown) => unknown>): SyncTransport {
  return {
    rpc(method, params) {
      const handler = handlers[method];
      if (!handler) return Promise.reject(new Error(`unknown ${method}`));
      try {
        return Promise.resolve(handler(params));
      } catch (cause) {
        return Promise.reject(cause);
      }
    },
  };
}

describe("useSyncQuery lifecycle", () => {
  test("re-renders from loading to success when the fetcher resolves", async () => {
    let resolveFetch: (v: number) => void = () => {};
    const transport: SyncTransport = {
      rpc() {
        return new Promise<number>((resolve) => {
          resolveFetch = resolve;
        });
      },
    };
    const client = new SyncClient({ transport });

    const seen: Array<{ status: string; data: number | undefined }> = [];
    function Probe() {
      const q = useSyncQuery<number>(["counter"], () => client.rpc<number>("get", {}));
      seen.push({ status: q.status, data: q.data });
      return null;
    }

    const harness = await mountHarness();
    await harness.render(createElement(SyncProvider, { client }, createElement(Probe)));
    // First commit should be loading with no data.
    expect(seen[seen.length - 1]).toEqual({ status: "loading", data: undefined });

    await act(async () => {
      resolveFetch(42);
      await flush();
    });
    expect(seen[seen.length - 1]).toEqual({ status: "success", data: 42 });

    await harness.unmount();
  });

  test("refetch advances the entry's version and re-renders with the fresh value", async () => {
    let count = 0;
    const transport: SyncTransport = {
      rpc() {
        return Promise.resolve(++count);
      },
    };
    const client = new SyncClient({ transport });

    let lastRefetch: (() => Promise<unknown>) | undefined;
    const renders: number[] = [];
    function Probe() {
      const q = useSyncQuery<number>(["counter"], () => client.rpc<number>("get", {}));
      lastRefetch = q.refetch;
      if (typeof q.data === "number") renders.push(q.data);
      return null;
    }

    const harness = await mountHarness();
    await harness.render(createElement(SyncProvider, { client }, createElement(Probe)));
    await flush();
    expect(renders[renders.length - 1]).toBe(1);

    await act(async () => {
      await lastRefetch?.();
      await flush();
    });
    expect(renders[renders.length - 1]).toBe(2);

    await harness.unmount();
  });

  test("client.invalidate re-renders subscribers with the freshly fetched value", async () => {
    let value = 10;
    const transport: SyncTransport = {
      rpc() {
        return Promise.resolve(value);
      },
    };
    const client = new SyncClient({ transport });

    const observed: number[] = [];
    function Probe() {
      const q = useSyncQuery<number>(["x"], () => client.rpc<number>("get", {}));
      if (typeof q.data === "number") observed.push(q.data);
      return null;
    }

    const harness = await mountHarness();
    await harness.render(createElement(SyncProvider, { client }, createElement(Probe)));
    await flush();
    expect(observed[observed.length - 1]).toBe(10);

    value = 20;
    await act(async () => {
      await client.invalidate(["x"]);
      await flush();
    });
    expect(observed[observed.length - 1]).toBe(20);

    await harness.unmount();
  });

  test("a direct cache.setData (live data push) re-renders subscribers", async () => {
    const client = new SyncClient({ transport: rpcTransport({ get: () => 1 }) });

    const observed: number[] = [];
    function Probe() {
      const q = useSyncQuery<number>(["x"], () => client.rpc<number>("get", {}));
      if (typeof q.data === "number") observed.push(q.data);
      return null;
    }

    const harness = await mountHarness();
    await harness.render(createElement(SyncProvider, { client }, createElement(Probe)));
    await flush();
    expect(observed[observed.length - 1]).toBe(1);

    await act(async () => {
      client.cache.setData(["x"], 99);
      await flush();
    });
    expect(observed[observed.length - 1]).toBe(99);

    await harness.unmount();
  });
});

describe("useGatewayQuery params", () => {
  test("params changes do not reuse stale data when the caller key is stable", async () => {
    const calls: unknown[] = [];
    const transport = rpcTransport({
      getThing: (params) => {
        calls.push(params);
        return { id: (params as { id: string }).id, call: calls.length };
      },
    });
    const client = new SyncClient({ transport });

    let latest:
      | { status: string; data: { id: string; call: number } | undefined }
      | undefined;

    function Probe({ id }: { id: string }) {
      const q = useGatewayQuery<{ id: string; call: number }>(
        ["gateway:getThing"],
        "getThing",
        { id },
      );
      latest = { status: q.status, data: q.data };
      return null;
    }

    const harness = await mountHarness();
    await harness.render(createElement(SyncProvider, { client }, createElement(Probe, { id: "a" })));
    await flush();
    expect(latest?.data).toEqual({ id: "a", call: 1 });

    await harness.render(createElement(SyncProvider, { client }, createElement(Probe, { id: "b" })));
    expect(latest?.data?.id).not.toBe("a");
    await flush();
    expect(latest?.data).toEqual({ id: "b", call: 2 });
    expect(calls).toEqual([{ id: "a" }, { id: "b" }]);

    await harness.unmount();
  });
});

describe("useSyncMutation optimistic + rollback", () => {
  test("rolls back optimistic data when the runner rejects", async () => {
    const transport = rpcTransport({
      readCounter: () => 5,
      bump: () => {
        throw new Error("bump failed");
      },
    });
    const client = new SyncClient({ transport });

    const seen: Array<{ data: number | undefined; status: string }> = [];
    let mutate: (vars: number) => Promise<number> = async () => 0;

    function Probe() {
      const q = useSyncQuery<number>(["counter"], () => client.rpc<number>("readCounter", {}));
      const m = useSyncMutation<number, number, number | undefined>(
        (next: number) => client.rpc<number>("bump", { next }),
        {
          onMutate: (next, c) => {
            const { previous } = c.cache.setData<number>(["counter"], next);
            return previous;
          },
          onError: (_err, _vars, previous, c) => {
            if (typeof previous === "number") {
              c.cache.setData(["counter"], previous);
            }
          },
        },
      );
      mutate = m.mutate;
      seen.push({ data: q.data, status: q.status });
      return null;
    }

    const harness = await mountHarness();
    await harness.render(createElement(SyncProvider, { client }, createElement(Probe)));
    await flush();
    expect(seen[seen.length - 1].data).toBe(5);

    await act(async () => {
      await mutate(99).catch(() => undefined);
      await flush();
    });
    // After rollback the cached value is the original 5 again.
    expect(seen[seen.length - 1].data).toBe(5);

    await harness.unmount();
  });
});

describe("useSyncSubscription frames + backpressure", () => {
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve: (v: T) => void = () => {};
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  function streamingTransport() {
    const queue: SyncStreamFrame[] = [];
    const opens: Array<{ scope: string; params: unknown; signal: AbortSignal | undefined }> = [];
    let waiter: { resolve: (v: void) => void } | null = null;
    let ended = false;
    function notify() {
      const pending = waiter;
      waiter = null;
      pending?.resolve();
    }
    const transport: SyncTransport = {
      rpc() {
        return Promise.reject(new Error("not used"));
      },
      async *stream(scope, params, options: SyncStreamOptions): AsyncIterable<SyncStreamFrame> {
        opens.push({ scope, params, signal: options.signal });
        while (true) {
          if (options.signal?.aborted) return;
          if (queue.length > 0) {
            yield queue.shift()!;
            continue;
          }
          if (ended) return;
          const d = deferred<void>();
          waiter = { resolve: d.resolve };
          await d.promise;
        }
      },
    };
    return {
      transport,
      opens,
      push(frame: SyncStreamFrame) {
        queue.push(frame);
        notify();
      },
      end() {
        ended = true;
        notify();
      },
    };
  }

  test("frames pushed by the transport appear in the consumer's bounded buffer", async () => {
    const stream = streamingTransport();
    const client = new SyncClient({ transport: stream.transport });

    let last: SyncStreamFrame | undefined;
    function Probe() {
      const r = useSyncSubscription(["run", "r1"], "streamRunEvents", { runId: "r1" }, { maxFrames: 3 });
      last = r.last;
      return null;
    }

    const harness = await mountHarness();
    await harness.render(createElement(SyncProvider, { client }, createElement(Probe)));
    await flush();

    await act(async () => {
      stream.push({ key: ["run", "r1"], seq: 1, event: "run.event", payload: { v: 1 } });
      await flush();
    });
    expect(last?.seq).toBe(1);

    await act(async () => {
      stream.push({ key: ["run", "r1"], seq: 2, event: "run.event", payload: { v: 2 } });
      stream.push({ key: ["run", "r1"], seq: 3, event: "run.event", payload: { v: 3 } });
      await flush();
    });
    expect(last?.seq).toBe(3);

    await harness.unmount();
  });

  test("frames past maxFrames push older ones out (consumer-side backpressure)", async () => {
    const stream = streamingTransport();
    const client = new SyncClient({ transport: stream.transport });

    let result:
      | { frames: ReadonlyArray<SyncStreamFrame>; dropped: number }
      | undefined;
    function Probe() {
      result = useSyncSubscription(["run", "r1"], "streamRunEvents", { runId: "r1" }, { maxFrames: 3 });
      return null;
    }

    const harness = await mountHarness();
    await harness.render(createElement(SyncProvider, { client }, createElement(Probe)));
    await flush();

    await act(async () => {
      for (let seq = 1; seq <= 6; seq += 1) {
        stream.push({ key: ["run", "r1"], seq, event: "run.event", payload: { seq } });
      }
      await flush();
    });

    expect(result?.frames.length).toBe(3);
    expect(result?.frames.map((f) => f.seq)).toEqual([4, 5, 6]);
    expect(result?.dropped).toBeGreaterThanOrEqual(3);

    await harness.unmount();
  });

  test("params changes tear down the old stream and open a new one", async () => {
    const stream = streamingTransport();
    const client = new SyncClient({ transport: stream.transport });

    let result: UseSyncSubscriptionResult | undefined;
    function Probe({ runId }: { runId: string }) {
      result = useSyncSubscription(["run", "events"], "streamRunEvents", { runId }, { maxFrames: 3 });
      return null;
    }

    const harness = await mountHarness();
    await harness.render(createElement(SyncProvider, { client }, createElement(Probe, { runId: "r1" })));
    await flush();
    expect(stream.opens).toHaveLength(1);
    expect(stream.opens[0]!.params).toEqual({ runId: "r1" });
    expect(stream.opens[0]!.signal?.aborted).toBe(false);

    await act(async () => {
      stream.push({ key: ["run", "events"], seq: 1, event: "run.event", payload: { runId: "r1" } });
      await flush();
    });
    expect(result?.last?.payload).toEqual({ runId: "r1" });

    await harness.render(createElement(SyncProvider, { client }, createElement(Probe, { runId: "r2" })));
    expect(result?.frames).toEqual([]);
    expect(result?.last).toBeUndefined();
    await flush();
    expect(stream.opens).toHaveLength(2);
    expect(stream.opens[0]!.signal?.aborted).toBe(true);
    expect(stream.opens[1]!.params).toEqual({ runId: "r2" });

    await harness.unmount();
  });
});
