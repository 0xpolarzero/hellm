import * as Exit from "effect/Exit";
import type {
  RuntimeClientRequestId,
  RuntimeClientSubmissionSource,
  RuntimeFacadeErrorContract,
  SubmitMessageInput,
  SubmitMessageResult,
  WriteCommandStdinInput,
  WriteCommandStdinResult,
  WorkspaceId,
  BoundaryIssue,
} from "@svvy/core";
import {
  decodeUnknownDesktopBridgeErrorContractExit,
  decodeUnknownDesktopSubmitPromptRequestExit,
  decodeUnknownDesktopWriteCommandStdinRequestExit,
  normalizeDesktopBridgeErrorContract,
  type DesktopBridgeErrorContract,
  type DesktopBridgeErrorReason,
  type DesktopSubmitPromptRequest,
  type DesktopWriteCommandStdinRequest,
} from "@svvy/core";
import type { StateReadModelResult } from "@svvy/state";

type RuntimeMessagesFacade = {
  readonly submit: (input: SubmitMessageInput) => Promise<SubmitMessageResult>;
};

type RuntimeCommandsFacade = {
  readonly writeStdin: (input: WriteCommandStdinInput) => Promise<WriteCommandStdinResult>;
};

type FetchStateReadModel = (
  request:
    | { readonly kind: "workspaceChrome" }
    | { readonly kind: "workspaceLayout"; readonly workspaceId: WorkspaceId },
) => Promise<StateReadModelResult>;

export function desktopBridgeError(input: {
  readonly operation: string;
  readonly reason: DesktopBridgeErrorReason;
  readonly message: string;
  readonly issues?: readonly BoundaryIssue[];
  readonly cause?: unknown;
}): DesktopBridgeErrorContract {
  return normalizeDesktopBridgeErrorContract(input);
}

export function normalizeUnknownDesktopBridgeFailure(
  operation: string,
  error: unknown,
): DesktopBridgeErrorContract {
  const decoded = decodeUnknownDesktopBridgeErrorContractExit(error);
  if (Exit.isSuccess(decoded)) {
    return decoded.value;
  }
  const message = error instanceof Error ? error.message : "Desktop bridge handler failed.";
  const reason = /\b(?:shutdown|disposed|closed)\b/i.test(message)
    ? "desktop-shutdown"
    : "runtime-facade-failed";
  return desktopBridgeError({
    operation,
    reason,
    message,
    cause: error,
  });
}

export function normalizeDesktopBridgeHandlers<T>(handlers: T): T {
  return wrapDesktopBridgeHandlerTree(handlers, ["desktop", "rpc"]) as T;
}

export async function submitPromptFromDesktop(input: {
  readonly operation?: string;
  readonly payload: unknown;
  readonly workspaceId: WorkspaceId;
  readonly fetchStateReadModel: FetchStateReadModel;
  readonly runtimeMessages: RuntimeMessagesFacade;
}): Promise<SubmitMessageResult> {
  const operation = input.operation ?? "desktop.sendPrompt";
  const request = decodeDesktopSubmitPromptRequest(operation, input.payload);
  await assertCurrentPanelBinding({
    operation,
    workspaceId: input.workspaceId,
    panelId: request.panelId,
    target: request.target,
    fetchStateReadModel: input.fetchStateReadModel,
  });

  try {
    return await input.runtimeMessages.submit({
      target: request.target as SubmitMessageInput["target"],
      message: {
        text: request.text,
        ...(request.attachments ? { attachments: request.attachments } : {}),
      },
      delivery: "enqueue-and-run",
      clientSubmission: {
        clientRequestId: request.clientRequestId as RuntimeClientRequestId,
        source: "desktop" as RuntimeClientSubmissionSource,
      },
    });
  } catch (error) {
    throw desktopBridgeError({
      operation,
      reason: "runtime-facade-failed",
      message: "Runtime prompt submission failed.",
      cause: error,
    });
  }
}

export async function writeCommandStdinFromDesktop(input: {
  readonly operation?: string;
  readonly payload: unknown;
  readonly runtimeCommands: RuntimeCommandsFacade;
}): Promise<WriteCommandStdinResult> {
  const operation = input.operation ?? "desktop.writeCommandStdin";
  const request = decodeDesktopWriteCommandStdinRequest(operation, input.payload);
  try {
    return await input.runtimeCommands.writeStdin({
      commandId: request.commandId,
      text: request.text,
      ...(request.clientSubmission ? { clientSubmission: request.clientSubmission } : {}),
    });
  } catch (error) {
    throw normalizeCommandStdinFailure(operation, error);
  }
}

function normalizeCommandStdinFailure(
  operation: string,
  error: unknown,
): DesktopBridgeErrorContract {
  const runtimeFailure = readRuntimeFacadeFailure(error);
  if (
    runtimeFailure?.reason === "disposed" ||
    (runtimeFailure?.reason === "typed-failure" &&
      runtimeFailure.runtimeReason &&
      ["runtime-shutdown", "runtime-disposed", "runtime-closed"].includes(
        runtimeFailure.runtimeReason,
      ))
  ) {
    return desktopBridgeError({
      operation,
      reason: "desktop-shutdown",
      message: "Runtime command stdin is unavailable after desktop shutdown.",
    });
  }
  if (runtimeFailure?.reason === "typed-failure") {
    return desktopBridgeError({
      operation,
      reason: "runtime-facade-failed",
      message: "Runtime command stdin was rejected by the runtime.",
    });
  }
  if (runtimeFailure?.reason === "aborted" || runtimeFailure?.reason === "interrupted") {
    return desktopBridgeError({
      operation,
      reason: "runtime-facade-failed",
      message: "Runtime command stdin did not complete.",
    });
  }
  return desktopBridgeError({
    operation,
    reason: "runtime-facade-failed",
    message: "Runtime command stdin failed unexpectedly.",
  });
}

function readRuntimeFacadeFailure(error: unknown): {
  readonly reason: RuntimeFacadeErrorContract["reason"];
  readonly runtimeReason?: string;
} | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const candidate = error as Record<string, unknown>;
  if (candidate.type !== "runtime-facade-error") {
    return null;
  }
  const reason = candidate.reason;
  if (
    reason !== "typed-failure" &&
    reason !== "defect" &&
    reason !== "interrupted" &&
    reason !== "aborted" &&
    reason !== "disposed"
  ) {
    return null;
  }
  const typedError = candidate.error;
  const runtimeReason =
    reason === "typed-failure" &&
    typedError &&
    typeof typedError === "object" &&
    (typedError as Record<string, unknown>)._tag === "RuntimeContractError"
      ? (typedError as Record<string, unknown>).reason
      : undefined;
  return {
    reason,
    ...(typeof runtimeReason === "string" ? { runtimeReason } : {}),
  };
}

function decodeDesktopSubmitPromptRequest(
  operation: string,
  payload: unknown,
): DesktopSubmitPromptRequest {
  const decoded = decodeUnknownDesktopSubmitPromptRequestExit(payload);
  if (Exit.isSuccess(decoded)) {
    return decoded.value;
  }
  throw schemaDecodeBridgeError(operation);
}

function decodeDesktopWriteCommandStdinRequest(
  operation: string,
  payload: unknown,
): DesktopWriteCommandStdinRequest {
  const decoded = decodeUnknownDesktopWriteCommandStdinRequestExit(payload);
  if (Exit.isSuccess(decoded)) {
    return decoded.value;
  }
  throw schemaDecodeBridgeError(operation);
}

async function assertCurrentPanelBinding(input: {
  readonly operation: string;
  readonly workspaceId: WorkspaceId;
  readonly panelId: string;
  readonly target: DesktopSubmitPromptRequest["target"];
  readonly fetchStateReadModel: FetchStateReadModel;
}): Promise<void> {
  let chromeResult: StateReadModelResult;
  try {
    chromeResult = await input.fetchStateReadModel({ kind: "workspaceChrome" });
  } catch (error) {
    throw desktopBridgeError({
      operation: input.operation,
      reason: "state-facade-failed",
      message: "Failed to read authoritative workspace chrome.",
      cause: error,
    });
  }

  if (chromeResult.kind !== "workspaceChrome") {
    throw desktopBridgeError({
      operation: input.operation,
      reason: "state-facade-failed",
      message: `Expected workspaceChrome read model; received ${chromeResult.kind}.`,
    });
  }

  const activeTab = chromeResult.value.tabs.find(
    (tab) => tab.workspaceTabId === chromeResult.value.activeWorkspaceTabId,
  );
  if (!activeTab || activeTab.workspaceId !== input.workspaceId) {
    throw invalidPanelBinding(
      input.operation,
      input.panelId,
      "Panel does not belong to the active workspace tab.",
    );
  }

  let layoutResult: StateReadModelResult;
  try {
    layoutResult = await input.fetchStateReadModel({
      kind: "workspaceLayout",
      workspaceId: input.workspaceId,
    });
  } catch (error) {
    throw desktopBridgeError({
      operation: input.operation,
      reason: "state-facade-failed",
      message: "Failed to read authoritative workspace layout.",
      cause: error,
    });
  }

  if (layoutResult.kind !== "workspaceLayout") {
    throw desktopBridgeError({
      operation: input.operation,
      reason: "state-facade-failed",
      message: `Expected workspaceLayout read model; received ${layoutResult.kind}.`,
    });
  }

  const slot = layoutResult.value.slots.find(
    (candidate) => candidate.layoutId === activeTab.activeLayoutId,
  );
  const pane = slot?.panes.find((candidate) => candidate.paneId === input.panelId);
  if (
    !pane ||
    pane.restore.kind !== "ready" ||
    (pane.target.surface !== "orchestrator" && pane.target.surface !== "handler")
  ) {
    throw invalidPanelBinding(input.operation, input.panelId, "Panel is not bound to a surface.");
  }

  const boundTarget = pane.target;
  if (
    boundTarget.surface !== input.target.surface ||
    boundTarget.workspaceSessionId !== input.target.workspaceSessionId ||
    boundTarget.surfacePiSessionId !== input.target.surfacePiSessionId ||
    (boundTarget.surface === "handler" &&
      (input.target.surface !== "handler" || boundTarget.threadId !== input.target.threadId))
  ) {
    throw invalidPanelBinding(
      input.operation,
      input.panelId,
      "Panel binding no longer matches the submitted target.",
    );
  }
}

function invalidPanelBinding(
  operation: string,
  panelId: string,
  message: string,
): DesktopBridgeErrorContract {
  return desktopBridgeError({
    operation,
    reason: "invalid-panel-binding",
    message,
    issues: [{ path: ["panelId"], message: `Invalid panel binding for ${panelId}.` }],
  });
}

function schemaDecodeBridgeError(operation: string): DesktopBridgeErrorContract {
  return desktopBridgeError({
    operation,
    reason: "invalid-input",
    message: "Desktop bridge request did not match the required contract.",
  });
}

function wrapDesktopBridgeHandlerTree(value: unknown, path: readonly string[]): unknown {
  if (typeof value === "function") {
    return async (...args: unknown[]) => {
      try {
        return await value(...args);
      } catch (error) {
        throw normalizeUnknownDesktopBridgeFailure(path.join("."), error);
      }
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      wrapDesktopBridgeHandlerTree(child, [...path, key]),
    ]),
  );
}

export const isDesktopBridgeErrorContract = (value: unknown): value is DesktopBridgeErrorContract =>
  Exit.isSuccess(decodeUnknownDesktopBridgeErrorContractExit(value));
