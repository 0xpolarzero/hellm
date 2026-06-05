import { createWorkspaceApiServer } from "./createWorkspaceApiServer";

/**
 * Boot the real Workspace API server.
 *
 * Entry point invoked by `scripts/dev.ts` (and runnable standalone). Binds to
 * `SMITHERS_STUDIO_WORKSPACE_API_PORT` (default 7410) on 127.0.0.1 and serves
 * the real backend. The workspace it operates on is resolved from
 * `SMITHERS_STUDIO_WORKSPACE` (or the process cwd) by the backend itself.
 */
const port = Number(process.env.SMITHERS_STUDIO_WORKSPACE_API_PORT ?? "7410");
const host = process.env.SMITHERS_STUDIO_WORKSPACE_API_HOST ?? "127.0.0.1";

const server = createWorkspaceApiServer();
server.listen(port, host, () => {
  process.stdout.write(`studio-2 workspace-api server listening on http://${host}:${port}\n`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
