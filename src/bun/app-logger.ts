import type { AppLogEntry, AppLogLevel, AppLogSource, AppLogSummary } from "@svvy/core";

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

export interface AppLogAppender {
  append(entry: AppLogAppendInput): AppLogEntry;
  subscribe(listener: (entries: AppLogEntry[], summary: AppLogSummary) => void): () => void;
}

export interface AppLogAppendInput {
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

export type BridgeLogLevel = "debug" | "info" | "warn" | "error";

export interface CreateAppLoggerOptions {
  appLogs: AppLogAppender;
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
      const cleanDetails = stripRelatedIds(details);
      return options.appLogs.append({
        level,
        source,
        message,
        ...(cleanDetails ? { details: cleanDetails } : {}),
        ...(error !== undefined ? { error } : {}),
        ...(details?.workspaceSessionId ? { workspaceSessionId: details.workspaceSessionId } : {}),
        ...(details?.surfacePiSessionId ? { surfacePiSessionId: details.surfacePiSessionId } : {}),
        ...(details?.threadId ? { threadId: details.threadId } : {}),
        ...(details?.workflowRunId ? { workflowRunId: details.workflowRunId } : {}),
        ...(details?.workflowTaskAttemptId
          ? { workflowTaskAttemptId: details.workflowTaskAttemptId }
          : {}),
        ...(details?.commandId ? { commandId: details.commandId } : {}),
        ...(details?.artifactId ? { artifactId: details.artifactId } : {}),
      });
    } catch (logError) {
      console.error("Failed to append app log:", logError);
      return null;
    }
  };
  const forward = (entry: AppLogEntry | null): AppLogEntry | null => {
    if (entry) {
      options.forwardBridgeLog?.(
        entry.level,
        entry.message,
        entry.source,
        entryBridgeDetails(entry),
        entry.error,
      );
    }
    return entry;
  };

  return {
    debug: (source, message, details) => forward(append("debug", source, message, details)),
    info: (source, message, details) => forward(append("info", source, message, details)),
    warning: (source, message, details) => forward(append("warn", source, message, details)),
    error: (source, message, errorOrDetails, details) => {
      if (isPlainDetails(errorOrDetails) && details === undefined) {
        return forward(append("error", source, message, errorOrDetails));
      }
      return forward(append("error", source, message, details, errorOrDetails));
    },
    subscribe: (listener) => options.appLogs.subscribe(listener),
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
