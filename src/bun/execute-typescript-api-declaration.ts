import { EXECUTE_TYPESCRIPT_API_DECLARATION } from "../../generated/execute-typescript-api.generated";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { SvvyActorKind } from "./actor-capabilities";
import {
  buildUserSvvyxTypescriptDeclaration,
  isSvvyxCommandManifest,
  type SvvyxCommandManifest,
} from "./svvyx-typescript-declarations";
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

export function buildExecuteTypescriptApiDeclaration(
  actor: SvvyActorKind,
  options: {
    extensionsRoot?: string;
    loadedExtensionIds?: readonly string[];
    loadedExtensionRecords?: readonly ExtensionRecord[];
  } = {},
): string {
  const loadedExtensionIds =
    options.loadedExtensionIds ?? resolveActorExtensionState({ actor }).loadedExtensionIds;
  const sections = [EXECUTE_TYPESCRIPT_API_DECLARATION.trim()];
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
  if (input.loadedExtensionRecords.length === 0) {
    return [];
  }
  const loaded = new Set(input.loadedExtensionIds);
  const root = resolveExtensionsRoot(input.extensionsRoot);
  const declarations: string[] = [];
  const seen = new Set<string>();
  for (const record of input.loadedExtensionRecords) {
    if (
      seen.has(record.id) ||
      !loaded.has(record.id) ||
      record.category !== "user" ||
      record.interface !== "svvyx" ||
      !record.typescriptApiEnabled ||
      !isSafeUserExtensionId(record.id)
    ) {
      continue;
    }
    const commandManifest = readMatchingCurrentBuildCommandManifest(root, record.id);
    if (!commandManifest) {
      continue;
    }
    seen.add(record.id);
    declarations.push(
      buildUserSvvyxTypescriptDeclaration({
        commandManifest,
        extensionId: record.id,
      }).trim(),
    );
  }
  return declarations;
}

function isSafeUserExtensionId(extensionId: string): boolean {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(extensionId);
}

function readMatchingCurrentBuildCommandManifest(
  extensionsRoot: string,
  extensionId: string,
): SvvyxCommandManifest | null {
  const manifestPath = join(
    extensionsRoot,
    "builds",
    "extensions",
    extensionId,
    "current",
    "manifest.json",
  );
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    if (
      manifest.schemaVersion === 1 &&
      manifest.extensionId === extensionId &&
      manifest.interface === "svvyx" &&
      typeof manifest.module === "string" &&
      manifest.typescriptTypes ===
        expectedUserSvvyxTypescriptTypesPath(extensionsRoot, extensionId) &&
      isSvvyxCommandManifest(manifest.commandManifest) &&
      Array.isArray(manifest.env) &&
      Array.isArray(manifest.dependencies)
    ) {
      return manifest.commandManifest;
    }
    return null;
  } catch {
    return null;
  }
}

function expectedUserSvvyxTypescriptTypesPath(extensionsRoot: string, extensionId: string): string {
  return join(extensionsRoot, "generated", "extensions", extensionId, "types.d.ts");
}

function resolveExtensionsRoot(extensionsRoot: string | undefined): string {
  return resolve(extensionsRoot ?? join(homedir(), ".config", "svvy", "extensions"));
}
