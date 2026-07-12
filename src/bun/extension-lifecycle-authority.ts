import * as BunCrypto from "@effect/platform-bun/BunCrypto";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { AbsolutePath, SvvyxRuntimeEffectTransportRequest } from "@svvy/core";
import {
  addExtensionInstruction,
  configureExtensionInstruction,
  configureExtensionTypescriptApi,
  createExtensionSource,
  deleteExtensionSource,
  duplicateExtensionSource,
  layerExtensionSourceRootsPort,
  layerPackagedExtensionTemplatesPort,
  removeExtensionInstruction,
  renameExtensionInstruction,
  reorderExtensionInstructions,
  revertExtensionSourceMutation,
  resetExtensionInstructions,
} from "@svvy/extensions";

import type { SvvyxExtensionsLifecycleAdapter } from "./svvyx-extensions-command";

type ExtensionSourceReconcileRequest = Extract<
  SvvyxRuntimeEffectTransportRequest,
  { readonly type: "extension_source.reconcile" }
>;

export function createPackageBackedExtensionLifecycleAdapter(input: {
  readonly extensionsRoot: string;
  readonly onRuntimeEffectRequest: (request: SvvyxRuntimeEffectTransportRequest) => void;
  readonly packagedExtensionTemplatesRoot: string;
}): SvvyxExtensionsLifecycleAdapter {
  const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer, BunCrypto.layer);
  const roots = layerExtensionSourceRootsPort({
    extensionsRoot: input.extensionsRoot as AbsolutePath,
    workflowsSourceRoot: input.extensionsRoot as AbsolutePath,
  });
  const templates = layerPackagedExtensionTemplatesPort({
    builtinExtensionsRoot: input.packagedExtensionTemplatesRoot as AbsolutePath,
  });
  const run = <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(platform),
        Effect.provide(roots),
        Effect.provide(templates),
      ) as Effect.Effect<A, E>,
    );
  const reconcile = (
    receipt: {
      readonly action: ExtensionSourceReconcileRequest["input"]["action"];
      readonly mutationId: string | null;
    },
    extensionIds: ExtensionSourceReconcileRequest["input"]["extensionIds"],
  ) => {
    if (!receipt.mutationId) return;
    input.onRuntimeEffectRequest({
      type: "extension_source.reconcile",
      input: {
        action: receipt.action,
        extensionIds: [...extensionIds],
        mutationId: receipt.mutationId,
      },
      target: "extension_lifecycle",
    });
  };
  return {
    create: async (request) => {
      const receipt = await run(createExtensionSource(request));
      reconcile(receipt, [receipt.extensionId]);
      return receipt;
    },
    duplicate: async (request) => {
      const receipt = await run(duplicateExtensionSource(request));
      reconcile(receipt, [receipt.sourceExtensionId, receipt.extensionId]);
      return receipt;
    },
    delete: async (request) => {
      const receipt = await run(deleteExtensionSource(request));
      reconcile(receipt, [receipt.extensionId]);
      return receipt;
    },
    reset: async (request) => {
      const receipt = await run(resetExtensionInstructions(request));
      reconcile(receipt, [receipt.extensionId]);
      if (receipt.changed) {
        input.onRuntimeEffectRequest({
          type: "extension_build.request",
          input: {
            extensionId: receipt.extensionId,
            mutationId: receipt.mutationId,
            reason: "reset",
          },
          target: "extension_lifecycle",
        });
      }
      return {
        source: receipt,
        automaticBuild: receipt.changed
          ? { status: "scheduled" }
          : { status: "skipped", reason: "source-unchanged" },
      };
    },
    addInstruction: async (request) => {
      const receipt = await run(addExtensionInstruction(request));
      reconcile(receipt, [receipt.extensionId]);
      return receipt;
    },
    removeInstruction: async (request) => {
      const receipt = await run(removeExtensionInstruction(request));
      reconcile(receipt, [receipt.extensionId]);
      return receipt;
    },
    configureInstruction: async (request) => {
      const receipt = await run(configureExtensionInstruction(request));
      reconcile(receipt, [receipt.extensionId]);
      return receipt;
    },
    renameInstruction: async (request) => {
      const receipt = await run(renameExtensionInstruction(request));
      reconcile(receipt, [receipt.extensionId]);
      return receipt;
    },
    reorderInstructions: async (request) => {
      const receipt = await run(reorderExtensionInstructions(request));
      reconcile(receipt, [receipt.extensionId]);
      return receipt;
    },
    revertMutation: async (request) => {
      const receipt = await run(revertExtensionSourceMutation(request));
      reconcile(receipt, [receipt.extensionId]);
      return {
        source: receipt,
        automaticBuild: { status: "not-started", failureReason: "unknown" },
      };
    },
    configureTypescriptApi: async (request) => await run(configureExtensionTypescriptApi(request)),
  };
}
