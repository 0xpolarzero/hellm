import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export type StructuredSessionStatus = "idle" | "running" | "waiting" | "error";
export type StructuredTurnStatus = "running" | "waiting" | "completed" | "failed";
export type StructuredThreadKind = "task" | "workflow" | "verification";
export type StructuredThreadStatus = "running" | "waiting" | "completed" | "failed" | "cancelled";
export type StructuredWaitKind = "user" | "external";
export type StructuredCommandExecutor =
  | "orchestrator"
  | "handler"
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
  artifactDir: string;
}

export interface StructuredWorkspaceInput {
  id: string;
  label: string;
  cwd: string;
  artifactDir?: string;
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

export type StructuredSessionWaitOwner =
  | { kind: "orchestrator" }
  | { kind: "thread"; threadId: string };

export interface StructuredSessionWaitState extends StructuredWaitState {
  owner: StructuredSessionWaitOwner;
  threadId?: string;
}

export interface StructuredTurnRecord {
  id: string;
  sessionId: string;
  surfacePiSessionId: string;
  threadId: string | null;
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
  surfacePiSessionId: string;
  title: string;
  objective: string;
  status: StructuredThreadStatus;
  wait: StructuredWaitState | null;
  worktree?: string;
  latestWorkflowRunId: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredCommandRecord {
  id: string;
  sessionId: string;
  turnId: string;
  surfacePiSessionId: string;
  threadId: string | null;
  workflowRunId: string | null;
  parentCommandId: string | null;
  toolName: string;
  executor: StructuredCommandExecutor;
  visibility: StructuredCommandVisibility;
  status: StructuredCommandStatus;
  attempts: number;
  title: string;
  summary: string;
  facts: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredEpisodeRecord {
  id: string;
  sessionId: string;
  threadId: string | null;
  sourceCommandId: string | null;
  kind: StructuredEpisodeKind;
  title: string;
  summary: string;
  body: string;
  createdAt: string;
}

export interface StructuredVerificationRecord {
  id: string;
  sessionId: string;
  threadId: string;
  workflowRunId: string;
  commandId: string;
  kind: string;
  status: StructuredVerificationStatus;
  summary: string;
  command?: string;
  startedAt: string;
  finishedAt: string;
}

export interface StructuredWorkflowRunRecord {
  id: string;
  sessionId: string;
  threadId: string;
  commandId: string;
  smithersRunId: string;
  workflowName: string;
  templateId: string | null;
  presetId: string | null;
  status: StructuredWorkflowStatus;
  summary: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export type StructuredWorkflowRecord = StructuredWorkflowRunRecord;

export interface StructuredArtifactRecord {
  id: string;
  sessionId: string;
  threadId: string | null;
  workflowRunId: string | null;
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
  | "workflowRun"
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
    orchestratorPiSessionId: string;
    wait: StructuredSessionWaitState | null;
  };
  turns: StructuredTurnRecord[];
  threads: StructuredThreadRecord[];
  commands: StructuredCommandRecord[];
  episodes: StructuredEpisodeRecord[];
  verifications: StructuredVerificationRecord[];
  workflowRuns: StructuredWorkflowRunRecord[];
  workflows: StructuredWorkflowRunRecord[];
  artifacts: StructuredArtifactRecord[];
  events: StructuredLifecycleEventRecord[];
}

export interface StructuredThreadDetail {
  thread: StructuredThreadRecord;
  childThreads: StructuredThreadRecord[];
  commands: StructuredCommandRecord[];
  episodes: StructuredEpisodeRecord[];
  verifications: StructuredVerificationRecord[];
  workflowRuns: StructuredWorkflowRunRecord[];
  latestWorkflowRun: StructuredWorkflowRunRecord | null;
  workflow: StructuredWorkflowRunRecord | null;
  artifacts: StructuredArtifactRecord[];
}

export interface CreateStructuredSessionStateStoreOptions {
  databasePath?: string;
  now?: () => string;
  workspace: StructuredWorkspaceInput;
}

export interface StructuredSessionStateStore {
  upsertPiSession(pi: StructuredPiSessionRecord): void;
  startTurn(input: {
    sessionId: string;
    surfacePiSessionId?: string;
    threadId?: string | null;
    requestSummary: string;
  }): StructuredTurnRecord;
  finishTurn(input: {
    turnId: string;
    status: Exclude<StructuredTurnStatus, "running">;
  }): StructuredTurnRecord;
  createThread(input: {
    turnId: string;
    parentThreadId?: string | null;
    kind?: StructuredThreadKind;
    surfacePiSessionId?: string;
    title: string;
    objective: string;
    worktree?: string;
  }): StructuredThreadRecord;
  updateThread(input: {
    threadId: string;
    status?: StructuredThreadStatus;
    wait?: StructuredWaitState | null;
    title?: string;
    objective?: string;
    worktree?: string | null;
  }): StructuredThreadRecord;
  setSessionWait(input: {
    sessionId: string;
    owner?: StructuredSessionWaitOwner;
    threadId?: string;
    kind: StructuredWaitKind;
    reason: string;
    resumeWhen: string;
  }): StructuredSessionWaitState;
  clearSessionWait(input: { sessionId: string }): void;
  createCommand(input: {
    turnId: string;
    surfacePiSessionId?: string;
    threadId?: string | null;
    workflowRunId?: string | null;
    parentCommandId?: string | null;
    toolName: string;
    executor: StructuredCommandExecutor;
    visibility: StructuredCommandVisibility;
    title: string;
    summary: string;
    facts?: Record<string, unknown> | null;
    attempts?: number;
  }): StructuredCommandRecord;
  startCommand(commandId: string): StructuredCommandRecord;
  finishCommand(input: {
    commandId: string;
    status: Exclude<StructuredCommandStatus, "requested" | "running">;
    visibility?: StructuredCommandVisibility;
    summary?: string;
    facts?: Record<string, unknown> | null;
    error?: string | null;
  }): StructuredCommandRecord;
  createEpisode(input: {
    threadId: string | null;
    sourceCommandId?: string | null;
    kind?: StructuredEpisodeKind;
    title: string;
    summary: string;
    body: string;
  }): StructuredEpisodeRecord;
  createArtifact(input: {
    threadId?: string | null;
    workflowRunId?: string | null;
    episodeId?: string | null;
    sourceCommandId?: string | null;
    kind: StructuredArtifactKind;
    name?: string;
    path?: string;
    content?: string;
  }): StructuredArtifactRecord;
  recordVerification(input: {
    threadId?: string;
    workflowRunId?: string;
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
    templateId?: string | null;
    presetId?: string | null;
    status: StructuredWorkflowStatus;
    summary: string;
  }): StructuredWorkflowRunRecord;
  updateWorkflow(input: {
    workflowId: string;
    status: StructuredWorkflowStatus;
    summary: string;
  }): StructuredWorkflowRunRecord;
  getSessionState(sessionId: string): StructuredSessionSnapshot;
  listSessionStates(): StructuredSessionSnapshot[];
  getThreadDetail(threadId: string): StructuredThreadDetail;
  close(): void;
}

type SessionRow = {
  session_id: string;
  title: string;
  provider: string | null;
  model: string | null;
  reasoning_effort: string | null;
  message_count: number;
  pi_status: StructuredSessionStatus;
  created_at: string;
  updated_at: string;
  orchestrator_pi_session_id: string;
  wait_owner_kind: "orchestrator" | "thread" | null;
  wait_thread_id: string | null;
  wait_kind: StructuredWaitKind | null;
  wait_reason: string | null;
  wait_resume_when: string | null;
  wait_since: string | null;
};

type TurnRow = {
  id: string;
  session_id: string;
  surface_pi_session_id: string;
  thread_id: string | null;
  request_summary: string;
  status: StructuredTurnStatus;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

type ThreadRow = {
  id: string;
  session_id: string;
  turn_id: string;
  parent_thread_id: string | null;
  surface_pi_session_id: string;
  title: string;
  objective: string;
  status: StructuredThreadStatus;
  wait_kind: StructuredWaitKind | null;
  wait_reason: string | null;
  wait_resume_when: string | null;
  wait_since: string | null;
  worktree: string | null;
  latest_workflow_run_id: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

type CommandRow = {
  id: string;
  session_id: string;
  turn_id: string;
  surface_pi_session_id: string;
  thread_id: string | null;
  workflow_run_id: string | null;
  parent_command_id: string | null;
  tool_name: string;
  executor: StructuredCommandExecutor;
  visibility: StructuredCommandVisibility;
  status: StructuredCommandStatus;
  attempts: number;
  title: string;
  summary: string;
  facts_json: string | null;
  error: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

type EpisodeRow = {
  id: string;
  session_id: string;
  thread_id: string | null;
  source_command_id: string | null;
  kind: StructuredEpisodeKind;
  title: string;
  summary: string;
  body: string;
  created_at: string;
};

type VerificationRow = {
  id: string;
  session_id: string;
  thread_id: string;
  workflow_run_id: string;
  command_id: string;
  kind: string;
  status: StructuredVerificationStatus;
  summary: string;
  command: string | null;
  started_at: string;
  finished_at: string;
};

type WorkflowRunRow = {
  id: string;
  session_id: string;
  thread_id: string;
  command_id: string;
  smithers_run_id: string;
  workflow_name: string;
  template_id: string | null;
  preset_id: string | null;
  status: StructuredWorkflowStatus;
  summary: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

type ArtifactRow = {
  id: string;
  session_id: string;
  thread_id: string | null;
  workflow_run_id: string | null;
  source_command_id: string | null;
  kind: StructuredArtifactKind;
  name: string;
  path: string | null;
  content: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  session_id: string;
  at: string;
  kind: string;
  subject_kind: StructuredEventSubjectKind;
  subject_id: string;
  data_json: string | null;
};

const MEMORY_DATABASE = ":memory:";

export function createStructuredSessionStateStore(
  options: CreateStructuredSessionStateStoreOptions,
): StructuredSessionStateStore {
  return new SqliteStructuredSessionStateStore(options);
}

class SqliteStructuredSessionStateStore implements StructuredSessionStateStore {
  private readonly db: Database;
  private readonly nowFn: () => string;
  private readonly workspace: StructuredWorkspaceRecord;

  constructor(options: CreateStructuredSessionStateStoreOptions) {
    const databasePath = options.databasePath ?? MEMORY_DATABASE;
    if (databasePath !== MEMORY_DATABASE) {
      mkdirSync(dirname(databasePath), { recursive: true });
      resetLegacyDatabaseIfNeeded(databasePath);
    }

    this.db = new Database(databasePath);
    this.nowFn = options.now ?? (() => new Date().toISOString());
    initializeSchema(this.db);

    const existingWorkspace = this.db.query(`SELECT * FROM workspace LIMIT 1`).get() as
      | { id: string; label: string; cwd: string; artifact_dir: string }
      | undefined;
    this.workspace = existingWorkspace
      ? {
          id: existingWorkspace.id,
          label: existingWorkspace.label,
          cwd: existingWorkspace.cwd,
          artifactDir: existingWorkspace.artifact_dir,
        }
      : {
          id: options.workspace.id,
          label: options.workspace.label,
          cwd: options.workspace.cwd,
          artifactDir:
            options.workspace.artifactDir ?? join(options.workspace.cwd, ".svvy", "artifacts"),
        };

    try {
      mkdirSync(this.workspace.artifactDir, { recursive: true });
    } catch {
      // Some unit tests intentionally point at read-only fake workspace roots.
    }

    if (!existingWorkspace) {
      this.db
        .query(
          `INSERT INTO workspace (id, label, cwd, artifact_dir)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          this.workspace.id,
          this.workspace.label,
          this.workspace.cwd,
          this.workspace.artifactDir,
        );
    }
  }

  close(): void {
    this.db.close();
  }

  upsertPiSession(pi: StructuredPiSessionRecord): void {
    const existing = this.getSessionRow(pi.sessionId);
    this.db
      .query(
        `INSERT OR REPLACE INTO session (
           session_id,
           title,
           provider,
           model,
           reasoning_effort,
           message_count,
           pi_status,
           created_at,
           updated_at,
           orchestrator_pi_session_id,
           wait_owner_kind,
           wait_thread_id,
           wait_kind,
           wait_reason,
           wait_resume_when,
           wait_since
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pi.sessionId,
        pi.title,
        pi.provider ?? null,
        pi.model ?? null,
        pi.reasoningEffort ?? null,
        pi.messageCount,
        pi.status,
        existing?.created_at ?? pi.createdAt,
        pi.updatedAt,
        existing?.orchestrator_pi_session_id ?? pi.sessionId,
        existing?.wait_owner_kind ?? null,
        existing?.wait_thread_id ?? null,
        existing?.wait_kind ?? null,
        existing?.wait_reason ?? null,
        existing?.wait_resume_when ?? null,
        existing?.wait_since ?? null,
      );
  }

  startTurn(input: {
    sessionId: string;
    surfacePiSessionId?: string;
    threadId?: string | null;
    requestSummary: string;
  }): StructuredTurnRecord {
    const timestamp = this.now();
    this.ensureSessionRow(input.sessionId);

    const threadId = input.threadId ?? null;
    const thread = threadId ? this.mustFindThreadRow(threadId) : null;
    if (threadId) {
      if (thread.status === "waiting" || thread.wait_kind) {
        this.db
          .query(
            `UPDATE thread
             SET status = ?, wait_kind = NULL, wait_reason = NULL, wait_resume_when = NULL, wait_since = NULL, updated_at = ?, finished_at = NULL
             WHERE id = ?`,
          )
          .run("running", timestamp, threadId);
        this.recordEvent({
          sessionId: thread.session_id,
          kind: "thread.updated",
          subjectKind: "thread",
          subjectId: threadId,
          at: timestamp,
        });
      }

      const sessionWait = this.mapSessionWait(this.mustFindSessionRow(input.sessionId));
      if (sessionWait?.owner.kind === "thread" && sessionWait.owner.threadId === threadId) {
        this.clearSessionWait({ sessionId: input.sessionId });
      }
    } else {
      const sessionWait = this.mapSessionWait(this.mustFindSessionRow(input.sessionId));
      if (sessionWait?.owner.kind === "orchestrator") {
        this.clearSessionWait({ sessionId: input.sessionId });
      }
    }

    const turnId = createId("turn");
    const surfacePiSessionId = input.surfacePiSessionId ?? thread?.surface_pi_session_id ?? input.sessionId;
    this.db
      .query(
        `INSERT INTO turn (
           id,
           session_id,
           surface_pi_session_id,
           thread_id,
           request_summary,
           status,
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        turnId,
        input.sessionId,
        surfacePiSessionId,
        threadId,
        input.requestSummary,
        "running",
        timestamp,
        timestamp,
        null,
      );

    this.recordEvent({
      sessionId: input.sessionId,
      kind: "turn.started",
      subjectKind: "turn",
      subjectId: turnId,
      at: timestamp,
    });

    return this.mustFindTurnRecord(turnId);
  }

  finishTurn(input: {
    turnId: string;
    status: Exclude<StructuredTurnStatus, "running">;
  }): StructuredTurnRecord {
    const existing = this.mustFindTurnRow(input.turnId);
    const timestamp = this.now();
    const finishedAt = input.status === "waiting" ? null : timestamp;
    this.db
      .query(
        `UPDATE turn
         SET status = ?, updated_at = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(input.status, timestamp, finishedAt, input.turnId);

    this.recordEvent({
      sessionId: existing.session_id,
      kind:
        input.status === "waiting"
          ? "turn.waiting"
          : input.status === "failed"
            ? "turn.failed"
            : "turn.completed",
      subjectKind: "turn",
      subjectId: input.turnId,
      at: timestamp,
    });

    return this.mustFindTurnRecord(input.turnId);
  }

  createThread(input: {
    turnId: string;
    parentThreadId?: string | null;
    kind?: StructuredThreadKind;
    surfacePiSessionId?: string;
    title: string;
    objective: string;
    worktree?: string;
  }): StructuredThreadRecord {
    const turn = this.mustFindTurnRow(input.turnId);
    const parent = input.parentThreadId ? this.mustFindThreadRow(input.parentThreadId) : null;
    const timestamp = this.now();
    const threadId = createId("thread");
    const surfacePiSessionId =
      input.surfacePiSessionId ?? parent?.surface_pi_session_id ?? turn.surface_pi_session_id;

    this.db
      .query(
        `INSERT INTO thread (
           id,
           session_id,
           turn_id,
           parent_thread_id,
           surface_pi_session_id,
           title,
           objective,
           status,
           wait_kind,
           wait_reason,
           wait_resume_when,
           wait_since,
           worktree,
           latest_workflow_run_id,
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, ?, ?, NULL)`,
      )
      .run(
        threadId,
        turn.session_id,
        input.turnId,
        input.parentThreadId ?? null,
        surfacePiSessionId,
        input.title,
        input.objective,
        "running",
        input.worktree ?? null,
        timestamp,
        timestamp,
      );

    this.recordEvent({
      sessionId: turn.session_id,
      kind: "thread.created",
      subjectKind: "thread",
      subjectId: threadId,
      at: timestamp,
    });
    this.reconcileSessionWaitAfterRunnableChange(turn.session_id);

    return this.mustFindThreadRecord(threadId);
  }

  updateThread(input: {
    threadId: string;
    status?: StructuredThreadStatus;
    wait?: StructuredWaitState | null;
    title?: string;
    objective?: string;
    worktree?: string | null;
  }): StructuredThreadRecord {
    const existing = this.mustFindThreadRow(input.threadId);
    const timestamp = this.now();
    const nextStatus = input.status ?? existing.status;
    const nextWait =
      input.wait !== undefined
        ? input.wait
        : input.status && input.status !== "waiting"
          ? null
          : this.mapThreadWait(existing);
    const nextTitle = input.title ?? existing.title;
    const nextObjective = input.objective ?? existing.objective;
    const nextWorktree =
      input.worktree === undefined ? existing.worktree : input.worktree ?? null;
    const finishedAt = isTerminalThreadStatus(nextStatus) ? timestamp : null;

    this.db
      .query(
        `UPDATE thread
         SET title = ?,
             objective = ?,
             status = ?,
             wait_kind = ?,
             wait_reason = ?,
             wait_resume_when = ?,
             wait_since = ?,
             worktree = ?,
             updated_at = ?,
             finished_at = ?
         WHERE id = ?`,
      )
      .run(
        nextTitle,
        nextObjective,
        nextStatus,
        nextWait?.kind ?? null,
        nextWait?.reason ?? null,
        nextWait?.resumeWhen ?? null,
        nextWait?.since ?? null,
        nextWorktree,
        timestamp,
        finishedAt,
        input.threadId,
      );

    this.recordEvent({
      sessionId: existing.session_id,
      kind: isTerminalThreadStatus(nextStatus) ? "thread.finished" : "thread.updated",
      subjectKind: "thread",
      subjectId: input.threadId,
      at: timestamp,
    });
    this.reconcileSessionWaitAfterRunnableChange(existing.session_id);

    return this.mustFindThreadRecord(input.threadId);
  }

  setSessionWait(input: {
    sessionId: string;
    owner?: StructuredSessionWaitOwner;
    threadId?: string;
    kind: StructuredWaitKind;
    reason: string;
    resumeWhen: string;
  }): StructuredSessionWaitState {
    const session = this.mustFindSessionRow(input.sessionId);
    const owner = resolveSessionWaitOwner(input.owner, input.threadId);
    if (owner.kind === "thread") {
      this.mustFindThreadRow(owner.threadId);
      const hasOtherRunningThread = this.queryThreadRows(session.session_id).some(
        (thread) => thread.id !== owner.threadId && thread.status === "running",
      );
      if (hasOtherRunningThread) {
        throw new Error("Cannot set session wait while other runnable thread work remains.");
      }
    } else if (this.queryThreadRows(session.session_id).some((thread) => thread.status === "running")) {
      throw new Error("Cannot set orchestrator session wait while runnable thread work remains.");
    }

    const timestamp = this.now();
    this.db
      .query(
        `UPDATE session
         SET wait_owner_kind = ?,
             wait_thread_id = ?,
             wait_kind = ?,
             wait_reason = ?,
             wait_resume_when = ?,
             wait_since = ?
         WHERE session_id = ?`,
      )
      .run(
        owner.kind,
        owner.kind === "thread" ? owner.threadId : null,
        input.kind,
        input.reason,
        input.resumeWhen,
        timestamp,
        input.sessionId,
      );

    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.wait.started",
      subjectKind: "session",
      subjectId: input.sessionId,
      at: timestamp,
      data: {
        owner,
        kind: input.kind,
        reason: input.reason,
      },
    });

    return this.mustFindSessionWait(input.sessionId);
  }

  clearSessionWait(input: { sessionId: string }): void {
    const existing = this.mustFindSessionRow(input.sessionId);
    if (!this.mapSessionWait(existing)) {
      return;
    }

    const timestamp = this.now();
    this.db
      .query(
        `UPDATE session
         SET wait_owner_kind = NULL,
             wait_thread_id = NULL,
             wait_kind = NULL,
             wait_reason = NULL,
             wait_resume_when = NULL,
             wait_since = NULL
         WHERE session_id = ?`,
      )
      .run(input.sessionId);

    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.wait.cleared",
      subjectKind: "session",
      subjectId: input.sessionId,
      at: timestamp,
    });
  }

  createCommand(input: {
    turnId: string;
    surfacePiSessionId?: string;
    threadId?: string | null;
    workflowRunId?: string | null;
    parentCommandId?: string | null;
    toolName: string;
    executor: StructuredCommandExecutor;
    visibility: StructuredCommandVisibility;
    title: string;
    summary: string;
    facts?: Record<string, unknown> | null;
    attempts?: number;
  }): StructuredCommandRecord {
    const turn = this.mustFindTurnRow(input.turnId);
    const thread = input.threadId ? this.mustFindThreadRow(input.threadId) : null;
    const workflowRunId = input.workflowRunId ?? null;
    if (workflowRunId) {
      this.mustFindWorkflowRunRow(workflowRunId);
    }

    const timestamp = this.now();
    const commandId = createId("command");
    const surfacePiSessionId =
      input.surfacePiSessionId ?? thread?.surface_pi_session_id ?? turn.surface_pi_session_id;

    this.db
      .query(
        `INSERT INTO command (
           id,
           session_id,
           turn_id,
           surface_pi_session_id,
           thread_id,
           workflow_run_id,
           parent_command_id,
           tool_name,
           executor,
           visibility,
           status,
           attempts,
           title,
           summary,
           facts_json,
           error,
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
      )
      .run(
        commandId,
        turn.session_id,
        input.turnId,
        surfacePiSessionId,
        input.threadId ?? null,
        workflowRunId,
        input.parentCommandId ?? null,
        input.toolName,
        input.executor,
        input.visibility,
        "requested",
        input.attempts ?? 1,
        input.title,
        input.summary,
        toJson(input.facts ?? null),
        timestamp,
        timestamp,
      );

    this.recordEvent({
      sessionId: turn.session_id,
      kind: "command.requested",
      subjectKind: "command",
      subjectId: commandId,
      at: timestamp,
    });

    return this.mustFindCommandRecord(commandId);
  }

  startCommand(commandId: string): StructuredCommandRecord {
    const existing = this.mustFindCommandRow(commandId);
    const timestamp = this.now();
    this.db
      .query(`UPDATE command SET status = ?, updated_at = ? WHERE id = ?`)
      .run("running", timestamp, commandId);
    this.recordEvent({
      sessionId: existing.session_id,
      kind: "command.started",
      subjectKind: "command",
      subjectId: commandId,
      at: timestamp,
    });
    return this.mustFindCommandRecord(commandId);
  }

  finishCommand(input: {
    commandId: string;
    status: Exclude<StructuredCommandStatus, "requested" | "running">;
    visibility?: StructuredCommandVisibility;
    summary?: string;
    facts?: Record<string, unknown> | null;
    error?: string | null;
  }): StructuredCommandRecord {
    const existing = this.mustFindCommandRow(input.commandId);
    const timestamp = this.now();
    const visibility = input.visibility ?? existing.visibility;
    const factsJson =
      input.facts === undefined ? existing.facts_json : toJson(input.facts ?? null);
    const finishedAt = input.status === "waiting" ? null : timestamp;

    this.db
      .query(
        `UPDATE command
         SET visibility = ?,
             status = ?,
             summary = ?,
             facts_json = ?,
             error = ?,
             updated_at = ?,
             finished_at = ?
         WHERE id = ?`,
      )
      .run(
        visibility,
        input.status,
        input.summary ?? existing.summary,
        factsJson,
        input.error === undefined ? existing.error : input.error,
        timestamp,
        finishedAt,
        input.commandId,
      );

    this.recordEvent({
      sessionId: existing.session_id,
      kind: input.status === "waiting" ? "command.waiting" : "command.finished",
      subjectKind: "command",
      subjectId: input.commandId,
      at: timestamp,
    });

    return this.mustFindCommandRecord(input.commandId);
  }

  createEpisode(input: {
    threadId: string | null;
    sourceCommandId?: string | null;
    kind?: StructuredEpisodeKind;
    title: string;
    summary: string;
    body: string;
  }): StructuredEpisodeRecord {
    const sourceCommand = input.sourceCommandId ? this.mustFindCommandRow(input.sourceCommandId) : null;
    const sessionId =
      input.threadId !== null
        ? this.mustFindThreadRow(input.threadId).session_id
        : sourceCommand?.session_id ?? null;

    if (!sessionId) {
      throw new Error("Episode creation requires a thread or source command session.");
    }

    if (input.threadId !== null) {
      const thread = this.mustFindThreadRow(input.threadId);
      if (!isTerminalThreadStatus(thread.status)) {
        throw new Error("Terminal episodes can only be created once the thread is terminal.");
      }
      const existing = this.db
        .query(`SELECT id FROM episode WHERE thread_id = ? LIMIT 1`)
        .get(input.threadId) as { id: string } | undefined;
      if (existing) {
        throw new Error("Thread already has a final episode.");
      }
    }

    const episodeId = createId("episode");
    const timestamp = this.now();
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
        sessionId,
        input.threadId,
        input.sourceCommandId ?? null,
        input.kind ?? "change",
        input.title,
        input.summary,
        input.body,
        timestamp,
      );

    this.recordEvent({
      sessionId,
      kind: "episode.created",
      subjectKind: "episode",
      subjectId: episodeId,
      at: timestamp,
    });

    return this.mustFindEpisodeRecord(episodeId);
  }

  createArtifact(input: {
    threadId?: string | null;
    workflowRunId?: string | null;
    episodeId?: string | null;
    sourceCommandId?: string | null;
    kind: StructuredArtifactKind;
    name?: string;
    path?: string;
    content?: string;
  }): StructuredArtifactRecord {
    const episode = input.episodeId ? this.mustFindEpisodeRow(input.episodeId) : null;
    const sourceCommand = input.sourceCommandId ? this.mustFindCommandRow(input.sourceCommandId) : null;
    const workflowRun =
      input.workflowRunId != null ? this.mustFindWorkflowRunRow(input.workflowRunId) : null;

    const threadId =
      input.threadId ??
      workflowRun?.thread_id ??
      sourceCommand?.thread_id ??
      episode?.thread_id ??
      null;
    const thread = threadId ? this.mustFindThreadRow(threadId) : null;
    const workflowRunId =
      input.workflowRunId ??
      sourceCommand?.workflow_run_id ??
      workflowRun?.id ??
      null;
    const sourceCommandId = input.sourceCommandId ?? episode?.source_command_id ?? null;
    const sessionId =
      thread?.session_id ??
      workflowRun?.session_id ??
      sourceCommand?.session_id ??
      episode?.session_id ??
      null;

    if (!sessionId) {
      throw new Error("Artifact creation requires thread, workflow run, command, or episode ownership.");
    }

    const artifactId = createId("artifact");
    const timestamp = this.now();
    const name = input.name?.trim() || basename(input.path ?? "artifact");
    const path = resolveArtifactPath({
      artifactDir: this.workspace.artifactDir,
      sessionId,
      artifactId,
      requestedPath: input.path,
      name,
      content: input.content,
    });

    if (input.content !== undefined && path) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, input.content);
    }

    this.db
      .query(
        `INSERT INTO artifact (
           id,
           session_id,
           thread_id,
           workflow_run_id,
           source_command_id,
           kind,
           name,
           path,
           content,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifactId,
        sessionId,
        threadId,
        workflowRunId,
        sourceCommandId,
        input.kind,
        name,
        path ?? null,
        input.content ?? null,
        timestamp,
      );

    this.recordEvent({
      sessionId,
      kind: "artifact.created",
      subjectKind: "artifact",
      subjectId: artifactId,
      at: timestamp,
    });

    return this.mustFindArtifactRecord(artifactId);
  }

  recordVerification(input: {
    threadId?: string;
    workflowRunId?: string;
    commandId: string;
    kind: string;
    status: StructuredVerificationStatus;
    summary: string;
    command?: string;
  }): StructuredVerificationRecord {
    const command = this.mustFindCommandRow(input.commandId);
    const workflowRun =
      input.workflowRunId != null
        ? this.mustFindWorkflowRunRow(input.workflowRunId)
        : command.workflow_run_id
          ? this.mustFindWorkflowRunRow(command.workflow_run_id)
          : input.threadId
            ? this.findLatestWorkflowRunRowForThread(input.threadId)
            : command.thread_id
              ? this.findLatestWorkflowRunRowForThread(command.thread_id)
              : null;

    if (!workflowRun) {
      throw new Error("Verification records require an owning workflow run.");
    }

    const threadId = input.threadId ?? workflowRun.thread_id;
    const thread = this.mustFindThreadRow(threadId);
    const verificationId = createId("verification");
    const timestamp = this.now();
    this.db
      .query(
        `INSERT INTO verification (
           id,
           session_id,
           thread_id,
           workflow_run_id,
           command_id,
           kind,
           status,
           summary,
           command,
           started_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        verificationId,
        thread.session_id,
        threadId,
        workflowRun.id,
        input.commandId,
        input.kind,
        input.status,
        input.summary,
        input.command ?? null,
        timestamp,
        timestamp,
      );

    this.recordEvent({
      sessionId: thread.session_id,
      kind: "verification.recorded",
      subjectKind: "verification",
      subjectId: verificationId,
      at: timestamp,
    });

    return this.mustFindVerificationRecord(verificationId);
  }

  recordWorkflow(input: {
    threadId: string;
    commandId: string;
    smithersRunId: string;
    workflowName: string;
    templateId?: string | null;
    presetId?: string | null;
    status: StructuredWorkflowStatus;
    summary: string;
  }): StructuredWorkflowRunRecord {
    const thread = this.mustFindThreadRow(input.threadId);
    this.mustFindCommandRow(input.commandId);
    const workflowId = createId("workflow");
    const timestamp = this.now();
    this.db
      .query(
        `INSERT INTO workflow_run (
           id,
           session_id,
           thread_id,
           command_id,
           smithers_run_id,
           workflow_name,
           template_id,
           preset_id,
           status,
           summary,
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workflowId,
        thread.session_id,
        input.threadId,
        input.commandId,
        input.smithersRunId,
        input.workflowName,
        input.templateId ?? null,
        input.presetId ?? null,
        input.status,
        input.summary,
        timestamp,
        timestamp,
        isTerminalWorkflowStatus(input.status) ? timestamp : null,
      );

    this.db
      .query(`UPDATE thread SET latest_workflow_run_id = ?, updated_at = ? WHERE id = ?`)
      .run(workflowId, timestamp, input.threadId);

    this.recordEvent({
      sessionId: thread.session_id,
      kind: "workflowRun.recorded",
      subjectKind: "workflowRun",
      subjectId: workflowId,
      at: timestamp,
    });

    return this.mustFindWorkflowRunRecord(workflowId);
  }

  updateWorkflow(input: {
    workflowId: string;
    status: StructuredWorkflowStatus;
    summary: string;
  }): StructuredWorkflowRunRecord {
    const existing = this.mustFindWorkflowRunRow(input.workflowId);
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE workflow_run
         SET status = ?,
             summary = ?,
             updated_at = ?,
             finished_at = ?
         WHERE id = ?`,
      )
      .run(
        input.status,
        input.summary,
        timestamp,
        isTerminalWorkflowStatus(input.status) ? timestamp : null,
        input.workflowId,
      );
    this.db
      .query(`UPDATE thread SET latest_workflow_run_id = ?, updated_at = ? WHERE id = ?`)
      .run(input.workflowId, timestamp, existing.thread_id);

    this.recordEvent({
      sessionId: existing.session_id,
      kind: "workflowRun.updated",
      subjectKind: "workflowRun",
      subjectId: input.workflowId,
      at: timestamp,
    });

    return this.mustFindWorkflowRunRecord(input.workflowId);
  }

  getSessionState(sessionId: string): StructuredSessionSnapshot {
    const session = this.mustFindSessionRow(sessionId);
    const workflowRuns = this.queryWorkflowRunRecords(sessionId);
    return {
      workspace: { ...this.workspace },
      pi: this.mapPiSession(session),
      session: {
        id: session.session_id,
        orchestratorPiSessionId: session.orchestrator_pi_session_id,
        wait: this.mapSessionWait(session),
      },
      turns: this.queryTurnRecords(sessionId),
      threads: this.queryThreadRecords(sessionId),
      commands: this.queryCommandRecords(sessionId),
      episodes: this.queryEpisodeRecords(sessionId),
      verifications: this.queryVerificationRecords(sessionId),
      workflowRuns,
      workflows: workflowRuns,
      artifacts: this.queryArtifactRecords(sessionId),
      events: this.queryEventRecords(sessionId),
    };
  }

  listSessionStates(): StructuredSessionSnapshot[] {
    const rows = this.db
      .query(`SELECT session_id FROM session ORDER BY updated_at DESC, rowid ASC`)
      .all() as Array<{ session_id: string }>;
    return rows.map((row) => this.getSessionState(row.session_id));
  }

  getThreadDetail(threadId: string): StructuredThreadDetail {
    const thread = this.mustFindThreadRecord(threadId);
    const workflowRuns = this.queryWorkflowRunRecordsForThread(threadId);
    const latestWorkflowRun =
      workflowRuns.find((entry) => entry.id === thread.latestWorkflowRunId) ??
      workflowRuns[workflowRuns.length - 1] ??
      null;

    return {
      thread,
      childThreads: this.queryThreadRowsByParent(threadId).map((row) => this.mapThread(row)),
      commands: this.queryCommandRowsByThread(threadId).map((row) => this.mapCommand(row)),
      episodes: this.queryEpisodeRowsByThread(threadId).map((row) => this.mapEpisode(row)),
      verifications: this.queryVerificationRowsByThread(threadId).map((row) =>
        this.mapVerification(row),
      ),
      workflowRuns,
      latestWorkflowRun,
      workflow: latestWorkflowRun,
      artifacts: this.queryArtifactRowsByThread(threadId).map((row) => this.mapArtifact(row)),
    };
  }

  private now(): string {
    return this.nowFn();
  }

  private ensureSessionRow(sessionId: string): SessionRow {
    const existing = this.getSessionRow(sessionId);
    if (existing) {
      return existing;
    }

    const timestamp = this.now();
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
           orchestrator_pi_session_id,
           wait_owner_kind,
           wait_thread_id,
           wait_kind,
           wait_reason,
           wait_resume_when,
           wait_since
         ) VALUES (?, ?, NULL, NULL, NULL, 0, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL)`,
      )
      .run(sessionId, sessionId, "idle", timestamp, timestamp, sessionId);
    return this.mustFindSessionRow(sessionId);
  }

  private getSessionRow(sessionId: string): SessionRow | undefined {
    return this.db
      .query(`SELECT * FROM session WHERE session_id = ?`)
      .get(sessionId) as SessionRow | undefined;
  }

  private mustFindSessionRow(sessionId: string): SessionRow {
    const row = this.getSessionRow(sessionId);
    if (!row) {
      throw new Error(`Structured session not found: ${sessionId}`);
    }
    return row;
  }

  private mustFindTurnRow(turnId: string): TurnRow {
    const row = this.db.query(`SELECT * FROM turn WHERE id = ?`).get(turnId) as TurnRow | undefined;
    if (!row) {
      throw new Error(`Structured turn not found: ${turnId}`);
    }
    return row;
  }

  private mustFindThreadRow(threadId: string): ThreadRow {
    const row = this.db
      .query(`SELECT * FROM thread WHERE id = ?`)
      .get(threadId) as ThreadRow | undefined;
    if (!row) {
      throw new Error(`Structured thread not found: ${threadId}`);
    }
    return row;
  }

  private mustFindCommandRow(commandId: string): CommandRow {
    const row = this.db
      .query(`SELECT * FROM command WHERE id = ?`)
      .get(commandId) as CommandRow | undefined;
    if (!row) {
      throw new Error(`Structured command not found: ${commandId}`);
    }
    return row;
  }

  private mustFindEpisodeRow(episodeId: string): EpisodeRow {
    const row = this.db
      .query(`SELECT * FROM episode WHERE id = ?`)
      .get(episodeId) as EpisodeRow | undefined;
    if (!row) {
      throw new Error(`Structured episode not found: ${episodeId}`);
    }
    return row;
  }

  private mustFindWorkflowRunRow(workflowId: string): WorkflowRunRow {
    const row = this.db
      .query(`SELECT * FROM workflow_run WHERE id = ?`)
      .get(workflowId) as WorkflowRunRow | undefined;
    if (!row) {
      throw new Error(`Structured workflow run not found: ${workflowId}`);
    }
    return row;
  }

  private mustFindTurnRecord(turnId: string): StructuredTurnRecord {
    return this.mapTurn(this.mustFindTurnRow(turnId));
  }

  private mustFindThreadRecord(threadId: string): StructuredThreadRecord {
    return this.mapThread(this.mustFindThreadRow(threadId));
  }

  private mustFindCommandRecord(commandId: string): StructuredCommandRecord {
    return this.mapCommand(this.mustFindCommandRow(commandId));
  }

  private mustFindEpisodeRecord(episodeId: string): StructuredEpisodeRecord {
    return this.mapEpisode(this.mustFindEpisodeRow(episodeId));
  }

  private mustFindVerificationRecord(verificationId: string): StructuredVerificationRecord {
    const row = this.db
      .query(`SELECT * FROM verification WHERE id = ?`)
      .get(verificationId) as VerificationRow | undefined;
    if (!row) {
      throw new Error(`Structured verification not found: ${verificationId}`);
    }
    return this.mapVerification(row);
  }

  private mustFindWorkflowRunRecord(workflowId: string): StructuredWorkflowRunRecord {
    return this.mapWorkflowRun(this.mustFindWorkflowRunRow(workflowId));
  }

  private mustFindArtifactRecord(artifactId: string): StructuredArtifactRecord {
    const row = this.db
      .query(`SELECT * FROM artifact WHERE id = ?`)
      .get(artifactId) as ArtifactRow | undefined;
    if (!row) {
      throw new Error(`Structured artifact not found: ${artifactId}`);
    }
    return this.mapArtifact(row);
  }

  private mustFindSessionWait(sessionId: string): StructuredSessionWaitState {
    const wait = this.mapSessionWait(this.mustFindSessionRow(sessionId));
    if (!wait) {
      throw new Error(`Structured session wait not found: ${sessionId}`);
    }
    return wait;
  }

  private queryTurnRows(sessionId: string): TurnRow[] {
    return this.db
      .query(`SELECT * FROM turn WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as TurnRow[];
  }

  private queryThreadRows(sessionId: string): ThreadRow[] {
    return this.db
      .query(`SELECT * FROM thread WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as ThreadRow[];
  }

  private queryCommandRows(sessionId: string): CommandRow[] {
    return this.db
      .query(`SELECT * FROM command WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as CommandRow[];
  }

  private queryEpisodeRows(sessionId: string): EpisodeRow[] {
    return this.db
      .query(`SELECT * FROM episode WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as EpisodeRow[];
  }

  private queryVerificationRows(sessionId: string): VerificationRow[] {
    return this.db
      .query(`SELECT * FROM verification WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as VerificationRow[];
  }

  private queryWorkflowRunRows(sessionId: string): WorkflowRunRow[] {
    return this.db
      .query(`SELECT * FROM workflow_run WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as WorkflowRunRow[];
  }

  private queryArtifactRows(sessionId: string): ArtifactRow[] {
    return this.db
      .query(`SELECT * FROM artifact WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as ArtifactRow[];
  }

  private queryEventRows(sessionId: string): EventRow[] {
    return this.db
      .query(`SELECT * FROM event WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as EventRow[];
  }

  private queryTurnRecords(sessionId: string): StructuredTurnRecord[] {
    return this.queryTurnRows(sessionId).map((row) => this.mapTurn(row));
  }

  private queryThreadRecords(sessionId: string): StructuredThreadRecord[] {
    return this.queryThreadRows(sessionId).map((row) => this.mapThread(row));
  }

  private queryCommandRecords(sessionId: string): StructuredCommandRecord[] {
    return this.queryCommandRows(sessionId).map((row) => this.mapCommand(row));
  }

  private queryEpisodeRecords(sessionId: string): StructuredEpisodeRecord[] {
    return this.queryEpisodeRows(sessionId).map((row) => this.mapEpisode(row));
  }

  private queryVerificationRecords(sessionId: string): StructuredVerificationRecord[] {
    return this.queryVerificationRows(sessionId).map((row) => this.mapVerification(row));
  }

  private queryWorkflowRunRecords(sessionId: string): StructuredWorkflowRunRecord[] {
    return this.queryWorkflowRunRows(sessionId).map((row) => this.mapWorkflowRun(row));
  }

  private queryArtifactRecords(sessionId: string): StructuredArtifactRecord[] {
    return this.queryArtifactRows(sessionId).map((row) => this.mapArtifact(row));
  }

  private queryEventRecords(sessionId: string): StructuredLifecycleEventRecord[] {
    return this.queryEventRows(sessionId).map((row) => this.mapEvent(row));
  }

  private queryThreadRowsByParent(parentThreadId: string): ThreadRow[] {
    return this.db
      .query(`SELECT * FROM thread WHERE parent_thread_id = ? ORDER BY rowid ASC`)
      .all(parentThreadId) as ThreadRow[];
  }

  private queryCommandRowsByThread(threadId: string): CommandRow[] {
    return this.db
      .query(`SELECT * FROM command WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as CommandRow[];
  }

  private queryEpisodeRowsByThread(threadId: string): EpisodeRow[] {
    return this.db
      .query(`SELECT * FROM episode WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as EpisodeRow[];
  }

  private queryVerificationRowsByThread(threadId: string): VerificationRow[] {
    return this.db
      .query(`SELECT * FROM verification WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as VerificationRow[];
  }

  private queryWorkflowRunRowsForThread(threadId: string): WorkflowRunRow[] {
    return this.db
      .query(`SELECT * FROM workflow_run WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as WorkflowRunRow[];
  }

  private queryWorkflowRunRecordsForThread(threadId: string): StructuredWorkflowRunRecord[] {
    return this.queryWorkflowRunRowsForThread(threadId).map((row) => this.mapWorkflowRun(row));
  }

  private queryArtifactRowsByThread(threadId: string): ArtifactRow[] {
    return this.db
      .query(`SELECT * FROM artifact WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as ArtifactRow[];
  }

  private findLatestWorkflowRunRowForThread(threadId: string): WorkflowRunRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM workflow_run WHERE thread_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
        )
        .get(threadId) as WorkflowRunRow | undefined) ?? null
    );
  }

  private reconcileSessionWaitAfterRunnableChange(sessionId: string): void {
    const session = this.mustFindSessionRow(sessionId);
    const wait = this.mapSessionWait(session);
    if (!wait) {
      return;
    }

    const threads = this.queryThreadRows(sessionId);
    if (wait.owner.kind === "orchestrator") {
      if (threads.some((thread) => thread.status === "running")) {
        this.clearSessionWait({ sessionId });
      }
      return;
    }

    const ownerThreadId = wait.owner.threadId;
    const ownerThread = threads.find((thread) => thread.id === ownerThreadId) ?? null;
    if (!ownerThread || ownerThread.status !== "waiting") {
      this.clearSessionWait({ sessionId });
      return;
    }

    if (threads.some((thread) => thread.id !== ownerThreadId && thread.status === "running")) {
      this.clearSessionWait({ sessionId });
    }
  }

  private recordEvent(input: {
    sessionId: string;
    kind: string;
    subjectKind: StructuredEventSubjectKind;
    subjectId: string;
    at?: string;
    data?: Record<string, unknown>;
  }): void {
    const at = input.at ?? this.now();
    this.db
      .query(
        `INSERT INTO event (
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
        createId("event"),
        input.sessionId,
        at,
        input.kind,
        input.subjectKind,
        input.subjectId,
        toJson(input.data),
      );
  }

  private mapPiSession(row: SessionRow): StructuredPiSessionRecord {
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

  private mapSessionWait(row: SessionRow): StructuredSessionWaitState | null {
    if (!row.wait_kind || !row.wait_reason || !row.wait_resume_when || !row.wait_since) {
      return null;
    }

    const owner: StructuredSessionWaitOwner =
      row.wait_owner_kind === "thread" && row.wait_thread_id
        ? { kind: "thread", threadId: row.wait_thread_id }
        : { kind: "orchestrator" };

    return {
      owner,
      threadId: row.wait_thread_id ?? undefined,
      kind: row.wait_kind,
      reason: row.wait_reason,
      resumeWhen: row.wait_resume_when,
      since: row.wait_since,
    };
  }

  private mapTurn(row: TurnRow): StructuredTurnRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      surfacePiSessionId: row.surface_pi_session_id,
      threadId: row.thread_id,
      requestSummary: row.request_summary,
      status: row.status,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapThreadWait(row: ThreadRow): StructuredWaitState | null {
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

  private mapThread(row: ThreadRow): StructuredThreadRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      parentThreadId: row.parent_thread_id,
      surfacePiSessionId: row.surface_pi_session_id,
      title: row.title,
      objective: row.objective,
      status: row.status,
      wait: this.mapThreadWait(row),
      worktree: row.worktree ?? undefined,
      latestWorkflowRunId: row.latest_workflow_run_id,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapCommand(row: CommandRow): StructuredCommandRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      surfacePiSessionId: row.surface_pi_session_id,
      threadId: row.thread_id,
      workflowRunId: row.workflow_run_id,
      parentCommandId: row.parent_command_id,
      toolName: row.tool_name,
      executor: row.executor,
      visibility: row.visibility,
      status: row.status,
      attempts: row.attempts,
      title: row.title,
      summary: row.summary,
      facts: fromJson<Record<string, unknown>>(row.facts_json),
      error: row.error,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapEpisode(row: EpisodeRow): StructuredEpisodeRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      sourceCommandId: row.source_command_id,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      body: row.body,
      createdAt: row.created_at,
    };
  }

  private mapVerification(row: VerificationRow): StructuredVerificationRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      workflowRunId: row.workflow_run_id,
      commandId: row.command_id,
      kind: row.kind,
      status: row.status,
      summary: row.summary,
      command: row.command ?? undefined,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }

  private mapWorkflowRun(row: WorkflowRunRow): StructuredWorkflowRunRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      commandId: row.command_id,
      smithersRunId: row.smithers_run_id,
      workflowName: row.workflow_name,
      templateId: row.template_id,
      presetId: row.preset_id,
      status: row.status,
      summary: row.summary,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapArtifact(row: ArtifactRow): StructuredArtifactRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      workflowRunId: row.workflow_run_id,
      sourceCommandId: row.source_command_id,
      kind: row.kind,
      name: row.name,
      path: row.path ?? undefined,
      content: row.content ?? undefined,
      createdAt: row.created_at,
    };
  }

  private mapEvent(row: EventRow): StructuredLifecycleEventRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      at: row.at,
      kind: row.kind,
      subject: {
        kind: row.subject_kind,
        id: row.subject_id,
      },
      data: fromJson<Record<string, unknown>>(row.data_json) ?? undefined,
    };
  }
}

function initializeSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      cwd TEXT NOT NULL,
      artifact_dir TEXT NOT NULL
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
      orchestrator_pi_session_id TEXT NOT NULL,
      wait_owner_kind TEXT,
      wait_thread_id TEXT,
      wait_kind TEXT,
      wait_reason TEXT,
      wait_resume_when TEXT,
      wait_since TEXT
    );

    CREATE TABLE IF NOT EXISTS turn (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      surface_pi_session_id TEXT NOT NULL,
      thread_id TEXT,
      request_summary TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS thread (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      parent_thread_id TEXT,
      surface_pi_session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL,
      wait_kind TEXT,
      wait_reason TEXT,
      wait_resume_when TEXT,
      wait_since TEXT,
      worktree TEXT,
      latest_workflow_run_id TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS command (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      surface_pi_session_id TEXT NOT NULL,
      thread_id TEXT,
      workflow_run_id TEXT,
      parent_command_id TEXT,
      tool_name TEXT NOT NULL,
      executor TEXT NOT NULL,
      visibility TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      facts_json TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS episode (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT,
      source_command_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      workflow_run_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      command TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_run (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      smithers_run_id TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      template_id TEXT,
      preset_id TEXT,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS artifact (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT,
      workflow_run_id TEXT,
      source_command_id TEXT,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT,
      content TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      subject_kind TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      data_json TEXT
    );
  `);
}

function resetLegacyDatabaseIfNeeded(databasePath: string): void {
  if (!existsSync(databasePath)) {
    return;
  }

  let db: Database | null = null;
  try {
    db = new Database(databasePath);
    const hasSessionTable = tableExists(db, "session");
    const hasThreadTable = tableExists(db, "thread");
    const hasArtifactTable = tableExists(db, "artifact");
    const hasCommandTable = tableExists(db, "command");
    const hasWorkflowRunTable = tableExists(db, "workflow_run");
    const shouldReset =
      (hasSessionTable && !columnExists(db, "session", "orchestrator_pi_session_id")) ||
      (hasSessionTable && !columnExists(db, "session", "wait_owner_kind")) ||
      (hasThreadTable && !columnExists(db, "thread", "surface_pi_session_id")) ||
      (hasThreadTable && !columnExists(db, "thread", "latest_workflow_run_id")) ||
      (hasCommandTable && !columnExists(db, "command", "workflow_run_id")) ||
      (hasArtifactTable && !columnExists(db, "artifact", "thread_id")) ||
      (hasArtifactTable && !columnExists(db, "artifact", "workflow_run_id")) ||
      (hasSessionTable && !hasWorkflowRunTable);

    db.close();
    db = null;

    if (shouldReset) {
      unlinkSync(databasePath);
    }
  } catch {
    try {
      db?.close();
    } catch {
      // Ignore close failures on a broken database file.
    }
    unlinkSync(databasePath);
  }
}

function tableExists(db: Database, tableName: string): boolean {
  const row = db
    .query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName) as { name: string } | undefined;
  return Boolean(row);
}

function columnExists(db: Database, tableName: string, columnName: string): boolean {
  const rows = db.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function toJson(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return JSON.stringify(value);
}

function fromJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }
  return JSON.parse(value) as T;
}

function isTerminalThreadStatus(status: StructuredThreadStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isTerminalWorkflowStatus(status: StructuredWorkflowStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function resolveSessionWaitOwner(
  owner: StructuredSessionWaitOwner | undefined,
  threadId: string | undefined,
): StructuredSessionWaitOwner {
  if (owner) {
    return owner;
  }
  if (threadId) {
    return { kind: "thread", threadId };
  }
  return { kind: "orchestrator" };
}

function resolveArtifactPath(input: {
  artifactDir: string;
  sessionId: string;
  artifactId: string;
  requestedPath?: string;
  name: string;
  content?: string;
}): string | undefined {
  if (input.requestedPath && input.content === undefined) {
    return input.requestedPath;
  }

  if (input.content === undefined) {
    return input.requestedPath;
  }

  const sessionArtifactDir = join(input.artifactDir, input.sessionId);
  mkdirSync(sessionArtifactDir, { recursive: true });
  return join(sessionArtifactDir, `${input.artifactId}-${sanitizeArtifactName(input.name)}`);
}

function sanitizeArtifactName(name: string): string {
  const normalized = basename(name).replace(/[^\w.-]+/g, "-");
  return normalized || "artifact";
}
