import type { SerializedDockview } from "dockview-core";
import type { WorkspacePaneFallbackChrome } from "@svvy/core";
import type { WorkspacePaneSurfaceTarget } from "../shared/workspace-contract";

export const PRIMARY_CHAT_PANE_ID = "primary";
export const MIN_PANE_HEIGHT_PX = 260;
export const WORKSPACE_LAYOUT_SLOT_IDS = ["A", "B", "C"] as const;

export type DockviewSplitDirection = "left" | "right" | "above" | "below";
export type WorkspaceLayoutSlotId = (typeof WORKSPACE_LAYOUT_SLOT_IDS)[number];

export interface PaneLocalState {
  scroll: null | {
    transcriptAnchorId: string | null;
    offsetPx: number;
  };
  timelineDensity: "compact" | "comfortable";
}

export type DockviewPanelChromeKind =
  | "orchestrator"
  | "handler-thread"
  | "artifact"
  | "workflows"
  | "agents"
  | "extensions"
  | "snippets"
  | "settings"
  | "app-logs"
  | "open-workspace"
  | "command"
  | "workflow-task-attempt"
  | "empty"
  | "unavailable";

export interface DockviewPanelChromeState {
  title: string;
  subtitle: string | null;
  icon: string | null;
  kind: DockviewPanelChromeKind;
  closable: boolean;
  floatable: boolean;
  popoutable: boolean;
}

export interface DockviewPanelRestoreState {
  unavailableReason: string | null;
  lastKnownLocationLabel: string | null;
}

export type DockviewPanelPlacementState =
  | {
      kind: "split";
      referencePanelId: string;
      direction: DockviewSplitDirection;
      size?: number;
    }
  | {
      kind: "tab";
      groupId: string;
      index?: number;
    }
  | {
      kind: "edge";
      direction: DockviewSplitDirection;
      size?: number;
    }
  | {
      kind: "floating";
      box?: { x: number; y: number; width: number; height: number };
    }
  | {
      kind: "popout";
      box?: { left: number; top: number; width: number; height: number };
    };

type DockviewFloatingPlacementBox = Extract<
  DockviewPanelPlacementState,
  { kind: "floating" }
>["box"];
type DockviewPopoutPlacementBox = Extract<DockviewPanelPlacementState, { kind: "popout" }>["box"];

export type DockviewPaneLocationKind = "tab" | "edge" | "floating" | "popout";

export interface DockviewOpenPaneLocation {
  paneId: string;
  panelId: string;
  label: string;
  focused: boolean;
  kind: DockviewPaneLocationKind;
}

export interface DockviewTabGroupPlacementTarget {
  groupId: string;
  label: string;
  panelIds: string[];
}

export interface WorkspaceDockviewPanelState {
  panelId: string;
  binding: WorkspacePaneSurfaceTarget | null;
  localState: PaneLocalState;
  chrome?: DockviewPanelChromeState;
  fallbackChrome?: WorkspacePaneFallbackChrome | null;
  placement?: DockviewPanelPlacementState | null;
  restore?: DockviewPanelRestoreState;
}

export interface CompactThreadSurfaceState {
  kind: "compact-thread";
  workspaceSessionId: string;
  threadId: string;
  panelId: string | null;
  density: PaneLocalState["timelineDensity"];
}

export type CompactWorkspaceSurfaceState = CompactThreadSurfaceState;

export interface WorkspaceDockviewLayoutState {
  dockview: SerializedDockview | null;
  panels: WorkspaceDockviewPanelState[];
  compactSurfaces: CompactWorkspaceSurfaceState[];
  focusedPanelId: string | null;
  updatedAt: string;
}

export type WorkspacePaneLayoutState = WorkspaceDockviewLayoutState;

export interface WorkspaceLayoutSlotSummary {
  id: WorkspaceLayoutSlotId;
  initialized: boolean;
  active: boolean;
  updatedAt: string | null;
}

export type DockviewOpenTarget =
  | { kind: "focused-panel" }
  | { kind: "panel"; panelId: string }
  | { kind: "split"; panelId: string; direction: DockviewSplitDirection; size?: number }
  | { kind: "tab"; groupId: string; index?: number }
  | { kind: "new-panel"; direction: "right" | "below"; size?: number }
  | { kind: "edge"; direction: DockviewSplitDirection; size?: number }
  | { kind: "floating"; box?: { x: number; y: number; width: number; height: number } }
  | { kind: "popout"; box?: { left: number; top: number; width: number; height: number } };

export type PaneOpenTarget = DockviewOpenTarget;

export function getSidebarPaneOpenTarget(event?: Pick<MouseEvent, "metaKey">): PaneOpenTarget {
  return event?.metaKey ? { kind: "new-panel", direction: "right" } : { kind: "focused-panel" };
}

export function getSidebarSessionOpenTarget(event?: Pick<MouseEvent, "metaKey">): PaneOpenTarget {
  return getSidebarPaneOpenTarget(event);
}

export function createDefaultPaneLocalState(): PaneLocalState {
  return {
    scroll: null,
    timelineDensity: "comfortable",
  };
}

export function createPanelChrome(
  binding: WorkspacePaneSurfaceTarget | null,
): DockviewPanelChromeState {
  if (!binding) {
    return {
      title: "Empty",
      subtitle: null,
      icon: null,
      kind: "empty",
      closable: true,
      floatable: true,
      popoutable: false,
    };
  }

  switch (binding.surface) {
    case "orchestrator":
      return chrome("Orchestrator", binding.workspaceSessionId, "orchestrator", true);
    case "handler":
      return chrome(
        "Handler Thread",
        binding.threadId ?? binding.surfacePiSessionId,
        "handler-thread",
        true,
      );
    case "workflows":
      return chrome("Workflows", "@svvyx/workflows", "workflows", true);
    case "agents":
      return chrome("Agents", "profiles", "agents", true);
    case "extensions":
      return chrome("Extensions", "inventory", "extensions", true);
    case "snippets":
      return chrome("Snippets", "prompt macros", "snippets", true);
    case "settings":
      return chrome("Settings", "preferences", "settings", true);
    case "app-logs":
      return chrome("Logs", "workspace", "app-logs", true);
    case "open-workspace":
      return chrome("Open Workspace", "choose a folder", "open-workspace", true);
    case "command":
      return chrome("Command Inspector", binding.commandId, "command", true);
    case "workflow-task-attempt":
      return chrome(
        "Workflow Task-Agent",
        binding.workflowTaskAttemptId,
        "workflow-task-attempt",
        true,
      );
    case "artifact":
      return chrome("Artifact", binding.artifactId, "artifact", true);
  }
}

export function createPanelFallbackChrome(
  binding: WorkspacePaneSurfaceTarget,
  current?: DockviewPanelChromeState,
): WorkspacePaneFallbackChrome {
  const panelChrome = current ?? createPanelChrome(binding);
  if (panelChrome.kind === "empty" || panelChrome.kind === "unavailable") {
    throw new Error(`Pane target produced invalid fallback chrome kind ${panelChrome.kind}.`);
  }
  return {
    title: panelChrome.title,
    subtitle: panelChrome.subtitle,
    kind: panelChrome.kind,
  };
}

export function createDockviewPanelState(
  panelId: string,
  binding: WorkspacePaneSurfaceTarget,
  placement: DockviewPanelPlacementState | null = null,
): WorkspaceDockviewPanelState {
  return {
    panelId,
    binding: { ...binding },
    localState: createDefaultPaneLocalState(),
    chrome: createPanelChrome(binding),
    fallbackChrome: null,
    placement: placement ? { ...placement } : null,
    restore: {
      unavailableReason: null,
      lastKnownLocationLabel: null,
    },
  };
}

export function createUnavailableDockviewPanelState(
  panelId: string,
  input: {
    target: WorkspacePaneSurfaceTarget;
    reason: string;
    lastKnownLocationLabel?: string | null;
    localState?: PaneLocalState;
    placement?: DockviewPanelPlacementState | null;
    fallbackChrome?: WorkspacePaneFallbackChrome;
  },
): WorkspaceDockviewPanelState {
  const fallbackChrome = input.fallbackChrome ?? createPanelFallbackChrome(input.target);
  return {
    panelId,
    binding: { ...input.target },
    localState: input.localState
      ? structuredClone(input.localState)
      : createDefaultPaneLocalState(),
    chrome: {
      title: "Surface unavailable",
      subtitle: fallbackChrome.title,
      icon: null,
      kind: "unavailable",
      closable: true,
      floatable: true,
      popoutable: false,
    },
    fallbackChrome,
    placement: input.placement ? { ...input.placement } : null,
    restore: {
      unavailableReason: input.reason,
      lastKnownLocationLabel: input.lastKnownLocationLabel ?? null,
    },
  };
}

export function createEmptyPaneLayout(
  now = new Date().toISOString(),
): WorkspaceDockviewLayoutState {
  return {
    dockview: null,
    panels: [],
    compactSurfaces: [],
    focusedPanelId: null,
    updatedAt: now,
  };
}

export function isInitializedPaneLayout(layout: WorkspaceDockviewLayoutState): boolean {
  return layout.panels.some((panel) => panel.binding !== null);
}

export function normalizePaneLayout(
  layout: Partial<WorkspaceDockviewLayoutState>,
  now = new Date().toISOString(),
): WorkspaceDockviewLayoutState {
  const rawPanels = Array.isArray(layout.panels) ? layout.panels : [];

  if (rawPanels.length === 0) {
    const compactSurfaces = Array.isArray(layout.compactSurfaces)
      ? layout.compactSurfaces.flatMap(normalizeCompactSurfaceState)
      : [];
    return {
      ...createEmptyPaneLayout(now),
      compactSurfaces: reconcileCompactSurfacePanelIds(compactSurfaces, new Set()),
    };
  }

  const panels = rawPanels.flatMap((panel) => {
    const next = panel as Partial<WorkspaceDockviewPanelState>;
    const localState = {
      ...createDefaultPaneLocalState(),
      scroll: next.localState?.scroll ?? null,
      timelineDensity: next.localState?.timelineDensity === "compact" ? "compact" : "comfortable",
    } satisfies PaneLocalState;
    const placement = normalizePlacement(next.placement);
    const restore = {
      unavailableReason: null,
      lastKnownLocationLabel: null,
      ...next.restore,
    } satisfies DockviewPanelRestoreState;

    if (!next.binding) return [];
    const binding = normalizePaneBinding(next.binding);
    if (!binding) {
      return [];
    }
    if (restore.unavailableReason) {
      return [
        createUnavailableDockviewPanelState(String(next.panelId ?? createPanelId()), {
          target: binding,
          reason: restore.unavailableReason,
          lastKnownLocationLabel: restore.lastKnownLocationLabel,
          localState,
          placement,
          ...(next.fallbackChrome ? { fallbackChrome: next.fallbackChrome } : {}),
        }),
      ];
    }
    return [
      {
        panelId: String(next.panelId ?? createPanelId()),
        binding,
        localState,
        chrome: {
          ...createPanelChrome(binding),
          ...next.chrome,
        },
        fallbackChrome: null,
        placement,
        restore,
      },
    ];
  });

  if (panels.length === 0) {
    const compactSurfaces = Array.isArray(layout.compactSurfaces)
      ? layout.compactSurfaces.flatMap(normalizeCompactSurfaceState)
      : [];
    return {
      ...createEmptyPaneLayout(now),
      compactSurfaces: reconcileCompactSurfacePanelIds(compactSurfaces, new Set()),
    };
  }

  const focusedPanelId =
    layout.focusedPanelId && panels.some((panel) => panel.panelId === layout.focusedPanelId)
      ? layout.focusedPanelId
      : panels[0]!.panelId;
  const droppedPanels = panels.length !== rawPanels.length;
  const panelIds = new Set(panels.map((panel) => panel.panelId));
  const dockview = sanitizeSerializedDockview(layout.dockview, panelIds, droppedPanels);
  const compactSurfaces = Array.isArray(layout.compactSurfaces)
    ? layout.compactSurfaces.flatMap(normalizeCompactSurfaceState)
    : [];

  return {
    dockview,
    panels,
    compactSurfaces: reconcileCompactSurfacePanelIds(compactSurfaces, panelIds),
    focusedPanelId,
    updatedAt: now,
  };
}

function normalizeCompactSurfaceState(value: unknown): CompactWorkspaceSurfaceState[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const surface = value as Partial<CompactWorkspaceSurfaceState>;
  const panelId =
    surface.panelId === null || typeof surface.panelId === "string" ? surface.panelId : null;
  const density =
    surface.density === "compact" || surface.density === "comfortable" ? surface.density : null;
  if (!density) {
    return [];
  }

  switch (surface.kind) {
    case "compact-thread":
      return typeof surface.workspaceSessionId === "string" &&
        surface.workspaceSessionId.length > 0 &&
        typeof surface.threadId === "string" &&
        surface.threadId.length > 0
        ? [
            {
              kind: "compact-thread",
              workspaceSessionId: surface.workspaceSessionId,
              threadId: surface.threadId,
              panelId,
              density,
            },
          ]
        : [];
    default:
      return [];
  }
}

function reconcileCompactSurfacePanelIds(
  surfaces: readonly CompactWorkspaceSurfaceState[],
  panelIds: ReadonlySet<string>,
): CompactWorkspaceSurfaceState[] {
  return surfaces.map((surface) =>
    surface.panelId !== null && !panelIds.has(surface.panelId)
      ? { ...surface, panelId: null }
      : { ...surface },
  );
}

function normalizePaneBinding(value: unknown): WorkspacePaneSurfaceTarget | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const binding = value as Partial<WorkspacePaneSurfaceTarget>;
  switch (binding.surface) {
    case "orchestrator":
      return typeof binding.workspaceSessionId === "string" &&
        binding.workspaceSessionId.length > 0 &&
        typeof binding.surfacePiSessionId === "string" &&
        binding.surfacePiSessionId.length > 0
        ? ({
            workspaceSessionId: binding.workspaceSessionId,
            surface: "orchestrator",
            surfacePiSessionId: binding.surfacePiSessionId,
          } satisfies WorkspacePaneSurfaceTarget)
        : null;
    case "handler":
      return typeof binding.workspaceSessionId === "string" &&
        binding.workspaceSessionId.length > 0 &&
        typeof binding.surfacePiSessionId === "string" &&
        binding.surfacePiSessionId.length > 0 &&
        typeof binding.threadId === "string" &&
        binding.threadId.length > 0
        ? ({
            workspaceSessionId: binding.workspaceSessionId,
            surface: "handler",
            surfacePiSessionId: binding.surfacePiSessionId,
            threadId: binding.threadId,
          } satisfies WorkspacePaneSurfaceTarget)
        : null;
    case "command":
      return typeof binding.workspaceSessionId === "string" &&
        binding.workspaceSessionId.length > 0 &&
        typeof binding.commandId === "string" &&
        binding.commandId.length > 0
        ? ({
            workspaceSessionId: binding.workspaceSessionId,
            surface: "command",
            commandId: binding.commandId,
          } satisfies WorkspacePaneSurfaceTarget)
        : null;
    case "workflow-task-attempt":
      return typeof binding.workspaceSessionId === "string" &&
        binding.workspaceSessionId.length > 0 &&
        typeof binding.workflowTaskAttemptId === "string" &&
        binding.workflowTaskAttemptId.length > 0
        ? ({
            workspaceSessionId: binding.workspaceSessionId,
            surface: "workflow-task-attempt",
            workflowTaskAttemptId: binding.workflowTaskAttemptId,
          } satisfies WorkspacePaneSurfaceTarget)
        : null;
    case "artifact":
      return typeof binding.workspaceSessionId === "string" &&
        binding.workspaceSessionId.length > 0 &&
        typeof binding.artifactId === "string" &&
        binding.artifactId.length > 0
        ? ({
            workspaceSessionId: binding.workspaceSessionId,
            surface: "artifact",
            artifactId: binding.artifactId,
          } satisfies WorkspacePaneSurfaceTarget)
        : null;
    case "workflows":
      return { surface: "workflows" };
    case "agents":
      return {
        surface: "agents",
        ...(binding.view === "generated-context-preview" || binding.view === "profiles"
          ? { view: binding.view }
          : {}),
        ...(typeof binding.targetAgentProfileId === "string" &&
        binding.targetAgentProfileId.length > 0
          ? { targetAgentProfileId: binding.targetAgentProfileId }
          : {}),
      };
    case "extensions":
      return {
        surface: "extensions",
        ...(binding.view === "generated-context-preview" || binding.view === "inventory"
          ? { view: binding.view }
          : {}),
        ...(typeof binding.targetExtensionId === "string" && binding.targetExtensionId.length > 0
          ? { targetExtensionId: binding.targetExtensionId }
          : {}),
      };
    case "snippets":
      return { surface: "snippets" };
    case "settings":
      return { surface: "settings" };
    case "app-logs":
      return typeof binding.workspaceSessionId === "string" && binding.workspaceSessionId.length > 0
        ? { surface: "app-logs", workspaceSessionId: binding.workspaceSessionId }
        : { surface: "app-logs" };
    case "open-workspace":
      return { surface: "open-workspace" };
    default:
      return null;
  }
}

export function bindPane(
  layout: WorkspaceDockviewLayoutState,
  panelId: string,
  binding: WorkspacePaneSurfaceTarget | null,
): WorkspaceDockviewLayoutState {
  return touch({
    ...layout,
    panels: layout.panels.map((panel) =>
      panel.panelId === panelId
        ? {
            ...panel,
            binding: binding ? { ...binding } : null,
            chrome: createPanelChrome(binding),
            fallbackChrome: null,
            restore: {
              unavailableReason: null,
              lastKnownLocationLabel: null,
            },
          }
        : panel,
    ),
    focusedPanelId: panelId,
  });
}

export function focusPane(
  layout: WorkspaceDockviewLayoutState,
  panelId: string,
): WorkspaceDockviewLayoutState {
  if (!layout.panels.some((panel) => panel.panelId === panelId)) {
    return layout;
  }
  return touch({ ...layout, focusedPanelId: panelId });
}

export function setPaneScroll(
  layout: WorkspaceDockviewLayoutState,
  panelId: string,
  scroll: PaneLocalState["scroll"],
): WorkspaceDockviewLayoutState {
  return touch({
    ...layout,
    panels: layout.panels.map((panel) =>
      panel.panelId === panelId
        ? { ...panel, localState: { ...panel.localState, scroll: scroll ? { ...scroll } : null } }
        : panel,
    ),
  });
}

export function addDockviewPanel(
  layout: WorkspaceDockviewLayoutState,
  binding: WorkspacePaneSurfaceTarget,
  panelId = createPanelId(),
  placement: DockviewPanelPlacementState | null = null,
): WorkspaceDockviewLayoutState {
  return touch({
    ...layout,
    panels: [...layout.panels, createDockviewPanelState(panelId, binding, placement)],
    focusedPanelId: panelId,
  });
}

export function removeDockviewPanel(
  layout: WorkspaceDockviewLayoutState,
  panelId: string,
): WorkspaceDockviewLayoutState {
  const panels = layout.panels.filter((panel) => panel.panelId !== panelId);
  const panelIds = new Set(panels.map((panel) => panel.panelId));
  return touch({
    ...layout,
    dockview: sanitizeSerializedDockview(
      layout.dockview,
      panelIds,
      panels.length !== layout.panels.length,
    ),
    panels,
    compactSurfaces: reconcileCompactSurfacePanelIds(layout.compactSurfaces, panelIds),
    focusedPanelId:
      layout.focusedPanelId === panelId ? (panels[0]?.panelId ?? null) : layout.focusedPanelId,
  });
}

export function splitPane(
  layout: WorkspaceDockviewLayoutState,
  panelId: string,
  direction: DockviewSplitDirection,
  options: { duplicateBinding?: boolean; size?: number; nextPaneId?: string } = {},
): WorkspaceDockviewLayoutState {
  const source = layout.panels.find((panel) => panel.panelId === panelId);
  if (!options.duplicateBinding || !source?.binding) {
    return layout;
  }
  const binding = { ...source.binding };
  return addDockviewPanel(layout, binding, options.nextPaneId ?? createPanelId(), {
    kind: "split",
    referencePanelId: panelId,
    direction,
    size: options.size,
  });
}

export function closePane(
  layout: WorkspaceDockviewLayoutState,
  panelId: string,
): WorkspaceDockviewLayoutState {
  return removeDockviewPanel(layout, panelId);
}

export function markDockviewPanelUnavailable(
  layout: WorkspaceDockviewLayoutState,
  panelId: string,
  reason: string,
): WorkspaceDockviewLayoutState {
  let changed = false;
  const panels = layout.panels.map((panel) => {
    if (panel.panelId !== panelId) {
      return panel;
    }
    if (!panel.binding) {
      return panel;
    }
    changed = true;
    return createUnavailableDockviewPanelState(panel.panelId, {
      target: panel.binding,
      reason,
      lastKnownLocationLabel: panel.restore?.lastKnownLocationLabel ?? null,
      localState: panel.localState,
      placement: panel.placement ?? null,
      ...(panel.fallbackChrome
        ? { fallbackChrome: panel.fallbackChrome }
        : { fallbackChrome: createPanelFallbackChrome(panel.binding, panel.chrome) }),
    });
  });
  if (!changed) {
    return layout;
  }
  return touch({
    ...layout,
    panels,
    focusedPanelId:
      layout.focusedPanelId && panels.some((panel) => panel.panelId === layout.focusedPanelId)
        ? layout.focusedPanelId
        : (panels[0]?.panelId ?? null),
  });
}

export function setDockviewSerializedLayout(
  layout: WorkspaceDockviewLayoutState,
  dockview: SerializedDockview | null,
  focusedPanelId = layout.focusedPanelId,
): WorkspaceDockviewLayoutState {
  const panelIds = new Set(layout.panels.map((panel) => panel.panelId));
  return touch({
    ...layout,
    dockview: sanitizeSerializedDockview(dockview, panelIds),
    focusedPanelId,
  });
}

export function getOpenPaneLocations(
  layout: WorkspaceDockviewLayoutState,
  predicate: (binding: WorkspacePaneSurfaceTarget) => boolean,
): DockviewOpenPaneLocation[] {
  const dockviewLocations = getDockviewPaneLocationLabels(layout);
  return layout.panels
    .filter((panel) => panel.binding && predicate(panel.binding))
    .map((panel, index) => ({
      paneId: panel.panelId,
      panelId: panel.panelId,
      ...(dockviewLocations.get(panel.panelId) ?? getFallbackPaneLocation(panel, index)),
      label:
        panel.restore?.lastKnownLocationLabel ??
        dockviewLocations.get(panel.panelId)?.label ??
        getFallbackPaneLocation(panel, index).label,
      focused: panel.panelId === layout.focusedPanelId,
    }));
}

export function getDockviewTabGroupPlacementTargets(
  layout: WorkspaceDockviewLayoutState,
): DockviewTabGroupPlacementTarget[] {
  if (!layout.dockview) return [];
  const knownPanelIds = new Set(layout.panels.map((panel) => panel.panelId));
  return collectGridGroups(layout.dockview.grid?.root)
    .map((group) => ({
      groupId: group.groupId,
      panelIds: group.panelIds.filter((panelId) => knownPanelIds.has(panelId)),
    }))
    .filter((group) => group.panelIds.length > 0)
    .map((group, index) => ({
      ...group,
      label: formatPaneLocationLabel("tab", index + 1),
    }));
}

function getDockviewPaneLocationLabels(
  layout: WorkspaceDockviewLayoutState,
): Map<string, { label: string; kind: DockviewPaneLocationKind }> {
  const locations = new Map<string, { label: string; kind: DockviewPaneLocationKind }>();
  if (!layout.dockview) return locations;

  let gridGroupIndex = 0;
  collectGridGroupLocations(layout.dockview.grid?.root, () => {
    gridGroupIndex += 1;
    return gridGroupIndex;
  }).forEach((location, panelId) => locations.set(panelId, location));

  for (const [groupIndex, group] of (layout.dockview.floatingGroups ?? []).entries()) {
    collectGroupViewLocations(
      group.data,
      "floating",
      formatPaneLocationLabel("floating", groupIndex + 1),
    ).forEach((location, panelId) => locations.set(panelId, location));
  }

  for (const [groupIndex, group] of (layout.dockview.popoutGroups ?? []).entries()) {
    collectGroupViewLocations(
      group.data,
      "popout",
      formatPaneLocationLabel("popout", groupIndex + 1),
    ).forEach((location, panelId) => locations.set(panelId, location));
  }

  const edgeGroups = layout.dockview.edgeGroups;
  if (edgeGroups) {
    for (const position of ["top", "right", "bottom", "left"] as const) {
      const edgeGroup = edgeGroups[position];
      if (!edgeGroup) continue;
      for (const panelId of collectViewsFromUnknown(edgeGroup.group)) {
        locations.set(panelId, {
          kind: "edge",
          label: `Edge ${position}`,
        });
      }
    }
  }

  return locations;
}

function collectGridGroupLocations(
  node: unknown,
  nextGroupIndex: () => number,
): Map<string, { label: string; kind: DockviewPaneLocationKind }> {
  const locations = new Map<string, { label: string; kind: DockviewPaneLocationKind }>();
  if (!node || typeof node !== "object") return locations;
  const value = node as { type?: unknown; data?: unknown };
  if (value.type === "leaf") {
    const groupIndex = nextGroupIndex();
    collectGroupViewLocations(
      value.data,
      "tab",
      formatPaneLocationLabel("tab", groupIndex),
    ).forEach((location, panelId) => locations.set(panelId, location));
    return locations;
  }
  if (value.type === "branch" && Array.isArray(value.data)) {
    for (const child of value.data) {
      collectGridGroupLocations(child, nextGroupIndex).forEach((location, panelId) =>
        locations.set(panelId, location),
      );
    }
  }
  return locations;
}

function collectGridGroups(node: unknown): Array<{ groupId: string; panelIds: string[] }> {
  if (!node || typeof node !== "object") return [];
  const value = node as { type?: unknown; data?: unknown };
  if (value.type === "leaf") {
    const group = value.data as { id?: unknown } | null;
    const groupId = typeof group?.id === "string" ? group.id : null;
    const panelIds = collectViewsFromUnknown(value.data);
    return groupId && panelIds.length > 0 ? [{ groupId, panelIds }] : [];
  }
  if (value.type === "branch" && Array.isArray(value.data)) {
    return value.data.flatMap((child) => collectGridGroups(child));
  }
  return [];
}

function collectGroupViewLocations(
  group: unknown,
  kind: DockviewPaneLocationKind,
  baseLabel: string,
): Map<string, { label: string; kind: DockviewPaneLocationKind }> {
  const locations = new Map<string, { label: string; kind: DockviewPaneLocationKind }>();
  const views = collectViewsFromUnknown(group);
  for (const [index, panelId] of views.entries()) {
    locations.set(panelId, {
      kind,
      label: views.length > 1 ? `${baseLabel}, tab ${index + 1}` : baseLabel,
    });
  }
  return locations;
}

function collectViewsFromUnknown(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const candidate = value as { views?: unknown; data?: unknown; group?: unknown };
  if (Array.isArray(candidate.views)) {
    return candidate.views.filter((view): view is string => typeof view === "string");
  }
  if (candidate.data) {
    return collectViewsFromUnknown(candidate.data);
  }
  if (candidate.group) {
    return collectViewsFromUnknown(candidate.group);
  }
  return [];
}

function getFallbackPaneLocation(
  panel: WorkspaceDockviewPanelState,
  index: number,
): { label: string; kind: DockviewPaneLocationKind } {
  if (panel.placement) {
    switch (panel.placement.kind) {
      case "split":
        return { kind: "tab", label: `Split ${panel.placement.direction}` };
      case "tab":
        return { kind: "tab", label: formatPaneLocationLabel("tab", 1) };
      case "edge":
        return {
          kind: "edge",
          label: `Edge ${formatSplitDirectionLabel(panel.placement.direction)}`,
        };
      case "floating":
        return { kind: "floating", label: "Floating" };
      case "popout":
        return { kind: "popout", label: "Popout" };
    }
  }
  return {
    kind: "tab",
    label: index === 0 ? "Tab" : `Tab ${index + 1}`,
  };
}

function formatSplitDirectionLabel(direction: DockviewSplitDirection): string {
  switch (direction) {
    case "above":
      return "top";
    case "below":
      return "bottom";
    default:
      return direction;
  }
}

function formatPaneLocationLabel(kind: DockviewPaneLocationKind, groupIndex: number): string {
  switch (kind) {
    case "floating":
      return groupIndex === 1 ? "Floating" : `Floating ${groupIndex}`;
    case "popout":
      return groupIndex === 1 ? "Popout" : `Popout ${groupIndex}`;
    case "edge":
      return groupIndex === 1 ? "Edge" : `Edge ${groupIndex}`;
    case "tab":
      return groupIndex === 1 ? "Tab" : `Tab group ${groupIndex}`;
  }
}

export function createPanelId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `panel-${crypto.randomUUID()}`;
  }
  return `panel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function chrome(
  title: string,
  subtitle: string | null,
  kind: DockviewPanelChromeKind,
  floatable: boolean,
): DockviewPanelChromeState {
  return {
    title,
    subtitle,
    icon: null,
    kind,
    closable: true,
    floatable,
    popoutable: false,
  };
}

function touch(layout: WorkspaceDockviewLayoutState): WorkspaceDockviewLayoutState {
  return {
    ...layout,
    updatedAt: new Date().toISOString(),
  };
}

function normalizePlacement(value: unknown): DockviewPanelPlacementState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as {
    kind?: unknown;
    referencePanelId?: unknown;
    groupId?: unknown;
    direction?: unknown;
    size?: unknown;
    index?: unknown;
    box?: unknown;
  };
  if (
    (candidate.kind === "split" || candidate.kind === undefined) &&
    typeof candidate.referencePanelId === "string" &&
    isSplitDirection(candidate.direction)
  ) {
    return {
      kind: "split",
      referencePanelId: candidate.referencePanelId,
      direction: candidate.direction,
      size: typeof candidate.size === "number" ? candidate.size : undefined,
    };
  }
  if (candidate.kind === "tab" && typeof candidate.groupId === "string") {
    return {
      kind: "tab",
      groupId: candidate.groupId,
      index: typeof candidate.index === "number" ? candidate.index : undefined,
    };
  }
  if (candidate.kind === "edge" && isSplitDirection(candidate.direction)) {
    return {
      kind: "edge",
      direction: candidate.direction,
      size: typeof candidate.size === "number" ? candidate.size : undefined,
    };
  }
  if (candidate.kind === "floating") {
    return {
      kind: "floating",
      box: normalizeFloatingBox(candidate.box),
    };
  }
  if (candidate.kind === "popout") {
    return {
      kind: "popout",
      box: normalizePopoutBox(candidate.box),
    };
  }
  return null;
}

function isSplitDirection(value: unknown): value is DockviewSplitDirection {
  return value === "left" || value === "right" || value === "above" || value === "below";
}

function normalizeFloatingBox(value: unknown): DockviewFloatingPlacementBox {
  if (!value || typeof value !== "object") return undefined;
  const box = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  return typeof box.x === "number" &&
    typeof box.y === "number" &&
    typeof box.width === "number" &&
    typeof box.height === "number"
    ? { x: box.x, y: box.y, width: box.width, height: box.height }
    : undefined;
}

function normalizePopoutBox(value: unknown): DockviewPopoutPlacementBox {
  if (!value || typeof value !== "object") return undefined;
  const box = value as { left?: unknown; top?: unknown; width?: unknown; height?: unknown };
  return typeof box.left === "number" &&
    typeof box.top === "number" &&
    typeof box.width === "number" &&
    typeof box.height === "number"
    ? { left: box.left, top: box.top, width: box.width, height: box.height }
    : undefined;
}

function isSerializedDockview(value: unknown): value is SerializedDockview {
  return !!value && typeof value === "object" && "grid" in value && "panels" in value;
}

function sanitizeSerializedDockview(
  value: unknown,
  panelIds: Set<string>,
  forceDiscard = false,
): SerializedDockview | null {
  if (forceDiscard || !isSerializedDockview(value)) {
    return null;
  }

  const serializedPanelIds = collectSerializedDockviewPanelIds(value);
  if (serializedPanelIds.size === 0) {
    return panelIds.size === 0 ? null : value;
  }

  if (serializedPanelIds.size !== panelIds.size) {
    return null;
  }
  for (const panelId of serializedPanelIds) {
    if (!panelIds.has(panelId)) {
      return null;
    }
  }

  return value;
}

function collectSerializedDockviewPanelIds(value: SerializedDockview): Set<string> {
  const ids = new Set<string>();
  const panels = (value as { panels?: unknown }).panels;
  if (Array.isArray(panels)) {
    for (const panel of panels) {
      if (panel && typeof panel === "object") {
        const id = (panel as { id?: unknown }).id;
        if (typeof id === "string") {
          ids.add(id);
        }
      }
    }
    return ids;
  }
  if (panels && typeof panels === "object") {
    for (const id of Object.keys(panels)) {
      ids.add(id);
    }
  }
  return ids;
}
