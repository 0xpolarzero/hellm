import { BrowserWindow } from "electrobun/bun";
import { defineStudioRpc } from "./studioRpc";

const WINDOW_TITLE = "Smithers Studio";
const WINDOW_X = 0;
const WINDOW_Y = 0;
const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 820;

// In dev (`electrobun dev`) we point the webview at the running Vite dev server
// so HMR works; in a packaged build we load the copied Vite output served under
// the `views://mainview` origin. Set SMITHERS_STUDIO_DEV_URL to override.
function resolveWindowUrl(): string {
  const devUrl = process.env.SMITHERS_STUDIO_DEV_URL;
  if (devUrl) {
    return devUrl;
  }
  return "views://mainview/index.html";
}

// Opens the single top-level window that hosts the Vite-built React app.
export function createMainWindow(): BrowserWindow {
  return new BrowserWindow({
    title: WINDOW_TITLE,
    frame: {
      x: WINDOW_X,
      y: WINDOW_Y,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    },
    url: resolveWindowUrl(),
    rpc: defineStudioRpc(),
  });
}
