import { EXECUTE_TYPESCRIPT_API_DECLARATION } from "../../generated/execute-typescript-api.generated";
import { existsSync } from "node:fs";
import type { SvvyActorKind } from "./actor-capabilities";
import { resolveActorExtensionState } from "../shared/extensions";
import type { ExtensionRecord } from "../shared/extensions";

const ARTIFACTS_CLIENT_DECLARATION = `
type ArtifactsArtifactRef = {
  id: string;
  path: string;
  name: string;
  immutable: boolean;
  mimeType: string;
  bytes: number;
  sha256: string;
  createdAt: string;
};

type ArtifactsRunResult<T> = {
  ok: true;
  data: T;
  output: T;
  meta: {
    commandFacts: Record<string, unknown>;
  };
};

type ArtifactsCommandMap = {
  create: {
    input: {
      options:
        | { name: string; path?: never; immutable?: boolean; mimeType?: string }
        | { path: string; name?: string; immutable?: boolean; mimeType?: string };
    };
    result: ArtifactsRunResult<ArtifactsArtifactRef>;
  };
  inspect: {
    input: { options: { id: string } };
    result: ArtifactsRunResult<ArtifactsArtifactRef>;
  };
  list: {
    input: { options?: { threadId?: string; limit?: number } };
    result: ArtifactsRunResult<{ artifacts: ArtifactsArtifactRef[] }>;
  };
  open: {
    input: { options: { id: string } };
    result: ArtifactsRunResult<{ id: string; opened: true }>;
  };
  delete: {
    input: { options: { id: string } };
    result: ArtifactsRunResult<{ id: string; deleted: true }>;
  };
};

interface ArtifactsExtensionClient {
  run<CommandId extends keyof ArtifactsCommandMap>(
    commandId: CommandId,
    input: ArtifactsCommandMap[CommandId]["input"],
  ): Promise<ArtifactsCommandMap[CommandId]["result"]>;
}

interface LoadedExtensionsClient {
  artifacts: ArtifactsExtensionClient;
}
`.trim();

const WORKFLOWS_CLIENT_DECLARATION = `
type WorkflowsKind = "agent" | "prompt" | "component" | "workflow";

type WorkflowsDiagnostic = {
  code: string;
  message: string;
  path?: string;
  exportName?: string;
};

type WorkflowsListItem = {
  kind: WorkflowsKind;
  namespace: "Agents" | "Prompts" | "Components" | "Workflows";
  exportName: string;
  qualifiedName: string;
  sourcePath: string;
  generatedPath: string;
};

type WorkflowsModelChoice = {
  providerId: string;
  modelId: string;
  providerAuthenticated: boolean;
  authSource: "apikey" | "oauth" | "env" | "missing";
  supportedReasoning: string[];
  capabilities: {
    reasoning: boolean;
    vision: boolean;
    toolCalling: boolean;
  };
};

type WorkflowsRunResult<T> = {
  ok: true;
  data: T;
  output: T;
  meta: {
    commandFacts: Record<string, unknown>;
  };
};

type WorkflowsCommandMap = {
  list: {
    input: { options?: { kind?: WorkflowsKind } };
    result: WorkflowsRunResult<{ items: WorkflowsListItem[] }>;
  };
  save: {
    input: {
      options: {
        from: string;
        kind: WorkflowsKind;
        as: string;
        export?: string;
        overwrite?: boolean;
      };
    };
    result: WorkflowsRunResult<{
      ok: true;
      sourcePath: string;
      generatedPackagePath: string;
      exportName: string;
      kind: WorkflowsKind;
      diagnostics: WorkflowsDiagnostic[];
      linkedWorkspaces: string[];
    }>;
  };
  build: {
    input: { options?: Record<string, never> };
    result: WorkflowsRunResult<{
      ok: true;
      generatedPackagePath: string;
      diagnostics: WorkflowsDiagnostic[];
      linkedWorkspaces: string[];
      items: WorkflowsListItem[];
    }>;
  };
  "models list": {
    input: { options?: Record<string, never> };
    result: WorkflowsRunResult<{ items: WorkflowsModelChoice[] }>;
  };
};

interface WorkflowsExtensionClient {
  run<CommandId extends keyof WorkflowsCommandMap>(
    commandId: CommandId,
    input: WorkflowsCommandMap[CommandId]["input"],
  ): Promise<WorkflowsCommandMap[CommandId]["result"]>;
}

interface LoadedExtensionsClient {
  workflows: WorkflowsExtensionClient;
}
`.trim();

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

const SVVY_EXTENSIONS_IMPORT_MODULE_DECLARATION = `
declare module "@svvy/extensions" {
  export const Extensions: unknown;
  export type ExtensionId = string;
}
`.trim();

const SVVY_WORKFLOWS_IMPORT_MODULE_DECLARATION = `
declare module "@svvy/workflows" {
  export const Agents: unknown;
  export const Components: unknown;
  export const Prompts: unknown;
  export const Workflows: unknown;
}
`.trim();

export function buildExecuteTypescriptApiDeclaration(
  actor: SvvyActorKind,
  options: {
    extensionsRoot?: string;
    loadedExtensionIds?: readonly string[];
    loadedExtensionRecords?: readonly ExtensionRecord[];
    workflowsExtensionsGeneratedPackagePath?: string;
    workflowsGeneratedPackagePath?: string;
  } = {},
): string {
  const loadedExtensionIds =
    options.loadedExtensionIds ?? resolveActorExtensionState({ actor }).loadedExtensionIds;
  const sections = [
    EXECUTE_TYPESCRIPT_API_DECLARATION.trim(),
    EXECUTE_TYPESCRIPT_IMPORT_MODULE_DECLARATIONS,
  ];
  if (generatedPackageAvailable(options.workflowsExtensionsGeneratedPackagePath)) {
    sections.push(SVVY_EXTENSIONS_IMPORT_MODULE_DECLARATION);
  }
  if (generatedPackageAvailable(options.workflowsGeneratedPackagePath)) {
    sections.push(SVVY_WORKFLOWS_IMPORT_MODULE_DECLARATION);
  }
  if (loadedExtensionIds.includes("artifacts")) {
    sections.push(ARTIFACTS_CLIENT_DECLARATION);
  }
  if (loadedExtensionIds.includes("workflows")) {
    sections.push(WORKFLOWS_CLIENT_DECLARATION);
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
  loadedExtensionIds: readonly string[];
  loadedExtensionRecords: readonly ExtensionRecord[];
}): string[] {
  void input;
  return [];
}

function generatedPackageAvailable(packagePath: string | undefined): boolean {
  return Boolean(packagePath && existsSync(packagePath));
}
