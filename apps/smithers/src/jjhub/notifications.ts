import { parseLinkCursor } from "./parseLinkCursor";
import { platformFetch } from "./platformFetch";
import { platformErrorFromBody, readPlatformJson } from "./platformJson";

/**
 * jjhub notifications — the inbox the bell icon in the shell renders. Mirrors
 * the GitHub notifications shape: reason + subject + repo + unread/last-read.
 */
export type NotificationReason =
  | "assign"
  | "author"
  | "comment"
  | "mention"
  | "review_requested"
  | "subscribed"
  | "team_mention"
  | "state_change";

export type NotificationSubjectType =
  | "Issue"
  | "Landing"
  | "PullRequest"
  | "Workspace"
  | "Commit";

export type NotificationSubject = {
  title: string;
  url: string;
  type: NotificationSubjectType | string;
};

export type Notification = {
  id: string;
  unread: boolean;
  reason: NotificationReason | string;
  subject: NotificationSubject;
  repoFullName: string;
  updatedAt: string | null;
  lastReadAt: string | null;
};

export type NotificationListPage = {
  notifications: Notification[];
  nextCursor: string | null;
};

export type ListNotificationsOptions = {
  cursor?: string | null;
  limit?: number;
  all?: boolean;
  /** RFC 3339 — only notifications updated after this timestamp. */
  since?: string;
  signal?: AbortSignal;
};

function buildQuery(options: ListNotificationsOptions): string {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.all === true) params.set("all", "true");
  if (options.since) params.set("since", options.since);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function parseSubject(value: unknown): NotificationSubject | null {
  if (value === null || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  if (typeof s.title !== "string") return null;
  return {
    title: s.title,
    url: typeof s.url === "string" ? s.url : "",
    type: typeof s.type === "string" ? s.type : "Issue",
  };
}

function parseNotification(value: unknown): Notification | null {
  if (value === null || typeof value !== "object") return null;
  const n = value as Record<string, unknown>;
  const id = n.id;
  if (typeof id !== "string" && typeof id !== "number") return null;
  const subject = parseSubject(n.subject);
  if (!subject) return null;
  const repository = n.repository;
  const repoFullName =
    typeof repository === "object" && repository !== null
      ? String((repository as Record<string, unknown>).full_name ?? "")
      : "";
  return {
    id: String(id),
    unread: n.unread !== false,
    reason: typeof n.reason === "string" ? (n.reason as NotificationReason) : "subscribed",
    subject,
    repoFullName,
    updatedAt: typeof n.updated_at === "string" ? n.updated_at : null,
    lastReadAt: typeof n.last_read_at === "string" ? n.last_read_at : null,
  };
}

function parseNotificationListBody(body: unknown): Notification[] {
  const list = Array.isArray(body) ? body : [];
  const items: Notification[] = [];
  for (const value of list) {
    const n = parseNotification(value);
    if (n) items.push(n);
  }
  return items;
}

/** Inbox for the signed-in user. */
export async function listNotifications(
  options: ListNotificationsOptions = {},
): Promise<NotificationListPage> {
  const response = await platformFetch(`/api/notifications${buildQuery(options)}`, {
    signal: options.signal,
  });
  const body = await readPlatformJson(response);
  if (!response.ok) throw platformErrorFromBody(response.status, body);
  return {
    notifications: parseNotificationListBody(body),
    nextCursor: parseLinkCursor(response.headers.get("Link")),
  };
}

/** Walk every page. */
export async function listAllNotifications(
  options: ListNotificationsOptions = {},
  maxPages = 50,
): Promise<Notification[]> {
  const all: Notification[] = [];
  let cursor: string | null | undefined = options.cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await listNotifications({ ...options, cursor });
    all.push(...result.notifications);
    if (!result.nextCursor) return all;
    cursor = result.nextCursor;
  }
  return all;
}

/** Mark all the user's notifications as read; cuts the unread badge to zero. */
export async function markAllNotificationsRead(): Promise<void> {
  const response = await platformFetch(`/api/notifications`, { method: "PUT" });
  if (response.status === 205 || response.ok) return;
  const body = await readPlatformJson(response);
  throw platformErrorFromBody(response.status, body);
}
