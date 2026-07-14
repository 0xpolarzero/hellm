import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import * as Effect from "effect/Effect";
import type {
  AbsolutePath,
  CommandId,
  RecoveryWorkId,
  RuntimeApprovalId,
  RuntimeClientSubmissionSource,
  RuntimeClientRequestId,
  RuntimeEvent,
  RuntimeOwnerId,
  SecretStoreMutationPortService,
  SecretStorePortService,
  SubmitMessageInput,
  WorkspaceId,
} from "@svvy/core";
import {
  applyExtensionManagementRuntimeRequest,
  WorkspaceRuntimeRegistry,
  type WorkspaceRuntime,
} from "./workspace-runtime-registry";
import {
  getWorkspaceRuntimeForRequest,
  getWorkspaceRuntimeOperationsForRequest,
} from "./workspace-rpc-routing";
import { STRUCTURED_SESSION_DB_FILENAME, getSvvySessionDir } from "./session-catalog";
import { createStructuredSessionStateStore } from "@svvy/state/structured-session-state";
import { getDefaultWorkspaceCwd } from "./workspace-context";
import { createTestSandboxHostSupport } from "./sandbox-host-support.test-support";
import { defaultRuntimeLayerConfig } from "@svvy/runtime/bootstrap";
import type { LiveCommandStdinRegistry } from "./live-command-stdin-registry";
import { successfulExtensionBuildProcessTestService } from "./extension-build-process.test-support";

const tempDirs: string[] = [];
const registries: WorkspaceRuntimeRegistry[] = [];
const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

function normalizeWorkspaceRuntimeId(cwd: string): string {
  return `workspace:${createHash("sha256").update(cwd).digest("hex").slice(0, 24)}`;
}

afterEach(async () => {
  const registriesToClose = registries.splice(0);
  for (const registry of registriesToClose) {
    for (let attempts = 0; registry.listOpenWorkspaces().length && attempts < 20; attempts += 1) {
      await Promise.all(
        registry
          .listOpenWorkspaces()
          .map((workspace) => registry.closeWorkspace(workspace.workspaceId)),
      );
    }
    await registry.shutdownApp();
  }
});

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("WorkspaceRuntimeRegistry", () => {
  it("dispatches Extension Managing source mutations through Runtime and preserves receipts", async () => {
    const workspaceId = "workspace:extension-management" as WorkspaceId;
    const calls: Array<{ method: string; input: unknown }> = [];
    const respond =
      <Result>(method: string, result: Result) =>
      async (input: unknown) => {
        calls.push({ method, input });
        return result;
      };
    const mutationId = "extension-source-mutation:notes:a";
    const revertedMutationId = "extension-source-mutation:notes:b";
    const receipts = {
      create: { action: "created", changed: true, extensionId: "notes", mutationId },
      duplicate: {
        action: "duplicated",
        changed: true,
        extensionId: "notes-copy",
        sourceExtensionId: "notes",
        mutationId,
      },
      delete: { action: "deleted", changed: true, extensionId: "notes", mutationId },
      reset: {
        source: {
          action: "reset",
          changed: true,
          extensionId: "notes",
          mutationId,
          scope: "instructions",
        },
        automaticBuild: { status: "succeeded", attemptId: "extension-build-attempt:reset" },
      },
      add: {
        action: "instruction-added",
        changed: true,
        extensionId: "notes",
        mutationId,
        name: "010-notes.mdx",
      },
      remove: {
        action: "instruction-removed",
        changed: true,
        extensionId: "notes",
        mutationId,
        name: "010-notes.mdx",
      },
      configure: {
        action: "instruction-configured",
        bypassed: true,
        changed: false,
        extensionId: "notes",
        mutationId: null,
        name: "010-notes.mdx",
      },
      rename: {
        action: "instruction-renamed",
        changed: true,
        extensionId: "notes",
        from: "010-notes.mdx",
        mutationId,
        to: "020-notes.mdx",
      },
      reorder: {
        action: "instructions-reordered",
        changed: true,
        extensionId: "notes",
        mutationId,
        order: ["020-notes.mdx"],
      },
      revert: {
        source: {
          action: "mutation-reverted",
          changed: true,
          extensionId: "notes",
          mutationId,
          revertedMutationId,
        },
        automaticBuild: { status: "succeeded", attemptId: "extension-build-attempt:revert" },
      },
      typescriptApi: {
        extensionId: "notes",
        enabled: true,
        changed: true,
        reconcileRequired: true,
      },
    };
    const runtime = {
      facade: {
        extensions: {
          create: respond("extensions.create", receipts.create),
          duplicate: respond("extensions.duplicate", receipts.duplicate),
          delete: respond("extensions.delete", receipts.delete),
          reset: respond("extensions.reset", receipts.reset),
          addInstruction: respond("extensions.addInstruction", receipts.add),
          removeInstruction: respond("extensions.removeInstruction", receipts.remove),
          configureInstruction: respond("extensions.configureInstruction", receipts.configure),
          renameInstruction: respond("extensions.renameInstruction", receipts.rename),
          reorderInstructions: respond("extensions.reorderInstructions", receipts.reorder),
          revertMutation: respond("extensions.revertMutation", receipts.revert),
        },
        sourceEdits: {
          configureTypescriptApi: respond(
            "sourceEdits.configureTypescriptApi",
            receipts.typescriptApi,
          ),
        },
      },
    } as never;
    const cases = [
      {
        request: {
          operation: "create",
          input: {
            id: "notes",
            title: "Notes",
            description: "Notes extension.",
            interfaceKind: "instructions",
            typescriptApiEnabled: false,
          },
        },
        receipt: receipts.create,
        facts: {
          extensionCreated: true,
          extensionId: "notes",
          extensionMutationId: mutationId,
        },
      },
      {
        request: {
          operation: "duplicate",
          input: { sourceExtensionId: "notes", targetExtensionId: "notes-copy", title: "Copy" },
        },
        receipt: receipts.duplicate,
        facts: {
          extensionDuplicated: true,
          extensionId: "notes-copy",
          duplicatedFrom: "notes",
          extensionMutationId: mutationId,
        },
      },
      {
        request: { operation: "delete", input: { extensionId: "notes" } },
        receipt: receipts.delete,
        facts: {
          extensionDeleted: true,
          extensionId: "notes",
          extensionMutationId: mutationId,
        },
      },
      {
        request: {
          operation: "instructions.add",
          input: { extensionId: "notes", name: "010-notes.mdx" },
        },
        receipt: receipts.add,
        facts: {
          instructionChanged: true,
          instructionAction: "instruction-added",
          instructionFile: "010-notes.mdx",
          extensionId: "notes",
          extensionMutationId: mutationId,
        },
      },
      {
        request: {
          operation: "instructions.remove",
          input: { extensionId: "notes", name: "010-notes.mdx" },
        },
        receipt: receipts.remove,
        facts: {
          instructionChanged: true,
          instructionAction: "instruction-removed",
          instructionFile: "010-notes.mdx",
          extensionId: "notes",
          extensionMutationId: mutationId,
        },
      },
      {
        request: {
          operation: "instructions.configure",
          input: { extensionId: "notes", name: "010-notes.mdx", bypassed: true },
        },
        receipt: receipts.configure,
        facts: {
          instructionChanged: false,
          instructionAction: "instruction-configured",
          instructionFile: "010-notes.mdx",
          extensionId: "notes",
          extensionMutationId: null,
        },
      },
      {
        request: {
          operation: "instructions.rename",
          input: { extensionId: "notes", from: "010-notes.mdx", to: "020-notes.mdx" },
        },
        receipt: receipts.rename,
        facts: {
          instructionChanged: true,
          instructionAction: "instruction-renamed",
          instructionFile: "020-notes.mdx",
          extensionId: "notes",
          extensionMutationId: mutationId,
        },
      },
      {
        request: {
          operation: "instructions.reorder",
          input: { extensionId: "notes", order: ["020-notes.mdx"] },
        },
        receipt: receipts.reorder,
        facts: {
          instructionChanged: true,
          instructionAction: "instructions-reordered",
          extensionId: "notes",
          extensionMutationId: mutationId,
        },
      },
      {
        request: {
          operation: "typescript-api.configure",
          input: { workspaceId, extensionId: "notes", enabled: true },
        },
        receipt: receipts.typescriptApi,
        facts: {
          extensionConfigured: true,
          extensionId: "notes",
          typescriptApiEnabled: true,
          extensionChanged: true,
        },
      },
    ] as const;

    for (const item of cases) {
      await expect(
        applyExtensionManagementRuntimeRequest(runtime, item.request as never, workspaceId),
      ).resolves.toEqual({ output: { ok: true, receipt: item.receipt }, commandFacts: item.facts });
    }

    await expect(
      applyExtensionManagementRuntimeRequest(
        runtime,
        { operation: "reset", input: { extensionId: "notes", scope: "instructions" } } as never,
        workspaceId,
      ),
    ).resolves.toEqual({
      output: {
        ok: true,
        receipt: receipts.reset.source,
        automaticBuild: receipts.reset.automaticBuild,
      },
      commandFacts: {
        extensionReset: true,
        extensionId: "notes",
        extensionMutationId: mutationId,
        automaticBuildStatus: "succeeded",
      },
    });
    await expect(
      applyExtensionManagementRuntimeRequest(
        runtime,
        { operation: "source.revert", input: { mutationId: revertedMutationId } } as never,
        workspaceId,
      ),
    ).resolves.toEqual({
      output: {
        ok: true,
        receipt: receipts.revert.source,
        automaticBuild: receipts.revert.automaticBuild,
      },
      commandFacts: {
        extensionReverted: true,
        extensionId: "notes",
        extensionMutationId: mutationId,
        revertedExtensionMutationId: revertedMutationId,
        automaticBuildStatus: "succeeded",
      },
    });
    expect(calls.map((call) => call.method)).toEqual([
      "extensions.create",
      "extensions.duplicate",
      "extensions.delete",
      "extensions.addInstruction",
      "extensions.removeInstruction",
      "extensions.configureInstruction",
      "extensions.renameInstruction",
      "extensions.reorderInstructions",
      "sourceEdits.configureTypescriptApi",
      "extensions.reset",
      "extensions.revertMutation",
    ]);

    await expect(
      applyExtensionManagementRuntimeRequest(
        runtime,
        {
          operation: "typescript-api.configure",
          input: {
            workspaceId: "workspace:retargeted",
            extensionId: "notes",
            enabled: false,
          },
        } as never,
        workspaceId,
      ),
    ).rejects.toThrow("owning scoped workspace runtime");
    expect(calls).toHaveLength(11);
  });

  it("dispatches Extension Managing inspect and build through parent Runtime authority", async () => {
    const buildInputs: unknown[] = [];
    const runtime = {
      state: {
        readModels: {
          fetch: async () => ({
            kind: "extensions",
            value: {
              aggregateFingerprint: "registry-fingerprint",
              observedAt: "2026-07-13T10:00:00.000Z",
              records: [
                {
                  extensionId: "notes",
                  category: "user",
                  interfaceKind: "svvyx",
                  title: "Notes",
                  description: "Project notes.",
                  capabilities: {
                    resettable: true,
                    deletable: true,
                    typescriptApiEnabled: true,
                  },
                  customized: false,
                  contributors: [],
                  tooling: [],
                  loadedByProfileIds: [],
                  availableByProfileIds: ["default-orchestrator"],
                  usagePolicy: { defaultState: "available", reason: "user-extension" },
                  cliDeclarations: [],
                  cliReadiness: [],
                  env: [],
                  dependencyRequirements: [],
                  buildAuthorityStatus: "current",
                  buildRequired: false,
                  contextReady: true,
                  runtimeReady: true,
                  readiness: "ready",
                  generatedPackageStatus: "ready",
                  sourceFingerprint: `sha256:${"a".repeat(64)}`,
                },
              ],
            },
          }),
        },
      },
      facade: {
        extensions: {
          build: async (input: unknown) => {
            buildInputs.push(input);
            return {
              attemptId: `extension-build-attempt:notes:${"b".repeat(64)}`,
              manifest: { contextReady: true },
            };
          },
        },
      },
    } as never;

    await expect(
      applyExtensionManagementRuntimeRequest(runtime, {
        operation: "inspect",
        input: { extensionId: "notes" },
      } as never),
    ).resolves.toMatchObject({
      output: {
        ok: true,
        extension: {
          id: "notes",
          state: { runtimeReady: true, readiness: "ready", issues: [] },
        },
      },
      commandFacts: { extensionId: "notes", extensionReady: true },
    });

    const buildInput = {
      extensionId: "notes",
      clientRequestId: "runtime-client:build-notes",
    };
    await expect(
      applyExtensionManagementRuntimeRequest(runtime, {
        operation: "build",
        input: buildInput,
      } as never),
    ).resolves.toEqual({
      output: {
        ok: true,
        extensionId: "notes",
        attemptId: `extension-build-attempt:notes:${"b".repeat(64)}`,
        build: { status: "success", contextReady: true },
      },
      commandFacts: {
        extensionBuildOk: true,
        extensionId: "notes",
        extensionBuildAttemptId: `extension-build-attempt:notes:${"b".repeat(64)}`,
      },
    });
    expect(buildInputs).toEqual([buildInput]);
  });

  it("returns Runtime-derived affected surfaces for usage and snapshot changes", async () => {
    const snapshotSaveInputs: unknown[] = [];
    const snapshotRenameInputs: unknown[] = [];
    const snapshotDeleteInputs: unknown[] = [];
    const snapshotLoadInputs: unknown[] = [];
    const usageSurface = {
      surfacePiSessionId: "surface:usage" as never,
      kind: "extension_context_changed" as const,
      label: "Extensions changed" as const,
      reason: "extension_usage_changed" as const,
    };
    const snapshotSurface = {
      surfacePiSessionId: "surface:snapshot" as never,
      kind: "extension_context_changed" as const,
      label: "Extensions changed" as const,
      reason: "snapshot_loaded" as const,
    };
    const runtime = {
      facade: {
        extensions: {
          setUsage: async () => ({
            change: {
              changeId: "extension-usage-change:one",
              extensionId: "smithers",
              before: "available",
              after: "loaded",
            },
            affectedSurfaces: [usageSurface],
          }),
          revertUsage: async () => ({
            change: {
              changeId: "extension-usage-change:revert",
              extensionId: "smithers",
              before: "loaded",
              after: "available",
            },
            affectedSurfaces: [usageSurface],
          }),
          snapshots: {
            list: async () => ({
              snapshots: [{ snapshotId: "extension-snapshot:one", revision: 1 }],
            }),
            save: async (input: unknown) => {
              snapshotSaveInputs.push(input);
              return { snapshotId: "extension-snapshot:saved", revision: 1 };
            },
            rename: async (input: unknown) => {
              snapshotRenameInputs.push(input);
              return { snapshotId: "extension-snapshot:one", revision: 2 };
            },
            delete: async (input: unknown) => {
              snapshotDeleteInputs.push(input);
              return { snapshotId: "extension-snapshot:one", deleted: true as const };
            },
            load: async (input: unknown) => {
              snapshotLoadInputs.push(input);
              return {
                snapshotId: "extension-snapshot:one",
                attemptId: "extension-snapshot-restore:one",
                status: "completed" as const,
                builds: [],
                affectedSurfaces: [snapshotSurface],
              };
            },
          },
        },
      },
    } as never;

    await expect(
      applyExtensionManagementRuntimeRequest(runtime, {
        operation: "usage.set",
        input: {
          clientRequestId: "runtime-client:usage",
          extensionId: "smithers",
          agentProfile: "default-orchestrator",
          usage: "loaded",
        },
      } as never),
    ).resolves.toMatchObject({
      output: { agentContextImpact: { affectedSurfaces: [usageSurface] } },
      commandFacts: { affectedAgentContextSurfaces: 1 },
    });

    await expect(
      applyExtensionManagementRuntimeRequest(runtime, {
        operation: "usage.revert",
        input: {
          clientRequestId: "runtime-client:usage-revert",
          changeId: "extension-usage-change:one",
        },
      } as never),
    ).resolves.toMatchObject({
      output: {
        reverted: "extension-usage-change:one",
        changeId: "extension-usage-change:revert",
        agentContextImpact: { affectedSurfaces: [usageSurface] },
      },
      commandFacts: {
        extensionUsageReverted: true,
        affectedAgentContextSurfaces: 1,
      },
    });

    await expect(
      applyExtensionManagementRuntimeRequest(runtime, {
        operation: "snapshots.list",
        input: {},
      } as never),
    ).resolves.toEqual({
      output: {
        ok: true,
        snapshots: [{ snapshotId: "extension-snapshot:one", revision: 1 }],
      },
      commandFacts: { extensionSnapshotsListed: true, extensionSnapshotCount: 1 },
    });

    await expect(
      applyExtensionManagementRuntimeRequest(runtime, {
        operation: "snapshots.save",
        input: { clientRequestId: "runtime-client:snapshot-save", name: "Before refactor" },
      } as never),
    ).resolves.toEqual({
      output: {
        ok: true,
        snapshot: { snapshotId: "extension-snapshot:saved", revision: 1 },
      },
      commandFacts: {
        extensionSnapshotSaved: true,
        snapshotId: "extension-snapshot:saved",
      },
    });

    await expect(
      applyExtensionManagementRuntimeRequest(runtime, {
        operation: "snapshots.rename",
        input: {
          clientRequestId: "runtime-client:snapshot-rename",
          snapshotId: "extension-snapshot:one",
          name: "After refactor",
        },
      } as never),
    ).resolves.toEqual({
      output: {
        ok: true,
        snapshot: { snapshotId: "extension-snapshot:one", revision: 2 },
      },
      commandFacts: {
        extensionSnapshotRenamed: true,
        snapshotId: "extension-snapshot:one",
      },
    });

    await expect(
      applyExtensionManagementRuntimeRequest(runtime, {
        operation: "snapshots.delete",
        input: {
          clientRequestId: "runtime-client:snapshot-delete",
          snapshotId: "extension-snapshot:one",
        },
      } as never),
    ).resolves.toEqual({
      output: { ok: true, snapshotId: "extension-snapshot:one", deleted: true },
      commandFacts: {
        extensionSnapshotDeleted: true,
        snapshotId: "extension-snapshot:one",
      },
    });

    await expect(
      applyExtensionManagementRuntimeRequest(runtime, {
        operation: "snapshots.load",
        input: {
          clientRequestId: "runtime-client:snapshot",
          snapshotId: "extension-snapshot:one",
        },
      } as never),
    ).resolves.toEqual({
      output: {
        ok: true,
        snapshotId: "extension-snapshot:one",
        attemptId: "extension-snapshot-restore:one",
        status: "completed",
        builds: [],
        agentContextImpact: { affectedSurfaces: [snapshotSurface] },
      },
      commandFacts: {
        extensionSnapshotLoaded: true,
        snapshotId: "extension-snapshot:one",
        extensionSnapshotLoadStatus: "completed",
        affectedAgentContextSurfaces: 1,
      },
    });

    expect(snapshotSaveInputs).toEqual([
      expect.objectContaining({
        clientRequestId: "runtime-client:snapshot-save",
        name: "Before refactor",
        snapshotId: expect.stringMatching(/^extension-snapshot:/),
        capturedAt: expect.any(String),
      }),
    ]);
    expect(snapshotRenameInputs).toEqual([
      expect.objectContaining({
        clientRequestId: "runtime-client:snapshot-rename",
        snapshotId: "extension-snapshot:one",
        name: "After refactor",
        expectedRevision: 1,
        renamedAt: expect.any(String),
      }),
    ]);
    expect(snapshotDeleteInputs).toEqual([
      expect.objectContaining({
        clientRequestId: "runtime-client:snapshot-delete",
        snapshotId: "extension-snapshot:one",
        expectedRevision: 1,
        deletedAt: expect.any(String),
        cleanupId: expect.stringMatching(/^extension-snapshot-cleanup:/),
      }),
    ]);
    expect(snapshotLoadInputs).toEqual([
      expect.objectContaining({
        clientRequestId: "runtime-client:snapshot",
        snapshotId: "extension-snapshot:one",
        expectedRevision: 1,
        attemptId: expect.stringMatching(/^extension-snapshot-restore:/),
        startedAt: expect.any(String),
      }),
    ]);
  });

  it("acquires one readiness-gated desktop facade bundle without exposing bootstrap authority", async () => {
    const registry = createRegistry(tempWorkspace("desktop-facade-acquisition"));

    expect(registry["appRuntimeBootstrap"]).toBeNull();
    const firstAcquisition = registry.acquireDesktopAppFacades();
    const secondAcquisition = registry.acquireDesktopAppFacades();

    expect(secondAcquisition).toBe(firstAcquisition);
    const facades = await firstAcquisition;
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    expect(bootstrapPromise).not.toBeNull();
    if (!bootstrapPromise)
      throw new Error("Expected desktop acquisition to start the app runtime.");
    const bootstrap = await bootstrapPromise;

    expect(await secondAcquisition).toBe(facades);
    expect(Object.keys(facades).toSorted()).toEqual([
      "appActions",
      "modelMetadata",
      "rendererState",
      "rendererStateCommands",
      "runtimeActions",
      "runtimeCommands",
      "runtimeEvents",
    ]);
    expect(Object.keys(facades.runtimeActions).toSorted()).toEqual([
      "approvals",
      "extensions",
      "generatedContext",
      "messages",
      "queues",
      "requestInput",
      "sourceEdits",
      "sourceInvalidation",
      "surfaces",
      "workspaces",
    ]);
    expect(Object.keys(facades.appActions).toSorted()).toEqual([
      "artifacts",
      "externalInstructions",
      "git",
      "telemetry",
      "workspaceFiles",
      "workspaces",
    ]);
    expect(Object.keys(facades.appActions.workspaces)).toEqual([
      "acquireByCwd",
      "acquireDefault",
      "releaseVisual",
    ]);
    expect(Object.keys(facades.appActions.git)).toEqual(["listBranches", "switchBranch"]);
    expect(Object.keys(facades.appActions.artifacts)).toEqual(["preview"]);
    expect(Object.keys(facades.appActions.workspaceFiles)).toEqual([
      "getRoot",
      "listPaths",
      "materializeSelectedAttachments",
      "importComposerAttachments",
      "resolvePathTarget",
    ]);
    expect(Object.keys(facades.appActions.externalInstructions)).toEqual([
      "resolveEditorTarget",
      "recordEditorResult",
    ]);
    expect(Object.keys(facades.appActions.telemetry)).toEqual(["recordRenderer"]);
    expect("events" in facades.runtimeActions).toBeFalse();
    expect("commands" in facades.runtimeActions).toBeFalse();
    expect("close" in facades.runtimeActions).toBeFalse();
    expect(Object.keys(facades.modelMetadata)).toEqual(["list"]);
    expect("facade" in facades).toBeFalse();
    expect("readiness" in facades).toBeFalse();
    expect("internal" in facades).toBeFalse();
    expect("dispose" in facades).toBeFalse();
    expect(facades.runtimeCommands).toBe(bootstrap.facade.commands);
    expect(facades.rendererState).toBe(bootstrap.rendererState);
    expect(facades.rendererStateCommands).toBe(bootstrap.rendererStateCommands);
    expect(facades.runtimeEvents).toBe(bootstrap.facade.events);
    expect(registry["appRuntimeBootstrap"]).toBe(bootstrapPromise);
  });

  it("does not acquire external owners without a registered workspace host", async () => {
    const cwd = tempWorkspace("desktop-facade-unregistered-workspace");
    const registry = createRegistry(cwd);
    const facades = await registry.acquireDesktopAppFacades();

    await expect(
      facades.runtimeActions.workspaces.acquire({
        cwd: cwd as AbsolutePath,
        owner: {
          kind: "headless",
          ownerId: "headless:unregistered-workspace" as RuntimeOwnerId,
        },
        openReason: "headless",
      }),
    ).rejects.toMatchObject({
      operation: "runtime.workspaces.acquire",
      reason: "target-not-found",
    });
    expect(registry["externalWorkspaceOwners"].size).toBe(0);
  });

  it("exposes renderer-safe visual workspace lifecycle actions without registry records", async () => {
    const cwd = tempWorkspace("desktop-app-actions-workspace-lifecycle");
    const registry = createRegistry(cwd);
    const facades = await registry.acquireDesktopAppFacades();

    const acquired = await facades.appActions.workspaces.acquireByCwd({ cwd });

    expect(typeof acquired.workspaceId).toBe("string");
    expect(acquired).toEqual({
      workspaceId: acquired.workspaceId,
      cwd: realpathSync.native(cwd),
      workspaceLabel: basename(realpathSync.native(cwd)),
      kind: "user",
    });
    expect(Object.keys(acquired).toSorted()).toEqual([
      "cwd",
      "kind",
      "workspaceId",
      "workspaceLabel",
    ]);
    expect("catalog" in acquired).toBeFalse();
    expect("dispose" in acquired).toBeFalse();
    expect(registry.getRuntime(acquired.workspaceId).cwd).toBe(acquired.cwd);

    await expect(
      facades.appActions.workspaces.releaseVisual({ workspaceId: acquired.workspaceId }),
    ).resolves.toEqual({ released: true });
    expect(registry.listOpenWorkspaces()).toEqual([]);
    await expect(
      facades.appActions.workspaces.releaseVisual({ workspaceId: acquired.workspaceId }),
    ).resolves.toEqual({ released: false });
  });

  it("acquires the default visual workspace through the desktop app-action facade", async () => {
    const appDataDir = tempWorkspace("desktop-app-actions-default-data");
    const registry = createRegistry(
      tempWorkspace("desktop-app-actions-default-initial"),
      undefined,
      {
        appDataDir,
      },
    );
    const facades = await registry.acquireDesktopAppFacades();

    const acquired = await facades.appActions.workspaces.acquireDefault();

    expect(typeof acquired.workspaceId).toBe("string");
    expect(acquired).toMatchObject({
      workspaceId: acquired.workspaceId,
      cwd: getDefaultWorkspaceCwd(appDataDir),
      kind: "default",
    });
    expect(registry.listOpenWorkspaces()).toContainEqual(acquired);
    expect(registry.getRuntime(acquired.workspaceId).workspaceId).toBe(acquired.workspaceId);
    await expect(
      facades.appActions.workspaces.releaseVisual({ workspaceId: acquired.workspaceId }),
    ).resolves.toEqual({ released: true });
  });

  it("lists and switches workspace branches through renderer-safe app actions", async () => {
    const cwd = tempWorkspace("desktop-app-actions-git");
    runGit(cwd, ["init", "-b", "main"]);
    writeFileSync(join(cwd, "tracked.txt"), "main\n");
    runGit(cwd, ["add", "tracked.txt"]);
    runGit(cwd, [
      "-c",
      "user.name=Svvy Test",
      "-c",
      "user.email=svvy@example.test",
      "commit",
      "-m",
      "initial",
    ]);
    runGit(cwd, ["branch", "feature/app-actions"]);

    const registry = createRegistry(cwd);
    const facades = await registry.acquireDesktopAppFacades();
    const workspace = await facades.appActions.workspaces.acquireByCwd({ cwd });
    const runtime = registry.getRuntime(workspace.workspaceId);
    let pathIndexRefreshes = 0;
    const refreshPathIndex = runtime.pathIndex.refresh.bind(runtime.pathIndex);
    runtime.pathIndex.refresh = () => {
      pathIndexRefreshes += 1;
      return refreshPathIndex();
    };

    await expect(
      facades.appActions.git.listBranches({ workspaceId: workspace.workspaceId }),
    ).resolves.toEqual({
      currentBranch: "main",
      branches: [
        { name: "feature/app-actions", current: false },
        { name: "main", current: true },
      ],
    });
    await expect(
      facades.appActions.git.switchBranch({
        workspaceId: workspace.workspaceId,
        branch: "missing",
      }),
    ).resolves.toMatchObject({
      ok: false,
      workspace: { workspaceId: workspace.workspaceId, branch: "main" },
      error: "Branch is not available in this workspace.",
    });
    expect(pathIndexRefreshes).toBe(0);

    await expect(
      facades.appActions.git.switchBranch({
        workspaceId: workspace.workspaceId,
        branch: " feature/app-actions ",
      }),
    ).resolves.toMatchObject({
      ok: true,
      switched: true,
      workspace: { workspaceId: workspace.workspaceId, branch: "feature/app-actions" },
    });
    expect(pathIndexRefreshes).toBe(1);
    expect(runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()).toBe(
      "feature/app-actions",
    );
    await expect(
      facades.appActions.git.switchBranch({
        workspaceId: workspace.workspaceId,
        branch: "feature/app-actions",
      }),
    ).resolves.toMatchObject({ ok: true, switched: false });
    expect(pathIndexRefreshes).toBe(1);
  });

  it("routes workspace file actions through the requested workspace host", async () => {
    const firstCwd = tempWorkspace("desktop-app-actions-files-first");
    const secondCwd = tempWorkspace("desktop-app-actions-files-second");
    writeFileSync(join(firstCwd, "first.txt"), "first");
    writeFileSync(join(secondCwd, "second.txt"), "second");
    const registry = createRegistry(firstCwd);
    const facades = await registry.acquireDesktopAppFacades();
    const first = await facades.appActions.workspaces.acquireByCwd({ cwd: firstCwd });
    const second = await facades.appActions.workspaces.acquireByCwd({ cwd: secondCwd });

    const firstPaths = await facades.appActions.workspaceFiles.listPaths({
      workspaceId: first.workspaceId,
      refresh: true,
    });
    const secondPaths = await facades.appActions.workspaceFiles.listPaths({
      workspaceId: second.workspaceId,
      refresh: true,
    });
    expect(firstPaths).toContainEqual({ kind: "file", workspaceRelativePath: "first.txt" });
    expect(firstPaths).not.toContainEqual({ kind: "file", workspaceRelativePath: "second.txt" });
    expect(secondPaths).toContainEqual({ kind: "file", workspaceRelativePath: "second.txt" });

    const imported = await facades.appActions.workspaceFiles.importComposerAttachments({
      workspaceId: second.workspaceId,
      attachments: [{ name: "note.txt", dataBase64: Buffer.from("note").toString("base64") }],
    });
    expect(imported.skippedPaths).toEqual([]);
    expect(imported.attachments[0]?.workspaceRelativePath).toStartWith(
      ".svvy/attachments/user-input/",
    );
    expect(
      existsSync(join(secondCwd, imported.attachments[0]?.workspaceRelativePath ?? "")),
    ).toBeTrue();
    expect(
      existsSync(join(firstCwd, imported.attachments[0]?.workspaceRelativePath ?? "")),
    ).toBeFalse();
  });

  it("does not open the initial cwd unless startup opening is requested", async () => {
    const cwd = tempWorkspace("no-startup-open");
    const registry = createRegistry(cwd);

    expect(registry.listOpenWorkspaces()).toEqual([]);
    expect(registry.getRuntimeOrNull("workspace-restored-but-not-acquired")).toBeNull();
    expect(registry.getActiveWorkspaceId()).toBeNull();
  });

  it("opens the initial cwd when startup opening is requested", async () => {
    const cwd = tempWorkspace("startup-open");
    const registry = createRegistry(cwd, tempAgentDir(), {
      openInitialWorkspace: true,
    });
    await registry.ready();

    const [workspace] = registry.listOpenWorkspaces();

    expect(workspace).toBeDefined();
    if (!workspace) throw new Error("Expected startup workspace to open.");

    expect(workspace?.cwd).toBe(realpathSync.native(cwd));
    expect(registry.getActiveWorkspaceId()).toBe(workspace.workspaceId);
    const chrome = await (
      await registry.getRendererStateFacade()
    ).readModels.fetch({
      kind: "workspaceChrome",
    });
    expect(chrome).toMatchObject({
      kind: "workspaceChrome",
      value: {
        tabs: [
          {
            workspaceId: workspace.workspaceId,
            cwd: realpathSync.native(cwd),
            workspaceLabel: basename(cwd),
            kind: "user",
            activeLayoutId: "A",
          },
        ],
      },
    });
  });

  it("reaches app-runtime readiness before opening the initial workspace", async () => {
    const events: string[] = [];
    const registry = createRegistry(
      tempWorkspace("readiness-before-startup-open"),
      tempAgentDir(),
      { openInitialWorkspace: true },
    );
    const createAppRuntimeBootstrap = registry["createAppRuntimeBootstrap"].bind(registry);
    registry["createAppRuntimeBootstrap"] = async () => {
      events.push("runtime-readiness:start");
      const bootstrap = await createAppRuntimeBootstrap();
      events.push("runtime-readiness:complete");
      return bootstrap;
    };
    const acquireWorkspace = registry.acquireWorkspace.bind(registry);
    registry.acquireWorkspace = async (...args) => {
      events.push("workspace-open:start");
      const workspace = await acquireWorkspace(...args);
      events.push("workspace-open:complete");
      return workspace;
    };

    await registry.ready();

    expect(events).toEqual([
      "runtime-readiness:start",
      "runtime-readiness:complete",
      "workspace-open:start",
      "workspace-open:complete",
    ]);
  });

  it("does not expose an opening workspace host to external owner acquisition", async () => {
    const cwd = tempWorkspace("opening-workspace-external-owner");
    const registry = createRegistry(cwd);
    const facades = await registry.acquireDesktopAppFacades();
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected the app runtime bootstrap to exist.");
    const bootstrap = await bootstrapPromise;
    const refreshGeneratedPackages =
      bootstrap.internal.sourceInvalidation.refreshGeneratedPackages.bind(
        bootstrap.internal.sourceInvalidation,
      );
    let signalOpeningHost!: () => void;
    const openingHostReady = new Promise<void>((resolve) => {
      signalOpeningHost = resolve;
    });
    let allowWorkspaceStartup!: () => void;
    const workspaceStartupGate = new Promise<void>((resolve) => {
      allowWorkspaceStartup = resolve;
    });
    Reflect.set(
      bootstrap.internal.sourceInvalidation,
      "refreshGeneratedPackages",
      async (input: Parameters<typeof refreshGeneratedPackages>[0]) => {
        if (input.scope === "workspace-link-repair") {
          signalOpeningHost();
          await workspaceStartupGate;
        }
        return refreshGeneratedPackages(input);
      },
    );

    const opening = registry.acquireWorkspace(cwd);
    await openingHostReady;
    expect(registry["openingRuntimes"].size).toBeGreaterThan(0);
    await expect(
      facades.runtimeActions.workspaces.acquire({
        cwd: cwd as AbsolutePath,
        owner: {
          kind: "headless",
          ownerId: "headless:opening-workspace" as RuntimeOwnerId,
        },
        openReason: "headless",
      }),
    ).rejects.toMatchObject({ reason: "target-not-found" });
    expect(registry["externalWorkspaceOwners"].size).toBe(0);

    allowWorkspaceStartup();
    await opening;
  });

  it("applies the mandatory workspace source reconcile before acquisition becomes ready", async () => {
    const cwd = tempWorkspace("workspace-startup-source-reconcile");
    writeFileSync(join(cwd, "AGENTS.md"), "# Workspace instructions\n");
    const bridgeWarnings: string[] = [];
    const registry = createRegistry(cwd, tempAgentDir(), {
      forwardBridgeLog: (level, message, source) => {
        if (level === "warn") bridgeWarnings.push(`${source}:${message}`);
      },
    });

    const runtime = await registry.acquireWorkspace(cwd);

    expect(bridgeWarnings).not.toContain(
      "source.graph:Runtime source invalidation reaction failed.",
    );
    expect(
      runtime.appLogs
        .query({ sources: ["source.graph"] })
        .entries.some(
          (entry) =>
            entry.message === "Source inputs changed." &&
            Array.isArray(entry.details?.domains) &&
            entry.details.domains.includes("external_instructions"),
        ),
    ).toBeTrue();
  });

  it("rejects workspace readiness and records a durable diagnostic when startup source reaction fails", async () => {
    const cwd = tempWorkspace("workspace-startup-source-reaction-failure");
    const agentDir = tempAgentDir();
    writeFileSync(join(cwd, "AGENTS.md"), "# Workspace instructions\n");
    const registry = createRegistry(cwd, agentDir);
    await registry.ready();
    const handleSourceInvalidationEvent = registry["handleSourceInvalidationEvent"].bind(registry);
    const failure = new Error("startup source reaction failed");
    registry["handleSourceInvalidationEvent"] = async (input) => {
      if (input.scope.kind === "workspace") {
        throw failure;
      }
      return handleSourceInvalidationEvent(input);
    };
    const baselineAppLogFacades = registry["sharedAppLogFacades"].size;

    await expect(registry.acquireWorkspace(cwd)).rejects.toThrow(failure.message);

    expect(registry.listOpenWorkspaces()).toEqual([]);
    expect(registry["openingRuntimes"].size).toBe(0);
    expect(registry["pendingRuntimes"].size).toBe(0);
    expect(registry["sharedAppLogFacades"].size).toBe(baselineAppLogFacades);
    const database = new Database(
      join(getSvvySessionDir(realpathSync.native(cwd), agentDir), STRUCTURED_SESSION_DB_FILENAME),
      { readonly: true },
    );
    try {
      const diagnostics = database
        .query(
          `SELECT domain, diagnostics_json, last_observation_kind
           FROM runtime_source_scan_fact
           WHERE scope_kind = 'workspace'
           ORDER BY domain ASC`,
        )
        .all() as Array<{
        domain: string;
        diagnostics_json: string;
        last_observation_kind: string;
      }>;
      expect(
        diagnostics.some(
          (record) =>
            record.last_observation_kind === "diagnostic" &&
            (JSON.parse(record.diagnostics_json) as Array<{ code?: string }>).some(
              (diagnostic) => diagnostic.code === "RUNTIME_SOURCE_REACTION_FAILED",
            ),
        ),
      ).toBeTrue();
    } finally {
      database.close();
    }
  });

  it("acquires the same cwd as one shared workspace scope for duplicate workspace tabs", async () => {
    const cwd = tempWorkspace("duplicate-cwd");
    const registry = createRegistry(cwd);

    const first = await registry.acquireWorkspace(cwd);
    const second = await registry.acquireWorkspace(join(cwd, "."));

    expect(first.cwd).toBe(realpathSync.native(cwd));
    expect(second.cwd).toBe(first.cwd);
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(registry.listOpenWorkspaces().map((workspace) => workspace.workspaceId)).toEqual([
      first.workspaceId,
    ]);
  });

  it("does not use a visual tab id as the workspace scope identity", async () => {
    const cwd = tempWorkspace("persisted-tab-id");
    const registry = createRegistry(cwd);

    const restored = await registry.acquireWorkspace(cwd);

    expect(restored.workspaceId).toStartWith("workspace:");
    expect(restored.workspaceId).not.toContain("saved-tab");
    expect(restored.workspaceId).not.toContain(realpathSync.native(cwd));
    expect(registry.getRuntime(restored.workspaceId).cwd).toBe(realpathSync.native(cwd));
  });

  it("repairs generated Workflows package links through workspace recovery", async () => {
    const cwd = tempWorkspace("smithers-link-open");
    const generatedPackagePath = tempWorkspace("generated-workflows-package");
    const extensionsGeneratedPackagePath = tempWorkspace("generated-extensions-package");
    mkdirSync(join(cwd, ".smithers"), { recursive: true });
    const registry = createRegistry(cwd, tempAgentDir(), {
      workflowsExtensionsGeneratedPackagePath: extensionsGeneratedPackagePath,
      workflowsGeneratedPackagePath: generatedPackagePath,
    });

    await registry.acquireWorkspace(cwd);

    const workflowsLinkPath = join(cwd, ".smithers", "node_modules", "@svvyx", "workflows");
    const extensionsLinkPath = join(cwd, ".smithers", "node_modules", "@svvyx", "extensions");
    await waitFor(() => existsSync(workflowsLinkPath) && existsSync(extensionsLinkPath));

    expect(lstatSync(workflowsLinkPath).isSymbolicLink()).toBe(true);
    expect(lstatSync(extensionsLinkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(workflowsLinkPath)).toBe(generatedPackagePath);
    expect(readlinkSync(extensionsLinkPath)).toBe(extensionsGeneratedPackagePath);

    const runtime = registry.getActiveRuntime();
    await waitFor(() =>
      runtime.appLogs
        .query({ sources: ["workflow.library"] })
        .entries.some(
          (entry) => entry.message === "Workflows build/link recovery refreshed package links.",
        ),
    );
  });

  it("lists open workspace scopes without manufacturing visual workspace tab ids", async () => {
    const cwd = tempWorkspace("runtime-list-not-tabs");
    const registry = createRegistry(cwd);

    const runtime = await registry.acquireWorkspace(cwd);
    const [workspace] = registry.listOpenWorkspaces();
    if (!workspace) throw new Error("Expected an open workspace scope.");

    expect(workspace).toMatchObject({
      workspaceId: runtime.workspaceId,
      cwd: runtime.cwd,
      kind: "user",
    });
    expect(Object.hasOwn(workspace, "workspaceTabId")).toBeFalse();
    expect(Object.hasOwn(workspace, "openedAt")).toBeFalse();
  });

  it("uses different stable workspace scope ids for different canonical cwds", async () => {
    const cwd = tempWorkspace("runtime-id");
    const otherCwd = tempWorkspace("other-runtime-id");
    const registry = createRegistry(cwd);

    const restored = await registry.acquireWorkspace(cwd);
    const other = await registry.acquireWorkspace(otherCwd);

    expect(restored.workspaceId).toStartWith("workspace:");
    expect(other.workspaceId).toStartWith("workspace:");
    expect(restored.workspaceId).not.toBe(other.workspaceId);
  });

  it("shares the durable session catalog across duplicate tabs for the same cwd", async () => {
    const cwd = tempWorkspace("shared-session-cwd");
    const agentDir = tempAgentDir();
    const registry = createRegistry(cwd, agentDir);

    const first = await registry.acquireWorkspace(cwd);
    const created = await first.catalog.createSession(
      { title: "Persistent Session" },
      { provider: "openai", model: "gpt-4o", thinkingLevel: "medium" },
    );
    const state = await registry.getRendererStateFacade();
    const firstListed = await state.readModels.fetch({
      kind: "sessionNavigation",
      workspaceId: first.workspaceId as WorkspaceId,
    });

    const second = await registry.acquireWorkspace(join(cwd, "."));
    const listed = await state.readModels.fetch({
      kind: "sessionNavigation",
      workspaceId: second.workspaceId as WorkspaceId,
    });

    expect(second.workspaceId).toBe(first.workspaceId);
    expect(firstListed.kind).toBe("sessionNavigation");
    expect(listed.kind).toBe("sessionNavigation");
    if (firstListed.kind !== "sessionNavigation" || listed.kind !== "sessionNavigation") {
      throw new Error("Expected session navigation read models.");
    }
    expect(firstListed.value.activeSessions.map((session) => session.id)).toContain(
      created.target.workspaceSessionId,
    );
    expect(listed.value.activeSessions.map((session) => session.id)).toContain(
      created.target.workspaceSessionId,
    );
  });

  it("uses app-global state profiles for newly created orchestrator and handler bindings", async () => {
    const cwd = tempWorkspace("state-profile-surface-bindings");
    const registry = createRegistry(cwd);
    const runtime = await registry.acquireWorkspace(cwd);
    const commands = await registry.getStateCommandsFacade();

    await commands.agentProfiles.updateOrchestrator({
      profile: {
        profileId: "state-orchestrator" as never,
        name: "State orchestrator",
        providerId: "openai" as never,
        modelId: "gpt-4o" as never,
        reasoning: { effort: "high" },
        extensionUsage: { github: "loaded" } as never,
        extensionOrder: ["github"] as never,
        followComposer: false,
      },
    });
    await commands.agentProfiles.updateThreadHandler({
      profile: {
        profileId: "thread-handler" as never,
        name: "State handler",
        providerId: "openai" as never,
        modelId: "gpt-4.1-mini" as never,
        reasoning: { effort: "low" },
        extensionUsage: { github: "available" } as never,
        extensionOrder: ["github"] as never,
      },
    });

    const created = await runtime.catalog.createSession(
      { title: "State profile", agentProfileId: "state-orchestrator" },
      { provider: "zai", model: "glm-5-turbo", thinkingLevel: "off" },
    );
    expect(created).toEqual({ target: created.target });

    const store = workspaceStateStore(runtime);
    const createdState = store.getSessionState(created.target.workspaceSessionId);
    expect(createdState.pi).toMatchObject({
      orchestratorAgentProfileId: "state-orchestrator",
      provider: "openai",
      model: "gpt-4o",
      reasoningEffort: "high",
      loadedExtensionIds: expect.arrayContaining(["github"]),
    });

    const turn = store.startTurn({
      sessionId: created.target.workspaceSessionId,
      surfacePiSessionId: created.target.surfacePiSessionId,
      requestSummary: "Create state-backed handler",
    });
    const parentThread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: created.target.surfacePiSessionId,
      title: "State-backed handler parent",
      objective: "Create a handler from the configured state profile.",
    });
    const handler = await (
      runtime.catalog as unknown as {
        createHandlerThread(input: {
          sessionId: string;
          turnId: string;
          parentThreadId: string;
          parentSurfacePiSessionId: string;
          threadGroupId: null;
          objective: string;
          historyMode: "isolated";
          overrides: null;
          loadedByCommandId: string;
          autoStart: false;
        }): Promise<{
          agentProfileJson: string;
          availableExtensionIds: string[];
        }>;
      }
    ).createHandlerThread({
      sessionId: created.target.workspaceSessionId,
      turnId: turn.id,
      parentThreadId: parentThread.id,
      parentSurfacePiSessionId: created.target.surfacePiSessionId,
      threadGroupId: null,
      objective: "Use the committed handler profile.",
      historyMode: "isolated",
      overrides: null,
      loadedByCommandId: "command-state-handler",
      autoStart: false,
    });

    expect(JSON.parse(handler.agentProfileJson)).toMatchObject({
      id: "thread-handler",
      name: "State handler",
      provider: "openai",
      model: "gpt-4.1-mini",
      reasoningEffort: "low",
    });
    expect(handler.availableExtensionIds).toContain("github");
  });

  it("persists Follow composer model, reasoning, and extension changes through state commands", async () => {
    const cwd = tempWorkspace("state-profile-follow-composer");
    const registry = createRegistry(cwd);
    const runtime = await registry.acquireWorkspace(cwd);
    const commands = await registry.getStateCommandsFacade();

    await commands.agentProfiles.updateOrchestrator({
      profile: {
        profileId: "default-orchestrator" as never,
        name: "Default orchestrator",
        providerId: "openai" as never,
        modelId: "gpt-4o" as never,
        reasoning: { effort: "medium" },
        extensionUsage: {},
        extensionOrder: [],
        followComposer: true,
      },
    });
    const created = await runtime.catalog.createSession(
      { title: "Follow composer", agentProfileId: "default-orchestrator" },
      { provider: "zai", model: "glm-5-turbo", thinkingLevel: "off" },
    );
    const runtimeFacade = await registry.getAppRuntimeOperations(runtime.workspaceId);

    await runtimeFacade.surfaces.updateModel({
      workspaceId: runtime.workspaceId as never,
      target: created.target as never,
      provider: "openai",
      model: "gpt-5.4",
    });
    await runtimeFacade.surfaces.updateReasoning({
      workspaceId: runtime.workspaceId as never,
      target: created.target as never,
      reasoningEffort: "high",
    });
    await runtimeFacade.surfaces.updateExtensionUsage({
      workspaceId: runtime.workspaceId as never,
      target: created.target as never,
      extensionId: "smithers" as never,
      usage: "loaded",
    });

    const state = await registry.getRendererStateFacade();
    const result = await state.readModels.fetch({ kind: "agents" });
    expect(result.kind).toBe("agents");
    if (result.kind !== "agents") throw new Error("Expected agents read model.");
    expect(
      result.value.configuredProfiles.find(
        (profile) => profile.profileId === "default-orchestrator",
      ),
    ).toMatchObject({
      modelId: "gpt-5.4",
      reasoning: { effort: "high" },
      followComposer: true,
      extensionUsage: { smithers: "loaded" },
    });
  });

  it("shares app logs and read models across duplicate tabs for the same cwd", async () => {
    const cwd = tempWorkspace("shared-app-logs");
    const registry = createRegistry(cwd);
    const first = await registry.acquireWorkspace(cwd);
    const second = await registry.acquireWorkspace(join(cwd, "."));

    expect(
      first.appLogs
        .query({ sources: ["app.lifecycle"] })
        .entries.filter((entry) => entry.message === "Workspace scope opened."),
    ).toMatchObject([
      {
        seq: 1,
        source: "app.lifecycle",
        message: "Workspace scope opened.",
        details: {
          workspaceId: first.workspaceId,
          kind: "user",
          cwd: first.cwd,
        },
      },
    ]);

    first.appLog.info("workspace", "First tab wrote a workspace log.", {
      workspaceSessionId: "session-1",
    });

    expect(second.appLogs.query({ sources: ["workspace"] }).entries).toMatchObject([
      {
        source: "workspace",
        message: "First tab wrote a workspace log.",
      },
    ]);

    second.appLog.warning("workspace", "Second tab wrote another workspace log.");

    expect(
      first.appLogs.query({ sources: ["workspace"] }).entries.map((entry) => entry.message),
    ).toEqual(["First tab wrote a workspace log.", "Second tab wrote another workspace log."]);
    expect(first.appLogs.summary()).toEqual(second.appLogs.summary());
    const latestSeq = first.appLogs.summary().latestSeq;
    expect(second.appLogs.markSeen(latestSeq).seenSeq).toBe(latestSeq);
    expect(first.appLogs.summary().seenSeq).toBe(latestSeq);
  });

  it("keeps cwd-scoped app logs shared without a renderer push callback", async () => {
    const cwd = tempWorkspace("shared-app-log-updates");
    const registry = createRegistry(cwd, tempAgentDir());
    const first = await registry.acquireWorkspace(cwd);
    const second = await registry.acquireWorkspace(join(cwd, "."));
    const subscription = await registry.getRuntimeEventSubscription(first.workspaceId, {
      includeAppEvents: false,
    });
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

    try {
      first.appLog.error("workspace", "Shared runtime log.");

      expect(second.workspaceId).toBe(first.workspaceId);
      expect(
        second.appLogs.query({ sources: ["workspace"] }).entries.map((entry) => entry.message),
      ).toContain("Shared runtime log.");
      const event = await eventReader;
      expect(event.workspaceId).toBe(first.workspaceId as WorkspaceId);
      const rendererState = await registry.getRendererStateFacade();
      const refetched = await rendererState.readModels.refetchInvalidation({
        descriptor: {
          scope: "workspace",
          workspaceId: first.workspaceId as WorkspaceId,
          invalidation: event.invalidation,
        },
      });
      expect(refetched.map((readModel) => readModel.kind)).toEqual(["appLogs", "appLogSummary"]);
    } finally {
      await subscription.close();
    }
  });

  it("persists workspace app logs across runtime release and reacquire", async () => {
    const cwd = tempWorkspace("persisted-app-logs");
    const registry = createRegistry(cwd, tempAgentDir());
    const first = await registry.acquireWorkspace(cwd);
    const workspaceId = first.workspaceId;

    first.appLog.info("workspace", "Persisted app log.");
    const latestSeq = first.appLogs.summary().latestSeq;

    expect(await registry.releaseWorkspace(workspaceId)).toBeTrue();
    expect(registry.listOpenWorkspaces()).toEqual([]);

    const reacquired = await registry.acquireWorkspace(cwd);

    expect(reacquired.workspaceId).toBe(workspaceId);
    expect(reacquired.appLogs.summary().latestSeq).toBeGreaterThanOrEqual(latestSeq);
    expect(
      reacquired.appLogs.query({ sources: ["workspace"] }).entries.map((entry) => entry.message),
    ).toContain("Persisted app log.");
  });

  it("does not expose product-state invalidation as a public source invalidation method", async () => {
    const cwd = tempWorkspace("runtime-product-state-event");
    const registry = createRegistry(cwd);
    const runtime = await registry.acquireWorkspace(cwd);
    const runtimeOperations = getWorkspaceRuntimeOperationsForRequest(registry, {
      workspaceId: runtime.workspaceId,
    });

    expect(Reflect.has(runtimeOperations.sourceInvalidation, "productStateChanged")).toBeFalse();
  });

  it("refreshes generated @svvyx/extensions through the runtime facade package refresh", async () => {
    const cwd = tempWorkspace("runtime-generated-extensions-refresh");
    const generatedExtensionsPackagePath = join(
      tempWorkspace("generated-extensions-refresh-package-parent"),
      "package",
    );
    const registry = createRegistry(cwd, tempAgentDir(), {
      workflowsExtensionsGeneratedPackagePath: generatedExtensionsPackagePath,
    });
    await registry.ready();
    const runtime = await registry.acquireWorkspace(cwd);
    const runtimeOperations = getWorkspaceRuntimeOperationsForRequest(registry, {
      workspaceId: runtime.workspaceId,
    });
    await expect(
      runtimeOperations.sourceInvalidation.refreshGeneratedPackages({
        scope: "app-global",
        packages: ["@svvyx/extensions"],
        reason: "explicit-build",
        sourceCommandId: "cmd_generated_extensions_refresh_01" as CommandId,
        recoveryWorkId: "recovery_generated_extensions_refresh_01" as RecoveryWorkId,
      }),
    ).resolves.toMatchObject({
      scope: "app-global",
      packages: [{ packageName: "@svvyx/extensions", action: "written" }],
      workspaceLinks: [],
      recoveryWorkIds: [],
    });

    const packageJson = readFileSync(join(generatedExtensionsPackagePath, "package.json"), "utf8");
    expect(JSON.parse(packageJson)).toMatchObject({
      name: "@svvyx/extensions",
      type: "module",
    });
    const index = readFileSync(join(generatedExtensionsPackagePath, "index.ts"), "utf8");
    expect(index).toContain("export const Extensions = {");
    expect(index).toContain('"artifacts": {"id":"artifacts"');
    expect(index).not.toContain("createExtensionsFacade");
    expect(packageJson).not.toContain("cmd_generated_extensions_refresh_01");
    expect(packageJson).not.toContain("recovery_generated_extensions_refresh_01");
    expect(index).not.toContain("cmd_generated_extensions_refresh_01");
    expect(index).not.toContain("recovery_generated_extensions_refresh_01");
  });

  it("records repair-needed rows and recovery work for recoverable unopened workspaces", async () => {
    const ownerCwd = tempWorkspace("runtime-generated-owner-refresh");
    const unopenedCwd = tempWorkspace("runtime-generated-unopened-repair");
    const agentDir = tempAgentDir("generated-unopened-agent-root");
    const generatedExtensionsPackagePath = join(
      tempWorkspace("generated-unopened-extensions-package-parent"),
      "package",
    );
    const unopenedInfo: ReturnType<WorkspaceRuntimeRegistry["listOpenWorkspaces"]>[number] = {
      workspaceId: "workspace_generated_unopened_repair" as WorkspaceId,
      workspaceLabel: "Unopened Workspace",
      cwd: realpathSync.native(unopenedCwd),
      kind: "user",
    };
    const registry = createRegistry(ownerCwd, agentDir, {
      workflowsExtensionsGeneratedPackagePath: generatedExtensionsPackagePath,
    });
    await registry.ready();
    const ownerRuntime = await registry.acquireWorkspace(ownerCwd);
    await (
      await registry.getStateCommandsFacade()
    ).workspaceChrome.setTabs({
      activeWorkspaceTabId: "tab_generated_unopened_repair" as never,
      tabs: [
        {
          workspaceTabId: "tab_generated_unopened_repair" as never,
          workspaceId: unopenedInfo.workspaceId as WorkspaceId,
          cwd: unopenedInfo.cwd as AbsolutePath,
          workspaceLabel: unopenedInfo.workspaceLabel,
          kind: unopenedInfo.kind,
          openedAt: "2026-07-11T00:00:00.000Z" as never,
          activeLayoutId: "A",
        },
      ],
      knownWorkspaces: [],
    });
    const runtimeOperations = getWorkspaceRuntimeOperationsForRequest(registry, {
      workspaceId: ownerRuntime.workspaceId,
    });

    const result = await runtimeOperations.sourceInvalidation.refreshGeneratedPackages({
      scope: "app-global",
      packages: ["@svvyx/extensions"],
      reason: "explicit-build",
      sourceCommandId: "cmd_generated_unopened_repair_01" as CommandId,
    });

    expect(result).toMatchObject({
      scope: "app-global",
      packages: [{ packageName: "@svvyx/extensions", action: "written" }],
      workspaceLinks: [],
    });
    expect(result.recoveryWorkIds).toHaveLength(1);

    const unopenedStore = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: unopenedInfo.workspaceId,
        label: unopenedInfo.workspaceLabel,
        cwd: unopenedInfo.cwd,
        artifactDir: join(unopenedInfo.cwd, "artifacts"),
      },
      databasePath: join(
        getSvvySessionDir(unopenedInfo.cwd, agentDir),
        STRUCTURED_SESSION_DB_FILENAME,
      ),
    });
    try {
      expect(
        unopenedStore
          .readLinksNeedingRepair({ packages: ["@svvyx/extensions"] })
          .find((link) => link.lastRecoveryWorkId === result.recoveryWorkIds[0]),
      ).toMatchObject({
        workspaceId: unopenedInfo.workspaceId,
        packageName: "@svvyx/extensions",
        status: "repair-needed",
        sourceCommandId: "cmd_generated_unopened_repair_01",
        lastRecoveryWorkId: result.recoveryWorkIds[0],
      });
      expect(
        unopenedStore.listRecoveryWork().find((work) => work.id === result.recoveryWorkIds[0]),
      ).toMatchObject({
        id: result.recoveryWorkIds[0],
        scope: { kind: "workspace", workspaceId: unopenedInfo.workspaceId },
        kind: "workspace_generated_package_link_repair",
        status: "pending",
        payloadJson: {
          refreshGeneratedPackages: {
            scope: "workspace-link-repair",
            workspaceId: unopenedInfo.workspaceId,
            packages: ["@svvyx/extensions"],
            reason: "link-repair",
            sourceCommandId: "cmd_generated_unopened_repair_01",
            scheduledReason: "app-global-generated-package-refreshed",
          },
        },
      });
    } finally {
      unopenedStore.close();
    }
  });

  it("reads recoverable workspace ids without self-awaiting app-global host acquisition", async () => {
    const cwd = tempWorkspace("runtime-recoverable-bootstrap-owner");
    const unopenedCwd = realpathSync.native(
      tempWorkspace("runtime-recoverable-bootstrap-unopened"),
    );
    const registry = createRegistry(cwd);
    const owner = await registry.acquireWorkspace(cwd);
    const appGlobal = await registry["getAppGlobalHostRecord"]();
    appGlobal.catalog.workspaceStateRouterRegistration().store.setWorkspaceTabs({
      activeWorkspaceTabId: "tab_recoverable_bootstrap" as never,
      tabs: [
        {
          workspaceTabId: "tab_recoverable_bootstrap" as never,
          workspaceId: "workspace_recoverable_bootstrap" as WorkspaceId,
          cwd: unopenedCwd as AbsolutePath,
          workspaceLabel: "Recoverable bootstrap workspace",
          kind: "user",
          openedAt: "2026-07-11T00:00:00.000Z" as never,
          activeLayoutId: "A",
        },
      ],
      knownWorkspaces: [
        {
          workspaceTabId: "known_recoverable_bootstrap" as never,
          workspaceId: "workspace_recoverable_bootstrap" as WorkspaceId,
          cwd: unopenedCwd as AbsolutePath,
          workspaceLabel: "Recoverable bootstrap workspace",
          kind: "user",
          openedAt: "2026-07-11T00:00:00.000Z" as never,
          activeLayoutId: "B",
        },
      ],
    });
    const boundary = registry["createGeneratedPackageRefreshBoundaryHost"](appGlobal.catalog, {
      workspaceId: owner.workspaceId,
      cwd: owner.cwd,
    });
    const originalAppGlobalHost = registry["appGlobalHost"];
    registry["appGlobalHost"] = new Promise(() => {});
    try {
      await expect(Effect.runPromise(boundary.listRecoverableWorkspaceIds())).resolves.toEqual([
        "workspace_recoverable_bootstrap" as WorkspaceId,
      ]);
    } finally {
      registry["appGlobalHost"] = originalAppGlobalHost;
    }
  });

  it("records acquired workspace link repair status in the owning workspace store", async () => {
    const firstCwd = tempWorkspace("runtime-generated-link-owner-a");
    const secondCwd = tempWorkspace("runtime-generated-link-owner-b");
    const agentDir = tempAgentDir("generated-link-owner-agent-root");
    const generatedExtensionsPackagePath = tempWorkspace("generated-link-owner-extensions-package");
    mkdirSync(join(secondCwd, ".smithers"), { recursive: true });
    const registry = createRegistry(firstCwd, agentDir, {
      workflowsExtensionsGeneratedPackagePath: generatedExtensionsPackagePath,
    });
    const first = await registry.acquireWorkspace(firstCwd);
    const second = await registry.acquireWorkspace(secondCwd);

    expect(readGeneratedPackageWorkspaceLinks(second.cwd, agentDir)).toContainEqual({
      workspace_id: second.workspaceId,
      package_name: "@svvyx/extensions",
      status: "linked",
      source_command_id: null,
    });
    expect(
      readGeneratedPackageWorkspaceLinks(first.cwd, agentDir).some(
        (row) => row.workspace_id === second.workspaceId,
      ),
    ).toBeFalse();
  });

  it("scopes workspace-routed event subscriptions to that workspace plus app events", async () => {
    const firstCwd = tempWorkspace("runtime-events-workspace-a");
    const secondCwd = tempWorkspace("runtime-events-workspace-b");
    const agentDir = tempAgentDir("runtime-events-agent-root");
    const generatedExtensionsPackagePath = tempWorkspace("runtime-events-extensions-package");
    mkdirSync(join(secondCwd, ".smithers"), { recursive: true });
    const registry = createRegistry(firstCwd, agentDir, {
      workflowsExtensionsGeneratedPackagePath: generatedExtensionsPackagePath,
    });
    const first = await registry.acquireWorkspace(firstCwd);
    const second = await registry.acquireWorkspace(secondCwd);
    const runtimeEvents = await collectRuntimeEvents(
      registry.getRuntimeEventSubscription(first.workspaceId),
    );
    const runtimeOperations = getWorkspaceRuntimeOperationsForRequest(registry, {
      workspaceId: first.workspaceId,
    });
    try {
      await runtimeOperations.sourceInvalidation.applyCommittedScanEvent({
        scope: { kind: "workspace", workspaceId: second.workspaceId as WorkspaceId },
        event: {
          domains: ["external_instructions"],
          reason: "test-workspace-b-invalidation",
          sourceFingerprints: {
            extensions: "extensions-fingerprint",
            workflows: "workflows-fingerprint",
            external_instructions: "external-instructions-fingerprint",
            host_snippets: "host-snippets-fingerprint",
          },
          afterCommit: [
            {
              scope: "workspace",
              workspaceId: second.workspaceId as WorkspaceId,
              invalidation: { model: "sessionNavigation" },
            },
          ],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(
        runtimeEvents.events.some(
          (event) => "workspaceId" in event && event.workspaceId === second.workspaceId,
        ),
      ).toBeFalse();

      await runtimeOperations.sourceInvalidation.refreshGeneratedPackages({
        scope: "app-global",
        packages: ["@svvyx/extensions"],
        reason: "explicit-build",
        sourceCommandId: "cmd_runtime_events_app_01" as CommandId,
      });
      await waitFor(() =>
        runtimeEvents.events.some(
          (event) =>
            event.type === "app_read_model.changed" && event.invalidation.model === "extensions",
        ),
      );
      expect(
        runtimeEvents.events.some(
          (event) => "workspaceId" in event && event.workspaceId === second.workspaceId,
        ),
      ).toBeFalse();
    } finally {
      await runtimeEvents.close();
    }
  });

  it("installs committed-state publication for a workspace opened after app runtime readiness", async () => {
    const initialCwd = tempWorkspace("late-publication-initial");
    const lateCwd = tempWorkspace("late-publication-workspace");
    const registry = createRegistry(initialCwd);
    await registry.acquireDesktopAppFacades();

    const late = await registry.acquireWorkspace(lateCwd);
    const runtimeEvents = await collectRuntimeEvents(
      registry.getRuntimeEventSubscription(late.workspaceId),
    );
    try {
      const created = await late.catalog.createSession(
        { title: "Late-open cross-tab session" },
        { provider: "openai", model: "gpt-4o", thinkingLevel: "medium" },
      );

      await waitFor(() =>
        runtimeEvents.events.some(
          (event) =>
            event.type === "workspace_read_model.changed" &&
            event.workspaceId === late.workspaceId &&
            event.invalidation.model === "sessionNavigation",
        ),
      );
      const state = await registry.getRendererStateFacade();
      const navigation = await state.readModels.fetch({
        kind: "sessionNavigation",
        workspaceId: late.workspaceId as WorkspaceId,
      });
      expect(navigation.kind).toBe("sessionNavigation");
      if (navigation.kind === "sessionNavigation") {
        expect(navigation.value.activeSessions.map((summary) => summary.id)).toContain(
          created.target.workspaceSessionId,
        );
      }
    } finally {
      await runtimeEvents.close();
    }
  });

  it("restores late-workspace blocking waits before activating startup queue replay", async () => {
    const initialCwd = tempWorkspace("late-wait-recovery-initial");
    const lateCwd = realpathSync.native(tempWorkspace("late-wait-recovery-workspace"));
    const agentDir = tempAgentDir("late-wait-recovery-agent-root");
    const sessionDir = getSvvySessionDir(lateCwd, agentDir);
    mkdirSync(sessionDir, { recursive: true });
    const store = createStructuredSessionStateStore({
      databasePath: join(sessionDir, STRUCTURED_SESSION_DB_FILENAME),
      digest: testDigest,
      workspace: {
        id: normalizeWorkspaceRuntimeId(lateCwd),
        label: "Late wait recovery",
        cwd: lateCwd,
        artifactDir: join(sessionDir, "artifacts"),
      },
    });
    store.upsertPiSession({
      sessionId: "session-late-wait-recovery",
      title: "Late wait recovery",
      messageCount: 1,
      status: "idle",
      createdAt: "2026-07-11T09:00:00.000Z",
      updatedAt: "2026-07-11T09:01:00.000Z",
    });
    store.enqueueSurfaceMessage({
      sessionId: "session-late-wait-recovery",
      surfacePiSessionId: "session-late-wait-recovery",
      messageJson: JSON.stringify({
        text: "Replay only after request-input wait restoration.",
        attachments: [],
      }),
    });
    store.close();

    const registry = createRegistry(initialCwd, agentDir);
    await registry.acquireDesktopAppFacades();
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected ready app runtime bootstrap.");
    const bootstrap = await bootstrapPromise;
    const order: string[] = [];
    const acquire = bootstrap.facade.workspaces.acquire.bind(bootstrap.facade.workspaces);
    const wakeSurfaceQueue = bootstrap.internal.workspaceRecovery.wakeSurfaceQueue.bind(
      bootstrap.internal.workspaceRecovery,
    );
    let signalWaitRestore!: () => void;
    const waitRestoreCompleted = new Promise<void>((resolve) => {
      signalWaitRestore = resolve;
    });
    let allowAcquireReturn!: () => void;
    const acquireReturnGate = new Promise<void>((resolve) => {
      allowAcquireReturn = resolve;
    });
    Reflect.set(
      bootstrap.facade.workspaces,
      "acquire",
      async (input: Parameters<typeof acquire>[0]) => {
        const result = await acquire(input);
        order.push("blocking-waits:restored");
        signalWaitRestore();
        await acquireReturnGate;
        return result;
      },
    );
    Reflect.set(
      bootstrap.internal.workspaceRecovery,
      "wakeSurfaceQueue",
      async (target: Parameters<typeof wakeSurfaceQueue>[0]) => {
        order.push("queue-replay:wake");
        await wakeSurfaceQueue(target);
      },
    );

    const opening = registry.acquireWorkspace(lateCwd);
    await waitRestoreCompleted;
    const orderBeforeAcquireReturned = [...order];
    allowAcquireReturn();
    await opening;
    await waitFor(() => order.includes("queue-replay:wake"));
    expect(orderBeforeAcquireReturned).toEqual(["blocking-waits:restored"]);
    expect(order).toEqual(["blocking-waits:restored", "queue-replay:wake"]);
  });

  it("registers late workspace state before flushing retained recovery invalidations", async () => {
    const initialCwd = tempWorkspace("recovery-publication-order-initial");
    const lateCwd = realpathSync.native(tempWorkspace("recovery-publication-order-late"));
    const agentDir = tempAgentDir("recovery-publication-order-agent-root");
    const sessionDir = getSvvySessionDir(lateCwd, agentDir);
    mkdirSync(sessionDir, { recursive: true });
    const store = createStructuredSessionStateStore({
      databasePath: join(sessionDir, STRUCTURED_SESSION_DB_FILENAME),
      digest: testDigest,
      workspace: {
        id: normalizeWorkspaceRuntimeId(lateCwd),
        label: "Recovery publication order",
        cwd: lateCwd,
        artifactDir: join(sessionDir, "artifacts"),
      },
    });
    store.upsertPiSession({
      sessionId: "session-recovery-publication-order",
      title: "Interrupted before app restart",
      messageCount: 1,
      status: "running",
      createdAt: "2026-07-11T09:00:00.000Z",
      updatedAt: "2026-07-11T09:01:00.000Z",
    });
    store.startTurn({
      sessionId: "session-recovery-publication-order",
      surfacePiSessionId: "session-recovery-publication-order",
      requestSummary: "Recover this interrupted turn",
    });
    store.close();

    const registry = createRegistry(initialCwd, agentDir);
    await registry.acquireDesktopAppFacades();
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected ready app runtime bootstrap.");
    const bootstrap = await bootstrapPromise;
    const order: string[] = [];
    const register = bootstrap.internal.workspaceStates.register.bind(
      bootstrap.internal.workspaceStates,
    );
    const publish = bootstrap.internal.committedStateInvalidations.publish.bind(
      bootstrap.internal.committedStateInvalidations,
    );
    bootstrap.internal.workspaceStates.register = async (input, appLogs) => {
      order.push("register:start");
      await waitFor(() => readTurnStatus(sessionDir) === "failed");
      await register(input, appLogs);
      order.push("register:complete");
    };
    bootstrap.internal.committedStateInvalidations.publish = async (afterCommit) => {
      order.push("publish:start");
      const readModel = await bootstrap.rendererState.readModels.fetch({
        kind: "sessionNavigation",
        workspaceId: normalizeWorkspaceRuntimeId(lateCwd) as WorkspaceId,
      });
      expect(readModel.kind).toBe("sessionNavigation");
      await publish(afterCommit);
      order.push("publish:complete");
    };

    await registry.acquireWorkspace(lateCwd);

    expect(order).toEqual([
      "register:start",
      "register:complete",
      "publish:start",
      "publish:complete",
    ]);
  });

  it("rejects late bootstrap callbacks during shutdown without recreating the app runtime", async () => {
    const cwd = tempWorkspace("runtime-shutdown-no-recreate");
    const registry = createRegistry(cwd);
    const runtime = await registry.acquireWorkspace(cwd);

    const closePromise = registry.shutdownApp();
    try {
      await expect(registry.getRuntimeEventSubscription(runtime.workspaceId)).rejects.toMatchObject(
        {
          reason: "runtime-shutdown",
          operation: "workspace-runtime-registry.getAppRuntimeBootstrap",
        },
      );
      await closePromise;
      await expect(registry.getAppRuntimeOperations(runtime.workspaceId)).rejects.toMatchObject({
        reason: "runtime-shutdown",
        operation: "workspace-runtime-registry.getAppRuntimeBootstrap",
      });
    } finally {
      registries.splice(registries.indexOf(registry), 1);
      await closePromise.catch(() => {});
    }
  });

  it("shuts down workspace and source scopes before disposing the single app bootstrap", async () => {
    const cwd = tempWorkspace("ordered-app-shutdown");
    const registry = createRegistry(cwd);
    const workspace = await registry.acquireWorkspace(cwd);
    await registry.acquireDesktopAppFacades();
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    expect(bootstrapPromise).not.toBeNull();
    if (!bootstrapPromise) throw new Error("Expected the app runtime bootstrap to exist.");
    const bootstrap = await bootstrapPromise;
    const runtime = registry["runtimes"].get(workspace.workspaceId);
    expect(runtime).toBeDefined();
    if (!runtime) throw new Error("Expected the workspace runtime to exist.");
    const order: string[] = [];
    const releaseReasons: string[] = [];
    const releaseWorkspace = bootstrap.facade.workspaces.release.bind(bootstrap.facade.workspaces);
    Reflect.set(
      bootstrap.facade.workspaces,
      "release",
      async (input: Parameters<typeof releaseWorkspace>[0]) => {
        releaseReasons.push(input.releaseReason);
        return releaseWorkspace(input);
      },
    );
    const originalWorkspaceShutdown = runtime.shutdown.bind(runtime);
    runtime.shutdown = async (appRuntime) => {
      order.push("workspace:start");
      await originalWorkspaceShutdown(appRuntime);
      order.push("workspace:closed");
    };
    const appSource = registry["appGlobalSourceInvalidationCoordinator"];
    const originalAppSourceClose = appSource.close.bind(appSource);
    appSource.close = async () => {
      order.push("app-source:start");
      await originalAppSourceClose();
      order.push("app-source:closed");
    };
    const originalBootstrapDispose = bootstrap.dispose.bind(bootstrap);
    bootstrap.dispose = async (reason) => {
      order.push("bootstrap:dispose");
      expect(reason).toBe("app-shutdown");
      expect(registry.listOpenWorkspaces()).toEqual([]);
      expect(order).toContain("workspace:closed");
      expect(order).toContain("app-source:closed");
      await originalBootstrapDispose(reason);
    };

    const firstShutdown = registry.shutdownApp();
    const secondShutdown = registry.shutdownApp();

    expect(secondShutdown).toBe(firstShutdown);
    await firstShutdown;
    expect(order).toEqual([
      "workspace:start",
      "workspace:closed",
      "app-source:start",
      "app-source:closed",
      "bootstrap:dispose",
    ]);
    expect(releaseReasons).toEqual(["shutdown"]);
    expect(registry["appRuntimeBootstrap"]).toBe(bootstrapPromise);
    expect(registry["appRuntimeBootstrapState"]).toBe("closed");
    await expect(registry.acquireDesktopAppFacades()).rejects.toMatchObject({
      operation: "workspace-runtime-registry.acquireDesktopAppFacades",
      reason: "runtime-shutdown",
    });
    await expect(registry.acquireWorkspace(cwd)).rejects.toMatchObject({
      operation: "workspace-runtime-registry.acquireWorkspace",
      reason: "runtime-shutdown",
    });
    expect(registry["appRuntimeBootstrap"]).toBe(bootstrapPromise);
  });

  it("disposes a ready app runtime with the startup-failure preparation reason", async () => {
    const registry = createRegistry(tempWorkspace("ready-runtime-startup-failure"));
    await registry.acquireDesktopAppFacades();
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected the app runtime bootstrap to exist.");
    const bootstrap = await bootstrapPromise;
    const disposeReasons: Array<"app-shutdown" | "startup-failure" | undefined> = [];
    const dispose = bootstrap.dispose.bind(bootstrap);
    bootstrap.dispose = async (reason) => {
      disposeReasons.push(reason);
      await dispose(reason);
    };

    await registry.shutdownApp("startup-failure");

    expect(disposeReasons).toEqual(["startup-failure"]);
  });

  it("settles and disposes a pending workspace acquisition before app bootstrap disposal", async () => {
    const cwd = tempWorkspace("pending-acquire-app-shutdown");
    const registry = createRegistry(cwd);
    const originalCreateRuntime = registry["createRuntime"].bind(registry);
    let createdRuntime: Awaited<ReturnType<typeof originalCreateRuntime>> | null = null;
    let signalRuntimeCreated!: () => void;
    const runtimeCreated = new Promise<void>((resolve) => {
      signalRuntimeCreated = resolve;
    });
    let releasePendingRuntime!: () => void;
    const pendingRuntimeGate = new Promise<void>((resolve) => {
      releasePendingRuntime = resolve;
    });
    let pendingRuntimeDisposeCount = 0;
    const order: string[] = [];
    registry["createRuntime"] = async (...input) => {
      const runtime = await originalCreateRuntime(...input);
      createdRuntime = runtime;
      const originalShutdown = runtime.shutdown.bind(runtime);
      runtime.shutdown = async (appRuntime) => {
        pendingRuntimeDisposeCount += 1;
        order.push("pending-workspace:dispose");
        await originalShutdown(appRuntime);
      };
      signalRuntimeCreated();
      await pendingRuntimeGate;
      return runtime;
    };

    const acquisition = registry.acquireWorkspace(cwd);
    const acquisitionOutcome = acquisition.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await runtimeCreated;
    expect(createdRuntime).not.toBeNull();
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    expect(bootstrapPromise).not.toBeNull();
    if (!bootstrapPromise)
      throw new Error("Expected the pending workspace to acquire the bootstrap.");
    const bootstrap = await bootstrapPromise;
    const originalBootstrapDispose = bootstrap.dispose.bind(bootstrap);
    bootstrap.dispose = async () => {
      order.push("bootstrap:dispose");
      expect(pendingRuntimeDisposeCount).toBe(1);
      await originalBootstrapDispose();
    };

    const shutdown = registry.shutdownApp();
    releasePendingRuntime();
    const outcome = await acquisitionOutcome;
    expect(outcome).toMatchObject({
      status: "rejected",
      error: {
        operation: "workspace-runtime-registry.acquireWorkspace",
        reason: "runtime-shutdown",
      },
    });
    await shutdown;

    expect(pendingRuntimeDisposeCount).toBe(1);
    expect(order).toEqual(["pending-workspace:dispose", "bootstrap:dispose"]);
    expect(registry.listOpenWorkspaces()).toEqual([]);
    expect(registry["pendingRuntimes"].size).toBe(0);
  });

  it("waits for an in-flight workspace close before disposing the app bootstrap", async () => {
    const cwd = tempWorkspace("workspace-close-app-shutdown-race");
    const registry = createRegistry(cwd);
    const workspace = await registry.acquireWorkspace(cwd);
    const runtime = registry["runtimes"].get(workspace.workspaceId);
    if (!runtime) throw new Error("Expected the workspace runtime to exist.");
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected the app runtime bootstrap to exist.");
    const bootstrap = await bootstrapPromise;
    const order: string[] = [];
    let signalCloseStarted!: () => void;
    const closeStarted = new Promise<void>((resolve) => {
      signalCloseStarted = resolve;
    });
    let allowClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      allowClose = resolve;
    });
    const originalReleaseVisualOwner = runtime.releaseVisualOwner.bind(runtime);
    runtime.releaseVisualOwner = async () => {
      order.push("workspace-close:start");
      signalCloseStarted();
      await closeGate;
      const result = await originalReleaseVisualOwner();
      order.push("workspace-close:complete");
      return result;
    };
    const originalBootstrapDispose = bootstrap.dispose.bind(bootstrap);
    bootstrap.dispose = async (reason) => {
      order.push("bootstrap:dispose");
      await originalBootstrapDispose(reason);
    };

    const close = registry.releaseWorkspace(workspace.workspaceId);
    await closeStarted;
    const shutdown = registry.shutdownApp();
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["workspace-close:start"]);
    allowClose();
    await Promise.all([close, shutdown]);
    expect(order).toEqual([
      "workspace-close:start",
      "workspace-close:complete",
      "bootstrap:dispose",
    ]);
    expect(registry["closingRuntimes"].size).toBe(0);
  });

  it("waits for same-cwd cleanup before constructing a replacement workspace", async () => {
    const cwd = tempWorkspace("workspace-close-reopen-race");
    const registry = createRegistry(cwd);
    const first = await registry.acquireWorkspace(cwd);
    const runtime = registry["runtimes"].get(first.workspaceId);
    if (!runtime) throw new Error("Expected the workspace runtime to exist.");
    let signalCloseStarted!: () => void;
    const closeStarted = new Promise<void>((resolve) => {
      signalCloseStarted = resolve;
    });
    let allowClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      allowClose = resolve;
    });
    const originalReleaseVisualOwner = runtime.releaseVisualOwner.bind(runtime);
    runtime.releaseVisualOwner = async () => {
      signalCloseStarted();
      await closeGate;
      return originalReleaseVisualOwner();
    };

    const close = registry.releaseWorkspace(first.workspaceId);
    await closeStarted;
    let reopenSettled = false;
    const reopen = registry.acquireWorkspace(cwd).finally(() => {
      reopenSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(reopenSettled).toBeFalse();
    expect(registry["pendingRuntimes"].size).toBe(0);
    allowClose();
    await close;
    const second = await reopen;

    expect(second).not.toBe(first);
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(registry.listOpenWorkspaces()).toHaveLength(1);
    expect(registry["closingRuntimes"].size).toBe(0);
    await expect(
      (await registry.getRendererStateFacade()).readModels.fetch({
        kind: "sessionNavigation",
        workspaceId: second.workspaceId as WorkspaceId,
      }),
    ).resolves.toMatchObject({ kind: "sessionNavigation" });
  });

  it("retries zero-owner cleanup without losing the dormant host record", async () => {
    const cwd = tempWorkspace("workspace-zero-owner-cleanup-retry");
    const registry = createRegistry(cwd);
    const workspace = await registry.acquireWorkspace(cwd);
    const facades = await registry.acquireDesktopAppFacades();
    const runtime = registry["runtimes"].get(workspace.workspaceId);
    if (!runtime) throw new Error("Expected the workspace runtime to exist.");
    const closeSourceCoordinator = runtime.sourceInvalidationCoordinator.close.bind(
      runtime.sourceInvalidationCoordinator,
    );
    const failure = new Error("source coordinator close failed");
    let closeAttempts = 0;
    runtime.sourceInvalidationCoordinator.close = async () => {
      closeAttempts += 1;
      if (closeAttempts === 1) {
        throw failure;
      }
      await closeSourceCoordinator();
    };

    await expect(registry.releaseWorkspace(workspace.workspaceId)).rejects.toThrow(
      "Workspace runtime resources did not close cleanly.",
    );

    expect(registry["dormantRuntimes"].get(workspace.workspaceId)).toBe(runtime);
    expect(runtime.latestOwnerReleaseResult).toMatchObject({
      remainingOwners: 0,
      lifecycle: "idle",
    });
    await expect(
      facades.runtimeActions.workspaces.acquire({
        cwd: workspace.cwd as AbsolutePath,
        owner: {
          kind: "headless",
          ownerId: "headless:closing-host" as RuntimeOwnerId,
        },
        openReason: "headless",
      }),
    ).rejects.toMatchObject({ reason: "target-not-found" });
    expect(registry["externalWorkspaceOwners"].size).toBe(0);
    await expect(registry.releaseWorkspace(workspace.workspaceId)).resolves.toBe(true);
    expect(closeAttempts).toBe(2);
    expect(registry["dormantRuntimes"].has(workspace.workspaceId)).toBeFalse();
  });

  it("does not construct a replacement when shutdown begins during dormant cleanup", async () => {
    const cwd = tempWorkspace("workspace-dormant-cleanup-shutdown-race");
    const registry = createRegistry(cwd);
    const workspace = await registry.acquireWorkspace(cwd);
    const runtime = registry["runtimes"].get(workspace.workspaceId);
    if (!runtime) throw new Error("Expected the workspace runtime to exist.");
    let signalRetryCleanupStarted!: () => void;
    const retryCleanupStarted = new Promise<void>((resolve) => {
      signalRetryCleanupStarted = resolve;
    });
    let allowRetryCleanup!: () => void;
    const retryCleanupGate = new Promise<void>((resolve) => {
      allowRetryCleanup = resolve;
    });
    const shutdownRuntime = runtime.shutdown.bind(runtime);
    const cleanupFailure = new Error("workspace cleanup failed before replacement");
    let runtimeShutdownCalls = 0;
    runtime.shutdown = async (appRuntime) => {
      runtimeShutdownCalls += 1;
      if (runtimeShutdownCalls === 1) {
        throw cleanupFailure;
      }
      if (runtimeShutdownCalls === 2) {
        signalRetryCleanupStarted();
        await retryCleanupGate;
        return;
      }
      await shutdownRuntime(appRuntime);
    };

    await expect(registry.releaseWorkspace(workspace.workspaceId)).rejects.toBe(cleanupFailure);
    expect(registry["dormantRuntimes"].get(workspace.workspaceId)).toBe(runtime);
    expect(runtime.latestOwnerReleaseResult).toMatchObject({
      remainingOwners: 0,
      lifecycle: "idle",
    });

    const createRuntime = registry["createRuntime"].bind(registry);
    let replacementRuntimeConstructions = 0;
    registry["createRuntime"] = async (...input) => {
      replacementRuntimeConstructions += 1;
      return await createRuntime(...input);
    };

    const reopening = registry.acquireWorkspace(cwd);
    await retryCleanupStarted;
    let shutdownSettled = false;
    const shutdown = registry.shutdownApp().finally(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(shutdownSettled).toBeFalse();
    allowRetryCleanup();
    const reopeningError = await reopening.then(
      () => null,
      (error: unknown) => error,
    );
    expect((reopeningError as { operation?: unknown }).operation).toBe(
      "workspace-runtime-registry.acquireWorkspace",
    );
    expect((reopeningError as { reason?: unknown }).reason).toBe("runtime-shutdown");
    await shutdown;

    expect(replacementRuntimeConstructions).toBe(0);
    expect(runtimeShutdownCalls).toBe(3);
    expect(registry["pendingRuntimes"].size).toBe(0);
    expect(registry["openingRuntimes"].size).toBe(0);
    expect(registry["dormantRuntimes"].size).toBe(0);
    expect(registry["sharedAppLogFacades"].size).toBe(0);
  });

  it("retries a failed final visual-owner release from the dormant record", async () => {
    const cwd = tempWorkspace("workspace-visual-release-retry");
    const registry = createRegistry(cwd);
    const workspace = await registry.acquireWorkspace(cwd);
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected the app runtime bootstrap to exist.");
    const bootstrap = await bootstrapPromise;
    const release = bootstrap.facade.workspaces.release.bind(bootstrap.facade.workspaces);
    const failure = new Error("visual owner release failed before commit");
    let releaseAttempts = 0;
    Reflect.set(
      bootstrap.facade.workspaces,
      "release",
      async (input: Parameters<typeof release>[0]) => {
        if (input.owner.kind === "desktop-tab") {
          releaseAttempts += 1;
          if (releaseAttempts === 1) {
            throw failure;
          }
        }
        return release(input);
      },
    );

    await expect(registry.releaseWorkspace(workspace.workspaceId)).rejects.toBe(failure);
    expect(registry["dormantRuntimes"].has(workspace.workspaceId)).toBeTrue();
    await expect(registry.releaseWorkspace(workspace.workspaceId)).resolves.toBe(true);
    expect(releaseAttempts).toBe(2);
    expect(registry["dormantRuntimes"].has(workspace.workspaceId)).toBeFalse();
  });

  it("does not resurrect a dormant runtime when shutdown wins reactivation", async () => {
    const cwd = tempWorkspace("workspace-dormant-reactivation-shutdown-race");
    const registry = createRegistry(cwd);
    const workspace = await registry.acquireWorkspace(cwd);
    const facades = await registry.acquireDesktopAppFacades();
    const headlessOwner = {
      kind: "headless" as const,
      ownerId: "headless:reactivation-race" as RuntimeOwnerId,
    };
    await facades.runtimeActions.workspaces.acquire({
      cwd: workspace.cwd as AbsolutePath,
      owner: headlessOwner,
      openReason: "headless",
    });
    await registry.releaseWorkspace(workspace.workspaceId);
    const dormant = registry["dormantRuntimes"].get(workspace.workspaceId);
    if (!dormant) throw new Error("Expected a dormant workspace runtime.");

    let signalReactivated!: () => void;
    const reactivated = new Promise<void>((resolve) => {
      signalReactivated = resolve;
    });
    let allowReactivationToReturn!: () => void;
    const reactivationGate = new Promise<void>((resolve) => {
      allowReactivationToReturn = resolve;
    });
    const originalReactivate = dormant.reactivate.bind(dormant);
    dormant.reactivate = async () => {
      await originalReactivate();
      signalReactivated();
      await reactivationGate;
    };
    let shutdownCount = 0;
    const originalShutdown = dormant.shutdown.bind(dormant);
    dormant.shutdown = async (appRuntime) => {
      shutdownCount += 1;
      await originalShutdown(appRuntime);
    };

    const reopening = registry.acquireWorkspace(cwd);
    await reactivated;
    const shutdown = registry.shutdownApp();
    allowReactivationToReturn();

    await expect(reopening).rejects.toMatchObject({
      operation: "workspace-runtime-registry.acquireWorkspace",
      reason: "runtime-shutdown",
    });
    await shutdown;

    expect(shutdownCount).toBe(1);
    expect(registry.listOpenWorkspaces()).toEqual([]);
    expect(registry["runtimes"].size).toBe(0);
    expect(registry["dormantRuntimes"].size).toBe(0);
    expect(registry["pendingRuntimes"].size).toBe(0);
    expect(() => registry.getRuntime(workspace.workspaceId)).toThrow("Workspace is not open");
  });

  it("rolls back an acquired workspace when startup package recovery fails", async () => {
    const cwd = tempWorkspace("workspace-startup-recovery-failure");
    const registry = createRegistry(cwd);
    await registry.acquireDesktopAppFacades();
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected the app runtime bootstrap to exist.");
    const bootstrap = await bootstrapPromise;
    const baselineAppLogFacades = registry["sharedAppLogFacades"].size;
    const failure = new Error("workspace package recovery failed");
    const cleanupCalls: string[] = [];
    const refreshGeneratedPackages =
      bootstrap.internal.sourceInvalidation.refreshGeneratedPackages.bind(
        bootstrap.internal.sourceInvalidation,
      );
    Reflect.set(
      bootstrap.internal.sourceInvalidation,
      "refreshGeneratedPackages",
      async (input: Parameters<typeof refreshGeneratedPackages>[0]) => {
        if (input.scope === "workspace-link-repair") {
          throw failure;
        }
        return refreshGeneratedPackages(input);
      },
    );
    const releaseWorkspace = bootstrap.facade.workspaces.release.bind(bootstrap.facade.workspaces);
    Reflect.set(
      bootstrap.facade.workspaces,
      "release",
      async (input: Parameters<typeof releaseWorkspace>[0]) => {
        cleanupCalls.push(`release:${input.releaseReason}`);
        return releaseWorkspace(input);
      },
    );
    const unregisterWorkspace = bootstrap.internal.workspaceStates.unregister.bind(
      bootstrap.internal.workspaceStates,
    );
    Reflect.set(bootstrap.internal.workspaceStates, "unregister", (workspaceId: WorkspaceId) => {
      cleanupCalls.push(`unregister:${workspaceId}`);
      return unregisterWorkspace(workspaceId);
    });
    const releaseAppLogFacade = registry["releaseAppLogFacade"].bind(registry);
    registry["releaseAppLogFacade"] = (workspaceCwd) => {
      cleanupCalls.push("app-logs:release");
      releaseAppLogFacade(workspaceCwd);
    };

    await expect(registry.acquireWorkspace(cwd)).rejects.toBe(failure);

    expect(cleanupCalls[0]).toBe("release:shutdown");
    expect(cleanupCalls[1]).toStartWith("unregister:");
    expect(cleanupCalls.at(-1)).toBe("app-logs:release");
    expect(registry.listOpenWorkspaces()).toEqual([]);
    expect(registry["pendingRuntimes"].size).toBe(0);
    expect(registry["sharedAppLogFacades"].size).toBe(baselineAppLogFacades);
  });

  it("releases a workspace when acquisition fails after committing ownership", async () => {
    const cwd = tempWorkspace("workspace-acquire-post-commit-failure");
    const registry = createRegistry(cwd);
    await registry.acquireDesktopAppFacades();
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected the app runtime bootstrap to exist.");
    const bootstrap = await bootstrapPromise;
    const failure = new Error("workspace acquisition response failed after commit");
    const releaseReasons: string[] = [];
    const acquireWorkspace = bootstrap.facade.workspaces.acquire.bind(bootstrap.facade.workspaces);
    Reflect.set(
      bootstrap.facade.workspaces,
      "acquire",
      async (input: Parameters<typeof acquireWorkspace>[0]) => {
        await acquireWorkspace(input);
        throw failure;
      },
    );
    const releaseWorkspace = bootstrap.facade.workspaces.release.bind(bootstrap.facade.workspaces);
    Reflect.set(
      bootstrap.facade.workspaces,
      "release",
      async (input: Parameters<typeof releaseWorkspace>[0]) => {
        releaseReasons.push(input.releaseReason);
        return releaseWorkspace(input);
      },
    );

    await expect(registry.acquireWorkspace(cwd)).rejects.toBe(failure);

    expect(releaseReasons).toEqual(["shutdown"]);
    expect(registry.listOpenWorkspaces()).toEqual([]);
    expect(registry["pendingRuntimes"].size).toBe(0);
  });

  it("rolls back a partially committed workspace-state registration", async () => {
    const cwd = tempWorkspace("workspace-state-registration-failure");
    const registry = createRegistry(cwd);
    await registry.acquireDesktopAppFacades();
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected the app runtime bootstrap to exist.");
    const bootstrap = await bootstrapPromise;
    const baselineAppLogFacades = registry["sharedAppLogFacades"].size;
    const failure = new Error("workspace state registration response failed");
    const cleanupCalls: string[] = [];
    const registerWorkspace = bootstrap.internal.workspaceStates.register.bind(
      bootstrap.internal.workspaceStates,
    );
    Reflect.set(
      bootstrap.internal.workspaceStates,
      "register",
      async (...input: Parameters<typeof registerWorkspace>) => {
        await registerWorkspace(...input);
        throw failure;
      },
    );
    const unregisterWorkspace = bootstrap.internal.workspaceStates.unregister.bind(
      bootstrap.internal.workspaceStates,
    );
    Reflect.set(bootstrap.internal.workspaceStates, "unregister", (workspaceId: WorkspaceId) => {
      cleanupCalls.push(`unregister:${workspaceId}`);
      return unregisterWorkspace(workspaceId);
    });

    await expect(registry.acquireWorkspace(cwd)).rejects.toBe(failure);

    expect(cleanupCalls).toHaveLength(1);
    expect(cleanupCalls[0]).toStartWith("unregister:");
    expect(registry.listOpenWorkspaces()).toEqual([]);
    expect(registry["pendingRuntimes"].size).toBe(0);
    expect(registry["sharedAppLogFacades"].size).toBe(baselineAppLogFacades);
  });

  it("routes queue submit, steer, approval answer, and command stdin through the single facade", async () => {
    const firstCwd = tempWorkspace("runtime-facade-routing-a");
    const secondCwd = tempWorkspace("runtime-facade-routing-b");
    const registry = createRegistry(firstCwd);
    const first = await registry.acquireWorkspace(firstCwd);
    const second = await registry.acquireWorkspace(secondCwd);
    const secondSession = await second.catalog.createSession(
      { title: "Second routing session" },
      {
        provider: "openai",
        model: "gpt-4o",
        thinkingLevel: "medium",
      },
    );
    const secondTarget = secondSession.target as SubmitMessageInput["target"];
    const runtimeOperations = getWorkspaceRuntimeOperationsForRequest(registry, {
      workspaceId: first.workspaceId,
    });

    const submitted = await runtimeOperations.messages.submit({
      target: secondTarget,
      message: { text: "queue this in workspace B" },
      delivery: "queue-only",
      clientSubmission: {
        source: "desktop" as RuntimeClientSubmissionSource,
        clientRequestId: "runtime-routing-submit" as RuntimeClientRequestId,
      },
    });
    expect(submitted.target).toEqual(secondTarget);
    expect(
      workspaceStateStore(second).getSurfaceQueuedMessage({
        id: submitted.queuedMessageId,
      }).surfacePiSessionId,
    ).toBe(secondTarget.surfacePiSessionId);

    await expect(
      runtimeOperations.queues.steer({
        target: secondTarget,
        queuedMessageId: submitted.queuedMessageId,
      }),
    ).resolves.toBeUndefined();
    expect(["queued", "steering", "dispatching"]).toContain(
      workspaceStateStore(second).getSurfaceQueuedMessage({
        id: submitted.queuedMessageId,
      }).status,
    );

    const secondStore = workspaceStateStore(second);
    const turn = secondStore.startTurn({
      sessionId: secondTarget.workspaceSessionId,
      surfacePiSessionId: secondTarget.surfacePiSessionId,
      requestSummary: "Run command.",
    });
    const command = secondStore.createCommand({
      turnId: turn.id,
      surfacePiSessionId: secondTarget.surfacePiSessionId,
      toolName: "exec_command",
      executor: "orchestrator",
      visibility: "surface",
      title: "Run command",
      summary: "Run command.",
      status: "running",
    });
    const approval = secondStore.createRuntimeApprovalRequest({
      sessionId: secondTarget.workspaceSessionId,
      surfacePiSessionId: secondTarget.surfacePiSessionId,
      turnId: turn.id,
      commandId: command.id as CommandId,
      toolCallId: "tool_call_runtime_routing_approval",
      toolName: "exec_command",
      approvalMode: "user",
      cwd: second.cwd,
      command: "bun test",
      commandFamily: "bun",
    });
    await expect(
      runtimeOperations.approvals.answer({
        approvalId: approval.requestId as RuntimeApprovalId,
        decision: "approved",
        reason: "routing test",
      }),
    ).resolves.toMatchObject({
      approvalId: approval.requestId,
      commandId: command.id as CommandId,
      status: "approved",
    });
    expect(workspaceStateStore(second).getRuntimeApprovalRequest(approval.requestId).status).toBe(
      "approved",
    );

    const stdinWrites: string[] = [];
    const secondCommandStdin = (second as unknown as { commandStdin: LiveCommandStdinRegistry })
      .commandStdin;
    secondCommandStdin.register({
      commandId: command.id,
      sessionId: "live-command-routing",
      writeStdin: (text) => {
        stdinWrites.push(text);
        return { status: "accepted", acceptedBytes: text.length };
      },
      cancel: () => ({ status: "cancelled" }),
    });
    await expect(
      runtimeOperations.commands.writeStdin({
        commandId: command.id as CommandId,
        text: "exit\n",
      }),
    ).resolves.toEqual({
      commandId: command.id as CommandId,
      status: "accepted",
      acceptedBytes: 5,
    });
    expect(stdinWrites).toEqual(["exit\n"]);
    expect(workspaceStateStore(first).findCommandById(command.id)).toBeNull();
  });

  it("routes file-backed extension source invalidation through runtime generated-package refresh", async () => {
    const cwd = tempWorkspace("runtime-source-invalidation-refresh");
    const agentParent = tempWorkspace("source-invalidation-agent-parent");
    const agentDir = join(agentParent, "agent");
    mkdirSync(agentDir, { recursive: true });
    const generatedPackagePath = tempWorkspace("source-invalidation-workflows-package");
    const generatedExtensionsPackagePath = tempWorkspace("source-invalidation-extensions-package");
    const registry = createRegistry(cwd, agentDir, {
      workflowsExtensionsGeneratedPackagePath: generatedExtensionsPackagePath,
      workflowsGeneratedPackagePath: generatedPackagePath,
    });
    const runtime = await registry.acquireWorkspace(cwd);
    const runtimeEvents = await collectRuntimeEvents(
      registry.getRuntimeEventSubscription(runtime.workspaceId, { includeAppEvents: true }),
    );
    try {
      const extensionsPackageDir = join(agentParent, "extensions", "package");
      mkdirSync(extensionsPackageDir, { recursive: true });
      writeFileSync(
        join(extensionsPackageDir, "package.json"),
        JSON.stringify({ name: "svvy-extension-package-input" }),
      );
      registry.requestSourceInvalidationScan("test-extension-source-change");

      await waitFor(() => existsSync(join(generatedExtensionsPackagePath, "package.json")));
      await waitFor(() => existsSync(join(generatedPackagePath, "package.json")));
      await waitFor(() =>
        runtime.appLogs
          .query({ sources: ["workflow.library"] })
          .entries.some(
            (entry) => entry.message === "Source invalidation refreshed generated package.",
          ),
      );
      await waitFor(() =>
        runtimeEvents.events.some(
          (event) =>
            event.type === "app_read_model.changed" && event.invalidation.model === "extensions",
        ),
      );
    } finally {
      await runtimeEvents.close();
    }
  });

  it("refreshes app-global generated packages before any user workspace scope opens", async () => {
    const cwd = tempWorkspace("runtime-source-invalidation-no-user-runtime");
    const agentParent = tempWorkspace("source-invalidation-no-user-runtime-agent-parent");
    const agentDir = join(agentParent, "agent");
    const appDataDir = tempWorkspace("source-invalidation-no-user-runtime-app-data");
    mkdirSync(agentDir, { recursive: true });
    const generatedPackagePath = tempWorkspace("source-invalidation-no-user-runtime-workflows");
    const generatedExtensionsPackagePath = join(
      tempWorkspace("source-invalidation-no-user-runtime-extensions-parent"),
      "package",
    );
    const registry = createRegistry(cwd, agentDir, {
      appDataDir,
      workflowsExtensionsGeneratedPackagePath: generatedExtensionsPackagePath,
      workflowsGeneratedPackagePath: generatedPackagePath,
    });

    const extensionsPackageDir = join(agentParent, "extensions", "package");
    mkdirSync(extensionsPackageDir, { recursive: true });
    writeFileSync(
      join(extensionsPackageDir, "package.json"),
      JSON.stringify({ name: "svvy-extension-package-input" }),
    );

    registry.requestSourceInvalidationScan("test-extension-source-change");

    await waitFor(() => existsSync(join(generatedExtensionsPackagePath, "package.json")));
    await waitFor(() => existsSync(join(generatedPackagePath, "package.json")));
    const defaultCwd = getDefaultWorkspaceCwd(appDataDir);
    const dbPath = join(getSvvySessionDir(defaultCwd, agentDir), STRUCTURED_SESSION_DB_FILENAME);
    await waitFor(() => {
      if (!existsSync(dbPath)) return false;
      const db = new Database(dbPath, { readonly: true });
      try {
        return Boolean(
          db
            .query(
              `SELECT 1 FROM runtime_source_scan_fact
               WHERE scope_key = 'app-global'
                 AND domain = 'extensions'
                 AND last_observation_kind = 'scan'`,
            )
            .get(),
        );
      } finally {
        db.close();
      }
    });
    expect(registry.listOpenWorkspaces()).toEqual([]);
    expect(registry.getActiveWorkspaceId()).toBeNull();
  });

  it("opens and saves extension source edits through the production runtime facade", async () => {
    const cwd = tempWorkspace("source-edits");
    const agentRoot = tempWorkspace("source-edit-agent-root");
    const agentDir = join(agentRoot, "agent");
    mkdirSync(agentDir, { recursive: true });
    const registry = createRegistry(cwd, agentDir);
    const runtime = await registry.acquireWorkspace(cwd);
    const runtimeOperations = getWorkspaceRuntimeOperationsForRequest(registry, {
      workspaceId: runtime.workspaceId,
    });

    const opened = await runtimeOperations.sourceEdits.open({
      sourceKind: "builtin-extension",
      sourceId: "base-common#minimal",
    });
    const nextText = `${opened.text.trimEnd()}\n\nRuntime source edit test.\n`;

    const saved = await runtimeOperations.sourceEdits.save({
      workspaceId: runtime.workspaceId as WorkspaceId,
      source: {
        sourceKind: "builtin-extension",
        sourceId: "base-common#minimal",
        expectedSourceVersion: opened.sourceVersion,
        text: nextText,
        saveMode: "compare-and-swap",
      },
    });
    const reopened = await runtimeOperations.sourceEdits.open({
      sourceKind: "builtin-extension",
      sourceId: "base-common#minimal",
    });

    expect(opened.path).toEndWith("base-common/instructions/minimal.mdx");
    expect(saved).toMatchObject({
      status: "saved",
      reconcileRequired: true,
      diagnostics: [],
    });
    expect(reopened.text).toBe(nextText);
    expect(reopened.sourceVersion).toBe(saved.status === "saved" ? saved.sourceVersion : "");
    expect(readFileSync(reopened.path, "utf8")).toBe(nextText);
  }, 10000);

  it("applies workflow-agent CLI upserts through runtime source create and CAS authority", async () => {
    const cwd = tempWorkspace("workflow-agent-cli-source-authority");
    const workflowsSourceRoot = tempWorkspace("workflow-agent-cli-source-root");
    const registry = createRegistry(cwd, tempAgentDir(), { workflowsSourceRoot });
    const workspace = await registry.acquireWorkspace(cwd);
    const initialText = `${JSON.stringify(
      {
        id: "cliReviewerAgent",
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "medium" },
        instructions: "Review strictly.",
        overrides: { shell: "loaded" },
        extensionOrder: ["shell"],
      },
      null,
      2,
    )}\n`;
    const initial = await workspace.catalog.getAgentProfileMutationStore();
    initial.upsertWorkflowAgentSource({
      sourceId: "cliReviewerAgent",
      overwrite: false,
      draft: {
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        instructions: "Review strictly.",
        overrides: { shell: "loaded" },
        extensionOrder: ["shell"],
      },
      text: initialText,
    });

    await workspace.catalog.applyAgentProfileMutations(initial.takeMutations());

    const sourcePath = join(workflowsSourceRoot, "agents", "cliReviewerAgent.agent.json");
    expect(readFileSync(sourcePath, "utf8")).toBe(initialText);
    expect(
      (await workspace.catalog.getAgentProfileMutationStore()).getState().workflowAgents
        .cliReviewerAgent,
    ).toMatchObject({
      label: "Reviewer",
      sourceVersion: expect.any(String),
      extensionOrder: ["shell"],
    });

    const duplicate = await workspace.catalog.getAgentProfileMutationStore();
    duplicate.upsertWorkflowAgentSource({
      sourceId: "cliReviewerAgent",
      overwrite: false,
      draft: {
        label: "Ignored duplicate",
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        instructions: "Do not commit.",
        overrides: {},
        extensionOrder: [],
      },
      text: initialText.replace("Reviewer", "Ignored duplicate"),
    });
    await expect(
      workspace.catalog.applyAgentProfileMutations(duplicate.takeMutations()),
    ).rejects.toMatchObject({ reason: "invalid-input" });
    expect(readFileSync(sourcePath, "utf8")).toBe(initialText);

    const overwrittenText = initialText.replace("Review strictly.", "Review and report.");
    const overwrite = await workspace.catalog.getAgentProfileMutationStore();
    overwrite.upsertWorkflowAgentSource({
      sourceId: "cliReviewerAgent",
      overwrite: true,
      draft: {
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        instructions: "Review and report.",
        overrides: { shell: "loaded" },
        extensionOrder: ["shell"],
      },
      text: overwrittenText,
    });
    await workspace.catalog.applyAgentProfileMutations(overwrite.takeMutations());
    expect(readFileSync(sourcePath, "utf8")).toBe(overwrittenText);
  }, 10000);

  it("records lifecycle logs when workspace scopes open and close", async () => {
    const cwd = tempWorkspace("lifecycle-app-logs");
    const registry = createRegistry(cwd, tempAgentDir());
    const runtime = await registry.acquireWorkspace(cwd);
    const workspaceId = runtime.workspaceId;

    await registry.closeWorkspace(workspaceId);
    const reopened = await registry.acquireWorkspace(cwd);

    const lifecycleEntries = reopened.appLogs
      .query({ sources: ["app.lifecycle"] })
      .entries.filter(
        (entry) =>
          entry.source === "app.lifecycle" &&
          (entry.message === "Workspace scope opened." ||
            entry.message === "Workspace scope closed."),
      );

    expect(lifecycleEntries).toContainEqual(
      expect.objectContaining({
        source: "app.lifecycle",
        message: "Workspace scope opened.",
        details: {
          workspaceId,
          kind: "user",
          cwd: runtime.cwd,
        },
      }),
    );
    expect(lifecycleEntries).toContainEqual(
      expect.objectContaining({
        source: "app.lifecycle",
        message: "Workspace scope closed.",
        details: {
          workspaceId,
          kind: "user",
          cwd: runtime.cwd,
          releaseReason: "tab-closed",
        },
      }),
    );
  });

  it("keeps a workspace scope alive until every acquired visual owner is released", async () => {
    const cwd = tempWorkspace("reference-counted-runtime");
    const registry = createRegistry(cwd);
    const first = await registry.acquireWorkspace(cwd);
    const second = await registry.acquireWorkspace(join(cwd, "."));

    expect(second.workspaceId).toBe(first.workspaceId);

    expect(await registry.releaseWorkspace(first.workspaceId)).toBe(true);
    expect(registry.getRuntime(first.workspaceId)).toBeDefined();
    expect(await registry.releaseWorkspace(second.workspaceId)).toBe(true);
    expect(() => registry.getRuntime(first.workspaceId)).toThrow("Workspace is not open");
  });

  it("retains a dormant host record while a non-visual runtime owner remains", async () => {
    const cwd = tempWorkspace("headless-owner-host-lifetime");
    const registry = createRegistry(cwd);
    const workspace = await registry.acquireWorkspace(cwd);
    const facades = await registry.acquireDesktopAppFacades();
    const headlessOwner = {
      kind: "headless" as const,
      ownerId: "headless:host-lifetime" as RuntimeOwnerId,
    };
    await facades.runtimeActions.workspaces.acquire({
      cwd: workspace.cwd as AbsolutePath,
      owner: headlessOwner,
      openReason: "headless",
    });

    await registry.releaseWorkspace(workspace.workspaceId);

    expect(registry.listOpenWorkspaces()).toEqual([]);
    expect(registry["dormantRuntimes"].get(workspace.workspaceId)?.workspaceId).toBe(
      workspace.workspaceId,
    );
    await expect(
      facades.runtimeActions.workspaces.release({
        workspaceId: workspace.workspaceId as WorkspaceId,
        owner: headlessOwner,
        releaseReason: "headless-complete",
      }),
    ).resolves.toMatchObject({
      remainingOwners: 0,
      lifecycle: "idle",
    });

    expect(registry["dormantRuntimes"].has(workspace.workspaceId)).toBeFalse();
    expect(registry["externalWorkspaceOwners"].has(workspace.workspaceId)).toBeFalse();

    const reopened = await registry.acquireWorkspace(cwd);
    expect(reopened).not.toBe(workspace);
    expect(reopened.workspaceId).toBe(workspace.workspaceId);
    expect(registry.getRuntime(workspace.workspaceId)).toBe(reopened);
  });

  it("tracks an external owner before an acquisition waiter can fail after commit", async () => {
    const cwd = tempWorkspace("headless-owner-post-commit-acquire-failure");
    const registry = createRegistry(cwd);
    const workspace = await registry.acquireWorkspace(cwd);
    const facades = await registry.acquireDesktopAppFacades();
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected the app runtime bootstrap to exist.");
    const bootstrap = await bootstrapPromise;
    const preAbortedController = new AbortController();
    preAbortedController.abort();
    await expect(
      facades.runtimeActions.workspaces.acquire(
        {
          cwd: workspace.cwd as AbsolutePath,
          owner: {
            kind: "headless",
            ownerId: "headless:pre-aborted" as RuntimeOwnerId,
          },
          openReason: "headless",
        },
        { signal: preAbortedController.signal },
      ),
    ).rejects.toMatchObject({ reason: "aborted" });
    expect(registry["externalWorkspaceOwners"].size).toBe(0);
    const acquire = bootstrap.facade.workspaces.acquire.bind(bootstrap.facade.workspaces);
    const failure = new Error("acquisition waiter failed after commit");
    Reflect.set(
      bootstrap.facade.workspaces,
      "acquire",
      async (...input: Parameters<typeof acquire>) => {
        await acquire(...input);
        throw failure;
      },
    );
    const headlessOwner = {
      kind: "headless" as const,
      ownerId: "headless:post-commit-acquire-failure" as RuntimeOwnerId,
    };

    await expect(
      facades.runtimeActions.workspaces.acquire({
        cwd: workspace.cwd as AbsolutePath,
        owner: headlessOwner,
        openReason: "headless",
      }),
    ).rejects.toBe(failure);

    expect(registry["externalWorkspaceOwners"].get(workspace.workspaceId)?.size).toBe(1);
    await registry.releaseWorkspace(workspace.workspaceId);
    expect(registry["dormantRuntimes"].has(workspace.workspaceId)).toBeTrue();
    await registry.shutdownApp();
    expect(registry["externalWorkspaceOwners"].size).toBe(0);
    expect(registry["dormantRuntimes"].size).toBe(0);
  });

  it("keeps cancel-wait-only acquisition serialized until ownership commits", async () => {
    const cwd = tempWorkspace("headless-owner-cancel-wait-serialization");
    const registry = createRegistry(cwd);
    const workspace = await registry.acquireWorkspace(cwd);
    const facades = await registry.acquireDesktopAppFacades();
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected the app runtime bootstrap to exist.");
    const bootstrap = await bootstrapPromise;
    const acquire = bootstrap.facade.workspaces.acquire.bind(bootstrap.facade.workspaces);
    let signalAuthoritativeAcquire!: () => void;
    const authoritativeAcquireStarted = new Promise<void>((resolve) => {
      signalAuthoritativeAcquire = resolve;
    });
    let allowAuthoritativeAcquire!: () => void;
    const authoritativeAcquireGate = new Promise<void>((resolve) => {
      allowAuthoritativeAcquire = resolve;
    });
    Reflect.set(
      bootstrap.facade.workspaces,
      "acquire",
      async (...input: Parameters<typeof acquire>) => {
        if (input[1]?.signal?.aborted) {
          return acquire(...input);
        }
        signalAuthoritativeAcquire();
        await authoritativeAcquireGate;
        return acquire(...input);
      },
    );
    const headlessOwner = {
      kind: "headless" as const,
      ownerId: "headless:cancel-wait-serialization" as RuntimeOwnerId,
    };
    const controller = new AbortController();
    const acquisition = facades.runtimeActions.workspaces.acquire(
      {
        cwd: workspace.cwd as AbsolutePath,
        owner: headlessOwner,
        openReason: "headless",
      },
      { signal: controller.signal },
    );
    await authoritativeAcquireStarted;
    controller.abort();
    await expect(acquisition).rejects.toMatchObject({ reason: "aborted" });

    let visualCloseSettled = false;
    const visualClose = registry.releaseWorkspace(workspace.workspaceId).finally(() => {
      visualCloseSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(visualCloseSettled).toBeFalse();

    allowAuthoritativeAcquire();
    await visualClose;
    expect(registry["externalWorkspaceOwners"].get(workspace.workspaceId)?.size).toBe(1);
    expect(registry["dormantRuntimes"].has(workspace.workspaceId)).toBeTrue();

    await facades.runtimeActions.workspaces.release({
      workspaceId: workspace.workspaceId as WorkspaceId,
      owner: headlessOwner,
      releaseReason: "headless-complete",
    });
    expect(registry["externalWorkspaceOwners"].size).toBe(0);
    expect(registry["dormantRuntimes"].size).toBe(0);
  });

  it("releases tracked non-visual owners before unregistering workspace hosts at shutdown", async () => {
    const cwd = tempWorkspace("headless-owner-app-shutdown");
    const registry = createRegistry(cwd);
    const workspace = await registry.acquireWorkspace(cwd);
    const facades = await registry.acquireDesktopAppFacades();
    const headlessOwner = {
      kind: "headless" as const,
      ownerId: "headless:app-shutdown" as RuntimeOwnerId,
    };
    await facades.runtimeActions.workspaces.acquire({
      cwd: workspace.cwd as AbsolutePath,
      owner: headlessOwner,
      openReason: "headless",
    });
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected the app runtime bootstrap to exist.");
    const bootstrap = await bootstrapPromise;
    const releases: Array<{ ownerId: string; releaseReason: string }> = [];
    const release = bootstrap.facade.workspaces.release.bind(bootstrap.facade.workspaces);
    Reflect.set(
      bootstrap.facade.workspaces,
      "release",
      async (input: Parameters<typeof release>[0]) => {
        releases.push({ ownerId: input.owner.ownerId, releaseReason: input.releaseReason });
        return release(input);
      },
    );

    await registry.shutdownApp();

    expect(releases).toEqual([
      { ownerId: headlessOwner.ownerId, releaseReason: "shutdown" },
      { ownerId: `desktop:${workspace.workspaceId}`, releaseReason: "shutdown" },
    ]);
    expect(registry["externalWorkspaceOwners"].size).toBe(0);
    expect(registry["dormantRuntimes"].size).toBe(0);
  });

  it("keeps workspace hosts registered and retries shutdown after owner release fails", async () => {
    const cwd = tempWorkspace("headless-owner-shutdown-release-retry");
    const registry = createRegistry(cwd);
    const workspace = await registry.acquireWorkspace(cwd);
    const facades = await registry.acquireDesktopAppFacades();
    const headlessOwner = {
      kind: "headless" as const,
      ownerId: "headless:shutdown-release-retry" as RuntimeOwnerId,
    };
    await facades.runtimeActions.workspaces.acquire({
      cwd: workspace.cwd as AbsolutePath,
      owner: headlessOwner,
      openReason: "headless",
    });
    const runtime = registry["runtimes"].get(workspace.workspaceId);
    if (!runtime) throw new Error("Expected the workspace runtime to exist.");
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected the app runtime bootstrap to exist.");
    const bootstrap = await bootstrapPromise;
    const release = bootstrap.facade.workspaces.release.bind(bootstrap.facade.workspaces);
    const failure = new Error("headless shutdown release failed before commit");
    let failHeadlessRelease = true;
    Reflect.set(
      bootstrap.facade.workspaces,
      "release",
      async (input: Parameters<typeof release>[0]) => {
        if (input.owner.ownerId === headlessOwner.ownerId && failHeadlessRelease) {
          failHeadlessRelease = false;
          throw failure;
        }
        return release(input);
      },
    );
    let workspaceShutdowns = 0;
    const shutdownRuntime = runtime.shutdown.bind(runtime);
    runtime.shutdown = async (appRuntime) => {
      workspaceShutdowns += 1;
      await shutdownRuntime(appRuntime);
    };
    let bootstrapDisposals = 0;
    const disposeBootstrap = bootstrap.dispose.bind(bootstrap);
    bootstrap.dispose = async (reason) => {
      bootstrapDisposals += 1;
      await disposeBootstrap(reason);
    };

    const firstShutdown = registry.shutdownApp();
    await expect(firstShutdown).rejects.toThrow(
      "Workspace runtime resources did not shut down cleanly.",
    );
    await Promise.resolve();

    expect(workspaceShutdowns).toBe(0);
    expect(bootstrapDisposals).toBe(0);
    expect(registry["appRuntimeBootstrapState"]).toBe("shutting-down");
    expect(registry["dormantRuntimes"].get(workspace.workspaceId)).toBe(runtime);
    expect(registry["externalWorkspaceOwners"].get(workspace.workspaceId)?.size).toBe(1);

    const secondShutdown = registry.shutdownApp();
    expect(secondShutdown).not.toBe(firstShutdown);
    await secondShutdown;

    expect(workspaceShutdowns).toBe(1);
    expect(bootstrapDisposals).toBe(1);
    expect(registry["appRuntimeBootstrapState"]).toBe("closed");
    expect(registry["dormantRuntimes"].size).toBe(0);
    expect(registry["externalWorkspaceOwners"].size).toBe(0);
  });

  it("creates a stable default workspace scope under the svvy app data dir", async () => {
    const initialCwd = tempWorkspace("initial-cwd");
    const agentDir = tempAgentDir();
    const appDataDir = tempWorkspace("app-data-dir");
    const registry = createRegistry(initialCwd, agentDir, { appDataDir });

    const expectedDefaultCwd = getDefaultWorkspaceCwd(appDataDir);
    const first = await registry.getDefaultWorkspace();
    const second = await registry.getDefaultWorkspace();

    expect(expectedDefaultCwd).toBe(realpathSync.native(join(appDataDir, "default-workspace")));
    expect(first.workspaceId).toBe(second.workspaceId);
    expect(first.cwd).toBe(expectedDefaultCwd);
    expect(first.kind).toBe("default");
    expect(first.getInfo()).toMatchObject({
      cwd: expectedDefaultCwd,
      workspaceLabel: "Default Workspace",
      kind: "default",
    });
    expect(first.cwd).not.toBe(realpathSync.native(initialCwd));
  });

  it("resolves workspace-scoped RPC work through the requested workspace instead of the active one", async () => {
    const firstCwd = tempWorkspace("targeted-routing-first");
    const secondCwd = tempWorkspace("targeted-routing-second");
    const registry = createRegistry(firstCwd);
    const first = await registry.acquireWorkspace(firstCwd);
    const second = await registry.acquireWorkspace(secondCwd);

    expect(registry.getActiveWorkspaceId()).toBe(second.workspaceId);

    const targeted = getWorkspaceRuntimeForRequest(registry, { workspaceId: first.workspaceId });
    const targetedOperations = getWorkspaceRuntimeOperationsForRequest(registry, {
      workspaceId: first.workspaceId,
    });
    expect(Object.hasOwn(first, "runtimeFacade")).toBeFalse();
    expect(Object.hasOwn(second, "runtimeFacade")).toBeFalse();
    expect(targetedOperations).toBe(registry.getRuntimeOperations(first.workspaceId));
    expect(targetedOperations).toBe(registry.getRuntimeOperations(second.workspaceId));
    await targeted.catalog.createSession(
      { title: "Targeted A" },
      {
        provider: "openai",
        model: "gpt-4o",
        thinkingLevel: "medium",
      },
    );

    const state = await registry.getRendererStateFacade();
    const firstNavigation = await state.readModels.fetch({
      kind: "sessionNavigation",
      workspaceId: first.workspaceId as WorkspaceId,
    });
    const secondNavigation = await state.readModels.fetch({
      kind: "sessionNavigation",
      workspaceId: second.workspaceId as WorkspaceId,
    });
    expect(firstNavigation.kind).toBe("sessionNavigation");
    expect(secondNavigation.kind).toBe("sessionNavigation");
    if (
      firstNavigation.kind !== "sessionNavigation" ||
      secondNavigation.kind !== "sessionNavigation"
    ) {
      throw new Error("Expected session navigation read models.");
    }
    expect(firstNavigation.value.activeSessions.map((session) => session.title)).toEqual([
      "Targeted A",
    ]);
    expect(secondNavigation.value.activeSessions).toEqual([]);
  });

  it("hydrates state-owned appPreferences into the store used by tool approval and network decisions", async () => {
    const cwd = tempWorkspace("state-owned-preferences");
    const stateOwnedArtifactDirectory = join(cwd, "state-owned-artifacts");
    const registry = createRegistry(cwd);
    const runtime = await registry.acquireWorkspace(cwd);

    expect(runtime.agentSettingsStore.getState().appPreferences.networkAccess).toBe(true);
    expect(runtime.agentSettingsStore.getState().appPreferences.approvalMode).toBe("auto-review");

    const stateCommands = await registry.getStateCommandsFacade();
    await stateCommands.appPreferences.update({
      patch: {
        approvalMode: "user",
        networkAccess: false,
        artifactDirectory: stateOwnedArtifactDirectory as AbsolutePath,
        externalInstructions: {
          globalRoots: [
            {
              id: "state-owned-team-docs",
              kind: "custom",
              label: "Team docs",
              path: "/tmp/state-owned-team-docs",
              enabled: true,
            },
          ],
          globalControls: {
            "/tmp/state-owned-team-docs/AGENTS.md": {
              enabled: true,
              actors: ["orchestrator", "handler"],
            },
          },
          workspaceControls: {},
        },
      },
      clientSubmission: {
        clientRequestId: "state-owned-preferences-tool-decisions" as RuntimeClientRequestId,
        source: "test" as RuntimeClientSubmissionSource,
      },
    });
    await registry.hydrateStateOwnedAppPreferencesFromStateRows();
    const statePreferences = await (
      await registry.getRendererStateFacade()
    ).readModels.fetch({
      kind: "appPreferences",
    });
    if (statePreferences.kind !== "appPreferences") {
      throw new Error("Expected appPreferences read model.");
    }

    expect(registry.getRuntime(runtime.workspaceId)).toBe(runtime);
    expect(runtime.agentSettingsStore.getState().appPreferences.approvalMode).toBe("user");
    expect(runtime.agentSettingsStore.getState().appPreferences.networkAccess).toBe(false);
    expect(runtime.agentSettingsStore.getState().appPreferences.artifactDirectory).toBe(
      stateOwnedArtifactDirectory,
    );
    expect(workspaceStateStore(runtime).getWorkspaceRecord().artifactDir).toBe(
      stateOwnedArtifactDirectory,
    );
    const laterWorkspace = await registry.acquireWorkspace(
      tempWorkspace("state-owned-preferences-later-workspace"),
    );
    expect(workspaceStateStore(laterWorkspace).getWorkspaceRecord().artifactDir).toBe(
      stateOwnedArtifactDirectory,
    );
    expect(runtime.agentSettingsStore.getState().appPreferences.externalInstructions).toMatchObject(
      {
        globalRoots: expect.arrayContaining([
          expect.objectContaining({
            id: "state-owned-team-docs",
            kind: "custom",
            label: "Team docs",
            path: "/tmp/state-owned-team-docs",
            enabled: true,
          }),
        ]),
        globalControls: {
          "/tmp/state-owned-team-docs/AGENTS.md": {
            enabled: true,
            actors: expect.arrayContaining(["orchestrator", "handler"]),
          },
        },
        workspaceControls: {},
      },
    );
    expect(runtime.agentSettingsStore.getState().appPreferences.externalInstructions).toEqual(
      statePreferences.value.externalInstructions,
    );
  });

  it("hydrates saved full-access preferences into the catalog sandbox policy source", async () => {
    const cwd = tempWorkspace("state-owned-full-access-sandbox-policy");
    const registry = createRegistry(cwd);
    const runtime = await registry.acquireWorkspace(cwd);
    const stateCommands = await registry.getStateCommandsFacade();
    await stateCommands.appPreferences.update({
      patch: {
        approvalMode: "full-access",
        networkAccess: false,
      },
      clientSubmission: {
        clientRequestId: "state-owned-full-access-sandbox-policy" as RuntimeClientRequestId,
        source: "test" as RuntimeClientSubmissionSource,
      },
    });

    await registry.hydrateStateOwnedAppPreferencesFromStateRows();

    expect(runtime.agentSettingsStore.getState().appPreferences).toMatchObject({
      approvalMode: "full-access",
      networkAccess: false,
    });
    const snapshot = await Effect.runPromise(
      runtime.catalog.getSandboxPolicySource().snapshot({
        scope: { kind: "workspace", workspaceId: runtime.workspaceId as WorkspaceId },
        commandId: "command-state-owned-full-access-policy" as CommandId,
        launchKind: "execute_typescript_runtime",
        cwd: cwd as AbsolutePath,
      }),
    );
    expect(snapshot).toMatchObject({
      sandboxMode: "omitted_full_access",
      networkPolicy: "allow",
      filesystemPolicy: { defaultAccess: "read", entries: [] },
    });
  });

  it("refreshes external-instruction watcher inputs for every open workspace", async () => {
    const cwd = tempWorkspace("external-instruction-watcher-refresh");
    const registry = createRegistry(cwd);
    const workspace = await registry.acquireWorkspace(cwd);
    const runtime = registry["runtimes"].get(workspace.workspaceId);
    if (!runtime) throw new Error("Expected the workspace runtime to exist.");
    const reasons: Array<string | undefined> = [];
    runtime.sourceInvalidationCoordinator.refreshWatchedInputs = async (reason) => {
      reasons.push(reason);
    };

    await registry.refreshExternalInstructionSourceInputs(
      "app-preferences:external-instructions-updated",
    );

    expect(reasons).toEqual(["app-preferences:external-instructions-updated"]);
  });

  it("uses state-owned root configuration without legacy path controls as scan authority", async () => {
    const cwd = tempWorkspace("external-instruction-scan-authority");
    const agentsPath = join(cwd, "AGENTS.md");
    writeFileSync(agentsPath, "# Workspace instructions\n");
    const registry = createRegistry(cwd);
    const stateCommands = await registry.getStateCommandsFacade();
    await stateCommands.appPreferences.update({
      patch: {
        externalInstructions: {
          globalRoots: [],
          globalControls: {},
          workspaceControls: {
            [cwd]: {
              [agentsPath]: { enabled: false, actors: [] },
            },
          },
        },
      },
      clientSubmission: {
        clientRequestId: "external-instruction-scan-authority" as RuntimeClientRequestId,
        source: "test" as RuntimeClientSubmissionSource,
      },
    });

    const runtime = await registry.acquireWorkspace(cwd);
    const projection = workspaceStateStore(runtime).readExternalInstructionsProjection({
      workspaceId: runtime.workspaceId as WorkspaceId,
    });

    expect(projection.sources).toHaveLength(1);
    expect(projection.sources[0]).toMatchObject({
      canonicalPath: realpathSync(agentsPath),
      defaultControl: {
        enabled: true,
        eligibleActors: ["orchestrator", "handler", "workflow-task"],
      },
    });
  });

  it("hydrates authoritative security preferences before a new workspace becomes ready", async () => {
    const initialCwd = tempWorkspace("state-owned-preferences-bootstrap");
    const nextCwd = tempWorkspace("state-owned-preferences-new-workspace");
    const registry = createRegistry(initialCwd);
    const stateCommands = await registry.getStateCommandsFacade();
    await stateCommands.appPreferences.update({
      patch: {
        approvalMode: "user",
        networkAccess: false,
      },
      clientSubmission: {
        clientRequestId: "new-workspace-security-preferences" as RuntimeClientRequestId,
        source: "test" as RuntimeClientSubmissionSource,
      },
    });

    const runtime = await registry.acquireWorkspace(nextCwd);

    expect(runtime.agentSettingsStore.getState().appPreferences.approvalMode).toBe("user");
    expect(runtime.agentSettingsStore.getState().appPreferences.networkAccess).toBe(false);
  });

  it("passes the decoded runtime layer config into workspace catalogs and runtime adapter creation", () => {
    const source = readFileSync(
      new URL("./workspace-runtime-registry.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("runtimeLayerConfig: RuntimeLayerConfig;");
    expect(source).toContain("this.options.runtimeLayerConfig");
    expect(source).toContain("getAppRuntimeBootstrap()");
    expect(source).toContain("facade.workspaces.acquire(");
    expect(source).toContain("facade.workspaces.release(");
    expect(source).toContain("sourceDebounceMs");
    expect(source).toContain("sourceMaxCoalescingLatencyMs");
    expect(source).toContain("appSourceReconcileIntervalMs");
    expect(source).toContain("workspaceSourceReconcileIntervalMs");
  });
});

function createRegistry(
  initialCwd: string,
  agentDir: string | undefined = undefined,
  options: {
    openInitialWorkspace?: boolean;
    appDataDir?: string;
    coreTypeContractPackagePath?: string;
    workflowsExtensionsGeneratedPackagePath?: string;
    workflowsGeneratedPackagePath?: string;
    workflowsSourceRoot?: string;
    packagedExtensionTemplatesRoot?: string;
    forwardBridgeLog?: ConstructorParameters<
      typeof WorkspaceRuntimeRegistry
    >[0]["forwardBridgeLog"];
  } = {},
): WorkspaceRuntimeRegistry {
  const isolatedAgentDir = agentDir ?? join(tempWorkspace("agent-root"), "agent");
  const packagedExtensionTemplatesRoot =
    options.packagedExtensionTemplatesRoot ??
    join(import.meta.dir, "../../packages/extensions/src/builtin");
  const registry = new WorkspaceRuntimeRegistry({
    initialCwd,
    agentDir: isolatedAgentDir,
    sourceWatchEnabled: false,
    runtimeLayerConfig: defaultRuntimeLayerConfig,
    sandboxHostSupport: createTestSandboxHostSupport(),
    extensionBuildProcess: successfulExtensionBuildProcessTestService,
    extensionCliRequirementProbe: {
      probe: (plan) =>
        Effect.succeed(
          plan.probeKind === "resolve-executable"
            ? ({ status: "resolved" } as const)
            : ({
                status: "completed",
                exitCode: 0,
                stdout: "registry-test-cli 1.0.0",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              } as const),
        ),
    },
    secretStore: testSecretStore,
    secretStoreMutation: testSecretStoreMutation,
    appDataDir: options.appDataDir ?? tempWorkspace("app-data"),
    packagedExtensionTemplatesRoot,
    coreTypeContractPackagePath:
      options.coreTypeContractPackagePath ?? tempWorkspace("generated-core-type-contract"),
    workflowsSourceRoot: options.workflowsSourceRoot ?? tempWorkspace("workflows-source"),
    ...options,
  });
  registries.push(registry);
  return registry;
}

const testSecretStore: SecretStorePortService = {
  getStatus: (ref) => Effect.succeed({ ref, configured: false }),
  listStatus: ({ refs }) =>
    Effect.succeed(refs.map((ref) => ({ ref, configured: false as const }))),
  resolveInvocationValue: () => Effect.die("unused registry test secret resolution"),
};

const testSecretStoreMutation: SecretStoreMutationPortService = {
  writeSecretValue: () => Effect.die("unused registry test secret write"),
  removeSecretValue: ({ ref, expectedRevisionFingerprint }) =>
    Effect.succeed({
      ref,
      removed: true,
      revisionFingerprint: expectedRevisionFingerprint ?? "registry-test-secret-revision",
    }),
};

function tempWorkspace(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `svvy-${name}-`));
  tempDirs.push(dir);
  return dir;
}

function tempAgentDir(name = "agent-root"): string {
  const agentDir = join(tempWorkspace(name), "agent");
  mkdirSync(agentDir, { recursive: true });
  return agentDir;
}

function runGit(cwd: string, args: readonly string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function workspaceStateStore(runtime: WorkspaceRuntime) {
  return runtime.catalog["workspaceStateRouterRegistration"]().store;
}

function readTurnStatus(sessionDir: string): string | null {
  const database = new Database(join(sessionDir, STRUCTURED_SESSION_DB_FILENAME), {
    readonly: true,
  });
  try {
    const row = database.query(`SELECT status FROM turn ORDER BY rowid ASC LIMIT 1`).get() as {
      status: string;
    } | null;
    return row?.status ?? null;
  } finally {
    database.close();
  }
}

async function waitFor(assertion: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(assertion()).toBe(true);
}

async function collectRuntimeEvents(
  subscriptionPromise: Promise<
    AsyncIterable<RuntimeEvent> & {
      close(): Promise<void>;
    }
  >,
): Promise<{
  events: RuntimeEvent[];
  close(): Promise<void>;
}> {
  const subscription = await subscriptionPromise;
  const events: RuntimeEvent[] = [];
  const pump = (async () => {
    for await (const event of subscription) {
      events.push(event);
    }
  })();
  return {
    events,
    close: async () => {
      await subscription.close();
      await pump.catch(() => {});
    },
  };
}

function readGeneratedPackageWorkspaceLinks(
  cwd: string,
  agentDir: string,
): Array<{
  workspace_id: string;
  package_name: string;
  status: string;
  source_command_id: string | null;
}> {
  const db = new Database(join(getSvvySessionDir(cwd, agentDir), STRUCTURED_SESSION_DB_FILENAME), {
    readonly: true,
  });
  try {
    return db
      .query(
        `SELECT workspace_id, package_name, status, source_command_id
         FROM generated_package_workspace_link
         ORDER BY package_name ASC`,
      )
      .all() as Array<{
      workspace_id: string;
      package_name: string;
      status: string;
      source_command_id: string | null;
    }>;
  } finally {
    db.close();
  }
}
