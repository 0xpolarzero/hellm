import type { PointerEvent } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Resize bounds for the chat rail, in pixels. A drag narrower than COLLAPSE_AT
 * snaps the rail shut; between COLLAPSE_AT and MIN the width holds at MIN, so
 * there's a small dead zone before it disappears (VS Code-style).
 */
const RAIL_MIN = 260;
const RAIL_MAX = 560;
const RAIL_DEFAULT = 320;
const COLLAPSE_AT = 170;

type RailState = {
  /** Current expanded width in px (meaningless while `collapsed`). */
  width: number;
  /** Whether the rail is dragged fully shut. */
  collapsed: boolean;
  /** True while a drag is in flight — lets the shell lock the cursor. */
  resizing: boolean;
  /** Width to restore to when expanding, even if a drag clamped width to MIN. */
  lastOpenWidth: number;
  expand: () => void;
  onResizeStart: (event: PointerEvent<HTMLElement>) => void;
  onResizeMove: (event: PointerEvent<HTMLElement>) => void;
  onResizeEnd: (event: PointerEvent<HTMLElement>) => void;
};

/**
 * Drag-to-resize state for the sidebar chat rail on the `local` medium. The rail
 * hugs the viewport's left edge, so the pointer's clientX is the rail's width —
 * no measuring needed. Width and collapsed persist; `resizing`/`lastOpenWidth`
 * are transient (see `partialize`).
 */
export const useRailStore = create<RailState>()(
  persist(
    (set) => ({
      width: RAIL_DEFAULT,
      collapsed: false,
      resizing: false,
      lastOpenWidth: RAIL_DEFAULT,
      expand: () => set({ collapsed: false }),
      onResizeStart: (event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        set({ resizing: true });
      },
      onResizeMove: (event) => {
        // Only react to the captured drag, not stray hover moves over the handle.
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
          return;
        }
        const next = event.clientX;
        if (next < COLLAPSE_AT) {
          set({ collapsed: true });
          return;
        }
        const clamped = Math.min(RAIL_MAX, Math.max(RAIL_MIN, next));
        set({ width: clamped, lastOpenWidth: clamped, collapsed: false });
      },
      onResizeEnd: (event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        set({ resizing: false });
      },
    }),
    {
      name: "smithers.rail",
      partialize: (state) => ({ width: state.width, collapsed: state.collapsed }),
    },
  ),
);
