import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import {
  RuntimeActorExtensionBindingStatePort,
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeContractError,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeThreadStatePort,
  StateContractError,
  type SandboxLaunchFacts,
  type RuntimeCommandStatePortService,
  type StateMutationResult,
} from "@svvy/core";
import { Extensions } from "@svvy/extensions";
import {
  runAcceptedLoadExtensionToolCall,
  type RunAcceptedLoadExtensionToolCallInput,
  type RunAcceptedLoadExtensionToolCallResult,
} from "./load-extension-operation";
import {
  runAcceptedRequestUserInputToolCall,
  type RunAcceptedRequestUserInputToolCallInput,
  type RunAcceptedRequestUserInputToolCallResult,
} from "./request-user-input-operation";
import {
  RuntimeHandlerThreadStartPreparationHost,
  RuntimeQueueInsertPostCommitLane,
} from "./runtime-effect-requests";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeQueueWakeService } from "./runtime-queue-wake-port";
import { RuntimeRequestInputWaitService } from "./runtime-request-input-wait-service";
import { RuntimeApprovalWaitService } from "./runtime-approval-wait-service";
import { RuntimeLaunchPolicyService } from "./runtime-launch-policy-service";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";
import { RuntimeShutdownAdmission } from "./runtime-shutdown-admission";
import {
  requestRuntimeDirectToolApproval,
  type RuntimeDirectToolApprovalAdmissionInput,
  type RuntimeDirectToolApprovalDecision,
} from "./runtime-direct-tool-approval";
import {
  runAcceptedThreadStartToolCall,
  type RunAcceptedThreadStartToolCallInput,
  type RunAcceptedThreadStartToolCallResult,
} from "./thread-start-operation";
import {
  buildRuntimeDirectToolLaunchFacts,
  type RuntimeDirectToolLaunchPolicyInput,
} from "./runtime-direct-tool-launch-policy";
import {
  RuntimeLayerCommandControlPort,
  type RuntimeLayerCommandControlPortService,
} from "./runtime-command-host-ports";

export type RunAcceptedLoadExtensionThroughRuntimeInput = Omit<
  RunAcceptedLoadExtensionToolCallInput,
  "sourceInvalidation"
>;

export interface RuntimeAcceptedNativeToolExecutionService {
  acquireDirectToolLaunch(
    input: RuntimeDirectToolLaunchPolicyInput,
  ): Effect.Effect<SandboxLaunchFacts, RuntimeContractError, Scope.Scope>;
  requestDirectToolApproval(
    input: RuntimeDirectToolApprovalAdmissionInput,
  ): Effect.Effect<RuntimeDirectToolApprovalDecision, RuntimeContractError>;
  runExecuteTypescript(
    input: Parameters<RuntimeLayerCommandControlPortService["runExecuteTypescript"]>[0],
  ): Effect.Effect<import("@svvy/core").NativeToolResult, RuntimeContractError>;
  runLoadExtension(
    input: RunAcceptedLoadExtensionThroughRuntimeInput,
  ): Effect.Effect<RunAcceptedLoadExtensionToolCallResult, RuntimeContractError>;
  runRequestUserInput(
    input: RunAcceptedRequestUserInputToolCallInput,
  ): Effect.Effect<RunAcceptedRequestUserInputToolCallResult, RuntimeContractError>;
  runThreadStart(
    input: RunAcceptedThreadStartToolCallInput,
  ): Effect.Effect<RunAcceptedThreadStartToolCallResult, RuntimeContractError>;
}

export class RuntimeAcceptedNativeToolExecution extends Context.Service<
  RuntimeAcceptedNativeToolExecution,
  RuntimeAcceptedNativeToolExecutionService
>()("@svvy/runtime/RuntimeAcceptedNativeToolExecution") {}

const acquireDirectToolLaunch = Effect.fn(
  "@svvy/runtime/acceptedNativeToolExecution.acquireDirectToolLaunch",
)(function* (input: RuntimeDirectToolLaunchPolicyInput) {
  return yield* buildRuntimeDirectToolLaunchFacts(input);
});

export const layerRuntimeAcceptedNativeToolExecution = Layer.effect(
  RuntimeAcceptedNativeToolExecution,
  Effect.gen(function* () {
    const commandState = yield* RuntimeCommandStatePort;
    const approvalState = yield* RuntimeApprovalStatePort;
    const requestState = yield* RuntimeRequestStatePort;
    const sessionWaitState = yield* RuntimeSessionWaitStatePort;
    const actorExtensionBindingState = yield* RuntimeActorExtensionBindingStatePort;
    const threadState = yield* RuntimeThreadStatePort;
    const eventBus = yield* RuntimeEventBus;
    const queueWakeOption = yield* Effect.serviceOption(RuntimeQueueWakeService);
    const queueWake = Option.getOrElse(queueWakeOption, () => missingRuntimeQueueWakeService);
    const approvalWaitService = yield* RuntimeApprovalWaitService;
    const requestInputWaitService = yield* RuntimeRequestInputWaitService;
    const launchPolicy = yield* RuntimeLaunchPolicyService;
    const sourceInvalidation = yield* RuntimeSourceInvalidationService;
    const commandControl = yield* RuntimeLayerCommandControlPort;
    const handlerThreadStartPreparationHostOption = yield* Effect.serviceOption(
      RuntimeHandlerThreadStartPreparationHost,
    );
    const handlerThreadStartPreparationHost = Option.getOrElse(
      handlerThreadStartPreparationHostOption,
      () => missingHandlerThreadStartPreparationHost,
    );
    const extensions = yield* Extensions;
    const shutdownAdmission = yield* RuntimeShutdownAdmission;
    const publishingCommandState = commandStateWithPostCommitPublication({
      commandState,
      eventBus,
    });

    return RuntimeAcceptedNativeToolExecution.of({
      acquireDirectToolLaunch: (input) =>
        shutdownAdmission.withAdmission(
          "runtime.acceptedNativeTool.acquireDirectToolLaunch",
          acquireDirectToolLaunch(input).pipe(
            Effect.provideService(RuntimeLaunchPolicyService, launchPolicy),
          ),
        ),
      requestDirectToolApproval: (input) =>
        shutdownAdmission
          .assertAccepting("runtime.acceptedNativeTool.requestDirectToolApproval")
          .pipe(
            Effect.andThen(
              requestRuntimeDirectToolApproval(input).pipe(
                Effect.provideService(RuntimeApprovalStatePort, approvalState),
                Effect.provideService(RuntimeCommandStatePort, publishingCommandState),
                Effect.provideService(RuntimeSessionWaitStatePort, sessionWaitState),
                Effect.provideService(RuntimeEventBus, eventBus),
                Effect.provideService(RuntimeApprovalWaitService, approvalWaitService),
              ),
            ),
          ),
      runExecuteTypescript: (input) =>
        shutdownAdmission.withAdmission(
          "runtime.acceptedNativeTool.runExecuteTypescript",
          commandControl.runExecuteTypescript(input),
        ),
      runLoadExtension: (input) =>
        shutdownAdmission.withAdmission(
          "runtime.acceptedNativeTool.runLoadExtension",
          runAcceptedLoadExtensionToolCall({
            ...input,
            sourceInvalidation,
          }).pipe(
            Effect.provideService(RuntimeCommandStatePort, publishingCommandState),
            Effect.provideService(
              RuntimeActorExtensionBindingStatePort,
              actorExtensionBindingState,
            ),
            Effect.provideService(RuntimeEventBus, eventBus),
            Effect.provideService(Extensions, extensions),
          ),
        ),
      runRequestUserInput: (input) =>
        shutdownAdmission
          .assertAccepting("runtime.acceptedNativeTool.runRequestUserInput")
          .pipe(
            Effect.andThen(
              runAcceptedRequestUserInputToolCall(input).pipe(
                Effect.provideService(RuntimeCommandStatePort, publishingCommandState),
                Effect.provideService(RuntimeRequestStatePort, requestState),
                Effect.provideService(RuntimeEventBus, eventBus),
                Effect.provideService(RuntimeRequestInputWaitService, requestInputWaitService),
              ),
            ),
          ),
      runThreadStart: (input) =>
        shutdownAdmission.withAdmission(
          "runtime.acceptedNativeTool.runThreadStart",
          runAcceptedThreadStartToolCall(input).pipe(
            Effect.provideService(RuntimeCommandStatePort, publishingCommandState),
            Effect.provideService(RuntimeThreadStatePort, threadState),
            Effect.provideService(RuntimeEventBus, eventBus),
            Effect.provideService(Extensions, extensions),
            Effect.provideService(
              RuntimeHandlerThreadStartPreparationHost,
              handlerThreadStartPreparationHost,
            ),
            Effect.provideService(
              RuntimeQueueInsertPostCommitLane,
              RuntimeQueueInsertPostCommitLane.of({
                afterQueueInsertCommitted: ({ target }) => {
                  if (target.surface === "workflow-task") {
                    return Effect.fail(
                      new RuntimeContractError({
                        operation: "runtime.acceptedNativeTool.threadStart.afterQueueInsert",
                        reason: "invalid-input",
                        message: "Handler thread queue wake cannot target a workflow task surface.",
                      }),
                    );
                  }
                  return queueWake.wakeSurface({
                    target,
                    reason: "message-submitted",
                  });
                },
              }),
            ),
          ),
        ),
    });
  }),
);

const missingHandlerThreadStartPreparationHost = RuntimeHandlerThreadStartPreparationHost.of({
  prepareHandlerThreadStart: () =>
    Effect.die(
      new Error(
        "RuntimeAcceptedNativeToolExecution requires RuntimeHandlerThreadStartPreparationHost composition.",
      ),
    ),
});

const missingRuntimeQueueWakeService = RuntimeQueueWakeService.of({
  wakeSurface: () =>
    Effect.die(
      new Error(
        "RuntimeAcceptedNativeToolExecution requires RuntimeQueueWakeService for thread_start.",
      ),
    ),
});

function commandStateWithPostCommitPublication(input: {
  commandState: RuntimeCommandStatePortService;
  eventBus: RuntimeEventBus["Service"];
}): RuntimeCommandStatePortService {
  const publishMutation = <Value>(
    operation: string,
    effect: Effect.Effect<StateMutationResult<Value>, StateContractError>,
  ): Effect.Effect<StateMutationResult<Value>, StateContractError> =>
    Effect.gen(function* () {
      const result = yield* effect;
      yield* input.eventBus.publishStateInvalidations({ afterCommit: result.afterCommit }).pipe(
        Effect.mapError(
          (cause) =>
            new StateContractError({
              operation,
              reason: "transaction-failed",
              message: "Runtime accepted-tool command invalidation publication failed.",
              cause,
            }),
        ),
      );
      return result;
    });

  return {
    ...input.commandState,
    createCommand: (request) =>
      publishMutation(
        "runtime.acceptedNativeTool.command.create",
        input.commandState.createCommand(request),
      ),
    createOrReuseStreamingCommand: (request) =>
      publishMutation(
        "runtime.acceptedNativeTool.command.createOrReuseStreaming",
        input.commandState.createOrReuseStreamingCommand(request),
      ),
    updateCommandArguments: (request) =>
      publishMutation(
        "runtime.acceptedNativeTool.command.updateArguments",
        input.commandState.updateCommandArguments(request),
      ),
    startCommand: (request) =>
      publishMutation(
        "runtime.acceptedNativeTool.command.start",
        input.commandState.startCommand(request),
      ),
    finishCommand: (request) =>
      publishMutation(
        "runtime.acceptedNativeTool.command.finish",
        input.commandState.finishCommand(request),
      ),
    recordCommandEvent: (request) =>
      publishMutation(
        "runtime.acceptedNativeTool.command.recordEvent",
        input.commandState.recordCommandEvent(request),
      ),
    recordStdinWrite: (request) =>
      publishMutation(
        "runtime.acceptedNativeTool.command.recordStdin",
        input.commandState.recordStdinWrite(request),
      ),
  };
}
