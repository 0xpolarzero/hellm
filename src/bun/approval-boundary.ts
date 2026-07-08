import type { ApprovalMode } from "../shared/agent-settings";
import type {
  CommandId,
  SurfacePiSessionId,
  ThreadId,
  ToolItemId,
  TurnId,
  WorkspaceSessionId,
} from "@svvy/core";

export type RuntimeApprovalBoundaryToolName = "apply_patch" | "exec_command" | "execute_typescript";

export type RuntimeApprovalBoundaryInput = {
  approvalMode: Exclude<ApprovalMode, "full-access">;
  command?: string | null;
  commandFamily?: string | null;
  commandId?: CommandId | null;
  context?: Record<string, unknown>;
  cwd: string;
  patch?: string | null;
  sessionId?: WorkspaceSessionId;
  snippetArtifactId?: string | null;
  surfacePiSessionId?: SurfacePiSessionId;
  threadId?: ThreadId | null;
  toolCallId: ToolItemId;
  toolName: RuntimeApprovalBoundaryToolName;
  turnId?: TurnId | null;
  typescriptCode?: string | null;
};

export type RuntimeApprovalBoundary = (
  input: RuntimeApprovalBoundaryInput,
) =>
  | { approved: true }
  | { approved: false; reason?: string }
  | Promise<{ approved: true } | { approved: false; reason?: string }>;
