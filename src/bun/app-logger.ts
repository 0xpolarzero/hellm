import type {
  AppLogEntry,
  AppLogLevel,
  AppLogSource,
  AppLogSummary,
} from "../shared/workspace-contract";
import type { AppLogStore } from "./app-log-store";

export type BridgeLogLevel = "debug" | "info" | "warn" | "error";

export interface AppLogger {
  debug(source: AppLogSource, message: string, details?: AppLogDetails): AppLogEntry | null;
  info(source: AppLogSource, message: string, details?: AppLogDetails): AppLogEntry | null;
  warning(source: AppLogSource, message: string, details?: AppLogDetails): AppLogEntry | null;
  error(
    source: AppLogSource,
    message: string,
    errorOrDetails?: unknown,
    details?: AppLogDetails,
  ): AppLogEntry | null;
  subscribe(listener: (entries: AppLogEntry[], summary: AppLogSummary) => void): () => void;
}

export type AppLogDetails = Record<string, unknown> & {
  workspaceSessionId?: string;
  surfacePiSessionId?: string;
  threadId?: string;
  workflowRunId?: string;
  workflowTaskAttemptId?: string;
  commandId?: string;
  artifactId?: string;
};

export type AppLoggerEvent =
  | {
      level: "debug" | "info" | "warning";
      source: AppLogSource;
      message: string;
      details?: AppLogDetails;
    }
  | {
      level: "error";
      source: AppLogSource;
      message: string;
      error?: unknown;
      details?: AppLogDetails;
    };

export interface CreateAppLoggerOptions {
  store: AppLogStore;
  forwardBridgeLog?: (
    level: BridgeLogLevel,
    message: string,
    source: string,
    details?: Record<string, unknown>,
    error?: unknown,
  ) => void;
}

export function appendAppLoggerEvent(logger: AppLogger, event: AppLoggerEvent): AppLogEntry | null {
  if (event.level === "error") {
    return logger.error(event.source, event.message, event.error, event.details);
  }
  return logger[event.level](event.source, event.message, event.details);
}

export function createAppLogger(options: CreateAppLoggerOptions): AppLogger {
  const append = (
    level: AppLogLevel,
    source: AppLogSource,
    message: string,
    details?: AppLogDetails,
    error?: unknown,
  ): AppLogEntry | null => {
    try {
      const entry = options.store.append({
        level,
        source,
        message,
        details: stripRelatedIds(details),
        error,
        workspaceSessionId: details?.workspaceSessionId,
        surfacePiSessionId: details?.surfacePiSessionId,
        threadId: details?.threadId,
        workflowRunId: details?.workflowRunId,
        workflowTaskAttemptId: details?.workflowTaskAttemptId,
        commandId: details?.commandId,
        artifactId: details?.artifactId,
      });
      options.forwardBridgeLog?.(
        level,
        entry.message,
        source,
        entryBridgeDetails(entry),
        entry.error,
      );
      return entry;
    } catch (logError) {
      console.error("Failed to append app log:", logError);
      return null;
    }
  };

  return {
    debug: (source, message, details) => append("debug", source, message, details),
    info: (source, message, details) => append("info", source, message, details),
    warning: (source, message, details) => append("warn", source, message, details),
    error: (source, message, errorOrDetails, details) => {
      if (isPlainDetails(errorOrDetails) && details === undefined) {
        return append("error", source, message, errorOrDetails);
      }
      return append("error", source, message, details, errorOrDetails);
    },
    subscribe: (listener) => options.store.subscribe(listener),
  };
}

function entryBridgeDetails(entry: AppLogEntry): Record<string, unknown> | undefined {
  const details = {
    ...entry.details,
    ...(entry.workspaceSessionId ? { workspaceSessionId: entry.workspaceSessionId } : {}),
    ...(entry.surfacePiSessionId ? { surfacePiSessionId: entry.surfacePiSessionId } : {}),
    ...(entry.threadId ? { threadId: entry.threadId } : {}),
    ...(entry.workflowRunId ? { workflowRunId: entry.workflowRunId } : {}),
    ...(entry.workflowTaskAttemptId ? { workflowTaskAttemptId: entry.workflowTaskAttemptId } : {}),
    ...(entry.commandId ? { commandId: entry.commandId } : {}),
    ...(entry.artifactId ? { artifactId: entry.artifactId } : {}),
  };
  return Object.keys(details).length ? details : undefined;
}

function stripRelatedIds(details: AppLogDetails | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const {
    workspaceSessionId: _workspaceSessionId,
    surfacePiSessionId: _surfacePiSessionId,
    threadId: _threadId,
    workflowRunId: _workflowRunId,
    workflowTaskAttemptId: _workflowTaskAttemptId,
    commandId: _commandId,
    artifactId: _artifactId,
    ...rest
  } = details;
  return Object.keys(rest).length ? rest : undefined;
}

function isPlainDetails(value: unknown): value is AppLogDetails {
  if (!value || typeof value !== "object" || value instanceof Error) return false;
  return !("message" in value && typeof (value as { message?: unknown }).message === "string");
}
