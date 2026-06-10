import type {
  StructuredCommandRecord,
  StructuredRuntimeApprovalRequestRecord,
  StructuredSessionStateStore,
} from "./structured-session-state";
import type { RuntimeApprovalBoundary, RuntimeApprovalBoundaryInput } from "./approval-boundary";

type PendingRuntimeApproval = {
  reject: (error: Error) => void;
  resolve: (value: { approved: true } | { approved: false; reason?: string }) => void;
};

export class RuntimeApprovalRequestRuntime {
  private readonly pending = new Map<string, PendingRuntimeApproval>();

  constructor(private readonly store: StructuredSessionStateStore) {}

  createBoundary(): RuntimeApprovalBoundary {
    return (input) => this.requestApproval(input);
  }

  async requestApproval(
    input: RuntimeApprovalBoundaryInput,
  ): Promise<{ approved: true } | { approved: false; reason?: string }> {
    const command = this.findCommand(input) ?? null;
    const sessionId = command?.sessionId ?? readContextString(input.context, "sessionId");
    const surfacePiSessionId =
      command?.surfacePiSessionId ?? readContextString(input.context, "surfacePiSessionId");
    if (!sessionId || !surfacePiSessionId) {
      return { approved: false, reason: "Runtime approval request is missing surface context." };
    }
    const request = this.store.createRuntimeApprovalRequest({
      sessionId,
      surfacePiSessionId,
      threadId: command?.threadId ?? readContextString(input.context, "threadId"),
      turnId: command?.turnId ?? null,
      commandId: input.commandId ?? command?.id ?? null,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      approvalMode: input.approvalMode,
      cwd: input.cwd,
      command: input.command,
      commandFamily: input.commandFamily,
      patch: input.patch,
      snippetArtifactId: input.snippetArtifactId,
      typescriptCode: input.typescriptCode,
    });

    if (input.approvalMode === "auto-review") {
      const decision = reviewRuntimeApprovalRequest(input);
      this.store.resolveRuntimeApprovalRequest({
        requestId: request.requestId,
        status: decision.approved ? "approved" : "denied",
        reviewer: "auto-review",
        decisionReason: decision.reason,
      });
      if (!decision.approved && command) {
        this.store.finishCommand({
          commandId: command.id,
          status: "cancelled",
          summary: `Approval denied: ${approvalRequestSummary(request)}`,
          facts: {
            ...command.facts,
            approval: "denied",
            approvalRequestId: request.requestId,
          },
        });
      }
      return decision.approved ? { approved: true } : { approved: false, reason: decision.reason };
    }

    if (command) {
      this.store.finishCommand({
        commandId: command.id,
        status: "waiting",
        summary: `Waiting for approval: ${approvalRequestSummary(request)}`,
        facts: {
          ...command.facts,
          approval: "pending",
          approvalRequestId: request.requestId,
        },
      });
      try {
        this.store.setSessionWait({
          sessionId,
          owner: command.threadId
            ? { kind: "thread", threadId: command.threadId }
            : { kind: "orchestrator" },
          kind: "approval",
          reason: approvalRequestSummary(request),
          resumeWhen: "Resume when the user approves or denies the runtime action.",
        });
      } catch {
        // Command-level waiting state still preserves the exact pending action.
      }
    }

    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
    });
  }

  answer(input: {
    requestId: string;
    approved: boolean;
    reason?: string | null;
  }): StructuredRuntimeApprovalRequestRecord {
    const request = this.store.resolveRuntimeApprovalRequest({
      requestId: input.requestId,
      status: input.approved ? "approved" : "denied",
      reviewer: "user",
      decisionReason: input.reason ?? null,
    });
    const pending = this.pending.get(input.requestId);
    this.pending.delete(input.requestId);
    if (request.commandId) {
      if (input.approved) {
        this.store.startCommand(request.commandId);
      } else {
        const command = this.findCommandById(request.commandId);
        this.store.finishCommand({
          commandId: request.commandId,
          status: "cancelled",
          summary: `Approval denied: ${approvalRequestSummary(request)}`,
          facts: {
            ...command?.facts,
            approval: "denied",
            approvalRequestId: request.requestId,
          },
        });
      }
    }
    this.store.clearSessionWait({ sessionId: request.sessionId });
    if (pending) {
      pending.resolve(
        input.approved
          ? { approved: true }
          : { approved: false, reason: input.reason ?? "Runtime action was not approved." },
      );
    }
    return request;
  }

  cancelOpenRequestsForSurface(surfacePiSessionId: string, reason: string): void {
    for (const request of this.store.listOpenRuntimeApprovalRequests()) {
      if (request.surfacePiSessionId !== surfacePiSessionId) {
        continue;
      }
      const resolved = this.store.resolveRuntimeApprovalRequest({
        requestId: request.requestId,
        status: "cancelled",
        reviewer: "user",
        decisionReason: reason,
      });
      if (resolved.commandId) {
        const command = this.findCommandById(resolved.commandId);
        this.store.finishCommand({
          commandId: resolved.commandId,
          status: "cancelled",
          summary: `Approval cancelled: ${approvalRequestSummary(resolved)}`,
          facts: {
            ...command?.facts,
            approval: "cancelled",
            approvalRequestId: resolved.requestId,
          },
        });
      }
      this.store.clearSessionWait({ sessionId: resolved.sessionId });
      const pending = this.pending.get(resolved.requestId);
      this.pending.delete(resolved.requestId);
      pending?.resolve({ approved: false, reason });
    }
  }

  private findCommand(input: RuntimeApprovalBoundaryInput): StructuredCommandRecord | null {
    if (input.commandId) {
      for (const snapshot of this.store.listSessionStates()) {
        const command = snapshot.commands.find((entry) => entry.id === input.commandId);
        if (command) {
          return command;
        }
      }
    }
    for (const snapshot of this.store.listSessionStates()) {
      const command = snapshot.commands.find(
        (entry) =>
          entry.facts?.toolCallId === input.toolCallId &&
          (entry.status === "running" || entry.status === "requested"),
      );
      if (command) {
        return command;
      }
    }
    return null;
  }

  private findCommandById(commandId: string): StructuredCommandRecord | null {
    for (const snapshot of this.store.listSessionStates()) {
      const command = snapshot.commands.find((entry) => entry.id === commandId);
      if (command) {
        return command;
      }
    }
    return null;
  }
}

export function approvalRequestSummary(request: StructuredRuntimeApprovalRequestRecord): string {
  if (request.toolName === "exec_command" && request.command) {
    return `Run command: ${request.command}`;
  }
  if (request.toolName === "apply_patch") {
    return "Apply patch";
  }
  return "Run TypeScript";
}

function reviewRuntimeApprovalRequest(
  input: RuntimeApprovalBoundaryInput,
): { approved: true; reason: string } | { approved: false; reason: string } {
  if (!input.cwd) {
    return { approved: false, reason: "Auto-review denied a runtime action without a cwd." };
  }
  if (input.toolName === "apply_patch") {
    return input.patch && input.patch.trim().length > 0
      ? { approved: true, reason: "Auto-review allowed this patch." }
      : { approved: false, reason: "Auto-review denied an empty patch." };
  }
  if (input.toolName === "execute_typescript") {
    return input.typescriptCode && input.typescriptCode.trim().length > 0
      ? { approved: true, reason: "Auto-review allowed this TypeScript snippet." }
      : { approved: false, reason: "Auto-review denied an empty TypeScript snippet." };
  }
  if (!input.command || input.command.trim().length === 0) {
    return { approved: false, reason: "Auto-review denied an empty shell command." };
  }
  const command = input.command.trim();
  if (containsPrivilegeEscalation(command)) {
    return { approved: false, reason: "Auto-review denied privilege escalation." };
  }
  if (containsRemoteShellPipe(command)) {
    return { approved: false, reason: "Auto-review denied piping remote code into a shell." };
  }
  if (containsRootOrHomeRecursiveDelete(command)) {
    return {
      approved: false,
      reason: "Auto-review denied a recursive forced delete outside the workspace.",
    };
  }
  return { approved: true, reason: "Auto-review allowed this runtime action." };
}

function containsPrivilegeEscalation(command: string): boolean {
  return /(^|[;&|]\s*)(sudo|doas|su)\b/.test(command);
}

function containsRemoteShellPipe(command: string): boolean {
  return /\b(curl|wget)\b[\s\S]*\|[\s\S]*\b(sh|bash|zsh|fish|node|bun|python|python3|ruby|perl)\b/.test(
    command,
  );
}

function containsRootOrHomeRecursiveDelete(command: string): boolean {
  return /(^|[;&|]\s*)rm\s+(-[A-Za-z]*r[A-Za-z]*f|-([A-Za-z]*f[A-Za-z]*r))\s+(\/|~|\$HOME)(\s|$)/.test(
    command,
  );
}

function readContextString(context: unknown, key: string): string | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return null;
  }
  const value = (context as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
