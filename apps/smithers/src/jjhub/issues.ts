import { parseLinkCursor } from "./parseLinkCursor";
import { platformFetch } from "./platformFetch";
import {
  PlatformError,
  platformErrorFromBody,
  readPlatformJson,
} from "./platformJson";

/**
 * Issue tracker entities from jjhub. The Plue REST shape mirrors GitHub's
 * issues API closely enough that the same shapes work for tickets and the
 * issues feature card.
 */
export type IssueState = "open" | "closed";

export type IssueLabel = {
  name: string;
  color: string;
};

export type IssueUser = {
  id: string;
  username: string;
  avatarUrl: string;
};

export type Issue = {
  id: string;
  number: number;
  title: string;
  body: string;
  state: IssueState;
  htmlUrl: string;
  labels: IssueLabel[];
  assignees: IssueUser[];
  user: IssueUser | null;
  commentCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
};

export type IssueListPage = {
  issues: Issue[];
  nextCursor: string | null;
};

export type ListIssuesOptions = {
  cursor?: string | null;
  limit?: number;
  state?: IssueState | "all";
  labels?: string[];
  sort?: "created" | "updated" | "comments";
  direction?: "asc" | "desc";
  signal?: AbortSignal;
};

function buildQuery(options: ListIssuesOptions): string {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.state) params.set("state", options.state);
  if (options.labels && options.labels.length > 0) {
    params.set("labels", options.labels.join(","));
  }
  if (options.sort) params.set("sort", options.sort);
  if (options.direction) params.set("direction", options.direction);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function parseUser(value: unknown): IssueUser | null {
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

function parseLabel(value: unknown): IssueLabel | null {
  if (value === null || typeof value !== "object") return null;
  const label = value as Record<string, unknown>;
  if (typeof label.name !== "string") return null;
  return {
    name: label.name,
    color: typeof label.color === "string" ? label.color : "",
  };
}

function parseIssue(value: unknown): Issue | null {
  if (value === null || typeof value !== "object") return null;
  const i = value as Record<string, unknown>;
  const number = i.number;
  const id = i.id ?? number;
  const title = i.title;
  if (typeof number !== "number" || typeof title !== "string") return null;
  const state: IssueState = i.state === "closed" ? "closed" : "open";
  const labels = Array.isArray(i.labels)
    ? i.labels.map(parseLabel).filter((l): l is IssueLabel => l !== null)
    : [];
  const assignees = Array.isArray(i.assignees)
    ? i.assignees.map(parseUser).filter((u): u is IssueUser => u !== null)
    : [];
  return {
    id: String(id ?? number),
    number,
    title,
    body: typeof i.body === "string" ? i.body : "",
    state,
    htmlUrl: typeof i.html_url === "string" ? i.html_url : "",
    labels,
    assignees,
    user: parseUser(i.user),
    commentCount: typeof i.comments === "number" ? i.comments : 0,
    createdAt: typeof i.created_at === "string" ? i.created_at : null,
    updatedAt: typeof i.updated_at === "string" ? i.updated_at : null,
    closedAt: typeof i.closed_at === "string" ? i.closed_at : null,
  };
}

function parseIssueListBody(body: unknown): Issue[] {
  const list = Array.isArray(body) ? body : [];
  const issues: Issue[] = [];
  for (const value of list) {
    const issue = parseIssue(value);
    if (issue) issues.push(issue);
  }
  return issues;
}

function issuesPath(owner: string, repo: string): string {
  return `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
}

/** A single page of issues for `owner/repo`. */
export async function listIssues(
  owner: string,
  repo: string,
  options: ListIssuesOptions = {},
): Promise<IssueListPage> {
  const response = await platformFetch(`${issuesPath(owner, repo)}${buildQuery(options)}`, {
    signal: options.signal,
  });
  const body = await readPlatformJson(response);
  if (!response.ok) throw platformErrorFromBody(response.status, body);
  return {
    issues: parseIssueListBody(body),
    nextCursor: parseLinkCursor(response.headers.get("Link")),
  };
}

/** Walk every page; bounded by `maxPages`. */
export async function listAllIssues(
  owner: string,
  repo: string,
  options: ListIssuesOptions = {},
  maxPages = 50,
): Promise<Issue[]> {
  const all: Issue[] = [];
  let cursor: string | null | undefined = options.cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await listIssues(owner, repo, { ...options, cursor });
    all.push(...result.issues);
    if (!result.nextCursor) return all;
    cursor = result.nextCursor;
  }
  return all;
}

/** Issues the signed-in user is involved in across every repo. */
export async function listUserIssues(options: ListIssuesOptions = {}): Promise<IssueListPage> {
  const response = await platformFetch(`/api/user/issues${buildQuery(options)}`, {
    signal: options.signal,
  });
  const body = await readPlatformJson(response);
  if (!response.ok) throw platformErrorFromBody(response.status, body);
  return {
    issues: parseIssueListBody(body),
    nextCursor: parseLinkCursor(response.headers.get("Link")),
  };
}

export type CreateIssueInput = {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
};

/** Open a new issue on `owner/repo`. */
export async function createIssue(
  owner: string,
  repo: string,
  input: CreateIssueInput,
): Promise<Issue> {
  const response = await platformFetch(issuesPath(owner, repo), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readPlatformJson(response);
  if (!response.ok) throw platformErrorFromBody(response.status, body);
  const parsed = parseIssue(body);
  if (!parsed) throw new PlatformError(502, "invalid_issue", "Malformed issue payload");
  return parsed;
}

export type UpdateIssueInput = {
  title?: string;
  body?: string;
  state?: IssueState;
  labels?: string[];
  assignees?: string[];
};

/** Patch a single issue; returns the updated row. */
export async function updateIssue(
  owner: string,
  repo: string,
  number: number,
  input: UpdateIssueInput,
): Promise<Issue> {
  const response = await platformFetch(`${issuesPath(owner, repo)}/${number}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readPlatformJson(response);
  if (!response.ok) throw platformErrorFromBody(response.status, body);
  const parsed = parseIssue(body);
  if (!parsed) throw new PlatformError(502, "invalid_issue", "Malformed issue payload");
  return parsed;
}
