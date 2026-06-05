import { create } from "zustand";

/**
 * A tiny store inside the Runs folder that holds the unread pending-approval
 * count. The navRegistry's `badge()` hook for "runs" is synchronous and called
 * during the sidebar render, so it reads this store's snapshot. The Runs
 * surface writes the count whenever it loads/refreshes approvals — that keeps
 * time-sensitive gates visible without the user opening the surface (UX.md).
 *
 * It lives here (not in useStudioStore) per the disjointness rule: per-surface
 * detail state stays in the surface's own folder.
 */
type RunsBadgeState = {
  pendingApprovals: number;
  setPendingApprovals: (count: number) => void;
};

export const useRunsBadgeStore = create<RunsBadgeState>((set) => ({
  pendingApprovals: 0,
  setPendingApprovals: (count) => set({ pendingApprovals: count }),
}));

/**
 * Reactive badge accessor for navRegistry.badge(). It is wired as the "runs"
 * nav item's `badge` callback, which the shell invokes inside the NavRow render
 * body — so this is a React hook that *subscribes* to the store. Returning a
 * bare `getState()` snapshot (the old behavior) read the count once and never
 * re-rendered, leaving the badge dead; subscribing makes the nav row re-render
 * whenever the Runs surface writes a new pending-approval count.
 */
export function runsApprovalsBadge(): number {
  return useRunsBadgeStore((state) => state.pendingApprovals);
}
