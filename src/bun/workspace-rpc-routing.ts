import type { WorkspaceScopedRequest } from "../shared/workspace-contract";
import type {
  WorkspaceRuntime,
  WorkspaceRuntimeOperations,
  WorkspaceRuntimeRegistry,
} from "./workspace-runtime-registry";

export function getWorkspaceRuntimeForRequest(
  registry: Pick<WorkspaceRuntimeRegistry, "getRuntime">,
  input: WorkspaceScopedRequest,
): WorkspaceRuntime {
  return registry.getRuntime(input.workspaceId);
}

export function getWorkspaceRuntimeOperationsForRequest(
  registry: Pick<WorkspaceRuntimeRegistry, "getRuntimeOperations">,
  input: WorkspaceScopedRequest,
): WorkspaceRuntimeOperations {
  return registry.getRuntimeOperations(input.workspaceId);
}

export function stripWorkspaceId<T extends WorkspaceScopedRequest>(
  input: T,
): Omit<T, keyof WorkspaceScopedRequest> {
  const { workspaceId: _workspaceId, ...rest } = input;
  return rest;
}
