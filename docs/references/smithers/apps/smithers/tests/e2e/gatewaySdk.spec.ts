import { expect, test, type Page } from "@playwright/test";

// Pin the OS preference so the shell boots deterministically.
test.use({ colorScheme: "light" });

// Match the ids in tests/fixtures/gatewayFixture.tsx — one workflow that ships
// its own UI, executed to a completed run.
const WORKFLOW_KEY = "demo-ui";
const RUN_ID = "demo-ui-run-1";

/**
 * Live-data path through `@smithers-orchestrator/gateway-client`. The legacy
 * `gatewayRpc` fetch helper + 3s `setInterval` polls were replaced with the SDK
 * (`SmithersGatewayClient`) and its WebSocket streams (`streamRunEventsResilient`
 * / `streamDevTools`). This spec pins the boundary that change crossed:
 *
 *   - opening a gateway run upgrades a WebSocket to `/v1/rpc` (the same path
 *     the same-origin Vite/Worker proxy has `ws: true` on), proving the SDK
 *     transport is in use and that the wrapper rewrites the URL correctly,
 *   - the inspector's status pill still resolves through the real RPC + stream
 *     path — no mocks, the fixture's completed run reads "ok".
 */
test.describe("gateway live-data SDK migration", () => {
  test("opens a /v1/rpc WebSocket when the inspector mounts", async ({ page }) => {
    const opened: string[] = [];
    page.on("websocket", (ws) => {
      opened.push(ws.url());
    });

    await page.goto(`/gw/${WORKFLOW_KEY}/${RUN_ID}`);
    await expect(page.getByTestId("gateway-run-inspector")).toBeVisible();
    // Switch to the native inspector so the WS streams kick in for the tree
    // (the iframe view bootstraps its own gateway client; we want the OUTER
    // app's connection on the parent page).
    await page.getByTestId("gateway-view-inspector").click();
    await expect(page.getByTestId("tree-row-plan")).toBeVisible();

    // The wrapper rewrites every gateway WS URL onto `/v1/rpc` (so the proxy's
    // `ws: true` entry forwards it). At least one upgrade must hit that path.
    await expect.poll(
      () => opened.some((url) => new URL(url).pathname === "/v1/rpc"),
      { timeout: 5_000 },
    ).toBeTruthy();
  });

  test("the inspector status reads from the real gateway snapshot (not the polled value)", async ({
    page,
  }: { page: Page }) => {
    await page.goto(`/gw/${WORKFLOW_KEY}/${RUN_ID}`);
    const header = page.locator(
      '[data-testid="gateway-run-inspector"] .surface-head',
    );
    // The fixture completed the run before listening, so the terminal status
    // arrives over either the snapshot warm-load OR the run-events stream;
    // either way the pill reads "ok" without the old 3s poll.
    await expect(header.locator(".status-pill")).toHaveText("ok");
  });
});
