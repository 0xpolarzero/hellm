import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionEnvSecretStore } from "./extension-env-secret-store";
import {
  isSvvyxCommandManifest,
  type SvvyxCommandManifest,
  type SvvyxCommandManifestEntry,
} from "./svvyx-typescript-declarations";

type CurrentBuildManifest = {
  schemaVersion: 1;
  extensionId: string;
  interface: "instructions" | "svvyx";
  module: string | null;
  commandManifest: SvvyxCommandManifest | null;
  env: RuntimeEnvDeclaration[];
  dependencies: RuntimeDependencyDeclaration[];
};

type RuntimeEnvDeclaration = {
  default?: string;
  description: string;
  name: string;
  required: boolean;
  secret: boolean;
};

type RuntimeDependencyDeclaration = {
  kind: "dependency" | "trusted_dependency";
  name: string;
  version: string;
};

export type SvvyxRuntimeEnvValues = Record<string, Record<string, string | undefined>>;

export type SvvyxRuntimeCommandResult = {
  output: unknown;
  commandFacts: Record<string, unknown>;
};

export function isSvvyxRuntimeCommand(command: string): boolean {
  const words = splitCommandLine(command);
  if (words[0] !== "svvyx") {
    return false;
  }
  const extensionId = words[1];
  if (!extensionId) {
    return true;
  }
  if (extensionId === "--help" || extensionId === "-h") {
    return true;
  }
  return !extensionId.startsWith("--") && !builtinSvvyxNamespaces.has(extensionId);
}

export async function runSvvyxRuntimeCommand(input: {
  command: string;
  envSecretStore?: ExtensionEnvSecretStore;
  envValues?: SvvyxRuntimeEnvValues;
  extensionsRoot?: string;
}): Promise<SvvyxRuntimeCommandResult> {
  const words = splitCommandLine(input.command);
  if (words[0] !== "svvyx") {
    throw runtimeCommandError("invalid_argument", "Expected svvyx command.");
  }
  if (hasShellControlSyntax(input.command)) {
    throw runtimeCommandError(
      "invalid_argument",
      "svvyx extension commands must be invoked as a standalone command.",
    );
  }
  const extensionId = words[1];
  if (!extensionId || extensionId.startsWith("--")) {
    return dispatcherHelp();
  }
  if (builtinSvvyxNamespaces.has(extensionId)) {
    throw runtimeCommandError(
      "builtin_namespace",
      `${extensionId} is handled by its builtin svvyx command family.`,
    );
  }
  return runSvvyxRuntimeInvocation({
    envSecretStore: input.envSecretStore,
    envValues: input.envValues,
    extensionArgv: words.slice(2),
    extensionId,
    extensionsRoot: input.extensionsRoot,
  });
}

export async function runSvvyxRuntimeGeneratedClientCommand(input: {
  commandId: string;
  clientInput?: unknown;
  envSecretStore?: ExtensionEnvSecretStore;
  envValues?: SvvyxRuntimeEnvValues;
  extensionId: string;
  extensionsRoot?: string;
}): Promise<SvvyxRuntimeCommandResult> {
  return runSvvyxRuntimeInvocation({
    buildExtensionArgv(currentBuild) {
      return buildGeneratedClientExtensionArgv({
        clientInput: input.clientInput,
        commandId: input.commandId,
        currentBuild,
        extensionId: input.extensionId,
      });
    },
    envSecretStore: input.envSecretStore,
    envValues: input.envValues,
    extensionId: input.extensionId,
    extensionsRoot: input.extensionsRoot,
  });
}

async function runSvvyxRuntimeInvocation(input: {
  buildExtensionArgv?: (currentBuild: CurrentBuildManifest) => string[];
  envSecretStore?: ExtensionEnvSecretStore;
  envValues?: SvvyxRuntimeEnvValues;
  extensionArgv?: string[];
  extensionId: string;
  extensionsRoot?: string;
}): Promise<SvvyxRuntimeCommandResult> {
  let extensionArgv = input.extensionArgv ?? [];
  try {
    assertActiveUserSource(input.extensionId, input.extensionsRoot);
    const currentBuild = readCurrentBuild(input.extensionId, input.extensionsRoot);
    if (currentBuild.interface !== "svvyx") {
      throw runtimeCommandError(
        "extension_not_dispatchable",
        `${input.extensionId} current build is not a svvyx extension.`,
      );
    }
    if (!currentBuild.module) {
      throw runtimeCommandError(
        "invalid_current_build",
        `${input.extensionId} current build has no module.`,
      );
    }
    extensionArgv = input.buildExtensionArgv?.(currentBuild) ?? extensionArgv;
    const currentBuildRoot = currentBuildPath(input.extensionId, input.extensionsRoot);
    const modulePath = resolveCurrentBuildModule(
      input.extensionId,
      currentBuildRoot,
      currentBuild.module,
    );
    const missingDependency = currentBuild.dependencies.find(
      (dependency) => !runtimeDependencyArtifactInstalled(input.extensionsRoot, dependency),
    );
    if (missingDependency) {
      throw runtimeCommandError(
        "dependency_install_missing",
        `${input.extensionId} dependency ${missingDependency.name} is not installed.`,
      );
    }
    const env = resolveRuntimeEnv({
      extensionId: input.extensionId,
      declarations: currentBuild.env,
      envSecretStore: input.envSecretStore,
      envValues: input.envValues,
    });
    let loaded: { default?: unknown };
    try {
      loaded = (await import(`${modulePath}?svvyx=${Date.now()}`)) as { default?: unknown };
    } catch {
      throw runtimeCommandError(
        "current_build_import_failed",
        `${input.extensionId} current build CLI could not be imported.`,
      );
    }
    const cli = loaded.default;
    if (!cli || typeof (cli as { serve?: unknown }).serve !== "function") {
      throw runtimeCommandError(
        "invalid_current_build",
        `${input.extensionId} current build did not default-export an Incur CLI.`,
      );
    }
    const incurCli = cli as {
      serve(
        argv: readonly string[],
        options: {
          env: Record<string, string | undefined>;
          exit(code: number): void;
          stdout(chunk: string): void;
        },
      ): Promise<void> | void;
    };

    let stdout = "";
    let exitCode = 0;
    try {
      await incurCli.serve(extensionArgv, {
        env,
        stdout(chunk: string) {
          stdout += chunk;
        },
        exit(code: number) {
          exitCode = code;
        },
      });
    } catch (error) {
      throw runtimeCommandError(
        "extension_command_failed",
        redactRuntimeOutput(
          error instanceof Error ? error.message : `${input.extensionId} extension command failed.`,
          currentBuild.env,
          env,
        ),
      );
    }

    return {
      output: {
        ok: exitCode === 0,
        extensionId: input.extensionId,
        argv: extensionArgv,
        stdout: redactRuntimeOutput(stdout, currentBuild.env, env),
        exitCode,
      },
      commandFacts: {
        svvyxDispatch: true,
        extensionId: input.extensionId,
        extensionArgv,
        exitCode,
        runtimeReady: true,
      },
    };
  } catch (error) {
    if (error instanceof SvvyxRuntimeCommandError) {
      throw error.withCommandFacts(
        blockedDispatchFacts({
          errorCode: error.code,
          extensionArgv,
          extensionId: input.extensionId,
        }),
      );
    }
    throw error;
  }
}

function assertActiveUserSource(extensionId: string, extensionsRoot: string | undefined): void {
  const manifestPath = join(
    runtimeExtensionsRoot(extensionsRoot),
    "sources",
    "user",
    extensionId,
    "manifest.json",
  );
  if (!existsSync(manifestPath)) {
    throw runtimeCommandError("extension_not_found", `Extension not found: ${extensionId}`);
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    if (manifest.schemaVersion !== 1 || manifest.id !== extensionId) {
      throw new Error("Invalid active extension manifest.");
    }
  } catch {
    throw runtimeCommandError("extension_not_found", `Extension not found: ${extensionId}`);
  }
}

function resolveCurrentBuildModule(
  extensionId: string,
  currentBuildRoot: string,
  modulePath: string,
): string {
  if (isAbsolute(modulePath) || modulePath.includes("\0")) {
    throw runtimeCommandError(
      "invalid_current_build",
      `${extensionId} current build module path is invalid.`,
    );
  }
  const resolved = resolve(currentBuildRoot, modulePath);
  const relativePath = relative(currentBuildRoot, resolved);
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath) ||
    !resolved.endsWith(".js")
  ) {
    throw runtimeCommandError(
      "invalid_current_build",
      `${extensionId} current build module path is invalid.`,
    );
  }
  return resolved;
}

function dispatcherHelp(): SvvyxRuntimeCommandResult {
  return {
    output: {
      ok: true,
      usage: "svvyx <extension-id> <extension-command> ...",
      note: "Use list_extensions or svvyx extensions inspect for extension discovery.",
    },
    commandFacts: {
      svvyxDispatch: true,
      dispatcherHelp: true,
    },
  };
}

function buildGeneratedClientExtensionArgv(input: {
  clientInput?: unknown;
  commandId: string;
  currentBuild: CurrentBuildManifest;
  extensionId: string;
}): string[] {
  if (typeof input.commandId !== "string" || input.commandId.trim().length === 0) {
    throw runtimeCommandError("invalid_argument", "commandId must be a non-empty string.");
  }
  if (!input.currentBuild.commandManifest) {
    throw runtimeCommandError(
      "invalid_current_build",
      `${input.extensionId} current build command manifest is invalid.`,
    );
  }
  const clientInput = readGeneratedClientInput(input.clientInput);
  const commandName = input.commandId.trim();
  const command = input.currentBuild.commandManifest.commands.find(
    (entry) => entry.name === commandName,
  );
  if (!command) {
    throw runtimeCommandError(
      "invalid_argument",
      `${input.extensionId}.${commandName} is not in the current command manifest.`,
    );
  }
  if (command.streaming && hasGeneratedClientTokenPaging(clientInput)) {
    throw runtimeCommandError(
      "invalid_argument",
      "Streaming generated client commands support selection and outputFormat, not token pagination controls.",
    );
  }
  const argv = [
    ...commandName.split(/\s+/).filter(Boolean),
    ...generatedClientArgsArgv(command, clientInput.args),
    ...generatedClientOptionsArgv(command, clientInput.options),
    ...generatedClientOutputControlsArgv(clientInput),
    "--verbose",
    "--format",
    "json",
  ];
  return argv;
}

type GeneratedClientInvocationInput = {
  args?: Record<string, unknown>;
  options?: Record<string, unknown>;
  selection?: string[];
  outputFormat?: string;
  outputTokenCount?: boolean;
  outputTokenLimit?: number;
  outputTokenOffset?: number;
};

function readGeneratedClientInput(value: unknown): GeneratedClientInvocationInput {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw runtimeCommandError("invalid_argument", "input must be an object when provided.");
  }
  rejectUnknownGeneratedClientInputKeys(value);
  return {
    ...(value.args !== undefined ? { args: readGeneratedClientRecord(value.args, "args") } : {}),
    ...(value.options !== undefined
      ? { options: readGeneratedClientRecord(value.options, "options") }
      : {}),
    ...(value.selection !== undefined
      ? { selection: readGeneratedClientSelection(value.selection) }
      : {}),
    ...(value.outputFormat !== undefined
      ? { outputFormat: readGeneratedClientOutputFormat(value.outputFormat) }
      : {}),
    ...(value.outputTokenCount !== undefined
      ? { outputTokenCount: readGeneratedClientBoolean(value.outputTokenCount, "outputTokenCount") }
      : {}),
    ...(value.outputTokenLimit !== undefined
      ? {
          outputTokenLimit: readGeneratedClientNonnegativeInteger(
            value.outputTokenLimit,
            "outputTokenLimit",
          ),
        }
      : {}),
    ...(value.outputTokenOffset !== undefined
      ? {
          outputTokenOffset: readGeneratedClientNonnegativeInteger(
            value.outputTokenOffset,
            "outputTokenOffset",
          ),
        }
      : {}),
  };
}

function rejectUnknownGeneratedClientInputKeys(input: Record<string, unknown>): void {
  const allowed = new Set([
    "args",
    "options",
    "selection",
    "outputFormat",
    "outputTokenCount",
    "outputTokenLimit",
    "outputTokenOffset",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw runtimeCommandError(
        "invalid_argument",
        `Unsupported generated client input key: ${key}`,
      );
    }
  }
}

function readGeneratedClientRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw runtimeCommandError("invalid_argument", `${name} must be an object when provided.`);
  }
  return value;
}

function readGeneratedClientSelection(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry)) {
    throw runtimeCommandError(
      "invalid_argument",
      "selection must be an array of non-empty strings.",
    );
  }
  return [...value];
}

function readGeneratedClientOutputFormat(value: unknown): string {
  if (
    value !== "toon" &&
    value !== "json" &&
    value !== "yaml" &&
    value !== "md" &&
    value !== "jsonl"
  ) {
    throw runtimeCommandError(
      "invalid_argument",
      "outputFormat must be one of toon, json, yaml, md, or jsonl.",
    );
  }
  return value;
}

function readGeneratedClientBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw runtimeCommandError("invalid_argument", `${name} must be a boolean.`);
  }
  return value;
}

function readGeneratedClientNonnegativeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw runtimeCommandError("invalid_argument", `${name} must be a non-negative integer.`);
  }
  return value;
}

function generatedClientArgsArgv(
  command: SvvyxCommandManifestEntry,
  args: Record<string, unknown> | undefined,
): string[] {
  if (!args) {
    return [];
  }
  const argNames = schemaPropertyNames(command.schema?.args);
  rejectUnknownGeneratedClientRecordKeys(args, argNames, "args");
  const argv: string[] = [];
  for (const name of argNames) {
    if (!Object.prototype.hasOwnProperty.call(args, name) || args[name] === undefined) {
      continue;
    }
    argv.push(generatedClientScalar(args[name], `args.${name}`));
  }
  return argv;
}

function generatedClientOptionsArgv(
  command: SvvyxCommandManifestEntry,
  options: Record<string, unknown> | undefined,
): string[] {
  if (!options) {
    return [];
  }
  const optionNames = schemaPropertyNames(command.schema?.options);
  rejectUnknownGeneratedClientRecordKeys(options, optionNames, "options");
  const argv: string[] = [];
  for (const name of optionNames) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
      throw runtimeCommandError("invalid_argument", `Unsupported option name: ${name}`);
    }
    const value = options[name];
    if (value === undefined || value === false) {
      continue;
    }
    const option = `--${name}`;
    if (value === true) {
      argv.push(option);
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      argv.push(option, generatedClientScalar(entry, `options.${name}`));
    }
  }
  return argv;
}

function generatedClientOutputControlsArgv(input: GeneratedClientInvocationInput): string[] {
  const argv: string[] = [];
  if (input.selection && input.selection.length > 0) {
    argv.push("--filter-output", input.selection.join(","));
  }
  if (input.outputTokenCount === true) {
    argv.push("--token-count");
  }
  if (input.outputTokenLimit !== undefined) {
    argv.push("--token-limit", String(input.outputTokenLimit));
  }
  if (input.outputTokenOffset !== undefined) {
    argv.push("--token-offset", String(input.outputTokenOffset));
  }
  return argv;
}

function hasGeneratedClientTokenPaging(input: GeneratedClientInvocationInput): boolean {
  return (
    input.outputTokenCount === true ||
    input.outputTokenLimit !== undefined ||
    input.outputTokenOffset !== undefined
  );
}

function schemaPropertyNames(schema: unknown): string[] {
  return isRecord(schema) && isRecord(schema.properties) ? Object.keys(schema.properties) : [];
}

function rejectUnknownGeneratedClientRecordKeys(
  input: Record<string, unknown>,
  allowedNames: readonly string[],
  name: string,
): void {
  const allowed = new Set(allowedNames);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw runtimeCommandError("invalid_argument", `Unsupported ${name} key: ${key}`);
    }
  }
}

function generatedClientScalar(value: unknown, name: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  throw runtimeCommandError("invalid_argument", `${name} must be a string, number, or boolean.`);
}

function readCurrentBuild(
  extensionId: string,
  extensionsRoot: string | undefined,
): CurrentBuildManifest {
  const manifestPath = join(currentBuildPath(extensionId, extensionsRoot), "manifest.json");
  if (!existsSync(manifestPath)) {
    throw runtimeCommandError(
      "no_current_build",
      `${extensionId} has no current successful svvyx build.`,
    );
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw runtimeCommandError(
      "invalid_current_build",
      error instanceof Error ? error.message : `${extensionId} current build manifest is invalid.`,
    );
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw runtimeCommandError("invalid_current_build", `${extensionId} current build is invalid.`);
  }
  const record = manifest as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    record.extensionId !== extensionId ||
    (record.interface !== "instructions" && record.interface !== "svvyx") ||
    (record.module !== null && typeof record.module !== "string") ||
    (record.interface === "svvyx" &&
      !isRuntimeCommandManifest(extensionId, record.commandManifest)) ||
    !Array.isArray(record.env) ||
    !Array.isArray(record.dependencies)
  ) {
    throw runtimeCommandError("invalid_current_build", `${extensionId} current build is invalid.`);
  }
  return {
    schemaVersion: 1,
    extensionId,
    interface: record.interface,
    module: record.module,
    commandManifest:
      record.interface === "svvyx"
        ? readRuntimeCommandManifest(extensionId, record.commandManifest)
        : null,
    env: record.env.map((entry) => readRuntimeEnvDeclaration(extensionId, entry)),
    dependencies: record.dependencies.map((entry) =>
      readRuntimeDependencyDeclaration(extensionId, entry),
    ),
  };
}

function isRuntimeCommandManifest(extensionId: string, value: unknown): boolean {
  try {
    readRuntimeCommandManifest(extensionId, value);
    return true;
  } catch {
    return false;
  }
}

function readRuntimeCommandManifest(extensionId: string, value: unknown): SvvyxCommandManifest {
  if (!isSvvyxCommandManifest(value)) {
    throw runtimeCommandError(
      "invalid_current_build",
      `${extensionId} current build command manifest is invalid.`,
    );
  }
  return value;
}

function readRuntimeEnvDeclaration(extensionId: string, value: unknown): RuntimeEnvDeclaration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw runtimeCommandError(
      "invalid_current_build",
      `${extensionId} current build env is invalid.`,
    );
  }
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.name !== "string" ||
    typeof entry.required !== "boolean" ||
    typeof entry.secret !== "boolean" ||
    typeof entry.description !== "string" ||
    ("default" in entry && typeof entry.default !== "string")
  ) {
    throw runtimeCommandError(
      "invalid_current_build",
      `${extensionId} current build env is invalid.`,
    );
  }
  return {
    name: entry.name,
    required: entry.required,
    secret: entry.secret,
    description: entry.description,
    ...(typeof entry.default === "string" ? { default: entry.default } : {}),
  };
}

function readRuntimeDependencyDeclaration(
  extensionId: string,
  value: unknown,
): RuntimeDependencyDeclaration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw runtimeCommandError(
      "invalid_current_build",
      `${extensionId} current build dependency metadata is invalid.`,
    );
  }
  const entry = value as Record<string, unknown>;
  if (
    (entry.kind !== "dependency" && entry.kind !== "trusted_dependency") ||
    typeof entry.name !== "string" ||
    typeof entry.version !== "string"
  ) {
    throw runtimeCommandError(
      "invalid_current_build",
      `${extensionId} current build dependency metadata is invalid.`,
    );
  }
  return {
    kind: entry.kind,
    name: entry.name,
    version: entry.version,
  };
}

function resolveRuntimeEnv(input: {
  declarations: readonly RuntimeEnvDeclaration[];
  envSecretStore?: ExtensionEnvSecretStore;
  envValues?: SvvyxRuntimeEnvValues;
  extensionId: string;
}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  const configured = input.envValues?.[input.extensionId] ?? {};
  for (const declaration of input.declarations) {
    const configuredValue = configured[declaration.name];
    if (!declaration.secret && configuredValue !== undefined) {
      env[declaration.name] = configuredValue;
      continue;
    }
    if (declaration.secret) {
      const secretValue = input.envSecretStore?.get({
        extensionId: input.extensionId,
        name: declaration.name,
      });
      if (secretValue !== undefined) {
        env[declaration.name] = secretValue;
        continue;
      }
    }
    if (declaration.default !== undefined) {
      env[declaration.name] = declaration.default;
      continue;
    }
    if (declaration.required) {
      throw runtimeCommandError(
        "extension_env_missing",
        `${input.extensionId} requires ${declaration.name}. Configure it in the Extensions pane.`,
      );
    }
  }
  return env;
}

function redactRuntimeOutput(
  output: string,
  declarations: readonly RuntimeEnvDeclaration[],
  env: Record<string, string | undefined>,
): string {
  let redacted = output;
  for (const declaration of declarations) {
    if (!declaration.secret) {
      continue;
    }
    const value = env[declaration.name];
    if (!value) {
      continue;
    }
    redacted = redacted.split(value).join("[REDACTED]");
  }
  return redacted;
}

function currentBuildPath(extensionId: string, extensionsRoot: string | undefined): string {
  return join(
    runtimeExtensionsRoot(extensionsRoot),
    "builds",
    "extensions",
    extensionId,
    "current",
  );
}

function runtimeDependencyArtifactInstalled(
  extensionsRoot: string | undefined,
  dependency: RuntimeDependencyDeclaration,
): boolean {
  const packageJsonPath = join(
    runtimeExtensionsRoot(extensionsRoot),
    "package",
    "node_modules",
    ...dependency.name.split("/"),
    "package.json",
  );
  if (!existsSync(packageJsonPath)) {
    return false;
  }
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<
      string,
      unknown
    >;
    return packageJson.name === dependency.name && packageJson.version === dependency.version;
  } catch {
    return false;
  }
}

function runtimeExtensionsRoot(extensionsRoot: string | undefined): string {
  return resolve(extensionsRoot ?? join(homedir(), ".config", "svvy", "extensions"));
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
  if (current) {
    words.push(current);
  }
  return words;
}

export function formatSvvyxRuntimeError(error: unknown): {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  commandFacts?: Record<string, unknown>;
} {
  if (error instanceof SvvyxRuntimeCommandError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
      ...(error.commandFacts ? { commandFacts: error.commandFacts } : {}),
    };
  }
  return {
    ok: false,
    error: {
      code: "extension_runtime_error",
      message: error instanceof Error ? error.message : "svvyx extension command failed.",
    },
  };
}

class SvvyxRuntimeCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly commandFacts?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SvvyxRuntimeCommandError";
  }

  withCommandFacts(commandFacts: Record<string, unknown>): SvvyxRuntimeCommandError {
    return new SvvyxRuntimeCommandError(this.code, this.message, this.commandFacts ?? commandFacts);
  }
}

function runtimeCommandError(code: string, message: string): SvvyxRuntimeCommandError {
  return new SvvyxRuntimeCommandError(code, message);
}

function blockedDispatchFacts(input: {
  errorCode: string;
  extensionArgv: readonly string[];
  extensionId: string;
}): Record<string, unknown> {
  return {
    svvyxDispatch: true,
    extensionId: input.extensionId,
    extensionArgv: [...input.extensionArgv],
    runtimeReady: runtimeReadyForError(input.errorCode),
    errorCode: input.errorCode,
    currentBuildStatus: currentBuildStatusForError(input.errorCode),
  };
}

function runtimeReadyForError(errorCode: string): boolean {
  return errorCode === "extension_command_failed";
}

function currentBuildStatusForError(errorCode: string): string {
  if (errorCode === "extension_not_found") {
    return "unknown_extension";
  }
  if (errorCode === "no_current_build") {
    return "missing";
  }
  if (errorCode === "dependency_approval_required" || errorCode === "dependency_install_missing") {
    return "blocked";
  }
  if (errorCode === "extension_env_missing") {
    return "valid";
  }
  if (errorCode === "extension_not_dispatchable" || errorCode === "invalid_current_build") {
    return "invalid";
  }
  if (errorCode === "current_build_import_failed") {
    return "invalid";
  }
  if (errorCode === "extension_command_failed") {
    return "valid";
  }
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
    if (quote) {
      continue;
    }
    if (["|", ";", "&", ">", "<"].includes(char)) {
      return true;
    }
  }
  return false;
}

const builtinSvvyxNamespaces = new Set(["artifacts", "extensions", "workflows"]);
