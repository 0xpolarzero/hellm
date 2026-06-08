import { expect, test } from "@playwright/test";

/**
 * Split-config e2e: AUTH and GO target DISTINCT fixture origins. Asserts the
 * Worker actually routes each path to the right upstream — identity routes to
 * AUTH (authFixture, `source: "auth-fixture"`), platform user/repo routes go
 * to GO (plueFixture, `source: "platform-fixture"`).
 *
 * If a future regression collapsed both routes onto one upstream, the `source`
 * field exposes the misroute (the Worker would pick up the wrong fixture's
 * identity body for /api/user, or the wrong /api/user/repos rows).
 */
test.describe("split config: AUTH ≠ GO", () => {
  test("identity (/api/user) comes from the auth fixture", async ({ page, baseURL }) => {
    await page.goto(baseURL ?? "/");
    const identity = await page.evaluate(async () => {
      const res = await fetch("/api/user", { credentials: "include" });
      return { status: res.status, body: await res.json() };
    });
    expect(identity.status).toBe(200);
    expect(identity.body).toMatchObject({
      username: "fixture-user",
      id: 42,
      source: "auth-fixture",
    });
  });

  test("auth-identity sub-route /api/user/keys stays on the auth fixture", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL ?? "/");
    const keys = await page.evaluate(async () => {
      const res = await fetch("/api/user/keys", { credentials: "include" });
      return { status: res.status, body: await res.json() };
    });
    expect(keys.status).toBe(200);
    // authFixture serves { keys: [] }; plueFixture would 404 the path entirely.
    expect(keys.body).toEqual({ keys: [] });
  });

  test("platform sub-route /api/user/repos comes from the platform fixture", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL ?? "/");
    const repos = await page.evaluate(async () => {
      const res = await fetch("/api/user/repos", { credentials: "include" });
      return { status: res.status, body: await res.json() };
    });
    expect(repos.status).toBe(200);
    expect(Array.isArray(repos.body)).toBe(true);
    // plueFixture seeds `fixture/widgets`; authFixture has no such route.
    expect(repos.body[0]).toMatchObject({ full_name: "fixture/widgets" });
  });

  test("platform repo route /api/repos/.../issues comes from the platform fixture", async ({
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
});
