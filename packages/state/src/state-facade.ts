import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  AbsolutePath,
  AppLogEntryId,
  type ArtifactId,
  type ByteCount,
  type CommandFactsPayload,
  type CommandId,
  type ComposerAttachment,
  type AppLogEntry,
  type AppLogLevel,
  type IsoDateTimeString,
  type AppLogQuery,
  type AppLogReadModel,
  type AppLogSource,
  type AppLogSummary,
  type AppLogWritePort,
  type AppLogWritePortService,
  type ExtensionStatePort,
  type JsonValue as JsonValueType,
  type MessageId,
  type NonNegativeSafeInteger,
  type PiSessionReferencePort,
  type PositiveSafeInteger,
  type ProviderAuthStatus,
  type ProviderAuthStatusStatePort,
  type ProviderId,
  type QueueItemId,
  type RequestInputOptionId,
  type RequestInputQuestionId,
  type RequestInputRequestId,
  type RuntimeApprovalId,
  type RuntimeApprovalRecord,
  type RuntimeMessageDelivery,
  type RuntimeRequestInputDetailsRecord,
  type RuntimeSurfaceTarget,
  type RuntimeActorExtensionBindingStatePort,
  type RuntimeApprovalStatePort,
  type RuntimeArtifactStatePort,
  type RuntimeClientSubmissionInput,
  type RuntimeCommandStatePort,
  type RuntimeComposerDraftStatePort,
  type RuntimeEpisodeStatePort,
  type RuntimeExtensionContextImpactStatePort,
  type RuntimeExtensionStatePort,
  type RuntimeGeneratedPackageStatePort,
  type RuntimePromptDefaultsStatePort,
  type RuntimeQueueStatePort,
  type RuntimeReadModelStatePort,
  type RuntimeRecoveryStatePort,
  type RuntimeRequestStatePort,
  type RuntimeSessionWaitStatePort,
  type RuntimeSourceStatePort,
  type RuntimeSurfaceLifecycleStatePort,
  type RuntimeThreadStatePort,
  type RuntimeTurnStatePort,
  type RuntimeWorkspaceStatePort,
  type SandboxPolicySource,
  type StateCommandPostCommitNotificationError,
  StateCommandPostCommitNotificationPort,
  type StateCommandReceipt,
  StateContractError,
  type StateFacadeErrorContract,
  type StateInvalidationDescriptor,
  type StateMutationResult,
  type StateStoredError,
  type StateRevision,
  type SurfacePiSessionId,
  type TurnId,
  type WorkspaceSessionId,
  type WorkspaceSessionNavigationReadModel,
  type WorkspaceSessionNavigationSummary,
  type WorkspaceId as WorkspaceIdType,
} from "@svvy/core";
import {
  appLogStateFromStore,
  createAppLogStore,
  AppLogState,
  layerAppLogState,
} from "./app-log-store";
import { appLogWritePortFromAppLogState } from "./app-log-write-port";
import { layerAppLogWritePort } from "./app-log-write-port";
import { mutationResult } from "./state-mutation-result";
import { structuredSessionStatePortsLayerWithSandboxPolicyConfig } from "./structured-session-state-ports-layer";
import { buildWorkspaceSessionNavigation } from "./session-navigation";
import { buildStructuredCommandInspector } from "./structured-session-selectors";
import {
  createStructuredSessionStateStore,
  structuredSessionStateFromStore,
  StructuredSessionState,
  type StateDigestHelper,
  type StructuredCommandRecord,
  type StructuredRuntimeApprovalRequestRecord,
  type StructuredSessionSnapshot,
  type StructuredAppPreferencesRecord,
  type StructuredSurfaceQueuedMessageRecord,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import type { StateLayerConfig } from "./state-layer-config";
import type { WorkspaceStateRouter } from "./workspace-state-router";
import {
  decodeUnknownClearWorkspaceAppLogUnreadCommandInputEffect,
  decodeUnknownMarkAppLogReadCommandInputEffect,
  decodeUnknownMarkVisibleAppLogRangeReadCommandInputEffect,
  decodeUnknownRecordProviderAuthStatusCommandInputEffect,
  decodeUnknownUpdateAppPreferencesCommandInputEffect,
  type AppPreferenceAppearance,
  type AppPreferenceApprovalMode,
  type ClearWorkspaceAppLogUnreadCommandInput,
  type MarkAppLogReadCommandInput,
  type MarkVisibleAppLogRangeReadCommandInput,
  type RecordProviderAuthStatusCommandInput,
  type UpdateAppPreferencesCommandInput,
} from "./state-command-schemas";

export interface StateFacadeCallOptions {
  signal?: AbortSignal;
}

export type AppLogReadModelRequest =
  | {
      kind: "appLogs";
      workspaceId?: WorkspaceIdType;
      query?: AppLogQuery;
    }
  | {
      kind: "appLogSummary";
      workspaceId?: WorkspaceIdType;
    };

export type StateReadModelRequest =
  | AppLogReadModelRequest
  | AppPreferencesReadModelRequest
  | ProviderAuthReadModelRequest
  | SessionNavigationReadModelRequest
  | SurfaceTranscriptReadModelRequest
  | SurfaceSummaryReadModelRequest
  | SurfaceComposerReadModelRequest
  | SurfaceQueuedMessagesReadModelRequest
  | CommandInspectorReadModelRequest
  | RequestInputReadModelRequest
  | ApprovalsReadModelRequest;

export type StateReadModelResult =
  | { kind: "appLogs"; value: AppLogReadModel }
  | { kind: "appLogSummary"; value: AppLogSummary }
  | { kind: "appPreferences"; value: AppPreferencesReadModel }
  | { kind: "settings"; value: SettingsReadModel }
  | { kind: "providerAuth"; value: ProviderAuthReadModel }
  | { kind: "sessionNavigation"; value: SessionNavigationReadModel }
  | { kind: "surfaceTranscript"; value: SurfaceTranscriptReadModel }
  | { kind: "surfaceSummary"; value: SurfaceSummaryReadModel }
  | { kind: "surfaceComposer"; value: SurfaceComposerReadModel }
  | { kind: "surfaceQueuedMessages"; value: SurfaceQueuedMessagesReadModel }
  | { kind: "commandInspector"; value: CommandInspectorReadModel | null }
  | { kind: "requestInput"; value: RequestInputReadModel }
  | { kind: "approvals"; value: ApprovalsReadModel };

export interface AppPreferencesReadModel {
  appearance: AppPreferenceAppearance;
  externalEditor: string | null;
  artifactDirectory: string;
  approvalMode: AppPreferenceApprovalMode;
  networkAccess: boolean;
  ambientResources: JsonValueType;
  updatedAt: IsoDateTimeString;
  revision: StateRevision;
}

export interface SettingsReadModel {
  preferences: AppPreferencesReadModel;
}

export interface AppPreferencesReadModelRequest {
  kind: "appPreferences" | "settings";
}

export interface ProviderAuthReadModel {
  providers: readonly ProviderAuthStatus[];
  usableModelProviders: readonly ProviderId[];
}

export interface ProviderAuthReadModelRequest {
  kind: "providerAuth";
  workspaceId?: WorkspaceIdType;
}

export const StateReadModelRequestSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("appLogs"),
    workspaceId: Schema.optionalKey(Schema.String),
    query: Schema.optionalKey(Schema.Json),
  }),
  Schema.Struct({
    kind: Schema.Literal("appLogSummary"),
    workspaceId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("appPreferences") }),
  Schema.Struct({ kind: Schema.Literal("settings") }),
  Schema.Struct({
    kind: Schema.Literal("providerAuth"),
    workspaceId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("sessionNavigation"),
    workspaceId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("surfaceTranscript"),
    target: Schema.Json,
    afterMessageId: Schema.optionalKey(Schema.String),
    limit: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({ kind: Schema.Literal("surfaceSummary"), target: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("surfaceComposer"), target: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("surfaceQueuedMessages"), target: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("commandInspector"), commandId: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("requestInput"),
    workspaceId: Schema.optionalKey(Schema.String),
    surfacePiSessionId: Schema.optionalKey(Schema.String),
    requestId: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("approvals"),
    workspaceId: Schema.optionalKey(Schema.String),
    surfacePiSessionId: Schema.optionalKey(Schema.String),
    requestId: Schema.optionalKey(Schema.String),
  }),
]);

export const StateReadModelResultSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("appLogs"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("appLogSummary"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("appPreferences"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("settings"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("providerAuth"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("sessionNavigation"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("surfaceTranscript"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("surfaceSummary"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("surfaceComposer"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("surfaceQueuedMessages"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("commandInspector"), value: Schema.NullOr(Schema.Json) }),
  Schema.Struct({ kind: Schema.Literal("requestInput"), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal("approvals"), value: Schema.Json }),
]);

export interface SessionNavigationReadModelRequest {
  kind: "sessionNavigation";
  workspaceId?: WorkspaceIdType;
}

export interface SurfaceTranscriptReadModelRequest {
  kind: "surfaceTranscript";
  target: RuntimeSurfaceTarget;
  afterMessageId?: MessageId;
  limit?: PositiveSafeInteger;
}

export interface SurfaceSummaryReadModelRequest {
  kind: "surfaceSummary";
  target: RuntimeSurfaceTarget;
}

export interface SurfaceComposerReadModelRequest {
  kind: "surfaceComposer";
  target: RuntimeSurfaceTarget;
}

export interface SurfaceQueuedMessagesReadModelRequest {
  kind: "surfaceQueuedMessages";
  target: RuntimeSurfaceTarget;
}

export interface CommandInspectorReadModelRequest {
  kind: "commandInspector";
  commandId: CommandId;
}

export interface RequestInputReadModelRequest {
  kind: "requestInput";
  workspaceId?: WorkspaceIdType;
  surfacePiSessionId?: SurfacePiSessionId;
  requestId?: RequestInputRequestId;
}

export interface ApprovalsReadModelRequest {
  kind: "approvals";
  workspaceId?: WorkspaceIdType;
  surfacePiSessionId?: SurfacePiSessionId;
  requestId?: RuntimeApprovalId;
}

export type SessionNavigationReadModel =
  WorkspaceSessionNavigationReadModel<SessionNavigationSummary>;

export interface SessionNavigationSummary extends WorkspaceSessionNavigationSummary {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  messageCount: number;
  status: "idle" | "running" | "waiting" | "error";
  isUnread: boolean;
  unreadAt: string | null;
  unreadReason: "assistant-turn-finished" | "manual" | null;
  lastReadAt: string | null;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
  wait?: {
    threadId?: string;
    kind: "user" | "external" | "approval" | "signal" | "timer";
    reason: string;
    resumeWhen: string;
    since: string;
  } | null;
  counts?: {
    turns: number;
    threads: number;
    commands: number;
    episodes: number;
    workflows: number;
    artifacts: number;
    events: number;
  };
  threadIds?: string[];
}

export interface SurfaceTranscriptReadModel {
  target: RuntimeSurfaceTarget;
  surfaceStatus: "idle" | "running" | "waiting" | "error";
  promptLock: { activeTurnId: TurnId | null; queuedCount: number };
  composerDraft: { text: string; attachmentIds: readonly string[] };
  messages: readonly {
    messageId: MessageId;
    role: "user" | "assistant";
    turnId?: TurnId;
    text?: string;
    commandIds?: readonly CommandId[];
    createdAt: IsoDateTimeString;
  }[];
}

export interface SurfaceSummaryReadModel {
  target: RuntimeSurfaceTarget;
  title: string;
  status: SurfaceTranscriptReadModel["surfaceStatus"];
  activeTurnId: TurnId | null;
  activeTurnStartedAt: IsoDateTimeString | null;
  queuedCount: number;
  model: string;
  provider: string;
  reasoningEffort: string;
  agentProfileId: string;
  loadedExtensionIds: readonly string[];
  availableExtensionIds: readonly string[];
}

export interface SurfaceComposerReadModel {
  target: RuntimeSurfaceTarget;
  draft: {
    text: string;
    attachments: readonly ComposerAttachment[];
    snippetMentions: readonly unknown[];
    updatedAt: IsoDateTimeString | null;
  };
}

export interface SurfaceQueuedMessagesReadModel {
  target: RuntimeSurfaceTarget;
  queuedMessages: readonly {
    id: QueueItemId;
    kind: StructuredSurfaceQueuedMessageRecord["kind"];
    text: string;
    title?: string;
    summary?: string;
    threadId?: string;
    episodeId?: string;
    sourceCommandId?: CommandId;
    status: "queued" | "steering" | "dispatching" | "failed";
    failureError?: string;
    createdAt: IsoDateTimeString;
    updatedAt: IsoDateTimeString;
  }[];
}

export interface CommandInspectorReadModel {
  commandId: CommandId;
  status: "pending" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  toolName: string;
  target?: RuntimeSurfaceTarget;
  acceptedArguments?: JsonValueType;
  summary?: string;
  error?: StateStoredError;
  finishedAt?: IsoDateTimeString;
  output: readonly {
    stream: "stdout" | "stderr";
    text: string;
    sequence: NonNegativeSafeInteger;
  }[];
  stdin: {
    mode: "none" | "continuable";
    canAttemptWrite: boolean;
    acceptedWrites: readonly {
      text: string;
      acceptedBytes: ByteCount;
      at: IsoDateTimeString;
    }[];
  };
  facts?: CommandFactsPayload;
  childCommandIds: readonly CommandId[];
  artifactIds: readonly ArtifactId[];
}

export interface RequestInputReadModel {
  requests: RequestInputReadModelRequestItem[];
}

export type WorkspaceRequestInputDelivery = RuntimeMessageDelivery;

export interface RequestInputReadModelRequestItem {
  requestId: RequestInputRequestId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId: string | null;
  ownerTitle: string;
  variant: "nonblocking" | "blocking";
  status: "open" | "completed" | "cancelled" | "expired";
  createdAt: IsoDateTimeString;
  completedAt: IsoDateTimeString | null;
  timeout: RuntimeRequestInputDetailsRecord["timeout"];
  questions: {
    questionId: RequestInputQuestionId;
    ordinal: number;
    title: string;
    question: string;
    defaultAnswer:
      | { kind: "option"; label: string; text: string }
      | { kind: "custom"; text: string };
    choices: {
      optionId: RequestInputOptionId;
      ordinal: number;
      label: string;
      description: string;
      recommended: boolean;
    }[];
    status: "open" | "answered" | "defaulted" | "cancelled";
  }[];
}

export interface ApprovalsReadModel {
  requests: ApprovalReadModelRequestItem[];
}

export interface ApprovalReadModelRequestItem {
  requestId: RuntimeApprovalId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId: string | null;
  ownerTitle: string;
  toolName: RuntimeApprovalRecord["toolName"];
  approvalMode: RuntimeApprovalRecord["approvalMode"];
  cwd: string;
  command: string | null;
  commandFamily: string | null;
  snippetArtifactId: string | null;
  status: RuntimeApprovalRecord["status"];
  createdAt: IsoDateTimeString;
  completedAt: IsoDateTimeString | null;
  summary: string;
}

export interface StateReadModelInvalidationRefetchRequest {
  descriptor: StateInvalidationDescriptor;
}

export interface StateReadModelBaseline {
  app: readonly StateReadModelResult[];
  workspaces: readonly StateReadModelResult[];
  revision: StateRevision;
}

export interface StateReadModelRebaselineRequest {
  workspaceId?: WorkspaceIdType;
  reason: "renderer-startup" | "event-sequence-gap" | "manual-refresh" | "runtime-restart";
}

export interface StateReadModelsService {
  fetch(input: StateReadModelRequest): Effect.Effect<StateReadModelResult, StateContractError>;
  refetchInvalidation(
    input: StateReadModelInvalidationRefetchRequest,
  ): Effect.Effect<readonly StateReadModelResult[], StateContractError>;
  rebaseline(
    input: StateReadModelRebaselineRequest,
  ): Effect.Effect<StateReadModelBaseline, StateContractError>;
}

export class StateReadModels extends Context.Service<StateReadModels, StateReadModelsService>()(
  "@svvy/state/StateReadModels",
) {}

export type StateCommandResult<Extra extends object = Record<never, never>> = Extra & {
  receipt: StateCommandReceipt;
};

export interface AppLogReadStateCommands {
  markRead(
    input: MarkAppLogReadCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  markVisibleRangeRead(
    input: MarkVisibleAppLogRangeReadCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
  clearWorkspaceUnread(
    input: ClearWorkspaceAppLogUnreadCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
}

export interface AppPreferencesStateCommands {
  update(
    input: UpdateAppPreferencesCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
}

export interface ProviderAuthStateCommands {
  recordStatus(
    input: RecordProviderAuthStatusCommandInput,
  ): Effect.Effect<StateMutationResult<StateCommandResult>, StateContractError>;
}

export interface StateCommandsService {
  appLogs: AppLogReadStateCommands;
  appPreferences: AppPreferencesStateCommands;
  providerAuth: ProviderAuthStateCommands;
}

export class StateCommands extends Context.Service<StateCommands, StateCommandsService>()(
  "@svvy/state/StateCommands",
) {}

export interface StateFacade {
  readModels: {
    fetch(
      input: StateReadModelRequest,
      options?: StateFacadeCallOptions,
    ): Promise<StateReadModelResult>;
    refetchInvalidation(
      input: StateReadModelInvalidationRefetchRequest,
      options?: StateFacadeCallOptions,
    ): Promise<readonly StateReadModelResult[]>;
    rebaseline(
      input: StateReadModelRebaselineRequest,
      options?: StateFacadeCallOptions,
    ): Promise<StateReadModelBaseline>;
  };
  close(): void;
}

export interface StateCommandsFacade {
  appLogs: {
    markRead(
      input: MarkAppLogReadCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    markVisibleRangeRead(
      input: MarkVisibleAppLogRangeReadCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    clearWorkspaceUnread(
      input: ClearWorkspaceAppLogUnreadCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  appPreferences: {
    update(
      input: UpdateAppPreferencesCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  providerAuth: {
    recordStatus(
      input: RecordProviderAuthStatusCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  close(): void;
}

export interface StateAppLogAppendInput {
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

export interface StateAppLogsFacade {
  append(entry: StateAppLogAppendInput): AppLogEntry;
  query(query?: AppLogQuery): AppLogReadModel;
  summary(): AppLogSummary;
  markSeen(throughSeq: number): AppLogSummary;
  subscribe(listener: (entries: AppLogEntry[], summary: AppLogSummary) => void): () => void;
  writePort: AppLogWritePortService;
  close(): void;
}

export interface CreateStateAppLogsFacadeOptions {
  databasePath?: string;
  now: () => string;
  memoryLimit?: number;
  persistedLimit?: number;
  retentionDays?: number;
}

type StateLayerConfigInput = {
  readonly config: StateLayerConfig;
  readonly digest?: StateDigestHelper;
};

type StateLayerProvidedPortServices =
  | ExtensionStatePort
  | RuntimeWorkspaceStatePort
  | RuntimeSurfaceLifecycleStatePort
  | RuntimeComposerDraftStatePort
  | RuntimeQueueStatePort
  | RuntimeTurnStatePort
  | RuntimeCommandStatePort
  | RuntimeApprovalStatePort
  | RuntimeActorExtensionBindingStatePort
  | RuntimeEpisodeStatePort
  | RuntimeExtensionStatePort
  | RuntimeExtensionContextImpactStatePort
  | RuntimeGeneratedPackageStatePort
  | RuntimePromptDefaultsStatePort
  | RuntimeArtifactStatePort
  | RuntimeRecoveryStatePort
  | RuntimeReadModelStatePort
  | RuntimeRequestStatePort
  | RuntimeSessionWaitStatePort
  | RuntimeSourceStatePort
  | RuntimeThreadStatePort
  | ProviderAuthStatusStatePort
  | SandboxPolicySource
  | PiSessionReferencePort;

const stateLayerNow = () => "1970-01-01T00:00:00.000Z";

export function createStateFacade(
  managedRuntime: ManagedRuntime.ManagedRuntime<StateReadModels, unknown>,
): StateFacade {
  let closed = false;
  const run = <A, E>(
    operation: string,
    effect: Effect.Effect<A, E, StateReadModels>,
    options?: StateFacadeCallOptions,
  ): Promise<A> => runStateFacadeEffect({ managedRuntime, operation, effect, options, closed });

  return {
    readModels: {
      fetch: (input, options) =>
        run(
          "state.readModels.fetch",
          Effect.gen(function* () {
            const readModels = yield* StateReadModels;
            return yield* readModels.fetch(input);
          }),
          options,
        ),
      refetchInvalidation: (input, options) =>
        run(
          "state.readModels.refetchInvalidation",
          Effect.gen(function* () {
            const readModels = yield* StateReadModels;
            return yield* readModels.refetchInvalidation(input);
          }),
          options,
        ),
      rebaseline: (input, options) =>
        run(
          "state.readModels.rebaseline",
          Effect.gen(function* () {
            const readModels = yield* StateReadModels;
            return yield* readModels.rebaseline(input);
          }),
          options,
        ),
    },
    close: () => {
      closed = true;
    },
  };
}

export function createStateCommandsFacade(
  managedRuntime: ManagedRuntime.ManagedRuntime<
    StateCommands | StateCommandPostCommitNotificationPort,
    unknown
  >,
): StateCommandsFacade {
  let closed = false;
  const run = <A extends { readonly receipt: StateCommandReceipt }, E>(
    operation: string,
    effect: Effect.Effect<StateMutationResult<A>, E, StateCommands>,
    clientSubmission: RuntimeClientSubmissionInput | undefined,
    callOptions?: StateFacadeCallOptions,
  ): Promise<A> =>
    runStateFacadeEffect({
      managedRuntime,
      operation,
      options: callOptions,
      closed,
      effect: Effect.gen(function* () {
        const result = yield* effect;
        if (result.afterCommit.length > 0) {
          const notifications = yield* StateCommandPostCommitNotificationPort;
          yield* notifications
            .notifyCommittedStateCommand({
              operation,
              receipt: result.value.receipt,
              descriptors: result.afterCommit,
              ...(clientSubmission ? { clientSubmission } : {}),
            })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.fail(
                  postCommitNotificationError(
                    operation,
                    result.value.receipt,
                    result.afterCommit,
                    cause,
                  ),
                ),
              ),
            );
        }
        return result.value;
      }),
    });

  return {
    appLogs: {
      markRead: (input, callOptions) =>
        run(
          "stateCommands.appLogs.markRead",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.appLogs.markRead(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      markVisibleRangeRead: (input, callOptions) =>
        run(
          "stateCommands.appLogs.markVisibleRangeRead",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.appLogs.markVisibleRangeRead(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
      clearWorkspaceUnread: (input, callOptions) =>
        run(
          "stateCommands.appLogs.clearWorkspaceUnread",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.appLogs.clearWorkspaceUnread(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
    },
    appPreferences: {
      update: (input, callOptions) =>
        run(
          "stateCommands.appPreferences.update",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.appPreferences.update(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
    },
    providerAuth: {
      recordStatus: (input, callOptions) =>
        run(
          "stateCommands.providerAuth.recordStatus",
          Effect.gen(function* () {
            const commands = yield* StateCommands;
            return yield* commands.providerAuth.recordStatus(input);
          }),
          input.clientSubmission,
          callOptions,
        ),
    },
    close: () => {
      closed = true;
    },
  };
}

export function createStateAppLogsFacade(
  options: CreateStateAppLogsFacadeOptions,
): StateAppLogsFacade {
  const store = createAppLogStore(options);
  const appLogState = appLogStateFromStore(store);
  return {
    append: (entry) => store.append(entry),
    query: (query) => store.query(query),
    summary: () => store.summary(),
    markSeen: (throughSeq) => store.markSeen(throughSeq),
    subscribe: (listener) => store.subscribe(listener),
    writePort: appLogWritePortFromAppLogState(appLogState),
    close: () => store.close(),
  };
}

const makeStateReadModels = Effect.fn("@svvy/state/makeStateReadModels")(function* () {
  const appLogs = yield* AppLogState;
  const structuredSession = yield* StructuredSessionState;
  return stateReadModelsFromState({
    appLogs: appLogStateResolver(appLogs),
    structuredSession: () => Effect.succeed(structuredSession),
  });
});

export function stateReadModelsFromRouter(input: {
  router: WorkspaceStateRouter;
  appLogs: AppLogState["Service"];
  resolveAppLogs?: AppLogStateResolver;
}): StateReadModels["Service"] {
  return stateReadModelsFromState({
    appLogs: input.resolveAppLogs ?? appLogStateResolver(input.appLogs),
    structuredSession: (workspaceId) =>
      workspaceId
        ? input.router.resolveWorkspaceStructuredSession(workspaceId)
        : Effect.succeed(input.router.appGlobalStructuredSession),
  });
}

export function stateCommandsFromRouter(input: {
  router: WorkspaceStateRouter;
  appLogs: AppLogState["Service"];
  resolveAppLogs?: AppLogStateResolver;
}): StateCommands["Service"] {
  return stateCommandsFromState({
    appLogs: input.resolveAppLogs ?? appLogStateResolver(input.appLogs),
    structuredSession: input.router.appGlobalStructuredSession,
  });
}

const layerStateReadModels = Layer.effect(StateReadModels, makeStateReadModels());

const makeStateCommands = Effect.fn("@svvy/state/makeStateCommands")(function* () {
  const appLogs = yield* AppLogState;
  const structuredSession = yield* StructuredSessionState;
  return stateCommandsFromState({ appLogs: appLogStateResolver(appLogs), structuredSession });
});

const layerStateCommands = Layer.effect(StateCommands, makeStateCommands());

export const layer = (
  input: StateLayerConfigInput,
): Layer.Layer<
  StateReadModels | StateCommands | AppLogWritePort | StateLayerProvidedPortServices,
  StateContractError,
  FileSystem.FileSystem | Path.Path
> => {
  const structuredSessionLayer = layerRootStructuredSessionState(input);
  const packageStateLayer = Layer.mergeAll(
    layerAppLogState({
      databasePath: input.config.databasePath,
      busyTimeoutMs: input.config.busyTimeoutMs,
      now: stateLayerNow,
    }),
    structuredSessionLayer,
  );
  return Layer.mergeAll(
    Layer.mergeAll(layerStateReadModels, layerStateCommands, layerAppLogWritePort).pipe(
      Layer.provide(packageStateLayer),
    ),
    structuredSessionStatePortsLayerWithSandboxPolicyConfig(input.config.sandboxPolicy ?? {}).pipe(
      Layer.provide(structuredSessionLayer),
    ),
  );
};

function layerRootStructuredSessionState(
  input: StateLayerConfigInput,
): Layer.Layer<StructuredSessionState, StateContractError, FileSystem.FileSystem | Path.Path> {
  return Layer.effect(
    StructuredSessionState,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fileSystem
        .makeDirectory(path.dirname(input.config.databasePath), { recursive: true })
        .pipe(
          Effect.mapError((cause) =>
            stateLayerOpenError("state.structuredSession.prepareDatabaseDirectory", cause),
          ),
        );
      yield* fileSystem
        .makeDirectory(input.config.artifactRoot, { recursive: true })
        .pipe(Effect.catch(() => Effect.void));

      const store = yield* Effect.acquireRelease(
        Effect.try({
          try: () =>
            createStructuredSessionStateStore({
              databasePath: input.config.databasePath,
              busyTimeoutMs: input.config.busyTimeoutMs,
              filesystemSetup: "caller",
              ...(input.digest ? { digest: input.digest } : {}),
              workspace: {
                id: "workspace_state_root" as WorkspaceIdType,
                label: "State root",
                cwd: path.dirname(input.config.databasePath) as typeof AbsolutePath.Type,
                artifactDir: input.config.artifactRoot,
              },
              now: stateLayerNow,
            }),
          catch: (cause) => stateLayerOpenError("state.structuredSession.open", cause),
        }),
        (acquiredStore: StructuredSessionStateStore) =>
          Effect.try({
            try: () => acquiredStore.close(),
            catch: (cause) => stateLayerOpenError("state.structuredSession.close", cause),
          }).pipe(Effect.ignore),
      );
      return structuredSessionStateFromStore(store);
    }),
  );
}

function stateLayerOpenError(operation: string, cause: unknown): StateContractError {
  if (cause instanceof StateContractError) {
    return cause;
  }
  return new StateContractError({
    operation,
    reason: "transaction-failed",
    message: cause instanceof Error ? cause.message : "State layer open failed.",
    cause,
  });
}

type AppLogStateResolver = (
  workspaceId: WorkspaceIdType | undefined,
) => Effect.Effect<AppLogState["Service"], StateContractError>;

type StructuredSessionStateResolver = (
  workspaceId: WorkspaceIdType | undefined,
) => Effect.Effect<StructuredSessionState["Service"], StateContractError>;

function appLogStateResolver(appLogs: AppLogState["Service"]): AppLogStateResolver {
  return () => Effect.succeed(appLogs);
}

function stateReadModelsFromState(state: {
  appLogs: AppLogStateResolver;
  structuredSession: StructuredSessionStateResolver;
}): StateReadModels["Service"] {
  return StateReadModels.of({
    fetch: (request) =>
      Effect.gen(function* () {
        const structuredSession = yield* state.structuredSession(readModelWorkspaceId(request));
        switch (request.kind) {
          case "appLogs": {
            const appLogs = yield* state.appLogs(request.workspaceId);
            return { kind: "appLogs", value: yield* appLogs.query(request.query) };
          }
          case "appLogSummary": {
            const appLogs = yield* state.appLogs(request.workspaceId);
            return { kind: "appLogSummary", value: yield* appLogs.summary() };
          }
          case "appPreferences": {
            const record = yield* structuredSession.readAppPreferences();
            const preferences = appPreferencesReadModel(record);
            return { kind: "appPreferences", value: preferences };
          }
          case "settings": {
            const record = yield* structuredSession.readAppPreferences();
            const preferences = appPreferencesReadModel(record);
            return { kind: "settings", value: { preferences } };
          }
          case "providerAuth": {
            const providers = yield* structuredSession.listProviderAuthStatuses(
              request.workspaceId ? { workspaceId: request.workspaceId } : {},
            );
            return { kind: "providerAuth", value: providerAuthReadModel(providers) };
          }
          case "sessionNavigation":
            return {
              kind: "sessionNavigation",
              value: yield* buildSessionNavigationReadModel(structuredSession),
            };
          case "surfaceTranscript":
            return {
              kind: "surfaceTranscript",
              value: yield* buildSurfaceTranscriptReadModel(structuredSession, request),
            };
          case "surfaceSummary":
            return {
              kind: "surfaceSummary",
              value: yield* buildSurfaceSummaryReadModel(structuredSession, request.target),
            };
          case "surfaceComposer":
            return {
              kind: "surfaceComposer",
              value: yield* buildSurfaceComposerReadModel(structuredSession, request.target),
            };
          case "surfaceQueuedMessages":
            return {
              kind: "surfaceQueuedMessages",
              value: yield* buildSurfaceQueuedMessagesReadModel(structuredSession, request.target),
            };
          case "commandInspector":
            return {
              kind: "commandInspector",
              value: yield* buildCommandInspectorReadModel(structuredSession, request.commandId),
            };
          case "requestInput":
            return {
              kind: "requestInput",
              value: yield* buildRequestInputReadModel(structuredSession, request),
            };
          case "approvals":
            return {
              kind: "approvals",
              value: yield* buildApprovalsReadModel(structuredSession, request),
            };
        }
      }),
    refetchInvalidation: (request) =>
      Effect.gen(function* () {
        const structuredSession = yield* state.structuredSession(
          request.descriptor.scope === "workspace" ? request.descriptor.workspaceId : undefined,
        );
        switch (request.descriptor.invalidation.model) {
          case "appLogs": {
            const appLogs = yield* state.appLogs(
              request.descriptor.scope === "workspace" ? request.descriptor.workspaceId : undefined,
            );
            const [logs, summary] = yield* Effect.all([appLogs.query(), appLogs.summary()]);
            return [
              { kind: "appLogs", value: logs },
              { kind: "appLogSummary", value: summary },
            ];
          }
          case "appPreferences": {
            const record = yield* structuredSession.readAppPreferences();
            const preferences = appPreferencesReadModel(record);
            return [{ kind: "appPreferences", value: preferences }];
          }
          case "settings": {
            const record = yield* structuredSession.readAppPreferences();
            const preferences = appPreferencesReadModel(record);
            return [{ kind: "settings", value: { preferences } }];
          }
          case "providerAuth": {
            const providers = yield* structuredSession.listProviderAuthStatuses(
              request.descriptor.scope === "workspace"
                ? { workspaceId: request.descriptor.workspaceId }
                : {},
            );
            return [{ kind: "providerAuth", value: providerAuthReadModel(providers) }];
          }
          case "sessionNavigation":
            return [
              {
                kind: "sessionNavigation",
                value: yield* buildSessionNavigationReadModel(structuredSession),
              },
            ];
          case "surface":
            return yield* refetchSurfaceInvalidation(
              structuredSession,
              request.descriptor.invalidation.ids,
            );
          case "commandInspector":
            return yield* Effect.all(
              request.descriptor.invalidation.ids.map((commandId) =>
                buildCommandInspectorReadModel(structuredSession, commandId).pipe(
                  Effect.map(
                    (value): StateReadModelResult => ({ kind: "commandInspector", value }),
                  ),
                ),
              ),
            );
          case "requestInput":
            return [
              {
                kind: "requestInput",
                value: yield* buildRequestInputReadModel(structuredSession, {
                  kind: "requestInput",
                }),
              },
            ];
          case "runtimeApprovals":
            return [
              {
                kind: "approvals",
                value: yield* buildApprovalsReadModel(structuredSession, { kind: "approvals" }),
              },
            ];
          default:
            return [];
        }
      }),
    rebaseline: (request) =>
      Effect.gen(function* () {
        const appLogs = yield* state.appLogs(request.workspaceId);
        const structuredSession = yield* state.structuredSession(request.workspaceId);
        const [logs, summary, currentStateRevision] = yield* Effect.all([
          appLogs.query(),
          appLogs.summary(),
          structuredSession.readCurrentStateRevision(),
        ]);
        const record = yield* structuredSession.readAppPreferences();
        const preferences = appPreferencesReadModel(record);
        return {
          app: [
            { kind: "appLogSummary", value: summary },
            { kind: "appPreferences", value: preferences },
            { kind: "settings", value: { preferences } },
            {
              kind: "providerAuth",
              value: providerAuthReadModel(yield* structuredSession.listProviderAuthStatuses({})),
            },
          ],
          workspaces: [
            { kind: "appLogs", value: logs },
            {
              kind: "sessionNavigation",
              value: yield* buildSessionNavigationReadModel(structuredSession),
            },
            {
              kind: "requestInput",
              value: yield* buildRequestInputReadModel(structuredSession, { kind: "requestInput" }),
            },
            {
              kind: "approvals",
              value: yield* buildApprovalsReadModel(structuredSession, { kind: "approvals" }),
            },
          ],
          revision: Math.max(summary.latestSeq, currentStateRevision) as StateRevision,
        };
      }),
  });
}

function readModelWorkspaceId(request: StateReadModelRequest): WorkspaceIdType | undefined {
  switch (request.kind) {
    case "appLogs":
    case "appLogSummary":
    case "providerAuth":
    case "sessionNavigation":
    case "requestInput":
    case "approvals":
      return request.workspaceId;
    default:
      return undefined;
  }
}

function buildSessionNavigationReadModel(
  state: StructuredSessionState["Service"],
): Effect.Effect<SessionNavigationReadModel, StateContractError> {
  return Effect.gen(function* () {
    const snapshots = yield* state.listSessionStates();
    const sidebarState = yield* state.getWorkspaceSidebarState();
    const summaries = snapshots.map(sessionNavigationSummary);

    return buildWorkspaceSessionNavigation(summaries, sidebarState.archivedGroupCollapsed, {
      pinned: {
        collapsed: sidebarState.pinnedGroupCollapsed,
        sizePx: sidebarState.pinnedGroupSizePx,
      },
      active: {
        collapsed: sidebarState.activeGroupCollapsed,
        sizePx: sidebarState.activeGroupSizePx,
      },
      archived: {
        collapsed: sidebarState.archivedGroupCollapsed,
        sizePx: sidebarState.archivedGroupSizePx,
      },
    });
  });
}

function sessionNavigationSummary(snapshot: StructuredSessionSnapshot): SessionNavigationSummary {
  const orchestratorTurns = snapshot.turns.filter((turn) => turn.threadId === null);
  const status = deriveSurfaceStatus(snapshot, snapshot.pi.sessionId);
  const latestTurn = orchestratorTurns.toSorted((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )[0];
  const counts = {
    turns: snapshot.turns.length,
    threads: snapshot.threads.length,
    commands: snapshot.commands.length,
    episodes: snapshot.episodes.length,
    workflows: snapshot.workflowRuns.length,
    artifacts: snapshot.artifacts.length,
    events: snapshot.events.length,
  };

  return {
    id: snapshot.session.id,
    title: snapshot.pi.title,
    preview: latestTurn?.requestSummary ?? "",
    createdAt: snapshot.pi.createdAt,
    updatedAt: snapshot.pi.updatedAt,
    messageCount: snapshot.pi.messageCount,
    status,
    isPinned: snapshot.session.pinnedAt !== null,
    pinnedAt: snapshot.session.pinnedAt,
    isArchived: snapshot.session.archivedAt !== null,
    archivedAt: snapshot.session.archivedAt,
    isUnread: snapshot.session.unreadAt !== null,
    unreadAt: snapshot.session.unreadAt,
    unreadReason: snapshot.session.unreadReason,
    lastReadAt: snapshot.session.lastReadAt,
    ...(snapshot.pi.provider ? { provider: snapshot.pi.provider } : {}),
    ...(snapshot.pi.model ? { modelId: snapshot.pi.model } : {}),
    ...(snapshot.pi.reasoningEffort ? { thinkingLevel: snapshot.pi.reasoningEffort } : {}),
    wait: snapshot.session.wait
      ? {
          ...(snapshot.session.wait.owner.kind === "thread"
            ? { threadId: snapshot.session.wait.owner.threadId }
            : {}),
          kind: snapshot.session.wait.kind,
          reason: snapshot.session.wait.reason,
          resumeWhen: snapshot.session.wait.resumeWhen,
          since: snapshot.session.wait.since,
        }
      : null,
    counts,
    threadIds: snapshot.threads.map((thread) => thread.id),
  };
}

function buildSurfaceTranscriptReadModel(
  state: StructuredSessionState["Service"],
  request: SurfaceTranscriptReadModelRequest,
): Effect.Effect<SurfaceTranscriptReadModel, StateContractError> {
  return Effect.gen(function* () {
    const snapshot = yield* getSnapshotForTarget(state, request.target);
    const activeTurnId =
      activeTurnForSurface(snapshot, request.target.surfacePiSessionId)?.id ?? null;
    const queuedCount = countQueuedMessages(snapshot, request.target.surfacePiSessionId);
    const draft = yield* state.getComposerDraft(request.target.surfacePiSessionId);
    const messages = transcriptMessages(snapshot, request);

    return {
      target: request.target,
      surfaceStatus: deriveSurfaceStatus(snapshot, request.target.surfacePiSessionId),
      promptLock: {
        activeTurnId: activeTurnId as TurnId | null,
        queuedCount,
      },
      composerDraft: {
        text: draft?.text ?? "",
        attachmentIds: (draft?.attachments ?? []).map((attachment) => attachment.id),
      },
      messages,
    };
  });
}

function buildSurfaceSummaryReadModel(
  state: StructuredSessionState["Service"],
  target: RuntimeSurfaceTarget,
): Effect.Effect<SurfaceSummaryReadModel, StateContractError> {
  return Effect.gen(function* () {
    const snapshot = yield* getSnapshotForTarget(state, target);
    const activeTurn = activeTurnForSurface(snapshot, target.surfacePiSessionId);
    const thread =
      "threadId" in target
        ? snapshot.threads.find((candidate) => candidate.id === target.threadId)
        : null;
    return {
      target,
      title: thread?.title ?? snapshot.pi.title,
      status: deriveSurfaceStatus(snapshot, target.surfacePiSessionId),
      activeTurnId: (activeTurn?.id as TurnId | undefined) ?? null,
      activeTurnStartedAt: (activeTurn?.startedAt as IsoDateTimeString | undefined) ?? null,
      queuedCount: countQueuedMessages(snapshot, target.surfacePiSessionId),
      model: snapshot.pi.model ?? "",
      provider: snapshot.pi.provider ?? "",
      reasoningEffort: snapshot.pi.reasoningEffort ?? "medium",
      agentProfileId: snapshot.pi.orchestratorAgentProfileId ?? "",
      loadedExtensionIds: snapshot.pi.loadedExtensionIds ?? [],
      availableExtensionIds: snapshot.pi.availableExtensionIds ?? [],
    };
  });
}

function buildSurfaceComposerReadModel(
  state: StructuredSessionState["Service"],
  target: RuntimeSurfaceTarget,
): Effect.Effect<SurfaceComposerReadModel, StateContractError> {
  return Effect.gen(function* () {
    const draft = yield* state.getComposerDraft(target.surfacePiSessionId);
    return {
      target,
      draft: {
        text: draft?.text ?? "",
        attachments: draft?.attachments ?? [],
        snippetMentions: draft?.snippetMentions ?? [],
        updatedAt: (draft?.updatedAt as IsoDateTimeString | undefined) ?? null,
      },
    };
  });
}

function buildSurfaceQueuedMessagesReadModel(
  state: StructuredSessionState["Service"],
  target: RuntimeSurfaceTarget,
): Effect.Effect<SurfaceQueuedMessagesReadModel, StateContractError> {
  return Effect.gen(function* () {
    const queuedMessages = yield* state.listQueuedSurfaceMessages({
      surfacePiSessionId: target.surfacePiSessionId,
    });
    return {
      target,
      queuedMessages: queuedMessages.map(surfaceQueuedMessageReadModel),
    };
  });
}

function buildCommandInspectorReadModel(
  state: StructuredSessionState["Service"],
  commandId: CommandId,
): Effect.Effect<CommandInspectorReadModel | null, StateContractError> {
  return Effect.gen(function* () {
    const snapshots = yield* state.listSessionStates();
    for (const snapshot of snapshots) {
      const inspector = buildStructuredCommandInspector(snapshot, commandId);
      if (!inspector) continue;
      const command = snapshot.commands.find((candidate) => candidate.id === inspector.commandId);
      return {
        commandId: inspector.commandId as CommandId,
        status: commandInspectorStatus(inspector.status),
        toolName: inspector.toolName,
        ...(command ? { target: commandTarget(snapshot, command) } : {}),
        ...(command?.arguments !== undefined
          ? { acceptedArguments: command.arguments as JsonValueType }
          : {}),
        ...(inspector.summary ? { summary: inspector.summary } : {}),
        ...(inspector.error ? { error: storedErrorFromMessage(inspector.error) } : {}),
        ...(inspector.finishedAt ? { finishedAt: inspector.finishedAt as IsoDateTimeString } : {}),
        output: inspector.outputEvents.map((event, index) => ({
          stream: event.stream,
          text: event.text,
          sequence: index as NonNegativeSafeInteger,
        })),
        stdin: {
          mode: inspector.stdin.mode,
          canAttemptWrite: inspector.stdin.canAttemptWrite,
          acceptedWrites: inspector.stdin.acceptedWrites.map((write) => ({
            text: write.text,
            acceptedBytes: write.acceptedBytes as ByteCount,
            at: write.at as IsoDateTimeString,
          })),
        },
        ...(inspector.facts ? { facts: inspector.facts as CommandFactsPayload } : {}),
        childCommandIds: [...inspector.summaryChildren, ...inspector.traceChildren].map(
          (child) => child.commandId as CommandId,
        ),
        artifactIds: inspector.artifacts.map((artifact) => artifact.artifactId as ArtifactId),
      };
    }
    return null;
  });
}

function buildRequestInputReadModel(
  state: StructuredSessionState["Service"],
  request: RequestInputReadModelRequest,
): Effect.Effect<RequestInputReadModel, StateContractError> {
  return state.listSessionStates().pipe(
    Effect.map((snapshots) => ({
      requests: snapshots
        .flatMap((snapshot) =>
          snapshot.requestUserInputRequests
            .filter(
              (record) =>
                (record.status === "open" || record.status === "completed") &&
                (!request.surfacePiSessionId ||
                  record.surfacePiSessionId === request.surfacePiSessionId) &&
                (!request.requestId || record.requestId === request.requestId),
            )
            .map((record) => requestInputReadModelItem(snapshot, record)),
        )
        .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)),
    })),
  );
}

function buildApprovalsReadModel(
  state: StructuredSessionState["Service"],
  request: ApprovalsReadModelRequest,
): Effect.Effect<ApprovalsReadModel, StateContractError> {
  return state.listSessionStates().pipe(
    Effect.map((snapshots) => ({
      requests: snapshots
        .flatMap((snapshot) =>
          (snapshot.runtimeApprovalRequests ?? [])
            .filter(
              (record) =>
                record.status === "pending" &&
                (!request.surfacePiSessionId ||
                  record.surfacePiSessionId === request.surfacePiSessionId) &&
                (!request.requestId || record.requestId === request.requestId),
            )
            .map((record) => approvalReadModelItem(snapshot, record)),
        )
        .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)),
    })),
  );
}

function refetchSurfaceInvalidation(
  state: StructuredSessionState["Service"],
  surfacePiSessionIds: readonly SurfacePiSessionId[],
): Effect.Effect<readonly StateReadModelResult[], StateContractError> {
  return Effect.gen(function* () {
    const snapshots = yield* state.listSessionStates();
    const results: StateReadModelResult[] = [];
    for (const surfacePiSessionId of surfacePiSessionIds) {
      const target = targetForSurface(snapshots, surfacePiSessionId);
      if (!target) continue;
      results.push(
        {
          kind: "surfaceTranscript",
          value: yield* buildSurfaceTranscriptReadModel(state, {
            kind: "surfaceTranscript",
            target,
          }),
        },
        { kind: "surfaceSummary", value: yield* buildSurfaceSummaryReadModel(state, target) },
        { kind: "surfaceComposer", value: yield* buildSurfaceComposerReadModel(state, target) },
        {
          kind: "surfaceQueuedMessages",
          value: yield* buildSurfaceQueuedMessagesReadModel(state, target),
        },
      );
    }
    return results;
  });
}

function getSnapshotForTarget(
  state: StructuredSessionState["Service"],
  target: RuntimeSurfaceTarget,
): Effect.Effect<StructuredSessionSnapshot, StateContractError> {
  return state.getSessionState(target.workspaceSessionId);
}

function deriveSurfaceStatus(
  snapshot: StructuredSessionSnapshot,
  surfacePiSessionId: string,
): SurfaceTranscriptReadModel["surfaceStatus"] {
  const turns = snapshot.turns.filter((turn) => turn.surfacePiSessionId === surfacePiSessionId);
  if (turns.some((turn) => turn.status === "failed")) return "error";
  if (turns.some((turn) => turn.status === "waiting")) return "waiting";
  if (turns.some((turn) => turn.status === "running")) return "running";
  return "idle";
}

function activeTurnForSurface(snapshot: StructuredSessionSnapshot, surfacePiSessionId: string) {
  return (
    snapshot.turns
      .filter(
        (turn) =>
          turn.surfacePiSessionId === surfacePiSessionId &&
          (turn.status === "running" || turn.status === "waiting"),
      )
      .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null
  );
}

function countQueuedMessages(
  snapshot: StructuredSessionSnapshot,
  surfacePiSessionId: string,
): number {
  return (
    snapshot.queuedMessages?.filter(
      (message) =>
        message.surfacePiSessionId === surfacePiSessionId &&
        (message.status === "queued" ||
          message.status === "steering" ||
          message.status === "dispatching"),
    ).length ?? 0
  );
}

function transcriptMessages(
  snapshot: StructuredSessionSnapshot,
  request: SurfaceTranscriptReadModelRequest,
): SurfaceTranscriptReadModel["messages"] {
  const messages = snapshot.turns
    .filter((turn) => turn.surfacePiSessionId === request.target.surfacePiSessionId)
    .map((turn) => ({
      messageId: turn.id as unknown as MessageId,
      role: "user" as const,
      turnId: turn.id as TurnId,
      text: turn.requestSummary,
      commandIds: snapshot.commands
        .filter((command) => command.turnId === turn.id)
        .map((command) => command.id as CommandId),
      createdAt: turn.startedAt as IsoDateTimeString,
    }));
  const afterIndex = request.afterMessageId
    ? messages.findIndex((message) => message.messageId === request.afterMessageId)
    : -1;
  const sliced = afterIndex >= 0 ? messages.slice(afterIndex + 1) : messages;
  return request.limit ? sliced.slice(-request.limit) : sliced;
}

function surfaceQueuedMessageReadModel(
  record: StructuredSurfaceQueuedMessageRecord,
): SurfaceQueuedMessagesReadModel["queuedMessages"][number] {
  const payload = parseJsonRecord(record.payloadJson);
  return {
    id: record.id as QueueItemId,
    kind: record.kind,
    text: queuedMessageText(record),
    ...(typeof payload.title === "string" ? { title: payload.title } : {}),
    ...(typeof payload.summary === "string" ? { summary: payload.summary } : {}),
    ...(record.threadId ? { threadId: record.threadId } : {}),
    ...(typeof payload.episodeId === "string" ? { episodeId: payload.episodeId } : {}),
    ...(record.sourceCommandId ? { sourceCommandId: record.sourceCommandId as CommandId } : {}),
    status: record.status as SurfaceQueuedMessagesReadModel["queuedMessages"][number]["status"],
    ...(record.failureError ? { failureError: record.failureError } : {}),
    createdAt: record.createdAt as IsoDateTimeString,
    updatedAt: record.updatedAt as IsoDateTimeString,
  };
}

function queuedMessageText(record: StructuredSurfaceQueuedMessageRecord): string {
  const payload = parseJsonRecord(record.payloadJson);
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.summary === "string") return payload.summary;
  const message = parseJsonRecord(record.messageJson);
  if (typeof message.text === "string") return message.text;
  if (message.message && typeof message.message === "object" && "text" in message.message) {
    const text = (message.message as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

function requestInputReadModelItem(
  snapshot: StructuredSessionSnapshot,
  record: StructuredSessionSnapshot["requestUserInputRequests"][number],
): RequestInputReadModelRequestItem {
  const thread = record.threadId
    ? snapshot.threads.find((candidate) => candidate.id === record.threadId)
    : null;
  return {
    requestId: record.requestId as RequestInputRequestId,
    workspaceSessionId: record.sessionId as WorkspaceSessionId,
    surfacePiSessionId: record.surfacePiSessionId as SurfacePiSessionId,
    threadId: record.threadId,
    ownerTitle: thread?.title ?? snapshot.pi.title,
    variant: record.variant,
    status: record.status,
    createdAt: record.createdAt as IsoDateTimeString,
    completedAt: (record.completedAt as IsoDateTimeString | null) ?? null,
    timeout: record.timeout as RuntimeRequestInputDetailsRecord["timeout"],
    questions: record.questions.map((question) => ({
      questionId: question.questionId as RequestInputQuestionId,
      ordinal: question.ordinal,
      title: question.title,
      question: question.question,
      defaultAnswer: structuredClone(question.defaultAnswer),
      choices: question.choices.map((choice) => ({
        optionId: choice.optionId as RequestInputOptionId,
        ordinal: choice.ordinal,
        label: choice.label,
        description: choice.description,
        recommended: choice.recommended,
      })),
      status: question.status,
    })),
  };
}

function approvalReadModelItem(
  snapshot: StructuredSessionSnapshot,
  record: StructuredRuntimeApprovalRequestRecord,
): ApprovalReadModelRequestItem {
  const thread = record.threadId
    ? snapshot.threads.find((candidate) => candidate.id === record.threadId)
    : null;
  return {
    requestId: record.requestId as RuntimeApprovalId,
    workspaceSessionId: record.sessionId as WorkspaceSessionId,
    surfacePiSessionId: record.surfacePiSessionId as SurfacePiSessionId,
    threadId: record.threadId,
    ownerTitle: thread?.title ?? snapshot.pi.title,
    toolName: record.toolName,
    approvalMode: record.approvalMode,
    cwd: record.cwd,
    command: record.command,
    commandFamily: record.commandFamily,
    snippetArtifactId: record.snippetArtifactId,
    status: record.status,
    createdAt: record.createdAt as IsoDateTimeString,
    completedAt: (record.completedAt as IsoDateTimeString | null) ?? null,
    summary:
      record.toolName === "exec_command" && record.command
        ? `Run command: ${record.command}`
        : record.toolName === "apply_patch"
          ? "Apply patch"
          : "Run TypeScript",
  };
}

function commandInspectorStatus(
  status: StructuredCommandRecord["status"],
): CommandInspectorReadModel["status"] {
  switch (status) {
    case "requested":
      return "pending";
    case "streaming":
      return "running";
    default:
      return status;
  }
}

function commandTarget(
  snapshot: StructuredSessionSnapshot,
  command: StructuredCommandRecord,
): RuntimeSurfaceTarget {
  if (command.workflowTaskAttemptId) {
    const attempt = snapshot.workflowTaskAttempts.find(
      (candidate) => candidate.id === command.workflowTaskAttemptId,
    );
    return {
      workspaceSessionId: snapshot.session.id as WorkspaceSessionId,
      surface: "workflow-task",
      surfacePiSessionId: command.surfacePiSessionId as SurfacePiSessionId,
      workflowTaskAttemptId: command.workflowTaskAttemptId as never,
      ...(attempt?.workflowRunId ? { workflowRunId: attempt.workflowRunId as never } : {}),
      threadId: (command.threadId ?? attempt?.threadId ?? "") as never,
    };
  }
  if (command.threadId) {
    return {
      workspaceSessionId: snapshot.session.id as WorkspaceSessionId,
      surface: "handler",
      surfacePiSessionId: command.surfacePiSessionId as SurfacePiSessionId,
      threadId: command.threadId as never,
    };
  }
  return {
    workspaceSessionId: snapshot.session.id as WorkspaceSessionId,
    surface: "orchestrator",
    surfacePiSessionId: (command.surfacePiSessionId ?? snapshot.pi.sessionId) as SurfacePiSessionId,
  };
}

function targetForSurface(
  snapshots: readonly StructuredSessionSnapshot[],
  surfacePiSessionId: SurfacePiSessionId,
): RuntimeSurfaceTarget | null {
  for (const snapshot of snapshots) {
    if (snapshot.pi.sessionId === surfacePiSessionId) {
      return {
        workspaceSessionId: snapshot.session.id as WorkspaceSessionId,
        surface: "orchestrator",
        surfacePiSessionId,
      };
    }
    const thread = snapshot.threads.find(
      (candidate) => candidate.surfacePiSessionId === surfacePiSessionId,
    );
    if (thread) {
      return {
        workspaceSessionId: snapshot.session.id as WorkspaceSessionId,
        surface: "handler",
        surfacePiSessionId,
        threadId: thread.id as never,
      };
    }
    const attempt = snapshot.workflowTaskAttempts.find(
      (candidate) => candidate.surfacePiSessionId === surfacePiSessionId,
    );
    if (attempt) {
      return {
        workspaceSessionId: snapshot.session.id as WorkspaceSessionId,
        surface: "workflow-task",
        surfacePiSessionId,
        workflowTaskAttemptId: attempt.id as never,
        workflowRunId: attempt.workflowRunId as never,
        threadId: attempt.threadId as never,
      };
    }
  }
  return null;
}

function storedErrorFromMessage(message: string): StateStoredError {
  return {
    errorTag: "CommandError",
    operation: "state.readModels.commandInspector",
    reason: "execution-failed",
    message,
  };
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stateCommandsFromState(state: {
  appLogs: AppLogStateResolver;
  structuredSession: StructuredSessionState["Service"];
}): StateCommands["Service"] {
  const receipts = new Map<string, StateMutationResult<StateCommandResult>>();

  const runCommand = <
    Input extends { clientSubmission: RuntimeClientSubmissionInput; readAt: IsoDateTimeString },
  >(
    input: Input,
    commit: () => Effect.Effect<AppLogSummary, StateContractError>,
  ) =>
    Effect.gen(function* () {
      const clientRequestId = input.clientSubmission.clientRequestId;
      if (clientRequestId) {
        const existing = receipts.get(clientRequestId);
        if (existing) return duplicateMutationResult(existing);
      }
      const summary = yield* commit();
      const value: StateCommandResult = {
        receipt: {
          clientRequestId: clientRequestId ?? null,
          outcome: "applied",
          committedAt: input.readAt as StateCommandReceipt["committedAt"],
          stateRevision: summary.latestSeq as StateRevision,
        },
      };
      const result = mutationResult(
        value,
        appLogReadStateInvalidations((input as { workspaceId?: WorkspaceIdType }).workspaceId),
      );
      if (clientRequestId) receipts.set(clientRequestId, result);
      return result;
    });

  return StateCommands.of({
    appLogs: {
      markRead: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeMarkAppLogReadInput(commandInput);
          const appLogs = yield* state.appLogs(decoded.workspaceId);
          return yield* runCommand(decoded, () => markAppLogEntriesRead(appLogs, decoded.entryIds));
        }),
      markVisibleRangeRead: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeMarkVisibleAppLogRangeReadInput(commandInput);
          const appLogs = yield* state.appLogs(decoded.workspaceId);
          return yield* runCommand(decoded, () =>
            markAppLogEntriesRead(appLogs, [
              decoded.newestVisibleEntryId,
              decoded.oldestVisibleEntryId,
            ]),
          );
        }),
      clearWorkspaceUnread: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeClearWorkspaceAppLogUnreadInput(commandInput);
          const appLogs = yield* state.appLogs(decoded.workspaceId);
          return yield* runCommand(decoded, () =>
            Effect.gen(function* () {
              const summary = yield* appLogs.summary();
              return yield* appLogs.markSeen(summary.latestSeq);
            }),
          );
        }),
    },
    appPreferences: {
      update: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeUpdateAppPreferencesInput(commandInput);
          const clientRequestId = decoded.clientSubmission?.clientRequestId;
          if (clientRequestId) {
            const existing = receipts.get(clientRequestId);
            if (existing) return duplicateMutationResult(existing);
          }
          const updatedAt = yield* state.structuredSession.getCurrentTimestamp();
          const updated = yield* state.structuredSession.updateAppPreferences({
            ...decoded.patch,
            updatedAt,
          });
          const value: StateCommandResult = {
            receipt: {
              clientRequestId: clientRequestId ?? null,
              outcome: "applied",
              committedAt: updated.updatedAt as StateCommandReceipt["committedAt"],
              stateRevision: updated.stateRevision,
            },
          };
          const result = mutationResult(value, appPreferencesStateInvalidations());
          if (clientRequestId) receipts.set(clientRequestId, result);
          return result;
        }),
    },
    providerAuth: {
      recordStatus: (commandInput) =>
        Effect.gen(function* () {
          const decoded = yield* decodeRecordProviderAuthStatusInput(commandInput);
          const clientRequestId = decoded.clientSubmission?.clientRequestId;
          if (clientRequestId) {
            const existing = receipts.get(clientRequestId);
            if (existing) return duplicateMutationResult(existing);
          }
          const record = yield* state.structuredSession.recordProviderAuthStatus({
            status: decoded.status,
            observedAt: decoded.observedAt,
            source: decoded.source,
          });
          const value: StateCommandResult = {
            receipt: {
              clientRequestId: clientRequestId ?? null,
              outcome: "applied",
              committedAt: decoded.observedAt as StateCommandReceipt["committedAt"],
              stateRevision: record.stateRevision,
            },
          };
          const result = mutationResult(value, providerAuthStateInvalidations(record.status));
          if (clientRequestId) receipts.set(clientRequestId, result);
          return result;
        }),
    },
  });
}

function markAppLogEntriesRead(
  appLogs: AppLogState["Service"],
  entryIds: readonly AppLogEntryId[],
): Effect.Effect<AppLogSummary, StateContractError> {
  if (entryIds.length === 0) return appLogs.summary();
  const maxSeq = entryIds.reduce((max, entryId) => Math.max(max, appLogEntrySeq(entryId)), 0);
  return appLogs.markSeen(maxSeq);
}

function appLogEntrySeq(entryId: AppLogEntryId): number {
  const match = /^app-log-(\d+)$/.exec(entryId);
  return match ? Number(match[1]) : 0;
}

function duplicateMutationResult(
  result: StateMutationResult<StateCommandResult>,
): StateMutationResult<StateCommandResult> {
  return mutationResult(
    {
      receipt: {
        ...result.value.receipt,
        outcome: "duplicate",
      },
    },
    [],
  );
}

function appLogReadStateInvalidations(
  workspaceId: WorkspaceIdType | undefined,
): readonly StateInvalidationDescriptor[] {
  return workspaceId
    ? [{ scope: "workspace", workspaceId, invalidation: { model: "appLogs" } }]
    : [{ scope: "app", invalidation: { model: "appLogs" } }];
}

function appPreferencesStateInvalidations(): readonly StateInvalidationDescriptor[] {
  return [
    { scope: "app", invalidation: { model: "appPreferences" } },
    { scope: "app", invalidation: { model: "settings" } },
  ];
}

function providerAuthStateInvalidations(
  status: ProviderAuthStatus,
): readonly StateInvalidationDescriptor[] {
  return [{ scope: "app", invalidation: { model: "providerAuth", ids: [status.providerId] } }];
}

function appPreferencesReadModel(record: StructuredAppPreferencesRecord): AppPreferencesReadModel {
  return {
    appearance: record.appearance,
    externalEditor: record.externalEditor,
    artifactDirectory: record.artifactDirectory,
    approvalMode: record.approvalMode,
    networkAccess: record.networkAccess,
    ambientResources: record.ambientResources,
    updatedAt: record.updatedAt as IsoDateTimeString,
    revision: record.stateRevision,
  };
}

function providerAuthReadModel(providers: readonly ProviderAuthStatus[]): ProviderAuthReadModel {
  return {
    providers,
    usableModelProviders: providers
      .filter((provider) => provider.health === "usable")
      .map((provider) => provider.providerId),
  };
}

function runStateFacadeEffect<A, E, R>(input: {
  managedRuntime: ManagedRuntime.ManagedRuntime<R, unknown>;
  operation: string;
  effect: Effect.Effect<A, E, R>;
  options: StateFacadeCallOptions | undefined;
  closed: boolean;
}): Promise<A> {
  if (input.closed) {
    return Promise.reject(
      new StateFacadeError({ type: "state-facade-error", reason: "disposed" }, input.operation),
    );
  }
  if (input.options?.signal?.aborted) {
    return Promise.reject(
      new StateFacadeError({ type: "state-facade-error", reason: "aborted" }, input.operation),
    );
  }

  return input.managedRuntime
    .runPromiseExit(input.effect, { signal: input.options?.signal })
    .then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      throw stateFacadeErrorFromCause(input.operation, exit.cause);
    });
}

function stateFacadeErrorFromCause(
  operation: string,
  cause: Cause.Cause<unknown>,
): StateFacadeError {
  const failure = cause.reasons.find(Cause.isFailReason);
  if (failure) {
    const value = failure.error;
    if (value instanceof StateFacadeError) return value;
    if (value instanceof StateContractError) {
      return new StateFacadeError(
        { type: "state-facade-error", reason: "typed-failure", error: value },
        operation,
      );
    }
    if (isPostCommitNotificationFailure(value)) {
      return new StateFacadeError(value.contract, operation);
    }
  }

  const defect = cause.reasons.find(Cause.isDieReason);
  if (defect) {
    const defectValue = defect.defect;
    return new StateFacadeError(
      {
        type: "state-facade-error",
        reason: "defect",
        message: defectMessage(defectValue),
        ...(defectValue instanceof Error ? { defectClass: defectValue.constructor.name } : {}),
      },
      operation,
    );
  }

  if (Cause.hasInterruptsOnly(cause) || cause.reasons.some(Cause.isInterruptReason)) {
    return new StateFacadeError({ type: "state-facade-error", reason: "interrupted" }, operation);
  }
  return new StateFacadeError(
    {
      type: "state-facade-error",
      reason: "defect",
      message: defectMessage(Cause.squash(cause)),
    },
    operation,
  );
}

function defectMessage(defect: unknown): string {
  if (defect instanceof Error && defect.message.trim().length > 0) return defect.message;
  if (typeof defect === "string" && defect.trim().length > 0) return defect;
  if (
    defect &&
    typeof defect === "object" &&
    "message" in defect &&
    typeof defect.message === "string" &&
    defect.message.trim().length > 0
  ) {
    return defect.message;
  }
  return "State facade defect.";
}

export class StateFacadeError extends Error {
  readonly name = "StateFacadeError";
  readonly type: StateFacadeErrorContract["type"];
  readonly reason: StateFacadeErrorContract["reason"];

  constructor(
    readonly contract: StateFacadeErrorContract,
    readonly operation: string,
  ) {
    super(stateFacadeErrorMessage(contract));
    this.type = contract.type;
    this.reason = contract.reason;
  }
}

function stateFacadeErrorMessage(contract: StateFacadeErrorContract): string {
  switch (contract.reason) {
    case "typed-failure":
      return contract.error.message;
    case "post-commit-notification-failed":
      return contract.message;
    case "defect":
      return contract.message;
    case "interrupted":
      return contract.interruptReason ?? "State facade operation was interrupted.";
    case "aborted":
      return "State facade operation was aborted.";
    case "disposed":
      return "State facade is closed.";
  }
}

class PostCommitNotificationFailure {
  constructor(readonly contract: StateFacadeErrorContract) {}
}

function isPostCommitNotificationFailure(value: unknown): value is PostCommitNotificationFailure {
  return value instanceof PostCommitNotificationFailure;
}

function postCommitNotificationError(
  operation: string,
  receipt: StateCommandReceipt,
  descriptors: readonly StateInvalidationDescriptor[],
  cause: Cause.Cause<unknown>,
): PostCommitNotificationFailure {
  const notificationError = stateCommandPostCommitNotificationError(
    operation,
    receipt,
    descriptors,
    Cause.squash(cause),
  );
  return new PostCommitNotificationFailure({
    type: "state-facade-error",
    reason: "post-commit-notification-failed",
    receipt,
    notificationError,
    message: `${operation} committed but state invalidation publication failed: ${notificationError.message}`,
  });
}

function stateCommandPostCommitNotificationError(
  operation: string,
  receipt: StateCommandReceipt,
  descriptors: readonly StateInvalidationDescriptor[],
  cause: unknown,
): StateCommandPostCommitNotificationError {
  if (
    cause &&
    typeof cause === "object" &&
    "type" in cause &&
    cause.type === "state-command-post-commit-notification-error" &&
    "reason" in cause &&
    (cause.reason === "publication-failed" ||
      cause.reason === "runtime-shutdown" ||
      cause.reason === "runtime-disposed") &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause as StateCommandPostCommitNotificationError;
  }
  return {
    type: "state-command-post-commit-notification-error",
    operation,
    reason: "publication-failed",
    receipt,
    message: defectMessage(cause),
    affectedReadModels: descriptors,
  };
}

const decodeMarkAppLogReadInput = (input: unknown) =>
  decodeUnknownMarkAppLogReadCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.appLogs.markRead")),
  );

const decodeMarkVisibleAppLogRangeReadInput = (input: unknown) =>
  decodeUnknownMarkVisibleAppLogRangeReadCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.appLogs.markVisibleRangeRead")),
  );

const decodeClearWorkspaceAppLogUnreadInput = (input: unknown) =>
  decodeUnknownClearWorkspaceAppLogUnreadCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.appLogs.clearWorkspaceUnread")),
  );

const decodeUpdateAppPreferencesInput = (input: unknown) =>
  decodeUnknownUpdateAppPreferencesCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.appPreferences.update")),
  );

const decodeRecordProviderAuthStatusInput = (input: unknown) =>
  decodeUnknownRecordProviderAuthStatusCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.providerAuth.recordStatus")),
  );

function commandDecodeError(operation: string) {
  return (cause: Schema.SchemaError) =>
    new StateContractError({
      operation,
      reason: "invalid-input",
      message: cause.message,
      cause,
    });
}
