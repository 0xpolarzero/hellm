import type {
  AppLogEntry,
  AppLogLevel,
  AppLogQuery,
  AppLogReadModel,
  AppLogSource,
  AppLogSummary,
} from "@svvy/core";
import { createAppLogStore } from "./app-log-store";

export interface AppLogAppendInput {
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

export interface AppLogAppender {
  append(entry: AppLogAppendInput): AppLogEntry;
  subscribe(listener: (entries: AppLogEntry[], summary: AppLogSummary) => void): () => void;
}

export interface AppLogFacade extends AppLogAppender {
  query(query?: AppLogQuery): AppLogReadModel;
  summary(): AppLogSummary;
  markSeen(throughSeq: number): AppLogSummary;
  close(): void;
}

export interface CreateAppLogFacadeOptions {
  databasePath?: string;
  now: () => string;
  memoryLimit?: number;
  persistedLimit?: number;
  retentionDays?: number;
}

export function createAppLogFacade(options: CreateAppLogFacadeOptions): AppLogFacade {
  const store = createAppLogStore(options);
  return {
    append: (entry) => store.append(entry),
    query: (query) => store.query(query),
    summary: () => store.summary(),
    markSeen: (throughSeq) => store.markSeen(throughSeq),
    subscribe: (listener) => store.subscribe(listener),
    close: () => store.close(),
  };
}
