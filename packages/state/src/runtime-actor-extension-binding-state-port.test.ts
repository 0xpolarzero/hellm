import { describe, expect, it } from "bun:test";
import * as Cause from "effect/Cause";
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
  it("atomically binds the first authoritative orchestrator context", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Unbound orchestrator",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            updateExtensionContextBeforeNextTurn: true,
            loadedExtensionIds: ["base-common"],
            availableExtensionIds: ["shell"],
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          const port = yield* RuntimeActorExtensionBindingStatePort;
          const target = {
            workspaceSessionId,
            surface: "orchestrator" as const,
            surfacePiSessionId: orchestratorSurfacePiSessionId,
          };
          const subject = yield* port.readGeneratedContextBuildSubject({ target });
          expect(subject.loadedExtensionIds as readonly string[]).toEqual(["base-common"]);
          const committed = yield* port.bindGeneratedContext({
            target,
            actorKind: "orchestrator",
            fingerprint: "sha256:first-authoritative-context" as never,
            systemPrompt: "Authoritative first prompt.",
            svvyxGuidance: "",
            commandsDts: "",
            nativeToolSchemasJson: "[]",
            loadedExtensionIds: subject.loadedExtensionIds,
            availableExtensionIds: subject.availableExtensionIds,
            externalSourceHashes: ["sha256:agents"],
          });
          expect(committed.value.systemPrompt).toBe("Authoritative first prompt.");
          expect(committed.value.generatedAgentContextRevision).toBe(1);
          const rebound = yield* port.readRuntimePromptBinding({ target });
          expect(rebound.systemPrompt).toBe("Authoritative first prompt.");
          expect(rebound.updateExtensionContextBeforeNextTurn).toBe(false);
        }).pipe(
          Effect.provide(
            layerRuntimeActorExtensionBindingStatePort.pipe(
              Layer.provideMerge(layerStructuredSessionState({ workspace })),
            ),
          ),
        ),
      ),
    );
  });

  it("reads the orchestrator runtime prompt binding by the session-bound fingerprint", async () => {
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
            generatedAgentContextFingerprint: "fingerprint-orchestrator-bound",
            updateExtensionContextBeforeNextTurn: false,
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
            loadedExtensionIds: ["base-common"],
            availableExtensionIds: ["shell"],
          });
          const persistedBinding = yield* state.upsertGeneratedAgentContextBinding({
            surfacePiSessionId: orchestratorSurfacePiSessionId,
            ownerKind: "session",
            ownerId: workspaceSessionId,
            actorKind: "orchestrator",
            systemPrompt: "Use the orchestrator generated context.",
            svvyxGuidance: "hidden svvyx guidance",
            commandsDts: "hidden commands declarations",
            nativeToolSchemasJson: "[]",
            generatedAgentContextFingerprint: "fingerprint-orchestrator-bound",
            generatedAgentContextRevision: 7,
            loadedExtensionIds: ["base-common", "shell"],
            availableExtensionIds: ["smithers"],
            externalSourceHashes: ["agents-md:sha256-orchestrator"],
          });

          const port = yield* RuntimeActorExtensionBindingStatePort;
          const binding = yield* port.readRuntimePromptBinding({
            target: {
              workspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId: orchestratorSurfacePiSessionId,
            },
          });

          expect(binding.target).toEqual({
            workspaceSessionId,
            surface: "orchestrator",
            surfacePiSessionId: orchestratorSurfacePiSessionId,
          });
          expect(binding.generatedAgentContextBindingId).toBe(persistedBinding.id);
          expect(binding.generatedAgentContextFingerprint as string).toBe(
            "fingerprint-orchestrator-bound",
          );
          expect(binding.generatedAgentContextRevision).toBe(7);
          expect(binding.systemPrompt).toBe("Use the orchestrator generated context.");
          expect(binding.loadedExtensionIds as readonly string[]).toEqual(["base-common", "shell"]);
          expect(binding.availableExtensionIds as readonly string[]).toEqual(["smithers"]);
          expect(binding.externalSourceHashes).toEqual(["agents-md:sha256-orchestrator"]);
          expect(binding.updateExtensionContextBeforeNextTurn).toBe(false);
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

  it("reads the handler runtime prompt binding by the thread-bound fingerprint", async () => {
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
            surfacePiSessionId: "surface-handler-runtime-prompt-binding",
            title: "Handler binding",
            objective: "Read handler runtime prompt binding.",
            loadedExtensionIds: ["base-common", "thread-handling"],
            availableExtensionIds: ["web"],
            generatedAgentContextFingerprint: "fingerprint-handler-bound",
          });
          const persistedBinding = yield* state.upsertGeneratedAgentContextBinding({
            surfacePiSessionId: thread.surfacePiSessionId,
            ownerKind: "thread",
            ownerId: thread.id,
            actorKind: "handler",
            systemPrompt: "Use the handler generated context.",
            svvyxGuidance: "hidden handler svvyx guidance",
            commandsDts: "hidden handler commands declarations",
            nativeToolSchemasJson: "[]",
            generatedAgentContextFingerprint: "fingerprint-handler-bound",
            generatedAgentContextRevision: 11,
            loadedExtensionIds: ["base-common", "thread-handling", "web"],
            availableExtensionIds: ["smithers"],
            externalSourceHashes: ["agents-md:sha256-handler"],
          });

          const port = yield* RuntimeActorExtensionBindingStatePort;
          const binding = yield* port.readRuntimePromptBinding({
            target: {
              workspaceSessionId,
              surface: "handler",
              surfacePiSessionId: thread.surfacePiSessionId as SurfacePiSessionId,
              threadId: thread.id as ThreadId,
            },
          });

          expect(binding.target).toEqual({
            workspaceSessionId,
            surface: "handler",
            surfacePiSessionId: thread.surfacePiSessionId as SurfacePiSessionId,
            threadId: thread.id as ThreadId,
          });
          expect(binding.generatedAgentContextBindingId).toBe(persistedBinding.id);
          expect(binding.generatedAgentContextFingerprint as string).toBe(
            "fingerprint-handler-bound",
          );
          expect(binding.generatedAgentContextRevision).toBe(11);
          expect(binding.systemPrompt).toBe("Use the handler generated context.");
          expect(binding.loadedExtensionIds as readonly string[]).toEqual([
            "base-common",
            "thread-handling",
            "web",
          ]);
          expect(binding.availableExtensionIds as readonly string[]).toEqual(["smithers"]);
          expect(binding.externalSourceHashes).toEqual(["agents-md:sha256-handler"]);
          expect(binding.updateExtensionContextBeforeNextTurn).toBe(true);
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

  it("rejects prompt binding reads when the target has no bound generated context", async () => {
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

          const port = yield* RuntimeActorExtensionBindingStatePort;
          const exit = yield* Effect.exit(
            port.readRuntimePromptBinding({
              target: {
                workspaceSessionId,
                surface: "orchestrator",
                surfacePiSessionId: orchestratorSurfacePiSessionId,
              },
            }),
          );

          expect(exit._tag).toBe("Failure");
          if (exit._tag === "Failure") {
            const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
            expect(failure?._tag).toBe("StateContractError");
            expect(failure?.operation).toBe(
              "runtime-actor-extension-binding.readRuntimePromptBinding",
            );
            expect(failure?.reason).toBe("not-found");
          }
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
