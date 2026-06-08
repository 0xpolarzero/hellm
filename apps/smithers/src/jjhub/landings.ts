import { parseLinkCursor } from "./parseLinkCursor";
import { platformFetch } from "./platformFetch";
import {
  PlatformError,
  platformErrorFromBody,
  readPlatformJson,
} from "./platformJson";

/**
 * Landings (Plue's landing-request entity, the merge-into-trunk artifact). The
 * payload mirrors GitHub-style pull-request fields tightly enough that the same
 * shape works for both. Only modeled fields the UI consumes.
 */
export type LandingState = "open" | "merged" | "closed";

export type LandingUser = {
  id: string;
  username: string;
  avatarUrl: string;
};

export type Landing = {
  id: string;
  number: number;
  title: string;
  body: string;
  state: LandingState;
  htmlUrl: string;
  baseRef: string;
  headRef: string;
  user: LandingUser | null;
  draft: boolean;
  mergeable: boolean | null;
  merged: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  mergedAt: string | null;
  closedAt: string | null;
};

export type LandingListPage = {
  landings: Landing[];
  nextCursor: string | null;
};

export type ListLandingsOptions = {
  cursor?: string | null;
  limit?: number;
  state?: LandingState | "all";
  sort?: "created" | "updated" | "popularity";
  direction?: "asc" | "desc";
  signal?: AbortSignal;
};

function buildQuery(options: ListLandingsOptions): string {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.state) params.set("state", options.state);
  if (options.sort) params.set("sort", options.sort);
  if (options.direction) params.set("direction", options.direction);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function parseUser(value: unknown): LandingUser | null {
  if (value === null || typeof value !== "object") return null;
  const u = value as Record<string, unknown>;
  const id = u.id;
  const username = u.username ?? u.login;
  if ((typeof id !== "string" && typeof id !== "number") || typeof username !== "string") {
    return null;
  }
  return {
    id: String(id),
    username,
    avatarUrl: typeof u.avatar_url === "string" ? u.avatar_url : "",
  };
}

function parseLanding(value: unknown): Landing | null {
  if (value === null || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  const number = p.number;
  const id = p.id ?? number;
  const title = p.title;
  if (typeof number !== "number" || typeof title !== "string") return null;
  let state: LandingState;
  if (p.state === "merged" || p.merged === true) state = "merged";
  else if (p.state === "closed") state = "closed";
  else state = "open";
  const base =
    typeof p.base === "object" && p.base !== null
      ? String((p.base as Record<string, unknown>).ref ?? "")
      : "";
  const head =
    typeof p.head === "object" && p.head !== null
      ? String((p.head as Record<string, unknown>).ref ?? "")
      : "";
  return {
    id: String(id ?? number),
    number,
    title,
    body: typeof p.body === "string" ? p.body : "",
    state,
    htmlUrl: typeof p.html_url === "string" ? p.html_url : "",
    baseRef: base,
    headRef: head,
    user: parseUser(p.user),
    draft: p.draft === true,
    mergeable: typeof p.mergeable === "boolean" ? p.mergeable : null,
    merged: p.merged === true,
    createdAt: typeof p.created_at === "string" ? p.created_at : null,
    updatedAt: typeof p.updated_at === "string" ? p.updated_at : null,
    mergedAt: typeof p.merged_at === "string" ? p.merged_at : null,
    closedAt: typeof p.closed_at === "string" ? p.closed_at : null,
  };
}

function parseLandingListBody(body: unknown): Landing[] {
  const list = Array.isArray(body) ? body : [];
  const landings: Landing[] = [];
  for (const value of list) {
    const landing = parseLanding(value);
    if (landing) landings.push(landing);
  }
  return landings;
}

function landingsPath(owner: string, repo: string): string {
  return `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/landings`;
}

/** Landings for `owner/repo`. */
export async function listLandings(
  owner: string,
  repo: string,
  options: ListLandingsOptions = {},
): Promise<LandingListPage> {
  const response = await platformFetch(`${landingsPath(owner, repo)}${buildQuery(options)}`, {
    signal: options.signal,
  });
  const body = await readPlatformJson(response);
  if (!response.ok) throw platformErrorFromBody(response.status, body);
  return {
    landings: parseLandingListBody(body),
    nextCursor: parseLinkCursor(response.headers.get("Link")),
  };
}

/** Walk every page. */
export async function listAllLandings(
  owner: string,
  repo: string,
  options: ListLandingsOptions = {},
  maxPages = 50,
): Promise<Landing[]> {
  const all: Landing[] = [];
  let cursor: string | null | undefined = options.cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await listLandings(owner, repo, { ...options, cursor });
    all.push(...result.landings);
    if (!result.nextCursor) return all;
    cursor = result.nextCursor;
  }
  return all;
}

/** Landings the signed-in user has open across every repo. */
export async function listUserLandings(
  options: ListLandingsOptions = {},
): Promise<LandingListPage> {
  const response = await platformFetch(`/api/user/landings${buildQuery(options)}`, {
    signal: options.signal,
  });
  const body = await readPlatformJson(response);
  if (!response.ok) throw platformErrorFromBody(response.status, body);
  return {
    landings: parseLandingListBody(body),
    nextCursor: parseLinkCursor(response.headers.get("Link")),
  };
}

/** One landing by `owner/repo/number`. */
export async function getLanding(owner: string, repo: string, number: number): Promise<Landing> {
  const response = await platformFetch(`${landingsPath(owner, repo)}/${number}`);
  const body = await readPlatformJson(response);
  if (!response.ok) throw platformErrorFromBody(response.status, body);
  const parsed = parseLanding(body);
  if (!parsed) throw new PlatformError(502, "invalid_landing", "Malformed landing payload");
  return parsed;
}
