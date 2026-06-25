import type { PromptTarget } from "../shared/workspace-contract";
import { randomUUID } from "node:crypto";
import type {
  JsonValue,
  RuntimeOwnerId,
  RuntimeRecoveryStatePortService,
  RuntimeRecoveryWorkKind,
  RuntimeRecoveryWorkRecord,
  RuntimeRecoveryWorkOwnerScope,
  StateContractError,
  SurfacePiSessionId,
  TitleJobId,
} from "@svvy/core";
import type * as Effect from "effect/Effect";

export interface WorkspaceRecoveryCoordinatorHandlers {
  recoverSurfaceTurn(surfacePiSessionId: string): Promise<void>;
  drainSurfaceQueue(target: PromptTarget): Promise<void>;
  generateTitle(owner: { sessionId?: string; threadId?: string }): Promise<void>;
  repairWorkspaceGeneratedPackageLinks(work: RuntimeRecoveryWorkRecord): Promise<void>;
  resolveSurfaceTarget(surfacePiSessionId: string): PromptTarget;
}

export class WorkspaceRecoveryCoordinator {
  private readonly claimedBy: RuntimeOwnerId;
  private running = false;
  private rerunRequested = false;
  private closed = false;

  constructor(
    private readonly recoveryState: RuntimeRecoveryStatePortService,
    private readonly handlers: WorkspaceRecoveryCoordinatorHandlers,
    private readonly runState: <A>(effect: Effect.Effect<A, StateContractError>) => A,
  ) {
    this.claimedBy = `workspace-recovery-${randomUUID()}` as RuntimeOwnerId;
  }

  seedFromDurableState(): void {
    this.runState(
      this.recoveryState.normalizeWorkspaceRecoveryState({ claimedBy: this.claimedBy }),
    );
    for (const snapshot of this.runState(
      this.recoveryState.listWorkspaceRecoveryStartupSnapshots(),
    )) {
      const sessionId = snapshot.session.id;
      const runningTurnsBySurface = new Set<SurfacePiSessionId>();
      for (const turn of snapshot.turns) {
        if (turn.status === "running" || turn.status === "waiting") {
          runningTurnsBySurface.add(turn.surfacePiSessionId);
          this.enqueue({
            kind: "active_turn_recovery",
            ownerScope: {
              kind: "surface",
              workspaceSessionId: sessionId,
              surfacePiSessionId: turn.surfacePiSessionId,
            },
            idempotencyKey: `active_turn_recovery:${turn.surfacePiSessionId}:${turn.id}`,
            orderingKey: `surface:${turn.surfacePiSessionId}`,
            orderingSeq: 0,
            priority: 10,
            payloadJson: { turnId: turn.id },
          });
        }
      }

      const queuedSurfaces = new Set<SurfacePiSessionId>();
      for (const message of snapshot.queuedMessages ?? []) {
        if (
          message.status === "queued" ||
          message.status === "dispatching" ||
          message.status === "steering"
        ) {
          queuedSurfaces.add(message.surfacePiSessionId);
          if (message.kind === "thread_report_notification") {
            this.enqueue({
              kind: "queue_delivery",
              ownerScope: {
                kind: "queue_item",
                queuedItemId: message.id,
                surfacePiSessionId: message.surfacePiSessionId,
              },
              idempotencyKey: `queue_delivery:${message.id}`,
              orderingKey: `surface:${message.surfacePiSessionId}`,
              orderingSeq: message.position,
              priority: 25,
            });
          }
        }
      }
      for (const surfacePiSessionId of queuedSurfaces) {
        this.enqueue({
          kind: "queue_delivery",
          ownerScope: {
            kind: "surface",
            workspaceSessionId: sessionId,
            surfacePiSessionId,
          },
          idempotencyKey: `queue_delivery:${surfacePiSessionId}`,
          orderingKey: `surface:${surfacePiSessionId}`,
          orderingSeq: 100,
          priority: runningTurnsBySurface.has(surfacePiSessionId) ? 40 : 30,
        });
      }

      if (
        snapshot.pi.titleGenerationStatus === "pending" ||
        snapshot.pi.titleGenerationStatus === "running" ||
        snapshot.pi.titleGenerationStatus === "failed"
      ) {
        this.enqueue({
          kind: "title_generation",
          ownerScope: { kind: "title_job", titleJobId: `session:${sessionId}` as TitleJobId },
          idempotencyKey: `title_generation:session:${sessionId}`,
          orderingKey: `surface:${snapshot.session.orchestratorPiSessionId}`,
          priority: 70,
          payloadJson: { sessionId },
        });
      }

      for (const thread of snapshot.threads) {
        const threadTurns = snapshot.turns.filter((turn) => turn.threadId === thread.id);
        if (thread.status === "running-handler" && threadTurns.length === 0) {
          this.enqueue({
            kind: "queue_delivery",
            ownerScope: {
              kind: "thread",
              workspaceSessionId: sessionId,
              threadId: thread.id,
              surfacePiSessionId: thread.surfacePiSessionId,
            },
            idempotencyKey: `queue_delivery:initial_handler_start:${thread.id}`,
            orderingKey: `thread:${thread.id}`,
            priority: 20,
          });
        }
        if (thread.title.trim() === thread.objective.trim() && thread.objective.trim()) {
          this.enqueue({
            kind: "title_generation",
            ownerScope: { kind: "title_job", titleJobId: `thread:${thread.id}` as TitleJobId },
            idempotencyKey: `title_generation:thread:${thread.id}`,
            orderingKey: `thread:${thread.id}`,
            priority: 70,
            payloadJson: { threadId: thread.id },
          });
        }
      }
    }
  }

  start(): void {
    if (this.closed) return;
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    this.running = true;
    queueMicrotask(
      () =>
        void this.drain().finally(() => {
          this.running = false;
          if (this.rerunRequested && !this.closed) {
            this.rerunRequested = false;
            this.start();
          }
        }),
    );
  }

  wake(): void {
    this.start();
  }

  close(): void {
    this.closed = true;
  }

  enqueue(input: {
    kind: RuntimeRecoveryWorkKind;
    ownerScope: RuntimeRecoveryWorkOwnerScope;
    idempotencyKey: string;
    orderingKey: string;
    orderingSeq?: number;
    priority?: number;
    payloadJson?: JsonValue;
  }): RuntimeRecoveryWorkRecord {
    return this.runState(
      this.recoveryState.ensureRecoveryWork({
        ...input,
        orderingSeq: input.orderingSeq ?? 0,
        priority: input.priority ?? 50,
        availableAt: new Date().toISOString(),
        maxAttempts: 5,
      }),
    ).value;
  }

  private async drain(): Promise<void> {
    while (!this.closed) {
      const work = this.runState(
        this.recoveryState.claimNextRecoveryWork({ claimedBy: this.claimedBy }),
      ).value;
      if (!work) return;
      void this.executeClaimedWork(work);
    }
  }

  private async executeClaimedWork(work: RuntimeRecoveryWorkRecord): Promise<void> {
    try {
      await this.runWork(work);
      if (this.closed) return;
      this.runState(
        this.recoveryState.completeRecoveryWork({
          id: work.id,
          claimedBy: work.claimedBy,
          leaseVersion: work.leaseVersion,
        }),
      );
    } catch (error) {
      if (this.closed) return;
      const message = error instanceof Error ? error.message : "Workspace recovery work failed.";
      this.runState(
        this.recoveryState.failOrRetryRecoveryWork({
          id: work.id,
          error: message,
          claimedBy: work.claimedBy,
          leaseVersion: work.leaseVersion,
        }),
      );
    } finally {
      if (!this.closed) {
        this.wake();
      }
    }
  }

  private async runWork(work: RuntimeRecoveryWorkRecord): Promise<void> {
    const payload = isRecord(work.payloadJson) ? work.payloadJson : {};
    switch (work.kind) {
      case "active_turn_recovery":
        await this.handlers.recoverSurfaceTurn(readSurfacePiSessionId(work));
        return;
      case "queue_delivery":
        await this.handlers.drainSurfaceQueue(
          this.handlers.resolveSurfaceTarget(readSurfacePiSessionId(work)),
        );
        return;
      case "workspace_generated_package_link_repair":
        await this.handlers.repairWorkspaceGeneratedPackageLinks(work);
        return;
      case "title_generation":
        await this.handlers.generateTitle({
          sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
          threadId: typeof payload.threadId === "string" ? payload.threadId : undefined,
        });
        return;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSurfacePiSessionId(work: RuntimeRecoveryWorkRecord): string {
  if (
    work.ownerScope.kind === "surface" ||
    work.ownerScope.kind === "thread" ||
    work.ownerScope.kind === "queue_item"
  ) {
    return work.ownerScope.surfacePiSessionId;
  }
  throw new Error(`Recovery work ${work.id} is not surface-scoped.`);
}
