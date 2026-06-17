import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAppWorkspaceTabsStore } from "./app-workspace-tabs-store";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("app workspace tabs store", () => {
  it("persists open workspace tabs across store instances", () => {
    const agentDir = tempAgentDir();
    const store = createAppWorkspaceTabsStore({ agentDir });

    store.setState({
      version: 4,
      activeWorkspaceTabId: "tab-b",
      tabs: [
        {
          workspaceTabId: "tab-a",
          workspaceId: "workspace-a",
          cwd: "/tmp/workspace-a",
          workspaceLabel: "workspace-a",
          kind: "user",
          openedAt: "2026-05-15T12:00:00.000Z",
          activeLayoutId: "A",
        },
        {
          workspaceTabId: "tab-b",
          workspaceId: "workspace-b",
          cwd: "/tmp/workspace-b",
          workspaceLabel: "workspace-b",
          kind: "user",
          openedAt: "2026-05-15T12:01:00.000Z",
          activeLayoutId: "B",
        },
      ],
      knownWorkspaces: [
        {
          workspaceTabId: "known-tab-a",
          workspaceId: "workspace-a",
          cwd: "/tmp/workspace-a",
          workspaceLabel: "workspace-a",
          kind: "user",
          openedAt: "2026-05-15T12:00:00.000Z",
        },
      ],
    });

    const reloaded = createAppWorkspaceTabsStore({ agentDir });

    expect(reloaded.getState()?.tabs.map((tab) => tab.cwd)).toEqual([
      "/tmp/workspace-a",
      "/tmp/workspace-b",
    ]);
    expect(reloaded.getState()?.tabs.map((tab) => tab.workspaceTabId)).toEqual(["tab-a", "tab-b"]);
    expect(reloaded.getState()?.tabs.map((tab) => tab.kind)).toEqual(["user", "user"]);
    expect(reloaded.getState()?.tabs.map((tab) => tab.activeLayoutId)).toEqual(["A", "B"]);
    expect(reloaded.getState()?.activeWorkspaceTabId).toBe("tab-b");
  });

  it("preserves duplicate visual tabs that share one workspace runtime", () => {
    const store = createAppWorkspaceTabsStore({ agentDir: tempAgentDir() });

    const state = store.setState({
      version: 4,
      activeWorkspaceTabId: "tab-2",
      tabs: [
        {
          workspaceTabId: "tab-1",
          workspaceId: "repo-runtime",
          cwd: "/tmp/repo",
          workspaceLabel: "repo",
          kind: "user",
          openedAt: "2026-05-15T12:00:00.000Z",
          activeLayoutId: "A",
        },
        {
          workspaceTabId: "tab-2",
          workspaceId: "repo-runtime",
          cwd: "/tmp/repo",
          workspaceLabel: "repo",
          kind: "user",
          openedAt: "2026-05-15T12:01:00.000Z",
          activeLayoutId: "C",
        },
      ],
      knownWorkspaces: [],
    });

    expect(state.tabs.map((tab) => tab.workspaceTabId)).toEqual(["tab-1", "tab-2"]);
    expect(new Set(state.tabs.map((tab) => tab.workspaceId))).toEqual(new Set(["repo-runtime"]));
    expect(state.tabs.map((tab) => tab.activeLayoutId)).toEqual(["A", "C"]);
    expect(state.activeWorkspaceTabId).toBe("tab-2");
  });

  it("keys active tab restore by workspaceTabId rather than shared workspaceId", () => {
    const store = createAppWorkspaceTabsStore({ agentDir: tempAgentDir() });

    const state = store.setState({
      version: 4,
      activeWorkspaceTabId: "tab-2",
      tabs: [
        {
          workspaceTabId: "tab-1",
          workspaceId: "shared-runtime",
          cwd: "/tmp/repo",
          workspaceLabel: "repo",
          kind: "user",
          openedAt: "2026-05-15T12:00:00.000Z",
        },
        {
          workspaceTabId: "tab-2",
          workspaceId: "shared-runtime",
          cwd: "/tmp/repo",
          workspaceLabel: "repo",
          kind: "user",
          openedAt: "2026-05-15T12:01:00.000Z",
        },
      ],
      knownWorkspaces: [],
    });

    expect(state.activeWorkspaceTabId).toBe("tab-2");
    expect(state.tabs.filter((tab) => tab.workspaceId === "shared-runtime")).toHaveLength(2);
  });

  it("stores default workspace tabs as real tabs with selected layout slots", () => {
    const store = createAppWorkspaceTabsStore({ agentDir: tempAgentDir() });

    const state = store.setState({
      version: 4,
      activeWorkspaceTabId: "default-tab",
      tabs: [
        {
          workspaceTabId: "default-tab",
          workspaceId: "default-runtime",
          cwd: "/tmp/svvy/default-workspace",
          workspaceLabel: "Default Workspace",
          kind: "default",
          openedAt: "2026-05-15T12:00:00.000Z",
          activeLayoutId: "A",
        },
      ],
      knownWorkspaces: [],
    });

    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({
      workspaceTabId: "default-tab",
      workspaceId: "default-runtime",
      workspaceLabel: "Default Workspace",
      kind: "default",
    });
    expect(state.tabs[0]?.activeLayoutId).toBe("A");
  });

  it("drops an active workspace tab id that is not in the open tab list", () => {
    const store = createAppWorkspaceTabsStore({ agentDir: tempAgentDir() });

    const state = store.setState({
      version: 4,
      activeWorkspaceTabId: "missing",
      tabs: [],
      knownWorkspaces: [],
    });

    expect(state.activeWorkspaceTabId).toBeNull();
  });

  it("throws on malformed v4 tabs instead of repairing missing tab identity", () => {
    const store = createAppWorkspaceTabsStore({ agentDir: tempAgentDir() });

    expect(() =>
      store.setState({
        version: 4,
        activeWorkspaceTabId: "workspace-a",
        tabs: [
          {
            workspaceId: "workspace-a",
            cwd: "/tmp/workspace-a",
            workspaceLabel: "workspace-a",
            kind: "user",
            openedAt: "2026-05-15T12:00:00.000Z",
          },
        ],
        knownWorkspaces: [],
      } as never),
    ).toThrow("tabs[0] is missing required workspace tab fields");
  });
});

function tempAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "svvy-app-tabs-"));
  tempDirs.push(dir);
  return dir;
}
