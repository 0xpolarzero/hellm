import * as Effect from "effect/Effect";
import {
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeContractError,
  type CommandId,
  type CreateRuntimeApprovalRequestInput,
  type RuntimeCommandRecord,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type ThreadId,
  type ToolItemId,
  type TurnId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeApprovalWaitService } from "./runtime-approval-wait-service";

export type RuntimeDirectToolApprovalDecision =
  | { readonly approved: true }
  | { readonly approved: false; readonly reason?: string };

export type RuntimeDirectToolApprovalAdmissionInput = {
  readonly approvalMode: CreateRuntimeApprovalRequestInput["approvalMode"];
  readonly toolName: CreateRuntimeApprovalRequestInput["toolName"];
  readonly toolCallId: ToolItemId;
  readonly cwd: string;
  readonly sessionId?: WorkspaceSessionId;
  readonly surfacePiSessionId?: SurfacePiSessionId;
  readonly threadId?: ThreadId | null;
  readonly turnId?: TurnId | null;
  readonly commandId?: CommandId | null;
  readonly command?: string | null;
  readonly commandFamily?: string | null;
  readonly patch?: string | null;
  readonly snippetArtifactId?: string | null;
  readonly typescriptCode?: string | null;
  readonly context?: unknown;
};

function mapApprovalAdmissionFailure(operation: string, cause: unknown): RuntimeContractError {
  if (cause instanceof RuntimeContractError) {
    return cause;
  }
  const stateCause = cause as {
    readonly reason?: string;
    readonly message?: string;
    readonly issues?: RuntimeContractError["issues"];
  };
  return new RuntimeContractError({
    operation,
    reason:
      stateCause.reason === "not-found"
        ? "target-not-found"
        : stateCause.reason === "invalid-input"
          ? "invalid-input"
          : stateCause.reason === "state-conflict"
            ? "state-conflict"
            : "stale-state",
    message: stateCause.message ?? "Runtime approval admission failed.",
    ...(stateCause.issues ? { issues: stateCause.issues } : {}),
    cause,
  });
}

function publishAfterCommit(
  operation: string,
  afterCommit: readonly StateInvalidationDescriptor[],
): Effect.Effect<void, RuntimeContractError, RuntimeEventBus> {
  return Effect.gen(function* () {
    const eventBus = yield* RuntimeEventBus;
    yield* eventBus.publishStateInvalidations({ afterCommit }).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation,
            reason: "stale-state",
            message: "Runtime event bus did not accept approval admission notifications.",
            cause,
          }),
      ),
    );
  });
}

function reviewRuntimeApprovalRequest(input: RuntimeDirectToolApprovalAdmissionInput):
  | { readonly approved: true; readonly reason: string }
  | {
      readonly approved: false;
      readonly reason: string;
    } {
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

type RuntimeApprovalRecordContext = Exclude<
  CreateRuntimeApprovalRequestInput["context"],
  undefined
>;

function runtimeApprovalRecordContext(context: unknown): RuntimeApprovalRecordContext {
  if (
    context &&
    typeof context === "object" &&
    "reason" in context &&
    "sandboxDenied" in context &&
    (context as { reason?: unknown }).reason === "sandbox_denial_escalation" &&
    (context as { sandboxDenied?: unknown }).sandboxDenied === true
  ) {
    return {
      reason: "sandbox_denial_escalation",
      sandboxDenied: true,
    };
  }
  return null;
}

function findCommand(
  input: RuntimeDirectToolApprovalAdmissionInput,
): Effect.Effect<RuntimeCommandRecord | null, RuntimeContractError, RuntimeCommandStatePort> {
  return Effect.gen(function* () {
    const commandState = yield* RuntimeCommandStatePort;
    if (input.commandId) {
      return yield* commandState
        .findCommandById({ commandId: input.commandId })
        .pipe(
          Effect.mapError((cause) =>
            mapApprovalAdmissionFailure("runtime.acceptedNativeTool.approval.findCommand", cause),
          ),
        );
    }
    const command = yield* commandState
      .findCommandByToolCallId({
        toolCallId: input.toolCallId,
        ...(input.surfacePiSessionId ? { surfacePiSessionId: input.surfacePiSessionId } : {}),
      })
      .pipe(
        Effect.mapError((cause) =>
          mapApprovalAdmissionFailure("runtime.acceptedNativeTool.approval.findCommand", cause),
        ),
      );
    if (command && (command.status === "running" || command.status === "requested")) {
      return command;
    }
    return null;
  });
}

export const requestRuntimeDirectToolApproval = Effect.fn(
  "@svvy/runtime/acceptedNativeToolExecution.requestDirectToolApproval",
)(function* (
  input: RuntimeDirectToolApprovalAdmissionInput,
): Effect.fn.Return<
  RuntimeDirectToolApprovalDecision,
  RuntimeContractError,
  RuntimeApprovalStatePort | RuntimeCommandStatePort | RuntimeEventBus | RuntimeApprovalWaitService
> {
  const approvalState = yield* RuntimeApprovalStatePort;
  const approvalWaitService = yield* RuntimeApprovalWaitService;
  const command = yield* findCommand(input);
  const sessionId = command?.sessionId ?? input.sessionId ?? null;
  const surfacePiSessionId = command?.surfacePiSessionId ?? input.surfacePiSessionId ?? null;
  if (!sessionId || !surfacePiSessionId) {
    return {
      approved: false,
      reason: "Runtime approval request is missing surface context.",
    };
  }
  const threadId = command?.threadId ?? input.threadId ?? null;
  const turnId = command?.turnId ?? input.turnId ?? null;
  const commandId = input.commandId ?? command?.id ?? null;
  const created = yield* approvalState
    .createApprovalRequest({
      sessionId: sessionId as WorkspaceSessionId,
      surfacePiSessionId: surfacePiSessionId as SurfacePiSessionId,
      threadId: threadId ? (threadId as ThreadId) : null,
      turnId: turnId ? (turnId as TurnId) : null,
      commandId: commandId ? (commandId as CommandId) : null,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      approvalMode: input.approvalMode,
      cwd: input.cwd,
      command: input.command ?? null,
      commandFamily: input.commandFamily ?? null,
      patch: input.patch ?? null,
      snippetArtifactId: input.snippetArtifactId ?? null,
      typescriptCode: input.typescriptCode ?? null,
      context: runtimeApprovalRecordContext(input.context),
    })
    .pipe(
      Effect.mapError((cause) =>
        mapApprovalAdmissionFailure("runtime.acceptedNativeTool.approval.create", cause),
      ),
    );
  const request = created.value;
  yield* publishAfterCommit("runtime.acceptedNativeTool.approval.create", created.afterCommit);

  if (input.approvalMode === "auto-review") {
    const decision = reviewRuntimeApprovalRequest(input);
    const resolved = yield* approvalState
      .resolveApprovalRequest({
        requestId: request.requestId,
        status: decision.approved ? "approved" : "denied",
        reviewer: "auto-review",
        decisionReason: decision.reason,
      })
      .pipe(
        Effect.mapError((cause) =>
          mapApprovalAdmissionFailure("runtime.acceptedNativeTool.approval.autoReview", cause),
        ),
      );
    yield* publishAfterCommit(
      "runtime.acceptedNativeTool.approval.autoReview",
      resolved.afterCommit,
    );
    return decision.approved ? { approved: true } : { approved: false, reason: decision.reason };
  }

  return yield* approvalWaitService.waitForApproval({
    request,
    recheck: approvalState
      .getApprovalRequest({ requestId: request.requestId })
      .pipe(
        Effect.mapError((cause) =>
          mapApprovalAdmissionFailure("runtime.acceptedNativeTool.approval.recheck", cause),
        ),
      ),
  });
});
