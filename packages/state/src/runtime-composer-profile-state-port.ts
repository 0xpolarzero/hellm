import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeComposerProfileStatePort,
  StateContractError,
  type AgentProfileId,
  type RuntimeComposerProfileStatePortService,
} from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { agentsInvalidation, mutationResult } from "./state-mutation-result";

export function runtimeComposerProfileStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeComposerProfileStatePortService {
  return {
    readSurfaceProfileId: ({ target }) =>
      Effect.gen(function* () {
        if (target.surface !== "orchestrator") return null;
        const snapshot = yield* state.getSessionState(target.workspaceSessionId);
        if (snapshot.session.orchestratorPiSessionId !== target.surfacePiSessionId) {
          return yield* Effect.fail(
            new StateContractError({
              operation: "runtime-composer-profile.readSurfaceProfileId",
              reason: "not-found",
              message: `Orchestrator surface ${target.surfacePiSessionId} was not found.`,
            }),
          );
        }
        return snapshot.pi.orchestratorAgentProfileId ?? ("default-orchestrator" as AgentProfileId);
      }),
    updateFromComposer: (input) =>
      Effect.gen(function* () {
        const profile = (yield* state.listAgentProfiles()).find(
          (candidate) =>
            candidate.actor === "orchestrator" && candidate.profileId === input.profileId,
        );
        if (!profile || !profile.followComposer) return mutationResult(false);
        if (
          input.provider !== undefined ||
          input.model !== undefined ||
          input.reasoningEffort !== undefined
        ) {
          yield* state.updateOrchestratorProfile({
            profile: {
              profileId: input.profileId,
              name: profile.name,
              providerId: (input.provider ?? profile.providerId) as never,
              modelId: (input.model ?? profile.modelId) as never,
              reasoning:
                input.reasoningEffort === undefined
                  ? (profile.reasoning as never)
                  : { effort: input.reasoningEffort },
              extensionUsage: { ...profile.extensionUsage } as never,
              extensionOrder: [...profile.extensionOrder] as never,
              followComposer: true,
            },
          });
        }
        for (const [extensionId, usage] of Object.entries(input.extensionUsage ?? {})) {
          yield* state.setProfileExtensionUsage({
            actor: "orchestrator",
            profileId: input.profileId,
            extensionId: extensionId as never,
            usage,
          });
        }
        return mutationResult(true, [agentsInvalidation()]);
      }),
  };
}

export function runtimeComposerProfileStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeComposerProfileStatePortService {
  return runtimeComposerProfileStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const layerRuntimeComposerProfileStatePort = Layer.effect(
  RuntimeComposerProfileStatePort,
  Effect.gen(function* () {
    const state = yield* StructuredSessionState;
    return runtimeComposerProfileStatePortFromStructuredSessionState(state);
  }),
);
