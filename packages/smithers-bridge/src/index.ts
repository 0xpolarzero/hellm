import {
  createEpisode,
  type Episode,
  type ThreadRef,
  type WorkflowRunReference,
} from "@hellm/session-model";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

export interface WorkflowTaskSpec {
  id: string;
  outputKey: string;
  prompt: string;
  agent: "pi" | "static" | "verification";
  needsApproval?: boolean;
  retryLimit?: number;
  worktreePath?: string;
  scopedContext?: WorkflowTaskScopedContext;
  toolScope?: WorkflowTaskToolScope;
  completionCondition?: WorkflowTaskCompletionCondition;
}

export interface WorkflowTaskScopedContext {
  sessionHistory: string[];
  relevantPaths: string[];
  agentsInstructions: string[];
  relevantSkills: string[];
  priorEpisodeIds: string[];
}

export interface WorkflowTaskToolScope {
  allow: string[];
  deny?: string[];
  writeRoots?: string[];
  readOnly?: boolean;
}

export interface WorkflowTaskCompletionCondition {
  type: "episode-produced" | "verification-only" | "needs-input";
  maxTurns?: number;
}

export interface AuthoredWorkflow {
  workflowId: string;
  name: string;
  objective: string;
  inputEpisodeIds: string[];
  tasks: WorkflowTaskSpec[];
}

export interface SmithersTypedOutput {
  nodeId: string;
  schema: string;
  value: Record<string, unknown>;
}

export interface SmithersApprovalRequest {
  nodeId: string;
  title: string;
  summary: string;
  mode: "needsApproval" | "approval-node";
}

export interface SmithersApprovalDecision {
  approved: boolean;
  note?: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface SmithersIsolationState {
  runId: string;
  runStateStore: string;
  sessionEntryIds: string[];
}

export interface SmithersRunRequest {
  path: "smithers-workflow";
  thread: ThreadRef;
  objective: string;
  cwd: string;
  workflow: AuthoredWorkflow;
  worktreePath?: string;
}

export interface SmithersResumeRequest {
  runId: string;
  thread: ThreadRef;
  objective: string;
  cwd?: string;
  worktreePath?: string;
  runStateStore?: string;
}

export type SmithersRunStatus =
  | "completed"
  | "waiting_approval"
  | "waiting_resume"
  | "blocked"
  | "failed";

export interface SmithersRunResult {
  run: WorkflowRunReference;
  status: SmithersRunStatus;
  outputs: SmithersTypedOutput[];
  episode: Episode;
  approval?: SmithersApprovalRequest;
  waitReason?: string;
  retryCount?: number;
  isolation?: SmithersIsolationState;
}

export interface SmithersWorkflowBridge {
  readonly enabled: boolean;
  readonly engine: "smithers";
  runWorkflow(request: SmithersRunRequest): Promise<SmithersRunResult>;
  resumeWorkflow(request: SmithersResumeRequest): Promise<SmithersRunResult>;
  approveRun(runId: string, decision: SmithersApprovalDecision): Promise<void>;
  denyRun(runId: string, decision: SmithersApprovalDecision): Promise<void>;
}

export function authorWorkflow(input: {
  thread: ThreadRef;
  objective: string;
  inputEpisodeIds: string[];
  tasks: WorkflowTaskSpec[];
}): AuthoredWorkflow {
  const tasks = input.tasks.map((task) => {
    if (task.agent !== "pi" || !task.toolScope) {
      return task;
    }

    const allowsEditCapableTools =
      task.toolScope.allow.includes("edit") ||
      task.toolScope.allow.includes("bash");
    if (task.toolScope.readOnly && allowsEditCapableTools) {
      throw new Error(
        `Task "${task.id}" is read-only but grants edit-capable tools.`,
      );
    }

    if (
      allowsEditCapableTools &&
      (!task.toolScope.writeRoots || task.toolScope.writeRoots.length === 0)
    ) {
      throw new Error(
        `Task "${task.id}" grants edit-capable tools but has no write roots.`,
      );
    }

    return task;
  });

  return {
    workflowId: `workflow:${input.thread.id}`,
    name: input.objective,
    objective: input.objective,
    inputEpisodeIds: input.inputEpisodeIds,
    tasks,
  };
}

export function translateSmithersRunToEpisode(result: SmithersRunResult): Episode {
  return result.episode;
}

export interface SmithersCliConfig {
  smithersBinary?: string;
  runStateDir?: string;
  workflowFile?: string;
}

interface DurableRunState {
  runId: string;
  threadId: string;
  workflowId: string;
  cwd: string;
  worktreePath?: string;
  runStateStore: string;
  logDir: string;
}

class SmithersDecisionError extends Error {
  readonly action: "approve" | "deny";
  readonly runId: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(input: {
    action: "approve" | "deny";
    runId: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }) {
    const diagnostics = [input.stderr.trim(), input.stdout.trim()]
      .filter((value) => value.length > 0)
      .join(" | ");
    super(
      `Smithers ${input.action} failed for run "${input.runId}" (exit ${input.exitCode})` +
      (diagnostics ? `: ${diagnostics}` : "."),
    );
    this.name = "SmithersDecisionError";
    this.action = input.action;
    this.runId = input.runId;
    this.exitCode = input.exitCode;
    this.stdout = input.stdout;
    this.stderr = input.stderr;
  }
}

function parseSmithersStdout(stdout: string): {
  outputs: SmithersTypedOutput[];
  status: SmithersRunStatus | undefined;
  runId?: string;
} {
  const outputs: SmithersTypedOutput[] = [];
  let foundStatus: SmithersRunStatus | undefined;
  let runId: string | undefined;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed["nodeId"] === "string" && typeof parsed["schema"] === "string" && typeof parsed["value"] === "object") {
        outputs.push({
          nodeId: parsed["nodeId"],
          schema: parsed["schema"],
          value: parsed["value"] as Record<string, unknown>,
        });
      }
      if (Array.isArray(parsed["outputs"])) {
        for (const output of parsed["outputs"]) {
          if (!output || typeof output !== "object") continue;
          const typed = output as Record<string, unknown>;
          if (
            typeof typed["nodeId"] === "string" &&
            typeof typed["schema"] === "string" &&
            typed["value"] &&
            typeof typed["value"] === "object"
          ) {
            outputs.push({
              nodeId: typed["nodeId"],
              schema: typed["schema"],
              value: typed["value"] as Record<string, unknown>,
            });
          }
        }
      }
      if (typeof parsed["status"] === "string") {
        const statusValue = parsed["status"] as string;
        foundStatus = mapSmithersStatus(statusValue) ?? foundStatus;
      }
      if (typeof parsed["runId"] === "string") {
        runId = parsed["runId"];
      }
    } catch {
      // Not JSON; skip
    }
  }

  const parsedObject = extractLastJsonObject(stdout);
  if (parsedObject) {
    const topLevelStatus = readStringRecordField(parsedObject, "status");
    const nestedStatus = readNestedStringField(parsedObject, "data", "status");
    foundStatus =
      mapSmithersStatus(topLevelStatus) ??
      mapSmithersStatus(nestedStatus) ??
      foundStatus;
    runId =
      readStringRecordField(parsedObject, "runId") ??
      readNestedStringField(parsedObject, "data", "runId") ??
      runId;
    const nestedOutputs = parsedObject["outputs"];
    if (Array.isArray(nestedOutputs)) {
      for (const output of nestedOutputs) {
        if (!output || typeof output !== "object") continue;
        const typed = output as Record<string, unknown>;
        if (
          typeof typed["nodeId"] === "string" &&
          typeof typed["schema"] === "string" &&
          typed["value"] &&
          typeof typed["value"] === "object"
        ) {
          outputs.push({
            nodeId: typed["nodeId"],
            schema: typed["schema"],
            value: typed["value"] as Record<string, unknown>,
          });
        }
      }
    }
  }

  const result: {
    outputs: SmithersTypedOutput[];
    status: SmithersRunStatus | undefined;
    runId?: string;
  } = { outputs, status: undefined };
  if (foundStatus !== undefined) {
    result.status = foundStatus;
  }
  if (runId) {
    result.runId = runId;
  }
  return result;
}

function extractLastJsonObject(stdout: string): Record<string, unknown> | undefined {
  const start = stdout.lastIndexOf("\n{");
  const jsonCandidate = (start >= 0 ? stdout.slice(start + 1) : stdout.trim()).trim();
  if (!jsonCandidate.startsWith("{")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function readStringRecordField(
  source: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = source[field];
  return typeof value === "string" ? value : undefined;
}

function readNestedStringField(
  source: Record<string, unknown>,
  parentField: string,
  field: string,
): string | undefined {
  const parent = source[parentField];
  if (!parent || typeof parent !== "object") {
    return undefined;
  }
  const value = (parent as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function mapSmithersStatus(status: string | undefined): SmithersRunStatus | undefined {
  if (!status) {
    return undefined;
  }

  const normalized = status.trim().toLowerCase().replace(/-/g, "_");
  switch (normalized) {
    case "finished":
    case "completed":
    case "success":
      return "completed";
    case "paused":
    case "waiting_approval":
      return "waiting_approval";
    case "waiting_resume":
    case "resumable":
      return "waiting_resume";
    case "blocked":
      return "blocked";
    case "failed":
    case "error":
      return "failed";
    default:
      return undefined;
  }
}

function toWorkflowRunStatus(
  status: SmithersRunStatus,
): WorkflowRunReference["status"] {
  if (status === "blocked") {
    return "failed";
  }
  return status;
}

function toEpisodeStatus(status: SmithersRunStatus): Episode["status"] {
  switch (status) {
    case "waiting_resume":
      return "waiting_input";
    case "waiting_approval":
      return "waiting_approval";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "completed":
      return "completed";
  }
}

function inferKnownWaitingStatus(input: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): Extract<SmithersRunStatus, "waiting_approval" | "waiting_resume"> | undefined {
  if (input.exitCode === 0) {
    return undefined;
  }

  const text = `${input.stdout}\n${input.stderr}`.toLowerCase();
  if (text.includes("waiting-approval") || text.includes("waiting_approval")) {
    return "waiting_approval";
  }
  if (text.includes("waiting-resume") || text.includes("waiting_resume")) {
    return "waiting_resume";
  }

  return undefined;
}

function resolveSmithersStatus(input: {
  parsedStatus: SmithersRunStatus | undefined;
  exitCode: number;
  stdout: string;
  stderr: string;
}): SmithersRunStatus {
  if (input.parsedStatus) {
    return input.parsedStatus;
  }

  const inferredWaiting = inferKnownWaitingStatus({
    exitCode: input.exitCode,
    stdout: input.stdout,
    stderr: input.stderr,
  });
  if (inferredWaiting) {
    return inferredWaiting;
  }

  return input.exitCode === 0 ? "completed" : "failed";
}

function createRunId(threadId: string): string {
  return `run:${threadId}:${Date.now()}`;
}

function sanitizeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function hashToken(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return Math.abs(hash).toString(36);
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function durableStatePath(runStateDir: string, runId: string): string {
  return resolve(runStateDir, "runs", `${sanitizeToken(runId)}.json`);
}

function persistDurableRunState(
  runStateDir: string,
  state: DurableRunState,
): void {
  ensureDir(resolve(runStateDir, "runs"));
  writeFileSync(
    durableStatePath(runStateDir, state.runId),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

function loadDurableRunState(
  runStateDir: string,
  runId: string,
): DurableRunState | undefined {
  const statePath = durableStatePath(runStateDir, runId);
  if (!existsSync(statePath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as Partial<DurableRunState>;
    if (
      typeof parsed.runId !== "string" ||
      typeof parsed.threadId !== "string" ||
      typeof parsed.workflowId !== "string" ||
      typeof parsed.cwd !== "string" ||
      typeof parsed.runStateStore !== "string" ||
      typeof parsed.logDir !== "string"
    ) {
      return undefined;
    }

    return {
      runId: parsed.runId,
      threadId: parsed.threadId,
      workflowId: parsed.workflowId,
      cwd: parsed.cwd,
      ...(typeof parsed.worktreePath === "string"
        ? { worktreePath: parsed.worktreePath }
        : {}),
      runStateStore: parsed.runStateStore,
      logDir: parsed.logDir,
    };
  } catch {
    return undefined;
  }
}

function isIncompatibleSmithersState(stderr: string): boolean {
  return (
    /no column named/i.test(stderr) ||
    /has no column named/i.test(stderr) ||
    /sqlite/i.test(stderr) ||
    /schema/i.test(stderr)
  );
}

function resetSmithersStateStore(runStateStore: string): void {
  for (const candidate of [
    runStateStore,
    `${runStateStore}-shm`,
    `${runStateStore}-wal`,
  ]) {
    try {
      rmSync(candidate, { force: true });
    } catch {
      // ignore best-effort reset
    }
  }
}

export function createSmithersCliBridge(
  config: SmithersCliConfig = {},
): SmithersWorkflowBridge {
  const smithersBinary = config.smithersBinary ?? "smithers";
  const runStateDir = config.runStateDir ?? "/tmp/hellm/smithers-runs";
  const workflowFile =
    config.workflowFile ??
    resolve(import.meta.dir, "workflows/bridge-runner.tsx");
  let enabled = true;
  const runStates = new Map<string, DurableRunState>();

  const createRunState = (request: SmithersRunRequest, runId: string): DurableRunState => {
    const cwd = resolve(request.cwd);
    const worktreePath = request.worktreePath
      ? resolve(request.worktreePath)
      : request.thread.worktreePath
        ? resolve(request.thread.worktreePath)
        : undefined;
    const scopeHash = hashToken(`${request.thread.id}:${worktreePath ?? cwd}`);
    const dbDir = resolve(runStateDir, "db", scopeHash);
    const logDir = resolve(runStateDir, "logs", scopeHash);
    ensureDir(dbDir);
    ensureDir(logDir);

    return {
      runId,
      threadId: request.thread.id,
      workflowId: request.workflow.workflowId,
      cwd,
      ...(worktreePath ? { worktreePath } : {}),
      runStateStore: resolve(dbDir, `${sanitizeToken(runId)}.sqlite`),
      logDir,
    };
  };

  const resolveRunState = (request: SmithersResumeRequest): DurableRunState | undefined => {
    const inMemory = runStates.get(request.runId);
    if (inMemory) {
      return inMemory;
    }
    const persisted = loadDurableRunState(runStateDir, request.runId);
    if (persisted) {
      runStates.set(request.runId, persisted);
      return persisted;
    }

    const cwd =
      request.cwd ??
      request.thread.worktreePath ??
      request.worktreePath;
    const runStateStore = request.runStateStore;
    if (!cwd && !runStateStore) {
      return undefined;
    }

    const scopeHash = hashToken(
      `${request.thread.id}:${request.worktreePath ?? request.thread.worktreePath ?? cwd ?? request.runId}`,
    );
    const logDir = resolve(runStateDir, "logs", scopeHash);
    ensureDir(logDir);
    const resumeWorktreePath = request.worktreePath ?? request.thread.worktreePath;
    const resolvedCwd = resolve(
      cwd ?? resumeWorktreePath ?? runStateDir,
    );

    return {
      runId: request.runId,
      threadId: request.thread.id,
      workflowId: `workflow:${request.thread.id}`,
      cwd: resolvedCwd,
      ...(resumeWorktreePath
        ? { worktreePath: resolve(resumeWorktreePath) }
        : {}),
      runStateStore:
        runStateStore ??
        resolve(runStateDir, "db", scopeHash, `${sanitizeToken(request.runId)}.sqlite`),
      logDir,
    };
  };

  const runSmithersCommand = async (input: {
    args: string[];
    cwd: string;
    runStateStore?: string;
    allowIncompatibleReset: boolean;
  }): Promise<{ stdout: string; stderr: string; exitCode: number; resetState: boolean }> => {
    const runOnce = async () => {
      const proc = Bun.spawn(input.args, {
        cwd: input.cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          ...(input.runStateStore
            ? {
                HELLM_SMITHERS_DB_PATH: input.runStateStore,
                SMITHERS_DB_PATH: input.runStateStore,
              }
            : {}),
        },
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      return { stdout, stderr, exitCode };
    };

    const first = await runOnce();
    if (
      first.exitCode !== 0 &&
      input.allowIncompatibleReset &&
      input.runStateStore &&
      isIncompatibleSmithersState(first.stderr)
    ) {
      resetSmithersStateStore(input.runStateStore);
      const second = await runOnce();
      return { ...second, resetState: true };
    }

    return { ...first, resetState: false };
  };

  return {
    get enabled() {
      return enabled;
    },
    engine: "smithers",
    async runWorkflow(request) {
      const now = new Date().toISOString();
      const runId = createRunId(request.thread.id);
      const runState = createRunState(request, runId);
      runStates.set(runId, runState);
      persistDurableRunState(runStateDir, runState);
      const workflowJson = JSON.stringify({
        workflow: request.workflow,
        thread: request.thread,
        objective: request.objective,
        cwd: request.cwd,
        worktreePath: request.worktreePath,
      });

      try {
        const {
          stdout,
          stderr,
          exitCode,
        } = await runSmithersCommand({
          args: [
            smithersBinary,
            "up",
            workflowFile,
            "--run-id",
            runId,
            "--input",
            workflowJson,
            "--root",
            runState.cwd,
            "--format",
            "json",
            "--log-dir",
            runState.logDir,
          ],
          cwd: runState.cwd,
          runStateStore: runState.runStateStore,
          allowIncompatibleReset: true,
        });

        const {
          outputs,
          status: parsedStatus,
          runId: parsedRunId,
        } = parseSmithersStdout(stdout);
        const status = resolveSmithersStatus({
          parsedStatus,
          exitCode,
          stdout,
          stderr,
        });
        const effectiveRunId = parsedRunId ?? runId;
        if (effectiveRunId !== runId) {
          const renamedState = {
            ...runState,
            runId: effectiveRunId,
          };
          runStates.delete(runId);
          runStates.set(effectiveRunId, renamedState);
          persistDurableRunState(runStateDir, renamedState);
        } else {
          persistDurableRunState(runStateDir, runState);
        }

        if (status === "waiting_approval") {
          return {
            run: {
              runId: effectiveRunId,
              threadId: request.thread.id,
              workflowId: request.workflow.workflowId,
              status: "waiting_approval",
              updatedAt: now,
              ...(request.worktreePath
                ? { worktreePath: request.worktreePath }
                : {}),
            },
              status: "waiting_approval",
              outputs,
              episode: createEpisode({
                id: `${request.thread.id}:smithers:${now}`,
              threadId: request.thread.id,
              source: "smithers",
              objective: request.objective,
              status: "waiting_approval",
              conclusions: ["Workflow paused pending approval."],
              followUpSuggestions: ["Approve or deny the workflow to continue."],
              provenance: {
                executionPath: "smithers-workflow",
                actor: "smithers",
                notes: "Smithers runtime signalled waiting_approval.",
              },
                smithersRunId: effectiveRunId,
              startedAt: now,
              completedAt: now,
              inputEpisodeIds: request.workflow.inputEpisodeIds,
              ...(request.worktreePath
                ? { worktreePath: request.worktreePath }
                : {}),
            }),
            approval: {
              nodeId: request.workflow.tasks.find((t) => t.needsApproval)?.id ?? request.workflow.tasks[0]?.id ?? "unknown",
              title: "Approve workflow step",
              summary: stderr || "Workflow requires approval.",
              mode: "needsApproval",
            },
            isolation: {
              runId: effectiveRunId,
              runStateStore: runState.runStateStore,
              sessionEntryIds: [],
            },
          };
        }

        if (status === "waiting_resume") {
          return {
            run: {
              runId: effectiveRunId,
              threadId: request.thread.id,
              workflowId: request.workflow.workflowId,
              status: "waiting_resume",
              updatedAt: now,
              ...(request.worktreePath
                ? { worktreePath: request.worktreePath }
                : {}),
            },
            status: "waiting_resume",
            outputs,
            episode: createEpisode({
              id: `${request.thread.id}:smithers:${now}`,
              threadId: request.thread.id,
              source: "smithers",
              objective: request.objective,
              status: "waiting_input",
              conclusions: ["Workflow paused awaiting resume."],
              followUpSuggestions: ["Resume the workflow to continue."],
              provenance: {
                executionPath: "smithers-workflow",
                actor: "smithers",
                notes: "Smithers runtime signalled waiting_resume.",
              },
              smithersRunId: effectiveRunId,
              startedAt: now,
              completedAt: now,
              inputEpisodeIds: request.workflow.inputEpisodeIds,
              ...(request.worktreePath
                ? { worktreePath: request.worktreePath }
                : {}),
            }),
            waitReason: stderr || "Workflow paused for external resume.",
            isolation: {
              runId: effectiveRunId,
              runStateStore: runState.runStateStore,
              sessionEntryIds: [],
            },
          };
        }

        return {
          run: {
            runId: effectiveRunId,
            threadId: request.thread.id,
            workflowId: request.workflow.workflowId,
            status: toWorkflowRunStatus(status),
            updatedAt: now,
            ...(request.worktreePath
              ? { worktreePath: request.worktreePath }
              : {}),
          },
          status,
          outputs,
          episode: createEpisode({
            id: `${request.thread.id}:smithers:${now}`,
            threadId: request.thread.id,
            source: "smithers",
            objective: request.objective,
            status: toEpisodeStatus(status),
            conclusions:
              status === "completed"
                ? [stdout.trim() || "Workflow completed."]
                : status === "blocked"
                  ? [stderr || "Workflow blocked."]
                  : [`Workflow failed with exit code ${exitCode}.`],
            unresolvedIssues:
              status === "failed" ? [stderr || `Exit code ${exitCode}`] : [],
            provenance: {
              executionPath: "smithers-workflow",
              actor: "smithers",
              notes: "Smithers CLI workflow execution.",
            },
            smithersRunId: effectiveRunId,
            startedAt: now,
            completedAt: now,
            inputEpisodeIds: request.workflow.inputEpisodeIds,
            ...(request.worktreePath
              ? { worktreePath: request.worktreePath }
              : {}),
          }),
          ...(status === "failed"
            ? { retryCount: 0 }
            : {}),
          isolation: {
            runId: effectiveRunId,
            runStateStore: runState.runStateStore,
            sessionEntryIds: [],
          },
        };
      } catch (error) {
        return {
          run: {
            runId,
            threadId: request.thread.id,
            workflowId: request.workflow.workflowId,
            status: "failed",
            updatedAt: now,
          },
          status: "failed",
          outputs: [],
          episode: createEpisode({
            id: `${request.thread.id}:smithers:${now}`,
            threadId: request.thread.id,
            source: "smithers",
            objective: request.objective,
            status: "failed",
            conclusions: ["Smithers workflow engine error."],
            unresolvedIssues: [
              error instanceof Error ? error.message : String(error),
            ],
            provenance: {
              executionPath: "smithers-workflow",
              actor: "smithers",
              notes: "Smithers CLI bridge caught an exception.",
            },
            smithersRunId: runId,
            startedAt: now,
            completedAt: now,
            inputEpisodeIds: request.workflow.inputEpisodeIds,
          }),
          isolation: {
            runId,
            runStateStore: runState.runStateStore,
            sessionEntryIds: [],
          },
        };
      }
    },
    async resumeWorkflow(request) {
      const now = new Date().toISOString();
      const runState = resolveRunState(request);
      const cwd =
        runState?.cwd ??
        request.thread.worktreePath ??
        request.worktreePath ??
        request.cwd ??
        process.cwd();
      const runWorktreePath =
        runState?.worktreePath ??
        request.thread.worktreePath ??
        request.worktreePath;
      if (runState) {
        runStates.set(request.runId, runState);
        persistDurableRunState(runStateDir, runState);
      }
      const workflowJson = JSON.stringify({
        workflow: {
          workflowId: `workflow:${request.thread.id}`,
          objective: request.objective,
        },
        objective: request.objective,
        thread: request.thread,
      });

      try {
        const { stdout, stderr, exitCode } = await runSmithersCommand({
          args: [
            smithersBinary,
            "up",
            workflowFile,
            "--run-id",
            request.runId,
            "--resume",
            "true",
            "--input",
            workflowJson,
            "--root",
            cwd,
            "--format",
            "json",
            "--log-dir",
            runState?.logDir ?? runStateDir,
          ],
          cwd,
          ...((runState?.runStateStore ?? request.runStateStore)
            ? { runStateStore: runState?.runStateStore ?? request.runStateStore }
            : {}),
          allowIncompatibleReset: false,
        });

        const { outputs, status: parsedStatus } = parseSmithersStdout(stdout);
        const status = resolveSmithersStatus({
          parsedStatus,
          exitCode,
          stdout,
          stderr,
        });

        if (status === "waiting_approval") {
          return {
            run: {
              runId: request.runId,
              threadId: request.thread.id,
              workflowId: `workflow:${request.thread.id}`,
              status: "waiting_approval",
              updatedAt: now,
              ...(runWorktreePath ? { worktreePath: runWorktreePath } : {}),
            },
            status: "waiting_approval",
            outputs,
            episode: createEpisode({
              id: `${request.thread.id}:smithers:resume:${now}`,
              threadId: request.thread.id,
              source: "smithers",
              objective: request.objective,
              status: "waiting_approval",
              conclusions: ["Resumed workflow now waiting for approval."],
              provenance: {
                executionPath: "smithers-workflow",
                actor: "smithers",
                notes: "Smithers CLI resume returned waiting_approval.",
              },
              smithersRunId: request.runId,
              startedAt: now,
              completedAt: now,
              inputEpisodeIds: [],
              ...(runWorktreePath ? { worktreePath: runWorktreePath } : {}),
            }),
            approval: {
              nodeId: "resume-approval",
              title: "Approve resumed workflow",
              summary: stdout || "Resumed workflow awaiting approval.",
              mode: "needsApproval",
            },
            ...(runState?.runStateStore
              ? {
                  isolation: {
                    runId: request.runId,
                    runStateStore: runState.runStateStore,
                    sessionEntryIds: [],
                  },
                }
              : {}),
          };
        }

        if (status === "waiting_resume") {
          return {
            run: {
              runId: request.runId,
              threadId: request.thread.id,
              workflowId: `workflow:${request.thread.id}`,
              status: "waiting_resume",
              updatedAt: now,
              ...(runWorktreePath ? { worktreePath: runWorktreePath } : {}),
            },
            status: "waiting_resume",
            outputs,
            episode: createEpisode({
              id: `${request.thread.id}:smithers:resume:${now}`,
              threadId: request.thread.id,
              source: "smithers",
              objective: request.objective,
              status: "waiting_input",
              conclusions: ["Resumed workflow still waiting to continue."],
              followUpSuggestions: ["Resume the workflow again once unblocked."],
              provenance: {
                executionPath: "smithers-workflow",
                actor: "smithers",
                notes: "Smithers CLI resume returned waiting_resume.",
              },
              smithersRunId: request.runId,
              startedAt: now,
              completedAt: now,
              inputEpisodeIds: [],
              ...(runWorktreePath ? { worktreePath: runWorktreePath } : {}),
            }),
            waitReason: stderr || "Resumed workflow still waiting for external input.",
            ...(runState?.runStateStore
              ? {
                  isolation: {
                    runId: request.runId,
                    runStateStore: runState.runStateStore,
                    sessionEntryIds: [],
                  },
                }
              : {}),
          };
        }

        return {
          run: {
            runId: request.runId,
            threadId: request.thread.id,
            workflowId: `workflow:${request.thread.id}`,
            status: toWorkflowRunStatus(status),
            updatedAt: now,
            ...(runWorktreePath ? { worktreePath: runWorktreePath } : {}),
          },
          status,
          outputs,
          episode: createEpisode({
            id: `${request.thread.id}:smithers:resume:${now}`,
            threadId: request.thread.id,
            source: "smithers",
            objective: request.objective,
            status: toEpisodeStatus(status),
            conclusions:
              status === "completed"
                ? [stdout.trim() || "Resumed workflow completed."]
                : status === "blocked"
                  ? [stderr || "Resumed workflow is blocked."]
                  : [`Resumed workflow failed with exit code ${exitCode}.`],
            unresolvedIssues:
              status === "failed" ? [stderr || `Exit code ${exitCode}`] : [],
            provenance: {
              executionPath: "smithers-workflow",
              actor: "smithers",
              notes: "Smithers CLI resume execution.",
            },
            smithersRunId: request.runId,
            startedAt: now,
            completedAt: now,
            inputEpisodeIds: [],
            ...(runWorktreePath ? { worktreePath: runWorktreePath } : {}),
          }),
          ...(runState?.runStateStore
            ? {
                isolation: {
                  runId: request.runId,
                  runStateStore: runState.runStateStore,
                  sessionEntryIds: [],
                },
              }
            : {}),
        };
      } catch (error) {
        return {
          run: {
            runId: request.runId,
            threadId: request.thread.id,
            workflowId: `workflow:${request.thread.id}`,
            status: "failed",
            updatedAt: now,
          },
          status: "failed",
          outputs: [],
          episode: createEpisode({
            id: `${request.thread.id}:smithers:resume:${now}`,
            threadId: request.thread.id,
            source: "smithers",
            objective: request.objective,
            status: "failed",
            conclusions: ["Smithers resume failed."],
            unresolvedIssues: [
              error instanceof Error ? error.message : String(error),
            ],
            provenance: {
              executionPath: "smithers-workflow",
              actor: "smithers",
              notes: "Smithers CLI resume bridge caught an exception.",
            },
            smithersRunId: request.runId,
            startedAt: now,
            completedAt: now,
            inputEpisodeIds: [],
          }),
          ...(runState?.runStateStore
            ? {
                isolation: {
                  runId: request.runId,
                  runStateStore: runState.runStateStore,
                  sessionEntryIds: [],
                },
              }
            : {}),
        };
      }
    },
    async approveRun(runId, decision) {
      const runState =
        runStates.get(runId) ?? loadDurableRunState(runStateDir, runId);
      if (runState) {
        runStates.set(runId, runState);
      }
      const cwd = runState?.cwd ?? process.cwd();
      const args = [
        smithersBinary,
        "approve",
        runId,
        ...(decision.decidedBy ? ["--by", decision.decidedBy] : []),
        ...(decision.note ? ["--note", decision.note] : []),
      ];
      const proc = Bun.spawn(args, {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          ...(runState?.runStateStore
            ? {
                HELLM_SMITHERS_DB_PATH: runState.runStateStore,
                SMITHERS_DB_PATH: runState.runStateStore,
              }
            : {}),
        },
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new SmithersDecisionError({
          action: "approve",
          runId,
          exitCode,
          stdout,
          stderr,
        });
      }
    },
    async denyRun(runId, decision) {
      const runState =
        runStates.get(runId) ?? loadDurableRunState(runStateDir, runId);
      if (runState) {
        runStates.set(runId, runState);
      }
      const cwd = runState?.cwd ?? process.cwd();
      const args = [
        smithersBinary,
        "deny",
        runId,
        ...(decision.decidedBy ? ["--by", decision.decidedBy] : []),
        ...(decision.note ? ["--note", decision.note] : []),
      ];
      const proc = Bun.spawn(args, {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          ...(runState?.runStateStore
            ? {
                HELLM_SMITHERS_DB_PATH: runState.runStateStore,
                SMITHERS_DB_PATH: runState.runStateStore,
              }
            : {}),
        },
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new SmithersDecisionError({
          action: "deny",
          runId,
          exitCode,
          stdout,
          stderr,
        });
      }
    },
  };
}

export function createSmithersWorkflowBridge(
  config?: SmithersCliConfig,
): SmithersWorkflowBridge {
  return createSmithersCliBridge(config);
}
