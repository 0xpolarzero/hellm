import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeExtensionContextImpactStatePort,
  type AgentProfileId,
  type ExtensionId,
  type SurfacePiSessionId,
  type WorkspaceId,
} from "@svvy/core";
import {
  layerRuntimeExtensionContextImpactStatePort,
  runtimeExtensionContextImpactStateFacadeFromStore,
} from "./runtime-extension-context-impact-state-port";
import {
  createStructuredSessionStateStore,
  layerStructuredSessionState,
  StructuredSessionState,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_extension_context_impact",
  cwd: "/tmp/svvy-runtime-extension-context-impact",
  label: "Runtime extension context impact",
};
const workspaceId = workspace.id as WorkspaceId;

const sessionA = "session-a" as SurfacePiSessionId;
const sessionB = "session-b" as SurfacePiSessionId;
const threadA = "thread-a" as SurfacePiSessionId;
const profileA = "profile-a" as AgentProfileId;
const profileB = "profile-b" as AgentProfileId;

describe("RuntimeExtensionContextImpactStatePort", () => {
  it("lists affected surfaces and applies snapshot cleanup through the synchronous facade", () => {
    const store = createStructuredSessionStateStore({ workspace });
    try {
      seedExtensionContextImpactState(store);
      const facade = runtimeExtensionContextImpactStateFacadeFromStore(store);

      expect(
        facade.listUsageContextAffectedSurfaces({
          agentProfile: "default-orchestrator",
          profileId: profileA,
        }),
      ).toEqual([
        {
          surfacePiSessionId: sessionA,
          kind: "extension_context_changed",
          label: "Extensions changed",
          reason: "extension_usage_changed",
        },
      ]);
      expect(
        facade.listUsageContextAffectedSurfaces({
          agentProfile: "threadHandler",
          profileId: "threadHandler" as AgentProfileId,
        }),
      ).toEqual([
        {
          surfacePiSessionId: threadA,
          kind: "extension_context_changed",
          label: "Extensions changed",
          reason: "extension_usage_changed",
        },
      ]);

      const affected = facade.applySnapshotContextImpact({
        affectedExtensionIds: ["notes" as ExtensionId],
        affectedUsageProfiles: ["orchestrator:profile-b"],
        removedUserExtensionIds: ["scratch" as ExtensionId],
      });

      expect(affected).toEqual([
        {
          surfacePiSessionId: sessionA,
          kind: "extension_context_changed",
          label: "Extensions changed",
          reason: "snapshot_loaded",
        },
        {
          surfacePiSessionId: threadA,
          kind: "extension_context_changed",
          label: "Extensions changed",
          reason: "snapshot_loaded",
        },
        {
          surfacePiSessionId: sessionB,
          kind: "extension_context_changed",
          label: "Extensions changed",
          reason: "snapshot_loaded",
        },
      ]);
      const snapshotA = store.getSessionState("session-a");
      expect(snapshotA.pi.loadedExtensionIds).toEqual(["notes"]);
      expect(snapshotA.pi.availableExtensionIds).toEqual(["linear"]);
      expect(snapshotA.threads[0]?.loadedExtensionIds).toEqual([]);
      expect(snapshotA.threads[0]?.availableExtensionIds).toEqual(["notes"]);
      const snapshotB = store.getSessionState("session-b");
      expect(snapshotB.pi.loadedExtensionIds).toEqual(["base-common"]);
      expect(snapshotB.pi.availableExtensionIds).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("provides the Effect service through the package layer", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* seedExtensionContextImpactStateEffect(state);

          const port = yield* RuntimeExtensionContextImpactStatePort;
          const result = yield* port.applySnapshotContextImpact({
            affectedExtensionIds: ["notes" as ExtensionId],
            affectedUsageProfiles: ["handler:threadHandler"],
            removedUserExtensionIds: ["scratch" as ExtensionId],
          });
          const affected = result.value;
          const session = yield* state.getSessionState("session-a");

          expect(affected.map((surface) => String(surface.surfacePiSessionId))).toEqual([
            "session-a",
            "thread-a",
          ]);
          expect(result.afterCommit).toEqual([
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "surface", ids: ["session-a" as SurfacePiSessionId] },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "sessionNavigation" },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "surface", ids: ["thread-a" as SurfacePiSessionId] },
            },
          ]);
          expect(session.pi.loadedExtensionIds).toEqual(["notes"]);
          expect(session.threads[0]?.loadedExtensionIds).toEqual([]);
        }).pipe(
          Effect.provide(
            layerRuntimeExtensionContextImpactStatePort.pipe(
              Layer.provideMerge(layerStructuredSessionState({ workspace })),
            ),
          ),
        ),
      ),
    );
  });
});

function seedExtensionContextImpactState(
  store: ReturnType<typeof createStructuredSessionStateStore>,
) {
  store.upsertPiSession({
    sessionId: "session-a",
    title: "Session A",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "high",
    orchestratorAgentProfileId: profileA,
    loadedExtensionIds: ["notes", "scratch"],
    availableExtensionIds: ["linear", "scratch"],
    messageCount: 0,
    status: "idle",
    createdAt: "2026-04-18T08:55:00.000Z",
    updatedAt: "2026-04-18T08:56:00.000Z",
  });
  store.upsertPiSession({
    sessionId: "session-b",
    title: "Session B",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "high",
    orchestratorAgentProfileId: profileB,
    loadedExtensionIds: ["base-common"],
    availableExtensionIds: [],
    messageCount: 0,
    status: "idle",
    createdAt: "2026-04-18T08:55:00.000Z",
    updatedAt: "2026-04-18T08:56:00.000Z",
  });
  const turn = store.startTurn({
    sessionId: "session-a",
    surfacePiSessionId: sessionA,
    requestSummary: "Start handler.",
  });
  const thread = store.createThread({
    turnId: turn.id,
    surfacePiSessionId: threadA,
    title: "Thread A",
    objective: "Handle extension context impact.",
    loadedExtensionIds: ["scratch"],
    availableExtensionIds: ["notes", "scratch"],
  });
  store.updateThread({
    threadId: thread.id,
    loadedExtensionIds: ["scratch"],
    availableExtensionIds: ["notes", "scratch"],
  });
}

function seedExtensionContextImpactStateEffect(state: StructuredSessionState["Service"]) {
  return Effect.gen(function* () {
    yield* state.upsertPiSession({
      sessionId: "session-a",
      title: "Session A",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "high",
      orchestratorAgentProfileId: profileA,
      loadedExtensionIds: ["notes", "scratch"],
      availableExtensionIds: ["linear", "scratch"],
      messageCount: 0,
      status: "idle",
      createdAt: "2026-04-18T08:55:00.000Z",
      updatedAt: "2026-04-18T08:56:00.000Z",
    });
    yield* state.upsertPiSession({
      sessionId: "session-b",
      title: "Session B",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "high",
      orchestratorAgentProfileId: profileB,
      loadedExtensionIds: ["base-common"],
      availableExtensionIds: [],
      messageCount: 0,
      status: "idle",
      createdAt: "2026-04-18T08:55:00.000Z",
      updatedAt: "2026-04-18T08:56:00.000Z",
    });
    const turn = yield* state.startTurn({
      sessionId: "session-a",
      surfacePiSessionId: sessionA,
      requestSummary: "Start handler.",
    });
    const thread = yield* state.createThread({
      turnId: turn.id,
      surfacePiSessionId: threadA,
      title: "Thread A",
      objective: "Handle extension context impact.",
      loadedExtensionIds: ["scratch"],
      availableExtensionIds: ["notes", "scratch"],
    });
    yield* state.updateThread({
      threadId: thread.id,
      loadedExtensionIds: ["scratch"],
      availableExtensionIds: ["notes", "scratch"],
    });
  });
}
