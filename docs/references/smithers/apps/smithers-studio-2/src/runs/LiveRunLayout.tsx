import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useElementWidth } from "./useElementWidth";
import { useInspectorFraction } from "./useInspectorFraction";

const BREAKPOINT = 800;
const MIN_PANE = 320;
const DIVIDER_WIDTH = 6;

/**
 * Responsive live-run layout (port of gui/LiveRunLayout.swift).
 *
 * WIDE (>= 800px): tree pane | draggable 6px divider | inspector pane, with the
 * inspector fraction persisted and both panes clamped to >= 320px.
 *
 * NARROW (< 800px): the tree fills; when a node is selected the inspector opens
 * as a centered modal sheet over a dimmer. Selection auto-opens the sheet in
 * narrow and the wide layout simply shows it inline.
 */
export function LiveRunLayout(props: {
  hasSelection: boolean;
  sheetOpen: boolean;
  onCloseSheet: () => void;
  tree: ReactNode;
  inspector: ReactNode;
}) {
  const { hasSelection, sheetOpen, onCloseSheet, tree, inspector } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const [fraction, setFraction] = useInspectorFraction();
  const dragRef = useRef<{ startX: number; startFraction: number; total: number } | null>(null);

  // Treat width 0 (pre-measure) as wide so the split renders on first paint.
  const mode: "wide" | "narrow" = width === 0 || width >= BREAKPOINT ? "wide" : "narrow";

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaX = event.clientX - drag.startX;
      // Inspector is on the right: dragging left grows the inspector.
      const rawFraction = drag.startFraction - deltaX / drag.total;
      const minFraction = MIN_PANE / drag.total;
      const maxFraction = 1 - MIN_PANE / drag.total;
      const clamped = Math.min(Math.max(rawFraction, minFraction), maxFraction);
      setFraction(Number(clamped.toFixed(4)));
    },
    [setFraction],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  }, [onPointerMove]);

  useEffect(() => () => endDrag(), [endDrag]);

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      const total = containerRef.current?.getBoundingClientRect().width ?? width;
      dragRef.current = { startX: event.clientX, startFraction: fraction, total };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endDrag);
    },
    [fraction, width, onPointerMove, endDrag],
  );

  if (mode === "narrow") {
    return (
      <div className="runs-layout runs-layout--narrow" ref={containerRef} data-testid="liveRun.layout.narrow">
        <div className="runs-layout-tree runs-layout-tree--full">{tree}</div>
        {sheetOpen && hasSelection ? (
          <>
            <div
              className="runs-sheet-dimmer"
              data-testid="liveRun.layout.sheetDimmer"
              onClick={onCloseSheet}
            />
            <div className="runs-sheet" role="dialog" aria-modal data-testid="liveRun.layout.inspectorSheet">
              {inspector}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="runs-layout runs-layout--wide" ref={containerRef} data-testid="liveRun.layout.wide">
      <div className="runs-layout-tree" style={{ flex: `1 1 ${(1 - fraction) * 100}%`, minWidth: MIN_PANE }}>
        {tree}
      </div>
      <div
        className="runs-layout-divider"
        data-testid="liveRun.layout.divider"
        role="separator"
        aria-orientation="vertical"
        style={{ width: DIVIDER_WIDTH }}
        onPointerDown={startDrag}
      />
      <div
        className="runs-layout-inspector"
        style={{ flex: `0 0 ${fraction * 100}%`, minWidth: MIN_PANE }}
      >
        {inspector}
      </div>
    </div>
  );
}
