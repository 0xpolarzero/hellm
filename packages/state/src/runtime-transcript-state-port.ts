import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RuntimeTranscriptStatePort, type RuntimeTranscriptStatePortService } from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { mutationResult, surfaceInvalidation } from "./state-mutation-result";

export function runtimeTranscriptStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeTranscriptStatePortService {
  const invalidation = (surfacePiSessionId: string) => [
    surfaceInvalidation(state.workspaceId, surfacePiSessionId),
  ];
  return {
    commitUserMessage: (input) =>
      Effect.map(state.commitRuntimeTranscriptUserMessage(input), (value) =>
        mutationResult(value, invalidation(input.surfacePiSessionId)),
      ),
    beginAssistantMessage: (input) =>
      Effect.map(state.beginRuntimeTranscriptAssistantMessage(input), (value) =>
        mutationResult(value, invalidation(input.surfacePiSessionId)),
      ),
    appendAssistantContentDelta: (input) =>
      Effect.map(state.appendRuntimeTranscriptAssistantContentDelta(input), (value) =>
        mutationResult(value),
      ),
    upsertAssistantToolCall: (input) =>
      Effect.map(state.upsertRuntimeTranscriptAssistantToolCall(input), (value) =>
        mutationResult(value),
      ),
    linkAssistantToolCallCommand: (input) =>
      Effect.map(state.linkRuntimeTranscriptAssistantToolCallCommand(input), (value) =>
        mutationResult(value),
      ),
    commitAssistantMessage: (input) =>
      Effect.map(state.commitRuntimeTranscriptAssistantMessage(input), (value) =>
        mutationResult(value, invalidation(input.surfacePiSessionId)),
      ),
    failAssistantMessage: (input) =>
      Effect.map(state.failRuntimeTranscriptAssistantMessage(input), (value) =>
        mutationResult(value, invalidation(input.surfacePiSessionId)),
      ),
    bindPiHistoryEntry: (input) =>
      Effect.map(state.bindRuntimeTranscriptPiHistoryEntry(input), (value) =>
        mutationResult(value),
      ),
    advanceStreamCursor: (input) =>
      Effect.map(state.advanceRuntimeTranscriptStreamCursor(input), (value) =>
        mutationResult(value),
      ),
    readSurfaceTranscript: (input) => state.readRuntimeSurfaceTranscript(input.surfacePiSessionId),
  };
}

export function runtimeTranscriptStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeTranscriptStatePortService {
  return runtimeTranscriptStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeRuntimeTranscriptStatePort = Effect.fn(
  "@svvy/state/makeRuntimeTranscriptStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return runtimeTranscriptStatePortFromStructuredSessionState(state);
});

export const layerRuntimeTranscriptStatePort = Layer.effect(
  RuntimeTranscriptStatePort,
  makeRuntimeTranscriptStatePort(),
);
