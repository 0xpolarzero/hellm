import * as Schema from "effect/Schema";
import {
  AgentProfileId,
  CommandId,
  ExtensionId,
  GeneratedPackageBuildId,
  ProviderId,
  RequestInputRequestId,
  RuntimeApprovalId,
  SnippetId,
  SurfacePiSessionId,
  ThreadId,
  WorkflowTaskAttemptId,
  WorkspaceId,
} from "./ids";

export const WorkspaceReadModelInvalidationSchema = Schema.Union([
  Schema.Struct({ model: Schema.Literal("sessionNavigation") }),
  Schema.Struct({ model: Schema.Literal("surface"), ids: Schema.Array(SurfacePiSessionId) }),
  Schema.Struct({ model: Schema.Literal("commandInspector"), ids: Schema.Array(CommandId) }),
  Schema.Struct({ model: Schema.Literal("handlerThreadInspector"), ids: Schema.Array(ThreadId) }),
  Schema.Struct({
    model: Schema.Literal("workflowTaskAttemptInspector"),
    ids: Schema.Array(WorkflowTaskAttemptId),
  }),
  Schema.Struct({
    model: Schema.Literal("requestInput"),
    ids: Schema.Array(RequestInputRequestId),
  }),
  Schema.Struct({
    model: Schema.Literal("runtimeApprovals"),
    ids: Schema.Array(RuntimeApprovalId),
  }),
  Schema.Struct({ model: Schema.Literal("appLogs") }),
  Schema.Struct({
    model: Schema.Literal("snippets"),
    ids: Schema.optionalKey(Schema.Array(SnippetId)),
  }),
]);

export type WorkspaceReadModelInvalidation = typeof WorkspaceReadModelInvalidationSchema.Type;

export const AppReadModelInvalidationSchema = Schema.Union([
  Schema.Struct({
    model: Schema.Literal("workflowsGenerated"),
    ids: Schema.optionalKey(Schema.Array(GeneratedPackageBuildId)),
  }),
  Schema.Struct({
    model: Schema.Literal("agents"),
    ids: Schema.optionalKey(Schema.Array(AgentProfileId)),
  }),
  Schema.Struct({
    model: Schema.Literal("extensions"),
    ids: Schema.optionalKey(Schema.Array(ExtensionId)),
  }),
  Schema.Struct({ model: Schema.Literal("settings") }),
  Schema.Struct({
    model: Schema.Literal("providerAuth"),
    ids: Schema.optionalKey(Schema.Array(ProviderId)),
  }),
  Schema.Struct({ model: Schema.Literal("appPreferences") }),
]);

export type AppReadModelInvalidation = typeof AppReadModelInvalidationSchema.Type;

export const StateInvalidationDescriptorSchema = Schema.Union([
  Schema.Struct({
    scope: Schema.Literal("workspace"),
    workspaceId: WorkspaceId,
    invalidation: WorkspaceReadModelInvalidationSchema,
  }),
  Schema.Struct({
    scope: Schema.Literal("app"),
    invalidation: AppReadModelInvalidationSchema,
  }),
]);

export type StateInvalidationDescriptor = typeof StateInvalidationDescriptorSchema.Type;
