import { spawnSync } from "node:child_process";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import {
  getModel,
  getProviders,
  getSupportedThinkingLevels,
  type AssistantMessage,
  type Message,
} from "@mariozechner/pi-ai";
import {
  SessionManager,
  type AgentSession,
  type AuthStorage,
  type ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import {
  unsafeDecodeRuntimeSubmittedMessageSyncForTestsAndBootstrap,
  decodeUnknownRequestUserInputAnswerQueuePayloadExit,
  unsafeDecodeRuntimeClientSubmissionInputSyncForTestsAndBootstrap,
  normalizeRuntimeClientSubmissionMetadata,
  type RuntimeClientSubmissionInput,
  RuntimeContractError,
  RuntimeToolExecutionError,
  runtimeClientSubmissionLogDetails,
  type AuthenticatedRunTaskAgentInput,
  type RunTaskAgentInput,
  type RunTaskAgentResult,
  summarizeRuntimePromptMessagesForTelemetry,
  type NativeToolResult,
  type PiToolExecutor,
  type EnqueueRuntimeSurfaceMessageInput,
  type GetRuntimeSurfaceMessageInput,
  type MarkRuntimeSurfaceMessageQueuedInput,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimeApprovalStatePortService,
  type RuntimeArtifactStatePortService,
  type RuntimeCommandStatePortService,
  type RuntimeEpisodeStatePortService,
  type RuntimeQueueStatePortService,
  type RuntimeReadModelStatePortService,
  type RuntimeRequestStatePortService,
  type RuntimeSessionWaitStatePortService,
  type RuntimeSourceStatePortService,
  type RuntimeSurfaceLifecycleStatePortService,
  type RuntimeSurfaceMessageRecord,
  type RuntimeThreadStatePortService,
  type RuntimeTurnStatePortService,
  type RuntimeWorkspaceStatePortService,
  type AgentProfileId as CoreAgentProfileId,
  type StateContractError,
  type RequestUserInputAnswerQueuePayload,
  type RuntimePromptTelemetryMessage,
  type RuntimeRecoveryStatePortService,
  type RuntimeExtensionContextImpactStateFacade,
  type ExtensionStatePortService,
  type RuntimeGeneratedPackageStatePortService,
  type GeneratedPackagesRefreshResult,
  type InternalRefreshGeneratedPackagesRequest,
  type BuildLaunchPolicyInput,
  type SandboxLaunchFacts,
  type RefreshGeneratedContextRequest,
  ProviderAuthPort,
  ProviderAuthPortError,
  PiRuntimePathsPort,
  type AbsolutePath,
  type ProviderAuthPortService,
  type PiRuntimePathsPortService,
  type SurfacePiSessionId,
  type TitleJobId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
  SandboxPolicySource,
  type SandboxPolicySourceService,
} from "@svvy/core";
import type {
  ComposerDraft,
  ConversationSurfaceSnapshot,
  ConversationTurnTiming,
  CreateSessionRequest,
  ForkSessionRequest,
  ListSessionsResponse,
  PromptTarget,
  PromptClientSubmissionMetadata,
  QueuedSurfaceMessage,
  SetExtensionContextAutoUpdateRequest,
  SurfaceMutationResponse,
  SurfaceSyncMessage,
  UpdateComposerDraftRequest,
  WorkspaceMutationResponse,
  WorkspaceArtifactPreview,
  RequestUserInputAnswerRequest,
  SetRequestUserInputTimerPausedRequest,
  WorkspaceSessionNavigationReadModel,
  WorkspaceSyncMessage,
  WorkspaceCommandInspector,
  WorkspaceHandlerThreadSummary,
  WorkspaceSessionSummary,
  WorkspaceWorkflowTaskAttemptInspector,
  AgentContextPreviewRequest,
  AgentContextPreviewExtension,
  AgentContextPreviewResponse,
} from "../shared/workspace-contract";
import type { GeneratedAgentContextExternalSource } from "../shared/generated-agent-context";
import { getGeneratedAgentContextContentKey } from "../shared/generated-agent-context";
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_ORCHESTRATOR_PROFILE_ID,
  DEFAULT_THREAD_HANDLER_PROFILE_ID,
  type AgentDefaults,
  type AgentSettingsState,
  type AppPreferences,
  type AgentProfileId,
  type AgentProfileSettings,
  type RequestUserInputSettings,
  type WorkflowAgentKey,
} from "../shared/agent-settings";
import {
  projectWorkspaceSessionSummary,
  projectWorkspaceSessionSummaryFromInfo,
} from "./session-projection";
import { defaultRuntimeLayerConfig, type RuntimeLayerConfig } from "@svvy/runtime/bootstrap";
import { type PromptExecutionRuntimeHandle } from "@svvy/runtime/prompt-execution-context";
import {
  createStructuredSessionStateStore,
  StructuredSessionState,
  type StructuredSessionSnapshot,
  type StructuredSessionStateStore,
  type StructuredSurfaceQueuedMessageRecord,
  structuredSessionStateFromStore,
} from "@svvy/state/structured-session-state";
import { layerSandboxPolicySource } from "@svvy/state";
import {
  buildStructuredCommandInspector,
  buildStructuredHandlerThreadSummaries,
  buildStructuredArtifactLink,
  buildStructuredSessionSummaryProjection,
  buildStructuredSessionView,
  buildStructuredWorkflowTaskAttemptInspector,
  hasStructuredSessionFacts,
} from "@svvy/state/structured-session-projections";
import { buildWorkspaceSessionNavigation } from "@svvy/state/session-navigation";
import {
  runtimeActorExtensionBindingStatePortFromStore,
  runtimeApprovalStatePortFromStore,
  runtimeArtifactStatePortFromStore,
  runtimeQueueStatePortFromStore,
  runtimeCommandStatePortFromStore,
  runtimeEpisodeStatePortFromStore,
  extensionStatePortFromStore,
  runtimeExtensionContextImpactStateFacadeFromStore,
  runtimeGeneratedPackageStatePortFromStore,
  runtimeReadModelStatePortFromStore,
  runtimeRecoveryStatePortFromStore,
  runtimeRequestStatePortFromStore,
  runtimeSessionWaitStatePortFromStore,
  runtimeSourceStatePortFromStore,
  runtimeSurfaceLifecycleStatePortFromStore,
  runtimeThreadStatePortFromStore,
  runtimeTurnStatePortFromStore,
  runtimeWorkspaceStatePortFromStore,
  type WorkspaceStateRegistration,
} from "@svvy/state/structured-session-adapters";
import type { AppLoggerEvent } from "./app-logger";
import { createExecuteTypescriptTool } from "./execute-typescript-tool";
import {
  createListExtensionsTool,
  createLoadExtensionTool,
  type RunAcceptedLoadExtension,
} from "./extension-tools";
import {
  createRequestUserInputTool,
  RequestUserInputRuntime,
  type RunAcceptedRequestUserInput,
} from "./request-user-input-tool";
import { getCredential, resolveApiKey, resolveAuthState } from "./auth-store";
import { getOAuthRefreshError, refreshIfNeeded, supportsOAuth } from "./oauth-login";
import { runtimeSubmittedMessagePromptText } from "@svvy/pi-adapter/messages";
import { PiAdapter, layer as PiAdapterLayer } from "@svvy/pi-adapter";
import { createPiManagedAgentSession } from "@svvy/pi-adapter/session";
import { countPromptTokens } from "./token-count";
import { createStartThreadTool } from "./thread-start-tool";
import { createThreadReportTool, type ThreadReportNotificationRequest } from "./thread-report-tool";
import {
  createThreadFollowupTool,
  createThreadRequestReportTool,
} from "./thread-orchestration-tools";
import { buildSystemPrompt } from "./default-system-prompt";
import { buildExecuteTypescriptApiDeclaration } from "./execute-typescript-api-declaration";
import { buildNativeToolSchemasJson } from "@svvy/extensions";
import {
  createExtensionContextFingerprints,
  createExternalInstructionsFingerprint,
  createGeneratedAgentContextAggregateCache,
  extensionsRootForAgentDir,
  type GeneratedAgentContextAggregateOutputs,
  type GeneratedAgentContextAggregateResult,
  GENERATED_AGENT_CONTEXT_AGGREGATE_FORMAT_VERSION,
} from "./generated-agent-context-aggregate-cache";
import type { SvvyActorKind } from "./actor-capabilities";
import { createAgentSettingsStore } from "./agent-settings-store";
import type { LiveCommandStdinRegistry } from "./live-command-stdin-registry";
import { createSvvyDirectTools, type runTaskAgentBridgeEnvProvider } from "./svvy-direct-tools";
import type { RuntimeApprovalBoundary } from "./approval-boundary";
import { resolveActorExtensionState, type ExtensionUsageState } from "@svvy/extensions";
import {
  resolveExtensionRecords,
  setExtensionUsage,
  type ResolvedExtensionRecord,
} from "./svvyx-extensions-command";
import { discoverExternalInstructionSources } from "./external-instructions";
import {
  createGeneratedAgentContextStore,
  type GeneratedAgentContextStore,
} from "./generated-agent-context-store";
import {
  createThreadCurrentTool,
  createThreadEpisodesTool,
  createThreadGroupTool,
  createThreadListTool,
} from "./runtime-state-tools";
import { WorkspaceRecoveryCoordinator } from "./workspace-recovery-coordinator";
import {
  createRunTaskAgentBridgeServer,
  RUN_TASK_AGENT_BRIDGE_ENV,
  RunTaskAgentBridgeError,
  type RunTaskAgentBridgeServer,
} from "./smithers-runtime/task-agent-bridge-server";

export const STRUCTURED_SESSION_DB_FILENAME = "structured-session-state-v5.sqlite";

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

export function normalizePromptClientSubmissionMetadata(
  metadata: PromptClientSubmissionMetadata | undefined,
): PromptClientSubmissionMetadata | undefined {
  return normalizeRuntimeClientSubmissionMetadata(metadata);
}

/**
 * Decode renderer-side prompt client submission metadata (plain-string telemetry
 * shape) into the runtime-facing `RuntimeClientSubmissionInput` (branded) shape at
 * the app/bootstrap trusted boundary. The renderer RPC contract carries the plain
 * metadata; runtime facade inputs require the branded input contract.
 */
export function decodePromptClientSubmissionToRuntimeInput(
  metadata: PromptClientSubmissionMetadata | undefined,
): RuntimeClientSubmissionInput | undefined {
  if (!metadata) {
    return undefined;
  }
  return unsafeDecodeRuntimeClientSubmissionInputSyncForTestsAndBootstrap(metadata);
}

export function promptClientSubmissionLogDetails(
  metadata: PromptClientSubmissionMetadata | undefined,
): Record<string, unknown> {
  return runtimeClientSubmissionLogDetails(metadata);
}

export function summarizePromptMessagesForTelemetry(messages: readonly Message[]): {
  messageCount: number;
  userMessageCount: number;
  textBlockCount: number;
  imageCount: number;
} {
  return summarizeRuntimePromptMessagesForTelemetry(
    messages as readonly RuntimePromptTelemetryMessage[],
  );
}

type ManagedActorKind = SvvyActorKind | "namer";

interface ManagedSession {
  sessionId: string;
  actorKind: ManagedActorKind;
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  agentProfileId: AgentProfileId;
  systemPrompt: string;
  generatedAgentContextAggregateKey: string;
  generatedAgentContextAggregate: GeneratedAgentContextAggregateOutputs;
  generatedAgentContextFingerprint: string;
  generatedAgentContextRevision: number;
  externalContextSources: GeneratedAgentContextExternalSource[];
  externalSourceHashes: string[];
  loadedExtensionIds: string[];
  availableExtensionIds: string[];
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

export interface SendAgentPromptResult {
  target: PromptTarget;
  queued?: boolean;
  queuedMessageId?: string;
  dispatched?: boolean;
  snapshot?: ConversationSurfaceSnapshot;
}

export interface EditCommittedUserMessageOptions {
  target: PromptTarget;
  messageTimestamp: string | number;
  message: Message;
}

interface ThreadReportNotificationQueuePayload {
  threadId: string;
  sourceCommandId: string;
  turnId: string;
  summary: string;
  episodeId: string;
  outcome: "succeeded" | "failed" | "cancelled" | null;
}

interface InitialHandlerStartQueuePayload {
  threadId: string;
  parentSessionFile: string | null;
  requestedAt: string;
}

interface ReportRequestQueuePayload {
  threadId: string;
  sourceCommandId: string;
  request: string;
}

interface ThreadFollowupQueuePayload {
  threadId: string;
  sourceCommandId: string;
  message: string;
  activate: boolean;
}

interface CreateManagedSessionOptions {
  sessionManager: SessionManager;
  workspaceId?: string;
  actorKind: ManagedActorKind;
  provider?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  systemPrompt: string;
  generatedAgentContextAggregateKey?: string;
  generatedAgentContextAggregate?: GeneratedAgentContextAggregateOutputs;
  generatedAgentContextFingerprint?: string;
  generatedAgentContextRevision?: number;
  agentProfileId?: AgentProfileId;
  loadedExtensionIds?: readonly string[];
  availableExtensionIds?: readonly string[];
  externalContextSources?: readonly GeneratedAgentContextExternalSource[];
  externalSourceHashes?: readonly string[];
  refreshGeneratedContext?: (input: RefreshGeneratedContextRequest) => Promise<void>;
  onRequestContextLoaded?: (surfacePiSessionId: string) => void;
  onWorkflowsGeneratedPackageChanged?: (
    event: WorkflowsGeneratedPackageLogEvent,
  ) => void | Promise<void>;
  onAppLog?: (event: AppLoggerEvent) => void;
  runTaskAgentBridge?: runTaskAgentBridgeEnvProvider;
  requestUserInputRuntime?: RequestUserInputRuntime;
  runtimeCommandStdin?: LiveCommandStdinRegistry;
  openArtifact?: (input: { sessionId: string; artifactId: string }) => boolean | Promise<boolean>;
  approvalBoundary?: RuntimeApprovalBoundary;
  extensionsRoot?: string;
  managedSandbox?: boolean | (() => boolean);
  acquireExecuteTypescriptLaunch?: (input: Omit<BuildLaunchPolicyInput, "launchKind">) => Promise<{
    facts: SandboxLaunchFacts;
    close(): Promise<void>;
  }>;
  acquireDirectToolLaunch?: (
    input: Omit<BuildLaunchPolicyInput, "launchKind"> & {
      toolName: "exec_command" | "apply_patch" | "execute_typescript";
    },
  ) => Promise<{
    facts: SandboxLaunchFacts;
    close(): Promise<void>;
  }>;
  runAcceptedRequestUserInput?: RunAcceptedRequestUserInput;
  runAcceptedLoadExtension?: RunAcceptedLoadExtension;
  requestDirectToolApproval?: RuntimeApprovalBoundary;
  workflowsExtensionsGeneratedPackagePath?: string;
  workflowsGeneratedPackagePath?: string;
  workflowsSourceRoot?: string;
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

export type WorkflowsGeneratedPackageLogEvent = {
  reason: "svvyx-workflows-build" | "svvyx-workflows-save";
  commandFacts: Record<string, unknown>;
};

type WorkspaceRecoveryOptions = {
  workflowsExtensionsGeneratedPackagePath?: string;
  workflowsGeneratedPackagePath?: string;
  workflowsSourceRoot?: string;
  acquireExecuteTypescriptLaunch?: (input: Omit<BuildLaunchPolicyInput, "launchKind">) => Promise<{
    facts: SandboxLaunchFacts;
    close(): Promise<void>;
  }>;
  acquireDirectToolLaunch?: (
    input: Omit<BuildLaunchPolicyInput, "launchKind"> & {
      toolName: "exec_command" | "apply_patch" | "execute_typescript";
    },
  ) => Promise<{
    facts: SandboxLaunchFacts;
    close(): Promise<void>;
  }>;
  refreshGeneratedPackages?: (
    input: InternalRefreshGeneratedPackagesRequest,
  ) => Promise<GeneratedPackagesRefreshResult>;
  runAcceptedRequestUserInput?: RunAcceptedRequestUserInput;
  runTaskAgent?: (input: AuthenticatedRunTaskAgentInput) => Promise<RunTaskAgentResult>;
  runAcceptedLoadExtension?: RunAcceptedLoadExtension;
  requestDirectToolApproval?: RuntimeApprovalBoundary;
};

function requiredExecuteTypescriptLaunchAcquisition(
  acquireExecuteTypescriptLaunch: WorkspaceRecoveryOptions["acquireExecuteTypescriptLaunch"],
): NonNullable<WorkspaceRecoveryOptions["acquireExecuteTypescriptLaunch"]> {
  if (!acquireExecuteTypescriptLaunch) {
    return () => {
      throw new Error(
        "WorkspaceSessionCatalog requires runtime-owned execute_typescript launch acquisition.",
      );
    };
  }
  return acquireExecuteTypescriptLaunch;
}

const missingRuntimeApprovalBoundary: RuntimeApprovalBoundary = async () => ({
  approved: false,
  reason: "Runtime approval admission is not wired for this workspace runtime.",
});

function requiredAcceptedRequestUserInputRunner(
  runAcceptedRequestUserInput: WorkspaceRecoveryOptions["runAcceptedRequestUserInput"],
): RunAcceptedRequestUserInput {
  if (!runAcceptedRequestUserInput) {
    return () => {
      throw new Error(
        "WorkspaceSessionCatalog requires runtime-owned request_user_input execution.",
      );
    };
  }
  return runAcceptedRequestUserInput;
}

function requiredAcceptedLoadExtensionRunner(
  runAcceptedLoadExtension: WorkspaceRecoveryOptions["runAcceptedLoadExtension"],
): RunAcceptedLoadExtension {
  if (!runAcceptedLoadExtension) {
    return () => {
      throw new Error("WorkspaceSessionCatalog requires runtime-owned load_extension execution.");
    };
  }
  return runAcceptedLoadExtension;
}

type CatalogEffectRunner = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

const missingCatalogEffectRunner: CatalogEffectRunner = () => {
  throw new Error("WorkspaceSessionCatalog requires an app-bootstrap Effect runner.");
};

export class WorkspaceSessionCatalog {
  private readonly managedSurfaces = new Map<string, ManagedSession>();
  private readonly structuredSessionStore: StructuredSessionStateStore;
  private readonly runtimeActorExtensionBindingStatePort: RuntimeActorExtensionBindingStatePortService;
  private readonly runtimeApprovalStatePort: RuntimeApprovalStatePortService;
  private readonly runtimeArtifactStatePort: RuntimeArtifactStatePortService;
  private readonly runtimeCommandStatePort: RuntimeCommandStatePortService;
  private readonly runtimeEpisodeStatePort: RuntimeEpisodeStatePortService;
  private readonly runtimeGeneratedPackageStatePort: RuntimeGeneratedPackageStatePortService;
  private readonly runtimeQueueStatePort: RuntimeQueueStatePortService;
  private readonly runtimeReadModelStatePort: RuntimeReadModelStatePortService;
  private readonly runtimeRecoveryStatePort: RuntimeRecoveryStatePortService;
  private readonly runtimeRequestStatePort: RuntimeRequestStatePortService;
  private readonly runtimeSessionWaitStatePort: RuntimeSessionWaitStatePortService;
  private readonly runtimeSourceStatePort: RuntimeSourceStatePortService;
  private readonly runtimeSurfaceLifecycleStatePort: RuntimeSurfaceLifecycleStatePortService;
  private readonly runtimeThreadStatePort: RuntimeThreadStatePortService;
  private readonly runtimeTurnStatePort: RuntimeTurnStatePortService;
  private readonly runtimeWorkspaceStatePort: RuntimeWorkspaceStatePortService;
  private readonly runtimeExtensionContextImpactState: RuntimeExtensionContextImpactStateFacade;
  private readonly recoveryCoordinator: WorkspaceRecoveryCoordinator;
  private readonly agentSettingsStore: ReturnType<typeof createAgentSettingsStore>;
  private readonly generatedAgentContextStore: GeneratedAgentContextStore;
  private readonly generatedAgentContextAggregateCache: ReturnType<
    typeof createGeneratedAgentContextAggregateCache
  >;
  private readonly extensionsRoot: string;
  private readonly requestUserInputRuntime = new RequestUserInputRuntime();
  private readonly approvalBoundary: RuntimeApprovalBoundary;
  private closed = false;
  private workspaceSyncListener: ((payload: WorkspaceSyncMessage) => void) | null = null;
  private surfaceSyncListener: ((payload: SurfaceSyncMessage) => void) | null = null;
  private titleGenerationLogListener: ((event: TitleGenerationLogEvent) => void) | null = null;
  private workflowsGeneratedPackageLogListener:
    | ((event: WorkflowsGeneratedPackageLogEvent) => void)
    | null = null;
  private appLogListener: ((event: AppLoggerEvent) => void) | null = null;
  private readonly runTaskAgentBridge: RunTaskAgentBridgeServer;

  constructor(
    private readonly cwd: string,
    private readonly agentDir: string = getSvvyAgentDir(),
    private readonly sessionDir: string = getSvvySessionDir(cwd, agentDir),
    private readonly workspaceId: string = cwd,
    private readonly recoveryOptions: WorkspaceRecoveryOptions = {},
    approvalBoundary?: RuntimeApprovalBoundary,
    private readonly managedSandbox: boolean | (() => boolean) | undefined = undefined,
    private readonly runtimeCommandStdin: LiveCommandStdinRegistry | undefined = undefined,
    private readonly runCatalogEffect: CatalogEffectRunner = missingCatalogEffectRunner,
    private readonly runtimeLayerConfig: RuntimeLayerConfig = defaultRuntimeLayerConfig,
  ) {
    this.extensionsRoot = extensionsRootForAgentDir(this.agentDir);
    const workspaceLabel = basename(this.cwd) || "workspace";
    this.agentSettingsStore = createAgentSettingsStore({
      cwd: this.cwd,
      agentDir: this.agentDir,
      workflowsSourceRoot: this.recoveryOptions.workflowsSourceRoot,
    });
    this.structuredSessionStore = createStructuredSessionStateStore({
      digest: {
        sha256Hex: (data) => createHash("sha256").update(data).digest("hex"),
      },
      idFactory: (prefix) => `${prefix}-${randomUUID()}`,
      now: () => new Date().toISOString(),
      workspace: {
        id: this.workspaceId,
        label: workspaceLabel,
        cwd: this.cwd,
        artifactDir: resolveConfiguredArtifactDirectory(
          this.agentSettingsStore.getState().appPreferences.artifactDirectory,
          this.cwd,
        ),
      },
      databasePath: join(this.sessionDir, STRUCTURED_SESSION_DB_FILENAME),
    });
    this.runtimeActorExtensionBindingStatePort = runtimeActorExtensionBindingStatePortFromStore(
      this.structuredSessionStore,
    );
    this.runtimeExtensionContextImpactState = runtimeExtensionContextImpactStateFacadeFromStore(
      this.structuredSessionStore,
    );
    this.runtimeApprovalStatePort = runtimeApprovalStatePortFromStore(this.structuredSessionStore);
    this.runtimeArtifactStatePort = runtimeArtifactStatePortFromStore(this.structuredSessionStore);
    this.runtimeCommandStatePort = runtimeCommandStatePortFromStore(this.structuredSessionStore);
    this.runtimeEpisodeStatePort = runtimeEpisodeStatePortFromStore(this.structuredSessionStore);
    this.runtimeGeneratedPackageStatePort = runtimeGeneratedPackageStatePortFromStore(
      this.structuredSessionStore,
    );
    this.runtimeQueueStatePort = runtimeQueueStatePortFromStore(this.structuredSessionStore);
    this.runtimeReadModelStatePort = runtimeReadModelStatePortFromStore(
      this.structuredSessionStore,
    );
    this.runtimeRecoveryStatePort = runtimeRecoveryStatePortFromStore(this.structuredSessionStore);
    this.runtimeRequestStatePort = runtimeRequestStatePortFromStore(this.structuredSessionStore);
    this.runtimeSessionWaitStatePort = runtimeSessionWaitStatePortFromStore(
      this.structuredSessionStore,
    );
    this.runtimeSourceStatePort = runtimeSourceStatePortFromStore(this.structuredSessionStore);
    this.runtimeSurfaceLifecycleStatePort = runtimeSurfaceLifecycleStatePortFromStore(
      this.structuredSessionStore,
    );
    this.runtimeThreadStatePort = runtimeThreadStatePortFromStore(this.structuredSessionStore);
    this.runtimeTurnStatePort = runtimeTurnStatePortFromStore(this.structuredSessionStore);
    this.runtimeWorkspaceStatePort = runtimeWorkspaceStatePortFromStore(
      this.structuredSessionStore,
    );
    this.approvalBoundary =
      approvalBoundary ??
      this.recoveryOptions.requestDirectToolApproval ??
      missingRuntimeApprovalBoundary;
    this.runTaskAgentBridge = createRunTaskAgentBridgeServer({
      authorize: (request, bearerToken) =>
        this.isValidRunTaskAgentBridgeToken({
          bearerToken,
          sourceCommandId: request.sourceCommandId,
          workspaceSessionId: request.workspaceSessionId,
        }),
      maxRequestBytes: this.runtimeLayerConfig.workflowTaskAgentBridgeMaxRequestBytes,
      runTaskAgent: (request, bearerToken) => this.runRunTaskAgentInput(request, bearerToken),
    });
    this.requestUserInputRuntime.setSettings(this.agentSettingsStore.getState().requestUserInput);
    this.generatedAgentContextStore = createGeneratedAgentContextStore({
      agentDir: this.sessionDir,
    });
    this.generatedAgentContextAggregateCache = createGeneratedAgentContextAggregateCache({
      extensionsRoot: this.extensionsRoot,
    });
    this.generatedAgentContextStore.getState();
    this.recoveryCoordinator = new WorkspaceRecoveryCoordinator(
      this.workspaceId as WorkspaceId,
      this.runtimeRecoveryStatePort,
      {
        recoverSurfaceTurn: async (surfacePiSessionId) => {
          this.recoverInterruptedSurfaceTurn(surfacePiSessionId);
        },
        drainSurfaceQueue: async () => {},
        generateTitle: async (owner) => {
          if (owner.sessionId) {
            await this.runQueuedTitleGeneration(owner.sessionId);
            return;
          }
          if (owner.threadId) {
            await this.runThreadTitleGenerationJob(owner.threadId);
          }
        },
        refreshGeneratedPackages: async (input) => {
          await this.refreshWorkspaceGeneratedPackageLinks(input);
        },
        resolveSurfaceTarget: (surfacePiSessionId) =>
          this.resolvePromptTargetForSurfacePiSessionId(surfacePiSessionId),
      },
      this.runRuntimeState.bind(this),
    );
    if (this.recoveryOptions.refreshGeneratedPackages) {
      this.recoveryCoordinator.enqueue({
        kind: "workspace_generated_package_link_repair",
        ownerScope: { kind: "workspace" },
        idempotencyKey: `workspace_generated_package_link_repair:${this.workspaceId}`,
        orderingKey: `workspace:${this.workspaceId}`,
        priority: 5,
        payloadJson: {
          refreshGeneratedPackages: {
            scope: "workspace-link-repair",
            workspaceId: this.workspaceId,
            packages: ["@svvyx/extensions", "@svvyx/workflows"],
            reason: "startup-recovery",
          },
        },
      });
    }
    this.recoveryCoordinator.seedFromDurableState();
    this.recoveryCoordinator.start();
  }

  private get threadSurfaceDir(): string {
    return join(this.sessionDir, "threads");
  }

  private get workflowTaskSurfaceDir(): string {
    return join(this.sessionDir, "workflow-tasks");
  }

  async dispose(): Promise<void> {
    this.closed = true;
    this.recoveryCoordinator.close();
    await this.runTaskAgentBridge.close();
    for (const session of this.managedSurfaces.values()) {
      session.session.dispose();
    }
    this.managedSurfaces.clear();
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

  setWorkflowsGeneratedPackageLogListener(
    listener: ((event: WorkflowsGeneratedPackageLogEvent) => void) | null,
  ): void {
    this.workflowsGeneratedPackageLogListener = listener;
  }

  setAppLogListener(listener: ((event: AppLoggerEvent) => void) | null): void {
    this.appLogListener = listener;
  }

  getRuntimeExtensionContextImpactState(): RuntimeExtensionContextImpactStateFacade {
    return this.runtimeExtensionContextImpactState;
  }

  getExtensionStatePort(): ExtensionStatePortService {
    return extensionStatePortFromStore(this.structuredSessionStore);
  }

  workspaceStateRouterRegistration(): WorkspaceStateRegistration {
    return { store: this.structuredSessionStore };
  }

  getRuntimeQueueStatePort(): RuntimeQueueStatePortService {
    return this.runtimeQueueStatePort;
  }

  getRuntimeActorExtensionBindingStatePort(): RuntimeActorExtensionBindingStatePortService {
    return this.runtimeActorExtensionBindingStatePort;
  }

  getRuntimeApprovalStatePort(): RuntimeApprovalStatePortService {
    return this.runtimeApprovalStatePort;
  }

  getRuntimeCommandStatePort(): RuntimeCommandStatePortService {
    return this.runtimeCommandStatePort;
  }

  getRuntimeRequestStatePort(): RuntimeRequestStatePortService {
    return this.runtimeRequestStatePort;
  }

  getRuntimeSessionWaitStatePort(): RuntimeSessionWaitStatePortService {
    return this.runtimeSessionWaitStatePort;
  }

  getRuntimeThreadStatePort(): RuntimeThreadStatePortService {
    return this.runtimeThreadStatePort;
  }

  getRuntimeTurnStatePort(): RuntimeTurnStatePortService {
    return this.runtimeTurnStatePort;
  }

  getRuntimeEpisodeStatePort(): RuntimeEpisodeStatePortService {
    return this.runtimeEpisodeStatePort;
  }

  getRuntimeSourceStatePort(): RuntimeSourceStatePortService {
    return this.runtimeSourceStatePort;
  }

  getRuntimeSurfaceLifecycleStatePort(): RuntimeSurfaceLifecycleStatePortService {
    return this.runtimeSurfaceLifecycleStatePort;
  }

  getRuntimeWorkspaceStatePort(): RuntimeWorkspaceStatePortService {
    return this.runtimeWorkspaceStatePort;
  }

  getRuntimeGeneratedPackageStatePort(): RuntimeGeneratedPackageStatePortService {
    return this.runtimeGeneratedPackageStatePort;
  }

  getSandboxPolicySource(): SandboxPolicySourceService {
    return this.runRuntimeState(
      Effect.gen(function* () {
        return yield* SandboxPolicySource;
      }).pipe(
        Effect.provide(layerSandboxPolicySource),
        Effect.provideService(
          StructuredSessionState,
          structuredSessionStateFromStore(this.structuredSessionStore),
        ),
      ),
    );
  }

  private runRuntimeStateAsync<A>(effect: Effect.Effect<A, StateContractError>): Promise<A> {
    return this.runCatalogEffect(effect);
  }

  private runRuntimeState<A>(effect: Effect.Effect<A, StateContractError>): A {
    return Effect.runSync(effect);
  }

  private enqueueRuntimeSurfaceMessage(
    input: EnqueueRuntimeSurfaceMessageInput,
  ): RuntimeSurfaceMessageRecord {
    return this.structuredSessionStore.enqueueSurfaceMessage(input);
  }

  private async enqueueRuntimeSurfaceMessageAsync(
    input: EnqueueRuntimeSurfaceMessageInput,
  ): Promise<RuntimeSurfaceMessageRecord> {
    return (
      await this.runRuntimeStateAsync(this.runtimeQueueStatePort.enqueueSurfaceMessage(input))
    ).value;
  }

  private getRuntimeSurfaceQueuedMessage(
    input: GetRuntimeSurfaceMessageInput,
  ): RuntimeSurfaceMessageRecord {
    return this.structuredSessionStore.getSurfaceQueuedMessage(input);
  }

  private async markRuntimeSurfaceMessageQueuedAsync(
    input: MarkRuntimeSurfaceMessageQueuedInput,
  ): Promise<RuntimeSurfaceMessageRecord> {
    return (
      await this.runRuntimeStateAsync(this.runtimeQueueStatePort.markSurfaceMessageQueued(input))
    ).value;
  }

  updateRequestUserInputSettings(settings: RequestUserInputSettings): AgentSettingsState {
    const next = this.agentSettingsStore.setRequestUserInput(settings);
    this.requestUserInputRuntime.setSettings(next.requestUserInput);
    void this.emitOpenSurfacePromptBindingUpdates();
    return next;
  }

  updateAppPreferences(preferences: AppPreferences): AgentSettingsState {
    const next = this.agentSettingsStore.hydrateStateOwnedAppPreferences(preferences);
    void this.emitOpenSurfacePromptBindingUpdates();
    return next;
  }

  async notifyAppPreferencesChanged(): Promise<void> {
    await this.emitOpenSurfacePromptBindingUpdates();
  }

  async notifySourceInputsChanged(_reason: string): Promise<void> {
    await this.emitOpenSurfacePromptBindingUpdates();
  }

  async getAgentContextPreview(
    request: AgentContextPreviewRequest = {},
  ): Promise<AgentContextPreviewResponse> {
    const actor = request.actor ?? "orchestrator";
    const settings = this.agentSettingsStore.getState();
    const externalInstructionSources = await this.buildCurrentExternalContextSources();
    if (actor === "handler") {
      const profile = settings.agents.special.threadHandler;
      const extensionState = resolveActorExtensionState({
        actor: "handler",
        defaultExtensionOrder: settings.extensionDefaults.order,
        defaultExtensionUsage: settings.extensionDefaults.usage,
        profileExtensionUsage: profile.extensionUsage,
        profileExtensionOrder: profile.extensionOrder,
      });
      const systemPrompt = this.buildPromptFromLibrary("handler", {
        ...extensionState,
        externalInstructionSources,
      });
      const tokenCount = countPromptTokens({
        provider: profile.provider,
        model: profile.model,
        text: systemPrompt,
      });
      return {
        actor,
        profileId: profile.id,
        profileName: profile.name,
        provider: profile.provider,
        model: profile.model,
        reasoningEffort: profile.reasoningEffort,
        loadedExtensionIds: extensionState.loadedExtensionIds,
        availableExtensionIds: extensionState.availableExtensionIds,
        systemPrompt,
        tokenCount,
        extensions: this.buildAgentContextPreviewExtensions(
          actor,
          extensionState,
          externalInstructionSources,
          { provider: profile.provider, model: profile.model },
        ),
      };
    }
    if (actor === "workflow-task") {
      const profile =
        request.profileId && request.profileId in settings.workflowAgents
          ? settings.workflowAgents[request.profileId as WorkflowAgentKey]
          : (settings.workflowAgents.explorer ?? Object.values(settings.workflowAgents)[0]);
      if (!profile) {
        throw new Error("No workflow task-agent profile is available.");
      }
      const extensionState = resolveActorExtensionState({
        actor: "workflow-task",
        defaultExtensionOrder: settings.extensionDefaults.order,
        defaultExtensionUsage: settings.extensionDefaults.usage,
        profileExtensionUsage: profile.overrides ?? {},
        profileExtensionOrder: profile.extensionOrder,
      });
      const systemPrompt = this.buildPromptFromLibrary("workflow-task", {
        ...extensionState,
        externalInstructionSources,
        customInstructions: profile.instructions,
      });
      const tokenCount = countPromptTokens({
        provider: profile.provider,
        model: profile.model,
        text: systemPrompt,
      });
      return {
        actor,
        profileId: profile.id,
        profileName: profile.label,
        provider: profile.provider,
        model: profile.model,
        reasoningEffort: profile.reasoningEffort,
        loadedExtensionIds: extensionState.loadedExtensionIds,
        availableExtensionIds: extensionState.availableExtensionIds,
        systemPrompt,
        tokenCount,
        extensions: this.buildAgentContextPreviewExtensions(
          actor,
          extensionState,
          externalInstructionSources,
          { provider: profile.provider, model: profile.model },
        ),
      };
    }
    const profile =
      settings.agents.orchestrators.find((candidate) => candidate.id === request.profileId) ??
      settings.agents.orchestrators.find(
        (candidate) => candidate.id === DEFAULT_ORCHESTRATOR_PROFILE_ID,
      ) ??
      settings.agents.orchestrators[0];
    if (!profile) {
      throw new Error("No orchestrator agent profile is configured.");
    }
    const extensionState = resolveActorExtensionState({
      actor: "orchestrator",
      defaultExtensionOrder: settings.extensionDefaults.order,
      defaultExtensionUsage: settings.extensionDefaults.usage,
      profileExtensionUsage: profile.extensionUsage,
      profileExtensionOrder: profile.extensionOrder,
    });
    const systemPrompt = this.buildOrchestratorSystemPrompt(
      profile,
      extensionState,
      externalInstructionSources,
    );
    const tokenCount = countPromptTokens({
      provider: profile.provider,
      model: profile.model,
      text: systemPrompt,
    });
    return {
      actor,
      profileId: profile.id,
      profileName: profile.name,
      provider: profile.provider,
      model: profile.model,
      reasoningEffort: profile.reasoningEffort,
      loadedExtensionIds: extensionState.loadedExtensionIds,
      availableExtensionIds: extensionState.availableExtensionIds,
      systemPrompt,
      tokenCount,
      extensions: this.buildAgentContextPreviewExtensions(
        actor,
        extensionState,
        externalInstructionSources,
        { provider: profile.provider, model: profile.model },
      ),
    };
  }

  getExtensionsRoot(): string {
    return this.extensionsRoot;
  }

  setExtensionUsage(input: {
    agentProfile: string;
    extensionId: string;
    state: ExtensionUsageState;
  }): { actor: "orchestrator" | "handler" | "workflow-task"; settings: AgentSettingsState } {
    const result = setExtensionUsage({
      agentSettingsStore: this.agentSettingsStore,
      extensionContextImpactState: this.getRuntimeExtensionContextImpactState(),
      extensionsRoot: this.extensionsRoot,
      agentProfile: input.agentProfile,
      extensionId: input.extensionId,
      state: input.state,
    });
    if (
      result.actor !== "orchestrator" &&
      result.actor !== "handler" &&
      result.actor !== "workflow-task"
    ) {
      throw new Error(`Unsupported extension usage actor: ${result.actor}`);
    }
    return {
      actor: result.actor,
      settings: this.agentSettingsStore.getState(),
    };
  }

  async getGeneratedAgentContextExternalSources(): Promise<GeneratedAgentContextExternalSource[]> {
    return this.buildCurrentExternalContextSources();
  }

  private async buildCurrentExternalContextSources(): Promise<
    GeneratedAgentContextExternalSource[]
  > {
    return discoverExternalInstructionSources({
      cwd: this.cwd,
      settings: this.agentSettingsStore.getState().appPreferences.externalInstructions,
      workspaceKey: this.cwd,
    });
  }

  buildOrchestratorSystemPrompt(
    settings: Pick<AgentProfileSettings, "extensionUsage" | "extensionOrder">,
    extensionState = this.resolveProfileExtensionState("orchestrator", settings),
    externalInstructionSources: readonly GeneratedAgentContextExternalSource[] = [],
  ): string {
    return this.buildPromptFromLibrary("orchestrator", {
      ...extensionState,
      externalInstructionSources,
    });
  }

  private resolveProfileExtensionState(
    actor: SvvyActorKind,
    settings: {
      extensionUsage?: Record<string, ExtensionUsageState>;
      overrides?: Record<string, ExtensionUsageState>;
      extensionOrder?: readonly string[];
    },
  ): { loadedExtensionIds: string[]; availableExtensionIds: string[] } {
    const defaults = this.agentSettingsStore.getState().extensionDefaults;
    return resolveActorExtensionState({
      actor,
      defaultExtensionOrder: defaults.order,
      defaultExtensionUsage: defaults.usage,
      profileExtensionUsage: settings.extensionUsage ?? settings.overrides ?? {},
      profileExtensionOrder: settings.extensionOrder,
    });
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

    return buildWorkspaceSessionNavigation(summaries, sidebarState.archivedGroupCollapsed, {
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
    });
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
    const content = pathContent ?? "";

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
    void input.surfacePiSessionId;
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
    const extensionState = resolveActorExtensionState({
      actor: "orchestrator",
      defaultExtensionOrder: this.agentSettingsStore.getState().extensionDefaults.order,
      defaultExtensionUsage: this.agentSettingsStore.getState().extensionDefaults.usage,
      profileExtensionUsage: agentProfileSettings.extensionUsage,
      profileExtensionOrder: agentProfileSettings.extensionOrder,
    });
    const externalContextSources = await this.buildCurrentExternalContextSources();
    const aggregate = this.buildPromptAggregateFromLibrary("orchestrator", {
      ...extensionState,
      externalInstructionSources: externalContextSources,
    });

    const session = await this.createManagedSurfaceRecord({
      sessionManager,
      actorKind: "orchestrator",
      provider: defaults.provider,
      model: defaults.model,
      thinkingLevel: defaults.thinkingLevel,
      systemPrompt: aggregate.outputs.prompt,
      generatedAgentContextAggregateKey: aggregate.cacheKey,
      generatedAgentContextAggregate: aggregate.outputs,
      agentProfileId,
      loadedExtensionIds: extensionState.loadedExtensionIds,
      availableExtensionIds: extensionState.availableExtensionIds,
      externalContextSources,
    });
    const target = this.buildOrchestratorPromptTarget(session.sessionId);
    session.retainCount += 1;
    this.syncGeneratedAgentContextBindingForTarget(target, session);
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
    return await this.buildSurfaceSnapshot(session, target, {
      refreshExternalSources: true,
    });
  }

  async closeSurface(target: PromptTarget): Promise<WorkspaceMutationResponse> {
    await this.releaseManagedSurface(target.surfacePiSessionId);
    return { ok: true };
  }

  resolvePromptDefaultsForTarget(target: PromptTarget): AgentDefaults {
    this.assertValidPromptTarget(target);
    const activeSurface = this.managedSurfaces.get(target.surfacePiSessionId);
    if (activeSurface) {
      return {
        provider: activeSurface.provider,
        model: activeSurface.model,
        reasoningEffort: activeSurface.thinkingLevel,
      };
    }

    if (target.surface === "handler") {
      const threadSettings = this.resolveThreadProfileSettings(target.surfacePiSessionId);
      if (threadSettings) {
        return threadSettings;
      }
    }

    const snapshot = this.getStructuredSnapshot(target.workspaceSessionId);
    if (
      snapshot?.pi.provider &&
      snapshot.pi.model &&
      isAgentReasoningEffort(snapshot.pi.reasoningEffort)
    ) {
      return {
        provider: snapshot.pi.provider,
        model: snapshot.pi.model,
        reasoningEffort: snapshot.pi.reasoningEffort,
      };
    }

    const defaultProfile =
      this.agentSettingsStore
        .getState()
        .agents.orchestrators.find((agent) => agent.id === DEFAULT_ORCHESTRATOR_PROFILE_ID) ??
      this.agentSettingsStore.getState().agents.orchestrators[0];
    return defaultProfile
      ? {
          provider: defaultProfile.provider,
          model: defaultProfile.model,
          reasoningEffort: defaultProfile.reasoningEffort,
        }
      : DEFAULT_AGENT_SETTINGS;
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

    const sourceAgentProfile = this.resolveOrchestratorAgentProfile(
      (this.managedSurfaces.get(request.sessionId)?.agentProfileId ??
        defaults.agentProfileId ??
        DEFAULT_ORCHESTRATOR_PROFILE_ID) as AgentProfileId,
    );
    const extensionState = resolveActorExtensionState({
      actor: "orchestrator",
      defaultExtensionOrder: this.agentSettingsStore.getState().extensionDefaults.order,
      defaultExtensionUsage: this.agentSettingsStore.getState().extensionDefaults.usage,
      profileExtensionUsage: sourceAgentProfile.extensionUsage,
      profileExtensionOrder: sourceAgentProfile.extensionOrder,
    });
    const externalContextSources = await this.buildCurrentExternalContextSources();
    const aggregate = this.buildPromptAggregateFromLibrary("orchestrator", {
      ...extensionState,
      externalInstructionSources: externalContextSources,
    });
    const session = await this.createManagedSurfaceRecord({
      sessionManager: forkedSessionManager,
      actorKind: "orchestrator",
      systemPrompt: aggregate.outputs.prompt,
      generatedAgentContextAggregateKey: aggregate.cacheKey,
      generatedAgentContextAggregate: aggregate.outputs,
      loadedExtensionIds: extensionState.loadedExtensionIds,
      availableExtensionIds: extensionState.availableExtensionIds,
      externalContextSources,
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
      snippetMentions: input.draft.snippetMentions ?? [],
    });
    await this.emitWorkspaceSync("structured.updated");
    return { ok: true, target: structuredClone(input.target) };
  }

  async editCommittedUserMessage(
    options: EditCommittedUserMessageOptions,
  ): Promise<SendAgentPromptResult> {
    void options;
    throw new Error("Committed-message edit dispatch is runtime-owned and unavailable here.");
  }

  async refreshQueuedSurfaceMutation(input: {
    target: PromptTarget;
  }): Promise<{ ok: boolean; target: PromptTarget; snapshot?: ConversationSurfaceSnapshot }> {
    this.assertValidPromptTarget(input.target);
    const snapshot = await this.emitQueuedSurfaceUpdate(input.target);
    return { ok: true, target: structuredClone(input.target), snapshot };
  }

  async setExtensionContextAutoUpdate(
    input: SetExtensionContextAutoUpdateRequest,
  ): Promise<{ ok: boolean; target: PromptTarget; snapshot?: ConversationSurfaceSnapshot }> {
    this.assertValidPromptTarget(input.target);
    if (input.target.surface === "handler") {
      if (!input.target.threadId) {
        throw new Error("Thread id is required for handler extension context settings.");
      }
      this.structuredSessionStore.setThreadExtensionContextAutoUpdate({
        threadId: input.target.threadId,
        enabled: input.enabled,
      });
    } else {
      this.structuredSessionStore.setSessionExtensionContextAutoUpdate({
        sessionId: input.target.workspaceSessionId,
        enabled: input.enabled,
      });
    }
    const session = this.managedSurfaces.get(input.target.surfacePiSessionId);
    const snapshot = session
      ? await this.buildSurfaceSnapshot(session, input.target, { refreshExternalSources: true })
      : undefined;
    await this.emitWorkspaceSync("structured.updated");
    if (session) {
      await this.emitSurfaceSync({
        session,
        reason: "surface.updated",
        target: input.target,
        refreshExternalSources: true,
      });
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
    if (!text) {
      throw new Error("Queued user message payload cannot be restored to the composer.");
    }
    this.structuredSessionStore.cancelSurfaceMessage({
      id: input.queuedMessageId,
      expectedStatuses: ["queued", "steering"],
    });
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
    this.assertQueuedMessageBelongsToSurface(input.queuedMessageId, input.target);
    await this.markRuntimeSurfaceMessageQueuedAsync({
      id: input.queuedMessageId,
      position: "front",
    });
    const snapshot = await this.emitQueuedSurfaceUpdate(input.target);
    return { ok: true, target: structuredClone(input.target), snapshot };
  }

  async answerRequestUserInput(
    input: RequestUserInputAnswerRequest,
  ): Promise<{ ok: boolean; target: PromptTarget; snapshot?: ConversationSurfaceSnapshot }> {
    const request = this.structuredSessionStore.getRequestUserInputRequest(input.requestId);
    if (request.surfacePiSessionId !== input.surfacePiSessionId) {
      throw new Error("Request user input answer does not belong to the target surface.");
    }
    const target = this.resolvePromptTargetForSurfacePiSessionId(request.surfacePiSessionId);
    if (target.workspaceSessionId !== request.sessionId) {
      throw new Error("Request user input request is not bound to a known workspace session.");
    }
    const answered = this.structuredSessionStore.answerRequestUserInput({
      surfacePiSessionId: target.surfacePiSessionId,
      requestId: input.requestId,
      questionId: input.questionId,
      answer: input.answer,
      delivery: input.delivery,
    });
    if (!answered.queuedMessage) {
      await this.emitWorkspaceSync("structured.updated");
      return { ok: true, target: structuredClone(target) };
    }
    const snapshot = await this.emitQueuedSurfaceUpdate(target);
    return { ok: true, target: structuredClone(target), snapshot };
  }

  async afterRequestInputAnswered(input: {
    surfacePiSessionId: string;
    requestId: string;
    queuedItemId: string | null;
  }): Promise<{ ok: boolean; target: PromptTarget; snapshot?: ConversationSurfaceSnapshot }> {
    const request = this.structuredSessionStore.getRequestUserInputRequest(input.requestId);
    if (request.surfacePiSessionId !== input.surfacePiSessionId) {
      throw new Error("Request user input answer does not belong to the target surface.");
    }
    const target = this.resolvePromptTargetForSurfacePiSessionId(request.surfacePiSessionId);
    if (target.workspaceSessionId !== request.sessionId) {
      throw new Error("Request user input request is not bound to a known workspace session.");
    }
    if (!input.queuedItemId) {
      await this.emitWorkspaceSync("structured.updated");
      return { ok: true, target: structuredClone(target) };
    }
    const snapshot = await this.emitQueuedSurfaceUpdate(target);
    return { ok: true, target: structuredClone(target), snapshot };
  }

  async setRequestUserInputTimerPaused(
    input: SetRequestUserInputTimerPausedRequest,
  ): Promise<{ ok: boolean }> {
    const request = this.structuredSessionStore.getRequestUserInputRequest(input.requestId);
    if (request.surfacePiSessionId !== input.surfacePiSessionId) {
      throw new Error("Request user input timer does not belong to the target surface.");
    }
    this.structuredSessionStore.setRequestUserInputTimerPaused({
      surfacePiSessionId: input.surfacePiSessionId,
      requestId: input.requestId,
      paused: input.paused,
    });
    await this.emitWorkspaceSync("structured.updated");
    return { ok: true };
  }

  private async abortManagedSurfaceForDelete(session: ManagedSession): Promise<void> {
    void session;
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

    const resolvedModel = resolveRegisteredModel(session.modelRegistry, provider, model);
    const supportedThinkingLevels = resolvedModel ? getSupportedThinkingLevels(resolvedModel) : [];
    const thinkingLevel = supportedThinkingLevels.includes(session.thinkingLevel)
      ? session.thinkingLevel
      : supportedThinkingLevels.includes("medium")
        ? "medium"
        : (supportedThinkingLevels[0] ?? "off");
    session.provider = provider;
    session.model = model;
    session.thinkingLevel = thinkingLevel;
    session.recreateOnNextPrompt = true;
    const profileChanged = this.updateOrchestratorProfileFromComposer(target, session, {
      provider,
      model,
      reasoningEffort: thinkingLevel,
    });

    if (session.activePrompt) {
      this.syncManagedState(session);
      this.persistManagedSessionSnapshot(session);
      if (profileChanged) {
        await this.emitWorkspaceSync("workspace.updated");
      }
      return { ok: true, target: structuredClone(target) };
    }

    try {
      syncAuthStorage(session.authStorage);
      if (resolvedModel) {
        await session.session.setModel(resolvedModel);
        session.session.setThinkingLevel(thinkingLevel);
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

  async setSurfaceExtensionUsage(input: {
    target: PromptTarget;
    extensionId: string;
    state: ExtensionUsageState;
  }): Promise<SurfaceMutationResponse> {
    const session = this.managedSurfaces.get(input.target.surfacePiSessionId);
    if (!session) {
      return { ok: false, target: structuredClone(input.target) };
    }

    const previousBinding = {
      systemPrompt: session.systemPrompt,
      generatedAgentContextFingerprint: session.generatedAgentContextFingerprint,
      loadedExtensionIds: [...session.loadedExtensionIds],
      availableExtensionIds: [...session.availableExtensionIds],
      externalSourceHashes: [...session.externalSourceHashes],
    };
    const extensionState = applyExtensionUsageState(
      {
        loadedExtensionIds: session.loadedExtensionIds,
        availableExtensionIds: session.availableExtensionIds,
      },
      input.extensionId,
      input.state,
    );
    session.loadedExtensionIds = extensionState.loadedExtensionIds;
    session.availableExtensionIds = extensionState.availableExtensionIds;
    session.recreateOnNextPrompt = true;
    const profileChanged = this.updateOrchestratorProfileFromComposer(input.target, session, {
      extensionUsage: { [input.extensionId]: input.state },
    });

    if (session.activePrompt) {
      this.syncManagedState(session);
      this.persistManagedSessionSnapshot(session);
      if (profileChanged) {
        await this.emitWorkspaceSync("workspace.updated");
      }
      await this.emitSurfaceSync({
        reason: "surface.updated",
        session,
        target: input.target,
      });
      return {
        ok: true,
        target: structuredClone(input.target),
        snapshot: await this.buildSurfaceSnapshot(session, input.target),
      };
    }

    const externalContextSources = await this.buildCurrentExternalContextSources();
    const aggregate = this.buildAggregateForTarget(input.target, {
      extensionState,
      externalInstructionSources: externalContextSources,
    });
    const refreshed = await this.recreateManagedSurface(session, {
      actorKind: getActorKindForTarget(input.target),
      systemPrompt: aggregate.outputs.prompt,
      generatedAgentContextAggregateKey: aggregate.cacheKey,
      generatedAgentContextAggregate: aggregate.outputs,
      generatedAgentContextRevision: this.generatedAgentContextStore.getState().revision,
      loadedExtensionIds: extensionState.loadedExtensionIds,
      availableExtensionIds: extensionState.availableExtensionIds,
      externalContextSources,
    });
    refreshed.recreateOnNextPrompt = false;
    this.syncManagedState(refreshed);
    this.syncGeneratedAgentContextBindingForTarget(input.target, refreshed);
    this.recordAgentContextUpdatedEvent(input.target, previousBinding, refreshed);
    this.persistManagedSessionSnapshot(refreshed);
    if (input.target.surface === "orchestrator") {
      this.syncStructuredPiSessionFromOrchestratorSession(refreshed);
    }
    await this.emitSurfaceSync({
      reason: "surface.updated",
      session: refreshed,
      target: input.target,
    });
    await this.emitWorkspaceSync("workspace.updated");
    return {
      ok: true,
      target: structuredClone(input.target),
      snapshot: await this.buildSurfaceSnapshot(refreshed, input.target),
    };
  }

  private updateOrchestratorProfileFromComposer(
    target: PromptTarget,
    session: ManagedSession,
    updates: Partial<
      Pick<AgentProfileSettings, "provider" | "model" | "reasoningEffort" | "extensionUsage">
    >,
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
    const nextProfile = {
      ...profile,
      ...updates,
      extensionUsage: {
        ...profile.extensionUsage,
        ...updates.extensionUsage,
      },
    };
    if (
      nextProfile.provider === profile.provider &&
      nextProfile.model === profile.model &&
      nextProfile.reasoningEffort === profile.reasoningEffort &&
      sameExtensionUsage(nextProfile.extensionUsage, profile.extensionUsage)
    ) {
      return false;
    }
    this.agentSettingsStore.setAgentProfile(nextProfile);
    return true;
  }

  private async retainManagedSurface(target: PromptTarget): Promise<ManagedSession> {
    const externalContextSources = await this.buildCurrentExternalContextSources();
    const aggregate = this.buildAggregateForTarget(target, {
      externalInstructionSources: externalContextSources,
    });
    const session = await this.loadManagedSurface(
      target.surfacePiSessionId,
      getActorKindForTarget(target),
      aggregate.outputs.prompt,
      externalContextSources,
      aggregate,
    );
    session.retainCount += 1;
    return session;
  }

  private async loadManagedSurface(
    surfacePiSessionId: string,
    actorKind: SvvyActorKind,
    systemPrompt = this.buildPromptFromLibrary(actorKind),
    externalContextSources: readonly GeneratedAgentContextExternalSource[] = [],
    aggregate?: GeneratedAgentContextAggregateResult,
  ): Promise<ManagedSession> {
    const existing = this.managedSurfaces.get(surfacePiSessionId);
    if (existing) {
      if (existing.actorKind === actorKind) {
        return existing;
      }
      return this.recreateManagedSurface(existing, {
        actorKind,
        systemPrompt,
        generatedAgentContextAggregateKey: aggregate?.cacheKey,
        generatedAgentContextAggregate: aggregate?.outputs,
        externalContextSources: [...externalContextSources],
      });
    }

    const sessionFile = await this.getSessionFileForId(surfacePiSessionId);
    const threadAgentSettings = this.resolveThreadProfileSettings(surfacePiSessionId);
    const surfaceExtensionState = this.resolveSurfaceExtensionState(surfacePiSessionId);
    const storedGeneratedAgentContextFingerprint =
      this.resolveStoredGeneratedAgentContextFingerprint(surfacePiSessionId);
    const storedGeneratedAgentContextBinding = storedGeneratedAgentContextFingerprint
      ? this.structuredSessionStore.getGeneratedAgentContextBinding({
          surfacePiSessionId,
          generatedAgentContextFingerprint: storedGeneratedAgentContextFingerprint,
        })
      : null;
    return this.createManagedSurfaceRecord({
      sessionManager: SessionManager.open(sessionFile!, dirname(sessionFile!)),
      actorKind,
      provider: threadAgentSettings?.provider,
      model: threadAgentSettings?.model,
      thinkingLevel: threadAgentSettings?.reasoningEffort,
      systemPrompt: storedGeneratedAgentContextBinding?.systemPrompt ?? systemPrompt,
      generatedAgentContextAggregateKey:
        storedGeneratedAgentContextBinding?.aggregateCacheKey ?? aggregate?.cacheKey,
      generatedAgentContextAggregate: storedGeneratedAgentContextBinding
        ? {
            prompt: storedGeneratedAgentContextBinding.systemPrompt,
            svvyxGuidance: storedGeneratedAgentContextBinding.svvyxGuidance,
            commandsDts: storedGeneratedAgentContextBinding.commandsDts,
            nativeToolSchemasJson: storedGeneratedAgentContextBinding.nativeToolSchemasJson,
          }
        : aggregate?.outputs,
      agentProfileId:
        actorKind === "handler"
          ? DEFAULT_THREAD_HANDLER_PROFILE_ID
          : DEFAULT_ORCHESTRATOR_PROFILE_ID,
      loadedExtensionIds:
        surfaceExtensionState?.loadedExtensionIds ??
        storedGeneratedAgentContextBinding?.loadedExtensionIds,
      availableExtensionIds:
        surfaceExtensionState?.availableExtensionIds ??
        storedGeneratedAgentContextBinding?.availableExtensionIds,
      generatedAgentContextFingerprint: storedGeneratedAgentContextFingerprint ?? undefined,
      generatedAgentContextRevision:
        storedGeneratedAgentContextBinding?.generatedAgentContextRevision,
      externalSourceHashes: storedGeneratedAgentContextBinding?.externalSourceHashes,
      externalContextSources,
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
        | "generatedAgentContextAggregateKey"
        | "generatedAgentContextAggregate"
        | "generatedAgentContextRevision"
        | "agentProfileId"
        | "loadedExtensionIds"
        | "availableExtensionIds"
        | "externalContextSources"
        | "externalSourceHashes"
      >
    >,
  ): Promise<ManagedSession> {
    const sessionManager = session.session.sessionManager;
    const actorKind = overrides.actorKind ?? session.actorKind;
    const provider = overrides.provider ?? session.provider;
    const model = overrides.model ?? session.model;
    const thinkingLevel = overrides.thinkingLevel ?? session.thinkingLevel;
    const systemPrompt = overrides.systemPrompt ?? session.systemPrompt;
    const generatedAgentContextAggregateKey =
      overrides.generatedAgentContextAggregateKey ?? session.generatedAgentContextAggregateKey;
    const generatedAgentContextAggregate =
      overrides.generatedAgentContextAggregate ?? session.generatedAgentContextAggregate;
    const generatedAgentContextRevision =
      overrides.generatedAgentContextRevision ?? session.generatedAgentContextRevision;
    const agentProfileId = overrides.agentProfileId ?? session.agentProfileId;
    const loadedExtensionIds = overrides.loadedExtensionIds ?? session.loadedExtensionIds;
    const availableExtensionIds = overrides.availableExtensionIds ?? session.availableExtensionIds;
    const externalContextSources =
      overrides.externalContextSources ?? session.externalContextSources;
    const boundExternalSourceHashes =
      overrides.externalSourceHashes ??
      (overrides.externalContextSources
        ? externalSourceHashes(externalContextSources).toSorted()
        : session.externalSourceHashes);

    session.session.dispose();
    const nextSession = await createManagedSession({
      sessionManager,
      workspaceId: this.workspaceId,
      actorKind,
      provider,
      model,
      thinkingLevel,
      systemPrompt,
      generatedAgentContextAggregateKey,
      generatedAgentContextAggregate,
      generatedAgentContextRevision,
      agentProfileId,
      loadedExtensionIds,
      availableExtensionIds,
      externalContextSources,
      externalSourceHashes: boundExternalSourceHashes,
      agentDir: this.agentDir,
      agentSettingsStore: this.agentSettingsStore,
      extensionContextImpactState: this.getRuntimeExtensionContextImpactState(),
      readArtifactRootForSession: (sessionId) =>
        this.structuredSessionStore.getSessionState(sessionId).workspace.artifactDir,
      actorExtensionBindingState: this.runtimeActorExtensionBindingStatePort,
      artifactState: this.runtimeArtifactStatePort,
      commandState: this.runtimeCommandStatePort,
      episodeState: this.runtimeEpisodeStatePort,
      readModelState: this.runtimeReadModelStatePort,
      requestState: this.runtimeRequestStatePort,
      sessionWaitState: this.runtimeSessionWaitStatePort,
      threadState: this.runtimeThreadStatePort,
      turnState: this.runtimeTurnStatePort,
      runState: this.runRuntimeState.bind(this),
      runCatalogEffect: this.runCatalogEffect,
      createHandlerThread: this.createHandlerThread.bind(this),
      queueThreadFollowup: this.queueThreadFollowup.bind(this),
      queueThreadReportRequest: this.queueThreadReportRequest.bind(this),
      queueThreadReportNotification: this.queueThreadReportNotification.bind(this),
      refreshGeneratedContext: this.refreshGeneratedContextForLoadExtension.bind(this),
      onRequestContextLoaded: this.markPromptRefreshRequired.bind(this),
      requestUserInputRuntime: this.requestUserInputRuntime,
      openArtifact: this.openArtifactFromRuntime.bind(this),
      onWorkflowsGeneratedPackageChanged: this.emitWorkflowsGeneratedPackageLog.bind(this),
      onAppLog: this.emitAppLog.bind(this),
      runTaskAgentBridge: this.runTaskAgentBridgeEnv.bind(this),
      runtimeCommandStdin: this.runtimeCommandStdin,
      managedSandbox: this.managedSandbox,
      acquireExecuteTypescriptLaunch: this.recoveryOptions.acquireExecuteTypescriptLaunch,
      acquireDirectToolLaunch: this.recoveryOptions.acquireDirectToolLaunch,
      runAcceptedLoadExtension: this.recoveryOptions.runAcceptedLoadExtension,
      runAcceptedRequestUserInput: this.recoveryOptions.runAcceptedRequestUserInput,
      approvalBoundary: this.approvalBoundary,
      extensionsRoot: this.extensionsRoot,
      workflowsExtensionsGeneratedPackagePath:
        this.recoveryOptions.workflowsExtensionsGeneratedPackagePath,
      workflowsGeneratedPackagePath: this.recoveryOptions.workflowsGeneratedPackagePath,
      workflowsSourceRoot: this.recoveryOptions.workflowsSourceRoot,
    });
    nextSession.retainCount = session.retainCount;
    this.managedSurfaces.set(nextSession.sessionId, nextSession);
    return nextSession;
  }

  private async refreshGeneratedContextForLoadExtension(
    input: RefreshGeneratedContextRequest,
  ): Promise<void> {
    if (input.scope === "target") {
      const session = this.managedSurfaces.get(input.target.surfacePiSessionId);
      if (session) {
        session.recreateOnNextPrompt = true;
      }
    }
    await this.notifySourceInputsChanged(`runtime_refresh:${input.reason}`);
  }

  private async createManagedSurfaceRecord(
    options: CreateManagedSessionOptions,
  ): Promise<ManagedSession> {
    const session = await createManagedSession({
      ...options,
      workspaceId: this.workspaceId,
      generatedAgentContextRevision:
        options.generatedAgentContextRevision ??
        this.generatedAgentContextStore.getState().revision,
      agentDir: this.agentDir,
      agentSettingsStore: this.agentSettingsStore,
      extensionContextImpactState: this.getRuntimeExtensionContextImpactState(),
      readArtifactRootForSession: (sessionId) =>
        this.structuredSessionStore.getSessionState(sessionId).workspace.artifactDir,
      actorExtensionBindingState: this.runtimeActorExtensionBindingStatePort,
      artifactState: this.runtimeArtifactStatePort,
      commandState: this.runtimeCommandStatePort,
      episodeState: this.runtimeEpisodeStatePort,
      readModelState: this.runtimeReadModelStatePort,
      requestState: this.runtimeRequestStatePort,
      sessionWaitState: this.runtimeSessionWaitStatePort,
      threadState: this.runtimeThreadStatePort,
      turnState: this.runtimeTurnStatePort,
      runState: this.runRuntimeState.bind(this),
      runCatalogEffect: this.runCatalogEffect,
      managedSandbox: this.managedSandbox,
      acquireExecuteTypescriptLaunch: this.recoveryOptions.acquireExecuteTypescriptLaunch,
      acquireDirectToolLaunch: this.recoveryOptions.acquireDirectToolLaunch,
      runAcceptedLoadExtension: this.recoveryOptions.runAcceptedLoadExtension,
      runAcceptedRequestUserInput: this.recoveryOptions.runAcceptedRequestUserInput,
      createHandlerThread: this.createHandlerThread.bind(this),
      queueThreadFollowup: this.queueThreadFollowup.bind(this),
      queueThreadReportRequest: this.queueThreadReportRequest.bind(this),
      queueThreadReportNotification: this.queueThreadReportNotification.bind(this),
      refreshGeneratedContext: this.refreshGeneratedContextForLoadExtension.bind(this),
      onRequestContextLoaded: this.markPromptRefreshRequired.bind(this),
      requestUserInputRuntime: this.requestUserInputRuntime,
      openArtifact: this.openArtifactFromRuntime.bind(this),
      onWorkflowsGeneratedPackageChanged: this.emitWorkflowsGeneratedPackageLog.bind(this),
      onAppLog: this.emitAppLog.bind(this),
      runTaskAgentBridge: this.runTaskAgentBridgeEnv.bind(this),
      runtimeCommandStdin: this.runtimeCommandStdin,
      approvalBoundary: this.approvalBoundary,
      extensionsRoot: this.extensionsRoot,
      workflowsExtensionsGeneratedPackagePath:
        this.recoveryOptions.workflowsExtensionsGeneratedPackagePath,
      workflowsGeneratedPackagePath: this.recoveryOptions.workflowsGeneratedPackagePath,
      workflowsSourceRoot: this.recoveryOptions.workflowsSourceRoot,
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
    const promptBinding = this.buildPromptBinding(session, target, currentExternalSources);
    return {
      target: structuredClone(target),
      provider: session.provider,
      model: session.model,
      reasoningEffort: session.thinkingLevel,
      agentProfileId: session.agentProfileId,
      loadedExtensionIds: [...session.loadedExtensionIds],
      availableExtensionIds: [...session.availableExtensionIds],
      systemPrompt: session.systemPrompt,
      resolvedSystemPrompt: getResolvedSystemPrompt(session),
      externalContextSources: structuredClone(session.externalContextSources),
      promptBinding,
      messages,
      pendingUserMessage: session.pendingUserMessage
        ? structuredClone(session.pendingUserMessage.message)
        : null,
      queuedMessages: this.buildQueuedSurfaceMessages(target),
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
      snippetMentions: draft?.snippetMentions ? structuredClone(draft.snippetMentions) : [],
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

  private buildQueuedSurfaceMessages(target: PromptTarget): QueuedSurfaceMessage[] {
    return this.structuredSessionStore
      .listQueuedSurfaceMessages({ surfacePiSessionId: target.surfacePiSessionId })
      .filter((message) => message.status !== "dispatching")
      .flatMap((message) => {
        if (message.kind === "workflow_task_agent_start") {
          return [];
        }
        const payload =
          message.kind === "thread_report_notification"
            ? this.parseThreadReportNotificationQueuePayload(message)
            : null;
        const followupPayload =
          message.kind === "thread_followup" ? this.parseThreadFollowupQueuePayload(message) : null;
        const reportRequestPayload =
          message.kind === "report_request" ? this.parseReportRequestQueuePayload(message) : null;
        const requestUserInputAnswerPayload =
          message.kind === "request_user_input_answer"
            ? this.parseRequestUserInputAnswerQueuePayload(message)
            : null;
        return [
          {
            id: message.id,
            kind: message.kind,
            text:
              message.kind === "initial_handler_start"
                ? "Start handler thread"
                : followupPayload
                  ? followupPayload.message
                  : reportRequestPayload
                    ? `Report requested: ${reportRequestPayload.request}`
                    : requestUserInputAnswerPayload
                      ? this.getQueuedMessageText(message.messageJson)
                      : payload
                        ? `Thread report: ${payload.summary}`
                        : this.getQueuedMessageText(message.messageJson) || "Queued message",
            title: payload
              ? "Thread report"
              : requestUserInputAnswerPayload
                ? "User answer"
                : undefined,
            summary: followupPayload?.message
              ? followupPayload.message
              : reportRequestPayload?.request
                ? reportRequestPayload.request
                : requestUserInputAnswerPayload
                  ? this.getQueuedMessageText(message.messageJson)
                  : payload?.summary,
            threadId:
              payload?.threadId ??
              followupPayload?.threadId ??
              reportRequestPayload?.threadId ??
              message.threadId ??
              undefined,
            sourceCommandId: payload?.sourceCommandId,
            status:
              message.status === "failed"
                ? "failed"
                : message.status === "dispatching"
                  ? "dispatching"
                  : message.status === "steering"
                    ? "steering"
                    : "queued",
            failureError: message.failureError ?? undefined,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt,
          },
        ];
      });
  }

  private parseThreadReportNotificationQueuePayload(
    message: StructuredSurfaceQueuedMessageRecord,
  ): ThreadReportNotificationQueuePayload | null {
    if (!message.payloadJson) {
      return null;
    }
    try {
      const payload = JSON.parse(message.payloadJson) as ThreadReportNotificationQueuePayload;
      if (
        typeof payload.threadId !== "string" ||
        typeof payload.sourceCommandId !== "string" ||
        typeof payload.turnId !== "string" ||
        typeof payload.summary !== "string" ||
        typeof payload.episodeId !== "string"
      ) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private parseThreadFollowupQueuePayload(
    message: StructuredSurfaceQueuedMessageRecord,
  ): ThreadFollowupQueuePayload | null {
    if (!message.payloadJson) {
      return null;
    }
    try {
      const payload = JSON.parse(message.payloadJson) as ThreadFollowupQueuePayload;
      if (
        typeof payload.threadId !== "string" ||
        typeof payload.sourceCommandId !== "string" ||
        typeof payload.message !== "string" ||
        typeof payload.activate !== "boolean"
      ) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private parseReportRequestQueuePayload(
    message: StructuredSurfaceQueuedMessageRecord,
  ): ReportRequestQueuePayload | null {
    if (!message.payloadJson) {
      return null;
    }
    try {
      const payload = JSON.parse(message.payloadJson) as ReportRequestQueuePayload;
      if (
        typeof payload.threadId !== "string" ||
        typeof payload.sourceCommandId !== "string" ||
        typeof payload.request !== "string"
      ) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private parseRequestUserInputAnswerQueuePayload(
    message: StructuredSurfaceQueuedMessageRecord,
  ): RequestUserInputAnswerQueuePayload | null {
    if (!message.payloadJson) {
      return null;
    }
    try {
      return Exit.match(
        decodeUnknownRequestUserInputAnswerQueuePayloadExit(JSON.parse(message.payloadJson)),
        {
          onFailure: () => null,
          onSuccess: (value) => value,
        },
      );
    } catch {
      return null;
    }
  }

  private getQueuedMessageText(messageJson: string): string {
    try {
      const parsed = JSON.parse(messageJson) as unknown;
      const runtimeMessage = unsafeDecodeRuntimeSubmittedMessageSyncForTestsAndBootstrap(parsed);
      return runtimeSubmittedMessagePromptText(runtimeMessage).trim();
    } catch {
      try {
        const message = JSON.parse(messageJson) as Message;
        if (message.role !== "user") return "";
        return flattenUserMessageContent(message.content).trim();
      } catch {
        return "";
      }
    }
  }

  private assertQueuedMessageBelongsToSurface(
    queuedMessageId: string,
    target: PromptTarget,
  ): ReturnType<StructuredSessionStateStore["getSurfaceQueuedMessage"]> {
    const queued = this.getRuntimeSurfaceQueuedMessage({ id: queuedMessageId });
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
        refreshExternalSources: true,
      });
    }
  }

  private async emitSurfaceSync(input: {
    refreshExternalSources?: boolean;
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
        snapshot: await this.buildSurfaceSnapshot(input.session, input.target, {
          refreshExternalSources: input.refreshExternalSources === true,
        }),
      });
    } catch (error) {
      console.error("Failed to emit surface sync payload:", error);
    }
  }

  private async openArtifactFromRuntime(input: {
    sessionId: string;
    artifactId: string;
  }): Promise<boolean> {
    return this.emitWorkspaceSync("artifact.open", {
      artifactOpenRequest: {
        workspaceSessionId: input.sessionId,
        artifactId: input.artifactId,
      },
    });
  }

  private async emitWorkspaceSync(
    reason: WorkspaceSyncMessage["reason"],
    extra: Pick<WorkspaceSyncMessage, "artifactOpenRequest"> = {},
  ): Promise<boolean> {
    if (this.closed || !this.workspaceSyncListener) {
      return false;
    }

    try {
      const payload = await this.listSessions();
      if (this.closed) {
        return false;
      }
      this.workspaceSyncListener({
        workspaceId: this.workspaceId,
        reason,
        sessions: payload.sessions,
        navigation: payload.navigation,
        ...extra,
      });
      return true;
    } catch (error) {
      if (this.closed) {
        return false;
      }
      console.error("Failed to emit workspace sync payload:", error);
      return false;
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

  private buildOrchestratorPromptTarget(workspaceSessionId: string): PromptTarget {
    return {
      workspaceSessionId,
      surface: "orchestrator",
      surfacePiSessionId: workspaceSessionId,
    };
  }

  private buildSystemPromptForTarget(
    target: PromptTarget,
    options: {
      extensionState?: { loadedExtensionIds: string[]; availableExtensionIds: string[] };
      externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
    } = {},
  ): string {
    return this.buildAggregateForTarget(target, options).outputs.prompt;
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

  private resolveThreadProfileSettings(
    surfacePiSessionId: string,
  ): Pick<AgentProfileSettings, "provider" | "model" | "reasoningEffort"> | null {
    for (const session of this.structuredSessionStore.listSessionStates()) {
      const thread = session.threads.find(
        (candidate) => candidate.surfacePiSessionId === surfacePiSessionId,
      );
      if (!thread?.agentProfileJson) continue;
      try {
        const parsed = JSON.parse(thread.agentProfileJson) as Partial<AgentProfileSettings>;
        if (parsed.provider && parsed.model && parsed.reasoningEffort) {
          return {
            provider: parsed.provider,
            model: parsed.model,
            reasoningEffort: parsed.reasoningEffort,
          };
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  private resolveSurfaceExtensionState(
    surfacePiSessionId: string,
  ): { loadedExtensionIds: string[]; availableExtensionIds: string[] } | null {
    for (const session of this.structuredSessionStore.listSessionStates()) {
      if (session.session.id === surfacePiSessionId) {
        if (session.pi.loadedExtensionIds && session.pi.availableExtensionIds) {
          return {
            loadedExtensionIds: session.pi.loadedExtensionIds,
            availableExtensionIds: session.pi.availableExtensionIds,
          };
        }
        return null;
      }
      const thread = session.threads.find(
        (candidate) => candidate.surfacePiSessionId === surfacePiSessionId,
      );
      if (thread) {
        return {
          loadedExtensionIds: thread.loadedExtensionIds,
          availableExtensionIds: thread.availableExtensionIds,
        };
      }
      const workflowTaskAttempt = session.workflowTaskAttempts.find(
        (candidate) => candidate.surfacePiSessionId === surfacePiSessionId,
      );
      if (workflowTaskAttempt) {
        const binding = workflowTaskAttempt.generatedAgentContextFingerprint
          ? this.structuredSessionStore.getGeneratedAgentContextBinding({
              surfacePiSessionId,
              generatedAgentContextFingerprint:
                workflowTaskAttempt.generatedAgentContextFingerprint,
            })
          : null;
        if (binding) {
          return {
            loadedExtensionIds: binding.loadedExtensionIds,
            availableExtensionIds: binding.availableExtensionIds,
          };
        }
      }
    }
    return null;
  }

  private resolveStoredGeneratedAgentContextFingerprint(surfacePiSessionId: string): string | null {
    for (const session of this.structuredSessionStore.listSessionStates()) {
      if (session.session.id === surfacePiSessionId) {
        return session.pi.generatedAgentContextFingerprint ?? null;
      }
      const thread = session.threads.find(
        (candidate) => candidate.surfacePiSessionId === surfacePiSessionId,
      );
      if (thread) {
        return thread.generatedAgentContextFingerprint ?? null;
      }
      const workflowTaskAttempt = session.workflowTaskAttempts.find(
        (candidate) => candidate.surfacePiSessionId === surfacePiSessionId,
      );
      if (workflowTaskAttempt) {
        return workflowTaskAttempt.generatedAgentContextFingerprint ?? null;
      }
    }
    return null;
  }

  private syncGeneratedAgentContextBindingForTarget(
    target: PromptTarget,
    session: ManagedSession,
  ): void {
    this.structuredSessionStore.upsertGeneratedAgentContextBinding({
      surfacePiSessionId: session.sessionId,
      ownerKind: target.surface === "handler" && target.threadId ? "thread" : "session",
      ownerId:
        target.surface === "handler" && target.threadId
          ? target.threadId
          : target.workspaceSessionId,
      actorKind: target.surface === "handler" ? "handler" : "orchestrator",
      aggregateCacheKey: session.generatedAgentContextAggregateKey,
      systemPrompt: session.systemPrompt,
      svvyxGuidance: session.generatedAgentContextAggregate.svvyxGuidance,
      commandsDts: session.generatedAgentContextAggregate.commandsDts,
      nativeToolSchemasJson: session.generatedAgentContextAggregate.nativeToolSchemasJson,
      generatedAgentContextFingerprint: session.generatedAgentContextFingerprint,
      generatedAgentContextRevision: session.generatedAgentContextRevision,
      loadedExtensionIds: session.loadedExtensionIds,
      availableExtensionIds: session.availableExtensionIds,
      externalSourceHashes: session.externalSourceHashes,
    });
    if (target.surface === "orchestrator") {
      this.syncStructuredPiSessionFromOrchestratorSession(session);
      return;
    }
    if (!target.threadId) {
      return;
    }
    this.structuredSessionStore.updateThread({
      threadId: target.threadId,
      generatedAgentContextFingerprint: session.generatedAgentContextFingerprint,
    });
  }

  private recordAgentContextUpdatedEvent(
    target: PromptTarget,
    previous: {
      systemPrompt: string;
      generatedAgentContextFingerprint: string | null;
      loadedExtensionIds: string[];
      availableExtensionIds: string[];
      externalSourceHashes: string[];
    },
    refreshed: ManagedSession,
  ): void {
    if (previous.generatedAgentContextFingerprint === refreshed.generatedAgentContextFingerprint) {
      return;
    }

    this.structuredSessionStore.recordLifecycleEvent({
      sessionId: target.workspaceSessionId,
      kind: "Agent context updated",
      subjectKind: target.surface === "handler" && target.threadId ? "thread" : "session",
      subjectId:
        target.surface === "handler" && target.threadId
          ? target.threadId
          : target.workspaceSessionId,
      data: {
        surface: target.surface,
        surfacePiSessionId: target.surfacePiSessionId,
        previousFingerprint: previous.generatedAgentContextFingerprint,
        currentFingerprint: refreshed.generatedAgentContextFingerprint,
        systemPromptChanged: previous.systemPrompt !== refreshed.systemPrompt,
        loadedExtensionIds: diffStringSet(
          previous.loadedExtensionIds,
          refreshed.loadedExtensionIds,
        ),
        availableExtensionIds: diffStringSet(
          previous.availableExtensionIds,
          refreshed.availableExtensionIds,
        ),
        externalSourceHashes: diffStringSet(
          previous.externalSourceHashes,
          refreshed.externalSourceHashes,
        ),
      },
    });
  }

  private resolveCurrentExtensionStateForTarget(
    target: PromptTarget,
    managed: ManagedSession | null,
    options: {
      includeManagedLoadedExtensions?: boolean;
    } = {},
  ): { loadedExtensionIds: string[]; availableExtensionIds: string[] } {
    if (target.surface === "handler" && target.threadId) {
      const thread =
        this.getStructuredSnapshot(target.workspaceSessionId)?.threads.find(
          (candidate) => candidate.id === target.threadId,
        ) ?? null;
      return {
        loadedExtensionIds: thread?.loadedExtensionIds ?? managed?.loadedExtensionIds ?? [],
        availableExtensionIds:
          thread?.availableExtensionIds ?? managed?.availableExtensionIds ?? [],
      };
    }

    const snapshot = this.getStructuredSnapshot(target.workspaceSessionId);
    const profileId = snapshot?.pi.orchestratorAgentProfileId ?? DEFAULT_ORCHESTRATOR_PROFILE_ID;
    const currentProfile =
      this.agentSettingsStore
        .getState()
        .agents.orchestrators.find((agent) => agent.id === profileId) ??
      this.resolveOrchestratorProfileSettingsFromSnapshot(snapshot, profileId);
    const current = resolveActorExtensionState({
      actor: "orchestrator",
      defaultExtensionOrder: this.agentSettingsStore.getState().extensionDefaults.order,
      defaultExtensionUsage: this.agentSettingsStore.getState().extensionDefaults.usage,
      profileExtensionUsage: currentProfile.extensionUsage,
      profileExtensionOrder: currentProfile.extensionOrder,
    });
    const sessionLoadedExtensionIds =
      managed?.loadedExtensionIds ?? snapshot?.pi.loadedExtensionIds ?? [];
    const sessionAvailableExtensionIds =
      managed?.availableExtensionIds ?? snapshot?.pi.availableExtensionIds ?? [];
    if (options.includeManagedLoadedExtensions === false) {
      const baselineProfile = this.resolveOrchestratorProfileSettingsFromSnapshot(
        snapshot,
        profileId,
      );
      const baseline = resolveActorExtensionState({
        actor: "orchestrator",
        defaultExtensionOrder: this.agentSettingsStore.getState().extensionDefaults.order,
        defaultExtensionUsage: this.agentSettingsStore.getState().extensionDefaults.usage,
        profileExtensionUsage: baselineProfile.extensionUsage,
        profileExtensionOrder: baselineProfile.extensionOrder,
      });
      const baselineLoaded = new Set(baseline.loadedExtensionIds);
      const dynamicallyLoaded = sessionLoadedExtensionIds.filter((id) => !baselineLoaded.has(id));
      if (dynamicallyLoaded.length === 0) {
        return current;
      }
      const loaded = new Set([...current.loadedExtensionIds, ...dynamicallyLoaded]);
      return {
        loadedExtensionIds: [...loaded],
        availableExtensionIds: current.availableExtensionIds.filter((id) => !loaded.has(id)),
      };
    }
    if (sessionLoadedExtensionIds.length === 0) {
      return current;
    }
    const loaded = new Set([...current.loadedExtensionIds, ...sessionLoadedExtensionIds]);
    const available = new Set([...current.availableExtensionIds, ...sessionAvailableExtensionIds]);
    return {
      loadedExtensionIds: [...loaded],
      availableExtensionIds: [...available].filter((id) => !loaded.has(id)),
    };
  }

  private buildPromptFromLibrary(
    actor: SvvyActorKind,
    options: {
      loadedExtensionIds?: readonly string[];
      availableExtensionIds?: readonly string[];
      externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
      customInstructions?: string;
    } = {},
  ): string {
    return this.buildPromptAggregateFromLibrary(actor, options).outputs.prompt;
  }

  private buildAgentContextPreviewExtensions(
    actor: SvvyActorKind,
    extensionState: { loadedExtensionIds: string[]; availableExtensionIds: string[] },
    externalInstructionSources: readonly GeneratedAgentContextExternalSource[],
    modelContext: { provider: string; model: string },
  ): AgentContextPreviewExtension[] {
    const activeIds = [
      ...extensionState.loadedExtensionIds.map((id) => ({ id, state: "loaded" as const })),
      ...extensionState.availableExtensionIds.map((id) => ({ id, state: "available" as const })),
    ];
    const records = new Map(
      resolveExtensionRecords(
        activeIds.map((entry) => entry.id),
        this.extensionsRoot,
      ).map((record) => [record.id, record]),
    );
    const generatedAgentContextState = this.generatedAgentContextStore.getState();
    const requestUserInputSettings = this.agentSettingsStore.getState().requestUserInput;
    return activeIds.map((entry) => {
      const record = records.get(entry.id);
      const extensionRecords = record ? [record] : [];
      const buildInstruction = (state: "loaded" | "available") =>
        state === "loaded"
          ? buildSystemPrompt(actor, {
              loadedExtensionIds: [entry.id],
              loadedExtensionRecords: extensionRecords,
              availableExtensionIds: [],
              externalInstructionSources,
              extensionsRoot: this.extensionsRoot,
              generatedAgentContextState,
              workspaceKey: this.cwd,
              requestUserInputSettings,
            })
          : buildSystemPrompt(actor, {
              loadedExtensionIds: [],
              loadedExtensionRecords: [],
              availableExtensionIds: [entry.id],
              availableExtensionRecords: extensionRecords,
              externalInstructionSources,
              extensionsRoot: this.extensionsRoot,
              generatedAgentContextState,
              workspaceKey: this.cwd,
              requestUserInputSettings,
            });
      const countInstruction = (text: string) =>
        text.trim()
          ? countPromptTokens({
              ...modelContext,
              text,
            })
          : undefined;
      const instruction =
        entry.state === "loaded" ? buildInstruction("loaded") : buildInstruction("available");
      const loadedInstruction =
        entry.state === "available" ? buildInstruction("loaded") : undefined;
      return {
        id: entry.id,
        title: record?.title ?? entry.id,
        description: record?.description ?? "",
        state: entry.state,
        sourcePath: record?.instructionSourceFiles[0],
        instruction,
        tokenCount: countInstruction(instruction),
        loadedTokenCount: loadedInstruction ? countInstruction(loadedInstruction) : undefined,
      };
    });
  }

  private buildPromptAggregateFromLibrary(
    actor: SvvyActorKind,
    options: {
      loadedExtensionIds?: readonly string[];
      availableExtensionIds?: readonly string[];
      externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
      customInstructions?: string;
    } = {},
  ): GeneratedAgentContextAggregateResult {
    const loadedExtensionIds = options.loadedExtensionIds ?? [];
    const availableExtensionIds = options.availableExtensionIds ?? [];
    const loadedExtensionRecords = resolveExtensionRecords(loadedExtensionIds, this.extensionsRoot);
    const availableExtensionRecords = resolveExtensionRecords(
      availableExtensionIds,
      this.extensionsRoot,
    );
    const generatedAgentContextState = this.generatedAgentContextStore.getState();
    const requestUserInputSettings = this.agentSettingsStore.getState().requestUserInput;
    const prompt = buildSystemPrompt(actor, {
      ...options,
      loadedExtensionRecords,
      availableExtensionRecords,
      extensionsRoot: this.extensionsRoot,
      generatedAgentContextState,
      workspaceKey: this.cwd,
      requestUserInputSettings,
    });
    const customInstructions =
      actor === "workflow-task" ? options.customInstructions?.trim() || "" : "";
    const resolvedPrompt = customInstructions
      ? `## Custom Instructions\n${customInstructions}\n\n${prompt}`
      : prompt;
    return this.generatedAgentContextAggregateCache.getOrCreate(
      {
        actorKind: actor,
        loadedExtensionIds,
        availableExtensionIds,
        extensionContextFingerprints: createExtensionContextFingerprints([
          ...loadedExtensionRecords,
          ...availableExtensionRecords,
        ]),
        generatedAgentContextContentKey: getGeneratedAgentContextContentKey(
          generatedAgentContextState,
        ),
        agentContextFormatVersion: GENERATED_AGENT_CONTEXT_AGGREGATE_FORMAT_VERSION,
        externalInstructionsFingerprint: createExternalInstructionsFingerprint(
          options.externalInstructionSources ?? [],
        ),
        promptSettingsFingerprint: createPromptSettingsFingerprint({
          requestUserInputSettings,
          customInstructions,
        }),
        workspaceKey: this.cwd,
      },
      () => ({
        prompt: resolvedPrompt,
        svvyxGuidance: buildGeneratedSvvyxGuidance(loadedExtensionRecords),
        commandsDts: buildExecuteTypescriptApiDeclaration(actor, {
          extensionsRoot: this.extensionsRoot,
          loadedExtensionIds,
          loadedExtensionRecords,
        }),
        nativeToolSchemasJson: buildNativeToolSchemasJson(loadedExtensionRecords),
      }),
    );
  }

  private buildAggregateForTarget(
    target: PromptTarget,
    options: {
      extensionState?: { loadedExtensionIds: string[]; availableExtensionIds: string[] };
      externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
    } = {},
  ): GeneratedAgentContextAggregateResult {
    if (target.surface !== "handler" || !target.threadId) {
      const extensionState =
        options.extensionState ??
        this.resolveCurrentExtensionStateForTarget(
          target,
          this.managedSurfaces.get(target.surfacePiSessionId) ?? null,
        );
      return this.buildPromptAggregateFromLibrary("orchestrator", {
        ...extensionState,
        externalInstructionSources: options.externalInstructionSources ?? [],
      });
    }

    const thread =
      this.getStructuredSnapshot(target.workspaceSessionId)?.threads.find(
        (candidate) => candidate.id === target.threadId,
      ) ?? null;
    return this.buildPromptAggregateFromLibrary("handler", {
      loadedExtensionIds: options.extensionState?.loadedExtensionIds ?? thread?.loadedExtensionIds,
      availableExtensionIds:
        options.extensionState?.availableExtensionIds ?? thread?.availableExtensionIds,
      externalInstructionSources: options.externalInstructionSources ?? [],
    });
  }

  private buildPromptBinding(
    session: ManagedSession,
    target: PromptTarget,
    currentExternalSources: readonly GeneratedAgentContextExternalSource[],
  ) {
    const currentState = this.generatedAgentContextStore.getState();
    const currentExtensionState = this.resolveCurrentExtensionStateForTarget(target, session, {
      includeManagedLoadedExtensions: false,
    });
    const currentSystemPrompt = this.buildSystemPromptForTarget(target, {
      extensionState: currentExtensionState,
      externalInstructionSources: currentExternalSources,
    });
    const currentExternalSourceHashes = externalSourceHashes(currentExternalSources);
    const boundExternalSourceHashes = session.externalSourceHashes;
    const currentFingerprint = createGeneratedAgentContextFingerprint({
      systemPrompt: currentSystemPrompt,
      loadedExtensionIds: currentExtensionState.loadedExtensionIds,
      availableExtensionIds: currentExtensionState.availableExtensionIds,
      externalContextSources: currentExternalSources,
    });
    return {
      currentRevision: currentState.revision,
      boundSystemPrompt: session.systemPrompt,
      currentSystemPrompt,
      boundFingerprint: session.generatedAgentContextFingerprint,
      currentFingerprint,
      boundExternalSourceHashes,
      currentExternalSourceHashes,
      updateExtensionContextBeforeNextTurn:
        this.getExtensionContextAutoUpdateForTarget(target) ?? true,
      stale: session.generatedAgentContextFingerprint !== currentFingerprint,
    };
  }

  private getExtensionContextAutoUpdateForTarget(target: PromptTarget): boolean | null {
    const snapshot = this.getStructuredSnapshot(target.workspaceSessionId);
    if (!snapshot) {
      return null;
    }
    if (target.surface === "handler") {
      const thread = snapshot.threads.find((candidate) => candidate.id === target.threadId);
      return thread?.updateExtensionContextBeforeNextTurn ?? true;
    }
    return snapshot.pi.updateExtensionContextBeforeNextTurn ?? true;
  }

  private resolveOrchestratorProfileSettingsFromSnapshot(
    snapshot: StructuredSessionSnapshot | null | undefined,
    key: AgentProfileId,
  ): AgentProfileSettings {
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
      const parsed = JSON.parse(json) as Partial<AgentProfileSettings>;
      if (parsed.provider && parsed.model && parsed.reasoningEffort) {
        return {
          ...current,
          ...parsed,
          extensionUsage:
            parsed.extensionUsage && typeof parsed.extensionUsage === "object"
              ? parsed.extensionUsage
              : current.extensionUsage,
        };
      }
    } catch {
      return current;
    }
    return current;
  }

  private resolvePromptTargetForSurfacePiSessionId(surfacePiSessionId: string): PromptTarget {
    const target = this.tryResolvePromptTargetForSurfacePiSessionId(surfacePiSessionId);
    if (target) {
      return target;
    }
    return this.buildOrchestratorPromptTarget(surfacePiSessionId);
  }

  private tryResolvePromptTargetForSurfacePiSessionId(
    surfacePiSessionId: string,
  ): PromptTarget | null {
    for (const session of this.structuredSessionStore.listSessionStates()) {
      const thread = session.threads.find(
        (candidate) => candidate.surfacePiSessionId === surfacePiSessionId,
      );
      if (thread) {
        return {
          workspaceSessionId: session.session.id,
          surface: "handler",
          surfacePiSessionId,
          threadId: thread.id,
        };
      }
    }

    const session = this.structuredSessionStore
      .listSessionStates()
      .find((candidate) => candidate.session.id === surfacePiSessionId);
    return session ? this.buildOrchestratorPromptTarget(surfacePiSessionId) : null;
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
          snapshot?.pi.orchestratorAgentProfileId ??
          (DEFAULT_ORCHESTRATOR_PROFILE_ID as CoreAgentProfileId),
        orchestratorAgentProfileJson:
          snapshot?.pi.orchestratorAgentProfileJson ??
          JSON.stringify(this.resolveOrchestratorAgentProfile(DEFAULT_ORCHESTRATOR_PROFILE_ID)),
        generatedAgentContextFingerprint: snapshot?.pi.generatedAgentContextFingerprint ?? null,
        loadedExtensionIds: snapshot?.pi.loadedExtensionIds,
        availableExtensionIds: snapshot?.pi.availableExtensionIds,
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
      orchestratorAgentProfileId: session.agentProfileId as CoreAgentProfileId,
      orchestratorAgentProfileJson: JSON.stringify(profile),
      generatedAgentContextFingerprint: session.generatedAgentContextFingerprint,
      loadedExtensionIds: session.loadedExtensionIds,
      availableExtensionIds: session.availableExtensionIds,
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

  private async queueThreadReportNotification(
    request: ThreadReportNotificationRequest,
  ): Promise<void> {
    const orchestratorTarget = this.buildOrchestratorPromptTarget(
      request.runtime.workspaceSessionId,
    );
    const payload: ThreadReportNotificationQueuePayload = {
      threadId: request.runtime.threadId!,
      sourceCommandId: request.commandId,
      turnId: request.runtime.turnId!,
      summary: request.episode.summary,
      episodeId: request.episode.id,
      outcome: request.outcome,
    };
    await this.enqueueRuntimeSurfaceMessageAsync({
      sessionId: orchestratorTarget.workspaceSessionId,
      surfacePiSessionId: orchestratorTarget.surfacePiSessionId,
      kind: "thread_report_notification",
      idempotencyKey: `thread_report_notification:${request.episode.id}`,
      messageJson: "{}",
      payloadJson: JSON.stringify(payload),
    });

    void this.emitQueuedSurfaceUpdate(orchestratorTarget);
  }

  private getStructuredSnapshot(sessionId: string): StructuredSessionSnapshot | null {
    try {
      return this.structuredSessionStore.getSessionState(sessionId);
    } catch {
      return null;
    }
  }

  private requireStructuredSnapshot(sessionId: string): StructuredSessionSnapshot {
    const snapshot = this.getStructuredSnapshot(sessionId);
    if (!snapshot) {
      throw new Error(`Structured session not found: ${sessionId}`);
    }
    return snapshot;
  }

  private async getDerivedStructuredSnapshot(
    sessionId: string,
  ): Promise<StructuredSessionSnapshot | null> {
    return this.getStructuredSnapshot(sessionId);
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
      productEvents: view.productEvents.length > 0 ? view.productEvents : undefined,
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

  private async getSessionFileForId(
    sessionId: string,
    required = true,
  ): Promise<string | undefined> {
    const managedSurface = this.managedSurfaces.get(sessionId);
    if (managedSurface) {
      return managedSurface.session.sessionManager.getSessionFile();
    }

    for (const sessionDir of [
      this.sessionDir,
      this.threadSurfaceDir,
      this.workflowTaskSurfaceDir,
    ]) {
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
    threadGroupId?: string | null;
    objective: string;
    historyMode?: "isolated" | "forked";
    overrides?: Record<string, "loaded" | "available" | "unavailable"> | null;
    agentProfileSettings: AgentProfileSettings | null;
    loadedByCommandId: string;
    autoStart?: boolean;
  }) {
    const initialTitle = input.objective.trim();
    const parentSessionFile = await this.getSessionFileForId(input.parentSurfacePiSessionId);
    const threadSessionManager = SessionManager.create(this.cwd, this.threadSurfaceDir);
    threadSessionManager.newSession();
    threadSessionManager.appendSessionInfo(initialTitle);
    persistSessionManagerSnapshot(threadSessionManager);
    const threadAgentSettings = input.agentProfileSettings
      ? {
          extensionUsage: input.agentProfileSettings.extensionUsage,
          extensionOrder: input.agentProfileSettings.extensionOrder,
          provider: input.agentProfileSettings.provider,
          model: input.agentProfileSettings.model,
          reasoningEffort: input.agentProfileSettings.reasoningEffort,
        }
      : this.agentSettingsStore.getState().agents.special.threadHandler;

    const extensionState = resolveThreadExtensionState(
      threadAgentSettings.extensionUsage,
      threadAgentSettings.extensionOrder,
      input.overrides ?? null,
    );
    const thread = this.structuredSessionStore.createThread({
      turnId: input.turnId,
      parentThreadId: input.parentThreadId,
      threadGroupId: input.threadGroupId ?? null,
      surfacePiSessionId: threadSessionManager.getSessionId(),
      title: initialTitle,
      objective: input.objective,
      historyMode: input.historyMode ?? "isolated",
      loadedExtensionIds: extensionState.loadedExtensionIds,
      availableExtensionIds: extensionState.availableExtensionIds,
      agentProfileJson: JSON.stringify(threadAgentSettings),
    });
    const externalContextSources = await this.buildCurrentExternalContextSources();
    const threadTarget: PromptTarget = {
      workspaceSessionId: input.sessionId,
      surface: "handler",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
    };
    const threadAggregate = this.buildAggregateForTarget(threadTarget, {
      externalInstructionSources: externalContextSources,
    });
    const threadSystemPrompt = threadAggregate.outputs.prompt;
    const threadGeneratedAgentContextFingerprint = createGeneratedAgentContextFingerprint({
      systemPrompt: threadSystemPrompt,
      loadedExtensionIds: extensionState.loadedExtensionIds,
      availableExtensionIds: extensionState.availableExtensionIds,
      externalContextSources,
    });
    this.structuredSessionStore.updateThread({
      threadId: thread.id,
      generatedAgentContextFingerprint: threadGeneratedAgentContextFingerprint,
    });
    this.structuredSessionStore.upsertGeneratedAgentContextBinding({
      surfacePiSessionId: thread.surfacePiSessionId,
      ownerKind: "thread",
      ownerId: thread.id,
      actorKind: "handler",
      aggregateCacheKey: threadAggregate.cacheKey,
      systemPrompt: threadSystemPrompt,
      svvyxGuidance: threadAggregate.outputs.svvyxGuidance,
      commandsDts: threadAggregate.outputs.commandsDts,
      nativeToolSchemasJson: threadAggregate.outputs.nativeToolSchemasJson,
      generatedAgentContextFingerprint: threadGeneratedAgentContextFingerprint,
      generatedAgentContextRevision: this.generatedAgentContextStore.getState().revision,
      loadedExtensionIds: extensionState.loadedExtensionIds,
      availableExtensionIds: extensionState.availableExtensionIds,
      externalSourceHashes: externalSourceHashes(externalContextSources).toSorted(),
    });
    if (input.autoStart !== false) {
      this.enqueueInitialHandlerThreadPrompt({
        sessionId: input.sessionId,
        threadId: thread.id,
        parentSessionFile: input.historyMode === "forked" ? parentSessionFile : null,
      });
    }
    this.recoveryCoordinator.enqueue({
      kind: "title_generation",
      ownerScope: { kind: "title_job", titleJobId: `thread:${thread.id}` as TitleJobId },
      idempotencyKey: `title_generation:thread:${thread.id}`,
      orderingKey: `thread:${thread.id}`,
      priority: 70,
      payloadJson: { threadId: thread.id },
    });
    this.recoveryCoordinator.wake();
    return this.structuredSessionStore.getThreadDetail(thread.id).thread;
  }

  private async queueThreadFollowup(input: {
    runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>;
    commandId: string;
    threadIds: string[] | null;
    threadGroupId: string | null;
    message: string;
    activate: boolean;
  }) {
    const snapshot = this.requireStructuredSnapshot(input.runtime.workspaceSessionId);
    const threads = resolveThreadTargets(snapshot, {
      threadIds: input.threadIds,
      threadGroupId: input.threadGroupId,
    });
    const queuedThreads = [];
    for (const thread of threads) {
      if (thread.objectiveState === "concluded") {
        if (!input.activate) {
          throw new Error(
            `thread_followup requires activate: true for concluded handler thread ${thread.id}.`,
          );
        }
        this.structuredSessionStore.updateThread({
          threadId: thread.id,
          objectiveState: "active",
          status: "running-handler",
          wait: null,
        });
      }
      const target: PromptTarget = {
        workspaceSessionId: input.runtime.workspaceSessionId,
        surface: "handler",
        surfacePiSessionId: thread.surfacePiSessionId,
        threadId: thread.id,
      };
      const payload: ThreadFollowupQueuePayload = {
        threadId: thread.id,
        sourceCommandId: input.commandId,
        message: input.message,
        activate: input.activate,
      };
      const queued = await this.enqueueRuntimeSurfaceMessageAsync({
        sessionId: input.runtime.workspaceSessionId,
        surfacePiSessionId: thread.surfacePiSessionId,
        threadId: thread.id,
        kind: "thread_followup",
        idempotencyKey: `thread_followup:${input.commandId}:${thread.id}`,
        messageJson: "{}",
        payloadJson: JSON.stringify(payload),
      });
      await this.emitQueuedSurfaceUpdate(target);
      const refreshed = this.requireStructuredSnapshot(
        input.runtime.workspaceSessionId,
      ).threads.find((entry) => entry.id === thread.id);
      queuedThreads.push({
        threadId: thread.id,
        surfacePiSessionId: thread.surfacePiSessionId,
        objectiveState: refreshed?.objectiveState ?? thread.objectiveState,
        queuedMessageId: queued.id,
      });
    }
    return {
      threadGroupId: input.threadGroupId ?? threads[0]?.threadGroupId ?? null,
      threads: queuedThreads,
    };
  }

  private async queueThreadReportRequest(input: {
    runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>;
    commandId: string;
    threadId: string;
    request: string | null;
  }) {
    const snapshot = this.requireStructuredSnapshot(input.runtime.workspaceSessionId);
    const thread = snapshot.threads.find((entry) => entry.id === input.threadId) ?? null;
    if (!thread) {
      throw new Error(`Delegated handler thread not found: ${input.threadId}`);
    }
    if (thread.objectiveState === "concluded") {
      throw new Error(`thread_request_report cannot target concluded handler thread ${thread.id}.`);
    }
    const request = input.request ?? "Please provide a concise thread_report update.";
    const payload: ReportRequestQueuePayload = {
      threadId: thread.id,
      sourceCommandId: input.commandId,
      request,
    };
    const queued = await this.enqueueRuntimeSurfaceMessageAsync({
      sessionId: input.runtime.workspaceSessionId,
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      kind: "report_request",
      idempotencyKey: `report_request:${input.commandId}:${thread.id}`,
      messageJson: "{}",
      payloadJson: JSON.stringify(payload),
    });
    const target: PromptTarget = {
      workspaceSessionId: input.runtime.workspaceSessionId,
      surface: "handler",
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
    };
    await this.emitQueuedSurfaceUpdate(target);
    return {
      threadId: thread.id,
      surfacePiSessionId: thread.surfacePiSessionId,
      queuedMessageId: queued.id,
    };
  }

  private enqueueInitialHandlerThreadPrompt(input: {
    sessionId: string;
    threadId: string;
    parentSessionFile?: string | null;
  }): void {
    const snapshot = this.getStructuredSnapshot(input.sessionId);
    const thread = snapshot?.threads.find((entry) => entry.id === input.threadId) ?? null;
    if (!snapshot || !thread || thread.status !== "running-handler") {
      return;
    }
    if (snapshot.turns.some((turn) => turn.threadId === thread.id)) {
      return;
    }
    this.enqueueRuntimeSurfaceMessage({
      sessionId: input.sessionId,
      surfacePiSessionId: thread.surfacePiSessionId,
      threadId: thread.id,
      kind: "initial_handler_start",
      idempotencyKey: `initial_handler_start:${thread.id}`,
      messageJson: "{}",
      payloadJson: JSON.stringify({
        threadId: thread.id,
        parentSessionFile: input.parentSessionFile ?? null,
        requestedAt: new Date().toISOString(),
      } satisfies InitialHandlerStartQueuePayload),
    });
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
        workspaceSessionId: sessionId,
        surfacePiSessionId: snapshot.pi.sessionId,
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
      const settings = this.agentSettingsStore.getState().agents.titleNamer;
      const cause = error instanceof Error ? error.message : "Title generation failed.";
      const message = `Title namer ${settings.provider}/${settings.model} failed: ${cause}`;
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
      workspaceSessionId: detail.thread.sessionId,
      surfacePiSessionId: detail.thread.surfacePiSessionId,
      threadId: detail.thread.id,
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
    workspaceSessionId: string;
    surfacePiSessionId: string;
    threadId?: string;
    promptLabel: string;
    text: string;
  }): Promise<string> {
    const settings = this.agentSettingsStore.getState().agents.titleNamer;
    const prompt = buildTitleHelperPrompt({
      systemPrompt: settings.systemPrompt,
      promptLabel: input.promptLabel,
      text: input.text,
    });
    const providerAuthPort = this.createTitleProviderAuthPort();
    const runtimePathsPort = this.createPiRuntimePathsPort();
    const result = await this.runCatalogEffect(
      Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        return yield* adapter.helperJobs.generateTitle({
          workspaceId: input.workspaceSessionId as WorkspaceId,
          workspaceSessionId: input.workspaceSessionId as WorkspaceSessionId,
          surfacePiSessionId: input.surfacePiSessionId as SurfacePiSessionId,
          ...(input.threadId ? { threadId: input.threadId as never } : {}),
          prompt,
          model: {
            providerId: settings.provider as never,
            modelId: settings.model as never,
          },
          reasoning: { effort: settings.reasoningEffort },
        });
      }).pipe(
        Effect.provide(PiAdapterLayer),
        Effect.provideService(ProviderAuthPort, providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, runtimePathsPort),
      ),
    );
    return result.title;
  }

  private createTitleProviderAuthPort(): ProviderAuthPortService {
    return {
      getProviderAuthSnapshot: (input) =>
        Effect.tryPromise({
          try: async () =>
            this.resolveProviderCredentialSnapshot(input.providerId, input.workspaceId),
          catch: (cause) =>
            new ProviderAuthPortError({
              operation: "session-catalog.title.providerAuthSnapshot",
              reason: "credentials-unusable",
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }),
      refreshProviderCredentialSnapshot: (input) =>
        Effect.tryPromise({
          try: async () =>
            this.resolveProviderCredentialSnapshot(
              input.providerId,
              input.workspaceId,
              input.reason,
            ),
          catch: (cause) =>
            new ProviderAuthPortError({
              operation: "session-catalog.title.refreshProviderCredentialSnapshot",
              reason: "refresh-failed",
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }),
    };
  }

  private createPiRuntimePathsPort(): PiRuntimePathsPortService {
    return {
      resolve: (input) =>
        Effect.succeed({
          workspaceId: input.workspaceId,
          cwd: this.cwd as AbsolutePath,
          agentDir: this.agentDir as AbsolutePath,
          sessionDir: this.sessionDir as AbsolutePath,
          modelRegistryPath: join(this.agentDir, "models.json") as AbsolutePath,
          source: "packaged-app",
        }),
    };
  }

  private async resolveProviderCredentialSnapshot(
    providerId: string,
    workspaceId: string | undefined,
    refreshReason?: string,
  ) {
    const token =
      refreshReason === "user_requested" || refreshReason === "runtime_retry"
        ? await refreshIfNeeded(providerId)
        : await ensureProviderAuthForManagedSession(providerId);
    const state = resolveAuthState(providerId);
    if (!token) {
      const issue = providerAuthIssue(providerId, state);
      return {
        providerId: providerId as never,
        ...(workspaceId ? { workspaceId: workspaceId as WorkspaceId } : {}),
        health:
          state.keyType === "oauth" && state.refreshFailure
            ? "refresh_failed"
            : state.keyType === "oauth"
              ? "expired"
              : "missing",
        ...(state.expiresAt ? { expiresAt: state.expiresAt as never } : {}),
        issue,
      } as const;
    }
    return {
      providerId: providerId as never,
      ...(workspaceId ? { workspaceId: workspaceId as WorkspaceId } : {}),
      health: "usable",
      accessToken: Redacted.make(token, { label: "provider-credential" }),
      ...(state.expiresAt ? { expiresAt: state.expiresAt as never } : {}),
      credentialFingerprint: createHash("sha256")
        .update(providerId)
        .update("\0")
        .update(token)
        .digest("hex"),
    } as const;
  }

  private syncPiSessionTitle(session: ManagedSession, title: string): void {
    session.session.sessionManager.appendSessionInfo(title);
    this.persistManagedSessionSnapshot(session);
  }

  private emitTitleGenerationLog(event: TitleGenerationLogEvent): void {
    this.titleGenerationLogListener?.(event);
  }

  private emitWorkflowsGeneratedPackageLog(event: WorkflowsGeneratedPackageLogEvent): void {
    this.workflowsGeneratedPackageLogListener?.(event);
  }

  private emitAppLog(event: AppLoggerEvent): void {
    this.appLogListener?.(event);
  }

  private async refreshWorkspaceGeneratedPackageLinks(
    input: InternalRefreshGeneratedPackagesRequest,
  ): Promise<void> {
    const refreshGeneratedPackages = this.recoveryOptions.refreshGeneratedPackages;
    if (!refreshGeneratedPackages) {
      return;
    }
    try {
      const result = await refreshGeneratedPackages(input);
      const linked = result.workspaceLinks.some((status) => status.status === "linked");
      this.emitAppLog({
        level: "info",
        source: "workflow.library",
        message: linked
          ? "Workflows build/link recovery refreshed package links."
          : "Workflows build/link recovery checked package links.",
        details: {
          recoveryWorkId: "recoveryWorkId" in input ? input.recoveryWorkId : undefined,
          linked,
          workspaceLinks: result.workspaceLinks,
        },
      });
    } catch (error) {
      const automaticStartupRepair =
        input.scope === "workspace-link-repair" && input.reason === "startup-recovery";
      this.emitAppLog({
        level: automaticStartupRepair ? "info" : "error",
        source: "workflow.library",
        message: automaticStartupRepair
          ? "Workflows build/link startup recovery deferred."
          : "Workflows build/link recovery failed.",
        error,
        details: {
          recoveryWorkId: "recoveryWorkId" in input ? input.recoveryWorkId : undefined,
        },
      });
      throw error;
    }
  }

  private runTaskAgentBridgeEnv(input: Parameters<runTaskAgentBridgeEnvProvider>[0]) {
    const runtime = input.runtime;
    if (!runtime?.workspaceSessionId || !input.sourceCommandId) {
      return null;
    }
    return {
      [RUN_TASK_AGENT_BRIDGE_ENV.URL]: `${this.runTaskAgentBridge.getUrl()}/runTaskAgent`,
      [RUN_TASK_AGENT_BRIDGE_ENV.TOKEN]: this.createRunTaskAgentBridgeToken({
        sourceCommandId: input.sourceCommandId,
        workspaceSessionId: runtime.workspaceSessionId,
      }),
      [RUN_TASK_AGENT_BRIDGE_ENV.WORKSPACE_SESSION_ID]: runtime.workspaceSessionId,
      [RUN_TASK_AGENT_BRIDGE_ENV.SOURCE_COMMAND_ID]: input.sourceCommandId,
      [RUN_TASK_AGENT_BRIDGE_ENV.TIMEOUT_MS]: String(
        this.runtimeLayerConfig.workflowTaskAgentBridgeRequestTimeoutMs,
      ),
      [RUN_TASK_AGENT_BRIDGE_ENV.MAX_RESPONSE_BYTES]: String(
        this.runtimeLayerConfig.workflowTaskAgentBridgeMaxResponseBytes,
      ),
    };
  }

  private createRunTaskAgentBridgeToken(input: {
    sourceCommandId: string;
    workspaceSessionId: string;
  }): string {
    return createHmac("sha256", this.runTaskAgentBridge.token)
      .update(input.workspaceSessionId)
      .update("\0")
      .update(input.sourceCommandId)
      .digest("base64url");
  }

  private isValidRunTaskAgentBridgeToken(input: {
    bearerToken: string;
    sourceCommandId: string;
    workspaceSessionId: string;
  }): boolean {
    const expected = Buffer.from(this.createRunTaskAgentBridgeToken(input));
    const actual = Buffer.from(input.bearerToken);
    return (
      actual.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  verifyRunTaskAgentBridgeBearerLineage(input: {
    bearerToken: string;
    sourceCommandId: string;
    workspaceSessionId: string;
  }): boolean {
    return this.isValidRunTaskAgentBridgeToken(input);
  }

  private async runRunTaskAgentInput(
    request: RunTaskAgentInput,
    bearerToken: string,
  ): Promise<RunTaskAgentResult> {
    if (!this.recoveryOptions.runTaskAgent) {
      throw new RunTaskAgentBridgeError(
        "task_attempt_failed",
        "Workflow task-agent execution is unavailable before app runtime bootstrap.",
        503,
      );
    }
    try {
      return await this.recoveryOptions.runTaskAgent({
        auth: {
          kind: "bearer",
          token: bearerToken,
          transport: "loopback-http",
        },
        request,
      });
    } catch (error) {
      if (error instanceof RuntimeContractError) {
        throw runtimeRunTaskAgentBridgeError(error);
      }
      throw error;
    }
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
    agentSettingsStore: ReturnType<typeof createAgentSettingsStore>;
    extensionContextImpactState: RuntimeExtensionContextImpactStateFacade;
    readArtifactRootForSession: (sessionId: string) => string | null;
    actorExtensionBindingState: RuntimeActorExtensionBindingStatePortService;
    artifactState: RuntimeArtifactStatePortService;
    commandState: RuntimeCommandStatePortService;
    episodeState: RuntimeEpisodeStatePortService;
    readModelState: RuntimeReadModelStatePortService;
    requestState: RuntimeRequestStatePortService;
    sessionWaitState: RuntimeSessionWaitStatePortService;
    threadState: RuntimeThreadStatePortService;
    turnState: RuntimeTurnStatePortService;
    runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
    runCatalogEffect: CatalogEffectRunner;
    createHandlerThread: WorkspaceSessionCatalog["createHandlerThread"];
    queueThreadFollowup: WorkspaceSessionCatalog["queueThreadFollowup"];
    queueThreadReportRequest: WorkspaceSessionCatalog["queueThreadReportRequest"];
    queueThreadReportNotification: WorkspaceSessionCatalog["queueThreadReportNotification"];
  },
): Promise<ManagedSession> {
  mkdirSync(options.agentDir, { recursive: true });

  const promptExecutionRuntime: PromptExecutionRuntimeHandle = {
    current: null,
  };
  if (!options.workspaceId) {
    throw new Error("WorkspaceSessionCatalog must inject workspace id before creating a session.");
  }
  const extensionState =
    options.loadedExtensionIds && options.availableExtensionIds
      ? {
          loadedExtensionIds: [...options.loadedExtensionIds],
          availableExtensionIds: [...options.availableExtensionIds],
        }
      : options.actorKind === "namer"
        ? { loadedExtensionIds: [], availableExtensionIds: [] }
        : resolveActorExtensionState({
            actor: options.actorKind,
          });
  const executeTypescriptTool = createExecuteTypescriptTool({
    cwd: options.sessionManager.getCwd(),
    workspaceId: options.workspaceId,
    runtime: promptExecutionRuntime,
    artifactState: options.artifactState,
    commandState: options.commandState,
    threadState: options.threadState,
    turnState: options.turnState,
    runState: options.runState,
    readArtifactRootForSession: options.readArtifactRootForSession,
    openArtifact: options.openArtifact,
    onWorkflowsGeneratedPackageChanged: options.onWorkflowsGeneratedPackageChanged,
    onAppLog: options.onAppLog,
    agentSettingsStore: options.agentSettingsStore,
    approvalMode: () => options.agentSettingsStore.getState().appPreferences.approvalMode,
    approvalBoundary: options.approvalBoundary,
    acquireExecuteTypescriptLaunch: requiredExecuteTypescriptLaunchAcquisition(
      options.acquireExecuteTypescriptLaunch,
    ),
    workflowsExtensionsGeneratedPackagePath: options.workflowsExtensionsGeneratedPackagePath,
    workflowsGeneratedPackagePath: options.workflowsGeneratedPackagePath,
    workflowsSourceRoot: options.workflowsSourceRoot,
    extensionsRoot: options.extensionsRoot,
    extensionsEnvValues: () =>
      options.agentSettingsStore.getState().extensionEnv.nonSecretOverrides,
  });
  const listExtensionsTool = createListExtensionsTool({
    runtime: promptExecutionRuntime,
    state: {
      commandState: options.commandState,
      turnState: options.turnState,
      actorExtensionBindingState: options.actorExtensionBindingState,
      runState: options.runState,
    },
    extensionsRoot: options.extensionsRoot,
  });
  const loadExtensionTool = createLoadExtensionTool({
    runtime: promptExecutionRuntime,
    state: {
      commandState: options.commandState,
      turnState: options.turnState,
      actorExtensionBindingState: options.actorExtensionBindingState,
      runState: options.runState,
    },
    runAcceptedLoadExtension: requiredAcceptedLoadExtensionRunner(options.runAcceptedLoadExtension),
    extensionsRoot: options.extensionsRoot,
  });
  const requestUserInputTool = createRequestUserInputTool({
    runtime: promptExecutionRuntime,
    state: {
      commandState: options.commandState,
      requestState: options.requestState,
      sessionWaitState: options.sessionWaitState,
      turnState: options.turnState,
      runState: options.runState,
    },
    runToolEffect: options.runCatalogEffect,
    runAcceptedRequestUserInput: requiredAcceptedRequestUserInputRunner(
      options.runAcceptedRequestUserInput,
    ),
    requestUserInputRuntime: options.requestUserInputRuntime,
  });
  const directTools = createSvvyDirectTools({
    cwd: options.sessionManager.getCwd(),
    workspaceId: options.workspaceId,
    runtime: promptExecutionRuntime,
    artifactState: options.artifactState,
    commandState: options.commandState,
    extensionContextImpactState: options.extensionContextImpactState,
    readArtifactRootForSession: options.readArtifactRootForSession,
    runState: options.runState,
    agentSettingsStore: options.agentSettingsStore,
    approvalMode: () => options.agentSettingsStore.getState().appPreferences.approvalMode,
    approvalBoundary: options.approvalBoundary,
    networkAccess: () => options.agentSettingsStore.getState().appPreferences.networkAccess,
    managedSandbox: options.managedSandbox,
    openArtifact: options.openArtifact,
    onWorkflowsGeneratedPackageChanged: options.onWorkflowsGeneratedPackageChanged,
    onAppLog: options.onAppLog,
    runTaskAgentBridge: options.runTaskAgentBridge,
    runtimeCommandStdin: options.runtimeCommandStdin,
    acquireDirectToolLaunch: options.acquireDirectToolLaunch,
  });
  const threadListTool = createThreadListTool({
    runtime: promptExecutionRuntime,
    state: {
      commandState: options.commandState,
      readModelState: options.readModelState,
      turnState: options.turnState,
      runState: options.runState,
    },
  });
  const threadEpisodesTool = createThreadEpisodesTool({
    runtime: promptExecutionRuntime,
    state: {
      commandState: options.commandState,
      readModelState: options.readModelState,
      turnState: options.turnState,
      runState: options.runState,
    },
  });
  const threadCurrentTool = createThreadCurrentTool({
    runtime: promptExecutionRuntime,
    state: {
      commandState: options.commandState,
      readModelState: options.readModelState,
      turnState: options.turnState,
      runState: options.runState,
    },
  });
  const threadGroupTool = createThreadGroupTool({
    runtime: promptExecutionRuntime,
    state: {
      commandState: options.commandState,
      readModelState: options.readModelState,
      turnState: options.turnState,
      runState: options.runState,
    },
  });
  const threadReportTool = createThreadReportTool({
    runtime: promptExecutionRuntime,
    commandState: options.commandState,
    episodeState: options.episodeState,
    readModelState: options.readModelState,
    turnState: options.turnState,
    runState: options.runState,
    queueThreadReportNotification: options.queueThreadReportNotification,
  });
  const threadFollowupTool = createThreadFollowupTool({
    runtime: promptExecutionRuntime,
    commandState: options.commandState,
    turnState: options.turnState,
    runState: options.runState,
    bridge: {
      queueThreadFollowup: options.queueThreadFollowup,
      queueThreadReportRequest: options.queueThreadReportRequest,
    },
  });
  const threadRequestReportTool = createThreadRequestReportTool({
    runtime: promptExecutionRuntime,
    commandState: options.commandState,
    turnState: options.turnState,
    runState: options.runState,
    bridge: {
      queueThreadFollowup: options.queueThreadFollowup,
      queueThreadReportRequest: options.queueThreadReportRequest,
    },
  });
  const sharedWorkTools = [
    listExtensionsTool,
    loadExtensionTool,
    ...directTools.codingTools,
    executeTypescriptTool,
  ] as const;
  const loadedExtensions = new Set(extensionState.loadedExtensionIds);
  const sharedInteractiveTools = loadedExtensions.has("request-user-input")
    ? ([...sharedWorkTools, requestUserInputTool] as const)
    : sharedWorkTools;
  const orchestratorThreadTools = loadedExtensions.has("thread-orchestration")
    ? ([
        threadListTool,
        threadEpisodesTool,
        createStartThreadTool({
          runtime: promptExecutionRuntime,
          commandState: options.commandState,
          turnState: options.turnState,
          runState: options.runState,
          bridge: {
            createHandlerThread: options.createHandlerThread,
          },
          onAppLog: options.onAppLog,
        }),
        threadFollowupTool,
        threadRequestReportTool,
      ] as const)
    : ([] as const);
  const handlerThreadTools = loadedExtensions.has("thread-handling")
    ? ([threadCurrentTool, threadGroupTool, threadReportTool, threadEpisodesTool] as const)
    : ([] as const);
  const tools =
    options.actorKind === "namer"
      ? ([] as const)
      : options.actorKind === "orchestrator"
        ? ([...sharedInteractiveTools, ...orchestratorThreadTools] as const)
        : options.actorKind === "handler"
          ? ([...sharedInteractiveTools, ...handlerThreadTools] as const)
          : sharedWorkTools;
  const toolExecutor: PiToolExecutor = (input) =>
    Effect.gen(function* () {
      const tool = tools.find((candidate) => candidate.name === input.toolName);
      if (!tool) {
        return yield* Effect.fail(
          new RuntimeToolExecutionError({
            turnId: input.turnId,
            surfacePiSessionId: input.surfacePiSessionId,
            piToolCallId: input.piToolCallId,
            toolName: input.toolName,
            reason: "tool-not-found",
            message: `Unknown native tool: ${input.toolName}`,
          }),
        );
      }

      let params: unknown;
      try {
        params = JSON.parse(input.argumentsJson);
      } catch (error) {
        return yield* Effect.fail(
          new RuntimeToolExecutionError({
            turnId: input.turnId,
            surfacePiSessionId: input.surfacePiSessionId,
            piToolCallId: input.piToolCallId,
            toolName: input.toolName,
            reason: "invalid-arguments",
            message: error instanceof Error ? error.message : "Invalid tool arguments JSON.",
          }),
        );
      }

      const executable = tool as {
        execute(toolCallId: string, params: unknown): Promise<NativeToolResult>;
      };
      return yield* Effect.tryPromise({
        try: () => executable.execute(input.piToolCallId, params),
        catch: (error) =>
          new RuntimeToolExecutionError({
            turnId: input.turnId,
            surfacePiSessionId: input.surfacePiSessionId,
            piToolCallId: input.piToolCallId,
            toolName: input.toolName,
            reason: "extension-failed",
            message: error instanceof Error ? error.message : "Native tool execution failed.",
          }),
      });
    });
  const externalContextSources = structuredClone(options.externalContextSources ?? []);
  const boundExternalSourceHashes =
    options.externalSourceHashes?.length && options.externalSourceHashes.length > 0
      ? [...options.externalSourceHashes].toSorted()
      : externalSourceHashes(externalContextSources).toSorted();
  const generatedAgentContextAggregate: GeneratedAgentContextAggregateOutputs =
    options.generatedAgentContextAggregate ?? {
      prompt: options.systemPrompt,
      svvyxGuidance: "",
      commandsDts: "",
      nativeToolSchemasJson: "{}",
    };
  const generatedAgentContextAggregateKey =
    options.generatedAgentContextAggregateKey ??
    createHash("sha256").update(generatedAgentContextAggregate.prompt).digest("hex");
  const generatedAgentContextFingerprint =
    options.generatedAgentContextFingerprint ??
    createGeneratedAgentContextFingerprint({
      systemPrompt: options.systemPrompt,
      loadedExtensionIds: extensionState.loadedExtensionIds,
      availableExtensionIds: extensionState.availableExtensionIds,
      externalContextSources,
    });
  const restoredDefaults = resolveRestoredSessionDefaults(options.sessionManager, {
    provider: options.provider,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
  });
  const surfacePiSessionId = options.sessionManager.getSessionId() as SurfacePiSessionId;
  const { session, authStorage, modelRegistry, activeModel } = await createPiManagedAgentSession({
    cwd: options.sessionManager.getCwd(),
    agentDir: options.agentDir,
    sessionManager: options.sessionManager,
    provider: restoredDefaults.provider,
    model: restoredDefaults.model,
    thinkingLevel: restoredDefaults.thinkingLevel,
    systemPrompt: options.systemPrompt,
    tools,
    toolExecutor,
    runToolEffect: options.runCatalogEffect,
    emitToolExecutionUpdate: () => Effect.void,
    getToolExecutionContext: (callback) => {
      const current = promptExecutionRuntime.current;
      if (current) {
        return {
          turnId: current.turnId as TurnId,
          surfacePiSessionId: current.surfacePiSessionId as SurfacePiSessionId,
        };
      }
      return {
        turnId: `direct-tool:${surfacePiSessionId}:${callback.piToolCallId}` as TurnId,
        surfacePiSessionId,
      };
    },
    syncAuthStorage,
  });

  const managedSession: ManagedSession = {
    sessionId: session.sessionManager.getSessionId(),
    actorKind: options.actorKind,
    provider: activeModel.provider,
    model: activeModel.id,
    thinkingLevel: restoredDefaults.thinkingLevel,
    agentProfileId: options.agentProfileId ?? DEFAULT_ORCHESTRATOR_PROFILE_ID,
    systemPrompt: options.systemPrompt,
    generatedAgentContextAggregateKey,
    generatedAgentContextAggregate,
    generatedAgentContextFingerprint,
    generatedAgentContextRevision: options.generatedAgentContextRevision ?? 1,
    externalContextSources: [...externalContextSources],
    externalSourceHashes: boundExternalSourceHashes,
    loadedExtensionIds: extensionState.loadedExtensionIds,
    availableExtensionIds: extensionState.availableExtensionIds,
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

function countVisibleMessages(messages: AgentMessage[]): number {
  return messages.filter(
    (message) =>
      message.role === "user" || message.role === "assistant" || message.role === "toolResult",
  ).length;
}

function getResolvedSystemPrompt(session: ManagedSession): string {
  const resolved = session.session.agent.state.systemPrompt?.trim();
  return resolved && resolved.length > 0 ? resolved : session.systemPrompt;
}

function buildGeneratedSvvyxGuidance(records: readonly ResolvedExtensionRecord[]): string {
  const svvyxRecords = records.filter((record) => record.interface === "svvyx");
  if (svvyxRecords.length === 0) {
    return "No loaded svvyx extension command guidance.";
  }
  return svvyxRecords
    .map((record) =>
      [
        `Loaded svvyx extension: ${record.title}`,
        `Extension id: ${record.id}`,
        record.description,
        record.minimalLoadingHint,
      ]
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

function createPromptSettingsFingerprint(input: {
  requestUserInputSettings: RequestUserInputSettings;
  customInstructions?: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function externalSourceHashes(sources: readonly GeneratedAgentContextExternalSource[]): string[] {
  return sources.map((source) =>
    JSON.stringify({
      actors: [...source.actors].toSorted(),
      contentHash: source.contentHash,
      enabled: source.enabled,
      path: source.path,
      readStatus: source.readStatus.status,
      rootId: source.rootId ?? null,
      sourceGroup: source.sourceGroup,
    }),
  );
}

function createGeneratedAgentContextFingerprint(input: {
  systemPrompt: string;
  loadedExtensionIds: readonly string[];
  availableExtensionIds: readonly string[];
  externalContextSources: readonly GeneratedAgentContextExternalSource[];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        systemPrompt: input.systemPrompt,
        loadedExtensionIds: [...input.loadedExtensionIds].toSorted(),
        availableExtensionIds: [...input.availableExtensionIds].toSorted(),
        externalSourceHashes: externalSourceHashes(input.externalContextSources).toSorted(),
      }),
    )
    .digest("hex");
}

function sameExtensionUsage(
  left: Record<string, ExtensionUsageState>,
  right: Record<string, ExtensionUsageState>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

function applyExtensionUsageState(
  current: { loadedExtensionIds: readonly string[]; availableExtensionIds: readonly string[] },
  extensionId: string,
  state: ExtensionUsageState,
): { loadedExtensionIds: string[]; availableExtensionIds: string[] } {
  const loaded = new Set(current.loadedExtensionIds);
  const available = new Set(current.availableExtensionIds);
  loaded.delete(extensionId);
  available.delete(extensionId);
  if (state === "loaded") {
    loaded.add(extensionId);
  } else if (state === "available") {
    available.add(extensionId);
  }
  return {
    loadedExtensionIds: [...loaded],
    availableExtensionIds: [...available],
  };
}

function diffStringSet(
  previous: readonly string[],
  current: readonly string[],
): { added: string[]; removed: string[] } {
  const previousSet = new Set(previous);
  const currentSet = new Set(current);
  return {
    added: current.filter((value) => !previousSet.has(value)).toSorted(),
    removed: previous.filter((value) => !currentSet.has(value)).toSorted(),
  };
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

function resolveThreadTargets(
  snapshot: StructuredSessionSnapshot,
  input: { threadIds: string[] | null; threadGroupId: string | null },
): StructuredSessionSnapshot["threads"] {
  if (input.threadGroupId) {
    const threads = snapshot.threads.filter(
      (thread) => thread.threadGroupId === input.threadGroupId,
    );
    if (threads.length === 0) {
      throw new Error(`Thread group not found: ${input.threadGroupId}`);
    }
    return threads;
  }
  const requestedIds = input.threadIds ?? [];
  const threads = requestedIds.map((threadId) => {
    const thread = snapshot.threads.find((entry) => entry.id === threadId) ?? null;
    if (!thread) {
      throw new Error(`Delegated handler thread not found: ${threadId}`);
    }
    return thread;
  });
  if (threads.length === 0) {
    throw new Error("At least one handler thread target is required.");
  }
  return threads;
}

function resolveThreadExtensionState(
  profileExtensionUsage: Record<string, "loaded" | "available" | "unavailable">,
  profileExtensionOrder: readonly string[] | undefined,
  overrides: Record<string, "loaded" | "available" | "unavailable"> | null,
): { loadedExtensionIds: string[]; availableExtensionIds: string[] } {
  return resolveActorExtensionState({
    actor: "handler",
    profileExtensionUsage,
    profileExtensionOrder,
    overrides,
  });
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

function getActorKindForTarget(target: PromptTarget): SvvyActorKind {
  return target.surface === "handler" ? "handler" : "orchestrator";
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

function buildTitleHelperPrompt(input: {
  systemPrompt: string;
  promptLabel: string;
  text: string;
}): string {
  return [input.systemPrompt.trim(), `${input.promptLabel}:`, input.text.trim() || "New session"]
    .filter(Boolean)
    .join("\n\n");
}

function providerAuthIssue(providerId: string, state: ReturnType<typeof resolveAuthState>): string {
  if (state.keyType === "oauth" && state.refreshFailure) {
    return `OAuth credentials for ${providerId} expired and could not be refreshed. ${state.refreshFailure.message}`;
  }
  if (state.keyType === "oauth") {
    return `OAuth credentials for ${providerId} are expired. Reconnect the provider in Settings.`;
  }
  return `Provider ${providerId} credential is missing.`;
}

async function ensureProviderAuthForManagedSession(provider: string): Promise<string | undefined> {
  if (supportsOAuth(provider)) {
    const credential = getCredential(provider);
    if (credential?.type === "oauth" && credential.credentials.expires <= Date.now()) {
      const refreshed = await refreshIfNeeded(provider);
      if (!refreshed) {
        const reason = getOAuthRefreshError(provider) ?? "OAuth refresh failed.";
        throw new Error(
          `OAuth credentials for ${provider} expired and could not be refreshed. ${reason}`,
        );
      }
      return refreshed;
    }
  }

  const apiKey = resolveApiKey(provider);
  if (!apiKey) {
    const state = resolveAuthState(provider);
    if (state.keyType === "oauth") {
      if (state.refreshFailure) {
        throw new Error(
          `OAuth credentials for ${provider} expired and could not be refreshed. ${state.refreshFailure.message}`,
        );
      }
      throw new Error(
        `OAuth credentials for ${provider} are expired. Reconnect the provider in Settings.`,
      );
    }
  }
  return apiKey;
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

function isAgentReasoningEffort(value: unknown): value is AgentDefaults["reasoningEffort"] {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
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

function runtimeRunTaskAgentBridgeError(error: RuntimeContractError): RunTaskAgentBridgeError {
  switch (error.reason) {
    case "source-command-not-found":
      return new RunTaskAgentBridgeError("source_command_not_found", error.message, 404);
    case "source-command-not-handler-owned":
      return new RunTaskAgentBridgeError("source_command_not_handler_owned", error.message, 403);
    case "bridge-forbidden":
      return new RunTaskAgentBridgeError("forbidden", error.message, 403);
    case "bridge-invalid-request":
      return new RunTaskAgentBridgeError("invalid_request", error.message, 400);
    case "bridge-payload-too-large":
      return new RunTaskAgentBridgeError("payload_too_large", error.message, 413);
    default:
      return new RunTaskAgentBridgeError("task_attempt_failed", error.message, 500);
  }
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

function resolveConfiguredArtifactDirectory(input: string, cwd: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }
  return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
}
