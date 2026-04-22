import type { StructuredEpisodeKind } from "./structured-session-state";

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
  durableSurfaceContext?: string;
  suppressPendingWorkflowAttentionDelivery?: boolean;
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
  durableSurfaceContext?: string;
  suppressPendingWorkflowAttentionDelivery?: boolean;
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
    durableSurfaceContext: input.durableSurfaceContext,
    suppressPendingWorkflowAttentionDelivery:
      input.suppressPendingWorkflowAttentionDelivery ?? false,
  };
}
