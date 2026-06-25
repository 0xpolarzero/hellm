import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import {
  AppLogEntryId,
  AppLogQuerySchema,
  type IsoDateTimeString,
  IsoDateTimeStringSchema,
  type AppLogQuery,
  type AppLogReadModel,
  type AppLogSummary,
  type AppLogWritePort,
  type RuntimeClientSubmissionInput,
  RuntimeClientSubmissionInputSchema,
  type StateCommandReceipt,
  StateContractError,
  type StateFacadeErrorContract,
  type StateInvalidationDescriptor,
  type StateMutationResult,
  type StateRevision,
  strictBoundaryParseOptions,
  WorkspaceId,
  type WorkspaceId as WorkspaceIdType,
} from "@svvy/core";
import { AppLogState, type CreateAppLogStoreOptions, layerAppLogState } from "./app-log-store";
import { layerAppLogWritePort } from "./app-log-write-port";
import { mutationResult } from "./state-mutation-result";

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

export type StateReadModelRequest = AppLogReadModelRequest;

export type StateReadModelResult =
  | { kind: "appLogs"; value: AppLogReadModel }
  | { kind: "appLogSummary"; value: AppLogSummary };

export interface StateReadModelInvalidationRefetchRequest {
  descriptors: readonly StateInvalidationDescriptor[];
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

export interface MarkAppLogReadCommandInput {
  workspaceId?: WorkspaceIdType;
  entryIds: readonly AppLogEntryId[];
  readAt: IsoDateTimeString;
  clientSubmission: RuntimeClientSubmissionInput;
}

export interface MarkVisibleAppLogRangeReadCommandInput {
  workspaceId?: WorkspaceIdType;
  newestVisibleEntryId: AppLogEntryId;
  oldestVisibleEntryId: AppLogEntryId;
  readAt: IsoDateTimeString;
  filter?: AppLogQuery;
  clientSubmission: RuntimeClientSubmissionInput;
}

export interface ClearWorkspaceAppLogUnreadCommandInput {
  workspaceId?: WorkspaceIdType;
  readAt: IsoDateTimeString;
  clientSubmission: RuntimeClientSubmissionInput;
}

export interface StateCommandInvalidationSink {
  publishCommittedStateInvalidations(input: {
    source: "state-command-facade";
    descriptors: readonly StateInvalidationDescriptor[];
    clientSubmission?: RuntimeClientSubmissionInput;
  }): Promise<void>;
}

export interface CreateStateCommandsFacadeOptions {
  invalidationSink?: StateCommandInvalidationSink;
}

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

export interface StateCommandsService {
  appLogs: AppLogReadStateCommands;
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
  close(): void;
}

export interface StateLayerInput {
  appLogs?: CreateAppLogStoreOptions;
}

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
  managedRuntime: ManagedRuntime.ManagedRuntime<StateCommands, unknown>,
  options: CreateStateCommandsFacadeOptions = {},
): StateCommandsFacade {
  let closed = false;
  const run = <A, E>(
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
          yield* Effect.tryPromise({
            try: () =>
              options.invalidationSink?.publishCommittedStateInvalidations({
                source: "state-command-facade",
                descriptors: result.afterCommit,
                ...(clientSubmission ? { clientSubmission } : {}),
              }) ?? Promise.resolve(),
            catch: (cause) => postCommitNotificationError(operation, result.value, cause),
          });
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
    close: () => {
      closed = true;
    },
  };
}

const makeStateReadModels = Effect.fn("@svvy/state/makeStateReadModels")(function* () {
  const appLogs = yield* AppLogState;
  return stateReadModelsFromAppLogState(appLogs);
});

const layerStateReadModels = Layer.effect(StateReadModels, makeStateReadModels());

const makeStateCommands = Effect.fn("@svvy/state/makeStateCommands")(function* () {
  const appLogs = yield* AppLogState;
  return stateCommandsFromAppLogState(appLogs);
});

const layerStateCommands = Layer.effect(StateCommands, makeStateCommands());

export const layer = (
  input: StateLayerInput = {},
): Layer.Layer<StateReadModels | StateCommands | AppLogWritePort, StateContractError> =>
  Layer.mergeAll(layerStateReadModels, layerStateCommands, layerAppLogWritePort).pipe(
    Layer.provide(layerAppLogState(input.appLogs)),
  );

function stateReadModelsFromAppLogState(
  appLogs: AppLogState["Service"],
): StateReadModels["Service"] {
  return StateReadModels.of({
    fetch: (input) =>
      Effect.gen(function* () {
        switch (input.kind) {
          case "appLogs":
            return { kind: "appLogs", value: yield* appLogs.query(input.query) };
          case "appLogSummary":
            return { kind: "appLogSummary", value: yield* appLogs.summary() };
        }
      }),
    refetchInvalidation: (input) =>
      Effect.gen(function* () {
        const shouldFetchAppLogs = input.descriptors.some(
          (descriptor) =>
            descriptor.scope === "workspace" && descriptor.invalidation.model === "appLogs",
        );
        if (!shouldFetchAppLogs) return [];
        const value = yield* appLogs.query();
        return [{ kind: "appLogs", value }];
      }),
    rebaseline: () =>
      Effect.gen(function* () {
        const [logs, summary] = yield* Effect.all([appLogs.query(), appLogs.summary()]);
        return {
          app: [{ kind: "appLogSummary", value: summary }],
          workspaces: [{ kind: "appLogs", value: logs }],
          revision: summary.latestSeq as StateRevision,
        };
      }),
  });
}

function stateCommandsFromAppLogState(appLogs: AppLogState["Service"]): StateCommands["Service"] {
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
      markRead: (input) =>
        Effect.gen(function* () {
          const decoded = yield* decodeMarkAppLogReadInput(input);
          return yield* runCommand(decoded, () => markAppLogEntriesRead(appLogs, decoded.entryIds));
        }),
      markVisibleRangeRead: (input) =>
        Effect.gen(function* () {
          const decoded = yield* decodeMarkVisibleAppLogRangeReadInput(input);
          return yield* runCommand(decoded, () =>
            markAppLogEntriesRead(appLogs, [
              decoded.newestVisibleEntryId,
              decoded.oldestVisibleEntryId,
            ]),
          );
        }),
      clearWorkspaceUnread: (input) =>
        Effect.gen(function* () {
          const decoded = yield* decodeClearWorkspaceAppLogUnreadInput(input);
          return yield* runCommand(decoded, () =>
            Effect.gen(function* () {
              const summary = yield* appLogs.summary();
              return yield* appLogs.markSeen(summary.latestSeq);
            }),
          );
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
    : [];
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
  value: unknown,
  cause: unknown,
): PostCommitNotificationFailure {
  const receipt = (value as { receipt?: StateCommandReceipt }).receipt;
  return new PostCommitNotificationFailure({
    type: "state-facade-error",
    reason: "post-commit-notification-failed",
    receipt: receipt ?? {
      clientRequestId: null,
      outcome: "applied",
      committedAt: new Date(0).toISOString() as StateCommandReceipt["committedAt"],
      stateRevision: 0 as StateRevision,
    },
    message: `${operation} committed but state invalidation publication failed: ${describeCause(
      cause,
    )}`,
  });
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause) return cause;
  return "Unknown notification failure.";
}

const BaseAppLogReadCommandInputSchema = Schema.Struct({
  workspaceId: Schema.optionalKey(WorkspaceId),
  readAt: IsoDateTimeStringSchema,
  clientSubmission: RuntimeClientSubmissionInputSchema,
});

const MarkAppLogReadCommandInputSchema = Schema.Struct({
  ...BaseAppLogReadCommandInputSchema.fields,
  entryIds: Schema.Array(AppLogEntryId),
});

const MarkVisibleAppLogRangeReadCommandInputSchema = Schema.Struct({
  ...BaseAppLogReadCommandInputSchema.fields,
  newestVisibleEntryId: AppLogEntryId,
  oldestVisibleEntryId: AppLogEntryId,
  filter: Schema.optionalKey(AppLogQuerySchema),
});

const ClearWorkspaceAppLogUnreadCommandInputSchema = BaseAppLogReadCommandInputSchema;

const decodeMarkAppLogReadCommandInputEffect = Schema.decodeUnknownEffect(
  MarkAppLogReadCommandInputSchema,
  strictBoundaryParseOptions,
);
const decodeMarkVisibleAppLogRangeReadCommandInputEffect = Schema.decodeUnknownEffect(
  MarkVisibleAppLogRangeReadCommandInputSchema,
  strictBoundaryParseOptions,
);
const decodeClearWorkspaceAppLogUnreadCommandInputEffect = Schema.decodeUnknownEffect(
  ClearWorkspaceAppLogUnreadCommandInputSchema,
  strictBoundaryParseOptions,
);

const decodeMarkAppLogReadInput = (input: unknown) =>
  decodeMarkAppLogReadCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.appLogs.markRead")),
  );

const decodeMarkVisibleAppLogRangeReadInput = (input: unknown) =>
  decodeMarkVisibleAppLogRangeReadCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.appLogs.markVisibleRangeRead")),
  );

const decodeClearWorkspaceAppLogUnreadInput = (input: unknown) =>
  decodeClearWorkspaceAppLogUnreadCommandInputEffect(input).pipe(
    Effect.mapError(commandDecodeError("stateCommands.appLogs.clearWorkspaceUnread")),
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
