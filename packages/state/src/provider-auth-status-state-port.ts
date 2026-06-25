import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  ProviderAuthStatusStatePort,
  type ProviderAuthStatus,
  type ProviderAuthStatusStatePortService,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { mutationResult } from "./state-mutation-result";

function providerAuthInvalidations(
  status: Pick<ProviderAuthStatus, "providerId">,
): readonly StateInvalidationDescriptor[] {
  return [{ scope: "app", invalidation: { model: "providerAuth", ids: [status.providerId] } }];
}

export function providerAuthStatusStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): ProviderAuthStatusStatePortService {
  return {
    listProviderStatuses: state.listProviderAuthStatuses,
    recordProviderStatus: (input) =>
      state
        .recordProviderAuthStatus(input)
        .pipe(Effect.map((status) => mutationResult(status, providerAuthInvalidations(status)))),
  };
}

export function providerAuthStatusStatePortFromStore(
  store: StructuredSessionStateStore,
): ProviderAuthStatusStatePortService {
  return providerAuthStatusStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeProviderAuthStatusStatePort = Effect.fn(
  "@svvy/state/makeProviderAuthStatusStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return providerAuthStatusStatePortFromStructuredSessionState(state);
});

export const layerProviderAuthStatusStatePort = Layer.effect(
  ProviderAuthStatusStatePort,
  makeProviderAuthStatusStatePort(),
);
