import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeComposerDraftStatePort,
  type RuntimeComposerDraftStatePortService,
} from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { mutationResult, surfaceAndSessionNavigationInvalidations } from "./state-mutation-result";

export function runtimeComposerDraftStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeComposerDraftStatePortService {
  return {
    setDraft: (input) =>
      state
        .setComposerDraft({
          sessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.surface === "handler" ? input.target.threadId : null,
          text: input.text,
          attachments: [...input.attachments],
          snippetMentions: [...input.snippetMentions],
        })
        .pipe(
          Effect.map(() =>
            mutationResult(
              undefined,
              surfaceAndSessionNavigationInvalidations(
                state.workspaceId,
                input.target.surfacePiSessionId,
              ),
            ),
          ),
        ),
    clearSubmittedDraft: (input) =>
      state
        .setComposerDraft({
          sessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.surface === "handler" ? input.target.threadId : null,
          text: "",
          attachments: [],
          snippetMentions: [],
        })
        .pipe(
          Effect.map(() =>
            mutationResult(
              undefined,
              surfaceAndSessionNavigationInvalidations(
                state.workspaceId,
                input.target.surfacePiSessionId,
              ),
            ),
          ),
        ),
  };
}

export function runtimeComposerDraftStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeComposerDraftStatePortService {
  return runtimeComposerDraftStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeRuntimeComposerDraftStatePort = Effect.fn(
  "@svvy/state/makeRuntimeComposerDraftStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return runtimeComposerDraftStatePortFromStructuredSessionState(state);
});

export const layerRuntimeComposerDraftStatePort = Layer.effect(
  RuntimeComposerDraftStatePort,
  makeRuntimeComposerDraftStatePort(),
);
