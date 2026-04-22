import { Database } from "bun:sqlite";
import type { AgentMessage, AgentTool, ThinkingLevel } from "@mariozechner/pi-agent-core";
import { getModel, getProviders } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { AgentLike } from "smithers-orchestrator";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveApiKey } from "../auth-store";
import { DEFAULT_CHAT_SETTINGS } from "../../mainview/chat-settings";
import {
  EXECUTE_TYPESCRIPT_TOOL_NAME,
  executeTypescriptParamsSchema,
  runExecuteTypescript,
  type ExecuteTypescriptCommandStore,
  type ExecuteTypescriptResult,
  type ExecuteTypescriptRunCommandInput,
  type ExecuteTypescriptRunCommandResult,
  type ExecuteTypescriptWebFetchResult,
  type ExecuteTypescriptWebSearchResult,
} from "../execute-typescript-tool";
import { WORKFLOW_TASK_SYSTEM_PROMPT } from "../default-system-prompt";
import type {
  StructuredSessionStateStore,
  StructuredWorkflowTaskAttemptRecord,
} from "../structured-session-state";

type WorkflowTaskAgentOptions = {
  cwd: string;
  agentDir: string;
  artifactDir: string;
  store: StructuredSessionStateStore;
  provider?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  runCommand?: (
    input: ExecuteTypescriptRunCommandInput,
  ) => Promise<ExecuteTypescriptRunCommandResult>;
  webSearch?: (input: {
    query: string;
    maxResults?: number;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebSearchResult>;
  fetchText?: (input: {
    url: string;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebFetchResult>;
};

type WorkflowTaskAgentGenerateArgs = {
  prompt?: string;
  messages?: Array<{ role?: string; content?: unknown }>;
  resumeSession?: string;
  lastHeartbeat?: unknown;
  abortSignal?: AbortSignal;
  onEvent?: (event: Record<string, unknown>) => void;
  onStepFinish?: (step: {
    response: { messages: Array<{ role: string; content: string }> };
  }) => void;
  onStdout?: (chunk: string) => void;
  outputSchema?: unknown;
};

type WorkflowTaskAttemptProjectionContext = {
  threadId: string;
  workflowRunId: string;
  workflowTaskAttemptId: string;
};

export function createWorkflowTaskAgent(options: WorkflowTaskAgentOptions): AgentLike {
  return {
    id: "svvy-workflow-task-agent",
    async generate(rawArgs: unknown) {
      const args = normalizeWorkflowTaskAgentGenerateArgs(rawArgs);
      const provider = options.provider ?? DEFAULT_CHAT_SETTINGS.provider;
      const modelId = options.model ?? DEFAULT_CHAT_SETTINGS.model;
      const thinkingLevel = options.thinkingLevel ?? DEFAULT_CHAT_SETTINGS.reasoningEffort;
      const model = getModel(
        provider as Parameters<typeof getModel>[0],
        modelId as Parameters<typeof getModel>[1],
      );
      if (!model) {
        throw new Error(`Workflow task agent model not found: ${provider}/${modelId}`);
      }

      const sessionDir = resolveTaskAgentSessionDir(options.artifactDir);
      const sessionManager = resolveTaskAgentSessionManager({
        cwd: options.cwd,
        sessionDir,
        resumeSession: args.resumeSession,
      });
      const agentDir = options.agentDir;
      mkdirSync(sessionDir, { recursive: true });

      const authStorage = AuthStorage.inMemory();
      syncAuthStorage(authStorage);
      const modelRegistryFactory = ModelRegistry as unknown as {
        create?: (authStorage: AuthStorage, modelPath: string) => ModelRegistry;
        new (authStorage: AuthStorage, modelPath: string): ModelRegistry;
      };
      const modelRegistryPath = join(agentDir, "models.json");
      const modelRegistry =
        typeof modelRegistryFactory.create === "function"
          ? modelRegistryFactory.create(authStorage, modelRegistryPath)
          : new modelRegistryFactory(authStorage, modelRegistryPath);
      const settingsManager = SettingsManager.create(options.cwd, agentDir);
      if (!args.resumeSession) {
        sessionManager.appendSessionInfo("Workflow Task Agent");
      }
      const resourceLoader = new DefaultResourceLoader({
        cwd: options.cwd,
        agentDir,
        settingsManager,
        systemPromptOverride: () => WORKFLOW_TASK_SYSTEM_PROMPT,
      });
      await resourceLoader.reload();

      const sessionIdentity = {
        surfacePiSessionId: sessionManager.getSessionId(),
      };
      const promptText = buildWorkflowTaskPrompt(args);
      const resumeHandleRef: { current: string | null } = {
        current: args.resumeSession ?? null,
      };
      const executeTypescriptTool = createWorkflowTaskExecuteTypescriptTool({
        cwd: options.cwd,
        store: options.store,
        getSurfacePiSessionId: () => sessionIdentity.surfacePiSessionId,
        getResumeHandle: () => resumeHandleRef.current,
        runCommand: options.runCommand,
        webSearch: options.webSearch,
        fetchText: options.fetchText,
      });

      const { session } = await createAgentSession({
        cwd: options.cwd,
        agentDir,
        authStorage,
        modelRegistry,
        sessionManager,
        settingsManager,
        model,
        thinkingLevel,
        tools: [],
        customTools: createCustomToolDefinitions([executeTypescriptTool]),
        resourceLoader,
      });

      const durableSessionManager =
        (session as { sessionManager?: SessionManager }).sessionManager ?? sessionManager;
      sessionIdentity.surfacePiSessionId = durableSessionManager.getSessionId();
      const resumeHandle =
        durableSessionManager.getSessionFile() ?? sessionIdentity.surfacePiSessionId;
      resumeHandleRef.current = resumeHandle;
      args.onEvent?.({
        type: "started",
        engine: "pi",
        title: "pi workflow task agent",
        resume: resumeHandle,
      });

      const unsubscribe = session.subscribe((event) => {
        if (event.type === "tool_execution_start") {
          args.onEvent?.({
            type: "action",
            engine: "pi",
            phase: "started",
            action: {
              id: event.toolCallId,
              kind: "tool",
              title: event.toolName,
            },
          });
          return;
        }

        if (event.type === "tool_execution_end") {
          args.onEvent?.({
            type: "action",
            engine: "pi",
            phase: "completed",
            ok: !event.isError,
            action: {
              id: event.toolCallId,
              kind: "tool",
              title: event.toolName,
            },
          });
        }
      });

      const abortPrompt = () => {
        void session.abort();
      };
      args.abortSignal?.addEventListener("abort", abortPrompt, { once: true });

      try {
        await session.prompt(promptText, { expandPromptTemplates: false });

        const text = getLatestAssistantText(session.agent.state.messages).trim();
        if (text) {
          args.onStdout?.(text);
        }
        const responseMessages = text ? [{ role: "assistant" as const, content: text }] : [];
        if (responseMessages.length > 0) {
          args.onStepFinish?.({
            response: {
              messages: responseMessages,
            },
          });
        }
        args.onEvent?.({
          type: "completed",
          engine: "pi",
          ok: true,
          answer: text,
        });

        return {
          text,
          output: tryParseJson(text),
          response: {
            messages: responseMessages,
          },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Workflow task agent prompt failed.";
        args.onEvent?.({
          type: "completed",
          engine: "pi",
          ok: false,
          error: message,
        });
        throw error;
      } finally {
        unsubscribe();
        args.abortSignal?.removeEventListener("abort", abortPrompt);
        session.dispose();
      }
    },
  };
}

function createWorkflowTaskExecuteTypescriptTool(input: {
  cwd: string;
  store: StructuredSessionStateStore;
  getSurfacePiSessionId: () => string;
  getResumeHandle: () => string | null;
  runCommand?: (
    args: ExecuteTypescriptRunCommandInput,
  ) => Promise<ExecuteTypescriptRunCommandResult>;
  webSearch?: (args: {
    query: string;
    maxResults?: number;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebSearchResult>;
  fetchText?: (args: {
    url: string;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebFetchResult>;
}): AgentTool<typeof executeTypescriptParamsSchema, ExecuteTypescriptResult> {
  return {
    label: "Code Mode",
    name: EXECUTE_TYPESCRIPT_TOOL_NAME,
    description:
      "Run bounded TypeScript against the injected api.* SDK for repository work inside the workflow task agent.",
    parameters: executeTypescriptParamsSchema,
    execute: async (_toolCallId, params, signal) => {
      const projection = await waitForWorkflowTaskAttemptProjection({
        store: input.store,
        cwd: input.cwd,
        surfacePiSessionId: input.getSurfacePiSessionId(),
        agentResume: input.getResumeHandle(),
      });
      const result = await runExecuteTypescript({
        cwd: input.cwd,
        store: createStructuredWorkflowTaskExecuteTypescriptStore({
          store: input.store,
          projectionContext: projection,
        }),
        signal,
        typescriptCode: params.typescriptCode,
        context: {
          surfacePiSessionId: input.getSurfacePiSessionId(),
          turnId: null,
          workflowTaskAttemptId: projection.workflowTaskAttemptId,
          threadId: projection.threadId,
          workflowRunId: projection.workflowRunId,
          executor: "workflow-task-agent",
        },
        runCommand: input.runCommand,
        webSearch: input.webSearch,
        fetchText: input.fetchText,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
        details: result,
      };
    },
  };
}

function createStructuredWorkflowTaskExecuteTypescriptStore(input: {
  store: StructuredSessionStateStore;
  projectionContext: WorkflowTaskAttemptProjectionContext;
}): ExecuteTypescriptCommandStore {
  return {
    createCommand(config) {
      const command = input.store.createCommand({
        turnId: config.turnId ?? null,
        workflowTaskAttemptId:
          config.workflowTaskAttemptId ?? input.projectionContext.workflowTaskAttemptId,
        surfacePiSessionId: config.surfacePiSessionId,
        threadId: config.threadId ?? input.projectionContext.threadId,
        workflowRunId: config.workflowRunId ?? input.projectionContext.workflowRunId,
        parentCommandId: config.parentCommandId,
        toolName: config.toolName,
        executor: config.executor,
        visibility: config.visibility,
        title: config.title,
        summary: config.summary,
        facts: config.facts,
        attempts: config.attempts,
      });
      return { id: command.id };
    },
    startCommand(commandId) {
      input.store.startCommand(commandId);
    },
    finishCommand(config) {
      input.store.finishCommand(config);
    },
    createArtifact(config) {
      const artifact = input.store.createArtifact({
        threadId: config.threadId ?? input.projectionContext.threadId,
        workflowRunId: config.workflowRunId ?? input.projectionContext.workflowRunId,
        workflowTaskAttemptId:
          config.workflowTaskAttemptId ?? input.projectionContext.workflowTaskAttemptId,
        sourceCommandId: config.sourceCommandId,
        kind: config.kind,
        name: config.name,
        path: config.path,
        content: config.content,
      });
      return { id: artifact.id, path: artifact.path };
    },
  };
}

async function waitForWorkflowTaskAttemptProjection(input: {
  store: StructuredSessionStateStore;
  cwd: string;
  surfacePiSessionId: string;
  agentResume: string | null;
  timeoutMs?: number;
}): Promise<WorkflowTaskAttemptProjectionContext> {
  const agentResume = input.agentResume?.trim();
  if (!agentResume) {
    throw new Error("Workflow task agent projection requires an explicit agent resume handle.");
  }

  const deadline = Date.now() + (input.timeoutMs ?? 5_000);
  while (Date.now() <= deadline) {
    const attempt = input.store.findWorkflowTaskAttemptByAgentResume(agentResume);
    if (attempt) {
      return {
        threadId: attempt.threadId,
        workflowRunId: attempt.workflowRunId,
        workflowTaskAttemptId: attempt.id,
      };
    }

    const smithersAttempt = findSmithersAttemptForProjection({
      cwd: input.cwd,
      agentResume,
    });
    const workflowRun = smithersAttempt
      ? input.store.findWorkflowRunBySmithersRunId(smithersAttempt.runId)
      : null;
    if (workflowRun && smithersAttempt) {
      const attemptRecord = input.store.upsertWorkflowTaskAttempt({
        workflowRunId: workflowRun.id,
        smithersRunId: smithersAttempt.runId,
        nodeId: smithersAttempt.nodeId,
        iteration: smithersAttempt.iteration,
        attempt: smithersAttempt.attempt,
        surfacePiSessionId: input.surfacePiSessionId,
        title: readTaskAttemptMetaString(smithersAttempt.metaJson, "label") ?? smithersAttempt.nodeId,
        summary: `Workflow task attempt ${smithersAttempt.nodeId} is running execute_typescript.`,
        kind: "agent",
        status: mapSmithersAttemptStateToStructuredStatus(smithersAttempt.state),
        smithersState: smithersAttempt.state,
        prompt: readTaskAttemptMetaString(smithersAttempt.metaJson, "prompt"),
        responseText: smithersAttempt.responseText ?? null,
        error: readTaskAttemptErrorMessage(smithersAttempt.errorJson),
        cached: Boolean(smithersAttempt.cached),
        jjPointer: smithersAttempt.jjPointer ?? null,
        jjCwd: smithersAttempt.jjCwd ?? null,
        heartbeatAt:
          typeof smithersAttempt.heartbeatAtMs === "number"
            ? new Date(smithersAttempt.heartbeatAtMs).toISOString()
            : null,
        agentId: readTaskAttemptMetaString(smithersAttempt.metaJson, "agentId"),
        agentModel: readTaskAttemptMetaString(smithersAttempt.metaJson, "agentModel"),
        agentEngine:
          readTaskAttemptMetaString(smithersAttempt.metaJson, "agentEngine") ??
          readTaskAttemptMetaString(smithersAttempt.heartbeatDataJson, "agentEngine"),
        agentResume,
        meta:
          parseTaskAttemptMeta(smithersAttempt.metaJson) ??
          parseTaskAttemptMeta(smithersAttempt.heartbeatDataJson),
        startedAt: new Date(smithersAttempt.startedAtMs).toISOString(),
        finishedAt:
          typeof smithersAttempt.finishedAtMs === "number"
            ? new Date(smithersAttempt.finishedAtMs).toISOString()
            : null,
      });
      return {
        threadId: attemptRecord.threadId,
        workflowRunId: attemptRecord.workflowRunId,
        workflowTaskAttemptId: attemptRecord.id,
      };
    }
    await Bun.sleep(25);
  }

  throw new Error("Timed out waiting for workflow task attempt projection.");
}

type SmithersAttemptProjectionRow = {
  runId: string;
  nodeId: string;
  iteration: number;
  attempt: number;
  state: string;
  startedAtMs: number;
  finishedAtMs?: number | null;
  heartbeatAtMs?: number | null;
  heartbeatDataJson?: string | null;
  errorJson?: string | null;
  metaJson?: string | null;
  responseText?: string | null;
  cached?: number | boolean | null;
  jjPointer?: string | null;
  jjCwd?: string | null;
};

function findSmithersAttemptForProjection(input: {
  cwd: string;
  agentResume: string;
}): SmithersAttemptProjectionRow | null {
  const dbPath = join(input.cwd, ".svvy", "smithers-runtime", "smithers.db");
  if (!existsSync(dbPath)) {
    return null;
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .query(
        `SELECT
           run_id AS runId,
           node_id AS nodeId,
           iteration AS iteration,
           attempt AS attempt,
           state AS state,
           started_at_ms AS startedAtMs,
           finished_at_ms AS finishedAtMs,
           heartbeat_at_ms AS heartbeatAtMs,
           heartbeat_data_json AS heartbeatDataJson,
           error_json AS errorJson,
           meta_json AS metaJson,
           response_text AS responseText,
           cached AS cached,
           jj_pointer AS jjPointer,
           jj_cwd AS jjCwd
         FROM _smithers_attempts
         ORDER BY started_at_ms DESC
         LIMIT 200`,
      )
      .all() as SmithersAttemptProjectionRow[];
    return (
      rows.find((row) =>
        readTaskAttemptMetaString(row.metaJson, "agentResume") === input.agentResume ||
        readTaskAttemptMetaString(row.heartbeatDataJson, "agentResume") === input.agentResume,
      ) ??
      null
    );
  } finally {
    db.close();
  }
}

function parseTaskAttemptMeta(metaJson: string | null | undefined): Record<string, unknown> | null {
  if (!metaJson) {
    return null;
  }
  try {
    const parsed = JSON.parse(metaJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readTaskAttemptMetaString(
  metaJson: string | null | undefined,
  key: string,
): string | null {
  const meta = parseTaskAttemptMeta(metaJson);
  return meta && typeof meta[key] === "string" ? (meta[key] as string) : null;
}

function readTaskAttemptErrorMessage(errorJson: string | null | undefined): string | null {
  if (!errorJson) {
    return null;
  }
  try {
    const parsed = JSON.parse(errorJson);
    return parsed && typeof parsed === "object" && typeof parsed.message === "string"
      ? (parsed.message as string)
      : null;
  } catch {
    return null;
  }
}

function mapSmithersAttemptStateToStructuredStatus(
  state: string,
): StructuredWorkflowTaskAttemptRecord["status"] {
  switch (state) {
    case "waiting-timer":
      return "waiting";
    case "finished":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

function resolveTaskAgentSessionDir(artifactDir: string): string {
  return join(resolve(artifactDir, "..", ".."), "task-agent-sessions");
}

function resolveTaskAgentSessionManager(input: {
  cwd: string;
  sessionDir: string;
  resumeSession?: string;
}): SessionManager {
  if (input.resumeSession?.trim() && existsSync(input.resumeSession.trim())) {
    return SessionManager.open(input.resumeSession.trim(), input.sessionDir);
  }
  return SessionManager.create(input.cwd, input.sessionDir);
}

function createCustomToolDefinitions(tools: readonly AgentTool<any>[]): ToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    prepareArguments: tool.prepareArguments,
    execute: async (toolCallId, params, signal, onUpdate) =>
      await tool.execute(toolCallId, params, signal, onUpdate),
  }));
}

function syncAuthStorage(authStorage: AuthStorage): void {
  for (const provider of getProviders()) {
    const apiKey = resolveApiKey(provider);
    if (apiKey) {
      authStorage.setRuntimeApiKey(provider, apiKey);
    } else {
      authStorage.removeRuntimeApiKey(provider);
    }
  }
}

function buildWorkflowTaskPrompt(args: WorkflowTaskAgentGenerateArgs): string {
  const parts: string[] = [];
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (prompt) {
    parts.push(prompt);
  } else if (Array.isArray(args.messages) && args.messages.length > 0) {
    if (args.resumeSession) {
      const latestUserMessage = findLatestUserMessageText(args.messages);
      if (latestUserMessage) {
        parts.push(latestUserMessage);
      }
    } else {
      parts.push(
        args.messages
          .map(
            (message) =>
              `${String(message.role ?? "message").toUpperCase()}: ${messageToText(message)}`,
          )
          .filter((entry) => entry.trim().length > 0)
          .join("\n\n"),
      );
    }
  }

  if (args.outputSchema) {
    parts.push("Return only the requested final JSON object. Do not wrap it in markdown fences.");
  }

  return parts.join("\n\n").trim();
}

function findLatestUserMessageText(
  messages: Array<{ role?: string; content?: unknown }>,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") {
      continue;
    }
    const text = messageToText(message).trim();
    if (text) {
      return text;
    }
  }

  return null;
}

function messageToText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function getLatestAssistantText(messages: AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }
    return messageToText(message);
  }

  return "";
}

function tryParseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function normalizeWorkflowTaskAgentGenerateArgs(value: unknown): WorkflowTaskAgentGenerateArgs {
  if (!isRecord(value)) {
    return {};
  }

  return {
    prompt: typeof value.prompt === "string" ? value.prompt : undefined,
    messages: Array.isArray(value.messages)
      ? value.messages.filter(isRecord).map((message) => ({
          role: typeof message.role === "string" ? message.role : undefined,
          content: message.content,
        }))
      : undefined,
    resumeSession: typeof value.resumeSession === "string" ? value.resumeSession : undefined,
    lastHeartbeat: value.lastHeartbeat,
    abortSignal: isAbortSignal(value.abortSignal) ? value.abortSignal : undefined,
    onEvent:
      typeof value.onEvent === "function"
        ? (value.onEvent as WorkflowTaskAgentGenerateArgs["onEvent"])
        : undefined,
    onStepFinish:
      typeof value.onStepFinish === "function"
        ? (value.onStepFinish as WorkflowTaskAgentGenerateArgs["onStepFinish"])
        : undefined,
    onStdout:
      typeof value.onStdout === "function"
        ? (value.onStdout as WorkflowTaskAgentGenerateArgs["onStdout"])
        : undefined,
    outputSchema: value.outputSchema,
  };
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
