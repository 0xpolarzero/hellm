import { describe, expect, it } from "bun:test";
import {
  bindPane,
  closePane,
  createEmptyPaneLayout,
  getOpenPaneLocations,
  movePaneToSpanningRow,
  normalizePaneLayout,
  placePane,
  resizeTrack,
  setPaneScroll,
  splitPane,
} from "./pane-layout";
import type { PromptTarget } from "../shared/workspace-contract";

const target: PromptTarget = {
  workspaceSessionId: "session-1",
  surface: "orchestrator",
  surfacePiSessionId: "session-1",
};

describe("pane layout grid", () => {
  it("stores split panes as proportional tracks and deterministic coordinates", () => {
    let layout = createEmptyPaneLayout("2026-04-27T00:00:00.000Z");
    layout = bindPane(layout, "primary", target);
    layout = splitPane(layout, "primary", "right", {
      nextPaneId: "right",
      duplicateBinding: true,
    });
    layout = splitPane(layout, "right", "below", { nextPaneId: "bottom-right" });

    expect(layout.columns.map((column) => Math.round(column.percent))).toEqual([50, 50]);
    expect(layout.rows.map((row) => Math.round(row.percent))).toEqual([50, 50]);
    expect(layout.panes).toContainEqual(
      expect.objectContaining({
        paneId: "right",
        columnStart: 1,
        columnEnd: 2,
        rowStart: 0,
        rowEnd: 1,
        binding: target,
      }),
    );
    expect(layout.panes).toContainEqual(
      expect.objectContaining({
        paneId: "bottom-right",
        columnStart: 1,
        columnEnd: 2,
        rowStart: 1,
        rowEnd: 2,
        binding: null,
      }),
    );
    expect(layout.focusedPaneId).toBe("bottom-right");
  });

  it("resizes adjacent tracks while preserving a normalized percentage total", () => {
    let layout = splitPane(createEmptyPaneLayout(), "primary", "right", {
      nextPaneId: "right",
    });
    layout = resizeTrack(layout, "column", 0, 20);

    expect(Math.round(layout.columns[0]!.percent)).toBe(70);
    expect(Math.round(layout.columns[1]!.percent)).toBe(30);
    expect(Math.round(layout.columns.reduce((sum, track) => sum + track.percent, 0))).toBe(100);
  });

  it("closes panes without deleting the last pane or its durable surface owner", () => {
    let layout = createEmptyPaneLayout();
    layout = bindPane(layout, "primary", target);
    layout = splitPane(layout, "primary", "right", { nextPaneId: "right" });
    layout = closePane(layout, "right");

    expect(layout.panes.map((pane) => pane.paneId)).toEqual(["primary"]);
    expect(layout.panes[0]!.binding).toEqual(target);

    layout = closePane(layout, "primary");
    expect(layout.panes).toHaveLength(1);
    expect(layout.panes[0]!.binding).toBeNull();
  });

  it("expands an adjacent pane into the space released by a close", () => {
    let layout = createEmptyPaneLayout();
    layout = splitPane(layout, "primary", "right", { nextPaneId: "right" });
    layout = splitPane(layout, "right", "below", { nextPaneId: "bottom-right" });
    layout = closePane(layout, "bottom-right");

    expect(layout.panes).toContainEqual(
      expect.objectContaining({
        paneId: "right",
        columnStart: 1,
        columnEnd: 2,
        rowStart: 0,
        rowEnd: 2,
      }),
    );
  });

  it("moves a pane into a full-width spanning row", () => {
    let layout = createEmptyPaneLayout();
    layout = splitPane(layout, "primary", "right", { nextPaneId: "right" });
    layout = splitPane(layout, "right", "below", { nextPaneId: "bottom-right" });
    layout = movePaneToSpanningRow(layout, "bottom-right", "bottom");

    expect(layout.columns).toHaveLength(2);
    expect(layout.panes).toContainEqual(
      expect.objectContaining({
        paneId: "bottom-right",
        columnStart: 0,
        columnEnd: 2,
        rowStart: 2,
        rowEnd: 3,
      }),
    );
    expect(layout.panes).toContainEqual(
      expect.objectContaining({
        paneId: "right",
        columnStart: 1,
        columnEnd: 2,
        rowStart: 0,
        rowEnd: 2,
      }),
    );
  });

  it("normalizes restored layouts and reports open pane locations", () => {
    const layout = normalizePaneLayout({
      ...createEmptyPaneLayout(),
      columns: [
        { id: "a", percent: 2 },
        { id: "b", percent: 2 },
      ],
      rows: [{ id: "r", percent: 4 }],
      panes: [
        {
          ...createEmptyPaneLayout().panes[0]!,
          binding: target,
        },
        {
          ...createEmptyPaneLayout().panes[0]!,
          paneId: "right",
          columnStart: 1,
          columnEnd: 2,
          binding: target,
        },
      ],
      focusedPaneId: "right",
    });

    expect(layout.columns.map((column) => column.percent)).toEqual([50, 50]);
    expect(
      getOpenPaneLocations(
        layout,
        (binding) =>
          (binding.surface === "orchestrator" || binding.surface === "thread") &&
          binding.surfacePiSessionId === "session-1",
      ),
    ).toEqual([
      { paneId: "primary", label: "Left", focused: false },
      { paneId: "right", label: "Right", focused: true },
    ]);
  });

  it("places a dragged pane into a target split zone while preserving local state", () => {
    let layout = createEmptyPaneLayout("2026-04-27T00:00:00.000Z");
    layout = bindPane(layout, "primary", target);
    layout = splitPane(layout, "primary", "right", { nextPaneId: "right" });
    layout = bindPane(layout, "right", {
      ...target,
      workspaceSessionId: "session-2",
      surfacePiSessionId: "session-2",
    });
    layout = setPaneScroll(layout, "right", {
      transcriptAnchorId: "message-2",
      offsetPx: 140,
    });

    layout = placePane(layout, "right", "primary", "below");

    expect(layout.focusedPaneId).toBe("right");
    expect(layout.panes).toContainEqual(
      expect.objectContaining({
        paneId: "right",
        rowStart: 1,
        rowEnd: 2,
        binding: expect.objectContaining({ surfacePiSessionId: "session-2" }),
        localState: expect.objectContaining({
          scroll: {
            transcriptAnchorId: "message-2",
            offsetPx: 140,
          },
        }),
      }),
    );
  });
});
