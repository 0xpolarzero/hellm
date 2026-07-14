import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeSurfaceLifecycleStatePort,
  StateContractError,
  type CreateRuntimeOrchestratorSurfaceStateInput,
  type SurfacePiSessionId,
  type WorkspaceId,
} from "@svvy/core";
import { layerRuntimeSurfaceLifecycleStatePort } from "./index";
import { runtimeSurfaceLifecycleStatePortFromStore } from "./structured-session-adapters";
import {
  createStructuredSessionStateStore,
  layerStructuredSessionState,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_surface_lifecycle_state_port",
  cwd: "/tmp/svvy-runtime-surface-lifecycle-state-port",
  label: "Runtime surface lifecycle state port",
};
const workspaceId = workspace.id as WorkspaceId;

function createOrchestratorStateInput(title?: string): CreateRuntimeOrchestratorSurfaceStateInput {
  return {
    workspaceId,
    ...(title === undefined ? {} : { title }),
    profileId: "custom-orchestrator" as never,
    provider: "openai" as never,
    model: "gpt-5" as never,
    reasoningEffort: "high",
    loadedExtensionIds: ["extension-loading" as never, "request-user-input" as never],
    availableExtensionIds: ["smithers" as never],
  };
}

describe("RuntimeSurfaceLifecycleStatePort", () => {
  it("creates, opens, and closes orchestrator surfaces", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = runtimeSurfaceLifecycleStatePortFromStore(store);

    const created = await runTestEffect(
      port.createOrchestratorSurface(createOrchestratorStateInput("Runtime lifecycle")),
    );
    const opened = await runTestEffect(
      port.openSurface({
        workspaceId,
        target: created.value.target,
      }),
    );
    const closed = await runTestEffect(
      port.closeSurface({
        workspaceId,
        target: created.value.target,
        closeReason: "pane-closed",
      }),
    );

    expect(created.value).toMatchObject({
      target: {
        workspaceSessionId: created.value.workspaceSessionId,
        surface: "orchestrator",
        surfacePiSessionId: created.value.surfacePiSessionId,
      },
      created: "new",
    });
    expect(store.getSessionState(created.value.workspaceSessionId).pi).toMatchObject({
      provider: "openai",
      model: "gpt-5",
      reasoningEffort: "high",
      orchestratorAgentProfileId: "custom-orchestrator",
      loadedExtensionIds: ["extension-loading", "request-user-input"],
      availableExtensionIds: ["smithers"],
    });
    expect(opened.value).toMatchObject({
      workspaceSessionId: created.value.workspaceSessionId,
      surfacePiSessionId: created.value.surfacePiSessionId,
      target: created.value.target,
    });
    expect(opened.value.stateRevision).toBeGreaterThan(created.value.stateRevision);
    expect(closed.value).toEqual({
      target: created.value.target,
      lifecycle: "idle",
    });
    expect(created.afterCommit).toEqual([
      {
        scope: "workspace",
        workspaceId,
        invalidation: {
          model: "surface",
          ids: [created.value.surfacePiSessionId as SurfacePiSessionId],
        },
      },
      {
        scope: "workspace",
        workspaceId,
        invalidation: { model: "sessionNavigation" },
      },
    ]);
    store.close();
  });

  it("rejects mismatched orchestrator targets", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = runtimeSurfaceLifecycleStatePortFromStore(store);
    const created = await runTestEffect(
      port.createOrchestratorSurface(createOrchestratorStateInput()),
    );

    await expect(
      runTestEffect(
        port.openSurface({
          workspaceId,
          target: {
            ...created.value.target,
            surfacePiSessionId: "surface-other" as SurfacePiSessionId,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(StateContractError);
    store.close();
  });

  it("leaves no partial session or binding facts when atomic creation is rejected", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = runtimeSurfaceLifecycleStatePortFromStore(store);

    await expect(
      runTestEffect(
        port.createOrchestratorSurface({
          ...createOrchestratorStateInput("Rejected atomic create"),
          workspaceId: "workspace-other" as WorkspaceId,
        }),
      ),
    ).rejects.toBeInstanceOf(StateContractError);

    expect(store.listSessionStates()).toEqual([]);
    store.close();
  });

  it("renames, forks, and hard-deletes orchestrator lifecycle state", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = runtimeSurfaceLifecycleStatePortFromStore(store);
    const created = await runTestEffect(
      port.createOrchestratorSurface(createOrchestratorStateInput("Source")),
    );
    const renamed = await runTestEffect(
      port.renameOrchestrator({
        workspaceId,
        workspaceSessionId: created.value.workspaceSessionId,
        title: "Manual title",
      }),
    );
    const forked = await runTestEffect(
      port.forkOrchestrator({
        workspaceId,
        sourceWorkspaceSessionId: created.value.workspaceSessionId,
        targetSurfacePiSessionId: "surface-forked" as SurfacePiSessionId,
        title: "Forked title",
      }),
    );

    expect(renamed.value.title).toBe("Manual title");
    expect(store.getSessionState(forked.value.workspaceSessionId).pi).toMatchObject({
      parentSessionId: created.value.workspaceSessionId,
      title: "Forked title",
    });
    const deleted = await runTestEffect(
      port.deleteOrchestrator({
        workspaceId,
        workspaceSessionId: forked.value.workspaceSessionId,
      }),
    );
    expect(deleted.value.deleted).toBe(true);
    expect(store.isSessionDeleted(forked.value.workspaceSessionId)).toBe(true);
    store.close();
  });

  it("exposes surface lifecycle through a layer", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const port = yield* RuntimeSurfaceLifecycleStatePort;
          const result = yield* port.createOrchestratorSurface(
            createOrchestratorStateInput("Layer surface"),
          );
          expect(result.value.target.surface).toBe("orchestrator");
        }).pipe(
          Effect.provide(
            layerRuntimeSurfaceLifecycleStatePort.pipe(
              Layer.provideMerge(layerStructuredSessionState({ workspace })),
            ),
          ),
        ),
      ),
    );
  });
});
