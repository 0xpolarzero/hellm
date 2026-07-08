import { EXECUTE_TYPESCRIPT_API_DECLARATION } from "../../generated/execute-typescript-api.generated";
import type { SvvyActorKind } from "./actor-capabilities";
import {
  buildExecuteTypescriptFacadeDeclarations,
  resolveActorExtensionState,
} from "@svvy/extensions";
import type { ExtensionId } from "@svvy/core";
import type { ExtensionRecord } from "@svvy/extensions";
export { ARTIFACTS_FACADE_DECLARATION, WORKFLOWS_FACADE_DECLARATION } from "@svvy/extensions";

const EXECUTE_TYPESCRIPT_IMPORT_MODULE_DECLARATIONS = `
declare module "incur/client" {
  export namespace Client {
    class ClientError extends Error {
      name: string;
      shortMessage: string;
      details?: string;
      code: string | undefined;
      data: unknown | undefined;
      error: unknown | undefined;
      fieldErrors: unknown[] | undefined;
      meta: IncurRpcMeta | undefined;
      retryable: boolean | undefined;
      status: number | undefined;
    }
  }

  export const Resources: Record<string, unknown>;
  export const Run: Record<string, unknown>;
}

declare module "incur" {
  export const Cli: unknown;
  export const z: unknown;
}
`.trim();

export function buildExecuteTypescriptApiDeclaration(
  actor: SvvyActorKind,
  options: {
    extensionsRoot?: string;
    loadedExtensionIds?: readonly string[];
    loadedExtensionRecords?: readonly ExtensionRecord[];
  } = {},
): string {
  const loadedExtensionIds = toExtensionIds(
    options.loadedExtensionIds ?? resolveActorExtensionState({ actor }).loadedExtensionIds,
  );
  const facadeDeclarations = buildExecuteTypescriptFacadeDeclarations({
    actorKind: actor,
    actorBinding: {
      actorKind: actor,
      loadedExtensionIds,
      availableExtensionIds: [],
      unavailableExtensionIds: [],
      instructionOrder: loadedExtensionIds,
      source: "surface-binding",
    },
  });
  const sections = [
    EXECUTE_TYPESCRIPT_API_DECLARATION.trim(),
    EXECUTE_TYPESCRIPT_IMPORT_MODULE_DECLARATIONS,
  ];
  if (facadeDeclarations.text.length > 0) {
    sections.push(facadeDeclarations.text);
  }
  sections.push(
    ...buildLoadedUserExtensionDeclarations({
      extensionsRoot: options.extensionsRoot,
      loadedExtensionIds,
      loadedExtensionRecords: options.loadedExtensionRecords ?? [],
    }),
  );
  return sections.join("\n\n");
}

function buildLoadedUserExtensionDeclarations(input: {
  extensionsRoot?: string;
  loadedExtensionIds: readonly ExtensionId[];
  loadedExtensionRecords: readonly ExtensionRecord[];
}): string[] {
  void input;
  return [];
}

function toExtensionIds(values: readonly string[]): readonly ExtensionId[] {
  return values.map((value) => value as ExtensionId);
}
