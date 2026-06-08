import { expect, test, type Page } from "@playwright/test";

// Pin the OS preference so the shell boots deterministically.
test.use({ colorScheme: "light" });

// These ids match the e2e gateway fixture (tests/fixtures/gatewayFixture.tsx):
// a second workflow that ships a REACT custom UI built on `gateway-react`.
const WORKFLOW_KEY = "demo-react-ui";
const RUN_ID = "demo-react-ui-run-1";

/** The embedded custom UI lives in an iframe; reach into it same-origin. */
function customUiFrame(page: Page) {
  return page.frameLocator('[data-testid="gateway-workflow-ui-frame"]');
}

/**
 * End-to-end coverage for a `gateway-react` workflow UI against a REAL gateway
 * (no mocks). Companion to `gatewayUi.spec.ts`, which covers the zero-dep
 * vanilla bundle. The two together assert that the two shipping shapes a
 * custom UI ever takes — vanilla SDK and React hooks — both bundle, serve,
 * embed, deep-link, and read live data.
 *
 * What this proves:
 *   1. The React bundle parses and renders inside the iframe.
 *   2. `?runId=` flows through `createGatewayReactRoot` to a hook-driven tree.
 *   3. `useGatewayRun` reads live run state over real RPC and surfaces the
 *      run's `status` ("finished") after the fixture executed it to
 *      completion — proof the React SDK reaches the same gateway path the
 *      vanilla bundle does.
 *   4. `useGatewayNodeOutput` reads a finished task's output row and renders
 *      it as JSON, proving the node-output read works through the iframe
 *      boundary.
 */
test.describe("gateway-react custom workflow UI", () => {
  test("embeds the React bundle and reads live run + node output", async ({
    page,
  }) => {
    // Deep-link straight to the gateway run inspector for the React workflow.
    await page.goto(`/gw/${WORKFLOW_KEY}/${RUN_ID}`);

    const inspector = page.getByTestId("gateway-run-inspector");
    await expect(inspector).toBeVisible();

    // Default view is the workflow's own UI, embedded in an iframe and served
    // by the gateway. Assert the real React bundle rendered AND received the
    // run via ?runId= — proof the whole serve+embed+deep-link path works for
    // the React shipping shape.
    const root = customUiFrame(page).getByTestId("demo-react-workflow-ui");
    await expect(root).toBeVisible();
    await expect(
      customUiFrame(page).getByTestId("demo-react-run-id"),
    ).toHaveText(RUN_ID);

    // `useGatewayRun` reaches the real gateway and surfaces the live status.
    // The fixture executes the run to completion before binding the port, so
    // the status should be "finished" (or "completed" — both are terminal).
    const status = customUiFrame(page).getByTestId("demo-react-run-status");
    await expect(status).toHaveText(/finished|completed/);

    // `useGatewayNodeOutput` reads the "ship" task's output row across the
    // iframe boundary and surfaces the JSON-serialized payload. The fixture
    // ships `{ ok: true }` from the ship task.
    const shipOutput = customUiFrame(page).getByTestId("demo-react-ship-output");
    await expect(shipOutput).toContainText('"ok": true');
  });

  test("toggles to the native inspector and back without losing the run", async ({
    page,
  }) => {
    await page.goto(`/gw/${WORKFLOW_KEY}/${RUN_ID}`);
    await expect(
      customUiFrame(page).getByTestId("demo-react-workflow-ui"),
    ).toBeVisible();

    // Flip to the native inspector — the same tree the app shows for any run.
    await page.getByTestId("gateway-view-inspector").click();
    await expect(page.getByTestId("tree-row-plan")).toBeVisible();
    await expect(page.getByTestId("tree-row-build")).toBeVisible();
    await expect(page.getByTestId("tree-row-ship")).toBeVisible();
    // The embedded React UI is unmounted while the native view is active.
    await expect(page.getByTestId("gateway-workflow-ui")).toHaveCount(0);

    // Toggle back to the custom UI — the React bundle remounts fresh.
    await page.getByTestId("gateway-view-flow").click();
    await expect(
      customUiFrame(page).getByTestId("demo-react-workflow-ui"),
    ).toBeVisible();
    await expect(
      customUiFrame(page).getByTestId("demo-react-run-id"),
    ).toHaveText(RUN_ID);
  });
});
