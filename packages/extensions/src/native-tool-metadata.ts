import type { ActorKind, RuntimeTurnDecision } from "@svvy/core";

export type NativeToolCommandVisibility = "trace" | "summary" | "surface";

export type NativeToolStreamingArgumentPolicy = "record" | "skip";

export type NativeToolExecutionCommandPolicy = "generic-command" | "self-recorded-command";

export type NativeToolActorKind = ActorKind;

export type NativeToolActorAvailability = "loaded" | "available" | "unavailable";

export type NativeToolActorAvailabilityMap = Readonly<
  Partial<Record<NativeToolActorKind, NativeToolActorAvailability>>
>;

export type NativeToolTurnDecision = RuntimeTurnDecision;

export interface NativeToolCommandMetadata {
  readonly toolName: string;
  readonly extensionIds: readonly string[];
  readonly actorAvailability: NativeToolActorAvailabilityMap;
  readonly visibility: NativeToolCommandVisibility;
  readonly streamingArguments: NativeToolStreamingArgumentPolicy;
  readonly executionCommand: NativeToolExecutionCommandPolicy;
  readonly turnDecision: NativeToolTurnDecision | null;
}

const genericCommandMetadata = {
  visibility: "summary",
  streamingArguments: "record",
  executionCommand: "generic-command",
  turnDecision: null,
} as const;

const allActorsLoaded = {
  orchestrator: "loaded",
  handler: "loaded",
  "workflow-task": "loaded",
} as const satisfies NativeToolActorAvailabilityMap;

const orchestratorAndHandlerLoaded = {
  orchestrator: "loaded",
  handler: "loaded",
  "workflow-task": "unavailable",
} as const satisfies NativeToolActorAvailabilityMap;

const orchestratorOnlyLoaded = {
  orchestrator: "loaded",
  handler: "unavailable",
  "workflow-task": "unavailable",
} as const satisfies NativeToolActorAvailabilityMap;

const handlerOnlyLoaded = {
  orchestrator: "unavailable",
  handler: "loaded",
  "workflow-task": "unavailable",
} as const satisfies NativeToolActorAvailabilityMap;

const nativeToolMetadataRecords = [
  nativeTool("shell", "exec_command", {
    actorAvailability: allActorsLoaded,
    turnDecision: "exec_command",
  }),
  nativeTool("shell", "write_stdin", {
    actorAvailability: allActorsLoaded,
    turnDecision: "write_stdin",
  }),
  nativeTool("apply-patch", "apply_patch", {
    actorAvailability: allActorsLoaded,
    turnDecision: "apply_patch",
  }),
  selfRecordingTool("execute-typescript", "execute_typescript", {
    actorAvailability: allActorsLoaded,
    turnDecision: "execute_typescript",
  }),
  selfRecordingTool("extension-loading", "list_extensions", {
    actorAvailability: allActorsLoaded,
    turnDecision: "list_extensions",
  }),
  selfRecordingTool("extension-loading", "load_extension", {
    actorAvailability: allActorsLoaded,
    turnDecision: "load_extension",
  }),
  selfRecordingTool("request-user-input", "request_user_input", {
    actorAvailability: orchestratorAndHandlerLoaded,
    turnDecision: "request_user_input",
  }),
  selfRecordingTool("thread-orchestration", "thread_start", {
    actorAvailability: orchestratorOnlyLoaded,
    turnDecision: "thread_start",
  }),
  selfRecordingTool("thread-orchestration", "thread_followup", {
    actorAvailability: orchestratorOnlyLoaded,
    turnDecision: "thread_followup",
  }),
  selfRecordingTool("thread-orchestration", "thread_request_report", {
    actorAvailability: orchestratorOnlyLoaded,
    turnDecision: "thread_request_report",
  }),
  selfRecordingTool("thread-orchestration", "thread_list", {
    actorAvailability: orchestratorOnlyLoaded,
    turnDecision: "thread_list",
  }),
  selfRecordingTool("thread-orchestration", "thread_episodes", {
    actorAvailability: orchestratorOnlyLoaded,
    turnDecision: "thread_episodes",
  }),
  selfRecordingTool("thread-handling", "thread_current", {
    actorAvailability: handlerOnlyLoaded,
    turnDecision: "thread_current",
  }),
  selfRecordingTool("thread-handling", "thread_group", {
    actorAvailability: handlerOnlyLoaded,
    turnDecision: "thread_group",
  }),
  selfRecordingTool("thread-handling", "thread_episodes", {
    actorAvailability: handlerOnlyLoaded,
    turnDecision: "thread_episodes",
  }),
  selfRecordingTool("thread-handling", "thread_report", {
    actorAvailability: handlerOnlyLoaded,
    turnDecision: "thread_report",
  }),
];

const nativeToolMetadataByToolName = new Map<string, NativeToolCommandMetadata>();

for (const metadata of nativeToolMetadataRecords) {
  const existing = nativeToolMetadataByToolName.get(metadata.toolName);
  if (!existing) {
    nativeToolMetadataByToolName.set(metadata.toolName, metadata);
    continue;
  }
  nativeToolMetadataByToolName.set(metadata.toolName, {
    ...existing,
    extensionIds: [...new Set([...existing.extensionIds, ...metadata.extensionIds])].toSorted(),
    actorAvailability: mergeActorAvailability(
      existing.actorAvailability,
      metadata.actorAvailability,
    ),
  });
}

export const nativeToolCommandMetadata = [...nativeToolMetadataByToolName.values()];

export function getNativeToolCommandMetadata(toolName: string): NativeToolCommandMetadata | null {
  return nativeToolMetadataByToolName.get(toolName) ?? null;
}

function nativeTool(
  extensionId: string,
  toolName: string,
  options: {
    readonly actorAvailability: NativeToolActorAvailabilityMap;
    readonly turnDecision?: NativeToolTurnDecision;
  },
): NativeToolCommandMetadata {
  return {
    toolName,
    extensionIds: [extensionId],
    actorAvailability: options.actorAvailability,
    visibility: genericCommandMetadata.visibility,
    streamingArguments: genericCommandMetadata.streamingArguments,
    executionCommand: genericCommandMetadata.executionCommand,
    turnDecision: options.turnDecision ?? null,
  };
}

function selfRecordingTool(
  extensionId: string,
  toolName: string,
  options: {
    readonly actorAvailability: NativeToolActorAvailabilityMap;
    readonly turnDecision?: NativeToolTurnDecision;
  },
): NativeToolCommandMetadata {
  return {
    toolName,
    extensionIds: [extensionId],
    actorAvailability: options.actorAvailability,
    visibility: "surface",
    streamingArguments: "skip",
    executionCommand: "self-recorded-command",
    turnDecision: options.turnDecision ?? null,
  };
}

function mergeActorAvailability(
  left: NativeToolActorAvailabilityMap,
  right: NativeToolActorAvailabilityMap,
): NativeToolActorAvailabilityMap {
  const merged: Partial<Record<NativeToolActorKind, NativeToolActorAvailability>> = {};
  for (const actorKind of ["orchestrator", "handler", "workflow-task"] as const) {
    const availability = mostAvailable(left[actorKind], right[actorKind]);
    if (availability) {
      merged[actorKind] = availability;
    }
  }
  return merged;
}

function mostAvailable(
  left: NativeToolActorAvailability | undefined,
  right: NativeToolActorAvailability | undefined,
): NativeToolActorAvailability | undefined {
  const rank = { unavailable: 0, available: 1, loaded: 2 } as const;
  if (!left) return right;
  if (!right) return left;
  return rank[left] >= rank[right] ? left : right;
}
