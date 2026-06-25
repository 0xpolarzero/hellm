import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeActorExtensionBindingStatePort,
  StateContractError,
  type ExtensionId,
  type RuntimeActorExtensionBindingRecord,
  type RuntimeActorExtensionBindingStatePortService,
  type UpdateActorExtensionBindingRequest,
} from "@svvy/core";
import { getStructuredThread } from "./structured-session-selectors";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { mutationResult, surfaceAndSessionNavigationInvalidations } from "./state-mutation-result";

export function runtimeActorExtensionBindingStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeActorExtensionBindingStatePortService {
  return {
    updateActorExtensionBinding: (input) =>
      Effect.gen(function* () {
        const snapshot = yield* state.getSessionState(input.target.workspaceSessionId);
        if (input.target.surface === "orchestrator") {
          if (snapshot.session.orchestratorPiSessionId !== input.target.surfacePiSessionId) {
            return yield* Effect.fail(
              new StateContractError({
                operation: "runtime-actor-extension-binding.update",
                reason: "not-found",
                message: `Orchestrator surface ${input.target.surfacePiSessionId} was not found for session ${input.target.workspaceSessionId}.`,
              }),
            );
          }
          if (
            input.usage === "loaded" &&
            !(snapshot.pi.availableExtensionIds ?? []).includes(input.extensionId) &&
            !(snapshot.pi.loadedExtensionIds ?? []).includes(input.extensionId)
          ) {
            return yield* Effect.fail(extensionNotAvailableError(input.extensionId));
          }
          const next = applyExtensionUsage({
            loadedExtensionIds: toExtensionIds(snapshot.pi.loadedExtensionIds ?? []),
            availableExtensionIds: toExtensionIds(snapshot.pi.availableExtensionIds ?? []),
            extensionId: input.extensionId,
            usage: input.usage,
          });
          const updated = yield* state.updatePiSessionExtensionState({
            sessionId: input.target.workspaceSessionId,
            loadedExtensionIds: [...next.loadedExtensionIds],
            availableExtensionIds: [...next.availableExtensionIds],
          });
          const binding = {
            target: input.target,
            loadedExtensionIds: toExtensionIds(updated.loadedExtensionIds ?? []),
            availableExtensionIds: toExtensionIds(updated.availableExtensionIds ?? []),
            generatedAgentContextFingerprint: updated.generatedAgentContextFingerprint ?? null,
            updateExtensionContextBeforeNextTurn:
              updated.updateExtensionContextBeforeNextTurn ?? true,
          } satisfies RuntimeActorExtensionBindingRecord;
          return mutationResult(
            binding,
            surfaceAndSessionNavigationInvalidations(
              state.workspaceId,
              input.target.surfacePiSessionId,
            ),
          );
        }

        const thread = getStructuredThread(snapshot, input.target.threadId);
        if (!thread || thread.surfacePiSessionId !== input.target.surfacePiSessionId) {
          return yield* Effect.fail(
            new StateContractError({
              operation: "runtime-actor-extension-binding.update",
              reason: "not-found",
              message: `Handler thread ${input.target.threadId} was not found for surface ${input.target.surfacePiSessionId}.`,
            }),
          );
        }
        if (
          input.usage === "loaded" &&
          !thread.availableExtensionIds.includes(input.extensionId) &&
          !thread.loadedExtensionIds.includes(input.extensionId)
        ) {
          return yield* Effect.fail(extensionNotAvailableError(input.extensionId));
        }
        const next = applyExtensionUsage({
          loadedExtensionIds: toExtensionIds(thread.loadedExtensionIds),
          availableExtensionIds: toExtensionIds(thread.availableExtensionIds),
          extensionId: input.extensionId,
          usage: input.usage,
        });
        const updated = yield* state.updateThread({
          threadId: input.target.threadId,
          loadedExtensionIds: [...next.loadedExtensionIds],
          availableExtensionIds: [...next.availableExtensionIds],
        });
        const binding = {
          target: input.target,
          loadedExtensionIds: toExtensionIds(updated.loadedExtensionIds),
          availableExtensionIds: toExtensionIds(updated.availableExtensionIds),
          generatedAgentContextFingerprint: updated.generatedAgentContextFingerprint ?? null,
          updateExtensionContextBeforeNextTurn: updated.updateExtensionContextBeforeNextTurn,
        } satisfies RuntimeActorExtensionBindingRecord;
        return mutationResult(
          binding,
          surfaceAndSessionNavigationInvalidations(
            state.workspaceId,
            input.target.surfacePiSessionId,
          ),
        );
      }),
    setActorExtensionBinding: (input) =>
      Effect.gen(function* () {
        const snapshot = yield* state.getSessionState(input.target.workspaceSessionId);
        if (input.target.surface === "orchestrator") {
          if (snapshot.session.orchestratorPiSessionId !== input.target.surfacePiSessionId) {
            return yield* Effect.fail(
              new StateContractError({
                operation: "runtime-actor-extension-binding.set",
                reason: "not-found",
                message: `Orchestrator surface ${input.target.surfacePiSessionId} was not found for session ${input.target.workspaceSessionId}.`,
              }),
            );
          }
          const updated = yield* state.updatePiSessionExtensionState({
            sessionId: input.target.workspaceSessionId,
            loadedExtensionIds: [...input.loadedExtensionIds],
            availableExtensionIds: [...input.availableExtensionIds],
          });
          const binding = {
            target: input.target,
            loadedExtensionIds: toExtensionIds(updated.loadedExtensionIds ?? []),
            availableExtensionIds: toExtensionIds(updated.availableExtensionIds ?? []),
            generatedAgentContextFingerprint: updated.generatedAgentContextFingerprint ?? null,
            updateExtensionContextBeforeNextTurn:
              updated.updateExtensionContextBeforeNextTurn ?? true,
          } satisfies RuntimeActorExtensionBindingRecord;
          return mutationResult(
            binding,
            surfaceAndSessionNavigationInvalidations(
              state.workspaceId,
              input.target.surfacePiSessionId,
            ),
          );
        }

        const thread = getStructuredThread(snapshot, input.target.threadId);
        if (!thread || thread.surfacePiSessionId !== input.target.surfacePiSessionId) {
          return yield* Effect.fail(
            new StateContractError({
              operation: "runtime-actor-extension-binding.set",
              reason: "not-found",
              message: `Handler thread ${input.target.threadId} was not found for surface ${input.target.surfacePiSessionId}.`,
            }),
          );
        }
        const updated = yield* state.updateThread({
          threadId: input.target.threadId,
          loadedExtensionIds: [...input.loadedExtensionIds],
          availableExtensionIds: [...input.availableExtensionIds],
        });
        const binding = {
          target: input.target,
          loadedExtensionIds: toExtensionIds(updated.loadedExtensionIds),
          availableExtensionIds: toExtensionIds(updated.availableExtensionIds),
          generatedAgentContextFingerprint: updated.generatedAgentContextFingerprint ?? null,
          updateExtensionContextBeforeNextTurn: updated.updateExtensionContextBeforeNextTurn,
        } satisfies RuntimeActorExtensionBindingRecord;
        return mutationResult(
          binding,
          surfaceAndSessionNavigationInvalidations(
            state.workspaceId,
            input.target.surfacePiSessionId,
          ),
        );
      }),
  };
}

export function runtimeActorExtensionBindingStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeActorExtensionBindingStatePortService {
  return runtimeActorExtensionBindingStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeRuntimeActorExtensionBindingStatePort = Effect.fn(
  "@svvy/state/makeRuntimeActorExtensionBindingStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return runtimeActorExtensionBindingStatePortFromStructuredSessionState(state);
});

export const layerRuntimeActorExtensionBindingStatePort = Layer.effect(
  RuntimeActorExtensionBindingStatePort,
  makeRuntimeActorExtensionBindingStatePort(),
);

function applyExtensionUsage(input: {
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  extensionId: ExtensionId;
  usage: UpdateActorExtensionBindingRequest["usage"];
}): {
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
} {
  const loaded = new Set<ExtensionId>(input.loadedExtensionIds);
  const available = new Set<ExtensionId>(input.availableExtensionIds);
  if (input.usage === "loaded") {
    loaded.add(input.extensionId);
    available.delete(input.extensionId);
  } else if (input.usage === "available") {
    loaded.delete(input.extensionId);
    available.add(input.extensionId);
  } else {
    loaded.delete(input.extensionId);
    available.delete(input.extensionId);
  }
  return {
    loadedExtensionIds: [...loaded].toSorted(),
    availableExtensionIds: [...available].toSorted(),
  };
}

function toExtensionIds(values: readonly string[]): readonly ExtensionId[] {
  return values.map((value) => value as ExtensionId);
}

function extensionNotAvailableError(extensionId: ExtensionId): StateContractError {
  return new StateContractError({
    operation: "runtime-actor-extension-binding.update",
    reason: "invalid-input",
    message: `Extension is not available to load for this actor: ${extensionId}.`,
  });
}
