declare module "@smithers-orchestrator/cli/chat" {
  export type ChatAttemptLike = {
    nodeId: string;
    iteration?: number | null;
    attempt: number;
    metaJson?: string | null;
    responseText?: string | null;
    state?: string;
    startedAtMs?: number;
    finishedAtMs?: number | null;
    cached?: unknown;
  };

  export type ParsedNodeOutputEvent = {
    seq?: number;
    timestampMs?: number;
    nodeId?: string;
    iteration?: number;
    attempt?: number;
    stream?: "stdout" | "stderr";
    text?: string;
  };

  export function parseChatAttemptMeta(metaJson?: string | null): Record<string, unknown>;
  export function chatAttemptKey(attempt: {
    nodeId: string;
    iteration?: number | null;
    attempt: number;
  }): string;
  export function parseNodeOutputEvent(event: unknown): ParsedNodeOutputEvent | null;
  export function selectChatAttempts<T extends ChatAttemptLike>(
    attempts: T[],
    outputAttemptKeys: ReadonlySet<string>,
    includeAll: boolean,
  ): T[];
}

declare module "@smithers-orchestrator/cli/why-diagnosis" {
  export function diagnoseRunEffect(
    db: unknown,
    runId: string,
  ): import("effect").Effect.Effect<unknown, unknown, never>;
}
