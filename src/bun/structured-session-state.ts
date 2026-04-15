import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type StructuredSessionStatus = "idle" | "running" | "waiting" | "error";

export type StructuredThreadKind = "direct" | "verification" | "workflow";
export type StructuredThreadStatus = "running" | "completed" | "failed" | "waiting";

export type StructuredThreadResultKind =
  | "analysis-summary"
  | "change-summary"
  | "verification-summary"
  | "workflow-summary"
  | "clarification-summary";

export type StructuredVerificationStatus = "passed" | "failed" | "cancelled";
export type StructuredWorkflowStatus = "running" | "completed" | "failed" | "waiting";

export type StructuredThreadBlockedOn =
  | {
      kind: "threads";
      threadIds: string[];
      waitPolicy: "all" | "any";
      reason: string;
      since: string;
    }
  | {
      kind: "user" | "external";
      reason: string;
      resumeWhen: string;
      since: string;
    };

export type StructuredLifecycleEventKind =
  | "thread-started"
  | "thread-status-changed"
  | "thread-result-created"
  | "verification-finished"
  | "workflow-started"
  | "workflow-status-changed"
  | "session-waiting-started"
  | "session-waiting-ended";

export interface StructuredWorkspaceRecord {
  id: string;
  label: string;
  cwd: string;
}

export interface StructuredPiSessionRecord {
  sessionId: string;
  title: string;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  messageCount: number;
  status: StructuredSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StructuredSessionWaitingState {
  threadId: string;
  reason: string;
  resumeWhen: string;
  since: string;
}

export interface StructuredThreadRecord {
  id: string;
  sessionId: string;
  kind: StructuredThreadKind;
  objective: string;
  status: StructuredThreadStatus;
  result: StructuredThreadResultRecord | null;
  blockedReason: string | null;
  blockedOn: StructuredThreadBlockedOn | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredThreadResultRecord {
  kind: StructuredThreadResultKind;
  summary: string;
  body: string;
  createdAt: string;
}

export interface StructuredVerificationRecord {
  id: string;
  sessionId: string;
  threadId: string;
  kind: string;
  status: StructuredVerificationStatus;
  summary: string;
  command?: string;
  startedAt: string;
  finishedAt: string;
}

export interface StructuredWorkflowRecord {
  id: string;
  sessionId: string;
  threadId: string;
  smithersRunId: string;
  workflowName: string;
  status: StructuredWorkflowStatus;
  summary: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredLifecycleEventRecord {
  id: string;
  sessionId: string;
  at: string;
  kind: StructuredLifecycleEventKind;
  threadId?: string;
}

export interface StructuredSessionSnapshot {
  workspace: StructuredWorkspaceRecord;
  pi: StructuredPiSessionRecord;
  session: {
    waitingOn: StructuredSessionWaitingState | null;
  };
  threads: StructuredThreadRecord[];
  verifications: StructuredVerificationRecord[];
  workflows: StructuredWorkflowRecord[];
  events: StructuredLifecycleEventRecord[];
}

export interface StructuredThreadDetail {
  thread: StructuredThreadRecord;
  verifications: StructuredVerificationRecord[];
  workflow: StructuredWorkflowRecord | null;
}

export interface CreateStructuredSessionStateStoreOptions {
  databasePath?: string;
  now?: () => string;
  workspace: StructuredWorkspaceRecord;
}

export interface StructuredSessionStateStore {
  upsertPiSession(pi: StructuredPiSessionRecord): void;
  startThread(input: {
    sessionId: string;
    kind: StructuredThreadKind;
    objective: string;
  }): StructuredThreadRecord;
  updateThread(input: {
    threadId: string;
    status: StructuredThreadStatus;
    blockedReason?: string | null;
    blockedOn?: StructuredThreadBlockedOn | null;
  }): StructuredThreadRecord;
  setThreadResult(input: {
    threadId: string;
    kind: StructuredThreadResultKind;
    summary: string;
    body: string;
  }): StructuredThreadResultRecord;
  recordVerification(input: {
    threadId: string;
    kind: string;
    status: StructuredVerificationStatus;
    summary: string;
    command?: string;
  }): StructuredVerificationRecord;
  startWorkflow(input: {
    threadId: string;
    smithersRunId: string;
    workflowName: string;
    summary: string;
  }): StructuredWorkflowRecord;
  updateWorkflow(input: {
    workflowId: string;
    status: StructuredWorkflowStatus;
    summary: string;
  }): StructuredWorkflowRecord;
  setWaitingState(input: {
    sessionId: string;
    threadId: string;
    kind: "user" | "external";
    reason: string;
    resumeWhen: string;
  }): StructuredSessionWaitingState;
  getSessionState(sessionId: string): StructuredSessionSnapshot;
  listSessionStates(): StructuredSessionSnapshot[];
  getThreadDetail(threadId: string): StructuredThreadDetail;
  close(): void;
}

interface StructuredSessionRow {
  session_id: string;
  title: string;
  provider: string | null;
  model: string | null;
  reasoning_effort: string | null;
  message_count: number;
  pi_status: StructuredSessionStatus;
  created_at: string;
  updated_at: string;
  waiting_on_thread_id: string | null;
  waiting_reason: string | null;
  waiting_resume_when: string | null;
  waiting_since: string | null;
}

interface StructuredThreadRow {
  id: string;
  session_id: string;
  kind: StructuredThreadKind;
  objective: string;
  status: StructuredThreadStatus;
  result_kind: StructuredThreadResultKind | null;
  result_summary: string | null;
  result_body: string | null;
  result_created_at: string | null;
  blocked_reason: string | null;
  blocked_on_kind: "threads" | "user" | "external" | null;
  blocked_on_thread_ids: string | null;
  blocked_on_wait_policy: "all" | "any" | null;
  blocked_on_reason: string | null;
  blocked_on_resume_when: string | null;
  blocked_on_since: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface StructuredVerificationRow {
  id: string;
  session_id: string;
  thread_id: string;
  kind: string;
  status: StructuredVerificationStatus;
  summary: string;
  command: string | null;
  started_at: string;
  finished_at: string;
}

interface StructuredWorkflowRow {
  id: string;
  session_id: string;
  thread_id: string;
  smithers_run_id: string;
  workflow_name: string;
  status: StructuredWorkflowStatus;
  summary: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface StructuredEventRow {
  id: string;
  session_id: string;
  thread_id: string | null;
  kind: StructuredLifecycleEventKind;
  at: string;
}

interface StructuredWorkspaceRow {
  id: string;
  label: string;
  cwd: string;
}

const DEFAULT_DATABASE_PATH = ":memory:";

function resolveDatabasePath(databasePath: string | undefined): string {
  return databasePath?.trim() || DEFAULT_DATABASE_PATH;
}

function isTerminalThreadStatus(status: StructuredThreadStatus): boolean {
  return status === "completed" || status === "failed";
}

class SqliteStructuredSessionStateStore implements StructuredSessionStateStore {
  private readonly db: Database;
  private readonly now: () => string;
  private readonly idCounters = new Map<string, number>();
  private readonly workspaceFallback: StructuredWorkspaceRecord;

  constructor(options: CreateStructuredSessionStateStoreOptions) {
    const databasePath = resolveDatabasePath(options.databasePath);
    if (databasePath !== DEFAULT_DATABASE_PATH) {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.db = new Database(databasePath);
    this.now = options.now ?? (() => new Date().toISOString());
    this.workspaceFallback = structuredClone(options.workspace);

    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        cwd TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session (
        session_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        reasoning_effort TEXT,
        message_count INTEGER NOT NULL,
        pi_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        waiting_on_thread_id TEXT,
        waiting_reason TEXT,
        waiting_resume_when TEXT,
        waiting_since TEXT
      );

      CREATE TABLE IF NOT EXISTS thread (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        result_kind TEXT,
        result_summary TEXT,
        result_body TEXT,
        result_created_at TEXT,
        blocked_reason TEXT,
        blocked_on_kind TEXT,
        blocked_on_thread_ids TEXT,
        blocked_on_wait_policy TEXT,
        blocked_on_reason TEXT,
        blocked_on_resume_when TEXT,
        blocked_on_since TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY(session_id) REFERENCES session(session_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_session ON thread(session_id);

      CREATE TABLE IF NOT EXISTS verification (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        command TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(thread_id) REFERENCES thread(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_verification_session ON verification(session_id);
      CREATE INDEX IF NOT EXISTS idx_verification_thread ON verification(thread_id);

      CREATE TABLE IF NOT EXISTS workflow (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        thread_id TEXT NOT NULL UNIQUE,
        smithers_run_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY(session_id) REFERENCES session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(thread_id) REFERENCES thread(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_session ON workflow(session_id);

      CREATE TABLE IF NOT EXISTS domain_event (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        thread_id TEXT,
        kind TEXT NOT NULL,
        at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(thread_id) REFERENCES thread(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_domain_event_session ON domain_event(session_id);
    `);

    this.ensureThreadBlockedOnColumns();

    this.db
      .query(
        `INSERT INTO workspace (id, label, cwd)
         VALUES (?, ?, ?)
         ON CONFLICT(id)
         DO UPDATE SET
           label = excluded.label,
           cwd = excluded.cwd`,
      )
      .run(options.workspace.id, options.workspace.label, options.workspace.cwd);

    this.rebuildIdCounters();
  }

  upsertPiSession(pi: StructuredPiSessionRecord): void {
    const existing = this.getSessionRow(pi.sessionId);
    if (!existing) {
      this.db
        .query(
          `INSERT INTO session (
            session_id,
            title,
            provider,
            model,
            reasoning_effort,
            message_count,
            pi_status,
            created_at,
            updated_at,
            waiting_on_thread_id,
            waiting_reason,
            waiting_resume_when,
            waiting_since
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
        )
        .run(
          pi.sessionId,
          pi.title,
          pi.provider ?? null,
          pi.model ?? null,
          pi.reasoningEffort ?? null,
          pi.messageCount,
          pi.status,
          pi.createdAt,
          pi.updatedAt,
        );
      return;
    }

    this.db
      .query(
        `UPDATE session
         SET
           title = ?,
           provider = ?,
           model = ?,
           reasoning_effort = ?,
           message_count = ?,
           pi_status = ?,
           created_at = ?,
           updated_at = ?
         WHERE session_id = ?`,
      )
      .run(
        pi.title,
        pi.provider ?? null,
        pi.model ?? null,
        pi.reasoningEffort ?? null,
        pi.messageCount,
        pi.status,
        pi.createdAt,
        pi.updatedAt,
        pi.sessionId,
      );
  }

  startThread(input: {
    sessionId: string;
    kind: StructuredThreadKind;
    objective: string;
  }): StructuredThreadRecord {
    this.mustFindSession(input.sessionId);

    const timestamp = this.now();
    const threadId = this.nextId("thread");

    this.db
      .query(
        `INSERT INTO thread (
          id,
          session_id,
          kind,
          objective,
          status,
          result_kind,
          result_summary,
          result_body,
          result_created_at,
          blocked_reason,
          blocked_on_kind,
          blocked_on_thread_ids,
          blocked_on_wait_policy,
          blocked_on_reason,
          blocked_on_resume_when,
          blocked_on_since,
          started_at,
          updated_at,
          finished_at
        ) VALUES (?, ?, ?, ?, 'running', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL)`,
      )
      .run(threadId, input.sessionId, input.kind, input.objective, timestamp, timestamp);

    this.touchSession(input.sessionId, timestamp);
    this.appendEvent(input.sessionId, "thread-started", threadId, timestamp);

    return this.mustFindThreadRecord(threadId);
  }

  updateThread(input: {
    threadId: string;
    status: StructuredThreadStatus;
    blockedReason?: string | null;
    blockedOn?: StructuredThreadBlockedOn | null;
  }): StructuredThreadRecord {
    const thread = this.mustFindThread(input.threadId);
    const timestamp = this.now();
    this.writeThreadStatus(thread, {
      status: input.status,
      blockedReason: input.blockedReason,
      blockedOn: input.blockedOn,
    }, timestamp);

    const session = this.mustFindSession(thread.session_id);
    if (input.status !== "waiting" && session.waiting_on_thread_id === input.threadId) {
      this.db
        .query(
          `UPDATE session
           SET
             waiting_on_thread_id = NULL,
             waiting_reason = NULL,
             waiting_resume_when = NULL,
             waiting_since = NULL
           WHERE session_id = ?`,
        )
        .run(thread.session_id);
      this.appendEvent(thread.session_id, "session-waiting-ended", input.threadId, timestamp);
    }

    this.touchSession(thread.session_id, timestamp);
    this.appendEvent(thread.session_id, "thread-status-changed", input.threadId, timestamp);

    return this.mustFindThreadRecord(input.threadId);
  }

  setThreadResult(input: {
    threadId: string;
    kind: StructuredThreadResultKind;
    summary: string;
    body: string;
  }): StructuredThreadResultRecord {
    const thread = this.mustFindThread(input.threadId);
    if (thread.result_kind !== null) {
      throw new Error(`Thread already has a result: ${input.threadId}`);
    }

    const timestamp = this.now();
    this.db
      .query(
        `UPDATE thread
         SET
           result_kind = ?,
           result_summary = ?,
           result_body = ?,
           result_created_at = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(input.kind, input.summary, input.body, timestamp, timestamp, input.threadId);

    this.touchSession(thread.session_id, timestamp);
    this.appendEvent(thread.session_id, "thread-result-created", input.threadId, timestamp);

    return {
      kind: input.kind,
      summary: input.summary,
      body: input.body,
      createdAt: timestamp,
    };
  }

  recordVerification(input: {
    threadId: string;
    kind: string;
    status: StructuredVerificationStatus;
    summary: string;
    command?: string;
  }): StructuredVerificationRecord {
    const thread = this.mustFindThread(input.threadId);
    const timestamp = this.now();
    const verificationId = this.nextId("verification");

    this.db
      .query(
        `INSERT INTO verification (
          id,
          session_id,
          thread_id,
          kind,
          status,
          summary,
          command,
          started_at,
          finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        verificationId,
        thread.session_id,
        input.threadId,
        input.kind,
        input.status,
        input.summary,
        input.command ?? null,
        timestamp,
        timestamp,
      );

    this.touchSession(thread.session_id, timestamp);
    this.appendEvent(thread.session_id, "verification-finished", input.threadId, timestamp);

    return this.mustFindVerificationRecord(verificationId);
  }

  startWorkflow(input: {
    threadId: string;
    smithersRunId: string;
    workflowName: string;
    summary: string;
  }): StructuredWorkflowRecord {
    const thread = this.mustFindThread(input.threadId);
    if (thread.kind !== "workflow") {
      throw new Error(`Workflow projections require workflow threads: ${input.threadId}`);
    }
    if (this.findWorkflowByThreadId(input.threadId)) {
      throw new Error(`Thread already has a workflow: ${input.threadId}`);
    }

    const timestamp = this.now();
    const workflowId = this.nextId("workflow");

    this.db
      .query(
        `INSERT INTO workflow (
          id,
          session_id,
          thread_id,
          smithers_run_id,
          workflow_name,
          status,
          summary,
          started_at,
          updated_at,
          finished_at
        ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, NULL)`,
      )
      .run(
        workflowId,
        thread.session_id,
        input.threadId,
        input.smithersRunId,
        input.workflowName,
        input.summary,
        timestamp,
        timestamp,
      );

    this.touchSession(thread.session_id, timestamp);
    this.appendEvent(thread.session_id, "workflow-started", input.threadId, timestamp);

    return this.mustFindWorkflowRecord(workflowId);
  }

  updateWorkflow(input: {
    workflowId: string;
    status: StructuredWorkflowStatus;
    summary: string;
  }): StructuredWorkflowRecord {
    const workflow = this.mustFindWorkflow(input.workflowId);
    const timestamp = this.now();
    const finishedAt =
      input.status === "completed" || input.status === "failed" ? timestamp : null;

    this.db
      .query(
        `UPDATE workflow
         SET
           status = ?,
           summary = ?,
           updated_at = ?,
           finished_at = ?
         WHERE id = ?`,
      )
      .run(input.status, input.summary, timestamp, finishedAt, input.workflowId);

    this.touchSession(workflow.session_id, timestamp);
    this.appendEvent(workflow.session_id, "workflow-status-changed", workflow.thread_id, timestamp);

    return this.mustFindWorkflowRecord(input.workflowId);
  }

  setWaitingState(input: {
    sessionId: string;
    threadId: string;
    kind: "user" | "external";
    reason: string;
    resumeWhen: string;
  }): StructuredSessionWaitingState {
    this.mustFindSession(input.sessionId);
    const thread = this.mustFindThread(input.threadId);
    if (thread.session_id !== input.sessionId) {
      throw new Error(
        `Thread ${input.threadId} does not belong to session ${input.sessionId}.`,
      );
    }

    const timestamp = this.now();
    this.writeThreadStatus(
      thread,
      {
        status: "waiting",
        blockedReason: input.reason,
        blockedOn: {
          kind: input.kind,
          reason: input.reason,
          resumeWhen: input.resumeWhen,
          since: timestamp,
        },
      },
      timestamp,
    );
    this.db
      .query(
        `UPDATE session
         SET
           waiting_on_thread_id = ?,
           waiting_reason = ?,
           waiting_resume_when = ?,
           waiting_since = ?,
           updated_at = ?
         WHERE session_id = ?`,
      )
      .run(
        input.threadId,
        input.reason,
        input.resumeWhen,
        timestamp,
        timestamp,
        input.sessionId,
      );

    this.appendEvent(input.sessionId, "thread-status-changed", input.threadId, timestamp);
    this.appendEvent(input.sessionId, "session-waiting-started", input.threadId, timestamp);

    return {
      threadId: input.threadId,
      reason: input.reason,
      resumeWhen: input.resumeWhen,
      since: timestamp,
    };
  }

  getSessionState(sessionId: string): StructuredSessionSnapshot {
    const session = this.mustFindSession(sessionId);
    return this.buildSessionSnapshot(session);
  }

  listSessionStates(): StructuredSessionSnapshot[] {
    const rows = this.db
      .query(
        `SELECT session_id
         FROM session
         ORDER BY updated_at DESC, session_id DESC`,
      )
      .all() as Array<{ session_id: string }>;

    return rows.map((row) => this.getSessionState(row.session_id));
  }

  getThreadDetail(threadId: string): StructuredThreadDetail {
    const thread = this.mustFindThreadRecord(threadId);
    const verificationRows = this.db
      .query(
        `SELECT
           id,
           session_id,
           thread_id,
           kind,
           status,
           summary,
           command,
           started_at,
           finished_at
         FROM verification
         WHERE thread_id = ?
         ORDER BY started_at ASC, id ASC`,
      )
      .all(threadId) as StructuredVerificationRow[];
    const workflow = this.findWorkflowRecordByThreadId(threadId);

    return {
      thread,
      verifications: verificationRows.map((row) => this.mapVerificationRow(row)),
      workflow,
    };
  }

  close(): void {
    this.db.close();
  }

  private buildSessionSnapshot(session: StructuredSessionRow): StructuredSessionSnapshot {
    const workspace = this.readWorkspaceRecord();
    const threadRows = this.db
      .query(
        `SELECT
           id,
           session_id,
           kind,
           objective,
           status,
           result_kind,
           result_summary,
           result_body,
           result_created_at,
           blocked_reason,
           blocked_on_kind,
           blocked_on_thread_ids,
           blocked_on_wait_policy,
           blocked_on_reason,
           blocked_on_resume_when,
           blocked_on_since,
           started_at,
           updated_at,
           finished_at
         FROM thread
         WHERE session_id = ?
         ORDER BY started_at ASC, id ASC`,
      )
      .all(session.session_id) as StructuredThreadRow[];
    const verificationRows = this.db
      .query(
        `SELECT
           id,
           session_id,
           thread_id,
           kind,
           status,
           summary,
           command,
           started_at,
           finished_at
         FROM verification
         WHERE session_id = ?
         ORDER BY started_at ASC, id ASC`,
      )
      .all(session.session_id) as StructuredVerificationRow[];
    const workflowRows = this.db
      .query(
        `SELECT
           id,
           session_id,
           thread_id,
           smithers_run_id,
           workflow_name,
           status,
           summary,
           started_at,
           updated_at,
           finished_at
         FROM workflow
         WHERE session_id = ?
         ORDER BY started_at ASC, id ASC`,
      )
      .all(session.session_id) as StructuredWorkflowRow[];
    const eventRows = this.db
      .query(
        `SELECT
           id,
           session_id,
           thread_id,
           kind,
           at
         FROM domain_event
         WHERE session_id = ?
         ORDER BY at ASC, id ASC`,
      )
      .all(session.session_id) as StructuredEventRow[];

    return {
      workspace,
      pi: {
        sessionId: session.session_id,
        title: session.title,
        provider: session.provider ?? undefined,
        model: session.model ?? undefined,
        reasoningEffort: session.reasoning_effort ?? undefined,
        messageCount: session.message_count,
        status: session.pi_status,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      },
      session: {
        waitingOn:
          session.waiting_on_thread_id && session.waiting_reason && session.waiting_resume_when
            ? {
                threadId: session.waiting_on_thread_id,
                reason: session.waiting_reason,
                resumeWhen: session.waiting_resume_when,
                since: session.waiting_since ?? session.updated_at,
              }
            : null,
      },
      threads: threadRows.map((row) => this.mapThreadRow(row)),
      verifications: verificationRows.map((row) => this.mapVerificationRow(row)),
      workflows: workflowRows.map((row) => this.mapWorkflowRow(row)),
      events: eventRows.map((row) => this.mapEventRow(row)),
    };
  }

  private mapThreadRow(row: StructuredThreadRow): StructuredThreadRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      kind: row.kind,
      objective: row.objective,
      status: row.status,
      result:
        row.result_kind && row.result_summary && row.result_body && row.result_created_at
          ? {
              kind: row.result_kind,
              summary: row.result_summary,
              body: row.result_body,
              createdAt: row.result_created_at,
            }
          : null,
      blockedReason: row.blocked_reason,
      blockedOn: this.mapBlockedOnRow(row),
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapVerificationRow(row: StructuredVerificationRow): StructuredVerificationRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      kind: row.kind,
      status: row.status,
      summary: row.summary,
      command: row.command ?? undefined,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }

  private mapWorkflowRow(row: StructuredWorkflowRow): StructuredWorkflowRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      smithersRunId: row.smithers_run_id,
      workflowName: row.workflow_name,
      status: row.status,
      summary: row.summary,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapEventRow(row: StructuredEventRow): StructuredLifecycleEventRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      at: row.at,
      kind: row.kind,
      threadId: row.thread_id ?? undefined,
    };
  }

  private readWorkspaceRecord(): StructuredWorkspaceRecord {
    const row = this.db
      .query(
        `SELECT id, label, cwd
         FROM workspace
         ORDER BY rowid ASC
         LIMIT 1`,
      )
      .get() as StructuredWorkspaceRow | null;

    if (!row) {
      return structuredClone(this.workspaceFallback);
    }

    return {
      id: row.id,
      label: row.label,
      cwd: row.cwd,
    };
  }

  private touchSession(sessionId: string, updatedAt: string): void {
    this.db
      .query(
        `UPDATE session
         SET updated_at = ?
         WHERE session_id = ?`,
      )
      .run(updatedAt, sessionId);
  }

  private appendEvent(
    sessionId: string,
    kind: StructuredLifecycleEventKind,
    threadId: string | undefined,
    at: string,
  ): void {
    this.db
      .query(
        `INSERT INTO domain_event (
          id,
          session_id,
          thread_id,
          kind,
          at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(this.nextId("event"), sessionId, threadId ?? null, kind, at);
  }

  private rebuildIdCounters(): void {
    const idSources: Array<{ prefix: string; table: string }> = [
      { prefix: "thread", table: "thread" },
      { prefix: "verification", table: "verification" },
      { prefix: "workflow", table: "workflow" },
      { prefix: "event", table: "domain_event" },
    ];

    for (const source of idSources) {
      const rows = this.db.query(`SELECT id FROM ${source.table}`).all() as Array<{ id: string }>;
      const pattern = new RegExp(`^${source.prefix}-(\\d+)$`);
      let maxValue = 0;

      for (const row of rows) {
        const match = row.id.match(pattern);
        if (!match) {
          continue;
        }
        const value = Number(match[1]);
        if (Number.isFinite(value)) {
          maxValue = Math.max(maxValue, value);
        }
      }

      this.idCounters.set(source.prefix, maxValue);
    }
  }

  private nextId(prefix: string): string {
    const nextValue = (this.idCounters.get(prefix) ?? 0) + 1;
    this.idCounters.set(prefix, nextValue);
    return `${prefix}-${String(nextValue).padStart(3, "0")}`;
  }

  private getSessionRow(sessionId: string): StructuredSessionRow | null {
    return (
      (this.db
        .query(
          `SELECT
             session_id,
             title,
             provider,
             model,
             reasoning_effort,
             message_count,
             pi_status,
             created_at,
             updated_at,
             waiting_on_thread_id,
             waiting_reason,
             waiting_resume_when,
             waiting_since
           FROM session
           WHERE session_id = ?`,
        )
        .get(sessionId) as StructuredSessionRow | null) ?? null
    );
  }

  private mustFindSession(sessionId: string): StructuredSessionRow {
    const session = this.getSessionRow(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  private getThreadRow(threadId: string): StructuredThreadRow | null {
    return (
      (this.db
        .query(
          `SELECT
             id,
             session_id,
             kind,
             objective,
             status,
             result_kind,
             result_summary,
             result_body,
             result_created_at,
             blocked_reason,
             blocked_on_kind,
             blocked_on_thread_ids,
             blocked_on_wait_policy,
             blocked_on_reason,
             blocked_on_resume_when,
             blocked_on_since,
             started_at,
             updated_at,
             finished_at
           FROM thread
           WHERE id = ?`,
        )
        .get(threadId) as StructuredThreadRow | null) ?? null
    );
  }

  private mustFindThread(threadId: string): StructuredThreadRow {
    const thread = this.getThreadRow(threadId);
    if (!thread) {
      throw new Error(`Unknown thread: ${threadId}`);
    }
    return thread;
  }

  private mustFindThreadRecord(threadId: string): StructuredThreadRecord {
    return this.mapThreadRow(this.mustFindThread(threadId));
  }

  private getVerificationRow(verificationId: string): StructuredVerificationRow | null {
    return (
      (this.db
        .query(
          `SELECT
             id,
             session_id,
             thread_id,
             kind,
             status,
             summary,
             command,
             started_at,
             finished_at
           FROM verification
           WHERE id = ?`,
        )
        .get(verificationId) as StructuredVerificationRow | null) ?? null
    );
  }

  private mustFindVerificationRecord(verificationId: string): StructuredVerificationRecord {
    const verification = this.getVerificationRow(verificationId);
    if (!verification) {
      throw new Error(`Unknown verification: ${verificationId}`);
    }
    return this.mapVerificationRow(verification);
  }

  private getWorkflowRow(workflowId: string): StructuredWorkflowRow | null {
    return (
      (this.db
        .query(
          `SELECT
             id,
             session_id,
             thread_id,
             smithers_run_id,
             workflow_name,
             status,
             summary,
             started_at,
             updated_at,
             finished_at
           FROM workflow
           WHERE id = ?`,
        )
        .get(workflowId) as StructuredWorkflowRow | null) ?? null
    );
  }

  private mustFindWorkflow(workflowId: string): StructuredWorkflowRow {
    const workflow = this.getWorkflowRow(workflowId);
    if (!workflow) {
      throw new Error(`Unknown workflow: ${workflowId}`);
    }
    return workflow;
  }

  private mustFindWorkflowRecord(workflowId: string): StructuredWorkflowRecord {
    return this.mapWorkflowRow(this.mustFindWorkflow(workflowId));
  }

  private findWorkflowByThreadId(threadId: string): StructuredWorkflowRow | null {
    return (
      (this.db
        .query(
          `SELECT
             id,
             session_id,
             thread_id,
             smithers_run_id,
             workflow_name,
             status,
             summary,
             started_at,
             updated_at,
             finished_at
           FROM workflow
           WHERE thread_id = ?`,
        )
        .get(threadId) as StructuredWorkflowRow | null) ?? null
    );
  }

  private findWorkflowRecordByThreadId(threadId: string): StructuredWorkflowRecord | null {
    const workflow = this.findWorkflowByThreadId(threadId);
    return workflow ? this.mapWorkflowRow(workflow) : null;
  }

  private ensureThreadBlockedOnColumns(): void {
    const columnRows = this.db.query(`PRAGMA table_info(thread)`).all() as Array<{ name: string }>;
    const columns = new Set(columnRows.map((row) => row.name));
    const additions: Array<[string, string]> = [
      ["blocked_on_kind", "TEXT"],
      ["blocked_on_thread_ids", "TEXT"],
      ["blocked_on_wait_policy", "TEXT"],
      ["blocked_on_reason", "TEXT"],
      ["blocked_on_resume_when", "TEXT"],
      ["blocked_on_since", "TEXT"],
    ];

    for (const [name, definition] of additions) {
      if (!columns.has(name)) {
        this.db.exec(`ALTER TABLE thread ADD COLUMN ${name} ${definition}`);
      }
    }
  }

  private writeThreadStatus(
    thread: StructuredThreadRow,
    input: {
      status: StructuredThreadStatus;
      blockedReason?: string | null;
      blockedOn?: StructuredThreadBlockedOn | null;
    },
    timestamp: string,
  ): StructuredThreadRecord {
    const blockedReason =
      input.blockedReason === undefined ? thread.blocked_reason : input.blockedReason;
    const blockedOn =
      input.blockedOn === undefined
        ? input.status === "waiting"
          ? this.mapBlockedOnRow(thread)
          : null
        : input.blockedOn;
    const blockedOnValues = this.serializeBlockedOn(blockedOn);
    const finishedAt = isTerminalThreadStatus(input.status) ? timestamp : null;

    this.db
      .query(
        `UPDATE thread
         SET
           status = ?,
           blocked_reason = ?,
           blocked_on_kind = ?,
           blocked_on_thread_ids = ?,
           blocked_on_wait_policy = ?,
           blocked_on_reason = ?,
           blocked_on_resume_when = ?,
           blocked_on_since = ?,
           updated_at = ?,
           finished_at = ?
         WHERE id = ?`,
      )
      .run(
        input.status,
        blockedReason,
        blockedOnValues.kind,
        blockedOnValues.threadIds,
        blockedOnValues.waitPolicy,
        blockedOnValues.reason,
        blockedOnValues.resumeWhen,
        blockedOnValues.since,
        timestamp,
        finishedAt,
        thread.id,
      );

    return this.mustFindThreadRecord(thread.id);
  }

  private serializeBlockedOn(
    blockedOn: StructuredThreadBlockedOn | null,
  ): {
    kind: "threads" | "user" | "external" | null;
    threadIds: string | null;
    waitPolicy: "all" | "any" | null;
    reason: string | null;
    resumeWhen: string | null;
    since: string | null;
  } {
    if (!blockedOn) {
      return {
        kind: null,
        threadIds: null,
        waitPolicy: null,
        reason: null,
        resumeWhen: null,
        since: null,
      };
    }

    if (blockedOn.kind === "threads") {
      return {
        kind: "threads",
        threadIds: JSON.stringify(blockedOn.threadIds),
        waitPolicy: blockedOn.waitPolicy,
        reason: blockedOn.reason,
        resumeWhen: null,
        since: blockedOn.since,
      };
    }

    return {
      kind: blockedOn.kind,
      threadIds: null,
      waitPolicy: null,
      reason: blockedOn.reason,
      resumeWhen: blockedOn.resumeWhen,
      since: blockedOn.since,
    };
  }

  private mapBlockedOnRow(row: StructuredThreadRow): StructuredThreadBlockedOn | null {
    if (row.blocked_on_kind === null) {
      return null;
    }

    if (row.blocked_on_kind === "threads") {
      return {
        kind: "threads",
        threadIds: row.blocked_on_thread_ids ? (JSON.parse(row.blocked_on_thread_ids) as string[]) : [],
        waitPolicy: row.blocked_on_wait_policy ?? "all",
        reason: row.blocked_on_reason ?? "",
        since: row.blocked_on_since ?? row.updated_at,
      };
    }

    return {
      kind: row.blocked_on_kind,
      reason: row.blocked_on_reason ?? "",
      resumeWhen: row.blocked_on_resume_when ?? "",
      since: row.blocked_on_since ?? row.updated_at,
    };
  }
}

export function createStructuredSessionStateStore(
  options: CreateStructuredSessionStateStoreOptions,
): StructuredSessionStateStore {
  return new SqliteStructuredSessionStateStore(options);
}
