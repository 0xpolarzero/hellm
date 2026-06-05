/** @jsxImportSource smithers-orchestrator */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createSmithers, Gateway } from "smithers-orchestrator";
import { z } from "zod";
import { seedRunStore } from "./seedRunStore";
import {
  LIVE_APPROVAL_RUN,
  LIVE_APPROVAL_RUN_IDS,
  LIVE_CANCEL_RUN,
  LIVE_MULTIFRAME_RUN,
  LIVE_PROGRESSING_RUN,
  LIVE_RESUMABLE_RUN,
  LIVE_UI_RUN,
} from "./seededData";

/**
 * Boots a REAL Smithers Gateway (no mocking) for the studio-2 e2e suite.
 *
 * It registers two workflows (each on its OWN SQLite DB so runs never duplicate
 * across adapters), then:
 *   1. SEEDS the inert run rows ({@link seedRunStore}) the list/filter specs
 *      read over the real `listRuns` RPC, and
 *   2. EXECUTES the `studio-approval` workflow with fixed run ids so the
 *      run-detail specs have runs with a REAL populated DevTools tree and a
 *      REAL pending approval gate — the gateway builds node trees from
 *      execution frames, which DB rows alone never produce — plus an
 *      actively-running `studio-long` run for the cancel spec.
 *
 * The Gateway runs under Bun (the orchestrator's SQLite layer uses
 * `bun:sqlite`); vite proxies `/v1/rpc` to this process so the browser reaches
 * it same-origin.
 *
 * Env:
 *   SMITHERS_STUDIO_GATEWAY_PORT — port to listen on (required in CI; default 7400).
 */

const tempDir = mkdtempSync(join(tmpdir(), "studio2-gateway-"));
const dbPath = join(tempDir, "runs.db");
const longDbPath = join(tempDir, "long.db");
const uiDbPath = join(tempDir, "ui.db");
const multiframeDbPath = join(tempDir, "multiframe.db");
const progressingDbPath = join(tempDir, "progressing.db");
const resumableDbPath = join(tempDir, "resumable.db");
const workflowUiEntry = fileURLToPath(new URL("./workflowUiEntry.ts", import.meta.url));

const { smithers, Workflow, Task, Approval, outputs } = createSmithers(
  {
    plan: z.object({ summary: z.string() }),
    approval: z.object({ approved: z.boolean() }),
  },
  { dbPath },
);

const long = createSmithers({ done: z.object({ ok: z.boolean() }) }, { dbPath: longDbPath });

// A workflow that ships its own custom UI. Registered with a Gateway-served UI
// (`workflowUiEntry.ts`) and executed once so the Runs surface defaults its run
// into the embedded workflow UI. Owns its own DB for the same reason as
// `studio-long`: one run per adapter, no `listRuns` duplication.
const ui = createSmithers({ done: z.object({ ok: z.boolean() }) }, { dbPath: uiDbPath });

// ROUND-2 fixtures, each on its OWN DB (one run per adapter, no listRuns dupes):
//   - multiframe: several sequential tasks that all settle, committing >1 frame
//     so the Rewind/time-travel button renders (frameCount > 1).
//   - progressing: tasks separated by a short delay, so the run stays Running
//     while its committed frameNo advances — live-run progression.
//   - resumable: a multi-task run that finishes to a terminal state, so the
//     toolbar shows Resume and the real resumeRun RPC can be driven against it.
const multiframe = createSmithers(
  { step: z.object({ index: z.number() }) },
  { dbPath: multiframeDbPath },
);
const progressing = createSmithers(
  { step: z.object({ index: z.number() }) },
  { dbPath: progressingDbPath },
);
const resumable = createSmithers(
  { step: z.object({ index: z.number() }) },
  { dbPath: resumableDbPath },
);

// The approval workflow. It is EXECUTED to a real pending approval gate so the
// run-detail flows have a real tree + gate. Its node ids + approval
// title/summary match {@link LIVE_APPROVAL_RUN} so the specs assert on stable
// values. It owns its own DB (`dbPath`), which also holds the DB-seeded runs —
// its adapter returns ALL runs in that DB.
const approvalWorkflow = smithers(() => (
  <Workflow name={LIVE_APPROVAL_RUN.workflowKey}>
    <Task id={LIVE_APPROVAL_RUN.planNodeId} output={outputs.plan}>
      {LIVE_APPROVAL_RUN.planOutput}
    </Task>
    <Approval
      id={LIVE_APPROVAL_RUN.approvalNodeId}
      output={outputs.approval}
      request={{
        title: LIVE_APPROVAL_RUN.approvalTitle,
        summary: LIVE_APPROVAL_RUN.approvalSummary,
      }}
    />
  </Workflow>
));

// The long-running workflow for the cancel spec: a task that never settles on
// its own, so the run stays in the gateway's active set and the real cancelRun
// RPC genuinely cancels it. It runs on its OWN DB so its run never duplicates
// the approval-DB runs across `listRuns` adapters (the gateway lists runs once
// per registered adapter; two workflows on ONE DB would surface every run
// twice, two workflows on SEPARATE DBs keep each run in exactly one adapter).
const longWorkflow = long.smithers(() => (
  <long.Workflow name={LIVE_CANCEL_RUN.workflowKey}>
    <long.Task id={LIVE_CANCEL_RUN.taskNodeId} output={long.outputs.done}>
      {async () => {
        await new Promise((resolve) => setTimeout(resolve, 600_000));
        return { ok: true };
      }}
    </long.Task>
  </long.Workflow>
));

// The UI-bearing workflow: a single task that settles immediately, so the run
// completes and the Runs surface still defaults it into the workflow UI.
const uiWorkflow = ui.smithers(() => (
  <ui.Workflow name={LIVE_UI_RUN.workflowKey}>
    <ui.Task id={LIVE_UI_RUN.taskNodeId} output={ui.outputs.done}>
      {async () => ({ ok: true })}
    </ui.Task>
  </ui.Workflow>
));

// ROUND-2: the multi-frame workflow. Three sequential tasks that each settle
// immediately, so the orchestrator commits a frame per task — the run finishes
// with frameNo > 1, which is what makes the Runs Rewind button render.
const multiframeWorkflow = multiframe.smithers(() => (
  <multiframe.Workflow name={LIVE_MULTIFRAME_RUN.workflowKey}>
    {LIVE_MULTIFRAME_RUN.taskNodeIds.map((nodeId, index) => (
      <multiframe.Task key={nodeId} id={nodeId} output={multiframe.outputs.step}>
        {async () => ({ index })}
      </multiframe.Task>
    ))}
  </multiframe.Workflow>
));

// ROUND-2: the progressing workflow. The first tasks settle quickly (committing
// several frames so frameNo > 1), then the run PARKS on a task that sleeps ~10
// minutes — so the run stays Running (toolbar shows Cancel) while already
// carrying a multi-frame tree. A phase-2 spec can assert the Running state and
// the committed frames without racing the run to completion.
const progressingWorkflow = progressing.smithers(() => (
  <progressing.Workflow name={LIVE_PROGRESSING_RUN.workflowKey}>
    {LIVE_PROGRESSING_RUN.taskNodeIds.map((nodeId, index) => (
      <progressing.Task key={nodeId} id={nodeId} output={progressing.outputs.step}>
        {async () => {
          if (nodeId === LIVE_PROGRESSING_RUN.parkNodeId) {
            await new Promise((resolve) => setTimeout(resolve, 600_000));
          }
          return { index };
        }}
      </progressing.Task>
    ))}
  </progressing.Workflow>
));

// ROUND-2: the resumable workflow. A multi-task run that finishes to a terminal
// state, so the toolbar offers Resume and the real resumeRun RPC has a target.
const resumableWorkflow = resumable.smithers(() => (
  <resumable.Workflow name={LIVE_RESUMABLE_RUN.workflowKey}>
    {LIVE_RESUMABLE_RUN.taskNodeIds.map((nodeId, index) => (
      <resumable.Task key={nodeId} id={nodeId} output={resumable.outputs.step}>
        {async () => ({ index })}
      </resumable.Task>
    ))}
  </resumable.Workflow>
));

// Seed AFTER createSmithers so we control the rows the Gateway will read.
seedRunStore(dbPath);

const gateway = new Gateway({ heartbeatMs: 250 });
gateway.register(LIVE_APPROVAL_RUN.workflowKey, approvalWorkflow);
gateway.register(LIVE_CANCEL_RUN.workflowKey, longWorkflow);
gateway.register(LIVE_UI_RUN.workflowKey, uiWorkflow, { ui: { entry: workflowUiEntry } });
gateway.register(LIVE_MULTIFRAME_RUN.workflowKey, multiframeWorkflow);
gateway.register(LIVE_PROGRESSING_RUN.workflowKey, progressingWorkflow);
gateway.register(LIVE_RESUMABLE_RUN.workflowKey, resumableWorkflow);

const auth = { triggeredBy: "fixture", scopes: ["*"], role: "operator", tokenId: null };

// Execute the approval workflow for each approval run id, plus the long-running
// workflow for the cancel run. Then wait — BEFORE binding the HTTP listener —
// until ALL approval gates are genuinely pending. Because Playwright treats the
// gateway as ready when `/health` responds, gating before `listen()` guarantees
// no spec runs until the real trees + gates exist (no race). Per-mutation runs
// keep the approve/deny specs isolated so one spec's mutation never clears
// another's gate.
for (const runId of LIVE_APPROVAL_RUN_IDS) {
  await gateway.startRun(LIVE_APPROVAL_RUN.workflowKey, {}, auth, runId, { resume: false });
}
await gateway.startRun(LIVE_CANCEL_RUN.workflowKey, {}, auth, LIVE_CANCEL_RUN.runId, { resume: false });
await gateway.startRun(LIVE_UI_RUN.workflowKey, {}, auth, LIVE_UI_RUN.runId, { resume: false });

// ROUND-2 runs. The multi-frame + resumable runs must reach a terminal state
// BEFORE listen() so their snapshots carry the committed frames (frameNo > 1)
// and the Resume action is available the moment a spec selects them. The
// progressing run is started but deliberately NOT awaited to completion: its
// per-step delays keep it actively Running so a spec can observe its frame
// count climb. Capture each terminal run's inflight promise so we can await it.
await gateway.startRun(LIVE_MULTIFRAME_RUN.workflowKey, {}, auth, LIVE_MULTIFRAME_RUN.runId, { resume: false });
const multiframeDone = gateway.inflightRuns.get(LIVE_MULTIFRAME_RUN.runId);
await gateway.startRun(LIVE_RESUMABLE_RUN.workflowKey, {}, auth, LIVE_RESUMABLE_RUN.runId, { resume: false });
const resumableDone = gateway.inflightRuns.get(LIVE_RESUMABLE_RUN.runId);
await gateway.startRun(LIVE_PROGRESSING_RUN.workflowKey, {}, auth, LIVE_PROGRESSING_RUN.runId, { resume: false });

// Await the two terminal runs so their frames are committed before specs run.
await Promise.allSettled([multiframeDone, resumableDone].filter(Boolean));

const pendingRunIds = new Set<string>(LIVE_APPROVAL_RUN_IDS);
let allGatesReady = false;
for (let attempt = 0; attempt < 480; attempt += 1) {
  const approvals = (await gateway.listPendingApprovals()) as Array<{ runId: string; nodeId: string }>;
  const ready = new Set(
    approvals
      .filter((approval) => approval.nodeId === LIVE_APPROVAL_RUN.approvalNodeId)
      .map((approval) => approval.runId),
  );
  if ([...pendingRunIds].every((runId) => ready.has(runId))) {
    allGatesReady = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!allGatesReady) {
  throw new Error("Not all live approval runs reached a pending approval gate.");
}

const port = Number(process.env.SMITHERS_STUDIO_GATEWAY_PORT ?? "7400");
await gateway.listen({ port, host: "127.0.0.1" });
process.stdout.write(
  `studio-2 e2e gateway listening on http://127.0.0.1:${port} ` +
    `(live gates: ${LIVE_APPROVAL_RUN_IDS.join(", ")}; cancel: ${LIVE_CANCEL_RUN.runId}; ` +
    `multiframe: ${LIVE_MULTIFRAME_RUN.runId}; progressing: ${LIVE_PROGRESSING_RUN.runId}; ` +
    `resumable: ${LIVE_RESUMABLE_RUN.runId})\n`,
);

async function shutdown() {
  try {
    await gateway.close();
  } catch {
    // ignore
  }
  rmSync(tempDir, { recursive: true, force: true });
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await new Promise(() => undefined);
