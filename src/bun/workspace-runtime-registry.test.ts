import { afterEach, describe, expect, it } from "bun:test";
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
  RuntimeEvent,
  RuntimeEventSequence,
  WorkspaceId,
} from "@svvy/core";
import { WorkspaceRuntimeRegistry } from "./workspace-runtime-registry";
import { getWorkspaceRuntimeForRequest } from "./workspace-rpc-routing";
import { getSvvySessionDir } from "./session-catalog";
import { getDefaultWorkspaceCwd } from "./workspace-context";
import type { AppLogUpdateMessage } from "../shared/workspace-contract";

const tempDirs: string[] = [];
const registries: WorkspaceRuntimeRegistry[] = [];

afterEach(async () => {
  for (const registry of registries.splice(0)) {
    for (let attempts = 0; registry.listOpenWorkspaces().length && attempts < 20; attempts += 1) {
      await Promise.all(
        registry
          .listOpenWorkspaces()
          .map((workspace) => registry.closeWorkspace(workspace.workspaceId)),
      );
    }
    await registry.closeSourceInvalidationCoordinator();
    await registry.closeRuntimeEventBus();
  }
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

  it("acquires the same cwd as one shared runtime for duplicate workspace tabs", async () => {
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

  it("does not use a visual tab id as the runtime identity", async () => {
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

  it("lists open runtimes without manufacturing visual workspace tab ids", async () => {
    const cwd = tempWorkspace("runtime-list-not-tabs");
    const registry = createRegistry(cwd);

    const runtime = await registry.acquireWorkspace(cwd);
    const [workspace] = registry.listOpenWorkspaces();
    if (!workspace) throw new Error("Expected an open workspace runtime.");

    expect(workspace).toMatchObject({
      workspaceId: runtime.workspaceId,
      cwd: runtime.cwd,
      kind: "user",
    });
    expect(Object.hasOwn(workspace, "workspaceTabId")).toBeFalse();
    expect(Object.hasOwn(workspace, "openedAt")).toBeFalse();
  });

  it("uses different stable runtime ids for different canonical cwds", async () => {
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
        .entries.filter((entry) => entry.message === "Workspace runtime opened."),
    ).toMatchObject([
      {
        seq: 1,
        source: "app.lifecycle",
        message: "Workspace runtime opened.",
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

  it("broadcasts cwd-scoped app log updates once per shared runtime", async () => {
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

  it("publishes workspace read-model invalidations through the runtime facade event stream", async () => {
    const cwd = tempWorkspace("runtime-event-app-log");
    const registry = createRegistry(cwd);
    const runtime = await registry.acquireWorkspace(cwd);
    const events = await runtime.runtimeFacade.events({
      workspaceId: runtime.workspaceId as WorkspaceId,
    });
    const iterator = events[Symbol.asyncIterator]();

    try {
      const nextEvent = iterator.next();
      runtime.appLog.info("workspace", "Runtime event test log.");

      await expect(nextEvent).resolves.toMatchObject({
        done: false,
        value: {
          type: "workspace_read_model.changed",
          workspaceId: runtime.workspaceId,
          invalidation: { model: "appLogs" },
        },
      });
    } finally {
      await iterator.return?.();
    }
  });

  it("does not expose product-state invalidation as a public source invalidation method", async () => {
    const cwd = tempWorkspace("runtime-product-state-event");
    const registry = createRegistry(cwd);
    const runtime = await registry.acquireWorkspace(cwd);

    expect(
      Reflect.has(runtime.runtimeFacade.sourceInvalidation, "productStateChanged"),
    ).toBeFalse();
  });

  it("refreshes generated @svvyx/extensions through the runtime facade package refresh", async () => {
    const cwd = tempWorkspace("runtime-generated-extensions-refresh");
    const generatedExtensionsPackagePath = tempWorkspace("generated-extensions-refresh-package");
    const registry = createRegistry(cwd, tempWorkspace("agent-dir"), {
      workflowsExtensionsGeneratedPackagePath: generatedExtensionsPackagePath,
    });
    const runtime = await registry.acquireWorkspace(cwd);
    const events = await runtime.runtimeFacade.events({
      includeAppEvents: true,
      afterSequence: 0 as RuntimeEventSequence,
    });
    const iterator = events[Symbol.asyncIterator]();

    try {
      const nextEvent = nextMatchingRuntimeEvent(
        iterator,
        (event) =>
          event.type === "app_read_model.changed" && event.invalidation.model === "extensions",
      );
      await expect(
        runtime.runtimeFacade.sourceInvalidation.refreshGeneratedPackages({
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

      const packageJson = readFileSync(
        join(generatedExtensionsPackagePath, "package.json"),
        "utf8",
      );
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

      await expect(nextEvent).resolves.toMatchObject({
        type: "app_read_model.changed",
        invalidation: { model: "extensions" },
      });
    } finally {
      await iterator.return?.();
    }
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
    const events = await runtime.runtimeFacade.events({
      includeAppEvents: true,
      afterSequence: 0 as RuntimeEventSequence,
    });
    const iterator = events[Symbol.asyncIterator]();

    try {
      const nextExtensionsEvent = nextMatchingRuntimeEvent(
        iterator,
        (event) =>
          event.type === "app_read_model.changed" && event.invalidation.model === "extensions",
        3000,
      );

      const extensionsPackageDir = join(agentParent, "extensions", "package");
      mkdirSync(extensionsPackageDir, { recursive: true });
      writeFileSync(
        join(extensionsPackageDir, "package.json"),
        JSON.stringify({ name: "svvy-extension-package-input" }),
      );
      registry.requestSourceInvalidationScan("test-extension-source-change");

      await expect(nextExtensionsEvent).resolves.toMatchObject({
        type: "app_read_model.changed",
        invalidation: { model: "extensions" },
      });
      await expect(
        nextMatchingRuntimeEvent(
          iterator,
          (event) =>
            event.type === "app_read_model.changed" &&
            event.invalidation.model === "workflowsGenerated",
          3000,
        ),
      ).resolves.toMatchObject({
        type: "app_read_model.changed",
        invalidation: { model: "workflowsGenerated" },
      });
      expect(existsSync(join(generatedExtensionsPackagePath, "package.json"))).toBe(true);
      expect(existsSync(join(generatedPackagePath, "package.json"))).toBe(true);
      await waitFor(() =>
        runtime.appLogs
          .query({ sources: ["workflow.library"] })
          .entries.some(
            (entry) => entry.message === "Source invalidation refreshed generated package.",
          ),
      );
    } finally {
      await iterator.return?.();
    }
  });

  it("opens and saves extension source edits through the production runtime facade", async () => {
    const cwd = tempWorkspace("source-edits");
    const registry = createRegistry(cwd);
    const runtime = await registry.acquireWorkspace(cwd);

    const opened = await runtime.runtimeFacade.sourceEdits.open({
      sourceKind: "builtin-extension",
      sourceId: "base-common",
    });
    const nextText = `${opened.text.trimEnd()}\n\nRuntime source edit test.\n`;

    const saved = await runtime.runtimeFacade.sourceEdits.save({
      sourceKind: "builtin-extension",
      sourceId: "base-common",
      expectedSourceVersion: opened.sourceVersion,
      text: nextText,
      saveMode: "compare-and-swap",
    });
    const reopened = await runtime.runtimeFacade.sourceEdits.open({
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

  it("records lifecycle logs when workspace runtimes open and close", async () => {
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
          (entry.message === "Workspace runtime opened." ||
            entry.message === "Workspace runtime closed."),
      );

    expect(lifecycleEntries).toMatchObject([
      {
        source: "app.lifecycle",
        message: "Workspace runtime opened.",
        details: {
          workspaceId,
          kind: "user",
          cwd: runtime.cwd,
        },
      },
      {
        source: "app.lifecycle",
        message: "Workspace runtime closed.",
        details: {
          workspaceId,
          kind: "user",
          cwd: runtime.cwd,
        },
      },
    ]);
    expect(updates.every((update) => update.workspaceId === workspaceId)).toBeTrue();
  });

  it("keeps a shared runtime alive until every acquired visual owner is released", async () => {
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

  it("creates a stable default workspace runtime under the svvy app data dir", async () => {
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
});

function createRegistry(
  initialCwd: string,
  agentDir = tempWorkspace("agent-dir"),
  options: {
    openInitialWorkspace?: boolean;
    appDataDir?: string;
    onAppLogUpdate?: ConstructorParameters<typeof WorkspaceRuntimeRegistry>[0]["onAppLogUpdate"];
    workflowsExtensionsGeneratedPackagePath?: string;
    workflowsGeneratedPackagePath?: string;
    workflowsSourceRoot?: string;
  } = {},
): WorkspaceRuntimeRegistry {
  const registry = new WorkspaceRuntimeRegistry({
    initialCwd,
    agentDir,
    sourceWatchEnabled: false,
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

async function waitFor(assertion: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(assertion()).toBe(true);
}

async function nextMatchingRuntimeEvent(
  iterator: AsyncIterator<RuntimeEvent>,
  predicate: (event: RuntimeEvent) => boolean,
  timeoutMs = 1000,
): Promise<RuntimeEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const result = await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<RuntimeEvent>>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining),
      ),
    ]);
    if (result.done) break;
    if (predicate(result.value)) return result.value;
  }
  throw new Error("Timed out waiting for matching runtime event.");
}
