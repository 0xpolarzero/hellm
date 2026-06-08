import { afterEach, describe, expect, test } from "bun:test";
import {
  createIssue,
  listAllIssues,
  listIssues,
  listUserIssues,
  updateIssue,
} from "./issues";
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

const ISSUE_42 = {
  id: 420,
  number: 42,
  title: "Card overflows",
  body: "narrow column",
  state: "open",
  html_url: "https://jjhub.example/acme/widgets/issues/42",
  labels: [
    { name: "bug", color: "ff0000" },
    { name: "ui", color: "0099ff" },
  ],
  assignees: [{ id: 1, username: "will", avatar_url: "https://cdn/avatar/1" }],
  user: { id: 1, username: "will", avatar_url: "https://cdn/avatar/1" },
  comments: 3,
  created_at: "2026-05-01T10:00:00Z",
  updated_at: "2026-05-02T10:00:00Z",
  closed_at: null,
};

const ISSUE_43_CLOSED = {
  ...ISSUE_42,
  id: 430,
  number: 43,
  title: "Closed thing",
  state: "closed",
  closed_at: "2026-05-03T10:00:00Z",
};

let fixture: Server | null = null;

afterEach(() => {
  if (fixture) {
    fixture.stop();
    fixture = null;
  }
  setPlatformBaseUrlForTesting("");
});

describe("listIssues", () => {
  test("path-encodes owner/repo, forwards filters, parses Link cursor", async () => {
    let seenPath = "";
    let seenSearch = "";
    fixture = startFixture((request) => {
      const url = new URL(request.url);
      seenPath = url.pathname;
      seenSearch = url.search;
      return new Response(JSON.stringify([ISSUE_42]), {
        headers: {
          "content-type": "application/json",
          link: '</api/repos/acme/widgets/issues?cursor=p2&limit=30>; rel="next"',
        },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const page = await listIssues("ac me", "widgets", {
      state: "open",
      labels: ["bug", "ui"],
      limit: 30,
      sort: "updated",
      direction: "desc",
    });
    expect(seenPath).toBe("/api/repos/ac%20me/widgets/issues");
    expect(seenSearch).toContain("limit=30");
    expect(seenSearch).toContain("state=open");
    expect(seenSearch).toContain("labels=bug%2Cui");
    expect(page.nextCursor).toBe("p2");
    expect(page.issues[0]?.title).toBe("Card overflows");
    expect(page.issues[0]?.labels.map((l) => l.name)).toEqual(["bug", "ui"]);
    expect(page.issues[0]?.assignees[0]?.username).toBe("will");
    expect(page.issues[0]?.commentCount).toBe(3);
  });

  test("closed-state issue parses correctly", async () => {
    fixture = startFixture(
      () =>
        new Response(JSON.stringify([ISSUE_43_CLOSED]), {
          headers: { "content-type": "application/json" },
        }),
    );
    setPlatformBaseUrlForTesting(fixture.origin);

    const page = await listIssues("acme", "widgets");
    expect(page.issues[0]?.state).toBe("closed");
    expect(page.issues[0]?.closedAt).toBe("2026-05-03T10:00:00Z");
  });

  test("503 response → PlatformError with default code", async () => {
    fixture = startFixture(() => new Response("upstream down", { status: 503 }));
    setPlatformBaseUrlForTesting(fixture.origin);

    let caught: unknown = null;
    try {
      await listIssues("acme", "widgets");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PlatformError);
    expect((caught as PlatformError).status).toBe(503);
  });
});

describe("listAllIssues", () => {
  test("walks pages and stops at the last", async () => {
    let pageRequest = 0;
    fixture = startFixture((request) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      pageRequest += 1;
      if (cursor === "next-page") {
        return new Response(JSON.stringify([ISSUE_43_CLOSED]), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify([ISSUE_42]), {
        headers: {
          "content-type": "application/json",
          link: '</api/repos/acme/widgets/issues?cursor=next-page>; rel="next"',
        },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const all = await listAllIssues("acme", "widgets");
    expect(pageRequest).toBe(2);
    expect(all.map((i) => i.number)).toEqual([42, 43]);
  });
});

describe("listUserIssues", () => {
  test("hits /api/user/issues", async () => {
    let seenPath = "";
    fixture = startFixture((request) => {
      seenPath = new URL(request.url).pathname;
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    await listUserIssues();
    expect(seenPath).toBe("/api/user/issues");
  });
});

describe("createIssue", () => {
  test("POSTs json body, parses returned issue", async () => {
    let receivedBody = "";
    fixture = startFixture(async (request) => {
      expect(request.method).toBe("POST");
      expect(request.headers.get("content-type")).toContain("application/json");
      receivedBody = await request.text();
      return new Response(JSON.stringify(ISSUE_42), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const issue = await createIssue("acme", "widgets", { title: "hi", body: "there" });
    expect(JSON.parse(receivedBody)).toEqual({ title: "hi", body: "there" });
    expect(issue.number).toBe(42);
  });

  test("400 response with wire error → PlatformError", async () => {
    fixture = startFixture(
      () =>
        new Response(
          JSON.stringify({ error: { code: "title_required", message: "Need a title" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    );
    setPlatformBaseUrlForTesting(fixture.origin);

    let caught: unknown = null;
    try {
      await createIssue("acme", "widgets", { title: "" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PlatformError);
    expect((caught as PlatformError).code).toBe("title_required");
  });
});

describe("updateIssue", () => {
  test("PATCHes the issue path with the patch body", async () => {
    let method = "";
    let receivedBody = "";
    fixture = startFixture(async (request) => {
      method = request.method;
      receivedBody = await request.text();
      return new Response(JSON.stringify({ ...ISSUE_42, state: "closed" }), {
        headers: { "content-type": "application/json" },
      });
    });
    setPlatformBaseUrlForTesting(fixture.origin);

    const issue = await updateIssue("acme", "widgets", 42, { state: "closed" });
    expect(method).toBe("PATCH");
    expect(JSON.parse(receivedBody)).toEqual({ state: "closed" });
    expect(issue.state).toBe("closed");
  });
});
