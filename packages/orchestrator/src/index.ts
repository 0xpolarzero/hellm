import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import {
  createEmptySessionState,
  createEpisode,
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createStructuredSessionEntry,
  createThread,
  createThreadSnapshot,
  reconstructSessionState,
  type ArtifactRecord,
  type Episode,
  type GlobalVerificationState,
  type HellmExecutionPath,
  type SessionJsonlEntry,
  type SessionState,
  type SessionWorktreeAlignmentState,
  type StructuredSessionEntry,
  type ThreadKind,
  type ThreadRef,
  type ThreadSnapshot,
  type ThreadStatus,
  type VerificationKind,
  type WorkflowRunReference,
} from "@hellm/session-model";
import {
  createPiRuntimeBridge,
  createPiWorkerRequest,
  normalizePiWorkerResult,
  type PiRuntimeBridge,
} from "@hellm/pi-bridge";
import {
  authorWorkflow,
  createSmithersWorkflowBridge,
  translateSmithersRunToEpisode,
  type SmithersApprovalDecision,
  type WorkflowTaskCompletionCondition,
  type WorkflowTaskScopedContext,
  type SmithersWorkflowBridge,
  type WorkflowTaskSpec,
  type WorkflowTaskToolScope,
} from "@hellm/smithers-bridge";
import {
  createVerificationRunner,
  normalizeVerificationRunToEpisode,
  type VerificationRunner,
} from "@hellm/verification";

export interface WorkflowSeedInput {
  objective?: string;
  preferredPath?: HellmExecutionPath;
  verificationKinds?: VerificationKind[];
  manualChecks?: string[];
  tasks?: WorkflowTaskSpec[];
  metadata?: Record<string, unknown>;
}

export interface OrchestratorRequest {
  threadId: string;
  prompt: string;
  cwd: string;
  worktreePath?: string;
  routeHint?: HellmExecutionPath | "auto";
  requireApproval?: boolean;
  workflowSeedInput?: WorkflowSeedInput;
  resumeRunId?: string;
  approvalDecision?: {
    runId: string;
    approved: boolean;
    note?: string;
    decidedAt?: string;
    decidedBy?: string;
  };
}

export interface ContextSnapshot {
  sessionHistory: SessionJsonlEntry[];
  repoAndWorktree: {
    cwd: string;
    worktreePath?: string;
  };
  agentsInstructions: string[];
  relevantSkills: string[];
  priorEpisodes: Episode[];
  priorArtifacts: ArtifactRecord[];
  state: SessionState;
}

export interface ContextLoader {
  load(request: OrchestratorRequest): Promise<ContextSnapshot>;
}

export interface ContextLoaderSources {
  loadSessionHistory?: (
    request: OrchestratorRequest,
  ) => Promise<SessionJsonlEntry[]>;
  loadRepoAndWorktree?: (
    request: OrchestratorRequest,
  ) => Promise<{ cwd: string; worktreePath?: string }>;
  loadAgentsInstructions?: (request: OrchestratorRequest) => Promise<string[]>;
  loadRelevantSkills?: (request: OrchestratorRequest) => Promise<string[]>;
  loadState?: (request: OrchestratorRequest) => Promise<SessionState>;
}

export interface RequestClassification {
  path: HellmExecutionPath;
  confidence: "hint" | "high" | "medium";
  reason: string;
}

export type RequestClassifier = (
  request: OrchestratorRequest,
  context: ContextSnapshot,
) => RequestClassification;

export interface CompletionDecision {
  isComplete: boolean;
  reason:
    | "completed"
    | "waiting_input"
    | "waiting_approval"
    | "blocked"
    | "failed"
    | "cancelled";
}

export interface OrchestratorState {
  thread: ThreadRef;
  latestEpisode: Episode;
  verification: GlobalVerificationState;
  alignment: SessionWorktreeAlignmentState;
  workflowRuns: WorkflowRunReference[];
  waiting: boolean;
  blocked: boolean;
  visibleSummary: string;
}

export interface OrchestratorRunResult {
  classification: RequestClassification;
  context: ContextSnapshot;
  threadSnapshot: ThreadSnapshot;
  state: OrchestratorState;
  sessionState: SessionState;
  sessionEntries: StructuredSessionEntry[];
  completion: CompletionDecision;
}

export interface OrchestratorDependencies {
  contextLoader?: ContextLoader;
  classifier?: RequestClassifier;
  piBridge?: PiRuntimeBridge;
  smithersBridge?: SmithersWorkflowBridge;
  verificationRunner?: VerificationRunner;
  clock?: () => string;
  idGenerator?: () => string;
}

export interface Orchestrator {
  readonly id: string;
  loadContext(request: OrchestratorRequest): Promise<ContextSnapshot>;
  classifyRequest(
    request: OrchestratorRequest,
    context: ContextSnapshot,
  ): RequestClassification;
  run(request: OrchestratorRequest): Promise<OrchestratorRunResult>;
}

export function createContextLoader(
  sources: ContextLoaderSources = {},
): ContextLoader {
  return {
    async load(request) {
      const repoAndWorktree =
        (await sources.loadRepoAndWorktree?.(request)) ?? {
          cwd: request.cwd,
          ...(request.worktreePath ? { worktreePath: request.worktreePath } : {}),
        };

      const state =
        (await sources.loadState?.(request)) ??
        createEmptySessionState({
          sessionId: request.threadId,
          sessionCwd: repoAndWorktree.cwd,
          ...(repoAndWorktree.worktreePath
            ? { activeWorktreePath: repoAndWorktree.worktreePath }
            : {}),
        });

      return {
        sessionHistory: (await sources.loadSessionHistory?.(request)) ?? [],
        repoAndWorktree,
        agentsInstructions: (await sources.loadAgentsInstructions?.(request)) ?? [],
        relevantSkills: (await sources.loadRelevantSkills?.(request)) ?? [],
        priorEpisodes: state.episodes,
        priorArtifacts: state.artifacts,
        state,
      };
    },
  };
}

export interface FilesystemContextLoaderConfig {
  sessionFile: string;
  agentsFile?: string;
  skillsRoot?: string;
}

function readSessionFileFromDisk(filePath: string): SessionJsonlEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }

  return readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SessionJsonlEntry);
}

function readAgentsInstructionsFromDisk(filePath: string): string[] {
  if (!existsSync(filePath)) {
    return [];
  }

  return readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readSkillsFromDisk(skillsRoot: string): string[] {
  if (!existsSync(skillsRoot)) {
    return [];
  }

  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) =>
      existsSync(`${skillsRoot}/${entry.name}/SKILL.md`),
    )
    .map((entry) => entry.name);
}

export function createFilesystemContextLoader(
  config: FilesystemContextLoaderConfig,
): ContextLoader {
  return {
    async load(request) {
      const sessionHistory = readSessionFileFromDisk(config.sessionFile);
      const state = sessionHistory.length
        ? reconstructSessionState(sessionHistory)
        : createEmptySessionState({
            sessionId: request.threadId,
            sessionCwd: request.cwd,
            ...(request.worktreePath
              ? { activeWorktreePath: request.worktreePath }
              : {}),
          });

      return {
        sessionHistory,
        repoAndWorktree: {
          cwd: request.cwd,
          ...(request.worktreePath ? { worktreePath: request.worktreePath } : {}),
        },
        agentsInstructions: config.agentsFile
          ? readAgentsInstructionsFromDisk(config.agentsFile)
          : [],
        relevantSkills: config.skillsRoot
          ? readSkillsFromDisk(config.skillsRoot)
          : [],
        priorEpisodes: state.episodes,
        priorArtifacts: state.artifacts,
        state,
      };
    },
  };
}

export function createOrchestrator(
  dependencies: OrchestratorDependencies = {},
): Orchestrator {
  const contextLoader = dependencies.contextLoader ?? createContextLoader();
  const classifier = dependencies.classifier ?? defaultClassifier;
  const piBridge = dependencies.piBridge ?? createPiRuntimeBridge();
  const smithersBridge =
    dependencies.smithersBridge ?? createSmithersWorkflowBridge();
  const verificationRunner =
    dependencies.verificationRunner ?? createVerificationRunner();
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const idGenerator = dependencies.idGenerator ?? createIdGenerator();

  return {
    id: "main",
    async loadContext(request) {
      return contextLoader.load(request);
    },
    classifyRequest(request, context) {
      return classifier(request, context);
    },
    async run(request) {
      const context = await contextLoader.load(request);
      const classification = classifier(request, context);
      const now = clock();
      const objective = request.workflowSeedInput?.objective ?? request.prompt;
      const inputEpisodeIds = context.priorEpisodes.map((episode) => episode.id);
      const requestedWorktreePath =
        request.worktreePath ?? context.repoAndWorktree.worktreePath;

      const initialThread =
        context.state.threads.find((thread) => thread.id === request.threadId) ??
        createThread({
          id: request.threadId,
          kind: executionPathToThreadKind(classification.path),
          objective,
          inputEpisodeIds,
          status: "running",
          ...(requestedWorktreePath ? { worktreePath: requestedWorktreePath } : {}),
          createdAt: now,
          updatedAt: now,
        });

      const execution = await executePath({
        request,
        context,
        classification,
        thread: initialThread,
        now,
        inputEpisodeIds,
        piBridge,
        smithersBridge,
        verificationRunner,
      });

      const updatedThread: ThreadRef = {
        ...initialThread,
        kind: executionPathToThreadKind(classification.path),
        inputEpisodeIds,
        status: statusFromEpisode(execution.episode.status),
        ...(execution.workflowRun
          ? { smithersRunId: execution.workflowRun.runId }
          : {}),
        updatedAt: now,
      };
      const activeWorktreePath =
        updatedThread.worktreePath ?? context.repoAndWorktree.worktreePath;

      const sessionState: SessionState = {
        ...context.state,
        sessionId: context.state.sessionId || request.threadId,
        sessionCwd: context.repoAndWorktree.cwd,
        threads: replaceThread(context.state.threads, updatedThread),
        episodes: [...context.state.episodes, execution.episode],
        artifacts: replaceArtifacts(context.state.artifacts, execution.episode),
        verification: createGlobalVerificationState([
          ...Object.values(context.state.verification.byKind),
          ...execution.episode.verification,
        ]),
        alignment: createSessionWorktreeAlignment({
          sessionCwd: context.repoAndWorktree.cwd,
          ...(activeWorktreePath ? { activeWorktreePath } : {}),
        }),
        workflowRuns: replaceWorkflowRuns(
          context.state.workflowRuns,
          execution.workflowRun,
        ),
        smithersIsolations: replaceSmithersIsolations(
          context.state.smithersIsolations,
          execution.smithersIsolation,
        ),
      };

      const threadSnapshot = createThreadSnapshot(sessionState, updatedThread.id);
      const sessionEntries = buildStructuredEntries({
        existingEntries: context.sessionHistory,
        thread: updatedThread,
        episode: execution.episode,
        verification: sessionState.verification,
        alignment: sessionState.alignment,
        ...(execution.workflowRun ? { workflowRun: execution.workflowRun } : {}),
        ...(execution.smithersIsolation
          ? { smithersIsolation: execution.smithersIsolation }
          : {}),
        idGenerator,
        timestamp: now,
      });
      const completion = createCompletionDecision(execution.episode.status);

      return {
        classification,
        context,
        threadSnapshot,
        sessionState,
        sessionEntries,
        completion,
        state: {
          thread: updatedThread,
          latestEpisode: execution.episode,
          verification: sessionState.verification,
          alignment: sessionState.alignment,
          workflowRuns: threadSnapshot.workflowRuns,
          waiting:
            updatedThread.status === "waiting_input" ||
            updatedThread.status === "waiting_approval",
          blocked: updatedThread.status === "blocked",
          visibleSummary: `${classification.path}:${updatedThread.status}:${execution.episode.status}`,
        },
      };
    },
  };
}

const DIRECT_INTENT_SIGNALS = [
  "what",
  "explain",
  "describe",
  "show",
  "list",
  "summarize",
  "tell me",
  "help",
  "why",
  "how does",
];

function isSmallLocalIntent(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim();
  if (lower.length < 80) {
    return DIRECT_INTENT_SIGNALS.some((signal) => lower.startsWith(signal));
  }
  return false;
}

function defaultClassifier(
  request: OrchestratorRequest,
  _context: ContextSnapshot,
): RequestClassification {
  if (request.routeHint && request.routeHint !== "auto") {
    return {
      path: request.routeHint,
      confidence: "hint",
      reason: "Explicit route hint supplied by caller.",
    };
  }

  if (request.workflowSeedInput?.preferredPath) {
    return {
      path: request.workflowSeedInput.preferredPath,
      confidence: "hint",
      reason: "Structured workflow seed requested a preferred path.",
    };
  }

  if (request.approvalDecision) {
    return {
      path: "smithers-workflow",
      confidence: "high",
      reason:
        "Request includes an explicit approval decision for a Smithers run.",
    };
  }

  if (request.requireApproval) {
    return {
      path: "approval",
      confidence: "high",
      reason: "Request requires approval or clarification.",
    };
  }

  if (request.prompt.toLowerCase().includes("verify")) {
    return {
      path: "verification",
      confidence: "medium",
      reason: "Prompt emphasizes verification work.",
    };
  }

  if (isSmallLocalIntent(request.prompt)) {
    return {
      path: "direct",
      confidence: "medium",
      reason: "Short question or explanation request classified as small local work.",
    };
  }

  if (request.workflowSeedInput?.tasks && request.workflowSeedInput.tasks.length > 0) {
    return {
      path: "smithers-workflow",
      confidence: "high",
      reason: "Structured workflow seed includes bounded tasks; routing to delegated workflow path.",
    };
  }

  return {
    path: "smithers-workflow",
    confidence: "medium",
    reason: "Defaulted to delegated workflow path for bounded subagent work per PRD delegated-work policy.",
  };
}

function createIdGenerator(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `hellm-${counter.toString(16).padStart(4, "0")}`;
  };
}

function executionPathToThreadKind(path: HellmExecutionPath): ThreadKind {
  switch (path) {
    case "direct":
      return "direct";
    case "pi-worker":
      return "pi-worker";
    case "smithers-workflow":
      return "smithers-workflow";
    case "verification":
      return "verification";
    case "approval":
      return "approval";
  }
}

function statusFromEpisode(status: Episode["status"]): ThreadStatus {
  switch (status) {
    case "completed":
    case "completed_with_issues":
      return "completed";
    case "waiting_input":
      return "waiting_input";
    case "waiting_approval":
      return "waiting_approval";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

function createPiTaskScopedContext(input: {
  context: ContextSnapshot;
  inputEpisodeIds: string[];
  worktreePath?: string;
}): WorkflowTaskScopedContext {
  const relevantPaths = [input.context.repoAndWorktree.cwd];
  if (input.worktreePath) {
    relevantPaths.push(input.worktreePath);
  }

  return {
    sessionHistory: input.context.sessionHistory.map((entry) =>
      JSON.stringify(entry),
    ),
    relevantPaths,
    agentsInstructions: input.context.agentsInstructions,
    relevantSkills: input.context.relevantSkills,
    priorEpisodeIds: input.inputEpisodeIds,
  };
}

function createPiTaskToolScope(input: {
  cwd: string;
  worktreePath?: string;
}): WorkflowTaskToolScope {
  return {
    allow: ["read", "edit", "bash"],
    writeRoots: [input.worktreePath ?? input.cwd],
    readOnly: false,
  };
}

function createPiTaskCompletionCondition(): WorkflowTaskCompletionCondition {
  return {
    type: "episode-produced",
    maxTurns: 1,
  };
}

function enrichWorkflowTask(input: {
  task: WorkflowTaskSpec;
  context: ContextSnapshot;
  inputEpisodeIds: string[];
  thread: ThreadRef;
}): WorkflowTaskSpec {
  if (input.task.agent !== "pi") {
    return input.task;
  }

  const worktreePath = input.task.worktreePath ?? input.thread.worktreePath;
  const scopedContext =
    input.task.scopedContext ??
    createPiTaskScopedContext({
      context: input.context,
      inputEpisodeIds: input.inputEpisodeIds,
      ...(worktreePath ? { worktreePath } : {}),
    });
  const toolScope =
    input.task.toolScope ??
    createPiTaskToolScope({
      cwd: input.context.repoAndWorktree.cwd,
      ...(worktreePath ? { worktreePath } : {}),
    });

  return {
    ...input.task,
    ...(worktreePath ? { worktreePath } : {}),
    scopedContext,
    toolScope,
    completionCondition:
      input.task.completionCondition ?? createPiTaskCompletionCondition(),
  };
}

async function executePath(input: {
  request: OrchestratorRequest;
  context: ContextSnapshot;
  classification: RequestClassification;
  thread: ThreadRef;
  now: string;
  inputEpisodeIds: string[];
  piBridge: PiRuntimeBridge;
  smithersBridge: SmithersWorkflowBridge;
  verificationRunner: VerificationRunner;
  }): Promise<{
  episode: Episode;
  workflowRun?: WorkflowRunReference;
  smithersIsolation?: SessionState["smithersIsolations"][number];
}> {
  switch (input.classification.path) {
    case "direct":
      const directWorktreePath =
        input.thread.worktreePath ?? input.context.repoAndWorktree.worktreePath;
      return {
        episode: createEpisode({
          id: `${input.thread.id}:direct:${input.now}`,
          threadId: input.thread.id,
          source: "orchestrator",
          objective: input.thread.objective,
          status: "completed",
          conclusions: [input.request.prompt],
          provenance: {
            executionPath: "direct",
            actor: "orchestrator",
            notes: "Direct path normalized into an episode.",
          },
          startedAt: input.now,
          completedAt: input.now,
          inputEpisodeIds: input.inputEpisodeIds,
          ...(directWorktreePath ? { worktreePath: directWorktreePath } : {}),
        }),
      };
    case "approval":
      return {
        episode: createEpisode({
          id: `${input.thread.id}:approval:${input.now}`,
          threadId: input.thread.id,
          source: "orchestrator",
          objective: input.thread.objective,
          status: input.request.requireApproval
            ? "waiting_approval"
            : "waiting_input",
          followUpSuggestions: [
            input.request.requireApproval
              ? "Await explicit approval before resuming work."
              : "Collect the missing user clarification before resuming work.",
          ],
          provenance: {
            executionPath: "approval",
            actor: "orchestrator",
            notes: "Approval and clarification paths are explicit state transitions.",
          },
          startedAt: input.now,
          completedAt: input.now,
          inputEpisodeIds: input.inputEpisodeIds,
        }),
      };
    case "pi-worker": {
      const result = await input.piBridge.runWorker(
        createPiWorkerRequest({
          path: "pi-worker",
          thread: input.thread,
          objective: input.thread.objective,
          cwd: input.context.repoAndWorktree.cwd,
          inputEpisodeIds: input.inputEpisodeIds,
          scopedContext: {
            sessionHistory: input.context.sessionHistory.map((entry) =>
              JSON.stringify(entry),
            ),
            relevantPaths: [
              input.context.repoAndWorktree.cwd,
              ...(input.context.repoAndWorktree.worktreePath
                ? [input.context.repoAndWorktree.worktreePath]
                : []),
            ],
            agentsInstructions: input.context.agentsInstructions,
            relevantSkills: input.context.relevantSkills,
            priorEpisodeIds: input.inputEpisodeIds,
          },
          toolScope: {
            allow: ["read", "edit", "bash"],
            writeRoots: [input.context.repoAndWorktree.cwd],
          },
          completion: {
            type: "episode-produced",
            maxTurns: 1,
          },
          runtimeTransition: {
            reason: input.request.resumeRunId ? "resume" : "new",
            toSessionId: `${input.thread.id}:pi`,
            aligned: !input.thread.worktreePath,
            ...(input.thread.worktreePath
              ? { toWorktreePath: input.thread.worktreePath }
              : {}),
          },
        }),
      );
      return {
        episode: normalizePiWorkerResult(result),
      };
    }
    case "smithers-workflow": {
      const resumeRunId =
        input.request.resumeRunId ?? input.request.approvalDecision?.runId;
      if (
        input.request.resumeRunId &&
        input.request.approvalDecision &&
        input.request.approvalDecision.runId !== input.request.resumeRunId
      ) {
        throw new Error(
          `Approval decision runId "${input.request.approvalDecision.runId}" does not match resumeRunId "${input.request.resumeRunId}".`,
        );
      }

      if (resumeRunId && input.request.approvalDecision) {
        const decision: SmithersApprovalDecision = {
          approved: input.request.approvalDecision.approved,
          ...(input.request.approvalDecision.note
            ? { note: input.request.approvalDecision.note }
            : {}),
          ...(input.request.approvalDecision.decidedAt
            ? { decidedAt: input.request.approvalDecision.decidedAt }
            : {}),
          ...(input.request.approvalDecision.decidedBy
            ? { decidedBy: input.request.approvalDecision.decidedBy }
            : {}),
        };
        if (decision.approved) {
          await input.smithersBridge.approveRun(resumeRunId, decision);
        } else {
          await input.smithersBridge.denyRun(resumeRunId, decision);
        }
      }

      const tasks =
        input.request.workflowSeedInput?.tasks?.map((task) =>
          enrichWorkflowTask({
            task,
            context: input.context,
            inputEpisodeIds: input.inputEpisodeIds,
            thread: input.thread,
          }),
        ) ??
        [
          enrichWorkflowTask({
            task: {
              id: "pi-task",
              outputKey: "result",
              prompt: input.request.prompt,
              agent: "pi",
              ...(input.request.requireApproval !== undefined
                ? { needsApproval: input.request.requireApproval }
                : {}),
            },
            context: input.context,
            inputEpisodeIds: input.inputEpisodeIds,
            thread: input.thread,
          }),
        ];
      const workflow = authorWorkflow({
        thread: input.thread,
        objective: input.thread.objective,
        inputEpisodeIds: input.inputEpisodeIds,
        tasks,
      });
      const persistedIsolation = input.context.state.smithersIsolations.find(
        (isolation) => isolation.runId === resumeRunId,
      );
      const runResult = resumeRunId
        ? await input.smithersBridge.resumeWorkflow({
            runId: resumeRunId,
            thread: input.thread,
            objective: input.thread.objective,
            cwd: input.context.repoAndWorktree.cwd,
            ...(input.thread.worktreePath
              ? { worktreePath: input.thread.worktreePath }
              : {}),
            ...(persistedIsolation
              ? { runStateStore: persistedIsolation.runStateStore }
              : {}),
          })
        : await input.smithersBridge.runWorkflow({
            path: "smithers-workflow",
            thread: input.thread,
            objective: input.thread.objective,
            cwd: input.context.repoAndWorktree.cwd,
            workflow,
            ...(input.thread.worktreePath
              ? { worktreePath: input.thread.worktreePath }
              : {}),
          });
      const baseEpisode = translateSmithersRunToEpisode(runResult);
      const approvalDecision = input.request.approvalDecision;
      const episode =
        resumeRunId && approvalDecision
          ? {
              ...baseEpisode,
              conclusions: [
                `Approval decision applied before resume for run "${resumeRunId}": ${approvalDecision.approved ? "approved" : "denied"}.`,
                ...baseEpisode.conclusions,
              ],
              followUpSuggestions: approvalDecision.approved
                ? baseEpisode.followUpSuggestions
                : [
                    ...(baseEpisode.followUpSuggestions.length > 0
                      ? baseEpisode.followUpSuggestions
                      : ["Review denial and provide next-step guidance."]),
                  ],
              provenance: {
                ...baseEpisode.provenance,
                notes: [
                  baseEpisode.provenance.notes,
                  `Decision: ${approvalDecision.approved ? "approved" : "denied"}.`,
                ]
                  .filter((value) => typeof value === "string" && value.length > 0)
                  .join(" "),
              },
            }
          : baseEpisode;

      return {
        episode,
        workflowRun: runResult.run,
        ...(runResult.isolation
          ? { smithersIsolation: runResult.isolation }
          : {}),
      };
    }
    case "verification": {
      const verificationResult = await input.verificationRunner.run({
        threadId: input.thread.id,
        cwd: input.context.repoAndWorktree.cwd,
        objective: input.thread.objective,
        kinds:
          input.request.workflowSeedInput?.verificationKinds ?? [
            "build",
            "test",
            "lint",
            "integration",
          ],
        ...(input.request.workflowSeedInput?.manualChecks
          ? { manualChecks: input.request.workflowSeedInput.manualChecks }
          : {}),
      });
      return {
        episode: normalizeVerificationRunToEpisode({
          threadId: input.thread.id,
          objective: input.thread.objective,
          result: verificationResult,
          startedAt: input.now,
          completedAt: input.now,
          inputEpisodeIds: input.inputEpisodeIds,
        }),
      };
    }
  }
}

function replaceThread(threads: ThreadRef[], thread: ThreadRef): ThreadRef[] {
  const next = [...threads];
  const index = next.findIndex((candidate) => candidate.id === thread.id);
  if (index === -1) {
    next.push(thread);
    return next;
  }

  next[index] = thread;
  return next;
}

function replaceArtifacts(
  existingArtifacts: ArtifactRecord[],
  episode: Episode,
): ArtifactRecord[] {
  const next = [...existingArtifacts];
  for (const artifact of episode.artifacts) {
    const index = next.findIndex((candidate) => candidate.id === artifact.id);
    if (index === -1) {
      next.push(artifact);
      continue;
    }

    next[index] = artifact;
  }

  return next;
}

function replaceWorkflowRuns(
  existingRuns: WorkflowRunReference[],
  workflowRun?: WorkflowRunReference,
): WorkflowRunReference[] {
  if (!workflowRun) {
    return existingRuns;
  }

  const next = [...existingRuns];
  const index = next.findIndex((candidate) => candidate.runId === workflowRun.runId);
  if (index === -1) {
    next.push(workflowRun);
    return next;
  }

  next[index] = workflowRun;
  return next;
}

function replaceSmithersIsolations(
  existingIsolations: SessionState["smithersIsolations"],
  isolation?: SessionState["smithersIsolations"][number],
): SessionState["smithersIsolations"] {
  if (!isolation) {
    return existingIsolations;
  }

  const next = [...existingIsolations];
  const index = next.findIndex((candidate) => candidate.runId === isolation.runId);
  if (index === -1) {
    next.push(isolation);
    return next;
  }

  next[index] = isolation;
  return next;
}

function buildStructuredEntries(input: {
  existingEntries: SessionJsonlEntry[];
  thread: ThreadRef;
  episode: Episode;
  verification: GlobalVerificationState;
  alignment: SessionWorktreeAlignmentState;
  workflowRun?: WorkflowRunReference;
  smithersIsolation?: SessionState["smithersIsolations"][number];
  idGenerator: () => string;
  timestamp: string;
}): StructuredSessionEntry[] {
  const lastStructuredEntry = input.existingEntries
    .toReversed()
    .find(isStructuredSessionEntryWithId);
  const existingIds = new Set(
    input.existingEntries
      .filter(isStructuredSessionEntryWithId)
      .map((entry) => entry.id),
  );
  const generatedIds = new Set<string>();

  let parentId = lastStructuredEntry?.id ?? null;
  const entries: StructuredSessionEntry[] = [];

  const push = (payload: StructuredSessionEntry["message"]["details"]): void => {
    const entry = createStructuredSessionEntry({
      id: nextUniqueStructuredEntryId({
        idGenerator: input.idGenerator,
        existingIds,
        generatedIds,
      }),
      parentId,
      timestamp: input.timestamp,
      payload,
    });
    entries.push(entry);
    parentId = entry.id;
  };

  push({ kind: "thread", data: input.thread });
  push({ kind: "episode", data: input.episode });
  push({ kind: "verification", data: input.verification });
  push({ kind: "alignment", data: input.alignment });

  if (input.workflowRun) {
    push({ kind: "workflow-run", data: input.workflowRun });
  }

  if (input.smithersIsolation) {
    push({ kind: "smithers-isolation", data: input.smithersIsolation });
  }

  return entries;
}

function isStructuredSessionEntryWithId(
  entry: SessionJsonlEntry,
): entry is StructuredSessionEntry {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }

  const record = entry as Record<string, unknown>;
  if (record.type !== "message" || typeof record.id !== "string") {
    return false;
  }

  const message = record.message;
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const msg = message as Record<string, unknown>;
  return (
    msg.role === "custom" &&
    typeof msg.customType === "string" &&
    msg.customType.startsWith("hellm/")
  );
}

function nextUniqueStructuredEntryId(input: {
  idGenerator: () => string;
  existingIds: Set<string>;
  generatedIds: Set<string>;
}): string {
  const maxAttempts = Math.max(
    64,
    input.existingIds.size + input.generatedIds.size + 1,
  );

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidateId = input.idGenerator();
    if (
      input.existingIds.has(candidateId) ||
      input.generatedIds.has(candidateId)
    ) {
      continue;
    }

    input.generatedIds.add(candidateId);
    return candidateId;
  }

  throw new Error("Unable to generate a unique structured session entry id.");
}

function createCompletionDecision(status: Episode["status"]): CompletionDecision {
  switch (status) {
    case "completed":
    case "completed_with_issues":
      return { isComplete: true, reason: "completed" };
    case "waiting_input":
      return { isComplete: false, reason: "waiting_input" };
    case "waiting_approval":
      return { isComplete: false, reason: "waiting_approval" };
    case "blocked":
      return { isComplete: false, reason: "blocked" };
    case "failed":
      return { isComplete: true, reason: "failed" };
    case "cancelled":
      return { isComplete: true, reason: "cancelled" };
  }
}
