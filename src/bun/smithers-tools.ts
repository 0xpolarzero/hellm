import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static, TSchema as TypeBoxSchema } from "@sinclair/typebox";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type { StructuredSessionStateStore } from "./structured-session-state";
import { SmithersRuntimeManager } from "./smithers-runtime/manager";
import {
  SMITHERS_RUN_WORKFLOW_TOOL_NAME,
  type RunnableWorkflowLaunchContract,
} from "./smithers-runtime/workflow-launch-contract";

const emptyParamsSchema = Type.Object({}, { additionalProperties: false });
const runIdSchema = Type.String({ minLength: 1 });

const listRunsParamsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    status: Type.Optional(Type.String({ minLength: 1 })),
    workflowId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const getRunParamsSchema = Type.Object(
  {
    runId: runIdSchema,
  },
  { additionalProperties: false },
);

const watchRunParamsSchema = Type.Object(
  {
    runId: runIdSchema,
    intervalMs: Type.Optional(Type.Integer({ minimum: 1 })),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const listPendingApprovalsParamsSchema = Type.Object(
  {
    runId: Type.Optional(runIdSchema),
    workflowName: Type.Optional(Type.String({ minLength: 1 })),
    nodeId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const resolveApprovalParamsSchema = Type.Object(
  {
    runId: runIdSchema,
    nodeId: Type.String({ minLength: 1 }),
    iteration: Type.Optional(Type.Integer({ minimum: 0 })),
    decision: Type.Union([Type.Literal("approve"), Type.Literal("deny")]),
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const getNodeDetailParamsSchema = Type.Object(
  {
    runId: runIdSchema,
    nodeId: Type.String({ minLength: 1 }),
    iteration: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const listArtifactsParamsSchema = Type.Object(
  {
    runId: runIdSchema,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

const getRunEventsParamsSchema = Type.Object(
  {
    runId: runIdSchema,
    afterSeq: Type.Optional(Type.Integer({ minimum: -1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    nodeId: Type.Optional(Type.String({ minLength: 1 })),
    types: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    sinceTimestampMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const getChatTranscriptParamsSchema = Type.Object(
  {
    runId: runIdSchema,
    all: Type.Optional(Type.Boolean()),
    includeStderr: Type.Optional(Type.Boolean()),
    tail: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

const sendSignalParamsSchema = Type.Object(
  {
    runId: runIdSchema,
    signalName: Type.String({ minLength: 1 }),
    data: Type.Optional(Type.Object({}, { additionalProperties: true })),
    correlationId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const listFramesParamsSchema = Type.Object(
  {
    runId: runIdSchema,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    afterFrameNo: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const getDevToolsSnapshotParamsSchema = Type.Object(
  {
    runId: runIdSchema,
    frameNo: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const streamDevToolsParamsSchema = Type.Object(
  {
    runId: runIdSchema,
    fromSeq: Type.Optional(Type.Integer({ minimum: 0 })),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    maxEvents: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    pollIntervalMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000 })),
  },
  { additionalProperties: false },
);

type CreateSmithersToolsOptions = {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
  manager: SmithersRuntimeManager;
};

export function createSmithersTools(options: CreateSmithersToolsOptions): AgentTool<any>[] {
  return [
    createSmithersTool({
      name: "smithers.list_workflows",
      label: "Smithers Workflows",
      description:
        "List runnable saved and artifact Smithers workflow entries available to the current handler thread.",
      parameters: emptyParamsSchema,
      visibility: "summary",
      runtime: options.runtime,
      store: options.store,
      execute: async () => {
        await options.manager.refreshWorkflowRegistry();
        const workflows = options.manager.listWorkflows();
        return {
          summary:
            workflows.length > 0
              ? `Available workflows: ${workflows
                  .map((workflow) => `${workflow.id} via ${workflow.launchToolName}`)
                  .join(", ")}.`
              : "No runnable workflow entries are available.",
          details: {
            workflows,
            workflowToolSurfaceVersion: options.manager.getWorkflowToolSurfaceVersion(),
          },
        };
      },
    }),
    ...options.manager
      .listWorkflowLaunchContracts()
      .map((contract) => createWorkflowLaunchTool(options, contract)),
    createSmithersTool({
      name: "smithers.list_runs",
      label: "List Runs",
      description: "List recent Smithers workflow runs with svvy ownership metadata when known.",
      parameters: listRunsParamsSchema,
      visibility: "summary",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const runs = await options.manager.listRuns({
          limit: params.limit,
          status: params.status?.trim() || undefined,
          workflowId: params.workflowId?.trim() || undefined,
        });
        return {
          summary:
            runs.length > 0
              ? `Loaded ${runs.length} Smithers run summaries.`
              : "No Smithers runs matched the query.",
          details: {
            runs,
          },
        };
      },
    }),
    createSmithersTool({
      name: "smithers.get_run",
      label: "Get Run",
      description: "Inspect one Smithers run summary.",
      parameters: getRunParamsSchema,
      visibility: "summary",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const run = await options.manager.getRun(params.runId);
        return {
          summary: run.summary,
          details: run,
        };
      },
    }),
    createSmithersTool({
      name: "smithers.watch_run",
      label: "Watch Run",
      description: "Watch a Smithers run until it reaches a terminal state or a timeout expires.",
      parameters: watchRunParamsSchema,
      visibility: "summary",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const result = await options.manager.watchRun({
          runId: params.runId,
          intervalMs: params.intervalMs,
          timeoutMs: params.timeoutMs,
        });
        return {
          summary: result.reachedTerminal
            ? `Run ${params.runId} reached terminal status ${result.finalRun.status}.`
            : `Watched run ${params.runId} until timeout without reaching a terminal state.`,
          details: result,
        };
      },
    }),
    createSmithersTool({
      name: "smithers.explain_run",
      label: "Explain Run",
      description:
        "Explain why a Smithers run is blocked, waiting, stale, or otherwise attention-worthy.",
      parameters: getRunParamsSchema,
      visibility: "summary",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const explanation = await options.manager.explainRun(params.runId);
        return {
          summary: explanation.summary,
          details: explanation,
        };
      },
    }),
    createSmithersTool({
      name: "smithers.list_pending_approvals",
      label: "Pending Approvals",
      description: "List pending Smithers approvals for one run or across all monitored runs.",
      parameters: listPendingApprovalsParamsSchema,
      visibility: "summary",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const approvals = await options.manager.listPendingApprovals({
          runId: params.runId?.trim() || undefined,
          workflowName: params.workflowName?.trim() || undefined,
          nodeId: params.nodeId?.trim() || undefined,
        });
        return {
          summary:
            approvals.length > 0
              ? `Loaded ${approvals.length} pending approval request(s).`
              : "No pending approvals were found.",
          details: {
            approvals,
          },
        };
      },
    }),
    createSmithersTool({
      name: "smithers.resolve_approval",
      label: "Resolve Approval",
      description: "Approve or deny a pending Smithers approval.",
      parameters: resolveApprovalParamsSchema,
      visibility: "surface",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const result = await options.manager.resolveApproval({
          runId: params.runId,
          nodeId: params.nodeId,
          iteration: params.iteration,
          decision: params.decision,
          note: params.note?.trim() || undefined,
        });
        return {
          summary: `${params.decision === "approve" ? "Approved" : "Denied"} ${params.nodeId} for run ${params.runId}.`,
          details: result,
        };
      },
      afterExecute(input) {
        return {
          runId: input.params.runId,
          nodeId: input.params.nodeId,
          decision: input.params.decision,
          postStatus: "approval-updated",
        };
      },
    }),
    createSmithersTool({
      name: "smithers.get_node_detail",
      label: "Node Detail",
      description: "Inspect attempts, tool calls, and validated output for a Smithers node.",
      parameters: getNodeDetailParamsSchema,
      visibility: "summary",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const detail = await options.manager.getNodeDetail({
          runId: params.runId,
          nodeId: params.nodeId,
          iteration: params.iteration,
        });
        return {
          summary: `Loaded detail for ${params.nodeId} in run ${params.runId}.`,
          details: detail,
        };
      },
    }),
    createSmithersTool({
      name: "smithers.list_artifacts",
      label: "Run Artifacts",
      description: "Inspect Smithers workflow outputs and rendered frames for one run.",
      parameters: listArtifactsParamsSchema,
      visibility: "summary",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const artifacts = await options.manager.listArtifacts({
          runId: params.runId,
          limit: params.limit,
        });
        return {
          summary: `Loaded workflow artifacts for run ${params.runId}.`,
          details: artifacts,
        };
      },
    }),
    createSmithersTool({
      name: "smithers.get_chat_transcript",
      label: "Chat Transcript",
      description: "Read the structured workflow chat transcript grouped by attempts.",
      parameters: getChatTranscriptParamsSchema,
      visibility: "summary",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const transcript = await options.manager.getChatTranscript({
          runId: params.runId,
          all: params.all,
          includeStderr: params.includeStderr,
          tail: params.tail,
        });
        return {
          summary: `Loaded ${transcript.messages.length} transcript message(s) across ${transcript.attempts.length} attempt(s).`,
          details: transcript,
        };
      },
    }),
    createSmithersTool({
      name: "smithers.get_run_events",
      label: "Run Events",
      description: "Read raw Smithers lifecycle events with sequence pagination.",
      parameters: getRunEventsParamsSchema,
      visibility: "summary",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const events = await options.manager.getRunEvents({
          runId: params.runId,
          afterSeq: params.afterSeq,
          limit: params.limit,
          nodeId: params.nodeId?.trim() || undefined,
          types: params.types,
          sinceTimestampMs: params.sinceTimestampMs,
        });
        return {
          summary: `Loaded ${events.length} Smithers event(s).`,
          details: {
            runId: params.runId,
            events,
          },
        };
      },
    }),
    createSmithersTool({
      name: "smithers.signals.send",
      label: "Send Signal",
      description: "Deliver a durable signal to a waiting Smithers run.",
      parameters: sendSignalParamsSchema,
      visibility: "surface",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const result = await options.manager.sendSignal({
          runId: params.runId,
          signalName: params.signalName,
          data: params.data,
          correlationId: params.correlationId?.trim() || undefined,
        });
        return {
          summary: `Delivered signal ${params.signalName} to run ${params.runId}.`,
          details: result,
        };
      },
      beforeExecute(input) {
        return options.manager.getRun(input.params.runId);
      },
      afterExecute(input) {
        return {
          runId: input.params.runId,
          signalName: input.params.signalName,
          preStatus: readRunStatus(input.before),
          postStatus:
            typeof input.result.details.run === "object" && input.result.details.run
              ? readRunStatus(input.result.details.run as Record<string, unknown>)
              : null,
        };
      },
    }),
    createSmithersTool({
      name: "smithers.frames.list",
      label: "List Frames",
      description: "Inspect rendered Smithers workflow frames for one run.",
      parameters: listFramesParamsSchema,
      visibility: "summary",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const frames = await options.manager.listFrames({
          runId: params.runId,
          limit: params.limit,
          afterFrameNo: params.afterFrameNo,
        });
        return {
          summary: `Loaded ${frames.length} Smithers frame(s).`,
          details: {
            runId: params.runId,
            frames,
          },
        };
      },
    }),
    createSmithersTool({
      name: "smithers.getDevToolsSnapshot",
      label: "DevTools Snapshot",
      description: "Read a Smithers DevTools graph snapshot for a workflow run.",
      parameters: getDevToolsSnapshotParamsSchema,
      visibility: "summary",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const snapshot = await options.manager.getDevToolsSnapshot({
          runId: params.runId,
          frameNo: params.frameNo,
        });
        return {
          summary: `Loaded DevTools snapshot for run ${params.runId} at frame ${snapshot.frameNo}.`,
          details: snapshot as Record<string, unknown>,
        };
      },
    }),
    createSmithersTool({
      name: "smithers.streamDevTools",
      label: "Stream DevTools",
      description:
        "Collect a bounded Smithers DevTools snapshot-plus-delta stream for workflow inspection.",
      parameters: streamDevToolsParamsSchema,
      visibility: "summary",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const stream = await options.manager.streamDevTools({
          runId: params.runId,
          fromSeq: params.fromSeq,
          timeoutMs: params.timeoutMs,
          maxEvents: params.maxEvents,
          pollIntervalMs: params.pollIntervalMs,
        });
        return {
          summary: `Loaded ${stream.events.length} DevTools event(s) for run ${params.runId}.`,
          details: stream,
        };
      },
    }),
    createSmithersTool({
      name: "smithers.runs.cancel",
      label: "Cancel Run",
      description: "Request cancellation for an active Smithers run.",
      parameters: getRunParamsSchema,
      visibility: "surface",
      runtime: options.runtime,
      store: options.store,
      execute: async (params) => {
        const result = await options.manager.cancelRun(params.runId);
        return {
          summary: `Cancellation requested for run ${params.runId}.`,
          details: result,
        };
      },
      afterExecute(input) {
        return {
          runId: input.params.runId,
          postStatus: "cancel-requested",
        };
      },
    }),
  ];
}

function createWorkflowLaunchTool(
  options: CreateSmithersToolsOptions,
  contract: RunnableWorkflowLaunchContract,
): AgentTool<any> {
  return createSmithersTool({
    name: contract.launchToolName,
    label: contract.label,
    description: `Launch or resume the ${contract.label} Smithers workflow entry under the current handler thread.`,
    parameters: contract.launchToolParameters,
    visibility: "surface",
    runtime: options.runtime,
    store: options.store,
    execute: async (params) => {
      const runtime = requireActiveRuntime(options.runtime, contract.launchToolName);
      const result = await options.manager.launchWorkflow({
        sessionId: runtime.sessionId,
        threadId: runtime.surfaceThreadId,
        workflowId: contract.workflowId,
        launchInput: params,
        commandId: "__pending__",
      });
      return {
        summary: result.summary,
        details: result,
      };
    },
    customizeCommand(command, params) {
      const mode =
        params &&
        typeof params === "object" &&
        Object.keys(params as Record<string, unknown>).length > 0
          ? "Launch or resume"
          : "Run";
      command.title = `${mode} ${contract.label} workflow`;
      command.summary = `Launch or resume runnable workflow ${contract.workflowId} in Smithers.`;
    },
    afterExecute(input) {
      return {
        semanticSmithersToolName: SMITHERS_RUN_WORKFLOW_TOOL_NAME,
        workflowId: contract.workflowId,
        launchToolName: contract.launchToolName,
        launchContractHash: contract.contractHash,
        sourceScope: contract.sourceScope,
        entryPath: contract.entryPath,
        definitionPaths: contract.definitionPaths,
        promptPaths: contract.promptPaths,
        componentPaths: contract.componentPaths,
        assetPaths: contract.assetPaths,
        launchInput: input.result.details.launchInput,
        preStatus: readRunStatus(input.before),
        postStatus: input.result.details.smithersStatus,
        runId: input.result.details.runId,
        workflowRunId: input.result.details.structuredWorkflowRunId,
        resumedRunId: input.result.details.resumedRunId,
      };
    },
    executeWithCommandId: async (params, commandId) => {
      const runtime = requireActiveRuntime(options.runtime, contract.launchToolName);
      const result = await options.manager.launchWorkflow({
        sessionId: runtime.sessionId,
        threadId: runtime.surfaceThreadId,
        workflowId: contract.workflowId,
        launchInput: params,
        commandId,
      });
      return {
        summary: result.summary,
        details: result,
      };
    },
  });
}

function createSmithersTool<TSchema extends TypeBoxSchema>(input: {
  name: `smithers.${string}`;
  label: string;
  description: string;
  parameters: TSchema;
  visibility: "summary" | "surface";
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
  execute: (
    params: Static<TSchema>,
  ) => Promise<{ summary: string; details: Record<string, unknown> }>;
  executeWithCommandId?: (
    params: Static<TSchema>,
    commandId: string,
  ) => Promise<{ summary: string; details: Record<string, unknown> }>;
  beforeExecute?: (input: {
    params: Static<TSchema>;
  }) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
  afterExecute?: (input: {
    params: Static<TSchema>;
    before: Record<string, unknown> | null;
    result: { summary: string; details: Record<string, unknown> };
  }) => Record<string, unknown> | null;
  customizeCommand?: (command: { title: string; summary: string }, params: Static<TSchema>) => void;
}): AgentTool<TSchema, Record<string, unknown>> {
  return {
    label: input.label,
    name: input.name,
    description: input.description,
    parameters: input.parameters,
    execute: async (_toolCallId, params) => {
      const runtime = requireActiveRuntime(input.runtime, input.name);
      input.store.setTurnDecision({
        turnId: runtime.turnId,
        decision: input.name,
        onlyIfPending: true,
      });
      ensureRunnableHandlerThread(input.store, runtime.sessionId, runtime.surfaceThreadId);
      const commandInput = {
        title: `Run ${input.name}`,
        summary: `Call ${input.name}.`,
      };
      input.customizeCommand?.(commandInput, params);
      const command = input.store.createCommand({
        turnId: runtime.turnId,
        surfacePiSessionId: runtime.surfacePiSessionId,
        threadId: runtime.surfaceThreadId,
        toolName: input.name,
        executor: "smithers",
        visibility: input.visibility,
        title: commandInput.title,
        summary: commandInput.summary,
      });
      input.store.startCommand(command.id);

      const before = (await input.beforeExecute?.({ params })) ?? null;
      const result = input.executeWithCommandId
        ? await input.executeWithCommandId(params, command.id)
        : await input.execute(params);
      const facts = {
        smithersToolName: input.name,
        semanticSmithersToolName: input.name,
        rawSmithersOperationName: input.name.replace(/^smithers\./, ""),
        transport: "embedded-runtime",
        args: params,
        ...input.afterExecute?.({ params, before, result }),
      };
      input.store.finishCommand({
        commandId: command.id,
        status: "succeeded",
        summary: result.summary,
        facts,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.details),
          },
        ],
        details: result.details,
      };
    },
  };
}

function requireActiveRuntime(
  runtimeHandle: PromptExecutionRuntimeHandle,
  toolName: string,
): NonNullable<PromptExecutionRuntimeHandle["current"]> & { surfaceThreadId: string } {
  const runtime = runtimeHandle.current;
  if (!runtime) {
    throw new Error(`${toolName} can only run during an active prompt.`);
  }
  if (runtime.surfaceKind !== "handler" || !runtime.surfaceThreadId) {
    throw new Error(`${toolName} can only run from a handler thread surface.`);
  }
  return runtime as NonNullable<PromptExecutionRuntimeHandle["current"]> & {
    surfaceThreadId: string;
  };
}

function ensureRunnableHandlerThread(
  store: StructuredSessionStateStore,
  sessionId: string,
  threadId: string,
): void {
  const snapshot = store.getSessionState(sessionId);
  const thread = snapshot.threads.find((entry) => entry.id === threadId);
  if (!thread) {
    return;
  }

  store.updateThread({
    threadId,
    status: "running-handler",
    wait: null,
  });

  if (
    snapshot.session.wait?.owner.kind === "thread" &&
    snapshot.session.wait.owner.threadId === threadId
  ) {
    store.clearSessionWait({ sessionId });
  }
}

function readRunStatus(run: Record<string, unknown> | null): string | null {
  return typeof run?.status === "string" ? run.status : null;
}
