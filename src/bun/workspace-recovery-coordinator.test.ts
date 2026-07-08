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

describe("WorkspaceRecoveryCoordinator", () => {
  it("seeds recovery work from durable runtime startup snapshots", () => {
    const ensured: RuntimeRecoveryWorkRecord[] = [];
    const normalized: string[] = [];
    const recoveryState = createFakeRecoveryState({
      normalized,
      ensured,
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
        priority: 40,
      }),
    );
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
        drainSurfaceQueue: async (target) => {
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
}): RuntimeRecoveryStatePortService {
  const claimed = [...(input.claimed ?? [])];
  return {
    normalizeWorkspaceRecoveryState: ({ claimedBy }) =>
      Effect.sync(() => {
        input.normalized?.push(claimedBy);
        return stateMutation(undefined);
      }),
    listWorkspaceRecoveryStartupSnapshots: () => Effect.succeed(input.snapshots ?? []),
    ensureRecoveryWork: (workInput) =>
      Effect.sync(() => {
        const record = createRecoveryWork(workInput);
        input.ensured?.push(record);
        return stateMutation(record);
      }),
    claimNextRecoveryWork: () => Effect.sync(() => stateMutation(claimed.shift() ?? null)),
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

function stateMutation<T>(value: T): StateMutationResult<T> {
  return { value, afterCommit: [] };
}

function createHandlers(overrides: Partial<WorkspaceRecoveryCoordinatorHandlers> = {}) {
  const handlers: WorkspaceRecoveryCoordinatorHandlers = {
    recoverSurfaceTurn: async () => undefined,
    drainSurfaceQueue: async () => undefined,
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
