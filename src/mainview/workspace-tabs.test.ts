import { describe, expect, it } from "bun:test";
import {
  formatWorkspaceTabAriaLabel,
  getVisibleWorkspaceTabCounts,
  reorderWorkspaceTabs,
  summarizeWorkspaceTabCounts,
  type WorkspaceTabCounts,
} from "./workspace-tabs";

const workspace = { workspaceLabel: "svvy" };

type WorkspaceTabFixture = {
  workspace: {
    workspaceTabId: string;
    workspaceId: string;
    cwd: string;
    workspaceLabel: string;
    kind: "default" | "user";
  };
};

const ids = (items: readonly WorkspaceTabFixture[]): string[] =>
  items.map((tab) => tab.workspace.workspaceTabId);

describe("workspace tab counts", () => {
  it("hides zero counts", () => {
    const counts: WorkspaceTabCounts = {
      running: 0,
      unread: 0,
      waiting: 0,
      warning: 0,
      error: 0,
    };

    expect(getVisibleWorkspaceTabCounts(counts)).toEqual([]);
    expect(formatWorkspaceTabAriaLabel(workspace, counts)).toBe("svvy");
  });

  it("shows positive counts as number-only status badges in stable order", () => {
    const counts: WorkspaceTabCounts = {
      running: 2,
      unread: 5,
      waiting: 1,
      warning: 4,
      error: 3,
    };

    expect(getVisibleWorkspaceTabCounts(counts)).toEqual([
      { kind: "running", value: 2, label: "running" },
      { kind: "unread", value: 5, label: "unread" },
      { kind: "waiting", value: 1, label: "waiting" },
      { kind: "warning", value: 4, label: "warnings" },
      { kind: "error", value: 3, label: "errors" },
    ]);
    expect(formatWorkspaceTabAriaLabel(workspace, counts)).toBe(
      "svvy. 2 running, 5 unread, 1 waiting, 4 warnings, 3 errors",
    );
  });

  it("formats default workspace status badges like normal workspace tabs", () => {
    const counts: WorkspaceTabCounts = {
      running: 1,
      unread: 0,
      waiting: 2,
      warning: 0,
      error: 1,
    };

    expect(formatWorkspaceTabAriaLabel({ workspaceLabel: "Default Workspace" }, counts)).toBe(
      "Default Workspace. 1 running, 2 waiting, 1 errors",
    );
  });

  it("summarizes session state and unread app log warnings and errors", () => {
    expect(
      summarizeWorkspaceTabCounts({
        sessions: [
          {
            status: "running",
            isUnread: true,
            threadIdsByStatus: {
              waiting: ["thread-waiting"],
              troubleshooting: ["thread-troubleshooting"],
              runningHandler: ["thread-handler"],
              runningWorkflow: ["thread-workflow"],
            },
          },
          {
            status: "error",
            isUnread: false,
            threadIdsByStatus: {
              waiting: [],
              troubleshooting: [],
              runningHandler: [],
              runningWorkflow: [],
            },
          },
        ],
        appLogSummary: {
          unread: { total: 5, debug: 0, info: 1, warn: 2, error: 2 },
        },
      }),
    ).toEqual({
      running: 3,
      unread: 1,
      waiting: 1,
      warning: 2,
      error: 4,
    });
  });
});

describe("workspace tab reorder", () => {
  const tabs: WorkspaceTabFixture[] = [
    {
      workspace: {
        workspaceTabId: "tab-a",
        workspaceId: "same-runtime",
        cwd: "/same",
        workspaceLabel: "same",
        kind: "user",
      },
    },
    {
      workspace: {
        workspaceTabId: "tab-b",
        workspaceId: "same-runtime",
        cwd: "/same",
        workspaceLabel: "same",
        kind: "user",
      },
    },
    {
      workspace: {
        workspaceTabId: "tab-c",
        workspaceId: "other-runtime",
        cwd: "/other",
        workspaceLabel: "other",
        kind: "user",
      },
    },
  ];

  it("moves a later tab before an earlier tab", () => {
    expect(ids(reorderWorkspaceTabs(tabs, "tab-c", "tab-a"))).toEqual(["tab-c", "tab-a", "tab-b"]);
  });

  it("moves an earlier tab before a later tab", () => {
    expect(ids(reorderWorkspaceTabs(tabs, "tab-a", "tab-c"))).toEqual(["tab-b", "tab-a", "tab-c"]);
  });

  it("moves a tab to the end when no target is provided", () => {
    expect(ids(reorderWorkspaceTabs(tabs, "tab-a", null))).toEqual(["tab-b", "tab-c", "tab-a"]);
  });

  it("keeps order when ids are missing or unchanged", () => {
    expect(ids(reorderWorkspaceTabs(tabs, "tab-a", "tab-a"))).toEqual(["tab-a", "tab-b", "tab-c"]);
    expect(ids(reorderWorkspaceTabs(tabs, "missing", "tab-a"))).toEqual([
      "tab-a",
      "tab-b",
      "tab-c",
    ]);
    expect(ids(reorderWorkspaceTabs(tabs, "tab-a", "missing"))).toEqual([
      "tab-b",
      "tab-c",
      "tab-a",
    ]);
  });

  it("does not collapse duplicate visual tabs that share a runtime id", () => {
    expect(ids(reorderWorkspaceTabs(tabs, "tab-b", "tab-a"))).toEqual(["tab-b", "tab-a", "tab-c"]);
    expect(
      reorderWorkspaceTabs(tabs, "tab-b", "tab-a").map((tab) => tab.workspace.workspaceId),
    ).toEqual(["same-runtime", "same-runtime", "other-runtime"]);
  });
});
