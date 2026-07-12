import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  GeneratedContextPreviewSubjectStatePort,
  StateContractError,
  type ActorBinding,
  type ExtensionId,
  type ExtensionUsageState,
  type GeneratedContextPreviewSubjectRecord,
  type GeneratedContextPreviewSubjectStatePortService,
  type ReasoningEffort,
  type SourceFingerprint,
} from "@svvy/core";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredAgentActorExtensionDefaultsRecord,
  type StructuredAgentProfileRecord,
  type StructuredSessionStateStore,
  type StructuredWorkflowAgentSourceIndexRecord,
} from "./structured-session-state";

const reasoningEfforts = new Set<ReasoningEffort>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export function generatedContextPreviewSubjectStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): GeneratedContextPreviewSubjectStatePortService {
  return {
    readSubject: (input) =>
      Effect.gen(function* () {
        const registryRecord = yield* state.readExtensionRegistryObservation();
        if (!registryRecord) {
          return yield* fail("not-found", "No current extension registry is available.");
        }
        const registry = registryRecord.observation.observations;
        const registryIds = new Set(registry.map((record) => record.extensionId));
        if (registryIds.size !== registry.length) {
          return yield* fail("conflict", "The current extension registry contains duplicate ids.");
        }

        const defaults = yield* state.listAgentActorExtensionDefaults();
        const networkAccess = (yield* state.readAppPreferences()).networkAccess;

        if (input.subject.kind === "configured-profile") {
          const profiles = yield* state.listAgentProfiles();
          const profile = profiles.find(
            (candidate) =>
              candidate.actor === input.subject.actorKind &&
              candidate.profileId === input.subject.profileId,
          );
          if (!profile) {
            return yield* fail(
              "not-found",
              `Configured ${input.subject.actorKind} profile ${input.subject.profileId} was not found.`,
            );
          }
          const reasoningEffort = yield* readReasoningEffort(profile.reasoning, profile.profileId);
          yield* validateIdentity(
            profile.profileId,
            profile.name,
            profile.providerId,
            profile.modelId,
          );
          const actorDefaults = defaults.find((record) => record.actor === input.subject.actorKind);
          const actorBinding = yield* resolveActorBinding({
            actorKind: input.subject.actorKind,
            registry,
            networkAccess,
            ...(actorDefaults ? { actorDefaults } : {}),
            overrides: profile.extensionUsage,
            profileOrder: profile.extensionOrder,
            source: "profile-default",
          });
          return {
            workspaceId: input.workspaceId,
            subject: input.subject,
            profileId: profile.profileId,
            profileName: profile.name,
            providerId: profile.providerId as GeneratedContextPreviewSubjectRecord["providerId"],
            modelId: profile.modelId as GeneratedContextPreviewSubjectRecord["modelId"],
            reasoningEffort,
            actorBinding,
          };
        }

        const subject = input.subject;
        const sources = yield* state.listCurrentWorkflowAgentSources();
        const source = sources.find((candidate) => candidate.sourceId === subject.sourceId);
        if (!source) {
          return yield* fail(
            "not-found",
            `Current workflow-agent source ${subject.sourceId} was not found.`,
          );
        }
        const parameters = yield* validWorkflowAgentParameters(source);
        yield* validateIdentity(
          source.sourceId,
          parameters.label,
          parameters.provider,
          parameters.model,
        );
        const actorDefaults = defaults.find((record) => record.actor === "workflow-task");
        const actorBinding = yield* resolveActorBinding({
          actorKind: "workflow-task",
          registry,
          networkAccess,
          ...(actorDefaults ? { actorDefaults } : {}),
          overrides: { ...parameters.overrides, ...source.extensionUsage },
          profileOrder: source.extensionOrder,
          source: "workflow-agent-source",
        });
        return {
          workspaceId: input.workspaceId,
          subject,
          profileId: source.sourceId,
          profileName: parameters.label,
          providerId: parameters.provider as GeneratedContextPreviewSubjectRecord["providerId"],
          modelId: parameters.model as GeneratedContextPreviewSubjectRecord["modelId"],
          reasoningEffort: parameters.reasoning.effort,
          actorBinding,
          workflowTaskInlineInstructions: {
            sourceRecordId: `workflow-agent:${source.sourceId}`,
            sourceVersion: source.sourceVersion as SourceFingerprint,
            text: parameters.instructions,
          },
        };
      }),
  };
}

export function generatedContextPreviewSubjectStatePortFromStore(
  store: StructuredSessionStateStore,
): GeneratedContextPreviewSubjectStatePortService {
  return generatedContextPreviewSubjectStatePortFromStructuredSessionState(
    structuredSessionStateFromStore(store),
  );
}

export const makeGeneratedContextPreviewSubjectStatePort = Effect.fn(
  "@svvy/state/makeGeneratedContextPreviewSubjectStatePort",
)(function* () {
  const state = yield* StructuredSessionState;
  return generatedContextPreviewSubjectStatePortFromStructuredSessionState(state);
});

export const layerGeneratedContextPreviewSubjectStatePort = Layer.effect(
  GeneratedContextPreviewSubjectStatePort,
  makeGeneratedContextPreviewSubjectStatePort(),
);

function resolveActorBinding(input: {
  actorKind: ActorBinding["actorKind"];
  registry: NonNullable<
    ReturnType<StructuredSessionStateStore["readExtensionRegistryObservation"]>
  >["observation"]["observations"];
  networkAccess: boolean;
  actorDefaults?: StructuredAgentActorExtensionDefaultsRecord;
  overrides: Readonly<Record<string, ExtensionUsageState>>;
  profileOrder: readonly string[];
  source: ActorBinding["source"];
}): Effect.Effect<ActorBinding, StateContractError> {
  return Effect.gen(function* () {
    const registryById = new Map(input.registry.map((record) => [record.extensionId, record]));
    yield* validateReferences(
      "actor defaults",
      input.actorDefaults?.extensionUsage ?? {},
      registryById,
    );
    yield* validateReferences("subject overrides", input.overrides, registryById);
    yield* validateOrder(
      input.profileOrder.length > 0
        ? input.profileOrder
        : input.actorKind === "handler"
          ? []
          : (input.actorDefaults?.extensionOrder ?? []),
      registryById,
    );

    const states = new Map<ExtensionId, ExtensionUsageState>();
    for (const record of input.registry) {
      let state = record.usagePolicy.baselineUsage[input.actorKind];
      if (input.actorKind !== "handler") {
        state = input.actorDefaults?.extensionUsage[record.extensionId] ?? state;
      }
      state = input.overrides[record.extensionId] ?? state;
      if (!record.usagePolicy.configurable) {
        state = record.usagePolicy.baselineUsage[input.actorKind];
      }
      if (record.usagePolicy.networkAccess === "required" && !input.networkAccess) {
        state = "unavailable";
      }
      states.set(record.extensionId, state);
    }

    const preferredOrder =
      input.profileOrder.length > 0
        ? input.profileOrder
        : input.actorKind === "handler"
          ? []
          : (input.actorDefaults?.extensionOrder ?? []);
    const preferredById = new Map(preferredOrder.map((id, index) => [id, index]));
    const ordered = input.registry
      .map((record) => record.extensionId)
      .toSorted((left, right) => {
        const leftPreferred = preferredById.get(left) ?? Number.MAX_SAFE_INTEGER;
        const rightPreferred = preferredById.get(right) ?? Number.MAX_SAFE_INTEGER;
        if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
        const leftRecord = registryById.get(left)!;
        const rightRecord = registryById.get(right)!;
        return (
          leftRecord.usagePolicy.canonicalOrder - rightRecord.usagePolicy.canonicalOrder ||
          leftRecord.title.localeCompare(rightRecord.title) ||
          left.localeCompare(right)
        );
      });
    const idsFor = (state: ExtensionUsageState) =>
      ordered.filter((extensionId) => states.get(extensionId) === state);
    return {
      actorKind: input.actorKind,
      loadedExtensionIds: idsFor("loaded"),
      availableExtensionIds: idsFor("available"),
      unavailableExtensionIds: idsFor("unavailable"),
      instructionOrder: ordered,
      source: input.source,
    };
  });
}

function validateReferences(
  label: string,
  usage: Readonly<Record<string, ExtensionUsageState>>,
  registryById: ReadonlyMap<string, unknown>,
): Effect.Effect<void, StateContractError> {
  const unknown = Object.keys(usage).filter(
    (id) => !registryById.has(id) && !id.startsWith("external_instruction_"),
  );
  return unknown.length === 0
    ? Effect.void
    : fail(
        "conflict",
        `${label} reference unknown extension ids: ${unknown.toSorted().join(", ")}.`,
      );
}

function validateOrder(
  order: readonly string[],
  registryById: ReadonlyMap<string, unknown>,
): Effect.Effect<void, StateContractError> {
  if (new Set(order).size !== order.length) {
    return fail("conflict", "The subject extension order contains duplicate ids.");
  }
  const unknown = order.filter((id) => !registryById.has(id));
  return unknown.length === 0
    ? Effect.void
    : fail(
        "conflict",
        `The subject extension order references unknown ids: ${unknown.toSorted().join(", ")}.`,
      );
}

function readReasoningEffort(
  reasoning: StructuredAgentProfileRecord["reasoning"],
  profileId: string,
): Effect.Effect<ReasoningEffort, StateContractError> {
  const effort =
    reasoning && typeof reasoning === "object" && !Array.isArray(reasoning)
      ? (reasoning as { effort?: unknown }).effort
      : undefined;
  return typeof effort === "string" && reasoningEfforts.has(effort as ReasoningEffort)
    ? Effect.succeed(effort as ReasoningEffort)
    : fail("conflict", `Configured profile ${profileId} has invalid reasoning settings.`);
}

function validWorkflowAgentParameters(source: StructuredWorkflowAgentSourceIndexRecord) {
  return source.validationStatus === "valid" && source.parameters !== null
    ? Effect.succeed(source.parameters)
    : fail("conflict", `Workflow-agent source ${source.sourceId} is not currently valid.`);
}

function validateIdentity(
  profileId: string,
  profileName: string,
  providerId: string,
  modelId: string,
): Effect.Effect<void, StateContractError> {
  return profileId.length > 0 &&
    profileName.length > 0 &&
    providerId.length > 0 &&
    modelId.length > 0
    ? Effect.void
    : fail("conflict", `Preview subject ${profileId || "<empty>"} has incomplete model identity.`);
}

function fail(
  reason: "not-found" | "conflict",
  message: string,
): Effect.Effect<never, StateContractError> {
  return Effect.fail(
    new StateContractError({
      operation: "generated-context-preview-subject.readSubject",
      reason,
      message,
    }),
  );
}
