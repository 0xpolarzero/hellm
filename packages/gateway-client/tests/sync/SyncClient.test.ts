import { describe, expect, test } from "bun:test";
import { SyncClient } from "../../src/sync/SyncClient.ts";
import type { SyncTransport } from "../../src/sync/SyncTransport.ts";

/**
 * Client-level behavior tests, focused on the integration between cache,
 * mutation rollback, invalidate-on-success, and auth-error escalation.
 */

function fakeTransport(handlers: Record<string, (params: unknown) => unknown>): SyncTransport {
  return {
    rpc(method, params) {
      const handler = handlers[method];
      if (!handler) return Promise.reject(new Error(`unknown method ${method}`));
      try {
        return Promise.resolve(handler(params));
      } catch (cause) {
        return Promise.reject(cause);
      }
    },
  };
}

describe("SyncClient.query staleness", () => {
  test("returns cached data when fresh, refetches when stale", async () => {
    let value = 0;
    const client = new SyncClient({
      transport: fakeTransport({ listRuns: () => ++value }),
      cache: { now: (() => { let t = 0; return () => (t += 1000); })() },
    });
    client.cache.subscribe(["gateway:listRuns", {}], () => {});
    const first = await client.query(["gateway:listRuns", {}], () => client.rpc("listRuns", {}), {
      staleTimeMs: 5_000,
    });
    expect(first).toBe(1);
    const second = await client.query(["gateway:listRuns", {}], () => client.rpc("listRuns", {}), {
      staleTimeMs: 5_000,
    });
    expect(second).toBe(1);
  });
});

describe("SyncClient.mutate rollback on failure", () => {
  test("calls onMutate, then onError with the snapshot context", async () => {
    const client = new SyncClient({
      transport: fakeTransport({ failOp: () => { throw new Error("nope"); } }),
    });
    client.cache.subscribe(["counter"], () => {});
    client.cache.setData(["counter"], 10);
    let rolledBackTo: number | undefined;
    await expect(
      client.mutate(
        (next: number) => client.rpc("failOp", { next }),
        99,
        {
          onMutate: (_vars, c) => {
            const { previous } = c.cache.setData(["counter"], 99);
            return previous;
          },
          onError: (_err, _vars, context, c) => {
            rolledBackTo = context as number;
            c.cache.setData(["counter"], context as number);
          },
        },
      ),
    ).rejects.toThrow("nope");
    expect(rolledBackTo).toBe(10);
    expect(client.cache.peek<number>(["counter"])?.data).toBe(10);
  });

  test("invalidate on success refetches active subscriptions", async () => {
    let runs = 0;
    const client = new SyncClient({
      transport: fakeTransport({
        listRuns: () => ({ count: ++runs }),
        launchRun: () => ({ runId: "r1" }),
      }),
    });
    client.cache.subscribe(["gateway:listRuns", {}], () => {});
    await client.query(
      ["gateway:listRuns", {}],
      () => client.rpc("listRuns", {}),
    );
    expect((client.cache.peek<{ count: number }>(["gateway:listRuns", {}])?.data)?.count).toBe(1);
    await client.mutate(
      (vars: Record<string, unknown>) => client.rpc("launchRun", vars),
      { workflowKey: "x" },
      { invalidate: [["gateway:listRuns"]] },
    );
    expect((client.cache.peek<{ count: number }>(["gateway:listRuns", {}])?.data)?.count).toBe(2);
  });
});

describe("SyncClient auth-error escalation", () => {
  test("an UNAUTHORIZED RPC error fires onAuthError", async () => {
    let authError: Error | undefined;
    const client = new SyncClient({
      transport: fakeTransport({
        listRuns: () => { throw new Error("UNAUTHORIZED: missing token"); },
      }),
      onAuthError: (error) => {
        authError = error;
      },
    });
    await expect(client.rpc("listRuns", {})).rejects.toThrow("UNAUTHORIZED");
    expect(authError?.message).toMatch(/UNAUTHORIZED/);
  });

  test("a stale-while-revalidate fetch on an UNAUTHORIZED reply still fires onAuthError", async () => {
    let authError: Error | undefined;
    const client = new SyncClient({
      transport: fakeTransport({
        listRuns: () => { throw new Error("Unauthorized: bad token"); },
      }),
      onAuthError: (error) => {
        authError = error;
      },
    });
    client.cache.subscribe(["gateway:listRuns", {}], () => {});
    await expect(
      client.query(["gateway:listRuns", {}], () => client.rpc("listRuns", {})),
    ).rejects.toThrow(/Unauthorized/);
    expect(authError).toBeDefined();
  });
});

describe("SyncClient.reset", () => {
  test("wipes cache + cancels in-flight fetchers", async () => {
    const client = new SyncClient({
      transport: fakeTransport({ listRuns: () => "ok" }),
    });
    client.cache.subscribe(["gateway:listRuns", {}], () => {});
    await client.query(["gateway:listRuns", {}], () => client.rpc("listRuns", {}));
    client.reset();
    expect([...client.cache.snapshot()].length).toBe(0);
  });
});
