import type {
  CommandId,
  ThreadId,
  RuntimeApprovalId,
  RequestInputRequestId,
  StateInvalidationDescriptor,
  StateMutationResult,
  SurfacePiSessionId,
  WorkflowTaskAttemptId,
  WorkspaceId,
  WorkspaceLayoutSlotId,
} from "@svvy/core";

export function mutationResult<T>(
  value: T,
  afterCommit: readonly StateInvalidationDescriptor[] = [],
): StateMutationResult<T> {
  return { value, afterCommit };
}

export function surfaceInvalidation(
  workspaceId: string,
  surfacePiSessionId: string,
): StateInvalidationDescriptor {
  return {
    scope: "workspace",
    workspaceId: workspaceId as WorkspaceId,
    invalidation: { model: "surface", ids: [surfacePiSessionId as SurfacePiSessionId] },
  };
}

export function sessionNavigationInvalidation(workspaceId: string): StateInvalidationDescriptor {
  return {
    scope: "workspace",
    workspaceId: workspaceId as WorkspaceId,
    invalidation: { model: "sessionNavigation" },
  };
}

export function promptHistoryInvalidation(workspaceId: string): StateInvalidationDescriptor {
  return {
    scope: "workspace",
    workspaceId: workspaceId as WorkspaceId,
    invalidation: { model: "promptHistory" },
  };
}

export function workspaceLayoutInvalidation(
  workspaceId: string,
  layoutIds: readonly WorkspaceLayoutSlotId[],
): StateInvalidationDescriptor {
  return {
    scope: "workspace",
    workspaceId: workspaceId as WorkspaceId,
    invalidation: { model: "workspaceLayout", ids: layoutIds },
  };
}

export function agentsInvalidation(): StateInvalidationDescriptor {
  return { scope: "app", invalidation: { model: "agents" } };
}

export function extensionsInvalidation(): StateInvalidationDescriptor {
  return { scope: "app", invalidation: { model: "extensions" } };
}

export function surfaceAndSessionNavigationInvalidations(
  workspaceId: string,
  surfacePiSessionId: string,
): readonly StateInvalidationDescriptor[] {
  return dedupeInvalidations([
    surfaceInvalidation(workspaceId, surfacePiSessionId),
    sessionNavigationInvalidation(workspaceId),
  ]);
}

export function commandInspectorInvalidation(
  workspaceId: string,
  commandId: string,
): StateInvalidationDescriptor {
  return {
    scope: "workspace",
    workspaceId: workspaceId as WorkspaceId,
    invalidation: { model: "commandInspector", ids: [commandId as CommandId] },
  };
}

export function handlerThreadInspectorInvalidation(
  workspaceId: string,
  threadId: string,
): StateInvalidationDescriptor {
  return {
    scope: "workspace",
    workspaceId: workspaceId as WorkspaceId,
    invalidation: { model: "handlerThreadInspector", ids: [threadId as ThreadId] },
  };
}

export function workflowTaskAttemptInspectorInvalidation(
  workspaceId: string,
  workflowTaskAttemptId: string,
): StateInvalidationDescriptor {
  return {
    scope: "workspace",
    workspaceId: workspaceId as WorkspaceId,
    invalidation: {
      model: "workflowTaskAttemptInspector",
      ids: [workflowTaskAttemptId as WorkflowTaskAttemptId],
    },
  };
}

export function requestInputInvalidation(
  workspaceId: string,
  requestId: string,
): StateInvalidationDescriptor {
  return {
    scope: "workspace",
    workspaceId: workspaceId as WorkspaceId,
    invalidation: { model: "requestInput", ids: [requestId as RequestInputRequestId] },
  };
}

export function runtimeApprovalInvalidation(
  workspaceId: string,
  requestId: string,
): StateInvalidationDescriptor {
  return {
    scope: "workspace",
    workspaceId: workspaceId as WorkspaceId,
    invalidation: { model: "runtimeApprovals", ids: [requestId as RuntimeApprovalId] },
  };
}

export function dedupeInvalidations(
  descriptors: readonly StateInvalidationDescriptor[],
): readonly StateInvalidationDescriptor[] {
  const seen = new Set<string>();
  const deduped: StateInvalidationDescriptor[] = [];
  for (const descriptor of descriptors) {
    const key = JSON.stringify(descriptor);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(descriptor);
  }
  return deduped;
}
