import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  CommittedUserMessageEditQueuePayloadSchema,
  RuntimeActorExtensionBindingStatePort,
  RuntimeCommandStatePort,
  RuntimeEpisodeStatePort,
  RuntimeContractError,
  RuntimeQueueStatePort,
  RuntimeRequestStatePort,
  RuntimeThreadStatePort,
  RuntimeTurnStatePort,
  type PromptTarget,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimeEpisodeStatePortService,
  type RuntimePromptBindingRecord,
  type RuntimeQueueStatePortService,
  type RuntimeRequestStatePortService,
  type RuntimeSurfaceMessageRecord,
  type RuntimeSurfaceTarget,
  type RuntimeSubmittedMessage,
  type RuntimeTurnRecord,
  type RuntimeCommandStatePortService,
  type RuntimeThreadStatePortService,
  type RuntimeTurnStatePortService,
  type StartRuntimeTurnInput,
  type WorkspaceId,
} from "@svvy/core";
import { Extensions } from "@svvy/extensions";
import { RuntimeLayerConfigService } from "./runtime-layer-config";
import { RuntimeGeneratedContextBindingService } from "./runtime-generated-context-binding-service";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";
import { RuntimePromptDefaultsService } from "./runtime-prompt-defaults-service";
import {
  createRuntimeSurfaceQueueDispatcher,
  type SurfaceQueuePreparedTurn,
  type SurfaceQueueStartedPrompt,
} from "./surface-queue-dispatcher";
import {
  actorBindingFromRuntimePromptBinding,
  actorKindForRuntimeSurfaceTarget,
  buildRuntimePiTurnInput,
  buildRuntimePromptExecutionContext,
  buildRuntimeToolExecutor,
  parseRuntimeSubmittedMessage,
  RuntimePromptExecutionService,
  type RuntimePromptExecutionResult,
} from "./runtime-prompt-execution-service";
import {
  RuntimeSurfaceRuntimeService,
  RuntimeSurfaceScopeService,
  type RuntimeSurfaceRuntimeServiceService,
} from "./surface-runtime-scope-service";
import { RuntimeEventBus } from "./runtime-event-bus";
import {
  RuntimeAcceptedNativeToolExecution,
  type RuntimeAcceptedNativeToolExecutionService,
} from "./accepted-native-tool-execution-service";
import { RuntimeShutdownAdmission } from "./runtime-shutdown-admission";

const decodeCommittedUserMessageEditQueuePayload = Schema.decodeUnknownEffect(
  CommittedUserMessageEditQueuePayloadSchema,
);

export interface RuntimeSurfaceQueueDispatcherServiceService {
  acceptWakeHint(input: {
    readonly workspaceId: WorkspaceId;
    readonly target: PromptTarget;
    readonly reason: string;
  }): Effect.Effect<void, RuntimeContractError>;
  drain(input: {
    readonly workspaceId: WorkspaceId;
    readonly target: RuntimeSurfaceTarget;
    readonly awaitPrompt?: boolean;
  }): Effect.Effect<boolean, RuntimeContractError>;
  drainForQueueItem(input: {
    readonly workspaceId: WorkspaceId;
    readonly target: RuntimeSurfaceTarget;
    readonly queueItemId: string;
  }): Effect.Effect<RuntimePromptExecutionResult, RuntimeContractError>;
}

export class RuntimeSurfaceQueueDispatcherService extends Context.Service<
  RuntimeSurfaceQueueDispatcherService,
  RuntimeSurfaceQueueDispatcherServiceService
>()("@svvy/runtime/RuntimeSurfaceQueueDispatcherService") {}

type PreparedRuntimePrompt = {
  readonly binding: RuntimePromptBindingRecord;
  readonly message: RuntimeSubmittedMessage;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly tools: ReturnType<typeof buildRuntimePiTurnInput>["tools"];
  readonly actorBinding: ReturnType<typeof actorBindingFromRuntimePromptBinding>;
};

type RuntimeQueueDrainState = {
  rerunRequested: boolean;
};

export function createRuntimeQueueDrainWakeCoordinator<TInput>(input: {
  readonly key: (request: TInput) => string;
  readonly isClosed: () => boolean;
  readonly drain: (request: TInput) => Effect.Effect<boolean, RuntimeContractError>;
}): {
  readonly acceptWakeHint: (request: TInput) => Effect.Effect<void>;
} {
  const runningDrains = new Map<string, RuntimeQueueDrainState>();

  return {
    acceptWakeHint: (request) =>
      Effect.gen(function* () {
        const key = input.key(request);
        const state = yield* Effect.sync(() => {
          const running = runningDrains.get(key);
          if (running) {
            running.rerunRequested = true;
            return null;
          }
          const started: RuntimeQueueDrainState = { rerunRequested: false };
          runningDrains.set(key, started);
          return started;
        });
        if (!state) {
          return;
        }

        yield* Effect.gen(function* () {
          while (!input.isClosed()) {
            state.rerunRequested = false;
            let keepGoing = true;
            while (keepGoing && !input.isClosed()) {
              keepGoing = yield* input
                .drain(request)
                .pipe(Effect.catch(() => Effect.succeed(false)));
            }
            const shouldRerun = yield* Effect.sync(() => {
              if (state.rerunRequested && !input.isClosed()) {
                return true;
              }
              if (runningDrains.get(key) === state) {
                runningDrains.delete(key);
              }
              return false;
            });
            if (!shouldRerun) {
              return;
            }
          }
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (runningDrains.get(key) === state) {
                runningDrains.delete(key);
              }
            }),
          ),
          Effect.forkDetach,
        );
      }),
  };
}

export const layerRuntimeSurfaceQueueDispatcherService = Layer.effect(
  RuntimeSurfaceQueueDispatcherService,
  Effect.gen(function* () {
    const config = yield* RuntimeLayerConfigService;
    const surfaceScopes = yield* RuntimeSurfaceScopeService;
    const promptDefaults = yield* RuntimePromptDefaultsService;
    const promptExecution = yield* RuntimePromptExecutionService;
    const actorBindingState = yield* RuntimeActorExtensionBindingStatePort;
    const generatedContextBinding = yield* RuntimeGeneratedContextBindingService;
    const extensions = yield* Extensions;
    const queueState = yield* RuntimeQueueStatePort;
    const requestState = yield* RuntimeRequestStatePort;
    const episodeState = yield* RuntimeEpisodeStatePort;
    const threadState = yield* RuntimeThreadStatePort;
    const turnState = yield* RuntimeTurnStatePort;
    const commandState = yield* RuntimeCommandStatePort;
    const eventBus = yield* RuntimeEventBus;
    const sourceInvalidation = yield* RuntimeSourceInvalidationService;
    const acceptedNativeTools = yield* RuntimeAcceptedNativeToolExecution;
    const shutdownAdmission = yield* RuntimeShutdownAdmission;
    const completedPromptResults = new Map<string, RuntimePromptExecutionResult>();
    const requestedPromptResults = new Set<string>();

    const dispatcherForWorkspace = (workspaceId: WorkspaceId) =>
      createRuntimeSurfaceQueueDispatcher<
        RuntimeSurfaceTarget,
        RuntimeSurfaceRuntimeServiceService,
        RuntimeSubmittedMessage,
        RuntimePromptBindingRecord,
        PreparedRuntimePrompt
      >({
        workspaceId,
        queueClaimLeaseMs: config.queueClaimLeaseMs,
        host: {
          isClosed: shutdownAdmission.isShutdownStarted,
          withQueueClaimAdmission: (effect) =>
            shutdownAdmission.withAdmission("runtime.queue.dispatch.claimNext", effect),
          resolveTarget: (target) => target,
          retainSurface: (target) =>
            surfaceScopes.retainOpen({
              workspaceId,
              target,
            }),
          acquirePromptLock: ({ surface }) =>
            typeof surface.acquirePromptLock === "function"
              ? surface.acquirePromptLock()
              : Effect.succeed(Effect.void),
          releaseSurface: ({ surface }) =>
            surfaceScopes.release({ surfacePiSessionId: surface.surfacePiSessionId }),
          isSurfaceActive: ({ surface }) => surface.isPromptActive(),
          activePromptDone: ({ surface }) => surface.activePromptDone(),
          continueAfterActivePrompt: () => true,
          refreshBeforeDispatch: ({ target, surface }) =>
            refreshBeforeDispatch({
              target,
              surface,
              generatedContextBinding,
              workspaceId,
            }),
          materializeQueuedMessage: ({ queued, surface }) =>
            reconcileCommittedEditIntent({ queued, surface }).pipe(
              Effect.as({
                kind: "dispatch" as const,
                message: parseRuntimeSubmittedMessage(queued),
              }),
            ),
          prepareTurn: ({ target, queued, message, metadata }) =>
            prepareRuntimePromptTurn({
              workspaceId,
              target,
              queued,
              message,
              binding: metadata,
              promptDefaults,
              actorBindingState,
              extensions,
              requestState,
            }),
          startPrompt: ({ target, surface, queued, turn, prepared }) =>
            startRuntimePrompt({
              workspaceId,
              target,
              surface,
              queued,
              turn,
              prepared,
              promptExecution,
              extensions,
              commandState,
              requestState,
              actorBindingState,
              episodeState,
              threadState,
              queueState,
              turnState,
              eventBus,
              sourceInvalidation,
              acceptedNativeTools,
              completedPromptResults,
              requestedPromptResults,
            }),
          notifyQueueUpdated: () => undefined,
        },
      });

    const drain = (input: {
      readonly workspaceId: WorkspaceId;
      readonly target: RuntimeSurfaceTarget;
      readonly awaitPrompt?: boolean;
    }) =>
      shutdownAdmission.assertAccepting("runtime.queue.dispatch.drain").pipe(
        Effect.andThen(
          dispatcherForWorkspace(input.workspaceId)
            .drainNextQueuedSurfaceMessage(input.target, {
              awaitPrompt: input.awaitPrompt ?? false,
            })
            .pipe(
              Effect.provideService(RuntimeQueueStatePort, queueState),
              Effect.provideService(RuntimeTurnStatePort, turnState),
            ),
        ),
      );

    const wakeCoordinator = createRuntimeQueueDrainWakeCoordinator<{
      readonly workspaceId: WorkspaceId;
      readonly target: PromptTarget;
      readonly reason: string;
    }>({
      key: (input) => `${input.workspaceId}:${input.target.surfacePiSessionId}`,
      isClosed: shutdownAdmission.isShutdownStarted,
      drain: (input) => drain({ ...input, awaitPrompt: true }),
    });

    return RuntimeSurfaceQueueDispatcherService.of({
      acceptWakeHint: (input) =>
        shutdownAdmission
          .assertAccepting("runtime.queue.dispatch.acceptWakeHint")
          .pipe(Effect.andThen(wakeCoordinator.acceptWakeHint(input))),
      drain,
      drainForQueueItem: (input) =>
        Effect.sync(() => {
          requestedPromptResults.add(input.queueItemId);
        }).pipe(
          Effect.andThen(
            Effect.gen(function* () {
              yield* drain({
                workspaceId: input.workspaceId,
                target: input.target,
                awaitPrompt: true,
              });
              const result = completedPromptResults.get(input.queueItemId);
              if (!result) {
                return yield* Effect.fail(
                  new RuntimeContractError({
                    operation: "runtime.queue.dispatch.drainForQueueItem",
                    reason: "target-not-ready",
                    message: `Queued prompt ${input.queueItemId} did not produce a prompt result.`,
                  }),
                );
              }
              return result;
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              requestedPromptResults.delete(input.queueItemId);
              completedPromptResults.delete(input.queueItemId);
            }),
          ),
        ),
    });
  }),
);

function refreshBeforeDispatch(input: {
  readonly workspaceId: WorkspaceId;
  readonly target: RuntimeSurfaceTarget;
  readonly surface: RuntimeSurfaceRuntimeServiceService;
  readonly generatedContextBinding: RuntimeGeneratedContextBindingService["Service"];
}): Effect.Effect<RuntimeSurfaceRuntimeServiceService, RuntimeContractError> {
  return Effect.gen(function* () {
    yield* input.generatedContextBinding.refresh({
      workspaceId: input.workspaceId,
      target: input.target,
    });
    return input.surface;
  });
}

function prepareRuntimePromptTurn(input: {
  readonly workspaceId: WorkspaceId;
  readonly target: RuntimeSurfaceTarget;
  readonly queued: RuntimeSurfaceMessageRecord;
  readonly message: RuntimeSubmittedMessage;
  readonly binding: RuntimePromptBindingRecord | undefined;
  readonly promptDefaults: RuntimePromptDefaultsService["Service"];
  readonly actorBindingState: RuntimeActorExtensionBindingStatePortService;
  readonly extensions: Extensions["Service"];
  readonly requestState: RuntimeRequestStatePortService;
}): Effect.Effect<SurfaceQueuePreparedTurn<PreparedRuntimePrompt>, RuntimeContractError> {
  return Effect.gen(function* () {
    const binding =
      input.binding ??
      (yield* input.actorBindingState
        .readRuntimePromptBinding({ target: input.target as PromptTarget })
        .pipe(
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation: "runtime.queue.dispatch.readPromptBinding",
                reason: cause.reason === "not-found" ? "target-not-found" : "state-conflict",
                message: cause.message,
                cause,
              }),
          ),
        ));
    const defaults = yield* input.promptDefaults.resolve({ target: input.target as PromptTarget });
    const actorBinding = actorBindingFromRuntimePromptBinding(input.target, binding);
    const requestInputSettings = yield* input.requestState.readRequestInputSettings().pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation: "runtime.queue.dispatch.readRequestInputSettings",
            reason: "state-conflict",
            message: cause.message,
            cause,
          }),
      ),
    );
    const tools = yield* input.extensions.nativeTools
      .declarations({
        actorKind: actorKindForRuntimeSurfaceTarget(input.target),
        actorBinding,
        requestInputVariant: requestInputSettings.mode,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new RuntimeContractError({
              operation: "runtime.queue.dispatch.nativeToolDeclarations",
              reason: "target-not-ready",
              message: cause.message,
              cause,
            }),
        ),
      );
    const startTurnInput: StartRuntimeTurnInput = {
      sessionId: input.queued.sessionId,
      surfacePiSessionId: input.queued.surfacePiSessionId,
      threadId: input.queued.threadId,
      requestSummary: input.message.text.slice(0, 240),
    };
    return {
      startTurnInput,
      prepared: {
        binding,
        message: input.message,
        provider: defaults.provider,
        model: defaults.model,
        reasoningEffort: defaults.reasoningEffort,
        tools,
        actorBinding,
      },
    };
  });
}

function startRuntimePrompt(input: {
  readonly workspaceId: WorkspaceId;
  readonly target: RuntimeSurfaceTarget;
  readonly surface: RuntimeSurfaceRuntimeServiceService;
  readonly queued: RuntimeSurfaceMessageRecord;
  readonly turn: RuntimeTurnRecord;
  readonly prepared: PreparedRuntimePrompt;
  readonly promptExecution: RuntimePromptExecutionService["Service"];
  readonly extensions: Extensions["Service"];
  readonly commandState: RuntimeCommandStatePortService;
  readonly requestState: RuntimeRequestStatePortService;
  readonly actorBindingState: RuntimeActorExtensionBindingStatePortService;
  readonly episodeState: RuntimeEpisodeStatePortService;
  readonly threadState: RuntimeThreadStatePortService;
  readonly queueState: RuntimeQueueStatePortService;
  readonly turnState: RuntimeTurnStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly sourceInvalidation: RuntimeSourceInvalidationService["Service"];
  readonly acceptedNativeTools: Pick<
    RuntimeAcceptedNativeToolExecutionService,
    "runRequestUserInput"
  >;
  readonly completedPromptResults: Map<string, RuntimePromptExecutionResult>;
  readonly requestedPromptResults: Set<string>;
}): Effect.Effect<SurfaceQueueStartedPrompt, RuntimeContractError> {
  return Effect.gen(function* () {
    const promptContext = buildRuntimePromptExecutionContext({
      target: input.target,
      turn: input.turn,
      binding: input.prepared.binding,
      claimedMessage: input.queued,
    });
    if (input.target.surface === "orchestrator") {
      const queued = yield* input.turnState
        .queueTopLevelTitleGeneration({
          sessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation: "runtime.queue.dispatch.queueTitleGeneration",
                reason: cause.reason === "not-found" ? "target-not-found" : "state-conflict",
                message: cause.message,
                cause,
              }),
          ),
        );
      if (queued.afterCommit.length > 0) {
        yield* input.eventBus.publishStateInvalidations({ afterCommit: queued.afterCommit }).pipe(
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation: "runtime.queue.dispatch.queueTitleGeneration",
                reason: "state-conflict",
                message: "Runtime event bus did not accept title generation notifications.",
                cause,
              }),
          ),
        );
      }
    }
    const piTurnInput = buildRuntimePiTurnInput({
      target: input.target,
      turn: input.turn,
      binding: input.prepared.binding,
      claimedMessage: input.queued,
      message: input.prepared.message,
      provider: input.prepared.provider,
      model: input.prepared.model,
      reasoningEffort: input.prepared.reasoningEffort,
      tools: input.prepared.tools,
      toolExecutor: buildRuntimeToolExecutor({
        acceptedNativeTools: input.acceptedNativeTools,
        extensions: input.extensions,
        target: input.target,
        actorBinding: input.prepared.actorBinding,
        promptContext,
        commandState: input.commandState,
        requestState: input.requestState,
        actorBindingState: input.actorBindingState,
        episodeState: input.episodeState,
        threadState: input.threadState,
        queueState: input.queueState,
        eventBus: input.eventBus,
        sourceInvalidation: input.sourceInvalidation,
      }),
    });
    const execute = input.promptExecution
      .executeClaimedPrompt({
        workspaceId: input.workspaceId,
        target: input.target,
        claimedMessage: input.queued,
        turn: input.turn,
        promptContext,
        piTurnInput,
      })
      .pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (input.requestedPromptResults.has(input.queued.id)) {
              input.completedPromptResults.set(input.queued.id, result);
            }
          }),
        ),
      )
      .pipe(Effect.provideService(RuntimeSurfaceRuntimeService, input.surface))
      .pipe(Effect.asVoid)
      .pipe(Effect.ensuring(input.surface.clearActivePrompt({ turnId: input.turn.id })));
    const startGate = yield* Deferred.make<void>();
    const fiber = yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const started = yield* restore(
          Deferred.await(startGate).pipe(Effect.andThen(execute)),
        ).pipe(Effect.forkDetach);
        yield* input.surface.installActivePrompt({ turnId: input.turn.id, fiber: started });
        yield* Deferred.succeed(startGate, undefined);
        return started;
      }),
    );
    return {
      promptDone: Fiber.join(fiber),
      continueAfterPrompt: () => true,
    };
  });
}

function reconcileCommittedEditIntent(input: {
  readonly queued: RuntimeSurfaceMessageRecord;
  readonly surface: RuntimeSurfaceRuntimeServiceService;
}): Effect.Effect<void, RuntimeContractError> {
  if (!input.queued.payloadJson) return Effect.void;
  return Effect.try({
    try: () => JSON.parse(input.queued.payloadJson as string) as unknown,
    catch: (cause) =>
      new RuntimeContractError({
        operation: "runtime.queue.dispatch.reconcileCommittedEdit",
        reason: "invalid-input",
        message: "Queued committed-message edit intent is invalid JSON.",
        cause,
      }),
  }).pipe(
    Effect.flatMap((payload) => {
      if (
        !payload ||
        typeof payload !== "object" ||
        (payload as { source?: unknown }).source !== "committed-user-message-edit"
      ) {
        return Effect.void;
      }
      return decodeCommittedUserMessageEditQueuePayload(payload).pipe(
        Effect.mapError(
          (cause) =>
            new RuntimeContractError({
              operation: "runtime.queue.dispatch.reconcileCommittedEdit",
              reason: "invalid-input",
              message: "Queued committed-message edit intent does not match its durable schema.",
              cause,
            }),
        ),
        Effect.flatMap((intent) =>
          input.surface.restorePiHistory({ entryId: intent.sourcePiHistoryEntry }),
        ),
      );
    }),
  );
}
