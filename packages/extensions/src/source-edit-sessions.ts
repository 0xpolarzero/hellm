import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  type AbsolutePath,
  ExtensionError as CoreExtensionError,
  type ExtensionError,
  type OpenExtensionSourceEditInput,
  type SaveExtensionSourceEditInput,
  type SourceEditSaveResult,
  type SourceEditSession,
} from "@svvy/core";
import { getExtensionRecord } from "./extension-records";
import { ExtensionSourceRootsPort } from "./extension-source-roots-port";

export type ExtensionSourceEditServices =
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | ExtensionSourceRootsPort;

export function openExtensionSourceEditSession(
  input: OpenExtensionSourceEditInput,
): Effect.Effect<
  SourceEditSession,
  ExtensionError,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto | ExtensionSourceRootsPort
> {
  return Effect.gen(function* () {
    const editableSource = yield* resolveEditableMinimalInstructionSource(
      "extensions.sources.open-edit-session",
      input,
    );
    return yield* readSourceEditSession(input, editableSource);
  });
}

export function saveExtensionSourceEditSession(
  input: SaveExtensionSourceEditInput,
): Effect.Effect<
  SourceEditSaveResult,
  ExtensionError,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto | ExtensionSourceRootsPort
> {
  return Effect.gen(function* () {
    const editableSource = yield* resolveEditableMinimalInstructionSource(
      "extensions.sources.save-edit-session",
      input,
    );
    const current = yield* readSourceEditSession(input, editableSource);
    if (
      input.saveMode === "compare-and-swap" &&
      current.sourceVersion !== input.expectedSourceVersion
    ) {
      return { status: "stale" as const, current };
    }

    yield* writeTextFileAtomically(editableSource.path, input.text).pipe(
      Effect.mapError((cause) =>
        extensionSourceEditError({
          operation: "extensions.sources.save-edit-session",
          reason: "execution-failed",
          sourceId: input.sourceId,
          message: `Failed to write extension source ${input.sourceId}.`,
          cause,
        }),
      ),
    );
    const sourceVersion = yield* sourceVersionFromText(input.text);
    return {
      status: "saved" as const,
      sourceVersion,
      fingerprint: sourceVersion,
      diagnostics: [],
      reconcileRequired: true,
    };
  });
}

interface EditableMinimalInstructionSource {
  readonly path: AbsolutePath;
  readonly fallbackText: string;
}

function resolveEditableMinimalInstructionSource(
  operation: string,
  input: Pick<OpenExtensionSourceEditInput, "sourceKind" | "sourceId">,
): Effect.Effect<
  EditableMinimalInstructionSource,
  ExtensionError,
  FileSystem.FileSystem | Path.Path | ExtensionSourceRootsPort
> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const roots = yield* (yield* ExtensionSourceRootsPort).roots();
    const extensionsRoot = path.resolve(roots.extensionsRoot);
    const workflowsRoot = path.resolve(roots.workflowsSourceRoot);
    const sourceId = yield* validateSourceIdSegment(operation, input.sourceId);

    switch (input.sourceKind) {
      case "builtin-extension": {
        const extension = getExtensionRecord(sourceId);
        if (!extension || extension.category !== "builtin") {
          return yield* Effect.fail(
            extensionSourceEditError({
              operation,
              reason: "not-found",
              sourceId,
              message: `Builtin extension source does not exist: ${sourceId}`,
            }),
          );
        }
        const sourceRoot = path.resolve(extensionsRoot, "sources", "builtin", sourceId);
        const sourcePath = yield* containedPath({
          operation,
          sourceId,
          root: sourceRoot,
          candidate: path.join(sourceRoot, "instructions", "minimal.md"),
        });
        return {
          path: sourcePath,
          fallbackText: `${extension.minimalLoadingHint}\n`,
        };
      }
      case "user-extension": {
        const sourceRoot = path.resolve(extensionsRoot, "sources", "user", sourceId);
        const manifestPath = path.join(sourceRoot, "manifest.json");
        const manifestExists = yield* (yield* FileSystem.FileSystem).exists(manifestPath).pipe(
          Effect.mapError((cause) =>
            extensionSourceEditError({
              operation,
              reason: "execution-failed",
              sourceId,
              message: `Failed to inspect user extension source ${sourceId}.`,
              cause,
            }),
          ),
        );
        if (!manifestExists) {
          return yield* Effect.fail(
            extensionSourceEditError({
              operation,
              reason: "not-found",
              sourceId,
              message: `User extension source does not exist: ${sourceId}`,
            }),
          );
        }
        const sourcePath = yield* containedPath({
          operation,
          sourceId,
          root: sourceRoot,
          candidate: path.join(sourceRoot, "instructions", "minimal.md"),
        });
        return {
          path: sourcePath,
          fallbackText: "",
        };
      }
      case "workflow-agent":
        return yield* resolveWorkflowSourceFile({
          operation,
          sourceId,
          workflowsRoot,
          directory: "agents",
          extension: ".agent.json",
        });
      case "workflow-prompt":
        return yield* resolveWorkflowSourceFile({
          operation,
          sourceId,
          workflowsRoot,
          directory: "prompts",
          extension: ".mdx",
        });
      case "workflow-component":
        return yield* resolveWorkflowComponentSourceFile({
          operation,
          sourceId,
          workflowsRoot,
        });
      case "workflow-workflow":
        return yield* resolveWorkflowSourceFile({
          operation,
          sourceId,
          workflowsRoot,
          directory: "workflows",
          extension: ".tsx",
        });
    }
  });
}

function resolveWorkflowSourceFile(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly workflowsRoot: string;
  readonly directory: "agents" | "prompts" | "components" | "workflows";
  readonly extension: ".agent.json" | ".mdx" | ".ts" | ".tsx";
}): Effect.Effect<
  EditableMinimalInstructionSource,
  ExtensionError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const sourceRoot = path.resolve(input.workflowsRoot, input.directory);
    const sourcePath = yield* containedPath({
      operation: input.operation,
      sourceId: input.sourceId,
      root: sourceRoot,
      candidate: path.join(sourceRoot, `${input.sourceId}${input.extension}`),
    });
    yield* requireExistingWorkflowSourceFile({
      operation: input.operation,
      sourceId: input.sourceId,
      sourcePath,
    });
    return {
      path: sourcePath,
      fallbackText: "",
    };
  });
}

function resolveWorkflowComponentSourceFile(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly workflowsRoot: string;
}): Effect.Effect<
  EditableMinimalInstructionSource,
  ExtensionError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const sourceRoot = path.resolve(input.workflowsRoot, "components");
    const tsPath = yield* containedPath({
      operation: input.operation,
      sourceId: input.sourceId,
      root: sourceRoot,
      candidate: path.join(sourceRoot, `${input.sourceId}.ts`),
    });
    const tsxPath = yield* containedPath({
      operation: input.operation,
      sourceId: input.sourceId,
      root: sourceRoot,
      candidate: path.join(sourceRoot, `${input.sourceId}.tsx`),
    });
    const tsxExists = yield* fs.exists(tsxPath).pipe(
      Effect.mapError((cause) =>
        extensionSourceEditError({
          operation: input.operation,
          reason: "execution-failed",
          sourceId: input.sourceId,
          message: `Failed to inspect workflow component source ${input.sourceId}.`,
          cause,
        }),
      ),
    );
    if (tsxExists) {
      return {
        path: tsxPath,
        fallbackText: "",
      };
    }
    yield* requireExistingWorkflowSourceFile({
      operation: input.operation,
      sourceId: input.sourceId,
      sourcePath: tsPath,
    });
    return {
      path: tsPath,
      fallbackText: "",
    };
  });
}

function requireExistingWorkflowSourceFile(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly sourcePath: AbsolutePath;
}): Effect.Effect<void, ExtensionError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(input.sourcePath).pipe(
      Effect.mapError((cause) =>
        extensionSourceEditError({
          operation: input.operation,
          reason: "execution-failed",
          sourceId: input.sourceId,
          message: `Failed to inspect workflow source ${input.sourceId}.`,
          cause,
        }),
      ),
    );
    if (!exists) {
      return yield* Effect.fail(
        extensionSourceEditError({
          operation: input.operation,
          reason: "not-found",
          sourceId: input.sourceId,
          message: `Workflow source does not exist: ${input.sourceId}`,
        }),
      );
    }
  });
}

function validateSourceIdSegment(
  operation: string,
  sourceId: string,
): Effect.Effect<string, ExtensionError> {
  if (
    sourceId.length === 0 ||
    sourceId.includes("/") ||
    sourceId.includes("\\") ||
    sourceId.includes("\u0000") ||
    sourceId === "." ||
    sourceId === ".." ||
    sourceId.split(".").every((segment) => segment.length === 0)
  ) {
    return Effect.fail(
      extensionSourceEditError({
        operation,
        reason: "invalid-input",
        sourceId,
        message: `Invalid extension source id: ${sourceId}`,
      }),
    );
  }
  return Effect.succeed(sourceId);
}

function containedPath(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly root: string;
  readonly candidate: string;
}): Effect.Effect<AbsolutePath, ExtensionError> {
  const normalizedRoot = input.root.endsWith("/") ? input.root : `${input.root}/`;
  if (input.candidate !== input.root && !input.candidate.startsWith(normalizedRoot)) {
    return Effect.fail(
      extensionSourceEditError({
        operation: input.operation,
        reason: "invalid-input",
        sourceId: input.sourceId,
        message: `Extension source path escapes its source root: ${input.sourceId}`,
      }),
    );
  }
  return Effect.succeed(input.candidate as AbsolutePath);
}

function readSourceEditSession(
  input: Pick<OpenExtensionSourceEditInput, "sourceKind" | "sourceId">,
  editableSource: EditableMinimalInstructionSource,
): Effect.Effect<SourceEditSession, ExtensionError, FileSystem.FileSystem | Crypto.Crypto> {
  return Effect.gen(function* () {
    const text = yield* readFileBackedText(editableSource);
    const sourceVersion = yield* sourceVersionFromText(text);
    return {
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      path: editableSource.path,
      sourceVersion,
      fingerprint: sourceVersion,
      text,
      diagnostics: [],
    };
  });
}

function readFileBackedText(
  editableSource: EditableMinimalInstructionSource,
): Effect.Effect<string, ExtensionError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(editableSource.path).pipe(
      Effect.mapError((cause) =>
        extensionSourceEditError({
          operation: "extensions.sources.read-file-backed-text",
          reason: "execution-failed",
          message: `Failed to inspect extension source ${editableSource.path}.`,
          cause,
        }),
      ),
    );
    if (!exists) {
      return editableSource.fallbackText;
    }
    const stat = yield* fs.stat(editableSource.path).pipe(
      Effect.mapError((cause) =>
        extensionSourceEditError({
          operation: "extensions.sources.read-file-backed-text",
          reason: "execution-failed",
          message: `Failed to stat extension source ${editableSource.path}.`,
          cause,
        }),
      ),
    );
    if (stat.type !== "File") {
      return yield* Effect.fail(
        extensionSourceEditError({
          operation: "extensions.sources.read-file-backed-text",
          reason: "read-only-source",
          message: `Extension source path is not a file: ${editableSource.path}`,
        }),
      );
    }
    return yield* fs.readFileString(editableSource.path).pipe(
      Effect.mapError((cause) =>
        extensionSourceEditError({
          operation: "extensions.sources.read-file-backed-text",
          reason: "execution-failed",
          message: `Failed to read extension source ${editableSource.path}.`,
          cause,
        }),
      ),
    );
  });
}

function writeTextFileAtomically(
  filePath: AbsolutePath,
  text: string,
): Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path | Crypto.Crypto> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const directory = path.dirname(filePath);
    const uuid = yield* crypto.randomUUIDv4;
    const tempPath = path.join(directory, `.${uuid}.tmp`);
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* fs.writeFileString(tempPath, text);
    yield* fs.rename(tempPath, filePath);
  });
}

function sourceVersionFromText(text: string): Effect.Effect<string, ExtensionError, Crypto.Crypto> {
  return Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const bytes = new TextEncoder().encode(text);
    const digest = yield* crypto.digest("SHA-256", bytes).pipe(
      Effect.mapError((cause) =>
        extensionSourceEditError({
          operation: "extensions.sources.source-version",
          reason: "execution-failed",
          message: "Failed to hash extension source text.",
          cause,
        }),
      ),
    );
    return `sha256:${bytesToHex(digest)}`;
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function extensionSourceEditError(input: {
  readonly operation: string;
  readonly reason: ExtensionError["reason"];
  readonly message: string;
  readonly sourceId?: string;
  readonly cause?: unknown;
}): ExtensionError {
  return new CoreExtensionError({
    ...(input.sourceId ? { extensionId: input.sourceId } : {}),
    operation: input.operation,
    reason: input.reason,
    message: input.message,
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });
}
