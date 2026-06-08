import { afterEach, describe, expect, test } from "bun:test";
import { setPlatformBaseUrlForTesting } from "./platformBaseUrl";
import { PlatformError } from "./platformJson";
import { getWorkspace, listAllUserWorkspaces, listUserWorkspaces } from "./workspaces";

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

const W = {
  id: "w-1",
  slug: "smithers-dev",
  name: "Smithers dev",
  repo: "acme/widgets",
  branch: "feature/dock",
  state: "running",
  html_url: "https://jjhub.example/w/smithers-dev",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-02T00:00:00Z",
};

let fixture: Server | null = null;

afterEach(() => {
  if (fixture) {
    fixture.stop();
    fixture = null;
  }
  setPlatformBaseUrlForTesting("");
});

describe("listUserWorkspaces", () => {
  test("parses payload + cursor; forwards `state` filter", async () => {
    let seenSearch = "";
    fixture = startFixture((request) => {
      seenSearch = new URL(request.url).search;
      return new Response(JSON.stringify([W]), {
        headers: {
          "content-type": "application/json",
          link: '</api/user/workspaces?cursor=next>; rel="next"',
        },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const page = await listUserWorkspaces({ state: "running", limit: 10 });
    expect(seenSearch).toContain("state=running");
    expect(seenSearch).toContain("limit=10");
    expect(page.nextCursor).toBe("next");
    expect(page.workspaces[0]?.slug).toBe("smithers-dev");
    expect(page.workspaces[0]?.state).toBe("running");
    expect(page.workspaces[0]?.repoFullName).toBe("acme/widgets");
  });

  test("defaults unknown state to stopped", async () => {
    fixture = startFixture(
      () =>
        new Response(JSON.stringify([{ ...W, state: "weird-bogus" }]), {
          headers: { "content-type": "application/json" },
        }),
    );
    setPlatformBaseUrlForTesting(fixture.origin);

    const page = await listUserWorkspaces();
    expect(page.workspaces[0]?.state).toBe("stopped");
  });
});

describe("listAllUserWorkspaces", () => {
  test("walks pages", async () => {
    fixture = startFixture((request) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      if (cursor === "p2") {
        return new Response(JSON.stringify([{ ...W, id: "w-2", slug: "second" }]), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify([W]), {
        headers: {
          "content-type": "application/json",
          link: '</api/user/workspaces?cursor=p2>; rel="next"',
        },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const all = await listAllUserWorkspaces();
    expect(all.map((w) => w.slug)).toEqual(["smithers-dev", "second"]);
  });
});

describe("getWorkspace", () => {
  test("returns workspace by slug", async () => {
    let seenPath = "";
    fixture = startFixture((request) => {
      seenPath = new URL(request.url).pathname;
      return new Response(JSON.stringify(W), {
        headers: { "content-type": "application/json" },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const ws = await getWorkspace("smithers-dev");
    expect(seenPath).toBe("/api/workspaces/smithers-dev");
    expect(ws.name).toBe("Smithers dev");
  });

  test("404 → PlatformError", async () => {
    fixture = startFixture(
      () =>
        new Response(JSON.stringify({ error: { code: "not_found", message: "" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );
    setPlatformBaseUrlForTesting(fixture.origin);

    let caught: unknown = null;
    try {
      await getWorkspace("nope");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PlatformError);
    expect((caught as PlatformError).code).toBe("not_found");
  });
});
