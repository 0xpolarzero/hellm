import { expect, test } from "@playwright/test";
import { SEEDED_ACCOUNTS, summarizeAccounts } from "../../src/agents/agents";

/**
 * The `/agents` registry canvas. List rail (filter seg + provider groups) on
 * the left, account detail on the right. Mutations (registering, removing,
 * testing) run through agentsStore and echo through the chat/toast stack.
 */
test.describe("agents canvas", () => {
  test("deep-link to /agents lists seeded accounts under the default Available filter", async ({
    page,
  }) => {
    await page.goto("/agents");
    await expect(page.getByTestId("agents-canvas")).toBeVisible();

    const summary = summarizeAccounts(SEEDED_ACCOUNTS);
    await expect(page.locator(".surface-sub").first()).toHaveText(
      `${summary.available} available · ${summary.unavailable} not detected`,
    );

    // The default filter is "available" — switching to "All" exposes the full roster.
    await expect(page.getByTestId("agents-row")).toHaveCount(summary.available);
    await page
      .getByTestId("agents-filter")
      .getByRole("button", { name: "All" })
      .click();
    await expect(page.getByTestId("agents-row")).toHaveCount(SEEDED_ACCOUNTS.length);
  });

  test("filter seg narrows the list and Refresh keeps the seed", async ({
    page,
  }) => {
    await page.goto("/agents");

    const filter = page.getByTestId("agents-filter");
    await filter.getByRole("button", { name: "Available" }).click();
    const available = SEEDED_ACCOUNTS.filter((account) => account.usable).length;
    await expect(page.getByTestId("agents-row")).toHaveCount(available);

    await filter.getByRole("button", { name: "Not detected" }).click();
    const unavailable = SEEDED_ACCOUNTS.length - available;
    await expect(page.getByTestId("agents-row")).toHaveCount(unavailable);

    await filter.getByRole("button", { name: "All" }).click();
    await expect(page.getByTestId("agents-row")).toHaveCount(SEEDED_ACCOUNTS.length);

    await page.getByTestId("agents-refresh").click();
    await expect(page.getByTestId("agents-row")).toHaveCount(SEEDED_ACCOUNTS.length);
  });

  test("selecting an account opens its detail pane with provider metadata", async ({
    page,
  }) => {
    await page.goto("/agents");
    // The default filter excludes unavailable rows; pick the first row that the
    // canvas renders so the seed never needs to stay in sync with the filter.
    const target = SEEDED_ACCOUNTS.find((account) => account.usable)!;
    await page
      .getByTestId("agents-row")
      .filter({ hasText: target.label })
      .first()
      .click();

    const detail = page.getByTestId("agents-detail");
    await expect(detail.locator(".rev-detail-title")).toHaveText(target.label);
    // The metadata grid surfaces auth + apikey flags via the seed.
    await expect(detail).toContainText("Auth");
    await expect(detail).toContainText("API Key");
  });

  test("Register drawer opens, validates required fields, and re-closes", async ({
    page,
  }) => {
    await page.goto("/agents");

    await page.getByRole("button", { name: "Register agent" }).click();
    const drawer = page.getByTestId("agents-register");
    await expect(drawer).toBeVisible();

    // No provider yet → Register stays disabled.
    const submit = page.getByTestId("agents-register-submit");
    await expect(submit).toBeDisabled();

    // Cancel returns to the seeded list intact (under the default Available filter).
    await drawer.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("agents-register")).toHaveCount(0);
    await expect(page.getByTestId("agents-row")).toHaveCount(
      summarizeAccounts(SEEDED_ACCOUNTS).available,
    );
  });
});
