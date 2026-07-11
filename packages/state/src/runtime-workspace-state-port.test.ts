import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeWorkspaceStatePort,
  StateContractError,
  type AbsolutePath,
  type RuntimeOwnerId,
  type WorkspaceId,
} from "@svvy/core";
import { layerRuntimeWorkspaceStatePort } from "./index";
import { runtimeWorkspaceStatePortFromStore } from "./structured-session-adapters";
import {
  createStructuredSessionStateStore,
  layerStructuredSessionState,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_workspace_state_port",
  cwd: "/tmp/svvy-runtime-workspace-state-port",
  label: "Runtime workspace state port",
};
const workspaceId = workspace.id as WorkspaceId;
const workspaceCwd = workspace.cwd as AbsolutePath;

describe("RuntimeWorkspaceStatePort", () => {
  it("acquires and releases scoped workspace owners", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = runtimeWorkspaceStatePortFromStore(store);
    const owner = { ownerId: "owner-desktop" as RuntimeOwnerId, kind: "desktop-tab" as const };

    const first = await runTestEffect(
      port.acquireWorkspace({
        cwd: workspaceCwd,
        owner,
        openReason: "user-open",
      }),
    );
    const second = await runTestEffect(
      port.acquireWorkspace({
        cwd: workspaceCwd,
        owner,
        openReason: "restore",
      }),
    );
    const released = await runTestEffect(
      port.releaseWorkspace({
        workspaceId,
        owner,
        releaseReason: "tab-closed",
      }),
    );

    expect(first.value).toMatchObject({
      workspaceId: workspace.id,
      cwd: workspace.cwd,
      kind: "user",
      acquired: "created",
      readiness: "ready",
      readinessDetail: { mode: "full" },
    });
    expect(second.value.acquired).toBe("existing");
    expect(second.value.stateRevision).toBeGreaterThan(first.value.stateRevision);
    expect(first.afterCommit).toEqual([
      {
        scope: "workspace",
        workspaceId,
        invalidation: { model: "sessionNavigation" },
      },
      {
        scope: "workspace",
        workspaceId,
        invalidation: { model: "workspaceLayout", ids: ["A", "B", "C"] },
      },
    ]);
    expect(released.value).toEqual({
      workspaceId,
      released: true,
      remainingOwners: 0,
      lifecycle: "idle",
    });
    store.close();
  });

  it("rejects acquire requests for a different cwd", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = runtimeWorkspaceStatePortFromStore(store);
    await expect(
      runTestEffect(
        port.acquireWorkspace({
          cwd: "/tmp/other-workspace" as AbsolutePath,
          owner: { ownerId: "owner-headless" as RuntimeOwnerId, kind: "headless" },
          openReason: "headless",
        }),
      ),
    ).rejects.toBeInstanceOf(StateContractError);
    store.close();
  });

  it("exposes default workspace acquire through a layer", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const port = yield* RuntimeWorkspaceStatePort;
          const result = yield* port.acquireDefaultWorkspace({
            owner: { ownerId: "owner-default" as RuntimeOwnerId, kind: "test" },
            openReason: "test",
          });
          expect(result.value).toMatchObject({
            workspaceId: workspace.id,
            kind: "default",
            acquired: "created",
          });
        }).pipe(
          Effect.provide(
            layerRuntimeWorkspaceStatePort.pipe(
              Layer.provideMerge(layerStructuredSessionState({ workspace })),
            ),
          ),
        ),
      ),
    );
  });
});
