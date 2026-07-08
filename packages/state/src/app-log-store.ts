import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type {
  AppLogEntry,
  AppLogLevel,
  AppLogQuery,
  AppLogReadModel,
  AppLogSource,
  AppLogSummary,
} from "@svvy/core";
import { StateContractError } from "@svvy/core";

const MEMORY_DATABASE = ":memory:";
const DEFAULT_MEMORY_LIMIT = 2_000;
const DEFAULT_PERSISTED_LIMIT = 10_000;
const DEFAULT_RETENTION_DAYS = 7;
const REDACTED = "[REDACTED]";
const VALID_LEVEL_CLAUSE = "level IN ('debug', 'info', 'warn', 'error')";
const SECRET_KEY_PATTERN =
  /(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|auth|authorization|cookie|secret|password|token|key)/i;
const HIGH_ENTROPY_CONTEXT_PATTERN =
  /(auth|authorization|provider|api[-_ ]?key|secret|token|password|cookie|credential)/i;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const KEY_VALUE_SECRET_PATTERN =
  /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|AUTH)[A-Z0-9_]*)\s*=\s*([^\s"'`]{6,}|["'`][^"'`]{6,}["'`])/gi;
const HIGH_ENTROPY_PATTERN = /\b[A-Za-z0-9+=_-]{32,}\b/g;

export interface CreateAppLogStoreOptions {
  databasePath?: string;
  busyTimeoutMs?: number;
  filesystemSetup?: "store" | "caller";
  now: () => string;
  memoryLimit?: number;
  persistedLimit?: number;
  retentionDays?: number;
}

export interface AppLogStore {
  append(entry: AppendAppLogEntry): AppLogEntry;
  query(query?: AppLogQuery): AppLogReadModel;
  summary(): AppLogSummary;
  markSeen(throughSeq: number): AppLogSummary;
  subscribe(listener: (entries: AppLogEntry[], summary: AppLogSummary) => void): () => void;
  close(): void;
}

export interface AppLogStateService {
  append(entry: AppendAppLogEntry): Effect.Effect<AppLogEntry, StateContractError>;
  query(query?: AppLogQuery): Effect.Effect<AppLogReadModel, StateContractError>;
  summary(): Effect.Effect<AppLogSummary, StateContractError>;
  markSeen(throughSeq: number): Effect.Effect<AppLogSummary, StateContractError>;
  subscribe(
    listener: (entries: AppLogEntry[], summary: AppLogSummary) => void,
  ): Effect.Effect<() => void, StateContractError>;
}

export class AppLogState extends Context.Service<AppLogState, AppLogStateService>()(
  "@svvy/state/AppLogState",
) {}

export interface AppendAppLogEntry {
  createdAt?: string;
  level: AppLogLevel;
  source: AppLogSource;
  message: string;
  details?: Record<string, unknown>;
  error?: unknown;
  workspaceSessionId?: string;
  surfacePiSessionId?: string;
  threadId?: string;
  workflowRunId?: string;
  workflowTaskAttemptId?: string;
  commandId?: string;
  artifactId?: string;
}

type AppLogRow = {
  id: string;
  seq: number;
  created_at: string;
  level: AppLogLevel;
  source: AppLogSource;
  message: string;
  details_json: string | null;
  error_json: string | null;
  workspace_session_id: string | null;
  surface_pi_session_id: string | null;
  thread_id: string | null;
  workflow_run_id: string | null;
  workflow_task_attempt_id: string | null;
  command_id: string | null;
  artifact_id: string | null;
};

type AppLogError = NonNullable<AppLogEntry["error"]>;

export function createAppLogStore(options: CreateAppLogStoreOptions): AppLogStore {
  return new SqliteAppLogStore(options);
}

export function appLogStateFromStore(store: AppLogStore): AppLogState["Service"] {
  return AppLogState.of({
    append: Effect.fn("@svvy/state/AppLogState.append")(function* (entry: AppendAppLogEntry) {
      return yield* tryAppLogStoreOperation("app-log.append", () => store.append(entry));
    }),
    query: Effect.fn("@svvy/state/AppLogState.query")(function* (query?: AppLogQuery) {
      return yield* tryAppLogStoreOperation("app-log.query", () => store.query(query));
    }),
    summary: Effect.fn("@svvy/state/AppLogState.summary")(function* () {
      return yield* tryAppLogStoreOperation("app-log.summary", () => store.summary());
    }),
    markSeen: Effect.fn("@svvy/state/AppLogState.markSeen")(function* (throughSeq: number) {
      return yield* tryAppLogStoreOperation("app-log.markSeen", () => store.markSeen(throughSeq));
    }),
    subscribe: Effect.fn("@svvy/state/AppLogState.subscribe")(function* (
      listener: (entries: AppLogEntry[], summary: AppLogSummary) => void,
    ) {
      return yield* tryAppLogStoreOperation("app-log.subscribe", () => store.subscribe(listener));
    }),
  });
}

export const makeAppLogState = Effect.fn("@svvy/state/makeAppLogState")(function* (
  options: CreateAppLogStoreOptions,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* prepareAppLogDatabasePath(options, fileSystem, path);
  const store = yield* Effect.acquireRelease(
    tryAppLogStoreOperation("app-log.open", () =>
      createAppLogStore({ ...options, filesystemSetup: "caller" }),
    ),
    (acquiredStore) =>
      tryAppLogStoreOperation("app-log.close", () => acquiredStore.close()).pipe(Effect.ignore),
  );
  return appLogStateFromStore(store);
});

export const layerAppLogState = (
  options: CreateAppLogStoreOptions,
): Layer.Layer<AppLogState, StateContractError, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(AppLogState, makeAppLogState(options));

export function redactAppLogValue(value: unknown): unknown {
  return redactValue(value, []);
}

function tryAppLogStoreOperation<A>(
  operation: string,
  run: () => A,
): Effect.Effect<A, StateContractError> {
  return Effect.try({
    try: run,
    catch: (cause) => appLogStoreError(operation, cause),
  });
}

function appLogStoreError(operation: string, cause: unknown): StateContractError {
  return new StateContractError({
    operation,
    reason: "transaction-failed",
    message: describeUnknownCause(cause),
    cause,
  });
}

function describeUnknownCause(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause) return cause;
  return "App log store operation failed.";
}

class SqliteAppLogStore implements AppLogStore {
  private readonly db: Database;
  private readonly now: () => string;
  private readonly memoryLimit: number;
  private readonly persistedLimit: number;
  private readonly retentionDays: number;
  private readonly listeners = new Set<(entries: AppLogEntry[], summary: AppLogSummary) => void>();
  private ring: AppLogEntry[] = [];
  private seenSeq = 0;
  private latestSeq = 0;

  constructor(options: CreateAppLogStoreOptions) {
    const databasePath = options.databasePath ?? MEMORY_DATABASE;
    if (databasePath !== MEMORY_DATABASE && options.filesystemSetup !== "caller") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.db = new Database(databasePath);
    applyBusyTimeout(this.db, options.busyTimeoutMs);
    this.now = options.now;
    this.memoryLimit = options.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
    this.persistedLimit = options.persistedLimit ?? DEFAULT_PERSISTED_LIMIT;
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    initializeSchema(this.db);
    this.seenSeq = this.readSeenSeq();
    this.latestSeq = this.readLatestSeq();
    this.ring = this.loadRing();
    this.enforceRetention();
  }

  append(input: AppendAppLogEntry): AppLogEntry {
    const createdAt = input.createdAt ?? this.now();
    const seq = this.latestSeq + 1;
    const error = normalizeError(input.error);
    const entry: AppLogEntry = {
      id: `app-log-${seq}`,
      seq,
      createdAt,
      level: input.level,
      source: input.source,
      message: redactString(input.message),
      ...(input.details
        ? { details: redactValue(input.details, []) as Record<string, unknown> }
        : {}),
      ...(error ? { error: redactValue(error, ["error"]) as AppLogError } : {}),
      ...(input.workspaceSessionId ? { workspaceSessionId: input.workspaceSessionId } : {}),
      ...(input.surfacePiSessionId ? { surfacePiSessionId: input.surfacePiSessionId } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.workflowRunId ? { workflowRunId: input.workflowRunId } : {}),
      ...(input.workflowTaskAttemptId
        ? { workflowTaskAttemptId: input.workflowTaskAttemptId }
        : {}),
      ...(input.commandId ? { commandId: input.commandId } : {}),
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    };

    this.db
      .query(
        `INSERT INTO app_log (
          id, seq, created_at, level, source, message, details_json, error_json,
          workspace_session_id, surface_pi_session_id, thread_id, workflow_run_id,
          workflow_task_attempt_id, command_id, artifact_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.seq,
        entry.createdAt,
        entry.level,
        entry.source,
        entry.message,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.error ? JSON.stringify(entry.error) : null,
        entry.workspaceSessionId ?? null,
        entry.surfacePiSessionId ?? null,
        entry.threadId ?? null,
        entry.workflowRunId ?? null,
        entry.workflowTaskAttemptId ?? null,
        entry.commandId ?? null,
        entry.artifactId ?? null,
      );

    this.latestSeq = seq;
    this.ring.push(entry);
    if (this.ring.length > this.memoryLimit) {
      this.ring = this.ring.slice(-this.memoryLimit);
    }
    this.enforceRetention();
    this.emit([entry]);
    return structuredClone(entry);
  }

  query(query: AppLogQuery = {}): AppLogReadModel {
    const limit = normalizeLimit(query.limit);
    const entries = this.queryEntries(query, limit);
    return {
      entries,
      summary: this.summary(),
    };
  }

  summary(): AppLogSummary {
    const rows = this.db
      .query(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN level = 'debug' THEN 1 ELSE 0 END) AS debug,
          SUM(CASE WHEN level = 'info' THEN 1 ELSE 0 END) AS info,
          SUM(CASE WHEN level = 'warn' THEN 1 ELSE 0 END) AS warn,
          SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS error,
          SUM(CASE WHEN seq > ? THEN 1 ELSE 0 END) AS unread_total,
          SUM(CASE WHEN seq > ? AND level = 'debug' THEN 1 ELSE 0 END) AS unread_debug,
          SUM(CASE WHEN seq > ? AND level = 'info' THEN 1 ELSE 0 END) AS unread_info,
          SUM(CASE WHEN seq > ? AND level = 'warn' THEN 1 ELSE 0 END) AS unread_warn,
          SUM(CASE WHEN seq > ? AND level = 'error' THEN 1 ELSE 0 END) AS unread_error,
          COALESCE(MAX(seq), 0) AS latest_seq
        FROM app_log
        WHERE ${VALID_LEVEL_CLAUSE}`,
      )
      .get(this.seenSeq, this.seenSeq, this.seenSeq, this.seenSeq, this.seenSeq) as {
      total: number | null;
      debug: number | null;
      info: number | null;
      warn: number | null;
      error: number | null;
      unread_total: number | null;
      unread_debug: number | null;
      unread_info: number | null;
      unread_warn: number | null;
      unread_error: number | null;
      latest_seq: number | null;
    };

    this.latestSeq = Math.max(this.latestSeq, rows.latest_seq ?? 0);

    return {
      latestSeq: this.latestSeq,
      seenSeq: this.seenSeq,
      unread: {
        total: rows.unread_total ?? 0,
        debug: rows.unread_debug ?? 0,
        info: rows.unread_info ?? 0,
        warn: rows.unread_warn ?? 0,
        error: rows.unread_error ?? 0,
      },
      totals: {
        total: rows.total ?? 0,
        debug: rows.debug ?? 0,
        info: rows.info ?? 0,
        warn: rows.warn ?? 0,
        error: rows.error ?? 0,
      },
    };
  }

  markSeen(throughSeq: number): AppLogSummary {
    const nextSeenSeq = Math.max(0, Math.min(Math.trunc(throughSeq), this.latestSeq));
    if (nextSeenSeq > this.seenSeq) {
      this.seenSeq = nextSeenSeq;
      this.db
        .query(
          `INSERT INTO app_log_state (id, seen_seq, updated_at)
           VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET seen_seq = excluded.seen_seq, updated_at = excluded.updated_at`,
        )
        .run(this.seenSeq, this.now());
      this.emit([]);
    }
    return this.summary();
  }

  subscribe(listener: (entries: AppLogEntry[], summary: AppLogSummary) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    this.listeners.clear();
    this.db.close();
  }

  private queryEntries(query: AppLogQuery, limit: number): AppLogEntry[] {
    const clauses: string[] = [VALID_LEVEL_CLAUSE];
    const params: Array<string | number> = [];
    if (query.afterSeq !== undefined) {
      clauses.push("seq > ?");
      params.push(Math.trunc(query.afterSeq));
    }
    if (query.beforeSeq !== undefined) {
      clauses.push("seq < ?");
      params.push(Math.trunc(query.beforeSeq));
    }
    if (query.levels?.length) {
      clauses.push(`level IN (${query.levels.map(() => "?").join(", ")})`);
      params.push(...query.levels);
    }
    if (query.sources?.length) {
      clauses.push(`source IN (${query.sources.map(() => "?").join(", ")})`);
      params.push(...query.sources);
    }
    const textQuery = query.query?.trim().toLowerCase();
    if (textQuery) {
      clauses.push(
        `(
          LOWER(message) LIKE ?
          OR LOWER(source) LIKE ?
          OR LOWER(level) LIKE ?
          OR LOWER(COALESCE(workspace_session_id, '')) LIKE ?
          OR LOWER(COALESCE(surface_pi_session_id, '')) LIKE ?
          OR LOWER(COALESCE(thread_id, '')) LIKE ?
          OR LOWER(COALESCE(workflow_run_id, '')) LIKE ?
          OR LOWER(COALESCE(workflow_task_attempt_id, '')) LIKE ?
          OR LOWER(COALESCE(command_id, '')) LIKE ?
          OR LOWER(COALESCE(artifact_id, '')) LIKE ?
          OR LOWER(COALESCE(details_json, '')) LIKE ?
          OR LOWER(COALESCE(error_json, '')) LIKE ?
        )`,
      );
      const like = `%${textQuery}%`;
      params.push(like, like, like, like, like, like, like, like, like, like, like, like);
    }
    const rows = this.db
      .query(`SELECT * FROM app_log WHERE ${clauses.join(" AND ")} ORDER BY seq DESC LIMIT ?`)
      .all(...params, limit) as AppLogRow[];
    return rows.toReversed().map(rowToEntry);
  }

  private readSeenSeq(): number {
    const row = this.db.query(`SELECT seen_seq FROM app_log_state WHERE id = 1`).get() as
      | { seen_seq: number }
      | undefined;
    return row?.seen_seq ?? 0;
  }

  private readLatestSeq(): number {
    const row = this.db.query(`SELECT COALESCE(MAX(seq), 0) AS latest_seq FROM app_log`).get() as {
      latest_seq: number;
    };
    return row.latest_seq;
  }

  private loadRing(): AppLogEntry[] {
    const rows = this.db
      .query(`SELECT * FROM app_log WHERE ${VALID_LEVEL_CLAUSE} ORDER BY seq DESC LIMIT ?`)
      .all(this.memoryLimit) as AppLogRow[];
    return rows.toReversed().map(rowToEntry);
  }

  private enforceRetention(): void {
    const cutoff = new Date(
      Date.parse(this.now()) - this.retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.db.query(`DELETE FROM app_log WHERE created_at < ?`).run(cutoff);
    this.db
      .query(
        `DELETE FROM app_log
         WHERE seq NOT IN (SELECT seq FROM app_log ORDER BY seq DESC LIMIT ?)`,
      )
      .run(this.persistedLimit);
    const minRow = this.db.query(`SELECT COALESCE(MIN(seq), 0) AS min_seq FROM app_log`).get() as {
      min_seq: number;
    };
    if (minRow.min_seq > 0 && this.seenSeq < minRow.min_seq - 1) {
      this.seenSeq = minRow.min_seq - 1;
    }
  }

  private emit(entries: AppLogEntry[]): void {
    if (this.listeners.size === 0) return;
    const clonedEntries = entries.map((entry) => structuredClone(entry));
    const summary = this.summary();
    for (const listener of this.listeners) {
      listener(clonedEntries, summary);
    }
  }
}

function prepareAppLogDatabasePath(
  options: CreateAppLogStoreOptions,
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
): Effect.Effect<void, StateContractError> {
  const databasePath = options.databasePath ?? MEMORY_DATABASE;
  if (databasePath === MEMORY_DATABASE) {
    return Effect.void;
  }
  return fileSystem
    .makeDirectory(path.dirname(databasePath), { recursive: true })
    .pipe(Effect.mapError((cause) => appLogStoreError("app-log.open.prepare-directory", cause)));
}

function initializeSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_log (
      id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT,
      error_json TEXT,
      workspace_session_id TEXT,
      surface_pi_session_id TEXT,
      thread_id TEXT,
      workflow_run_id TEXT,
      workflow_task_attempt_id TEXT,
      command_id TEXT,
      artifact_id TEXT
    );

    CREATE TABLE IF NOT EXISTS app_log_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      seen_seq INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_app_log_seq ON app_log(seq);
    CREATE INDEX IF NOT EXISTS idx_app_log_level ON app_log(level);
    CREATE INDEX IF NOT EXISTS idx_app_log_source ON app_log(source);
  `);
}

function applyBusyTimeout(db: Database, busyTimeoutMs: number | undefined): void {
  if (busyTimeoutMs === undefined) return;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs <= 0) {
    throw new Error("SQLite busyTimeoutMs must be a positive safe integer.");
  }
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
}

function rowToEntry(row: AppLogRow): AppLogEntry {
  return {
    id: row.id,
    seq: row.seq,
    createdAt: row.created_at,
    level: row.level,
    source: row.source,
    message: row.message,
    ...(row.details_json
      ? { details: JSON.parse(row.details_json) as Record<string, unknown> }
      : {}),
    ...(row.error_json ? { error: JSON.parse(row.error_json) as AppLogError } : {}),
    ...(row.workspace_session_id ? { workspaceSessionId: row.workspace_session_id } : {}),
    ...(row.surface_pi_session_id ? { surfacePiSessionId: row.surface_pi_session_id } : {}),
    ...(row.thread_id ? { threadId: row.thread_id } : {}),
    ...(row.workflow_run_id ? { workflowRunId: row.workflow_run_id } : {}),
    ...(row.workflow_task_attempt_id
      ? { workflowTaskAttemptId: row.workflow_task_attempt_id }
      : {}),
    ...(row.command_id ? { commandId: row.command_id } : {}),
    ...(row.artifact_id ? { artifactId: row.artifact_id } : {}),
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? NaN)) return 300;
  return Math.max(1, Math.min(DEFAULT_PERSISTED_LIMIT, Math.trunc(limit!)));
}

function normalizeError(error: unknown): AppLogError | undefined {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  if (typeof error === "object" && "message" in error) {
    const candidate = error as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
      message:
        typeof candidate.message === "string" ? candidate.message : String(candidate.message),
      ...(typeof candidate.stack === "string" ? { stack: candidate.stack } : {}),
    };
  }
  return { message: String(error) };
}

function redactValue(value: unknown, path: string[]): unknown {
  if (typeof value === "string") {
    if (path.some((segment) => SECRET_KEY_PATTERN.test(segment))) return REDACTED;
    return redactString(value, shouldRedactHighEntropy(path));
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(item, [...path, String(index)]));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(child, [...path, key]);
  }
  return output;
}

function redactString(value: string, redactHighEntropy = false): string {
  return value
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(KEY_VALUE_SECRET_PATTERN, "$1=[REDACTED]")
    .replace(HIGH_ENTROPY_PATTERN, (match) =>
      redactHighEntropy && looksHighEntropy(match) ? REDACTED : match,
    );
}

function shouldRedactHighEntropy(path: string[]): boolean {
  return path.some((segment) => HIGH_ENTROPY_CONTEXT_PATTERN.test(segment));
}

function looksHighEntropy(value: string): boolean {
  const unique = new Set(value).size;
  return value.length >= 40 && unique >= 18 && /[A-Z]/.test(value) && /[a-z]/.test(value);
}
