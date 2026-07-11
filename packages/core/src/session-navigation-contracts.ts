import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import {
  ArtifactId,
  CommandId,
  IsoDateTimeStringSchema,
  ModelId,
  NonNegativeSafeIntegerSchema,
  ProviderId,
  SurfacePiSessionId,
  ThreadId,
  WorkflowRunId,
  WorkflowTaskAttemptId,
  WorkspaceSessionId,
} from "./ids";

export type WorkspaceSessionNavigationSectionId = "pinned" | "active" | "archived";
export const WorkspaceSessionNavigationSectionIdSchema = Schema.Literals([
  "pinned",
  "active",
  "archived",
]);

export const WorkspaceSessionNavigationSectionStateSchema = Schema.Struct({
  collapsed: Schema.Boolean,
  sizePx: Schema.Number,
});
export type WorkspaceSessionNavigationSectionState =
  typeof WorkspaceSessionNavigationSectionStateSchema.Encoded;

export const WorkspaceSessionNavigationSummarySchema = Schema.Struct({
  isPinned: Schema.Boolean,
  pinnedAt: Schema.NullOr(IsoDateTimeStringSchema),
  isArchived: Schema.Boolean,
  archivedAt: Schema.NullOr(IsoDateTimeStringSchema),
  updatedAt: IsoDateTimeStringSchema,
});
export type WorkspaceSessionNavigationSummary =
  typeof WorkspaceSessionNavigationSummarySchema.Encoded;

export interface WorkspaceSessionNavigationReadModel<
  Session extends WorkspaceSessionNavigationSummary = WorkspaceSessionNavigationSummary,
> {
  pinnedSessions: Session[];
  activeSessions: Session[];
  sections: Record<WorkspaceSessionNavigationSectionId, WorkspaceSessionNavigationSectionState>;
  archived: {
    collapsed: boolean;
    sessions: Session[];
  };
}
export const WorkspaceSessionNavigationReadModelSchema = Schema.Struct({
  pinnedSessions: Schema.Array(WorkspaceSessionNavigationSummarySchema),
  activeSessions: Schema.Array(WorkspaceSessionNavigationSummarySchema),
  sections: Schema.Struct({
    pinned: WorkspaceSessionNavigationSectionStateSchema,
    active: WorkspaceSessionNavigationSectionStateSchema,
    archived: WorkspaceSessionNavigationSectionStateSchema,
  }),
  archived: Schema.Struct({
    collapsed: Schema.Boolean,
    sessions: Schema.Array(WorkspaceSessionNavigationSummarySchema),
  }),
});

export const decodeUnknownWorkspaceSessionNavigationReadModelExit = Schema.decodeUnknownExit(
  WorkspaceSessionNavigationReadModelSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownWorkspaceSessionNavigationReadModelEffect = Schema.decodeUnknownEffect(
  WorkspaceSessionNavigationReadModelSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkspaceSessionNavigationReadModelExit = Schema.encodeExit(
  WorkspaceSessionNavigationReadModelSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkspaceSessionNavigationReadModelEffect = Schema.encodeEffect(
  WorkspaceSessionNavigationReadModelSchema,
  strictBoundaryParseOptions,
);

export const SessionNavigationStatusSchema = Schema.Literals([
  "idle",
  "running",
  "waiting",
  "error",
]);
export type SessionNavigationStatus = typeof SessionNavigationStatusSchema.Encoded;

export const SessionNavigationTitleGenerationStatusSchema = Schema.Literals([
  "not-started",
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type SessionNavigationTitleGenerationStatus =
  typeof SessionNavigationTitleGenerationStatusSchema.Encoded;

export const SessionNavigationCommandStatusSchema = Schema.Literals([
  "streaming",
  "requested",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
]);
export type SessionNavigationCommandStatus = typeof SessionNavigationCommandStatusSchema.Encoded;

export const SessionNavigationHandlerStatusSchema = Schema.Literals([
  "idle",
  "running-handler",
  "running-workflow",
  "waiting",
  "troubleshooting",
  "completed",
]);
export type SessionNavigationHandlerStatus = typeof SessionNavigationHandlerStatusSchema.Encoded;

export const SessionNavigationWorkflowStatusSchema = Schema.Literals([
  "running",
  "waiting",
  "continued",
  "completed",
  "failed",
  "cancelled",
]);
export type SessionNavigationWorkflowStatus = typeof SessionNavigationWorkflowStatusSchema.Encoded;

const SessionNavigationJsonObjectSchema = Schema.Record(Schema.String, Schema.Json);

export const SessionNavigationCommandArtifactLinkSchema = Schema.Struct({
  artifactId: ArtifactId,
  kind: Schema.Literals(["text", "log", "json", "file"]),
  name: Schema.String,
  path: Schema.optionalKey(Schema.String),
  createdAt: IsoDateTimeStringSchema,
  sourceCommandId: Schema.optionalKey(CommandId),
  workflowRunId: Schema.optionalKey(WorkflowRunId),
  workflowName: Schema.optionalKey(Schema.String),
  producerLabel: Schema.optionalKey(Schema.String),
  missingFile: Schema.optionalKey(Schema.Boolean),
});
export type SessionNavigationCommandArtifactLink =
  typeof SessionNavigationCommandArtifactLinkSchema.Encoded;

export const SessionNavigationCommandOutputEventSchema = Schema.Struct({
  eventId: Schema.String,
  at: IsoDateTimeStringSchema,
  stream: Schema.Literals(["stdout", "stderr"]),
  source: Schema.String,
  text: Schema.String,
});
export type SessionNavigationCommandOutputEvent =
  typeof SessionNavigationCommandOutputEventSchema.Encoded;

export const SessionNavigationCommandStdinEventSchema = Schema.Struct({
  eventId: Schema.String,
  at: IsoDateTimeStringSchema,
  text: Schema.String,
  acceptedBytes: NonNegativeSafeIntegerSchema,
});
export type SessionNavigationCommandStdinEvent =
  typeof SessionNavigationCommandStdinEventSchema.Encoded;

export const SessionNavigationCommandStdinStateSchema = Schema.Struct({
  mode: Schema.Literals(["none", "continuable"]),
  canAttemptWrite: Schema.Boolean,
  acceptedWrites: Schema.Array(SessionNavigationCommandStdinEventSchema),
});
export type SessionNavigationCommandStdinState =
  typeof SessionNavigationCommandStdinStateSchema.Encoded;

export const SessionNavigationCommandArgumentSnapshotSchema = Schema.Struct({
  eventId: Schema.String,
  at: IsoDateTimeStringSchema,
  source: Schema.String,
  arguments: Schema.Json,
});
export type SessionNavigationCommandArgumentSnapshot =
  typeof SessionNavigationCommandArgumentSnapshotSchema.Encoded;

export const SessionNavigationCommandProgressEventSchema = Schema.Struct({
  eventId: Schema.String,
  at: IsoDateTimeStringSchema,
  source: Schema.String,
  phase: Schema.optionalKey(Schema.String),
  family: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
  progress: Schema.optionalKey(Schema.Number),
  facts: Schema.optionalKey(SessionNavigationJsonObjectSchema),
});
export type SessionNavigationCommandProgressEvent =
  typeof SessionNavigationCommandProgressEventSchema.Encoded;

export const SessionNavigationCommandPatchFileSchema = Schema.Struct({
  path: Schema.String,
  changeType: Schema.Literals(["created", "deleted", "modified"]),
  additions: NonNegativeSafeIntegerSchema,
  deletions: NonNegativeSafeIntegerSchema,
});
export type SessionNavigationCommandPatchFile =
  typeof SessionNavigationCommandPatchFileSchema.Encoded;

export const SessionNavigationCommandPatchSnapshotSchema = Schema.Struct({
  eventId: Schema.String,
  at: IsoDateTimeStringSchema,
  source: Schema.String,
  files: Schema.Array(SessionNavigationCommandPatchFileSchema),
});
export type SessionNavigationCommandPatchSnapshot =
  typeof SessionNavigationCommandPatchSnapshotSchema.Encoded;

export const SessionNavigationCommandDiagnosticSchema = Schema.Struct({
  severity: Schema.optionalKey(Schema.String),
  message: Schema.String,
  file: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Number),
  column: Schema.optionalKey(Schema.Number),
  code: Schema.optionalKey(Schema.String),
});
export type SessionNavigationCommandDiagnostic =
  typeof SessionNavigationCommandDiagnosticSchema.Encoded;

export const SessionNavigationCommandDiagnosticSnapshotSchema = Schema.Struct({
  eventId: Schema.String,
  at: IsoDateTimeStringSchema,
  source: Schema.String,
  stage: Schema.optionalKey(Schema.String),
  diagnostics: Schema.Array(SessionNavigationCommandDiagnosticSchema),
});
export type SessionNavigationCommandDiagnosticSnapshot =
  typeof SessionNavigationCommandDiagnosticSnapshotSchema.Encoded;

export const SessionNavigationCommandRollupChildSchema = Schema.Struct({
  commandId: CommandId,
  toolName: Schema.String,
  status: SessionNavigationCommandStatusSchema,
  title: Schema.String,
  summary: Schema.String,
  error: Schema.NullOr(Schema.String),
});
export type SessionNavigationCommandRollupChild =
  typeof SessionNavigationCommandRollupChildSchema.Encoded;

export const SessionNavigationCommandRollupSchema = Schema.Struct({
  commandId: CommandId,
  threadId: Schema.NullOr(ThreadId),
  workflowRunId: Schema.optionalKey(Schema.NullOr(WorkflowRunId)),
  workflowTaskAttemptId: Schema.optionalKey(Schema.NullOr(WorkflowTaskAttemptId)),
  toolName: Schema.String,
  visibility: Schema.Literals(["summary", "surface"]),
  status: SessionNavigationCommandStatusSchema,
  title: Schema.String,
  summary: Schema.String,
  arguments: Schema.optionalKey(Schema.NullOr(Schema.Json)),
  facts: Schema.optionalKey(Schema.NullOr(SessionNavigationJsonObjectSchema)),
  error: Schema.optionalKey(Schema.NullOr(Schema.String)),
  artifacts: Schema.optionalKey(Schema.Array(SessionNavigationCommandArtifactLinkSchema)),
  outputEvents: Schema.optionalKey(Schema.Array(SessionNavigationCommandOutputEventSchema)),
  stdin: SessionNavigationCommandStdinStateSchema,
  argumentSnapshots: Schema.optionalKey(
    Schema.Array(SessionNavigationCommandArgumentSnapshotSchema),
  ),
  progressEvents: Schema.optionalKey(Schema.Array(SessionNavigationCommandProgressEventSchema)),
  patchSnapshots: Schema.optionalKey(Schema.Array(SessionNavigationCommandPatchSnapshotSchema)),
  diagnostics: Schema.optionalKey(Schema.Array(SessionNavigationCommandDiagnosticSnapshotSchema)),
  childCount: NonNegativeSafeIntegerSchema,
  summaryChildCount: NonNegativeSafeIntegerSchema,
  traceChildCount: NonNegativeSafeIntegerSchema,
  summaryChildren: Schema.Array(SessionNavigationCommandRollupChildSchema),
  startedAt: IsoDateTimeStringSchema,
  updatedAt: IsoDateTimeStringSchema,
  finishedAt: Schema.NullOr(IsoDateTimeStringSchema),
});
export type SessionNavigationCommandRollup = typeof SessionNavigationCommandRollupSchema.Encoded;

export const SessionNavigationProductEventSchema = Schema.Struct({
  eventId: Schema.String,
  at: IsoDateTimeStringSchema,
  title: Schema.String,
  summary: Schema.String,
  subject: Schema.Struct({
    kind: Schema.Literals(["session", "thread"]),
    id: Schema.String,
  }),
  details: Schema.optionalKey(SessionNavigationJsonObjectSchema),
});
export type SessionNavigationProductEvent = typeof SessionNavigationProductEventSchema.Encoded;

export const SessionNavigationSidebarRowSubtitleSchema = Schema.Struct({
  badge: Schema.Literals(["waiting", "error", "workflow", "text"]),
  text: Schema.String,
  tone: Schema.Literals(["muted", "waiting", "error"]),
});
export type SessionNavigationSidebarRowSubtitle =
  typeof SessionNavigationSidebarRowSubtitleSchema.Encoded;

export const SessionNavigationSidebarWorkflowRowSchema = Schema.Struct({
  workflowRunId: WorkflowRunId,
  workflowName: Schema.String,
  status: SessionNavigationWorkflowStatusSchema,
  subtitle: Schema.NullOr(SessionNavigationSidebarRowSubtitleSchema),
  updatedAt: IsoDateTimeStringSchema,
});
export type SessionNavigationSidebarWorkflowRow =
  typeof SessionNavigationSidebarWorkflowRowSchema.Encoded;

export const SessionNavigationSidebarHandlerThreadRowSchema = Schema.Struct({
  threadId: ThreadId,
  surfacePiSessionId: SurfacePiSessionId,
  title: Schema.String,
  objective: Schema.String,
  status: SessionNavigationHandlerStatusSchema,
  subtitle: Schema.NullOr(SessionNavigationSidebarRowSubtitleSchema),
  latestCommandRollup: Schema.NullOr(SessionNavigationCommandRollupSchema),
  updatedAt: IsoDateTimeStringSchema,
  workflows: Schema.Array(SessionNavigationSidebarWorkflowRowSchema),
});
export type SessionNavigationSidebarHandlerThreadRow =
  typeof SessionNavigationSidebarHandlerThreadRowSchema.Encoded;

export const SessionNavigationWaitSchema = Schema.Struct({
  threadId: Schema.optionalKey(ThreadId),
  kind: Schema.Literals(["user", "external", "approval", "signal", "timer"]),
  reason: Schema.String,
  resumeWhen: Schema.String,
  since: IsoDateTimeStringSchema,
});
export type SessionNavigationWait = typeof SessionNavigationWaitSchema.Encoded;

export const SessionNavigationCountsSchema = Schema.Struct({
  turns: NonNegativeSafeIntegerSchema,
  threads: NonNegativeSafeIntegerSchema,
  commands: NonNegativeSafeIntegerSchema,
  episodes: NonNegativeSafeIntegerSchema,
  workflows: NonNegativeSafeIntegerSchema,
  artifacts: NonNegativeSafeIntegerSchema,
  events: NonNegativeSafeIntegerSchema,
});
export type SessionNavigationCounts = typeof SessionNavigationCountsSchema.Encoded;

export const SessionNavigationThreadIdsByStatusSchema = Schema.Struct({
  runningHandler: Schema.Array(ThreadId),
  runningWorkflow: Schema.Array(ThreadId),
  waiting: Schema.Array(ThreadId),
  troubleshooting: Schema.Array(ThreadId),
});
export type SessionNavigationThreadIdsByStatus =
  typeof SessionNavigationThreadIdsByStatusSchema.Encoded;

export const SessionNavigationTitleGenerationSchema = Schema.Struct({
  status: SessionNavigationTitleGenerationStatusSchema,
  renameLocked: Schema.Boolean,
  autoFrozen: Schema.Boolean,
  manualOverride: Schema.Boolean,
  triggeredAt: Schema.NullOr(IsoDateTimeStringSchema),
  finishedAt: Schema.NullOr(IsoDateTimeStringSchema),
  error: Schema.NullOr(Schema.String),
});
export type SessionNavigationTitleGeneration =
  typeof SessionNavigationTitleGenerationSchema.Encoded;

export const SessionNavigationSummarySchema = Schema.Struct({
  ...WorkspaceSessionNavigationSummarySchema.fields,
  id: WorkspaceSessionId,
  parentSessionId: Schema.optionalKey(WorkspaceSessionId),
  title: Schema.String,
  preview: Schema.String,
  createdAt: IsoDateTimeStringSchema,
  messageCount: NonNegativeSafeIntegerSchema,
  status: SessionNavigationStatusSchema,
  isUnread: Schema.Boolean,
  unreadAt: Schema.NullOr(IsoDateTimeStringSchema),
  unreadReason: Schema.NullOr(Schema.Literals(["assistant-turn-finished", "manual"])),
  lastReadAt: Schema.NullOr(IsoDateTimeStringSchema),
  provider: Schema.optionalKey(ProviderId),
  modelId: Schema.optionalKey(ModelId),
  thinkingLevel: Schema.optionalKey(Schema.String),
  wait: Schema.optionalKey(Schema.NullOr(SessionNavigationWaitSchema)),
  counts: Schema.optionalKey(SessionNavigationCountsSchema),
  threadIdsByStatus: Schema.optionalKey(SessionNavigationThreadIdsByStatusSchema),
  threadIds: Schema.optionalKey(Schema.Array(ThreadId)),
  sidebarThreads: Schema.optionalKey(Schema.Array(SessionNavigationSidebarHandlerThreadRowSchema)),
  commandRollups: Schema.optionalKey(Schema.Array(SessionNavigationCommandRollupSchema)),
  productEvents: Schema.optionalKey(Schema.Array(SessionNavigationProductEventSchema)),
  titleGeneration: Schema.optionalKey(SessionNavigationTitleGenerationSchema),
});
export type SessionNavigationSummary = typeof SessionNavigationSummarySchema.Encoded;

export const SessionNavigationReadModelSchema = Schema.Struct({
  pinnedSessions: Schema.Array(SessionNavigationSummarySchema),
  activeSessions: Schema.Array(SessionNavigationSummarySchema),
  sections: Schema.Struct({
    pinned: WorkspaceSessionNavigationSectionStateSchema,
    active: WorkspaceSessionNavigationSectionStateSchema,
    archived: WorkspaceSessionNavigationSectionStateSchema,
  }),
  archived: Schema.Struct({
    collapsed: Schema.Boolean,
    sessions: Schema.Array(SessionNavigationSummarySchema),
  }),
});
export type SessionNavigationReadModel = typeof SessionNavigationReadModelSchema.Encoded;

export const decodeUnknownSessionNavigationReadModelExit = Schema.decodeUnknownExit(
  SessionNavigationReadModelSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSessionNavigationReadModelEffect = Schema.decodeUnknownEffect(
  SessionNavigationReadModelSchema,
  strictBoundaryParseOptions,
);
export const encodeSessionNavigationReadModelExit = Schema.encodeExit(
  SessionNavigationReadModelSchema,
  strictBoundaryParseOptions,
);
export const encodeSessionNavigationReadModelEffect = Schema.encodeEffect(
  SessionNavigationReadModelSchema,
  strictBoundaryParseOptions,
);
