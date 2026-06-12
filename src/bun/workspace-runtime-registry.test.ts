import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@mariozechner/pi-coding-agent";
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
    registry.closeSourceInvalidationCoordinator();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("WorkspaceRuntimeRegistry", () => {
  it("does not open the initial cwd unless startup opening is requested", () => {
    const cwd = tempWorkspace("no-startup-open");
    const registry = createRegistry(cwd);

    expect(registry.listOpenWorkspaces()).toEqual([]);
    expect(registry.getActiveWorkspaceId()).toBeNull();
  });

  it("opens the initial cwd when startup opening is requested", () => {
    const cwd = tempWorkspace("startup-open");
    const registry = createRegistry(cwd, tempWorkspace("agent-dir"), {
      openInitialWorkspace: true,
    });

    const [workspace] = registry.listOpenWorkspaces();

    expect(workspace).toBeDefined();
    if (!workspace) throw new Error("Expected startup workspace to open.");

    expect(workspace?.cwd).toBe(realpathSync.native(cwd));
    expect(registry.getActiveWorkspaceId()).toBe(workspace.workspaceId);
  });

  it("acquires the same cwd as one shared runtime for duplicate workspace tabs", () => {
    const cwd = tempWorkspace("duplicate-cwd");
    const registry = createRegistry(cwd);

    const first = registry.acquireWorkspace(cwd);
    const second = registry.acquireWorkspace(join(cwd, "."));

    expect(first.cwd).toBe(realpathSync.native(cwd));
    expect(second.cwd).toBe(first.cwd);
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(registry.listOpenWorkspaces().map((workspace) => workspace.workspaceId)).toEqual([
      first.workspaceId,
    ]);
  });

  it("does not use a visual tab id as the runtime identity", () => {
    const cwd = tempWorkspace("persisted-tab-id");
    const registry = createRegistry(cwd);

    const restored = registry.acquireWorkspace(cwd);

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

    registry.acquireWorkspace(cwd);

    const workflowsLinkPath = join(cwd, ".smithers", "node_modules", "@svvy", "workflows");
    const extensionsLinkPath = join(cwd, ".smithers", "node_modules", "@svvy", "extensions");
    await waitFor(() => existsSync(workflowsLinkPath) && existsSync(extensionsLinkPath));

    expect(lstatSync(workflowsLinkPath).isSymbolicLink()).toBe(true);
    expect(lstatSync(extensionsLinkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(workflowsLinkPath)).toBe(generatedPackagePath);
    expect(readlinkSync(extensionsLinkPath)).toBe(extensionsGeneratedPackagePath);

    const runtime = registry.getActiveRuntime();
    await waitFor(() =>
      runtime.appLogStore
        .query({ sources: ["workflow.library"] })
        .entries.some(
          (entry) => entry.message === "Workflows build/link recovery refreshed package links.",
        ),
    );
  });

  it("lists open runtimes without manufacturing visual workspace tab ids", () => {
    const cwd = tempWorkspace("runtime-list-not-tabs");
    const registry = createRegistry(cwd);

    const runtime = registry.acquireWorkspace(cwd);
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

  it("uses different stable runtime ids for different canonical cwds", () => {
    const cwd = tempWorkspace("runtime-id");
    const otherCwd = tempWorkspace("other-runtime-id");
    const registry = createRegistry(cwd);

    const restored = registry.acquireWorkspace(cwd);
    const other = registry.acquireWorkspace(otherCwd);

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

    const first = registry.acquireWorkspace(cwd);
    const firstListed = await first.catalog.listSessions();

    const second = registry.acquireWorkspace(join(cwd, "."));
    const listed = await second.catalog.listSessions();

    expect(second.workspaceId).toBe(first.workspaceId);
    expect(firstListed.sessions.map((session) => session.id)).toContain(
      sessionManager.getSessionId(),
    );
    expect(listed.sessions.map((session) => session.id)).toContain(sessionManager.getSessionId());
  });

  it("shares app logs and read models across duplicate tabs for the same cwd", () => {
    const cwd = tempWorkspace("shared-app-logs");
    const registry = createRegistry(cwd);
    const first = registry.acquireWorkspace(cwd);
    const second = registry.acquireWorkspace(join(cwd, "."));

    expect(first.appLogStore.query({ sources: ["app.lifecycle"] }).entries).toMatchObject([
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

    expect(second.appLogStore.query({ sources: ["workspace"] }).entries).toMatchObject([
      {
        source: "workspace",
        message: "First tab wrote a workspace log.",
      },
    ]);

    second.appLog.warning("workspace", "Second tab wrote another workspace log.");

    expect(
      first.appLogStore.query({ sources: ["workspace"] }).entries.map((entry) => entry.message),
    ).toEqual(["First tab wrote a workspace log.", "Second tab wrote another workspace log."]);
    expect(first.appLogStore.summary()).toEqual(second.appLogStore.summary());
    const latestSeq = first.appLogStore.summary().latestSeq;
    expect(second.appLogStore.markSeen(latestSeq).seenSeq).toBe(latestSeq);
    expect(first.appLogStore.summary().seenSeq).toBe(latestSeq);
  });

  it("broadcasts cwd-scoped app log updates once per shared runtime", () => {
    const cwd = tempWorkspace("shared-app-log-updates");
    const updates: Array<{ workspaceId: string; payload: AppLogUpdateMessage }> = [];
    const registry = createRegistry(cwd, tempWorkspace("agent-dir"), {
      onAppLogUpdate: (workspaceId, payload) => {
        updates.push({ workspaceId, payload });
      },
    });
    const first = registry.acquireWorkspace(cwd);
    const second = registry.acquireWorkspace(join(cwd, "."));

    first.appLog.error("workspace", "Shared runtime log.");

    expect(second.workspaceId).toBe(first.workspaceId);
    expect(updates.map((update) => update.workspaceId)).toEqual([
      first.workspaceId,
      first.workspaceId,
    ]);
    expect(updates[0]?.payload.entries[0]?.message).toBe("Workspace runtime opened.");
    expect(
      updates
        .slice(1)
        .every((update) => update.payload.entries[0]?.message === "Shared runtime log."),
    ).toBeTrue();
  });

  it("records lifecycle logs when workspace runtimes open and close", async () => {
    const cwd = tempWorkspace("lifecycle-app-logs");
    const updates: Array<{ workspaceId: string; payload: AppLogUpdateMessage }> = [];
    const registry = createRegistry(cwd, tempWorkspace("agent-dir"), {
      onAppLogUpdate: (workspaceId, payload) => {
        updates.push({ workspaceId, payload });
      },
    });
    const runtime = registry.acquireWorkspace(cwd);
    const workspaceId = runtime.workspaceId;

    await registry.closeWorkspace(workspaceId);

    expect(updates.map((update) => update.payload.entries[0])).toMatchObject([
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
    expect(updates.map((update) => update.workspaceId)).toEqual([workspaceId, workspaceId]);
  });

  it("emits recovery observability logs from durable startup work", async () => {
    const cwd = tempWorkspace("startup-recovery-log");
    const registry = createRegistry(cwd);
    const runtime = registry.acquireWorkspace(cwd);

    await waitFor(() =>
      runtime.appLogStore
        .query({ sources: ["app.lifecycle"] })
        .entries.some((entry) => entry.message === "Workspace recovery work projected."),
    );

    expect(
      runtime.appLogStore
        .query({ sources: ["app.lifecycle"] })
        .entries.find((entry) => entry.message === "Workspace recovery work projected."),
    ).toMatchObject({
      source: "app.lifecycle",
      details: {
        recoveryWorkKind: "app_log_projection",
        idempotencyKey: "[REDACTED]",
      },
    });
  });

  it("keeps a shared runtime alive until every acquired visual owner is released", async () => {
    const cwd = tempWorkspace("reference-counted-runtime");
    const registry = createRegistry(cwd);
    const first = registry.acquireWorkspace(cwd);
    const second = registry.acquireWorkspace(join(cwd, "."));

    expect(second.workspaceId).toBe(first.workspaceId);

    expect(await registry.releaseWorkspace(first.workspaceId)).toBe(true);
    expect(registry.getRuntime(first.workspaceId)).toBeDefined();
    expect(await registry.releaseWorkspace(second.workspaceId)).toBe(true);
    expect(() => registry.getRuntime(first.workspaceId)).toThrow("Workspace is not open");
  });

  it("creates a stable default workspace runtime under the svvy app data dir", () => {
    const initialCwd = tempWorkspace("initial-cwd");
    const agentDir = tempWorkspace("agent-dir");
    const appDataDir = tempWorkspace("app-data-dir");
    const registry = createRegistry(initialCwd, agentDir, { appDataDir });

    const expectedDefaultCwd = getDefaultWorkspaceCwd(appDataDir);
    const first = registry.getDefaultWorkspace();
    const second = registry.getDefaultWorkspace();

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
    const first = registry.acquireWorkspace(firstCwd);
    const second = registry.acquireWorkspace(secondCwd);

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
