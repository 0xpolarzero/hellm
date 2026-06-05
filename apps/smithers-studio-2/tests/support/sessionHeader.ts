/**
 * The HTTP header that carries a per-test isolation key to the workspace-API
 * fixture. Every browser request the page makes AND every Playwright
 * `request` API call a spec makes both ride through vite's proxy to the
 * workspace-API server; that server keys ALL of its mutable JJHub / launch /
 * chat-fault state by this header (see tests/fixtures/workspaceApiServer.ts).
 *
 * Because the studio app makes no custom-header fetches of its own, injecting
 * this header via Playwright's `extraHTTPHeaders` (which applies to BOTH the
 * browser context and the `request` fixture) is invisible to the app and
 * forwarded verbatim by the vite proxy. A request with NO session header falls
 * back to the shared default bucket (used by `bun dev`, where there is exactly
 * one human session).
 */
export const STUDIO_SESSION_HEADER = "x-studio-session";
