import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimePromptDefaultsStatePort,
  StateContractError,
  type RuntimePromptDefaultsRecord,
  type RuntimePromptDefaultsStatePortService,
} from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { mutationResult, surfaceAndSessionNavigationInvalidations } from "./state-mutation-result";

function isRuntimePromptDefaultsRecord(value: unknown): value is RuntimePromptDefaultsRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as {
    readonly provider?: unknown;
    readonly model?: unknown;
    readonly reasoningEffort?: unknown;
  };
  return (
    typeof record.provider === "string" &&
    record.provider.length > 0 &&
    typeof record.model === "string" &&
    record.model.length > 0 &&
    (record.reasoningEffort === "off" ||
      record.reasoningEffort === "minimal" ||
      record.reasoningEffort === "low" ||
      record.reasoningEffort === "medium" ||
      record.reasoningEffort === "high" ||
      record.reasoningEffort === "xhigh")
  );
}

function promptDefaultsStateError(
  reason: "invalid-input" | "not-found",
  message: string,
  cause?: unknown,
) {
  return new StateContractError({
    operation: "runtime-prompt-defaults.resolve",
    reason,
    message,
    cause,
  });
}

function parseThreadPromptDefaults(
  threadId: string,
  agentProfileJson: string | null | undefined,
): Effect.Effect<RuntimePromptDefaultsRecord, StateContractError> {
  if (!agentProfileJson) {
    return Effect.fail(
      promptDefaultsStateError(
        "not-found",
        `Handler thread ${threadId} does not have durable prompt defaults.`,
      ),
    );
  }
  return Effect.try({
    try: () => JSON.parse(agentProfileJson) as unknown,
    catch: (cause) =>
      promptDefaultsStateError(
        "invalid-input",
        `Handler thread ${threadId} prompt defaults could not be decoded.`,
        cause,
      ),
  }).pipe(
    Effect.flatMap((parsed) =>
      isRuntimePromptDefaultsRecord(parsed)
        ? Effect.succeed(parsed)
        : Effect.fail(
            promptDefaultsStateError(
              "invalid-input",
              `Handler thread ${threadId} prompt defaults are incomplete.`,
            ),
          ),
    ),
  );
}

export function runtimePromptDefaultsStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimePromptDefaultsStatePortService {
  return {
    resolvePromptDefaults: (input) =>
      Effect.gen(function* () {
        if (input.target.surface === "orchestrator") {
          const snapshot = yield* state.getSessionState(input.target.workspaceSessionId);
          if (snapshot.session.orchestratorPiSessionId !== input.target.surfacePiSessionId) {
            return yield* Effect.fail(
              promptDefaultsStateError(
                "not-found",
                `Orchestrator surface ${input.target.surfacePiSessionId} was not found for session ${input.target.workspaceSessionId}.`,
              ),
            );
          }
          const defaults = {
            provider: snapshot.pi.provider,
            model: snapshot.pi.model,
            reasoningEffort: snapshot.pi.reasoningEffort,
          };
          if (isRuntimePromptDefaultsRecord(defaults)) {
            return defaults;
          }
          return yield* Effect.fail(
            promptDefaultsStateError(
              "not-found",
              `Orchestrator surface ${input.target.surfacePiSessionId} does not have durable prompt defaults.`,
            ),
          );
        }

        const target = input.target;
        const detail = yield* state.getThreadDetail(target.threadId);
        if (
          detail.thread.sessionId !== target.workspaceSessionId ||
          detail.thread.surfacePiSessionId !== target.surfacePiSessionId
        ) {
          return yield* Effect.fail(
            promptDefaultsStateError(
              "invalid-input",
              `Handler thread ${target.threadId} does not match target surface ${target.surfacePiSessionId}.`,
            ),
          );
        }
        return yield* parseThreadPromptDefaults(
          input.target.threadId,
          detail.thread.agentProfileJson,
        );
      }),
    updatePromptDefaults: (input) =>
      Effect.gen(function* () {
        const defaults = {
          provider: input.provider,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
        } satisfies RuntimePromptDefaultsRecord;
        if (input.target.surface === "orchestrator") {
          const snapshot = yield* state.getSessionState(input.target.workspaceSessionId);
          if (snapshot.session.orchestratorPiSessionId !== input.target.surfacePiSessionId) {
            return yield* Effect.fail(
              promptDefaultsStateError(
                "not-found",
                `Orchestrator surface ${input.target.surfacePiSessionId} was not found for session ${input.target.workspaceSessionId}.`,
              ),
            );
          }
          yield* state.upsertPiSession({
            ...snapshot.pi,
            ...defaults,
            updatedAt: yield* state.getCurrentTimestamp(),
          });
          return mutationResult(
            defaults,
            surfaceAndSessionNavigationInvalidations(
              state.workspaceId,
              input.target.surfacePiSessionId,
            ),
          );
        }

        const target = input.target;
        const detail = yield* state.getThreadDetail(target.threadId);
        if (
          detail.thread.sessionId !== target.workspaceSessionId ||
          detail.thread.surfacePiSessionId !== target.surfacePiSessionId
        ) {
          return yield* Effect.fail(
            promptDefaultsStateError(
              "not-found",
              `Handler thread ${target.threadId} does not match target surface ${target.surfacePiSessionId}.`,
            ),
          );
        }
        let profile: Record<string, unknown> = {};
        if (detail.thread.agentProfileJson) {
          const parsed = yield* Effect.try({
            try: () => JSON.parse(detail.thread.agentProfileJson ?? "{}") as unknown,
            catch: (cause) =>
              promptDefaultsStateError(
                "invalid-input",
                `Handler thread ${target.threadId} prompt defaults could not be decoded.`,
                cause,
              ),
          });
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            profile = parsed as Record<string, unknown>;
          }
        }
        yield* state.updateThread({
          threadId: target.threadId,
          agentProfileJson: JSON.stringify({ ...profile, ...defaults }),
        });
        return mutationResult(
          defaults,
          surfaceAndSessionNavigationInvalidations(state.workspaceId, target.surfacePiSessionId),
        );
      }),
  };
}

export function runtimePromptDefaultsStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimePromptDefaultsStatePortService {
  return runtimePromptDefaultsStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeRuntimePromptDefaultsStatePort = Effect.fn(
  "@svvy/state/makeRuntimePromptDefaultsStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return runtimePromptDefaultsStatePortFromStructuredSessionState(state);
});

export const layerRuntimePromptDefaultsStatePort = Layer.effect(
  RuntimePromptDefaultsStatePort,
  makeRuntimePromptDefaultsStatePort(),
);
