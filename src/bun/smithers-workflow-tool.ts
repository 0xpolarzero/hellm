import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "@sinclair/typebox";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type {
  StructuredSessionStateStore,
  StructuredWaitState,
  StructuredWorkflowStatus,
} from "./structured-session-state";
import {
  readSmithersWorkflowProjectionInput,
  startImplementFeatureWorkflow,
  type StartImplementFeatureWorkflowOptions,
} from "./smithers-workflow-bridge";

export const START_WORKFLOW_TOOL_NAME = "workflow.start";

const onMaxReachedSchema = Type.Union([Type.Literal("return-last"), Type.Literal("fail")]);

export const startWorkflowParamsSchema = Type.Object(
  {
    workflowName: Type.Optional(Type.Literal("implement-feature")),
    specPath: Type.String(),
    pocPath: Type.String(),
    slug: Type.Optional(Type.String()),
    worktreeRoot: Type.Optional(Type.String()),
    branchPrefix: Type.Optional(Type.String()),
    baseBranch: Type.Optional(Type.String()),
    maxIterations: Type.Optional(Type.Integer({ minimum: 1 })),
    onMaxReached: Type.Optional(onMaxReachedSchema),
  },
  { additionalProperties: false },
);

export type StartWorkflowParams = Static<typeof startWorkflowParamsSchema>;

const START_WORKFLOW_DESCRIPTION = [
  "Start a real delegated workflow and record it as a workflow command, workflow thread, and workflow record.",
  "The current implementation supports the Smithers implement-feature workflow under the generic workflow.start surface.",
].join(" ");

export function createStartWorkflowTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
}): AgentTool<typeof startWorkflowParamsSchema, Record<string, unknown>> {
  return {
    label: "Workflow",
    name: START_WORKFLOW_TOOL_NAME,
    description: START_WORKFLOW_DESCRIPTION,
    parameters: startWorkflowParamsSchema,
    execute: async (_toolCallId, params) => {
      const runtime = options.runtime.current;
      if (!runtime) {
        throw new Error(`${START_WORKFLOW_TOOL_NAME} can only run during an active prompt.`);
      }

      const normalized = normalizeParams(params);
      const workflowThread = options.store.createThread({
        turnId: runtime.turnId,
        parentThreadId: runtime.rootThreadId,
        kind: "workflow",
        title: "Run implement-feature workflow",
        objective: buildWorkflowObjective(normalized),
      });
      const command = options.store.createCommand({
        turnId: runtime.turnId,
        threadId: workflowThread.id,
        toolName: START_WORKFLOW_TOOL_NAME,
        executor: "smithers",
        visibility: "surface",
        title: "Start delegated workflow",
        summary: "Launch the delegated workflow in Smithers.",
      });
      options.store.startCommand(command.id);
      setParentThreadDependencyWaiting({
        store: options.store,
        sessionId: runtime.sessionId,
        parentThreadId: runtime.rootThreadId,
        childThreadId: workflowThread.id,
      });

      try {
        const started = await startImplementFeatureWorkflow(normalized);
        const projection = (await waitForProjectionInput(
          started.runId,
          readSmithersWorkflowProjectionInput,
        )) ?? {
          status: "running" satisfies StructuredWorkflowStatus,
          summary: `implement-feature run ${started.runId} started.`,
        };

        const workflow = options.store.recordWorkflow({
          threadId: workflowThread.id,
          commandId: command.id,
          smithersRunId: started.runId,
          workflowName: "implement-feature",
          status: projection.status,
          summary: projection.summary,
        });

        if (projection.status === "waiting") {
          const wait = buildWorkflowWaitState(projection.summary);
          options.store.updateThread({
            threadId: workflowThread.id,
            status: "waiting",
            wait,
          });
          if (canSessionWait(options.store, runtime.sessionId, workflowThread.id)) {
            options.store.setSessionWait({
              sessionId: runtime.sessionId,
              threadId: workflowThread.id,
              kind: wait.kind,
              reason: wait.reason,
              resumeWhen: wait.resumeWhen,
            });
            runtime.sessionWaitApplied = true;
          }
        } else {
          options.store.updateThread({
            threadId: workflowThread.id,
            status:
              projection.status === "running"
                ? "running"
                : mapWorkflowThreadStatus(projection.status),
          });
          if (projection.status !== "running") {
            options.store.createEpisode({
              threadId: workflowThread.id,
              sourceCommandId: command.id,
              kind: "workflow",
              title:
                projection.status === "completed"
                  ? "Delegated workflow completed"
                  : projection.status === "cancelled"
                    ? "Delegated workflow cancelled"
                    : "Delegated workflow failed",
              summary: projection.summary,
              body: projection.summary,
            });
          }
        }
        if (
          projection.status === "completed" ||
          projection.status === "failed" ||
          projection.status === "cancelled"
        ) {
          releaseParentThreadDependency({
            store: options.store,
            sessionId: runtime.sessionId,
            parentThreadId: runtime.rootThreadId,
            childThreadId: workflowThread.id,
          });
        }

        options.store.finishCommand({
          commandId: command.id,
          status: "succeeded",
          summary: projection.summary,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                runId: started.runId,
                threadId: workflowThread.id,
                commandId: command.id,
                workflowId: workflow.id,
                status: workflow.status,
                summary: workflow.summary,
              }),
            },
          ],
          details: {
            ok: true,
            runId: started.runId,
            threadId: workflowThread.id,
            commandId: command.id,
            workflowId: workflow.id,
            status: workflow.status,
            summary: workflow.summary,
            stdout: started.stdout,
            stderr: started.stderr,
          },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to start delegated workflow.";
        options.store.finishCommand({
          commandId: command.id,
          status: "failed",
          summary: "Failed to start delegated workflow.",
          error: message,
        });
        options.store.updateThread({
          threadId: workflowThread.id,
          status: "failed",
        });
        releaseParentThreadDependency({
          store: options.store,
          sessionId: runtime.sessionId,
          parentThreadId: runtime.rootThreadId,
          childThreadId: workflowThread.id,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                threadId: workflowThread.id,
                commandId: command.id,
                error: message,
              }),
            },
          ],
          details: {
            ok: false,
            threadId: workflowThread.id,
            commandId: command.id,
            error: message,
          },
        };
      }
    },
  };
}

function normalizeParams(params: StartWorkflowParams): StartImplementFeatureWorkflowOptions {
  return {
    specPath: params.specPath.trim(),
    pocPath: params.pocPath.trim(),
    ...(params.slug?.trim() ? { slug: params.slug.trim() } : {}),
    ...(params.worktreeRoot?.trim() ? { worktreeRoot: params.worktreeRoot.trim() } : {}),
    ...(params.branchPrefix?.trim() ? { branchPrefix: params.branchPrefix.trim() } : {}),
    ...(params.baseBranch?.trim() ? { baseBranch: params.baseBranch.trim() } : {}),
    ...(typeof params.maxIterations === "number" ? { maxIterations: params.maxIterations } : {}),
    ...(params.onMaxReached ? { onMaxReached: params.onMaxReached } : {}),
  };
}

function buildWorkflowObjective(input: StartImplementFeatureWorkflowOptions): string {
  return `Run implement-feature for ${input.specPath} using ${input.pocPath}.`;
}

function buildWorkflowWaitState(summary: string): StructuredWaitState {
  return {
    kind: "external",
    reason: summary,
    resumeWhen: "Resume when the delegated workflow reports new progress.",
    since: new Date().toISOString(),
  };
}

function canSessionWait(
  store: StructuredSessionStateStore,
  sessionId: string,
  threadId: string,
): boolean {
  const snapshot = store.getSessionState(sessionId);
  return snapshot.threads.every((thread) => thread.id === threadId || thread.status !== "running");
}

function mapWorkflowThreadStatus(
  status: StructuredWorkflowStatus,
): "waiting" | "completed" | "failed" | "cancelled" {
  switch (status) {
    case "waiting":
      return "waiting";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "running":
      throw new Error("Running workflow status should not map through mapWorkflowThreadStatus.");
  }
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

async function waitForProjectionInput(
  runId: string,
  readProjectionInput: typeof readSmithersWorkflowProjectionInput,
  timeoutMs = 5_000,
): Promise<ReturnType<typeof readSmithersWorkflowProjectionInput>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const projection = readProjectionInput({ runId });
    if (projection) {
      return projection;
    }
    await Bun.sleep(100);
  }

  return null;
}
