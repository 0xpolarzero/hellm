import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "@sinclair/typebox";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type { StructuredSessionStateStore } from "./structured-session-state";
import {
  VERIFICATION_KINDS,
  buildVerificationSummary,
  displayCommand,
  formatVerificationBody,
  runVerificationBridge,
  type VerificationCommand,
  type VerificationKind,
} from "./verification-bridge";

export const VERIFY_RUN_TOOL_NAME = "verification.run";

const verificationKindSchema = Type.Union(VERIFICATION_KINDS.map((kind) => Type.Literal(kind)));

export const verifyRunParamsSchema = Type.Object(
  {
    kind: verificationKindSchema,
    target: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type VerifyRunParams = Static<typeof verifyRunParamsSchema>;

const VERIFY_RUN_TOOL_DESCRIPTION = [
  "Run a real bounded verification command and record the outcome as a command, verification record, thread update, and verification episode.",
  "Use this for test, lint, build, typecheck, or integration checks when the next step is to check reality rather than edit code.",
].join(" ");

export function createVerifyRunTool(options: {
  cwd: string;
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
}): AgentTool<typeof verifyRunParamsSchema, Record<string, unknown>> {
  return {
    label: "Verification",
    name: VERIFY_RUN_TOOL_NAME,
    description: VERIFY_RUN_TOOL_DESCRIPTION,
    parameters: verifyRunParamsSchema,
    execute: async (_toolCallId, params, signal) => {
      const runtime = options.runtime.current;
      if (!runtime) {
        throw new Error(`${VERIFY_RUN_TOOL_NAME} can only run during an active prompt.`);
      }

      const normalized = normalizeVerifyRunParams(params);
      const command = resolveVerificationCommand(normalized);
      const thread = options.store.createThread({
        turnId: runtime.turnId,
        parentThreadId: runtime.rootThreadId,
        kind: "verification",
        title: `Run ${normalized.kind} verification`,
        objective: buildVerificationObjective(normalized.kind, command),
      });
      const structuredCommand = options.store.createCommand({
        turnId: runtime.turnId,
        threadId: thread.id,
        toolName: VERIFY_RUN_TOOL_NAME,
        executor: "verification",
        visibility: "surface",
        title: `Run ${normalized.kind} verification`,
        summary: `Launch ${normalized.kind} verification against the real workspace.`,
      });
      options.store.startCommand(structuredCommand.id);
      setParentThreadDependencyWaiting({
        store: options.store,
        sessionId: runtime.sessionId,
        parentThreadId: runtime.rootThreadId,
        childThreadId: thread.id,
      });

      try {
        const result = await runVerificationBridge({
          command,
          cwd: options.cwd,
          signal,
        });

        if (!result.launched) {
          options.store.finishCommand({
            commandId: structuredCommand.id,
            status: "failed",
            summary: `Failed to launch ${normalized.kind} verification.`,
            error: result.error.message,
          });
          options.store.updateThread({
            threadId: thread.id,
            status: "failed",
            title: `Run ${normalized.kind} verification`,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  threadId: thread.id,
                  commandId: structuredCommand.id,
                  error: result.error.message,
                }),
              },
            ],
            details: {
              ok: false,
              threadId: thread.id,
              commandId: structuredCommand.id,
              error: result.error.message,
            },
          };
        }

        const status = result.cancelled ? "cancelled" : result.exitCode === 0 ? "passed" : "failed";
        const commandText = displayCommand(command);
        const summary = buildVerificationSummary(normalized.kind, status, result.exitCode);
        const verification = options.store.recordVerification({
          threadId: thread.id,
          commandId: structuredCommand.id,
          kind: normalized.kind,
          status,
          summary,
          command: commandText,
        });
        options.store.createEpisode({
          threadId: thread.id,
          sourceCommandId: structuredCommand.id,
          kind: "verification",
          title: `${normalized.kind} verification`,
          summary,
          body: formatVerificationBody({
            kind: normalized.kind,
            command: commandText,
            status,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            launched: true,
            cancelled: result.cancelled,
            signal: result.signal,
          }),
        });
        options.store.finishCommand({
          commandId: structuredCommand.id,
          status: "succeeded",
          summary,
        });
        options.store.updateThread({
          threadId: thread.id,
          status:
            status === "passed" ? "completed" : status === "cancelled" ? "cancelled" : "failed",
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                threadId: thread.id,
                commandId: structuredCommand.id,
                verificationId: verification.id,
                status,
                summary,
                exitCode: result.exitCode,
                cancelled: result.cancelled,
              }),
            },
          ],
          details: {
            ok: true,
            threadId: thread.id,
            commandId: structuredCommand.id,
            verificationId: verification.id,
            status,
            summary,
            exitCode: result.exitCode,
            cancelled: result.cancelled,
            stdout: result.stdout,
            stderr: result.stderr,
          },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to run verification command.";
        options.store.finishCommand({
          commandId: structuredCommand.id,
          status: "failed",
          summary: `Failed to launch ${normalized.kind} verification.`,
          error: message,
        });
        options.store.updateThread({
          threadId: thread.id,
          status: "failed",
          title: `Run ${normalized.kind} verification`,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                threadId: thread.id,
                commandId: structuredCommand.id,
                error: message,
              }),
            },
          ],
          details: {
            ok: false,
            threadId: thread.id,
            commandId: structuredCommand.id,
            error: message,
          },
        };
      } finally {
        releaseParentThreadDependency({
          store: options.store,
          sessionId: runtime.sessionId,
          parentThreadId: runtime.rootThreadId,
          childThreadId: thread.id,
        });
      }
    },
  };
}

function normalizeVerifyRunParams(params: VerifyRunParams): VerifyRunParams {
  return {
    kind: params.kind,
    target: params.target?.trim() || undefined,
  };
}

function resolveVerificationCommand(params: VerifyRunParams): VerificationCommand {
  switch (params.kind) {
    case "typecheck":
      rejectTarget(params);
      return ["bun", "run", "typecheck"];
    case "lint":
      rejectTarget(params);
      return ["bun", "run", "lint:check"];
    case "build":
      rejectTarget(params);
      return ["bun", "run", "build"];
    case "integration":
      rejectTarget(params);
      return ["bun", "run", "test:e2e"];
    case "test":
      return params.target ? ["bun", "test", "--", params.target] : ["bun", "run", "test"];
  }
}

function rejectTarget(params: VerifyRunParams): void {
  if (params.target) {
    throw new Error(`${VERIFY_RUN_TOOL_NAME} does not accept target for ${params.kind}.`);
  }
}

function buildVerificationObjective(kind: VerificationKind, command: VerificationCommand): string {
  return `${kind} verification: ${displayCommand(command)}`;
}

function setParentThreadDependencyWaiting(input: {
  store: StructuredSessionStateStore;
  sessionId: string;
  parentThreadId: string;
  childThreadId: string;
}): void {
  const parentThread = input.store
    .getSessionState(input.sessionId)
    .threads.find((thread) => thread.id === input.parentThreadId);
  if (!parentThread || isTerminalThreadStatus(parentThread.status)) {
    return;
  }

  if (parentThread.status === "waiting" && parentThread.wait) {
    return;
  }

  const nextDependsOn =
    parentThread.status === "waiting" && !parentThread.wait
      ? [...new Set([...parentThread.dependsOnThreadIds, input.childThreadId])]
      : [input.childThreadId];
  if (
    parentThread.status === "waiting" &&
    !parentThread.wait &&
    parentThread.dependsOnThreadIds.length === nextDependsOn.length &&
    parentThread.dependsOnThreadIds.every((value, index) => value === nextDependsOn[index])
  ) {
    return;
  }

  input.store.updateThread({
    threadId: parentThread.id,
    status: "waiting",
    dependsOnThreadIds: nextDependsOn,
  });
}

function releaseParentThreadDependency(input: {
  store: StructuredSessionStateStore;
  sessionId: string;
  parentThreadId: string;
  childThreadId: string;
}): void {
  const parentThread = input.store
    .getSessionState(input.sessionId)
    .threads.find((thread) => thread.id === input.parentThreadId);
  if (!parentThread || isTerminalThreadStatus(parentThread.status)) {
    return;
  }

  if (parentThread.status !== "waiting" || parentThread.wait) {
    return;
  }
  if (!parentThread.dependsOnThreadIds.includes(input.childThreadId)) {
    return;
  }

  const remaining = parentThread.dependsOnThreadIds.filter((id) => id !== input.childThreadId);
  if (remaining.length === 0) {
    input.store.updateThread({
      threadId: parentThread.id,
      status: "running",
    });
    return;
  }

  input.store.updateThread({
    threadId: parentThread.id,
    status: "waiting",
    dependsOnThreadIds: remaining,
  });
}

function isTerminalThreadStatus(status: "running" | "waiting" | "completed" | "failed" | "cancelled"): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
