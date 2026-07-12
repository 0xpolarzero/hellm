import * as Layer from "effect/Layer";
import {
  ExtensionStatePort,
  PiSessionReferencePort,
  ProviderAuthStatusStatePort,
  RuntimeActorExtensionBindingStatePort,
  RuntimeApprovalStatePort,
  RuntimeArtifactStatePort,
  RuntimeCommandStatePort,
  RuntimeComposerDraftStatePort,
  RuntimeComposerProfileStatePort,
  RuntimeEpisodeStatePort,
  RuntimeExtensionContextImpactStatePort,
  RuntimeExtensionStatePort,
  RuntimeGeneratedPackageStatePort,
  RuntimePromptDefaultsStatePort,
  RuntimeQueueStatePort,
  RuntimeReadModelStatePort,
  RuntimeRecoveryStatePort,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeSourceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeThreadStatePort,
  RuntimeTranscriptStatePort,
  RuntimeTurnStatePort,
  RuntimeWorkspaceStatePort,
  SandboxPolicySource,
  StateContractError,
} from "@svvy/core";
import { layerExtensionStatePort } from "./extension-state-port";
import { layerPiSessionReferencePort } from "./pi-session-reference-port";
import { layerProviderAuthStatusStatePort } from "./provider-auth-status-state-port";
import { layerRuntimeActorExtensionBindingStatePort } from "./runtime-actor-extension-binding-state-port";
import { layerRuntimeApprovalStatePort } from "./runtime-approval-state-port";
import { layerRuntimeArtifactStatePort } from "./runtime-artifact-state-port";
import { layerRuntimeCommandStatePort } from "./runtime-command-state-port";
import { layerRuntimeComposerDraftStatePort } from "./runtime-composer-draft-state-port";
import { layerRuntimeComposerProfileStatePort } from "./runtime-composer-profile-state-port";
import { layerRuntimeEpisodeStatePort } from "./runtime-episode-state-port";
import { layerRuntimeExtensionContextImpactStatePort } from "./runtime-extension-context-impact-state-port";
import { layerRuntimeExtensionStatePort } from "./runtime-extension-state-port";
import { layerRuntimeGeneratedPackageStatePort } from "./runtime-generated-package-state-port";
import { layerRuntimePromptDefaultsStatePort } from "./runtime-prompt-defaults-state-port";
import { layerRuntimeQueueStatePort } from "./runtime-queue-state-port";
import { layerRuntimeReadModelStatePort } from "./runtime-read-model-state-port";
import { layerRuntimeRecoveryStatePort } from "./runtime-recovery-state-port";
import { layerRuntimeRequestStatePort } from "./runtime-request-state-port";
import { layerRuntimeSessionWaitStatePort } from "./runtime-session-wait-state-port";
import { layerRuntimeSourceStatePort } from "./runtime-source-state-port";
import { layerRuntimeSurfaceLifecycleStatePort } from "./runtime-surface-lifecycle-state-port";
import { layerRuntimeThreadStatePort } from "./runtime-thread-state-port";
import { layerRuntimeTranscriptStatePort } from "./runtime-transcript-state-port";
import { layerRuntimeTurnStatePort } from "./runtime-turn-state-port";
import { layerRuntimeWorkspaceStatePort } from "./runtime-workspace-state-port";
import {
  layerSandboxPolicySource,
  layerSandboxPolicySourceWithConfig,
  type SandboxPolicySourceConfig,
} from "./sandbox-policy-source";
import { type StructuredSessionState } from "./structured-session-state";

export type StructuredSessionStatePorts =
  | ExtensionStatePort
  | RuntimeWorkspaceStatePort
  | RuntimeSurfaceLifecycleStatePort
  | RuntimeComposerDraftStatePort
  | RuntimeComposerProfileStatePort
  | RuntimeQueueStatePort
  | RuntimeTurnStatePort
  | RuntimeCommandStatePort
  | RuntimeApprovalStatePort
  | RuntimeActorExtensionBindingStatePort
  | RuntimeEpisodeStatePort
  | RuntimeExtensionStatePort
  | RuntimeExtensionContextImpactStatePort
  | RuntimeGeneratedPackageStatePort
  | RuntimePromptDefaultsStatePort
  | RuntimeArtifactStatePort
  | RuntimeRecoveryStatePort
  | RuntimeReadModelStatePort
  | RuntimeRequestStatePort
  | RuntimeSessionWaitStatePort
  | RuntimeSourceStatePort
  | RuntimeThreadStatePort
  | RuntimeTranscriptStatePort
  | ProviderAuthStatusStatePort
  | SandboxPolicySource
  | PiSessionReferencePort;

export const structuredSessionStatePortsLayer = Layer.mergeAll(
  layerExtensionStatePort,
  layerRuntimeWorkspaceStatePort,
  layerRuntimeSurfaceLifecycleStatePort,
  layerRuntimeComposerDraftStatePort,
  layerRuntimeComposerProfileStatePort,
  layerRuntimeQueueStatePort,
  layerRuntimeTurnStatePort,
  layerRuntimeCommandStatePort,
  layerRuntimeApprovalStatePort,
  layerRuntimeActorExtensionBindingStatePort,
  layerRuntimeEpisodeStatePort,
  layerRuntimeExtensionStatePort,
  layerRuntimeExtensionContextImpactStatePort,
  layerRuntimeGeneratedPackageStatePort,
  layerRuntimePromptDefaultsStatePort,
  layerRuntimeArtifactStatePort,
  layerRuntimeRecoveryStatePort,
  layerRuntimeReadModelStatePort,
  layerRuntimeRequestStatePort,
  layerRuntimeSessionWaitStatePort,
  layerRuntimeSourceStatePort,
  layerRuntimeThreadStatePort,
  layerRuntimeTranscriptStatePort,
  layerProviderAuthStatusStatePort,
  layerSandboxPolicySource,
  layerPiSessionReferencePort,
) satisfies Layer.Layer<StructuredSessionStatePorts, StateContractError, StructuredSessionState>;

export function structuredSessionStatePortsLayerWithSandboxPolicyConfig(
  config: SandboxPolicySourceConfig,
): Layer.Layer<StructuredSessionStatePorts, StateContractError, StructuredSessionState> {
  return Layer.mergeAll(
    layerExtensionStatePort,
    layerRuntimeWorkspaceStatePort,
    layerRuntimeSurfaceLifecycleStatePort,
    layerRuntimeComposerDraftStatePort,
    layerRuntimeComposerProfileStatePort,
    layerRuntimeQueueStatePort,
    layerRuntimeTurnStatePort,
    layerRuntimeCommandStatePort,
    layerRuntimeApprovalStatePort,
    layerRuntimeActorExtensionBindingStatePort,
    layerRuntimeEpisodeStatePort,
    layerRuntimeExtensionStatePort,
    layerRuntimeExtensionContextImpactStatePort,
    layerRuntimeGeneratedPackageStatePort,
    layerRuntimePromptDefaultsStatePort,
    layerRuntimeArtifactStatePort,
    layerRuntimeRecoveryStatePort,
    layerRuntimeReadModelStatePort,
    layerRuntimeRequestStatePort,
    layerRuntimeSessionWaitStatePort,
    layerRuntimeSourceStatePort,
    layerRuntimeThreadStatePort,
    layerRuntimeTranscriptStatePort,
    layerProviderAuthStatusStatePort,
    layerSandboxPolicySourceWithConfig(config),
    layerPiSessionReferencePort,
  );
}
