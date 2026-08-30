import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeActorExtensionBindingStatePort,
  GeneratedContextPreviewSubjectStatePort,
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeComposerDraftStatePort,
  RuntimeComposerProfileStatePort,
  RuntimeEpisodeStatePort,
  RuntimeGeneratedPackageStatePort,
  PiSessionReferencePort,
  PiSessionReferencePortError,
  RuntimePromptDefaultsStatePort,
  RuntimeQueueStatePort,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeSourceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeThreadStatePort,
  RuntimeTranscriptStatePort,
  RuntimeTurnStatePort,
  RuntimeWorkflowTaskStatePort,
  RuntimeWorkspaceStatePort,
  RuntimeToolExecutionPolicyStatePort,
  StateContractError,
  type PromptTarget,
  type RuntimeSurfaceTarget,
  type RuntimeActorExtensionBindingStatePortService,
  type GeneratedContextPreviewSubjectStatePortService,
  type RuntimeApprovalRecord,
  type RuntimeApprovalStatePortService,
  type RuntimeCommandStatePortService,
  type RuntimeComposerDraftStatePortService,
  type RuntimeComposerProfileStatePortService,
  type RuntimeEpisodeStatePortService,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimeGeneratedPackageWorkspaceLinkRecord,
  type RuntimePromptDefaultsStatePortService,
  type RuntimeQueueStatePortService,
  type RuntimeRequestInputDetailsRecord,
  type RuntimeRequestStatePortService,
  type RuntimeSessionWaitStatePortService,
  type RuntimeSourceStatePortService,
  type RuntimeSurfaceLifecycleStatePortService,
  type RuntimeSurfaceMessageRecord,
  type RuntimeThreadStatePortService,
  type RuntimeTranscriptStatePortService,
  type RuntimeTurnStatePortService,
  type RuntimeWorkflowTaskStatePortService,
  type RuntimeWorkspaceStatePortService,
  type RuntimeToolExecutionPolicyStatePortService,
  type PiSessionReferencePortService,
  type SourceInvalidationScope,
  type StateMutationResult,
  type WorkspaceId,
} from "@svvy/core";
import { runtimeActorExtensionBindingStatePortFromStructuredSessionState } from "./runtime-actor-extension-binding-state-port";
import { generatedContextPreviewSubjectStatePortFromStructuredSessionState } from "./generated-context-preview-subject-state-port";
import { runtimeApprovalStatePortFromStructuredSessionState } from "./runtime-approval-state-port";
import { runtimeCommandStatePortFromStructuredSessionState } from "./runtime-command-state-port";
import { runtimeComposerDraftStatePortFromStructuredSessionState } from "./runtime-composer-draft-state-port";
import { runtimeComposerProfileStatePortFromStructuredSessionState } from "./runtime-composer-profile-state-port";
import { runtimeEpisodeStatePortFromStructuredSessionState } from "./runtime-episode-state-port";
import { runtimeGeneratedPackageStatePortFromStructuredSessionState } from "./runtime-generated-package-state-port";
import { runtimePromptDefaultsStatePortFromStructuredSessionState } from "./runtime-prompt-defaults-state-port";
import { piSessionReferencePortFromStructuredSessionState } from "./pi-session-reference-port";
import { runtimeQueueStatePortFromStructuredSessionState } from "./runtime-queue-state-port";
import { runtimeRequestStatePortFromStructuredSessionState } from "./runtime-request-state-port";
import { runtimeSessionWaitStatePortFromStructuredSessionState } from "./runtime-session-wait-state-port";
import { runtimeSourceStatePortFromStructuredSessionState } from "./runtime-source-state-port";
import { runtimeSurfaceLifecycleStatePortFromStructuredSessionState } from "./runtime-surface-lifecycle-state-port";
import { runtimeThreadStatePortFromStructuredSessionState } from "./runtime-thread-state-port";
import { runtimeTranscriptStatePortFromStructuredSessionState } from "./runtime-transcript-state-port";
import { runtimeTurnStatePortFromStructuredSessionState } from "./runtime-turn-state-port";
import { runtimeWorkflowTaskStatePortFromStructuredSessionState } from "./runtime-workflow-task-state-port";
import { runtimeWorkspaceStatePortFromStructuredSessionState } from "./runtime-workspace-state-port";
import {
  structuredSessionStateFromStore,
  type StructuredSessionState,
  type StructuredSessionStateStore,
} from "./structured-session-state";

export interface WorkspaceStateRegistration {
  readonly store: StructuredSessionStateStore;
  readonly isDefaultWorkspace?: boolean;
  readonly turnStatePort?: RuntimeTurnStatePortService;
}

export interface WorkspaceStateRouterInput {
  readonly appGlobalStore: StructuredSessionStateStore;
  readonly workspaceStores: readonly WorkspaceStateRegistration[];
}

export interface WorkspaceStateRouter {
  registerWorkspaceState(registration: WorkspaceStateRegistration): void;
  unregisterWorkspaceState(workspaceId: WorkspaceId): boolean;
  readonly workspace: RuntimeWorkspaceStatePortService;
  readonly toolExecutionPolicy: RuntimeToolExecutionPolicyStatePortService;
  readonly surfaceLifecycle: RuntimeSurfaceLifecycleStatePortService;
  readonly promptDefaults: RuntimePromptDefaultsStatePortService;
  readonly composerProfile: RuntimeComposerProfileStatePortService;
  readonly source: RuntimeSourceStatePortService;
  readonly generatedPackage: RuntimeGeneratedPackageStatePortService;
  readonly actorExtensionBinding: RuntimeActorExtensionBindingStatePortService;
  readonly generatedContextPreviewSubject: GeneratedContextPreviewSubjectStatePortService;
  readonly queue: RuntimeQueueStatePortService;
  readonly request: RuntimeRequestStatePortService;
  readonly approval: RuntimeApprovalStatePortService;
  readonly command: RuntimeCommandStatePortService;
  readonly composerDraft: RuntimeComposerDraftStatePortService;
  readonly sessionWait: RuntimeSessionWaitStatePortService;
  readonly thread: RuntimeThreadStatePortService;
  readonly transcript: RuntimeTranscriptStatePortService;
  readonly turn: RuntimeTurnStatePortService;
  readonly workflowTask: RuntimeWorkflowTaskStatePortService;
  readonly episode: RuntimeEpisodeStatePortService;
  readonly piSessionReference: PiSessionReferencePortService;
  readonly appGlobalStructuredSession: StructuredSessionState["Service"];
  readonly resolveRuntimeSurfaceStructuredSession: (
    target: RuntimeSurfaceTarget,
  ) => Effect.Effect<StructuredSessionState["Service"], StateContractError>;
  readonly resolveWorkspaceStructuredSession: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<StructuredSessionState["Service"], StateContractError>;
}

interface RegisteredStore {
  readonly store: StructuredSessionStateStore;
  readonly workspaceId: WorkspaceId;
  readonly cwd: string;
  readonly structuredSession: StructuredSessionState["Service"];
  readonly ports: {
    readonly workspace: RuntimeWorkspaceStatePortService;
    readonly surfaceLifecycle: RuntimeSurfaceLifecycleStatePortService;
    readonly promptDefaults: RuntimePromptDefaultsStatePortService;
    readonly composerProfile: RuntimeComposerProfileStatePortService;
    readonly source: RuntimeSourceStatePortService;
    readonly generatedPackage: RuntimeGeneratedPackageStatePortService;
    readonly actorExtensionBinding: RuntimeActorExtensionBindingStatePortService;
    readonly generatedContextPreviewSubject: GeneratedContextPreviewSubjectStatePortService;
    readonly queue: RuntimeQueueStatePortService;
    readonly request: RuntimeRequestStatePortService;
    readonly approval: RuntimeApprovalStatePortService;
    readonly command: RuntimeCommandStatePortService;
    readonly composerDraft: RuntimeComposerDraftStatePortService;
    readonly sessionWait: RuntimeSessionWaitStatePortService;
    readonly thread: RuntimeThreadStatePortService;
    readonly transcript: RuntimeTranscriptStatePortService;
    turn: RuntimeTurnStatePortService;
    readonly workflowTask: RuntimeWorkflowTaskStatePortService;
    readonly episode: RuntimeEpisodeStatePortService;
    readonly piSessionReference: PiSessionReferencePortService;
  };
}

function registerStore(registration: WorkspaceStateRegistration): RegisteredStore {
  const { store } = registration;
  const structuredSession = structuredSessionStateFromStore(store);
  return {
    store,
    workspaceId: store.workspaceId as WorkspaceId,
    cwd: store.getWorkspaceRecord().cwd,
    structuredSession,
    ports: {
      workspace: runtimeWorkspaceStatePortFromStructuredSessionState(structuredSession),
      surfaceLifecycle:
        runtimeSurfaceLifecycleStatePortFromStructuredSessionState(structuredSession),
      promptDefaults: runtimePromptDefaultsStatePortFromStructuredSessionState(structuredSession),
      composerProfile: runtimeComposerProfileStatePortFromStructuredSessionState(structuredSession),
      source: runtimeSourceStatePortFromStructuredSessionState(structuredSession),
      generatedPackage:
        runtimeGeneratedPackageStatePortFromStructuredSessionState(structuredSession),
      actorExtensionBinding:
        runtimeActorExtensionBindingStatePortFromStructuredSessionState(structuredSession),
      generatedContextPreviewSubject:
        generatedContextPreviewSubjectStatePortFromStructuredSessionState(structuredSession),
      queue: runtimeQueueStatePortFromStructuredSessionState(structuredSession),
      request: runtimeRequestStatePortFromStructuredSessionState(structuredSession),
      approval: runtimeApprovalStatePortFromStructuredSessionState(structuredSession),
      command: runtimeCommandStatePortFromStructuredSessionState(structuredSession),
      composerDraft: runtimeComposerDraftStatePortFromStructuredSessionState(structuredSession),
      sessionWait: runtimeSessionWaitStatePortFromStructuredSessionState(structuredSession),
      thread: runtimeThreadStatePortFromStructuredSessionState(structuredSession),
      transcript: runtimeTranscriptStatePortFromStructuredSessionState(structuredSession),
      turn:
        registration.turnStatePort ??
        runtimeTurnStatePortFromStructuredSessionState(structuredSession),
      workflowTask: runtimeWorkflowTaskStatePortFromStructuredSessionState(structuredSession),
      episode: runtimeEpisodeStatePortFromStructuredSessionState(structuredSession),
      piSessionReference: piSessionReferencePortFromStructuredSessionState(structuredSession),
    },
  };
}

function targetNotFound(operation: string, detail: string): StateContractError {
  return new StateContractError({
    operation: `workspace-state-router.${operation}`,
    reason: "not-found",
    message: `Workspace state router could not resolve a target store: ${detail}.`,
  });
}

interface FanOutSweepPartialFailurePayload<A> {
  readonly kind: "workspace-state-router.fan-out-sweep-partial-failure";
  readonly committed: StateMutationResult<readonly A[]>;
  readonly failures: readonly StateContractError[];
}

type FanOutSweepOutcome<A> =
  | { readonly ok: true; readonly result: StateMutationResult<readonly A[]> }
  | { readonly ok: false; readonly error: StateContractError };

type StoreProbe = (store: StructuredSessionStateStore) => boolean;

const surfaceProbe =
  (surfacePiSessionId: string): StoreProbe =>
  (store) =>
    store.getPiSessionReference({ surfacePiSessionId: surfacePiSessionId as never }) !== undefined;

const commandProbe =
  (commandId: string): StoreProbe =>
  (store) =>
    store.findCommandById(commandId) !== null;

const sessionProbe =
  (sessionId: string): StoreProbe =>
  (store) => {
    store.getSessionState(sessionId);
    return true;
  };

const turnProbe =
  (turnId: string): StoreProbe =>
  (store) =>
    store.listSessionStates().some((snapshot) => snapshot.turns.some((turn) => turn.id === turnId));

const attemptProbe =
  (workflowTaskAttemptId: string): StoreProbe =>
  (store) =>
    store
      .listSessionStates()
      .some((snapshot) =>
        snapshot.workflowTaskAttempts.some((attempt) => attempt.id === workflowTaskAttemptId),
      );

const queueItemProbe =
  (id: string): StoreProbe =>
  (store) => {
    store.getSurfaceQueuedMessage({ id });
    return true;
  };

const requestInputProbe =
  (requestId: string): StoreProbe =>
  (store) => {
    store.getRequestUserInputRequest(requestId);
    return true;
  };

const approvalProbe =
  (requestId: string): StoreProbe =>
  (store) => {
    store.getRuntimeApprovalRequest(requestId);
    return true;
  };

const threadProbe =
  (threadId: string): StoreProbe =>
  (store) => {
    store.getThreadDetail(threadId);
    return true;
  };

export function createWorkspaceStateRouter(input: WorkspaceStateRouterInput): WorkspaceStateRouter {
  const registrations = new Map<StructuredSessionStateStore, RegisteredStore>();
  const registerOnce = (registration: WorkspaceStateRegistration): RegisteredStore => {
    const existing = registrations.get(registration.store);
    if (existing) {
      if (registration.turnStatePort) existing.ports.turn = registration.turnStatePort;
      return existing;
    }
    const created = registerStore(registration);
    registrations.set(registration.store, created);
    return created;
  };

  const appGlobal = registerOnce({ store: input.appGlobalStore });
  const workspaceRegistrations = new Map<
    string,
    { readonly registered: RegisteredStore; readonly isDefaultWorkspace: boolean }
  >();
  const allStores: RegisteredStore[] = [];
  const byWorkspaceId = new Map<string, RegisteredStore>();
  let defaultWorkspace: RegisteredStore | undefined;

  const rebuildIndexes = () => {
    allStores.length = 0;
    byWorkspaceId.clear();
    defaultWorkspace = undefined;

    for (const registration of workspaceRegistrations.values()) {
      if (!allStores.includes(registration.registered)) {
        allStores.push(registration.registered);
      }
      if (registration.isDefaultWorkspace && !defaultWorkspace) {
        defaultWorkspace = registration.registered;
      }
    }
    if (!allStores.includes(appGlobal)) allStores.push(appGlobal);

    for (const registered of allStores) {
      if (!byWorkspaceId.has(registered.workspaceId)) {
        byWorkspaceId.set(registered.workspaceId, registered);
      }
    }
  };

  const registerWorkspaceState = (registration: WorkspaceStateRegistration): void => {
    const registered = registerOnce(registration);
    workspaceRegistrations.set(registered.workspaceId, {
      registered,
      isDefaultWorkspace: registration.isDefaultWorkspace === true,
    });
    rebuildIndexes();
  };

  for (const registration of input.workspaceStores) {
    registerWorkspaceState(registration);
  }

  const resolveWorkspace = (
    operation: string,
    workspaceId: string,
  ): Effect.Effect<RegisteredStore, StateContractError> => {
    const registered = byWorkspaceId.get(workspaceId);
    return registered
      ? Effect.succeed(registered)
      : Effect.fail(
          targetNotFound(operation, `no workspace store registered for workspaceId ${workspaceId}`),
        );
  };

  const resolveScope = (
    operation: string,
    scope: SourceInvalidationScope,
  ): Effect.Effect<RegisteredStore, StateContractError> =>
    scope.kind === "app-global"
      ? Effect.succeed(appGlobal)
      : resolveWorkspace(operation, scope.workspaceId);

  const resolveDefault = (operation: string): Effect.Effect<RegisteredStore, StateContractError> =>
    defaultWorkspace
      ? Effect.succeed(defaultWorkspace)
      : Effect.fail(targetNotFound(operation, "no default workspace store registered"));

  const resolveCwd = (
    operation: string,
    cwd: string,
  ): Effect.Effect<RegisteredStore, StateContractError> => {
    const registered = allStores.find((candidate) => candidate.cwd === cwd);
    return registered
      ? Effect.succeed(registered)
      : Effect.fail(targetNotFound(operation, `no workspace store registered for cwd ${cwd}`));
  };

  const locate = (
    operation: string,
    detail: string,
    probes: readonly StoreProbe[],
  ): Effect.Effect<RegisteredStore, StateContractError> =>
    Effect.suspend(() => {
      for (const probe of probes) {
        for (const registered of allStores) {
          let owned = false;
          try {
            owned = probe(registered.store);
          } catch {
            owned = false;
          }
          if (owned) return Effect.succeed(registered);
        }
      }
      return Effect.fail(targetNotFound(operation, detail));
    });

  const locatePromptTarget = (
    operation: string,
    target: PromptTarget,
  ): Effect.Effect<RegisteredStore, StateContractError> =>
    locate(operation, `no store owns prompt target surface ${target.surfacePiSessionId}`, [
      surfaceProbe(target.surfacePiSessionId),
      sessionProbe(target.workspaceSessionId),
    ]);

  const locateRuntimeSurfaceTarget = (
    operation: string,
    target: RuntimeSurfaceTarget,
  ): Effect.Effect<RegisteredStore, StateContractError> =>
    locate(operation, `no store owns runtime surface ${target.surfacePiSessionId}`, [
      surfaceProbe(target.surfacePiSessionId),
      sessionProbe(target.workspaceSessionId),
    ]);

  const via = <A>(
    resolve: Effect.Effect<RegisteredStore, StateContractError>,
    run: (registered: RegisteredStore) => Effect.Effect<A, StateContractError>,
  ): Effect.Effect<A, StateContractError> => resolve.pipe(Effect.flatMap(run));

  const viaPiReference = <A>(
    resolve: Effect.Effect<RegisteredStore, StateContractError>,
    run: (registered: RegisteredStore) => Effect.Effect<A, PiSessionReferencePortError>,
  ): Effect.Effect<A, PiSessionReferencePortError> =>
    resolve.pipe(
      Effect.mapError(
        (cause) =>
          new PiSessionReferencePortError({
            operation: "workspace-state-router.piSessionReference.resolve",
            reason: cause.reason === "invalid-input" ? "invalid-input" : "state-conflict",
            message: cause.message,
            cause,
          }),
      ),
      Effect.flatMap(run),
    );

  const fanOutList = <A>(
    run: (registered: RegisteredStore) => Effect.Effect<readonly A[], StateContractError>,
  ): Effect.Effect<readonly A[], StateContractError> =>
    Effect.forEach(allStores, run).pipe(Effect.map((lists) => lists.flatMap((list) => list)));

  const fanOutMutationList = <A>(
    operation: string,
    run: (
      registered: RegisteredStore,
    ) => Effect.Effect<StateMutationResult<readonly A[]>, StateContractError>,
  ): Effect.Effect<StateMutationResult<readonly A[]>, StateContractError> =>
    Effect.forEach(allStores, (registered) =>
      Effect.matchEffect(run(registered), {
        onFailure: (error): Effect.Effect<FanOutSweepOutcome<A>> =>
          Effect.succeed({ ok: false, error }),
        onSuccess: (result): Effect.Effect<FanOutSweepOutcome<A>> =>
          Effect.succeed({ ok: true, result }),
      }),
    ).pipe(
      Effect.flatMap((outcomes) => {
        const committed: StateMutationResult<readonly A[]> = {
          value: outcomes.flatMap((outcome) => (outcome.ok ? outcome.result.value : [])),
          afterCommit: outcomes.flatMap((outcome) =>
            outcome.ok ? outcome.result.afterCommit : [],
          ),
        };
        const failures = outcomes.flatMap((outcome) => (outcome.ok ? [] : [outcome.error]));
        if (failures.length === 0) return Effect.succeed(committed);
        return Effect.fail(
          new StateContractError({
            operation: `workspace-state-router.${operation}`,
            reason: "transaction-failed",
            message: `Workspace state router ${operation} fan-out failed for ${failures.length} of ${allStores.length} store(s); ${committed.afterCommit.length} committed after-commit descriptor(s) preserved.`,
            cause: {
              kind: "workspace-state-router.fan-out-sweep-partial-failure",
              committed,
              failures,
            } satisfies FanOutSweepPartialFailurePayload<A>,
          }),
        );
      }),
    );

  const workspace: RuntimeWorkspaceStatePortService = {
    resolvePromptTargetWorkspaceId: ({ target }) =>
      locatePromptTarget("resolvePromptTargetWorkspaceId", target).pipe(
        Effect.map((registered) => registered.workspaceId),
      ),
    acquireWorkspace: (request) =>
      via(resolveCwd("acquireWorkspace", request.cwd), (registered) =>
        registered.ports.workspace.acquireWorkspace(request),
      ),
    acquireDefaultWorkspace: (request) =>
      via(resolveDefault("acquireDefaultWorkspace"), (registered) =>
        registered.ports.workspace.acquireDefaultWorkspace(request),
      ),
    releaseWorkspace: (request) =>
      via(resolveWorkspace("releaseWorkspace", request.workspaceId), (registered) =>
        registered.ports.workspace.releaseWorkspace(request),
      ),
  };

  const toolExecutionPolicy: RuntimeToolExecutionPolicyStatePortService = {
    readPolicy: ({ workspaceId }) =>
      resolveWorkspace("readToolExecutionPolicy", workspaceId).pipe(
        Effect.flatMap((registered) =>
          appGlobal.structuredSession.readAppPreferences().pipe(
            Effect.map((preferences) => ({
              approvalMode: preferences.approvalMode,
              cwd: registered.cwd as import("@svvy/core").AbsolutePath,
            })),
          ),
        ),
      ),
  };

  const surfaceLifecycle: RuntimeSurfaceLifecycleStatePortService = {
    createOrchestratorSurface: (request) =>
      via(resolveWorkspace("createOrchestratorSurface", request.workspaceId), (registered) =>
        registered.ports.surfaceLifecycle.createOrchestratorSurface(request),
      ),
    openSurface: (request) =>
      via(resolveWorkspace("openSurface", request.workspaceId), (registered) =>
        registered.ports.surfaceLifecycle.openSurface(request),
      ),
    closeSurface: (request) =>
      via(resolveWorkspace("closeSurface", request.workspaceId), (registered) =>
        registered.ports.surfaceLifecycle.closeSurface(request),
      ),
    readOrchestratorLifecycle: (request) =>
      via(resolveWorkspace("readOrchestratorLifecycle", request.workspaceId), (registered) =>
        registered.ports.surfaceLifecycle.readOrchestratorLifecycle(request),
      ),
    renameOrchestrator: (request) =>
      via(resolveWorkspace("renameOrchestrator", request.workspaceId), (registered) =>
        registered.ports.surfaceLifecycle.renameOrchestrator(request),
      ),
    forkOrchestrator: (request) =>
      via(resolveWorkspace("forkOrchestrator", request.workspaceId), (registered) =>
        registered.ports.surfaceLifecycle.forkOrchestrator(request),
      ),
    deleteOrchestrator: (request) =>
      via(resolveWorkspace("deleteOrchestrator", request.workspaceId), (registered) =>
        registered.ports.surfaceLifecycle.deleteOrchestrator(request),
      ),
  };

  const promptDefaults: RuntimePromptDefaultsStatePortService = {
    resolvePromptDefaults: (request) =>
      via(locatePromptTarget("resolvePromptDefaults", request.target), (registered) =>
        registered.ports.promptDefaults.resolvePromptDefaults(request),
      ),
    updatePromptDefaults: (request) =>
      via(locatePromptTarget("updatePromptDefaults", request.target), (registered) =>
        registered.ports.promptDefaults.updatePromptDefaults(request),
      ),
  };

  const composerProfile: RuntimeComposerProfileStatePortService = {
    readSurfaceProfileId: (request) =>
      via(locatePromptTarget("readSurfaceProfileId", request.target), (registered) =>
        registered.ports.composerProfile.readSurfaceProfileId(request),
      ),
    updateFromComposer: (request) => appGlobal.ports.composerProfile.updateFromComposer(request),
  };

  const source: RuntimeSourceStatePortService = {
    readSourceVersion: (request) =>
      via(resolveScope("readSourceVersion", request.scope), (registered) =>
        registered.ports.source.readSourceVersion(request),
      ),
    recordSourceSave: (request) =>
      via(resolveScope("recordSourceSave", request.scope), (registered) =>
        registered.ports.source.recordSourceSave(request),
      ),
    recordSourceDelete: (request) =>
      via(resolveScope("recordSourceDelete", request.scope), (registered) =>
        registered.ports.source.recordSourceDelete(request),
      ),
    recordWorkflowAgentSourceSave: (request) =>
      via(resolveScope("recordWorkflowAgentSourceSave", { kind: "app-global" }), (registered) =>
        registered.ports.source.recordWorkflowAgentSourceSave(request),
      ),
    recordWorkflowAgentSourceDelete: (request) =>
      via(resolveScope("recordWorkflowAgentSourceDelete", { kind: "app-global" }), (registered) =>
        registered.ports.source.recordWorkflowAgentSourceDelete(request),
      ),
    reconcileWorkflowAgentSources: (request) =>
      via(resolveScope("reconcileWorkflowAgentSources", { kind: "app-global" }), (registered) =>
        registered.ports.source.reconcileWorkflowAgentSources(request),
      ),
    recordSourceScan: (request) =>
      via(resolveScope("recordSourceScan", request.scope), (registered) =>
        registered.ports.source.recordSourceScan(request),
      ),
    reconcileDiscoveredHostSnippets: (request) =>
      via(resolveScope("reconcileDiscoveredHostSnippets", request.scope), (registered) =>
        registered.ports.source.reconcileDiscoveredHostSnippets(request),
      ),
    recordObservedSourceDeletion: (request) =>
      via(resolveScope("recordObservedSourceDeletion", request.scope), (registered) =>
        registered.ports.source.recordObservedSourceDeletion(request),
      ),
    recordSourceDiagnostic: (request) =>
      via(resolveScope("recordSourceDiagnostic", request.scope), (registered) =>
        registered.ports.source.recordSourceDiagnostic(request),
      ),
  };

  const generatedPackage: RuntimeGeneratedPackageStatePortService = {
    recordGeneratedPackageBuild: (request) =>
      appGlobal.ports.generatedPackage.recordGeneratedPackageBuild(request),
    recordGeneratedPackageFailure: (request) =>
      appGlobal.ports.generatedPackage.recordGeneratedPackageFailure(request),
    recordWorkspaceLinkStatus: (request) =>
      via(resolveWorkspace("recordWorkspaceLinkStatus", request.status.workspaceId), (registered) =>
        registered.ports.generatedPackage.recordWorkspaceLinkStatus(request),
      ),
    markWorkspaceLinksRepairNeeded: (request) =>
      via(resolveWorkspace("markWorkspaceLinksRepairNeeded", request.workspaceId), (registered) =>
        registered.ports.generatedPackage.markWorkspaceLinksRepairNeeded(request),
      ),
    readLinksNeedingRepair: (request) =>
      request?.workspaceId
        ? via(resolveWorkspace("readLinksNeedingRepair", request.workspaceId), (registered) =>
            registered.ports.generatedPackage.readLinksNeedingRepair(request),
          )
        : fanOutList<RuntimeGeneratedPackageWorkspaceLinkRecord>((registered) =>
            registered.ports.generatedPackage.readLinksNeedingRepair(request),
          ),
    readGeneratedPackageFacts: (request) =>
      appGlobal.ports.generatedPackage.readGeneratedPackageFacts(request),
    reconcileGeneratedPackageManifest: (request) =>
      appGlobal.ports.generatedPackage.reconcileGeneratedPackageManifest(request),
    markGeneratedPackageRefreshNeeded: (request) =>
      appGlobal.ports.generatedPackage.markGeneratedPackageRefreshNeeded(request),
  };

  const actorExtensionBinding: RuntimeActorExtensionBindingStatePortService = {
    readRuntimePromptBinding: (request) =>
      via(locateRuntimeSurfaceTarget("readRuntimePromptBinding", request.target), (registered) =>
        registered.ports.actorExtensionBinding.readRuntimePromptBinding(request),
      ),
    readGeneratedContextBuildSubject: (request) =>
      via(
        locateRuntimeSurfaceTarget("readGeneratedContextBuildSubject", request.target),
        (registered) =>
          registered.ports.actorExtensionBinding.readGeneratedContextBuildSubject(request),
      ),
    bindGeneratedContext: (request) =>
      via(locateRuntimeSurfaceTarget("bindGeneratedContext", request.target), (registered) =>
        registered.ports.actorExtensionBinding.bindGeneratedContext(request),
      ),
    updateActorExtensionBinding: (request) =>
      via(locatePromptTarget("updateActorExtensionBinding", request.target), (registered) =>
        registered.ports.actorExtensionBinding.updateActorExtensionBinding(request),
      ),
    setActorExtensionBinding: (request) =>
      via(locatePromptTarget("setActorExtensionBinding", request.target), (registered) =>
        registered.ports.actorExtensionBinding.setActorExtensionBinding(request),
      ),
  };

  const generatedContextPreviewSubject: GeneratedContextPreviewSubjectStatePortService = {
    readSubject: (request) =>
      via(resolveWorkspace("readGeneratedContextPreviewSubject", request.workspaceId), () =>
        appGlobal.ports.generatedContextPreviewSubject.readSubject(request),
      ),
  };

  const queue: RuntimeQueueStatePortService = {
    acceptSubmittedSurfaceMessage: (request) =>
      via(locatePromptTarget("acceptSubmittedSurfaceMessage", request.target), (registered) =>
        registered.ports.queue.acceptSubmittedSurfaceMessage(request),
      ),
    acceptEditedCommittedSurfaceMessage: (request) =>
      via(locatePromptTarget("acceptEditedCommittedSurfaceMessage", request.target), (registered) =>
        registered.ports.queue.acceptEditedCommittedSurfaceMessage(request),
      ),
    enqueueSurfaceMessage: (request) =>
      via(
        locate("enqueueSurfaceMessage", `no store owns surface ${request.surfacePiSessionId}`, [
          surfaceProbe(request.surfacePiSessionId),
          sessionProbe(request.sessionId),
        ]),
        (registered) => registered.ports.queue.enqueueSurfaceMessage(request),
      ),
    getSurfaceQueuedMessage: (request) =>
      via(
        locate("getSurfaceQueuedMessage", `no store owns queue item ${request.id}`, [
          queueItemProbe(request.id),
        ]),
        (registered) => registered.ports.queue.getSurfaceQueuedMessage(request),
      ),
    claimNextQueuedSurfaceMessage: (request) =>
      via(
        locate(
          "claimNextQueuedSurfaceMessage",
          `no store owns surface ${request.surfacePiSessionId}`,
          [surfaceProbe(request.surfacePiSessionId)],
        ),
        (registered) => registered.ports.queue.claimNextQueuedSurfaceMessage(request),
      ),
    releaseExpiredSurfaceMessageClaims: (request) =>
      request?.surfacePiSessionId
        ? via(
            locate(
              "releaseExpiredSurfaceMessageClaims",
              `no store owns surface ${request.surfacePiSessionId}`,
              [surfaceProbe(request.surfacePiSessionId)],
            ),
            (registered) => registered.ports.queue.releaseExpiredSurfaceMessageClaims(request),
          )
        : fanOutMutationList<RuntimeSurfaceMessageRecord>(
            "releaseExpiredSurfaceMessageClaims",
            (registered) => registered.ports.queue.releaseExpiredSurfaceMessageClaims(request),
          ),
    markSurfaceMessageSteering: (request) =>
      via(
        locate("markSurfaceMessageSteering", `no store owns queue item ${request.id}`, [
          queueItemProbe(request.id),
        ]),
        (registered) => registered.ports.queue.markSurfaceMessageSteering(request),
      ),
    markSurfaceMessageQueued: (request) =>
      via(
        locate("markSurfaceMessageQueued", `no store owns queue item ${request.id}`, [
          queueItemProbe(request.id),
        ]),
        (registered) => registered.ports.queue.markSurfaceMessageQueued(request),
      ),
    markSurfaceMessageDelivered: (request) =>
      via(
        locate("markSurfaceMessageDelivered", `no store owns queue item ${request.id}`, [
          queueItemProbe(request.id),
        ]),
        (registered) => registered.ports.queue.markSurfaceMessageDelivered(request),
      ),
    markSurfaceMessageFailed: (request) =>
      via(
        locate("markSurfaceMessageFailed", `no store owns queue item ${request.id}`, [
          queueItemProbe(request.id),
        ]),
        (registered) => registered.ports.queue.markSurfaceMessageFailed(request),
      ),
    cancelSurfaceMessage: (request) =>
      via(
        locate("cancelSurfaceMessage", `no store owns queue item ${request.id}`, [
          queueItemProbe(request.id),
        ]),
        (registered) => registered.ports.queue.cancelSurfaceMessage(request),
      ),
    reorderSurfaceMessage: (request) =>
      via(
        locate("reorderSurfaceMessage", `no store owns surface ${request.surfacePiSessionId}`, [
          surfaceProbe(request.surfacePiSessionId),
        ]),
        (registered) => registered.ports.queue.reorderSurfaceMessage(request),
      ),
  };

  const request: RuntimeRequestStatePortService = {
    readRequestInputSettings: () => appGlobal.ports.request.readRequestInputSettings(),
    setRequestInputVariant: (input_) => appGlobal.ports.request.setRequestInputVariant(input_),
    setRequestInputBlockingTimeout: (input_) =>
      appGlobal.ports.request.setRequestInputBlockingTimeout(input_),
    createRequestInput: (input_) =>
      via(locatePromptTarget("createRequestInput", input_.target), (registered) =>
        registered.ports.request.createRequestInput(input_),
      ),
    getRequestInput: (input_) =>
      via(
        locate("getRequestInput", `no store owns request input ${input_.requestId}`, [
          requestInputProbe(input_.requestId),
        ]),
        (registered) => registered.ports.request.getRequestInput(input_),
      ),
    listOpenBlockingRequestInputs: (input_) => {
      if (input_?.surfacePiSessionId) {
        return via(
          locate(
            "listOpenBlockingRequestInputs",
            `no store owns surface ${input_.surfacePiSessionId}`,
            [surfaceProbe(input_.surfacePiSessionId)],
          ),
          (registered) => registered.ports.request.listOpenBlockingRequestInputs(input_),
        );
      }
      if (input_?.workspaceSessionId) {
        return via(
          locate(
            "listOpenBlockingRequestInputs",
            `no store owns session ${input_.workspaceSessionId}`,
            [sessionProbe(input_.workspaceSessionId)],
          ),
          (registered) => registered.ports.request.listOpenBlockingRequestInputs(input_),
        );
      }
      return fanOutList<RuntimeRequestInputDetailsRecord>((registered) =>
        registered.ports.request.listOpenBlockingRequestInputs(input_),
      );
    },
    answerRequestInput: (input_) =>
      via(
        locate("answerRequestInput", `no store owns surface ${input_.surfacePiSessionId}`, [
          surfaceProbe(input_.surfacePiSessionId),
          requestInputProbe(input_.requestId),
        ]),
        (registered) => registered.ports.request.answerRequestInput(input_),
      ),
    defaultOpenRequestInputQuestions: (input_) =>
      via(
        locate(
          "defaultOpenRequestInputQuestions",
          `no store owns request input ${input_.requestId}`,
          [requestInputProbe(input_.requestId)],
        ),
        (registered) => registered.ports.request.defaultOpenRequestInputQuestions(input_),
      ),
    cancelRequestInput: (input_) =>
      via(
        locate("cancelRequestInput", `no store owns request input ${input_.requestId}`, [
          requestInputProbe(input_.requestId),
        ]),
        (registered) => registered.ports.request.cancelRequestInput(input_),
      ),
    setRequestInputTimerPaused: (input_) =>
      via(
        locate("setRequestInputTimerPaused", `no store owns surface ${input_.surfacePiSessionId}`, [
          surfaceProbe(input_.surfacePiSessionId),
          requestInputProbe(input_.requestId),
        ]),
        (registered) => registered.ports.request.setRequestInputTimerPaused(input_),
      ),
  };

  const approval: RuntimeApprovalStatePortService = {
    createApprovalRequest: (input_) =>
      via(
        locate("createApprovalRequest", `no store owns surface ${input_.surfacePiSessionId}`, [
          surfaceProbe(input_.surfacePiSessionId),
          sessionProbe(input_.sessionId),
        ]),
        (registered) => registered.ports.approval.createApprovalRequest(input_),
      ),
    resolveApprovalRequest: (input_) =>
      via(
        locate("resolveApprovalRequest", `no store owns approval ${input_.requestId}`, [
          approvalProbe(input_.requestId),
        ]),
        (registered) => registered.ports.approval.resolveApprovalRequest(input_),
      ),
    getApprovalRequest: (input_) =>
      via(
        locate("getApprovalRequest", `no store owns approval ${input_.requestId}`, [
          approvalProbe(input_.requestId),
        ]),
        (registered) => registered.ports.approval.getApprovalRequest(input_),
      ),
    listOpenApprovalRequests: (input_) =>
      input_?.surfacePiSessionId
        ? via(
            locate(
              "listOpenApprovalRequests",
              `no store owns surface ${input_.surfacePiSessionId}`,
              [surfaceProbe(input_.surfacePiSessionId)],
            ),
            (registered) => registered.ports.approval.listOpenApprovalRequests(input_),
          )
        : fanOutList<RuntimeApprovalRecord>((registered) =>
            registered.ports.approval.listOpenApprovalRequests(input_),
          ),
  };

  const commandCreateProbes = (input_: {
    readonly surfacePiSessionId?: string;
    readonly turnId?: string | null;
    readonly workflowTaskAttemptId?: string | null;
  }): readonly StoreProbe[] => {
    const probes: StoreProbe[] = [];
    if (input_.surfacePiSessionId) probes.push(surfaceProbe(input_.surfacePiSessionId));
    if (input_.turnId) probes.push(turnProbe(input_.turnId));
    if (input_.workflowTaskAttemptId) probes.push(attemptProbe(input_.workflowTaskAttemptId));
    return probes;
  };

  const command: RuntimeCommandStatePortService = {
    createCommand: (input_) =>
      via(
        locate("createCommand", "no store owns the command owner row", commandCreateProbes(input_)),
        (registered) => registered.ports.command.createCommand(input_),
      ),
    createOrReuseStreamingCommand: (input_) =>
      via(
        locate(
          "createOrReuseStreamingCommand",
          "no store owns the command owner row",
          commandCreateProbes(input_),
        ),
        (registered) => registered.ports.command.createOrReuseStreamingCommand(input_),
      ),
    findCommandByToolCallId: (input_) =>
      via(
        locate(
          "findCommandByToolCallId",
          input_.surfacePiSessionId
            ? `no store owns surface ${input_.surfacePiSessionId}`
            : "findCommandByToolCallId requires surfacePiSessionId for routing",
          input_.surfacePiSessionId ? [surfaceProbe(input_.surfacePiSessionId)] : [],
        ),
        (registered) => registered.ports.command.findCommandByToolCallId(input_),
      ),
    findCommandById: (input_) =>
      via(
        locate("findCommandById", `no store owns command ${input_.commandId}`, [
          commandProbe(input_.commandId),
        ]),
        (registered) => registered.ports.command.findCommandById(input_),
      ),
    updateCommandArguments: (input_) =>
      via(
        locate("updateCommandArguments", `no store owns command ${input_.commandId}`, [
          commandProbe(input_.commandId),
        ]),
        (registered) => registered.ports.command.updateCommandArguments(input_),
      ),
    startCommand: (input_) =>
      via(
        locate("startCommand", `no store owns command ${input_.commandId}`, [
          commandProbe(input_.commandId),
        ]),
        (registered) => registered.ports.command.startCommand(input_),
      ),
    finishCommand: (input_) =>
      via(
        locate("finishCommand", `no store owns command ${input_.commandId}`, [
          commandProbe(input_.commandId),
        ]),
        (registered) => registered.ports.command.finishCommand(input_),
      ),
    recordCommandEvent: (input_) =>
      via(
        locate("recordCommandEvent", `no store owns command ${input_.commandId}`, [
          sessionProbe(input_.sessionId),
          commandProbe(input_.commandId),
        ]),
        (registered) => registered.ports.command.recordCommandEvent(input_),
      ),
    recordStdinWrite: (input_) =>
      via(
        locate("recordStdinWrite", `no store owns command ${input_.commandId}`, [
          sessionProbe(input_.sessionId),
          commandProbe(input_.commandId),
        ]),
        (registered) => registered.ports.command.recordStdinWrite(input_),
      ),
    hasCommandOutputEvent: (input_) =>
      via(
        locate("hasCommandOutputEvent", `no store owns session ${input_.sessionId}`, [
          sessionProbe(input_.sessionId),
        ]),
        (registered) => registered.ports.command.hasCommandOutputEvent(input_),
      ),
  };

  const composerDraft: RuntimeComposerDraftStatePortService = {
    setDraft: (input_) =>
      via(locatePromptTarget("setComposerDraft", input_.target), (registered) =>
        registered.ports.composerDraft.setDraft(input_),
      ),
    clearSubmittedDraft: (input_) =>
      via(locatePromptTarget("clearSubmittedComposerDraft", input_.target), (registered) =>
        registered.ports.composerDraft.clearSubmittedDraft(input_),
      ),
  };

  const sessionWait: RuntimeSessionWaitStatePortService = {
    setApprovalWait: (input_) =>
      via(
        locate("setApprovalWait", `no store owns session ${input_.sessionId}`, [
          sessionProbe(input_.sessionId),
        ]),
        (registered) => registered.ports.sessionWait.setApprovalWait(input_),
      ),
    setUserWait: (input_) =>
      via(
        locate("setUserWait", `no store owns session ${input_.sessionId}`, [
          sessionProbe(input_.sessionId),
        ]),
        (registered) => registered.ports.sessionWait.setUserWait(input_),
      ),
    clearSessionWait: (input_) =>
      via(
        locate("clearSessionWait", `no store owns session ${input_.sessionId}`, [
          sessionProbe(input_.sessionId),
        ]),
        (registered) => registered.ports.sessionWait.clearSessionWait(input_),
      ),
  };

  const thread: RuntimeThreadStatePortService = {
    ensureHandlerThreadRunnable: (input_) =>
      via(
        locate(
          "ensureHandlerThreadRunnable",
          `no store owns surface ${input_.surfacePiSessionId}`,
          [surfaceProbe(input_.surfacePiSessionId), sessionProbe(input_.workspaceSessionId)],
        ),
        (registered) => registered.ports.thread.ensureHandlerThreadRunnable(input_),
      ),
    startHandlerThreads: (input_) =>
      via(
        locate("startHandlerThreads", `no store owns session ${input_.workspaceSessionId}`, [
          sessionProbe(input_.workspaceSessionId),
        ]),
        (registered) => registered.ports.thread.startHandlerThreads(input_),
      ),
  };

  const transcript: RuntimeTranscriptStatePortService = {
    commitUserMessage: (input_) =>
      via(
        locate(
          "commitTranscriptUserMessage",
          `no store owns surface ${input_.surfacePiSessionId}`,
          [surfaceProbe(input_.surfacePiSessionId), sessionProbe(input_.workspaceSessionId)],
        ),
        (registered) => registered.ports.transcript.commitUserMessage(input_),
      ),
    beginAssistantMessage: (input_) =>
      via(
        locate(
          "beginTranscriptAssistantMessage",
          `no store owns surface ${input_.surfacePiSessionId}`,
          [surfaceProbe(input_.surfacePiSessionId), sessionProbe(input_.workspaceSessionId)],
        ),
        (registered) => registered.ports.transcript.beginAssistantMessage(input_),
      ),
    appendAssistantContentDelta: (input_) =>
      via(
        locate(
          "appendTranscriptAssistantContentDelta",
          `no store owns surface ${input_.surfacePiSessionId}`,
          [surfaceProbe(input_.surfacePiSessionId)],
        ),
        (registered) => registered.ports.transcript.appendAssistantContentDelta(input_),
      ),
    upsertAssistantToolCall: (input_) =>
      via(
        locate(
          "upsertTranscriptAssistantToolCall",
          `no store owns surface ${input_.surfacePiSessionId}`,
          [surfaceProbe(input_.surfacePiSessionId)],
        ),
        (registered) => registered.ports.transcript.upsertAssistantToolCall(input_),
      ),
    linkAssistantToolCallCommand: (input_) =>
      via(
        locate(
          "linkTranscriptAssistantToolCallCommand",
          `no store owns surface ${input_.surfacePiSessionId}`,
          [surfaceProbe(input_.surfacePiSessionId)],
        ),
        (registered) => registered.ports.transcript.linkAssistantToolCallCommand(input_),
      ),
    commitAssistantMessage: (input_) =>
      via(
        locate(
          "commitTranscriptAssistantMessage",
          `no store owns surface ${input_.surfacePiSessionId}`,
          [surfaceProbe(input_.surfacePiSessionId)],
        ),
        (registered) => registered.ports.transcript.commitAssistantMessage(input_),
      ),
    failAssistantMessage: (input_) =>
      via(
        locate(
          "failTranscriptAssistantMessage",
          `no store owns surface ${input_.surfacePiSessionId}`,
          [surfaceProbe(input_.surfacePiSessionId)],
        ),
        (registered) => registered.ports.transcript.failAssistantMessage(input_),
      ),
    bindPiHistoryEntry: (input_) =>
      via(
        locate(
          "bindTranscriptPiHistoryEntry",
          `no store owns surface ${input_.piHistoryEntry.session.surfacePiSessionId}`,
          [surfaceProbe(input_.piHistoryEntry.session.surfacePiSessionId)],
        ),
        (registered) => registered.ports.transcript.bindPiHistoryEntry(input_),
      ),
    advanceStreamCursor: (input_) =>
      via(
        locate(
          "advanceTranscriptStreamCursor",
          `no store owns surface ${input_.surfacePiSessionId}`,
          [surfaceProbe(input_.surfacePiSessionId)],
        ),
        (registered) => registered.ports.transcript.advanceStreamCursor(input_),
      ),
    readSurfaceTranscript: (input_) =>
      via(
        locate("readSurfaceTranscript", `no store owns surface ${input_.surfacePiSessionId}`, [
          surfaceProbe(input_.surfacePiSessionId),
        ]),
        (registered) => registered.ports.transcript.readSurfaceTranscript(input_),
      ),
  };

  const turn: RuntimeTurnStatePortService = {
    startTurn: (input_) =>
      via(
        locate("startTurn", `no store owns surface ${input_.surfacePiSessionId}`, [
          surfaceProbe(input_.surfacePiSessionId),
          sessionProbe(input_.sessionId),
        ]),
        (registered) => registered.ports.turn.startTurn(input_),
      ),
    queueTopLevelTitleGeneration: (input_) =>
      via(
        locate("queueTopLevelTitleGeneration", `no store owns session ${input_.sessionId}`, [
          sessionProbe(input_.sessionId),
          surfaceProbe(input_.surfacePiSessionId),
        ]),
        (registered) => registered.ports.turn.queueTopLevelTitleGeneration(input_),
      ),
    setTurnDecision: (input_) =>
      via(
        locate("setTurnDecision", `no store owns turn ${input_.turnId}`, [
          turnProbe(input_.turnId),
        ]),
        (registered) => registered.ports.turn.setTurnDecision(input_),
      ),
    finishTurn: (input_) =>
      via(
        locate("finishTurn", `no store owns turn ${input_.turnId}`, [turnProbe(input_.turnId)]),
        (registered) => registered.ports.turn.finishTurn(input_),
      ),
    recoverInterruptedTurn: (input_) =>
      via(
        locate("recoverInterruptedTurn", `no store owns turn ${input_.turnId}`, [
          turnProbe(input_.turnId),
        ]),
        (registered) => registered.ports.turn.recoverInterruptedTurn(input_),
      ),
    settlePromptTurn: (input_) =>
      via(
        locate("settlePromptTurn", `no store owns turn ${input_.turnId}`, [
          turnProbe(input_.turnId),
        ]),
        (registered) => registered.ports.turn.settlePromptTurn(input_),
      ),
  };

  const workflowTask: RuntimeWorkflowTaskStatePortService = {
    acceptWorkflowTaskAgentStart: (input_) =>
      via(
        locate(
          "acceptWorkflowTaskAgentStart",
          `no store owns session ${input_.workspaceSessionId}`,
          [sessionProbe(input_.workspaceSessionId)],
        ),
        (registered) => registered.ports.workflowTask.acceptWorkflowTaskAgentStart(input_),
      ),
    getWorkflowTaskAgentAttemptTerminal: (input_) =>
      via(
        locate(
          "getWorkflowTaskAgentAttemptTerminal",
          `no store owns session ${input_.workspaceSessionId}`,
          [sessionProbe(input_.workspaceSessionId)],
        ),
        (registered) => registered.ports.workflowTask.getWorkflowTaskAgentAttemptTerminal(input_),
      ),
    settleWorkflowTaskAgentAttempt: (input_) =>
      via(
        locate(
          "settleWorkflowTaskAgentAttempt",
          `no store owns workflow task attempt ${input_.workflowTaskAttemptId}`,
          [attemptProbe(input_.workflowTaskAttemptId)],
        ),
        (registered) => registered.ports.workflowTask.settleWorkflowTaskAgentAttempt(input_),
      ),
  };

  const episode: RuntimeEpisodeStatePortService = {
    recordHandlerThreadEpisode: (input_) =>
      via(
        locate("recordHandlerThreadEpisode", `no store owns session ${input_.workspaceSessionId}`, [
          sessionProbe(input_.workspaceSessionId),
          threadProbe(input_.threadId),
        ]),
        (registered) => registered.ports.episode.recordHandlerThreadEpisode(input_),
      ),
  };

  const piSessionReference: PiSessionReferencePortService = {
    getPiSessionReference: (input_) =>
      viaPiReference(
        locate(
          "getPiSessionReference",
          `no store owns pi session reference ${input_.surfacePiSessionId}`,
          [surfaceProbe(input_.surfacePiSessionId)],
        ),
        (registered) => registered.ports.piSessionReference.getPiSessionReference(input_),
      ),
    savePiSessionReference: (input_) =>
      viaPiReference(
        locate(
          "savePiSessionReference",
          `no store owns pi session reference ${input_.surfacePiSessionId}`,
          [surfaceProbe(input_.surfacePiSessionId), sessionProbe(input_.surfacePiSessionId)],
        ),
        (registered) => registered.ports.piSessionReference.savePiSessionReference(input_),
      ),
    deletePiSessionReference: (input_) =>
      viaPiReference(
        locate(
          "deletePiSessionReference",
          `no store owns pi session reference ${input_.surfacePiSessionId}`,
          [surfaceProbe(input_.surfacePiSessionId)],
        ),
        (registered) => registered.ports.piSessionReference.deletePiSessionReference(input_),
      ),
    validatePiSessionReference: (input_) =>
      viaPiReference(
        resolveWorkspace("validatePiSessionReference", input_.workspaceId),
        (registered) => registered.ports.piSessionReference.validatePiSessionReference(input_),
      ),
  };

  return {
    registerWorkspaceState,
    unregisterWorkspaceState: (workspaceId) => {
      const deleted = workspaceRegistrations.delete(workspaceId);
      if (deleted) rebuildIndexes();
      return deleted;
    },
    workspace,
    toolExecutionPolicy,
    surfaceLifecycle,
    promptDefaults,
    composerProfile,
    source,
    generatedPackage,
    actorExtensionBinding,
    generatedContextPreviewSubject,
    queue,
    request,
    approval,
    command,
    composerDraft,
    sessionWait,
    thread,
    transcript,
    turn,
    workflowTask,
    episode,
    piSessionReference,
    appGlobalStructuredSession: appGlobal.structuredSession,
    resolveRuntimeSurfaceStructuredSession: (target) =>
      locateRuntimeSurfaceTarget("resolveRuntimeSurfaceStructuredSession", target).pipe(
        Effect.map((registered) => registered.structuredSession),
      ),
    resolveWorkspaceStructuredSession: (workspaceId) =>
      resolveWorkspace("resolveWorkspaceStructuredSession", workspaceId).pipe(
        Effect.map((registered) => registered.structuredSession),
      ),
  };
}

export function layerWorkspaceStateRouter(
  router: WorkspaceStateRouter,
): Layer.Layer<
  | RuntimeWorkspaceStatePort
  | RuntimeToolExecutionPolicyStatePort
  | RuntimeSurfaceLifecycleStatePort
  | RuntimePromptDefaultsStatePort
  | RuntimeComposerProfileStatePort
  | RuntimeSourceStatePort
  | RuntimeGeneratedPackageStatePort
  | RuntimeActorExtensionBindingStatePort
  | GeneratedContextPreviewSubjectStatePort
  | RuntimeQueueStatePort
  | RuntimeRequestStatePort
  | RuntimeApprovalStatePort
  | RuntimeCommandStatePort
  | RuntimeComposerDraftStatePort
  | RuntimeSessionWaitStatePort
  | RuntimeThreadStatePort
  | RuntimeTranscriptStatePort
  | RuntimeTurnStatePort
  | RuntimeWorkflowTaskStatePort
  | RuntimeEpisodeStatePort
  | PiSessionReferencePort
> {
  return Layer.mergeAll(
    Layer.succeed(RuntimeWorkspaceStatePort, router.workspace),
    Layer.succeed(RuntimeToolExecutionPolicyStatePort, router.toolExecutionPolicy),
    Layer.succeed(RuntimeSurfaceLifecycleStatePort, router.surfaceLifecycle),
    Layer.succeed(RuntimePromptDefaultsStatePort, router.promptDefaults),
    Layer.succeed(RuntimeComposerProfileStatePort, router.composerProfile),
    Layer.succeed(RuntimeSourceStatePort, router.source),
    Layer.succeed(RuntimeGeneratedPackageStatePort, router.generatedPackage),
    Layer.succeed(RuntimeActorExtensionBindingStatePort, router.actorExtensionBinding),
    Layer.succeed(GeneratedContextPreviewSubjectStatePort, router.generatedContextPreviewSubject),
    Layer.succeed(RuntimeQueueStatePort, router.queue),
    Layer.succeed(RuntimeRequestStatePort, router.request),
    Layer.succeed(RuntimeApprovalStatePort, router.approval),
    Layer.succeed(RuntimeCommandStatePort, router.command),
    Layer.succeed(RuntimeComposerDraftStatePort, router.composerDraft),
    Layer.succeed(RuntimeSessionWaitStatePort, router.sessionWait),
    Layer.succeed(RuntimeThreadStatePort, router.thread),
    Layer.succeed(RuntimeTranscriptStatePort, router.transcript),
    Layer.succeed(RuntimeTurnStatePort, router.turn),
    Layer.succeed(RuntimeWorkflowTaskStatePort, router.workflowTask),
    Layer.succeed(RuntimeEpisodeStatePort, router.episode),
    Layer.succeed(PiSessionReferencePort, router.piSessionReference),
  );
}
