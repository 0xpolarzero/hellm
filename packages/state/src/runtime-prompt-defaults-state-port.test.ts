import { describe, expect, it } from "bun:test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import {
  RuntimePromptDefaultsStatePort,
  type CommandId,
  type SurfacePiSessionId,
  type ThreadId,
  type TurnId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { runTestEffect } from "./effect.test-support";
import {
  runtimePromptDefaultsStatePortFromStore,
  layerRuntimePromptDefaultsStatePort,
} from "./runtime-prompt-defaults-state-port";
import {
  createStructuredSessionStateStore,
  layerStructuredSessionState,
  StructuredSessionState,
  type StructuredSessionStateStore,
} from "./structured-session-state";

const workspace = {
  id: "workspace_runtime_prompt_defaults_state_port",
  cwd: "/tmp/svvy-runtime-prompt-defaults-state-port",
  label: "Runtime prompt defaults state port",
};

describe("RuntimePromptDefaultsStatePort", () => {
  it("resolves durable orchestrator prompt defaults", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    try {
      seedOrchestrator(store);
      const port = runtimePromptDefaultsStatePortFromStore(store);

      const defaults = await runTestEffect(
        port.resolvePromptDefaults({
          target: {
            workspaceSessionId: "session-prompt-defaults" as WorkspaceSessionId,
            surface: "orchestrator",
            surfacePiSessionId: "session-prompt-defaults" as SurfacePiSessionId,
          },
        }),
      );

      expect(defaults).toEqual({
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "high",
      });
    } finally {
      store.close();
    }
  });

  it("resolves durable handler thread prompt defaults", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    try {
      seedOrchestrator(store);
      const threadId = seedHandlerThread(store, {
        provider: "anthropic",
        model: "claude-sonnet-4",
        reasoningEffort: "medium",
      });
      const port = runtimePromptDefaultsStatePortFromStore(store);

      const defaults = await runTestEffect(
        port.resolvePromptDefaults({
          target: {
            workspaceSessionId: "session-prompt-defaults" as WorkspaceSessionId,
            surface: "handler",
            surfacePiSessionId: "surface-prompt-defaults-handler" as SurfacePiSessionId,
            threadId,
          },
        }),
      );

      expect(defaults).toEqual({
        provider: "anthropic",
        model: "claude-sonnet-4",
        reasoningEffort: "medium",
      });
    } finally {
      store.close();
    }
  });

  it("fails when durable defaults are incomplete", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    try {
      store.upsertPiSession({
        sessionId: "session-missing-defaults",
        title: "Missing defaults",
        messageCount: 0,
        status: "idle",
        createdAt: "2026-06-28T12:00:00.000Z",
        updatedAt: "2026-06-28T12:00:00.000Z",
      });
      const port = runtimePromptDefaultsStatePortFromStore(store);

      const exit = await runTestEffect(
        Effect.exit(
          port.resolvePromptDefaults({
            target: {
              workspaceSessionId: "session-missing-defaults" as WorkspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId: "session-missing-defaults" as SurfacePiSessionId,
            },
          }),
        ),
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(failure?._tag).toBe("StateContractError");
        expect(failure?.operation).toBe("runtime-prompt-defaults.resolve");
        expect(failure?.reason).toBe("not-found");
      }
    } finally {
      store.close();
    }
  });

  it("provides the Effect service through the package layer", async () => {
    const result = await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: "session-layer-prompt-defaults",
            title: "Layer prompt defaults",
            provider: "openai",
            model: "gpt-5.4-mini",
            reasoningEffort: "low",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-06-28T12:00:00.000Z",
            updatedAt: "2026-06-28T12:00:00.000Z",
          });
          const port = yield* RuntimePromptDefaultsStatePort;
          return yield* port.resolvePromptDefaults({
            target: {
              workspaceSessionId: "session-layer-prompt-defaults" as WorkspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId: "session-layer-prompt-defaults" as SurfacePiSessionId,
            },
          });
        }).pipe(
          Effect.provide(layerRuntimePromptDefaultsStatePort),
          Effect.provide(
            layerStructuredSessionState({
              workspace,
              now: () => "2026-06-28T12:00:00.000Z",
            }),
          ),
        ),
      ),
    );

    expect(result).toEqual({
      provider: "openai",
      model: "gpt-5.4-mini",
      reasoningEffort: "low",
    });
  });
});

function seedOrchestrator(store: StructuredSessionStateStore) {
  store.upsertPiSession({
    sessionId: "session-prompt-defaults",
    title: "Prompt defaults",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "high",
    messageCount: 0,
    status: "idle",
    createdAt: "2026-06-28T12:00:00.000Z",
    updatedAt: "2026-06-28T12:00:00.000Z",
  });
}

function seedHandlerThread(
  store: StructuredSessionStateStore,
  defaults: { provider: string; model: string; reasoningEffort: "low" | "medium" | "high" },
): ThreadId {
  const turn = store.startTurn({
    sessionId: "session-prompt-defaults",
    surfacePiSessionId: "session-prompt-defaults",
    requestSummary: "Start handler.",
  });
  const started = store.startHandlerThreads({
    workspaceSessionId: "session-prompt-defaults" as WorkspaceSessionId,
    orchestratorTurnId: turn.id as TurnId,
    sourceCommandId: "command-prompt-defaults" as CommandId,
    threads: [
      {
        surfacePiSessionId: "surface-prompt-defaults-handler" as SurfacePiSessionId,
        title: "Handler",
        objective: "Handle prompt defaults.",
        historyMode: "isolated",
        worktreeId: null,
        agentProfileJson: JSON.stringify(defaults),
        generatedAgentContextBinding: {
          aggregateCacheKey: "prompt-defaults-handler-cache",
          generatedAgentContextFingerprint: "prompt-defaults-handler-fingerprint",
          generatedAgentContextRevision: 1,
          externalSourceHashes: [],
        },
        initialQueue: {
          idempotencyKey: "prompt-defaults-handler-start",
          priority: "runtime",
        },
      },
    ],
  });
  return started.threads[0]!.thread.id as ThreadId;
}
