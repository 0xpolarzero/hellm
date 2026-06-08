import { describe, expect, test } from "bun:test";
import { SyncCache } from "../../src/sync/SyncCache.ts";

/**
 * Cache invariants the rest of the SDK leans on:
 *  - dedupe of concurrent fetches
 *  - stale-data guard via the per-key generation counter
 *  - ref-counted GC (entry survives transient unmount, GCs after cacheTime)
 *  - invalidate() refetches active subscribers but leaves cold entries alone
 *  - last-seq is monotonic-up-only so reconnect never rewinds
 *  - version bumps on every notify so React snapshots can detect changes
 */

type TestTimer = { id: number; fn: () => void; ms: number; cancelled: boolean };

function fakeTimers() {
  let nextId = 1;
  const timers: TestTimer[] = [];
  return {
    setTimer(fn: () => void, ms: number): unknown {
      const timer: TestTimer = { id: nextId++, fn, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(handle: unknown): void {
      (handle as TestTimer).cancelled = true;
    },
    advance(): void {
      const pending = timers.splice(0).filter((timer) => !timer.cancelled);
      for (const timer of pending) timer.fn();
    },
    pending(): TestTimer[] {
      return timers.filter((timer) => !timer.cancelled);
    },
  };
}

describe("SyncCache.fetch dedupe + stale guard", () => {
  test("dedupes concurrent fetchers", async () => {
    const cache = new SyncCache();
    let fetches = 0;
    const fetcher = async () => {
      fetches += 1;
      await Promise.resolve();
      return { hello: fetches };
    };
    const [a, b] = await Promise.all([
      cache.fetch(["k"], fetcher),
      cache.fetch(["k"], fetcher),
    ]);
    expect(fetches).toBe(1);
    expect(a).toBe(b);
  });

  test("a stale fetch that resolves after remove() does not repopulate the cache", async () => {
    const cache = new SyncCache();
    let resolveFirst: (value: number) => void = () => {};
    const slow = new Promise<number>((resolve) => {
      resolveFirst = resolve;
    });
    const inFlight = cache.fetch(["k"], () => slow);
    // Drop the entry while the fetch is still in flight — this is what an
    // unmount-during-fetch or hard reset looks like.
    cache.remove(["k"]);
    resolveFirst(1);
    await inFlight;
    expect(cache.peek(["k"])).toBeUndefined();
  });

  test("invalidate forces refetch via the supplied refetcher", async () => {
    const cache = new SyncCache();
    cache.subscribe(["scope", { id: 1 }], () => {});
    let value = 0;
    await cache.fetch(["scope", { id: 1 }], async () => ++value);

    expect(cache.peek(["scope", { id: 1 }])?.data).toBe(1);

    await cache.invalidate(["scope"], async (entry) => {
      await cache.fetch(entry.key, async () => ++value);
    });

    expect(cache.peek(["scope", { id: 1 }])?.data).toBe(2);
  });

  test("invalidate leaves observer-less entries alone", async () => {
    const cache = new SyncCache();
    let value = 0;
    await cache.fetch(["cold"], async () => ++value);
    let refetched = 0;
    await cache.invalidate(["cold"], async () => {
      refetched += 1;
    });
    expect(refetched).toBe(0);
  });
});

describe("SyncCache.subscribe refcount + GC", () => {
  test("ref-counts observers and schedules GC at zero", () => {
    const timers = fakeTimers();
    const cache = new SyncCache({
      cacheTimeMs: 100,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const off1 = cache.subscribe(["k"], () => {});
    const off2 = cache.subscribe(["k"], () => {});
    expect(cache.observerCount(["k"])).toBe(2);
    expect(timers.pending().length).toBe(0);

    off1();
    expect(cache.observerCount(["k"])).toBe(1);
    expect(timers.pending().length).toBe(0);

    off2();
    expect(cache.observerCount(["k"])).toBe(0);
    expect(timers.pending().length).toBe(1);

    timers.advance();
    expect(cache.peek(["k"])).toBeUndefined();
  });

  test("a fresh subscribe cancels a pending GC", () => {
    const timers = fakeTimers();
    const cache = new SyncCache({
      cacheTimeMs: 100,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const off = cache.subscribe(["k"], () => {});
    off();
    expect(timers.pending().length).toBe(1);
    const off2 = cache.subscribe(["k"], () => {});
    expect(timers.pending().length).toBe(0);
    off2();
  });

  test("repeated unsubscribe is a no-op", () => {
    const cache = new SyncCache();
    const off = cache.subscribe(["k"], () => {});
    off();
    off();
    expect(cache.observerCount(["k"])).toBe(0);
  });
});

describe("SyncCache.setLastSeq", () => {
  test("lastSeq is monotonic up-only", () => {
    const cache = new SyncCache();
    cache.setLastSeq(["k"], 5);
    cache.setLastSeq(["k"], 3);
    expect(cache.peek(["k"])?.lastSeq).toBe(5);
    cache.setLastSeq(["k"], 10);
    expect(cache.peek(["k"])?.lastSeq).toBe(10);
  });
});

describe("SyncCache.setData optimistic", () => {
  test("returns the previous snapshot for rollback", async () => {
    const cache = new SyncCache();
    await cache.fetch(["k"], async () => "initial");
    const { previous } = cache.setData(["k"], "optimistic");
    expect(previous).toBe("initial");
    expect(cache.peek(["k"])?.data).toBe("optimistic");
    cache.setData(["k"], previous as string);
    expect(cache.peek(["k"])?.data).toBe("initial");
  });
});

describe("SyncCache.clear and remove", () => {
  test("clear drops every entry and cancels GC", () => {
    const timers = fakeTimers();
    const cache = new SyncCache({
      cacheTimeMs: 100,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    cache.subscribe(["a"], () => {})();
    cache.subscribe(["b"], () => {})();
    cache.clear();
    expect([...cache.snapshot()].length).toBe(0);
    expect(timers.pending().length).toBe(0);
  });
});

describe("SyncCache version bumps", () => {
  test("version bumps on every status / data mutation so React snapshots tear-detect", async () => {
    const cache = new SyncCache();
    cache.subscribe(["k"], () => {});
    const initialVersion = cache.peek(["k"])!.version;
    await cache.fetch(["k"], async () => 1);
    const afterLoadingThenSuccess = cache.peek(["k"])!.version;
    // status goes idle → loading → success — two notifies, so at least two bumps.
    expect(afterLoadingThenSuccess).toBeGreaterThanOrEqual(initialVersion + 2);
    cache.setData(["k"], 2);
    expect(cache.peek(["k"])!.version).toBeGreaterThan(afterLoadingThenSuccess);
  });

  test("invalidate bumps version even when no refetcher is supplied", async () => {
    const cache = new SyncCache();
    cache.subscribe(["scope", { id: 1 }], () => {});
    await cache.fetch(["scope", { id: 1 }], async () => 1);
    const before = cache.peek(["scope", { id: 1 }])!.version;
    await cache.invalidate(["scope"]);
    expect(cache.peek(["scope", { id: 1 }])!.version).toBeGreaterThan(before);
  });
});
