import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RuntimeSessionWaitStatePort, type RuntimeSessionWaitStatePortService } from "@svvy/core";
import {
  dedupeInvalidations,
  mutationResult,
  sessionNavigationInvalidation,
  surfaceInvalidation,
} from "./state-mutation-result";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionSnapshot,
  type StructuredSessionStateStore,
} from "./structured-session-state";

function sessionWaitInvalidations(
  workspaceId: string,
  snapshot: StructuredSessionSnapshot,
  owner: { kind: "orchestrator" } | { kind: "thread"; threadId: string },
): ReturnType<typeof dedupeInvalidations> {
  const surfacePiSessionId =
    owner.kind === "thread"
      ? snapshot.threads.find((thread) => thread.id === owner.threadId)?.surfacePiSessionId
      : snapshot.session.orchestratorPiSessionId;
  return dedupeInvalidations([
    ...(surfacePiSessionId ? [surfaceInvalidation(workspaceId, surfacePiSessionId)] : []),
    sessionNavigationInvalidation(workspaceId),
  ]);
}

export function runtimeSessionWaitStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeSessionWaitStatePortService {
  return {
    setApprovalWait: (input) =>
      Effect.gen(function* () {
        yield* state.setSessionWait({
          sessionId: input.sessionId,
          owner:
            input.owner.kind === "thread"
              ? { kind: "thread", threadId: input.owner.threadId }
              : { kind: "orchestrator" },
          kind: "approval",
          reason: input.reason,
          resumeWhen: input.resumeWhen,
        });
        const snapshot = yield* state.getSessionState(input.sessionId);
        return mutationResult(
          undefined,
          sessionWaitInvalidations(state.workspaceId, snapshot, input.owner),
        );
      }),
    setUserWait: (input) =>
      Effect.gen(function* () {
        yield* state.setSessionWait({
          sessionId: input.sessionId,
          owner:
            input.owner.kind === "thread"
              ? { kind: "thread", threadId: input.owner.threadId }
              : { kind: "orchestrator" },
          kind: "user",
          reason: input.reason,
          resumeWhen: input.resumeWhen,
        });
        const snapshot = yield* state.getSessionState(input.sessionId);
        return mutationResult(
          undefined,
          sessionWaitInvalidations(state.workspaceId, snapshot, input.owner),
        );
      }),
    clearSessionWait: (input) =>
      Effect.gen(function* () {
        const snapshot = yield* state.getSessionState(input.sessionId);
        const wait = snapshot.session.wait;
        yield* state.clearSessionWait(input);
        return mutationResult(
          undefined,
          wait ? sessionWaitInvalidations(state.workspaceId, snapshot, wait.owner) : [],
        );
      }),
  };
}

export function runtimeSessionWaitStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeSessionWaitStatePortService {
  return runtimeSessionWaitStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeRuntimeSessionWaitStatePort = Effect.fn(
  "@svvy/state/makeRuntimeSessionWaitStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return runtimeSessionWaitStatePortFromStructuredSessionState(state);
});

export const layerRuntimeSessionWaitStatePort = Layer.effect(
  RuntimeSessionWaitStatePort,
  makeRuntimeSessionWaitStatePort(),
);
