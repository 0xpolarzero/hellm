import { loadWorkspaceStatus, WorkspaceHttpError } from "../workspaceBackend";

/**
 * Resolve the `.smithers` workspace root the chat surface is bound to.
 *
 * Reuses the real workspace detection that backs every other route, so chat
 * targets the same workspace the rest of the Studio surfaces operate on. Throws
 * a 404 `WorkspaceHttpError` when no `.smithers` workspace is found — the chat
 * surface must run against a real workspace, never a fabricated one.
 */
export function resolveChatWorkspaceRoot(): string {
  const status = loadWorkspaceStatus();
  if (!status.root) {
    throw new WorkspaceHttpError(404, `.smithers not found from ${status.cwd}`);
  }
  return status.root;
}
