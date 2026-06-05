import { expect, test } from "../support/test";
import type { Page } from "@playwright/test";
import {
  LIVE_APPROVAL_RUN,
  LIVE_CANCEL_RUN,
  LIVE_MUTABLE_RUN_IDS,
  LIVE_UI_RUN,
  SEEDED_RUNS,
} from "../fixtures/seededData";

/**
 * REAL-BACKEND Runs surface e2e. No `page.route`, no `mockGateway`. Every read
 * goes over the live `POST /v1/rpc/<method>` path (vite proxies /v1/rpc to the
 * Gateway fixture), and every assertion is on the deterministic runs/approvals
 * the Gateway fixture produces.
 *
 * Two kinds of run back this suite:
 *   - DB-SEEDED runs (running / succeeded / failed) inserted as inert rows, for
 *     the history list + filter coverage.
 *   - LIVE runs the fixture EXECUTES (the canonical {@link LIVE_APPROVAL_RUN}
 *     plus one isolated run per mutating spec). These have a REAL populated
 *     DevTools tree (driven into the Runs tree via getDevToolsSnapshot) and a
 *     REAL pending approval gate — so the tree / inspector / inline-approval /
 *     cancel / narrow-sheet flows are exercised against genuine backend data,
 *     not a fabricated getRun.tree.
 */

const SUCCEEDED_RUN = SEEDED_RUNS.find((run) => run.status === "finished")!;
const FAILED_RUN = SEEDED_RUNS.find((run) => run.status === "failed")!;

/**
 * The WIDE/NARROW breakpoint (800px) measures the tree|inspector layout
 * container. A 1440px window leaves the layout comfortably above 800px; a 600px
 * window forces the narrow modal-sheet layout.
 */
const WIDE_VIEWPORT = { width: 1440, height: 900 };
const NARROW_VIEWPORT = { width: 600, height: 900 };

async function openRuns(page: Page) {
  await page.goto("/");
  await page.getByTestId("nav.Runs").click();
  await expect(page.getByTestId("view.runs")).toBeVisible();
}

/** Select a run from the history rail and wait for its toolbar to render. */
async function selectRun(page: Page, runId: string) {
  await page.getByTestId(`runs.history.row.${runId}`).click();
  await expect(page.getByTestId("runs.toolbar")).toBeVisible();
}

test.describe("Runs surface — history + filters (real gateway)", () => {
  test("history lists every seeded run from real /v1/rpc/listRuns", async ({ page }) => {
    await openRuns(page);

    for (const run of SEEDED_RUNS) {
      await expect(page.getByTestId(`runs.history.row.${run.runId}`)).toBeVisible();
    }
  });

  test("failed filter narrows to the seeded failed run only", async ({ page }) => {
    await openRuns(page);

    await expect(page.getByTestId(`runs.history.row.${FAILED_RUN.runId}`)).toBeVisible();
    await page.getByTestId("runs.filter.failed").click();
    await expect(page.getByTestId(`runs.history.row.${FAILED_RUN.runId}`)).toBeVisible();
    await expect(page.getByTestId(`runs.history.row.${SUCCEEDED_RUN.runId}`)).toHaveCount(0);
  });

  test("approvals filter surfaces the live approval run with a pending gate", async ({ page }) => {
    await openRuns(page);

    await page.getByTestId("runs.filter.approvals").click();
    await expect(page.getByTestId(`runs.history.row.${LIVE_APPROVAL_RUN.runId}`)).toBeVisible();
    await expect(page.getByTestId(`runs.history.row.${FAILED_RUN.runId}`)).toHaveCount(0);
  });

  test("approvals filter carries a positive pending-gate count from real listApprovals", async ({ page }) => {
    await openRuns(page);

    // The badge counts distinct runs with a pending gate; the fixture executes
    // several live approval runs, so the count is a positive integer. (An exact
    // value is intentionally not asserted: approve/deny specs clear gates, so a
    // global count is order-dependent — but the badge being present + positive
    // is a real, deterministic signal from the live listApprovals payload.)
    const badge = page.getByTestId("runs.filter.approvals").locator(".runs-history-filter-count");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/^[1-9]\d*$/);
  });
});

test.describe("Runs surface — wide layout (real gateway)", () => {
  test("renders the wide split layout with a draggable divider", async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_APPROVAL_RUN.runId);

    await expect(page.getByTestId("liveRun.layout.wide")).toBeVisible();
    await expect(page.getByTestId("liveRun.layout.divider")).toBeVisible();
  });

  test("dragging the divider persists the inspector fraction", async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_APPROVAL_RUN.runId);

    const divider = page.getByTestId("liveRun.layout.divider");
    const box = await divider.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();

    const stored = await page.evaluate(() => localStorage.getItem("liverun.layout.inspectorFraction"));
    expect(stored).not.toBeNull();
    expect(Number(stored)).toBeGreaterThan(0.46);
  });
});

test.describe("Runs surface — live run detail (real gateway)", () => {
  test("renders the real node tree from getDevToolsSnapshot for the executed run", async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_APPROVAL_RUN.runId);

    // The tree is driven by the REAL getDevToolsSnapshot payload: a workflow
    // root with the plan task + the approval task as children, keyed by their
    // logical node ids.
    await expect(page.getByTestId(`tree.row.${LIVE_APPROVAL_RUN.planNodeId}`)).toBeVisible();
    const approvalRow = page.getByTestId(`tree.row.${LIVE_APPROVAL_RUN.approvalNodeId}`);
    await expect(approvalRow).toBeVisible();
    await expect(approvalRow).toContainText(LIVE_APPROVAL_RUN.approvalTitle);
    // The blocked approval node is rendered in its waiting-approval state.
    await expect(approvalRow).toHaveAttribute("data-state", "waiting-approval");
  });

  test("selecting the plan node shows inspector tabs with real output/props content", async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_APPROVAL_RUN.runId);

    await page.getByTestId(`tree.row.${LIVE_APPROVAL_RUN.planNodeId}`).click();
    await expect(page.getByTestId("runs.inspector")).toBeVisible();

    // Output tab: the real getNodeOutput row for the plan task. The content
    // loads via a real getNodeOutput RPC; allow generous headroom since the
    // shared e2e gateway is under heavy contention from the fully-parallel suite
    // (every viewed live run also opens a real event stream).
    await page.getByTestId("runs.inspector.tab.output").click();
    await expect(page.getByTestId("runs.inspector.panel.output")).toContainText(
      LIVE_APPROVAL_RUN.planOutput.summary,
      { timeout: 15_000 },
    );

    // Diff tab: the plan task changed no files, so the real getNodeDiff bundle
    // has no patches.
    await page.getByTestId("runs.inspector.tab.diff").click();
    await expect(page.getByTestId("runs.inspector.panel.diff")).toContainText("No diff", { timeout: 15_000 });

    // Logs tab renders.
    await page.getByTestId("runs.inspector.tab.logs").click();
    await expect(page.getByTestId("runs.inspector.panel.logs")).toBeVisible();

    // Props tab: the selected node's identity from the real snapshot.
    await page.getByTestId("runs.inspector.tab.props").click();
    await expect(page.getByTestId("runs.inspector.panel.props")).toContainText(
      LIVE_APPROVAL_RUN.planNodeId,
      { timeout: 15_000 },
    );
  });

  test("the inline approval gate appears on the blocked node from real listApprovals", async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_APPROVAL_RUN.runId);

    // This spec is READ-ONLY against the CANONICAL {@link LIVE_APPROVAL_RUN}
    // gate. The mutating approve/deny specs act on their own dedicated runs
    // ({@link LIVE_MUTABLE_RUN_IDS}), so this run's gate is never consumed by a
    // parallel test — the gate is always pending here. The inline gate is driven
    // by the real listApprovals RPC, which can take longer to resolve under full
    // parallel load, so allow a generous timeout for it to surface.
    await page.getByTestId(`tree.row.${LIVE_APPROVAL_RUN.approvalNodeId}`).click();
    const gate = page.getByTestId("runs.approvalGate");
    await expect(gate).toBeVisible({ timeout: 20_000 });
    await expect(gate).toContainText(LIVE_APPROVAL_RUN.approvalTitle);
    await expect(gate).toContainText(LIVE_APPROVAL_RUN.approvalSummary);
    await expect(page.getByTestId("runs.approvalGate.approve")).toBeVisible();
    await expect(page.getByTestId("runs.approvalGate.deny")).toBeVisible();
  });

  test("approving the gate drives real submitApproval and the gate clears", async ({ page }) => {
    const runId = LIVE_MUTABLE_RUN_IDS.approve;
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, runId);

    await page.getByTestId(`tree.row.${LIVE_APPROVAL_RUN.approvalNodeId}`).click();
    await expect(page.getByTestId("runs.approvalGate")).toBeVisible();
    await page.getByTestId("runs.approvalGate.note").fill("ship it");
    await page.getByTestId("runs.approvalGate.approve").click();

    // The real submitApproval resolves the gate; refresh removes it from the
    // pending list, so the inline gate disappears and the run leaves the
    // approvals filter.
    await expect(page.getByTestId("runs.approvalGate")).toHaveCount(0, { timeout: 20_000 });
    await page.getByTestId("runs.filter.approvals").click();
    await expect(page.getByTestId(`runs.history.row.${runId}`)).toHaveCount(0, { timeout: 20_000 });
  });

  test("denying the gate drives real submitApproval and the gate clears", async ({ page }) => {
    const runId = LIVE_MUTABLE_RUN_IDS.deny;
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, runId);

    await page.getByTestId(`tree.row.${LIVE_APPROVAL_RUN.approvalNodeId}`).click();
    await expect(page.getByTestId("runs.approvalGate")).toBeVisible();
    await page.getByTestId("runs.approvalGate.deny").click();

    await expect(page.getByTestId("runs.approvalGate")).toHaveCount(0, { timeout: 20_000 });
    await page.getByTestId("runs.filter.approvals").click();
    await expect(page.getByTestId(`runs.history.row.${runId}`)).toHaveCount(0, { timeout: 20_000 });
  });

  test("cancelling an actively-running live run drives real cancelRun", async ({ page }) => {
    const runId = LIVE_CANCEL_RUN.runId;
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, runId);

    // The run is actively executing a long task, so the toolbar shows Cancel and
    // its real tree carries the long task node.
    await expect(page.getByTestId(`tree.row.${LIVE_CANCEL_RUN.taskNodeId}`)).toBeVisible();
    await expect(page.getByTestId("runs.toolbar.state")).toContainText("Running");

    // Clicking Cancel posts the real cancelRun RPC (which returns "cancelling"
    // and aborts the run). The run then finalizes to a terminal cancelled state
    // in the backend; re-selecting the run re-reads the real getRun until the
    // toolbar reflects it.
    await page.getByTestId("runs.toolbar.cancel").click();
    await expect
      .poll(
        async () => {
          // Re-select the run (via another run) to force a fresh getRun read.
          await page.getByTestId(`runs.history.row.${LIVE_APPROVAL_RUN.runId}`).click();
          await page.getByTestId(`runs.history.row.${runId}`).click();
          return page.getByTestId("runs.toolbar.state").textContent();
        },
        { timeout: 20_000 },
      )
      .not.toContain("Running");
  });

  test("a run whose workflow ships a UI defaults to the embedded workflow UI", async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_UI_RUN.runId);

    // The Gateway-served custom UI is embedded as the default view, scoped to
    // this run via ?runId=. The default tree/inspector layout is NOT rendered.
    await expect(page.getByTestId("runs.workflowUi")).toBeVisible();
    await expect(page.getByTestId("liveRun.layout.wide")).toHaveCount(0);

    // The iframe loads the real bundle the Gateway built from workflowUiEntry.ts
    // (proxied same-origin under /workflows), booted with this run's id.
    const frame = page.frameLocator('[data-testid="runs.workflowUi.frame"]');
    const root = frame.getByTestId("fixtureWorkflowUi.root");
    await expect(root).toBeVisible();
    await expect(root).toHaveAttribute("data-run-id", LIVE_UI_RUN.runId);
    await expect(root).toContainText(LIVE_UI_RUN.workflowKey);
  });

  test("the view toggle switches a workflow-UI run back to the default view and back", async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_UI_RUN.runId);

    await expect(page.getByTestId("runs.workflowUi")).toBeVisible();

    // Switching to Default swaps the iframe for the generic tree/inspector view.
    await page.getByTestId("runs.toolbar.viewToggle.default").click();
    await expect(page.getByTestId("runs.workflowUi")).toHaveCount(0);
    await expect(page.getByTestId("liveRun.layout.wide")).toBeVisible();
    await expect(page.getByTestId(`tree.row.${LIVE_UI_RUN.taskNodeId}`)).toBeVisible();

    // And back to the workflow's own UI.
    await page.getByTestId("runs.toolbar.viewToggle.workflow").click();
    await expect(page.getByTestId("runs.workflowUi")).toBeVisible();
    await expect(page.getByTestId("liveRun.layout.wide")).toHaveCount(0);
  });

  test("a run whose workflow has no UI shows the default view with no toggle", async ({ page }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_APPROVAL_RUN.runId);

    // No custom UI registered for studio-approval: the default layout renders and
    // the workflow/default view toggle is absent entirely.
    await expect(page.getByTestId("liveRun.layout.wide")).toBeVisible();
    await expect(page.getByTestId("runs.workflowUi")).toHaveCount(0);
    await expect(page.getByTestId("runs.toolbar.viewToggle")).toHaveCount(0);
  });

  test("narrow viewport opens the inspector as a modal sheet over a dimmer", async ({ page }) => {
    await page.setViewportSize(NARROW_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_APPROVAL_RUN.runId);

    await expect(page.getByTestId("liveRun.layout.narrow")).toBeVisible();
    // Selecting a node auto-opens the centered modal sheet.
    await page.getByTestId(`tree.row.${LIVE_APPROVAL_RUN.planNodeId}`).click();
    await expect(page.getByTestId("liveRun.layout.inspectorSheet")).toBeVisible();
    await expect(page.getByTestId("liveRun.layout.sheetDimmer")).toBeVisible();
    await expect(page.getByTestId("runs.inspector")).toBeVisible();

    // The dimmer closes the sheet. The centered sheet sits over the dimmer's
    // middle, so click near the dimmer's top-left corner (outside the sheet).
    await page.getByTestId("liveRun.layout.sheetDimmer").click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId("liveRun.layout.inspectorSheet")).toHaveCount(0);
  });
});
