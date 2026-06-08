import { afterEach, describe, expect, test } from "bun:test";
import {
  getRepo,
  listAllUserRepos,
  listUserReadableRepos,
  listUserRepos,
} from "./repos";
import { setPlatformBaseUrlForTesting } from "./platformBaseUrl";
import { PlatformError } from "./platformJson";

/**
 * Real-fetch tests against a Bun.serve fixture playing jjhub. No mocks: the
 * client builds real requests, the fixture returns the same wire shapes the
 * production server returns, and we assert the parser, pagination cursor,
 * and error path all line up. localStorage comes from happy-dom via the test
 * preload so `setPlatformBaseUrl` flips the base origin per test.
 */

type Server = { origin: string; stop: () => void };

function startFixture(
  fetch: (request: Request) => Response | Promise<Response>,
): Server {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch });
  return {
    origin: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

const REPO_PAGE_1 = [
  {
    id: 7,
    full_name: "acme/widgets",
    name: "widgets",
    owner: { username: "acme" },
    description: "Widgets-as-a-service",
    private: false,
    default_branch: "main",
    html_url: "https://jjhub.example/acme/widgets",
    stars_count: 12,
    forks_count: 3,
    open_issues_count: 4,
    pushed_at: "2026-06-01T10:00:00Z",
    updated_at: "2026-06-02T11:00:00Z",
  },
  {
    id: 8,
    full_name: "acme/sparkles",
    name: "sparkles",
    owner: { username: "acme" },
    description: "",
    private: true,
    default_branch: "trunk",
    html_url: "https://jjhub.example/acme/sparkles",
    stars_count: 1,
    forks_count: 0,
    open_issues_count: 0,
    pushed_at: null,
    updated_at: "2026-06-03T11:00:00Z",
  },
];

const REPO_PAGE_2 = [
  {
    id: 9,
    full_name: "ada/things",
    name: "things",
    owner: { username: "ada" },
    description: "Things and stuff",
    private: false,
    default_branch: "main",
    html_url: "https://jjhub.example/ada/things",
    stars_count: 0,
    forks_count: 0,
    open_issues_count: 0,
    pushed_at: null,
    updated_at: null,
  },
];

let fixture: Server | null = null;

afterEach(() => {
  if (fixture) {
    fixture.stop();
    fixture = null;
  }
  setPlatformBaseUrlForTesting("");
});

describe("listUserRepos", () => {
  test("parses a single page and reads the Link header cursor", async () => {
    fixture = startFixture((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/api/user/repos");
      expect(url.searchParams.get("visibility")).toBe("private");
      expect(url.searchParams.get("limit")).toBe("30");
      return new Response(JSON.stringify(REPO_PAGE_1), {
        headers: {
          "content-type": "application/json",
          link: '</api/user/repos?cursor=page-2&limit=30>; rel="next"',
        },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const page = await listUserRepos({ visibility: "private", limit: 30 });
    expect(page.nextCursor).toBe("page-2");
    expect(page.repos).toHaveLength(2);
    expect(page.repos[0]?.fullName).toBe("acme/widgets");
    expect(page.repos[0]?.owner).toBe("acme");
    expect(page.repos[0]?.isPrivate).toBe(false);
    expect(page.repos[0]?.defaultBranch).toBe("main");
    expect(page.repos[1]?.isPrivate).toBe(true);
    expect(page.repos[1]?.defaultBranch).toBe("trunk");
  });

  test("returns nextCursor=null on the last page", async () => {
    fixture = startFixture(
      () =>
        new Response(JSON.stringify([]), {
          headers: { "content-type": "application/json" },
        }),
    );
    setPlatformBaseUrlForTesting(fixture.origin);

    const page = await listUserRepos();
    expect(page.nextCursor).toBe(null);
    expect(page.repos).toEqual([]);
  });

  test("throws PlatformError with the wire error code", async () => {
    fixture = startFixture(
      () =>
        new Response(
          JSON.stringify({ error: { code: "rate_limited", message: "slow down" } }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
    );
    setPlatformBaseUrlForTesting(fixture.origin);

    let caught: unknown = null;
    try {
      await listUserRepos();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PlatformError);
    expect((caught as PlatformError).status).toBe(429);
    expect((caught as PlatformError).code).toBe("rate_limited");
  });

  test("skips a malformed row instead of crashing the whole page", async () => {
    fixture = startFixture(
      () =>
        new Response(JSON.stringify([{ id: 1 }, REPO_PAGE_1[0]]), {
          headers: { "content-type": "application/json" },
        }),
    );
    setPlatformBaseUrlForTesting(fixture.origin);

    const page = await listUserRepos();
    expect(page.repos).toHaveLength(1);
    expect(page.repos[0]?.fullName).toBe("acme/widgets");
  });

  test("preserves String(id) for both numeric and UUID ids", async () => {
    // jjhub returns numeric ids in the GitHub-compatible shape; sibling cloud
    // services (and a couple of staging environments) return UUIDs. The parser
    // previously dropped UUID rows on the floor; now both round-trip.
    const UUID = "0192ec5a-15a8-7ec2-9c25-4e9d52b40000";
    fixture = startFixture(
      () =>
        new Response(
          JSON.stringify([
            { ...REPO_PAGE_1[0], id: 7 },
            { ...REPO_PAGE_1[0], id: UUID, full_name: "uuid/repo", name: "repo" },
          ]),
          { headers: { "content-type": "application/json" } },
        ),
    );
    setPlatformBaseUrlForTesting(fixture.origin);

    const page = await listUserRepos();
    expect(page.repos).toHaveLength(2);
    expect(page.repos[0]?.id).toBe("7");
    expect(page.repos[1]?.id).toBe(UUID);
    expect(page.repos[1]?.fullName).toBe("uuid/repo");
  });
});

describe("listUserReadableRepos", () => {
  test("targets the readable-repos path", async () => {
    let seenPath = "";
    fixture = startFixture((request) => {
      seenPath = new URL(request.url).pathname;
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    await listUserReadableRepos();
    expect(seenPath).toBe("/api/user/readable-repos");
  });
});

describe("listAllUserRepos", () => {
  test("walks the Link cursor across pages and stops at the last", async () => {
    fixture = startFixture((request) => {
      const url = new URL(request.url);
      if (url.searchParams.get("cursor") === "page-2") {
        return new Response(JSON.stringify(REPO_PAGE_2), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(REPO_PAGE_1), {
        headers: {
          "content-type": "application/json",
          link: '</api/user/repos?cursor=page-2>; rel="next"',
        },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const all = await listAllUserRepos({ limit: 30 });
    expect(all.map((r) => r.fullName)).toEqual([
      "acme/widgets",
      "acme/sparkles",
      "ada/things",
    ]);
  });

  test("caps the walk at maxPages so a runaway Link header is bounded", async () => {
    let pageCount = 0;
    fixture = startFixture(() => {
      pageCount += 1;
      return new Response(JSON.stringify(REPO_PAGE_1.slice(0, 1)), {
        headers: {
          "content-type": "application/json",
          link: '</api/user/repos?cursor=infinite>; rel="next"',
        },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const all = await listAllUserRepos({}, 3);
    expect(all).toHaveLength(3);
    expect(pageCount).toBe(3);
  });
});

describe("getRepo", () => {
  test("builds a path-encoded URL and parses the response", async () => {
    let seenPath = "";
    fixture = startFixture((request) => {
      seenPath = new URL(request.url).pathname;
      return new Response(JSON.stringify(REPO_PAGE_1[0]), {
        headers: { "content-type": "application/json" },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const repo = await getRepo("acme org", "the-widgets");
    expect(seenPath).toBe("/api/repos/acme%20org/the-widgets");
    expect(repo.fullName).toBe("acme/widgets");
    expect(repo.openIssuesCount).toBe(4);
  });

  test("404 surfaces as PlatformError", async () => {
    fixture = startFixture(
      () =>
        new Response(JSON.stringify({ error: { code: "not_found", message: "no" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );
    setPlatformBaseUrlForTesting(fixture.origin);

    let caught: unknown = null;
    try {
      await getRepo("acme", "nope");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PlatformError);
    expect((caught as PlatformError).status).toBe(404);
    expect((caught as PlatformError).code).toBe("not_found");
  });
});
