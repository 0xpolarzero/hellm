import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  PiAdapterError,
  ProviderAuthStatusStatePort,
  type ListModelsInput,
  type ModelInfo,
  type ProviderAuthStatusStatePortService,
} from "@svvy/core";
import { readPiModelCatalog } from "./model-catalog";

export interface PiAdapterModelsService {
  list(input: ListModelsInput): Effect.Effect<readonly ModelInfo[], PiAdapterError>;
}

export interface PiAdapterService {
  models: PiAdapterModelsService;
}

export class PiAdapter extends Context.Service<PiAdapter, PiAdapterService>()(
  "@svvy/pi-adapter/PiAdapter",
) {}

export const makePiAdapter = Effect.fn("@svvy/pi-adapter/makePiAdapter")(() =>
  Effect.gen(function* () {
    const providerAuthStatus = yield* ProviderAuthStatusStatePort;
    return PiAdapter.of({
      models: {
        list: (input) => listModels(providerAuthStatus, input),
      },
    });
  }),
);

export const layer = Layer.effect(PiAdapter, makePiAdapter());

function listModels(
  providerAuthStatus: ProviderAuthStatusStatePortService,
  input: ListModelsInput,
): Effect.Effect<readonly ModelInfo[], PiAdapterError> {
  return providerAuthStatus.listProviderStatuses({ workspaceId: input.workspaceId }).pipe(
    Effect.map((authStatuses) =>
      readPiModelCatalog({
        workspaceId: input.workspaceId,
        ...(input.providerId ? { providerId: input.providerId } : {}),
        authStatuses,
      }),
    ),
    Effect.mapError(
      (cause) =>
        new PiAdapterError({
          operation: "pi-adapter.models.list",
          reason: "provider-auth-failed",
          message: cause.message,
          cause,
        }),
    ),
  );
}
