import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  PiSessionReferencePort,
  PiSessionReferencePortError,
  type PiSessionReferencePortService,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import { mutationResult, surfaceAndSessionNavigationInvalidations } from "./state-mutation-result";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

function piSessionReferencePortError(
  operation: string,
  cause: unknown,
): PiSessionReferencePortError {
  const message =
    cause instanceof Error && cause.message
      ? cause.message
      : "Pi session reference state operation failed.";
  const reason =
    message.includes("was not found") || message.includes("not found:")
      ? "reference-not-found"
      : message.includes("does not match") || message.includes("not managed by")
        ? "invalid-input"
        : "persistence-failed";
  return new PiSessionReferencePortError({
    operation,
    reason,
    message,
    cause,
  });
}

function mutationInvalidations(
  workspaceId: string,
  surfacePiSessionId: string,
): readonly StateInvalidationDescriptor[] {
  return surfaceAndSessionNavigationInvalidations(workspaceId, surfacePiSessionId);
}

export function piSessionReferencePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): PiSessionReferencePortService {
  return {
    getPiSessionReference: (input) =>
      state
        .getPiSessionReference(input)
        .pipe(
          Effect.mapError((cause) =>
            piSessionReferencePortError("pi-session-reference.get", cause),
          ),
        ),
    savePiSessionReference: (input) =>
      state.savePiSessionReference(input).pipe(
        Effect.map((reference) =>
          mutationResult(
            reference,
            mutationInvalidations(state.workspaceId, input.surfacePiSessionId),
          ),
        ),
        Effect.mapError((cause) => piSessionReferencePortError("pi-session-reference.save", cause)),
      ),
    deletePiSessionReference: (input) =>
      state.deletePiSessionReference(input).pipe(
        Effect.map((result) =>
          mutationResult(
            result,
            mutationInvalidations(state.workspaceId, input.surfacePiSessionId),
          ),
        ),
        Effect.mapError((cause) =>
          piSessionReferencePortError("pi-session-reference.delete", cause),
        ),
      ),
    validatePiSessionReference: (input) =>
      state
        .validatePiSessionReference(input)
        .pipe(
          Effect.mapError((cause) =>
            piSessionReferencePortError("pi-session-reference.validate", cause),
          ),
        ),
  };
}

export function piSessionReferencePortFromStore(
  store: StructuredSessionStateStore,
): PiSessionReferencePortService {
  return piSessionReferencePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const makePiSessionReferencePort = Effect.fn("@svvy/state/makePiSessionReferencePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return piSessionReferencePortFromStructuredSessionState(state);
  },
);

export const layerPiSessionReferencePort = Layer.effect(
  PiSessionReferencePort,
  makePiSessionReferencePort(),
);
