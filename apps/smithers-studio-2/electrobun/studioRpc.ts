import { BrowserView } from "electrobun/bun";
import type { StudioRpcSchema } from "../src/desktopRpc";
import type {
  WorkspaceBackendRequest,
  WorkspaceBackendResponse,
  WorkspaceStatus,
} from "../src/workspaceProtocol";

const RPC_MAX_REQUEST_MS = 30_000;

// Where the desktop shell forwards workspace API traffic when no in-process
// backend is bundled. The Vite app currently talks to this over plain HTTP
// (see src/workspaceApi.ts), and the SPA's `getDesktopRpc()` is stubbed to
// null — so these handlers are a forward-compatible bridge, not yet the active
// data path. They proxy to the same `/__smithers_studio` surface the web build
// uses, against a local Smithers Gateway origin.
const WORKSPACE_ORIGIN =
  process.env.SMITHERS_STUDIO_WORKSPACE_ORIGIN ?? "http://127.0.0.1:7331";

async function loadWorkspaceStatus(): Promise<WorkspaceStatus> {
  const response = await fetch(`${WORKSPACE_ORIGIN}/__smithers_studio/workspace`);
  return (await response.json()) as WorkspaceStatus;
}

async function handleWorkspaceRequest(
  request: WorkspaceBackendRequest,
): Promise<WorkspaceBackendResponse> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (typeof value === "string") {
      search.set(key, value);
    }
  }
  const queryString = search.toString();
  const url =
    `${WORKSPACE_ORIGIN}/__smithers_studio/api${request.path}` +
    (queryString ? `?${queryString}` : "");
  const response = await fetch(url, {
    method: request.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  return { status: response.status, payload };
}

// Defines the Bun-side half of the typed RPC channel shared with the webview.
export function defineStudioRpc() {
  return BrowserView.defineRPC<StudioRpcSchema>({
    maxRequestTime: RPC_MAX_REQUEST_MS,
    handlers: {
      requests: {
        workspaceStatus: () => loadWorkspaceStatus(),
        workspaceRequest: async (request) => {
          try {
            return await handleWorkspaceRequest(request);
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { status: 500, payload: { error: message } };
          }
        },
      },
    },
  });
}
