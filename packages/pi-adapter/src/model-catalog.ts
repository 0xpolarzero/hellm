import {
  getModels,
  getProviders,
  getSupportedThinkingLevels,
  type KnownProvider,
} from "@mariozechner/pi-ai";
import type { InputModality, ModelInfo, ProviderAuthStatus, ReasoningEffort } from "@svvy/core";
import type { ModelId, ProviderId, WorkspaceId } from "@svvy/core";

export interface ReadPiModelCatalogInput {
  workspaceId: WorkspaceId;
  providerId?: ProviderId;
  authStatuses: readonly ProviderAuthStatus[];
}

export function readPiModelCatalog(input: ReadPiModelCatalogInput): readonly ModelInfo[] {
  const statusByProvider = new Map(input.authStatuses.map((status) => [status.providerId, status]));
  const providerIds = input.providerId
    ? [input.providerId]
    : getProviders().map((provider) => provider as ProviderId);
  return providerIds.flatMap((providerId) =>
    getModels(providerId as string as KnownProvider).map((model) => ({
      providerId,
      modelId: model.id as ModelId,
      displayName: model.name,
      supportsReasoning: model.reasoning,
      supportedReasoning: getSupportedThinkingLevels(model) as ReasoningEffort[],
      inputModalities: [...model.input] as InputModality[],
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxTokens,
      authStatus:
        statusByProvider.get(providerId) ??
        ({
          providerId,
          workspaceId: input.workspaceId,
          health: "missing",
        } satisfies ProviderAuthStatus),
    })),
  );
}
