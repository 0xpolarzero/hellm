import { expect, test } from "@playwright/test";
import { SEEDED_CRONS, summarizeCrons } from "../../src/crons/crons";

/**
 * The `/crons` triggers canvas. List of cron triggers on the left, detail with
 * Enable/Disable + Delete on the right. The create form is gated on the
 * validation reducer so a malformed pattern keeps Create disabled.
 */
test.describe("crons canvas", () => {
  test("deep-link to /crons lists every seeded trigger with its pattern", async ({
    page,
  }) => {
    await page.goto("/crons");
    await expect(page.getByTestId("crons-canvas")).toBeVisible();

    const summary = summarizeCrons(SEEDED_CRONS);
    await expect(page.locator(".surface-sub").first()).toHaveText(
      `${summary.enabled} enabled · ${summary.disabled} disabled · ${summary.total} total`,
    );
    await expect(page.getByTestId("crons-row")).toHaveCount(SEEDED_CRONS.length);
  });

  test("Toggle flips a trigger's enabled badge in place", async ({ page }) => {
    await page.goto("/crons");

    // Pick the first enabled trigger so Toggle has somewhere to flip from.
    const enabledSeed = SEEDED_CRONS.find((cron) => cron.enabled)!;
    await page
      .getByTestId("crons-row")
      .filter({ hasText: enabledSeed.name })
      .first()
      .click();

    const detail = page.locator(".rev-detail");
    await expect(detail.locator(".state-badge")).toHaveText("ENABLED");

    await page.getByTestId("crons-toggle").click();
    await expect(detail.locator(".state-badge")).toHaveText("DISABLED");
    await expect(page.getByTestId("crons-toggle")).toHaveText("Enable");
  });

  test("Delete asks for confirmation and removes the trigger on confirm", async ({
    page,
  }) => {
    await page.goto("/crons");

    const target = SEEDED_CRONS[SEEDED_CRONS.length - 1];
    await page
      .getByTestId("crons-row")
      .filter({ hasText: target.name })
      .first()
      .click();

    await page.getByTestId("crons-delete").click();
    await expect(page.getByTestId("crons-confirm")).toBeVisible();
    await page.getByTestId("crons-confirm-delete").click();

    await expect(
      page.getByTestId("crons-row").filter({ hasText: target.name }),
    ).toHaveCount(0);
    await expect(page.getByTestId("crons-row")).toHaveCount(SEEDED_CRONS.length - 1);
  });

  test("Create form validates pattern + path and Create stays disabled until valid", async ({
    page,
  }) => {
    await page.goto("/crons");

    await page.getByTestId("crons-new-toggle").click();
    const submit = page.getByTestId("crons-create-submit");

    // Both fields empty → required-field warning, button disabled.
    await expect(page.getByTestId("crons-validation")).toBeVisible();
    await expect(submit).toBeDisabled();

    // A bogus pattern flips the validator from "required" warning to "error".
    await page.getByTestId("crons-create-pattern").fill("not-a-cron");
    await page
      .getByTestId("crons-create-path")
      .fill(".smithers/workflows/x.tsx");
    await expect(page.getByTestId("crons-validation")).toHaveClass(/is-error/);
    await expect(submit).toBeDisabled();

    // A valid 5-field pattern enables Create.
    await page.getByTestId("crons-create-pattern").fill("*/5 * * * *");
    await expect(page.getByTestId("crons-validation")).toHaveCount(0);
    await expect(submit).toBeEnabled();
  });
});
