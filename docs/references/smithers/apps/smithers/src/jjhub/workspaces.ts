import { parseLinkCursor } from "./parseLinkCursor";
import { platformFetch } from "./platformFetch";
import {
  PlatformError,
  platformErrorFromBody,
  readPlatformJson,
} from "./platformJson";

/**
 * Workspaces (Plue's container for a running JJHub workspace + matched repos).
 * The wire shape is a thin wrapper; we only expose what the UI renders.
 */
export type WorkspaceState = "running" | "stopped" | "starting" | "error";

export type Workspace = {
  id: string;
  slug: string;
  name: string;
  repoFullName: string;
  branch: string;
  state: WorkspaceState;
  htmlUrl: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type WorkspaceListPage = {
  workspaces: Workspace[];
  nextCursor: string | null;
};

export type ListWorkspacesOptions = {
  cursor?: string | null;
  limit?: number;
  state?: WorkspaceState | "all";
  signal?: AbortSignal;
};

function buildQuery(options: ListWorkspacesOptions): string {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.state) params.set("state", options.state);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function parseWorkspaceState(value: unknown): WorkspaceState {
  if (value === "running" || value === "stopped" || value === "starting" || value === "error") {
    return value;
  }
  return "stopped";
}

function parseWorkspace(value: unknown): Workspace | null {
  if (value === null || typeof value !== "object") return null;
  const w = value as Record<string, unknown>;
  const id = w.id;
  const slug = w.slug;
  if ((typeof id !== "string" && typeof id !== "number") || typeof slug !== "string") {
    return null;
  }
  return {
    id: String(id),
    slug,
    name: typeof w.name === "string" ? w.name : slug,
    repoFullName: typeof w.repo === "string" ? w.repo : typeof w.repo_full_name === "string" ? w.repo_full_name : "",
    branch: typeof w.branch === "string" ? w.branch : "",
    state: parseWorkspaceState(w.state),
    htmlUrl: typeof w.html_url === "string" ? w.html_url : "",
    createdAt: typeof w.created_at === "string" ? w.created_at : null,
    updatedAt: typeof w.updated_at === "string" ? w.updated_at : null,
  };
}

function parseWorkspaceListBody(body: unknown): Workspace[] {
  const list = Array.isArray(body) ? body : [];
  const items: Workspace[] = [];
  for (const value of list) {
    const w = parseWorkspace(value);
    if (w) items.push(w);
  }
  return items;
}

/** The signed-in user's workspaces. */
export async function listUserWorkspaces(
  options: ListWorkspacesOptions = {},
): Promise<WorkspaceListPage> {
  const response = await platformFetch(`/api/user/workspaces${buildQuery(options)}`, {
    signal: options.signal,
  });
  const body = await readPlatformJson(response);
  if (!response.ok) throw platformErrorFromBody(response.status, body);
  return {
    workspaces: parseWorkspaceListBody(body),
    nextCursor: parseLinkCursor(response.headers.get("Link")),
  };
}

/** Walk every page. */
export async function listAllUserWorkspaces(
  options: ListWorkspacesOptions = {},
  maxPages = 50,
): Promise<Workspace[]> {
  const all: Workspace[] = [];
  let cursor: string | null | undefined = options.cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await listUserWorkspaces({ ...options, cursor });
    all.push(...result.workspaces);
    if (!result.nextCursor) return all;
    cursor = result.nextCursor;
  }
  return all;
}

/** One workspace by id (or slug). */
export async function getWorkspace(idOrSlug: string): Promise<Workspace> {
  const response = await platformFetch(`/api/workspaces/${encodeURIComponent(idOrSlug)}`);
  const body = await readPlatformJson(response);
  if (!response.ok) throw platformErrorFromBody(response.status, body);
  const parsed = parseWorkspace(body);
  if (!parsed) throw new PlatformError(502, "invalid_workspace", "Malformed workspace payload");
  return parsed;
}
