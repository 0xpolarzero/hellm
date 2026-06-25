import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeArtifactStatePort,
  StateContractError,
  type RuntimeArtifactRecord,
  type RuntimeArtifactStatePortService,
} from "@svvy/core";
import {
  commandInspectorInvalidation,
  dedupeInvalidations,
  handlerThreadInspectorInvalidation,
  mutationResult,
  sessionNavigationInvalidation,
  workflowTaskAttemptInspectorInvalidation,
} from "./state-mutation-result";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredArtifactRecord,
  type StructuredSessionStateStore,
} from "./structured-session-state";

function mapRuntimeArtifactRecord(record: StructuredArtifactRecord): RuntimeArtifactRecord {
  return record as RuntimeArtifactRecord;
}

function runtimeArtifactInvalidations(
  workspaceId: string,
  record: RuntimeArtifactRecord,
): ReturnType<typeof dedupeInvalidations> {
  return dedupeInvalidations([
    sessionNavigationInvalidation(workspaceId),
    ...(record.sourceCommandId
      ? [commandInspectorInvalidation(workspaceId, record.sourceCommandId)]
      : []),
    ...(record.threadId ? [handlerThreadInspectorInvalidation(workspaceId, record.threadId)] : []),
    ...(record.workflowTaskAttemptId
      ? [workflowTaskAttemptInspectorInvalidation(workspaceId, record.workflowTaskAttemptId)]
      : []),
  ]);
}

export function runtimeArtifactStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeArtifactStatePortService {
  return {
    createArtifact: (input) =>
      state.createArtifact(input).pipe(
        Effect.map(mapRuntimeArtifactRecord),
        Effect.map((record) =>
          mutationResult(record, runtimeArtifactInvalidations(state.workspaceId, record)),
        ),
        Effect.mapError((error) => mapArtifactStateError("runtime-artifact.create", error)),
      ),
    inspectArtifact: (input) =>
      state.inspectArtifact(input).pipe(
        Effect.map(mapRuntimeArtifactRecord),
        Effect.mapError((error) => mapArtifactStateError("runtime-artifact.inspect", error)),
      ),
    listArtifacts: (input) =>
      state.listArtifacts(input).pipe(
        Effect.map((records) => records.map(mapRuntimeArtifactRecord)),
        Effect.mapError((error) => mapArtifactStateError("runtime-artifact.list", error)),
      ),
    deleteArtifact: (input) =>
      state.deleteArtifact(input).pipe(
        Effect.map(mapRuntimeArtifactRecord),
        Effect.map((record) =>
          mutationResult(record, runtimeArtifactInvalidations(state.workspaceId, record)),
        ),
        Effect.mapError((error) => mapArtifactStateError("runtime-artifact.delete", error)),
      ),
  };
}

export function runtimeArtifactStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeArtifactStatePortService {
  return runtimeArtifactStatePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const makeRuntimeArtifactStatePort = Effect.fn("@svvy/state/makeRuntimeArtifactStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeArtifactStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeArtifactStatePort = Layer.effect(
  RuntimeArtifactStatePort,
  makeRuntimeArtifactStatePort(),
);

function mapArtifactStateError(operation: string, error: StateContractError): StateContractError {
  const message = error.message;
  return new StateContractError({
    operation,
    reason: artifactStateErrorReason(message),
    message,
    cause: error.cause ?? error,
  });
}

function artifactStateErrorReason(message: string): StateContractError["reason"] {
  if (message.startsWith("ARTIFACT_NOT_FOUND:") || message.includes(" was not found.")) {
    return "not-found";
  }
  if (message.startsWith("ARTIFACT_EXISTS:")) {
    return "conflict";
  }
  if (
    message.startsWith("INVALID_ARGUMENT:") ||
    message.startsWith("SOURCE_NOT_FOUND:") ||
    message.startsWith("SOURCE_IS_DIRECTORY:") ||
    message.startsWith("SOURCE_NOT_FILE:") ||
    message.startsWith("SOURCE_UNREADABLE:")
  ) {
    return "invalid-input";
  }
  return "transaction-failed";
}
