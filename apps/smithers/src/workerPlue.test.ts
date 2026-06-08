import { describe, expect, test } from "bun:test";
import worker from "./worker";
import type { CloudflareEnv } from "./env";
import { startFakePlueHost } from "../tests/fixtures/fakePlueHost";
import {
  DEFAULT_ISSUES_PER_REPO,
  DEFAULT_PAGE_SIZE,
  SEED_ADMIN_TOKEN,
  SEED_REPOS,
  SEED_USER,
  SEED_USER_TOKEN,
} from "../tests/fixtures/fakePlueSeed";

/**
 * Worker proxy → fake Plue, end-to-end.
 *
 * These cover the corner cases the harness has to keep honest:
 *   • Auth base distinct from platform base (split mode) — proven by tagging
 *     each fake host with `FAKE_PLUE_SERVICE_LABEL` so a response carries the
 *     identity of the host that served it. A misrouted request would surface
 *     the *other* host's label, and the split-mode assertion would fail.
 *   • Monolith fallback (only AUTH_API_BASE_URL set).
 *   • Plue unavailable (FAKE_PLUE_DOWN=1) ⇒ 503 propagates.
 *   • 401/403 propagate verbatim from Plue to the browser.
 *   • Pagination Link header survives the proxy.
 *   • Large list (250 issues) streams across pages.
 *   • Same-origin: the browser sees same-origin Plue calls (worker rewrites
 *     the upstream).
 *
 * Important fact about the Worker's routing (see `src/worker.ts`):
 *   `/api/user` is the auth identity singleton, and auth-only subpaths such as
 *   `/api/user/keys` stay on auth. Platform user subpaths such as
 *   `/api/user/repos`, `/api/user/workspaces`, and `/api/user/issues` route to
 *   GO_API_BASE_URL when it is configured. The label-tagged fixture below
 *   catches any accidental collapse of auth and platform origins.
 */

const ORIGIN = "http://127.0.0.1:9101";
const KEY: CloudflareEnv = { CEREBRAS_API_KEY: "ignored-for-proxy" };

function withAuth(path: string, init: RequestInit = {}, token = SEED_ADMIN_TOKEN): Request {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> ?? {}) },
  });
}

describe("worker → fake Plue (split mode: auth ≠ platform, by label)", () => {
  test("/api/user reaches authHost; platform routes reach platformHost by service_label", async () => {
    const authHost = startFakePlueHost({ port: 0, env: { FAKE_PLUE_SERVICE_LABEL: "auth" } });
    const platformHost = startFakePlueHost({
      port: 0,
      env: { FAKE_PLUE_SERVICE_LABEL: "platform" },
    });
    // Distinct origins are required for this test to be meaningful. If we ever
    // accidentally pointed both at the same host (or to the same proxy target),
    // the per-host label would collapse and the split-routing claim below
    // would be unverifiable. Guard at the wiring level too.
    expect(authHost.origin).not.toBe(platformHost.origin);
    try {
      const env: CloudflareEnv = {
        ...KEY,
        AUTH_API_BASE_URL: authHost.origin,
        GO_API_BASE_URL: platformHost.origin,
      };
      const me = await worker.fetch(withAuth("/api/user"), env);
      expect(me.status).toBe(200);
      const meBody = (await me.json()) as { id: number; service_label: string };
      expect(meBody.id).toBe(SEED_USER.id);
      expect(meBody.service_label).toBe("auth");

      // /api/user/repos is a platform-user subpath. Asserting "platform" here
      // pins the route precedence over the broader auth /api/user prefix.
      const userRepos = await worker.fetch(withAuth("/api/user/repos"), env);
      expect(userRepos.status).toBe(200);
      const userReposBody = (await userRepos.json()) as Array<{
        full_name: string;
        service_label: string;
      }>;
      expect(userReposBody.length).toBe(SEED_REPOS.length);
      for (const r of userReposBody) expect(r.service_label).toBe("platform");

      // Platform routes hit the platform host. If the wiring collapsed
      // (auth === platform target), each item here would surface "auth" and
      // this assertion would fail.
      const platformRepo = await worker.fetch(withAuth("/api/repos/smithers/cli"), env);
      expect(platformRepo.status).toBe(200);
      const platformRepoBody = (await platformRepo.json()) as { service_label: string };
      expect(platformRepoBody.service_label).toBe("platform");

      const notifications = await worker.fetch(withAuth("/api/notifications"), env);
      expect(notifications.status).toBe(200);
      const notifBody = (await notifications.json()) as Array<{ service_label: string }>;
      for (const n of notifBody) expect(n.service_label).toBe("platform");
    } finally {
      await authHost.stop();
      await platformHost.stop();
    }
  });
});

describe("worker → fake Plue (monolith fallback)", () => {
  test("platform routes fall back to AUTH_API_BASE_URL when GO_API_BASE_URL is unset", async () => {
    const host = startFakePlueHost({ port: 0 });
    const env: CloudflareEnv = { ...KEY, AUTH_API_BASE_URL: host.origin };
    try {
      const repos = await worker.fetch(withAuth("/api/user/repos"), env);
      expect(repos.status).toBe(200);
      const notifications = await worker.fetch(withAuth("/api/notifications"), env);
      expect(notifications.status).toBe(200);
    } finally {
      await host.stop();
    }
  });

  test("platform routes 404 cleanly when no Plue base is configured at all", async () => {
    const res = await worker.fetch(withAuth("/api/repos/smithers/cli/issues"), KEY);
    expect(res.status).toBe(404);
  });
});

describe("worker → fake Plue (failure propagation)", () => {
  test("Plue down (503) reaches the browser as 503, not as 500", async () => {
    const host = startFakePlueHost({ port: 0, env: { FAKE_PLUE_DOWN: "1" } });
    try {
      const res = await worker.fetch(
        withAuth("/api/repos/smithers/cli/issues"),
        { ...KEY, GO_API_BASE_URL: host.origin },
      );
      expect(res.status).toBe(503);
    } finally {
      await host.stop();
    }
  });

  test("401 from Plue passes through verbatim", async () => {
    const host = startFakePlueHost({ port: 0, env: { FAKE_PLUE_FAIL_ISSUES: "401" } });
    try {
      const res = await worker.fetch(
        withAuth("/api/repos/smithers/cli/issues"),
        { ...KEY, GO_API_BASE_URL: host.origin },
      );
      expect(res.status).toBe(401);
    } finally {
      await host.stop();
    }
  });

  test("403 from Plue passes through verbatim for non-admin tokens", async () => {
    const host = startFakePlueHost({ port: 0 });
    try {
      const res = await worker.fetch(
        withAuth(
          "/api/notifications?admin=1",
          {},
          SEED_USER_TOKEN,
        ),
        { ...KEY, GO_API_BASE_URL: host.origin },
      );
      expect(res.status).toBe(403);
    } finally {
      await host.stop();
    }
  });

  test("anonymous platform call → 401", async () => {
    const host = startFakePlueHost({ port: 0 });
    try {
      const res = await worker.fetch(
        new Request(`${ORIGIN}/api/repos/smithers/cli/issues`),
        { ...KEY, GO_API_BASE_URL: host.origin },
      );
      expect(res.status).toBe(401);
    } finally {
      await host.stop();
    }
  });
});

describe("worker → fake Plue (pagination + large lists)", () => {
  test("Link header survives the proxy, and the cursor is honored on the next call", async () => {
    const host = startFakePlueHost({ port: 0 });
    const env: CloudflareEnv = { ...KEY, GO_API_BASE_URL: host.origin };
    try {
      const first = await worker.fetch(
        withAuth("/api/repos/smithers/cli/issues?limit=100"),
        env,
      );
      expect(first.status).toBe(200);
      const link = first.headers.get("link");
      expect(link).toContain('rel="next"');
      const nextPath = link?.match(/<([^>]+)>/)?.[1];
      expect(nextPath).toBeTruthy();
      const second = await worker.fetch(withAuth(nextPath!), env);
      expect(second.status).toBe(200);
      const body = (await second.json()) as unknown[];
      expect(body.length).toBe(DEFAULT_PAGE_SIZE);
    } finally {
      await host.stop();
    }
  });

  test("streams a 250-issue list across pages without losing items", async () => {
    const host = startFakePlueHost({ port: 0 });
    const env: CloudflareEnv = { ...KEY, GO_API_BASE_URL: host.origin };
    try {
      let path: string | null = "/api/repos/smithers/cli/issues?limit=100";
      let total = 0;
      let pages = 0;
      while (path) {
        const res = await worker.fetch(withAuth(path), env);
        expect(res.status).toBe(200);
        const body = (await res.json()) as unknown[];
        total += body.length;
        pages += 1;
        const link = res.headers.get("link");
        path = link?.match(/<([^>]+)>/)?.[1] ?? null;
        if (pages > 10) throw new Error("pagination never terminated");
      }
      expect(total).toBe(DEFAULT_ISSUES_PER_REPO);
      expect(pages).toBe(3);
    } finally {
      await host.stop();
    }
  });
});

describe("worker → fake Plue (split-mode resilience)", () => {
  test("authBase stays up serving identity even when platformBase is hard-down", async () => {
    const authHost = startFakePlueHost({ port: 0, env: { FAKE_PLUE_SERVICE_LABEL: "auth" } });
    const platformHost = startFakePlueHost({
      port: 0,
      env: { FAKE_PLUE_DOWN: "1", FAKE_PLUE_SERVICE_LABEL: "platform-down" },
    });
    expect(authHost.origin).not.toBe(platformHost.origin);
    try {
      const env: CloudflareEnv = {
        ...KEY,
        AUTH_API_BASE_URL: authHost.origin,
        GO_API_BASE_URL: platformHost.origin,
      };
      const me = await worker.fetch(withAuth("/api/user"), env);
      expect(me.status).toBe(200);
      expect((await me.json()) as { service_label: string }).toMatchObject({
        service_label: "auth",
      });

      const userRepos = await worker.fetch(withAuth("/api/user/repos"), env);
      expect(userRepos.status).toBe(503);

      const issues = await worker.fetch(withAuth("/api/repos/smithers/cli/issues"), env);
      expect(issues.status).toBe(503);
    } finally {
      await authHost.stop();
      await platformHost.stop();
    }
  });

  test("per-request x-fake-plue-down: 1 takes one platform call into a 503 — proxy path only", async () => {
    const authHost = startFakePlueHost({ port: 0, env: { FAKE_PLUE_SERVICE_LABEL: "auth" } });
    const platformHost = startFakePlueHost({
      port: 0,
      env: { FAKE_PLUE_SERVICE_LABEL: "platform" },
    });
    try {
      const env: CloudflareEnv = {
        ...KEY,
        AUTH_API_BASE_URL: authHost.origin,
        GO_API_BASE_URL: platformHost.origin,
      };
      const down = await worker.fetch(
        withAuth("/api/repos/smithers/cli/issues", {
          headers: { "x-fake-plue-down": "1" },
        }),
        env,
      );
      expect(down.status).toBe(503);
      // The same path with the override removed is healthy again — proving
      // the failure came from the proxy traversal, not from a static host
      // outage, and that the e2e "Plue unavailable" path can ride a real
      // proxy through to a real failure response.
      const up = await worker.fetch(withAuth("/api/repos/smithers/cli/issues"), env);
      expect(up.status).toBe(200);
    } finally {
      await authHost.stop();
      await platformHost.stop();
    }
  });
});
