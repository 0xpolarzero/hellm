/**
 * A real Bun.serve fixture that imitates the jjhub REST API for e2e.
 *
 * Implements the platform routes the bridge exercises:
 *  - GET /api/user                       → identity (Plue monolith mode)
 *  - GET /api/user/repos                 → cursor-paginated repo list
 *  - GET /api/user/workspaces            → list one fake workspace
 *  - GET /api/user/issues                → list one fake issue
 *  - GET /api/repos/:owner/:repo/issues  → list issues for a repo
 *  - GET /api/notifications              → list one fake notification
 *
 * Deterministic seeded data: every request returns the same body, so the e2e
 * spec asserts byte-for-byte. The fixture is real — same wire format as the
 * production server — so no mocks anywhere in the chain.
 *
 * Run via the Playwright webServer:
 *   SMITHERS_PLUE_PORT=5279 bun tests/fixtures/plueFixture.ts
 */

const port = Number(process.env.SMITHERS_PLUE_PORT ?? 5279);

const SEEDED_USER = {
  id: 42,
  username: "fixture-user",
  display_name: "Fixture User",
  email: "fixture@plue.test",
  avatar_url: "",
  is_admin: false,
  // The split-config e2e flips AUTH_API_BASE_URL at this fixture's sibling
  // (authFixture) so any /api/user response carrying source="platform-fixture"
  // proves the Worker misrouted identity to the platform target.
  source: "platform-fixture",
};

const SEEDED_REPOS = [
  {
    id: 1,
    full_name: "fixture/widgets",
    name: "widgets",
    owner: { username: "fixture" },
    description: "Fixture repo",
    private: false,
    default_branch: "main",
    html_url: "https://plue.test/fixture/widgets",
    stars_count: 0,
    forks_count: 0,
    open_issues_count: 1,
    pushed_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  },
];

const SEEDED_ISSUES = [
  {
    id: 1,
    number: 1,
    title: "Fixture issue",
    body: "Seeded from the Plue fixture.",
    state: "open",
    html_url: "https://plue.test/fixture/widgets/issues/1",
    labels: [{ name: "fixture", color: "00aaff" }],
    assignees: [],
    user: { id: 42, username: "fixture-user", avatar_url: "" },
    comments: 0,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    closed_at: null,
  },
];

const SEEDED_WORKSPACES = [
  {
    id: "ws-1",
    slug: "fixture-dev",
    name: "Fixture dev",
    repo: "fixture/widgets",
    branch: "main",
    state: "running",
    html_url: "https://plue.test/w/fixture-dev",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  },
];

const SEEDED_NOTIFICATIONS = [
  {
    id: "note-1",
    unread: true,
    reason: "mention",
    subject: {
      title: "Fixture issue",
      url: "https://plue.test/fixture/widgets/issues/1",
      type: "Issue",
    },
    repository: { full_name: "fixture/widgets" },
    updated_at: "2026-06-01T00:00:00Z",
    last_read_at: null,
  },
];

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

    if (path === "/health") return new Response("ok");
    if (path === "/api/user") return json(SEEDED_USER);
    if (path === "/api/user/repos") return json(SEEDED_REPOS);
    if (path === "/api/user/workspaces") return json(SEEDED_WORKSPACES);
    if (path === "/api/user/issues") return json(SEEDED_ISSUES);
    if (path === "/api/user/orgs") return json([]);
    if (path === "/api/user/starred") return json([]);
    if (path === "/api/user/readable-repos") return json(SEEDED_REPOS);
    if (path === "/api/notifications") {
      if (request.method === "PUT") return new Response(null, { status: 205 });
      return json(SEEDED_NOTIFICATIONS);
    }
    if (/^\/api\/repos\/[^/]+\/[^/]+\/issues\/?$/.test(path)) {
      return json(SEEDED_ISSUES);
    }
    if (/^\/api\/repos\/[^/]+\/[^/]+$/.test(path)) {
      return json(SEEDED_REPOS[0]);
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`[plue-fixture] listening on http://127.0.0.1:${server.port}`);
