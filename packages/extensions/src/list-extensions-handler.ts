import * as Effect from "effect/Effect";
import type { ExtensionError, ExtensionHandlerResult } from "@svvy/core";
import { ExtensionError as CoreExtensionError } from "@svvy/core";
import type { ActorExtensionBinding } from "./extensions-service";
import {
  type ExtensionExternalInstructionSource,
  type ExtensionRecord,
  type SvvyActorKind,
  visibleExtensionRecords,
} from "./extension-records";
import type { ExtensionHandler, ExtensionInvocation } from "./native-tool-handler-contracts";

export type ListExtensionsDetails = ReturnType<typeof visibleExtensionRecords>;

export type ListExtensionsInput = {
  actor?: SvvyActorKind;
  loadedExtensionIds: readonly string[];
  availableExtensionIds: readonly string[];
  loadedExtensionRecords?: readonly ExtensionRecord[];
  availableExtensionRecords?: readonly ExtensionRecord[];
  externalInstructionSources?: readonly ExtensionExternalInstructionSource[];
};

export type ListExtensionsHandlerInvocation = ExtensionInvocation & {
  toolName: "list_extensions";
  actorBinding: ActorExtensionBinding & {
    loadedExtensionRecords?: readonly ExtensionRecord[];
    availableExtensionRecords?: readonly ExtensionRecord[];
    externalInstructionSources?: readonly ExtensionExternalInstructionSource[];
  };
};

export function listExtensionsForActor(input: ListExtensionsInput): ListExtensionsDetails {
  return visibleExtensionRecords(input);
}

export function summarizeListExtensions(details: ListExtensionsDetails): string {
  const loaded = details.loaded.map((extension) => extension.id).join(", ") || "none";
  const available = details.available.map((extension) => extension.id).join(", ") || "none";
  return `Loaded extensions: ${loaded}\nAvailable extensions: ${available}`;
}

export function createListExtensionsHandler(): ExtensionHandler<ListExtensionsHandlerInvocation> {
  return {
    invoke: (input) =>
      Effect.try({
        try: (): ExtensionHandlerResult => {
          const details = listExtensionsForActor({
            actor: input.context.surfaceKind,
            loadedExtensionIds: input.actorBinding.loadedExtensionIds,
            availableExtensionIds: input.actorBinding.availableExtensionIds,
            ...(input.actorBinding.loadedExtensionRecords
              ? { loadedExtensionRecords: input.actorBinding.loadedExtensionRecords }
              : {}),
            ...(input.actorBinding.availableExtensionRecords
              ? { availableExtensionRecords: input.actorBinding.availableExtensionRecords }
              : {}),
            ...(input.actorBinding.externalInstructionSources
              ? { externalInstructionSources: input.actorBinding.externalInstructionSources }
              : {}),
          });
          const summary = summarizeListExtensions(details);
          return {
            result: {
              content: [{ type: "text", text: summary }],
              details: {
                status: "succeeded",
                summary,
                commandFacts: {
                  loadedExtensionIds: details.loaded.map((extension) => extension.id),
                  availableExtensionIds: details.available.map((extension) => extension.id),
                },
              },
            },
          };
        },
        catch: (cause): ExtensionError =>
          new CoreExtensionError({
            operation: "extensions.native-tools.list_extensions",
            reason: "invalid-input",
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }),
  };
}

export const listExtensionsHandler = createListExtensionsHandler();
