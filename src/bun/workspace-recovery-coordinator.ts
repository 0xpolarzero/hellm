import type { PromptTarget } from "../shared/workspace-contract";
import { randomUUID } from "node:crypto";
import type {
  StructuredRecoveryWorkKind,
  StructuredRecoveryWorkRecord,
  StructuredRecoveryWorkOwnerScope,
  StructuredSessionStateStore,
} from "./structured-session-state";

export interface WorkspaceRecoveryCoordinatorHandlers {
  recoverSurfaceTurn(surfacePiSessionId: string): Promise<void>;
  drainSurfaceQueue(target: PromptTarget): Promise<void>;
  startInitialHandler(input: { sessionId: string; threadId: string }): Promise<void>;
  recoverThreadReportNotification(queuedItemId: string): Promise<void>;
  generateTitle(owner: { sessionId?: string; threadId?: string }): Promise<void>;
  projectRecoveryLog(work: StructuredRecoveryWorkRecord): Promise<void>;
  refreshWorkflowsBuild(work: StructuredRecoveryWorkRecord): Promise<void>;
  resolveSurfaceTarget(surfacePiSessionId: string): PromptTarget;
}

export class WorkspaceRecoveryCoordinator {
  private readonly claimedBy: string;
  private running = false;
  private rerunRequested = false;
  private closed = false;

  constructor(
    private readonly store: StructuredSessionStateStore,
    private readonly handlers: WorkspaceRecoveryCoordinatorHandlers,
  ) {
    this.claimedBy = `workspace-recovery-${randomUUID()}`;
  }

  seedFromDurableState(): void {
    this.store.normalizeWorkspaceRecoveryState({ claimedBy: this.claimedBy });
    for (const snapshot of this.store.listSessionStates()) {
      const sessionId = snapshot.session.id;
      const runningTurnsBySurface = new Set<string>();
      for (const turn of snapshot.turns) {
        if (turn.status === "running" || turn.status === "waiting") {
          runningTurnsBySurface.add(turn.surfacePiSessionId);
          this.enqueue({
            kind: "surface_turn_recovery",
            ownerScope: {
              kind: "surface",
              workspaceSessionId: sessionId,
              surfacePiSessionId: turn.surfacePiSessionId,
            },
            idempotencyKey: `surface_turn_recovery:${turn.surfacePiSessionId}:${turn.id}`,
            orderingKey: `surface:${turn.surfacePiSessionId}`,
            orderingSeq: 0,
            priority: 10,
            payloadJson: { turnId: turn.id },
          });
        }
      }

      const queuedSurfaces = new Set<string>();
      for (const message of snapshot.queuedMessages ?? []) {
        if (
          message.status === "queued" ||
          message.status === "dispatching" ||
          message.status === "steering"
        ) {
          queuedSurfaces.add(message.surfacePiSessionId);
          if (message.kind === "thread_report_notification") {
            this.enqueue({
              kind: "thread_report_notification_delivery",
              ownerScope: {
                kind: "queue_item",
                queuedItemId: message.id,
                surfacePiSessionId: message.surfacePiSessionId,
              },
              idempotencyKey: `thread_report_notification_delivery:${message.id}`,
              orderingKey: `surface:${message.surfacePiSessionId}`,
              orderingSeq: message.position,
              priority: 25,
            });
          }
        }
      }
      for (const surfacePiSessionId of queuedSurfaces) {
        this.enqueue({
          kind: "queue_drain",
          ownerScope: {
            kind: "surface",
            workspaceSessionId: sessionId,
            surfacePiSessionId,
          },
          idempotencyKey: `queue_drain:${surfacePiSessionId}`,
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
          ownerScope: { kind: "title_job", titleJobId: `session:${sessionId}` },
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
            kind: "initial_handler_start",
            ownerScope: {
              kind: "thread",
              workspaceSessionId: sessionId,
              threadId: thread.id,
              surfacePiSessionId: thread.surfacePiSessionId,
            },
            idempotencyKey: `initial_handler_start:${thread.id}`,
            orderingKey: `thread:${thread.id}`,
            priority: 20,
            payloadJson: { sessionId, threadId: thread.id },
          });
        }
        if (thread.title.trim() === thread.objective.trim() && thread.objective.trim()) {
          this.enqueue({
            kind: "title_generation",
            ownerScope: { kind: "title_job", titleJobId: `thread:${thread.id}` },
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
    kind: StructuredRecoveryWorkKind;
    ownerScope: StructuredRecoveryWorkOwnerScope;
    idempotencyKey: string;
    orderingKey: string;
    orderingSeq?: number;
    priority?: number;
    payloadJson?: unknown;
  }): StructuredRecoveryWorkRecord {
    return this.store.ensureRecoveryWork({
      ...input,
      orderingSeq: input.orderingSeq ?? 0,
      priority: input.priority ?? 50,
      availableAt: new Date().toISOString(),
      maxAttempts: 5,
    });
  }

  private async drain(): Promise<void> {
    while (!this.closed) {
      const work = this.store.claimNextRecoveryWork({ claimedBy: this.claimedBy });
      if (!work) return;
      void this.executeClaimedWork(work);
    }
  }

  private async executeClaimedWork(work: StructuredRecoveryWorkRecord): Promise<void> {
    try {
      await this.runWork(work);
      if (this.closed) return;
      this.store.completeRecoveryWork({ id: work.id });
    } catch (error) {
      if (this.closed) return;
      const message = error instanceof Error ? error.message : "Workspace recovery work failed.";
      this.store.failOrRetryRecoveryWork({ id: work.id, error: message });
    } finally {
      if (!this.closed) {
        this.wake();
      }
    }
  }

  private async runWork(work: StructuredRecoveryWorkRecord): Promise<void> {
    const payload = isRecord(work.payloadJson) ? work.payloadJson : {};
    switch (work.kind) {
      case "surface_turn_recovery":
        await this.handlers.recoverSurfaceTurn(readSurfacePiSessionId(work));
        return;
      case "queue_drain":
        await this.handlers.drainSurfaceQueue(
          this.handlers.resolveSurfaceTarget(readSurfacePiSessionId(work)),
        );
        return;
      case "initial_handler_start":
        await this.handlers.startInitialHandler({
          sessionId: String(payload.sessionId ?? readWorkspaceSessionId(work)),
          threadId: String(payload.threadId ?? readThreadId(work)),
        });
        return;
      case "thread_report_notification_delivery":
        await this.handlers.recoverThreadReportNotification(readQueuedItemId(work));
        return;
      case "workflows_build_refresh":
        await this.handlers.refreshWorkflowsBuild(work);
        return;
      case "title_generation":
        await this.handlers.generateTitle({
          sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
          threadId: typeof payload.threadId === "string" ? payload.threadId : undefined,
        });
        return;
      case "app_log_projection":
        await this.handlers.projectRecoveryLog(work);
        return;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSurfacePiSessionId(work: StructuredRecoveryWorkRecord): string {
  if (
    work.ownerScope.kind === "surface" ||
    work.ownerScope.kind === "thread" ||
    work.ownerScope.kind === "queue_item"
  ) {
    return work.ownerScope.surfacePiSessionId;
  }
  throw new Error(`Recovery work ${work.id} is not surface-scoped.`);
}

function readWorkspaceSessionId(work: StructuredRecoveryWorkRecord): string {
  if (work.ownerScope.kind === "surface" || work.ownerScope.kind === "thread")
    return work.ownerScope.workspaceSessionId;
  throw new Error(`Recovery work ${work.id} has no workspace session owner.`);
}

function readThreadId(work: StructuredRecoveryWorkRecord): string {
  if (work.ownerScope.kind === "thread") return work.ownerScope.threadId;
  throw new Error(`Recovery work ${work.id} has no thread owner.`);
}

function readQueuedItemId(work: StructuredRecoveryWorkRecord): string {
  if (work.ownerScope.kind === "queue_item") return work.ownerScope.queuedItemId;
  throw new Error(`Recovery work ${work.id} has no queue item owner.`);
}
