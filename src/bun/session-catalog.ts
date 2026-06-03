import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import {
  getModel,
  getProviders,
  type AssistantMessage,
  type AssistantMessageEvent,
  type ImageContent,
  type Message,
} from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type {
  ComposerDraft,
  ConversationSurfaceSnapshot,
  ConversationTurnTiming,
  CreateSessionRequest,
  ForkSessionRequest,
  ListSessionsResponse,
  PromptTarget,
  QueuedSurfaceMessage,
  SurfaceStreamPatch,
  SurfaceStreamPatchInput,
  SurfaceSyncMessage,
  UpdateComposerDraftRequest,
  WorkspaceMutationResponse,
  WorkspaceArtifactPreview,
  WorkspaceSessionNavigationReadModel,
  WorkspaceProjectCiStatusPanel,
  WorkspaceSyncMessage,
  WorkspaceCommandInspector,
  WorkspaceHandlerThreadInspector,
  WorkspaceHandlerThreadSummary,
  WorkspaceSessionSummary,
  WorkspaceWorkflowTaskAttemptInspector,
  WorkspaceWorkflowInspectorMode,
  WorkspaceWorkflowInspectorReadModel,
} from "../shared/workspace-contract";
import type {
  PromptLibraryActor,
  PromptLibraryExternalSource,
  PromptLibraryGeneratedEntry,
  PromptLibrarySnapshotSummary,
  PromptLibraryState,
} from "../shared/prompt-library";
import { buildWorkflowInspectorReadModel } from "../shared/workflow-inspector";
import {
  DEFAULT_ORCHESTRATOR_SESSION_PROMPT,
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_ORCHESTRATOR_PROFILE_ID,
  DEFAULT_THREAD_HANDLER_PROFILE_ID,
  type AgentProfileId,
  type AgentProfileSettings,
  type AgentPromptSettings,
} from "../shared/agent-settings";
import {
  projectWorkspaceSessionSummary,
  projectWorkspaceSessionSummaryFromInfo,
} from "./session-projection";
import {
  buildStructuredCommandInspector,
  buildStructuredHandlerThreadInspector,
  buildStructuredHandlerThreadSummaries,
  buildStructuredProjectCiStatusPanel,
  buildStructuredArtifactLink,
  buildStructuredSessionSummaryProjection,
  buildStructuredSessionView,
  buildStructuredWorkflowTaskAttemptInspector,
  hasStructuredSessionFacts,
} from "./structured-session-selectors";
import {
  createPromptExecutionContext,
  type PromptExecutionContext,
  type PromptExecutionRuntimeHandle,
} from "./prompt-execution-context";
import {
  createStructuredSessionStateStore,
  type StructuredSessionSnapshot,
  type StructuredWaitState,
  type StructuredSessionStateStore,
  type StructuredEpisodeKind,
  type StructuredSurfaceQueuedMessageRecord,
} from "./structured-session-state";
import { createExecuteTypescriptTool } from "./execute-typescript-tool";
import { createWaitTool } from "./wait-tool";
import { resolveApiKey } from "./auth-store";
import { createToolExecutionCommandTracker } from "./tool-execution-command-tracker";
import { createStartThreadTool } from "./thread-start-tool";
import { createResumeThreadTool } from "./thread-resume-tool";
import {
  createThreadHandoffTool,
  type ThreadHandoffAcceptance,
  type ThreadHandoffRequest,
} from "./thread-handoff-tool";
import {
  buildPromptLibraryGeneratedEntries,
  buildSystemPrompt,
  createDefaultPromptLibraryState,
} from "./default-system-prompt";
import type { SvvyActorKind } from "./actor-capabilities";
import { createSmithersTools } from "./smithers-tools";
import { createCxTools } from "./cx-tools";
import { SmithersRuntimeManager } from "./smithers-runtime/manager";
import { createWorkflowLibrary } from "./smithers-runtime/workflow-library";
import { createRequestContextTool } from "./request-context-tool";
import { getOptionalPromptContext, type OptionalPromptContextKey } from "./prompt-contexts";
import { createAgentSettingsStore } from "./agent-settings-store";
import { createSvvyDirectTools } from "./svvy-direct-tools";
import { createListToolsTool } from "./list-tools-tool";
import { createWebProvider } from "./web-runtime/provider-registry";
import { createPromptLibraryStore, type PromptLibraryStore } from "./prompt-library-store";
import {
  createThreadCurrentTool,
  createThreadHandoffsTool,
  createThreadListTool,
} from "./runtime-state-tools";
import { WorkspaceRecoveryCoordinator } from "./workspace-recovery-coordinator";

const ZERO_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

const STRUCTURED_SESSION_DB_FILENAME = "structured-session-state-v5.sqlite";

function deleteSessionFileLikePi(sessionPath: string): void {
  if (!existsSync(sessionPath)) {
    return;
  }

  const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
  spawnSync("trash", trashArgs, { encoding: "utf-8" });
  if (!existsSync(sessionPath)) {
    return;
  }

  unlinkSync(sessionPath);
  if (existsSync(sessionPath)) {
    throw new Error(`Failed to delete session file: ${sessionPath}`);
  }
}

const byTimestampDesc = (
  left: string | null | undefined,
  right: string | null | undefined,
): number => new Date(right ?? 0).getTime() - new Date(left ?? 0).getTime();

type ManagedActorKind = SvvyActorKind | "namer";

interface ManagedSession {
  sessionId: string;
  actorKind: ManagedActorKind;
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  agentProfileId: AgentProfileId;
  systemPrompt: string;
  promptLibraryRevision: number;
  externalContextSources: PromptLibraryExternalSource[];
  session: AgentSession;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  activePrompt: boolean;
  activePromptDone: Promise<void> | null;
  pendingUserMessage: { turnId: string; message: Message } | null;
  activeStreamMessage: AssistantMessage | null;
  activeStreamSequence: number;
  recreateOnNextPrompt: boolean;
  abortRequested: boolean;
  lastPromptSuppressedQueueDrain: boolean;
  lastPromptRestoredQueueItem: boolean;
  retainCount: number;
  promptExecutionRuntime: PromptExecutionRuntimeHandle;
}

export interface SessionDefaults {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  agentProfileId?: AgentProfileId;
  agentProfileSettings?: AgentProfileSettings;
}

export interface SendAgentPromptOptions {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  target: PromptTarget;
  messages: Message[];
  onEvent?: (event: AssistantMessageEvent) => void;
  queueOnly?: boolean;
  queuedMessageId?: string | null;
}

export interface SendAgentPromptResult {
  target: PromptTarget;
  queued?: boolean;
  snapshot?: ConversationSurfaceSnapshot;
}

export interface EditCommittedUserMessageOptions {
  target: PromptTarget;
  messageTimestamp: string | number;
  message: Message;
  onEvent?: (event: AssistantMessageEvent) => void;
}

interface HandlerHandoffQueuePayload {
  threadId: string;
  sourceCommandId: string;
  turnId: string;
  title: string;
  summary: string;
  body: string;
  kind: StructuredEpisodeKind;
}

interface PromptRefreshQueuePayload {
  requestedRevision: number;
  requestedAt: string;
}

interface InitialHandlerStartQueuePayload {
  threadId: string;
  requestedAt: string;
}

interface WorkflowAttentionQueuePayload {
  sessionId: string;
  threadId: string;
  workflowRunId: string;
  smithersRunId: string;
  workflowId: string;
  summary: string;
  reason: string;
}

interface CreateManagedSessionOptions {
  sessionManager: SessionManager;
  actorKind: ManagedActorKind;
  provider?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  systemPrompt: string;
  promptLibraryRevision?: number;
  agentProfileId?: AgentProfileId;
  onRequestContextLoaded?: (surfacePiSessionId: string) => void;
}

interface VisibleStreamState {
  partial: AssistantMessage;
  activeTextIndex: number | null;
  activeThinkingIndex: number | null;
}

type WorkspaceSessionInfo = Awaited<ReturnType<typeof SessionManager.list>>[number];

function messageTimestampMs(timestamp: string | number): number {
  if (typeof timestamp === "number") return timestamp;
  const numericTimestamp = Number(timestamp);
  if (Number.isFinite(numericTimestamp)) return numericTimestamp;
  const parsedTimestamp = Date.parse(timestamp);
  return Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0;
}

export type TitleGenerationLogEvent =
  | {
      level: "info";
      status: "queued" | "started" | "completed";
      sessionId: string;
      title?: string;
    }
  | {
      level: "warning";
      status: "failed";
      sessionId: string;
      error: string;
    };

export class WorkspaceSessionCatalog {
  private readonly managedSurfaces = new Map<string, ManagedSession>();
  private readonly structuredSessionStore: StructuredSessionStateStore;
  private readonly smithersRuntimeManager: SmithersRuntimeManager;
  private readonly recoveryCoordinator: WorkspaceRecoveryCoordinator;
  private readonly agentSettingsStore: ReturnType<typeof createAgentSettingsStore>;
  private readonly promptLibraryStore: PromptLibraryStore;
  private readonly restoredWorkflowSupervisionSessionIds = new Set<string>();
  private readonly workflowSupervisionRestoreTasks = new Map<string, Promise<void>>();
  private durableWorkflowSupervisionRestoreStarted = false;
  private durableWorkflowSupervisionRestoreTask: Promise<void> | null = null;
  private closed = false;
  private focusedSurfacePiSessionId: string | null = null;
  private workspaceSyncListener: ((payload: WorkspaceSyncMessage) => void) | null = null;
  private surfaceSyncListener: ((payload: SurfaceSyncMessage) => void) | null = null;
  private titleGenerationLogListener: ((event: TitleGenerationLogEvent) => void) | null = null;

  constructor(
    private readonly cwd: string,
    private readonly agentDir: string = getSvvyAgentDir(),
    private readonly sessionDir: string = getSvvySessionDir(cwd, agentDir),
    private readonly namerSessionDir: string = join(sessionDir, "namer"),
    private readonly workspaceId: string = cwd,
  ) {
    const workspaceLabel = basename(this.cwd) || "workspace";
    this.structuredSessionStore = createStructuredSessionStateStore({
      workspace: {
        id: this.workspaceId,
        label: workspaceLabel,
        cwd: this.cwd,
      },
      databasePath: join(this.sessionDir, STRUCTURED_SESSION_DB_FILENAME),
    });
    this.agentSettingsStore = createAgentSettingsStore({
      cwd: this.cwd,
      agentDir: this.agentDir,
    });
    this.promptLibraryStore = createPromptLibraryStore({
      agentDir: this.sessionDir,
    });
    this.promptLibraryStore.getState();
    this.agentSettingsStore.ensureWorkflowAgentsComponent();
    this.smithersRuntimeManager = new SmithersRuntimeManager({
      cwd: this.cwd,
      agentDir: this.agentDir,
      store: this.structuredSessionStore,
      getTaskAgentDefaults: () => ({
        provider: DEFAULT_AGENT_SETTINGS.provider,
        model: DEFAULT_AGENT_SETTINGS.model,
        reasoningEffort: DEFAULT_AGENT_SETTINGS.reasoningEffort,
        promptLibraryState: this.promptLibraryStore.getState(),
      }),
      onStructuredStateChanged: async (sessionId) => {
        await this.emitStructuredStateSync(sessionId);
      },
      onHandlerAttention: async (event) => {
        this.recoveryCoordinator.enqueue({
          kind: "workflow_attention",
          ownerScope: {
            kind: "workflow_run",
            workflowRunId: event.workflowRunId,
            smithersRunId: event.smithersRunId,
          },
          idempotencyKey: `workflow_attention:${event.workflowRunId}:${event.reason}`,
          orderingKey: `workflow:${event.workflowRunId}`,
          priority: 5,
          payloadJson: {
            sessionId: event.sessionId,
            threadId: event.threadId,
            workflowRunId: event.workflowRunId,
          },
        });
        return await this.resumeHandlerAfterWorkflowAttention(event);
      },
    });
    this.recoveryCoordinator = new WorkspaceRecoveryCoordinator(this.structuredSessionStore, {
      bootstrapSmithers: async () => {
        await this.restoreDurableWorkflowSupervision();
      },
      recoverSurfaceTurn: async (surfacePiSessionId) => {
        this.recoverInterruptedSurfaceTurn(surfacePiSessionId);
      },
      drainSurfaceQueue: async (target) => {
        await this.runSurfaceQueue(target);
      },
      startInitialHandler: async (input) => {
        await this.startInitialHandlerThreadPrompt(input);
      },
      resolveHandlerHandoff: async (queuedItemId) => {
        this.recoverHandlerHandoffResolution(queuedItemId);
      },
      generateTitle: async (owner) => {
        if (owner.sessionId) {
          await this.runQueuedTitleGeneration(owner.sessionId);
          return;
        }
        if (owner.threadId) {
          await this.runThreadTitleGenerationJob(owner.threadId);
        }
      },
      projectWorkflowAttention: async (input) => {
        if (input.sessionId) {
          await this.smithersRuntimeManager.deliverPendingHandlerAttention(
            input.sessionId,
            input.threadId,
          );
        }
      },
      projectCi: async (input) => {
        if (input.sessionId) {
          await this.smithersRuntimeManager.restoreSessionSupervision(input.sessionId, {
            emitAttention: false,
          });
        }
      },
      projectRecoveryLog: async () => {},
      resolveSurfaceTarget: (surfacePiSessionId) =>
        this.resolvePromptTargetForSurfacePiSessionId(surfacePiSessionId),
    });
    this.recoveryCoordinator.seedFromDurableState();
    this.recoveryCoordinator.start();
  }

  private get threadSurfaceDir(): string {
    return join(this.sessionDir, "threads");
  }

  async dispose(): Promise<void> {
    this.closed = true;
    this.recoveryCoordinator.close();
    for (const session of this.managedSurfaces.values()) {
      session.session.dispose();
    }
    this.managedSurfaces.clear();
    await this.smithersRuntimeManager.close();
    this.structuredSessionStore.close();
  }

  setWorkspaceSyncListener(listener: ((payload: WorkspaceSyncMessage) => void) | null): void {
    this.workspaceSyncListener = listener;
  }

  setSurfaceSyncListener(listener: ((payload: SurfaceSyncMessage) => void) | null): void {
    this.surfaceSyncListener = listener;
  }

  setTitleGenerationLogListener(listener: ((event: TitleGenerationLogEvent) => void) | null): void {
    this.titleGenerationLogListener = listener;
  }

  scheduleDurableWorkflowSupervisionRestore(): void {
    if (this.closed) {
      return;
    }
    this.recoveryCoordinator.enqueue({
      kind: "smithers_bootstrap",
      ownerScope: { kind: "workspace" },
      idempotencyKey: `smithers_bootstrap:${this.workspaceId}`,
      orderingKey: `workspace:${this.workspaceId}:smithers`,
      priority: 0,
    });
    this.recoveryCoordinator.wake();
  }

  async restoreDurableWorkflowSupervision(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.durableWorkflowSupervisionRestoreTask) {
      await this.durableWorkflowSupervisionRestoreTask;
      return;
    }
    if (this.durableWorkflowSupervisionRestoreStarted) {
      return;
    }

    this.durableWorkflowSupervisionRestoreStarted = true;
    this.durableWorkflowSupervisionRestoreTask = (async () => {
      for (const snapshot of this.structuredSessionStore.listSessionStates()) {
        if (this.closed) {
          return;
        }
        if (!hasRestorableWorkflowSupervision(snapshot)) {
          continue;
        }
        try {
          await this.restoreWorkflowSupervisionForSession(snapshot.session.id);
        } catch (error) {
          if (!this.closed) {
            console.error(
              `Failed to restore workflow supervision for session ${snapshot.session.id}:`,
              error,
            );
          }
        }
      }
    })();

    try {
      await this.durableWorkflowSupervisionRestoreTask;
    } finally {
      this.durableWorkflowSupervisionRestoreTask = null;
    }
  }

  getPromptLibraryState(): PromptLibraryState {
    return this.promptLibraryStore.getState();
  }

  getDefaultPromptLibraryState(): PromptLibraryState {
    return createDefaultPromptLibraryState();
  }

  updatePromptLibraryState(state: PromptLibraryState): PromptLibraryState {
    const next = this.promptLibraryStore.updateState(state);
    void this.emitOpenSurfacePromptBindingUpdates();
    return next;
  }

  resetPromptLibraryState(): PromptLibraryState {
    const next = this.promptLibraryStore.resetState();
    void this.emitOpenSurfacePromptBindingUpdates();
    return next;
  }

  listPromptLibrarySnapshots(): PromptLibrarySnapshotSummary[] {
    return this.promptLibraryStore.listSnapshots();
  }

  createPromptLibrarySnapshot(name: string): PromptLibrarySnapshotSummary {
    return this.promptLibraryStore.createSnapshot(name);
  }

  renamePromptLibrarySnapshot(snapshotId: string, name: string): PromptLibrarySnapshotSummary {
    return this.promptLibraryStore.renameSnapshot(snapshotId, name);
  }

  restorePromptLibrarySnapshot(snapshotId: string): PromptLibraryState {
    const next = this.promptLibraryStore.restoreSnapshot(snapshotId);
    void this.emitOpenSurfacePromptBindingUpdates();
    return next;
  }

  getPromptLibraryGeneratedEntries() {
    const state = this.promptLibraryStore.getState();
    const webProvider = this.createActiveWebProvider();
    const materialize = (actor: PromptLibraryActor, entries: PromptLibraryGeneratedEntry[]) =>
      entries.map((entry) => this.materializeGeneratedPromptEntry(actor, entry));
    return {
      orchestrator: materialize(
        "orchestrator",
        buildPromptLibraryGeneratedEntries("orchestrator", state, { webProvider }),
      ),
      handler: materialize(
        "handler",
        buildPromptLibraryGeneratedEntries("handler", state, { webProvider }),
      ),
      "workflow-task": materialize(
        "workflow-task",
        buildPromptLibraryGeneratedEntries("workflow-task", state, { webProvider }),
      ),
    };
  }

  async getPromptLibraryExternalSources(): Promise<PromptLibraryExternalSource[]> {
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager: SettingsManager.create(this.cwd, this.agentDir),
      systemPromptOverride: () => this.buildPromptFromLibrary("orchestrator"),
      appendSystemPromptOverride: () => [],
    });
    await resourceLoader.reload();
    return buildExternalContextSources(resourceLoader);
  }

  private async buildCurrentExternalContextSources(): Promise<PromptLibraryExternalSource[]> {
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager: SettingsManager.create(this.cwd, this.agentDir),
      systemPromptOverride: () => this.buildPromptFromLibrary("orchestrator"),
      appendSystemPromptOverride: () => [],
    });
    await resourceLoader.reload();
    return buildExternalContextSources(resourceLoader);
  }

  private materializeGeneratedPromptEntry(
    actor: PromptLibraryActor,
    entry: PromptLibraryGeneratedEntry,
  ): PromptLibraryGeneratedEntry {
    const relativePath = join(".svvy", "generated", "context-library", actor, `${entry.id}.md`);
    const absolutePath = join(this.cwd, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(
      absolutePath,
      [
        `# ${entry.title}`,
        "",
        `Actor: ${actor}`,
        `Generated part: ${entry.id}`,
        "",
        "Generated by svvy from current runtime settings and contracts.",
        "Edit the owning app/runtime source or settings, not this file.",
        "",
        "```text",
        entry.content,
        "```",
        "",
      ].join("\n"),
    );
    return {
      ...entry,
      source: relativePath.replaceAll("\\", "/"),
      sourcePath: relativePath.replaceAll("\\", "/"),
    };
  }

  buildOrchestratorSystemPrompt(settings: Pick<AgentPromptSettings, "systemPrompt">): string {
    return buildOrchestratorProfileSystemPrompt(
      settings,
      this.promptLibraryStore.getState(),
      this.cwd,
      this.createActiveWebProvider(),
    );
  }

  async listSessions(): Promise<ListSessionsResponse> {
    const summaries = await this.collectWorkspaceSessionSummaries();
    const navigation = this.buildWorkspaceSessionNavigation(Array.from(summaries.values()));
    return {
      sessions: [
        ...navigation.pinnedSessions,
        ...navigation.activeSessions,
        ...navigation.archived.sessions,
      ],
      navigation,
    };
  }

  private async collectWorkspaceSessionSummaries(): Promise<Map<string, WorkspaceSessionSummary>> {
    const infos = await SessionManager.list(this.cwd, this.sessionDir);
    const summaries = new Map<string, WorkspaceSessionSummary>();

    for (const info of infos) {
      if (this.structuredSessionStore.isSessionDeleted(info.id)) {
        continue;
      }
      const orchestratorSurface = this.managedSurfaces.get(info.id);
      if (orchestratorSurface) {
        summaries.set(info.id, await this.buildSummaryFromManagedSession(orchestratorSurface));
        continue;
      }

      summaries.set(info.id, await this.buildSummaryFromSessionInfo(info));
    }

    for (const surface of this.managedSurfaces.values()) {
      if (this.structuredSessionStore.isSessionDeleted(surface.sessionId)) {
        continue;
      }
      if (surface.actorKind !== "orchestrator" || summaries.has(surface.sessionId)) {
        continue;
      }
      summaries.set(surface.sessionId, await this.buildSummaryFromManagedSession(surface));
    }

    return summaries;
  }

  private buildWorkspaceSessionNavigation(
    summaries: WorkspaceSessionSummary[],
  ): WorkspaceSessionNavigationReadModel {
    const sidebarState = this.structuredSessionStore.getWorkspaceSidebarState();

    return {
      pinnedSessions: summaries
        .filter((summary) => summary.isPinned && !summary.isArchived)
        .toSorted((left, right) => byTimestampDesc(left.pinnedAt, right.pinnedAt)),
      activeSessions: summaries
        .filter((summary) => !summary.isPinned && !summary.isArchived)
        .toSorted((left, right) => byTimestampDesc(left.updatedAt, right.updatedAt)),
      sections: {
        pinned: {
          collapsed: sidebarState.pinnedGroupCollapsed,
          sizePx: sidebarState.pinnedGroupSizePx,
        },
        active: {
          collapsed: sidebarState.activeGroupCollapsed,
          sizePx: sidebarState.activeGroupSizePx,
        },
        archived: {
          collapsed: sidebarState.archivedGroupCollapsed,
          sizePx: sidebarState.archivedGroupSizePx,
        },
      },
      archived: {
        collapsed: sidebarState.archivedGroupCollapsed,
        sessions: summaries
          .filter((summary) => summary.isArchived)
          .toSorted((left, right) => byTimestampDesc(left.archivedAt, right.archivedAt)),
      },
    };
  }

  async getCommandInspector(input: {
    sessionId: string;
    commandId: string;
  }): Promise<WorkspaceCommandInspector> {
    const snapshot = await this.getDerivedStructuredSnapshot(input.sessionId);
    if (!snapshot) {
      throw new Error(`Structured session not found: ${input.sessionId}`);
    }

    const inspector = buildStructuredCommandInspector(snapshot, input.commandId);
    if (!inspector) {
      throw new Error(`Structured command not found: ${input.commandId}`);
    }

    return inspector;
  }

  async listHandlerThreads(input: { sessionId: string }): Promise<WorkspaceHandlerThreadSummary[]> {
    const snapshot = await this.getDerivedStructuredSnapshot(input.sessionId);
    if (!snapshot) {
      throw new Error(`Structured session not found: ${input.sessionId}`);
    }

    return buildStructuredHandlerThreadSummaries(snapshot);
  }

  async getHandlerThreadInspector(input: {
    sessionId: string;
    threadId: string;
  }): Promise<WorkspaceHandlerThreadInspector> {
    const snapshot = await this.getDerivedStructuredSnapshot(input.sessionId);
    if (!snapshot) {
      throw new Error(`Structured session not found: ${input.sessionId}`);
    }

    const inspector = buildStructuredHandlerThreadInspector(snapshot, input.threadId);
    if (!inspector) {
      throw new Error(`Delegated handler thread not found: ${input.threadId}`);
    }

    return inspector;
  }

  async getWorkflowTaskAttemptInspector(input: {
    sessionId: string;
    workflowTaskAttemptId: string;
  }): Promise<WorkspaceWorkflowTaskAttemptInspector> {
    const snapshot = await this.getDerivedStructuredSnapshot(input.sessionId);
    if (!snapshot) {
      throw new Error(`Structured session not found: ${input.sessionId}`);
    }

    const inspector = buildStructuredWorkflowTaskAttemptInspector(
      snapshot,
      input.workflowTaskAttemptId,
    );
    if (!inspector) {
      throw new Error(`Workflow task attempt not found: ${input.workflowTaskAttemptId}`);
    }

    return inspector;
  }

  async getWorkflowInspector(input: {
    sessionId: string;
    workflowRunId: string;
    selectedNodeKey?: string | null;
    expandedNodeKeys?: string[];
    userCollapsedNodeKeys?: string[];
    searchQuery?: string;
    mode?: WorkspaceWorkflowInspectorMode;
  }): Promise<WorkspaceWorkflowInspectorReadModel> {
    const snapshot = await this.getDerivedStructuredSnapshot(input.sessionId);
    if (!snapshot) {
      throw new Error(`Structured session not found: ${input.sessionId}`);
    }
    const workflowRun = snapshot.workflowRuns.find((entry) => entry.id === input.workflowRunId);
    if (!workflowRun) {
      throw new Error(`Workflow run not found: ${input.workflowRunId}`);
    }

    const smithersSnapshot = await this.smithersRuntimeManager.getDevToolsSnapshot({
      runId: workflowRun.smithersRunId,
      frameNo: input.mode?.kind === "historical" ? input.mode.frameNo : undefined,
    });
    const frames = await this.smithersRuntimeManager
      .listFrames({ runId: workflowRun.smithersRunId, limit: 250 })
      .catch(() => []);
    const events = await this.smithersRuntimeManager
      .getRunEvents({ runId: workflowRun.smithersRunId, limit: 500 })
      .catch(() => []);
    const selectedNodeId =
      typeof input.selectedNodeKey === "string" ? input.selectedNodeKey.split("/").at(-1) : null;
    const nodeDetail = selectedNodeId
      ? await this.smithersRuntimeManager
          .getNodeDetail({ runId: workflowRun.smithersRunId, nodeId: selectedNodeId })
          .catch(() => null)
      : null;
    const command = snapshot.commands.find((entry) => entry.id === workflowRun.commandId);
    const launchInput = command?.facts?.launchInput ?? command?.facts?.input ?? null;

    return buildWorkflowInspectorReadModel({
      sessionId: input.sessionId,
      workflowRun: {
        ...workflowRun,
        input: launchInput,
      },
      thread: snapshot.threads.find((entry) => entry.id === workflowRun.threadId) ?? null,
      snapshot: smithersSnapshot,
      frames,
      events,
      nodeDetail,
      artifacts: snapshot.artifacts
        .filter((artifact) => artifact.workflowRunId === workflowRun.id)
        .map((artifact) => buildStructuredArtifactLink(snapshot, artifact)),
      taskAttempts: snapshot.workflowTaskAttempts
        .filter((attempt) => attempt.workflowRunId === workflowRun.id)
        .map((attempt) => ({
          workflowTaskAttemptId: attempt.id,
          workflowRunId: attempt.workflowRunId,
          nodeId: attempt.nodeId,
          kind: attempt.kind,
          status: attempt.status,
          iteration: attempt.iteration,
          attempt: attempt.attempt,
          title: attempt.title,
          summary: attempt.summary,
          responseText: attempt.responseText,
          error: attempt.error,
          jjCwd: attempt.jjCwd,
          agentId: attempt.agentId,
          agentModel: attempt.agentModel,
        })),
      commands: snapshot.commands
        .filter((entry) => entry.workflowRunId === workflowRun.id)
        .map((entry) => ({
          commandId: entry.id,
          workflowRunId: entry.workflowRunId,
          workflowTaskAttemptId: entry.workflowTaskAttemptId,
          title: entry.title,
          summary: entry.summary,
          toolName: entry.toolName,
          status: entry.status,
        })),
      ciChecks: snapshot.ciCheckResults
        .filter((entry) => entry.workflowRunId === workflowRun.id)
        .map((entry) => ({
          checkResultId: entry.id,
          checkId: entry.checkId,
          label: entry.label,
          required: entry.required,
          command: entry.command,
          status: entry.status,
        })),
      selectedNodeKey: input.selectedNodeKey,
      expandedNodeKeys: input.expandedNodeKeys,
      userCollapsedNodeKeys: input.userCollapsedNodeKeys,
      searchQuery: input.searchQuery,
      mode: input.mode,
    });
  }

  async streamWorkflowInspector(input: {
    sessionId: string;
    workflowRunId: string;
    selectedNodeKey?: string | null;
    expandedNodeKeys?: string[];
    userCollapsedNodeKeys?: string[];
    searchQuery?: string;
    mode?: WorkspaceWorkflowInspectorMode;
    fromSeq?: number | null;
  }) {
    const snapshot = this.getStructuredSnapshot(input.sessionId);
    if (!snapshot) {
      throw new Error(`Structured session not found: ${input.sessionId}`);
    }
    const workflowRun = snapshot.workflowRuns.find((entry) => entry.id === input.workflowRunId);
    if (!workflowRun) {
      throw new Error(`Workflow run not found: ${input.workflowRunId}`);
    }
    const stream =
      input.mode?.kind === "live"
        ? await this.smithersRuntimeManager.streamDevTools({
            runId: workflowRun.smithersRunId,
            afterSeq: input.fromSeq ?? workflowRun.lastEventSeq ?? undefined,
            timeoutMs: 1500,
            maxEvents: 100,
            pollIntervalMs: 100,
          })
        : {
            runId: workflowRun.smithersRunId,
            afterSeq: input.fromSeq ?? null,
            lastSeq: input.fromSeq ?? null,
            events: [],
          };
    const inspector = await this.getWorkflowInspector(input);
    return {
      workflowRunId: input.workflowRunId,
      smithersRunId: workflowRun.smithersRunId,
      fromSeq: stream.afterSeq,
      lastSeq: stream.lastSeq,
      events: stream.events,
      inspector,
    };
  }

  async getProjectCiStatus(input: { sessionId: string }): Promise<WorkspaceProjectCiStatusPanel> {
    await this.smithersRuntimeManager.refreshWorkflowRegistry();
    const entries = this.smithersRuntimeManager
      .listWorkflows({ productKind: "project-ci" })
      .map((entry) => ({
        workflowId: entry.workflowId,
        label: entry.label,
        summary: entry.summary,
        sourceScope: entry.sourceScope,
        entryPath: entry.entryPath,
      }));

    return buildStructuredProjectCiStatusPanel({
      session: await this.getDerivedStructuredSnapshot(input.sessionId),
      entries,
    });
  }

  async getArtifactPreview(input: {
    sessionId: string;
    artifactId: string;
  }): Promise<WorkspaceArtifactPreview> {
    const snapshot = this.getStructuredSnapshot(input.sessionId);
    if (!snapshot) {
      throw new Error(`Structured session not found: ${input.sessionId}`);
    }

    const artifact = snapshot.artifacts.find((candidate) => candidate.id === input.artifactId);
    if (!artifact) {
      throw new Error(`Structured artifact not found: ${input.artifactId}`);
    }

    const link = buildStructuredArtifactLink(snapshot, artifact);
    const path = artifact.path;
    const pathContent = path && existsSync(path) ? readFileSync(path, "utf8") : undefined;
    const content = artifact.content ?? pathContent ?? "";

    return {
      artifactId: artifact.id,
      sessionId: input.sessionId,
      kind: artifact.kind,
      name: artifact.name,
      ...(artifact.path ? { path: artifact.path } : {}),
      createdAt: artifact.createdAt,
      ...(link.sourceCommandId ? { sourceCommandId: link.sourceCommandId } : {}),
      ...(link.workflowRunId ? { workflowRunId: link.workflowRunId } : {}),
      ...(link.workflowName ? { workflowName: link.workflowName } : {}),
      ...(link.producerLabel ? { producerLabel: link.producerLabel } : {}),
      missingFile: Boolean(link.missingFile),
      content,
    };
  }

  async pinSession(sessionId: string): Promise<WorkspaceMutationResponse> {
    const exists = await this.syncStructuredPiSessionFromWorkspaceSession(sessionId);
    if (!exists) return { ok: true };
    this.structuredSessionStore.setSessionPinned({ sessionId, pinned: true });
    await this.emitWorkspaceSync("workspace.updated");
    return { ok: true };
  }

  async unpinSession(sessionId: string): Promise<WorkspaceMutationResponse> {
    const exists = await this.syncStructuredPiSessionFromWorkspaceSession(sessionId);
    if (!exists) return { ok: true };
    this.structuredSessionStore.setSessionPinned({ sessionId, pinned: false });
    await this.emitWorkspaceSync("workspace.updated");
    return { ok: true };
  }

  async archiveSession(sessionId: string): Promise<WorkspaceMutationResponse> {
    const exists = await this.syncStructuredPiSessionFromWorkspaceSession(sessionId);
    if (!exists) return { ok: true };
    this.structuredSessionStore.setSessionArchived({ sessionId, archived: true });
    await this.emitWorkspaceSync("workspace.updated");
    return { ok: true };
  }

  async unarchiveSession(sessionId: string): Promise<WorkspaceMutationResponse> {
    const exists = await this.syncStructuredPiSessionFromWorkspaceSession(sessionId);
    if (!exists) return { ok: true };
    this.structuredSessionStore.setSessionArchived({ sessionId, archived: false });
    await this.emitWorkspaceSync("workspace.updated");
    return { ok: true };
  }

  async markSessionUnread(sessionId: string): Promise<WorkspaceMutationResponse> {
    const exists = await this.syncStructuredPiSessionFromWorkspaceSession(sessionId);
    if (!exists) return { ok: true };
    this.structuredSessionStore.markSessionUnread({ sessionId, reason: "manual" });
    await this.emitWorkspaceSync("workspace.updated");
    return { ok: true };
  }

  async markSessionRead(sessionId: string): Promise<WorkspaceMutationResponse> {
    const exists = await this.syncStructuredPiSessionFromWorkspaceSession(sessionId);
    if (!exists) return { ok: true };
    this.structuredSessionStore.markSessionRead({ sessionId });
    await this.emitWorkspaceSync("workspace.updated");
    return { ok: true };
  }

  async recordFocusedSession(input: {
    sessionId: string | null;
    surfacePiSessionId?: string | null;
  }): Promise<WorkspaceMutationResponse> {
    const sessionId = input.sessionId;
    this.focusedSurfacePiSessionId = input.surfacePiSessionId ?? null;
    if (!sessionId) {
      return { ok: true };
    }

    const exists = await this.syncStructuredPiSessionFromWorkspaceSession(sessionId);
    if (!exists) {
      return { ok: true };
    }
    this.structuredSessionStore.markSessionRead({ sessionId });
    await this.emitWorkspaceSync("workspace.updated");
    return { ok: true };
  }

  async setArchivedGroupCollapsed(input: {
    collapsed: boolean;
  }): Promise<WorkspaceMutationResponse> {
    this.structuredSessionStore.setArchivedGroupCollapsed(input);
    await this.emitWorkspaceSync("workspace.updated");
    return { ok: true };
  }

  async setSessionNavigationSectionState(input: {
    section: "pinned" | "active" | "archived";
    collapsed?: boolean;
    sizePx?: number;
  }): Promise<WorkspaceMutationResponse> {
    this.structuredSessionStore.setSessionNavigationSectionState(input);
    await this.emitWorkspaceSync("workspace.updated");
    return { ok: true };
  }

  async createSession(
    request: CreateSessionRequest,
    defaults: SessionDefaults,
  ): Promise<ConversationSurfaceSnapshot> {
    const parentSessionFile = request.parentSessionId
      ? await this.getSessionFileForId(request.parentSessionId)
      : undefined;
    const sessionManager = SessionManager.create(this.cwd, this.sessionDir);
    if (parentSessionFile) {
      sessionManager.newSession({ parentSession: parentSessionFile });
    }
    sessionManager.appendSessionInfo(request.title?.trim() || "New orchestrator");

    const agentProfileId =
      request.agentProfileId ?? defaults.agentProfileId ?? DEFAULT_ORCHESTRATOR_PROFILE_ID;
    if (request.agentProfileId) {
      this.resolveOrchestratorAgentProfile(request.agentProfileId);
    }
    const agentProfileSettings =
      defaults.agentProfileSettings ?? this.resolveOrchestratorAgentProfile(agentProfileId);

    const session = await this.createManagedSurfaceRecord({
      sessionManager,
      actorKind: "orchestrator",
      provider: defaults.provider,
      model: defaults.model,
      thinkingLevel: defaults.thinkingLevel,
      systemPrompt: this.buildOrchestratorSystemPrompt(agentProfileSettings),
      agentProfileId,
    });
    const target = this.buildOrchestratorPromptTarget(session.sessionId);
    session.retainCount += 1;
    this.syncStructuredPiSessionFromOrchestratorSession(session);
    this.persistManagedSessionSnapshot(session);
    await this.emitWorkspaceSync("workspace.updated");
    return this.buildSurfaceSnapshot(session, target);
  }

  async openSession(sessionId: string): Promise<ConversationSurfaceSnapshot> {
    return this.openSurface(this.buildOrchestratorPromptTarget(sessionId));
  }

  async openSurface(target: PromptTarget): Promise<ConversationSurfaceSnapshot> {
    this.assertValidPromptTarget(target);
    const session = await this.retainManagedSurface(target);
    await this.restoreWorkflowSupervisionIfTracked(target.workspaceSessionId);
    const snapshot = await this.buildSurfaceSnapshot(session, target, {
      refreshExternalSources: true,
    });
    if (!session.activePrompt && snapshot.queuedMessages.length > 0) {
      this.wakeSurfaceQueue(target);
    }
    return snapshot;
  }

  async closeSurface(target: PromptTarget): Promise<WorkspaceMutationResponse> {
    await this.releaseManagedSurface(target.surfacePiSessionId);
    return { ok: true };
  }

  async renameSession(sessionId: string, title: string): Promise<WorkspaceMutationResponse> {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw new Error("Session title cannot be empty.");
    }
    const snapshot = this.getStructuredSnapshot(sessionId);
    const titleStatus = snapshot?.pi.titleGenerationStatus;
    if (titleStatus === "pending" || titleStatus === "running") {
      throw new Error("Session title is being generated. Rename is temporarily locked.");
    }
    const exists = await this.syncStructuredPiSessionFromWorkspaceSession(sessionId);
    if (!exists) {
      return { ok: true };
    }

    const activeOrchestrator = this.managedSurfaces.get(sessionId) ?? null;

    if (activeOrchestrator) {
      activeOrchestrator.session.sessionManager.appendSessionInfo(trimmedTitle);
    } else {
      const sessionFile = await this.getSessionFileForId(sessionId);
      SessionManager.open(sessionFile!, this.sessionDir).appendSessionInfo(trimmedTitle);
    }
    this.structuredSessionStore.markManualTitleOverride({ sessionId, title: trimmedTitle });
    await this.emitWorkspaceSync("workspace.updated");

    return { ok: true };
  }

  async forkSession(
    request: ForkSessionRequest,
    defaults: SessionDefaults,
  ): Promise<ConversationSurfaceSnapshot> {
    const sourceSessionFile = await this.getSessionFileForId(request.sessionId, false);
    if (!sourceSessionFile || !existsSync(sourceSessionFile)) {
      const activeOrchestrator = this.managedSurfaces.get(request.sessionId) ?? null;
      const fallbackDefaults = activeOrchestrator
        ? {
            provider: activeOrchestrator.provider,
            model: activeOrchestrator.model,
            thinkingLevel: activeOrchestrator.thinkingLevel,
            agentProfileId: activeOrchestrator.agentProfileId,
          }
        : defaults;
      return this.createSession({ title: request.title }, fallbackDefaults);
    }

    const forkedSessionManager = request.messageTimestamp
      ? createBranchedSessionManager(sourceSessionFile, this.sessionDir, request.messageTimestamp)
      : SessionManager.forkFrom(sourceSessionFile, this.cwd, this.sessionDir);
    if (request.title?.trim()) {
      forkedSessionManager.appendSessionInfo(request.title);
    }

    const session = await this.createManagedSurfaceRecord({
      sessionManager: forkedSessionManager,
      actorKind: "orchestrator",
      systemPrompt: this.buildPromptFromLibrary("orchestrator"),
    });
    const target = this.buildOrchestratorPromptTarget(session.sessionId);
    session.retainCount += 1;
    this.syncStructuredPiSessionFromOrchestratorSession(session);
    await this.emitWorkspaceSync("workspace.updated");
    return this.buildSurfaceSnapshot(session, target);
  }

  async deleteSession(sessionId: string): Promise<WorkspaceMutationResponse> {
    const managedSurfaces = Array.from(this.managedSurfaces.values()).filter((surface) => {
      return (
        this.resolvePromptTargetForSurfacePiSessionId(surface.sessionId).workspaceSessionId ===
        sessionId
      );
    });
    for (const surface of managedSurfaces) {
      await this.abortManagedSurfaceForDelete(surface);
    }

    const sessionFile = await this.getSessionFileForId(sessionId, false);
    const structuredSnapshot = this.getStructuredSnapshot(sessionId);

    for (const surface of managedSurfaces) {
      surface.session.dispose();
      this.managedSurfaces.delete(surface.sessionId);
      await this.emitSurfaceClosed(
        this.resolvePromptTargetForSurfacePiSessionId(surface.sessionId),
      );
    }

    if (sessionFile && existsSync(sessionFile)) {
      deleteSessionFileLikePi(sessionFile);
    }
    for (const thread of structuredSnapshot?.threads ?? []) {
      const threadSessionFile = await this.getSessionFileForId(thread.surfacePiSessionId, false);
      if (threadSessionFile && existsSync(threadSessionFile)) {
        deleteSessionFileLikePi(threadSessionFile);
      }
    }
    this.structuredSessionStore.deleteSessionState(sessionId);
    await this.emitWorkspaceSync("workspace.updated");
    return { ok: true };
  }

  async sendPrompt(options: SendAgentPromptOptions): Promise<SendAgentPromptResult> {
    this.assertValidPromptTarget(options.target);
    const session = await this.ensureManagedSurfaceForPrompt(options);
    const queued = this.enqueuePendingSurfacePrompt(options);
    this.structuredSessionStore.setComposerDraft({
      sessionId: options.target.workspaceSessionId,
      surfacePiSessionId: options.target.surfacePiSessionId,
      threadId: options.target.threadId ?? null,
      text: "",
      attachments: [],
    });
    const started = await this.drainNextQueuedSurfacePrompt(options.target, {
      awaitPrompt: false,
    });
    const snapshot = await this.buildSurfaceSnapshot(session, options.target);
    if (!started) {
      await this.emitSurfaceSync({
        session,
        reason: "surface.updated",
        target: options.target,
      });
      await this.emitWorkspaceSync("structured.updated");
      this.wakeSurfaceQueue(options.target);
    } else if (!session.activePrompt) {
      this.wakeSurfaceQueue(options.target);
    }

    return {
      target: structuredClone(queued.target),
      queued: true,
      snapshot,
    };
  }

  async updateComposerDraft(
    input: UpdateComposerDraftRequest,
  ): Promise<{ ok: boolean; target: PromptTarget; snapshot?: ConversationSurfaceSnapshot }> {
    this.assertValidPromptTarget(input.target);
    this.structuredSessionStore.setComposerDraft({
      sessionId: input.target.workspaceSessionId,
      surfacePiSessionId: input.target.surfacePiSessionId,
      threadId: input.target.threadId ?? null,
      text: input.draft.text,
      attachments: input.draft.attachments,
    });
    await this.emitWorkspaceSync("structured.updated");
    return { ok: true, target: structuredClone(input.target) };
  }

  async editCommittedUserMessage(
    options: EditCommittedUserMessageOptions,
  ): Promise<SendAgentPromptResult> {
    this.assertValidPromptTarget(options.target);
    const session = await this.loadManagedSurface(
      options.target.surfacePiSessionId,
      getActorKindForTarget(options.target),
      this.buildSystemPromptForTarget(options.target),
    );
    await this.restoreWorkflowSupervisionIfTracked(options.target.workspaceSessionId);
    if (session.activePrompt) {
      throw new Error("Wait for the current turn to finish before editing an earlier message.");
    }

    const targetTimestamp = String(options.messageTimestamp);
    const userEntry = session.session.sessionManager.getBranch().find((entry) => {
      return (
        entry.type === "message" &&
        entry.message.role === "user" &&
        String(entry.message.timestamp) === targetTimestamp
      );
    });
    if (!userEntry || userEntry.type !== "message") {
      throw new Error("Unable to edit: user message was not found in the active conversation.");
    }

    if (userEntry.parentId === null) {
      session.session.sessionManager.resetLeaf();
    } else {
      session.session.sessionManager.branch(userEntry.parentId);
    }
    session.session.agent.state.messages =
      session.session.sessionManager.buildSessionContext().messages;
    session.pendingUserMessage = null;
    session.activeStreamMessage = null;
    session.activeStreamSequence = 0;

    for (const queued of this.structuredSessionStore.listQueuedSurfaceMessages({
      surfacePiSessionId: options.target.surfacePiSessionId,
    })) {
      if (queued.status === "queued" || queued.status === "steering") {
        this.structuredSessionStore.cancelSurfaceMessage({ id: queued.id });
      }
    }

    this.syncManagedState(session);
    if (options.target.surface === "orchestrator") {
      this.syncStructuredPiSessionFromOrchestratorSession(session);
    }

    return this.sendPrompt({
      target: options.target,
      provider: session.provider,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      messages: [...convertToLlmMessages(session.session.agent.state.messages), options.message],
      onEvent: options.onEvent,
    });
  }

  async steerPrompt(options: SendAgentPromptOptions): Promise<SendAgentPromptResult> {
    this.assertValidPromptTarget(options.target);
    const text = getLatestUserPromptText(options.messages);
    if (!text) {
      throw new Error("No user message to steer.");
    }
    return this.sendPrompt({ ...options, queueOnly: true });
  }

  async deleteQueuedSurfaceMessage(input: {
    target: PromptTarget;
    queuedMessageId: string;
  }): Promise<{ ok: boolean; target: PromptTarget; snapshot?: ConversationSurfaceSnapshot }> {
    this.assertValidPromptTarget(input.target);
    this.assertQueuedMessageBelongsToSurface(input.queuedMessageId, input.target);
    this.structuredSessionStore.cancelSurfaceMessage({ id: input.queuedMessageId });
    const snapshot = await this.emitQueuedSurfaceUpdate(input.target);
    return { ok: true, target: structuredClone(input.target), snapshot };
  }

  async queuePromptRefresh(input: {
    target: PromptTarget;
  }): Promise<{ ok: boolean; target: PromptTarget; snapshot?: ConversationSurfaceSnapshot }> {
    this.assertValidPromptTarget(input.target);
    const queuedMessages = this.structuredSessionStore.listQueuedSurfaceMessages({
      surfacePiSessionId: input.target.surfacePiSessionId,
    });
    const existing = queuedMessages.find((message) => message.kind === "prompt_refresh");
    if (!existing) {
      this.structuredSessionStore.enqueueSurfaceMessage({
        sessionId: input.target.workspaceSessionId,
        surfacePiSessionId: input.target.surfacePiSessionId,
        threadId: input.target.threadId ?? null,
        kind: "prompt_refresh",
        idempotencyKey: `prompt_refresh:${input.target.surfacePiSessionId}:${this.promptLibraryStore.getState().revision}`,
        messageJson: "{}",
        payloadJson: JSON.stringify({
          requestedRevision: this.promptLibraryStore.getState().revision,
          requestedAt: new Date().toISOString(),
        } satisfies PromptRefreshQueuePayload),
        requestSummary: "Update instructions",
        position: "front",
      });
    }

    const started = await this.drainNextQueuedSurfacePrompt(input.target, {
      awaitPrompt: false,
    });
    const session = this.managedSurfaces.get(input.target.surfacePiSessionId);
    const snapshot = session ? await this.buildSurfaceSnapshot(session, input.target) : undefined;
    if (!started) {
      await this.emitQueuedSurfaceUpdate(input.target);
      this.wakeSurfaceQueue(input.target);
    } else if (!session?.activePrompt) {
      this.wakeSurfaceQueue(input.target);
    }
    return { ok: true, target: structuredClone(input.target), snapshot };
  }

  async editQueuedSurfaceMessage(input: {
    target: PromptTarget;
    queuedMessageId: string;
  }): Promise<{ ok: boolean; text?: string; snapshot?: ConversationSurfaceSnapshot }> {
    this.assertValidPromptTarget(input.target);
    const queued = this.assertQueuedMessageBelongsToSurface(input.queuedMessageId, input.target);
    if (queued.kind !== "user_message") {
      throw new Error("Only queued user messages can be restored to the composer.");
    }
    const text = this.getQueuedMessageText(queued.messageJson);
    this.structuredSessionStore.cancelSurfaceMessage({ id: input.queuedMessageId });
    const snapshot = await this.emitQueuedSurfaceUpdate(input.target);
    return { ok: true, text, snapshot };
  }

  async reorderQueuedSurfaceMessage(input: {
    target: PromptTarget;
    queuedMessageId: string;
    beforeQueuedMessageId?: string | null;
  }): Promise<{ ok: boolean; target: PromptTarget; snapshot?: ConversationSurfaceSnapshot }> {
    this.assertValidPromptTarget(input.target);
    this.assertQueuedMessageBelongsToSurface(input.queuedMessageId, input.target);
    if (input.beforeQueuedMessageId) {
      this.assertQueuedMessageBelongsToSurface(input.beforeQueuedMessageId, input.target);
    }
    this.structuredSessionStore.reorderSurfaceMessage({
      surfacePiSessionId: input.target.surfacePiSessionId,
      id: input.queuedMessageId,
      beforeId: input.beforeQueuedMessageId ?? null,
    });
    const snapshot = await this.emitQueuedSurfaceUpdate(input.target);
    return { ok: true, target: structuredClone(input.target), snapshot };
  }

  async steerQueuedSurfaceMessage(input: {
    target: PromptTarget;
    queuedMessageId: string;
  }): Promise<{ ok: boolean; target: PromptTarget; snapshot?: ConversationSurfaceSnapshot }> {
    this.assertValidPromptTarget(input.target);
    const queued = this.assertQueuedMessageBelongsToSurface(input.queuedMessageId, input.target);
    if (queued.kind === "prompt_refresh") {
      throw new Error("Queued context updates cannot be steered.");
    }
    this.structuredSessionStore.markSurfaceMessageQueued({
      id: input.queuedMessageId,
      position: "front",
    });
    const snapshot = await this.emitQueuedSurfaceUpdate(input.target);
    this.wakeSurfaceQueue(input.target);
    return { ok: true, target: structuredClone(input.target), snapshot };
  }

  async cancelPrompt(target: PromptTarget): Promise<void> {
    const session = this.managedSurfaces.get(target.surfacePiSessionId);
    if (!session?.activePrompt) {
      return;
    }

    session.abortRequested = true;
    this.restorePiQueuedMessagesToSurface(session, target);
    await this.emitQueuedSurfaceUpdate(target);
    await session.session.abort();
  }

  private async abortManagedSurfaceForDelete(session: ManagedSession): Promise<void> {
    if (!session.activePrompt) {
      return;
    }

    const target = this.resolvePromptTargetForSurfacePiSessionId(session.sessionId);
    const activePromptDone = session.activePromptDone;
    session.abortRequested = true;
    this.restorePiQueuedMessagesToSurface(session, target);
    await this.emitQueuedSurfaceUpdate(target);
    await session.session.abort();
    await activePromptDone?.catch((error) => {
      console.error("Failed to settle prompt before deleting session:", error);
    });
  }

  async setSurfaceModel(
    target: PromptTarget,
    provider: string,
    model: string,
  ): Promise<{ ok: boolean; target: PromptTarget }> {
    const session = this.managedSurfaces.get(target.surfacePiSessionId);
    if (!session) {
      return { ok: false, target: structuredClone(target) };
    }

    session.provider = provider;
    session.model = model;
    session.recreateOnNextPrompt = true;
    const profileChanged = this.updateOrchestratorProfileFromComposer(target, session, {
      provider,
      model,
    });

    if (session.activePrompt) {
      if (profileChanged) {
        await this.emitWorkspaceSync("workspace.updated");
      }
      return { ok: true, target: structuredClone(target) };
    }

    try {
      syncAuthStorage(session.authStorage);
      const resolvedModel = resolveRegisteredModel(session.modelRegistry, provider, model);
      if (resolvedModel) {
        await session.session.setModel(resolvedModel);
        session.recreateOnNextPrompt = false;
        this.syncManagedState(session);
        if (target.surface === "orchestrator") {
          this.syncStructuredPiSessionFromOrchestratorSession(session);
        }
      }
    } catch {
      // Fall back to recreating on the next prompt.
    }

    await this.emitSurfaceSync({
      reason: "surface.updated",
      session,
      target,
    });
    await this.emitWorkspaceSync("workspace.updated");
    return { ok: true, target: structuredClone(target) };
  }

  async setSurfaceThoughtLevel(
    target: PromptTarget,
    level: ThinkingLevel,
  ): Promise<{ ok: boolean; target: PromptTarget }> {
    const session = this.managedSurfaces.get(target.surfacePiSessionId);
    if (!session) {
      return { ok: false, target: structuredClone(target) };
    }

    session.thinkingLevel = level;
    const profileChanged = this.updateOrchestratorProfileFromComposer(target, session, {
      reasoningEffort: level,
    });

    if (session.activePrompt) {
      session.recreateOnNextPrompt = true;
      if (profileChanged) {
        await this.emitWorkspaceSync("workspace.updated");
      }
      return { ok: true, target: structuredClone(target) };
    }

    session.session.setThinkingLevel(level);
    this.syncManagedState(session);
    if (target.surface === "orchestrator") {
      this.syncStructuredPiSessionFromOrchestratorSession(session);
    }
    await this.emitSurfaceSync({
      reason: "surface.updated",
      session,
      target,
    });
    await this.emitWorkspaceSync("workspace.updated");
    return { ok: true, target: structuredClone(target) };
  }

  private updateOrchestratorProfileFromComposer(
    target: PromptTarget,
    session: ManagedSession,
    updates: Partial<Pick<AgentProfileSettings, "provider" | "model" | "reasoningEffort">>,
  ): boolean {
    if (target.surface !== "orchestrator") {
      return false;
    }
    const profile = this.agentSettingsStore
      .getState()
      .agents.orchestrators.find((agent) => agent.id === session.agentProfileId);
    if (!profile?.updateFromComposer) {
      return false;
    }
    const nextProfile = { ...profile, ...updates };
    if (
      nextProfile.provider === profile.provider &&
      nextProfile.model === profile.model &&
      nextProfile.reasoningEffort === profile.reasoningEffort
    ) {
      return false;
    }
    this.agentSettingsStore.setAgentProfile(nextProfile);
    return true;
  }

  private async ensureManagedSurfaceForPrompt(
    options: SendAgentPromptOptions,
  ): Promise<ManagedSession> {
    const actorKind = getActorKindForTarget(options.target);
    const session = await this.loadManagedSurface(
      options.target.surfacePiSessionId,
      actorKind,
      this.buildSystemPromptForTarget(options.target),
    );
    await this.restoreWorkflowSupervisionIfTracked(options.target.workspaceSessionId);
    return this.prepareManagedSession(session, options);
  }

  private async retainManagedSurface(target: PromptTarget): Promise<ManagedSession> {
    const session = await this.loadManagedSurface(
      target.surfacePiSessionId,
      getActorKindForTarget(target),
      this.buildSystemPromptForTarget(target),
    );
    session.retainCount += 1;
    return session;
  }

  private async loadManagedSurface(
    surfacePiSessionId: string,
    actorKind: SvvyActorKind,
    systemPrompt = this.buildPromptFromLibrary(actorKind),
  ): Promise<ManagedSession> {
    const existing = this.managedSurfaces.get(surfacePiSessionId);
    if (existing) {
      if (existing.actorKind === actorKind) {
        return existing;
      }
      return this.recreateManagedSurface(existing, {
        actorKind,
        systemPrompt,
      });
    }

    const sessionFile = await this.getSessionFileForId(surfacePiSessionId);
    const threadAgentSettings = this.resolveThreadProfileSettings(surfacePiSessionId);
    return this.createManagedSurfaceRecord({
      sessionManager: SessionManager.open(sessionFile!, dirname(sessionFile!)),
      actorKind,
      provider: threadAgentSettings?.provider,
      model: threadAgentSettings?.model,
      thinkingLevel: threadAgentSettings?.reasoningEffort,
      systemPrompt,
      agentProfileId:
        actorKind === "handler"
          ? DEFAULT_THREAD_HANDLER_PROFILE_ID
          : DEFAULT_ORCHESTRATOR_PROFILE_ID,
    });
  }

  private async releaseManagedSurface(
    surfacePiSessionId: string,
    options: { emitClosed?: boolean } = {},
  ): Promise<void> {
    const session = this.managedSurfaces.get(surfacePiSessionId);
    if (!session) {
      return;
    }

    session.retainCount = Math.max(0, session.retainCount - 1);
    await this.disposeManagedSurfaceIfUnused(session, options);
  }

  private async prepareManagedSession(
    session: ManagedSession,
    options: Pick<
      SendAgentPromptOptions,
      "provider" | "model" | "thinkingLevel" | "messages" | "target"
    >,
  ): Promise<ManagedSession> {
    const actorKind = getActorKindForTarget(options.target);
    const resolvedSystemPrompt = this.buildSystemPromptForTarget(options.target);
    if (
      session.actorKind !== actorKind ||
      session.provider !== options.provider ||
      session.model !== options.model ||
      session.recreateOnNextPrompt
    ) {
      return this.recreateManagedSurface(session, {
        actorKind,
        provider: options.provider,
        model: options.model,
        thinkingLevel: options.thinkingLevel,
        systemPrompt: resolvedSystemPrompt,
      });
    }

    if (session.thinkingLevel !== options.thinkingLevel) {
      session.thinkingLevel = options.thinkingLevel;
      session.session.setThinkingLevel(options.thinkingLevel);
    }

    return session;
  }

  private async recreateManagedSurface(
    session: ManagedSession,
    overrides: Partial<
      Pick<
        ManagedSession,
        | "actorKind"
        | "provider"
        | "model"
        | "thinkingLevel"
        | "systemPrompt"
        | "promptLibraryRevision"
        | "agentProfileId"
      >
    >,
  ): Promise<ManagedSession> {
    const sessionManager = session.session.sessionManager;
    const actorKind = overrides.actorKind ?? session.actorKind;
    const provider = overrides.provider ?? session.provider;
    const model = overrides.model ?? session.model;
    const thinkingLevel = overrides.thinkingLevel ?? session.thinkingLevel;
    const systemPrompt = overrides.systemPrompt ?? session.systemPrompt;
    const promptLibraryRevision = overrides.promptLibraryRevision ?? session.promptLibraryRevision;
    const agentProfileId = overrides.agentProfileId ?? session.agentProfileId;

    session.session.dispose();
    const nextSession = await createManagedSession({
      sessionManager,
      actorKind,
      provider,
      model,
      thinkingLevel,
      systemPrompt,
      promptLibraryRevision,
      agentProfileId,
      agentDir: this.agentDir,
      structuredSessionStore: this.structuredSessionStore,
      createHandlerThread: this.createHandlerThread.bind(this),
      resumeHandlerThread: this.resumeHandlerThread.bind(this),
      awaitThreadHandoffAcceptance: this.awaitThreadHandoffAcceptance.bind(this),
      onRequestContextLoaded: this.markPromptRefreshRequired.bind(this),
      smithersRuntimeManager: this.smithersRuntimeManager,
    });
    nextSession.retainCount = session.retainCount;
    this.managedSurfaces.set(nextSession.sessionId, nextSession);
    return nextSession;
  }

  private async refreshManagedSurfacePromptBinding(
    session: ManagedSession,
    target: PromptTarget,
  ): Promise<ManagedSession> {
    const refreshed = await this.recreateManagedSurface(session, {
      actorKind: getActorKindForTarget(target),
      systemPrompt: this.buildSystemPromptForTarget(target),
      promptLibraryRevision: this.promptLibraryStore.getState().revision,
    });
    refreshed.recreateOnNextPrompt = false;
    this.syncManagedState(refreshed);
    if (target.surface === "orchestrator") {
      this.syncStructuredPiSessionFromOrchestratorSession(refreshed);
    }
    this.persistManagedSessionSnapshot(refreshed);
    return refreshed;
  }

  private async createManagedSurfaceRecord(
    options: CreateManagedSessionOptions,
  ): Promise<ManagedSession> {
    const session = await createManagedSession({
      ...options,
      promptLibraryRevision:
        options.promptLibraryRevision ?? this.promptLibraryStore.getState().revision,
      agentDir: this.agentDir,
      structuredSessionStore: this.structuredSessionStore,
      createHandlerThread: this.createHandlerThread.bind(this),
      resumeHandlerThread: this.resumeHandlerThread.bind(this),
      awaitThreadHandoffAcceptance: this.awaitThreadHandoffAcceptance.bind(this),
      onRequestContextLoaded: this.markPromptRefreshRequired.bind(this),
      smithersRuntimeManager: this.smithersRuntimeManager,
    });
    this.managedSurfaces.set(session.sessionId, session);
    return session;
  }

  private markPromptRefreshRequired(surfacePiSessionId: string): void {
    const session = this.managedSurfaces.get(surfacePiSessionId);
    if (session) {
      session.recreateOnNextPrompt = true;
    }
  }

  private async disposeManagedSurfaceIfUnused(
    session: ManagedSession,
    options: { emitClosed?: boolean } = {},
  ): Promise<void> {
    if (session.retainCount > 0 || session.activePrompt) {
      return;
    }
    session.session.dispose();
    this.managedSurfaces.delete(session.sessionId);
    if (options.emitClosed ?? true) {
      await this.emitSurfaceClosed(
        this.resolvePromptTargetForSurfacePiSessionId(session.sessionId),
      );
    }
  }

  private buildLiveSummaryFromManagedSession(session: ManagedSession): WorkspaceSessionSummary {
    const header = session.session.sessionManager.getHeader();
    return projectWorkspaceSessionSummary({
      id: session.sessionId,
      name: session.session.sessionManager.getSessionName(),
      firstMessage: undefined,
      createdAt: header?.timestamp ?? new Date().toISOString(),
      updatedAt: header?.timestamp ?? new Date().toISOString(),
      messageCount: countVisibleMessages(session.session.agent.state.messages),
      messages: session.session.agent.state.messages,
      sessionFile: session.session.sessionManager.getSessionFile(),
      parentSessionFile: header?.parentSession,
      provider: session.provider,
      modelId: session.model,
      thinkingLevel: session.thinkingLevel,
    });
  }

  private async buildSummaryFromManagedSession(
    session: ManagedSession,
  ): Promise<WorkspaceSessionSummary> {
    return await this.decorateSummaryWithStructuredProjection(
      this.buildLiveSummaryFromManagedSession(session),
    );
  }

  private projectSummaryFromStructuredSnapshot(
    snapshot: StructuredSessionSnapshot,
  ): WorkspaceSessionSummary {
    const baseSummary = projectWorkspaceSessionSummaryFromInfo({
      id: snapshot.pi.sessionId,
      name: snapshot.pi.title,
      firstMessage: undefined,
      created: snapshot.pi.createdAt,
      modified: snapshot.pi.updatedAt,
      messageCount: snapshot.pi.messageCount,
      path: undefined,
      parentSessionPath: undefined,
    });

    return {
      ...baseSummary,
      provider: snapshot.pi.provider,
      modelId: snapshot.pi.model,
      thinkingLevel: snapshot.pi.reasoningEffort,
    };
  }

  async listOpenSurfaceSnapshots(): Promise<ConversationSurfaceSnapshot[]> {
    const snapshots: ConversationSurfaceSnapshot[] = [];
    for (const session of this.managedSurfaces.values()) {
      snapshots.push(
        await this.buildSurfaceSnapshot(
          session,
          this.resolvePromptTargetForSurfacePiSessionId(session.sessionId),
        ),
      );
    }
    return snapshots;
  }

  private async buildSurfaceSnapshot(
    session: ManagedSession,
    target: PromptTarget,
    options: { refreshExternalSources?: boolean } = {},
  ): Promise<ConversationSurfaceSnapshot> {
    const currentExternalSources = options.refreshExternalSources
      ? await this.buildCurrentExternalContextSources()
      : session.externalContextSources;
    const activeTurn = session.activePrompt ? this.getActiveRunningTurnForSurface(target) : null;
    const messages = structuredClone(session.session.agent.state.messages);
    return {
      target: structuredClone(target),
      provider: session.provider,
      model: session.model,
      reasoningEffort: session.thinkingLevel,
      agentProfileId: session.agentProfileId,
      systemPrompt: session.systemPrompt,
      resolvedSystemPrompt: getResolvedSystemPrompt(session),
      externalContextSources: structuredClone(session.externalContextSources),
      promptBinding: this.buildPromptBinding(session, target, currentExternalSources),
      messages,
      pendingUserMessage: session.pendingUserMessage
        ? structuredClone(session.pendingUserMessage.message)
        : null,
      queuedMessages: this.buildQueuedSurfaceMessages(target.surfacePiSessionId),
      composerDraft: this.buildComposerDraft(target.surfacePiSessionId),
      streamMessage: session.activeStreamMessage
        ? structuredClone(session.activeStreamMessage)
        : null,
      streamSequence: session.activeStreamMessage ? session.activeStreamSequence : 0,
      promptStatus: session.activePrompt ? "streaming" : "idle",
      activeTurnId: activeTurn?.id ?? null,
      activeTurnStartedAt: activeTurn?.startedAt ?? null,
      turnTimings: this.buildSurfaceTurnTimings(target, messages),
    };
  }

  private buildComposerDraft(surfacePiSessionId: string): ComposerDraft {
    const draft = this.structuredSessionStore.getComposerDraft(surfacePiSessionId);
    return {
      text: draft?.text ?? "",
      attachments: draft?.attachments ? structuredClone(draft.attachments) : [],
      updatedAt: draft?.updatedAt ?? null,
    };
  }

  private getActiveRunningTurnForSurface(
    target: PromptTarget,
  ): StructuredSessionSnapshot["turns"][number] | null {
    const snapshot = this.getStructuredSnapshot(target.workspaceSessionId);
    if (!snapshot) {
      return null;
    }

    return (
      snapshot.turns
        .filter(
          (turn) =>
            turn.surfacePiSessionId === target.surfacePiSessionId && turn.status === "running",
        )
        .toSorted((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0] ??
      null
    );
  }

  private buildSurfaceTurnTimings(
    target: PromptTarget,
    messages: AgentMessage[],
  ): ConversationTurnTiming[] {
    const snapshot = this.getStructuredSnapshot(target.workspaceSessionId);
    if (!snapshot) {
      return [];
    }

    const turns = snapshot.turns
      .filter(
        (turn) =>
          turn.surfacePiSessionId === target.surfacePiSessionId &&
          turn.status === "completed" &&
          turn.finishedAt,
      )
      .toSorted((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
    const assistantMessages = messages
      .filter((message) => message.role === "assistant")
      .toSorted(
        (left, right) => messageTimestampMs(left.timestamp) - messageTimestampMs(right.timestamp),
      );
    const timings: ConversationTurnTiming[] = [];
    let assistantIndex = 0;

    for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
      const turn = turns[turnIndex];
      if (!turn || !turn.finishedAt) {
        continue;
      }
      const nextTurn = turns[turnIndex + 1] ?? null;
      const turnStartedAtMs = Date.parse(turn.startedAt);
      const nextTurnStartedAtMs = nextTurn
        ? Date.parse(nextTurn.startedAt)
        : Number.POSITIVE_INFINITY;

      while (assistantIndex < assistantMessages.length) {
        const message = assistantMessages[assistantIndex];
        if (!message) {
          break;
        }
        const messageTimestamp = messageTimestampMs(message.timestamp);
        if (messageTimestamp < turnStartedAtMs) {
          assistantIndex += 1;
          continue;
        }
        if (messageTimestamp >= nextTurnStartedAtMs) {
          break;
        }

        timings.push({
          turnId: turn.id,
          assistantMessageTimestamp: message.timestamp,
          startedAt: turn.startedAt,
          finishedAt: turn.finishedAt,
        });
        assistantIndex += 1;
        break;
      }
    }

    return timings;
  }

  private buildQueuedSurfaceMessages(surfacePiSessionId: string): QueuedSurfaceMessage[] {
    return this.structuredSessionStore
      .listQueuedSurfaceMessages({ surfacePiSessionId })
      .filter((message) => message.status !== "dispatching")
      .map((message) => {
        const payload =
          message.kind === "handler_handoff" ? this.parseHandlerHandoffQueuePayload(message) : null;
        const promptRefreshPayload =
          message.kind === "prompt_refresh" ? this.parsePromptRefreshQueuePayload(message) : null;
        const workflowAttentionPayload =
          message.kind === "workflow_attention"
            ? this.parseWorkflowAttentionQueuePayload(message)
            : null;
        return {
          id: message.id,
          kind: message.kind,
          text: promptRefreshPayload
            ? "Update instructions"
            : message.kind === "initial_handler_start"
              ? "Start handler thread"
              : workflowAttentionPayload
                ? `Workflow attention: ${workflowAttentionPayload.summary}`
                : payload
                  ? `Handler handoff: ${payload.summary}`
                  : this.getQueuedMessageText(message.messageJson),
          title: payload?.title,
          summary: promptRefreshPayload
            ? `Context revision ${promptRefreshPayload.requestedRevision}`
            : workflowAttentionPayload?.summary
              ? workflowAttentionPayload.summary
              : payload?.summary,
          threadId:
            payload?.threadId ??
            workflowAttentionPayload?.threadId ??
            message.threadId ??
            undefined,
          sourceCommandId: payload?.sourceCommandId,
          status:
            message.status === "dispatching"
              ? "dispatching"
              : message.status === "steering"
                ? "steering"
                : "queued",
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        };
      });
  }

  private parseHandlerHandoffQueuePayload(
    message: StructuredSurfaceQueuedMessageRecord,
  ): HandlerHandoffQueuePayload | null {
    if (!message.payloadJson) {
      return null;
    }
    try {
      const payload = JSON.parse(message.payloadJson) as HandlerHandoffQueuePayload;
      if (
        typeof payload.threadId !== "string" ||
        typeof payload.sourceCommandId !== "string" ||
        typeof payload.turnId !== "string" ||
        typeof payload.title !== "string" ||
        typeof payload.summary !== "string" ||
        typeof payload.body !== "string"
      ) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private parsePromptRefreshQueuePayload(
    message: StructuredSurfaceQueuedMessageRecord,
  ): PromptRefreshQueuePayload | null {
    if (!message.payloadJson) {
      return null;
    }
    try {
      const payload = JSON.parse(message.payloadJson) as PromptRefreshQueuePayload;
      if (
        typeof payload.requestedRevision !== "number" ||
        typeof payload.requestedAt !== "string"
      ) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private parseWorkflowAttentionQueuePayload(
    message: StructuredSurfaceQueuedMessageRecord,
  ): WorkflowAttentionQueuePayload | null {
    if (!message.payloadJson) {
      return null;
    }
    try {
      const payload = JSON.parse(message.payloadJson) as WorkflowAttentionQueuePayload;
      if (
        typeof payload.sessionId !== "string" ||
        typeof payload.threadId !== "string" ||
        typeof payload.workflowRunId !== "string" ||
        typeof payload.smithersRunId !== "string" ||
        typeof payload.workflowId !== "string" ||
        typeof payload.summary !== "string" ||
        typeof payload.reason !== "string"
      ) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private buildInitialHandlerQueuedPrompt(message: StructuredSurfaceQueuedMessageRecord): string {
    const snapshot = this.getStructuredSnapshot(message.sessionId);
    const thread = snapshot?.threads.find((entry) => entry.id === message.threadId) ?? null;
    if (!thread) {
      throw new Error(`Queued initial handler start ${message.id} has no handler thread.`);
    }
    return buildInitialHandlerThreadPrompt(thread);
  }

  private buildWorkflowAttentionQueuedPrompt(
    message: StructuredSurfaceQueuedMessageRecord,
  ): string {
    const payload = this.parseWorkflowAttentionQueuePayload(message);
    if (!payload) {
      throw new Error(`Queued workflow attention ${message.id} has malformed payload.`);
    }
    const snapshot = this.getStructuredSnapshot(payload.sessionId);
    const thread = snapshot?.threads.find((entry) => entry.id === payload.threadId) ?? null;
    if (!snapshot || !thread) {
      throw new Error(`Queued workflow attention ${message.id} has no handler thread.`);
    }
    return buildHandlerWorkflowAttentionPrompt({
      thread,
      workflowRun:
        snapshot.workflowRuns.find((workflowRun) => workflowRun.id === payload.workflowRunId) ??
        null,
      reason: payload.reason,
      summary: payload.summary,
      workflowId: payload.workflowId,
      smithersRunId: payload.smithersRunId,
    });
  }

  private buildHandlerHandoffQueuedPrompt(message: StructuredSurfaceQueuedMessageRecord): string {
    const payload = this.parseHandlerHandoffQueuePayload(message);
    if (!payload) {
      throw new Error(`Queued handler handoff ${message.id} has malformed payload.`);
    }
    const snapshot = this.getStructuredSnapshot(message.sessionId);
    const thread = snapshot?.threads.find((entry) => entry.id === payload.threadId) ?? null;
    return buildOrchestratorHandoffResumePrompt(thread, payload.summary);
  }

  private acceptHandlerHandoffQueueItem(
    message: StructuredSurfaceQueuedMessageRecord,
  ): ThreadHandoffAcceptance {
    const payload = this.parseHandlerHandoffQueuePayload(message);
    if (!payload) {
      throw new Error(`Queued handler handoff ${message.id} has malformed payload.`);
    }

    const snapshot = this.getStructuredSnapshot(message.sessionId);
    const existingEpisode =
      snapshot?.episodes.find((episode) => episode.sourceCommandId === payload.sourceCommandId) ??
      null;
    const episode =
      existingEpisode ??
      (() => {
        this.structuredSessionStore.updateThread({
          threadId: payload.threadId,
          status: "completed",
          wait: null,
        });
        return this.structuredSessionStore.createEpisode({
          threadId: payload.threadId,
          sourceCommandId: payload.sourceCommandId,
          kind: payload.kind,
          title: payload.title,
          summary: payload.summary,
          body: payload.body,
        });
      })();
    const acceptance: ThreadHandoffAcceptance = {
      episodeId: episode.id,
      kind: episode.kind,
      title: episode.title,
      summary: episode.summary,
    };
    return acceptance;
  }

  private getQueuedMessageText(messageJson: string): string {
    try {
      const message = JSON.parse(messageJson) as Message;
      if (message.role !== "user") {
        return "";
      }
      return flattenUserMessageContent(message.content).trim();
    } catch {
      return "";
    }
  }

  private assertQueuedMessageBelongsToSurface(
    queuedMessageId: string,
    target: PromptTarget,
  ): ReturnType<StructuredSessionStateStore["getSurfaceQueuedMessage"]> {
    const queued = this.structuredSessionStore.getSurfaceQueuedMessage({ id: queuedMessageId });
    if (
      queued.sessionId !== target.workspaceSessionId ||
      queued.surfacePiSessionId !== target.surfacePiSessionId
    ) {
      throw new Error(`Queued surface message ${queuedMessageId} does not belong to target.`);
    }
    return queued;
  }

  private async emitQueuedSurfaceUpdate(
    target: PromptTarget,
  ): Promise<ConversationSurfaceSnapshot | undefined> {
    const session = this.managedSurfaces.get(target.surfacePiSessionId);
    if (!session) {
      await this.emitWorkspaceSync("structured.updated");
      return undefined;
    }
    await this.emitSurfaceSync({
      session,
      reason: "surface.updated",
      target,
    });
    await this.emitWorkspaceSync("structured.updated");
    return this.buildSurfaceSnapshot(session, target);
  }

  private async emitOpenSurfacePromptBindingUpdates(): Promise<void> {
    if (this.closed) {
      return;
    }
    for (const session of this.managedSurfaces.values()) {
      await this.emitSurfaceSync({
        session,
        reason: "surface.updated",
        target: this.resolvePromptTargetForSurfacePiSessionId(session.sessionId),
      });
    }
  }

  private async emitSurfaceSync(input: {
    session: ManagedSession;
    reason: SurfaceSyncMessage["reason"];
    target: PromptTarget;
  }): Promise<void> {
    if (!this.surfaceSyncListener) {
      return;
    }

    try {
      this.surfaceSyncListener({
        workspaceId: this.workspaceId,
        reason: input.reason,
        target: structuredClone(input.target),
        snapshot: await this.buildSurfaceSnapshot(input.session, input.target),
      });
    } catch (error) {
      console.error("Failed to emit surface sync payload:", error);
    }
  }

  private emitSurfaceStreamPatch(input: {
    session: ManagedSession;
    target: PromptTarget;
    patch: SurfaceStreamPatchInput;
  }): void {
    if (!this.surfaceSyncListener) {
      return;
    }

    input.session.activeStreamSequence += 1;
    try {
      this.surfaceSyncListener({
        workspaceId: this.workspaceId,
        reason: "stream.patch",
        target: structuredClone(input.target),
        streamPatch: {
          ...structuredClone(input.patch),
          sequence: input.session.activeStreamSequence,
        } as SurfaceStreamPatch,
      });
    } catch (error) {
      console.error("Failed to emit surface stream patch:", error);
    }
  }

  private async emitStructuredStateSync(sessionId: string): Promise<void> {
    await this.emitWorkspaceSync("structured.updated");
    const orchestratorSurface = this.managedSurfaces.get(sessionId);
    if (!orchestratorSurface) {
      return;
    }
    try {
      await this.emitSurfaceSync({
        reason: "surface.updated",
        session: orchestratorSurface,
        target: this.buildOrchestratorPromptTarget(sessionId),
      });
    } catch (error) {
      console.error(`Failed to emit structured surface sync for ${sessionId}:`, error);
    }
  }

  private async emitWorkspaceSync(reason: WorkspaceSyncMessage["reason"]): Promise<void> {
    if (this.closed || !this.workspaceSyncListener) {
      return;
    }

    try {
      const payload = await this.listSessions();
      if (this.closed) {
        return;
      }
      this.workspaceSyncListener({
        workspaceId: this.workspaceId,
        reason,
        sessions: payload.sessions,
        navigation: payload.navigation,
      });
    } catch (error) {
      if (this.closed) {
        return;
      }
      console.error("Failed to emit workspace sync payload:", error);
    }
  }

  private async emitSurfaceClosed(target: PromptTarget): Promise<void> {
    if (!this.surfaceSyncListener) {
      return;
    }
    this.surfaceSyncListener({
      workspaceId: this.workspaceId,
      reason: "surface.closed",
      target: structuredClone(target),
    });
  }

  private async restoreWorkflowSupervisionIfTracked(sessionId: string): Promise<void> {
    const snapshot = this.getStructuredSnapshot(sessionId);
    if (!snapshot || !hasRestorableWorkflowSupervision(snapshot)) {
      return;
    }
    await this.restoreWorkflowSupervisionForSession(sessionId);
  }

  private async restoreWorkflowSupervisionForSession(sessionId: string): Promise<void> {
    if (this.closed || this.restoredWorkflowSupervisionSessionIds.has(sessionId)) {
      return;
    }
    const existingTask = this.workflowSupervisionRestoreTasks.get(sessionId);
    if (existingTask) {
      await existingTask;
      return;
    }

    const task = (async () => {
      await this.smithersRuntimeManager.restoreSessionSupervision(sessionId);
      if (!this.closed) {
        this.restoredWorkflowSupervisionSessionIds.add(sessionId);
      }
    })();
    this.workflowSupervisionRestoreTasks.set(sessionId, task);

    try {
      await task;
    } finally {
      this.workflowSupervisionRestoreTasks.delete(sessionId);
    }
  }

  private recoverInterruptedSurfaceTurn(surfacePiSessionId: string): void {
    const snapshot = this.structuredSessionStore
      .listSessionStates()
      .find((state) =>
        state.turns.some(
          (turn) =>
            turn.surfacePiSessionId === surfacePiSessionId &&
            (turn.status === "running" || turn.status === "waiting"),
        ),
      );
    const turn = snapshot?.turns.find(
      (entry) =>
        entry.surfacePiSessionId === surfacePiSessionId &&
        (entry.status === "running" || entry.status === "waiting"),
    );
    if (!snapshot || !turn) {
      return;
    }

    this.structuredSessionStore.recordLifecycleEvent({
      sessionId: snapshot.session.id,
      kind: "surface.turn_recovery.interrupted",
      subjectKind: "turn",
      subjectId: turn.id,
      data: {
        surfacePiSessionId,
        reason:
          "Prompt acceptance could not be proven after workspace restart; recovery did not silently resend it.",
      },
    });
    this.structuredSessionStore.finishTurn({
      turnId: turn.id,
      status: turn.status === "waiting" ? "waiting" : "failed",
    });
  }

  private recoverHandlerHandoffResolution(queuedItemId: string): void {
    let queued: StructuredSurfaceQueuedMessageRecord;
    try {
      queued = this.structuredSessionStore.getSurfaceQueuedMessage({ id: queuedItemId });
    } catch {
      return;
    }
    if (queued.kind !== "handler_handoff" || queued.status === "delivered") {
      return;
    }
    if (!this.parseHandlerHandoffQueuePayload(queued)) {
      this.structuredSessionStore.cancelSurfaceMessage({ id: queued.id });
      return;
    }
    if (queued.status !== "queued") {
      this.structuredSessionStore.markSurfaceMessageQueued({ id: queued.id, position: "front" });
    }
  }

  private buildOrchestratorPromptTarget(workspaceSessionId: string): PromptTarget {
    return {
      workspaceSessionId,
      surface: "orchestrator",
      surfacePiSessionId: workspaceSessionId,
    };
  }

  private buildSystemPromptForTarget(target: PromptTarget): string {
    if (target.surface !== "thread" || !target.threadId) {
      const snapshot = this.getStructuredSnapshot(target.workspaceSessionId);
      const profileId = snapshot?.pi.orchestratorAgentProfileId ?? DEFAULT_ORCHESTRATOR_PROFILE_ID;
      const settings = this.resolveOrchestratorProfileSettingsFromSnapshot(snapshot, profileId);
      return buildOrchestratorProfileSystemPrompt(
        settings,
        this.promptLibraryStore.getState(),
        this.cwd,
        this.createActiveWebProvider(),
      );
    }

    const thread =
      this.getStructuredSnapshot(target.workspaceSessionId)?.threads.find(
        (candidate) => candidate.id === target.threadId,
      ) ?? null;
    const basePrompt = this.buildPromptFromLibrary("handler", {
      loadedContextKeys: thread?.loadedContextKeys ?? [],
    });
    const agentSettings = this.resolveThreadProfileSettings(target.surfacePiSessionId);
    const suffix = agentSettings?.systemPrompt.trim();
    return suffix ? `${basePrompt}\n\n## Handler Profile Override\n${suffix}` : basePrompt;
  }

  private resolveOrchestratorAgentProfile(profileId: AgentProfileId): AgentProfileSettings {
    const profile = this.agentSettingsStore
      .getState()
      .agents.orchestrators.find((agent) => agent.id === profileId);
    if (!profile) {
      throw new Error(`Unknown orchestrator agent profile: ${profileId}`);
    }
    return profile;
  }

  private resolveThreadProfileSettings(surfacePiSessionId: string): AgentPromptSettings | null {
    for (const session of this.structuredSessionStore.listSessionStates()) {
      const thread = session.threads.find(
        (candidate) => candidate.surfacePiSessionId === surfacePiSessionId,
      );
      if (!thread?.agentProfileJson) continue;
      try {
        const parsed = JSON.parse(thread.agentProfileJson) as AgentPromptSettings;
        if (parsed.provider && parsed.model && parsed.reasoningEffort) {
          return parsed;
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  private createActiveWebProvider() {
    const webProvider = this.agentSettingsStore.getState().appPreferences.webProvider;
    return createWebProvider(
      { provider: webProvider },
      {
        tinyfishApiKey: resolveApiKey("tinyfish"),
        firecrawlApiKey: resolveApiKey("firecrawl"),
      },
    );
  }

  private buildPromptFromLibrary(
    actor: SvvyActorKind,
    options: { loadedContextKeys?: readonly string[] } = {},
  ): string {
    return buildSystemPrompt(actor, {
      ...options,
      promptLibraryState: this.promptLibraryStore.getState(),
      workspaceKey: this.cwd,
      webProvider: this.createActiveWebProvider(),
    });
  }

  private buildPromptBinding(
    session: ManagedSession,
    target: PromptTarget,
    currentExternalSources: readonly PromptLibraryExternalSource[],
  ) {
    const currentState = this.promptLibraryStore.getState();
    const currentSystemPrompt = this.buildSystemPromptForTarget(target);
    const currentExternalSourceHashes = externalSourceHashes(currentExternalSources);
    const boundExternalSourceHashes = externalSourceHashes(session.externalContextSources);
    return {
      currentRevision: currentState.revision,
      boundSystemPrompt: session.systemPrompt,
      currentSystemPrompt,
      boundExternalSourceHashes,
      currentExternalSourceHashes,
      stale:
        session.systemPrompt !== currentSystemPrompt ||
        !sameStringList(boundExternalSourceHashes, currentExternalSourceHashes),
    };
  }

  private resolveOrchestratorProfileSettingsFromSnapshot(
    snapshot: StructuredSessionSnapshot | null | undefined,
    key: AgentProfileId,
  ): AgentPromptSettings {
    const current =
      this.agentSettingsStore.getState().agents.orchestrators.find((agent) => agent.id === key) ??
      this.agentSettingsStore.getState().agents.orchestrators[0];
    if (!current) {
      throw new Error("No orchestrator agent profiles are configured.");
    }
    const json = snapshot?.pi.orchestratorAgentProfileJson;
    if (!json) {
      return current;
    }
    try {
      const parsed = JSON.parse(json) as AgentPromptSettings;
      if (parsed.provider && parsed.model && parsed.reasoningEffort) {
        return parsed;
      }
    } catch {
      return current;
    }
    return current;
  }

  private resolvePromptTargetForSurfacePiSessionId(surfacePiSessionId: string): PromptTarget {
    for (const session of this.structuredSessionStore.listSessionStates()) {
      const thread = session.threads.find(
        (candidate) => candidate.surfacePiSessionId === surfacePiSessionId,
      );
      if (thread) {
        return {
          workspaceSessionId: session.session.id,
          surface: "thread",
          surfacePiSessionId,
          threadId: thread.id,
        };
      }
    }

    return this.buildOrchestratorPromptTarget(surfacePiSessionId);
  }

  private assertValidPromptTarget(target: PromptTarget): void {
    if (target.surface === "orchestrator") {
      if (target.threadId) {
        throw new Error("Orchestrator targets cannot include a handler thread id.");
      }
      if (target.surfacePiSessionId !== target.workspaceSessionId) {
        throw new Error(
          "Orchestrator target must use the workspace session id as its pi surface id.",
        );
      }
      return;
    }

    if (!target.threadId) {
      throw new Error("Handler thread targets must include a handler thread id.");
    }

    const snapshot = this.getStructuredSnapshot(target.workspaceSessionId);
    const thread = snapshot?.threads.find((candidate) => candidate.id === target.threadId) ?? null;
    if (!thread) {
      throw new Error(`Structured handler thread not found: ${target.threadId}`);
    }
    if (thread.surfacePiSessionId !== target.surfacePiSessionId) {
      throw new Error(
        `Handler thread ${target.threadId} does not match pi surface ${target.surfacePiSessionId}.`,
      );
    }
  }

  private async buildSummaryFromSessionInfo(
    info: WorkspaceSessionInfo,
  ): Promise<WorkspaceSessionSummary> {
    return await this.decorateSummaryWithStructuredProjection(
      this.projectSummaryFromSessionInfo(info),
    );
  }

  private projectSummaryFromSessionInfo(info: WorkspaceSessionInfo): WorkspaceSessionSummary {
    return projectWorkspaceSessionSummaryFromInfo({
      id: info.id,
      name: info.name,
      firstMessage: info.firstMessage,
      created: info.created,
      modified: info.modified,
      messageCount: info.messageCount,
      path: info.path,
      parentSessionPath: info.parentSessionPath,
    });
  }

  private syncStructuredPiSessionFromSummary(summary: WorkspaceSessionSummary): void {
    if (this.structuredSessionStore.isSessionDeleted(summary.id)) {
      return;
    }

    try {
      const snapshot = this.getStructuredSnapshot(summary.id);
      this.structuredSessionStore.upsertPiSession({
        sessionId: summary.id,
        title: summary.title,
        provider: summary.provider ?? snapshot?.pi.provider,
        model: summary.modelId ?? snapshot?.pi.model,
        reasoningEffort: summary.thinkingLevel ?? snapshot?.pi.reasoningEffort,
        orchestratorAgentProfileId:
          snapshot?.pi.orchestratorAgentProfileId ?? DEFAULT_ORCHESTRATOR_PROFILE_ID,
        orchestratorAgentProfileJson:
          snapshot?.pi.orchestratorAgentProfileJson ??
          JSON.stringify(this.resolveOrchestratorAgentProfile(DEFAULT_ORCHESTRATOR_PROFILE_ID)),
        titleNamerAgentJson:
          snapshot?.pi.titleNamerAgentJson ??
          JSON.stringify(this.agentSettingsStore.getState().agents.titleNamer),
        messageCount: summary.messageCount,
        status: summary.status,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
      });
    } catch (error) {
      console.error("Failed to upsert structured session metadata:", error);
    }
  }

  private syncStructuredPiSessionFromOrchestratorSession(session: ManagedSession): void {
    if (this.structuredSessionStore.isSessionDeleted(session.sessionId)) {
      return;
    }

    this.syncStructuredPiSessionFromSummary(this.buildLiveSummaryFromManagedSession(session));
    const summary = this.buildLiveSummaryFromManagedSession(session);
    const state = this.agentSettingsStore.getState();
    const profile =
      state.agents.orchestrators.find((agent) => agent.id === session.agentProfileId) ??
      state.agents.orchestrators[0];
    this.structuredSessionStore.upsertPiSession({
      sessionId: summary.id,
      title: summary.title,
      provider: session.provider,
      model: session.model,
      reasoningEffort: session.thinkingLevel,
      orchestratorAgentProfileId: session.agentProfileId,
      orchestratorAgentProfileJson: JSON.stringify(profile),
      titleNamerAgentJson: JSON.stringify(state.agents.titleNamer),
      messageCount: summary.messageCount,
      status: summary.status,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    });
  }

  private async syncStructuredPiSessionFromWorkspaceSession(
    workspaceSessionId: string,
  ): Promise<boolean> {
    if (this.structuredSessionStore.isSessionDeleted(workspaceSessionId)) {
      return false;
    }

    const orchestratorSurface = this.managedSurfaces.get(workspaceSessionId);
    if (orchestratorSurface) {
      this.syncStructuredPiSessionFromOrchestratorSession(orchestratorSurface);
      return true;
    }

    const infos = await SessionManager.list(this.cwd, this.sessionDir);
    const info = infos.find((candidate) => candidate.id === workspaceSessionId);
    if (info) {
      this.syncStructuredPiSessionFromSummary(this.projectSummaryFromSessionInfo(info));
      return true;
    }

    const snapshot = this.getStructuredSnapshot(workspaceSessionId);
    if (snapshot) {
      this.syncStructuredPiSessionFromSummary(this.projectSummaryFromStructuredSnapshot(snapshot));
      return true;
    }
    return false;
  }

  private setPendingUserMessage(
    session: ManagedSession,
    promptContext: PromptExecutionContext | null,
    message: Message | null,
  ): void {
    session.pendingUserMessage =
      promptContext && message
        ? { turnId: promptContext.turnId, message: structuredClone(message) }
        : null;
  }

  private enqueuePendingSurfacePrompt(options: SendAgentPromptOptions): {
    target: PromptTarget;
    queuedMessageId: string;
  } {
    const message = getLatestUserMessage(options.messages);
    if (!message) {
      throw new Error("No user message to queue.");
    }
    const text = flattenUserMessageContent(message.content).trim();
    if (!text) {
      throw new Error("No user message to queue.");
    }

    const queued = this.structuredSessionStore.enqueueSurfaceMessage({
      sessionId: options.target.workspaceSessionId,
      surfacePiSessionId: options.target.surfacePiSessionId,
      threadId: options.target.threadId ?? null,
      messageJson: JSON.stringify(message),
      requestSummary: summarizePromptForTurn(text),
    });

    return { target: structuredClone(options.target), queuedMessageId: queued.id };
  }

  private async awaitThreadHandoffAcceptance(
    request: ThreadHandoffRequest,
  ): Promise<ThreadHandoffAcceptance> {
    const orchestratorTarget = this.buildOrchestratorPromptTarget(request.runtime.sessionId);
    const payload: HandlerHandoffQueuePayload = {
      threadId: request.runtime.surfaceThreadId,
      sourceCommandId: request.commandId,
      turnId: request.runtime.turnId,
      title: request.title,
      summary: request.summary,
      body: request.body,
      kind: request.kind,
    };
    const queued = this.structuredSessionStore.enqueueSurfaceMessage({
      sessionId: orchestratorTarget.workspaceSessionId,
      surfacePiSessionId: orchestratorTarget.surfacePiSessionId,
      kind: "handler_handoff",
      idempotencyKey: `handler_handoff:${request.commandId}`,
      messageJson: "{}",
      payloadJson: JSON.stringify(payload),
      requestSummary: request.summary,
    });

    const acceptance = this.acceptHandlerHandoffQueueItem(queued);
    void this.emitQueuedSurfaceUpdate(orchestratorTarget);
    this.wakeSurfaceQueue(orchestratorTarget);
    return acceptance;
  }

  private restorePiQueuedMessagesToSurface(session: ManagedSession, target: PromptTarget): void {
    const cleared = session.session.clearQueue();
    const texts = [...cleared.steering, ...cleared.followUp]
      .map((text) => text.trim())
      .filter(Boolean);
    const steeringRows = this.structuredSessionStore
      .listQueuedSurfaceMessages({ surfacePiSessionId: target.surfacePiSessionId })
      .filter((message) => message.status === "steering");
    for (const text of texts.toReversed()) {
      const existingSteeringIndex = steeringRows.findIndex(
        (message) => this.getQueuedMessageText(message.messageJson) === text,
      );
      if (existingSteeringIndex >= 0) {
        const [existingSteering] = steeringRows.splice(existingSteeringIndex, 1);
        if (existingSteering) {
          this.structuredSessionStore.markSurfaceMessageQueued({
            id: existingSteering.id,
            position: "front",
          });
          continue;
        }
      }
      const message = createSyntheticUserMessage(text);
      this.structuredSessionStore.enqueueSurfaceMessage({
        sessionId: target.workspaceSessionId,
        surfacePiSessionId: target.surfacePiSessionId,
        threadId: target.threadId ?? null,
        messageJson: JSON.stringify(message),
        requestSummary: summarizePromptForTurn(text),
        position: "front",
      });
    }
    for (const existingSteering of steeringRows.toReversed()) {
      this.structuredSessionStore.markSurfaceMessageQueued({
        id: existingSteering.id,
        position: "front",
      });
    }
  }

  private clearPendingUserMessage(
    session: ManagedSession,
    promptContext: PromptExecutionContext | null,
  ): boolean {
    if (!session.pendingUserMessage) {
      return false;
    }
    if (promptContext && session.pendingUserMessage.turnId !== promptContext.turnId) {
      return false;
    }
    session.pendingUserMessage = null;
    return true;
  }

  private getStructuredSnapshot(sessionId: string): StructuredSessionSnapshot | null {
    try {
      return this.structuredSessionStore.getSessionState(sessionId);
    } catch {
      return null;
    }
  }

  private async getDerivedStructuredSnapshot(
    sessionId: string,
  ): Promise<StructuredSessionSnapshot | null> {
    try {
      return await this.smithersRuntimeManager.getDerivedSessionSnapshot(sessionId);
    } catch {
      return null;
    }
  }

  private async decorateSummaryWithStructuredProjection(
    summary: WorkspaceSessionSummary,
  ): Promise<WorkspaceSessionSummary> {
    const snapshot = await this.getDerivedStructuredSnapshot(summary.id);
    if (!snapshot) {
      return summary;
    }

    const navSummary: WorkspaceSessionSummary = {
      ...summary,
      title: snapshot.pi.title || summary.title,
      isPinned: snapshot.session.pinnedAt !== null,
      pinnedAt: snapshot.session.pinnedAt,
      isArchived: snapshot.session.archivedAt !== null,
      archivedAt: snapshot.session.archivedAt,
      isUnread: snapshot.session.unreadAt !== null,
      unreadAt: snapshot.session.unreadAt,
      unreadReason: snapshot.session.unreadReason,
      lastReadAt: snapshot.session.lastReadAt,
      titleGeneration: {
        status: snapshot.pi.titleGenerationStatus ?? "not-started",
        renameLocked:
          snapshot.pi.titleGenerationStatus === "pending" ||
          snapshot.pi.titleGenerationStatus === "running",
        autoFrozen: snapshot.pi.titleAutoFrozen ?? false,
        manualOverride: snapshot.pi.titleManualOverride ?? false,
        triggeredAt: snapshot.pi.titleGenerationTriggeredAt ?? null,
        finishedAt: snapshot.pi.titleGenerationFinishedAt ?? null,
        error: snapshot.pi.titleGenerationError ?? null,
      },
    };
    const provisionalTitle = this.getProvisionalSessionTitle(snapshot);
    const durableStructuredTitle =
      snapshot.pi.titleManualOverride ||
      snapshot.pi.titleAutoFrozen ||
      snapshot.pi.titleGenerationStatus === "completed"
        ? snapshot.pi.title
        : null;
    const projectedTitle = durableStructuredTitle || provisionalTitle;
    const summaryWithProjectedTitle = projectedTitle
      ? {
          ...navSummary,
          title: projectedTitle,
          preview: navSummary.preview || projectedTitle,
        }
      : navSummary;

    if (!hasStructuredSessionFacts(snapshot)) {
      return summaryWithProjectedTitle;
    }

    const structuredSummary = buildStructuredSessionSummaryProjection(snapshot);
    const view = buildStructuredSessionView(snapshot);

    return {
      ...summaryWithProjectedTitle,
      preview: structuredSummary.preview || summary.preview,
      status: structuredSummary.status,
      updatedAt:
        structuredSummary.updatedAt.localeCompare(summary.updatedAt) > 0
          ? structuredSummary.updatedAt
          : summary.updatedAt,
      wait: projectWorkspaceWait(structuredSummary.wait),
      counts: structuredSummary.counts,
      threadIdsByStatus: view.threadIdsByStatus,
      threadIds: structuredSummary.threadIds,
      sidebarThreads: view.sidebarThreads,
      commandRollups: view.commandRollups.length > 0 ? view.commandRollups : undefined,
    };
  }

  private getProvisionalSessionTitle(snapshot: StructuredSessionSnapshot): string | null {
    if (snapshot.pi.titleManualOverride || snapshot.pi.titleGenerationStatus === "completed") {
      return null;
    }

    const firstTurnSummary = snapshot.turns[0]?.requestSummary?.trim() ?? "";
    const draft = this.structuredSessionStore.getComposerDraft(
      snapshot.session.orchestratorPiSessionId,
    );
    const draftText = draft?.text.trim() ?? "";
    const sourceText = draftText || firstTurnSummary;
    if (!sourceText) {
      return null;
    }

    return summarizePromptForTurn(sourceText, 72);
  }

  private createPromptExecutionContext(
    session: ManagedSession,
    options: SendAgentPromptOptions,
  ): PromptExecutionContext | null {
    const promptText = getLatestUserPromptText(options.messages);
    if (!promptText) {
      return null;
    }

    try {
      const target = options.target;
      const structuredSessionId = target.workspaceSessionId;
      if (structuredSessionId === session.sessionId) {
        this.syncStructuredPiSessionFromOrchestratorSession(session);
      }
      let preTurnSnapshot = this.getStructuredSnapshot(structuredSessionId);
      let targetThread =
        target?.surface === "thread" && target.threadId
          ? (preTurnSnapshot?.threads.find((thread) => thread.id === target.threadId) ?? null)
          : null;
      if (
        preTurnSnapshot &&
        targetThread &&
        shouldResumeThreadUserWaitOnPromptEntry({
          thread: targetThread,
          sessionWait: preTurnSnapshot.session.wait,
        })
      ) {
        const resumedThreadId = targetThread.id;
        this.structuredSessionStore.updateThread({
          threadId: resumedThreadId,
          status: "running-handler",
          wait: null,
        });
        preTurnSnapshot = this.getStructuredSnapshot(structuredSessionId);
        targetThread =
          preTurnSnapshot?.threads.find((thread) => thread.id === resumedThreadId) ?? null;
      }
      const requestSummary = summarizePromptForTurn(promptText);
      const turn = this.structuredSessionStore.startTurn({
        sessionId: structuredSessionId,
        surfacePiSessionId: session.sessionId,
        threadId: target?.surface === "thread" ? (target.threadId ?? null) : null,
        requestSummary,
      });
      const rootThreadId = target?.surface === "thread" && target.threadId ? target.threadId : null;

      return createPromptExecutionContext({
        sessionId: structuredSessionId,
        turnId: turn.id,
        surfacePiSessionId: session.sessionId,
        surfaceThreadId: rootThreadId,
        surfaceKind: target?.surface === "thread" ? "handler" : "orchestrator",
        rootThreadId,
        promptText,
        rootEpisodeKind: inferRootEpisodeKind(promptText),
        threadWasTerminalAtStart: targetThread
          ? isTerminalThreadStatus(targetThread.status)
          : false,
        queuedMessageId: options.queuedMessageId ?? null,
      });
    } catch (error) {
      console.error("Failed to start prompt execution state:", error);
      return null;
    }
  }

  private async getSessionFileForId(
    sessionId: string,
    required = true,
  ): Promise<string | undefined> {
    const managedSurface = this.managedSurfaces.get(sessionId);
    if (managedSurface) {
      return managedSurface.session.sessionManager.getSessionFile();
    }

    for (const sessionDir of [this.sessionDir, this.threadSurfaceDir]) {
      const sessions = await SessionManager.list(this.cwd, sessionDir);
      const match = sessions.find((info) => info.id === sessionId);
      if (match) {
        return match.path;
      }
    }

    if (!required) {
      return undefined;
    }

    throw new Error(`Session ${sessionId} not found.`);
  }

  private async createHandlerThread(input: {
    sessionId: string;
    turnId: string;
    parentThreadId: string | null;
    parentSurfacePiSessionId: string;
    objective: string;
    contextKeys: OptionalPromptContextKey[];
    agentProfileSettings: AgentPromptSettings | null;
    loadedByCommandId: string;
    autoStart?: boolean;
  }) {
    const initialTitle = input.objective.trim();
    const parentSessionFile = await this.getSessionFileForId(input.parentSurfacePiSessionId);
    const threadSessionManager = SessionManager.create(this.cwd, this.threadSurfaceDir);
    threadSessionManager.newSession({
      parentSession: parentSessionFile,
    });
    threadSessionManager.appendSessionInfo(initialTitle);
    persistSessionManagerSnapshot(threadSessionManager);
    const defaultThreadHandler = this.agentSettingsStore.getState().agents.special.threadHandler;
    const threadAgentSettings = input.agentProfileSettings
      ? {
          provider: input.agentProfileSettings.provider,
          model: input.agentProfileSettings.model,
          reasoningEffort: input.agentProfileSettings.reasoningEffort,
          systemPrompt:
            input.agentProfileSettings.systemPrompt.trim() || defaultThreadHandler.systemPrompt,
        }
      : defaultThreadHandler;

    const thread = this.structuredSessionStore.createThread({
      turnId: input.turnId,
      parentThreadId: input.parentThreadId,
      surfacePiSessionId: threadSessionManager.getSessionId(),
      title: initialTitle,
      objective: input.objective,
      agentProfileJson: JSON.stringify(threadAgentSettings),
    });
    for (const key of input.contextKeys) {
      const context = getOptionalPromptContext(key);
      this.structuredSessionStore.loadThreadContext({
        threadId: thread.id,
        contextKey: context.key,
        contextVersion: context.version,
        loadedByCommandId: input.loadedByCommandId,
      });
    }
    if (input.autoStart !== false) {
      this.enqueueInitialHandlerThreadPrompt({ sessionId: input.sessionId, threadId: thread.id });
    }
    this.recoveryCoordinator.enqueue({
      kind: "title_generation",
      ownerScope: { kind: "title_job", titleJobId: `thread:${thread.id}` },
      idempotencyKey: `title_generation:thread:${thread.id}`,
      orderingKey: `thread:${thread.id}`,
      priority: 70,
      payloadJson: { threadId: thread.id },
    });
    this.recoveryCoordinator.wake();
    return this.structuredSessionStore.getThreadDetail(thread.id).thread;
  }

  private async resumeHandlerThread(input: {
    sessionId: string;
    turnId: string;
    threadId: string;
    message: string;
    resumedByCommandId: string;
  }): Promise<{ threadId: string; surfacePiSessionId: string; queuedMessageId: string }> {
    const snapshot = this.getStructuredSnapshot(input.sessionId);
    const thread = snapshot?.threads.find((entry) => entry.id === input.threadId) ?? null;
    if (!snapshot || !thread) {
      throw new Error(`Delegated handler thread not found: ${input.threadId}`);
    }
    if (thread.status !== "completed") {
      throw new Error(`thread_resume can only resume completed handler threads.`);
    }

    this.structuredSessionStore.updateThread({
      threadId: thread.id,
      status: "running-handler",
      wait: null,
    });
    this.structuredSessionStore.recordLifecycleEvent({
      sessionId: input.sessionId,
      kind: "thread_resumed",
      subjectKind: "thread",
      subjectId: thread.id,
      data: {
        resumedByCommandId: input.resumedByCommandId,
        turnId: input.turnId,
      },
    });

    const target: PromptTarget = {
      workspaceSessionId: input.sessionId,
      surface: "thread",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
    };
    const message = createSyntheticUserMessage(input.message);
    const queued = this.structuredSessionStore.enqueueSurfaceMessage({
      sessionId: input.sessionId,
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      idempotencyKey: `thread_resume:${input.resumedByCommandId}`,
      messageJson: JSON.stringify(message),
      requestSummary: summarizePromptForTurn(input.message),
    });
    await this.emitQueuedSurfaceUpdate(target);
    this.wakeSurfaceQueue(target);
    return {
      threadId: thread.id,
      surfacePiSessionId: thread.surfacePiSessionId,
      queuedMessageId: queued.id,
    };
  }

  private async startInitialHandlerThreadPrompt(input: {
    sessionId: string;
    threadId: string;
  }): Promise<void> {
    if (this.closed) {
      return;
    }

    const snapshot = this.getStructuredSnapshot(input.sessionId);
    const thread = snapshot?.threads.find((entry) => entry.id === input.threadId) ?? null;
    if (!snapshot || !thread || thread.status !== "running-handler") {
      return;
    }
    const hasAcceptedInitialTurn = snapshot.turns.some((turn) => turn.threadId === thread.id);
    if (hasAcceptedInitialTurn) {
      return;
    }

    const target: PromptTarget = {
      workspaceSessionId: input.sessionId,
      surface: "thread",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
    };
    this.enqueueInitialHandlerThreadPrompt(input);
    this.wakeSurfaceQueue(target);
  }

  private enqueueInitialHandlerThreadPrompt(input: { sessionId: string; threadId: string }): void {
    const snapshot = this.getStructuredSnapshot(input.sessionId);
    const thread = snapshot?.threads.find((entry) => entry.id === input.threadId) ?? null;
    if (!snapshot || !thread || thread.status !== "running-handler") {
      return;
    }
    if (snapshot.turns.some((turn) => turn.threadId === thread.id)) {
      return;
    }
    this.structuredSessionStore.enqueueSurfaceMessage({
      sessionId: input.sessionId,
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      kind: "initial_handler_start",
      idempotencyKey: `initial_handler_start:${thread.id}`,
      messageJson: "{}",
      payloadJson: JSON.stringify({
        threadId: thread.id,
        requestedAt: new Date().toISOString(),
      } satisfies InitialHandlerStartQueuePayload),
      requestSummary: summarizePromptForTurn(thread.objective),
    });
    this.wakeSurfaceQueue({
      workspaceSessionId: input.sessionId,
      surface: "thread",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
    });
  }

  private startTopLevelTitleGeneration(
    session: ManagedSession,
    promptContext: PromptExecutionContext | null,
  ): void {
    if (!promptContext || promptContext.surfaceKind !== "orchestrator") {
      return;
    }
    const snapshot = this.getStructuredSnapshot(promptContext.sessionId);
    if (!snapshot || snapshot.turns.length !== 1) {
      return;
    }
    const queued = this.structuredSessionStore.queueTitleGeneration(promptContext.sessionId);
    if (!queued) {
      return;
    }
    this.emitTitleGenerationLog({
      level: "info",
      status: "queued",
      sessionId: promptContext.sessionId,
    });
    this.syncPiSessionTitle(session, queued.title);
    void this.emitWorkspaceSync("structured.updated");
    this.recoveryCoordinator.enqueue({
      kind: "title_generation",
      ownerScope: { kind: "title_job", titleJobId: `session:${promptContext.sessionId}` },
      idempotencyKey: `title_generation:session:${promptContext.sessionId}`,
      orderingKey: `surface:${promptContext.surfacePiSessionId}`,
      priority: 70,
      payloadJson: { sessionId: promptContext.sessionId },
    });
    this.recoveryCoordinator.wake();
  }

  private async runQueuedTitleGeneration(sessionId: string): Promise<void> {
    return this.runTitleGenerationJob(sessionId);
  }

  private async runTitleGenerationJob(sessionId: string): Promise<void> {
    if (this.closed) {
      return;
    }
    try {
      const snapshot = this.getStructuredSnapshot(sessionId);
      if (
        !snapshot ||
        (snapshot.pi.titleGenerationStatus !== "pending" &&
          snapshot.pi.titleGenerationStatus !== "running" &&
          snapshot.pi.titleGenerationStatus !== "failed")
      ) {
        return;
      }
      this.structuredSessionStore.markTitleGenerationRunning(sessionId);
      this.emitTitleGenerationLog({ level: "info", status: "started", sessionId });
      if (!this.closed) {
        await this.emitWorkspaceSync("structured.updated");
      }

      const title = await this.generateTitleFromText({
        subjectLabel: `Name ${snapshot.pi.sessionId}`,
        promptLabel: "First user message",
        text: snapshot.turns[0]?.requestSummary?.trim() || "New session",
      });
      if (this.closed) {
        return;
      }
      if (!this.getStructuredSnapshot(sessionId)) {
        return;
      }
      const completed = this.structuredSessionStore.completeTitleGeneration({ sessionId, title });
      const activeOrchestrator = this.managedSurfaces.get(sessionId);
      if (activeOrchestrator) {
        this.syncPiSessionTitle(activeOrchestrator, completed.title);
      } else {
        const sessionFile = await this.getSessionFileForId(sessionId, false);
        if (sessionFile) {
          SessionManager.open(sessionFile, this.sessionDir).appendSessionInfo(completed.title);
        }
      }
      this.emitTitleGenerationLog({
        level: "info",
        status: "completed",
        sessionId,
        title: completed.title,
      });
      if (!this.closed) {
        await this.emitWorkspaceSync("structured.updated");
      }
    } catch (error) {
      if (this.closed) {
        return;
      }
      if (!this.getStructuredSnapshot(sessionId)) {
        return;
      }
      const message = error instanceof Error ? error.message : "Title generation failed.";
      this.structuredSessionStore.failTitleGeneration({
        sessionId,
        error: message,
      });
      this.emitTitleGenerationLog({
        level: "warning",
        status: "failed",
        sessionId,
        error: message,
      });
      if (!this.closed) {
        await this.emitWorkspaceSync("structured.updated");
      }
    }
  }

  private async runThreadTitleGenerationJob(threadId: string): Promise<void> {
    if (this.closed) {
      return;
    }
    const detail = this.structuredSessionStore.getThreadDetail(threadId);
    const title = await this.generateTitleFromText({
      subjectLabel: `Name ${threadId}`,
      promptLabel: "Handler objective",
      text: detail.thread.objective,
    });
    if (this.closed) {
      return;
    }
    const updated = this.structuredSessionStore.updateThread({ threadId, title });
    const activeThreadSurface = this.managedSurfaces.get(updated.surfacePiSessionId);
    if (activeThreadSurface) {
      this.syncPiSessionTitle(activeThreadSurface, updated.title);
    } else {
      const sessionFile = await this.getSessionFileForId(updated.surfacePiSessionId, false);
      if (sessionFile) {
        SessionManager.open(sessionFile, this.threadSurfaceDir).appendSessionInfo(updated.title);
      }
    }
    if (!this.closed) {
      await this.emitWorkspaceSync("structured.updated");
    }
  }

  private async generateTitleFromText(input: {
    subjectLabel: string;
    promptLabel: string;
    text: string;
  }): Promise<string> {
    const state = this.agentSettingsStore.getState();
    const settings = state.agents.titleNamer;
    const sessionManager = SessionManager.create(this.cwd, this.namerSessionDir);
    sessionManager.appendSessionInfo(input.subjectLabel);
    const namer = await createManagedSession({
      sessionManager,
      actorKind: "namer",
      provider: settings.provider,
      model: settings.model,
      thinkingLevel: settings.reasoningEffort,
      systemPrompt: settings.systemPrompt.trim(),
      agentProfileId: "title-namer",
      agentDir: this.agentDir,
      structuredSessionStore: this.structuredSessionStore,
      createHandlerThread: this.createHandlerThread.bind(this),
      resumeHandlerThread: this.resumeHandlerThread.bind(this),
      awaitThreadHandoffAcceptance: this.awaitThreadHandoffAcceptance.bind(this),
      smithersRuntimeManager: this.smithersRuntimeManager,
    });
    try {
      syncAuthStorage(namer.authStorage);
      const prompt = [`${input.promptLabel}:`, input.text.trim() || "New session"].join("\n");
      await namer.session.prompt(prompt, { expandPromptTemplates: false });
      const response = getLatestAssistantMessage(namer.session.agent.state.messages);
      if (response?.stopReason === "error") {
        throw new Error(response.errorMessage || "Namer model failed.");
      }
      const text = extractAssistantText(response).trim();
      const title = normalizeGeneratedTitle(text);
      if (isGenericGeneratedTitle(title)) {
        throw new Error(`Namer returned a generic title: ${title}`);
      }
      return title;
    } finally {
      namer.session.dispose();
      this.managedSurfaces.delete(namer.sessionId);
    }
  }

  private syncPiSessionTitle(session: ManagedSession, title: string): void {
    session.session.sessionManager.appendSessionInfo(title);
    this.persistManagedSessionSnapshot(session);
  }

  private emitTitleGenerationLog(event: TitleGenerationLogEvent): void {
    this.titleGenerationLogListener?.(event);
  }

  private async runAgentPrompt(
    session: ManagedSession,
    options: SendAgentPromptOptions,
    promptContext: PromptExecutionContext | null,
  ): Promise<void> {
    session.promptExecutionRuntime.current = promptContext;
    const toolCommandTracker = promptContext
      ? createToolExecutionCommandTracker({
          store: this.structuredSessionStore,
          promptContext,
        })
      : null;
    const onEvent = options.onEvent ?? (() => {});
    const promptStartMessageCount = session.session.agent.state.messages.length;
    const displayUserMessage = getLatestUserMessage(options.messages);
    let queuedMessageDelivered = false;
    const getQueuedMessageDeliveryText = (queued: StructuredSurfaceQueuedMessageRecord): string => {
      if (queued.kind === "handler_handoff") {
        return this.buildHandlerHandoffQueuedPrompt(queued);
      }
      return this.getQueuedMessageText(queued.messageJson);
    };
    const markSteeringMessageDelivered = (message: Message): boolean => {
      const text = flattenUserMessageContent(message.content).trim();
      if (!text) {
        return false;
      }
      const steering = this.structuredSessionStore
        .listQueuedSurfaceMessages({ surfacePiSessionId: options.target.surfacePiSessionId })
        .find(
          (queued) => queued.status === "steering" && getQueuedMessageDeliveryText(queued) === text,
        );
      if (!steering) {
        return false;
      }
      if (steering.kind === "handler_handoff") {
        this.acceptHandlerHandoffQueueItem(steering);
      }
      this.structuredSessionStore.markSurfaceMessageDelivered({ id: steering.id });
      return true;
    };
    const clearPendingIfUserMessageCommitted = (): boolean => {
      if (!session.pendingUserMessage) {
        return false;
      }
      const turnMessages = session.session.agent.state.messages.slice(promptStartMessageCount);
      if (!turnMessages.some((message) => message.role === "user")) {
        return false;
      }
      if (promptContext?.queuedMessageId && !queuedMessageDelivered) {
        const queued = this.structuredSessionStore.getSurfaceQueuedMessage({
          id: promptContext.queuedMessageId,
        });
        if (queued.kind === "handler_handoff") {
          this.acceptHandlerHandoffQueueItem(queued);
        }
        this.structuredSessionStore.markSurfaceMessageDelivered({
          id: promptContext.queuedMessageId,
        });
        queuedMessageDelivered = true;
      }
      return this.clearPendingUserMessage(session, promptContext);
    };
    const publishPromptEvent = (event: AssistantMessageEvent): void => {
      onEvent(event);
      clearPendingIfUserMessageCommitted();
      if (event.type === "start") {
        session.activeStreamSequence = 0;
        session.activeStreamMessage = structuredClone(event.partial);
        this.emitSurfaceStreamPatch({
          session,
          target: options.target,
          patch: { type: "start", message: event.partial },
        });
      } else if (
        event.type === "text_start" ||
        event.type === "text_delta" ||
        event.type === "text_end" ||
        event.type === "thinking_start" ||
        event.type === "thinking_delta" ||
        event.type === "thinking_end" ||
        event.type === "toolcall_start" ||
        event.type === "toolcall_delta" ||
        event.type === "toolcall_end"
      ) {
        session.activeStreamMessage = structuredClone(event.partial);
        const patch = surfaceStreamPatchFromAssistantEvent(event);
        if (patch) {
          this.emitSurfaceStreamPatch({
            session,
            target: options.target,
            patch,
          });
        }
      } else if (event.type === "done" || event.type === "error") {
        session.activeStreamMessage = null;
        this.emitSurfaceStreamPatch({
          session,
          target: options.target,
          patch: { type: "clear", reason: event.type },
        });
      }
    };
    try {
      const streamState = createVisibleStreamState(options.provider, options.model);
      publishPromptEvent({ type: "start", partial: streamState.partial });
      const unsubscribe = session.session.subscribe((event) => {
        if (event.type === "message_end" && event.message.role === "user") {
          if (displayUserMessage?.role === "user") {
            Object.assign(event.message, structuredClone(displayUserMessage));
          }
          replaceLatestCommittedUserMessage(session, promptStartMessageCount, displayUserMessage);
          const deliveredSteering = markSteeringMessageDelivered(event.message as Message);
          if (clearPendingIfUserMessageCommitted()) {
            void this.emitSurfaceSync({
              session,
              reason: "surface.updated",
              target: options.target,
            });
          }
          if (deliveredSteering) {
            void this.emitSurfaceSync({
              session,
              reason: "surface.updated",
              target: options.target,
            });
          }
          return;
        }

        if (event.type === "message_update") {
          applyVisibleAssistantEvent(streamState, event.assistantMessageEvent, publishPromptEvent);
          return;
        }

        if (event.type === "tool_execution_start") {
          toolCommandTracker?.handleToolExecutionStart({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
          });
          return;
        }

        if (event.type === "tool_execution_end") {
          toolCommandTracker?.handleToolExecutionEnd({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: event.result,
            isError: event.isError,
          });
        }
      });

      try {
        syncAuthStorage(session.authStorage);

        const promptText = promptContext?.promptText ?? getLatestUserPromptText(options.messages);
        if (!promptText) {
          throw new Error("No user message to send.");
        }

        const promptImages = getLatestUserImages(options.messages);
        await session.session.prompt(promptText, {
          expandPromptTemplates: false,
          images: promptImages.length > 0 ? promptImages : undefined,
        });
        replaceLatestCommittedUserMessage(session, promptStartMessageCount, displayUserMessage);
        clearPendingIfUserMessageCommitted();
        finishOpenVisibleBlocks(streamState, publishPromptEvent);

        const emittedMessage =
          getLatestAssistantMessage(
            session.session.agent.state.messages.slice(promptStartMessageCount),
          ) ?? getLatestAssistantMessage(session.session.agent.state.messages);

        if (!emittedMessage) {
          throw new Error("The pi session finished without producing an assistant message.");
        }

        const visibleMessage = finalizeVisibleAssistantMessage(
          streamState,
          emittedMessage,
          options.provider,
          options.model,
        );
        replaceLatestCommittedAssistantMessage(session, promptStartMessageCount, visibleMessage);

        if (visibleMessage.stopReason === "error" || visibleMessage.stopReason === "aborted") {
          publishPromptEvent({
            type: "error",
            reason: visibleMessage.stopReason,
            error: visibleMessage,
          });
        } else {
          publishPromptEvent({
            type: "done",
            reason: visibleMessage.stopReason === "toolUse" ? "stop" : visibleMessage.stopReason,
            message: visibleMessage,
          });
        }

        session.provider = options.provider;
        session.model = options.model;
        session.thinkingLevel = options.thinkingLevel;
        session.recreateOnNextPrompt = false;
        this.completePromptExecution(promptContext, visibleMessage);
      } catch (error) {
        const reason = session.abortRequested ? "aborted" : "error";
        toolCommandTracker?.finishDanglingCommands({
          status: reason === "aborted" ? "cancelled" : "failed",
          error: error instanceof Error ? error.message : "pi prompt failed.",
        });
        finishOpenVisibleBlocks(streamState, publishPromptEvent);
        const failure = finalizeVisibleAssistantMessage(
          streamState,
          createErrorMessage(
            options.provider,
            options.model,
            error instanceof Error ? error.message : "pi prompt failed.",
            reason,
          ),
          options.provider,
          options.model,
        );

        publishPromptEvent({
          type: "error",
          reason,
          error: failure,
        });

        session.provider = options.provider;
        session.model = options.model;
        session.thinkingLevel = options.thinkingLevel;
        this.failPromptExecution(promptContext, failure);
      } finally {
        unsubscribe();
        toolCommandTracker?.finishDanglingCommands({
          status: "cancelled",
          error: "Prompt execution ended before the tool run finished.",
        });
        const suppressQueuedDrain = session.abortRequested;
        session.lastPromptSuppressedQueueDrain = suppressQueuedDrain;
        session.lastPromptRestoredQueueItem = false;
        session.abortRequested = false;
        session.activePrompt = false;
        session.activePromptDone = null;
        session.pendingUserMessage = null;
        session.activeStreamMessage = null;
        if (options.queuedMessageId) {
          const latestQueued = this.structuredSessionStore.getSurfaceQueuedMessage({
            id: options.queuedMessageId,
          });
          if (latestQueued.status === "dispatching") {
            if (suppressQueuedDrain) {
              this.structuredSessionStore.cancelSurfaceMessage({ id: options.queuedMessageId });
            } else {
              this.structuredSessionStore.markSurfaceMessageQueued({
                id: options.queuedMessageId,
                position: "front",
              });
              session.lastPromptRestoredQueueItem = true;
            }
          }
        }
        this.syncManagedState(session);
        if (options.target.surface === "orchestrator") {
          this.syncStructuredPiSessionFromOrchestratorSession(session);
        }
        await this.emitSurfaceSync({
          session,
          reason: "prompt.settled",
          target: options.target,
        });
        await this.emitWorkspaceSync("workspace.updated");
        if (
          promptContext?.surfaceKind === "handler" &&
          !promptContext.suppressPendingWorkflowAttentionDelivery &&
          this.shouldDeliverPendingHandlerAttention(promptContext)
        ) {
          await this.smithersRuntimeManager.deliverPendingHandlerAttention(
            promptContext.sessionId,
            promptContext.rootThreadId ?? undefined,
          );
        }
        if (!suppressQueuedDrain) {
          this.wakeSurfaceQueue(options.target);
        }
        await this.disposeManagedSurfaceIfUnused(session);
      }
    } finally {
      session.promptExecutionRuntime.current = null;
    }
  }

  private shouldDeliverPendingHandlerAttention(promptContext: PromptExecutionContext): boolean {
    if (!promptContext.rootThreadId) {
      return false;
    }

    if (this.closed) {
      return false;
    }

    try {
      const snapshot = this.structuredSessionStore.getSessionState(promptContext.sessionId);
      const turn = snapshot.turns.find((entry) => entry.id === promptContext.turnId) ?? null;
      if (turn?.turnDecision === "thread_handoff") {
        return false;
      }

      const thread =
        snapshot.threads.find((entry) => entry.id === promptContext.rootThreadId) ?? null;
      return thread?.status !== "completed";
    } catch {
      return false;
    }
  }

  private wakeSurfaceQueue(target: PromptTarget): void {
    if (this.closed) {
      return;
    }
    this.recoveryCoordinator.enqueue({
      kind: "queue_drain",
      ownerScope: {
        kind: "surface",
        workspaceSessionId: target.workspaceSessionId,
        surfacePiSessionId: target.surfacePiSessionId,
      },
      idempotencyKey: `queue_drain:${target.surfacePiSessionId}`,
      orderingKey: `surface:${target.surfacePiSessionId}`,
      priority: 30,
    });
    this.recoveryCoordinator.wake();
  }

  private async runSurfaceQueue(target: PromptTarget): Promise<void> {
    while (!this.closed) {
      const dispatched = await this.drainNextQueuedSurfacePrompt(target, {
        awaitPrompt: true,
      });
      if (!dispatched) {
        return;
      }
    }
  }

  private async drainNextQueuedSurfacePrompt(
    target: PromptTarget,
    options: { awaitPrompt: boolean },
  ): Promise<boolean> {
    if (this.closed) {
      return false;
    }

    const currentTarget = this.resolvePromptTargetForSurfacePiSessionId(target.surfacePiSessionId);
    const session = await this.retainManagedSurface(currentTarget);
    if (session.activePrompt) {
      const activePromptDone = session.activePromptDone;
      if (options.awaitPrompt && activePromptDone) {
        await activePromptDone.catch((error) => {
          console.error("Failed while waiting for the active surface prompt:", error);
        });
        const shouldContinueDrain =
          !session.lastPromptSuppressedQueueDrain && !session.lastPromptRestoredQueueItem;
        await this.releaseManagedSurface(currentTarget.surfacePiSessionId);
        return shouldContinueDrain;
      }
      await this.releaseManagedSurface(currentTarget.surfacePiSessionId);
      return false;
    }

    const queued = this.structuredSessionStore.claimNextQueuedSurfaceMessage({
      surfacePiSessionId: currentTarget.surfacePiSessionId,
    });
    if (!queued) {
      await this.releaseManagedSurface(currentTarget.surfacePiSessionId);
      return false;
    }

    if (queued.kind === "prompt_refresh") {
      try {
        const refreshed = await this.refreshManagedSurfacePromptBinding(session, currentTarget);
        this.structuredSessionStore.markSurfaceMessageDelivered({ id: queued.id });
        await this.emitSurfaceSync({
          session: refreshed,
          reason: "surface.updated",
          target: currentTarget,
        });
        await this.emitWorkspaceSync("structured.updated");
        return true;
      } catch (error) {
        this.structuredSessionStore.markSurfaceMessageQueued({
          id: queued.id,
          position: "front",
        });
        await this.emitQueuedSurfaceUpdate(currentTarget);
        throw error;
      } finally {
        await this.releaseManagedSurface(currentTarget.surfacePiSessionId);
      }
    }

    let message: Message;
    if (queued.kind === "handler_handoff") {
      try {
        const prompt = this.buildHandlerHandoffQueuedPrompt(queued);
        message = createSyntheticUserMessage(prompt);
      } catch (error) {
        this.structuredSessionStore.cancelSurfaceMessage({ id: queued.id });
        await this.releaseManagedSurface(currentTarget.surfacePiSessionId);
        throw error;
      }
    } else if (queued.kind === "initial_handler_start") {
      try {
        const snapshot = this.getStructuredSnapshot(currentTarget.workspaceSessionId);
        if (queued.threadId && snapshot?.turns.some((turn) => turn.threadId === queued.threadId)) {
          this.structuredSessionStore.markSurfaceMessageDelivered({ id: queued.id });
          await this.releaseManagedSurface(currentTarget.surfacePiSessionId);
          return true;
        }
        message = createSyntheticUserMessage(this.buildInitialHandlerQueuedPrompt(queued));
      } catch (error) {
        this.structuredSessionStore.cancelSurfaceMessage({ id: queued.id });
        await this.releaseManagedSurface(currentTarget.surfacePiSessionId);
        throw error;
      }
    } else if (queued.kind === "workflow_attention") {
      try {
        const payload = this.parseWorkflowAttentionQueuePayload(queued);
        const snapshot = payload ? this.getStructuredSnapshot(payload.sessionId) : null;
        const thread = snapshot?.threads.find((entry) => entry.id === payload?.threadId) ?? null;
        if (!thread || thread.status === "completed") {
          this.structuredSessionStore.markSurfaceMessageDelivered({ id: queued.id });
          await this.releaseManagedSurface(currentTarget.surfacePiSessionId);
          return true;
        }
        message = createSyntheticUserMessage(this.buildWorkflowAttentionQueuedPrompt(queued));
      } catch (error) {
        this.structuredSessionStore.cancelSurfaceMessage({ id: queued.id });
        await this.releaseManagedSurface(currentTarget.surfacePiSessionId);
        throw error;
      }
    } else {
      try {
        message = JSON.parse(queued.messageJson) as Message;
      } catch {
        this.structuredSessionStore.cancelSurfaceMessage({ id: queued.id });
        await this.releaseManagedSurface(currentTarget.surfacePiSessionId);
        throw new Error(`Queued surface message ${queued.id} could not be parsed.`);
      }
    }

    let promptDone: Promise<void>;
    try {
      session.abortRequested = false;
      session.lastPromptSuppressedQueueDrain = false;
      session.lastPromptRestoredQueueItem = false;
      session.activePrompt = true;
      session.activeStreamSequence = 0;
      session.activeStreamMessage = null;

      const promptOptions: SendAgentPromptOptions = {
        target: currentTarget,
        provider: session.provider,
        model: session.model,
        thinkingLevel: session.thinkingLevel,
        messages: [...convertToLlmMessages(session.session.agent.state.messages), message],
        queuedMessageId: queued.id,
      };
      const promptExecution = this.createPromptExecutionContext(session, promptOptions);
      if (queued.kind === "workflow_attention" && promptExecution) {
        promptExecution.suppressPendingWorkflowAttentionDelivery = true;
      }
      this.setPendingUserMessage(session, promptExecution, message);
      if (currentTarget.surface === "orchestrator") {
        this.startTopLevelTitleGeneration(session, promptExecution);
      }
      await this.emitSurfaceSync({
        session,
        reason: "background.started",
        target: currentTarget,
      });
      await this.emitWorkspaceSync("workspace.updated");

      promptDone = this.runAgentPrompt(session, promptOptions, promptExecution).finally(
        async () => {
          await this.releaseManagedSurface(currentTarget.surfacePiSessionId);
        },
      );
      session.activePromptDone = promptDone;
    } catch (error) {
      session.activePrompt = false;
      session.pendingUserMessage = null;
      session.activeStreamMessage = null;
      this.structuredSessionStore.markSurfaceMessageQueued({
        id: queued.id,
        position: "front",
      });
      await this.emitQueuedSurfaceUpdate(currentTarget);
      await this.releaseManagedSurface(currentTarget.surfacePiSessionId);
      throw error;
    }

    if (options.awaitPrompt) {
      await promptDone;
      return !session.lastPromptSuppressedQueueDrain && !session.lastPromptRestoredQueueItem;
    }
    return true;
  }

  private async resumeHandlerAfterWorkflowAttention(input: {
    sessionId: string;
    threadId: string;
    workflowRunId: string;
    smithersRunId: string;
    workflowId: string;
    summary: string;
    reason: string;
  }): Promise<boolean> {
    return this.enqueueWorkflowAttentionPrompt(input);
  }

  private enqueueWorkflowAttentionPrompt(input: {
    sessionId: string;
    threadId: string;
    workflowRunId: string;
    smithersRunId: string;
    workflowId: string;
    summary: string;
    reason: string;
  }): boolean {
    const snapshot = this.getStructuredSnapshot(input.sessionId);
    const thread = snapshot?.threads.find((entry) => entry.id === input.threadId) ?? null;
    if (!snapshot || !thread || thread.status === "completed") {
      return false;
    }

    const target: PromptTarget = {
      workspaceSessionId: input.sessionId,
      surface: "thread",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
    };
    this.structuredSessionStore.enqueueSurfaceMessage({
      sessionId: input.sessionId,
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      kind: "workflow_attention",
      idempotencyKey: `workflow_attention:${input.workflowRunId}:${input.reason}`,
      messageJson: "{}",
      payloadJson: JSON.stringify(input satisfies WorkflowAttentionQueuePayload),
      requestSummary: input.summary,
    });
    void this.emitQueuedSurfaceUpdate(target);
    this.wakeSurfaceQueue(target);
    return true;
  }

  private completePromptExecution(
    promptContext: PromptExecutionContext | null,
    message: AssistantMessage,
  ): void {
    if (!promptContext) {
      return;
    }

    try {
      const snapshot = this.structuredSessionStore.getSessionState(promptContext.sessionId);
      const assistantText = messageToPlainText(message).trim();
      const turn = snapshot.turns.find((entry) => entry.id === promptContext.turnId);
      if (!turn) {
        return;
      }

      if (promptContext.sessionWaitApplied) {
        const wait = getEffectiveTurnWait(snapshot, promptContext.rootThreadId);
        this.persistPendingTurnDecision({
          promptContext,
          turnDecision: turn.turnDecision,
          assistantText,
          wait,
        });
        this.structuredSessionStore.finishTurn({
          turnId: promptContext.turnId,
          status: "waiting",
        });
        if (this.focusedSurfacePiSessionId !== promptContext.surfacePiSessionId) {
          this.structuredSessionStore.markSessionUnread({
            sessionId: promptContext.sessionId,
            reason: "assistant-turn-finished",
          });
        }
        return;
      }

      this.persistPendingTurnDecision({
        promptContext,
        turnDecision: turn.turnDecision,
        assistantText,
      });

      this.structuredSessionStore.finishTurn({
        turnId: promptContext.turnId,
        status: "completed",
      });
      this.settleHandlerThreadAfterPrompt(promptContext);
      if (this.focusedSurfacePiSessionId !== promptContext.surfacePiSessionId) {
        this.structuredSessionStore.markSessionUnread({
          sessionId: promptContext.sessionId,
          reason: "assistant-turn-finished",
        });
      }
    } catch (error) {
      if (!this.closed) {
        console.error("Failed to finalize prompt execution:", error);
      }
    }
  }

  private settleHandlerThreadAfterPrompt(promptContext: PromptExecutionContext): void {
    if (promptContext.surfaceKind !== "handler" || !promptContext.rootThreadId) {
      return;
    }

    const snapshot = this.structuredSessionStore.getSessionState(promptContext.sessionId);
    const thread =
      snapshot.threads.find((entry) => entry.id === promptContext.rootThreadId) ?? null;
    if (!thread || thread.status !== "running-handler" || thread.wait) {
      return;
    }

    const turn = snapshot.turns.find((entry) => entry.id === promptContext.turnId) ?? null;
    if (!turn || turn.turnDecision === "thread_handoff" || turn.status !== "completed") {
      return;
    }

    const hasActiveWorkflow = snapshot.workflowRuns.some(
      (workflowRun) =>
        workflowRun.threadId === thread.id &&
        (workflowRun.status === "running" || workflowRun.status === "waiting"),
    );
    if (hasActiveWorkflow) {
      return;
    }

    this.structuredSessionStore.updateThread({
      threadId: thread.id,
      status: "idle",
    });
  }

  private failPromptExecution(
    promptContext: PromptExecutionContext | null,
    _message: AssistantMessage,
  ): void {
    if (!promptContext) {
      return;
    }

    try {
      const snapshot = this.structuredSessionStore.getSessionState(promptContext.sessionId);
      const rootThread = promptContext.rootThreadId
        ? (snapshot.threads.find((thread) => thread.id === promptContext.rootThreadId) ?? null)
        : null;
      if (
        rootThread &&
        (rootThread.status === "running-handler" || rootThread.status === "running-workflow")
      ) {
        this.structuredSessionStore.updateThread({
          threadId: rootThread.id,
          status: "troubleshooting",
        });
      }
      const turn = snapshot.turns.find((entry) => entry.id === promptContext.turnId);
      if (turn) {
        this.persistPendingTurnDecision({
          promptContext,
          turnDecision: turn.turnDecision,
          assistantText: "",
        });
      }
      this.structuredSessionStore.finishTurn({
        turnId: promptContext.turnId,
        status: "failed",
      });
    } catch (error) {
      if (!this.closed) {
        console.error("Failed to mark prompt execution failure:", error);
      }
    }
  }

  private persistPendingTurnDecision(input: {
    promptContext: PromptExecutionContext;
    turnDecision: StructuredSessionSnapshot["turns"][number]["turnDecision"];
    assistantText: string;
    wait?: StructuredWaitState | null;
  }): void {
    if (input.turnDecision !== "pending") {
      return;
    }

    this.structuredSessionStore.setTurnDecision({
      turnId: input.promptContext.turnId,
      decision: inferPendingTurnDecision(input),
      onlyIfPending: true,
    });
  }

  private syncManagedState(session: ManagedSession): void {
    const restoredDefaults = resolveRestoredSessionDefaults(session.session.sessionManager, {
      provider: session.provider,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
    });
    const activeModel =
      session.session.agent.state.model ??
      resolveRegisteredModel(
        session.modelRegistry,
        restoredDefaults.provider,
        restoredDefaults.model,
      );

    session.provider = activeModel?.provider ?? restoredDefaults.provider;
    session.model = activeModel?.id ?? restoredDefaults.model;
    session.thinkingLevel = restoredDefaults.thinkingLevel;
  }

  private persistManagedSessionSnapshot(session: ManagedSession): void {
    persistSessionManagerSnapshot(session.session.sessionManager);
  }
}

async function createManagedSession(
  options: CreateManagedSessionOptions & {
    agentDir: string;
    structuredSessionStore: StructuredSessionStateStore;
    createHandlerThread: WorkspaceSessionCatalog["createHandlerThread"];
    resumeHandlerThread: WorkspaceSessionCatalog["resumeHandlerThread"];
    awaitThreadHandoffAcceptance: WorkspaceSessionCatalog["awaitThreadHandoffAcceptance"];
    smithersRuntimeManager: SmithersRuntimeManager;
  },
): Promise<ManagedSession> {
  mkdirSync(options.agentDir, { recursive: true });

  const authStorage = AuthStorage.inMemory();
  syncAuthStorage(authStorage);
  let sessionForListTools: AgentSession | null = null;
  const promptExecutionRuntime: PromptExecutionRuntimeHandle = {
    current: null,
  };
  const webProvider = createWebProvider(
    {
      provider: createAgentSettingsStore({
        cwd: options.sessionManager.getCwd(),
        agentDir: options.agentDir,
      }).getState().appPreferences.webProvider,
    },
    {
      tinyfishApiKey: resolveApiKey("tinyfish"),
      firecrawlApiKey: resolveApiKey("firecrawl"),
    },
  );
  const executeTypescriptTool = createExecuteTypescriptTool({
    cwd: options.sessionManager.getCwd(),
    runtime: promptExecutionRuntime,
    store: options.structuredSessionStore,
    webProvider,
  });
  const directTools = createSvvyDirectTools({
    cwd: options.sessionManager.getCwd(),
    runtime: promptExecutionRuntime,
    store: options.structuredSessionStore,
    workflowLibrary: createWorkflowLibrary(options.sessionManager.getCwd()),
    webProvider,
  });
  const listUnresolvedWorkflowRuns = (input: { sessionId: string; threadId: string }) =>
    options.smithersRuntimeManager.listUnresolvedWorkflowRunsForThread(input);
  const threadListTool = createThreadListTool({
    runtime: promptExecutionRuntime,
    store: options.structuredSessionStore,
    listUnresolvedWorkflowRuns,
  });
  const threadHandoffsTool = createThreadHandoffsTool({
    runtime: promptExecutionRuntime,
    store: options.structuredSessionStore,
  });
  const threadCurrentTool = createThreadCurrentTool({
    runtime: promptExecutionRuntime,
    store: options.structuredSessionStore,
    listUnresolvedWorkflowRuns,
  });
  const sharedWorkTools = [
    createListToolsTool({
      getSession: () => sessionForListTools,
    }),
    threadListTool,
    threadHandoffsTool,
    ...createCxTools({ cwd: options.sessionManager.getCwd() }),
    ...directTools.codingTools,
    ...directTools.artifactTools,
    ...directTools.webTools,
    executeTypescriptTool,
  ] as const;
  const waitTool = createWaitTool({
    runtime: promptExecutionRuntime,
    store: options.structuredSessionStore,
  });
  const threadHandoffTool = createThreadHandoffTool({
    runtime: promptExecutionRuntime,
    store: options.structuredSessionStore,
    listUnresolvedWorkflowRuns,
    awaitHandoffAcceptance: options.awaitThreadHandoffAcceptance,
  });
  const requestContextTool = createRequestContextTool({
    runtime: promptExecutionRuntime,
    store: options.structuredSessionStore,
    onContextLoaded: ({ surfacePiSessionId }) => {
      options.onRequestContextLoaded?.(surfacePiSessionId);
    },
  });
  const buildHandlerTools = () =>
    [
      ...sharedWorkTools,
      ...directTools.workflowTools,
      threadCurrentTool,
      requestContextTool,
      threadHandoffTool,
      ...createSmithersTools({
        runtime: promptExecutionRuntime,
        store: options.structuredSessionStore,
        manager: options.smithersRuntimeManager,
      }),
      waitTool,
    ] as const;
  const tools =
    options.actorKind === "namer"
      ? ([] as const)
      : options.actorKind === "orchestrator"
        ? ([
            ...sharedWorkTools,
            createStartThreadTool({
              runtime: promptExecutionRuntime,
              store: options.structuredSessionStore,
              bridge: {
                createHandlerThread: options.createHandlerThread,
              },
            }),
            createResumeThreadTool({
              runtime: promptExecutionRuntime,
              store: options.structuredSessionStore,
              bridge: {
                resumeHandlerThread: options.resumeHandlerThread,
              },
            }),
            waitTool,
          ] as const)
        : buildHandlerTools();
  const customTools = createCustomToolDefinitions(tools);
  const modelRegistryFactory = ModelRegistry as unknown as {
    create?: (authStorage: AuthStorage, modelPath: string) => ModelRegistry;
    new (authStorage: AuthStorage, modelPath: string): ModelRegistry;
  };
  const modelRegistryPath = join(options.agentDir, "models.json");
  const modelRegistry =
    typeof modelRegistryFactory.create === "function"
      ? modelRegistryFactory.create(authStorage, modelRegistryPath)
      : new modelRegistryFactory(authStorage, modelRegistryPath);
  const settingsManager = SettingsManager.create(options.sessionManager.getCwd(), options.agentDir);
  const resourceLoader = new DefaultResourceLoader({
    cwd: options.sessionManager.getCwd(),
    agentDir: options.agentDir,
    settingsManager,
    systemPromptOverride: () => options.systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await resourceLoader.reload();
  const externalContextSources = buildExternalContextSources(resourceLoader);
  const restoredDefaults = resolveRestoredSessionDefaults(options.sessionManager, {
    provider: options.provider,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
  });
  const resolvedModel = resolveRegisteredModel(
    modelRegistry,
    restoredDefaults.provider,
    restoredDefaults.model,
  );
  if (!resolvedModel) {
    throw new Error(`Model not found: ${restoredDefaults.provider}/${restoredDefaults.model}`);
  }

  const { session } = await createAgentSession({
    cwd: options.sessionManager.getCwd(),
    agentDir: options.agentDir,
    authStorage,
    modelRegistry,
    sessionManager: options.sessionManager,
    settingsManager,
    model: resolvedModel,
    thinkingLevel: restoredDefaults.thinkingLevel,
    noTools: "builtin",
    customTools,
    resourceLoader,
  });
  sessionForListTools = session;
  const activeModel = session.agent.state.model ?? resolvedModel;

  const managedSession: ManagedSession = {
    sessionId: session.sessionManager.getSessionId(),
    actorKind: options.actorKind,
    provider: activeModel.provider,
    model: activeModel.id,
    thinkingLevel: restoredDefaults.thinkingLevel,
    agentProfileId: options.agentProfileId ?? DEFAULT_ORCHESTRATOR_PROFILE_ID,
    systemPrompt: options.systemPrompt,
    promptLibraryRevision: options.promptLibraryRevision ?? 1,
    externalContextSources,
    session,
    authStorage,
    modelRegistry,
    activePrompt: false,
    activePromptDone: null,
    pendingUserMessage: null,
    activeStreamMessage: null,
    activeStreamSequence: 0,
    recreateOnNextPrompt: false,
    abortRequested: false,
    lastPromptSuppressedQueueDrain: false,
    lastPromptRestoredQueueItem: false,
    retainCount: 0,
    promptExecutionRuntime,
  };

  return managedSession;
}

function createCustomToolDefinitions(tools: readonly AgentTool<any>[]): ToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    prepareArguments: tool.prepareArguments,
    execute: async (toolCallId, params, signal, onUpdate) =>
      await tool.execute(toolCallId, params, signal, onUpdate),
  }));
}

function buildOrchestratorProfileSystemPrompt(
  settings: { systemPrompt: string },
  promptLibraryState: PromptLibraryState,
  workspaceKey: string,
  webProvider?: ReturnType<typeof createWebProvider>,
): string {
  const suffix = settings.systemPrompt.trim();
  if (!suffix || suffix === DEFAULT_ORCHESTRATOR_SESSION_PROMPT) {
    return buildSystemPrompt("orchestrator", { promptLibraryState, workspaceKey, webProvider });
  }
  return `${buildSystemPrompt("orchestrator", {
    promptLibraryState,
    workspaceKey,
    webProvider,
  })}\n\n## Orchestrator Profile\n${suffix}`;
}

function countVisibleMessages(messages: AgentMessage[]): number {
  return messages.filter(
    (message) =>
      message.role === "user" || message.role === "assistant" || message.role === "toolResult",
  ).length;
}

function convertToLlmMessages(messages: AgentMessage[]): Message[] {
  return messages.filter((message): message is Message => {
    return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
  });
}

function getResolvedSystemPrompt(session: ManagedSession): string {
  const resolved = session.session.agent.state.systemPrompt?.trim();
  return resolved && resolved.length > 0 ? resolved : session.systemPrompt;
}

function buildExternalContextSources(input: {
  getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
}): PromptLibraryExternalSource[] {
  return input.getAgentsFiles().agentsFiles.map((source, index) => {
    const normalizedPath = source.path.replaceAll("\\", "/");
    const fileName = normalizedPath.split("/").at(-1);
    const kind = fileName === "CLAUDE.md" ? "CLAUDE.md" : "AGENTS.md";
    return {
      id: `${index}:${normalizedPath}`,
      kind,
      title: kind,
      path: source.path,
      content: source.content,
      contentHash: hashContent(source.content),
      order: index,
    };
  });
}

function externalSourceHashes(sources: readonly PromptLibraryExternalSource[]): string[] {
  return sources.map((source) => `${source.path}:${source.contentHash}`);
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function flattenUserMessageContent(content: Message["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "image") {
        return "[image]";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function createSyntheticUserMessage(text: string): Message {
  return {
    role: "user",
    timestamp: Date.now(),
    content: [{ type: "text", text }],
  };
}

function getLatestUserPromptText(messages: readonly Message[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") {
      continue;
    }

    const text = flattenUserMessageContent(message.content).trim();
    if (text) {
      return text;
    }
  }

  return null;
}

function getLatestUserImages(messages: readonly Message[]): ImageContent[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user" || typeof message.content === "string") {
      continue;
    }
    return message.content.filter((block): block is ImageContent => block.type === "image");
  }
  return [];
}

function replaceLatestCommittedUserMessage(
  session: ManagedSession,
  promptStartMessageCount: number,
  displayUserMessage: Message | null,
): void {
  if (!displayUserMessage || displayUserMessage.role !== "user") return;
  const messages = session.session.agent.state.messages;
  for (let index = messages.length - 1; index >= promptStartMessageCount; index -= 1) {
    if (messages[index]?.role !== "user") continue;
    messages[index] = structuredClone(displayUserMessage) as AgentMessage;
    return;
  }
}

function replaceLatestCommittedAssistantMessage(
  session: ManagedSession,
  promptStartMessageCount: number,
  visibleMessage: AssistantMessage,
): void {
  const messages = session.session.agent.state.messages;
  for (let index = messages.length - 1; index >= promptStartMessageCount; index -= 1) {
    if (messages[index]?.role !== "assistant") continue;
    messages[index] = structuredClone(visibleMessage) as AgentMessage;
    return;
  }
}

function isTerminalThreadStatus(
  status: StructuredSessionSnapshot["threads"][number]["status"],
): boolean {
  return status === "completed";
}

function summarizePromptForTurn(text: string, limit = 96): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "New turn";
  }

  if (collapsed.length <= limit) {
    return collapsed;
  }

  return `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

function inferRootEpisodeKind(promptText: string): PromptExecutionContext["rootEpisodeKind"] {
  return /\b(explain|summari[sz]e|review|audit|analy[sz]e|why|what)\b/i.test(promptText)
    ? "analysis"
    : "change";
}

function buildOrchestratorHandoffResumePrompt(
  _thread: StructuredSessionSnapshot["threads"][number] | null,
  summary: string,
): string {
  return [
    "System event: A handler thread emitted a durable handoff.",
    `Handoff summary: ${summary}`,
    "Use thread_list and thread_handoffs if durable delegated-thread state matters, then decide the next orchestrator action.",
  ].join("\n");
}

function buildHandlerWorkflowAttentionPrompt(_input: {
  thread: StructuredSessionSnapshot["threads"][number];
  workflowRun: StructuredSessionSnapshot["workflowRuns"][number] | null;
  reason: string;
  summary: string;
  workflowId: string;
  smithersRunId: string;
}): string {
  return [
    "System event: A supervised Smithers workflow now requires handler attention.",
    "Use thread_current for current handler state and active workflow run ids, then inspect workflow details with smithers_* tools and decide the next handler action.",
  ].join("\n");
}

function buildInitialHandlerThreadPrompt(
  thread: StructuredSessionSnapshot["threads"][number],
): string {
  return thread.objective.trim();
}

function projectWorkspaceWait(
  wait: StructuredSessionSnapshot["session"]["wait"],
): WorkspaceSessionSummary["wait"] {
  if (!wait || wait.owner.kind !== "orchestrator") {
    return null;
  }

  return {
    kind: wait.kind,
    reason: wait.reason,
    resumeWhen: wait.resumeWhen,
    since: wait.since,
  };
}

function getThreadOwnedWaitId(wait: StructuredSessionSnapshot["session"]["wait"]): string | null {
  if (!wait || wait.owner.kind !== "thread") {
    return null;
  }

  return wait.owner.threadId;
}

function getEffectiveTurnWait(
  snapshot: StructuredSessionSnapshot,
  threadId: string | null,
): StructuredWaitState | null {
  if (!threadId) {
    return null;
  }
  const thread = snapshot.threads.find((entry) => entry.id === threadId) ?? null;
  if (!thread) {
    return null;
  }

  if (getThreadOwnedWaitId(snapshot.session.wait) === threadId) {
    return (
      thread.wait ?? {
        owner: "handler",
        kind: snapshot.session.wait!.kind,
        reason: snapshot.session.wait!.reason,
        resumeWhen: snapshot.session.wait!.resumeWhen,
        since: snapshot.session.wait!.since,
      }
    );
  }

  return thread.wait;
}

function inferPendingTurnDecision(input: {
  assistantText: string;
  wait?: StructuredWaitState | null;
}): Exclude<StructuredSessionSnapshot["turns"][number]["turnDecision"], "pending"> {
  if (input.wait) {
    return "wait";
  }

  if (looksLikeClarificationReply(input.assistantText)) {
    return "clarify";
  }

  return "reply";
}

function looksLikeClarificationReply(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || !normalized.includes("?")) {
    return false;
  }

  return /\b(clarify|confirm|which|what|where|when|who|need|missing|provide|share|answer)\b/i.test(
    normalized,
  );
}

function shouldResumeThreadUserWaitOnPromptEntry(input: {
  thread: StructuredSessionSnapshot["threads"][number];
  sessionWait: StructuredSessionSnapshot["session"]["wait"];
}): boolean {
  if (input.thread.wait?.kind === "user") {
    return true;
  }

  return (
    getThreadOwnedWaitId(input.sessionWait) === input.thread.id &&
    input.sessionWait?.kind === "user"
  );
}

function getActorKindForTarget(target: PromptTarget): SvvyActorKind {
  return target.surface === "thread" ? "handler" : "orchestrator";
}

function syncAuthStorage(authStorage: AuthStorage): void {
  for (const provider of getProviders()) {
    const apiKey = resolveApiKey(provider);
    if (apiKey) {
      authStorage.setRuntimeApiKey(provider, apiKey);
    } else {
      authStorage.removeRuntimeApiKey(provider);
    }
  }
}

export function resolveRestoredSessionDefaults(
  sessionManager: SessionManager,
  overrides: {
    provider?: string;
    model?: string;
    thinkingLevel?: ThinkingLevel;
  },
): {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
} {
  const metadata = readRestoredSessionMetadata(sessionManager);

  return {
    provider: overrides.provider ?? metadata.provider ?? DEFAULT_AGENT_SETTINGS.provider,
    model: overrides.model ?? metadata.model ?? DEFAULT_AGENT_SETTINGS.model,
    thinkingLevel:
      overrides.thinkingLevel ?? metadata.thinkingLevel ?? DEFAULT_AGENT_SETTINGS.reasoningEffort,
  };
}

function readRestoredSessionMetadata(sessionManager: SessionManager): {
  provider?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
} {
  let provider: string | undefined;
  let model: string | undefined;
  let thinkingLevel: ThinkingLevel | undefined;

  for (const entry of sessionManager.getBranch()) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel as ThinkingLevel;
      continue;
    }

    if (entry.type === "model_change") {
      provider = entry.provider;
      model = entry.modelId;
      continue;
    }

    if (entry.type === "message" && entry.message.role === "assistant") {
      provider = entry.message.provider;
      model = entry.message.model;
    }
  }

  return { provider, model, thinkingLevel };
}

function createBranchedSessionManager(
  sourceSessionFile: string,
  sessionDir: string,
  messageTimestamp: string | number,
): SessionManager {
  const sourceSessionManager = SessionManager.open(sourceSessionFile, sessionDir);
  const targetTimestamp = String(messageTimestamp);
  const branchEntry = sourceSessionManager.getBranch().find((entry) => {
    return (
      entry.type === "message" &&
      entry.message.role === "assistant" &&
      String(entry.message.timestamp) === targetTimestamp
    );
  });

  if (!branchEntry) {
    throw new Error("Unable to fork: assistant message was not found in the session branch.");
  }

  const branchedSessionFile = sourceSessionManager.createBranchedSession(branchEntry.id);
  if (!branchedSessionFile) {
    throw new Error("Unable to fork: branched session file was not created.");
  }

  return sourceSessionManager;
}

function resolveRegisteredModel(modelRegistry: ModelRegistry, provider: string, model: string) {
  return (
    modelRegistry.find(provider, model) ??
    getModel(provider as Parameters<typeof getModel>[0], model as Parameters<typeof getModel>[1])
  );
}

export function getSvvyDataDir(): string {
  return process.platform === "win32"
    ? join(process.env.APPDATA ?? homedir(), "svvy")
    : join(homedir(), ".config", "svvy");
}

export function getSvvyAgentDir(): string {
  return join(getSvvyDataDir(), "pi");
}

export function getSvvySessionDir(cwd: string, agentDir = getSvvyAgentDir()): string {
  return join(agentDir, "sessions", `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
}

function createVisibleStreamState(provider: string, model: string): VisibleStreamState {
  return {
    partial: createPartialAssistantMessage(provider, model),
    activeTextIndex: null,
    activeThinkingIndex: null,
  };
}

function applyVisibleAssistantEvent(
  streamState: VisibleStreamState,
  event: AssistantMessageEvent,
  onEvent: (event: AssistantMessageEvent) => void,
): void {
  switch (event.type) {
    case "text_start": {
      streamState.activeTextIndex = streamState.partial.content.length;
      streamState.partial.content.push({ type: "text", text: "" });
      onEvent({
        type: "text_start",
        contentIndex: streamState.activeTextIndex,
        partial: streamState.partial,
      });
      return;
    }

    case "text_delta": {
      if (streamState.activeTextIndex === null) {
        applyVisibleAssistantEvent(
          streamState,
          { type: "text_start", contentIndex: 0, partial: event.partial },
          onEvent,
        );
      }

      const contentIndex = streamState.activeTextIndex;
      if (contentIndex === null) return;

      const block = streamState.partial.content[contentIndex];
      if (!block || block.type !== "text") return;

      block.text += event.delta;
      onEvent({
        type: "text_delta",
        contentIndex,
        delta: event.delta,
        partial: streamState.partial,
      });
      return;
    }

    case "text_end": {
      const contentIndex = streamState.activeTextIndex;
      if (contentIndex === null) return;

      const block = streamState.partial.content[contentIndex];
      if (!block || block.type !== "text") return;

      onEvent({
        type: "text_end",
        contentIndex,
        content: block.text,
        partial: streamState.partial,
      });
      streamState.activeTextIndex = null;
      return;
    }

    case "thinking_start": {
      streamState.activeThinkingIndex = streamState.partial.content.length;
      streamState.partial.content.push({ type: "thinking", thinking: "" });
      onEvent({
        type: "thinking_start",
        contentIndex: streamState.activeThinkingIndex,
        partial: streamState.partial,
      });
      return;
    }

    case "thinking_delta": {
      if (streamState.activeThinkingIndex === null) {
        applyVisibleAssistantEvent(
          streamState,
          { type: "thinking_start", contentIndex: 0, partial: event.partial },
          onEvent,
        );
      }

      const contentIndex = streamState.activeThinkingIndex;
      if (contentIndex === null) return;

      const block = streamState.partial.content[contentIndex];
      if (!block || block.type !== "thinking") return;

      block.thinking += event.delta;
      onEvent({
        type: "thinking_delta",
        contentIndex,
        delta: event.delta,
        partial: streamState.partial,
      });
      return;
    }

    case "thinking_end": {
      const contentIndex = streamState.activeThinkingIndex;
      if (contentIndex === null) return;

      const block = streamState.partial.content[contentIndex];
      if (!block || block.type !== "thinking") return;

      onEvent({
        type: "thinking_end",
        contentIndex,
        content: block.thinking,
        partial: streamState.partial,
      });
      streamState.activeThinkingIndex = null;
      return;
    }

    case "toolcall_start":
    case "toolcall_delta":
      finishOpenVisibleBlocks(streamState, onEvent);
      onEvent(event);
      return;

    case "toolcall_end":
      finishOpenVisibleBlocks(streamState, onEvent);
      streamState.partial.content[event.contentIndex] = structuredClone(event.toolCall);
      onEvent({
        ...event,
        partial: streamState.partial,
      });
      return;

    case "start":
    case "done":
    case "error":
      return;
  }
}

function surfaceStreamPatchFromAssistantEvent(
  event: AssistantMessageEvent,
): SurfaceStreamPatchInput | null {
  switch (event.type) {
    case "text_start":
    case "thinking_start":
      return {
        type: event.type,
        contentIndex: event.contentIndex,
      };

    case "text_delta":
    case "thinking_delta":
      return {
        type: event.type,
        contentIndex: event.contentIndex,
        delta: event.delta,
      };

    case "text_end":
    case "thinking_end":
      return {
        type: event.type,
        contentIndex: event.contentIndex,
        content: event.content,
      };

    case "toolcall_start":
    case "toolcall_delta":
    case "toolcall_end": {
      const contentIndex = event.contentIndex;
      const candidate = "toolCall" in event ? event.toolCall : event.partial.content[contentIndex];
      if (!candidate || candidate.type !== "toolCall") {
        return null;
      }
      return {
        type: event.type,
        contentIndex,
        toolCall: candidate,
      };
    }

    case "start":
    case "done":
    case "error":
      return null;
  }
}

function finishOpenVisibleBlocks(
  streamState: VisibleStreamState,
  onEvent: (event: AssistantMessageEvent) => void,
): void {
  if (streamState.activeThinkingIndex !== null) {
    const block = streamState.partial.content[streamState.activeThinkingIndex];
    if (block && block.type === "thinking") {
      onEvent({
        type: "thinking_end",
        contentIndex: streamState.activeThinkingIndex,
        content: block.thinking,
        partial: streamState.partial,
      });
    }
    streamState.activeThinkingIndex = null;
  }

  if (streamState.activeTextIndex !== null) {
    const block = streamState.partial.content[streamState.activeTextIndex];
    if (block && block.type === "text") {
      onEvent({
        type: "text_end",
        contentIndex: streamState.activeTextIndex,
        content: block.text,
        partial: streamState.partial,
      });
    }
    streamState.activeTextIndex = null;
  }
}

function finalizeVisibleAssistantMessage(
  streamState: VisibleStreamState,
  message: AssistantMessage,
  provider: string,
  model: string,
): AssistantMessage {
  const sanitized = sanitizeAssistantMessage(message, provider, model);
  const streamedContent = structuredClone(streamState.partial.content);
  const visibleContent = hasVisibleAssistantContent(streamedContent)
    ? streamedContent
    : sanitized.content;

  return {
    ...message,
    api: `${provider}-responses`,
    provider,
    model,
    content: visibleContent,
    stopReason: message.stopReason === "toolUse" ? "stop" : message.stopReason,
  };
}

function hasVisibleAssistantContent(content: AssistantMessage["content"]): boolean {
  return content.some((block) => {
    if (block.type === "text") return block.text.trim().length > 0;
    if (block.type === "thinking") return block.thinking.trim().length > 0;
    return block.type === "toolCall";
  });
}

function sanitizeAssistantMessage(
  message: AssistantMessage,
  provider: string,
  model: string,
): AssistantMessage {
  const content = message.content.filter(
    (block) => block.type === "text" || block.type === "thinking",
  );
  const fallbackText =
    message.errorMessage && (message.stopReason === "error" || message.stopReason === "aborted")
      ? message.errorMessage
      : "";
  return {
    ...message,
    provider,
    model,
    content: content.length > 0 ? content : [{ type: "text", text: fallbackText }],
  };
}

function getLatestAssistantMessage(messages: AgentMessage[]): AssistantMessage | undefined {
  const assistantMessages = messages.filter(
    (message): message is AssistantMessage => message.role === "assistant",
  );
  return assistantMessages.at(-1);
}

function getLatestUserMessage(messages: readonly Message[]): Message | null {
  const message = messages.findLast((entry) => entry.role === "user") ?? null;
  return message ? structuredClone(message) : null;
}

function extractAssistantText(message: AssistantMessage | undefined): string {
  if (!message) {
    return "";
  }
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join(" ")
    .trim();
}

export function normalizeGeneratedTitle(input: string): string {
  const firstLine = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const title = (firstLine ?? "New Session")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.。]+$/g, "")
    .trim()
    .slice(0, 80)
    .trim();
  return normalizeTitleCasing(title) || "New Session";
}

function isGenericGeneratedTitle(title: string): boolean {
  return /^(New|New Session|Session|Chat|Conversation|Request|Task)$/i.test(title.trim());
}

function normalizeTitleCasing(title: string): string {
  const words = title.split(/\s+/);
  if (words.length <= 1) {
    return title;
  }

  const isTitleCasePhrase = words.every(
    (word) => isPlainTitleCaseWord(word) || isPreservedWord(word),
  );
  if (!isTitleCasePhrase || !words.some(isPlainTitleCaseWord)) {
    return title;
  }

  const preserveFirstTitleCase = words.slice(1).some(isPreservedWord);
  return words
    .map((word, index) =>
      isPlainTitleCaseWord(word) && !(index === 0 && preserveFirstTitleCase)
        ? word.toLowerCase()
        : word,
    )
    .join(" ");
}

function isPlainTitleCaseWord(word: string): boolean {
  return /^[A-Z][a-z]+$/.test(word);
}

function isPreservedWord(word: string): boolean {
  return (
    /^[A-Z0-9._/-]{2,}$/.test(word) ||
    /[._/-]/.test(word) ||
    /[a-z][A-Z]/.test(word) ||
    /[A-Z].*[A-Z].*[a-z]/.test(word)
  );
}

function persistSessionManagerSnapshot(sessionManager: SessionManager): void {
  const sessionFile = sessionManager.getSessionFile();
  if (!sessionFile) {
    return;
  }

  const header = sessionManager.getHeader();
  if (!header) {
    return;
  }

  const entries = sessionManager.getEntries();
  const lines = [header, ...entries].map((entry) => JSON.stringify(entry));
  writeFileSync(sessionFile, `${lines.join("\n")}\n`);
}

function hasRestorableWorkflowSupervision(snapshot: StructuredSessionSnapshot): boolean {
  return snapshot.workflowRuns.some(
    (workflowRun) =>
      !isTerminalStructuredWorkflowStatus(workflowRun.status) ||
      workflowRun.pendingAttentionSeq !== null,
  );
}

function isTerminalStructuredWorkflowStatus(
  status: StructuredSessionSnapshot["workflowRuns"][number]["status"],
): boolean {
  return (
    status === "continued" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function messageToPlainText(message: Message): string {
  switch (message.role) {
    case "user":
      return flattenUserContent(message.content);
    case "assistant":
      return message.content
        .map((block) => {
          if (block.type === "text") return block.text;
          if (block.type === "thinking") return block.thinking;
          if (block.type === "toolCall") return `[tool call: ${block.name}]`;
          return "";
        })
        .filter(Boolean)
        .join("\n");
    case "toolResult":
      return message.content
        .map((block) => {
          if (block.type === "text") return block.text;
          if (block.type === "image") return "[image]";
          return "";
        })
        .filter(Boolean)
        .join("\n");
  }
}

function flattenUserContent(content: Message["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function createPartialAssistantMessage(provider: string, model: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: `${provider}-responses`,
    provider,
    model,
    usage: ZERO_USAGE,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function createErrorMessage(
  provider: string,
  model: string,
  message: string,
  stopReason: "aborted" | "error",
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: message }],
    api: `${provider}-responses`,
    provider,
    model,
    usage: ZERO_USAGE,
    stopReason,
    errorMessage: message,
    timestamp: Date.now(),
  };
}
