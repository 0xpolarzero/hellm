import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeCommandStatePort,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredCommandRecord,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import {
  commandInspectorInvalidation,
  dedupeInvalidations,
  handlerThreadInspectorInvalidation,
  mutationResult,
  sessionNavigationInvalidation,
  surfaceInvalidation,
  workflowTaskAttemptInspectorInvalidation,
} from "./state-mutation-result";

function mapRuntimeCommandRecord(record: StructuredCommandRecord): RuntimeCommandRecord {
  return record as RuntimeCommandRecord;
}

function commandInvalidations(
  workspaceId: string,
  record: RuntimeCommandRecord,
): readonly StateInvalidationDescriptor[] {
  return dedupeInvalidations([
    commandInspectorInvalidation(workspaceId, record.id),
    surfaceInvalidation(workspaceId, record.surfacePiSessionId),
    sessionNavigationInvalidation(workspaceId),
    ...(record.threadId ? [handlerThreadInspectorInvalidation(workspaceId, record.threadId)] : []),
    ...(record.workflowTaskAttemptId
      ? [workflowTaskAttemptInspectorInvalidation(workspaceId, record.workflowTaskAttemptId)]
      : []),
  ]);
}

function recordCommandEvent(
  state: StructuredSessionState["Service"],
  input: Parameters<RuntimeCommandStatePortService["recordCommandEvent"]>[0],
) {
  return Effect.gen(function* () {
    yield* state.recordLifecycleEvent({
      sessionId: input.sessionId,
      kind: input.kind,
      subjectKind: "command",
      subjectId: input.commandId,
      ...(input.at ? { at: input.at } : {}),
      ...(input.data ? { data: input.data } : {}),
    });
    const command = yield* state.findCommandById(input.commandId);
    return mutationResult(
      undefined,
      command
        ? commandInvalidations(state.workspaceId, mapRuntimeCommandRecord(command))
        : [commandInspectorInvalidation(state.workspaceId, input.commandId)],
    );
  });
}

function recordCommandStdinWrite(
  state: StructuredSessionState["Service"],
  input: Parameters<RuntimeCommandStatePortService["recordStdinWrite"]>[0],
) {
  return Effect.gen(function* () {
    yield* state.recordLifecycleEvent({
      sessionId: input.sessionId,
      kind: "command.stdin",
      subjectKind: "command",
      subjectId: input.commandId,
      ...(input.at ? { at: input.at } : {}),
      data: {
        text: input.text,
        acceptedBytes: input.acceptedBytes,
      },
    });
    const command = yield* state.findCommandById(input.commandId);
    return mutationResult(
      undefined,
      command
        ? commandInvalidations(state.workspaceId, mapRuntimeCommandRecord(command))
        : [commandInspectorInvalidation(state.workspaceId, input.commandId)],
    );
  });
}

export function runtimeCommandStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeCommandStatePortService {
  return {
    createCommand: (input) =>
      state.createCommand(input).pipe(
        Effect.map(mapRuntimeCommandRecord),
        Effect.map((record) =>
          mutationResult(record, commandInvalidations(state.workspaceId, record)),
        ),
      ),
    createOrReuseStreamingCommand: (input) =>
      state.createOrReuseStreamingCommand(input).pipe(
        Effect.map(mapRuntimeCommandRecord),
        Effect.map((record) =>
          mutationResult(record, commandInvalidations(state.workspaceId, record)),
        ),
      ),
    findCommandByToolCallId: (input) =>
      state
        .findCommandByToolCallId(input.toolCallId)
        .pipe(Effect.map((record) => (record ? mapRuntimeCommandRecord(record) : null))),
    findCommandById: (input) =>
      state
        .findCommandById(input.commandId)
        .pipe(Effect.map((record) => (record ? mapRuntimeCommandRecord(record) : null))),
    updateCommandArguments: (input) =>
      state.updateCommandArguments(input.commandId, input.arguments).pipe(
        Effect.map(mapRuntimeCommandRecord),
        Effect.map((record) =>
          mutationResult(record, commandInvalidations(state.workspaceId, record)),
        ),
      ),
    startCommand: (input) =>
      state.startCommand(input.commandId).pipe(
        Effect.map(mapRuntimeCommandRecord),
        Effect.map((record) =>
          mutationResult(record, commandInvalidations(state.workspaceId, record)),
        ),
      ),
    finishCommand: (input) =>
      state.finishCommand(input).pipe(
        Effect.map(mapRuntimeCommandRecord),
        Effect.map((record) =>
          mutationResult(record, commandInvalidations(state.workspaceId, record)),
        ),
      ),
    recordCommandEvent: (input) => recordCommandEvent(state, input),
    recordStdinWrite: (input) => recordCommandStdinWrite(state, input),
    hasCommandOutputEvent: (input) =>
      state
        .getSessionState(input.sessionId)
        .pipe(
          Effect.map((snapshot) =>
            snapshot.events.some(
              (event) =>
                event.kind === "command.output" &&
                event.subject.kind === "command" &&
                event.subject.id === input.commandId &&
                (input.stream === undefined || event.data?.stream === input.stream) &&
                (input.source === undefined || event.data?.source === input.source),
            ),
          ),
        ),
  };
}

export function runtimeCommandStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeCommandStatePortService {
  return runtimeCommandStatePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const makeRuntimeCommandStatePort = Effect.fn("@svvy/state/makeRuntimeCommandStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeCommandStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeCommandStatePort = Layer.effect(
  RuntimeCommandStatePort,
  makeRuntimeCommandStatePort(),
);
