import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import type { ActorKind } from "./runtime-contracts";
import { ActorKindSchema } from "./runtime-contracts";

export const PromptExecutionSurfaceKindSchema = Schema.Literals([
  "orchestrator",
  "handler",
  "workflow-task",
]);
export type PromptExecutionSurfaceKind = typeof PromptExecutionSurfaceKindSchema.Type;

export const PromptExecutionEpisodeKindSchema = Schema.Literals([
  "analysis",
  "change",
  "workflow",
  "clarification",
]);
export type PromptExecutionEpisodeKind = typeof PromptExecutionEpisodeKindSchema.Type;

export interface PromptExecutionExternalInstructionSource {
  id: string;
  kind: "AGENTS.md" | "CLAUDE.md";
  title: string;
  path: string;
  contentHash: string;
  order: number;
  enabled: boolean;
  actors: readonly ActorKind[];
  sourceGroup: "builtin_global_root" | "custom_global_root" | "workspace_chain";
  rootId?: string;
  rootLabel?: string;
  readStatus: {
    status: "readable" | "unreadable";
    error?: string;
  };
}

export const PromptExecutionExternalInstructionSourceSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["AGENTS.md", "CLAUDE.md"]),
  title: Schema.String,
  path: Schema.String,
  contentHash: Schema.String,
  order: Schema.Number,
  enabled: Schema.Boolean,
  actors: Schema.Array(ActorKindSchema),
  sourceGroup: Schema.Literals(["builtin_global_root", "custom_global_root", "workspace_chain"]),
  rootId: Schema.optionalKey(Schema.String),
  rootLabel: Schema.optionalKey(Schema.String),
  readStatus: Schema.Struct({
    status: Schema.Literals(["readable", "unreadable"]),
    error: Schema.optionalKey(Schema.String),
  }),
});

export interface PromptExecutionContext {
  workspaceSessionId: string;
  turnId: string;
  workflowTaskAttemptId?: string | null;
  workflowRunId?: string | null;
  surfacePiSessionId: string;
  threadId?: string | null;
  surfaceKind: PromptExecutionSurfaceKind;
  defaultEpisodeKind: PromptExecutionEpisodeKind;
  rootThreadId: string | null;
  rootEpisodeKind: PromptExecutionEpisodeKind;
  sessionWaitApplied: boolean;
  threadWasTerminalAtStart: boolean;
  loadedExtensionIds: readonly string[];
  availableExtensionIds: readonly string[];
  externalInstructionSources?: readonly PromptExecutionExternalInstructionSource[];
  generatedAgentContextFingerprint: string;
  generatedAgentContextRevision: string;
  suppressPendingWorkflowAttentionDelivery?: boolean;
  queueItemId?: string | null;
}

export const PromptExecutionContextSchema = Schema.Struct({
  workspaceSessionId: Schema.String,
  turnId: Schema.String,
  workflowTaskAttemptId: Schema.NullOr(Schema.String),
  workflowRunId: Schema.NullOr(Schema.String),
  surfacePiSessionId: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  surfaceKind: PromptExecutionSurfaceKindSchema,
  defaultEpisodeKind: PromptExecutionEpisodeKindSchema,
  rootThreadId: Schema.NullOr(Schema.String),
  rootEpisodeKind: PromptExecutionEpisodeKindSchema,
  sessionWaitApplied: Schema.Boolean,
  threadWasTerminalAtStart: Schema.Boolean,
  loadedExtensionIds: Schema.Array(Schema.String),
  availableExtensionIds: Schema.Array(Schema.String),
  externalInstructionSources: Schema.optionalKey(
    Schema.Array(PromptExecutionExternalInstructionSourceSchema),
  ),
  generatedAgentContextFingerprint: Schema.String,
  generatedAgentContextRevision: Schema.String,
  suppressPendingWorkflowAttentionDelivery: Schema.optionalKey(Schema.Boolean),
  queueItemId: Schema.NullOr(Schema.String),
});

export const unsafeDecodePromptExecutionContextSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  PromptExecutionContextSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownPromptExecutionContextExit = Schema.decodeUnknownExit(
  PromptExecutionContextSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownPromptExecutionContextEffect = Schema.decodeUnknownEffect(
  PromptExecutionContextSchema,
  strictBoundaryParseOptions,
);
