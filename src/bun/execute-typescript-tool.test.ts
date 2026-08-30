import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import type { PromptExecutionRuntimeHandle } from "@svvy/runtime/prompt-execution-context";
import type {
  AbsolutePath,
  BuildLaunchPolicyInput,
  SandboxLaunchFacts,
  StateContractError,
} from "@svvy/core";
import { unsafeDecodeNativeToolResultSyncForTestsAndBootstrap } from "@svvy/core";
import * as Effect from "effect/Effect";
import type { AppLoggerEvent } from "./app-logger";
import {
  runtimeArtifactStatePortFromStore,
  runtimeCommandStatePortFromStore,
  runtimeThreadStatePortFromStore,
  runtimeTurnStatePortFromStore,
} from "@svvy/state/structured-session-adapters";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "@svvy/state/structured-session-state";
import {
  createExecuteTypescriptTool as createExecuteTypescriptToolBase,
  type ExecuteTypescriptLaunchHandle,
  type ExecuteTypescriptResult,
} from "./execute-typescript-tool";
import { buildExecuteTypescriptApiDeclaration } from "./execute-typescript-api-declaration";
import type {
  AgentProfileAuthoritySnapshot,
  AgentProfileMutation,
} from "./agent-profile-mutation-store";

const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

/**
 * Unwrap a `tsFacts(NativeToolResult)` payload back into the typed
 * `ExecuteTypescriptResult` shape for assertion. The runtime wraps the result as
 * `details.commandFacts` (a `CommandFactsPayload` JSON record); tests read the
 * typed fields through this cast.
 */
function tsFacts(result: {
  readonly details?: { readonly commandFacts?: unknown } | undefined;
}): ExecuteTypescriptResult {
  return result.details?.commandFacts as ExecuteTypescriptResult;
}

function createAgentProfileSnapshot(): AgentProfileAuthoritySnapshot {
  const updatedAt = "2026-07-11T00:00:00.000Z" as never;
  return {
    configuredProfiles: [
      {
        profileId: "default-orchestrator" as never,
        actor: "orchestrator",
        name: "Default orchestrator",
        providerId: "openai" as never,
        modelId: "gpt-5.4" as never,
        reasoning: { effort: "medium" },
        followComposer: false,
        extensionUsage: {},
        extensionOrder: [],
        position: 0,
        updatedAt,
        builtin: true,
        locked: true,
        deletable: false,
      },
      {
        profileId: "thread-handler" as never,
        actor: "handler",
        name: "Thread handler",
        providerId: "openai" as never,
        modelId: "gpt-5.4-mini" as never,
        reasoning: { effort: "medium" },
        followComposer: false,
        extensionUsage: {},
        extensionOrder: [],
        position: 0,
        updatedAt,
        builtin: true,
        locked: true,
        deletable: false,
      },
    ],
    workflowAgents: [],
    actorExtensionDefaults: [
      { actor: "orchestrator", extensionUsage: {}, extensionOrder: [], updatedAt },
      { actor: "workflow-task", extensionUsage: {}, extensionOrder: [], updatedAt },
    ],
  };
}
import {
  resolveActorExtensionState,
  type ExtensionCliRequirement,
  type ExtensionRecord,
} from "@svvy/extensions";

function createExecuteTypescriptTool(
  options: Omit<
    Parameters<typeof createExecuteTypescriptToolBase>[0],
    | "artifactState"
    | "commandState"
    | "threadState"
    | "turnState"
    | "runState"
    | "workspaceId"
    | "acquireExecuteTypescriptLaunch"
  > & {
    store: StructuredSessionStateStore;
    workspaceId?: string;
    acquireExecuteTypescriptLaunch?: (
      input: Omit<BuildLaunchPolicyInput, "launchKind">,
    ) => Promise<ExecuteTypescriptLaunchHandle>;
  } & Partial<
      Pick<
        Parameters<typeof createExecuteTypescriptToolBase>[0],
        "artifactState" | "commandState" | "threadState" | "turnState" | "runState"
      >
    >,
): ReturnType<typeof createExecuteTypescriptToolBase> {
  return createExecuteTypescriptToolBase({
    ...options,
    extensionsRoot: options.extensionsRoot ?? join(options.cwd, ".test-extensions"),
    workspaceId: options.workspaceId ?? options.cwd,
    acquireExecuteTypescriptLaunch:
      options.acquireExecuteTypescriptLaunch ?? testExecuteTypescriptLaunchAcquisition,
    artifactState: options.artifactState ?? runtimeArtifactStatePortFromStore(options.store),
    commandState: options.commandState ?? runtimeCommandStatePortFromStore(options.store),
    threadState: options.threadState ?? runtimeThreadStatePortFromStore(options.store),
    turnState: options.turnState ?? runtimeTurnStatePortFromStore(options.store),
    readArtifactRootForSession:
      options.readArtifactRootForSession ??
      ((sessionId: string) => options.store.getSessionState(sessionId).workspace.artifactDir),
    runState:
      options.runState ??
      (<A>(effect: Effect.Effect<A, StateContractError>) => Effect.runSync(effect)),
  });
}

async function testExecuteTypescriptLaunchAcquisition(
  input: Omit<BuildLaunchPolicyInput, "launchKind">,
): Promise<ExecuteTypescriptLaunchHandle> {
  const facts = testExecuteTypescriptLaunchFacts(input);
  return {
    facts,
    close: async () => {},
  };
}

function testExecuteTypescriptLaunchFacts(
  input: Omit<BuildLaunchPolicyInput, "launchKind">,
): SandboxLaunchFacts {
  const [executable, ...args] = input.command;
  return {
    mode: "omitted_full_access",
    spawn: {
      executable: executable! as AbsolutePath,
      args,
      cwd: input.cwd,
      envFacts: input.envFacts,
    },
    policySnapshot: {
      snapshotId: "test-execute-typescript-snapshot",
      fingerprint: "test-execute-typescript-fingerprint",
      resolvedAt: "2026-04-18T09:00:00.000Z" as never,
      scope: input.scope,
      ...(input.surfacePiSessionId ? { surfacePiSessionId: input.surfacePiSessionId } : {}),
      commandId: input.commandId,
      launchKind: "execute_typescript_runtime",
      cwd: input.cwd,
      sandboxMode: "omitted_full_access",
      networkPolicy: "allow",
      filesystemPolicy: { defaultAccess: "read", entries: [] },
    },
  };
}

const stores: StructuredSessionStateStore[] = [];
const tempDirs: string[] = [];
afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

function createWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "svvy-execute-typescript-"));
  tempDirs.push(root);
  return root;
}

function userSvvyxExtensionRecord(
  id: string,
  overrides: Partial<ExtensionRecord> = {},
): ExtensionRecord {
  return {
    id,
    category: "user",
    interface: "svvyx",
    title: id,
    description: `${id} extension`,
    instructionSourceFiles: [],
    minimalLoadingHint: "",
    typescriptApiEnabled: true,
    envReadiness: "not_required",
    dependencyReadiness: "not_required",
    resetBehavior: "user_reset",
    deleteBehavior: "trash_allowed",
    ...overrides,
  };
}

function createUserSvvyxExtensionBuild(input: {
  extensionId: string;
  extensionsRoot: string;
  commandManifest?: Record<string, unknown>;
  moduleCode?: string;
  currentBuild?: boolean;
  env?: Array<{
    default?: string;
    description: string;
    name: string;
    required: boolean;
    secret: boolean;
  }>;
  dependencies?: Array<{
    kind: "dependency" | "trusted_dependency";
    name: string;
    version: string;
  }>;
  typesDeclaration: string;
}): void {
  const sourceRoot = join(input.extensionsRoot, "sources", "user", input.extensionId);
  const currentRoot = join(
    input.extensionsRoot,
    "builds",
    "extensions",
    input.extensionId,
    "current",
  );
  const generatedRoot = join(input.extensionsRoot, "generated", "extensions", input.extensionId);
  mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
  mkdirSync(join(sourceRoot, "instructions"), { recursive: true });
  if (input.currentBuild !== false) {
    mkdirSync(join(currentRoot, "source"), { recursive: true });
  }
  mkdirSync(generatedRoot, { recursive: true });
  // Ensure node_modules symlink so imported modules share the same module graph.
  // The runtime checks dependencies under <extensionsRoot>/package/node_modules,
  // and module imports resolve through <extensionsRoot>/node_modules.
  const repoNodeModules = join(process.cwd(), "node_modules");
  const packageRoot = join(input.extensionsRoot, "package");
  const packageNodeModulesPath = join(packageRoot, "node_modules");
  if (!existsSync(packageNodeModulesPath)) {
    mkdirSync(packageRoot, { recursive: true });
    try {
      symlinkSync(repoNodeModules, packageNodeModulesPath);
    } catch {
      // ignore if already exists
    }
  }
  const rootNodeModulesPath = join(input.extensionsRoot, "node_modules");
  if (!existsSync(rootNodeModulesPath)) {
    try {
      symlinkSync(repoNodeModules, rootNodeModulesPath);
    } catch {
      // ignore if already exists
    }
  }
  writeFileSync(join(sourceRoot, "instructions", "full", "010-main.md"), "# Main\n");
  writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "");
  writeFileSync(
    join(sourceRoot, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: input.extensionId,
        title: input.extensionId,
        description: `${input.extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [{ file: "010-main.md", bypassed: false }],
      },
      null,
      2,
    ) + "\n",
  );
  if (input.currentBuild !== false) {
    writeFileSync(
      join(currentRoot, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          extensionId: input.extensionId,
          interface: "svvyx",
          module: "source/index.js",
          commandManifest: input.commandManifest ?? defaultLinearCommandManifest(),
          typescriptTypes: join(generatedRoot, "types.d.ts"),
          env: input.env ?? [],
          dependencies: input.dependencies ?? [],
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(
      join(currentRoot, "source", "index.js"),
      input.moduleCode ??
        [
          'import { Cli, z } from "incur";',
          'const cli = Cli.create("linear");',
          'cli.command("issues.list", {',
          "  args: z.object({ issueId: z.string() }),",
          '  options: z.object({ status: z.enum(["open"]) }),',
          "  env: z.object({ LINEAR_TOKEN: z.string().optional(), LINEAR_LABEL: z.string().optional() }),",
          "  run(c) {",
          '    return { issueId: c.args.issueId, status: c.options.status, token: c.env.LINEAR_TOKEN ?? "", label: c.env.LINEAR_LABEL ?? "" };',
          "  },",
          "});",
          "export default cli;",
          "",
        ].join("\n"),
    );
  }
  writeFileSync(join(generatedRoot, "types.d.ts"), input.typesDeclaration);
}

function createUserSvvyxExtensionSource(input: {
  cliRequirements?: ExtensionCliRequirement[];
  extensionId: string;
  extensionsRoot: string;
}): void {
  const sourceRoot = join(input.extensionsRoot, "sources", "user", input.extensionId);
  mkdirSync(join(sourceRoot, "source"), { recursive: true });
  mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
  writeFileSync(
    join(sourceRoot, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: input.extensionId,
        title: input.extensionId,
        description: `${input.extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [],
        ...(input.cliRequirements ? { cliRequirements: input.cliRequirements } : {}),
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(sourceRoot, "source", "index.ts"),
    [
      'import { Cli, z } from "incur";',
      "",
      `const cli = Cli.create(${JSON.stringify(input.extensionId)});`,
      'cli.command("issues.list", {',
      "  output: z.object({ ok: z.boolean() }),",
      "  run() {",
      "    return { ok: true };",
      "  },",
      "});",
      "",
      "export default cli;",
      "",
    ].join("\n"),
  );
  writeFileSync(join(sourceRoot, "instructions", "minimal.mdx"), "");
}

function defaultLinearCommandManifest(): Record<string, unknown> {
  return {
    version: "incur.v1",
    commands: [
      {
        name: "issues.list",
        schema: {
          args: {
            type: "object",
            properties: {
              issueId: { type: "string" },
            },
            required: ["issueId"],
          },
          options: {
            type: "object",
            properties: {
              status: { enum: ["open"] },
            },
            required: ["status"],
          },
          output: {
            type: "object",
            properties: {
              argv: {
                type: "array",
                items: { type: "string" },
              },
              token: { type: "string" },
              label: { type: "string" },
            },
            required: ["argv", "token", "label"],
          },
        },
      },
    ],
  };
}

function createStore(sessionId: string, workspaceCwd: string): StructuredSessionStateStore {
  const store = createStructuredSessionStateStore({
    digest: testDigest,
    workspace: {
      id: workspaceCwd,
      label: "svvy",
      cwd: workspaceCwd,
      artifactDir: join(workspaceCwd, "artifact-store"),
    },
  });
  store.upsertPiSession({
    sessionId: sessionId,
    title: "Execute Typescript",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-04-16T10:00:00.000Z",
    updatedAt: "2026-04-16T10:00:00.000Z",
  });
  stores.push(store);
  return store;
}

function createRuntime(
  store: StructuredSessionStateStore,
  sessionId: string,
  promptText = "Inspect the repository with execute_typescript",
  loadedExtensionIds?: readonly string[],
): PromptExecutionRuntimeHandle {
  const turn = store.startTurn({
    sessionId: sessionId,
    surfacePiSessionId: sessionId,
    requestSummary: promptText,
  });

  return {
    current: {
      workspaceSessionId: sessionId,
      turnId: turn.id,
      surfacePiSessionId: sessionId,
      threadId: null,
      surfaceKind: "orchestrator",
      defaultEpisodeKind: "analysis",
      rootThreadId: null,
      rootEpisodeKind: "analysis",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
      loadedExtensionIds: loadedExtensionIds
        ? [...loadedExtensionIds]
        : [...resolveActorExtensionState({ actor: "orchestrator" }).loadedExtensionIds],
      availableExtensionIds: [],
      generatedAgentContextFingerprint: "generated_context_fingerprint_test",
      generatedAgentContextRevision: "generated_context_revision_test",
    },
  };
}

function createHandlerRuntime(
  store: StructuredSessionStateStore,
  sessionId: string,
  promptText = "Inspect the repository with handler execute_typescript",
  loadedExtensionIds?: readonly string[],
): PromptExecutionRuntimeHandle {
  const orchestratorTurn = store.startTurn({
    sessionId: sessionId,
    surfacePiSessionId: sessionId,
    requestSummary: "Delegate handler work",
  });
  const thread = store.createThread({
    turnId: orchestratorTurn.id,
    surfacePiSessionId: `${sessionId}-handler`,
    title: "Handler work",
    objective: promptText,
  });
  store.finishTurn({ turnId: orchestratorTurn.id, status: "completed" });
  const handlerTurn = store.startTurn({
    sessionId: sessionId,
    surfacePiSessionId: thread.surfacePiSessionId,
    threadId: thread.id,
    requestSummary: promptText,
  });

  return {
    current: {
      workspaceSessionId: sessionId,
      turnId: handlerTurn.id,
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      surfaceKind: "handler",
      defaultEpisodeKind: "change",
      rootThreadId: thread.id,
      rootEpisodeKind: "change",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
      loadedExtensionIds: loadedExtensionIds
        ? [...loadedExtensionIds]
        : [...resolveActorExtensionState({ actor: "handler" }).loadedExtensionIds],
      availableExtensionIds: [],
      generatedAgentContextFingerprint: "generated_context_fingerprint_test",
      generatedAgentContextRevision: "generated_context_revision_test",
    },
  };
}

describe("execute_typescript tool", () => {
  it("requires an active prompt runtime", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime: { current: null },
      store: createStore("session-no-runtime", workspaceCwd),
    });

    await expect(
      tool.execute("tool-call-1", {
        typescriptCode: "return { ok: true };",
      }),
    ).rejects.toThrow("execute_typescript can only run during an active prompt.");
  });

  it("returns structured diagnostics and persists the submitted snippet before runtime execution", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-static-failure", workspaceCwd);
    const runtime = createRuntime(store, "session-static-failure");
    const appLogEvents: AppLoggerEvent[] = [];
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      onAppLog: (event) => appLogEvents.push(event),
    });

    const result = await tool.execute("tool-call-2", {
      typescriptCode: "const title: string = 42;",
    });

    expect(tsFacts(result)).toMatchObject({
      success: false,
      error: {
        stage: "typecheck",
      },
    });

    const snapshot = store.getSessionState("session-static-failure");
    expect(snapshot.turns[0]?.turnDecision).toBe("execute_typescript");
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "execute_typescript",
        executor: "orchestrator",
        visibility: "summary",
        status: "failed",
      }),
    ]);
    expect(snapshot.artifacts.map((artifact) => artifact.name)).toEqual([
      `${snapshot.commands[0]!.id}-execute-typescript.ts`,
      `${snapshot.commands[0]!.id}-execute-typescript.diagnostics.json`,
    ]);
    const [snippetArtifact, diagnosticsArtifact] = snapshot.artifacts;
    expect(basename(snippetArtifact!.path!)).toBe(snippetArtifact!.name);
    expect(existsSync(snippetArtifact!.path!)).toBe(true);
    expect(readFileSync(snippetArtifact!.path!, "utf8")).toBe("const title: string = 42;");
    expect(existsSync(diagnosticsArtifact!.path!)).toBe(true);
    expect(
      snapshot.events.filter(
        (event) =>
          event.kind === "command.diagnostics" && event.subject.id === snapshot.commands[0]!.id,
      ),
    ).toEqual([
      expect.objectContaining({
        data: {
          source: "execute_typescript",
          stage: "typecheck",
          diagnostics: [
            expect.objectContaining({
              severity: "error",
              message: expect.stringContaining("Type 'number' is not assignable"),
              file: "execute-typescript.ts",
            }),
          ],
        },
      }),
    ]);
    expect(snapshot.episodes).toEqual([]);
    expect(appLogEvents).toEqual([
      expect.objectContaining({
        level: "info",
        source: "execute_typescript",
        message: "Execute TypeScript started.",
        details: expect.objectContaining({
          workspaceSessionId: "session-static-failure",
          surfacePiSessionId: "session-static-failure",
          commandId: snapshot.commands[0]!.id,
          artifactId: snippetArtifact!.id,
          actor: "orchestrator",
        }),
      }),
      expect.objectContaining({
        level: "warning",
        source: "execute_typescript",
        message: "Execute TypeScript blocked by static diagnostics.",
        details: expect.objectContaining({
          workspaceSessionId: "session-static-failure",
          surfacePiSessionId: "session-static-failure",
          commandId: snapshot.commands[0]!.id,
          artifactId: diagnosticsArtifact!.id,
          diagnosticsCount: 1,
          stage: "typecheck",
        }),
      }),
    ]);
  });

  it("returns a typed diagnostic when a loaded extension source cannot be resolved", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const extensionsRoot = createWorkspaceRoot();
    const store = createStore("session-missing-extension-source", workspaceCwd);
    const runtime = createRuntime(store, "session-missing-extension-source", undefined, [
      "execute-typescript",
      "missing-extension",
    ]);
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      extensionsRoot,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-missing-extension-source", {
      typescriptCode: "return { ok: true };",
    });

    expect(tsFacts(result)).toMatchObject({
      success: false,
      error: {
        stage: "typecheck",
        message: "Extension source cannot be resolved: missing-extension",
      },
    });
    const command = store.getSessionState("session-missing-extension-source").commands[0];
    expect(command).toMatchObject({
      status: "failed",
      error: "Extension source cannot be resolved: missing-extension",
    });
  });

  it("stops at the approval boundary after persisting source and before diagnostics or runtime", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-approval-denied", workspaceCwd);
    const runtime = createRuntime(store, "session-approval-denied");
    const appLogEvents: AppLoggerEvent[] = [];
    const approvalRequests: unknown[] = [];
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      onAppLog: (event) => appLogEvents.push(event),
      approvalMode: "user",
      approvalBoundary: (input) => {
        approvalRequests.push(input);
        return { approved: false, reason: "User denied Execute TypeScript." };
      },
    });

    const result = await tool.execute("tool-call-approval-denied", {
      typescriptCode: "console.log('should not run');\nconst title: string = 42;",
    });

    expect(tsFacts(result)).toEqual({
      success: false,
      error: {
        message: "User denied Execute TypeScript.",
        stage: "approval",
      },
    });
    const snapshot = store.getSessionState("session-approval-denied");
    const command = snapshot.commands[0]!;
    const snippetArtifact = snapshot.artifacts[0]!;
    expect(command).toMatchObject({
      toolName: "execute_typescript",
      status: "cancelled",
      summary: "User denied Execute TypeScript.",
      error: "User denied Execute TypeScript.",
      facts: {
        approval: "denied",
        snippetArtifactId: snippetArtifact.id,
      },
    });
    expect(snapshot.artifacts.map((artifact) => artifact.name)).toEqual([
      `${command.id}-execute-typescript.ts`,
    ]);
    expect(readFileSync(snippetArtifact.path!, "utf8")).toBe(
      "console.log('should not run');\nconst title: string = 42;",
    );
    expect(approvalRequests).toEqual([
      expect.objectContaining({
        approvalMode: "user",
        commandId: command.id,
        context: expect.objectContaining({
          actor: "orchestrator",
          sessionId: "session-approval-denied",
          surfacePiSessionId: "session-approval-denied",
        }),
        cwd: workspaceCwd,
        snippetArtifactId: snippetArtifact.id,
        toolCallId: "tool-call-approval-denied",
        toolName: "execute_typescript",
        typescriptCode: "console.log('should not run');\nconst title: string = 42;",
      }),
    ]);
    expect(appLogEvents).toEqual([
      expect.objectContaining({
        level: "info",
        source: "execute_typescript",
        message: "Execute TypeScript started.",
        details: expect.objectContaining({
          commandId: command.id,
          artifactId: snippetArtifact.id,
        }),
      }),
      expect.objectContaining({
        level: "warning",
        source: "execute_typescript",
        message: "Execute TypeScript blocked by approval boundary.",
        details: expect.objectContaining({
          commandId: command.id,
          artifactId: snippetArtifact.id,
          approval: "denied",
        }),
      }),
    ]);
  });

  it("bypasses the execute_typescript approval boundary in full-access mode", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-approval-full-access", workspaceCwd);
    const runtime = createRuntime(store, "session-approval-full-access");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      approvalMode: "full-access",
      approvalBoundary: () => {
        throw new Error("approval boundary should not run in full-access.");
      },
    });

    const result = await tool.execute("tool-call-approval-full-access", {
      typescriptCode: "return 'allowed';",
    });

    expect(tsFacts(result)).toEqual({
      success: true,
      result: "allowed",
    });
    expect(() => unsafeDecodeNativeToolResultSyncForTestsAndBootstrap(result)).not.toThrow();
  });

  it("launches approved execute_typescript with runtime-owned SandboxLaunchFacts", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-managed-runtime-seam", workspaceCwd);
    const runtime = createRuntime(store, "session-managed-runtime-seam");
    const launches: Array<{
      command: readonly string[];
      cwd: string;
    }> = [];
    const launchRequests: Array<Omit<BuildLaunchPolicyInput, "launchKind">> = [];
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      approvalMode: "user",
      approvalBoundary: () => ({ approved: true }),
      acquireExecuteTypescriptLaunch: async (input) => {
        launchRequests.push(input);
        const facts: SandboxLaunchFacts = {
          mode: "managed",
          spawn: {
            executable: process.execPath as AbsolutePath,
            args: input.command.slice(1),
            cwd: input.cwd,
            envFacts: input.envFacts,
          },
          helperPath: "/tmp/svvy-test-helper" as AbsolutePath,
          helperArgs: ["--test-helper"],
          policySnapshot: {
            snapshotId: "managed-runtime-seam-snapshot",
            fingerprint: "managed-runtime-seam-fingerprint",
            resolvedAt: "2026-04-18T09:00:00.000Z" as never,
            scope: input.scope,
            ...(input.surfacePiSessionId ? { surfacePiSessionId: input.surfacePiSessionId } : {}),
            commandId: input.commandId,
            launchKind: "execute_typescript_runtime",
            cwd: input.cwd,
            sandboxMode: "managed",
            networkPolicy: "deny",
            filesystemPolicy: {
              defaultAccess: "read",
              entries: [
                {
                  access: "write",
                  path: workspaceCwd as AbsolutePath,
                  recursive: true,
                  source: "workspace",
                },
              ],
            },
            profileDigest: "managed-runtime-seam-profile",
          },
        };
        return {
          facts,
          close: async () => {},
        };
      },
      runtimeProcessSpawner: (input) => {
        launches.push({
          command: input.command,
          cwd: input.cwd,
        });
        return spawn(input.command[0]!, input.command.slice(1), {
          cwd: input.cwd,
          env: input.env,
        });
      },
    });

    const result = await tool.execute("tool-call-managed-runtime-seam", {
      typescriptCode: "return { sandboxed: true };",
    });

    expect(tsFacts(result)).toMatchObject({
      success: true,
      result: { sandboxed: true },
    });
    expect(launchRequests).toHaveLength(1);
    expect(launchRequests[0]).toMatchObject({
      scope: { kind: "workspace", workspaceId: workspaceCwd },
      commandId: expect.any(String),
      cwd: workspaceCwd,
    });
    expect(launches).toEqual([
      expect.objectContaining({
        cwd: workspaceCwd,
      }),
    ]);
    expect(launches[0]!.command[0]).toBe(process.execPath);
    const command = store.getSessionState("session-managed-runtime-seam").commands[0]!;
    expect(command.facts).toMatchObject({
      sandboxMode: "managed",
      networkPolicy: "deny",
      policySnapshotId: "managed-runtime-seam-snapshot",
      policyFingerprint: "managed-runtime-seam-fingerprint",
      launchKind: "execute_typescript_runtime",
      commandFamily: "execute_typescript",
      profileDigest: "managed-runtime-seam-profile",
    });
  });

  it("does not leak broad parent process env into the execute_typescript runtime", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-runtime-env", workspaceCwd);
    const runtime = createRuntime(store, "session-runtime-env");
    const previous = process.env.SVVY_PARENT_ONLY_TEST_SECRET;
    process.env.SVVY_PARENT_ONLY_TEST_SECRET = "parent-only-value";
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    try {
      const result = await tool.execute("tool-call-runtime-env", {
        typescriptCode:
          "return { leaked: (globalThis as any).process?.env?.SVVY_PARENT_ONLY_TEST_SECRET ?? null };",
      });

      expect(tsFacts(result)).toEqual({
        success: true,
        result: {
          leaked: null,
        },
      });
    } finally {
      if (previous === undefined) {
        delete process.env.SVVY_PARENT_ONLY_TEST_SECRET;
      } else {
        process.env.SVVY_PARENT_ONLY_TEST_SECRET = previous;
      }
    }
  });

  it("omits broad execute_typescript helper APIs at typecheck and runtime", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-removed-apis", workspaceCwd);
    const runtime = createRuntime(store, "session-removed-apis");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    for (const property of [
      "read",
      "bash",
      "exec_command",
      "artifact_write_text",
      "web_search",
      "cx_overview",
    ]) {
      const typechecked = await tool.execute(`tool-call-${property}-typecheck`, {
        typescriptCode: `return await api.${property}({});`,
      });
      expect(tsFacts(typechecked).success).toBe(false);
      expect(tsFacts(typechecked).error?.stage).toBe("typecheck");
      expect(tsFacts(typechecked).error?.message).toContain("api");
    }

    const runtimeResult = await tool.execute("tool-call-no-global-api-runtime", {
      typescriptCode: [
        "return {",
        '  hasApi: "api" in globalThis,',
        '  hasSvvy: "svvy" in globalThis,',
        "  extensionKeys: Object.keys(extensions),",
        "};",
      ].join("\n"),
    });
    expect(tsFacts(runtimeResult)).toMatchObject({
      success: true,
      result: {
        hasApi: false,
        hasSvvy: false,
        extensionKeys: ["artifacts"],
      },
    });

    const snapshot = store.getSessionState("session-removed-apis");
    const commandNames = snapshot.commands.map((command) => command.toolName);
    expect(commandNames).toEqual(Array(commandNames.length).fill("execute_typescript"));
  });

  it("runs a typed composition with generated extensions and console only", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-success", workspaceCwd);
    const runtime = createHandlerRuntime(
      store,
      "session-success",
      "Inspect a file and persist a summary",
    );
    const appLogEvents: AppLoggerEvent[] = [];
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      onAppLog: (event) => appLogEvents.push(event),
    });

    const result = await tool.execute("tool-call-3", {
      typescriptCode: [
        "const values = [1, 2, 3];",
        "const total = values.reduce((sum, value) => sum + value, 0);",
        'console.log("total", total);',
        'console.warn("check", "warnings");',
        "return { total, extensionKeys: Object.keys(extensions) };",
      ].join("\n"),
    });

    expect(tsFacts(result)).toMatchObject({
      success: true,
      result: {
        total: 6,
        extensionKeys: ["artifacts", "workflows"],
      },
      logs: ["total 6", "[warn] check warnings"],
    });

    const snapshot = store.getSessionState("session-success");
    expect(
      snapshot.turns.find((turn) => turn.surfacePiSessionId === "session-success-handler")
        ?.turnDecision,
    ).toBe("execute_typescript");
    const [parentCommand, ...childCommands] = snapshot.commands;
    expect(parentCommand).toMatchObject({
      toolName: "execute_typescript",
      status: "succeeded",
    });
    expect(parentCommand?.arguments).toMatchObject({
      typescriptCode: [
        "const values = [1, 2, 3];",
        "const total = values.reduce((sum, value) => sum + value, 0);",
        'console.log("total", total);',
        'console.warn("check", "warnings");',
        "return { total, extensionKeys: Object.keys(extensions) };",
      ].join("\n"),
      cwd: workspaceCwd,
      launchCommand: [
        process.execPath,
        expect.stringMatching(/execute-typescript-runtime.*runtime\.js$/),
      ],
      envFacts: expect.arrayContaining([
        expect.objectContaining({ key: "PATH", redactionLabel: "execute_typescript_runtime_env" }),
      ]),
    });
    expect(parentCommand?.summary).toBe('{"total":6,"extensionKeys":["artifacts","workflows"]}');
    expect(parentCommand?.facts).toMatchObject({
      childCommandCount: 0,
      failedChildCommandCount: 0,
      logsArtifactId: expect.any(String),
      snippetArtifactId: expect.any(String),
    });
    expect(childCommands).toEqual([]);
    expect(snapshot.artifacts.map((artifact) => artifact.name)).toEqual([
      `${parentCommand!.id}-execute-typescript.ts`,
      `${parentCommand!.id}-execute-typescript.logs.log`,
    ]);
    expect(
      snapshot.events.filter(
        (event) => event.kind === "command.output" && event.subject.id === parentCommand!.id,
      ),
    ).toEqual([
      expect.objectContaining({
        data: {
          stream: "stdout",
          text: "total 6",
          source: "execute_typescript",
        },
      }),
      expect.objectContaining({
        data: {
          stream: "stderr",
          text: "[warn] check warnings",
          source: "execute_typescript",
        },
      }),
    ]);
    expect(appLogEvents).toEqual([
      expect.objectContaining({
        level: "info",
        source: "execute_typescript",
        message: "Execute TypeScript started.",
        details: expect.objectContaining({
          workspaceSessionId: "session-success",
          surfacePiSessionId: "session-success-handler",
          threadId: parentCommand!.threadId,
          commandId: parentCommand!.id,
          artifactId: snapshot.artifacts[0]!.id,
          actor: "handler",
        }),
      }),
      expect.objectContaining({
        level: "info",
        source: "execute_typescript",
        message: "Execute TypeScript finished.",
        details: expect.objectContaining({
          workspaceSessionId: "session-success",
          surfacePiSessionId: "session-success-handler",
          threadId: parentCommand!.threadId,
          commandId: parentCommand!.id,
          artifactId: snapshot.artifacts[1]!.id,
          childCommandCount: 0,
          logsCount: 2,
        }),
      }),
    ]);
  });

  it("redacts TypeScript console output, result payloads, log artifacts, and runtime errors", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-typescript-redaction", workspaceCwd);
    const runtime = createRuntime(store, "session-typescript-redaction");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const success = await tool.execute("tool-call-typescript-redaction-success", {
      typescriptCode:
        'console.log("api_key=typescript-secret");\nreturn { token: "typescript-secret", visible: "ok" };',
    });

    expect(JSON.stringify(tsFacts(success))).not.toContain("typescript-secret");
    expect(tsFacts(success)).toMatchObject({
      success: true,
      result: {
        token: "[REDACTED]",
        visible: "ok",
      },
      logs: ["api_key=[REDACTED]"],
    });
    const successSnapshot = store.getSessionState("session-typescript-redaction");
    const logsArtifact = successSnapshot.artifacts.find((artifact) =>
      artifact.name.endsWith("execute-typescript.logs.log"),
    );
    expect(logsArtifact).toBeDefined();
    expect(readFileSync(logsArtifact!.path!, "utf8")).toBe("api_key=[REDACTED]");
    const successCommand = successSnapshot.commands.at(-1);
    expect(
      successSnapshot.events.filter(
        (event) => event.kind === "command.output" && event.subject.id === successCommand!.id,
      ),
    ).toEqual([
      expect.objectContaining({
        data: {
          stream: "stdout",
          text: "api_key=[REDACTED]",
          source: "execute_typescript",
        },
      }),
    ]);

    const failure = await tool.execute("tool-call-typescript-redaction-failure", {
      typescriptCode: 'throw new Error("access_token=runtime-secret");',
    });

    expect(JSON.stringify(tsFacts(failure))).not.toContain("runtime-secret");
    expect(tsFacts(failure)).toMatchObject({
      success: false,
      error: {
        message: "access_token=[REDACTED]",
        stage: "runtime",
      },
    });
    const failureSnapshot = store.getSessionState("session-typescript-redaction");
    expect(failureSnapshot.commands.at(-1)).toMatchObject({
      toolName: "execute_typescript",
      status: "failed",
      summary: "access_token=[REDACTED]",
      error: "access_token=[REDACTED]",
    });
  });

  it("emits targeted app logs for runtime failures", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-runtime-failure", workspaceCwd);
    const runtime = createRuntime(store, "session-runtime-failure");
    const appLogEvents: AppLoggerEvent[] = [];
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      onAppLog: (event) => appLogEvents.push(event),
    });

    const result = await tool.execute("tool-call-runtime-failure", {
      typescriptCode: 'throw new Error("runtime exploded");',
    });

    expect(tsFacts(result)).toMatchObject({
      success: false,
      error: {
        stage: "runtime",
        message: "runtime exploded",
      },
    });

    const snapshot = store.getSessionState("session-runtime-failure");
    const [command] = snapshot.commands;
    const [snippetArtifact] = snapshot.artifacts;
    expect(command).toMatchObject({
      toolName: "execute_typescript",
      status: "failed",
      error: "runtime exploded",
    });
    expect(appLogEvents).toEqual([
      expect.objectContaining({
        level: "info",
        source: "execute_typescript",
        message: "Execute TypeScript started.",
        details: expect.objectContaining({
          workspaceSessionId: "session-runtime-failure",
          surfacePiSessionId: "session-runtime-failure",
          commandId: command!.id,
          artifactId: snippetArtifact!.id,
        }),
      }),
      expect.objectContaining({
        level: "error",
        source: "execute_typescript",
        message: "Execute TypeScript failed.",
        error: expect.any(Error),
        details: expect.objectContaining({
          workspaceSessionId: "session-runtime-failure",
          surfacePiSessionId: "session-runtime-failure",
          commandId: command!.id,
          artifactId: snippetArtifact!.id,
          childCommandCount: 0,
          logsCount: 0,
        }),
      }),
    ]);
  });

  it("generates extension declarations only when each extension is loaded", () => {
    expect(
      buildExecuteTypescriptApiDeclaration("orchestrator", {
        loadedExtensionIds: ["execute-typescript"],
      }),
    ).not.toContain("artifacts: ArtifactsExtensionFacade");
    expect(
      buildExecuteTypescriptApiDeclaration("orchestrator", {
        loadedExtensionIds: ["execute-typescript"],
      }),
    ).not.toContain("workflows: WorkflowsExtensionFacade");
    expect(
      buildExecuteTypescriptApiDeclaration("orchestrator", {
        loadedExtensionIds: ["artifacts", "execute-typescript"],
      }),
    ).toContain("artifacts: ArtifactsExtensionFacade");
    expect(buildExecuteTypescriptApiDeclaration("orchestrator")).not.toContain(
      "workflows: WorkflowsExtensionFacade",
    );
    expect(buildExecuteTypescriptApiDeclaration("handler")).toContain(
      "workflows: WorkflowsExtensionFacade",
    );
    const loadedBoth = buildExecuteTypescriptApiDeclaration("orchestrator", {
      loadedExtensionIds: ["artifacts", "execute-typescript", "workflows"],
    });
    expect(loadedBoth).toContain("artifacts: ArtifactsExtensionFacade");
    expect(loadedBoth).toContain("workflows: WorkflowsExtensionFacade");
    expect(loadedBoth).toContain('"models list"');
    expect(loadedBoth).not.toContain('"models.list"');
    expect(loadedBoth).not.toContain("runWorkflow");
  });

  it("generated actor execute_typescript declarations do not expose package services", () => {
    const declarations = [
      buildExecuteTypescriptApiDeclaration("orchestrator", {
        loadedExtensionIds: ["execute-typescript"],
      }),
      buildExecuteTypescriptApiDeclaration("orchestrator", {
        loadedExtensionIds: ["artifacts", "execute-typescript", "workflows"],
      }),
      buildExecuteTypescriptApiDeclaration("handler"),
      buildExecuteTypescriptApiDeclaration("workflow-task", {
        loadedExtensionIds: ["execute-typescript"],
      }),
    ];
    const forbiddenPatterns = [
      /@svvy\/(?:runtime|state|sandbox|pi-adapter|extensions)/,
      /@mariozechner\//,
      /\b(RuntimeEffectRequest|ExtensionExecutionPlan|StateInvalidationDescriptor|RuntimeQueueStatePort|RuntimeRequestStatePort|GeneratedPackageRootPort|ManagedRuntime|StateStore)\b/,
      /\bContext\.Service\b/,
      /\beffect\/Runtime\b/,
    ];

    const violations = declarations.flatMap((declaration, index) =>
      forbiddenPatterns
        .filter((pattern) => pattern.test(declaration))
        .map((pattern) => `declaration ${index} -> ${pattern}`),
    );

    expect(violations).toEqual([]);
  });

  it("omits current-build user svvyx declarations until sandboxed generated runtime facades exist", () => {
    const extensionsRoot = createWorkspaceRoot();
    createUserSvvyxExtensionBuild({
      extensionId: "linear",
      extensionsRoot,
      typesDeclaration: [
        "interface StaleLinearExtensionFacade {",
        '  run(commandId: "stale.command"): Promise<never>;',
        "}",
        "interface LoadedExtensionsFacade { staleLinear: StaleLinearExtensionFacade; }",
      ].join("\n"),
    });
    createUserSvvyxExtensionBuild({
      extensionId: "notion",
      extensionsRoot,
      typesDeclaration: "interface LoadedExtensionsFacade { notion: { run(): never } }",
    });

    const declaration = buildExecuteTypescriptApiDeclaration("orchestrator", {
      extensionsRoot,
      loadedExtensionIds: ["execute-typescript", "linear"],
      loadedExtensionRecords: [
        userSvvyxExtensionRecord("linear"),
        userSvvyxExtensionRecord("notion"),
        userSvvyxExtensionRecord("notes", { interface: "instructions" }),
        userSvvyxExtensionRecord("disabled", { typescriptApiEnabled: false }),
      ],
    });

    expect(declaration).not.toContain("linear: LinearExtensionFacade");
    expect(declaration).not.toContain('"issues.list"');
    expect(declaration).not.toContain("type LinearExtensionCommandMap");
    expect(declaration).not.toContain("args: { issueId: string }");
    expect(declaration).not.toContain("stale.command");
    expect(declaration).not.toContain("staleLinear");
    expect(declaration).not.toContain("notion:");
    expect(declaration).not.toContain("notes:");
    expect(declaration).not.toContain("disabled:");
  });

  it("omits user svvyx declarations without a matching current build", () => {
    const extensionsRoot = createWorkspaceRoot();
    const generatedRoot = join(extensionsRoot, "generated", "extensions", "linear");
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(
      join(generatedRoot, "types.d.ts"),
      "interface LoadedExtensionsFacade { linear: { run(): never } }",
    );

    expect(
      buildExecuteTypescriptApiDeclaration("orchestrator", {
        extensionsRoot,
        loadedExtensionIds: ["execute-typescript", "linear"],
        loadedExtensionRecords: [userSvvyxExtensionRecord("linear")],
      }),
    ).not.toContain("linear");
  });

  it("omits user svvyx declarations when current command manifests have malformed nested fields", () => {
    const extensionsRoot = createWorkspaceRoot();
    const malformedManifests: Record<string, unknown>[] = [
      {
        version: "incur.v1",
        commands: [{ name: "issues.list", aliases: "list" }],
      },
      {
        version: "incur.v1",
        commands: [{ name: "issues.list", examples: [{ description: "missing command" }] }],
      },
      {
        version: "incur.v1",
        commands: [{ name: "issues.list", schema: { args: "issueId" } }],
      },
      {
        version: "incur.v1",
        commands: [{ name: "issues.list" }, { name: "issues.list" }],
      },
    ];
    for (const [index, commandManifest] of malformedManifests.entries()) {
      createUserSvvyxExtensionBuild({
        extensionId: `linear-${index}`,
        extensionsRoot,
        commandManifest,
        typesDeclaration: "interface LoadedExtensionsFacade { staleLinear: { run(): never } }",
      });
    }

    const declaration = buildExecuteTypescriptApiDeclaration("orchestrator", {
      extensionsRoot,
      loadedExtensionIds: [
        "execute-typescript",
        ...malformedManifests.map((_, index) => `linear-${index}`),
      ],
      loadedExtensionRecords: malformedManifests.map((_, index) =>
        userSvvyxExtensionRecord(`linear-${index}`),
      ),
    });

    expect(declaration).not.toContain("staleLinear");
    expect(declaration).not.toContain("linear-");
  });

  it("does not read generated declarations for malformed user extension ids", () => {
    const extensionsRoot = createWorkspaceRoot();
    const escapedCurrentRoot = join(extensionsRoot, "builds", "linear", "current");
    const escapedGeneratedRoot = join(extensionsRoot, "generated", "linear");
    mkdirSync(escapedCurrentRoot, { recursive: true });
    mkdirSync(escapedGeneratedRoot, { recursive: true });
    writeFileSync(
      join(escapedCurrentRoot, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          extensionId: "../linear",
          interface: "svvyx",
          module: "source/index.js",
          commandManifest: {
            version: "incur.v1",
            commands: [{ name: "issues.list" }],
          },
          env: [],
          dependencies: [],
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(
      join(escapedGeneratedRoot, "types.d.ts"),
      "interface LoadedExtensionsFacade { escaped: { run(): never } }",
    );

    expect(
      buildExecuteTypescriptApiDeclaration("orchestrator", {
        extensionsRoot,
        loadedExtensionIds: ["execute-typescript", "../linear"],
        loadedExtensionRecords: [userSvvyxExtensionRecord("../linear")],
      }),
    ).not.toContain("escaped");
  });

  it("rejects loaded user svvyx generated declaration access until sandboxed clients exist", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const extensionsRoot = createWorkspaceRoot();
    createUserSvvyxExtensionBuild({
      extensionId: "linear",
      extensionsRoot,
      typesDeclaration: [
        "interface LinearExtensionFacade {",
        '  run(commandId: "issues.list", input: { options: { status: "open" } }): Promise<{ ok: true; data: { id: string }[] }>;',
        "}",
        "interface LoadedExtensionsFacade {",
        "  linear: LinearExtensionFacade;",
        "}",
      ].join("\n"),
    });
    const store = createStore("session-user-svvyx-types", workspaceCwd);
    const runtime = createRuntime(store, "session-user-svvyx-types", undefined, [
      "execute-typescript",
      "linear",
    ]);
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      extensionsRoot,
    });

    const result = await tool.execute("tool-call-user-svvyx-types", {
      typescriptCode: [
        "type LinearRun = typeof extensions.linear.run;",
        'const commandId: Parameters<LinearRun>[0] = "issues.list";',
        "return commandId;",
      ].join("\n"),
    });

    expect(tsFacts(result).success).toBe(false);
    expect(tsFacts(result).error?.stage).toBe("typecheck");
    expect(tsFacts(result).error?.message).toContain("linear");
  });

  it("rejects user svvyx generated declaration access when the extension is not loaded", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const extensionsRoot = createWorkspaceRoot();
    createUserSvvyxExtensionBuild({
      extensionId: "linear",
      extensionsRoot,
      typesDeclaration: [
        "interface LinearExtensionFacade {",
        '  run(commandId: "issues.list", input: { options: { status: "open" } }): Promise<{ ok: true; data: { id: string }[] }>;',
        "}",
        "interface LoadedExtensionsFacade {",
        "  linear: LinearExtensionFacade;",
        "}",
      ].join("\n"),
    });
    const store = createStore("session-user-svvyx-unloaded-types", workspaceCwd);
    const runtime = createRuntime(store, "session-user-svvyx-unloaded-types", undefined, [
      "execute-typescript",
    ]);
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      extensionsRoot,
    });

    const result = await tool.execute("tool-call-user-svvyx-unloaded-types", {
      typescriptCode: [
        "type LinearRun = typeof extensions.linear.run;",
        'const commandId: Parameters<LinearRun>[0] = "issues.list";',
        "return commandId;",
      ].join("\n"),
    });

    expect(tsFacts(result).success).toBe(false);
    expect(tsFacts(result).error?.stage).toBe("typecheck");
    expect(tsFacts(result).error?.message).toContain("linear");
  });

  it("runs the generated Artifacts client and links created artifacts to child commands", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-artifact-client", workspaceCwd);
    const runtime = createRuntime(store, "session-artifact-client");
    const appLogEvents: AppLoggerEvent[] = [];
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      onAppLog: (event) => appLogEvents.push(event),
    });

    const result = await tool.execute("tool-call-artifact-create", {
      typescriptCode: [
        'const created = await extensions.artifacts.run("create", { options: { name: "plan.md" } });',
        "return {",
        "  ok: created.ok,",
        "  id: created.data.id,",
        "  name: created.data.name,",
        "  factArtifactId: created.meta.commandFacts.artifactId,",
        "};",
      ].join("\n"),
    });

    expect(tsFacts(result)).toMatchObject({
      success: true,
      result: {
        ok: true,
        name: "plan.md",
      },
    });
    const returned = tsFacts(result).result as { id: string; factArtifactId: string };
    expect(returned.factArtifactId).toBe(returned.id);

    const snapshot = store.getSessionState("session-artifact-client");
    const parentCommand = snapshot.commands.find(
      (command) => command.toolName === "execute_typescript",
    );
    const childCommand = snapshot.commands.find(
      (command) => command.toolName === "extensions.artifacts.run",
    );
    expect(parentCommand).toMatchObject({
      status: "succeeded",
      facts: {
        childCommandCount: 1,
        failedChildCommandCount: 0,
      },
    });
    expect(childCommand).toMatchObject({
      parentCommandId: parentCommand?.id,
      status: "succeeded",
      visibility: "summary",
      facts: {
        artifactId: returned.id,
        artifactName: "plan.md",
      },
    });
    const artifact = snapshot.artifacts.find((entry) => entry.id === returned.id);
    expect(artifact).toMatchObject({
      name: "plan.md",
      sourceCommandId: childCommand?.id,
    });
    expect(appLogEvents).toContainEqual(
      expect.objectContaining({
        level: "info",
        source: "artifact",
        message: "Artifact Create succeeded.",
        details: expect.objectContaining({
          workspaceSessionId: "session-artifact-client",
          surfacePiSessionId: "session-artifact-client",
          commandId: childCommand!.id,
          artifactId: returned.id,
          artifactCommandId: "create",
          artifactName: "plan.md",
        }),
      }),
    );
  });

  it("supports bracket access for generated Artifacts clients", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-artifact-bracket", workspaceCwd);
    const runtime = createRuntime(store, "session-artifact-bracket");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-artifact-bracket", {
      typescriptCode: [
        'const created = await extensions["artifacts"].run("create", { options: { name: "bracket.md" } });',
        'const inspected = await extensions["artifacts"].run("inspect", { options: { id: created.data.id } });',
        "return { name: inspected.data.name, inspectedVisibility: inspected.meta.commandFacts.artifactName };",
      ].join("\n"),
    });

    expect(tsFacts(result)).toMatchObject({
      success: true,
      result: {
        name: "bracket.md",
        inspectedVisibility: "bracket.md",
      },
    });
    const snapshot = store.getSessionState("session-artifact-bracket");
    expect(
      snapshot.commands.filter((command) => command.toolName === "extensions.artifacts.run"),
    ).toHaveLength(2);
    expect(
      snapshot.commands.find(
        (command) =>
          command.toolName === "extensions.artifacts.run" && command.facts?.commandId === "inspect",
      )?.visibility,
    ).toBe("trace");
  });

  it("omits unloaded generated Artifacts clients from typechecking and runtime", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-artifact-unloaded", workspaceCwd);
    const runtime = createRuntime(store, "session-artifact-unloaded", "Run without Artifacts", [
      "execute-typescript",
    ]);
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-artifact-unloaded", {
      typescriptCode:
        'return await extensions.artifacts.run("create", { options: { name: "blocked.md" } });',
    });

    expect(tsFacts(result).success).toBe(false);
    expect(tsFacts(result).error?.stage).toBe("typecheck");
    expect(tsFacts(result).error?.message).toContain("artifacts");
    const snapshot = store.getSessionState("session-artifact-unloaded");
    expect(snapshot.commands.map((command) => command.toolName)).toEqual(["execute_typescript"]);
  });

  it("runs generated Workflows list, models list, and save clients as child commands", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const otherWorkspaceCwd = createWorkspaceRoot();
    mkdirSync(join(workspaceCwd, ".smithers", "prompts"), { recursive: true });
    mkdirSync(join(otherWorkspaceCwd, ".smithers"), { recursive: true });
    writeFileSync(
      join(workspaceCwd, ".smithers", "prompts", "review-prompt.mdx"),
      "# Review prompt\n\nCheck the work.\n",
    );
    const workflowsSourceRoot = join(workspaceCwd, "app-workflows-source");
    const workflowsGeneratedPackagePath = join(workspaceCwd, "generated-workflows-package");
    const generatedPackageEvents: Array<{
      reason: "svvyx-workflows-build" | "svvyx-workflows-save";
      commandFacts: Record<string, unknown>;
    }> = [];
    const appLogEvents: AppLoggerEvent[] = [];
    const store = createStore("session-workflows-client", workspaceCwd);
    const runtime = createHandlerRuntime(store, "session-workflows-client");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      onAppLog: (event) => appLogEvents.push(event),
      onWorkflowsGeneratedPackageChanged: (event) => {
        generatedPackageEvents.push(event);
      },
      requestWorkflowsRuntime: async () => {
        mkdirSync(join(workflowsGeneratedPackagePath, "prompts"), { recursive: true });
        writeFileSync(
          join(workflowsGeneratedPackagePath, "prompts", "ReviewPrompt.ts"),
          'export const ReviewPrompt = "# Review prompt";\n',
        );
        return {
          output: { ok: true, generatedPackagePath: workflowsGeneratedPackagePath },
          commandFacts: { workflowBuildOk: true, workflowExportCount: 1 },
        };
      },
      workflowsGeneratedPackagePath,
      workflowsModelCatalog: () => [
        {
          providerId: "openai",
          modelId: "gpt-5.4",
          providerAuthenticated: true,
          authSource: "apikey",
          supportedReasoning: ["low", "medium", "high"],
          capabilities: {
            reasoning: true,
            vision: true,
            toolCalling: true,
          },
        },
      ],
      workflowsSourceRoot,
    });

    const result = await tool.execute("tool-call-workflows-client", {
      typescriptCode: [
        'const models = await extensions.workflows.run("models list", { options: {} });',
        'const saved = await extensions.workflows.run("save", {',
        "  options: {",
        '    from: ".smithers/prompts/review-prompt.mdx",',
        '    kind: "prompt",',
        '    as: "ReviewPrompt",',
        "  },",
        "});",
        'const listed = await extensions.workflows.run("list", { options: { kind: "prompt" } });',
        "return {",
        "  extensionKeys: Object.keys(extensions).sort(),",
        "  modelCount: models.data.items.length,",
        "  providerCount: models.meta.commandFacts.workflowProviderCount,",
        "  savedKind: saved.data.kind,",
        "  savedExportName: saved.data.exportName,",
        "  hasLinkedWorkspaces: Object.hasOwn(saved.data, 'linkedWorkspaces'),",
        "  listed: listed.data.items.map((item) => item.qualifiedName),",
        "};",
      ].join("\n"),
    });

    expect(tsFacts(result)).toMatchObject({
      success: true,
      result: {
        extensionKeys: ["artifacts", "workflows"],
        modelCount: 1,
        providerCount: 1,
        savedKind: "prompt",
        savedExportName: "ReviewPrompt",
        hasLinkedWorkspaces: false,
        listed: ["Prompts.ReviewPrompt"],
      },
    });
    expect(existsSync(join(workflowsSourceRoot, "prompts", "ReviewPrompt.mdx"))).toBe(true);
    expect(existsSync(join(workflowsGeneratedPackagePath, "prompts", "ReviewPrompt.ts"))).toBe(
      true,
    );
    expect(existsSync(join(workspaceCwd, ".smithers", "node_modules", "@svvyx", "workflows"))).toBe(
      false,
    );
    expect(
      existsSync(join(otherWorkspaceCwd, ".smithers", "node_modules", "@svvyx", "workflows")),
    ).toBe(false);
    expect(generatedPackageEvents).toHaveLength(1);
    expect(generatedPackageEvents[0]).toMatchObject({
      reason: "svvyx-workflows-save",
      commandFacts: {
        workflowSavedExportName: "ReviewPrompt",
        workflowSavedKind: "prompt",
        workflowBuildOk: true,
      },
    });

    const snapshot = store.getSessionState("session-workflows-client");
    const parentCommand = snapshot.commands.find(
      (command) => command.toolName === "execute_typescript",
    );
    expect(parentCommand?.facts).toMatchObject({
      childCommandCount: 3,
      failedChildCommandCount: 0,
    });
    const workflowCommands = snapshot.commands.filter(
      (command) => command.toolName === "extensions.workflows.run",
    );
    expect(workflowCommands.map((command) => command.facts?.commandId)).toEqual([
      "models list",
      "save",
      "list",
    ]);
    expect(workflowCommands.map((command) => command.arguments)).toEqual([
      {
        commandId: "models list",
        input: {
          options: {},
        },
      },
      {
        commandId: "save",
        input: {
          options: {
            as: "ReviewPrompt",
            from: ".smithers/prompts/review-prompt.mdx",
            kind: "prompt",
          },
        },
      },
      {
        commandId: "list",
        input: {
          options: {
            kind: "prompt",
          },
        },
      },
    ]);
    expect(workflowCommands.map((command) => command.visibility)).toEqual([
      "trace",
      "summary",
      "trace",
    ]);
    expect(workflowCommands[0]?.facts).toMatchObject({
      extensionId: "workflows",
      workflowModelChoiceCount: 1,
      workflowProviderCount: 1,
    });
    expect(workflowCommands[1]?.facts).toMatchObject({
      extensionId: "workflows",
      workflowSavedExportName: "ReviewPrompt",
      workflowSavedKind: "prompt",
    });
    expect(workflowCommands[2]?.facts).toMatchObject({
      extensionId: "workflows",
      workflowExportCount: 1,
      workflowExportKind: "prompt",
    });
    expect(appLogEvents).toContainEqual(
      expect.objectContaining({
        level: "info",
        source: "workflow.library",
        message: "Workflows build validation passed.",
        details: expect.objectContaining({
          workspaceSessionId: "session-workflows-client",
          surfacePiSessionId: "session-workflows-client-handler",
          threadId: workflowCommands[1]!.threadId,
          commandId: workflowCommands[1]!.id,
          command: expect.stringContaining("svvyx workflows save"),
          workflowBuildOk: true,
          workflowSavedExportName: "ReviewPrompt",
          workflowSavedKind: "prompt",
        }),
      }),
    );
  });

  it("routes generated Workflows agent saves through parent runtime source intent", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const workflowsSourceRoot = join(workspaceCwd, "app-workflows-source");
    const authoringRoot = join(workspaceCwd, ".smithers", "workflows");
    mkdirSync(authoringRoot, { recursive: true });
    writeFileSync(
      join(authoringRoot, "reviewer.ts"),
      [
        "export const reviewerSource = Agents.defineTaskAgent({",
        '  id: "sourceReviewer",',
        '  label: "Reviewer",',
        '  provider: "openai",',
        '  model: "gpt-5.4",',
        '  reasoning: { effort: "medium" },',
        '  instructions: "Review strictly.",',
        '  overrides: { shell: "loaded" },',
        "});",
      ].join("\n"),
    );
    const appliedMutations: AgentProfileMutation[] = [];
    const parentOrder: string[] = [];
    const store = createStore("session-workflows-agent-save", workspaceCwd);
    const runtime = createHandlerRuntime(store, "session-workflows-agent-save");
    const tool = createExecuteTypescriptTool({
      agentProfileSnapshot: createAgentProfileSnapshot(),
      applyAgentProfileMutations: async (mutations) => {
        appliedMutations.push(...structuredClone(mutations));
        parentOrder.push("mutation-committed");
      },
      requestWorkflowsRuntime: async () => {
        expect(appliedMutations).toHaveLength(1);
        parentOrder.push("runtime-build-committed");
        return {
          output: { ok: true },
          commandFacts: { workflowBuildOk: true, workflowExportCount: 1 },
        };
      },
      cwd: workspaceCwd,
      runtime,
      store,
      workflowsSourceRoot,
    });

    const result = await tool.execute("tool-call-workflows-agent-save", {
      typescriptCode: [
        'const saved = await extensions.workflows.run("save", {',
        "  options: {",
        '    from: ".smithers/workflows/reviewer.ts",',
        '    kind: "agent",',
        '    export: "reviewerSource",',
        '    as: "reviewerAgent",',
        "  },",
        "});",
        "return { kind: saved.data.kind, exportName: saved.data.exportName };",
      ].join("\n"),
    });

    expect(tsFacts(result)).toMatchObject({
      success: true,
      result: { kind: "agent", exportName: "reviewerAgent" },
    });
    expect(existsSync(join(workflowsSourceRoot, "agents", "reviewerAgent.agent.json"))).toBe(false);
    expect(appliedMutations).toHaveLength(1);
    expect(parentOrder).toEqual(["mutation-committed", "runtime-build-committed"]);
    expect(appliedMutations[0]).toMatchObject({
      kind: "workflow-agent-source.upsert",
      sourceId: "reviewerAgent",
      overwrite: false,
      draft: {
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        instructions: "Review strictly.",
        overrides: { shell: "loaded" },
        extensionOrder: [],
      },
    });
    expect(
      store
        .getSessionState("session-workflows-agent-save")
        .commands.find((command) => command.toolName === "extensions.workflows.run")?.status,
    ).toBe("succeeded");
  });

  it("requires an explicit Runtime extension build through the Workflows generated runtime facade", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const workflowsSourceRoot = join(workspaceCwd, "app-workflows-source");
    const workflowsGeneratedPackagePath = join(workspaceCwd, "generated-workflows-package");
    const workflowsExtensionsGeneratedPackagePath = join(
      workspaceCwd,
      "generated-extensions-package",
    );
    const extensionsRoot = join(workspaceCwd, "extensions");
    const appLogEvents: AppLoggerEvent[] = [];
    mkdirSync(join(workflowsSourceRoot, "agents"), { recursive: true });
    createUserSvvyxExtensionSource({
      cliRequirements: [
        {
          id: "needs-cli",
          binary: "needs-cli",
          package: "needs-cli",
          required: true,
          version: "1.2.3",
          installCommand: "npm install -g needs-cli@1.2.3",
        },
      ],
      extensionId: "needs-cli",
      extensionsRoot,
    });
    writeFileSync(
      join(workflowsSourceRoot, "agents", "reviewerAgent.agent.json"),
      JSON.stringify(
        {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: "Review CLI-gated extension references.",
          extensions: ["needs-cli", "missing-workflow-extension"],
        },
        null,
        2,
      ) + "\n",
    );

    const store = createStore("session-workflows-client-cli-prebuild", workspaceCwd);
    const runtime = createHandlerRuntime(store, "session-workflows-client-cli-prebuild");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      extensionsRoot,
      onAppLog: (event) => appLogEvents.push(event),
      requestWorkflowsRuntime: async () => ({
        output: {
          ok: false,
          error: {
            code: "build_failed",
            message: "Workflows build failed.",
            diagnostics: [
              {
                code: "extension_build_required",
                message: "Extension needs-cli must have a current successful build.",
              },
            ],
          },
        },
        commandFacts: { workflowBuildOk: false, workflowDiagnosticCount: 1 },
      }),
      workflowsExtensionsGeneratedPackagePath,
      workflowsGeneratedPackagePath,
      workflowsModelCatalog: () => [
        {
          providerId: "openai",
          modelId: "gpt-5.4",
          providerAuthenticated: true,
          authSource: "apikey",
          supportedReasoning: ["low", "medium", "high"],
          capabilities: {
            reasoning: true,
            vision: true,
            toolCalling: true,
          },
        },
      ],
      workflowsSourceRoot,
    });

    const result = await tool.execute("tool-call-workflows-client-cli-prebuild", {
      typescriptCode: [
        'import { Client } from "incur/client";',
        "try {",
        '  await extensions.workflows.run("build", { options: {} });',
        "} catch (error) {",
        "  return {",
        "    clientError: error instanceof Client.ClientError,",
        "    message: error instanceof Error ? error.message : String(error),",
        "  };",
        "}",
        "return { clientError: false };",
      ].join("\n"),
    });

    expect(tsFacts(result)).toMatchObject({
      success: true,
      result: {
        clientError: true,
        message: "Workflows build failed.",
      },
    });
    expect(existsSync(workflowsGeneratedPackagePath)).toBe(false);
    expect(existsSync(workflowsExtensionsGeneratedPackagePath)).toBe(false);

    const snapshot = store.getSessionState("session-workflows-client-cli-prebuild");
    expect(
      snapshot.commands.find((command) => command.toolName === "execute_typescript")?.facts,
    ).toMatchObject({
      childCommandCount: 1,
      failedChildCommandCount: 1,
    });
    const workflowCommand = snapshot.commands.find(
      (command) => command.toolName === "extensions.workflows.run",
    );
    expect(workflowCommand).toMatchObject({
      status: "failed",
      facts: {
        extensionId: "workflows",
        commandId: "build",
        errorCode: "build_failed",
      },
    });
    expect(workflowCommand?.error).toContain(
      "Extension needs-cli must have a current successful build",
    );
    expect(workflowCommand?.error).not.toContain("missing-workflow-extension");
    expect(appLogEvents).toContainEqual(
      expect.objectContaining({
        level: "warning",
        source: "workflow.library",
        message: "Workflows build validation failed.",
        details: expect.objectContaining({
          command: "svvyx workflows build --json",
          errorCode: "build_failed",
          workflowDiagnosticCount: 1,
        }),
      }),
    );
  });

  it("rejects generated Workflows save sources outside workspace .smithers", async () => {
    const workspaceCwd = createWorkspaceRoot();
    writeFileSync(join(workspaceCwd, "outside-prompt.mdx"), "# Outside\n");
    const workflowsSourceRoot = join(workspaceCwd, "app-workflows-source");
    const workflowsGeneratedPackagePath = join(workspaceCwd, "generated-workflows-package");
    const appLogEvents: AppLoggerEvent[] = [];
    const store = createStore("session-workflows-client-outside-source", workspaceCwd);
    const runtime = createHandlerRuntime(store, "session-workflows-client-outside-source");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      onAppLog: (event) => appLogEvents.push(event),
      workflowsGeneratedPackagePath,
      workflowsSourceRoot,
    });

    const result = await tool.execute("tool-call-workflows-client-outside-source", {
      typescriptCode: [
        'return await extensions.workflows.run("save", {',
        "  options: {",
        '    from: "outside-prompt.mdx",',
        '    kind: "prompt",',
        '    as: "OutsidePrompt",',
        "  },",
        "});",
      ].join("\n"),
    });

    expect(tsFacts(result).success).toBe(false);
    expect(tsFacts(result).error?.message).toContain("workspace .smithers source file");
    expect(existsSync(join(workflowsSourceRoot, "prompts", "OutsidePrompt.mdx"))).toBe(false);
    expect(existsSync(join(workflowsGeneratedPackagePath, "prompts", "OutsidePrompt.ts"))).toBe(
      false,
    );

    const snapshot = store.getSessionState("session-workflows-client-outside-source");
    const parentCommand = snapshot.commands.find(
      (command) => command.toolName === "execute_typescript",
    );
    expect(parentCommand?.facts).toMatchObject({
      childCommandCount: 1,
      failedChildCommandCount: 1,
    });
    const workflowCommand = snapshot.commands.find(
      (command) => command.toolName === "extensions.workflows.run",
    );
    expect(workflowCommand?.facts).toMatchObject({
      extensionId: "workflows",
      commandId: "save",
      errorCode: "invalid_source",
    });
    expect(appLogEvents).toContainEqual(
      expect.objectContaining({
        level: "warning",
        source: "workflow.library",
        message: "Workflows build validation failed.",
        details: expect.objectContaining({
          workspaceSessionId: "session-workflows-client-outside-source",
          surfacePiSessionId: "session-workflows-client-outside-source-handler",
          threadId: workflowCommand!.threadId,
          commandId: workflowCommand!.id,
          command: expect.stringContaining("svvyx workflows save"),
          errorCode: "invalid_source",
          workflowDiagnosticCount: 1,
        }),
      }),
    );
  });

  it("omits Workflows from orchestrator defaults and exposes it to handler defaults", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const orchestratorStore = createStore("session-workflows-orchestrator-default", workspaceCwd);
    const orchestratorRuntime = createRuntime(
      orchestratorStore,
      "session-workflows-orchestrator-default",
    );
    const orchestratorTool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime: orchestratorRuntime,
      store: orchestratorStore,
    });

    const orchestratorResult = await orchestratorTool.execute("tool-call-workflows-orchestrator", {
      typescriptCode: "return Object.keys(extensions).sort();",
    });

    expect(tsFacts(orchestratorResult)).toMatchObject({
      success: true,
      result: ["artifacts"],
    });

    const handlerStore = createStore("session-workflows-handler-default", workspaceCwd);
    const handlerRuntime = createHandlerRuntime(handlerStore, "session-workflows-handler-default");
    const handlerTool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime: handlerRuntime,
      store: handlerStore,
    });

    const handlerResult = await handlerTool.execute("tool-call-workflows-handler", {
      typescriptCode: "return Object.keys(extensions).sort();",
    });

    expect(tsFacts(handlerResult)).toMatchObject({
      success: true,
      result: ["artifacts", "workflows"],
    });
  });

  it("keeps removed Workflows runner commands unavailable through generated runtime facades", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const removedCommandIds = [
      "run",
      "resume",
      "approve",
      "inspect",
      "debug",
      "install",
      "retrieve",
      "promote",
      "agents list",
      "prompts list",
      "components list",
      "workflows list",
      "models.list",
    ];

    for (const commandId of removedCommandIds) {
      const sessionId = `session-workflows-removed-${commandId.replaceAll(/\W/g, "-")}`;
      const store = createStore(sessionId, workspaceCwd);
      const runtime = createHandlerRuntime(store, sessionId);
      const tool = createExecuteTypescriptTool({
        cwd: workspaceCwd,
        runtime,
        store,
      });

      const result = await tool.execute(`tool-call-workflows-removed-${commandId}`, {
        typescriptCode: `await extensions.workflows.run(${JSON.stringify(commandId)}, { options: {} });`,
      });

      expect(tsFacts(result).success).toBe(false);
      expect(tsFacts(result).error?.stage).toBe("typecheck");
      expect(tsFacts(result).error?.message).toContain(JSON.stringify(commandId));
      const snapshot = store.getSessionState(sessionId);
      expect(snapshot.commands.map((command) => command.toolName)).toEqual(["execute_typescript"]);
    }
  });

  it("records failed Workflows child commands for invalid dynamic generated-runtime-facade inputs", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-workflows-invalid-input", workspaceCwd);
    const runtime = createHandlerRuntime(store, "session-workflows-invalid-input");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-workflows-invalid-input", {
      typescriptCode: [
        'import { Client } from "incur/client";',
        "const input = { options: { kind: 'runner', oldCommand: true } } as any;",
        "try {",
        '  await extensions.workflows.run("list", input);',
        "} catch (error) {",
        "  return {",
        "    clientError: error instanceof Client.ClientError,",
        "    message: error instanceof Error ? error.message : String(error),",
        "  };",
        "}",
        "return { clientError: false };",
      ].join("\n"),
    });

    expect(tsFacts(result)).toMatchObject({
      success: true,
      result: {
        clientError: true,
      },
    });
    const snapshot = store.getSessionState("session-workflows-invalid-input");
    expect(
      snapshot.commands.find((command) => command.toolName === "execute_typescript")?.facts,
    ).toMatchObject({
      childCommandCount: 1,
      failedChildCommandCount: 1,
    });
    expect(
      snapshot.commands.find((command) => command.toolName === "extensions.workflows.run"),
    ).toMatchObject({
      status: "failed",
      facts: {
        extensionId: "workflows",
        commandId: "list",
        errorCode: "INVALID_ARGUMENT",
      },
    });
  });

  it("supports Artifacts and Workflows generated runtime facades in the same loaded extension set", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-generated-runtime-facades-together", workspaceCwd);
    const runtime = createRuntime(
      store,
      "session-generated-runtime-facades-together",
      "Use clients",
      ["artifacts", "execute-typescript", "workflows"],
    );
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      workflowsModelCatalog: () => [
        {
          providerId: "openai",
          modelId: "gpt-5.4",
          providerAuthenticated: true,
          authSource: "apikey",
          supportedReasoning: ["medium"],
          capabilities: {
            reasoning: true,
            vision: true,
            toolCalling: true,
          },
        },
      ],
    });

    const result = await tool.execute("tool-call-generated-runtime-facades-together", {
      typescriptCode: [
        'const artifact = await extensions.artifacts.run("create", { options: { name: "both.md" } });',
        'const models = await extensions.workflows.run("models list", { options: {} });',
        "return {",
        "  artifactName: artifact.data.name,",
        "  modelCount: models.data.items.length,",
        "  extensionKeys: Object.keys(extensions).sort(),",
        "};",
      ].join("\n"),
    });

    expect(tsFacts(result)).toMatchObject({
      success: true,
      result: {
        artifactName: "both.md",
        modelCount: 1,
        extensionKeys: ["artifacts", "workflows"],
      },
    });
    const snapshot = store.getSessionState("session-generated-runtime-facades-together");
    expect(
      snapshot.commands.filter((command) => command.toolName === "extensions.artifacts.run"),
    ).toHaveLength(1);
    expect(
      snapshot.commands.filter((command) => command.toolName === "extensions.workflows.run"),
    ).toHaveLength(1);
    expect(
      snapshot.commands.find((command) => command.toolName === "execute_typescript")?.facts,
    ).toMatchObject({
      childCommandCount: 2,
      failedChildCommandCount: 0,
    });
  });

  it("rejects failed generated Artifacts calls with ClientError and records failed child commands", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-artifact-failure", workspaceCwd);
    const runtime = createRuntime(store, "session-artifact-failure");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-artifact-failure", {
      typescriptCode: [
        'import { Client } from "incur/client";',
        "try {",
        '  await extensions.artifacts.run("inspect", { options: { id: "missing-artifact" } });',
        "} catch (error) {",
        "  return {",
        "    clientError: error instanceof Client.ClientError,",
        "    message: error instanceof Error ? error.message : String(error),",
        "  };",
        "}",
        'return { clientError: false, message: "unexpected success" };',
      ].join("\n"),
    });

    expect(tsFacts(result)).toMatchObject({
      success: true,
      result: {
        clientError: true,
      },
    });
    const snapshot = store.getSessionState("session-artifact-failure");
    const parentCommand = snapshot.commands.find(
      (command) => command.toolName === "execute_typescript",
    );
    const childCommand = snapshot.commands.find(
      (command) => command.toolName === "extensions.artifacts.run",
    );
    expect(parentCommand?.facts).toMatchObject({
      childCommandCount: 1,
      failedChildCommandCount: 1,
    });
    expect(childCommand).toMatchObject({
      status: "failed",
      facts: {
        extensionId: "artifacts",
        commandId: "inspect",
        errorCode: "ARTIFACT_NOT_FOUND",
      },
    });
  });

  it("records generated-runtime-facade artifact opens as durable command intents", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-artifact-open", workspaceCwd);
    const runtime = createRuntime(store, "session-artifact-open");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-artifact-open", {
      typescriptCode: [
        'const created = await extensions.artifacts.run("create", { options: { name: "open.md" } });',
        'const opened = await extensions.artifacts.run("open", { options: { id: created.data.id } });',
        "return opened.data;",
      ].join("\n"),
    });

    expect(tsFacts(result)).toMatchObject({
      success: true,
      result: {
        intent: "open_artifact_inspector",
        accepted: true,
      },
    });
    const returned = tsFacts(result).result as { id: string };
    const snapshot = store.getSessionState("session-artifact-open");
    expect(
      snapshot.commands.find((command) => command.facts?.intent === "open_artifact_inspector")
        ?.facts,
    ).toMatchObject({
      commandFamily: "artifacts",
      artifactCommandId: "open",
      artifactId: returned.id,
      workspaceSessionId: "session-artifact-open",
      intent: "open_artifact_inspector",
      accepted: true,
      missingFile: false,
    });
  });

  it("records failed child commands for invalid dynamic generated-runtime-facade inputs", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-artifact-invalid-input", workspaceCwd);
    const runtime = createRuntime(store, "session-artifact-invalid-input");
    const appLogEvents: AppLoggerEvent[] = [];
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
      onAppLog: (event) => appLogEvents.push(event),
    });

    const result = await tool.execute("tool-call-artifact-invalid-input", {
      typescriptCode: [
        'import { Client } from "incur/client";',
        "const input = { options: { id: 'missing', commandId: 'old-contract' } } as any;",
        "try {",
        '  await extensions.artifacts.run("inspect", input);',
        "} catch (error) {",
        "  return { clientError: error instanceof Client.ClientError };",
        "}",
        "return { clientError: false };",
      ].join("\n"),
    });

    expect(tsFacts(result)).toMatchObject({
      success: true,
      result: {
        clientError: true,
      },
    });
    const snapshot = store.getSessionState("session-artifact-invalid-input");
    expect(
      snapshot.commands.find((command) => command.toolName === "execute_typescript")?.facts,
    ).toMatchObject({
      childCommandCount: 1,
      failedChildCommandCount: 1,
    });
    expect(
      snapshot.commands.find((command) => command.toolName === "extensions.artifacts.run"),
    ).toMatchObject({
      status: "failed",
      facts: {
        extensionId: "artifacts",
        commandId: "inspect",
        errorCode: "INVALID_ARGUMENT",
      },
    });
    const childCommand = snapshot.commands.find(
      (command) => command.toolName === "extensions.artifacts.run",
    );
    expect(appLogEvents).toContainEqual(
      expect.objectContaining({
        level: "warning",
        source: "artifact",
        message: "Artifact command failed.",
        details: expect.objectContaining({
          workspaceSessionId: "session-artifact-invalid-input",
          surfacePiSessionId: "session-artifact-invalid-input",
          commandId: childCommand!.id,
          artifactCommandId: "inspect",
          errorCode: "INVALID_ARGUMENT",
        }),
      }),
    );
  });

  it("defaults generated Artifacts list calls to the handler thread", async () => {
    const workspaceCwd = createWorkspaceRoot();
    const store = createStore("session-artifact-handler", workspaceCwd);
    const runtime = createHandlerRuntime(store, "session-artifact-handler");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-artifact-handler", {
      typescriptCode: [
        'const created = await extensions.artifacts.run("create", { options: { name: "handler.md" } });',
        'const listed = await extensions.artifacts.run("list", { options: {} });',
        "return { createdId: created.data.id, listedIds: listed.data.artifacts.map((artifact) => artifact.id) };",
      ].join("\n"),
    });

    const returned = tsFacts(result).result as { createdId: string; listedIds: string[] };
    expect(tsFacts(result).success).toBe(true);
    expect(returned.listedIds).toContain(returned.createdId);
    const snapshot = store.getSessionState("session-artifact-handler");
    const handlerThread = snapshot.threads[0];
    expect(snapshot.artifacts.find((artifact) => artifact.id === returned.createdId)).toMatchObject(
      {
        threadId: handlerThread?.id,
      },
    );
  });

  it("supports documented static imports and blocks unsupported module imports", async () => {
    const workspaceCwd = createWorkspaceRoot();
    expect(buildExecuteTypescriptApiDeclaration("orchestrator")).not.toContain("@svvyx/workflows");
    expect(buildExecuteTypescriptApiDeclaration("orchestrator")).not.toContain("@svvyx/extensions");
    const store = createStore("session-incur-client", workspaceCwd);
    const runtime = createRuntime(store, "session-incur-client");
    const tool = createExecuteTypescriptTool({
      cwd: workspaceCwd,
      runtime,
      store,
    });

    const result = await tool.execute("tool-call-incur-client", {
      typescriptCode: [
        'import { Client, Resources as R, Run } from "incur/client";',
        'const error = new Client.ClientError("no configured client");',
        'console.info("client error", error.name);',
        "return {",
        "  errorName: error.name,",
        "  errorMessage: error.message,",
        "  resourceKeys: Object.keys(R),",
        "  runKeys: Object.keys(Run),",
        "};",
      ].join("\n"),
    });

    expect(tsFacts(result)).toMatchObject({
      success: true,
      result: {
        errorName: "Incur.ClientError",
        errorMessage: "no configured client",
        resourceKeys: [],
        runKeys: [],
      },
      logs: ["client error Incur.ClientError"],
    });

    const unsupportedIncurImport = await tool.execute("tool-call-invalid-incur-import", {
      typescriptCode: 'import { Secrets } from "incur/client";\nreturn Secrets;',
    });
    expect(tsFacts(unsupportedIncurImport)).toMatchObject({
      success: false,
      error: {
        stage: "compile",
      },
    });
    expect(tsFacts(unsupportedIncurImport).error?.message).toContain(
      "Only named imports Client, Resources, Run",
    );

    const nodeImport = await tool.execute("tool-call-node-import", {
      typescriptCode: 'import { readFileSync } from "node:fs";\nreturn readFileSync;',
    });
    expect(tsFacts(nodeImport).success).toBe(false);
    expect(tsFacts(nodeImport).error?.stage).toBe("compile");
    expect(tsFacts(nodeImport).error?.message).toContain(
      "Unsupported execute_typescript import declaration: node:fs",
    );

    for (const [index, moduleName] of [
      "@svvyx/workflows",
      "@svvyx/extensions",
      "@svvy/workflows",
      "@svvy/extensions",
      "@svvy/runtime",
      "@svvy/state",
    ].entries()) {
      const generatedPackageImport = await tool.execute(`tool-call-generated-import-${index}`, {
        typescriptCode: `import { Agents } from "${moduleName}";\nreturn Agents;`,
      });
      expect(tsFacts(generatedPackageImport)).toMatchObject({
        success: false,
        error: {
          stage: "compile",
          message: `Unsupported execute_typescript import declaration: ${moduleName}.`,
        },
      });
    }

    for (const [index, moduleName] of [
      "@svvyx/workflows",
      "@svvyx/extensions",
      "@svvy/extensions",
      "@svvy/runtime",
      "@svvy/state",
    ].entries()) {
      const namespaceImport = await tool.execute(`tool-call-namespace-import-${index}`, {
        typescriptCode: `import * as Package from "${moduleName}";\nreturn Package;`,
      });
      expect(tsFacts(namespaceImport)).toMatchObject({
        success: false,
        error: {
          stage: "compile",
          message: `Unsupported execute_typescript import declaration: ${moduleName}.`,
        },
      });

      const sideEffectImport = await tool.execute(`tool-call-side-effect-import-${index}`, {
        typescriptCode: `import "${moduleName}";\nreturn {};`,
      });
      expect(tsFacts(sideEffectImport)).toMatchObject({
        success: false,
        error: {
          stage: "compile",
          message: `Unsupported execute_typescript import declaration: ${moduleName}.`,
        },
      });

      const dynamicImport = await tool.execute(`tool-call-dynamic-import-${index}`, {
        typescriptCode: `const module = await import("${moduleName}");\nreturn module;`,
      });
      expect(tsFacts(dynamicImport)).toMatchObject({
        success: false,
        error: {
          stage: "compile",
          message: `Unsupported execute_typescript import declaration: ${moduleName}.`,
        },
      });
    }
  });
});
