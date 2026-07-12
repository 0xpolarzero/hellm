import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
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
import { WorkspaceLayoutSlotIdSchema } from "./workspace-layout-contracts";

export const WorkspaceReadModelInvalidationSchema = Schema.Union([
  Schema.Struct({ model: Schema.Literal("sessionNavigation") }),
  Schema.Struct({ model: Schema.Literal("promptHistory") }),
  Schema.Struct({
    model: Schema.Literal("workspaceLayout"),
    ids: Schema.Array(WorkspaceLayoutSlotIdSchema),
  }),
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
  Schema.Struct({ model: Schema.Literal("externalInstructions") }),
]);

export type WorkspaceReadModelInvalidation = typeof WorkspaceReadModelInvalidationSchema.Type;
export const unsafeDecodeWorkspaceReadModelInvalidationSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(WorkspaceReadModelInvalidationSchema, strictBoundaryParseOptions);
export const decodeUnknownWorkspaceReadModelInvalidationExit = Schema.decodeUnknownExit(
  WorkspaceReadModelInvalidationSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownWorkspaceReadModelInvalidationEffect = Schema.decodeUnknownEffect(
  WorkspaceReadModelInvalidationSchema,
  strictBoundaryParseOptions,
);

export const AppReadModelInvalidationSchema = Schema.Union([
  Schema.Struct({ model: Schema.Literal("workspaceChrome") }),
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
  Schema.Struct({ model: Schema.Literal("appLogs") }),
]);

export type AppReadModelInvalidation = typeof AppReadModelInvalidationSchema.Type;
export const unsafeDecodeAppReadModelInvalidationSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(AppReadModelInvalidationSchema, strictBoundaryParseOptions);
export const decodeUnknownAppReadModelInvalidationExit = Schema.decodeUnknownExit(
  AppReadModelInvalidationSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownAppReadModelInvalidationEffect = Schema.decodeUnknownEffect(
  AppReadModelInvalidationSchema,
  strictBoundaryParseOptions,
);

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
export const unsafeDecodeStateInvalidationDescriptorSyncForTestsAndBootstrap =
  Schema.decodeUnknownSync(StateInvalidationDescriptorSchema, strictBoundaryParseOptions);
export const decodeUnknownStateInvalidationDescriptorExit = Schema.decodeUnknownExit(
  StateInvalidationDescriptorSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownStateInvalidationDescriptorEffect = Schema.decodeUnknownEffect(
  StateInvalidationDescriptorSchema,
  strictBoundaryParseOptions,
);
