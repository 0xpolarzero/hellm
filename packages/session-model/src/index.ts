import { resolve } from "node:path";

export type HellmExecutionPath =
  | "direct"
  | "pi-worker"
  | "smithers-workflow"
  | "verification"
  | "approval";

export type ThreadKind =
  | "direct"
  | "pi-worker"
  | "smithers-workflow"
  | "verification"
  | "approval";

export type ThreadStatus =
  | "pending"
  | "running"
  | "waiting_input"
  | "waiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type EpisodeSource =
  | "orchestrator"
  | "pi-worker"
  | "smithers"
  | "verification";

export type EpisodeStatus =
  | "completed"
  | "completed_with_issues"
  | "waiting_input"
  | "waiting_approval"
  | "blocked"
  | "failed"
  | "cancelled";

export type ArtifactKind =
  | "file"
  | "diff"
  | "log"
  | "test-report"
  | "screenshot"
  | "workflow-run"
  | "note";

export type VerificationKind =
  | "build"
  | "test"
  | "lint"
  | "manual"
  | "integration";

export type VerificationStatus = "passed" | "failed" | "skipped" | "unknown";

export interface ThreadRef {
  id: string;
  kind: ThreadKind;
  status: ThreadStatus;
  objective: string;
  parentThreadId?: string;
  inputEpisodeIds: string[];
  worktreePath?: string;
  smithersRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRecord {
  id: string;
  kind: ArtifactKind;
  description: string;
  path?: string;
  createdAt: string;
}

export interface VerificationRecord {
  id: string;
  kind: VerificationKind;
  status: VerificationStatus;
  summary: string;
  artifactIds: string[];
  createdAt: string;
}

export interface EpisodeProvenance {
  executionPath: HellmExecutionPath;
  actor: EpisodeSource | "orchestrator";
  sourceRef?: string;
  notes?: string;
}

export interface Episode {
  id: string;
  threadId: string;
  source: EpisodeSource;
  objective: string;
  status: EpisodeStatus;
  conclusions: string[];
  changedFiles: string[];
  artifacts: ArtifactRecord[];
  verification: VerificationRecord[];
  unresolvedIssues: string[];
  followUpSuggestions: string[];
  provenance: EpisodeProvenance;
  smithersRunId?: string;
  worktreePath?: string;
  startedAt: string;
  completedAt?: string;
  inputEpisodeIds: string[];
}

export interface WorkflowRunReference {
  runId: string;
  threadId: string;
  workflowId: string;
  status:
    | "running"
    | "waiting_approval"
    | "waiting_resume"
    | "completed"
    | "failed"
    | "cancelled";
  updatedAt: string;
  worktreePath?: string;
}

export interface SmithersStateIsolationRecord {
  runId: string;
  runStateStore: string;
  sessionEntryIds: string[];
}

export interface GlobalVerificationState {
  overallStatus: VerificationStatus;
  byKind: Partial<Record<VerificationKind, VerificationRecord>>;
}

export interface SessionWorktreeAlignmentState {
  sessionCwd: string;
  activeWorktreePath?: string;
  aligned: boolean;
  reason: string;
}

export interface SessionState {
  sessionId: string;
  sessionCwd: string;
  threads: ThreadRef[];
  episodes: Episode[];
  artifacts: ArtifactRecord[];
  verification: GlobalVerificationState;
  alignment: SessionWorktreeAlignmentState;
  workflowRuns: WorkflowRunReference[];
  smithersIsolations: SmithersStateIsolationRecord[];
}

export type ReconstructedSessionState = SessionState;
export type SessionWorktreeAlignment = SessionWorktreeAlignmentState;

export interface ThreadSnapshot {
  thread: ThreadRef;
  episodes: Episode[];
  artifacts: ArtifactRecord[];
  verification: GlobalVerificationState;
  alignment: SessionWorktreeAlignmentState;
  workflowRuns: WorkflowRunReference[];
}

export interface CreateThreadInput {
  id: string;
  kind: ThreadKind;
  objective: string;
  inputEpisodeIds?: string[];
  status?: ThreadStatus;
  parentThreadId?: string;
  worktreePath?: string;
  smithersRunId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateArtifactInput {
  id: string;
  kind: ArtifactKind;
  description: string;
  path?: string;
  createdAt: string;
}

export interface CreateVerificationInput {
  id: string;
  kind: VerificationKind;
  status: VerificationStatus;
  summary: string;
  artifactIds?: string[];
  createdAt: string;
}

export interface CreateEpisodeInput {
  id: string;
  threadId: string;
  source: EpisodeSource;
  objective: string;
  status: EpisodeStatus;
  conclusions?: string[];
  changedFiles?: string[];
  artifacts?: ArtifactRecord[];
  verification?: VerificationRecord[];
  unresolvedIssues?: string[];
  followUpSuggestions?: string[];
  provenance: EpisodeProvenance;
  smithersRunId?: string;
  worktreePath?: string;
  startedAt: string;
  completedAt?: string;
  inputEpisodeIds?: string[];
}

export type StructuredPayload =
  | { kind: "thread"; data: ThreadRef }
  | { kind: "episode"; data: Episode }
  | { kind: "artifact"; data: ArtifactRecord }
  | { kind: "verification"; data: GlobalVerificationState | VerificationRecord }
  | { kind: "alignment"; data: SessionWorktreeAlignmentState }
  | { kind: "workflow-run"; data: WorkflowRunReference }
  | { kind: "smithers-isolation"; data: SmithersStateIsolationRecord };

export interface SessionHeader {
  type: "session";
  version: 3;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface StructuredSessionEntry {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message: {
    role: "custom";
    customType: `hellm/${StructuredPayload["kind"]}`;
    content: string;
    display: false;
    details: StructuredPayload;
    timestamp: number;
  };
}

export type SessionJsonlEntry = SessionHeader | StructuredSessionEntry | Record<string, unknown>;

export const THREAD_STATUS_TRANSITIONS: Readonly<
  Record<ThreadStatus, readonly ThreadStatus[]>
> = {
  pending: ["running", "cancelled"],
  running: [
    "waiting_input",
    "waiting_approval",
    "blocked",
    "completed",
    "failed",
    "cancelled",
  ],
  waiting_input: ["running", "cancelled"],
  waiting_approval: ["running", "failed", "cancelled"],
  blocked: ["running", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

const FILE_BACKED_ARTIFACT_KINDS = new Set<ArtifactKind>([
  "file",
  "diff",
  "log",
  "test-report",
  "screenshot",
]);

export function createThread(input: CreateThreadInput): ThreadRef {
  return {
    id: input.id,
    kind: input.kind,
    status: input.status ?? "pending",
    objective: input.objective,
    ...(input.parentThreadId ? { parentThreadId: input.parentThreadId } : {}),
    inputEpisodeIds: [...(input.inputEpisodeIds ?? [])],
    ...(input.worktreePath ? { worktreePath: input.worktreePath } : {}),
    ...(input.smithersRunId ? { smithersRunId: input.smithersRunId } : {}),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
  };
}

export const createThreadRef = createThread;

export function createArtifact(input: CreateArtifactInput): ArtifactRecord {
  if (FILE_BACKED_ARTIFACT_KINDS.has(input.kind) && !input.path) {
    throw new Error(`Artifact kind "${input.kind}" requires a file path.`);
  }

  return {
    id: input.id,
    kind: input.kind,
    description: input.description,
    ...(input.path ? { path: input.path } : {}),
    createdAt: input.createdAt,
  };
}

export const createArtifactRecord = createArtifact;

export function isFileAddressableArtifact(artifact: ArtifactRecord): boolean {
  return typeof artifact.path === "string" && artifact.path.length > 0;
}

export function createVerificationRecord(
  input: CreateVerificationInput,
): VerificationRecord {
  return {
    id: input.id,
    kind: input.kind,
    status: input.status,
    summary: input.summary,
    artifactIds: input.artifactIds ?? [],
    createdAt: input.createdAt,
  };
}

export function createEpisode(input: CreateEpisodeInput): Episode {
  return {
    id: input.id,
    threadId: input.threadId,
    source: input.source,
    objective: input.objective,
    status: input.status,
    conclusions: input.conclusions ?? [],
    changedFiles: input.changedFiles ?? [],
    artifacts: input.artifacts ?? [],
    verification: input.verification ?? [],
    unresolvedIssues: input.unresolvedIssues ?? [],
    followUpSuggestions: input.followUpSuggestions ?? [],
    provenance: input.provenance,
    ...(input.smithersRunId ? { smithersRunId: input.smithersRunId } : {}),
    ...(input.worktreePath ? { worktreePath: input.worktreePath } : {}),
    startedAt: input.startedAt,
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    inputEpisodeIds: input.inputEpisodeIds ?? [],
  };
}

export function createGlobalVerificationState(
  records: readonly VerificationRecord[] = [],
): GlobalVerificationState {
  const byKind: Partial<Record<VerificationKind, VerificationRecord>> = {};
  for (const record of records) {
    byKind[record.kind] = record;
  }

  const effectiveRecords = Object.values(byKind);
  const overallStatus = effectiveRecords.some((record) => record.status === "failed")
    ? "failed"
    : effectiveRecords.length > 0 &&
        effectiveRecords.every((record) => record.status === "passed")
      ? "passed"
      : "unknown";

  return {
    overallStatus,
    byKind,
  };
}

export function createSessionWorktreeAlignment(input: {
  sessionCwd: string;
  activeWorktreePath?: string;
}): SessionWorktreeAlignmentState {
  const sessionCwd = resolve(input.sessionCwd);
  const activeWorktreePath = input.activeWorktreePath
    ? resolve(input.activeWorktreePath)
    : undefined;
  const aligned = activeWorktreePath === undefined || activeWorktreePath === sessionCwd;

  return {
    sessionCwd,
    ...(activeWorktreePath ? { activeWorktreePath } : {}),
    aligned,
    reason: aligned
      ? "session and worktree are aligned"
      : "active worktree differs from the session cwd",
  };
}

export function createEmptySessionState(input: {
  sessionId: string;
  sessionCwd: string;
  activeWorktreePath?: string;
}): SessionState {
  return {
    sessionId: input.sessionId,
    sessionCwd: resolve(input.sessionCwd),
    threads: [],
    episodes: [],
    artifacts: [],
    verification: createGlobalVerificationState(),
    alignment: createSessionWorktreeAlignment(
      input.activeWorktreePath
        ? {
            sessionCwd: input.sessionCwd,
            activeWorktreePath: input.activeWorktreePath,
          }
        : {
            sessionCwd: input.sessionCwd,
          },
    ),
    workflowRuns: [],
    smithersIsolations: [],
  };
}

export function canTransitionThreadStatus(
  from: ThreadStatus,
  to: ThreadStatus,
): boolean {
  return from === to || THREAD_STATUS_TRANSITIONS[from].includes(to);
}

export function transitionThreadStatus(
  thread: ThreadRef,
  nextStatus: ThreadStatus,
  updatedAt: string,
): ThreadRef {
  if (!canTransitionThreadStatus(thread.status, nextStatus)) {
    throw new Error(
      `Cannot transition thread ${thread.id} from ${thread.status} to ${nextStatus}.`,
    );
  }

  return {
    ...thread,
    status: nextStatus,
    updatedAt,
  };
}

export function createSessionHeader(input: {
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}): SessionHeader {
  return {
    type: "session",
    version: 3,
    id: input.id,
    timestamp: input.timestamp,
    cwd: resolve(input.cwd),
    ...(input.parentSession ? { parentSession: input.parentSession } : {}),
  };
}

export function createStructuredSessionEntry(input: {
  id: string;
  parentId: string | null;
  timestamp: string;
  payload: StructuredPayload;
}): StructuredSessionEntry {
  return {
    type: "message",
    id: input.id,
    parentId: input.parentId,
    timestamp: input.timestamp,
    message: {
      role: "custom",
      customType: `hellm/${input.payload.kind}`,
      content: `hellm:${input.payload.kind}`,
      display: false,
      details: input.payload,
      timestamp: Date.parse(input.timestamp),
    },
  };
}

export function serializeStructuredEntry(entry: StructuredSessionEntry): string {
  return JSON.stringify(entry);
}

export function parseStructuredEntry(
  entry: string | SessionJsonlEntry,
): StructuredSessionEntry | null {
  const raw = typeof entry === "string" ? safeParseJson(entry) : entry;
  if (
    !isRecord(raw) ||
    raw.type !== "message" ||
    !isRecord(raw.message) ||
    raw.message.role !== "custom" ||
    typeof raw.message.customType !== "string" ||
    !raw.message.customType.startsWith("hellm/")
  ) {
    return null;
  }

  return raw as unknown as StructuredSessionEntry;
}

export function parseStructuredSessionEntry(
  entry: SessionJsonlEntry,
): StructuredPayload | null {
  if (
    !isRecord(entry) ||
    entry.type !== "message" ||
    !isRecord(entry.message) ||
    entry.message.role !== "custom" ||
    typeof entry.message.customType !== "string" ||
    !entry.message.customType.startsWith("hellm/")
  ) {
    return null;
  }

  const details = entry.message.details;
  if (!isRecord(details) || typeof details.kind !== "string" || !("data" in details)) {
    return null;
  }

  return details as StructuredPayload;
}

export function reconstructSessionState(
  entries: readonly SessionJsonlEntry[],
): SessionState {
  const header = entries.find(
    (entry): entry is SessionHeader => isRecord(entry) && entry.type === "session",
  );

  const fallbackSessionId = header?.id ?? "session";
  const fallbackCwd = header?.cwd ?? process.cwd();

  const threads: ThreadRef[] = [];
  const episodes: Episode[] = [];
  const artifacts: ArtifactRecord[] = [];
  const verificationRecords: VerificationRecord[] = [];
  const workflowRuns: WorkflowRunReference[] = [];
  const smithersIsolations: SmithersStateIsolationRecord[] = [];
  let alignment = createSessionWorktreeAlignment({ sessionCwd: fallbackCwd });
  let globalVerification = createGlobalVerificationState();

  for (const entry of entries) {
    const payload = parseStructuredSessionEntry(entry);
    if (!payload) {
      continue;
    }

    switch (payload.kind) {
      case "thread":
        upsertById(threads, payload.data);
        break;
      case "episode":
        upsertById(episodes, payload.data);
        for (const artifact of payload.data.artifacts) {
          upsertById(artifacts, artifact);
        }
        for (const record of payload.data.verification) {
          upsertById(verificationRecords, record);
        }
        break;
      case "artifact":
        upsertById(artifacts, payload.data);
        break;
      case "verification":
        if ("byKind" in payload.data) {
          globalVerification = payload.data;
        } else {
          upsertById(verificationRecords, payload.data);
        }
        break;
      case "alignment":
        alignment = payload.data;
        break;
      case "workflow-run":
        upsertByKey(workflowRuns, payload.data, "runId");
        break;
      case "smithers-isolation":
        upsertByKey(smithersIsolations, payload.data, "runId");
        break;
    }
  }

  const derivedVerification =
    Object.keys(globalVerification.byKind).length > 0 || globalVerification.overallStatus !== "unknown"
      ? globalVerification
      : createGlobalVerificationState(verificationRecords);

  return {
    sessionId: fallbackSessionId,
    sessionCwd: resolve(fallbackCwd),
    threads,
    episodes,
    artifacts,
    verification: derivedVerification,
    alignment,
    workflowRuns,
    smithersIsolations,
  };
}

export function createThreadSnapshot(
  state: SessionState,
  threadId: string,
): ThreadSnapshot {
  const thread = state.threads.find((candidate) => candidate.id === threadId);
  if (!thread) {
    throw new Error(`Thread ${threadId} was not found in session state.`);
  }

  const episodes = state.episodes.filter((episode) => episode.threadId === threadId);
  const artifactIds = new Set(
    episodes.flatMap((episode) => episode.artifacts.map((artifact) => artifact.id)),
  );
  const artifacts = state.artifacts.filter((artifact) => artifactIds.has(artifact.id));

  return {
    thread,
    episodes,
    artifacts,
    verification: state.verification,
    alignment: state.alignment,
    workflowRuns: state.workflowRuns.filter((run) => run.threadId === threadId),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function upsertById<T extends { id: string }>(items: T[], value: T): void {
  const index = items.findIndex((item) => item.id === value.id);
  if (index === -1) {
    items.push(value);
    return;
  }

  items[index] = value;
}

function upsertByKey<T extends Record<K, string>, K extends keyof T>(
  items: T[],
  value: T,
  key: K,
): void {
  const index = items.findIndex((item) => item[key] === value[key]);
  if (index === -1) {
    items.push(value);
    return;
  }

  items[index] = value;
}
