import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import type { SvvyActorKind } from "./actor-capabilities";
import type { AgentSettingsStore } from "./agent-settings-store";
import {
  ExtensionDependencyApprovalStore,
  extensionDependencyIdentityFromDeclaration,
  type ExtensionDependencyBlockedOperation,
  type ExtensionDependencyApprovalRequest,
  type ExtensionDependencyApprovalIdentity,
} from "./extension-dependency-approval-store";
import type { ExtensionEnvSecretKey, ExtensionEnvSecretStore } from "./extension-env-secret-store";
import type { GeneratedAgentContextExternalSource } from "../shared/generated-agent-context";
import { refreshGeneratedExtensionsPackage } from "./generated-extensions-package";
import type { StructuredSessionStateStore } from "./structured-session-state";
import {
  DEFAULT_AGENT_SETTINGS_STATE,
  DEFAULT_ORCHESTRATOR_PROFILE_ID,
  DEFAULT_THREAD_HANDLER_PROFILE_ID,
  type ExternalInstructionActor,
  type AgentProfileSettings,
  type ExtensionEnvValues,
  type WorkflowAgentSettings,
} from "../shared/agent-settings";
import {
  BUILTIN_EXTENSIONS,
  builtinDefaultExtensionOrder,
  builtinDefaultExtensionUsageState,
  externalInstructionExtensionId,
  getExtensionRecord,
  resolveActorExtensionState,
  type ExtensionCliRequirement,
  type ExtensionGeneratedInstruction,
  type ExtensionInstructionFile,
  type ExtensionRecord,
  type ExtensionUsageState,
} from "../shared/extensions";
import type {
  ExtensionDefaultUsageReadModel,
  ExtensionChangeCardReadModel,
  ExtensionGeneratedReadonlyBlockReadModel,
  ExtensionInstructionFileReadModel,
  ExtensionInventoryItemReadModel,
  ExtensionLoadedInstructionContributorReadModel,
  ExtensionSnapshotReadModel,
  ExtensionToolingReadModel,
  ExtensionUsageReadiness,
  ExtensionsInventoryReadModel,
} from "../shared/workspace-contract";
import {
  buildUserSvvyxTypescriptDeclaration,
  type SvvyxCommandManifest,
  type SvvyxCommandManifestEntry,
} from "./svvyx-typescript-declarations";
import {
  assertFileBackedSaveAllowed,
  fileBackedTextVersion,
  readFileBackedVersion,
  writeTextFileAtomically,
} from "./file-backed-resource";
import { countPromptTokens } from "./token-count";
import {
  ARTIFACTS_CLIENT_DECLARATION,
  WORKFLOWS_CLIENT_DECLARATION,
} from "./execute-typescript-api-declaration";
import { builtinLoadedInstructionDefaults } from "./default-system-prompt";
import { buildNativeToolSchemaJsonForExtension } from "./native-tool-schemas";

export type CliRequirementStatus = {
  id: string;
  binary: string;
  package: string | null;
  required: boolean;
  defaultVersion: string | null;
  currentVersion: string | null;
  latestVersion: string | null;
  status: "available" | "missing" | "unknown";
  updateAvailable: boolean;
  detectedVersion: string | null;
  path: string | null;
  versionCommand: string | null;
  installCommand: string | null;
  updateCommand: string | null;
};

type ExtensionIssue = {
  code:
    | "BUILD_REQUIRED"
    | "CLI_MISSING"
    | "CLI_STATUS_UNKNOWN"
    | "DEPENDENCY_APPROVAL_REQUIRED"
    | "DEPENDENCY_INSTALL_MISSING"
    | "EXTENSION_ENV_MISSING"
    | "NO_CURRENT_BUILD";
  message: string;
};

export type ResolvedExtensionRecord = ExtensionRecord & {
  dependencies?: readonly ExtensionDependencyDeclaration[];
  envDeclarations?: readonly ExtensionEnvDeclaration[];
  extensionBuildFingerprint?: string | null;
  sourceRoot?: string;
  trustedDependencies?: readonly ExtensionDependencyDeclaration[];
};

type ExtensionDependencyDeclaration = {
  kind: "dependency" | "trusted_dependency";
  name: string;
  version: string;
};

type ExtensionEnvDeclaration = {
  default?: string;
  description: string;
  name: string;
  required: boolean;
  secret: boolean;
};

type EnvRequirementStatus = {
  description: string;
  name: string;
  required: boolean;
  secret: boolean;
  status: "configured" | "defaulted" | "missing" | "optional_missing";
};

type DependencyRequirementStatus = {
  approval: "approved" | "needs_user_confirmation" | "unknown";
  approvalRequestId?: string;
  integrity: string | null;
  install: "installed" | "missing" | "unknown";
  kind: "dependency" | "trusted_dependency";
  name: string;
  packageManager: "bun";
  resolution: string | null;
  source: "npm";
  version: string;
};

type EditableExtensionPaths = {
  buildCurrent: string;
  externalInstructionFile: null;
  extensionSource: string | null;
  generatedRoot: string;
  instructionsFullDir: string;
  instructionsMinimal: string;
  lockfile: string;
  manifest: string;
  packageJson: string;
  sourceRoot: string;
  typescriptTypes: string | null;
};

type EditableInstructionPaths = EditableExtensionPaths & {
  instructionsFull: InstructionFileView[];
};

type InstructionFileView = {
  bypassed: boolean;
  name: string;
  path: string;
};

export type SvvyxExtensionsCliProbe = (
  requirement: ExtensionCliRequirement,
) => CliRequirementStatus | Promise<CliRequirementStatus>;

type SvvyxExtensionsDependencyInstallResult =
  | {
      ok: true;
      command: string[];
      packageProject: string;
    }
  | {
      ok: false;
      command: string[];
      error: {
        code: "DEPENDENCY_INSTALL_FAILED";
        message: string;
        exitCode: number | null;
        stderr: string;
      };
      packageProject: string;
    };

export type SvvyxExtensionsDependencyInstaller = (input: {
  dependencies: readonly ExtensionDependencyApprovalIdentity[];
  packageProject: string;
  trustedDependencies: readonly ExtensionDependencyApprovalIdentity[];
}) => SvvyxExtensionsDependencyInstallResult | Promise<SvvyxExtensionsDependencyInstallResult>;

export type SvvyxExtensionsCommandResult = {
  output: unknown;
  commandFacts: Record<string, unknown>;
};

export async function runSvvyxExtensionsCommand(input: {
  agentSettingsStore?: AgentSettingsStore;
  buildRoot?: string;
  cliProbe?: SvvyxExtensionsCliProbe;
  command: string;
  cwd?: string;
  dependencyApprovalStore?: ExtensionDependencyApprovalStore;
  dependencyInstaller?: SvvyxExtensionsDependencyInstaller;
  env?: NodeJS.ProcessEnv;
  envSecretStore?: ExtensionEnvSecretStore;
  externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
  extensionsRoot?: string;
  structuredSessionStore?: StructuredSessionStateStore;
}): Promise<SvvyxExtensionsCommandResult> {
  const words = splitCommandLine(input.command);
  if (words[0] !== "svvyx" || words[1] !== "extensions") {
    throw extensionsCommandError("invalid_argument", "Expected svvyx extensions command.");
  }
  if (hasShellControlSyntax(input.command)) {
    throw extensionsCommandError(
      "invalid_argument",
      "svvyx extensions commands must be invoked as a standalone command.",
    );
  }

  const commandId = words[2];
  if (!commandId) {
    throw extensionsCommandError("invalid_argument", "Missing Extension Managing command.");
  }
  if (commandId === "inspect") {
    return await runInspectCommand(words.slice(3), input);
  }
  if (commandId === "create") {
    return runCreateCommand(words.slice(3), input);
  }
  if (commandId === "duplicate") {
    return runDuplicateCommand(words.slice(3), input);
  }
  if (commandId === "configure") {
    return runConfigureCommand(words.slice(3), input);
  }
  if (commandId === "instructions") {
    return runInstructionsCommand(words.slice(3), input);
  }
  if (commandId === "build") {
    return await runBuildCommand(words.slice(3), input);
  }
  if (commandId === "set-usage") {
    return runSetUsageCommand(words.slice(3), input);
  }
  if (commandId === "defaults") {
    return runDefaultsCommand(words.slice(3), input);
  }
  if (commandId === "delete") {
    return runDeleteCommand(words.slice(3), input);
  }
  if (commandId === "reset") {
    return await runResetCommand(words.slice(3), input);
  }
  if (commandId === "revert") {
    return await runRevertCommand(words.slice(3), input);
  }
  if (commandId === "snapshots") {
    return await runSnapshotsCommand(words.slice(3), input);
  }
  throw extensionsCommandError(
    "unsupported_command",
    `Unsupported Extension Managing command: ${commandId}`,
  );
}

export async function approveExtensionDependencyRequest(input: {
  requestId: string;
  agentSettingsStore?: AgentSettingsStore;
  buildRoot?: string;
  cliProbe?: SvvyxExtensionsCliProbe;
  cwd?: string;
  dependencyApprovalStore?: ExtensionDependencyApprovalStore;
  dependencyInstaller?: SvvyxExtensionsDependencyInstaller;
  env?: NodeJS.ProcessEnv;
  envSecretStore?: ExtensionEnvSecretStore;
  extensionsRoot?: string;
  structuredSessionStore?: StructuredSessionStateStore;
}): Promise<{
  ok: true;
  request: ExtensionDependencyApprovalRequest;
  resumed: Array<{
    operationId: string;
    blockedOperation: ExtensionDependencyBlockedOperation["blockedOperation"];
    status: "resumed" | "blocked" | "obsolete";
    result: unknown;
  }>;
}> {
  const dependencyApprovalStore = resolveExtensionDependencyApprovalStore(input);
  const pendingOperations = dependencyApprovalStore
    .listBlockedOperations(input.requestId)
    .filter((operation) => operation.status === "pending");
  const request = dependencyApprovalStore.approveRequest(input.requestId);
  const root = resolve(input.extensionsRoot ?? defaultExtensionsRoot());
  const resumed: Array<{
    operationId: string;
    blockedOperation: ExtensionDependencyBlockedOperation["blockedOperation"];
    status: "resumed" | "blocked" | "obsolete";
    result: unknown;
  }> = [];

  for (const operation of pendingOperations) {
    let result: SvvyxExtensionsCommandResult;
    if (operation.blockedOperation === "snapshot_load" && operation.snapshotId) {
      const currentFingerprint = snapshotResumeFingerprint(root);
      if (operation.resumeFingerprint && operation.resumeFingerprint !== currentFingerprint) {
        dependencyApprovalStore.markBlockedOperation({
          operationId: operation.operationId,
          status: "obsolete",
        });
        resumed.push({
          operationId: operation.operationId,
          blockedOperation: operation.blockedOperation,
          status: "obsolete",
          result: {
            ok: false,
            error: {
              code: "SNAPSHOT_RESUME_CONFLICT",
              message:
                "Snapshot load dependency approval cannot resume because restored extension state changed after the pause.",
              snapshotId: operation.snapshotId,
            },
          },
        });
        continue;
      }
      result = await loadExtensionSnapshot(root, operation.snapshotId, {
        ...input,
        dependencyApprovalStore,
        extensionsRoot: root,
      });
    } else {
      result = await resumeDependencyApprovedBuilds(operation, {
        ...input,
        dependencyApprovalStore,
        extensionsRoot: root,
      });
    }
    const output = result.output;
    if (dependencyApprovalPausedOutput(output)) {
      dependencyApprovalStore.markBlockedOperation({
        operationId: operation.operationId,
        status:
          typeof output.approvalRequestId === "string" &&
          output.approvalRequestId !== input.requestId
            ? "obsolete"
            : "resumed",
      });
      resumed.push({
        operationId: operation.operationId,
        blockedOperation: operation.blockedOperation,
        status: "blocked",
        result: output,
      });
      continue;
    }
    dependencyApprovalStore.markBlockedOperation({
      operationId: operation.operationId,
      status: "resumed",
    });
    resumed.push({
      operationId: operation.operationId,
      blockedOperation: operation.blockedOperation,
      status: "resumed",
      result: output,
    });
  }

  return {
    ok: true,
    request,
    resumed,
  };
}

export function rejectExtensionDependencyRequest(input: {
  requestId: string;
  dependencyApprovalStore?: ExtensionDependencyApprovalStore;
  extensionsRoot?: string;
}): {
  ok: true;
  request: ExtensionDependencyApprovalRequest;
  rejectedOperations: ExtensionDependencyBlockedOperation[];
} {
  const dependencyApprovalStore = resolveExtensionDependencyApprovalStore(input);
  const request = dependencyApprovalStore.rejectRequest(input.requestId);
  return {
    ok: true,
    request,
    rejectedOperations: dependencyApprovalStore.listBlockedOperations(input.requestId),
  };
}

export function writeExtensionInstructionFile(input: {
  baseSourceVersion?: string;
  content: string;
  extensionId: string;
  extensionsRoot?: string;
  file: string;
  kind?: "full" | "minimal" | "script";
  mode?: "compare-and-swap" | "overwrite";
}): {
  ok: true;
  extensionId: string;
  file: string;
  path: string;
  sourceVersion: string;
} {
  const extension = requireEditableInstructionsExtension(input.extensionId, {
    extensionsRoot: input.extensionsRoot,
  });
  const paths = editableExtensionInspectPaths(extension, input.extensionsRoot);
  if (input.kind === "script") {
    const generatedInstruction = (extension.generatedInstructions ?? []).find(
      (instruction) =>
        basename(instruction.script) === input.file || instruction.script === input.file,
    );
    if (!generatedInstruction) {
      throw extensionsCommandError(
        "SCRIPT_NOT_FOUND",
        `Generated instruction script not found: ${input.file}`,
      );
    }
    const file = basename(generatedInstruction.script);
    const path = join(paths.sourceRoot, generatedInstruction.script);
    if (!existsSync(path)) {
      const packaged = resolveGeneratedInstructionScriptPath(generatedInstruction, process.cwd());
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, readOptionalFile(packaged));
    }
    assertFileBackedSaveAllowed({
      baseVersion: input.baseSourceVersion,
      current: {
        extensionId: extension.id,
        file,
        path,
        content: readOptionalFile(path),
        sourceVersion: readFileBackedVersion(path),
      },
      currentVersion: readFileBackedVersion(path),
      mode: input.mode,
    });
    writeTextFileAtomically(path, input.content);
    return {
      ok: true,
      extensionId: extension.id,
      file,
      path,
      sourceVersion: readFileBackedVersion(path),
    };
  }
  if (input.kind === "minimal") {
    const file = "minimal.md";
    const path = paths.instructionsMinimal;
    assertFileBackedSaveAllowed({
      baseVersion: input.baseSourceVersion,
      current: {
        extensionId: extension.id,
        file,
        path,
        content: readOptionalFile(path),
        sourceVersion: readFileBackedVersion(path),
      },
      currentVersion: readFileBackedVersion(path),
      mode: input.mode,
    });
    writeTextFileAtomically(path, input.content);
    return {
      ok: true,
      extensionId: extension.id,
      file,
      path,
      sourceVersion: readFileBackedVersion(path),
    };
  }
  const file = validateInstructionBasename(input.file);
  const generatedNames = new Set(
    (extension.generatedInstructions ?? []).map((instruction) => basename(instruction.output)),
  );
  if (generatedNames.has(file)) {
    throw extensionsCommandError(
      "GENERATED_INSTRUCTION_READONLY",
      `Generated instruction file is read-only: ${file}`,
    );
  }
  const path = requireInstructionFile(paths, file);
  assertFileBackedSaveAllowed({
    baseVersion: input.baseSourceVersion,
    current: {
      extensionId: extension.id,
      file,
      path,
      content: readOptionalFile(path),
      sourceVersion: readFileBackedVersion(path),
    },
    currentVersion: readFileBackedVersion(path),
    mode: input.mode,
  });
  writeTextFileAtomically(path, input.content);
  return {
    ok: true,
    extensionId: extension.id,
    file,
    path,
    sourceVersion: readFileBackedVersion(path),
  };
}

async function resumeDependencyApprovedBuilds(
  operation: ExtensionDependencyBlockedOperation,
  options: {
    agentSettingsStore?: AgentSettingsStore;
    buildRoot?: string;
    cliProbe?: SvvyxExtensionsCliProbe;
    cwd?: string;
    dependencyApprovalStore: ExtensionDependencyApprovalStore;
    dependencyInstaller?: SvvyxExtensionsDependencyInstaller;
    env?: NodeJS.ProcessEnv;
    envSecretStore?: ExtensionEnvSecretStore;
    extensionsRoot?: string;
    recordDependencyBlockedOperation?: boolean;
    structuredSessionStore?: StructuredSessionStateStore;
  },
): Promise<SvvyxExtensionsCommandResult> {
  const builds: unknown[] = [];
  for (const extensionId of operation.extensionIds) {
    const result = await runBuildCommand([extensionId, "--json"], options);
    if (dependencyApprovalPausedOutput(result.output)) {
      return result;
    }
    builds.push(result.output);
  }
  return {
    output: {
      ok: true,
      blockedOperation: operation.blockedOperation,
      builds,
    },
    commandFacts: {
      dependencyApprovalResumed: true,
      blockedOperation: operation.blockedOperation,
      buildCount: builds.length,
    },
  };
}

function dependencyApprovalPausedOutput(output: unknown): output is {
  approvalRequestId?: unknown;
  status: "needs_user_confirmation";
} {
  return (
    isRecord(output) &&
    output.status === "needs_user_confirmation" &&
    typeof output.approvalRequestId === "string"
  );
}

export async function readBuiltinExtensionsInventory(
  input: {
    agentSettingsStore?: AgentSettingsStore;
    cliProbe?: SvvyxExtensionsCliProbe;
    cwd?: string;
    dependencyApprovalStore?: ExtensionDependencyApprovalStore;
    env?: NodeJS.ProcessEnv;
    envSecretStore?: ExtensionEnvSecretStore;
    extensionsRoot?: string;
    externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
    includeUserExtensions?: boolean;
  } = {},
): Promise<ExtensionsInventoryReadModel> {
  const extensions: ExtensionInventoryItemReadModel[] = [];
  const resolveBuiltinForInventory = (id: string): ResolvedExtensionRecord => {
    const record = input.extensionsRoot
      ? resolveVisibleExtensionRecord(id, input.extensionsRoot)
      : resolveExtensionRecord(id, input.extensionsRoot);
    if (!record) {
      throw extensionsCommandError("extension_not_found", `Extension not found: ${id}`);
    }
    return record;
  };
  const extensionRecords = input.includeUserExtensions
    ? [
        ...BUILTIN_EXTENSIONS.map((builtin) => resolveBuiltinForInventory(builtin.id)),
        ...listUserExtensions(input.extensionsRoot),
      ]
    : BUILTIN_EXTENSIONS.map((builtin) => resolveBuiltinForInventory(builtin.id));
  for (const extension of extensionRecords) {
    const cliRequirements = await resolveCliRequirements(extension, input);
    const envRequirements = resolveEnvRequirements(
      extension,
      extensionEnvValues(input.agentSettingsStore),
      input.envSecretStore,
    );
    const dependencyApprovalStore = resolveExtensionDependencyApprovalStore(input);
    const packageProject = extensionPackageProjectPath(input.extensionsRoot);
    const dependencies = resolveDependencyRequirements(extension.dependencies ?? [], {
      dependencyApprovalStore,
      packageProject,
    });
    const trustedDependencies = resolveDependencyRequirements(extension.trustedDependencies ?? [], {
      dependencyApprovalStore,
      packageProject,
    });
    const issues = extensionIssues(
      extension,
      cliRequirements,
      envRequirements,
      [...dependencies, ...trustedDependencies],
      extensionBuildCurrentPath(extension.id, undefined, input.extensionsRoot),
    );
    extensions.push({
      id: extension.id,
      category: extension.category,
      interface: extension.interface,
      title: extension.title,
      description: extension.description,
      customized: extensionCustomized(extension, input.cwd ?? process.cwd()),
      ...(extension.id === "extension-loading"
        ? {}
        : {
            minimalInstruction: extensionMinimalInstructionReadModel(
              extension,
              input.extensionsRoot,
            ),
          }),
      loadedInstructionContributors: extensionLoadedInstructionContributors(
        extension,
        input.cwd ?? process.cwd(),
        input.extensionsRoot,
      ),
      typescriptApiEnabled: extension.typescriptApiEnabled,
      tooling: extensionToolingReadModel(
        extension,
        input.cwd ?? process.cwd(),
        input.extensionsRoot,
      ),
      usage:
        extension.category === "user"
          ? userExtensionUsageStates(extension.id, input.agentSettingsStore)
          : usageStates(extension.id, input.agentSettingsStore),
      requirements: {
        cliRequirements,
        env: envRequirements,
      },
      state: {
        ready: issues.length === 0,
        issues,
      },
    });
  }
  for (const source of input.externalInstructionSources ?? []) {
    extensions.push(externalInstructionInventoryItem(source));
  }
  return {
    extensions,
    defaults: extensionDefaultsReadModel(extensionRecords, input.agentSettingsStore),
    reversibleChanges: readExtensionChangeCards(input.extensionsRoot, {
      includeUserExtensions: input.includeUserExtensions === true,
    }),
    snapshots: listExtensionSnapshotSummaries(input.extensionsRoot, {
      agentSettingsStore: input.agentSettingsStore,
      envSecretStore: input.envSecretStore,
    }),
  };
}

function extensionLoadedInstructionContributors(
  extension: ResolvedExtensionRecord,
  cwd: string,
  extensionsRoot: string | undefined,
): ExtensionLoadedInstructionContributorReadModel[] {
  const configByName = new Map(
    (extension.instructionFiles ?? []).map((file) => [file.file, file.bypassed]),
  );
  const generatedByName = new Map(
    (extension.generatedInstructions ?? []).map((instruction) => [
      basename(instruction.output),
      instruction,
    ]),
  );
  const contributors = new Map<string, ExtensionLoadedInstructionContributorReadModel>();
  if (extension.category === "builtin" && !extension.sourceRoot) {
    for (const file of builtinDefaultInstructionFiles(extension, cwd)) {
      if (generatedByName.has(file.name)) continue;
      const path = join(
        builtinSourcePaths(extension.id, extensionsRoot, extension.interface).instructionsFullDir,
        file.name,
      );
      contributors.set(file.name, {
        kind: "source",
        file: instructionFileReadModel({
          content: file.content,
          editable: true,
          name: file.name,
          path,
          bypassed: configByName.get(file.name) ?? false,
        }),
      });
    }
  } else {
    for (const path of extension.instructionSourceFiles) {
      const name = basename(path);
      if (generatedByName.has(name)) continue;
      const content = readOptionalFile(path);
      contributors.set(name, {
        kind: "source",
        file: instructionFileReadModel({
          content,
          editable: extension.category !== "external_instruction",
          name,
          path,
          bypassed: configByName.get(name) ?? false,
        }),
      });
    }
  }
  for (const [name, instruction] of generatedByName) {
    const scriptPath = editableGeneratedInstructionScriptPath(
      extension,
      instruction,
      cwd,
      extensionsRoot,
    );
    const packagedScriptPath = resolveGeneratedInstructionScriptPath(instruction, cwd);
    const outputPath = extension.sourceRoot
      ? join(extension.sourceRoot, instruction.output)
      : resolveGeneratedInstructionReadPath(instruction, cwd);
    const scriptContent = existsSync(scriptPath)
      ? readOptionalFile(scriptPath)
      : readOptionalFile(packagedScriptPath);
    const outputContent = readOptionalFile(outputPath);
    contributors.set(name, {
      kind: "scripted",
      name,
      bypassed: configByName.get(name) ?? false,
      script: instructionFileReadModel({
        content: scriptContent,
        editable: true,
        name: basename(instruction.script),
        path: scriptPath,
        bypassed: false,
      }),
      output: instructionFileReadModel({
        content: outputContent,
        editable: false,
        name,
        path: outputPath,
        bypassed: configByName.get(name) ?? false,
      }),
      regenerateCommand: `svvyx extensions build ${extension.id} --json`,
    });
  }
  return orderedInstructionFileNames(extension, contributors.keys()).map(
    (name) => contributors.get(name)!,
  );
}

function editableGeneratedInstructionScriptPath(
  extension: ResolvedExtensionRecord,
  instruction: ExtensionGeneratedInstruction,
  cwd: string,
  extensionsRoot: string | undefined,
): string {
  if (extension.sourceRoot) {
    return join(extension.sourceRoot, instruction.script);
  }
  if (extension.category === "builtin") {
    return join(
      builtinSourcePaths(extension.id, extensionsRoot, extension.interface).sourceRoot,
      instruction.script,
    );
  }
  return resolveGeneratedInstructionScriptPath(instruction, cwd);
}

function instructionFileReadModel(input: {
  content: string;
  editable: boolean;
  name: string;
  path: string;
  bypassed: boolean;
}): ExtensionInstructionFileReadModel {
  return {
    name: input.name,
    path: input.path,
    content: input.content,
    sourceVersion: readFileBackedVersion(input.path),
    bypassed: input.bypassed,
    editable: input.editable,
    tokenCount: countPromptTokens({ provider: "openai", model: "gpt-4o", text: input.content }),
  };
}

function orderedInstructionFileNames(
  extension: ResolvedExtensionRecord,
  names: Iterable<string>,
): string[] {
  const remaining = new Set(names);
  const ordered: string[] = [];
  for (const instruction of extension.instructionFiles ?? []) {
    if (!remaining.delete(instruction.file)) continue;
    ordered.push(instruction.file);
  }
  for (const instruction of extension.generatedInstructions ?? []) {
    const name = basename(instruction.output);
    if (!remaining.delete(name)) continue;
    ordered.push(name);
  }
  return [...ordered, ...[...remaining].toSorted((left, right) => left.localeCompare(right))];
}

function resolveGeneratedInstructionReadPath(
  instruction: ExtensionGeneratedInstruction,
  cwd: string,
): string {
  const name = basename(instruction.output);
  const candidates = packagedExtensionAssetRoots(cwd).flatMap((root) => [
    resolve(root, instruction.output),
    resolve(root, "generated", instruction.output),
    resolve(root, "generated", "instructions", "full", name),
  ]);
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function resolveGeneratedInstructionScriptPath(
  instruction: ExtensionGeneratedInstruction,
  cwd: string,
): string {
  const candidates = packagedExtensionAssetRoots(cwd).map((root) =>
    resolve(root, instruction.script),
  );
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function packagedExtensionAssetRoots(cwd: string): string[] {
  const roots = [
    resolve(cwd),
    resolve(import.meta.dir, "..", ".."),
    dirname(process.execPath),
    resolve(dirname(process.execPath), "..", "Resources"),
    resolve(dirname(process.execPath), "..", "Resources", "app"),
  ];
  return [...new Set(roots)];
}

function extensionToolingReadModel(
  extension: ResolvedExtensionRecord,
  cwd: string,
  extensionsRoot: string | undefined,
): ExtensionToolingReadModel {
  const typescriptApiDeclaration = extensionTypescriptApiDeclaration(extension, cwd);
  if (isAppOwnedBuiltinSvvyxCommandNamespace(extension)) {
    return {
      svvyxCommandSchema: extensionManagingCommandSchemaReadModel(),
      typescriptApiStatus: "disabled",
    };
  }
  return {
    ...(extension.interface === "native_tool"
      ? {
          nativeToolSchema: generatedReadonlyBlock({
            content: buildNativeToolSchemaJsonForExtension(extension),
            name: "tool-schema.json",
            path: `generated/native-tools/${extension.id}.schema.json`,
          }),
        }
      : {}),
    ...(extension.interface === "svvyx"
      ? {
          svvyxCommandSource: extensionSvvyxCommandSourceReadModel(extension, cwd, extensionsRoot),
          svvyxCommandSchema: extensionSvvyxCommandSchemaReadModel(extension, cwd, extensionsRoot),
          typescriptApiStatus: extension.typescriptApiEnabled
            ? typescriptApiDeclaration
              ? "emitted"
              : "not_emitted"
            : "disabled",
          ...(typescriptApiDeclaration ? { typescriptApiDeclaration } : {}),
        }
      : { typescriptApiStatus: "disabled" }),
  };
}

const EXTENSION_MANAGING_COMMAND_MANIFEST: SvvyxCommandManifest = {
  version: "incur.v1",
  commands: [
    extensionManagingCommand(
      "inspect",
      "Inspect one extension's source paths, readiness, usage, build state, and generated artifacts.",
    ),
    extensionManagingCommand("create", "Create a user extension source skeleton."),
    extensionManagingCommand(
      "duplicate",
      "Duplicate a non-native extension into a user extension source skeleton.",
    ),
    extensionManagingCommand(
      "configure",
      "Change extension manifest-level configuration such as TypeScript API enablement.",
    ),
    extensionManagingCommand("instructions add", "Add a loaded instruction source file."),
    extensionManagingCommand(
      "instructions remove",
      "Remove a loaded instruction source file and move app-owned source into trash.",
    ),
    extensionManagingCommand("instructions rename", "Rename a loaded instruction source file."),
    extensionManagingCommand("instructions reorder", "Reorder loaded instruction source files."),
    extensionManagingCommand(
      "instructions configure",
      "Configure loaded instruction source state such as bypassed or active.",
    ),
    extensionManagingCommand(
      "build",
      "Build or validate an extension and regenerate scripted instructions, command schemas, and TypeScript declarations when applicable.",
    ),
    extensionManagingCommand(
      "set-usage",
      "Set extension usage state for actor defaults or profile overrides.",
    ),
    extensionManagingCommand(
      "defaults",
      "Inspect or reset default extension order and default usage policy.",
    ),
    extensionManagingCommand(
      "delete",
      "Delete a user extension by moving its source into app-owned trash.",
    ),
    extensionManagingCommand(
      "reset",
      "Reset a builtin extension source scope to its packaged default.",
    ),
    extensionManagingCommand("revert", "Revert a reversible Extension Managing change by id."),
    extensionManagingCommand("snapshots list", "List local Extension Managing snapshots."),
    extensionManagingCommand("snapshots save", "Save a local Extension Managing snapshot."),
    extensionManagingCommand(
      "snapshots load",
      "Restore a local Extension Managing snapshot and run the normal build/readiness pipeline.",
    ),
    extensionManagingCommand("snapshots rename", "Rename a local Extension Managing snapshot."),
    extensionManagingCommand("snapshots delete", "Delete a local Extension Managing snapshot."),
  ],
};

function extensionManagingCommand(name: string, description: string): SvvyxCommandManifestEntry {
  return {
    name,
    description,
    schema: {
      options: {
        type: "object",
        additionalProperties: true,
        properties: {
          json: {
            type: "boolean",
            description: "Return structured JSON output. Required for agent-facing use.",
          },
        },
      },
      output: {
        type: "object",
        additionalProperties: true,
      },
    },
  };
}

function extensionManagingCommandSchemaReadModel(): ExtensionGeneratedReadonlyBlockReadModel {
  return generatedReadonlyBlock({
    content: JSON.stringify(EXTENSION_MANAGING_COMMAND_MANIFEST, null, 2) + "\n",
    name: "commands.json",
    openable: false,
    path: "generated/app-owned/extension-managing/commands.json",
  });
}

function isAppOwnedBuiltinSvvyxCommandNamespace(
  extension: Pick<ExtensionRecord, "category" | "id" | "interface">,
): boolean {
  return (
    extension.category === "builtin" &&
    extension.interface === "svvyx" &&
    extension.id === "extension-managing"
  );
}

function generatedReadonlyBlock(input: {
  content: string;
  name: string;
  openable?: boolean;
  path: string;
}): ExtensionGeneratedReadonlyBlockReadModel {
  return {
    name: input.name,
    path: input.path,
    ...(input.openable === false ? { openable: false } : {}),
    content: input.content,
    tokenCount: countPromptTokens({ provider: "openai", model: "gpt-4o", text: input.content }),
  };
}

function extensionSvvyxCommandSourceReadModel(
  extension: ResolvedExtensionRecord,
  cwd: string,
  extensionsRoot: string | undefined,
): ExtensionInstructionFileReadModel {
  const path = extension.sourceRoot
    ? join(extension.sourceRoot, "source", "index.ts")
    : extension.category === "builtin"
      ? join(
          builtinSourcePaths(extension.id, extensionsRoot, extension.interface).sourceRoot,
          "source",
          "index.ts",
        )
      : resolve(cwd, "src", "bun", `${extension.id}-extension.ts`);
  const content = readOptionalFile(path);
  return instructionFileReadModel({
    content,
    editable: extension.category !== "external_instruction",
    name: "source/index.ts",
    path,
    bypassed: false,
  });
}

function extensionSvvyxCommandSchemaReadModel(
  extension: ResolvedExtensionRecord,
  cwd: string,
  extensionsRoot: string | undefined,
): ExtensionGeneratedReadonlyBlockReadModel {
  const generatedPath = extension.sourceRoot
    ? join(
        resolve(extensionsRoot ?? defaultExtensionsRoot()),
        "generated",
        "extensions",
        extension.id,
        "commands.json",
      )
    : extension.category === "builtin"
      ? join(
          resolve(extensionsRoot ?? defaultExtensionsRoot()),
          "generated",
          "extensions",
          extension.id,
          "commands.json",
        )
      : resolve(cwd, "generated", "extensions", extension.id, "commands.json");
  const generatedContent = readOptionalFile(generatedPath);
  const content =
    generatedContent || readCurrentBuildCommandManifestContent(extension.id, extensionsRoot);
  return generatedReadonlyBlock({
    content: content || "{}\n",
    name: "commands.json",
    openable: Boolean(generatedContent),
    path: generatedPath,
  });
}

function readCurrentBuildCommandManifestContent(
  extensionId: string,
  extensionsRoot: string | undefined,
): string {
  const manifestPath = join(
    extensionBuildCurrentPath(extensionId, undefined, extensionsRoot),
    "manifest.json",
  );
  if (!existsSync(manifestPath)) return "";
  const manifest = readJsonObject(manifestPath);
  if (!isRecord(manifest.commandManifest)) return "";
  return JSON.stringify(manifest.commandManifest, null, 2) + "\n";
}

function extensionTypescriptApiDeclaration(
  extension: ResolvedExtensionRecord,
  cwd: string,
): ExtensionGeneratedReadonlyBlockReadModel | null {
  if (!extension.typescriptApiEnabled) return null;
  if (extension.id === "artifacts") {
    return generatedReadonlyBlock({
      content: ARTIFACTS_CLIENT_DECLARATION,
      name: "artifacts.types.d.ts",
      path: resolve(cwd, "generated", "execute-typescript-api.generated.ts"),
    });
  }
  if (extension.id === "workflows") {
    return generatedReadonlyBlock({
      content: WORKFLOWS_CLIENT_DECLARATION,
      name: "workflows.types.d.ts",
      path: resolve(cwd, "generated", "execute-typescript-api.generated.ts"),
    });
  }
  const path = resolve(cwd, "generated", "extensions", extension.id, "types.d.ts");
  const content = readOptionalFile(path);
  if (!content.trim()) return null;
  return generatedReadonlyBlock({
    content,
    name: "types.d.ts",
    path,
  });
}

function extensionMinimalInstructionReadModel(
  extension: ResolvedExtensionRecord,
  extensionsRoot: string | undefined,
): ExtensionInventoryItemReadModel["minimalInstruction"] {
  const path =
    extension.category === "builtin"
      ? builtinSourcePaths(extension.id, extensionsRoot, extension.interface).instructionsMinimal
      : extension.sourceRoot
        ? join(extension.sourceRoot, "instructions", "minimal.md")
        : "";
  const content =
    path && existsSync(path)
      ? readOptionalFile(path)
      : extension.category === "builtin"
        ? `${extension.minimalLoadingHint}\n`
        : extension.minimalLoadingHint;
  return {
    name: "minimal.md",
    path,
    content,
    sourceVersion:
      path && existsSync(path) ? readFileBackedVersion(path) : fileBackedTextVersion(content),
    bypassed: false,
    editable: extension.category !== "external_instruction",
    tokenCount: countPromptTokens({ provider: "openai", model: "gpt-4o", text: content }),
  };
}

function extensionDefaultsReadModel(
  extensions: readonly ResolvedExtensionRecord[],
  store?: AgentSettingsStore,
): ExtensionsInventoryReadModel["defaults"] {
  const settings = store?.getState() ?? DEFAULT_AGENT_SETTINGS_STATE;
  const usage: Record<string, ExtensionDefaultUsageReadModel[]> = {};
  const defaultUsage = settings.extensionDefaults.usage as Partial<
    Record<ExternalInstructionActor, Record<string, ExtensionUsageState>>
  >;
  const order =
    settings.extensionDefaults.order.length > 0
      ? settings.extensionDefaults.order
      : builtinDefaultExtensionOrder();
  for (const extension of extensions) {
    usage[extension.id] = (["orchestrator", "workflow-task"] as const).map((actorKind) => {
      const baseline =
        extension.category === "user"
          ? "loaded"
          : builtinDefaultExtensionUsageState(
              extension.id,
              actorKind,
              settings.appPreferences.networkAccess,
            );
      const state = defaultUsage[actorKind]?.[extension.id] ?? baseline;
      const configurable = extension.id !== "extension-loading";
      return {
        actorKind,
        state,
        customized: state !== baseline,
        configurable,
        ...(configurable ? {} : { fixedReason: "app_native_control" }),
      };
    });
  }
  return { order, usage };
}

function externalInstructionInventoryItem(
  source: GeneratedAgentContextExternalSource,
): ExtensionInventoryItemReadModel {
  const readable = source.readStatus.status === "readable";
  return {
    id: externalInstructionExtensionId(source),
    category: "external_instruction",
    interface: "instructions",
    title: source.title,
    description: `Read-only ${source.kind} external instruction file.`,
    customized: false,
    loadedInstructionContributors: [
      {
        kind: "source",
        file: instructionFileReadModel({
          content: source.content,
          editable: false,
          name: basename(source.path),
          path: source.path,
          bypassed: !source.enabled || !readable,
        }),
      },
    ],
    externalInstruction: {
      sourceGroup: source.sourceGroup,
      rootId: source.rootId,
      rootLabel: source.rootLabel,
      path: source.path,
      content: source.content,
      contentHash: source.contentHash,
      order: source.order,
      enabled: source.enabled,
      actors: [...source.actors],
      readStatus: source.readStatus,
    },
    typescriptApiEnabled: false,
    tooling: {
      typescriptApiStatus: "disabled",
    },
    usage: (["orchestrator", "handler", "workflow-task"] as const).map((actorKind) => ({
      actorKind,
      agentProfile: "external_instruction",
      state:
        source.enabled && readable && source.actors.includes(actorKind) ? "loaded" : "unavailable",
      configurable: false,
      fixedReason: "external_instruction_settings",
    })),
    requirements: {
      cliRequirements: [],
      env: [],
    },
    state: {
      ready: readable,
      issues: readable
        ? []
        : [
            {
              code: "EXTERNAL_INSTRUCTION_UNREADABLE",
              message: source.readStatus.error ?? "External instruction file is unreadable.",
            },
          ],
    },
  };
}

function extensionCustomized(extension: ResolvedExtensionRecord, cwd: string): boolean {
  if (extension.category !== "builtin") return false;
  if (!extension.sourceRoot || !extension.sourceRoot.includes(join("sources", "builtin"))) {
    return false;
  }
  const packaged = getExtensionRecord(extension.id);
  if (!packaged) return false;
  if (extension.title !== packaged.title || extension.description !== packaged.description) {
    return true;
  }
  if (extension.typescriptApiEnabled !== packaged.typescriptApiEnabled) {
    return true;
  }
  if (
    normalizeMinimalInstructionContent(extension.minimalLoadingHint ?? "") !==
    normalizeMinimalInstructionContent(packaged.minimalLoadingHint ?? "")
  ) {
    return true;
  }
  const generatedNames = new Set(
    (extension.generatedInstructions ?? []).map((instruction) => basename(instruction.output)),
  );
  const currentFiles = extension.instructionSourceFiles
    .map((path) => {
      const name = basename(path);
      return {
        name,
        content: readOptionalFile(path),
        bypassed:
          extension.instructionFiles?.some(
            (instruction) => instruction.file === name && instruction.bypassed,
          ) ?? false,
      };
    })
    .filter((file) => !generatedNames.has(file.name));
  const defaultBypassed = new Map(
    (packaged.instructionFiles ?? []).map((instruction) => [
      instruction.file,
      instruction.bypassed,
    ]),
  );
  const defaultGeneratedNames = new Set(
    (packaged.generatedInstructions ?? []).map((instruction) => basename(instruction.output)),
  );
  const defaultFiles = builtinDefaultInstructionFiles(packaged, cwd)
    .filter((file) => !defaultGeneratedNames.has(file.name))
    .map((file) => ({
      ...file,
      bypassed: defaultBypassed.get(file.name) ?? false,
    }));
  return JSON.stringify(currentFiles) !== JSON.stringify(defaultFiles);
}

function normalizeMinimalInstructionContent(content: string): string {
  return content.replace(/\s+$/u, "");
}

export function readExtensionChangeCards(
  extensionsRoot: string | undefined,
  options: { includeUserExtensions?: boolean } = { includeUserExtensions: true },
): ExtensionChangeCardReadModel[] {
  return [
    ...readInstructionLifecycleChangeCards(extensionsRoot, options),
    ...readGlobalExtensionChangeCards(extensionsRoot, options),
  ].toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function assertExtensionEnvSecretTarget(input: {
  extensionId: string;
  extensionsRoot?: string;
  name: string;
}): void {
  const extension = requireExtension(input.extensionId, input.extensionsRoot);
  const declaration = (extension.envDeclarations ?? []).find(
    (candidate) => candidate.name === input.name,
  );
  if (!declaration) {
    throw extensionsCommandError(
      "extension_env_not_declared",
      `${input.extensionId} does not declare extension env ${input.name}.`,
    );
  }
  if (!declaration.secret) {
    throw extensionsCommandError(
      "extension_env_not_secret",
      `${input.extensionId} ${input.name} is not managed as a secret.`,
    );
  }
}

export function assertExtensionEnvOverrideTarget(input: {
  extensionId: string;
  extensionsRoot?: string;
  name: string;
}): void {
  const extension = requireExtension(input.extensionId, input.extensionsRoot);
  const declaration = (extension.envDeclarations ?? []).find(
    (candidate) => candidate.name === input.name,
  );
  if (!declaration) {
    throw extensionsCommandError(
      "extension_env_not_declared",
      `${input.extensionId} does not declare extension env ${input.name}.`,
    );
  }
  if (declaration.secret) {
    throw extensionsCommandError(
      "extension_env_is_secret",
      `${input.extensionId} ${input.name} is managed as a secret.`,
    );
  }
}

export function assertExtensionEnvWriteValue(value: string): void {
  if (!value.trim()) {
    throw extensionsCommandError(
      "extension_env_value_required",
      "Extension env value is required.",
    );
  }
}

function runCreateCommand(
  words: string[],
  options: {
    agentSettingsStore?: AgentSettingsStore;
    extensionsRoot?: string;
  },
): SvvyxExtensionsCommandResult {
  const flags = parseFlags(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["description", "id", "interface", "json", "title", "typescript-api"]);

  const id = requireSingleFlagValue(flags, "id");
  const title = requireSingleFlagValue(flags, "title");
  const description = requireSingleFlagValue(flags, "description");
  const interfaceKind = requireSingleFlagValue(flags, "interface");
  const typescriptApiEnabled = optionalBooleanFlag(flags, "typescript-api") ?? false;

  if (interfaceKind !== "instructions" && interfaceKind !== "svvyx") {
    throw extensionsCommandError(
      "invalid_argument",
      "Extension create --interface must be instructions or svvyx.",
    );
  }
  if (interfaceKind === "instructions" && typescriptApiEnabled) {
    throw extensionsCommandError(
      "invalid_argument",
      "typescriptApiEnabled is valid only with interface svvyx.",
    );
  }
  validateCreatableUserExtensionId(id, extensionSourceRoot(options.extensionsRoot, id));

  const paths = userExtensionPaths(id, options.extensionsRoot, interfaceKind);
  mkdirSync(paths.instructionsFullDir, { recursive: true });
  mkdirSync(join(paths.sourceRoot, "instructions"), { recursive: true });
  if (interfaceKind === "svvyx" && paths.extensionSource) {
    mkdirSync(paths.extensionSource, { recursive: true });
    writeFileSync(
      join(paths.extensionSource, "index.ts"),
      [
        'import { Cli } from "incur";',
        "",
        `const cli = Cli.create(${JSON.stringify(id)}, {`,
        `  description: ${JSON.stringify(description)},`,
        "});",
        "",
        "export default cli;",
        "",
      ].join("\n"),
    );
  }

  const instructionFileName = `010-${id}.md`;
  writeFileSync(join(paths.instructionsFullDir, instructionFileName), `# ${title}\n`);
  writeFileSync(paths.instructionsMinimal, "");
  writeFileSync(
    paths.manifest,
    JSON.stringify(
      {
        schemaVersion: 1,
        id,
        title,
        description,
        interface: interfaceKind,
        typescriptApiEnabled,
        instructionFiles: [
          {
            file: instructionFileName,
            bypassed: false,
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  if (options.agentSettingsStore) {
    const settings = options.agentSettingsStore.getState();
    options.agentSettingsStore.setExtensionDefaults({
      ...settings.extensionDefaults,
      usage: {
        ...settings.extensionDefaults.usage,
        orchestrator: {
          ...settings.extensionDefaults.usage.orchestrator,
          [id]: "loaded",
        },
        "workflow-task": {
          ...settings.extensionDefaults.usage["workflow-task"],
          [id]: "loaded",
        },
      },
    });
  }

  const issues: ExtensionIssue[] = [
    {
      code: "NO_CURRENT_BUILD",
      message: `${title} has not been built yet.`,
    },
    {
      code: "BUILD_REQUIRED",
      message: `${title} must be built before it can be loaded.`,
    },
  ];
  const output = {
    ok: true,
    extension: {
      id,
      category: "user",
      interface: interfaceKind,
      title,
      description,
      resettable: false,
      deletable: true,
      typescriptApiEnabled,
      paths: {
        ...paths,
        instructionsFull: [
          {
            name: instructionFileName,
            path: join(paths.instructionsFullDir, instructionFileName),
            bypassed: false,
          },
        ],
      },
      usage: userExtensionUsageStates(id),
      state: {
        draftChanged: true,
        buildRequired: true,
        currentBuild: null,
        ready: false,
        issues,
      },
    },
    next: [
      "Edit source, instructions, manifest, or package.json with apply_patch.",
      `Run \`svvyx extensions build ${id} --json\`.`,
    ],
  };
  return {
    output,
    commandFacts: {
      extensionCreated: true,
      extensionId: id,
      extensionInterface: interfaceKind,
      extensionReady: false,
      extensionSourceRoot: paths.sourceRoot,
    },
  };
}

function runDuplicateCommand(
  words: string[],
  options: {
    agentSettingsStore?: AgentSettingsStore;
    cwd?: string;
    extensionsRoot?: string;
  },
): SvvyxExtensionsCommandResult {
  const flags = parseFlags(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["from", "id", "json", "title"]);
  const fromId = requireSingleFlagValue(flags, "from");
  const id = requireSingleFlagValue(flags, "id");
  const title = requireSingleFlagValue(flags, "title");
  const source = requireExtension(fromId, options.extensionsRoot);
  if (source.interface === "native_tool") {
    throw extensionsCommandError(
      "DUPLICATE_UNSUPPORTED",
      "App-native tool extensions cannot be duplicated as user extensions.",
    );
  }
  validateCreatableUserExtensionId(id, extensionSourceRoot(options.extensionsRoot, id));
  const sourcePaths = extensionPaths(
    source,
    options.cwd ?? process.cwd(),
    undefined,
    options.extensionsRoot,
  );
  const targetPaths = userExtensionPaths(
    id,
    options.extensionsRoot,
    source.interface === "svvyx" ? "svvyx" : "instructions",
  );
  mkdirSync(targetPaths.sourceRoot, { recursive: true });
  mkdirSync(targetPaths.instructionsFullDir, { recursive: true });
  mkdirSync(dirname(targetPaths.instructionsMinimal), { recursive: true });
  for (const instruction of sourcePaths.instructionsFull) {
    const content = readOptionalFile(instruction.path);
    writeFileSync(join(targetPaths.instructionsFullDir, instruction.name), content);
  }
  writeFileSync(targetPaths.instructionsMinimal, source.minimalLoadingHint);
  if (source.interface === "svvyx" && targetPaths.extensionSource) {
    mkdirSync(targetPaths.extensionSource, { recursive: true });
    if (sourcePaths.extensionSource && existsSync(sourcePaths.extensionSource)) {
      cpSync(sourcePaths.extensionSource, targetPaths.extensionSource, { recursive: true });
    } else {
      writeFileSync(
        join(targetPaths.extensionSource, "index.ts"),
        [
          'import { Cli } from "incur";',
          "",
          `const cli = Cli.create(${JSON.stringify(id)}, {`,
          `  description: ${JSON.stringify(source.description)},`,
          "});",
          "",
          "export default cli;",
          "",
        ].join("\n"),
      );
    }
  }
  writeFileSync(
    targetPaths.manifest,
    JSON.stringify(
      {
        schemaVersion: 1,
        id,
        title,
        description: source.description,
        interface: source.interface === "svvyx" ? "svvyx" : "instructions",
        typescriptApiEnabled: source.interface === "svvyx" ? source.typescriptApiEnabled : false,
        instructionFiles: sourcePaths.instructionsFull.map((file) => ({
          file: file.name,
          bypassed: file.bypassed,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  if (options.agentSettingsStore) {
    const settings = options.agentSettingsStore.getState();
    options.agentSettingsStore.setExtensionDefaults({
      ...settings.extensionDefaults,
      usage: {
        ...settings.extensionDefaults.usage,
        orchestrator: {
          ...settings.extensionDefaults.usage.orchestrator,
          [id]: "loaded",
        },
        "workflow-task": {
          ...settings.extensionDefaults.usage["workflow-task"],
          [id]: "loaded",
        },
      },
    });
  }
  return {
    output: {
      ok: true,
      extensionId: id,
      duplicatedFrom: source.id,
      sourceRoot: targetPaths.sourceRoot,
    },
    commandFacts: {
      extensionDuplicated: true,
      extensionId: id,
      duplicatedFrom: source.id,
    },
  };
}

function runConfigureCommand(
  words: string[],
  options: {
    cwd?: string;
    extensionsRoot?: string;
  },
): SvvyxExtensionsCommandResult {
  const flags = parseFlags(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["extension", "json", "typescript-api"]);
  const extensionId = requireSingleFlagValue(flags, "extension");
  const typescriptApiEnabled = optionalBooleanFlag(flags, "typescript-api");
  if (typescriptApiEnabled === undefined) {
    throw extensionsCommandError("invalid_argument", "Missing --typescript-api.");
  }
  const current = requireExtension(extensionId, options.extensionsRoot);
  if (current.interface !== "svvyx") {
    throw extensionsCommandError(
      "invalid_argument",
      "typescriptApiEnabled is valid only with interface svvyx.",
    );
  }
  const extension =
    current.category === "builtin"
      ? scaffoldBuiltinSource(current, {
          cwd: options.cwd,
          extensionsRoot: options.extensionsRoot,
        })
      : current;
  const paths = editableExtensionInspectPaths(extension, options.extensionsRoot);
  const manifest = readJsonObject(paths.manifest);
  const before = extension.typescriptApiEnabled;
  manifest.typescriptApiEnabled = typescriptApiEnabled;
  writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2) + "\n");
  return {
    output: {
      ok: true,
      extensionId: extension.id,
      changed: before !== typescriptApiEnabled,
      typescriptApiEnabled,
    },
    commandFacts: {
      extensionConfigured: true,
      extensionId: extension.id,
      typescriptApiEnabled,
    },
  };
}

function runInstructionsCommand(
  words: string[],
  options: {
    cwd?: string;
    extensionsRoot?: string;
  },
): SvvyxExtensionsCommandResult {
  const action = words[0];
  const id = words[1];
  if (!action) {
    throw extensionsCommandError("invalid_argument", "Missing instructions command.");
  }
  if (!id || id.startsWith("--")) {
    throw extensionsCommandError("invalid_argument", "Missing extension id.");
  }
  const flags = parseFlags(words.slice(2));
  requireJson(flags);
  validateInstructionCommandBeforeMaterialization(action, id, flags, options);
  const extension = requireEditableInstructionsExtension(id, options);
  const paths = editableExtensionInspectPaths(extension, options.extensionsRoot);

  if (action === "add") {
    rejectUnknownFlags(flags, ["json", "name"]);
    const name = validateInstructionBasename(requireSingleFlagValue(flags, "name"));
    const target = join(paths.instructionsFullDir, name);
    if (instructionNameExists(paths, name)) {
      throw extensionsCommandError(
        "INSTRUCTION_FILE_EXISTS",
        `Instruction file already exists: ${name}`,
      );
    }
    const before = captureInstructionSnapshot(paths);
    writeFileSync(target, "");
    syncManifestInstructionFiles(paths, (entries) => [
      ...entries.filter((entry) => entry.file !== name),
      { file: name, bypassed: false },
    ]);
    const afterPaths = editableExtensionInspectPaths(extension, options.extensionsRoot);
    const changeId = recordInstructionLifecycleChange(
      paths,
      extension.id,
      "instructions_add",
      before,
      captureInstructionSnapshot(afterPaths),
    );
    return instructionLifecycleResult(
      {
        ok: true,
        changeId,
        extensionId: extension.id,
        created: {
          name,
          path: target,
        },
      },
      afterPaths,
      true,
      {
        instructionChanged: true,
        instructionAction: action,
        instructionFile: name,
      },
    );
  }

  if (action === "rename") {
    rejectUnknownFlags(flags, ["from", "json", "to"]);
    const from = validateInstructionBasename(requireSingleFlagValue(flags, "from"));
    const to = validateInstructionBasename(requireSingleFlagValue(flags, "to"));
    const fromPath = requireInstructionFile(paths, from);
    if (instructionNameExists(paths, to)) {
      throw extensionsCommandError(
        "INSTRUCTION_FILE_EXISTS",
        `Instruction file already exists: ${to}`,
      );
    }
    assertNoCaseInsensitiveInstructionCollision(paths, from, to);
    const before = captureInstructionSnapshot(paths);
    const toPath = join(paths.instructionsFullDir, to);
    renameSync(fromPath, toPath);
    syncManifestInstructionFiles(paths, (entries) =>
      entries.map((entry) => (entry.file === from ? { ...entry, file: to } : entry)),
    );
    const afterPaths = editableExtensionInspectPaths(extension, options.extensionsRoot);
    const changeId = recordInstructionLifecycleChange(
      paths,
      extension.id,
      "instructions_rename",
      before,
      captureInstructionSnapshot(afterPaths),
    );
    return instructionLifecycleResult(
      {
        ok: true,
        changeId,
        extensionId: extension.id,
        renamed: {
          from,
          to,
          path: toPath,
        },
      },
      afterPaths,
      true,
      {
        instructionChanged: true,
        instructionAction: action,
        instructionFile: to,
      },
    );
  }

  if (action === "remove") {
    rejectUnknownFlags(flags, ["json", "name"]);
    const name = validateInstructionBasename(requireSingleFlagValue(flags, "name"));
    const path = requireInstructionFile(paths, name);
    const before = captureInstructionSnapshot(paths);
    const trash = moveInstructionFileToTrash(paths, extension.id, name, path);
    syncManifestInstructionFiles(paths, (entries) =>
      entries.filter((entry) => entry.file !== name),
    );
    const afterPaths = editableExtensionInspectPaths(extension, options.extensionsRoot);
    const changeId = recordInstructionLifecycleChange(
      paths,
      extension.id,
      "instructions_remove",
      before,
      captureInstructionSnapshot(afterPaths),
    );
    return instructionLifecycleResult(
      {
        ok: true,
        changeId,
        extensionId: extension.id,
        removed: {
          name,
          path,
          trashId: trash.trashId,
          trashPath: trash.trashPath,
        },
      },
      afterPaths,
      true,
      {
        instructionChanged: true,
        instructionAction: action,
        instructionFile: name,
      },
    );
  }

  if (action === "reorder") {
    rejectUnknownFlags(flags, ["file", "json"]);
    const requested = flags.get("file") ?? [];
    const plan = buildInstructionReorderPlan(paths, requested);
    const before = captureInstructionSnapshot(paths);
    for (const step of plan.renameToTemporary) {
      renameSync(step.from, step.to);
    }
    for (const step of plan.renameToFinal) {
      renameSync(step.from, step.to);
    }
    syncManifestInstructionFiles(paths, (entries) =>
      entries.map((entry) => ({ ...entry, file: plan.finalNames.get(entry.file) ?? entry.file })),
    );
    const afterPaths = editableExtensionInspectPaths(extension, options.extensionsRoot);
    const changeId = recordInstructionLifecycleChange(
      paths,
      extension.id,
      "instructions_reorder",
      before,
      captureInstructionSnapshot(afterPaths),
    );
    return instructionLifecycleResult(
      {
        ok: true,
        changeId,
        extensionId: extension.id,
        renamed: plan.renamed,
      },
      afterPaths,
      true,
      {
        instructionChanged: true,
        instructionAction: action,
        instructionRenameCount: plan.renamed.length,
      },
    );
  }

  if (action === "configure") {
    rejectUnknownFlags(flags, ["bypassed", "file", "json"]);
    const file = validateInstructionBasename(requireSingleFlagValue(flags, "file"));
    requireInstructionEntry(paths, file);
    const bypassed = parseInstructionBypassedFlag(flags);
    const beforeConfig = instructionConfigFor(paths, file);
    const afterConfig = { bypassed };
    if (beforeConfig.bypassed === afterConfig.bypassed) {
      return instructionLifecycleResult(
        {
          ok: true,
          changed: false,
          extensionId: extension.id,
          configured: {
            file,
            before: beforeConfig,
            after: afterConfig,
          },
        },
        paths,
        false,
        {
          instructionChanged: false,
          instructionAction: action,
          instructionFile: file,
        },
      );
    }
    const before = captureInstructionSnapshot(paths);
    syncManifestInstructionFiles(paths, (entries) => {
      const next = entries.filter((entry) => entry.file !== file);
      next.push({ file, bypassed });
      return next;
    });
    const afterPaths = editableExtensionInspectPaths(extension, options.extensionsRoot);
    const changeId = recordInstructionLifecycleChange(
      paths,
      extension.id,
      "instructions_configure",
      before,
      captureInstructionSnapshot(afterPaths),
    );
    return instructionLifecycleResult(
      {
        ok: true,
        changed: true,
        changeId,
        extensionId: extension.id,
        configured: {
          file,
          before: beforeConfig,
          after: afterConfig,
        },
      },
      afterPaths,
      true,
      {
        instructionChanged: true,
        instructionAction: action,
        instructionFile: file,
      },
    );
  }

  throw extensionsCommandError(
    "unsupported_command",
    `Unsupported instructions command: ${action}`,
  );
}

function runSetUsageCommand(
  words: string[],
  options: {
    agentSettingsStore?: AgentSettingsStore;
    structuredSessionStore?: StructuredSessionStateStore;
    extensionsRoot?: string;
  },
): SvvyxExtensionsCommandResult {
  const flags = parseFlags(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["agent-profile", "extension", "json", "state"]);
  const store = requireAgentSettingsStore(options.agentSettingsStore);
  const extensionId = requireSingleFlagValue(flags, "extension");
  const agentProfile = requireSingleFlagValue(flags, "agent-profile");
  const state = validateUsageState(requireSingleFlagValue(flags, "state"));
  return setExtensionUsage({
    agentSettingsStore: store,
    structuredSessionStore: options.structuredSessionStore,
    extensionsRoot: options.extensionsRoot,
    extensionId,
    agentProfile,
    state,
  });
}

function runDefaultsCommand(
  words: string[],
  options: {
    agentSettingsStore?: AgentSettingsStore;
    extensionsRoot?: string;
  },
): SvvyxExtensionsCommandResult {
  const action = words[0];
  if (!action) {
    throw extensionsCommandError("invalid_argument", "Missing defaults command.");
  }
  const store = requireAgentSettingsStore(options.agentSettingsStore);
  const flags = parseFlags(words.slice(1));
  requireJson(flags);

  if (action === "set-usage") {
    rejectUnknownFlags(flags, ["actor", "extension", "json", "state"]);
    const actor = validateDefaultUsageActor(requireSingleFlagValue(flags, "actor"));
    const extensionId = requireSingleFlagValue(flags, "extension");
    const state = validateUsageState(requireSingleFlagValue(flags, "state"));
    if (actor === "handler") {
      throw extensionsCommandError(
        "invalid_argument",
        "Extension defaults can only be edited for new orchestrators and workflow task agents.",
      );
    }
    const extension = requireExtension(extensionId, options.extensionsRoot);
    if (extension.id === "extension-loading") {
      throw extensionsCommandError(
        "FIXED_EXTENSION_USAGE",
        "Extension Loading is fixed loaded and cannot be changed by defaults set-usage.",
      );
    }
    assertUsageStateAllowedForActor({
      actor,
      extension,
      extensionId: extension.id,
      requestedState: state,
    });
    const settings = store.getState();
    const usage = structuredClone(settings.extensionDefaults.usage);
    const actorUsage = { ...usage[actor] };
    const builtinState =
      extension.category === "user"
        ? "loaded"
        : builtinDefaultExtensionUsageState(
            extension.id,
            actor,
            settings.appPreferences.networkAccess,
          );
    if (state === builtinState) {
      delete actorUsage[extension.id];
    } else {
      actorUsage[extension.id] = state;
    }
    usage[actor] = actorUsage;
    const next = store.setExtensionDefaults({
      ...settings.extensionDefaults,
      usage,
    });
    return {
      output: {
        ok: true,
        extensionId: extension.id,
        actor,
        state,
        changed: true,
        defaults: next.extensionDefaults,
      },
      commandFacts: {
        extensionDefaultUsageChanged: true,
        extensionId: extension.id,
        actor,
        state,
      },
    };
  }

  if (action === "reorder") {
    rejectUnknownFlags(flags, ["extension", "json"]);
    const ids = flags.get("extension") ?? [];
    const nextOrder = normalizeDefaultExtensionOrder(ids, options.extensionsRoot);
    const settings = store.getState();
    const next = store.setExtensionDefaults({
      ...settings.extensionDefaults,
      order: nextOrder,
    });
    return {
      output: {
        ok: true,
        order: next.extensionDefaults.order,
      },
      commandFacts: {
        extensionDefaultOrderChanged: true,
        extensionDefaultOrderCount: next.extensionDefaults.order.length,
      },
    };
  }

  if (action === "reset-order") {
    rejectUnknownFlags(flags, ["json"]);
    const settings = store.getState();
    const next = store.setExtensionDefaults({
      ...settings.extensionDefaults,
      order: [],
    });
    return {
      output: {
        ok: true,
        order: next.extensionDefaults.order,
      },
      commandFacts: {
        extensionDefaultOrderReset: true,
      },
    };
  }

  throw extensionsCommandError("unsupported_command", `Unsupported defaults command: ${action}`);
}

export type SetExtensionUsageResult = SvvyxExtensionsCommandResult & {
  actor: SvvyActorKind;
  agentProfile: string;
};

export function setExtensionUsage(input: {
  agentSettingsStore: AgentSettingsStore;
  structuredSessionStore?: StructuredSessionStateStore;
  extensionsRoot?: string;
  extensionId: string;
  agentProfile: string;
  state: ExtensionUsageState;
}): SetExtensionUsageResult {
  const extension = requireExtension(input.extensionId, input.extensionsRoot);
  if (extension.id === "extension-loading") {
    throw extensionsCommandError(
      "FIXED_EXTENSION_USAGE",
      "Extension Loading is fixed loaded and cannot be changed by set-usage.",
    );
  }

  const target = resolveUsageProfile(input.agentSettingsStore, input.agentProfile);
  assertUsageStateAllowedForActor({
    actor: target.actor,
    extension,
    extensionId: extension.id,
    requestedState: input.state,
  });
  const beforeState = configuredExtensionUsageState({
    actor: target.actor,
    agentSettingsStore: input.agentSettingsStore,
    extensionId: extension.id,
    profile: target.profile,
  });
  const defaultState = configuredDefaultExtensionUsageState({
    actor: target.actor,
    agentSettingsStore: input.agentSettingsStore,
    extensionId: extension.id,
    profile: profileWithoutExtensionUsage(target.profile, extension.id),
  });
  setUsageProfile(input.agentSettingsStore, target, extension.id, input.state, {
    explicit: input.state !== defaultState,
  });
  const changeId = recordExtensionUsageChange({
    extensionsRoot: resolve(input.extensionsRoot ?? defaultExtensionsRoot()),
    extensionId: extension.id,
    agentProfile: target.agentProfileName,
    profileId: target.profile.id,
    beforeState,
    afterState: input.state,
  });
  const queuedUpdates = queueUsageAgentContextRefreshes({
    store: input.structuredSessionStore,
    agentProfile: target.agentProfileName,
    profileId: target.profile.id,
    changeId,
  });

  return {
    actor: target.actor,
    agentProfile: target.agentProfileName,
    output: {
      ok: true,
      changeId,
      extensionId: extension.id,
      agentProfile: target.agentProfileName,
      before: {
        state: beforeState,
      },
      after: {
        state: input.state,
      },
      agentContextImpact: {
        affectsNewTurns: true,
        activeRunsChangeAtNextSafeBoundary: true,
        queuedUpdates,
      },
    },
    commandFacts: {
      extensionUsageChanged: true,
      extensionId: extension.id,
      agentProfile: target.agentProfileName,
      beforeUsageState: beforeState,
      afterUsageState: input.state,
      queuedAgentContextRefreshes: queuedUpdates.length,
    },
  };
}

function requireAgentSettingsStore(store: AgentSettingsStore | undefined): AgentSettingsStore {
  if (!store) {
    throw extensionsCommandError(
      "SETTINGS_STORE_UNAVAILABLE",
      "Extension usage changes require the app-global agent settings store.",
    );
  }
  return store;
}

function validateUsageState(value: string): ExtensionUsageState {
  if (value === "loaded" || value === "available" || value === "unavailable") {
    return value;
  }
  throw extensionsCommandError(
    "invalid_argument",
    "Extension usage state must be loaded, available, or unavailable.",
  );
}

function validateDefaultUsageActor(value: string): ExternalInstructionActor {
  if (value === "orchestrator" || value === "handler" || value === "workflow-task") {
    return value;
  }
  throw extensionsCommandError(
    "invalid_argument",
    "Extension default actor must be orchestrator or workflow-task.",
  );
}

function normalizeDefaultExtensionOrder(ids: readonly string[], extensionsRoot?: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const rawId of ids) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    requireExtension(id, extensionsRoot);
    seen.add(id);
    order.push(id);
  }
  for (const id of builtinDefaultExtensionOrder()) {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const extension of listUserExtensions(extensionsRoot)) {
    if (!seen.has(extension.id)) {
      seen.add(extension.id);
      order.push(extension.id);
    }
  }
  return order;
}

function moveInstructionFileToTrash(
  paths: EditableInstructionPaths,
  extensionId: string,
  name: string,
  sourcePath: string,
): { trashId: string; trashPath: string } {
  const root = resolve(paths.sourceRoot, "..", "..", "..");
  const trashId = `trash_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const trashPath = join(root, "trash", trashId, "instructions", extensionId, name);
  mkdirSync(dirname(trashPath), { recursive: true });
  renameSync(sourcePath, trashPath);
  return { trashId, trashPath };
}

function resolveUsageProfile(
  store: AgentSettingsStore,
  requested: string,
):
  | {
      actor: "orchestrator" | "handler";
      agentProfileName: string;
      profile: AgentProfileSettings;
    }
  | {
      actor: "workflow-task";
      agentProfileName: string;
      profile: WorkflowAgentSettings;
    } {
  const settings = store.getState();
  if (requested === "threadHandler" || requested === DEFAULT_THREAD_HANDLER_PROFILE_ID) {
    return {
      actor: "handler",
      agentProfileName: "threadHandler",
      profile: settings.agents.special.threadHandler,
    };
  }
  const orchestrator = settings.agents.orchestrators.find((profile) => profile.id === requested);
  if (orchestrator) {
    return {
      actor: "orchestrator",
      agentProfileName: orchestrator.id,
      profile: orchestrator,
    };
  }
  const workflowAgent = settings.workflowAgents[requested];
  if (workflowAgent) {
    return {
      actor: "workflow-task",
      agentProfileName: workflowAgent.id,
      profile: workflowAgent,
    };
  }
  throw extensionsCommandError("AGENT_PROFILE_NOT_FOUND", `Agent profile not found: ${requested}`);
}

type UsageProfileTarget = ReturnType<typeof resolveUsageProfile>;

function setUsageProfile(
  store: AgentSettingsStore,
  target: UsageProfileTarget,
  extensionId: string,
  state: ExtensionUsageState,
  options: { explicit: boolean },
): void {
  const nextExtensionUsage = { ...profileExtensionUsageForTarget(target) };
  if (options.explicit) {
    nextExtensionUsage[extensionId] = state;
  } else {
    delete nextExtensionUsage[extensionId];
  }
  if (target.actor === "workflow-task") {
    store.setWorkflowAgent(target.profile.id, {
      ...target.profile,
      overrides: nextExtensionUsage,
    });
    return;
  }
  store.setAgentProfile({
    ...target.profile,
    extensionUsage: nextExtensionUsage,
  });
}

function profileExtensionUsageForTarget(
  target: UsageProfileTarget,
): Record<string, ExtensionUsageState> {
  return target.actor === "workflow-task"
    ? (target.profile.overrides ?? {})
    : target.profile.extensionUsage;
}

function profileWithoutExtensionUsage<T extends AgentProfileSettings | WorkflowAgentSettings>(
  profile: T,
  extensionId: string,
): T {
  const sourceUsage =
    "extensionUsage" in profile ? profile.extensionUsage : (profile.overrides ?? {});
  const extensionUsage = { ...sourceUsage };
  delete extensionUsage[extensionId];
  if (!("extensionUsage" in profile)) {
    return {
      ...profile,
      overrides: extensionUsage,
    };
  }
  return {
    ...profile,
    extensionUsage,
  };
}

function configuredExtensionUsageState(input: {
  actor: SvvyActorKind;
  agentSettingsStore?: AgentSettingsStore;
  extensionId: string;
  profile: AgentProfileSettings | WorkflowAgentSettings;
}): ExtensionUsageState {
  const defaults = input.agentSettingsStore?.getState().extensionDefaults;
  const profileExtensionUsage =
    "extensionUsage" in input.profile
      ? input.profile.extensionUsage
      : (input.profile.overrides ?? {});
  const state = resolveActorExtensionState({
    actor: input.actor,
    defaultExtensionOrder: defaults?.order,
    defaultExtensionUsage: defaults?.usage,
    profileExtensionUsage,
  });
  if (state.loadedExtensionIds.includes(input.extensionId)) {
    return "loaded";
  }
  if (state.availableExtensionIds.includes(input.extensionId)) {
    return "available";
  }
  return "unavailable";
}

function configuredDefaultExtensionUsageState(input: {
  actor: SvvyActorKind;
  agentSettingsStore?: AgentSettingsStore;
  extensionId: string;
  profile: AgentProfileSettings | WorkflowAgentSettings;
}): ExtensionUsageState {
  return configuredExtensionUsageState({
    actor: input.actor,
    agentSettingsStore: input.agentSettingsStore,
    extensionId: input.extensionId,
    profile: input.profile,
  });
}

function assertUsageStateAllowedForActor(input: {
  actor: SvvyActorKind;
  extension: ResolvedExtensionRecord;
  extensionId: string;
  requestedState: ExtensionUsageState;
}): void {
  void input;
}

function queueUsageAgentContextRefreshes(input: {
  store?: StructuredSessionStateStore;
  agentProfile: string;
  profileId: string;
  changeId: string;
}): Array<{
  surfacePiSessionId: string;
  kind: "agent_context_refresh";
  label: "Update agent context";
  reason: "extension_usage_changed";
}> {
  if (!input.store) {
    return [];
  }
  const queued: Array<{
    surfacePiSessionId: string;
    kind: "agent_context_refresh";
    label: "Update agent context";
    reason: "extension_usage_changed";
  }> = [];
  for (const snapshot of input.store.listSessionStates()) {
    if (snapshot.pi.orchestratorAgentProfileId === input.profileId) {
      input.store.enqueueSurfaceMessage({
        sessionId: snapshot.session.id,
        surfacePiSessionId: snapshot.pi.sessionId,
        threadId: null,
        kind: "agent_context_refresh",
        idempotencyKey: `agent_context_refresh:${snapshot.pi.sessionId}:extension_usage_changed:${input.changeId}`,
        messageJson: "{}",
        payloadJson: JSON.stringify({
          reason: "extension_usage_changed",
          changeId: input.changeId,
          agentProfile: input.agentProfile,
        }),
        requestSummary: "Update agent context",
        position: "front",
      });
      queued.push({
        surfacePiSessionId: snapshot.pi.sessionId,
        kind: "agent_context_refresh",
        label: "Update agent context",
        reason: "extension_usage_changed",
      });
    }
    if (input.agentProfile === "threadHandler") {
      for (const thread of snapshot.threads) {
        input.store.enqueueSurfaceMessage({
          sessionId: snapshot.session.id,
          surfacePiSessionId: thread.surfacePiSessionId,
          threadId: thread.id,
          kind: "agent_context_refresh",
          idempotencyKey: `agent_context_refresh:${thread.surfacePiSessionId}:extension_usage_changed:${input.changeId}`,
          messageJson: "{}",
          payloadJson: JSON.stringify({
            reason: "extension_usage_changed",
            changeId: input.changeId,
            agentProfile: input.agentProfile,
          }),
          requestSummary: "Update agent context",
          position: "front",
        });
        queued.push({
          surfacePiSessionId: thread.surfacePiSessionId,
          kind: "agent_context_refresh",
          label: "Update agent context",
          reason: "extension_usage_changed",
        });
      }
    }
  }
  return queued;
}

function queueSnapshotAgentContextRefreshes(input: {
  store?: StructuredSessionStateStore;
  snapshotId: string;
  affectedExtensionIds: readonly string[];
  affectedUsageProfiles: readonly string[];
  removedUserExtensionIds: readonly string[];
}): Array<{
  surfacePiSessionId: string;
  kind: "agent_context_refresh";
  label: "Update agent context";
  reason: "snapshot_loaded";
}> {
  if (!input.store) {
    return [];
  }
  const affectedExtensionIds = new Set(input.affectedExtensionIds);
  const affectedUsageProfiles = new Set(input.affectedUsageProfiles);
  const removedUserExtensionIds = new Set(input.removedUserExtensionIds);
  if (
    affectedExtensionIds.size === 0 &&
    affectedUsageProfiles.size === 0 &&
    removedUserExtensionIds.size === 0
  ) {
    return [];
  }
  const queued: Array<{
    surfacePiSessionId: string;
    kind: "agent_context_refresh";
    label: "Update agent context";
    reason: "snapshot_loaded";
  }> = [];
  for (const snapshot of input.store.listSessionStates()) {
    const piLoaded = snapshot.pi.loadedExtensionIds ?? [];
    const piAvailable = snapshot.pi.availableExtensionIds ?? [];
    if (
      extensionListsIntersect([piLoaded, piAvailable], affectedExtensionIds) ||
      affectedUsageProfiles.has(`orchestrator:${snapshot.pi.orchestratorAgentProfileId}`)
    ) {
      const nextPiLoaded = dropExtensionIds(piLoaded, removedUserExtensionIds);
      const nextPiAvailable = dropExtensionIds(piAvailable, removedUserExtensionIds);
      input.store.updatePiSessionExtensionState({
        sessionId: snapshot.pi.sessionId,
        loadedExtensionIds: nextPiLoaded,
        availableExtensionIds: nextPiAvailable,
      });
      enqueueSnapshotAgentContextRefresh({
        store: input.store,
        sessionId: snapshot.session.id,
        surfacePiSessionId: snapshot.pi.sessionId,
        threadId: null,
        snapshotId: input.snapshotId,
      });
      queued.push({
        surfacePiSessionId: snapshot.pi.sessionId,
        kind: "agent_context_refresh",
        label: "Update agent context",
        reason: "snapshot_loaded",
      });
    }
    for (const thread of snapshot.threads) {
      if (
        !extensionListsIntersect(
          [thread.loadedExtensionIds, thread.availableExtensionIds],
          affectedExtensionIds,
        ) &&
        !affectedUsageProfiles.has("handler:threadHandler")
      ) {
        continue;
      }
      const nextThreadLoaded = dropExtensionIds(thread.loadedExtensionIds, removedUserExtensionIds);
      const nextThreadAvailable = dropExtensionIds(
        thread.availableExtensionIds,
        removedUserExtensionIds,
      );
      input.store.updateThread({
        threadId: thread.id,
        loadedExtensionIds: nextThreadLoaded,
        availableExtensionIds: nextThreadAvailable,
      });
      enqueueSnapshotAgentContextRefresh({
        store: input.store,
        sessionId: snapshot.session.id,
        surfacePiSessionId: thread.surfacePiSessionId,
        threadId: thread.id,
        snapshotId: input.snapshotId,
      });
      queued.push({
        surfacePiSessionId: thread.surfacePiSessionId,
        kind: "agent_context_refresh",
        label: "Update agent context",
        reason: "snapshot_loaded",
      });
    }
  }
  return queued;
}

function enqueueSnapshotAgentContextRefresh(input: {
  store: StructuredSessionStateStore;
  sessionId: string;
  surfacePiSessionId: string;
  threadId: string | null;
  snapshotId: string;
}): void {
  input.store.enqueueSurfaceMessage({
    sessionId: input.sessionId,
    surfacePiSessionId: input.surfacePiSessionId,
    threadId: input.threadId,
    kind: "agent_context_refresh",
    idempotencyKey: `agent_context_refresh:${input.surfacePiSessionId}:snapshot_loaded:${input.snapshotId}`,
    messageJson: "{}",
    payloadJson: JSON.stringify({
      reason: "snapshot_loaded",
      snapshotId: input.snapshotId,
    }),
    requestSummary: "Update agent context",
    position: "front",
  });
}

function extensionListsIntersect(
  lists: readonly (readonly string[] | undefined)[],
  ids: ReadonlySet<string>,
): boolean {
  for (const list of lists) {
    for (const id of list ?? []) {
      if (ids.has(id)) {
        return true;
      }
    }
  }
  return false;
}

function dropExtensionIds(
  ids: readonly string[] | undefined,
  removed: ReadonlySet<string>,
): string[] {
  return [...(ids ?? [])].filter((id) => !removed.has(id)).toSorted();
}

async function runInspectCommand(
  words: string[],
  options: {
    buildRoot?: string;
    cliProbe?: SvvyxExtensionsCliProbe;
    cwd?: string;
    dependencyApprovalStore?: ExtensionDependencyApprovalStore;
    env?: NodeJS.ProcessEnv;
    envSecretStore?: ExtensionEnvSecretStore;
    externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
    extensionsRoot?: string;
    agentSettingsStore?: AgentSettingsStore;
  },
): Promise<SvvyxExtensionsCommandResult> {
  const { id, flags } = parseExtensionCommandArgs(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["json"]);
  const externalInstruction = inspectExternalInstruction(id, options.externalInstructionSources);
  if (externalInstruction) {
    return externalInstruction;
  }
  const baseExtension = requireExtension(id, options.extensionsRoot);
  const extension =
    baseExtension.category === "builtin"
      ? scaffoldBuiltinSource(baseExtension, options)
      : baseExtension;
  const cliRequirements = await resolveCliRequirements(extension, options);
  const envRequirements = resolveEnvRequirements(
    extension,
    extensionEnvValues(options.agentSettingsStore),
    options.envSecretStore,
  );
  const dependencyApprovalStore = resolveExtensionDependencyApprovalStore(options);
  const packageProject = extensionPackageProjectPath(options.extensionsRoot);
  const dependencies = resolveDependencyRequirements(extension.dependencies ?? [], {
    dependencyApprovalStore,
    packageProject,
  });
  const trustedDependencies = resolveDependencyRequirements(extension.trustedDependencies ?? [], {
    dependencyApprovalStore,
    packageProject,
  });
  const paths = extensionPaths(
    extension,
    options.cwd ?? process.cwd(),
    options.buildRoot,
    options.extensionsRoot,
  );
  const issues = extensionIssues(
    extension,
    cliRequirements,
    envRequirements,
    [...dependencies, ...trustedDependencies],
    paths.buildCurrent,
  );
  const hasCurrentBuild = extensionHasCurrentBuild(extension, paths.buildCurrent, issues);
  const draftChanged = issues.some((issue) => issue.code === "BUILD_REQUIRED");
  const buildRequired = issues.some((issue) =>
    [
      "BUILD_REQUIRED",
      "CLI_MISSING",
      "CLI_STATUS_UNKNOWN",
      "DEPENDENCY_APPROVAL_REQUIRED",
      "DEPENDENCY_INSTALL_MISSING",
      "NO_CURRENT_BUILD",
    ].includes(issue.code),
  );
  const output = {
    ok: true,
    extension: {
      id: extension.id,
      category: extension.category,
      interface: extension.interface,
      title: extension.title,
      description: extension.description,
      resettable: extension.resetBehavior !== "external_refresh",
      deletable: extension.deleteBehavior === "trash_allowed",
      typescriptApiEnabled: extension.typescriptApiEnabled,
      paths,
      usage:
        extension.category === "user"
          ? userExtensionUsageStates(extension.id, options.agentSettingsStore)
          : usageStates(extension.id, options.agentSettingsStore),
      requirements: {
        cliRequirements,
        env: envRequirements,
        dependencies,
        trustedDependencies,
      },
      state: {
        draftChanged,
        buildRequired,
        currentBuild: hasCurrentBuild
          ? {
              status: "ready",
            }
          : null,
        lastBuild: {
          status: hasCurrentBuild ? "success" : "never",
        },
        ready: issues.length === 0,
        issues,
      },
    },
  };
  return {
    output,
    commandFacts: {
      extensionId: extension.id,
      extensionReady: issues.length === 0,
      cliRequirementCount: cliRequirements.length,
      envRequirementCount: envRequirements.length,
      cliIssueCodes: issues.map((issue) => issue.code),
    },
  };
}

function inspectExternalInstruction(
  id: string,
  sources: readonly GeneratedAgentContextExternalSource[] | undefined,
): SvvyxExtensionsCommandResult | null {
  const source = sources?.find((candidate) => externalInstructionExtensionId(candidate) === id);
  if (!source) {
    return null;
  }
  const inventoryItem = externalInstructionInventoryItem(source);
  const issues = inventoryItem.state.issues;
  return {
    output: {
      ok: true,
      extension: {
        id: inventoryItem.id,
        category: inventoryItem.category,
        interface: inventoryItem.interface,
        title: inventoryItem.title,
        description: inventoryItem.description,
        resettable: false,
        deletable: false,
        typescriptApiEnabled: false,
        externalInstruction: inventoryItem.externalInstruction,
        paths: {
          externalInstructionFile: source.path,
          extensionSource: null,
          generatedRoot: null,
          instructionsFull: [],
          instructionsFullDir: null,
          instructionsMinimal: null,
          lockfile: null,
          manifest: null,
          packageJson: null,
          sourceRoot: null,
          typescriptTypes: null,
        },
        usage: inventoryItem.usage,
        requirements: {
          cliRequirements: [],
          env: [],
          dependencies: [],
          trustedDependencies: [],
        },
        state: {
          draftChanged: false,
          buildRequired: false,
          currentBuild: null,
          lastBuild: {
            status: "external_readonly",
          },
          ready: inventoryItem.state.ready,
          issues,
        },
      },
    },
    commandFacts: {
      extensionId: inventoryItem.id,
      extensionReady: inventoryItem.state.ready,
      externalInstructionPath: source.path,
      externalInstructionReadStatus: source.readStatus.status,
      cliRequirementCount: 0,
      envRequirementCount: 0,
      cliIssueCodes: issues.map((issue) => issue.code),
    },
  };
}

function extensionHasCurrentBuild(
  extension: ResolvedExtensionRecord,
  buildCurrent: string,
  issues: readonly ExtensionIssue[],
): boolean {
  if (isAppOwnedBuiltinSvvyxCommandNamespace(extension)) {
    return !issues.some(
      (issue) => issue.code === "CLI_MISSING" || issue.code === "CLI_STATUS_UNKNOWN",
    );
  }
  if (extensionSourceBuildIsTracked(extension)) {
    return existsSync(buildCurrent);
  }
  return !issues.some(
    (issue) => issue.code === "CLI_MISSING" || issue.code === "CLI_STATUS_UNKNOWN",
  );
}

async function runBuildCommand(
  words: string[],
  options: {
    agentSettingsStore?: AgentSettingsStore;
    buildRoot?: string;
    cliProbe?: SvvyxExtensionsCliProbe;
    cwd?: string;
    dependencyApprovalStore?: ExtensionDependencyApprovalStore;
    dependencyInstaller?: SvvyxExtensionsDependencyInstaller;
    env?: NodeJS.ProcessEnv;
    envSecretStore?: ExtensionEnvSecretStore;
    extensionsRoot?: string;
    recordDependencyBlockedOperation?: boolean;
    structuredSessionStore?: StructuredSessionStateStore;
  },
): Promise<SvvyxExtensionsCommandResult> {
  const { id, flags } = parseExtensionCommandArgs(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["json"]);
  const requestedExtension = requireExtension(id, options.extensionsRoot);
  const extension =
    requestedExtension.category === "builtin"
      ? scaffoldBuiltinSource(requestedExtension, {
          cwd: options.cwd,
          extensionsRoot: options.extensionsRoot,
        })
      : requestedExtension;
  const cliRequirements = await resolveCliRequirements(extension, options);
  const envRequirements = resolveEnvRequirements(
    extension,
    extensionEnvValues(options.agentSettingsStore),
    options.envSecretStore,
  );
  const validationError = validateExtensionBuildInput(extension, options.extensionsRoot);
  if (validationError) {
    return {
      output: validationError,
      commandFacts: {
        extensionBuildOk: false,
        extensionId: extension.id,
        validationError: validationError.error.code,
      },
    };
  }
  const blockingCli = cliRequirements.find(
    (requirement) => requirement.required && requirement.status !== "available",
  );
  if (blockingCli) {
    const missing = blockingCli.status === "missing";
    const output = {
      ok: false,
      error: {
        code: missing ? "CLI_MISSING" : "CLI_STATUS_UNKNOWN",
        message: missing
          ? `${blockingCli.binary} ${blockingCli.defaultVersion ?? ""}`.trim() +
            ` is required by ${extension.id} but was not found on PATH.`
          : `${blockingCli.binary} is required by ${extension.id}, but its version could not be determined.`,
        extensionId: extension.id,
        cli: blockingCli,
        nextSteps: missing
          ? [
              "Use the Extensions UI Install action, or run the install command from Shell when an agent is handling setup.",
              `Rerun \`svvyx extensions build ${extension.id} --json\` after installation.`,
            ]
          : [
              "Inspect the CLI manually, or repair it from the Extensions UI or Shell.",
              `Rerun \`svvyx extensions build ${extension.id} --json\` after repair.`,
            ],
      },
    };
    return {
      output,
      commandFacts: {
        extensionBuildOk: false,
        extensionId: extension.id,
        cliRequirementStatus: blockingCli.status,
        cliRequirementId: blockingCli.id,
      },
    };
  }

  const dependencyApprovalStore = resolveExtensionDependencyApprovalStore(options);
  const dependencyIdentities = [
    ...(extension.dependencies ?? []).map(extensionDependencyIdentityFromDeclaration),
    ...(extension.trustedDependencies ?? []).map(extensionDependencyIdentityFromDeclaration),
  ];
  const unapprovedDependencyIdentities = dependencyIdentities.filter(
    (identity) => !dependencyApprovalStore.hasApproved(identity),
  );
  dependencyApprovalStore.obsoletePendingRequestsForExtension({
    extensionId: extension.id,
    activeIdentities: unapprovedDependencyIdentities,
  });
  const dependencyApprovalRequest = dependencyApprovalStore.findOrCreatePendingRequest({
    extensionId: extension.id,
    identities: unapprovedDependencyIdentities,
  });
  const packageProject = extensionPackageProjectPath(options.extensionsRoot);
  const dependencies = resolveDependencyRequirements(extension.dependencies ?? [], {
    dependencyApprovalRequest,
    dependencyApprovalStore,
    packageProject,
  });
  const trustedDependencies = resolveDependencyRequirements(extension.trustedDependencies ?? [], {
    dependencyApprovalRequest,
    dependencyApprovalStore,
    packageProject,
  });
  if (dependencyApprovalRequest) {
    if (options.recordDependencyBlockedOperation !== false) {
      dependencyApprovalStore.upsertBlockedOperation({
        requestId: dependencyApprovalRequest.requestId,
        blockedOperation: "build",
        extensionIds: [extension.id],
      });
    }
    return {
      output: {
        ok: false,
        status: "needs_user_confirmation",
        approvalRequestId: dependencyApprovalRequest.requestId,
        extensionId: extension.id,
        blockedOperation: "build",
        packageProject,
        items: dependencyApprovalItems(dependencyApprovalRequest),
        message: "Installing these dependency identities requires user approval.",
        requirements: {
          cliRequirements,
          env: envRequirements,
          dependencies,
          trustedDependencies,
        },
      },
      commandFacts: {
        extensionBuildOk: false,
        extensionId: extension.id,
        dependencyApprovalRequestId: dependencyApprovalRequest.requestId,
        blockedOperation: "build",
      },
    };
  }
  const installIdentities = (extension.dependencies ?? []).map(
    extensionDependencyIdentityFromDeclaration,
  );
  const trustedInstallIdentities = (extension.trustedDependencies ?? []).map(
    extensionDependencyIdentityFromDeclaration,
  );
  if (installIdentities.length > 0 || trustedInstallIdentities.length > 0) {
    const installer = options.dependencyInstaller ?? installExtensionDependencies;
    const packageInstallPlan = approvedPackageInstallPlan({
      buildRoot: options.buildRoot,
      currentDependencies: installIdentities,
      currentTrustedDependencies: trustedInstallIdentities,
      dependencyApprovalStore,
      extensionsRoot: options.extensionsRoot,
    });
    const installResult = await installer({
      dependencies: packageInstallPlan.dependencies,
      packageProject,
      trustedDependencies: packageInstallPlan.trustedDependencies,
    });
    if (!installResult.ok) {
      const output = {
        ok: false,
        error: {
          ...installResult.error,
          extensionId: extension.id,
          packageProject: installResult.packageProject,
          command: installResult.command,
        },
        requirements: {
          cliRequirements,
          env: envRequirements,
          dependencies: resolveDependencyRequirements(extension.dependencies ?? [], {
            dependencyApprovalStore,
            packageProject,
          }),
          trustedDependencies: resolveDependencyRequirements(extension.trustedDependencies ?? [], {
            dependencyApprovalStore,
            packageProject,
          }),
        },
      };
      return {
        output,
        commandFacts: {
          extensionBuildOk: false,
          extensionId: extension.id,
          dependencyInstallOk: false,
          dependencyInstallError: installResult.error.code,
        },
      };
    }
    const missingArtifacts = [
      ...resolveDependencyRequirements(extension.dependencies ?? [], {
        dependencyApprovalStore,
        packageProject,
      }),
      ...resolveDependencyRequirements(extension.trustedDependencies ?? [], {
        dependencyApprovalStore,
        packageProject,
      }),
    ].filter((dependency) => dependency.install !== "installed");
    if (missingArtifacts.length > 0) {
      const output = {
        ok: false,
        error: {
          code: "DEPENDENCY_INSTALL_MISSING",
          message: `Installed package artifacts are missing for ${extension.id}.`,
          extensionId: extension.id,
          packageProject,
          missing: missingArtifacts.map((dependency) => ({
            kind: dependency.kind,
            name: dependency.name,
            version: dependency.version,
            install: dependency.install,
          })),
        },
        requirements: {
          cliRequirements,
          env: envRequirements,
          dependencies: resolveDependencyRequirements(extension.dependencies ?? [], {
            dependencyApprovalStore,
            packageProject,
          }),
          trustedDependencies: resolveDependencyRequirements(extension.trustedDependencies ?? [], {
            dependencyApprovalStore,
            packageProject,
          }),
        },
      };
      return {
        output,
        commandFacts: {
          extensionBuildOk: false,
          extensionId: extension.id,
          dependencyInstallOk: false,
          dependencyInstallError: "DEPENDENCY_INSTALL_MISSING",
        },
      };
    }
  }
  const installedDependencies = resolveDependencyRequirements(extension.dependencies ?? [], {
    dependencyApprovalStore,
    packageProject,
  });
  const installedTrustedDependencies = resolveDependencyRequirements(
    extension.trustedDependencies ?? [],
    {
      dependencyApprovalStore,
      packageProject,
    },
  );
  const generatedInstructionResult = runGeneratedInstructionScripts(extension, cliRequirements, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
  });
  if (!generatedInstructionResult.ok) {
    return {
      output: {
        ok: false,
        error: generatedInstructionResult.error,
      },
      commandFacts: {
        extensionBuildOk: false,
        extensionId: extension.id,
        validationError: generatedInstructionResult.error.code,
      },
    };
  }

  const currentPath = extensionBuildCurrentPath(
    extension.id,
    options.buildRoot,
    options.extensionsRoot,
  );
  const stagingPath = extensionBuildStagingPath(
    extension.id,
    options.buildRoot,
    options.extensionsRoot,
  );
  mkdirSync(stagingPath, { recursive: true });
  let runtimeModule: string | null = null;
  let commandManifest: SvvyxCommandManifest | null = null;
  if (
    extension.interface === "svvyx" &&
    extension.sourceRoot &&
    !isAppOwnedBuiltinSvvyxCommandNamespace(extension)
  ) {
    const sourcePath = join(
      extension.sourceRoot ?? extensionSourceRoot(options.extensionsRoot, extension.id),
      "source",
      "index.ts",
    );
    const builtRuntime = await buildSvvyxRuntimeModule(extension.id, sourcePath, stagingPath);
    if (!builtRuntime.ok) {
      rmSync(stagingPath, { force: true, recursive: true });
      return {
        output: builtRuntime.output,
        commandFacts: {
          extensionBuildOk: false,
          extensionId: extension.id,
          validationError: builtRuntime.output.error.code,
        },
      };
    }
    runtimeModule = builtRuntime.module;
    commandManifest = builtRuntime.commandManifest;
  }
  const generatedPaths = extensionPaths(
    extension,
    options.cwd ?? process.cwd(),
    options.buildRoot,
    options.extensionsRoot,
  );
  const buildManifest: Record<string, unknown> = {
    schemaVersion: 1,
    extensionId: extension.id,
    interface: extension.interface,
    module: runtimeModule,
    commandManifest,
    typescriptTypes: extension.typescriptApiEnabled ? generatedPaths.typescriptTypes : null,
    sourceFingerprint: extension.extensionBuildFingerprint ?? null,
    env: (extension.envDeclarations ?? []).map((declaration) => ({
      name: declaration.name,
      required: declaration.required,
      secret: declaration.secret,
      description: declaration.description,
      ...(declaration.default !== undefined ? { default: declaration.default } : {}),
    })),
    dependencies: [...(extension.dependencies ?? []), ...(extension.trustedDependencies ?? [])].map(
      (dependency) => ({
        kind: dependency.kind,
        name: dependency.name,
        version: dependency.version,
      }),
    ),
  };
  writeFileSync(join(stagingPath, "manifest.json"), JSON.stringify(buildManifest, null, 2) + "\n");
  let generatedExtensionsPackagePath = "";
  promoteExtensionBuild(stagingPath, currentPath, () => {
    generatedExtensionsPackagePath = refreshGeneratedExtensionsPackage({
      extensionsRoot: options.extensionsRoot,
    }).generatedPackagePath;
    writeSvvyxCommandSchema({
      commandManifest,
      commandsPath: join(generatedPaths.generatedRoot, "commands.json"),
    });
    writeUserSvvyxTypescriptDeclaration({
      commandManifest,
      extension,
      typescriptTypesPath: generatedPaths.typescriptTypes,
    });
  });
  if (!generatedExtensionsPackagePath) {
    throw new Error("Generated Extensions package refresh did not run.");
  }
  const runtimeReady =
    !envRequirements.some((requirement) => requirement.status === "missing") &&
    [...installedDependencies, ...installedTrustedDependencies].every(
      (dependency) => dependency.install === "installed",
    );
  const issues = envRequirements
    .filter((requirement) => requirement.status === "missing")
    .map(
      (requirement): ExtensionIssue => ({
        code: "EXTENSION_ENV_MISSING",
        message: `${extension.title} requires ${requirement.name}. Configure it in the Extensions pane.`,
      }),
    );
  for (const dependency of [...installedDependencies, ...installedTrustedDependencies]) {
    if (dependency.approval === "approved") {
      continue;
    }
    issues.push({
      code: "DEPENDENCY_APPROVAL_REQUIRED",
      message: `${extension.title} dependency ${dependency.name} requires approval before runtime use.`,
    });
  }
  const output = {
    ok: true,
    extensionId: extension.id,
    build: {
      status: "success",
      interface: extension.interface,
      activated: true,
      contextReady: true,
      runtimeReady,
      currentPath,
    },
    requirements: {
      cliRequirements,
      env: envRequirements,
      dependencies: installedDependencies,
      trustedDependencies: installedTrustedDependencies,
    },
    contextReady: true,
    runtimeReady,
    issues,
    generated: {
      typescriptTypes: generatedPaths.typescriptTypes,
      extensionsPackage: generatedExtensionsPackagePath,
    },
    ...(cliRequirements.some(
      (requirement) =>
        requirement.status === "available" &&
        requirement.updateAvailable &&
        requirement.updateCommand,
    )
      ? {
          nextSteps: [
            "Use the detected CLI for generated instructions until the user or an agent chooses to update.",
            "Use the Extensions UI Update action, or run the update command from Shell when an agent is handling setup.",
          ],
        }
      : {}),
  };
  return {
    output,
    commandFacts: {
      extensionBuildOk: true,
      extensionId: extension.id,
      cliRequirementCount: cliRequirements.length,
      envRequirementCount: envRequirements.length,
    },
  };
}

function runDeleteCommand(
  words: string[],
  options: {
    extensionsRoot?: string;
  },
): SvvyxExtensionsCommandResult {
  const { id, flags } = parseExtensionCommandArgs(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["json"]);
  const extension = requireExtension(id, options.extensionsRoot);
  if (extension.category !== "user" || !extension.sourceRoot) {
    throw extensionsCommandError(
      extension.category === "builtin" ? "BUILTIN_NOT_DELETABLE" : "EXTENSION_NOT_DELETABLE",
      extension.category === "builtin"
        ? "Builtin extensions cannot be deleted. Use reset instead."
        : `${extension.title} cannot be deleted.`,
    );
  }
  const root = resolve(options.extensionsRoot ?? defaultExtensionsRoot());
  const trashId = `trash_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const trashSourceRoot = join(root, "trash", trashId, "sources", "user", extension.id);
  const changeId = recordExtensionDeleteChange({
    extensionsRoot: root,
    extensionId: extension.id,
    sourceRoot: extension.sourceRoot,
    trashId,
    trashSourceRoot,
  });
  try {
    mkdirSync(dirname(trashSourceRoot), { recursive: true });
    renameSync(extension.sourceRoot, trashSourceRoot);
  } catch (error) {
    rmSync(join(extensionGlobalChangesRoot(root), `${changeId}.json`), { force: true });
    throw error;
  }
  return {
    output: {
      ok: true,
      changeId,
      extensionId: extension.id,
      deleted: true,
      trashId,
    },
    commandFacts: {
      extensionDeleted: true,
      extensionId: extension.id,
      changeId,
      trashId,
    },
  };
}

async function runResetCommand(
  words: string[],
  options: {
    agentSettingsStore?: AgentSettingsStore;
    buildRoot?: string;
    cliProbe?: SvvyxExtensionsCliProbe;
    cwd?: string;
    dependencyApprovalStore?: ExtensionDependencyApprovalStore;
    dependencyInstaller?: SvvyxExtensionsDependencyInstaller;
    env?: NodeJS.ProcessEnv;
    envSecretStore?: ExtensionEnvSecretStore;
    extensionsRoot?: string;
    structuredSessionStore?: StructuredSessionStateStore;
  },
): Promise<SvvyxExtensionsCommandResult> {
  const { id, flags } = parseExtensionCommandArgs(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["json", "scope"]);
  const scope = requireSingleFlagValue(flags, "scope");
  if (scope !== "instructions") {
    throw extensionsCommandError(
      "UNSUPPORTED_RESET_SCOPE",
      "Only --scope instructions is currently resettable.",
    );
  }

  const extension = requireExtension(id, options.extensionsRoot);
  if (extension.category !== "builtin") {
    throw extensionsCommandError(
      "NOT_BUILTIN",
      "Only builtin extensions can be reset to builtin defaults.",
    );
  }
  const packaged = getExtensionRecord(extension.id);
  if (!packaged) {
    throw extensionsCommandError(
      "NOT_BUILTIN",
      "Only builtin extensions can be reset to builtin defaults.",
    );
  }
  const defaultFiles = builtinDefaultInstructionFiles(packaged, options.cwd ?? process.cwd());

  const source = scaffoldBuiltinSource(packaged, options);
  const paths = editableExtensionInspectPaths(source, options.extensionsRoot);
  const before = captureInstructionSnapshot(paths);

  mkdirSync(paths.instructionsFullDir, { recursive: true });
  for (const file of readdirSync(paths.instructionsFullDir)) {
    if (file.endsWith(".md")) {
      rmSync(join(paths.instructionsFullDir, file), { force: true });
    }
  }
  for (const file of defaultFiles) {
    writeFileSync(join(paths.instructionsFullDir, file.name), file.content);
  }
  mkdirSync(dirname(paths.instructionsMinimal), { recursive: true });
  writeFileSync(paths.instructionsMinimal, packaged.minimalLoadingHint + "\n");
  for (const instruction of packaged.generatedInstructions ?? []) {
    const target = join(paths.sourceRoot, instruction.script);
    rmSync(target, { force: true });
  }
  if (paths.extensionSource) {
    rmSync(join(paths.extensionSource, "index.ts"), { force: true });
  }
  scaffoldBuiltinGeneratedInstructionScripts(packaged, paths, options.cwd ?? process.cwd());
  scaffoldBuiltinSvvyxSource(packaged, paths);

  const manifest = readJsonObject(paths.manifest);
  manifest.interface = packaged.interface;
  manifest.title = packaged.title;
  manifest.description = packaged.description;
  manifest.typescriptApiEnabled = packaged.typescriptApiEnabled;
  manifest.instructionFiles = builtinDefaultInstructionEntries(packaged, defaultFiles);
  if (packaged.generatedInstructions && packaged.generatedInstructions.length > 0) {
    manifest.generatedInstructions = packaged.generatedInstructions;
  } else {
    delete manifest.generatedInstructions;
  }
  writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2) + "\n");

  const resetExtension = readBuiltinSourceRecord(packaged, options.extensionsRoot) ?? source;
  const afterPaths = editableExtensionInspectPaths(resetExtension, options.extensionsRoot);
  const after = captureInstructionSnapshot(afterPaths);
  const changeId = recordInstructionLifecycleChange(
    afterPaths,
    packaged.id,
    "instructions_reset",
    before,
    after,
  );
  const autoBuildResult = await runBuildCommand([packaged.id, "--json"], options);
  const autoBuild = projectAutoBuildResult(autoBuildResult);
  const buildRequired = autoBuild.status !== "success";
  return {
    output: {
      ok: true,
      changeId,
      extensionId: packaged.id,
      scope: "instructions",
      result: {
        resetFiles: changedInstructionSnapshotPaths(before, after, paths.manifest),
        buildRequired,
        autoBuild,
      },
    },
    commandFacts: {
      ...autoBuildResult.commandFacts,
      extensionReset: true,
      extensionId: packaged.id,
      changeId,
      scope: "instructions",
      extensionReady: autoBuild.status === "success" && autoBuild.runtimeReady,
      autoBuildStatus: autoBuild.status,
      ...(autoBuild.status === "needs_user_confirmation"
        ? { blockedOperation: autoBuild.blockedOperation }
        : {}),
    },
  };
}

async function runSnapshotsCommand(
  words: string[],
  options: {
    agentSettingsStore?: AgentSettingsStore;
    buildRoot?: string;
    cliProbe?: SvvyxExtensionsCliProbe;
    cwd?: string;
    dependencyApprovalStore?: ExtensionDependencyApprovalStore;
    dependencyInstaller?: SvvyxExtensionsDependencyInstaller;
    env?: NodeJS.ProcessEnv;
    envSecretStore?: ExtensionEnvSecretStore;
    extensionsRoot?: string;
  },
): Promise<SvvyxExtensionsCommandResult> {
  const action = words[0];
  if (!action) {
    throw extensionsCommandError("invalid_argument", "Missing snapshots command.");
  }
  const root = resolve(options.extensionsRoot ?? defaultExtensionsRoot());
  if (action === "list") {
    const flags = parseFlags(words.slice(1));
    requireJson(flags);
    rejectUnknownFlags(flags, ["json"]);
    return {
      output: {
        ok: true,
        snapshots: listExtensionSnapshotSummaries(root, {
          agentSettingsStore: options.agentSettingsStore,
          envSecretStore: options.envSecretStore,
        }),
      },
      commandFacts: {
        extensionSnapshotsListed: true,
      },
    };
  }
  if (action === "save") {
    const flags = parseFlags(words.slice(1));
    requireJson(flags);
    rejectUnknownFlags(flags, ["json", "name"]);
    const name = requireSingleFlagValue(flags, "name").trim();
    if (name.length === 0) {
      throw extensionsCommandError("INVALID_SNAPSHOT_NAME", "Snapshot name cannot be empty.");
    }
    const snapshot = saveExtensionSnapshot(root, name, {
      agentSettingsStore: options.agentSettingsStore,
      envSecretStore: options.envSecretStore,
    });
    return {
      output: {
        ok: true,
        snapshot,
      },
      commandFacts: {
        extensionSnapshotSaved: true,
        snapshotId: snapshot.id,
        extensionCount: snapshot.extensionCount,
      },
    };
  }
  if (action === "rename") {
    const snapshotId = words[1];
    if (!snapshotId || snapshotId.startsWith("--")) {
      throw extensionsCommandError("invalid_argument", "Missing snapshot id.");
    }
    const flags = parseFlags(words.slice(2));
    requireJson(flags);
    rejectUnknownFlags(flags, ["json", "name"]);
    const name = requireSingleFlagValue(flags, "name").trim();
    if (name.length === 0) {
      throw extensionsCommandError("INVALID_SNAPSHOT_NAME", "Snapshot name cannot be empty.");
    }
    const snapshot = renameExtensionSnapshot(root, snapshotId, name);
    return {
      output: {
        ok: true,
        snapshot,
      },
      commandFacts: {
        extensionSnapshotRenamed: true,
        snapshotId: snapshot.id,
      },
    };
  }
  if (action === "delete") {
    const snapshotId = words[1];
    if (!snapshotId || snapshotId.startsWith("--")) {
      throw extensionsCommandError("invalid_argument", "Missing snapshot id.");
    }
    const flags = parseFlags(words.slice(2));
    requireJson(flags);
    rejectUnknownFlags(flags, ["json"]);
    deleteExtensionSnapshot(root, snapshotId, options.envSecretStore);
    return {
      output: {
        ok: true,
        snapshotId,
        deleted: true,
      },
      commandFacts: {
        extensionSnapshotDeleted: true,
        snapshotId,
      },
    };
  }
  if (action === "load") {
    const snapshotId = words[1];
    if (!snapshotId || snapshotId.startsWith("--")) {
      throw extensionsCommandError("invalid_argument", "Missing snapshot id.");
    }
    const flags = parseFlags(words.slice(2));
    requireJson(flags);
    rejectUnknownFlags(flags, ["json"]);
    const loaded = await loadExtensionSnapshot(root, snapshotId, options);
    return loaded;
  }
  throw extensionsCommandError("unsupported_command", `Unsupported snapshots command: ${action}`);
}

type ExtensionSnapshotSummary = {
  extensionCount: number;
  hasSecretState: boolean;
  id: string;
  name: string;
  status: "available";
};

const INITIAL_EXTENSION_SNAPSHOT_ID = "snap_initial";
const INITIAL_EXTENSION_SNAPSHOT_NAME = "Initial";

export function listExtensionSnapshotSummaries(
  root: string | undefined,
  options: {
    agentSettingsStore?: AgentSettingsStore;
    envSecretStore?: ExtensionEnvSecretStore;
  } = {},
): ExtensionSnapshotReadModel[] {
  const resolvedRoot = resolve(root ?? defaultExtensionsRoot());
  const snapshotsRoot = join(resolvedRoot, "snapshots");
  ensureInitialExtensionSnapshot(resolvedRoot, options);
  return listImmediateDirectories(snapshotsRoot)
    .map((id) => readSnapshotSummary(resolvedRoot, id))
    .toSorted(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
}

function saveExtensionSnapshot(
  root: string,
  name: string,
  options: {
    agentSettingsStore?: AgentSettingsStore;
    envSecretStore?: ExtensionEnvSecretStore;
    snapshotId?: string;
  } = {},
): ExtensionSnapshotSummary {
  const snapshotId =
    options.snapshotId ??
    `snap_${new Date().toISOString().slice(0, 10).replaceAll("-", "_")}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const snapshotRoot = snapshotPath(root, snapshotId);
  if (existsSync(snapshotRoot)) {
    throw extensionsCommandError(
      "SNAPSHOT_EXISTS",
      `Extension snapshot already exists: ${snapshotId}`,
    );
  }
  mkdirSync(snapshotRoot, { recursive: true });
  copySnapshotDirectory(join(root, "sources", "user"), join(snapshotRoot, "sources", "user"));
  copySnapshotDirectory(join(root, "sources", "builtin"), join(snapshotRoot, "sources", "builtin"));
  copySnapshotPackage(root, snapshotRoot);
  writeSnapshotRegistryState(root, snapshotRoot, options.agentSettingsStore);
  const preservedSecretCount = preserveSnapshotSecretState(
    root,
    snapshotId,
    options.envSecretStore,
  );
  const summary: ExtensionSnapshotSummary = {
    id: snapshotId,
    name,
    extensionCount: countSnapshotExtensions(snapshotRoot),
    hasSecretState: preservedSecretCount > 0,
    status: "available",
  };
  writeSnapshotMetadata(snapshotRoot, summary);
  return summary;
}

function ensureInitialExtensionSnapshot(
  root: string,
  options: {
    agentSettingsStore?: AgentSettingsStore;
    envSecretStore?: ExtensionEnvSecretStore;
  } = {},
): void {
  const snapshotsRoot = join(root, "snapshots");
  if (listImmediateDirectories(snapshotsRoot).length > 0) {
    return;
  }
  saveExtensionSnapshot(root, INITIAL_EXTENSION_SNAPSHOT_NAME, {
    ...options,
    snapshotId: INITIAL_EXTENSION_SNAPSHOT_ID,
  });
}

function renameExtensionSnapshot(
  root: string,
  snapshotId: string,
  name: string,
): ExtensionSnapshotSummary {
  const summary = readSnapshotSummary(root, snapshotId);
  const next = {
    ...summary,
    name,
  };
  writeSnapshotMetadata(snapshotPath(root, snapshotId), next);
  return next;
}

function deleteExtensionSnapshot(
  root: string,
  snapshotId: string,
  envSecretStore?: ExtensionEnvSecretStore,
): void {
  const path = snapshotPath(root, snapshotId);
  if (!existsSync(path)) {
    throw extensionsCommandError(
      "SNAPSHOT_NOT_FOUND",
      `Extension snapshot not found: ${snapshotId}`,
    );
  }
  rmSync(path, { force: true, recursive: true });
  envSecretStore?.remove(snapshotSecretStateKey(snapshotId));
}

async function loadExtensionSnapshot(
  root: string,
  snapshotId: string,
  options: {
    agentSettingsStore?: AgentSettingsStore;
    buildRoot?: string;
    cliProbe?: SvvyxExtensionsCliProbe;
    cwd?: string;
    dependencyApprovalStore?: ExtensionDependencyApprovalStore;
    dependencyInstaller?: SvvyxExtensionsDependencyInstaller;
    env?: NodeJS.ProcessEnv;
    envSecretStore?: ExtensionEnvSecretStore;
    extensionsRoot?: string;
    structuredSessionStore?: StructuredSessionStateStore;
  },
): Promise<SvvyxExtensionsCommandResult> {
  const summary = readSnapshotSummary(root, snapshotId);
  const snapshotRoot = snapshotPath(root, snapshotId);
  const snapshotUserRoot = join(snapshotRoot, "sources", "user");
  const snapshotBuiltinSourceRoot = join(snapshotRoot, "sources", "builtin");
  const liveUserRoot = join(root, "sources", "user");
  const liveBuiltinSourceRoot = join(root, "sources", "builtin");
  const liveUserExtensionIdsBeforeLoad = listImmediateDirectories(liveUserRoot);
  const liveBuiltinSourceIdsBeforeLoad = listImmediateDirectories(liveBuiltinSourceRoot);

  replaceDirectoryFromSnapshot(snapshotUserRoot, liveUserRoot);
  replaceDirectoryFromSnapshot(snapshotBuiltinSourceRoot, liveBuiltinSourceRoot);
  restoreSnapshotPackageState(root, snapshotRoot);
  const restoredUsageStates = restoreSnapshotUsageStates(snapshotRoot, options.agentSettingsStore);
  const secretState = restoreSnapshotSecretState(
    snapshotId,
    options.envSecretStore,
    summary.hasSecretState,
  );

  const restoredUserExtensionIds = listImmediateDirectories(liveUserRoot);
  const restoredBuiltinSourceIds = listImmediateDirectories(liveBuiltinSourceRoot);
  const restoredExtensionIds = [...restoredUserExtensionIds, ...restoredBuiltinSourceIds].toSorted(
    (left, right) => left.localeCompare(right),
  );
  const removedUserExtensionIds = liveUserExtensionIdsBeforeLoad.filter(
    (extensionId) => !restoredUserExtensionIds.includes(extensionId),
  );
  const removedBuiltinSourceIds = liveBuiltinSourceIdsBeforeLoad.filter(
    (extensionId) => !restoredBuiltinSourceIds.includes(extensionId),
  );
  const buildResults: unknown[] = [];
  for (const extensionId of restoredExtensionIds) {
    const autoBuildResult = await runBuildCommand([extensionId, "--json"], {
      ...options,
      extensionsRoot: root,
      recordDependencyBlockedOperation: false,
    });
    const autoBuild = projectAutoBuildResult(autoBuildResult, "snapshot_load");
    if (autoBuild.status === "needs_user_confirmation") {
      resolveExtensionDependencyApprovalStore(options).upsertBlockedOperation({
        requestId: autoBuild.approvalRequestId,
        blockedOperation: "snapshot_load",
        extensionIds: restoredExtensionIds,
        resumeFingerprint: snapshotResumeFingerprint(root),
        snapshotId,
      });
      return {
        output: {
          ok: false,
          status: "needs_user_confirmation",
          approvalRequestId: autoBuild.approvalRequestId,
          snapshotId,
          blockedOperation: "snapshot_load",
          items: autoBuild.items,
          message: autoBuild.message,
        },
        commandFacts: {
          extensionSnapshotLoaded: false,
          snapshotId,
          dependencyApprovalRequestId: autoBuild.approvalRequestId,
          blockedOperation: "snapshot_load",
        },
      };
    }
    buildResults.push({
      extensionId,
      ...snapshotLoadAutoBuildResult(autoBuild),
    });
    if (autoBuild.status === "blocked") {
      return {
        output: {
          ok: false,
          status: "blocked",
          snapshotId,
          builds: buildResults,
        },
        commandFacts: {
          extensionSnapshotLoaded: false,
          snapshotId,
          blockedOperation: "snapshot_load",
        },
      };
    }
  }
  const queuedUpdates = queueSnapshotAgentContextRefreshes({
    store: options.structuredSessionStore,
    snapshotId,
    affectedExtensionIds: [
      ...restoredExtensionIds,
      ...removedUserExtensionIds,
      ...removedBuiltinSourceIds,
    ],
    affectedUsageProfiles: restoredUsageStates.affectedProfiles,
    removedUserExtensionIds,
  });

  return {
    output: {
      ok: true,
      snapshotId,
      restored: {
        extensions: restoredExtensionIds,
        usageStates: restoredUsageStates.restored,
        packageState: existsSync(join(snapshotRoot, "package")) ? "restored" : "not_present",
        secretState,
      },
      builds: buildResults,
      agentContextImpact: {
        queuedUpdates,
      },
    },
    commandFacts: {
      extensionSnapshotLoaded: true,
      snapshotId,
      restoredExtensionCount: restoredExtensionIds.length,
      buildCount: buildResults.length,
    },
  };
}

function readSnapshotSummary(root: string, snapshotId: string): ExtensionSnapshotSummary {
  validateSnapshotId(snapshotId);
  const metadataPath = join(snapshotPath(root, snapshotId), "metadata.json");
  if (!existsSync(metadataPath)) {
    throw extensionsCommandError(
      "SNAPSHOT_NOT_FOUND",
      `Extension snapshot not found: ${snapshotId}`,
    );
  }
  const metadata = readJsonObject(metadataPath);
  if (
    metadata.schemaVersion !== 1 ||
    metadata.id !== snapshotId ||
    typeof metadata.name !== "string" ||
    typeof metadata.extensionCount !== "number" ||
    typeof metadata.hasSecretState !== "boolean" ||
    metadata.status !== "available"
  ) {
    throw extensionsCommandError("INVALID_SNAPSHOT", `Invalid extension snapshot: ${snapshotId}`);
  }
  return {
    id: snapshotId,
    name: metadata.name,
    extensionCount: metadata.extensionCount,
    hasSecretState: metadata.hasSecretState,
    status: "available",
  };
}

function writeSnapshotMetadata(snapshotRoot: string, summary: ExtensionSnapshotSummary): void {
  writeFileSync(
    join(snapshotRoot, "metadata.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        ...summary,
      },
      null,
      2,
    ) + "\n",
  );
}

function copySnapshotDirectory(from: string, to: string): void {
  if (!existsSync(from)) {
    return;
  }
  cpSync(from, to, {
    recursive: true,
    dereference: false,
    filter(source) {
      const entryName = source.split("/").at(-1);
      return entryName !== "node_modules" && entryName !== "builds" && entryName !== "generated";
    },
  });
}

function copySnapshotPackage(root: string, snapshotRoot: string): void {
  const packageRoot = join(root, "package");
  const targetRoot = join(snapshotRoot, "package");
  for (const file of ["package.json", "bun.lock"]) {
    const source = join(packageRoot, file);
    if (!existsSync(source)) {
      continue;
    }
    if (!snapshotPackageFileIsSafe(source)) {
      continue;
    }
    mkdirSync(targetRoot, { recursive: true });
    cpSync(source, join(targetRoot, file), { dereference: false });
  }
}

function replaceDirectoryFromSnapshot(from: string, to: string): void {
  rmSync(to, { force: true, recursive: true });
  if (!existsSync(from)) {
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  copySnapshotDirectory(from, to);
}

function restoreSnapshotPackageState(root: string, snapshotRoot: string): void {
  const packageRoot = join(root, "package");
  const snapshotPackageRoot = join(snapshotRoot, "package");
  mkdirSync(packageRoot, { recursive: true });
  rmSync(join(packageRoot, "node_modules"), { force: true, recursive: true });
  for (const file of ["package.json", "bun.lock"]) {
    const livePath = join(packageRoot, file);
    const snapshotFile = join(snapshotPackageRoot, file);
    if (existsSync(snapshotFile)) {
      cpSync(snapshotFile, livePath, { dereference: false });
    } else {
      rmSync(livePath, { force: true });
    }
  }
}

function snapshotResumeFingerprint(root: string): string {
  const hash = createHash("sha256");
  for (const relativeRoot of [join("sources", "user"), join("sources", "builtin"), "package"]) {
    const absoluteRoot = join(root, relativeRoot);
    if (!existsSync(absoluteRoot)) {
      hash.update(relativeRoot);
      hash.update("\0missing\0");
      continue;
    }
    const files = listBuildInputFiles(absoluteRoot).filter((file) => {
      const relative = file.slice(absoluteRoot.length + 1);
      return !relative.split("/").includes("node_modules");
    });
    for (const file of files) {
      hash.update(relativeRoot);
      hash.update("/");
      hash.update(file.slice(absoluteRoot.length + 1));
      hash.update("\0");
      hash.update(readFileSync(file));
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

type SnapshotSecretState = {
  schemaVersion: 1;
  records: Array<{
    extensionId: string;
    name: string;
    value: string;
  }>;
};

function preserveSnapshotSecretState(
  root: string,
  snapshotId: string,
  envSecretStore: ExtensionEnvSecretStore | undefined,
): number {
  if (!envSecretStore) {
    return 0;
  }
  const records: SnapshotSecretState["records"] = [];
  for (const extension of snapshotSecretSourceExtensions(root)) {
    for (const declaration of extension.envDeclarations ?? []) {
      if (!declaration.secret) {
        continue;
      }
      const key = {
        extensionId: extension.id,
        name: declaration.name,
      };
      if (!envSecretStore.has(key)) {
        continue;
      }
      const value = envSecretStore.get(key);
      if (value === undefined) {
        continue;
      }
      records.push({
        extensionId: extension.id,
        name: declaration.name,
        value,
      });
    }
  }
  if (records.length === 0) {
    envSecretStore.remove(snapshotSecretStateKey(snapshotId));
    return 0;
  }
  envSecretStore.set(
    snapshotSecretStateKey(snapshotId),
    JSON.stringify({
      schemaVersion: 1,
      records,
    } satisfies SnapshotSecretState),
  );
  return records.length;
}

function restoreSnapshotSecretState(
  snapshotId: string,
  envSecretStore: ExtensionEnvSecretStore | undefined,
  hasSecretState: boolean,
): {
  status: "not_present" | "restored" | "unavailable";
} {
  if (!hasSecretState) {
    return {
      status: "not_present",
    };
  }
  if (!envSecretStore) {
    return {
      status: "unavailable",
    };
  }
  const raw = envSecretStore.get(snapshotSecretStateKey(snapshotId));
  if (raw === undefined) {
    return {
      status: "not_present",
    };
  }
  const state = parseSnapshotSecretState(raw);
  for (const record of state.records) {
    if (!record.value) {
      continue;
    }
    envSecretStore.set(
      {
        extensionId: record.extensionId,
        name: record.name,
      },
      record.value,
    );
  }
  return {
    status: "restored",
  };
}

function parseSnapshotSecretState(raw: string): SnapshotSecretState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      schemaVersion: 1,
      records: [],
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      schemaVersion: 1,
      records: [],
    };
  }
  const records = Array.isArray((parsed as { records?: unknown }).records)
    ? (parsed as { records: unknown[] }).records
    : [];
  return {
    schemaVersion: 1,
    records: records.flatMap((record) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        return [];
      }
      const candidate = record as {
        extensionId?: unknown;
        name?: unknown;
        value?: unknown;
      };
      if (
        typeof candidate.extensionId !== "string" ||
        typeof candidate.name !== "string" ||
        typeof candidate.value !== "string"
      ) {
        return [];
      }
      return [
        {
          extensionId: candidate.extensionId,
          name: candidate.name,
          value: candidate.value,
        },
      ];
    }),
  };
}

function snapshotSecretSourceExtensions(root: string): ResolvedExtensionRecord[] {
  return [
    ...listImmediateDirectories(join(root, "sources", "user"))
      .map((id) => readUserExtensionRecord(id, root))
      .filter((extension): extension is ResolvedExtensionRecord => extension !== null),
    ...listImmediateDirectories(join(root, "sources", "builtin")).map((id) =>
      requireExtension(id, root),
    ),
  ];
}

function snapshotSecretStateKey(snapshotId: string): ExtensionEnvSecretKey {
  return {
    extensionId: "__snapshot__",
    name: `${snapshotId}:extension-env`,
  };
}

function restoreSnapshotUsageStates(
  snapshotRoot: string,
  store: AgentSettingsStore | undefined,
): {
  restored: number;
  affectedProfiles: string[];
} {
  if (!store) {
    return { restored: 0, affectedProfiles: [] };
  }
  const statePath = join(snapshotRoot, "registry", "state.json");
  if (!existsSync(statePath)) {
    return { restored: 0, affectedProfiles: [] };
  }
  const state = readJsonObject(statePath);
  const userExtensions = Array.isArray(state.userExtensions) ? state.userExtensions : [];
  const builtinSources = Array.isArray(state.builtinSources) ? state.builtinSources : [];
  let restored = 0;
  const affectedProfiles = new Set<string>();
  const extensionDefaults = (state as { extensionDefaults?: unknown }).extensionDefaults;
  if (
    extensionDefaults &&
    typeof extensionDefaults === "object" &&
    !Array.isArray(extensionDefaults)
  ) {
    store.setExtensionDefaults(
      extensionDefaults as Parameters<AgentSettingsStore["setExtensionDefaults"]>[0],
    );
  }
  for (const entry of [...userExtensions, ...builtinSources]) {
    const extension =
      typeof entry === "string"
        ? {
            id: entry,
            usage: [],
          }
        : entry;
    if (!extension || typeof extension !== "object" || Array.isArray(extension)) continue;
    const extensionId = (extension as { id?: unknown }).id;
    const usage = (extension as { usage?: unknown }).usage;
    if (typeof extensionId !== "string" || !Array.isArray(usage)) {
      continue;
    }
    if (extensionId === "extension-loading") {
      continue;
    }
    for (const row of usage) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        continue;
      }
      const usageEntry = row as {
        actorKind?: unknown;
        agentProfile?: unknown;
        state?: unknown;
      };
      if (typeof usageEntry.agentProfile !== "string" || !isExtensionUsageState(usageEntry.state)) {
        continue;
      }
      const target = resolveSnapshotUsageProfile({
        store,
        actorKind: usageEntry.actorKind,
        agentProfile: usageEntry.agentProfile,
      });
      if (!target) {
        continue;
      }
      setUsageProfile(store, target, extensionId, usageEntry.state, { explicit: true });
      affectedProfiles.add(`${target.actor}:${target.agentProfileName}`);
      restored += 1;
    }
  }
  return { restored, affectedProfiles: [...affectedProfiles].toSorted() };
}

function resolveSnapshotUsageProfile(input: {
  store: AgentSettingsStore;
  actorKind: unknown;
  agentProfile: string;
}): UsageProfileTarget | null {
  const settings = input.store.getState();
  if (input.actorKind === "orchestrator") {
    const profile = settings.agents.orchestrators.find(
      (candidate) => candidate.id === input.agentProfile,
    );
    return profile ? { actor: "orchestrator", agentProfileName: profile.id, profile } : null;
  }
  if (
    input.actorKind === "handler" &&
    (input.agentProfile === "threadHandler" ||
      input.agentProfile === DEFAULT_THREAD_HANDLER_PROFILE_ID)
  ) {
    return {
      actor: "handler",
      agentProfileName: "threadHandler",
      profile: settings.agents.special.threadHandler,
    };
  }
  if (input.actorKind === "workflow-task") {
    const profile = settings.workflowAgents[input.agentProfile];
    return profile ? { actor: "workflow-task", agentProfileName: profile.id, profile } : null;
  }
  return null;
}

function isExtensionUsageState(value: unknown): value is ExtensionUsageState {
  return value === "loaded" || value === "available" || value === "unavailable";
}

function snapshotPackageFileIsSafe(path: string): boolean {
  const content = readFileSync(path, "utf8");
  if (
    /(?:^|["'\s])(file:|link:|portal:|workspace:|\/Users\/|\/private\/|\/var\/folders\/)/.test(
      content,
    )
  ) {
    return false;
  }
  if (/(?:token|secret|keychain|password|authorization|_authToken)/i.test(content)) {
    return false;
  }
  return true;
}

function writeSnapshotRegistryState(
  root: string,
  snapshotRoot: string,
  agentSettingsStore?: AgentSettingsStore,
): void {
  const userExtensions = listImmediateDirectories(join(root, "sources", "user")).map((id) => {
    const extension = readUserExtensionRecord(id, root);
    return {
      id,
      title: extension?.title ?? id,
      category: "user",
      interface: extension?.interface ?? "instructions",
      usage: userExtensionUsageStates(id, agentSettingsStore),
    };
  });
  const builtinSources = listImmediateDirectories(join(root, "sources", "builtin")).map((id) => {
    const extension = getExtensionRecord(id);
    return {
      id,
      title: extension?.title ?? id,
      category: "builtin",
      interface: extension?.interface ?? "instructions",
      usage: usageStates(id, agentSettingsStore),
    };
  });
  mkdirSync(join(snapshotRoot, "registry"), { recursive: true });
  writeFileSync(
    join(snapshotRoot, "registry", "state.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        extensionDefaults:
          agentSettingsStore?.getState().extensionDefaults ??
          DEFAULT_AGENT_SETTINGS_STATE.extensionDefaults,
        userExtensions,
        builtinSources,
      },
      null,
      2,
    ) + "\n",
  );
}

function countSnapshotExtensions(snapshotRoot: string): number {
  return (
    listImmediateDirectories(join(snapshotRoot, "sources", "user")).length +
    listImmediateDirectories(join(snapshotRoot, "sources", "builtin")).length
  );
}

function snapshotLoadAutoBuildResult(
  autoBuild:
    | {
        status: "success";
        currentPath: unknown;
        contextReady: boolean;
        runtimeReady: boolean;
        issues?: unknown;
      }
    | {
        status: "blocked";
        error: unknown;
      }
    | {
        status: "needs_user_confirmation";
        approvalRequestId: string;
        blockedOperation: unknown;
        items: unknown;
        message: unknown;
      },
): Record<string, unknown> {
  if (autoBuild.status === "success") {
    const { currentPath: _currentPath, ...pathFree } = autoBuild;
    return pathFree;
  }
  return autoBuild;
}

function listUserExtensions(extensionsRoot: string | undefined): ResolvedExtensionRecord[] {
  const root = resolve(extensionsRoot ?? defaultExtensionsRoot());
  return listImmediateDirectories(join(root, "sources", "user"))
    .map((id) => readUserExtensionRecord(id, root))
    .filter((extension): extension is ResolvedExtensionRecord => extension !== null);
}

function snapshotPath(root: string, snapshotId: string): string {
  validateSnapshotId(snapshotId);
  return join(root, "snapshots", snapshotId);
}

function validateSnapshotId(snapshotId: string): void {
  if (!/^snap_[a-z0-9_]+$/i.test(snapshotId)) {
    throw extensionsCommandError(
      "INVALID_SNAPSHOT_ID",
      `Invalid extension snapshot id: ${snapshotId}`,
    );
  }
}

async function resolveCliRequirements(
  extension: ExtensionRecord,
  options: {
    cliProbe?: SvvyxExtensionsCliProbe;
    env?: NodeJS.ProcessEnv;
  },
): Promise<CliRequirementStatus[]> {
  const probe =
    options.cliProbe ??
    ((requirement: ExtensionCliRequirement) =>
      probeCliRequirement(requirement, options.env ?? process.env));
  const statuses: CliRequirementStatus[] = [];
  for (const requirement of extension.cliRequirements ?? []) {
    statuses.push(await probe(requirement));
  }
  return statuses;
}

function resolveEnvRequirements(
  extension: ResolvedExtensionRecord,
  envValues: ExtensionEnvValues = {},
  envSecretStore?: ExtensionEnvSecretStore,
): EnvRequirementStatus[] {
  const configured = envValues[extension.id] ?? {};
  return (extension.envDeclarations ?? []).map((declaration) => ({
    name: declaration.name,
    required: declaration.required,
    secret: declaration.secret,
    description: declaration.description,
    status: envDeclarationConfigured(extension.id, declaration, configured, envSecretStore)
      ? "configured"
      : declaration.default
        ? "defaulted"
        : declaration.required
          ? "missing"
          : "optional_missing",
  }));
}

function envDeclarationConfigured(
  extensionId: string,
  declaration: ExtensionEnvDeclaration,
  configured: Record<string, string | undefined>,
  envSecretStore?: ExtensionEnvSecretStore,
): boolean {
  if (!declaration.secret && configured[declaration.name] !== undefined) {
    return true;
  }
  return (
    declaration.secret &&
    envSecretStore?.has({
      extensionId,
      name: declaration.name,
    }) === true
  );
}

function extensionEnvValues(store?: AgentSettingsStore): ExtensionEnvValues {
  return store?.getState().extensionEnv.nonSecretOverrides ?? {};
}

function resolveDependencyRequirements(
  dependencies: readonly ExtensionDependencyDeclaration[],
  options: {
    dependencyApprovalRequest?: ExtensionDependencyApprovalRequest | null;
    dependencyApprovalStore: ExtensionDependencyApprovalStore;
    packageProject: string;
  },
): DependencyRequirementStatus[] {
  return dependencies.map((dependency) => {
    const identity = extensionDependencyIdentityFromDeclaration(dependency);
    const approved = options.dependencyApprovalStore.hasApproved(identity);
    const pendingRequest =
      options.dependencyApprovalRequest ??
      options.dependencyApprovalStore.findPendingRequestForIdentity(identity);
    return {
      kind: identity.kind,
      name: identity.name,
      version: identity.version,
      packageManager: identity.packageManager,
      source: identity.source,
      integrity: identity.integrity,
      resolution: identity.resolution,
      approval: approved ? "approved" : "needs_user_confirmation",
      ...(approved || !pendingRequest ? {} : { approvalRequestId: pendingRequest.requestId }),
      install: dependencyArtifactInstallStatus(options.packageProject, identity),
    };
  });
}

function dependencyArtifactInstallStatus(
  packageProject: string,
  identity: ExtensionDependencyApprovalIdentity,
): "installed" | "missing" {
  const packageJsonPath = join(
    packageProject,
    "node_modules",
    ...identity.name.split("/"),
    "package.json",
  );
  if (!existsSync(packageJsonPath)) {
    return "missing";
  }
  try {
    const packageJson = readJsonObject(packageJsonPath);
    return packageJson.name === identity.name && packageJson.version === identity.version
      ? "installed"
      : "missing";
  } catch {
    return "missing";
  }
}

function resolveExtensionDependencyApprovalStore(options: {
  dependencyApprovalStore?: ExtensionDependencyApprovalStore;
  extensionsRoot?: string;
}): ExtensionDependencyApprovalStore {
  return (
    options.dependencyApprovalStore ??
    new ExtensionDependencyApprovalStore({
      extensionsRoot: options.extensionsRoot ?? defaultExtensionsRoot(),
    })
  );
}

function approvedPackageInstallPlan(input: {
  buildRoot?: string;
  currentDependencies: readonly ExtensionDependencyApprovalIdentity[];
  currentTrustedDependencies: readonly ExtensionDependencyApprovalIdentity[];
  dependencyApprovalStore: ExtensionDependencyApprovalStore;
  extensionsRoot?: string;
}): {
  dependencies: ExtensionDependencyApprovalIdentity[];
  trustedDependencies: ExtensionDependencyApprovalIdentity[];
} {
  const dependencies = new Map<string, ExtensionDependencyApprovalIdentity>();
  const trustedDependencies = new Map<string, ExtensionDependencyApprovalIdentity>();
  for (const identity of input.currentDependencies) {
    dependencies.set(extensionDependencyIdentityKeyForPackagePlan(identity), identity);
  }
  for (const identity of input.currentTrustedDependencies) {
    trustedDependencies.set(extensionDependencyIdentityKeyForPackagePlan(identity), identity);
  }
  const buildsRoot = resolve(
    input.buildRoot ??
      join(input.extensionsRoot ?? defaultExtensionsRoot(), "builds", "extensions"),
  );
  for (const extensionId of listImmediateDirectories(buildsRoot)) {
    const manifestPath = join(buildsRoot, extensionId, "current", "manifest.json");
    if (!existsSync(manifestPath)) {
      continue;
    }
    let manifest: Record<string, unknown>;
    try {
      manifest = readJsonObject(manifestPath);
    } catch {
      continue;
    }
    const manifestDependencies = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
    for (const dependency of manifestDependencies) {
      if (!isRecord(dependency)) {
        continue;
      }
      const kind = dependency.kind;
      const name = dependency.name;
      const version = dependency.version;
      if (
        (kind !== "dependency" && kind !== "trusted_dependency") ||
        typeof name !== "string" ||
        typeof version !== "string"
      ) {
        continue;
      }
      const identity = extensionDependencyIdentityFromDeclaration({ kind, name, version });
      if (!input.dependencyApprovalStore.hasApproved(identity)) {
        continue;
      }
      const key = extensionDependencyIdentityKeyForPackagePlan(identity);
      if (identity.kind === "trusted_dependency") {
        trustedDependencies.set(key, identity);
      } else {
        dependencies.set(key, identity);
      }
    }
  }
  return {
    dependencies: [...dependencies.values()].toSorted(
      (left, right) =>
        left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
    ),
    trustedDependencies: [...trustedDependencies.values()].toSorted(
      (left, right) =>
        left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
    ),
  };
}

function extensionDependencyIdentityKeyForPackagePlan(
  identity: ExtensionDependencyApprovalIdentity,
): string {
  return `${identity.kind}\0${identity.packageManager}\0${identity.source}\0${identity.name}\0${identity.version}\0${identity.integrity ?? ""}\0${identity.resolution ?? ""}`;
}

function installExtensionDependencies(input: {
  dependencies: readonly ExtensionDependencyApprovalIdentity[];
  packageProject: string;
  trustedDependencies: readonly ExtensionDependencyApprovalIdentity[];
}): SvvyxExtensionsDependencyInstallResult {
  writeExtensionPackageProject(input);
  const command = [
    "bun",
    "install",
    "--cwd",
    input.packageProject,
    "--no-progress",
    ...(input.trustedDependencies.length === 0 ? ["--ignore-scripts"] : []),
  ];
  const result = spawnSync(command[0]!, command.slice(1), {
    encoding: "utf8",
    env: process.env,
  });
  if (result.status === 0) {
    return {
      ok: true,
      command,
      packageProject: input.packageProject,
    };
  }
  return {
    ok: false,
    command,
    packageProject: input.packageProject,
    error: {
      code: "DEPENDENCY_INSTALL_FAILED",
      message: "Extension package dependency installation failed.",
      exitCode: result.status,
      stderr: result.stderr.toString(),
    },
  };
}

function writeExtensionPackageProject(input: {
  dependencies: readonly ExtensionDependencyApprovalIdentity[];
  packageProject: string;
  trustedDependencies: readonly ExtensionDependencyApprovalIdentity[];
}): void {
  mkdirSync(input.packageProject, { recursive: true });
  const packageJsonPath = join(input.packageProject, "package.json");
  const dependencies: Record<string, string> = {};
  for (const identity of input.dependencies) {
    dependencies[identity.name] = identity.version;
  }
  for (const identity of input.trustedDependencies) {
    dependencies[identity.name] = identity.version;
  }
  const trustedNames = input.trustedDependencies.map((identity) => identity.name).toSorted();
  const packageJson: Record<string, unknown> = {
    name: "svvy-extension-package",
    private: true,
    dependencies,
    trustedDependencies: trustedNames,
  };
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
}

function dependencyApprovalItems(
  request: ExtensionDependencyApprovalRequest,
): Array<
  Omit<ExtensionDependencyApprovalIdentity, "integrity" | "resolution"> &
    Partial<Pick<ExtensionDependencyApprovalIdentity, "integrity" | "resolution">>
> {
  return request.identities.map((identity) => ({
    kind: identity.kind,
    name: identity.name,
    version: identity.version,
    packageManager: identity.packageManager,
    source: identity.source,
    ...(identity.integrity === null ? {} : { integrity: identity.integrity }),
    ...(identity.resolution === null ? {} : { resolution: identity.resolution }),
  }));
}

function extensionPackageProjectPath(extensionsRoot: string | undefined): string {
  return join(resolve(extensionsRoot ?? defaultExtensionsRoot()), "package");
}

export function validateExtensionBuildInput(
  extension: ResolvedExtensionRecord,
  extensionsRoot: string | undefined,
): {
  ok: false;
  error: Record<string, unknown> & {
    code: string;
    message: string;
  };
} | null {
  if (
    extension.category !== "user" &&
    !(extension.category === "builtin" && extension.sourceRoot)
  ) {
    return null;
  }
  const paths = editableExtensionInspectPaths(extension, extensionsRoot);
  const instructionNames = new Set(paths.instructionsFull.map((instruction) => instruction.name));
  const configuredInstructionNames = new Set(
    (extension.instructionFiles ?? []).map((instruction) => instruction.file),
  );
  const generatedInstructionNames = new Set(
    (extension.generatedInstructions ?? []).map((instruction) => basename(instruction.output)),
  );
  for (const entry of extension.instructionFiles ?? []) {
    if (!instructionNames.has(entry.file) && !generatedInstructionNames.has(entry.file)) {
      return buildValidationError(
        "INSTRUCTION_FILE_NOT_FOUND",
        `Instruction config references unknown file: ${entry.file}`,
        {
          extensionId: extension.id,
          path: paths.manifest,
          instructionFile: entry.file,
        },
      );
    }
  }
  for (const dependency of [
    ...(extension.dependencies ?? []),
    ...(extension.trustedDependencies ?? []),
  ]) {
    if (!isExactNpmVersion(dependency.version)) {
      return buildValidationError(
        "DEPENDENCY_VERSION_NOT_EXACT",
        `Dependency ${dependency.name} must use an exact version before it can be installed.`,
        {
          extensionId: extension.id,
          path: paths.packageJson,
          dependency: {
            name: dependency.name,
            requested: dependency.version,
          },
        },
      );
    }
  }
  for (const env of extension.envDeclarations ?? []) {
    if (env.secret && env.default !== undefined) {
      return buildValidationError(
        "INVALID_EXTENSION_ENV",
        `Secret env ${env.name} cannot declare a default value.`,
        {
          extensionId: extension.id,
          path: paths.manifest,
          env: {
            name: env.name,
          },
        },
      );
    }
  }
  const cliRequirementIds = new Set(
    (extension.cliRequirements ?? []).map((requirement) => requirement.id),
  );
  for (const instruction of extension.generatedInstructions ?? []) {
    const output = validateGeneratedInstructionPath(instruction.output, "output");
    const script = validateGeneratedScriptPath(instruction.script);
    if (!output) {
      return buildValidationError(
        "INVALID_GENERATED_INSTRUCTION",
        `Generated instruction output must stay under instructions/full/*.md: ${instruction.output}`,
        {
          extensionId: extension.id,
          path: paths.manifest,
          output: instruction.output,
        },
      );
    }
    const outputBasename = instruction.output.split("/").at(-1) ?? instruction.output;
    const generatedOutputIsPackagedBuiltin =
      extension.category === "builtin" && generatedInstructionNames.has(outputBasename);
    if (
      instructionNames.has(outputBasename) &&
      configuredInstructionNames.has(outputBasename) &&
      !generatedOutputIsPackagedBuiltin
    ) {
      return buildValidationError(
        "INVALID_GENERATED_INSTRUCTION",
        `Generated instruction output collides with existing instruction file: ${outputBasename}`,
        {
          extensionId: extension.id,
          path: paths.manifest,
          output: instruction.output,
          instructionFile: outputBasename,
        },
      );
    }
    if (!script) {
      return buildValidationError(
        "INVALID_GENERATED_INSTRUCTION",
        `Generated instruction script must stay under scripts/: ${instruction.script}`,
        {
          extensionId: extension.id,
          path: paths.manifest,
          script: instruction.script,
        },
      );
    }
    if (
      instruction.versionCliRequirementId &&
      !cliRequirementIds.has(instruction.versionCliRequirementId)
    ) {
      return buildValidationError(
        "INVALID_GENERATED_INSTRUCTION",
        `Generated instruction references unknown CLI requirement: ${instruction.versionCliRequirementId}`,
        {
          extensionId: extension.id,
          path: paths.manifest,
          versionCliRequirementId: instruction.versionCliRequirementId,
        },
      );
    }
  }
  if (extension.interface === "svvyx" && !isAppOwnedBuiltinSvvyxCommandNamespace(extension)) {
    const sourcePath = paths.extensionSource
      ? join(paths.extensionSource, "index.ts")
      : join(paths.sourceRoot, "source", "index.ts");
    if (!existsSync(sourcePath)) {
      return buildValidationError(
        "EXTENSION_SOURCE_MISSING",
        `${extension.id} is missing source/index.ts.`,
        {
          extensionId: extension.id,
          path: sourcePath,
        },
      );
    }
    const sourceText = readFileSync(sourcePath, "utf8");
    if (!/\bexport\s+default\b/.test(sourceText)) {
      return buildValidationError(
        "INVALID_EXTENSION_SOURCE",
        `${extension.id} source must default-export an Incur CLI.`,
        {
          extensionId: extension.id,
          path: sourcePath,
        },
      );
    }
    if (hasObviousTopLevelServeCall(sourceText)) {
      return buildValidationError(
        "INVALID_EXTENSION_SOURCE",
        `${extension.id} source must not call serve at top level.`,
        {
          extensionId: extension.id,
          path: sourcePath,
        },
      );
    }
  }
  return null;
}

function hasObviousTopLevelServeCall(sourceText: string): boolean {
  let braceDepth = 0;
  let line = "";
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  const flushLine = () => {
    const found = braceDepth === 0 && /\.serve\s*\(/.test(line);
    line = "";
    return found;
  };

  for (let index = 0; index < sourceText.length; index += 1) {
    const char = sourceText[index]!;
    const next = sourceText[index + 1];
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        if (flushLine()) return true;
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      line += char;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      line += char;
      continue;
    }
    if (char === "\n") {
      if (flushLine()) return true;
      continue;
    }
    line += char;
  }
  return flushLine();
}

function buildValidationError(
  code: string,
  message: string,
  extra: Record<string, unknown>,
): { ok: false; error: Record<string, unknown> & { code: string; message: string } } {
  return {
    ok: false,
    error: {
      code,
      message,
      ...extra,
    },
  };
}

async function buildSvvyxRuntimeModule(
  extensionId: string,
  sourcePath: string,
  stagingPath: string,
): Promise<
  | {
      ok: true;
      module: string;
      commandManifest: SvvyxCommandManifest;
    }
  | {
      ok: false;
      output: {
        ok: false;
        error: {
          code: string;
          message: string;
          extensionId: string;
          path: string;
        };
      };
    }
> {
  const outdir = join(stagingPath, "source");
  let result: Bun.BuildOutput;
  try {
    result = await Bun.build({
      entrypoints: [sourcePath],
      format: "esm",
      outdir,
      plugins: [
        {
          name: "svvy-extension-runtime-dependencies",
          setup(build) {
            build.onResolve({ filter: /^incur$/ }, () => ({
              path: Bun.resolveSync("incur", import.meta.dir),
            }));
          },
        },
      ],
      target: "bun",
    });
  } catch {
    return {
      ok: false,
      output: {
        ok: false,
        error: {
          code: "BUILD_FAILED",
          message: `${extensionId} source could not be bundled into a runtime build.`,
          extensionId,
          path: sourcePath,
        },
      },
    };
  }
  if (!result.success) {
    return {
      ok: false,
      output: {
        ok: false,
        error: {
          code: "BUILD_FAILED",
          message: `${extensionId} source could not be bundled into a runtime build.`,
          extensionId,
          path: sourcePath,
        },
      },
    };
  }
  const output = result.outputs.find((artifact) => artifact.path.endsWith(".js"));
  if (!output) {
    return {
      ok: false,
      output: {
        ok: false,
        error: {
          code: "BUILD_FAILED",
          message: `${extensionId} runtime build did not produce an importable module.`,
          extensionId,
          path: sourcePath,
        },
      },
    };
  }
  let commandManifest: SvvyxCommandManifest;
  try {
    const loaded = await import(`${output.path}?svvyxBuild=${Date.now()}`);
    if (!loaded.default || typeof loaded.default.serve !== "function") {
      return {
        ok: false,
        output: {
          ok: false,
          error: {
            code: "INVALID_EXTENSION_SOURCE",
            message: `${extensionId} source must default-export an Incur CLI.`,
            extensionId,
            path: sourcePath,
          },
        },
      };
    }
    commandManifest = await extractSvvyxCommandManifest(extensionId, loaded.default);
  } catch (error) {
    return {
      ok: false,
      output: {
        ok: false,
        error: {
          code: "BUILD_FAILED",
          message:
            error instanceof Error
              ? error.message
              : `${extensionId} runtime build could not be imported.`,
          extensionId,
          path: sourcePath,
        },
      },
    };
  }
  return {
    ok: true,
    module: `source/${output.path.split("/").at(-1)}`,
    commandManifest,
  };
}

function writeUserSvvyxTypescriptDeclaration(input: {
  commandManifest: SvvyxCommandManifest | null;
  extension: ResolvedExtensionRecord;
  typescriptTypesPath: string | null;
}): void {
  if (input.extension.category !== "user" || input.extension.interface !== "svvyx") {
    return;
  }
  if (
    !input.extension.typescriptApiEnabled ||
    !input.commandManifest ||
    !input.typescriptTypesPath
  ) {
    if (input.typescriptTypesPath) {
      rmSync(input.typescriptTypesPath, { force: true });
    }
    return;
  }
  mkdirSync(dirname(input.typescriptTypesPath), { recursive: true });
  writeFileSync(
    input.typescriptTypesPath,
    buildUserSvvyxTypescriptDeclaration({
      commandManifest: input.commandManifest,
      extensionId: input.extension.id,
    }),
  );
}

function writeSvvyxCommandSchema(input: {
  commandManifest: SvvyxCommandManifest | null;
  commandsPath: string;
}): void {
  if (!input.commandManifest) {
    rmSync(input.commandsPath, { force: true });
    return;
  }
  mkdirSync(dirname(input.commandsPath), { recursive: true });
  writeFileSync(input.commandsPath, JSON.stringify(input.commandManifest, null, 2) + "\n");
}

async function extractSvvyxCommandManifest(
  extensionId: string,
  cli: {
    serve(
      argv: readonly string[],
      options: {
        env: Record<string, string | undefined>;
        exit(code: number): void;
        stdout(chunk: string): void;
      },
    ): Promise<void> | void;
  },
): Promise<SvvyxCommandManifest> {
  let stdout = "";
  let exitCode = 0;
  await cli.serve(["--llms-full", "--format", "json"], {
    env: {},
    stdout(chunk) {
      stdout += chunk;
    },
    exit(code) {
      exitCode = code;
    },
  });
  if (exitCode !== 0) {
    throw new Error(`${extensionId} command manifest extraction failed.`);
  }
  const manifest = readSvvyxCommandManifest(extensionId, JSON.parse(stdout) as unknown);
  const details = await collectSvvyxCommandRuntimeDetails(cli);
  return {
    version: manifest.version,
    commands: manifest.commands.map((command) => {
      const detail = details.get(command.name);
      return {
        ...command,
        ...(detail?.aliases.length ? { aliases: detail.aliases } : {}),
        ...(detail?.streaming ? { streaming: true } : {}),
      };
    }),
  };
}

function readSvvyxCommandManifest(extensionId: string, value: unknown): SvvyxCommandManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${extensionId} command manifest is invalid.`);
  }
  const record = value as Record<string, unknown>;
  if (record.version !== "incur.v1" || !Array.isArray(record.commands)) {
    throw new Error(`${extensionId} command manifest is invalid.`);
  }
  return {
    version: "incur.v1",
    commands: record.commands.map((entry) => readSvvyxCommandManifestEntry(extensionId, entry)),
  };
}

function readSvvyxCommandManifestEntry(
  extensionId: string,
  value: unknown,
): SvvyxCommandManifestEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${extensionId} command manifest entry is invalid.`);
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.name !== "string" || entry.name.trim().length === 0) {
    throw new Error(`${extensionId} command manifest entry is invalid.`);
  }
  const command: SvvyxCommandManifestEntry = { name: entry.name };
  if (typeof entry.description === "string") {
    command.description = entry.description;
  }
  if ("aliases" in entry) {
    if (
      !Array.isArray(entry.aliases) ||
      !entry.aliases.every((alias) => typeof alias === "string")
    ) {
      throw new Error(`${extensionId} command manifest entry is invalid.`);
    }
    command.aliases = entry.aliases;
  }
  if ("streaming" in entry) {
    if (typeof entry.streaming !== "boolean") {
      throw new Error(`${extensionId} command manifest entry is invalid.`);
    }
    command.streaming = entry.streaming;
  }
  if ("examples" in entry) {
    if (!Array.isArray(entry.examples)) {
      throw new Error(`${extensionId} command manifest entry is invalid.`);
    }
    command.examples = entry.examples.map((example) =>
      readSvvyxCommandExample(extensionId, example),
    );
  }
  if ("schema" in entry) {
    command.schema = readSvvyxCommandSchema(extensionId, entry.schema);
  }
  return command;
}

function readSvvyxCommandExample(
  extensionId: string,
  value: unknown,
): { command: string; description?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${extensionId} command manifest example is invalid.`);
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.command !== "string") {
    throw new Error(`${extensionId} command manifest example is invalid.`);
  }
  return {
    command: entry.command,
    ...(typeof entry.description === "string" ? { description: entry.description } : {}),
  };
}

function readSvvyxCommandSchema(
  extensionId: string,
  value: unknown,
): SvvyxCommandManifestEntry["schema"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${extensionId} command manifest schema is invalid.`);
  }
  const schema = value as Record<string, unknown>;
  const result: NonNullable<SvvyxCommandManifestEntry["schema"]> = {};
  for (const key of ["args", "env", "options", "output"] as const) {
    if (schema[key] === undefined) {
      continue;
    }
    result[key] = readJsonSchemaObject(extensionId, schema[key]);
  }
  return result;
}

function readJsonSchemaObject(extensionId: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${extensionId} command manifest JSON schema is invalid.`);
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function collectSvvyxCommandRuntimeDetails(
  cli: unknown,
): Promise<Map<string, { aliases: string[]; streaming: boolean }>> {
  const runtime = (await import("incur")) as {
    Cli?: {
      toCommands?: { get(value: unknown): Map<string, unknown> | undefined };
    };
  };
  const commands = runtime.Cli?.toCommands?.get(cli);
  const details = new Map<string, { aliases: string[]; streaming: boolean }>();
  if (!commands) {
    return details;
  }
  collectSvvyxCommandRuntimeDetailsFromMap(commands, [], details);
  return details;
}

function collectSvvyxCommandRuntimeDetailsFromMap(
  commands: Map<string, unknown>,
  prefix: string[],
  details: Map<string, { aliases: string[]; streaming: boolean }>,
): void {
  const aliasesByTarget = new Map<string, string[]>();
  for (const [name, entry] of commands) {
    if (isRecord(entry) && entry._alias === true && typeof entry.target === "string") {
      const aliasPath = [...prefix, name].join(" ");
      const targetPath = [...prefix, entry.target].join(" ");
      aliasesByTarget.set(targetPath, [...(aliasesByTarget.get(targetPath) ?? []), aliasPath]);
    }
  }
  for (const [name, entry] of commands) {
    if (!isRecord(entry) || entry._alias === true) {
      continue;
    }
    const path = [...prefix, name];
    if (entry._group === true && entry.commands instanceof Map) {
      collectSvvyxCommandRuntimeDetailsFromMap(entry.commands, path, details);
      continue;
    }
    const commandName = path.join(" ");
    details.set(commandName, {
      aliases:
        aliasesByTarget.get(commandName)?.toSorted((left, right) => left.localeCompare(right)) ??
        [],
      streaming:
        typeof entry.run === "function" && entry.run.constructor.name === "AsyncGeneratorFunction",
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isExactNpmVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

function validateGeneratedInstructionPath(path: string, _kind: "output"): boolean {
  return (
    path.startsWith("instructions/full/") &&
    path.endsWith(".md") &&
    !path.includes("..") &&
    !path.includes("\\") &&
    !path.includes("\0")
  );
}

function validateGeneratedScriptPath(path: string): boolean {
  return (
    path.startsWith("scripts/") &&
    !path.includes("..") &&
    !path.includes("\\") &&
    !path.includes("\0")
  );
}

export function probeCliRequirement(
  requirement: ExtensionCliRequirement,
  env: NodeJS.ProcessEnv = process.env,
): CliRequirementStatus {
  const defaultVersion = requirement.version ?? null;
  const path = findExecutable(requirement.binary, env.PATH ?? "");
  if (!path) {
    return {
      id: requirement.id,
      binary: requirement.binary,
      package: requirement.package ?? null,
      required: requirement.required,
      defaultVersion,
      currentVersion: defaultVersion,
      latestVersion: null,
      status: "missing",
      updateAvailable: false,
      detectedVersion: null,
      path: null,
      versionCommand: requirement.versionCommand ?? null,
      installCommand: resolveInstallCommand(requirement, defaultVersion),
      updateCommand: null,
    };
  }

  const detectedVersion = detectCliVersion(requirement, env);
  if (!detectedVersion) {
    return {
      id: requirement.id,
      binary: requirement.binary,
      package: requirement.package ?? null,
      required: requirement.required,
      defaultVersion,
      currentVersion: null,
      latestVersion: null,
      status: "unknown",
      updateAvailable: false,
      detectedVersion: null,
      path,
      versionCommand: requirement.versionCommand ?? null,
      installCommand: null,
      updateCommand: null,
    };
  }

  const updateAvailable =
    defaultVersion !== null && detectedVersion !== defaultVersion && !!requirement.installCommand;
  return {
    id: requirement.id,
    binary: requirement.binary,
    package: requirement.package ?? null,
    required: requirement.required,
    defaultVersion,
    currentVersion: detectedVersion,
    latestVersion: updateAvailable ? defaultVersion : null,
    status: "available",
    updateAvailable,
    detectedVersion,
    path,
    versionCommand: requirement.versionCommand ?? null,
    installCommand: null,
    updateCommand: updateAvailable ? resolveInstallCommand(requirement, defaultVersion) : null,
  };
}

function detectCliVersion(
  requirement: ExtensionCliRequirement,
  env: NodeJS.ProcessEnv,
): string | null {
  if (!requirement.versionCommand) {
    return null;
  }
  let words: string[];
  try {
    words = splitCommandLine(requirement.versionCommand);
  } catch {
    return null;
  }
  if (words.length === 0 || hasShellControlSyntax(requirement.versionCommand)) {
    return null;
  }
  const result = spawnSync(words[0]!, words.slice(1), {
    encoding: "utf8",
    env,
    timeout: 5_000,
  });
  if (result.status !== 0) {
    return null;
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return output.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/)?.[1] ?? null;
}

function runGeneratedInstructionScripts(
  extension: ResolvedExtensionRecord,
  cliRequirements: readonly CliRequirementStatus[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
): { ok: true } | { ok: false; error: Record<string, unknown> & { code: string } } {
  for (const instruction of extension.generatedInstructions ?? []) {
    const scriptPath = extension.sourceRoot
      ? join(extension.sourceRoot, instruction.script)
      : resolveGeneratedInstructionScriptPath(instruction, options.cwd);
    const outputPath = extension.sourceRoot
      ? join(extension.sourceRoot, instruction.output)
      : resolve(options.cwd, instruction.output);
    const packagedScriptPath = resolveGeneratedInstructionScriptPath(instruction, options.cwd);
    const packagedOutputPath = resolveGeneratedInstructionReadPath(instruction, options.cwd);
    if (
      extension.category === "builtin" &&
      extension.sourceRoot &&
      existsSync(packagedOutputPath) &&
      readOptionalFile(scriptPath).trimEnd() === readOptionalFile(packagedScriptPath).trimEnd()
    ) {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, readOptionalFile(packagedOutputPath));
      continue;
    }
    const version = instruction.versionCliRequirementId
      ? cliRequirements.find(
          (requirement) => requirement.id === instruction.versionCliRequirementId,
        )?.defaultVersion
      : null;
    const command = [
      process.execPath,
      scriptPath,
      "--output",
      outputPath,
      ...(version ? ["--version", version] : []),
    ];
    mkdirSync(dirname(outputPath), { recursive: true });
    const result = spawnSync(command[0]!, command.slice(1), {
      cwd: extension.sourceRoot ?? options.cwd,
      encoding: "utf8",
      env: options.env,
      timeout: 120_000,
    });
    if (result.status !== 0) {
      return {
        ok: false,
        error: {
          code: "GENERATED_INSTRUCTION_BUILD_FAILED",
          message: `Generated instruction script failed for ${extension.id}: ${basename(instruction.script)}`,
          extensionId: extension.id,
          script: scriptPath,
          output: outputPath,
          command,
          exitCode: result.status,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
        },
      };
    }
    if (!existsSync(outputPath)) {
      return {
        ok: false,
        error: {
          code: "GENERATED_INSTRUCTION_OUTPUT_MISSING",
          message: `Generated instruction script did not write ${basename(outputPath)}.`,
          extensionId: extension.id,
          script: scriptPath,
          output: outputPath,
          command,
        },
      };
    }
  }
  return { ok: true };
}

function findExecutable(binary: string, pathValue: string): string | null {
  for (const entry of pathValue.split(delimiter)) {
    if (!entry) continue;
    const candidate = join(entry, binary);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep scanning PATH entries.
    }
  }
  return null;
}

function resolveInstallCommand(
  requirement: ExtensionCliRequirement,
  version: string | null,
): string | null {
  if (!requirement.installCommand) {
    return null;
  }
  return requirement.installCommand.replaceAll("{{version}}", version ?? "");
}

export function resolveExtensionRecord(
  id: string,
  extensionsRoot?: string,
): ResolvedExtensionRecord | null {
  const extension = getExtensionRecord(id);
  if (extension) {
    return readBuiltinSourceRecord(extension, extensionsRoot) ?? extension;
  }
  const userExtension = readUserExtensionRecord(id, extensionsRoot);
  if (userExtension) {
    return userExtension;
  }
  return null;
}

export function resolveExtensionRecords(
  ids: readonly string[],
  extensionsRoot?: string,
): ResolvedExtensionRecord[] {
  return ids
    .map((id) => resolveExtensionRecord(id, extensionsRoot))
    .filter((extension): extension is ResolvedExtensionRecord => extension !== null);
}

export function resolveVisibleExtensionRecords(
  ids: readonly string[],
  extensionsRoot?: string,
): ResolvedExtensionRecord[] {
  return ids
    .map((id) => resolveVisibleExtensionRecord(id, extensionsRoot))
    .filter((extension): extension is ResolvedExtensionRecord => extension !== null);
}

function resolveVisibleExtensionRecord(
  id: string,
  extensionsRoot?: string,
): ResolvedExtensionRecord | null {
  const extension = getExtensionRecord(id);
  if (extension) {
    const source = readBuiltinSourceRecord(extension, extensionsRoot);
    if (source) {
      return source;
    }
    if (extensionsRoot) {
      return scaffoldBuiltinSource(extension, { extensionsRoot });
    }
    return extension;
  }
  const userExtension = readUserExtensionRecord(id, extensionsRoot);
  if (userExtension) {
    return userExtension;
  }
  return null;
}

function requireExtension(id: string, extensionsRoot: string | undefined): ResolvedExtensionRecord {
  const extension = resolveExtensionRecord(id, extensionsRoot);
  if (extension) {
    return extension;
  }
  throw extensionsCommandError("extension_not_found", `Extension not found: ${id}`);
}

function readUserExtensionRecord(
  id: string,
  extensionsRoot: string | undefined,
): ResolvedExtensionRecord | null {
  const root = resolve(extensionsRoot ?? defaultExtensionsRoot());
  const sourceRoot = join(root, "sources", "user", id);
  const manifestPath = join(sourceRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  const manifest = readJsonObject(manifestPath);
  if (manifest.id !== id) {
    throw extensionsCommandError(
      "invalid_manifest",
      `User extension manifest id must match extension id: ${id}`,
    );
  }
  if (manifest.schemaVersion !== 1) {
    throw extensionsCommandError("invalid_manifest", `Unsupported extension manifest: ${id}`);
  }
  if (manifest.interface !== "instructions" && manifest.interface !== "svvyx") {
    throw extensionsCommandError("invalid_manifest", `Invalid extension interface: ${id}`);
  }
  const typescriptApiEnabled =
    typeof manifest.typescriptApiEnabled === "boolean" ? manifest.typescriptApiEnabled : false;
  if (manifest.interface === "instructions" && typescriptApiEnabled) {
    throw extensionsCommandError(
      "invalid_manifest",
      `typescriptApiEnabled is valid only with interface svvyx: ${id}`,
    );
  }
  const instructionFiles = readManifestInstructionFiles(manifest);
  const envDeclarations = readManifestEnvDeclarations(manifest);
  const cliRequirements = readManifestCliRequirements(manifest);
  const generatedInstructions = readManifestGeneratedInstructions(manifest);
  const dependencies = readManifestDependencies(manifest, "dependencies", "dependency");
  const trustedDependencies = readManifestDependencies(
    manifest,
    "trustedDependencies",
    "trusted_dependency",
  );
  const paths = userExtensionPaths(id, extensionsRoot, manifest.interface);
  const instructionsFull = listInstructionFileViews(paths.instructionsFullDir, instructionFiles);
  const envReadiness =
    envDeclarations.length === 0
      ? "not_required"
      : envDeclarations.some((declaration) => declaration.required && !declaration.default)
        ? "missing"
        : "ready";
  return {
    id,
    category: "user",
    interface: manifest.interface,
    title: readManifestString(manifest, "title"),
    description: readManifestString(manifest, "description"),
    instructionSourceFiles: instructionsFull.map((file) => file.path),
    minimalLoadingHint: readOptionalFile(join(sourceRoot, "instructions", "minimal.md")),
    typescriptApiEnabled,
    envReadiness,
    dependencyReadiness: "not_required",
    cliRequirements,
    generatedInstructions,
    instructionFiles,
    envDeclarations,
    dependencies,
    resetBehavior: "user_reset",
    trustedDependencies,
    deleteBehavior: "trash_allowed",
    extensionBuildFingerprint: sourceBuildFingerprint(sourceRoot),
    sourceRoot,
  };
}

function readBuiltinSourceRecord(
  builtin: ExtensionRecord,
  extensionsRoot: string | undefined,
): ResolvedExtensionRecord | null {
  const root = resolve(extensionsRoot ?? defaultExtensionsRoot());
  const sourceRoot = join(root, "sources", "builtin", builtin.id);
  const manifestPath = join(sourceRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  const manifest = readJsonObject(manifestPath);
  if (manifest.id !== builtin.id) {
    throw extensionsCommandError(
      "invalid_manifest",
      `Builtin source manifest id must match extension id: ${builtin.id}`,
    );
  }
  if (manifest.schemaVersion !== 1) {
    throw extensionsCommandError(
      "invalid_manifest",
      `Unsupported builtin source manifest: ${builtin.id}`,
    );
  }
  if (manifest.interface !== builtin.interface) {
    manifest.interface = builtin.interface;
  }
  let instructionFiles = readManifestInstructionFiles(manifest);
  const envDeclarations = readManifestEnvDeclarations(manifest);
  const cliRequirements = readManifestCliRequirements(manifest);
  const dependencies = readManifestDependencies(manifest, "dependencies", "dependency");
  const trustedDependencies = readManifestDependencies(
    manifest,
    "trustedDependencies",
    "trusted_dependency",
  );
  const paths = builtinSourcePaths(builtin.id, extensionsRoot, builtin.interface);
  const packagedGeneratedInstructions = builtin.generatedInstructions ?? [];
  const hadStaleGeneratedInstructionMetadata =
    !packagedGeneratedInstructions.length &&
    (instructionFiles.some((instruction) => instruction.file.endsWith(".generated.md")) ||
      (Array.isArray(manifest.generatedInstructions) && manifest.generatedInstructions.length > 0));
  instructionFiles = normalizeBuiltinSourceInstructionFiles(builtin, instructionFiles);
  ensureBuiltinSourceDefaultInstructionFiles(builtin, paths, instructionFiles, {
    restoreMissingDirectDefaults: hadStaleGeneratedInstructionMetadata,
  });
  if (writeNormalizedBuiltinSourceManifest(manifestPath, manifest, builtin, instructionFiles)) {
    instructionFiles = readManifestInstructionFiles(readJsonObject(manifestPath));
  }
  const visibleInstructionNames = new Set(instructionFiles.map((instruction) => instruction.file));
  const generatedInstructionNames = new Set(
    packagedGeneratedInstructions.map((instruction) => basename(instruction.output)),
  );
  const instructionsFull = listInstructionFileViews(
    paths.instructionsFullDir,
    instructionFiles,
  ).filter(
    (file) => visibleInstructionNames.has(file.name) && !generatedInstructionNames.has(file.name),
  );
  const extensionBuildFingerprint = builtinSourceBuildFingerprint(builtin, paths, instructionFiles);
  return {
    ...builtin,
    title: typeof manifest.title === "string" ? manifest.title : builtin.title,
    description:
      typeof manifest.description === "string" ? manifest.description : builtin.description,
    typescriptApiEnabled:
      typeof manifest.typescriptApiEnabled === "boolean"
        ? manifest.typescriptApiEnabled
        : builtin.typescriptApiEnabled,
    instructionSourceFiles: instructionsFull.map((file) => file.path),
    minimalLoadingHint: readOptionalFile(paths.instructionsMinimal) || builtin.minimalLoadingHint,
    cliRequirements: cliRequirements.length > 0 ? cliRequirements : builtin.cliRequirements,
    generatedInstructions: packagedGeneratedInstructions,
    instructionFiles,
    envDeclarations,
    dependencies,
    trustedDependencies,
    extensionBuildFingerprint,
    sourceRoot,
  };
}

function normalizeBuiltinSourceInstructionFiles(
  builtin: ExtensionRecord,
  instructionFiles: readonly ExtensionInstructionFile[],
): ExtensionInstructionFile[] {
  const packagedGeneratedNames = new Set(
    (builtin.generatedInstructions ?? []).map((instruction) => basename(instruction.output)),
  );
  const directDefaultNames = new Set(
    builtinLoadedInstructionDefaults(builtin.id).map((instruction) =>
      validateInstructionBasename(instruction.name),
    ),
  );
  return instructionFiles.filter((instruction) => {
    if (directDefaultNames.has(instruction.file)) return true;
    if (packagedGeneratedNames.has(instruction.file)) return true;
    if (packagedGeneratedNames.size > 0) return true;
    return !instruction.file.endsWith(".generated.md");
  });
}

function ensureBuiltinSourceDefaultInstructionFiles(
  builtin: ExtensionRecord,
  paths: ReturnType<typeof builtinSourcePaths>,
  instructionFiles: ExtensionInstructionFile[],
  options: { restoreMissingDirectDefaults: boolean },
): void {
  const names = new Set(instructionFiles.map((instruction) => instruction.file));
  for (const file of builtinDirectDefaultInstructionFiles(builtin)) {
    if (!names.has(file.name)) {
      if (!options.restoreMissingDirectDefaults) continue;
      instructionFiles.push({ file: file.name, bypassed: false });
      names.add(file.name);
    }
    const target = join(paths.instructionsFullDir, file.name);
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
  }
  const minimal = readOptionalFile(paths.instructionsMinimal);
  if (
    !minimal ||
    obsoleteBuiltinMinimalInstructionHints(builtin.id).includes(
      normalizeMinimalInstructionContent(minimal),
    )
  ) {
    mkdirSync(dirname(paths.instructionsMinimal), { recursive: true });
    writeFileSync(paths.instructionsMinimal, builtin.minimalLoadingHint + "\n");
  }
}

function builtinSourceBuildFingerprint(
  builtin: ExtensionRecord,
  paths: ReturnType<typeof builtinSourcePaths>,
  instructionFiles: readonly ExtensionInstructionFile[],
): string | null {
  if (builtin.interface === "svvyx" || (builtin.generatedInstructions ?? []).length > 0) {
    return sourceBuildFingerprint(paths.sourceRoot);
  }
  if (!existsSync(paths.sourceRoot)) return null;
  const hash = createHash("sha256");
  const activeFiles = [
    paths.manifest,
    paths.instructionsMinimal,
    ...instructionFiles.map((instruction) => join(paths.instructionsFullDir, instruction.file)),
  ].filter((file) => existsSync(file));
  for (const file of activeFiles.toSorted((left, right) => left.localeCompare(right))) {
    hash.update(file.slice(paths.sourceRoot.length + 1));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function builtinDirectDefaultInstructionFiles(
  extension: ExtensionRecord,
): { content: string; name: string }[] {
  return builtinLoadedInstructionDefaults(extension.id)
    .map((instruction) => ({
      content: `${instruction.content.trimEnd()}\n`,
      name: validateInstructionBasename(instruction.name),
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function writeNormalizedBuiltinSourceManifest(
  manifestPath: string,
  manifest: Record<string, unknown>,
  builtin: ExtensionRecord,
  instructionFiles: readonly ExtensionInstructionFile[],
): boolean {
  const normalized = {
    ...manifest,
    title: typeof manifest.title === "string" ? manifest.title : builtin.title,
    description:
      typeof manifest.description === "string" ? manifest.description : builtin.description,
    typescriptApiEnabled:
      typeof manifest.typescriptApiEnabled === "boolean"
        ? manifest.typescriptApiEnabled
        : builtin.typescriptApiEnabled,
    instructionFiles,
    ...(builtin.generatedInstructions && builtin.generatedInstructions.length > 0
      ? { generatedInstructions: builtin.generatedInstructions }
      : { generatedInstructions: undefined }),
  };
  if (!builtin.generatedInstructions || builtin.generatedInstructions.length === 0) {
    delete normalized.generatedInstructions;
  }
  const before = JSON.stringify(manifest);
  const after = JSON.stringify(normalized);
  if (before === after) return false;
  writeFileSync(manifestPath, JSON.stringify(normalized, null, 2) + "\n");
  return true;
}

function obsoleteBuiltinMinimalInstructionHints(id: string): string[] {
  switch (id) {
    case "base-common":
      return ["Shared operating instructions are loaded automatically."];
    case "base-orchestrator":
      return ["Orchestrator role instructions are loaded for orchestrator surfaces."];
    case "base-handler":
      return ["Handler role instructions are loaded for delegated handler surfaces."];
    case "base-workflow-task":
      return ["Workflow task-agent role instructions are loaded for task attempts."];
    default:
      return [];
  }
}

function scaffoldBuiltinSource(
  extension: ResolvedExtensionRecord,
  options: {
    cwd?: string;
    extensionsRoot?: string;
  },
): ResolvedExtensionRecord {
  const packaged = getExtensionRecord(extension.id) ?? extension;
  const defaultFiles = builtinDefaultInstructionFiles(packaged, options.cwd ?? process.cwd());
  const paths = builtinSourcePaths(extension.id, options.extensionsRoot, extension.interface);
  mkdirSync(paths.instructionsFullDir, { recursive: true });
  const createdSource = !existsSync(paths.manifest);
  const instructionFiles = builtinDefaultInstructionEntries(packaged, defaultFiles);
  if (createdSource) {
    writeFileSync(
      paths.manifest,
      JSON.stringify(
        {
          schemaVersion: 1,
          id: extension.id,
          title: extension.title,
          description: extension.description,
          interface: extension.interface,
          typescriptApiEnabled: extension.typescriptApiEnabled,
          instructionFiles,
          ...(packaged.generatedInstructions
            ? { generatedInstructions: packaged.generatedInstructions }
            : {}),
        },
        null,
        2,
      ) + "\n",
    );
    for (const file of defaultFiles) {
      const target = join(paths.instructionsFullDir, file.name);
      writeFileSync(target, file.content);
    }
    if (!existsSync(paths.instructionsMinimal)) {
      mkdirSync(dirname(paths.instructionsMinimal), { recursive: true });
      writeFileSync(paths.instructionsMinimal, extension.minimalLoadingHint + "\n");
    }
  }
  scaffoldBuiltinGeneratedInstructionScripts(packaged, paths, options.cwd ?? process.cwd());
  scaffoldBuiltinSvvyxSource(packaged, paths);
  const sourceRecord = readBuiltinSourceRecord(extension, options.extensionsRoot) ?? extension;
  if (
    createdSource &&
    sourceRecord.extensionBuildFingerprint &&
    sourceRecord.interface !== "svvyx"
  ) {
    writeExtensionBuildFingerprint(
      paths.buildCurrent,
      sourceRecord.id,
      sourceRecord.interface,
      sourceRecord.extensionBuildFingerprint,
    );
  }
  return sourceRecord;
}

function scaffoldBuiltinGeneratedInstructionScripts(
  extension: ResolvedExtensionRecord,
  paths: ReturnType<typeof builtinSourcePaths>,
  cwd: string,
): void {
  for (const instruction of extension.generatedInstructions ?? []) {
    const target = join(paths.sourceRoot, instruction.script);
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      const packaged = resolveGeneratedInstructionScriptPath(instruction, cwd);
      writeFileSync(target, readOptionalFile(packaged));
    }
    const outputTarget = join(paths.sourceRoot, instruction.output);
    if (!existsSync(outputTarget)) {
      const packagedOutput = resolveGeneratedInstructionReadPath(instruction, cwd);
      if (existsSync(packagedOutput)) {
        mkdirSync(dirname(outputTarget), { recursive: true });
        writeFileSync(outputTarget, readOptionalFile(packagedOutput));
      }
    }
  }
}

function scaffoldBuiltinSvvyxSource(
  extension: ResolvedExtensionRecord,
  paths: ReturnType<typeof builtinSourcePaths>,
): void {
  if (extension.interface !== "svvyx" || !paths.extensionSource) return;
  const source = builtinSvvyxSourceDefault(extension);
  const target = join(paths.extensionSource, "index.ts");
  if (!source || existsSync(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

function builtinSvvyxSourceDefault(extension: ResolvedExtensionRecord): string | null {
  if (extension.id === "artifacts") {
    return [
      'import { Cli, z } from "incur";',
      "",
      "const artifactRef = z.object({",
      "  id: z.string(),",
      "  path: z.string(),",
      "  name: z.string(),",
      "  immutable: z.boolean(),",
      "  mimeType: z.string(),",
      "  bytes: z.number(),",
      "  sha256: z.string(),",
      "  createdAt: z.string(),",
      "});",
      "",
      "const cli = Cli.create('artifacts', {",
      `  description: ${JSON.stringify(extension.description)},`,
      "});",
      "",
      "cli.command('create', {",
      "  description: 'Create a durable session artifact from a new file name or an existing source path.',",
      "  options: z.object({",
      "    name: z.string().optional(),",
      "    path: z.string().optional(),",
      "    immutable: z.boolean().optional(),",
      "    'mime-type': z.string().optional(),",
      "  }),",
      "  output: artifactRef,",
      "  run() {",
      "    return { id: '', path: '', name: '', immutable: false, mimeType: '', bytes: 0, sha256: '', createdAt: '' };",
      "  },",
      "});",
      "",
      "cli.command('inspect', {",
      "  description: 'Inspect one durable session artifact by id.',",
      "  options: z.object({ id: z.string() }),",
      "  output: artifactRef,",
      "  run() {",
      "    return { id: '', path: '', name: '', immutable: false, mimeType: '', bytes: 0, sha256: '', createdAt: '' };",
      "  },",
      "});",
      "",
      "cli.command('list', {",
      "  description: 'List durable session artifacts.',",
      "  options: z.object({",
      "    'thread-id': z.string().optional(),",
      "    limit: z.number().optional(),",
      "  }),",
      "  output: z.object({ artifacts: z.array(artifactRef) }),",
      "  run() {",
      "    return { artifacts: [] };",
      "  },",
      "});",
      "",
      "cli.command('open', {",
      "  description: 'Open a durable artifact by id.',",
      "  options: z.object({ id: z.string() }),",
      "  output: z.object({ id: z.string(), opened: z.boolean() }),",
      "  run() {",
      "    return { id: '', opened: true };",
      "  },",
      "});",
      "",
      "cli.command('delete', {",
      "  description: 'Delete a mutable durable artifact by id.',",
      "  options: z.object({ id: z.string() }),",
      "  output: z.object({ id: z.string(), deleted: z.boolean() }),",
      "  run() {",
      "    return { id: '', deleted: true };",
      "  },",
      "});",
      "",
      "export default cli;",
      "",
    ].join("\n");
  }
  if (extension.id === "workflows") {
    return [
      'import { Cli, z } from "incur";',
      "",
      "const workflowKind = z.enum(['agent', 'prompt', 'component', 'workflow']);",
      "const diagnostic = z.object({",
      "  code: z.string(),",
      "  message: z.string(),",
      "  path: z.string().optional(),",
      "  exportName: z.string().optional(),",
      "});",
      "const item = z.object({",
      "  kind: workflowKind,",
      "  namespace: z.string(),",
      "  exportName: z.string(),",
      "  qualifiedName: z.string(),",
      "  sourcePath: z.string(),",
      "  generatedPath: z.string(),",
      "});",
      "",
      "const cli = Cli.create('workflows', {",
      `  description: ${JSON.stringify(extension.description)},`,
      "});",
      "",
      "cli.command('list', {",
      "  description: 'List generated app-global Workflows source-library exports.',",
      "  options: z.object({ kind: workflowKind.optional() }),",
      "  output: z.object({ items: z.array(item) }),",
      "  run() {",
      "    return { items: [] };",
      "  },",
      "});",
      "",
      "cli.command('save', {",
      "  description: 'Save reusable Smithers material into the app-global Workflows source library.',",
      "  options: z.object({",
      "    from: z.string(),",
      "    kind: workflowKind,",
      "    as: z.string(),",
      "    export: z.string().optional(),",
      "    overwrite: z.boolean().optional(),",
      "  }),",
      "  output: z.object({",
      "    ok: z.boolean(),",
      "    sourcePath: z.string(),",
      "    generatedPackagePath: z.string(),",
      "    exportName: z.string(),",
      "    kind: workflowKind,",
      "    diagnostics: z.array(diagnostic),",
      "    linkedWorkspaces: z.array(z.string()),",
      "  }),",
      "  run() {",
      "    return { ok: true, sourcePath: '', generatedPackagePath: '', exportName: '', kind: 'agent' as const, diagnostics: [], linkedWorkspaces: [] };",
      "  },",
      "});",
      "",
      "cli.command('build', {",
      "  description: 'Build generated app-global Workflows package output.',",
      "  output: z.object({",
      "    ok: z.boolean(),",
      "    generatedPackagePath: z.string(),",
      "    diagnostics: z.array(diagnostic),",
      "    linkedWorkspaces: z.array(z.string()),",
      "    items: z.array(item),",
      "  }),",
      "  run() {",
      "    return { ok: true, generatedPackagePath: '', diagnostics: [], linkedWorkspaces: [], items: [] };",
      "  },",
      "});",
      "",
      "cli.command('models list', {",
      "  description: 'List provider/model/reasoning choices for reusable workflow task-agent parameters.',",
      "  output: z.object({ items: z.array(z.unknown()) }),",
      "  run() {",
      "    return { items: [] };",
      "  },",
      "});",
      "",
      "export default cli;",
      "",
    ].join("\n");
  }
  return null;
}

function writeExtensionBuildFingerprint(
  buildCurrent: string,
  extensionId: string,
  interfaceKind: ExtensionRecord["interface"],
  sourceFingerprint: string,
  commandManifest: SvvyxCommandManifest | null = null,
): void {
  mkdirSync(buildCurrent, { recursive: true });
  writeFileSync(
    join(buildCurrent, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        extensionId,
        interface: interfaceKind,
        module: null,
        commandManifest,
        typescriptTypes: null,
        sourceFingerprint,
        env: [],
        dependencies: [],
      },
      null,
      2,
    ) + "\n",
  );
}

function builtinDefaultInstructionFiles(
  extension: ResolvedExtensionRecord,
  _cwd: string,
): { content: string; name: string }[] {
  const defaults = new Map<string, string>();
  for (const instruction of builtinLoadedInstructionDefaults(extension.id)) {
    defaults.set(
      validateInstructionBasename(instruction.name),
      `${instruction.content.trimEnd()}\n`,
    );
  }
  return [...defaults.keys()]
    .toSorted((left, right) => left.localeCompare(right))
    .map((name) => ({
      name,
      content: defaults.get(name) ?? "",
    }));
}

function builtinDefaultInstructionEntries(
  extension: ResolvedExtensionRecord,
  defaultFiles: readonly { name: string }[],
): ExtensionInstructionFile[] {
  const names = new Set(defaultFiles.map((file) => validateInstructionBasename(file.name)));
  for (const instruction of extension.generatedInstructions ?? []) {
    names.add(validateInstructionBasename(basename(instruction.output)));
  }
  for (const instruction of extension.instructionFiles ?? []) {
    names.add(validateInstructionBasename(instruction.file));
  }
  return [...names]
    .toSorted((left, right) => left.localeCompare(right))
    .map((file) => ({
      file,
      bypassed:
        extension.instructionFiles?.some((entry) => entry.file === file && entry.bypassed) ?? false,
    }));
}

function readJsonObject(path: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw extensionsCommandError(
      "invalid_manifest",
      error instanceof Error ? error.message : `Invalid JSON: ${path}`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw extensionsCommandError("invalid_manifest", `Expected JSON object: ${path}`);
  }
  return value as Record<string, unknown>;
}

function readManifestString(manifest: Record<string, unknown>, key: string): string {
  const value = manifest[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw extensionsCommandError("invalid_manifest", `Extension manifest missing ${key}.`);
  }
  return value;
}

function readManifestInstructionFiles(manifest: Record<string, unknown>) {
  const rawFiles = manifest.instructionFiles;
  if (!Array.isArray(rawFiles)) {
    return [];
  }
  const seen = new Set<string>();
  return rawFiles.map((file): { file: string; bypassed: boolean } => {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      throw extensionsCommandError("invalid_manifest", "Invalid instructionFiles entry.");
    }
    const entry = file as Record<string, unknown>;
    if (typeof entry.file !== "string" || typeof entry.bypassed !== "boolean") {
      throw extensionsCommandError("invalid_manifest", "Invalid instructionFiles entry.");
    }
    const normalized = validateInstructionBasename(entry.file);
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      throw extensionsCommandError("invalid_manifest", "Duplicate instructionFiles entry.");
    }
    seen.add(key);
    return {
      file: normalized,
      bypassed: entry.bypassed,
    };
  });
}

function readManifestEnvDeclarations(manifest: Record<string, unknown>): ExtensionEnvDeclaration[] {
  const rawEnv = manifest.env;
  if (!Array.isArray(rawEnv)) {
    return [];
  }
  const seen = new Set<string>();
  return rawEnv.map((env): ExtensionEnvDeclaration => {
    if (!env || typeof env !== "object" || Array.isArray(env)) {
      throw extensionsCommandError("invalid_manifest", "Invalid env declaration.");
    }
    const entry = env as Record<string, unknown>;
    if (
      typeof entry.name !== "string" ||
      !/^[A-Z_][A-Z0-9_]*$/.test(entry.name) ||
      typeof entry.required !== "boolean" ||
      typeof entry.secret !== "boolean" ||
      typeof entry.description !== "string" ||
      entry.description.trim().length === 0
    ) {
      throw extensionsCommandError("invalid_manifest", "Invalid env declaration.");
    }
    if ("default" in entry && typeof entry.default !== "string") {
      throw extensionsCommandError("invalid_manifest", "Invalid env default.");
    }
    if (seen.has(entry.name)) {
      throw extensionsCommandError("invalid_manifest", `Duplicate env declaration: ${entry.name}`);
    }
    seen.add(entry.name);
    return {
      name: entry.name,
      required: entry.required,
      secret: entry.secret,
      description: entry.description,
      ...(typeof entry.default === "string" ? { default: entry.default } : {}),
    };
  });
}

function readManifestCliRequirements(manifest: Record<string, unknown>): ExtensionCliRequirement[] {
  const rawRequirements = manifest.cliRequirements;
  if (!Array.isArray(rawRequirements)) {
    return [];
  }
  const seen = new Set<string>();
  return rawRequirements.map((requirement): ExtensionCliRequirement => {
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
      throw extensionsCommandError("invalid_manifest", "Invalid cliRequirements entry.");
    }
    const entry = requirement as Record<string, unknown>;
    if (
      typeof entry.id !== "string" ||
      entry.id.trim().length === 0 ||
      typeof entry.binary !== "string" ||
      entry.binary.trim().length === 0 ||
      typeof entry.required !== "boolean"
    ) {
      throw extensionsCommandError("invalid_manifest", "Invalid cliRequirements entry.");
    }
    if ("versionCommand" in entry && typeof entry.versionCommand !== "string") {
      throw extensionsCommandError("invalid_manifest", "Invalid cliRequirements entry.");
    }
    if ("package" in entry && (typeof entry.package !== "string" || entry.package.trim() === "")) {
      throw extensionsCommandError("invalid_manifest", "Invalid cliRequirements entry.");
    }
    if ("version" in entry && (typeof entry.version !== "string" || entry.version.trim() === "")) {
      throw extensionsCommandError("invalid_manifest", "Invalid cliRequirements entry.");
    }
    if (
      "installCommand" in entry &&
      (typeof entry.installCommand !== "string" || entry.installCommand.trim() === "")
    ) {
      throw extensionsCommandError("invalid_manifest", "Invalid cliRequirements entry.");
    }
    if (
      typeof entry.installCommand === "string" &&
      entry.installCommand.includes("{{version}}") &&
      typeof entry.version !== "string"
    ) {
      throw extensionsCommandError(
        "invalid_manifest",
        `CLI requirement installCommand uses {{version}} without version: ${entry.id}`,
      );
    }
    if (seen.has(entry.id)) {
      throw extensionsCommandError("invalid_manifest", `Duplicate CLI requirement id: ${entry.id}`);
    }
    seen.add(entry.id);
    return {
      id: entry.id,
      binary: entry.binary,
      required: entry.required,
      ...(typeof entry.package === "string" ? { package: entry.package } : {}),
      ...(typeof entry.version === "string" ? { version: entry.version } : {}),
      ...(typeof entry.versionCommand === "string" && entry.versionCommand.trim().length > 0
        ? { versionCommand: entry.versionCommand }
        : {}),
      ...(typeof entry.installCommand === "string" ? { installCommand: entry.installCommand } : {}),
    };
  });
}

function readManifestGeneratedInstructions(
  manifest: Record<string, unknown>,
): ExtensionGeneratedInstruction[] {
  const rawGenerated = manifest.generatedInstructions;
  if (!Array.isArray(rawGenerated)) {
    return [];
  }
  const outputs = new Set<string>();
  return rawGenerated.map((instruction): ExtensionGeneratedInstruction => {
    if (!instruction || typeof instruction !== "object" || Array.isArray(instruction)) {
      throw extensionsCommandError("invalid_manifest", "Invalid generatedInstructions entry.");
    }
    const entry = instruction as Record<string, unknown>;
    if (typeof entry.output !== "string" || typeof entry.script !== "string") {
      throw extensionsCommandError("invalid_manifest", "Invalid generatedInstructions entry.");
    }
    if ("versionCliRequirementId" in entry && typeof entry.versionCliRequirementId !== "string") {
      throw extensionsCommandError("invalid_manifest", "Invalid generatedInstructions entry.");
    }
    if (outputs.has(entry.output)) {
      throw extensionsCommandError(
        "invalid_manifest",
        `Duplicate generated instruction output: ${entry.output}`,
      );
    }
    outputs.add(entry.output);
    return {
      output: entry.output,
      script: entry.script,
      ...(typeof entry.versionCliRequirementId === "string"
        ? { versionCliRequirementId: entry.versionCliRequirementId }
        : {}),
    };
  });
}

function readManifestDependencies(
  manifest: Record<string, unknown>,
  key: "dependencies" | "trustedDependencies",
  kind: "dependency" | "trusted_dependency",
): ExtensionDependencyDeclaration[] {
  const rawDependencies = manifest[key];
  if (!rawDependencies) {
    return [];
  }
  if (
    typeof rawDependencies !== "object" ||
    Array.isArray(rawDependencies) ||
    rawDependencies === null
  ) {
    throw extensionsCommandError("invalid_manifest", `Invalid ${key} declaration.`);
  }
  return Object.entries(rawDependencies as Record<string, unknown>).map(([name, version]) => {
    if (typeof version !== "string") {
      throw extensionsCommandError("invalid_manifest", `Invalid ${key} declaration.`);
    }
    return {
      kind,
      name,
      version,
    };
  });
}

function requireEditableInstructionsExtension(
  id: string,
  options: {
    cwd?: string;
    extensionsRoot?: string;
  },
): ResolvedExtensionRecord {
  if (id.startsWith("external_instruction:")) {
    throw extensionsCommandError(
      "EXTERNAL_INSTRUCTION_READONLY",
      "External instruction records are read-only and cannot be changed through instruction lifecycle commands.",
    );
  }
  const extension = requireExtension(id, options.extensionsRoot);
  if (extension.category === "user" && extension.sourceRoot) {
    return extension;
  }
  if (extension.category === "builtin") {
    return scaffoldBuiltinSource(extension, options);
  }
  throw extensionsCommandError(
    "INSTRUCTIONS_NOT_EDITABLE",
    `${extension.title} has no editable local instruction source.`,
  );
}

function validateInstructionCommandBeforeMaterialization(
  action: string,
  id: string,
  flags: Map<string, string[]>,
  options: {
    cwd?: string;
    extensionsRoot?: string;
  },
): void {
  let requested: string[] = [];
  let from: string | null = null;
  let name: string | null = null;
  let to: string | null = null;
  if (action === "add") {
    rejectUnknownFlags(flags, ["json", "name"]);
    name = validateInstructionBasename(requireSingleFlagValue(flags, "name"));
  } else if (action === "rename") {
    rejectUnknownFlags(flags, ["from", "json", "to"]);
    from = validateInstructionBasename(requireSingleFlagValue(flags, "from"));
    to = validateInstructionBasename(requireSingleFlagValue(flags, "to"));
  } else if (action === "remove") {
    rejectUnknownFlags(flags, ["json", "name"]);
    name = validateInstructionBasename(requireSingleFlagValue(flags, "name"));
  } else if (action === "reorder") {
    rejectUnknownFlags(flags, ["file", "json"]);
    requested = flags.get("file") ?? [];
    for (const file of requested) {
      validateInstructionBasename(file);
    }
  } else if (action === "configure") {
    rejectUnknownFlags(flags, ["bypassed", "file", "json"]);
    name = validateInstructionBasename(requireSingleFlagValue(flags, "file"));
    parseInstructionBypassedFlag(flags);
  } else {
    throw extensionsCommandError(
      "unsupported_command",
      `Unsupported instructions command: ${action}`,
    );
  }

  const extension = getExtensionRecord(id);
  if (
    !extension ||
    extension.category !== "builtin" ||
    builtinSourceExists(extension.id, options.extensionsRoot)
  ) {
    return;
  }
  const defaultFiles = builtinDefaultInstructionFiles(extension, options.cwd ?? process.cwd());
  if (defaultFiles.length === 0) {
    return;
  }
  const defaultNames = new Set(defaultFiles.map((file) => file.name));
  if (action === "add" && name && defaultNames.has(name)) {
    throw extensionsCommandError(
      "INSTRUCTION_FILE_EXISTS",
      `Instruction file already exists: ${name}`,
    );
  }
  if (action === "rename") {
    if (from && !defaultNames.has(from)) {
      throw extensionsCommandError(
        "INSTRUCTION_FILE_NOT_FOUND",
        `Instruction file not found: ${from}`,
      );
    }
    if (to && defaultNames.has(to)) {
      throw extensionsCommandError(
        "INSTRUCTION_FILE_EXISTS",
        `Instruction file already exists: ${to}`,
      );
    }
  }
  if ((action === "remove" || action === "configure") && name && !defaultNames.has(name)) {
    throw extensionsCommandError(
      "INSTRUCTION_FILE_NOT_FOUND",
      `Instruction file not found: ${name}`,
    );
  }
  if (action === "reorder") {
    const requestedNames = new Set(requested);
    if (
      requested.length !== defaultNames.size ||
      requestedNames.size !== requested.length ||
      requested.some((file) => !defaultNames.has(file))
    ) {
      throw extensionsCommandError(
        "INVALID_INSTRUCTION_ORDER",
        "Reorder must mention every current full instruction file exactly once.",
      );
    }
  }
}

function builtinSourceExists(id: string, extensionsRoot: string | undefined): boolean {
  return existsSync(
    join(resolve(extensionsRoot ?? defaultExtensionsRoot()), "sources", "builtin", id),
  );
}

function validateInstructionBasename(name: string): string {
  if (
    !name.endsWith(".md") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    name.includes("\0") ||
    name.includes(",") ||
    /[<>:"|?*]/.test(name) ||
    name.trim() !== name ||
    name === ".md"
  ) {
    throw extensionsCommandError(
      "INVALID_INSTRUCTION_FILENAME",
      `Invalid instruction Markdown basename: ${name}`,
    );
  }
  return name;
}

function parseInstructionBypassedFlag(flags: Map<string, string[]>): boolean {
  const values = flags.get("bypassed");
  if (!values || values.length === 0) {
    throw extensionsCommandError(
      "INVALID_INSTRUCTION_CONFIG",
      "Missing required option: --bypassed",
    );
  }
  if (values.length > 1) {
    throw extensionsCommandError(
      "INVALID_INSTRUCTION_CONFIG",
      "--bypassed can only be provided once.",
    );
  }
  if (values[0] === "true") return true;
  if (values[0] === "false") return false;
  throw extensionsCommandError("INVALID_INSTRUCTION_CONFIG", "--bypassed must be true or false.");
}

function instructionLifecycleResult(
  base: Record<string, unknown>,
  paths: EditableInstructionPaths,
  buildRequired: boolean,
  commandFacts: Record<string, unknown>,
): SvvyxExtensionsCommandResult {
  return {
    output: {
      ...base,
      instructionsFullDir: paths.instructionsFullDir,
      instructionsFull: paths.instructionsFull,
      buildRequired,
    },
    commandFacts,
  };
}

function instructionNameExists(paths: EditableInstructionPaths, name: string): boolean {
  return readManifestInstructionFiles(readJsonObject(paths.manifest)).some(
    (instruction) => instruction.file === name,
  );
}

function requireInstructionFile(paths: EditableInstructionPaths, name: string): string {
  const file = paths.instructionsFull.find((instruction) => instruction.name === name);
  if (!file) {
    throw extensionsCommandError(
      "INSTRUCTION_FILE_NOT_FOUND",
      `Instruction file not found: ${name}`,
    );
  }
  return file.path;
}

function requireInstructionEntry(paths: EditableInstructionPaths, name: string): void {
  if (!instructionNameExists(paths, name)) {
    throw extensionsCommandError(
      "INSTRUCTION_FILE_NOT_FOUND",
      `Instruction file not found: ${name}`,
    );
  }
}

function instructionConfigFor(
  paths: EditableInstructionPaths,
  file: string,
): { bypassed: boolean } {
  const entry = readManifestInstructionFiles(readJsonObject(paths.manifest)).find(
    (instruction) => instruction.file === file,
  );
  return {
    bypassed: entry?.bypassed ?? false,
  };
}

function assertNoCaseInsensitiveInstructionCollision(
  paths: EditableInstructionPaths,
  from: string,
  to: string,
): void {
  const targetKey = to.toLocaleLowerCase();
  const collision = paths.instructionsFull.find(
    (instruction) =>
      instruction.name !== from && instruction.name.toLocaleLowerCase() === targetKey,
  );
  if (collision) {
    throw extensionsCommandError(
      "INSTRUCTION_RENAME_COLLISION",
      `Instruction rename would collide with ${collision.name}.`,
    );
  }
}

function buildInstructionReorderPlan(paths: EditableInstructionPaths, requested: string[]) {
  if (requested.length !== paths.instructionsFull.length) {
    throw extensionsCommandError(
      "INVALID_INSTRUCTION_ORDER",
      "Reorder must mention every current full instruction file exactly once.",
    );
  }
  const current = paths.instructionsFull.map((instruction) => instruction.name);
  const currentSet = new Set(current);
  const requestedSet = new Set<string>();
  for (const name of requested) {
    const normalized = validateInstructionBasename(name);
    if (requestedSet.has(normalized) || !currentSet.has(normalized)) {
      throw extensionsCommandError(
        "INVALID_INSTRUCTION_ORDER",
        "Reorder must mention every current full instruction file exactly once.",
      );
    }
    requestedSet.add(normalized);
  }

  const finalNames = new Map<string, string>();
  const loweredTargets = new Map<string, string>();
  const renamed: { from: string; to: string }[] = [];
  for (let index = 0; index < requested.length; index += 1) {
    const from = requested[index]!;
    const suffix = from.replace(/^[0-9]+-/, "");
    const to = `${String((index + 1) * 10).padStart(3, "0")}-${suffix}`;
    const lower = to.toLocaleLowerCase();
    const existing = loweredTargets.get(lower);
    if (existing) {
      throw extensionsCommandError(
        "INSTRUCTION_RENAME_COLLISION",
        `Instruction reorder would collide ${existing} with ${to}.`,
      );
    }
    loweredTargets.set(lower, to);
    finalNames.set(from, to);
    if (from !== to) {
      renamed.push({ from, to });
    }
  }

  for (const instruction of paths.instructionsFull) {
    const targetName = finalNames.get(instruction.name)!;
    const collision = paths.instructionsFull.find(
      (candidate) =>
        candidate.name !== instruction.name &&
        candidate.name.toLocaleLowerCase() === targetName.toLocaleLowerCase() &&
        !finalNames.has(candidate.name),
    );
    if (collision) {
      throw extensionsCommandError(
        "INSTRUCTION_RENAME_COLLISION",
        `Instruction reorder would collide with ${collision.name}.`,
      );
    }
  }

  const token = randomUUID();
  const renameToTemporary = renamed.map((entry) => {
    const temporary = join(paths.instructionsFullDir, `.svvy-reorder-${token}-${entry.from}`);
    if (existsSync(temporary)) {
      throw extensionsCommandError(
        "INSTRUCTION_RENAME_COLLISION",
        `Temporary reorder path already exists: ${temporary}`,
      );
    }
    return {
      from: join(paths.instructionsFullDir, entry.from),
      to: temporary,
      finalName: entry.to,
    };
  });
  const renameToFinal = renameToTemporary.map((entry) => {
    const finalPath = join(paths.instructionsFullDir, entry.finalName);
    if (existsSync(finalPath) && !renamed.some((rename) => rename.from === entry.finalName)) {
      throw extensionsCommandError(
        "INSTRUCTION_RENAME_COLLISION",
        `Instruction reorder target already exists: ${entry.finalName}`,
      );
    }
    return {
      from: entry.to,
      to: finalPath,
    };
  });

  return {
    finalNames,
    renamed,
    renameToTemporary,
    renameToFinal,
  };
}

function syncManifestInstructionFiles(
  paths: EditableInstructionPaths,
  update: (entries: { file: string; bypassed: boolean }[]) => { file: string; bypassed: boolean }[],
): void {
  const manifest = readJsonObject(paths.manifest);
  const next = update(readManifestInstructionFiles(manifest)).toSorted((left, right) =>
    left.file.localeCompare(right.file),
  );
  const seen = new Set<string>();
  manifest.instructionFiles = next.map((entry) => {
    const file = validateInstructionBasename(entry.file);
    const key = file.toLocaleLowerCase();
    if (seen.has(key)) {
      throw extensionsCommandError("invalid_manifest", "Duplicate instructionFiles entry.");
    }
    seen.add(key);
    return {
      file,
      bypassed: entry.bypassed,
    };
  });
  writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2) + "\n");
}

function captureInstructionSnapshot(paths: EditableInstructionPaths) {
  return {
    files: paths.instructionsFull.map((instruction) => ({
      name: instruction.name,
      path: instruction.path,
      content: readFileSync(instruction.path, "utf8"),
      bypassed: instruction.bypassed,
    })),
    instructionFiles: readManifestInstructionFiles(readJsonObject(paths.manifest)),
    minimalContent: readOptionalFile(paths.instructionsMinimal),
  };
}

function recordInstructionLifecycleChange(
  paths: EditableInstructionPaths,
  extensionId: string,
  kind: string,
  before: ReturnType<typeof captureInstructionSnapshot>,
  after: ReturnType<typeof captureInstructionSnapshot>,
): string {
  const changeId = `chg_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const changesRoot = join(paths.sourceRoot, ".svvy", "changes");
  mkdirSync(changesRoot, { recursive: true });
  writeFileSync(
    join(changesRoot, `${changeId}.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: changeId,
        extensionId,
        kind,
        createdAt: new Date().toISOString(),
        before,
        after,
      },
      null,
      2,
    ) + "\n",
  );
  return changeId;
}

function readInstructionLifecycleChangeCards(
  extensionsRoot: string | undefined,
  options: { includeUserExtensions?: boolean },
): ExtensionChangeCardReadModel[] {
  const cards: ExtensionChangeCardReadModel[] = [];
  const root = resolve(extensionsRoot ?? defaultExtensionsRoot(), "sources");
  const sourceKinds = options.includeUserExtensions === true ? ["user", "builtin"] : ["builtin"];
  for (const sourceKind of sourceKinds) {
    const sourceRoot = join(root, sourceKind);
    for (const id of listImmediateDirectories(sourceRoot)) {
      const changesRoot = join(sourceRoot, id, ".svvy", "changes");
      for (const entry of listJsonFiles(changesRoot)) {
        const raw = readJsonObject(join(changesRoot, entry));
        if (
          raw.schemaVersion !== 1 ||
          typeof raw.id !== "string" ||
          typeof raw.extensionId !== "string" ||
          typeof raw.kind !== "string" ||
          typeof raw.createdAt !== "string" ||
          !raw.before ||
          typeof raw.before !== "object" ||
          Array.isArray(raw.before) ||
          !raw.after ||
          typeof raw.after !== "object" ||
          Array.isArray(raw.after)
        ) {
          continue;
        }
        cards.push(
          extensionChangeCard({
            id: raw.id,
            extensionId: raw.extensionId,
            kind: "extension_files",
            sourceChangeKind: raw.kind,
            createdAt: raw.createdAt,
          }),
        );
      }
    }
  }
  return cards;
}

function readGlobalExtensionChangeCards(
  extensionsRoot: string | undefined,
  options: { includeUserExtensions?: boolean },
): ExtensionChangeCardReadModel[] {
  const cards: ExtensionChangeCardReadModel[] = [];
  const changesRoot = extensionGlobalChangesRoot(extensionsRoot);
  for (const entry of listJsonFiles(changesRoot)) {
    const raw = readJsonObject(join(changesRoot, entry));
    if (
      raw.schemaVersion !== 1 ||
      typeof raw.id !== "string" ||
      typeof raw.extensionId !== "string" ||
      typeof raw.kind !== "string" ||
      typeof raw.createdAt !== "string"
    ) {
      continue;
    }
    if (options.includeUserExtensions !== true && raw.kind === "extension_delete") {
      continue;
    }
    if (
      options.includeUserExtensions !== true &&
      getExtensionRecord(raw.extensionId)?.category !== "builtin"
    ) {
      continue;
    }
    if (
      raw.kind === "extension_usage" &&
      typeof raw.agentProfile === "string" &&
      isUsageState((raw.before as { state?: unknown } | undefined)?.state) &&
      isUsageState((raw.after as { state?: unknown } | undefined)?.state)
    ) {
      cards.push(
        extensionChangeCard({
          id: raw.id,
          extensionId: raw.extensionId,
          kind: "extension_usage",
          sourceChangeKind: raw.kind,
          createdAt: raw.createdAt,
          agentProfile: raw.agentProfile,
          beforeState: (raw.before as { state: ExtensionUsageState }).state,
          afterState: (raw.after as { state: ExtensionUsageState }).state,
        }),
      );
    }
    if (raw.kind === "extension_delete" && typeof raw.trashId === "string") {
      cards.push(
        extensionChangeCard({
          id: raw.id,
          extensionId: raw.extensionId,
          kind: "extension_delete",
          sourceChangeKind: raw.kind,
          createdAt: raw.createdAt,
          trashId: raw.trashId,
        }),
      );
    }
  }
  return cards;
}

function extensionChangeCard(input: {
  agentProfile?: string;
  afterState?: ExtensionUsageState;
  beforeState?: ExtensionUsageState;
  createdAt: string;
  extensionId: string;
  id: string;
  kind: ExtensionChangeCardReadModel["kind"];
  sourceChangeKind: string;
  trashId?: string;
}): ExtensionChangeCardReadModel {
  return {
    id: input.id,
    extensionId: input.extensionId,
    kind: input.kind,
    sourceChangeKind: input.sourceChangeKind,
    createdAt: input.createdAt,
    title: extensionChangeTitle(input.sourceChangeKind),
    description: extensionChangeDescription(input),
    revertCommand: `svvyx extensions revert ${input.id} --json`,
    reversible: true,
  };
}

function extensionChangeTitle(sourceChangeKind: string): string {
  if (sourceChangeKind === "instructions_add") return "Instruction file added";
  if (sourceChangeKind === "instructions_remove") return "Instruction file removed";
  if (sourceChangeKind === "instructions_rename") return "Instruction file renamed";
  if (sourceChangeKind === "instructions_reorder") return "Instruction files reordered";
  if (sourceChangeKind === "instructions_configure") return "Instruction config changed";
  if (sourceChangeKind === "instructions_reset") return "Builtin instructions reset";
  if (sourceChangeKind === "extension_files_revert") return "Extension file change reverted";
  if (sourceChangeKind === "extension_usage") return "Extension usage changed";
  if (sourceChangeKind === "extension_delete") return "Extension deleted";
  return "Extension change";
}

function extensionChangeDescription(input: {
  agentProfile?: string;
  afterState?: ExtensionUsageState;
  beforeState?: ExtensionUsageState;
  extensionId: string;
  sourceChangeKind: string;
  trashId?: string;
}): string {
  if (input.sourceChangeKind === "extension_usage") {
    return `${input.extensionId} ${input.agentProfile ?? "profile"} usage changed from ${input.beforeState} to ${input.afterState}.`;
  }
  if (input.sourceChangeKind === "extension_delete") {
    return `${input.extensionId} moved to app-managed trash ${input.trashId}.`;
  }
  return `${input.extensionId} recorded ${input.sourceChangeKind}.`;
}

function listJsonFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root)
    .filter((entry) => entry.endsWith(".json"))
    .toSorted((left, right) => left.localeCompare(right));
}

async function runRevertCommand(
  words: string[],
  options: {
    agentSettingsStore?: AgentSettingsStore;
    buildRoot?: string;
    cliProbe?: SvvyxExtensionsCliProbe;
    cwd?: string;
    dependencyApprovalStore?: ExtensionDependencyApprovalStore;
    dependencyInstaller?: SvvyxExtensionsDependencyInstaller;
    env?: NodeJS.ProcessEnv;
    envSecretStore?: ExtensionEnvSecretStore;
    extensionsRoot?: string;
    structuredSessionStore?: StructuredSessionStateStore;
  },
): Promise<SvvyxExtensionsCommandResult> {
  const flags = parseFlags(words.slice(1));
  requireJson(flags);
  rejectUnknownFlags(flags, ["json"]);
  const changeId = words[0];
  if (!changeId || changeId.startsWith("--")) {
    throw extensionsCommandError("invalid_argument", "Missing change id.");
  }
  const deleteChange = readExtensionDeleteChange(changeId, options.extensionsRoot);
  if (deleteChange) {
    return revertExtensionDeleteChange(deleteChange, options.extensionsRoot);
  }
  const usageChange = readExtensionUsageChange(changeId, options.extensionsRoot);
  if (usageChange) {
    return revertExtensionUsageChange(usageChange, options);
  }
  const change = readInstructionLifecycleChange(changeId, options.extensionsRoot);
  const extension = requireEditableInstructionsExtension(change.extensionId, options);
  const paths = editableExtensionInspectPaths(extension, options.extensionsRoot);
  const current = captureInstructionSnapshot(paths);
  if (!instructionSnapshotsEqual(current, change.after)) {
    throw extensionsCommandError(
      "REVERT_CONFLICT",
      `Extension change ${changeId} cannot be reverted because instruction files changed after it was recorded.`,
      {
        conflictingPaths: conflictingInstructionSnapshotPaths(
          current,
          change.after,
          paths.manifest,
        ),
      },
    );
  }

  restoreInstructionSnapshot(paths, change.before);
  const afterPaths = editableExtensionInspectPaths(extension, options.extensionsRoot);
  const revertChangeId = recordInstructionLifecycleChange(
    afterPaths,
    extension.id,
    "extension_files_revert",
    current,
    captureInstructionSnapshot(afterPaths),
  );
  const autoBuildResult = await runBuildCommand([extension.id, "--json"], options);
  const autoBuild = projectAutoBuildResult(autoBuildResult, "revert_auto_build");
  const buildRequired = autoBuild.status !== "success";
  return {
    output: {
      ok: true,
      revertedChangeId: changeId,
      changeId: revertChangeId,
      result: {
        kind: "extension_files",
        sourceChangeKind: change.kind,
        extensionId: extension.id,
        files: changedInstructionSnapshotPaths(current, change.before, paths.manifest).map(
          (path) => ({
            path,
            status: "reverted",
          }),
        ),
        buildRequired,
        autoBuild,
      },
    },
    commandFacts: {
      ...autoBuildResult.commandFacts,
      extensionReverted: true,
      extensionId: extension.id,
      revertedChangeId: changeId,
      revertChangeId,
      revertedChangeKind: "extension_files",
      sourceChangeKind: change.kind,
      extensionReady: autoBuild.status === "success" && autoBuild.runtimeReady,
      autoBuildStatus: autoBuild.status,
      ...(autoBuild.status === "needs_user_confirmation"
        ? { blockedOperation: autoBuild.blockedOperation }
        : {}),
    },
  };
}

function projectAutoBuildResult(
  autoBuildResult: SvvyxExtensionsCommandResult,
  blockedOperation?: "revert_auto_build" | "snapshot_load",
):
  | {
      status: "success";
      currentPath: unknown;
      contextReady: boolean;
      runtimeReady: boolean;
      issues?: unknown;
    }
  | {
      status: "blocked";
      error: unknown;
    }
  | {
      status: "needs_user_confirmation";
      approvalRequestId: string;
      blockedOperation: unknown;
      items: unknown;
      message: unknown;
    } {
  const autoBuildOutput = autoBuildResult.output as {
    approvalRequestId?: unknown;
    blockedOperation?: unknown;
    build?: {
      currentPath?: unknown;
      status?: unknown;
    };
    contextReady?: unknown;
    error?: unknown;
    items?: unknown;
    message?: unknown;
    issues?: unknown;
    ok?: unknown;
    runtimeReady?: unknown;
    status?: unknown;
  };
  if (autoBuildOutput.ok === true && autoBuildOutput.build?.status === "success") {
    return {
      status: "success",
      currentPath: autoBuildOutput.build.currentPath,
      contextReady: autoBuildOutput.contextReady === true,
      runtimeReady: autoBuildOutput.runtimeReady === true,
      ...(Array.isArray(autoBuildOutput.issues) && autoBuildOutput.issues.length > 0
        ? { issues: autoBuildOutput.issues }
        : {}),
    };
  }
  if (autoBuildOutput.ok === false && autoBuildOutput.status === "needs_user_confirmation") {
    return {
      status: "needs_user_confirmation",
      approvalRequestId:
        typeof autoBuildOutput.approvalRequestId === "string"
          ? autoBuildOutput.approvalRequestId
          : "",
      blockedOperation: blockedOperation ?? autoBuildOutput.blockedOperation,
      items: autoBuildOutput.items,
      message: autoBuildOutput.message,
    };
  }
  return {
    status: "blocked",
    error: autoBuildOutput.error ?? autoBuildResult.output,
  };
}

function recordExtensionDeleteChange(input: {
  extensionsRoot: string;
  extensionId: string;
  sourceRoot: string;
  trashId: string;
  trashSourceRoot: string;
}): string {
  const changeId = `chg_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const changesRoot = extensionGlobalChangesRoot(input.extensionsRoot);
  mkdirSync(changesRoot, { recursive: true });
  writeFileSync(
    join(changesRoot, `${changeId}.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: changeId,
        extensionId: input.extensionId,
        kind: "extension_delete",
        createdAt: new Date().toISOString(),
        trashId: input.trashId,
        sourceRoot: input.sourceRoot,
        trashSourceRoot: input.trashSourceRoot,
      },
      null,
      2,
    ) + "\n",
  );
  return changeId;
}

function readExtensionDeleteChange(
  changeId: string,
  extensionsRoot: string | undefined,
): {
  id: string;
  extensionId: string;
  kind: "extension_delete";
  sourceRoot: string;
  trashId: string;
  trashSourceRoot: string;
} | null {
  if (!/^chg_[a-z0-9]+_[a-f0-9-]+$/i.test(changeId)) {
    throw extensionsCommandError("INVALID_CHANGE_ID", `Invalid extension change id: ${changeId}`);
  }
  const path = join(extensionGlobalChangesRoot(extensionsRoot), `${changeId}.json`);
  if (!existsSync(path)) {
    return null;
  }
  const raw = readJsonObject(path) as Record<string, any>;
  if (raw.kind !== "extension_delete") {
    return null;
  }
  if (
    raw.schemaVersion !== 1 ||
    raw.id !== changeId ||
    typeof raw.extensionId !== "string" ||
    typeof raw.trashId !== "string" ||
    typeof raw.sourceRoot !== "string" ||
    typeof raw.trashSourceRoot !== "string"
  ) {
    throw extensionsCommandError(
      "INVALID_CHANGE_RECORD",
      `Invalid extension change record: ${changeId}`,
    );
  }
  return {
    id: changeId,
    extensionId: raw.extensionId,
    kind: "extension_delete",
    sourceRoot: raw.sourceRoot,
    trashId: raw.trashId,
    trashSourceRoot: raw.trashSourceRoot,
  };
}

function revertExtensionDeleteChange(
  change: NonNullable<ReturnType<typeof readExtensionDeleteChange>>,
  extensionsRoot: string | undefined,
): SvvyxExtensionsCommandResult {
  if (
    existsSync(change.sourceRoot) ||
    readUserExtensionRecord(change.extensionId, extensionsRoot)
  ) {
    throw extensionsCommandError(
      "REVERT_CONFLICT",
      `Extension delete change ${change.id} cannot be reverted because ${change.extensionId} already exists.`,
      {
        conflictingPaths: [change.sourceRoot],
      },
    );
  }
  if (!existsSync(change.trashSourceRoot)) {
    throw extensionsCommandError(
      "REVERT_CONFLICT",
      `Extension delete change ${change.id} cannot be reverted because its trash entry is missing.`,
      {
        conflictingPaths: [change.trashSourceRoot],
      },
    );
  }
  mkdirSync(dirname(change.sourceRoot), { recursive: true });
  renameSync(change.trashSourceRoot, change.sourceRoot);
  const restoredExtension = requireExtension(change.extensionId, extensionsRoot);
  const restoredBuildCurrent = extensionBuildCurrentPath(
    change.extensionId,
    undefined,
    extensionsRoot,
  );
  const buildRequired =
    restoredExtension.category === "user" &&
    (!existsSync(restoredBuildCurrent) ||
      extensionBuildIsOutdated(restoredExtension, restoredBuildCurrent));
  const revertChangeId = recordExtensionDeleteRevertChange({
    extensionsRoot: resolve(extensionsRoot ?? defaultExtensionsRoot()),
    extensionId: change.extensionId,
    revertedChangeId: change.id,
    sourceRoot: change.sourceRoot,
    trashId: change.trashId,
    trashSourceRoot: change.trashSourceRoot,
  });
  return {
    output: {
      ok: true,
      revertedChangeId: change.id,
      changeId: revertChangeId,
      result: {
        kind: "extension_delete",
        extensionId: change.extensionId,
        restored: true,
        trashId: change.trashId,
        buildRequired,
        autoBuild: null,
      },
    },
    commandFacts: {
      extensionReverted: true,
      extensionId: change.extensionId,
      revertedChangeId: change.id,
      revertChangeId,
      revertedChangeKind: "extension_delete",
      extensionReady: false,
    },
  };
}

function recordExtensionDeleteRevertChange(input: {
  extensionsRoot: string;
  extensionId: string;
  revertedChangeId: string;
  sourceRoot: string;
  trashId: string;
  trashSourceRoot: string;
}): string {
  const changeId = `chg_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const changesRoot = extensionGlobalChangesRoot(input.extensionsRoot);
  mkdirSync(changesRoot, { recursive: true });
  writeFileSync(
    join(changesRoot, `${changeId}.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: changeId,
        extensionId: input.extensionId,
        kind: "extension_delete_revert",
        createdAt: new Date().toISOString(),
        revertedChangeId: input.revertedChangeId,
        trashId: input.trashId,
        sourceRoot: input.sourceRoot,
        trashSourceRoot: input.trashSourceRoot,
      },
      null,
      2,
    ) + "\n",
  );
  return changeId;
}

function extensionGlobalChangesRoot(extensionsRoot: string | undefined): string {
  return join(resolve(extensionsRoot ?? defaultExtensionsRoot()), ".svvy", "changes");
}

function recordExtensionUsageChange(input: {
  extensionsRoot: string;
  extensionId: string;
  agentProfile: string;
  profileId: string;
  beforeState: ExtensionUsageState;
  afterState: ExtensionUsageState;
}): string {
  const changeId = `chg_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const changesRoot = extensionGlobalChangesRoot(input.extensionsRoot);
  mkdirSync(changesRoot, { recursive: true });
  writeFileSync(
    join(changesRoot, `${changeId}.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: changeId,
        extensionId: input.extensionId,
        kind: "extension_usage",
        createdAt: new Date().toISOString(),
        agentProfile: input.agentProfile,
        profileId: input.profileId,
        before: {
          state: input.beforeState,
        },
        after: {
          state: input.afterState,
        },
      },
      null,
      2,
    ) + "\n",
  );
  return changeId;
}

function readExtensionUsageChange(
  changeId: string,
  extensionsRoot: string | undefined,
): {
  id: string;
  extensionId: string;
  kind: "extension_usage";
  agentProfile: string;
  profileId: string;
  before: { state: ExtensionUsageState };
  after: { state: ExtensionUsageState };
} | null {
  if (!/^chg_[a-z0-9]+_[a-f0-9-]+$/i.test(changeId)) {
    throw extensionsCommandError("INVALID_CHANGE_ID", `Invalid extension change id: ${changeId}`);
  }
  const path = join(extensionGlobalChangesRoot(extensionsRoot), `${changeId}.json`);
  if (!existsSync(path)) {
    return null;
  }
  const raw = readJsonObject(path) as Record<string, any>;
  if (raw.kind !== "extension_usage") {
    return null;
  }
  if (
    raw.schemaVersion !== 1 ||
    raw.id !== changeId ||
    typeof raw.extensionId !== "string" ||
    typeof raw.agentProfile !== "string" ||
    typeof raw.profileId !== "string" ||
    !isUsageState(raw.before?.state) ||
    !isUsageState(raw.after?.state)
  ) {
    throw extensionsCommandError(
      "INVALID_CHANGE_RECORD",
      `Invalid extension usage change record: ${changeId}`,
    );
  }
  return {
    id: changeId,
    extensionId: raw.extensionId,
    kind: "extension_usage",
    agentProfile: raw.agentProfile,
    profileId: raw.profileId,
    before: { state: raw.before.state },
    after: { state: raw.after.state },
  };
}

function revertExtensionUsageChange(
  change: NonNullable<ReturnType<typeof readExtensionUsageChange>>,
  options: {
    agentSettingsStore?: AgentSettingsStore;
    extensionsRoot?: string;
    structuredSessionStore?: StructuredSessionStateStore;
  },
): SvvyxExtensionsCommandResult {
  const store = requireAgentSettingsStore(options.agentSettingsStore);
  const target = resolveUsageProfile(store, change.agentProfile);
  if (target.profile.id !== change.profileId) {
    throw extensionsCommandError(
      "REVERT_CONFLICT",
      `Extension usage change ${change.id} cannot be reverted because its profile target changed.`,
      {
        conflictingPaths: [`agent-profile:${change.agentProfile}`],
      },
    );
  }
  const currentState = configuredExtensionUsageState({
    actor: target.actor,
    agentSettingsStore: store,
    extensionId: change.extensionId,
    profile: target.profile,
  });
  if (currentState !== change.after.state) {
    throw extensionsCommandError(
      "REVERT_CONFLICT",
      `Extension usage change ${change.id} cannot be reverted because usage changed after it was recorded.`,
      {
        conflictingPaths: [`agent-profile:${change.agentProfile}:extension:${change.extensionId}`],
      },
    );
  }
  requireExtension(change.extensionId, options.extensionsRoot);
  const defaultState = configuredDefaultExtensionUsageState({
    actor: target.actor,
    agentSettingsStore: store,
    extensionId: change.extensionId,
    profile: profileWithoutExtensionUsage(target.profile, change.extensionId),
  });
  setUsageProfile(store, target, change.extensionId, change.before.state, {
    explicit: change.before.state !== defaultState,
  });
  const revertChangeId = recordExtensionUsageChange({
    extensionsRoot: resolve(options.extensionsRoot ?? defaultExtensionsRoot()),
    extensionId: change.extensionId,
    agentProfile: target.agentProfileName,
    profileId: target.profile.id,
    beforeState: change.after.state,
    afterState: change.before.state,
  });
  const queuedUpdates = queueUsageAgentContextRefreshes({
    store: options.structuredSessionStore,
    agentProfile: target.agentProfileName,
    profileId: target.profile.id,
    changeId: revertChangeId,
  });
  return {
    output: {
      ok: true,
      revertedChangeId: change.id,
      changeId: revertChangeId,
      result: {
        kind: "extension_usage",
        extensionId: change.extensionId,
        agentProfile: target.agentProfileName,
        before: change.after,
        after: change.before,
        agentContextImpact: {
          affectsNewTurns: true,
          activeRunsChangeAtNextSafeBoundary: true,
          queuedUpdates,
        },
      },
    },
    commandFacts: {
      extensionReverted: true,
      extensionId: change.extensionId,
      revertedChangeId: change.id,
      revertChangeId,
      revertedChangeKind: "extension_usage",
      queuedAgentContextRefreshes: queuedUpdates.length,
    },
  };
}

function isUsageState(value: unknown): value is ExtensionUsageState {
  return value === "loaded" || value === "available" || value === "unavailable";
}

function readInstructionLifecycleChange(
  changeId: string,
  extensionsRoot: string | undefined,
): {
  id: string;
  extensionId: string;
  kind: string;
  before: ReturnType<typeof captureInstructionSnapshot>;
  after: ReturnType<typeof captureInstructionSnapshot>;
} {
  if (!/^chg_[a-z0-9]+_[a-f0-9-]+$/i.test(changeId)) {
    throw extensionsCommandError("INVALID_CHANGE_ID", `Invalid extension change id: ${changeId}`);
  }
  const root = resolve(extensionsRoot ?? defaultExtensionsRoot(), "sources");
  for (const sourceKind of ["user", "builtin"]) {
    const sourceRoot = join(root, sourceKind);
    for (const id of listImmediateDirectories(sourceRoot)) {
      const path = join(sourceRoot, id, ".svvy", "changes", `${changeId}.json`);
      if (!existsSync(path)) {
        continue;
      }
      const raw = readJsonObject(path);
      if (
        raw.schemaVersion !== 1 ||
        raw.id !== changeId ||
        typeof raw.extensionId !== "string" ||
        typeof raw.kind !== "string" ||
        !raw.before ||
        typeof raw.before !== "object" ||
        Array.isArray(raw.before) ||
        !raw.after ||
        typeof raw.after !== "object" ||
        Array.isArray(raw.after)
      ) {
        throw extensionsCommandError(
          "INVALID_CHANGE_RECORD",
          `Invalid extension change record: ${changeId}`,
        );
      }
      return {
        id: changeId,
        extensionId: raw.extensionId,
        kind: raw.kind,
        before: readInstructionSnapshotRecord(raw.before),
        after: readInstructionSnapshotRecord(raw.after),
      };
    }
  }
  throw extensionsCommandError("CHANGE_NOT_FOUND", `Extension change not found: ${changeId}`);
}

function listImmediateDirectories(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root)
    .filter((entry) => {
      try {
        return lstatSync(join(root, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .toSorted((left, right) => left.localeCompare(right));
}

function readInstructionSnapshotRecord(
  value: object,
): ReturnType<typeof captureInstructionSnapshot> {
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.files) || !Array.isArray(raw.instructionFiles)) {
    throw extensionsCommandError(
      "INVALID_CHANGE_RECORD",
      "Invalid extension instruction snapshot.",
    );
  }
  return {
    files: raw.files.map((file) => {
      if (!file || typeof file !== "object" || Array.isArray(file)) {
        throw extensionsCommandError(
          "INVALID_CHANGE_RECORD",
          "Invalid extension instruction file snapshot.",
        );
      }
      const entry = file as Record<string, unknown>;
      if (
        typeof entry.name !== "string" ||
        typeof entry.path !== "string" ||
        typeof entry.content !== "string" ||
        typeof entry.bypassed !== "boolean"
      ) {
        throw extensionsCommandError(
          "INVALID_CHANGE_RECORD",
          "Invalid extension instruction file snapshot.",
        );
      }
      return {
        name: validateInstructionBasename(entry.name),
        path: entry.path,
        content: entry.content,
        bypassed: entry.bypassed,
      };
    }),
    instructionFiles: raw.instructionFiles.map((file) => {
      if (!file || typeof file !== "object" || Array.isArray(file)) {
        throw extensionsCommandError(
          "INVALID_CHANGE_RECORD",
          "Invalid extension instruction config snapshot.",
        );
      }
      const entry = file as Record<string, unknown>;
      if (typeof entry.file !== "string" || typeof entry.bypassed !== "boolean") {
        throw extensionsCommandError(
          "INVALID_CHANGE_RECORD",
          "Invalid extension instruction config snapshot.",
        );
      }
      return {
        file: validateInstructionBasename(entry.file),
        bypassed: entry.bypassed,
      };
    }),
    minimalContent:
      typeof raw.minimalContent === "string"
        ? raw.minimalContent
        : (() => {
            throw extensionsCommandError(
              "INVALID_CHANGE_RECORD",
              "Invalid extension minimal instruction snapshot.",
            );
          })(),
  };
}

function instructionSnapshotsEqual(
  left: ReturnType<typeof captureInstructionSnapshot>,
  right: ReturnType<typeof captureInstructionSnapshot>,
): boolean {
  return (
    JSON.stringify(normalizeInstructionSnapshot(left)) ===
    JSON.stringify(normalizeInstructionSnapshot(right))
  );
}

function normalizeInstructionSnapshot(snapshot: ReturnType<typeof captureInstructionSnapshot>) {
  return {
    files: snapshot.files
      .map((file) => ({
        name: file.name,
        content: file.content,
        bypassed: file.bypassed,
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name)),
    instructionFiles: snapshot.instructionFiles
      .map((file) => ({
        file: file.file,
        bypassed: file.bypassed,
      }))
      .toSorted((left, right) => left.file.localeCompare(right.file)),
    minimalContent: snapshot.minimalContent,
  };
}

function conflictingInstructionSnapshotPaths(
  current: ReturnType<typeof captureInstructionSnapshot>,
  expected: ReturnType<typeof captureInstructionSnapshot>,
  manifestPath: string,
): string[] {
  return changedInstructionSnapshotPaths(current, expected, manifestPath);
}

function changedInstructionSnapshotPaths(
  left: ReturnType<typeof captureInstructionSnapshot>,
  right: ReturnType<typeof captureInstructionSnapshot>,
  manifestPath: string,
): string[] {
  const paths = new Map<string, { left?: string; right?: string }>();
  for (const file of left.files) {
    paths.set(file.path, { left: file.content });
  }
  for (const file of right.files) {
    const entry = paths.get(file.path) ?? {};
    entry.right = file.content;
    paths.set(file.path, entry);
  }
  const minimalPath = join(dirname(manifestPath), "instructions", "minimal.md");
  return [...paths.entries()]
    .filter(([, value]) => value.left !== value.right)
    .map(([path]) => path)
    .concat(left.minimalContent === right.minimalContent ? [] : [minimalPath])
    .concat(instructionConfigSnapshotsEqual(left, right) ? [] : [manifestPath])
    .toSorted((leftPath, rightPath) => leftPath.localeCompare(rightPath));
}

function instructionConfigSnapshotsEqual(
  left: ReturnType<typeof captureInstructionSnapshot>,
  right: ReturnType<typeof captureInstructionSnapshot>,
): boolean {
  return (
    JSON.stringify(normalizeInstructionSnapshot(left).instructionFiles) ===
    JSON.stringify(normalizeInstructionSnapshot(right).instructionFiles)
  );
}

function restoreInstructionSnapshot(
  paths: EditableInstructionPaths,
  snapshot: ReturnType<typeof captureInstructionSnapshot>,
): void {
  mkdirSync(paths.instructionsFullDir, { recursive: true });
  for (const file of readdirSync(paths.instructionsFullDir)) {
    if (file.endsWith(".md")) {
      rmSync(join(paths.instructionsFullDir, file), { force: true });
    }
  }
  for (const file of snapshot.files) {
    writeFileSync(join(paths.instructionsFullDir, file.name), file.content);
  }
  mkdirSync(dirname(paths.instructionsMinimal), { recursive: true });
  writeFileSync(paths.instructionsMinimal, snapshot.minimalContent);
  syncManifestInstructionFiles(paths, () => snapshot.instructionFiles);
}

function readOptionalFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function sourceBuildFingerprint(sourceRoot: string): string | null {
  if (!existsSync(sourceRoot)) {
    return null;
  }
  const files = listBuildInputFiles(sourceRoot);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.slice(sourceRoot.length + 1));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listBuildInputFiles(root: string): string[] {
  const files: string[] = [];
  const pending: string[] = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === ".svvy") {
        continue;
      }
      const path = join(current, entry);
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (stat.isFile()) {
        files.push(path);
      }
    }
  }
  return files.toSorted((left, right) => left.localeCompare(right));
}

function extensionPaths(
  extension: ResolvedExtensionRecord,
  cwd: string,
  buildRoot: string | undefined,
  extensionsRoot: string | undefined,
) {
  if (extension.sourceRoot) {
    return editableExtensionInspectPaths(extension, extensionsRoot);
  }
  if (extension.category === "builtin") {
    return editableExtensionInspectPaths(
      scaffoldBuiltinSource(extension, { cwd, extensionsRoot }),
      extensionsRoot,
    );
  }
  const generatedRoot = resolve(cwd, "generated");
  return {
    sourceRoot: cwd,
    manifest: null,
    instructionsFull: (extension.generatedInstructions ?? []).map((instruction) => ({
      name: instruction.output.split("/").at(-1) ?? instruction.output,
      path: resolve(cwd, instruction.output),
      bypassed:
        extension.instructionFiles?.some(
          (file) => file.file === instruction.output.split("/").at(-1) && file.bypassed,
        ) ?? false,
      generated: {
        script: resolve(cwd, instruction.script),
        output: resolve(cwd, instruction.output),
      },
    })),
    instructionsFullDir: null,
    instructionsMinimal: null,
    externalInstructionFile: null,
    extensionSource: extension.interface === "svvyx" ? resolve(cwd, "src", "bun") : null,
    packageJson: resolve(cwd, "package.json"),
    lockfile: existsSync(resolve(cwd, "bun.lock")) ? resolve(cwd, "bun.lock") : null,
    generatedRoot,
    typescriptTypes: extension.typescriptApiEnabled
      ? resolve(generatedRoot, "extensions", extension.id, "types.d.ts")
      : null,
    buildCurrent: extensionBuildCurrentPath(extension.id, buildRoot, extensionsRoot),
  };
}

function userExtensionPaths(
  id: string,
  extensionsRoot: string | undefined,
  interfaceKind: "instructions" | "svvyx",
): EditableExtensionPaths {
  const root = resolve(extensionsRoot ?? defaultExtensionsRoot());
  const sourceRoot = join(root, "sources", "user", id);
  const instructionsFullDir = join(sourceRoot, "instructions", "full");
  const generatedRoot = join(root, "generated", "extensions", id);
  return {
    sourceRoot,
    manifest: join(sourceRoot, "manifest.json"),
    instructionsFullDir,
    instructionsMinimal: join(sourceRoot, "instructions", "minimal.md"),
    externalInstructionFile: null,
    extensionSource: interfaceKind === "svvyx" ? join(sourceRoot, "source") : null,
    packageJson: join(root, "package", "package.json"),
    lockfile: join(root, "package", "bun.lock"),
    generatedRoot,
    typescriptTypes: null,
    buildCurrent: join(root, "builds", "extensions", id, "current"),
  };
}

function editableExtensionInspectPaths(
  extension: ResolvedExtensionRecord,
  extensionsRoot: string | undefined,
): EditableInstructionPaths {
  const paths =
    extension.category === "builtin"
      ? builtinSourcePaths(extension.id, extensionsRoot, extension.interface)
      : userExtensionPaths(
          extension.id,
          extensionsRoot,
          extension.interface as "instructions" | "svvyx",
        );
  const manifest = readJsonObject(paths.manifest);
  const instructionFiles = readManifestInstructionFiles(manifest);
  return {
    ...paths,
    extensionSource: isAppOwnedBuiltinSvvyxCommandNamespace(extension)
      ? null
      : paths.extensionSource,
    typescriptTypes: extension.typescriptApiEnabled
      ? join(paths.generatedRoot, "types.d.ts")
      : null,
    instructionsFull: listInstructionFileViews(paths.instructionsFullDir, instructionFiles).filter(
      (file) =>
        !(extension.generatedInstructions ?? []).some(
          (instruction) => basename(instruction.output) === file.name,
        ),
    ),
  };
}

function builtinSourcePaths(
  id: string,
  extensionsRoot: string | undefined,
  interfaceKind: ExtensionRecord["interface"],
): EditableExtensionPaths {
  const root = resolve(extensionsRoot ?? defaultExtensionsRoot());
  const sourceRoot = join(root, "sources", "builtin", id);
  const instructionsFullDir = join(sourceRoot, "instructions", "full");
  const generatedRoot = join(root, "generated", "extensions", id);
  return {
    sourceRoot,
    manifest: join(sourceRoot, "manifest.json"),
    instructionsFullDir,
    instructionsMinimal: join(sourceRoot, "instructions", "minimal.md"),
    externalInstructionFile: null,
    extensionSource: interfaceKind === "svvyx" ? join(sourceRoot, "source") : null,
    packageJson: join(root, "package", "package.json"),
    lockfile: join(root, "package", "bun.lock"),
    generatedRoot,
    typescriptTypes: null,
    buildCurrent: join(root, "builds", "extensions", id, "current"),
  };
}

function listInstructionFileViews(
  instructionsFullDir: string,
  instructionFiles: readonly { file: string; bypassed: boolean }[],
): InstructionFileView[] {
  if (!existsSync(instructionsFullDir)) {
    return [];
  }
  const config = new Map(instructionFiles.map((entry) => [entry.file, entry.bypassed]));
  return readdirSync(instructionsFullDir)
    .filter((entry) => entry.endsWith(".md"))
    .toSorted((left, right) => left.localeCompare(right))
    .filter((entry) => {
      try {
        return lstatSync(join(instructionsFullDir, entry)).isFile();
      } catch {
        return false;
      }
    })
    .map((name) => ({
      name,
      path: join(instructionsFullDir, name),
      bypassed: config.get(name) ?? false,
    }));
}

function extensionSourceRoot(extensionsRoot: string | undefined, id: string): string {
  return join(resolve(extensionsRoot ?? defaultExtensionsRoot()), "sources", "user", id);
}

function extensionBuildCurrentPath(
  id: string,
  buildRoot: string | undefined,
  extensionsRoot: string | undefined,
): string {
  return join(
    resolve(buildRoot ?? join(extensionsRoot ?? defaultExtensionsRoot(), "builds", "extensions")),
    id,
    "current",
  );
}

function extensionBuildStagingPath(
  id: string,
  buildRoot: string | undefined,
  extensionsRoot: string | undefined,
): string {
  return join(
    resolve(buildRoot ?? join(extensionsRoot ?? defaultExtensionsRoot(), "builds", "extensions")),
    id,
    "staging",
    `build_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
  );
}

function promoteExtensionBuild(
  stagingPath: string,
  currentPath: string,
  afterPromote?: () => void,
): void {
  const parent = dirname(currentPath);
  mkdirSync(parent, { recursive: true });
  const previousPath = join(
    parent,
    `.previous-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
  );
  try {
    if (existsSync(currentPath)) {
      renameSync(currentPath, previousPath);
    }
    renameSync(stagingPath, currentPath);
    afterPromote?.();
    if (existsSync(previousPath)) {
      rmSync(previousPath, { force: true, recursive: true });
    }
  } catch (error) {
    if (existsSync(currentPath)) {
      rmSync(currentPath, { force: true, recursive: true });
    }
    if (existsSync(previousPath)) {
      renameSync(previousPath, currentPath);
    }
    if (existsSync(stagingPath)) {
      rmSync(stagingPath, { force: true, recursive: true });
    }
    throw error;
  }
}

function defaultExtensionsRoot(): string {
  return join(homedir(), ".config", "svvy", "extensions");
}

function userExtensionUsageStates(extensionId: string, store?: AgentSettingsStore) {
  return usageStatesForUserExtension(extensionId, store, {
    orchestrator: "loaded",
    handler: "unavailable",
    "workflow-task": "loaded",
  });
}

function usageStatesForUserExtension(
  extensionId: string,
  store: AgentSettingsStore | undefined,
  fallback: Record<SvvyActorKind, ExtensionUsageState>,
) {
  const settings = store?.getState();
  const defaultUsage = settings?.extensionDefaults.usage;
  const orchestratorProfiles =
    settings?.agents.orchestrators ??
    ([
      {
        id: DEFAULT_ORCHESTRATOR_PROFILE_ID,
        extensionUsage: {} as Record<string, ExtensionUsageState>,
      },
    ] as const);
  const handlerProfile = settings?.agents.special.threadHandler;
  return [
    ...orchestratorProfiles.map((profile) => ({
      actorKind: "orchestrator" as const,
      agentProfile: profile.id,
      state:
        profile.extensionUsage[extensionId] ??
        defaultUsage?.orchestrator?.[extensionId] ??
        fallback.orchestrator,
      configurable: true,
    })),
    {
      actorKind: "handler" as const,
      agentProfile: "threadHandler",
      state: handlerProfile?.extensionUsage[extensionId] ?? fallback.handler,
      configurable: true,
    },
    ...Object.values(settings?.workflowAgents ?? DEFAULT_AGENT_SETTINGS_STATE.workflowAgents).map(
      (profile) => ({
        actorKind: "workflow-task" as const,
        agentProfile: profile.id,
        state:
          profile.overrides?.[extensionId] ??
          defaultUsage?.["workflow-task"]?.[extensionId] ??
          fallback["workflow-task"],
        configurable: true,
      }),
    ),
  ];
}

function usageStates(extensionId: string, store?: AgentSettingsStore) {
  return usageStatesForDefaultProfiles(extensionId, store);
}

function usageStatesForDefaultProfiles(extensionId: string, store?: AgentSettingsStore) {
  const settings = store?.getState();
  const orchestratorProfiles =
    settings?.agents.orchestrators ??
    ([
      {
        id: DEFAULT_ORCHESTRATOR_PROFILE_ID,
        extensionUsage: {} as Record<string, ExtensionUsageState>,
      },
    ] as const);
  const handlerProfile = settings?.agents.special.threadHandler;
  return [
    ...orchestratorProfiles.map((profile) =>
      usageRow({
        actorKind: "orchestrator",
        agentProfile: profile.id,
        extensionId,
        state: resolveActorExtensionState({
          actor: "orchestrator",
          defaultExtensionOrder: settings?.extensionDefaults.order,
          defaultExtensionUsage: settings?.extensionDefaults.usage,
          profileExtensionUsage: profile.extensionUsage,
        }),
      }),
    ),
    usageRow({
      actorKind: "handler",
      agentProfile: "threadHandler",
      extensionId,
      state: resolveActorExtensionState({
        actor: "handler",
        defaultExtensionOrder: settings?.extensionDefaults.order,
        defaultExtensionUsage: settings?.extensionDefaults.usage,
        profileExtensionUsage: handlerProfile?.extensionUsage ?? {},
      }),
    }),
    ...Object.values(settings?.workflowAgents ?? DEFAULT_AGENT_SETTINGS_STATE.workflowAgents).map(
      (profile) =>
        usageRow({
          actorKind: "workflow-task",
          agentProfile: profile.id,
          extensionId,
          state: resolveActorExtensionState({
            actor: "workflow-task",
            defaultExtensionOrder: settings?.extensionDefaults.order,
            defaultExtensionUsage: settings?.extensionDefaults.usage,
            profileExtensionUsage: profile.overrides ?? {},
          }),
        }),
    ),
  ];
}

function usageRow(input: {
  actorKind: SvvyActorKind;
  agentProfile: string;
  extensionId: string;
  state: { loadedExtensionIds: string[]; availableExtensionIds: string[] };
}): ExtensionUsageReadiness {
  const configurable = input.extensionId !== "extension-loading";
  return {
    actorKind: input.actorKind,
    agentProfile: input.agentProfile,
    state: input.state.loadedExtensionIds.includes(input.extensionId)
      ? "loaded"
      : input.state.availableExtensionIds.includes(input.extensionId)
        ? "available"
        : "unavailable",
    configurable,
    ...(configurable ? {} : { fixedReason: "app_native_control" }),
  };
}

function validateCreatableUserExtensionId(id: string, sourceRoot: string): void {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) {
    throw extensionsCommandError(
      "invalid_argument",
      "Extension id must be lowercase kebab-case starting with a letter.",
    );
  }
  if (id === "extensions") {
    throw extensionsCommandError("invalid_argument", "Extension id is reserved by svvyx.");
  }
  if (getExtensionRecord(id)) {
    throw extensionsCommandError("extension_exists", `Extension id already exists: ${id}`);
  }
  const root = resolve(sourceRoot, "..", "..", "..");
  if (containsManifestId(join(root, "sources", "user"), id)) {
    throw extensionsCommandError("extension_exists", `Extension id already exists: ${id}`);
  }
  if (existsSync(sourceRoot)) {
    throw extensionsCommandError("extension_exists", `User extension source already exists: ${id}`);
  }
  if (existsSync(join(root, "trash", id)) || containsManifestId(join(root, "trash"), id)) {
    throw extensionsCommandError("extension_exists", `Extension id is reserved by trash: ${id}`);
  }
  if (existsSync(join(root, "snapshots", id)) || containsManifestId(join(root, "snapshots"), id)) {
    throw extensionsCommandError(
      "extension_exists",
      `Extension id is reserved by snapshot restore state: ${id}`,
    );
  }
}

function containsManifestId(root: string, id: string): boolean {
  if (!existsSync(root)) {
    return false;
  }
  const pending: string[] = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry);
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (entry !== "manifest.json" || !stat.isFile()) {
        continue;
      }
      try {
        const manifest = JSON.parse(readFileSync(path, "utf8"));
        if (manifest && typeof manifest === "object" && "id" in manifest && manifest.id === id) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }
  return false;
}

function extensionIssues(
  extension: ResolvedExtensionRecord,
  cliRequirements: readonly CliRequirementStatus[],
  envRequirements: readonly EnvRequirementStatus[],
  dependencies: readonly DependencyRequirementStatus[],
  buildCurrent: string,
): ExtensionIssue[] {
  const issues: ExtensionIssue[] = [];
  if (extensionSourceBuildIsTracked(extension)) {
    if (!existsSync(buildCurrent)) {
      issues.push({
        code: "NO_CURRENT_BUILD",
        message: `${extension.title} has not been built yet.`,
      });
      issues.push({
        code: "BUILD_REQUIRED",
        message: `${extension.title} must be built before it can be loaded.`,
      });
    } else if (extensionBuildIsOutdated(extension, buildCurrent)) {
      issues.push({
        code: "BUILD_REQUIRED",
        message: `${extension.title} has source changes that have not been built.`,
      });
    }
  }
  for (const requirement of cliRequirements) {
    if (!requirement.required || requirement.status === "available") {
      continue;
    }
    if (requirement.status === "missing") {
      issues.push({
        code: "CLI_MISSING",
        message: `${requirement.binary} is required by ${extension.id} but was not found on PATH.`,
      });
      continue;
    }
    issues.push({
      code: "CLI_STATUS_UNKNOWN",
      message: `${requirement.binary} is required by ${extension.id}, but its version could not be determined.`,
    });
  }
  for (const requirement of envRequirements) {
    if (requirement.status !== "missing") {
      continue;
    }
    issues.push({
      code: "EXTENSION_ENV_MISSING",
      message: `${extension.title} requires ${requirement.name}. Configure it in the Extensions pane.`,
    });
  }
  for (const dependency of dependencies) {
    if (dependency.approval !== "approved") {
      issues.push({
        code: "DEPENDENCY_APPROVAL_REQUIRED",
        message: `${extension.title} dependency ${dependency.name} requires approval before runtime use.`,
      });
      continue;
    }
    if (dependency.install !== "installed") {
      issues.push({
        code: "DEPENDENCY_INSTALL_MISSING",
        message: `${extension.title} dependency ${dependency.name} is approved but not installed.`,
      });
    }
  }
  return issues;
}

function extensionSourceBuildIsTracked(extension: ResolvedExtensionRecord): boolean {
  if (isAppOwnedBuiltinSvvyxCommandNamespace(extension)) {
    return false;
  }
  return (
    extension.category === "user" || (extension.category === "builtin" && !!extension.sourceRoot)
  );
}

function extensionBuildIsOutdated(
  extension: ResolvedExtensionRecord,
  buildCurrent: string,
): boolean {
  const sourceFingerprint = extension.extensionBuildFingerprint;
  if (!sourceFingerprint) {
    return false;
  }
  const buildManifestPath = join(buildCurrent, "manifest.json");
  if (!existsSync(buildManifestPath)) {
    return true;
  }
  try {
    const buildManifest = readJsonObject(buildManifestPath);
    return buildManifest.sourceFingerprint !== sourceFingerprint;
  } catch {
    return true;
  }
}

function parseExtensionCommandArgs(words: string[]): {
  id: string;
  flags: Map<string, string[]>;
} {
  const id = words[0];
  if (!id || id.startsWith("--")) {
    throw extensionsCommandError("invalid_argument", "Missing extension id.");
  }
  return { id, flags: parseFlags(words.slice(1)) };
}

function splitCommandLine(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of command.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaped) {
    current += "\\";
  }
  if (quote) {
    throw extensionsCommandError("invalid_argument", "Unterminated quoted argument.");
  }
  if (current) {
    words.push(current);
  }
  return words;
}

function hasShellControlSyntax(command: string): boolean {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (!quote && ["|", ";", "&", ">", "<"].includes(char)) {
      return true;
    }
  }
  return false;
}

function parseFlags(words: string[]): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (!word.startsWith("--")) {
      throw extensionsCommandError("invalid_argument", `Unexpected positional argument: ${word}`);
    }
    const name = word.slice(2);
    if (!name) {
      throw extensionsCommandError("invalid_argument", "Invalid option.");
    }
    if (name === "json") {
      pushFlag(flags, name, "true");
      continue;
    }
    const value = words[index + 1];
    if (!value || value.startsWith("--")) {
      throw extensionsCommandError("invalid_argument", `--${name} requires a value.`);
    }
    pushFlag(flags, name, value);
    index += 1;
  }
  return flags;
}

function pushFlag(flags: Map<string, string[]>, name: string, value: string): void {
  const values = flags.get(name) ?? [];
  values.push(value);
  flags.set(name, values);
}

function requireJson(flags: Map<string, string[]>): void {
  if (!flags.has("json")) {
    throw extensionsCommandError("invalid_argument", "Extension Managing commands require --json.");
  }
}

function requireSingleFlagValue(flags: Map<string, string[]>, name: string): string {
  const values = flags.get(name);
  if (!values || values.length === 0) {
    throw extensionsCommandError("invalid_argument", `Missing required option: --${name}`);
  }
  if (values.length > 1) {
    throw extensionsCommandError("invalid_argument", `Option --${name} can only be provided once.`);
  }
  const value = values[0]!.trim();
  if (!value) {
    throw extensionsCommandError("invalid_argument", `Option --${name} cannot be empty.`);
  }
  return value;
}

function optionalBooleanFlag(flags: Map<string, string[]>, name: string): boolean | null {
  const values = flags.get(name);
  if (!values || values.length === 0) {
    return null;
  }
  if (values.length > 1) {
    throw extensionsCommandError("invalid_argument", `Option --${name} can only be provided once.`);
  }
  if (values[0] === "true") return true;
  if (values[0] === "false") return false;
  throw extensionsCommandError("invalid_argument", `--${name} must be true or false.`);
}

function rejectUnknownFlags(flags: Map<string, string[]>, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  for (const name of flags.keys()) {
    if (!allowedSet.has(name)) {
      throw extensionsCommandError("invalid_argument", `Unsupported option: --${name}`);
    }
  }
}

export function formatSvvyxExtensionsError(error: unknown): {
  ok: false;
  error: {
    code: string;
    message: string;
  } & Record<string, unknown>;
} {
  if (error instanceof ExtensionsCommandError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...error.details,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "internal_error",
      message: error instanceof Error ? error.message : "Extension Managing command failed.",
    },
  };
}

class ExtensionsCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ExtensionsCommandError";
  }
}

function extensionsCommandError(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ExtensionsCommandError {
  return new ExtensionsCommandError(code, message, details);
}
