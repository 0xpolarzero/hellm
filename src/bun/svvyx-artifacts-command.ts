import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { AppLoggerEvent } from "./app-logger";
import type {
  AbsolutePath,
  ArtifactId,
  CommandId,
  PromptExecutionSurfaceKind,
  RuntimeArtifactKind,
  RuntimeArtifactRecord,
  RuntimeArtifactStatePortService,
  StateContractError,
  ThreadId,
  WorkspaceSessionId,
} from "@svvy/core";
import type * as Effect from "effect/Effect";

export type SvvyxArtifactsCommandResult = {
  output: unknown;
  commandFacts: Record<string, unknown>;
};

export type SvvyxArtifactsCommandId = "create" | "inspect" | "list" | "open" | "delete";

export type SvvyxArtifactsOperationInput =
  | {
      commandId: "create";
      options: {
        name?: string;
        path?: string;
        immutable?: boolean;
        mimeType?: string;
      };
    }
  | { commandId: "inspect"; options: { id: string } }
  | { commandId: "list"; options?: { threadId?: string; limit?: number } }
  | { commandId: "open"; options: { id: string } }
  | { commandId: "delete"; options: { id: string } };

export type SvvyxArtifactsRuntimeContext = {
  sessionId: string;
  surfacePiSessionId?: string | null;
  surfaceKind: PromptExecutionSurfaceKind;
  surfaceThreadId: string | null;
};

export type SvvyxArtifactOpenHandler = (input: {
  sessionId: string;
  artifactId: string;
}) => boolean | Promise<boolean>;

type SourceCommandReference = {
  id: CommandId;
};

export type SvvyxArtifactStateRunner = <A>(effect: Effect.Effect<A, StateContractError>) => A;

function workspaceSessionId(id: string): WorkspaceSessionId {
  return id as WorkspaceSessionId;
}

function optionalThreadId(id: string | null | undefined): ThreadId | null {
  return id ? (id as ThreadId) : null;
}

function artifactIdentifier(id: string): ArtifactId {
  return id as ArtifactId;
}

export async function runSvvyxArtifactsCommand(input: {
  cwd: string;
  command: string;
  runtime: SvvyxArtifactsRuntimeContext;
  artifactState: RuntimeArtifactStatePortService;
  runState: SvvyxArtifactStateRunner;
  sourceCommand: SourceCommandReference;
  openArtifact?: SvvyxArtifactOpenHandler;
  onAppLog?: (event: AppLoggerEvent) => void;
}): Promise<SvvyxArtifactsCommandResult> {
  let operationStarted = false;
  const runOperation = (operation: SvvyxArtifactsOperationInput) => {
    operationStarted = true;
    return runSvvyxArtifactsOperation({ ...input, operation });
  };

  try {
    return runOperation(parseSvvyxArtifactsCommand(input.command));
  } catch (error) {
    if (!operationStarted) {
      emitArtifactCommandFailureLog(input, error);
    }
    throw error;
  }
}

export function parseSvvyxArtifactsCommand(command: string): SvvyxArtifactsOperationInput {
  const words = splitCommandLine(command);
  if (words[0] !== "svvyx" || words[1] !== "artifacts") {
    throw artifactCommandError("INVALID_ARGUMENT", "Expected svvyx artifacts command.");
  }
  if (hasShellControlSyntax(command)) {
    throw artifactCommandError(
      "INVALID_ARGUMENT",
      "svvyx artifacts commands must be invoked as a standalone command.",
    );
  }

  const artifactCommand = words[2];
  if (!artifactCommand) {
    throw artifactCommandError("INVALID_ARGUMENT", "Missing Artifacts command.");
  }

  const flags = parseFlags(words.slice(3));
  requireJson(flags);

  if (artifactCommand === "create") {
    rejectUnsupportedCreateFlags(flags);
    const name = singleFlag(flags, "name");
    const sourcePath = singleFlag(flags, "path");
    const mimeType = singleFlag(flags, "mime-type");
    return {
      commandId: "create",
      options: {
        ...(name ? { name } : {}),
        ...(sourcePath ? { path: sourcePath } : {}),
        ...(hasFlag(flags, "immutable") ? { immutable: true } : {}),
        ...(mimeType ? { mimeType } : {}),
      },
    };
  }

  if (artifactCommand === "inspect") {
    rejectUnknownFlags(flags, ["id", "json"]);
    return {
      commandId: "inspect",
      options: { id: requiredSingleFlag(flags, "id") },
    };
  }

  if (artifactCommand === "list") {
    rejectUnknownFlags(flags, ["thread-id", "limit", "json"]);
    const threadId = singleFlag(flags, "thread-id");
    const rawLimit = singleFlag(flags, "limit");
    return {
      commandId: "list",
      options: {
        ...(threadId ? { threadId } : {}),
        ...(rawLimit ? { limit: parseLimit(rawLimit) } : {}),
      },
    };
  }

  if (artifactCommand === "open") {
    rejectUnknownFlags(flags, ["id", "json"]);
    return {
      commandId: "open",
      options: { id: requiredSingleFlag(flags, "id") },
    };
  }

  if (artifactCommand === "delete") {
    rejectUnknownFlags(flags, ["id", "json"]);
    return {
      commandId: "delete",
      options: { id: requiredSingleFlag(flags, "id") },
    };
  }

  throw artifactCommandError(
    "INVALID_ARGUMENT",
    `Unsupported Artifacts command: ${artifactCommand}`,
  );
}

export async function runSvvyxArtifactsOperation(input: {
  cwd: string;
  operation: SvvyxArtifactsOperationInput;
  runtime: SvvyxArtifactsRuntimeContext;
  artifactState: RuntimeArtifactStatePortService;
  runState: SvvyxArtifactStateRunner;
  sourceCommand: SourceCommandReference;
  openArtifact?: SvvyxArtifactOpenHandler;
  onAppLog?: (event: AppLoggerEvent) => void;
}): Promise<SvvyxArtifactsCommandResult> {
  try {
    const result = await runSvvyxArtifactsOperationCore(input);
    input.onAppLog?.({
      level: "info",
      source: "artifact",
      message: formatArtifactLogMessage(input.operation.commandId, "succeeded"),
      details: artifactLogDetails(input, result.commandFacts),
    });
    return result;
  } catch (error) {
    const formatted = formatSvvyxArtifactsError(error).error;
    input.onAppLog?.({
      level: "warning",
      source: "artifact",
      message: formatArtifactLogMessage(input.operation.commandId, "failed"),
      details: {
        ...artifactLogDetails(input, {
          errorCode: formatted.code,
          ...(formatted.id ? { artifactId: formatted.id } : {}),
          ...(formatted.path ? { artifactPath: formatted.path } : {}),
          ...(formatted.name ? { artifactName: formatted.name } : {}),
        }),
        errorMessage: formatted.message,
      },
    });
    throw error;
  }
}

async function runSvvyxArtifactsOperationCore(input: {
  cwd: string;
  operation: SvvyxArtifactsOperationInput;
  runtime: SvvyxArtifactsRuntimeContext;
  artifactState: RuntimeArtifactStatePortService;
  runState: SvvyxArtifactStateRunner;
  sourceCommand: SourceCommandReference;
  openArtifact?: SvvyxArtifactOpenHandler;
}): Promise<SvvyxArtifactsCommandResult> {
  if (input.operation.commandId === "create") {
    const { name, path: sourcePath, immutable = false, mimeType } = input.operation.options;
    if (!name && !sourcePath) {
      throw artifactCommandError(
        "INVALID_ARGUMENT",
        "create requires --name or --path.",
        undefined,
        name,
      );
    }
    const artifact = input.runState(
      input.artifactState.createArtifact({
        sessionId: workspaceSessionId(input.runtime.sessionId),
        threadId:
          input.runtime.surfaceKind === "handler"
            ? optionalThreadId(input.runtime.surfaceThreadId)
            : null,
        sourceCommandId: input.sourceCommand.id,
        kind: inferArtifactKind(name ?? sourcePath ?? ""),
        ...(name ? { name } : {}),
        ...(sourcePath ? { path: resolveCommandPath(input.cwd, sourcePath) } : {}),
        ...(mimeType ? { mimeType } : {}),
        immutable,
      }),
    ).value;
    const output = artifactRef(refreshArtifactRef(artifact));
    return {
      output,
      commandFacts: {
        artifactId: output.id,
        artifactPath: output.path,
        artifactName: output.name,
        immutable: output.immutable,
        mimeType: output.mimeType,
        bytes: output.bytes,
        sha256: output.sha256,
        sessionId: input.runtime.sessionId,
        threadId: artifact.threadId,
      },
    };
  }

  if (input.operation.commandId === "inspect") {
    const artifact = input.runState(
      input.artifactState.inspectArtifact({
        sessionId: workspaceSessionId(input.runtime.sessionId),
        artifactId: artifactIdentifier(input.operation.options.id),
      }),
    );
    ensureNotDeleted(artifact);
    const output = artifactRef(refreshArtifactRef(artifact));
    return {
      output,
      commandFacts: {
        artifactId: output.id,
        artifactPath: output.path,
        artifactName: output.name,
        immutable: output.immutable,
        mimeType: output.mimeType,
        bytes: output.bytes,
        sha256: output.sha256,
      },
    };
  }

  if (input.operation.commandId === "list") {
    const { threadId, limit } = input.operation.options ?? {};
    const artifacts = input
      .runState(
        input.artifactState.listArtifacts({
          sessionId: workspaceSessionId(input.runtime.sessionId),
          threadId:
            optionalThreadId(threadId) ??
            (input.runtime.surfaceKind === "handler"
              ? optionalThreadId(input.runtime.surfaceThreadId)
              : null),
          limit: parseOperationLimit(limit),
        }),
      )
      .flatMap((artifact) => {
        try {
          ensureNotDeleted(artifact);
          return [artifactRef(refreshArtifactRef(artifact))];
        } catch (error) {
          if (isArtifactErrorCode(error, "ARTIFACT_FILE_MISSING")) {
            return [];
          }
          throw error;
        }
      });
    const output = { artifacts };
    return {
      output,
      commandFacts: {
        artifactIds: artifacts.map((artifact) => artifact.id),
        artifactCount: artifacts.length,
      },
    };
  }

  if (input.operation.commandId === "open") {
    const artifact = input.runState(
      input.artifactState.inspectArtifact({
        sessionId: workspaceSessionId(input.runtime.sessionId),
        artifactId: artifactIdentifier(input.operation.options.id),
      }),
    );
    ensureNotDeleted(artifact);
    const opened =
      input.openArtifact !== undefined
        ? await input.openArtifact({
            sessionId: input.runtime.sessionId,
            artifactId: artifact.id,
          })
        : false;
    if (!opened) {
      throw artifactCommandError(
        "UI_UNAVAILABLE",
        "Artifact inspector UI is not attached to this command runtime.",
        undefined,
        undefined,
        input.operation.options.id,
      );
    }
    const output = { id: artifact.id, opened: true };
    return {
      output,
      commandFacts: {
        artifactId: artifact.id,
        opened: true,
      },
    };
  }

  const artifact = input.runState(
    input.artifactState.deleteArtifact({
      sessionId: workspaceSessionId(input.runtime.sessionId),
      artifactId: artifactIdentifier(input.operation.options.id),
    }),
  ).value;
  const output = { id: artifact.id, deleted: true };
  return {
    output,
    commandFacts: {
      artifactId: artifact.id,
      deleted: true,
    },
  };
}

function artifactLogDetails(
  input: {
    operation: SvvyxArtifactsOperationInput;
    runtime: SvvyxArtifactsRuntimeContext;
    sourceCommand: SourceCommandReference;
  },
  facts: Record<string, unknown>,
): Record<string, unknown> & {
  workspaceSessionId: string;
  surfacePiSessionId?: string;
  threadId?: string;
  commandId: string;
  artifactId?: string;
} {
  const operationOptions = input.operation.options;
  const artifactId =
    typeof facts.artifactId === "string"
      ? facts.artifactId
      : operationOptions && "id" in operationOptions && typeof operationOptions.id === "string"
        ? operationOptions.id
        : undefined;
  return {
    workspaceSessionId: input.runtime.sessionId,
    ...(input.runtime.surfacePiSessionId
      ? { surfacePiSessionId: input.runtime.surfacePiSessionId }
      : {}),
    ...(input.runtime.surfaceThreadId ? { threadId: input.runtime.surfaceThreadId } : {}),
    commandId: input.sourceCommand.id,
    ...(artifactId ? { artifactId } : {}),
    artifactCommandId: input.operation.commandId,
    ...facts,
  };
}

function formatArtifactLogMessage(
  commandId: SvvyxArtifactsCommandId,
  status: "succeeded" | "failed",
): string {
  const label = commandId.charAt(0).toUpperCase() + commandId.slice(1);
  return `Artifact ${label} ${status}.`;
}

function emitArtifactCommandFailureLog(
  input: {
    command: string;
    runtime: SvvyxArtifactsRuntimeContext;
    sourceCommand: SourceCommandReference;
    onAppLog?: (event: AppLoggerEvent) => void;
  },
  error: unknown,
): void {
  const formatted = formatSvvyxArtifactsError(error).error;
  input.onAppLog?.({
    level: "warning",
    source: "artifact",
    message: "Artifact command failed.",
    details: {
      workspaceSessionId: input.runtime.sessionId,
      ...(input.runtime.surfacePiSessionId
        ? { surfacePiSessionId: input.runtime.surfacePiSessionId }
        : {}),
      ...(input.runtime.surfaceThreadId ? { threadId: input.runtime.surfaceThreadId } : {}),
      commandId: input.sourceCommand.id,
      command: input.command,
      errorCode: formatted.code,
      errorMessage: formatted.message,
      ...(formatted.id ? { artifactId: formatted.id } : {}),
      ...(formatted.path ? { artifactPath: formatted.path } : {}),
      ...(formatted.name ? { artifactName: formatted.name } : {}),
    },
  });
}

export function formatSvvyxArtifactsError(error: unknown): {
  error: {
    code: string;
    message: string;
    path?: string;
    name?: string;
    id?: string;
  };
} {
  if (error instanceof ArtifactCommandError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.path ? { path: error.path } : {}),
        ...(error.artifactName ? { name: error.artifactName } : {}),
        ...(error.id ? { id: error.id } : {}),
      },
    };
  }

  const message = error instanceof Error ? error.message : "Artifacts command failed.";
  const mapped = mapStoreError(message);
  return {
    error: {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.path ? { path: mapped.path } : {}),
      ...(mapped.name ? { name: mapped.name } : {}),
      ...(mapped.id ? { id: mapped.id } : {}),
    },
  };
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
    throw artifactCommandError("INVALID_ARGUMENT", "Unterminated quoted argument.");
  }
  if (current) {
    words.push(current);
  }
  return words;
}

function hasShellControlSyntax(command: string): boolean {
  return /(^|[^\\])(?:[|;&<>`]|&&|\|\||\$\()/.test(command);
}

function parseFlags(words: string[]): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? "";
    if (!word.startsWith("--")) {
      throw artifactCommandError("INVALID_ARGUMENT", `Unexpected positional argument: ${word}`);
    }
    const raw = word.slice(2);
    const [name, inlineValue] = raw.split(/=(.*)/s).filter((part) => part !== undefined);
    if (!name) {
      throw artifactCommandError("INVALID_ARGUMENT", "Empty option name.");
    }
    if (name === "json" || name === "immutable") {
      if (inlineValue) {
        throw artifactCommandError("INVALID_ARGUMENT", `--${name} does not take a value.`);
      }
      pushFlag(flags, name, "true");
      continue;
    }
    const nextWord = words[index + 1];
    const value =
      inlineValue !== undefined
        ? inlineValue
        : nextWord && !nextWord.startsWith("--")
          ? nextWord
          : undefined;
    if (value === undefined) {
      throw artifactCommandError("INVALID_ARGUMENT", `--${name} requires a value.`);
    }
    if (value === nextWord) {
      index += 1;
    }
    pushFlag(flags, name, value);
  }
  return flags;
}

function pushFlag(flags: Map<string, string[]>, name: string, value: string): void {
  const values = flags.get(name) ?? [];
  values.push(value);
  flags.set(name, values);
}

function requireJson(flags: Map<string, string[]>): void {
  if (!hasFlag(flags, "json")) {
    throw artifactCommandError("INVALID_ARGUMENT", "Artifacts commands require --json.");
  }
}

function hasFlag(flags: Map<string, string[]>, name: string): boolean {
  return (flags.get(name)?.length ?? 0) > 0;
}

function singleFlag(flags: Map<string, string[]>, name: string): string | undefined {
  const values = flags.get(name) ?? [];
  if (values.length > 1) {
    throw artifactCommandError("INVALID_ARGUMENT", `--${name} may be provided only once.`);
  }
  return values[0];
}

function requiredSingleFlag(flags: Map<string, string[]>, name: string): string {
  const value = singleFlag(flags, name);
  if (!value) {
    throw artifactCommandError("INVALID_ARGUMENT", `--${name} is required.`);
  }
  return value;
}

function rejectUnsupportedCreateFlags(flags: Map<string, string[]>): void {
  if (hasFlag(flags, "kind")) {
    throw artifactCommandError("INVALID_ARGUMENT", "Artifacts create does not support --kind.");
  }
  if (hasFlag(flags, "content")) {
    throw artifactCommandError(
      "INVALID_ARGUMENT",
      "Artifacts create does not support inline content.",
    );
  }
  rejectUnknownFlags(flags, ["name", "path", "immutable", "mime-type", "json"]);
}

function rejectUnknownFlags(flags: Map<string, string[]>, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  for (const name of flags.keys()) {
    if (!allowedSet.has(name)) {
      throw artifactCommandError("INVALID_ARGUMENT", `Unsupported option: --${name}`);
    }
  }
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) {
    return 20;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw artifactCommandError("INVALID_ARGUMENT", "--limit must be an integer from 1 to 100.");
  }
  return limit;
}

function parseOperationLimit(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw artifactCommandError("INVALID_ARGUMENT", "limit must be an integer from 1 to 100.");
  }
  return value;
}

function inferArtifactKind(nameOrPath: string): RuntimeArtifactKind {
  const lower = nameOrPath.toLowerCase();
  if (lower.endsWith(".json")) {
    return "json";
  }
  if (lower.endsWith(".log")) {
    return "log";
  }
  if (
    lower.endsWith(".md") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".html") ||
    lower.endsWith(".css") ||
    lower.endsWith(".js") ||
    lower.endsWith(".ts")
  ) {
    return "text";
  }
  return "file";
}

function resolveCommandPath(cwd: string, path: string): AbsolutePath {
  return (isAbsolute(path) ? path : resolve(cwd, path)) as AbsolutePath;
}

function ensureNotDeleted(artifact: RuntimeArtifactRecord): void {
  if (artifact.deletedAt) {
    throw artifactCommandError(
      "ARTIFACT_DELETED",
      `Artifact is deleted: ${artifact.id}`,
      undefined,
      undefined,
      artifact.id,
    );
  }
}

function refreshArtifactRef(artifact: RuntimeArtifactRecord): RuntimeArtifactRecord {
  const path = artifact.path;
  if (!path || !existsSync(path)) {
    throw artifactCommandError(
      "ARTIFACT_FILE_MISSING",
      `Artifact file is missing: ${artifact.id}`,
      path,
      undefined,
      artifact.id,
    );
  }
  const stats = statSync(path);
  if (!stats.isFile()) {
    throw artifactCommandError(
      "ARTIFACT_FILE_MISSING",
      `Artifact path is not a file: ${artifact.id}`,
      path,
      undefined,
      artifact.id,
    );
  }
  const bytes = readFileSync(path);
  return {
    ...artifact,
    bytes: stats.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function artifactRef(artifact: RuntimeArtifactRecord) {
  if (!artifact.path) {
    throw artifactCommandError(
      "ARTIFACT_FILE_MISSING",
      `Artifact file is missing: ${artifact.id}`,
      undefined,
      undefined,
      artifact.id,
    );
  }
  return {
    id: artifact.id,
    path: artifact.path,
    name: artifact.name,
    immutable: artifact.immutable,
    mimeType: artifact.mimeType,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    createdAt: artifact.createdAt,
  };
}

class ArtifactCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path?: string,
    readonly artifactName?: string,
    readonly id?: string,
  ) {
    super(message);
    this.name = "ArtifactCommandError";
  }
}

function artifactCommandError(
  code: string,
  message: string,
  path?: string,
  name?: string,
  id?: string,
): ArtifactCommandError {
  return new ArtifactCommandError(code, message, path, name, id);
}

function isArtifactErrorCode(error: unknown, code: string): boolean {
  return error instanceof ArtifactCommandError && error.code === code;
}

function mapStoreError(message: string): {
  code: string;
  message: string;
  path?: string;
  name?: string;
  id?: string;
} {
  if (message.startsWith("ARTIFACT_EXISTS:")) {
    return { code: "ARTIFACT_EXISTS", message };
  }
  if (message.startsWith("ARTIFACT_NOT_FOUND:")) {
    return { code: "ARTIFACT_NOT_FOUND", message, id: message.split(":").at(1)?.trim() };
  }
  if (message.startsWith("INVALID_ARGUMENT:")) {
    return { code: "INVALID_ARGUMENT", message };
  }
  if (message.startsWith("SOURCE_NOT_FOUND:")) {
    return {
      code: "SOURCE_NOT_FOUND",
      message,
      path: message.split(":").slice(1).join(":").trim(),
    };
  }
  if (message.startsWith("SOURCE_IS_DIRECTORY:")) {
    return {
      code: "SOURCE_IS_DIRECTORY",
      message,
      path: message.split(":").slice(1).join(":").trim(),
    };
  }
  if (message.startsWith("SOURCE_NOT_FILE:")) {
    return { code: "SOURCE_NOT_FILE", message, path: message.split(":").slice(1).join(":").trim() };
  }
  if (message.startsWith("SOURCE_UNREADABLE:")) {
    return { code: "SOURCE_UNREADABLE", message };
  }
  if (message.startsWith("COPY_FAILED:")) {
    return { code: "COPY_FAILED", message };
  }
  if (message.startsWith("DELETE_FAILED:")) {
    return { code: "DELETE_FAILED", message };
  }
  return { code: "INTERNAL_ERROR", message };
}
