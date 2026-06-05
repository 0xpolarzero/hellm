import { useCallback, useEffect, useState } from "react";
import type { WorkflowSegment } from "./WorkflowSegment";
import type { WorkflowEntry } from "./workflowsApi";
import {
  listLocalWorkflows,
  listRemoteWorkflows,
  listPromptWorkflows,
  listScheduleWorkflows,
} from "./workflowsApi";

export type WorkflowListState = {
  entries: WorkflowEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const LOADERS: Record<WorkflowSegment, () => Promise<WorkflowEntry[]>> = {
  local: listLocalWorkflows,
  remote: listRemoteWorkflows,
  prompts: listPromptWorkflows,
  schedules: listScheduleWorkflows,
};

/**
 * Loads the entries for one segment over the workspace HTTP API and reloads when
 * the active segment changes. Errors are surfaced as a single message string so
 * the surface can show an inline error row rather than crashing on a bad payload.
 */
export function useWorkflowList(segment: WorkflowSegment): WorkflowListState {
  const [entries, setEntries] = useState<WorkflowEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await LOADERS[segment]();
      setEntries(Array.isArray(next) ? next : []);
    } catch (caught) {
      setEntries([]);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [segment]);

  // Auto-load on segment change with a cancellation guard (mirrors
  // useWorkflowDetail) so a slow in-flight load for the previous segment cannot
  // land its entries after the user has switched segments. We inline the load
  // here rather than calling `refresh` so the guard can suppress the stale
  // state writes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    LOADERS[segment]()
      .then((next) => {
        if (cancelled) return;
        setEntries(Array.isArray(next) ? next : []);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setEntries([]);
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [segment]);

  return { entries, loading, error, refresh };
}
