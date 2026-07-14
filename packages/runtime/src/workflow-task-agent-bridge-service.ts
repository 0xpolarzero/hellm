import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeContractError,
  RuntimeWorkflowTaskStatePort,
  type AcceptRuntimeWorkflowTaskAgentStartInput,
  type AuthenticatedRunTaskAgentInput,
  type CommandId,
  type RunTaskAgentResult,
  type RuntimeWorkflowTaskStatePortService,
  type ValidatedTaskAgentParameters,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { RuntimeGeneratedContextRefreshService } from "./runtime-generated-context-refresh-service";
import {
  RuntimeLayerModelResolverPort,
  type RuntimeLayerModelResolverPortService,
} from "./runtime-layer-provider-ports";
import {
  RuntimeSurfaceQueueDispatcherService,
  type RuntimeSurfaceQueueDispatcherServiceService,
} from "./runtime-surface-queue-dispatcher-service";
import {
  RuntimeSurfaceScopeService,
  type RuntimeSurfaceScopeServiceService,
} from "./surface-runtime-scope-service";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeShutdownAdmission } from "./runtime-shutdown-admission";

export interface RuntimeWorkflowTaskAgentBridgeServiceService {
  runTaskAgent(
    input: AuthenticatedRunTaskAgentInput,
  ): Effect.Effect<RunTaskAgentResult, RuntimeContractError>;
}

export class RuntimeWorkflowTaskAgentBridgeService extends Context.Service<
  RuntimeWorkflowTaskAgentBridgeService,
  RuntimeWorkflowTaskAgentBridgeServiceService
>()("@svvy/runtime/RuntimeWorkflowTaskAgentBridgeService") {}

export interface RuntimeWorkflowTaskAgentBridgeBearerVerifierService {
  verify(input: {
    readonly bearerToken: string;
    readonly workspaceSessionId: WorkspaceSessionId;
    readonly sourceCommandId: CommandId;
  }): Effect.Effect<boolean, RuntimeContractError>;
}

export class RuntimeWorkflowTaskAgentBridgeBearerVerifier extends Context.Service<
  RuntimeWorkflowTaskAgentBridgeBearerVerifier,
  RuntimeWorkflowTaskAgentBridgeBearerVerifierService
>()("@svvy/runtime/RuntimeWorkflowTaskAgentBridgeBearerVerifier") {}

export const layerRuntimeWorkflowTaskAgentBridgeService = Layer.effect(
  RuntimeWorkflowTaskAgentBridgeService,
  Effect.gen(function* () {
    const workflowTaskState = yield* RuntimeWorkflowTaskStatePort;
    const surfaceScopes = yield* RuntimeSurfaceScopeService;
    const generatedContextRefresh = yield* RuntimeGeneratedContextRefreshService;
    const queueDispatcher = yield* RuntimeSurfaceQueueDispatcherService;
    const eventBus = yield* RuntimeEventBus;
    const modelResolver = yield* RuntimeLayerModelResolverPort;
    const verifier = yield* RuntimeWorkflowTaskAgentBridgeBearerVerifier;
    const shutdownAdmission = yield* RuntimeShutdownAdmission;

    return RuntimeWorkflowTaskAgentBridgeService.of({
      runTaskAgent: (input) =>
        shutdownAdmission.assertAccepting("runtime.workflowTaskAgentBridge.runTaskAgent").pipe(
          Effect.andThen(
            runWorkflowTaskAgent({
              input,
              workflowTaskState,
              surfaceScopes,
              generatedContextRefresh,
              queueDispatcher,
              eventBus,
              modelResolver,
              verifier,
            }),
          ),
        ),
    });
  }),
);

function runWorkflowTaskAgent(input: {
  readonly input: AuthenticatedRunTaskAgentInput;
  readonly workflowTaskState: RuntimeWorkflowTaskStatePortService;
  readonly surfaceScopes: RuntimeSurfaceScopeServiceService;
  readonly generatedContextRefresh: RuntimeGeneratedContextRefreshService["Service"];
  readonly queueDispatcher: RuntimeSurfaceQueueDispatcherServiceService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly modelResolver: RuntimeLayerModelResolverPortService;
  readonly verifier: RuntimeWorkflowTaskAgentBridgeBearerVerifierService;
}): Effect.Effect<RunTaskAgentResult, RuntimeContractError> {
  const operation = "runtime.workflowTaskAgentBridge.runTaskAgent";
  return Effect.gen(function* () {
    if (
      input.input.auth.kind !== "bearer" ||
      input.input.auth.transport !== "loopback-http" ||
      input.input.auth.token.length === 0
    ) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "bridge-forbidden",
          message: "Workflow task-agent bridge request used an unsupported auth transport.",
        }),
      );
    }

    const request = input.input.request;
    const authorized = yield* input.verifier.verify({
      bearerToken: input.input.auth.token,
      workspaceSessionId: request.workspaceSessionId as WorkspaceSessionId,
      sourceCommandId: request.sourceCommandId as CommandId,
    });
    if (!authorized) {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "bridge-forbidden",
          message:
            "Workflow task-agent bridge bearer token is not authorized for this command lineage.",
        }),
      );
    }

    const idempotencyKey = workflowTaskAgentIdempotencyKey({
      workspaceSessionId: request.workspaceSessionId,
      sourceCommandId: request.sourceCommandId,
      runId: request.taskIdentity.runId,
      nodeId: request.taskIdentity.nodeId,
      iteration: request.taskIdentity.iteration,
      attempt: request.taskIdentity.attempt,
      agentId: request.agent.id,
    });
    const terminal = yield* input.workflowTaskState
      .getWorkflowTaskAgentAttemptTerminal({
        workspaceSessionId: request.workspaceSessionId as WorkspaceSessionId,
        idempotencyKey,
      })
      .pipe(
        Effect.mapError((cause) =>
          runtimeBridgeStateError({
            operation,
            message: cause.message,
            reason: "bridge-invalid-request",
            cause,
          }),
        ),
      );
    if (terminal?.status === "completed") {
      return terminal.result as RunTaskAgentResult;
    }
    if (terminal?.status === "failed" || terminal?.status === "conflict") {
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: terminal.status === "conflict" ? "bridge-forbidden" : "target-not-ready",
          message: terminal.error,
        }),
      );
    }

    const resolvedModel = yield* input.modelResolver.resolveModel({
      provider: request.agent.provider,
      model: request.agent.model,
    });

    const baseStartInput: Omit<AcceptRuntimeWorkflowTaskAgentStartInput, "smithersContext"> = {
      workspaceSessionId: request.workspaceSessionId as WorkspaceSessionId,
      sourceCommandId: request.sourceCommandId as CommandId,
      idempotencyKey,
      agent: validateTaskAgentParameters(request.agent),
      taskIdentity: request.taskIdentity,
      promptSource: request.promptSource,
    };
    const startInput: AcceptRuntimeWorkflowTaskAgentStartInput = request.smithersContext
      ? {
          ...baseStartInput,
          smithersContext: request.smithersContext as NonNullable<
            AcceptRuntimeWorkflowTaskAgentStartInput["smithersContext"]
          >,
        }
      : baseStartInput;
    const receipt =
      terminal?.status === "in-flight"
        ? {
            workspaceId: terminal.workspaceId,
            target: terminal.target,
            queuedMessage: terminal.queuedMessage,
            accepted: "existing" as const,
          }
        : yield* input.workflowTaskState.acceptWorkflowTaskAgentStart(startInput).pipe(
            Effect.tap((accepted) =>
              input.eventBus.publishStateInvalidations({ afterCommit: accepted.afterCommit }).pipe(
                Effect.mapError(
                  (cause) =>
                    new RuntimeContractError({
                      operation,
                      reason: "stale-state",
                      message:
                        "Runtime event bus did not accept workflow task-agent bridge notifications.",
                      cause,
                    }),
                ),
              ),
            ),
            Effect.map((accepted) => accepted.value),
            Effect.mapError((cause) =>
              runtimeBridgeStateError({
                operation,
                message: cause.message,
                reason:
                  cause.reason === "not-found"
                    ? "source-command-not-found"
                    : cause.reason === "conflict"
                      ? "bridge-forbidden"
                      : cause.message.includes("handler-thread")
                        ? "source-command-not-handler-owned"
                        : "bridge-invalid-request",
                cause,
              }),
            ),
          );
    const workspaceId = receipt.workspaceId as WorkspaceId;

    if (receipt.accepted === "created") {
      yield* input.surfaceScopes.create({
        workspaceId,
        workspaceSessionId: request.workspaceSessionId as WorkspaceSessionId,
        surfacePiSessionId: receipt.target.surfacePiSessionId,
        actorKind: "workflow-task",
        generatedContextFingerprint: `workflow-task:${idempotencyKey}` as never,
        model: {
          providerId: request.agent.provider as never,
          modelId: request.agent.model as never,
        },
        reasoning: request.agent.reasoning,
      });
    }

    yield* input.generatedContextRefresh.refresh({
      scope: "target",
      target: receipt.target,
      reason: "workflow-task-agent-start",
    });

    const result = yield* input.queueDispatcher.drainForQueueItem({
      workspaceId,
      target: receipt.target,
      queueItemId: receipt.queuedMessage.id,
    });
    if (result.status !== "completed") {
      yield* input.workflowTaskState
        .settleWorkflowTaskAgentAttempt({
          workflowTaskAttemptId: receipt.target.workflowTaskAttemptId,
          idempotencyKey,
          status: "failed",
          error: `Workflow task-agent attempt ${receipt.target.workflowTaskAttemptId} ${result.status}.`,
        })
        .pipe(
          Effect.andThen((settled) =>
            input.eventBus.publishStateInvalidations({ afterCommit: settled.afterCommit }),
          ),
          Effect.ignore,
        );
      return yield* Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "target-not-ready",
          message: `Workflow task-agent attempt ${receipt.target.workflowTaskAttemptId} ${result.status}.`,
        }),
      );
    }
    const settled = yield* input.workflowTaskState
      .settleWorkflowTaskAgentAttempt({
        workflowTaskAttemptId: receipt.target.workflowTaskAttemptId,
        idempotencyKey,
        status: "completed",
        result: {
          text: result.assistantText,
          ...(result.usage ? { usage: result.usage } : {}),
        },
        ...(result.usage && resolvedModel.contextWindow
          ? {
              contextBudget: {
                usedTokens: result.usage.input + result.usage.cacheRead + result.usage.cacheWrite,
                maxTokens: resolvedModel.contextWindow,
              },
            }
          : {}),
      })
      .pipe(
        Effect.mapError((cause) =>
          runtimeBridgeStateError({
            operation,
            message: cause.message,
            reason: "bridge-invalid-request",
            cause,
          }),
        ),
      );
    yield* input.eventBus.publishStateInvalidations({ afterCommit: settled.afterCommit }).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation,
            reason: "stale-state",
            message:
              "Runtime event bus did not accept workflow task-agent settlement notifications.",
            cause,
          }),
      ),
    );
    if (settled.value.status === "completed") {
      return settled.value.result as RunTaskAgentResult;
    }
    return yield* Effect.fail(
      new RuntimeContractError({
        operation,
        reason: "target-not-ready",
        message:
          settled.value.status === "failed" || settled.value.status === "conflict"
            ? settled.value.error
            : "Workflow task-agent attempt did not settle terminally.",
      }),
    );
  });
}

function validateTaskAgentParameters(input: AuthenticatedRunTaskAgentInput["request"]["agent"]) {
  return {
    id: input.id,
    label: input.label,
    provider: input.provider,
    model: input.model,
    reasoning: input.reasoning,
    instructions: input.instructions,
    ...(input.overrides ? { overrides: input.overrides } : {}),
  } satisfies ValidatedTaskAgentParameters;
}

function workflowTaskAgentIdempotencyKey(input: {
  readonly workspaceSessionId: string;
  readonly sourceCommandId: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly iteration: number;
  readonly attempt: number;
  readonly agentId: string;
}): string {
  return `workflow-task-agent-start:${input.workspaceSessionId}:${input.sourceCommandId}:${input.runId}:${input.nodeId}:${input.iteration}:${input.attempt}:${input.agentId}`;
}

function runtimeBridgeStateError(input: {
  readonly operation: string;
  readonly reason:
    | "bridge-invalid-request"
    | "bridge-forbidden"
    | "source-command-not-found"
    | "source-command-not-handler-owned";
  readonly message: string;
  readonly cause: unknown;
}): RuntimeContractError {
  return new RuntimeContractError({
    operation: input.operation,
    reason: input.reason,
    message: input.message,
    cause: input.cause,
  });
}
