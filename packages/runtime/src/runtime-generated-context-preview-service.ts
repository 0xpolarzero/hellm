import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  GeneratedContextPreviewSubjectStatePort,
  RuntimeContractError,
  RuntimeExternalInstructionStatePort,
  RuntimeRequestStatePort,
  type ExtensionId,
  type ExternalInstructionProjectedSource,
  type GeneratedContextPreviewResult,
  type PreviewGeneratedContextInput,
  type SourceDiagnostic,
  type SourceFingerprint,
} from "@svvy/core";
import {
  Extensions,
  buildGeneratedContextArtifacts,
  type GeneratedContextSourceContributor,
} from "@svvy/extensions";

import { RuntimeExternalInstructionScanInputPort } from "./runtime-source-invalidation-service";

export interface RuntimeGeneratedContextPreviewServiceService {
  preview(
    input: PreviewGeneratedContextInput,
  ): Effect.Effect<GeneratedContextPreviewResult, RuntimeContractError>;
}

export class RuntimeGeneratedContextPreviewService extends Context.Service<
  RuntimeGeneratedContextPreviewService,
  RuntimeGeneratedContextPreviewServiceService
>()("@svvy/runtime/RuntimeGeneratedContextPreviewService") {}

export const layerRuntimeGeneratedContextPreviewService = Layer.effect(
  RuntimeGeneratedContextPreviewService,
  Effect.gen(function* () {
    const subjects = yield* GeneratedContextPreviewSubjectStatePort;
    const externalInstructions = yield* RuntimeExternalInstructionStatePort;
    const externalInstructionScanInput = yield* RuntimeExternalInstructionScanInputPort;
    const requestState = yield* RuntimeRequestStatePort;
    const extensions = yield* Extensions;
    const crypto = yield* Crypto.Crypto;

    const preview = Effect.fn("@svvy/runtime/RuntimeGeneratedContextPreviewService.preview")(
      function* (input: PreviewGeneratedContextInput) {
        const subject = yield* subjects
          .readSubject(input)
          .pipe(Effect.mapError((cause) => stateFailure("read-subject", cause)));
        const registry = yield* extensions.registry
          .observe()
          .pipe(Effect.mapError((cause) => extensionFailure("observe-registry", cause)));
        const builds = yield* extensions.builds
          .observeCurrent({ registryObservation: registry })
          .pipe(Effect.mapError((cause) => extensionFailure("observe-builds", cause)));

        const buildByExtension = new Map(
          builds.observations.map((observation) => [observation.extensionId, observation]),
        );
        const contextReadyExtensionIds = registry.observations.flatMap((observation) => {
          const build = buildByExtension.get(observation.extensionId);
          if (!build || build.sourceStatus === "invalid") return [];
          if (observation.buildRequirement === "not-required") return [observation.extensionId];
          return build.currentBuildStatus === "current" && build.currentBuild?.contextReady === true
            ? [observation.extensionId]
            : [];
        });

        const unavailableLoadedExtensionIds: ExtensionId[] = [];
        for (const extensionId of subject.actorBinding.loadedExtensionIds) {
          const observation = registry.observations.find(
            (candidate) => candidate.extensionId === extensionId,
          );
          if (
            observation?.buildRequirement === "required" &&
            !contextReadyExtensionIds.includes(extensionId)
          ) {
            unavailableLoadedExtensionIds.push(extensionId);
          }
        }

        const contributors: GeneratedContextSourceContributor[] = [];
        const previewExtensionIds = new Set([
          ...subject.actorBinding.loadedExtensionIds,
          ...subject.actorBinding.availableExtensionIds,
        ]);
        for (const observation of registry.observations) {
          if (!previewExtensionIds.has(observation.extensionId)) continue;
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
              .pipe(Effect.mapError((cause) => extensionFailure("read-contributor", cause)));
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
          .pipe(Effect.mapError((cause) => stateFailure("read-external-instructions", cause)));
        const scan = yield* externalInstructionScanInput
          .resolve(input.workspaceId)
          .pipe(Effect.mapError((cause) => runtimeFailure("resolve-external-scan", cause)));
        const selectedExternalSources = externalProjection.sources
          .filter((source) =>
            externalInstructionSelected({
              source,
              actorKind: subject.actorBinding.actorKind,
              profileId: subject.profileId,
              actorUsage: externalProjection.actorUsage,
            }),
          )
          .toSorted((left, right) => left.order - right.order || left.id.localeCompare(right.id));
        for (const source of selectedExternalSources) {
          const resolved = yield* extensions.externalInstructions
            .resolveSource({ scan, source: source.source })
            .pipe(Effect.mapError((cause) => extensionFailure("read-external-instruction", cause)));
          if (
            resolved.observation.fingerprint !== source.fingerprint ||
            resolved.observation.canonicalPath !== source.canonicalPath
          ) {
            return yield* Effect.fail(
              new RuntimeContractError({
                operation: "runtime.generatedContext.preview",
                reason: "stale-state",
                message: `External instruction changed after its state observation: ${source.id}`,
              }),
            );
          }
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
          .pipe(Effect.mapError((cause) => stateFailure("read-request-input-settings", cause)));
        const diagnostics: SourceDiagnostic[] = [
          ...externalProjection.diagnostics.map((diagnostic) => ({
            severity: diagnostic.severity,
            code: diagnostic.code,
            message: diagnostic.message,
          })),
          ...unavailableLoadedExtensionIds.map((extensionId) => ({
            severity: "warning" as const,
            code: "extension.context_build_not_ready",
            message: `Loaded extension ${extensionId} has no current context-ready build and is omitted from this preview.`,
          })),
        ];
        const previewContextReadyExtensionIds = [
          ...contextReadyExtensionIds,
          ...unavailableLoadedExtensionIds,
        ];
        const artifacts = yield* buildGeneratedContextArtifacts(
          {
            actorKind: subject.actorBinding.actorKind,
            target: { kind: "profile-preview", workspaceId: input.workspaceId },
            actorBinding: subject.actorBinding,
            ...(subject.workflowTaskInlineInstructions
              ? { workflowTaskInlineInstructions: subject.workflowTaskInlineInstructions }
              : {}),
            reason: "diagnostics",
          },
          {
            registry,
            contributors,
            contextReadyExtensionIds: previewContextReadyExtensionIds,
            requestInputVariant: requestInputSettings.mode,
            diagnostics,
          },
        ).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.mapError((cause) => extensionFailure("assemble", cause)),
        );
        return {
          subject: subject.subject,
          profileId: subject.profileId,
          profileName: subject.profileName,
          providerId: subject.providerId,
          modelId: subject.modelId,
          reasoningEffort: subject.reasoningEffort,
          actorBinding: subject.actorBinding,
          systemPrompt: artifacts.systemPrompt,
          tokenEstimate: artifacts.generatedContext.tokenEstimate,
          extensions: artifacts.extensions,
          generatedContext: artifacts.generatedContext,
        };
      },
    );

    return { preview };
  }),
);

function externalInstructionSelected(input: {
  source: ExternalInstructionProjectedSource;
  actorKind: "orchestrator" | "handler" | "workflow-task";
  profileId: string;
  actorUsage: readonly {
    readonly actor: "orchestrator" | "handler" | "workflow-task";
    readonly profileId: string | null;
    readonly sourceId: string;
    readonly usage: "loaded" | "available" | "unavailable";
  }[];
}): boolean {
  if (input.source.readStatus.status !== "readable") return false;
  const profileUsage = input.actorUsage.find(
    (usage) =>
      usage.actor === input.actorKind &&
      usage.profileId === input.profileId &&
      usage.sourceId === input.source.id,
  );
  if (profileUsage) return profileUsage.usage === "loaded";
  const actorDefaultUsage = input.actorUsage.find(
    (usage) =>
      usage.actor === input.actorKind &&
      usage.profileId === null &&
      usage.sourceId === input.source.id,
  );
  if (actorDefaultUsage) return actorDefaultUsage.usage === "loaded";
  return (
    input.source.defaultControl.enabled &&
    input.source.defaultControl.eligibleActors.includes(input.actorKind)
  );
}

function stateFailure(stage: string, cause: unknown): RuntimeContractError {
  return new RuntimeContractError({
    operation: `runtime.generatedContext.preview.${stage}`,
    reason: "state-conflict",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function extensionFailure(stage: string, cause: unknown): RuntimeContractError {
  return new RuntimeContractError({
    operation: `runtime.generatedContext.preview.${stage}`,
    reason: "dependency-not-ready",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function runtimeFailure(stage: string, cause: unknown): RuntimeContractError {
  return cause instanceof RuntimeContractError
    ? cause
    : new RuntimeContractError({
        operation: `runtime.generatedContext.preview.${stage}`,
        reason: "state-conflict",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
}
