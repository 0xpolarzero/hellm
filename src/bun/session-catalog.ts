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
  type AssistantMessageEvent,
  type ImageContent,
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
  decodeUnknownRequestUserInputAnswerDeliveryPayloadExit,
  decodeUnknownRequestUserInputAnswerQueuePayloadExit,
  unsafeDecodeRuntimeClientSubmissionInputSyncForTestsAndBootstrap,
  isRuntimePromptTelemetrySummary,
  normalizeRuntimeClientSubmissionMetadata,
  RuntimeQueueStatePort,
  RuntimeTurnStatePort,
  type RuntimeClientSubmissionInput,
  RuntimeToolExecutionError,
  runtimeClientSubmissionLogDetails,
  type RunTaskAgentInput,
  type RunTaskAgentResult,
  summarizeRuntimePromptMessagesForTelemetry,
  type NativeToolResult,
  type PiToolExecutor,
  type CancelRuntimeSurfaceMessageInput,
  type EnqueueRuntimeSurfaceMessageInput,
  type FinishRuntimeTurnInput,
  type GetRuntimeSurfaceMessageInput,
  type MarkRuntimeSurfaceMessageDeliveredInput,
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
  type RuntimeSubmittedMessage,
  type RuntimeSurfaceLifecycleStatePortService,
  type RuntimeSurfaceMessageRecord,
  type RuntimeThreadStatePortService,
  type RuntimeTurnRecord,
  type RuntimeTurnStatePortService,
  type RuntimeWorkspaceStatePortService,
  type SetRuntimeTurnDecisionInput,
  type StartRuntimeTurnInput,
  type AgentProfileId as CoreAgentProfileId,
  type StateContractError,
  type RequestUserInputAnswerDeliveryPayload,
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
  type PromptExecutionExternalInstructionSource,
  type RefreshGeneratedContextRequest,
  ProviderAuthPort,
  ProviderAuthPortError,
  PiRuntimePathsPort,
  type AbsolutePath,
  type ProviderAuthPortService,
  type PiRuntimePathsPortService,
  type PromptExecutionContext,
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
  SurfaceStreamPatch,
  SurfaceStreamPatchInput,
  SurfaceMutationResponse,
  SurfaceSyncMessage,
  UpdateComposerDraftRequest,
  WorkspaceMutationResponse,
  WorkspaceArtifactPreview,
  WorkspaceRequestUserInputRequest,
  WorkspaceRuntimeApprovalRequest,
  RequestUserInputAnswerRequest,
  SetRequestUserInputTimerPausedRequest,
  WorkspaceSessionNavigationReadModel,
  WorkspaceSyncMessage,
  WorkspaceCommandInspector,
  WorkspaceHandlerThreadInspector,
  WorkspaceHandlerThreadSummary,
  WorkspaceSessionSummary,
  WorkspaceWorkflowTaskAttemptInspector,
  AgentContextPreviewRequest,
  AgentContextPreviewExtension,
  AgentContextPreviewResponse,
} from "../shared/workspace-contract";
import type {
  GeneratedAgentContextActor,
  GeneratedAgentContextExternalSource,
  GeneratedAgentContextEntry,
  GeneratedAgentContextSnapshotSummary,
  GeneratedAgentContextState,
} from "../shared/generated-agent-context";
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
import {
  defaultRuntimeLayerConfig,
  type RuntimeLayerConfig,
  type RuntimeSurfaceQueueWakeReason,
} from "@svvy/runtime/bootstrap";
import { createRuntimeSurfaceQueueDispatcher as createRuntimeSurfaceQueueDispatcherWithPolicy } from "../../packages/runtime/src/surface-queue-dispatcher";
import {
  createPromptExecutionContext as createRuntimePromptExecutionContext,
  type PromptExecutionRuntimeHandle,
} from "@svvy/runtime/prompt-execution-context";
import {
  createStructuredSessionStateStore,
  StructuredSessionState,
  type StructuredSessionSnapshot,
  type StructuredWaitState,
  type StructuredSessionStateStore,
  type StructuredSurfaceQueuedMessageRecord,
  structuredSessionStateFromStore,
} from "@svvy/state/structured-session-state";
import { layerSandboxPolicySource } from "@svvy/state";
import {
  buildStructuredCommandInspector,
  buildStructuredHandlerThreadInspector,
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
import { createToolExecutionCommandTracker } from "./tool-execution-command-tracker";
import {
  buildPiUserMessageFromRuntimeSubmittedMessage,
  runtimeSubmittedMessagePromptText,
} from "@svvy/pi-adapter/messages";
import { PiAdapter, layer as PiAdapterLayer } from "@svvy/pi-adapter";
import { createPiManagedAgentSession } from "@svvy/pi-adapter/session";
import { countPromptTokens } from "./token-count";
import { createStreamingCommandTracker } from "./streaming-command-tracker";
import { createOrderedRuntimeStateWriteLane } from "./ordered-runtime-state-write-lane";
import { createStartThreadTool } from "./thread-start-tool";
import { createThreadReportTool, type ThreadReportNotificationRequest } from "./thread-report-tool";
import {
  createThreadFollowupTool,
  createThreadRequestReportTool,
} from "./thread-orchestration-tools";
import {
  buildGeneratedAgentContextEntries,
  buildSystemPrompt,
  createDefaultGeneratedAgentContextState,
} from "./default-system-prompt";
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
  applySnippetEnablement,
  buildSnippetsReadModel,
  discoverSnippets,
} from "./snippet-library";
import { createSnippetStore, type SnippetStore } from "./snippet-store";
import type {
  CreateManagedSnippetRequest,
  DeleteManagedSnippetRequest,
  ManagedSnippet,
  SetSnippetEnabledRequest,
  SnippetsReadModel,
  UpdateManagedSnippetRequest,
} from "../shared/snippets";
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

function isPromptTelemetrySummary(
  value: unknown,
): value is ReturnType<typeof summarizePromptMessagesForTelemetry> {
  return isRuntimePromptTelemetrySummary(value);
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

export interface SendAgentPromptOptions {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  target: PromptTarget;
  messages: Message[];
  onEvent?: (event: AssistantMessageEvent) => void;
  queueOnly?: boolean;
  queuedMessageId?: string | null;
  clientSubmission?: PromptClientSubmissionMetadata;
  promptTelemetry?: ReturnType<typeof summarizePromptMessagesForTelemetry>;
}

export interface SendAgentPromptResult {
  target: PromptTarget;
  queued?: boolean;
  queuedMessageId?: string;
  dispatched?: boolean;
  snapshot?: ConversationSurfaceSnapshot;
}

interface PreparedPromptExecutionTurn {
  startTurnInput: StartRuntimeTurnInput;
  seed: {
    workspaceSessionId: string;
    surfacePiSessionId: string;
    threadId: string | null;
    surfaceKind: PromptExecutionContext["surfaceKind"];
    rootThreadId: PromptExecutionContext["rootThreadId"];
    rootEpisodeKind: PromptExecutionContext["rootEpisodeKind"];
    threadWasTerminalAtStart: boolean;
    loadedExtensionIds: readonly string[];
    availableExtensionIds: readonly string[];
    externalInstructionSources: readonly PromptExecutionExternalInstructionSource[];
    generatedAgentContextFingerprint: string;
    generatedAgentContextRevision: string;
    queueItemId: string | null;
  };
}

export interface EditCommittedUserMessageOptions {
  target: PromptTarget;
  messageTimestamp: string | number;
  message: Message;
  onEvent?: (event: AssistantMessageEvent) => void;
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

interface UserPromptQueuePayload {
  source?: "catalog-submit" | "runtime-submit";
  clientSubmission?: PromptClientSubmissionMetadata;
  telemetry?: ReturnType<typeof summarizePromptMessagesForTelemetry>;
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

function queuedMessagePiTimestampMs(queued: RuntimeSurfaceMessageRecord): number {
  return messageTimestampMs(queued.createdAt);
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
  private readonly snippetStore: SnippetStore;
  private readonly extensionsRoot: string;
  private readonly requestUserInputRuntime = new RequestUserInputRuntime();
  private readonly approvalBoundary: RuntimeApprovalBoundary;
  private closed = false;
  private focusedSurfacePiSessionId: string | null = null;
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
      runTaskAgent: (request) => this.runRunTaskAgentInput(request),
    });
    this.requestUserInputRuntime.setSettings(this.agentSettingsStore.getState().requestUserInput);
    this.generatedAgentContextStore = createGeneratedAgentContextStore({
      agentDir: this.sessionDir,
    });
    this.generatedAgentContextAggregateCache = createGeneratedAgentContextAggregateCache({
      extensionsRoot: this.extensionsRoot,
    });
    this.generatedAgentContextStore.getState();
    this.snippetStore = createSnippetStore({
      agentDir: this.sessionDir,
    });
    this.recoveryCoordinator = new WorkspaceRecoveryCoordinator(
      this.workspaceId as WorkspaceId,
      this.runtimeRecoveryStatePort,
      {
        recoverSurfaceTurn: async (surfacePiSessionId) => {
          this.recoverInterruptedSurfaceTurn(surfacePiSessionId);
        },
        drainSurfaceQueue: async (target) => {
          await this.runSurfaceQueue(target);
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

  getGeneratedAgentContextState(): GeneratedAgentContextState {
    return this.generatedAgentContextStore.getState();
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

  private runRuntimeQueueEffect<A>(
    effect: Effect.Effect<A, unknown, RuntimeQueueStatePort | RuntimeTurnStatePort>,
  ): Promise<A> {
    return this.runCatalogEffect(
      effect.pipe(
        Effect.provideService(RuntimeTurnStatePort, this.runtimeTurnStatePort),
        Effect.provideService(RuntimeQueueStatePort, this.runtimeQueueStatePort),
      ),
    );
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

  private markRuntimeSurfaceMessageQueued(
    input: MarkRuntimeSurfaceMessageQueuedInput,
  ): RuntimeSurfaceMessageRecord {
    return this.structuredSessionStore.markSurfaceMessageQueued(input);
  }

  private async markRuntimeSurfaceMessageQueuedAsync(
    input: MarkRuntimeSurfaceMessageQueuedInput,
  ): Promise<RuntimeSurfaceMessageRecord> {
    return (
      await this.runRuntimeStateAsync(this.runtimeQueueStatePort.markSurfaceMessageQueued(input))
    ).value;
  }

  private markRuntimeSurfaceMessageDelivered(
    input: MarkRuntimeSurfaceMessageDeliveredInput,
  ): RuntimeSurfaceMessageRecord {
    return this.structuredSessionStore.markSurfaceMessageDelivered(input);
  }

  private cancelRuntimeSurfaceMessage(
    input: CancelRuntimeSurfaceMessageInput,
  ): RuntimeSurfaceMessageRecord {
    return this.structuredSessionStore.cancelSurfaceMessage(input);
  }

  private startRuntimeTurnAsync(input: StartRuntimeTurnInput): Promise<RuntimeTurnRecord> {
    return this.runRuntimeStateAsync(this.runtimeTurnStatePort.startTurn(input)).then(
      (result) => result.value,
    );
  }

  private setRuntimeTurnDecision(input: SetRuntimeTurnDecisionInput): RuntimeTurnRecord {
    return this.structuredSessionStore.setTurnDecision(input);
  }

  private finishRuntimeTurn(input: FinishRuntimeTurnInput): RuntimeTurnRecord {
    return this.structuredSessionStore.finishTurn(input);
  }

  getDefaultGeneratedAgentContextState(): GeneratedAgentContextState {
    return createDefaultGeneratedAgentContextState();
  }

  updateGeneratedAgentContextState(state: GeneratedAgentContextState): GeneratedAgentContextState {
    const next = this.generatedAgentContextStore.updateState(state);
    void this.emitOpenSurfacePromptBindingUpdates();
    return next;
  }

  updateRequestUserInputSettings(settings: RequestUserInputSettings): AgentSettingsState {
    const next = this.agentSettingsStore.setRequestUserInput(settings);
    this.requestUserInputRuntime.setSettings(next.requestUserInput);
    void this.emitOpenSurfacePromptBindingUpdates();
    return next;
  }

  updateAppPreferences(preferences: AppPreferences): AgentSettingsState {
    const next = this.agentSettingsStore.setAppPreferences(preferences);
    void this.emitOpenSurfacePromptBindingUpdates();
    return next;
  }

  async notifyAppPreferencesChanged(): Promise<void> {
    await this.emitOpenSurfacePromptBindingUpdates();
  }

  async notifySourceInputsChanged(_reason: string): Promise<void> {
    await this.emitOpenSurfacePromptBindingUpdates();
  }

  resetGeneratedAgentContextState(): GeneratedAgentContextState {
    const next = this.generatedAgentContextStore.resetState();
    void this.emitOpenSurfacePromptBindingUpdates();
    return next;
  }

  listGeneratedAgentContextSnapshots(): GeneratedAgentContextSnapshotSummary[] {
    return this.generatedAgentContextStore.listSnapshots();
  }

  createGeneratedAgentContextSnapshot(name: string): GeneratedAgentContextSnapshotSummary {
    return this.generatedAgentContextStore.createSnapshot(name);
  }

  renameGeneratedAgentContextSnapshot(
    snapshotId: string,
    name: string,
  ): GeneratedAgentContextSnapshotSummary {
    return this.generatedAgentContextStore.renameSnapshot(snapshotId, name);
  }

  restoreGeneratedAgentContextSnapshot(snapshotId: string): GeneratedAgentContextState {
    const next = this.generatedAgentContextStore.restoreSnapshot(snapshotId);
    void this.emitOpenSurfacePromptBindingUpdates();
    return next;
  }

  getGeneratedAgentContextEntries() {
    const state = this.generatedAgentContextStore.getState();
    const materialize = (
      actor: GeneratedAgentContextActor,
      entries: GeneratedAgentContextEntry[],
    ) => entries.map((entry) => this.materializeGeneratedPromptEntry(actor, entry));
    return {
      orchestrator: materialize(
        "orchestrator",
        buildGeneratedAgentContextEntries("orchestrator", state),
      ),
      handler: materialize("handler", buildGeneratedAgentContextEntries("handler", state)),
      "workflow-task": materialize(
        "workflow-task",
        buildGeneratedAgentContextEntries("workflow-task", state),
      ),
    };
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

  getSnippets(): SnippetsReadModel {
    return buildSnippetsReadModel({
      managed: this.snippetStore.listManaged(),
      discovered: applySnippetEnablement(
        discoverSnippets({
          homeDir: homedir(),
          workspaceDir: this.cwd,
        }),
        this.snippetStore.listDisabledSnippetIds(),
      ),
    });
  }

  createManagedSnippet(input: CreateManagedSnippetRequest): ManagedSnippet {
    return this.snippetStore.createManaged(input);
  }

  updateManagedSnippet(input: UpdateManagedSnippetRequest): ManagedSnippet {
    return this.snippetStore.updateManaged(input);
  }

  deleteManagedSnippet(input: DeleteManagedSnippetRequest): void {
    this.snippetStore.deleteManaged(input);
  }

  setSnippetEnabled(input: SetSnippetEnabledRequest): void {
    this.snippetStore.setEnabled(input);
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

  private materializeGeneratedPromptEntry(
    actor: GeneratedAgentContextActor,
    entry: GeneratedAgentContextEntry,
  ): GeneratedAgentContextEntry {
    const relativePath = join(".svvy", "generated", "agent-context", actor, `${entry.id}.md`);
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
      requestUserInputRequests: this.buildWorkspaceRequestUserInputRequests(),
      runtimeApprovalRequests: this.buildWorkspaceRuntimeApprovalRequests(),
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

  async sendPrompt(options: SendAgentPromptOptions): Promise<SendAgentPromptResult> {
    this.assertValidPromptTarget(options.target);
    const session = await this.ensureManagedSurfaceForPrompt(options);
    const queued = await this.enqueuePendingSurfacePrompt(options);
    return this.afterSurfacePromptEnqueued({ options, session, queued });
  }

  private async afterSurfacePromptEnqueued(input: {
    options: SendAgentPromptOptions;
    session: ManagedSession;
    queued: RuntimeSurfaceMessageRecord;
  }): Promise<SendAgentPromptResult> {
    const { options, session, queued } = input;
    const payload = this.parseUserPromptQueuePayload(queued);
    this.emitPromptQueueLog("Prompt queued for surface delivery.", {
      target: options.target,
      queuedMessageId: queued.id,
      queueStatus: queued.status,
      queueKind: queued.kind,
      provider: options.provider,
      model: options.model,
      telemetry:
        payload?.telemetry ??
        options.promptTelemetry ??
        summarizePromptMessagesForTelemetry(options.messages),
      clientSubmission: payload?.clientSubmission ?? options.clientSubmission,
    });
    this.structuredSessionStore.setComposerDraft({
      sessionId: options.target.workspaceSessionId,
      surfacePiSessionId: options.target.surfacePiSessionId,
      threadId: options.target.threadId ?? null,
      text: "",
      attachments: [],
      snippetMentions: [],
    });
    const started = options.queueOnly
      ? false
      : await this.drainNextQueuedSurfacePrompt(options.target, {
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
      if (!options.queueOnly) {
        this.wakeSurfaceQueue(options.target);
      }
    } else if (!session.activePrompt) {
      this.wakeSurfaceQueue(options.target);
    }

    return {
      target: structuredClone(options.target),
      queued: true,
      queuedMessageId: queued.id,
      dispatched: started,
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
      snippetMentions: input.draft.snippetMentions ?? [],
    });
    await this.emitWorkspaceSync("structured.updated");
    return { ok: true, target: structuredClone(input.target) };
  }

  async editCommittedUserMessage(
    options: EditCommittedUserMessageOptions,
  ): Promise<SendAgentPromptResult> {
    this.assertValidPromptTarget(options.target);
    const externalContextSources = await this.buildCurrentExternalContextSources();
    const aggregate = this.buildAggregateForTarget(options.target, {
      externalInstructionSources: externalContextSources,
    });
    const session = await this.loadManagedSurface(
      options.target.surfacePiSessionId,
      getActorKindForTarget(options.target),
      aggregate.outputs.prompt,
      externalContextSources,
      aggregate,
    );
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
    this.assertQueuedMessageBelongsToSurface(input.queuedMessageId, input.target);
    await this.markRuntimeSurfaceMessageQueuedAsync({
      id: input.queuedMessageId,
      position: "front",
    });
    const snapshot = await this.emitQueuedSurfaceUpdate(input.target);
    this.wakeSurfaceQueue(input.target);
    return { ok: true, target: structuredClone(input.target), snapshot };
  }

  async wakeRuntimeSurfaceQueue(input: {
    target: PromptTarget;
    reason: RuntimeSurfaceQueueWakeReason;
  }): Promise<void> {
    this.assertValidPromptTarget(input.target);
    await this.emitQueuedSurfaceUpdate(input.target);
    this.wakeSurfaceQueue(input.target);
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
    this.wakeSurfaceQueue(target);
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
    this.wakeSurfaceQueue(target);
    return { ok: true, target: structuredClone(target), snapshot };
  }

  getRequestInputSurfaceMutationResponse(input: {
    surfacePiSessionId: string;
    requestId: string;
  }): { ok: boolean; target: PromptTarget } {
    const request = this.structuredSessionStore.getRequestUserInputRequest(input.requestId);
    if (request.surfacePiSessionId !== input.surfacePiSessionId) {
      throw new Error("Request user input request does not belong to the target surface.");
    }
    const target = this.resolvePromptTargetForSurfacePiSessionId(request.surfacePiSessionId);
    if (target.workspaceSessionId !== request.sessionId) {
      throw new Error("Request user input request is not bound to a known workspace session.");
    }
    return { ok: true, target: structuredClone(target) };
  }

  async afterRequestInputTimerPaused(_input: { requestId: string }): Promise<{ ok: boolean }> {
    await this.emitWorkspaceSync("structured.updated");
    return { ok: true };
  }

  async afterRuntimeApprovalAnswered(input: {
    approved: boolean;
    reason?: string | null;
    requestId: string;
  }): Promise<{ ok: boolean; target: PromptTarget; snapshot?: ConversationSurfaceSnapshot }> {
    const request = this.structuredSessionStore.getRuntimeApprovalRequest(input.requestId);
    const target = this.resolvePromptTargetForSurfacePiSessionId(request.surfacePiSessionId);
    const session = this.managedSurfaces.get(target.surfacePiSessionId);
    if (!session) {
      await this.emitWorkspaceSync("structured.updated");
      return { ok: true, target };
    }
    await this.emitSurfaceSync({
      session,
      reason: "surface.updated",
      target,
    });
    await this.emitWorkspaceSync("structured.updated");
    return {
      ok: true,
      target,
      snapshot: await this.buildSurfaceSnapshot(session, target),
    };
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

  async recordExtensionRevertProductEvent(input: {
    target: PromptTarget;
    changeId: string;
    revertChangeId?: string | null;
    extensionId?: string | null;
    resultKind?: string | null;
    autoBuildStatus?: string | null;
  }): Promise<boolean> {
    const resolvedTarget = this.tryResolvePromptTargetForSurfacePiSessionId(
      input.target.surfacePiSessionId,
    );
    if (
      !resolvedTarget ||
      resolvedTarget.workspaceSessionId !== input.target.workspaceSessionId ||
      resolvedTarget.surface !== input.target.surface ||
      resolvedTarget.threadId !== input.target.threadId
    ) {
      return false;
    }

    const extensionLabel = input.extensionId ? ` for ${input.extensionId}` : "";
    const summary = `User reverted extension ${input.resultKind ?? "change"} ${input.changeId}${extensionLabel}.`;
    this.structuredSessionStore.recordLifecycleEvent({
      sessionId: resolvedTarget.workspaceSessionId,
      kind: "Extension change reverted",
      subjectKind:
        resolvedTarget.surface === "handler" && resolvedTarget.threadId ? "thread" : "session",
      subjectId:
        resolvedTarget.surface === "handler" && resolvedTarget.threadId
          ? resolvedTarget.threadId
          : resolvedTarget.workspaceSessionId,
      data: {
        surface: resolvedTarget.surface,
        surfacePiSessionId: resolvedTarget.surfacePiSessionId,
        ...(resolvedTarget.threadId ? { threadId: resolvedTarget.threadId } : {}),
        title: "Extension change reverted",
        summary,
        changeId: input.changeId,
        ...(input.revertChangeId ? { revertChangeId: input.revertChangeId } : {}),
        ...(input.extensionId ? { extensionId: input.extensionId } : {}),
        ...(input.resultKind ? { resultKind: input.resultKind } : {}),
        ...(input.autoBuildStatus ? { autoBuildStatus: input.autoBuildStatus } : {}),
      },
    });
    await this.emitWorkspaceSync("structured.updated");
    return true;
  }

  async cancelPrompt(target: PromptTarget): Promise<void> {
    this.assertValidPromptTarget(target);
    const session = this.managedSurfaces.get(target.surfacePiSessionId);
    const queuedCancelled = this.cancelLiveQueuedSurfaceMessages(target);
    if (session) {
      session.session.clearQueue();
    }
    await this.cancelActivePrompt({ target, restorePiQueuedMessages: false });
    if (queuedCancelled > 0) {
      await this.emitQueuedSurfaceUpdate(target);
      await this.emitWorkspaceSync("structured.updated");
    }
  }

  async cancelActivePrompt(input: {
    target: PromptTarget;
    turnId?: string;
    restorePiQueuedMessages?: boolean;
  }): Promise<void> {
    const { target } = input;
    this.assertValidPromptTarget(target);
    const session = this.managedSurfaces.get(target.surfacePiSessionId);
    if (!session?.activePrompt) {
      return;
    }
    if (input.turnId && session.pendingUserMessage?.turnId !== input.turnId) {
      throw new Error(`Active turn ${input.turnId} does not belong to target.`);
    }

    session.abortRequested = true;
    if (input.restorePiQueuedMessages !== false) {
      this.restorePiQueuedMessagesToSurface(session, target);
    }
    await this.emitQueuedSurfaceUpdate(target);
    await this.emitWorkspaceSync("structured.updated");
    await session.session.abort();
  }

  private cancelLiveQueuedSurfaceMessages(target: PromptTarget): number {
    let cancelled = 0;
    for (const queued of this.structuredSessionStore.listQueuedSurfaceMessages({
      surfacePiSessionId: target.surfacePiSessionId,
    })) {
      if (
        queued.sessionId === target.workspaceSessionId &&
        (queued.status === "queued" ||
          queued.status === "steering" ||
          queued.status === "dispatching")
      ) {
        this.structuredSessionStore.cancelSurfaceMessage({ id: queued.id });
        cancelled += 1;
      }
    }
    return cancelled;
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
    await this.emitWorkspaceSync("structured.updated");
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

  private async ensureManagedSurfaceForPrompt(
    options: SendAgentPromptOptions,
  ): Promise<ManagedSession> {
    const actorKind = getActorKindForTarget(options.target);
    const externalContextSources = await this.buildCurrentExternalContextSources();
    const aggregate = this.buildAggregateForTarget(options.target, {
      externalInstructionSources: externalContextSources,
    });
    const session = await this.loadManagedSurface(
      options.target.surfacePiSessionId,
      actorKind,
      aggregate.outputs.prompt,
      externalContextSources,
      aggregate,
    );
    return this.prepareManagedSession(session, options);
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

  private async prepareManagedSession(
    session: ManagedSession,
    options: Pick<
      SendAgentPromptOptions,
      "provider" | "model" | "thinkingLevel" | "messages" | "target"
    >,
  ): Promise<ManagedSession> {
    const actorKind = getActorKindForTarget(options.target);
    if (
      session.actorKind !== actorKind ||
      session.provider !== options.provider ||
      session.model !== options.model ||
      session.recreateOnNextPrompt
    ) {
      const actorChanged = session.actorKind !== actorKind;
      const externalContextSources = actorChanged
        ? await this.buildCurrentExternalContextSources()
        : session.externalContextSources;
      const aggregate = actorChanged
        ? this.buildAggregateForTarget(options.target, {
            externalInstructionSources: externalContextSources,
          })
        : null;
      const recreated = await this.recreateManagedSurface(session, {
        actorKind,
        provider: options.provider,
        model: options.model,
        thinkingLevel: options.thinkingLevel,
        ...(aggregate
          ? {
              systemPrompt: aggregate.outputs.prompt,
              generatedAgentContextAggregateKey: aggregate.cacheKey,
              generatedAgentContextAggregate: aggregate.outputs,
            }
          : {}),
        externalContextSources,
      });
      this.syncGeneratedAgentContextBindingForTarget(options.target, recreated);
      return recreated;
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

  private async refreshManagedSurfacePromptBinding(
    session: ManagedSession,
    target: PromptTarget,
  ): Promise<ManagedSession> {
    const previousBinding = {
      systemPrompt: session.systemPrompt,
      generatedAgentContextFingerprint: session.generatedAgentContextFingerprint,
      loadedExtensionIds: [...session.loadedExtensionIds],
      availableExtensionIds: [...session.availableExtensionIds],
      externalSourceHashes: [...session.externalSourceHashes],
    };
    const extensionState = this.resolveCurrentExtensionStateForTarget(target, session, {
      includeManagedLoadedExtensions: false,
    });
    const externalContextSources = await this.buildCurrentExternalContextSources();
    const aggregate = this.buildAggregateForTarget(target, {
      extensionState,
      externalInstructionSources: externalContextSources,
    });
    const refreshed = await this.recreateManagedSurface(session, {
      actorKind: getActorKindForTarget(target),
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
    this.syncGeneratedAgentContextBindingForTarget(target, refreshed);
    this.recordAgentContextUpdatedEvent(target, previousBinding, refreshed);
    this.persistManagedSessionSnapshot(refreshed);
    return refreshed;
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

  private buildInitialHandlerQueuedPrompt(message: StructuredSurfaceQueuedMessageRecord): string {
    const snapshot = this.getStructuredSnapshot(message.sessionId);
    const thread = snapshot?.threads.find((entry) => entry.id === message.threadId) ?? null;
    if (!thread) {
      throw new Error(`Queued initial handler start ${message.id} has no handler thread.`);
    }
    const payload = parseInitialHandlerStartQueuePayload(message);
    return buildInitialHandlerThreadPrompt(thread, payload?.parentSessionFile ?? null);
  }

  private buildThreadFollowupQueuedPrompt(message: StructuredSurfaceQueuedMessageRecord): string {
    const payload = this.parseThreadFollowupQueuePayload(message);
    if (!payload) {
      throw new Error(`Queued thread follow-up ${message.id} has malformed payload.`);
    }
    return payload.message;
  }

  private buildReportRequestQueuedPrompt(message: StructuredSurfaceQueuedMessageRecord): string {
    const payload = this.parseReportRequestQueuePayload(message);
    if (!payload) {
      throw new Error(`Queued report request ${message.id} has malformed payload.`);
    }
    return [
      "System event: The orchestrator requested an explicit thread_report update.",
      `Report request: ${payload.request}`,
      "Respond by calling thread_report with an intermediate update unless the objective is ready to conclude.",
    ].join("\n");
  }

  private buildRequestUserInputAnswerQueuedPrompt(
    message: StructuredSurfaceQueuedMessageRecord,
  ): string {
    if (!this.parseRequestUserInputAnswerQueuePayload(message)) {
      throw new Error(`Queued request_user_input answer ${message.id} has malformed payload.`);
    }
    const payload = this.parseRequestUserInputAnswerDeliveryPayload(message.messageJson);
    if (!payload) {
      throw new Error(`Queued request_user_input answer ${message.id} has malformed message.`);
    }
    return JSON.stringify(payload, null, 2);
  }

  private parseRequestUserInputAnswerDeliveryPayload(
    messageJson: string,
  ): RequestUserInputAnswerDeliveryPayload | null {
    try {
      return Exit.match(
        decodeUnknownRequestUserInputAnswerDeliveryPayloadExit(JSON.parse(messageJson)),
        {
          onFailure: () => null,
          onSuccess: (value) => value,
        },
      );
    } catch {
      return null;
    }
  }

  private buildThreadReportNotificationQueuedPrompt(
    message: StructuredSurfaceQueuedMessageRecord,
  ): string {
    const payload = this.parseThreadReportNotificationQueuePayload(message);
    if (!payload) {
      throw new Error(`Queued thread report notification ${message.id} has malformed payload.`);
    }
    const snapshot = this.getStructuredSnapshot(message.sessionId);
    const thread = snapshot?.threads.find((entry) => entry.id === payload.threadId) ?? null;
    return buildOrchestratorThreadReportPrompt(thread, payload.summary, payload.outcome);
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

  private parseQueuedRuntimeSubmittedMessage(
    queued: RuntimeSurfaceMessageRecord,
  ): RuntimeSubmittedMessage {
    try {
      return unsafeDecodeRuntimeSubmittedMessageSyncForTestsAndBootstrap(
        JSON.parse(queued.messageJson),
      );
    } catch (error) {
      throw new Error(`Queued runtime submitted message ${queued.id} is malformed.`, {
        cause: error,
      });
    }
  }

  private parseQueuedPiUserMessage(queued: RuntimeSurfaceMessageRecord): Message {
    try {
      const message = JSON.parse(queued.messageJson) as Message;
      if (message.role !== "user") {
        throw new Error(`Queued surface message ${queued.id} is not a user message.`);
      }
      return message;
    } catch (error) {
      throw new Error(`Queued surface message ${queued.id} could not be parsed.`, {
        cause: error,
      });
    }
  }

  private materializeQueuedUserMessage(queued: RuntimeSurfaceMessageRecord): Message {
    const payload = this.parseUserPromptQueuePayload(queued);
    if (payload?.source === "runtime-submit") {
      return buildPiUserMessageFromRuntimeSubmittedMessage(
        this.parseQueuedRuntimeSubmittedMessage(queued),
        {
          timestamp: queuedMessagePiTimestampMs(queued),
        },
      );
    }
    return this.parseQueuedPiUserMessage(queued);
  }

  private materializeQueuedUserPromptPayload(
    queued: RuntimeSurfaceMessageRecord,
  ): UserPromptQueuePayload | null {
    return this.parseUserPromptQueuePayload(queued);
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
        requestUserInputRequests: this.buildWorkspaceRequestUserInputRequests(),
        runtimeApprovalRequests: this.buildWorkspaceRuntimeApprovalRequests(),
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

  private buildWorkspaceRequestUserInputRequests(): WorkspaceRequestUserInputRequest[] {
    return this.structuredSessionStore
      .listSessionStates()
      .flatMap((snapshot) =>
        snapshot.requestUserInputRequests
          .filter((request) => request.status === "open" || request.status === "completed")
          .map((request) => {
            const thread = request.threadId
              ? (snapshot.threads.find((candidate) => candidate.id === request.threadId) ?? null)
              : null;
            return {
              requestId: request.requestId,
              workspaceSessionId: request.sessionId,
              surfacePiSessionId: request.surfacePiSessionId,
              threadId: request.threadId,
              ownerTitle: thread?.title ?? snapshot.pi.title,
              variant: request.variant,
              status: request.status,
              createdAt: request.createdAt,
              completedAt: request.completedAt,
              timeout: request.timeout ? { ...request.timeout } : null,
              questions: request.questions.map((question) => ({
                questionId: question.questionId,
                ordinal: question.ordinal,
                title: question.title,
                question: question.question,
                defaultAnswer: structuredClone(question.defaultAnswer),
                choices: question.choices.map((choice) => ({ ...choice })),
                status: question.status,
              })),
            };
          }),
      )
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private buildWorkspaceRuntimeApprovalRequests(): WorkspaceRuntimeApprovalRequest[] {
    return this.structuredSessionStore
      .listSessionStates()
      .flatMap((snapshot) =>
        (snapshot.runtimeApprovalRequests ?? [])
          .filter((request) => request.status === "pending")
          .map((request) => {
            const thread = request.threadId
              ? (snapshot.threads.find((candidate) => candidate.id === request.threadId) ?? null)
              : null;
            return {
              requestId: request.requestId,
              workspaceSessionId: request.sessionId,
              surfacePiSessionId: request.surfacePiSessionId,
              threadId: request.threadId,
              ownerTitle: thread?.title ?? snapshot.pi.title,
              toolName: request.toolName,
              approvalMode: request.approvalMode,
              cwd: request.cwd,
              command: request.command,
              commandFamily: request.commandFamily,
              snippetArtifactId: request.snippetArtifactId,
              status: request.status,
              createdAt: request.createdAt,
              completedAt: request.completedAt,
              summary:
                request.toolName === "exec_command" && request.command
                  ? `Run command: ${request.command}`
                  : request.toolName === "apply_patch"
                    ? "Apply patch"
                    : "Run TypeScript",
            };
          }),
      )
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
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
    this.finishRuntimeTurn({
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

  private setPendingUserMessage(
    session: ManagedSession,
    promptContext: PromptExecutionContext | null,
    message: Message | null,
  ): void {
    session.pendingUserMessage =
      promptContext?.turnId && message
        ? { turnId: promptContext.turnId, message: structuredClone(message) }
        : null;
  }

  private async enqueuePendingSurfacePrompt(
    options: SendAgentPromptOptions,
  ): Promise<RuntimeSurfaceMessageRecord> {
    const message = getLatestUserMessage(options.messages);
    if (!message) {
      throw new Error("No user message to queue.");
    }
    const text = flattenUserMessageContent(message.content).trim();
    if (!text) {
      throw new Error("No user message to queue.");
    }

    const clientSubmission = normalizePromptClientSubmissionMetadata(options.clientSubmission);
    const telemetry = summarizePromptMessagesForTelemetry(options.messages);
    const queuePayload: UserPromptQueuePayload = {
      source: "catalog-submit",
      ...(clientSubmission ? { clientSubmission } : {}),
      telemetry,
    };
    const queued = await this.enqueueRuntimeSurfaceMessageAsync({
      sessionId: options.target.workspaceSessionId,
      surfacePiSessionId: options.target.surfacePiSessionId,
      threadId: options.target.threadId ?? null,
      messageJson: JSON.stringify(message),
      payloadJson: JSON.stringify(queuePayload),
    });
    return queued;
  }

  private parseUserPromptQueuePayload(
    message: StructuredSurfaceQueuedMessageRecord,
  ): UserPromptQueuePayload | null {
    if (!message.payloadJson) {
      return null;
    }
    try {
      const payload = JSON.parse(message.payloadJson) as Partial<UserPromptQueuePayload>;
      return {
        source:
          payload.source === "catalog-submit" || payload.source === "runtime-submit"
            ? payload.source
            : undefined,
        clientSubmission: normalizePromptClientSubmissionMetadata(payload.clientSubmission),
        telemetry: isPromptTelemetrySummary(payload.telemetry) ? payload.telemetry : undefined,
      };
    } catch {
      return null;
    }
  }

  private emitPromptQueueLog(
    message: string,
    input: {
      target: PromptTarget;
      queuedMessageId: string;
      queueKind: string;
      queueStatus: string;
      provider: string;
      model: string;
      telemetry?: ReturnType<typeof summarizePromptMessagesForTelemetry>;
      clientSubmission?: PromptClientSubmissionMetadata;
      reason?: string;
    },
  ): void {
    this.emitAppLog({
      level: "info",
      source: "prompt",
      message,
      details: {
        queuedMessageId: input.queuedMessageId,
        queueKind: input.queueKind,
        queueStatus: input.queueStatus,
        model: input.model,
        provider: input.provider,
        ...(input.reason ? { reason: input.reason } : {}),
        ...input.telemetry,
        ...promptClientSubmissionLogDetails(input.clientSubmission),
        workspaceSessionId: input.target.workspaceSessionId,
        surfacePiSessionId: input.target.surfacePiSessionId,
        threadId: input.target.threadId,
      },
    });
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
    this.wakeSurfaceQueue(orchestratorTarget);
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
          this.markRuntimeSurfaceMessageQueued({
            id: existingSteering.id,
            position: "front",
          });
          continue;
        }
      }
      const message = createSyntheticUserMessage(text);
      this.enqueueRuntimeSurfaceMessage({
        sessionId: target.workspaceSessionId,
        surfacePiSessionId: target.surfacePiSessionId,
        threadId: target.threadId ?? null,
        messageJson: JSON.stringify(message),
        position: "front",
      });
    }
    for (const existingSteering of steeringRows.toReversed()) {
      this.markRuntimeSurfaceMessageQueued({
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

  private preparePromptExecutionTurn(
    session: ManagedSession,
    options: SendAgentPromptOptions,
  ): PreparedPromptExecutionTurn | null {
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
        target?.surface === "handler" && target.threadId
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
      const rootThreadId =
        target?.surface === "handler" && target.threadId ? target.threadId : null;

      return {
        startTurnInput: {
          sessionId: structuredSessionId,
          surfacePiSessionId: session.sessionId,
          threadId: target?.surface === "handler" ? (target.threadId ?? null) : null,
          requestSummary,
        },
        seed: {
          workspaceSessionId: structuredSessionId,
          surfacePiSessionId: session.sessionId,
          threadId: rootThreadId,
          surfaceKind: target?.surface === "handler" ? "handler" : "orchestrator",
          rootThreadId,
          rootEpisodeKind: inferRootEpisodeKind(promptText),
          threadWasTerminalAtStart: targetThread
            ? isTerminalThreadStatus(targetThread.status)
            : false,
          loadedExtensionIds: targetThread?.loadedExtensionIds ?? session.loadedExtensionIds,
          availableExtensionIds:
            targetThread?.availableExtensionIds ?? session.availableExtensionIds,
          externalInstructionSources: promptExecutionExternalInstructionSources(
            session.externalContextSources,
          ),
          generatedAgentContextFingerprint: session.generatedAgentContextFingerprint,
          generatedAgentContextRevision: String(session.generatedAgentContextRevision),
          queueItemId: options.queuedMessageId ?? null,
        },
      };
    } catch (error) {
      console.error("Failed to prepare prompt execution state:", error);
      return null;
    }
  }

  private createPromptExecutionContextFromTurn(
    turn: RuntimeTurnRecord,
    prepared: PreparedPromptExecutionTurn,
  ): PromptExecutionContext {
    return createRuntimePromptExecutionContext({
      workspaceSessionId: prepared.seed.workspaceSessionId,
      turnId: turn.id,
      surfacePiSessionId: prepared.seed.surfacePiSessionId,
      threadId: prepared.seed.threadId,
      surfaceKind: prepared.seed.surfaceKind,
      rootThreadId: prepared.seed.rootThreadId,
      rootEpisodeKind: prepared.seed.rootEpisodeKind,
      threadWasTerminalAtStart: prepared.seed.threadWasTerminalAtStart,
      loadedExtensionIds: prepared.seed.loadedExtensionIds,
      availableExtensionIds: prepared.seed.availableExtensionIds,
      externalInstructionSources: prepared.seed.externalInstructionSources,
      generatedAgentContextFingerprint: prepared.seed.generatedAgentContextFingerprint,
      generatedAgentContextRevision: prepared.seed.generatedAgentContextRevision,
      queueItemId: prepared.seed.queueItemId,
    });
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
      this.wakeSurfaceQueue(target);
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
    this.wakeSurfaceQueue(target);
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
    this.wakeSurfaceQueue({
      workspaceSessionId: input.sessionId,
      surface: "handler",
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
    const snapshot = this.getStructuredSnapshot(promptContext.workspaceSessionId);
    if (!snapshot || snapshot.turns.length !== 1) {
      return;
    }
    const queued = this.structuredSessionStore.queueTitleGeneration(
      promptContext.workspaceSessionId,
    );
    if (!queued) {
      return;
    }
    this.emitTitleGenerationLog({
      level: "info",
      status: "queued",
      sessionId: promptContext.workspaceSessionId,
    });
    this.syncPiSessionTitle(session, queued.title);
    void this.emitWorkspaceSync("structured.updated");
    this.recoveryCoordinator.enqueue({
      kind: "title_generation",
      ownerScope: {
        kind: "title_job",
        titleJobId: `session:${promptContext.workspaceSessionId}` as TitleJobId,
      },
      idempotencyKey: `title_generation:session:${promptContext.workspaceSessionId}`,
      orderingKey: `surface:${promptContext.surfacePiSessionId}`,
      priority: 70,
      payloadJson: { sessionId: promptContext.workspaceSessionId },
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
      this.emitAppLog({
        level: "error",
        source: "workflow.library",
        message: "Workflows build/link recovery failed.",
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

  private async runRunTaskAgentInput(request: RunTaskAgentInput): Promise<RunTaskAgentResult> {
    const snapshot = this.requireStructuredSnapshot(request.workspaceSessionId);
    const sourceCommand =
      snapshot.commands.find((command) => command.id === request.sourceCommandId) ?? null;
    if (!sourceCommand) {
      throw new RunTaskAgentBridgeError(
        "source_command_not_found",
        `Smithers source command not found: ${request.sourceCommandId}`,
        404,
      );
    }
    if (!sourceCommand.threadId) {
      throw new RunTaskAgentBridgeError(
        "source_command_not_handler_owned",
        "Smithers task-agent bridge requires a handler-thread source command.",
        403,
      );
    }
    if (
      sourceCommand.status === "succeeded" ||
      sourceCommand.status === "failed" ||
      sourceCommand.status === "cancelled"
    ) {
      throw new RunTaskAgentBridgeError(
        "source_command_terminal",
        "Smithers source command is already terminal.",
        409,
      );
    }

    const taskIdentity = request.taskIdentity;
    const workflowRun =
      this.structuredSessionStore.findWorkflowRunBySmithersRunId(taskIdentity.runId) ??
      this.structuredSessionStore.recordWorkflow({
        threadId: sourceCommand.threadId,
        commandId: sourceCommand.id,
        smithersRunId: taskIdentity.runId,
        workflowName: taskIdentity.runId,
        workflowSource: "artifact",
        status: "running",
        summary: `Smithers workflow ${taskIdentity.runId} is running.`,
      });
    const externalContextSources = await this.buildCurrentExternalContextSources();
    const extensionState = resolveActorExtensionState({
      actor: "workflow-task",
      defaultExtensionOrder: this.agentSettingsStore.getState().extensionDefaults.order,
      defaultExtensionUsage: this.agentSettingsStore.getState().extensionDefaults.usage,
      profileExtensionUsage: request.agent.overrides ?? {},
    });
    const aggregate = this.buildPromptAggregateFromLibrary("workflow-task", {
      ...extensionState,
      externalInstructionSources: externalContextSources,
      customInstructions: request.agent.instructions,
    });
    const fingerprint = createGeneratedAgentContextFingerprint({
      systemPrompt: aggregate.outputs.prompt,
      loadedExtensionIds: extensionState.loadedExtensionIds,
      availableExtensionIds: extensionState.availableExtensionIds,
      externalContextSources,
    });
    const existingAttempt = this.structuredSessionStore.findWorkflowTaskAttemptBySmithersIdentity({
      smithersRunId: taskIdentity.runId,
      nodeId: taskIdentity.nodeId,
      iteration: taskIdentity.iteration,
      attempt: taskIdentity.attempt,
    });
    const surfacePiSessionId =
      existingAttempt?.surfacePiSessionId ?? (await this.createWorkflowTaskSurfaceSession(request));
    const prompt = buildWorkflowTaskAgentPrompt(request);
    const attempt = this.structuredSessionStore.upsertWorkflowTaskAttempt({
      workflowRunId: workflowRun.id,
      smithersRunId: taskIdentity.runId,
      nodeId: taskIdentity.nodeId,
      iteration: taskIdentity.iteration,
      attempt: taskIdentity.attempt,
      surfacePiSessionId,
      title: request.agent.label ?? request.agent.id,
      summary: `Run ${request.agent.label ?? request.agent.id} for ${taskIdentity.nodeId}.`,
      kind: "agent",
      status: "running",
      smithersState: "running",
      prompt,
      agentId: request.agent.id,
      agentModel: request.agent.model,
      agentEngine: request.agent.provider,
      generatedAgentContextFingerprint: fingerprint,
      generatedAgentContextBinding: {
        aggregateCacheKey: aggregate.cacheKey,
        systemPrompt: aggregate.outputs.prompt,
        svvyxGuidance: aggregate.outputs.svvyxGuidance,
        commandsDts: aggregate.outputs.commandsDts,
        nativeToolSchemasJson: aggregate.outputs.nativeToolSchemasJson,
        generatedAgentContextRevision: this.generatedAgentContextStore.getState().revision,
        loadedExtensionIds: extensionState.loadedExtensionIds,
        availableExtensionIds: extensionState.availableExtensionIds,
        externalSourceHashes: externalSourceHashes(externalContextSources).toSorted(),
      },
      meta: {
        rootDir: request.smithersContext?.rootDir ?? null,
        sourceCommandId: request.sourceCommandId,
      },
    });

    this.structuredSessionStore.replaceWorkflowTaskMessages({
      workflowTaskAttemptId: attempt.id,
      messages: workflowTaskMessagesFromRequest(request, prompt),
    });

    const session = await this.createManagedSurfaceRecord({
      sessionManager: await this.openWorkflowTaskSurfaceSession(surfacePiSessionId),
      actorKind: "workflow-task",
      provider: request.agent.provider,
      model: request.agent.model,
      thinkingLevel: request.agent.reasoning.effort as ThinkingLevel,
      systemPrompt: aggregate.outputs.prompt,
      generatedAgentContextAggregateKey: aggregate.cacheKey,
      generatedAgentContextAggregate: aggregate.outputs,
      generatedAgentContextFingerprint: fingerprint,
      loadedExtensionIds: extensionState.loadedExtensionIds,
      availableExtensionIds: extensionState.availableExtensionIds,
      externalContextSources,
      agentProfileId: request.agent.id,
    });
    const turn = await this.startRuntimeTurnAsync({
      sessionId: request.workspaceSessionId,
      surfacePiSessionId,
      threadId: sourceCommand.threadId,
      requestSummary: summarizePromptForTurn(prompt),
    });
    const promptContext = createRuntimePromptExecutionContext({
      workspaceSessionId: request.workspaceSessionId,
      turnId: turn.id,
      workflowTaskAttemptId: attempt.id,
      workflowRunId: workflowRun.id,
      surfacePiSessionId,
      surfaceKind: "workflow-task",
      threadId: sourceCommand.threadId,
      rootThreadId: sourceCommand.threadId,
      loadedExtensionIds: extensionState.loadedExtensionIds,
      availableExtensionIds: extensionState.availableExtensionIds,
      externalInstructionSources: externalContextSources,
      generatedAgentContextFingerprint: fingerprint,
      generatedAgentContextRevision: String(this.generatedAgentContextStore.getState().revision),
    });

    try {
      const message = await this.runWorkflowTaskAgentPrompt(session, prompt, promptContext);
      const text = extractAssistantText(message).trim();
      if (!text) {
        throw new Error("Workflow task agent finished without text output.");
      }
      this.structuredSessionStore.upsertWorkflowTaskAttempt({
        workflowRunId: workflowRun.id,
        smithersRunId: taskIdentity.runId,
        nodeId: taskIdentity.nodeId,
        iteration: taskIdentity.iteration,
        attempt: taskIdentity.attempt,
        surfacePiSessionId,
        summary: `Completed ${taskIdentity.nodeId}.`,
        kind: "agent",
        status: "completed",
        smithersState: "succeeded",
        responseText: text,
      });
      this.structuredSessionStore.replaceWorkflowTaskMessages({
        workflowTaskAttemptId: attempt.id,
        messages: [
          ...workflowTaskMessagesFromRequest(request, prompt),
          {
            id: `workflow-task-message-${randomUUID()}`,
            role: "assistant",
            source: "responseText",
            text,
            createdAt: new Date().toISOString(),
          },
        ],
      });
      const usage = RunTaskAgentBridgeUsage(message.usage);
      return { text, ...(usage ? { usage } : {}) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.structuredSessionStore.upsertWorkflowTaskAttempt({
        workflowRunId: workflowRun.id,
        smithersRunId: taskIdentity.runId,
        nodeId: taskIdentity.nodeId,
        iteration: taskIdentity.iteration,
        attempt: taskIdentity.attempt,
        surfacePiSessionId,
        summary: `Failed ${taskIdentity.nodeId}: ${message}`,
        kind: "agent",
        status: "failed",
        smithersState: "failed",
        error: message,
      });
      throw error;
    } finally {
      await this.emitWorkspaceSync("structured.updated");
    }
  }

  private async runWorkflowTaskAgentPrompt(
    session: ManagedSession,
    prompt: string,
    promptContext: PromptExecutionContext,
  ): Promise<AssistantMessage> {
    session.promptExecutionRuntime.current = promptContext;
    const stateWriteLane = createOrderedRuntimeStateWriteLane({
      runState: this.runRuntimeStateAsync.bind(this),
      onError: ({ label, error }) =>
        this.emitAppLog({
          level: "warning",
          source: "prompt",
          message: `Runtime state write failed during ${label}.`,
          details: { errorMessage: error instanceof Error ? error.message : String(error) },
        }),
    });
    const streamingCommandTracker = createStreamingCommandTracker({
      commandState: this.runtimeCommandStatePort,
      promptContext,
      stateWrites: stateWriteLane,
    });
    const toolCommandTracker = createToolExecutionCommandTracker({
      commandState: this.runtimeCommandStatePort,
      promptContext,
      stateWrites: stateWriteLane,
      turnState: this.runtimeTurnStatePort,
      onAppLog: this.emitAppLog.bind(this),
      onReusedStreamingToolCall: (toolCallId) =>
        streamingCommandTracker.releaseToolCall(toolCallId),
    });
    const unsubscribe = session.session.subscribe((event) => {
      if (event.type === "message_update") {
        forwardToolcallEventToStreamingTracker(
          streamingCommandTracker,
          event.assistantMessageEvent,
        );
        return;
      }
      if (event.type === "tool_execution_start") {
        toolCommandTracker.handleToolExecutionStart({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
        return;
      }
      if (event.type === "tool_execution_end") {
        toolCommandTracker.handleToolExecutionEnd({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
        });
      }
    });
    try {
      syncAuthStorage(session.authStorage);
      const promptStartMessageCount = session.session.agent.state.messages.length;
      await session.session.prompt(prompt, { expandPromptTemplates: false });
      const message =
        getLatestAssistantMessage(
          session.session.agent.state.messages.slice(promptStartMessageCount),
        ) ?? getLatestAssistantMessage(session.session.agent.state.messages);
      if (!message) {
        throw new Error("The pi session finished without producing an assistant message.");
      }
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        throw new Error(
          message.errorMessage || `Workflow task agent stopped: ${message.stopReason}`,
        );
      }
      return message;
    } finally {
      unsubscribe();
      streamingCommandTracker.finishDanglingStreamingCommands({
        status: "failed",
        error: "Workflow task prompt ended before streamed command execution settled.",
      });
      toolCommandTracker.finishDanglingCommands({
        status: "failed",
        error: "Workflow task prompt ended before command execution settled.",
      });
      await stateWriteLane.drain();
      session.promptExecutionRuntime.current = null;
    }
  }

  private async createWorkflowTaskSurfaceSession(request: RunTaskAgentInput): Promise<string> {
    const sessionManager = SessionManager.create(this.cwd, this.workflowTaskSurfaceDir);
    sessionManager.newSession();
    sessionManager.appendSessionInfo(
      `${request.agent.label ?? request.agent.id}: ${request.taskIdentity.nodeId}`,
    );
    persistSessionManagerSnapshot(sessionManager);
    return sessionManager.getSessionId();
  }

  private async openWorkflowTaskSurfaceSession(
    surfacePiSessionId: string,
  ): Promise<SessionManager> {
    const sessionFile = await this.getSessionFileForId(surfacePiSessionId);
    return SessionManager.open(sessionFile!, dirname(sessionFile!));
  }

  private async runAgentPrompt(
    session: ManagedSession,
    options: SendAgentPromptOptions,
    promptContext: PromptExecutionContext | null,
  ): Promise<void> {
    session.promptExecutionRuntime.current = promptContext;
    const stateWriteLane = promptContext
      ? createOrderedRuntimeStateWriteLane({
          runState: this.runRuntimeStateAsync.bind(this),
          onError: ({ label, error }) =>
            this.emitAppLog({
              level: "warning",
              source: "prompt",
              message: `Runtime state write failed during ${label}.`,
              details: { errorMessage: error instanceof Error ? error.message : String(error) },
            }),
        })
      : null;
    const streamingCommandTracker = promptContext
      ? createStreamingCommandTracker({
          commandState: this.runtimeCommandStatePort,
          promptContext,
          stateWrites: stateWriteLane!,
        })
      : null;
    const toolCommandTracker = promptContext
      ? createToolExecutionCommandTracker({
          commandState: this.runtimeCommandStatePort,
          promptContext,
          stateWrites: stateWriteLane!,
          turnState: this.runtimeTurnStatePort,
          onAppLog: this.emitAppLog.bind(this),
          onReusedStreamingToolCall: (toolCallId) =>
            streamingCommandTracker?.releaseToolCall(toolCallId),
        })
      : null;
    const onEvent = options.onEvent ?? (() => {});
    const promptStartMessageCount = session.session.agent.state.messages.length;
    const displayUserMessage = getLatestUserMessage(options.messages);
    let queuedMessageDelivered = false;
    const getQueuedMessageDeliveryText = (queued: StructuredSurfaceQueuedMessageRecord): string => {
      if (queued.kind === "thread_report_notification") {
        return this.buildThreadReportNotificationQueuedPrompt(queued);
      }
      if (queued.kind === "thread_followup") {
        return this.buildThreadFollowupQueuedPrompt(queued);
      }
      if (queued.kind === "report_request") {
        return this.buildReportRequestQueuedPrompt(queued);
      }
      if (queued.kind === "request_user_input_answer") {
        return this.buildRequestUserInputAnswerQueuedPrompt(queued);
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
      this.markRuntimeSurfaceMessageDelivered({ id: steering.id });
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
      if (promptContext?.queueItemId && !queuedMessageDelivered) {
        this.markRuntimeSurfaceMessageDelivered({
          id: promptContext.queueItemId,
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
        forwardToolcallEventToStreamingTracker(streamingCommandTracker, event);
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

        const promptText = getLatestUserPromptText(options.messages);
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
        this.syncManagedExtensionStateFromPromptContext(session, promptContext);
        this.completePromptExecution(promptContext, visibleMessage);
      } catch (error) {
        const reason = session.abortRequested ? "aborted" : "error";
        const finishStatus = reason === "aborted" ? ("cancelled" as const) : ("failed" as const);
        const finishError = error instanceof Error ? error.message : "pi prompt failed.";
        streamingCommandTracker?.finishDanglingStreamingCommands({
          status: finishStatus,
          error: finishError,
        });
        toolCommandTracker?.finishDanglingCommands({
          status: finishStatus,
          error: finishError,
        });
        await stateWriteLane?.drain();
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
        this.syncManagedExtensionStateFromPromptContext(session, promptContext);
        this.failPromptExecution(promptContext, failure);
      } finally {
        unsubscribe();
        streamingCommandTracker?.finishDanglingStreamingCommands({
          status: "cancelled",
          error: "Prompt execution ended before the tool run finished.",
        });
        toolCommandTracker?.finishDanglingCommands({
          status: "cancelled",
          error: "Prompt execution ended before the tool run finished.",
        });
        await stateWriteLane?.drain();
        const suppressQueuedDrain = session.abortRequested;
        session.lastPromptSuppressedQueueDrain = suppressQueuedDrain;
        session.lastPromptRestoredQueueItem = false;
        session.abortRequested = false;
        session.activePrompt = false;
        session.activePromptDone = null;
        session.pendingUserMessage = null;
        session.activeStreamMessage = null;
        if (options.queuedMessageId) {
          const latestQueued = this.getRuntimeSurfaceQueuedMessage({
            id: options.queuedMessageId,
          });
          if (latestQueued.status === "dispatching") {
            if (suppressQueuedDrain) {
              this.cancelRuntimeSurfaceMessage({ id: options.queuedMessageId });
            } else {
              this.markRuntimeSurfaceMessageQueued({
                id: options.queuedMessageId,
                position: "front",
              });
              session.lastPromptRestoredQueueItem = true;
            }
          }
          const settledQueued = this.getRuntimeSurfaceQueuedMessage({
            id: options.queuedMessageId,
          });
          this.emitPromptQueueLog("Prompt queue delivery settled.", {
            target: options.target,
            queuedMessageId: options.queuedMessageId,
            queueKind: settledQueued.kind,
            queueStatus: settledQueued.status,
            provider: options.provider,
            model: options.model,
            telemetry:
              options.promptTelemetry ?? summarizePromptMessagesForTelemetry(options.messages),
            clientSubmission: options.clientSubmission,
            reason: suppressQueuedDrain
              ? "cancelled"
              : session.lastPromptRestoredQueueItem
                ? "restored"
                : "settled",
          });
        }
        this.syncManagedState(session);
        this.syncGeneratedAgentContextBindingForTarget(options.target, session);
        await this.emitSurfaceSync({
          session,
          reason: "prompt.settled",
          target: options.target,
        });
        await this.emitWorkspaceSync("workspace.updated");
        if (!suppressQueuedDrain) {
          this.wakeSurfaceQueue(options.target);
        }
        await this.disposeManagedSurfaceIfUnused(session);
      }
    } finally {
      session.promptExecutionRuntime.current = null;
    }
  }

  private syncManagedExtensionStateFromPromptContext(
    session: ManagedSession,
    promptContext: PromptExecutionContext | null,
  ): void {
    if (!promptContext) {
      return;
    }
    session.loadedExtensionIds = [...(promptContext.loadedExtensionIds ?? [])];
    session.availableExtensionIds = [...(promptContext.availableExtensionIds ?? [])];
  }

  private wakeSurfaceQueue(target: PromptTarget): void {
    if (this.closed) {
      return;
    }
    this.recoveryCoordinator.enqueue({
      kind: "queue_delivery",
      ownerScope: {
        kind: "surface",
        workspaceSessionId: target.workspaceSessionId as WorkspaceSessionId,
        surfacePiSessionId: target.surfacePiSessionId as SurfacePiSessionId,
      },
      idempotencyKey: `queue_delivery:${target.surfacePiSessionId}`,
      orderingKey: `surface:${target.surfacePiSessionId}`,
      priority: 30,
    });
    this.recoveryCoordinator.wake();
  }

  private async runSurfaceQueue(target: PromptTarget): Promise<void> {
    await this.runRuntimeQueueEffect(
      this.createRuntimeSurfaceQueueDispatcher().drainSurfaceQueue(target),
    );
  }

  private async refreshSurfaceExtensionContextBeforeNextTurnIfNeeded(
    session: ManagedSession,
    target: PromptTarget,
  ): Promise<ManagedSession> {
    const currentExternalSources = await this.buildCurrentExternalContextSources();
    const binding = this.buildPromptBinding(session, target, currentExternalSources);
    if (!binding.stale || !binding.updateExtensionContextBeforeNextTurn) {
      return session;
    }

    const refreshed = await this.refreshManagedSurfacePromptBinding(session, target);
    await this.emitSurfaceSync({
      session: refreshed,
      reason: "surface.updated",
      target,
      refreshExternalSources: true,
    });
    await this.emitWorkspaceSync("structured.updated");
    return refreshed;
  }

  private async drainNextQueuedSurfacePrompt(
    target: PromptTarget,
    options: { awaitPrompt: boolean },
  ): Promise<boolean> {
    return await this.runRuntimeQueueEffect(
      this.createRuntimeSurfaceQueueDispatcher().drainNextQueuedSurfaceMessage(target, options),
    );
  }

  private createRuntimeSurfaceQueueDispatcher() {
    return createRuntimeSurfaceQueueDispatcherWithPolicy<
      PromptTarget,
      ManagedSession,
      Message,
      UserPromptQueuePayload | null,
      PreparedPromptExecutionTurn
    >({
      workspaceId: this.workspaceId as WorkspaceId,
      queueClaimLeaseMs: this.runtimeLayerConfig.queueClaimLeaseMs,
      host: {
        isClosed: () => this.closed,
        resolveTarget: (currentTarget) =>
          this.resolvePromptTargetForSurfacePiSessionId(currentTarget.surfacePiSessionId),
        retainSurface: (currentTarget) => this.retainManagedSurface(currentTarget),
        releaseSurface: ({ target: currentTarget }) =>
          this.releaseManagedSurface(currentTarget.surfacePiSessionId),
        isSurfaceActive: ({ surface: session }) => session.activePrompt,
        activePromptDone: ({ surface: session }) => session.activePromptDone,
        continueAfterActivePrompt: ({ surface: session }) =>
          !session.lastPromptSuppressedQueueDrain && !session.lastPromptRestoredQueueItem,
        refreshBeforeDispatch: ({ target: currentTarget, surface: session }) =>
          this.refreshSurfaceExtensionContextBeforeNextTurnIfNeeded(session, currentTarget),
        materializeQueuedMessage: ({ target: currentTarget, queued }) =>
          this.materializeQueuedSurfaceMessage(currentTarget, queued),
        prepareTurn: async ({
          target: currentTarget,
          surface: session,
          queued,
          message,
          metadata,
        }) => {
          const prepared = this.prepareQueuedPromptExecutionTurn(
            currentTarget,
            session,
            queued,
            message,
            metadata ?? null,
          );
          if (!prepared) {
            throw new Error(`Queued prompt ${queued.id} has no prompt-bearing user message.`);
          }
          return {
            startTurnInput: prepared.startTurnInput,
            prepared,
          };
        },
        startPrompt: ({
          target: currentTarget,
          surface: session,
          queued,
          turn,
          prepared,
          message,
          metadata,
        }) =>
          this.startQueuedSurfacePrompt(
            currentTarget,
            session,
            queued,
            turn,
            prepared,
            message,
            metadata ?? null,
          ),
        notifyQueueUpdated: ({ target: currentTarget }) =>
          this.emitQueuedSurfaceUpdate(currentTarget).then(() => undefined),
      },
    });
  }

  private async materializeQueuedSurfaceMessage(
    currentTarget: PromptTarget,
    queued: RuntimeSurfaceMessageRecord,
  ): Promise<
    | { kind: "dispatch"; message: Message; metadata?: UserPromptQueuePayload | null }
    | { kind: "delivered" }
  > {
    if (queued.kind === "thread_report_notification") {
      const prompt = this.buildThreadReportNotificationQueuedPrompt(queued);
      return { kind: "dispatch", message: createSyntheticUserMessage(prompt), metadata: null };
    } else if (queued.kind === "initial_handler_start") {
      const snapshot = this.getStructuredSnapshot(currentTarget.workspaceSessionId);
      if (queued.threadId && snapshot?.turns.some((turn) => turn.threadId === queued.threadId)) {
        return { kind: "delivered" };
      }
      return {
        kind: "dispatch",
        message: createSyntheticUserMessage(this.buildInitialHandlerQueuedPrompt(queued)),
        metadata: null,
      };
    } else if (queued.kind === "thread_followup") {
      const payload = this.parseThreadFollowupQueuePayload(queued);
      const snapshot = this.getStructuredSnapshot(currentTarget.workspaceSessionId);
      const thread = snapshot?.threads.find((entry) => entry.id === payload?.threadId) ?? null;
      if (!thread || thread.objectiveState === "concluded") {
        return { kind: "delivered" };
      }
      return {
        kind: "dispatch",
        message: createSyntheticUserMessage(this.buildThreadFollowupQueuedPrompt(queued)),
        metadata: null,
      };
    } else if (queued.kind === "report_request") {
      const payload = this.parseReportRequestQueuePayload(queued);
      const snapshot = this.getStructuredSnapshot(currentTarget.workspaceSessionId);
      const thread = snapshot?.threads.find((entry) => entry.id === payload?.threadId) ?? null;
      if (!thread || thread.objectiveState === "concluded") {
        return { kind: "delivered" };
      }
      return {
        kind: "dispatch",
        message: createSyntheticUserMessage(this.buildReportRequestQueuedPrompt(queued)),
        metadata: null,
      };
    } else if (queued.kind === "request_user_input_answer") {
      return {
        kind: "dispatch",
        message: createSyntheticUserMessage(this.buildRequestUserInputAnswerQueuedPrompt(queued)),
        metadata: null,
      };
    }

    return {
      kind: "dispatch",
      message: this.materializeQueuedUserMessage(queued),
      metadata: this.materializeQueuedUserPromptPayload(queued),
    };
  }

  private buildQueuedPromptOptions(
    currentTarget: PromptTarget,
    session: ManagedSession,
    queued: RuntimeSurfaceMessageRecord,
    message: Message,
    userPromptQueuePayload: UserPromptQueuePayload | null,
  ): SendAgentPromptOptions {
    return {
      target: currentTarget,
      provider: session.provider,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      messages: [...convertToLlmMessages(session.session.agent.state.messages), message],
      queuedMessageId: queued.id,
      clientSubmission: userPromptQueuePayload?.clientSubmission,
      promptTelemetry:
        userPromptQueuePayload?.telemetry ?? summarizePromptMessagesForTelemetry([message]),
    };
  }

  private prepareQueuedPromptExecutionTurn(
    currentTarget: PromptTarget,
    session: ManagedSession,
    queued: RuntimeSurfaceMessageRecord,
    message: Message,
    userPromptQueuePayload: UserPromptQueuePayload | null,
  ): PreparedPromptExecutionTurn | null {
    return this.preparePromptExecutionTurn(
      session,
      this.buildQueuedPromptOptions(
        currentTarget,
        session,
        queued,
        message,
        userPromptQueuePayload,
      ),
    );
  }

  private async startQueuedSurfacePrompt(
    currentTarget: PromptTarget,
    session: ManagedSession,
    queued: RuntimeSurfaceMessageRecord,
    turn: RuntimeTurnRecord,
    preparedTurn: PreparedPromptExecutionTurn,
    message: Message,
    userPromptQueuePayload: UserPromptQueuePayload | null,
  ): Promise<{ promptDone: Promise<void>; continueAfterPrompt(): boolean }> {
    session.abortRequested = false;
    session.lastPromptSuppressedQueueDrain = false;
    session.lastPromptRestoredQueueItem = false;
    session.activePrompt = true;
    session.activeStreamSequence = 0;
    session.activeStreamMessage = null;

    const promptOptions = this.buildQueuedPromptOptions(
      currentTarget,
      session,
      queued,
      message,
      userPromptQueuePayload,
    );
    this.emitPromptQueueLog("Prompt queue delivery started.", {
      target: currentTarget,
      queuedMessageId: queued.id,
      queueKind: queued.kind,
      queueStatus: queued.status,
      provider: promptOptions.provider,
      model: promptOptions.model,
      telemetry: promptOptions.promptTelemetry,
      clientSubmission: promptOptions.clientSubmission,
    });
    const promptExecution = this.createPromptExecutionContextFromTurn(turn, preparedTurn);
    if (
      (queued.kind === "thread_followup" || queued.kind === "report_request") &&
      promptExecution
    ) {
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

    const promptDone = this.runAgentPrompt(session, promptOptions, promptExecution);
    session.activePromptDone = promptDone;
    return {
      promptDone,
      continueAfterPrompt: () =>
        !session.lastPromptSuppressedQueueDrain && !session.lastPromptRestoredQueueItem,
    };
  }

  private completePromptExecution(
    promptContext: PromptExecutionContext | null,
    message: AssistantMessage,
  ): void {
    if (!promptContext?.turnId) {
      return;
    }

    try {
      const snapshot = this.structuredSessionStore.getSessionState(
        promptContext.workspaceSessionId,
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
        this.finishRuntimeTurn({
          turnId: promptContext.turnId,
          status: "waiting",
        });
        if (this.focusedSurfacePiSessionId !== promptContext.surfacePiSessionId) {
          this.structuredSessionStore.markSessionUnread({
            sessionId: promptContext.workspaceSessionId,
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

      this.finishRuntimeTurn({
        turnId: promptContext.turnId,
        status: "completed",
      });
      this.settleHandlerThreadAfterPrompt(promptContext);
      if (this.focusedSurfacePiSessionId !== promptContext.surfacePiSessionId) {
        this.structuredSessionStore.markSessionUnread({
          sessionId: promptContext.workspaceSessionId,
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

    const snapshot = this.structuredSessionStore.getSessionState(promptContext.workspaceSessionId);
    const thread =
      snapshot.threads.find((entry) => entry.id === promptContext.rootThreadId) ?? null;
    if (!thread || thread.status !== "running-handler" || thread.wait) {
      return;
    }

    const turn = snapshot.turns.find((entry) => entry.id === promptContext.turnId) ?? null;
    if (!turn || turn.status !== "completed") {
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
    if (!promptContext?.turnId) {
      return;
    }

    try {
      const snapshot = this.structuredSessionStore.getSessionState(
        promptContext.workspaceSessionId,
      );
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
      this.finishRuntimeTurn({
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

    this.setRuntimeTurnDecision({
      turnId: input.promptContext.turnId!,
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

function convertToLlmMessages(messages: AgentMessage[]): Message[] {
  return messages.filter((message): message is Message => {
    return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
  });
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

function promptExecutionExternalInstructionSources(
  sources: readonly GeneratedAgentContextExternalSource[],
): PromptExecutionExternalInstructionSource[] {
  return sources.map((source) => ({
    id: source.id,
    kind: source.kind,
    title: source.title,
    path: source.path,
    contentHash: source.contentHash,
    order: source.order,
    enabled: source.enabled,
    actors: [...source.actors],
    sourceGroup: source.sourceGroup,
    ...(source.rootId === undefined ? {} : { rootId: source.rootId }),
    ...(source.rootLabel === undefined ? {} : { rootLabel: source.rootLabel }),
    readStatus: {
      status: source.readStatus.status,
      ...(source.readStatus.error === undefined ? {} : { error: source.readStatus.error }),
    },
  }));
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

function buildOrchestratorThreadReportPrompt(
  _thread: StructuredSessionSnapshot["threads"][number] | null,
  summary: string,
  outcome: "succeeded" | "failed" | "cancelled" | null,
): string {
  return [
    outcome
      ? `System event: A handler thread concluded with outcome ${outcome}.`
      : "System event: A handler thread emitted a durable report update.",
    `Report summary: ${summary}`,
    "Use thread_list and thread_episodes if durable delegated-thread state matters, then decide the next orchestrator action.",
  ].join("\n");
}

function buildInitialHandlerThreadPrompt(
  thread: StructuredSessionSnapshot["threads"][number],
  parentSessionFile: string | null = null,
): string {
  const objective = thread.objective.trim();
  if (thread.historyMode !== "forked" || !parentSessionFile) {
    return objective;
  }
  const history = buildForkedHandlerHistoryBlock(parentSessionFile);
  if (!history) {
    return objective;
  }
  return [
    objective,
    "",
    "<inherited_history>",
    history,
    "</inherited_history>",
    "",
    "Use the inherited history only as bounded background for this delegated objective.",
  ].join("\n");
}

function parseInitialHandlerStartQueuePayload(
  message: StructuredSurfaceQueuedMessageRecord,
): InitialHandlerStartQueuePayload | null {
  if (!message.payloadJson) {
    return null;
  }
  try {
    const payload = JSON.parse(message.payloadJson) as Partial<InitialHandlerStartQueuePayload>;
    if (typeof payload.threadId !== "string") {
      return null;
    }
    return {
      threadId: payload.threadId,
      parentSessionFile:
        typeof payload.parentSessionFile === "string" ? payload.parentSessionFile : null,
      requestedAt: typeof payload.requestedAt === "string" ? payload.requestedAt : "",
    };
  } catch {
    return null;
  }
}

function buildForkedHandlerHistoryBlock(parentSessionFile: string): string | null {
  try {
    const sessionManager = SessionManager.open(parentSessionFile, dirname(parentSessionFile));
    const messages = sessionManager
      .buildSessionContext()
      .messages.filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-12);
    const lines = messages
      .map((message, index) => {
        const text = readMessageText(message).trim();
        if (!text) {
          return null;
        }
        return `${index + 1}. orchestrator ${message.role}: ${text}`;
      })
      .filter((line): line is string => Boolean(line));
    return lines.length > 0 ? lines.join("\n\n") : null;
  } catch {
    return null;
  }
}

function readMessageText(message: AgentMessage): string {
  if (!("content" in message)) {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .map((part) => {
      if ("text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
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
    return "request_user_input";
  }

  if (looksLikeClarificationReply(input.assistantText)) {
    return "request_user_input";
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

function forwardToolcallEventToStreamingTracker(
  tracker: import("./streaming-command-tracker").StreamingCommandTracker | null,
  event: AssistantMessageEvent,
): void {
  if (!tracker) return;
  if (event.type === "toolcall_start") {
    const toolCall = event.partial.content[event.contentIndex];
    if (!toolCall || toolCall.type !== "toolCall") return;
    tracker.handleToolcallStart({
      contentIndex: event.contentIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      partialArguments: toolArgumentsAsJsonObject(toolCall.arguments),
      partial: event.partial,
    });
  } else if (event.type === "toolcall_delta") {
    const toolCall = event.partial.content[event.contentIndex];
    if (!toolCall || toolCall.type !== "toolCall") return;
    tracker.handleToolcallDelta({
      contentIndex: event.contentIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      delta: event.delta,
      partialArguments: toolArgumentsAsJsonObject(toolCall.arguments),
      partial: event.partial,
    });
  } else if (event.type === "toolcall_end") {
    tracker.handleToolcallEnd({
      contentIndex: event.contentIndex,
      toolCallId: event.toolCall.id,
      toolName: event.toolCall.name,
      arguments: toolArgumentsAsJsonObject(event.toolCall.arguments),
      partial: event.partial,
    });
  }
}

function toolArgumentsAsJsonObject(value: unknown): Record<string, import("@svvy/core").JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  try {
    const json = JSON.parse(JSON.stringify(value));
    return json && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, import("@svvy/core").JsonValue>)
      : {};
  } catch {
    return {};
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

function buildWorkflowTaskAgentPrompt(request: RunTaskAgentInput): string {
  if (request.promptSource.kind === "prompt") {
    return request.promptSource.prompt.trim();
  }

  const messages = request.promptSource.messages
    .map((message) => `${message.role}: ${message.text.trim()}`)
    .filter((line) => line.trim().length > 0)
    .join("\n\n");
  if (messages.trim()) {
    return messages;
  }
  throw new Error("runTaskAgent requires prompt or messages.");
}

function RunTaskAgentBridgeUsage(
  usage: AssistantMessage["usage"] | undefined,
): RunTaskAgentResult["usage"] | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
  };
}

function workflowTaskMessagesFromRequest(
  request: RunTaskAgentInput,
  prompt: string,
): Array<{
  id: string;
  role: "user" | "assistant" | "stderr";
  source: "prompt" | "event" | "responseText";
  text: string;
  createdAt: string;
}> {
  const now = new Date().toISOString();
  const messages =
    request.promptSource.kind === "messages"
      ? request.promptSource.messages.map((message) => ({
          id: `workflow-task-message-${randomUUID()}`,
          role: (message.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
          source: "prompt" as const,
          text: message.text,
          createdAt: now,
        }))
      : [
          {
            id: `workflow-task-message-${randomUUID()}`,
            role: "user" as const,
            source: "prompt" as const,
            text: prompt,
            createdAt: now,
          },
        ];
  return messages;
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
