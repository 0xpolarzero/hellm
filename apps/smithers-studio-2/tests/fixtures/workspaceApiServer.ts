import { Database } from "bun:sqlite";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { STUDIO_SESSION_HEADER } from "../support/sessionHeader";
import {
  SEEDED_CHAT_REPLY,
  SEEDED_CHAT_SESSION,
  SEEDED_JJHUB_STATE,
  SEEDED_LOG_ENTRIES,
  SEEDED_MEMORY_FACTS,
  SEEDED_SCORES,
  SEEDED_SQL_DB_PATH,
  SEEDED_SQL_TABLES,
  SEEDED_WORKFLOWS,
  SEEDED_WORKFLOW_SHIP_GRAPH,
  SEEDED_WORKFLOW_SHIP_SOURCE,
} from "./seededData";

/**
 * Serves the Workspace API (`/__smithers_studio/workspace` and
 * `/__smithers_studio/api/*`) that studio-2's `src/workspaceApi.ts` fetches.
 *
 * studio-2 ships no workspace backend, so this fixture provides a real HTTP
 * server backed by the deterministic JJHub / memory / scores state in
 * `./seededData`. It is NOT route mocking: the browser makes real same-origin
 * fetches (vite proxies `/__smithers_studio` here), the real component +
 * workspaceApi code runs, and the assertions are on this server's real
 * responses. State mutates in-process so create/close/review flows behave like
 * a live backend within a test.
 *
 * Runs under Node or Bun. Env: SMITHERS_STUDIO_WORKSPACE_API_PORT (default 7410).
 */

type Issue = (typeof SEEDED_JJHUB_STATE.issues)[number] & { commentCount: number };
type Landing = (typeof SEEDED_JJHUB_STATE.landings)[number];
type CloudWorkspace = (typeof SEEDED_JJHUB_STATE.workspaces)[number];
type Snapshot = (typeof SEEDED_JJHUB_STATE.snapshots)[number];

type MutableState = {
  issues: Issue[];
  landings: Landing[];
  workspaces: CloudWorkspace[];
  snapshots: Snapshot[];
  nextIssueNumber: number;
  nextLandingNumber: number;
  nextWorkspaceId: number;
  nextSnapshotId: number;
  /**
   * Number of upcoming `GET /chat/session` loads the server should answer with a
   * real 503 so the converted chat spec can drive the error state without route
   * mocking. The spec arms this via a real `POST /chat/session-fault`, then
   * loads chat; the server genuinely returns the failure and decrements. It is a
   * count (not a boolean) because React StrictMode mounts the chat twice — both
   * loads must see the fault, or the remount would silently recover. Auto-clears
   * to zero so it never leaks to a sibling test.
   */
  chatSessionFaultRemaining: number;
  /**
   * Launched runs recorded by `POST /runs`. Launching from the Workflows surface
   * is a real same-origin POST to this backend; the server records the workflow
   * key + input and returns a deterministic run id. The converted spec asserts
   * the recorded launch via a real `GET /runs/launched` (a real backend read,
   * not a route mock) so the launch payload is verified end to end.
   */
  launches: Array<{ runId: string; workflow: string; input: Record<string, unknown> }>;
  nextLaunchedRunNumber: number;
};

function freshState(): MutableState {
  return {
    issues: SEEDED_JJHUB_STATE.issues.map((issue) => ({ ...issue })),
    landings: SEEDED_JJHUB_STATE.landings.map((landing) => ({ ...landing })),
    workspaces: SEEDED_JJHUB_STATE.workspaces.map((workspace) => ({ ...workspace })),
    snapshots: SEEDED_JJHUB_STATE.snapshots.map((snapshot) => ({ ...snapshot })),
    nextIssueNumber: 103,
    nextLandingNumber: 203,
    nextWorkspaceId: 10,
    nextSnapshotId: 10,
    chatSessionFaultRemaining: 0,
    launches: [],
    nextLaunchedRunNumber: 1,
  };
}

/**
 * Per-session mutable state. Playwright's support `test` mints a unique
 * `x-studio-session` header per test (see tests/support/test.ts) and applies it
 * to BOTH the browser context and the `request` fixture, so every fetch a test
 * makes — page or API — carries the same key. We hand each key its OWN fresh
 * clone of the seed, so create/close/launch/fault mutations in one test never
 * leak into another and absolute counts ("Loaded 1 issue", issue #103) stay
 * deterministic no matter how many tests run concurrently. A request with no
 * header lands in the single shared default bucket (the `bun dev` case).
 */
const sessions = new Map<string, MutableState>();

function sessionFor(req: IncomingMessage): MutableState {
  const header = req.headers[STUDIO_SESSION_HEADER];
  const key = (Array.isArray(header) ? header[0] : header) || "__default__";
  let existing = sessions.get(key);
  if (!existing) {
    existing = freshState();
    sessions.set(key, existing);
  }
  return existing;
}

/**
 * The REAL SQLite database backing the SQL Browser surface. Each session gets
 * its OWN in-memory database (keyed by the `x-studio-session` header, exactly
 * like the JJHub state), built from SEEDED_SQL_TABLES: every table is created
 * from its real `createSql` and populated with its seeded rows via
 * parameterized inserts. The `/sql/*` handlers then run genuine SQL against the
 * session's own engine — no regex faking, so the SQL Browser is an honest
 * end-to-end exercise of real SQLite.
 *
 * ISOLATION: a per-session database means a query in one test can never corrupt
 * the rows another parallel test reads, even if a write somehow executed.
 *
 * READ-ONLY CONTRACT: the SQL Browser is presented as read-only, so `/sql/query`
 * rejects any statement that is not a pure read (see {@link isReadOnlySql}) with
 * a clear read-only error BEFORE it ever touches the engine. As defense in
 * depth the schema itself is locked after seeding via PRAGMA query_only, so even
 * a statement that slipped past the guard could not mutate the seeded rows.
 */
function buildSeededSqlDb(): Database {
  const db = new Database(":memory:");
  for (const table of SEEDED_SQL_TABLES) {
    db.run(table.createSql);
    if (table.rows.length === 0) continue;
    const columns = Object.keys(table.rows[0]!);
    const placeholders = columns.map(() => "?").join(", ");
    const insert = db.query(
      `INSERT INTO "${table.name}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`,
    );
    for (const row of table.rows) {
      insert.run(...columns.map((column) => (row as Record<string, unknown>)[column] as never));
    }
  }
  // Lock the connection read-only after seeding: any INSERT/UPDATE/DELETE/DDL
  // that reaches the engine now fails with SQLite's real "attempt to write a
  // readonly database" error instead of mutating the seeded rows.
  db.run("PRAGMA query_only = TRUE");
  return db;
}

const sqlDbBySession = new Map<string, Database>();

function sqlDbFor(req: IncomingMessage): Database {
  const header = req.headers[STUDIO_SESSION_HEADER];
  const key = (Array.isArray(header) ? header[0] : header) || "__default__";
  let db = sqlDbBySession.get(key);
  if (!db) {
    db = buildSeededSqlDb();
    sqlDbBySession.set(key, db);
  }
  return db;
}

/**
 * The SQL Browser is read-only, so `/sql/query` only accepts statements that
 * cannot mutate the database: a single SELECT / WITH (CTE) / PRAGMA read /
 * EXPLAIN, with no trailing statement that could smuggle in a write
 * (`SELECT 1; DELETE FROM runs`). Anything else — INSERT / UPDATE / DELETE /
 * DROP / CREATE / ALTER / REPLACE / a multi-statement batch — is rejected before
 * execution with a clear read-only error.
 */
function isReadOnlySql(sql: string): boolean {
  // Strip a single trailing statement separator so `SELECT ...;` is still a
  // single statement, then reject any further `;`-separated statement.
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.length === 0) return false;
  if (trimmed.includes(";")) return false;
  return /^(select|with|pragma|explain)\b/i.test(trimmed);
}

const READ_ONLY_SQL_ERROR =
  "SQL Browser is read-only: only SELECT / WITH / PRAGMA / EXPLAIN queries are allowed.";

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function aggregateScores() {
  const byScorer = new Map<string, number[]>();
  for (const row of SEEDED_SCORES) {
    const list = byScorer.get(row.scorerId) ?? [];
    list.push(row.score);
    byScorer.set(row.scorerId, list);
  }
  return [...byScorer.entries()].map(([scorerId, scores]) => {
    const sorted = [...scores].sort((a, b) => a - b);
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const row = SEEDED_SCORES.find((entry) => entry.scorerId === scorerId)!;
    return {
      scorerId,
      scorerName: row.scorerName,
      count: scores.length,
      mean,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: sorted[Math.floor((sorted.length - 1) / 2)],
      stddev: 0,
      sources: ["llm-judge"],
      firstScoredAtMs: row.scoredAtMs,
      latestScoredAtMs: row.scoredAtMs,
    };
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://studio.local");
  const method = req.method ?? "GET";

  if (url.pathname === "/health") {
    return send(res, 200, { ok: true });
  }

  // Resolve this request's isolated state bucket from its session header.
  const state = sessionFor(req);

  if (url.pathname === "/__smithers_studio/workspace") {
    return send(res, 200, { cwd: "/tmp/studio", root: "/tmp/studio", hasSmithers: true });
  }

  if (!url.pathname.startsWith("/__smithers_studio/api")) {
    return send(res, 404, { error: `Unhandled path ${method} ${url.pathname}` });
  }

  const path = url.pathname.replace("/__smithers_studio/api", "");
  const body = method === "GET" || method === "HEAD" ? {} : await readJsonBody(req);

  if (path === "/auth/status") return send(res, 200, { auth: SEEDED_JJHUB_STATE.auth });

  if (path === "/local-workspaces" && method === "GET") {
    return send(res, 200, { recents: SEEDED_JJHUB_STATE.recents });
  }

  // Workflow discovery (the four Workflows segments).
  if (path === "/workflows" && method === "GET") {
    return send(res, 200, { workflows: SEEDED_WORKFLOWS.local });
  }
  if (path === "/jjhub-workflows" && method === "GET") {
    return send(res, 200, { workflows: SEEDED_WORKFLOWS.remote });
  }
  if (path === "/prompts" && method === "GET") {
    return send(res, 200, { prompts: SEEDED_WORKFLOWS.prompts });
  }
  if (path === "/crons" && method === "GET") {
    return send(res, 200, { crons: SEEDED_WORKFLOWS.crons });
  }

  // Workflow source + launch graph (only the Local "studio-ship" workflow ships
  // a source + declared launch fields; others 404 like the real backend).
  const workflowGraph = path.match(/^\/workflow-sources\/([^/]+)\/graph$/);
  if (workflowGraph) {
    if (decodeURIComponent(workflowGraph[1]) === SEEDED_WORKFLOW_SHIP_GRAPH.workflowKey) {
      return send(res, 200, { graph: SEEDED_WORKFLOW_SHIP_GRAPH });
    }
    return send(res, 404, { error: "workflow graph not found" });
  }
  const workflowSource = path.match(/^\/workflow-sources\/([^/]+)$/);
  if (workflowSource && method === "GET") {
    if (decodeURIComponent(workflowSource[1]) === SEEDED_WORKFLOW_SHIP_SOURCE.workflowKey) {
      return send(res, 200, { workflow: SEEDED_WORKFLOW_SHIP_SOURCE });
    }
    return send(res, 404, { error: "workflow source not found" });
  }

  // Launch a run. A real POST from the Workflows surface; the server records the
  // launch and returns a deterministic run id. The spec verifies the recorded
  // payload via the real GET below.
  if (path === "/runs" && method === "POST") {
    const runId = `studio-run-launched-${state.nextLaunchedRunNumber++}`;
    const workflow = String(body.workflow ?? "");
    const input = (body.input ?? {}) as Record<string, unknown>;
    state.launches.push({ runId, workflow, input });
    return send(res, 200, { runId, workflow });
  }
  if (path === "/runs/launched" && method === "GET") {
    return send(res, 200, { launches: state.launches });
  }

  // Issues
  if (path === "/issues" && method === "GET") {
    const filter = url.searchParams.get("state");
    const issues = filter ? state.issues.filter((issue) => issue.state === filter) : state.issues;
    return send(res, 200, { issues });
  }
  if (path === "/issues" && method === "POST") {
    const issue: Issue = {
      id: `issue-${state.nextIssueNumber}`,
      number: state.nextIssueNumber++,
      title: String(body.title ?? ""),
      body: (body.body as string | null) ?? null,
      state: "open",
      labels: ["created"],
      assignees: [],
      commentCount: 0,
    };
    state.issues.unshift(issue);
    return send(res, 200, { issue });
  }
  const issueClose = path.match(/^\/issues\/(\d+)\/close$/);
  if (issueClose) {
    const issue = state.issues.find((entry) => entry.number === Number(issueClose[1]));
    if (!issue) return send(res, 404, { error: "issue not found" });
    issue.state = "closed";
    return send(res, 200, { issue });
  }
  const issueReopen = path.match(/^\/issues\/(\d+)\/reopen$/);
  if (issueReopen) {
    const issue = state.issues.find((entry) => entry.number === Number(issueReopen[1]));
    if (!issue) return send(res, 404, { error: "issue not found" });
    issue.state = "open";
    return send(res, 200, { issue });
  }
  const issueDetail = path.match(/^\/issues\/(\d+)$/);
  if (issueDetail) {
    const issue = state.issues.find((entry) => entry.number === Number(issueDetail[1]));
    if (!issue) return send(res, 404, { error: "issue not found" });
    return send(res, 200, { issue });
  }

  // Landings
  if (path === "/landings" && method === "GET") {
    const filter = url.searchParams.get("state");
    const landings = filter && filter !== "all"
      ? state.landings.filter((entry) => entry.state === filter)
      : state.landings;
    return send(res, 200, { landings });
  }
  if (path === "/landings" && method === "POST") {
    const landing = {
      id: `landing-${state.nextLandingNumber}`,
      number: state.nextLandingNumber++,
      title: String(body.title ?? ""),
      description: (body.body as string | null) ?? null,
      state: "open",
      targetBranch: (body.target as string) ?? "main",
      author: "playwright",
      createdAt: "2026-05-28T00:00:00.000Z",
      reviewStatus: "pending",
      diff: "diff --git a/created.txt b/created.txt\n--- a/created.txt\n+++ b/created.txt\n@@ -0,0 +1 @@\n+created landing\n",
      checks: "created-check: passing\n",
      conflicts: { conflictStatus: "clean", hasConflicts: false, conflicts: [] },
    } as Landing;
    state.landings.unshift(landing);
    return send(res, 200, { landing });
  }
  const landingSub = path.match(/^\/landings\/(\d+)(?:\/(diff|checks|conflicts|review|land))?$/);
  if (landingSub) {
    const landing = state.landings.find((entry) => entry.number === Number(landingSub[1]));
    if (!landing) return send(res, 404, { error: "landing not found" });
    if (!landingSub[2]) return send(res, 200, { landing });
    if (landingSub[2] === "diff") {
      const diffDelayMs = (landing as { diffDelayMs?: number }).diffDelayMs;
      if (diffDelayMs) await new Promise((resolve) => setTimeout(resolve, diffDelayMs));
      return send(res, 200, { diff: landing.diff });
    }
    if (landingSub[2] === "checks") return send(res, 200, { checks: landing.checks });
    if (landingSub[2] === "conflicts") return send(res, 200, { conflicts: landing.conflicts });
    if (landingSub[2] === "review") {
      const action = String(body.action ?? "");
      landing.reviewStatus = action === "approve" ? "approved" : action === "request_changes" ? "changes_requested" : landing.reviewStatus;
      return send(res, 200, { landing });
    }
    landing.state = "merged";
    landing.reviewStatus = "approved";
    return send(res, 200, { landing });
  }

  // Cloud workspaces
  if (path === "/workspaces" && method === "GET") {
    return send(res, 200, { workspaces: state.workspaces });
  }
  if (path === "/workspaces" && method === "POST") {
    const workspace: CloudWorkspace = {
      id: `ws-${state.nextWorkspaceId++}`,
      name: String(body.name ?? ""),
      status: "active",
      createdAt: "2026-05-28T00:00:00.000Z",
    };
    state.workspaces.unshift(workspace);
    return send(res, 200, { workspace });
  }
  if (path === "/workspaces/snapshots" && method === "GET") {
    return send(res, 200, { snapshots: state.snapshots });
  }
  if (path === "/workspaces/snapshots" && method === "POST") {
    const snapshot: Snapshot = {
      id: `snap-${state.nextSnapshotId++}`,
      workspaceId: String(body.workspaceId ?? ""),
      name: String(body.name ?? ""),
      createdAt: "2026-05-28T00:30:00.000Z",
    };
    state.snapshots.unshift(snapshot);
    return send(res, 200, { snapshot });
  }
  const snapshotDelete = path.match(/^\/workspaces\/snapshots\/([^/]+)$/);
  if (snapshotDelete && method === "DELETE") {
    state.snapshots = state.snapshots.filter((entry) => entry.id !== snapshotDelete[1]);
    return send(res, 200, { ok: true });
  }
  const workspaceAction = path.match(/^\/workspaces\/([^/]+)\/(suspend|resume|fork)$/);
  if (workspaceAction) {
    const workspace = state.workspaces.find((entry) => entry.id === workspaceAction[1]);
    if (!workspace) return send(res, 404, { error: "workspace not found" });
    if (workspaceAction[2] === "suspend") workspace.status = "suspended";
    if (workspaceAction[2] === "resume") workspace.status = "active";
    if (workspaceAction[2] === "fork") {
      const forked: CloudWorkspace = {
        id: `ws-${state.nextWorkspaceId++}`,
        name: String(body.name ?? `${workspace.name}-fork`),
        status: "active",
        createdAt: "2026-05-28T01:00:00.000Z",
      };
      state.workspaces.unshift(forked);
      return send(res, 200, { workspace: forked });
    }
    return send(res, 200, { ok: true });
  }
  const workspaceDelete = path.match(/^\/workspaces\/([^/]+)$/);
  if (workspaceDelete && method === "DELETE") {
    state.workspaces = state.workspaces.filter((entry) => entry.id !== workspaceDelete[1]);
    return send(res, 200, { ok: true });
  }
  if (workspaceDelete && method === "GET") {
    const workspace = state.workspaces.find((entry) => entry.id === workspaceDelete[1]);
    if (!workspace) return send(res, 404, { error: "workspace not found" });
    return send(res, 200, { workspace });
  }

  // Memory
  if (path === "/memory" && method === "GET") {
    const namespace = url.searchParams.get("namespace");
    const query = url.searchParams.get("query");
    let facts = SEEDED_MEMORY_FACTS.filter((fact) => !namespace || fact.namespace === namespace);
    if (query) {
      facts = facts.filter((fact) => fact.valueJson.includes(query) || fact.key.includes(query));
    }
    return send(res, 200, { facts, dbPath: "/tmp/studio/.smithers/smithers.db" });
  }
  if (path === "/memory/recall") {
    const query = url.searchParams.get("query") ?? "";
    const results = SEEDED_MEMORY_FACTS
      .filter((fact) => fact.valueJson.includes(query) || query.length === 0)
      .map((fact) => ({ score: 0.9, content: fact.valueJson, metadata: fact.namespace }));
    return send(res, 200, { results, dbPath: "/tmp/studio/.smithers/smithers.db" });
  }

  // Scores
  if (path === "/scores") {
    const runId = url.searchParams.get("runId");
    const scores = runId ? SEEDED_SCORES.filter((row) => row.runId === runId) : SEEDED_SCORES;
    const runs = [...new Set(SEEDED_SCORES.map((row) => row.runId))].map((id) => ({
      runId: id,
      count: SEEDED_SCORES.filter((row) => row.runId === id).length,
      latestScoredAtMs: Math.max(...SEEDED_SCORES.filter((row) => row.runId === id).map((row) => row.scoredAtMs)),
    }));
    return send(res, 200, {
      scores,
      aggregates: aggregateScores(),
      runs,
      tokenMetrics: { totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, byPeriod: [] },
      latencyMetrics: { count: 0, meanMs: 0, minMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, byPeriod: [] },
      costReport: { totalCostUSD: 0, inputCostUSD: 0, outputCostUSD: 0, runCount: 0, byPeriod: [] },
      dbPath: "/tmp/studio/.smithers/smithers.db",
    });
  }

  // Agent chat (deterministic, no live LLM). Serves a seeded session and
  // replays a fixed assistant turn as ndjson deltas so the streaming path runs
  // end-to-end. State mutates in-process; the optional session-fault arms a
  // bounded run of real 503s for the error-state spec (two, to cover React
  // StrictMode's double mount), then auto-clears so siblings recover.
  if (path === "/chat/session-fault" && method === "POST") {
    const requested = Number(body.count ?? 2);
    state.chatSessionFaultRemaining = Number.isFinite(requested) && requested > 0 ? requested : 2;
    return send(res, 200, { armed: state.chatSessionFaultRemaining });
  }
  if (path === "/chat/session" && method === "GET") {
    if (state.chatSessionFaultRemaining > 0) {
      state.chatSessionFaultRemaining -= 1;
      return send(res, 503, { error: "agent runtime offline" });
    }
    return send(res, 200, { session: SEEDED_CHAT_SESSION });
  }
  if (path === "/chat/message" && method === "POST") {
    const deltas = [
      {
        type: "block",
        block: {
          id: SEEDED_CHAT_REPLY.blockId,
          role: "assistant",
          content: "",
          timestampMs: 1_716_000_500_000,
          pending: true,
        },
      },
      { type: "delta", id: SEEDED_CHAT_REPLY.blockId, content: `${SEEDED_CHAT_REPLY.intro}\n\n` },
      { type: "delta", id: SEEDED_CHAT_REPLY.blockId, content: `\`\`\`ts\n${SEEDED_CHAT_REPLY.codeLine}\n\`\`\`\n` },
      {
        type: "delta",
        id: SEEDED_CHAT_REPLY.blockId,
        content: `Done with **${SEEDED_CHAT_REPLY.boldWord}** and \`${SEEDED_CHAT_REPLY.inlineCodeWord}\`.`,
      },
      { type: "done", id: SEEDED_CHAT_REPLY.blockId },
    ];
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.end(deltas.map((delta) => JSON.stringify(delta)).join("\n") + "\n");
    return;
  }

  // Search (code/issues scopes)
  if (path === "/search") {
    const scope = url.searchParams.get("scope") ?? "code";
    const query = (url.searchParams.get("query") ?? "").toLowerCase();
    if (scope === "issues") {
      const results = state.issues
        .filter((issue) => issue.title.toLowerCase().includes(query))
        .map((issue) => ({ id: issue.id, title: issue.title, description: issue.body, kind: "issue" }));
      return send(res, 200, { results });
    }
    const results = SEEDED_MEMORY_FACTS
      .filter((fact) => fact.key.includes(query) || query.length === 0)
      .map((fact) => ({ id: fact.key, title: fact.key, snippet: fact.valueJson, kind: "memory" }));
    return send(res, 200, { results });
  }

  // SQL Browser (READ-ONLY). Backed by a REAL per-session in-memory SQLite
  // database (`bun:sqlite`) built from SEEDED_SQL_TABLES — NOT regex-faked. Every
  // `/sql/*` response is whatever the genuine SQLite engine produces:
  // `/sql/tables` reads sqlite_master, `/sql/schema` runs PRAGMA table_info,
  // and `/sql/query` executes the spec's literal SQL and returns real result
  // rows (a bad query yields the engine's real error). The `runs` table mirrors
  // SEEDED_RUNS, so the SQL Browser and Runs surfaces agree on the same data.
  // The DB is per-session (isolated) AND read-only (PRAGMA query_only + a
  // guard), so a write/DDL is rejected and can never corrupt another test.
  const sqlDb = sqlDbFor(req);
  if (path === "/sql/tables") {
    const tables = sqlDb
      .query(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    const withCounts = tables.map((table) => {
      const count = sqlDb
        .query(`SELECT COUNT(*) AS c FROM "${table.name}"`)
        .get() as { c: number };
      return { name: table.name, rowCount: count.c, type: "table" };
    });
    return send(res, 200, { tables: withCounts, dbPath: SEEDED_SQL_DB_PATH });
  }
  if (path === "/sql/schema") {
    const tableName = url.searchParams.get("tableName") ?? "";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
      return send(res, 404, { error: `unknown table ${tableName}` });
    }
    const info = sqlDb.query(`PRAGMA table_info("${tableName}")`).all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>;
    if (info.length === 0) return send(res, 404, { error: `unknown table ${tableName}` });
    const columns = info.map((column) => ({
      cid: column.cid,
      name: column.name,
      type: column.type,
      notNull: column.notnull === 1,
      defaultValue: column.dflt_value ?? null,
      primaryKey: column.pk > 0,
    }));
    return send(res, 200, { schema: { tableName, columns }, dbPath: SEEDED_SQL_DB_PATH });
  }
  if (path === "/sql/query" && method === "POST") {
    const query = String(body.query ?? "");
    // Reject any write/DDL BEFORE touching the engine: the SQL Browser is
    // read-only, so a DELETE/INSERT/UPDATE/DROP (or a multi-statement batch that
    // hides one) gets the clear read-only error, not execution.
    if (query.trim().length > 0 && !isReadOnlySql(query)) {
      return send(res, 400, { error: READ_ONLY_SQL_ERROR });
    }
    try {
      const stmt = sqlDb.query(query);
      const rawRows = stmt.all() as Array<Record<string, unknown>>;
      const columns = stmt.columnNames as string[];
      const rows = rawRows.map((row) =>
        columns.map((column) => (row[column] == null ? "" : String(row[column]))),
      );
      return send(res, 200, { result: { columns, rows }, dbPath: SEEDED_SQL_DB_PATH });
    } catch (error) {
      return send(res, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Logs firehose. Served from the seeded log entries; supports the level /
  // category / free-text filters the Logs surface drives. Stats are computed
  // from whatever entries survive the filter so the rendered counts match.
  if (path === "/logs" && method === "GET") {
    const level = url.searchParams.get("level");
    const category = url.searchParams.get("category");
    const query = (url.searchParams.get("query") ?? "").toLowerCase();
    const entries = SEEDED_LOG_ENTRIES.filter((entry) => {
      if (level && entry.level !== level) return false;
      if (category && entry.category !== category) return false;
      if (query && !entry.message.toLowerCase().includes(query)) return false;
      return true;
    });
    const categoryCounts = new Map<string, number>();
    for (const entry of entries) {
      categoryCounts.set(entry.category, (categoryCounts.get(entry.category) ?? 0) + 1);
    }
    const stats = {
      entryCount: entries.length,
      sizeBytes: entries.reduce((sum, entry) => sum + entry.message.length, 0),
      errorCount: entries.filter((entry) => entry.level === "error").length,
      warningCount: entries.filter((entry) => entry.level === "warn").length,
      categories: [...categoryCounts.entries()].map(([cat, count]) => ({ category: cat, count })),
      sources: [],
    };
    return send(res, 200, { entries, stats });
  }

  return send(res, 404, { error: `Unhandled fixture route ${method} ${path}` });
}

const port = Number(process.env.SMITHERS_STUDIO_WORKSPACE_API_PORT ?? "7410");
const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  });
});
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`studio-2 e2e workspace-api server listening on http://127.0.0.1:${port}\n`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
