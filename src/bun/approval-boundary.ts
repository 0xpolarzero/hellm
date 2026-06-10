import type { ApprovalMode } from "../shared/agent-settings";

export type RuntimeApprovalBoundaryToolName = "apply_patch" | "exec_command" | "execute_typescript";

export type RuntimeApprovalBoundaryInput = {
  approvalMode: Exclude<ApprovalMode, "full-access">;
  command?: string;
  commandFamily?: string;
  commandId?: string;
  context?: unknown;
  cwd: string;
  patch?: string;
  snippetArtifactId?: string;
  toolCallId: string;
  toolName: RuntimeApprovalBoundaryToolName;
  typescriptCode?: string;
};

export type RuntimeApprovalBoundary = (
  input: RuntimeApprovalBoundaryInput,
) =>
  | { approved: true }
  | { approved: false; reason?: string }
  | Promise<{ approved: true } | { approved: false; reason?: string }>;
