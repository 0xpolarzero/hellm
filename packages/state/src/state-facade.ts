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
  type PiSessionReferencePort,
  type ProviderAuthStatus,
  type ProviderAuthStatusStatePort,
  type ProviderId,
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
  type StateRevision,
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
import {
  createStructuredSessionStateStore,
  structuredSessionStateFromStore,
  StructuredSessionState,
  type StateDigestHelper,
  type StructuredAppPreferencesRecord,
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
  | ProviderAuthReadModelRequest;

export type StateReadModelResult =
  | { kind: "appLogs"; value: AppLogReadModel }
  | { kind: "appLogSummary"; value: AppLogSummary }
  | { kind: "appPreferences"; value: AppPreferencesReadModel }
  | { kind: "settings"; value: SettingsReadModel }
  | { kind: "providerAuth"; value: ProviderAuthReadModel };

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
  return stateReadModelsFromState({ appLogs: appLogStateResolver(appLogs), structuredSession });
});

export function stateReadModelsFromRouter(input: {
  router: WorkspaceStateRouter;
  appLogs: AppLogState["Service"];
  resolveAppLogs?: AppLogStateResolver;
}): StateReadModels["Service"] {
  return stateReadModelsFromState({
    appLogs: input.resolveAppLogs ?? appLogStateResolver(input.appLogs),
    structuredSession: input.router.appGlobalStructuredSession,
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

function appLogStateResolver(appLogs: AppLogState["Service"]): AppLogStateResolver {
  return () => Effect.succeed(appLogs);
}

function stateReadModelsFromState(state: {
  appLogs: AppLogStateResolver;
  structuredSession: StructuredSessionState["Service"];
}): StateReadModels["Service"] {
  return StateReadModels.of({
    fetch: (request) =>
      Effect.gen(function* () {
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
            const record = yield* state.structuredSession.readAppPreferences();
            const preferences = appPreferencesReadModel(record);
            return { kind: "appPreferences", value: preferences };
          }
          case "settings": {
            const record = yield* state.structuredSession.readAppPreferences();
            const preferences = appPreferencesReadModel(record);
            return { kind: "settings", value: { preferences } };
          }
          case "providerAuth": {
            const providers = yield* state.structuredSession.listProviderAuthStatuses(
              request.workspaceId ? { workspaceId: request.workspaceId } : {},
            );
            return { kind: "providerAuth", value: providerAuthReadModel(providers) };
          }
        }
      }),
    refetchInvalidation: (request) =>
      Effect.gen(function* () {
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
            const record = yield* state.structuredSession.readAppPreferences();
            const preferences = appPreferencesReadModel(record);
            return [{ kind: "appPreferences", value: preferences }];
          }
          case "settings": {
            const record = yield* state.structuredSession.readAppPreferences();
            const preferences = appPreferencesReadModel(record);
            return [{ kind: "settings", value: { preferences } }];
          }
          case "providerAuth": {
            const providers = yield* state.structuredSession.listProviderAuthStatuses(
              request.descriptor.scope === "workspace"
                ? { workspaceId: request.descriptor.workspaceId }
                : {},
            );
            return [{ kind: "providerAuth", value: providerAuthReadModel(providers) }];
          }
          default:
            return [];
        }
      }),
    rebaseline: (request) =>
      Effect.gen(function* () {
        const appLogs = yield* state.appLogs(request.workspaceId);
        const [logs, summary, currentStateRevision] = yield* Effect.all([
          appLogs.query(),
          appLogs.summary(),
          state.structuredSession.readCurrentStateRevision(),
        ]);
        const record = yield* state.structuredSession.readAppPreferences();
        const preferences = appPreferencesReadModel(record);
        return {
          app: [
            { kind: "appLogSummary", value: summary },
            { kind: "appPreferences", value: preferences },
            { kind: "settings", value: { preferences } },
            {
              kind: "providerAuth",
              value: providerAuthReadModel(
                yield* state.structuredSession.listProviderAuthStatuses({}),
              ),
            },
          ],
          workspaces: [{ kind: "appLogs", value: logs }],
          revision: Math.max(summary.latestSeq, currentStateRevision) as StateRevision,
        };
      }),
  });
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
