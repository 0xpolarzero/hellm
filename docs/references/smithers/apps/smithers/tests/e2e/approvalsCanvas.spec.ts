import { expect, test } from "@playwright/test";
import { SEEDED_DECISIONS, SEEDED_GATES } from "../../src/approvals/approvals";

/**
 * The `/approvals` surface. Two tabs (Pending / History) over a queue rail +
 * detail pane. The store is seeded with both pending gates and prior decisions,
 * so this spec asserts on the seeded counts rather than the empty state.
 */
test.describe("approvals canvas", () => {
  test("deep-link to /approvals renders the seeded pending queue", async ({
    page,
  }) => {
    await page.goto("/approvals");
    await expect(page.getByTestId("approvals-canvas")).toBeVisible();
    await expect(page.locator(".surface-sub").first()).toHaveText(
      `${SEEDED_GATES.length} pending · ${SEEDED_DECISIONS.length} decided`,
    );
    await expect(page.getByTestId("approvals-pending-row")).toHaveCount(
      SEEDED_GATES.length,
    );
  });

  test("tabs switch between Pending and History without errors", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.goto("/approvals");
    const tabs = page.getByTestId("approvals-tabs");
    await tabs.getByRole("button", { name: "History" }).click();
    await expect(tabs.locator(".is-on")).toHaveText("History");
    await expect(page.getByTestId("approvals-history-row")).toHaveCount(
      SEEDED_DECISIONS.length,
    );

    await tabs.getByRole("button", { name: "Pending" }).click();
    await expect(tabs.locator(".is-on")).toHaveText("Pending");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("clicking a pending row opens the detail with metadata + actions", async ({
    page,
  }) => {
    await page.goto("/approvals");
    const row = page.getByTestId("approvals-pending-row").first();
    await row.click();

    const detail = page.getByTestId("approvals-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".state-badge")).toHaveText("PENDING");
    await expect(page.getByTestId("approvals-approve")).toBeVisible();
    await expect(page.getByTestId("approvals-deny")).toBeVisible();
  });

  test("Deny opens a confirm strip; Cancel restores the action buttons", async ({
    page,
  }) => {
    await page.goto("/approvals");
    await page.getByTestId("approvals-pending-row").first().click();
    await page.getByTestId("approvals-deny").click();

    const confirm = page.getByTestId("approvals-deny-confirm");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("approvals-deny-confirm")).toHaveCount(0);
  });
});
