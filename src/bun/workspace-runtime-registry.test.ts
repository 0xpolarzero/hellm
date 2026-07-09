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
  CommandId,
  RecoveryWorkId,
  RuntimeApprovalId,
  RuntimeClientSubmissionSource,
  RuntimeClientRequestId,
  RuntimeEvent,
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
import type { AppLogUpdateMessage } from "../shared/workspace-contract";
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
    await registry.closeSourceInvalidationCoordinator();
  }
});

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("WorkspaceRuntimeRegistry", () => {
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

  it("broadcasts cwd-scoped app log updates once per shared workspace scope", async () => {
    const cwd = tempWorkspace("shared-app-log-updates");
    const updates: Array<{ workspaceId: string; payload: AppLogUpdateMessage }> = [];
    const registry = createRegistry(cwd, tempWorkspace("agent-dir"), {
      onAppLogUpdate: (workspaceId, payload) => {
        updates.push({ workspaceId, payload });
      },
    });
    const first = await registry.acquireWorkspace(cwd);
    const second = await registry.acquireWorkspace(join(cwd, "."));

    first.appLog.error("workspace", "Shared runtime log.");

    expect(second.workspaceId).toBe(first.workspaceId);
    const workspaceUpdates = updates.filter(
      (update) => update.payload.entries[0]?.source === "workspace",
    );

    expect([...new Set(updates.map((update) => update.workspaceId))]).toEqual([first.workspaceId]);
    expect(workspaceUpdates.map((update) => update.workspaceId)).toEqual([first.workspaceId]);
    expect(
      workspaceUpdates.every(
        (update) => update.payload.entries[0]?.message === "Shared runtime log.",
      ),
    ).toBeTrue();
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

    const closePromise = registry.closeSourceInvalidationCoordinator();
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
    expect(["steering", "dispatching"]).toContain(
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
    const updates: Array<{ workspaceId: string; payload: AppLogUpdateMessage }> = [];
    const registry = createRegistry(cwd, tempWorkspace("agent-dir"), {
      onAppLogUpdate: (workspaceId, payload) => {
        updates.push({ workspaceId, payload });
      },
    });
    const runtime = await registry.acquireWorkspace(cwd);
    const workspaceId = runtime.workspaceId;

    await registry.closeWorkspace(workspaceId);

    const lifecycleEntries = updates
      .map((update) => update.payload.entries[0])
      .filter(
        (entry) =>
          entry?.source === "app.lifecycle" &&
          (entry.message === "Workspace scope opened." ||
            entry.message === "Workspace scope closed."),
      );

    expect(lifecycleEntries).toMatchObject([
      {
        source: "app.lifecycle",
        message: "Workspace scope opened.",
        details: {
          workspaceId,
          kind: "user",
          cwd: runtime.cwd,
        },
      },
      {
        source: "app.lifecycle",
        message: "Workspace scope closed.",
        details: {
          workspaceId,
          kind: "user",
          cwd: runtime.cwd,
        },
      },
    ]);
    expect(updates.every((update) => update.workspaceId === workspaceId)).toBeTrue();
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
    onAppLogUpdate?: ConstructorParameters<typeof WorkspaceRuntimeRegistry>[0]["onAppLogUpdate"];
    workflowsExtensionsGeneratedPackagePath?: string;
    workflowsGeneratedPackagePath?: string;
    workflowsSourceRoot?: string;
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
