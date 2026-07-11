import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
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
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type {
  AbsolutePath,
  CommandId,
  RecoveryWorkId,
  RuntimeApprovalId,
  RuntimeClientSubmissionSource,
  RuntimeClientRequestId,
  RuntimeEvent,
  RuntimeOwnerId,
  SubmitMessageInput,
  WorkspaceId,
} from "@svvy/core";
import { WorkspaceRuntimeRegistry, type WorkspaceRuntime } from "./workspace-runtime-registry";
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

const tempDirs: string[] = [];
const registries: WorkspaceRuntimeRegistry[] = [];
const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

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
      "rendererState",
      "rendererStateCommands",
      "runtimeActions",
      "runtimeCommands",
      "runtimeEvents",
    ]);
    expect(Object.keys(facades.runtimeActions).toSorted()).toEqual([
      "approvals",
      "messages",
      "queues",
      "requestInput",
      "sourceEdits",
      "sourceInvalidation",
      "surfaces",
      "workspaces",
    ]);
    expect("events" in facades.runtimeActions).toBeFalse();
    expect("commands" in facades.runtimeActions).toBeFalse();
    expect("close" in facades.runtimeActions).toBeFalse();
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

  it("does not open the initial cwd unless startup opening is requested", async () => {
    const cwd = tempWorkspace("no-startup-open");
    const registry = createRegistry(cwd);

    expect(registry.listOpenWorkspaces()).toEqual([]);
    expect(registry.getActiveWorkspaceId()).toBeNull();
  });

  it("opens the initial cwd when startup opening is requested", async () => {
    const cwd = tempWorkspace("startup-open");
    const registry = createRegistry(cwd, tempWorkspace("agent-dir"), {
      openInitialWorkspace: true,
    });
    await registry.ready();

    const [workspace] = registry.listOpenWorkspaces();

    expect(workspace).toBeDefined();
    if (!workspace) throw new Error("Expected startup workspace to open.");

    expect(workspace?.cwd).toBe(realpathSync.native(cwd));
    expect(registry.getActiveWorkspaceId()).toBe(workspace.workspaceId);
  });

  it("reaches app-runtime readiness before opening the initial workspace", async () => {
    const events: string[] = [];
    const registry = createRegistry(
      tempWorkspace("readiness-before-startup-open"),
      tempWorkspace("agent-dir"),
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
    const registry = createRegistry(cwd, tempWorkspace("agent-dir"), {
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
    const agentDir = tempWorkspace("agent-dir");
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
    const registry = createRegistry(cwd, tempWorkspace("agent-dir"), {
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
    const agentDir = tempWorkspace("agent-dir");
    const sessionManager = SessionManager.create(
      cwd,
      getSvvySessionDir(realpathSync.native(cwd), agentDir),
    );
    sessionManager.appendSessionInfo("Persistent Session");
    sessionManager.appendMessage({
      role: "user",
      timestamp: Date.now(),
      content: [{ type: "text", text: "Remember this session" }],
    });
    sessionManager.appendMessage({
      role: "assistant",
      timestamp: Date.now(),
      api: "openai-responses",
      content: [{ type: "text", text: "Remembered." }],
      provider: "openai",
      model: "gpt-4o",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
    });
    const registry = createRegistry(cwd, agentDir);

    const first = await registry.acquireWorkspace(cwd);
    const firstListed = await first.catalog.listSessions();

    const second = await registry.acquireWorkspace(join(cwd, "."));
    const listed = await second.catalog.listSessions();

    expect(second.workspaceId).toBe(first.workspaceId);
    expect(firstListed.sessions.map((session) => session.id)).toContain(
      sessionManager.getSessionId(),
    );
    expect(listed.sessions.map((session) => session.id)).toContain(sessionManager.getSessionId());
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
    const registry = createRegistry(cwd, tempWorkspace("agent-dir"));
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
    const registry = createRegistry(cwd, tempWorkspace("agent-dir"));
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
    const registry = createRegistry(cwd, tempWorkspace("agent-dir"), {
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
    const agentDir = tempWorkspace("generated-unopened-agent-dir");
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
    let recoverableWorkspaces: ReturnType<WorkspaceRuntimeRegistry["listOpenWorkspaces"]> = [
      unopenedInfo,
    ];
    const registry = createRegistry(ownerCwd, agentDir, {
      workflowsExtensionsGeneratedPackagePath: generatedExtensionsPackagePath,
      listRecoverableWorkspaces: () => recoverableWorkspaces,
    });
    await registry.ready();
    const ownerRuntime = await registry.acquireWorkspace(ownerCwd);
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

  it("records acquired workspace link repair status in the owning workspace store", async () => {
    const firstCwd = tempWorkspace("runtime-generated-link-owner-a");
    const secondCwd = tempWorkspace("runtime-generated-link-owner-b");
    const agentDir = tempWorkspace("generated-link-owner-agent-dir");
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
      status: "unchanged",
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
    const agentDir = tempWorkspace("runtime-events-agent-dir");
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

  it("rolls back workspace state when runtime event forwarding cannot start", async () => {
    const cwd = tempWorkspace("workspace-event-forwarder-failure");
    const registry = createRegistry(cwd);
    await registry.acquireDesktopAppFacades();
    const bootstrapPromise = registry["appRuntimeBootstrap"];
    if (!bootstrapPromise) throw new Error("Expected the app runtime bootstrap to exist.");
    const bootstrap = await bootstrapPromise;
    const baselineAppLogFacades = registry["sharedAppLogFacades"].size;
    const failure = new Error("runtime event subscription failed");
    const cleanupCalls: string[] = [];
    registry["startRuntimeEventForwarder"] = async () => {
      throw failure;
    };
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

    await expect(registry.acquireWorkspace(cwd)).rejects.toBe(failure);

    expect(cleanupCalls[0]).toBe("release:shutdown");
    expect(cleanupCalls[1]).toStartWith("unregister:");
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
    const registry = createRegistry(cwd);
    const runtime = await registry.acquireWorkspace(cwd);
    const runtimeOperations = getWorkspaceRuntimeOperationsForRequest(registry, {
      workspaceId: runtime.workspaceId,
    });

    const opened = await runtimeOperations.sourceEdits.open({
      sourceKind: "builtin-extension",
      sourceId: "base-common",
    });
    const nextText = `${opened.text.trimEnd()}\n\nRuntime source edit test.\n`;

    const saved = await runtimeOperations.sourceEdits.save({
      sourceKind: "builtin-extension",
      sourceId: "base-common",
      expectedSourceVersion: opened.sourceVersion,
      text: nextText,
      saveMode: "compare-and-swap",
    });
    const reopened = await runtimeOperations.sourceEdits.open({
      sourceKind: "builtin-extension",
      sourceId: "base-common",
    });

    expect(opened.path).toEndWith("base-common/instructions/minimal.md");
    expect(saved).toMatchObject({
      status: "saved",
      reconcileRequired: true,
      diagnostics: [],
    });
    expect(reopened.text).toBe(nextText);
    expect(reopened.sourceVersion).toBe(saved.status === "saved" ? saved.sourceVersion : "");
    expect(readFileSync(reopened.path, "utf8")).toBe(nextText);
  }, 10000);

  it("records lifecycle logs when workspace scopes open and close", async () => {
    const cwd = tempWorkspace("lifecycle-app-logs");
    const registry = createRegistry(cwd, tempWorkspace("agent-dir"));
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
    const agentDir = tempWorkspace("agent-dir");
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

    expect((await first.catalog.listSessions()).sessions.map((session) => session.title)).toEqual([
      "Targeted A",
    ]);
    expect((await second.catalog.listSessions()).sessions).toEqual([]);
  });

  it("hydrates state-owned appPreferences into the store used by tool approval and network decisions", async () => {
    const cwd = tempWorkspace("state-owned-preferences");
    const registry = createRegistry(cwd);
    const runtime = await registry.acquireWorkspace(cwd);

    expect(runtime.agentSettingsStore.getState().appPreferences.networkAccess).toBe(true);
    expect(runtime.agentSettingsStore.getState().appPreferences.approvalMode).toBe("auto-review");

    const stateCommands = await registry.getStateCommandsFacade();
    await stateCommands.appPreferences.update({
      patch: {
        approvalMode: "user",
        networkAccess: false,
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

    expect(registry.getRuntime(runtime.workspaceId)).toBe(runtime);
    expect(runtime.agentSettingsStore.getState().appPreferences.approvalMode).toBe("user");
    expect(runtime.agentSettingsStore.getState().appPreferences.networkAccess).toBe(false);
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
  agentDir = tempWorkspace("agent-dir"),
  options: {
    openInitialWorkspace?: boolean;
    appDataDir?: string;
    coreTypeContractPackagePath?: string;
    workflowsExtensionsGeneratedPackagePath?: string;
    workflowsGeneratedPackagePath?: string;
    workflowsSourceRoot?: string;
    forwardBridgeLog?: ConstructorParameters<
      typeof WorkspaceRuntimeRegistry
    >[0]["forwardBridgeLog"];
    listRecoverableWorkspaces?: ConstructorParameters<
      typeof WorkspaceRuntimeRegistry
    >[0]["listRecoverableWorkspaces"];
  } = {},
): WorkspaceRuntimeRegistry {
  const registry = new WorkspaceRuntimeRegistry({
    initialCwd,
    agentDir,
    sourceWatchEnabled: false,
    runtimeLayerConfig: defaultRuntimeLayerConfig,
    sandboxHostSupport: createTestSandboxHostSupport(),
    coreTypeContractPackagePath:
      options.coreTypeContractPackagePath ?? tempWorkspace("generated-core-type-contract"),
    workflowsSourceRoot: options.workflowsSourceRoot ?? tempWorkspace("workflows-source"),
    ...options,
  });
  registries.push(registry);
  return registry;
}

function tempWorkspace(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `svvy-${name}-`));
  tempDirs.push(dir);
  return dir;
}

function workspaceStateStore(runtime: WorkspaceRuntime) {
  return runtime.catalog["workspaceStateRouterRegistration"]().store;
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
