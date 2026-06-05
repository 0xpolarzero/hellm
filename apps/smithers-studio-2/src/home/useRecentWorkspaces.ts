import { useCallback, useEffect, useState } from "react";
import {
  listLocalWorkspaces,
  openLocalWorkspace,
  removeLocalWorkspace,
  type WorkspaceLocalRecent,
} from "../workspaceApi";

export type RecentWorkspacesState = {
  recents: WorkspaceLocalRecent[];
  loading: boolean;
  connected: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  open: (path: string) => Promise<boolean>;
  remove: (path: string) => Promise<void>;
};

/**
 * Raw TypeErrors from reading fields off an undefined payload (e.g. the gateway
 * answered with no body, so `payload.recents` blows up) must never reach the UI
 * as "Cannot read properties of undefined". We translate those structural faults
 * into a single human connection message and let Home render its connect panel.
 */
const CONNECTION_MESSAGE = "Could not reach the workspace gateway.";

function isStructuralFault(error: unknown): boolean {
  return error instanceof TypeError;
}

function toConnectionMessage(error: unknown): string {
  if (isStructuralFault(error)) {
    return CONNECTION_MESSAGE;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() ? message : CONNECTION_MESSAGE;
}

function normalizeRecents(value: unknown): WorkspaceLocalRecent[] {
  return Array.isArray(value) ? (value as WorkspaceLocalRecent[]) : [];
}

/**
 * Loads the recent local workspaces over the workspace HTTP API. `connected`
 * is false when the workspace backend is unreachable OR answers with a payload
 * we can't read, which Home uses to show the boot/connect panel instead of an
 * empty recents list. It never surfaces a raw TypeError.
 */
export function useRecentWorkspaces(): RecentWorkspacesState {
  const [recents, setRecents] = useState<WorkspaceLocalRecent[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listLocalWorkspaces();
      setRecents(normalizeRecents(next));
      setConnected(true);
    } catch (caught) {
      setRecents([]);
      setConnected(false);
      setError(toConnectionMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const open = useCallback(async (path: string) => {
    try {
      await openLocalWorkspace(path);
      return true;
    } catch (caught) {
      setError(toConnectionMessage(caught));
      return false;
    }
  }, []);

  const remove = useCallback(async (path: string) => {
    try {
      const next = await removeLocalWorkspace(path);
      setRecents(normalizeRecents(next));
    } catch (caught) {
      setError(toConnectionMessage(caught));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { recents, loading, connected, error, refresh, open, remove };
}
