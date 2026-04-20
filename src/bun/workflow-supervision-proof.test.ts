import { afterEach, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ToolCall } from "@mariozechner/pi-ai";
import { WaitForEvent, createSmithers } from "smithers-orchestrator";
import { z } from "zod";
import { buildSessionTranscriptExport } from "../mainview/session-transcript";
import type { PromptTarget } from "../mainview/chat-rpc";
import { WorkspaceSessionCatalog, getSvvySessionDir, type SessionDefaults } from "./session-catalog";
import type { BundledWorkflowDefinition } from "./smithers-runtime/registry";
import {
  bundledWorkflowRuntimeStoredInputSchema,
  readBundledWorkflowLaunchInput,
} from "./smithers-runtime/runtime-input";
import type {
  StructuredSessionSnapshot,
  StructuredSessionStateStore,
} from "./structured-session-state";

setDefaultTimeout(90_000);

const tempDirs: string[] = [];
const envSnapshots = new Map<string, string | undefined>();

const TEST_DEFAULTS: SessionDefaults = {
  provider: "zai",
  model: "glm-5-turbo",
  thinkingLevel: "medium",
  systemPrompt: "You are svvy.",
};

afterEach(() => {
  for (const [key, value] of envSnapshots) {
    if (typeof value === "string") {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
  envSnapshots.clear();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

type ChatCompletionRequest = {
  model: string;
  messages: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
};

type ToolCallRecord = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

type ToolResultRecord = {
  toolCallId: string;
  toolName: string | null;
  text: string;
  parsed: Record<string, unknown> | null;
};

type AutonomousProofStub = {
  baseUrl: string;
  requests: ChatCompletionRequest[];
  stop(): void;
};

type StructuredCommandLike = {
  toolName: string;
};

it("lets an autonomous handler discover smithers supervision tools and turn them into useful workflow evidence", async () => {
  const stub = startAutonomousWorkflowSupervisionProofStub();
  setEnv("ZAI_API_KEY", "stub-key");

  const { cwd, agentDir, sessionDir } = createWorkspaceFixture();
  writeFileSync(
    join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          zai: {
            baseUrl: stub.baseUrl,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(cwd, "investigation-brief.md"),
    [
      "Signal diagnosis should identify the missing deploy.completed signal.",
      "Transcript inspection should surface what the workflow task agent actually did.",
      "Frames and DevTools should provide durable graph evidence for troubleshooting.",
    ].join("\n"),
  );

  const catalog = new WorkspaceSessionCatalog(cwd, agentDir, sessionDir);
  getSmithersRuntimeManager(catalog).upsertBundledWorkflow(
    createSignalWorkflowDefinition(join(cwd, ".svvy", "smithers-runtime", "smithers.db")),
  );

  try {
    const created = await catalog.createSession({ title: "Workflow Supervision Proof" }, TEST_DEFAULTS);

    await catalog.sendPrompt({
      ...TEST_DEFAULTS,
      target: createOrchestratorTarget(created.session.id),
      messages: [
        createUserMessage(
          "Open a handler thread dedicated to proving the smithers workflow supervision surface end to end. Do not supervise workflows from the orchestrator.",
        ),
      ],
      onEvent: () => {},
    });

    await waitFor(() => getStructuredSessionState(catalog, created.session.id).threads.length >= 2);
    const thread =
      getStructuredSessionState(catalog, created.session.id).threads.find(
        (entry) => entry.parentThreadId !== null,
      ) ?? null;
    await waitFor(() => !isPromptStreaming(catalog), 10_000);
    expect(thread).toBeTruthy();
    if (!thread) {
      throw new Error("Expected one handler thread.");
    }

    const handlerTarget = createThreadTarget(
      created.session.id,
      thread.surfacePiSessionId,
      thread.id,
    );
    await catalog.sendPrompt({
      ...TEST_DEFAULTS,
      target: handlerTarget,
      messages: [
        createUserMessage(
          [
            "Discover the available smithers.* tools on your own.",
            "Use them to run a real signal workflow that requires diagnosis.",
            "Then run a real transcript-producing workflow and inspect it with transcript, node, artifact, frame, and DevTools tools.",
            "Hand back a concise report with concrete evidence.",
          ].join(" "),
        ),
      ],
      onEvent: () => {},
    });

    await waitFor(
      () => {
        const snapshot = getStructuredSessionState(catalog, created.session.id);
        const currentThread = snapshot.threads.find((entry) => entry.id === thread.id);
        return currentThread?.status === "completed" && snapshot.episodes.length > 0;
      },
      60_000,
      () => {
        const snapshot = getStructuredSessionState(catalog, created.session.id);
        return JSON.stringify(
          {
            thread: snapshot.threads.find((entry) => entry.id === thread.id) ?? null,
            episodes: snapshot.episodes.map((episode) => ({
              title: episode.title,
              summary: episode.summary,
            })),
            commands: snapshot.commands.map((command) => ({
              toolName: command.toolName,
              status: command.status,
              summary: command.summary,
              error: command.error,
            })),
            lastRequests: stub.requests.slice(-4).map((request) => ({
              latestUserText: getLatestUserText(request.messages),
              tools: availableToolNames(request),
            })),
          },
          null,
          2,
        );
      },
    );

    const snapshot = getStructuredSessionState(catalog, created.session.id);
    const handoffCommand = snapshot.commands.find((command) => command.toolName === "thread.handoff");
    if (!handoffCommand) {
      throw new Error(
        JSON.stringify(
          {
            threads: snapshot.threads.map((entry) => ({
              id: entry.id,
              title: entry.title,
              status: entry.status,
              wait: entry.wait,
            })),
            episodes: snapshot.episodes.map((episode) => ({
              title: episode.title,
              summary: episode.summary,
              sourceCommandId: episode.sourceCommandId,
            })),
            commands: snapshot.commands.map((command) => ({
              toolName: command.toolName,
              status: command.status,
              summary: command.summary,
              error: command.error,
            })),
          },
          null,
          2,
        ),
      );
    }
    const handoff =
      snapshot.episodes.find((episode) => episode.sourceCommandId === handoffCommand?.id) ?? null;
    expect(handoff).toBeTruthy();
    if (!handoff) {
      throw new Error("Expected a durable handoff episode.");
    }
    expect(handoff.summary).toContain("Diagnosed the signal wait");
    expect(handoff.body).toContain("deploy.completed");
    expect(handoff.body).toContain("workflow-proof.txt");
    expect(handoff.body).toContain("DevTools");

    const proofFile = join(cwd, "workflow-proof.txt");
    expect(existsSync(proofFile)).toBe(true);
    const proofText = readFileSync(proofFile, "utf8");
    expect(proofText).toContain("deploy.completed");
    expect(proofText).toContain("workflow task agent");
    expect(proofText).toContain("Frames and DevTools");

    await waitFor(() => !isPromptStreaming(catalog), 10_000);
    const handlerState = await catalog.openSurface(handlerTarget);
    const handlerTranscript = buildSessionTranscriptExport({
      session: handlerState.session,
      provider: handlerState.provider,
      model: handlerState.model,
      reasoningEffort: handlerState.reasoningEffort,
      systemPrompt: handlerState.resolvedSystemPrompt,
      messages: handlerState.messages,
    });

    expect(handlerTranscript).toContain("smithers.list_workflows");
    expect(handlerTranscript).toContain("smithers.run_workflow.wait_for_signal");
    expect(handlerTranscript).toContain("smithers.explain_run");
    expect(handlerTranscript).toContain("smithers.watch_run");
    expect(handlerTranscript).toContain("smithers.signals.send");
    expect(handlerTranscript).toContain("smithers.run_workflow.execute_typescript_task");
    expect(handlerTranscript).toContain("smithers.get_chat_transcript");
    expect(handlerTranscript).toContain("smithers.get_node_detail");
    expect(handlerTranscript).toContain("smithers.list_artifacts");
    expect(handlerTranscript).toContain("smithers.frames.list");
    expect(handlerTranscript).toContain("smithers.getDevToolsSnapshot");
    expect(handlerTranscript).toContain("smithers.streamDevTools");
    expect(handlerTranscript).toContain("thread.handoff");
    expect(handlerTranscript).toContain("deploy.completed");
    expect(handlerTranscript).toContain("workflow-proof.txt");

    const handlerToolCalls = collectAssistantToolCallNames(handlerState.messages);
    expect(handlerToolCalls).toEqual(
      expect.arrayContaining([
        "smithers.list_workflows",
        "smithers.run_workflow.wait_for_signal",
        "smithers.explain_run",
        "smithers.watch_run",
        "smithers.signals.send",
        "smithers.run_workflow.execute_typescript_task",
        "smithers.get_chat_transcript",
        "smithers.get_node_detail",
        "smithers.list_artifacts",
        "smithers.frames.list",
        "smithers.getDevToolsSnapshot",
        "smithers.streamDevTools",
        "thread.handoff",
      ]),
    );

    const explainRunResult = findToolResultMessage(handlerState.messages, "smithers.explain_run");
    expect(explainRunResult?.details).toMatchObject({
      diagnosis: {
        status: "waiting-event",
      },
    });
    expect(JSON.stringify(explainRunResult?.details)).toContain("deploy.completed");

    const chatTranscriptResult = findToolResultMessage(
      handlerState.messages,
      "smithers.get_chat_transcript",
    );
    expect(chatTranscriptResult).toBeTruthy();
    const chatTranscriptDetails = chatTranscriptResult?.details as
      | { attempts?: unknown[]; messages?: unknown[] }
      | undefined;
    expect(chatTranscriptDetails?.attempts?.length ?? 0).toBe(1);
    expect(chatTranscriptDetails?.messages?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(handlerTranscript).toContain("Complete the following repository task inside svvy.");

    const nodeDetailResult = findToolResultMessage(handlerState.messages, "smithers.get_node_detail");
    expect(nodeDetailResult).toBeTruthy();
    const nodeDetail = nodeDetailResult?.details as
      | { node?: { nodeId?: string }; attempts?: unknown[] }
      | undefined;
    expect(nodeDetail?.node?.nodeId).toBe("task");
    expect(nodeDetail?.attempts?.length ?? 0).toBeGreaterThan(0);

    const artifactResult = findToolResultMessage(handlerState.messages, "smithers.list_artifacts");
    expect(artifactResult).toBeTruthy();
    const artifacts = artifactResult?.details as { outputs?: unknown[] } | undefined;
    expect(artifacts?.outputs?.length ?? 0).toBeGreaterThan(0);

    const frameResult = findToolResultMessage(handlerState.messages, "smithers.frames.list");
    expect(frameResult).toBeTruthy();
    const frames = frameResult?.details as { frames?: unknown[] } | undefined;
    expect(frames?.frames?.length ?? 0).toBeGreaterThan(0);

    const devToolsSnapshotResult = findToolResultMessage(
      handlerState.messages,
      "smithers.getDevToolsSnapshot",
    );
    expect(devToolsSnapshotResult).toBeTruthy();
    const devToolsSnapshot = devToolsSnapshotResult?.details as
      | {
          frameNo?: number;
          root?: { name?: string };
          runState?: { state?: string };
        }
      | undefined;
    expect(devToolsSnapshot?.frameNo ?? 0).toBeGreaterThan(0);
    expect(devToolsSnapshot?.root?.name).toBe("svvy-execute-typescript-task");
    expect(devToolsSnapshot?.runState?.state).toBe("succeeded");

    const devToolsStreamResult = findToolResultMessage(
      handlerState.messages,
      "smithers.streamDevTools",
    );
    expect(devToolsStreamResult).toBeTruthy();
    const devToolsStream = devToolsStreamResult?.details as
      | { events?: unknown[]; lastSeq?: number | null }
      | undefined;
    expect(devToolsStream?.events?.length ?? 0).toBeGreaterThan(0);
    expect(devToolsStream?.lastSeq ?? 0).toBeGreaterThan(0);

    const commandNames = snapshot.commands.map((command: StructuredCommandLike) => command.toolName);
    expect(commandNames).toEqual(
      expect.arrayContaining([
        "thread.start",
        "smithers.list_workflows",
        "smithers.run_workflow.wait_for_signal",
        "smithers.explain_run",
        "smithers.watch_run",
        "smithers.signals.send",
        "smithers.run_workflow.execute_typescript_task",
        "smithers.get_chat_transcript",
        "smithers.get_node_detail",
        "smithers.list_artifacts",
        "smithers.frames.list",
        "smithers.getDevToolsSnapshot",
        "smithers.streamDevTools",
        "thread.handoff",
      ]),
    );

    const orchestratorRequest = stub.requests.find(
      (request) =>
        hasAvailableTool(request, "thread.start") &&
        !availableToolNames(request).some((name) => name.startsWith("smithers.")),
    );
    expect(orchestratorRequest).toBeTruthy();
    expect(availableToolNames(orchestratorRequest)).toContain("thread.start");
    expect(availableToolNames(orchestratorRequest)).not.toContain(
      "smithers.run_workflow.wait_for_signal",
    );

    const handlerRequest = stub.requests.find(
      (request) =>
        hasAvailableTool(request, "smithers.list_workflows") &&
        getLatestUserText(request.messages).includes("Discover the available smithers.* tools"),
    );
    expect(handlerRequest).toBeTruthy();
    expect(availableToolNames(handlerRequest)).toEqual(
      expect.arrayContaining([
        "smithers.list_workflows",
        "smithers.watch_run",
        "smithers.explain_run",
        "smithers.signals.send",
        "smithers.get_chat_transcript",
        "smithers.frames.list",
        "smithers.getDevToolsSnapshot",
        "smithers.streamDevTools",
      ]),
    );
  } finally {
    await waitFor(() => !isPromptStreaming(catalog), 10_000).catch(() => {});
    await catalog.dispose();
    stub.stop();
  }
});

function createWorkspaceFixture() {
  const root = mkdtempSync(join(tmpdir(), "svvy-workflow-proof-"));
  tempDirs.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const sessionDir = getSvvySessionDir(cwd, agentDir);
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  return { cwd, agentDir, sessionDir };
}

function setEnv(key: string, value: string) {
  if (!envSnapshots.has(key)) {
    envSnapshots.set(key, process.env[key]);
  }
  process.env[key] = value;
}

function createUserMessage(text: string) {
  return {
    role: "user" as const,
    timestamp: Date.now(),
    content: [{ type: "text" as const, text }],
  };
}

function createOrchestratorTarget(workspaceSessionId: string): PromptTarget {
  return {
    workspaceSessionId,
    surface: "orchestrator",
    surfacePiSessionId: workspaceSessionId,
  };
}

function createThreadTarget(
  workspaceSessionId: string,
  surfacePiSessionId: string,
  threadId: string,
): PromptTarget {
  return {
    workspaceSessionId,
    surface: "thread",
    surfacePiSessionId,
    threadId,
  };
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 10_000,
  debugState?: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await Bun.sleep(25);
  }

  throw new Error(
    debugState
      ? `Timed out waiting for the workflow supervision proof.\n${debugState()}`
      : "Timed out waiting for the workflow supervision proof.",
  );
}

function getStructuredSessionState(
  catalog: WorkspaceSessionCatalog,
  sessionId: string,
): StructuredSessionSnapshot {
  const store = (catalog as unknown as { structuredSessionStore: StructuredSessionStateStore })
    .structuredSessionStore;
  return store.getSessionState(sessionId);
}

function getSmithersRuntimeManager(catalog: WorkspaceSessionCatalog) {
  return (catalog as unknown as {
    smithersRuntimeManager: {
      upsertBundledWorkflow(definition: BundledWorkflowDefinition): void;
    };
  }).smithersRuntimeManager;
}

function isPromptStreaming(catalog: WorkspaceSessionCatalog): boolean {
  return Boolean(
    (catalog as unknown as {
      activeSession?: {
        activePrompt?: boolean;
      } | null;
    }).activeSession?.activePrompt,
  );
}

function createSignalWorkflowDefinition(dbPath: string): BundledWorkflowDefinition {
  const launchSchema = z.object({
    signalName: z.string().min(1).default("deploy.completed"),
  });
  const signalPayloadSchema = z.object({
    environment: z.string(),
    sha: z.string(),
    status: z.enum(["success", "failure"]),
  });
  const resultSchema = z.object({
    summary: z.string(),
    environment: z.string(),
    status: z.enum(["success", "failure"]),
  });
  const smithersApi = createSmithers(
    {
      input: bundledWorkflowRuntimeStoredInputSchema,
      signalPayload: signalPayloadSchema,
      signalResult: resultSchema,
    },
    { dbPath },
  );

  return {
    id: "wait_for_signal",
    label: "Wait For Signal",
    description: "Waits on a durable Smithers signal and records the delivered payload.",
    workflowName: "svvy-wait-for-signal",
    launchSchema,
    workflow: smithersApi.smithers((ctx) => {
      const workflowInput = readBundledWorkflowLaunchInput(launchSchema, ctx.input);
      const payload = latestEntry<z.infer<typeof signalPayloadSchema>>(ctx.outputs.signalPayload);
      return React.createElement(
        smithersApi.Workflow,
        { name: "svvy-wait-for-signal" },
        React.createElement(
          smithersApi.Sequence,
          null,
          React.createElement(WaitForEvent, {
            id: "wait-signal",
            event: workflowInput.signalName,
            output: smithersApi.outputs.signalPayload,
            outputSchema: signalPayloadSchema,
            label: `wait:${workflowInput.signalName}`,
          }),
          payload
            ? React.createElement(smithersApi.Task, {
                id: "result",
                output: smithersApi.outputs.signalResult,
                children: {
                  summary: `Received ${workflowInput.signalName} for ${payload.environment}.`,
                  environment: payload.environment,
                  status: payload.status,
                },
              })
            : null,
        ),
      );
    }),
  };
}

function latestEntry<T>(entries: T[] | undefined): T | null {
  return entries && entries.length > 0 ? (entries[entries.length - 1] ?? null) : null;
}

function collectAssistantToolCallNames(messages: AgentMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      return [];
    }

    return message.content
      .filter((block): block is ToolCall => block.type === "toolCall")
      .map((block) => block.name);
  });
}

function findToolResultMessage(messages: AgentMessage[], toolName: string) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as {
      role?: string;
      toolName?: string;
      details?: Record<string, unknown>;
    };
    if (message.role === "toolResult" && message.toolName === toolName) {
      return message;
    }
  }
  return null;
}

function startAutonomousWorkflowSupervisionProofStub(): AutonomousProofStub {
  const requests: ChatCompletionRequest[] = [];
  let responseCounter = 0;
  let toolCallCounter = 0;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
        return new Response("Not found", { status: 404 });
      }

      const payload = (await request.json()) as ChatCompletionRequest;
      requests.push(payload);

      const responseId = `chatcmpl-workflow-supervision-proof-${++responseCounter}`;

      try {
        const toolNames = availableToolNames(payload);
        const toolCalls = collectToolCalls(payload.messages);
        const toolResults = collectToolResults(payload.messages, toolCalls);
        const latestUserText = getLatestUserText(payload.messages);

        if (latestUserText.includes("System event: A handler thread emitted a durable handoff.")) {
          return createTextResponse({
            responseId,
            model: payload.model,
            text: "The workflow supervision proof completed and the handler thread already handed back the evidence.",
          });
        }

        if (
          latestUserText.includes(
            "System event: A supervised Smithers workflow now requires handler attention.",
          )
        ) {
          return createTextResponse({
            responseId,
            model: payload.model,
            text: "Workflow attention received. I will inspect the durable Smithers state before acting.",
          });
        }

        if (toolNames.includes("thread.start") && !toolNames.some((name) => name.startsWith("smithers."))) {
          if (!hasToolCall(toolCalls, "thread.start")) {
            return createToolCallResponse({
              responseId,
              model: payload.model,
              toolCallId: `call-${++toolCallCounter}`,
              toolName: "thread.start",
              args: {
                title: "Workflow Supervision Proof Thread",
                objective:
                  "Discover the smithers.* supervision surface, run a waiting signal workflow and a transcript-producing workflow, inspect them, and hand back evidence.",
              },
            });
          }

          return createTextResponse({
            responseId,
            model: payload.model,
            text: "Opened Workflow Supervision Proof Thread so the handler can discover and exercise the smithers supervision surface directly.",
          });
        }

        if (toolNames.some((name) => name.startsWith("smithers."))) {
          return respondAsAutonomousHandler({
            payload,
            responseId,
            toolCalls,
            toolResults,
            toolCallCounter: () => `call-${++toolCallCounter}`,
          });
        }

        if (toolNames.includes("execute_typescript")) {
          return respondAsAutonomousWorkflowTask({
            payload,
            responseId,
            toolCalls,
            toolResults,
            toolCallCounter: () => `call-${++toolCallCounter}`,
          });
        }

        throw new Error(`Unhandled supervision proof request: ${latestUserText}`);
      } catch (error) {
        return new Response(String(error instanceof Error ? error.message : error), {
          status: 500,
        });
      }
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}/api/coding/paas/v4`,
    requests,
    stop() {
      server.stop(true);
    },
  };
}

function respondAsAutonomousHandler(input: {
  payload: ChatCompletionRequest;
  responseId: string;
  toolCalls: ToolCallRecord[];
  toolResults: ToolResultRecord[];
  toolCallCounter: () => string;
}): Response {
  const toolNames = availableToolNames(input.payload);
  const runSignalToolName = toolNames.find((name) => name === "smithers.run_workflow.wait_for_signal");
  const runTaskToolName = toolNames.find(
    (name) => name === "smithers.run_workflow.execute_typescript_task",
  );
  if (!runSignalToolName || !runTaskToolName) {
    throw new Error("Expected wait_for_signal and execute_typescript_task launch tools.");
  }

  if (!hasToolCall(input.toolCalls, "smithers.list_workflows")) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "smithers.list_workflows",
      args: {},
    });
  }

  const signalLaunchCalls = toolCallsByName(input.toolCalls, runSignalToolName);
  const signalRunId = readStringProperty(
    findToolResultByCallId(input.toolResults, signalLaunchCalls[0]?.id)?.parsed,
    "runId",
  );

  if (signalLaunchCalls.length === 0) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: runSignalToolName,
      args: {
        signalName: "deploy.completed",
      },
    });
  }

  if (!signalRunId) {
    throw new Error("Expected wait_for_signal launch result to include runId.");
  }

  const signalWatchResults = watchRunResultsFor(input.toolCalls, input.toolResults, signalRunId);
  const waitingSignalWatch = signalWatchResults.find(
    (result) => readStringProperty(result.parsed?.finalRun as Record<string, unknown> | null, "status") === "waiting-event",
  );
  const terminalSignalWatch = signalWatchResults.find(
    (result) => readBooleanProperty(result.parsed, "reachedTerminal") === true,
  );

  if (!waitingSignalWatch) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "smithers.watch_run",
      args: {
        runId: signalRunId,
        timeoutMs: 1_500,
      },
    });
  }

  if (!hasToolCall(input.toolCalls, "smithers.explain_run")) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "smithers.explain_run",
      args: {
        runId: signalRunId,
      },
    });
  }

  if (!hasToolCall(input.toolCalls, "smithers.signals.send")) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "smithers.signals.send",
      args: {
        runId: signalRunId,
        signalName: "deploy.completed",
        data: {
          environment: "production",
          sha: "abc123",
          status: "success",
        },
      },
    });
  }

  if (signalLaunchCalls.length < 2) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: runSignalToolName,
      args: {
        signalName: "deploy.completed",
        resumeRunId: signalRunId,
      },
    });
  }

  if (!terminalSignalWatch) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "smithers.watch_run",
      args: {
        runId: signalRunId,
        timeoutMs: 10_000,
      },
    });
  }

  if (!hasRunEventsFor(input.toolCalls, signalRunId)) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "smithers.get_run_events",
      args: {
        runId: signalRunId,
        types: ["RunFinished"],
      },
    });
  }

  const taskLaunchCalls = toolCallsByName(input.toolCalls, runTaskToolName);
  const taskRunId = readStringProperty(
    findToolResultByCallId(input.toolResults, taskLaunchCalls[0]?.id)?.parsed,
    "runId",
  );

  if (taskLaunchCalls.length === 0) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: runTaskToolName,
      args: {
        objective:
          "Read investigation-brief.md, write workflow-proof.txt with the extracted facts, and report the result as structured JSON.",
        successCriteria: [
          "Create workflow-proof.txt in the workspace.",
          "Include the investigation brief facts in the generated file.",
        ],
        validationCommands: ["cat workflow-proof.txt"],
      },
    });
  }

  if (!taskRunId) {
    throw new Error("Expected execute_typescript_task launch result to include runId.");
  }

  if (!hasWatchRunFor(input.toolCalls, taskRunId)) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "smithers.watch_run",
      args: {
        runId: taskRunId,
        timeoutMs: 20_000,
      },
    });
  }

  if (!hasToolCall(input.toolCalls, "smithers.get_chat_transcript")) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "smithers.get_chat_transcript",
      args: {
        runId: taskRunId,
        all: true,
      },
    });
  }

  if (!hasNodeDetailFor(input.toolCalls, taskRunId, "task")) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "smithers.get_node_detail",
      args: {
        runId: taskRunId,
        nodeId: "task",
      },
    });
  }

  if (!hasArtifactListFor(input.toolCalls, taskRunId)) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "smithers.list_artifacts",
      args: {
        runId: taskRunId,
        limit: 20,
      },
    });
  }

  if (!hasFramesListFor(input.toolCalls, taskRunId)) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "smithers.frames.list",
      args: {
        runId: taskRunId,
        limit: 20,
      },
    });
  }

  if (!hasToolCall(input.toolCalls, "smithers.getDevToolsSnapshot")) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "smithers.getDevToolsSnapshot",
      args: {
        runId: taskRunId,
      },
    });
  }

  if (!hasToolCall(input.toolCalls, "smithers.streamDevTools")) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "smithers.streamDevTools",
      args: {
        runId: taskRunId,
        fromSeq: 0,
        timeoutMs: 150,
        maxEvents: 10,
      },
    });
  }

  if (!hasToolCall(input.toolCalls, "thread.handoff")) {
    const signalDiagnosis = findLatestToolResult(input.toolResults, "smithers.explain_run")?.parsed;
    const taskTranscript = findLatestToolResult(input.toolResults, "smithers.get_chat_transcript")?.parsed;
    const nodeDetail = findLatestToolResult(input.toolResults, "smithers.get_node_detail")?.parsed;
    const frames = findLatestToolResult(input.toolResults, "smithers.frames.list")?.parsed;
    const devToolsSnapshot = findLatestToolResult(
      input.toolResults,
      "smithers.getDevToolsSnapshot",
    )?.parsed;
    const signalDiagnosisRecord = signalDiagnosis ?? null;
    const signalDiagnosisDetails =
      signalDiagnosisRecord && typeof signalDiagnosisRecord["diagnosis"] === "object"
        ? (signalDiagnosisRecord["diagnosis"] as Record<string, unknown>)
        : null;
    const transcriptMessages = Array.isArray(taskTranscript?.messages)
      ? taskTranscript.messages
      : [];
    const latestAssistantTranscript = transcriptMessages.findLast?.(
      (message) => message && typeof message === "object" && message.role === "assistant",
    ) as { text?: string } | undefined;
    const blockerSignalName = Array.isArray(signalDiagnosisDetails?.["blockers"])
      ? readStringProperty(
          signalDiagnosisDetails["blockers"][0] as Record<string, unknown>,
          "signalName",
        )
      : null;
    const frameCount = Array.isArray(frames?.frames) ? frames.frames.length : 0;
    const devToolsFrameNo =
      typeof devToolsSnapshot?.frameNo === "number" ? String(devToolsSnapshot.frameNo) : "unknown";
    const taskToolCallCount = Array.isArray(nodeDetail?.toolCalls) ? nodeDetail.toolCalls.length : 0;

    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "thread.handoff",
      args: {
        kind: "workflow",
        title: "workflow supervision proof completed",
        summary:
          "Diagnosed the signal wait, delivered the signal, then inspected the task workflow transcript and graph.",
        body: [
          `smithers.explain_run diagnosed a waiting-event blocker on signal \`${blockerSignalName ?? "unknown"}\`.`,
          "smithers.signals.send delivered the signal and the resumed wait_for_signal run finished.",
          `smithers.get_chat_transcript captured the task agent reply: ${latestAssistantTranscript?.text ?? "missing transcript reply"}`,
          `smithers.get_node_detail reported ${taskToolCallCount} workflow-task tool call(s), including execute_typescript.`,
          `smithers.frames.list returned ${frameCount} frame(s) and smithers.getDevToolsSnapshot returned frame ${devToolsFrameNo}.`,
          "The task workflow wrote workflow-proof.txt with evidence copied from investigation-brief.md.",
        ].join("\n\n"),
      },
    });
  }

  return createTextResponse({
    responseId: input.responseId,
    model: input.payload.model,
    text: "Finished the workflow supervision proof and handed the evidence back to the orchestrator.",
  });
}

function respondAsAutonomousWorkflowTask(input: {
  payload: ChatCompletionRequest;
  responseId: string;
  toolCalls: ToolCallRecord[];
  toolResults: ToolResultRecord[];
  toolCallCounter: () => string;
}): Response {
  if (!hasToolCall(input.toolCalls, "execute_typescript")) {
    return createToolCallResponse({
      responseId: input.responseId,
      model: input.payload.model,
      toolCallId: input.toolCallCounter(),
      toolName: "execute_typescript",
      args: {
        typescriptCode: [
          'const brief = await api.repo.readFile({ path: "investigation-brief.md" });',
          "const facts = brief.text.trim().split(/\\r?\\n/).filter(Boolean).slice(0, 3);",
          'const report = ["Workflow proof generated from investigation brief.", ...facts].join("\\n");',
          'await api.repo.writeFile({ path: "workflow-proof.txt", text: report });',
          'await api.exec.run({ command: "cat", args: ["workflow-proof.txt"] });',
          "return {",
          '  summary: "Generated workflow-proof.txt from investigation-brief.md.",',
          '  filesChanged: ["workflow-proof.txt"],',
          '  validationRan: ["cat workflow-proof.txt"],',
          "  unresolvedIssues: [],",
          "};",
        ].join("\n"),
      },
    });
  }

  return createTextResponse({
    responseId: input.responseId,
    model: input.payload.model,
    text: JSON.stringify({
      status: "completed",
      summary: "Generated workflow-proof.txt from investigation-brief.md.",
      filesChanged: ["workflow-proof.txt"],
      validationRan: ["cat workflow-proof.txt"],
      unresolvedIssues: [],
    }),
  });
}

function createToolCallResponse(input: {
  responseId: string;
  model: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}): Response {
  return createSseResponse([
    createChunk({
      responseId: input.responseId,
      model: input.model,
      delta: {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: input.toolCallId,
            type: "function",
            function: {
              name: input.toolName,
              arguments: JSON.stringify(input.args),
            },
          },
        ],
      },
      finishReason: null,
    }),
    createChunk({
      responseId: input.responseId,
      model: input.model,
      delta: {},
      finishReason: "tool_calls",
    }),
  ]);
}

function createTextResponse(input: { responseId: string; model: string; text: string }): Response {
  return createSseResponse([
    createChunk({
      responseId: input.responseId,
      model: input.model,
      delta: {
        role: "assistant",
        content: input.text,
      },
      finishReason: null,
    }),
    createChunk({
      responseId: input.responseId,
      model: input.model,
      delta: {},
      finishReason: "stop",
    }),
  ]);
}

function createChunk(input: {
  responseId: string;
  model: string;
  delta: Record<string, unknown>;
  finishReason: string | null;
}) {
  return {
    id: input.responseId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model: input.model,
    choices: [
      {
        index: 0,
        delta: input.delta,
        finish_reason: input.finishReason,
      },
    ],
  };
}

function createSseResponse(events: unknown[]): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    headers: {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    },
  });
}

function availableToolNames(request: ChatCompletionRequest | undefined): string[] {
  return (request?.tools ?? [])
    .map((tool) => readStringProperty((tool as { function?: Record<string, unknown> }).function, "name"))
    .filter((name): name is string => typeof name === "string");
}

function hasAvailableTool(request: ChatCompletionRequest | undefined, toolName: string): boolean {
  return availableToolNames(request).includes(toolName);
}

function collectToolCalls(messages: Array<Record<string, unknown>>): ToolCallRecord[] {
  const toolCalls: ToolCallRecord[] = [];

  for (const message of messages) {
    if (message?.role !== "assistant" || !Array.isArray(message.tool_calls)) {
      continue;
    }

    for (const toolCall of message.tool_calls) {
      const id = readStringProperty(toolCall as Record<string, unknown>, "id");
      const fn = (toolCall as { function?: Record<string, unknown> }).function ?? null;
      const name = readStringProperty(fn, "name");
      const args = parseJsonRecord(readStringProperty(fn, "arguments")) ?? {};
      if (!id || !name) {
        continue;
      }
      toolCalls.push({ id, name, args });
    }
  }

  return toolCalls;
}

function collectToolResults(
  messages: Array<Record<string, unknown>>,
  toolCalls: ToolCallRecord[],
): ToolResultRecord[] {
  const toolNameById = new Map(toolCalls.map((toolCall) => [toolCall.id, toolCall.name]));
  const results: ToolResultRecord[] = [];

  for (const message of messages) {
    if (message?.role !== "tool") {
      continue;
    }

    const toolCallId = readStringProperty(message, "tool_call_id");
    if (!toolCallId) {
      continue;
    }
    const text = flattenMessageContent(message.content).trim();
    results.push({
      toolCallId,
      toolName: toolNameById.get(toolCallId) ?? null,
      text,
      parsed: parseJsonRecord(text),
    });
  }

  return results;
}

function getLatestUserText(messages: Array<Record<string, unknown>>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }

    const text = flattenMessageContent(message.content).trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function flattenMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
        return (block as { text: string }).text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function parseJsonRecord(input: string | null): Record<string, unknown> | null {
  if (!input) {
    return null;
  }
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readStringProperty(
  value: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function readBooleanProperty(
  value: Record<string, unknown> | null | undefined,
  key: string,
): boolean | null {
  const candidate = value?.[key];
  return typeof candidate === "boolean" ? candidate : null;
}

function hasToolCall(toolCalls: ToolCallRecord[], name: string): boolean {
  return toolCalls.some((toolCall) => toolCall.name === name);
}

function toolCallsByName(toolCalls: ToolCallRecord[], name: string): ToolCallRecord[] {
  return toolCalls.filter((toolCall) => toolCall.name === name);
}

function findToolResultByCallId(
  toolResults: ToolResultRecord[],
  toolCallId: string | undefined,
): ToolResultRecord | undefined {
  return toolCallId ? toolResults.find((result) => result.toolCallId === toolCallId) : undefined;
}

function findLatestToolResult(
  toolResults: ToolResultRecord[],
  toolName: string,
): ToolResultRecord | undefined {
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    if (toolResults[index]?.toolName === toolName) {
      return toolResults[index];
    }
  }
  return undefined;
}

function hasWatchRunFor(toolCalls: ToolCallRecord[], runId: string): boolean {
  return toolCalls.some(
    (toolCall) => toolCall.name === "smithers.watch_run" && toolCall.args.runId === runId,
  );
}

function watchRunResultsFor(
  toolCalls: ToolCallRecord[],
  toolResults: ToolResultRecord[],
  runId: string,
): ToolResultRecord[] {
  return toolCalls
    .filter((toolCall) => toolCall.name === "smithers.watch_run" && toolCall.args.runId === runId)
    .map((toolCall) => findToolResultByCallId(toolResults, toolCall.id))
    .filter((result): result is ToolResultRecord => Boolean(result));
}

function hasRunEventsFor(toolCalls: ToolCallRecord[], runId: string): boolean {
  return toolCalls.some(
    (toolCall) => toolCall.name === "smithers.get_run_events" && toolCall.args.runId === runId,
  );
}

function hasNodeDetailFor(toolCalls: ToolCallRecord[], runId: string, nodeId: string): boolean {
  return toolCalls.some(
    (toolCall) =>
      toolCall.name === "smithers.get_node_detail" &&
      toolCall.args.runId === runId &&
      toolCall.args.nodeId === nodeId,
  );
}

function hasArtifactListFor(toolCalls: ToolCallRecord[], runId: string): boolean {
  return toolCalls.some(
    (toolCall) => toolCall.name === "smithers.list_artifacts" && toolCall.args.runId === runId,
  );
}

function hasFramesListFor(toolCalls: ToolCallRecord[], runId: string): boolean {
  return toolCalls.some(
    (toolCall) => toolCall.name === "smithers.frames.list" && toolCall.args.runId === runId,
  );
}
