import type { StructuredEpisodeKind } from "./structured-session-state";
import type { GeneratedAgentContextExternalSource } from "../shared/generated-agent-context";

export type PromptExecutionSurfaceKind = "orchestrator" | "handler";

export interface PromptExecutionContext {
  sessionId: string;
  turnId: string;
  surfacePiSessionId: string;
  surfaceThreadId: string | null;
  surfaceKind: PromptExecutionSurfaceKind;
  defaultEpisodeKind: StructuredEpisodeKind;
  rootThreadId: string | null;
  promptText: string;
  rootEpisodeKind: StructuredEpisodeKind;
  sessionWaitApplied: boolean;
  threadWasTerminalAtStart: boolean;
  loadedExtensionIds?: string[];
  availableExtensionIds?: string[];
  externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
  systemPrompt?: string;
  generatedAgentContextFingerprint?: string;
  suppressPendingWorkflowAttentionDelivery?: boolean;
  queuedMessageId?: string | null;
}

export interface PromptExecutionRuntimeHandle {
  current: PromptExecutionContext | null;
}

export function createPromptExecutionContext(input: {
  sessionId: string;
  turnId: string;
  surfacePiSessionId: string;
  surfaceThreadId?: string | null;
  surfaceKind?: PromptExecutionSurfaceKind;
  defaultEpisodeKind?: StructuredEpisodeKind;
  rootThreadId?: string | null;
  promptText: string;
  rootEpisodeKind?: StructuredEpisodeKind;
  threadWasTerminalAtStart?: boolean;
  loadedExtensionIds?: readonly string[];
  availableExtensionIds?: readonly string[];
  externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
  systemPrompt?: string;
  generatedAgentContextFingerprint?: string;
  suppressPendingWorkflowAttentionDelivery?: boolean;
  queuedMessageId?: string | null;
}): PromptExecutionContext {
  const surfaceKind = input.surfaceKind ?? "orchestrator";
  const surfaceThreadId = input.surfaceThreadId ?? input.rootThreadId ?? null;
  if (surfaceKind === "handler" && !surfaceThreadId) {
    throw new Error("Handler prompt execution context requires a thread id.");
  }

  const defaultEpisodeKind = input.defaultEpisodeKind ?? input.rootEpisodeKind ?? "change";

  return {
    sessionId: input.sessionId,
    turnId: input.turnId,
    surfacePiSessionId: input.surfacePiSessionId,
    surfaceThreadId,
    surfaceKind,
    defaultEpisodeKind,
    rootThreadId: input.rootThreadId ?? surfaceThreadId,
    promptText: input.promptText,
    rootEpisodeKind: defaultEpisodeKind,
    sessionWaitApplied: false,
    threadWasTerminalAtStart: input.threadWasTerminalAtStart ?? false,
    loadedExtensionIds: [...(input.loadedExtensionIds ?? [])],
    availableExtensionIds: [...(input.availableExtensionIds ?? [])],
    externalInstructionSources: structuredClone(input.externalInstructionSources ?? []),
    systemPrompt: input.systemPrompt,
    generatedAgentContextFingerprint: input.generatedAgentContextFingerprint,
    suppressPendingWorkflowAttentionDelivery:
      input.suppressPendingWorkflowAttentionDelivery ?? false,
    queuedMessageId: input.queuedMessageId ?? null,
  };
}
