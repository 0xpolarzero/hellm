import type {
  RuntimeApprovalRecord,
  RuntimeApprovalStatePortService,
  RuntimeCommandRecord,
  RuntimeCommandStatePortService,
  RuntimeSessionWaitStatePortService,
  StateContractError,
  CommandId,
  RuntimeApprovalId,
  SurfacePiSessionId,
  ThreadId,
  ToolItemId,
  TurnId,
  WorkspaceSessionId,
} from "@svvy/core";
import type * as Effect from "effect/Effect";
import type { RuntimeApprovalBoundary, RuntimeApprovalBoundaryInput } from "./approval-boundary";

type PendingRuntimeApproval = {
  reject: (error: Error) => void;
  resolve: (value: { approved: true } | { approved: false; reason?: string }) => void;
};

export class RuntimeApprovalRequestRuntime {
  private readonly pending = new Map<string, PendingRuntimeApproval>();

  constructor(
    private readonly approvalState: RuntimeApprovalStatePortService,
    private readonly commandState: RuntimeCommandStatePortService,
    private readonly sessionWaitState: RuntimeSessionWaitStatePortService,
    private readonly runState: <A>(effect: Effect.Effect<A, StateContractError>) => Promise<A>,
  ) {}

  createBoundary(): RuntimeApprovalBoundary {
    return (input) => this.requestApproval(input);
  }

  async requestApproval(
    input: RuntimeApprovalBoundaryInput,
  ): Promise<{ approved: true } | { approved: false; reason?: string }> {
    const command = (await this.findCommand(input)) ?? null;
    const sessionId = command?.sessionId ?? readContextString(input.context, "sessionId");
    const surfacePiSessionId =
      command?.surfacePiSessionId ?? readContextString(input.context, "surfacePiSessionId");
    if (!sessionId || !surfacePiSessionId) {
      return { approved: false, reason: "Runtime approval request is missing surface context." };
    }
    const threadId = command?.threadId ?? readContextString(input.context, "threadId");
    const requestResult = await this.runState(
      this.approvalState.createApprovalRequest({
        sessionId: sessionId as WorkspaceSessionId,
        surfacePiSessionId: surfacePiSessionId as SurfacePiSessionId,
        threadId: threadId ? (threadId as ThreadId) : null,
        turnId: command?.turnId ? (command.turnId as TurnId) : null,
        commandId: input.commandId
          ? (input.commandId as CommandId)
          : command?.id
            ? (command.id as CommandId)
            : null,
        toolCallId: input.toolCallId as ToolItemId,
        toolName: input.toolName,
        approvalMode: input.approvalMode,
        cwd: input.cwd,
        command: input.command,
        commandFamily: input.commandFamily,
        patch: input.patch,
        snippetArtifactId: input.snippetArtifactId,
        typescriptCode: input.typescriptCode,
      }),
    );
    const request = requestResult.value;

    if (input.approvalMode === "auto-review") {
      const decision = reviewRuntimeApprovalRequest(input);
      await this.runState(
        this.approvalState.resolveApprovalRequest({
          requestId: request.requestId,
          status: decision.approved ? "approved" : "denied",
          reviewer: "auto-review",
          decisionReason: decision.reason,
        }),
      );
      if (!decision.approved && command) {
        await this.runState(
          this.commandState.finishCommand({
            commandId: command.id,
            status: "cancelled",
            summary: `Approval denied: ${approvalRequestSummary(request)}`,
            facts: {
              ...command.facts,
              approval: "denied",
              approvalRequestId: request.requestId,
            },
          }),
        );
      }
      return decision.approved ? { approved: true } : { approved: false, reason: decision.reason };
    }

    if (command) {
      await this.runState(
        this.commandState.finishCommand({
          commandId: command.id,
          status: "waiting",
          summary: `Waiting for approval: ${approvalRequestSummary(request)}`,
          facts: {
            ...command.facts,
            approval: "pending",
            approvalRequestId: request.requestId,
          },
        }),
      );
      try {
        await this.runState(
          this.sessionWaitState.setApprovalWait({
            sessionId: sessionId as WorkspaceSessionId,
            owner: command.threadId
              ? { kind: "thread", threadId: command.threadId as ThreadId }
              : { kind: "orchestrator" },
            reason: approvalRequestSummary(request),
            resumeWhen: "Resume when the user approves or denies the runtime action.",
          }),
        );
      } catch {
        // Command-level waiting state still preserves the exact pending action.
      }
    }

    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
    });
  }

  async answer(input: {
    requestId: string;
    approved: boolean;
    reason?: string | null;
  }): Promise<RuntimeApprovalRecord> {
    const requestResult = await this.runState(
      this.approvalState.resolveApprovalRequest({
        requestId: input.requestId as RuntimeApprovalId,
        status: input.approved ? "approved" : "denied",
        reviewer: "user",
        decisionReason: input.reason ?? null,
      }),
    );
    const request = requestResult.value;
    if (request.commandId) {
      if (input.approved) {
        await this.runState(this.commandState.startCommand({ commandId: request.commandId }));
      } else {
        const command = await this.findCommandById(request.commandId);
        await this.runState(
          this.commandState.finishCommand({
            commandId: request.commandId,
            status: "cancelled",
            summary: `Approval denied: ${approvalRequestSummary(request)}`,
            facts: {
              ...command?.facts,
              approval: "denied",
              approvalRequestId: request.requestId,
            },
          }),
        );
      }
    }
    await this.runState(this.sessionWaitState.clearSessionWait({ sessionId: request.sessionId }));
    this.resolveAnsweredRequest({ request, approved: input.approved, reason: input.reason });
    return request;
  }

  resolveAnsweredRequest(input: {
    approved: boolean;
    reason?: string | null;
    request: RuntimeApprovalRecord;
  }): void {
    const pending = this.pending.get(input.request.requestId);
    this.pending.delete(input.request.requestId);
    pending?.resolve(
      input.approved
        ? { approved: true }
        : { approved: false, reason: input.reason ?? "Runtime action was not approved." },
    );
  }

  async cancelOpenRequestsForSurface(surfacePiSessionId: string, reason: string): Promise<void> {
    for (const request of await this.runState(
      this.approvalState.listOpenApprovalRequests({
        surfacePiSessionId: surfacePiSessionId as SurfacePiSessionId,
      }),
    )) {
      await this.cancelOpenRequest(request, reason);
    }
  }

  async cancelAllOpenRequests(reason: string): Promise<void> {
    for (const request of await this.runState(this.approvalState.listOpenApprovalRequests())) {
      await this.cancelOpenRequest(request, reason);
    }
  }

  private async cancelOpenRequest(request: RuntimeApprovalRecord, reason: string): Promise<void> {
    const resolvedResult = await this.runState(
      this.approvalState.resolveApprovalRequest({
        requestId: request.requestId as RuntimeApprovalId,
        status: "cancelled",
        reviewer: "user",
        decisionReason: reason,
      }),
    );
    const resolved = resolvedResult.value;
    if (resolved.commandId) {
      const command = await this.findCommandById(resolved.commandId);
      await this.runState(
        this.commandState.finishCommand({
          commandId: resolved.commandId,
          status: "cancelled",
          summary: `Approval cancelled: ${approvalRequestSummary(resolved)}`,
          facts: {
            ...command?.facts,
            approval: "cancelled",
            approvalRequestId: resolved.requestId,
          },
        }),
      );
    }
    await this.runState(this.sessionWaitState.clearSessionWait({ sessionId: resolved.sessionId }));
    const pending = this.pending.get(resolved.requestId);
    this.pending.delete(resolved.requestId);
    pending?.resolve({ approved: false, reason });
  }

  private async findCommand(
    input: RuntimeApprovalBoundaryInput,
  ): Promise<RuntimeCommandRecord | null> {
    if (input.commandId) {
      return this.findCommandById(input.commandId);
    }
    const command = await this.runState(
      this.commandState.findCommandByToolCallId({ toolCallId: input.toolCallId }),
    );
    if (command && (command.status === "running" || command.status === "requested")) {
      return command;
    }
    return null;
  }

  private findCommandById(commandId: string): Promise<RuntimeCommandRecord | null> {
    return this.runState(this.commandState.findCommandById({ commandId }));
  }
}

export function approvalRequestSummary(request: RuntimeApprovalRecord): string {
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
