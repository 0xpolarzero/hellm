import { afterEach, describe, expect, test } from "bun:test";
import {
  listAllNotifications,
  listNotifications,
  markAllNotificationsRead,
} from "./notifications";
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

const N = {
  id: "abc-123",
  unread: true,
  reason: "mention",
  subject: {
    title: "Card overflows",
    url: "https://jjhub.example/acme/widgets/issues/42",
    type: "Issue",
  },
  repository: { full_name: "acme/widgets" },
  updated_at: "2026-05-02T00:00:00Z",
  last_read_at: null,
};

let fixture: Server | null = null;

afterEach(() => {
  if (fixture) {
    fixture.stop();
    fixture = null;
  }
  setPlatformBaseUrlForTesting("");
});

describe("listNotifications", () => {
  test("forwards `all=true` + `since`, parses cursor", async () => {
    let seenSearch = "";
    fixture = startFixture((request) => {
      seenSearch = new URL(request.url).search;
      return new Response(JSON.stringify([N]), {
        headers: {
          "content-type": "application/json",
          link: '</api/notifications?cursor=p2>; rel="next"',
        },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const page = await listNotifications({ all: true, since: "2026-01-01T00:00:00Z" });
    expect(seenSearch).toContain("all=true");
    expect(seenSearch).toContain("since=2026-01-01");
    expect(page.nextCursor).toBe("p2");
    expect(page.notifications[0]?.id).toBe("abc-123");
    expect(page.notifications[0]?.subject.title).toBe("Card overflows");
    expect(page.notifications[0]?.repoFullName).toBe("acme/widgets");
    expect(page.notifications[0]?.unread).toBe(true);
  });
});

describe("listAllNotifications", () => {
  test("walks pages and aggregates", async () => {
    fixture = startFixture((request) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      if (cursor === "p2") {
        return new Response(JSON.stringify([{ ...N, id: "def-456" }]), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify([N]), {
        headers: {
          "content-type": "application/json",
          link: '</api/notifications?cursor=p2>; rel="next"',
        },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const all = await listAllNotifications();
    expect(all.map((n) => n.id)).toEqual(["abc-123", "def-456"]);
  });
});

describe("markAllNotificationsRead", () => {
  test("PUTs /api/notifications, accepts 205 reset content", async () => {
    let method = "";
    fixture = startFixture((request) => {
      method = request.method;
      return new Response(null, { status: 205 });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    await markAllNotificationsRead();
    expect(method).toBe("PUT");
  });

  test("non-2xx → PlatformError", async () => {
    fixture = startFixture(
      () =>
        new Response(JSON.stringify({ error: { code: "forbidden", message: "no" } }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    );
    setPlatformBaseUrlForTesting(fixture.origin);

    let caught: unknown = null;
    try {
      await markAllNotificationsRead();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PlatformError);
    expect((caught as PlatformError).status).toBe(403);
  });
});
