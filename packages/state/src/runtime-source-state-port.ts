import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeSourceStatePort,
  type RuntimeSourceFactRecord,
  type RuntimeSourceStatePortService,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import { dedupeInvalidations, mutationResult } from "./state-mutation-result";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

function sourceInvalidations(
  source: Pick<RuntimeSourceFactRecord, "sourceKind">,
): readonly StateInvalidationDescriptor[] {
  switch (source.sourceKind) {
    case "builtin-extension":
    case "user-extension":
      return [{ scope: "app", invalidation: { model: "extensions" } }];
    case "workflow-agent":
      return dedupeInvalidations([
        { scope: "app", invalidation: { model: "agents" } },
        { scope: "app", invalidation: { model: "workflowsGenerated" } },
      ]);
    case "workflow-prompt":
    case "workflow-component":
    case "workflow-workflow":
      return [{ scope: "app", invalidation: { model: "workflowsGenerated" } }];
  }
}

export function runtimeSourceStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeSourceStatePortService {
  return {
    readSourceVersion: state.readRuntimeSourceVersion,
    recordSourceSave: (input) =>
      state
        .recordRuntimeSourceSave(input)
        .pipe(Effect.map((record) => mutationResult(record, sourceInvalidations(record)))),
    recordSourceDelete: (input) =>
      state
        .recordRuntimeSourceDelete(input)
        .pipe(Effect.map((record) => mutationResult(record, sourceInvalidations(record)))),
  };
}

export function runtimeSourceStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeSourceStatePortService {
  return runtimeSourceStatePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const makeRuntimeSourceStatePort = Effect.fn("@svvy/state/makeRuntimeSourceStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeSourceStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeSourceStatePort = Layer.effect(
  RuntimeSourceStatePort,
  makeRuntimeSourceStatePort(),
);
