import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeActorExtensionBindingStatePort,
  RuntimeContractError,
  RuntimeExternalInstructionStatePort,
  RuntimeRequestStatePort,
  type ActorBinding,
  type ExternalInstructionProjectedSource,
  type RuntimePromptBindingRecord,
  type RuntimeSurfaceTarget,
  type SourceFingerprint,
  type WorkspaceId,
} from "@svvy/core";
import {
  Extensions,
  buildGeneratedContextArtifacts,
  type GeneratedContextSourceContributor,
} from "@svvy/extensions";
import { RuntimeExternalInstructionScanInputPort } from "./runtime-source-invalidation-service";

export interface RuntimeGeneratedContextBindingServiceService {
  refresh(input: {
    readonly workspaceId: WorkspaceId;
    readonly target: RuntimeSurfaceTarget;
  }): Effect.Effect<RuntimePromptBindingRecord, RuntimeContractError>;
}

export class RuntimeGeneratedContextBindingService extends Context.Service<
  RuntimeGeneratedContextBindingService,
  RuntimeGeneratedContextBindingServiceService
>()("@svvy/runtime/RuntimeGeneratedContextBindingService") {}

export const layerRuntimeGeneratedContextBindingService = Layer.effect(
  RuntimeGeneratedContextBindingService,
  Effect.gen(function* () {
    const bindingState = yield* RuntimeActorExtensionBindingStatePort;
    const externalInstructions = yield* RuntimeExternalInstructionStatePort;
    const externalInstructionScanInput = yield* RuntimeExternalInstructionScanInputPort;
    const requestState = yield* RuntimeRequestStatePort;
    const extensions = yield* Extensions;
    const crypto = yield* Crypto.Crypto;
    return {
      refresh: Effect.fn("@svvy/runtime/RuntimeGeneratedContextBindingService.refresh")(
        function* (input) {
          const subject = yield* bindingState
            .readGeneratedContextBuildSubject({ target: input.target })
            .pipe(Effect.mapError((cause) => failure("read-subject", cause)));
          const registry = yield* extensions.registry
            .observe()
            .pipe(Effect.mapError((cause) => failure("observe-registry", cause)));
          const builds = yield* extensions.builds
            .observeCurrent({ registryObservation: registry })
            .pipe(Effect.mapError((cause) => failure("observe-builds", cause)));
          const buildByExtension = new Map(
            builds.observations.map((observation) => [observation.extensionId, observation]),
          );
          const contextReadyExtensionIds = registry.observations.flatMap((observation) => {
            const build = buildByExtension.get(observation.extensionId);
            if (!build || build.sourceStatus === "invalid") return [];
            if (observation.buildRequirement === "not-required") return [observation.extensionId];
            return build.currentBuildStatus === "current" && build.currentBuild?.contextReady
              ? [observation.extensionId]
              : [];
          });
          const selected = new Set([
            ...subject.loadedExtensionIds,
            ...subject.availableExtensionIds,
          ]);
          const contributors: GeneratedContextSourceContributor[] = [];
          for (const observation of registry.observations) {
            if (!selected.has(observation.extensionId)) continue;
            for (const contributor of observation.contributors) {
              if (contributor.kind === "script" || !contributor.source) continue;
              if (
                contributor.kind === "generated-instruction" &&
                !contextReadyExtensionIds.includes(observation.extensionId)
              ) {
                continue;
              }
              const session = yield* extensions.sources
                .openEditSession(contributor.source)
                .pipe(Effect.mapError((cause) => failure("read-contributor", cause)));
              contributors.push({
                extensionId: observation.extensionId,
                kind:
                  contributor.kind === "minimal"
                    ? "minimal"
                    : observation.interfaceKind === "svvyx"
                      ? "svvyx-guidance"
                      : "instruction",
                contributorId: contributor.source.sourceId,
                sourceRecordId: contributor.source.sourceId,
                sourceVersion: session.sourceVersion as SourceFingerprint,
                sourcePath: session.path,
                sourceFingerprint: session.fingerprint as SourceFingerprint,
                bypassed: contributor.bypassed,
                text: session.text,
              });
            }
          }
          const externalProjection = yield* externalInstructions
            .readExternalInstructions({ workspaceId: input.workspaceId })
            .pipe(Effect.mapError((cause) => failure("read-external-instructions", cause)));
          const scan = yield* externalInstructionScanInput
            .resolve(input.workspaceId)
            .pipe(Effect.mapError((cause) => failure("resolve-external-scan", cause)));
          const selectedExternalSources = externalProjection.sources.filter((source) =>
            externalInstructionSelected({
              source,
              actorKind: subject.actorKind,
              profileId: subject.profileId,
              actorUsage: externalProjection.actorUsage,
            }),
          );
          for (const source of selectedExternalSources) {
            const resolved = yield* extensions.externalInstructions
              .resolveSource({ scan, source: source.source })
              .pipe(Effect.mapError((cause) => failure("read-external-instruction", cause)));
            contributors.push({
              kind: "external-instruction",
              contributorId: source.id,
              sourceRecordId: source.id,
              sourceVersion: source.fingerprint as SourceFingerprint,
              sourcePath: source.canonicalPath,
              sourceFingerprint: source.fingerprint as SourceFingerprint,
              bypassed: false,
              text: resolved.content,
            });
          }
          const requestInputSettings = yield* requestState
            .readRequestInputSettings()
            .pipe(Effect.mapError((cause) => failure("read-request-input-settings", cause)));
          const registryIds = registry.observations.map((item) => item.extensionId);
          const actorBinding: ActorBinding = {
            actorKind: subject.actorKind,
            loadedExtensionIds: subject.loadedExtensionIds,
            availableExtensionIds: subject.availableExtensionIds,
            unavailableExtensionIds: registryIds.filter((id) => !selected.has(id)),
            instructionOrder: [...subject.loadedExtensionIds, ...subject.availableExtensionIds],
            source:
              subject.actorKind === "workflow-task" ? "workflow-agent-source" : "surface-binding",
          };
          const artifacts = yield* buildGeneratedContextArtifacts(
            {
              actorKind: subject.actorKind,
              target:
                input.target.surface === "orchestrator"
                  ? { kind: "orchestrator", workspaceSessionId: input.target.workspaceSessionId }
                  : input.target.surface === "handler"
                    ? {
                        kind: "handler",
                        workspaceSessionId: input.target.workspaceSessionId,
                        threadId: input.target.threadId,
                      }
                    : {
                        kind: "workflow-task",
                        workspaceSessionId: input.target.workspaceSessionId,
                        workflowTaskAttemptId: input.target.workflowTaskAttemptId,
                      },
              actorBinding,
              reason: "surface-refresh",
            },
            {
              registry,
              contributors,
              contextReadyExtensionIds,
              requestInputVariant: requestInputSettings.mode,
            },
          ).pipe(
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.mapError((cause) => failure("assemble", cause)),
          );
          return yield* bindingState
            .bindGeneratedContext({
              target: input.target,
              actorKind: subject.actorKind,
              fingerprint: artifacts.generatedContext.fingerprint,
              systemPrompt: artifacts.systemPrompt,
              svvyxGuidance: artifacts.generatedContext.svvyxGuidanceBlocks
                .map((block) => block.text)
                .join("\n\n"),
              commandsDts: artifacts.generatedContext.executeTypescriptFacadeDeclarations.text,
              nativeToolSchemasJson: JSON.stringify(
                artifacts.generatedContext.nativeToolDeclarations,
              ),
              loadedExtensionIds: subject.loadedExtensionIds,
              availableExtensionIds: subject.availableExtensionIds,
              externalSourceHashes: selectedExternalSources.map((source) => source.contentHash),
            })
            .pipe(
              Effect.map((result) => result.value),
              Effect.mapError((cause) => failure("bind", cause)),
            );
        },
      ),
    };
  }),
);

function externalInstructionSelected(input: {
  readonly source: ExternalInstructionProjectedSource;
  readonly actorKind: ActorBinding["actorKind"];
  readonly profileId: string | null;
  readonly actorUsage: readonly {
    readonly actor: string;
    readonly profileId: string | null;
    readonly sourceId: string;
    readonly usage: "loaded" | "available" | "unavailable";
  }[];
}): boolean {
  const profile = input.actorUsage.find(
    (usage) =>
      usage.actor === input.actorKind &&
      usage.profileId === input.profileId &&
      usage.sourceId === input.source.id,
  );
  const actorDefault = input.actorUsage.find(
    (usage) =>
      usage.actor === input.actorKind &&
      usage.profileId === null &&
      usage.sourceId === input.source.id,
  );
  const usage = profile?.usage ?? actorDefault?.usage;
  if (usage) return usage === "loaded";
  return (
    input.source.defaultControl.enabled &&
    input.source.defaultControl.eligibleActors.includes(input.actorKind)
  );
}

function failure(stage: string, cause: { readonly message: string }): RuntimeContractError {
  return new RuntimeContractError({
    operation: `runtime.generatedContext.refresh.${stage}`,
    reason: "target-not-ready",
    message: "Generated context could not be refreshed for this surface.",
    cause,
  });
}
