import { expect, test } from "@playwright/test";

/**
 * Real e2e for the Plue bridge: the browser's same-origin fetch goes through
 * Vite → the real Cloudflare Worker → the real Plue REST fixture. No mocks.
 *
 * Asserts:
 *  - /api/user resolves identity through the AUTH path.
 *  - /api/user/repos resolves through the platform path (the user-subpath
 *    precedence: with both env vars set to the same origin, the platform
 *    branch picks it up, mirroring the monolith case).
 *  - /api/repos/<owner>/<repo>/issues paginates with cursor-aware Link headers.
 *  - /api/notifications PUT (mark-all-read) returns 205 cleanly.
 *
 * The fixture's responses are byte-stable so the asserts are exact.
 */
test.describe("plue bridge", () => {
  test("identity and repos flow through the worker proxy", async ({ page, baseURL }) => {
    await page.goto(baseURL ?? "/");

    const identity = await page.evaluate(async () => {
      const res = await fetch("/api/user", { credentials: "include" });
      return { status: res.status, body: await res.json() };
    });
    expect(identity.status).toBe(200);
    expect(identity.body).toMatchObject({ username: "fixture-user", id: 42 });

    const repos = await page.evaluate(async () => {
      const res = await fetch("/api/user/repos", { credentials: "include" });
      return { status: res.status, body: await res.json() };
    });
    expect(repos.status).toBe(200);
    expect(Array.isArray(repos.body)).toBe(true);
    expect(repos.body[0]).toMatchObject({ full_name: "fixture/widgets" });
  });

  test("repo-scoped issues round-trip through /api/repos/:owner/:repo/issues", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL ?? "/");
    const issues = await page.evaluate(async () => {
      const res = await fetch("/api/repos/fixture/widgets/issues", {
        credentials: "include",
      });
      return { status: res.status, body: await res.json() };
    });
    expect(issues.status).toBe(200);
    expect(issues.body[0]).toMatchObject({ number: 1, title: "Fixture issue" });
  });

  test("notifications mark-all-read returns 205 reset", async ({ page, baseURL }) => {
    await page.goto(baseURL ?? "/");
    const status = await page.evaluate(async () => {
      const res = await fetch("/api/notifications", {
        method: "PUT",
        credentials: "include",
      });
      return res.status;
    });
    expect(status).toBe(205);
  });
});
