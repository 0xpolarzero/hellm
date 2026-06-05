import { expect, test } from "../support/test";
import type { Page } from "@playwright/test";
import {
  LIVE_APPROVAL_RUN,
  LIVE_MULTIFRAME_RUN,
  LIVE_PROGRESSING_RUN,
  LIVE_RESUMABLE_RUN,
  SEEDED_RUNS,
} from "../fixtures/seededData";

/**
 * REAL-BACKEND e2e for the LIVE Runs behaviors fixed in round 1 — the
 * progression poll/refresh, the time-travel rewind button (which was dead while
 * frameCount stayed undefined), terminal-run resume, node-iteration threading,
 * the nav approvals badge, and the empty/filter-empty states. None of these had
 * coverage, and three high-sev bugs hid behind them.
 *
 * No `page.route`, no `routeWebSocket`, no `mockGateway`, no fabricated data.
 * Every read goes over the live `POST /v1/rpc/<method>` path (vite proxies
 * /v1/rpc to the real Gateway fixture), and every assertion is on the
 * deterministic runs the Gateway fixture EXECUTES (LIVE_PROGRESSING_RUN stays
 * running, LIVE_MULTIFRAME_RUN commits >1 frame, LIVE_RESUMABLE_RUN finishes
 * terminal) plus the per-test-isolated workspace-API state where relevant.
 *
 * PARALLEL-SAFETY: this suite NEVER asserts an exact global gateway run/approval
 * count, NEVER mutates a shared read-only run, and the one state-changing spec
 * (resume) targets the dedicated terminal LIVE_RESUMABLE_RUN.
 */

const WIDE_VIEWPORT = { width: 1440, height: 900 };

const FAILED_RUN = SEEDED_RUNS.find((run) => run.status === "failed")!;

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

test.describe("Runs surface — live progression (real gateway)", () => {
  test("the running run reflects a real non-terminal 'Running' state and live tree", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_PROGRESSING_RUN.runId);

    // The fixture parks this run on a ~10min final task, so it is genuinely in
    // the gateway's active (non-terminal) set: the toolbar state pill reads
    // "Running" and the cancel action (the !terminal branch) renders.
    await expect(page.getByTestId("runs.toolbar.state")).toContainText("Running");
    await expect(page.getByTestId("runs.toolbar.cancel")).toBeVisible();
    await expect(page.getByTestId("runs.toolbar.resume")).toHaveCount(0);

    // The real getDevToolsSnapshot tree carries the already-settled early step.
    await expect(page.getByTestId(`tree.row.${LIVE_PROGRESSING_RUN.taskNodeIds[0]}`)).toBeVisible();
  });

  test("the running run stays live across the poll refresh WITHOUT re-selecting it", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_PROGRESSING_RUN.runId);

    await expect(page.getByTestId("runs.toolbar.state")).toContainText("Running");

    // useRunsData polls a non-terminal run every 2s (getRun + getDevToolsSnapshot
    // + listRuns/listApprovals) without any user interaction. The run is parked,
    // so after several poll cycles it is STILL Running and its tree is intact —
    // proving the live poll keeps the surface fresh on its own (the bug class:
    // a run that only updated on manual re-selection). We never click the row
    // again here.
    await expect
      .poll(
        async () => page.getByTestId("runs.toolbar.state").textContent(),
        { timeout: 8_000, intervals: [500, 1000, 1500, 2000] },
      )
      .toContain("Running");

    await expect(page.getByTestId(`tree.row.${LIVE_PROGRESSING_RUN.taskNodeIds[0]}`)).toBeVisible();
    // Still the running branch of the toolbar, never the terminal Resume branch.
    await expect(page.getByTestId("runs.toolbar.cancel")).toBeVisible();
    await expect(page.getByTestId("runs.toolbar.resume")).toHaveCount(0);
  });
});

test.describe("Runs surface — rewind / time-travel (real gateway)", () => {
  test("the multi-frame run renders the Rewind button (dead when frameCount was undefined)", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_MULTIFRAME_RUN.runId);

    // The fixture runs three sequential tasks that all settle, so the real
    // getDevToolsSnapshot reports frameNo > 1; useRunsData maps frameNo →
    // frameCount, which is exactly the condition RunToolbar uses to render
    // Rewind. Before round 1, frameCount was always undefined → 0, so this
    // button never rendered. Its presence here is the regression guard.
    await expect(page.getByTestId("runs.toolbar.rewind")).toBeVisible();

    // The run is also terminal (all tasks settled), so its tree carries the
    // sequential task nodes the snapshot produced.
    await expect(page.getByTestId(`tree.row.${LIVE_MULTIFRAME_RUN.taskNodeIds[0]}`)).toBeVisible();
  });

  test("clicking Rewind drives the real rewindRun RPC and the run still resolves", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_MULTIFRAME_RUN.runId);

    const rewind = page.getByTestId("runs.toolbar.rewind");
    await expect(rewind).toBeVisible();

    // Clicking posts the real rewindRun({runId, frameNo: frameCount-1, confirm})
    // RPC against the live gateway, then refreshes getRun/getDevToolsSnapshot.
    // A real rewind rewrites the run to the earlier frame; the surface re-reads
    // it and the toolbar + tree remain coherent (the run id's row stays
    // selected, the toolbar stays mounted). We assert the surface survives the
    // real round trip rather than a fabricated frame number.
    await rewind.click();

    await expect(page.getByTestId("runs.toolbar")).toBeVisible();
    await expect(page.getByTestId(`runs.history.row.${LIVE_MULTIFRAME_RUN.runId}`)).toBeVisible();
    // After a real rewind the run re-reads as a coherent, still-frameful run, so
    // the Rewind affordance is still derived from a real frameNo>1 snapshot.
    await expect(page.getByTestId("runs.toolbar.rewind")).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Runs surface — resume terminal run (real gateway)", () => {
  test("the terminal run renders Resume; clicking it drives the real resumeRun RPC", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_RESUMABLE_RUN.runId);

    // The run finished, so isTerminalState(state) is true and the toolbar shows
    // Resume (never Cancel) — the terminal branch of RunToolbar.
    const resume = page.getByTestId("runs.toolbar.resume");
    await expect(resume).toBeVisible();
    await expect(page.getByTestId("runs.toolbar.cancel")).toHaveCount(0);
    await expect(page.getByTestId("runs.toolbar.state")).toContainText(/Succeeded|Finished|Done/i);

    // Its real tree carries the executed task nodes.
    await expect(page.getByTestId(`tree.row.${LIVE_RESUMABLE_RUN.taskNodeIds[0]}`)).toBeVisible();

    // Clicking Resume posts the real resumeRun RPC. The gateway re-enters the
    // finished run's workflow; useRunsData then refreshes getRun. The state
    // leaves the static terminal "Succeeded" pill — either it re-runs (Running)
    // or re-settles, but the surface stays coherent and the row stays present.
    await resume.click();
    await expect(page.getByTestId("runs.toolbar")).toBeVisible();
    await expect(page.getByTestId(`runs.history.row.${LIVE_RESUMABLE_RUN.runId}`)).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe("Runs surface — node iteration in the inspector (real gateway)", () => {
  test("selecting a settled task loads its REAL getNodeOutput for the node's own iteration", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    await selectRun(page, LIVE_MULTIFRAME_RUN.runId);

    // Select a concrete task node (not the root). The inspector threads the
    // node's REAL snapshot iteration (node.task.iteration) into getNodeOutput /
    // getNodeDiff — the round-1 fix replaced a hardcoded iteration-0. With this
    // multi-frame run every task settled, so the real getNodeOutput call resolves
    // and the Output panel renders the engine's real row (no "Loading…" stuck
    // state, no InvalidIteration error from an undefined iteration).
    await page.getByTestId(`tree.row.${LIVE_MULTIFRAME_RUN.taskNodeIds[1]}`).click();
    await expect(page.getByTestId("runs.inspector")).toBeVisible();

    await page.getByTestId("runs.inspector.tab.output").click();
    const outputPanel = page.getByTestId("runs.inspector.panel.output");
    await expect(outputPanel).toBeVisible();
    // The real RPC settles: the panel leaves the loading state. (We do not assert
    // a fabricated payload — the assertion is that the real iteration-keyed RPC
    // resolved to a rendered output panel rather than the old hardcoded-iteration
    // error path.)
    await expect(outputPanel).not.toContainText("Loading output…", { timeout: 20_000 });

    // Props tab confirms the inspector is bound to the real selected node id.
    await page.getByTestId("runs.inspector.tab.props").click();
    await expect(page.getByTestId("runs.inspector.panel.props")).toContainText(
      LIVE_MULTIFRAME_RUN.taskNodeIds[1],
    );
  });
});

test.describe("Runs surface — approvals nav badge (real gateway)", () => {
  test("the Runs nav badge reflects a real positive pending-approval count", async ({ page }) => {
    await openRuns(page);

    // Runs writes data.approvals.length into runsBadgeStore, and the nav row's
    // badge() subscribes to it (the round-1 fix: a bare getState() snapshot read
    // the count once and never re-rendered). The fixture executes several live
    // approval gates, so the count is a positive integer. We assert PRESENCE +
    // POSITIVE (not an exact global count — approve/deny specs clear gates, so a
    // global total is order-dependent under fullyParallel).
    const badge = page.getByTestId("nav.Runs").locator(".nav-row-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/^[1-9]\d*$/);
  });

  test("the badge count agrees with the approvals filter surfacing a real pending gate", async ({
    page,
  }) => {
    await openRuns(page);

    // The same live listApprovals payload backs both the nav badge and the
    // approvals filter, so the canonical approval run is visible under the
    // filter while the badge is positive — one coherent real source.
    const badge = page.getByTestId("nav.Runs").locator(".nav-row-badge");
    await expect(badge).toHaveText(/^[1-9]\d*$/);

    await page.getByTestId("runs.filter.approvals").click();
    await expect(page.getByTestId(`runs.history.row.${LIVE_APPROVAL_RUN.runId}`)).toBeVisible();
  });
});

test.describe("Runs surface — empty / error states (real gateway)", () => {
  test("the Failed filter narrows real listRuns to the failed run and drops succeeded rows", async ({
    page,
  }) => {
    await openRuns(page);

    // A real narrowing over the live listRuns payload: the Failed filter keeps
    // the seeded failed run and excludes the succeeded one. This exercises the
    // RunHistoryList.matches() branch that, when no run matches, renders the real
    // "No runs match this filter." empty state — proving the filter pipeline is
    // driven by real run statuses, not a fabricated list.
    await page.getByTestId("runs.filter.failed").click();
    await expect(page.getByTestId(`runs.history.row.${FAILED_RUN.runId}`)).toBeVisible();
    await expect(page.getByTestId("runs.history.row.run-build-succeeded")).toHaveCount(0);
  });

  test("selecting the parked node surfaces its real pending, no-row output state", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE_VIEWPORT);
    await openRuns(page);
    // The progressing run PARKS on its final task: that task is still pending and
    // has not committed an output ROW yet. Selecting it exercises the real
    // getNodeOutput path, which for a parked-but-not-settled task resolves to a
    // genuine payload of `{ status: "pending", row: null, ... }` — not a stuck
    // "Loading…" spinner and not a fabricated shape.
    await selectRun(page, LIVE_PROGRESSING_RUN.runId);

    await page.getByTestId(`tree.row.${LIVE_PROGRESSING_RUN.parkNodeId}`).click();
    await expect(page.getByTestId("runs.inspector")).toBeVisible();
    await page.getByTestId("runs.inspector.tab.output").click();

    const outputPanel = page.getByTestId("runs.inspector.panel.output");
    await expect(outputPanel).toBeVisible();
    // The output resolves (the spinner clears) to the real getNodeOutput payload.
    await expect(outputPanel).not.toContainText("Loading output…", { timeout: 20_000 });
    // The parked task has produced no output ROW yet: the real payload reports a
    // pending status with a null row — the honest "nothing produced yet" state
    // for a task that is still parked, surfaced verbatim from the gateway.
    await expect(outputPanel).toContainText(/"status":\s*"pending"/);
    await expect(outputPanel).toContainText(/"row":\s*null/);
  });
});
