import { expect, test, type Page } from "@playwright/test";

// Pin the OS preference so the shell boots deterministically.
test.use({ colorScheme: "light" });

// These ids match the e2e gateway fixture (tests/fixtures/gatewayFixture.tsx):
// one workflow that ships a custom UI, executed to a completed run.
const WORKFLOW_KEY = "demo-ui";
const RUN_ID = "demo-ui-run-1";

/** The embedded custom UI lives in an iframe; reach into it same-origin. */
function customUiFrame(page: Page) {
  return page.frameLocator('[data-testid="gateway-workflow-ui-frame"]');
}

/**
 * The custom-workflow-UI feature, end to end against a REAL gateway (no mocks):
 * the app discovers a gateway workflow that ships its own UI, embeds that UI for
 * a run, and lets you switch between it and the native run inspector — the same
 * tree/detail view the app shows for any run.
 */
test.describe("gateway custom workflow UI", () => {
  test("embeds the custom UI by default and toggles to the native inspector", async ({
    page,
  }) => {
    // Deep-link straight to the gateway run inspector.
    await page.goto(`/gw/${WORKFLOW_KEY}/${RUN_ID}`);

    const inspector = page.getByTestId("gateway-run-inspector");
    await expect(inspector).toBeVisible();

    // Default view is the workflow's own UI, embedded in an iframe and served by
    // the gateway. Assert the real bundle rendered AND received the run via
    // ?runId= — proof the whole serve+embed+deep-link path works.
    await expect(customUiFrame(page).getByTestId("demo-workflow-ui")).toBeVisible();
    await expect(customUiFrame(page).getByTestId("demo-run-id")).toHaveText(RUN_ID);

    // Switch to the native inspector — "our current ui": the real node tree the
    // gateway built from the run's execution frames (plan → build → ship).
    await page.getByTestId("gateway-view-inspector").click();
    await expect(page.getByTestId("tree-row-plan")).toBeVisible();
    await expect(page.getByTestId("tree-row-build")).toBeVisible();
    await expect(page.getByTestId("tree-row-ship")).toBeVisible();
    // The embedded UI is gone while the native view is active.
    await expect(page.getByTestId("gateway-workflow-ui")).toHaveCount(0);

    // Selecting a node loads its real output over the gateway.
    await page.getByTestId("tree-row-ship").click();
    await expect(page.getByTestId("gateway-node-output")).toContainText('"ok": true');

    // Toggle back to the custom UI.
    await page.getByTestId("gateway-view-flow").click();
    await expect(customUiFrame(page).getByTestId("demo-workflow-ui")).toBeVisible();
  });

  test("lists live gateway workflows in the store and opens a run", async ({
    page,
  }) => {
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "Message Smithers" });
    await input.fill("store");
    await input.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Workflow Store" }),
    ).toBeVisible();

    // The store surfaces gateway workflows that ship a UI, with their runs.
    await expect(page.getByTestId(`gateway-wf-${WORKFLOW_KEY}`)).toBeVisible();
    const open = page.getByTestId(`gateway-open-${RUN_ID}`);
    await expect(open).toBeVisible();
    await open.click();

    // Opening a run lands on the gateway inspector with its custom UI embedded.
    await expect(page.getByTestId("gateway-run-inspector")).toBeVisible();
    await expect(customUiFrame(page).getByTestId("demo-workflow-ui")).toBeVisible();
  });
});
