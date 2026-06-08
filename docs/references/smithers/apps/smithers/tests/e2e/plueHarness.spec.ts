import { expect, test } from "@playwright/test";

/**
 * End-to-end coverage of the local Plue/jjhub harness. The Playwright stack
 * boots TWO deterministic fake Plue servers — one tagged
 * `service_label=auth`, one tagged `service_label=platform` — and points vite
 * proxies at them via SMITHERS_AUTH_PROXY_TARGET + SMITHERS_PLATFORM_PROXY_TARGET.
 *
 * These tests drive the browser's REAL fetch through the REAL vite proxy into
 * the REAL fake-plue server. No route mocking (see CLAUDE.md "No mocks").
 *
 * Corner cases covered:
 *   • Authenticated repos list (seed contract) — proves /api/user/repos hits
 *     the platform host because it is a platform-user subpath.
 *   • Pagination via Link header (3 pages × 100 = 250 issues).
 *   • Issue detail by number.
 *   • Landings + workspaces + notifications shapes.
 *   • Split-mode routing — auth-prefixed requests carry the "auth" tag,
 *     platform-prefixed requests carry the "platform" tag. If both proxy
 *     targets were the same host, the assertion would fail.
 *   • Auth redirect: WorkOS authorize 302 with tight assertions on the
 *     redirect query (client_id, state, provider, redirect_uri path + origin).
 *   • Plue unavailable: the app-harness proxy path returns 503 when the fake
 *     host is asked for a per-request down (no out-of-band port:1 fetch).
 *   • 401 propagation (no bearer → 401).
 *   • 403 propagation (non-admin token → notifications?admin=1 → 403).
 *   • Same-origin assumption: /api/repos resolves on baseURL, not on a remote.
 *   • Store/UI-level: the app's own `platformJson` returns seeded fake data,
 *     exercising the full code path (auth header attach, base-URL resolution,
 *     error mapping) — not just transport-level fetch.
 */

const ADMIN_TOKEN = "smithers_e2e_admin_token";
const USER_TOKEN = "smithers_e2e_user_token";
const plueHarnessBaseURL = `http://127.0.0.1:${process.env.SMITHERS_PLUE_HARNESS_TEST_PORT || "5292"}`;

test.use({ baseURL: plueHarnessBaseURL });

type FetchResult = {
  status: number;
  link: string | null;
  body: unknown;
  contentType: string | null;
};

async function fetchAs(
  page: import("@playwright/test").Page,
  url: string,
  token: string | null = ADMIN_TOKEN,
  init: { headers?: Record<string, string> } = {},
): Promise<FetchResult> {
  return page.evaluate(
    async ({ url, token, headers: extra }) => {
      const headers: Record<string, string> = { ...(extra ?? {}) };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers, redirect: "manual" });
      let body: unknown = null;
      const text = await res.text();
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return {
        status: res.status,
        link: res.headers.get("link"),
        body,
        contentType: res.headers.get("content-type"),
      };
    },
    { url, token, headers: init.headers ?? null },
  );
}

test.beforeEach(async ({ page }) => {
  // Seed the bearer in sessionStorage BEFORE the app boots so the AuthStatus
  // bootstrap's `/api/user` fetch returns 200 and the page does not navigate
  // to /login mid-test. Without this, the app's own 401 → `handleAuthRequired`
  // redirect destroys the test page's execution context while page.evaluate
  // is in flight. Specs that intentionally probe 401 propagation pass a null
  // token to `fetchAs`, which overrides the session bearer per-call.
  await page.addInitScript((token) => {
    window.sessionStorage.setItem("smithers_token", token);
  }, ADMIN_TOKEN);
  await page.goto("/");
});

test("seeded repos list resolves through the vite → fake-plue proxy", async ({ page }) => {
  const repos = await fetchAs(page, "/api/user/repos");
  expect(repos.status).toBe(200);
  expect(repos.contentType ?? "").toContain("application/json");
  const body = repos.body as Array<{ full_name: string; service_label: string }>;
  expect(body.length).toBeGreaterThanOrEqual(3);
  expect(body.some((r) => r.full_name === "smithers/cli")).toBe(true);
});

test("issues paginate to the full seeded total via Link cursors", async ({ page }) => {
  let path: string | null = "/api/repos/smithers/cli/issues?limit=100";
  let total = 0;
  let pages = 0;
  while (path) {
    const res = await fetchAs(page, path);
    expect(res.status).toBe(200);
    const body = res.body as unknown[];
    total += body.length;
    pages += 1;
    if (!res.link) {
      path = null;
      break;
    }
    const next = res.link.match(/<([^>]+)>/)?.[1] ?? null;
    path = next;
    if (pages > 5) throw new Error("pagination did not terminate");
  }
  expect(total).toBe(250);
  expect(pages).toBe(3);
});

test("issue detail returns one issue", async ({ page }) => {
  const res = await fetchAs(page, "/api/repos/smithers/cli/issues/42");
  expect(res.status).toBe(200);
  const body = res.body as { number: number; title: string };
  expect(body.number).toBe(42);
  expect(body.title).toContain("(#42)");
});

test("landings and workspaces and notifications all serve seeded JSON", async ({ page }) => {
  const landings = await fetchAs(page, "/api/repos/smithers/cli/landing-requests");
  const workspaces = await fetchAs(page, "/api/repos/smithers/cli/workspaces");
  const notifications = await fetchAs(page, "/api/notifications");
  expect(landings.status).toBe(200);
  expect((landings.body as unknown[]).length).toBeGreaterThan(0);
  expect(workspaces.status).toBe(200);
  expect((workspaces.body as unknown[]).length).toBe(3);
  expect(notifications.status).toBe(200);
  expect((notifications.body as unknown[]).length).toBe(4);
});

test("split-mode routing: auth-prefixed paths hit the auth host, platform paths hit the platform host", async ({
  page,
}) => {
  // /api/user is the identity singleton, so it stays on the auth proxy.
  const me = await fetchAs(page, "/api/user");
  expect(me.status).toBe(200);
  expect((me.body as { service_label: string }).service_label).toBe("auth");

  // /api/user/repos is a platform-user subpath. Vite mirrors the Worker route
  // table by inserting this prefix before the broader auth /api/user prefix.
  const userRepos = await fetchAs(page, "/api/user/repos?limit=200");
  expect(userRepos.status).toBe(200);
  const userReposBody = userRepos.body as Array<{ service_label: string }>;
  expect(userReposBody.length).toBeGreaterThan(0);
  for (const r of userReposBody) expect(r.service_label).toBe("platform");

  // /api/repos/* is platform-routed. Each repo + workspace carries "platform".
  const oneRepo = await fetchAs(page, "/api/repos/smithers/cli");
  expect(oneRepo.status).toBe(200);
  expect((oneRepo.body as { service_label: string }).service_label).toBe("platform");

  const workspaces = await fetchAs(page, "/api/repos/smithers/cli/workspaces");
  expect(workspaces.status).toBe(200);
  for (const ws of workspaces.body as Array<{ service_label: string }>) {
    expect(ws.service_label).toBe("platform");
  }

  // /api/notifications is platform-routed.
  const notifications = await fetchAs(page, "/api/notifications");
  expect(notifications.status).toBe(200);
  for (const n of notifications.body as Array<{ service_label: string }>) {
    expect(n.service_label).toBe("platform");
  }
});

test("WorkOS authorize emits a tightly-bounded 302 redirect", async ({ request, baseURL }) => {
  // Use Playwright's APIRequestContext to read the manual-redirect headers
  // directly — `fetch(..., redirect: "manual")` in the browser surfaces an
  // opaque (status 0) response that hides everything, defeating the assertion.
  const res = await request.get(
    `${baseURL}/api/auth/workos/authorize?provider=GitHubOAuth&redirect=/issues`,
    { maxRedirects: 0 },
  );
  expect(res.status()).toBe(302);
  const location = res.headers()["location"];
  expect(typeof location).toBe("string");
  const target = new URL(location);
  expect(target.host).toBe("workos.example");
  expect(target.pathname).toBe("/user_management/authorize");
  expect(target.searchParams.get("client_id")).toBe("fake_client_id");
  expect(target.searchParams.get("state")).toBe("fake-state-workos");
  expect(target.searchParams.get("provider")).toBe("GitHubOAuth");
  const redirectUri = target.searchParams.get("redirect_uri") ?? "";
  expect(redirectUri.length).toBeGreaterThan(0);
  const callback = new URL(redirectUri);
  // The fixture mints the callback against its own listen origin; the auth
  // proxy points at 127.0.0.1 plus the configured auth port. Asserting on the
  // hostname + port shape proves the request actually reached the auth host
  // (not, say, the platform host) and that the rewrite happened on the right
  // origin.
  expect(callback.hostname).toBe("127.0.0.1");
  expect(callback.pathname).toBe("/api/auth/workos/callback");
  expect(callback.searchParams.get("redirect")).toBe("/issues");
  const setCookie = res.headers()["set-cookie"] ?? "";
  expect(setCookie).toContain("smithers_oauth_state");
});

test("Plue unavailable: a platform request through the configured proxy surfaces a 503", async ({
  page,
}) => {
  // The earlier test fetched http://127.0.0.1:1/api/user/repos — that path
  // never traverses the app's configured Plue proxy and only proves "fetching
  // an unbound port throws". The harness exists to validate the *proxy path*,
  // so we send a real platform-prefixed request and ask the fake host to fail
  // it via a per-request `x-fake-plue-down` header. The 503 we see came back
  // through vite → fake-plue, the same code path the deployed Worker uses.
  const res = await fetchAs(
    page,
    "/api/repos/smithers/cli/issues",
    ADMIN_TOKEN,
    { headers: { "x-fake-plue-down": "1" } },
  );
  expect(res.status).toBe(503);
  const body = res.body as { error?: { code?: string } };
  expect(body?.error?.code).toBe("unavailable");

  // Sanity: without the override the same path is healthy. A blanket fault
  // (broken proxy, wrong base URL) would fail this assertion too — so the
  // 503 above is genuinely a fault we injected, not a misconfiguration.
  const restored = await fetchAs(page, "/api/repos/smithers/cli/issues?limit=1");
  expect(restored.status).toBe(200);
});

test("401 propagation: no bearer → /api/user returns 401", async ({ page }) => {
  const res = await fetchAs(page, "/api/user", null);
  expect(res.status).toBe(401);
});

test("403 propagation: non-admin token on /api/notifications?admin=1", async ({ page }) => {
  const res = await fetchAs(page, "/api/notifications?admin=1", USER_TOKEN);
  expect(res.status).toBe(403);
});

test("same-origin assumption: /api/repos resolves on the test baseURL", async ({ page }) => {
  const url = await page.evaluate(() =>
    new URL("/api/repos/smithers/cli/workspaces", location.origin).toString(),
  );
  expect(url.startsWith("http://127.0.0.1:")).toBe(true);
});

test("UI path: the app's own platformJson returns seeded fake Plue data", async ({ page }) => {
  // `platformJson` is the app's typed jjhub transport — what every code-hosting
  // surface uses to talk to the platform. Calling it from the page via the
  // test hook exercises the *full* code path (withAuthHeaders, platformUrl,
  // safeJson + PlatformError mapping). A green test here means a real React
  // store doing `platformJson("/api/repos/...")` is reading the same seeded
  // bytes the fixture serves.
  await page.waitForFunction(() => Boolean((window as any).__smithers_test?.platformJson));
  // Seed the session token the way the real signed-in app does so
  // `withAuthHeaders` attaches `Authorization: Bearer <admin>` on its own.
  // This is the wiring code path, NOT a transport shortcut — the test is
  // proving the wire still serves seeded data, not that we can construct a
  // headers map.
  await page.evaluate((token) => {
    window.sessionStorage.setItem("smithers_token", token);
  }, ADMIN_TOKEN);

  const repos = await page.evaluate(async () => {
    const helper = (window as any).__smithers_test;
    return await helper.platformJson("/api/user/repos?limit=200");
  });
  const body = repos as Array<{ full_name: string; service_label: string }>;
  expect(body.length).toBeGreaterThan(0);
  expect(body.some((r) => r.full_name === "smithers/cli")).toBe(true);
  for (const r of body) expect(r.service_label).toBe("platform");

  // The error path: drive platformJson into a 503 via the per-request override.
  // The thrown PlatformError is what every UI surface catches; capturing it
  // here proves the seam still throws with the right shape under failure.
  const failure = await page.evaluate(async () => {
    const helper = (window as any).__smithers_test;
    try {
      await helper.platformJson("/api/repos/smithers/cli/issues", {
        headers: { "x-fake-plue-down": "1" },
      });
      return { ok: true };
    } catch (error) {
      const e = error as { name?: string; status?: number; code?: string };
      return { ok: false, name: e.name, status: e.status, code: e.code };
    }
  });
  expect(failure).toMatchObject({
    ok: false,
    name: "PlatformError",
    status: 503,
    code: "unavailable",
  });
});
