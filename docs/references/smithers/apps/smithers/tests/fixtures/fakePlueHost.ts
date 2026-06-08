/**
 * Deterministic fake of the Plue/jjhub REST API used by apps/smithers e2e and
 * worker proxy tests. This is the *local-only* counterpart of the real Plue
 * docker-compose stack at /Users/williamcory/plue/docker-compose.yml.
 *
 * Routes covered (the apps/smithers browser + worker call set):
 *   GET  /api/user                              session/me
 *   GET  /api/user/repos                        repos list
 *   GET  /api/repos/:owner/:repo                one repo
 *   GET  /api/repos/:owner/:repo/issues         issues list (cursor pagination)
 *   GET  /api/repos/:owner/:repo/issues/:n      one issue
 *   GET  /api/repos/:owner/:repo/landing-requests  landings list (cursor)
 *   GET  /api/repos/:owner/:repo/workspaces     workspaces
 *   GET  /api/notifications                     notifications list
 *   GET  /api/auth/workos/authorize             WorkOS authorize redirect
 *   GET  /api/auth/auth0/authorize              Auth0 authorize redirect
 *   GET  /api/auth/sse-ticket                   SSE ticket (stub)
 *   GET  /health                                trivial 200 (Playwright webServer probe)
 *
 * Authentication
 *   401 unless one of:
 *     • Cookie:        smithers_session=ok
 *     • Authorization: Bearer <SEED_ADMIN_TOKEN|SEED_USER_TOKEN>
 *   403 on admin-only routes (`/api/notifications?admin=1`) for non-admin tokens.
 *
 * Pagination
 *   Lists accept `cursor` and `limit` (default 100). When more items remain,
 *   the response carries `Link: <…?cursor=…>; rel="next"` and the consumer
 *   feeds the cursor back. Cursors are opaque (base64 of the next index).
 *
 * CORS
 *   `Access-Control-Allow-Origin` is echoed for any Origin that points at an
 *   IPv4 loopback (127.0.0.1), an IPv6 loopback ([::1]), or `localhost`
 *   (typical dev/test). Credentials are allowed. `OPTIONS` preflights are
 *   answered immediately.
 *
 * Service tagging
 *   `FAKE_PLUE_SERVICE_LABEL`, when set, attaches a `service_label` field to
 *   `/api/user`, repo objects, list items, and notifications. Tests boot one
 *   host with `auth` and another with `platform` and assert each response
 *   carries the expected label — so split-mode routing fails closed if the
 *   auth and platform proxy targets are accidentally identical.
 *
 * Failure injection
 *   Specs may opt into deterministic failure paths by setting env before
 *   `bun fakePlueHost.ts` boots. None of these are wired in production paths.
 *     FAKE_PLUE_FAIL_REPOS=401|403|500
 *     FAKE_PLUE_FAIL_ISSUES=401|403|500
 *     FAKE_PLUE_FAIL_NOTIFICATIONS=401|403|500
 *     FAKE_PLUE_DOWN=1             — every request returns 503
 *
 *   Per-request override: any request carrying `x-fake-plue-down: 1` (header)
 *   OR `?fake_down=1` (query) returns 503 immediately. Lets a single e2e drive
 *   the configured Plue proxy path into a failure without bouncing the host.
 *
 * Env
 *   FAKE_PLUE_PORT     listen port (default 5290)
 *   FAKE_PLUE_HOST     listen host (default 127.0.0.1)
 *   FAKE_PLUE_SERVICE_LABEL  optional response tag (see "Service tagging")
 */

import {
  DEFAULT_ISSUES_PER_REPO,
  DEFAULT_LANDINGS_PER_REPO,
  DEFAULT_PAGE_SIZE,
  SEED_ADMIN_TOKEN,
  SEED_REPOS,
  SEED_SESSION_COOKIE,
  SEED_USER,
  SEED_USER_TOKEN,
  buildIssues,
  buildLandings,
  buildNotifications,
  buildWorkspaces,
  type PlueIssue,
  type PlueLanding,
  type PlueRepo,
  type PlueWorkspace,
} from "./fakePlueSeed";

type FailureMode = "401" | "403" | "500" | "off";

type HostOptions = {
  port?: number;
  hostname?: string;
  /** Override env for unit-level construction (the Bun server reads
   *  `process.env` by default; tests pass an explicit map). */
  env?: Record<string, string | undefined>;
};

type ServerHandle = {
  origin: string;
  port: number;
  /** Resolves once the listener has stopped. Bun's `server.stop(true)` returns
   *  a Promise — callers must `await` so parallel test teardowns don't leak
   *  sockets and trip ECONNRESET on the next webServer reuse. */
  stop: () => Promise<void>;
};

function failure(env: Record<string, string | undefined>, key: string): FailureMode {
  const value = env[key]?.trim();
  if (value === "401" || value === "403" || value === "500") return value;
  return "off";
}

/** Loopback origins allowed by the fixture's CORS: IPv4 (127.0.0.1), IPv6
 *  ([::1], the bracketed RFC 3986 form), and `localhost`. Anything else is
 *  treated as cross-origin and gets no allow-origin header. */
const LOOPBACK_ORIGIN_RE =
  /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

function isLoopbackOrigin(origin: string | null): boolean {
  return !!origin && LOOPBACK_ORIGIN_RE.test(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!isLoopbackOrigin(origin)) return {};
  return {
    "access-control-allow-origin": origin as string,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers":
      "authorization, content-type, x-csrf-token, x-requested-with, x-fake-plue-down",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    vary: "Origin",
  };
}

function withJson(
  body: unknown,
  origin: string | null,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(JSON.stringify(body), { ...init, headers });
}

function withText(text: string, origin: string | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "text/plain; charset=utf-8");
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(text, { ...init, headers });
}

function classify(authorization: string | null, cookie: string | null): {
  authed: boolean;
  isAdmin: boolean;
} {
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
  if (bearer === SEED_ADMIN_TOKEN) return { authed: true, isAdmin: true };
  if (bearer === SEED_USER_TOKEN) return { authed: true, isAdmin: false };
  if (cookie && cookie.includes(SEED_SESSION_COOKIE)) return { authed: true, isAdmin: true };
  return { authed: false, isAdmin: false };
}

function decodeCursor(raw: string | null): number {
  if (!raw) return 0;
  try {
    const decoded = atob(raw);
    const n = Number.parseInt(decoded, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(index: number): string {
  return btoa(String(index));
}

function paginate<T>(items: readonly T[], pathname: string, search: URLSearchParams): {
  page: T[];
  link: string | null;
} {
  const limitRaw = Number.parseInt(search.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200
    ? limitRaw
    : DEFAULT_PAGE_SIZE;
  const start = decodeCursor(search.get("cursor"));
  const end = Math.min(start + limit, items.length);
  const page = items.slice(start, end);
  if (end >= items.length) return { page, link: null };
  const nextSearch = new URLSearchParams(search);
  nextSearch.set("cursor", encodeCursor(end));
  nextSearch.set("limit", String(limit));
  return { page, link: `<${pathname}?${nextSearch.toString()}>; rel="next"` };
}

function findRepo(owner: string, repo: string): PlueRepo | undefined {
  const fullName = `${owner}/${repo}`;
  return SEED_REPOS.find((r) => r.full_name === fullName);
}

type Caches = {
  issues: Map<string, PlueIssue[]>;
  landings: Map<string, PlueLanding[]>;
  workspaces: Map<string, PlueWorkspace[]>;
};

function makeCaches(): Caches {
  const issues = new Map<string, PlueIssue[]>();
  const landings = new Map<string, PlueLanding[]>();
  const workspaces = new Map<string, PlueWorkspace[]>();
  for (const repo of SEED_REPOS) {
    issues.set(repo.full_name, buildIssues(repo.full_name, DEFAULT_ISSUES_PER_REPO));
    landings.set(repo.full_name, buildLandings(repo.full_name, DEFAULT_LANDINGS_PER_REPO));
    workspaces.set(repo.full_name, buildWorkspaces(repo.full_name));
  }
  return { issues, landings, workspaces };
}

export function createFakePlueHandler(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): (request: Request) => Response {
  const caches = makeCaches();

  const fail = {
    repos: failure(env, "FAKE_PLUE_FAIL_REPOS"),
    issues: failure(env, "FAKE_PLUE_FAIL_ISSUES"),
    notifications: failure(env, "FAKE_PLUE_FAIL_NOTIFICATIONS"),
  } as const;
  const allDown = env.FAKE_PLUE_DOWN === "1" || env.FAKE_PLUE_DOWN === "true";
  const serviceLabel = env.FAKE_PLUE_SERVICE_LABEL?.trim() || "";

  /** When a service label is configured, tag a JSON value so split-mode
   *  routing tests can prove the response came from THIS host and not the
   *  other one. Arrays are walked one level deep — every list item gets the
   *  tag — so a paginated repos list answers "which host served me?" per row. */
  function tag<T>(value: T): T {
    if (!serviceLabel) return value;
    if (Array.isArray(value)) {
      return value.map((item) => tag(item)) as unknown as T;
    }
    if (value && typeof value === "object") {
      return { ...(value as Record<string, unknown>), service_label: serviceLabel } as T;
    }
    return value;
  }

  function fail401(origin: string | null): Response {
    return withJson({ error: { code: "unauthorized", message: "auth required" } }, origin, {
      status: 401,
    });
  }
  function fail403(origin: string | null): Response {
    return withJson({ error: { code: "forbidden", message: "admin only" } }, origin, {
      status: 403,
    });
  }
  function fail500(origin: string | null): Response {
    return withJson({ error: { code: "internal", message: "synthetic failure" } }, origin, {
      status: 500,
    });
  }

  function injected(mode: FailureMode, origin: string | null): Response | null {
    if (mode === "401") return fail401(origin);
    if (mode === "403") return fail403(origin);
    if (mode === "500") return fail500(origin);
    return null;
  }

  return (request: Request): Response => {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const method = request.method.toUpperCase();
    const pathname = url.pathname;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const perRequestDown =
      request.headers.get("x-fake-plue-down") === "1" ||
      url.searchParams.get("fake_down") === "1";
    if (allDown || perRequestDown) {
      return withJson(
        { error: { code: "unavailable", message: "Plue is down" } },
        origin,
        { status: 503 },
      );
    }

    if (pathname === "/health") return withText("ok", origin);

    const { authed, isAdmin } = classify(
      request.headers.get("authorization"),
      request.headers.get("cookie"),
    );

    // Auth split — authorize redirects sit behind /api/auth/* and are
    // intentionally PUBLIC. The Worker rewrites the redirect_uri on the way
    // back, so the fixture only needs to emit a 302 with a plausible target.
    if (pathname === "/api/auth/workos/authorize") {
      const redirect = url.searchParams.get("redirect") ?? "/";
      const target = new URL("https://workos.example/user_management/authorize");
      target.searchParams.set("client_id", "fake_client_id");
      target.searchParams.set(
        "redirect_uri",
        `${url.origin}/api/auth/workos/callback?redirect=${encodeURIComponent(redirect)}`,
      );
      target.searchParams.set("state", "fake-state-workos");
      const provider = url.searchParams.get("provider");
      if (provider) target.searchParams.set("provider", provider);
      const headers = new Headers({ location: target.toString() });
      for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
      headers.set(
        "set-cookie",
        "smithers_oauth_state=verifier; Path=/; HttpOnly; SameSite=Lax",
      );
      return new Response(null, { status: 302, headers });
    }
    if (pathname === "/api/auth/auth0/authorize") {
      const redirect = url.searchParams.get("redirect") ?? "/";
      const target = new URL("https://example.auth0.com/authorize");
      target.searchParams.set("client_id", "fake_auth0_client");
      target.searchParams.set("response_type", "code");
      target.searchParams.set(
        "redirect_uri",
        `${url.origin}/api/auth/auth0/callback?redirect=${encodeURIComponent(redirect)}`,
      );
      target.searchParams.set("state", "fake-state-auth0");
      const headers = new Headers({ location: target.toString() });
      for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
      return new Response(null, { status: 302, headers });
    }
    if (pathname === "/api/auth/sse-ticket") {
      if (!authed) return fail401(origin);
      return withJson({ ticket: "fake-sse-ticket" }, origin);
    }

    // Everything below requires a session.
    if (!authed) return fail401(origin);

    if (pathname === "/api/user") {
      return withJson(tag(SEED_USER), origin);
    }

    if (pathname === "/api/user/repos") {
      const f = injected(fail.repos, origin);
      if (f) return f;
      const { page, link } = paginate(SEED_REPOS, pathname, url.searchParams);
      const headers = new Headers();
      if (link) headers.set("link", link);
      return withJson(tag(page), origin, { headers });
    }

    if (pathname === "/api/notifications") {
      const f = injected(fail.notifications, origin);
      if (f) return f;
      if (url.searchParams.get("admin") === "1" && !isAdmin) return fail403(origin);
      const items = buildNotifications();
      const { page, link } = paginate(items, pathname, url.searchParams);
      const headers = new Headers();
      if (link) headers.set("link", link);
      return withJson(tag(page), origin, { headers });
    }

    const repoMatch = pathname.match(
      /^\/api\/repos\/([^/]+)\/([^/]+)(\/(issues|landing-requests|workspaces)(?:\/(\d+))?)?$/,
    );
    if (repoMatch) {
      const [, owner, repo, , kind, idRaw] = repoMatch;
      const target = findRepo(owner, repo);
      if (!target) {
        return withJson(
          { error: { code: "not_found", message: `no repo ${owner}/${repo}` } },
          origin,
          { status: 404 },
        );
      }
      if (!kind) return withJson(tag(target), origin);

      if (kind === "issues") {
        const f = injected(fail.issues, origin);
        if (f) return f;
        const list = caches.issues.get(target.full_name) ?? [];
        if (idRaw) {
          const n = Number.parseInt(idRaw, 10);
          const issue = list.find((it) => it.number === n);
          if (!issue) {
            return withJson(
              { error: { code: "not_found", message: `no issue #${idRaw}` } },
              origin,
              { status: 404 },
            );
          }
          return withJson(tag(issue), origin);
        }
        const stateFilter = url.searchParams.get("state");
        const filtered = stateFilter === "open" || stateFilter === "closed"
          ? list.filter((it) => it.state === stateFilter)
          : list;
        const { page, link } = paginate(filtered, pathname, url.searchParams);
        const headers = new Headers();
        if (link) headers.set("link", link);
        return withJson(tag(page), origin, { headers });
      }
      if (kind === "landing-requests") {
        const list = caches.landings.get(target.full_name) ?? [];
        const { page, link } = paginate(list, pathname, url.searchParams);
        const headers = new Headers();
        if (link) headers.set("link", link);
        return withJson(tag(page), origin, { headers });
      }
      if (kind === "workspaces") {
        const list = caches.workspaces.get(target.full_name) ?? [];
        return withJson(tag(list), origin);
      }
    }

    return withJson(
      { error: { code: "not_found", message: `no route ${method} ${pathname}` } },
      origin,
      { status: 404 },
    );
  };
}

/** Boot a Bun server hosting the fake Plue API. Returns a handle the caller
 *  can stop. Tests use this directly; the Playwright webServer entry calls it
 *  with the default port and parks the process. */
export function startFakePlueHost(options: HostOptions = {}): ServerHandle {
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const handler = createFakePlueHandler(env);
  const port = Number(options.port ?? env.FAKE_PLUE_PORT ?? 5290);
  const hostname = options.hostname ?? env.FAKE_PLUE_HOST ?? "127.0.0.1";
  const server = Bun.serve({ port, hostname, fetch: handler });
  const listenPort = server.port;
  if (typeof listenPort !== "number") {
    void server.stop(true);
    throw new Error(
      `fakePlueHost: Bun.serve returned no listen port (hostname=${hostname}, requested port=${port})`,
    );
  }
  return {
    origin: `http://${hostname}:${listenPort}`,
    port: listenPort,
    stop: async () => {
      await server.stop(true);
    },
  };
}

// When run directly (the Playwright webServer entry), boot and park.
if (import.meta.main) {
  const handle = startFakePlueHost();
  const labelSuffix = process.env.FAKE_PLUE_SERVICE_LABEL
    ? ` (service_label=${process.env.FAKE_PLUE_SERVICE_LABEL})`
    : "";
  console.log(`[fake-plue] listening on ${handle.origin}${labelSuffix}`);
  const shutdown = async (): Promise<void> => {
    await handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
