import { afterEach, describe, expect, test } from "bun:test";
import { getLanding, listAllLandings, listLandings, listUserLandings } from "./landings";
import { setPlatformBaseUrlForTesting } from "./platformBaseUrl";
import { PlatformError } from "./platformJson";

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

const LANDING_1 = {
  id: 1,
  number: 5,
  title: "Feature dock",
  body: "Implements the apps dock.",
  state: "open",
  html_url: "https://jjhub.example/acme/widgets/landings/5",
  base: { ref: "main" },
  head: { ref: "feature/dock" },
  user: { id: 1, username: "will", avatar_url: "https://cdn/avatar/1" },
  draft: false,
  mergeable: true,
  merged: false,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-02T00:00:00Z",
  merged_at: null,
  closed_at: null,
};

const LANDING_MERGED = {
  ...LANDING_1,
  id: 2,
  number: 4,
  title: "Old shipped thing",
  state: "merged",
  merged: true,
  merged_at: "2026-04-30T00:00:00Z",
};

let fixture: Server | null = null;

afterEach(() => {
  if (fixture) {
    fixture.stop();
    fixture = null;
  }
  setPlatformBaseUrlForTesting("");
});

describe("listLandings", () => {
  test("parses base/head refs and state", async () => {
    fixture = startFixture(
      () =>
        new Response(JSON.stringify([LANDING_1, LANDING_MERGED]), {
          headers: {
            "content-type": "application/json",
            link: '</api/repos/acme/widgets/landings?cursor=next>; rel="next"',
          },
        }),
    );
    setPlatformBaseUrlForTesting(fixture.origin);

    const page = await listLandings("acme", "widgets", { state: "all" });
    expect(page.nextCursor).toBe("next");
    expect(page.landings[0]?.baseRef).toBe("main");
    expect(page.landings[0]?.headRef).toBe("feature/dock");
    expect(page.landings[0]?.state).toBe("open");
    expect(page.landings[1]?.state).toBe("merged");
    expect(page.landings[1]?.merged).toBe(true);
  });
});

describe("listAllLandings", () => {
  test("aggregates multi-page lists", async () => {
    fixture = startFixture((request) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      if (cursor === "p2") {
        return new Response(JSON.stringify([LANDING_MERGED]), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify([LANDING_1]), {
        headers: {
          "content-type": "application/json",
          link: '</api/repos/acme/widgets/landings?cursor=p2>; rel="next"',
        },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const all = await listAllLandings("acme", "widgets");
    expect(all.map((l) => l.number)).toEqual([5, 4]);
  });
});

describe("listUserLandings", () => {
  test("hits /api/user/landings", async () => {
    let seenPath = "";
    fixture = startFixture((request) => {
      seenPath = new URL(request.url).pathname;
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    await listUserLandings();
    expect(seenPath).toBe("/api/user/landings");
  });
});

describe("getLanding", () => {
  test("returns one landing", async () => {
    fixture = startFixture(
      () =>
        new Response(JSON.stringify(LANDING_1), {
          headers: { "content-type": "application/json" },
        }),
    );
    setPlatformBaseUrlForTesting(fixture.origin);

    const landing = await getLanding("acme", "widgets", 5);
    expect(landing.title).toBe("Feature dock");
    expect(landing.user?.username).toBe("will");
  });

  test("502 surfaces as PlatformError", async () => {
    fixture = startFixture(() => new Response("bad gateway", { status: 502 }));
    setPlatformBaseUrlForTesting(fixture.origin);

    let caught: unknown = null;
    try {
      await getLanding("acme", "widgets", 5);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PlatformError);
    expect((caught as PlatformError).status).toBe(502);
  });
});
