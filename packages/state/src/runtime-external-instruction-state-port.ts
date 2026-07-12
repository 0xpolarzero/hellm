import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeExternalInstructionStatePort,
  type ExternalInstructionsProjection,
  type RuntimeExternalInstructionStatePortService,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import { mutationResult } from "./state-mutation-result";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

const externalInstructionsInvalidation = (
  workspaceId: Parameters<
    RuntimeExternalInstructionStatePortService["readExternalInstructions"]
  >[0]["workspaceId"],
): readonly StateInvalidationDescriptor[] => [
  { scope: "workspace", workspaceId, invalidation: { model: "externalInstructions" } },
];

export function readExternalInstructionsProjectionWithActorUsage(
  workspaceState: StructuredSessionState["Service"],
  appState: StructuredSessionState["Service"],
  input: Parameters<RuntimeExternalInstructionStatePortService["readExternalInstructions"]>[0],
) {
  return Effect.gen(function* () {
    const projection = yield* workspaceState.readExternalInstructionsProjection(input);
    const sourceIds = new Set(projection.sources.map((source) => source.id as string));
    const profileUsage: ExternalInstructionsProjection["actorUsage"] =
      (yield* appState.listAgentProfiles()).flatMap((profile) =>
        Object.entries(profile.extensionUsage)
          .filter(([sourceId]) => sourceIds.has(sourceId))
          .map(([sourceId, usage]) => ({
            actor: profile.actor,
            profileId:
              profile.profileId as ExternalInstructionsProjection["actorUsage"][number]["profileId"],
            sourceId: sourceId as ExternalInstructionsProjection["actorUsage"][number]["sourceId"],
            usage,
          })),
      );
    const actorDefaultUsage: ExternalInstructionsProjection["actorUsage"] =
      (yield* appState.listAgentActorExtensionDefaults()).flatMap((defaults) =>
        Object.entries(defaults.extensionUsage)
          .filter(([sourceId]) => sourceIds.has(sourceId))
          .map(([sourceId, usage]) => ({
            actor: defaults.actor,
            profileId: null,
            sourceId: sourceId as ExternalInstructionsProjection["actorUsage"][number]["sourceId"],
            usage,
          })),
      );
    return { ...projection, actorUsage: [...profileUsage, ...actorDefaultUsage] };
  });
}

export function runtimeExternalInstructionStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeExternalInstructionStatePortService {
  return {
    reconcileExternalInstructions: (input) =>
      state
        .reconcileExternalInstructions(input)
        .pipe(
          Effect.map((result) =>
            mutationResult(
              result,
              result.changed ? externalInstructionsInvalidation(input.workspaceId) : [],
            ),
          ),
        ),
    readExternalInstructions: (input) =>
      readExternalInstructionsProjectionWithActorUsage(state, state, input),
  };
}

export function runtimeExternalInstructionStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeExternalInstructionStatePortService {
  return runtimeExternalInstructionStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeRuntimeExternalInstructionStatePort = Effect.fn(
  "@svvy/state/makeRuntimeExternalInstructionStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return runtimeExternalInstructionStatePortFromStructuredSessionState(state);
});

export const layerRuntimeExternalInstructionStatePort = Layer.effect(
  RuntimeExternalInstructionStatePort,
  makeRuntimeExternalInstructionStatePort(),
);
