import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createPromptExecutionContext } from "./prompt-execution-context";
import type { AppLoggerEvent } from "./app-logger";
import { buildStructuredSessionView } from "./structured-session-selectors";
import { createStructuredSessionStateStore } from "./structured-session-state";
import { createSvvyDirectTools } from "./svvy-direct-tools";
import { createToolExecutionCommandTracker } from "./tool-execution-command-tracker";

const tempDirs: string[] = [];

function createSvvyDirectToolsForTest(
  options: Omit<Parameters<typeof createSvvyDirectTools>[0], "extensionsRoot"> & {
    extensionsRoot?: string;
  },
): ReturnType<typeof createSvvyDirectTools> {
  return createSvvyDirectTools({
    ...options,
    extensionsRoot: options.extensionsRoot ?? join(options.cwd, ".svvy-test", "extensions"),
  });
}
const openStores: ReturnType<typeof createStructuredSessionStateStore>[] = [];

describe("svvy direct tools", () => {
  afterEach(() => {
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
        sessionId: "session-live-exec",
        turnId: turn.id,
        surfacePiSessionId: "session-live-exec",
        promptText: "Run a command",
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
      sessionId: "session-retained-output",
      turnId: turn.id,
      surfacePiSessionId: "session-retained-output",
      promptText: "Run a command",
    });
    const tracker = createToolExecutionCommandTracker({ store, promptContext });
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

  it("records intercepted svvyx workflow output and progress as durable command events", async () => {
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
            source: "svvyx-dispatch",
          }),
        }),
        expect.objectContaining({
          kind: "command.progress",
          data: expect.objectContaining({
            command: "svvyx workflows list --json",
            family: "workflows",
            phase: "succeeded",
            source: "svvyx-dispatch",
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

  it("retains oversized intercepted svvyx workflow output in command facts", async () => {
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

  it("records intercepted svvyx workflow failures as live stderr", async () => {
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
          text: expect.stringContaining('"code": "unsupported_command"'),
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

  it("does not duplicate intercepted svvyx live output when the generic tracker settles the command", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    mkdirSync(join(packageRoot, "prompts"), { recursive: true });
    writeFileSync(
      join(packageRoot, "prompts", "ReviewPrompt.ts"),
      "export const ReviewPrompt = ``;\n",
    );
    const store = createStructuredSessionStateStore({
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
      sessionId: "session-live-workflows-tracker",
      turnId: turn.id,
      surfacePiSessionId: "session-live-workflows-tracker",
      promptText: "Run a workflow command",
    });
    const tracker = createToolExecutionCommandTracker({
      store,
      promptContext,
    });
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
        sessionId: "session-running-exec",
        turnId: turn.id,
        surfacePiSessionId: "session-running-exec",
        promptText: "Run a long command",
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
        sessionId: "session-running-retained-exec",
        turnId: turn.id,
        surfacePiSessionId: "session-running-retained-exec",
        promptText: "Run a long command",
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

  it("routes network-disabled shell commands through sandbox-exec without fallback", async () => {
    const cwd = createTempDir();
    const blockedExecTool = findTool(
      createSvvyDirectToolsForTest({ cwd, networkAccess: false }).codingTools,
      "exec_command",
    );
    if (!existsSync("/usr/bin/sandbox-exec")) {
      await expect(
        blockedExecTool.execute(
          "tool-shell-network-disabled",
          { cmd: "echo should-fail" },
          new AbortController().signal,
          () => {},
        ),
      ).rejects.toThrow("networkAccess=false requires /usr/bin/sandbox-exec");
      return;
    }

    const blocked = await blockedExecTool.execute(
      "tool-shell-network-disabled",
      { cmd: "echo sandbox-ok" },
      new AbortController().signal,
      () => {},
    );

    const output = readText(blocked);

    if (output.includes("sandbox_apply")) {
      // Nested sandbox environment: sandbox-exec couldn't apply, the
      // command did not run unsandboxed and exited nonzero.
      expect(output).not.toContain("sandbox-ok");
      expect(output).toContain("exit code:");
      expect(output).not.toContain("exit code: 0");
    } else {
      // Sandbox applied successfully; the network policy itself is covered by
      // filesystem-sandbox-policy tests that generate the same Seatbelt profile.
      expect(output).toContain("sandbox-ok");
      expect(output).toContain("exit code: 0");
    }
  });

  it("allows default loopback networking and denies it when the sandbox can run", async () => {
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

      if (!existsSync("/usr/bin/sandbox-exec")) {
        expect(existsSync("/usr/bin/sandbox-exec")).toBe(false);
        return;
      }

      const blockedExecTool = findTool(
        createSvvyDirectToolsForTest({ cwd, networkAccess: false }).codingTools,
        "exec_command",
      );
      const blocked = await blockedExecTool.execute(
        "tool-shell-loopback-network-disabled",
        {
          cmd: `bun -e "try { console.log(await (await fetch('${server.url}')).text()); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(37); }"`,
          timeout: 5,
        },
        new AbortController().signal,
        () => {},
      );
      const output = readText(blocked);
      expect(output).not.toContain("network-ok");
      expect(output).not.toContain("exit code: 0");
      expect(output.includes("exit code:") || output.includes("terminated by signal:")).toBe(true);
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
        '  label: "Reviewer",',
        "} satisfies Agents.TaskAgentParameters;",
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
        sourcePath: join(sourceRoot, "agents", "reviewerAgent.agent.json"),
        generatedPath: join(packageRoot, "agents", "reviewerAgent.ts"),
      },
      {
        kind: "component",
        namespace: "Components",
        exportName: "ReviewPanel",
        qualifiedName: "Components.ReviewPanel",
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
    const appLogEvents: AppLoggerEvent[] = [];
    mkdirSync(join(sourceRoot, "prompts"), { recursive: true });
    writeFileSync(join(sourceRoot, "prompts", "ReviewPrompt.mdx"), "# Review\n");
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workflowsGeneratedPackagePath: packageRoot,
        workflowsModelCatalog: () => [],
        workflowsSourceRoot: sourceRoot,
        onAppLog: (event) => appLogEvents.push(event),
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
          workflowLinkedWorkspaceCount: 0,
        },
      },
    ]);
    expect(appLogEvents).toContainEqual(
      expect.objectContaining({
        level: "info",
        source: "workflow.library",
        message: "Workflows build validation passed.",
        details: expect.objectContaining({
          command: "svvyx workflows build --json",
          workflowBuildOk: true,
          workflowDiagnosticCount: 0,
          workflowExportCount: 1,
          workflowLinkedWorkspaceCount: 0,
        }),
      }),
    );
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

  it("saves reusable prompt sources, runs Workflows build, and rejects overwrite without --overwrite", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    const promptPath = join(cwd, ".smithers", "prompts", "review-prompt.mdx");
    const nextPromptPath = join(cwd, ".smithers", "prompts", "next-review-prompt.mdx");
    const outsidePromptPath = join(cwd, "outside-review-prompt.mdx");
    const otherWorkspace = createTempDir();
    const events: unknown[] = [];
    mkdirSync(join(cwd, ".smithers", "prompts"), { recursive: true });
    mkdirSync(join(otherWorkspace, ".smithers"), { recursive: true });
    writeFileSync(promptPath, "# Review\n");
    writeFileSync(nextPromptPath, "# Replacement\n");
    writeFileSync(outsidePromptPath, "# Outside\n");
    symlinkSync(outsidePromptPath, join(cwd, ".smithers", "prompts", "outside-link.mdx"));
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workflowsGeneratedPackagePath: packageRoot,
        workflowsModelCatalog: () => [],
        workflowsSourceRoot: sourceRoot,
        workflowsWorkspaceCwds: () => [cwd, otherWorkspace],
        onWorkflowsGeneratedPackageChanged: (event) => {
          events.push(event);
        },
      }).codingTools,
      "exec_command",
    );

    const saved = await execTool.execute(
      "tool-workflows-save-prompt",
      {
        cmd: "svvyx workflows save --from .smithers/prompts/review-prompt.mdx --kind prompt --as ReviewPrompt --json",
      },
      new AbortController().signal,
      () => {},
    );
    const output = JSON.parse(readText(saved));

    expect(output).toMatchObject({
      ok: true,
      kind: "prompt",
      exportName: "ReviewPrompt",
      sourcePath: join(sourceRoot, "prompts", "ReviewPrompt.mdx"),
      generatedPackagePath: packageRoot,
      linkedWorkspaces: [cwd, otherWorkspace],
    });
    expect(saved.details?.commandFacts).toMatchObject({
      workflowLinkedWorkspaceCount: 2,
    });
    expect(events).toEqual([
      {
        reason: "svvyx-workflows-save",
        commandFacts: {
          workflowSavedExportName: "ReviewPrompt",
          workflowSavedKind: "prompt",
          workflowSourcePath: join(sourceRoot, "prompts", "ReviewPrompt.mdx"),
          workflowBuildOk: true,
          workflowExportCount: 1,
          workflowLinkedWorkspaceCount: 2,
        },
      },
    ]);
    expect(existsSync(join(cwd, ".smithers", "node_modules", "@svvy", "workflows"))).toBe(true);
    expect(
      existsSync(join(otherWorkspace, ".smithers", "node_modules", "@svvy", "workflows")),
    ).toBe(true);
    expect(readFileSync(join(sourceRoot, "prompts", "ReviewPrompt.mdx"), "utf8")).toBe(
      "# Review\n",
    );
    expect(readFileSync(join(packageRoot, "index.ts"), "utf8")).toBe(
      [
        'export * as Agents from "./agents";',
        'export * as Components from "./components";',
        'export * as Prompts from "./prompts";',
        'export * as Workflows from "./workflows";',
        "",
      ].join("\n"),
    );
    expect(readFileSync(join(packageRoot, "prompts", "ReviewPrompt.ts"), "utf8")).toContain(
      "export const ReviewPrompt",
    );
    const listed = await execTool.execute(
      "tool-workflows-list-after-save",
      { cmd: "svvyx workflows list --kind prompt --json" },
      new AbortController().signal,
      () => {},
    );
    expect(JSON.parse(readText(listed)).items).toEqual([
      {
        kind: "prompt",
        namespace: "Prompts",
        exportName: "ReviewPrompt",
        qualifiedName: "Prompts.ReviewPrompt",
        sourcePath: join(sourceRoot, "prompts", "ReviewPrompt.mdx"),
        generatedPath: join(packageRoot, "prompts", "ReviewPrompt.ts"),
      },
    ]);

    await expect(
      execTool.execute(
        "tool-workflows-save-prompt-overwrite-rejected",
        {
          cmd: "svvyx workflows save --from .smithers/prompts/next-review-prompt.mdx --kind prompt --as ReviewPrompt --json",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("target_exists");
    expect(readFileSync(join(sourceRoot, "prompts", "ReviewPrompt.mdx"), "utf8")).toBe(
      "# Review\n",
    );
    expect(events).toHaveLength(1);

    await expect(
      execTool.execute(
        "tool-workflows-save-prompt-export-rejected",
        {
          cmd: "svvyx workflows save --from .smithers/prompts/review-prompt.mdx --kind prompt --export ReviewPrompt --as PromptExport --json",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("direct MDX");
    expect(existsSync(join(sourceRoot, "prompts", "PromptExport.mdx"))).toBe(false);
    expect(events).toHaveLength(1);

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
    expect(events).toHaveLength(1);

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
    expect(events).toHaveLength(1);

    await expect(
      execTool.execute(
        "tool-workflows-save-generated-link-source-rejected",
        {
          cmd: "svvyx workflows save --from .smithers/node_modules/@svvy/workflows/prompts/ReviewPrompt.ts --kind component --as GeneratedPromptSource --json",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("workspace .smithers source file");
    expect(existsSync(join(sourceRoot, "components", "GeneratedPromptSource.ts"))).toBe(false);
    expect(events).toHaveLength(1);
  });

  it("rolls back source and generated packages when save linking fails", async () => {
    const cwd = createTempDir();
    const badWorkspace = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    const extensionsPackageRoot = join(cwd, "generated", "extensions-package");
    const reviewPromptPath = join(cwd, ".smithers", "prompts", "review-prompt.mdx");
    const secondPromptPath = join(cwd, ".smithers", "prompts", "second-prompt.mdx");
    let workspaceCwds = [cwd];
    mkdirSync(join(cwd, ".smithers", "prompts"), { recursive: true });
    writeFileSync(reviewPromptPath, "# Review\n");
    writeFileSync(secondPromptPath, "# Second\n");
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workflowsExtensionsGeneratedPackagePath: extensionsPackageRoot,
        workflowsGeneratedPackagePath: packageRoot,
        workflowsModelCatalog: () => [],
        workflowsSourceRoot: sourceRoot,
        workflowsWorkspaceCwds: () => workspaceCwds,
      }).codingTools,
      "exec_command",
    );

    await execTool.execute(
      "tool-workflows-save-initial-prompt",
      {
        cmd: "svvyx workflows save --from .smithers/prompts/review-prompt.mdx --kind prompt --as ReviewPrompt --json",
      },
      new AbortController().signal,
      () => {},
    );

    writeFileSync(join(extensionsPackageRoot, "preserved-marker.txt"), "preserved\n");
    mkdirSync(join(badWorkspace, ".smithers", "node_modules", "@svvy", "extensions"), {
      recursive: true,
    });
    workspaceCwds = [cwd, badWorkspace];
    await expect(
      execTool.execute(
        "tool-workflows-save-link-failure",
        {
          cmd: "svvyx workflows save --from .smithers/prompts/second-prompt.mdx --kind prompt --as SecondPrompt --json",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("link_failed");

    expect(existsSync(join(sourceRoot, "prompts", "SecondPrompt.mdx"))).toBe(false);
    expect(existsSync(join(packageRoot, "prompts", "SecondPrompt.ts"))).toBe(false);
    expect(existsSync(join(packageRoot, "prompts", "ReviewPrompt.ts"))).toBe(true);
    expect(readFileSync(join(extensionsPackageRoot, "preserved-marker.txt"), "utf8")).toBe(
      "preserved\n",
    );
    const listed = await execTool.execute(
      "tool-workflows-list-after-link-failure",
      { cmd: "svvyx workflows list --json" },
      new AbortController().signal,
      () => {},
    );
    expect(
      JSON.parse(readText(listed)).items.map(
        (item: { qualifiedName: string }) => item.qualifiedName,
      ),
    ).toEqual(["Prompts.ReviewPrompt"]);
  });

  it("checks Workflows save sources against the workspace root when workdir is nested", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    const promptsDir = join(cwd, ".smithers", "prompts");
    mkdirSync(promptsDir, { recursive: true });
    writeFileSync(join(promptsDir, "nested-prompt.mdx"), "# Nested\n");
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workflowsGeneratedPackagePath: packageRoot,
        workflowsModelCatalog: () => [],
        workflowsSourceRoot: sourceRoot,
      }).codingTools,
      "exec_command",
    );

    const saved = await execTool.execute(
      "tool-workflows-save-nested-workdir",
      {
        cmd: "svvyx workflows save --from nested-prompt.mdx --kind prompt --as NestedPrompt --json",
        workdir: promptsDir,
      },
      new AbortController().signal,
      () => {},
    );

    expect(JSON.parse(readText(saved))).toMatchObject({
      ok: true,
      kind: "prompt",
      exportName: "NestedPrompt",
      sourcePath: join(sourceRoot, "prompts", "NestedPrompt.mdx"),
      linkedWorkspaces: [cwd],
    });
    expect(existsSync(join(cwd, ".smithers", "node_modules", "@svvy", "workflows"))).toBe(true);
  });

  it("saves selected component and workflow exports and rejects unsafe non-agent extraction", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    mkdirSync(join(cwd, ".smithers", "components"), { recursive: true });
    mkdirSync(join(cwd, ".smithers", "workflows"), { recursive: true });
    writeFileSync(
      join(cwd, ".smithers", "components", "components.tsx"),
      [
        "export function ReviewPanel() {",
        "  return null;",
        "}",
        "export function OtherPanel() {",
        "  return null;",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(cwd, ".smithers", "components", "unsafe-components.tsx"),
      [
        "const label = 'Review';",
        "export function ReviewPanel() {",
        "  return label;",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(cwd, ".smithers", "workflows", "workflows.tsx"),
      [
        "export async function ReviewWorkflow() {",
        "  return null;",
        "}",
        "export async function OtherWorkflow() {",
        "  return null;",
        "}",
        "",
      ].join("\n"),
    );
    const execTool = findTool(
      createSvvyDirectToolsForTest({
        cwd,
        workflowsGeneratedPackagePath: packageRoot,
        workflowsModelCatalog: () => [],
        workflowsSourceRoot: sourceRoot,
      }).codingTools,
      "exec_command",
    );

    const saved = await execTool.execute(
      "tool-workflows-save-component-export",
      {
        cmd: "svvyx workflows save --from .smithers/components/components.tsx --kind component --export ReviewPanel --as SavedReviewPanel --json",
      },
      new AbortController().signal,
      () => {},
    );

    expect(JSON.parse(readText(saved))).toMatchObject({
      ok: true,
      kind: "component",
      exportName: "SavedReviewPanel",
      sourcePath: join(sourceRoot, "components", "SavedReviewPanel.tsx"),
    });
    const savedSource = readFileSync(
      join(sourceRoot, "components", "SavedReviewPanel.tsx"),
      "utf8",
    );
    expect(savedSource).toContain("export function SavedReviewPanel()");
    expect(savedSource).not.toContain("OtherPanel");
    expect(readFileSync(join(packageRoot, "components", "SavedReviewPanel.tsx"), "utf8")).toBe(
      savedSource,
    );
    const listed = await execTool.execute(
      "tool-workflows-list-component-export",
      { cmd: "svvyx workflows list --kind component --json" },
      new AbortController().signal,
      () => {},
    );
    expect(JSON.parse(readText(listed)).items).toEqual([
      {
        kind: "component",
        namespace: "Components",
        exportName: "SavedReviewPanel",
        qualifiedName: "Components.SavedReviewPanel",
        sourcePath: join(sourceRoot, "components", "SavedReviewPanel.tsx"),
        generatedPath: join(packageRoot, "components", "SavedReviewPanel.tsx"),
      },
    ]);

    const savedWorkflow = await execTool.execute(
      "tool-workflows-save-workflow-export",
      {
        cmd: "svvyx workflows save --from .smithers/workflows/workflows.tsx --kind workflow --export ReviewWorkflow --as SavedReviewWorkflow --json",
      },
      new AbortController().signal,
      () => {},
    );
    expect(JSON.parse(readText(savedWorkflow))).toMatchObject({
      ok: true,
      kind: "workflow",
      exportName: "SavedReviewWorkflow",
      sourcePath: join(sourceRoot, "workflows", "SavedReviewWorkflow.tsx"),
    });
    const savedWorkflowSource = readFileSync(
      join(sourceRoot, "workflows", "SavedReviewWorkflow.tsx"),
      "utf8",
    );
    expect(savedWorkflowSource).toContain("export async function SavedReviewWorkflow()");
    expect(savedWorkflowSource).not.toContain("OtherWorkflow");
    expect(readFileSync(join(packageRoot, "workflows", "SavedReviewWorkflow.tsx"), "utf8")).toBe(
      savedWorkflowSource,
    );
    const listedWorkflow = await execTool.execute(
      "tool-workflows-list-workflow-export",
      { cmd: "svvyx workflows list --kind workflow --json" },
      new AbortController().signal,
      () => {},
    );
    expect(JSON.parse(readText(listedWorkflow)).items).toEqual([
      {
        kind: "workflow",
        namespace: "Workflows",
        exportName: "SavedReviewWorkflow",
        qualifiedName: "Workflows.SavedReviewWorkflow",
        sourcePath: join(sourceRoot, "workflows", "SavedReviewWorkflow.tsx"),
        generatedPath: join(packageRoot, "workflows", "SavedReviewWorkflow.tsx"),
      },
    ]);

    await expect(
      execTool.execute(
        "tool-workflows-save-component-export-unsafe",
        {
          cmd: "svvyx workflows save --from .smithers/components/unsafe-components.tsx --kind component --export ReviewPanel --as UnsafeReviewPanel --json",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("invalid_source_export");
    expect(existsSync(join(sourceRoot, "components", "UnsafeReviewPanel.tsx"))).toBe(false);
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
          reasoningEffort: "low",
          instructions: "Handle the task.",
          extensions: ["shell"],
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
        '  reasoningEffort: "medium",',
        '  instructions: "Review strictly.",',
        '  extensions: ["shell"],',
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
        '  reasoningEffort: "medium",',
        '  instructions: "Review strictly.",',
        '  extensions: ["shell"],',
        "});",
      ].join("\n"),
    );
    const execTool = findTool(
      createSvvyDirectToolsForTest({
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
    expect(
      JSON.parse(readFileSync(join(sourceRoot, "agents", "reviewerAgent.agent.json"), "utf8")),
    ).toMatchObject({
      id: "reviewerAgent",
      label: "Reviewer",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      extensions: ["shell"],
    });
    expect(readFileSync(join(packageRoot, "agents", "index.ts"), "utf8")).toContain(
      "export function defineTaskAgent",
    );
    expect(readFileSync(join(packageRoot, "agents", "index.ts"), "utf8")).toContain(
      'export { reviewerAgent } from "./reviewerAgent";',
    );

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
  });

  it("fails svvyx workflows build with structured diagnostics for invalid agent records", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const packageRoot = join(cwd, "generated", "package");
    const events: unknown[] = [];
    const appLogEvents: AppLoggerEvent[] = [];
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "agents", "badAgent.agent.json"),
      JSON.stringify(
        {
          id: "badAgent",
          label: "Bad Agent",
          provider: "openai",
          model: "missing-model",
          reasoningEffort: "medium",
          instructions: "Review strictly.",
          extensions: ["missing-extension"],
        },
        null,
        2,
      ),
    );
    const execTool = findTool(
      createSvvyDirectToolsForTest({
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
        onAppLog: (event) => appLogEvents.push(event),
        onWorkflowsGeneratedPackageChanged: (event) => {
          events.push(event);
        },
      }).codingTools,
      "exec_command",
    );

    let thrown: unknown;
    try {
      await execTool.execute(
        "tool-workflows-build-invalid-agent",
        { cmd: "svvyx workflows build --json" },
        new AbortController().signal,
        () => {},
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("invalid_agent_model");
    const thrownPayload = JSON.parse((thrown as Error).message);
    expect(thrownPayload.commandFacts).toEqual({
      svvyxDispatch: true,
      extensionId: "workflows",
      extensionArgv: ["build", "--json"],
      workflowCommand: "build",
      workflowBuildOk: false,
      errorCode: "build_failed",
      workflowDiagnosticCount: 2,
    });
    await expect(
      execTool.execute(
        "tool-workflows-build-invalid-agent",
        { cmd: "svvyx workflows build --json" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("invalid_agent_model");
    expect(existsSync(packageRoot)).toBe(false);
    expect(events).toEqual([]);
    expect(appLogEvents).toContainEqual(
      expect.objectContaining({
        level: "warning",
        source: "workflow.library",
        message: "Workflows build validation failed.",
        details: expect.objectContaining({
          command: "svvyx workflows build --json",
          errorCode: "build_failed",
          errorMessage: "Workflows build failed.",
          workflowDiagnosticCount: 2,
        }),
      }),
    );
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
      "@svvy",
      "workflows",
      "prompts",
      "GeneratedPrompt.ts",
    );
    const workspaceExtensionsLinkFile = join(
      cwd,
      ".smithers",
      "node_modules",
      "@svvy",
      "extensions",
      "index.ts",
    );
    mkdirSync(join(sourceRoot, "prompts"), { recursive: true });
    mkdirSync(join(packageRoot, "prompts"), { recursive: true });
    mkdirSync(extensionsPackageRoot, { recursive: true });
    mkdirSync(join(cwd, ".smithers", "node_modules", "@svvy", "workflows", "prompts"), {
      recursive: true,
    });
    mkdirSync(join(cwd, ".smithers", "node_modules", "@svvy", "extensions"), {
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
            "--- .smithers/node_modules/@svvy/workflows/prompts/GeneratedPrompt.ts",
            "+++ .smithers/node_modules/@svvy/workflows/prompts/GeneratedPrompt.ts",
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
            "--- .smithers/node_modules/@svvy/extensions/index.ts",
            "+++ .smithers/node_modules/@svvy/extensions/index.ts",
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
          cmd: "bun -e \"Bun.write('.smithers/node_modules/@svvy/workflows/prompts/GeneratedPrompt.ts', 'hacked link')\"",
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
          cmd: "bun -e \"Bun.write('.smithers/node_modules/@svvy/extensions/index.ts', 'hacked extension link')\"",
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
    rmSync(join(cwd, ".smithers", "node_modules", "@svvy", "workflows"), {
      force: true,
      recursive: true,
    });
    rmSync(join(cwd, ".smithers", "node_modules", "@svvy", "extensions"), {
      force: true,
      recursive: true,
    });

    await execTool.execute(
      "tool-workflows-build-regenerates-package",
      { cmd: "svvyx workflows build --json" },
      new AbortController().signal,
      () => {},
    );

    expect(readFileSync(join(packageRoot, "prompts", "ReviewPrompt.ts"), "utf8")).toContain(
      "Review",
    );
  });

  it("rejects direct edits to the generated @svvy/extensions package path", async () => {
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

  it("rejects direct edits to the default generated @svvy/extensions package path without touching the real home", () => {
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
    const patchTool = findTool(createSvvyDirectToolsForTest({ cwd }).codingTools, "apply_patch");

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
    const patchTool = findTool(createSvvyDirectToolsForTest({ cwd }).codingTools, "apply_patch");

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
  });

  it("allows apply_patch writes to app-owned editable Extension source roots", async () => {
    const cwd = createTempDir();
    const extensionsRoot = createTempDir();
    const manifestPath = join(extensionsRoot, "sources", "user", "notes", "manifest.json");
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, '{"schemaVersion":1}\n');
    const patchTool = findTool(
      createSvvyDirectToolsForTest({ cwd, extensionsRoot }).codingTools,
      "apply_patch",
    );

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

  it("blocks svvyx command-family dispatch at the same exec_command approval boundary", async () => {
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
        commandFamily: "svvyx_artifacts",
        cwd,
        toolCallId: "tool-denied-svvyx-artifacts",
        toolName: "exec_command",
      }),
      expect.objectContaining({
        approvalMode: "user",
        command: "svvyx workflows list --json",
        commandFamily: "svvyx_workflows",
        cwd,
        toolCallId: "tool-denied-svvyx-workflows",
        toolName: "exec_command",
      }),
      expect.objectContaining({
        approvalMode: "user",
        command: "svvyx extensions list --json",
        commandFamily: "svvyx_extensions",
        cwd,
        toolCallId: "tool-denied-svvyx-extensions",
        toolName: "exec_command",
      }),
      expect.objectContaining({
        approvalMode: "user",
        command: "svvyx linear search --json",
        commandFamily: "svvyx_runtime",
        cwd,
        toolCallId: "tool-denied-svvyx-runtime",
        toolName: "exec_command",
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
    expect(result.details.commandFacts).toMatchObject({
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

  it("returns UI_UNAVAILABLE for active artifact opens without an attached UI bridge", async () => {
    const harness = createArtifactsHarness();
    const created = await harness.run("svvyx artifacts create --name open.md --json");

    await expectArtifactErrorCode(
      harness.run(`svvyx artifacts open --id ${created.output.id} --json`),
      "UI_UNAVAILABLE",
    );
  });

  it("opens active artifacts through the attached UI bridge", async () => {
    const openedArtifacts: Array<{ sessionId: string; artifactId: string }> = [];
    const harness = createArtifactsHarness({
      openArtifact: (request) => {
        openedArtifacts.push(request);
        return true;
      },
    });
    const created = await harness.run("svvyx artifacts create --name open.md --json");

    const opened = await harness.run(`svvyx artifacts open --id ${created.output.id} --json`);

    expect(opened.output).toEqual({ id: created.output.id, opened: true });
    expect(opened.details.commandFacts).toEqual({
      artifactId: created.output.id,
      opened: true,
    });
    expect(openedArtifacts).toEqual([
      {
        sessionId: "session-artifacts",
        artifactId: created.output.id,
      },
    ]);
  });

  it("opens artifact inspector panes for records whose backing file is missing", async () => {
    const openedArtifacts: Array<{ sessionId: string; artifactId: string }> = [];
    const harness = createArtifactsHarness({
      openArtifact: (request) => {
        openedArtifacts.push(request);
        return true;
      },
    });
    const created = await harness.run("svvyx artifacts create --name missing.md --json");
    rmSync(created.output.path);

    const opened = await harness.run(`svvyx artifacts open --id ${created.output.id} --json`);

    expect(opened.output).toEqual({ id: created.output.id, opened: true });
    expect(openedArtifacts).toEqual([
      {
        sessionId: "session-artifacts",
        artifactId: created.output.id,
      },
    ]);
  });

  it("formats malformed Artifacts command parse errors as JSON error results", async () => {
    const appLogEvents: AppLoggerEvent[] = [];
    const harness = createArtifactsHarness({ onAppLog: (event) => appLogEvents.push(event) });

    await expectArtifactErrorCode(
      harness.run('svvyx artifacts create --name "unterminated --json'),
      "INVALID_ARGUMENT",
    );
    expect(appLogEvents).toContainEqual(
      expect.objectContaining({
        level: "warning",
        source: "artifact",
        message: "Artifact command failed.",
        details: expect.objectContaining({
          workspaceSessionId: "session-artifacts",
          surfacePiSessionId: "session-artifacts",
          errorCode: "INVALID_ARGUMENT",
        }),
      }),
    );
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
      sessionId: input.sessionId,
      turnId: turn.id,
      surfacePiSessionId: input.sessionId,
      promptText: "Run svvyx command",
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
    onAppLog?: (event: AppLoggerEvent) => void;
    openArtifact?: (request: {
      sessionId: string;
      artifactId: string;
    }) => boolean | Promise<boolean>;
  } = {},
) {
  const cwd = mkdtempSync(join(tmpdir(), "svvy-direct-tools-cwd-"));
  tempDirs.push(cwd);
  const artifactDir = join(cwd, "artifact-store");
  const store = createStructuredSessionStateStore({
    workspace: {
      id: harnessOptions.workspaceId ?? cwd,
      label: harnessOptions.workspaceLabel ?? "svvy",
      cwd,
      artifactDir,
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
    sessionId: "session-artifacts",
    turnId: turn.id,
    surfacePiSessionId: "session-artifacts",
    rootThreadId: null,
    promptText: "Use artifacts",
  });
  const extensionsRoot = join(cwd, "extensions");
  const tools = createSvvyDirectToolsForTest({
    cwd,
    runtime,
    store,
    openArtifact: harnessOptions.openArtifact,
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
        store.finishCommand({
          commandId: command.id,
          status: "succeeded",
          facts: result.details?.commandFacts ?? null,
        });
        const text = result.content.find(
          (block): block is { type: "text"; text: string } => block.type === "text",
        )?.text;
        if (!text) {
          throw new Error("exec_command result did not include text output.");
        }
        return {
          command,
          result,
          details: result.details,
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
  ) => Promise<{
    content: Array<{ type: string; text?: string }>;
    details?: Record<string, unknown>;
  }>;
};

function readText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
