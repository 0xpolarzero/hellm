import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createWorkspaceApiServer } from "./createWorkspaceApiServer";

/**
 * Real backend test: boot the production Workspace API HTTP server
 * (createWorkspaceApiServer) against a TEMP workspace dir + a TEMP/real
 * bun:sqlite DB seeded with known rows, and assert REAL behavior over HTTP.
 *
 * Nothing is mocked. The server resolves its workspace from
 * SMITHERS_STUDIO_WORKSPACE and its DB from SMITHERS_STUDIO_DB_PATH (both set to
 * temp paths here), executes genuine SQL through the real querySmithersDb.mjs
 * subprocess, walks the real filesystem for workflows/logs, and reports real
 * status codes. We never touch the production smithers.db.
 */

const API = "/__smithers_studio/api";

let server: Server;
let baseUrl: string;
let workspaceRoot: string;
let dbPath: string;

const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string): void {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

function seedDatabase(path: string): void {
  const db = new Database(path);
  // The real query layer (queries/querySmithersDb.mjs) reads these exact
  // `_smithers_*` tables for the /memory and /scores endpoints. We create them
  // with the column names the script SELECTs and seed deterministic rows.
  db.run(`CREATE TABLE _smithers_memory_facts (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT,
    schema_sig TEXT,
    created_at_ms INTEGER,
    updated_at_ms INTEGER,
    ttl_ms INTEGER
  )`);
  db.run(
    `INSERT INTO _smithers_memory_facts (namespace, key, value_json, schema_sig, created_at_ms, updated_at_ms, ttl_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["deploy", "owner", JSON.stringify("ada"), "sig1", 1000, 2000, null],
  );
  db.run(
    `INSERT INTO _smithers_memory_facts (namespace, key, value_json, schema_sig, created_at_ms, updated_at_ms, ttl_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["deploy", "window", JSON.stringify("0900-1700"), "sig2", 1500, 3000, null],
  );
  db.run(
    `INSERT INTO _smithers_memory_facts (namespace, key, value_json, schema_sig, created_at_ms, updated_at_ms, ttl_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["review", "policy", JSON.stringify("two-eyes"), "sig3", 500, 4000, null],
  );

  db.run(`CREATE TABLE _smithers_scorers (
    id TEXT,
    run_id TEXT,
    node_id TEXT,
    iteration INTEGER,
    attempt INTEGER,
    scorer_id TEXT,
    scorer_name TEXT,
    source TEXT,
    score REAL,
    reason TEXT,
    meta_json TEXT,
    input_json TEXT,
    output_json TEXT,
    latency_ms INTEGER,
    scored_at_ms INTEGER,
    duration_ms INTEGER
  )`);
  // Two faithfulness scores + one relevancy score for run-build, all real rows
  // the /scores aggregation walks. Mean(0.8, 1.0) = 0.9 for faithfulness.
  const scoreRows: Array<[string, string, number, string]> = [
    ["s1", "scorer-faith", 0.8, "faithfulness"],
    ["s2", "scorer-faith", 1.0, "faithfulness"],
    ["s3", "scorer-rel", 0.6, "relevancy"],
  ];
  for (const [id, scorerId, score, scorerName] of scoreRows) {
    db.run(
      `INSERT INTO _smithers_scorers
        (id, run_id, node_id, iteration, attempt, scorer_id, scorer_name, source, score, reason, meta_json, input_json, output_json, latency_ms, scored_at_ms, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, "run-build-succeeded", "score-node", 0, 0, scorerId, scorerName, "scorer", score, "ok", null, null, null, 12, 5000, 12],
    );
  }

  // A general application table for the SQL Browser arbitrary-query endpoint.
  db.run(`CREATE TABLE runs (id TEXT PRIMARY KEY NOT NULL, workflow_key TEXT, status TEXT)`);
  db.run(`INSERT INTO runs (id, workflow_key, status) VALUES ('run-1', 'deploy', 'finished')`);
  db.run(`INSERT INTO runs (id, workflow_key, status) VALUES ('run-2', 'build', 'failed')`);
  db.run(`INSERT INTO runs (id, workflow_key, status) VALUES ('run-3', 'test', 'running')`);
  db.close();
}

beforeAll(async () => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "studio-be-"));
  const smithersDir = join(workspaceRoot, ".smithers");
  const workflowsDir = join(smithersDir, "workflows");
  const logsDir = join(smithersDir, "logs");
  mkdirSync(workflowsDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  // Real .tsx workflow sources for discovery.
  writeFileSync(join(workflowsDir, "ship.tsx"), "export default function Ship() { return null; }\n");
  writeFileSync(join(workflowsDir, "review.tsx"), "export default function Review() { return null; }\n");

  // Real log file with one error / one warn / one info JSONL line.
  writeFileSync(
    join(logsDir, "run.log"),
    [
      JSON.stringify({ level: "error", message: "boom failed", timestamp: "2026-05-29T10:00:00.000Z" }),
      JSON.stringify({ level: "warn", message: "slow warning", timestamp: "2026-05-29T10:00:01.000Z" }),
      JSON.stringify({ level: "info", message: "all good", timestamp: "2026-05-29T10:00:02.000Z" }),
    ].join("\n") + "\n",
  );

  dbPath = join(workspaceRoot, "smithers.db");
  seedDatabase(dbPath);

  setEnv("SMITHERS_STUDIO_WORKSPACE", workspaceRoot);
  setEnv("SMITHERS_STUDIO_DB_PATH", dbPath);
  // Keep the global app-log probe ($HOME/Library/Logs/...) inside our temp dir
  // so the /logs endpoint cannot read this machine's real Smithers GUI log.
  setEnv("HOME", workspaceRoot);

  server = createWorkspaceApiServer();
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  rmSync(workspaceRoot, { recursive: true, force: true });
});

async function getJson(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

async function postJson(path: string, payload: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

describe("createWorkspaceApiServer (real backend over HTTP)", () => {
  test("GET /health returns ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("GET /__smithers_studio/workspace resolves the temp workspace root", async () => {
    const res = await fetch(`${baseUrl}/__smithers_studio/workspace`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.root).toBe(workspaceRoot);
    expect(body.hasSmithers).toBe(true);
    expect(body.workflowsPath).toBe(join(workspaceRoot, ".smithers", "workflows"));
  });

  test("POST /sql/query executes a real SELECT with WHERE + LIMIT filtering", async () => {
    const { status, body } = await postJson(`${API}/sql/query`, {
      query: "SELECT id, status FROM runs WHERE status = 'finished' ORDER BY id",
    });
    expect(status).toBe(200);
    expect(body.result.columns).toEqual(["id", "status"]);
    expect(body.result.rows).toEqual([["run-1", "finished"]]);
    expect(body.dbPath).toBe(dbPath);
  });

  test("POST /sql/query honors the row LIMIT", async () => {
    const { status, body } = await postJson(`${API}/sql/query`, {
      query: "SELECT id FROM runs ORDER BY id",
      limit: 2,
    });
    expect(status).toBe(200);
    expect(body.result.rows).toEqual([["run-1"], ["run-2"]]);
  });

  test("POST /sql/query rejects a write statement with a real 400 error", async () => {
    const { status, body } = await postJson(`${API}/sql/query`, {
      query: "DELETE FROM runs WHERE id = 'run-1'",
    });
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/SELECT, PRAGMA, and EXPLAIN only/);
    // Verify the write never happened: the row is still there.
    const after = await postJson(`${API}/sql/query`, { query: "SELECT COUNT(*) AS n FROM runs" });
    expect(after.body.result.rows).toEqual([["3"]]);
  });

  test("POST /sql/query rejects DDL (CREATE TABLE) with a real 400 error", async () => {
    const { status, body } = await postJson(`${API}/sql/query`, {
      query: "CREATE TABLE hacked (x INTEGER)",
    });
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/SELECT, PRAGMA, and EXPLAIN only/);
  });

  test("POST /sql/query surfaces the engine's real error for a bad query", async () => {
    const { status, body } = await postJson(`${API}/sql/query`, {
      query: "SELECT * FROM does_not_exist",
    });
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/no such table/i);
  });

  test("POST /sql/query rejects multiple statements", async () => {
    const { status, body } = await postJson(`${API}/sql/query`, {
      query: "SELECT 1; SELECT 2",
    });
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/one SQL statement/);
  });

  test("GET /scores returns real aggregates computed from seeded scorer rows", async () => {
    // A missing ?limit now uses the query script's default (200), so the full
    // seeded set comes back. We pass an explicit limit here to pin the count
    // regardless of how many rows the default would surface.
    const { status, body } = await getJson(`${API}/scores?limit=200`);
    expect(status).toBe(200);
    expect(body.dbPath).toBe(dbPath);
    expect(body.scores).toHaveLength(3);
    const faith = body.aggregates.find((a: any) => a.scorerName === "faithfulness");
    expect(faith).toBeDefined();
    expect(faith.count).toBe(2);
    expect(faith.mean).toBeCloseTo(0.9, 10);
    expect(faith.min).toBeCloseTo(0.8, 10);
    expect(faith.max).toBeCloseTo(1.0, 10);
    const relevancy = body.aggregates.find((a: any) => a.scorerName === "relevancy");
    expect(relevancy.count).toBe(1);
    expect(relevancy.mean).toBeCloseTo(0.6, 10);
  });

  test("GET /scores?runId filters to one run's real rows", async () => {
    const { status, body } = await getJson(`${API}/scores?runId=run-build-succeeded&limit=200`);
    expect(status).toBe(200);
    expect(body.scores.every((s: any) => s.runId === "run-build-succeeded")).toBe(true);
    expect(body.scores).toHaveLength(3);
    const missing = await getJson(`${API}/scores?runId=no-such-run&limit=200`);
    expect(missing.body.scores).toHaveLength(0);
  });

  test("GET /memory reads real seeded facts", async () => {
    const { status, body } = await getJson(`${API}/memory?limit=200`);
    expect(status).toBe(200);
    expect(body.dbPath).toBe(dbPath);
    expect(body.facts).toHaveLength(3);
    const keys = body.facts.map((f: any) => f.key).sort();
    expect(keys).toEqual(["owner", "policy", "window"]);
    const owner = body.facts.find((f: any) => f.key === "owner");
    expect(owner.namespace).toBe("deploy");
    expect(owner.valueJson).toBe(JSON.stringify("ada"));
  });

  test("GET /memory?namespace filters to one namespace's real rows", async () => {
    const { status, body } = await getJson(`${API}/memory?namespace=deploy&limit=200`);
    expect(status).toBe(200);
    expect(body.facts).toHaveLength(2);
    expect(body.facts.every((f: any) => f.namespace === "deploy")).toBe(true);
  });

  test("GET /memory?query does a real substring filter", async () => {
    const { status, body } = await getJson(`${API}/memory?query=policy&limit=200`);
    expect(status).toBe(200);
    expect(body.facts).toHaveLength(1);
    expect(body.facts[0].key).toBe("policy");
  });

  test("GET /memory with no explicit limit returns all facts under the default (real default behavior)", async () => {
    // A missing ?limit is forwarded as `limit:null`. The query script now
    // treats null as "not provided" and applies its default (200) instead of
    // coercing Number(null)=0 down to a single row, so every seeded fact comes
    // back ordered by updated_at_ms DESC.
    const { status, body } = await getJson(`${API}/memory`);
    expect(status).toBe(200);
    expect(body.facts).toHaveLength(3);
    const keys = body.facts.map((f: any) => f.key).sort();
    expect(keys).toEqual(["owner", "policy", "window"]);
    // Most-recently-updated first.
    expect(body.facts[0].key).toBe("policy");
  });

  test("GET /memory honors an explicit ?limit (real row cap)", async () => {
    // An explicit limit still caps the result set: only the single most-recent
    // fact (highest updated_at_ms) comes back.
    const { status, body } = await getJson(`${API}/memory?limit=1`);
    expect(status).toBe(200);
    expect(body.facts).toHaveLength(1);
    expect(body.facts[0].key).toBe("policy");
  });

  test("GET /logs returns the real log rows with correct level counts", async () => {
    const { status, body } = await getJson(`${API}/logs`);
    expect(status).toBe(200);
    expect(body.stats.errorCount).toBe(1);
    expect(body.stats.warningCount).toBe(1);
    const messages = body.entries.map((e: any) => e.message);
    expect(messages).toContain("boom failed");
    expect(messages).toContain("slow warning");
    expect(messages).toContain("all good");
  });

  test("GET /logs?level=error filters to real error rows", async () => {
    const { status, body } = await getJson(`${API}/logs?level=error`);
    expect(status).toBe(200);
    expect(body.entries.length).toBeGreaterThanOrEqual(1);
    expect(body.entries.every((e: any) => e.level === "error")).toBe(true);
    expect(body.entries.some((e: any) => e.message === "boom failed")).toBe(true);
  });

  test("GET /workflows discovers the real .tsx workflow sources", async () => {
    const { status, body } = await getJson(`${API}/workflows`);
    expect(status).toBe(200);
    const keys = body.workflows.map((w: any) => w.workflowKey).sort();
    expect(keys).toEqual(["review", "ship"]);
    const ship = body.workflows.find((w: any) => w.workflowKey === "ship");
    expect(ship.path).toBe(".smithers/workflows/ship.tsx");
  });

  test("GET /sql/tables reports real tables with real row counts", async () => {
    const { status, body } = await getJson(`${API}/sql/tables`);
    expect(status).toBe(200);
    const runs = body.tables.find((t: any) => t.name === "runs");
    expect(runs).toBeDefined();
    expect(runs.rowCount).toBe(3);
    expect(body.tables.some((t: any) => t.name === "_smithers_memory_facts")).toBe(true);
  });

  test("GET /sql/schema returns the real column definitions", async () => {
    const { status, body } = await getJson(`${API}/sql/schema?tableName=runs`);
    expect(status).toBe(200);
    expect(body.schema.tableName).toBe("runs");
    const colNames = body.schema.columns.map((c: any) => c.name);
    expect(colNames).toEqual(["id", "workflow_key", "status"]);
    const id = body.schema.columns.find((c: any) => c.name === "id");
    expect(id.primaryKey).toBe(true);
  });

  test("GET /sql/schema for a missing table returns a real 400 error", async () => {
    const { status, body } = await getJson(`${API}/sql/schema?tableName=ghost`);
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/Table not found/);
  });

  test("unknown API route returns a real 404 (never fabricated data)", async () => {
    const { status, body } = await getJson(`${API}/this-route-does-not-exist`);
    expect(status).toBe(404);
    expect(String(body.error)).toMatch(/Unknown workspace API route/);
  });

  test("path outside the API prefix returns 404", async () => {
    const res = await fetch(`${baseUrl}/not-the-api`);
    expect(res.status).toBe(404);
    expect(String((await res.json()).error)).toMatch(/Unhandled path/);
  });

  test("POST /sql/query with invalid JSON body returns 400", async () => {
    const res = await fetch(`${baseUrl}${API}/sql/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(String((await res.json()).error)).toMatch(/Invalid JSON body/);
  });

  test("POST /runs requires a workflow (real 400, never a synthetic run id)", async () => {
    // The launch route runs the real `smithers up` CLI; an empty workflow is
    // rejected by launchWorkflowRun before any process is spawned.
    const { status, body } = await postJson(`${API}/runs`, { workflow: "   " });
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/workflow is required/);
    expect(body.runId).toBeUndefined();
  });

  test("POST /runs with an unknown workflow returns a real 404 from source resolution", async () => {
    // resolveWorkflowPath walks the real /workflow-sources resolution against
    // the seeded temp workspace. A key with no .tsx on disk is a genuine 404 —
    // the run is never launched and no fake runId is fabricated.
    const { status, body } = await postJson(`${API}/runs`, { workflow: "does-not-exist" });
    expect(status).toBe(404);
    expect(String(body.error)).toMatch(/does-not-exist/);
    expect(body.runId).toBeUndefined();
  });

  test("POST with an oversized body is rejected with 413 (DoS guard), normal body still works", async () => {
    // Memory-exhaustion guard: readJsonBody must abort once the accumulated
    // body exceeds the cap instead of buffering arbitrarily large payloads.
    // Build a JSON body comfortably over the 32MB cap.
    const huge = "x".repeat(40 * 1024 * 1024);
    const res = await fetch(`${baseUrl}${API}/sql/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: huge }),
    });
    expect(res.status).toBe(413);
    expect(String((await res.json()).error)).toMatch(/too large/i);

    // A normal-sized body on the same route still succeeds.
    const ok = await postJson(`${API}/sql/query`, {
      query: "SELECT id FROM runs WHERE id = 'run-1'",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.result.rows).toEqual([["run-1"]]);
  });

  test("POST /chat/message with empty content streams a clear error delta (no agent faked)", async () => {
    // Documented fault path that needs no agent binary: an empty turn surfaces a
    // real `{type:"error"}` ndjson delta rather than fabricating a reply.
    const res = await fetch(`${baseUrl}${API}/chat/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "", content: "   " }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const text = await res.text();
    const deltas = text.trim().split("\n").map((line) => JSON.parse(line));
    expect(deltas.some((d) => d.type === "error" && /content is required/.test(d.message))).toBe(true);
    // No assistant content was fabricated.
    expect(deltas.some((d) => d.type === "delta")).toBe(false);
  });

  test("POST /chat/message surfaces a pre-stream resolution failure as a real non-200 error (not a silently-swallowed empty response)", async () => {
    // Regression guard for the swallowed pre-stream error path: with valid
    // content, resolveChatWorkspaceRoot() runs BEFORE any ndjson bytes are sent.
    // Point the workspace at a fresh dir with no `.smithers` ancestor so that
    // resolution throws a 404. Because headers are not yet sent, the handler's
    // catch must return a proper JSON error with a non-200 status — never a
    // headers-already-sent response with no error delta (which left the user
    // with no reply and no error at all).
    const noSmithersDir = mkdtempSync(join(tmpdir(), "studio-no-smithers-"));
    const previous = process.env.SMITHERS_STUDIO_WORKSPACE;
    process.env.SMITHERS_STUDIO_WORKSPACE = noSmithersDir;
    try {
      const res = await fetch(`${baseUrl}${API}/chat/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "", content: "hello there" }),
      });
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = await res.json();
      expect(String(body.error)).toMatch(/\.smithers not found/);
    } finally {
      if (previous === undefined) {
        delete process.env.SMITHERS_STUDIO_WORKSPACE;
      } else {
        process.env.SMITHERS_STUDIO_WORKSPACE = previous;
      }
      rmSync(noSmithersDir, { recursive: true, force: true });
    }
  });
});
