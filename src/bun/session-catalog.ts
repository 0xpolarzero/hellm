import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { getProviders, type AssistantMessage, type Message } from "@mariozechner/pi-ai";
import {
  SessionManager,
  type AgentSession,
  type AuthStorage,
  type ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import {
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
  type ExtensionId as CoreExtensionId,
  type StateContractError,
  type StateInvalidationDescriptor,
  type StateMutationResult,
  type RequestInputSettings,
  type RuntimePromptTelemetryMessage,
  type RuntimeRecoveryStatePortService,
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
  type SvvyxExtensionManagementRuntimeRequest,
  type SvvyxExtensionManagementRuntimeResponse,
  type SvvyxWorkflowsRuntimeRequest,
  type SvvyxWorkflowsRuntimeResponse,
  SandboxPolicySource,
  type SandboxPolicySourceService,
} from "@svvy/core";
import type {
  CreateSessionRequest,
  PromptTarget,
  PromptClientSubmissionMetadata,
  SurfaceMutationResponse,
  SurfaceOpenResponse,
  WorkspaceMutationResponse,
} from "../shared/workspace-contract";
import type { GeneratedAgentContextExternalSource } from "../shared/generated-agent-context";
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_ORCHESTRATOR_PROFILE_ID,
  DEFAULT_THREAD_HANDLER_PROFILE_ID,
  type AgentDefaults,
  type AgentSettingsState,
  type AppPreferences,
  type AgentProfileId,
  type AgentProfileSettings,
} from "../shared/agent-settings";
import {
  createAgentProfileMutationStore,
  type AgentProfileAuthoritySnapshot,
  type AgentProfileMutation,
} from "./agent-profile-mutation-store";
import {
  defaultRuntimeLayerConfig,
  type RuntimeLayerCommandControlPortService,
  type RuntimeLayerConfig,
} from "@svvy/runtime/bootstrap";
import { type PromptExecutionRuntimeHandle } from "@svvy/runtime/prompt-execution-context";

type RuntimeExecuteTypescriptHostInput = Parameters<
  RuntimeLayerCommandControlPortService["runExecuteTypescript"]
>[0];
import {
  createStructuredSessionStateStore,
  StructuredSessionState,
  type StructuredPiSessionRecord,
  type StructuredSessionSnapshot,
  type StructuredSessionStateStore,
  structuredSessionStateFromStore,
} from "@svvy/state/structured-session-state";
import {
  layerSandboxPolicySourceWithConfig,
  type AgentActorExtensionDefaultsReadModelRecord,
  type ConfiguredAgentProfileReadModelRecord,
  type OrchestratorAgentProfileInput,
  type SetProfileExtensionUsageCommandInput,
  type ThreadHandlerProfileInput,
  type WorkflowAgentSourceReadModelRecord,
} from "@svvy/state";
import {
  runtimeActorExtensionBindingStatePortFromStore,
  runtimeApprovalStatePortFromStore,
  runtimeArtifactStatePortFromStore,
  runtimeQueueStatePortFromStore,
  runtimeCommandStatePortFromStore,
  runtimeEpisodeStatePortFromStore,
  extensionStatePortFromStore,
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
  structuredSessionCatalogMutationsFromStore,
  type WorkspaceStateRegistration,
} from "@svvy/state/structured-session-adapters";
import type { AppLoggerEvent } from "./app-logger";
import { createExecuteTypescriptTool, runExecuteTypescript } from "./execute-typescript-tool";
import {
  createListExtensionsTool,
  createLoadExtensionTool,
  extensionRecordFromRegistryObservation,
  type RunAcceptedLoadExtension,
} from "./extension-tools";
import { getCredential, resolveApiKey, resolveAuthState } from "./auth-store";
import { getOAuthRefreshError, refreshIfNeeded, supportsOAuth } from "./oauth-login";
import { PiAdapter, layer as PiAdapterLayer } from "@svvy/pi-adapter";
import { createPiManagedAgentSession } from "@svvy/pi-adapter/session";
import { createStartThreadTool } from "./thread-start-tool";
import { createThreadReportTool, type ThreadReportNotificationRequest } from "./thread-report-tool";
import {
  createThreadFollowupTool,
  createThreadRequestReportTool,
} from "./thread-orchestration-tools";
import { extensionsRootForAgentDir } from "./extension-paths";
import type { SvvyActorKind } from "./actor-capabilities";
import { createAgentSettingsStore } from "./agent-settings-store";
import type { LiveCommandStdinRegistry } from "./live-command-stdin-registry";
import { createSvvyDirectTools, type runTaskAgentBridgeEnvProvider } from "./svvy-direct-tools";
import type { SvvyxRuntimeExtensionPlan } from "./svvyx-runtime-command";
import type { RuntimeApprovalBoundary } from "./approval-boundary";
import {
  resolveActorExtensionState,
  type ExtensionRecord,
  type ExtensionUsageState,
} from "@svvy/extensions";
import { discoverExternalInstructionSources } from "./external-instructions";
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

export const STRUCTURED_SESSION_DB_FILENAME = "structured-session-state-v8.sqlite";

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
  runtimeCommandStdin?: LiveCommandStdinRegistry;
  approvalBoundary?: RuntimeApprovalBoundary;
  extensionsRoot?: string;
  extensionsRuntimePlans?: () => readonly SvvyxRuntimeExtensionPlan[];
  resolveVisibleExtensionRecords?: (ids: readonly string[]) => Promise<readonly ExtensionRecord[]>;
  applyExtensionManagementRuntimeRequest?: WorkspaceRecoveryOptions["applyExtensionManagementRuntimeRequest"];
  applyWorkflowsRuntimeRequest?: WorkspaceRecoveryOptions["applyWorkflowsRuntimeRequest"];
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
  runAcceptedLoadExtension?: RunAcceptedLoadExtension;
  requestDirectToolApproval?: RuntimeApprovalBoundary;
  workflowsExtensionsGeneratedPackagePath?: string;
  workflowsGeneratedPackagePath?: string;
  workflowsSourceRoot?: string;
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
  artifactDirectory?: string;
  workflowsExtensionsGeneratedPackagePath?: string;
  workflowsGeneratedPackagePath?: string;
  workflowsSourceRoot?: string;
  applyExtensionManagementRuntimeRequest?: (
    request: SvvyxExtensionManagementRuntimeRequest,
  ) => Promise<SvvyxExtensionManagementRuntimeResponse>;
  applyWorkflowsRuntimeRequest?: (
    request: SvvyxWorkflowsRuntimeRequest,
  ) => Promise<SvvyxWorkflowsRuntimeResponse>;
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
  runtimeStartupOwnsRecovery?: boolean;
  wakeSurfaceQueue?: (target: PromptTarget) => Promise<void>;
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

const missingVisibleExtensionRecordResolver = async (): Promise<readonly ExtensionRecord[]> => {
  throw new Error("WorkspaceSessionCatalog requires the state-backed extension registry resolver.");
};

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

type CommittedStateInvalidationPublisher = (
  afterCommit: readonly StateInvalidationDescriptor[],
) => Promise<void>;

export interface CatalogAgentProfileAuthoritySnapshot {
  readonly configuredProfiles: readonly ConfiguredAgentProfileReadModelRecord[];
  readonly workflowAgents: readonly WorkflowAgentSourceReadModelRecord[];
  readonly actorExtensionDefaults: readonly AgentActorExtensionDefaultsReadModelRecord[];
}

export interface CatalogAgentProfileAuthority {
  read(): Promise<CatalogAgentProfileAuthoritySnapshot>;
  updateOrchestrator(profile: OrchestratorAgentProfileInput): Promise<void>;
  updateThreadHandler(profile: ThreadHandlerProfileInput): Promise<void>;
  setProfileExtensionUsage(
    input: Omit<SetProfileExtensionUsageCommandInput, "clientSubmission">,
  ): Promise<void>;
  setActorExtensionDefaults(input: {
    actor: "orchestrator" | "workflow-task";
    extensionUsage: Readonly<Record<string, ExtensionUsageState>>;
    extensionOrder: readonly string[];
  }): Promise<void>;
  saveWorkflowAgentSource(input: {
    sourceId: string;
    expectedSourceVersion: string;
    text: string;
  }): Promise<void>;
  upsertWorkflowAgentSource(
    input: Extract<AgentProfileMutation, { kind: "workflow-agent-source.upsert" }>,
  ): Promise<void>;
}

export interface CatalogRequestInputSettingsAuthority {
  read(): RequestInputSettings;
}

type PendingCommittedStateInvalidation = {
  readonly operation: string;
  readonly afterCommit: readonly StateInvalidationDescriptor[];
  readonly details?: Record<string, unknown>;
};

const missingCatalogEffectRunner: CatalogEffectRunner = () => {
  throw new Error("WorkspaceSessionCatalog requires an app-bootstrap Effect runner.");
};

export class WorkspaceSessionCatalog {
  private readonly managedSurfaces = new Map<string, ManagedSession>();
  private readonly structuredSessionStore: StructuredSessionStateStore;
  private readonly catalogStateMutations: ReturnType<
    typeof structuredSessionCatalogMutationsFromStore
  >;
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
  private readonly recoveryCoordinator: WorkspaceRecoveryCoordinator;
  private readonly activeTurnRecovery: Promise<void>;
  private recoveryPreparation: Promise<void> | null = null;
  private recoveryPrepared = false;
  private recoveryStarted = false;
  private readonly agentSettingsStore: ReturnType<typeof createAgentSettingsStore>;
  private agentProfileAuthority: CatalogAgentProfileAuthority | null = null;
  private agentProfileAuthoritySnapshot: CatalogAgentProfileAuthoritySnapshot | null = null;
  private requestInputSettingsAuthority: CatalogRequestInputSettingsAuthority | null = null;
  private readonly extensionsRoot: string;
  private readonly approvalBoundary: RuntimeApprovalBoundary;
  private closed = false;
  private titleGenerationLogListener: ((event: TitleGenerationLogEvent) => void) | null = null;
  private workflowsGeneratedPackageLogListener:
    | ((event: WorkflowsGeneratedPackageLogEvent) => void)
    | null = null;
  private appLogListener: ((event: AppLoggerEvent) => void) | null = null;
  private committedStateInvalidationPublisher: CommittedStateInvalidationPublisher | null = null;
  private readonly pendingCommittedStateInvalidations: PendingCommittedStateInvalidation[] = [];
  private committedStateInvalidationFlush: Promise<void> | null = null;
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
      agentDir: this.agentDir,
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
        artifactDir:
          this.recoveryOptions.artifactDirectory ??
          resolveConfiguredArtifactDirectory(
            this.agentSettingsStore.getState().appPreferences.artifactDirectory,
            this.cwd,
          ),
      },
      workspaceArtifactDirectoryAuthority: this.recoveryOptions.artifactDirectory
        ? "state-preference"
        : "seed",
      databasePath: join(this.sessionDir, STRUCTURED_SESSION_DB_FILENAME),
    });
    this.catalogStateMutations = structuredSessionCatalogMutationsFromStore(
      this.structuredSessionStore,
    );
    this.runtimeActorExtensionBindingStatePort = runtimeActorExtensionBindingStatePortFromStore(
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
    this.recoveryCoordinator = new WorkspaceRecoveryCoordinator(
      this.workspaceId as WorkspaceId,
      this.runtimeRecoveryStatePort,
      {
        recoverSurfaceTurn: async (surfacePiSessionId) => {
          await this.recoverInterruptedSurfaceTurn(surfacePiSessionId);
        },
        wakeSurfaceQueue: async (target) => {
          const wakeSurfaceQueue = this.recoveryOptions.wakeSurfaceQueue;
          if (!wakeSurfaceQueue) {
            throw new Error(
              "Workspace queue recovery requires the runtime-owned surface queue wake seam.",
            );
          }
          await wakeSurfaceQueue(target);
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
    const runtimeTurnStatePort = runtimeTurnStatePortFromStore(this.structuredSessionStore);
    this.runtimeTurnStatePort = {
      ...runtimeTurnStatePort,
      queueTopLevelTitleGeneration: (input) =>
        runtimeTurnStatePort.queueTopLevelTitleGeneration(input).pipe(
          Effect.tap((mutation) =>
            mutation.value.queued
              ? Effect.sync(() => {
                  this.recoveryCoordinator.enqueue({
                    kind: "title_generation",
                    ownerScope: {
                      kind: "title_job",
                      titleJobId: `session:${input.sessionId}` as TitleJobId,
                    },
                    idempotencyKey: `title_generation:session:${input.sessionId}`,
                    orderingKey: `surface:${input.surfacePiSessionId}`,
                    priority: 70,
                    payloadJson: { sessionId: input.sessionId },
                  });
                  this.emitTitleGenerationLog({
                    level: "info",
                    status: "queued",
                    sessionId: input.sessionId,
                  });
                  this.recoveryCoordinator.wake();
                })
              : Effect.void,
          ),
        ),
    };
    if (this.recoveryOptions.runtimeStartupOwnsRecovery) {
      this.activeTurnRecovery = Promise.resolve();
    } else {
      this.recoveryCoordinator.seedActiveTurnRecoveryFromDurableState();
      this.activeTurnRecovery = this.recoveryCoordinator.startActiveTurnRecovery();
    }
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

  prepareWorkspaceRecoveryAfterRegistration(): Promise<void> {
    if (this.closed) {
      return Promise.reject(
        new Error("Cannot prepare workspace recovery after the session catalog is closed."),
      );
    }
    if (this.recoveryPrepared) return Promise.resolve();
    if (this.recoveryPreparation) return this.recoveryPreparation;
    const preparation = this.activeTurnRecovery.then(() => {
      if (this.closed) return;
      this.recoveryCoordinator.normalizeAndSeedRemainingRecoveryFromDurableState();
      this.recoveryPrepared = true;
    });
    this.recoveryPreparation = preparation;
    return preparation;
  }

  startWorkspaceRecovery(): void {
    if (this.closed) {
      throw new Error("Cannot start workspace recovery after the session catalog is closed.");
    }
    if (!this.recoveryPrepared) {
      throw new Error(
        "Workspace recovery must normalize durable state after registration before queue replay starts.",
      );
    }
    if (this.recoveryStarted) return;
    this.recoveryStarted = true;
    void this.recoveryCoordinator.start();
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

  setCommittedStateInvalidationPublisher(
    publisher: CommittedStateInvalidationPublisher | null,
  ): Promise<void> {
    this.committedStateInvalidationPublisher = publisher;
    return publisher ? this.flushCommittedStateInvalidations() : Promise.resolve();
  }

  setAgentProfileAuthority(authority: CatalogAgentProfileAuthority): void {
    if (this.agentProfileAuthority === authority) return;
    this.agentProfileAuthority = authority;
    this.agentProfileAuthoritySnapshot = null;
  }

  setRequestInputSettingsAuthority(authority: CatalogRequestInputSettingsAuthority): void {
    this.requestInputSettingsAuthority = authority;
  }

  getRequestInputSettings(): RequestInputSettings {
    return this.readCommittedRequestInputSettings();
  }

  getExtensionStatePort(): ExtensionStatePortService {
    return extensionStatePortFromStore(this.structuredSessionStore);
  }

  workspaceStateRouterRegistration(): WorkspaceStateRegistration {
    return {
      store: this.structuredSessionStore,
      turnStatePort: this.runtimeTurnStatePort,
    };
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

  async runAcceptedExecuteTypescript(
    input: RuntimeExecuteTypescriptHostInput,
    signal?: AbortSignal,
  ): Promise<NativeToolResult> {
    const afterCommit: StateInvalidationDescriptor[] = [];
    const runState = <A>(effect: Effect.Effect<A, StateContractError>): A => {
      const value = this.runRuntimeState(effect);
      if (
        value &&
        typeof value === "object" &&
        "afterCommit" in value &&
        Array.isArray((value as { afterCommit?: unknown }).afterCommit)
      ) {
        afterCommit.push(
          ...((value as { afterCommit: readonly StateInvalidationDescriptor[] }).afterCommit ?? []),
        );
      }
      return value;
    };
    let result: Awaited<ReturnType<typeof runExecuteTypescript>> | undefined;
    try {
      result = await runExecuteTypescript({
        cwd: input.cwd,
        workspaceId: input.workspaceId,
        artifactState: this.runtimeArtifactStatePort,
        commandState: this.runtimeCommandStatePort,
        runState,
        readArtifactRootForSession: (sessionId) =>
          this.structuredSessionStore.getSessionState(sessionId).workspace.artifactDir,
        signal,
        typescriptCode: input.typescriptCode,
        context: {
          sessionId: input.target.workspaceSessionId,
          turnId: input.turnId,
          workflowTaskAttemptId:
            input.target.surface === "workflow-task" ? input.target.workflowTaskAttemptId : null,
          workflowRunId:
            input.target.surface === "workflow-task" ? input.target.workflowRunId : null,
          actor: input.target.surface,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.surface === "handler" ? input.target.threadId : null,
          executor:
            input.target.surface === "workflow-task" ? "workflow-task-agent" : input.target.surface,
          loadedExtensionIds: input.actorBinding.loadedExtensionIds,
        },
        onWorkflowsGeneratedPackageChanged: this.emitWorkflowsGeneratedPackageLog.bind(this),
        workflowsExtensionsGeneratedPackagePath:
          this.recoveryOptions.workflowsExtensionsGeneratedPackagePath,
        extensionsRoot: this.extensionsRoot,
        workflowsGeneratedPackagePath: this.recoveryOptions.workflowsGeneratedPackagePath,
        workflowsSourceRoot: this.recoveryOptions.workflowsSourceRoot,
        agentSettingsStore: this.agentSettingsStore,
        applyAgentProfileMutations: this.applyAgentProfileMutations.bind(this),
        requestWorkflowsRuntime: this.recoveryOptions.applyWorkflowsRuntimeRequest,
        extensionsEnvValues: () =>
          this.agentSettingsStore.getState().extensionEnv.nonSecretOverrides,
        onAppLog: this.emitAppLog.bind(this),
        approvalBoundary: this.approvalBoundary,
        approvalMode: () => input.approvalMode,
        acquireExecuteTypescriptLaunch: requiredExecuteTypescriptLaunchAcquisition(
          this.recoveryOptions.acquireExecuteTypescriptLaunch,
        ),
        toolCallId: input.toolCallId,
      });
    } finally {
      await this.publishCommittedCatalogMutation(
        "execute_typescript.accepted",
        { value: undefined, afterCommit },
        {
          commandId: input.commandId,
          toolCallId: input.toolCallId,
          workspaceSessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
        },
      );
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      details: {
        commandFacts: result as unknown as import("@svvy/core").CommandFactsPayload,
      },
    };
  }

  getSandboxPolicySource(): SandboxPolicySourceService {
    return this.runRuntimeState(
      Effect.gen(function* () {
        return yield* SandboxPolicySource;
      }).pipe(
        Effect.provide(
          layerSandboxPolicySourceWithConfig({
            currentAppPreferences: () => {
              const { approvalMode, networkAccess } =
                this.agentSettingsStore.getState().appPreferences;
              return { approvalMode, networkAccess };
            },
          }),
        ),
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

  private async refreshAgentProfileAuthority(): Promise<CatalogAgentProfileAuthoritySnapshot> {
    if (!this.agentProfileAuthority) {
      throw new Error(
        "WorkspaceSessionCatalog requires the app-global state-backed agent profile authority.",
      );
    }
    const snapshot = await this.agentProfileAuthority.read();
    this.agentProfileAuthoritySnapshot = {
      configuredProfiles: snapshot.configuredProfiles.map((profile) => ({
        ...profile,
        extensionUsage: { ...profile.extensionUsage },
        extensionOrder: [...profile.extensionOrder],
      })),
      workflowAgents: snapshot.workflowAgents.map((source) => ({
        ...source,
        diagnostics: source.diagnostics.map((diagnostic) => ({ ...diagnostic })),
        parameters: source.parameters
          ? {
              ...source.parameters,
              reasoning: { ...source.parameters.reasoning },
              ...(source.parameters.overrides
                ? { overrides: { ...source.parameters.overrides } }
                : {}),
            }
          : null,
        extensionOrder: [...source.extensionOrder],
      })),
      actorExtensionDefaults: snapshot.actorExtensionDefaults.map((defaults) => ({
        ...defaults,
        extensionUsage: { ...defaults.extensionUsage },
        extensionOrder: [...defaults.extensionOrder],
      })),
    };
    return this.agentProfileAuthoritySnapshot;
  }

  private requireAgentProfileAuthority(): CatalogAgentProfileAuthority {
    if (!this.agentProfileAuthority) {
      throw new Error(
        "WorkspaceSessionCatalog requires the app-global state-backed agent profile authority.",
      );
    }
    return this.agentProfileAuthority;
  }

  private requireAgentProfileAuthoritySnapshot(): CatalogAgentProfileAuthoritySnapshot {
    if (!this.agentProfileAuthoritySnapshot) {
      throw new Error(
        "WorkspaceSessionCatalog agent profiles must be refreshed before synchronous prompt projection.",
      );
    }
    return this.agentProfileAuthoritySnapshot;
  }

  private newAgentProfileMutationStore() {
    return createAgentProfileMutationStore({
      snapshot: this.requireAgentProfileAuthoritySnapshot() as AgentProfileAuthoritySnapshot,
      networkAccess: this.agentSettingsStore.getState().appPreferences.networkAccess,
    });
  }

  async getAgentProfileMutationStore() {
    await this.refreshAgentProfileAuthority();
    return this.newAgentProfileMutationStore();
  }

  async applyAgentProfileMutations(mutations: readonly AgentProfileMutation[]): Promise<void> {
    const authority = this.requireAgentProfileAuthority();
    for (const mutation of mutations) {
      if (mutation.kind === "profile-extension-usage.set") {
        await authority.setProfileExtensionUsage({
          actor: mutation.actor,
          profileId: mutation.profileId as CoreAgentProfileId,
          extensionId: mutation.extensionId as CoreExtensionId,
          usage: mutation.usage,
        });
        continue;
      }
      if (mutation.kind === "actor-extension-defaults.set") {
        await authority.setActorExtensionDefaults(mutation);
        continue;
      }
      if (mutation.kind === "workflow-agent-source.upsert") {
        await authority.upsertWorkflowAgentSource(mutation);
        continue;
      }
      await authority.saveWorkflowAgentSource(mutation);
    }
    if (mutations.length > 0) {
      await this.refreshAgentProfileAuthority();
    }
  }

  private readCommittedRequestInputSettings(): RequestInputSettings {
    if (!this.requestInputSettingsAuthority) {
      throw new Error(
        "WorkspaceSessionCatalog requires the app-global state-backed request-input settings authority.",
      );
    }
    return this.requestInputSettingsAuthority.read();
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

  updateAppPreferences(preferences: AppPreferences): AgentSettingsState {
    const next = this.agentSettingsStore.hydrateStateOwnedAppPreferences(preferences);
    this.markOpenSurfacesForPromptRefresh();
    return next;
  }

  async notifyAppPreferencesChanged(): Promise<void> {
    this.markOpenSurfacesForPromptRefresh();
  }

  async notifySourceInputsChanged(_reason: string): Promise<void> {
    this.markOpenSurfacesForPromptRefresh();
  }

  getExtensionsRoot(): string {
    return this.extensionsRoot;
  }

  private readSvvyxRuntimeExtensionPlans(): readonly SvvyxRuntimeExtensionPlan[] {
    const registry = this.structuredSessionStore.readExtensionRegistryObservation();
    if (!registry) return [];
    return registry.observation.observations.map((observation) => ({
      extensionId: observation.extensionId,
      interfaceKind: observation.interfaceKind,
      sourceFingerprint: observation.sourceFingerprint,
      env: observation.envDeclarations.map((declaration) => ({
        name: declaration.name,
        required: declaration.required,
        secret: declaration.secret,
        description: declaration.description,
        hasDefault: declaration.hasDefault,
      })),
      dependencies: observation.dependencyDeclarations.map((declaration) => ({
        kind: declaration.kind,
        name: declaration.name,
        version: declaration.version,
      })),
    }));
  }

  private async resolveVisibleExtensionRecords(
    ids: readonly string[],
  ): Promise<readonly ExtensionRecord[]> {
    const selected = new Set(ids);
    return (
      this.structuredSessionStore.readExtensionRegistryObservation()?.observation.observations ?? []
    )
      .filter((record) => selected.has(record.extensionId))
      .map(extensionRecordFromRegistryObservation);
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

  private resolveConfiguredProfileExtensionState(
    actor: "orchestrator" | "handler",
    settings: {
      extensionUsage?: Readonly<Record<string, ExtensionUsageState>>;
      extensionOrder?: readonly string[];
    },
    snapshot: CatalogAgentProfileAuthoritySnapshot,
  ): { loadedExtensionIds: string[]; availableExtensionIds: string[] } {
    const actorDefaults = snapshot.actorExtensionDefaults.find(
      (candidate) => candidate.actor === actor,
    );
    return resolveActorExtensionState({
      actor,
      defaultExtensionOrder: actorDefaults?.extensionOrder ?? [],
      defaultExtensionUsage: actorDefaults ? { [actor]: actorDefaults.extensionUsage } : {},
      profileExtensionUsage: settings.extensionUsage ?? {},
      profileExtensionOrder: settings.extensionOrder,
    });
  }

  async createSession(
    request: CreateSessionRequest,
    defaults: SessionDefaults,
  ): Promise<SurfaceOpenResponse> {
    const profileAuthority = await this.refreshAgentProfileAuthority();
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
    const configuredProfile = this.resolveOrchestratorAgentProfile(agentProfileId);
    const extensionState = this.resolveConfiguredProfileExtensionState(
      "orchestrator",
      configuredProfile,
      profileAuthority,
    );
    const externalContextSources = await this.buildCurrentExternalContextSources();
    const session = await this.createManagedSurfaceRecord({
      sessionManager,
      actorKind: "orchestrator",
      provider: configuredProfile.provider,
      model: configuredProfile.model,
      thinkingLevel: configuredProfile.reasoningEffort,
      systemPrompt: "",
      agentProfileId,
      loadedExtensionIds: extensionState.loadedExtensionIds,
      availableExtensionIds: extensionState.availableExtensionIds,
      externalContextSources,
    });
    const target = this.buildOrchestratorPromptTarget(session.sessionId);
    session.retainCount += 1;
    const created = this.initializeStructuredPiSession(session, {
      title: request.title?.trim() || "New orchestrator",
      parentSessionId: request.parentSessionId ?? null,
    });
    this.persistManagedSessionSnapshot(session);
    await this.publishCommittedCatalogMutation("session.create", created, {
      workspaceSessionId: target.workspaceSessionId,
      surfacePiSessionId: target.surfacePiSessionId,
    });
    return { target: structuredClone(target) };
  }

  async openSession(sessionId: string): Promise<SurfaceOpenResponse> {
    return this.openSurface(this.buildOrchestratorPromptTarget(sessionId));
  }

  async openSurface(target: PromptTarget): Promise<SurfaceOpenResponse> {
    this.assertValidPromptTarget(target);
    await this.retainManagedSurface(target);
    return { target: structuredClone(target) };
  }

  async closeSurface(target: PromptTarget): Promise<WorkspaceMutationResponse> {
    await this.releaseManagedSurface(target.surfacePiSessionId);
    return { ok: true };
  }

  async resolvePromptDefaultsForTarget(target: PromptTarget): Promise<AgentDefaults> {
    await this.refreshAgentProfileAuthority();
    this.assertValidPromptTarget(target);
    return this.resolveStateBackedPromptDefaults(target);
  }

  async setExtensionContextAutoUpdate(input: {
    target: PromptTarget;
    enabled: boolean;
  }): Promise<SurfaceMutationResponse> {
    this.assertValidPromptTarget(input.target);
    if (input.target.surface === "handler") {
      if (!input.target.threadId) {
        throw new Error("Thread id is required for handler extension context settings.");
      }
      await this.publishCommittedCatalogMutation(
        "surface.extension-context-auto-update",
        this.catalogStateMutations.setThreadExtensionContextAutoUpdate({
          threadId: input.target.threadId,
          enabled: input.enabled,
        }),
        {
          workspaceSessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
          threadId: input.target.threadId,
        },
      );
    } else {
      await this.publishCommittedCatalogMutation(
        "surface.extension-context-auto-update",
        this.catalogStateMutations.setSessionExtensionContextAutoUpdate({
          sessionId: input.target.workspaceSessionId,
          enabled: input.enabled,
        }),
        {
          workspaceSessionId: input.target.workspaceSessionId,
          surfacePiSessionId: input.target.surfacePiSessionId,
        },
      );
    }
    return { ok: true, target: structuredClone(input.target) };
  }

  async steerQueuedSurfaceMessage(input: {
    target: PromptTarget;
    queuedMessageId: string;
  }): Promise<SurfaceMutationResponse> {
    this.assertValidPromptTarget(input.target);
    this.assertQueuedMessageBelongsToSurface(input.queuedMessageId, input.target);
    await this.markRuntimeSurfaceMessageQueuedAsync({
      id: input.queuedMessageId,
      position: "front",
    });
    return { ok: true, target: structuredClone(input.target) };
  }

  private async retainManagedSurface(target: PromptTarget): Promise<ManagedSession> {
    await this.refreshAgentProfileAuthority();
    const externalContextSources = await this.buildCurrentExternalContextSources();
    const session = await this.loadManagedSurface(
      target.surfacePiSessionId,
      getActorKindForTarget(target),
      "",
      externalContextSources,
    );
    session.retainCount += 1;
    return session;
  }

  private async loadManagedSurface(
    surfacePiSessionId: string,
    actorKind: SvvyActorKind,
    systemPrompt: string,
    externalContextSources: readonly GeneratedAgentContextExternalSource[] = [],
  ): Promise<ManagedSession> {
    const existing = this.managedSurfaces.get(surfacePiSessionId);
    if (existing) {
      if (existing.actorKind === actorKind) {
        return existing;
      }
      return this.recreateManagedSurface(existing, {
        actorKind,
        systemPrompt,
        externalContextSources: [...externalContextSources],
      });
    }

    const sessionFile = await this.getSessionFileForId(surfacePiSessionId);
    const target = this.resolvePromptTargetForSurfacePiSessionId(surfacePiSessionId);
    const promptDefaults = this.resolveStateBackedPromptDefaults(target);
    const snapshot = this.getStructuredSnapshot(target.workspaceSessionId);
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
      provider: promptDefaults.provider,
      model: promptDefaults.model,
      thinkingLevel: promptDefaults.reasoningEffort,
      systemPrompt: storedGeneratedAgentContextBinding?.systemPrompt ?? systemPrompt,
      agentProfileId:
        actorKind === "handler"
          ? DEFAULT_THREAD_HANDLER_PROFILE_ID
          : (snapshot?.pi.orchestratorAgentProfileId ?? DEFAULT_ORCHESTRATOR_PROFILE_ID),
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

  private async releaseManagedSurface(surfacePiSessionId: string): Promise<void> {
    const session = this.managedSurfaces.get(surfacePiSessionId);
    if (!session) {
      return;
    }

    session.retainCount = Math.max(0, session.retainCount - 1);
    await this.disposeManagedSurfaceIfUnused(session);
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
      generatedAgentContextRevision,
      agentProfileId,
      loadedExtensionIds,
      availableExtensionIds,
      externalContextSources,
      externalSourceHashes: boundExternalSourceHashes,
      agentDir: this.agentDir,
      agentSettingsStore: this.agentSettingsStore,
      agentProfileSnapshot: this.requireAgentProfileAuthoritySnapshot(),
      applyAgentProfileMutations: this.applyAgentProfileMutations.bind(this),
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
      onWorkflowsGeneratedPackageChanged: this.emitWorkflowsGeneratedPackageLog.bind(this),
      onAppLog: this.emitAppLog.bind(this),
      runTaskAgentBridge: this.runTaskAgentBridgeEnv.bind(this),
      runtimeCommandStdin: this.runtimeCommandStdin,
      managedSandbox: this.managedSandbox,
      acquireExecuteTypescriptLaunch: this.recoveryOptions.acquireExecuteTypescriptLaunch,
      acquireDirectToolLaunch: this.recoveryOptions.acquireDirectToolLaunch,
      runAcceptedLoadExtension: this.recoveryOptions.runAcceptedLoadExtension,
      applyExtensionManagementRuntimeRequest:
        this.recoveryOptions.applyExtensionManagementRuntimeRequest,
      applyWorkflowsRuntimeRequest: this.recoveryOptions.applyWorkflowsRuntimeRequest,
      approvalBoundary: this.approvalBoundary,
      extensionsRoot: this.extensionsRoot,
      extensionsRuntimePlans: () => this.readSvvyxRuntimeExtensionPlans(),
      resolveVisibleExtensionRecords: this.resolveVisibleExtensionRecords.bind(this),
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
      generatedAgentContextRevision: options.generatedAgentContextRevision ?? 1,
      agentDir: this.agentDir,
      agentSettingsStore: this.agentSettingsStore,
      agentProfileSnapshot: this.requireAgentProfileAuthoritySnapshot(),
      applyAgentProfileMutations: this.applyAgentProfileMutations.bind(this),
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
      applyExtensionManagementRuntimeRequest:
        this.recoveryOptions.applyExtensionManagementRuntimeRequest,
      applyWorkflowsRuntimeRequest: this.recoveryOptions.applyWorkflowsRuntimeRequest,
      createHandlerThread: this.createHandlerThread.bind(this),
      queueThreadFollowup: this.queueThreadFollowup.bind(this),
      queueThreadReportRequest: this.queueThreadReportRequest.bind(this),
      queueThreadReportNotification: this.queueThreadReportNotification.bind(this),
      refreshGeneratedContext: this.refreshGeneratedContextForLoadExtension.bind(this),
      onRequestContextLoaded: this.markPromptRefreshRequired.bind(this),
      onWorkflowsGeneratedPackageChanged: this.emitWorkflowsGeneratedPackageLog.bind(this),
      onAppLog: this.emitAppLog.bind(this),
      runTaskAgentBridge: this.runTaskAgentBridgeEnv.bind(this),
      runtimeCommandStdin: this.runtimeCommandStdin,
      approvalBoundary: this.approvalBoundary,
      extensionsRoot: this.extensionsRoot,
      extensionsRuntimePlans: () => this.readSvvyxRuntimeExtensionPlans(),
      resolveVisibleExtensionRecords: this.resolveVisibleExtensionRecords.bind(this),
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

  private async disposeManagedSurfaceIfUnused(session: ManagedSession): Promise<void> {
    if (session.retainCount > 0 || session.activePrompt) {
      return;
    }
    session.session.dispose();
    this.managedSurfaces.delete(session.sessionId);
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

  private markOpenSurfacesForPromptRefresh(): void {
    for (const session of this.managedSurfaces.values()) {
      session.recreateOnNextPrompt = true;
    }
  }

  private async recoverInterruptedSurfaceTurn(surfacePiSessionId: string): Promise<void> {
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

    await this.publishCommittedCatalogMutation(
      "surface.turn-recovery.interrupted",
      this.runRuntimeState(
        this.runtimeTurnStatePort.recoverInterruptedTurn({
          turnId: turn.id as TurnId,
          terminalStatus: "failed",
          reason:
            "Prompt acceptance could not be proven after workspace restart; recovery did not silently resend it.",
        }),
      ),
      {
        workspaceSessionId: snapshot.session.id,
        surfacePiSessionId,
        threadId: turn.threadId ?? undefined,
        turnId: turn.id,
      },
    );
  }

  private buildOrchestratorPromptTarget(workspaceSessionId: string): PromptTarget {
    return {
      workspaceSessionId,
      surface: "orchestrator",
      surfacePiSessionId: workspaceSessionId,
    };
  }

  private resolveOrchestratorAgentProfile(profileId: AgentProfileId): AgentProfileSettings {
    return configuredAgentProfileSettings(
      requireConfiguredAgentProfile(
        this.requireAgentProfileAuthoritySnapshot(),
        "orchestrator",
        profileId,
      ),
    );
  }

  private resolveStateBackedPromptDefaults(target: PromptTarget): AgentDefaults {
    if (target.surface === "handler") {
      const threadSettings = this.resolveThreadProfileSettings(target.surfacePiSessionId);
      if (threadSettings) {
        return threadSettings;
      }
      const handlerProfile = configuredAgentProfileSettings(
        requireConfiguredAgentProfile(
          this.requireAgentProfileAuthoritySnapshot(),
          "handler",
          DEFAULT_THREAD_HANDLER_PROFILE_ID,
        ),
      );
      return {
        provider: handlerProfile.provider,
        model: handlerProfile.model,
        reasoningEffort: handlerProfile.reasoningEffort,
      };
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

    const profileId = snapshot?.pi.orchestratorAgentProfileId ?? DEFAULT_ORCHESTRATOR_PROFILE_ID;
    const profile = this.resolveOrchestratorProfileSettingsFromSnapshot(snapshot, profileId);
    return {
      provider: profile.provider,
      model: profile.model,
      reasoningEffort: profile.reasoningEffort,
    };
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

  private resolveOrchestratorProfileSettingsFromSnapshot(
    snapshot: StructuredSessionSnapshot | null | undefined,
    key: AgentProfileId,
  ): AgentProfileSettings {
    const json = snapshot?.pi.orchestratorAgentProfileJson;
    if (!json) {
      return this.resolveOrchestratorAgentProfile(key);
    }
    try {
      const parsed = JSON.parse(json) as Partial<AgentProfileSettings>;
      if (parsed.provider && parsed.model && parsed.reasoningEffort) {
        const current = this.requireAgentProfileAuthoritySnapshot().configuredProfiles.find(
          (profile) => profile.actor === "orchestrator" && profile.profileId === key,
        );
        return current
          ? {
              ...configuredAgentProfileSettings(current),
              ...parsed,
              extensionUsage:
                parsed.extensionUsage && typeof parsed.extensionUsage === "object"
                  ? parsed.extensionUsage
                  : current.extensionUsage,
            }
          : (parsed as AgentProfileSettings);
      }
    } catch {
      return this.resolveOrchestratorAgentProfile(key);
    }
    return this.resolveOrchestratorAgentProfile(key);
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

  private initializeStructuredPiSession(
    session: ManagedSession,
    input: {
      title: string;
      parentSessionId: string | null;
      messageCount?: number;
    },
  ): StateMutationResult<StructuredPiSessionRecord | null> {
    const configuredProfile = this.requireAgentProfileAuthoritySnapshot().configuredProfiles.find(
      (profile) => profile.actor === "orchestrator" && profile.profileId === session.agentProfileId,
    );
    const profile = configuredProfile
      ? configuredAgentProfileSettings(configuredProfile)
      : this.resolveOrchestratorAgentProfile(session.agentProfileId);
    const timestamp = new Date().toISOString();
    return this.catalogStateMutations.upsertPiSession({
      sessionId: session.sessionId,
      parentSessionId: input.parentSessionId,
      title: input.title,
      provider: session.provider,
      model: session.model,
      reasoningEffort: session.thinkingLevel,
      orchestratorAgentProfileId: session.agentProfileId as CoreAgentProfileId,
      orchestratorAgentProfileJson: JSON.stringify(profile),
      generatedAgentContextFingerprint: session.generatedAgentContextFingerprint,
      loadedExtensionIds: session.loadedExtensionIds,
      availableExtensionIds: session.availableExtensionIds,
      titleNamerAgentJson: JSON.stringify(this.agentSettingsStore.getState().agents.titleNamer),
      messageCount: input.messageCount ?? 0,
      status: "idle",
      createdAt: timestamp,
      updatedAt: timestamp,
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
    loadedByCommandId: string;
    autoStart?: boolean;
  }) {
    const profileAuthority = await this.refreshAgentProfileAuthority();
    const initialTitle = input.objective.trim();
    const parentSessionFile = await this.getSessionFileForId(input.parentSurfacePiSessionId);
    const threadSessionManager = SessionManager.create(this.cwd, this.threadSurfaceDir);
    threadSessionManager.newSession();
    threadSessionManager.appendSessionInfo(initialTitle);
    persistSessionManagerSnapshot(threadSessionManager);
    const threadAgentSettings = configuredAgentProfileSettings(
      requireConfiguredAgentProfile(profileAuthority, "handler"),
    );

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
      await this.publishCommittedCatalogMutation(
        "session.title-generation.running",
        this.catalogStateMutations.markTitleGenerationRunning(sessionId),
        { workspaceSessionId: sessionId, surfacePiSessionId: sessionId },
      );
      this.emitTitleGenerationLog({ level: "info", status: "started", sessionId });

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
      const completed = await this.publishCommittedCatalogMutation(
        "session.title-generation.completed",
        this.catalogStateMutations.completeTitleGeneration({ sessionId, title }),
        { workspaceSessionId: sessionId, surfacePiSessionId: sessionId },
      );
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
      await this.publishCommittedCatalogMutation(
        "session.title-generation.failed",
        this.catalogStateMutations.failTitleGeneration({
          sessionId,
          error: message,
        }),
        { workspaceSessionId: sessionId, surfacePiSessionId: sessionId },
      );
      this.emitTitleGenerationLog({
        level: "warning",
        status: "failed",
        sessionId,
        error: message,
      });
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
    const updated = await this.publishCommittedCatalogMutation(
      "thread.title-generation.completed",
      this.catalogStateMutations.completeThreadTitle({ threadId, title }),
      {
        workspaceSessionId: detail.thread.sessionId,
        surfacePiSessionId: detail.thread.surfacePiSessionId,
        threadId,
      },
    );
    const activeThreadSurface = this.managedSurfaces.get(updated.surfacePiSessionId);
    if (activeThreadSurface) {
      this.syncPiSessionTitle(activeThreadSurface, updated.title);
    } else {
      const sessionFile = await this.getSessionFileForId(updated.surfacePiSessionId, false);
      if (sessionFile) {
        SessionManager.open(sessionFile, this.threadSurfaceDir).appendSessionInfo(updated.title);
      }
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

  private async publishCommittedCatalogMutation<T>(
    operation: string,
    committed: StateMutationResult<T>,
    details?: Record<string, unknown>,
  ): Promise<T> {
    const seen = new Set<string>();
    const afterCommit = committed.afterCommit.filter((descriptor) => {
      const key = JSON.stringify(descriptor);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (afterCommit.length > 0) {
      this.pendingCommittedStateInvalidations.push({
        operation,
        afterCommit,
        ...(details ? { details } : {}),
      });
      await this.flushCommittedStateInvalidations();
    }
    return committed.value;
  }

  private flushCommittedStateInvalidations(): Promise<void> {
    if (this.committedStateInvalidationFlush) {
      return this.committedStateInvalidationFlush;
    }
    const running = this.flushCommittedStateInvalidationsLoop();
    this.committedStateInvalidationFlush = running;
    return running.finally(() => {
      if (this.committedStateInvalidationFlush === running) {
        this.committedStateInvalidationFlush = null;
      }
    });
  }

  private async flushCommittedStateInvalidationsLoop(): Promise<void> {
    while (
      this.committedStateInvalidationPublisher &&
      this.pendingCommittedStateInvalidations.length > 0
    ) {
      const pending = this.pendingCommittedStateInvalidations[0]!;
      const publisher = this.committedStateInvalidationPublisher;
      try {
        await publisher(pending.afterCommit);
        this.pendingCommittedStateInvalidations.shift();
      } catch (error) {
        this.emitAppLog({
          level: "error",
          source: "app.bridge",
          message:
            "State mutation committed, but read-model invalidation publication failed; retained descriptors require runtime retry or consumer rebaseline.",
          error,
          details: {
            operation: pending.operation,
            committed: true,
            rebaselineRequired: true,
            afterCommit: pending.afterCommit,
            ...pending.details,
          },
        });
        return;
      }
    }
  }

  private async refreshWorkspaceGeneratedPackageLinks(
    input: InternalRefreshGeneratedPackagesRequest,
  ): Promise<void> {
    const refreshGeneratedPackages = this.recoveryOptions.refreshGeneratedPackages;
    if (!refreshGeneratedPackages) {
      throw new Error(
        "Workspace generated-package recovery requires the runtime-owned refresh seam.",
      );
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

  private persistManagedSessionSnapshot(session: ManagedSession): void {
    persistSessionManagerSnapshot(session.session.sessionManager);
  }
}

async function createManagedSession(
  options: CreateManagedSessionOptions & {
    agentDir: string;
    agentSettingsStore: ReturnType<typeof createAgentSettingsStore>;
    agentProfileSnapshot: AgentProfileAuthoritySnapshot;
    applyAgentProfileMutations: (mutations: readonly AgentProfileMutation[]) => Promise<void>;
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
    agentProfileSnapshot: options.agentProfileSnapshot,
    applyAgentProfileMutations: options.applyAgentProfileMutations,
    requestWorkflowsRuntime: options.applyWorkflowsRuntimeRequest,
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
    resolveVisibleRecords:
      options.resolveVisibleExtensionRecords ?? missingVisibleExtensionRecordResolver,
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
    resolveVisibleRecords:
      options.resolveVisibleExtensionRecords ?? missingVisibleExtensionRecordResolver,
  });
  const directTools = createSvvyDirectTools({
    cwd: options.sessionManager.getCwd(),
    workspaceId: options.workspaceId,
    runtime: promptExecutionRuntime,
    artifactState: options.artifactState,
    commandState: options.commandState,
    applyExtensionManagementRuntimeRequest: options.applyExtensionManagementRuntimeRequest,
    applyWorkflowsRuntimeRequest: options.applyWorkflowsRuntimeRequest,
    readArtifactRootForSession: options.readArtifactRootForSession,
    runState: options.runState,
    agentSettingsStore: options.agentSettingsStore,
    agentProfileSnapshot: options.agentProfileSnapshot,
    applyAgentProfileMutations: options.applyAgentProfileMutations,
    approvalMode: () => options.agentSettingsStore.getState().appPreferences.approvalMode,
    approvalBoundary: options.approvalBoundary,
    networkAccess: () => options.agentSettingsStore.getState().appPreferences.networkAccess,
    managedSandbox: options.managedSandbox,
    onWorkflowsGeneratedPackageChanged: options.onWorkflowsGeneratedPackageChanged,
    onAppLog: options.onAppLog,
    runTaskAgentBridge: options.runTaskAgentBridge,
    runtimeCommandStdin: options.runtimeCommandStdin,
    acquireDirectToolLaunch: options.acquireDirectToolLaunch,
    extensionsRoot: options.extensionsRoot,
    extensionsRuntimePlans: options.extensionsRuntimePlans,
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
  const sharedInteractiveTools = sharedWorkTools;
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
  const generatedAgentContextFingerprint = options.generatedAgentContextFingerprint ?? "";
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

function requireConfiguredAgentProfile(
  snapshot: CatalogAgentProfileAuthoritySnapshot,
  actor: "orchestrator" | "handler",
  profileId?: string,
): ConfiguredAgentProfileReadModelRecord {
  const profiles = snapshot.configuredProfiles.filter((profile) => profile.actor === actor);
  const profile = profileId
    ? profiles.find((candidate) => candidate.profileId === profileId)
    : actor === "orchestrator"
      ? (profiles.find((candidate) => candidate.profileId === DEFAULT_ORCHESTRATOR_PROFILE_ID) ??
        profiles[0])
      : (profiles.find((candidate) => candidate.profileId === DEFAULT_THREAD_HANDLER_PROFILE_ID) ??
        profiles[0]);
  if (profile) return profile;
  if (profileId) {
    throw new Error(`Unknown ${actor} agent profile: ${profileId}`);
  }
  throw new Error(`No ${actor} agent profile is configured.`);
}

function configuredAgentProfileSettings(
  profile: ConfiguredAgentProfileReadModelRecord,
): AgentProfileSettings {
  const reasoning = profile.reasoning as { readonly effort?: unknown } | null;
  const effort =
    reasoning && isAgentReasoningEffort(reasoning.effort)
      ? reasoning.effort
      : DEFAULT_AGENT_SETTINGS.reasoningEffort;
  return {
    id: profile.profileId,
    kind: profile.actor === "handler" ? "special" : "orchestrator",
    name: profile.name,
    provider: profile.providerId,
    model: profile.modelId,
    reasoningEffort: effort,
    systemPrompt: "",
    extensionUsage: { ...profile.extensionUsage },
    extensionOrder: [...profile.extensionOrder],
    updateFromComposer: profile.followComposer,
    builtin: profile.builtin,
    locked: profile.locked,
  };
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
