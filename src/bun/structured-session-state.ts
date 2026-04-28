import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SessionAgentKey, SessionMode } from "../shared/agent-settings";

export type StructuredSessionStatus = "idle" | "running" | "waiting" | "error";
export type StructuredTurnStatus = "running" | "waiting" | "completed" | "failed";
export type StructuredTurnDecision =
  | "pending"
  | "reply"
  | "execute_typescript"
  | "clarify"
  | "thread.start"
  | "request_context"
  | "thread.handoff"
  | "wait"
  | `smithers.${string}`;
export type StructuredThreadStatus =
  | "running-handler"
  | "running-workflow"
  | "waiting"
  | "troubleshooting"
  | "completed";
export type StructuredWaitKind = "user" | "external" | "approval" | "signal" | "timer";
export type StructuredThreadWaitOwner = "handler" | "workflow";
export type StructuredWorkflowWaitKind = "approval" | "event" | "timer";
export type StructuredCommandExecutor =
  | "orchestrator"
  | "handler"
  | "workflow-task-agent"
  | "execute_typescript"
  | "runtime"
  | "smithers";
export type StructuredCommandVisibility = "trace" | "summary" | "surface";
export type StructuredCommandStatus =
  | "requested"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled";
export type StructuredEpisodeKind = "analysis" | "change" | "workflow" | "clarification";
export type StructuredArtifactKind = "text" | "log" | "json" | "file";
export type StructuredProjectCiStatus = "passed" | "failed" | "cancelled" | "blocked";
export type StructuredProjectCiCheckStatus =
  | "passed"
  | "failed"
  | "cancelled"
  | "skipped"
  | "blocked";
export type StructuredWorkflowStatus =
  | "running"
  | "waiting"
  | "continued"
  | "completed"
  | "failed"
  | "cancelled";
export type StructuredWorkflowTaskAttemptKind = "agent" | "compute" | "static" | "unknown";
export type StructuredWorkflowTaskAttemptStatus =
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";
export type StructuredWorkflowTaskMessageRole = "user" | "assistant" | "stderr";
export type StructuredWorkflowTaskMessageSource = "prompt" | "event" | "responseText";

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
  sessionMode?: SessionMode;
  defaultSessionAgentJson?: string | null;
  quickSessionAgentJson?: string | null;
  defaultOrchestratorPromptKey?: SessionAgentKey;
  messageCount: number;
  status: StructuredSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StructuredWaitState {
  owner: StructuredThreadWaitOwner;
  kind: StructuredWaitKind;
  reason: string;
  resumeWhen: string;
  since: string;
}

export type StructuredSessionWaitOwner =
  | { kind: "orchestrator" }
  | { kind: "thread"; threadId: string };

export interface StructuredSessionWaitState {
  owner: StructuredSessionWaitOwner;
  kind: StructuredWaitKind;
  reason: string;
  resumeWhen: string;
  since: string;
}

export interface StructuredTurnRecord {
  id: string;
  sessionId: string;
  surfacePiSessionId: string;
  threadId: string | null;
  requestSummary: string;
  turnDecision: StructuredTurnDecision;
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
  loadedContextKeys: string[];
  worktree?: string;
  sessionAgentJson?: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredThreadContextRecord {
  id: string;
  sessionId: string;
  threadId: string;
  contextKey: string;
  contextVersion: string;
  loadedByCommandId: string | null;
  loadedAt: string;
}

export interface StructuredCommandRecord {
  id: string;
  sessionId: string;
  turnId: string | null;
  workflowTaskAttemptId: string | null;
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
  threadId: string;
  sourceCommandId: string | null;
  kind: StructuredEpisodeKind;
  title: string;
  summary: string;
  body: string;
  createdAt: string;
}

export interface StructuredProjectCiRunRecord {
  id: string;
  sessionId: string;
  threadId: string;
  workflowRunId: string;
  smithersRunId: string;
  workflowId: string;
  entryPath: string;
  status: StructuredProjectCiStatus;
  summary: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt: string;
}

export interface StructuredProjectCiCheckResultRecord {
  id: string;
  sessionId: string;
  ciRunId: string;
  workflowRunId: string;
  checkId: string;
  label: string;
  kind: string;
  status: StructuredProjectCiCheckStatus;
  required: boolean;
  command: string[] | null;
  exitCode: number | null;
  summary: string;
  artifactIds: string[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StructuredWorkflowRunRecord {
  id: string;
  sessionId: string;
  threadId: string;
  commandId: string;
  smithersRunId: string;
  workflowName: string;
  workflowSource: "saved" | "artifact";
  entryPath: string | null;
  savedEntryId: string | null;
  status: StructuredWorkflowStatus;
  smithersStatus: string;
  waitKind: StructuredWorkflowWaitKind | null;
  continuedFromRunIds: string[];
  activeDescendantRunId: string | null;
  lastEventSeq: number | null;
  pendingAttentionSeq: number | null;
  lastAttentionSeq: number | null;
  heartbeatAt: string | null;
  summary: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredWorkflowTaskAttemptRecord {
  id: string;
  sessionId: string;
  threadId: string;
  workflowRunId: string;
  smithersRunId: string;
  nodeId: string;
  iteration: number;
  attempt: number;
  surfacePiSessionId: string | null;
  title: string;
  summary: string;
  kind: StructuredWorkflowTaskAttemptKind;
  status: StructuredWorkflowTaskAttemptStatus;
  smithersState: string;
  prompt: string | null;
  responseText: string | null;
  error: string | null;
  cached: boolean;
  jjPointer: string | null;
  jjCwd: string | null;
  heartbeatAt: string | null;
  agentId: string | null;
  agentModel: string | null;
  agentEngine: string | null;
  agentResume: string | null;
  meta: Record<string, unknown> | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface StructuredWorkflowTaskMessageRecord {
  id: string;
  sessionId: string;
  workflowTaskAttemptId: string;
  role: StructuredWorkflowTaskMessageRole;
  source: StructuredWorkflowTaskMessageSource;
  smithersEventSeq: number | null;
  text: string;
  createdAt: string;
}

export interface StructuredArtifactRecord {
  id: string;
  sessionId: string;
  threadId: string | null;
  workflowRunId: string | null;
  workflowTaskAttemptId: string | null;
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
  | "ciRun"
  | "ciCheckResult"
  | "workflowRun"
  | "workflowTaskAttempt"
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
    pinnedAt: string | null;
    archivedAt: string | null;
    wait: StructuredSessionWaitState | null;
  };
  turns: StructuredTurnRecord[];
  threads: StructuredThreadRecord[];
  threadContexts: StructuredThreadContextRecord[];
  commands: StructuredCommandRecord[];
  episodes: StructuredEpisodeRecord[];
  ciRuns: StructuredProjectCiRunRecord[];
  ciCheckResults: StructuredProjectCiCheckResultRecord[];
  workflowRuns: StructuredWorkflowRunRecord[];
  workflowTaskAttempts: StructuredWorkflowTaskAttemptRecord[];
  workflowTaskMessages: StructuredWorkflowTaskMessageRecord[];
  artifacts: StructuredArtifactRecord[];
  events: StructuredLifecycleEventRecord[];
}

export interface StructuredWorkspaceSidebarState {
  archivedGroupCollapsed: boolean;
  updatedAt: string;
}

export interface StructuredThreadDetail {
  thread: StructuredThreadRecord;
  childThreads: StructuredThreadRecord[];
  commands: StructuredCommandRecord[];
  episodes: StructuredEpisodeRecord[];
  threadContexts: StructuredThreadContextRecord[];
  ciRuns: StructuredProjectCiRunRecord[];
  ciCheckResults: StructuredProjectCiCheckResultRecord[];
  workflowRuns: StructuredWorkflowRunRecord[];
  latestWorkflowRun: StructuredWorkflowRunRecord | null;
  workflowTaskAttempts: StructuredWorkflowTaskAttemptRecord[];
  workflowTaskMessages: StructuredWorkflowTaskMessageRecord[];
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
    surfacePiSessionId: string;
    threadId?: string | null;
    requestSummary: string;
  }): StructuredTurnRecord;
  setTurnDecision(input: {
    turnId: string;
    decision: Exclude<StructuredTurnDecision, "pending">;
    onlyIfPending?: boolean;
  }): StructuredTurnRecord;
  finishTurn(input: {
    turnId: string;
    status: Exclude<StructuredTurnStatus, "running">;
  }): StructuredTurnRecord;
  createThread(input: {
    turnId: string;
    parentThreadId?: string | null;
    surfacePiSessionId?: string;
    title: string;
    objective: string;
    worktree?: string;
    sessionAgentJson?: string | null;
  }): StructuredThreadRecord;
  loadThreadContext(input: {
    threadId: string;
    contextKey: string;
    contextVersion: string;
    loadedByCommandId?: string | null;
  }): StructuredThreadContextRecord;
  updateThread(input: {
    threadId: string;
    status?: StructuredThreadStatus;
    wait?: StructuredWaitState | null;
    title?: string;
    objective?: string;
    worktree?: string | null;
    sessionAgentJson?: string | null;
  }): StructuredThreadRecord;
  setSessionWait(input: {
    sessionId: string;
    owner: StructuredSessionWaitOwner;
    kind: StructuredWaitKind;
    reason: string;
    resumeWhen: string;
  }): StructuredSessionWaitState;
  clearSessionWait(input: { sessionId: string }): void;
  setSessionPinned(input: { sessionId: string; pinned: boolean }): void;
  setSessionArchived(input: { sessionId: string; archived: boolean }): void;
  getWorkspaceSidebarState(): StructuredWorkspaceSidebarState;
  setArchivedGroupCollapsed(input: { collapsed: boolean }): StructuredWorkspaceSidebarState;
  recordLifecycleEvent(input: {
    sessionId: string;
    kind: string;
    subjectKind: StructuredEventSubjectKind;
    subjectId: string;
    at?: string;
    data?: Record<string, unknown>;
  }): void;
  createCommand(input: {
    turnId?: string | null;
    workflowTaskAttemptId?: string | null;
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
    threadId: string;
    sourceCommandId?: string | null;
    kind?: StructuredEpisodeKind;
    title: string;
    summary: string;
    body: string;
  }): StructuredEpisodeRecord;
  createArtifact(input: {
    threadId?: string | null;
    workflowRunId?: string | null;
    workflowTaskAttemptId?: string | null;
    sourceCommandId?: string | null;
    kind: StructuredArtifactKind;
    name?: string;
    path?: string;
    content?: string;
  }): StructuredArtifactRecord;
  upsertWorkflowTaskAttempt(input: {
    workflowRunId: string;
    smithersRunId: string;
    nodeId: string;
    iteration: number;
    attempt: number;
    surfacePiSessionId?: string | null;
    title?: string;
    summary: string;
    kind: StructuredWorkflowTaskAttemptKind;
    status: StructuredWorkflowTaskAttemptStatus;
    smithersState: string;
    prompt?: string | null;
    responseText?: string | null;
    error?: string | null;
    cached?: boolean;
    jjPointer?: string | null;
    jjCwd?: string | null;
    heartbeatAt?: string | null;
    agentId?: string | null;
    agentModel?: string | null;
    agentEngine?: string | null;
    agentResume?: string | null;
    meta?: Record<string, unknown> | null;
    startedAt?: string;
    finishedAt?: string | null;
  }): StructuredWorkflowTaskAttemptRecord;
  replaceWorkflowTaskMessages(input: {
    workflowTaskAttemptId: string;
    messages: Array<{
      id: string;
      role: StructuredWorkflowTaskMessageRole;
      source: StructuredWorkflowTaskMessageSource;
      smithersEventSeq?: number | null;
      text: string;
      createdAt: string;
    }>;
  }): StructuredWorkflowTaskMessageRecord[];
  findWorkflowRunBySmithersRunId(smithersRunId: string): StructuredWorkflowRunRecord | null;
  findWorkflowTaskAttemptByAgentResume(
    agentResume: string,
  ): StructuredWorkflowTaskAttemptRecord | null;
  recordProjectCiResult(input: {
    workflowRunId: string;
    workflowId: string;
    entryPath: string;
    status: StructuredProjectCiStatus;
    summary: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    checks: Array<{
      checkId: string;
      label: string;
      kind: string;
      status: StructuredProjectCiCheckStatus;
      required: boolean;
      command?: string[] | null;
      exitCode?: number | null;
      summary: string;
      artifactIds?: string[];
      startedAt?: string | null;
      finishedAt?: string | null;
    }>;
  }): { ciRun: StructuredProjectCiRunRecord; checkResults: StructuredProjectCiCheckResultRecord[] };
  recordWorkflow(input: {
    threadId: string;
    commandId: string;
    smithersRunId: string;
    workflowName: string;
    workflowSource: "saved" | "artifact";
    entryPath?: string | null;
    savedEntryId?: string | null;
    status: StructuredWorkflowStatus;
    smithersStatus?: string;
    waitKind?: StructuredWorkflowWaitKind | null;
    continuedFromRunIds?: string[];
    activeDescendantRunId?: string | null;
    lastEventSeq?: number | null;
    pendingAttentionSeq?: number | null;
    lastAttentionSeq?: number | null;
    heartbeatAt?: string | null;
    summary: string;
  }): StructuredWorkflowRunRecord;
  updateWorkflow(input: {
    workflowId: string;
    commandId?: string;
    status: StructuredWorkflowStatus;
    smithersStatus?: string;
    waitKind?: StructuredWorkflowWaitKind | null;
    continuedFromRunIds?: string[];
    activeDescendantRunId?: string | null;
    lastEventSeq?: number | null;
    pendingAttentionSeq?: number | null;
    lastAttentionSeq?: number | null;
    heartbeatAt?: string | null;
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
  session_mode: SessionMode | null;
  default_session_agent_json: string | null;
  quick_session_agent_json: string | null;
  default_orchestrator_prompt_key: SessionAgentKey | null;
  message_count: number;
  pi_status: StructuredSessionStatus;
  created_at: string;
  updated_at: string;
  orchestrator_pi_session_id: string;
  pinned_at: string | null;
  archived_at: string | null;
  wait_owner_kind: "orchestrator" | "thread" | null;
  wait_thread_id: string | null;
  wait_kind: StructuredWaitKind | null;
  wait_reason: string | null;
  wait_resume_when: string | null;
  wait_since: string | null;
};

type WorkspaceSidebarStateRow = {
  id: number;
  archived_group_collapsed: number;
  updated_at: string;
};

type TurnRow = {
  id: string;
  session_id: string;
  surface_pi_session_id: string;
  thread_id: string | null;
  request_summary: string;
  turn_decision: StructuredTurnDecision;
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
  wait_owner: StructuredThreadWaitOwner | null;
  wait_kind: StructuredWaitKind | null;
  wait_reason: string | null;
  wait_resume_when: string | null;
  wait_since: string | null;
  worktree: string | null;
  session_agent_json: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

type ThreadContextRow = {
  id: string;
  session_id: string;
  thread_id: string;
  context_key: string;
  context_version: string;
  loaded_by_command_id: string | null;
  loaded_at: string;
};

type CommandRow = {
  id: string;
  session_id: string;
  turn_id: string | null;
  workflow_task_attempt_id: string | null;
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

type ProjectCiRunRow = {
  id: string;
  session_id: string;
  thread_id: string;
  workflow_run_id: string;
  smithers_run_id: string;
  workflow_id: string;
  entry_path: string;
  status: StructuredProjectCiStatus;
  summary: string;
  created_at: string;
  updated_at: string;
  started_at: string;
  finished_at: string;
};

type ProjectCiCheckResultRow = {
  id: string;
  session_id: string;
  ci_run_id: string;
  workflow_run_id: string;
  check_id: string;
  label: string;
  kind: string;
  status: StructuredProjectCiCheckStatus;
  required: number;
  command_json: string | null;
  exit_code: number | null;
  summary: string;
  artifact_ids_json: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type WorkflowRunRow = {
  id: string;
  session_id: string;
  thread_id: string;
  command_id: string;
  smithers_run_id: string;
  workflow_name: string;
  workflow_source: "saved" | "artifact";
  entry_path: string | null;
  saved_entry_id: string | null;
  status: StructuredWorkflowStatus;
  smithers_status: string;
  wait_kind: StructuredWorkflowWaitKind | null;
  continued_from_run_ids_json: string | null;
  active_descendant_run_id: string | null;
  last_event_seq: number | null;
  pending_attention_seq: number | null;
  last_attention_seq: number | null;
  heartbeat_at: string | null;
  summary: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

type WorkflowTaskAttemptRow = {
  id: string;
  session_id: string;
  thread_id: string;
  workflow_run_id: string;
  smithers_run_id: string;
  node_id: string;
  iteration: number;
  attempt: number;
  surface_pi_session_id: string | null;
  title: string;
  summary: string;
  kind: StructuredWorkflowTaskAttemptKind;
  status: StructuredWorkflowTaskAttemptStatus;
  smithers_state: string;
  prompt: string | null;
  response_text: string | null;
  error: string | null;
  cached: number | null;
  jj_pointer: string | null;
  jj_cwd: string | null;
  heartbeat_at: string | null;
  agent_id: string | null;
  agent_model: string | null;
  agent_engine: string | null;
  agent_resume: string | null;
  meta_json: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

type WorkflowTaskMessageRow = {
  id: string;
  session_id: string;
  workflow_task_attempt_id: string;
  role: StructuredWorkflowTaskMessageRole;
  source: StructuredWorkflowTaskMessageSource;
  smithers_event_seq: number | null;
  text: string;
  created_at: string;
};

type ArtifactRow = {
  id: string;
  session_id: string;
  thread_id: string | null;
  workflow_run_id: string | null;
  workflow_task_attempt_id: string | null;
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
           session_mode,
           default_session_agent_json,
           quick_session_agent_json,
           default_orchestrator_prompt_key,
           message_count,
           pi_status,
           created_at,
           updated_at,
           orchestrator_pi_session_id,
           pinned_at,
           archived_at,
           wait_owner_kind,
           wait_thread_id,
           wait_kind,
           wait_reason,
           wait_resume_when,
           wait_since
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pi.sessionId,
        pi.title,
        pi.provider ?? null,
        pi.model ?? null,
        pi.reasoningEffort ?? null,
        pi.sessionMode ?? existing?.session_mode ?? "orchestrator",
        pi.defaultSessionAgentJson ?? existing?.default_session_agent_json ?? null,
        pi.quickSessionAgentJson ?? existing?.quick_session_agent_json ?? null,
        pi.defaultOrchestratorPromptKey ??
          existing?.default_orchestrator_prompt_key ??
          "defaultSession",
        pi.messageCount,
        pi.status,
        existing?.created_at ?? pi.createdAt,
        pi.updatedAt,
        existing?.orchestrator_pi_session_id ?? pi.sessionId,
        existing?.pinned_at ?? null,
        existing?.archived_at ?? null,
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
    surfacePiSessionId: string;
    threadId?: string | null;
    requestSummary: string;
  }): StructuredTurnRecord {
    const timestamp = this.now();
    this.ensureSessionRow(input.sessionId);

    const threadId = input.threadId ?? null;
    const thread = threadId ? this.mustFindThreadRow(threadId) : null;
    if (threadId && thread) {
      if (thread.status !== "running-handler" || thread.wait_kind || thread.wait_owner) {
        this.db
          .query(
            `UPDATE thread
             SET status = ?, wait_owner = NULL, wait_kind = NULL, wait_reason = NULL, wait_resume_when = NULL, wait_since = NULL, updated_at = ?, finished_at = NULL
             WHERE id = ?`,
          )
          .run("running-handler", timestamp, threadId);
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
    this.db
      .query(
        `INSERT INTO turn (
           id,
           session_id,
           surface_pi_session_id,
           thread_id,
           request_summary,
           turn_decision,
           status,
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        turnId,
        input.sessionId,
        input.surfacePiSessionId,
        threadId,
        input.requestSummary,
        "pending",
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

  setTurnDecision(input: {
    turnId: string;
    decision: Exclude<StructuredTurnDecision, "pending">;
    onlyIfPending?: boolean;
  }): StructuredTurnRecord {
    const existing = this.mustFindTurnRow(input.turnId);
    if (input.onlyIfPending && existing.turn_decision !== "pending") {
      return this.mustFindTurnRecord(input.turnId);
    }

    if (existing.turn_decision === input.decision) {
      return this.mustFindTurnRecord(input.turnId);
    }

    const timestamp = this.now();
    this.db
      .query(
        `UPDATE turn
         SET turn_decision = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.decision, timestamp, input.turnId);

    this.recordEvent({
      sessionId: existing.session_id,
      kind: "turn.decision",
      subjectKind: "turn",
      subjectId: input.turnId,
      at: timestamp,
      data: {
        decision: input.decision,
      },
    });

    return this.mustFindTurnRecord(input.turnId);
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
    surfacePiSessionId?: string;
    title: string;
    objective: string;
    worktree?: string;
    sessionAgentJson?: string | null;
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
           wait_owner,
           wait_kind,
           wait_reason,
           wait_resume_when,
           wait_since,
           worktree,
           session_agent_json,
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL)`,
      )
      .run(
        threadId,
        turn.session_id,
        input.turnId,
        input.parentThreadId ?? null,
        surfacePiSessionId,
        input.title,
        input.objective,
        "running-handler",
        input.worktree ?? null,
        input.sessionAgentJson ?? null,
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

  loadThreadContext(input: {
    threadId: string;
    contextKey: string;
    contextVersion: string;
    loadedByCommandId?: string | null;
  }): StructuredThreadContextRecord {
    const thread = this.mustFindThreadRow(input.threadId);
    const existing = this.findThreadContextRow(input.threadId, input.contextKey);
    if (existing) {
      return this.mapThreadContext(existing);
    }

    if (input.loadedByCommandId) {
      this.mustFindCommandRow(input.loadedByCommandId);
    }

    const timestamp = this.now();
    const contextId = createId("thread-context");
    this.db
      .query(
        `INSERT INTO thread_context (
           id,
           session_id,
           thread_id,
           context_key,
           context_version,
           loaded_by_command_id,
           loaded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        contextId,
        thread.session_id,
        input.threadId,
        input.contextKey,
        input.contextVersion,
        input.loadedByCommandId ?? null,
        timestamp,
      );

    this.recordEvent({
      sessionId: thread.session_id,
      kind: "context.loaded",
      subjectKind: "thread",
      subjectId: input.threadId,
      at: timestamp,
      data: {
        contextKey: input.contextKey,
        contextVersion: input.contextVersion,
      },
    });

    return this.mustFindThreadContextRecord(contextId);
  }

  updateThread(input: {
    threadId: string;
    status?: StructuredThreadStatus;
    wait?: StructuredWaitState | null;
    title?: string;
    objective?: string;
    worktree?: string | null;
    sessionAgentJson?: string | null;
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
      input.worktree === undefined ? existing.worktree : (input.worktree ?? null);
    const nextSessionAgentJson =
      input.sessionAgentJson === undefined
        ? existing.session_agent_json
        : (input.sessionAgentJson ?? null);
    const finishedAt = isTerminalThreadStatus(nextStatus) ? timestamp : null;

    this.db
      .query(
        `UPDATE thread
         SET title = ?,
             objective = ?,
             status = ?,
             wait_owner = ?,
             wait_kind = ?,
             wait_reason = ?,
             wait_resume_when = ?,
             wait_since = ?,
             worktree = ?,
             session_agent_json = ?,
             updated_at = ?,
             finished_at = ?
         WHERE id = ?`,
      )
      .run(
        nextTitle,
        nextObjective,
        nextStatus,
        nextWait?.owner ?? null,
        nextWait?.kind ?? null,
        nextWait?.reason ?? null,
        nextWait?.resumeWhen ?? null,
        nextWait?.since ?? null,
        nextWorktree,
        nextSessionAgentJson,
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
    owner: StructuredSessionWaitOwner;
    kind: StructuredWaitKind;
    reason: string;
    resumeWhen: string;
  }): StructuredSessionWaitState {
    const session = this.mustFindSessionRow(input.sessionId);
    const owner = input.owner;
    if (owner.kind === "thread") {
      this.mustFindThreadRow(owner.threadId);
      const hasOtherRunningThread = this.queryThreadRows(session.session_id).some(
        (thread) => thread.id !== owner.threadId && isRunnableThreadStatus(thread.status),
      );
      if (hasOtherRunningThread) {
        throw new Error("Cannot set session wait while other runnable thread work remains.");
      }
    } else if (
      this.queryThreadRows(session.session_id).some((thread) =>
        isRunnableThreadStatus(thread.status),
      )
    ) {
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

  setSessionPinned(input: { sessionId: string; pinned: boolean }): void {
    this.ensureSessionRow(input.sessionId);
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE session
         SET pinned_at = ?,
             archived_at = NULL,
             updated_at = ?
         WHERE session_id = ?`,
      )
      .run(input.pinned ? timestamp : null, timestamp, input.sessionId);

    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.navigation.updated",
      subjectKind: "session",
      subjectId: input.sessionId,
      at: timestamp,
      data: {
        pinned: input.pinned,
        archived: false,
      },
    });
  }

  setSessionArchived(input: { sessionId: string; archived: boolean }): void {
    this.ensureSessionRow(input.sessionId);
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE session
         SET archived_at = ?,
             pinned_at = NULL,
             updated_at = ?
         WHERE session_id = ?`,
      )
      .run(input.archived ? timestamp : null, timestamp, input.sessionId);

    this.recordEvent({
      sessionId: input.sessionId,
      kind: "session.navigation.updated",
      subjectKind: "session",
      subjectId: input.sessionId,
      at: timestamp,
      data: {
        pinned: false,
        archived: input.archived,
      },
    });
  }

  getWorkspaceSidebarState(): StructuredWorkspaceSidebarState {
    const row = this.getWorkspaceSidebarStateRow();
    if (!row) {
      return {
        archivedGroupCollapsed: true,
        updatedAt: new Date(0).toISOString(),
      };
    }

    return this.mapWorkspaceSidebarState(row);
  }

  setArchivedGroupCollapsed(input: { collapsed: boolean }): StructuredWorkspaceSidebarState {
    const timestamp = this.now();
    this.db
      .query(
        `INSERT INTO workspace_sidebar_state (
           id,
           archived_group_collapsed,
           updated_at
         ) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           archived_group_collapsed = excluded.archived_group_collapsed,
           updated_at = excluded.updated_at`,
      )
      .run(input.collapsed ? 1 : 0, timestamp);

    return this.getWorkspaceSidebarState();
  }

  recordLifecycleEvent(input: {
    sessionId: string;
    kind: string;
    subjectKind: StructuredEventSubjectKind;
    subjectId: string;
    at?: string;
    data?: Record<string, unknown>;
  }): void {
    this.recordEvent(input);
  }

  createCommand(input: {
    turnId?: string | null;
    workflowTaskAttemptId?: string | null;
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
    const workflowTaskAttempt = input.workflowTaskAttemptId
      ? this.mustFindWorkflowTaskAttemptRow(input.workflowTaskAttemptId)
      : null;
    const turn = input.turnId ? this.mustFindTurnRow(input.turnId) : null;
    if (!turn && !workflowTaskAttempt) {
      throw new Error("Command creation requires a turn or workflow task attempt owner.");
    }

    const threadId = input.threadId ?? workflowTaskAttempt?.thread_id ?? null;
    const thread = threadId ? this.mustFindThreadRow(threadId) : null;
    const workflowRunId = input.workflowRunId ?? workflowTaskAttempt?.workflow_run_id ?? null;
    if (workflowRunId) {
      this.mustFindWorkflowRunRow(workflowRunId);
    }

    const timestamp = this.now();
    const commandId = createId("command");
    const surfacePiSessionId =
      input.surfacePiSessionId ??
      workflowTaskAttempt?.surface_pi_session_id ??
      thread?.surface_pi_session_id ??
      turn?.surface_pi_session_id;
    if (!surfacePiSessionId) {
      throw new Error("Command creation requires a surface pi session id.");
    }
    const sessionId =
      turn?.session_id ?? workflowTaskAttempt?.session_id ?? thread?.session_id ?? null;
    if (!sessionId) {
      throw new Error("Command creation requires a session owner.");
    }

    this.db
      .query(
        `INSERT INTO command (
           id,
           session_id,
           turn_id,
           workflow_task_attempt_id,
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
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
      )
      .run(
        commandId,
        sessionId,
        turn?.id ?? null,
        workflowTaskAttempt?.id ?? input.workflowTaskAttemptId ?? null,
        surfacePiSessionId,
        threadId,
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
      sessionId,
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
    const factsJson = input.facts === undefined ? existing.facts_json : toJson(input.facts ?? null);
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
    threadId: string;
    sourceCommandId?: string | null;
    kind?: StructuredEpisodeKind;
    title: string;
    summary: string;
    body: string;
  }): StructuredEpisodeRecord {
    const thread = this.mustFindThreadRow(input.threadId);
    const sessionId = thread.session_id;

    if (!isTerminalThreadStatus(thread.status)) {
      throw new Error("Terminal episodes can only be created once the thread is terminal.");
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
    workflowTaskAttemptId?: string | null;
    sourceCommandId?: string | null;
    kind: StructuredArtifactKind;
    name?: string;
    path?: string;
    content?: string;
  }): StructuredArtifactRecord {
    const sourceCommand = input.sourceCommandId
      ? this.mustFindCommandRow(input.sourceCommandId)
      : null;
    const workflowRun =
      input.workflowRunId != null ? this.mustFindWorkflowRunRow(input.workflowRunId) : null;
    const workflowTaskAttempt =
      input.workflowTaskAttemptId != null
        ? this.mustFindWorkflowTaskAttemptRow(input.workflowTaskAttemptId)
        : sourceCommand?.workflow_task_attempt_id
          ? this.mustFindWorkflowTaskAttemptRow(sourceCommand.workflow_task_attempt_id)
          : null;

    const threadId =
      input.threadId ??
      workflowTaskAttempt?.thread_id ??
      workflowRun?.thread_id ??
      sourceCommand?.thread_id ??
      null;
    const thread = threadId ? this.mustFindThreadRow(threadId) : null;
    const workflowRunId =
      input.workflowRunId ??
      workflowTaskAttempt?.workflow_run_id ??
      sourceCommand?.workflow_run_id ??
      workflowRun?.id ??
      null;
    const workflowTaskAttemptId = input.workflowTaskAttemptId ?? workflowTaskAttempt?.id ?? null;
    const sourceCommandId = input.sourceCommandId ?? null;
    const sessionId =
      thread?.session_id ??
      workflowTaskAttempt?.session_id ??
      workflowRun?.session_id ??
      sourceCommand?.session_id ??
      null;

    if (!sessionId) {
      throw new Error(
        "Artifact creation requires thread, workflow run, workflow task attempt, or command ownership.",
      );
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
           workflow_task_attempt_id,
           source_command_id,
           kind,
           name,
           path,
           content,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifactId,
        sessionId,
        threadId,
        workflowRunId,
        workflowTaskAttemptId,
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

  upsertWorkflowTaskAttempt(input: {
    workflowRunId: string;
    smithersRunId: string;
    nodeId: string;
    iteration: number;
    attempt: number;
    surfacePiSessionId?: string | null;
    title?: string;
    summary: string;
    kind: StructuredWorkflowTaskAttemptKind;
    status: StructuredWorkflowTaskAttemptStatus;
    smithersState: string;
    prompt?: string | null;
    responseText?: string | null;
    error?: string | null;
    cached?: boolean;
    jjPointer?: string | null;
    jjCwd?: string | null;
    heartbeatAt?: string | null;
    agentId?: string | null;
    agentModel?: string | null;
    agentEngine?: string | null;
    agentResume?: string | null;
    meta?: Record<string, unknown> | null;
    startedAt?: string;
    finishedAt?: string | null;
  }): StructuredWorkflowTaskAttemptRecord {
    const workflowRun = this.mustFindWorkflowRunRow(input.workflowRunId);
    const existing = this.findWorkflowTaskAttemptRowByIdentity({
      workflowRunId: input.workflowRunId,
      nodeId: input.nodeId,
      iteration: input.iteration,
      attempt: input.attempt,
    });
    const timestamp = this.now();
    const title = input.title?.trim() || input.nodeId;
    const startedAt = input.startedAt ?? existing?.started_at ?? timestamp;
    const finishedAt =
      input.finishedAt === undefined
        ? (existing?.finished_at ??
          (isTerminalWorkflowTaskAttemptStatus(input.status) ? timestamp : null))
        : (input.finishedAt ?? null);

    if (existing) {
      this.db
        .query(
          `UPDATE workflow_task_attempt
           SET surface_pi_session_id = ?,
               title = ?,
               summary = ?,
               kind = ?,
               status = ?,
               smithers_state = ?,
               prompt = ?,
               response_text = ?,
               error = ?,
               cached = ?,
               jj_pointer = ?,
               jj_cwd = ?,
               heartbeat_at = ?,
               agent_id = ?,
               agent_model = ?,
               agent_engine = ?,
               agent_resume = ?,
               meta_json = ?,
               started_at = ?,
               updated_at = ?,
               finished_at = ?
           WHERE id = ?`,
        )
        .run(
          input.surfacePiSessionId ?? existing.surface_pi_session_id,
          title,
          input.summary,
          input.kind,
          input.status,
          input.smithersState,
          input.prompt === undefined ? existing.prompt : (input.prompt ?? null),
          input.responseText === undefined ? existing.response_text : (input.responseText ?? null),
          input.error === undefined ? existing.error : (input.error ?? null),
          input.cached === undefined ? existing.cached : input.cached,
          input.jjPointer === undefined ? existing.jj_pointer : (input.jjPointer ?? null),
          input.jjCwd === undefined ? existing.jj_cwd : (input.jjCwd ?? null),
          input.heartbeatAt === undefined ? existing.heartbeat_at : (input.heartbeatAt ?? null),
          input.agentId === undefined ? existing.agent_id : (input.agentId ?? null),
          input.agentModel === undefined ? existing.agent_model : (input.agentModel ?? null),
          input.agentEngine === undefined ? existing.agent_engine : (input.agentEngine ?? null),
          input.agentResume === undefined ? existing.agent_resume : (input.agentResume ?? null),
          input.meta === undefined ? existing.meta_json : toJson(input.meta ?? null),
          startedAt,
          timestamp,
          finishedAt,
          existing.id,
        );

      this.recordEvent({
        sessionId: workflowRun.session_id,
        kind: "workflowTaskAttempt.updated",
        subjectKind: "workflowTaskAttempt",
        subjectId: existing.id,
        at: timestamp,
      });
      return this.mustFindWorkflowTaskAttemptRecord(existing.id);
    }

    const workflowTaskAttemptId = createId("workflow-task-attempt");
    this.db
      .query(
        `INSERT INTO workflow_task_attempt (
           id,
           session_id,
           thread_id,
           workflow_run_id,
           smithers_run_id,
           node_id,
           iteration,
           attempt,
           surface_pi_session_id,
           title,
           summary,
           kind,
           status,
           smithers_state,
           prompt,
           response_text,
           error,
           cached,
           jj_pointer,
           jj_cwd,
           heartbeat_at,
           agent_id,
           agent_model,
           agent_engine,
           agent_resume,
           meta_json,
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workflowTaskAttemptId,
        workflowRun.session_id,
        workflowRun.thread_id,
        input.workflowRunId,
        input.smithersRunId,
        input.nodeId,
        input.iteration,
        input.attempt,
        input.surfacePiSessionId ?? null,
        title,
        input.summary,
        input.kind,
        input.status,
        input.smithersState,
        input.prompt ?? null,
        input.responseText ?? null,
        input.error ?? null,
        input.cached ?? false,
        input.jjPointer ?? null,
        input.jjCwd ?? null,
        input.heartbeatAt ?? null,
        input.agentId ?? null,
        input.agentModel ?? null,
        input.agentEngine ?? null,
        input.agentResume ?? null,
        toJson(input.meta ?? null),
        startedAt,
        timestamp,
        finishedAt,
      );

    this.recordEvent({
      sessionId: workflowRun.session_id,
      kind: "workflowTaskAttempt.created",
      subjectKind: "workflowTaskAttempt",
      subjectId: workflowTaskAttemptId,
      at: timestamp,
    });
    return this.mustFindWorkflowTaskAttemptRecord(workflowTaskAttemptId);
  }

  replaceWorkflowTaskMessages(input: {
    workflowTaskAttemptId: string;
    messages: Array<{
      id: string;
      role: StructuredWorkflowTaskMessageRole;
      source: StructuredWorkflowTaskMessageSource;
      smithersEventSeq?: number | null;
      text: string;
      createdAt: string;
    }>;
  }): StructuredWorkflowTaskMessageRecord[] {
    const attempt = this.mustFindWorkflowTaskAttemptRow(input.workflowTaskAttemptId);
    this.db
      .query(`DELETE FROM workflow_task_message WHERE workflow_task_attempt_id = ?`)
      .run(input.workflowTaskAttemptId);

    for (const message of input.messages) {
      this.db
        .query(
          `INSERT INTO workflow_task_message (
             id,
             session_id,
             workflow_task_attempt_id,
             role,
             source,
             smithers_event_seq,
             text,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          message.id,
          attempt.session_id,
          input.workflowTaskAttemptId,
          message.role,
          message.source,
          message.smithersEventSeq ?? null,
          message.text,
          message.createdAt,
        );
    }

    return this.queryWorkflowTaskMessageRowsByAttempt(input.workflowTaskAttemptId).map((row) =>
      this.mapWorkflowTaskMessage(row),
    );
  }

  findWorkflowRunBySmithersRunId(smithersRunId: string): StructuredWorkflowRunRecord | null {
    const row = this.findWorkflowRunRowBySmithersRunId(smithersRunId);
    return row ? this.mapWorkflowRun(row) : null;
  }

  findWorkflowTaskAttemptByAgentResume(
    agentResume: string,
  ): StructuredWorkflowTaskAttemptRecord | null {
    const row = this.findWorkflowTaskAttemptRowByAgentResume(agentResume);
    return row ? this.mapWorkflowTaskAttempt(row) : null;
  }

  recordProjectCiResult(input: {
    workflowRunId: string;
    workflowId: string;
    entryPath: string;
    status: StructuredProjectCiStatus;
    summary: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    checks: Array<{
      checkId: string;
      label: string;
      kind: string;
      status: StructuredProjectCiCheckStatus;
      required: boolean;
      command?: string[] | null;
      exitCode?: number | null;
      summary: string;
      artifactIds?: string[];
      startedAt?: string | null;
      finishedAt?: string | null;
    }>;
  }): {
    ciRun: StructuredProjectCiRunRecord;
    checkResults: StructuredProjectCiCheckResultRecord[];
  } {
    const workflowRun = this.mustFindWorkflowRunRow(input.workflowRunId);
    const thread = this.mustFindThreadRow(workflowRun.thread_id);
    const timestamp = this.now();
    const startedAt = input.startedAt ?? workflowRun.started_at;
    const finishedAt = input.finishedAt ?? workflowRun.finished_at ?? timestamp;
    const existingCiRun = this.findProjectCiRunRowByWorkflowRunId(input.workflowRunId);
    const ciRunId = existingCiRun?.id ?? createId("ci-run");
    const createdAt = existingCiRun?.created_at ?? timestamp;

    this.db
      .query(
        `INSERT INTO ci_run (
           id,
           session_id,
           thread_id,
           workflow_run_id,
           smithers_run_id,
           workflow_id,
           entry_path,
           status,
           summary,
           started_at,
           finished_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workflow_run_id) DO UPDATE SET
           thread_id = excluded.thread_id,
           smithers_run_id = excluded.smithers_run_id,
           workflow_id = excluded.workflow_id,
           entry_path = excluded.entry_path,
           status = excluded.status,
           summary = excluded.summary,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        ciRunId,
        workflowRun.session_id,
        workflowRun.thread_id,
        workflowRun.id,
        workflowRun.smithers_run_id,
        input.workflowId,
        input.entryPath,
        input.status,
        input.summary,
        startedAt,
        finishedAt,
        createdAt,
        timestamp,
      );

    if (!existingCiRun) {
      this.recordEvent({
        sessionId: thread.session_id,
        kind: "ciRun.recorded",
        subjectKind: "ciRun",
        subjectId: ciRunId,
        at: timestamp,
      });
    }

    const checkResults: StructuredProjectCiCheckResultRecord[] = [];
    for (const check of input.checks) {
      const existingCheck = this.findProjectCiCheckResultRow(ciRunId, check.checkId);
      const checkResultId = existingCheck?.id ?? createId("ci-check-result");
      const checkCreatedAt = existingCheck?.created_at ?? timestamp;
      this.db
        .query(
          `INSERT INTO ci_check_result (
             id,
             session_id,
             ci_run_id,
             workflow_run_id,
             check_id,
             label,
             kind,
             status,
             required,
             command_json,
             exit_code,
             summary,
             artifact_ids_json,
             started_at,
             finished_at,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(ci_run_id, check_id) DO UPDATE SET
             workflow_run_id = excluded.workflow_run_id,
             label = excluded.label,
             kind = excluded.kind,
             status = excluded.status,
             required = excluded.required,
             command_json = excluded.command_json,
             exit_code = excluded.exit_code,
             summary = excluded.summary,
             artifact_ids_json = excluded.artifact_ids_json,
             started_at = excluded.started_at,
             finished_at = excluded.finished_at,
             updated_at = excluded.updated_at`,
        )
        .run(
          checkResultId,
          workflowRun.session_id,
          ciRunId,
          workflowRun.id,
          check.checkId,
          check.label,
          check.kind,
          check.status,
          check.required ? 1 : 0,
          toJson(check.command ?? null),
          check.exitCode ?? null,
          check.summary,
          toJson(check.artifactIds ?? []),
          check.startedAt ?? null,
          check.finishedAt ?? null,
          checkCreatedAt,
          timestamp,
        );

      if (!existingCheck) {
        this.recordEvent({
          sessionId: thread.session_id,
          kind: "ciCheckResult.recorded",
          subjectKind: "ciCheckResult",
          subjectId: checkResultId,
          at: timestamp,
        });
      }

      checkResults.push(this.mustFindProjectCiCheckResultRecord(checkResultId));
    }

    return {
      ciRun: this.mustFindProjectCiRunRecord(ciRunId),
      checkResults,
    };
  }

  recordWorkflow(input: {
    threadId: string;
    commandId: string;
    smithersRunId: string;
    workflowName: string;
    workflowSource: "saved" | "artifact";
    entryPath?: string | null;
    savedEntryId?: string | null;
    status: StructuredWorkflowStatus;
    smithersStatus?: string;
    waitKind?: StructuredWorkflowWaitKind | null;
    continuedFromRunIds?: string[];
    activeDescendantRunId?: string | null;
    lastEventSeq?: number | null;
    pendingAttentionSeq?: number | null;
    lastAttentionSeq?: number | null;
    heartbeatAt?: string | null;
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
           workflow_source,
           entry_path,
           saved_entry_id,
           status,
           smithers_status,
           wait_kind,
           continued_from_run_ids_json,
           active_descendant_run_id,
           last_event_seq,
           pending_attention_seq,
           last_attention_seq,
           heartbeat_at,
           summary,
           started_at,
           updated_at,
           finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workflowId,
        thread.session_id,
        input.threadId,
        input.commandId,
        input.smithersRunId,
        input.workflowName,
        input.workflowSource,
        input.entryPath ?? null,
        input.savedEntryId ?? null,
        input.status,
        input.smithersStatus ?? defaultSmithersStatusForWorkflowStatus(input.status),
        input.waitKind ?? defaultWaitKindForWorkflowStatus(input.status),
        toJson(input.continuedFromRunIds ?? []),
        input.activeDescendantRunId ?? null,
        input.lastEventSeq ?? null,
        input.pendingAttentionSeq ?? null,
        input.lastAttentionSeq ?? null,
        input.heartbeatAt ?? null,
        input.summary,
        timestamp,
        timestamp,
        isTerminalWorkflowStatus(input.status) ? timestamp : null,
      );

    this.recordEvent({
      sessionId: thread.session_id,
      kind: "workflowRun.created",
      subjectKind: "workflowRun",
      subjectId: workflowId,
      at: timestamp,
    });

    return this.mustFindWorkflowRunRecord(workflowId);
  }

  updateWorkflow(input: {
    workflowId: string;
    commandId?: string;
    status: StructuredWorkflowStatus;
    smithersStatus?: string;
    waitKind?: StructuredWorkflowWaitKind | null;
    continuedFromRunIds?: string[];
    activeDescendantRunId?: string | null;
    lastEventSeq?: number | null;
    pendingAttentionSeq?: number | null;
    lastAttentionSeq?: number | null;
    heartbeatAt?: string | null;
    summary: string;
  }): StructuredWorkflowRunRecord {
    const existing = this.mustFindWorkflowRunRow(input.workflowId);
    if (input.commandId) {
      this.mustFindCommandRow(input.commandId);
    }
    const timestamp = this.now();
    this.db
      .query(
        `UPDATE workflow_run
         SET command_id = ?,
             status = ?,
             smithers_status = ?,
             wait_kind = ?,
             continued_from_run_ids_json = ?,
             active_descendant_run_id = ?,
             last_event_seq = ?,
             pending_attention_seq = ?,
             last_attention_seq = ?,
             heartbeat_at = ?,
             summary = ?,
             updated_at = ?,
             finished_at = ?
         WHERE id = ?`,
      )
      .run(
        input.commandId ?? existing.command_id,
        input.status,
        input.smithersStatus ?? existing.smithers_status,
        input.waitKind === undefined ? existing.wait_kind : input.waitKind,
        input.continuedFromRunIds === undefined
          ? existing.continued_from_run_ids_json
          : toJson(input.continuedFromRunIds),
        input.activeDescendantRunId === undefined
          ? existing.active_descendant_run_id
          : (input.activeDescendantRunId ?? null),
        input.lastEventSeq === undefined ? existing.last_event_seq : input.lastEventSeq,
        input.pendingAttentionSeq === undefined
          ? existing.pending_attention_seq
          : input.pendingAttentionSeq,
        input.lastAttentionSeq === undefined ? existing.last_attention_seq : input.lastAttentionSeq,
        input.heartbeatAt === undefined ? existing.heartbeat_at : (input.heartbeatAt ?? null),
        input.summary,
        timestamp,
        isTerminalWorkflowStatus(input.status) ? timestamp : null,
        input.workflowId,
      );

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
        pinnedAt: session.pinned_at,
        archivedAt: session.archived_at,
        wait: this.mapSessionWait(session),
      },
      turns: this.queryTurnRecords(sessionId),
      threads: this.queryThreadRecords(sessionId),
      threadContexts: this.queryThreadContextRecords(sessionId),
      commands: this.queryCommandRecords(sessionId),
      episodes: this.queryEpisodeRecords(sessionId),
      ciRuns: this.queryProjectCiRunRecords(sessionId),
      ciCheckResults: this.queryProjectCiCheckResultRecords(sessionId),
      workflowRuns,
      workflowTaskAttempts: this.queryWorkflowTaskAttemptRecords(sessionId),
      workflowTaskMessages: this.queryWorkflowTaskMessageRecords(sessionId),
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
    const workflowTaskAttempts = this.queryWorkflowTaskAttemptRecordsForThread(threadId);
    const latestWorkflowRun =
      workflowRuns.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ??
      null;

    return {
      thread,
      childThreads: this.queryThreadRowsByParent(threadId).map((row) => this.mapThread(row)),
      commands: this.queryCommandRowsByThread(threadId).map((row) => this.mapCommand(row)),
      episodes: this.queryEpisodeRowsByThread(threadId).map((row) => this.mapEpisode(row)),
      threadContexts: this.queryThreadContextRowsByThread(threadId).map((row) =>
        this.mapThreadContext(row),
      ),
      ciRuns: this.queryProjectCiRunRowsByThread(threadId).map((row) => this.mapProjectCiRun(row)),
      ciCheckResults: this.queryProjectCiCheckResultRowsByThread(threadId).map((row) =>
        this.mapProjectCiCheckResult(row),
      ),
      workflowRuns,
      latestWorkflowRun,
      workflowTaskAttempts,
      workflowTaskMessages: this.queryWorkflowTaskMessageRowsByThread(threadId).map((row) =>
        this.mapWorkflowTaskMessage(row),
      ),
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
           session_mode,
           default_session_agent_json,
           quick_session_agent_json,
           default_orchestrator_prompt_key,
           message_count,
           pi_status,
           created_at,
           updated_at,
           orchestrator_pi_session_id,
           pinned_at,
           archived_at,
           wait_owner_kind,
           wait_thread_id,
           wait_kind,
           wait_reason,
           wait_resume_when,
           wait_since
         ) VALUES (?, ?, NULL, NULL, NULL, 'orchestrator', NULL, NULL, 'defaultSession', 0, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      )
      .run(sessionId, sessionId, "idle", timestamp, timestamp, sessionId);
    return this.mustFindSessionRow(sessionId);
  }

  private getSessionRow(sessionId: string): SessionRow | undefined {
    return this.db.query(`SELECT * FROM session WHERE session_id = ?`).get(sessionId) as
      | SessionRow
      | undefined;
  }

  private getWorkspaceSidebarStateRow(): WorkspaceSidebarStateRow | null {
    return (
      (this.db.query(`SELECT * FROM workspace_sidebar_state WHERE id = 1`).get() as
        | WorkspaceSidebarStateRow
        | undefined) ?? null
    );
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
    const row = this.db.query(`SELECT * FROM thread WHERE id = ?`).get(threadId) as
      | ThreadRow
      | undefined;
    if (!row) {
      throw new Error(`Structured thread not found: ${threadId}`);
    }
    return row;
  }

  private findThreadContextRow(threadId: string, contextKey: string): ThreadContextRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM thread_context
           WHERE thread_id = ? AND context_key = ?
           LIMIT 1`,
        )
        .get(threadId, contextKey) as ThreadContextRow | undefined) ?? null
    );
  }

  private mustFindCommandRow(commandId: string): CommandRow {
    const row = this.db.query(`SELECT * FROM command WHERE id = ?`).get(commandId) as
      | CommandRow
      | undefined;
    if (!row) {
      throw new Error(`Structured command not found: ${commandId}`);
    }
    return row;
  }

  private mustFindEpisodeRow(episodeId: string): EpisodeRow {
    const row = this.db.query(`SELECT * FROM episode WHERE id = ?`).get(episodeId) as
      | EpisodeRow
      | undefined;
    if (!row) {
      throw new Error(`Structured episode not found: ${episodeId}`);
    }
    return row;
  }

  private mustFindWorkflowRunRow(workflowId: string): WorkflowRunRow {
    const row = this.db.query(`SELECT * FROM workflow_run WHERE id = ?`).get(workflowId) as
      | WorkflowRunRow
      | undefined;
    if (!row) {
      throw new Error(`Structured workflow run not found: ${workflowId}`);
    }
    return row;
  }

  private findWorkflowRunRowBySmithersRunId(smithersRunId: string): WorkflowRunRow | null {
    return (
      (this.db
        .query(`SELECT * FROM workflow_run WHERE smithers_run_id = ? LIMIT 1`)
        .get(smithersRunId) as WorkflowRunRow | undefined) ?? null
    );
  }

  private mustFindWorkflowTaskAttemptRow(workflowTaskAttemptId: string): WorkflowTaskAttemptRow {
    const row = this.db
      .query(`SELECT * FROM workflow_task_attempt WHERE id = ?`)
      .get(workflowTaskAttemptId) as WorkflowTaskAttemptRow | undefined;
    if (!row) {
      throw new Error(`Structured workflow task attempt not found: ${workflowTaskAttemptId}`);
    }
    return row;
  }

  private findWorkflowTaskAttemptRowByIdentity(input: {
    workflowRunId: string;
    nodeId: string;
    iteration: number;
    attempt: number;
  }): WorkflowTaskAttemptRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM workflow_task_attempt
           WHERE workflow_run_id = ? AND node_id = ? AND iteration = ? AND attempt = ?
           LIMIT 1`,
        )
        .get(input.workflowRunId, input.nodeId, input.iteration, input.attempt) as
        | WorkflowTaskAttemptRow
        | undefined) ?? null
    );
  }

  private findWorkflowTaskAttemptRowByAgentResume(
    agentResume: string,
  ): WorkflowTaskAttemptRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM workflow_task_attempt
           WHERE agent_resume = ?
           ORDER BY updated_at DESC, rowid DESC
           LIMIT 1`,
        )
        .get(agentResume) as WorkflowTaskAttemptRow | undefined) ?? null
    );
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

  private mustFindThreadContextRecord(contextId: string): StructuredThreadContextRecord {
    const row = this.db.query(`SELECT * FROM thread_context WHERE id = ?`).get(contextId) as
      | ThreadContextRow
      | undefined;
    if (!row) {
      throw new Error(`Structured thread context not found: ${contextId}`);
    }
    return this.mapThreadContext(row);
  }

  private mustFindProjectCiRunRecord(ciRunId: string): StructuredProjectCiRunRecord {
    const row = this.db.query(`SELECT * FROM ci_run WHERE id = ?`).get(ciRunId) as
      | ProjectCiRunRow
      | undefined;
    if (!row) {
      throw new Error(`Structured Project CI run not found: ${ciRunId}`);
    }
    return this.mapProjectCiRun(row);
  }

  private mustFindProjectCiCheckResultRecord(
    checkResultId: string,
  ): StructuredProjectCiCheckResultRecord {
    const row = this.db.query(`SELECT * FROM ci_check_result WHERE id = ?`).get(checkResultId) as
      | ProjectCiCheckResultRow
      | undefined;
    if (!row) {
      throw new Error(`Structured Project CI check result not found: ${checkResultId}`);
    }
    return this.mapProjectCiCheckResult(row);
  }

  private mustFindWorkflowRunRecord(workflowId: string): StructuredWorkflowRunRecord {
    return this.mapWorkflowRun(this.mustFindWorkflowRunRow(workflowId));
  }

  private mustFindWorkflowTaskAttemptRecord(
    workflowTaskAttemptId: string,
  ): StructuredWorkflowTaskAttemptRecord {
    return this.mapWorkflowTaskAttempt(this.mustFindWorkflowTaskAttemptRow(workflowTaskAttemptId));
  }

  private mustFindArtifactRecord(artifactId: string): StructuredArtifactRecord {
    const row = this.db.query(`SELECT * FROM artifact WHERE id = ?`).get(artifactId) as
      | ArtifactRow
      | undefined;
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

  private queryThreadContextRows(sessionId: string): ThreadContextRow[] {
    return this.db
      .query(`SELECT * FROM thread_context WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as ThreadContextRow[];
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

  private queryProjectCiRunRows(sessionId: string): ProjectCiRunRow[] {
    return this.db
      .query(`SELECT * FROM ci_run WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as ProjectCiRunRow[];
  }

  private queryProjectCiCheckResultRows(sessionId: string): ProjectCiCheckResultRow[] {
    return this.db
      .query(`SELECT * FROM ci_check_result WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as ProjectCiCheckResultRow[];
  }

  private queryWorkflowRunRows(sessionId: string): WorkflowRunRow[] {
    return this.db
      .query(`SELECT * FROM workflow_run WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as WorkflowRunRow[];
  }

  private queryWorkflowTaskAttemptRows(sessionId: string): WorkflowTaskAttemptRow[] {
    return this.db
      .query(`SELECT * FROM workflow_task_attempt WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as WorkflowTaskAttemptRow[];
  }

  private queryWorkflowTaskMessageRows(sessionId: string): WorkflowTaskMessageRow[] {
    return this.db
      .query(`SELECT * FROM workflow_task_message WHERE session_id = ? ORDER BY rowid ASC`)
      .all(sessionId) as WorkflowTaskMessageRow[];
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

  private queryThreadContextRecords(sessionId: string): StructuredThreadContextRecord[] {
    return this.queryThreadContextRows(sessionId).map((row) => this.mapThreadContext(row));
  }

  private queryCommandRecords(sessionId: string): StructuredCommandRecord[] {
    return this.queryCommandRows(sessionId).map((row) => this.mapCommand(row));
  }

  private queryEpisodeRecords(sessionId: string): StructuredEpisodeRecord[] {
    return this.queryEpisodeRows(sessionId).map((row) => this.mapEpisode(row));
  }

  private queryProjectCiRunRecords(sessionId: string): StructuredProjectCiRunRecord[] {
    return this.queryProjectCiRunRows(sessionId).map((row) => this.mapProjectCiRun(row));
  }

  private queryProjectCiCheckResultRecords(
    sessionId: string,
  ): StructuredProjectCiCheckResultRecord[] {
    return this.queryProjectCiCheckResultRows(sessionId).map((row) =>
      this.mapProjectCiCheckResult(row),
    );
  }

  private queryWorkflowRunRecords(sessionId: string): StructuredWorkflowRunRecord[] {
    return this.queryWorkflowRunRows(sessionId).map((row) => this.mapWorkflowRun(row));
  }

  private queryWorkflowTaskAttemptRecords(
    sessionId: string,
  ): StructuredWorkflowTaskAttemptRecord[] {
    return this.queryWorkflowTaskAttemptRows(sessionId).map((row) =>
      this.mapWorkflowTaskAttempt(row),
    );
  }

  private queryWorkflowTaskMessageRecords(
    sessionId: string,
  ): StructuredWorkflowTaskMessageRecord[] {
    return this.queryWorkflowTaskMessageRows(sessionId).map((row) =>
      this.mapWorkflowTaskMessage(row),
    );
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

  private queryThreadContextRowsByThread(threadId: string): ThreadContextRow[] {
    return this.db
      .query(`SELECT * FROM thread_context WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as ThreadContextRow[];
  }

  private queryProjectCiRunRowsByThread(threadId: string): ProjectCiRunRow[] {
    return this.db
      .query(`SELECT * FROM ci_run WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as ProjectCiRunRow[];
  }

  private queryProjectCiCheckResultRowsByThread(threadId: string): ProjectCiCheckResultRow[] {
    return this.db
      .query(
        `SELECT check_result.*
         FROM ci_check_result AS check_result
         JOIN ci_run AS ci_run ON ci_run.id = check_result.ci_run_id
         WHERE ci_run.thread_id = ?
         ORDER BY check_result.rowid ASC`,
      )
      .all(threadId) as ProjectCiCheckResultRow[];
  }

  private queryWorkflowRunRowsForThread(threadId: string): WorkflowRunRow[] {
    return this.db
      .query(`SELECT * FROM workflow_run WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as WorkflowRunRow[];
  }

  private queryWorkflowRunRecordsForThread(threadId: string): StructuredWorkflowRunRecord[] {
    return this.queryWorkflowRunRowsForThread(threadId).map((row) => this.mapWorkflowRun(row));
  }

  private queryWorkflowTaskAttemptRowsForThread(threadId: string): WorkflowTaskAttemptRow[] {
    return this.db
      .query(`SELECT * FROM workflow_task_attempt WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as WorkflowTaskAttemptRow[];
  }

  private queryWorkflowTaskAttemptRecordsForThread(
    threadId: string,
  ): StructuredWorkflowTaskAttemptRecord[] {
    return this.queryWorkflowTaskAttemptRowsForThread(threadId).map((row) =>
      this.mapWorkflowTaskAttempt(row),
    );
  }

  private queryWorkflowTaskMessageRowsByThread(threadId: string): WorkflowTaskMessageRow[] {
    return this.db
      .query(
        `SELECT message.*
         FROM workflow_task_message AS message
         JOIN workflow_task_attempt AS attempt ON attempt.id = message.workflow_task_attempt_id
         WHERE attempt.thread_id = ?
         ORDER BY message.rowid ASC`,
      )
      .all(threadId) as WorkflowTaskMessageRow[];
  }

  private queryWorkflowTaskMessageRowsByAttempt(
    workflowTaskAttemptId: string,
  ): WorkflowTaskMessageRow[] {
    return this.db
      .query(
        `SELECT * FROM workflow_task_message
         WHERE workflow_task_attempt_id = ?
         ORDER BY rowid ASC`,
      )
      .all(workflowTaskAttemptId) as WorkflowTaskMessageRow[];
  }

  private queryArtifactRowsByThread(threadId: string): ArtifactRow[] {
    return this.db
      .query(`SELECT * FROM artifact WHERE thread_id = ? ORDER BY rowid ASC`)
      .all(threadId) as ArtifactRow[];
  }

  private findProjectCiRunRowByWorkflowRunId(workflowRunId: string): ProjectCiRunRow | null {
    return (
      (this.db
        .query(`SELECT * FROM ci_run WHERE workflow_run_id = ? LIMIT 1`)
        .get(workflowRunId) as ProjectCiRunRow | undefined) ?? null
    );
  }

  private findProjectCiCheckResultRow(
    ciRunId: string,
    checkId: string,
  ): ProjectCiCheckResultRow | null {
    return (
      (this.db
        .query(
          `SELECT * FROM ci_check_result
           WHERE ci_run_id = ? AND check_id = ?
           LIMIT 1`,
        )
        .get(ciRunId, checkId) as ProjectCiCheckResultRow | undefined) ?? null
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
      if (threads.some((thread) => isRunnableThreadStatus(thread.status))) {
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

    if (
      threads.some((thread) => thread.id !== ownerThreadId && isRunnableThreadStatus(thread.status))
    ) {
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
      sessionMode: row.session_mode ?? undefined,
      defaultSessionAgentJson: row.default_session_agent_json,
      quickSessionAgentJson: row.quick_session_agent_json,
      defaultOrchestratorPromptKey: row.default_orchestrator_prompt_key ?? undefined,
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
      kind: row.wait_kind,
      reason: row.wait_reason,
      resumeWhen: row.wait_resume_when,
      since: row.wait_since,
    };
  }

  private mapWorkspaceSidebarState(row: WorkspaceSidebarStateRow): StructuredWorkspaceSidebarState {
    return {
      archivedGroupCollapsed: Boolean(row.archived_group_collapsed),
      updatedAt: row.updated_at,
    };
  }

  private mapTurn(row: TurnRow): StructuredTurnRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      surfacePiSessionId: row.surface_pi_session_id,
      threadId: row.thread_id,
      requestSummary: row.request_summary,
      turnDecision: row.turn_decision,
      status: row.status,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapThreadWait(row: ThreadRow): StructuredWaitState | null {
    if (
      !row.wait_owner ||
      !row.wait_kind ||
      !row.wait_reason ||
      !row.wait_resume_when ||
      !row.wait_since
    ) {
      return null;
    }
    return {
      owner: row.wait_owner,
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
      loadedContextKeys: this.queryThreadContextRowsByThread(row.id).map(
        (context) => context.context_key,
      ),
      worktree: row.worktree ?? undefined,
      sessionAgentJson: row.session_agent_json,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapThreadContext(row: ThreadContextRow): StructuredThreadContextRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      contextKey: row.context_key,
      contextVersion: row.context_version,
      loadedByCommandId: row.loaded_by_command_id,
      loadedAt: row.loaded_at,
    };
  }

  private mapCommand(row: CommandRow): StructuredCommandRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      workflowTaskAttemptId: row.workflow_task_attempt_id,
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
    if (row.thread_id === null) {
      throw new Error(`Structured episode ${row.id} is missing its thread ownership.`);
    }

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

  private mapProjectCiRun(row: ProjectCiRunRow): StructuredProjectCiRunRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      workflowRunId: row.workflow_run_id,
      smithersRunId: row.smithers_run_id,
      workflowId: row.workflow_id,
      entryPath: row.entry_path,
      status: row.status,
      summary: row.summary,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }

  private mapProjectCiCheckResult(
    row: ProjectCiCheckResultRow,
  ): StructuredProjectCiCheckResultRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      ciRunId: row.ci_run_id,
      workflowRunId: row.workflow_run_id,
      checkId: row.check_id,
      label: row.label,
      kind: row.kind,
      status: row.status,
      required: Boolean(row.required),
      command: fromJson<string[]>(row.command_json),
      exitCode: row.exit_code,
      summary: row.summary,
      artifactIds: fromJson<string[]>(row.artifact_ids_json) ?? [],
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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
      workflowSource: row.workflow_source,
      entryPath: row.entry_path,
      savedEntryId: row.saved_entry_id,
      status: row.status,
      smithersStatus: row.smithers_status,
      waitKind: row.wait_kind,
      continuedFromRunIds: fromJson<string[]>(row.continued_from_run_ids_json) ?? [],
      activeDescendantRunId: row.active_descendant_run_id,
      lastEventSeq: row.last_event_seq,
      pendingAttentionSeq: row.pending_attention_seq,
      lastAttentionSeq: row.last_attention_seq,
      heartbeatAt: row.heartbeat_at,
      summary: row.summary,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapWorkflowTaskAttempt(row: WorkflowTaskAttemptRow): StructuredWorkflowTaskAttemptRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      workflowRunId: row.workflow_run_id,
      smithersRunId: row.smithers_run_id,
      nodeId: row.node_id,
      iteration: row.iteration,
      attempt: row.attempt,
      surfacePiSessionId: row.surface_pi_session_id,
      title: row.title,
      summary: row.summary,
      kind: row.kind,
      status: row.status,
      smithersState: row.smithers_state,
      prompt: row.prompt,
      responseText: row.response_text,
      error: row.error,
      cached: Boolean(row.cached),
      jjPointer: row.jj_pointer,
      jjCwd: row.jj_cwd,
      heartbeatAt: row.heartbeat_at,
      agentId: row.agent_id,
      agentModel: row.agent_model,
      agentEngine: row.agent_engine,
      agentResume: row.agent_resume,
      meta: fromJson<Record<string, unknown>>(row.meta_json),
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
    };
  }

  private mapWorkflowTaskMessage(row: WorkflowTaskMessageRow): StructuredWorkflowTaskMessageRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      workflowTaskAttemptId: row.workflow_task_attempt_id,
      role: row.role,
      source: row.source,
      smithersEventSeq: row.smithers_event_seq,
      text: row.text,
      createdAt: row.created_at,
    };
  }

  private mapArtifact(row: ArtifactRow): StructuredArtifactRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      workflowRunId: row.workflow_run_id,
      workflowTaskAttemptId: row.workflow_task_attempt_id,
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
      session_mode TEXT,
      default_session_agent_json TEXT,
      quick_session_agent_json TEXT,
      default_orchestrator_prompt_key TEXT,
      message_count INTEGER NOT NULL,
      pi_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      orchestrator_pi_session_id TEXT NOT NULL,
      pinned_at TEXT,
      archived_at TEXT,
      wait_owner_kind TEXT,
      wait_thread_id TEXT,
      wait_kind TEXT,
      wait_reason TEXT,
      wait_resume_when TEXT,
      wait_since TEXT
    );

    CREATE TABLE IF NOT EXISTS workspace_sidebar_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      archived_group_collapsed INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS turn (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      surface_pi_session_id TEXT NOT NULL,
      thread_id TEXT,
      request_summary TEXT NOT NULL,
      turn_decision TEXT NOT NULL DEFAULT 'pending',
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
      wait_owner TEXT,
      wait_kind TEXT,
      wait_reason TEXT,
      wait_resume_when TEXT,
      wait_since TEXT,
      worktree TEXT,
      session_agent_json TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS thread_context (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      context_key TEXT NOT NULL,
      context_version TEXT NOT NULL,
      loaded_by_command_id TEXT,
      loaded_at TEXT NOT NULL,
      UNIQUE(thread_id, context_key)
    );

    CREATE TABLE IF NOT EXISTS command (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT,
      workflow_task_attempt_id TEXT,
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

    CREATE TABLE IF NOT EXISTS ci_run (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      workflow_run_id TEXT NOT NULL,
      smithers_run_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      entry_path TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workflow_run_id)
    );

    CREATE TABLE IF NOT EXISTS ci_check_result (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      ci_run_id TEXT NOT NULL,
      workflow_run_id TEXT NOT NULL,
      check_id TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      required INTEGER NOT NULL,
      command_json TEXT,
      exit_code INTEGER,
      summary TEXT NOT NULL,
      artifact_ids_json TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(ci_run_id, check_id)
    );

    CREATE TABLE IF NOT EXISTS workflow_run (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      smithers_run_id TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      workflow_source TEXT NOT NULL,
      entry_path TEXT,
      saved_entry_id TEXT,
      status TEXT NOT NULL,
      smithers_status TEXT NOT NULL,
      wait_kind TEXT,
      continued_from_run_ids_json TEXT,
      active_descendant_run_id TEXT,
      last_event_seq INTEGER,
      pending_attention_seq INTEGER,
      last_attention_seq INTEGER,
      heartbeat_at TEXT,
      summary TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS workflow_task_attempt (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      workflow_run_id TEXT NOT NULL,
      smithers_run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      iteration INTEGER NOT NULL,
      attempt INTEGER NOT NULL,
      surface_pi_session_id TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      smithers_state TEXT NOT NULL,
      prompt TEXT,
      response_text TEXT,
      error TEXT,
      cached INTEGER,
      jj_pointer TEXT,
      jj_cwd TEXT,
      heartbeat_at TEXT,
      agent_id TEXT,
      agent_model TEXT,
      agent_engine TEXT,
      agent_resume TEXT,
      meta_json TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS workflow_task_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      workflow_task_attempt_id TEXT NOT NULL,
      role TEXT NOT NULL,
      source TEXT NOT NULL,
      smithers_event_seq INTEGER,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifact (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      thread_id TEXT,
      workflow_run_id TEXT,
      workflow_task_attempt_id TEXT,
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
  ensureColumn(db, "session", "pinned_at", "TEXT");
  ensureColumn(db, "session", "archived_at", "TEXT");
  ensureColumn(db, "session", "session_mode", "TEXT");
  ensureColumn(db, "session", "default_session_agent_json", "TEXT");
  ensureColumn(db, "session", "quick_session_agent_json", "TEXT");
  ensureColumn(db, "session", "default_orchestrator_prompt_key", "TEXT");
  ensureColumn(db, "thread", "session_agent_json", "TEXT");
}

function ensureColumn(
  db: Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const columns = db.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function toJson(value: unknown): string | null {
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
  return status === "completed";
}

function isRunnableThreadStatus(status: StructuredThreadStatus): boolean {
  return (
    status === "running-handler" || status === "running-workflow" || status === "troubleshooting"
  );
}

function isTerminalWorkflowStatus(status: StructuredWorkflowStatus): boolean {
  return (
    status === "continued" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function isTerminalWorkflowTaskAttemptStatus(status: StructuredWorkflowTaskAttemptStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function defaultSmithersStatusForWorkflowStatus(status: StructuredWorkflowStatus): string {
  switch (status) {
    case "running":
      return "running";
    case "waiting":
      return "waiting-event";
    case "continued":
      return "continued";
    case "completed":
      return "finished";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

function defaultWaitKindForWorkflowStatus(
  status: StructuredWorkflowStatus,
): StructuredWorkflowWaitKind | null {
  return status === "waiting" ? "event" : null;
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
