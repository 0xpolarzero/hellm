import * as Effect from "effect/Effect";
import {
  RuntimeActorExtensionBindingStatePort,
  RuntimeCommandStatePort,
  RuntimeContractError,
  RuntimeRequestStatePort,
  RuntimeThreadStatePort,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimeCommandStatePortService,
  type RuntimeRequestStatePortService,
  type RuntimeThreadStatePortService,
  type StateInvalidationDescriptor,
  type StateMutationResult,
} from "@svvy/core";
import { Extensions, type ExtensionsService } from "@svvy/extensions";
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
  type RuntimeHandlerThreadStartPreparationHostService,
  type RuntimeQueueInsertPostCommitLaneService,
} from "./runtime-effect-requests";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeRequestInputWaitService } from "./runtime-request-input-wait-service";
import {
  runAcceptedThreadStartToolCall,
  type RunAcceptedThreadStartToolCallInput,
  type RunAcceptedThreadStartToolCallResult,
} from "./thread-start-operation";

export function runAcceptedRequestUserInputToolCallAtRuntimeBoundary(input: {
  request: RunAcceptedRequestUserInputToolCallInput;
  commandStatePort: RuntimeCommandStatePortService;
  requestStatePort: RuntimeRequestStatePortService;
}): Effect.Effect<RunAcceptedRequestUserInputToolCallResult, RuntimeContractError> {
  const afterCommit: StateInvalidationDescriptor[] = [];
  return runAcceptedRequestUserInputToolCall(input.request).pipe(
    Effect.provideService(
      RuntimeCommandStatePort,
      commandStatePortWithInvalidationCollector(input.commandStatePort, afterCommit),
    ),
    Effect.provideService(RuntimeRequestStatePort, input.requestStatePort),
    Effect.provideService(RuntimeEventBus, noPublishedRuntimeEventsBus),
    Effect.provideService(RuntimeRequestInputWaitService, noBlockingRequestInputWaitService),
  );
}

export function runAcceptedLoadExtensionToolCallAtRuntimeBoundary(input: {
  request: RunAcceptedLoadExtensionToolCallInput;
  commandStatePort: RuntimeCommandStatePortService;
  actorExtensionBindingStatePort: RuntimeActorExtensionBindingStatePortService;
  extensionsService: ExtensionsService;
}): Effect.Effect<RunAcceptedLoadExtensionToolCallResult, RuntimeContractError> {
  const afterCommit: StateInvalidationDescriptor[] = [];
  return runAcceptedLoadExtensionToolCall(input.request).pipe(
    Effect.provideService(
      RuntimeCommandStatePort,
      commandStatePortWithInvalidationCollector(input.commandStatePort, afterCommit),
    ),
    Effect.provideService(
      RuntimeActorExtensionBindingStatePort,
      input.actorExtensionBindingStatePort,
    ),
    Effect.provideService(Extensions, input.extensionsService),
    Effect.provideService(RuntimeEventBus, noPublishedRuntimeEventsBus),
  );
}

export function runAcceptedThreadStartToolCallAtRuntimeBoundary(input: {
  request: RunAcceptedThreadStartToolCallInput;
  commandStatePort: RuntimeCommandStatePortService;
  threadStatePort: RuntimeThreadStatePortService;
  handlerThreadStartPreparationHost: RuntimeHandlerThreadStartPreparationHostService;
  queueInsertPostCommitLane: RuntimeQueueInsertPostCommitLaneService;
}): Effect.Effect<RunAcceptedThreadStartToolCallResult, RuntimeContractError> {
  const afterCommit: StateInvalidationDescriptor[] = [];
  const effect = runAcceptedThreadStartToolCall(input.request).pipe(
    Effect.provideService(
      RuntimeCommandStatePort,
      commandStatePortWithInvalidationCollector(input.commandStatePort, afterCommit),
    ),
    Effect.provideService(RuntimeThreadStatePort, input.threadStatePort),
    Effect.provideService(
      RuntimeHandlerThreadStartPreparationHost,
      input.handlerThreadStartPreparationHost,
    ),
    Effect.provideService(RuntimeQueueInsertPostCommitLane, input.queueInsertPostCommitLane),
    Effect.provideService(RuntimeEventBus, noPublishedRuntimeEventsBus),
  );
  return effect as unknown as Effect.Effect<
    RunAcceptedThreadStartToolCallResult,
    RuntimeContractError
  >;
}

const noPublishedRuntimeEventsBus = RuntimeEventBus.of({
  publishLive: () => Effect.succeed(undefined as never),
  publishStateInvalidations: () => Effect.succeed([]),
  subscribe: () => Effect.die("Runtime events are not available in this tool boundary."),
});

const noBlockingRequestInputWaitService = RuntimeRequestInputWaitService.of({
  waitForBlockingRequest: () =>
    Effect.fail(
      new RuntimeContractError({
        operation: "runtime.request-user-input.run",
        reason: "unsupported-operation",
        message:
          "Blocking request_user_input execution must run inside the shared runtime request-input wait service.",
      }),
    ),
  afterAnswerCommitted: () =>
    Effect.die("Request-input answer post-commit hooks are not available in this tool boundary."),
  afterTimerPausedCommitted: () =>
    Effect.die("Request-input timer post-commit hooks are not available in this tool boundary."),
  restoreOpenBlockingRequests: () =>
    Effect.die("Request-input startup restore is not available in this tool boundary."),
  cancelBlockingRequestsForSurface: () =>
    Effect.die("Request-input surface cancellation is not available in this tool boundary."),
});

function commandStatePortWithInvalidationCollector(
  statePort: RuntimeCommandStatePortService,
  afterCommit: StateInvalidationDescriptor[],
): RuntimeCommandStatePortService {
  return {
    ...statePort,
    createCommand: (input) =>
      statePort.createCommand(input).pipe(Effect.map(collectAfterCommit(afterCommit))),
    createOrReuseStreamingCommand: (input) =>
      statePort
        .createOrReuseStreamingCommand(input)
        .pipe(Effect.map(collectAfterCommit(afterCommit))),
    updateCommandArguments: (input) =>
      statePort.updateCommandArguments(input).pipe(Effect.map(collectAfterCommit(afterCommit))),
    startCommand: (input) =>
      statePort.startCommand(input).pipe(Effect.map(collectAfterCommit(afterCommit))),
    finishCommand: (input) =>
      statePort.finishCommand(input).pipe(Effect.map(collectAfterCommit(afterCommit))),
    recordCommandEvent: (input) =>
      statePort.recordCommandEvent(input).pipe(Effect.map(collectAfterCommit(afterCommit))),
    recordStdinWrite: (input) =>
      statePort.recordStdinWrite(input).pipe(Effect.map(collectAfterCommit(afterCommit))),
  };
}

function collectAfterCommit<T>(afterCommit: StateInvalidationDescriptor[]) {
  return (result: StateMutationResult<T>): StateMutationResult<T> => {
    afterCommit.push(...result.afterCommit);
    return result;
  };
}
