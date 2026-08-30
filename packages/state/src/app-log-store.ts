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
  AppLogPageInfo,
  AppLogQuery,
  AppLogReadState,
  AppLogReadModel,
  AppLogSource,
  AppLogSummary,
  AppLogViewPreferences,
} from "@svvy/core";
import { StateContractError } from "@svvy/core";
import type { StateDigestHelper } from "./structured-session-state";

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
  digest: StateDigestHelper;
  workspaceId?: string;
  busyTimeoutMs?: number;
  filesystemSetup?: "store" | "caller";
  now: () => string;
  memoryLimit?: number;
  persistedLimit?: number;
  retentionDays?: number;
}

export interface AppLogStore {
  append(entry: AppendAppLogEntry): AppLogEntry;
  query(query?: AppLogQuery, scope?: AppLogScope): AppLogReadModel;
  summary(scope?: AppLogScope): AppLogSummary;
  markSeen(throughSeq: number, scope?: AppLogScope): AppLogSummary;
  markSeenWithResult(throughSeq: number, scope?: AppLogScope): AppLogReadStateTransition;
  markSeenForEntryIdsWithResult(
    entryIds: readonly string[],
    scope?: AppLogScope,
  ): AppLogReadStateTransition;
  setViewPreferences(
    preferences: AppLogViewPreferences,
    scope?: AppLogScope,
  ): AppLogViewPreferencesTransition;
  subscribe(listener: (entries: AppLogEntry[], summary: AppLogSummary) => void): () => void;
  close(): void;
}

export interface AppLogStateService {
  append(entry: AppendAppLogEntry): Effect.Effect<AppLogEntry, StateContractError>;
  query(
    query?: AppLogQuery,
    scope?: AppLogScope,
  ): Effect.Effect<AppLogReadModel, StateContractError>;
  summary(scope?: AppLogScope): Effect.Effect<AppLogSummary, StateContractError>;
  markSeen(
    throughSeq: number,
    scope?: AppLogScope,
  ): Effect.Effect<AppLogSummary, StateContractError>;
  markSeenWithResult(
    throughSeq: number,
    scope?: AppLogScope,
  ): Effect.Effect<AppLogReadStateTransition, StateContractError>;
  markSeenForEntryIdsWithResult(
    entryIds: readonly string[],
    scope?: AppLogScope,
  ): Effect.Effect<AppLogReadStateTransition, StateContractError>;
  setViewPreferences(
    preferences: AppLogViewPreferences,
    scope?: AppLogScope,
  ): Effect.Effect<AppLogViewPreferencesTransition, StateContractError>;
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
  workspaceId?: string;
  workspaceSessionId?: string;
  surfacePiSessionId?: string;
  threadId?: string;
  workflowRunId?: string;
  workflowTaskAttemptId?: string;
  commandId?: string;
  artifactId?: string;
}

/** `undefined` is the unscoped package-local store view, while `null` is app-global. */
export type AppLogScope = string | null | undefined;

export interface AppLogReadStateTransition {
  summary: AppLogSummary;
  changed: boolean;
}

export interface AppLogViewPreferencesTransition {
  preferences: AppLogViewPreferences;
  changed: boolean;
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
  workspace_id: string | null;
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
    query: Effect.fn("@svvy/state/AppLogState.query")(function* (
      query?: AppLogQuery,
      scope?: AppLogScope,
    ) {
      return yield* tryAppLogStoreOperation("app-log.query", () => store.query(query, scope));
    }),
    summary: Effect.fn("@svvy/state/AppLogState.summary")(function* (scope?: AppLogScope) {
      return yield* tryAppLogStoreOperation("app-log.summary", () => store.summary(scope));
    }),
    markSeen: Effect.fn("@svvy/state/AppLogState.markSeen")(function* (
      throughSeq: number,
      scope?: AppLogScope,
    ) {
      return yield* tryAppLogStoreOperation("app-log.markSeen", () =>
        store.markSeen(throughSeq, scope),
      );
    }),
    markSeenWithResult: Effect.fn("@svvy/state/AppLogState.markSeenWithResult")(function* (
      throughSeq: number,
      scope?: AppLogScope,
    ) {
      return yield* tryAppLogStoreOperation("app-log.markSeenWithResult", () =>
        store.markSeenWithResult(throughSeq, scope),
      );
    }),
    markSeenForEntryIdsWithResult: Effect.fn(
      "@svvy/state/AppLogState.markSeenForEntryIdsWithResult",
    )(function* (entryIds: readonly string[], scope?: AppLogScope) {
      return yield* tryAppLogStoreOperation("app-log.markSeenForEntryIdsWithResult", () =>
        store.markSeenForEntryIdsWithResult(entryIds, scope),
      );
    }),
    setViewPreferences: Effect.fn("@svvy/state/AppLogState.setViewPreferences")(function* (
      preferences: AppLogViewPreferences,
      scope?: AppLogScope,
    ) {
      return yield* tryAppLogStoreOperation("app-log.setViewPreferences", () =>
        store.setViewPreferences(preferences, scope),
      );
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
    catch: (cause) =>
      cause instanceof StateContractError ? cause : appLogStoreError(operation, cause),
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
  private readonly workspaceId: string | undefined;
  private readonly listeners = new Set<(entries: AppLogEntry[], summary: AppLogSummary) => void>();
  private ring: AppLogEntry[] = [];

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
    this.workspaceId = options.workspaceId;
    initializeSchema(this.db, this.now, options.digest);
    this.ring = this.loadRing();
    this.enforceRetention();
  }

  append(input: AppendAppLogEntry): AppLogEntry {
    const createdAt = input.createdAt ?? this.now();
    if (this.workspaceId && input.workspaceId && input.workspaceId !== this.workspaceId) {
      throw new Error(
        `App log store is owned by workspace ${this.workspaceId}, not ${input.workspaceId}.`,
      );
    }
    const workspaceId = input.workspaceId ?? this.workspaceId;
    const error = normalizeError(input.error);
    const entryWithoutSequence = {
      createdAt,
      level: input.level,
      source: input.source,
      message: redactString(input.message),
      ...(input.details
        ? { details: redactValue(input.details, []) as Record<string, unknown> }
        : {}),
      ...(error ? { error: redactValue(error, ["error"]) as AppLogError } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(input.workspaceSessionId ? { workspaceSessionId: input.workspaceSessionId } : {}),
      ...(input.surfacePiSessionId ? { surfacePiSessionId: input.surfacePiSessionId } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.workflowRunId ? { workflowRunId: input.workflowRunId } : {}),
      ...(input.workflowTaskAttemptId
        ? { workflowTaskAttemptId: input.workflowTaskAttemptId }
        : {}),
      ...(input.commandId ? { commandId: input.commandId } : {}),
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    } satisfies Omit<AppLogEntry, "id" | "seq">;

    const entry = this.db
      .transaction(() => {
        const seq = this.readLatestSeq() + 1;
        const nextEntry: AppLogEntry = {
          id: `app-log-${seq}`,
          seq,
          ...entryWithoutSequence,
        };
        this.db
          .query(
            `INSERT INTO app_log (
              id, seq, created_at, level, source, message, details_json, error_json, workspace_id,
              workspace_session_id, surface_pi_session_id, thread_id, workflow_run_id,
              workflow_task_attempt_id, command_id, artifact_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            nextEntry.id,
            nextEntry.seq,
            nextEntry.createdAt,
            nextEntry.level,
            nextEntry.source,
            nextEntry.message,
            nextEntry.details ? JSON.stringify(nextEntry.details) : null,
            nextEntry.error ? JSON.stringify(nextEntry.error) : null,
            nextEntry.workspaceId ?? null,
            nextEntry.workspaceSessionId ?? null,
            nextEntry.surfacePiSessionId ?? null,
            nextEntry.threadId ?? null,
            nextEntry.workflowRunId ?? null,
            nextEntry.workflowTaskAttemptId ?? null,
            nextEntry.commandId ?? null,
            nextEntry.artifactId ?? null,
          );
        return nextEntry;
      })
      .immediate();

    this.ring.push(entry);
    if (this.ring.length > this.memoryLimit) {
      this.ring = this.ring.slice(-this.memoryLimit);
    }
    this.enforceRetention();
    this.emit([entry]);
    return structuredClone(entry);
  }

  query(query: AppLogQuery = {}, scope?: AppLogScope): AppLogReadModel {
    const limit = normalizeLimit(query.limit);
    const { entries, total } = this.queryEntries(query, limit, scope);
    const summary = this.summary(scope);
    const pageInfo: AppLogPageInfo = {
      returned: entries.length,
      total,
      hasMore: entries.length < total,
      oldestSeq: entries[0]?.seq ?? null,
      newestSeq: entries.at(-1)?.seq ?? null,
    };
    const readState: AppLogReadState = {
      seenSeq: summary.seenSeq,
      unread: summary.unread,
    };
    const persistedView = this.readViewPreferences(scope);
    return {
      ...(typeof scope === "string" ? { workspaceId: scope } : {}),
      query: structuredClone(query),
      entries,
      pageInfo,
      summary,
      persistedView,
      readState,
    };
  }

  summary(scope?: AppLogScope): AppLogSummary {
    const seenSeq = this.readSeenSeq(scope);
    const scopeClause = appLogScopeClause(scope);
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
          SUM(CASE WHEN seq > ? AND level = 'error' THEN 1 ELSE 0 END) AS unread_error
        FROM app_log
        WHERE ${VALID_LEVEL_CLAUSE} AND ${scopeClause.sql}`,
      )
      .get(seenSeq, seenSeq, seenSeq, seenSeq, seenSeq, ...scopeClause.params) as {
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
    };

    return {
      latestSeq: this.readLatestSeq(scope),
      seenSeq,
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

  markSeen(throughSeq: number, scope?: AppLogScope): AppLogSummary {
    return this.markSeenWithResult(throughSeq, scope).summary;
  }

  markSeenWithResult(throughSeq: number, scope?: AppLogScope): AppLogReadStateTransition {
    const transition = this.db.transaction(() => {
      const latestSeq = this.readLatestSeq(scope);
      const nextSeenSeq = Math.max(0, Math.min(Math.trunc(throughSeq), latestSeq));
      const scopeKey = appLogScopeKey(scope);

      // Ensure the CAS target exists without treating initialization as a read-state change.
      this.db
        .query(
          `INSERT OR IGNORE INTO app_log_state (scope, seen_seq, updated_at)
           VALUES (?, 0, ?)`,
        )
        .run(scopeKey, this.now());
      const updated = this.db
        .query(
          `UPDATE app_log_state
           SET seen_seq = ?, updated_at = ?
           WHERE scope = ? AND seen_seq < ?`,
        )
        .run(nextSeenSeq, this.now(), scopeKey, nextSeenSeq);
      return { changed: updated.changes > 0 };
    })();
    const result = {
      summary: this.summary(scope),
      changed: transition.changed,
    };
    if (result.changed) this.emit([]);
    return result;
  }

  markSeenForEntryIdsWithResult(
    entryIds: readonly string[],
    scope?: AppLogScope,
  ): AppLogReadStateTransition {
    const transition = this.db.transaction(() => {
      const uniqueEntryIds = [...new Set(entryIds)];
      if (uniqueEntryIds.length === 0) return { changed: false };

      const scopeClause = appLogScopeClause(scope);
      const rows = this.db
        .query(
          `SELECT id, seq
           FROM app_log
           WHERE id IN (${uniqueEntryIds.map(() => "?").join(", ")})
             AND ${scopeClause.sql}`,
        )
        .all(...uniqueEntryIds, ...scopeClause.params) as Array<{ id: string; seq: number }>;
      const rowsById = new Map(rows.map((row) => [row.id, row]));

      for (const entryId of uniqueEntryIds) {
        if (rowsById.has(entryId)) continue;

        const existing = this.db
          .query(`SELECT workspace_id FROM app_log WHERE id = ?`)
          .get(entryId) as { workspace_id: string | null } | undefined;
        if (existing && scope !== undefined) {
          const belongsToScope =
            scope === null ? existing.workspace_id === null : existing.workspace_id === scope;
          if (!belongsToScope) {
            throw new StateContractError({
              operation: "app-log.markSeenForEntryIdsWithResult",
              reason: "conflict",
              message: `App log entry ${entryId} does not belong to requested scope ${appLogScopeKey(scope)}.`,
            });
          }
        }
        throw new StateContractError({
          operation: "app-log.markSeenForEntryIdsWithResult",
          reason: "not-found",
          message: `App log entry ${entryId} was not found in requested scope ${appLogScopeKey(scope)}.`,
        });
      }

      const maxSeq = Math.max(...rows.map((row) => row.seq));
      const latestSeq = this.readLatestSeq(scope);
      const nextSeenSeq = Math.max(0, Math.min(Math.trunc(maxSeq), latestSeq));
      const scopeKey = appLogScopeKey(scope);
      this.db
        .query(
          `INSERT OR IGNORE INTO app_log_state (scope, seen_seq, updated_at)
           VALUES (?, 0, ?)`,
        )
        .run(scopeKey, this.now());
      const updated = this.db
        .query(
          `UPDATE app_log_state
           SET seen_seq = ?, updated_at = ?
           WHERE scope = ? AND seen_seq < ?`,
        )
        .run(nextSeenSeq, this.now(), scopeKey, nextSeenSeq);
      return { changed: updated.changes > 0 };
    })();
    const result = {
      summary: this.summary(scope),
      changed: transition.changed,
    };
    if (result.changed) this.emit([]);
    return result;
  }

  setViewPreferences(
    preferences: AppLogViewPreferences,
    scope?: AppLogScope,
  ): AppLogViewPreferencesTransition {
    if (!Number.isFinite(preferences.scrollTop) || preferences.scrollTop < 0) {
      throw new Error("App log scrollTop must be a finite non-negative number.");
    }
    const normalized = {
      scrollTop: preferences.scrollTop,
      followTail: Boolean(preferences.followTail),
    } satisfies AppLogViewPreferences;
    const scopeKey = appLogScopeKey(scope);
    const changed = this.db.transaction(() => {
      const current = this.readViewPreferences(scope);
      const shouldChange =
        current.scrollTop !== normalized.scrollTop || current.followTail !== normalized.followTail;
      if (shouldChange) {
        this.db
          .query(
            `INSERT INTO app_log_view_preferences (scope, scroll_top, follow_tail, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(scope) DO UPDATE SET
               scroll_top = excluded.scroll_top,
               follow_tail = excluded.follow_tail,
               updated_at = excluded.updated_at`,
          )
          .run(scopeKey, normalized.scrollTop, normalized.followTail ? 1 : 0, this.now());
      }
      return shouldChange;
    })();
    return { preferences: structuredClone(normalized), changed };
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

  private queryEntries(
    query: AppLogQuery,
    limit: number,
    scope?: AppLogScope,
  ): { entries: AppLogEntry[]; total: number } {
    const scopeClause = appLogScopeClause(scope);
    const clauses: string[] = [VALID_LEVEL_CLAUSE, scopeClause.sql];
    const params: Array<string | number> = [...scopeClause.params];
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
    const countRow = this.db
      .query(`SELECT COUNT(*) AS total FROM app_log WHERE ${clauses.join(" AND ")}`)
      .get(...params) as { total: number };
    const rows = this.db
      .query(`SELECT * FROM app_log WHERE ${clauses.join(" AND ")} ORDER BY seq DESC LIMIT ?`)
      .all(...params, limit) as AppLogRow[];
    return { entries: rows.toReversed().map(rowToEntry), total: countRow.total };
  }

  private readSeenSeq(scope?: AppLogScope): number {
    const row = this.db
      .query(`SELECT seen_seq FROM app_log_state WHERE scope = ?`)
      .get(appLogScopeKey(scope)) as { seen_seq: number } | undefined;
    return row?.seen_seq ?? 0;
  }

  private readViewPreferences(scope?: AppLogScope): AppLogViewPreferences {
    const row = this.db
      .query(
        `SELECT scroll_top, follow_tail
         FROM app_log_view_preferences
         WHERE scope = ?`,
      )
      .get(appLogScopeKey(scope)) as { scroll_top: number; follow_tail: number } | undefined;
    return {
      scrollTop: row?.scroll_top ?? 0,
      followTail: row ? Boolean(row.follow_tail) : false,
    };
  }

  private readLatestSeq(scope?: AppLogScope): number {
    const scopeClause = appLogScopeClause(scope);
    const row = this.db
      .query(`SELECT COALESCE(MAX(seq), 0) AS latest_seq FROM app_log WHERE ${scopeClause.sql}`)
      .get(...scopeClause.params) as {
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
    if (minRow.min_seq > 0) {
      this.db
        .query(
          `UPDATE app_log_state
           SET seen_seq = MAX(seen_seq, ?), updated_at = ?
           WHERE seen_seq < ?`,
        )
        .run(minRow.min_seq - 1, this.now(), minRow.min_seq - 1);
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

const APP_LOG_SCHEMA_VERSION = 1;
const APP_LOG_SCHEMA_SQL = `
  CREATE TABLE app_log (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    error_json TEXT,
    workspace_id TEXT,
    workspace_session_id TEXT,
    surface_pi_session_id TEXT,
    thread_id TEXT,
    workflow_run_id TEXT,
    workflow_task_attempt_id TEXT,
    command_id TEXT,
    artifact_id TEXT
  );

  CREATE TABLE app_log_state (
    scope TEXT PRIMARY KEY,
    seen_seq INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE app_log_view_preferences (
    scope TEXT PRIMARY KEY,
    scroll_top REAL NOT NULL,
    follow_tail INTEGER NOT NULL CHECK (follow_tail IN (0, 1)),
    updated_at TEXT NOT NULL
  );

  CREATE INDEX idx_app_log_seq ON app_log(seq);
  CREATE INDEX idx_app_log_level ON app_log(level);
  CREATE INDEX idx_app_log_source ON app_log(source);
  CREATE INDEX idx_app_log_workspace ON app_log(workspace_id, seq);
`;

const APP_LOG_SCHEMA_TABLES = ["app_log", "app_log_state", "app_log_view_preferences"] as const;

function initializeSchema(db: Database, now: () => string, digest: StateDigestHelper): void {
  const schemaDigest = digest.sha256Hex(APP_LOG_SCHEMA_SQL);
  db.exec("BEGIN IMMEDIATE");
  try {
    const markerTable = db
      .query(
        `SELECT 1 AS present
         FROM sqlite_master
         WHERE type = 'table' AND name = 'svvy_app_log_schema'
         LIMIT 1`,
      )
      .get() as { present: number } | undefined;
    const schemaMarker = markerTable
      ? (db.query(`SELECT version, schema_sha256 FROM svvy_app_log_schema LIMIT 1`).get() as
          | { version: number; schema_sha256: string }
          | undefined)
      : undefined;
    const databaseObjects = db
      .query(
        `SELECT 1 AS present
         FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%'
         LIMIT 1`,
      )
      .get() as { present: number } | undefined;

    if (schemaMarker) {
      if (
        schemaMarker.version !== APP_LOG_SCHEMA_VERSION ||
        schemaMarker.schema_sha256 !== schemaDigest
      ) {
        throw new Error("App log database has an unsupported current schema.");
      }
      for (const table of APP_LOG_SCHEMA_TABLES) {
        const present = db
          .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?`)
          .get(table) as { present: number } | undefined;
        if (!present) throw new Error(`App log database is missing current table ${table}.`);
      }
    } else {
      if (databaseObjects) {
        throw new Error("App log database has untracked-schema; refusing schema conversion.");
      }
      db.exec(APP_LOG_SCHEMA_SQL);
      db.exec(`
        CREATE TABLE svvy_app_log_schema (
          version INTEGER PRIMARY KEY CHECK (version = ${APP_LOG_SCHEMA_VERSION}),
          schema_sha256 TEXT NOT NULL,
          initialized_at TEXT NOT NULL
        );
      `);
      db.query(
        `INSERT INTO svvy_app_log_schema (version, schema_sha256, initialized_at)
         VALUES (?, ?, ?)`,
      ).run(APP_LOG_SCHEMA_VERSION, schemaDigest, now());
    }
    db.exec(`PRAGMA user_version = ${APP_LOG_SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
}

function applyBusyTimeout(db: Database, busyTimeoutMs: number | undefined): void {
  if (busyTimeoutMs === undefined) return;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs <= 0) {
    throw new Error("SQLite busyTimeoutMs must be a positive safe integer.");
  }
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
}

function appLogScopeKey(scope: AppLogScope): string {
  if (scope === null) return "app";
  if (scope === undefined) return "all";
  return `workspace:${scope}`;
}

function appLogScopeClause(scope: AppLogScope): {
  sql: string;
  params: readonly string[];
} {
  if (scope === null) return { sql: "workspace_id IS NULL", params: [] };
  if (scope === undefined) return { sql: "1 = 1", params: [] };
  return { sql: "workspace_id = ?", params: [scope] };
}

function rowToEntry(row: AppLogRow): AppLogEntry {
  return {
    id: row.id,
    seq: row.seq,
    createdAt: row.created_at,
    level: row.level,
    source: row.source,
    message: row.message,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
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
      message: redactString(error.message, true),
      ...(error.stack ? { stack: redactString(error.stack, true) } : {}),
    };
  }
  if (typeof error === "object" && "message" in error) {
    const candidate = error as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
      message:
        typeof candidate.message === "string"
          ? redactString(candidate.message, true)
          : redactString(String(candidate.message), true),
      ...(typeof candidate.stack === "string"
        ? { stack: redactString(candidate.stack, true) }
        : {}),
    };
  }
  return { message: redactString(String(error), true) };
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
