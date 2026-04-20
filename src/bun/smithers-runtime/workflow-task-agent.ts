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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
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

type WorkflowTaskAgentOptions = {
  cwd: string;
  agentDir: string;
  artifactDir: string;
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
  abortSignal?: AbortSignal;
  onEvent?: (event: Record<string, unknown>) => void;
  onStepFinish?: (step: {
    response: { messages: Array<{ role: string; content: string }> };
  }) => void;
  onStdout?: (chunk: string) => void;
  outputSchema?: unknown;
};

type LocalCommandRecord = {
  id: string;
  toolName: string;
  title: string;
  summary: string;
  status: string;
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

      const sessionRoot = mkdtempSync(join(tmpdir(), "svvy-workflow-task-agent-"));
      const sessionDir = join(sessionRoot, "sessions");
      const agentDir = join(sessionRoot, "agent");
      mkdirSync(sessionDir, { recursive: true });
      mkdirSync(agentDir, { recursive: true });

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
      const sessionManager = SessionManager.create(options.cwd, sessionDir);
      sessionManager.appendSessionInfo("Workflow Task Agent");
      const resourceLoader = new DefaultResourceLoader({
        cwd: options.cwd,
        agentDir,
        settingsManager,
        systemPromptOverride: () => WORKFLOW_TASK_SYSTEM_PROMPT,
      });
      await resourceLoader.reload();

      const commandStore = createLocalExecuteTypescriptStore({
        artifactDir: options.artifactDir,
      });
      const executeTypescriptTool = createWorkflowTaskExecuteTypescriptTool({
        cwd: options.cwd,
        store: commandStore,
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

      args.onEvent?.({
        type: "started",
        engine: "pi",
        title: "pi workflow task agent",
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
        const promptText = buildWorkflowTaskPrompt(args);
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
        rmSync(sessionRoot, { force: true, recursive: true });
      }
    },
  };
}

function createWorkflowTaskExecuteTypescriptTool(input: {
  cwd: string;
  store: ExecuteTypescriptCommandStore;
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
      const result = await runExecuteTypescript({
        cwd: input.cwd,
        store: input.store,
        signal,
        typescriptCode: params.typescriptCode,
        context: {
          turnId: `workflow-task-turn-${randomUUID()}`,
          threadId: `workflow-task-thread-${randomUUID()}`,
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

function createLocalExecuteTypescriptStore(input: {
  artifactDir: string;
}): ExecuteTypescriptCommandStore {
  let commandCounter = 0;
  let artifactCounter = 0;
  const commands = new Map<string, LocalCommandRecord>();
  mkdirSync(input.artifactDir, { recursive: true });

  return {
    createCommand(config) {
      const id = `workflow-task-command-${++commandCounter}`;
      commands.set(id, {
        id,
        toolName: config.toolName,
        title: config.title,
        summary: config.summary,
        status: "requested",
      });
      return { id };
    },
    startCommand(commandId) {
      const command = commands.get(commandId);
      if (command) {
        command.status = "running";
      }
    },
    finishCommand(config) {
      const command = commands.get(config.commandId);
      if (command) {
        command.status = config.status;
        command.summary = config.summary ?? command.summary;
      }
    },
    createArtifact(config) {
      const id = `workflow-task-artifact-${++artifactCounter}`;
      const resolvedPath =
        config.path ??
        join(input.artifactDir, `${id}-${sanitizeArtifactName(config.name ?? "artifact")}`);
      if (config.content !== undefined) {
        mkdirSync(dirname(resolvedPath), { recursive: true });
        writeFileSync(resolvedPath, config.content);
      }
      return { id, path: resolvedPath };
    },
  };
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

  if (args.outputSchema) {
    parts.push("Return only the requested final JSON object. Do not wrap it in markdown fences.");
  }

  return parts.join("\n\n").trim();
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

function sanitizeArtifactName(name: string): string {
  const normalized = basename(name).replace(/[^\w.-]+/g, "-");
  return normalized || "artifact";
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
