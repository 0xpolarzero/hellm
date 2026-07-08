import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeRecoveryStatePort,
  type QueueItemId,
  type RecoveryWorkId,
  type RuntimeOwnerId,
  type RuntimeRecoveryStatePortService,
  type RuntimeRecoveryStartupSnapshot,
  type RuntimeRecoveryWorkOwnerScope,
  type RuntimeRecoveryWorkRecord,
  type RuntimeRecoveryWorkScope,
  type SurfacePiSessionId,
  type TitleJobId,
  type ThreadId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
  type WorkflowRunId,
} from "@svvy/core";
import { dedupeInvalidations, mutationResult, surfaceInvalidation } from "./state-mutation-result";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredRecoveryWorkOwnerScope,
  type StructuredRecoveryWorkRecord,
  type StructuredSessionSnapshot,
  type StructuredSessionStateStore,
} from "./structured-session-state";

export function runtimeRecoveryStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeRecoveryStatePortService {
  return {
    normalizeWorkspaceRecoveryState: (input) =>
      state
        .normalizeWorkspaceRecoveryState(input)
        .pipe(
          Effect.map((surfacePiSessionIds) =>
            mutationResult(
              undefined,
              dedupeInvalidations(
                surfacePiSessionIds.map((surfacePiSessionId) =>
                  surfaceInvalidation(state.workspaceId, surfacePiSessionId),
                ),
              ),
            ),
          ),
        ),
    listWorkspaceRecoveryStartupSnapshots: () =>
      state
        .listSessionStates()
        .pipe(Effect.map((snapshots) => snapshots.map(runtimeRecoveryStartupSnapshotFromState))),
    ensureRecoveryWork: (input) =>
      state
        .ensureRecoveryWork(input)
        .pipe(Effect.map((work) => mutationResult(runtimeRecoveryWorkRecordFromState(work)))),
    claimNextRecoveryWork: (input) =>
      state
        .claimNextRecoveryWork(input)
        .pipe(
          Effect.map((work) =>
            mutationResult(work ? runtimeRecoveryWorkRecordFromState(work) : null),
          ),
        ),
    completeRecoveryWork: (input) =>
      state
        .completeRecoveryWork(input)
        .pipe(Effect.map((work) => mutationResult(runtimeRecoveryWorkRecordFromState(work)))),
    failOrRetryRecoveryWork: (input) =>
      state
        .failOrRetryRecoveryWork(input)
        .pipe(Effect.map((work) => mutationResult(runtimeRecoveryWorkRecordFromState(work)))),
  };
}

export function runtimeRecoveryStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeRecoveryStatePortService {
  return runtimeRecoveryStatePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const makeRuntimeRecoveryStatePort = Effect.fn("@svvy/state/makeRuntimeRecoveryStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeRecoveryStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeRecoveryStatePort = Layer.effect(
  RuntimeRecoveryStatePort,
  makeRuntimeRecoveryStatePort(),
);

function runtimeRecoveryStartupSnapshotFromState(
  snapshot: StructuredSessionSnapshot,
): RuntimeRecoveryStartupSnapshot {
  return {
    session: {
      id: snapshot.session.id as WorkspaceSessionId,
      orchestratorPiSessionId: snapshot.session.orchestratorPiSessionId as SurfacePiSessionId,
    },
    pi: {
      titleGenerationStatus: snapshot.pi.titleGenerationStatus ?? "not-started",
    },
    turns: snapshot.turns.map((turn) => ({
      id: turn.id as TurnId,
      status: turn.status,
      surfacePiSessionId: turn.surfacePiSessionId as SurfacePiSessionId,
      threadId: turn.threadId ? (turn.threadId as ThreadId) : null,
    })),
    queuedMessages: (snapshot.queuedMessages ?? []).map((message) => ({
      id: message.id as QueueItemId,
      status: message.status,
      surfacePiSessionId: message.surfacePiSessionId as SurfacePiSessionId,
      kind: message.kind,
      position: message.position,
    })),
    threads: snapshot.threads.map((thread) => ({
      id: thread.id as ThreadId,
      status: thread.status,
      surfacePiSessionId: thread.surfacePiSessionId as SurfacePiSessionId,
      title: thread.title,
      objective: thread.objective,
    })),
  };
}

function runtimeRecoveryWorkRecordFromState(
  work: StructuredRecoveryWorkRecord,
): RuntimeRecoveryWorkRecord {
  return {
    ...work,
    id: work.id as RecoveryWorkId,
    scope: runtimeRecoveryWorkScopeFromState(work.scope),
    claimedBy: work.claimedBy as RuntimeOwnerId | null,
    ownerScope: runtimeRecoveryWorkOwnerScopeFromState(work.ownerScope),
  };
}

function runtimeRecoveryWorkScopeFromState(
  scope: StructuredRecoveryWorkRecord["scope"],
): RuntimeRecoveryWorkScope {
  return scope.kind === "workspace"
    ? { kind: "workspace", workspaceId: scope.workspaceId as WorkspaceId }
    : { kind: "app" };
}

function runtimeRecoveryWorkOwnerScopeFromState(
  ownerScope: StructuredRecoveryWorkOwnerScope,
): RuntimeRecoveryWorkOwnerScope {
  switch (ownerScope.kind) {
    case "workspace":
      return ownerScope;
    case "workspace_session":
      return {
        kind: ownerScope.kind,
        workspaceSessionId: ownerScope.workspaceSessionId as WorkspaceSessionId,
      };
    case "surface":
      return {
        kind: ownerScope.kind,
        workspaceSessionId: ownerScope.workspaceSessionId as WorkspaceSessionId,
        surfacePiSessionId: ownerScope.surfacePiSessionId as SurfacePiSessionId,
      };
    case "thread":
      return {
        kind: ownerScope.kind,
        workspaceSessionId: ownerScope.workspaceSessionId as WorkspaceSessionId,
        threadId: ownerScope.threadId as ThreadId,
        surfacePiSessionId: ownerScope.surfacePiSessionId as SurfacePiSessionId,
      };
    case "workflow_run":
      return {
        kind: ownerScope.kind,
        workflowRunId: ownerScope.workflowRunId as WorkflowRunId,
        smithersRunId: ownerScope.smithersRunId,
      };
    case "queue_item":
      return {
        kind: ownerScope.kind,
        queuedItemId: ownerScope.queuedItemId as QueueItemId,
        surfacePiSessionId: ownerScope.surfacePiSessionId as SurfacePiSessionId,
      };
    case "title_job":
      return { kind: ownerScope.kind, titleJobId: ownerScope.titleJobId as TitleJobId };
  }
}
