/** @jsxImportSource smithers-orchestrator */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createSmithers, Gateway } from "smithers-orchestrator";
import { z } from "zod";

/**
 * Boots a REAL Smithers gateway (no mocking) for the apps/smithers custom-UI
 * e2e. It registers TWO workflows that each ship their own custom UI — the
 * zero-dep vanilla bundle (`demoWorkflowUi.ts`) and the React bundle
 * (`demoReactWorkflowUi.tsx`) — and EXECUTES each to completion with a fixed
 * run id, so each run has a real, populated DevTools tree (plan → build →
 * ship) that the native "Inspector" view renders, while the "Workflow UI"
 * view embeds the gateway-served bundle.
 *
 * The gateway runs under Bun (its SQLite layer uses `bun:sqlite`); vite proxies
 * `/v1/rpc`, `/health`, and `/workflows` to this process so the browser reaches
 * it same-origin. Binding the HTTP listener AFTER the runs complete guarantees
 * no spec races the runs' trees (Playwright treats the gateway as ready when
 * `/health` answers).
 *
 * Env: SMITHERS_GATEWAY_PORT — port to listen on (default 5278).
 */

const WORKFLOW_KEY = "demo-ui";
const RUN_ID = "demo-ui-run-1";
const REACT_WORKFLOW_KEY = "demo-react-ui";
const REACT_RUN_ID = "demo-react-ui-run-1";

const tempDir = mkdtempSync(join(tmpdir(), "smithers-gw-e2e-"));
const dbPath = join(tempDir, "runs.db");
const uiEntry = fileURLToPath(new URL("./demoWorkflowUi.ts", import.meta.url));
const reactUiEntry = fileURLToPath(
  new URL("./demoReactWorkflowUi.tsx", import.meta.url),
);

const { smithers, Workflow, Task, outputs } = createSmithers(
  { done: z.object({ ok: z.boolean() }) },
  { dbPath },
);

// Three sequential tasks, each settling immediately, so the orchestrator commits
// a frame per task and the snapshot tree carries plan → build → ship.
const demoWorkflow = smithers(() => (
  <Workflow name={WORKFLOW_KEY}>
    <Task id="plan" output={outputs.done}>
      {async () => ({ ok: true })}
    </Task>
    <Task id="build" output={outputs.done}>
      {async () => ({ ok: true })}
    </Task>
    <Task id="ship" output={outputs.done}>
      {async () => ({ ok: true })}
    </Task>
  </Workflow>
));

const gateway = new Gateway({ heartbeatMs: 250 });
gateway.register(WORKFLOW_KEY, demoWorkflow, {
  ui: { entry: uiEntry, title: "Demo Workflow UI" },
});
// The second registration mounts the React bundle at `/workflows/demo-react-ui`
// so the same gateway serves both shipping shapes — vanilla and React.
gateway.register(REACT_WORKFLOW_KEY, demoWorkflow, {
  ui: { entry: reactUiEntry, title: "Demo React Workflow UI" },
});

const auth = { triggeredBy: "fixture", scopes: ["*"], role: "operator", tokenId: null };
await gateway.startRun(WORKFLOW_KEY, {}, auth, RUN_ID, { resume: false });
await gateway.startRun(REACT_WORKFLOW_KEY, {}, auth, REACT_RUN_ID, { resume: false });
// startRun resolves at kickoff; the inflight promise resolves at completion, so
// awaiting each commits every frame before any spec can select the run.
await gateway.inflightRuns.get(RUN_ID);
await gateway.inflightRuns.get(REACT_RUN_ID);

const port = Number(process.env.SMITHERS_GATEWAY_PORT ?? "5278");
await gateway.listen({ port, host: "127.0.0.1" });
process.stdout.write(
  `smithers e2e gateway listening on http://127.0.0.1:${port} (runs ${RUN_ID}, ${REACT_RUN_ID})\n`,
);

async function shutdown(): Promise<void> {
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
