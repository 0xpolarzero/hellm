import { afterEach, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import {
  IsoDateTimeStringSchema,
  RuntimeContractError,
  type AbsolutePath,
  type AppLogEntryId,
  type AppLogWritePortService,
  type CommandId,
  type CreateOrchestratorSurfaceInput,
  type IsoDateTimeString,
  type PromptTarget,
  type RuntimeClientRequestId,
  type RuntimeClientSubmissionId,
  type RuntimeClientSubmissionSource,
  type SandboxPolicySnapshot,
  type SandboxPolicySourceService,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type SubmitMessageInput,
  type SurfacePiSessionId,
  type ToolItemId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import {
  RuntimeStartupError,
  defaultRuntimeLayerConfig,
  type RuntimeGeneratedPackageRefreshHostPortService,
  type RuntimeGeneratedPackageWorkspaceLinkFileHost,
  type RuntimeSourceInvalidationEvent,
} from "@svvy/runtime/bootstrap";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "@svvy/state/structured-session-state";
import {
  createAppRuntimeBootstrap,
  type AppRuntimeBootstrap,
  type AppRuntimeBootstrapWorkspaceExecutor,
} from "./app-runtime-bootstrap";
import { createLiveCommandStdinRegistry } from "./live-command-stdin-registry";
import { createTestSandboxHostSupport } from "./sandbox-host-support.test-support";

const tempDirs: string[] = [];
const openStores: StructuredSessionStateStore[] = [];

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

function makeStore(input: { id: string; label: string }): {
  readonly cwd: AbsolutePath;
  readonly databasePath: AbsolutePath;
  readonly store: StructuredSessionStateStore;
} {
  const root = mkdtempSync(join(tmpdir(), `svvy-app-bootstrap-${input.label}-`)) as AbsolutePath;
  tempDirs.push(root);
  const databasePath = join(root, "structured-session.sqlite") as AbsolutePath;
  const store = createStructuredSessionStateStore({
    digest: testDigest,
    idFactory: (prefix: string) => `${prefix}-${randomUUID()}`,
    workspace: {
      id: input.id,
      label: input.label,
      cwd: root,
      artifactDir: join(root, "artifacts") as AbsolutePath,
    },
    databasePath,
    now: deterministicClock(),
  });
  openStores.push(store);
  return { cwd: root, databasePath, store };
}

afterEach(() => {
  while (openStores.length > 0) {
    openStores.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { force: true, recursive: true });
  }
});

describe("app runtime bootstrap", () => {
  it("creates one ready runtime over routed workspace stores and primitive host ports", async () => {
    const harness = createBootstrapHarness();
    const bootstrap = await createAppRuntimeBootstrap(harness.input);
    let pendingApproval:
      | ReturnType<
          AppRuntimeBootstrap["internal"]["acceptedNativeTools"]["requestDirectToolApproval"]
        >
      | undefined;

    try {
      expect(bootstrap.readiness.status).toBe("ready");

      const surfaceA = await bootstrap.facade.surfaces.createOrchestrator({
        workspaceId: harness.workspaceAId,
        title: "Workspace A",
      } satisfies CreateOrchestratorSurfaceInput);
      const surfaceB = await bootstrap.facade.surfaces.createOrchestrator({
        workspaceId: harness.workspaceBId,
        title: "Workspace B",
      } satisfies CreateOrchestratorSurfaceInput);

      expect(harness.workspaceA.store.getSessionState(surfaceA.workspaceSessionId).session.id).toBe(
        surfaceA.workspaceSessionId,
      );
      expect(() => harness.workspaceA.store.getSessionState(surfaceB.workspaceSessionId)).toThrow();
      expect(harness.workspaceB.store.getSessionState(surfaceB.workspaceSessionId).session.id).toBe(
        surfaceB.workspaceSessionId,
      );
      expect(() => harness.workspaceB.store.getSessionState(surfaceA.workspaceSessionId)).toThrow();

      const openB = await bootstrap.facade.surfaces.open({
        workspaceId: harness.workspaceBId,
        target: surfaceB.target,
      });
      expect(openB).toEqual({
        workspaceSessionId: surfaceB.workspaceSessionId,
        surfacePiSessionId: surfaceB.surfacePiSessionId,
        target: surfaceB.target,
        stateRevision: openB.stateRevision,
      });
      expect(harness.workspaceB.store.getSessionState(surfaceB.workspaceSessionId).session.id).toBe(
        surfaceB.workspaceSessionId,
      );

      seedPromptDefaults(harness.workspaceB.store, surfaceB.workspaceSessionId);
      const targetB = surfaceB.target as PromptTarget;
      const submitB = await bootstrap.facade.messages.submit(
        messageInput(targetB, "hello workspace b"),
      );
      expect(submitB.status).toBe("queued");
      expect(
        harness.workspaceB.store.getSurfaceQueuedMessage({ id: submitB.queuedMessageId }).id,
      ).toBe(submitB.queuedMessageId);
      expect(() =>
        harness.workspaceA.store.getSurfaceQueuedMessage({ id: submitB.queuedMessageId }),
      ).toThrow();

      await bootstrap.facade.messages.abort({
        target: surfaceA.target as PromptTarget,
        mode: "all-for-surface",
        reason: "test cancel all",
      });
      await bootstrap.facade.messages.abort({
        target: targetB,
        mode: "active-turn",
        turnId: "turn-bootstrap-test" as TurnId,
        reason: "test cancel active",
      });

      expect(harness.executorCalls).toEqual([
        `wake:${harness.workspaceBId}:message-submitted`,
        `cancelPrompt:${harness.workspaceAId}`,
        `cancelActive:${harness.workspaceBId}:turn-bootstrap-test`,
      ]);

      pendingApproval = bootstrap.internal.acceptedNativeTools.requestDirectToolApproval({
        approvalMode: "user",
        cwd: harness.workspaceB.cwd,
        sessionId: surfaceB.workspaceSessionId,
        surfacePiSessionId: surfaceB.surfacePiSessionId,
        toolCallId: "tool_app_bootstrap_pending_approval" as ToolItemId,
        toolName: "exec_command",
        command: "echo pending",
        commandFamily: "shell",
      });
      await waitForOpenApproval(harness.workspaceB.store, 1);
    } finally {
      await bootstrap.dispose();
    }

    await expect(pendingApproval).resolves.toEqual({
      approved: false,
      reason: "Runtime shutdown: app-shutdown.",
    });
    expect(harness.workspaceB.store.listOpenRuntimeApprovalRequests()).toEqual([]);
  });

  it("routes source invalidation scans to app-global and workspace coordinators", async () => {
    const harness = createBootstrapHarness();
    const bootstrap = await createAppRuntimeBootstrap(harness.input);

    try {
      await bootstrap.facade.sourceInvalidation.hint({
        scope: { kind: "app-global" },
        domain: "extensions",
        path: harness.appGlobal.cwd,
      } satisfies SourceInvalidationHint);
      await bootstrap.facade.sourceInvalidation.reconcile({
        scope: { kind: "workspace", workspaceId: harness.workspaceAId },
        domains: ["external_instructions"],
        reason: "manual",
      } satisfies SourceReconcileRequest);

      expect(harness.sourceCalls).toEqual([
        "app:classify:extensions",
        "app:scan:extensions",
        `workspace:${harness.workspaceAId}:reconcile:external_instructions`,
      ]);
    } finally {
      await bootstrap.dispose();
    }
  });

  it("prepares startup-failure shutdown before disposing the acquired runtime", async () => {
    const harness = createBootstrapHarness();
    const listSessionStates = harness.appGlobal.store.listSessionStates.bind(
      harness.appGlobal.store,
    );
    harness.appGlobal.store.listSessionStates = (() => {
      throw new Error("startup restore failed");
    }) satisfies StructuredSessionStateStore["listSessionStates"];

    try {
      await expect(createAppRuntimeBootstrap(harness.input)).rejects.toBeInstanceOf(
        RuntimeStartupError,
      );
    } finally {
      harness.appGlobal.store.listSessionStates = listSessionStates;
    }
  });
});

function createBootstrapHarness() {
  const appGlobal = makeStore({ id: "workspace_app_global", label: "appglobal" });
  const workspaceAId = "workspace_app_bootstrap_a" as WorkspaceId;
  const workspaceBId = "workspace_app_bootstrap_b" as WorkspaceId;
  const workspaceA = makeStore({ id: workspaceAId, label: "workspace-a" });
  const workspaceB = makeStore({ id: workspaceBId, label: "workspace-b" });
  const sourceRoots = {
    extensionsRoot: mkdtempTracked("extensions") as AbsolutePath,
    workflowsSourceRoot: mkdtempTracked("workflows-source") as AbsolutePath,
  };
  const generatedPackageRoots = {
    extensionsPackageRoot: mkdtempTracked("generated-extensions") as AbsolutePath,
    workflowsPackageRoot: mkdtempTracked("generated-workflows") as AbsolutePath,
    coreTypeContractPackageRoot: mkdtempTracked("generated-core") as AbsolutePath,
  };
  const executorCalls: string[] = [];
  const sourceCalls: string[] = [];
  const storesBySession = new Map<string, WorkspaceId>();
  const commandRegistry = createLiveCommandStdinRegistry();
  commandRegistry.register({
    commandId: "command-bootstrap-test" as CommandId,
    sessionId: "live-command-session",
    writeStdin: (text) => ({ status: "accepted", acceptedBytes: Buffer.byteLength(text) }),
    cancel: () => ({ status: "cancelled" }),
  });

  const workspaceExecutors = {
    resolvePromptTarget: async (target: PromptTarget) => {
      const workspaceId = storesBySession.get(target.workspaceSessionId);
      if (!workspaceId) {
        throw new RuntimeContractError({
          operation: "app-runtime-bootstrap.resolvePromptTarget",
          reason: "target-not-found",
          message: `No workspace executor owns ${target.workspaceSessionId}.`,
        });
      }
      return {
        cancelActivePrompt: async (
          input: Parameters<AppRuntimeBootstrapWorkspaceExecutor["cancelActivePrompt"]>[0],
        ) => {
          executorCalls.push(`cancelActive:${workspaceId}:${input.turnId}`);
        },
        cancelPrompt: async () => {
          executorCalls.push(`cancelPrompt:${workspaceId}`);
        },
        wakeRuntimeSurfaceQueue: async (
          input: Parameters<AppRuntimeBootstrapWorkspaceExecutor["wakeRuntimeSurfaceQueue"]>[0],
        ) => {
          executorCalls.push(`wake:${workspaceId}:${input.reason}`);
        },
      } satisfies AppRuntimeBootstrapWorkspaceExecutor;
    },
  };

  const sourceCoordinator = (label: string) => ({
    classifyHint: async (input: SourceInvalidationHint) => {
      sourceCalls.push(`${label}:classify:${input.domain}`);
      return "scan" as const;
    },
    reconcile: async (input: { readonly domains?: SourceReconcileRequest["domains"] }) => {
      sourceCalls.push(`${label}:reconcile:${input.domains?.join(",") ?? "all"}`);
      return null as RuntimeSourceInvalidationEvent | null;
    },
    requestScan: async (input: { readonly domains?: SourceReconcileRequest["domains"] }) => {
      sourceCalls.push(`${label}:scan:${input.domains?.join(",") ?? "all"}`);
    },
  });

  const input = {
    appGlobalState: { store: appGlobal.store },
    workspaceStates: [
      { store: workspaceA.store, isDefaultWorkspace: true },
      { store: workspaceB.store },
    ],
    sourceRoots,
    generatedPackageRoots,
    extensionStatePort: {
      records: {
        readSourceFingerprint: () => Effect.succeed(null),
      },
      dependencies: {
        isApproved: () => Effect.succeed(false),
        readReadiness: () => Effect.succeed(null),
      },
    },
    generatedPackageLinkPath: async ({ packageName, workspaceId }) =>
      join(
        tmpdir(),
        "svvy-app-bootstrap-links",
        workspaceId,
        packageName === "@svvyx/workflows" ? "workflows" : "extensions",
      ) as AbsolutePath,
    sandboxPolicySource: testSandboxPolicySource(),
    appLogWritePort: testAppLogWritePort(),
    sandboxHostSupport: createTestSandboxHostSupport(),
    runtimeLayerConfig: defaultRuntimeLayerConfig,
    commandRegistry,
    providerAuth: {
      ensureUsableProviderAuth: async () => "test-api-key",
      getProviderAuthUnavailableMessage: (provider: string) => `${provider} auth unavailable.`,
    },
    workspaceExecutors,
    generatedContextRefresh: {
      refresh: async () => {},
    },
    generatedPackageRefresh: testGeneratedPackageRefreshHost(),
    sourceInvalidation: {
      appGlobalCoordinator: sourceCoordinator("app"),
      listAcquiredWorkspaceIds: () => [workspaceAId, workspaceBId],
      resolveWorkspaceCoordinator: async (workspaceId: WorkspaceId) =>
        sourceCoordinator(`workspace:${workspaceId}`),
    },
  } satisfies Parameters<typeof createAppRuntimeBootstrap>[0];

  const originalCreateA = workspaceA.store.createOrchestratorSurface.bind(workspaceA.store);
  workspaceA.store.createOrchestratorSurface = ((request) => {
    const result = originalCreateA(request);
    storesBySession.set(result.target.workspaceSessionId, workspaceAId);
    savePiReference(workspaceA.store, result.surfacePiSessionId);
    return result;
  }) satisfies StructuredSessionStateStore["createOrchestratorSurface"];
  const originalCreateB = workspaceB.store.createOrchestratorSurface.bind(workspaceB.store);
  workspaceB.store.createOrchestratorSurface = ((request) => {
    const result = originalCreateB(request);
    storesBySession.set(result.target.workspaceSessionId, workspaceBId);
    savePiReference(workspaceB.store, result.surfacePiSessionId);
    return result;
  }) satisfies StructuredSessionStateStore["createOrchestratorSurface"];

  return {
    input,
    appGlobal,
    workspaceA,
    workspaceAId,
    workspaceB,
    workspaceBId,
    executorCalls,
    sourceCalls,
  };
}

async function waitForOpenApproval(
  store: StructuredSessionStateStore,
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (store.listOpenRuntimeApprovalRequests().length === count) return;
    await Promise.resolve();
  }
  expect(store.listOpenRuntimeApprovalRequests()).toHaveLength(count);
}

function mkdtempTracked(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `svvy-app-bootstrap-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function messageInput(target: PromptTarget, text: string): SubmitMessageInput {
  return {
    target,
    message: { text },
    delivery: "enqueue-and-run",
    clientSubmission: {
      submissionId: `submission-${randomUUID()}` as RuntimeClientSubmissionId,
      clientRequestId: `request-${randomUUID()}` as RuntimeClientRequestId,
      source: "test" as RuntimeClientSubmissionSource,
      submittedAt: "2026-05-01T09:00:00.000Z" as typeof IsoDateTimeStringSchema.Type,
      sequence: 1,
    },
  };
}

function seedPromptDefaults(store: StructuredSessionStateStore, sessionId: WorkspaceSessionId) {
  store.upsertPiSession({
    sessionId,
    title: "Seeded prompt defaults",
    provider: "openai",
    model: "gpt-4o",
    reasoningEffort: "medium",
    messageCount: 0,
    status: "idle",
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-05-01T09:00:00.000Z",
  });
}

function savePiReference(
  store: StructuredSessionStateStore,
  surfacePiSessionId: SurfacePiSessionId,
) {
  store.savePiSessionReference({
    surfacePiSessionId,
    reference: {
      surfacePiSessionId,
      referenceFingerprint: `ref-${surfacePiSessionId}`,
      adapterKind: "pi",
      adapterVersion: "test",
      storageLocator: `pi://sessions/${surfacePiSessionId}`,
      piSessionId: `pi-${surfacePiSessionId}`,
      metadata: { storage: "opaque" },
    },
  });
}

function testAppLogWritePort(): AppLogWritePortService {
  return {
    append: () =>
      Effect.succeed({
        value: { appLogEntryId: "app_log_app_runtime_bootstrap_test" as AppLogEntryId },
        afterCommit: [],
      }),
  };
}

function testSandboxPolicySource(): SandboxPolicySourceService {
  return {
    snapshot: (input) =>
      Effect.succeed({
        snapshotId: "sandbox_policy_app_runtime_bootstrap_test",
        fingerprint: "sandbox-policy-app-runtime-bootstrap",
        resolvedAt: "2026-05-01T09:00:00.000Z" as typeof IsoDateTimeStringSchema.Type,
        scope: input.scope,
        surfacePiSessionId: input.surfacePiSessionId,
        commandId: input.commandId,
        launchKind: input.launchKind,
        cwd: input.cwd,
        sandboxMode: "omitted_full_access",
        networkPolicy: "allow",
        filesystemPolicy: { defaultAccess: "read", entries: [] },
      } satisfies SandboxPolicySnapshot),
  };
}

function testGeneratedPackageRefreshHost(): RuntimeGeneratedPackageRefreshHostPortService {
  return {
    listAcquiredWorkspaceIds: () =>
      Effect.succeed([
        "workspace_app_bootstrap_a" as WorkspaceId,
        "workspace_app_bootstrap_b" as WorkspaceId,
      ]),
    listRecoverableWorkspaceIds: () => Effect.succeed([]),
    materializeCoreTypeContractPackage: () => Effect.void,
    now: () => Effect.succeed("2026-05-01T09:00:00.000Z" as IsoDateTimeString),
    workspaceLinkFileHost: testWorkspaceLinkFileHost(),
  };
}

function testWorkspaceLinkFileHost(): RuntimeGeneratedPackageWorkspaceLinkFileHost {
  return {
    pathExists: () => false,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    readSymbolicLink: () => null,
    makeDirectory: () => {},
    remove: () => {},
    symlinkDirectory: () => {},
  };
}
