import { describe, expect, test } from "bun:test";
import { SyncCache } from "../../src/sync/SyncCache.ts";
import { SyncSubscriptionHub } from "../../src/sync/SyncSubscriptionHub.ts";
import type { SyncStreamFrame, SyncTransport } from "../../src/sync/SyncTransport.ts";

/**
 * Subscription invariants:
 *  - first subscriber opens the upstream; last unsubscribe closes it
 *  - lastSeq is persisted across reconnect so resume happens at afterSeq+1
 *  - a transient drop (thrown error) triggers reconnect with backoff; a graceful
 *    iterable end is treated as terminal so resilient transports don't loop
 *  - opt-in `reconnectOnGracefulEnd` covers raw transports that can't tell a
 *    1006 socket drop from a clean end
 *  - an UNAUTHORIZED upstream short-circuits the reconnect loop and surfaces
 *    via onAuthError
 *  - large bursts past the per-listener ring drop the OLDEST frames (the
 *    backpressure default — we keep the freshest state since that's what UIs
 *    show)
 */

/**
 * A controllable streaming transport. Each call to `stream` produces an async
 * iterable that pulls frames the test pushes via `push()` until the test
 * either ends it gracefully (`end()`) or aborts via the supplied signal.
 */
function controllableTransport() {
  const opens: Array<{
    scope: string;
    params: unknown;
    afterSeq: number | undefined;
    push: (frame: SyncStreamFrame) => void;
    end: () => void;
    fail: (cause: Error) => void;
    signal: AbortSignal | undefined;
  }> = [];
  const transport: SyncTransport = {
    rpc() {
      return Promise.reject(new Error("not used"));
    },
    stream(scope, params, options) {
      const queue: SyncStreamFrame[] = [];
      const waiters: Array<() => void> = [];
      let ended = false;
      let failure: Error | undefined;
      const open = {
        scope,
        params,
        afterSeq: options.afterSeq,
        push: (frame: SyncStreamFrame) => {
          queue.push(frame);
          for (const waiter of waiters.splice(0)) waiter();
        },
        end: () => {
          ended = true;
          for (const waiter of waiters.splice(0)) waiter();
        },
        fail: (cause: Error) => {
          failure = cause;
          for (const waiter of waiters.splice(0)) waiter();
        },
        signal: options.signal,
      };
      opens.push(open);
      const iterable: AsyncIterable<SyncStreamFrame> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              while (true) {
                if (open.signal?.aborted) return { done: true, value: undefined } as IteratorResult<SyncStreamFrame>;
                if (failure) {
                  const cause = failure;
                  failure = undefined;
                  throw cause;
                }
                if (queue.length > 0) {
                  return { done: false, value: queue.shift()! };
                }
                if (ended) return { done: true, value: undefined } as IteratorResult<SyncStreamFrame>;
                await new Promise<void>((res) => waiters.push(res));
              }
            },
          };
        },
      };
      return iterable;
    },
  };
  return { transport, opens };
}

describe("SyncSubscriptionHub.subscribe refcount", () => {
  test("first subscribe opens stream, last unsubscribe closes it", async () => {
    const { transport, opens } = controllableTransport();
    const cache = new SyncCache();
    const hub = new SyncSubscriptionHub(cache, transport, { sleep: () => Promise.resolve() });
    const a = hub.subscribe(["run", "r1"], "streamRunEvents", { runId: "r1" }, () => {});
    const b = hub.subscribe(["run", "r1"], "streamRunEvents", { runId: "r1" }, () => {});
    await Promise.resolve();
    expect(opens.length).toBe(1);
    expect(hub.observerCount(["run", "r1"])).toBe(2);
    a();
    expect(hub.observerCount(["run", "r1"])).toBe(1);
    expect(hub.isOpen(["run", "r1"])).toBe(true);
    b();
    expect(hub.observerCount(["run", "r1"])).toBe(0);
    expect(hub.isOpen(["run", "r1"])).toBe(false);
  });

  test("same key with different params opens independent streams", async () => {
    const { transport, opens } = controllableTransport();
    const cache = new SyncCache();
    const hub = new SyncSubscriptionHub(cache, transport, { sleep: () => Promise.resolve() });
    const a = hub.subscribe(["run", "events"], "streamRunEvents", { runId: "r1" }, () => {});
    const b = hub.subscribe(["run", "events"], "streamRunEvents", { runId: "r2" }, () => {});
    await Promise.resolve();
    expect(opens.length).toBe(2);
    expect(opens[0]!.params).toEqual({ runId: "r1" });
    expect(opens[1]!.params).toEqual({ runId: "r2" });
    expect(hub.observerCount(["run", "events"])).toBe(2);

    opens[0]!.push({ key: ["run", "events"], seq: 10, event: "run.event", payload: { runId: "r1" } });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    opens[0]!.fail(new Error("ECONNRESET"));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(opens.length).toBe(3);
    expect(opens[2]!.params).toEqual({ runId: "r1" });
    expect(opens[2]!.afterSeq).toBe(10);
    expect(opens[1]!.afterSeq).toBeUndefined();

    a();
    expect(opens[0]!.signal?.aborted).toBe(true);
    expect(opens[1]!.signal?.aborted).toBe(false);
    expect(hub.observerCount(["run", "events"])).toBe(1);

    b();
    expect(opens[1]!.signal?.aborted).toBe(true);
    expect(hub.observerCount(["run", "events"])).toBe(0);
  });
});

describe("SyncSubscriptionHub reconnect on transient drop", () => {
  test("reconnect after a thrown error uses afterSeq = lastSeq seen", async () => {
    const { transport, opens } = controllableTransport();
    const cache = new SyncCache();
    const hub = new SyncSubscriptionHub(cache, transport, { sleep: () => Promise.resolve() });
    const received: SyncStreamFrame[] = [];
    const off = hub.subscribe(["run", "r1"], "streamRunEvents", { runId: "r1" }, (f) => received.push(f));
    await Promise.resolve();
    opens[0]!.push({ key: ["run", "r1"], seq: 1, event: "run.event", payload: { v: 1 } });
    opens[0]!.push({ key: ["run", "r1"], seq: 2, event: "run.event", payload: { v: 2 } });
    // Let frames drain through the async iteration.
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    // Simulate a transient drop (the gateway socket errored — not a clean end).
    opens[0]!.fail(new Error("ECONNRESET"));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(opens.length).toBe(2);
    expect(opens[1]!.afterSeq).toBe(2);
    expect(received.map((f) => f.seq)).toEqual([1, 2]);
    off();
  });

  test("graceful iterable end is terminal — no reconnect, channel removed", async () => {
    const { transport, opens } = controllableTransport();
    const cache = new SyncCache();
    const hub = new SyncSubscriptionHub(cache, transport, { sleep: () => Promise.resolve() });
    hub.subscribe(["run", "r1"], "streamRunEvents", { runId: "r1" }, () => {});
    await Promise.resolve();
    opens[0]!.end();
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(opens.length).toBe(1);
    expect(hub.isOpen(["run", "r1"])).toBe(false);
  });

  test("opt-in reconnectOnGracefulEnd reopens after a clean end and resumes from lastSeq", async () => {
    const { transport, opens } = controllableTransport();
    const cache = new SyncCache();
    const hub = new SyncSubscriptionHub(cache, transport, {
      sleep: () => Promise.resolve(),
      reconnectOnGracefulEnd: true,
    });
    const received: SyncStreamFrame[] = [];
    const off = hub.subscribe(["run", "r1"], "streamRunEvents", { runId: "r1" }, (f) => received.push(f));
    await Promise.resolve();
    opens[0]!.push({ key: ["run", "r1"], seq: 7, event: "run.event", payload: {} });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    opens[0]!.end();
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(opens.length).toBe(2);
    expect(opens[1]!.afterSeq).toBe(7);
    off();
  });
});

describe("SyncSubscriptionHub auth bail-out", () => {
  test("UNAUTHORIZED transport error fires onAuthError and stops reconnect loop", async () => {
    const { transport, opens } = controllableTransport();
    const cache = new SyncCache();
    let authError: Error | undefined;
    const hub = new SyncSubscriptionHub(cache, transport, {
      sleep: () => Promise.resolve(),
      onAuthError: (error) => { authError = error; },
    });
    hub.subscribe(["run", "r1"], "streamRunEvents", { runId: "r1" }, () => {});
    await Promise.resolve();
    opens[0]!.fail(new Error("UNAUTHORIZED: token expired"));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(authError?.message).toMatch(/UNAUTHORIZED/);
    expect(hub.isOpen(["run", "r1"])).toBe(false);
    // No additional reconnect attempts were made.
    expect(opens.length).toBe(1);
  });
});

describe("SyncSubscriptionHub backpressure", () => {
  test("a slow listener that throws stashes frames on its ring up to bufferMax", async () => {
    const { transport, opens } = controllableTransport();
    const cache = new SyncCache();
    const hub = new SyncSubscriptionHub(cache, transport, {
      sleep: () => Promise.resolve(),
      bufferMax: 4,
    });
    const listener = () => { throw new Error("slow"); };
    const off = hub.subscribe(["run", "r1"], "streamRunEvents", { runId: "r1" }, listener);
    await Promise.resolve();
    for (let i = 1; i <= 10; i += 1) {
      opens[0]!.push({ key: ["run", "r1"], seq: i, event: "run.event", payload: { i } });
    }
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(hub.droppedFor(["run", "r1"], listener)).toBeGreaterThan(0);
    off();
  });

  test("a healthy listener under bursty load sees every frame in order", async () => {
    const { transport, opens } = controllableTransport();
    const cache = new SyncCache();
    const hub = new SyncSubscriptionHub(cache, transport, { sleep: () => Promise.resolve() });
    const seen: number[] = [];
    const off = hub.subscribe(["run", "r1"], "streamRunEvents", { runId: "r1" }, (f) => {
      seen.push(f.seq ?? -1);
    });
    await Promise.resolve();
    const burst = 500;
    for (let i = 1; i <= burst; i += 1) {
      opens[0]!.push({ key: ["run", "r1"], seq: i, event: "run.event", payload: { i } });
    }
    // Each iterator tick drains exactly one frame, so we yield the microtask
    // queue until every push has been observed (capped at 5k iterations as a
    // safety net so a regression doesn't spin the test forever).
    for (let i = 0; seen.length < burst && i < 5_000; i += 1) await Promise.resolve();
    expect(seen.length).toBe(burst);
    expect(seen[0]).toBe(1);
    expect(seen[burst - 1]).toBe(burst);
    off();
  });
});

describe("SyncSubscriptionHub unsubscribe cleanup", () => {
  test("unsubscribe aborts the upstream signal", async () => {
    const { transport, opens } = controllableTransport();
    const cache = new SyncCache();
    const hub = new SyncSubscriptionHub(cache, transport, { sleep: () => Promise.resolve() });
    const off = hub.subscribe(["run", "r1"], "streamRunEvents", { runId: "r1" }, () => {});
    await Promise.resolve();
    expect(opens[0]!.signal?.aborted).toBe(false);
    off();
    expect(opens[0]!.signal?.aborted).toBe(true);
  });
});
