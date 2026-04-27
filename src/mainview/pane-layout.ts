import type { PromptTarget } from "./chat-rpc";
import type { WorkspaceInspectorSelection } from "./chat-storage";

export const PRIMARY_CHAT_PANE_ID = "primary";
export const MIN_PANE_WIDTH_PX = 320;
export const MIN_PANE_HEIGHT_PX = 260;

export type PaneSplitDirection = "left" | "right" | "above" | "below";
export type PaneResizeAxis = "column" | "row";

export interface PaneGridTrack {
  id: string;
  percent: number;
}

export interface PaneLocalState {
  scroll: null | {
    transcriptAnchorId: string | null;
    offsetPx: number;
  };
  inspectorSelection: WorkspaceInspectorSelection | null;
  timelineDensity: "compact" | "comfortable";
}

export interface PaneGridPane {
  paneId: string;
  columnStart: number;
  columnEnd: number;
  rowStart: number;
  rowEnd: number;
  binding: PromptTarget | null;
  localState: PaneLocalState;
}

export interface WorkspacePaneLayoutState {
  columns: PaneGridTrack[];
  rows: PaneGridTrack[];
  panes: PaneGridPane[];
  focusedPaneId: string | null;
  updatedAt: string;
}

export type PaneOpenTarget =
  | { kind: "focused-pane" }
  | { kind: "pane"; paneId: string }
  | { kind: "split"; paneId: string; direction: PaneSplitDirection; size?: number }
  | { kind: "new-pane"; direction: "right" | "below"; size?: number };

export function createDefaultPaneLocalState(): PaneLocalState {
  return {
    scroll: null,
    inspectorSelection: null,
    timelineDensity: "comfortable",
  };
}

export function createEmptyPaneLayout(now = new Date().toISOString()): WorkspacePaneLayoutState {
  return {
    columns: [{ id: "col-0", percent: 100 }],
    rows: [{ id: "row-0", percent: 100 }],
    panes: [
      {
        paneId: PRIMARY_CHAT_PANE_ID,
        columnStart: 0,
        columnEnd: 1,
        rowStart: 0,
        rowEnd: 1,
        binding: null,
        localState: createDefaultPaneLocalState(),
      },
    ],
    focusedPaneId: PRIMARY_CHAT_PANE_ID,
    updatedAt: now,
  };
}

export function normalizeTracks(tracks: PaneGridTrack[]): PaneGridTrack[] {
  if (tracks.length === 0) {
    return [];
  }
  const positiveTracks = tracks.map((track) => ({
    ...track,
    percent: Number.isFinite(track.percent) && track.percent > 0 ? track.percent : 1,
  }));
  const total = positiveTracks.reduce((sum, track) => sum + track.percent, 0);
  return positiveTracks.map((track) => ({
    ...track,
    percent: (track.percent / total) * 100,
  }));
}

export function normalizePaneLayout(
  layout: WorkspacePaneLayoutState,
  now = new Date().toISOString(),
): WorkspacePaneLayoutState {
  const columns = normalizeTracks(layout.columns);
  const rows = normalizeTracks(layout.rows);
  if (columns.length === 0 || rows.length === 0 || layout.panes.length === 0) {
    return createEmptyPaneLayout(now);
  }

  const panes = layout.panes.map((pane) => ({
    ...pane,
    columnStart: clampInteger(pane.columnStart, 0, columns.length - 1),
    columnEnd: clampInteger(pane.columnEnd, pane.columnStart + 1, columns.length),
    rowStart: clampInteger(pane.rowStart, 0, rows.length - 1),
    rowEnd: clampInteger(pane.rowEnd, pane.rowStart + 1, rows.length),
    binding: pane.binding ? { ...pane.binding } : null,
    localState: {
      ...createDefaultPaneLocalState(),
      ...pane.localState,
      inspectorSelection: pane.localState?.inspectorSelection ?? null,
      scroll: pane.localState?.scroll ?? null,
    },
  }));
  const focusedPaneId =
    layout.focusedPaneId && panes.some((pane) => pane.paneId === layout.focusedPaneId)
      ? layout.focusedPaneId
      : panes[0]?.paneId ?? null;
  return { columns, rows, panes, focusedPaneId, updatedAt: now };
}

export function bindPane(
  layout: WorkspacePaneLayoutState,
  paneId: string,
  binding: PromptTarget | null,
): WorkspacePaneLayoutState {
  return touch({
    ...layout,
    panes: layout.panes.map((pane) =>
      pane.paneId === paneId ? { ...pane, binding: binding ? { ...binding } : null } : pane,
    ),
    focusedPaneId: paneId,
  });
}

export function focusPane(
  layout: WorkspacePaneLayoutState,
  paneId: string,
): WorkspacePaneLayoutState {
  if (!layout.panes.some((pane) => pane.paneId === paneId)) {
    return layout;
  }
  return touch({ ...layout, focusedPaneId: paneId });
}

export function setPaneInspectorSelection(
  layout: WorkspacePaneLayoutState,
  paneId: string,
  selection: WorkspaceInspectorSelection | null,
): WorkspacePaneLayoutState {
  return touch({
    ...layout,
    panes: layout.panes.map((pane) =>
      pane.paneId === paneId
        ? {
            ...pane,
            localState: {
              ...pane.localState,
              inspectorSelection: selection ? structuredClone(selection) : null,
            },
          }
        : pane,
    ),
  });
}

export function splitPane(
  layout: WorkspacePaneLayoutState,
  paneId: string,
  direction: PaneSplitDirection,
  options: { size?: number; duplicateBinding?: boolean; nextPaneId?: string } = {},
): WorkspacePaneLayoutState {
  const source = layout.panes.find((pane) => pane.paneId === paneId);
  if (!source) {
    return layout;
  }

  const nextPaneId = options.nextPaneId ?? createPaneId();
  const size = clampSize(options.size ?? 0.5);
  const splitColumn = direction === "left" || direction === "right";
  const insertIndex = splitColumn
    ? direction === "left"
      ? source.columnStart
      : source.columnEnd
    : direction === "above"
      ? source.rowStart
      : source.rowEnd;

  const tracks = splitColumn ? layout.columns : layout.rows;
  const sourceTrackIndex = splitColumn
    ? direction === "left"
      ? source.columnStart
      : source.columnEnd - 1
    : direction === "above"
      ? source.rowStart
      : source.rowEnd - 1;
  const sourceTrack = tracks[sourceTrackIndex];
  if (!sourceTrack) {
    return layout;
  }

  const newTrackPercent = sourceTrack.percent * size;
  const oldTrackPercent = sourceTrack.percent - newTrackPercent;
  const nextTracks = [
    ...tracks.slice(0, insertIndex),
    { id: `${splitColumn ? "col" : "row"}-${createPaneId()}`, percent: newTrackPercent },
    ...tracks.slice(insertIndex),
  ].map((track, index) =>
    index === (insertIndex <= sourceTrackIndex ? sourceTrackIndex + 1 : sourceTrackIndex)
      ? { ...track, percent: oldTrackPercent }
      : track,
  );

  const shiftedPanes = layout.panes.map((pane) => {
    if (splitColumn) {
      return {
        ...pane,
        columnStart: pane.columnStart >= insertIndex ? pane.columnStart + 1 : pane.columnStart,
        columnEnd: pane.columnEnd >= insertIndex ? pane.columnEnd + 1 : pane.columnEnd,
      };
    }
    return {
      ...pane,
      rowStart: pane.rowStart >= insertIndex ? pane.rowStart + 1 : pane.rowStart,
      rowEnd: pane.rowEnd >= insertIndex ? pane.rowEnd + 1 : pane.rowEnd,
    };
  });

  const shiftedSource = shiftedPanes.find((pane) => pane.paneId === paneId)!;
  const newPane: PaneGridPane = {
    paneId: nextPaneId,
    columnStart: splitColumn
      ? direction === "left"
        ? source.columnStart
        : shiftedSource.columnEnd - 1
      : shiftedSource.columnStart,
    columnEnd: splitColumn
      ? direction === "left"
        ? source.columnStart + 1
        : shiftedSource.columnEnd
      : shiftedSource.columnEnd,
    rowStart: splitColumn
      ? shiftedSource.rowStart
      : direction === "above"
        ? source.rowStart
        : shiftedSource.rowEnd - 1,
    rowEnd: splitColumn
      ? shiftedSource.rowEnd
      : direction === "above"
        ? source.rowStart + 1
        : shiftedSource.rowEnd,
    binding: options.duplicateBinding && source.binding ? { ...source.binding } : null,
    localState: createDefaultPaneLocalState(),
  };

  const panes = shiftedPanes.map((pane) => {
    if (pane.paneId !== paneId) {
      return pane;
    }
    if (splitColumn) {
      if (direction === "left") {
        return { ...pane, columnStart: pane.columnStart + 1 };
      }
      return { ...pane, columnEnd: pane.columnEnd - 1 };
    }
    if (direction === "above") {
      return { ...pane, rowStart: pane.rowStart + 1 };
    }
    return { ...pane, rowEnd: pane.rowEnd - 1 };
  });

  return normalizePaneLayout({
    ...layout,
    columns: splitColumn ? nextTracks : layout.columns,
    rows: splitColumn ? layout.rows : nextTracks,
    panes: [...panes, newPane],
    focusedPaneId: nextPaneId,
  });
}

export function closePane(layout: WorkspacePaneLayoutState, paneId: string): WorkspacePaneLayoutState {
  const pane = layout.panes.find((candidate) => candidate.paneId === paneId);
  if (!pane) {
    return layout;
  }
  if (layout.panes.length === 1) {
    return bindPane(layout, paneId, null);
  }

  const panes = expandAdjacentPaneIntoVacancy(
    pane,
    layout.panes.filter((candidate) => candidate.paneId !== paneId),
  );
  const focusedPaneId =
    layout.focusedPaneId === paneId ? findNearestPane(pane, panes)?.paneId ?? panes[0]!.paneId : layout.focusedPaneId;
  return normalizePaneLayout({ ...layout, panes, focusedPaneId });
}

export function resizeTrack(
  layout: WorkspacePaneLayoutState,
  axis: PaneResizeAxis,
  trackIndex: number,
  deltaPercent: number,
): WorkspacePaneLayoutState {
  const tracks = axis === "column" ? layout.columns : layout.rows;
  if (trackIndex < 0 || trackIndex >= tracks.length - 1) {
    return layout;
  }
  const min = 8;
  const left = tracks[trackIndex]!;
  const right = tracks[trackIndex + 1]!;
  const nextLeft = Math.max(min, left.percent + deltaPercent);
  const nextRight = Math.max(min, right.percent - deltaPercent);
  const consumed = nextLeft + nextRight;
  const original = left.percent + right.percent;
  const scaledLeft = (nextLeft / consumed) * original;
  const scaledRight = (nextRight / consumed) * original;
  const nextTracks = tracks.map((track, index) => {
    if (index === trackIndex) return { ...track, percent: scaledLeft };
    if (index === trackIndex + 1) return { ...track, percent: scaledRight };
    return track;
  });
  return normalizePaneLayout({
    ...layout,
    columns: axis === "column" ? nextTracks : layout.columns,
    rows: axis === "row" ? nextTracks : layout.rows,
  });
}

export function getPaneLocationLabel(layout: WorkspacePaneLayoutState, paneId: string): string | null {
  const pane = layout.panes.find((candidate) => candidate.paneId === paneId);
  if (!pane) {
    return null;
  }
  if (layout.columns.length === 1 && layout.rows.length === 1) {
    return "Only";
  }
  if (layout.columns.length === 2 && layout.rows.length === 1) {
    return pane.columnStart === 0 ? "Left" : "Right";
  }
  if (layout.rows.length === 2 && layout.columns.length === 1) {
    return pane.rowStart === 0 ? "Top" : "Bottom";
  }
  return `R${pane.rowStart + 1}C${pane.columnStart + 1}`;
}

export function getOpenPaneLocations(
  layout: WorkspacePaneLayoutState,
  predicate: (binding: PromptTarget) => boolean,
): { paneId: string; label: string; focused: boolean }[] {
  return layout.panes
    .filter((pane): pane is PaneGridPane & { binding: PromptTarget } => !!pane.binding && predicate(pane.binding))
    .map((pane) => ({
      paneId: pane.paneId,
      label: getPaneLocationLabel(layout, pane.paneId) ?? pane.paneId,
      focused: pane.paneId === layout.focusedPaneId,
    }));
}

function touch(layout: WorkspacePaneLayoutState): WorkspacePaneLayoutState {
  return { ...layout, updatedAt: new Date().toISOString() };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampSize(value: number): number {
  return Math.min(0.8, Math.max(0.2, value));
}

function createPaneId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `pane-${crypto.randomUUID()}`;
  }
  return `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function findNearestPane(source: PaneGridPane, panes: PaneGridPane[]): PaneGridPane | null {
  let nearest: PaneGridPane | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const pane of panes) {
    const distance =
      Math.abs(pane.columnStart - source.columnStart) + Math.abs(pane.rowStart - source.rowStart);
    if (distance < nearestDistance) {
      nearest = pane;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function expandAdjacentPaneIntoVacancy(closedPane: PaneGridPane, panes: PaneGridPane[]): PaneGridPane[] {
  const verticalCandidate = panes.find(
    (pane) =>
      pane.columnStart === closedPane.columnStart &&
      pane.columnEnd === closedPane.columnEnd &&
      (pane.rowEnd === closedPane.rowStart || pane.rowStart === closedPane.rowEnd),
  );
  if (verticalCandidate) {
    return panes.map((pane) =>
      pane.paneId === verticalCandidate.paneId
        ? {
            ...pane,
            rowStart: Math.min(pane.rowStart, closedPane.rowStart),
            rowEnd: Math.max(pane.rowEnd, closedPane.rowEnd),
          }
        : pane,
    );
  }

  const horizontalCandidate = panes.find(
    (pane) =>
      pane.rowStart === closedPane.rowStart &&
      pane.rowEnd === closedPane.rowEnd &&
      (pane.columnEnd === closedPane.columnStart || pane.columnStart === closedPane.columnEnd),
  );
  if (horizontalCandidate) {
    return panes.map((pane) =>
      pane.paneId === horizontalCandidate.paneId
        ? {
            ...pane,
            columnStart: Math.min(pane.columnStart, closedPane.columnStart),
            columnEnd: Math.max(pane.columnEnd, closedPane.columnEnd),
          }
        : pane,
    );
  }

  return panes;
}
