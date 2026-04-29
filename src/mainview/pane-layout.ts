import type { WorkspacePaneSurfaceTarget } from "../shared/workspace-contract";
import type { WorkspaceInspectorSelection } from "./chat-storage";

export const PRIMARY_CHAT_PANE_ID = "primary";
export const MIN_PANE_WIDTH_PX = 320;
export const MIN_PANE_HEIGHT_PX = 260;

export type PaneSplitDirection = "left" | "right" | "above" | "below";
export type PanePlacementZone = "replace" | PaneSplitDirection;
export type PaneSpanPlacement = "top" | "bottom" | "left" | "right";
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
  binding: WorkspacePaneSurfaceTarget | null;
  localState: PaneLocalState;
}

export interface CompactThreadSurfaceState {
  kind: "compact-thread";
  workspaceSessionId: string;
  threadId: string;
  paneId: string | null;
  density: PaneLocalState["timelineDensity"];
}

export interface CompactWorkflowRunSurfaceState {
  kind: "compact-workflow-run";
  workspaceSessionId: string;
  threadId: string;
  workflowRunId: string;
  paneId: string | null;
  density: PaneLocalState["timelineDensity"];
}

export type CompactWorkspaceSurfaceState =
  | CompactThreadSurfaceState
  | CompactWorkflowRunSurfaceState;

export interface WorkspacePaneLayoutState {
  columns: PaneGridTrack[];
  rows: PaneGridTrack[];
  panes: PaneGridPane[];
  compactSurfaces: CompactWorkspaceSurfaceState[];
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
    compactSurfaces: [],
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
      : (panes[0]?.paneId ?? null);
  return {
    columns,
    rows,
    panes,
    compactSurfaces: Array.isArray(layout.compactSurfaces)
      ? layout.compactSurfaces.map((surface) => ({ ...surface }))
      : [],
    focusedPaneId,
    updatedAt: now,
  };
}

export function bindPane(
  layout: WorkspacePaneLayoutState,
  paneId: string,
  binding: WorkspacePaneSurfaceTarget | null,
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

export function setPaneScroll(
  layout: WorkspacePaneLayoutState,
  paneId: string,
  scroll: PaneLocalState["scroll"],
): WorkspacePaneLayoutState {
  if (!layout.panes.some((pane) => pane.paneId === paneId)) {
    return layout;
  }
  return touch({
    ...layout,
    panes: layout.panes.map((pane) =>
      pane.paneId === paneId
        ? {
            ...pane,
            localState: {
              ...pane.localState,
              scroll: scroll ? { ...scroll } : null,
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
      if (
        pane.paneId !== paneId &&
        pane.columnStart <= sourceTrackIndex &&
        pane.columnEnd > sourceTrackIndex
      ) {
        return {
          ...pane,
          columnEnd: pane.columnEnd + 1,
        };
      }
      return {
        ...pane,
        columnStart: pane.columnStart >= insertIndex ? pane.columnStart + 1 : pane.columnStart,
        columnEnd: pane.columnEnd >= insertIndex ? pane.columnEnd + 1 : pane.columnEnd,
      };
    }
    if (
      pane.paneId !== paneId &&
      pane.rowStart <= sourceTrackIndex &&
      pane.rowEnd > sourceTrackIndex
    ) {
      return {
        ...pane,
        rowEnd: pane.rowEnd + 1,
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
        return pane;
      }
      return { ...pane, columnEnd: pane.columnEnd - 1 };
    }
    if (direction === "above") {
      return pane;
    }
    return { ...pane, rowEnd: pane.rowEnd - 1 };
  });

  const nextLayout = normalizePaneLayout({
    ...layout,
    columns: splitColumn ? nextTracks : layout.columns,
    rows: splitColumn ? layout.rows : nextTracks,
    panes: [...panes, newPane],
    focusedPaneId: nextPaneId,
  });
  return hasCompletePaneCoverage(nextLayout) ? nextLayout : layout;
}

export function placePane(
  layout: WorkspacePaneLayoutState,
  sourcePaneId: string,
  targetPaneId: string,
  zone: PanePlacementZone,
  options: { duplicateBinding?: boolean; size?: number } = {},
): WorkspacePaneLayoutState {
  const source = layout.panes.find((pane) => pane.paneId === sourcePaneId);
  const target = layout.panes.find((pane) => pane.paneId === targetPaneId);
  if (!source || !target) {
    return layout;
  }
  if (sourcePaneId === targetPaneId) {
    return layout;
  }
  if (zone !== "replace" && isPaneAlreadyPlaced(source, target, zone)) {
    return touch({ ...layout, focusedPaneId: sourcePaneId });
  }

  const movedBinding = source.binding ? { ...source.binding } : null;
  const movedLocalState = structuredClone(source.localState);

  if (zone === "replace") {
    const nextLayout = touch({
      ...layout,
      panes: layout.panes.map((pane) => {
        if (pane.paneId === targetPaneId) {
          return {
            ...pane,
            binding: movedBinding,
            localState: movedLocalState,
          };
        }
        if (!options.duplicateBinding && pane.paneId === sourcePaneId) {
          return {
            ...pane,
            binding: target.binding ? { ...target.binding } : null,
            localState: structuredClone(target.localState),
          };
        }
        return pane;
      }),
      focusedPaneId: targetPaneId,
    });
    return hasCompletePaneCoverage(nextLayout) ? nextLayout : layout;
  }

  const baseLayout = options.duplicateBinding ? layout : closePane(layout, sourcePaneId);
  const targetAfterClose = baseLayout.panes.find((pane) => pane.paneId === targetPaneId);
  if (!targetAfterClose) {
    return layout;
  }
  const nextPaneId = options.duplicateBinding ? createPaneId() : sourcePaneId;
  const splitLayout = splitPane(baseLayout, targetPaneId, zone, {
    nextPaneId,
    size: options.size,
  });
  const nextLayout = normalizePaneLayout({
    ...splitLayout,
    panes: splitLayout.panes.map((pane) =>
      pane.paneId === nextPaneId
        ? {
            ...pane,
            binding: movedBinding,
            localState: movedLocalState,
          }
        : pane,
    ),
    focusedPaneId: nextPaneId,
  });
  return hasCompletePaneCoverage(nextLayout) ? nextLayout : layout;
}

export function closePane(
  layout: WorkspacePaneLayoutState,
  paneId: string,
): WorkspacePaneLayoutState {
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
    layout.focusedPaneId === paneId
      ? (findNearestPane(pane, panes)?.paneId ?? panes[0]!.paneId)
      : layout.focusedPaneId;
  return compactUnusedPaneTracks(normalizePaneLayout({ ...layout, panes, focusedPaneId }));
}

export function movePaneToSpanningRow(
  layout: WorkspacePaneLayoutState,
  paneId: string,
  placement: PaneSpanPlacement,
  options: { size?: number } = {},
): WorkspacePaneLayoutState {
  const pane = layout.panes.find((candidate) => candidate.paneId === paneId);
  if (!pane || layout.panes.length === 1) {
    return layout;
  }
  if (isPaneAlreadySpanningEdge(pane, layout, placement)) {
    return touch({ ...layout, focusedPaneId: paneId });
  }

  if (placement === "left" || placement === "right") {
    const columnIndex = placement === "left" ? 0 : layout.columns.length;
    const sourceColumnIndex = placement === "left" ? 0 : layout.columns.length - 1;
    const sourceColumn = layout.columns[sourceColumnIndex];
    if (!sourceColumn) {
      return layout;
    }

    const size = clampSize(options.size ?? 0.36);
    const newTrackPercent = sourceColumn.percent * size;
    const oldTrackPercent = sourceColumn.percent - newTrackPercent;
    const nextColumns = [
      ...layout.columns.slice(0, columnIndex),
      { id: `col-${createPaneId()}`, percent: newTrackPercent },
      ...layout.columns.slice(columnIndex),
    ].map((column, index) =>
      index === (columnIndex <= sourceColumnIndex ? sourceColumnIndex + 1 : sourceColumnIndex)
        ? { ...column, percent: oldTrackPercent }
        : column,
    );

    const repairedPanes = expandAdjacentPaneIntoVacancy(
      pane,
      layout.panes.filter((candidate) => candidate.paneId !== paneId),
    ).map((candidate) => ({
      ...candidate,
      columnStart:
        candidate.columnStart >= columnIndex ? candidate.columnStart + 1 : candidate.columnStart,
      columnEnd: candidate.columnEnd > columnIndex ? candidate.columnEnd + 1 : candidate.columnEnd,
    }));
    const spanningPane: PaneGridPane = {
      ...pane,
      columnStart: columnIndex,
      columnEnd: columnIndex + 1,
      rowStart: 0,
      rowEnd: layout.rows.length,
    };

    const nextLayout = normalizePaneLayout({
      ...layout,
      columns: nextColumns,
      panes: [...repairedPanes, spanningPane],
      focusedPaneId: paneId,
    });
    const compactedLayout = compactUnusedPaneTracks(nextLayout);
    return hasCompletePaneCoverage(compactedLayout) ? compactedLayout : layout;
  }

  const rowIndex = placement === "top" ? 0 : layout.rows.length;
  const sourceRowIndex = placement === "top" ? 0 : layout.rows.length - 1;
  const sourceRow = layout.rows[sourceRowIndex];
  if (!sourceRow) {
    return layout;
  }

  const size = clampSize(options.size ?? 0.36);
  const newTrackPercent = sourceRow.percent * size;
  const oldTrackPercent = sourceRow.percent - newTrackPercent;
  const nextRows = [
    ...layout.rows.slice(0, rowIndex),
    { id: `row-${createPaneId()}`, percent: newTrackPercent },
    ...layout.rows.slice(rowIndex),
  ].map((row, index) =>
    index === (rowIndex <= sourceRowIndex ? sourceRowIndex + 1 : sourceRowIndex)
      ? { ...row, percent: oldTrackPercent }
      : row,
  );

  const repairedPanes = expandAdjacentPaneIntoVacancy(
    pane,
    layout.panes.filter((candidate) => candidate.paneId !== paneId),
  ).map((candidate) => ({
    ...candidate,
    rowStart: candidate.rowStart >= rowIndex ? candidate.rowStart + 1 : candidate.rowStart,
    rowEnd: candidate.rowEnd > rowIndex ? candidate.rowEnd + 1 : candidate.rowEnd,
  }));
  const spanningPane: PaneGridPane = {
    ...pane,
    columnStart: 0,
    columnEnd: layout.columns.length,
    rowStart: rowIndex,
    rowEnd: rowIndex + 1,
  };

  const nextLayout = normalizePaneLayout({
    ...layout,
    rows: nextRows,
    panes: [...repairedPanes, spanningPane],
    focusedPaneId: paneId,
  });
  const compactedLayout = compactUnusedPaneTracks(nextLayout);
  return hasCompletePaneCoverage(compactedLayout) ? compactedLayout : layout;
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

export function getPaneLocationLabel(
  layout: WorkspacePaneLayoutState,
  paneId: string,
): string | null {
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
  predicate: (binding: WorkspacePaneSurfaceTarget) => boolean,
): { paneId: string; label: string; focused: boolean }[] {
  return layout.panes
    .filter(
      (pane): pane is PaneGridPane & { binding: WorkspacePaneSurfaceTarget } =>
        !!pane.binding && predicate(pane.binding),
    )
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

function hasCompletePaneCoverage(layout: WorkspacePaneLayoutState): boolean {
  if (layout.columns.length === 0 || layout.rows.length === 0 || layout.panes.length === 0) {
    return false;
  }

  const occupiedCells = new Set<string>();
  const paneIds = new Set<string>();
  for (const pane of layout.panes) {
    if (paneIds.has(pane.paneId)) {
      return false;
    }
    paneIds.add(pane.paneId);
    if (
      pane.columnStart < 0 ||
      pane.rowStart < 0 ||
      pane.columnEnd > layout.columns.length ||
      pane.rowEnd > layout.rows.length ||
      pane.columnStart >= pane.columnEnd ||
      pane.rowStart >= pane.rowEnd
    ) {
      return false;
    }

    for (let column = pane.columnStart; column < pane.columnEnd; column += 1) {
      for (let row = pane.rowStart; row < pane.rowEnd; row += 1) {
        const key = `${column}:${row}`;
        if (occupiedCells.has(key)) {
          return false;
        }
        occupiedCells.add(key);
      }
    }
  }

  return occupiedCells.size === layout.columns.length * layout.rows.length;
}

function isPaneAlreadyPlaced(
  source: PaneGridPane,
  target: PaneGridPane,
  zone: PaneSplitDirection,
): boolean {
  switch (zone) {
    case "left":
      return (
        source.columnEnd === target.columnStart &&
        source.rowStart === target.rowStart &&
        source.rowEnd === target.rowEnd
      );
    case "right":
      return (
        source.columnStart === target.columnEnd &&
        source.rowStart === target.rowStart &&
        source.rowEnd === target.rowEnd
      );
    case "above":
      return (
        source.rowEnd === target.rowStart &&
        source.columnStart === target.columnStart &&
        source.columnEnd === target.columnEnd
      );
    case "below":
      return (
        source.rowStart === target.rowEnd &&
        source.columnStart === target.columnStart &&
        source.columnEnd === target.columnEnd
      );
  }
}

function isPaneAlreadySpanningEdge(
  pane: PaneGridPane,
  layout: WorkspacePaneLayoutState,
  placement: PaneSpanPlacement,
): boolean {
  switch (placement) {
    case "left":
      return (
        pane.columnStart === 0 &&
        pane.columnEnd === 1 &&
        pane.rowStart === 0 &&
        pane.rowEnd === layout.rows.length
      );
    case "right":
      return (
        pane.columnStart === layout.columns.length - 1 &&
        pane.columnEnd === layout.columns.length &&
        pane.rowStart === 0 &&
        pane.rowEnd === layout.rows.length
      );
    case "top":
      return (
        pane.rowStart === 0 &&
        pane.rowEnd === 1 &&
        pane.columnStart === 0 &&
        pane.columnEnd === layout.columns.length
      );
    case "bottom":
      return (
        pane.rowStart === layout.rows.length - 1 &&
        pane.rowEnd === layout.rows.length &&
        pane.columnStart === 0 &&
        pane.columnEnd === layout.columns.length
      );
  }
}

function compactUnusedPaneTracks(layout: WorkspacePaneLayoutState): WorkspacePaneLayoutState {
  let columns = layout.columns.map((column) => ({ ...column }));
  let rows = layout.rows.map((row) => ({ ...row }));
  let panes = layout.panes.map((pane) => ({ ...pane }));

  ({ tracks: columns, panes } = compactUnusedAxisTracks(columns, panes, "column"));
  ({ tracks: rows, panes } = compactUnusedAxisTracks(rows, panes, "row"));

  return {
    ...layout,
    columns: normalizeTracks(columns),
    rows: normalizeTracks(rows),
    panes,
  };
}

function compactUnusedAxisTracks(
  tracks: PaneGridTrack[],
  panes: PaneGridPane[],
  axis: PaneResizeAxis,
): { tracks: PaneGridTrack[]; panes: PaneGridPane[] } {
  let nextTracks = tracks;
  let nextPanes = panes;
  let lineIndex = 1;

  while (lineIndex < nextTracks.length) {
    const lineIsPaneBoundary = nextPanes.some((pane) =>
      axis === "column"
        ? pane.columnStart === lineIndex || pane.columnEnd === lineIndex
        : pane.rowStart === lineIndex || pane.rowEnd === lineIndex,
    );
    if (lineIsPaneBoundary) {
      lineIndex += 1;
      continue;
    }

    nextTracks = [
      ...nextTracks.slice(0, lineIndex - 1),
      {
        ...nextTracks[lineIndex - 1]!,
        percent: nextTracks[lineIndex - 1]!.percent + nextTracks[lineIndex]!.percent,
      },
      ...nextTracks.slice(lineIndex + 1),
    ];
    nextPanes = nextPanes.map((pane) =>
      axis === "column"
        ? {
            ...pane,
            columnStart: pane.columnStart > lineIndex ? pane.columnStart - 1 : pane.columnStart,
            columnEnd: pane.columnEnd > lineIndex ? pane.columnEnd - 1 : pane.columnEnd,
          }
        : {
            ...pane,
            rowStart: pane.rowStart > lineIndex ? pane.rowStart - 1 : pane.rowStart,
            rowEnd: pane.rowEnd > lineIndex ? pane.rowEnd - 1 : pane.rowEnd,
          },
    );
  }

  return { tracks: nextTracks, panes: nextPanes };
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

function expandAdjacentPaneIntoVacancy(
  closedPane: PaneGridPane,
  panes: PaneGridPane[],
): PaneGridPane[] {
  const rightStrip = findCoveringAdjacentStrip(
    panes.filter((pane) => pane.columnStart === closedPane.columnEnd),
    "row",
    closedPane.rowStart,
    closedPane.rowEnd,
  );
  if (rightStrip) {
    return panes.map((pane) =>
      rightStrip.has(pane.paneId) ? { ...pane, columnStart: closedPane.columnStart } : pane,
    );
  }

  const leftStrip = findCoveringAdjacentStrip(
    panes.filter((pane) => pane.columnEnd === closedPane.columnStart),
    "row",
    closedPane.rowStart,
    closedPane.rowEnd,
  );
  if (leftStrip) {
    return panes.map((pane) =>
      leftStrip.has(pane.paneId) ? { ...pane, columnEnd: closedPane.columnEnd } : pane,
    );
  }

  const belowStrip = findCoveringAdjacentStrip(
    panes.filter((pane) => pane.rowStart === closedPane.rowEnd),
    "column",
    closedPane.columnStart,
    closedPane.columnEnd,
  );
  if (belowStrip) {
    return panes.map((pane) =>
      belowStrip.has(pane.paneId) ? { ...pane, rowStart: closedPane.rowStart } : pane,
    );
  }

  const aboveStrip = findCoveringAdjacentStrip(
    panes.filter((pane) => pane.rowEnd === closedPane.rowStart),
    "column",
    closedPane.columnStart,
    closedPane.columnEnd,
  );
  if (aboveStrip) {
    return panes.map((pane) =>
      aboveStrip.has(pane.paneId) ? { ...pane, rowEnd: closedPane.rowEnd } : pane,
    );
  }

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

function findCoveringAdjacentStrip(
  candidates: PaneGridPane[],
  axis: "column" | "row",
  rangeStart: number,
  rangeEnd: number,
): Set<string> | null {
  const coveringPanes = candidates
    .filter((pane) =>
      axis === "column"
        ? pane.columnStart >= rangeStart && pane.columnEnd <= rangeEnd
        : pane.rowStart >= rangeStart && pane.rowEnd <= rangeEnd,
    )
    .sort((left, right) =>
      axis === "column" ? left.columnStart - right.columnStart : left.rowStart - right.rowStart,
    );
  if (coveringPanes.length === 0) {
    return null;
  }

  let cursor = rangeStart;
  for (const pane of coveringPanes) {
    const start = axis === "column" ? pane.columnStart : pane.rowStart;
    const end = axis === "column" ? pane.columnEnd : pane.rowEnd;
    if (start !== cursor) {
      return null;
    }
    cursor = end;
  }

  if (cursor !== rangeEnd) {
    return null;
  }

  return new Set(coveringPanes.map((pane) => pane.paneId));
}
