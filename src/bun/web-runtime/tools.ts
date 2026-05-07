import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { PromptExecutionRuntimeHandle } from "../prompt-execution-context";
import type {
  StructuredArtifactKind,
  StructuredSessionStateStore,
} from "../structured-session-state";
import type { WebProvider, WebProviderErrorCategory, WebToolName } from "./contracts";
import { providerNotReadyResult } from "./contracts";
import { textResult } from "./providers/shared";

export function createWebTools(options: {
  cwd: string;
  runtime: PromptExecutionRuntimeHandle;
  provider: WebProvider;
  store: {
    createArtifact:
      | StructuredSessionStateStore["createArtifact"]
      | ((input: {
          sessionId?: string | null;
          threadId?: string | null;
          workflowRunId?: string | null;
          workflowTaskAttemptId?: string | null;
          sourceCommandId?: string | null;
          kind: StructuredArtifactKind;
          name?: string;
          path?: string;
          content?: string;
        }) => { id: string; path?: string });
  };
}): AgentTool<any>[] {
  const ready = options.provider.checkReady();
  if (!ready.ready) return [];
  const contracts = options.provider.getToolContracts();
  return [
    {
      name: "web.search",
      label: "web.search",
      description: contracts.search.description,
      parameters: contracts.search.inputSchema,
      execute: async (toolCallId, input, signal) =>
        invokeProviderTool(options, "web.search", toolCallId, input, signal),
    },
    {
      name: "web.fetch",
      label: "web.fetch",
      description: contracts.fetch.description,
      parameters: contracts.fetch.inputSchema,
      execute: async (toolCallId, input, signal) =>
        invokeProviderTool(options, "web.fetch", toolCallId, input, signal),
    },
  ];
}

export function createUnavailableWebToolInvoker(provider: WebProvider) {
  return (toolName: WebToolName) => {
    const ready = provider.checkReady();
    if (ready.ready) throw new Error(`${toolName} is available; use the registered direct tool.`);
    return providerNotReadyResult(ready, toolName);
  };
}

async function invokeProviderTool(
  options: Parameters<typeof createWebTools>[0],
  toolName: WebToolName,
  toolCallId: string,
  input: unknown,
  signal?: AbortSignal,
) {
  const runtime = options.runtime.current;
  const sourceCommandId = readStructuredCommandId(toolCallId);
  try {
    return await options.provider.invoke(toolName, input, {
      cwd: options.cwd,
      commandId: sourceCommandId,
      signal,
      createArtifact(artifact) {
        return options.store.createArtifact({
          sessionId: runtime?.sessionId ?? null,
          threadId: runtime?.surfaceThreadId ?? runtime?.rootThreadId ?? null,
          workflowRunId: null,
          workflowTaskAttemptId: null,
          sourceCommandId,
          kind: artifact.kind,
          name: artifact.name,
          content: artifact.content,
        });
      },
    });
  } catch (error) {
    const category = isProviderError(error) ? error.category : "provider_unavailable";
    const message = error instanceof Error ? error.message : `${toolName} failed.`;
    return textResult(message, {
      providerId: options.provider.id,
      toolName,
      status: "failed",
      error: { category, message },
      commandFacts: {
        providerId: options.provider.id,
        toolName,
        status: "failed",
        errorCategory: category,
      },
    });
  }
}

function readStructuredCommandId(toolCallId: string): string {
  return toolCallId.startsWith("structured-command:")
    ? toolCallId.slice("structured-command:".length)
    : toolCallId;
}

function isProviderError(error: unknown): error is Error & { category: WebProviderErrorCategory } {
  return Boolean(error && typeof error === "object" && "category" in error);
}
