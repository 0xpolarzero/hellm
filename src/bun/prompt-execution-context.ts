import type { StructuredEpisodeKind } from "./structured-session-state";

export type PromptExecutionSurfaceKind = "orchestrator" | "handler";

export interface PromptExecutionContext {
  sessionId: string;
  turnId: string;
  surfacePiSessionId?: string;
  surfaceThreadId?: string;
  surfaceKind?: PromptExecutionSurfaceKind;
  defaultEpisodeKind?: StructuredEpisodeKind;
  rootThreadId: string;
  promptText: string;
  rootEpisodeKind: StructuredEpisodeKind;
  sessionWaitApplied: boolean;
}

export interface PromptExecutionRuntimeHandle {
  current: PromptExecutionContext | null;
}

export function createPromptExecutionContext(input: {
  sessionId: string;
  turnId: string;
  surfacePiSessionId?: string;
  surfaceThreadId?: string;
  surfaceKind?: PromptExecutionSurfaceKind;
  defaultEpisodeKind?: StructuredEpisodeKind;
  rootThreadId?: string;
  promptText: string;
  rootEpisodeKind?: StructuredEpisodeKind;
}): PromptExecutionContext {
  const surfaceThreadId = input.surfaceThreadId ?? input.rootThreadId;
  if (!surfaceThreadId) {
    throw new Error("Prompt execution context requires a surfaceThreadId or rootThreadId.");
  }

  const defaultEpisodeKind = input.defaultEpisodeKind ?? input.rootEpisodeKind ?? "change";

  return {
    sessionId: input.sessionId,
    turnId: input.turnId,
    surfacePiSessionId: input.surfacePiSessionId ?? input.sessionId,
    surfaceThreadId,
    surfaceKind: input.surfaceKind ?? "orchestrator",
    defaultEpisodeKind,
    rootThreadId: surfaceThreadId,
    promptText: input.promptText,
    rootEpisodeKind: defaultEpisodeKind,
    sessionWaitApplied: false,
  };
}
