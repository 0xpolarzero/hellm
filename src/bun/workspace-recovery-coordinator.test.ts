import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import type {
  CommandId,
  InternalRefreshGeneratedPackagesRequest,
  QueueItemId,
  RecoveryWorkId,
  RuntimeOwnerId,
  RuntimeRecoveryStartupSnapshot,
  RuntimeRecoveryStatePortService,
  RuntimeRecoveryWorkKind,
  RuntimeRecoveryWorkRecord,
  StateContractError,
  StateMutationResult,
  SurfacePiSessionId,
  ThreadId,
  TurnId,
  WorkspaceId,
  WorkspaceSessionId,
} from "@svvy/core";
import {
  WorkspaceRecoveryCoordinator,
  type WorkspaceRecoveryCoordinatorHandlers,
} from "./workspace-recovery-coordinator";
import { runtimeRecoveryStatePortFromStore } from "@svvy/state/structured-session-adapters";
import { createStructuredSessionStateStore } from "@svvy/state/structured-session-state";

describe("WorkspaceRecoveryCoordinator", () => {
  it("seeds recovery work from durable runtime startup snapshots", () => {
    const ensured: RuntimeRecoveryWorkRecord[] = [];
    const normalized: string[] = [];
    const operations: string[] = [];
    const recoveryState = createFakeRecoveryState({
      normalized,
      ensured,
      operations,
      snapshots: [createStartupSnapshot()],
    });
    const coordinator = new WorkspaceRecoveryCoordinator(
      "workspace-recovery-coordinator" as WorkspaceId,
      recoveryState,
      createHandlers(),
      runState,
    );

    coordinator.seedFromDurableState();

    expect(normalized).toHaveLength(1);
    expect(operations.slice(0, 4)).toEqual([
      "ensure:active_turn_recovery",
      "normalize",
      "ensure:queue_delivery",
      "ensure:queue_delivery",
    ]);
    expect(ensured.map((work) => work.kind)).toEqual([
      "active_turn_recovery",
      "queue_delivery",
      "queue_delivery",
      "title_generation",
      "queue_delivery",
      "title_generation",
    ]);
    expect(ensured).toContainEqual(
      expect.objectContaining({
        kind: "queue_delivery",
        ownerScope: expect.objectContaining({
          kind: "surface",
          surfacePiSessionId: "surface-recovery-coordinator",
        }),
        priority: 30,
      }),
    );
  });

  it("does not claim seeded work until startup explicitly activates recovery", async () => {
    const claims: RuntimeRecoveryWorkKind[][] = [];
    const claimed = [
      createRecoveryWork({
        kind: "queue_delivery",
        ownerScope: {
          kind: "surface",
          workspaceSessionId: "session-recovery-coordinator" as WorkspaceSessionId,
          surfacePiSessionId: "surface-recovery-coordinator" as SurfacePiSessionId,
        },
      }),
    ];
    const recoveryState = createFakeRecoveryState({ claimed, claims });
    const coordinator = new WorkspaceRecoveryCoordinator(
      "workspace-recovery-coordinator" as WorkspaceId,
      recoveryState,
      createHandlers(),
      runState,
    );

    coordinator.wake();
    await Promise.resolve();
    expect(claims).toEqual([]);

    coordinator.start();
    await waitFor(() => claims.length > 0);
    coordinator.close();
    expect(claims[0]).toEqual([]);
  });

  it("runs the pre-registration startup phase with active-turn recovery claims only", async () => {
    const claims: RuntimeRecoveryWorkKind[][] = [];
    const recoveredSurfaces: string[] = [];
    const claimed = [
      createRecoveryWork({
        kind: "queue_delivery",
        ownerScope: {
          kind: "surface",
          workspaceSessionId: "session-recovery-coordinator" as WorkspaceSessionId,
          surfacePiSessionId: "surface-queued" as SurfacePiSessionId,
        },
      }),
      createRecoveryWork({
        kind: "active_turn_recovery",
        ownerScope: {
          kind: "surface",
          workspaceSessionId: "session-recovery-coordinator" as WorkspaceSessionId,
          surfacePiSessionId: "surface-active" as SurfacePiSessionId,
        },
      }),
    ];
    const coordinator = new WorkspaceRecoveryCoordinator(
      "workspace-recovery-coordinator" as WorkspaceId,
      createFakeRecoveryState({ claims, claimed }),
      createHandlers({
        recoverSurfaceTurn: async (surfacePiSessionId) => {
          recoveredSurfaces.push(surfacePiSessionId);
        },
      }),
      runState,
    );

    coordinator.startActiveTurnRecovery();

    await waitFor(() => recoveredSurfaces.length === 1);
    coordinator.close();
    expect(claims[0]).toEqual(["active_turn_recovery"]);
    expect(recoveredSurfaces).toEqual(["surface-active"]);
  });

  it("claims work through the recovery port and completes successful handlers", async () => {
    const completed: RecoveryWorkId[] = [];
    const claimed = [
      createRecoveryWork({
        kind: "queue_delivery",
        ownerScope: {
          kind: "surface",
          workspaceSessionId: "session-recovery-coordinator" as WorkspaceSessionId,
          surfacePiSessionId: "surface-recovery-coordinator" as SurfacePiSessionId,
        },
        claimedBy: "workspace-recovery-test" as RuntimeOwnerId,
        leaseVersion: 1,
      }),
    ];
    const recoveryState = createFakeRecoveryState({
      claimed,
      completed,
    });
    const drainedTargets: string[] = [];
    const coordinator = new WorkspaceRecoveryCoordinator(
      "workspace-recovery-coordinator" as WorkspaceId,
      recoveryState,
      createHandlers({
        wakeSurfaceQueue: async (target) => {
          drainedTargets.push(target.surfacePiSessionId);
        },
      }),
      runState,
    );

    coordinator.start();

    await waitFor(() => completed.length === 1);
    coordinator.close();
    expect(drainedTargets).toEqual(["surface-recovery-coordinator"]);
    expect(completed).toEqual([claimed[0]!.id]);
  });

  it("runs a follow-up queue drain when a wake is enqueued while queue delivery is claimed", async () => {
    const pending: RuntimeRecoveryWorkRecord[] = [
      createRecoveryWork({
        id: "recovery-work-queue-delivery-first" as RecoveryWorkId,
        kind: "queue_delivery",
        status: "pending",
        ownerScope: {
          kind: "surface",
          workspaceSessionId: "session-recovery-coordinator" as WorkspaceSessionId,
          surfacePiSessionId: "surface-recovery-coordinator" as SurfacePiSessionId,
        },
        idempotencyKey: "queue_delivery:surface-recovery-coordinator",
      }),
    ];
    const completed: RecoveryWorkId[] = [];
    const recoveryState = createQueueDeliveryDirtySetRecoveryState({ pending, completed });
    const drainedTargets: string[] = [];
    let coordinator!: WorkspaceRecoveryCoordinator;
    coordinator = new WorkspaceRecoveryCoordinator(
      "workspace-recovery-coordinator" as WorkspaceId,
      recoveryState,
      createHandlers({
        wakeSurfaceQueue: async (target) => {
          drainedTargets.push(target.surfacePiSessionId);
          if (drainedTargets.length === 1) {
            coordinator.enqueue({
              kind: "queue_delivery",
              ownerScope: {
                kind: "surface",
                workspaceSessionId: target.workspaceSessionId as WorkspaceSessionId,
                surfacePiSessionId: target.surfacePiSessionId as SurfacePiSessionId,
              },
              idempotencyKey: `queue_delivery:${target.surfacePiSessionId}`,
              orderingKey: `surface:${target.surfacePiSessionId}`,
              priority: 30,
            });
          }
        },
      }),
      runState,
    );

    coordinator.start();

    await waitFor(() => drainedTargets.length === 2);
    coordinator.close();
    expect(drainedTargets).toEqual([
      "surface-recovery-coordinator",
      "surface-recovery-coordinator",
    ]);
    expect(completed).toHaveLength(2);
  });

  it("retries failed handlers through the recovery port", async () => {
    const retried: Array<{ id: RecoveryWorkId; error: string }> = [];
    const claimed = [
      createRecoveryWork({
        kind: "active_turn_recovery",
        ownerScope: {
          kind: "surface",
          workspaceSessionId: "session-recovery-coordinator" as WorkspaceSessionId,
          surfacePiSessionId: "surface-recovery-coordinator" as SurfacePiSessionId,
        },
        claimedBy: "workspace-recovery-test" as RuntimeOwnerId,
        leaseVersion: 1,
      }),
    ];
    const recoveryState = createFakeRecoveryState({
      claimed,
      retried,
    });
    const coordinator = new WorkspaceRecoveryCoordinator(
      "workspace-recovery-coordinator" as WorkspaceId,
      recoveryState,
      createHandlers({
        recoverSurfaceTurn: async () => {
          throw new Error("surface recovery failed");
        },
      }),
      runState,
    );

    coordinator.start();

    await waitFor(() => retried.length === 1);
    coordinator.close();
    expect(retried).toEqual([{ id: claimed[0]!.id, error: "surface recovery failed" }]);
  });

  it("fails or retries claimed approval-wait work instead of silently completing it", async () => {
    const completed: RecoveryWorkId[] = [];
    const retried: Array<{ id: RecoveryWorkId; error: string }> = [];
    const claimed = [
      createRecoveryWork({
        kind: "approval_wait",
        claimedBy: "workspace-recovery-test" as RuntimeOwnerId,
        leaseVersion: 4,
      }),
    ];
    const recoveryState = createFakeRecoveryState({ claimed, completed, retried });
    const coordinator = new WorkspaceRecoveryCoordinator(
      "workspace-recovery-coordinator" as WorkspaceId,
      recoveryState,
      createHandlers(),
      runState,
    );

    coordinator.start();

    await waitFor(() => retried.length === 1);
    coordinator.close();
    expect(completed).toEqual([]);
    expect(retried).toEqual([
      {
        id: claimed[0]!.id,
        error: `Workspace recovery work ${claimed[0]!.id} has no owner handler for approval_wait.`,
      },
    ]);
  });

  it("fails or retries malformed title work instead of completing an empty owner handler", async () => {
    const completed: RecoveryWorkId[] = [];
    const retried: Array<{ id: RecoveryWorkId; error: string }> = [];
    const claimed = [
      createRecoveryWork({
        kind: "title_generation",
        claimedBy: "workspace-recovery-test" as RuntimeOwnerId,
        leaseVersion: 2,
        payloadJson: {},
      }),
    ];
    const recoveryState = createFakeRecoveryState({ claimed, completed, retried });
    const coordinator = new WorkspaceRecoveryCoordinator(
      "workspace-recovery-coordinator" as WorkspaceId,
      recoveryState,
      createHandlers(),
      runState,
    );

    coordinator.start();

    await waitFor(() => retried.length === 1);
    coordinator.close();
    expect(completed).toEqual([]);
    expect(retried[0]?.error).toContain("must identify exactly one session or thread title job");
  });

  it("fails unsupported or malformed workspace rows and then advances later ordered work in real state", async () => {
    const workspaceId = "workspace-recovery-integration" as WorkspaceId;
    const now = "2026-07-12T09:00:00.000Z";
    let idSequence = 0;
    const store = createStructuredSessionStateStore({
      workspace: {
        id: workspaceId,
        label: "Recovery integration",
        cwd: "/tmp/svvy-workspace-recovery-integration",
        artifactDir: "/tmp/svvy-workspace-recovery-integration/artifacts",
      },
      digest: {
        sha256Hex: (value) => String(value).length.toString(16).padStart(64, "0"),
      },
      filesystemSetup: "caller",
      now: () => now,
      idFactory: (prefix) => `${prefix}-${++idSequence}`,
    });
    const unsupportedKinds = [
      "approval_wait",
      "request_input_wait",
      "command_process_reconciliation",
    ] as const satisfies readonly RuntimeRecoveryWorkKind[];
    const failedIds: RecoveryWorkId[] = [];
    const expectedQueueSurfaces: string[] = [];

    try {
      for (const [index, kind] of unsupportedKinds.entries()) {
        const orderingKey = `surface:unsupported-${index}`;
        const unsupported = store.ensureRecoveryWork({
          scope: { kind: "workspace", workspaceId },
          kind,
          ownerScope: { kind: "workspace" },
          idempotencyKey: `unsupported:${kind}`,
          orderingKey,
          orderingSeq: 0,
          priority: 10,
          availableAt: now,
          maxAttempts: 1,
        });
        failedIds.push(unsupported.id as RecoveryWorkId);
        const surfacePiSessionId = `surface-after-${kind}`;
        expectedQueueSurfaces.push(surfacePiSessionId);
        store.ensureRecoveryWork({
          scope: { kind: "workspace", workspaceId },
          kind: "queue_delivery",
          ownerScope: {
            kind: "surface",
            workspaceSessionId: `session-after-${kind}`,
            surfacePiSessionId,
          },
          idempotencyKey: `queue-after:${kind}`,
          orderingKey,
          orderingSeq: 1,
          priority: 20,
          availableAt: now,
          maxAttempts: 1,
        });
      }

      const malformedTitle = store.ensureRecoveryWork({
        scope: { kind: "workspace", workspaceId },
        kind: "title_generation",
        ownerScope: { kind: "workspace" },
        idempotencyKey: "malformed:title",
        orderingKey: "surface:malformed-title",
        orderingSeq: 0,
        priority: 10,
        availableAt: now,
        maxAttempts: 1,
        payloadJson: {},
      });
      failedIds.push(malformedTitle.id as RecoveryWorkId);
      expectedQueueSurfaces.push("surface-after-malformed-title");
      store.ensureRecoveryWork({
        scope: { kind: "workspace", workspaceId },
        kind: "queue_delivery",
        ownerScope: {
          kind: "surface",
          workspaceSessionId: "session-after-malformed-title",
          surfacePiSessionId: "surface-after-malformed-title",
        },
        idempotencyKey: "queue-after:malformed-title",
        orderingKey: "surface:malformed-title",
        orderingSeq: 1,
        priority: 20,
        availableAt: now,
        maxAttempts: 1,
      });

      const appSource = store.ensureRecoveryWork({
        scope: { kind: "app" },
        kind: "source_reconcile",
        ownerScope: {
          kind: "source",
          sourceKind: "workflow-agent",
          sourceId: "appOwnedAgent",
        },
        idempotencyKey: "source_reconcile:app-owned-agent",
        orderingKey: "source:workflow-agent:appOwnedAgent",
        orderingSeq: 0,
        priority: 1,
        availableAt: now,
        maxAttempts: 1,
      });

      const wokenSurfaces: string[] = [];
      const coordinator = new WorkspaceRecoveryCoordinator(
        workspaceId,
        runtimeRecoveryStatePortFromStore(store),
        createHandlers({
          wakeSurfaceQueue: async (target) => {
            wokenSurfaces.push(target.surfacePiSessionId);
          },
        }),
        runState,
      );

      await coordinator.start();
      coordinator.close();

      const recoveryRows = store.listRecoveryWork();
      for (const failedId of failedIds) {
        expect(recoveryRows.find((row) => row.id === failedId)).toMatchObject({
          status: "failed",
          attempts: 1,
        });
      }
      expect(wokenSurfaces.toSorted()).toEqual(expectedQueueSurfaces.toSorted());
      expect(
        recoveryRows.filter((row) => row.kind === "queue_delivery").map((row) => row.status),
      ).toEqual(["completed", "completed", "completed", "completed"]);
      expect(recoveryRows.find((row) => row.id === appSource.id)).toMatchObject({
        scope: { kind: "app" },
        kind: "source_reconcile",
        status: "pending",
        attempts: 0,
      });
    } finally {
      store.close();
    }
  });

  it("dispatches generated package link recovery through runtime refresh requests", async () => {
    const completed: RecoveryWorkId[] = [];
    const claimed = [
      createRecoveryWork({
        id: "recovery-work-generated-package-link" as RecoveryWorkId,
        kind: "workspace_generated_package_link_repair",
        ownerScope: { kind: "workspace" },
        claimedBy: "workspace-recovery-test" as RuntimeOwnerId,
        leaseVersion: 1,
        payloadJson: {
          refreshGeneratedPackages: {
            scope: "workspace-link-repair",
            workspaceId: "workspace-recovery-coordinator",
            packages: ["@svvyx/extensions"],
            reason: "link-repair",
            sourceCommandId: "cmd_generated_link_repair",
            scheduledReason: "app-global-generated-package-refreshed",
          },
        },
      }),
    ];
    const recoveryState = createFakeRecoveryState({
      claimed,
      completed,
    });
    const refreshRequests: InternalRefreshGeneratedPackagesRequest[] = [];
    const coordinator = new WorkspaceRecoveryCoordinator(
      "workspace-recovery-coordinator" as WorkspaceId,
      recoveryState,
      createHandlers({
        refreshGeneratedPackages: async (input) => {
          refreshRequests.push(input);
        },
      }),
      runState,
    );

    coordinator.start();

    await waitFor(() => completed.length === 1);
    coordinator.close();
    expect(refreshRequests).toEqual([
      {
        scope: "workspace-link-repair",
        workspaceId: "workspace-recovery-coordinator" as WorkspaceId,
        packages: ["@svvyx/extensions"],
        reason: "link-repair",
        sourceCommandId: "cmd_generated_link_repair" as CommandId,
        recoveryWorkId: "recovery-work-generated-package-link" as RecoveryWorkId,
      },
    ]);
    expect(completed).toEqual([claimed[0]!.id]);
  });
});

function createFakeRecoveryState(input: {
  snapshots?: RuntimeRecoveryStartupSnapshot[];
  normalized?: string[];
  ensured?: RuntimeRecoveryWorkRecord[];
  claimed?: RuntimeRecoveryWorkRecord[];
  completed?: RecoveryWorkId[];
  retried?: Array<{ id: RecoveryWorkId; error: string }>;
  operations?: string[];
  claims?: RuntimeRecoveryWorkKind[][];
}): RuntimeRecoveryStatePortService {
  const claimed = [...(input.claimed ?? [])];
  return {
    normalizeWorkspaceRecoveryState: ({ claimedBy }) =>
      Effect.sync(() => {
        input.normalized?.push(claimedBy);
        input.operations?.push("normalize");
        return stateMutation(undefined);
      }),
    listWorkspaceRecoveryStartupSnapshots: () => Effect.succeed(input.snapshots ?? []),
    ensureRecoveryWork: (workInput) =>
      Effect.sync(() => {
        const record = createRecoveryWork(workInput);
        input.ensured?.push(record);
        input.operations?.push(`ensure:${record.kind}`);
        return stateMutation(record);
      }),
    claimNextRecoveryWork: ({ kinds }) =>
      Effect.sync(() => {
        input.claims?.push([...(kinds ?? [])]);
        const nextIndex = claimed.findIndex((work) => !kinds?.length || kinds.includes(work.kind));
        return stateMutation(nextIndex >= 0 ? claimed.splice(nextIndex, 1)[0]! : null);
      }),
    completeRecoveryWork: ({ id }) =>
      Effect.sync(() => {
        input.completed?.push(id);
        return stateMutation(createRecoveryWork({ id, kind: "title_generation" }));
      }),
    failOrRetryRecoveryWork: ({ id, error }) =>
      Effect.sync(() => {
        input.retried?.push({ id, error });
        return stateMutation(
          createRecoveryWork({ id, kind: "title_generation", status: "pending" }),
        );
      }),
  };
}

function createQueueDeliveryDirtySetRecoveryState(input: {
  pending: RuntimeRecoveryWorkRecord[];
  completed: RecoveryWorkId[];
}): RuntimeRecoveryStatePortService {
  let sequence = 0;
  return {
    normalizeWorkspaceRecoveryState: () => Effect.succeed(stateMutation(undefined)),
    listWorkspaceRecoveryStartupSnapshots: () => Effect.succeed([]),
    ensureRecoveryWork: (workInput) =>
      Effect.sync(() => {
        const existing = input.pending.find(
          (work) =>
            work.idempotencyKey === workInput.idempotencyKey &&
            work.status !== "claimed" &&
            work.status !== "completed" &&
            work.status !== "failed" &&
            work.status !== "cancelled",
        );
        if (existing) {
          return stateMutation(existing);
        }
        sequence += 1;
        const record = createRecoveryWork({
          ...workInput,
          id: `recovery-work-queue-delivery-redirty-${sequence}` as RecoveryWorkId,
          status: "pending",
        });
        input.pending.push(record);
        return stateMutation(record);
      }),
    claimNextRecoveryWork: ({ claimedBy }) =>
      Effect.sync(() => {
        const next = input.pending.shift();
        return stateMutation(
          next
            ? {
                ...next,
                status: "claimed",
                claimedBy,
                leaseVersion: next.leaseVersion + 1,
              }
            : null,
        );
      }),
    completeRecoveryWork: ({ id }) =>
      Effect.sync(() => {
        input.completed.push(id);
        return stateMutation(
          createRecoveryWork({ id, kind: "queue_delivery", status: "completed" }),
        );
      }),
    failOrRetryRecoveryWork: ({ id }) =>
      Effect.sync(() =>
        stateMutation(createRecoveryWork({ id, kind: "queue_delivery", status: "pending" })),
      ),
  };
}

function stateMutation<T>(value: T): StateMutationResult<T> {
  return { value, afterCommit: [] };
}

function createHandlers(overrides: Partial<WorkspaceRecoveryCoordinatorHandlers> = {}) {
  const handlers: WorkspaceRecoveryCoordinatorHandlers = {
    recoverSurfaceTurn: async () => undefined,
    wakeSurfaceQueue: async () => undefined,
    generateTitle: async () => undefined,
    refreshGeneratedPackages: async () => undefined,
    resolveSurfaceTarget: (surfacePiSessionId: string) => ({
      workspaceSessionId: "session-recovery-coordinator",
      surface: "orchestrator" as const,
      surfacePiSessionId,
    }),
  };
  return { ...handlers, ...overrides };
}

function createStartupSnapshot(): RuntimeRecoveryStartupSnapshot {
  return {
    session: {
      id: "session-recovery-coordinator" as WorkspaceSessionId,
      orchestratorPiSessionId: "surface-recovery-coordinator" as SurfacePiSessionId,
    },
    pi: { titleGenerationStatus: "pending" },
    turns: [
      {
        id: "turn-recovery-coordinator" as TurnId,
        status: "running",
        surfacePiSessionId: "surface-recovery-coordinator" as SurfacePiSessionId,
        threadId: null,
      },
    ],
    queuedMessages: [
      {
        id: "queue-recovery-coordinator" as QueueItemId,
        status: "dispatching",
        surfacePiSessionId: "surface-recovery-coordinator" as SurfacePiSessionId,
        kind: "thread_report_notification",
        position: 4,
      },
    ],
    threads: [
      {
        id: "thread-recovery-coordinator" as ThreadId,
        status: "running-handler",
        surfacePiSessionId: "surface-thread-recovery-coordinator" as SurfacePiSessionId,
        title: "Handle this",
        objective: "Handle this",
      },
    ],
  };
}

function createRecoveryWork(
  input: Partial<RuntimeRecoveryWorkRecord> & Pick<RuntimeRecoveryWorkRecord, "kind">,
): RuntimeRecoveryWorkRecord {
  return {
    id: input.id ?? (`recovery-work-${input.kind}` as RecoveryWorkId),
    scope: input.scope ?? {
      kind: "workspace",
      workspaceId: "workspace-recovery-coordinator" as WorkspaceId,
    },
    kind: input.kind,
    status: input.status ?? "claimed",
    ownerScope: input.ownerScope ?? { kind: "workspace" },
    idempotencyKey: input.idempotencyKey ?? `idempotency:${input.kind}`,
    orderingKey: input.orderingKey ?? `ordering:${input.kind}`,
    orderingSeq: input.orderingSeq ?? 0,
    priority: input.priority ?? 50,
    availableAt: input.availableAt ?? "2026-04-18T08:57:00.000Z",
    attempts: input.attempts ?? 1,
    maxAttempts: input.maxAttempts ?? 5,
    claimedBy: input.claimedBy ?? null,
    claimedAt: input.claimedAt ?? null,
    claimExpiresAt: input.claimExpiresAt ?? null,
    leaseVersion: input.leaseVersion ?? 0,
    payloadJson: input.payloadJson ?? null,
    lastError: input.lastError ?? null,
    createdAt: input.createdAt ?? "2026-04-18T08:57:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-18T08:57:00.000Z",
    completedAt: input.completedAt ?? null,
  };
}

function runState<A>(effect: Effect.Effect<A, StateContractError>): A {
  return Effect.runSync(effect);
}

async function waitFor(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for recovery coordinator test condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
