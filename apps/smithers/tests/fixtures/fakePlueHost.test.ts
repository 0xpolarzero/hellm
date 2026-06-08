import { describe, expect, test } from "bun:test";
import { createFakePlueHandler, startFakePlueHost } from "./fakePlueHost";
import {
  DEFAULT_ISSUES_PER_REPO,
  DEFAULT_PAGE_SIZE,
  SEED_ADMIN_TOKEN,
  SEED_REPOS,
  SEED_USER,
  SEED_USER_TOKEN,
} from "./fakePlueSeed";

/**
 * Tests for the fake Plue HTTP fixture. They are tests of the *fixture* —
 * they pin the contract apps/smithers integration tests depend on. If a real
 * Plue change shifts a shape (snake_case fields, Link header, cursor format),
 * these break first and the seed updates next.
 *
 * Each test drives the handler directly (no socket) so it stays under a
 * second even on cold start.
 */

function req(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("authorization")) headers.set("authorization", `Bearer ${SEED_ADMIN_TOKEN}`);
  return new Request(`http://fake-plue.local${path}`, { ...init, headers });
}

describe("fakePlueHost handler", () => {
  test("/api/user returns the seeded session user", async () => {
    const handler = createFakePlueHandler({});
    const res = await handler(req("/api/user"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SEED_USER);
  });

  test("rejects anonymous requests with 401", async () => {
    const handler = createFakePlueHandler({});
    const res = await handler(
      new Request("http://fake-plue.local/api/user"),
    );
    expect(res.status).toBe(401);
  });

  test("accepts the Plue session cookie as auth", async () => {
    const handler = createFakePlueHandler({});
    const res = await handler(
      new Request("http://fake-plue.local/api/user", {
        headers: { cookie: "smithers_session=ok; other=x" },
      }),
    );
    expect(res.status).toBe(200);
  });

  test("seeded repo list matches SEED_REPOS exactly", async () => {
    const handler = createFakePlueHandler({});
    const res = await handler(req("/api/user/repos?limit=200"));
    const body = await res.json();
    expect(body).toEqual([...SEED_REPOS]);
    expect(res.headers.get("link")).toBeNull();
  });

  test("issues paginate by Link header, three pages cover the seed", async () => {
    const handler = createFakePlueHandler({});
    let path: string | null = "/api/repos/smithers/cli/issues?limit=100";
    const pages: number[] = [];
    while (path) {
      const res = await handler(req(path));
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      pages.push(body.length);
      const link = res.headers.get("link");
      if (!link) {
        path = null;
        break;
      }
      const next = link.match(/<([^>]+)>/)?.[1] ?? null;
      path = next;
    }
    const total = pages.reduce((a, b) => a + b, 0);
    expect(total).toBe(DEFAULT_ISSUES_PER_REPO);
    expect(pages[0]).toBe(DEFAULT_PAGE_SIZE);
    expect(pages[pages.length - 1]).toBeLessThanOrEqual(DEFAULT_PAGE_SIZE);
  });

  test("state filter prunes the issues list before paginating", async () => {
    const handler = createFakePlueHandler({});
    async function drain(state: "open" | "closed"): Promise<number> {
      let path: string | null = `/api/repos/smithers/cli/issues?state=${state}&limit=200`;
      let total = 0;
      while (path) {
        const res = await handler(req(path));
        expect(res.status).toBe(200);
        const body = (await res.json()) as Array<{ state: string }>;
        for (const it of body) expect(it.state).toBe(state);
        total += body.length;
        const next = res.headers.get("link")?.match(/<([^>]+)>/)?.[1] ?? null;
        path = next;
      }
      return total;
    }
    const open = await drain("open");
    const closed = await drain("closed");
    expect(open + closed).toBe(DEFAULT_ISSUES_PER_REPO);
    expect(open).toBe(30);
  });

  test("FAKE_PLUE_DOWN=1 turns every authenticated route into 503", async () => {
    const handler = createFakePlueHandler({ FAKE_PLUE_DOWN: "1" });
    const repos = await handler(req("/api/user/repos"));
    const issues = await handler(req("/api/repos/smithers/cli/issues"));
    const notifications = await handler(req("/api/notifications"));
    expect(repos.status).toBe(503);
    expect(issues.status).toBe(503);
    expect(notifications.status).toBe(503);
  });

  test("FAKE_PLUE_FAIL_REPOS=401 propagates 401 only on the repos list", async () => {
    const handler = createFakePlueHandler({ FAKE_PLUE_FAIL_REPOS: "401" });
    const repos = await handler(req("/api/user/repos"));
    const me = await handler(req("/api/user"));
    expect(repos.status).toBe(401);
    expect(me.status).toBe(200);
  });

  test("notifications?admin=1 returns 403 for non-admin tokens", async () => {
    const handler = createFakePlueHandler({});
    const res = await handler(
      new Request("http://fake-plue.local/api/notifications?admin=1", {
        headers: { authorization: `Bearer ${SEED_USER_TOKEN}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("/api/auth/workos/authorize emits a 302 to the WorkOS redirect", async () => {
    const handler = createFakePlueHandler({});
    const res = await handler(
      new Request(
        "http://fake-plue.local/api/auth/workos/authorize?provider=GitHubOAuth&redirect=/issues",
      ),
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.host).toBe("workos.example");
    expect(location.searchParams.get("provider")).toBe("GitHubOAuth");
    expect(location.searchParams.get("redirect_uri")).toContain(
      "/api/auth/workos/callback",
    );
  });

  test("CORS echoes a 127.0.0.1 origin and rejects an external one", async () => {
    const handler = createFakePlueHandler({});
    const loop = await handler(
      new Request("http://fake-plue.local/api/user", {
        headers: { origin: "http://127.0.0.1:5275", authorization: `Bearer ${SEED_ADMIN_TOKEN}` },
      }),
    );
    expect(loop.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5275");
    const evil = await handler(
      new Request("http://fake-plue.local/api/user", {
        headers: { origin: "https://evil.example", authorization: `Bearer ${SEED_ADMIN_TOKEN}` },
      }),
    );
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("CORS echoes an IPv6 loopback origin ([::1]) and localhost", async () => {
    const handler = createFakePlueHandler({});
    const ipv6 = await handler(
      new Request("http://fake-plue.local/api/user", {
        headers: { origin: "http://[::1]:5275", authorization: `Bearer ${SEED_ADMIN_TOKEN}` },
      }),
    );
    expect(ipv6.headers.get("access-control-allow-origin")).toBe("http://[::1]:5275");
    const localhost = await handler(
      new Request("http://fake-plue.local/api/user", {
        headers: { origin: "http://localhost:5275", authorization: `Bearer ${SEED_ADMIN_TOKEN}` },
      }),
    );
    expect(localhost.headers.get("access-control-allow-origin")).toBe("http://localhost:5275");
    const preflight = await handler(
      new Request("http://fake-plue.local/api/user/repos", {
        method: "OPTIONS",
        headers: { origin: "http://[::1]:5275" },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://[::1]:5275");
  });

  test("OPTIONS preflight short-circuits with 204 + CORS headers", async () => {
    const handler = createFakePlueHandler({});
    const res = await handler(
      new Request("http://fake-plue.local/api/user/repos", {
        method: "OPTIONS",
        headers: { origin: "http://127.0.0.1:5275" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5275");
  });

  test("FAKE_PLUE_SERVICE_LABEL tags user, repos, and notifications", async () => {
    const handler = createFakePlueHandler({ FAKE_PLUE_SERVICE_LABEL: "auth" });
    const me = await handler(req("/api/user"));
    expect(await me.json()).toMatchObject({ ...SEED_USER, service_label: "auth" });
    const repos = await handler(req("/api/user/repos?limit=200"));
    const reposBody = (await repos.json()) as Array<{ service_label: string }>;
    expect(reposBody.length).toBeGreaterThan(0);
    for (const repo of reposBody) expect(repo.service_label).toBe("auth");
    const notifications = await handler(req("/api/notifications"));
    const notifBody = (await notifications.json()) as Array<{ service_label: string }>;
    expect(notifBody.length).toBeGreaterThan(0);
    for (const n of notifBody) expect(n.service_label).toBe("auth");
  });

  test("no label → no service_label field anywhere (regression net)", async () => {
    const handler = createFakePlueHandler({});
    const me = await handler(req("/api/user"));
    expect((await me.json()) as Record<string, unknown>).not.toHaveProperty("service_label");
    const repos = await handler(req("/api/user/repos?limit=200"));
    const reposBody = (await repos.json()) as Array<Record<string, unknown>>;
    for (const r of reposBody) expect(r).not.toHaveProperty("service_label");
  });

  test("per-request override: x-fake-plue-down: 1 forces a 503", async () => {
    const handler = createFakePlueHandler({});
    const res = await handler(
      new Request("http://fake-plue.local/api/repos/smithers/cli/issues", {
        headers: { authorization: `Bearer ${SEED_ADMIN_TOKEN}`, "x-fake-plue-down": "1" },
      }),
    );
    expect(res.status).toBe(503);
    const ok = await handler(req("/api/repos/smithers/cli/issues"));
    expect(ok.status).toBe(200);
  });

  test("per-request override: ?fake_down=1 forces a 503 on the same host", async () => {
    const handler = createFakePlueHandler({});
    const res = await handler(req("/api/repos/smithers/cli/issues?fake_down=1"));
    expect(res.status).toBe(503);
  });

  test("unknown route returns 404 with a structured error body", async () => {
    const handler = createFakePlueHandler({});
    const res = await handler(req("/api/repos/unknown/repo"));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  });
});

describe("fakePlueHost listener", () => {
  test("startFakePlueHost binds to a random port and serves /health", async () => {
    const handle = startFakePlueHost({ port: 0, env: {} });
    try {
      const res = await fetch(`${handle.origin}/health`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      await handle.stop();
    }
  });

  test("startFakePlueHost propagates FAKE_PLUE_SERVICE_LABEL through a real socket", async () => {
    const handle = startFakePlueHost({ port: 0, env: { FAKE_PLUE_SERVICE_LABEL: "platform" } });
    try {
      const res = await fetch(`${handle.origin}/api/user`, {
        headers: { authorization: `Bearer ${SEED_ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ service_label: "platform" });
    } finally {
      await handle.stop();
    }
  });
});
