import { expect, test } from "@playwright/test";

/**
 * The auth surface. The corner AuthStatus chip reflects the live /api/user
 * check from the auth fixture, and /login is a real page with provider buttons
 * + a token fallback. Behavior-level only — no real OAuth round-trip.
 */
test.describe("auth chip", () => {
  test("renders the signed-in auth chip from the fixture at boot", async ({
    page,
  }) => {
    await page.goto("/");
    const chip = page.getByTestId("auth-status");
    await expect(chip).toBeVisible();
    await expect(chip.locator(".auth-name")).toHaveText("Fixture User");
    await expect(
      chip.getByRole("button", { name: /Sign out/ }),
    ).toBeVisible();
  });
});

test.describe("login page", () => {
  test("deep-link to /login renders the panel with a token form fallback", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Sign in to Smithers" }),
    ).toBeVisible();
    // Token fallback is always present, regardless of provider strategy.
    await expect(page.locator("#login-token")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Connect/ }),
    ).toBeVisible();
  });

  test("Connect stays disabled until a token is typed", async ({ page }) => {
    await page.goto("/login");
    const connect = page.getByRole("button", { name: /Connect/ });
    await expect(connect).toBeDisabled();

    await page.locator("#login-token").fill("smithers_test_token");
    await expect(connect).toBeEnabled();
  });

  test("a bogus token surfaces an inline error without crashing", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.goto("/login");
    await page.locator("#login-token").fill("smithers_definitely_not_valid");
    await page.getByRole("button", { name: /Connect/ }).click();

    // The fixture rejects this token with 401, and the login store reads
    // "Invalid token." into the inline error band.
    await expect(page.locator(".login-error")).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
