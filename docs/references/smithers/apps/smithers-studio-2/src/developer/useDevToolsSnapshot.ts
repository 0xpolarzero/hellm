import { useCallback, useEffect, useState } from "react";
import { parseDevToolsSnapshot } from "../devtools/parseDevToolsSnapshot";
import { devGatewayClient } from "./devGatewayClient";
import type { DevRunSummary } from "./DevRunSummary";
import type { DevToolsSnapshot } from "../devtools/DevToolsSnapshot";

export type DevToolsSnapshotState = {
  runs: DevRunSummary[];
  selectedRunId: string | null;
  snapshot: DevToolsSnapshot | null;
  loadingRuns: boolean;
  loadingSnapshot: boolean;
  error: string | null;
  selectRun: (runId: string) => void;
  refresh: () => void;
};

function asRunSummary(row: unknown): DevRunSummary {
  const record = (row ?? {}) as Record<string, unknown>;
  return {
    runId: String(record.runId ?? ""),
    workflowKey: record.workflowKey == null ? null : String(record.workflowKey),
    status: record.status == null ? null : String(record.status),
    createdAtMs: typeof record.createdAtMs === "number" ? record.createdAtMs : null,
  };
}

/**
 * Drives the DevTools surface: lists runs over the gateway HTTP RPC, lets the
 * caller pick one, and fetches the unfiltered DevTools snapshot for it. The
 * snapshot RPC (`getDevToolsSnapshot`) is not in the typed RPC map, so it is
 * issued via `rpcRaw`.
 */
export function useDevToolsSnapshot(): DevToolsSnapshotState {
  const [runs, setRuns] = useState<DevRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DevToolsSnapshot | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingRuns(true);
    setError(null);
    devGatewayClient()
      .rpcRaw("listRuns", {})
      .then((payload) => {
        if (cancelled) return;
        const rows = Array.isArray(payload) ? payload.map(asRunSummary).filter((run) => run.runId) : [];
        setRuns(rows);
        setSelectedRunId((current) => current ?? rows[0]?.runId ?? null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Failed to list runs.");
        setRuns([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRuns(false);
      });
    return () => {
      cancelled = true;
    };
  }, [generation]);

  useEffect(() => {
    if (!selectedRunId) {
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    setLoadingSnapshot(true);
    setError(null);
    devGatewayClient()
      .rpcRaw("getDevToolsSnapshot", { runId: selectedRunId })
      .then((payload) => {
        if (cancelled) return;
        setSnapshot(parseDevToolsSnapshot(payload));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Failed to load DevTools snapshot.");
        setSnapshot(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingSnapshot(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, generation]);

  const selectRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
  }, []);

  const refresh = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  return {
    runs,
    selectedRunId,
    snapshot,
    loadingRuns,
    loadingSnapshot,
    error,
    selectRun,
    refresh,
  };
}
