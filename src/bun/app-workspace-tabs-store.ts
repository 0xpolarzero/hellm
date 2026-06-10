import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppWorkspaceTabsState, WorkspaceTabInfo } from "../shared/workspace-contract";

const APP_WORKSPACE_TABS_FILENAME = "app-workspace-tabs.json";

export type AppWorkspaceTabsStore = {
  getState(): AppWorkspaceTabsState | null;
  setState(state: AppWorkspaceTabsState): AppWorkspaceTabsState;
  getPath(): string;
};

export function createAppWorkspaceTabsStore(input: { agentDir: string }): AppWorkspaceTabsStore {
  const statePath = join(input.agentDir, APP_WORKSPACE_TABS_FILENAME);

  const readState = (): AppWorkspaceTabsState | null => {
    if (!existsSync(statePath)) return null;
    return parseAppWorkspaceTabsState(JSON.parse(readFileSync(statePath, "utf8")));
  };

  const writeState = (state: AppWorkspaceTabsState): AppWorkspaceTabsState => {
    const normalized = parseAppWorkspaceTabsState(state);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(normalized, null, 2)}\n`);
    return normalized;
  };

  return {
    getState: readState,
    setState: writeState,
    getPath: () => statePath,
  };
}

function parseAppWorkspaceTabsState(input: unknown): AppWorkspaceTabsState {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid app workspace tabs state: expected an object.");
  }
  const raw = input as Partial<AppWorkspaceTabsState>;
  if (raw.version !== 4 || !Array.isArray(raw.tabs) || !Array.isArray(raw.knownWorkspaces)) {
    throw new Error(
      "Invalid app workspace tabs state: expected version 4 tabs and knownWorkspaces.",
    );
  }
  if (raw.activeWorkspaceTabId !== null && typeof raw.activeWorkspaceTabId !== "string") {
    throw new Error(
      "Invalid app workspace tabs state: activeWorkspaceTabId must be a string or null.",
    );
  }

  const tabs = raw.tabs.map((tab, index) => parseWorkspaceTab(tab, `tabs[${index}]`));
  const knownWorkspaces = raw.knownWorkspaces.map((tab, index) =>
    parseWorkspaceTab(tab, `knownWorkspaces[${index}]`),
  );
  const activeWorkspaceTabId =
    typeof raw.activeWorkspaceTabId === "string" &&
    tabs.some((tab) => tab.workspaceTabId === raw.activeWorkspaceTabId)
      ? raw.activeWorkspaceTabId
      : null;

  return {
    version: 4,
    activeWorkspaceTabId,
    tabs,
    knownWorkspaces,
  };
}

function parseWorkspaceTab(input: unknown, path: string): WorkspaceTabInfo {
  if (!input || typeof input !== "object") {
    throw new Error(`Invalid app workspace tabs state: ${path} must be an object.`);
  }
  const raw = input as Partial<WorkspaceTabInfo>;
  if (
    typeof raw.workspaceId !== "string" ||
    typeof raw.workspaceTabId !== "string" ||
    !raw.workspaceTabId.trim() ||
    typeof raw.cwd !== "string" ||
    typeof raw.workspaceLabel !== "string" ||
    (raw.kind !== "default" && raw.kind !== "user") ||
    typeof raw.openedAt !== "string"
  ) {
    throw new Error(
      `Invalid app workspace tabs state: ${path} is missing required workspace tab fields.`,
    );
  }
  const activeLayoutId =
    raw.kind === "user" &&
    (raw.activeLayoutId === "A" || raw.activeLayoutId === "B" || raw.activeLayoutId === "C")
      ? raw.activeLayoutId
      : undefined;
  return {
    workspaceTabId: raw.workspaceTabId,
    workspaceId: raw.workspaceId,
    cwd: raw.cwd,
    workspaceLabel: raw.workspaceLabel,
    kind: raw.kind,
    openedAt: raw.openedAt,
    ...(typeof raw.branch === "string" ? { branch: raw.branch } : {}),
    ...(activeLayoutId ? { activeLayoutId } : {}),
  };
}
