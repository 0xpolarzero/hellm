import { parseLinkCursor } from "./parseLinkCursor";
import { platformFetch } from "./platformFetch";
import {
  PlatformError,
  platformErrorFromBody,
  readPlatformJson,
} from "./platformJson";

/**
 * Repo entities returned by jjhub's REST API. Names follow the wire format
 * (snake_case) on the way in; callers can re-map for display. We only model
 * the fields the UI actually consumes, so an extra wire field never crashes
 * the parser.
 *
 * `id` is always a string. jjhub returns numeric ids in the GitHub-compatible
 * REST shape, but the cloud also runs alongside services that issue UUIDs;
 * stringifying once at parse time means consumers never have to care.
 */
export type Repo = {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  description: string;
  isPrivate: boolean;
  defaultBranch: string;
  htmlUrl: string;
  starsCount: number;
  forksCount: number;
  openIssuesCount: number;
  pushedAt: string | null;
  updatedAt: string | null;
};

export type RepoListPage = {
  repos: Repo[];
  /** Cursor for the next page (null when this is the last page). */
  nextCursor: string | null;
};

export type RepoVisibility = "all" | "public" | "private";

export type ListReposOptions = {
  cursor?: string | null;
  limit?: number;
  visibility?: RepoVisibility;
  sort?: "updated" | "created" | "pushed" | "full_name";
  signal?: AbortSignal;
};

function buildQuery(options: ListReposOptions): string {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.visibility && options.visibility !== "all") {
    params.set("visibility", options.visibility);
  }
  if (options.sort) params.set("sort", options.sort);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function parseRepo(value: unknown): Repo | null {
  if (value === null || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const fullName = typeof r.full_name === "string" ? r.full_name : null;
  // Accept either a number (jjhub's REST shape, GitHub-compatible) or a string
  // (UUID-emitting deployments). Stringify once so the rest of the app sees a
  // single shape — previously this dropped the whole row when id was a UUID.
  const rawId = r.id;
  const id =
    typeof rawId === "number" || typeof rawId === "string" ? String(rawId) : null;
  if (id === null || fullName === null) return null;
  const owner =
    typeof r.owner === "object" && r.owner !== null
      ? String((r.owner as Record<string, unknown>).username ?? (r.owner as Record<string, unknown>).login ?? "")
      : "";
  const inferredOwner = owner || fullName.split("/")[0] || "";
  const inferredName = (fullName.split("/")[1] ?? "") || (typeof r.name === "string" ? r.name : "");
  return {
    id,
    fullName,
    owner: inferredOwner,
    name: inferredName,
    description: typeof r.description === "string" ? r.description : "",
    isPrivate: r.private === true || r.is_private === true,
    defaultBranch:
      typeof r.default_branch === "string" && r.default_branch ? r.default_branch : "main",
    htmlUrl: typeof r.html_url === "string" ? r.html_url : "",
    starsCount: typeof r.stars_count === "number" ? r.stars_count : 0,
    forksCount: typeof r.forks_count === "number" ? r.forks_count : 0,
    openIssuesCount: typeof r.open_issues_count === "number" ? r.open_issues_count : 0,
    pushedAt: typeof r.pushed_at === "string" ? r.pushed_at : null,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

/**
 * Parse a list page: tolerate either `[repos]` or `{ data: [repos] }`. jjhub
 * uses the first shape, but a future envelope is cheap to support and the
 * cursor lives on the `Link` header either way.
 */
function parseRepoListBody(body: unknown): Repo[] {
  const list =
    Array.isArray(body)
      ? body
      : Array.isArray((body as { data?: unknown } | null)?.data)
        ? ((body as { data: unknown[] }).data)
        : [];
  const repos: Repo[] = [];
  for (const value of list) {
    const repo = parseRepo(value);
    if (repo) repos.push(repo);
  }
  return repos;
}

/**
 * Fetch a single page of the signed-in user's repos. Pagination follows
 * jjhub's `Link: <…?cursor=…>; rel="next"` convention; pass the returned
 * `nextCursor` back in as `options.cursor` to walk forward.
 */
export async function listUserRepos(options: ListReposOptions = {}): Promise<RepoListPage> {
  const response = await platformFetch(`/api/user/repos${buildQuery(options)}`, {
    signal: options.signal,
  });
  const body = await readPlatformJson(response);
  if (!response.ok) throw platformErrorFromBody(response.status, body);
  return {
    repos: parseRepoListBody(body),
    nextCursor: parseLinkCursor(response.headers.get("Link")),
  };
}

/** Same shape as `listUserRepos`, but for the read-permission-only set. */
export async function listUserReadableRepos(
  options: ListReposOptions = {},
): Promise<RepoListPage> {
  const response = await platformFetch(`/api/user/readable-repos${buildQuery(options)}`, {
    signal: options.signal,
  });
  const body = await readPlatformJson(response);
  if (!response.ok) throw platformErrorFromBody(response.status, body);
  return {
    repos: parseRepoListBody(body),
    nextCursor: parseLinkCursor(response.headers.get("Link")),
  };
}

/** Walk every page of a paginated repo list. Bounded by `maxPages` so a
 *  buggy upstream `Link` header can never spin forever. */
export async function listAllUserRepos(
  options: ListReposOptions = {},
  maxPages = 50,
): Promise<Repo[]> {
  const all: Repo[] = [];
  let cursor: string | null | undefined = options.cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await listUserRepos({ ...options, cursor });
    all.push(...result.repos);
    if (!result.nextCursor) return all;
    cursor = result.nextCursor;
  }
  return all;
}

/** One repo by `owner/repo`. */
export async function getRepo(owner: string, repo: string): Promise<Repo> {
  const response = await platformFetch(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  const body = await readPlatformJson(response);
  if (!response.ok) throw platformErrorFromBody(response.status, body);
  const parsed = parseRepo(body);
  if (!parsed) throw new PlatformError(502, "invalid_repo", "Malformed repo payload");
  return parsed;
}
