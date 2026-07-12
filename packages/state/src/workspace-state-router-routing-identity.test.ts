import { describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  FindRuntimeCommandByToolCallIdInput,
  RuntimeActorExtensionBindingStatePortService,
  RuntimeApprovalStatePortService,
  RuntimeCommandStatePortService,
  RuntimeComposerDraftStatePortService,
  RuntimeEpisodeStatePortService,
  RuntimeGeneratedPackageStatePortService,
  RuntimePromptDefaultsStatePortService,
  RuntimeQueueStatePortService,
  RuntimeRequestStatePortService,
  RuntimeSessionWaitStatePortService,
  RuntimeSourceStatePortService,
  RuntimeSurfaceLifecycleStatePortService,
  RuntimeThreadStatePortService,
  RuntimeTranscriptStatePortService,
  RuntimeTurnStatePortService,
  RuntimeWorkspaceStatePortService,
  SurfacePiSessionId,
} from "@svvy/core";
import { createWorkspaceStateRouter } from "./structured-session-adapters";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

type ServiceMethodInput<S, K extends keyof S> = S[K] extends (input: infer I) => unknown
  ? Exclude<I, undefined>
  : never;

type InputField<S, K extends keyof S> = keyof ServiceMethodInput<S, K> & string;

type RoutingIdentity<Field extends string> =
  | { readonly via: "explicit-workspace-id"; readonly inputField: Field }
  | { readonly via: "explicit-source-scope"; readonly inputField: Field }
  | { readonly via: "committed-workspace-cwd"; readonly inputField: Field }
  | { readonly via: "default-workspace" }
  | { readonly via: "app-global" }
  | {
      readonly via: "prompt-target";
      readonly inputField: Field;
      readonly committedRecords: readonly string[];
    }
  | {
      readonly via: "committed-owner-row";
      readonly inputFields: readonly Field[];
      readonly committedRecords: readonly string[];
      readonly failsSafeWhenAbsent?: boolean;
    }
  | { readonly via: "registered-store-fan-out"; readonly optionalScopeFields: readonly Field[] };

type PortRoutingAudit<S> = { readonly [K in keyof S]: RoutingIdentity<InputField<S, K>> };

const workspaceAudit: PortRoutingAudit<RuntimeWorkspaceStatePortService> = {
  resolvePromptTargetWorkspaceId: {
    via: "prompt-target",
    inputField: "target",
    committedRecords: ["pi_session_reference", "session"],
  },
  acquireWorkspace: { via: "committed-workspace-cwd", inputField: "cwd" },
  acquireDefaultWorkspace: { via: "default-workspace" },
  releaseWorkspace: { via: "explicit-workspace-id", inputField: "workspaceId" },
};

const surfaceLifecycleAudit: PortRoutingAudit<RuntimeSurfaceLifecycleStatePortService> = {
  createOrchestratorSurface: { via: "explicit-workspace-id", inputField: "workspaceId" },
  openSurface: { via: "explicit-workspace-id", inputField: "workspaceId" },
  closeSurface: { via: "explicit-workspace-id", inputField: "workspaceId" },
  readOrchestratorLifecycle: { via: "explicit-workspace-id", inputField: "workspaceId" },
  renameOrchestrator: { via: "explicit-workspace-id", inputField: "workspaceId" },
  forkOrchestrator: { via: "explicit-workspace-id", inputField: "workspaceId" },
  deleteOrchestrator: { via: "explicit-workspace-id", inputField: "workspaceId" },
};

const promptDefaultsAudit: PortRoutingAudit<RuntimePromptDefaultsStatePortService> = {
  resolvePromptDefaults: {
    via: "prompt-target",
    inputField: "target",
    committedRecords: ["pi_session_reference", "session"],
  },
  updatePromptDefaults: {
    via: "prompt-target",
    inputField: "target",
    committedRecords: ["session", "thread", "agent_profile"],
  },
};

const sourceAudit: PortRoutingAudit<RuntimeSourceStatePortService> = {
  readSourceVersion: { via: "explicit-source-scope", inputField: "scope" },
  recordSourceSave: { via: "explicit-source-scope", inputField: "scope" },
  recordSourceDelete: { via: "explicit-source-scope", inputField: "scope" },
  recordWorkflowAgentSourceSave: { via: "app-global" },
  recordWorkflowAgentSourceDelete: { via: "app-global" },
  reconcileWorkflowAgentSources: { via: "app-global" },
  recordSourceScan: { via: "explicit-source-scope", inputField: "scope" },
  reconcileDiscoveredHostSnippets: { via: "explicit-source-scope", inputField: "scope" },
  recordObservedSourceDeletion: { via: "explicit-source-scope", inputField: "scope" },
  recordSourceDiagnostic: { via: "explicit-source-scope", inputField: "scope" },
};

const generatedPackageAudit: PortRoutingAudit<RuntimeGeneratedPackageStatePortService> = {
  recordGeneratedPackageBuild: { via: "app-global" },
  recordGeneratedPackageFailure: { via: "app-global" },
  // routed by status.workspaceId; status is the top-level input field carrying the identity
  recordWorkspaceLinkStatus: { via: "explicit-workspace-id", inputField: "status" },
  markWorkspaceLinksRepairNeeded: { via: "explicit-workspace-id", inputField: "workspaceId" },
  readLinksNeedingRepair: { via: "registered-store-fan-out", optionalScopeFields: ["workspaceId"] },
  readGeneratedPackageFacts: { via: "app-global" },
  reconcileGeneratedPackageManifest: { via: "app-global" },
  markGeneratedPackageRefreshNeeded: { via: "app-global" },
};

const actorExtensionBindingAudit: PortRoutingAudit<RuntimeActorExtensionBindingStatePortService> = {
  readRuntimePromptBinding: {
    via: "prompt-target",
    inputField: "target",
    committedRecords: ["pi_session_reference", "session"],
  },
  updateActorExtensionBinding: {
    via: "prompt-target",
    inputField: "target",
    committedRecords: ["pi_session_reference", "session"],
  },
  setActorExtensionBinding: {
    via: "prompt-target",
    inputField: "target",
    committedRecords: ["pi_session_reference", "session"],
  },
};

const queueAudit: PortRoutingAudit<RuntimeQueueStatePortService> = {
  acceptSubmittedSurfaceMessage: {
    via: "prompt-target",
    inputField: "target",
    committedRecords: ["pi_session_reference", "session"],
  },
  acceptEditedCommittedSurfaceMessage: {
    via: "prompt-target",
    inputField: "target",
    committedRecords: ["pi_session_reference", "session"],
  },
  enqueueSurfaceMessage: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId", "sessionId"],
    committedRecords: ["pi_session_reference", "session"],
  },
  getSurfaceQueuedMessage: {
    via: "committed-owner-row",
    inputFields: ["id"],
    committedRecords: ["surface_message_queue"],
  },
  claimNextQueuedSurfaceMessage: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId"],
    committedRecords: ["pi_session_reference"],
  },
  releaseExpiredSurfaceMessageClaims: {
    via: "registered-store-fan-out",
    optionalScopeFields: ["surfacePiSessionId"],
  },
  markSurfaceMessageSteering: {
    via: "committed-owner-row",
    inputFields: ["id"],
    committedRecords: ["surface_message_queue"],
  },
  markSurfaceMessageQueued: {
    via: "committed-owner-row",
    inputFields: ["id"],
    committedRecords: ["surface_message_queue"],
  },
  markSurfaceMessageDelivered: {
    via: "committed-owner-row",
    inputFields: ["id"],
    committedRecords: ["surface_message_queue"],
  },
  markSurfaceMessageFailed: {
    via: "committed-owner-row",
    inputFields: ["id"],
    committedRecords: ["surface_message_queue"],
  },
  cancelSurfaceMessage: {
    via: "committed-owner-row",
    inputFields: ["id"],
    committedRecords: ["surface_message_queue"],
  },
  reorderSurfaceMessage: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId"],
    committedRecords: ["pi_session_reference"],
  },
};

const composerDraftAudit: PortRoutingAudit<RuntimeComposerDraftStatePortService> = {
  setDraft: {
    via: "prompt-target",
    inputField: "target",
    committedRecords: ["pi_session_reference", "session"],
  },
  clearSubmittedDraft: {
    via: "prompt-target",
    inputField: "target",
    committedRecords: ["pi_session_reference", "session"],
  },
};

const requestAudit: PortRoutingAudit<RuntimeRequestStatePortService> = {
  readRequestInputSettings: { via: "app-global" },
  setRequestInputVariant: { via: "app-global" },
  setRequestInputBlockingTimeout: { via: "app-global" },
  createRequestInput: {
    via: "prompt-target",
    inputField: "target",
    committedRecords: ["pi_session_reference", "session"],
  },
  getRequestInput: {
    via: "committed-owner-row",
    inputFields: ["requestId"],
    committedRecords: ["request_user_input_request"],
  },
  listOpenBlockingRequestInputs: {
    via: "registered-store-fan-out",
    optionalScopeFields: ["surfacePiSessionId", "workspaceSessionId"],
  },
  answerRequestInput: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId", "requestId"],
    committedRecords: ["pi_session_reference", "request_user_input_request"],
  },
  defaultOpenRequestInputQuestions: {
    via: "committed-owner-row",
    inputFields: ["requestId"],
    committedRecords: ["request_user_input_request"],
  },
  cancelRequestInput: {
    via: "committed-owner-row",
    inputFields: ["requestId"],
    committedRecords: ["request_user_input_request"],
  },
  setRequestInputTimerPaused: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId", "requestId"],
    committedRecords: ["pi_session_reference", "request_user_input_request"],
  },
};

const approvalAudit: PortRoutingAudit<RuntimeApprovalStatePortService> = {
  createApprovalRequest: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId", "sessionId"],
    committedRecords: ["pi_session_reference", "session"],
  },
  resolveApprovalRequest: {
    via: "committed-owner-row",
    inputFields: ["requestId"],
    committedRecords: ["runtime_approval_request"],
  },
  getApprovalRequest: {
    via: "committed-owner-row",
    inputFields: ["requestId"],
    committedRecords: ["runtime_approval_request"],
  },
  listOpenApprovalRequests: {
    via: "registered-store-fan-out",
    optionalScopeFields: ["surfacePiSessionId"],
  },
};

const commandAudit: PortRoutingAudit<RuntimeCommandStatePortService> = {
  createCommand: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId", "turnId", "workflowTaskAttemptId"],
    committedRecords: ["pi_session_reference", "turn", "workflow_task_attempt"],
  },
  createOrReuseStreamingCommand: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId", "turnId", "workflowTaskAttemptId"],
    committedRecords: ["pi_session_reference", "turn", "workflow_task_attempt"],
  },
  // surfacePiSessionId is optional in @svvy/core because toolCallId is pi-minted and not globally
  // unique; absence fails safe with target-not-found rather than fanning out to a wrong store
  findCommandByToolCallId: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId"],
    committedRecords: ["pi_session_reference"],
    failsSafeWhenAbsent: true,
  },
  findCommandById: {
    via: "committed-owner-row",
    inputFields: ["commandId"],
    committedRecords: ["command"],
  },
  updateCommandArguments: {
    via: "committed-owner-row",
    inputFields: ["commandId"],
    committedRecords: ["command"],
  },
  startCommand: {
    via: "committed-owner-row",
    inputFields: ["commandId"],
    committedRecords: ["command"],
  },
  finishCommand: {
    via: "committed-owner-row",
    inputFields: ["commandId"],
    committedRecords: ["command"],
  },
  recordCommandEvent: {
    via: "committed-owner-row",
    inputFields: ["sessionId", "commandId"],
    committedRecords: ["session", "command"],
  },
  recordStdinWrite: {
    via: "committed-owner-row",
    inputFields: ["sessionId", "commandId"],
    committedRecords: ["session", "command"],
  },
  hasCommandOutputEvent: {
    via: "committed-owner-row",
    inputFields: ["sessionId"],
    committedRecords: ["session"],
  },
};

const sessionWaitAudit: PortRoutingAudit<RuntimeSessionWaitStatePortService> = {
  setApprovalWait: {
    via: "committed-owner-row",
    inputFields: ["sessionId"],
    committedRecords: ["session"],
  },
  setUserWait: {
    via: "committed-owner-row",
    inputFields: ["sessionId"],
    committedRecords: ["session"],
  },
  clearSessionWait: {
    via: "committed-owner-row",
    inputFields: ["sessionId"],
    committedRecords: ["session"],
  },
};

const threadAudit: PortRoutingAudit<RuntimeThreadStatePortService> = {
  ensureHandlerThreadRunnable: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId", "workspaceSessionId"],
    committedRecords: ["pi_session_reference", "session"],
  },
  startHandlerThreads: {
    via: "committed-owner-row",
    inputFields: ["workspaceSessionId"],
    committedRecords: ["session"],
  },
};

const transcriptAudit: PortRoutingAudit<RuntimeTranscriptStatePortService> = {
  commitUserMessage: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId", "workspaceSessionId"],
    committedRecords: ["pi_session_reference", "session"],
  },
  beginAssistantMessage: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId", "workspaceSessionId"],
    committedRecords: ["pi_session_reference", "session"],
  },
  appendAssistantContentDelta: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId"],
    committedRecords: ["pi_session_reference"],
  },
  upsertAssistantToolCall: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId"],
    committedRecords: ["pi_session_reference"],
  },
  linkAssistantToolCallCommand: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId"],
    committedRecords: ["pi_session_reference"],
  },
  commitAssistantMessage: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId"],
    committedRecords: ["pi_session_reference"],
  },
  failAssistantMessage: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId"],
    committedRecords: ["pi_session_reference"],
  },
  bindPiHistoryEntry: {
    via: "committed-owner-row",
    inputFields: ["piHistoryEntry"],
    committedRecords: ["pi_session_reference"],
  },
  advanceStreamCursor: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId"],
    committedRecords: ["pi_session_reference"],
  },
  readSurfaceTranscript: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId"],
    committedRecords: ["pi_session_reference"],
  },
};

const turnAudit: PortRoutingAudit<RuntimeTurnStatePortService> = {
  startTurn: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId", "sessionId"],
    committedRecords: ["pi_session_reference", "session"],
  },
  setTurnDecision: {
    via: "committed-owner-row",
    inputFields: ["turnId"],
    committedRecords: ["turn"],
  },
  finishTurn: {
    via: "committed-owner-row",
    inputFields: ["turnId"],
    committedRecords: ["turn"],
  },
  recoverInterruptedTurn: {
    via: "committed-owner-row",
    inputFields: ["turnId"],
    committedRecords: ["turn"],
  },
  settlePromptTurn: {
    via: "committed-owner-row",
    inputFields: ["turnId"],
    committedRecords: ["turn"],
  },
  queueTopLevelTitleGeneration: {
    via: "committed-owner-row",
    inputFields: ["surfacePiSessionId", "sessionId"],
    committedRecords: ["pi_session_reference", "session"],
  },
};

const episodeAudit: PortRoutingAudit<RuntimeEpisodeStatePortService> = {
  recordHandlerThreadEpisode: {
    via: "committed-owner-row",
    inputFields: ["workspaceSessionId", "threadId"],
    committedRecords: ["session", "thread"],
  },
};

const auditedPorts = [
  ["workspace", workspaceAudit],
  ["surfaceLifecycle", surfaceLifecycleAudit],
  ["promptDefaults", promptDefaultsAudit],
  ["source", sourceAudit],
  ["generatedPackage", generatedPackageAudit],
  ["actorExtensionBinding", actorExtensionBindingAudit],
  ["queue", queueAudit],
  ["request", requestAudit],
  ["approval", approvalAudit],
  ["command", commandAudit],
  ["composerDraft", composerDraftAudit],
  ["sessionWait", sessionWaitAudit],
  ["thread", threadAudit],
  ["transcript", transcriptAudit],
  ["turn", turnAudit],
  ["episode", episodeAudit],
] as const satisfies ReadonlyArray<readonly [string, Record<string, RoutingIdentity<string>>]>;

const auditRows = auditedPorts.flatMap(([portKey, audit]) =>
  Object.entries(audit).map(
    ([method, identity]) =>
      [`${portKey}.${method}`, identity] as readonly [string, RoutingIdentity<string>],
  ),
);

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

interface Registry {
  stores: StructuredSessionStateStore[];
  dirs: string[];
}

function makeStore(registry: Registry, id: string, label: string): StructuredSessionStateStore {
  const cwd = mkdtempSync(join(tmpdir(), `svvy-audit-${label}-`));
  registry.dirs.push(cwd);
  const store = createStructuredSessionStateStore({
    digest: testDigest,
    idFactory: (prefix: string) => `${prefix}-${randomUUID()}`,
    workspace: { id, label, cwd, artifactDir: join(cwd, "artifact-store") },
    now: deterministicClock(),
  });
  registry.stores.push(store);
  return store;
}

function createRegistry() {
  const registry: Registry = { stores: [], dirs: [] };
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

describe("workspace state router routing-identity audit", () => {
  it("classifies exactly the sixteen routed state ports and 94 dispatched methods", () => {
    const { registry, cleanup } = createRegistry();
    const router = createWorkspaceStateRouter({
      appGlobalStore: makeStore(registry, "workspace_app_global", "appglobal"),
      workspaceStores: [
        { store: makeStore(registry, "workspace_a", "a"), isDefaultWorkspace: true },
      ],
    });

    try {
      const routerPorts: Record<string, object> = {
        workspace: router.workspace,
        surfaceLifecycle: router.surfaceLifecycle,
        promptDefaults: router.promptDefaults,
        source: router.source,
        generatedPackage: router.generatedPackage,
        actorExtensionBinding: router.actorExtensionBinding,
        queue: router.queue,
        request: router.request,
        approval: router.approval,
        command: router.command,
        composerDraft: router.composerDraft,
        sessionWait: router.sessionWait,
        thread: router.thread,
        transcript: router.transcript,
        turn: router.turn,
        episode: router.episode,
      };

      let totalMethods = 0;
      for (const [portKey, audit] of auditedPorts) {
        const routerPort = routerPorts[portKey];
        if (!routerPort) throw new Error(`router is missing dispatched port ${portKey}`);
        const auditedMethods = Object.keys(audit).toSorted();
        expect(Object.keys(routerPort).toSorted()).toEqual(auditedMethods);
        totalMethods += auditedMethods.length;
      }

      expect(auditedPorts.length).toBe(16);
      expect(Object.keys(routerPorts).toSorted()).toEqual(
        auditedPorts.map(([key]) => key).toSorted(),
      );
      expect(totalMethods).toBe(94);
      expect(auditRows.length).toBe(94);
    } finally {
      cleanup();
    }
  });

  it.each(auditRows)(
    "%s carries a routable identity in its input or committed records",
    (_label, identity) => {
      switch (identity.via) {
        case "explicit-workspace-id":
        case "explicit-source-scope":
        case "committed-workspace-cwd":
          expect(identity.inputField.length).toBeGreaterThan(0);
          break;
        case "default-workspace":
        case "app-global":
          break;
        case "prompt-target":
          expect(identity.inputField.length).toBeGreaterThan(0);
          expect(identity.committedRecords.length).toBeGreaterThan(0);
          break;
        case "committed-owner-row":
          expect(identity.inputFields.length).toBeGreaterThan(0);
          expect(identity.committedRecords.length).toBeGreaterThan(0);
          break;
        case "registered-store-fan-out":
          expect(identity.optionalScopeFields.length).toBeGreaterThan(0);
          break;
        default: {
          const unreachable: never = identity;
          throw new Error(`unclassified routing identity: ${JSON.stringify(unreachable)}`);
        }
      }
    },
  );

  it("routes the toolCallId command lookup by its explicit @svvy/core surface scope, failing safe when absent", async () => {
    const surfaceScopeField: keyof FindRuntimeCommandByToolCallIdInput = "surfacePiSessionId";
    expect(surfaceScopeField).toBe("surfacePiSessionId");

    const { registry, cleanup } = createRegistry();
    const router = createWorkspaceStateRouter({
      appGlobalStore: makeStore(registry, "workspace_app_global", "appglobal"),
      workspaceStores: [
        { store: makeStore(registry, "workspace_a", "a"), isDefaultWorkspace: true },
      ],
    });

    try {
      await expect(
        runTestEffect(
          router.command.findCommandByToolCallId({
            toolCallId: "tool-call-unowned",
            surfacePiSessionId: "surface-unregistered" as SurfacePiSessionId,
          }),
        ),
      ).rejects.toMatchObject({
        operation: "workspace-state-router.findCommandByToolCallId",
        reason: "not-found",
      });

      await expect(
        runTestEffect(router.command.findCommandByToolCallId({ toolCallId: "tool-call-no-scope" })),
      ).rejects.toMatchObject({
        operation: "workspace-state-router.findCommandByToolCallId",
        reason: "not-found",
      });
    } finally {
      cleanup();
    }
  });
});
