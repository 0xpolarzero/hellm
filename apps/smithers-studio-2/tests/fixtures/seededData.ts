/**
 * The single source of truth for every deterministic value the real-backend
 * e2e suite asserts on. Both the Gateway fixture (which seeds the SQLite run
 * store) and the workspace-API server (which serves JJHub / memory / scores
 * state) import from here, and the converted specs assert on these exact
 * values. Changing a value here changes it everywhere — no magic constants in
 * the specs.
 */

export type SeededRun = {
  runId: string;
  workflowName: string;
  workflowKey: string;
  status: string;
  createdAtMs: number;
  startedAtMs: number;
  finishedAtMs: number | null;
  heartbeatAtMs: number | null;
  errorJson: string | null;
};

export type SeededNode = {
  runId: string;
  nodeId: string;
  iteration: number;
  state: string;
  outputTable: string;
  label: string;
};

export type SeededApproval = {
  runId: string;
  nodeId: string;
  iteration: number;
  status: string;
  requestedAtMs: number;
  requestJson: string;
};

/** A fixed clock anchor so created/finished timestamps are stable. */
export const SEED_NOW_MS = 1_716_000_000_000;

/**
 * Server-side delay applied to the "stale race alpha" landing's diff so it
 * resolves after a second landing's diff — used by landings-stale-response.spec
 * to exercise the stale-response guard against the real fixture server.
 */
export const STALE_DIFF_DELAY_MS = 1_500;

/**
 * Runs seeded into the Gateway SQLite store. The Runs surface reads these via
 * the real `POST /v1/rpc/listRuns`. Statuses are chosen to exercise every
 * history filter: running, succeeded (finished), failed, and an
 * approval-waiting run.
 */
export const SEEDED_RUNS: SeededRun[] = [
  {
    runId: "run-deploy-running",
    workflowName: "studio-deploy",
    workflowKey: "studio-deploy",
    status: "running",
    createdAtMs: SEED_NOW_MS,
    startedAtMs: SEED_NOW_MS,
    finishedAtMs: null,
    heartbeatAtMs: SEED_NOW_MS,
    errorJson: null,
  },
  {
    runId: "run-build-succeeded",
    workflowName: "studio-build",
    workflowKey: "studio-build",
    status: "finished",
    createdAtMs: SEED_NOW_MS - 60_000,
    startedAtMs: SEED_NOW_MS - 60_000,
    finishedAtMs: SEED_NOW_MS - 59_000,
    heartbeatAtMs: null,
    errorJson: null,
  },
  {
    runId: "run-test-failed",
    workflowName: "studio-test",
    workflowKey: "studio-test",
    status: "failed",
    createdAtMs: SEED_NOW_MS - 120_000,
    startedAtMs: SEED_NOW_MS - 120_000,
    finishedAtMs: SEED_NOW_MS - 119_000,
    heartbeatAtMs: null,
    errorJson: JSON.stringify({ message: "studio test suite failed" }),
  },
  {
    runId: "run-approve-waiting",
    workflowName: "studio-approval",
    workflowKey: "studio-approval",
    status: "waiting-approval",
    createdAtMs: SEED_NOW_MS - 30_000,
    startedAtMs: SEED_NOW_MS - 30_000,
    finishedAtMs: null,
    heartbeatAtMs: SEED_NOW_MS - 30_000,
    errorJson: null,
  },
];

/**
 * The id of the run the fixture EXECUTES live (rather than seeding as inert DB
 * rows) so it has a real populated DevTools tree and a real pending approval
 * gate. The gateway builds node trees from execution frames, and DB rows alone
 * produce none — so the run-detail flows (tree rows, inspector tabs, the inline
 * approval gate) need a genuinely-executed run. The fixture launches a workflow
 * that pauses at this run's approval node; everything below describes what that
 * live run produces so the specs assert on it without magic constants.
 */
export const LIVE_APPROVAL_RUN = {
  runId: "run-approve-waiting",
  workflowKey: "studio-approval",
  /** The two task nodes the executed workflow renders, in order. */
  planNodeId: "plan",
  approvalNodeId: "approve-deploy",
  approvalTitle: "Approve studio deploy",
  approvalSummary: "Ship studio build 42 to production?",
  /** The plan task's deterministic output row, asserted on the Output tab. */
  planOutput: { summary: "ship build 42" },
} as const;

/**
 * Run ids for the DEDICATED live approval runs the fixture executes so that the
 * MUTATING approval specs (approve / deny) act on their own isolated run — never
 * on the canonical {@link LIVE_APPROVAL_RUN}, which the read-only
 * tree/inspector/narrow specs share. Each is a real execution of the same
 * `studio-approval` workflow paused at the same `approve-deploy` gate, so they
 * carry the same node ids/labels/output as {@link LIVE_APPROVAL_RUN}.
 */
export const LIVE_MUTABLE_RUN_IDS = {
  approve: "run-approve-decide",
  deny: "run-deny-decide",
} as const;

/**
 * Every approval run id the fixture EXECUTES live to a pending gate (canonical
 * read-only run + the approve/deny runs). The cancel run is NOT here: a run
 * parked at an approval gate is no longer in the gateway's active set, so the
 * real `cancelRun` RPC rejects it (RUN_NOT_ACTIVE). The cancel spec instead
 * targets {@link LIVE_CANCEL_RUN}, an actively-executing run.
 */
export const LIVE_APPROVAL_RUN_IDS = [
  LIVE_APPROVAL_RUN.runId,
  LIVE_MUTABLE_RUN_IDS.approve,
  LIVE_MUTABLE_RUN_IDS.deny,
] as const;

/**
 * The live run the cancel spec targets: a real execution of a long-running
 * `studio-long` workflow that STAYS actively running (so it is in the gateway's
 * active set and the real `cancelRun` RPC genuinely cancels it). It runs on its
 * own SQLite DB and its own workflow registration so it never duplicates the
 * approval-DB runs in `listRuns` (the gateway lists runs per registered adapter;
 * separate DBs keep each run in exactly one adapter).
 */
export const LIVE_CANCEL_RUN = {
  runId: "run-cancel-live",
  workflowKey: "studio-long",
  taskNodeId: "long-task",
} as const;

/**
 * The live run whose workflow ships its OWN custom UI. The fixture registers
 * `studio-ui` with a Gateway-served UI (see `workflowUiEntry.ts`) and executes
 * one run of it, so the Runs surface defaults this run into the embedded
 * workflow UI — and the view toggle can swap it back to the default tree. It
 * runs on its own SQLite DB so its run never duplicates the other adapters'
 * runs in `listRuns`. `uiPath` is the Gateway's default mount for the key.
 */
export const LIVE_UI_RUN = {
  runId: "run-ui-live",
  workflowKey: "studio-ui",
  taskNodeId: "ui-task",
  uiPath: "/workflows/studio-ui",
} as const;

/**
 * ROUND-2 live run: a MULTI-FRAME run. The fixture executes a workflow with
 * several sequential tasks that ALL settle, so the orchestrator commits more
 * than one frame (`getDevToolsSnapshot.frameNo > 1`). That is exactly the
 * condition the Runs toolbar uses to render the Rewind / time-travel button
 * (see src/runs/RunToolbar.tsx `frameCount > 1`), so a phase-2 spec can select
 * this run and exercise the rewind path. The run finishes, so it is ALSO a
 * terminal run that exposes Resume — but prefer {@link LIVE_RESUMABLE_RUN} for
 * the dedicated resume path to keep rewind and resume specs isolated.
 *
 * It runs on its OWN SQLite DB + workflow registration so its run never
 * duplicates the other adapters' runs across `listRuns`.
 */
export const LIVE_MULTIFRAME_RUN = {
  runId: "run-multiframe-live",
  workflowKey: "studio-multiframe",
  /** The sequential task node ids, in commit order. Three tasks → ≥3 frames. */
  taskNodeIds: ["mf-step-1", "mf-step-2", "mf-step-3"] as const,
} as const;

/**
 * ROUND-2 live run: a RUNNING (non-terminal) run that has already PROGRESSED and
 * STAYS active. The fixture executes a workflow whose first tasks settle quickly
 * (committing several frames, so `getDevToolsSnapshot.frameNo > 1` by the time
 * the gateway binds), then PARKS on a final task that sleeps effectively forever.
 * The run therefore stays in the gateway's active set — the toolbar shows Cancel
 * and the state pill reads "Running" — while already carrying multiple committed
 * frames. A phase-2 spec can assert live-run state (Running) and the multi-frame
 * tree without racing the run to completion. The fixture awaits the quick steps'
 * frames before binding (see gatewayFixture.tsx), so the Running + multi-frame
 * state is guaranteed, not timing-dependent. Its own DB + registration.
 */
export const LIVE_PROGRESSING_RUN = {
  runId: "run-progressing-live",
  workflowKey: "studio-progressing",
  /**
   * Sequential task node ids. The first three settle quickly (committing frames);
   * the LAST (`pg-park`) sleeps ~10 minutes so the run stays Running for the
   * whole suite. The first node doubles as the readiness marker the fixture
   * waits on before binding.
   */
  taskNodeIds: ["pg-step-1", "pg-step-2", "pg-step-3", "pg-park"] as const,
  /** The parking task's id — the one that keeps the run alive. */
  parkNodeId: "pg-park",
} as const;

/**
 * ROUND-2 live run: a TERMINAL, RESUMABLE run for the resume path. The fixture
 * executes a workflow that runs to a finished terminal state, so the Runs
 * toolbar shows Resume (see RunToolbar.tsx — terminal runs render Resume) and a
 * phase-2 spec can drive the real `resumeRun` RPC against it. It is multi-task
 * so it also carries a real tree. Its own DB + registration.
 */
export const LIVE_RESUMABLE_RUN = {
  runId: "run-resumable-live",
  workflowKey: "studio-resumable",
  taskNodeIds: ["rs-step-1", "rs-step-2"] as const,
} as const;

/**
 * Nodes the live approval run renders. These are NOT seeded as DB rows — they
 * are produced by executing the workflow — but the shape is kept here so the
 * run-detail specs assert on stable ids/labels.
 */
export const SEEDED_NODES: SeededNode[] = [
  {
    runId: LIVE_APPROVAL_RUN.runId,
    nodeId: LIVE_APPROVAL_RUN.planNodeId,
    iteration: 0,
    state: "finished",
    outputTable: "plan",
    label: "plan",
  },
  {
    runId: LIVE_APPROVAL_RUN.runId,
    nodeId: LIVE_APPROVAL_RUN.approvalNodeId,
    iteration: 0,
    state: "waiting-approval",
    outputTable: "approval",
    label: LIVE_APPROVAL_RUN.approvalTitle,
  },
];

/**
 * The pending approval gate the Runs approvals filter + inline gate surface.
 * This is produced by the LIVE executed run (not inserted as a DB row); the
 * shape mirrors exactly what the live `listApprovals` RPC returns for it.
 */
export const SEEDED_APPROVALS: SeededApproval[] = [
  {
    runId: LIVE_APPROVAL_RUN.runId,
    nodeId: LIVE_APPROVAL_RUN.approvalNodeId,
    iteration: 0,
    status: "requested",
    requestedAtMs: SEED_NOW_MS - 29_000,
    requestJson: JSON.stringify({
      title: LIVE_APPROVAL_RUN.approvalTitle,
      summary: LIVE_APPROVAL_RUN.approvalSummary,
    }),
  },
];

/** The names a converted spec can assert appear in the runs history. */
export const SEEDED_RUN_IDS = SEEDED_RUNS.map((run) => run.runId);

/**
 * The runs that ARE inserted as inert DB rows by `seedRunStore` — every seeded
 * run EXCEPT the live approval run, which the gateway fixture executes instead
 * (a DB row and a live run cannot share a primary key).
 */
export const DB_SEEDED_RUNS = SEEDED_RUNS.filter((run) => run.runId !== LIVE_APPROVAL_RUN.runId);

/** JJHub state served by the workspace-API server (issues/landings/workspaces). */
export const SEEDED_JJHUB_STATE = {
  auth: {
    apiUrl: "https://api.jjhub.test",
    loggedIn: true,
    tokenSet: true,
    tokenSource: "fixture env",
    user: "studio-fixture",
    email: "studio@example.test",
    message: null,
  },
  issues: [
    {
      id: "issue-101",
      number: 101,
      title: "Studio JJHub issue",
      body: "Real JJHub issue data for Smithers Studio 2.",
      state: "open",
      labels: ["studio", "parity"],
      assignees: ["codex"],
      commentCount: 2,
    },
    {
      id: "issue-102",
      number: 102,
      title: "Closed Studio issue",
      body: "Closed issue loaded through JJHub.",
      state: "closed",
      labels: ["done"],
      assignees: [],
      commentCount: 1,
    },
  ],
  landings: [
    {
      id: "landing-201",
      number: 201,
      title: "Studio landing request",
      description: "Real JJHub landing data for Smithers Studio 2.",
      state: "open",
      targetBranch: "main",
      author: "codex",
      createdAt: "2026-05-25T12:00:00.000Z",
      reviewStatus: "pending",
      diff: "diff --git a/landing.txt b/landing.txt\n--- a/landing.txt\n+++ b/landing.txt\n@@ -1 +1,2 @@\n base\n+landing change\n",
      checks: "build: passing\ntest: passing\n",
      conflicts: {
        conflictStatus: "conflicted",
        hasConflicts: true,
        conflicts: [
          {
            changeID: "change-studio-1",
            filePath: "src/landing-conflict.ts",
            conflictType: "content",
            resolved: false,
            resolutionStatus: "unresolved",
          },
        ],
      },
    },
    {
      id: "landing-202",
      number: 202,
      title: "Merged Studio landing",
      description: "Merged landing loaded through JJHub.",
      state: "merged",
      targetBranch: "main",
      author: "codex",
      createdAt: "2026-05-24T12:00:00.000Z",
      reviewStatus: "approved",
      diff: "",
      checks: "merged checks passed\n",
      conflicts: { conflictStatus: "clean", hasConflicts: false, conflicts: [] },
    },
    {
      id: "landing-301",
      number: 301,
      title: "Stale race alpha landing",
      description: "Race-test landing A; the fixture server delays its diff so it resolves after B's.",
      state: "open",
      targetBranch: "main",
      author: "codex",
      createdAt: "2026-05-27T12:00:00.000Z",
      reviewStatus: "pending",
      diff: "diff --git a/alpha.ts b/alpha.ts\n@@ -1 +1 @@\n-old-alpha\n+new-alpha\n",
      checks: "alpha checks: passing\n",
      conflicts: { conflictStatus: "clean", hasConflicts: false, conflicts: [] },
      diffDelayMs: STALE_DIFF_DELAY_MS,
    },
    {
      id: "landing-302",
      number: 302,
      title: "Stale race beta landing",
      description: "Race-test landing B; its diff resolves immediately.",
      state: "open",
      targetBranch: "main",
      author: "codex",
      createdAt: "2026-05-27T13:00:00.000Z",
      reviewStatus: "pending",
      diff: "diff --git a/beta.ts b/beta.ts\n@@ -1 +1 @@\n-old-beta\n+new-beta\n",
      checks: "beta checks: passing\n",
      conflicts: { conflictStatus: "clean", hasConflicts: false, conflicts: [] },
    },
  ],
  workspaces: [
    {
      id: "ws-active",
      name: "Studio cloud workspace",
      status: "active",
      createdAt: "2026-05-26T12:00:00.000Z",
    },
    {
      id: "ws-suspended",
      name: "Studio suspended workspace",
      status: "suspended",
      createdAt: "2026-05-26T12:05:00.000Z",
    },
  ],
  snapshots: [
    {
      id: "snap-base",
      workspaceId: "ws-active",
      name: "studio-base-snapshot",
      createdAt: "2026-05-26T12:10:00.000Z",
    },
  ],
  recents: [
    {
      path: "/tmp/studio-alpha",
      displayName: "studio-alpha",
      exists: true,
      hasSmithers: true,
      smithersPath: "/tmp/studio-alpha/.smithers",
      lastOpenedAt: "2026-05-27T12:00:00.000Z",
    },
    {
      path: "/tmp/studio-beta",
      displayName: "studio-beta",
      exists: true,
      hasSmithers: false,
      smithersPath: null,
      lastOpenedAt: "2026-05-26T09:30:00.000Z",
    },
  ],
} as const;

/**
 * Workflow discovery state served by the workspace-API server for the Workflows
 * surface (`/api/workflows`, `/jjhub-workflows`, `/prompts`, `/crons`, and the
 * `/workflow-sources/*` source + graph endpoints). The four segments
 * (Local / Remote / Prompts / Schedules) each read one of these lists; the
 * Local "studio-ship" workflow additionally exposes a source + declared launch
 * fields so the launch form + source tab can be exercised end to end.
 */
export const SEEDED_WORKFLOWS = {
  local: [
    {
      key: "studio-ship",
      readableName: "Studio Ship",
      description: "Land the current studio change.",
      hasUi: true,
    },
    {
      key: "studio-review",
      readableName: "Studio Review",
      description: "Review a studio diff.",
      hasUi: false,
    },
  ],
  remote: [
    { id: 7, name: "studio-nightly-build", path: ".jjhub/studio-nightly.yml", isActive: true },
  ],
  prompts: [{ id: "studio-summarize", entryFile: ".smithers/prompts/studio-summarize.md" }],
  crons: [
    { cronId: "studio-cron-1", workflow: "studio-ship", pattern: "0 9 * * *", enabled: true },
  ],
} as const;

/**
 * The Local "studio-ship" workflow's source + launch graph. The source tab
 * asserts on `source`; the launch form renders one control per `fields` entry.
 * `target` carries a default ("main") and is required; `dryRun` is an optional
 * boolean — together they exercise prefill, validation, and boolean coercion.
 */
export const SEEDED_WORKFLOW_SHIP_SOURCE = {
  workflowKey: "studio-ship",
  path: ".smithers/workflows/studio-ship.tsx",
  source: 'export const studioShip = workflow(() => <Task name="land" />);',
  imports: [],
} as const;

export const SEEDED_WORKFLOW_SHIP_GRAPH = {
  workflowKey: "studio-ship",
  path: ".smithers/workflows/studio-ship.tsx",
  mode: "graph",
  message: null,
  tasks: [],
  edges: [],
  fields: [
    { key: "target", name: "target", type: "string", defaultValue: "main", required: true },
    { key: "dryRun", name: "dryRun", type: "boolean", defaultValue: null, required: false },
  ],
  raw: {},
} as const;

/** Memory facts served at /__smithers_studio/api/memory. */
export const SEEDED_MEMORY_FACTS = [
  {
    namespace: "studio/project",
    key: "deploy-window",
    valueJson: JSON.stringify({ fact: "Deploys run weekdays after 10am PT." }),
    schemaSig: null,
    createdAtMs: SEED_NOW_MS - 200_000,
    updatedAtMs: SEED_NOW_MS - 100_000,
    ttlMs: null,
  },
  {
    namespace: "studio/project",
    key: "owner",
    valueJson: JSON.stringify({ fact: "Studio is owned by the platform team." }),
    schemaSig: null,
    createdAtMs: SEED_NOW_MS - 300_000,
    updatedAtMs: SEED_NOW_MS - 150_000,
    ttlMs: null,
  },
] as const;

/**
 * The deterministic agent-chat transcript served by the workspace-API server
 * at /__smithers_studio/api/chat/*. studio-2 has no Gateway-DB chat-event path,
 * so the workspace server IS the real deterministic backend: it serves a seeded
 * session and replays a fixed assistant turn (no live LLM). The converted chat
 * spec drives the real AgentChat + useAgentChat + chatApi code against these
 * exact values over real same-origin HTTP (vite proxies /__smithers_studio).
 */
export const SEEDED_CHAT_SESSION = {
  sessionId: "studio-chat-session",
  model: "claude-opus-4",
  mode: "default",
  blocks: [
    {
      id: "chat-seed-system",
      role: "system",
      content: "Workspace agent ready.",
      timestampMs: SEED_NOW_MS - 400_000,
    },
  ],
} as const;

/**
 * The id the streamed assistant reply uses, and the markdown content the server
 * streams as ndjson deltas. The content exercises the MarkdownContent renderer
 * end-to-end: a heading line, a fenced code block (.ws-md-code), bold (strong)
 * and inline code (.ws-md-inline-code).
 */
export const SEEDED_CHAT_REPLY = {
  blockId: "chat-reply-assistant",
  intro: "Here is a plan:",
  codeLine: "const x = 1;",
  boldWord: "bold",
  inlineCodeWord: "code",
  /** The full markdown the assembled assistant block contains once streamed. */
  markdown:
    "Here is a plan:\n\n```ts\nconst x = 1;\n```\nDone with **bold** and `code`.",
} as const;

/** Scorer rows served at /__smithers_studio/api/scores. */
export const SEEDED_SCORES = [
  {
    id: "score-1",
    runId: "run-build-succeeded",
    nodeId: "review",
    iteration: 0,
    attempt: 0,
    scorerId: "faithfulness",
    scorerName: "Faithfulness",
    source: "llm-judge",
    score: 0.92,
    reason: "Output matched the build spec.",
    metaJson: null,
    inputJson: null,
    outputJson: null,
    latencyMs: 120,
    scoredAtMs: SEED_NOW_MS - 58_000,
    durationMs: 120,
  },
  {
    id: "score-2",
    runId: "run-build-succeeded",
    nodeId: "review",
    iteration: 0,
    attempt: 0,
    scorerId: "relevancy",
    scorerName: "Relevancy",
    source: "llm-judge",
    score: 0.81,
    reason: "Mostly relevant with minor drift.",
    metaJson: null,
    inputJson: null,
    outputJson: null,
    latencyMs: 95,
    scoredAtMs: SEED_NOW_MS - 57_500,
    durationMs: 95,
  },
] as const;

/**
 * The absolute path the workspace-API server reports as the SQLite database
 * location. Deterministic so the SQL Browser surface can assert on the dbPath.
 */
export const SEEDED_SQL_DB_PATH = "/tmp/studio/.smithers/smithers.db";

/**
 * The schema the workspace-API server builds a REAL in-process SQLite database
 * from, then serves `/sql/tables`, `/sql/schema`, and `/sql/query` against. This
 * is not route mocking: the server runs genuine SQL via `bun:sqlite` and returns
 * whatever the engine produces. The `runs` table is seeded from `SEEDED_RUNS`
 * (the same runs the Gateway serves) so the SQL Browser and the Runs surface
 * agree on the data.
 */
export const SEEDED_SQL_TABLES = [
  {
    name: "runs",
    createSql:
      "CREATE TABLE runs (id TEXT PRIMARY KEY NOT NULL, workflow_key TEXT, status TEXT)",
    rows: SEEDED_RUNS.map((run) => ({
      id: run.runId,
      workflow_key: run.workflowKey,
      status: run.status,
    })),
  },
  {
    name: "memory_facts",
    createSql:
      "CREATE TABLE memory_facts (namespace TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT)",
    rows: SEEDED_MEMORY_FACTS.map((fact) => ({
      namespace: fact.namespace,
      key: fact.key,
      value_json: fact.valueJson,
    })),
  },
] as const;

/**
 * Event-log firehose entries served at `/__smithers_studio/api/logs`. Levels
 * and categories are chosen to exercise the Logs surface stats (1 error, 1
 * warning) and the level / category / free-text filters end to end.
 */
export const SEEDED_LOG_ENTRIES = [
  {
    id: "log-gateway-error",
    timestamp: "2026-05-28T10:00:00.000Z",
    level: "error",
    category: "gateway",
    message: "studio gateway connection refused",
    metadata: null,
    sourcePath: "/tmp/studio/.smithers/logs/gateway.log",
    raw: null,
  },
  {
    id: "log-runner-info",
    timestamp: "2026-05-28T10:00:01.000Z",
    level: "info",
    category: "runner",
    message: "studio run started",
    metadata: null,
    sourcePath: "/tmp/studio/.smithers/logs/runner.log",
    raw: null,
  },
  {
    id: "log-runner-warn",
    timestamp: "2026-05-28T10:00:02.000Z",
    level: "warn",
    category: "runner",
    message: "studio run heartbeat slow",
    metadata: null,
    sourcePath: "/tmp/studio/.smithers/logs/runner.log",
    raw: null,
  },
] as const;
