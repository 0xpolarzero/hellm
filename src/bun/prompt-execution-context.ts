import type { StructuredEpisodeKind } from "./structured-session-state";

export interface PromptExecutionContext {
  sessionId: string;
  turnId: string;
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
  rootThreadId: string;
  promptText: string;
  rootEpisodeKind?: StructuredEpisodeKind;
}): PromptExecutionContext {
  return {
    sessionId: input.sessionId,
    turnId: input.turnId,
    rootThreadId: input.rootThreadId,
    promptText: input.promptText,
    rootEpisodeKind: input.rootEpisodeKind ?? "change",
    sessionWaitApplied: false,
  };
}
