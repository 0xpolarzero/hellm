import { createHash } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
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
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type {
  ConversationSurfaceSnapshot,
  CreateSessionRequest,
  ForkSessionRequest,
  ListSessionsResponse,
  PromptTarget,
  SurfaceSyncMessage,
  WorkspaceMutationResponse,
  WorkspaceSyncMessage,
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
import { createExecuteTypescriptTool } from "./execute-typescript-tool";
import { createWaitTool } from "./wait-tool";
import { resolveApiKey } from "./auth-store";
import { createToolExecutionCommandTracker } from "./tool-execution-command-tracker";
import { resolveWorkspaceCwd } from "./workspace-context";
import { createStartThreadTool } from "./thread-start-tool";
import { createThreadHandoffTool } from "./thread-handoff-tool";
import { buildSystemPrompt, type SvvyActorProfile } from "./default-system-prompt";
import { createSmithersTools } from "./smithers-tools";
import { SmithersRuntimeManager } from "./smithers-runtime/manager";

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

const STRUCTURED_SESSION_DB_FILENAME = "structured-session-state-v3.sqlite";

interface ManagedSession {
  sessionId: string;
  actorProfile: SvvyActorProfile;
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  smithersToolSurfaceVersion: string | null;
  promptSyncCursor: PromptSyncCursor;
  session: AgentSession;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  activePrompt: boolean;
  recreateOnNextPrompt: boolean;
  abortRequested: boolean;
  retainCount: number;
  promptExecutionRuntime: PromptExecutionRuntimeHandle;
}

export interface SessionDefaults {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
}

export interface SendAgentPromptOptions extends SessionDefaults {
  target: PromptTarget;
  messages: Message[];
  onEvent: (event: AssistantMessageEvent) => void;
}

interface CreateManagedSessionOptions {
  sessionManager: SessionManager;
  actorProfile: SvvyActorProfile;
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

type WorkspaceSessionInfo = Awaited<ReturnType<typeof SessionManager.list>>[number];

export class WorkspaceSessionCatalog {
  private readonly managedSurfaces = new Map<string, ManagedSession>();
  private readonly structuredSessionStore: StructuredSessionStateStore;
  private readonly smithersRuntimeManager: SmithersRuntimeManager;
  private workspaceSyncListener: ((payload: WorkspaceSyncMessage) => void) | null = null;
  private surfaceSyncListener: ((payload: SurfaceSyncMessage) => void) | null = null;

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
    this.smithersRuntimeManager = new SmithersRuntimeManager({
      cwd: this.cwd,
      agentDir: this.agentDir,
      store: this.structuredSessionStore,
      getTaskAgentDefaults: () => ({
        provider: DEFAULT_CHAT_SETTINGS.provider,
        model: DEFAULT_CHAT_SETTINGS.model,
        thinkingLevel: DEFAULT_CHAT_SETTINGS.reasoningEffort,
      }),
      onStructuredStateChanged: async (sessionId) => {
        await this.emitStructuredStateSync(sessionId);
      },
      onHandlerAttention: async (event) => {
        return await this.resumeHandlerAfterWorkflowAttention(event, buildSystemPrompt("handler"));
      },
    });
  }

  private get threadSurfaceDir(): string {
    return join(this.sessionDir, "threads");
  }

  async dispose(): Promise<void> {
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

  async listSessions(): Promise<ListSessionsResponse> {
    const infos = await SessionManager.list(this.cwd, this.sessionDir);
    const summaries = new Map<string, WorkspaceSessionSummary>();

    for (const info of infos) {
      const orchestratorSurface = this.managedSurfaces.get(info.id);
      if (orchestratorSurface) {
        summaries.set(info.id, this.buildSummaryFromManagedSession(orchestratorSurface));
        continue;
      }

      summaries.set(info.id, this.buildSummaryFromSessionInfo(info));
    }

    for (const surface of this.managedSurfaces.values()) {
      if (surface.actorProfile !== "orchestrator" || summaries.has(surface.sessionId)) {
        continue;
      }
      summaries.set(surface.sessionId, this.buildSummaryFromManagedSession(surface));
    }

    return {
      sessions: Array.from(summaries.values()).toSorted(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    };
  }

  async getCommandInspector(input: {
    sessionId: string;
    commandId: string;
  }): Promise<WorkspaceCommandInspector> {
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
  ): Promise<ConversationSurfaceSnapshot> {
    const parentSessionFile = request.parentSessionId
      ? await this.getSessionFileForId(request.parentSessionId)
      : undefined;
    const sessionManager = SessionManager.create(this.cwd, this.sessionDir);
    if (parentSessionFile) {
      sessionManager.newSession({ parentSession: parentSessionFile });
    }
    sessionManager.appendSessionInfo(request.title?.trim() || "New Session");

    const session = await this.createManagedSurfaceRecord({
      sessionManager,
      actorProfile: "orchestrator",
      provider: defaults.provider,
      model: defaults.model,
      thinkingLevel: defaults.thinkingLevel,
      systemPrompt: buildSystemPrompt("orchestrator"),
    });
    const target = this.buildOrchestratorPromptTarget(session.sessionId);
    session.retainCount += 1;
    this.syncStructuredPiSessionFromOrchestratorSession(session);
    this.persistManagedSessionSnapshot(session);
    await this.emitWorkspaceSync("workspace.updated");
    return this.buildSurfaceSnapshot(session, target);
  }

  async openSession(
    sessionId: string,
    systemPrompt?: string,
  ): Promise<ConversationSurfaceSnapshot> {
    return this.openSurface(
      this.buildOrchestratorPromptTarget(sessionId),
      systemPrompt ?? buildSystemPrompt("orchestrator"),
    );
  }

  async openSurface(
    target: PromptTarget,
    systemPrompt?: string,
  ): Promise<ConversationSurfaceSnapshot> {
    this.assertValidPromptTarget(target);
    const session = await this.retainManagedSurface(
      target,
      systemPrompt ?? buildSystemPrompt(getActorProfileForTarget(target)),
    );
    await this.restoreWorkflowSupervisionIfTracked(target.workspaceSessionId);
    return this.buildSurfaceSnapshot(session, target);
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

    const activeOrchestrator = this.managedSurfaces.get(sessionId) ?? null;

    if (activeOrchestrator) {
      activeOrchestrator.session.sessionManager.appendSessionInfo(trimmedTitle);
    } else {
      const sessionFile = await this.getSessionFileForId(sessionId);
      SessionManager.open(sessionFile!, this.sessionDir).appendSessionInfo(trimmedTitle);
    }
    await this.syncStructuredPiSessionFromWorkspaceSession(sessionId);
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
            systemPrompt: activeOrchestrator.systemPrompt,
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

    const session = await this.createManagedSurfaceRecord({
      sessionManager: forkedSessionManager,
      actorProfile: "orchestrator",
      systemPrompt: buildSystemPrompt("orchestrator"),
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
    if (managedSurfaces.some((surface) => surface.activePrompt)) {
      throw new Error("Cannot delete a session while one of its surfaces is streaming.");
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
      unlinkSync(sessionFile);
    }
    for (const thread of structuredSnapshot?.threads ?? []) {
      const threadSessionFile = await this.getSessionFileForId(thread.surfacePiSessionId, false);
      if (threadSessionFile && existsSync(threadSessionFile)) {
        unlinkSync(threadSessionFile);
      }
    }
    await this.emitWorkspaceSync("workspace.updated");
    return { ok: true };
  }

  async sendPrompt(options: SendAgentPromptOptions): Promise<{ target: PromptTarget }> {
    this.assertValidPromptTarget(options.target);
    const session = await this.ensureManagedSurfaceForPrompt(options);
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
      target: structuredClone(options.target),
    };
  }

  async cancelPrompt(target: PromptTarget): Promise<void> {
    const session = this.managedSurfaces.get(target.surfacePiSessionId);
    if (!session?.activePrompt) {
      return;
    }

    session.abortRequested = true;
    await session.session.abort();
  }

  async setSurfaceModel(
    target: PromptTarget,
    model: string,
  ): Promise<{ ok: boolean; target: PromptTarget }> {
    const session = this.managedSurfaces.get(target.surfacePiSessionId);
    if (!session) {
      return { ok: false, target: structuredClone(target) };
    }

    session.model = model;
    session.recreateOnNextPrompt = true;

    if (session.activePrompt) {
      return { ok: true, target: structuredClone(target) };
    }

    try {
      syncAuthStorage(session.authStorage);
      const resolvedModel = resolveRegisteredModel(session.modelRegistry, session.provider, model);
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

    if (session.activePrompt) {
      session.recreateOnNextPrompt = true;
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

  private async ensureManagedSurfaceForPrompt(
    options: SendAgentPromptOptions,
  ): Promise<ManagedSession> {
    const actorProfile = getActorProfileForTarget(options.target);
    const session = await this.loadManagedSurface(
      options.target.surfacePiSessionId,
      actorProfile,
      buildSystemPrompt(actorProfile),
    );
    await this.restoreWorkflowSupervisionIfTracked(options.target.workspaceSessionId);
    return this.prepareManagedSession(session, options);
  }

  private async retainManagedSurface(
    target: PromptTarget,
    systemPrompt: string,
  ): Promise<ManagedSession> {
    const session = await this.loadManagedSurface(
      target.surfacePiSessionId,
      getActorProfileForTarget(target),
      systemPrompt,
    );
    session.retainCount += 1;
    return session;
  }

  private async loadManagedSurface(
    surfacePiSessionId: string,
    actorProfile: SvvyActorProfile,
    systemPrompt = buildSystemPrompt(actorProfile),
  ): Promise<ManagedSession> {
    const existing = this.managedSurfaces.get(surfacePiSessionId);
    if (existing) {
      if (existing.actorProfile === actorProfile && existing.systemPrompt === systemPrompt) {
        return existing;
      }
      return this.recreateManagedSurface(existing, {
        actorProfile,
        systemPrompt,
      });
    }

    const sessionFile = await this.getSessionFileForId(surfacePiSessionId);
    return this.createManagedSurfaceRecord({
      sessionManager: SessionManager.open(sessionFile!, dirname(sessionFile!)),
      actorProfile,
      systemPrompt,
    });
  }

  private async releaseManagedSurface(surfacePiSessionId: string): Promise<void> {
    const session = this.managedSurfaces.get(surfacePiSessionId);
    if (!session) {
      return;
    }

    session.retainCount = Math.max(0, session.retainCount - 1);
    await this.disposeManagedSurfaceIfUnused(session);
  }

  private async prepareManagedSession(
    session: ManagedSession,
    options: Pick<
      SendAgentPromptOptions,
      "provider" | "model" | "thinkingLevel" | "systemPrompt" | "messages" | "target"
    >,
  ): Promise<ManagedSession> {
    const actorProfile = getActorProfileForTarget(options.target);
    const resolvedSystemPrompt = buildSystemPrompt(actorProfile);
    if (actorProfile === "handler") {
      await this.smithersRuntimeManager.refreshWorkflowRegistry();
    }
    const currentSmithersToolSurfaceVersion =
      actorProfile === "handler"
        ? this.smithersRuntimeManager.getWorkflowToolSurfaceVersion()
        : null;

    if (
      session.actorProfile !== actorProfile ||
      session.provider !== options.provider ||
      session.model !== options.model ||
      session.recreateOnNextPrompt ||
      session.smithersToolSurfaceVersion !== currentSmithersToolSurfaceVersion
    ) {
      return this.recreateManagedSurface(session, {
        actorProfile,
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

    if (session.systemPrompt !== resolvedSystemPrompt) {
      return this.recreateManagedSurface(session, {
        actorProfile,
        systemPrompt: resolvedSystemPrompt,
      });
    }

    if (
      session.promptSyncCursor.messageCount > 0 &&
      !canAppendLatestUserTurn(session.promptSyncCursor, options.messages)
    ) {
      return this.recreateManagedSurface(session, {
        actorProfile,
        systemPrompt: resolvedSystemPrompt,
      });
    }

    return session;
  }

  private async recreateManagedSurface(
    session: ManagedSession,
    overrides: Partial<
      Pick<ManagedSession, "actorProfile" | "provider" | "model" | "thinkingLevel" | "systemPrompt">
    >,
  ): Promise<ManagedSession> {
    const sessionManager = session.session.sessionManager;
    const actorProfile = overrides.actorProfile ?? session.actorProfile;
    const provider = overrides.provider ?? session.provider;
    const model = overrides.model ?? session.model;
    const thinkingLevel = overrides.thinkingLevel ?? session.thinkingLevel;
    const systemPrompt = overrides.systemPrompt ?? session.systemPrompt;

    session.session.dispose();
    const nextSession = await createManagedSession({
      sessionManager,
      actorProfile,
      provider,
      model,
      thinkingLevel,
      systemPrompt,
      agentDir: this.agentDir,
      structuredSessionStore: this.structuredSessionStore,
      createHandlerThread: this.createHandlerThread.bind(this),
      smithersRuntimeManager: this.smithersRuntimeManager,
    });
    nextSession.retainCount = session.retainCount;
    this.managedSurfaces.set(nextSession.sessionId, nextSession);
    return nextSession;
  }

  private async createManagedSurfaceRecord(
    options: CreateManagedSessionOptions,
  ): Promise<ManagedSession> {
    const session = await createManagedSession({
      ...options,
      agentDir: this.agentDir,
      structuredSessionStore: this.structuredSessionStore,
      createHandlerThread: this.createHandlerThread.bind(this),
      smithersRuntimeManager: this.smithersRuntimeManager,
    });
    this.managedSurfaces.set(session.sessionId, session);
    return session;
  }

  private async disposeManagedSurfaceIfUnused(session: ManagedSession): Promise<void> {
    if (session.retainCount > 0 || session.activePrompt) {
      return;
    }
    session.session.dispose();
    this.managedSurfaces.delete(session.sessionId);
    await this.emitSurfaceClosed(this.resolvePromptTargetForSurfacePiSessionId(session.sessionId));
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

  private buildSummaryFromManagedSession(session: ManagedSession): WorkspaceSessionSummary {
    return this.decorateSummaryWithStructuredProjection(
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
  ): Promise<ConversationSurfaceSnapshot> {
    return {
      target: structuredClone(target),
      provider: session.provider,
      model: session.model,
      reasoningEffort: session.thinkingLevel,
      systemPrompt: session.systemPrompt,
      resolvedSystemPrompt: getResolvedSystemPrompt(session),
      messages: structuredClone(session.session.agent.state.messages),
      promptStatus: session.activePrompt ? "streaming" : "idle",
    };
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
        reason: input.reason,
        target: structuredClone(input.target),
        snapshot: await this.buildSurfaceSnapshot(input.session, input.target),
      });
    } catch (error) {
      console.error("Failed to emit surface sync payload:", error);
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
    if (!this.workspaceSyncListener) {
      return;
    }

    try {
      this.workspaceSyncListener({
        reason,
        sessions: (await this.listSessions()).sessions,
      });
    } catch (error) {
      console.error("Failed to emit workspace sync payload:", error);
    }
  }

  private async emitSurfaceClosed(target: PromptTarget): Promise<void> {
    if (!this.surfaceSyncListener) {
      return;
    }
    this.surfaceSyncListener({
      reason: "surface.closed",
      target: structuredClone(target),
    });
  }

  private async restoreWorkflowSupervisionIfTracked(sessionId: string): Promise<void> {
    if (!this.getStructuredSnapshot(sessionId)) {
      return;
    }
    await this.smithersRuntimeManager.restoreSessionSupervision(sessionId, {
      emitAttention: false,
    });
  }

  private buildOrchestratorPromptTarget(workspaceSessionId: string): PromptTarget {
    return {
      workspaceSessionId,
      surface: "orchestrator",
      surfacePiSessionId: workspaceSessionId,
    };
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

  private buildSummaryFromSessionInfo(info: WorkspaceSessionInfo): WorkspaceSessionSummary {
    return this.decorateSummaryWithStructuredProjection(this.projectSummaryFromSessionInfo(info));
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
    try {
      const snapshot = this.getStructuredSnapshot(summary.id);
      this.structuredSessionStore.upsertPiSession({
        sessionId: summary.id,
        title: summary.title,
        provider: summary.provider ?? snapshot?.pi.provider,
        model: summary.modelId ?? snapshot?.pi.model,
        reasoningEffort: summary.thinkingLevel ?? snapshot?.pi.reasoningEffort,
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
    this.syncStructuredPiSessionFromSummary(this.buildLiveSummaryFromManagedSession(session));
  }

  private async syncStructuredPiSessionFromWorkspaceSession(
    workspaceSessionId: string,
  ): Promise<void> {
    const orchestratorSurface = this.managedSurfaces.get(workspaceSessionId);
    if (orchestratorSurface) {
      this.syncStructuredPiSessionFromOrchestratorSession(orchestratorSurface);
      return;
    }

    const infos = await SessionManager.list(this.cwd, this.sessionDir);
    const info = infos.find((candidate) => candidate.id === workspaceSessionId);
    if (info) {
      this.syncStructuredPiSessionFromSummary(this.projectSummaryFromSessionInfo(info));
      return;
    }

    const snapshot = this.getStructuredSnapshot(workspaceSessionId);
    if (snapshot) {
      this.syncStructuredPiSessionFromSummary(this.projectSummaryFromStructuredSnapshot(snapshot));
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
  ): WorkspaceSessionSummary {
    const snapshot = this.getStructuredSnapshot(summary.id);
    if (!snapshot) {
      return summary;
    }

    if (!hasStructuredSessionFacts(snapshot)) {
      return summary;
    }

    const structuredSummary = buildStructuredSessionSummaryProjection(snapshot);
    const view = buildStructuredSessionView(snapshot);

    return {
      ...summary,
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
      commandRollups: view.commandRollups.length > 0 ? view.commandRollups : undefined,
    };
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

        const promptText = buildPromptText(session, options.messages, promptContext);
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
          !promptContext.suppressPendingWorkflowAttentionDelivery
        ) {
          await this.smithersRuntimeManager.deliverPendingHandlerAttention(
            promptContext.sessionId,
            promptContext.rootThreadId ?? undefined,
          );
        }
        await this.disposeManagedSurfaceIfUnused(session);
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
    if (!turn || turn.turnDecision !== "thread.handoff" || turn.status !== "completed") {
      return;
    }

    const thread = promptContext.rootThreadId
      ? (snapshot.threads.find((entry) => entry.id === promptContext.rootThreadId) ?? null)
      : null;
    const latestEpisode = thread ? getLatestThreadEpisode(snapshot, thread.id) : null;
    if (!thread || !latestEpisode) {
      return;
    }

    const orchestratorSessionId = snapshot.session.orchestratorPiSessionId;
    const target = this.buildOrchestratorPromptTarget(orchestratorSessionId);
    const orchestratorSession = await this.retainManagedSurface(target, systemPrompt);
    if (orchestratorSession.activePrompt) {
      await this.releaseManagedSurface(target.surfacePiSessionId);
      return;
    }

    try {
      orchestratorSession.abortRequested = false;
      orchestratorSession.activePrompt = true;
      await this.emitSurfaceSync({
        session: orchestratorSession,
        reason: "background.started",
        target,
      });

      const resumeMessage = createSyntheticUserMessage(
        buildOrchestratorHandoffResumePrompt(thread, latestEpisode),
      );
      const options: SendAgentPromptOptions = {
        target,
        provider: orchestratorSession.provider,
        model: orchestratorSession.model,
        thinkingLevel: orchestratorSession.thinkingLevel,
        systemPrompt: orchestratorSession.systemPrompt,
        messages: [
          ...convertToLlmMessages(orchestratorSession.session.agent.state.messages),
          resumeMessage,
        ],
        onEvent: () => {},
      };
      const orchestratorPromptContext = this.createPromptExecutionContext(
        orchestratorSession,
        options,
      );
      await this.runAgentPrompt(orchestratorSession, options, orchestratorPromptContext);
    } finally {
      await this.releaseManagedSurface(target.surfacePiSessionId);
    }
  }

  private async resumeHandlerAfterWorkflowAttention(
    input: {
      sessionId: string;
      threadId: string;
      workflowRunId: string;
      smithersRunId: string;
      workflowId: string;
      summary: string;
      reason: string;
    },
    systemPrompt: string,
  ): Promise<boolean> {
    const snapshot = this.getStructuredSnapshot(input.sessionId);
    const thread = snapshot?.threads.find((entry) => entry.id === input.threadId) ?? null;
    if (!snapshot || !thread) {
      return false;
    }

    const target: PromptTarget = {
      workspaceSessionId: input.sessionId,
      surface: "thread",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
    };
    const handlerSession = await this.retainManagedSurface(target, systemPrompt);
    if (handlerSession.activePrompt) {
      await this.releaseManagedSurface(target.surfacePiSessionId);
      return false;
    }

    try {
      handlerSession.abortRequested = false;
      handlerSession.activePrompt = true;
      await this.emitSurfaceSync({
        session: handlerSession,
        reason: "background.started",
        target,
      });

      const resumeMessage = createSyntheticUserMessage(
        buildHandlerWorkflowAttentionPrompt({
          thread,
          workflowRun:
            snapshot.workflowRuns.find((workflowRun) => workflowRun.id === input.workflowRunId) ??
            null,
          reason: input.reason,
          summary: input.summary,
          workflowId: input.workflowId,
          smithersRunId: input.smithersRunId,
        }),
      );
      const options: SendAgentPromptOptions = {
        target,
        provider: handlerSession.provider,
        model: handlerSession.model,
        thinkingLevel: handlerSession.thinkingLevel,
        systemPrompt: handlerSession.systemPrompt,
        messages: [
          ...convertToLlmMessages(handlerSession.session.agent.state.messages),
          resumeMessage,
        ],
        onEvent: () => {},
      };
      const handlerPromptContext = this.createPromptExecutionContext(handlerSession, options);
      if (handlerPromptContext) {
        handlerPromptContext.suppressPendingWorkflowAttentionDelivery = true;
      }
      await this.runAgentPrompt(handlerSession, options, handlerPromptContext);
      return true;
    } finally {
      await this.releaseManagedSurface(target.surfacePiSessionId);
    }
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
      resolveRegisteredModel(
        session.modelRegistry,
        restoredDefaults.provider,
        restoredDefaults.model,
      );

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
    smithersRuntimeManager: SmithersRuntimeManager;
  },
): Promise<ManagedSession> {
  mkdirSync(options.agentDir, { recursive: true });

  if (options.actorProfile === "handler") {
    await options.smithersRuntimeManager.refreshWorkflowRegistry();
  }

  const authStorage = AuthStorage.inMemory();
  syncAuthStorage(authStorage);
  const promptExecutionRuntime: PromptExecutionRuntimeHandle = {
    current: null,
  };
  const executeTypescriptTool = createExecuteTypescriptTool({
    cwd: options.sessionManager.getCwd(),
    runtime: promptExecutionRuntime,
    store: options.structuredSessionStore,
  });
  const waitTool = createWaitTool({
    runtime: promptExecutionRuntime,
    store: options.structuredSessionStore,
  });
  const tools =
    options.actorProfile === "orchestrator"
      ? ([
          executeTypescriptTool,
          createStartThreadTool({
            runtime: promptExecutionRuntime,
            store: options.structuredSessionStore,
            bridge: {
              createHandlerThread: options.createHandlerThread,
            },
          }),
          waitTool,
        ] as const)
      : ([
          executeTypescriptTool,
          createThreadHandoffTool({
            runtime: promptExecutionRuntime,
            store: options.structuredSessionStore,
          }),
          ...createSmithersTools({
            runtime: promptExecutionRuntime,
            store: options.structuredSessionStore,
            manager: options.smithersRuntimeManager,
          }),
          waitTool,
        ] as const);
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
  });
  await resourceLoader.reload();
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
    tools: [],
    customTools,
    resourceLoader,
  });
  const activeModel = session.agent.state.model ?? resolvedModel;
  const smithersToolSurfaceVersion =
    options.actorProfile === "handler"
      ? options.smithersRuntimeManager.getWorkflowToolSurfaceVersion()
      : null;

  return {
    sessionId: session.sessionManager.getSessionId(),
    actorProfile: options.actorProfile,
    provider: activeModel.provider,
    model: activeModel.id,
    thinkingLevel: restoredDefaults.thinkingLevel,
    systemPrompt: options.systemPrompt,
    smithersToolSurfaceVersion,
    promptSyncCursor: createPromptSyncCursor(convertToLlmMessages(session.agent.state.messages)),
    session,
    authStorage,
    modelRegistry,
    activePrompt: false,
    recreateOnNextPrompt: false,
    abortRequested: false,
    retainCount: 0,
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

function getResolvedSystemPrompt(session: ManagedSession): string {
  const resolved = session.session.agent.state.systemPrompt?.trim();
  return resolved && resolved.length > 0 ? resolved : session.systemPrompt;
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

function buildHandlerWorkflowAttentionPrompt(input: {
  thread: StructuredSessionSnapshot["threads"][number];
  workflowRun: StructuredSessionSnapshot["workflowRuns"][number] | null;
  reason: string;
  summary: string;
  workflowId: string;
  smithersRunId: string;
}): string {
  return [
    "System event: A supervised Smithers workflow now requires handler attention.",
    `Thread id: ${input.thread.id}`,
    `Thread title: ${input.thread.title}`,
    `Objective: ${input.thread.objective}`,
    `Workflow entry id: ${input.workflowId}`,
    `Smithers run id: ${input.smithersRunId}`,
    `Attention reason: ${input.reason}`,
    `Current workflow summary: ${input.summary}`,
    "Inspect durable workflow state with smithers.* tools and decide the next handler action.",
  ].join("\n");
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

      const latestWorkflow = resolveLatestWorkflowRunForThread(snapshot, thread.id);

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

  const latestWorkflow = resolveLatestWorkflowRunForThread(snapshot, thread.id);
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
    "Workflow waits, approvals, and resumes stay inside this thread. Do not call thread.handoff while this thread still owns a running or waiting workflow run.",
    "Ordinary replies, clarification, and follow-up chat should stay inside this thread.",
  ];

  if (thread.wait) {
    parts.push(
      `Current wait: ${thread.wait.kind} - ${collapsePromptContextValue(thread.wait.reason, 220)}`,
    );
  }

  if (latestWorkflow) {
    parts.push(
      `Latest workflow summary: ${collapsePromptContextValue(latestWorkflow.summary, 220)}`,
    );
  }

  if (latestEpisode) {
    parts.push(`Latest handoff summary: ${collapsePromptContextValue(latestEpisode.summary, 220)}`);
  }

  return parts.join("\n");
}

function resolveLatestWorkflowRunForThread(
  snapshot: StructuredSessionSnapshot,
  threadId: string,
): StructuredSessionSnapshot["workflowRuns"][number] | null {
  const workflowRuns = snapshot.workflowRuns.filter(
    (workflowRun) => workflowRun.threadId === threadId,
  );
  if (workflowRuns.length === 0) {
    return null;
  }

  const workflowRunsById = new Map(
    workflowRuns.map((workflowRun) => [workflowRun.id, workflowRun]),
  );
  let current =
    workflowRuns.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ??
    null;
  while (current?.status === "continued" && current.activeDescendantRunId) {
    const descendant = workflowRunsById.get(current.activeDescendantRunId);
    if (!descendant) {
      break;
    }
    current = descendant;
  }

  return current;
}

function getActorProfileForTarget(target: PromptTarget): SvvyActorProfile {
  return target.surface === "thread" ? "handler" : "orchestrator";
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

function resolveRegisteredModel(modelRegistry: ModelRegistry, provider: string, model: string) {
  return (
    modelRegistry.find(provider, model) ??
    getModel(provider as Parameters<typeof getModel>[0], model as Parameters<typeof getModel>[1])
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
  promptContext?: PromptExecutionContext | null,
): string {
  const durableSurfaceContext = promptContext?.durableSurfaceContext?.trim() || undefined;
  if (!durableSurfaceContext && !canAppendLatestUserTurn(session.promptSyncCursor, messages)) {
    return buildTranscript(messages);
  }

  if (durableSurfaceContext && !canAppendLatestUserTurn(session.promptSyncCursor, messages)) {
    return buildTranscript(messages, durableSurfaceContext);
  }

  const nextMessage = messages[session.promptSyncCursor.messageCount];
  if (!nextMessage || nextMessage.role !== "user") {
    return buildTranscript(messages, durableSurfaceContext);
  }

  if (!durableSurfaceContext) {
    return messageToPlainText(nextMessage);
  }

  return buildTranscript([nextMessage], durableSurfaceContext);
}

function buildTranscript(messages: Message[], durableSurfaceContext?: string): string {
  const parts: string[] = [];

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
