import type {
  PromptExecutionContext,
  PromptExecutionEpisodeKind,
  PromptExecutionExternalInstructionSource,
  PromptExecutionSurfaceKind,
} from "@svvy/core";

export interface PromptExecutionRuntimeHandle {
  current: PromptExecutionContext | null;
}

type PromptExecutionExternalInstructionSourceInput = PromptExecutionExternalInstructionSource & {
  readonly content?: string;
};

export function createPromptExecutionContext(input: {
  workspaceSessionId: PromptExecutionContext["workspaceSessionId"];
  turnId: PromptExecutionContext["turnId"];
  workflowTaskAttemptId?: string | null;
  workflowRunId?: string | null;
  surfacePiSessionId: PromptExecutionContext["surfacePiSessionId"];
  threadId?: PromptExecutionContext["threadId"];
  surfaceKind?: PromptExecutionSurfaceKind;
  defaultEpisodeKind?: PromptExecutionEpisodeKind;
  rootThreadId?: PromptExecutionContext["rootThreadId"];
  rootEpisodeKind?: PromptExecutionEpisodeKind;
  threadWasTerminalAtStart?: boolean;
  loadedExtensionIds?: PromptExecutionContext["loadedExtensionIds"];
  availableExtensionIds?: PromptExecutionContext["availableExtensionIds"];
  externalInstructionSources?: readonly PromptExecutionExternalInstructionSourceInput[];
  generatedAgentContextFingerprint: PromptExecutionContext["generatedAgentContextFingerprint"];
  generatedAgentContextRevision: PromptExecutionContext["generatedAgentContextRevision"];
  suppressPendingWorkflowAttentionDelivery?: boolean;
  queueItemId?: PromptExecutionContext["queueItemId"];
}): PromptExecutionContext {
  const surfaceKind = input.surfaceKind ?? "orchestrator";
  const threadId = input.threadId ?? input.rootThreadId ?? null;
  if (surfaceKind === "handler" && !threadId) {
    throw new Error("Handler prompt execution context requires a thread id.");
  }
  if (surfaceKind === "workflow-task" && !input.workflowTaskAttemptId) {
    throw new Error("Workflow task prompt execution context requires an attempt id.");
  }

  const defaultEpisodeKind = input.defaultEpisodeKind ?? input.rootEpisodeKind ?? "change";

  return {
    workspaceSessionId: input.workspaceSessionId,
    turnId: input.turnId,
    workflowTaskAttemptId: input.workflowTaskAttemptId ?? null,
    workflowRunId: input.workflowRunId ?? null,
    surfacePiSessionId: input.surfacePiSessionId,
    threadId,
    surfaceKind,
    defaultEpisodeKind,
    rootThreadId: input.rootThreadId ?? threadId,
    rootEpisodeKind: defaultEpisodeKind,
    sessionWaitApplied: false,
    threadWasTerminalAtStart: input.threadWasTerminalAtStart ?? false,
    loadedExtensionIds: [...(input.loadedExtensionIds ?? [])],
    availableExtensionIds: [...(input.availableExtensionIds ?? [])],
    externalInstructionSources: (input.externalInstructionSources ?? []).map(
      toPromptExecutionExternalInstructionSource,
    ),
    generatedAgentContextFingerprint: input.generatedAgentContextFingerprint,
    generatedAgentContextRevision: input.generatedAgentContextRevision,
    suppressPendingWorkflowAttentionDelivery:
      input.suppressPendingWorkflowAttentionDelivery ?? false,
    queueItemId: input.queueItemId ?? null,
  };
}

function toPromptExecutionExternalInstructionSource(
  source: PromptExecutionExternalInstructionSourceInput,
): PromptExecutionExternalInstructionSource {
  return {
    id: source.id,
    kind: source.kind,
    title: source.title,
    path: source.path,
    contentHash: source.contentHash,
    order: source.order,
    enabled: source.enabled,
    actors: [...source.actors],
    sourceGroup: source.sourceGroup,
    ...(source.rootId === undefined ? {} : { rootId: source.rootId }),
    ...(source.rootLabel === undefined ? {} : { rootLabel: source.rootLabel }),
    readStatus: {
      status: source.readStatus.status,
      ...(source.readStatus.error === undefined ? {} : { error: source.readStatus.error }),
    },
  };
}
