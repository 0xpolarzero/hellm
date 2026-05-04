import { SmithersDb } from "@smithers-orchestrator/db";
import { Database } from "bun:sqlite";
import {
  chatAttemptKey,
  parseChatAttemptMeta,
  parseNodeOutputEvent,
  selectChatAttempts,
  type ParsedNodeOutputEvent,
} from "@smithers-orchestrator/cli/chat";
import { diagnoseRunEffect } from "@smithers-orchestrator/cli/why-diagnosis";
import { getDevToolsSnapshotRoute, streamDevToolsRoute } from "@smithers-orchestrator/server";
import {
  ensureSmithersTables,
  runWorkflow,
  signalRun,
  type RunResult,
  type RunStatus,
  type SmithersEvent,
  type SmithersWorkflow,
} from "smithers-orchestrator";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { Effect } from "effect";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  StructuredSessionStateStore,
  StructuredWorkflowWaitKind,
  StructuredWorkflowRunRecord,
  StructuredWorkflowStatus,
  StructuredProjectCiCheckStatus,
  StructuredProjectCiStatus,
} from "../structured-session-state";
import {
  compileRunnableWorkflowLaunchContract,
  type RunnableWorkflowLaunchContract,
} from "./workflow-launch-contract";
import { loadRunnableWorkflowRegistry } from "./workflow-registry";
import type { RunnableWorkflowRegistryEntry } from "./workflow-authoring-contract";

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

type ProjectionSource = "launch" | "progress" | "control" | "bootstrap" | "failure" | "query";

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
  }) => boolean | Promise<boolean>;
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
  label: string;
  sourceScope: RunnableWorkflowRegistryEntry["sourceScope"];
  entryPath: string;
  definitionPaths: string[];
  promptPaths: string[];
  componentPaths: string[];
  assetPaths: string[];
  launchInput: Record<string, unknown>;
  runId: string;
  resumedRunId: string | null;
  structuredWorkflowRunId: string;
  status: StructuredWorkflowStatus;
  smithersStatus: RunStatus;
  summary: string;
};

type WorkflowListInput = {
  workflowId?: string;
  sourceScope?: RunnableWorkflowRegistryEntry["sourceScope"];
  productKind?: RunnableWorkflowRegistryEntry["productKind"];
  pathPrefix?: string;
};

type WorkflowListEntry = {
  workflowId: string;
  label: string;
  summary: string;
  sourceScope: RunnableWorkflowRegistryEntry["sourceScope"];
  entryPath: string;
  productKind?: RunnableWorkflowRegistryEntry["productKind"];
  definitionPaths: string[];
  promptPaths: string[];
  componentPaths: string[];
  assetPaths: string[];
  launchInputSchema: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
};

export type WorkflowLaunchDiagnostic = {
  path?: string;
  message: string;
  code?: string;
};

export type WorkflowLaunchPreflightResult =
  | {
      success: true;
      workflow: WorkflowListEntry;
      launchInput: Record<string, unknown>;
    }
  | {
      success: false;
      workflowId: string;
      diagnostics: WorkflowLaunchDiagnostic[];
      workflow?: WorkflowListEntry;
    };

type SmithersAttemptRow = {
  runId: string;
  nodeId: string;
  iteration: number;
  attempt: number;
  state: string;
  startedAtMs: number;
  finishedAtMs?: number | null;
  heartbeatAtMs?: number | null;
  errorJson?: string | null;
  metaJson?: string | null;
  responseText?: string | null;
  cached?: boolean | null;
  jjPointer?: string | null;
  jjCwd?: string | null;
};

export type TestWorkflowDefinition = {
  id: string;
  label: string;
  summary: string;
  workflowName?: string;
  launchSchema: RunnableWorkflowRegistryEntry["launchSchema"];
  productKind?: RunnableWorkflowRegistryEntry["productKind"];
  resultSchema?: RunnableWorkflowRegistryEntry["resultSchema"];
  workflow: SmithersWorkflow<any>;
  sourceScope?: RunnableWorkflowRegistryEntry["sourceScope"];
  entryPath?: string;
  definitionPaths?: string[];
  promptPaths?: string[];
  componentPaths?: string[];
};

const projectCiCheckStatusSchema = z.enum(["passed", "failed", "cancelled", "skipped", "blocked"]);

const projectCiResultProjectionSchema = z.object({
  status: z.enum(["passed", "failed", "cancelled", "blocked"]),
  summary: z.string().min(1),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  checks: z.array(
    z.object({
      checkId: z.string().min(1),
      label: z.string().min(1),
      kind: z.string().min(1),
      status: projectCiCheckStatusSchema,
      required: z.boolean().default(true),
      command: z.array(z.string()).optional(),
      exitCode: z.number().int().nullable().optional(),
      summary: z.string().min(1),
      artifactIds: z.array(z.string()).default([]),
      startedAt: z.string().nullable().optional(),
      finishedAt: z.string().nullable().optional(),
    }),
  ),
});

type ProjectCiResultProjection = z.infer<typeof projectCiResultProjectionSchema>;

type ProjectCiProjection =
  | {
      workflowStatus: "completed";
      summary: string;
      result: ProjectCiResultProjection | null;
    }
  | {
      workflowStatus: "failed";
      summary: string;
      result: null;
    };

export class SmithersRuntimeManager {
  private readonly runtimeRoot: string;
  private readonly runtimeDbPath: string;
  private readonly db: SmithersDb;
  private readonly testWorkflowEntriesById = new Map<string, RunnableWorkflowRegistryEntry>();
  private readonly workflowEntriesById = new Map<string, RunnableWorkflowRegistryEntry>();
  private readonly launchContractsByWorkflowId = new Map<string, RunnableWorkflowLaunchContract>();
  private workflowLaunchContracts: RunnableWorkflowLaunchContract[] = [];
  private readonly ownershipByRunId = new Map<string, WorkflowOwnership>();
  private readonly monitorByRunId = new Map<string, WorkflowMonitor>();
  private readonly flushPromiseByRunId = new Map<string, Promise<void>>();
  private readonly deliveringAttentionRunIds = new Set<string>();
  private readonly activeWorkflowPromises = new Set<Promise<void>>();
  private readonly terminalOutputByRunId = new Map<string, unknown>();

  constructor(private readonly options: SmithersRuntimeManagerOptions) {
    this.runtimeRoot = join(options.cwd, ".svvy", "smithers-runtime");
    mkdirSync(this.runtimeRoot, { recursive: true });
    this.runtimeDbPath = join(this.runtimeRoot, "smithers.db");
    const db = new Database(this.runtimeDbPath);
    ensureSmithersTables(db as any);
    this.db = new SmithersDb(db as any);
  }

  listWorkflows(input: WorkflowListInput = {}): WorkflowListEntry[] {
    return this.workflowLaunchContracts
      .filter((contract) => (input.workflowId ? contract.workflowId === input.workflowId : true))
      .filter((contract) => (input.sourceScope ? contract.sourceScope === input.sourceScope : true))
      .filter((contract) => (input.productKind ? contract.productKind === input.productKind : true))
      .filter((contract) =>
        input.pathPrefix
          ? [
              contract.entryPath,
              ...contract.definitionPaths,
              ...contract.promptPaths,
              ...contract.componentPaths,
              ...contract.assetPaths,
            ].some((path) => path.startsWith(input.pathPrefix!))
          : true,
      )
      .map((contract) => ({
        workflowId: contract.workflowId,
        label: contract.label,
        summary: contract.summary,
        sourceScope: contract.sourceScope,
        entryPath: contract.entryPath,
        productKind: contract.productKind,
        definitionPaths: contract.definitionPaths.slice(),
        promptPaths: contract.promptPaths.slice(),
        componentPaths: contract.componentPaths.slice(),
        assetPaths: contract.assetPaths.slice(),
        launchInputSchema: structuredClone(contract.launchInputJsonSchema),
        resultSchema: contract.resultSchemaJsonSchema
          ? structuredClone(contract.resultSchemaJsonSchema)
          : undefined,
      }));
  }

  async refreshWorkflowRegistry(): Promise<void> {
    const registry = await loadRunnableWorkflowRegistry(this.options.cwd);
    this.rebuildWorkflowRegistry([
      ...registry,
      ...Array.from(this.testWorkflowEntriesById.values()),
    ]);
  }

  registerTestWorkflow(definition: TestWorkflowDefinition): void {
    const sourceScope = definition.sourceScope ?? "saved";
    const entryPath =
      definition.entryPath ?? `.svvy/workflows/entries/${definition.id.replace(/_/g, "-")}.tsx`;
    const entry: RunnableWorkflowRegistryEntry = {
      workflowId: definition.id,
      label: definition.label,
      summary: definition.summary,
      sourceScope,
      entryPath,
      productKind: definition.productKind,
      launchSchema: definition.launchSchema,
      resultSchema: definition.resultSchema,
      definitionPaths: definition.definitionPaths ?? [],
      promptPaths: definition.promptPaths ?? [],
      componentPaths: definition.componentPaths ?? [],
      assetPaths: Array.from(
        new Set([
          ...(definition.definitionPaths ?? []),
          ...(definition.promptPaths ?? []),
          ...(definition.componentPaths ?? []),
        ]),
      ).toSorted(),
      createRunnableEntry: () => ({
        workflowId: definition.id,
        workflowSource: sourceScope,
        productKind: definition.productKind,
        launchSchema: definition.launchSchema,
        resultSchema: definition.resultSchema,
        workflow: definition.workflow,
      }),
    };
    this.testWorkflowEntriesById.set(definition.id, entry);
    this.rebuildWorkflowRegistry([
      ...Array.from(this.workflowEntriesById.values()),
      ...Array.from(this.testWorkflowEntriesById.values()),
    ]);
  }

  private rebuildWorkflowRegistry(registry: RunnableWorkflowRegistryEntry[]): void {
    this.workflowEntriesById.clear();
    this.launchContractsByWorkflowId.clear();
    for (const entry of registry) {
      this.workflowEntriesById.set(entry.workflowId, entry);
      this.launchContractsByWorkflowId.set(
        entry.workflowId,
        compileRunnableWorkflowLaunchContract(entry),
      );
    }
    this.workflowLaunchContracts = registry.map((entry) => {
      const contract = this.launchContractsByWorkflowId.get(entry.workflowId);
      if (!contract) {
        throw new Error(`Runnable Smithers workflow contract not found: ${entry.workflowId}`);
      }
      return contract;
    });
  }

  async validateWorkflowLaunchInput(input: {
    workflowId: string;
    launchInput: unknown;
  }): Promise<WorkflowLaunchPreflightResult> {
    await this.refreshWorkflowRegistry();

    const workflowId = input.workflowId.trim();
    const workflow = this.listWorkflows({ workflowId })[0];
    if (!workflow) {
      return {
        success: false,
        workflowId,
        diagnostics: [
          {
            message: `Runnable workflow not found: ${workflowId}`,
            code: "workflow_not_found",
          },
        ],
      };
    }

    const entry = this.requireWorkflowEntry(workflowId);
    const parsedInput = entry.launchSchema.safeParse(input.launchInput);
    if (!parsedInput.success) {
      return {
        success: false,
        workflowId,
        workflow,
        diagnostics: parsedInput.error.issues.map((issue) => ({
          path: issue.path.length > 0 ? issue.path.map(String).join(".") : undefined,
          message: issue.message,
          code: issue.code,
        })),
      };
    }

    return {
      success: true,
      workflow,
      launchInput: parsedInput.data as Record<string, unknown>,
    };
  }

  async launchWorkflow(input: LaunchWorkflowInput): Promise<LaunchWorkflowResult> {
    await this.refreshWorkflowRegistry();
    const entry = this.requireWorkflowEntry(input.workflowId);
    const parsedInput = entry.launchSchema.safeParse(input.launchInput);
    if (!parsedInput.success) {
      throw new Error(parsedInput.error.issues.map((issue) => issue.message).join("; "));
    }

    const existingRunId =
      input.runId?.trim() ||
      this.findResumableThreadRun(input.sessionId, input.threadId, input.workflowId)?.smithersRunId;
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
          pendingAttentionSeq: null,
          summary: `${existingRunId ? "Resuming" : "Launching"} ${entry.label}.`,
          heartbeatAt: null,
        })
      : this.options.store.recordWorkflow({
          threadId: input.threadId,
          commandId: input.commandId,
          smithersRunId: runId,
          workflowName: entry.workflowId,
          workflowSource: entry.sourceScope,
          entryPath: entry.entryPath,
          savedEntryId: entry.sourceScope === "saved" ? entry.workflowId : null,
          status: "running",
          smithersStatus: "running",
          waitKind: null,
          continuedFromRunIds: [],
          activeDescendantRunId: null,
          lastEventSeq: null,
          pendingAttentionSeq: null,
          lastAttentionSeq: null,
          heartbeatAt: null,
          summary: `${existingRunId ? "Resuming" : "Launching"} ${entry.label}.`,
        });

    this.options.store.updateThread({
      threadId: input.threadId,
      status: "running-workflow",
      wait: null,
    });
    this.clearThreadOwnedSessionWait(input.sessionId, input.threadId);
    this.recordBridgeLifecycleEvent({
      sessionId: input.sessionId,
      workflowRunId: structuredWorkflowRun.id,
      kind: "workflowRun.bridge.projected",
      data: {
        source: "launch",
        smithersRunId: runId,
        status: structuredWorkflowRun.status,
        smithersStatus: structuredWorkflowRun.smithersStatus,
      },
    });
    this.ownershipByRunId.set(runId, {
      sessionId: input.sessionId,
      threadId: input.threadId,
      workflowId: entry.workflowId,
      structuredWorkflowId: structuredWorkflowRun.id,
      commandId: input.commandId,
    });

    const monitor = this.createMonitor({
      sessionId: input.sessionId,
      threadId: input.threadId,
      workflowId: entry.workflowId,
      runId,
    });
    this.trackRunIdWithMonitor(monitor, runId);

    const runnableEntry = entry.createRunnableEntry({
      dbPath: this.runtimeDbPath,
    });
    const workflowPromise = this.runWorkflowInBackground({
      runnableEntry,
      monitor,
      runId,
      input: parsedInput.data as Record<string, unknown>,
      resume: Boolean(existingRunId),
    });
    this.activeWorkflowPromises.add(workflowPromise);
    void workflowPromise.finally(() => {
      this.activeWorkflowPromises.delete(workflowPromise);
    });

    await this.waitForRunRegistration(runId);

    await this.emitStructuredStateChanged(input.sessionId);

    return {
      workflowId: entry.workflowId,
      label: entry.label,
      sourceScope: entry.sourceScope,
      entryPath: entry.entryPath,
      definitionPaths: entry.definitionPaths.slice(),
      promptPaths: entry.promptPaths.slice(),
      componentPaths: entry.componentPaths.slice(),
      assetPaths: Array.from(
        new Set([...entry.definitionPaths, ...entry.promptPaths, ...entry.componentPaths]),
      ).toSorted(),
      launchInput: parsedInput.data as Record<string, unknown>,
      runId,
      resumedRunId: existingRunId ?? null,
      structuredWorkflowRunId: structuredWorkflowRun.id,
      status: structuredWorkflowRun.status,
      smithersStatus: "running",
      summary: structuredWorkflowRun.summary,
    };
  }

  private async waitForRunRegistration(runId: string, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await this.db.getRun(runId);
      if (run) {
        return;
      }
      await Bun.sleep(25);
    }
    throw new Error(`Smithers run ${runId} did not become observable after launch.`);
  }

  async listRuns(input?: { limit?: number; status?: string; workflowId?: string }) {
    const runs = await this.db.listRuns(input?.limit ?? 25, input?.status);
    const structuredRunBySmithersRunId = this.listStructuredRunBySmithersRunId();
    const filteredRuns = runs.filter((run: any) => {
      if (!input?.workflowId) {
        return true;
      }
      const structuredRun = structuredRunBySmithersRunId.get(run.runId);
      return (
        structuredRun?.savedEntryId === input.workflowId ||
        structuredRun?.workflowName === input.workflowId
      );
    });

    return await Promise.all(
      filteredRuns.map(async (run: any) => {
        const structuredRun = structuredRunBySmithersRunId.get(run.runId) ?? null;
        return {
          runId: run.runId,
          workflowName: structuredRun?.workflowName ?? run.workflowName,
          workflowId: structuredRun?.savedEntryId ?? structuredRun?.workflowName ?? null,
          workflowSource: structuredRun?.workflowSource ?? null,
          entryPath: structuredRun?.entryPath ?? null,
          savedEntryId: structuredRun?.savedEntryId ?? null,
          status: run.status,
          sessionId: structuredRun?.sessionId ?? null,
          threadId: structuredRun?.threadId ?? null,
          createdAt: toIso(run.createdAtMs),
          startedAt: toIso(run.startedAtMs),
          finishedAt: toIso(run.finishedAtMs),
          heartbeatAt: toIso(run.heartbeatAtMs),
          summary: await this.buildRunSummary(run),
        };
      }),
    );
  }

  async getRun(runId: string) {
    await this.flushRunEvents(runId, {
      emitAttention: false,
      source: "query",
    });
    const run = await this.db.getRun(runId);
    if (!run) {
      throw new Error(`Smithers run not found: ${runId}`);
    }
    const workflowRun = this.findStructuredWorkflowRunBySmithersRunId(runId);
    return {
      runId: run.runId,
      workflowName: workflowRun?.workflowName ?? run.workflowName,
      workflowId: workflowRun?.savedEntryId ?? workflowRun?.workflowName ?? null,
      workflowSource: workflowRun?.workflowSource ?? null,
      entryPath: workflowRun?.entryPath ?? null,
      savedEntryId: workflowRun?.savedEntryId ?? null,
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
      lastEventSeq: workflowRun?.lastEventSeq ?? null,
      pendingAttentionSeq: workflowRun?.pendingAttentionSeq ?? null,
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

  async listPendingApprovals(input?: { runId?: string; workflowName?: string; nodeId?: string }) {
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
    await this.flushRunEvents(input.runId, { source: "control" });
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
    const parsedOutputs = events.map((event) => parseNodeOutputEvent(event as any)).filter(Boolean);

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
    await this.flushRunEvents(input.runId, { source: "control" });
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
    await this.flushRunEvents(runId, { source: "control" });
    return {
      ok: true,
      runId,
    };
  }

  async restoreSessionSupervision(
    sessionId: string,
    options: {
      emitAttention?: boolean;
    } = {},
  ): Promise<void> {
    const snapshot = this.options.store.getSessionState(sessionId);
    this.hydrateRunOwnershipForSession(sessionId);

    const candidateRuns = snapshot.workflowRuns.filter(
      (workflowRun) =>
        !isTerminalWorkflowStatus(workflowRun.status) || workflowRun.pendingAttentionSeq !== null,
    );
    for (const workflowRun of candidateRuns) {
      await this.flushRunEvents(workflowRun.smithersRunId, {
        emitAttention: false,
        source: "bootstrap",
      });
    }

    if (options.emitAttention ?? true) {
      await this.deliverPendingHandlerAttention(sessionId);
    }
  }

  async deliverPendingHandlerAttention(sessionId: string, threadId?: string): Promise<void> {
    const snapshot = this.options.store.getSessionState(sessionId);
    const pendingRuns = snapshot.workflowRuns
      .filter(
        (workflowRun) =>
          (!threadId || workflowRun.threadId === threadId) &&
          workflowRun.pendingAttentionSeq !== null &&
          workflowRun.pendingAttentionSeq !== workflowRun.lastAttentionSeq,
      )
      .toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt));

    for (const workflowRun of pendingRuns) {
      await this.tryDeliverPendingHandlerAttention(workflowRun.smithersRunId, {
        source: "bootstrap",
      });
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
    runnableEntry: ReturnType<RunnableWorkflowRegistryEntry["createRunnableEntry"]>;
    monitor: WorkflowMonitor;
    runId: string;
    input: Record<string, unknown>;
    resume: boolean;
  }) {
    try {
      const result = (await Effect.runPromise(
        runWorkflow(input.runnableEntry.workflow, {
          runId: input.runId,
          input: input.input,
          resume: input.resume,
          rootDir: this.options.cwd,
          signal: input.monitor.abortController.signal,
          onProgress: (event: SmithersEvent) => {
            void this.handleProgressEvent(input.monitor, event);
          },
        }),
      )) as RunResult;
      this.terminalOutputByRunId.set(input.runId, result.output);
    } catch (error) {
      if (!input.monitor.abortController.signal.aborted) {
        await this.captureUnexpectedWorkflowFailure(input.runId, error);
      }
    } finally {
      await Promise.all(
        Array.from(input.monitor.trackedRunIds).map(async (runId) => {
          await this.flushRunEvents(runId, { source: "progress" });
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
    await this.flushRunEvents(event.runId, { source: "progress" });
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
      workflowSource: parentWorkflowRun?.workflowSource ?? "artifact",
      entryPath: parentWorkflowRun?.entryPath ?? null,
      savedEntryId: parentWorkflowRun?.savedEntryId ?? null,
      status: "running",
      smithersStatus: "running",
      waitKind: null,
      continuedFromRunIds: [
        ...(parentWorkflowRun?.continuedFromRunIds ?? []),
        parentOwnership.structuredWorkflowId,
      ],
      activeDescendantRunId: null,
      lastEventSeq: null,
      pendingAttentionSeq: null,
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
      pendingAttentionSeq: null,
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
      source?: ProjectionSource;
    } = {},
  ): Promise<void> {
    while (true) {
      const existing = this.flushPromiseByRunId.get(runId);
      if (!existing) {
        break;
      }
      if (this.deliveringAttentionRunIds.has(runId)) {
        // The handler attention turn may inspect the same run that is currently
        // delivering that attention. Reusing the durable projection avoids
        // waiting on the flush that is waiting on this handler turn.
        return;
      }
      await existing;
    }

    const flushPromise = (async () => {
      const ownership = this.ownershipByRunId.get(runId) ?? this.rehydrateRunOwnership(runId);
      if (!ownership) {
        return;
      }

      const structuredRun = this.findStructuredWorkflowRunById(
        ownership.sessionId,
        ownership.structuredWorkflowId,
      );
      let lastEventSeq = structuredRun?.lastEventSeq ?? null;
      let attentionSeq: number | null = null;
      let attentionReason: string | null = null;

      while (true) {
        const events = await this.db.listEvents(runId, lastEventSeq ?? -1, 200);
        if (events.length === 0) {
          break;
        }

        for (const eventRow of events) {
          const nextSeq = Number(eventRow.seq ?? lastEventSeq ?? -1);
          lastEventSeq = Math.max(lastEventSeq ?? -1, nextSeq);
          const event = parseJson(eventRow.payloadJson) as SmithersEvent | null;
          if (!event) {
            continue;
          }
          if (requiresHandlerAttention(event)) {
            attentionSeq = Number(eventRow.seq);
            attentionReason = describeAttentionEvent(event);
          }
        }

        if (events.length < 200) {
          break;
        }
      }

      await this.refreshStructuredProjection(
        runId,
        {
          lastEventSeq,
          observedAttentionSeq: attentionSeq,
          observedAttentionReason: attentionReason,
        },
        {
          emitAttention: options.emitAttention ?? true,
          source: options.source ?? "progress",
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
      lastEventSeq: number | null;
      observedAttentionSeq: number | null;
      observedAttentionReason: string | null;
    },
    options: {
      emitAttention: boolean;
      source: ProjectionSource;
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
    const diagnosis = run.status === "waiting-event" ? await this.getRunDiagnosis(runId) : null;
    const waitKind = mapRunStatusToWaitKind(run.status);
    const projectCiProjection = this.resolveProjectCiProjection({
      runId,
      ownership,
      runStatus: run.status,
    });
    const status = projectCiProjection?.workflowStatus ?? mapRunStatusToWorkflowStatus(run.status);
    const summary =
      projectCiProjection?.summary ?? diagnosis?.summary ?? (await this.buildRunSummary(run));
    const heartbeatAt = toIso(run.heartbeatAtMs);
    const currentPendingAttentionSeq = currentWorkflowRun?.pendingAttentionSeq ?? null;
    const currentDeliveredAttentionSeq = currentWorkflowRun?.lastAttentionSeq ?? null;
    const nextPendingAttentionSeq =
      input.observedAttentionSeq !== null &&
      input.observedAttentionSeq >
        Math.max(currentPendingAttentionSeq ?? -1, currentDeliveredAttentionSeq ?? -1)
        ? input.observedAttentionSeq
        : currentPendingAttentionSeq;
    const nextWorkflowRun = this.options.store.updateWorkflow({
      workflowId: ownership.structuredWorkflowId,
      commandId: ownership.commandId,
      status,
      smithersStatus: run.status,
      waitKind,
      lastEventSeq: input.lastEventSeq,
      pendingAttentionSeq: nextPendingAttentionSeq,
      lastAttentionSeq: currentDeliveredAttentionSeq,
      heartbeatAt,
      summary,
    });
    this.recordBridgeLifecycleEvent({
      sessionId: ownership.sessionId,
      workflowRunId: nextWorkflowRun.id,
      kind: "workflowRun.bridge.projected",
      data: {
        source: options.source,
        smithersRunId: runId,
        lastEventSeq: input.lastEventSeq,
        pendingAttentionSeq: nextPendingAttentionSeq,
        lastAttentionSeq: currentDeliveredAttentionSeq,
        status: nextWorkflowRun.status,
        smithersStatus: nextWorkflowRun.smithersStatus,
      },
    });
    if (
      nextPendingAttentionSeq !== null &&
      nextPendingAttentionSeq !== currentPendingAttentionSeq
    ) {
      this.recordBridgeLifecycleEvent({
        sessionId: ownership.sessionId,
        workflowRunId: nextWorkflowRun.id,
        kind: "workflowRun.bridge.attention.pending",
        data: {
          source: options.source,
          smithersRunId: runId,
          attentionSeq: nextPendingAttentionSeq,
        },
      });
    }

    await this.projectWorkflowTaskAttempts(runId, ownership);
    if (projectCiProjection?.workflowStatus === "completed" && projectCiProjection.result) {
      const entry = this.workflowEntriesById.get(ownership.workflowId);
      this.options.store.recordProjectCiResult({
        workflowRunId: nextWorkflowRun.id,
        workflowId: ownership.workflowId,
        entryPath: entry?.entryPath ?? nextWorkflowRun.entryPath ?? "",
        status: projectCiProjection.result.status as StructuredProjectCiStatus,
        summary: projectCiProjection.result.summary,
        startedAt: projectCiProjection.result.startedAt ?? nextWorkflowRun.startedAt,
        finishedAt: projectCiProjection.result.finishedAt ?? nextWorkflowRun.finishedAt,
        checks: projectCiProjection.result.checks.map((check) => ({
          checkId: check.checkId,
          label: check.label,
          kind: check.kind,
          status: check.status as StructuredProjectCiCheckStatus,
          required: check.required,
          command: check.command ?? null,
          exitCode: check.exitCode ?? null,
          summary: check.summary,
          artifactIds: check.artifactIds,
          startedAt: check.startedAt ?? null,
          finishedAt: check.finishedAt ?? null,
        })),
      });
    }
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
      nextWorkflowRun.pendingAttentionSeq !== null &&
      nextWorkflowRun.pendingAttentionSeq !== nextWorkflowRun.lastAttentionSeq
    ) {
      await this.tryDeliverPendingHandlerAttention(runId, {
        source: options.source,
        summary,
        reason:
          input.observedAttentionSeq === nextWorkflowRun.pendingAttentionSeq
            ? input.observedAttentionReason
            : null,
      });
    }
  }

  private async projectWorkflowTaskAttempts(runId: string, ownership: WorkflowOwnership) {
    const attempts = (await this.db.listAttemptsForRun(runId)) as SmithersAttemptRow[];
    if (attempts.length === 0) {
      return;
    }

    const outputEvents = (await listAllRunEventsByType(this.db, runId, ["NodeOutput"]))
      .map((event) => parseNodeOutputEvent(event as any))
      .filter((event): event is NonNullable<typeof event> => event !== null);
    const outputEventsByAttemptKey = new Map<string, typeof outputEvents>();
    for (const outputEvent of outputEvents) {
      if (!outputEvent.nodeId) {
        continue;
      }
      const key = chatAttemptKey({
        nodeId: outputEvent.nodeId,
        iteration: outputEvent.iteration ?? 0,
        attempt: outputEvent.attempt ?? 1,
      });
      const list = outputEventsByAttemptKey.get(key) ?? [];
      list.push(outputEvent);
      outputEventsByAttemptKey.set(key, list);
    }

    for (const attempt of attempts) {
      const meta = parseJson(attempt.metaJson);
      const structuredAttempt = this.options.store.upsertWorkflowTaskAttempt({
        workflowRunId: ownership.structuredWorkflowId,
        smithersRunId: runId,
        nodeId: attempt.nodeId,
        iteration: attempt.iteration ?? 0,
        attempt: attempt.attempt,
        surfacePiSessionId: readMetaString(meta, "agentSurfacePiSessionId"),
        title: readMetaString(meta, "label") ?? attempt.nodeId,
        summary: summarizeWorkflowTaskAttemptProjection(attempt, meta),
        kind: readWorkflowTaskAttemptKind(meta),
        status: mapAttemptStateToWorkflowTaskAttemptStatus(attempt.state),
        smithersState: attempt.state,
        prompt: readMetaString(meta, "prompt"),
        responseText: attempt.responseText ?? null,
        error: parseAttemptErrorMessage(attempt.errorJson),
        cached: Boolean(attempt.cached),
        jjPointer: attempt.jjPointer ?? null,
        jjCwd: attempt.jjCwd ?? null,
        heartbeatAt: toIso(attempt.heartbeatAtMs),
        agentId: readMetaString(meta, "agentId"),
        agentModel: readMetaString(meta, "agentModel"),
        agentEngine: readMetaString(meta, "agentEngine"),
        agentResume:
          readMetaString(meta, "agentResume") ??
          readNestedMetaString(meta, "hijackHandoff", "resume"),
        meta,
        startedAt: toIso(attempt.startedAtMs) ?? new Date(0).toISOString(),
        finishedAt: toIso(attempt.finishedAtMs),
      });

      this.options.store.replaceWorkflowTaskMessages({
        workflowTaskAttemptId: structuredAttempt.id,
        messages: buildWorkflowTaskAttemptMessages({
          runId,
          attempt,
          prompt: readMetaString(meta, "prompt"),
          responseText: attempt.responseText ?? null,
          outputEvents:
            outputEventsByAttemptKey.get(
              chatAttemptKey({
                nodeId: attempt.nodeId,
                iteration: attempt.iteration ?? 0,
                attempt: attempt.attempt,
              }),
            ) ?? [],
        }),
      });
    }
  }

  private resolveProjectCiProjection(input: {
    runId: string;
    ownership: WorkflowOwnership;
    runStatus: RunStatus;
  }): ProjectCiProjection | null {
    if (input.runStatus !== "finished") {
      return null;
    }

    const entry = this.workflowEntriesById.get(input.ownership.workflowId);
    if (entry?.productKind !== "project-ci") {
      return null;
    }

    const existingCiRun =
      this.options.store
        .getSessionState(input.ownership.sessionId)
        .ciRuns.find((ciRun) => ciRun.workflowRunId === input.ownership.structuredWorkflowId) ??
      null;
    if (existingCiRun) {
      return {
        workflowStatus: "completed",
        summary: existingCiRun.summary,
        result: null,
      };
    }

    if (!this.terminalOutputByRunId.has(input.runId)) {
      return null;
    }

    if (!entry.resultSchema) {
      return {
        workflowStatus: "failed",
        summary:
          "Project CI entry declared productKind but did not provide a result schema, so no CI records were created.",
        result: null,
      };
    }

    const output = this.terminalOutputByRunId.get(input.runId);
    const entryValidation = entry.resultSchema.safeParse(output);
    if (!entryValidation.success) {
      return {
        workflowStatus: "failed",
        summary:
          "Project CI terminal result output did not validate against the entry result schema.",
        result: null,
      };
    }

    const projectionValidation = projectCiResultProjectionSchema.safeParse(entryValidation.data);
    if (!projectionValidation.success) {
      return {
        workflowStatus: "failed",
        summary:
          "Project CI terminal result output validated against its entry schema but did not match the Project CI projection contract.",
        result: null,
      };
    }

    return {
      workflowStatus: "completed",
      summary: projectionValidation.data.summary,
      result: projectionValidation.data,
    };
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
          kind: deriveThreadWaitKind(workflowRun),
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
    const currentWorkflowRun = this.findStructuredWorkflowRunById(
      ownership.sessionId,
      ownership.structuredWorkflowId,
    );
    const message =
      error instanceof Error
        ? error.message
        : "The supervised Smithers workflow failed unexpectedly.";
    const nextPendingAttentionSeq =
      Math.max(
        currentWorkflowRun?.pendingAttentionSeq ?? -1,
        currentWorkflowRun?.lastAttentionSeq ?? -1,
        currentWorkflowRun?.lastEventSeq ?? -1,
      ) + 1;
    const nextWorkflowRun = this.options.store.updateWorkflow({
      workflowId: ownership.structuredWorkflowId,
      commandId: ownership.commandId,
      status: "failed",
      smithersStatus: "failed",
      waitKind: null,
      continuedFromRunIds: currentWorkflowRun?.continuedFromRunIds,
      activeDescendantRunId: currentWorkflowRun?.activeDescendantRunId ?? null,
      lastEventSeq: currentWorkflowRun?.lastEventSeq ?? null,
      pendingAttentionSeq: nextPendingAttentionSeq,
      lastAttentionSeq: currentWorkflowRun?.lastAttentionSeq ?? null,
      heartbeatAt: currentWorkflowRun?.heartbeatAt ?? null,
      summary: message,
    });
    this.recordBridgeLifecycleEvent({
      sessionId: ownership.sessionId,
      workflowRunId: nextWorkflowRun.id,
      kind: "workflowRun.bridge.projected",
      data: {
        source: "failure",
        smithersRunId: runId,
        lastEventSeq: nextWorkflowRun.lastEventSeq,
        pendingAttentionSeq: nextWorkflowRun.pendingAttentionSeq,
        lastAttentionSeq: nextWorkflowRun.lastAttentionSeq,
        status: nextWorkflowRun.status,
        smithersStatus: nextWorkflowRun.smithersStatus,
      },
    });
    this.recordBridgeLifecycleEvent({
      sessionId: ownership.sessionId,
      workflowRunId: nextWorkflowRun.id,
      kind: "workflowRun.bridge.attention.pending",
      data: {
        source: "failure",
        smithersRunId: runId,
        attentionSeq: nextPendingAttentionSeq,
      },
    });
    this.applyThreadProjection({
      sessionId: ownership.sessionId,
      threadId: ownership.threadId,
      workflowRun: nextWorkflowRun,
    });
    await this.emitStructuredStateChanged(ownership.sessionId);
    await this.tryDeliverPendingHandlerAttention(runId, {
      source: "failure",
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

  private hydrateRunOwnershipForSession(sessionId: string): void {
    const snapshot = this.options.store.getSessionState(sessionId);
    for (const workflowRun of snapshot.workflowRuns) {
      this.ownershipByRunId.set(workflowRun.smithersRunId, {
        sessionId: workflowRun.sessionId,
        threadId: workflowRun.threadId,
        workflowId: workflowRun.savedEntryId ?? workflowRun.workflowName,
        structuredWorkflowId: workflowRun.id,
        commandId: workflowRun.commandId,
      });
    }
  }

  private rehydrateRunOwnership(runId: string): WorkflowOwnership | null {
    const workflowRun = this.findStructuredWorkflowRunBySmithersRunId(runId);
    if (!workflowRun) {
      return null;
    }
    const ownership = {
      sessionId: workflowRun.sessionId,
      threadId: workflowRun.threadId,
      workflowId: workflowRun.savedEntryId ?? workflowRun.workflowName,
      structuredWorkflowId: workflowRun.id,
      commandId: workflowRun.commandId,
    } satisfies WorkflowOwnership;
    this.ownershipByRunId.set(runId, ownership);
    return ownership;
  }

  private async tryDeliverPendingHandlerAttention(
    runId: string,
    input: {
      source: ProjectionSource;
      summary?: string;
      reason?: string | null;
    },
  ): Promise<boolean> {
    const ownership = this.ownershipByRunId.get(runId) ?? this.rehydrateRunOwnership(runId);
    if (!ownership) {
      return false;
    }

    const workflowRun = this.findStructuredWorkflowRunById(
      ownership.sessionId,
      ownership.structuredWorkflowId,
    );
    if (
      !workflowRun ||
      workflowRun.pendingAttentionSeq === null ||
      workflowRun.pendingAttentionSeq === workflowRun.lastAttentionSeq
    ) {
      return false;
    }

    const thread =
      this.options.store
        .getSessionState(ownership.sessionId)
        .threads.find((entry) => entry.id === ownership.threadId) ?? null;
    if (isTerminalWorkflowReplayAfterThreadCompletion(thread?.status ?? null, workflowRun.status)) {
      return false;
    }

    let delivered = false;
    this.deliveringAttentionRunIds.add(runId);
    try {
      delivered =
        (await this.options.onHandlerAttention?.({
          sessionId: ownership.sessionId,
          threadId: ownership.threadId,
          workflowRunId: workflowRun.id,
          smithersRunId: runId,
          workflowId: ownership.workflowId,
          summary: input.summary ?? workflowRun.summary,
          reason:
            input.reason ??
            (await this.readPendingAttentionReason(runId, workflowRun.pendingAttentionSeq)) ??
            "The supervised workflow needs handler attention.",
        })) ?? false;
    } finally {
      this.deliveringAttentionRunIds.delete(runId);
    }
    if (!delivered) {
      return false;
    }

    this.options.store.updateWorkflow({
      workflowId: workflowRun.id,
      commandId: workflowRun.commandId,
      status: workflowRun.status,
      smithersStatus: workflowRun.smithersStatus,
      waitKind: workflowRun.waitKind,
      continuedFromRunIds: workflowRun.continuedFromRunIds,
      activeDescendantRunId: workflowRun.activeDescendantRunId,
      lastEventSeq: workflowRun.lastEventSeq,
      pendingAttentionSeq: null,
      lastAttentionSeq: workflowRun.pendingAttentionSeq,
      heartbeatAt: workflowRun.heartbeatAt,
      summary: workflowRun.summary,
    });
    this.recordBridgeLifecycleEvent({
      sessionId: ownership.sessionId,
      workflowRunId: workflowRun.id,
      kind: "workflowRun.bridge.attention.delivered",
      data: {
        source: input.source,
        smithersRunId: runId,
        attentionSeq: workflowRun.pendingAttentionSeq,
      },
    });
    await this.emitStructuredStateChanged(ownership.sessionId);
    return true;
  }

  private async readPendingAttentionReason(
    runId: string,
    attentionSeq: number,
  ): Promise<string | null> {
    const events = await this.db.listEvents(runId, attentionSeq - 1, 10);
    const eventRow = events.find((entry: any) => Number(entry.seq) === attentionSeq);
    if (!eventRow) {
      return null;
    }
    const event = parseJson(eventRow.payloadJson) as SmithersEvent | null;
    return event ? describeAttentionEvent(event) : null;
  }

  private recordBridgeLifecycleEvent(input: {
    sessionId: string;
    workflowRunId: string;
    kind: string;
    data?: Record<string, unknown>;
  }): void {
    this.options.store.recordLifecycleEvent({
      sessionId: input.sessionId,
      kind: input.kind,
      subjectKind: "workflowRun",
      subjectId: input.workflowRunId,
      data: input.data,
    });
  }

  private async emitStructuredStateChanged(sessionId: string) {
    await this.options.onStructuredStateChanged?.(sessionId);
  }

  private async getRunDiagnosis(runId: string): Promise<any> {
    return await Effect.runPromise(diagnoseRunEffect(this.db as any, runId));
  }

  private requireWorkflowEntry(workflowId: string): RunnableWorkflowRegistryEntry {
    const workflow = this.workflowEntriesById.get(workflowId);
    if (!workflow) {
      throw new Error(`Runnable Smithers workflow not found: ${workflowId}`);
    }
    return workflow;
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

  private findResumableThreadRun(
    sessionId: string,
    threadId: string,
    workflowId: string,
  ): StructuredWorkflowRunRecord | null {
    return (
      this.options.store
        .getSessionState(sessionId)
        .workflowRuns.filter(
          (workflowRun) =>
            workflowRun.threadId === threadId &&
            (workflowRun.savedEntryId === workflowId || workflowRun.workflowName === workflowId) &&
            (workflowRun.status === "waiting" || workflowRun.status === "continued"),
        )
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
    );
  }

  private findStructuredWorkflowRunBySmithersRunId(
    runId: string,
  ): StructuredWorkflowRunRecord | null {
    const inMemoryOwnership = this.ownershipByRunId.get(runId);
    if (inMemoryOwnership) {
      return this.findStructuredWorkflowRunById(
        inMemoryOwnership.sessionId,
        inMemoryOwnership.structuredWorkflowId,
      );
    }

    for (const session of this.options.store.listSessionStates()) {
      const match = session.workflowRuns.find((workflowRun) => workflowRun.smithersRunId === runId);
      if (match) {
        return match;
      }
    }

    return null;
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

  private listStructuredRunBySmithersRunId(): Map<string, StructuredWorkflowRunRecord> {
    const workflowRunsBySmithersRunId = new Map<string, StructuredWorkflowRunRecord>();
    for (const session of this.options.store.listSessionStates()) {
      for (const workflowRun of session.workflowRuns) {
        if (!workflowRunsBySmithersRunId.has(workflowRun.smithersRunId)) {
          workflowRunsBySmithersRunId.set(workflowRun.smithersRunId, workflowRun);
        }
      }
    }
    return workflowRunsBySmithersRunId;
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

function mapAttemptStateToWorkflowTaskAttemptStatus(
  state: string,
): "running" | "waiting" | "completed" | "failed" | "cancelled" {
  switch (state) {
    case "waiting-timer":
      return "waiting";
    case "finished":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

function readWorkflowTaskAttemptKind(
  meta: Record<string, unknown> | null,
): "agent" | "compute" | "static" | "unknown" {
  const kind = readMetaString(meta, "kind");
  return kind === "agent" || kind === "compute" || kind === "static" ? kind : "unknown";
}

function readMetaString(meta: Record<string, unknown> | null, key: string): string | null {
  return meta && typeof meta[key] === "string" ? (meta[key] as string) : null;
}

function readNestedMetaString(
  meta: Record<string, unknown> | null,
  key: string,
  nestedKey: string,
): string | null {
  const record = meta?.[key];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  return typeof (record as Record<string, unknown>)[nestedKey] === "string"
    ? ((record as Record<string, unknown>)[nestedKey] as string)
    : null;
}

function parseAttemptErrorMessage(errorJson: string | null | undefined): string | null {
  const error = parseJson(errorJson);
  if (!error || typeof error !== "object") {
    return null;
  }
  return typeof (error as Record<string, unknown>).message === "string"
    ? ((error as Record<string, unknown>).message as string)
    : null;
}

function summarizeWorkflowTaskAttemptProjection(
  attempt: SmithersAttemptRow,
  meta: Record<string, unknown> | null,
): string {
  const label = readMetaString(meta, "label") ?? attempt.nodeId;
  const error = parseAttemptErrorMessage(attempt.errorJson);
  switch (attempt.state) {
    case "waiting-timer":
      return `${label} is waiting on a timer.`;
    case "finished":
      return attempt.responseText?.trim()
        ? `${label} finished with a task-agent response.`
        : `${label} finished.`;
    case "failed":
      return error ? `${label} failed: ${error}` : `${label} failed.`;
    case "cancelled":
      return `${label} was cancelled.`;
    default:
      return `${label} is running.`;
  }
}

function buildWorkflowTaskAttemptMessages(input: {
  runId: string;
  attempt: SmithersAttemptRow;
  prompt: string | null;
  responseText: string | null;
  outputEvents: ParsedNodeOutputEvent[];
}): Array<{
  id: string;
  role: "user" | "assistant" | "stderr";
  source: "prompt" | "event" | "responseText";
  smithersEventSeq?: number | null;
  text: string;
  createdAt: string;
}> {
  const messages: Array<{
    id: string;
    role: "user" | "assistant" | "stderr";
    source: "prompt" | "event" | "responseText";
    smithersEventSeq?: number | null;
    text: string;
    createdAt: string;
  }> = [];
  const attemptRef = `${input.runId}:${input.attempt.nodeId}:${input.attempt.iteration}:${input.attempt.attempt}`;
  const prompt = input.prompt?.trim() ?? "";
  if (prompt) {
    messages.push({
      id: `workflow-task-message:${attemptRef}:prompt`,
      role: "user",
      source: "prompt",
      text: prompt,
      createdAt: toIso(input.attempt.startedAtMs) ?? new Date(0).toISOString(),
    });
  }

  const sortedOutputEvents = input.outputEvents.toSorted((left, right) =>
    (left.timestampMs ?? 0) === (right.timestampMs ?? 0)
      ? (left.seq ?? 0) - (right.seq ?? 0)
      : (left.timestampMs ?? 0) - (right.timestampMs ?? 0),
  );
  let sawAssistantOutput = false;
  for (const outputEvent of sortedOutputEvents) {
    if (outputEvent.stream === "stdout") {
      sawAssistantOutput = true;
    }
    messages.push({
      id: `workflow-task-message:${input.runId}:event:${outputEvent.seq}`,
      role: outputEvent.stream === "stderr" ? "stderr" : "assistant",
      source: "event",
      smithersEventSeq: outputEvent.seq,
      text: outputEvent.text ?? "",
      createdAt: toIso(outputEvent.timestampMs) ?? new Date(0).toISOString(),
    });
  }

  const responseText = input.responseText?.trim() ?? "";
  if (responseText && !sawAssistantOutput) {
    messages.push({
      id: `workflow-task-message:${attemptRef}:response`,
      role: "assistant",
      source: "responseText",
      text: responseText,
      createdAt:
        toIso(input.attempt.finishedAtMs ?? input.attempt.startedAtMs) ?? new Date(0).toISOString(),
    });
  }

  return messages;
}

function mapRunStatusToWaitKind(status: RunStatus): StructuredWorkflowWaitKind | null {
  switch (status) {
    case "waiting-approval":
      return "approval";
    case "waiting-event":
      return "event";
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

function deriveThreadWaitKind(
  workflowRun: StructuredWorkflowRunRecord,
): "approval" | "signal" | "timer" | "external" {
  switch (workflowRun.waitKind) {
    case "approval":
      return "approval";
    case "timer":
      return "timer";
    case "event":
      return "signal";
    default:
      return "external";
  }
}

function describeWaitResumeWhen(waitKind: StructuredWorkflowWaitKind | null): string {
  switch (waitKind) {
    case "approval":
      return "Resume when the approval is resolved.";
    case "timer":
      return "Resume when the timer fires.";
    case "event":
      return "Resume when the required event or signal arrives.";
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

async function listAllRunEventsByType(
  db: SmithersDb,
  runId: string,
  types: string[],
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  let afterSeq = -1;

  while (true) {
    const batch = await db.listEventHistory(runId, {
      afterSeq,
      limit: 1_000,
      types,
    });
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
