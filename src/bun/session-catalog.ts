import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import {
  getModel,
  getProviders,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Message,
} from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type {
  ActiveSessionState,
  ActiveSessionSummaryState,
  CreateSessionRequest,
  ForkSessionRequest,
  ListSessionsResponse,
  PromptTarget,
  SessionMutationResponse,
  WorkspaceCommandInspector,
  WorkspaceHandlerThreadInspector,
  WorkspaceHandlerThreadSummary,
  WorkspaceSessionSummary,
} from "../mainview/chat-rpc";
import { DEFAULT_CHAT_SETTINGS } from "../mainview/chat-settings";
import {
  projectWorkspaceSessionSummary,
  projectWorkspaceSessionSummaryFromInfo,
} from "./session-projection";
import {
  buildStructuredCommandInspector,
  buildStructuredHandlerThreadInspector,
  buildStructuredHandlerThreadSummaries,
  buildStructuredSessionSummaryProjection,
  buildStructuredSessionView,
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
} from "./structured-session-state";
import {
  mapSmithersRunStateToWorkflowProjectionInput,
  readSmithersRunState,
  type SmithersRunState,
} from "./smithers-workflow-bridge";
import { createStartWorkflowTool } from "./smithers-workflow-tool";
import { createExecuteTypescriptTool } from "./execute-typescript-tool";
import { createResumeWorkflowTool } from "./smithers-workflow-tool";
import { createWaitTool } from "./wait-tool";
import { resolveApiKey } from "./auth-store";
import { createToolExecutionCommandTracker } from "./tool-execution-command-tracker";
import { resolveWorkspaceCwd } from "./workspace-context";
import { createStartThreadTool } from "./thread-start-tool";
import { createThreadHandoffTool } from "./thread-handoff-tool";

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

const STRUCTURED_SESSION_DB_FILENAME = "structured-session-state.sqlite";

interface ManagedSession {
  sessionId: string;
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  promptSyncCursor: PromptSyncCursor;
  session: AgentSession;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  activePrompt: boolean;
  recreateOnNextPrompt: boolean;
  abortRequested: boolean;
  promptExecutionRuntime: PromptExecutionRuntimeHandle;
}

export interface SessionDefaults {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
}

export interface SendAgentPromptOptions extends SessionDefaults {
  sessionId?: string;
  target?: PromptTarget;
  messages: Message[];
  includeSystemPromptInTranscript?: boolean;
  onEvent: (event: AssistantMessageEvent) => void;
}

interface CreateManagedSessionOptions {
  sessionManager: SessionManager;
  provider?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  systemPrompt: string;
}

interface VisibleStreamState {
  partial: AssistantMessage;
  activeTextIndex: number | null;
  activeThinkingIndex: number | null;
}

interface PromptSyncCursor {
  messageCount: number;
  boundarySignature: string;
}

export class WorkspaceSessionCatalog {
  private activeSession: ManagedSession | null = null;
  private readonly structuredSessionStore: StructuredSessionStateStore;

  constructor(
    private readonly cwd: string = resolveWorkspaceCwd(),
    private readonly agentDir: string = getSvvyAgentDir(),
    private readonly sessionDir: string = getSvvySessionDir(
      resolveWorkspaceCwd(),
      getSvvyAgentDir(),
    ),
  ) {
    const workspaceLabel = basename(this.cwd) || "workspace";
    this.structuredSessionStore = createStructuredSessionStateStore({
      workspace: {
        id: this.cwd,
        label: workspaceLabel,
        cwd: this.cwd,
      },
      databasePath: join(this.sessionDir, STRUCTURED_SESSION_DB_FILENAME),
    });
  }

  private get threadSurfaceDir(): string {
    return join(this.sessionDir, "threads");
  }

  async dispose(): Promise<void> {
    this.activeSession?.session.dispose();
    this.activeSession = null;
    this.structuredSessionStore.close();
  }

  async listSessions(): Promise<ListSessionsResponse> {
    this.refreshSmithersWorkflowProjections();
    const infos = await SessionManager.list(this.cwd, this.sessionDir);
    const summaries = new Map<string, WorkspaceSessionSummary>();

    for (const info of infos) {
      if (this.activeSession?.sessionId === info.id) {
        summaries.set(info.id, this.buildSummaryFromManagedSession(this.activeSession));
        continue;
      }

      const projected = {
        ...projectWorkspaceSessionSummaryFromInfo({
          id: info.id,
          name: info.name,
          firstMessage: info.firstMessage,
          created: info.created,
          modified: info.modified,
          messageCount: info.messageCount,
          path: info.path,
          parentSessionPath: info.parentSessionPath,
        }),
        status: getInactiveSessionStatus(info.path),
      };
      this.upsertStructuredPiSession(projected);
      summaries.set(info.id, this.decorateSummaryWithStructuredProjection(projected));
    }

    if (this.activeSession && !summaries.has(this.activeSession.sessionId)) {
      summaries.set(
        this.activeSession.sessionId,
        this.buildSummaryFromManagedSession(this.activeSession),
      );
    }

    return {
      activeSessionId: this.activeSession?.sessionId,
      sessions: Array.from(summaries.values()).toSorted(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    };
  }

  async getActiveSession(): Promise<ActiveSessionState | null> {
    this.refreshSmithersWorkflowProjections();
    if (!this.activeSession) {
      return null;
    }

    return this.buildActiveSessionState(this.activeSession);
  }

  async getActiveSessionSummary(): Promise<ActiveSessionSummaryState | null> {
    this.refreshSmithersWorkflowProjections();
    if (!this.activeSession) {
      return null;
    }

    return this.buildActiveSessionSummary(this.activeSession);
  }

  async getCommandInspector(input: {
    sessionId: string;
    commandId: string;
  }): Promise<WorkspaceCommandInspector> {
    this.refreshSmithersWorkflowProjections();
    const snapshot = this.getStructuredSnapshot(input.sessionId);
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
    this.refreshSmithersWorkflowProjections();
    const snapshot = this.getStructuredSnapshot(input.sessionId);
    if (!snapshot) {
      throw new Error(`Structured session not found: ${input.sessionId}`);
    }

    return buildStructuredHandlerThreadSummaries(snapshot);
  }

  async getHandlerThreadInspector(input: {
    sessionId: string;
    threadId: string;
  }): Promise<WorkspaceHandlerThreadInspector> {
    this.refreshSmithersWorkflowProjections();
    const snapshot = this.getStructuredSnapshot(input.sessionId);
    if (!snapshot) {
      throw new Error(`Structured session not found: ${input.sessionId}`);
    }

    const inspector = buildStructuredHandlerThreadInspector(snapshot, input.threadId);
    if (!inspector) {
      throw new Error(`Delegated handler thread not found: ${input.threadId}`);
    }

    return inspector;
  }

  async createSession(
    request: CreateSessionRequest,
    defaults: SessionDefaults,
  ): Promise<ActiveSessionState> {
    this.assertCanSwitchSessions();

    const parentSessionFile = request.parentSessionId
      ? await this.getSessionFileForId(request.parentSessionId)
      : undefined;
    const sessionManager = SessionManager.create(this.cwd, this.sessionDir);
    if (parentSessionFile) {
      sessionManager.newSession({ parentSession: parentSessionFile });
    }
    sessionManager.appendSessionInfo(request.title?.trim() || "New Session");

    const session = await this.activateManagedSession({
      sessionManager,
      provider: defaults.provider,
      model: defaults.model,
      thinkingLevel: defaults.thinkingLevel,
      systemPrompt: defaults.systemPrompt,
    });
    this.persistManagedSessionSnapshot(session);

    return this.buildActiveSessionState(session);
  }

  async openSession(sessionId: string, systemPrompt?: string): Promise<ActiveSessionState> {
    const session = await this.openSessionInternal(
      sessionId,
      systemPrompt ?? this.activeSession?.systemPrompt,
    );
    return this.buildActiveSessionState(session);
  }

  async renameSession(sessionId: string, title: string): Promise<SessionMutationResponse> {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw new Error("Session title cannot be empty.");
    }

    if (this.activeSession?.sessionId === sessionId) {
      this.activeSession.session.sessionManager.appendSessionInfo(trimmedTitle);
    } else {
      const sessionFile = await this.getSessionFileForId(sessionId);
      SessionManager.open(sessionFile!, this.sessionDir).appendSessionInfo(trimmedTitle);
    }

    return {
      ok: true,
      activeSessionId: this.activeSession?.sessionId,
    };
  }

  async forkSession(
    request: ForkSessionRequest,
    defaults: SessionDefaults,
  ): Promise<ActiveSessionState> {
    this.assertCanSwitchSessions();

    const sourceSessionFile = await this.getSessionFileForId(request.sessionId, false);
    if (!sourceSessionFile || !existsSync(sourceSessionFile)) {
      const fallbackDefaults =
        this.activeSession?.sessionId === request.sessionId
          ? {
              provider: this.activeSession.provider,
              model: this.activeSession.model,
              thinkingLevel: this.activeSession.thinkingLevel,
              systemPrompt: this.activeSession.systemPrompt,
            }
          : defaults;
      return this.createSession({ title: request.title }, fallbackDefaults);
    }

    const forkedSessionManager = SessionManager.forkFrom(
      sourceSessionFile,
      this.cwd,
      this.sessionDir,
    );
    if (request.title?.trim()) {
      forkedSessionManager.appendSessionInfo(request.title);
    }

    const session = await this.activateManagedSession({
      sessionManager: forkedSessionManager,
      systemPrompt: defaults.systemPrompt,
    });
    return this.buildActiveSessionState(session);
  }

  async deleteSession(
    sessionId: string,
    defaults: SessionDefaults,
  ): Promise<SessionMutationResponse> {
    if (this.activeSession?.sessionId === sessionId && this.activeSession.activePrompt) {
      throw new Error("Cannot delete a session while it is streaming.");
    }

    const deletingActiveSession = this.activeSession?.sessionId === sessionId;
    const sessionFile = await this.getSessionFileForId(sessionId, false);

    if (deletingActiveSession) {
      this.activeSession?.session.dispose();
      this.activeSession = null;
    }

    if (sessionFile && existsSync(sessionFile)) {
      unlinkSync(sessionFile);
    }

    if (!deletingActiveSession) {
      return {
        ok: true,
        activeSessionId: this.activeSession?.sessionId,
      };
    }

    const remainingSessions = await SessionManager.list(this.cwd, this.sessionDir);
    if (remainingSessions.length === 0) {
      const activeSession = await this.createSession({}, defaults);
      return {
        ok: true,
        activeSessionId: activeSession.session.id,
        activeSession,
      };
    }

    const [nextSessionInfo] = remainingSessions;
    if (!nextSessionInfo) {
      throw new Error("Expected a remaining session after deletion.");
    }

    const nextActiveSession = await this.openSessionInternal(
      nextSessionInfo.id,
      defaults.systemPrompt,
    );
    return {
      ok: true,
      activeSessionId: nextActiveSession.sessionId,
      activeSession: await this.buildActiveSessionState(nextActiveSession),
    };
  }

  async sendPrompt(options: SendAgentPromptOptions): Promise<{
    sessionId: string;
    target?: PromptTarget;
  }> {
    const session = await this.ensureSessionForPrompt(options);
    if (session.activePrompt) {
      throw new Error(`Session ${session.sessionId} is already streaming.`);
    }

    session.abortRequested = false;
    session.activePrompt = true;
    const promptExecution = this.createPromptExecutionContext(session, options);

    setTimeout(() => {
      void (async () => {
        await this.runAgentPrompt(session, options, promptExecution);
        await this.resumeOrchestratorAfterHandlerHandoff(promptExecution, session.systemPrompt);
      })().catch((error) => {
        console.error("Failed to continue orchestrator control after prompt execution:", error);
      });
    }, 0);

    return {
      sessionId: session.sessionId,
      target: options.target,
    };
  }

  async cancelPrompt(sessionId: string): Promise<void> {
    if (
      !this.activeSession ||
      this.activeSession.sessionId !== sessionId ||
      !this.activeSession.activePrompt
    ) {
      return;
    }

    this.activeSession.abortRequested = true;
    await this.activeSession.session.abort();
  }

  async setSessionModel(
    sessionId: string,
    model: string,
  ): Promise<{ ok: boolean; sessionId: string }> {
    if (!this.activeSession || this.activeSession.sessionId !== sessionId) {
      return { ok: false, sessionId };
    }

    this.activeSession.model = model;
    this.activeSession.recreateOnNextPrompt = true;

    if (this.activeSession.activePrompt) {
      return { ok: true, sessionId };
    }

    try {
      syncAuthStorage(this.activeSession.authStorage);
      const resolvedModel = getResolvedModel(this.activeSession.provider, model);
      if (resolvedModel) {
        await this.activeSession.session.setModel(resolvedModel);
        this.activeSession.recreateOnNextPrompt = false;
        this.syncManagedState(this.activeSession);
      }
    } catch {
      // Fall back to recreating on the next prompt.
    }

    return { ok: true, sessionId };
  }

  async setSessionThoughtLevel(
    sessionId: string,
    level: ThinkingLevel,
  ): Promise<{ ok: boolean; sessionId: string }> {
    if (!this.activeSession || this.activeSession.sessionId !== sessionId) {
      return { ok: false, sessionId };
    }

    this.activeSession.thinkingLevel = level;

    if (this.activeSession.activePrompt) {
      this.activeSession.recreateOnNextPrompt = true;
      return { ok: true, sessionId };
    }

    this.activeSession.session.setThinkingLevel(level);
    this.syncManagedState(this.activeSession);
    return { ok: true, sessionId };
  }

  private assertCanSwitchSessions(): void {
    if (this.activeSession?.activePrompt) {
      throw new Error("Cannot switch sessions while a prompt is streaming.");
    }
  }

  private async ensureSessionForPrompt(options: SendAgentPromptOptions): Promise<ManagedSession> {
    if (options.sessionId) {
      const session = await this.openSessionInternal(options.sessionId, options.systemPrompt);
      return this.prepareManagedSession(session, options);
    }

    if (!this.activeSession) {
      const session = await this.activateManagedSession({
        sessionManager: SessionManager.create(this.cwd, this.sessionDir),
        provider: options.provider,
        model: options.model,
        thinkingLevel: options.thinkingLevel,
        systemPrompt: options.systemPrompt,
      });
      return session;
    }

    return this.prepareManagedSession(this.activeSession, options);
  }

  private async openSessionInternal(
    sessionId: string,
    systemPrompt = this.activeSession?.systemPrompt ?? "",
  ): Promise<ManagedSession> {
    if (this.activeSession?.sessionId === sessionId) {
      this.activeSession.systemPrompt = systemPrompt || this.activeSession.systemPrompt;
      return this.activeSession;
    }

    this.assertCanSwitchSessions();

    const sessionFile = await this.getSessionFileForId(sessionId);
    return this.activateManagedSession({
      sessionManager: SessionManager.open(sessionFile!, dirname(sessionFile!)),
      systemPrompt: systemPrompt || this.activeSession?.systemPrompt || "",
    });
  }

  private async prepareManagedSession(
    session: ManagedSession,
    options: Pick<
      SendAgentPromptOptions,
      "provider" | "model" | "thinkingLevel" | "systemPrompt" | "messages"
    >,
  ): Promise<ManagedSession> {
    if (
      session.provider !== options.provider ||
      session.model !== options.model ||
      session.recreateOnNextPrompt
    ) {
      return this.recreateActiveSession(session, {
        provider: options.provider,
        model: options.model,
        thinkingLevel: options.thinkingLevel,
        systemPrompt: options.systemPrompt,
      });
    }

    if (session.thinkingLevel !== options.thinkingLevel) {
      session.thinkingLevel = options.thinkingLevel;
      session.session.setThinkingLevel(options.thinkingLevel);
    }

    if (session.systemPrompt !== options.systemPrompt) {
      return this.recreateActiveSession(session, { systemPrompt: options.systemPrompt });
    }

    if (
      session.promptSyncCursor.messageCount > 0 &&
      !canAppendLatestUserTurn(session.promptSyncCursor, options.messages)
    ) {
      return this.recreateActiveSession(session, { systemPrompt: options.systemPrompt });
    }

    return session;
  }

  private async recreateActiveSession(
    session: ManagedSession,
    overrides: Partial<
      Pick<ManagedSession, "provider" | "model" | "thinkingLevel" | "systemPrompt">
    >,
  ): Promise<ManagedSession> {
    const sessionManager = session.session.sessionManager;
    const provider = overrides.provider ?? session.provider;
    const model = overrides.model ?? session.model;
    const thinkingLevel = overrides.thinkingLevel ?? session.thinkingLevel;
    const systemPrompt = overrides.systemPrompt ?? session.systemPrompt;

    session.session.dispose();
    const nextSession = await createManagedSession({
      sessionManager,
      provider,
      model,
      thinkingLevel,
      systemPrompt,
      agentDir: this.agentDir,
      structuredSessionStore: this.structuredSessionStore,
      createHandlerThread: this.createHandlerThread.bind(this),
    });
    this.activeSession = nextSession;
    return nextSession;
  }

  private async activateManagedSession(
    options: CreateManagedSessionOptions,
  ): Promise<ManagedSession> {
    this.activeSession?.session.dispose();
    const session = await createManagedSession({
      ...options,
      agentDir: this.agentDir,
      structuredSessionStore: this.structuredSessionStore,
      createHandlerThread: this.createHandlerThread.bind(this),
    });
    this.activeSession = session;
    return session;
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
      isActive: true,
      isStreaming: session.activePrompt,
    });
  }

  private buildSummaryFromManagedSession(session: ManagedSession): WorkspaceSessionSummary {
    const liveSummary = this.buildLiveSummaryFromManagedSession(session);
    this.upsertStructuredPiSession(liveSummary);
    return this.decorateSummaryWithStructuredProjection(
      liveSummary,
      session.activePrompt ? "running" : undefined,
    );
  }

  private buildActiveSessionSummary(session: ManagedSession): ActiveSessionSummaryState {
    return {
      session: this.buildSummaryFromManagedSession(session),
      provider: session.provider,
      model: session.model,
      reasoningEffort: session.thinkingLevel,
      systemPrompt: session.systemPrompt,
    };
  }

  private async buildActiveSessionState(session: ManagedSession): Promise<ActiveSessionState> {
    return {
      ...this.buildActiveSessionSummary(session),
      messages: structuredClone(session.session.agent.state.messages),
    };
  }

  private upsertStructuredPiSession(summary: WorkspaceSessionSummary): void {
    try {
      this.structuredSessionStore.upsertPiSession({
        sessionId: summary.id,
        title: summary.title,
        provider: summary.provider,
        model: summary.modelId,
        reasoningEffort: summary.thinkingLevel,
        messageCount: summary.messageCount,
        status: summary.status,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
      });
    } catch (error) {
      console.error("Failed to upsert structured session metadata:", error);
    }
  }

  private getStructuredSnapshot(sessionId: string): StructuredSessionSnapshot | null {
    try {
      return this.structuredSessionStore.getSessionState(sessionId);
    } catch {
      return null;
    }
  }

  private decorateSummaryWithStructuredProjection(
    summary: WorkspaceSessionSummary,
    statusOverride?: WorkspaceSessionSummary["status"],
  ): WorkspaceSessionSummary {
    const snapshot = this.getStructuredSnapshot(summary.id);
    if (!snapshot) {
      return statusOverride ? { ...summary, status: statusOverride } : summary;
    }

    if (!hasStructuredSessionFacts(snapshot)) {
      return statusOverride ? { ...summary, status: statusOverride } : summary;
    }

    const structuredSummary = buildStructuredSessionSummaryProjection(snapshot);
    const view = buildStructuredSessionView(snapshot);

    return {
      ...summary,
      title: structuredSummary.title || summary.title,
      preview: structuredSummary.preview || summary.preview,
      status: statusOverride ?? structuredSummary.status,
      updatedAt: structuredSummary.updatedAt,
      wait: projectWorkspaceWait(structuredSummary.wait),
      counts: structuredSummary.counts,
      threadIdsByStatus: view.threadIdsByStatus,
      threadIds: structuredSummary.threadIds,
      commandRollups: view.commandRollups.length > 0 ? view.commandRollups : undefined,
    };
  }

  private refreshSmithersWorkflowProjections(): void {
    for (const session of this.structuredSessionStore.listSessionStates()) {
      for (const workflow of session.workflowRuns) {
        const thread = session.threads.find((entry) => entry.id === workflow.threadId);
        if (!thread) {
          continue;
        }

        try {
          if (
            workflow.status === "completed" ||
            workflow.status === "failed" ||
            workflow.status === "cancelled"
          ) {
            this.reconcileTerminalWorkflowProjection(workflow, thread);
            continue;
          }

          this.refreshSmithersWorkflowProjection(session, workflow);
        } catch (error) {
          console.error(`Failed to refresh Smithers workflow projection ${workflow.id}:`, error);
        }
      }
    }
  }

  private refreshSmithersWorkflowProjection(
    session: StructuredSessionSnapshot,
    workflow: StructuredSessionSnapshot["workflowRuns"][number],
  ): void {
    const run = readSmithersRunState({
      runId: workflow.smithersRunId,
    });
    if (!run) {
      return;
    }

    const projection = mapSmithersRunStateToWorkflowProjectionInput(run);
    const thread = session.threads.find((entry) => entry.id === workflow.threadId);
    if (!thread) {
      return;
    }

    if (workflow.status !== projection.status || workflow.summary !== projection.summary) {
      this.structuredSessionStore.updateWorkflow({
        workflowId: workflow.id,
        status: projection.status,
        summary: projection.summary,
      });
    }

    if (projection.status === "waiting") {
      this.refreshSmithersWaitingWorkflowProjection(thread, workflow, run, projection.summary);
      return;
    }

    if (projection.status === "running") {
      if (thread.status !== "running" || thread.wait !== null) {
        this.structuredSessionStore.updateThread({
          threadId: thread.id,
          status: "running",
          wait: null,
        });
      }
      if (getThreadOwnedWaitId(session.session.wait) === thread.id) {
        this.structuredSessionStore.clearSessionWait({
          sessionId: thread.sessionId,
        });
      }
      return;
    }

    this.reconcileTerminalWorkflowProjection(
      { ...workflow, status: projection.status, summary: projection.summary },
      thread,
    );
  }

  private reconcileTerminalWorkflowProjection(
    _workflow: StructuredSessionSnapshot["workflowRuns"][number],
    thread: StructuredSessionSnapshot["threads"][number],
  ): void {
    if (!isTerminalThreadStatus(thread.status)) {
      this.structuredSessionStore.updateThread({
        threadId: thread.id,
        status: "running",
        wait: null,
      });
    }

    const liveSession = this.structuredSessionStore.getSessionState(thread.sessionId);
    if (getThreadOwnedWaitId(liveSession.session.wait) === thread.id) {
      this.structuredSessionStore.clearSessionWait({
        sessionId: thread.sessionId,
      });
    }
  }

  private refreshSmithersWaitingWorkflowProjection(
    thread: StructuredSessionSnapshot["threads"][number],
    workflow: StructuredSessionSnapshot["workflowRuns"][number],
    run: SmithersRunState,
    summary: string,
  ): void {
    const waiting = buildSmithersWaitingState(run);
    if (
      thread.status !== "waiting" ||
      !matchesWaitState(thread.wait, waiting.kind, waiting.reason, waiting.resumeWhen)
    ) {
      this.structuredSessionStore.updateThread({
        threadId: thread.id,
        status: "waiting",
        wait: waiting,
      });
    }

    const liveSession = this.structuredSessionStore.getSessionState(thread.sessionId);

    if (this.canSessionWaitOnThread(liveSession, thread.id)) {
      const activeWait = liveSession.session.wait;
      if (
        getThreadOwnedWaitId(activeWait) !== thread.id ||
        activeWait?.kind !== waiting.kind ||
        activeWait?.reason !== waiting.reason ||
        activeWait?.resumeWhen !== waiting.resumeWhen
      ) {
        this.structuredSessionStore.setSessionWait({
          sessionId: thread.sessionId,
          owner: {
            kind: "thread",
            threadId: thread.id,
          },
          kind: waiting.kind,
          reason: waiting.reason,
          resumeWhen: waiting.resumeWhen,
        });
      }
    } else if (getThreadOwnedWaitId(liveSession.session.wait) === thread.id) {
      this.structuredSessionStore.clearSessionWait({
        sessionId: thread.sessionId,
      });
    }

    if (workflow.status !== "waiting" || workflow.summary !== summary) {
      this.structuredSessionStore.updateWorkflow({
        workflowId: workflow.id,
        status: "waiting",
        summary,
      });
    }
  }

  private canSessionWaitOnThread(session: StructuredSessionSnapshot, threadId: string): boolean {
    if (session.session.wait && getThreadOwnedWaitId(session.session.wait) !== threadId) {
      return false;
    }

    return session.threads.every((thread) => thread.id === threadId || thread.status !== "running");
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
      const structuredSessionId = this.resolveStructuredSessionIdForPrompt({
        surfaceSessionId: session.sessionId,
        target,
      });
      if (structuredSessionId === session.sessionId) {
        const liveSummary = this.buildLiveSummaryFromManagedSession(session);
        this.upsertStructuredPiSession(liveSummary);
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
          status: "running",
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
      const rootThreadId =
        target?.surface === "thread" && target.threadId
          ? target.threadId
          : this.structuredSessionStore.createThread({
              turnId: turn.id,
              surfacePiSessionId: session.sessionId,
              title: requestSummary,
              objective: promptText,
            }).id;

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
        durableSurfaceContext:
          target?.surface === "thread" && targetThread
            ? buildHandlerDurablePromptContext(preTurnSnapshot, targetThread.id)
            : buildOrchestratorDurablePromptContext(preTurnSnapshot),
      });
    } catch (error) {
      console.error("Failed to start prompt execution state:", error);
      return null;
    }
  }

  private resolveStructuredSessionIdForPrompt(input: {
    surfaceSessionId: string;
    target?: PromptTarget;
  }): string {
    if (input.target?.surface === "thread" && input.target.threadId) {
      const match = this.structuredSessionStore
        .listSessionStates()
        .find((session) => session.threads.some((thread) => thread.id === input.target?.threadId));
      if (match) {
        return match.session.id;
      }
    }

    return input.surfaceSessionId;
  }

  private async getSessionFileForId(
    sessionId: string,
    required = true,
  ): Promise<string | undefined> {
    if (this.activeSession?.sessionId === sessionId) {
      return this.activeSession.session.sessionManager.getSessionFile();
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
    parentThreadId: string;
    parentSurfacePiSessionId: string;
    title: string;
    objective: string;
  }) {
    const parentSessionFile = await this.getSessionFileForId(input.parentSurfacePiSessionId);
    const threadSessionManager = SessionManager.create(this.cwd, this.threadSurfaceDir);
    threadSessionManager.newSession({
      parentSession: parentSessionFile,
    });
    if (input.title.trim()) {
      threadSessionManager.appendSessionInfo(input.title.trim());
    }
    persistSessionManagerSnapshot(threadSessionManager);

    return this.structuredSessionStore.createThread({
      turnId: input.turnId,
      parentThreadId: input.parentThreadId,
      surfacePiSessionId: threadSessionManager.getSessionId(),
      title: input.title,
      objective: input.objective,
    });
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
    try {
      const streamState = createVisibleStreamState(options.provider, options.model);
      options.onEvent({ type: "start", partial: streamState.partial });
      const unsubscribe = session.session.subscribe((event) => {
        if (event.type === "message_update") {
          applyVisibleAssistantEvent(streamState, event.assistantMessageEvent, options.onEvent);
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

        const promptText = buildPromptText(
          session,
          options.messages,
          options.systemPrompt,
          options.includeSystemPromptInTranscript ?? true,
          promptContext,
        );
        if (!promptText) {
          throw new Error("No user message to send.");
        }

        const previousMessageCount = session.session.agent.state.messages.length;
        await session.session.prompt(promptText, { expandPromptTemplates: false });
        finishOpenVisibleBlocks(streamState, options.onEvent);

        const emittedMessage =
          getLatestAssistantMessage(
            session.session.agent.state.messages.slice(previousMessageCount),
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

        if (visibleMessage.stopReason === "error" || visibleMessage.stopReason === "aborted") {
          options.onEvent({
            type: "error",
            reason: visibleMessage.stopReason,
            error: visibleMessage,
          });
        } else {
          options.onEvent({
            type: "done",
            reason: visibleMessage.stopReason === "toolUse" ? "stop" : visibleMessage.stopReason,
            message: visibleMessage,
          });
        }

        updatePromptSyncCursor(session, [...options.messages, visibleMessage]);
        session.provider = options.provider;
        session.model = options.model;
        session.thinkingLevel = options.thinkingLevel;
        session.systemPrompt = options.systemPrompt;
        session.recreateOnNextPrompt = false;
        this.completePromptExecution(promptContext, visibleMessage);
      } catch (error) {
        const reason = session.abortRequested ? "aborted" : "error";
        toolCommandTracker?.finishDanglingCommands({
          status: reason === "aborted" ? "cancelled" : "failed",
          error: error instanceof Error ? error.message : "pi prompt failed.",
        });
        finishOpenVisibleBlocks(streamState, options.onEvent);
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

        options.onEvent({
          type: "error",
          reason,
          error: failure,
        });

        updatePromptSyncCursor(session, [...options.messages, failure]);
        session.provider = options.provider;
        session.model = options.model;
        session.thinkingLevel = options.thinkingLevel;
        session.systemPrompt = options.systemPrompt;
        this.failPromptExecution(promptContext, failure);
      } finally {
        unsubscribe();
        toolCommandTracker?.finishDanglingCommands({
          status: "cancelled",
          error: "Prompt execution ended before the tool run finished.",
        });
        session.abortRequested = false;
        session.activePrompt = false;
        this.syncManagedState(session);
      }
    } finally {
      session.promptExecutionRuntime.current = null;
    }
  }

  private async resumeOrchestratorAfterHandlerHandoff(
    promptContext: PromptExecutionContext | null,
    systemPrompt: string,
  ): Promise<void> {
    if (!promptContext || promptContext.surfaceKind !== "handler") {
      return;
    }

    const snapshot = this.getStructuredSnapshot(promptContext.sessionId);
    if (!snapshot) {
      return;
    }

    const turn = snapshot.turns.find((entry) => entry.id === promptContext.turnId);
    if (!turn || turn.turnDecision !== "handoff" || turn.status !== "completed") {
      return;
    }

    const thread = snapshot.threads.find((entry) => entry.id === promptContext.rootThreadId);
    const latestEpisode = thread
      ? getLatestThreadEpisode(snapshot, thread.id)
      : null;
    if (!thread || !latestEpisode) {
      return;
    }

    const orchestratorSessionId = snapshot.session.orchestratorPiSessionId;
    const orchestratorSession = await this.openSessionInternal(orchestratorSessionId, systemPrompt);
    if (orchestratorSession.activePrompt) {
      return;
    }

    orchestratorSession.abortRequested = false;
    orchestratorSession.activePrompt = true;

    const resumeMessage = createSyntheticUserMessage(
      buildOrchestratorHandoffResumePrompt(thread, latestEpisode),
    );
    const options: SendAgentPromptOptions = {
      sessionId: orchestratorSession.sessionId,
      target: {
        surface: "orchestrator",
        surfaceSessionId: orchestratorSession.sessionId,
      },
      provider: orchestratorSession.provider,
      model: orchestratorSession.model,
      thinkingLevel: orchestratorSession.thinkingLevel,
      systemPrompt: orchestratorSession.systemPrompt,
      includeSystemPromptInTranscript: false,
      messages: [...convertToLlmMessages(orchestratorSession.session.agent.state.messages), resumeMessage],
      onEvent: () => {},
    };
    const orchestratorPromptContext = this.createPromptExecutionContext(
      orchestratorSession,
      options,
    );
    await this.runAgentPrompt(orchestratorSession, options, orchestratorPromptContext);
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
      const rootThread = snapshot.threads.find(
        (thread) => thread.id === promptContext.rootThreadId,
      );
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
        return;
      }

      if (
        promptContext.surfaceKind !== "handler" &&
        assistantText &&
        rootThread?.status === "running"
      ) {
        this.structuredSessionStore.updateThread({
          threadId: rootThread.id,
          status: "completed",
        });
        const finalizedThread =
          this.structuredSessionStore
            .getSessionState(promptContext.sessionId)
            .threads.find((thread) => thread.id === promptContext.rootThreadId) ?? null;
        if (finalizedThread && isTerminalThreadStatus(finalizedThread.status)) {
          this.structuredSessionStore.createEpisode({
            threadId: promptContext.rootThreadId,
            kind: promptContext.rootEpisodeKind,
            title: finalizedThread.title || summarizePromptForTurn(promptContext.promptText),
            summary: summarizePromptForTurn(assistantText),
            body: assistantText,
          });
        }
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
    } catch (error) {
      console.error("Failed to finalize prompt execution:", error);
    }
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
      const rootThread = snapshot.threads.find(
        (thread) => thread.id === promptContext.rootThreadId,
      );
      if (rootThread && rootThread.status === "running") {
        this.structuredSessionStore.updateThread({
          threadId: rootThread.id,
          status: "failed",
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
      console.error("Failed to mark prompt execution failure:", error);
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
      getResolvedModel(restoredDefaults.provider, restoredDefaults.model);

    session.provider = activeModel?.provider ?? restoredDefaults.provider;
    session.model = activeModel?.id ?? restoredDefaults.model;
    session.thinkingLevel = restoredDefaults.thinkingLevel;
    updatePromptSyncCursor(session, convertToLlmMessages(session.session.agent.state.messages));
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
  },
): Promise<ManagedSession> {
  mkdirSync(options.agentDir, { recursive: true });

  const authStorage = AuthStorage.inMemory();
  syncAuthStorage(authStorage);
  const promptExecutionRuntime: PromptExecutionRuntimeHandle = {
    current: null,
  };
  const tools = [
    createExecuteTypescriptTool({
      cwd: options.sessionManager.getCwd(),
      runtime: promptExecutionRuntime,
      store: options.structuredSessionStore,
    }),
    createStartThreadTool({
      runtime: promptExecutionRuntime,
      store: options.structuredSessionStore,
      bridge: {
        createHandlerThread: options.createHandlerThread,
      },
    }),
    createThreadHandoffTool({
      runtime: promptExecutionRuntime,
      store: options.structuredSessionStore,
    }),
    createStartWorkflowTool({
      runtime: promptExecutionRuntime,
      store: options.structuredSessionStore,
    }),
    createResumeWorkflowTool({
      runtime: promptExecutionRuntime,
      store: options.structuredSessionStore,
    }),
    createWaitTool({
      runtime: promptExecutionRuntime,
      store: options.structuredSessionStore,
    }),
  ] as const;
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
  const restoredDefaults = resolveRestoredSessionDefaults(options.sessionManager, {
    provider: options.provider,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
  });
  const resolvedModel = getResolvedModel(restoredDefaults.provider, restoredDefaults.model);
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
    tools: [],
    customTools,
  });
  const activeModel = session.agent.state.model ?? resolvedModel;

  return {
    sessionId: session.sessionManager.getSessionId(),
    provider: activeModel.provider,
    model: activeModel.id,
    thinkingLevel: restoredDefaults.thinkingLevel,
    systemPrompt: options.systemPrompt,
    promptSyncCursor: createPromptSyncCursor(convertToLlmMessages(session.agent.state.messages)),
    session,
    authStorage,
    modelRegistry,
    activePrompt: false,
    recreateOnNextPrompt: false,
    abortRequested: false,
    promptExecutionRuntime,
  };
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

function getInactiveSessionStatus(
  sessionFile: string | undefined,
): WorkspaceSessionSummary["status"] {
  if (!sessionFile || !existsSync(sessionFile)) {
    return "idle";
  }

  try {
    const content = readFileSync(sessionFile, "utf8");
    const lines = content.trim().split("\n");

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim();
      if (!line) {
        continue;
      }

      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      const status = getStatusFromSessionEntry(entry);
      if (status) {
        return status;
      }
    }
  } catch {
    return "idle";
  }

  return "idle";
}

function buildSmithersWaitingState(run: SmithersRunState): StructuredWaitState {
  switch (run.status) {
    case "waiting-approval":
      return {
        kind: "user",
        reason: "Waiting for approval or clarification before the Smithers workflow can continue.",
        resumeWhen: "Resume when the required approval or clarification is provided.",
        since: new Date().toISOString(),
      };
    case "waiting-event":
      return {
        kind: "external",
        reason: "Waiting for an external Smithers event before the workflow can continue.",
        resumeWhen: "Resume when the required external Smithers event arrives.",
        since: new Date().toISOString(),
      };
    default:
      return {
        kind: "external",
        reason: "Waiting for the Smithers workflow to resume.",
        resumeWhen: "Resume when the Smithers workflow reports progress again.",
        since: new Date().toISOString(),
      };
  }
}

function matchesWaitState(
  wait: StructuredSessionSnapshot["threads"][number]["wait"],
  kind: "user" | "external",
  reason: string,
  resumeWhen: string,
): boolean {
  return wait?.kind === kind && wait.reason === reason && wait.resumeWhen === resumeWhen;
}

function isTerminalThreadStatus(
  status: StructuredSessionSnapshot["threads"][number]["status"],
): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
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

function getLatestThreadEpisode(
  snapshot: StructuredSessionSnapshot,
  threadId: string,
): StructuredSessionSnapshot["episodes"][number] | null {
  return (
    snapshot.episodes
      .filter((episode) => episode.threadId === threadId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
  );
}

function buildOrchestratorHandoffResumePrompt(
  thread: StructuredSessionSnapshot["threads"][number],
  episode: StructuredSessionSnapshot["episodes"][number],
): string {
  return [
    "System event: A handler thread emitted a durable handoff.",
    `Thread id: ${thread.id}`,
    `Thread title: ${thread.title}`,
    `Objective: ${thread.objective}`,
    `Latest handoff title: ${episode.title}`,
    `Latest handoff summary: ${episode.summary}`,
    "Reconcile the latest durable handoff from state for this thread and decide the next orchestrator action.",
  ].join("\n");
}

function getStatusFromSessionEntry(entry: unknown): WorkspaceSessionSummary["status"] | undefined {
  if (!entry || typeof entry !== "object" || !("type" in entry) || entry.type !== "message") {
    return undefined;
  }

  const message = "message" in entry ? entry.message : undefined;
  if (!message || typeof message !== "object" || !("role" in message)) {
    return undefined;
  }

  if (
    message.role === "assistant" &&
    "stopReason" in message &&
    (message.stopReason === "error" || message.stopReason === "aborted")
  ) {
    return "error";
  }

  if (message.role === "toolResult" && "isError" in message && message.isError === true) {
    return "error";
  }

  if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
    return "idle";
  }

  return undefined;
}

function getThreadOwnedWaitId(wait: StructuredSessionSnapshot["session"]["wait"]): string | null {
  if (!wait || wait.owner.kind !== "thread") {
    return null;
  }

  return wait.owner.threadId;
}

function projectWorkspaceWait(
  wait: StructuredSessionSnapshot["session"]["wait"],
): WorkspaceSessionSummary["wait"] {
  if (!wait) {
    return null;
  }

  return {
    threadId: getThreadOwnedWaitId(wait) ?? undefined,
    kind: wait.kind,
    reason: wait.reason,
    resumeWhen: wait.resumeWhen,
    since: wait.since,
  };
}

function getEffectiveTurnWait(
  snapshot: StructuredSessionSnapshot,
  threadId: string,
): StructuredWaitState | null {
  const thread = snapshot.threads.find((entry) => entry.id === threadId) ?? null;
  if (!thread) {
    return null;
  }

  if (getThreadOwnedWaitId(snapshot.session.wait) === threadId) {
    return (
      thread.wait ?? {
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
  if (input.wait?.kind === "user") {
    return "clarify";
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

function buildOrchestratorDurablePromptContext(
  snapshot: StructuredSessionSnapshot | null,
): string | undefined {
  if (!snapshot) {
    return undefined;
  }

  const handoffs = snapshot.threads
    .filter((thread) => thread.surfacePiSessionId !== snapshot.session.orchestratorPiSessionId)
    .map((thread) => {
      const latestEpisode =
        snapshot.episodes
          .filter((episode) => episode.threadId === thread.id)
          .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
      if (!latestEpisode) {
        return null;
      }

      const latestWorkflow =
        snapshot.workflowRuns.find(
          (workflowRun) => workflowRun.id === thread.latestWorkflowRunId,
        ) ?? null;

      return {
        thread,
        latestEpisode,
        latestWorkflow,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .toSorted((left, right) =>
      right.latestEpisode.createdAt.localeCompare(left.latestEpisode.createdAt),
    )
    .slice(0, 6);

  if (handoffs.length === 0) {
    return undefined;
  }

  const parts = ["Latest handler-thread handoffs from durable state:"];
  for (const handoff of handoffs) {
    parts.push(
      `Thread ${handoff.thread.id} (${collapsePromptContextValue(handoff.thread.title, 80)})`,
    );
    parts.push(`Status: ${handoff.thread.status}`);
    parts.push(`Objective: ${collapsePromptContextValue(handoff.thread.objective, 220)}`);
    if (handoff.latestWorkflow) {
      parts.push(
        `Latest workflow: ${collapsePromptContextValue(handoff.latestWorkflow.summary, 220)}`,
      );
    }
    parts.push(
      `Latest handoff summary: ${collapsePromptContextValue(handoff.latestEpisode.summary, 220)}`,
    );
    parts.push(
      `Latest handoff body: ${collapsePromptContextValue(handoff.latestEpisode.body, 320)}`,
    );
    parts.push("");
  }

  return parts.join("\n").trim();
}

function buildHandlerDurablePromptContext(
  snapshot: StructuredSessionSnapshot | null,
  threadId: string,
): string | undefined {
  if (!snapshot) {
    return undefined;
  }

  const thread = snapshot.threads.find((entry) => entry.id === threadId) ?? null;
  if (!thread) {
    return undefined;
  }

  const latestWorkflow =
    snapshot.workflowRuns.find((workflowRun) => workflowRun.id === thread.latestWorkflowRunId) ??
    null;
  const latestEpisode =
    snapshot.episodes
      .filter((episode) => episode.threadId === thread.id)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;

  const parts = [
    "Current interactive surface: handler thread.",
    "You are currently inside the delegated handler-thread surface, not the orchestrator surface.",
    `Thread id: ${thread.id}`,
    `Title: ${collapsePromptContextValue(thread.title, 120)}`,
    `Objective: ${collapsePromptContextValue(thread.objective, 280)}`,
    `Current objective status: ${thread.status}`,
    "Use thread.handoff only when you want to return control to the orchestrator with a durable episode.",
    "Ordinary replies, clarification, and follow-up chat should stay inside this thread.",
  ];

  if (thread.wait) {
    parts.push(`Current wait: ${thread.wait.kind} - ${collapsePromptContextValue(thread.wait.reason, 220)}`);
  }

  if (latestWorkflow) {
    parts.push(`Latest workflow summary: ${collapsePromptContextValue(latestWorkflow.summary, 220)}`);
  }

  if (latestEpisode) {
    parts.push(`Latest handoff summary: ${collapsePromptContextValue(latestEpisode.summary, 220)}`);
  }

  return parts.join("\n");
}

function collapsePromptContextValue(value: string, limit: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) {
    return collapsed;
  }

  return `${collapsed.slice(0, limit - 1).trimEnd()}…`;
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
    provider: overrides.provider ?? metadata.provider ?? DEFAULT_CHAT_SETTINGS.provider,
    model: overrides.model ?? metadata.model ?? DEFAULT_CHAT_SETTINGS.model,
    thinkingLevel:
      overrides.thinkingLevel ?? metadata.thinkingLevel ?? DEFAULT_CHAT_SETTINGS.reasoningEffort,
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

function getResolvedModel(provider: string, model: string) {
  return getModel(
    provider as Parameters<typeof getModel>[0],
    model as Parameters<typeof getModel>[1],
  );
}

function getSvvyAgentDir(): string {
  return process.platform === "win32"
    ? join(process.env.APPDATA ?? homedir(), "svvy", "pi-agent")
    : join(homedir(), ".config", "svvy", "pi-agent");
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
    case "toolcall_end":
      finishOpenVisibleBlocks(streamState, onEvent);
      return;

    case "start":
    case "done":
    case "error":
      return;
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
  const visibleContent =
    streamState.partial.content.length > 0
      ? structuredClone(streamState.partial.content)
      : sanitizeAssistantMessage(message, provider, model).content;

  return {
    ...message,
    api: `${provider}-responses`,
    provider,
    model,
    content: visibleContent,
    stopReason: message.stopReason === "toolUse" ? "stop" : message.stopReason,
  };
}

function sanitizeAssistantMessage(
  message: AssistantMessage,
  provider: string,
  model: string,
): AssistantMessage {
  const content = message.content.filter(
    (block) => block.type === "text" || block.type === "thinking",
  );
  return {
    ...message,
    provider,
    model,
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
  };
}

function getLatestAssistantMessage(messages: AgentMessage[]): AssistantMessage | undefined {
  const assistantMessages = messages.filter(
    (message): message is AssistantMessage => message.role === "assistant",
  );
  return assistantMessages.at(-1);
}

function buildPromptText(
  session: ManagedSession,
  messages: Message[],
  systemPrompt?: string,
  includeSystemPromptInTranscript = true,
  promptContext?: PromptExecutionContext | null,
): string {
  const durableSurfaceContext = promptContext?.durableSurfaceContext?.trim() || undefined;
  const serializedSystemPrompt = includeSystemPromptInTranscript ? systemPrompt : undefined;
  if (!durableSurfaceContext && !canAppendLatestUserTurn(session.promptSyncCursor, messages)) {
    return buildTranscript(serializedSystemPrompt, messages);
  }

  if (durableSurfaceContext && !canAppendLatestUserTurn(session.promptSyncCursor, messages)) {
    return buildTranscript(serializedSystemPrompt, messages, durableSurfaceContext);
  }

  const nextMessage = messages[session.promptSyncCursor.messageCount];
  if (!nextMessage || nextMessage.role !== "user") {
    return buildTranscript(serializedSystemPrompt, messages, durableSurfaceContext);
  }

  if (!durableSurfaceContext) {
    return messageToPlainText(nextMessage);
  }

  return buildTranscript(serializedSystemPrompt, [nextMessage], durableSurfaceContext);
}

function buildTranscript(
  systemPrompt: string | undefined,
  messages: Message[],
  durableSurfaceContext?: string,
): string {
  const parts: string[] = [];
  const prompt = systemPrompt?.trim();
  if (prompt) {
    parts.push("System:");
    parts.push(prompt);
    parts.push("");
  }

  if (durableSurfaceContext?.trim()) {
    parts.push("Durable Surface Context:");
    parts.push(durableSurfaceContext.trim());
    parts.push("");
  }

  for (const message of messages) {
    const text = messageToPlainText(message).trim();
    if (!text) continue;

    const label =
      message.role === "user"
        ? "User"
        : message.role === "assistant"
          ? "Assistant"
          : `Tool Result (${message.toolName})`;
    parts.push(`${label}:`);
    parts.push(text);
    parts.push("");
  }

  parts.push(
    "Continue the conversation from the latest user message. Respond only as the assistant.",
  );
  return parts.join("\n").trim();
}

function canAppendLatestUserTurn(cursor: PromptSyncCursor, currentMessages: Message[]): boolean {
  if (cursor.messageCount === 0 || cursor.messageCount >= currentMessages.length) {
    return false;
  }

  return (
    currentMessages.length === cursor.messageCount + 1 &&
    currentMessages.at(-1)?.role === "user" &&
    hashPromptMessageSequence(currentMessages, cursor.messageCount) === cursor.boundarySignature
  );
}

function updatePromptSyncCursor(session: ManagedSession, messages: Message[]): void {
  session.promptSyncCursor = createPromptSyncCursor(messages);
}

function createPromptSyncCursor(messages: Message[]): PromptSyncCursor {
  return {
    messageCount: messages.length,
    boundarySignature: hashPromptMessageSequence(messages),
  };
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

function hashPromptMessageSequence(messages: Message[], limit = messages.length): string {
  const hash = createHash("sha256");
  for (let index = 0; index < limit; index += 1) {
    hashPromptMessage(hash, messages[index]!);
    hash.update("\u001e");
  }
  return hash.digest("hex");
}

function hashPromptMessage(hash: ReturnType<typeof createHash>, message: Message): void {
  hash.update(message.role);
  hash.update("\u001f");

  if (message.role === "toolResult") {
    hash.update(message.toolName);
    hash.update("\u001f");
  }

  hash.update(messageToPlainText(message).trim());
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
