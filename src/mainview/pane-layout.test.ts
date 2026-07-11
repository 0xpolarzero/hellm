import { describe, expect, it } from "bun:test";
import type { SerializedDockview } from "dockview-core";
import {
  bindPane,
  createPanelChrome,
  createEmptyPaneLayout,
  getDockviewTabGroupPlacementTargets,
  getOpenPaneLocations,
  getSidebarPaneOpenTarget,
  getSidebarSessionOpenTarget,
  normalizePaneLayout,
  removeDockviewPanel,
  setPaneScroll,
  splitPane,
  markDockviewPanelUnavailable,
} from "./pane-layout";

describe("getSidebarSessionOpenTarget", () => {
  it("opens normal sidebar session clicks in the focused pane", () => {
    expect(getSidebarSessionOpenTarget({ metaKey: false })).toEqual({
      kind: "focused-panel",
    });
  });

  it("opens command-clicked sidebar sessions in a new right pane", () => {
    expect(getSidebarSessionOpenTarget({ metaKey: true })).toEqual({
      kind: "new-panel",
      direction: "right",
    });
  });
});

describe("getSidebarPaneOpenTarget", () => {
  it("opens normal sidebar pane clicks in the focused pane", () => {
    expect(getSidebarPaneOpenTarget({ metaKey: false })).toEqual({
      kind: "focused-panel",
    });
  });

  it("opens command-clicked sidebar panes in a new right pane", () => {
    expect(getSidebarPaneOpenTarget({ metaKey: true })).toEqual({
      kind: "new-panel",
      direction: "right",
    });
  });
});

describe("createPanelChrome", () => {
  it("labels library panes with the current sidebar names", () => {
    expect(createPanelChrome({ surface: "workflows" })).toMatchObject({
      title: "Workflows",
      kind: "workflows",
    });
    expect(createPanelChrome({ surface: "agents" })).toMatchObject({
      title: "Agents",
      kind: "agents",
    });
    expect(
      createPanelChrome({ surface: "agents", targetAgentProfileId: "reviewer" }),
    ).toMatchObject({
      title: "Agents",
      kind: "agents",
    });
    expect(createPanelChrome({ surface: "extensions" })).toMatchObject({
      title: "Extensions",
      kind: "extensions",
    });
    expect(createPanelChrome({ surface: "snippets" })).toMatchObject({
      title: "Snippets",
      kind: "snippets",
    });
    expect(createPanelChrome({ surface: "settings" })).toMatchObject({
      title: "Settings",
      kind: "settings",
    });
  });

  it("keys artifact inspector chrome by durable artifact id", () => {
    expect(
      createPanelChrome({
        surface: "artifact",
        workspaceSessionId: "session-1",
        artifactId: "artifact_123",
      }),
    ).toMatchObject({
      title: "Artifact",
      subtitle: "artifact_123",
      kind: "artifact",
      closable: true,
    });
  });
});

describe("normalizePaneLayout", () => {
  it("drops removed prompt library pane bindings from restored layouts", () => {
    const normalized = normalizePaneLayout({
      dockview: null,
      panels: [
        {
          panelId: "old-context",
          binding: { surface: "prompt-library" },
          localState: null,
        },
        {
          panelId: "logs",
          binding: { surface: "app-logs" },
          localState: null,
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "old-context",
      updatedAt: "2026-06-09T00:00:00.000Z",
    } as unknown as Parameters<typeof normalizePaneLayout>[0]);

    expect(normalized.panels.map((panel) => panel.panelId)).toEqual(["logs"]);
    expect(normalized.focusedPanelId).toBe("logs");
  });

  it("preserves focused extension inventory targets in restored layouts", () => {
    const normalized = normalizePaneLayout({
      dockview: null,
      panels: [
        {
          panelId: "extensions",
          binding: {
            surface: "extensions",
            view: "inventory",
            targetExtensionId: "smithers",
          },
          localState: null,
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "extensions",
      updatedAt: "2026-06-09T00:00:00.000Z",
    } as unknown as Parameters<typeof normalizePaneLayout>[0]);

    expect(normalized.panels[0]?.binding).toEqual({
      surface: "extensions",
      view: "inventory",
      targetExtensionId: "smithers",
    });
  });

  it("preserves valid compact thread surfaces and drops malformed or obsolete compact restore records", () => {
    const normalized = normalizePaneLayout({
      dockview: null,
      panels: [
        {
          panelId: "primary",
          binding: {
            surface: "orchestrator",
            workspaceSessionId: "session-1",
            surfacePiSessionId: "session-1",
          },
          localState: null,
        },
      ],
      compactSurfaces: [
        {
          kind: "compact-thread",
          workspaceSessionId: "session-1",
          threadId: "thread-1",
          panelId: "primary",
          density: "compact",
        },
        {
          kind: "compact-thread",
          workspaceSessionId: "session-1",
          panelId: null,
          density: "comfortable",
        },
        {
          kind: "compact-workflow-run",
          workspaceSessionId: "session-1",
          threadId: "thread-1",
          workflowRunId: "",
          panelId: null,
          density: "comfortable",
        },
        {
          kind: "compact-thread",
          workspaceSessionId: "session-1",
          threadId: "thread-2",
          panelId: null,
          density: "tiny",
        },
      ],
      focusedPanelId: "primary",
      updatedAt: "2026-06-09T00:00:00.000Z",
    } as unknown as Parameters<typeof normalizePaneLayout>[0]);

    expect(normalized.compactSurfaces).toEqual([
      {
        kind: "compact-thread",
        workspaceSessionId: "session-1",
        threadId: "thread-1",
        panelId: "primary",
        density: "compact",
      },
    ]);
  });

  it("detaches compact surfaces when normalization drops their referenced pane", () => {
    const normalized = normalizePaneLayout({
      dockview: null,
      panels: [
        {
          panelId: "invalid",
          binding: { surface: "orchestrator", workspaceSessionId: "session-1" } as never,
          localState: null,
        },
      ],
      compactSurfaces: [
        {
          kind: "compact-thread",
          workspaceSessionId: "session-1",
          threadId: "thread-1",
          panelId: "invalid",
          density: "compact",
        },
      ],
      focusedPanelId: "invalid",
      updatedAt: "2026-06-09T00:00:00.000Z",
    } as unknown as Parameters<typeof normalizePaneLayout>[0]);

    expect(normalized.panels).toEqual([]);
    expect(normalized.compactSurfaces).toEqual([
      {
        kind: "compact-thread",
        workspaceSessionId: "session-1",
        threadId: "thread-1",
        panelId: null,
        density: "compact",
      },
    ]);
  });
});

describe("pane layout normalization", () => {
  it("represents no panes without creating a visible empty pane", () => {
    expect(createEmptyPaneLayout()).toMatchObject({
      panels: [],
      focusedPanelId: null,
      dockview: null,
    });
  });

  it("drops restored panes without a surface binding", () => {
    const layout = normalizePaneLayout({
      dockview: null,
      panels: [
        {
          panelId: "empty",
          binding: null,
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "logs",
          binding: { surface: "app-logs" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "empty",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });

    expect(layout.panels.map((panel) => panel.panelId)).toEqual(["logs"]);
    expect(layout.focusedPanelId).toBe("logs");
  });

  it("preserves explicit unavailable restored panels with their durable target", () => {
    const layout = normalizePaneLayout({
      dockview: null,
      panels: [
        {
          panelId: "unavailable",
          binding: {
            workspaceSessionId: "session-1",
            surface: "orchestrator",
            surfacePiSessionId: "session-1",
          },
          localState: {
            scroll: { transcriptAnchorId: "assistant-1", offsetPx: 42 },
            timelineDensity: "compact",
          },
          chrome: {
            title: "Surface unavailable",
            subtitle: "Orchestrator",
            icon: null,
            kind: "unavailable",
            closable: true,
            floatable: true,
            popoutable: false,
          },
          fallbackChrome: {
            title: "Orchestrator",
            subtitle: "session-1",
            kind: "orchestrator",
          },
          restore: {
            unavailableReason: "Missing restored surface.",
            lastKnownLocationLabel: "Floating",
          },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "unavailable",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });

    expect(layout.panels).toHaveLength(1);
    expect(layout.panels[0]).toMatchObject({
      panelId: "unavailable",
      binding: {
        workspaceSessionId: "session-1",
        surface: "orchestrator",
        surfacePiSessionId: "session-1",
      },
      localState: {
        scroll: { transcriptAnchorId: "assistant-1", offsetPx: 42 },
        timelineDensity: "compact",
      },
      chrome: {
        title: "Surface unavailable",
        subtitle: "Orchestrator",
        kind: "unavailable",
      },
      restore: {
        unavailableReason: "Missing restored surface.",
        lastKnownLocationLabel: "Floating",
      },
    });
    expect(layout.focusedPanelId).toBe("unavailable");
  });

  it("marks an existing restored panel unavailable while keeping its durable target", () => {
    const layout = normalizePaneLayout({
      dockview: null,
      panels: [
        {
          panelId: "primary",
          binding: {
            workspaceSessionId: "session-1",
            surface: "orchestrator",
            surfacePiSessionId: "session-1",
          },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "primary",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });

    const unavailable = markDockviewPanelUnavailable(
      layout,
      "primary",
      "Missing fake surface session-1",
    );

    expect(unavailable.panels[0]).toMatchObject({
      panelId: "primary",
      binding: {
        workspaceSessionId: "session-1",
        surface: "orchestrator",
        surfacePiSessionId: "session-1",
      },
      chrome: {
        title: "Surface unavailable",
        subtitle: "Orchestrator",
        kind: "unavailable",
      },
      restore: {
        unavailableReason: "Missing fake surface session-1",
      },
    });
    expect(unavailable.focusedPanelId).toBe("primary");
  });

  it("clears unavailable restore metadata when rebinding a restored panel", () => {
    const unavailable = normalizePaneLayout({
      dockview: null,
      panels: [
        {
          panelId: "primary",
          binding: {
            workspaceSessionId: "session-1",
            surface: "orchestrator",
            surfacePiSessionId: "session-1",
          },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
          chrome: {
            title: "Surface unavailable",
            subtitle: "Orchestrator",
            icon: null,
            kind: "unavailable",
            closable: true,
            floatable: true,
            popoutable: false,
          },
          fallbackChrome: {
            title: "Orchestrator",
            subtitle: "session-1",
            kind: "orchestrator",
          },
          restore: {
            unavailableReason: "Missing fake surface session-1",
            lastKnownLocationLabel: "Floating",
          },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "primary",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });

    const rebound = bindPane(unavailable, "primary", { surface: "app-logs" });

    expect(rebound.panels[0]).toMatchObject({
      panelId: "primary",
      binding: { surface: "app-logs" },
      restore: {
        unavailableReason: null,
        lastKnownLocationLabel: null,
      },
    });
    expect(getOpenPaneLocations(rebound, (binding) => binding.surface === "app-logs")).toEqual([
      {
        paneId: "primary",
        panelId: "primary",
        focused: true,
        kind: "tab",
        label: "Tab",
      },
    ]);
  });

  it("drops restored prompt panes without a valid surface target", () => {
    const layout = normalizePaneLayout({
      dockview: null,
      panels: [
        {
          panelId: "invalid-orchestrator",
          binding: {
            surface: "orchestrator",
            workspaceSessionId: "session-1",
          } as never,
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "invalid-thread",
          binding: {
            surface: "handler",
            workspaceSessionId: "session-1",
            surfacePiSessionId: "thread-session-1",
          } as never,
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "logs",
          binding: { surface: "app-logs" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "invalid-orchestrator",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });

    expect(layout.panels.map((panel) => panel.panelId)).toEqual(["logs"]);
    expect(layout.focusedPanelId).toBe("logs");
  });

  it("preserves focused static pane target records during layout restore", () => {
    const layout = normalizePaneLayout({
      dockview: null,
      panels: [
        {
          panelId: "agents",
          binding: { surface: "agents", targetAgentProfileId: "reviewer" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "settings",
          binding: { surface: "settings" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "agents",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });

    expect(layout.panels[0]?.binding).toEqual({
      surface: "agents",
      targetAgentProfileId: "reviewer",
    });
    expect(layout.panels[1]?.binding).toEqual({
      surface: "settings",
    });
  });

  it("drops serialized Dockview geometry that references panels outside the svvy pane bindings", () => {
    const layout = normalizePaneLayout({
      dockview: {
        grid: { root: { type: "leaf", data: { views: ["logs", "stale"] } } },
        panels: {
          logs: {},
          stale: {},
        },
      } as unknown as SerializedDockview,
      panels: [
        {
          panelId: "logs",
          binding: { surface: "app-logs" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "logs",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });

    expect(layout.dockview).toBeNull();
  });

  it("does not split into an unbound pane", () => {
    const layout = normalizePaneLayout({
      dockview: null,
      panels: [
        {
          panelId: "logs",
          binding: { surface: "app-logs" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "logs",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });

    expect(splitPane(layout, "logs", "right").panels).toHaveLength(1);
    expect(splitPane(layout, "logs", "right", { duplicateBinding: true }).panels).toHaveLength(2);
  });

  it("keeps duplicate panes bound to one surface with independent scroll state", () => {
    const binding = {
      workspaceSessionId: "session-1",
      surface: "orchestrator",
      surfacePiSessionId: "session-1",
    } as const;
    const layout = normalizePaneLayout({
      dockview: null,
      panels: [
        {
          panelId: "primary",
          binding,
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "duplicate",
          binding,
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "primary",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });

    const scrolled = setPaneScroll(layout, "duplicate", {
      transcriptAnchorId: "assistant-42",
      offsetPx: 96,
    });

    expect(scrolled.panels.map((panel) => panel.binding)).toEqual([binding, binding]);
    expect(scrolled.panels.find((panel) => panel.panelId === "primary")?.localState.scroll).toBe(
      null,
    );
    expect(
      scrolled.panels.find((panel) => panel.panelId === "duplicate")?.localState.scroll,
    ).toEqual({
      transcriptAnchorId: "assistant-42",
      offsetPx: 96,
    });
  });

  it("drops serialized Dockview geometry when a pane is removed by runtime state", () => {
    const layout = normalizePaneLayout({
      dockview: {
        grid: { root: { type: "leaf", data: { views: ["primary", "logs"] } } },
        panels: {
          primary: {},
          logs: {},
        },
      } as unknown as SerializedDockview,
      panels: [
        {
          panelId: "primary",
          binding: {
            workspaceSessionId: "session-1",
            surface: "orchestrator",
            surfacePiSessionId: "session-1",
          },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "logs",
          binding: { surface: "app-logs" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "primary",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });

    const next = removeDockviewPanel(layout, "primary");

    expect(next.panels.map((panel) => panel.panelId)).toEqual(["logs"]);
    expect(next.dockview).toBeNull();
    expect(next.focusedPanelId).toBe("logs");
  });

  it("preserves placement kinds for Dockview split, tab, edge, floating, and popout restore", () => {
    const binding = { surface: "app-logs" } as const;
    const layout = normalizePaneLayout({
      panels: [
        {
          panelId: "split",
          binding,
          placement: {
            referencePanelId: "primary",
            direction: "right",
            size: 320,
          } as never,
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "tab",
          binding,
          placement: {
            kind: "tab",
            groupId: "group-1",
            index: 1,
          },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "edge",
          binding,
          placement: {
            kind: "edge",
            direction: "left",
            size: 260,
          },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "floating",
          binding,
          placement: {
            kind: "floating",
            box: { x: 20, y: 40, width: 640, height: 480 },
          },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "popout",
          binding,
          placement: {
            kind: "popout",
            box: { left: 40, top: 80, width: 800, height: 600 },
          },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
      ],
      focusedPanelId: "popout",
    });

    expect(layout.panels.map((panel) => panel.placement)).toEqual([
      { kind: "split", referencePanelId: "primary", direction: "right", size: 320 },
      { kind: "tab", groupId: "group-1", index: 1 },
      { kind: "edge", direction: "left", size: 260 },
      { kind: "floating", box: { x: 20, y: 40, width: 640, height: 480 } },
      { kind: "popout", box: { left: 40, top: 80, width: 800, height: 600 } },
    ]);
  });

  it("uses placement-aware fallback labels before serialized Dockview locations exist", () => {
    const binding = {
      workspaceSessionId: "session-1",
      surface: "orchestrator",
      surfacePiSessionId: "session-1",
    } as const;
    const layout = normalizePaneLayout({
      panels: [
        {
          panelId: "edge",
          binding,
          placement: { kind: "edge", direction: "below" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "floating",
          binding,
          placement: { kind: "floating" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "popout",
          binding,
          placement: { kind: "popout" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "edge",
    });

    expect(getOpenPaneLocations(layout, (target) => target.surface === "orchestrator")).toEqual([
      {
        paneId: "edge",
        panelId: "edge",
        label: "Edge bottom",
        focused: true,
        kind: "edge",
      },
      {
        paneId: "floating",
        panelId: "floating",
        label: "Floating",
        focused: false,
        kind: "floating",
      },
      {
        paneId: "popout",
        panelId: "popout",
        label: "Popout",
        focused: false,
        kind: "popout",
      },
    ]);
  });

  it("labels open pane locations from serialized Dockview tab, floating, popout, and edge groups", () => {
    const sessionBinding = {
      workspaceSessionId: "session-1",
      surface: "orchestrator",
      surfacePiSessionId: "session-1",
    } as const;
    const layout = normalizePaneLayout({
      dockview: {
        grid: {
          root: {
            type: "branch",
            data: [
              { type: "leaf", data: { id: "group-1", views: ["primary", "secondary"] } },
              { type: "leaf", data: { id: "group-2", views: ["logs"] } },
            ],
          },
        },
        panels: {
          primary: {},
          secondary: {},
          logs: {},
          floating: {},
          popout: {},
          edge: {},
        },
        floatingGroups: [{ data: { id: "floating-group", views: ["floating"] } }],
        popoutGroups: [{ data: { id: "popout-group", views: ["popout"] }, position: null }],
        edgeGroups: {
          left: {
            size: 240,
            visible: true,
            group: { id: "edge-group", views: ["edge"] },
          },
        },
      } as unknown as SerializedDockview,
      panels: [
        {
          panelId: "primary",
          binding: sessionBinding,
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "secondary",
          binding: sessionBinding,
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "logs",
          binding: { surface: "app-logs" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "floating",
          binding: sessionBinding,
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "popout",
          binding: sessionBinding,
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "edge",
          binding: sessionBinding,
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "floating",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });

    expect(getOpenPaneLocations(layout, (binding) => binding.surface === "orchestrator")).toEqual([
      {
        paneId: "primary",
        panelId: "primary",
        label: "Tab, tab 1",
        focused: false,
        kind: "tab",
      },
      {
        paneId: "secondary",
        panelId: "secondary",
        label: "Tab, tab 2",
        focused: false,
        kind: "tab",
      },
      {
        paneId: "floating",
        panelId: "floating",
        label: "Floating",
        focused: true,
        kind: "floating",
      },
      {
        paneId: "popout",
        panelId: "popout",
        label: "Popout",
        focused: false,
        kind: "popout",
      },
      {
        paneId: "edge",
        panelId: "edge",
        label: "Edge left",
        focused: false,
        kind: "edge",
      },
    ]);
  });

  it("derives command-safe tab group placement targets from serialized Dockview groups", () => {
    const layout = normalizePaneLayout({
      dockview: {
        grid: {
          root: {
            type: "branch",
            data: [
              { type: "leaf", data: { id: "group-1", views: ["primary", "secondary"] } },
              { type: "leaf", data: { id: "stale-group", views: ["missing-panel"] } },
              { type: "leaf", data: { id: "group-2", views: ["logs"] } },
            ],
          },
        },
        panels: {
          primary: {},
          secondary: {},
          logs: {},
        },
      } as unknown as SerializedDockview,
      panels: [
        {
          panelId: "primary",
          binding: { surface: "app-logs" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "secondary",
          binding: { surface: "settings" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
        {
          panelId: "logs",
          binding: { surface: "app-logs" },
          localState: {
            scroll: null,
            timelineDensity: "comfortable",
          },
        },
      ],
      compactSurfaces: [],
      focusedPanelId: "primary",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });

    expect(getDockviewTabGroupPlacementTargets(layout)).toEqual([
      {
        groupId: "group-1",
        label: "Tab",
        panelIds: ["primary", "secondary"],
      },
      {
        groupId: "group-2",
        label: "Tab group 2",
        panelIds: ["logs"],
      },
    ]);
  });
});

describe("pane layout source contracts", () => {
  it("wires panel-location indicators and Dockview duplicate controls through current pane state", async () => {
    const sessionListSource = await Bun.file(
      new URL("./SessionListItem.svelte", import.meta.url),
    ).text();
    const sessionSidebarSource = await Bun.file(
      new URL("./SessionSidebar.svelte", import.meta.url),
    ).text();
    const dockviewSource = await Bun.file(
      new URL("./DockviewWorkspace.svelte", import.meta.url),
    ).text();

    expect(sessionListSource).toContain("paneLocations.find((location) => location.focused)");
    expect(sessionListSource).toContain("session-pane-location");
    expect(sessionListSource).toContain("focused-in-pane");
    expect(sessionListSource).toContain("open-tone-${paneTone}");
    expect(sessionListSource).toContain("primaryPaneLocation?.contextBudget");
    expect(sessionSidebarSource).toContain("function getPrimaryPaneLocation");
    expect(sessionSidebarSource).toContain(
      "return paneLocations.find((location) => location.focused) ?? paneLocations[0] ?? null;",
    );
    expect(sessionSidebarSource).toContain("sidebar-pane-location");
    expect(sessionSidebarSource).toContain("threadPrimaryPane?.focused");
    expect(sessionSidebarSource).toContain("thread.latestCommandRollup");
    expect(sessionSidebarSource).toContain("sidebar-child-command");
    expect(sessionSidebarSource).toContain("function isCommandWorking");
    expect(sessionSidebarSource).toContain(
      'return command.status === "streaming" || command.status === "requested" || command.status === "running";',
    );
    expect(sessionSidebarSource).toContain(
      "{:else if threadWorking && !thread.latestCommandRollup}",
    );
    expect(sessionSidebarSource).toContain(
      'class="sidebar-child-subtitle tone-muted blinking" aria-label="Running"',
    );
    expect(sessionSidebarSource).toContain("function getPaneTone");
    expect(dockviewSource).toContain(
      'this.element.dataset.focused = panel?.panelId === focusedPanelId ? "true" : "false";',
    );
    expect(dockviewSource).toContain("dndEdges: {");
    expect(dockviewSource).toContain("dockview.onWillShowOverlay");
    expect(dockviewSource).toContain("dockview.onWillDrop");
    expect(dockviewSource).toContain("dockview.onUnhandledDragOverEvent");
    expect(dockviewSource).toContain("isAllowedDockviewDropData(event.getData())");
    expect(dockviewSource).toContain("class SurfaceWatermarkRenderer");
    expect(dockviewSource).toContain(
      "createWatermarkComponent: () => new SurfaceWatermarkRenderer()",
    );
    expect(dockviewSource).toContain("class SurfaceTabGroupChipRenderer");
    expect(dockviewSource).toContain(
      "createTabGroupChipComponent: () => new SurfaceTabGroupChipRenderer()",
    );
    expect(dockviewSource).toContain("getTabContextMenuItems");
    expect(dockviewSource).toContain("Duplicate Panel");
    expect(dockviewSource).toContain("Close Panel");
    expect(dockviewSource).toContain("dockview-surface-action action-${icon}");
    expect(dockviewSource).toContain("Duplicate pane right");
    expect(dockviewSource).toContain("Duplicate pane below");
    expect(dockviewSource).toContain("getDockviewAddPanelPlacement(panel)");
    expect(dockviewSource).toContain("dockview.addPopoutGroup(addedPanel");
    expect(dockviewSource).toContain("floating: placement.box ?? true");
    expect(dockviewSource).toContain("referenceGroup");
  });
});
