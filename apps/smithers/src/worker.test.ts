import { afterAll, describe, expect, test } from "bun:test";
import worker from "./worker";
import type { CloudflareEnv } from "./env";
import { startCerebrasUpstream } from "../tests/fixtures/cerebrasUpstream";
import { SEEDED_CHAT_REPLY } from "../tests/fixtures/seededChat";

/**
 * REAL gateway test: drive src/worker.ts the way Cloudflare does — call its
 * `fetch(request, env)` directly. The guard cases need no upstream; the happy
 * path boots the REAL OpenAI-compatible fixture upstream and asserts the whole
 * chain (worker → `openai` SDK → upstream SSE → TanStack bridge) reconstructs
 * the seeded reply. No key, no mocks.
 */

const ORIGIN = "http://127.0.0.1:9100";

function chatRequest(body: unknown, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...(init.headers ?? {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

const keyEnv: CloudflareEnv = { CEREBRAS_API_KEY: "fixture-key" };

function startFixtureServer(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch,
  });
  return {
    origin: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

type TrustedProxyHeaders = {
  userId: string | null;
  role: string | null;
  scopes: string | null;
  tokenId: string | null;
};

const SPOOFED_TRUSTED_PROXY_HEADERS = {
  "x-user-id": "spoofed-user",
  "x-user-role": "spoofed-role",
  "x-user-scopes": "run:admin",
  "x-smithers-token-id": "spoofed-token",
};

function trustedProxyHeaders(request: Request): TrustedProxyHeaders {
  return {
    userId: request.headers.get("x-user-id"),
    role: request.headers.get("x-user-role"),
    scopes: request.headers.get("x-user-scopes"),
    tokenId: request.headers.get("x-smithers-token-id"),
  };
}

function expectTrustedProxyHeadersStripped(actual: TrustedProxyHeaders): void {
  expect(actual.userId).toBe(null);
  expect(actual.role).toBe(null);
  expect(actual.scopes).toBe(null);
  expect(actual.tokenId).toBe(null);
}

/** Parse an SSE body into the AG-UI chunk objects it carried. */
function parseSse(text: string): Array<Record<string, unknown>> {
  const chunks: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") continue;
    try {
      chunks.push(JSON.parse(data));
    } catch {
      // skip non-JSON keepalives
    }
  }
  return chunks;
}

describe("worker routing + guards", () => {
  test("non-POST /api/chat → 405", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/api/chat`, { method: "GET" }), keyEnv);
    expect(res.status).toBe(405);
  });

  test("missing CEREBRAS_API_KEY → 500", async () => {
    const res = await worker.fetch(chatRequest({ messages: [] }), { CEREBRAS_API_KEY: "" });
    expect(res.status).toBe(500);
  });

  test("cross-origin (no Origin header) → 403", async () => {
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      }),
      keyEnv,
    );
    expect(res.status).toBe(403);
  });

  test("mismatched Origin → 403", async () => {
    const res = await worker.fetch(
      chatRequest({ messages: [] }, { headers: { origin: "http://evil.example" } }),
      keyEnv,
    );
    expect(res.status).toBe(403);
  });

  test("invalid JSON body → 400", async () => {
    const res = await worker.fetch(chatRequest("not json{"), keyEnv);
    expect(res.status).toBe(400);
  });

  test("non-object body (array) → 400", async () => {
    const res = await worker.fetch(chatRequest([1, 2, 3]), keyEnv);
    expect(res.status).toBe(400);
  });

  test("missing messages[] → 400", async () => {
    const res = await worker.fetch(chatRequest({ system: "hi" }), keyEnv);
    expect(res.status).toBe(400);
  });

  test("too many messages → 413", async () => {
    const messages = Array.from({ length: 101 }, () => ({ role: "user", content: "x" }));
    const res = await worker.fetch(chatRequest({ messages }), keyEnv);
    expect(res.status).toBe(413);
  });

  test("oversized content → 413", async () => {
    const messages = [{ role: "user", content: "x".repeat(100 * 1024 + 1) }];
    const res = await worker.fetch(chatRequest({ messages }), keyEnv);
    expect(res.status).toBe(413);
  });

  test("malformed message entry → 400", async () => {
    const res = await worker.fetch(chatRequest({ messages: [{ role: "system", content: "x" }] }), keyEnv);
    expect(res.status).toBe(400);
  });

  test("non-string system → 400", async () => {
    const res = await worker.fetch(
      chatRequest({ messages: [{ role: "user", content: "hi" }], system: 42 }),
      keyEnv,
    );
    expect(res.status).toBe(400);
  });

  test("unknown path with no ASSETS binding → 404", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/nope`), keyEnv);
    expect(res.status).toBe(404);
  });
});

describe("worker auth and gateway proxy", () => {
  test("proxies /api/user to the configured Plue auth API", async () => {
    let seenCookie = "";
    const auth = startFixtureServer((request) => {
      const url = new URL(request.url);
      if (url.pathname !== "/api/user") return new Response("missing", { status: 404 });
      seenCookie = request.headers.get("cookie") ?? "";
      return new Response(JSON.stringify({ id: 7, username: "will", is_admin: false }), {
        headers: { "content-type": "application/json" },
      });
    });

    try {
      const res = await worker.fetch(
        new Request(`${ORIGIN}/api/user`, {
          headers: { cookie: "smithers_session=ok" },
        }),
        { ...keyEnv, AUTH_API_BASE_URL: auth.origin },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id: 7, username: "will" });
      expect(seenCookie).toContain("smithers_session=ok");
    } finally {
      auth.stop();
    }
  });

  test("rewrites proxied OAuth authorize redirect_uri back to the Smithers origin", async () => {
    const auth = startFixtureServer(() => {
      const location = new URL("https://workos.example/user_management/authorize");
      location.searchParams.set("client_id", "client_123");
      location.searchParams.set(
        "redirect_uri",
        "https://api.plue.example/api/auth/workos/callback",
      );
      location.searchParams.set("state", "state_123");
      return new Response(null, {
        status: 302,
        headers: {
          location: location.toString(),
          "set-cookie": "smithers_oauth_state=verifier; Path=/; HttpOnly; Secure; SameSite=Lax",
        },
      });
    });

    try {
      const res = await worker.fetch(
        new Request(`${ORIGIN}/api/auth/workos/authorize?provider=GitHubOAuth`, {
          redirect: "manual",
        }),
        { ...keyEnv, AUTH_API_BASE_URL: auth.origin },
      );
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location") ?? "");
      expect(location.searchParams.get("redirect_uri")).toBe(
        `${ORIGIN}/api/auth/workos/callback`,
      );
      expect(res.headers.get("set-cookie")).toContain("smithers_oauth_state=");
    } finally {
      auth.stop();
    }
  });

  test("proxies /api/repos to GO_API_BASE_URL, forwarding credentials, path, and query", async () => {
    let seenPath = "";
    let seenQuery = "";
    let seenCookie = "";
    const platform = startFixtureServer((request) => {
      const url = new URL(request.url);
      seenPath = url.pathname;
      seenQuery = url.search;
      seenCookie = request.headers.get("cookie") ?? "";
      return new Response(JSON.stringify([{ full_name: "acme/widgets" }]), {
        headers: { "content-type": "application/json" },
      });
    });

    try {
      const res = await worker.fetch(
        new Request(`${ORIGIN}/api/repos/acme/widgets/landing-requests?state=open`, {
          headers: { cookie: "smithers_session=ok" },
        }),
        { ...keyEnv, GO_API_BASE_URL: platform.origin },
      );
      expect(res.status).toBe(200);
      expect(seenPath).toBe("/api/repos/acme/widgets/landing-requests");
      expect(seenQuery).toBe("?state=open");
      expect(seenCookie).toContain("smithers_session=ok");
    } finally {
      platform.stop();
    }
  });

  test("platform routes fall back to AUTH_API_BASE_URL when GO_API_BASE_URL is unset", async () => {
    let seenPath = "";
    const auth = startFixtureServer((request) => {
      seenPath = new URL(request.url).pathname;
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });

    try {
      const res = await worker.fetch(new Request(`${ORIGIN}/api/orgs/acme/teams`), {
        ...keyEnv,
        AUTH_API_BASE_URL: auth.origin,
      });
      expect(res.status).toBe(200);
      expect(seenPath).toBe("/api/orgs/acme/teams");
    } finally {
      auth.stop();
    }
  });

  test("platform route with no API base configured → 404", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/api/search/code?q=foo`), keyEnv);
    expect(res.status).toBe(404);
  });

  test("split: /api/user/repos targets GO_API_BASE_URL, /api/user stays on AUTH", async () => {
    let authHits = 0;
    let platformHits = 0;
    const auth = startFixtureServer((request) => {
      const url = new URL(request.url);
      authHits += 1;
      if (url.pathname === "/api/user") {
        return new Response(JSON.stringify({ id: 7, username: "will", is_admin: false }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("auth should not see this", { status: 500 });
    });
    const platform = startFixtureServer((request) => {
      platformHits += 1;
      return new Response(JSON.stringify([{ full_name: "acme/widgets" }]), {
        headers: { "content-type": "application/json" },
      });
    });

    try {
      const idRes = await worker.fetch(new Request(`${ORIGIN}/api/user`), {
        ...keyEnv,
        AUTH_API_BASE_URL: auth.origin,
        GO_API_BASE_URL: platform.origin,
      });
      expect(idRes.status).toBe(200);
      expect(await idRes.json()).toMatchObject({ id: 7 });

      for (const sub of [
        "/api/user/repos",
        "/api/user/readable-repos",
        "/api/user/workspaces",
        "/api/user/orgs",
        "/api/user/starred",
      ]) {
        const res = await worker.fetch(new Request(`${ORIGIN}${sub}?limit=5`), {
          ...keyEnv,
          AUTH_API_BASE_URL: auth.origin,
          GO_API_BASE_URL: platform.origin,
        });
        expect(res.status).toBe(200);
      }
      expect(authHits).toBe(1);
      expect(platformHits).toBe(5);
    } finally {
      platform.stop();
      auth.stop();
    }
  });

  test("monolith: only AUTH_API_BASE_URL is set — every route lands on the auth/plue origin", async () => {
    let userHits = 0;
    let userReposHits = 0;
    let reposHits = 0;
    const monolith = startFixtureServer((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/api/user") userHits += 1;
      else if (url.pathname === "/api/user/repos") userReposHits += 1;
      else if (url.pathname === "/api/repos") reposHits += 1;
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });

    try {
      const env = { ...keyEnv, AUTH_API_BASE_URL: monolith.origin };
      const r1 = await worker.fetch(new Request(`${ORIGIN}/api/user`), env);
      const r2 = await worker.fetch(new Request(`${ORIGIN}/api/user/repos`), env);
      const r3 = await worker.fetch(new Request(`${ORIGIN}/api/repos`), env);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(200);
      expect(userHits).toBe(1);
      expect(userReposHits).toBe(1);
      expect(reposHits).toBe(1);
    } finally {
      monolith.stop();
    }
  });

  test("auth-only: AUTH_API_BASE_URL set, platform routes still fall back to auth (monolith assumption)", async () => {
    let authPath = "";
    const auth = startFixtureServer((request) => {
      authPath = new URL(request.url).pathname;
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });
    try {
      // /api/user/repos with no GO_API_BASE_URL falls back to AUTH base.
      const res = await worker.fetch(new Request(`${ORIGIN}/api/user/repos`), {
        ...keyEnv,
        AUTH_API_BASE_URL: auth.origin,
      });
      expect(res.status).toBe(200);
      expect(authPath).toBe("/api/user/repos");
    } finally {
      auth.stop();
    }
  });

  test("platform-only: GO_API_BASE_URL set without AUTH — platform routes work, /api/user 404s cleanly", async () => {
    let platformPath = "";
    const platform = startFixtureServer((request) => {
      platformPath = new URL(request.url).pathname;
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });
    try {
      const env = { ...keyEnv, GO_API_BASE_URL: platform.origin };
      // /api/user/repos goes to GO_API
      const r1 = await worker.fetch(new Request(`${ORIGIN}/api/user/repos`), env);
      expect(r1.status).toBe(200);
      expect(platformPath).toBe("/api/user/repos");
      // /api/repos goes to GO_API
      const r2 = await worker.fetch(new Request(`${ORIGIN}/api/repos/acme/widgets`), env);
      expect(r2.status).toBe(200);
      expect(platformPath).toBe("/api/repos/acme/widgets");
      // /api/user (identity) has no auth backend → falls through to 404.
      const r3 = await worker.fetch(new Request(`${ORIGIN}/api/user`), env);
      expect(r3.status).toBe(404);
    } finally {
      platform.stop();
    }
  });

  test("missing-config: neither AUTH nor GO set — every platform/auth route 404s without an upstream", async () => {
    const r1 = await worker.fetch(new Request(`${ORIGIN}/api/user`), keyEnv);
    const r2 = await worker.fetch(new Request(`${ORIGIN}/api/user/repos`), keyEnv);
    const r3 = await worker.fetch(new Request(`${ORIGIN}/api/repos`), keyEnv);
    const r4 = await worker.fetch(new Request(`${ORIGIN}/api/orgs/acme`), keyEnv);
    expect(r1.status).toBe(404);
    expect(r2.status).toBe(404);
    expect(r3.status).toBe(404);
    expect(r4.status).toBe(404);
  });

  test("auth-identity sub-routes (not in platform set) stay on AUTH even when GO_API is configured", async () => {
    let authPath = "";
    const auth = startFixtureServer((request) => {
      authPath = new URL(request.url).pathname;
      return new Response(JSON.stringify({ keys: [] }), {
        headers: { "content-type": "application/json" },
      });
    });
    const platform = startFixtureServer(
      () => new Response("platform should not see auth identity sub-routes", { status: 500 }),
    );
    try {
      const env = {
        ...keyEnv,
        AUTH_API_BASE_URL: auth.origin,
        GO_API_BASE_URL: platform.origin,
      };
      // /api/user/keys is not in PLATFORM_USER_SUBPATHS → must stay on AUTH.
      const res = await worker.fetch(new Request(`${ORIGIN}/api/user/keys`), env);
      expect(res.status).toBe(200);
      expect(authPath).toBe("/api/user/keys");
    } finally {
      platform.stop();
      auth.stop();
    }
  });

  test("forwards path, query, cookie, and body to the platform target with redirect=manual", async () => {
    type SeenRequest = {
      pathname: string;
      search: string;
      cookie: string;
      method: string;
      body: string;
    };
    const seen: { value: SeenRequest | null } = { value: null };
    const platform = startFixtureServer(async (request) => {
      const url = new URL(request.url);
      seen.value = {
        pathname: url.pathname,
        search: url.search,
        cookie: request.headers.get("cookie") ?? "",
        method: request.method,
        body: await request.text(),
      };
      // Return a 302 with a Location pointing back at the upstream origin: the
      // worker must rewrite that to a same-origin path, never leak the upstream.
      const loc = new URL(`${platform.origin}/api/repos/acme/widgets/issues/1`);
      return new Response(null, {
        status: 302,
        headers: { location: loc.toString() },
      });
    });
    try {
      const res = await worker.fetch(
        new Request(`${ORIGIN}/api/repos/acme/widgets/issues?state=open`, {
          method: "POST",
          headers: { cookie: "smithers_session=ok", "content-type": "application/json" },
          body: JSON.stringify({ title: "hi" }),
          redirect: "manual",
        }),
        { ...keyEnv, GO_API_BASE_URL: platform.origin },
      );
      expect(res.status).toBe(302);
      expect(seen.value).not.toBeNull();
      const actual = seen.value as SeenRequest;
      expect(actual.pathname).toBe("/api/repos/acme/widgets/issues");
      expect(actual.search).toBe("?state=open");
      expect(actual.cookie).toContain("smithers_session=ok");
      expect(actual.method).toBe("POST");
      expect(JSON.parse(actual.body)).toEqual({ title: "hi" });
      const rewritten = new URL(res.headers.get("location") ?? "");
      expect(rewritten.origin).toBe(ORIGIN);
      expect(rewritten.pathname).toBe("/api/repos/acme/widgets/issues/1");
    } finally {
      platform.stop();
    }
  });

  test("large paginated responses stream through without buffering or stalling", async () => {
    // 200 fake repos, JSON-serialized. Larger than the default 64KB Node fetch
    // buffer so any accidental .text() / .json() in the proxy path would show
    // up as a memory blip or a hang. We assert byte-for-byte equality of the
    // entire body and the Link header forwarding.
    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      full_name: `acme/widget-${i}`,
      name: `widget-${i}`,
      owner: { username: "acme" },
      description: "x".repeat(512),
    }));
    const payload = JSON.stringify(rows);
    const platform = startFixtureServer(
      () =>
        new Response(payload, {
          headers: {
            "content-type": "application/json",
            link: '</api/user/repos?cursor=p2>; rel="next"',
          },
        }),
    );

    try {
      const res = await worker.fetch(
        new Request(`${ORIGIN}/api/user/repos`, {
          headers: { cookie: "smithers_session=ok" },
        }),
        { ...keyEnv, GO_API_BASE_URL: platform.origin },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("link")).toContain('rel="next"');
      const text = await res.text();
      expect(text.length).toBe(payload.length);
      expect(text).toBe(payload);
    } finally {
      platform.stop();
    }
  });

  test("does NOT attach Plue trusted-proxy headers to platform requests (no header smuggling)", async () => {
    // The worker mints x-user-id / x-user-scopes for the gateway only. For the
    // platform proxy, jjhub validates the session itself — credentials forward
    // as the cookie/authorization, never as trusted-proxy identity headers.
    const seen: { value: TrustedProxyHeaders | null } = { value: null };
    const platform = startFixtureServer((request) => {
      seen.value = trustedProxyHeaders(request);
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });
    try {
      const res = await worker.fetch(
        new Request(`${ORIGIN}/api/user/repos`, {
          headers: { cookie: "smithers_session=ok", ...SPOOFED_TRUSTED_PROXY_HEADERS },
        }),
        { ...keyEnv, GO_API_BASE_URL: platform.origin },
      );
      expect(res.status).toBe(200);
      expect(seen.value).not.toBeNull();
      expectTrustedProxyHeadersStripped(seen.value as TrustedProxyHeaders);
    } finally {
      platform.stop();
    }
  });

  test("strips browser-supplied trusted-proxy headers from auth proxy requests", async () => {
    const seen: { value: TrustedProxyHeaders | null } = { value: null };
    const auth = startFixtureServer((request) => {
      seen.value = trustedProxyHeaders(request);
      return new Response(JSON.stringify({ id: 7, username: "will", is_admin: false }), {
        headers: { "content-type": "application/json" },
      });
    });

    try {
      const res = await worker.fetch(
        new Request(`${ORIGIN}/api/user`, {
          headers: {
            cookie: "smithers_session=ok",
            ...SPOOFED_TRUSTED_PROXY_HEADERS,
          },
        }),
        { ...keyEnv, AUTH_API_BASE_URL: auth.origin },
      );
      expect(res.status).toBe(200);
      expect(seen.value).not.toBeNull();
      expectTrustedProxyHeadersStripped(seen.value as TrustedProxyHeaders);
    } finally {
      auth.stop();
    }
  });

  test("does not forward browser-supplied trusted-proxy headers to the chat model upstream", async () => {
    const seen: { value: TrustedProxyHeaders | null } = { value: null };
    const upstream = startFixtureServer((request) => {
      seen.value = trustedProxyHeaders(request);
      const chunk = {
        id: "chatcmpl-fixture",
        object: "chat.completion.chunk",
        created: 1700000000,
        model: "fixture",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    });

    try {
      const res = await worker.fetch(
        chatRequest(
          { messages: [{ role: "user", content: "hi" }] },
          {
            headers: {
              "content-type": "application/json",
              origin: ORIGIN,
              ...SPOOFED_TRUSTED_PROXY_HEADERS,
            },
          },
        ),
        {
          ...keyEnv,
          CEREBRAS_BASE_URL: `${upstream.origin}/v1`,
          CEREBRAS_MODEL: "fixture",
        },
      );
      expect(res.status).toBe(200);
      await res.text();
      expect(seen.value).not.toBeNull();
      expectTrustedProxyHeadersStripped(seen.value as TrustedProxyHeaders);
    } finally {
      upstream.stop();
    }
  });

  test("validates a Plue session before minting trusted gateway headers", async () => {
    let authSeenAuthorization = "";
    const auth = startFixtureServer((request) => {
      const cookie = request.headers.get("cookie") ?? "";
      authSeenAuthorization = request.headers.get("authorization") ?? "";
      if (!cookie.includes("smithers_session=ok")) {
        return new Response("unauthorized", { status: 401 });
      }
      return new Response(JSON.stringify({ id: 7, username: "will", is_admin: true }), {
        headers: { "content-type": "application/json" },
      });
    });
    const gateway = startFixtureServer((request) => {
      return new Response(
        JSON.stringify({
          userId: request.headers.get("x-user-id"),
          role: request.headers.get("x-user-role"),
          scopes: request.headers.get("x-user-scopes"),
          tokenId: request.headers.get("x-smithers-token-id"),
          authorization: request.headers.get("authorization"),
          smithersKey: request.headers.get("x-smithers-key"),
        }),
        { headers: { "content-type": "application/json" } },
      );
    });

    try {
      const res = await worker.fetch(
        new Request(`${ORIGIN}/v1/rpc/listRuns`, {
          method: "POST",
          headers: {
            cookie: "smithers_session=ok",
            authorization: "Bearer plue-token",
            "x-smithers-key": "browser-gateway-token",
            "x-user-id": "spoofed",
          },
          body: "{}",
        }),
        {
          ...keyEnv,
          AUTH_API_BASE_URL: auth.origin,
          GATEWAY_BASE_URL: gateway.origin,
        },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.userId).toBe("7");
      expect(body.role).toBe("admin");
      expect(body.scopes).toContain("run:admin");
      expect(body.tokenId).toBe("plue:7");
      expect(body.authorization).toBe(null);
      expect(body.smithersKey).toBe(null);
      expect(authSeenAuthorization).toBe("Bearer plue-token");
    } finally {
      gateway.stop();
      auth.stop();
    }
  });

  test("returns a v1 RPC auth frame when Plue session validation fails", async () => {
    let gatewayHits = 0;
    const auth = startFixtureServer(() => new Response("unauthorized", { status: 401 }));
    const gateway = startFixtureServer(() => {
      gatewayHits += 1;
      return new Response("should not be reached");
    });

    try {
      const res = await worker.fetch(
        new Request(`${ORIGIN}/v1/rpc/listRuns`, { method: "POST", body: "{}" }),
        {
          ...keyEnv,
          AUTH_API_BASE_URL: auth.origin,
          GATEWAY_BASE_URL: gateway.origin,
        },
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        type: "res",
        ok: false,
        error: { code: "UNAUTHORIZED" },
      });
      expect(gatewayHits).toBe(0);
    } finally {
      gateway.stop();
      auth.stop();
    }
  });

  test("fails closed when a gateway is configured without Plue auth or a worker gateway token", async () => {
    let gatewayHits = 0;
    const gateway = startFixtureServer(() => {
      gatewayHits += 1;
      return new Response("should not be reached");
    });

    try {
      const res = await worker.fetch(
        new Request(`${ORIGIN}/v1/rpc/listRuns`, {
          method: "POST",
          headers: {
            authorization: "Bearer junk",
            "x-smithers-key": "junk",
          },
          body: "{}",
        }),
        {
          ...keyEnv,
          GATEWAY_BASE_URL: gateway.origin,
        },
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        type: "res",
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Gateway authentication service is not configured",
        },
      });
      expect(gatewayHits).toBe(0);
    } finally {
      gateway.stop();
    }
  });

  test("passes worker gateway tokens without trusting browser credential or identity headers", async () => {
    let authHits = 0;
    const auth = startFixtureServer(() => {
      authHits += 1;
      return new Response("unexpected", { status: 500 });
    });
    const gateway = startFixtureServer((request) => {
      return new Response(
        JSON.stringify({
          authorization: request.headers.get("authorization"),
          smithersKey: request.headers.get("x-smithers-key"),
          userId: request.headers.get("x-user-id"),
        }),
        { headers: { "content-type": "application/json" } },
      );
    });

    try {
      const res = await worker.fetch(
        new Request(`${ORIGIN}/v1/rpc/listRuns`, {
          method: "POST",
          headers: {
            authorization: "Bearer browser-plue-token",
            "x-smithers-key": "browser-gateway-token",
            "x-user-id": "spoofed",
          },
          body: "{}",
        }),
        {
          ...keyEnv,
          AUTH_API_BASE_URL: auth.origin,
          GATEWAY_BASE_URL: gateway.origin,
          GATEWAY_AUTH_TOKEN: "gateway-token",
        },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authorization).toBe("Bearer gateway-token");
      expect(body.smithersKey).toBe(null);
      expect(body.userId).toBe(null);
      expect(authHits).toBe(0);
    } finally {
      gateway.stop();
      auth.stop();
    }
  });

  test("can require auth before /api/chat reaches the model gateway", async () => {
    const auth = startFixtureServer(() => new Response("unauthorized", { status: 401 }));
    try {
      const res = await worker.fetch(chatRequest({ messages: [] }), {
        ...keyEnv,
        AUTH_API_BASE_URL: auth.origin,
      });
      expect(res.status).toBe(401);
    } finally {
      auth.stop();
    }
  });
});

describe("worker → fixture upstream (keyless gateway)", () => {
  const upstream = startCerebrasUpstream();
  const env: CloudflareEnv = {
    CEREBRAS_API_KEY: "fixture-key",
    CEREBRAS_BASE_URL: `http://127.0.0.1:${upstream.port}/v1`,
  };

  afterAll(() => upstream.stop(true));

  test("streams the seeded reply as SSE TEXT_MESSAGE_CONTENT deltas", async () => {
    const res = await worker.fetch(
      chatRequest({ messages: [{ role: "user", content: "make a plan" }] }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const chunks = parseSse(await res.text());
    expect(chunks.some((c) => c.type === "RUN_ERROR")).toBe(false);

    const text = chunks
      .filter((c) => c.type === "TEXT_MESSAGE_CONTENT" && typeof c.delta === "string")
      .map((c) => c.delta as string)
      .join("");
    expect(text).toBe(SEEDED_CHAT_REPLY);
  }, 20_000);

  test("forwards an optional system prompt without error", async () => {
    const res = await worker.fetch(
      chatRequest({ messages: [{ role: "user", content: "hi" }], system: "Be terse." }),
      env,
    );
    expect(res.status).toBe(200);
    const chunks = parseSse(await res.text());
    expect(chunks.some((c) => c.type === "RUN_ERROR")).toBe(false);
    expect(chunks.some((c) => c.type === "TEXT_MESSAGE_CONTENT")).toBe(true);
  }, 20_000);
});
