import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as PiCodingAgent from "@mariozechner/pi-coding-agent";
import { ensureSmithersTables } from "smithers-orchestrator";
import { runWithToolContext } from "smithers-orchestrator/tools";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "../structured-session-state";
import { createWorkflowTaskAgent } from "./workflow-task-agent";
import { createDefaultWorkflowTaskAgentProfile } from "./workflow-task-agent-profile";

const tempDirs: string[] = [];
const stores: StructuredSessionStateStore[] = [];

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

type Fixture = {
  root: string;
  workspaceRoot: string;
  taskRoot: string;
  agentDir: string;
  artifactDir: string;
  store: StructuredSessionStateStore;
  workflowRunId: string;
  smithersRunId: string;
};

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "svvy-workflow-task-agent-"));
  tempDirs.push(root);
  const workspaceRoot = join(root, "workspace");
  const taskRoot = join(root, "worktree");
  const agentDir = join(root, "agent");
  const artifactDir = join(workspaceRoot, ".svvy", "smithers-runtime", "artifacts", "task-agent");
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(taskRoot, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(artifactDir, { recursive: true });

  const store = createStructuredSessionStateStore({
    workspace: {
      id: workspaceRoot,
      label: "svvy",
      cwd: workspaceRoot,
    },
    databasePath: join(root, "structured-session-state.sqlite"),
  });
  stores.push(store);

  const sessionId = "session-workflow-task-agent";
  store.upsertPiSession({
    sessionId,
    title: "Workflow Task Agent Session",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-04-22T08:00:00.000Z",
    updatedAt: "2026-04-22T08:00:00.000Z",
  });

  const orchestratorTurn = store.startTurn({
    sessionId,
    surfacePiSessionId: sessionId,
    requestSummary: "Delegate task agent work",
  });
  const thread = store.createThread({
    turnId: orchestratorTurn.id,
    surfacePiSessionId: "pi-thread-task-agent",
    title: "Task Agent Thread",
    objective: "Supervise one workflow task agent attempt.",
  });
  store.finishTurn({
    turnId: orchestratorTurn.id,
    status: "completed",
  });

  const handlerTurn = store.startTurn({
    sessionId,
    surfacePiSessionId: thread.surfacePiSessionId,
    threadId: thread.id,
    requestSummary: "Launch task workflow",
  });
  const workflowCommand = store.createCommand({
    turnId: handlerTurn.id,
    threadId: thread.id,
    toolName: "smithers.run_workflow.test_task",
    executor: "smithers",
    visibility: "surface",
    title: "Launch task workflow",
    summary: "Launch the task workflow.",
  });
  store.startCommand(workflowCommand.id);
  store.finishCommand({
    commandId: workflowCommand.id,
    status: "succeeded",
    summary: "Task workflow launched.",
  });

  const workflowRun = store.recordWorkflow({
    threadId: thread.id,
    commandId: workflowCommand.id,
    smithersRunId: "smithers-run-task-agent",
    workflowName: "test_task",
    workflowSource: "saved",
    entryPath: ".svvy/workflows/entries/test-task.tsx",
    savedEntryId: "test_task",
    status: "running",
    smithersStatus: "running",
    waitKind: null,
    continuedFromRunIds: [],
    activeDescendantRunId: null,
    lastEventSeq: null,
    pendingAttentionSeq: null,
    lastAttentionSeq: null,
    heartbeatAt: null,
    summary: "Task workflow is running.",
  });

  return {
    root,
    workspaceRoot,
    taskRoot,
    agentDir,
    artifactDir,
    store,
    workflowRunId: workflowRun.id,
    smithersRunId: workflowRun.smithersRunId,
  };
}

function createAssistantMessage(
  text: string,
  usage = {
    input: 12,
    output: 34,
    cacheRead: 5,
    cacheWrite: 0,
    totalTokens: 46,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  },
) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: {} as never,
    provider: "" as never,
    model: "gpt-5.4",
    usage,
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

function insertSmithersAttemptByResume(input: {
  workspaceRoot: string;
  runId: string;
  nodeId: string;
  iteration: number;
  attempt: number;
  rootDir: string;
  agentResume: string;
}) {
  const runtimeRoot = join(input.workspaceRoot, ".svvy", "smithers-runtime");
  mkdirSync(runtimeRoot, { recursive: true });
  const db = new Database(join(runtimeRoot, "smithers.db"));
  try {
    ensureSmithersTables(db as any);
    db
      .query(
        `INSERT OR REPLACE INTO _smithers_attempts (
           run_id,
           node_id,
           iteration,
           attempt,
           state,
           started_at_ms,
           finished_at_ms,
           heartbeat_at_ms,
           heartbeat_data_json,
           error_json,
           jj_pointer,
           response_text,
           jj_cwd,
           cached,
           meta_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.nodeId,
        input.iteration,
        input.attempt,
        "in-progress",
        Date.now(),
        null,
        Date.now(),
        JSON.stringify({
          agentResume: input.agentResume,
          agentEngine: "pi",
        }),
        null,
        null,
        null,
        input.rootDir,
        0,
        JSON.stringify({
          agentResume: input.agentResume,
          agentEngine: "pi",
          agentId: "svvy-workflow-task-agent",
          agentModel: "gpt-5.4",
          label: input.nodeId,
        }),
      );
  } finally {
    db.close();
  }
}

describe("workflow task agent", () => {
  it("executes from the Smithers task root, projects the task attempt before tool execution, and returns normalized usage", async () => {
    const fixture = createFixture();
    const createAgentSessionSpy = spyOn(PiCodingAgent, "createAgentSession");

    createAgentSessionSpy.mockImplementation(async (options: any) => {
      const subscribers = new Set<(event: Record<string, unknown>) => void>();
      const stateMessages: any[] = [];

      return {
        session: {
          agent: {
            state: {
              messages: stateMessages,
            },
            prompt: async (messages: any[]) => {
              stateMessages.push(...messages);
              subscribers.forEach((callback) =>
                callback({
                  type: "message_update",
                  message: null,
                  assistantMessageEvent: {
                    type: "text_delta",
                    delta: '{"status":"completed"',
                  },
                }),
              );

              const executeTypescript = options.customTools.find(
                (tool: { name: string }) => tool.name === "execute_typescript",
              );
              const toolResult = await executeTypescript.execute(
                "tool-call-task-agent",
                {
                  typescriptCode: [
                    'await api.repo.writeFile({ path: "task-root-output.txt", text: "task-root-ok" });',
                    "return {",
                    '  status: "completed",',
                    '  summary: "Wrote task-root-output.txt",',
                    '  filesChanged: ["task-root-output.txt"],',
                    "  validationRan: [],",
                    "  unresolvedIssues: [],",
                    "};",
                  ].join("\n"),
                },
                undefined,
                undefined,
              );
              subscribers.forEach((callback) =>
                callback({
                  type: "tool_execution_update",
                  toolCallId: "tool-call-task-agent",
                  toolName: "execute_typescript",
                  args: {},
                  partialResult: toolResult.details,
                }),
              );

              const assistant = createAssistantMessage(
                JSON.stringify((toolResult.details as any).result),
              );
              stateMessages.push(assistant);
              subscribers.forEach((callback) =>
                callback({
                  type: "turn_end",
                  message: assistant,
                  toolResults: [],
                }),
              );
            },
          },
          getActiveToolNames: () => ["execute_typescript"],
          subscribe(callback: (event: Record<string, unknown>) => void) {
            subscribers.add(callback);
            return () => {
              subscribers.delete(callback);
            };
          },
          async abort() {},
          dispose() {},
        },
      } as any;
    });

    const agent = createWorkflowTaskAgent({
      workspaceRoot: fixture.workspaceRoot,
      agentDir: fixture.agentDir,
      artifactDir: fixture.artifactDir,
      store: fixture.store,
      profile: createDefaultWorkflowTaskAgentProfile(),
    });

    const stdoutChunks: string[] = [];
    const stepMessages: any[][] = [];
    const result = (await runWithToolContext(
      {
        db: {} as never,
        runId: fixture.smithersRunId,
        nodeId: "task",
        iteration: 0,
        attempt: 1,
        rootDir: fixture.taskRoot,
        allowNetwork: false,
        maxOutputBytes: 8192,
        timeoutMs: 30_000,
        seq: 0,
      },
      async () =>
        await agent.generate({
          prompt: "Write the task-root file.",
          onStdout: (chunk: string) => stdoutChunks.push(chunk),
          onEvent: (event: Record<string, unknown>) => {
            if (event.type !== "started" || typeof event.resume !== "string") {
              return;
            }
            insertSmithersAttemptByResume({
              workspaceRoot: fixture.workspaceRoot,
              runId: fixture.smithersRunId,
              nodeId: "task",
              iteration: 0,
              attempt: 1,
              rootDir: fixture.taskRoot,
              agentResume: event.resume,
            });
          },
          onStepFinish: (step: { response: { messages: any[] } }) => {
            stepMessages.push(step.response.messages);
          },
        }),
    )) as any;

    const [createAgentSessionOptions] = createAgentSessionSpy.mock.calls[0] ?? [];
    expect(createAgentSessionOptions?.cwd).toBe(fixture.taskRoot);
    expect(readFileSync(join(fixture.taskRoot, "task-root-output.txt"), "utf8")).toBe("task-root-ok");
    expect(() => readFileSync(join(fixture.workspaceRoot, "task-root-output.txt"), "utf8")).toThrow();

    const snapshot = fixture.store.getSessionState("session-workflow-task-agent");
    expect(snapshot.workflowTaskAttempts).toHaveLength(1);
    expect(snapshot.workflowTaskAttempts[0]).toMatchObject({
      workflowRunId: fixture.workflowRunId,
      smithersRunId: fixture.smithersRunId,
      nodeId: "task",
      iteration: 0,
      attempt: 1,
      status: "running",
      smithersState: "in-progress",
    });
    expect(
      snapshot.commands.some(
        (command) =>
          command.workflowTaskAttemptId === snapshot.workflowTaskAttempts[0]?.id &&
          command.toolName === "execute_typescript",
      ),
    ).toBe(true);
    expect(result.usage).toMatchObject({
      inputTokens: 12,
      outputTokens: 34,
      totalTokens: 46,
      inputTokenDetails: {
        cacheReadTokens: 5,
      },
    });
    expect(stdoutChunks[0]).toContain('{"status":"completed"');
    expect(stepMessages.length).toBeGreaterThan(0);

    createAgentSessionSpy.mockRestore();
  });

  it("does not load workspace extensions into the workflow task agent", async () => {
    const fixture = createFixture();
    mkdirSync(join(fixture.taskRoot, ".pi", "extensions"), { recursive: true });
    writeFileSync(
      join(fixture.taskRoot, ".pi", "extensions", "leak.ts"),
      [
        'import { Type } from "@sinclair/typebox";',
        "export default function (pi) {",
        '  pi.registerTool({ name: "leak_tool", label: "Leak Tool", description: "bad", parameters: Type.Object({}), async execute() { return { content: [{ type: "text", text: "bad" }], details: {} }; } });',
        "}",
      ].join("\n"),
    );

    const createAgentSessionSpy = spyOn(PiCodingAgent, "createAgentSession");
    let discoveredExtensionCount = -1;
    createAgentSessionSpy.mockImplementation(async (options: any) => {
      discoveredExtensionCount = options.resourceLoader.getExtensions().extensions.length;
      const stateMessages: any[] = [];
      return {
        session: {
          agent: {
            state: {
              messages: stateMessages,
            },
            prompt: async (messages: any[]) => {
              stateMessages.push(...messages, createAssistantMessage('{"ok":true}'));
            },
          },
          getActiveToolNames: () => ["execute_typescript"],
          subscribe() {
            return () => {};
          },
          async abort() {},
          dispose() {},
        },
      } as any;
    });

    const agent = createWorkflowTaskAgent({
      workspaceRoot: fixture.workspaceRoot,
      agentDir: fixture.agentDir,
      artifactDir: fixture.artifactDir,
      store: fixture.store,
      profile: createDefaultWorkflowTaskAgentProfile(),
    });

    await runWithToolContext(
      {
        db: {} as never,
        runId: fixture.smithersRunId,
        nodeId: "task",
        iteration: 0,
        attempt: 1,
        rootDir: fixture.taskRoot,
        allowNetwork: false,
        maxOutputBytes: 8192,
        timeoutMs: 30_000,
        seq: 0,
      },
      async () => await agent.generate({ prompt: "Hello" }),
    );

    expect(discoveredExtensionCount).toBe(0);
    createAgentSessionSpy.mockRestore();
  });

  it("resolves non-path resume handles through SessionManager.list and opens the matched session", async () => {
    const fixture = createFixture();
    const createAgentSessionSpy = spyOn(PiCodingAgent, "createAgentSession");
    const listSpy = spyOn(PiCodingAgent.SessionManager, "list");
    const openSpy = spyOn(PiCodingAgent.SessionManager, "open");
    const createSpy = spyOn(PiCodingAgent.SessionManager, "create");

    listSpy.mockImplementation(async () => [
      {
        id: "resume-prefix-1234",
        path: join(fixture.root, "task-session.jsonl"),
        cwd: fixture.taskRoot,
        modifiedAt: Date.now(),
        title: "Task Session",
      },
    ] as any);
    openSpy.mockImplementation(() => PiCodingAgent.SessionManager.inMemory(fixture.taskRoot));
    createSpy.mockImplementation(() => PiCodingAgent.SessionManager.inMemory(fixture.taskRoot));
    createAgentSessionSpy.mockImplementation(async () => {
      const stateMessages: any[] = [];
      return {
        session: {
          agent: {
            state: {
              messages: stateMessages,
            },
            prompt: async (messages: any[]) => {
              stateMessages.push(...messages, createAssistantMessage('{"ok":true}'));
            },
          },
          getActiveToolNames: () => ["execute_typescript"],
          subscribe() {
            return () => {};
          },
          async abort() {},
          dispose() {},
        },
      } as any;
    });

    const agent = createWorkflowTaskAgent({
      workspaceRoot: fixture.workspaceRoot,
      agentDir: fixture.agentDir,
      artifactDir: fixture.artifactDir,
      store: fixture.store,
      profile: createDefaultWorkflowTaskAgentProfile(),
    });

    await runWithToolContext(
      {
        db: {} as never,
        runId: fixture.smithersRunId,
        nodeId: "task",
        iteration: 0,
        attempt: 1,
        rootDir: fixture.taskRoot,
        allowNetwork: false,
        maxOutputBytes: 8192,
        timeoutMs: 30_000,
        seq: 0,
      },
      async () => await agent.generate({ prompt: "Hello", resumeSession: "resume-prefix" }),
    );

    expect(listSpy).toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();

    createAgentSessionSpy.mockRestore();
    listSpy.mockRestore();
    openSpy.mockRestore();
    createSpy.mockRestore();
  });

  it("treats message snapshots as authoritative and preserves structured response messages", async () => {
    const fixture = createFixture();
    const createAgentSessionSpy = spyOn(PiCodingAgent, "createAgentSession");
    const openSpy = spyOn(PiCodingAgent.SessionManager, "open");

    let receivedMessages: any[] = [];
    createAgentSessionSpy.mockImplementation(async () => {
      const subscribers = new Set<(event: Record<string, unknown>) => void>();
      const stateMessages: any[] = [];
      return {
        session: {
          agent: {
            state: {
              messages: stateMessages,
            },
            prompt: async (messages: any[]) => {
              receivedMessages = messages;
              stateMessages.push(...messages);
              const toolResult = {
                role: "toolResult" as const,
                toolCallId: "tool-1",
                toolName: "execute_typescript",
                content: [{ type: "text" as const, text: '{"ok":true}' }],
                isError: false,
                timestamp: Date.now(),
              };
              const assistant = createAssistantMessage("Structured response");
              stateMessages.push(toolResult, assistant);
              subscribers.forEach((callback) =>
                callback({
                  type: "turn_end",
                  message: assistant,
                  toolResults: [toolResult],
                }),
              );
            },
          },
          getActiveToolNames: () => ["execute_typescript"],
          subscribe(callback: (event: Record<string, unknown>) => void) {
            subscribers.add(callback);
            return () => {
              subscribers.delete(callback);
            };
          },
          async abort() {},
          dispose() {},
        },
      } as any;
    });
    openSpy.mockImplementation(() => PiCodingAgent.SessionManager.inMemory(fixture.taskRoot));

    const agent = createWorkflowTaskAgent({
      workspaceRoot: fixture.workspaceRoot,
      agentDir: fixture.agentDir,
      artifactDir: fixture.artifactDir,
      store: fixture.store,
      profile: createDefaultWorkflowTaskAgentProfile(),
    });

    const result = (await runWithToolContext(
      {
        db: {} as never,
        runId: fixture.smithersRunId,
        nodeId: "task",
        iteration: 0,
        attempt: 1,
        rootDir: fixture.taskRoot,
        allowNetwork: false,
        maxOutputBytes: 8192,
        timeoutMs: 30_000,
        seq: 0,
      },
      async () =>
        await agent.generate({
          resumeSession: "/tmp/previous-task-session.jsonl",
          messages: [
            {
              role: "user",
              content: "First prompt",
              timestamp: 1,
            } as any,
            {
              role: "assistant",
              content: [{ type: "text", text: "First answer" }],
              timestamp: 2,
            } as any,
            {
              role: "user",
              content: "Fix the schema",
              timestamp: 3,
            } as any,
            ],
          }),
    )) as any;

    expect(openSpy).not.toHaveBeenCalled();
    expect(receivedMessages).toHaveLength(3);
    expect(receivedMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(result.response.messages.map((message: any) => message.role)).toEqual([
      "toolResult",
      "assistant",
    ]);

    createAgentSessionSpy.mockRestore();
    openSpy.mockRestore();
  });

  it("enforces timeout and aborts the session", async () => {
    const fixture = createFixture();
    const createAgentSessionSpy = spyOn(PiCodingAgent, "createAgentSession");
    let abortCalled = false;
    let rejectPrompt!: (error: Error) => void;

    createAgentSessionSpy.mockImplementation(async () => {
      const stateMessages: any[] = [];
      return {
        session: {
          agent: {
            state: {
              messages: stateMessages,
            },
            prompt: async (messages: any[]) => {
              stateMessages.push(...messages);
              await new Promise<void>((_, reject) => {
                rejectPrompt = reject as (error: Error) => void;
              });
            },
          },
          getActiveToolNames: () => ["execute_typescript"],
          subscribe() {
            return () => {};
          },
          async abort() {
            abortCalled = true;
            rejectPrompt(new Error("aborted"));
          },
          dispose() {},
        },
      } as any;
    });

    const agent = createWorkflowTaskAgent({
      workspaceRoot: fixture.workspaceRoot,
      agentDir: fixture.agentDir,
      artifactDir: fixture.artifactDir,
      store: fixture.store,
      profile: createDefaultWorkflowTaskAgentProfile(),
    });

    await expect(
      runWithToolContext(
        {
          db: {} as never,
          runId: fixture.smithersRunId,
          nodeId: "task",
          iteration: 0,
          attempt: 1,
          rootDir: fixture.taskRoot,
          allowNetwork: false,
          maxOutputBytes: 8192,
          timeoutMs: 30_000,
          seq: 0,
        },
        async () =>
          await agent.generate({
            prompt: "This will time out",
            timeout: { totalMs: 10 },
          }),
      ),
    ).rejects.toThrow("Workflow task agent timed out");
    expect(abortCalled).toBe(true);

    createAgentSessionSpy.mockRestore();
  });
});
