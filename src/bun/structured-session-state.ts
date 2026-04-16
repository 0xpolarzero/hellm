import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type StructuredSessionStatus = "idle" | "running" | "waiting" | "error";
export type StructuredTurnStatus = "running" | "waiting" | "completed" | "failed";
export type StructuredThreadKind = "task" | "workflow" | "verification";
export type StructuredThreadStatus = "running" | "waiting" | "completed" | "failed" | "cancelled";
export type StructuredWaitKind = "user" | "external";
export type StructuredCommandExecutor =
  | "orchestrator"
  | "execute_typescript"
  | "runtime"
  | "smithers"
  | "verification";
export type StructuredCommandVisibility = "trace" | "summary" | "surface";
export type StructuredCommandStatus =
  | "requested"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled";
export type StructuredEpisodeKind =
  | "analysis"
  | "change"
  | "verification"
  | "workflow"
  | "clarification";
export type StructuredArtifactKind = "text" | "log" | "json" | "file";
export type StructuredVerificationStatus = "passed" | "failed" | "cancelled";
export type StructuredWorkflowStatus = "running" | "waiting" | "completed" | "failed" | "cancelled";

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

export interface StructuredWaitState {
  kind: StructuredWaitKind;
  reason: string;
  resumeWhen: string;
  since: string;
}

export interface StructuredSessionWaitState extends StructuredWaitState {
  threadId: string;
}

export interface StructuredTurnRecord {
  id: string;
  sessionId: string;
  requestSummary: string;
  status: StructuredTurnStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredThreadRecord {
  id: string;
  sessionId: string;
  turnId: string;
  parentThreadId: string | null;
  kind: StructuredThreadKind;
  title: string;
  objective: string;
  status: StructuredThreadStatus;
  dependsOnThreadIds: string[];
  wait: StructuredWaitState | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredCommandRecord {
  id: string;
  sessionId: string;
  turnId: string;
  threadId: string;
  parentCommandId: string | null;
  toolName: string;
  executor: StructuredCommandExecutor;
  visibility: StructuredCommandVisibility;
  status: StructuredCommandStatus;
  attempts: number;
  title: string;
  summary: string;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredEpisodeRecord {
  id: string;
  sessionId: string;
  threadId: string;
  sourceCommandId: string | null;
  kind: StructuredEpisodeKind;
  title: string;
  summary: string;
  body: string;
  artifactIds: string[];
  createdAt: string;
}

export interface StructuredVerificationRecord {
  id: string;
  sessionId: string;
  threadId: string;
  commandId: string;
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
  commandId: string;
  smithersRunId: string;
  workflowName: string;
  status: StructuredWorkflowStatus;
  summary: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredArtifactRecord {
  id: string;
  sessionId: string;
  episodeId: string | null;
  sourceCommandId: string | null;
  kind: StructuredArtifactKind;
  name: string;
  path?: string;
  content?: string;
  createdAt: string;
}

export type StructuredEventSubjectKind =
  | "session"
  | "turn"
  | "thread"
  | "command"
  | "episode"
  | "verification"
  | "workflow"
  | "artifact";

export interface StructuredLifecycleEventRecord {
  id: string;
  sessionId: string;
  at: string;
  kind: string;
  subject: {
    kind: StructuredEventSubjectKind;
    id: string;
  };
  data?: Record<string, unknown>;
}

export interface StructuredSessionSnapshot {
  workspace: StructuredWorkspaceRecord;
  pi: StructuredPiSessionRecord;
  session: {
    id: string;
    wait: StructuredSessionWaitState | null;
  };
  turns: StructuredTurnRecord[];
  threads: StructuredThreadRecord[];
  commands: StructuredCommandRecord[];
  episodes: StructuredEpisodeRecord[];
  verifications: StructuredVerificationRecord[];
  workflows: StructuredWorkflowRecord[];
  artifacts: StructuredArtifactRecord[];
  events: StructuredLifecycleEventRecord[];
}

export interface StructuredThreadDetail {
  thread: StructuredThreadRecord;
  childThreads: StructuredThreadRecord[];
  commands: StructuredCommandRecord[];
  episodes: StructuredEpisodeRecord[];
  verifications: StructuredVerificationRecord[];
  workflow: StructuredWorkflowRecord | null;
  artifacts: StructuredArtifactRecord[];
}

export interface CreateStructuredSessionStateStoreOptions {
  databasePath?: string;
  now?: () => string;
  workspace: StructuredWorkspaceRecord;
}

export interface StructuredSessionStateStore {
  upsertPiSession(pi: StructuredPiSessionRecord): void;
  startTurn(input: { sessionId: string; requestSummary: string }): StructuredTurnRecord;
  finishTurn(input: {
    turnId: string;
    status: Exclude<StructuredTurnStatus, "running">;
  }): StructuredTurnRecord;
  createThread(input: {
    turnId: string;
    parentThreadId?: string | null;
    kind: StructuredThreadKind;
    title: string;
    objective: string;
  }): StructuredThreadRecord;
  updateThread(input: {
    threadId: string;
    status?: StructuredThreadStatus;
    dependsOnThreadIds?: string[];
    wait?: StructuredWaitState | null;
    title?: string;
    objective?: string;
  }): StructuredThreadRecord;
  setSessionWait(input: {
    sessionId: string;
    threadId: string;
    kind: StructuredWaitKind;
    reason: string;
    resumeWhen: string;
  }): StructuredSessionWaitState;
  clearSessionWait(input: { sessionId: string }): void;
  createCommand(input: {
    turnId: string;
    threadId: string;
    parentCommandId?: string | null;
    toolName: string;
    executor: StructuredCommandExecutor;
    visibility: StructuredCommandVisibility;
    title: string;
    summary: string;
  }): StructuredCommandRecord;
  startCommand(commandId: string): StructuredCommandRecord;
  bumpCommandAttempt(commandId: string): StructuredCommandRecord;
  finishCommand(input: {
    commandId: string;
    status: Exclude<StructuredCommandStatus, "requested" | "running">;
    summary?: string;
    error?: string | null;
  }): StructuredCommandRecord;
  createEpisode(input: {
    threadId: string;
    sourceCommandId?: string | null;
    kind: StructuredEpisodeKind;
    title: string;
    summary: string;
    body: string;
  }): StructuredEpisodeRecord;
  createArtifact(input: {
    episodeId?: string | null;
    sourceCommandId?: string | null;
    kind: StructuredArtifactKind;
    name: string;
    path?: string;
    content?: string;
  }): StructuredArtifactRecord;
  recordVerification(input: {
    threadId: string;
    commandId: string;
    kind: string;
    status: StructuredVerificationStatus;
    summary: string;
    command?: string;
  }): StructuredVerificationRecord;
  recordWorkflow(input: {
    threadId: string;
    commandId: string;
    smithersRunId: string;
    workflowName: string;
    status: StructuredWorkflowStatus;
    summary: string;
  }): StructuredWorkflowRecord;
  updateWorkflow(input: {
    workflowId: string;
    status: StructuredWorkflowStatus;
    summary: string;
  }): StructuredWorkflowRecord;
  getSessionState(sessionId: string): StructuredSessionSnapshot;
  listSessionStates(): StructuredSessionSnapshot[];
  getThreadDetail(threadId: string): StructuredThreadDetail;
  close(): void;
}

interface StructuredWorkspaceRow {
  id: string;
  label: string;
  cwd: string;
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
  wait_thread_id: string | null;
  wait_kind: StructuredWaitKind | null;
  wait_reason: string | null;
  wait_resume_when: string | null;
  wait_since: string | null;
}

interface StructuredTurnRow {
  id: string;
  session_id: string;
  request_summary: string;
  status: StructuredTurnStatus;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface StructuredThreadRow {
  id: string;
  session_id: string;
  turn_id: string;
  parent_thread_id: string | null;
  kind: StructuredThreadKind;
  title: string;
  objective: string;
  status: StructuredThreadStatus;
  depends_on_thread_ids: string;
  wait_kind: StructuredWaitKind | null;
  wait_reason: string | null;
  wait_resume_when: string | null;
  wait_since: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface StructuredCommandRow {
  id: string;
  session_id: string;
  turn_id: string;
  thread_id: string;
  parent_command_id: string | null;
  tool_name: string;
  executor: StructuredCommandExecutor;
  visibility: StructuredCommandVisibility;
  status: StructuredCommandStatus;
  attempts: number;
  title: string;
  summary: string;
  error: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface StructuredEpisodeRow {
  id: string;
  session_id: string;
  thread_id: string;
  source_command_id: string | null;
  kind: StructuredEpisodeKind;
  title: string;
  summary: string;
  body: string;
  created_at: string;
}

interface StructuredVerificationRow {
  id: string;
  session_id: string;
  thread_id: string;
  command_id: string;
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
  command_id: string;
  smithers_run_id: string;
  workflow_name: string;
  status: StructuredWorkflowStatus;
  summary: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface StructuredArtifactRow {
  id: string;
  session_id: string;
  episode_id: string | null;
  source_command_id: string | null;
  kind: StructuredArtifactKind;
  name: string;
  path: string | null;
  content: string | null;
  created_at: string;
}

interface StructuredEventRow {
  id: string;
  session_id: string;
  at: string;
  kind: string;
  subject_kind: StructuredEventSubjectKind;
  subject_id: string;
  data_json: string | null;
}

const DEFAULT_DATABASE_PATH = ":memory:";
const SCHEMA_VERSION = 3;
const ID_COUNTER_TABLES = [
  { table: "turn", column: "id", prefix: "turn" },
  { table: "thread", column: "id", prefix: "thread" },
  { table: "command", column: "id", prefix: "command" },
  { table: "episode", column: "id", prefix: "episode" },
  { table: "verification", column: "id", prefix: "verification" },
  { table: "workflow", column: "id", prefix: "workflow" },
  { table: "artifact", column: "id", prefix: "artifact" },
  { table: "domain_event", column: "id", prefix: "event" },
] as const;

function resolveDatabasePath(databasePath: string | undefined): string {
  return databasePath?.trim() || DEFAULT_DATABASE_PATH;
}

function isTerminalThreadStatus(status: StructuredThreadStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isTerminalWorkflowStatus(status: StructuredWorkflowStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function parseIdList(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function serializeIdList(values: string[]): string {
  return JSON.stringify(values);
}

function parseEventData(value: string | null): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function serializeEventData(data: Record<string, unknown> | undefined): string | null {
  return data ? JSON.stringify(data) : null;
}

function mapWait(
  row: Pick<StructuredThreadRow, "wait_kind" | "wait_reason" | "wait_resume_when" | "wait_since">,
): StructuredWaitState | null {
  if (!row.wait_kind || !row.wait_reason || !row.wait_resume_when || !row.wait_since) {
    return null;
  }

  return {
    kind: row.wait_kind,
    reason: row.wait_reason,
    resumeWhen: row.wait_resume_when,
    since: row.wait_since,
  };
}

function mapSessionWait(row: StructuredSessionRow): StructuredSessionWaitState | null {
  if (
    !row.wait_thread_id ||
    !row.wait_kind ||
    !row.wait_reason ||
    !row.wait_resume_when ||
    !row.wait_since
  ) {
    return null;
  }

  return {
    threadId: row.wait_thread_id,
    kind: row.wait_kind,
    reason: row.wait_reason,
    resumeWhen: row.wait_resume_when,
    since: row.wait_since,
  };
}

function summarizeText(value: string, fallback: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed || fallback;
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
    this.ensureSchema();
    this.upsertWorkspace(options.workspace);
    this.rebuildIdCounters();
    this.reconcileSessionWaitInvariants();
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
            wait_thread_id,
            wait_kind,
            wait_reason,
            wait_resume_when,
            wait_since
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)`,
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

  startTurn(input: { sessionId: string; requestSummary: string }): StructuredTurnRecord {
    this.mustFindSession(input.sessionId);
    const timestamp = this.now();
    const turnId = this.nextId("turn");

    this.db
      .query(
        `INSERT INTO turn (
          id,
          session_id,
          request_summary,
          status,
          started_at,
          updated_at,
          finished_at
        ) VALUES (?, ?, ?, 'running', ?, ?, NULL)`,
      )
      .run(
        turnId,
        input.sessionId,
        summarizeText(input.requestSummary, "New turn"),
        timestamp,
        timestamp,
      );

    this.touchSession(input.sessionId, timestamp);
    this.appendEvent(
      input.sessionId,
      "turn.started",
      { kind: "turn", id: turnId },
      {
        requestSummary: summarizeText(input.requestSummary, "New turn"),
      },
    );

    return this.mustFindTurnRecord(turnId);
  }

  finishTurn(input: {
    turnId: string;
    status: Exclude<StructuredTurnStatus, "running">;
  }): StructuredTurnRecord {
    const turn = this.mustFindTurn(input.turnId);
    const timestamp = this.now();

    this.db
      .query(
        `UPDATE turn
         SET
           status = ?,
           updated_at = ?,
           finished_at = ?
         WHERE id = ?`,
      )
      .run(input.status, timestamp, timestamp, input.turnId);

    this.touchSession(turn.session_id, timestamp);
    this.appendEvent(
      turn.session_id,
      input.status === "waiting"
        ? "turn.waiting"
        : input.status === "failed"
          ? "turn.failed"
          : "turn.completed",
      { kind: "turn", id: input.turnId },
    );

    return this.mustFindTurnRecord(input.turnId);
  }

  createThread(input: {
    turnId: string;
    parentThreadId?: string | null;
    kind: StructuredThreadKind;
    title: string;
    objective: string;
  }): StructuredThreadRecord {
    const turn = this.mustFindTurn(input.turnId);
    if (input.parentThreadId) {
      const parent = this.mustFindThread(input.parentThreadId);
      if (parent.session_id !== turn.session_id) {
        throw new Error(
          `Parent thread ${input.parentThreadId} does not belong to turn session ${turn.session_id}.`,
        );
      }
    }

    const timestamp = this.now();
    const threadId = this.nextId("thread");

    this.db
      .query(
        `INSERT INTO thread (
          id,
          session_id,
          turn_id,
          parent_thread_id,
          kind,
          title,
          objective,
          status,
          depends_on_thread_ids,
          wait_kind,
          wait_reason,
          wait_resume_when,
          wait_since,
          started_at,
          updated_at,
          finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', '[]', NULL, NULL, NULL, NULL, ?, ?, NULL)`,
      )
      .run(
        threadId,
        turn.session_id,
        input.turnId,
        input.parentThreadId ?? null,
        input.kind,
        summarizeText(input.title, input.kind),
        summarizeText(input.objective, input.kind),
        timestamp,
        timestamp,
      );

    this.touchSession(turn.session_id, timestamp);
    this.appendEvent(
      turn.session_id,
      "thread.created",
      { kind: "thread", id: threadId },
      {
        turnId: input.turnId,
        kind: input.kind,
        parentThreadId: input.parentThreadId ?? null,
      },
    );
    this.clearSessionWaitWhenRunnableWorkExists(turn.session_id, timestamp);

    return this.mustFindThreadRecord(threadId);
  }

  updateThread(input: {
    threadId: string;
    status?: StructuredThreadStatus;
    dependsOnThreadIds?: string[];
    wait?: StructuredWaitState | null;
    title?: string;
    objective?: string;
  }): StructuredThreadRecord {
    const thread = this.mustFindThread(input.threadId);
    const timestamp = this.now();
    const nextStatus = input.status ?? thread.status;
    const nextDependsOn =
      input.dependsOnThreadIds === undefined
        ? parseIdList(thread.depends_on_thread_ids)
        : [...new Set(input.dependsOnThreadIds.map((value) => value.trim()).filter(Boolean))];
    const nextWait = input.wait === undefined ? mapWait(thread) : input.wait;
    const nextTitle =
      input.title === undefined ? thread.title : summarizeText(input.title, thread.title);
    const nextObjective =
      input.objective === undefined
        ? thread.objective
        : summarizeText(input.objective, thread.objective);

    for (const dependencyId of nextDependsOn) {
      if (dependencyId === thread.id) {
        throw new Error(`Thread ${thread.id} cannot depend on itself.`);
      }
      const dependency = this.mustFindThread(dependencyId);
      if (dependency.session_id !== thread.session_id) {
        throw new Error(
          `Dependency thread ${dependencyId} does not belong to session ${thread.session_id}.`,
        );
      }
    }

    if (nextWait && nextDependsOn.length > 0) {
      throw new Error(
        `Thread ${thread.id} cannot wait on dependencies and user or external input at the same time.`,
      );
    }

    if (nextStatus === "waiting" && nextDependsOn.length === 0 && !nextWait) {
      throw new Error(
        `Waiting threads require either dependencies or thread wait details: ${thread.id}`,
      );
    }

    const shouldClearWaitState = nextStatus !== "waiting";
    const dependsOn = shouldClearWaitState ? [] : nextDependsOn;
    const wait = shouldClearWaitState ? null : nextWait;
    const finishedAt = isTerminalThreadStatus(nextStatus) ? timestamp : null;

    this.db
      .query(
        `UPDATE thread
         SET
           title = ?,
           objective = ?,
           status = ?,
           depends_on_thread_ids = ?,
           wait_kind = ?,
           wait_reason = ?,
           wait_resume_when = ?,
           wait_since = ?,
           updated_at = ?,
           finished_at = ?
         WHERE id = ?`,
      )
      .run(
        nextTitle,
        nextObjective,
        nextStatus,
        serializeIdList(dependsOn),
        wait?.kind ?? null,
        wait?.reason ?? null,
        wait?.resumeWhen ?? null,
        wait?.since ?? null,
        timestamp,
        finishedAt,
        input.threadId,
      );

    if (shouldClearWaitState) {
      this.clearSessionWaitForThread(thread.session_id, thread.id, timestamp);
    }

    this.touchSession(thread.session_id, timestamp);
    this.appendEvent(
      thread.session_id,
      isTerminalThreadStatus(nextStatus) ? "thread.finished" : "thread.updated",
      { kind: "thread", id: thread.id },
      {
        status: nextStatus,
        dependsOnThreadIds: dependsOn,
        wait,
      },
    );
    this.clearSessionWaitWhenRunnableWorkExists(thread.session_id, timestamp);

    return this.mustFindThreadRecord(thread.id);
  }

  setSessionWait(input: {
    sessionId: string;
    threadId: string;
    kind: StructuredWaitKind;
    reason: string;
    resumeWhen: string;
  }): StructuredSessionWaitState {
    this.mustFindSession(input.sessionId);
    const thread = this.mustFindThread(input.threadId);
    if (thread.session_id !== input.sessionId) {
      throw new Error(`Thread ${thread.id} does not belong to session ${input.sessionId}.`);
    }

    const threadWait = mapWait(thread);
    if (thread.status !== "waiting" || !threadWait) {
      throw new Error(
        `Session wait requires a waiting thread with thread wait details: ${thread.id}`,
      );
    }
    if (
      threadWait.kind !== input.kind ||
      threadWait.reason !== input.reason ||
      threadWait.resumeWhen !== input.resumeWhen
    ) {
      throw new Error(`Session wait must match the owning thread wait details: ${thread.id}`);
    }
    if (this.hasRunnableWorkRemaining(input.sessionId, input.threadId)) {
      throw new Error(`Session ${input.sessionId} still has runnable work and cannot enter wait.`);
    }

    const timestamp = this.now();
    this.db
      .query(
        `UPDATE session
         SET
           wait_thread_id = ?,
           wait_kind = ?,
           wait_reason = ?,
           wait_resume_when = ?,
           wait_since = ?
         WHERE session_id = ?`,
      )
      .run(input.threadId, input.kind, input.reason, input.resumeWhen, timestamp, input.sessionId);

    this.touchSession(input.sessionId, timestamp);
    this.appendEvent(
      input.sessionId,
      "session.wait.started",
      { kind: "session", id: input.sessionId },
      {
        threadId: input.threadId,
        kind: input.kind,
        reason: input.reason,
        resumeWhen: input.resumeWhen,
        since: timestamp,
      },
    );

    return {
      threadId: input.threadId,
      kind: input.kind,
      reason: input.reason,
      resumeWhen: input.resumeWhen,
      since: timestamp,
    };
  }

  clearSessionWait(input: { sessionId: string }): void {
    const session = this.mustFindSession(input.sessionId);
    if (!session.wait_thread_id) {
      return;
    }

    const timestamp = this.now();
    this.clearSessionWaitForThread(input.sessionId, session.wait_thread_id, timestamp);
  }

  createCommand(input: {
    turnId: string;
    threadId: string;
    parentCommandId?: string | null;
    toolName: string;
    executor: StructuredCommandExecutor;
    visibility: StructuredCommandVisibility;
    title: string;
    summary: string;
  }): StructuredCommandRecord {
    const turn = this.mustFindTurn(input.turnId);
    const thread = this.mustFindThread(input.threadId);
    if (thread.turn_id !== turn.id || thread.session_id !== turn.session_id) {
      throw new Error(`Thread ${thread.id} does not belong to turn ${turn.id}.`);
    }
    if (input.parentCommandId) {
      const parent = this.mustFindCommand(input.parentCommandId);
      if (parent.session_id !== turn.session_id) {
        throw new Error(
          `Parent command ${input.parentCommandId} does not belong to session ${turn.session_id}.`,
        );
      }
    }

    const timestamp = this.now();
    const commandId = this.nextId("command");

    this.db
      .query(
        `INSERT INTO command (
          id,
          session_id,
          turn_id,
          thread_id,
          parent_command_id,
          tool_name,
          executor,
          visibility,
          status,
          attempts,
          title,
          summary,
          error,
          started_at,
          updated_at,
          finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'requested', 1, ?, ?, NULL, ?, ?, NULL)`,
      )
      .run(
        commandId,
        turn.session_id,
        input.turnId,
        input.threadId,
        input.parentCommandId ?? null,
        input.toolName,
        input.executor,
        input.visibility,
        summarizeText(input.title, input.toolName),
        summarizeText(input.summary, input.toolName),
        timestamp,
        timestamp,
      );

    this.touchSession(turn.session_id, timestamp);
    this.appendEvent(
      turn.session_id,
      "command.requested",
      { kind: "command", id: commandId },
      {
        toolName: input.toolName,
        threadId: input.threadId,
        parentCommandId: input.parentCommandId ?? null,
      },
    );

    return this.mustFindCommandRecord(commandId);
  }

  startCommand(commandId: string): StructuredCommandRecord {
    const command = this.mustFindCommand(commandId);
    const timestamp = this.now();

    this.db
      .query(
        `UPDATE command
         SET
           status = 'running',
           updated_at = ?
         WHERE id = ?`,
      )
      .run(timestamp, commandId);

    this.touchSession(command.session_id, timestamp);
    this.appendEvent(
      command.session_id,
      "command.started",
      { kind: "command", id: commandId },
      {
        toolName: command.tool_name,
      },
    );

    return this.mustFindCommandRecord(commandId);
  }

  bumpCommandAttempt(commandId: string): StructuredCommandRecord {
    const command = this.mustFindCommand(commandId);
    const timestamp = this.now();

    this.db
      .query(
        `UPDATE command
         SET
           attempts = attempts + 1,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(timestamp, commandId);

    this.touchSession(command.session_id, timestamp);
    this.appendEvent(
      command.session_id,
      "command.retry",
      { kind: "command", id: commandId },
      {
        attempts: command.attempts + 1,
      },
    );

    return this.mustFindCommandRecord(commandId);
  }

  finishCommand(input: {
    commandId: string;
    status: Exclude<StructuredCommandStatus, "requested" | "running">;
    summary?: string;
    error?: string | null;
  }): StructuredCommandRecord {
    const command = this.mustFindCommand(input.commandId);
    const timestamp = this.now();

    this.db
      .query(
        `UPDATE command
         SET
           status = ?,
           summary = ?,
           error = ?,
           updated_at = ?,
           finished_at = ?
         WHERE id = ?`,
      )
      .run(
        input.status,
        input.summary ? summarizeText(input.summary, command.summary) : command.summary,
        input.error ?? null,
        timestamp,
        input.status === "waiting" ? null : timestamp,
        input.commandId,
      );

    this.touchSession(command.session_id, timestamp);
    this.appendEvent(
      command.session_id,
      input.status === "waiting" ? "command.waiting" : "command.finished",
      { kind: "command", id: input.commandId },
      {
        status: input.status,
        error: input.error ?? null,
      },
    );

    return this.mustFindCommandRecord(input.commandId);
  }

  createEpisode(input: {
    threadId: string;
    sourceCommandId?: string | null;
    kind: StructuredEpisodeKind;
    title: string;
    summary: string;
    body: string;
  }): StructuredEpisodeRecord {
    const thread = this.mustFindThread(input.threadId);
    if (input.sourceCommandId) {
      const command = this.mustFindCommand(input.sourceCommandId);
      if (command.session_id !== thread.session_id) {
        throw new Error(
          `Command ${input.sourceCommandId} does not belong to session ${thread.session_id}.`,
        );
      }
    }

    const timestamp = this.now();
    const episodeId = this.nextId("episode");

    this.db
      .query(
        `INSERT INTO episode (
          id,
          session_id,
          thread_id,
          source_command_id,
          kind,
          title,
          summary,
          body,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        episodeId,
        thread.session_id,
        thread.id,
        input.sourceCommandId ?? null,
        input.kind,
        summarizeText(input.title, input.kind),
        summarizeText(input.summary, input.kind),
        input.body.trim(),
        timestamp,
      );

    this.touchSession(thread.session_id, timestamp);
    this.appendEvent(
      thread.session_id,
      "episode.created",
      { kind: "episode", id: episodeId },
      {
        threadId: thread.id,
        kind: input.kind,
      },
    );

    return this.mustFindEpisodeRecord(episodeId);
  }

  createArtifact(input: {
    episodeId?: string | null;
    sourceCommandId?: string | null;
    kind: StructuredArtifactKind;
    name: string;
    path?: string;
    content?: string;
  }): StructuredArtifactRecord {
    const episode = input.episodeId ? this.mustFindEpisode(input.episodeId) : null;
    const command = input.sourceCommandId ? this.mustFindCommand(input.sourceCommandId) : null;
    if (!episode && !command) {
      throw new Error("Artifacts require an episode, a source command, or both.");
    }
    if (episode && command && episode.session_id !== command.session_id) {
      throw new Error(
        `Episode ${episode.id} and command ${command.id} must belong to the same session.`,
      );
    }

    const sessionId = episode?.session_id ?? command?.session_id;
    if (!sessionId) {
      throw new Error("Unable to resolve session for artifact.");
    }
    const timestamp = this.now();
    const artifactId = this.nextId("artifact");

    this.db
      .query(
        `INSERT INTO artifact (
          id,
          session_id,
          episode_id,
          source_command_id,
          kind,
          name,
          path,
          content,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifactId,
        sessionId,
        input.episodeId ?? null,
        input.sourceCommandId ?? null,
        input.kind,
        summarizeText(input.name, input.kind),
        input.path ?? null,
        input.content ?? null,
        timestamp,
      );

    this.touchSession(sessionId, timestamp);
    this.appendEvent(
      sessionId,
      "artifact.created",
      { kind: "artifact", id: artifactId },
      {
        episodeId: input.episodeId ?? null,
        sourceCommandId: input.sourceCommandId ?? null,
        kind: input.kind,
      },
    );

    return this.mustFindArtifactRecord(artifactId);
  }

  recordVerification(input: {
    threadId: string;
    commandId: string;
    kind: string;
    status: StructuredVerificationStatus;
    summary: string;
    command?: string;
  }): StructuredVerificationRecord {
    const thread = this.mustFindThread(input.threadId);
    const command = this.mustFindCommand(input.commandId);
    if (thread.kind !== "verification") {
      throw new Error(`Verification records require verification threads: ${thread.id}`);
    }
    if (command.thread_id !== thread.id) {
      throw new Error(`Command ${command.id} does not belong to verification thread ${thread.id}.`);
    }

    const timestamp = this.now();
    const verificationId = this.nextId("verification");

    this.db
      .query(
        `INSERT INTO verification (
          id,
          session_id,
          thread_id,
          command_id,
          kind,
          status,
          summary,
          command,
          started_at,
          finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        verificationId,
        thread.session_id,
        thread.id,
        command.id,
        input.kind,
        input.status,
        summarizeText(input.summary, input.kind),
        input.command ?? null,
        timestamp,
        timestamp,
      );

    this.touchSession(thread.session_id, timestamp);
    this.appendEvent(
      thread.session_id,
      "verification.recorded",
      { kind: "verification", id: verificationId },
      {
        threadId: thread.id,
        status: input.status,
      },
    );

    return this.mustFindVerificationRecord(verificationId);
  }

  recordWorkflow(input: {
    threadId: string;
    commandId: string;
    smithersRunId: string;
    workflowName: string;
    status: StructuredWorkflowStatus;
    summary: string;
  }): StructuredWorkflowRecord {
    const thread = this.mustFindThread(input.threadId);
    const command = this.mustFindCommand(input.commandId);
    if (thread.kind !== "workflow") {
      throw new Error(`Workflow records require workflow threads: ${thread.id}`);
    }
    if (command.thread_id !== thread.id) {
      throw new Error(`Command ${command.id} does not belong to workflow thread ${thread.id}.`);
    }
    if (this.findWorkflowByThreadId(thread.id)) {
      throw new Error(`Thread ${thread.id} already has a workflow record.`);
    }

    const timestamp = this.now();
    const workflowId = this.nextId("workflow");

    this.db
      .query(
        `INSERT INTO workflow (
          id,
          session_id,
          thread_id,
          command_id,
          smithers_run_id,
          workflow_name,
          status,
          summary,
          started_at,
          updated_at,
          finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workflowId,
        thread.session_id,
        thread.id,
        command.id,
        input.smithersRunId,
        input.workflowName,
        input.status,
        summarizeText(input.summary, input.workflowName),
        timestamp,
        timestamp,
        isTerminalWorkflowStatus(input.status) ? timestamp : null,
      );

    this.touchSession(thread.session_id, timestamp);
    this.appendEvent(
      thread.session_id,
      "workflow.recorded",
      { kind: "workflow", id: workflowId },
      {
        threadId: thread.id,
        status: input.status,
        smithersRunId: input.smithersRunId,
      },
    );

    return this.mustFindWorkflowRecord(workflowId);
  }

  updateWorkflow(input: {
    workflowId: string;
    status: StructuredWorkflowStatus;
    summary: string;
  }): StructuredWorkflowRecord {
    const workflow = this.mustFindWorkflow(input.workflowId);
    const timestamp = this.now();

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
      .run(
        input.status,
        summarizeText(input.summary, workflow.summary),
        timestamp,
        isTerminalWorkflowStatus(input.status) ? timestamp : null,
        input.workflowId,
      );

    this.touchSession(workflow.session_id, timestamp);
    this.appendEvent(
      workflow.session_id,
      "workflow.updated",
      { kind: "workflow", id: workflow.id },
      {
        status: input.status,
        summary: input.summary,
      },
    );

    return this.mustFindWorkflowRecord(input.workflowId);
  }

  getSessionState(sessionId: string): StructuredSessionSnapshot {
    const session = this.mustFindSession(sessionId);
    const workspace = this.getWorkspaceRecord();
    const turns = this.listTurnRows(sessionId).map((row) => this.mapTurnRow(row));
    const threads = this.listThreadRows(sessionId).map((row) => this.mapThreadRow(row));
    const commands = this.listCommandRows(sessionId).map((row) => this.mapCommandRow(row));
    const artifacts = this.listArtifactRows(sessionId).map((row) => this.mapArtifactRow(row));
    const artifactIdsByEpisodeId = new Map<string, string[]>();

    for (const artifact of artifacts) {
      if (!artifact.episodeId) {
        continue;
      }
      const ids = artifactIdsByEpisodeId.get(artifact.episodeId) ?? [];
      ids.push(artifact.id);
      artifactIdsByEpisodeId.set(artifact.episodeId, ids);
    }

    return {
      workspace,
      pi: this.mapPiSessionRow(session),
      session: {
        id: session.session_id,
        wait: mapSessionWait(session),
      },
      turns,
      threads,
      commands,
      episodes: this.listEpisodeRows(sessionId).map((row) =>
        this.mapEpisodeRow(row, artifactIdsByEpisodeId.get(row.id) ?? []),
      ),
      verifications: this.listVerificationRows(sessionId).map((row) =>
        this.mapVerificationRow(row),
      ),
      workflows: this.listWorkflowRows(sessionId).map((row) => this.mapWorkflowRow(row)),
      artifacts,
      events: this.listEventRows(sessionId).map((row) => this.mapEventRow(row)),
    };
  }

  listSessionStates(): StructuredSessionSnapshot[] {
    return (
      this.db
        .query(`SELECT session_id FROM session ORDER BY updated_at DESC, created_at DESC`)
        .all() as Array<{ session_id: string }>
    ).map((row) => this.getSessionState(row.session_id));
  }

  getThreadDetail(threadId: string): StructuredThreadDetail {
    const thread = this.mustFindThreadRecord(threadId);
    const session = this.getSessionState(thread.sessionId);
    const episodes = session.episodes.filter((episode) => episode.threadId === threadId);
    const episodeIds = new Set(episodes.map((episode) => episode.id));
    const commandIds = new Set(
      session.commands
        .filter((command) => command.threadId === threadId)
        .map((command) => command.id),
    );

    return {
      thread,
      childThreads: session.threads.filter((candidate) => candidate.parentThreadId === threadId),
      commands: session.commands.filter((command) => command.threadId === threadId),
      episodes,
      verifications: session.verifications.filter(
        (verification) => verification.threadId === threadId,
      ),
      workflow: session.workflows.find((workflow) => workflow.threadId === threadId) ?? null,
      artifacts: session.artifacts.filter(
        (artifact) =>
          (artifact.episodeId ? episodeIds.has(artifact.episodeId) : false) ||
          (artifact.sourceCommandId ? commandIds.has(artifact.sourceCommandId) : false),
      ),
    };
  }

  close(): void {
    this.db.close();
  }

  private ensureSchema(): void {
    const currentVersion =
      ((this.db.query("PRAGMA user_version").get() as { user_version?: number } | null)
        ?.user_version as number | undefined) ?? 0;

    if (currentVersion === SCHEMA_VERSION) {
      return;
    }

    this.db.exec("PRAGMA foreign_keys = OFF;");
    if (currentVersion === 2) {
      this.migrateSchemaFromV2ToV3();
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
      this.db.exec("PRAGMA foreign_keys = ON;");
      return;
    }
    this.db.exec(`
      DROP TABLE IF EXISTS domain_event;
      DROP TABLE IF EXISTS artifact;
      DROP TABLE IF EXISTS episode;
      DROP TABLE IF EXISTS workflow;
      DROP TABLE IF EXISTS verification;
      DROP TABLE IF EXISTS command;
      DROP TABLE IF EXISTS thread;
      DROP TABLE IF EXISTS turn;
      DROP TABLE IF EXISTS session;
      DROP TABLE IF EXISTS workspace;
    `);
    this.db.exec(`
      CREATE TABLE workspace (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        cwd TEXT NOT NULL
      );

      CREATE TABLE session (
        session_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        reasoning_effort TEXT,
        message_count INTEGER NOT NULL,
        pi_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        wait_thread_id TEXT,
        wait_kind TEXT,
        wait_reason TEXT,
        wait_resume_when TEXT,
        wait_since TEXT
      );

      CREATE TABLE turn (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        request_summary TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY(session_id) REFERENCES session(session_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_turn_session ON turn(session_id);

      CREATE TABLE thread (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        parent_thread_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        depends_on_thread_ids TEXT NOT NULL,
        wait_kind TEXT,
        wait_reason TEXT,
        wait_resume_when TEXT,
        wait_since TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY(session_id) REFERENCES session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(turn_id) REFERENCES turn(id) ON DELETE CASCADE,
        FOREIGN KEY(parent_thread_id) REFERENCES thread(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_thread_session ON thread(session_id);
      CREATE INDEX idx_thread_turn ON thread(turn_id);

      CREATE TABLE command (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        parent_command_id TEXT,
        tool_name TEXT NOT NULL,
        executor TEXT NOT NULL,
        visibility TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY(session_id) REFERENCES session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(turn_id) REFERENCES turn(id) ON DELETE CASCADE,
        FOREIGN KEY(thread_id) REFERENCES thread(id) ON DELETE CASCADE,
        FOREIGN KEY(parent_command_id) REFERENCES command(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_command_session ON command(session_id);
      CREATE INDEX idx_command_thread ON command(thread_id);

      CREATE TABLE episode (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        source_command_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(thread_id) REFERENCES thread(id) ON DELETE CASCADE,
        FOREIGN KEY(source_command_id) REFERENCES command(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_episode_session ON episode(session_id);
      CREATE INDEX idx_episode_thread ON episode(thread_id);

      CREATE TABLE artifact (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        episode_id TEXT,
        source_command_id TEXT,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT,
        content TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(episode_id) REFERENCES episode(id) ON DELETE SET NULL,
        FOREIGN KEY(source_command_id) REFERENCES command(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_artifact_session ON artifact(session_id);
      CREATE INDEX idx_artifact_episode ON artifact(episode_id);
      CREATE INDEX idx_artifact_source_command ON artifact(source_command_id);

      CREATE TABLE verification (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        command TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(thread_id) REFERENCES thread(id) ON DELETE CASCADE,
        FOREIGN KEY(command_id) REFERENCES command(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_verification_session ON verification(session_id);
      CREATE INDEX idx_verification_thread ON verification(thread_id);

      CREATE TABLE workflow (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        thread_id TEXT NOT NULL UNIQUE,
        command_id TEXT NOT NULL,
        smithers_run_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY(session_id) REFERENCES session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(thread_id) REFERENCES thread(id) ON DELETE CASCADE,
        FOREIGN KEY(command_id) REFERENCES command(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_workflow_session ON workflow(session_id);
      CREATE INDEX idx_workflow_run_id ON workflow(smithers_run_id);

      CREATE TABLE domain_event (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        data_json TEXT,
        FOREIGN KEY(session_id) REFERENCES session(session_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_domain_event_session ON domain_event(session_id);
    `);
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  private migrateSchemaFromV2ToV3(): void {
    this.db.exec(`
      ALTER TABLE artifact RENAME TO artifact_v2;

      CREATE TABLE artifact (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        episode_id TEXT,
        source_command_id TEXT,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT,
        content TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES session(session_id) ON DELETE CASCADE,
        FOREIGN KEY(episode_id) REFERENCES episode(id) ON DELETE SET NULL,
        FOREIGN KEY(source_command_id) REFERENCES command(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_artifact_session ON artifact(session_id);
      CREATE INDEX idx_artifact_episode ON artifact(episode_id);
      CREATE INDEX idx_artifact_source_command ON artifact(source_command_id);

      INSERT INTO artifact (
        id,
        session_id,
        episode_id,
        source_command_id,
        kind,
        name,
        path,
        content,
        created_at
      )
      SELECT
        id,
        session_id,
        episode_id,
        NULL,
        kind,
        name,
        path,
        content,
        created_at
      FROM artifact_v2;

      DROP TABLE artifact_v2;
    `);
  }

  private upsertWorkspace(workspace: StructuredWorkspaceRecord): void {
    this.db
      .query(
        `INSERT INTO workspace (id, label, cwd)
         VALUES (?, ?, ?)
         ON CONFLICT(id)
         DO UPDATE SET
           label = excluded.label,
           cwd = excluded.cwd`,
      )
      .run(workspace.id, workspace.label, workspace.cwd);
  }

  private rebuildIdCounters(): void {
    for (const entry of ID_COUNTER_TABLES) {
      const rows = this.db
        .query(`SELECT ${entry.column} AS id FROM ${entry.table}`)
        .all() as Array<{ id: string }>;
      let highest = 0;

      for (const row of rows) {
        const match = new RegExp(`^${entry.prefix}-(\\d+)$`).exec(row.id);
        if (!match) {
          continue;
        }
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > highest) {
          highest = value;
        }
      }

      this.idCounters.set(entry.prefix, highest);
    }
  }

  private nextId(prefix: string): string {
    const next = (this.idCounters.get(prefix) ?? 0) + 1;
    this.idCounters.set(prefix, next);
    return `${prefix}-${next}`;
  }

  private touchSession(sessionId: string, at: string): void {
    this.db
      .query(
        `UPDATE session
         SET updated_at = ?
         WHERE session_id = ?`,
      )
      .run(at, sessionId);
  }

  private appendEvent(
    sessionId: string,
    kind: string,
    subject: StructuredLifecycleEventRecord["subject"],
    data?: Record<string, unknown>,
  ): void {
    this.db
      .query(
        `INSERT INTO domain_event (
          id,
          session_id,
          at,
          kind,
          subject_kind,
          subject_id,
          data_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.nextId("event"),
        sessionId,
        this.now(),
        kind,
        subject.kind,
        subject.id,
        serializeEventData(data),
      );
  }

  private clearSessionWaitForThread(sessionId: string, threadId: string, at: string): void {
    const session = this.getSessionRow(sessionId);
    if (!session || session.wait_thread_id !== threadId) {
      return;
    }

    this.db
      .query(
        `UPDATE session
         SET
           wait_thread_id = NULL,
           wait_kind = NULL,
           wait_reason = NULL,
           wait_resume_when = NULL,
           wait_since = NULL
         WHERE session_id = ?`,
      )
      .run(sessionId);

    this.touchSession(sessionId, at);
    this.appendEvent(
      sessionId,
      "session.wait.cleared",
      { kind: "session", id: sessionId },
      {
        threadId,
      },
    );
  }

  private clearSessionWaitWhenRunnableWorkExists(sessionId: string, at: string): void {
    const session = this.getSessionRow(sessionId);
    if (!session?.wait_thread_id) {
      return;
    }
    if (!this.hasRunnableWorkRemaining(sessionId)) {
      return;
    }

    this.clearSessionWaitForThread(sessionId, session.wait_thread_id, at);
  }

  private hasRunnableWorkRemaining(sessionId: string, excludeThreadId?: string): boolean {
    const rows = this.listThreadRows(sessionId);
    return rows.some(
      (thread) =>
        thread.status === "running" &&
        (excludeThreadId === undefined || thread.id !== excludeThreadId),
    );
  }

  private reconcileSessionWaitInvariants(): void {
    const sessions = this.db
      .query(
        `SELECT session_id
         FROM session
         WHERE wait_thread_id IS NOT NULL`,
      )
      .all() as Array<{ session_id: string }>;

    for (const session of sessions) {
      this.reconcileSessionWaitInvariant(session.session_id, this.now());
    }
  }

  private reconcileSessionWaitInvariant(sessionId: string, at: string): void {
    const session = this.getSessionRow(sessionId);
    if (!session?.wait_thread_id) {
      return;
    }

    const owner = this.getThreadRow(session.wait_thread_id);
    const sessionWait = mapSessionWait(session);
    const ownerWait = owner ? mapWait(owner) : null;
    const invalidOwner =
      !owner ||
      owner.session_id !== sessionId ||
      owner.status !== "waiting" ||
      !sessionWait ||
      !ownerWait ||
      ownerWait.kind !== sessionWait.kind ||
      ownerWait.reason !== sessionWait.reason ||
      ownerWait.resumeWhen !== sessionWait.resumeWhen;
    if (invalidOwner || this.hasRunnableWorkRemaining(sessionId, session.wait_thread_id)) {
      this.clearSessionWaitForThread(sessionId, session.wait_thread_id, at);
    }
  }

  private getWorkspaceRecord(): StructuredWorkspaceRecord {
    const row = this.db
      .query(`SELECT id, label, cwd FROM workspace LIMIT 1`)
      .get() as StructuredWorkspaceRow | null;

    return row
      ? {
          id: row.id,
          label: row.label,
          cwd: row.cwd,
        }
      : structuredClone(this.workspaceFallback);
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
           wait_thread_id,
           wait_kind,
           wait_reason,
           wait_resume_when,
           wait_since
         FROM session
         WHERE session_id = ?
         LIMIT 1`,
        )
        .get(sessionId) as StructuredSessionRow | null) ?? null
    );
  }

  private mustFindSession(sessionId: string): StructuredSessionRow {
    const row = this.getSessionRow(sessionId);
    if (!row) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return row;
  }

  private getTurnRow(turnId: string): StructuredTurnRow | null {
    return (
      (this.db
        .query(
          `SELECT
           id,
           session_id,
           request_summary,
           status,
           started_at,
           updated_at,
           finished_at
         FROM turn
         WHERE id = ?
         LIMIT 1`,
        )
        .get(turnId) as StructuredTurnRow | null) ?? null
    );
  }

  private mustFindTurn(turnId: string): StructuredTurnRow {
    const row = this.getTurnRow(turnId);
    if (!row) {
      throw new Error(`Unknown turn: ${turnId}`);
    }
    return row;
  }

  private getThreadRow(threadId: string): StructuredThreadRow | null {
    return (
      (this.db
        .query(
          `SELECT
           id,
           session_id,
           turn_id,
           parent_thread_id,
           kind,
           title,
           objective,
           status,
           depends_on_thread_ids,
           wait_kind,
           wait_reason,
           wait_resume_when,
           wait_since,
           started_at,
           updated_at,
           finished_at
         FROM thread
         WHERE id = ?
         LIMIT 1`,
        )
        .get(threadId) as StructuredThreadRow | null) ?? null
    );
  }

  private mustFindThread(threadId: string): StructuredThreadRow {
    const row = this.getThreadRow(threadId);
    if (!row) {
      throw new Error(`Unknown thread: ${threadId}`);
    }
    return row;
  }

  private getCommandRow(commandId: string): StructuredCommandRow | null {
    return (
      (this.db
        .query(
          `SELECT
           id,
           session_id,
           turn_id,
           thread_id,
           parent_command_id,
           tool_name,
           executor,
           visibility,
           status,
           attempts,
           title,
           summary,
           error,
           started_at,
           updated_at,
           finished_at
         FROM command
         WHERE id = ?
         LIMIT 1`,
        )
        .get(commandId) as StructuredCommandRow | null) ?? null
    );
  }

  private mustFindCommand(commandId: string): StructuredCommandRow {
    const row = this.getCommandRow(commandId);
    if (!row) {
      throw new Error(`Unknown command: ${commandId}`);
    }
    return row;
  }

  private getEpisodeRow(episodeId: string): StructuredEpisodeRow | null {
    return (
      (this.db
        .query(
          `SELECT
           id,
           session_id,
           thread_id,
           source_command_id,
           kind,
           title,
           summary,
           body,
           created_at
         FROM episode
         WHERE id = ?
         LIMIT 1`,
        )
        .get(episodeId) as StructuredEpisodeRow | null) ?? null
    );
  }

  private mustFindEpisode(episodeId: string): StructuredEpisodeRow {
    const row = this.getEpisodeRow(episodeId);
    if (!row) {
      throw new Error(`Unknown episode: ${episodeId}`);
    }
    return row;
  }

  private getVerificationRow(verificationId: string): StructuredVerificationRow | null {
    return (
      (this.db
        .query(
          `SELECT
           id,
           session_id,
           thread_id,
           command_id,
           kind,
           status,
           summary,
           command,
           started_at,
           finished_at
         FROM verification
         WHERE id = ?
         LIMIT 1`,
        )
        .get(verificationId) as StructuredVerificationRow | null) ?? null
    );
  }

  private getWorkflowRow(workflowId: string): StructuredWorkflowRow | null {
    return (
      (this.db
        .query(
          `SELECT
           id,
           session_id,
           thread_id,
           command_id,
           smithers_run_id,
           workflow_name,
           status,
           summary,
           started_at,
           updated_at,
           finished_at
         FROM workflow
         WHERE id = ?
         LIMIT 1`,
        )
        .get(workflowId) as StructuredWorkflowRow | null) ?? null
    );
  }

  private mustFindWorkflow(workflowId: string): StructuredWorkflowRow {
    const row = this.getWorkflowRow(workflowId);
    if (!row) {
      throw new Error(`Unknown workflow: ${workflowId}`);
    }
    return row;
  }

  private findWorkflowByThreadId(threadId: string): StructuredWorkflowRow | null {
    return (
      (this.db
        .query(
          `SELECT
           id,
           session_id,
           thread_id,
           command_id,
           smithers_run_id,
           workflow_name,
           status,
           summary,
           started_at,
           updated_at,
           finished_at
         FROM workflow
         WHERE thread_id = ?
         LIMIT 1`,
        )
        .get(threadId) as StructuredWorkflowRow | null) ?? null
    );
  }

  private getArtifactRow(artifactId: string): StructuredArtifactRow | null {
    return (
      (this.db
        .query(
          `SELECT
           id,
           session_id,
           episode_id,
           source_command_id,
           kind,
           name,
           path,
           content,
           created_at
         FROM artifact
         WHERE id = ?
         LIMIT 1`,
        )
        .get(artifactId) as StructuredArtifactRow | null) ?? null
    );
  }

  private mustFindVerificationRecord(verificationId: string): StructuredVerificationRecord {
    const row = this.getVerificationRow(verificationId);
    if (!row) {
      throw new Error(`Unknown verification: ${verificationId}`);
    }
    return this.mapVerificationRow(row);
  }

  private mustFindWorkflowRecord(workflowId: string): StructuredWorkflowRecord {
    return this.mapWorkflowRow(this.mustFindWorkflow(workflowId));
  }

  private mustFindArtifactRecord(artifactId: string): StructuredArtifactRecord {
    const row = this.getArtifactRow(artifactId);
    if (!row) {
      throw new Error(`Unknown artifact: ${artifactId}`);
    }
    return this.mapArtifactRow(row);
  }

  private mustFindTurnRecord(turnId: string): StructuredTurnRecord {
    return this.mapTurnRow(this.mustFindTurn(turnId));
  }

  private mustFindThreadRecord(threadId: string): StructuredThreadRecord {
    return this.mapThreadRow(this.mustFindThread(threadId));
  }

  private mustFindCommandRecord(commandId: string): StructuredCommandRecord {
    return this.mapCommandRow(this.mustFindCommand(commandId));
  }

  private mustFindEpisodeRecord(episodeId: string): StructuredEpisodeRecord {
    const artifactIds = (
      this.db
        .query(`SELECT id FROM artifact WHERE episode_id = ? ORDER BY created_at ASC, id ASC`)
        .all(episodeId) as Array<{ id: string }>
    ).map((row) => row.id);
    return this.mapEpisodeRow(this.mustFindEpisode(episodeId), artifactIds);
  }

  private listTurnRows(sessionId: string): StructuredTurnRow[] {
    return this.db
      .query(
        `SELECT
           id,
           session_id,
           request_summary,
           status,
           started_at,
           updated_at,
           finished_at
         FROM turn
         WHERE session_id = ?
         ORDER BY started_at ASC, id ASC`,
      )
      .all(sessionId) as StructuredTurnRow[];
  }

  private listThreadRows(sessionId: string): StructuredThreadRow[] {
    return this.db
      .query(
        `SELECT
           id,
           session_id,
           turn_id,
           parent_thread_id,
           kind,
           title,
           objective,
           status,
           depends_on_thread_ids,
           wait_kind,
           wait_reason,
           wait_resume_when,
           wait_since,
           started_at,
           updated_at,
           finished_at
         FROM thread
         WHERE session_id = ?
         ORDER BY started_at ASC, id ASC`,
      )
      .all(sessionId) as StructuredThreadRow[];
  }

  private listCommandRows(sessionId: string): StructuredCommandRow[] {
    return this.db
      .query(
        `SELECT
           id,
           session_id,
           turn_id,
           thread_id,
           parent_command_id,
           tool_name,
           executor,
           visibility,
           status,
           attempts,
           title,
           summary,
           error,
           started_at,
           updated_at,
           finished_at
         FROM command
         WHERE session_id = ?
         ORDER BY started_at ASC, id ASC`,
      )
      .all(sessionId) as StructuredCommandRow[];
  }

  private listEpisodeRows(sessionId: string): StructuredEpisodeRow[] {
    return this.db
      .query(
        `SELECT
           id,
           session_id,
           thread_id,
           source_command_id,
           kind,
           title,
           summary,
           body,
           created_at
         FROM episode
         WHERE session_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(sessionId) as StructuredEpisodeRow[];
  }

  private listVerificationRows(sessionId: string): StructuredVerificationRow[] {
    return this.db
      .query(
        `SELECT
           id,
           session_id,
           thread_id,
           command_id,
           kind,
           status,
           summary,
           command,
           started_at,
           finished_at
         FROM verification
         WHERE session_id = ?
         ORDER BY finished_at ASC, id ASC`,
      )
      .all(sessionId) as StructuredVerificationRow[];
  }

  private listWorkflowRows(sessionId: string): StructuredWorkflowRow[] {
    return this.db
      .query(
        `SELECT
           id,
           session_id,
           thread_id,
           command_id,
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
      .all(sessionId) as StructuredWorkflowRow[];
  }

  private listArtifactRows(sessionId: string): StructuredArtifactRow[] {
    return this.db
      .query(
        `SELECT
           id,
           session_id,
           episode_id,
           source_command_id,
           kind,
           name,
           path,
           content,
           created_at
         FROM artifact
         WHERE session_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(sessionId) as StructuredArtifactRow[];
  }

  private listEventRows(sessionId: string): StructuredEventRow[] {
    return this.db
      .query(
        `SELECT
           id,
           session_id,
           at,
           kind,
           subject_kind,
           subject_id,
           data_json
         FROM domain_event
         WHERE session_id = ?
         ORDER BY at ASC, id ASC`,
      )
      .all(sessionId) as StructuredEventRow[];
  }

  private mapPiSessionRow(row: StructuredSessionRow): StructuredPiSessionRecord {
    return {
      sessionId: row.session_id,
      title: row.title,
      provider: row.provider ?? undefined,
      model: row.model ?? undefined,
      reasoningEffort: row.reasoning_effort ?? undefined,
      messageCount: row.message_count,
      status: row.pi_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapTurnRow(row: StructuredTurnRow): StructuredTurnRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      requestSummary: row.request_summary,
      status: row.status,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapThreadRow(row: StructuredThreadRow): StructuredThreadRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      parentThreadId: row.parent_thread_id,
      kind: row.kind,
      title: row.title,
      objective: row.objective,
      status: row.status,
      dependsOnThreadIds: parseIdList(row.depends_on_thread_ids),
      wait: mapWait(row),
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapCommandRow(row: StructuredCommandRow): StructuredCommandRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      threadId: row.thread_id,
      parentCommandId: row.parent_command_id,
      toolName: row.tool_name,
      executor: row.executor,
      visibility: row.visibility,
      status: row.status,
      attempts: row.attempts,
      title: row.title,
      summary: row.summary,
      error: row.error,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapEpisodeRow(row: StructuredEpisodeRow, artifactIds: string[]): StructuredEpisodeRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      sourceCommandId: row.source_command_id,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      body: row.body,
      artifactIds,
      createdAt: row.created_at,
    };
  }

  private mapVerificationRow(row: StructuredVerificationRow): StructuredVerificationRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      commandId: row.command_id,
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
      commandId: row.command_id,
      smithersRunId: row.smithers_run_id,
      workflowName: row.workflow_name,
      status: row.status,
      summary: row.summary,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapArtifactRow(row: StructuredArtifactRow): StructuredArtifactRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      episodeId: row.episode_id,
      sourceCommandId: row.source_command_id,
      kind: row.kind,
      name: row.name,
      path: row.path ?? undefined,
      content: row.content ?? undefined,
      createdAt: row.created_at,
    };
  }

  private mapEventRow(row: StructuredEventRow): StructuredLifecycleEventRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      at: row.at,
      kind: row.kind,
      subject: {
        kind: row.subject_kind,
        id: row.subject_id,
      },
      data: parseEventData(row.data_json),
    };
  }
}

export function createStructuredSessionStateStore(
  options: CreateStructuredSessionStateStoreOptions,
): StructuredSessionStateStore {
  return new SqliteStructuredSessionStateStore(options);
}
