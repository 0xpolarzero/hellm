import { afterEach, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import {
  IsoDateTimeStringSchema,
  RuntimeContractError,
  SecretStorePortError,
  type AbsolutePath,
  type AppLogEntryId,
  type CommandId,
  type CreateOrchestratorSurfaceInput,
  type ExtensionEnvSecretRef,
  type ExtensionId,
  type IsoDateTimeString,
  type PromptTarget,
  type RemoveSecretValueInput,
  type ProviderId,
  type RuntimeEvent,
  type RuntimeClientRequestId,
  type RuntimeClientSubmissionId,
  type RuntimeClientSubmissionSource,
  type RuntimeEventSequence,
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
import { createStateAppLogsFacade, type StateAppLogsFacade } from "@svvy/state";
import {
  createAppRuntimeBootstrap,
  createSnapshotSecretValuesPort,
  type AppRuntimeBootstrap,
} from "./app-runtime-bootstrap";
import { createAppLogger } from "./app-logger";
import { createLiveCommandStdinRegistry } from "./live-command-stdin-registry";
import { createExtensionSnapshotPayloadStore } from "./extension-snapshot-storage";
import { successfulExtensionBuildProcessTestService } from "./extension-build-process.test-support";
import { createTestSandboxHostSupport } from "./sandbox-host-support.test-support";
import {
  DEFAULT_AGENT_SETTINGS_STATE,
  normalizeExternalInstructionsSettings,
  type AppPreferences,
} from "../shared/agent-settings";

const tempDirs: string[] = [];
const openStores: StructuredSessionStateStore[] = [];
const openAppLogs: StateAppLogsFacade[] = [];

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
  while (openAppLogs.length > 0) {
    openAppLogs.pop()?.close();
  }
  while (openStores.length > 0) {
    openStores.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { force: true, recursive: true });
  }
});

describe("app runtime bootstrap", () => {
  it("restores each captured secret target exactly once across receipt replay", async () => {
    const harness = createBootstrapHarness();
    const extensionId = "snapshot-secret-test" as ExtensionId;
    const envName = "TOKEN" as ExtensionEnvSecretRef["envName"];
    harness.appGlobal.store.reconcileExtensionEnvDeclarations({
      declarations: [
        { extensionId, envName, required: true, secret: true, description: "Snapshot token" },
      ],
    });
    let writes = 0;
    const port = createSnapshotSecretValuesPort({
      store: harness.appGlobal.store,
      secretStore: {
        getStatus: () => Effect.die("unused"),
        listStatus: () => Effect.die("unused"),
        resolveInvocationValue: () => Effect.die("unused"),
      },
      secretStoreMutation: {
        writeSecretValue: (input) => {
          writes += 1;
          return Effect.succeed({
            ref: { ...input.target, materialId: input.materialId! },
            revisionFingerprint: `revision:${input.materialId}`,
          });
        },
        removeSecretValue: (input) =>
          Effect.succeed({
            ref: input.ref,
            removed: true,
            revisionFingerprint: input.expectedRevisionFingerprint ?? "revision",
          }),
      },
    });
    const bytes = Redacted.make(
      new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: 1,
          values: [{ extensionId, envName, value: "snapshot-secret-sentinel" }],
        }),
      ),
    );
    const request = {
      targets: [{ extensionId, envName, present: true }],
      bytes,
      clientRequestId: "runtime-client:snapshot-secret-replay" as RuntimeClientRequestId,
    };
    await Effect.runPromise(port.restore(request));
    await Effect.runPromise(port.restore(request));
    expect(writes).toBe(1);
    expect(harness.appGlobal.store.listExtensionEnvSecrets()).toHaveLength(1);
  });

  it("creates the fixed Initial snapshot explicitly during startup and reuses it on reopen", async () => {
    const harness = createBootstrapHarness();
    expect(harness.appGlobal.store.listExtensionSnapshots().snapshots).toEqual([]);

    const first = await createAppRuntimeBootstrap(harness.input);
    expect(harness.appGlobal.store.listExtensionSnapshots().snapshots).toMatchObject([
      { snapshotId: "extension-snapshot:initial", name: "Initial", revision: 1 },
    ]);
    await first.dispose();

    const second = await createAppRuntimeBootstrap(harness.input);
    expect(harness.appGlobal.store.listExtensionSnapshots().snapshots).toHaveLength(1);
    await second.dispose();
  });

  it("retains payload material referenced by a nonterminal restore after snapshot deletion", async () => {
    const harness = createBootstrapHarness();
    const bootstrap = await createAppRuntimeBootstrap(harness.input);
    const snapshot = harness.appGlobal.store.readExtensionSnapshot(
      "extension-snapshot:initial" as never,
    )!;
    harness.appGlobal.store.loadExtensionSnapshot({
      clientRequestId: "runtime-client:pending-restore" as never,
      snapshotId: snapshot.snapshotId,
      expectedRevision: snapshot.revision,
      attemptId: "extension-snapshot-restore:pending-delete" as never,
      startedAt: "2026-07-12T10:00:00.000Z" as never,
    });

    await bootstrap.facade.extensions.snapshots.delete({
      clientRequestId: "runtime-client:delete-pending-snapshot" as never,
      snapshotId: snapshot.snapshotId,
      expectedRevision: snapshot.revision,
      deletedAt: "2026-07-12T10:01:00.000Z" as never,
      cleanupId: "extension-snapshot-cleanup:pending-delete" as never,
    });

    const reopenedPayloadStore = createExtensionSnapshotPayloadStore({
      root: harness.input.snapshotStorageRoot,
      isReferenced: () => false,
    });
    await expect(
      Effect.runPromise(reopenedPayloadStore.read({ ref: snapshot.payloadRef })),
    ).resolves.toMatchObject({ ref: snapshot.payloadRef });
    await bootstrap.dispose();
  });
  it("retries durable app-global extension secret cleanup before exposing the runtime", async () => {
    const harness = createBootstrapHarness();
    const ref = testExtensionSecretRef("material-success");
    harness.appGlobal.store.recordExtensionEnvSecretOrphanCleanup({
      ref,
      revisionFingerprint: "fingerprint-success",
    });

    const bootstrap = await createAppRuntimeBootstrap(harness.input);
    try {
      expect(harness.secretRemovalCalls).toEqual([
        { ref, expectedRevisionFingerprint: "fingerprint-success" },
      ]);
      expect(harness.appGlobal.store.listExtensionEnvSecretCleanupRecords()).toEqual([]);
    } finally {
      await bootstrap.dispose();
    }
  });

  it("completes durable cleanup when exact secret material is already absent", async () => {
    const harness = createBootstrapHarness();
    const ref = testExtensionSecretRef("material-absent");
    harness.appGlobal.store.recordExtensionEnvSecretOrphanCleanup({
      ref,
      revisionFingerprint: "fingerprint-absent",
    });

    const bootstrap = await createAppRuntimeBootstrap({
      ...harness.input,
      secretStoreMutation: {
        ...harness.input.secretStoreMutation,
        removeSecretValue: (request) => {
          harness.secretRemovalCalls.push(request);
          return Effect.fail(
            new SecretStorePortError({
              operation: "removeSecretValue",
              reason: "secret-not-found",
              message: "Secret material is absent.",
            }),
          );
        },
      },
    });
    try {
      expect(harness.secretRemovalCalls).toEqual([
        { ref, expectedRevisionFingerprint: "fingerprint-absent" },
      ]);
      expect(harness.appGlobal.store.listExtensionEnvSecretCleanupRecords()).toEqual([]);
    } finally {
      await bootstrap.dispose();
    }
  });

  it("keeps failed secret cleanup durable without logging host error details", async () => {
    const harness = createBootstrapHarness();
    const ref = testExtensionSecretRef("material-retry");
    const sentinel = "raw-secret-host-error-sentinel";
    harness.appGlobal.store.recordExtensionEnvSecretOrphanCleanup({
      ref,
      revisionFingerprint: "fingerprint-retry",
    });

    const bootstrap = await createAppRuntimeBootstrap({
      ...harness.input,
      secretStoreMutation: {
        ...harness.input.secretStoreMutation,
        removeSecretValue: (request) => {
          harness.secretRemovalCalls.push(request);
          return Effect.fail(
            new SecretStorePortError({
              operation: "removeSecretValue",
              reason: "secret-unavailable",
              message: sentinel,
            }),
          );
        },
      },
    });
    try {
      expect(harness.secretRemovalCalls).toEqual([
        { ref, expectedRevisionFingerprint: "fingerprint-retry" },
      ]);
      expect(harness.appGlobal.store.listExtensionEnvSecretCleanupRecords()).toEqual([
        expect.objectContaining({ ref, revisionFingerprint: "fingerprint-retry" }),
      ]);
      expect(JSON.stringify(harness.appLogs.query())).not.toContain(sentinel);
    } finally {
      await bootstrap.dispose();
    }
  });

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
      expect(bootstrap.readiness.completedPhases).toContain("app-source-reconcile");
      expect(
        harness.appGlobal.store
          .listCurrentWorkflowAgentSources()
          .map((source) => ({ sourceId: source.sourceId, status: source.validationStatus })),
      ).toEqual([
        { sourceId: "defaultAgent", status: "valid" },
        { sourceId: "explorerAgent", status: "valid" },
        { sourceId: "implementerAgent", status: "valid" },
        { sourceId: "reviewerAgent", status: "valid" },
      ]);

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

      const approvalOwner = createPendingApprovalCommand(
        harness.workspaceB.store,
        surfaceB.workspaceSessionId,
        surfaceB.surfacePiSessionId,
      );
      pendingApproval = bootstrap.internal.acceptedNativeTools.requestDirectToolApproval({
        approvalMode: "user",
        cwd: harness.workspaceB.cwd,
        sessionId: surfaceB.workspaceSessionId,
        surfacePiSessionId: surfaceB.surfacePiSessionId,
        turnId: approvalOwner.turnId,
        commandId: approvalOwner.commandId,
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

  it("exposes renderer-safe pi model metadata joined with authoritative provider auth status", async () => {
    const harness = createBootstrapHarness();
    const providerId = "openai" as ProviderId;
    harness.appGlobal.store.recordProviderAuthStatus({
      status: {
        providerId,
        health: "usable",
        redactedAccountLabel: "App OpenAI credential",
      },
      observedAt: "2026-05-01T09:00:00.000Z" as typeof IsoDateTimeStringSchema.Type,
      source: "startup_scan",
    });
    harness.appGlobal.store.recordProviderAuthStatus({
      status: {
        providerId,
        workspaceId: harness.workspaceAId,
        health: "expired",
        redactedAccountLabel: "Workspace A OpenAI credential",
        issue: "Reconnect the workspace credential.",
      },
      observedAt: "2026-05-01T09:00:01.000Z" as typeof IsoDateTimeStringSchema.Type,
      source: "user_action",
    });
    const bootstrap = await createAppRuntimeBootstrap(harness.input);

    try {
      const workspaceAModels = await bootstrap.modelMetadata.list({
        workspaceId: harness.workspaceAId,
        providerId,
      });
      const workspaceBModels = await bootstrap.modelMetadata.list({
        workspaceId: harness.workspaceBId,
        providerId,
      });

      expect(workspaceAModels.length).toBeGreaterThan(0);
      expect(workspaceAModels.every((model) => model.providerId === providerId)).toBe(true);
      expect(workspaceAModels[0]).toMatchObject({
        displayName: expect.any(String),
        inputModalities: expect.arrayContaining(["text"]),
        authStatus: {
          providerId,
          workspaceId: harness.workspaceAId,
          health: "expired",
          redactedAccountLabel: "Workspace A OpenAI credential",
          issue: "Reconnect the workspace credential.",
        },
      });
      expect(workspaceBModels[0]?.authStatus).toMatchObject({
        providerId,
        health: "usable",
        redactedAccountLabel: "App OpenAI credential",
      });
      expect(workspaceBModels[0]?.authStatus).not.toHaveProperty("workspaceId");
    } finally {
      await bootstrap.dispose();
    }
  });

  it("routes workspace-scoped app-log read models and commands to workspace app logs", async () => {
    const harness = createBootstrapHarness();
    harness.appLogs.append({
      level: "warn",
      source: "app.lifecycle",
      message: "app global only",
    });
    harness.workspaceAAppLogs.append({
      level: "error",
      source: "workspace",
      message: "workspace a only",
    });
    const bootstrap = await createAppRuntimeBootstrap(harness.input);

    try {
      const logs = await bootstrap.rendererState.readModels.fetch({
        kind: "appLogs",
        workspaceId: harness.workspaceAId,
        query: { limit: 10 },
      });
      expect(logs.kind).toBe("appLogs");
      if (logs.kind !== "appLogs") throw new Error("Expected appLogs read model.");
      expect(logs.value.entries.map((entry) => entry.message)).toEqual(["workspace a only"]);

      await bootstrap.stateCommands.appLogs.markRead({
        workspaceId: harness.workspaceAId,
        entryIds: ["app-log-1" as AppLogEntryId],
        readAt: "2026-05-01T09:01:00.000Z" as typeof IsoDateTimeStringSchema.Type,
        clientSubmission: {
          clientRequestId: "workspace-a-app-log-mark-read" as RuntimeClientRequestId,
          source: "test" as RuntimeClientSubmissionSource,
        },
      });
      await bootstrap.stateCommands.appLogs.setViewPreferences({
        workspaceId: harness.workspaceAId,
        preferences: { scrollTop: 96, followTail: false },
        readAt: "2026-05-01T09:01:01.000Z" as typeof IsoDateTimeStringSchema.Type,
        clientSubmission: {
          clientRequestId: "workspace-a-app-log-view" as RuntimeClientRequestId,
          source: "test" as RuntimeClientSubmissionSource,
        },
      });

      const workspaceSummary = await bootstrap.rendererState.readModels.fetch({
        kind: "appLogSummary",
        workspaceId: harness.workspaceAId,
      });
      const appSummary = await bootstrap.rendererState.readModels.fetch({ kind: "appLogSummary" });
      expect(workspaceSummary.kind).toBe("appLogSummary");
      expect(appSummary.kind).toBe("appLogSummary");
      if (workspaceSummary.kind !== "appLogSummary" || appSummary.kind !== "appLogSummary") {
        throw new Error("Expected appLogSummary read models.");
      }
      expect(workspaceSummary.value.seenSeq).toBe(1);
      expect(appSummary.value.seenSeq).toBe(0);
      expect(workspaceSummary.value).toMatchObject({
        seenSeq: 1,
      });
      const workspaceLogsAfterView = await bootstrap.rendererState.readModels.fetch({
        kind: "appLogs",
        workspaceId: harness.workspaceAId,
        query: { limit: 10 },
      });
      expect(workspaceLogsAfterView).toMatchObject({
        kind: "appLogs",
        value: { persistedView: { scrollTop: 96, followTail: false } },
      });
    } finally {
      await bootstrap.dispose();
    }
  });

  it("publishes routed state commands through the real runtime event path before returning receipts", async () => {
    const harness = createBootstrapHarness();
    const bootstrap = await createAppRuntimeBootstrap(harness.input);
    const subscription = await bootstrap.facade.events({
      afterSequence: 0 as RuntimeEventSequence,
    });

    try {
      const events: RuntimeEvent[] = [];
      const eventReader = (async () => {
        for await (const event of subscription) {
          events.push(event);
          if (
            event.type === "app_read_model.changed" &&
            event.invalidation.model === "appPreferences"
          ) {
            return event;
          }
        }
        throw new Error("Runtime event stream closed before app preferences publication.");
      })();

      const command = bootstrap.stateCommands.appPreferences.update({
        patch: {
          approvalMode: "user",
        },
        clientSubmission: {
          clientRequestId: "app-preferences-real-publication" as RuntimeClientRequestId,
          source: "test" as RuntimeClientSubmissionSource,
        },
      });

      const result = await command;
      const event = await eventReader;
      expect(result.receipt).toMatchObject({
        clientRequestId: "app-preferences-real-publication",
        outcome: "applied",
      });
      if (event.type !== "app_read_model.changed") {
        throw new Error("Expected app_read_model.changed event.");
      }
      expect(event.invalidation).toEqual({ model: "appPreferences" });
      expect(events.at(-1)).toEqual(event);
      expect(
        events.some(
          (candidate) =>
            candidate.type === "app_read_model.changed" &&
            candidate.invalidation.model === "agents",
        ),
      ).toBe(true);
    } finally {
      await subscription.close();
      await bootstrap.dispose();
    }
  });

  it("publishes renderer-visible workspace app-log invalidations for direct AppLogger commits", async () => {
    const harness = createBootstrapHarness();
    const bootstrap = await createAppRuntimeBootstrap(harness.input);
    const subscription = await bootstrap.facade.events({
      workspaceId: harness.workspaceAId,
      includeAppEvents: false,
    });

    try {
      const eventReader = (async () => {
        for await (const event of subscription) {
          if (
            event.type === "workspace_read_model.changed" &&
            event.invalidation.model === "appLogs"
          ) {
            return event;
          }
        }
        throw new Error("Runtime event stream closed before workspace app-log publication.");
      })();

      const logger = createAppLogger({ appLogs: harness.workspaceAAppLogs });
      expect(logger.info("workspace", "Direct workspace logger append.")).not.toBeNull();

      const event = await eventReader;
      expect(event.workspaceId).toBe(harness.workspaceAId);
      expect(event.invalidation).toEqual({ model: "appLogs" });
      const refetched = await bootstrap.rendererState.readModels.refetchInvalidation({
        descriptor: {
          scope: "workspace",
          workspaceId: harness.workspaceAId,
          invalidation: event.invalidation,
        },
      });
      expect(refetched.map((readModel) => readModel.kind)).toEqual(["appLogs", "appLogSummary"]);
    } finally {
      await subscription.close();
      await bootstrap.dispose();
    }
  });

  it("publishes renderer-visible app-log invalidations for direct app facade commits", async () => {
    const harness = createBootstrapHarness();
    const bootstrap = await createAppRuntimeBootstrap(harness.input);
    const subscription = await bootstrap.facade.events();

    try {
      const eventReader = (async () => {
        for await (const event of subscription) {
          if (event.type === "app_read_model.changed" && event.invalidation.model === "appLogs") {
            return event;
          }
        }
        throw new Error("Runtime event stream closed before app-global app-log publication.");
      })();

      expect(
        harness.appLogs.append({
          level: "info",
          source: "app.lifecycle",
          message: "Direct app facade append.",
        }),
      ).toMatchObject({ message: "Direct app facade append." });

      const event = await eventReader;
      expect(event.invalidation).toEqual({ model: "appLogs" });
      const refetched = await bootstrap.rendererState.readModels.refetchInvalidation({
        descriptor: { scope: "app", invalidation: event.invalidation },
      });
      expect(refetched.map((readModel) => readModel.kind)).toEqual(["appLogs", "appLogSummary"]);
    } finally {
      await subscription.close();
      await bootstrap.dispose();
    }
  });

  it("hydrates renderer-safe command groups without state facade lifecycle", async () => {
    const harness = createBootstrapHarness();
    const bootstrap = await createAppRuntimeBootstrap(harness.input);

    try {
      expect(Object.keys(bootstrap.rendererStateCommands)).toEqual([
        "workspaceChrome",
        "workspaceLayout",
        "appLogs",
        "appPreferences",
        "providerAuth",
        "extensionEnv",
        "agentProfiles",
        "snippets",
      ]);
      expect("close" in bootstrap.rendererStateCommands).toBe(false);
    } finally {
      await bootstrap.dispose();
    }
  });

  it("seeds exact external-instruction preferences into authoritative state rows", async () => {
    const harness = createBootstrapHarness();
    const externalInstructions: AppPreferences["externalInstructions"] = {
      globalRoots: [
        {
          id: "bootstrap-team-docs",
          kind: "custom",
          label: "Bootstrap team docs",
          path: "/tmp/bootstrap-team-docs",
          enabled: true,
        },
      ],
      globalControls: {
        "/tmp/bootstrap-team-docs/AGENTS.md": {
          enabled: true,
          actors: ["handler", "workflow-task"],
        },
      },
      workspaceControls: {},
    };
    const bootstrap = await createAppRuntimeBootstrap({
      ...harness.input,
      appPreferencesSeed: {
        hasStateRows: () => false,
        read: () => ({
          ...structuredClone(DEFAULT_AGENT_SETTINGS_STATE.appPreferences),
          externalInstructions,
        }),
      },
    });

    try {
      const result = await bootstrap.rendererState.readModels.fetch({ kind: "appPreferences" });
      expect(result.kind).toBe("appPreferences");
      if (result.kind !== "appPreferences") {
        throw new Error("Expected appPreferences read model.");
      }
      expect(result.value.externalInstructions).toEqual(
        normalizeExternalInstructionsSettings(externalInstructions),
      );
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

  it("fails startup with typed app-source readiness when packaged agent templates are missing", async () => {
    const harness = createBootstrapHarness();
    const missingTemplatesRoot = mkdtempTracked("missing-workflow-agent-templates") as AbsolutePath;

    await expect(
      createAppRuntimeBootstrap({
        ...harness.input,
        packagedExtensionTemplatesRoot: missingTemplatesRoot,
      }),
    ).rejects.toMatchObject({
      _tag: "RuntimeStartupError",
      phase: "app-source-reconcile",
      reason: "required-startup-check-failed",
    });
  });

  it("rejects public and bootstrap-internal calls as soon as app shutdown starts", async () => {
    const harness = createBootstrapHarness();
    const bootstrap = await createAppRuntimeBootstrap(harness.input);

    const firstShutdown = bootstrap.dispose();
    const duplicateShutdown = bootstrap.dispose();

    expect(() => bootstrap.internal.workspaceStates.unregister(harness.workspaceAId)).toThrow(
      RuntimeContractError,
    );
    try {
      bootstrap.internal.workspaceStates.unregister(harness.workspaceAId);
    } catch (error) {
      expect(error).toMatchObject({
        operation: "app-runtime-bootstrap.workspaceStates.unregister",
        reason: "runtime-shutdown",
      });
    }
    await expect(bootstrap.facade.events()).rejects.toMatchObject({
      type: "runtime-facade-error",
      reason: "typed-failure",
    });
    await expect(
      bootstrap.modelMetadata.list({
        workspaceId: harness.workspaceAId,
        providerId: "openai" as ProviderId,
      }),
    ).rejects.toMatchObject({
      operation: "app-runtime-bootstrap.modelMetadata.list",
      reason: "runtime-shutdown",
    });
    await expect(Promise.all([firstShutdown, duplicateShutdown])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("keeps facades open through runtime preparation, then closes them before disposal", () => {
    const source = readFileSync(new URL("./app-runtime-bootstrap.ts", import.meta.url), "utf8");
    const start = source.indexOf('dispose: (reason = "app-shutdown")');
    const end = source.indexOf("          .then(() => undefined)", start);
    const shutdownSource = source.slice(start, end);
    const closeSubscriptions = shutdownSource.indexOf("closeCommittedAppLogAppendSubscriptions();");
    const closeRuntimeFacade = shutdownSource.indexOf("await facade.close();");
    const prepareRuntime = shutdownSource.indexOf("() => prepareShutdown(managedRuntime, reason)");
    const disposeRuntime = shutdownSource.indexOf("() => disposeManagedRuntime(managedRuntime)");

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(closeSubscriptions).toBeGreaterThanOrEqual(0);
    expect(closeRuntimeFacade).toBeGreaterThan(closeSubscriptions);
    expect(prepareRuntime).toBeLessThan(closeSubscriptions);
    expect(disposeRuntime).toBeGreaterThan(closeRuntimeFacade);
    expect(shutdownSource.match(/disposeManagedRuntime\(managedRuntime\)/g)).toHaveLength(1);
  });

  it("prepares an already-ready runtime with the requested startup-failure reason", async () => {
    const harness = createBootstrapHarness();
    const bootstrap = await createAppRuntimeBootstrap(harness.input);
    const surface = await bootstrap.facade.surfaces.createOrchestrator({
      workspaceId: harness.workspaceAId,
      title: "Startup failure cleanup",
    } satisfies CreateOrchestratorSurfaceInput);
    const approvalOwner = createPendingApprovalCommand(
      harness.workspaceA.store,
      surface.workspaceSessionId,
      surface.surfacePiSessionId,
    );
    const pendingApproval = bootstrap.internal.acceptedNativeTools.requestDirectToolApproval({
      approvalMode: "user",
      cwd: harness.workspaceA.cwd,
      sessionId: surface.workspaceSessionId,
      surfacePiSessionId: surface.surfacePiSessionId,
      turnId: approvalOwner.turnId,
      commandId: approvalOwner.commandId,
      toolCallId: "tool_app_bootstrap_startup_failure" as ToolItemId,
      toolName: "exec_command",
      command: "echo pending",
      commandFamily: "shell",
    });
    await waitForOpenApproval(harness.workspaceA.store, 1);

    await bootstrap.dispose("startup-failure");

    await expect(pendingApproval).resolves.toEqual({
      approved: false,
      reason: "Runtime shutdown: startup-failure.",
    });
  });
});

function testExtensionSecretRef(materialId: string): ExtensionEnvSecretRef {
  return {
    kind: "extension-env",
    extensionId: "test-extension",
    envName: "TEST_TOKEN",
    materialId,
  } as ExtensionEnvSecretRef;
}

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
  const sourceCalls: string[] = [];
  const appLogs = createStateAppLogsFacade({ digest: testDigest, now: deterministicClock() });
  const workspaceAAppLogs = createStateAppLogsFacade({
    digest: testDigest,
    workspaceId: workspaceAId,
    now: deterministicClock(),
  });
  const workspaceBAppLogs = createStateAppLogsFacade({
    digest: testDigest,
    workspaceId: workspaceBId,
    now: deterministicClock(),
  });
  openAppLogs.push(appLogs);
  openAppLogs.push(workspaceAAppLogs);
  openAppLogs.push(workspaceBAppLogs);
  const storesBySession = new Map<string, WorkspaceId>();
  const secretRemovalCalls: RemoveSecretValueInput[] = [];
  const secretStore = {
    getStatus: (ref: RemoveSecretValueInput["ref"]) =>
      Effect.succeed({ ref, configured: false as const }),
    listStatus: ({ refs }: { refs: readonly RemoveSecretValueInput["ref"][] }) =>
      Effect.succeed(refs.map((ref) => ({ ref, configured: false as const }))),
    resolveInvocationValue: () => Effect.die("unused test secret resolution"),
  };
  const secretStoreMutation = {
    writeSecretValue: () => Effect.die("unused test secret write"),
    removeSecretValue: (request: RemoveSecretValueInput) => {
      secretRemovalCalls.push(request);
      return Effect.succeed({
        ref: request.ref,
        removed: true,
        revisionFingerprint: request.expectedRevisionFingerprint ?? "test-secret-revision",
      });
    },
  };
  const commandRegistry = createLiveCommandStdinRegistry();
  commandRegistry.register({
    commandId: "command-bootstrap-test" as CommandId,
    sessionId: "live-command-session",
    writeStdin: (text) => ({ status: "accepted", acceptedBytes: Buffer.byteLength(text) }),
    cancel: () => ({ status: "cancelled" }),
  });

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
    packagedExtensionTemplatesRoot: join(
      import.meta.dir,
      "..",
      "..",
      "packages",
      "extensions",
      "src",
      "builtin",
    ) as AbsolutePath,
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
    extensionBuildProcess: successfulExtensionBuildProcessTestService,
    extensionCliRequirementProbe: {
      probe: (plan) =>
        Effect.succeed(
          plan.probeKind === "resolve-executable"
            ? ({ status: "resolved" } as const)
            : ({
                status: "completed",
                exitCode: 0,
                stdout: "test-cli 1.0.0",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              } as const),
        ),
    },
    secretStore,
    secretStoreMutation,
    snapshotStorageRoot: mkdtempTracked("snapshot-storage") as AbsolutePath,
    generatedPackageLinkPath: async ({ packageName, workspaceId }) =>
      join(
        tmpdir(),
        "svvy-app-bootstrap-links",
        workspaceId,
        packageName === "@svvyx/workflows" ? "workflows" : "extensions",
      ) as AbsolutePath,
    sandboxPolicySource: testSandboxPolicySource(),
    appLogs,
    resolveWorkspaceAppLogs: async (workspaceId: WorkspaceId) => {
      if (workspaceId === workspaceAId) return workspaceAAppLogs;
      if (workspaceId === workspaceBId) return workspaceBAppLogs;
      throw new Error(`Unknown workspace app logs ${workspaceId}`);
    },
    appLogWritePort: appLogs.writePort,
    sandboxHostSupport: createTestSandboxHostSupport(),
    runtimeLayerConfig: defaultRuntimeLayerConfig,
    commandRegistry,
    executeTypescriptHost: {
      runExecuteTypescript: () => Effect.die("Unexpected execute_typescript host execution."),
    },
    providerAuth: {
      ensureUsableProviderAuth: async () => "test-api-key",
      getProviderAuthUnavailableMessage: (provider: string) => `${provider} auth unavailable.`,
    },
    piRuntimePaths: {
      resolve: async (workspaceId: WorkspaceId) => ({
        workspaceId,
        cwd: join(tmpdir(), "svvy-app-bootstrap-workspaces", workspaceId) as AbsolutePath,
        agentDir: join(tmpdir(), "svvy-app-bootstrap-agent") as AbsolutePath,
        sessionDir: join(tmpdir(), "svvy-app-bootstrap-sessions", workspaceId) as AbsolutePath,
        modelRegistryPath: join(
          tmpdir(),
          "svvy-app-bootstrap-agent",
          "model-registry.json",
        ) as AbsolutePath,
        source: "test-fixture",
      }),
    },
    generatedContextRefresh: {
      refresh: async () => {},
    },
    generatedPackageRefresh: testGeneratedPackageRefreshHost(),
    externalInstructionScanInput: {
      resolve: (workspaceId: WorkspaceId) => {
        const workspace = workspaceId === workspaceAId ? workspaceA : workspaceB;
        return Effect.succeed({
          workspaceId,
          workspaceRoot: workspace.cwd,
          cwd: workspace.cwd,
          homeDirectory: tmpdir() as AbsolutePath,
          settings: {
            globalRoots: [],
            globalControls: {},
            workspaceControls: {},
          },
        });
      },
    },
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
    appLogs,
    workspaceA,
    workspaceAId,
    workspaceAAppLogs,
    workspaceB,
    workspaceBId,
    secretRemovalCalls,
    workspaceBAppLogs,
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

function createPendingApprovalCommand(
  store: StructuredSessionStateStore,
  sessionId: WorkspaceSessionId,
  surfacePiSessionId: SurfacePiSessionId,
): { readonly turnId: TurnId; readonly commandId: CommandId } {
  const turn = store.startTurn({
    sessionId,
    surfacePiSessionId,
    requestSummary: "Exercise a pending runtime approval.",
  });
  const command = store.createCommand({
    turnId: turn.id,
    surfacePiSessionId,
    toolName: "exec_command",
    executor: "orchestrator",
    visibility: "surface",
    title: "Pending approved command",
    summary: "Wait for runtime approval.",
  });
  return {
    turnId: turn.id as TurnId,
    commandId: command.id as CommandId,
  };
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
