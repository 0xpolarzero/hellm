import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import type { StateContractError } from "./errors";
import { StateStoredErrorSchema } from "./errors";
import {
  AppLogEntryId,
  ArtifactId,
  CommandId,
  IsoDateTimeStringSchema,
  JsonObject,
  SurfacePiSessionId,
  ThreadId,
  TurnId,
  WorkflowRunId,
  WorkflowTaskAttemptId,
  WorkspaceId,
  WorkspaceSessionId,
} from "./ids";
import type { StateMutationResult } from "./runtime-state-ports";
import { StateMutationResultSchema } from "./runtime-state-ports";

export const AppLogLevelSchema = Schema.Literals(["debug", "info", "warn", "error"]);
export type AppLogLevel = "debug" | "info" | "warn" | "error";

export const AppLogSourceSchema = Schema.Literals([
  "app.lifecycle",
  "app.bridge",
  "app.rpc",
  "auth.provider",
  "settings",
  "workspace",
  "session",
  "session.title",
  "source.graph",
  "surface",
  "prompt",
  "thread",
  "smithers",
  "workflow.library",
  "workflow.run",
  "workflow.task",
  "direct-tool",
  "execute_typescript",
  "artifact",
  "external-editor",
  "renderer",
]);
export type AppLogSource =
  | "app.lifecycle"
  | "app.bridge"
  | "app.rpc"
  | "auth.provider"
  | "settings"
  | "workspace"
  | "session"
  | "session.title"
  | "source.graph"
  | "surface"
  | "prompt"
  | "thread"
  | "smithers"
  | "workflow.library"
  | "workflow.run"
  | "workflow.task"
  | "direct-tool"
  | "execute_typescript"
  | "artifact"
  | "external-editor"
  | "renderer";

export const AppLogErrorSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  message: Schema.String,
  stack: Schema.optionalKey(Schema.String),
});
export interface AppLogError {
  name?: string;
  message: string;
  stack?: string;
}
export const decodeUnknownAppLogErrorExit = Schema.decodeUnknownExit(
  AppLogErrorSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownAppLogErrorEffect = Schema.decodeUnknownEffect(
  AppLogErrorSchema,
  strictBoundaryParseOptions,
);
export const encodeAppLogErrorExit = Schema.encodeExit(
  AppLogErrorSchema,
  strictBoundaryParseOptions,
);
export const encodeAppLogErrorEffect = Schema.encodeEffect(
  AppLogErrorSchema,
  strictBoundaryParseOptions,
);

export const AppLogEntrySchema = Schema.Struct({
  id: AppLogEntryId,
  seq: Schema.Number,
  createdAt: IsoDateTimeStringSchema,
  level: AppLogLevelSchema,
  source: AppLogSourceSchema,
  message: Schema.String,
  details: Schema.optionalKey(JsonObject),
  error: Schema.optionalKey(AppLogErrorSchema),
  workspaceSessionId: Schema.optionalKey(WorkspaceSessionId),
  surfacePiSessionId: Schema.optionalKey(SurfacePiSessionId),
  threadId: Schema.optionalKey(ThreadId),
  workflowRunId: Schema.optionalKey(WorkflowRunId),
  workflowTaskAttemptId: Schema.optionalKey(WorkflowTaskAttemptId),
  commandId: Schema.optionalKey(CommandId),
  artifactId: Schema.optionalKey(ArtifactId),
});
export interface AppLogEntry {
  id: string;
  seq: number;
  createdAt: string;
  level: AppLogLevel;
  source: AppLogSource;
  message: string;
  details?: Record<string, unknown>;
  error?: AppLogError;
  workspaceSessionId?: string;
  surfacePiSessionId?: string;
  threadId?: string;
  workflowRunId?: string;
  workflowTaskAttemptId?: string;
  commandId?: string;
  artifactId?: string;
}

export const AppLogCountsSchema = Schema.Struct({
  total: Schema.Number,
  debug: Schema.Number,
  info: Schema.Number,
  warn: Schema.Number,
  error: Schema.Number,
});
export interface AppLogCounts {
  total: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
}

export const AppLogSummarySchema = Schema.Struct({
  latestSeq: Schema.Number,
  seenSeq: Schema.Number,
  unread: AppLogCountsSchema,
  totals: AppLogCountsSchema,
});
export interface AppLogSummary {
  latestSeq: number;
  seenSeq: number;
  unread: AppLogCounts;
  totals: AppLogCounts;
}

export const AppLogQuerySchema = Schema.Struct({
  levels: Schema.optionalKey(Schema.Array(AppLogLevelSchema)),
  sources: Schema.optionalKey(Schema.Array(AppLogSourceSchema)),
  query: Schema.optionalKey(Schema.String),
  afterSeq: Schema.optionalKey(Schema.Number),
  beforeSeq: Schema.optionalKey(Schema.Number),
  limit: Schema.optionalKey(Schema.Number),
});
export interface AppLogQuery {
  levels?: AppLogLevel[];
  sources?: AppLogSource[];
  query?: string;
  afterSeq?: number;
  beforeSeq?: number;
  limit?: number;
}

export const AppLogReadModelSchema = Schema.Struct({
  entries: Schema.Array(AppLogEntrySchema),
  summary: AppLogSummarySchema,
});
export interface AppLogReadModel {
  entries: AppLogEntry[];
  summary: AppLogSummary;
}

export const AppLogUpdateMessageSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  entries: Schema.Array(AppLogEntrySchema),
  summary: AppLogSummarySchema,
});
export interface AppLogUpdateMessage {
  workspaceId: string;
  entries: AppLogEntry[];
  summary: AppLogSummary;
}

export const SvvyObservationPackageSchema = Schema.Literals([
  "app",
  "core",
  "state",
  "runtime",
  "extensions",
  "sandbox",
  "pi-adapter",
  "desktop",
]);
export type SvvyObservationPackage = typeof SvvyObservationPackageSchema.Type;

export const SvvyObservationOperationSchema = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isPattern(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
).pipe(Schema.brand("SvvyObservationOperation"));
export type SvvyObservationOperation = typeof SvvyObservationOperationSchema.Type;

export const SvvyObservationReasonClassSchema = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isPattern(/^[a-z][a-z0-9_]{0,63}$/),
).pipe(Schema.brand("SvvyObservationReasonClass"));
export type SvvyObservationReasonClass = typeof SvvyObservationReasonClassSchema.Type;

export const SvvyObservationAnnotationSchema = Schema.Union([
  Schema.Struct({ key: Schema.Literal("svvy.package"), value: SvvyObservationPackageSchema }),
  Schema.Struct({ key: Schema.Literal("svvy.operation"), value: SvvyObservationOperationSchema }),
  Schema.Struct({ key: Schema.Literal("svvy.workspace_id"), value: WorkspaceId }),
  Schema.Struct({ key: Schema.Literal("svvy.surface_pi_session_id"), value: SurfacePiSessionId }),
  Schema.Struct({ key: Schema.Literal("svvy.thread_id"), value: ThreadId }),
  Schema.Struct({ key: Schema.Literal("svvy.turn_id"), value: TurnId }),
  Schema.Struct({ key: Schema.Literal("svvy.command_id"), value: CommandId }),
  Schema.Struct({
    key: Schema.Literal("svvy.reason_class"),
    value: SvvyObservationReasonClassSchema,
  }),
]);
export type SvvyObservationAnnotation = typeof SvvyObservationAnnotationSchema.Type;

export const AppLogRelatedLinkSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("workspace-session"), id: WorkspaceSessionId }),
  Schema.Struct({ kind: Schema.Literal("surface"), id: SurfacePiSessionId }),
  Schema.Struct({ kind: Schema.Literal("thread"), id: ThreadId }),
  Schema.Struct({ kind: Schema.Literal("command"), id: CommandId }),
  Schema.Struct({ kind: Schema.Literal("artifact"), id: ArtifactId }),
  Schema.Struct({ kind: Schema.Literal("workflow-run"), id: WorkflowRunId }),
  Schema.Struct({ kind: Schema.Literal("workflow-task-attempt"), id: WorkflowTaskAttemptId }),
]);
export type AppLogRelatedLink = typeof AppLogRelatedLinkSchema.Type;
export const decodeUnknownAppLogRelatedLinkExit = Schema.decodeUnknownExit(
  AppLogRelatedLinkSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownAppLogRelatedLinkEffect = Schema.decodeUnknownEffect(
  AppLogRelatedLinkSchema,
  strictBoundaryParseOptions,
);
export const encodeAppLogRelatedLinkExit = Schema.encodeExit(
  AppLogRelatedLinkSchema,
  strictBoundaryParseOptions,
);
export const encodeAppLogRelatedLinkEffect = Schema.encodeEffect(
  AppLogRelatedLinkSchema,
  strictBoundaryParseOptions,
);

export const AppendAppLogInputSchema = Schema.Struct({
  workspaceId: Schema.optionalKey(WorkspaceId),
  level: AppLogLevelSchema,
  source: AppLogSourceSchema,
  message: Schema.String,
  occurredAt: IsoDateTimeStringSchema,
  details: Schema.optionalKey(JsonObject),
  normalizedError: Schema.optionalKey(StateStoredErrorSchema),
  related: Schema.optionalKey(Schema.Array(AppLogRelatedLinkSchema)),
  idempotencyKey: Schema.optionalKey(Schema.String),
});
export type AppendAppLogInput = typeof AppendAppLogInputSchema.Type;
export const decodeUnknownAppendAppLogInputExit = Schema.decodeUnknownExit(
  AppendAppLogInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownAppendAppLogInputEffect = Schema.decodeUnknownEffect(
  AppendAppLogInputSchema,
  strictBoundaryParseOptions,
);
export const encodeAppendAppLogInputExit = Schema.encodeExit(
  AppendAppLogInputSchema,
  strictBoundaryParseOptions,
);
export const encodeAppendAppLogInputEffect = Schema.encodeEffect(
  AppendAppLogInputSchema,
  strictBoundaryParseOptions,
);

export const AppLogWriteResultValueSchema = Schema.Struct({
  appLogEntryId: AppLogEntryId,
});
export type AppLogWriteResultValue = typeof AppLogWriteResultValueSchema.Type;

export const AppLogWriteResultSchema = StateMutationResultSchema(AppLogWriteResultValueSchema);
export type AppLogWriteResult = StateMutationResult<AppLogWriteResultValue>;
export const decodeUnknownAppLogWriteResultExit = Schema.decodeUnknownExit(
  AppLogWriteResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownAppLogWriteResultEffect = Schema.decodeUnknownEffect(
  AppLogWriteResultSchema,
  strictBoundaryParseOptions,
);
export const encodeAppLogWriteResultExit = Schema.encodeExit(
  AppLogWriteResultSchema,
  strictBoundaryParseOptions,
);
export const encodeAppLogWriteResultEffect = Schema.encodeEffect(
  AppLogWriteResultSchema,
  strictBoundaryParseOptions,
);

export interface AppLogWritePortService {
  append(input: AppendAppLogInput): Effect.Effect<AppLogWriteResult, StateContractError>;
}

export interface AppLogWritePort {
  readonly _tag: "AppLogWritePort";
}

export const AppLogWritePort = Context.Service<AppLogWritePort, AppLogWritePortService>(
  "@svvy/core/AppLogWritePort",
);
