import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as Effect from "effect/Effect";
import { createPromptExecutionContext } from "@svvy/runtime/prompt-execution-context";
import type { AppLoggerEvent } from "./app-logger";
import {
  runtimeArtifactStatePortFromStore,
  runtimeCommandStatePortFromStore,
  runtimeExtensionContextImpactStateFacadeFromStore,
  runtimeTurnStatePortFromStore,
} from "@svvy/state/structured-session-adapters";
import { buildStructuredSessionView } from "@svvy/state/structured-session-projections";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "@svvy/state/structured-session-state";
import { createSvvyDirectTools } from "./svvy-direct-tools";
import { createToolExecutionCommandTracker } from "./tool-execution-command-tracker";
import type { RuntimeStateWriteLane } from "./ordered-runtime-state-write-lane";
import type {
  AgentProfileAuthoritySnapshot,
  AgentProfileMutation,
} from "./agent-profile-mutation-store";
import { DEFAULT_ORCHESTRATOR_PROFILE_ID } from "../shared/agent-settings";
import type {
  AbsolutePath,
  AgentProfileId,
  CommandId,
  IsoDateTimeString,
  NativeToolResult,
  SandboxLaunchFacts,
  SandboxLaunchKind,
  SurfacePiSessionId,
  WorkspaceId,
} from "@svvy/core";
import { createLiveCommandStdinRegistry } from "./live-command-stdin-registry";

const tempDirs: string[] = [];
const originalSandboxHelperPath = process.env.SVVY_SANDBOX_HELPER_PATH;
const testSandboxHelperPath = join(
  import.meta.dir,
  "..",
  "..",
  "build",
  "native",
  "svvy-sandbox-helper",
);
const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

function createTestAgentProfileSnapshot(): AgentProfileAuthoritySnapshot {
  const updatedAt = "2026-06-09T00:00:00.000Z";
  return {
    configuredProfiles: [
      {
        profileId: "thread-handler",
        actor: "handler",
        name: "Thread handler",
        providerId: "openai",
        modelId: "gpt-5.4-mini",
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
        profileId: "default-orchestrator",
        actor: "orchestrator",
        name: "Default orchestrator",
        providerId: "openai",
        modelId: "gpt-5.4",
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
  } as unknown as AgentProfileAuthoritySnapshot;
}

function createSvvyDirectToolsForTest(
  options: Omit<
    Parameters<typeof createSvvyDirectTools>[0],
    "artifactState" | "commandState" | "databasePath" | "extensionsRoot" | "runState"
  > & {
    extensionsRoot?: string;
    store?: StructuredSessionStateStore;
  },
): ReturnType<typeof createSvvyDirectTools> {
  if (options.managedSandbox && !process.env.SVVY_SANDBOX_HELPER_PATH) {
    process.env.SVVY_SANDBOX_HELPER_PATH = testSandboxHelperPath;
  }
  const { store, ...directOptions } = options;
  return createSvvyDirectTools({
    ...directOptions,
    ...(store
      ? {
          artifactState: runtimeArtifactStatePortFromStore(store),
          commandState: runtimeCommandStatePortFromStore(store),
          databasePath: store.databasePath,
          extensionContextImpactState:
            directOptions.extensionContextImpactState ??
            runtimeExtensionContextImpactStateFacadeFromStore(store),
          readArtifactRootForSession: (sessionId: string) =>
            directOptions.readArtifactRootForSession?.(sessionId) ??
            store.getSessionState(sessionId).workspace.artifactDir,
          runState: Effect.runSync,
        }
      : {}),
    managedSandbox: options.managedSandbox ?? false,
    extensionsRoot: options.extensionsRoot ?? join(options.cwd, ".svvy-test", "extensions"),
  });
}

function createTrackerForTest(
  store: StructuredSessionStateStore,
  promptContext: ReturnType<typeof createPromptExecutionContext>,
) {
  return createToolExecutionCommandTracker({
    commandState: runtimeCommandStatePortFromStore(store),
    turnState: runtimeTurnStatePortFromStore(store),
    promptContext,
    stateWrites: createImmediateRuntimeStateWriteLane(),
  });
}

function createImmediateRuntimeStateWriteLane(): RuntimeStateWriteLane {
  return {
    run(effect) {
      return Promise.resolve(Effect.runSync(effect));
    },
    enqueue(_label, effect) {
      return Promise.resolve(Effect.runSync(effect));
    },
    drain() {
      return Promise.resolve();
    },
    close() {
      return Promise.resolve();
    },
  };
}

function testLaunchFacts(input: {
  cwd: string;
  launchKind: SandboxLaunchKind;
  commandId: string;
  command: readonly string[];
  filesystemPolicy?: SandboxLaunchFacts["policySnapshot"]["filesystemPolicy"];
  mode?: SandboxLaunchFacts["mode"];
  networkPolicy?: SandboxLaunchFacts["policySnapshot"]["networkPolicy"];
  sessionId?: string;
  workspaceId?: string;
}): SandboxLaunchFacts {
  const mode = input.mode ?? "omitted_full_access";
  const workspaceId = input.workspaceId ?? "workspace-runtime-launch";
  const sessionId = input.sessionId ?? "session-runtime-launch";
  return {
    mode,
    spawn: {
      executable: input.command[0] as AbsolutePath,
      args: input.command.slice(1),
      cwd: input.cwd as AbsolutePath,
      envFacts: [],
    },
    ...(mode === "managed"
      ? {
          helperArgs: [],
          helperPath: testSandboxHelperPath as AbsolutePath,
        }
      : {}),
    policySnapshot: {
      snapshotId: `snapshot-${input.commandId}`,
      fingerprint: `fingerprint-${input.commandId}`,
      resolvedAt: "2026-06-10T10:00:00.000Z" as IsoDateTimeString,
      scope: { kind: "workspace", workspaceId: workspaceId as WorkspaceId },
      surfacePiSessionId: sessionId as SurfacePiSessionId,
      commandId: input.commandId as CommandId,
      launchKind: input.launchKind,
      cwd: input.cwd as AbsolutePath,
      sandboxMode: mode,
      networkPolicy: input.networkPolicy ?? "allow",
      filesystemPolicy: input.filesystemPolicy ?? { defaultAccess: "read", entries: [] },
    },
  } as unknown as SandboxLaunchFacts;
}

function createRuntimeLaunchDirectToolsForTest(input: {
  command: readonly string[];
  cwd: string;
  launchFacts?: (commandId: string) => SandboxLaunchFacts;
  launchKind: SandboxLaunchKind;
  options?: Partial<Parameters<typeof createSvvyDirectToolsForTest>[0]>;
  toolCallId: string;
  toolName: "apply_patch" | "exec_command";
  workspaceId?: string;
}): {
  commandId: CommandId;
  closed: () => boolean;
  tools: ReturnType<typeof createSvvyDirectToolsForTest>;
} {
  const workspaceId = input.workspaceId ?? `workspace-${input.toolCallId}`;
  const store = createStructuredSessionStateStore({
    digest: testDigest,
    workspace: {
      id: workspaceId,
      label: "svvy",
      cwd: input.cwd,
      artifactDir: join(input.cwd, "artifacts"),
    },
    databasePath: join(input.cwd, "structured.sqlite"),
  });
  openStores.push(store);
  const turn = store.startTurn({
    sessionId: `session-${input.toolCallId}`,
    surfacePiSessionId: `session-${input.toolCallId}`,
    requestSummary: `Run ${input.toolName}`,
  });
  const runtime = {
    current: createPromptExecutionContext({
      workspaceSessionId: `session-${input.toolCallId}`,
      turnId: turn.id,
      surfacePiSessionId: `session-${input.toolCallId}`,
      generatedAgentContextFingerprint: "generated_context_fingerprint_test",
      generatedAgentContextRevision: "generated_context_revision_test",
    }),
  };
  const command = store.createCommand({
    turnId: turn.id,
    toolName: input.toolName,
    executor: "orchestrator",
    visibility: "summary",
    title: `Run ${input.toolName}`,
    summary: `Run ${input.toolName}.`,
    arguments: {},
    facts: { toolCallId: input.toolCallId },
  });
  store.startCommand(command.id);
  let closed = false;
  return {
    commandId: command.id as CommandId,
    closed: () => closed,
    tools: createSvvyDirectToolsForTest({
      cwd: input.cwd,
      store,
      runtime,
      workspaceId,
      ...input.options,
      acquireDirectToolLaunch: async (launchInput) => {
        expect(launchInput.toolName).toBe(input.toolName);
        expect(launchInput.commandId).toBe(command.id as CommandId);
        return {
          facts:
            input.launchFacts?.(command.id) ??
            testLaunchFacts({
              command: input.command,
              commandId: command.id,
              cwd: input.cwd,
              launchKind: input.launchKind,
              sessionId: runtime.current.surfacePiSessionId,
              workspaceId,
            }),
          async close() {
            closed = true;
          },
        };
      },
    }),
  };
}

const openStores: ReturnType<typeof createStructuredSessionStateStore>[] = [];

describe("svvy direct tools", () => {
  afterEach(() => {
    if (originalSandboxHelperPath === undefined) {
      delete process.env.SVVY_SANDBOX_HELPER_PATH;
    } else {
      process.env.SVVY_SANDBOX_HELPER_PATH = originalSandboxHelperPath;
    }
    while (openStores.length > 0) {
      openStores.pop()?.close();
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { force: true, recursive: true });
      }
    }
  });

  it("exposes the current native direct tool surface", () => {
    const tools = createSvvyDirectToolsForTest({ cwd: "/repo/svvy" });
    const toolNames = tools.codingTools.map((tool) => tool.name);

    expect(toolNames).toEqual(["exec_command", "write_stdin", "apply_patch"]);
    expect(toolNames).not.toContain("bash");
    expect(toolNames).not.toContain("read");
    expect(toolNames).not.toContain("grep");
    expect(toolNames).not.toContain("find");
    expect(toolNames).not.toContain("ls");
    expect(toolNames).not.toContain("edit");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("artifact_write_text");
    expect(toolNames).not.toContain("artifact_write_json");
    expect(toolNames).not.toContain("artifact_attach_file");
  });

  it("continues a running exec_command session with write_stdin", async () => {
    const cwd = createTempDir();
    const tools = createSvvyDirectToolsForTest({ cwd }).codingTools;
    const execTool = findTool(tools, "exec_command");
    const stdinTool = findTool(tools, "write_stdin");

    const started = await execTool.execute(
      "tool-exec-session",
      { cmd: "read line; echo got:$line", timeout: 1 },
      new AbortController().signal,
      () => {},
    );
    const sessionId = readText(started).match(/session_id: (\S+)/)?.[1];
    expect(sessionId).toBeTruthy();

    await stdinTool.execute(
      "tool-stdin-write",
      { session_id: sessionId, input: "hello\n" },
      new AbortController().signal,
      () => {},
    );
    await sleep(50);
    const completed = await stdinTool.execute(
      "tool-stdin-drain",
      { session_id: sessionId, input: "" },
      new AbortController().signal,
      () => {},
    );

    expect(readText(completed)).toContain("got:hello");
    expect(readText(completed)).toContain("exit code: 0");
  });

  it("runs exec_command in the provided workdir", async () => {
    const cwd = createTempDir();
    const nested = join(cwd, "nested");
    mkdirSync(nested);
    writeFileSync(join(nested, "scoped.txt"), "from-workdir\n");
    const execTool = findTool(createSvvyDirectToolsForTest({ cwd }).codingTools, "exec_command");

    const result = await execTool.execute(
      "tool-exec-workdir",
      { cmd: "cat scoped.txt", workdir: nested },
      new AbortController().signal,
      () => {},
    );

    expect(readText(result)).toContain("from-workdir");
    expect(readText(result)).toContain("exit code: 0");
  });

  it("records live exec_command stdout and stderr chunks as durable command events", async () => {
    const cwd = createTempDir();
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: cwd,
        label: "svvy",
        cwd,
      },
      databasePath: join(cwd, "structured.sqlite"),
    });
    openStores.push(store);
    store.upsertPiSession({
      sessionId: "session-live-exec",
      title: "Live exec",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      messageCount: 1,
      status: "running",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
    });
    const turn = store.startTurn({
      sessionId: "session-live-exec",
      surfacePiSessionId: "session-live-exec",
      requestSummary: "Run a command",
    });
    const runtime = {
      current: createPromptExecutionContext({
        workspaceSessionId: "session-live-exec",
        turnId: turn.id,
        surfacePiSessionId: "session-live-exec",
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      }),
    };
    const command = store.createCommand({
      turnId: turn.id,
      toolName: "exec_command",
      executor: "orchestrator",
      visibility: "summary",
      title: "Run exec_command",
      summary: "Run a command.",
      arguments: { cmd: "printf 'live-out'; printf 'live-err' >&2" },
      facts: { toolCallId: "tool-live-exec" },
    });
    store.startCommand(command.id);
    const execTool = findTool(
      createSvvyDirectToolsForTest({ cwd, runtime, store }).codingTools,
      "exec_command",
    );

    await execTool.execute(
      "tool-live-exec",
      { cmd: "printf 'live-out'; printf 'live-err' >&2" },
      new AbortController().signal,
      () => {},
    );

    const outputEvents = store
      .getSessionState("session-live-exec")
      .events.filter((event) => event.kind === "command.output" && event.subject.id === command.id);
    expect(outputEvents).toContainEqual(
      expect.objectContaining({
        data: {
          stream: "stdout",
          source: "live-stream",
          text: "live-out",
        },
      }),
    );
    expect(outputEvents).toContainEqual(
      expect.objectContaining({
        data: {
          stream: "stderr",
          source: "live-stream",
          text: "live-err",
        },
      }),
    );
    expect(store.getSessionState("session-live-exec").artifacts).toEqual([]);
  });

  it("retains large exec_command stdout and stderr as command-linked artifacts", async () => {
    const cwd = createTempDir();
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: cwd,
        label: "svvy",
        cwd,
        artifactDir: join(cwd, "artifact-store"),
      },
      databasePath: join(cwd, "structured.sqlite"),
    });
    openStores.push(store);
    store.upsertPiSession({
      sessionId: "session-retained-output",
      title: "Retained output",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      messageCount: 1,
      status: "running",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
    });
    const turn = store.startTurn({
      sessionId: "session-retained-output",
      surfacePiSessionId: "session-retained-output",
      requestSummary: "Run a command",
    });
    const promptContext = createPromptExecutionContext({
      workspaceSessionId: "session-retained-output",
      turnId: turn.id,
      surfacePiSessionId: "session-retained-output",
      generatedAgentContextFingerprint: "generated_context_fingerprint_test",
      generatedAgentContextRevision: "generated_context_revision_test",
    });
    const tracker = createTrackerForTest(store, promptContext);
    const commandText =
      "bun -e \"console.log('x'.repeat(70000)); console.error('y'.repeat(70000))\"";
    tracker.handleToolExecutionStart({
      toolCallId: "tool-retained-output",
      toolName: "exec_command",
      args: { cmd: commandText },
    });
    const command = store.getSessionState("session-retained-output").commands[0]!;
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        runtime: { current: promptContext },
        store,
      }).codingTools,
      "exec_command",
    );

    const result = await execTool.execute(
      "tool-retained-output",
      { cmd: commandText },
      new AbortController().signal,
      () => {},
    );
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-retained-output",
      toolName: "exec_command",
      result,
      isError: false,
    });

    expect(readText(result)).toContain("exit code: 0");
    const snapshot = store.getSessionState("session-retained-output");
    const artifacts = snapshot.artifacts;
    expect(artifacts).toHaveLength(2);
    const stdoutArtifact = artifacts.find((artifact) =>
      artifact.name.startsWith("command-output-stdout-"),
    );
    const stderrArtifact = artifacts.find((artifact) =>
      artifact.name.startsWith("command-output-stderr-"),
    );
    expect(stdoutArtifact).toMatchObject({
      sessionId: "session-retained-output",
      sourceCommandId: command.id,
      kind: "log",
      immutable: true,
      mimeType: "text/plain",
    });
    expect(stderrArtifact).toMatchObject({
      sessionId: "session-retained-output",
      sourceCommandId: command.id,
      kind: "log",
      immutable: true,
      mimeType: "text/plain",
    });
    if (!stdoutArtifact?.path || !stderrArtifact?.path) {
      throw new Error("Retained output artifact path missing.");
    }
    expect(readFileSync(stdoutArtifact.path, "utf8")).toContain("x".repeat(70000));
    expect(readFileSync(stderrArtifact.path, "utf8")).toContain("y".repeat(70000));
    const outputEventText = snapshot.events
      .filter((event) => event.kind === "command.output" && event.subject.id === command.id)
      .map((event) => (event.data as { text?: unknown }).text)
      .filter((text): text is string => typeof text === "string")
      .join("");
    expect(outputEventText).toContain("Output exceeded the live event retention limit.");
    expect(outputEventText).not.toContain("x".repeat(70000));
    expect(outputEventText).not.toContain("y".repeat(70000));
    const rollup = buildStructuredSessionView(snapshot).commandRollups[0];
    expect(rollup).toMatchObject({
      commandId: command.id,
      facts: {
        exitCode: 0,
        exitSignal: null,
        retainedOutputArtifacts: [
          {
            artifactId: stdoutArtifact.id,
            bytes: stdoutArtifact.bytes,
            name: stdoutArtifact.name,
            stream: "stdout",
          },
          {
            artifactId: stderrArtifact.id,
            bytes: stderrArtifact.bytes,
            name: stderrArtifact.name,
            stream: "stderr",
          },
        ],
      },
      artifacts: [
        {
          artifactId: stdoutArtifact.id,
          sourceCommandId: command.id,
          kind: "log",
          name: stdoutArtifact.name,
        },
        {
          artifactId: stderrArtifact.id,
          sourceCommandId: command.id,
          kind: "log",
          name: stderrArtifact.name,
        },
      ],
    });
    expect(rollup?.facts).not.toHaveProperty("stdout");
    expect(rollup?.facts).not.toHaveProperty("stderr");
  });

  it("records svvyx workflow subprocess output and progress as durable command events", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    mkdirSync(join(packageRoot, "prompts"), { recursive: true });
    writeFileSync(
      join(packageRoot, "prompts", "ReviewPrompt.ts"),
      "export const ReviewPrompt = ``;\n",
    );
    const { command, execTool, store } = createActiveExecHarness({
      commandText: "svvyx workflows list --json",
      cwd,
      sourceRoot,
      packageRoot,
      sessionId: "session-live-workflows",
      toolCallId: "tool-live-workflows",
    });

    const result = await execTool.execute(
      "tool-live-workflows",
      { cmd: "svvyx workflows list --json" },
      new AbortController().signal,
      () => {},
    );

    const output = JSON.parse(readText(result));
    expect(output.items).toEqual([
      expect.objectContaining({
        kind: "prompt",
        namespace: "Prompts",
        exportName: "ReviewPrompt",
      }),
    ]);
    const events = store
      .getSessionState("session-live-workflows")
      .events.filter((event) => event.subject.id === command.id);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "command.progress",
          data: expect.objectContaining({
            command: "svvyx workflows list --json",
            family: "workflows",
            phase: "started",
            source: "svvyx-cli-subprocess",
          }),
        }),
        expect.objectContaining({
          kind: "command.progress",
          data: expect.objectContaining({
            command: "svvyx workflows list --json",
            family: "workflows",
            phase: "succeeded",
            source: "svvyx-cli-subprocess",
            facts: {
              workflowExportCount: 1,
            },
          }),
        }),
        expect.objectContaining({
          kind: "command.output",
          data: {
            stream: "stdout",
            source: "live-stream",
            text: JSON.stringify(output, null, 2),
          },
        }),
      ]),
    );
  });

  it("accepts env-prefix and command-prefix svvyx invocations on the trusted subprocess path", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    mkdirSync(join(packageRoot, "prompts"), { recursive: true });
    writeFileSync(
      join(packageRoot, "prompts", "ReviewPrompt.ts"),
      "export const ReviewPrompt = ``;\n",
    );
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workflowsGeneratedPackagePath: packageRoot,
        workflowsSourceRoot: sourceRoot,
      }).codingTools,
      "exec_command",
    );

    const envResult = await execTool.execute(
      "tool-env-svvyx",
      { cmd: "env FOO=bar svvyx workflows list --json" },
      new AbortController().signal,
      () => {},
    );
    const commandResult = await execTool.execute(
      "tool-command-svvyx",
      { cmd: "command svvyx workflows list --json" },
      new AbortController().signal,
      () => {},
    );

    expect(JSON.parse(readText(envResult)).items).toEqual([
      expect.objectContaining({ exportName: "ReviewPrompt" }),
    ]);
    expect(JSON.parse(readText(commandResult)).items).toEqual([
      expect.objectContaining({ exportName: "ReviewPrompt" }),
    ]);
  });

  it("rejects shell-visible svvyx subprocess context overrides before trusted replay", async () => {
    const cwd = createTempDir();
    const execTool = findTool(createSvvyDirectToolsForTest({ cwd }).codingTools, "exec_command");

    await expect(
      execTool.execute(
        "tool-svvyx-context-spoof",
        { cmd: "env SVVY_SVVYX_SUBPROCESS_CONTEXT={} svvyx workflows list --json" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("app-owned and cannot be overridden");

    await expect(
      execTool.execute(
        "tool-svvyx-result-key-spoof",
        { cmd: "SVVY_SVVYX_SUBPROCESS_RESULT_KEY=bad svvyx workflows list --json" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("app-owned and cannot be overridden");
  });

  it("does not expose external instruction bodies through svvyx subprocess context", async () => {
    const cwd = createTempDir();
    const secretInstructionBody = "secret instruction body must not cross shell env";
    const runtime = {
      current: createPromptExecutionContext({
        workspaceSessionId: "session-external-instruction-env",
        turnId: "turn-external-instruction-env",
        surfacePiSessionId: "session-external-instruction-env",
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
        externalInstructionSources: [
          {
            id: "0:/repo/AGENTS.md",
            kind: "AGENTS.md",
            title: "AGENTS.md",
            path: "/repo/AGENTS.md",
            content: secretInstructionBody,
            contentHash: "hash-agents",
            order: 0,
            enabled: true,
            actors: ["orchestrator", "handler"],
            sourceGroup: "workspace_chain",
            readStatus: { status: "readable" },
          },
        ],
      }),
    };
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        runtime,
        applyExtensionManagementRuntimeRequest: async () => ({
          output: {
            ok: true,
            extension: {
              externalInstruction: {
                path: "/repo/AGENTS.md",
                content: "",
                contentHash: "hash-agents",
                readStatus: { status: "readable" },
              },
            },
          },
          commandFacts: { extensionReady: true },
        }),
      }).codingTools,
      "exec_command",
    );

    const result = await execTool.execute(
      "tool-svvyx-external-instruction-env",
      { cmd: "svvyx extensions inspect external_instruction:AGENTS.md:/repo/AGENTS.md --json" },
      new AbortController().signal,
      () => {},
    );
    const text = readText(result);
    const output = JSON.parse(text);

    expect(text).not.toContain(secretInstructionBody);
    expect(output.extension.externalInstruction).toMatchObject({
      path: "/repo/AGENTS.md",
      content: "",
      contentHash: "hash-agents",
      readStatus: { status: "readable" },
    });
  });

  it("injects command-scoped workflow task-agent bridge env for handler shell commands", async () => {
    const cwd = createTempDir();
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: { id: cwd, label: "Bridge", cwd, artifactDir: join(cwd, "artifacts") },
      databasePath: join(cwd, "state.sqlite"),
    });
    openStores.push(store);
    store.upsertPiSession({
      sessionId: "session-smithers-bridge",
      title: "Smithers bridge",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      messageCount: 1,
      status: "running",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
    });
    const orchestratorTurn = store.startTurn({
      sessionId: "session-smithers-bridge",
      surfacePiSessionId: "session-smithers-bridge",
      requestSummary: "Start handler",
    });
    const thread = store.createThread({
      turnId: orchestratorTurn.id,
      surfacePiSessionId: "session-smithers-handler",
      title: "Smithers handler",
      objective: "Run Smithers workflow.",
    });
    const turn = store.startTurn({
      sessionId: "session-smithers-bridge",
      surfacePiSessionId: "session-smithers-handler",
      threadId: thread.id,
      requestSummary: "Run Smithers",
    });
    const runtime = {
      current: createPromptExecutionContext({
        workspaceSessionId: "session-smithers-bridge",
        turnId: turn.id,
        surfacePiSessionId: "session-smithers-handler",
        surfaceKind: "handler",
        threadId: thread.id,
        rootThreadId: thread.id,
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      }),
    };
    const command = store.createCommand({
      turnId: turn.id,
      threadId: thread.id,
      surfacePiSessionId: "session-smithers-handler",
      toolName: "exec_command",
      executor: "handler",
      visibility: "summary",
      title: "Run exec_command",
      summary: "Run shell command.",
      arguments: { cmd: "node -e" },
      facts: { toolCallId: "tool-smithers-bridge" },
    });
    store.startCommand(command.id);
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        runtime,
        store,
        runTaskAgentBridge: ({ runtime: bridgeRuntime, sourceCommandId }) => ({
          SVVY_WORKFLOW_AGENT_BRIDGE_URL: "http://127.0.0.1:9999/runTaskAgent",
          SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN: "bridge-token",
          SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID: bridgeRuntime?.workspaceSessionId ?? "",
          SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID: sourceCommandId ?? "",
          SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS: "12345",
          SVVY_WORKFLOW_AGENT_BRIDGE_MAX_RESPONSE_BYTES: "67890",
        }),
      }).codingTools,
      "exec_command",
    );

    const result = await execTool.execute(
      "tool-smithers-bridge",
      {
        cmd: [
          'printf "url=%s\\n" "$SVVY_WORKFLOW_AGENT_BRIDGE_URL"',
          'printf "token=%s\\n" "$SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN"',
          'printf "workspace=%s\\n" "$SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID"',
          'printf "source=%s\\n" "$SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID"',
          'printf "timeout=%s\\n" "$SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS"',
          'printf "maxBytes=%s\\n" "$SVVY_WORKFLOW_AGENT_BRIDGE_MAX_RESPONSE_BYTES"',
        ].join("; "),
      },
      new AbortController().signal,
      () => {},
    );

    expect(readText(result)).toContain("url=http://127.0.0.1:9999/runTaskAgent");
    expect(readText(result)).toContain("token=[REDACTED]");
    expect(readText(result)).not.toContain("bridge-token");
    expect(readText(result)).toContain("workspace=session-smithers-bridge");
    expect(readText(result)).toContain(`source=${command.id}`);
    expect(readText(result)).toContain("timeout=12345");
    expect(readText(result)).toContain("maxBytes=67890");
  });

  it("does not inject workflow task-agent bridge env for orchestrator shell commands", async () => {
    const cwd = createTempDir();
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: { id: cwd, label: "Bridge", cwd, artifactDir: join(cwd, "artifacts") },
      databasePath: join(cwd, "state.sqlite"),
    });
    openStores.push(store);
    store.upsertPiSession({
      sessionId: "session-orchestrator-no-bridge",
      title: "Orchestrator no bridge",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      messageCount: 1,
      status: "running",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
    });
    const turn = store.startTurn({
      sessionId: "session-orchestrator-no-bridge",
      surfacePiSessionId: "session-orchestrator-no-bridge",
      requestSummary: "Run shell command",
    });
    const runtime = {
      current: createPromptExecutionContext({
        workspaceSessionId: "session-orchestrator-no-bridge",
        turnId: turn.id,
        surfacePiSessionId: "session-orchestrator-no-bridge",
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      }),
    };
    const command = store.createCommand({
      turnId: turn.id,
      toolName: "exec_command",
      executor: "orchestrator",
      visibility: "summary",
      title: "Run exec_command",
      summary: "Run shell command.",
      arguments: { cmd: "env" },
      facts: { toolCallId: "tool-orchestrator-no-bridge" },
    });
    store.startCommand(command.id);
    let bridgeProviderCalls = 0;
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        runtime,
        store,
        runTaskAgentBridge: () => {
          bridgeProviderCalls += 1;
          return {
            SVVY_WORKFLOW_AGENT_BRIDGE_URL: "http://127.0.0.1:9999/runTaskAgent",
            SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN: "bridge-token",
            SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID: "session-orchestrator-no-bridge",
            SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID: command.id,
            SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS: "12345",
            SVVY_WORKFLOW_AGENT_BRIDGE_MAX_RESPONSE_BYTES: "67890",
          };
        },
      }).codingTools,
      "exec_command",
    );

    const result = await execTool.execute(
      "tool-orchestrator-no-bridge",
      {
        cmd: [
          'printf "url=%s\\n" "$SVVY_WORKFLOW_AGENT_BRIDGE_URL"',
          'printf "timeout=%s\\n" "$SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS"',
          'printf "maxBytes=%s\\n" "$SVVY_WORKFLOW_AGENT_BRIDGE_MAX_RESPONSE_BYTES"',
        ].join("; "),
      },
      new AbortController().signal,
      () => {},
    );

    expect(readText(result)).toContain("url=");
    expect(readText(result)).not.toContain("runTaskAgent");
    expect(readText(result)).toContain("timeout=");
    expect(readText(result)).toContain("maxBytes=");
    expect(readText(result)).not.toContain("12345");
    expect(readText(result)).not.toContain("67890");
    expect(bridgeProviderCalls).toBe(0);
  });

  it("cleans up temporary svvyx shim directories after subprocess completion", async () => {
    const cwd = createTempDir();
    const packageRoot = join(cwd, "generated", "package");
    mkdirSync(packageRoot, { recursive: true });
    const before = new Set(readSvvyxSubprocessTempDirs());
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workflowsGeneratedPackagePath: packageRoot,
        workflowsSourceRoot: join(cwd, "workflow-source"),
      }).codingTools,
      "exec_command",
    );

    await execTool.execute(
      "tool-svvyx-cleanup",
      { cmd: "svvyx workflows list --json" },
      new AbortController().signal,
      () => {},
    );

    const created = readSvvyxSubprocessTempDirs().filter((dir) => !before.has(dir));
    expect(created).toEqual([]);
  });

  it("leaves non-command svvyx mentions on the ordinary shell path", async () => {
    const cwd = createTempDir();
    mkdirSync(join(cwd, "docs"), { recursive: true });
    writeFileSync(join(cwd, "notes.txt"), "svvyx mention\n");
    writeFileSync(join(cwd, "docs", "svvyx.md"), "svvyx docs\n");
    const execTool = findTool(createSvvyDirectToolsForTest({ cwd }).codingTools, "exec_command");

    const echoResult = await execTool.execute(
      "tool-echo-svvyx",
      { cmd: "echo svvyx" },
      new AbortController().signal,
      () => {},
    );
    const grepResult = await execTool.execute(
      "tool-grep-svvyx",
      { cmd: "grep svvyx notes.txt" },
      new AbortController().signal,
      () => {},
    );
    const catResult = await execTool.execute(
      "tool-cat-svvyx-doc",
      { cmd: "cat docs/svvyx.md" },
      new AbortController().signal,
      () => {},
    );

    expect(readText(echoResult)).toContain("svvyx");
    expect(echoResult.details?.commandFacts).toBeUndefined();
    expect(readText(grepResult)).toContain("svvyx mention");
    expect(grepResult.details?.commandFacts).toBeUndefined();
    expect(readText(catResult)).toContain("svvyx docs");
    expect(catResult.details?.commandFacts).toBeUndefined();
  });

  it("does not trust transport replay for user runtime extension svvyx commands", async () => {
    const cwd = createTempDir();
    const execTool = findTool(createSvvyDirectToolsForTest({ cwd }).codingTools, "exec_command");

    const result = await execTool.execute(
      "tool-runtime-no-transport-replay",
      { cmd: "svvyx linear search --json" },
      new AbortController().signal,
      () => {},
    );

    expect(readText(result)).toContain("linear");
    expect(result.details?.commandFacts).toBeUndefined();
  });

  it("retains oversized svvyx workflow subprocess output in command facts", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    const promptsRoot = join(packageRoot, "prompts");
    mkdirSync(promptsRoot, { recursive: true });
    for (let index = 0; index < 900; index += 1) {
      writeFileSync(
        join(promptsRoot, `Prompt${index}.ts`),
        `export const Prompt${index} = \`\`;\n`,
      );
    }
    const { command, execTool, store } = createActiveExecHarness({
      commandText: "svvyx workflows list --json",
      cwd,
      sourceRoot,
      packageRoot,
      sessionId: "session-retained-svvyx-workflows",
      toolCallId: "tool-retained-svvyx-workflows",
    });

    const result = await execTool.execute(
      "tool-retained-svvyx-workflows",
      { cmd: "svvyx workflows list --json" },
      new AbortController().signal,
      () => {},
    );
    const commandFacts = result.details?.commandFacts;
    if (!commandFacts || typeof commandFacts !== "object" || Array.isArray(commandFacts)) {
      throw new Error("Expected svvyx workflow command facts.");
    }
    store.finishCommand({
      commandId: command.id,
      status: "succeeded",
      facts: commandFacts as Record<string, unknown>,
    });

    const output = JSON.parse(readText(result));
    expect(output.items).toHaveLength(900);
    const artifacts = store.getSessionState("session-retained-svvyx-workflows").artifacts;
    expect(artifacts).toHaveLength(1);
    const retainedArtifact = artifacts[0]!;
    expect(retainedArtifact).toMatchObject({
      sessionId: "session-retained-svvyx-workflows",
      sourceCommandId: command.id,
      kind: "log",
      immutable: true,
      mimeType: "text/plain",
    });
    expect(retainedArtifact.name).toMatch(/^command-output-stdout-.+\.log$/);
    if (!retainedArtifact.path) {
      throw new Error("Retained svvyx output artifact path missing.");
    }
    expect(readFileSync(retainedArtifact.path, "utf8")).toContain('"exportName": "Prompt899"');
    expect(result.details?.commandFacts).toMatchObject({
      workflowExportCount: 900,
      retainedOutputArtifacts: [
        {
          artifactId: retainedArtifact.id,
          bytes: retainedArtifact.bytes,
          name: retainedArtifact.name,
          stream: "stdout",
        },
      ],
    });
    const outputEventText = store
      .getSessionState("session-retained-svvyx-workflows")
      .events.filter((event) => event.kind === "command.output" && event.subject.id === command.id)
      .map((event) => (event.data as { text?: unknown }).text)
      .filter((text): text is string => typeof text === "string")
      .join("");
    expect(outputEventText).toContain("Output exceeded the live event retention limit.");
    expect(outputEventText).not.toContain('"exportName": "Prompt899"');
    const rollup = buildStructuredSessionView(
      store.getSessionState("session-retained-svvyx-workflows"),
    ).commandRollups[0];
    expect(rollup).toMatchObject({
      commandId: command.id,
      facts: {
        workflowExportCount: 900,
        retainedOutputArtifacts: [
          {
            artifactId: retainedArtifact.id,
            bytes: retainedArtifact.bytes,
            name: retainedArtifact.name,
            stream: "stdout",
          },
        ],
      },
      artifacts: [
        {
          artifactId: retainedArtifact.id,
          sourceCommandId: command.id,
          kind: "log",
          name: retainedArtifact.name,
        },
      ],
    });
  });

  it("records svvyx workflow subprocess failures as live stderr", async () => {
    const cwd = createTempDir();
    const { command, execTool, store } = createActiveExecHarness({
      commandText: "svvyx workflows run --json",
      cwd,
      sourceRoot: join(cwd, "workflow-source"),
      packageRoot: join(cwd, "generated", "package"),
      sessionId: "session-live-workflows-failure",
      toolCallId: "tool-live-workflows-failure",
    });

    await expect(
      execTool.execute(
        "tool-live-workflows-failure",
        { cmd: "svvyx workflows run --json" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("unsupported_command");

    const outputEvents = store
      .getSessionState("session-live-workflows-failure")
      .events.filter((event) => event.kind === "command.output" && event.subject.id === command.id);
    expect(outputEvents).toEqual([
      expect.objectContaining({
        data: {
          stream: "stderr",
          source: "live-stream",
          text: expect.stringContaining('"code":"unsupported_command"'),
        },
      }),
    ]);
    expect(
      store
        .getSessionState("session-live-workflows-failure")
        .events.filter(
          (event) => event.kind === "command.progress" && event.subject.id === command.id,
        )
        .map((event) => event.data?.phase),
    ).toEqual(["started", "failed"]);
  });

  it("does not duplicate svvyx subprocess live output when the generic tracker settles the command", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    mkdirSync(join(packageRoot, "prompts"), { recursive: true });
    writeFileSync(
      join(packageRoot, "prompts", "ReviewPrompt.ts"),
      "export const ReviewPrompt = ``;\n",
    );
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: cwd,
        label: "svvy",
        cwd,
      },
      databasePath: join(cwd, "structured.sqlite"),
    });
    openStores.push(store);
    store.upsertPiSession({
      sessionId: "session-live-workflows-tracker",
      title: "Live workflow tracker",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      messageCount: 1,
      status: "running",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
    });
    const turn = store.startTurn({
      sessionId: "session-live-workflows-tracker",
      surfacePiSessionId: "session-live-workflows-tracker",
      requestSummary: "Run a workflow command",
    });
    const promptContext = createPromptExecutionContext({
      workspaceSessionId: "session-live-workflows-tracker",
      turnId: turn.id,
      surfacePiSessionId: "session-live-workflows-tracker",
      generatedAgentContextFingerprint: "generated_context_fingerprint_test",
      generatedAgentContextRevision: "generated_context_revision_test",
    });
    const tracker = createTrackerForTest(store, promptContext);
    const runtime = { current: promptContext };
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        runtime,
        store,
        workflowsGeneratedPackagePath: packageRoot,
        workflowsSourceRoot: sourceRoot,
      }).codingTools,
      "exec_command",
    );

    tracker.handleToolExecutionStart({
      toolCallId: "tool-live-workflows-tracker",
      toolName: "exec_command",
      args: { cmd: "svvyx workflows list --json" },
    });
    const result = await execTool.execute(
      "tool-live-workflows-tracker",
      { cmd: "svvyx workflows list --json" },
      new AbortController().signal,
      () => {},
    );
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-live-workflows-tracker",
      toolName: "exec_command",
      result,
      isError: false,
    });

    const snapshot = store.getSessionState("session-live-workflows-tracker");
    const command = snapshot.commands[0]!;
    expect(command.status).toBe("succeeded");
    expect(command.facts).toEqual({
      workflowExportCount: 1,
    });
    expect(
      snapshot.events.filter(
        (event) => event.kind === "command.output" && event.subject.id === command.id,
      ),
    ).toEqual([
      expect.objectContaining({
        data: {
          stream: "stdout",
          source: "live-stream",
          text: readText(result),
        },
      }),
    ]);
  });

  it("persists long-running exec_command continuation output and final facts", async () => {
    const cwd = createTempDir();
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: cwd,
        label: "svvy",
        cwd,
      },
      databasePath: join(cwd, "structured.sqlite"),
    });
    openStores.push(store);
    store.upsertPiSession({
      sessionId: "session-running-exec",
      title: "Running exec",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      messageCount: 1,
      status: "running",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
    });
    const turn = store.startTurn({
      sessionId: "session-running-exec",
      surfacePiSessionId: "session-running-exec",
      requestSummary: "Run a long command",
    });
    const runtime = {
      current: createPromptExecutionContext({
        workspaceSessionId: "session-running-exec",
        turnId: turn.id,
        surfacePiSessionId: "session-running-exec",
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      }),
    };
    const command = store.createCommand({
      turnId: turn.id,
      toolName: "exec_command",
      executor: "orchestrator",
      visibility: "summary",
      title: "Run exec_command",
      summary: "Run a long command.",
      arguments: { cmd: "read line; echo got:$line; echo err:$line >&2" },
      facts: { toolCallId: "tool-running-exec" },
    });
    store.startCommand(command.id);
    const tools = createSvvyDirectToolsForTest({ cwd, runtime, store }).codingTools;
    const execTool = findTool(tools, "exec_command");
    const stdinTool = findTool(tools, "write_stdin");

    const started = await execTool.execute(
      "tool-running-exec",
      { cmd: "read line; echo got:$line; echo err:$line >&2", timeout: 1 },
      new AbortController().signal,
      () => {},
    );
    const sessionId = readText(started).match(/session_id: (\S+)/)?.[1];
    expect(sessionId).toBeTruthy();

    await stdinTool.execute(
      "tool-running-stdin",
      { session_id: sessionId, input: "hello\n" },
      new AbortController().signal,
      () => {},
    );
    await sleep(50);
    await stdinTool.execute(
      "tool-running-drain",
      { session_id: sessionId, input: "" },
      new AbortController().signal,
      () => {},
    );

    const snapshot = store.getSessionState("session-running-exec");
    const storedCommand = snapshot.commands.find((candidate) => candidate.id === command.id);
    expect(storedCommand).toMatchObject({
      status: "succeeded",
      facts: {
        stdout: "got:hello\n",
        stderr: "err:hello\n",
        exitCode: 0,
        exitSignal: null,
      },
    });
    expect(
      snapshot.events.filter(
        (event) => event.kind === "command.output" && event.subject.id === command.id,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: {
            stream: "stdout",
            source: "live-stream",
            text: "got:hello\n",
          },
        }),
        expect.objectContaining({
          data: {
            stream: "stderr",
            source: "live-stream",
            text: "err:hello\n",
          },
        }),
      ]),
    );
  });

  it("retains large long-running exec_command continuation output", async () => {
    const cwd = createTempDir();
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: cwd,
        label: "svvy",
        cwd,
        artifactDir: join(cwd, "artifact-store"),
      },
      databasePath: join(cwd, "structured.sqlite"),
    });
    openStores.push(store);
    store.upsertPiSession({
      sessionId: "session-running-retained-exec",
      title: "Running retained exec",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      messageCount: 1,
      status: "running",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
    });
    const turn = store.startTurn({
      sessionId: "session-running-retained-exec",
      surfacePiSessionId: "session-running-retained-exec",
      requestSummary: "Run a long command",
    });
    const runtime = {
      current: createPromptExecutionContext({
        workspaceSessionId: "session-running-retained-exec",
        turnId: turn.id,
        surfacePiSessionId: "session-running-retained-exec",
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      }),
    };
    const command = store.createCommand({
      turnId: turn.id,
      toolName: "exec_command",
      executor: "orchestrator",
      visibility: "summary",
      title: "Run exec_command",
      summary: "Run a long command.",
      arguments: { cmd: "read line; bun -e \"console.log('z'.repeat(70000))\"" },
      facts: { toolCallId: "tool-running-retained-exec" },
    });
    store.startCommand(command.id);
    const tools = createSvvyDirectToolsForTest({ cwd, runtime, store }).codingTools;
    const execTool = findTool(tools, "exec_command");
    const stdinTool = findTool(tools, "write_stdin");

    const started = await execTool.execute(
      "tool-running-retained-exec",
      { cmd: "read line; bun -e \"console.log('z'.repeat(70000))\"", timeout: 1 },
      new AbortController().signal,
      () => {},
    );
    const sessionId = readText(started).match(/session_id: (\S+)/)?.[1];
    expect(sessionId).toBeTruthy();

    await stdinTool.execute(
      "tool-running-retained-stdin",
      { session_id: sessionId, input: "go\n" },
      new AbortController().signal,
      () => {},
    );
    await sleep(100);
    await stdinTool.execute(
      "tool-running-retained-drain",
      { session_id: sessionId, input: "" },
      new AbortController().signal,
      () => {},
    );

    const snapshot = store.getSessionState("session-running-retained-exec");
    const artifacts = snapshot.artifacts;
    expect(artifacts).toHaveLength(1);
    const retainedArtifact = artifacts[0]!;
    if (!retainedArtifact.path) {
      throw new Error("Retained long-running output artifact path missing.");
    }
    expect(readFileSync(retainedArtifact.path, "utf8")).toContain("z".repeat(70000));
    const storedCommand = snapshot.commands.find((candidate) => candidate.id === command.id);
    expect(storedCommand).toMatchObject({
      status: "succeeded",
      facts: {
        stderr: "",
        exitCode: 0,
        exitSignal: null,
        retainedOutputArtifacts: [
          {
            artifactId: retainedArtifact.id,
            bytes: retainedArtifact.bytes,
            name: retainedArtifact.name,
            stream: "stdout",
          },
        ],
      },
    });
    expect(storedCommand?.facts).not.toHaveProperty("stdout");
    const outputEventText = snapshot.events
      .filter((event) => event.kind === "command.output" && event.subject.id === command.id)
      .map((event) => (event.data as { text?: unknown }).text)
      .filter((text): text is string => typeof text === "string")
      .join("");
    expect(outputEventText).toContain("Output exceeded the live event retention limit.");
    expect(outputEventText).not.toContain("z".repeat(70000));
  });

  it("does not mark unsandboxed long-running output as sandbox-denied", async () => {
    const cwd = createTempDir();
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: cwd,
        label: "svvy",
        cwd,
      },
      databasePath: join(cwd, "structured.sqlite"),
    });
    openStores.push(store);
    store.upsertPiSession({
      sessionId: "session-unsandboxed-long-running",
      title: "Unsandboxed long running",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      messageCount: 1,
      status: "running",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
    });
    const turn = store.startTurn({
      sessionId: "session-unsandboxed-long-running",
      surfacePiSessionId: "session-unsandboxed-long-running",
      requestSummary: "Run a command",
    });
    const promptContext = createPromptExecutionContext({
      workspaceSessionId: "session-unsandboxed-long-running",
      turnId: turn.id,
      surfacePiSessionId: "session-unsandboxed-long-running",
      generatedAgentContextFingerprint: "generated_context_fingerprint_test",
      generatedAgentContextRevision: "generated_context_revision_test",
    });
    const tracker = createTrackerForTest(store, promptContext);
    const tools = createSvvyDirectToolsForTest({
      cwd,
      runtime: { current: promptContext },
      store,
      managedSandbox: false,
    }).codingTools;
    const execTool = findTool(tools, "exec_command");
    const stdinTool = findTool(tools, "write_stdin");

    tracker.handleToolExecutionStart({
      toolCallId: "tool-unsandboxed-long-running",
      toolName: "exec_command",
      args: {
        cmd: "read line; printf 'Sandbox: synthetic denial\\n' >&2; exit 1",
      },
    });
    const started = await execTool.execute(
      "tool-unsandboxed-long-running",
      { cmd: "read line; printf 'Sandbox: synthetic denial\\n' >&2; exit 1", timeout: 1 },
      new AbortController().signal,
      () => {},
    );
    const sessionId = readText(started).match(/session_id: (\S+)/)?.[1];
    expect(sessionId).toBeTruthy();
    await stdinTool.execute(
      "tool-unsandboxed-long-running-stdin",
      { session_id: sessionId, input: "go\n" },
      new AbortController().signal,
      () => {},
    );
    await sleep(50);
    const completed = await stdinTool.execute(
      "tool-unsandboxed-long-running-finish",
      { session_id: sessionId, input: "" },
      new AbortController().signal,
      () => {},
    );
    tracker.handleToolExecutionEnd({
      toolCallId: "tool-unsandboxed-long-running",
      toolName: "exec_command",
      result: completed,
      isError: true,
    });

    const rollup = buildStructuredSessionView(
      store.getSessionState("session-unsandboxed-long-running"),
    ).commandRollups[0];
    expect(rollup?.facts).toMatchObject({ exitCode: 1 });
    expect(rollup?.facts).not.toHaveProperty("sandboxDenied");
  });

  it("runs shell commands without the network-disabled sandbox by default", async () => {
    const cwd = createTempDir();
    const defaultExecTool = findTool(
      createSvvyDirectToolsForTest({ cwd }).codingTools,
      "exec_command",
    );
    const allowed = await defaultExecTool.execute(
      "tool-shell-network-default",
      { cmd: "echo shell-ok" },
      new AbortController().signal,
      () => {},
    );
    expect(readText(allowed)).toContain("shell-ok");
    expect(readText(allowed)).toContain("exit code: 0");
  });

  it("keeps network-disabled shell commands on the test seam unless managed sandbox is enabled", async () => {
    const cwd = createTempDir();
    const blockedExecTool = findTool(
      createSvvyDirectToolsForTest({ cwd, networkAccess: false }).codingTools,
      "exec_command",
    );

    const blocked = await blockedExecTool.execute(
      "tool-shell-network-disabled",
      { cmd: "echo sandbox-ok" },
      new AbortController().signal,
      () => {},
    );

    const output = readText(blocked);
    expect(output).toContain("sandbox-ok");
    expect(output).toContain("exit code: 0");
  });

  it("requires runtime launch facts for managed shell commands", async () => {
    const cwd = createTempDir();
    const execTool = findTool(
      createSvvyDirectToolsForTest({ cwd, managedSandbox: true, networkAccess: false }).codingTools,
      "exec_command",
    );

    await expect(
      execTool.execute(
        "tool-shell-managed-sandbox",
        { cmd: "echo sandbox-managed-ok" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Runtime launch acquisition for exec_command is required.");
  });

  it("runs shell commands from runtime-acquired launch facts when provided", async () => {
    const cwd = createTempDir();
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: "workspace-runtime-launch",
        label: "svvy",
        cwd,
        artifactDir: join(cwd, "artifacts"),
      },
      databasePath: join(cwd, "structured.sqlite"),
    });
    openStores.push(store);
    const turn = store.startTurn({
      sessionId: "session-runtime-launch",
      surfacePiSessionId: "session-runtime-launch",
      requestSummary: "Run command",
    });
    const runtime = {
      current: createPromptExecutionContext({
        workspaceSessionId: "session-runtime-launch",
        turnId: turn.id,
        surfacePiSessionId: "session-runtime-launch",
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      }),
    };
    const command = store.createCommand({
      turnId: turn.id,
      toolName: "exec_command",
      executor: "orchestrator",
      visibility: "summary",
      title: "Run exec_command",
      summary: "Run a command.",
      arguments: { cmd: "echo ignored" },
      facts: { toolCallId: "tool-runtime-launch-shell" },
    });
    store.startCommand(command.id);
    let closed = false;
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workspaceId: "workspace-runtime-launch",
        runtime,
        store,
        acquireDirectToolLaunch: async (input) => {
          expect(input.toolName).toBe("exec_command");
          expect(input.commandId).toBe(command.id as CommandId);
          return {
            facts: testLaunchFacts({
              cwd,
              launchKind: "direct_shell",
              commandId: command.id,
              command: [process.execPath, "-e", "process.stdout.write('runtime-launch-shell')"],
            }),
            async close() {
              closed = true;
            },
          };
        },
      }).codingTools,
      "exec_command",
    );

    const result = await execTool.execute(
      "tool-runtime-launch-shell",
      { cmd: "echo ignored" },
      new AbortController().signal,
      () => {},
    );

    expect(readText(result)).toContain("runtime-launch-shell");
    expect(readText(result)).not.toContain("ignored");
    expect(closed).toBe(true);
  });

  it("allows loopback networking through the default non-managed exec_command tool", async () => {
    const server = startLoopbackTextServer();
    if (!server) {
      expect(server).toBeNull();
      return;
    }
    try {
      const cwd = createTempDir();
      const defaultExecTool = findTool(
        createSvvyDirectToolsForTest({ cwd }).codingTools,
        "exec_command",
      );
      const allowed = await defaultExecTool.execute(
        "tool-shell-loopback-network-default",
        { cmd: `bun -e "console.log(await (await fetch('${server.url}')).text())"` },
        new AbortController().signal,
        () => {},
      );

      expect(readText(allowed)).toContain("network-ok");
      expect(readText(allowed)).toContain("exit code: 0");
    } finally {
      server.stop();
    }
  });

  it("lists generated Workflows exports through the svvyx command family", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    mkdirSync(join(packageRoot, "agents"), { recursive: true });
    mkdirSync(join(packageRoot, "components"), { recursive: true });
    writeFileSync(
      join(packageRoot, "agents", "reviewerAgent.ts"),
      [
        "export const reviewerAgent = {",
        '  id: "review-agent",',
        '  label: "Reviewer",',
        "} satisfies Agents.TaskAgentParametersSource;",
      ].join("\n"),
    );
    writeFileSync(
      join(packageRoot, "agents", "index.ts"),
      [
        'export { reviewerAgent } from "./reviewerAgent";',
        "export function defineTaskAgent() { return null; }",
      ].join("\n"),
    );
    writeFileSync(
      join(packageRoot, "components", "ReviewPanel.tsx"),
      "export function ReviewPanel() { return null; }\n",
    );
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workflowsGeneratedPackagePath: packageRoot,
        workflowsSourceRoot: sourceRoot,
      }).codingTools,
      "exec_command",
    );

    const result = await execTool.execute(
      "tool-workflows-list",
      { cmd: "svvyx workflows list --json" },
      new AbortController().signal,
      () => {},
    );
    const output = JSON.parse(readText(result));

    expect(output.items).toEqual([
      {
        kind: "agent",
        namespace: "Agents",
        exportName: "reviewerAgent",
        qualifiedName: "Agents.reviewerAgent",
        workflowAgentId: "review-agent",
        sourcePath: join(sourceRoot, "agents", "reviewerAgent.agent.json"),
        generatedPath: join(packageRoot, "agents", "reviewerAgent.ts"),
      },
      {
        kind: "component",
        namespace: "Components",
        exportName: "ReviewPanel",
        qualifiedName: "Components.ReviewPanel",
        workflowAgentId: null,
        sourcePath: join(sourceRoot, "components", "ReviewPanel.tsx"),
        generatedPath: join(packageRoot, "components", "ReviewPanel.tsx"),
      },
    ]);
    expect(output.items[0]).not.toHaveProperty("generatedCode");
    expect(output.items[0]).not.toHaveProperty("agentParameters");
    expect(result.details?.commandFacts).toEqual({
      workflowExportCount: 2,
    });
  });

  it("filters generated Workflows exports by kind and rejects removed workflow commands", async () => {
    const cwd = createTempDir();
    const packageRoot = join(cwd, "generated", "package");
    mkdirSync(join(packageRoot, "agents"), { recursive: true });
    mkdirSync(join(packageRoot, "prompts"), { recursive: true });
    writeFileSync(
      join(packageRoot, "agents", "reviewerAgent.ts"),
      "export const reviewerAgent = {};\n",
    );
    writeFileSync(
      join(packageRoot, "prompts", "ReviewPrompt.ts"),
      "export const ReviewPrompt = ``;\n",
    );
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workflowsGeneratedPackagePath: packageRoot,
        workflowsSourceRoot: join(cwd, "source"),
      }).codingTools,
      "exec_command",
    );

    const filtered = await execTool.execute(
      "tool-workflows-list-filtered",
      { cmd: "svvyx workflows list --kind prompt --json" },
      new AbortController().signal,
      () => {},
    );
    expect(JSON.parse(readText(filtered)).items.map((item: { kind: string }) => item.kind)).toEqual(
      ["prompt"],
    );
    expect(filtered.details?.commandFacts).toEqual({
      workflowExportCount: 1,
      workflowExportKind: "prompt",
    });

    await expect(
      execTool.execute(
        "tool-workflows-run-rejected",
        { cmd: "svvyx workflows run --json" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("unsupported_command");
  });

  it("emits a generated Workflows package signal after successful svvyx workflows build", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    const events: unknown[] = [];
    mkdirSync(join(sourceRoot, "prompts"), { recursive: true });
    writeFileSync(join(sourceRoot, "prompts", "ReviewPrompt.mdx"), "# Review\n");
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        applyWorkflowsRuntimeRequest: async () => ({
          output: { ok: true, generatedPackagePath: packageRoot },
          commandFacts: {
            workflowBuildOk: true,
            workflowDiagnosticCount: 0,
            workflowExportCount: 1,
          },
        }),
        cwd,
        workflowsGeneratedPackagePath: packageRoot,
        workflowsModelCatalog: () => [],
        workflowsSourceRoot: sourceRoot,
        onWorkflowsGeneratedPackageChanged: (event) => {
          events.push(event);
        },
      }).codingTools,
      "exec_command",
    );

    await execTool.execute(
      "tool-workflows-list-no-signal",
      { cmd: "svvyx workflows list --json" },
      new AbortController().signal,
      () => {},
    );
    expect(events).toEqual([]);

    const built = await execTool.execute(
      "tool-workflows-build-signal",
      { cmd: "svvyx workflows build --json" },
      new AbortController().signal,
      () => {},
    );

    expect(JSON.parse(readText(built))).toMatchObject({
      ok: true,
      generatedPackagePath: packageRoot,
    });
    expect(events).toEqual([
      {
        reason: "svvyx-workflows-build",
        commandFacts: {
          workflowBuildOk: true,
          workflowDiagnosticCount: 0,
          workflowExportCount: 1,
        },
      },
    ]);
  });

  it("lists Workflows model choices from app model and auth metadata without provider calls", async () => {
    const cwd = createTempDir();
    let catalogReadCount = 0;
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workflowsModelCatalog: () => {
          catalogReadCount += 1;
          return [
            {
              providerId: "openai",
              modelId: "gpt-5.4",
              providerAuthenticated: true,
              authSource: "oauth",
              supportedReasoning: ["off", "low", "medium", "high"],
              capabilities: {
                reasoning: true,
                vision: true,
                toolCalling: true,
              },
            },
            {
              providerId: "anthropic",
              modelId: "claude-sonnet-4-5",
              providerAuthenticated: false,
              authSource: "missing",
              supportedReasoning: ["off"],
              capabilities: {
                reasoning: false,
                vision: false,
                toolCalling: true,
              },
            },
          ];
        },
      }).codingTools,
      "exec_command",
    );

    const result = await execTool.execute(
      "tool-workflows-models-list",
      { cmd: "svvyx workflows models list --json" },
      new AbortController().signal,
      () => {},
    );
    const output = JSON.parse(readText(result));

    expect(catalogReadCount).toBe(1);
    expect(output.items).toEqual([
      {
        providerId: "openai",
        modelId: "gpt-5.4",
        providerAuthenticated: true,
        authSource: "oauth",
        supportedReasoning: ["off", "low", "medium", "high"],
        capabilities: {
          reasoning: true,
          vision: true,
          toolCalling: true,
        },
      },
      {
        providerId: "anthropic",
        modelId: "claude-sonnet-4-5",
        providerAuthenticated: false,
        authSource: "missing",
        supportedReasoning: ["off"],
        capabilities: {
          reasoning: false,
          vision: false,
          toolCalling: true,
        },
      },
    ]);
    expect(output.items[0]).not.toHaveProperty("apiKey");
    expect(output.items[0]).not.toHaveProperty("providerModelSummary");
    expect(result.details?.commandFacts).toEqual({
      workflowModelChoiceCount: 2,
      workflowProviderCount: 2,
    });

    await expect(
      execTool.execute(
        "tool-workflows-models-filter-rejected",
        { cmd: "svvyx workflows models list --provider openai --json" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Unsupported option: --provider");
    await expect(
      execTool.execute(
        "tool-workflows-models-run-rejected",
        { cmd: "svvyx workflows models run --json" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Unsupported Workflows models command: run");
    await expect(
      execTool.execute(
        "tool-workflows-execute-rejected",
        { cmd: "svvyx workflows execute --json" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Unsupported Workflows command: execute");
  });

  it("rejects workflow save sources outside workspace-owned .smithers source files", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    const outsidePromptPath = join(cwd, "outside-review-prompt.mdx");
    const generatedPromptPath = join(
      cwd,
      ".smithers",
      "node_modules",
      "@svvyx",
      "workflows",
      "prompts",
      "ReviewPrompt.ts",
    );
    const events: unknown[] = [];
    mkdirSync(join(cwd, ".smithers", "prompts"), { recursive: true });
    mkdirSync(dirname(generatedPromptPath), { recursive: true });
    writeFileSync(outsidePromptPath, "# Outside\n");
    writeFileSync(generatedPromptPath, "export const ReviewPrompt = {};\n");
    symlinkSync(outsidePromptPath, join(cwd, ".smithers", "prompts", "outside-link.mdx"));
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workflowsGeneratedPackagePath: packageRoot,
        workflowsModelCatalog: () => [],
        workflowsSourceRoot: sourceRoot,
        onWorkflowsGeneratedPackageChanged: (event) => {
          events.push(event);
        },
      }).codingTools,
      "exec_command",
    );

    await expect(
      execTool.execute(
        "tool-workflows-save-outside-smithers-rejected",
        {
          cmd: "svvyx workflows save --from outside-review-prompt.mdx --kind prompt --as OutsidePrompt --json",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("workspace .smithers source file");
    expect(existsSync(join(sourceRoot, "prompts", "OutsidePrompt.mdx"))).toBe(false);
    expect(events).toHaveLength(0);

    await expect(
      execTool.execute(
        "tool-workflows-save-smithers-symlink-escape-rejected",
        {
          cmd: "svvyx workflows save --from .smithers/prompts/outside-link.mdx --kind prompt --as SymlinkPrompt --json",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("workspace .smithers source file");
    expect(existsSync(join(sourceRoot, "prompts", "SymlinkPrompt.mdx"))).toBe(false);
    expect(events).toHaveLength(0);

    await expect(
      execTool.execute(
        "tool-workflows-save-generated-link-source-rejected",
        {
          cmd: "svvyx workflows save --from .smithers/node_modules/@svvyx/workflows/prompts/ReviewPrompt.ts --kind component --as GeneratedPromptSource --json",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("workspace .smithers source file");
    expect(existsSync(join(sourceRoot, "components", "GeneratedPromptSource.ts"))).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("saves workflow agents from static defineTaskAgent exports and rolls back dynamic inputs", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    mkdirSync(join(cwd, ".smithers", "workflows"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "agents", "defaultAgent.agent.json"),
      JSON.stringify(
        {
          id: "defaultAgent",
          label: "Default",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "low" },
          instructions: "Handle the task.",
          overrides: { shell: "loaded" },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(cwd, ".smithers", "workflows", "agents.ts"),
      [
        "export const reviewerSource = Agents.defineTaskAgent({",
        "  ...Agents.defaultAgent,",
        '  id: "sourceReviewer",',
        '  label: "Reviewer",',
        '  reasoning: { effort: "medium" },',
        '  instructions: "Review strictly.",',
        '  overrides: { shell: "loaded" },',
        "});",
      ].join("\n"),
    );
    writeFileSync(
      join(cwd, ".smithers", "workflows", "dynamic-agent.ts"),
      [
        'const model = "gpt-5.4";',
        "export const dynamicSource = Agents.defineTaskAgent({",
        '  id: "dynamicAgent",',
        '  label: "Dynamic",',
        '  provider: "openai",',
        "  model,",
        '  reasoning: { effort: "medium" },',
        '  instructions: "Review strictly.",',
        '  overrides: { shell: "loaded" },',
        "});",
      ].join("\n"),
    );
    const appliedAgentProfileMutations: AgentProfileMutation[] = [];
    const parentOrder: string[] = [];
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        agentProfileSnapshot: createTestAgentProfileSnapshot(),
        applyAgentProfileMutations: async (mutations) => {
          appliedAgentProfileMutations.push(...structuredClone(mutations));
          parentOrder.push("mutation-committed");
        },
        applyWorkflowsRuntimeRequest: async () => {
          expect(appliedAgentProfileMutations).toHaveLength(1);
          parentOrder.push("runtime-build-committed");
          return {
            output: { ok: true },
            commandFacts: { workflowBuildOk: true, workflowExportCount: 1 },
          };
        },
        cwd,
        workflowsGeneratedPackagePath: packageRoot,
        workflowsModelCatalog: () => [
          {
            providerId: "openai",
            modelId: "gpt-5.4",
            providerAuthenticated: true,
            authSource: "oauth",
            supportedReasoning: ["off", "low", "medium", "high"],
            capabilities: {
              reasoning: true,
              vision: true,
              toolCalling: true,
            },
          },
        ],
        workflowsSourceRoot: sourceRoot,
      }).codingTools,
      "exec_command",
    );

    const saved = await execTool.execute(
      "tool-workflows-save-agent",
      {
        cmd: "svvyx workflows save --from .smithers/workflows/agents.ts --kind agent --export reviewerSource --as reviewerAgent --json",
      },
      new AbortController().signal,
      () => {},
    );

    expect(JSON.parse(readText(saved))).toMatchObject({
      ok: true,
      kind: "agent",
      exportName: "reviewerAgent",
      sourcePath: join(sourceRoot, "agents", "reviewerAgent.agent.json"),
    });
    expect(existsSync(join(sourceRoot, "agents", "reviewerAgent.agent.json"))).toBe(false);
    expect(existsSync(join(packageRoot, "agents", "reviewerAgent.ts"))).toBe(false);
    expect(appliedAgentProfileMutations).toHaveLength(1);
    expect(parentOrder).toEqual(["mutation-committed", "runtime-build-committed"]);
    expect(appliedAgentProfileMutations[0]).toMatchObject({
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
    if (appliedAgentProfileMutations[0]?.kind !== "workflow-agent-source.upsert") {
      throw new Error("Expected a workflow-agent source upsert mutation.");
    }
    expect(JSON.parse(appliedAgentProfileMutations[0].text)).toMatchObject({
      id: "reviewerAgent",
      label: "Reviewer",
      provider: "openai",
      model: "gpt-5.4",
      reasoning: { effort: "medium" },
      overrides: { shell: "loaded" },
    });

    await expect(
      execTool.execute(
        "tool-workflows-save-dynamic-agent-rejected",
        {
          cmd: "svvyx workflows save --from .smithers/workflows/dynamic-agent.ts --kind agent --export dynamicSource --as dynamicAgent --json",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("invalid_agent_source");
    expect(existsSync(join(sourceRoot, "agents", "dynamicAgent.agent.json"))).toBe(false);
    expect(appliedAgentProfileMutations).toHaveLength(1);
  });

  it("applies unified patches through apply_patch", async () => {
    const cwd = createTempDir();
    writeFileSync(join(cwd, "target.txt"), "old\n");
    const patchTool = findTool(createSvvyDirectToolsForTest({ cwd }).codingTools, "apply_patch");

    const result = await patchTool.execute(
      "tool-patch",
      {
        patch: ["--- target.txt", "+++ target.txt", "@@ -1 +1 @@", "-old", "+new", ""].join("\n"),
      },
      new AbortController().signal,
      () => {},
    );

    expect(readFileSync(join(cwd, "target.txt"), "utf8")).toBe("new\n");
    expect(result.details?.commandFacts).toEqual({
      changedFiles: ["target.txt"],
      createdFiles: [],
      deletedFiles: [],
      errors: [],
    });
  });

  it("requires runtime launch facts for managed apply_patch commands", async () => {
    const cwd = createTempDir();
    writeFileSync(join(cwd, "managed.txt"), "before\n");
    const patchTool = findTool(
      createSvvyDirectToolsForTest({ cwd, managedSandbox: true }).codingTools,
      "apply_patch",
    );

    const patch = [
      "--- managed.txt",
      "+++ managed.txt",
      "@@ -1 +1 @@",
      "-before",
      "+after",
      "",
    ].join("\n");

    await expect(
      patchTool.execute(
        "tool-patch-managed-sandbox",
        { patch },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Runtime launch acquisition for apply_patch is required.");
    expect(readFileSync(join(cwd, "managed.txt"), "utf8")).toBe("before\n");
  });

  it("runs apply_patch from runtime-acquired launch facts when provided", async () => {
    const cwd = createTempDir();
    writeFileSync(join(cwd, "runtime-patch.txt"), "before\n");
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: "workspace-runtime-patch",
        label: "svvy",
        cwd,
        artifactDir: join(cwd, "artifacts"),
      },
      databasePath: join(cwd, "structured.sqlite"),
    });
    openStores.push(store);
    const turn = store.startTurn({
      sessionId: "session-runtime-patch",
      surfacePiSessionId: "session-runtime-patch",
      requestSummary: "Apply patch",
    });
    const runtime = {
      current: createPromptExecutionContext({
        workspaceSessionId: "session-runtime-patch",
        turnId: turn.id,
        surfacePiSessionId: "session-runtime-patch",
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      }),
    };
    const command = store.createCommand({
      turnId: turn.id,
      toolName: "apply_patch",
      executor: "orchestrator",
      visibility: "summary",
      title: "Run apply_patch",
      summary: "Apply patch.",
      arguments: { patch: "ignored by test" },
      facts: { toolCallId: "tool-runtime-launch-patch" },
    });
    store.startCommand(command.id);
    let closed = false;
    const patchTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workspaceId: "workspace-runtime-patch",
        runtime,
        store,
        acquireDirectToolLaunch: async (input) => {
          expect(input.toolName).toBe("apply_patch");
          expect(input.commandId).toBe(command.id as CommandId);
          return {
            facts: testLaunchFacts({
              cwd,
              launchKind: "direct_apply_patch",
              commandId: command.id,
              command: ["patch", "-p0", "--forward"],
            }),
            async close() {
              closed = true;
            },
          };
        },
      }).codingTools,
      "apply_patch",
    );

    const result = await patchTool.execute(
      "tool-runtime-launch-patch",
      {
        patch: [
          "--- runtime-patch.txt",
          "+++ runtime-patch.txt",
          "@@ -1 +1 @@",
          "-before",
          "+after",
          "",
        ].join("\n"),
      },
      new AbortController().signal,
      () => {},
    );

    expect(readText(result)).toContain("runtime-patch.txt");
    expect(readFileSync(join(cwd, "runtime-patch.txt"), "utf8")).toBe("after\n");
    expect(closed).toBe(true);
  });

  it("retries managed apply_patch sandbox denials only after approval", async () => {
    const cwd = createTempDir();
    writeFileSync(join(cwd, "managed-denied.txt"), "before\n");
    const approvalRequests: unknown[] = [];
    const harness = createRuntimeLaunchDirectToolsForTest({
      command: [
        "/bin/sh",
        "-c",
        "printf 'Sandbox: deny(1) file-write-data managed-denied.txt\\nOperation not permitted\\n' >&2; exit 1",
      ],
      cwd,
      launchKind: "direct_apply_patch",
      options: {
        approvalBoundary: (request) => {
          approvalRequests.push(request);
          return { approved: true };
        },
      },
      toolCallId: "tool-patch-managed-sandbox-denial",
      toolName: "apply_patch",
      launchFacts: (commandId) =>
        testLaunchFacts({
          command: [
            "/bin/sh",
            "-c",
            "printf 'Sandbox: deny(1) file-write-data managed-denied.txt\\nOperation not permitted\\n' >&2; exit 1",
          ],
          commandId,
          cwd,
          filesystemPolicy: {
            defaultAccess: "read",
            entries: [
              {
                access: "write",
                path: cwd as AbsolutePath,
                recursive: true,
                source: "workspace",
              },
            ],
          },
          launchKind: "direct_apply_patch",
          mode: "managed",
        }),
    });
    const patchTool = findTool(harness.tools.codingTools, "apply_patch");
    const patch = [
      "--- managed-denied.txt",
      "+++ managed-denied.txt",
      "@@ -1 +1 @@",
      "-before",
      "+after",
      "",
    ].join("\n");

    await patchTool.execute(
      "tool-patch-managed-sandbox-denial",
      { patch },
      new AbortController().signal,
      () => {},
    );
    expect(readFileSync(join(cwd, "managed-denied.txt"), "utf8")).toBe("after\n");
    expect(approvalRequests).toEqual([
      expect.objectContaining({
        patch,
        toolCallId: "tool-patch-managed-sandbox-denial",
        toolName: "apply_patch",
      }),
      expect.objectContaining({
        context: expect.objectContaining({
          reason: "sandbox_denial_escalation",
          sandboxDenied: true,
        }),
        patch,
        toolCallId: "tool-patch-managed-sandbox-denial",
        toolName: "apply_patch",
      }),
    ]);
    expect(harness.closed()).toBe(true);
  });

  it("reports failed apply_patch attempts with structured patch facts", async () => {
    const cwd = createTempDir();
    const patchTool = findTool(createSvvyDirectToolsForTest({ cwd }).codingTools, "apply_patch");

    const error = await patchTool
      .execute(
        "tool-patch-failed",
        {
          patch: ["--- missing.txt", "+++ missing.txt", "@@ -1 +1 @@", "-old", "+new", ""].join(
            "\n",
          ),
        },
        new AbortController().signal,
        () => {},
      )
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    const payload = JSON.parse((error as Error).message);
    expect(payload.error.code).toBe("apply_patch_failed");
    expect(typeof payload.error.message).toBe("string");
    expect(payload.error.message).not.toBe("");
    expect(payload.commandFacts.changedFiles).toEqual(["missing.txt"]);
    expect(payload.commandFacts.createdFiles).toEqual([]);
    expect(payload.commandFacts.deletedFiles).toEqual([]);
    expect(payload.commandFacts.errors).toHaveLength(1);
    expect(typeof payload.commandFacts.errors[0]).toBe("string");
    expect(payload.commandFacts.errors[0]).toBe(payload.error.message);
  });

  it("rejects direct edits to generated Workflows output and workspace package links", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "source");
    const packageRoot = join(cwd, "generated", "package");
    const extensionsPackageRoot = join(cwd, "generated", "extensions-package");
    const generatedFile = join(packageRoot, "prompts", "GeneratedPrompt.ts");
    const generatedExtensionFile = join(extensionsPackageRoot, "index.ts");
    const workspaceLinkFile = join(
      cwd,
      ".smithers",
      "node_modules",
      "@svvyx",
      "workflows",
      "prompts",
      "GeneratedPrompt.ts",
    );
    const workspaceExtensionsLinkFile = join(
      cwd,
      ".smithers",
      "node_modules",
      "@svvyx",
      "extensions",
      "index.ts",
    );
    mkdirSync(join(sourceRoot, "prompts"), { recursive: true });
    mkdirSync(join(packageRoot, "prompts"), { recursive: true });
    mkdirSync(extensionsPackageRoot, { recursive: true });
    mkdirSync(join(cwd, ".smithers", "node_modules", "@svvyx", "workflows", "prompts"), {
      recursive: true,
    });
    mkdirSync(join(cwd, ".smithers", "node_modules", "@svvyx", "extensions"), {
      recursive: true,
    });
    writeFileSync(join(sourceRoot, "prompts", "ReviewPrompt.mdx"), "# Review\n");
    writeFileSync(generatedFile, "export const GeneratedPrompt = 'old';\n");
    writeFileSync(generatedExtensionFile, "export const Extensions = { git: 'git' };\n");
    writeFileSync(workspaceLinkFile, "export const GeneratedPrompt = 'old link';\n");
    writeFileSync(workspaceExtensionsLinkFile, "export const Extensions = { github: 'github' };\n");
    const tools = createSvvyDirectToolsForTest({
      cwd,
      workflowsExtensionsGeneratedPackagePath: extensionsPackageRoot,
      workflowsGeneratedPackagePath: packageRoot,
      workflowsSourceRoot: sourceRoot,
    }).codingTools;
    const patchTool = findTool(tools, "apply_patch");
    const execTool = findTool(tools, "exec_command");
    const stdinTool = findTool(tools, "write_stdin");

    await expect(
      patchTool.execute(
        "tool-patch-generated-workflows-output",
        {
          patch: [
            "--- generated/package/prompts/GeneratedPrompt.ts",
            "+++ generated/package/prompts/GeneratedPrompt.ts",
            "@@ -1 +1 @@",
            "-export const GeneratedPrompt = 'old';",
            "+export const GeneratedPrompt = 'new';",
            "",
          ].join("\n"),
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
    await expect(
      patchTool.execute(
        "tool-patch-workflows-link",
        {
          patch: [
            "--- .smithers/node_modules/@svvyx/workflows/prompts/GeneratedPrompt.ts",
            "+++ .smithers/node_modules/@svvyx/workflows/prompts/GeneratedPrompt.ts",
            "@@ -1 +1 @@",
            "-export const GeneratedPrompt = 'old link';",
            "+export const GeneratedPrompt = 'new link';",
            "",
          ].join("\n"),
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
    await expect(
      patchTool.execute(
        "tool-patch-generated-extensions-output",
        {
          patch: [
            "--- generated/extensions-package/index.ts",
            "+++ generated/extensions-package/index.ts",
            "@@ -1 +1 @@",
            "-export const Extensions = { git: 'git' };",
            "+export const Extensions = { shell: 'shell' };",
            "",
          ].join("\n"),
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
    await expect(
      patchTool.execute(
        "tool-patch-extensions-link",
        {
          patch: [
            "--- .smithers/node_modules/@svvyx/extensions/index.ts",
            "+++ .smithers/node_modules/@svvyx/extensions/index.ts",
            "@@ -1 +1 @@",
            "-export const Extensions = { github: 'github' };",
            "+export const Extensions = { shell: 'shell' };",
            "",
          ].join("\n"),
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
    expect(readFileSync(generatedFile, "utf8")).toBe("export const GeneratedPrompt = 'old';\n");
    expect(readFileSync(generatedExtensionFile, "utf8")).toBe(
      "export const Extensions = { git: 'git' };\n",
    );
    expect(readFileSync(workspaceLinkFile, "utf8")).toBe(
      "export const GeneratedPrompt = 'old link';\n",
    );
    expect(readFileSync(workspaceExtensionsLinkFile, "utf8")).toBe(
      "export const Extensions = { github: 'github' };\n",
    );

    await expect(
      execTool.execute(
        "tool-shell-generated-workflows-output",
        { cmd: "printf hacked > generated/package/prompts/GeneratedPrompt.ts" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
    await expect(
      execTool.execute(
        "tool-shell-generated-workflows-workdir",
        { cmd: "printf hacked > prompts/GeneratedPrompt.ts", workdir: packageRoot },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
    await expect(
      execTool.execute(
        "tool-shell-generated-workflows-bun-write",
        {
          cmd: "bun -e \"Bun.write('generated/package/prompts/GeneratedPrompt.ts', 'hacked')\"",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
    await expect(
      execTool.execute(
        "tool-shell-generated-workflows-link-bun-write",
        {
          cmd: "bun -e \"Bun.write('.smithers/node_modules/@svvyx/workflows/prompts/GeneratedPrompt.ts', 'hacked link')\"",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
    await expect(
      execTool.execute(
        "tool-shell-generated-workflows-truncate",
        { cmd: "truncate -s 0 generated/package/prompts/GeneratedPrompt.ts" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
    await expect(
      execTool.execute(
        "tool-shell-generated-extensions-output",
        { cmd: "printf hacked > generated/extensions-package/index.ts" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
    await expect(
      execTool.execute(
        "tool-shell-generated-extensions-link-bun-write",
        {
          cmd: "bun -e \"Bun.write('.smithers/node_modules/@svvyx/extensions/index.ts', 'hacked extension link')\"",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
    expect(readFileSync(generatedFile, "utf8")).toBe("export const GeneratedPrompt = 'old';\n");
    expect(readFileSync(generatedExtensionFile, "utf8")).toBe(
      "export const Extensions = { git: 'git' };\n",
    );
    expect(readFileSync(workspaceLinkFile, "utf8")).toBe(
      "export const GeneratedPrompt = 'old link';\n",
    );
    expect(readFileSync(workspaceExtensionsLinkFile, "utf8")).toBe(
      "export const Extensions = { github: 'github' };\n",
    );

    const longRunning = await execTool.execute(
      "tool-shell-generated-workflows-long-running-write",
      {
        cmd: "printf pending > prompts/GeneratedPrompt.ts; read line; echo done:$line",
        workdir: packageRoot,
        timeout: 1,
      },
      new AbortController().signal,
      () => {},
    );
    const sessionId = readText(longRunning).match(/session_id: (\S+)/)?.[1];
    expect(sessionId).toBeTruthy();
    await stdinTool.execute(
      "tool-shell-generated-workflows-long-running-stdin",
      { session_id: sessionId, input: "ready\n" },
      new AbortController().signal,
      () => {},
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(
      stdinTool.execute(
        "tool-shell-generated-workflows-long-running-finished",
        { session_id: sessionId, input: "" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
    expect(readFileSync(generatedFile, "utf8")).toBe("export const GeneratedPrompt = 'old';\n");
    expect(readFileSync(generatedExtensionFile, "utf8")).toBe(
      "export const Extensions = { git: 'git' };\n",
    );
    expect(readFileSync(workspaceLinkFile, "utf8")).toBe(
      "export const GeneratedPrompt = 'old link';\n",
    );
    expect(readFileSync(workspaceExtensionsLinkFile, "utf8")).toBe(
      "export const Extensions = { github: 'github' };\n",
    );
    rmSync(join(cwd, ".smithers", "node_modules", "@svvyx", "workflows"), {
      force: true,
      recursive: true,
    });
    rmSync(join(cwd, ".smithers", "node_modules", "@svvyx", "extensions"), {
      force: true,
      recursive: true,
    });
  });

  it("does not classify public @svvy package links as generated workspace links by name", async () => {
    const cwd = createTempDir();
    const publicExtensionFile = join(
      cwd,
      ".smithers",
      "node_modules",
      "@svvy",
      "extensions",
      "index.ts",
    );
    mkdirSync(dirname(publicExtensionFile), { recursive: true });
    writeFileSync(publicExtensionFile, "export const publicPackage = 'before';\n");
    const patchTool = findTool(createSvvyDirectToolsForTest({ cwd }).codingTools, "apply_patch");

    await patchTool.execute(
      "tool-patch-public-svvy-extension-link",
      {
        patch: [
          "--- .smithers/node_modules/@svvy/extensions/index.ts",
          "+++ .smithers/node_modules/@svvy/extensions/index.ts",
          "@@ -1 +1 @@",
          "-export const publicPackage = 'before';",
          "+export const publicPackage = 'after';",
          "",
        ].join("\n"),
      },
      new AbortController().signal,
      () => {},
    );

    expect(readFileSync(publicExtensionFile, "utf8")).toBe(
      "export const publicPackage = 'after';\n",
    );
  });

  it("rejects direct edits to the generated @svvyx/extensions package path", async () => {
    const cwd = createTempDir();
    const extensionsRoot = createTempDir();
    const execTool = findTool(
      createSvvyDirectToolsForTest({ cwd, extensionsRoot }).codingTools,
      "exec_command",
    );
    const generatedExtensionsPath = join(extensionsRoot, "generated", "package");

    await expect(
      execTool.execute(
        "tool-shell-generated-extensions-output",
        { cmd: `printf hacked > ${generatedExtensionsPath}/index.ts` },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
  });

  it("rejects direct edits to the default generated @svvyx/extensions package path without touching the real home", () => {
    const cwd = createTempDir();
    const home = createTempDir();
    const script = String.raw`
const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
const { dirname, join } = await import("node:path");
const { createSvvyDirectTools } = await import("./src/bun/svvy-direct-tools.ts");

const cwd = process.env.SVVY_TEST_CWD;
const home = process.env.HOME;
if (!cwd || !home) {
  throw new Error("missing test paths");
}
const target = join(home, ".config", "svvy", "extensions", "generated", "package", "index.ts");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, "before\n");
const execTool = createSvvyDirectTools({ cwd }).codingTools.find((tool) => tool.name === "exec_command");
if (!execTool) {
  throw new Error("exec_command tool missing");
}
let rejected = false;
try {
  await execTool.execute(
    "tool-shell-default-generated-extensions-output",
    { cmd: "printf hacked > " + JSON.stringify(target) },
    new AbortController().signal,
    () => {},
  );
} catch (error) {
  rejected = String(error instanceof Error ? error.message : error).includes("Generated Workflows output");
}
if (!rejected) {
  throw new Error("default generated extensions path was not protected");
}
if (readFileSync(target, "utf8") !== "before\n") {
  throw new Error("default generated extensions file was modified");
}
`;
    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: home,
        SVVY_TEST_CWD: cwd,
      },
      encoding: "utf8",
    });

    if (result.status !== 0) {
      throw new Error(
        [
          "default generated extensions path child test failed",
          result.stdout.trim(),
          result.stderr.trim(),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  });

  it("lets full-access bypass direct generated-output write protection", async () => {
    const cwd = createTempDir();
    const packageRoot = join(cwd, "generated", "package");
    const generatedFile = join(packageRoot, "prompts", "GeneratedPrompt.ts");
    mkdirSync(dirname(generatedFile), { recursive: true });
    writeFileSync(generatedFile, "export const GeneratedPrompt = 'old';\n");

    const defaultExecTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workflowsGeneratedPackagePath: packageRoot,
      }).codingTools,
      "exec_command",
    );
    await expect(
      defaultExecTool.execute(
        "tool-default-generated-output-write",
        { cmd: `printf '%s\\n' "export const GeneratedPrompt = 'blocked';" > ${generatedFile}` },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Generated Workflows output");
    expect(readFileSync(generatedFile, "utf8")).toBe("export const GeneratedPrompt = 'old';\n");

    const fullAccessExecTool = findTool(
      createSvvyDirectToolsForTest({
        approvalMode: "full-access",
        cwd,
        workflowsGeneratedPackagePath: packageRoot,
      }).codingTools,
      "exec_command",
    );
    const result = await fullAccessExecTool.execute(
      "tool-full-access-generated-output-write",
      { cmd: `printf '%s\\n' "export const GeneratedPrompt = 'allowed';" > ${generatedFile}` },
      new AbortController().signal,
      () => {},
    );

    expect(readText(result)).toContain("exit code: 0");
    expect(readFileSync(generatedFile, "utf8")).toBe("export const GeneratedPrompt = 'allowed';\n");
  });

  it("blocks apply_patch writes outside managed filesystem writable roots", async () => {
    const cwd = createTempDir();
    const outsideRoot = mkdtempSync(join(process.cwd(), ".tmp-managed-policy-outside-"));
    tempDirs.push(outsideRoot);
    const outsideFile = join(outsideRoot, "outside.txt");
    writeFileSync(outsideFile, "before\n");
    const harness = createRuntimeLaunchDirectToolsForTest({
      command: ["patch", "-p0", "--forward"],
      cwd,
      launchKind: "direct_apply_patch",
      toolCallId: "tool-patch-outside-managed-roots",
      toolName: "apply_patch",
      launchFacts: (commandId) =>
        testLaunchFacts({
          command: ["patch", "-p0", "--forward"],
          commandId,
          cwd,
          filesystemPolicy: {
            defaultAccess: "read",
            entries: [
              {
                access: "write",
                path: cwd as AbsolutePath,
                recursive: true,
                source: "workspace",
              },
            ],
          },
          launchKind: "direct_apply_patch",
          mode: "managed",
        }),
    });
    const patchTool = findTool(harness.tools.codingTools, "apply_patch");

    await expect(
      patchTool.execute(
        "tool-patch-outside-managed-roots",
        {
          patch: [
            `--- ${outsideFile}`,
            `+++ ${outsideFile}`,
            "@@ -1 +1 @@",
            "-before",
            "+after",
            "",
          ].join("\n"),
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Managed filesystem policy allows writes");

    expect(readFileSync(outsideFile, "utf8")).toBe("before\n");
    expect(harness.closed()).toBe(true);
  });

  it("lets full-access bypass managed filesystem apply_patch write roots", async () => {
    const cwd = createTempDir();
    const outsideRoot = createTempDir();
    const outsideFile = join(outsideRoot, "outside.txt");
    writeFileSync(outsideFile, "before\n");
    const patchTool = findTool(
      createSvvyDirectToolsForTest({ cwd, approvalMode: "full-access" }).codingTools,
      "apply_patch",
    );

    await patchTool.execute(
      "tool-patch-full-access-outside-managed-roots",
      {
        patch: [
          `--- ${outsideFile}`,
          `+++ ${outsideFile}`,
          "@@ -1 +1 @@",
          "-before",
          "+after",
          "",
        ].join("\n"),
      },
      new AbortController().signal,
      () => {},
    );

    expect(readFileSync(outsideFile, "utf8")).toBe("after\n");
  });

  it("blocks apply_patch writes to protected workspace metadata", async () => {
    const cwd = createTempDir();
    const gitConfig = join(cwd, ".git", "config");
    mkdirSync(dirname(gitConfig), { recursive: true });
    writeFileSync(gitConfig, "before\n");
    const harness = createRuntimeLaunchDirectToolsForTest({
      command: ["patch", "-p0", "--forward"],
      cwd,
      launchKind: "direct_apply_patch",
      toolCallId: "tool-patch-protected-workspace-metadata",
      toolName: "apply_patch",
      launchFacts: (commandId) =>
        testLaunchFacts({
          command: ["patch", "-p0", "--forward"],
          commandId,
          cwd,
          filesystemPolicy: {
            defaultAccess: "read",
            entries: [
              {
                access: "write",
                path: cwd as AbsolutePath,
                recursive: true,
                source: "workspace",
              },
            ],
          },
          launchKind: "direct_apply_patch",
          mode: "managed",
        }),
    });
    const patchTool = findTool(harness.tools.codingTools, "apply_patch");

    await expect(
      patchTool.execute(
        "tool-patch-protected-workspace-metadata",
        {
          patch: [
            "--- .git/config",
            "+++ .git/config",
            "@@ -1 +1 @@",
            "-before",
            "+after",
            "",
          ].join("\n"),
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Managed filesystem policy allows writes");

    expect(readFileSync(gitConfig, "utf8")).toBe("before\n");
    expect(harness.closed()).toBe(true);
  });

  it("allows apply_patch writes to app-owned editable Extension source roots", async () => {
    const cwd = createTempDir();
    const extensionsRoot = createTempDir();
    const manifestPath = join(extensionsRoot, "sources", "user", "notes", "manifest.json");
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, '{"schemaVersion":1}\n');
    const harness = createRuntimeLaunchDirectToolsForTest({
      command: ["patch", "-p0", "--forward"],
      cwd,
      launchKind: "direct_apply_patch",
      options: { extensionsRoot },
      toolCallId: "tool-patch-extension-source-managed-root",
      toolName: "apply_patch",
      launchFacts: (commandId) =>
        testLaunchFacts({
          command: ["patch", "-p0", "--forward"],
          commandId,
          cwd,
          filesystemPolicy: {
            defaultAccess: "read",
            entries: [
              {
                access: "write",
                path: join(extensionsRoot, "sources") as AbsolutePath,
                recursive: true,
                source: "extension-source",
              },
            ],
          },
          launchKind: "direct_apply_patch",
          mode: "managed",
        }),
    });
    const patchTool = findTool(harness.tools.codingTools, "apply_patch");

    await patchTool.execute(
      "tool-patch-extension-source-managed-root",
      {
        patch: [
          `--- ${manifestPath}`,
          `+++ ${manifestPath}`,
          "@@ -1 +1 @@",
          '-{"schemaVersion":1}',
          '+{"schemaVersion":1,"title":"Notes"}',
          "",
        ].join("\n"),
      },
      new AbortController().signal,
      () => {},
    );

    expect(readFileSync(manifestPath, "utf8")).toBe('{"schemaVersion":1,"title":"Notes"}\n');
    expect(harness.closed()).toBe(true);
  });

  it("blocks exec_command at the approval boundary before running shell commands", async () => {
    const cwd = createTempDir();
    const target = join(cwd, "should-not-exist.txt");
    const approvalRequests: unknown[] = [];
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        approvalBoundary: (input) => {
          approvalRequests.push(input);
          return { approved: false, reason: "Shell command needs user approval." };
        },
        approvalMode: "user",
        cwd,
      }).codingTools,
      "exec_command",
    );

    await expect(
      execTool.execute(
        "tool-denied-shell",
        { cmd: `printf blocked > ${target}` },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("Shell command needs user approval.");

    expect(existsSync(target)).toBe(false);
    expect(approvalRequests).toEqual([
      expect.objectContaining({
        approvalMode: "user",
        command: `printf blocked > ${target}`,
        commandFamily: undefined,
        cwd,
        toolCallId: "tool-denied-shell",
        toolName: "exec_command",
      }),
    ]);
  });

  it("registers long-running exec_command stdin by durable command id", async () => {
    const cwd = createTempDir();
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: cwd,
        label: "svvy",
        cwd,
      },
      databasePath: join(cwd, "structured.sqlite"),
    });
    openStores.push(store);
    store.upsertPiSession({
      sessionId: "session-running-command-stdin",
      title: "Running command stdin",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      messageCount: 1,
      status: "running",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
    });
    const turn = store.startTurn({
      sessionId: "session-running-command-stdin",
      surfacePiSessionId: "session-running-command-stdin",
      requestSummary: "Run a command waiting for stdin",
    });
    const runtime = {
      current: createPromptExecutionContext({
        workspaceSessionId: "session-running-command-stdin",
        turnId: turn.id,
        surfacePiSessionId: "session-running-command-stdin",
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      }),
    };
    const command = store.createCommand({
      turnId: turn.id,
      toolName: "exec_command",
      executor: "orchestrator",
      visibility: "summary",
      title: "Run exec_command",
      summary: "Run a command waiting for stdin.",
      arguments: { cmd: "read line; echo got:$line" },
      facts: { toolCallId: "tool-running-command-stdin" },
    });
    store.startCommand(command.id);
    const runtimeCommandStdin = createLiveCommandStdinRegistry();
    const tools = createSvvyDirectToolsForTest({
      cwd,
      runtime,
      store,
      runtimeCommandStdin,
    }).codingTools;
    const execTool = findTool(tools, "exec_command");
    const stdinTool = findTool(tools, "write_stdin");

    const started = await execTool.execute(
      "tool-running-command-stdin",
      { cmd: "read line; echo got:$line", timeout: 1 },
      new AbortController().signal,
      () => {},
    );
    const sessionId = readText(started).match(/session_id: (\S+)/)?.[1];
    expect(sessionId).toBeTruthy();

    await expect(
      Effect.runPromise(
        runtimeCommandStdin.writeStdin({
          commandId: command.id as CommandId,
          text: "registry\n",
        }),
      ),
    ).resolves.toEqual({
      commandId: command.id as CommandId,
      status: "accepted",
      acceptedBytes: 9,
    });
    await sleep(50);
    const drained = await stdinTool.execute(
      "tool-running-command-stdin-drain",
      { session_id: sessionId, input: "" },
      new AbortController().signal,
      () => {},
    );
    expect(readText(drained)).toContain("got:registry");
  });

  it("passes default auto-review mode to the direct approval boundary", async () => {
    const cwd = createTempDir();
    const approvalRequests: unknown[] = [];
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        approvalBoundary: (input) => {
          approvalRequests.push(input);
          return { approved: true };
        },
        cwd,
      }).codingTools,
      "exec_command",
    );

    const result = await execTool.execute(
      "tool-auto-review-shell",
      { cmd: "printf approved" },
      new AbortController().signal,
      () => {},
    );

    expect(readText(result)).toContain("approved");
    expect(approvalRequests).toEqual([
      expect.objectContaining({
        approvalMode: "auto-review",
        command: "printf approved",
        toolCallId: "tool-auto-review-shell",
        toolName: "exec_command",
      }),
    ]);
  });

  it("does not retry outside the sandbox for synthetic sandbox-looking command output", async () => {
    const cwd = createTempDir();
    const approvalRequests: unknown[] = [];
    const commandText = "printf 'sandbox: Operation not permitted\\n' >&2; exit 1";
    const harness = createRuntimeLaunchDirectToolsForTest({
      command: ["/bin/sh", "-lc", commandText],
      cwd,
      launchKind: "direct_shell",
      options: {
        approvalBoundary: (input) => {
          approvalRequests.push(input);
          return { approved: true };
        },
        approvalMode: "user",
      },
      toolCallId: "tool-synthetic-sandbox-output",
      toolName: "exec_command",
      launchFacts: (commandId) =>
        testLaunchFacts({
          command: ["/bin/sh", "-lc", commandText],
          commandId,
          cwd,
          filesystemPolicy: {
            defaultAccess: "read",
            entries: [
              {
                access: "write",
                path: cwd as AbsolutePath,
                recursive: true,
                source: "workspace",
              },
            ],
          },
          launchKind: "direct_shell",
          mode: "managed",
        }),
    });
    const execTool = findTool(harness.tools.codingTools, "exec_command");

    const result = await execTool.execute(
      "tool-synthetic-sandbox-output",
      { cmd: commandText },
      new AbortController().signal,
      () => {},
    );

    expect(execFacts(result)?.exitCode).toBe(1);
    expect(execFacts(result)?.sandboxDenied).toBeUndefined();
    expect(approvalRequests).toHaveLength(1);
    expect(harness.closed()).toBe(true);
  });

  it("does not escalate shell command-not-found failures as sandbox denials", async () => {
    const cwd = createTempDir();
    const approvalRequests: unknown[] = [];
    const commandText = "definitely-not-a-svvy-command";
    const harness = createRuntimeLaunchDirectToolsForTest({
      command: ["/bin/sh", "-lc", commandText],
      cwd,
      launchKind: "direct_shell",
      options: {
        approvalBoundary: (input) => {
          approvalRequests.push(input);
          return { approved: true };
        },
        approvalMode: "user",
      },
      toolCallId: "tool-not-found-no-escalation",
      toolName: "exec_command",
      launchFacts: (commandId) =>
        testLaunchFacts({
          command: ["/bin/sh", "-lc", commandText],
          commandId,
          cwd,
          filesystemPolicy: {
            defaultAccess: "read",
            entries: [
              {
                access: "write",
                path: cwd as AbsolutePath,
                recursive: true,
                source: "workspace",
              },
            ],
          },
          launchKind: "direct_shell",
          mode: "managed",
        }),
    });
    const execTool = findTool(harness.tools.codingTools, "exec_command");

    const result = await execTool.execute(
      "tool-not-found-no-escalation",
      { cmd: commandText },
      new AbortController().signal,
      () => {},
    );

    expect(execFacts(result)?.exitCode).toBe(127);
    expect(execFacts(result)?.sandboxDenied).toBeUndefined();
    expect(approvalRequests).toHaveLength(1);
    expect(harness.closed()).toBe(true);
  });

  it("blocks svvyx CLI commands at the same ordinary exec_command approval boundary", async () => {
    const cwd = createTempDir();
    const approvalRequests: unknown[] = [];
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        approvalBoundary: (input) => {
          approvalRequests.push(input);
          return { approved: false, reason: "svvyx command needs approval." };
        },
        approvalMode: "user",
        cwd,
      }).codingTools,
      "exec_command",
    );

    for (const [toolCallId, command] of [
      ["tool-denied-svvyx-artifacts", "svvyx artifacts list --json"],
      ["tool-denied-svvyx-workflows", "svvyx workflows list --json"],
      ["tool-denied-svvyx-extensions", "svvyx extensions list --json"],
      ["tool-denied-svvyx-runtime", "svvyx linear search --json"],
    ] as const) {
      await expect(
        execTool.execute(toolCallId, { cmd: command }, new AbortController().signal, () => {}),
      ).rejects.toThrow("svvyx command needs approval.");
    }

    expect(approvalRequests).toEqual([
      expect.objectContaining({
        approvalMode: "user",
        command: "svvyx artifacts list --json",
        commandFamily: undefined,
        cwd,
        toolCallId: "tool-denied-svvyx-artifacts",
        toolName: "exec_command",
      }),
      expect.objectContaining({
        approvalMode: "user",
        command: "svvyx workflows list --json",
        commandFamily: undefined,
        cwd,
        toolCallId: "tool-denied-svvyx-workflows",
        toolName: "exec_command",
      }),
      expect.objectContaining({
        approvalMode: "user",
        command: "svvyx extensions list --json",
        commandFamily: undefined,
        cwd,
        toolCallId: "tool-denied-svvyx-extensions",
        toolName: "exec_command",
      }),
      expect.objectContaining({
        approvalMode: "user",
        command: "svvyx linear search --json",
        commandFamily: undefined,
        cwd,
        toolCallId: "tool-denied-svvyx-runtime",
        toolName: "exec_command",
      }),
    ]);
  });

  it("replays svvyx extensions runtime-effect transport intents in parent state", async () => {
    const cwd = createTempDir();
    const extensionsRoot = join(cwd, "extensions");
    const store = createStructuredSessionStateStore({
      digest: testDigest,
      workspace: {
        id: cwd,
        label: "svvy",
        cwd,
      },
      databasePath: join(cwd, "structured.sqlite"),
    });
    openStores.push(store);
    store.upsertPiSession({
      sessionId: "session-extension-impact",
      title: "Extension Impact",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      orchestratorAgentProfileId: DEFAULT_ORCHESTRATOR_PROFILE_ID as AgentProfileId,
      messageCount: 1,
      status: "running",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    });
    const turn = store.startTurn({
      sessionId: "session-extension-impact",
      surfacePiSessionId: "session-extension-impact",
      requestSummary: "Set extension usage",
    });
    const runtime = {
      current: createPromptExecutionContext({
        workspaceSessionId: "session-extension-impact",
        turnId: turn.id,
        surfacePiSessionId: "session-extension-impact",
        rootThreadId: null,
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      }),
    };
    const toolCallId = "tool-extension-impact";
    const commandText =
      "svvyx extensions set-usage --extension smithers --agent-profile default-orchestrator --state loaded --json";
    const command = store.createCommand({
      turnId: turn.id,
      surfacePiSessionId: "session-extension-impact",
      threadId: null,
      toolName: "exec_command",
      executor: "orchestrator",
      visibility: "summary",
      title: "Run exec_command",
      summary: commandText,
      arguments: { cmd: commandText },
      facts: { toolCallId },
    });
    store.startCommand(command.id);
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        agentProfileSnapshot: createTestAgentProfileSnapshot(),
        applyExtensionManagementRuntimeRequest: async (request) => {
          expect(request).toMatchObject({
            operation: "usage.set",
            input: {
              extensionId: "smithers",
              agentProfile: "default-orchestrator",
              usage: "loaded",
            },
          });
          return {
            output: {
              ok: true,
              extensionId: "smithers",
              agentProfile: "default-orchestrator",
              before: { state: "available" },
              after: { state: "loaded" },
              agentContextImpact: {
                affectedSurfaces: [
                  {
                    surfacePiSessionId: "session-extension-impact",
                    kind: "extension_context_changed",
                    label: "Extensions changed",
                    reason: "extension_usage_changed",
                  },
                ],
              },
            },
            commandFacts: {
              affectedAgentContextSurfaces: 1,
              extensionId: "smithers",
            },
          };
        },
        cwd,
        extensionsRoot,
        runtime,
        store,
      }).codingTools,
      "exec_command",
    );

    const result = await execTool.execute(
      toolCallId,
      { cmd: commandText },
      new AbortController().signal,
      () => {},
    );
    const text = readText(result);
    const output = JSON.parse(text) as {
      agentContextImpact?: { affectedSurfaces?: unknown[] };
      ok?: boolean;
    };

    expect(output).toMatchObject({
      ok: true,
      extensionId: "smithers",
      agentProfile: "default-orchestrator",
      after: { state: "loaded" },
      agentContextImpact: {
        affectedSurfaces: [
          {
            surfacePiSessionId: "session-extension-impact",
            kind: "extension_context_changed",
            label: "Extensions changed",
            reason: "extension_usage_changed",
          },
        ],
      },
    });
    expect(result.details?.commandFacts).toMatchObject({
      affectedAgentContextSurfaces: 1,
    });
    const progressEvents = store
      .getSessionState("session-extension-impact")
      .events.filter(
        (event) => event.kind === "command.progress" && event.subject.id === command.id,
      );
    expect(progressEvents.map((event) => event.data)).toEqual([
      {
        command: commandText,
        family: "extensions",
        phase: "started",
        source: "svvyx-cli-subprocess",
      },
      expect.objectContaining({
        command: commandText,
        family: "extensions",
        phase: "succeeded",
        source: "svvyx-cli-subprocess",
        facts: expect.objectContaining({
          affectedAgentContextSurfaces: 1,
          extensionId: "smithers",
        }),
      }),
    ]);
  });

  it("blocks apply_patch at the approval boundary before changing files", async () => {
    const cwd = createTempDir();
    const target = join(cwd, "notes.txt");
    writeFileSync(target, "before\n");
    const approvalRequests: unknown[] = [];
    const patchTool = findTool(
      createSvvyDirectToolsForTest({
        approvalBoundary: (input) => {
          approvalRequests.push(input);
          return { approved: false, reason: "Patch needs user approval." };
        },
        approvalMode: "user",
        cwd,
      }).codingTools,
      "apply_patch",
    );
    const patch = ["--- notes.txt", "+++ notes.txt", "@@ -1 +1 @@", "-before", "+after", ""].join(
      "\n",
    );

    await expect(
      patchTool.execute("tool-denied-patch", { patch }, new AbortController().signal, () => {}),
    ).rejects.toThrow("Patch needs user approval.");

    expect(readFileSync(target, "utf8")).toBe("before\n");
    expect(approvalRequests).toEqual([
      expect.objectContaining({
        approvalMode: "user",
        cwd,
        patch,
        toolCallId: "tool-denied-patch",
        toolName: "apply_patch",
      }),
    ]);
  });

  it("lets full-access bypass the direct approval boundary", async () => {
    const cwd = createTempDir();
    const target = join(cwd, "allowed.txt");
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        approvalBoundary: () => {
          throw new Error("approval boundary should not run in full-access.");
        },
        approvalMode: "full-access",
        cwd,
      }).codingTools,
      "exec_command",
    );

    const result = await execTool.execute(
      "tool-full-access-approval-bypass",
      { cmd: `printf allowed > ${target}` },
      new AbortController().signal,
      () => {},
    );

    expect(readText(result)).toContain("exit code: 0");
    expect(readFileSync(target, "utf8")).toBe("allowed");
  });

  it("rejects direct edits to internal Extension generated and state paths", async () => {
    const cwd = createTempDir();
    const extensionsRoot = createTempDir();
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    const fullDir = join(sourceRoot, "instructions", "full");
    const generatedInstructionFile = join(fullDir, "020-generated.md");
    const handAuthoredInstructionFile = join(fullDir, "010-notes.md");
    const minimalInstructionFile = join(sourceRoot, "instructions", "minimal.md");
    const generatorScriptFile = join(sourceRoot, "scripts", "generate.ts");
    const sourceFile = join(sourceRoot, "source", "index.ts");
    const manifestPath = join(sourceRoot, "manifest.json");
    const packageJsonPath = join(extensionsRoot, "package", "package.json");
    const lockfilePath = join(extensionsRoot, "package", "bun.lock");
    const generatedTypePath = join(
      extensionsRoot,
      "generated",
      "extensions",
      "notes",
      "types.d.ts",
    );
    const generatedAggregatePath = join(
      extensionsRoot,
      "generated",
      "aggregates",
      "blobs",
      "cache-key",
      "prompt.md",
    );
    const buildManifestPath = join(
      extensionsRoot,
      "builds",
      "extensions",
      "notes",
      "current",
      "manifest.json",
    );
    const stagingBuildManifestPath = join(
      extensionsRoot,
      "builds",
      "extensions",
      "notes",
      "staging",
      "build-1",
      "manifest.json",
    );
    const nodeModulesFile = join(extensionsRoot, "package", "node_modules", "dep", "index.js");
    const snapshotFile = join(extensionsRoot, "snapshots", "snap_notes", "manifest.json");
    const trashFile = join(extensionsRoot, "trash", "trash_notes", "manifest.json");
    for (const path of [
      fullDir,
      dirname(minimalInstructionFile),
      dirname(generatorScriptFile),
      dirname(sourceFile),
      join(extensionsRoot, "generated", "extensions", "notes"),
      dirname(generatedAggregatePath),
      dirname(buildManifestPath),
      dirname(stagingBuildManifestPath),
      dirname(nodeModulesFile),
      dirname(snapshotFile),
      dirname(trashFile),
      join(extensionsRoot, "package"),
    ]) {
      mkdirSync(path, { recursive: true });
    }
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          id: "notes",
          title: "Notes",
          description: "Project notes.",
          interface: "instructions",
          generatedInstructions: [
            {
              output: "instructions/full/020-generated.md",
              script: "scripts/generate.ts",
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(handAuthoredInstructionFile, "# Notes\n");
    writeFileSync(minimalInstructionFile, "Use Notes when relevant.\n");
    writeFileSync(generatorScriptFile, "export function generate() {}\n");
    writeFileSync(sourceFile, "export default {};\n");
    writeFileSync(generatedInstructionFile, "# Generated\n");
    writeFileSync(packageJsonPath, "{}\n");
    writeFileSync(lockfilePath, "lock\n");
    writeFileSync(generatedTypePath, "export type Notes = {};\n");
    writeFileSync(generatedAggregatePath, "# Aggregate\n");
    writeFileSync(buildManifestPath, "{}\n");
    writeFileSync(stagingBuildManifestPath, "{}\n");
    writeFileSync(nodeModulesFile, "module.exports = {};\n");
    writeFileSync(snapshotFile, "{}\n");
    writeFileSync(trashFile, "{}\n");

    const tools = createSvvyDirectToolsForTest({ cwd, extensionsRoot }).codingTools;
    const patchTool = findTool(tools, "apply_patch");
    const execTool = findTool(tools, "exec_command");

    await expect(
      patchTool.execute(
        "tool-patch-extension-generated-instruction",
        {
          patch: [
            `--- ${generatedInstructionFile}`,
            `+++ ${generatedInstructionFile}`,
            "@@ -1 +1 @@",
            "-# Generated",
            "+# Hacked",
            "",
          ].join("\n"),
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("internal Extension files");

    for (const [toolCallId, path, before, after] of [
      [
        "tool-patch-extension-generated-types",
        generatedTypePath,
        "export type Notes = {};",
        "export type Notes = 'hacked';",
      ],
      [
        "tool-patch-extension-generated-aggregate",
        generatedAggregatePath,
        "# Aggregate",
        "# Hacked aggregate",
      ],
      ["tool-patch-extension-build-output", buildManifestPath, "{}", '{"hacked":true}'],
      [
        "tool-patch-extension-staging-build-output",
        stagingBuildManifestPath,
        "{}",
        '{"hacked":true}',
      ],
      ["tool-patch-extension-lockfile", lockfilePath, "lock", "hacked lock"],
      [
        "tool-patch-extension-node-modules",
        nodeModulesFile,
        "module.exports = {};",
        "module.exports = 'hacked';",
      ],
      ["tool-patch-extension-snapshot", snapshotFile, "{}", '{"hacked":true}'],
      ["tool-patch-extension-trash", trashFile, "{}", '{"hacked":true}'],
    ] as const) {
      await expect(
        patchTool.execute(
          toolCallId,
          {
            patch: [
              `--- ${path}`,
              `+++ ${path}`,
              "@@ -1 +1 @@",
              `-${before}`,
              `+${after}`,
              "",
            ].join("\n"),
          },
          new AbortController().signal,
          () => {},
        ),
      ).rejects.toThrow("internal Extension files");
    }

    await patchTool.execute(
      "tool-patch-extension-editable-hand-authored-instruction",
      {
        patch: [
          `--- ${handAuthoredInstructionFile}`,
          `+++ ${handAuthoredInstructionFile}`,
          "@@ -1 +1 @@",
          "-# Notes",
          "+# Notes updated",
          "",
        ].join("\n"),
      },
      new AbortController().signal,
      () => {},
    );

    for (const [toolCallId, path] of [
      ["tool-shell-extension-generated-instruction", generatedInstructionFile],
      ["tool-shell-extension-generated-types", generatedTypePath],
      ["tool-shell-extension-generated-aggregate", generatedAggregatePath],
      ["tool-shell-extension-build-output", buildManifestPath],
      ["tool-shell-extension-staging-build-output", stagingBuildManifestPath],
      ["tool-shell-extension-lockfile", lockfilePath],
      ["tool-shell-extension-node-modules", nodeModulesFile],
      ["tool-shell-extension-snapshot", snapshotFile],
      ["tool-shell-extension-trash", trashFile],
    ] as const) {
      await expect(
        execTool.execute(
          toolCallId,
          { cmd: `printf hacked > ${path}` },
          new AbortController().signal,
          () => {},
        ),
      ).rejects.toThrow("internal Extension files");
    }
    await expect(
      execTool.execute(
        "tool-shell-extension-generated-workdir",
        { cmd: "printf hacked > types.d.ts", workdir: dirname(generatedTypePath) },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("internal Extension files");

    await execTool.execute(
      "tool-shell-extension-editable-manifest",
      { cmd: "printf '{\"schemaVersion\":1}\\n' > manifest.json", workdir: sourceRoot },
      new AbortController().signal,
      () => {},
    );
    await execTool.execute(
      "tool-shell-extension-editable-package-json",
      {
        cmd: "printf '{\"dependencies\":{}}\\n' > package.json",
        workdir: dirname(packageJsonPath),
      },
      new AbortController().signal,
      () => {},
    );
    await execTool.execute(
      "tool-shell-extension-editable-minimal-instruction",
      {
        cmd: "printf 'Use updated Notes when relevant.\\n' > minimal.md",
        workdir: dirname(minimalInstructionFile),
      },
      new AbortController().signal,
      () => {},
    );
    await execTool.execute(
      "tool-shell-extension-editable-generator-script",
      {
        cmd: "printf 'export function generateNotes() {}\\n' > generate.ts",
        workdir: dirname(generatorScriptFile),
      },
      new AbortController().signal,
      () => {},
    );
    await execTool.execute(
      "tool-shell-extension-editable-source",
      {
        cmd: "printf 'export default { name: \"notes\" };\\n' > index.ts",
        workdir: dirname(sourceFile),
      },
      new AbortController().signal,
      () => {},
    );

    expect(readFileSync(generatedInstructionFile, "utf8")).toBe("# Generated\n");
    expect(readFileSync(generatedTypePath, "utf8")).toBe("export type Notes = {};\n");
    expect(readFileSync(generatedAggregatePath, "utf8")).toBe("# Aggregate\n");
    expect(readFileSync(buildManifestPath, "utf8")).toBe("{}\n");
    expect(readFileSync(stagingBuildManifestPath, "utf8")).toBe("{}\n");
    expect(readFileSync(lockfilePath, "utf8")).toBe("lock\n");
    expect(readFileSync(nodeModulesFile, "utf8")).toBe("module.exports = {};\n");
    expect(readFileSync(snapshotFile, "utf8")).toBe("{}\n");
    expect(readFileSync(trashFile, "utf8")).toBe("{}\n");
    expect(readFileSync(handAuthoredInstructionFile, "utf8")).toBe("# Notes updated\n");
    expect(readFileSync(minimalInstructionFile, "utf8")).toBe("Use updated Notes when relevant.\n");
    expect(readFileSync(generatorScriptFile, "utf8")).toBe("export function generateNotes() {}\n");
    expect(readFileSync(sourceFile, "utf8")).toBe('export default { name: "notes" };\n');
    expect(readFileSync(manifestPath, "utf8")).toBe('{"schemaVersion":1}\n');
    expect(readFileSync(packageJsonPath, "utf8")).toBe('{"dependencies":{}}\n');
  });

  it("routes svvyx artifacts create through exec_command and links the artifact to the source command", async () => {
    const appLogEvents: AppLoggerEvent[] = [];
    const harness = createArtifactsHarness({ onAppLog: (event) => appLogEvents.push(event) });

    const result = await harness.run("svvyx artifacts create --name plan.md --json");

    expect(result.output).toMatchObject({
      name: "plan.md",
      immutable: false,
      mimeType: "text/markdown",
      bytes: 0,
    });
    expect(result.output.path).toBe(join(harness.artifactDir, "session-artifacts", "plan.md"));
    expect(existsSync(result.output.path)).toBe(true);
    const artifact = harness.store.inspectArtifact({
      sessionId: "session-artifacts",
      artifactId: result.output.id,
    });
    expect(artifact.sourceCommandId).toBe(result.command.id);
    expect(result.details!.commandFacts).toMatchObject({
      artifactId: result.output.id,
      artifactPath: result.output.path,
      artifactName: "plan.md",
    });
    expect(appLogEvents).toEqual([
      expect.objectContaining({
        level: "info",
        source: "artifact",
        message: "Artifact Create succeeded.",
        details: expect.objectContaining({
          workspaceSessionId: "session-artifacts",
          surfacePiSessionId: "session-artifacts",
          commandId: result.command.id,
          artifactId: result.output.id,
          artifactCommandId: "create",
          artifactName: "plan.md",
        }),
      }),
    ]);
  });

  it("creates artifacts for default workspace sessions through the same svvyx CLI surface", async () => {
    const harness = createArtifactsHarness({
      workspaceId: "workspace:default",
      workspaceLabel: "Default Workspace",
    });
    const sourcePath = join(harness.cwd, "default-plan-source.md");
    writeFileSync(sourcePath, "ready");

    const result = await harness.run(
      `svvyx artifacts create --path ${sourcePath} --name default-plan.md --json`,
    );
    const snapshot = harness.store.getSessionState("session-artifacts");

    expect(snapshot.workspace).toMatchObject({
      id: "workspace:default",
      label: "Default Workspace",
      artifactDir: harness.artifactDir,
    });
    expect(result.output).toMatchObject({
      name: "default-plan.md",
      mimeType: "text/markdown",
      bytes: 5,
      path: join(harness.artifactDir, "session-artifacts", "default-plan.md"),
    });
    expect(readFileSync(result.output.path, "utf8")).toBe("ready");
    expect(snapshot.artifacts).toContainEqual(
      expect.objectContaining({
        id: result.output.id,
        sourceCommandId: result.command.id,
        path: result.output.path,
        name: "default-plan.md",
      }),
    );
  });

  it("links Artifacts commands to the matching exec_command tool call when commands run in parallel", async () => {
    const harness = createArtifactsHarness();

    const result = await harness.run("svvyx artifacts create --name parallel.md --json", {
      beforeExecute: () => {
        const decoyCommand = harness.store.createCommand({
          turnId: harness.turnId,
          surfacePiSessionId: "session-artifacts",
          threadId: null,
          toolName: "exec_command",
          executor: "orchestrator",
          visibility: "summary",
          title: "Run exec_command",
          summary: "svvyx artifacts create --name wrong.md --json",
          facts: { toolCallId: "tool-decoy" },
        });
        harness.store.startCommand(decoyCommand.id);
      },
    });

    const artifact = harness.store.inspectArtifact({
      sessionId: "session-artifacts",
      artifactId: result.output.id,
    });
    expect(artifact.sourceCommandId).toBe(result.command.id);
  });

  it("copies source files with exact optional names and immutable storage", async () => {
    const harness = createArtifactsHarness();
    const sourcePath = join(harness.cwd, "source.log");
    writeFileSync(sourcePath, "retained logs\n");

    const result = await harness.run(
      `svvyx artifacts create --path ${sourcePath} --name evidence.log --mime-type text/plain --immutable --json`,
    );

    expect(result.output).toMatchObject({
      name: "evidence.log",
      immutable: true,
      mimeType: "text/plain",
      bytes: 14,
    });
    expect(result.output.path).toBe(
      join(harness.artifactDir, "session-artifacts", "immutable", "evidence.log"),
    );
    expect(readFileSync(result.output.path, "utf-8")).toBe("retained logs\n");
  });

  it("allows active mutable artifact edits and rejects immutable or other-session artifact edits", async () => {
    const harness = createArtifactsHarness();
    const immutableSourcePath = join(harness.cwd, "locked-source.log");
    writeFileSync(immutableSourcePath, "locked\n");
    const mutable = await harness.run("svvyx artifacts create --name draft.md --json");
    const immutable = await harness.run(
      `svvyx artifacts create --path ${immutableSourcePath} --name locked.log --immutable --json`,
    );
    const otherSessionDir = join(harness.artifactDir, "session-other");
    const otherSessionArtifactPath = join(otherSessionDir, "other.md");
    mkdirSync(otherSessionDir, { recursive: true });
    writeFileSync(otherSessionArtifactPath, "other\n");

    const mutableEdit = await harness.execRaw(`printf 'draft\\n' > ${mutable.output.path}`);
    expect(readText(mutableEdit)).toContain("exit code: 0");
    expect(readFileSync(mutable.output.path, "utf8")).toBe("draft\n");

    await expect(harness.execRaw(`printf hacked > ${immutable.output.path}`)).rejects.toThrow(
      "immutable or non-active-session Artifacts",
    );
    await expect(harness.execRaw(`printf hacked > ${otherSessionArtifactPath}`)).rejects.toThrow(
      "immutable or non-active-session Artifacts",
    );
    await expect(
      harness.applyPatchRaw(
        [
          `--- ${immutable.output.path}`,
          `+++ ${immutable.output.path}`,
          "@@ -1 +1 @@",
          "-locked",
          "+hacked",
          "",
        ].join("\n"),
      ),
    ).rejects.toThrow("immutable or non-active-session Artifacts");

    expect(readFileSync(immutable.output.path, "utf8")).toBe("locked\n");
    expect(readFileSync(otherSessionArtifactPath, "utf8")).toBe("other\n");
  });

  it("protects artifact edits using the runtime artifact-root seam", async () => {
    const calls: string[] = [];
    const harness = createArtifactsHarness({
      readArtifactRootForSession: (sessionId) => {
        calls.push(sessionId);
        return harness.artifactDir;
      },
    });
    const immutableSourcePath = join(harness.cwd, "locked-source.log");
    writeFileSync(immutableSourcePath, "locked\n");
    const mutable = await harness.run("svvyx artifacts create --name draft.md --json");
    const immutable = await harness.run(
      `svvyx artifacts create --path ${immutableSourcePath} --name locked.log --immutable --json`,
    );
    const otherSessionDir = join(harness.artifactDir, "session-other");
    const otherSessionArtifactPath = join(otherSessionDir, "other.md");
    mkdirSync(otherSessionDir, { recursive: true });
    writeFileSync(otherSessionArtifactPath, "other\n");

    expect(mutable.output.path).toBe(join(harness.artifactDir, "session-artifacts", "draft.md"));

    const mutableEdit = await harness.execRaw(`printf 'draft\\n' > ${mutable.output.path}`);
    expect(readText(mutableEdit)).toContain("exit code: 0");
    expect(readFileSync(mutable.output.path, "utf8")).toBe("draft\n");

    await expect(harness.execRaw(`printf hacked > ${immutable.output.path}`)).rejects.toThrow(
      "immutable or non-active-session Artifacts",
    );
    await expect(harness.execRaw(`printf hacked > ${otherSessionArtifactPath}`)).rejects.toThrow(
      "immutable or non-active-session Artifacts",
    );
    expect(calls).toContain("session-artifacts");
  });

  it("inspects, lists, and deletes artifacts as current-session product state", async () => {
    const harness = createArtifactsHarness();
    const created = await harness.run("svvyx artifacts create --name report.md --json");
    writeFileSync(created.output.path, "# Report\n");

    const inspected = await harness.run(`svvyx artifacts inspect --id ${created.output.id} --json`);
    expect(inspected.output).toMatchObject({
      id: created.output.id,
      name: "report.md",
      bytes: 9,
      sha256: createHash("sha256").update("# Report\n").digest("hex"),
    });

    const listed = await harness.run("svvyx artifacts list --limit 10 --json");
    expect(listed.output.artifacts.map((artifact: { id: string }) => artifact.id)).toContain(
      created.output.id,
    );
    expect(
      listed.output.artifacts.find((artifact: { id: string }) => artifact.id === created.output.id),
    ).toMatchObject({
      bytes: 9,
      sha256: createHash("sha256").update("# Report\n").digest("hex"),
    });

    const deleted = await harness.run(`svvyx artifacts delete --id ${created.output.id} --json`);
    expect(deleted.output).toEqual({ id: created.output.id, deleted: true });
    expect(existsSync(created.output.path)).toBe(false);

    await expect(
      harness.run(`svvyx artifacts inspect --id ${created.output.id} --json`),
    ).rejects.toThrow("ARTIFACT_DELETED");
  });

  it("rejects obsolete Artifacts contracts instead of accepting compatibility aliases", async () => {
    const harness = createArtifactsHarness();

    await expect(
      harness.run("svvyx artifacts create --name notes.md --kind text --json"),
    ).rejects.toThrow("does not support --kind");
    await expect(
      harness.run("svvyx artifacts create --name notes.md --content hello --json"),
    ).rejects.toThrow("does not support inline content");
    await expect(harness.run("svvyx artifacts artifact_write_text --json")).rejects.toThrow(
      "Unsupported Artifacts command",
    );
  });

  it("returns spec error codes for Artifacts validation failures", async () => {
    const appLogEvents: AppLoggerEvent[] = [];
    const harness = createArtifactsHarness({ onAppLog: (event) => appLogEvents.push(event) });
    const sourceDir = join(harness.cwd, "source.dir");
    mkdirSync(sourceDir);

    await expectArtifactErrorCode(
      harness.run("svvyx artifacts create --name plan --json"),
      "INVALID_ARGUMENT",
    );
    expect(appLogEvents).toContainEqual(
      expect.objectContaining({
        level: "warning",
        source: "artifact",
        message: "Artifact Create failed.",
        details: expect.objectContaining({
          workspaceSessionId: "session-artifacts",
          surfacePiSessionId: "session-artifacts",
          artifactCommandId: "create",
          errorCode: "INVALID_ARGUMENT",
        }),
      }),
    );
    await expectArtifactErrorCode(
      harness.run("svvyx artifacts create --name plan.md --mime-type not-a-mime --json"),
      "INVALID_ARGUMENT",
    );
    await expectArtifactErrorCode(
      harness.run("svvyx artifacts create --path missing.log --json"),
      "SOURCE_NOT_FOUND",
    );
    await expectArtifactErrorCode(
      harness.run(`svvyx artifacts create --path ${sourceDir} --json`),
      "SOURCE_IS_DIRECTORY",
    );
  });

  it("returns spec error codes for Artifacts filesystem failures", async () => {
    const harness = createArtifactsHarness();
    rmSync(harness.artifactDir, { force: true, recursive: true });
    writeFileSync(harness.artifactDir, "not a directory\n");

    await expectArtifactErrorCode(
      harness.run("svvyx artifacts create --name blocked.md --json"),
      "COPY_FAILED",
    );
  });

  it("rejects deleted artifacts on open before UI handling", async () => {
    const harness = createArtifactsHarness();
    const created = await harness.run("svvyx artifacts create --name open.md --json");
    await harness.run(`svvyx artifacts delete --id ${created.output.id} --json`);

    await expectArtifactErrorCode(
      harness.run(`svvyx artifacts open --id ${created.output.id} --json`),
      "ARTIFACT_DELETED",
    );
  });

  it("returns DELETE_FAILED when artifact file removal fails", async () => {
    const harness = createArtifactsHarness();
    const created = await harness.run("svvyx artifacts create --name blocked.md --json");
    rmSync(created.output.path);
    mkdirSync(created.output.path);

    await expectArtifactErrorCode(
      harness.run(`svvyx artifacts delete --id ${created.output.id} --json`),
      "DELETE_FAILED",
    );
    expect(
      harness.store.inspectArtifact({
        sessionId: "session-artifacts",
        artifactId: created.output.id,
      }).deletedAt,
    ).toBeNull();
  });

  it("accepts active artifact opens without an attached UI", async () => {
    const harness = createArtifactsHarness();
    const created = await harness.run("svvyx artifacts create --name open.md --json");

    const opened = await harness.run(`svvyx artifacts open --id ${created.output.id} --json`);

    expect(opened.output).toEqual({
      id: created.output.id,
      intent: "open_artifact_inspector",
      accepted: true,
    });
    expect(opened.details!.commandFacts).toEqual({
      commandFamily: "artifacts",
      artifactCommandId: "open",
      artifactId: created.output.id,
      workspaceSessionId: "session-artifacts",
      intent: "open_artifact_inspector",
      accepted: true,
      missingFile: false,
    });
  });

  it("opens artifact inspector panes for records whose backing file is missing", async () => {
    const harness = createArtifactsHarness();
    const created = await harness.run("svvyx artifacts create --name missing.md --json");
    rmSync(created.output.path);

    const opened = await harness.run(`svvyx artifacts open --id ${created.output.id} --json`);

    expect(opened.output).toEqual({
      id: created.output.id,
      intent: "open_artifact_inspector",
      accepted: true,
    });
    expect(opened.details!.commandFacts).toMatchObject({ missingFile: true });
  });

  it("leaves malformed svvyx shell syntax on the ordinary shell path", async () => {
    const appLogEvents: AppLoggerEvent[] = [];
    const harness = createArtifactsHarness({ onAppLog: (event) => appLogEvents.push(event) });

    await expect(harness.run('svvyx artifacts create --name "unterminated --json')).rejects.toThrow(
      "JSON Parse error",
    );
    expect(appLogEvents).toEqual([]);
  });
});

async function expectArtifactErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  if (!thrown) {
    throw new Error(`Expected Artifacts command to fail with ${code}.`);
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toContain(`"code":"${code}"`);
}

function createActiveExecHarness(input: {
  commandText: string;
  cwd: string;
  packageRoot?: string;
  sessionId: string;
  sourceRoot?: string;
  toolCallId: string;
}) {
  const store = createStructuredSessionStateStore({
    digest: testDigest,
    workspace: {
      id: input.cwd,
      label: "svvy",
      cwd: input.cwd,
      artifactDir: join(input.cwd, "artifact-store"),
    },
    databasePath: join(input.cwd, "structured.sqlite"),
  });
  openStores.push(store);
  store.upsertPiSession({
    sessionId: input.sessionId,
    title: "Live svvyx",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:00:00.000Z",
  });
  const turn = store.startTurn({
    sessionId: input.sessionId,
    surfacePiSessionId: input.sessionId,
    requestSummary: "Run svvyx command",
  });
  const runtime = {
    current: createPromptExecutionContext({
      workspaceSessionId: input.sessionId,
      turnId: turn.id,
      surfacePiSessionId: input.sessionId,
      generatedAgentContextFingerprint: "generated_context_fingerprint_test",
      generatedAgentContextRevision: "generated_context_revision_test",
    }),
  };
  const command = store.createCommand({
    turnId: turn.id,
    toolName: "exec_command",
    executor: "orchestrator",
    visibility: "summary",
    title: "Run exec_command",
    summary: "Run svvyx command.",
    arguments: { cmd: input.commandText },
    facts: { toolCallId: input.toolCallId },
  });
  store.startCommand(command.id);
  const execTool = findTool(
    createSvvyDirectToolsForTest({
      cwd: input.cwd,
      runtime,
      store,
      workflowsGeneratedPackagePath: input.packageRoot,
      workflowsSourceRoot: input.sourceRoot,
    }).codingTools,
    "exec_command",
  );

  return { command, execTool, store };
}

function createArtifactsHarness(
  harnessOptions: {
    workspaceId?: string;
    workspaceLabel?: string;
    workspaceArtifactDir?: string;
    readArtifactRootForSession?: (sessionId: string) => string | null;
    onAppLog?: (event: AppLoggerEvent) => void;
  } = {},
) {
  const cwd = mkdtempSync(join(tmpdir(), "svvy-direct-tools-cwd-"));
  tempDirs.push(cwd);
  const artifactDir = join(cwd, "artifact-store");
  const store = createStructuredSessionStateStore({
    digest: testDigest,
    workspace: {
      id: harnessOptions.workspaceId ?? cwd,
      label: harnessOptions.workspaceLabel ?? "svvy",
      cwd,
      artifactDir: harnessOptions.workspaceArtifactDir ?? artifactDir,
    },
    databasePath: join(cwd, "structured.sqlite"),
  });
  openStores.push(store);
  const runtime = { current: null as ReturnType<typeof createPromptExecutionContext> | null };
  store.upsertPiSession({
    sessionId: "session-artifacts",
    title: "Artifacts session",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "high",
    messageCount: 1,
    status: "running",
    createdAt: "2026-06-08T10:00:00.000Z",
    updatedAt: "2026-06-08T10:00:00.000Z",
  });
  const turn = store.startTurn({
    sessionId: "session-artifacts",
    surfacePiSessionId: "session-artifacts",
    requestSummary: "Use artifacts",
  });
  runtime.current = createPromptExecutionContext({
    workspaceSessionId: "session-artifacts",
    turnId: turn.id,
    surfacePiSessionId: "session-artifacts",
    rootThreadId: null,
    generatedAgentContextFingerprint: "generated_context_fingerprint_test",
    generatedAgentContextRevision: "generated_context_revision_test",
  });
  const extensionsRoot = join(cwd, "extensions");
  const tools = createSvvyDirectToolsForTest({
    cwd,
    runtime,
    store,
    readArtifactRootForSession: harnessOptions.readArtifactRootForSession,
    onAppLog: harnessOptions.onAppLog,
    extensionsRoot,
  }).codingTools;
  const tool = tools.find((candidate) => candidate.name === "exec_command");
  if (!tool) {
    throw new Error("exec_command tool missing from harness.");
  }
  const patchTool = tools.find((candidate) => candidate.name === "apply_patch");
  if (!patchTool) {
    throw new Error("apply_patch tool missing from harness.");
  }

  return {
    cwd,
    artifactDir,
    store,
    turnId: turn.id,
    execRaw(commandText: string) {
      return tool.execute(
        `tool-${randomUUID()}`,
        { cmd: commandText },
        new AbortController().signal,
        () => {},
      );
    },
    applyPatchRaw(patch: string) {
      return patchTool.execute(
        `tool-${randomUUID()}`,
        { patch },
        new AbortController().signal,
        () => {},
      );
    },
    async run(
      commandText: string,
      options: { beforeExecute?: (command: { id: string }, toolCallId: string) => void } = {},
    ) {
      const toolCallId = `tool-${randomUUID()}`;
      const command = store.createCommand({
        turnId: turn.id,
        surfacePiSessionId: "session-artifacts",
        threadId: null,
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "summary",
        title: "Run exec_command",
        summary: commandText,
        facts: { toolCallId },
      });
      store.startCommand(command.id);
      try {
        options.beforeExecute?.(command, toolCallId);
        const result = await tool.execute(
          toolCallId,
          { cmd: commandText },
          new AbortController().signal,
          () => {},
        );
        const commandFacts =
          result.details!.commandFacts &&
          typeof result.details!.commandFacts === "object" &&
          !Array.isArray(result.details!.commandFacts)
            ? (result.details!.commandFacts as Record<string, unknown>)
            : null;
        store.finishCommand({
          commandId: command.id,
          status: "succeeded",
          facts: commandFacts,
        });
        const text = (result.content ?? []).find(
          (block): block is { type: "text"; text: string } => block.type === "text",
        )?.text;
        if (!text) {
          throw new Error("exec_command result did not include text output.");
        }
        return {
          command,
          result,
          details: result.details!,
          output: JSON.parse(text),
        };
      } catch (error) {
        store.finishCommand({
          commandId: command.id,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "svvy-direct-tools-"));
  tempDirs.push(dir);
  return dir;
}

function readSvvyxSubprocessTempDirs(): string[] {
  return readdirSync(tmpdir())
    .filter((entry) => entry.startsWith("svvyx-subprocess-"))
    .map((entry) => join(tmpdir(), entry))
    .filter((entry) => existsSync(entry));
}

function startLoopbackTextServer(): { stop: () => void; url: string } | null {
  try {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("network-ok\n"),
    });
    return {
      stop: () => server.stop(true),
      url: `http://127.0.0.1:${server.port}/`,
    };
  } catch {
    return null;
  }
}

function findTool(
  tools: Array<{ name: string; execute: AgentToolHarness["execute"] }>,
  name: string,
) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`${name} tool missing from harness.`);
  }
  return tool;
}

type AgentToolHarness = {
  execute: (
    toolCallId: string,
    input: unknown,
    signal: AbortSignal,
    onUpdate: () => void,
  ) => Promise<NativeToolResult>;
};

function readText(result: Pick<NativeToolResult, "content">): string {
  return (result.content ?? [])
    .filter(
      (block): block is { readonly type: "text"; readonly text: string } => block.type === "text",
    )
    .map((block) => block.text ?? "")
    .join("\n");
}

/**
 * Unwrap exec_command command facts. The exec_command tool keeps its facts
 * (sandboxDenied, exitCode, sandboxEngine, etc.) on `details` as a JSON record
 * that widens to `CommandResultEnvelope`; tests read the typed-ish fields here.
 */
function execFacts(result: Pick<NativeToolResult, "details">): Record<string, unknown> | undefined {
  return result.details as unknown as Record<string, unknown> | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
