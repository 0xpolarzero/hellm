import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeEpisodeStatePort,
  type EpisodeId,
  type RuntimeEpisodeRecord,
  type RuntimeEpisodeStatePortService,
} from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import {
  dedupeInvalidations,
  handlerThreadInspectorInvalidation,
  mutationResult,
  sessionNavigationInvalidation,
  surfaceInvalidation,
} from "./state-mutation-result";

export function runtimeEpisodeStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeEpisodeStatePortService {
  return {
    recordHandlerThreadEpisode: (input) =>
      Effect.gen(function* () {
        const { episode, thread } = yield* state.recordHandlerThreadEpisode(input);
        const record = {
          id: episode.id as EpisodeId,
          sessionId: input.workspaceSessionId,
          threadId: input.threadId,
          threadGroupId: input.threadGroupId,
          sourceCommandId: input.sourceCommandId ?? null,
          kind: input.kind,
          title: episode.title,
          summary: episode.summary,
          body: episode.body,
          createdAt: episode.createdAt,
        } satisfies RuntimeEpisodeRecord;
        return mutationResult(
          record,
          dedupeInvalidations([
            surfaceInvalidation(state.workspaceId, thread.surfacePiSessionId),
            handlerThreadInspectorInvalidation(state.workspaceId, input.threadId),
            sessionNavigationInvalidation(state.workspaceId),
          ]),
        );
      }),
  };
}

export function runtimeEpisodeStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeEpisodeStatePortService {
  return runtimeEpisodeStatePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const makeRuntimeEpisodeStatePort = Effect.fn("@svvy/state/makeRuntimeEpisodeStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeEpisodeStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeEpisodeStatePort = Layer.effect(
  RuntimeEpisodeStatePort,
  makeRuntimeEpisodeStatePort(),
);
