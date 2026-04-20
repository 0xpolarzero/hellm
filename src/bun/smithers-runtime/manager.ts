import { SmithersDb } from "@smithers-orchestrator/db";
import {
  chatAttemptKey,
  parseChatAttemptMeta,
  parseNodeOutputEvent,
  selectChatAttempts,
} from "@smithers-orchestrator/cli/chat";
import { diagnoseRunEffect } from "@smithers-orchestrator/cli/why-diagnosis";
import { getDevToolsSnapshotRoute, streamDevToolsRoute } from "@smithers-orchestrator/server";
import {
  ensureSmithersTables,
  runWorkflow,
  signalRun,
  type RunStatus,
  type SmithersEvent,
} from "smithers-orchestrator";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { Effect } from "effect";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ExecuteTypescriptRunCommandInput,
  ExecuteTypescriptRunCommandResult,
  ExecuteTypescriptWebFetchResult,
  ExecuteTypescriptWebSearchResult,
} from "../execute-typescript-tool";
import { createBundledWorkflowRegistry, type BundledWorkflowDefinition } from "./registry";
import { createWorkflowTaskAgent } from "./workflow-task-agent";
import type {
  StructuredSessionStateStore,
  StructuredWaitKind,
  StructuredWorkflowRunRecord,
  StructuredWorkflowStatus,
} from "../structured-session-state";
import {
  compileBundledWorkflowLaunchContract,
  createWorkflowToolSurfaceVersion,
  type BundledWorkflowLaunchContract,
} from "./workflow-launch-contract";

type WorkflowTaskAgentDefaults = {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
};

type WorkflowMonitor = {
  id: string;
  sessionId: string;
  threadId: string;
  workflowId: string;
  abortController: AbortController;
  trackedRunIds: Set<string>;
};

type WorkflowOwnership = {
  sessionId: string;
  threadId: string;
  workflowId: string;
  structuredWorkflowId: string;
  commandId: string;
};

type SmithersRuntimeManagerOptions = {
  cwd: string;
  agentDir: string;
  store: StructuredSessionStateStore;
  getTaskAgentDefaults: () => WorkflowTaskAgentDefaults;
  onStructuredStateChanged?: (sessionId: string) => void | Promise<void>;
  onHandlerAttention?: (input: {
    sessionId: string;
    threadId: string;
    workflowRunId: string;
    smithersRunId: string;
    workflowId: string;
    summary: string;
    reason: string;
  }) => void | Promise<void>;
  runCommand?: (
    input: ExecuteTypescriptRunCommandInput,
  ) => Promise<ExecuteTypescriptRunCommandResult>;
  webSearch?: (input: {
    query: string;
    maxResults?: number;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebSearchResult>;
  fetchText?: (input: {
    url: string;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebFetchResult>;
};

type LaunchWorkflowInput = {
  sessionId: string;
  threadId: string;
  workflowId: string;
  launchInput: unknown;
  commandId: string;
  runId?: string;
};

type LaunchWorkflowResult = {
  workflowId: string;
  launchToolName: `smithers.run_workflow.${string}`;
  semanticToolName: "smithers.run_workflow";
  contractHash: string;
  launchInput: Record<string, unknown>;
  runId: string;
  structuredWorkflowRunId: string;
  status: StructuredWorkflowStatus;
  smithersStatus: RunStatus;
  summary: string;
};

export class SmithersRuntimeManager {
  private readonly runtimeRoot: string;
  private readonly runtimeArtifactDir: string;
  private readonly registry: BundledWorkflowDefinition[];
  private readonly workflowsById: Map<string, BundledWorkflowDefinition>;
  private readonly launchContractsByWorkflowId = new Map<string, BundledWorkflowLaunchContract>();
  private workflowLaunchContracts: BundledWorkflowLaunchContract[] = [];
  private workflowToolSurfaceVersion = "";
  private readonly db: SmithersDb;
  private readonly ownershipByRunId = new Map<string, WorkflowOwnership>();
  private readonly monitorByRunId = new Map<string, WorkflowMonitor>();
  private readonly flushPromiseByRunId = new Map<string, Promise<void>>();
  private readonly activeWorkflowPromises = new Set<Promise<void>>();

  constructor(private readonly options: SmithersRuntimeManagerOptions) {
    this.runtimeRoot = join(options.cwd, ".svvy", "smithers-runtime");
    this.runtimeArtifactDir = join(this.runtimeRoot, "artifacts");
    mkdirSync(this.runtimeArtifactDir, { recursive: true });

    this.registry = [];
    this.workflowsById = new Map();

    const bundledDefinitions = createBundledWorkflowRegistry({
      dbPath: join(this.runtimeRoot, "smithers.db"),
      createWorkflowTaskAgent: () =>
        createWorkflowTaskAgent({
          cwd: options.cwd,
          agentDir: options.agentDir,
          artifactDir: join(this.runtimeArtifactDir, "task-agent"),
          ...options.getTaskAgentDefaults(),
          runCommand: options.runCommand,
          webSearch: options.webSearch,
          fetchText: options.fetchText,
        }),
    });

    const primaryWorkflow = bundledDefinitions[0];
    if (!primaryWorkflow) {
      throw new Error("Expected at least one bundled Smithers workflow.");
    }
    ensureSmithersTables(primaryWorkflow.workflow.db as any);
    this.db = new SmithersDb(primaryWorkflow.workflow.db as any);

    for (const definition of bundledDefinitions) {
      this.upsertBundledWorkflow(definition);
    }
  }

  listWorkflows() {
    return this.workflowLaunchContracts.map((contract) => ({
      id: contract.workflowId,
      workflowName: contract.workflowName,
      label: contract.label,
      description: contract.description,
      launchToolName: contract.launchToolName,
      launchInputSchema: structuredClone(contract.launchInputJsonSchema),
      launchToolSchema: structuredClone(contract.launchToolJsonSchema),
      semanticToolName: contract.semanticToolName,
      resumeRunIdField: "resumeRunId",
      contractHash: contract.contractHash,
    }));
  }

  listWorkflowLaunchContracts(): BundledWorkflowLaunchContract[] {
    return this.workflowLaunchContracts.map((contract) => ({
      ...contract,
      launchInputJsonSchema: structuredClone(contract.launchInputJsonSchema),
      launchToolJsonSchema: structuredClone(contract.launchToolJsonSchema),
    }));
  }

  getWorkflowToolSurfaceVersion(): string {
    return this.workflowToolSurfaceVersion;
  }

  upsertBundledWorkflow(definition: BundledWorkflowDefinition): void {
    const existingIndex = this.registry.findIndex((workflow) => workflow.id === definition.id);
    if (existingIndex >= 0) {
      this.registry.splice(existingIndex, 1, definition);
    } else {
      this.registry.push(definition);
    }
    this.workflowsById.set(definition.id, definition);
    this.launchContractsByWorkflowId.set(
      definition.id,
      compileBundledWorkflowLaunchContract(definition),
    );
    this.workflowLaunchContracts = this.registry.map((workflow) => {
      const contract = this.launchContractsByWorkflowId.get(workflow.id);
      if (!contract) {
        throw new Error(`Bundled Smithers workflow contract not found: ${workflow.id}`);
      }
      return contract;
    });
    this.workflowToolSurfaceVersion = createWorkflowToolSurfaceVersion(
      this.workflowLaunchContracts,
    );
  }

  async launchWorkflow(input: LaunchWorkflowInput): Promise<LaunchWorkflowResult> {
    const definition = this.requireWorkflow(input.workflowId);
    const launchContract = this.requireWorkflowLaunchContract(input.workflowId);
    const parsedInput = definition.launchSchema.safeParse(input.launchInput);
    if (!parsedInput.success) {
      throw new Error(parsedInput.error.issues.map((issue) => issue.message).join("; "));
    }

    const existingRunId = input.runId?.trim() || undefined;
    if (!existingRunId) {
      await this.cancelSupersededThreadRuns(input.sessionId, input.threadId);
    }

    const runId = existingRunId ?? `smithers-${randomUUID()}`;
    const existingStructuredRun = this.findStructuredWorkflowRun({
      sessionId: input.sessionId,
      threadId: input.threadId,
      runId,
    });

    const structuredWorkflowRun = existingStructuredRun
      ? this.options.store.updateWorkflow({
          workflowId: existingStructuredRun.id,
          commandId: input.commandId,
          status: "running",
          smithersStatus: "running",
          waitKind: null,
          summary: `Launching ${definition.label}.`,
          heartbeatAt: null,
        })
      : this.options.store.recordWorkflow({
          threadId: input.threadId,
          commandId: input.commandId,
          smithersRunId: runId,
          workflowName: definition.workflowName,
          templateId: definition.id,
          status: "running",
          smithersStatus: "running",
          waitKind: null,
          continuedFromRunIds: [],
          activeDescendantRunId: null,
          lastEventSeq: -1,
          lastAttentionSeq: null,
          heartbeatAt: null,
          summary: `Launching ${definition.label}.`,
        });

    this.options.store.updateThread({
      threadId: input.threadId,
      status: "running-workflow",
      wait: null,
    });
    this.clearThreadOwnedSessionWait(input.sessionId, input.threadId);
    this.ownershipByRunId.set(runId, {
      sessionId: input.sessionId,
      threadId: input.threadId,
      workflowId: definition.id,
      structuredWorkflowId: structuredWorkflowRun.id,
      commandId: input.commandId,
    });

    const monitor = this.createMonitor({
      sessionId: input.sessionId,
      threadId: input.threadId,
      workflowId: definition.id,
      runId,
    });
    this.trackRunIdWithMonitor(monitor, runId);

    const workflowPromise = this.runWorkflowInBackground({
      definition,
      monitor,
      runId,
      input: parsedInput.data as Record<string, unknown>,
      resume: Boolean(existingRunId),
    });
    this.activeWorkflowPromises.add(workflowPromise);
    void workflowPromise.finally(() => {
      this.activeWorkflowPromises.delete(workflowPromise);
    });

    await this.emitStructuredStateChanged(input.sessionId);

    return {
      workflowId: definition.id,
      launchToolName: launchContract.launchToolName,
      semanticToolName: launchContract.semanticToolName,
      contractHash: launchContract.contractHash,
      launchInput: parsedInput.data as Record<string, unknown>,
      runId,
      structuredWorkflowRunId: structuredWorkflowRun.id,
      status: structuredWorkflowRun.status,
      smithersStatus: "running",
      summary: structuredWorkflowRun.summary,
    };
  }

  async listRuns(input?: { limit?: number; status?: string; workflowId?: string }) {
    const runs = await this.db.listRuns(input?.limit ?? 25, input?.status);
    const workflowName = input?.workflowId
      ? this.workflowsById.get(input.workflowId)?.workflowName
      : null;
    const ownershipByRunId = this.listStructuredRunOwnershipBySmithersRunId();
    return runs
      .filter((run: any) => (!workflowName ? true : run.workflowName === workflowName))
      .map((run: any) => {
        const ownership = ownershipByRunId.get(run.runId);
        return {
          runId: run.runId,
          workflowName: run.workflowName,
          status: run.status,
          sessionId: ownership?.sessionId ?? null,
          threadId: ownership?.threadId ?? null,
          createdAt: toIso(run.createdAtMs),
          startedAt: toIso(run.startedAtMs),
          finishedAt: toIso(run.finishedAtMs),
          heartbeatAt: toIso(run.heartbeatAtMs),
          summary: this.buildRunSummary(run),
        };
      });
  }

  async getRun(runId: string) {
    const run = await this.db.getRun(runId);
    if (!run) {
      throw new Error(`Smithers run not found: ${runId}`);
    }
    const workflowRun = this.findStructuredWorkflowRunBySmithersRunId(runId);
    return {
      runId: run.runId,
      workflowName: run.workflowName,
      status: run.status,
      createdAt: toIso(run.createdAtMs),
      startedAt: toIso(run.startedAtMs),
      finishedAt: toIso(run.finishedAtMs),
      heartbeatAt: toIso(run.heartbeatAtMs),
      summary: workflowRun?.summary ?? (await this.buildRunSummary(run)),
      structuredWorkflowRunId: workflowRun?.id ?? null,
      threadId: workflowRun?.threadId ?? null,
      continuedFromRunIds: workflowRun?.continuedFromRunIds ?? [],
      activeDescendantRunId: workflowRun?.activeDescendantRunId ?? null,
      waitKind: workflowRun?.waitKind ?? mapRunStatusToWaitKind(run.status),
      lastEventSeq: workflowRun?.lastEventSeq ?? -1,
      lastAttentionSeq: workflowRun?.lastAttentionSeq ?? null,
    };
  }

  async explainRun(runId: string) {
    const diagnosis = await this.getRunDiagnosis(runId);
    return {
      runId,
      status: diagnosis.status,
      summary: diagnosis.summary,
      explanation: diagnosis.summary,
      diagnosis,
    };
  }

  async watchRun(input: { runId: string; intervalMs?: number; timeoutMs?: number }) {
    const intervalMs = Math.max(500, input.intervalMs ?? 1_000);
    const timeoutMs = Math.max(0, input.timeoutMs ?? 30_000);
    const deadline = Date.now() + timeoutMs;
    const snapshots: Array<{
      observedAtMs: number;
      run: Awaited<ReturnType<SmithersRuntimeManager["getRun"]>>;
    }> = [];
    let pollCount = 0;

    while (true) {
      const run = await this.getRun(input.runId);
      snapshots.push({
        observedAtMs: Date.now(),
        run,
      });

      if (isTerminalRunStatus(run.status)) {
        return {
          runId: input.runId,
          intervalMs,
          pollCount,
          reachedTerminal: true,
          timedOut: false,
          finalRun: run,
          snapshots,
        };
      }

      if (Date.now() >= deadline) {
        return {
          runId: input.runId,
          intervalMs,
          pollCount,
          reachedTerminal: false,
          timedOut: true,
          finalRun: run,
          snapshots,
        };
      }

      pollCount += 1;
      await sleep(intervalMs);
    }
  }

  async listPendingApprovals(input?: {
    runId?: string;
    workflowName?: string;
    nodeId?: string;
  }) {
    const allApprovals = input?.runId
      ? await this.db.listPendingApprovals(input.runId)
      : await this.db.listAllPendingApprovals();
    const approvals = allApprovals.filter((approval: any) => {
      if (input?.workflowName?.trim() && approval.workflowName !== input.workflowName.trim()) {
        return false;
      }
      if (input?.nodeId?.trim() && approval.nodeId !== input.nodeId.trim()) {
        return false;
      }
      return true;
    });
    return approvals.map((approval: any) => ({
      runId: approval.runId,
      nodeId: approval.nodeId,
      iteration: approval.iteration,
      status: approval.status,
      requestedAt: toIso(approval.requestedAtMs),
      note: approval.note ?? null,
      decidedBy: approval.decidedBy ?? null,
      workflowName: approval.workflowName ?? null,
      runStatus: approval.runStatus ?? null,
      nodeLabel: approval.nodeLabel ?? null,
    }));
  }

  async resolveApproval(input: {
    runId: string;
    nodeId: string;
    iteration?: number;
    decision: "approve" | "deny";
    note?: string;
  }) {
    const iteration = input.iteration ?? 0;
    const run = await this.db.getRun(input.runId);
    if (!run) {
      throw new Error(`Smithers run not found: ${input.runId}`);
    }

    const approval = await this.db.getApproval(input.runId, input.nodeId, iteration);
    if (!approval) {
      throw new Error(
        `Pending approval not found for ${input.runId}/${input.nodeId}#${iteration}.`,
      );
    }

    const timestampMs = Date.now();
    const node = await this.db.getNode(input.runId, input.nodeId, iteration);
    await this.db.insertOrUpdateApproval({
      runId: input.runId,
      nodeId: input.nodeId,
      iteration,
      status: input.decision === "approve" ? "approved" : "denied",
      requestedAtMs: null,
      decidedAtMs: timestampMs,
      note: input.note ?? null,
      decidedBy: "svvy-handler",
    });
    await this.db.insertNode({
      runId: input.runId,
      nodeId: input.nodeId,
      iteration,
      state: input.decision === "approve" ? "pending" : "failed",
      lastAttempt: node?.lastAttempt ?? null,
      updatedAtMs: timestampMs,
      outputTable: node?.outputTable ?? "",
      label: node?.label ?? null,
    });
    await this.db.insertEventWithNextSeq({
      runId: input.runId,
      timestampMs,
      type: input.decision === "approve" ? "ApprovalGranted" : "ApprovalDenied",
      payloadJson: JSON.stringify({
        type: input.decision === "approve" ? "ApprovalGranted" : "ApprovalDenied",
        runId: input.runId,
        nodeId: input.nodeId,
        iteration,
        timestampMs,
      }),
    });
    if (run.status === "waiting-approval" || run.status === "waiting-event") {
      const pendingApprovals = await this.db.listPendingApprovals(input.runId);
      await this.db.updateRun(input.runId, {
        status: pendingApprovals.length > 0 ? "waiting-approval" : "waiting-event",
      });
    }
    await this.flushRunEvents(input.runId);
    return {
      ok: true,
      decision: input.decision,
      runId: input.runId,
      nodeId: input.nodeId,
      iteration,
    };
  }

  async getNodeDetail(input: { runId: string; nodeId: string; iteration?: number }) {
    const iterations = await this.db.listNodeIterations(input.runId, input.nodeId);
    const iteration = input.iteration ?? iterations[0]?.iteration ?? 0;
    const node = await this.db.getNode(input.runId, input.nodeId, iteration);
    if (!node) {
      throw new Error(`Smithers node not found: ${input.runId}/${input.nodeId}#${iteration}`);
    }

    const attempts = await this.db.listAttempts(input.runId, input.nodeId, iteration);
    const toolCalls = await this.db.listToolCalls(input.runId, input.nodeId, iteration);
    const output =
      typeof node.outputTable === "string" && node.outputTable.trim().length > 0
        ? await this.db.getRawNodeOutputForIteration(
            node.outputTable,
            input.runId,
            input.nodeId,
            iteration,
          )
        : null;

    return {
      runId: input.runId,
      nodeId: input.nodeId,
      iteration,
      node,
      attempts,
      toolCalls,
      output,
    };
  }

  async listArtifacts(input: { runId: string; limit?: number }) {
    const nodes = await this.db.listNodes(input.runId);
    const frames = await this.db.listFrames(input.runId, input.limit ?? 10);
    const outputs = await Promise.all(
      nodes
        .filter((node: any) => typeof node.outputTable === "string" && node.outputTable.length > 0)
        .map(async (node: any) => ({
          nodeId: node.nodeId,
          iteration: node.iteration,
          outputTable: node.outputTable,
          output: await this.db.getRawNodeOutputForIteration(
            node.outputTable,
            input.runId,
            node.nodeId,
            node.iteration ?? 0,
          ),
        })),
    );

    return {
      runId: input.runId,
      outputs,
      frames,
    };
  }

  async getChatTranscript(input: {
    runId: string;
    all?: boolean;
    includeStderr?: boolean;
    tail?: number;
  }) {
    const run = await this.db.getRun(input.runId);
    if (!run) {
      throw new Error(`Smithers run not found: ${input.runId}`);
    }

    const attempts = await this.db.listAttemptsForRun(input.runId);
    const events = await listAllRunEvents(this.db, input.runId);
    const knownOutputAttemptKeys = new Set<string>();
    const parsedOutputs = events
      .map((event) => parseNodeOutputEvent(event as any))
      .filter(Boolean);

    for (const event of parsedOutputs) {
      knownOutputAttemptKeys.add(chatAttemptKey(event as any));
    }

    const selectedAttempts = selectChatAttempts(
      attempts as any,
      knownOutputAttemptKeys,
      Boolean(input.all),
    );
    const selectedAttemptKeys = new Set(
      selectedAttempts.map((attempt: any) => chatAttemptKey(attempt)),
    );
    const stdoutSeenAttempts = new Set<string>();
    const messages: Array<Record<string, unknown>> = [];

    for (const attempt of selectedAttempts) {
      const attemptKey = chatAttemptKey(attempt as any);
      const meta = parseChatAttemptMeta(attempt.metaJson);
      const prompt = typeof meta.prompt === "string" ? meta.prompt.trim() : "";
      if (!prompt) {
        continue;
      }
      messages.push({
        id: `prompt:${attemptKey}`,
        attemptKey,
        nodeId: attempt.nodeId,
        iteration: attempt.iteration ?? 0,
        attempt: attempt.attempt,
        role: "user",
        stream: null,
        timestampMs: attempt.startedAtMs,
        text: prompt,
        source: "prompt",
      });
    }

    for (const parsedEvent of parsedOutputs) {
      const attemptKey = chatAttemptKey(parsedEvent as any);
      if (!selectedAttemptKeys.has(attemptKey)) {
        continue;
      }
      const stream = parsedEvent?.stream === "stderr" ? "stderr" : "stdout";
      if (stream === "stderr" && input.includeStderr === false) {
        continue;
      }
      if (stream === "stdout") {
        stdoutSeenAttempts.add(attemptKey);
      }
      messages.push({
        id: `event:${parsedEvent?.seq ?? "unknown"}`,
        attemptKey,
        nodeId: parsedEvent?.nodeId ?? "",
        iteration: parsedEvent?.iteration ?? 0,
        attempt: parsedEvent?.attempt ?? 1,
        role: stream === "stderr" ? "stderr" : "assistant",
        stream,
        timestampMs: parsedEvent?.timestampMs ?? Date.now(),
        text: parsedEvent?.text ?? "",
        source: "event",
      });
    }

    for (const attempt of selectedAttempts) {
      const attemptKey = chatAttemptKey(attempt as any);
      const responseText =
        typeof attempt.responseText === "string" ? attempt.responseText.trim() : "";
      if (!responseText || stdoutSeenAttempts.has(attemptKey)) {
        continue;
      }
      messages.push({
        id: `response:${attemptKey}`,
        attemptKey,
        nodeId: attempt.nodeId,
        iteration: attempt.iteration ?? 0,
        attempt: attempt.attempt,
        role: "assistant",
        stream: null,
        timestampMs: attempt.finishedAtMs ?? attempt.startedAtMs ?? Date.now(),
        text: responseText,
        source: "responseText",
      });
    }

    messages.sort((left, right) => {
      const leftTimestamp = Number(left.timestampMs ?? 0);
      const rightTimestamp = Number(right.timestampMs ?? 0);
      if (leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp;
      }
      return String(left.id ?? "").localeCompare(String(right.id ?? ""));
    });

    return {
      runId: input.runId,
      attempts: selectedAttempts.map((attempt: any) => ({
        attemptKey: chatAttemptKey(attempt),
        nodeId: attempt.nodeId,
        iteration: attempt.iteration ?? 0,
        attempt: attempt.attempt,
        state: attempt.state,
        startedAtMs: attempt.startedAtMs,
        finishedAtMs: attempt.finishedAtMs ?? null,
        cached: Boolean(attempt.cached),
        meta: parseJson(attempt.metaJson),
      })),
      messages:
        typeof input.tail === "number" ? messages.slice(-Math.max(1, input.tail)) : messages,
    };
  }

  async getRunEvents(input: {
    runId: string;
    afterSeq?: number;
    limit?: number;
    nodeId?: string;
    types?: string[];
    sinceTimestampMs?: number;
  }) {
    const events = await this.db.listEventHistory(input.runId, {
      afterSeq: input.afterSeq,
      limit: input.limit ?? 200,
      nodeId: input.nodeId,
      types: input.types,
      sinceTimestampMs: input.sinceTimestampMs,
    });
    return events.map((event: any) => ({
      seq: event.seq,
      timestampMs: event.timestampMs,
      type: event.type,
      payload: parseJson(event.payloadJson),
    }));
  }

  async sendSignal(input: {
    runId: string;
    signalName: string;
    data?: unknown;
    correlationId?: string;
  }) {
    const delivered = await Effect.runPromise(
      signalRun(this.db, input.runId, input.signalName, input.data ?? {}, {
        correlationId: input.correlationId ?? null,
        receivedBy: "svvy-handler",
      }),
    );
    await this.flushRunEvents(input.runId);
    const run = await this.getRun(input.runId).catch(() => null);
    return {
      ok: true,
      runId: input.runId,
      signalName: delivered.signalName,
      seq: delivered.seq,
      correlationId: delivered.correlationId,
      receivedAtMs: delivered.receivedAtMs,
      receivedAt: toIso(delivered.receivedAtMs),
      run,
    };
  }

  async listFrames(input: { runId: string; limit?: number; afterFrameNo?: number }) {
    const run = await this.db.getRun(input.runId);
    if (!run) {
      throw new Error(`Smithers run not found: ${input.runId}`);
    }

    const frames = await this.db.listFrames(input.runId, input.limit ?? 50, input.afterFrameNo);
    return frames.map((frame: any) => mapFrameRow(frame));
  }

  async getDevToolsSnapshot(input: { runId: string; frameNo?: number }) {
    return await getDevToolsSnapshotRoute({
      adapter: this.db as any,
      runId: input.runId,
      frameNo: input.frameNo,
    });
  }

  async streamDevTools(input: {
    runId: string;
    fromSeq?: number;
    timeoutMs?: number;
    maxEvents?: number;
    pollIntervalMs?: number;
  }) {
    const timeoutMs = Math.max(1, input.timeoutMs ?? 500);
    const maxEvents = Math.max(1, input.maxEvents ?? 25);
    const abortController = new AbortController();
    let endReason: "timeout" | "max-events" | "stream-closed" = "stream-closed";
    const timeoutId = setTimeout(() => {
      endReason = "timeout";
      abortController.abort();
    }, timeoutMs);
    const events: Array<Record<string, unknown>> = [];

    try {
      for await (const event of streamDevToolsRoute({
        adapter: this.db as any,
        runId: input.runId,
        fromSeq: input.fromSeq,
        pollIntervalMs: input.pollIntervalMs,
        signal: abortController.signal,
      })) {
        events.push(event as Record<string, unknown>);
        if (events.length >= maxEvents) {
          endReason = "max-events";
          break;
        }
      }
    } finally {
      clearTimeout(timeoutId);
      abortController.abort();
    }

    const lastEvent = events[events.length - 1] as
      | {
          kind?: string;
          delta?: { seq?: number };
          snapshot?: { seq?: number };
        }
      | undefined;
    const lastSeq =
      lastEvent?.kind === "delta"
        ? Number(lastEvent.delta?.seq ?? 0)
        : Number(lastEvent?.snapshot?.seq ?? 0);

    return {
      runId: input.runId,
      fromSeq: input.fromSeq ?? null,
      timeoutMs,
      maxEvents,
      endReason,
      lastSeq: Number.isFinite(lastSeq) ? lastSeq : null,
      events,
    };
  }

  async cancelRun(runId: string) {
    await this.db.requestRunCancel(runId, Date.now());
    const monitor = this.monitorByRunId.get(runId);
    monitor?.abortController.abort();
    await this.flushRunEvents(runId);
    return {
      ok: true,
      runId,
    };
  }

  async reconcileThreadOwnedWorkflowsBeforeHandoff(
    sessionId: string,
    threadId: string,
  ): Promise<void> {
    // thread.handoff closes the current objective span, so first pull any durable Smithers
    // state that may already have reached a terminal outcome but has not yet been projected
    // into svvy's structured state.
    const candidateRuns = this.options.store
      .getSessionState(sessionId)
      .workflowRuns.filter(
        (workflowRun) =>
          workflowRun.threadId === threadId &&
          (workflowRun.status === "running" ||
            workflowRun.status === "waiting" ||
            workflowRun.status === "continued"),
      );

    for (const workflowRun of candidateRuns) {
      await this.flushRunEvents(workflowRun.smithersRunId, { emitAttention: false });
    }
  }

  async close(): Promise<void> {
    const seen = new Set<WorkflowMonitor>();
    for (const monitor of this.monitorByRunId.values()) {
      if (seen.has(monitor)) {
        continue;
      }
      seen.add(monitor);
      monitor.abortController.abort();
    }

    if (this.activeWorkflowPromises.size > 0) {
      await Promise.allSettled(Array.from(this.activeWorkflowPromises));
    }

    this.monitorByRunId.clear();
    this.ownershipByRunId.clear();
  }

  private createMonitor(input: {
    sessionId: string;
    threadId: string;
    workflowId: string;
    runId: string;
  }): WorkflowMonitor {
    return {
      id: `smithers-monitor-${randomUUID()}`,
      sessionId: input.sessionId,
      threadId: input.threadId,
      workflowId: input.workflowId,
      abortController: new AbortController(),
      trackedRunIds: new Set([input.runId]),
    };
  }

  private trackRunIdWithMonitor(monitor: WorkflowMonitor, runId: string): void {
    monitor.trackedRunIds.add(runId);
    this.monitorByRunId.set(runId, monitor);
  }

  private async runWorkflowInBackground(input: {
    definition: BundledWorkflowDefinition;
    monitor: WorkflowMonitor;
    runId: string;
    input: Record<string, unknown>;
    resume: boolean;
  }) {
    try {
      await Effect.runPromise(
        runWorkflow(input.definition.workflow, {
          runId: input.runId,
          input: input.input,
          resume: input.resume,
          rootDir: this.options.cwd,
          signal: input.monitor.abortController.signal,
          onProgress: (event: SmithersEvent) => {
            void this.handleProgressEvent(input.monitor, event);
          },
        }),
      );
    } catch (error) {
      if (!input.monitor.abortController.signal.aborted) {
        await this.captureUnexpectedWorkflowFailure(input.runId, error);
      }
    } finally {
      await Promise.all(
        Array.from(input.monitor.trackedRunIds).map(async (runId) => {
          await this.flushRunEvents(runId);
        }),
      );
    }
  }

  private async handleProgressEvent(monitor: WorkflowMonitor, event: SmithersEvent) {
    if (event.type === "RunContinuedAsNew") {
      await this.ensureContinuedRunOwnership({
        monitor,
        parentRunId: event.runId,
        childRunId: event.newRunId,
      });
    }
    await this.flushRunEvents(event.runId);
  }

  private async ensureContinuedRunOwnership(input: {
    monitor: WorkflowMonitor;
    parentRunId: string;
    childRunId: string;
  }) {
    if (this.ownershipByRunId.has(input.childRunId)) {
      this.trackRunIdWithMonitor(input.monitor, input.childRunId);
      return;
    }

    const parentOwnership = this.ownershipByRunId.get(input.parentRunId);
    if (!parentOwnership) {
      return;
    }
    const parentWorkflowRun = this.options.store
      .getSessionState(parentOwnership.sessionId)
      .workflowRuns.find((workflowRun) => workflowRun.id === parentOwnership.structuredWorkflowId);
    const childStructuredRun = this.options.store.recordWorkflow({
      threadId: parentOwnership.threadId,
      commandId: parentOwnership.commandId,
      smithersRunId: input.childRunId,
      workflowName: parentWorkflowRun?.workflowName ?? parentOwnership.workflowId,
      templateId: parentWorkflowRun?.templateId ?? parentOwnership.workflowId,
      presetId: parentWorkflowRun?.presetId ?? null,
      status: "running",
      smithersStatus: "running",
      waitKind: null,
      continuedFromRunIds: [
        ...(parentWorkflowRun?.continuedFromRunIds ?? []),
        parentOwnership.structuredWorkflowId,
      ],
      activeDescendantRunId: null,
      lastEventSeq: -1,
      lastAttentionSeq: null,
      heartbeatAt: null,
      summary: `Continuing ${parentWorkflowRun?.workflowName ?? parentOwnership.workflowId} as a new Smithers run.`,
    });
    this.options.store.updateWorkflow({
      workflowId: parentOwnership.structuredWorkflowId,
      commandId: parentOwnership.commandId,
      status: "continued",
      smithersStatus: "continued",
      activeDescendantRunId: childStructuredRun.id,
      summary: `Smithers continued this workflow as run ${input.childRunId}.`,
    });
    this.ownershipByRunId.set(input.childRunId, {
      ...parentOwnership,
      structuredWorkflowId: childStructuredRun.id,
    });
    this.trackRunIdWithMonitor(input.monitor, input.childRunId);
  }

  private async flushRunEvents(
    runId: string,
    options: {
      emitAttention?: boolean;
    } = {},
  ): Promise<void> {
    const existing = this.flushPromiseByRunId.get(runId);
    if (existing) {
      await existing;
      return;
    }

    const flushPromise = (async () => {
      const ownership = this.ownershipByRunId.get(runId);
      if (!ownership) {
        return;
      }

      const structuredRun = this.findStructuredWorkflowRunById(
        ownership.sessionId,
        ownership.structuredWorkflowId,
      );
      const afterSeq = structuredRun?.lastEventSeq ?? -1;
      const events = await this.db.listEvents(runId, afterSeq, 200);
      let lastEventSeq = afterSeq;
      let attentionSeq = structuredRun?.lastAttentionSeq ?? null;
      let attentionReason: string | null = null;

      for (const eventRow of events) {
        lastEventSeq = Math.max(lastEventSeq, Number(eventRow.seq ?? lastEventSeq));
        const event = parseJson(eventRow.payloadJson) as SmithersEvent | null;
        if (!event) {
          continue;
        }
        if (requiresHandlerAttention(event)) {
          attentionSeq = Number(eventRow.seq);
          attentionReason = describeAttentionEvent(event);
        }
      }

      await this.refreshStructuredProjection(
        runId,
        {
          lastEventSeq,
          lastAttentionSeq: attentionSeq,
          attentionReason,
        },
        {
          emitAttention: options.emitAttention ?? true,
        },
      );
    })().finally(() => {
      this.flushPromiseByRunId.delete(runId);
    });

    this.flushPromiseByRunId.set(runId, flushPromise);
    await flushPromise;
  }

  private async refreshStructuredProjection(
    runId: string,
    input: {
      lastEventSeq: number;
      lastAttentionSeq: number | null;
      attentionReason: string | null;
    },
    options: {
      emitAttention: boolean;
    },
  ) {
    const ownership = this.ownershipByRunId.get(runId);
    if (!ownership) {
      return;
    }
    const run = await this.db.getRun(runId);
    if (!run) {
      return;
    }

    const currentWorkflowRun = this.findStructuredWorkflowRunById(
      ownership.sessionId,
      ownership.structuredWorkflowId,
    );
    const status = mapRunStatusToWorkflowStatus(run.status);
    const diagnosis = run.status === "waiting-event" ? await this.getRunDiagnosis(runId) : null;
    const waitKind =
      diagnosis && containsSignalBlocker(diagnosis)
        ? "signal"
        : mapRunStatusToWaitKind(run.status);
    const summary = diagnosis?.summary ?? (await this.buildRunSummary(run));
    const heartbeatAt = toIso(run.heartbeatAtMs);
    const nextWorkflowRun = this.options.store.updateWorkflow({
      workflowId: ownership.structuredWorkflowId,
      commandId: ownership.commandId,
      status,
      smithersStatus: run.status,
      waitKind,
      lastEventSeq: input.lastEventSeq,
      lastAttentionSeq:
        input.lastAttentionSeq !== null && input.attentionReason
          ? input.lastAttentionSeq
          : (currentWorkflowRun?.lastAttentionSeq ?? null),
      heartbeatAt,
      summary,
    });

    this.applyThreadProjection({
      sessionId: ownership.sessionId,
      threadId: ownership.threadId,
      workflowRun: nextWorkflowRun,
    });
    await this.emitStructuredStateChanged(ownership.sessionId);

    const currentThread =
      this.options.store
        .getSessionState(ownership.sessionId)
        .threads.find((thread) => thread.id === ownership.threadId) ?? null;
    const isReplayedTerminalStateAfterHandoff = isTerminalWorkflowReplayAfterThreadCompletion(
      currentThread?.status ?? null,
      nextWorkflowRun.status,
    );

    if (
      options.emitAttention &&
      !isReplayedTerminalStateAfterHandoff &&
      input.attentionReason &&
      input.lastAttentionSeq !== null &&
      input.lastAttentionSeq !== currentWorkflowRun?.lastAttentionSeq
    ) {
      await this.options.onHandlerAttention?.({
        sessionId: ownership.sessionId,
        threadId: ownership.threadId,
        workflowRunId: nextWorkflowRun.id,
        smithersRunId: runId,
        workflowId: ownership.workflowId,
        summary,
        reason: input.attentionReason,
      });
    }
  }

  private applyThreadProjection(input: {
    sessionId: string;
    threadId: string;
    workflowRun: StructuredWorkflowRunRecord;
  }) {
    const currentThread =
      this.options.store
        .getSessionState(input.sessionId)
        .threads.find((thread) => thread.id === input.threadId) ?? null;
    const { workflowRun } = input;
    if (
      isTerminalWorkflowReplayAfterThreadCompletion(
        currentThread?.status ?? null,
        workflowRun.status,
      )
    ) {
      // The same terminal Smithers state can be observed more than once through the live
      // progress callback, the monitor's final flush, or later recovery reads. Once the
      // handler has reconciled that terminal result and closed the span with thread.handoff,
      // replaying it must not reopen the thread.
      this.clearThreadOwnedSessionWait(input.sessionId, input.threadId);
      return;
    }

    switch (workflowRun.status) {
      case "running":
        this.options.store.updateThread({
          threadId: input.threadId,
          status: "running-workflow",
          wait: null,
        });
        this.clearThreadOwnedSessionWait(input.sessionId, input.threadId);
        break;
      case "waiting": {
        const wait = {
          owner: "workflow" as const,
          kind: workflowRun.waitKind ?? "external",
          reason: workflowRun.summary,
          resumeWhen: describeWaitResumeWhen(workflowRun.waitKind),
          since: workflowRun.updatedAt,
        };
        this.options.store.updateThread({
          threadId: input.threadId,
          status: "waiting",
          wait,
        });
        try {
          this.options.store.setSessionWait({
            sessionId: input.sessionId,
            owner: {
              kind: "thread",
              threadId: input.threadId,
            },
            kind: wait.kind,
            reason: wait.reason,
            resumeWhen: wait.resumeWhen,
          });
        } catch {
          // Another runnable thread still exists; keep the thread-local wait only.
        }
        break;
      }
      case "continued":
        this.options.store.updateThread({
          threadId: input.threadId,
          status: "troubleshooting",
          wait: null,
        });
        this.clearThreadOwnedSessionWait(input.sessionId, input.threadId);
        break;
      case "completed":
        // Workflow completion returns control to the handler. The delegated objective stays
        // active until the handler explicitly closes the current span with thread.handoff.
        this.options.store.updateThread({
          threadId: input.threadId,
          status: "running-handler",
          wait: null,
        });
        this.clearThreadOwnedSessionWait(input.sessionId, input.threadId);
        break;
      case "failed":
      case "cancelled":
        this.options.store.updateThread({
          threadId: input.threadId,
          status: "troubleshooting",
          wait: null,
        });
        this.clearThreadOwnedSessionWait(input.sessionId, input.threadId);
        break;
    }
  }

  private async captureUnexpectedWorkflowFailure(runId: string, error: unknown) {
    const ownership = this.ownershipByRunId.get(runId);
    if (!ownership) {
      return;
    }
    const message =
      error instanceof Error ? error.message : "The bundled Smithers workflow failed unexpectedly.";
    this.options.store.updateWorkflow({
      workflowId: ownership.structuredWorkflowId,
      commandId: ownership.commandId,
      status: "failed",
      smithersStatus: "failed",
      summary: message,
    });
    this.options.store.updateThread({
      threadId: ownership.threadId,
      status: "troubleshooting",
      wait: null,
    });
    this.clearThreadOwnedSessionWait(ownership.sessionId, ownership.threadId);
    await this.emitStructuredStateChanged(ownership.sessionId);
    await this.options.onHandlerAttention?.({
      sessionId: ownership.sessionId,
      threadId: ownership.threadId,
      workflowRunId: ownership.structuredWorkflowId,
      smithersRunId: runId,
      workflowId: ownership.workflowId,
      summary: message,
      reason: "The supervised Smithers workflow failed unexpectedly.",
    });
  }

  private async cancelSupersededThreadRuns(sessionId: string, threadId: string) {
    const snapshot = this.options.store.getSessionState(sessionId);
    const activeRuns = snapshot.workflowRuns.filter(
      (workflowRun) =>
        workflowRun.threadId === threadId &&
        (workflowRun.status === "running" || workflowRun.status === "waiting"),
    );
    for (const workflowRun of activeRuns) {
      await this.db.requestRunCancel(workflowRun.smithersRunId, Date.now());
      const monitor = this.monitorByRunId.get(workflowRun.smithersRunId);
      monitor?.abortController.abort();
    }
  }

  private clearThreadOwnedSessionWait(sessionId: string, threadId: string) {
    const wait = this.options.store.getSessionState(sessionId).session.wait;
    if (wait?.owner.kind === "thread" && wait.owner.threadId === threadId) {
      this.options.store.clearSessionWait({ sessionId });
    }
  }

  private async emitStructuredStateChanged(sessionId: string) {
    await this.options.onStructuredStateChanged?.(sessionId);
  }

  private async getRunDiagnosis(runId: string): Promise<any> {
    return await Effect.runPromise(diagnoseRunEffect(this.db as any, runId));
  }

  private requireWorkflow(workflowId: string): BundledWorkflowDefinition {
    const workflow = this.workflowsById.get(workflowId);
    if (!workflow) {
      throw new Error(`Bundled Smithers workflow not found: ${workflowId}`);
    }
    return workflow;
  }

  private requireWorkflowLaunchContract(workflowId: string): BundledWorkflowLaunchContract {
    const contract = this.launchContractsByWorkflowId.get(workflowId);
    if (!contract) {
      throw new Error(`Bundled Smithers workflow contract not found: ${workflowId}`);
    }
    return contract;
  }

  private findStructuredWorkflowRun(input: {
    sessionId: string;
    threadId: string;
    runId: string;
  }): StructuredWorkflowRunRecord | null {
    return (
      this.options.store
        .getSessionState(input.sessionId)
        .workflowRuns.find(
          (workflowRun) =>
            workflowRun.threadId === input.threadId && workflowRun.smithersRunId === input.runId,
        ) ?? null
    );
  }

  private findStructuredWorkflowRunBySmithersRunId(
    runId: string,
  ): StructuredWorkflowRunRecord | null {
    const ownership = this.ownershipByRunId.get(runId);
    if (!ownership) {
      return null;
    }
    return this.findStructuredWorkflowRunById(ownership.sessionId, ownership.structuredWorkflowId);
  }

  private findStructuredWorkflowRunById(
    sessionId: string,
    workflowRunId: string,
  ): StructuredWorkflowRunRecord | null {
    return (
      this.options.store
        .getSessionState(sessionId)
        .workflowRuns.find((workflowRun) => workflowRun.id === workflowRunId) ?? null
    );
  }

  private listStructuredRunOwnershipBySmithersRunId(): Map<
    string,
    Pick<StructuredWorkflowRunRecord, "sessionId" | "threadId">
  > {
    const ownershipByRunId = new Map<
      string,
      Pick<StructuredWorkflowRunRecord, "sessionId" | "threadId">
    >();
    for (const session of this.options.store.listSessionStates()) {
      for (const workflowRun of session.workflowRuns) {
        if (ownershipByRunId.has(workflowRun.smithersRunId)) {
          continue;
        }
        ownershipByRunId.set(workflowRun.smithersRunId, {
          sessionId: workflowRun.sessionId,
          threadId: workflowRun.threadId,
        });
      }
    }
    return ownershipByRunId;
  }

  private async buildRunSummary(run: any): Promise<string> {
    const nodeCounts = await this.db.countNodesByState(run.runId);
    const countsText = nodeCounts.map((entry: any) => `${entry.count} ${entry.state}`).join(", ");
    const parts = [`${run.workflowName} is ${describeRunStatus(run.status)}`];
    if (countsText) {
      parts.push(countsText);
    }
    return `${parts.join("; ")}.`;
  }
}

function mapRunStatusToWorkflowStatus(status: RunStatus): StructuredWorkflowStatus {
  switch (status) {
    case "running":
      return "running";
    case "waiting-approval":
    case "waiting-event":
    case "waiting-timer":
      return "waiting";
    case "continued":
      return "continued";
    case "finished":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

function mapRunStatusToWaitKind(status: RunStatus): StructuredWaitKind | null {
  switch (status) {
    case "waiting-approval":
      return "approval";
    case "waiting-event":
      return "external";
    case "waiting-timer":
      return "timer";
    default:
      return null;
  }
}

function requiresHandlerAttention(event: SmithersEvent): boolean {
  switch (event.type) {
    case "RunFinished":
    case "RunFailed":
    case "RunCancelled":
    case "RunContinuedAsNew":
    case "ApprovalRequested":
      return true;
    case "RunStatusChanged":
      return event.status === "waiting-approval" || event.status === "waiting-event";
    default:
      return false;
  }
}

function describeAttentionEvent(event: SmithersEvent): string {
  switch (event.type) {
    case "RunFinished":
      return "The supervised workflow finished and the handler must reconcile the result.";
    case "RunFailed":
      return "The supervised workflow failed and the handler must troubleshoot it.";
    case "RunCancelled":
      return "The supervised workflow was cancelled and the handler must decide what to do next.";
    case "RunContinuedAsNew":
      return "Smithers continued the workflow as a new run and the handler must keep supervising it.";
    case "ApprovalRequested":
      return "The supervised workflow is waiting on approval.";
    case "RunStatusChanged":
      return event.status === "waiting-approval"
        ? "The supervised workflow is waiting on approval."
        : "The supervised workflow is waiting on an external event or signal.";
    default:
      return "The supervised workflow needs handler attention.";
  }
}

function containsSignalBlocker(diagnosis: any): boolean {
  return Array.isArray(diagnosis?.blockers)
    ? diagnosis.blockers.some(
        (blocker: any) =>
          typeof blocker?.signalName === "string" && blocker.signalName.trim().length > 0,
      )
    : false;
}

function describeRunStatus(status: RunStatus): string {
  switch (status) {
    case "waiting-approval":
      return "waiting for approval";
    case "waiting-event":
      return "waiting for an external event";
    case "waiting-timer":
      return "waiting on a timer";
    case "finished":
      return "completed";
    default:
      return status;
  }
}

function describeWaitResumeWhen(waitKind: StructuredWaitKind | null): string {
  switch (waitKind) {
    case "approval":
      return "Resume when the approval is resolved.";
    case "timer":
      return "Resume when the timer fires.";
    case "signal":
      return "Resume when the signal arrives.";
    default:
      return "Resume when the workflow can make forward progress again.";
  }
}

function isTerminalWorkflowStatus(status: StructuredWorkflowStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isTerminalRunStatus(status: string): boolean {
  return status === "finished" || status === "failed" || status === "cancelled";
}

function isTerminalWorkflowReplayAfterThreadCompletion(
  threadStatus: string | null,
  workflowStatus: StructuredWorkflowStatus,
): boolean {
  return threadStatus === "completed" && isTerminalWorkflowStatus(workflowStatus);
}

function parseJson(value: string | null | undefined): any {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toIso(timestampMs: number | null | undefined): string | null {
  return typeof timestampMs === "number" ? new Date(timestampMs).toISOString() : null;
}

function mapFrameRow(frame: {
  runId: string;
  frameNo: number;
  createdAtMs: number;
  xmlJson: string;
  xmlHash: string;
  encoding: string;
  mountedTaskIdsJson: string | null;
  taskIndexJson: string | null;
  note: string | null;
}) {
  return {
    runId: frame.runId,
    frameNo: frame.frameNo,
    createdAtMs: frame.createdAtMs,
    createdAt: toIso(frame.createdAtMs),
    xml: parseJson(frame.xmlJson),
    xmlHash: frame.xmlHash,
    encoding: frame.encoding,
    mountedTaskIds: parseJson(frame.mountedTaskIdsJson),
    taskIndex: parseJson(frame.taskIndexJson),
    note: frame.note ?? null,
  };
}

async function listAllRunEvents(
  db: SmithersDb,
  runId: string,
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  let afterSeq = -1;

  while (true) {
    const batch = await db.listEvents(runId, afterSeq, 1_000);
    if (batch.length === 0) {
      break;
    }
    events.push(...(batch as Array<Record<string, unknown>>));
    const lastEvent = batch[batch.length - 1];
    afterSeq = Number(lastEvent?.seq ?? afterSeq);
    if (batch.length < 1_000) {
      break;
    }
  }

  return events;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
