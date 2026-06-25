import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeEpisodeStatePort,
  StateContractError,
  type EpisodeId,
  type RuntimeEpisodeRecord,
  type RuntimeEpisodeStatePortService,
} from "@svvy/core";
import { getStructuredThread } from "./structured-session-selectors";
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
        const snapshot = yield* state.getSessionState(input.workspaceSessionId);
        const thread = getStructuredThread(snapshot, input.threadId);
        if (!thread) {
          return yield* Effect.fail(
            new StateContractError({
              operation: "runtime-episode.recordHandlerThreadEpisode",
              reason: "not-found",
              message: `Thread ${input.threadId} was not found.`,
            }),
          );
        }
        if (thread.threadGroupId !== input.threadGroupId) {
          return yield* Effect.fail(
            new StateContractError({
              operation: "runtime-episode.recordHandlerThreadEpisode",
              reason: "invalid-input",
              message: `Thread ${input.threadId} does not belong to thread group ${input.threadGroupId}.`,
            }),
          );
        }
        const commandIds = new Set(snapshot.commands.map((command) => command.id));
        const artifactIds = new Set(snapshot.artifacts.map((artifact) => artifact.id));
        for (const commandId of input.relatedCommandIds ?? []) {
          if (!commandIds.has(commandId)) {
            return yield* Effect.fail(
              new StateContractError({
                operation: "runtime-episode.recordHandlerThreadEpisode",
                reason: "invalid-input",
                message: `thread_report related command is not durable or inspectable: ${commandId}`,
              }),
            );
          }
        }
        for (const artifactId of input.relatedArtifactIds ?? []) {
          if (!artifactIds.has(artifactId)) {
            return yield* Effect.fail(
              new StateContractError({
                operation: "runtime-episode.recordHandlerThreadEpisode",
                reason: "invalid-input",
                message: `thread_report related artifact is not durable or inspectable: ${artifactId}`,
              }),
            );
          }
        }

        const episode = yield* state.createEpisode({
          threadId: input.threadId,
          sourceCommandId: input.sourceCommandId ?? null,
          kind: input.kind,
          title: input.summary,
          summary: input.summary,
          body: input.body ?? "",
        });

        if (input.outcome) {
          yield* state.updateThread({
            threadId: input.threadId,
            objectiveState: "concluded",
            status: "completed",
            wait: null,
          });
        }

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
