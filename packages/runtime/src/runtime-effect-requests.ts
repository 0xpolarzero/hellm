import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  boundarySchemaErrorDetails,
  decodeUnknownExtensionExecutionPlanEffect,
  decodeUnknownRuntimeEffectRequestEffect,
  RuntimeActorExtensionBindingStatePort,
  RuntimeContractError,
  RuntimeEpisodeStatePort,
  RuntimeQueueStatePort,
  RuntimeRequestStatePort,
  RuntimeThreadStatePort,
  type CreateRuntimeRequestInputInput,
  type GeneratedPackagesRefreshResult,
  type InsertQueueItemRequest,
  type PromptTarget,
  type RequestInputSettings,
  type QueueItemId,
  type RuntimeEpisodeRecord,
  type RuntimeSurfaceMessageRecord,
  type RuntimeActorExtensionBindingRecord,
  type RequestInputQuestionRequest,
  type ExtensionRuntimeOperation,
  type ExtensionExecutionPlan,
  type RuntimeEffectRequest,
  type RuntimeRequestInputRecord,
  type PromptExecutionContext,
  type StartRuntimeHandlerThreadsInput,
  type StartRuntimeHandlerThreadsResult,
  type SurfacePiSessionId,
  type ThreadGroupId,
  type ThreadId,
  type ToolItemId,
  type TurnId,
  type CommandId,
} from "@svvy/core";
import { Extensions, type CommandInvocationContext } from "@svvy/extensions";
import { RuntimeEventBus } from "./runtime-event-bus";

export type StartedHandlerThread = {
  readonly threadId: ThreadId;
  readonly threadGroupId: ThreadGroupId;
  readonly surfacePiSessionId: SurfacePiSessionId;
  readonly parentThreadId: ThreadId | null;
  readonly objective: string;
  readonly objectiveState: "active";
  readonly queuedMessageId: QueueItemId;
};

export type StartedHandlerThreadsResult = {
  readonly threadGroupId: ThreadGroupId;
  readonly threads: readonly StartedHandlerThread[];
};

export type RuntimeEffectRequestApplicationContext = {
  target: PromptTarget;
  turnId: TurnId;
  toolItemId: ToolItemId;
  commandId?: CommandId;
  commandContext?: CommandInvocationContext;
  promptExecutionContext?: PromptExecutionContext;
  sourceInvalidation?: {
    refreshGeneratedContext(
      input: Extract<RuntimeEffectRequest, { type: "generated_context.refresh" }>["input"],
    ): Effect.Effect<void, RuntimeContractError>;
    refreshGeneratedPackages(
      input: Extract<RuntimeEffectRequest, { type: "generated_packages.refresh" }>["input"],
    ): Effect.Effect<GeneratedPackagesRefreshResult, RuntimeContractError>;
  };
};

export type RuntimeExecutionPlanReceipt = {
  readonly commandId: CommandId;
};

export interface RuntimeExecutionPlanExecutorService {
  execute(input: {
    readonly commandId: CommandId;
    readonly target: PromptTarget;
    readonly plan: ExtensionExecutionPlan;
    readonly invocationContext: CommandInvocationContext;
    readonly promptExecutionContext: PromptExecutionContext;
  }): Effect.Effect<RuntimeExecutionPlanReceipt, RuntimeContractError>;
}

export class RuntimeExecutionPlanExecutor extends Context.Service<
  RuntimeExecutionPlanExecutor,
  RuntimeExecutionPlanExecutorService
>()("@svvy/runtime/RuntimeExecutionPlanExecutor") {}

export const layerRuntimeExecutionPlanExecutor = Layer.succeed(
  RuntimeExecutionPlanExecutor,
  RuntimeExecutionPlanExecutor.of({
    execute: (input) =>
      Effect.fail(
        new RuntimeContractError({
          operation: "runtime.executionPlan.execute",
          reason: "unsupported-operation",
          message: `Runtime execution plan ${input.plan.type} has no composed execution lane.`,
          cause: {
            commandId: input.commandId,
            planId: input.plan.planId,
            planType: input.plan.type,
          },
        }),
      ),
  }),
);

export type RuntimeQueueInsertPostCommitInput = {
  readonly target: InsertQueueItemRequest["target"];
  readonly queuedMessageId: QueueItemId;
  readonly kind: RuntimeSurfaceMessageRecord["kind"];
};

export interface RuntimeQueueInsertPostCommitLaneService {
  afterQueueInsertCommitted(
    input: RuntimeQueueInsertPostCommitInput,
  ): Effect.Effect<void, RuntimeContractError>;
}

export class RuntimeQueueInsertPostCommitLane extends Context.Service<
  RuntimeQueueInsertPostCommitLane,
  RuntimeQueueInsertPostCommitLaneService
>()("@svvy/runtime/RuntimeQueueInsertPostCommitLane") {}

export type PrepareHandlerThreadStartInput = {
  readonly request: Extract<RuntimeEffectRequest, { type: "handler_thread.start" }>["input"];
  readonly target: Extract<PromptTarget, { surface: "orchestrator" }>;
  readonly turnId: TurnId;
  readonly toolItemId: ToolItemId;
};

export interface RuntimeHandlerThreadStartPreparationHostService {
  prepareHandlerThreadStart(
    input: PrepareHandlerThreadStartInput,
  ): Effect.Effect<StartRuntimeHandlerThreadsInput, RuntimeContractError>;
}

export class RuntimeHandlerThreadStartPreparationHost extends Context.Service<
  RuntimeHandlerThreadStartPreparationHost,
  RuntimeHandlerThreadStartPreparationHostService
>()("@svvy/runtime/RuntimeHandlerThreadStartPreparationHost") {}

export type AppliedRuntimeEffectRequest =
  | {
      type: "handler_thread.start";
      result: StartedHandlerThreadsResult;
    }
  | {
      type: "request_input.create";
      request: RuntimeRequestInputRecord;
    }
  | {
      type: "queue.insert";
      queuedMessage: RuntimeSurfaceMessageRecord;
    }
  | {
      type: "episode.record";
      episode: RuntimeEpisodeRecord;
    }
  | {
      type: "actor_extension_binding.update";
      binding: RuntimeActorExtensionBindingRecord;
    }
  | {
      type: "generated_packages.refresh";
      result: GeneratedPackagesRefreshResult;
    }
  | {
      type: "generated_context.refresh";
      input: Extract<RuntimeEffectRequest, { type: "generated_context.refresh" }>["input"];
    }
  | {
      type: "execution_plan";
      plan: ExtensionExecutionPlan;
      receipt: RuntimeExecutionPlanReceipt;
    };

function promptTargetsEqual(left: PromptTarget, right: PromptTarget): boolean {
  if (
    left.workspaceSessionId !== right.workspaceSessionId ||
    left.surface !== right.surface ||
    left.surfacePiSessionId !== right.surfacePiSessionId
  ) {
    return false;
  }
  if (left.surface !== "handler" || right.surface !== "handler") {
    return true;
  }
  return left.threadId === right.threadId;
}

function defaultAnswerForQuestion(
  question: RequestInputQuestionRequest,
): CreateRuntimeRequestInputInput["questions"][number]["defaultAnswer"] {
  if ("options" in question) {
    const recommended = question.options.find((option) => option.recommended);
    if (!recommended) {
      throw new Error("Choice request-input questions require a recommended option.");
    }
    return {
      kind: "option",
      label: recommended.label,
      text: recommended.label,
    };
  }
  return {
    kind: "custom",
    text: question.defaultAnswer,
  };
}

function materializeRequestInputQuestions(
  questions: RuntimeEffectRequest & { type: "request_input.create" },
): CreateRuntimeRequestInputInput["questions"] {
  return questions.input.questions.map((question) => ({
    title: question.title,
    question: question.question,
    defaultAnswer: defaultAnswerForQuestion(question),
    ...("options" in question
      ? {
          choices: question.options.map((option) => ({
            label: option.label,
            description: option.description,
            recommended: option.recommended === true,
          })),
        }
      : {}),
  }));
}

function threadIdForTarget(target: InsertQueueItemRequest["target"]): string | null {
  return target.surface === "handler" || target.surface === "workflow-task"
    ? target.threadId
    : null;
}

function workflowTaskAttemptIdForTarget(target: InsertQueueItemRequest["target"]): string | null {
  return target.surface === "workflow-task" ? target.workflowTaskAttemptId : null;
}

function runtimeEffectStateError(cause: {
  reason: string;
  message: string;
  issues?: RuntimeContractError["issues"];
}): RuntimeContractError {
  return new RuntimeContractError({
    operation: "runtime.effects.apply",
    reason:
      cause.reason === "not-found"
        ? "target-not-found"
        : cause.reason === "invalid-input"
          ? "invalid-input"
          : "stale-state",
    message: cause.message,
    ...(cause.issues ? { issues: cause.issues } : {}),
    cause,
  });
}

function runtimeEffectPublicationError(input: {
  readonly kind: RuntimeEffectRequest["type"];
  cause: unknown;
}) {
  return new RuntimeContractError({
    operation: "runtime.effects.apply",
    reason: "stale-state",
    message: `Runtime event bus did not accept ${input.kind} notifications.`,
    cause: input.cause,
  });
}

function mapStartedHandlerThreadsResult(
  result: StartRuntimeHandlerThreadsResult,
): StartedHandlerThreadsResult {
  return {
    threadGroupId: result.threadGroupId,
    threads: result.threads.map((thread) => ({
      threadId: thread.threadId,
      threadGroupId: thread.threadGroupId,
      surfacePiSessionId: thread.surfacePiSessionId,
      parentThreadId: thread.parentThreadId,
      objective: thread.objective,
      objectiveState: thread.objectiveState,
      queuedMessageId: thread.queuedMessageId,
    })),
  };
}

export const applyQueueInsertRuntimeEffectRequest = Effect.fn("@svvy/runtime/effects.queueInsert")(
  function* (request: RuntimeEffectRequest & { type: "queue.insert" }) {
    const queue = yield* RuntimeQueueStatePort;
    const eventBus = yield* RuntimeEventBus;
    const postCommitLane = yield* RuntimeQueueInsertPostCommitLane;
    const payloadJson = JSON.stringify(request.input.payload);
    const queuedMessageResult = yield* queue
      .enqueueSurfaceMessage({
        sessionId: request.input.target.workspaceSessionId,
        surfacePiSessionId: request.input.target.surfacePiSessionId,
        threadId: threadIdForTarget(request.input.target),
        workflowTaskAttemptId: workflowTaskAttemptIdForTarget(request.input.target),
        kind: request.input.kind,
        idempotencyKey: request.input.idempotencyKey,
        priority: request.input.priority ?? "runtime",
        orderingKey: `surface:${request.input.target.surfacePiSessionId}`,
        sourceCommandId: request.input.sourceCommandId ?? null,
        nextAttemptAt: request.input.notBefore ?? null,
        messageJson: payloadJson,
        payloadJson,
      })
      .pipe(Effect.mapError(runtimeEffectStateError));
    const queuedMessage = queuedMessageResult.value;
    yield* eventBus
      .publishStateInvalidations({ afterCommit: queuedMessageResult.afterCommit })
      .pipe(
        Effect.mapError(
          (cause) =>
            new RuntimeContractError({
              operation: "runtime.effects.apply",
              reason: "stale-state",
              message: "Runtime event bus did not accept queue.insert notifications.",
              cause,
            }),
        ),
      );
    yield* postCommitLane.afterQueueInsertCommitted({
      target: request.input.target,
      queuedMessageId: queuedMessage.id as QueueItemId,
      kind: queuedMessage.kind,
    });
    return {
      type: "queue.insert",
      queuedMessage,
    } satisfies AppliedRuntimeEffectRequest;
  },
);

export const applyHandlerThreadStartRuntimeEffectRequest = Effect.fn(
  "@svvy/runtime/effects.handlerThreadStart",
)(function* (
  context: RuntimeEffectRequestApplicationContext,
  request: RuntimeEffectRequest & { type: "handler_thread.start" },
) {
  if (context.target.surface !== "orchestrator") {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.effects.apply",
        reason: "invalid-input",
        message: "Handler thread start requests must originate from an orchestrator surface.",
      }),
    );
  }
  if (request.input.workspaceSessionId !== context.target.workspaceSessionId) {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.effects.apply",
        reason: "invalid-input",
        message: "Handler thread start request workspace does not match the active command target.",
      }),
    );
  }
  const hostOption = yield* Effect.serviceOption(RuntimeHandlerThreadStartPreparationHost);
  if (Option.isNone(hostOption)) {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.effects.apply",
        reason: "unsupported-operation",
        message: "Handler thread start runtime effects require a handler thread preparation host.",
      }),
    );
  }

  const preparedInput = yield* hostOption.value.prepareHandlerThreadStart({
    request: request.input,
    target: context.target,
    turnId: context.turnId,
    toolItemId: context.toolItemId,
  });
  const threadState = yield* RuntimeThreadStatePort;
  const eventBus = yield* RuntimeEventBus;
  const postCommitLane = yield* RuntimeQueueInsertPostCommitLane;
  const startedResult = yield* threadState
    .startHandlerThreads(preparedInput)
    .pipe(Effect.mapError(runtimeEffectStateError));
  yield* eventBus.publishStateInvalidations({ afterCommit: startedResult.afterCommit }).pipe(
    Effect.mapError(
      (cause) =>
        new RuntimeContractError({
          operation: "runtime.effects.apply",
          reason: "stale-state",
          message: "Runtime event bus did not accept handler_thread.start notifications.",
          cause,
        }),
    ),
  );
  for (const thread of startedResult.value.threads) {
    yield* postCommitLane.afterQueueInsertCommitted({
      target: {
        workspaceSessionId: thread.workspaceSessionId,
        surface: "handler",
        surfacePiSessionId: thread.surfacePiSessionId,
        threadId: thread.threadId,
      },
      queuedMessageId: thread.queuedMessageId,
      kind: "initial_handler_start",
    });
  }
  const result = mapStartedHandlerThreadsResult(startedResult.value);
  return {
    type: "handler_thread.start",
    result,
  } satisfies AppliedRuntimeEffectRequest;
});

export const applyRequestInputCreateRuntimeEffectRequest = Effect.fn(
  "@svvy/runtime/effects.requestInputCreate",
)(function* (
  context: RuntimeEffectRequestApplicationContext,
  request: RuntimeEffectRequest & { type: "request_input.create" },
  requestInputSettings?: RequestInputSettings,
) {
  if (!promptTargetsEqual(context.target, request.input.target)) {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.effects.apply",
        reason: "invalid-input",
        message: "Runtime effect request target does not match the active command target.",
      }),
    );
  }
  const requestState = yield* RuntimeRequestStatePort;
  const eventBus = yield* RuntimeEventBus;
  const settings =
    requestInputSettings ??
    (yield* requestState.readRequestInputSettings().pipe(Effect.mapError(runtimeEffectStateError)));
  const created = yield* requestState
    .createRequestInput({
      target: request.input.target,
      turnId: context.turnId,
      toolItemId: context.toolItemId,
      sourceCommandId: request.input.sourceCommandId,
      mode: settings.mode,
      timeout: settings.mode === "blocking" ? settings.blockingTimeout : null,
      questions: materializeRequestInputQuestions(request),
    })
    .pipe(Effect.mapError(runtimeEffectStateError));
  yield* eventBus
    .publishStateInvalidations({ afterCommit: created.afterCommit })
    .pipe(
      Effect.mapError((cause) =>
        runtimeEffectPublicationError({ kind: "request_input.create", cause }),
      ),
    );
  return {
    type: "request_input.create",
    request: created.value,
  } satisfies AppliedRuntimeEffectRequest;
});

export const applyEpisodeRecordRuntimeEffectRequest = Effect.fn(
  "@svvy/runtime/effects.episodeRecord",
)(function* (
  context: RuntimeEffectRequestApplicationContext,
  request: RuntimeEffectRequest & { type: "episode.record" },
) {
  const expectedTarget = {
    workspaceSessionId: request.input.workspaceSessionId,
    surface: "handler",
    surfacePiSessionId: context.target.surfacePiSessionId,
    threadId: request.input.threadId,
  } satisfies PromptTarget;
  if (!promptTargetsEqual(context.target, expectedTarget)) {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.effects.apply",
        reason: "invalid-input",
        message: "Episode record request target does not match the active handler thread.",
      }),
    );
  }

  const episodeState = yield* RuntimeEpisodeStatePort;
  const eventBus = yield* RuntimeEventBus;
  const episodeResult = yield* episodeState
    .recordHandlerThreadEpisode(request.input)
    .pipe(Effect.mapError(runtimeEffectStateError));
  yield* eventBus
    .publishStateInvalidations({ afterCommit: episodeResult.afterCommit })
    .pipe(
      Effect.mapError((cause) => runtimeEffectPublicationError({ kind: "episode.record", cause })),
    );
  const episode = episodeResult.value;
  return {
    type: "episode.record",
    episode,
  } satisfies AppliedRuntimeEffectRequest;
});

export const applyActorExtensionBindingUpdateRuntimeEffectRequest = Effect.fn(
  "@svvy/runtime/effects.actorExtensionBindingUpdate",
)(function* (
  context: RuntimeEffectRequestApplicationContext,
  request: RuntimeEffectRequest & { type: "actor_extension_binding.update" },
) {
  if (!promptTargetsEqual(request.input.target, context.target)) {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.effects.apply",
        reason: "invalid-input",
        message: "Actor extension binding request target does not match the active command target.",
      }),
    );
  }
  if (!context.sourceInvalidation) {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.effects.apply",
        reason: "unsupported-operation",
        message:
          "Actor extension binding runtime effects require a source invalidation service in the application context.",
      }),
    );
  }

  const extensions = yield* Extensions;
  const record = yield* extensions.registry.inspect({ id: request.input.extensionId }).pipe(
    Effect.mapError(
      (cause) =>
        new RuntimeContractError({
          operation: "runtime.effects.apply",
          reason: "invalid-input",
          message: `Unknown extension: ${request.input.extensionId}.`,
          cause,
        }),
    ),
  );
  if (
    request.input.usage === "loaded" &&
    (record.envReadiness === "missing" || record.dependencyReadiness === "missing")
  ) {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.effects.apply",
        reason: "invalid-input",
        message: `Extension is not ready to load for this actor: ${request.input.extensionId}.`,
      }),
    );
  }

  const bindingState = yield* RuntimeActorExtensionBindingStatePort;
  const eventBus = yield* RuntimeEventBus;
  const bindingResult = yield* bindingState
    .updateActorExtensionBinding(request.input)
    .pipe(Effect.mapError(runtimeEffectStateError));
  yield* eventBus
    .publishStateInvalidations({ afterCommit: bindingResult.afterCommit })
    .pipe(
      Effect.mapError((cause) =>
        runtimeEffectPublicationError({ kind: "actor_extension_binding.update", cause }),
      ),
    );
  const binding = bindingResult.value;

  yield* context.sourceInvalidation.refreshGeneratedContext({
    scope: "target",
    target: request.input.target,
    actorKind: request.input.target.surface === "handler" ? "handler" : "orchestrator",
    reason:
      request.input.reason === "load_extension" ? "load-extension" : "profile-settings-changed",
    ...(request.input.sourceCommandId ? { sourceCommandId: request.input.sourceCommandId } : {}),
    refreshBoundSurfaceBeforeNextTurn: true,
  });

  return {
    type: "actor_extension_binding.update",
    binding,
  } satisfies AppliedRuntimeEffectRequest;
});

export const applyGeneratedPackagesRefreshRuntimeEffectRequest = Effect.fn(
  "@svvy/runtime/effects.generatedPackagesRefresh",
)(function* (
  context: RuntimeEffectRequestApplicationContext,
  request: RuntimeEffectRequest & { type: "generated_packages.refresh" },
) {
  if (!context.sourceInvalidation) {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.effects.apply",
        reason: "unsupported-operation",
        message:
          "Generated package refresh runtime effects require a source invalidation service in the application context.",
      }),
    );
  }

  const result = yield* context.sourceInvalidation.refreshGeneratedPackages(request.input);
  return {
    type: "generated_packages.refresh",
    result,
  } satisfies AppliedRuntimeEffectRequest;
});

export const applyGeneratedContextRefreshRuntimeEffectRequest = Effect.fn(
  "@svvy/runtime/effects.generatedContextRefresh",
)(function* (
  context: RuntimeEffectRequestApplicationContext,
  request: RuntimeEffectRequest & { type: "generated_context.refresh" },
) {
  if (!context.sourceInvalidation) {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.effects.apply",
        reason: "unsupported-operation",
        message:
          "Generated context refresh runtime effects require a source invalidation service in the application context.",
      }),
    );
  }

  yield* context.sourceInvalidation.refreshGeneratedContext(request.input);
  return {
    type: "generated_context.refresh",
    input: request.input,
  } satisfies AppliedRuntimeEffectRequest;
});

export const applyRuntimeEffectRequest = Effect.fn("@svvy/runtime/effects.applyOne")(function* (
  context: RuntimeEffectRequestApplicationContext,
  rawRequest: unknown,
) {
  const request = yield* decodeRuntimeEffectRequestForApply(rawRequest);
  switch (request.type) {
    case "handler_thread.start":
      return yield* applyHandlerThreadStartRuntimeEffectRequest(context, request);
    case "queue.insert":
      return yield* applyQueueInsertRuntimeEffectRequest(request);
    case "request_input.create":
      return yield* applyRequestInputCreateRuntimeEffectRequest(context, request);
    case "episode.record":
      return yield* applyEpisodeRecordRuntimeEffectRequest(context, request);
    case "actor_extension_binding.update":
      return yield* applyActorExtensionBindingUpdateRuntimeEffectRequest(context, request);
    case "generated_context.refresh":
      return yield* applyGeneratedContextRefreshRuntimeEffectRequest(context, request);
    case "generated_packages.refresh":
      return yield* applyGeneratedPackagesRefreshRuntimeEffectRequest(context, request);
  }
  return assertRuntimeEffectRequestExhaustive(request);
});

function assertRuntimeEffectRequestExhaustive(request: never): never {
  throw new Error(
    `Runtime effect request variant was decoded by @svvy/core but has no runtime applier: ${JSON.stringify(
      request,
    )}.`,
  );
}

export const applyRuntimeEffectRequests = Effect.fn("@svvy/runtime/effects.applyMany")(function* (
  context: RuntimeEffectRequestApplicationContext,
  requests: readonly unknown[],
) {
  const applied: AppliedRuntimeEffectRequest[] = [];
  for (const request of requests) {
    applied.push(yield* applyRuntimeEffectRequest(context, request));
  }
  return applied;
});

export const executeExtensionExecutionPlanOperation = Effect.fn(
  "@svvy/runtime/effects.executionPlan",
)(function* (context: RuntimeEffectRequestApplicationContext, rawPlan: unknown) {
  const plan = yield* decodeExtensionExecutionPlanForApply(rawPlan);
  if (!context.commandId || !context.commandContext || !context.promptExecutionContext) {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.effects.applyOperations",
        reason: "unsupported-operation",
        message:
          "Extension execution plans require the owning command context, prompt execution context, and command id.",
      }),
    );
  }

  const executor = yield* RuntimeExecutionPlanExecutor;
  const receipt = yield* executor.execute({
    commandId: context.commandId,
    target: context.target,
    plan,
    invocationContext: context.commandContext,
    promptExecutionContext: context.promptExecutionContext,
  });

  return {
    type: "execution_plan",
    plan,
    receipt,
  } satisfies AppliedRuntimeEffectRequest;
});

export const applyExtensionRuntimeOperations = Effect.fn("@svvy/runtime/effects.applyOperations")(
  function* (context: RuntimeEffectRequestApplicationContext, operations: readonly unknown[]) {
    const applied: AppliedRuntimeEffectRequest[] = [];
    for (const operation of operations as readonly ExtensionRuntimeOperation[]) {
      switch (operation.kind) {
        case "runtime_effect":
          applied.push(yield* applyRuntimeEffectRequest(context, operation.request));
          break;
        case "execution_plan":
          applied.push(yield* executeExtensionExecutionPlanOperation(context, operation.plan));
          break;
        default: {
          return yield* Effect.fail(
            new RuntimeContractError({
              operation: "runtime.effects.applyOperations",
              reason: "invalid-input",
              message: `Extension runtime operation has no application case: ${
                (operation as { kind?: string }).kind ?? "unknown"
              }.`,
            }),
          );
        }
      }
    }
    return applied;
  },
);

const decodeRuntimeEffectRequestForApply = Effect.fn(
  "@svvy/runtime/effects.decodeRuntimeEffectRequestForApply",
)(function* (request: unknown) {
  return yield* decodeUnknownRuntimeEffectRequestEffect(request).pipe(
    Effect.mapError(
      (cause) =>
        new RuntimeContractError({
          operation: "runtime.effects.applyOperations",
          reason: "invalid-input",
          ...boundarySchemaErrorDetails(cause),
          cause,
        }),
    ),
  );
});

const decodeExtensionExecutionPlanForApply = Effect.fn(
  "@svvy/runtime/effects.decodeExtensionExecutionPlanForApply",
)(function* (plan: unknown) {
  return yield* decodeUnknownExtensionExecutionPlanEffect(plan).pipe(
    Effect.mapError(
      (cause) =>
        new RuntimeContractError({
          operation: "runtime.effects.applyOperations",
          reason: "invalid-input",
          ...boundarySchemaErrorDetails(cause),
          cause,
        }),
    ),
  );
});
