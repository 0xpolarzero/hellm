import type {
  AmbientAgentResourceCategory,
  AmbientAgentResourceEnablementRecord,
  AmbientAgentResourceHost,
  AmbientAgentResourceScope,
  AmbientAgentResourceSource,
  ExternalInstructionActor,
  AmbientAgentResourcesSettings,
} from "./agent-settings";

export interface AmbientAgentResourceCandidate {
  id: string;
  host: AmbientAgentResourceHost;
  category: AmbientAgentResourceCategory;
  source: AmbientAgentResourceSource;
  scope: AmbientAgentResourceScope;
}

export interface ResolveAmbientAgentResourceBindingsInput {
  settings: AmbientAgentResourcesSettings;
  workspaceKey?: string;
  actor: ExternalInstructionActor;
  profileId?: string;
  candidates: readonly AmbientAgentResourceCandidate[];
}

export interface ResolvedAmbientAgentResourceBinding extends AmbientAgentResourceCandidate {
  enablementId: string;
}

export function resolveAmbientAgentResourceBindings(
  input: ResolveAmbientAgentResourceBindingsInput,
): ResolvedAmbientAgentResourceBinding[] {
  return input.candidates.flatMap((candidate) => {
    if (input.settings.categories[candidate.category]?.enabled !== true) {
      return [];
    }
    const enablement = input.settings.enablements.find(
      (record) =>
        record.enabled &&
        record.host === candidate.host &&
        record.category === candidate.category &&
        sameAmbientScope(record.scope, candidate.scope, input.workspaceKey) &&
        sameAmbientSource(record.source, candidate.source) &&
        record.targets.some((target) => targetMatchesActor(target, input.actor, input.profileId)),
    );
    return enablement ? [{ ...candidate, enablementId: enablement.id }] : [];
  });
}

function sameAmbientScope(
  recordScope: AmbientAgentResourceScope,
  candidateScope: AmbientAgentResourceScope,
  workspaceKey: string | undefined,
): boolean {
  if (recordScope.kind !== candidateScope.kind) return false;
  if (recordScope.kind === "app") return true;
  if (candidateScope.kind !== "workspace") return false;
  return (
    recordScope.workspaceKey === candidateScope.workspaceKey &&
    workspaceKey === candidateScope.workspaceKey
  );
}

function sameAmbientSource(
  recordSource: AmbientAgentResourceSource,
  candidateSource: AmbientAgentResourceSource,
): boolean {
  return (
    recordSource.kind === candidateSource.kind &&
    recordSource.id === candidateSource.id &&
    (recordSource.path ?? "") === (candidateSource.path ?? "")
  );
}

function targetMatchesActor(
  target: AmbientAgentResourceEnablementRecord["targets"][number],
  actor: ExternalInstructionActor,
  profileId: string | undefined,
): boolean {
  return target.actor === actor && target.profileId === profileId;
}
