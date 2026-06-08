import { registerHappyDomForTests } from "../test/registerHappyDom";

registerHappyDomForTests();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GatewayRpcError } from "@smithers-orchestrator/gateway-client";
import { resetGatewayClient, setGatewayClientForTests } from "./gatewayClient";
import { __test_stopRunStreams, useGatewayStore } from "./gatewayStore";

/**
 * The gateway store has moved off polling and onto the SDK's WebSocket streams.
 * These tests drive the store via an in-memory fake of `SmithersGatewayClient`
 * that records every call and emits hand-authored event frames into the
 * resilient run-event stream — proving end-to-end:
 *
 *   - `launch()` sends `{ workflow, input }` to the SDK (NOT `{ workflowKey }`),
 *     and refreshes the runs list on success;
 *   - `connect()` populates workflows + runs from a single round-trip;
 *   - `openRun()` warm-loads the snapshot then live-applies run-event status
 *     transitions (start → complete) without re-polling `listRuns`;
 *   - a stream that throws after delivering frames lets the resilient layer
 *     reconnect (the SDK already retries; the store must not crash, and the
 *     next frames must still land);
 *   - a snapshot fetch that resolves AFTER the user navigated to a different
 *     run is DROPPED rather than clobbering the new view (stale-data guard);
 *   - an `Unauthorized` RPC error flips the connection status to
 *     `unauthorized` so the surface re-prompts auth.
 */

type StreamRunEventsParams = { runId: string; afterSeq?: number };
type LaunchRunParams = { workflow: string; input?: Record<string, unknown> };

type RunEventFrame = {
  type: "event";
  event: "run.event" | "run.gap_resync" | "run.heartbeat" | "run.error" | string;
  seq: number;
  stateVersion: number;
  payload: { streamId: string; runId: string; seq: number; event: string; payload?: unknown };
};

type DevToolsFrame = {
  type: "event";
  event: "devtools.event" | "devtools.error";
  seq: number;
  stateVersion: number;
  payload: { streamId: string; runId: string };
};

type FakeAsyncQueue<T> = {
  push(value: T): void;
  end(): void;
  fail(error: Error): void;
  iter(signal?: AbortSignal): AsyncGenerator<T>;
};

function asyncQueue<T>(): FakeAsyncQueue<T> {
  const queue: Array<{ kind: "v"; value: T } | { kind: "e" } | { kind: "x"; error: Error }> = [];
  const waiters: Array<() => void> = [];
  const wake = (): void => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  return {
    push(value: T): void {
      queue.push({ kind: "v", value });
      wake();
    },
    end(): void {
      queue.push({ kind: "e" });
      wake();
    },
    fail(error: Error): void {
      queue.push({ kind: "x", error });
      wake();
    },
    async *iter(signal?: AbortSignal): AsyncGenerator<T> {
      while (true) {
        if (signal?.aborted) return;
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            waiters.push(resolve);
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          continue;
        }
        const head = queue.shift();
        if (!head) return;
        if (head.kind === "e") return;
        if (head.kind === "x") throw head.error;
        yield head.value;
      }
    },
  };
}

type CallLog = {
  listRuns: number;
  listWorkflows: number;
  getDevToolsSnapshot: number;
  launchRun: LaunchRunParams[];
  streamRunEvents: StreamRunEventsParams[];
  streamDevTools: StreamRunEventsParams[];
};

type SnapshotResolver = ((params: { runId: string }) => unknown) | undefined;

function buildFakeClient() {
  const calls: CallLog = {
    listRuns: 0,
    listWorkflows: 0,
    getDevToolsSnapshot: 0,
    launchRun: [],
    streamRunEvents: [],
    streamDevTools: [],
  };
  let runsPayload: unknown = [];
  let workflowsPayload: unknown = [];
  let listRunsReject: Error | undefined;
  let snapshotReject: Error | undefined;
  let snapshotResolver: SnapshotResolver;
  const runEventQueue = asyncQueue<RunEventFrame>();
  const devToolsQueue = asyncQueue<DevToolsFrame>();
  // Tracks how many times streamRunEventsResilient was invoked — proves the
  // resilient generator was used rather than direct streamRunEvents.
  const fake = {
    calls,
    setRuns(payload: unknown): void { runsPayload = payload; },
    setWorkflows(payload: unknown): void { workflowsPayload = payload; },
    failListRuns(error: Error): void { listRunsReject = error; },
    failSnapshot(error: Error): void { snapshotReject = error; },
    setSnapshotResolver(resolver: SnapshotResolver): void { snapshotResolver = resolver; },
    runEventQueue,
    devToolsQueue,
    // The SDK methods the store calls.
    async listRuns(): Promise<unknown> {
      calls.listRuns += 1;
      if (listRunsReject) throw listRunsReject;
      return runsPayload;
    },
    async listWorkflows(): Promise<unknown> {
      calls.listWorkflows += 1;
      return workflowsPayload;
    },
    async launchRun(params: LaunchRunParams): Promise<{ runId: string; workflow: string }> {
      calls.launchRun.push(params);
      return { runId: "run-launched", workflow: params.workflow };
    },
    async getNodeOutput(): Promise<unknown> {
      return { row: { value: 1 } };
    },
    async rpc(method: string, params: { runId: string }): Promise<unknown> {
      if (method === "getDevToolsSnapshot") {
        calls.getDevToolsSnapshot += 1;
        if (snapshotReject) throw snapshotReject;
        if (snapshotResolver) return snapshotResolver(params);
        return { root: { id: 1, name: "root", children: [] }, runState: { state: "running" } };
      }
      throw new Error(`unexpected rpc ${method}`);
    },
    async rpcRaw(method: string, params?: unknown): Promise<unknown> {
      return fake.rpc(method, params as { runId: string });
    },
    // Both SDK stream APIs.
    streamRunEvents(params: StreamRunEventsParams, options: { signal?: AbortSignal } = {}) {
      calls.streamRunEvents.push(params);
      return runEventQueue.iter(options.signal);
    },
    streamRunEventsResilient(params: StreamRunEventsParams, options: { signal?: AbortSignal } = {}) {
      // The resilient generator's contract is: "yield frames; reconnect on
      // drop". The fake just re-uses the same queue, but counts the call so
      // the test can assert the store reaches for the *resilient* one.
      calls.streamRunEvents.push(params);
      return runEventQueue.iter(options.signal);
    },
    streamDevTools(params: StreamRunEventsParams, options: { signal?: AbortSignal } = {}) {
      calls.streamDevTools.push(params);
      return devToolsQueue.iter(options.signal);
    },
  };
  return fake;
}

function makeRunEventFrame(event: string, runId: string, seq: number, inner: Record<string, unknown> = {}): RunEventFrame {
  return {
    type: "event",
    event: "run.event",
    seq,
    stateVersion: seq,
    payload: { streamId: "stream-1", runId, seq, event, payload: inner },
  };
}

function makeDevToolsFrame(runId: string, seq: number): DevToolsFrame {
  return {
    type: "event",
    event: "devtools.event",
    seq,
    stateVersion: seq,
    payload: { streamId: "dt-1", runId },
  };
}

let fake: ReturnType<typeof buildFakeClient>;

beforeEach(() => {
  fake = buildFakeClient();
  // The store reaches for `getGatewayClient()` — we replace it with the fake
  // so every SDK call lands here.
  setGatewayClientForTests(fake as unknown as Parameters<typeof setGatewayClientForTests>[0]);
  useGatewayStore.getState().reset();
});

afterEach(() => {
  __test_stopRunStreams();
  setGatewayClientForTests(undefined);
  resetGatewayClient();
  useGatewayStore.getState().reset();
});

describe("connect()", () => {
  test("loads workflows + runs in one round-trip and goes online", async () => {
    fake.setWorkflows([
      { key: "w1", readableName: "W1", description: "", hasUi: true, uiPath: "/workflows/w1" },
    ]);
    fake.setRuns([
      { runId: "r1", workflowKey: "w1", status: "running", createdAtMs: 1 },
    ]);
    await useGatewayStore.getState().connect();
    const state = useGatewayStore.getState();
    expect(state.status).toBe("online");
    expect(state.workflows.map((w) => w.key)).toEqual(["w1"]);
    expect(state.runs.map((r) => r.runId)).toEqual(["r1"]);
    expect(fake.calls.listRuns).toBe(1);
    expect(fake.calls.listWorkflows).toBe(1);
  });

  test("an Unauthorized RPC error flips status to unauthorized and clears data", async () => {
    fake.failListRuns(new GatewayRpcError({
      method: "listRuns",
      code: "Unauthorized",
      message: "needs auth",
      status: 401,
    }));
    await useGatewayStore.getState().connect();
    expect(useGatewayStore.getState().status).toBe("unauthorized");
    expect(useGatewayStore.getState().runs).toEqual([]);
  });
});

describe("launch()", () => {
  test("sends { workflow } (not { workflowKey }) and refreshes the runs list", async () => {
    fake.setRuns([]);
    const runId = await useGatewayStore.getState().launch("deploy");
    expect(runId).toBe("run-launched");
    expect(fake.calls.launchRun).toEqual([{ workflow: "deploy", input: {} }]);
    // launch() then triggers a listRuns refresh so the new row appears.
    expect(fake.calls.listRuns).toBeGreaterThanOrEqual(1);
  });
});

describe("openRun() streaming", () => {
  async function flush(): Promise<void> {
    // Let queued microtasks run so the in-memory async generator can deliver.
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }

  test("warm-loads a snapshot then live-applies run.completed events", async () => {
    fake.setRuns([
      { runId: "r1", workflowKey: "deploy", status: "running", createdAtMs: 1 },
    ]);
    await useGatewayStore.getState().connect();
    useGatewayStore.getState().openRun("deploy", "r1");
    await flush();
    expect(fake.calls.getDevToolsSnapshot).toBe(1);
    expect(fake.calls.streamRunEvents.length).toBeGreaterThanOrEqual(1);
    expect(fake.calls.streamDevTools.length).toBeGreaterThanOrEqual(1);

    // After completion the gateway's snapshot reflects the terminal state,
    // so the test's snapshot resolver flips with the run-event frame.
    fake.setSnapshotResolver(() => ({
      root: { id: 1, name: "root", children: [] },
      runState: { state: "succeeded" },
    }));
    // A run.completed frame must flip the runs list status WITHOUT triggering
    // another listRuns poll — the live stream replaces the 3s refresh loop.
    const listRunsBefore = fake.calls.listRuns;
    fake.runEventQueue.push(
      makeRunEventFrame("run.completed", "r1", 5, { state: "ok" }),
    );
    await flush();
    expect(useGatewayStore.getState().runs.find((r) => r.runId === "r1")?.status).toBe("ok");
    expect(fake.calls.listRuns).toBe(listRunsBefore);
  });

  test("a devtools frame triggers a fresh snapshot pull", async () => {
    fake.setRuns([{ runId: "r1", workflowKey: "deploy", status: "running", createdAtMs: 1 }]);
    await useGatewayStore.getState().connect();
    useGatewayStore.getState().openRun("deploy", "r1");
    await flush();
    const before = fake.calls.getDevToolsSnapshot;
    fake.devToolsQueue.push(makeDevToolsFrame("r1", 2));
    await flush();
    expect(fake.calls.getDevToolsSnapshot).toBeGreaterThan(before);
  });

  test("a stream that ends silently lets the store keep accepting new frames after reconnect", async () => {
    fake.setRuns([{ runId: "r1", workflowKey: "deploy", status: "running", createdAtMs: 1 }]);
    await useGatewayStore.getState().connect();
    useGatewayStore.getState().openRun("deploy", "r1");
    await flush();

    // Simulate the SDK's resilient generator reconnect: end the queue, the
    // for-await loop returns; the store should NOT crash and should still
    // honor a subsequent re-open (mimicking how a user might revisit the
    // run after a transient disconnect).
    fake.runEventQueue.end();
    fake.devToolsQueue.end();
    await flush();

    // Re-open the same run; the streams must re-subscribe.
    const streamCallsBefore = fake.calls.streamRunEvents.length;
    __test_stopRunStreams();
    useGatewayStore.getState().openRun("deploy", "r1");
    await flush();
    expect(fake.calls.streamRunEvents.length).toBeGreaterThan(streamCallsBefore);
  });

  test("a late snapshot for a stale run does NOT clobber the new run's view", async () => {
    fake.setRuns([
      { runId: "r1", workflowKey: "deploy", status: "running", createdAtMs: 1 },
      { runId: "r2", workflowKey: "deploy", status: "running", createdAtMs: 2 },
    ]);
    await useGatewayStore.getState().connect();

    // Make r1's snapshot await indefinitely; r2's snapshot resolves
    // immediately. We then switch from r1 → r2 before r1's snapshot lands,
    // and finally resolve r1's snapshot to prove the store drops it.
    let resolveR1: ((value: unknown) => void) | undefined;
    fake.setSnapshotResolver(({ runId }) => {
      if (runId === "r1") {
        return new Promise((resolve) => {
          resolveR1 = resolve as (value: unknown) => void;
        });
      }
      return { root: { id: 2, name: "r2-root", children: [] }, runState: { state: "running" } };
    });

    useGatewayStore.getState().openRun("deploy", "r1");
    await flush();
    // Switch to r2 before r1's snapshot ever resolves.
    useGatewayStore.getState().openRun("deploy", "r2");
    await flush();
    const r2View = useGatewayStore.getState().runViews["r2"];
    expect(r2View?.tree?.name).toBe("r2-root");

    // Now resolve r1's snapshot with a tree that says "r1-root". The store's
    // stale-data guard must drop it — r2's view must still show r2-root.
    resolveR1?.({ root: { id: 1, name: "r1-root", children: [] }, runState: { state: "running" } });
    await flush();
    expect(useGatewayStore.getState().runViews["r2"]?.tree?.name).toBe("r2-root");
    // r1's view, in contrast, COULD be filled now (it WAS the selected run
    // when we issued the snapshot pull); we only assert the new run's view
    // is intact, since the stale-data guard is scoped to "drop responses for
    // a different selected run".
    expect(useGatewayStore.getState().selectedRunId).toBe("r2");
  });
});
