import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeWorkflowTaskStatePort,
  type RuntimeWorkflowTaskAgentStartReceipt,
  type RuntimeWorkflowTaskAgentTerminalReceipt,
  type RuntimeWorkflowTaskStatePortService,
} from "@svvy/core";
import {
  agentsInvalidation,
  dedupeInvalidations,
  mutationResult,
  sessionNavigationInvalidation,
  surfaceAndSessionNavigationInvalidations,
  workflowTaskAttemptInspectorInvalidation,
} from "./state-mutation-result";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

export function runtimeWorkflowTaskStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeWorkflowTaskStatePortService {
  return {
    acceptWorkflowTaskAgentStart: (input) =>
      state
        .acceptWorkflowTaskAgentStart(input)
        .pipe(
          Effect.map((receipt) =>
            mutationResult(
              receipt as RuntimeWorkflowTaskAgentStartReceipt,
              dedupeInvalidations([
                ...surfaceAndSessionNavigationInvalidations(
                  state.workspaceId,
                  receipt.target.surfacePiSessionId,
                ),
                workflowTaskAttemptInspectorInvalidation(
                  state.workspaceId,
                  receipt.target.workflowTaskAttemptId,
                ),
                agentsInvalidation(),
              ]),
            ),
          ),
        ),
    getWorkflowTaskAgentAttemptTerminal: (input) =>
      state
        .getWorkflowTaskAgentAttemptTerminal(input)
        .pipe(Effect.map((receipt) => receipt as RuntimeWorkflowTaskAgentTerminalReceipt | null)),
    settleWorkflowTaskAgentAttempt: (input) =>
      state
        .settleWorkflowTaskAgentAttempt(input)
        .pipe(
          Effect.map((receipt) =>
            mutationResult(receipt as RuntimeWorkflowTaskAgentTerminalReceipt, [
              workflowTaskAttemptInspectorInvalidation(
                state.workspaceId,
                input.workflowTaskAttemptId,
              ),
              sessionNavigationInvalidation(state.workspaceId),
            ]),
          ),
        ),
  };
}

export function runtimeWorkflowTaskStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeWorkflowTaskStatePortService {
  return runtimeWorkflowTaskStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeRuntimeWorkflowTaskStatePort = Effect.fn(
  "@svvy/state/makeRuntimeWorkflowTaskStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return runtimeWorkflowTaskStatePortFromStructuredSessionState(state);
});

export const layerRuntimeWorkflowTaskStatePort = Layer.effect(
  RuntimeWorkflowTaskStatePort,
  makeRuntimeWorkflowTaskStatePort(),
);
