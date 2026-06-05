import { Database } from "bun:sqlite";
import { DB_SEEDED_RUNS } from "./seededData";

/**
 * Seed the Gateway's SQLite run store with the deterministic, inert run rows
 * from {@link ./seededData} ({@link DB_SEEDED_RUNS} — every seeded run except
 * the live approval run, which the gateway fixture EXECUTES so it has a real
 * tree + pending approval). The schema mirrors the real
 * `@smithers-orchestrator/db` table definitions exactly, so the live Gateway's
 * `listRuns` / `getRun` RPCs read these rows verbatim — the UI then renders them
 * over the real `/v1/rpc` path with no mocking.
 *
 * Must run under Bun (uses `bun:sqlite`), like the Gateway fixture itself.
 */
export function seedRunStore(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS _smithers_runs (
        run_id TEXT PRIMARY KEY,
        parent_run_id TEXT,
        workflow_name TEXT NOT NULL,
        workflow_path TEXT,
        workflow_hash TEXT,
        status TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        started_at_ms INTEGER,
        finished_at_ms INTEGER,
        heartbeat_at_ms INTEGER,
        runtime_owner_id TEXT,
        cancel_requested_at_ms INTEGER,
        hijack_requested_at_ms INTEGER,
        hijack_target TEXT,
        vcs_type TEXT,
        vcs_root TEXT,
        vcs_revision TEXT,
        error_json TEXT,
        config_json TEXT
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS _smithers_nodes (
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        iteration INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL,
        last_attempt INTEGER,
        updated_at_ms INTEGER NOT NULL,
        output_table TEXT NOT NULL,
        label TEXT,
        PRIMARY KEY (run_id, node_id, iteration)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS _smithers_approvals (
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        iteration INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        requested_at_ms INTEGER,
        decided_at_ms INTEGER,
        note TEXT,
        decided_by TEXT,
        request_json TEXT,
        decision_json TEXT,
        auto_approved INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, node_id, iteration)
      )
    `);

    const insertRun = db.query(`
      INSERT OR REPLACE INTO _smithers_runs
        (run_id, workflow_name, status, created_at_ms, started_at_ms, finished_at_ms, heartbeat_at_ms, error_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const run of DB_SEEDED_RUNS) {
      insertRun.run(
        run.runId,
        run.workflowName,
        run.status,
        run.createdAtMs,
        run.startedAtMs,
        run.finishedAtMs,
        run.heartbeatAtMs,
        run.errorJson,
      );
    }
    // Nodes + approvals for the live approval run are NOT seeded here — they are
    // produced by executing the workflow in the gateway fixture (a real tree +
    // a real pending gate). The DB-seeded runs intentionally carry no nodes.
  } finally {
    db.close();
  }
}
