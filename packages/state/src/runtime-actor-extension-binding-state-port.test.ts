import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeActorExtensionBindingStatePort,
  type ExtensionId,
  type SurfacePiSessionId,
  type ThreadId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { layerRuntimeActorExtensionBindingStatePort } from "./index";
import { layerStructuredSessionState, StructuredSessionState } from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_actor_extension_binding",
  cwd: "/tmp/svvy-runtime-actor-extension-binding",
  label: "Runtime actor extension binding",
};

const workspaceSessionId = "session-runtime-actor-extension-binding" as WorkspaceSessionId;
const orchestratorSurfacePiSessionId = workspaceSessionId as string as SurfacePiSessionId;

describe("RuntimeActorExtensionBindingStatePort", () => {
  it("updates orchestrator extension bindings through DB-backed session state", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Runtime actor extension binding",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            generatedAgentContextFingerprint: "fingerprint-orchestrator-before",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
            loadedExtensionIds: ["base-common", "shell"],
            availableExtensionIds: ["smithers", "web"],
          });

          const port = yield* RuntimeActorExtensionBindingStatePort;
          const updatedResult = yield* port.updateActorExtensionBinding({
            target: {
              workspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId: orchestratorSurfacePiSessionId,
            },
            extensionId: "smithers" as ExtensionId,
            usage: "loaded",
            reason: "load_extension",
          });
          const updated = updatedResult.value;
          const snapshot = yield* state.getSessionState(workspaceSessionId);

          expect(updated).toMatchObject({
            target: {
              workspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId: orchestratorSurfacePiSessionId,
            },
            loadedExtensionIds: ["base-common", "shell", "smithers"],
            availableExtensionIds: ["web"],
            generatedAgentContextFingerprint: "fingerprint-orchestrator-before",
            updateExtensionContextBeforeNextTurn: true,
          });
          expect(snapshot.pi.loadedExtensionIds).toEqual(["base-common", "shell", "smithers"]);
          expect(snapshot.pi.availableExtensionIds).toEqual(["web"]);
        }).pipe(
          Effect.provide(
            layerRuntimeActorExtensionBindingStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("updates handler extension bindings through DB-backed thread state", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Runtime actor extension binding",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          const turn = yield* state.startTurn({
            sessionId: workspaceSessionId,
            surfacePiSessionId: orchestratorSurfacePiSessionId,
            requestSummary: "Start handler.",
          });
          const thread = yield* state.createThread({
            turnId: turn.id,
            surfacePiSessionId: "surface-handler-runtime-actor-extension-binding",
            title: "Handler binding",
            objective: "Update handler extension binding.",
            loadedExtensionIds: ["base-common", "thread-handling", "smithers"],
            availableExtensionIds: ["web"],
            generatedAgentContextFingerprint: "fingerprint-handler-before",
          });

          const port = yield* RuntimeActorExtensionBindingStatePort;
          const updatedResult = yield* port.updateActorExtensionBinding({
            target: {
              workspaceSessionId,
              surface: "handler",
              surfacePiSessionId: thread.surfacePiSessionId as SurfacePiSessionId,
              threadId: thread.id as ThreadId,
            },
            extensionId: "smithers" as ExtensionId,
            usage: "available",
            reason: "composer-control",
          });
          const updated = updatedResult.value;
          const snapshot = yield* state.getSessionState(workspaceSessionId);
          const storedThread = snapshot.threads.find((candidate) => candidate.id === thread.id);

          expect(updated).toMatchObject({
            loadedExtensionIds: ["base-common", "thread-handling"],
            availableExtensionIds: ["smithers", "web"],
            generatedAgentContextFingerprint: "fingerprint-handler-before",
            updateExtensionContextBeforeNextTurn: true,
          });
          expect(storedThread?.loadedExtensionIds).toEqual(["base-common", "thread-handling"]);
          expect(storedThread?.availableExtensionIds).toEqual(["smithers", "web"]);
        }).pipe(
          Effect.provide(
            layerRuntimeActorExtensionBindingStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("sets actor extension binding arrays without requiring a single extension transition", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Runtime actor extension binding",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            generatedAgentContextFingerprint: "fingerprint-orchestrator-before",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
            loadedExtensionIds: ["base-common"],
            availableExtensionIds: [],
          });

          const port = yield* RuntimeActorExtensionBindingStatePort;
          const updatedResult = yield* port.setActorExtensionBinding({
            target: {
              workspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId: orchestratorSurfacePiSessionId,
            },
            loadedExtensionIds: ["base-common" as ExtensionId, "notes" as ExtensionId],
            availableExtensionIds: ["smithers" as ExtensionId],
            reason: "load_extension",
          });
          const updated = updatedResult.value;
          const snapshot = yield* state.getSessionState(workspaceSessionId);

          expect(updated).toMatchObject({
            loadedExtensionIds: ["base-common", "notes"],
            availableExtensionIds: ["smithers"],
            generatedAgentContextFingerprint: "fingerprint-orchestrator-before",
          });
          expect(snapshot.pi.loadedExtensionIds).toEqual(["base-common", "notes"]);
          expect(snapshot.pi.availableExtensionIds).toEqual(["smithers"]);
        }).pipe(
          Effect.provide(
            layerRuntimeActorExtensionBindingStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });
});
