import type {
  BuildExecuteTypescriptFacadeDeclarationsInput,
  ExecuteTypescriptFacadeDeclarations,
  ExtensionId,
} from "@svvy/core";
import { BUILTIN_EXTENSIONS, type ExtensionRecord, getExtensionRecord } from "./extension-records";

export const ARTIFACTS_FACADE_DECLARATION = `
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

type ArtifactsCommandMap = {
  create: {
    input: {
      options:
        | { name: string; path?: never; immutable?: boolean; mimeType?: string }
        | { path: string; name?: string; immutable?: boolean; mimeType?: string };
    };
    result: Run.Result<ArtifactsArtifactRef>;
  };
  inspect: {
    input: { options: { id: string } };
    result: Run.Result<ArtifactsArtifactRef>;
  };
  list: {
    input: { options?: { threadId?: string; limit?: number } };
    result: Run.Result<{ artifacts: ArtifactsArtifactRef[] }>;
  };
  open: {
    input: { options: { id: string } };
    result: Run.Result<{ id: string; intent: "open_artifact_inspector"; accepted: true }>;
  };
  delete: {
    input: { options: { id: string } };
    result: Run.Result<{ id: string; deleted: true }>;
  };
};

interface ArtifactsExtensionFacade {
  run<CommandId extends keyof ArtifactsCommandMap>(
    commandId: CommandId,
    input: ArtifactsCommandMap[CommandId]["input"],
  ): Promise<ArtifactsCommandMap[CommandId]["result"]>;
}

interface LoadedExtensionsFacade {
  artifacts: ArtifactsExtensionFacade;
}
`.trim();

export const WORKFLOWS_FACADE_DECLARATION = `
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

type WorkflowsCommandMap = {
  list: {
    input: { options?: { kind?: WorkflowsKind } };
    result: Run.Result<{ items: WorkflowsListItem[] }>;
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
    result: Run.Result<{
      ok: true;
      sourcePath: string;
      generatedPackagePath: string;
      exportName: string;
      kind: WorkflowsKind;
      diagnostics: WorkflowsDiagnostic[];
    }>;
  };
  build: {
    input: { options?: Record<string, never> };
    result: Run.Result<{
      ok: true;
      generatedPackagePath: string;
      diagnostics: WorkflowsDiagnostic[];
      items: WorkflowsListItem[];
    }>;
  };
  "models list": {
    input: { options?: Record<string, never> };
    result: Run.Result<{ items: WorkflowsModelChoice[] }>;
  };
};

interface WorkflowsExtensionFacade {
  run<CommandId extends keyof WorkflowsCommandMap>(
    commandId: CommandId,
    input: WorkflowsCommandMap[CommandId]["input"],
  ): Promise<WorkflowsCommandMap[CommandId]["result"]>;
}

interface LoadedExtensionsFacade {
  workflows: WorkflowsExtensionFacade;
}
`.trim();

const FACADE_DECLARATIONS_BY_EXTENSION_ID = new Map<string, string>([
  ["artifacts", ARTIFACTS_FACADE_DECLARATION],
  ["workflows", WORKFLOWS_FACADE_DECLARATION],
]);

const BUILTIN_TYPESCRIPT_FACADE_IDS: ReadonlySet<string> = new Set(
  BUILTIN_EXTENSIONS.filter(
    (record) => record.interface === "svvyx" && record.typescriptApiEnabled,
  ).map((record) => record.id),
);

export function buildExecuteTypescriptFacadeDeclarations(
  input: BuildExecuteTypescriptFacadeDeclarationsInput,
): ExecuteTypescriptFacadeDeclarations {
  const loadedRecords = input.actorBinding.loadedExtensionIds.flatMap((extensionId) => {
    const record = getExtensionRecord(extensionId);
    return record ? [record] : [];
  });
  const emittedRecords = loadedRecords.filter(isBuiltinTypescriptFacadeRecord);
  return {
    text: emittedRecords
      .map((record) => FACADE_DECLARATIONS_BY_EXTENSION_ID.get(record.id) ?? "")
      .filter((section) => section.length > 0)
      .join("\n\n"),
    emittedExtensionIds: emittedRecords.map((record) => record.id as ExtensionId),
  };
}

function isBuiltinTypescriptFacadeRecord(record: ExtensionRecord): boolean {
  return (
    BUILTIN_TYPESCRIPT_FACADE_IDS.has(record.id) &&
    record.interface === "svvyx" &&
    record.typescriptApiEnabled
  );
}
