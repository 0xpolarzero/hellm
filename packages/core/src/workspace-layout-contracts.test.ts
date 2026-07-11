import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import {
  decodeUnknownWorkspaceChromeReadModelExit,
  decodeUnknownWorkspaceLayoutReadModelExit,
  encodeWorkspaceChromeReadModelExit,
  encodeWorkspaceLayoutReadModelExit,
} from "./workspace-layout-contracts";

const updatedAt = "2026-07-11T10:00:00.000Z";
const localState = {
  scroll: { transcriptAnchorId: "message-anchor", offsetPx: -18.25 },
  timelineDensity: "comfortable",
} as const;

const targets = [
  {
    surface: "orchestrator",
    workspaceSessionId: "session-layout",
    surfacePiSessionId: "surface-orchestrator",
  },
  {
    surface: "handler",
    workspaceSessionId: "session-layout",
    surfacePiSessionId: "surface-handler",
    threadId: "thread-layout",
  },
  {
    surface: "command",
    workspaceSessionId: "session-layout",
    commandId: "command-layout",
  },
  {
    surface: "workflow-task-attempt",
    workspaceSessionId: "session-layout",
    workflowTaskAttemptId: "workflow-task-attempt-layout",
  },
  {
    surface: "artifact",
    workspaceSessionId: "session-layout",
    artifactId: "artifact-layout",
  },
  { surface: "workflows" },
  {
    surface: "agents",
    targetAgentProfileId: "agent-layout",
    view: "generated-context-preview",
  },
  {
    surface: "extensions",
    targetExtensionId: "extension-layout",
    view: "inventory",
  },
  { surface: "snippets" },
  { surface: "settings" },
  { surface: "app-logs", workspaceSessionId: "session-layout" },
  { surface: "open-workspace" },
] as const;

const placements = [
  {
    kind: "split",
    referencePanelId: "pane-orchestrator",
    direction: "right",
    size: 480.5,
  },
  { kind: "tab", groupId: "group-layout", index: 2 },
  { kind: "edge", direction: "left", size: 280.25 },
  { kind: "floating", box: { x: -20.5, y: 15.25, width: 900, height: 620 } },
  { kind: "popout", box: { left: -1440, top: 32.5, width: 1100, height: 780 } },
] as const;

const panes = targets.map((target, index) => ({
  paneId: `pane-${index}`,
  target,
  localState: index === 0 ? localState : { scroll: null, timelineDensity: "compact" as const },
  fallbackChrome:
    index === targets.length - 1
      ? { title: "Open Workspace", subtitle: "Choose a folder", kind: "open-workspace" as const }
      : null,
  placement: placements[index % placements.length]!,
  restore:
    index === targets.length - 1
      ? {
          kind: "unavailable" as const,
          reason: "The previous folder is no longer available.",
          lastKnownLocationLabel: "Tab group 2",
        }
      : { kind: "ready" as const },
}));

const layoutReadModel = {
  workspaceId: "workspace-layout",
  slots: [
    {
      workspaceId: "workspace-layout",
      layoutId: "A",
      initialized: true,
      dockviewJson: { grid: { root: null }, floatingGroups: [], popoutGroups: [] },
      panes,
      compactSurfaces: [
        {
          kind: "compact-thread",
          workspaceSessionId: "session-layout",
          threadId: "thread-layout",
          panelId: "pane-1",
          density: "compact",
        },
      ],
      focusedPaneId: "pane-0",
      updatedAt,
    },
    {
      workspaceId: "workspace-layout",
      layoutId: "B",
      initialized: false,
      dockviewJson: null,
      panes: [],
      compactSurfaces: [],
      focusedPaneId: null,
      updatedAt,
    },
    {
      workspaceId: "workspace-layout",
      layoutId: "C",
      initialized: false,
      dockviewJson: null,
      panes: [],
      compactSurfaces: [],
      focusedPaneId: null,
      updatedAt,
    },
  ],
} as const;

describe("workspace chrome and layout renderer contracts", () => {
  it("round-trips exact app-global tab identity without version or branch fields", () => {
    const chrome = {
      activeWorkspaceTabId: "workspace-tab-layout",
      tabs: [
        {
          workspaceTabId: "workspace-tab-layout",
          workspaceId: "workspace-layout",
          cwd: "/tmp/workspace-layout",
          workspaceLabel: "Workspace Layout",
          kind: "user",
          openedAt: updatedAt,
          activeLayoutId: "B",
        },
      ],
      knownWorkspaces: [
        {
          workspaceTabId: "workspace-tab-default",
          workspaceId: "workspace-default",
          cwd: "/tmp/svvy-default",
          workspaceLabel: "Default Workspace",
          kind: "default",
          openedAt: updatedAt,
          activeLayoutId: "A",
        },
      ],
    } as const;
    const decoded = decodeUnknownWorkspaceChromeReadModelExit(chrome);

    expect(Exit.isSuccess(decoded)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(encodeWorkspaceChromeReadModelExit(decoded.value)).toEqual(decoded);
    }
    expect(
      Exit.isFailure(
        decodeUnknownWorkspaceChromeReadModelExit({
          ...chrome,
          version: 4,
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownWorkspaceChromeReadModelExit({
          ...chrome,
          activeWorkspaceTabId: "workspace-tab-missing",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownWorkspaceChromeReadModelExit({
          ...chrome,
          tabs: [...chrome.tabs, chrome.tabs[0]],
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownWorkspaceChromeReadModelExit({
          ...chrome,
          tabs: chrome.tabs.map((tab) => ({ ...tab, branch: "main" })),
        }),
      ),
    ).toBe(true);
  });

  it("round-trips every pane target, placement, local-state, fallback, and compact surface", () => {
    const decoded = decodeUnknownWorkspaceLayoutReadModelExit(layoutReadModel);

    expect(Exit.isSuccess(decoded)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(encodeWorkspaceLayoutReadModelExit(decoded.value)).toEqual(decoded);
      expect(decoded.value.slots[0]?.panes.map((pane) => pane.target.surface)).toEqual(
        targets.map((target) => target.surface),
      );
      expect(decoded.value.slots[0]?.panes.map((pane) => pane.placement?.kind)).toEqual(
        panes.map((pane) => pane.placement.kind),
      );
      const splitPlacement = decoded.value.slots[0]?.panes[0]?.placement;
      expect(splitPlacement).toMatchObject({
        kind: "split",
        referencePanelId: "pane-orchestrator",
      });
      expect(
        decoded.value.slots[0]?.panes.some((pane) => pane.paneId === "pane-orchestrator"),
      ).toBe(false);
    }
  });

  it("rejects non-JSON Dockview data, non-finite values, non-positive boxes, and target loss", () => {
    const slot = layoutReadModel.slots[0]!;
    const invalidDockview = {
      ...layoutReadModel,
      slots: [{ ...slot, dockviewJson: { callback: undefined } }],
    };
    const nonFiniteScroll = {
      ...layoutReadModel,
      slots: [
        {
          ...slot,
          panes: slot.panes.map((pane, index) =>
            index === 0
              ? {
                  ...pane,
                  localState: {
                    ...pane.localState,
                    scroll: { transcriptAnchorId: null, offsetPx: NaN },
                  },
                }
              : pane,
          ),
        },
      ],
    };
    const emptyFloatingWidth = {
      ...layoutReadModel,
      slots: [
        {
          ...slot,
          panes: slot.panes.map((pane, index) =>
            index === 0
              ? {
                  ...pane,
                  placement: {
                    kind: "floating",
                    box: { x: 0, y: 0, width: 0, height: 100 },
                  },
                }
              : pane,
          ),
        },
      ],
    };
    const targetlessUnavailable = {
      ...layoutReadModel,
      slots: [
        {
          ...slot,
          panes: slot.panes.map((pane, index) => {
            if (index !== targets.length - 1) return pane;
            const { target: _target, ...withoutTarget } = pane;
            return withoutTarget;
          }),
        },
      ],
    };
    const duplicatePane = {
      ...layoutReadModel,
      slots: [
        { ...slot, panes: [...slot.panes, slot.panes[0]] },
        ...layoutReadModel.slots.slice(1),
      ],
    };
    const missingFocusedPane = {
      ...layoutReadModel,
      slots: [{ ...slot, focusedPaneId: "pane-missing" }, ...layoutReadModel.slots.slice(1)],
    };
    const missingCompactPanel = {
      ...layoutReadModel,
      slots: [
        {
          ...slot,
          compactSurfaces: slot.compactSurfaces.map((surface) => ({
            ...surface,
            panelId: "pane-missing",
          })),
        },
        ...layoutReadModel.slots.slice(1),
      ],
    };
    const missingSlot = { ...layoutReadModel, slots: layoutReadModel.slots.slice(0, 2) };

    expect(Exit.isFailure(decodeUnknownWorkspaceLayoutReadModelExit(invalidDockview))).toBe(true);
    expect(Exit.isFailure(decodeUnknownWorkspaceLayoutReadModelExit(nonFiniteScroll))).toBe(true);
    expect(Exit.isFailure(decodeUnknownWorkspaceLayoutReadModelExit(emptyFloatingWidth))).toBe(
      true,
    );
    expect(Exit.isFailure(decodeUnknownWorkspaceLayoutReadModelExit(targetlessUnavailable))).toBe(
      true,
    );
    expect(Exit.isFailure(decodeUnknownWorkspaceLayoutReadModelExit(duplicatePane))).toBe(true);
    expect(Exit.isFailure(decodeUnknownWorkspaceLayoutReadModelExit(missingFocusedPane))).toBe(
      true,
    );
    expect(Exit.isFailure(decodeUnknownWorkspaceLayoutReadModelExit(missingCompactPanel))).toBe(
      true,
    );
    expect(Exit.isFailure(decodeUnknownWorkspaceLayoutReadModelExit(missingSlot))).toBe(true);
  });
});
