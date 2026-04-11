export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_VIEWPORT_RATIO = 0.42;

type SidebarShortcutEvent = Pick<
  KeyboardEvent,
  "defaultPrevented" | "altKey" | "metaKey" | "ctrlKey" | "key"
>;

export function getMaxSidebarWidth(viewportWidth: number): number {
  const viewportCap = Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.floor(viewportWidth * SIDEBAR_VIEWPORT_RATIO),
  );
  return Math.min(MAX_SIDEBAR_WIDTH, viewportCap);
}

export function clampSidebarWidth(width: number, viewportWidth: number): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, getMaxSidebarWidth(viewportWidth)));
}

export function isSidebarToggleShortcut(event: SidebarShortcutEvent): boolean {
  if (event.defaultPrevented || event.altKey) {
    return false;
  }

  if (!(event.metaKey || event.ctrlKey)) {
    return false;
  }

  return event.key.toLowerCase() === "b";
}
