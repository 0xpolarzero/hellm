import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { AgentSettingsStore } from "./agent-settings-store";
import type { AgentProfileMutationStore } from "./agent-profile-mutation-store";
import type {
  AddExtensionInstructionInput,
  AddExtensionInstructionResult,
  ConfigureExtensionInstructionInput,
  ConfigureExtensionInstructionResult,
  ConfigureExtensionTypescriptApiInput,
  ConfigureExtensionTypescriptApiResult,
  CreateExtensionSourceInput,
  CreateExtensionSourceResult,
  DeleteExtensionSourceInput,
  DeleteExtensionSourceResult,
  DuplicateExtensionSourceInput,
  DuplicateExtensionSourceResult,
  ExtensionId,
  RequestInputVariant,
  RuntimeExtensionContextImpactStateFacade,
  WorkspaceId,
  RuntimeClientRequestId,
  SvvyxExtensionManagementRuntimeRequest,
  RemoveExtensionInstructionInput,
  RemoveExtensionInstructionResult,
  ResetExtensionInstructionsInput,
  RuntimeResetExtensionInstructionsResult,
  RenameExtensionInstructionInput,
  RenameExtensionInstructionResult,
  ReorderExtensionInstructionsInput,
  ReorderExtensionInstructionsResult,
  RevertExtensionSourceMutationInput,
  RuntimeRevertExtensionSourceMutationResult,
} from "@svvy/core";
import {
  getExtensionRecord,
  type ExtensionCliRequirement,
  type ExtensionGeneratedInstruction,
  type ExtensionInstructionFile,
  type ExtensionRecord,
  type ExtensionUsageState,
} from "@svvy/extensions";

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

export type SvvyxExtensionsCommandResult = {
  output: unknown;
  commandFacts: Record<string, unknown>;
};

export interface SvvyxExtensionsLifecycleAdapter {
  create(input: CreateExtensionSourceInput): Promise<CreateExtensionSourceResult>;
  duplicate(input: DuplicateExtensionSourceInput): Promise<DuplicateExtensionSourceResult>;
  delete(input: DeleteExtensionSourceInput): Promise<DeleteExtensionSourceResult>;
  reset(input: ResetExtensionInstructionsInput): Promise<RuntimeResetExtensionInstructionsResult>;
  addInstruction(input: AddExtensionInstructionInput): Promise<AddExtensionInstructionResult>;
  removeInstruction(
    input: RemoveExtensionInstructionInput,
  ): Promise<RemoveExtensionInstructionResult>;
  configureInstruction(
    input: ConfigureExtensionInstructionInput,
  ): Promise<ConfigureExtensionInstructionResult>;
  renameInstruction(
    input: RenameExtensionInstructionInput,
  ): Promise<RenameExtensionInstructionResult>;
  reorderInstructions(
    input: ReorderExtensionInstructionsInput,
  ): Promise<ReorderExtensionInstructionsResult>;
  revertMutation(
    input: RevertExtensionSourceMutationInput,
  ): Promise<RuntimeRevertExtensionSourceMutationResult>;
  configureTypescriptApi(
    input: ConfigureExtensionTypescriptApiInput,
  ): Promise<ConfigureExtensionTypescriptApiResult>;
}

export function parseSvvyxExtensionManagementRuntimeRequest(input: {
  command: string;
  clientRequestId: RuntimeClientRequestId;
}): SvvyxExtensionManagementRuntimeRequest | null {
  const words = splitCommandLine(input.command);
  if (words[0] !== "svvyx" || words[1] !== "extensions") return null;
  if (words[2] === "inspect") {
    const { id, flags } = parseExtensionCommandArgs(words.slice(3));
    requireJson(flags);
    rejectUnknownFlags(flags, ["json"]);
    return { operation: "inspect", input: { extensionId: id } };
  }
  if (words[2] === "build") {
    const { id, flags } = parseExtensionCommandArgs(words.slice(3));
    requireJson(flags);
    rejectUnknownFlags(flags, ["json"]);
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id)) {
      throw extensionsCommandError("invalid_argument", "Extension id is invalid.");
    }
    return {
      operation: "build",
      input: { extensionId: id as ExtensionId, clientRequestId: input.clientRequestId },
    };
  }
  if (words[2] === "set-usage") {
    const flags = parseFlags(words.slice(3));
    requireJson(flags);
    rejectUnknownFlags(flags, ["agent-profile", "extension", "json", "state"]);
    const extensionId = requireSingleFlagValue(flags, "extension");
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(extensionId)) {
      throw extensionsCommandError("invalid_argument", "Extension id is invalid.");
    }
    return {
      operation: "usage.set",
      input: {
        clientRequestId: input.clientRequestId,
        extensionId: extensionId as ExtensionId,
        agentProfile: requireSingleFlagValue(flags, "agent-profile"),
        usage: validateUsageState(requireSingleFlagValue(flags, "state")),
      },
    };
  }
  if (words[2] === "revert" && words[3]?.startsWith("extension-usage-change:")) {
    const flags = parseFlags(words.slice(4));
    requireJson(flags);
    rejectUnknownFlags(flags, ["json"]);
    return {
      operation: "usage.revert",
      input: {
        clientRequestId: input.clientRequestId,
        changeId: words[3] as import("@svvy/core").ExtensionUsageChangeId,
      },
    };
  }
  if (words[2] !== "snapshots") return null;
  const action = words[3];
  if (action === "list") {
    const flags = parseFlags(words.slice(4));
    requireJson(flags);
    rejectUnknownFlags(flags, ["json"]);
    return { operation: "snapshots.list", input: {} };
  }
  if (action === "save") {
    const flags = parseFlags(words.slice(4));
    requireJson(flags);
    rejectUnknownFlags(flags, ["json", "name"]);
    const name = requireSingleFlagValue(flags, "name").trim();
    if (!name)
      throw extensionsCommandError("INVALID_SNAPSHOT_NAME", "Snapshot name cannot be empty.");
    return {
      operation: "snapshots.save",
      input: {
        clientRequestId: input.clientRequestId,
        name,
      },
    };
  }
  if (action === "rename" || action === "delete" || action === "load") {
    const snapshotId = words[4];
    if (!snapshotId || snapshotId.startsWith("--")) {
      throw extensionsCommandError("invalid_argument", "Missing snapshot id.");
    }
    if (!/^extension-snapshot:[a-z0-9][a-z0-9-]*$/.test(snapshotId)) {
      throw extensionsCommandError("INVALID_SNAPSHOT_ID", "Snapshot id is invalid.");
    }
    const flags = parseFlags(words.slice(5));
    requireJson(flags);
    rejectUnknownFlags(flags, action === "rename" ? ["json", "name"] : ["json"]);
    const name = action === "rename" ? requireSingleFlagValue(flags, "name").trim() : null;
    if (action === "rename" && !name) {
      throw extensionsCommandError("INVALID_SNAPSHOT_NAME", "Snapshot name cannot be empty.");
    }
    return action === "rename"
      ? {
          operation: "snapshots.rename",
          input: {
            clientRequestId: input.clientRequestId,
            snapshotId: snapshotId as never,
            name: name!,
          },
        }
      : ({
          operation: `snapshots.${action}`,
          input: { clientRequestId: input.clientRequestId, snapshotId: snapshotId as never },
        } as SvvyxExtensionManagementRuntimeRequest);
  }
  throw extensionsCommandError("unsupported_command", `Unsupported snapshots command: ${action}`);
}

export async function runSvvyxExtensionsCommand(input: {
  agentProfileStore?: AgentProfileMutationStore;
  agentSettingsStore?: AgentSettingsStore;
  buildRoot?: string;
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  extensionsRoot?: string;
  extensionContextImpactState?: RuntimeExtensionContextImpactStateFacade;
  lifecycle: SvvyxExtensionsLifecycleAdapter;
  requestInputVariant?: RequestInputVariant;
  workspaceId?: WorkspaceId;
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
    throw extensionsCommandError(
      "WORKSPACE_AUTHORITY_UNAVAILABLE",
      "Extension inspection must be answered by the scoped Runtime/state authority.",
    );
  }
  if (commandId === "create") {
    return await runLifecycleCreateCommand(words.slice(3), input.lifecycle);
  }
  if (commandId === "duplicate") {
    return await runLifecycleDuplicateCommand(words.slice(3), input.lifecycle);
  }
  if (commandId === "configure") {
    return await runConfigureCommand(words.slice(3), input);
  }
  if (commandId === "instructions") {
    return await runInstructionsCommand(words.slice(3), input);
  }
  if (commandId === "set-usage") {
    throw extensionsCommandError(
      "PROFILE_AUTHORITY_UNAVAILABLE",
      "Extension usage changes must be applied by Runtime.",
    );
  }
  if (commandId === "delete") {
    return await runLifecycleDeleteCommand(words.slice(3), input.lifecycle);
  }
  if (commandId === "reset") {
    return await runLifecycleResetCommand(words.slice(3), input.lifecycle);
  }
  if (commandId === "revert") {
    const mutationId = words[3];
    if (mutationId?.startsWith("extension-source-mutation:")) {
      const flags = parseFlags(words.slice(4));
      requireJson(flags);
      rejectUnknownFlags(flags, ["json"]);
      const result = await input.lifecycle.revertMutation({
        mutationId: mutationId as RevertExtensionSourceMutationInput["mutationId"],
      });
      return {
        output: { ok: true, receipt: result.source, automaticBuild: result.automaticBuild },
        commandFacts: {
          extensionReverted: true,
          extensionId: result.source.extensionId,
          extensionMutationId: result.source.mutationId,
          revertedExtensionMutationId: result.source.revertedMutationId,
          automaticBuildStatus: result.automaticBuild.status,
        },
      };
    }
    throw extensionsCommandError(
      "CHANGE_NOT_FOUND",
      "Usage-change reverts must be applied by Runtime; source lifecycle reverts require an extension-source-mutation id.",
    );
  }
  throw extensionsCommandError(
    "unsupported_command",
    `Unsupported Extension Managing command: ${commandId}`,
  );
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

export function assertExtensionEnvSecretTarget(input: {
  extensionId: string;
  extensionsRoot?: string;
  envName: string;
}): void {
  const extension = requireExtension(input.extensionId, input.extensionsRoot);
  const declaration = (extension.envDeclarations ?? []).find(
    (candidate) => candidate.name === input.envName,
  );
  if (!declaration) {
    throw extensionsCommandError(
      "extension_env_not_declared",
      `${input.extensionId} does not declare extension env ${input.envName}.`,
    );
  }
  if (!declaration.secret) {
    throw extensionsCommandError(
      "extension_env_not_secret",
      `${input.extensionId} ${input.envName} is not managed as a secret.`,
    );
  }
}

export function assertExtensionEnvOverrideTarget(input: {
  extensionId: string;
  extensionsRoot?: string;
  envName: string;
}): void {
  const extension = requireExtension(input.extensionId, input.extensionsRoot);
  const declaration = (extension.envDeclarations ?? []).find(
    (candidate) => candidate.name === input.envName,
  );
  if (!declaration) {
    throw extensionsCommandError(
      "extension_env_not_declared",
      `${input.extensionId} does not declare extension env ${input.envName}.`,
    );
  }
  if (declaration.secret) {
    throw extensionsCommandError(
      "extension_env_is_secret",
      `${input.extensionId} ${input.envName} is managed as a secret.`,
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

async function runLifecycleCreateCommand(
  words: string[],
  lifecycle: SvvyxExtensionsLifecycleAdapter,
): Promise<SvvyxExtensionsCommandResult> {
  const flags = parseFlags(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["description", "id", "interface", "json", "title", "typescript-api"]);
  const id = requireSingleFlagValue(flags, "id") as ExtensionId;
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
  const receipt = await lifecycle.create(
    interfaceKind === "instructions"
      ? { id, title, description, interfaceKind, typescriptApiEnabled: false }
      : { id, title, description, interfaceKind, typescriptApiEnabled },
  );
  return {
    output: { ok: true, receipt },
    commandFacts: {
      extensionCreated: true,
      extensionId: receipt.extensionId,
      extensionMutationId: receipt.mutationId,
    },
  };
}

async function runLifecycleDuplicateCommand(
  words: string[],
  lifecycle: SvvyxExtensionsLifecycleAdapter,
): Promise<SvvyxExtensionsCommandResult> {
  const flags = parseFlags(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["from", "id", "json", "title"]);
  const receipt = await lifecycle.duplicate({
    sourceExtensionId: requireSingleFlagValue(flags, "from") as ExtensionId,
    targetExtensionId: requireSingleFlagValue(flags, "id") as ExtensionId,
    title: requireSingleFlagValue(flags, "title"),
  });
  return {
    output: { ok: true, receipt },
    commandFacts: {
      extensionDuplicated: true,
      extensionId: receipt.extensionId,
      duplicatedFrom: receipt.sourceExtensionId,
      extensionMutationId: receipt.mutationId,
    },
  };
}

async function runLifecycleDeleteCommand(
  words: string[],
  lifecycle: SvvyxExtensionsLifecycleAdapter,
): Promise<SvvyxExtensionsCommandResult> {
  const { id, flags } = parseExtensionCommandArgs(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["json"]);
  const receipt = await lifecycle.delete({ extensionId: id as ExtensionId });
  return {
    output: { ok: true, receipt },
    commandFacts: {
      extensionDeleted: true,
      extensionId: receipt.extensionId,
      extensionMutationId: receipt.mutationId,
    },
  };
}

async function runLifecycleResetCommand(
  words: string[],
  lifecycle: SvvyxExtensionsLifecycleAdapter,
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
  const result = await lifecycle.reset({
    extensionId: id as ExtensionId,
    scope: "instructions",
  });
  return {
    output: { ok: true, receipt: result.source, automaticBuild: result.automaticBuild },
    commandFacts: {
      extensionReset: result.source.changed,
      extensionId: result.source.extensionId,
      extensionMutationId: result.source.mutationId,
      automaticBuildStatus: result.automaticBuild.status,
    },
  };
}

async function runConfigureCommand(
  words: string[],
  options: {
    cwd?: string;
    extensionsRoot?: string;
    lifecycle: SvvyxExtensionsLifecycleAdapter;
    workspaceId?: WorkspaceId;
  },
): Promise<SvvyxExtensionsCommandResult> {
  const flags = parseFlags(words);
  requireJson(flags);
  rejectUnknownFlags(flags, ["extension", "json", "typescript-api"]);
  const extensionId = requireSingleFlagValue(flags, "extension");
  const typescriptApiEnabled = optionalBooleanFlag(flags, "typescript-api");
  if (typescriptApiEnabled === undefined) {
    throw extensionsCommandError("invalid_argument", "Missing --typescript-api.");
  }
  if (!options.workspaceId) {
    throw extensionsCommandError(
      "WORKSPACE_AUTHORITY_UNAVAILABLE",
      "Extension TypeScript configuration requires the scoped workspace runtime authority.",
    );
  }
  const result = await options.lifecycle.configureTypescriptApi({
    workspaceId: options.workspaceId,
    extensionId: extensionId as ExtensionId,
    enabled: typescriptApiEnabled ?? false,
  });
  return {
    output: { ok: true, receipt: result },
    commandFacts: {
      extensionConfigured: true,
      extensionId: result.extensionId,
      typescriptApiEnabled: result.enabled,
      extensionChanged: result.changed,
    },
  };
}

async function runInstructionsCommand(
  words: string[],
  options: {
    cwd?: string;
    extensionsRoot?: string;
    lifecycle: SvvyxExtensionsLifecycleAdapter;
  },
): Promise<SvvyxExtensionsCommandResult> {
  const action = words[0];
  const id = words[1];
  if (!action) {
    throw extensionsCommandError("invalid_argument", "Missing instructions command.");
  }
  if (!id || id.startsWith("--")) {
    throw extensionsCommandError("invalid_argument", "Missing extension id.");
  }
  if (id.startsWith("external_instruction:")) {
    throw extensionsCommandError(
      "EXTERNAL_INSTRUCTION_READONLY",
      "External instruction records are read-only and cannot be changed through instruction lifecycle commands.",
    );
  }
  const flags = parseFlags(words.slice(2));
  requireJson(flags);
  if (action === "add") {
    rejectUnknownFlags(flags, ["json", "name"]);
    const receipt = await options.lifecycle.addInstruction({
      extensionId: id as ExtensionId,
      name: validateLifecycleInstructionBasename(requireSingleFlagValue(flags, "name")),
    });
    return lifecycleInstructionResult(receipt);
  }
  if (action === "remove") {
    rejectUnknownFlags(flags, ["json", "name"]);
    const receipt = await options.lifecycle.removeInstruction({
      extensionId: id as ExtensionId,
      name: validateLifecycleInstructionBasename(requireSingleFlagValue(flags, "name")),
    });
    return lifecycleInstructionResult(receipt);
  }
  if (action === "configure") {
    rejectUnknownFlags(flags, ["bypassed", "file", "json"]);
    const receipt = await options.lifecycle.configureInstruction({
      extensionId: id as ExtensionId,
      name: validateLifecycleInstructionBasename(requireSingleFlagValue(flags, "file")),
      bypassed: parseInstructionBypassedFlag(flags),
    });
    return lifecycleInstructionResult(receipt);
  }
  if (action === "rename") {
    rejectUnknownFlags(flags, ["from", "json", "to"]);
    const receipt = await options.lifecycle.renameInstruction({
      extensionId: id as ExtensionId,
      from: validateLifecycleInstructionBasename(requireSingleFlagValue(flags, "from")),
      to: validateLifecycleInstructionBasename(requireSingleFlagValue(flags, "to")),
    });
    return lifecycleInstructionResult(receipt);
  }
  if (action === "reorder") {
    rejectUnknownFlags(flags, ["file", "json"]);
    const receipt = await options.lifecycle.reorderInstructions({
      extensionId: id as ExtensionId,
      order: (flags.get("file") ?? []).map(validateLifecycleInstructionBasename),
    });
    return lifecycleInstructionResult(receipt);
  }

  throw extensionsCommandError(
    "unsupported_command",
    `Unsupported instructions command: ${action}`,
  );
}

function lifecycleInstructionResult(
  receipt:
    | AddExtensionInstructionResult
    | RemoveExtensionInstructionResult
    | ConfigureExtensionInstructionResult
    | RenameExtensionInstructionResult
    | ReorderExtensionInstructionsResult,
): SvvyxExtensionsCommandResult {
  return {
    output: { ok: true, receipt },
    commandFacts: {
      instructionChanged: receipt.changed,
      instructionAction: receipt.action,
      ...(receipt.action === "instruction-renamed"
        ? { instructionFile: receipt.to }
        : "name" in receipt
          ? { instructionFile: receipt.name }
          : {}),
      extensionId: receipt.extensionId,
      extensionMutationId: receipt.mutationId,
    },
  };
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
        `Generated instruction output must stay under instructions/full/*.md or *.mdx: ${instruction.output}`,
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

function isExactNpmVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

function validateGeneratedInstructionPath(path: string, _kind: "output"): boolean {
  return (
    path.startsWith("instructions/full/") &&
    (path.endsWith(".md") || path.endsWith(".mdx")) &&
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

export function resolveExtensionRecord(
  id: string,
  extensionsRoot?: string,
): ResolvedExtensionRecord | null {
  const extension = getExtensionRecord(id);
  if (extension) {
    return readBuiltinSourceRecord(extension, extensionsRoot) ?? extension;
  }
  return readUserExtensionRecord(id, extensionsRoot);
}

export function resolveExtensionRecords(
  ids: readonly string[],
  extensionsRoot?: string,
): ResolvedExtensionRecord[] {
  return ids
    .map((id) => resolveExtensionRecord(id, extensionsRoot))
    .filter((extension): extension is ResolvedExtensionRecord => extension !== null);
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
    minimalLoadingHint: readOptionalFile(paths.instructionsMinimal),
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
    throw extensionsCommandError(
      "invalid_manifest",
      `Builtin source interface must match packaged extension: ${builtin.id}`,
      { extensionId: builtin.id, manifestPath },
    );
  }
  const instructionFiles = readManifestInstructionFiles(manifest);
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
  if (!existsSync(paths.instructionsMinimal)) {
    throw extensionsCommandError(
      "invalid_manifest",
      `Builtin source minimal instruction is missing: ${builtin.id}`,
      { extensionId: builtin.id, path: paths.instructionsMinimal },
    );
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
  const resolvedNames = new Set(instructionsFull.map((file) => file.name));
  for (const instruction of instructionFiles) {
    if (!generatedInstructionNames.has(instruction.file) && !resolvedNames.has(instruction.file)) {
      throw extensionsCommandError(
        "invalid_manifest",
        `Builtin source instruction is missing: ${instruction.file}`,
        { extensionId: builtin.id, path: join(paths.instructionsFullDir, instruction.file) },
      );
    }
  }
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
    minimalLoadingHint: readFileSync(paths.instructionsMinimal, "utf8"),
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

function validateInstructionBasename(name: string): string {
  if (
    (!name.endsWith(".md") && !name.endsWith(".mdx")) ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    name.includes("\0") ||
    name.includes(",") ||
    /[<>:"|?*]/.test(name) ||
    name.trim() !== name ||
    name === ".md" ||
    name === ".mdx"
  ) {
    throw extensionsCommandError(
      "INVALID_INSTRUCTION_FILENAME",
      `Invalid instruction Markdown basename: ${name}`,
    );
  }
  return name;
}

function validateLifecycleInstructionBasename(name: string): AddExtensionInstructionInput["name"] {
  validateInstructionBasename(name);
  if (name.endsWith(".generated.md")) {
    throw extensionsCommandError(
      "GENERATED_INSTRUCTION_READONLY",
      "Generated instruction outputs are read-only and cannot be changed through instruction lifecycle commands.",
    );
  }
  if (!name.endsWith(".mdx")) {
    throw extensionsCommandError(
      "INVALID_INSTRUCTION_FILENAME",
      `Lifecycle instruction files must use the .mdx extension: ${name}`,
    );
  }
  return name as AddExtensionInstructionInput["name"];
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

function userExtensionPaths(
  id: string,
  extensionsRoot: string | undefined,
  interfaceKind: "instructions" | "svvyx",
): EditableExtensionPaths {
  const root = resolve(extensionsRoot ?? defaultExtensionsRoot());
  const sourceRoot = join(root, "sources", "user", id);
  const instructionsFullDir = join(sourceRoot, "instructions", "full");
  const instructionsMinimalMdx = join(sourceRoot, "instructions", "minimal.mdx");
  const generatedRoot = join(root, "generated", "extensions", id);
  return {
    sourceRoot,
    manifest: join(sourceRoot, "manifest.json"),
    instructionsFullDir,
    instructionsMinimal: existsSync(instructionsMinimalMdx)
      ? instructionsMinimalMdx
      : join(sourceRoot, "instructions", "minimal.mdx"),
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
    instructionsMinimal: join(sourceRoot, "instructions", "minimal.mdx"),
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
    .filter((entry) => entry.endsWith(".md") || entry.endsWith(".mdx"))
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

function defaultExtensionsRoot(): string {
  return join(homedir(), ".config", "svvy", "extensions");
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
