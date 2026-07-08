import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import type {
  AbsolutePath,
  ArtifactId,
  ArtifactMetadataRecord,
  CommandId,
  RuntimeArtifactKind,
  RuntimeArtifactStatePortService,
  StateContractError,
  ThreadId,
  WorkflowRunId,
  WorkflowTaskAttemptId,
  WorkspaceSessionId,
} from "@svvy/core";
import type * as Effect from "effect/Effect";

export type RuntimeArtifactMaterializedRecord = ArtifactMetadataRecord & {
  kind: RuntimeArtifactKind;
};

export type RuntimeArtifactStateRunner = <A>(effect: Effect.Effect<A, StateContractError>) => A;

export type MaterializeRuntimeArtifactInput = {
  artifactRoot: string;
  artifactState: RuntimeArtifactStatePortService;
  runState: RuntimeArtifactStateRunner;
  workspaceSessionId: WorkspaceSessionId;
  threadId?: ThreadId | null;
  workflowRunId?: WorkflowRunId | null;
  workflowTaskAttemptId?: WorkflowTaskAttemptId | null;
  sourceCommandId: CommandId;
  kind: RuntimeArtifactKind;
  name?: string;
  sourcePath?: AbsolutePath;
  content?: string | Uint8Array;
  mimeType?: string;
  immutable: boolean;
};

export function materializeRuntimeArtifact(
  input: MaterializeRuntimeArtifactInput,
): RuntimeArtifactMaterializedRecord {
  const name = normalizeArtifactName(input.name ?? basename(input.sourcePath ?? ""));
  const sessionRoot = resolve(input.artifactRoot, input.workspaceSessionId);
  const targetDir = input.immutable ? join(sessionRoot, "immutable") : sessionRoot;
  const storedPath = resolve(targetDir, name);
  if (!isPathInside(targetDir, storedPath)) {
    throw new Error(`INVALID_ARGUMENT: artifact path escapes artifact directory: ${name}`);
  }
  try {
    mkdirSync(targetDir, { recursive: true });
  } catch (error) {
    throw new Error(`COPY_FAILED: ${describeError(error)}`, { cause: error });
  }
  if (existsSync(storedPath)) {
    throw new Error(`ARTIFACT_EXISTS: artifact file already exists at ${storedPath}`);
  }
  if (input.sourcePath && input.content !== undefined) {
    throw new Error("INVALID_ARGUMENT: artifact materialization accepts one byte source.");
  }
  if (input.sourcePath) {
    const sourceStats = statSourcePath(input.sourcePath);
    if (sourceStats.isDirectory()) {
      throw new Error(`SOURCE_IS_DIRECTORY: ${input.sourcePath}`);
    }
    if (!sourceStats.isFile()) {
      throw new Error(`SOURCE_NOT_FILE: ${input.sourcePath}`);
    }
    try {
      copyFileSync(input.sourcePath, storedPath);
    } catch (error) {
      throw new Error(`COPY_FAILED: ${describeError(error)}`, { cause: error });
    }
  } else {
    try {
      writeFileSync(storedPath, input.content ?? "");
    } catch (error) {
      throw new Error(`COPY_FAILED: ${describeError(error)}`, { cause: error });
    }
  }
  const facts = readArtifactFileFacts(storedPath);
  const result = input.runState(
    input.artifactState.recordArtifactMetadata({
      workspaceSessionId: input.workspaceSessionId,
      ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
      ...(input.workflowRunId !== undefined ? { workflowRunId: input.workflowRunId } : {}),
      ...(input.workflowTaskAttemptId !== undefined
        ? { workflowTaskAttemptId: input.workflowTaskAttemptId }
        : {}),
      sourceCommandId: input.sourceCommandId,
      kind: input.kind,
      name,
      storedPath: storedPath as AbsolutePath,
      mimeType: input.mimeType ?? inferArtifactMimeType(name),
      byteSize: facts.byteSize,
      sha256: facts.sha256,
      immutable: input.immutable,
      materializationStatus: "ready",
    }),
  );
  return { ...result.value, kind: input.kind };
}

export function refreshRuntimeArtifact(
  artifact: ArtifactMetadataRecord,
  kind: RuntimeArtifactKind = inferArtifactKind(artifact.name),
): RuntimeArtifactMaterializedRecord {
  const facts = readArtifactFileFacts(artifact.storedPath);
  return {
    ...artifact,
    kind,
    byteSize: facts.byteSize,
    sha256: facts.sha256,
  };
}

export function deleteRuntimeArtifact(input: {
  artifactState: RuntimeArtifactStatePortService;
  runState: RuntimeArtifactStateRunner;
  workspaceSessionId: WorkspaceSessionId;
  artifact: ArtifactMetadataRecord;
}): RuntimeArtifactMaterializedRecord {
  if (input.artifact.deletedAt === null && existsSync(input.artifact.storedPath)) {
    const stats = statSync(input.artifact.storedPath);
    if (!stats.isFile()) {
      throw new Error(`DELETE_FAILED: artifact path is not a file: ${input.artifact.storedPath}`);
    }
    try {
      unlinkSync(input.artifact.storedPath);
    } catch (error) {
      throw new Error(`DELETE_FAILED: ${describeError(error)}`, { cause: error });
    }
  }
  const result = input.runState(
    input.artifactState.markArtifactMetadataDeleted({
      workspaceSessionId: input.workspaceSessionId,
      artifactId: input.artifact.artifactId as ArtifactId,
    }),
  );
  return { ...result.value, kind: inferArtifactKind(result.value.name) };
}

export function inferArtifactKind(nameOrPath: string): RuntimeArtifactKind {
  const lower = nameOrPath.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".log")) return "log";
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

export function resolveArtifactSourcePath(cwd: string, path: string): AbsolutePath {
  return (isAbsolute(path) ? path : resolve(cwd, path)) as AbsolutePath;
}

export function artifactRootForSession(input: {
  cwd: string;
  sessionId: string;
  readArtifactRootForSession?: (sessionId: string) => string | null;
}): string {
  return input.readArtifactRootForSession?.(input.sessionId) ?? join(input.cwd, "artifacts");
}

function readArtifactFileFacts(path: string): { byteSize: number; sha256: string } {
  if (!existsSync(path)) {
    throw new Error(`ARTIFACT_FILE_MISSING: ${path}`);
  }
  const stats = statSync(path);
  if (!stats.isFile()) {
    throw new Error(`ARTIFACT_FILE_MISSING: ${path}`);
  }
  return {
    byteSize: stats.size,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

function statSourcePath(path: string) {
  try {
    return statSync(path);
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
    if (code === "ENOENT") {
      throw new Error(`SOURCE_NOT_FOUND: ${path}`, { cause: error });
    }
    throw new Error(`SOURCE_UNREADABLE: ${describeError(error)}`, { cause: error });
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeArtifactName(name: string): string {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed === "." ||
    trimmed === ".."
  ) {
    throw new Error(`INVALID_ARGUMENT: invalid artifact name: ${name}`);
  }
  return trimmed;
}

function isPathInside(root: string, path: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}/`);
}

function inferArtifactMimeType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".html")) return "text/html";
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".js") || lower.endsWith(".ts")) return "text/typescript";
  if (lower.endsWith(".log") || lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}
