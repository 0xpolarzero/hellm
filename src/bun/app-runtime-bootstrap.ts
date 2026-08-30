import { getModel, getSupportedThinkingLevels } from "@mariozechner/pi-ai";
import { createHash } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Redacted from "effect/Redacted";
import {
  AppLogWritePort,
  ExtensionError as CoreExtensionError,
  ExtensionStatePort,
  ExtensionSnapshotPayloadStorePort,
  ExtensionSnapshotSecretStorePort,
  ExtensionSnapshotSecretValuesPort,
  ExtensionSnapshotSettingsStatePort,
  ExtensionSnapshotStatePort,
  ExtensionUsageStatePort,
  PiAdapterError,
  PiRuntimePathsPort,
  ProviderAuthPort,
  ProviderAuthStatusStatePort,
  ProviderAuthPortError,
  RuntimeContractError,
  RuntimeGeneratedPackageStatePort,
  RuntimeExtensionStatePort,
  RuntimeExtensionContextImpactStatePort,
  RuntimeExternalInstructionStatePort,
  RuntimePromptDefaultsStatePort,
  RuntimeRecoveryStatePort,
  SecretStorePort,
  SecretStorePortError,
  StateContractError,
  SandboxPolicySource,
  type AbsolutePath,
  type AppLogEntryId,
  type AuthenticatedRunTaskAgentInput,
  type AppLogWritePortService,
  type BuildLaunchPolicyInput,
  type ExtensionStatePortService,
  type GeneratedPackageWorkspaceLinkRepairInput,
  type GeneratedPackagesRefreshResult,
  type InternalRefreshGeneratedPackagesRequest,
  type JsonValue,
  type ReasoningEffort,
  type ListModelsInput,
  type ModelInfo,
  type ProviderId,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimeExternalInstructionStatePortService,
  type RuntimeClientRequestId,
  type ListRuntimeExtensionUsageContextAffectedSurfacesInput,
  type ApplyRuntimeExtensionSnapshotContextImpactInput,
  type RuntimeClientSubmissionSource,
  type RefreshGeneratedContextRequest,
  type RunTaskAgentResult,
  type SandboxLaunchFacts,
  type SandboxPolicySourceService,
  type SecretStoreMutationPortService,
  type SecretStorePortService,
  type ExtensionSnapshotSecretValuesPortService,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type StateInvalidationDescriptor,
  type WorkspaceId,
  type PiRuntimePathsSnapshot,
  type PromptTarget,
} from "@svvy/core";
import { PiAdapter, layer as PiAdapterLayer } from "@svvy/pi-adapter";
import type {
  ExtensionBuildProcessPortService,
  ExtensionCliRequirementProbePortService,
  ExtensionSourceRoots,
  GeneratedPackageRoots,
} from "@svvy/extensions";
import {
  layer as extensionsLayer,
  layerExtensionBuildProcessPort,
  layerExtensionCliRequirementProbePort,
  layerExtensionSourceRootsPort,
  layerGeneratedPackageRootPort,
  layerPackagedExtensionTemplatesPort,
  layerWorkspaceSourceLinkPort,
} from "@svvy/extensions";
import { HostProcessReferencePort, SandboxHelperCandidatesPort } from "@svvy/sandbox";
import { createRuntimeFacade, Runtime } from "@svvy/runtime";
import {
  acquireAcceptedDirectToolLaunch,
  requestAcceptedDirectToolApproval,
  runAcceptedLoadExtension,
} from "@svvy/runtime/accepted-native-tool-execution";
import { notifyCommittedAppLogAppend } from "@svvy/runtime/app-log-commit-notification-adapter";
import { publishCommittedStateInvalidations } from "@svvy/runtime/committed-state-invalidation-adapter";
import {
  awaitRuntimeStartupReadiness,
  createRuntimeLayerConfigLayer,
  layerRuntimeBunPlatform,
  prepareRuntimeShutdown,
  RuntimeGeneratedContextRefreshHostPort,
  RuntimeGeneratedPackageRefreshHostPort,
  RuntimeExternalInstructionScanInputPort,
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandStdinPort,
  RuntimeLayerModelResolverPort,
  RuntimeLayerProviderAuthPort,
  RuntimePrimitiveToolHostPort,
  RuntimeSourceInvalidationScanPort,
  RuntimeWorkflowTaskAgentBridgeBearerVerifier,
  type RuntimeGeneratedPackageRefreshHostPortService,
  type RuntimeExternalInstructionScanInputPortService,
  type RuntimeLayerCommandControlPortService,
  type RuntimeLayerCommandStdinPortService,
  type RuntimeLayerConfig,
  type RuntimePrimitiveToolHostPortService,
  type RuntimePrepareShutdownReason,
  type RuntimeSourceInvalidationEvent,
  type RuntimeSourceInvalidationScanPortService,
  type RuntimeStartupReadinessReceipt,
} from "@svvy/runtime/bootstrap";
import {
  createWorkspaceStateRouter,
  layerWorkspaceStateRouter,
  providerAuthStatusStatePortFromStore,
  runtimeRecoveryStatePortFromStore,
  runtimeExtensionStatePortFromStore,
  extensionSnapshotSettingsStatePortFromStore,
  extensionSnapshotStatePortFromStore,
  extensionUsageStatePortFromStore,
  runtimeExtensionContextImpactStatePortFromStore,
  runtimeExternalInstructionStatePortFromStructuredSessionState,
  stateCommandsFromRouter,
  stateReadModelsFromRouter,
  type WorkspaceStateRegistration,
} from "@svvy/state/structured-session-adapters";
import {
  createStateCommandsFacade,
  createStateFacade,
  StateCommands,
  StateReadModels,
  type StateAppLogsFacade,
} from "@svvy/state";
import type { AppPreferences } from "../shared/agent-settings";
import type { RuntimeApprovalBoundary } from "./approval-boundary";
import type { RunAcceptedLoadExtension } from "./extension-tools";
import {
  createExtensionSnapshotPayloadStore,
  createExtensionSnapshotSecretStore,
} from "./extension-snapshot-storage";
import { AppLifecycleCoordinator } from "./app-lifecycle-coordinator";
import type { PackagedSandboxHostSupportServices } from "./runtime-service-adapter";
import {
  narrowRendererStateCommandsFacade,
  narrowRendererStateFacade,
  type RendererStateCommandsFacade,
  type RendererStateFacade,
} from "./renderer-state-facade";

type RuntimeFacade = ReturnType<typeof createRuntimeFacade>;
type StateFacade = ReturnType<typeof createStateFacade>;
type StateCommandsFacade = ReturnType<typeof createStateCommandsFacade>;

function usableProviderAuthSnapshot(input: {
  readonly providerId: ProviderId;
  readonly workspaceId?: WorkspaceId;
  readonly accessToken: string;
}) {
  return {
    providerId: input.providerId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    health: "usable" as const,
    accessToken: Redacted.make(input.accessToken),
    credentialFingerprint: `runtime:${input.providerId}`,
  };
}

export type AppRuntimeBootstrapWorkspaceStateInput =
  | WorkspaceStateRegistration
  | { workspaceStateRouterRegistration(): WorkspaceStateRegistration };

export interface AppRuntimeBootstrapSourceInvalidationCoordinator {
  classifyHint(input: SourceInvalidationHint): Promise<"scan" | "scan-parent-domain" | "ignore">;
  reconcile(input: {
    readonly domains?: SourceReconcileRequest["domains"];
    readonly reason: string;
  }): Promise<RuntimeSourceInvalidationEvent | null>;
  requestScan(input: {
    readonly domains?: SourceReconcileRequest["domains"];
    readonly reason: string;
  }): Promise<void>;
}

export interface AppRuntimeBootstrapInput {
  readonly appGlobalState: AppRuntimeBootstrapWorkspaceStateInput;
  readonly workspaceStates: readonly AppRuntimeBootstrapWorkspaceStateInput[];
  readonly sourceRoots: ExtensionSourceRoots;
  readonly packagedExtensionTemplatesRoot: AbsolutePath;
  readonly generatedPackageRoots: GeneratedPackageRoots;
  readonly extensionStatePort: ExtensionStatePortService;
  readonly extensionBuildProcess: ExtensionBuildProcessPortService;
  readonly extensionCliRequirementProbe: ExtensionCliRequirementProbePortService;
  readonly secretStore: SecretStorePortService;
  readonly secretStoreMutation: SecretStoreMutationPortService;
  readonly snapshotStorageRoot: AbsolutePath;
  readonly generatedPackageLinkPath: (
    input: GeneratedPackageWorkspaceLinkRepairInput,
  ) => Promise<AbsolutePath>;
  readonly sandboxPolicySource: SandboxPolicySourceService;
  readonly appLogs: Pick<
    StateAppLogsFacade,
    | "append"
    | "query"
    | "summary"
    | "markSeen"
    | "markSeenWithResult"
    | "markSeenForEntryIdsWithResult"
    | "setViewPreferences"
    | "subscribe"
    | "writePort"
  >;
  readonly resolveWorkspaceAppLogs?: (
    workspaceId: WorkspaceId,
  ) => Promise<
    Pick<
      StateAppLogsFacade,
      | "append"
      | "query"
      | "summary"
      | "markSeen"
      | "markSeenWithResult"
      | "markSeenForEntryIdsWithResult"
      | "setViewPreferences"
      | "subscribe"
      | "writePort"
    >
  >;
  readonly onAppLogCommitNotificationError?: (
    error: unknown,
    scope: { readonly workspaceId?: WorkspaceId },
  ) => void;
  readonly appLogWritePort: AppLogWritePortService;
  readonly sandboxHostSupport: PackagedSandboxHostSupportServices;
  readonly runtimeLayerConfig: RuntimeLayerConfig;
  readonly commandRegistry: RuntimeLayerCommandStdinPortService &
    Pick<RuntimeLayerCommandControlPortService, "cancel">;
  readonly executeTypescriptHost: Pick<
    RuntimeLayerCommandControlPortService,
    "runExecuteTypescript"
  >;
  readonly primitiveToolHost: RuntimePrimitiveToolHostPortService;
  readonly providerAuth: {
    ensureUsableProviderAuth(provider: string): Promise<string | undefined>;
    getProviderAuthUnavailableMessage(provider: string): string;
  };
  readonly piRuntimePaths: {
    resolve(workspaceId: WorkspaceId): Promise<PiRuntimePathsSnapshot>;
  };
  readonly generatedContextRefresh: {
    refresh(input: RefreshGeneratedContextRequest): Promise<void>;
  };
  readonly generatedPackageRefresh: RuntimeGeneratedPackageRefreshHostPortService;
  readonly externalInstructionScanInput: RuntimeExternalInstructionScanInputPortService;
  readonly generatedPackageStatePort?: Pick<
    RuntimeGeneratedPackageStatePortService,
    "markWorkspaceLinksRepairNeeded" | "recordWorkspaceLinkStatus"
  >;
  readonly sourceInvalidation: {
    readonly appGlobalCoordinator: AppRuntimeBootstrapSourceInvalidationCoordinator;
    listAcquiredWorkspaceIds(): Promise<readonly WorkspaceId[]> | readonly WorkspaceId[];
    resolveWorkspaceCoordinator(
      workspaceId: WorkspaceId,
    ): Promise<AppRuntimeBootstrapSourceInvalidationCoordinator>;
  };
  readonly workflowTaskAgentBridge?: {
    verifyBearerLineage(input: {
      readonly bearerToken: string;
      readonly workspaceSessionId: string;
      readonly sourceCommandId: string;
    }): Promise<boolean> | boolean;
  };
  readonly appPreferencesSeed?: {
    hasStateRows(): boolean;
    read(): AppPreferences;
  };
}

export interface AppRuntimeBootstrap {
  readonly facade: RuntimeFacade;
  readonly state: StateFacade;
  readonly stateCommands: StateCommandsFacade;
  readonly rendererState: RendererStateFacade;
  readonly rendererStateCommands: RendererStateCommandsFacade;
  readonly modelMetadata: {
    list(input: ListModelsInput): Promise<readonly ModelInfo[]>;
  };
  readonly readiness: RuntimeStartupReadinessReceipt;
  readonly internal: {
    readonly launchFacts: {
      acquireDirectToolLaunch(
        input: Omit<BuildLaunchPolicyInput, "launchKind"> & {
          readonly toolName: "exec_command" | "apply_patch" | "execute_typescript";
        },
      ): Promise<{
        readonly facts: SandboxLaunchFacts;
        close(): Promise<void>;
      }>;
      acquireExecuteTypescript(input: Omit<BuildLaunchPolicyInput, "launchKind">): Promise<{
        readonly facts: SandboxLaunchFacts;
        close(): Promise<void>;
      }>;
    };
    readonly sourceInvalidation: {
      refreshGeneratedPackages(
        input: InternalRefreshGeneratedPackagesRequest,
      ): Promise<GeneratedPackagesRefreshResult>;
    };
    readonly workspaceRecovery: {
      wakeSurfaceQueue(target: PromptTarget): Promise<void>;
    };
    readonly acceptedNativeTools: {
      readonly requestDirectToolApproval: RuntimeApprovalBoundary;
      readonly runLoadExtension: RunAcceptedLoadExtension;
    };
    readonly workflowTaskAgentBridge: {
      runTaskAgent(input: AuthenticatedRunTaskAgentInput): Promise<RunTaskAgentResult>;
    };
    readonly committedStateInvalidations: {
      publish(afterCommit: readonly StateInvalidationDescriptor[]): Promise<void>;
    };
    readonly workspaceStates: {
      register(
        input: AppRuntimeBootstrapWorkspaceStateInput,
        appLogs?: Pick<StateAppLogsFacade, "subscribe">,
      ): Promise<void>;
      unregister(workspaceId: WorkspaceId): boolean;
    };
  };
  dispose(reason?: "app-shutdown" | "startup-failure"): Promise<void>;
}

function processExtensionEnvSecretCleanup(input: {
  readonly store: WorkspaceStateRegistration["store"];
  readonly secretStoreMutation: SecretStoreMutationPortService;
}): Effect.Effect<void> {
  return Effect.forEach(
    input.store.listExtensionEnvSecretCleanupRecords(),
    (cleanup) =>
      input.secretStoreMutation
        .removeSecretValue({
          ref: cleanup.ref,
          expectedRevisionFingerprint: cleanup.revisionFingerprint,
        })
        .pipe(
          Effect.as(true),
          Effect.catchTag("SecretStorePortError", (error) =>
            Effect.succeed(error.reason === "secret-not-found"),
          ),
          Effect.flatMap((removed) =>
            removed
              ? Effect.sync(() => input.store.completeExtensionEnvSecretCleanup(cleanup.ref)).pipe(
                  Effect.catch(() => Effect.void),
                )
              : Effect.void,
          ),
        ),
    { concurrency: 1, discard: true },
  );
}

export function createSnapshotSecretValuesPort(input: {
  readonly store: WorkspaceStateRegistration["store"];
  readonly secretStore: SecretStorePortService;
  readonly secretStoreMutation: SecretStoreMutationPortService;
}): ExtensionSnapshotSecretValuesPortService {
  const error = (operation: string, cause?: unknown) =>
    new SecretStorePortError({
      operation: `app-runtime-bootstrap.snapshot-secrets.${operation}`,
      reason: "secret-unavailable",
      message: "Extension snapshot secret values could not be processed.",
      cause,
    });
  return {
    capture: (targets) =>
      Effect.gen(function* () {
        const configured = new Map(
          input.store
            .listExtensionEnvSecrets()
            .map((record) => [`${record.extensionId}\0${record.envName}`, record]),
        );
        const values: Array<{ extensionId: string; envName: string; value: string }> = [];
        for (const target of targets.filter((entry) => entry.present)) {
          const record = configured.get(`${target.extensionId}\0${target.envName}`);
          if (!record) return yield* Effect.fail(error("capture.missing-state"));
          const resolved = yield* input.secretStore.resolveInvocationValue(record.ref);
          values.push({
            extensionId: String(target.extensionId),
            envName: target.envName,
            value: Redacted.value(resolved.value),
          });
        }
        if (values.length === 0) return { bytes: null };
        return {
          bytes: Redacted.make(
            new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, values })),
            { label: "extension-snapshot-secret-values" },
          ),
        };
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof SecretStorePortError ? cause : error("capture", cause),
        ),
      ),
    restore: ({ targets, bytes, clientRequestId }) =>
      Effect.gen(function* () {
        let decoded: {
          schemaVersion: 1;
          values: Array<{ extensionId: string; envName: string; value: string }>;
        } = {
          schemaVersion: 1,
          values: [],
        };
        if (bytes) {
          try {
            decoded = JSON.parse(new TextDecoder().decode(Redacted.value(bytes))) as typeof decoded;
          } catch (cause) {
            return yield* Effect.fail(error("restore.decode", cause));
          }
          if (decoded.schemaVersion !== 1 || !Array.isArray(decoded.values)) {
            return yield* Effect.fail(error("restore.invalid-envelope"));
          }
        }
        const values = new Map(
          decoded.values.map((entry) => [`${entry.extensionId}\0${entry.envName}`, entry.value]),
        );
        let restoredTargetCount = 0;
        for (const [index, target] of targets.entries()) {
          const requestId = `${clientRequestId}:target:${index}`;
          const commandState = input.store.readExtensionEnvSecretCommandState({
            operation: target.present ? "set" : "remove",
            clientRequestId: requestId,
            extensionId: target.extensionId,
            envName: target.envName,
          });
          if (commandState.receipt) {
            restoredTargetCount += 1;
            continue;
          }
          const current = commandState.current;
          if (target.present) {
            const value = values.get(`${target.extensionId}\0${target.envName}`);
            if (value === undefined) return yield* Effect.fail(error("restore.missing-value"));
            const written = yield* input.secretStoreMutation.writeSecretValue({
              target: {
                kind: "extension-env",
                extensionId: target.extensionId,
                envName: target.envName as never,
              },
              materialId:
                `snapshot_${createHash("sha256").update(requestId).digest("hex").slice(0, 32)}` as never,
              value: Redacted.make(value, { label: "extension-env-secret" }),
              ...(current
                ? {
                    replaces: {
                      ref: current.ref,
                      expectedRevisionFingerprint: current.revisionFingerprint,
                    },
                  }
                : {}),
            });
            try {
              input.store.commitExtensionEnvSecretSet({
                command: {
                  extensionId: target.extensionId,
                  envName: target.envName as never,
                  secretValue: Redacted.make(value, { label: "extension-env-secret" }),
                  clientSubmission: {
                    clientRequestId: requestId as never,
                    source: "runtime" as never,
                  },
                },
                ref: written.ref,
                revisionFingerprint: written.revisionFingerprint,
                previous: current,
              });
              if (current) {
                yield* input.secretStoreMutation
                  .removeSecretValue({
                    ref: current.ref,
                    expectedRevisionFingerprint: current.revisionFingerprint,
                  })
                  .pipe(
                    Effect.tap(() =>
                      Effect.sync(() => input.store.completeExtensionEnvSecretCleanup(current.ref)),
                    ),
                    Effect.catch(() => Effect.void),
                  );
              }
            } catch (cause) {
              yield* input.secretStoreMutation
                .removeSecretValue({
                  ref: written.ref,
                  expectedRevisionFingerprint: written.revisionFingerprint,
                })
                .pipe(Effect.catch(() => Effect.void));
              return yield* Effect.fail(error("restore.commit-set", cause));
            }
          } else if (current) {
            input.store.commitExtensionEnvSecretRemove({
              command: {
                extensionId: target.extensionId,
                envName: target.envName as never,
                expectedRevisionFingerprint: current.revisionFingerprint,
                clientSubmission: {
                  clientRequestId: requestId as never,
                  source: "runtime" as never,
                },
              },
              previous: current,
            });
            yield* input.secretStoreMutation
              .removeSecretValue({
                ref: current.ref,
                expectedRevisionFingerprint: current.revisionFingerprint,
              })
              .pipe(
                Effect.tap(() =>
                  Effect.sync(() => input.store.completeExtensionEnvSecretCleanup(current.ref)),
                ),
                Effect.catch(() => Effect.void),
              );
          }
          restoredTargetCount += 1;
        }
        return { restoredTargetCount };
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof SecretStorePortError ? cause : error("restore", cause),
        ),
      ),
  };
}

export async function createAppRuntimeBootstrap(
  input: AppRuntimeBootstrapInput,
): Promise<AppRuntimeBootstrap> {
  const appGlobalStateRegistration = workspaceStateRegistration(input.appGlobalState);
  const initialWorkspaceStateRegistrations = input.workspaceStates.map(workspaceStateRegistration);
  const registeredWorkspaceStores = new Map(
    initialWorkspaceStateRegistrations.map((registration) => [
      registration.store.workspaceId as WorkspaceId,
      registration.store,
    ]),
  );
  const workspaceRouter = createWorkspaceStateRouter({
    appGlobalStore: appGlobalStateRegistration.store,
    workspaceStores: initialWorkspaceStateRegistrations,
  });
  const lifecycle = new AppLifecycleCoordinator();
  const workspaceStateLayer = layerWorkspaceStateRouter(workspaceRouter);
  const appLogState = appLogStateServiceFromFacade(input.appLogs);
  const resolveAppLogState = (
    workspaceId: WorkspaceId | undefined,
  ): Effect.Effect<typeof appLogState, StateContractError> => {
    if (!workspaceId || !input.resolveWorkspaceAppLogs) {
      return Effect.succeed(appLogState);
    }
    return Effect.tryPromise({
      try: async () =>
        appLogStateServiceFromFacade(
          await input.resolveWorkspaceAppLogs!(workspaceId),
          workspaceId,
        ),
      catch: (cause) =>
        new StateContractError({
          operation: "app-runtime-bootstrap.resolveWorkspaceAppLogs",
          reason: "not-found",
          message: `App runtime bootstrap could not resolve app logs for workspace ${workspaceId}.`,
          cause,
        }),
    });
  };
  const stateFacadeServicesLayer = Layer.mergeAll(
    Layer.succeed(
      StateReadModels,
      stateReadModelsFromRouter({
        router: workspaceRouter,
        appLogs: appLogState,
        resolveAppLogs: resolveAppLogState,
      }),
    ),
    Layer.succeed(
      StateCommands,
      stateCommandsFromRouter({
        router: workspaceRouter,
        appLogs: appLogState,
        resolveAppLogs: resolveAppLogState,
        secretStoreMutation: input.secretStoreMutation,
      }),
    ),
  );
  const generatedPackageStatePort = createGeneratedPackageStatePort({
    routerPort: workspaceRouter.generatedPackage,
    unopenedWorkspaceFallback: input.generatedPackageStatePort,
  });
  const providerAuthStatusState = providerAuthStatusStatePortFromStore(
    appGlobalStateRegistration.store,
  );
  const recoveryState = runtimeRecoveryStatePortFromStore(appGlobalStateRegistration.store);
  const extensionState = runtimeExtensionStatePortFromStore(appGlobalStateRegistration.store);
  const extensionSnapshotState = extensionSnapshotStatePortFromStore(
    appGlobalStateRegistration.store,
  );
  const extensionSnapshotSettings = extensionSnapshotSettingsStatePortFromStore(
    appGlobalStateRegistration.store,
  );
  const extensionUsageState = extensionUsageStatePortFromStore(appGlobalStateRegistration.store);
  const snapshotPayloadStore = createExtensionSnapshotPayloadStore({
    root: input.snapshotStorageRoot,
    isReferenced: (ref) =>
      appGlobalStateRegistration.store
        .listExtensionSnapshots()
        .snapshots.some(
          (summary) =>
            appGlobalStateRegistration.store.readExtensionSnapshot(summary.snapshotId)?.payloadRef
              .digest === ref.digest,
        ) ||
      appGlobalStateRegistration.store
        .listPendingExtensionSnapshotRestoreAttempts()
        .some((attempt) => attempt.payloadRef.digest === ref.digest),
  });
  const snapshotSecretStore = createExtensionSnapshotSecretStore({
    isReferenced: (ref) =>
      appGlobalStateRegistration.store
        .listExtensionSnapshots()
        .snapshots.some(
          (summary) =>
            appGlobalStateRegistration.store.readExtensionSnapshot(summary.snapshotId)
              ?.secretPayloadRef === ref,
        ) ||
      appGlobalStateRegistration.store
        .listPendingExtensionSnapshotRestoreAttempts()
        .some((attempt) => attempt.secretPayloadRef === ref),
  });
  const snapshotSecretValues = createSnapshotSecretValuesPort({
    store: appGlobalStateRegistration.store,
    secretStore: input.secretStore,
    secretStoreMutation: input.secretStoreMutation,
  });
  const snapshotContextImpact = {
    listUsageContextAffectedSurfaces: (
      request: ListRuntimeExtensionUsageContextAffectedSurfacesInput,
    ) =>
      Effect.forEach(
        registeredWorkspaceStores.values(),
        (store) =>
          runtimeExtensionContextImpactStatePortFromStore(store).listUsageContextAffectedSurfaces(
            request,
          ),
        { concurrency: 1 },
      ).pipe(Effect.map((groups) => groups.flat())),
    applySnapshotContextImpact: (request: ApplyRuntimeExtensionSnapshotContextImpactInput) =>
      Effect.forEach(
        registeredWorkspaceStores.values(),
        (store) =>
          runtimeExtensionContextImpactStatePortFromStore(store).applySnapshotContextImpact(
            request,
          ),
        { concurrency: 1 },
      ).pipe(
        Effect.map((results) => ({
          value: results.flatMap((result) => result.value),
          afterCommit: results.flatMap((result) => result.afterCommit),
        })),
      ),
  };
  const externalInstructionState = {
    reconcileExternalInstructions: (request) =>
      workspaceRouter
        .resolveWorkspaceStructuredSession(request.workspaceId)
        .pipe(
          Effect.flatMap((state) =>
            runtimeExternalInstructionStatePortFromStructuredSessionState(
              state,
            ).reconcileExternalInstructions(request),
          ),
        ),
    readExternalInstructions: (request) =>
      workspaceRouter
        .resolveWorkspaceStructuredSession(request.workspaceId)
        .pipe(
          Effect.flatMap((state) =>
            runtimeExternalInstructionStatePortFromStructuredSessionState(
              state,
            ).readExternalInstructions(request),
          ),
        ),
  } satisfies RuntimeExternalInstructionStatePortService;
  const sandboxHostSupport = input.sandboxHostSupport;
  const extensionPackageLayer = Layer.mergeAll(
    layerRuntimeBunPlatform,
    Layer.succeed(ExtensionStatePort, input.extensionStatePort),
    layerExtensionBuildProcessPort(input.extensionBuildProcess),
    layerExtensionCliRequirementProbePort(input.extensionCliRequirementProbe),
    layerExtensionSourceRootsPort(input.sourceRoots),
    layerGeneratedPackageRootPort(input.generatedPackageRoots),
    layerPackagedExtensionTemplatesPort({
      builtinExtensionsRoot: input.packagedExtensionTemplatesRoot,
    }),
    layerWorkspaceSourceLinkPort({
      generatedPackageLinkPath: (linkInput) =>
        Effect.tryPromise({
          try: () => input.generatedPackageLinkPath(linkInput),
          catch: (cause) =>
            new CoreExtensionError({
              operation: "runtime.generated-packages.workspace-link-path",
              reason: "execution-failed",
              message:
                cause instanceof Error
                  ? cause.message
                  : "Generated package workspace link path resolution failed.",
              cause,
            }),
        }),
    }),
  );
  const runtimeHostLayer = Layer.mergeAll(
    extensionsLayer.pipe(Layer.provide(extensionPackageLayer)),
    PiAdapterLayer,
    layerRuntimeBunPlatform,
    Layer.succeed(SandboxPolicySource, input.sandboxPolicySource),
    Layer.succeed(SandboxHelperCandidatesPort, sandboxHostSupport.helperCandidates),
    Layer.succeed(HostProcessReferencePort, sandboxHostSupport.hostProcess),
    layerExtensionSourceRootsPort(input.sourceRoots),
    Layer.succeed(RuntimePromptDefaultsStatePort, workspaceRouter.promptDefaults),
    Layer.succeed(RuntimeRecoveryStatePort, recoveryState),
    Layer.succeed(RuntimeExtensionStatePort, extensionState),
    Layer.succeed(ExtensionSnapshotStatePort, extensionSnapshotState),
    Layer.succeed(ExtensionUsageStatePort, extensionUsageState),
    Layer.succeed(ExtensionSnapshotSettingsStatePort, extensionSnapshotSettings),
    Layer.succeed(ExtensionSnapshotPayloadStorePort, snapshotPayloadStore),
    Layer.succeed(ExtensionSnapshotSecretStorePort, snapshotSecretStore),
    Layer.succeed(ExtensionSnapshotSecretValuesPort, snapshotSecretValues),
    Layer.succeed(RuntimeExtensionContextImpactStatePort, snapshotContextImpact),
    Layer.succeed(RuntimeExternalInstructionStatePort, externalInstructionState),
    workspaceStateLayer,
    Layer.succeed(RuntimeLayerProviderAuthPort, {
      ensureUsableProviderAuth: (provider) =>
        Effect.tryPromise({
          try: () => input.providerAuth.ensureUsableProviderAuth(provider),
          catch: (cause) => runtimeBootstrapError("runtime.messages.submit.providerAuth", cause),
        }),
      getProviderAuthUnavailableMessage: input.providerAuth.getProviderAuthUnavailableMessage,
    }),
    Layer.succeed(ProviderAuthPort, {
      getProviderAuthSnapshot: ({ providerId, workspaceId }) =>
        Effect.tryPromise({
          try: async () => {
            const accessToken = await input.providerAuth.ensureUsableProviderAuth(providerId);
            if (!accessToken) {
              return {
                providerId,
                ...(workspaceId ? { workspaceId } : {}),
                health: "missing" as const,
                issue: input.providerAuth.getProviderAuthUnavailableMessage(providerId),
              };
            }
            return usableProviderAuthSnapshot({ providerId, workspaceId, accessToken });
          },
          catch: (cause) =>
            new ProviderAuthPortError({
              operation: "runtime.pi.providerAuth.getProviderAuthSnapshot",
              reason: "state-conflict",
              message:
                cause instanceof Error ? cause.message : "Provider auth snapshot lookup failed.",
              cause,
            }),
        }),
      refreshProviderCredentialSnapshot: ({ providerId, workspaceId }) =>
        Effect.tryPromise({
          try: async () => {
            const accessToken = await input.providerAuth.ensureUsableProviderAuth(providerId);
            if (!accessToken) {
              return {
                providerId,
                ...(workspaceId ? { workspaceId } : {}),
                health: "missing" as const,
                issue: input.providerAuth.getProviderAuthUnavailableMessage(providerId),
              };
            }
            return usableProviderAuthSnapshot({ providerId, workspaceId, accessToken });
          },
          catch: (cause) =>
            new ProviderAuthPortError({
              operation: "runtime.pi.providerAuth.refreshProviderCredentialSnapshot",
              reason: "state-conflict",
              message:
                cause instanceof Error ? cause.message : "Provider auth snapshot refresh failed.",
              cause,
            }),
        }),
    }),
    Layer.succeed(ProviderAuthStatusStatePort, providerAuthStatusState),
    Layer.succeed(PiRuntimePathsPort, {
      resolve: ({ workspaceId }) =>
        Effect.tryPromise({
          try: () => input.piRuntimePaths.resolve(workspaceId),
          catch: (cause) =>
            new PiAdapterError({
              operation: "runtime.pi.paths.resolve",
              reason: "runtime-paths-failed",
              message:
                cause instanceof Error ? cause.message : "Pi runtime paths could not be resolved.",
              cause,
            }),
        }),
    }),
    Layer.succeed(RuntimeLayerModelResolverPort, {
      resolveModel: ({ provider, model }) =>
        Effect.try({
          try: () => {
            const resolved = getModel(
              provider as Parameters<typeof getModel>[0],
              model as Parameters<typeof getModel>[1],
            );
            if (!resolved || resolved.provider !== provider || resolved.id !== model) {
              throw new RuntimeContractError({
                operation: "runtime.model.resolve",
                reason: "invalid-input",
                message: `Model registry has no exact entry for ${provider}/${model}.`,
              });
            }
            return {
              provider: resolved.provider,
              model: resolved.id,
              supportedReasoning: getSupportedThinkingLevels(resolved) as ReasoningEffort[],
              contextWindow: resolved.contextWindow,
            };
          },
          catch: (cause) => runtimeBootstrapError("runtime.model.resolve", cause),
        }),
    }),
    Layer.succeed(AppLogWritePort, appLogWritePortFromBootstrap(input)),
    Layer.succeed(RuntimeGeneratedContextRefreshHostPort, input.generatedContextRefresh),
    Layer.succeed(RuntimeGeneratedPackageRefreshHostPort, input.generatedPackageRefresh),
    Layer.succeed(RuntimeExternalInstructionScanInputPort, input.externalInstructionScanInput),
    Layer.succeed(RuntimeGeneratedPackageStatePort, generatedPackageStatePort),
    Layer.succeed(RuntimeSourceInvalidationScanPort, createSourceInvalidationScanPort(input)),
    Layer.succeed(RuntimeLayerCommandStdinPort, input.commandRegistry),
    Layer.succeed(RuntimeLayerCommandControlPort, {
      cancel: input.commandRegistry.cancel,
      runExecuteTypescript: input.executeTypescriptHost.runExecuteTypescript,
    }),
    Layer.succeed(RuntimePrimitiveToolHostPort, input.primitiveToolHost),
    Layer.succeed(RuntimeWorkflowTaskAgentBridgeBearerVerifier, {
      verify: (request) =>
        Effect.tryPromise({
          try: async () =>
            Boolean(await input.workflowTaskAgentBridge?.verifyBearerLineage(request)),
          catch: (cause) => runtimeBootstrapError("runtime.workflowTaskAgentBridge.verify", cause),
        }).pipe(Effect.catch(() => Effect.succeed(false))),
    }),
  );
  const runtimeLayerConfig = createRuntimeLayerConfigLayer(input.runtimeLayerConfig);
  const managedRuntime = ManagedRuntime.make(
    Layer.mergeAll(
      Runtime.layer.pipe(Layer.provide(runtimeLayerConfig)),
      runtimeLayerConfig,
      stateFacadeServicesLayer,
      Layer.effect(PiAdapter, PiAdapter),
      Layer.succeed(SecretStorePort, input.secretStore),
    ).pipe(Layer.provide(runtimeHostLayer)),
  );
  const appLogInvalidationSubscriptions = new Map<string, () => void>();
  let appLogInvalidationSubscriptionsClosed = false;
  const subscribeToCommittedAppLogAppends = async (
    workspaceId?: WorkspaceId,
    suppliedAppLogs?: Pick<StateAppLogsFacade, "subscribe">,
  ): Promise<void> => {
    if (appLogInvalidationSubscriptionsClosed) return;
    const subscriptionKey = workspaceId ? `workspace:${workspaceId}` : "app";
    if (appLogInvalidationSubscriptions.has(subscriptionKey)) return;
    const appLogs =
      suppliedAppLogs ??
      (workspaceId ? await input.resolveWorkspaceAppLogs?.(workspaceId) : input.appLogs);
    if (!appLogs) return;
    const unsubscribe = appLogs.subscribe((entries) => {
      if (entries.length === 0 || appLogInvalidationSubscriptionsClosed) return;
      void notifyCommittedAppLogAppend(managedRuntime, workspaceId ? { workspaceId } : {}).catch(
        (error) =>
          input.onAppLogCommitNotificationError?.(error, workspaceId ? { workspaceId } : {}),
      );
    });
    if (appLogInvalidationSubscriptionsClosed) {
      unsubscribe();
      return;
    }
    appLogInvalidationSubscriptions.set(subscriptionKey, unsubscribe);
  };
  const unsubscribeFromCommittedAppLogAppends = (workspaceId: WorkspaceId): void => {
    const subscriptionKey = `workspace:${workspaceId}`;
    appLogInvalidationSubscriptions.get(subscriptionKey)?.();
    appLogInvalidationSubscriptions.delete(subscriptionKey);
  };
  const closeCommittedAppLogAppendSubscriptions = (): void => {
    appLogInvalidationSubscriptionsClosed = true;
    for (const unsubscribe of appLogInvalidationSubscriptions.values()) {
      unsubscribe();
    }
    appLogInvalidationSubscriptions.clear();
  };
  let runtimeServiceAcquired = false;
  try {
    await managedRuntime.context();
    runtimeServiceAcquired = true;
    const runRuntimePromise = <A>(effect: Effect.Effect<A, unknown, never>) =>
      managedRuntime.runPromise(effect);
    const readiness = await awaitRuntimeStartupReadiness(managedRuntime);
    await runRuntimePromise(
      Effect.gen(function* () {
        const runtime = yield* Runtime;
        yield* runtime.extensions.snapshots.recover();
        yield* runtime.extensions.snapshots.ensureInitial();
      }) as Effect.Effect<unknown, unknown, never>,
    );
    await runRuntimePromise(
      processExtensionEnvSecretCleanup({
        store: appGlobalStateRegistration.store,
        secretStoreMutation: input.secretStoreMutation,
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);
    const state = createStateFacade(managedRuntime);
    const stateCommands = createStateCommandsFacade(managedRuntime);
    const rendererState = narrowRendererStateFacade(state);
    const rendererStateCommands = narrowRendererStateCommandsFacade(stateCommands);
    await seedAppPreferencesStateRows({
      seed: input.appPreferencesSeed,
      stateCommands,
    });
    await subscribeToCommittedAppLogAppends();
    for (const registration of initialWorkspaceStateRegistrations) {
      await subscribeToCommittedAppLogAppends(registration.store.workspaceId as WorkspaceId);
    }
    lifecycle.markReady();
    const modelMetadata: AppRuntimeBootstrap["modelMetadata"] = {
      list: async (request) => {
        lifecycle.assertAccepting("app-runtime-bootstrap.modelMetadata.list");
        return runRuntimePromise(
          Effect.gen(function* () {
            const piAdapter = yield* PiAdapter;
            return yield* piAdapter.models
              .list(request)
              .pipe(Effect.provideService(ProviderAuthStatusStatePort, providerAuthStatusState));
          }) as Effect.Effect<readonly ModelInfo[], unknown, never>,
        );
      },
    };
    const acquireDirectToolLaunch = (
      request: Omit<BuildLaunchPolicyInput, "launchKind"> & {
        readonly toolName: "exec_command" | "apply_patch" | "execute_typescript";
      },
    ) => acquireAcceptedDirectToolLaunch(managedRuntime, request);
    return {
      facade,
      state,
      stateCommands,
      rendererState,
      rendererStateCommands,
      modelMetadata,
      readiness,
      internal: {
        launchFacts: {
          acquireDirectToolLaunch,
          acquireExecuteTypescript: (request) =>
            acquireDirectToolLaunch({ ...request, toolName: "execute_typescript" }),
        },
        sourceInvalidation: {
          refreshGeneratedPackages: (request) =>
            runRuntimePromise(
              Effect.gen(function* () {
                const runtime = yield* Runtime;
                return yield* runtime.sourceInvalidation.refreshGeneratedPackages(request);
              }) as Effect.Effect<GeneratedPackagesRefreshResult, unknown, never>,
            ),
        },
        workspaceRecovery: {
          wakeSurfaceQueue: (target) =>
            runRuntimePromise(
              Effect.gen(function* () {
                const runtime = yield* Runtime;
                yield* runtime.workspaceRecovery.wakeSurfaceQueue({ target });
              }) as Effect.Effect<void, unknown, never>,
            ),
        },
        acceptedNativeTools: {
          requestDirectToolApproval: (request) =>
            requestAcceptedDirectToolApproval(managedRuntime, request),
          runLoadExtension: (request) => runAcceptedLoadExtension(managedRuntime, request),
        },
        workflowTaskAgentBridge: {
          runTaskAgent: (request) =>
            runRuntimePromise(
              Effect.gen(function* () {
                const runtime = yield* Runtime;
                return yield* runtime.workflowTaskAgentBridge.runTaskAgent(request);
              }) as Effect.Effect<RunTaskAgentResult, unknown, never>,
            ),
        },
        committedStateInvalidations: {
          publish: async (afterCommit) => {
            await publishCommittedStateInvalidations(managedRuntime, afterCommit);
          },
        },
        workspaceStates: {
          register: async (request, appLogs) => {
            lifecycle.assertAccepting("app-runtime-bootstrap.workspaceStates.register");
            const registration = workspaceStateRegistration(request);
            workspaceRouter.registerWorkspaceState(registration);
            const workspaceId = registration.store.workspaceId as WorkspaceId;
            registeredWorkspaceStores.set(workspaceId, registration.store);
            try {
              await subscribeToCommittedAppLogAppends(workspaceId, appLogs);
            } catch (cause) {
              workspaceRouter.unregisterWorkspaceState(workspaceId);
              registeredWorkspaceStores.delete(workspaceId);
              throw cause;
            }
          },
          unregister: (workspaceId) => {
            lifecycle.assertAccepting("app-runtime-bootstrap.workspaceStates.unregister");
            unsubscribeFromCommittedAppLogAppends(workspaceId);
            registeredWorkspaceStores.delete(workspaceId);
            return workspaceRouter.unregisterWorkspaceState(workspaceId);
          },
        },
      },
      dispose: (reason = "app-shutdown") =>
        lifecycle
          .shutdown(
            reason,
            () => prepareShutdown(managedRuntime, reason),
            async () => {
              closeCommittedAppLogAppendSubscriptions();
              stateCommands.close();
              state.close();
              await facade.close();
            },
            () => disposeManagedRuntime(managedRuntime),
          )
          .then(() => undefined),
    };
  } catch (cause) {
    lifecycle.markStartupFailed(cause);
    closeCommittedAppLogAppendSubscriptions();
    try {
      if (runtimeServiceAcquired) {
        await prepareShutdown(managedRuntime, "startup-failure");
      }
    } finally {
      await disposeManagedRuntime(managedRuntime);
    }
    throw cause;
  }
}

function appLogStateServiceFromFacade(
  appLogs: AppRuntimeBootstrapInput["appLogs"],
  ownerWorkspaceId?: WorkspaceId,
): Parameters<typeof stateReadModelsFromRouter>[0]["appLogs"] {
  const scopeForFacade = (scope: string | null | undefined): string | null | undefined =>
    ownerWorkspaceId ? undefined : scope;
  const readOwnedModel = (readModel: ReturnType<typeof appLogs.query>) => {
    if (!ownerWorkspaceId) return readModel;
    return {
      ...readModel,
      workspaceId: ownerWorkspaceId,
      entries: readModel.entries.map((entry) => ({
        ...entry,
        workspaceId: entry.workspaceId ?? ownerWorkspaceId,
      })),
    };
  };
  return {
    append: (entry) =>
      Effect.try({
        try: () => appLogs.append(entry),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.appLogs.append",
            reason: "transaction-failed",
            message: cause instanceof Error ? cause.message : "App log append failed.",
            cause,
          }),
      }),
    query: (query, scope) =>
      Effect.try({
        try: () => readOwnedModel(appLogs.query(query, scopeForFacade(scope))),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.appLogs.query",
            reason: "transaction-failed",
            message: cause instanceof Error ? cause.message : "App log query failed.",
            cause,
          }),
      }),
    summary: (scope) =>
      Effect.try({
        try: () => appLogs.summary(scopeForFacade(scope)),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.appLogs.summary",
            reason: "transaction-failed",
            message: cause instanceof Error ? cause.message : "App log summary failed.",
            cause,
          }),
      }),
    markSeen: (throughSeq, scope) =>
      Effect.try({
        try: () => appLogs.markSeen(throughSeq, scopeForFacade(scope)),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.appLogs.markSeen",
            reason: "transaction-failed",
            message: cause instanceof Error ? cause.message : "App log mark seen failed.",
            cause,
          }),
      }),
    markSeenWithResult: (throughSeq, scope) =>
      Effect.try({
        try: () => appLogs.markSeenWithResult(throughSeq, scopeForFacade(scope)),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.appLogs.markSeenWithResult",
            reason: "transaction-failed",
            message:
              cause instanceof Error ? cause.message : "App log read-state transition failed.",
            cause,
          }),
      }),
    markSeenForEntryIdsWithResult: (entryIds, scope) =>
      Effect.try({
        try: () =>
          appLogs.markSeenForEntryIdsWithResult(
            entryIds as readonly AppLogEntryId[],
            scopeForFacade(scope),
          ),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.appLogs.markSeenForEntryIdsWithResult",
            reason: "transaction-failed",
            message:
              cause instanceof Error ? cause.message : "App log read-state transition failed.",
            cause,
          }),
      }),
    setViewPreferences: (preferences, scope) =>
      Effect.try({
        try: () => appLogs.setViewPreferences(preferences, scopeForFacade(scope)),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.appLogs.setViewPreferences",
            reason: "transaction-failed",
            message:
              cause instanceof Error ? cause.message : "App log view preference update failed.",
            cause,
          }),
      }),
    subscribe: (listener) =>
      Effect.try({
        try: () => appLogs.subscribe(listener),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.appLogs.subscribe",
            reason: "transaction-failed",
            message: cause instanceof Error ? cause.message : "App log subscribe failed.",
            cause,
          }),
      }),
  };
}

function appLogWritePortFromBootstrap(input: AppRuntimeBootstrapInput): AppLogWritePortService {
  return {
    append: (entry) => {
      if (!entry.workspaceId || !input.resolveWorkspaceAppLogs) {
        return input.appLogWritePort.append(entry);
      }
      return Effect.tryPromise({
        try: () => input.resolveWorkspaceAppLogs!(entry.workspaceId!),
        catch: (cause) =>
          new StateContractError({
            operation: "app-runtime-bootstrap.resolveWorkspaceAppLogWriter",
            reason: "not-found",
            message: `App runtime bootstrap could not resolve app-log writer for workspace ${entry.workspaceId}.`,
            cause,
          }),
      }).pipe(Effect.flatMap((appLogs) => appLogs.writePort.append(entry)));
    },
  };
}

async function seedAppPreferencesStateRows(input: {
  readonly seed: AppRuntimeBootstrapInput["appPreferencesSeed"];
  readonly stateCommands: StateCommandsFacade;
}): Promise<void> {
  if (!input.seed || input.seed.hasStateRows()) {
    return;
  }
  const preferences = input.seed.read();
  await input.stateCommands.appPreferences.update({
    patch: {
      appearance: preferences.appAppearance,
      externalEditor: stateExternalEditorFromAppPreferences(preferences),
      artifactDirectory: preferences.artifactDirectory as AbsolutePath,
      approvalMode: preferences.approvalMode,
      networkAccess: preferences.networkAccess,
      externalInstructions: preferences.externalInstructions,
      ambientResources: preferences.ambientAgentResources as unknown as JsonValue,
    },
    clientSubmission: {
      clientRequestId: "bootstrap-app-preferences-seed" as RuntimeClientRequestId,
      source: "app-bootstrap" as RuntimeClientSubmissionSource,
    },
  });
}

function stateExternalEditorFromAppPreferences(preferences: AppPreferences): string | null {
  if (preferences.preferredExternalEditor === "system") {
    return null;
  }
  if (preferences.preferredExternalEditor === "custom") {
    return preferences.customExternalEditorCommand || "custom";
  }
  return preferences.preferredExternalEditor;
}

function createGeneratedPackageStatePort(input: {
  readonly routerPort: RuntimeGeneratedPackageStatePortService;
  readonly unopenedWorkspaceFallback?:
    | Pick<
        RuntimeGeneratedPackageStatePortService,
        "markWorkspaceLinksRepairNeeded" | "recordWorkspaceLinkStatus"
      >
    | undefined;
}): RuntimeGeneratedPackageStatePortService {
  if (!input.unopenedWorkspaceFallback) {
    return input.routerPort;
  }
  return {
    ...input.routerPort,
    recordWorkspaceLinkStatus: (request) =>
      input.routerPort.recordWorkspaceLinkStatus(request).pipe(
        Effect.matchEffect({
          onFailure: (error: StateContractError) =>
            error.reason === "not-found"
              ? input.unopenedWorkspaceFallback!.recordWorkspaceLinkStatus(request)
              : Effect.fail(error),
          onSuccess: (result) => Effect.succeed(result),
        }),
      ),
    markWorkspaceLinksRepairNeeded: (request) =>
      input.routerPort.markWorkspaceLinksRepairNeeded(request).pipe(
        Effect.matchEffect({
          onFailure: (error: StateContractError) =>
            error.reason === "not-found"
              ? input.unopenedWorkspaceFallback!.markWorkspaceLinksRepairNeeded(request)
              : Effect.fail(error),
          onSuccess: (result) => Effect.succeed(result),
        }),
      ),
  };
}

function workspaceStateRegistration(
  input: AppRuntimeBootstrapWorkspaceStateInput,
): WorkspaceStateRegistration {
  if ("workspaceStateRouterRegistration" in input) {
    return input.workspaceStateRouterRegistration();
  }
  return input;
}

function createSourceInvalidationScanPort(
  input: AppRuntimeBootstrapInput,
): RuntimeSourceInvalidationScanPortService {
  const resolveCoordinator = async (scope: SourceReconcileRequest["scope"]) => {
    if (scope.kind === "app-global") return input.sourceInvalidation.appGlobalCoordinator;
    return await input.sourceInvalidation.resolveWorkspaceCoordinator(scope.workspaceId);
  };
  return {
    classifyHint: (request) =>
      Effect.tryPromise({
        try: async () => {
          const coordinator = await resolveCoordinator(request.scope);
          return await coordinator.classifyHint(request);
        },
        catch: (cause) => runtimeBootstrapError("runtime.sourceInvalidation.hint", cause),
      }),
    listAcquiredWorkspaceIds: () =>
      Effect.tryPromise({
        try: () => Promise.resolve(input.sourceInvalidation.listAcquiredWorkspaceIds()),
        catch: (cause) =>
          runtimeBootstrapError("runtime.sourceInvalidation.listAcquiredWorkspaceIds", cause),
      }),
    requestScan: (request) =>
      Effect.tryPromise({
        try: async () => {
          const coordinator = await resolveCoordinator(request.scope);
          await coordinator.requestScan({
            domains: request.domains,
            reason: `runtime_source_hint:${request.reason}`,
          });
        },
        catch: (cause) => runtimeBootstrapError("runtime.sourceInvalidation.hint", cause),
      }),
    reconcile: (request) =>
      Effect.tryPromise({
        try: async () => {
          const coordinator = await resolveCoordinator(request.scope);
          return await coordinator.reconcile({
            domains: request.domains,
            reason: `runtime_source_reconcile:${request.reason}`,
          });
        },
        catch: (cause) => runtimeBootstrapError("runtime.sourceInvalidation.reconcile", cause),
      }),
  };
}

async function prepareShutdown(
  managedRuntime: Parameters<typeof prepareRuntimeShutdown>[0],
  reason: RuntimePrepareShutdownReason,
): Promise<void> {
  await prepareRuntimeShutdown(managedRuntime, { reason });
}

async function disposeManagedRuntime<R, E>(
  managedRuntime: ManagedRuntime.ManagedRuntime<R, E>,
): Promise<void> {
  await managedRuntime.dispose();
}

function runtimeBootstrapError(operation: string, cause: unknown): RuntimeContractError {
  if (cause instanceof RuntimeContractError) {
    return cause;
  }
  return new RuntimeContractError({
    operation,
    reason: "state-conflict",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}
