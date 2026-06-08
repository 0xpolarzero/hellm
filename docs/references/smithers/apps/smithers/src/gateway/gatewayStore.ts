import type { GatewayEventFrame } from "@smithers-orchestrator/gateway-client";
import { create } from "zustand";
import {
  connectionStateValue,
  gatewayConnectionState,
  gatewayStreamStaleUpdatesTotal,
  surfaceRefreshDurationMs,
  surfaceRefreshTotal,
} from "../observability/uiMetrics";
import type { NodeStatus, RunNode } from "../runs/Run";
import { getGatewayClient, isAuthError } from "./gatewayClient";
import type { GatewayRun, GatewayStatus, GatewayWorkflow } from "./gatewayTypes";
import { snapshotToRunNode } from "./snapshotToRunNode";
import { toNodeStatus } from "./toNodeStatus";

function setStatusGauge(status: GatewayStatus): void {
  gatewayConnectionState.set(connectionStateValue(status));
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** The resolved, render-ready view of one gateway run. */
type RunView = {
  workflowKey: string;
  status: NodeStatus;
  /** The node tree from the DevTools snapshot; null until loaded or for an empty run. */
  tree: RunNode | null;
  loaded: boolean;
};

type GatewayState = {
  status: GatewayStatus;
  /** Workflows that ship a custom UI (the only ones this app can embed). */
  workflows: GatewayWorkflow[];
  runs: GatewayRun[];
  selectedRunId: string | undefined;
  runViews: Record<string, RunView>;
  /** Node output rows, keyed `${runId}::${nodeId}`. `null` once fetched-but-empty. */
  outputs: Record<string, unknown>;

  /** Lazily connect if we have not yet (or a previous attempt went offline). */
  ensureConnected: () => void;
  connect: () => Promise<void>;
  reset: () => void;
  refreshRuns: () => Promise<void>;
  /**
   * Select a run and begin (re)loading its snapshot. Opens a live DevTools
   * stream + a resilient run-event stream; both close when a different run
   * opens or `closeRun()` fires.
   */
  openRun: (workflowKey: string, runId: string) => void;
  closeRun: () => void;
  /**
   * Force a snapshot pull. Normally driven by the DevTools event stream; this
   * stays exposed so the route binding can warm-load before the WS opens.
   */
  refreshSnapshot: (runId: string) => Promise<void>;
  fetchOutput: (runId: string, nodeId: string) => Promise<void>;
  launch: (workflowKey: string) => Promise<string | undefined>;
  uiPathFor: (workflowKey: string) => string | undefined;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function asNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

/** Keep only workflows that actually mount a UI (`hasUi` + a non-empty `uiPath`). */
function parseWorkflows(payload: unknown): GatewayWorkflow[] {
  if (!Array.isArray(payload)) return [];
  const out: GatewayWorkflow[] = [];
  for (const raw of payload) {
    const record = asRecord(raw);
    const key = asString(record.key);
    const uiPath = asString(record.uiPath);
    if (key && record.hasUi === true && uiPath) {
      out.push({
        key,
        readableName: asString(record.readableName) || key,
        description: asString(record.description),
        uiPath,
      });
    }
  }
  return out;
}

function parseRuns(payload: unknown): GatewayRun[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((raw) => {
      const record = asRecord(raw);
      return {
        runId: asString(record.runId),
        workflowKey: asString(record.workflowKey),
        status: toNodeStatus(asString(record.status)),
        createdAtMs: asNumber(record.createdAtMs),
      } satisfies GatewayRun;
    })
    .filter((run) => run.runId.length > 0);
}

function isTerminal(status: NodeStatus): boolean {
  return status === "ok" || status === "failed";
}

/**
 * Module-level stream lifecycle for the *currently-selected* run. Both streams
 * close when the user opens a different run, leaves the surface, or `reset()`
 * fires. Using AbortController instead of `setInterval` lets the SDK's resilient
 * stream (`streamRunEventsResilient`) own reconnect+resume; the store just
 * relays per-frame updates.
 */
let activeRunId: string | undefined;
let activeAbort: AbortController | undefined;

function stopRunStreams(): void {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = undefined;
  }
  activeRunId = undefined;
}

export const useGatewayStore = create<GatewayState>((set, get) => {
  /**
   * Reflect a run-event status update onto the runs list and the run view (when
   * the inspector is open). Frames carry `payload.event` ("run.started",
   * "run.completed", etc.) — we lift these onto our `NodeStatus` cleanly so a
   * status pill flips live without a refetch. A `run.completed` frame carries a
   * terminal `state` ("ok"/"failed"); other frames advance status to "running".
   */
  function applyRunEventFrame(frame: GatewayEventFrame, runId: string): void {
    const payload = asRecord(frame.payload);
    const innerEvent = asString(payload.event);
    if (!innerEvent) return;
    const innerPayload = asRecord(payload.payload);
    let nextStatus: NodeStatus | undefined;
    if (innerEvent === "run.completed") {
      const state = asString(innerPayload.state) || asString(innerPayload.status);
      nextStatus = toNodeStatus(state);
      // The gateway uses "succeeded" / "failed" / "cancelled" in the payload;
      // toNodeStatus only maps "ok" — so an explicit terminal fallback below.
      if (nextStatus !== "ok" && nextStatus !== "failed") {
        nextStatus = state === "failed" || state === "cancelled" ? "failed" : "ok";
      }
    } else if (innerEvent === "run.started" || innerEvent === "run.resumed") {
      nextStatus = "running";
    } else if (innerEvent === "run.paused") {
      nextStatus = "waiting";
    }
    if (!nextStatus) return;
    set((store) => ({
      runs: store.runs.map((run) =>
        run.runId === runId ? { ...run, status: nextStatus } : run,
      ),
      runViews: store.runViews[runId]
        ? {
            ...store.runViews,
            [runId]: { ...store.runViews[runId], status: nextStatus },
          }
        : store.runViews,
    }));
    // When a run finishes, pull one final snapshot so the inspector tree
    // reflects the terminal state without waiting on the next devtools frame.
    if (nextStatus === "ok" || nextStatus === "failed") {
      void get().refreshSnapshot(runId);
    }
  }

  /**
   * Spin up the per-run WS streams. Two parallel readers:
   *
   *   - `streamRunEventsResilient` for status transitions (`run.started`,
   *     `run.completed`, …). It auto-reconnects with backoff on a silent drop.
   *   - `streamDevTools` for live snapshot deltas; on every frame we re-pull
   *     `getDevToolsSnapshot` (the frames carry deltas, not full trees, so
     *     a fresh snapshot is the simplest correct mapping into our store's
   *     `RunNode`). The legacy 3s poll is gone.
   *
   * If a run is selected by `openRun` AFTER another run was already streaming,
   * the prior streams abort first — preventing late frames from leaking onto
   * the new run's view. (The selectedRunId guard inside each loop is a second
   * defence-in-depth check against an out-of-order abort.)
   */
  function startRunStreams(runId: string): void {
    if (activeRunId === runId && activeAbort && !activeAbort.signal.aborted) return;
    stopRunStreams();
    const abort = new AbortController();
    activeAbort = abort;
    activeRunId = runId;
    const client = getGatewayClient();
    // Run events.
    void (async () => {
      try {
        for await (const frame of client.streamRunEventsResilient(
          { runId, afterSeq: 0 },
          { signal: abort.signal },
        )) {
          if (abort.signal.aborted) {
            gatewayStreamStaleUpdatesTotal.inc({
              stream: "run_events",
              reason: "aborted",
            });
            break;
          }
          if (get().selectedRunId !== runId) {
            gatewayStreamStaleUpdatesTotal.inc({
              stream: "run_events",
              reason: "selection_changed",
            });
            break;
          }
          applyRunEventFrame(frame, runId);
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          if (isAuthError(error)) {
            set({ status: "unauthorized" });
            setStatusGauge("unauthorized");
          }
        }
      }
    })();
    // DevTools snapshot stream — refetch on each frame.
    void (async () => {
      try {
        for await (const frame of client.streamDevTools(
          { runId },
          { signal: abort.signal },
        )) {
          if (abort.signal.aborted) {
            gatewayStreamStaleUpdatesTotal.inc({
              stream: "devtools",
              reason: "aborted",
            });
            break;
          }
          if (get().selectedRunId !== runId) {
            gatewayStreamStaleUpdatesTotal.inc({
              stream: "devtools",
              reason: "selection_changed",
            });
            break;
          }
          // We treat any devtools frame as a "snapshot changed" signal and
          // re-pull. (The frames carry deltas; we don't reconstruct them
          // ourselves because `snapshotToRunNode` already understands the
          // snapshot shape end-to-end.)
          if (frame.event === "devtools.event" || frame.event === "devtools.error") {
            await get().refreshSnapshot(runId);
          }
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          if (isAuthError(error)) {
            set({ status: "unauthorized" });
            setStatusGauge("unauthorized");
          }
        }
      }
    })();
  }

  return {
    status: "idle",
    workflows: [],
    runs: [],
    selectedRunId: undefined,
    runViews: {},
    outputs: {},

    ensureConnected: () => {
      const status = get().status;
      if (status === "idle" || status === "offline" || status === "unauthorized") {
        void get().connect();
      }
    },

    connect: async () => {
      if (get().status === "connecting" || get().status === "online") return;
      set({ status: "connecting" });
      setStatusGauge("connecting");
      const client = getGatewayClient();
      try {
        const [workflows, runs] = await Promise.all([
          client.listWorkflows({ filter: { hasUi: true } }),
          client.listRuns({}),
        ]);
        set({
          status: "online",
          workflows: parseWorkflows(workflows),
          runs: parseRuns(runs),
        });
        setStatusGauge("online");
      } catch (error) {
        const nextStatus: GatewayStatus = isAuthError(error) ? "unauthorized" : "offline";
        set({
          status: nextStatus,
          workflows: isAuthError(error) ? [] : get().workflows,
          runs: isAuthError(error) ? [] : get().runs,
        });
        setStatusGauge(nextStatus);
      }
    },

    reset: () => {
      stopRunStreams();
      set({
        status: "idle",
        workflows: [],
        runs: [],
        selectedRunId: undefined,
        runViews: {},
        outputs: {},
      });
    },

    refreshRuns: async () => {
      const client = getGatewayClient();
      const start = nowMs();
      try {
        const runs = await client.listRuns({});
        set({ runs: parseRuns(runs), status: "online" });
        setStatusGauge("online");
        surfaceRefreshTotal.inc({ surface: "runs", trigger: "poll", outcome: "ok" });
        surfaceRefreshDurationMs.observe(nowMs() - start, { surface: "runs" });
      } catch (error) {
        const nextStatus: GatewayStatus = isAuthError(error) ? "unauthorized" : "offline";
        set({
          status: nextStatus,
          runs: isAuthError(error) ? [] : get().runs,
        });
        setStatusGauge(nextStatus);
        surfaceRefreshTotal.inc({
          surface: "runs",
          trigger: "poll",
          outcome: isAuthError(error) ? "auth_failure" : "error",
        });
      }
    },

    openRun: (workflowKey, runId) => {
      get().ensureConnected();
      set((state) => ({
        selectedRunId: runId,
        runViews: {
          ...state.runViews,
          [runId]: state.runViews[runId] ?? {
            workflowKey,
            status: "queued",
            tree: null,
            loaded: false,
          },
        },
      }));
      // Warm-load one snapshot now so the inspector renders something before
      // the first devtools frame arrives. The streams keep it live thereafter.
      void get().refreshSnapshot(runId);
      if (typeof WebSocket !== "undefined") {
        startRunStreams(runId);
      }
    },

    closeRun: () => {
      stopRunStreams();
      set({ selectedRunId: undefined });
    },

    refreshSnapshot: async (runId) => {
      // Stale-data guard: a snapshot fetched against a run the user has since
      // navigated away from must NOT overwrite the next run's view. We pin the
      // expected selectedRunId at the start of the await and short-circuit if
      // it changed before the response landed.
      const expectedSelected = get().selectedRunId;
      const client = getGatewayClient();
      const start = nowMs();
      try {
        // `getDevToolsSnapshot` is a gateway-side RPC that is not in the
        // typed `GatewayRpcMethod` enum (it predates the typed surface), so
        // we go through `rpcRaw` to invoke it.
        const snapshot = await client.rpcRaw("getDevToolsSnapshot", { runId });
        // Drop the response if the user navigated to a different run while we
        // awaited it — preventing a late frame from clobbering the new view.
        if (get().selectedRunId !== expectedSelected) {
          gatewayStreamStaleUpdatesTotal.inc({
            stream: "snapshot",
            reason: "selection_changed",
          });
          return;
        }
        const state = asString(asRecord(asRecord(snapshot).runState).state);
        set((store) => ({
          status: "online",
          runViews: {
            ...store.runViews,
            [runId]: {
              workflowKey: store.runViews[runId]?.workflowKey ?? "",
              status: toNodeStatus(state),
              tree: snapshotToRunNode(snapshot as never),
              loaded: true,
            },
          },
        }));
        setStatusGauge("online");
        surfaceRefreshTotal.inc({
          surface: "snapshot",
          trigger: "poll",
          outcome: "ok",
        });
        surfaceRefreshDurationMs.observe(nowMs() - start, { surface: "snapshot" });
      } catch (error) {
        if (isAuthError(error)) {
          set({ status: "unauthorized" });
          setStatusGauge("unauthorized");
        }
        surfaceRefreshTotal.inc({
          surface: "snapshot",
          trigger: "poll",
          outcome: isAuthError(error) ? "auth_failure" : "error",
        });
        // Leave the prior view in place; the streams own connection state.
      }
    },

    fetchOutput: async (runId, nodeId) => {
      const key = `${runId}::${nodeId}`;
      if (key in get().outputs) return;
      const client = getGatewayClient();
      try {
        const payload = await client.getNodeOutput({ runId, nodeId, iteration: 0 });
        const record = asRecord(payload);
        const row = "row" in record ? record.row : payload;
        set((store) => ({ outputs: { ...store.outputs, [key]: row ?? null } }));
      } catch (error) {
        if (isAuthError(error)) {
          set({ status: "unauthorized" });
          setStatusGauge("unauthorized");
        }
        set((store) => ({ outputs: { ...store.outputs, [key]: null } }));
      }
    },

    launch: async (workflowKey) => {
      const client = getGatewayClient();
      try {
        // The gateway's launchRun request schema is `{ workflow, input?, options? }`.
        // The legacy fetch path sent `{ workflowKey }`, which the gateway
        // silently rejected at validation — fixed here.
        const payload = await client.launchRun({ workflow: workflowKey, input: {} });
        const runId = asString(asRecord(payload).runId);
        // Refresh the runs list so the new row appears immediately; status
        // updates from there flow over the run-event stream.
        void get().refreshRuns();
        return runId || undefined;
      } catch (error) {
        if (isAuthError(error)) {
          set({ status: "unauthorized" });
          setStatusGauge("unauthorized");
        }
        return undefined;
      }
    },

    uiPathFor: (workflowKey) =>
      get().workflows.find((workflow) => workflow.key === workflowKey)?.uiPath,
  };
});

export const __test_stopRunStreams = stopRunStreams;
