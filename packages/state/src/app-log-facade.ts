import type {
  AppLogEntry,
  AppLogLevel,
  AppLogQuery,
  AppLogReadModel,
  AppLogSource,
  AppLogSummary,
} from "@svvy/core";
import type { StateDigestHelper } from "./structured-session-state";
import { createAppLogStore } from "./app-log-store";

export interface AppLogAppendInput {
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

export interface AppLogAppender {
  append(entry: AppLogAppendInput): AppLogEntry;
  subscribe(listener: (entries: AppLogEntry[], summary: AppLogSummary) => void): () => void;
}

export interface AppLogFacade extends AppLogAppender {
  query(query?: AppLogQuery, scope?: string | null): AppLogReadModel;
  summary(scope?: string | null): AppLogSummary;
  markSeen(throughSeq: number, scope?: string | null): AppLogSummary;
  close(): void;
}

export interface CreateAppLogFacadeOptions {
  databasePath?: string;
  digest: StateDigestHelper;
  workspaceId?: string;
  now: () => string;
  memoryLimit?: number;
  persistedLimit?: number;
  retentionDays?: number;
}

export function createAppLogFacade(options: CreateAppLogFacadeOptions): AppLogFacade {
  const store = createAppLogStore(options);
  return {
    append: (entry) => store.append(entry),
    query: (query, scope) => store.query(query, scope),
    summary: (scope) => store.summary(scope),
    markSeen: (throughSeq, scope) => store.markSeen(throughSeq, scope),
    subscribe: (listener) => store.subscribe(listener),
    close: () => store.close(),
  };
}
