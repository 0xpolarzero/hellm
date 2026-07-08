import { describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import {
  RuntimeActorExtensionBindingStatePort,
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeEpisodeStatePort,
  RuntimeGeneratedPackageStatePort,
  RuntimePromptDefaultsStatePort,
  RuntimeQueueStatePort,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeSourceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeThreadStatePort,
  RuntimeTurnStatePort,
  RuntimeWorkspaceStatePort,
  StateContractError,
  type AbsolutePath,
  type CommandId,
  type GeneratedPackageName,
  type PromptTarget,
  type RuntimeOwnerId,
  type RuntimeSurfaceMessageRecord,
  type StateInvalidationDescriptor,
  type StateMutationResult,
  type SurfacePiSessionId,
  type ThreadGroupId,
  type ThreadId,
  type ToolItemId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import {
  createWorkspaceStateRouter,
  layerWorkspaceStateRouter,
} from "./structured-session-adapters";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

function deterministicClock(start = "2026-05-01T09:00:00.000Z"): () => string {
  let cursor = Date.parse(start);
  return () => {
    const next = new Date(cursor).toISOString();
    cursor += 1_000;
    return next;
  };
}

interface TestStore {
  readonly store: StructuredSessionStateStore;
  readonly cwd: string;
}

function makeStore(
  registry: { stores: StructuredSessionStateStore[]; dirs: string[] },
  id: string,
  label: string,
): TestStore {
  const cwd = mkdtempSync(join(tmpdir(), `svvy-router-${label}-`));
  registry.dirs.push(cwd);
  const store = createStructuredSessionStateStore({
    digest: testDigest,
    idFactory: (prefix: string) => `${prefix}-${randomUUID()}`,
    workspace: { id, label, cwd, artifactDir: join(cwd, "artifact-store") },
    now: deterministicClock(),
  });
  registry.stores.push(store);
  return { store, cwd };
}

function createRegistry() {
  const registry = { stores: [] as StructuredSessionStateStore[], dirs: [] as string[] };
  return {
    registry,
    cleanup: () => {
      while (registry.stores.length > 0) registry.stores.pop()?.close();
      while (registry.dirs.length > 0) {
        const dir = registry.dirs.pop();
        if (dir) rmSync(dir, { force: true, recursive: true });
      }
    },
  };
}

const packageName = "@svvyx/extensions" as GeneratedPackageName;

describe("workspace state router", () => {
  it("dispatches explicit-workspace writes to the owning store and carries committed scope", async () => {
    const { registry, cleanup } = createRegistry();
    const appGlobal = makeStore(registry, "workspace_app_global", "appglobal");
    const workspaceA = makeStore(registry, "workspace_a", "a");
    const workspaceB = makeStore(registry, "workspace_b", "b");
    const router = createWorkspaceStateRouter({
      appGlobalStore: appGlobal.store,
      workspaceStores: [
        { store: workspaceA.store, isDefaultWorkspace: true },
        { store: workspaceB.store },
      ],
    });

    try {
      const surface = await runTestEffect(
        router.surfaceLifecycle.createOrchestratorSurface({
          workspaceId: "workspace_b" as WorkspaceId,
          title: "Routed surface",
        }),
      );

      expect(surface.value.target.surface).toBe("orchestrator");
      for (const descriptor of surface.afterCommit) {
        expect(descriptor.scope).toBe("workspace");
        expect((descriptor as { workspaceId: string }).workspaceId).toBe("workspace_b");
      }

      expect(workspaceB.store.getSessionState(surface.value.workspaceSessionId)).toBeDefined();
      expect(() => workspaceA.store.getSessionState(surface.value.workspaceSessionId)).toThrow();
    } finally {
      cleanup();
    }
  });

  it("routes app-global generated-package writes to the app-global store", async () => {
    const { registry, cleanup } = createRegistry();
    const appGlobal = makeStore(registry, "workspace_app_global", "appglobal");
    const workspaceA = makeStore(registry, "workspace_a", "a");
    const router = createWorkspaceStateRouter({
      appGlobalStore: appGlobal.store,
      workspaceStores: [{ store: workspaceA.store, isDefaultWorkspace: true }],
    });

    try {
      await runTestEffect(
        router.generatedPackage.recordGeneratedPackageBuild({
          status: {
            packageName: "@svvyx/workflows" as GeneratedPackageName,
            action: "written",
            refreshScope: "app-global-build",
            buildId: "generated-package-build-router" as never,
            manifestPath: "/tmp/generated-workflows/package.json" as AbsolutePath,
            sourceFingerprint: "source-fingerprint-router",
            outputFingerprint: "output-fingerprint-router",
            generatedFiles: [],
            dependencies: [],
          },
        }),
      );

      expect(appGlobal.store.readGeneratedPackageFacts().length).toBe(1);
      expect(workspaceA.store.readGeneratedPackageFacts().length).toBe(0);
      const routed = await runTestEffect(router.generatedPackage.readGeneratedPackageFacts());
      expect(routed.length).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("resolves durable ids through committed owner rows across registered stores", async () => {
    const { registry, cleanup } = createRegistry();
    const appGlobal = makeStore(registry, "workspace_app_global", "appglobal");
    const workspaceA = makeStore(registry, "workspace_a", "a");
    const workspaceB = makeStore(registry, "workspace_b", "b");
    const router = createWorkspaceStateRouter({
      appGlobalStore: appGlobal.store,
      workspaceStores: [{ store: workspaceA.store }, { store: workspaceB.store }],
    });

    try {
      const surface = await runTestEffect(
        router.surfaceLifecycle.createOrchestratorSurface({
          workspaceId: "workspace_a" as WorkspaceId,
        }),
      );

      const turn = await runTestEffect(
        router.turn.startTurn({
          sessionId: surface.value.workspaceSessionId,
          surfacePiSessionId: surface.value.surfacePiSessionId,
          requestSummary: "Do the thing.",
        }),
      );
      for (const descriptor of turn.afterCommit) {
        expect((descriptor as { workspaceId?: string }).workspaceId).toBe("workspace_a");
      }

      const decided = await runTestEffect(
        router.turn.setTurnDecision({ turnId: turn.value.id, decision: "reply" }),
      );
      expect(decided.value.id).toBe(turn.value.id);
      expect(
        workspaceA.store
          .listSessionStates()
          .some((snapshot) => snapshot.turns.some((row) => row.id === turn.value.id)),
      ).toBeTrue();
    } finally {
      cleanup();
    }
  });

  it("routes acquireWorkspace by committed cwd", async () => {
    const { registry, cleanup } = createRegistry();
    const appGlobal = makeStore(registry, "workspace_app_global", "appglobal");
    const workspaceA = makeStore(registry, "workspace_a", "a");
    const workspaceB = makeStore(registry, "workspace_b", "b");
    const router = createWorkspaceStateRouter({
      appGlobalStore: appGlobal.store,
      workspaceStores: [{ store: workspaceA.store }, { store: workspaceB.store }],
    });

    try {
      const acquired = await runTestEffect(
        router.workspace.acquireWorkspace({
          cwd: workspaceB.cwd as AbsolutePath,
          owner: { ownerId: "owner-router-test" as RuntimeOwnerId, kind: "test" },
          openReason: "test",
        }),
      );
      expect(acquired.value.workspaceId as string).toBe("workspace_b");
    } finally {
      cleanup();
    }
  });

  it("fails with a typed target-not-found error for unregistered targets", async () => {
    const { registry, cleanup } = createRegistry();
    const appGlobal = makeStore(registry, "workspace_app_global", "appglobal");
    const workspaceA = makeStore(registry, "workspace_a", "a");
    const router = createWorkspaceStateRouter({
      appGlobalStore: appGlobal.store,
      workspaceStores: [{ store: workspaceA.store, isDefaultWorkspace: true }],
    });

    try {
      await expect(
        runTestEffect(
          router.surfaceLifecycle.createOrchestratorSurface({
            workspaceId: "workspace_unregistered" as WorkspaceId,
          }),
        ),
      ).rejects.toMatchObject({
        operation: "workspace-state-router.createOrchestratorSurface",
        reason: "not-found",
      });
      await expect(
        runTestEffect(
          router.surfaceLifecycle.createOrchestratorSurface({
            workspaceId: "workspace_unregistered" as WorkspaceId,
          }),
        ),
      ).rejects.toBeInstanceOf(StateContractError);
      await expect(
        runTestEffect(
          router.turn.setTurnDecision({ turnId: "turn-does-not-exist", decision: "reply" }),
        ),
      ).rejects.toMatchObject({
        operation: "workspace-state-router.setTurnDecision",
        reason: "not-found",
      });
      await expect(
        runTestEffect(router.command.findCommandById({ commandId: "command-does-not-exist" })),
      ).rejects.toMatchObject({
        operation: "workspace-state-router.findCommandById",
        reason: "not-found",
      });
    } finally {
      cleanup();
    }
  });

  it("fans out bare-input reads over every registered workspace store", async () => {
    const { registry, cleanup } = createRegistry();
    const appGlobal = makeStore(registry, "workspace_app_global", "appglobal");
    const workspaceA = makeStore(registry, "workspace_a", "a");
    const workspaceB = makeStore(registry, "workspace_b", "b");
    const router = createWorkspaceStateRouter({
      appGlobalStore: appGlobal.store,
      workspaceStores: [{ store: workspaceA.store }, { store: workspaceB.store }],
    });

    try {
      await runTestEffect(
        router.generatedPackage.recordWorkspaceLinkStatus({
          status: {
            workspaceId: "workspace_a" as WorkspaceId,
            packageName,
            status: "repair-needed",
          },
        }),
      );
      await runTestEffect(
        router.generatedPackage.recordWorkspaceLinkStatus({
          status: {
            workspaceId: "workspace_b" as WorkspaceId,
            packageName,
            status: "repair-needed",
          },
        }),
      );

      const all = await runTestEffect(router.generatedPackage.readLinksNeedingRepair());
      const workspaceIds = all.map((link) => link.workspaceId as string).toSorted();
      expect(workspaceIds).toEqual(["workspace_a", "workspace_b"]);

      const onlyA = await runTestEffect(
        router.generatedPackage.readLinksNeedingRepair({
          workspaceId: "workspace_a" as WorkspaceId,
        }),
      );
      expect(onlyA.length).toBe(1);
      expect(onlyA[0]?.workspaceId as string).toBe("workspace_a");
    } finally {
      cleanup();
    }
  });

  it("dispatches through the exact registered store instance without opening a second connection", async () => {
    const { registry, cleanup } = createRegistry();
    const appGlobal = makeStore(registry, "workspace_app_global", "appglobal");
    const workspaceA = makeStore(registry, "workspace_a", "a");

    let createCalls = 0;
    const nativeCreate = workspaceA.store.createOrchestratorSurface.bind(workspaceA.store);
    workspaceA.store.createOrchestratorSurface = (input) => {
      createCalls += 1;
      return nativeCreate(input);
    };

    const router = createWorkspaceStateRouter({
      appGlobalStore: appGlobal.store,
      workspaceStores: [{ store: workspaceA.store, isDefaultWorkspace: true }],
    });

    try {
      const surface = await runTestEffect(
        router.surfaceLifecycle.createOrchestratorSurface({
          workspaceId: "workspace_a" as WorkspaceId,
        }),
      );

      expect(createCalls).toBe(1);
      expect(workspaceA.store.getSessionState(surface.value.workspaceSessionId)).toBeDefined();
    } finally {
      cleanup();
    }
  });

  it("round-trips acquireWorkspace(cwd) -> releaseWorkspace(workspaceId) against the app-global store", async () => {
    const { registry, cleanup } = createRegistry();
    const appGlobal = makeStore(registry, "workspace_app_global", "appglobal");
    const workspaceA = makeStore(registry, "workspace_a", "a");
    const router = createWorkspaceStateRouter({
      appGlobalStore: appGlobal.store,
      workspaceStores: [{ store: workspaceA.store, isDefaultWorkspace: true }],
    });
    const owner = { ownerId: "owner-appglobal" as RuntimeOwnerId, kind: "test" as const };

    try {
      const acquired = await runTestEffect(
        router.workspace.acquireWorkspace({
          cwd: appGlobal.cwd as AbsolutePath,
          owner,
          openReason: "test",
        }),
      );
      expect(acquired.value.workspaceId as string).toBe("workspace_app_global");

      const released = await runTestEffect(
        router.workspace.releaseWorkspace({
          workspaceId: acquired.value.workspaceId,
          owner,
          releaseReason: "test",
        }),
      );
      expect(released.value.workspaceId as string).toBe("workspace_app_global");
      expect(released.value.released).toBeTrue();
    } finally {
      cleanup();
    }
  });

  it("bare maintenance sweeps observe rows the app-global store owns", async () => {
    const { registry, cleanup } = createRegistry();
    const appGlobal = makeStore(registry, "workspace_app_global", "appglobal");
    const workspaceA = makeStore(registry, "workspace_a", "a");
    const router = createWorkspaceStateRouter({
      appGlobalStore: appGlobal.store,
      workspaceStores: [{ store: workspaceA.store, isDefaultWorkspace: true }],
    });

    const openApproval = async (registered: TestStore, workspaceId: string): Promise<string> => {
      const surface = await runTestEffect(
        router.surfaceLifecycle.createOrchestratorSurface({
          workspaceId: workspaceId as WorkspaceId,
        }),
      );
      const turn = await runTestEffect(
        router.turn.startTurn({
          sessionId: surface.value.workspaceSessionId,
          surfacePiSessionId: surface.value.surfacePiSessionId,
          requestSummary: "Approve this.",
        }),
      );
      const command = await runTestEffect(
        router.command.createCommand({
          turnId: turn.value.id,
          surfacePiSessionId: surface.value.surfacePiSessionId,
          toolName: "exec_command",
          executor: "orchestrator",
          visibility: "surface",
          title: "Run command",
          summary: "Run command.",
        }),
      );
      const approval = await runTestEffect(
        router.approval.createApprovalRequest({
          sessionId: surface.value.workspaceSessionId,
          surfacePiSessionId: surface.value.surfacePiSessionId,
          turnId: turn.value.id as TurnId,
          commandId: command.value.id as CommandId,
          toolCallId: `tool-call-${workspaceId}` as ToolItemId,
          toolName: "exec_command",
          approvalMode: "user",
          cwd: registered.cwd,
          command: "bun test",
          commandFamily: "bun",
          context: { reason: "sandbox_denial_escalation", sandboxDenied: true },
        }),
      );
      return approval.value.requestId as string;
    };

    try {
      const appGlobalApprovalId = await openApproval(appGlobal, "workspace_app_global");
      const workspaceApprovalId = await openApproval(workspaceA, "workspace_a");

      const open = await runTestEffect(router.approval.listOpenApprovalRequests());
      const ids = open.map((entry) => entry.requestId as string);
      expect(ids).toContain(appGlobalApprovalId);
      expect(ids).toContain(workspaceApprovalId);

      expect(() => appGlobal.store.getRuntimeApprovalRequest(appGlobalApprovalId)).not.toThrow();
      expect(() => workspaceA.store.getRuntimeApprovalRequest(appGlobalApprovalId)).toThrow();
    } finally {
      cleanup();
    }
  });

  it("wires each of the fourteen runtime-facing port tags to its router service", async () => {
    const { registry, cleanup } = createRegistry();
    const appGlobal = makeStore(registry, "workspace_app_global", "appglobal");
    const workspaceA = makeStore(registry, "workspace_a", "a");
    const router = createWorkspaceStateRouter({
      appGlobalStore: appGlobal.store,
      workspaceStores: [{ store: workspaceA.store, isDefaultWorkspace: true }],
    });
    const layer = layerWorkspaceStateRouter(router);

    const unknownTarget: PromptTarget = {
      workspaceSessionId: "session-unregistered" as WorkspaceSessionId,
      surface: "orchestrator",
      surfacePiSessionId: "surface-unregistered" as SurfacePiSessionId,
    };
    const tolerate = <A>(
      effect: Effect.Effect<A, StateContractError>,
    ): Effect.Effect<"ok" | "typed-failure"> =>
      Effect.matchEffect(effect, {
        onFailure: () => Effect.succeed("typed-failure" as const),
        onSuccess: () => Effect.succeed("ok" as const),
      });

    try {
      const observed = await runTestEffect(
        Effect.gen(function* () {
          const workspace = yield* RuntimeWorkspaceStatePort;
          const surfaceLifecycle = yield* RuntimeSurfaceLifecycleStatePort;
          const promptDefaults = yield* RuntimePromptDefaultsStatePort;
          const source = yield* RuntimeSourceStatePort;
          const generatedPackage = yield* RuntimeGeneratedPackageStatePort;
          const actorExtensionBinding = yield* RuntimeActorExtensionBindingStatePort;
          const queue = yield* RuntimeQueueStatePort;
          const request = yield* RuntimeRequestStatePort;
          const approval = yield* RuntimeApprovalStatePort;
          const command = yield* RuntimeCommandStatePort;
          const sessionWait = yield* RuntimeSessionWaitStatePort;
          const thread = yield* RuntimeThreadStatePort;
          const turn = yield* RuntimeTurnStatePort;
          const episode = yield* RuntimeEpisodeStatePort;

          const identities = {
            workspace: workspace === router.workspace,
            surfaceLifecycle: surfaceLifecycle === router.surfaceLifecycle,
            promptDefaults: promptDefaults === router.promptDefaults,
            source: source === router.source,
            generatedPackage: generatedPackage === router.generatedPackage,
            actorExtensionBinding: actorExtensionBinding === router.actorExtensionBinding,
            queue: queue === router.queue,
            request: request === router.request,
            approval: approval === router.approval,
            command: command === router.command,
            sessionWait: sessionWait === router.sessionWait,
            thread: thread === router.thread,
            turn: turn === router.turn,
            episode: episode === router.episode,
          };

          const dispatched = {
            workspace: yield* tolerate(
              workspace.releaseWorkspace({
                workspaceId: "workspace_unregistered" as WorkspaceId,
                owner: { ownerId: "owner-wiring" as RuntimeOwnerId, kind: "test" },
                releaseReason: "test",
              }),
            ),
            surfaceLifecycle: yield* tolerate(
              surfaceLifecycle.createOrchestratorSurface({
                workspaceId: "workspace_unregistered" as WorkspaceId,
              }),
            ),
            promptDefaults: yield* tolerate(
              promptDefaults.resolvePromptDefaults({ target: unknownTarget }),
            ),
            source: yield* tolerate(
              source.readSourceVersion({
                scope: { kind: "app-global" },
                sourceKind: "user-extension",
                sourceId: "wiring",
              }),
            ),
            generatedPackage: yield* tolerate(generatedPackage.readGeneratedPackageFacts()),
            actorExtensionBinding: yield* tolerate(
              actorExtensionBinding.readRuntimePromptBinding({ target: unknownTarget }),
            ),
            queue: yield* tolerate(queue.releaseExpiredSurfaceMessageClaims()),
            request: yield* tolerate(request.listOpenBlockingRequestInputs()),
            approval: yield* tolerate(approval.listOpenApprovalRequests()),
            command: yield* tolerate(
              command.findCommandById({ commandId: "command-unregistered" }),
            ),
            sessionWait: yield* tolerate(
              sessionWait.clearSessionWait({
                sessionId: "session-unregistered" as WorkspaceSessionId,
              }),
            ),
            thread: yield* tolerate(
              thread.ensureHandlerThreadRunnable({
                workspaceSessionId: "session-unregistered" as WorkspaceSessionId,
                surfacePiSessionId: "surface-unregistered" as SurfacePiSessionId,
                threadId: "thread-unregistered" as ThreadId,
              }),
            ),
            turn: yield* tolerate(
              turn.setTurnDecision({ turnId: "turn-unregistered", decision: "reply" }),
            ),
            episode: yield* tolerate(
              episode.recordHandlerThreadEpisode({
                scope: "handler-thread",
                workspaceSessionId: "session-unregistered" as WorkspaceSessionId,
                threadId: "thread-unregistered" as ThreadId,
                threadGroupId: "group-unregistered" as ThreadGroupId,
                kind: "report",
                summary: "wiring",
              }),
            ),
          };

          return { identities, dispatched };
        }).pipe(Effect.provide(layer)),
      );

      expect(observed.identities).toEqual({
        workspace: true,
        surfaceLifecycle: true,
        promptDefaults: true,
        source: true,
        generatedPackage: true,
        actorExtensionBinding: true,
        queue: true,
        request: true,
        approval: true,
        command: true,
        sessionWait: true,
        thread: true,
        turn: true,
        episode: true,
      });
      expect(Object.keys(observed.dispatched)).toHaveLength(14);
      expect(
        Object.values(observed.dispatched).every(
          (outcome) => outcome === "ok" || outcome === "typed-failure",
        ),
      ).toBeTrue();
    } finally {
      cleanup();
    }
  });

  it("preserves committed sweep descriptors when a later store fails the bare fan-out", async () => {
    const { registry, cleanup } = createRegistry();
    const appGlobal = makeStore(registry, "workspace_app_global", "appglobal");
    const workspaceA = makeStore(registry, "workspace_a", "a");

    workspaceA.store.releaseExpiredSurfaceMessageClaims = () => [
      { surfacePiSessionId: "surface-store-a" } as unknown as RuntimeSurfaceMessageRecord,
    ];
    appGlobal.store.releaseExpiredSurfaceMessageClaims = () => {
      throw new Error("app-global sweep boom");
    };

    const router = createWorkspaceStateRouter({
      appGlobalStore: appGlobal.store,
      workspaceStores: [{ store: workspaceA.store, isDefaultWorkspace: true }],
    });

    try {
      const failure = await runTestEffect(router.queue.releaseExpiredSurfaceMessageClaims()).then(
        () => {
          throw new Error("expected the bare sweep to fail");
        },
        (error: unknown) => error as StateContractError,
      );

      expect(failure).toBeInstanceOf(StateContractError);
      expect(failure.operation).toBe("workspace-state-router.releaseExpiredSurfaceMessageClaims");
      expect(failure.reason).toBe("transaction-failed");

      const payload = failure.cause as {
        readonly kind: string;
        readonly committed: StateMutationResult<readonly RuntimeSurfaceMessageRecord[]>;
        readonly failures: readonly StateContractError[];
      };
      expect(payload.kind).toBe("workspace-state-router.fan-out-sweep-partial-failure");
      expect(payload.failures).toHaveLength(1);
      expect(payload.committed.value).toHaveLength(1);
      expect(payload.committed.afterCommit).toHaveLength(1);
      expect(payload.committed.afterCommit[0] as StateInvalidationDescriptor).toMatchObject({
        scope: "workspace",
        workspaceId: "workspace_a",
        invalidation: { model: "surface", ids: ["surface-store-a"] },
      });
    } finally {
      cleanup();
    }
  });
});
