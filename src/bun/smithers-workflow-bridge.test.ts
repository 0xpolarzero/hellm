import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  extractSmithersRunId,
  mapSmithersRunStateToWorkflowProjectionInput,
  readSmithersRunState,
  readSmithersWorkflowProjectionInput,
  startSmithersWorkflow,
  type SmithersRunState,
} from "./smithers-workflow-bridge";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("smithers workflow bridge", () => {
  it("extracts real run ids from Smithers output", () => {
    expect(extractSmithersRunId("runId: run-123")).toBe("run-123");
    expect(extractSmithersRunId('\u001b[32m{"runId":"run-456"}\u001b[0m')).toBe("run-456");
    expect(extractSmithersRunId("nothing useful here")).toBeNull();
  });

  it("maps Smithers lifecycle statuses to structured workflow projection statuses", () => {
    const baseRun: SmithersRunState = {
      runId: "run-1",
      workflowName: "implement-feature",
      workflowPath: "definitions/implement-feature.tsx",
      status: "running",
      createdAtMs: 1,
      startedAtMs: 2,
      finishedAtMs: null,
      heartbeatAtMs: null,
      vcsRoot: null,
      vcsRevision: null,
      errorJson: null,
      nodeCounts: {},
    };

    expect(mapSmithersRunStateToWorkflowProjectionInput(baseRun).status).toBe("running");
    expect(
      mapSmithersRunStateToWorkflowProjectionInput({ ...baseRun, status: "waiting-approval" })
        .status,
    ).toBe("waiting");
    expect(
      mapSmithersRunStateToWorkflowProjectionInput({ ...baseRun, status: "waiting-event" }).status,
    ).toBe("waiting");
    expect(
      mapSmithersRunStateToWorkflowProjectionInput({ ...baseRun, status: "waiting-timer" }).status,
    ).toBe("running");
    expect(
      mapSmithersRunStateToWorkflowProjectionInput({ ...baseRun, status: "waiting-approval" })
        .summary,
    ).toBe("implement-feature run run-1 is waiting for approval.");
    expect(
      mapSmithersRunStateToWorkflowProjectionInput({ ...baseRun, status: "waiting-timer" }).summary,
    ).toBe("implement-feature run run-1 is running on a timer wait.");
    expect(
      mapSmithersRunStateToWorkflowProjectionInput({ ...baseRun, status: "finished" }).status,
    ).toBe("completed");
    expect(
      mapSmithersRunStateToWorkflowProjectionInput({ ...baseRun, status: "failed" }).status,
    ).toBe("failed");
    expect(
      mapSmithersRunStateToWorkflowProjectionInput({ ...baseRun, status: "cancelled" }).status,
    ).toBe("cancelled");
  });

  it("reads run state from the Smithers sqlite db and builds a projection summary", () => {
    const { dbPath, db } = createSmithersDbFixture();

    db.query(
      `INSERT INTO _smithers_runs (
         run_id,
         workflow_name,
         workflow_path,
         status,
         created_at_ms,
         started_at_ms,
         finished_at_ms,
         heartbeat_at_ms,
         vcs_root,
         vcs_revision,
         error_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "run-999",
      "implement-feature",
      "definitions/implement-feature.tsx",
      "failed",
      1700000000000,
      1700000001234,
      1700000005678,
      null,
      "/repo",
      "abc123",
      JSON.stringify({ message: "Task(s) failed: merge" }),
    );

    insertNode(db, "run-999", "analyze", "finished");
    insertNode(db, "run-999", "implement", "finished");
    insertNode(db, "run-999", "review", "finished");
    insertNode(db, "run-999", "verify", "finished");
    insertNode(db, "run-999", "merge", "failed");

    db.close();

    const state = readSmithersRunState({ dbPath, runId: "run-999" });
    expect(state).toEqual({
      runId: "run-999",
      workflowName: "implement-feature",
      workflowPath: "definitions/implement-feature.tsx",
      status: "failed",
      createdAtMs: 1700000000000,
      startedAtMs: 1700000001234,
      finishedAtMs: 1700000005678,
      heartbeatAtMs: null,
      vcsRoot: "/repo",
      vcsRevision: "abc123",
      errorJson: JSON.stringify({ message: "Task(s) failed: merge" }),
      nodeCounts: {
        finished: 4,
        failed: 1,
      },
    });

    expect(readSmithersRunState({ dbPath, runId: "missing" })).toBeNull();

    const projection = readSmithersWorkflowProjectionInput({ dbPath, runId: "run-999" });
    expect(projection).toEqual({
      status: "failed",
      summary:
        "implement-feature run run-999 is failed: Task(s) failed: merge; 4 finished, 1 failed.",
    });
  });

  it("starts a real Smithers workflow and reads its real run state from sqlite", async () => {
    const workflowsDir = resolve(import.meta.dir, "..", "..", "workflows");
    const fixtureDir = mkdtempSync(join(workflowsDir, "tmp-smithers-bridge-"));
    tempDirs.push(fixtureDir);

    const dbPath = join(fixtureDir, "smithers.db");
    const workflowPath = join(fixtureDir, "quick-pass.tsx");
    writeFileSync(
      workflowPath,
      [
        "/** @jsxImportSource smithers-orchestrator */",
        'import { Task, Workflow, createSmithers } from "smithers-orchestrator";',
        'import { z } from "zod";',
        `const { smithers, outputs } = createSmithers({ output: z.object({ ok: z.boolean() }) }, { dbPath: ${JSON.stringify(dbPath)} });`,
        "",
        "export default smithers(() => (",
        '  <Workflow name="quick-pass">',
        '    <Task id="done" output={outputs.output}>{ { ok: true } }</Task>',
        "  </Workflow>",
        "));",
        "",
      ].join("\n"),
    );

    const started = await startSmithersWorkflow({
      workflowPath,
      input: {},
      smithersCwd: workflowsDir,
      repoRoot: resolve(workflowsDir, ".."),
      env: {
        ...process.env,
        PATH: "",
      },
    });

    expect(started.runId).toBeTruthy();
    await waitForPath(dbPath);
    expect(existsSync(dbPath)).toBe(true);

    const run = await waitForRunState(dbPath, started.runId);
    expect(run?.status).toBe("finished");

    const projection = readSmithersWorkflowProjectionInput({
      dbPath,
      runId: started.runId,
    });
    expect(projection).toEqual({
      status: "completed",
      summary: `quick-pass run ${started.runId} is finished; 1 finished.`,
    });
  }, 20_000);
});

function createSmithersDbFixture() {
  const root = mkdtempSync(join(tmpdir(), "svvy-smithers-bridge-"));
  tempDirs.push(root);

  const dbPath = join(root, "smithers.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE _smithers_runs (
      run_id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      workflow_path TEXT,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      started_at_ms INTEGER,
      finished_at_ms INTEGER,
      heartbeat_at_ms INTEGER,
      vcs_root TEXT,
      vcs_revision TEXT,
      error_json TEXT
    );

    CREATE TABLE _smithers_nodes (
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      iteration INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL,
      last_attempt INTEGER,
      updated_at_ms INTEGER NOT NULL,
      output_table TEXT NOT NULL,
      label TEXT
    );
  `);

  return { dbPath, db };
}

function insertNode(db: Database, runId: string, nodeId: string, state: string) {
  db.query(
    `INSERT INTO _smithers_nodes (
       run_id,
       node_id,
       iteration,
       state,
       last_attempt,
       updated_at_ms,
       output_table,
       label
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(runId, nodeId, 0, state, 1, Date.now(), "", null);
}

async function waitForRunState(dbPath: string, runId: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readSmithersRunState({ dbPath, runId });
    if (
      state?.status === "finished" ||
      state?.status === "failed" ||
      state?.status === "cancelled"
    ) {
      return state;
    }
    await Bun.sleep(100);
  }

  return readSmithersRunState({ dbPath, runId });
}

async function waitForPath(path: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for ${path}`);
}
