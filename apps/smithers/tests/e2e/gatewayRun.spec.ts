import { expect, test, type Page } from "@playwright/test";

// Pin the OS preference so the shell boots deterministically.
test.use({ colorScheme: "light" });

// These ids match the e2e gateway fixture (tests/fixtures/gatewayFixture.tsx):
// one workflow ("demo-ui") that ships a custom UI, executed to a completed run
// ("demo-ui-run-1"). The workflow registers no readableName, so the gateway's
// listWorkflows returns the key itself as the name.
const WORKFLOW_KEY = "demo-ui";
const RUN_ID = "demo-ui-run-1";

/** The embedded custom UI lives in an iframe; reach into it same-origin. */
function customUiFrame(page: Page) {
  return page.frameLocator('[data-testid="gateway-workflow-ui-frame"]');
}

/**
 * The gateway custom-UI feature from the run side, against a REAL gateway (no
 * mocks). gatewayUi.spec.ts proves the deep-link + native-toggle path; this spec
 * pins what makes the embed real: the iframe is the gateway-SERVED bundle (its
 * own prose + `src` resolving to the proxied `/workflows/<key>` path, not an
 * app-local route), the `?runId=` round-trips through the in-app entry into the
 * bundle's own render, and the inspector header carries live run state pulled
 * over RPC. Selectors stay resilient: the frame/iframe testids, the bundle's own
 * visible text, the surface header classes, and pathname-only URL checks.
 */
test.describe("gateway run inspector", () => {
  test("embeds the gateway-served bundle with the run deep-linked through its src", async ({
    page,
  }) => {
    await page.goto(`/gw/${WORKFLOW_KEY}/${RUN_ID}`);
    await expect(page).toHaveURL(
      (url) => url.pathname === `/gw/${WORKFLOW_KEY}/${RUN_ID}`,
    );

    await expect(page.getByTestId("gateway-run-inspector")).toBeVisible();

    // The iframe targets the gateway's own served bundle: vite proxies
    // `/workflows/*` to the gateway, so the src is that path carrying the run as
    // `?runId=` — proof the embed points at the gateway, not an in-app route.
    const frame = page.getByTestId("gateway-workflow-ui-frame");
    await expect(frame).toHaveAttribute(
      "src",
      `/workflows/${WORKFLOW_KEY}?runId=${RUN_ID}`,
    );

    // The bundle the gateway built + served actually rendered: assert its own
    // prose, which the app never ships, so a passing check means the bytes came
    // over the real serve path.
    const ui = customUiFrame(page);
    await expect(
      ui.getByRole("heading", { name: "Demo Workflow UI" }),
    ).toBeVisible();
    await expect(
      ui.getByText("served by the Smithers gateway"),
    ).toBeVisible();
  });

  test("the run param round-trips through the in-app entry into the bundle", async ({
    page,
  }) => {
    // Open the run the way a user does: the Store's live-workflows list, kept by
    // the real gateway connection, with an "Open →" per run.
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "Message Smithers" });
    await input.fill("store");
    await input.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Workflow Store" }),
    ).toBeVisible();

    const open = page.getByTestId(`gateway-open-${RUN_ID}`);
    await expect(open).toBeVisible();
    await open.click();

    // Lands on the gateway run route…
    await expect(page).toHaveURL(
      (url) => url.pathname === `/gw/${WORKFLOW_KEY}/${RUN_ID}`,
    );

    // …and the run id chosen in-app reaches the embedded bundle, which reads it
    // from its own `location.search` and echoes it back. Same value, no mock.
    await expect(customUiFrame(page).getByTestId("demo-run-id")).toHaveText(
      RUN_ID,
    );
  });

  test("the inspector header carries the live workflow name and run status", async ({
    page,
  }) => {
    await page.goto(`/gw/${WORKFLOW_KEY}/${RUN_ID}`);

    const header = page.locator(
      '[data-testid="gateway-run-inspector"] .surface-head',
    );

    // The title comes from the gateway's listWorkflows. This workflow ships no
    // readableName, so the key stands in as the name.
    await expect(header.locator(".surface-title")).toHaveText(WORKFLOW_KEY);

    // The status pill reflects the run's real state, polled over RPC from the
    // snapshot. The fixture executes the run to completion before listening, so
    // the terminal status reads "ok".
    await expect(header.locator(".status-pill")).toHaveText("ok");
  });
});
