import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
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
import { RuntimeGeneratedContextRefreshService } from "./runtime-generated-context-refresh-service";
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

export const layerRuntimeSurfaceQueueDispatcherService = Layer.effect(
  RuntimeSurfaceQueueDispatcherService,
  Effect.gen(function* () {
    const config = yield* RuntimeLayerConfigService;
    const surfaceScopes = yield* RuntimeSurfaceScopeService;
    const promptDefaults = yield* RuntimePromptDefaultsService;
    const promptExecution = yield* RuntimePromptExecutionService;
    const actorBindingState = yield* RuntimeActorExtensionBindingStatePort;
    const generatedContextRefresh = yield* RuntimeGeneratedContextRefreshService;
    const extensions = yield* Extensions;
    const queueState = yield* RuntimeQueueStatePort;
    const requestState = yield* RuntimeRequestStatePort;
    const episodeState = yield* RuntimeEpisodeStatePort;
    const threadState = yield* RuntimeThreadStatePort;
    const turnState = yield* RuntimeTurnStatePort;
    const commandState = yield* RuntimeCommandStatePort;
    const eventBus = yield* RuntimeEventBus;
    const sourceInvalidation = yield* RuntimeSourceInvalidationService;
    const runningDrains = new Map<string, unknown>();
    const completedPromptResults = new Map<string, RuntimePromptExecutionResult>();

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
          isClosed: () => false,
          resolveTarget: (target) => target,
          retainSurface: (target) =>
            surfaceScopes.retainOpen({
              workspaceId,
              target,
            }),
          releaseSurface: ({ surface }) =>
            surfaceScopes.release({ surfacePiSessionId: surface.surfacePiSessionId }),
          isSurfaceActive: ({ surface }) => surface.isPromptActive(),
          activePromptDone: ({ surface }) => surface.activePromptDone(),
          continueAfterActivePrompt: () => true,
          refreshBeforeDispatch: ({ target, surface }) =>
            refreshBeforeDispatch({
              target,
              surface,
              actorBindingState,
              generatedContextRefresh,
            }),
          materializeQueuedMessage: ({ queued }) =>
            ({
              kind: "dispatch",
              message: parseRuntimeSubmittedMessage(queued),
            }) as const,
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
              completedPromptResults,
            }),
          notifyQueueUpdated: () => undefined,
        },
      });

    const drain = (input: {
      readonly workspaceId: WorkspaceId;
      readonly target: RuntimeSurfaceTarget;
      readonly awaitPrompt?: boolean;
    }) =>
      dispatcherForWorkspace(input.workspaceId)
        .drainNextQueuedSurfaceMessage(input.target, { awaitPrompt: input.awaitPrompt ?? false })
        .pipe(
          Effect.provideService(RuntimeQueueStatePort, queueState),
          Effect.provideService(RuntimeTurnStatePort, turnState),
        );

    return RuntimeSurfaceQueueDispatcherService.of({
      acceptWakeHint: (input) =>
        Effect.gen(function* () {
          const key = `${input.workspaceId}:${input.target.surfacePiSessionId}`;
          if (runningDrains.has(key)) return;
          const fiber = yield* Effect.gen(function* () {
            let keepGoing = true;
            while (keepGoing) {
              keepGoing = yield* drain({ ...input, awaitPrompt: true });
            }
          }).pipe(
            Effect.ensuring(Effect.sync(() => runningDrains.delete(key))),
            Effect.catch(() => Effect.void),
            Effect.forkDetach,
          );
          runningDrains.set(key, fiber);
        }),
      drain,
      drainForQueueItem: (input) =>
        Effect.gen(function* () {
          yield* drain({ workspaceId: input.workspaceId, target: input.target, awaitPrompt: true });
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
    });
  }),
);

function refreshBeforeDispatch(input: {
  readonly target: RuntimeSurfaceTarget;
  readonly surface: RuntimeSurfaceRuntimeServiceService;
  readonly actorBindingState: RuntimeActorExtensionBindingStatePortService;
  readonly generatedContextRefresh: RuntimeGeneratedContextRefreshService["Service"];
}): Effect.Effect<RuntimeSurfaceRuntimeServiceService, RuntimeContractError> {
  return Effect.gen(function* () {
    const binding = yield* input.actorBindingState
      .readRuntimePromptBinding({ target: input.target })
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
      );
    if (binding.updateExtensionContextBeforeNextTurn) {
      yield* input.generatedContextRefresh.refresh({
        scope: "target",
        target: input.target,
        reason: "profile-settings-changed",
      });
    }
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
    const tools = yield* input.extensions.nativeTools
      .declarations({
        actorKind: actorKindForRuntimeSurfaceTarget(input.target),
        actorBinding,
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
  readonly completedPromptResults: Map<string, RuntimePromptExecutionResult>;
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
    const done = input.surface
      .withPromptLock(
        input.promptExecution
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
                input.completedPromptResults.set(input.queued.id, result);
              }),
            ),
          )
          .pipe(Effect.provideService(RuntimeSurfaceRuntimeService, input.surface)),
      )
      .pipe(Effect.ensuring(input.surface.clearActivePrompt({ turnId: input.turn.id })));
    yield* input.surface.installActivePrompt({ turnId: input.turn.id, done });
    return {
      promptDone: done,
      continueAfterPrompt: () => true,
    };
  });
}
