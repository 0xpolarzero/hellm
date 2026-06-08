/**
 * Auth-only Plue fixture: serves the identity endpoint (`/api/user`) used by
 * the Worker to validate sessions. Distinct from `plueFixture.ts` so the
 * split-config e2e can run with `AUTH_API_BASE_URL` pointing here and
 * `GO_API_BASE_URL` pointing at the platform fixture — proving the Worker
 * routes auth-identity sub-routes (`/api/user`, `/api/user/keys`) to AUTH and
 * platform user sub-routes (`/api/user/repos`, …) to GO.
 *
 * Deterministic body: `auth-user` so a test can assert which fixture answered
 * a given route.
 *
 * Run via the Playwright webServer:
 *   SMITHERS_AUTH_PORT=5280 bun tests/fixtures/authFixture.ts
 */

const port = Number(process.env.SMITHERS_AUTH_PORT ?? 5280);

const SEEDED_AUTH_USER = {
  id: 42,
  username: "fixture-user",
  display_name: "Fixture User",
  email: "fixture@plue.test",
  avatar_url: "",
  is_admin: false,
  // A field unique to this fixture so the split-config e2e can prove the
  // identity body came from AUTH, not from the platform fixture. Keeps the
  // username stable so the existing plueBridge.spec.ts assertion still holds.
  source: "auth-fixture",
};

const SEEDED_KEYS = { keys: [] };
const INVALID_TOKENS = new Set(["smithers_definitely_not_valid"]);

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(request: Request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const authorization = request.headers.get("authorization");
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

    if (path === "/health") return new Response("ok");
    if (bearer && INVALID_TOKENS.has(bearer)) {
      return json({ error: "invalid token" }, { status: 401 });
    }
    if (path === "/api/user") return json(SEEDED_AUTH_USER);
    // Auth-identity sub-routes that the Worker leaves on AUTH (not in
    // PLATFORM_USER_SUBPATHS): /api/user/keys, /api/user/settings/*.
    if (path === "/api/user/keys") return json(SEEDED_KEYS);
    if (path.startsWith("/api/user/settings/")) return json({});
    if (path.startsWith("/api/auth/")) return json({ ok: true });
    return new Response("not found on auth fixture", { status: 404 });
  },
});

console.log(`[auth-fixture] listening on http://127.0.0.1:${server.port}`);
