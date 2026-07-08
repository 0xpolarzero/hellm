import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeReadModelStatePort,
  StateContractError,
  type GetCurrentRuntimeThreadInput,
  type GetRuntimeThreadGroupInput,
  type ReadRuntimeThreadEpisodesInput,
  type RuntimeThreadCurrentReadModel,
  type RuntimeThreadEpisodesReadModel,
  type RuntimeThreadGroupReadModel,
  type RuntimeThreadListReadModel,
  type RuntimeReadModelStatePortService,
} from "@svvy/core";
import {
  buildStructuredThreadCurrentReadModel,
  buildStructuredThreadEpisodesReadModel,
  buildStructuredThreadGroupReadModel,
  buildStructuredThreadListReadModel,
  getStructuredThread,
  hasStructuredThreadGroup,
} from "./structured-session-selectors";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionSnapshot,
  type StructuredSessionStateStore,
  type StructuredThreadRecord,
} from "./structured-session-state";

export function runtimeReadModelStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeReadModelStatePortService {
  return {
    getCurrentThread: (input: GetCurrentRuntimeThreadInput) =>
      Effect.gen(function* () {
        const snapshot = yield* state.getSessionState(input.workspaceSessionId);
        const thread = yield* requireStructuredThreadEffect(
          snapshot,
          input.threadId,
          "runtime-read-model.getCurrentThread",
        );
        return buildStructuredThreadCurrentReadModel(
          snapshot,
          thread,
        ) as unknown as RuntimeThreadCurrentReadModel;
      }),
    listThreads: (input) =>
      Effect.gen(function* () {
        const snapshot = yield* state.getSessionState(input.workspaceSessionId);
        return buildStructuredThreadListReadModel(
          snapshot,
          input,
        ) as unknown as RuntimeThreadListReadModel;
      }),
    readThreadEpisodes: (input: ReadRuntimeThreadEpisodesInput) =>
      Effect.gen(function* () {
        const snapshot = yield* state.getSessionState(input.workspaceSessionId);
        if (input.target.kind === "thread") {
          yield* requireStructuredThreadEffect(
            snapshot,
            input.target.threadId,
            "runtime-read-model.readThreadEpisodes",
          );
        }
        if (
          input.target.kind === "thread-group" &&
          !hasStructuredThreadGroup(snapshot, input.target.threadGroupId)
        ) {
          return yield* Effect.fail(
            new StateContractError({
              operation: "runtime-read-model.readThreadEpisodes",
              reason: "not-found",
              message: `Thread group ${input.target.threadGroupId} was not found.`,
            }),
          );
        }
        return buildStructuredThreadEpisodesReadModel(
          snapshot,
          input,
        ) as unknown as RuntimeThreadEpisodesReadModel;
      }),
    getThreadGroup: (input: GetRuntimeThreadGroupInput) =>
      Effect.gen(function* () {
        const snapshot = yield* state.getSessionState(input.workspaceSessionId);
        const currentThread = yield* requireStructuredThreadEffect(
          snapshot,
          input.currentThreadId,
          "runtime-read-model.getThreadGroup",
        );
        return buildStructuredThreadGroupReadModel(
          snapshot,
          currentThread,
        ) as unknown as RuntimeThreadGroupReadModel;
      }),
  };
}

export function runtimeReadModelStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeReadModelStatePortService {
  return runtimeReadModelStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeRuntimeReadModelStatePort = Effect.fn("@svvy/state/makeRuntimeReadModelStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeReadModelStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeReadModelStatePort = Layer.effect(
  RuntimeReadModelStatePort,
  makeRuntimeReadModelStatePort(),
);

function requireStructuredThreadEffect(
  snapshot: StructuredSessionSnapshot,
  threadId: string,
  operation: string,
): Effect.Effect<StructuredThreadRecord, StateContractError> {
  const thread = getStructuredThread(snapshot, threadId);
  if (!thread) {
    return Effect.fail(
      new StateContractError({
        operation,
        reason: "not-found",
        message: `Thread ${threadId} was not found.`,
      }),
    );
  }
  return Effect.succeed(thread);
}
