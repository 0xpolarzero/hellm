import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  type AbsolutePath,
  type CreateWorkflowAgentSourceInput,
  decodeUnknownCreateWorkflowAgentSourceInputEffect,
  decodeUnknownDeleteWorkflowAgentSourceInputEffect,
  decodeUnknownDuplicateWorkflowAgentSourceInputEffect,
  type DeleteWorkflowAgentSourceInput,
  type DuplicateWorkflowAgentSourceInput,
  ExtensionError as CoreExtensionError,
  type ExtensionError,
  type OpenExtensionSourceEditInput,
  type SaveExtensionSourceEditInput,
  type SourceEditSaveResult,
  type SourceEditSession,
  type TaskAgentParametersSource,
  type WorkflowAgentSourceDeleteResult,
  type WorkflowAgentSourceExportName,
  type WorkflowAgentSourceLifecycleResult,
} from "@svvy/core";
import { getExtensionRecord } from "./extension-records";
import { materializeBuiltinExtensionSource } from "./extension-source-management";
import { ExtensionSourceRootsPort } from "./extension-source-roots-port";
import { PackagedExtensionTemplatesPort } from "./packaged-extension-templates-port";
import {
  decodeWorkflowAgentSourceText,
  isDefaultWorkflowAgentSourceId,
  validateWorkflowAgentExtensionReferences,
  workflowAgentExtensionReferences,
} from "./workflow-agent-source-records";

export type ExtensionSourceEditServices =
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | ExtensionSourceRootsPort
  | PackagedExtensionTemplatesPort;

export function createWorkflowAgentSource(
  input: CreateWorkflowAgentSourceInput,
): Effect.Effect<WorkflowAgentSourceLifecycleResult, ExtensionError, ExtensionSourceEditServices> {
  const operation = "extensions.sources.create-workflow-agent";
  return Effect.gen(function* () {
    const decoded = yield* decodeWorkflowAgentLifecycleInput(
      operation,
      decodeUnknownCreateWorkflowAgentSourceInputEffect(input),
    );
    yield* rejectDefaultWorkflowAgentSourceId(operation, decoded.draft.exportName);
    const displayName = yield* normalizeWorkflowAgentDisplayName({
      operation,
      sourceId: decoded.draft.exportName,
      displayName: decoded.draft.displayName,
    });
    yield* validateWorkflowAgentExtensionReferences({
      operation,
      sourceId: decoded.draft.exportName,
      extensionIds: [
        ...(decoded.draft.extensionUsageOverrides?.map((entry) => entry.extensionId) ?? []),
        ...(decoded.draft.extensionOrder ?? []),
      ],
    });
    const parameters = {
      id: decoded.draft.exportName,
      label: displayName,
      provider: decoded.draft.provider,
      model: decoded.draft.model,
      reasoning: decoded.draft.reasoning,
      instructions: decoded.draft.instructionText ?? "",
      ...(decoded.draft.extensionUsageOverrides?.length
        ? {
            overrides: Object.fromEntries(
              decoded.draft.extensionUsageOverrides.map((entry) => [
                entry.extensionId,
                entry.usage,
              ]),
            ),
          }
        : {}),
    } satisfies TaskAgentParametersSource;
    const sourceText = `${JSON.stringify(
      {
        ...parameters,
        ...(decoded.draft.extensionOrder?.length
          ? { extensionOrder: decoded.draft.extensionOrder }
          : {}),
      },
      null,
      2,
    )}\n`;
    const sourcePath = yield* workflowAgentSourcePath(operation, decoded.draft.exportName);
    yield* createWorkflowAgentSourceFile({
      operation,
      sourceId: decoded.draft.exportName,
      sourcePath,
      sourceText,
    });
    const session = yield* readSourceEditSession(
      { sourceKind: "workflow-agent", sourceId: decoded.draft.exportName },
      { path: sourcePath, fallbackText: "" },
    );
    return {
      status: "created",
      session: session as WorkflowAgentSourceLifecycleResult["session"],
      fileWriteReceipt: {
        path: sourcePath,
        previousExists: false,
        bytes: new TextEncoder().encode(sourceText).byteLength,
      },
      reconcileRequired: true,
    };
  });
}

export function duplicateWorkflowAgentSource(
  input: DuplicateWorkflowAgentSourceInput,
): Effect.Effect<WorkflowAgentSourceLifecycleResult, ExtensionError, ExtensionSourceEditServices> {
  const operation = "extensions.sources.duplicate-workflow-agent";
  return Effect.gen(function* () {
    const decoded = yield* decodeWorkflowAgentLifecycleInput(
      operation,
      decodeUnknownDuplicateWorkflowAgentSourceInputEffect(input),
    );
    yield* rejectDefaultWorkflowAgentSourceId(operation, decoded.draftPatch.exportName);
    const source = yield* openExtensionSourceEditSession({
      sourceKind: "workflow-agent",
      sourceId: decoded.sourceId,
    });
    const parsed = yield* decodeWorkflowAgentSourceText({
      operation,
      sourceId: decoded.sourceId,
      sourceText: source.text,
    });
    yield* validateWorkflowAgentExtensionReferences({
      operation,
      sourceId: decoded.sourceId,
      extensionIds: workflowAgentExtensionReferences(parsed),
    });
    const displayName = decoded.draftPatch.displayName
      ? yield* normalizeWorkflowAgentDisplayName({
          operation,
          sourceId: decoded.draftPatch.exportName,
          displayName: decoded.draftPatch.displayName,
        })
      : parsed.agent.label;
    const duplicateText = `${JSON.stringify(
      {
        ...parsed.raw,
        id: decoded.draftPatch.exportName,
        label: displayName,
        instructions: decoded.draftPatch.instructionText ?? parsed.agent.instructions,
      },
      null,
      2,
    )}\n`;
    const duplicatePath = yield* workflowAgentSourcePath(operation, decoded.draftPatch.exportName);
    yield* createWorkflowAgentSourceFile({
      operation,
      sourceId: decoded.draftPatch.exportName,
      sourcePath: duplicatePath,
      sourceText: duplicateText,
    });
    const session = yield* readSourceEditSession(
      { sourceKind: "workflow-agent", sourceId: decoded.draftPatch.exportName },
      { path: duplicatePath, fallbackText: "" },
    );
    return {
      status: "duplicated",
      session: session as WorkflowAgentSourceLifecycleResult["session"],
      fileWriteReceipt: {
        path: duplicatePath,
        previousExists: false,
        bytes: new TextEncoder().encode(duplicateText).byteLength,
      },
      reconcileRequired: true,
    };
  });
}

export function deleteWorkflowAgentSource(
  input: DeleteWorkflowAgentSourceInput,
): Effect.Effect<WorkflowAgentSourceDeleteResult, ExtensionError, ExtensionSourceEditServices> {
  const operation = "extensions.sources.delete-workflow-agent";
  return Effect.gen(function* () {
    const decoded = yield* decodeWorkflowAgentLifecycleInput(
      operation,
      decodeUnknownDeleteWorkflowAgentSourceInputEffect(input),
    );
    if (isDefaultWorkflowAgentSourceId(decoded.sourceId)) {
      return yield* Effect.fail(
        extensionSourceEditError({
          operation,
          reason: "invalid-input",
          sourceId: decoded.sourceId,
          message: `Default workflow-agent source cannot be deleted: ${decoded.sourceId}`,
        }),
      );
    }
    const session = yield* openExtensionSourceEditSession({
      sourceKind: "workflow-agent",
      sourceId: decoded.sourceId,
    });
    if (session.sourceVersion !== decoded.expectedSourceVersion) {
      return yield* Effect.fail(
        extensionSourceEditError({
          operation,
          reason: "invalid-input",
          sourceId: decoded.sourceId,
          message: `Workflow-agent source ${decoded.sourceId} changed before deletion.`,
        }),
      );
    }
    yield* (yield* FileSystem.FileSystem).remove(session.path).pipe(
      Effect.mapError((cause) =>
        extensionSourceEditError({
          operation,
          reason: "execution-failed",
          sourceId: decoded.sourceId,
          message: `Failed to delete workflow-agent source ${decoded.sourceId}.`,
          cause,
        }),
      ),
    );
    return {
      status: "deleted",
      sourceKind: "workflow-agent",
      sourceId: decoded.sourceId,
      deletedPath: session.path,
      previousSourceVersion: session.sourceVersion,
      fileWriteReceipt: { path: session.path, deleted: true },
      reconcileRequired: true,
    };
  });
}

export function openExtensionSourceEditSession(
  input: OpenExtensionSourceEditInput,
): Effect.Effect<
  SourceEditSession,
  ExtensionError,
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | ExtensionSourceRootsPort
  | PackagedExtensionTemplatesPort
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
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | ExtensionSourceRootsPort
  | PackagedExtensionTemplatesPort
> {
  return Effect.gen(function* () {
    const editableSource = yield* resolveEditableMinimalInstructionSource(
      "extensions.sources.save-edit-session",
      input,
    );
    if (editableSource.readOnly) {
      return yield* Effect.fail(
        extensionSourceEditError({
          operation: "extensions.sources.save-edit-session",
          reason: "read-only-source",
          sourceId: input.sourceId,
          message: `Extension source is read-only: ${input.sourceId}`,
        }),
      );
    }
    const current = yield* readSourceEditSession(input, editableSource);
    if (
      input.saveMode === "compare-and-swap" &&
      current.sourceVersion !== input.expectedSourceVersion
    ) {
      return { status: "stale" as const, current };
    }

    let targetSource = editableSource;
    if (editableSource.materializeBuiltinId) {
      yield* materializeBuiltinExtensionSource(editableSource.materializeBuiltinId);
      const materializedSource = yield* resolveEditableMinimalInstructionSource(
        "extensions.sources.save-edit-session",
        input,
      );
      const materializedCurrent = yield* readSourceEditSession(input, materializedSource);
      if (
        input.saveMode === "compare-and-swap" &&
        materializedCurrent.sourceVersion !== input.expectedSourceVersion
      ) {
        return { status: "stale" as const, current: materializedCurrent };
      }
      targetSource = materializedSource;
    }

    if (input.sourceKind === "workflow-agent") {
      const parsed = yield* decodeWorkflowAgentSourceText({
        operation: "extensions.sources.save-edit-session",
        sourceId: input.sourceId,
        sourceText: input.text,
      });
      yield* validateWorkflowAgentExtensionReferences({
        operation: "extensions.sources.save-edit-session",
        sourceId: input.sourceId,
        extensionIds: workflowAgentExtensionReferences(parsed),
      });
    }

    yield* writeTextFileAtomically(targetSource.path, input.text).pipe(
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
      path: targetSource.path,
      sourceVersion,
      fingerprint: sourceVersion,
      diagnostics: [],
      reconcileRequired: true,
    };
  });
}

function decodeWorkflowAgentLifecycleInput<A>(
  operation: string,
  effect: Effect.Effect<A, unknown>,
): Effect.Effect<A, ExtensionError> {
  return effect.pipe(
    Effect.mapError((cause) =>
      extensionSourceEditError({
        operation,
        reason: "invalid-input",
        message: "Workflow-agent source lifecycle input is invalid.",
        cause,
      }),
    ),
  );
}

function rejectDefaultWorkflowAgentSourceId(
  operation: string,
  sourceId: WorkflowAgentSourceExportName,
): Effect.Effect<void, ExtensionError> {
  return isDefaultWorkflowAgentSourceId(sourceId)
    ? Effect.fail(
        extensionSourceEditError({
          operation,
          reason: "invalid-input",
          sourceId,
          message: `Default workflow-agent source id is reserved: ${sourceId}`,
        }),
      )
    : Effect.void;
}

function workflowAgentSourcePath(
  operation: string,
  sourceId: WorkflowAgentSourceExportName,
): Effect.Effect<AbsolutePath, ExtensionError, Path.Path | ExtensionSourceRootsPort> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const roots = yield* (yield* ExtensionSourceRootsPort).roots();
    const sourceRoot = path.resolve(roots.workflowsSourceRoot, "agents");
    return yield* containedPath({
      operation,
      sourceId,
      root: sourceRoot,
      candidate: path.join(sourceRoot, `${sourceId}.agent.json`),
    });
  });
}

function createWorkflowAgentSourceFile(input: {
  readonly operation: string;
  readonly sourceId: WorkflowAgentSourceExportName;
  readonly sourcePath: AbsolutePath;
  readonly sourceText: string;
}): Effect.Effect<void, ExtensionError, FileSystem.FileSystem | Path.Path | Crypto.Crypto> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const exists = yield* fs.exists(input.sourcePath).pipe(
      Effect.mapError((cause) =>
        extensionSourceEditError({
          operation: input.operation,
          reason: "execution-failed",
          sourceId: input.sourceId,
          message: `Failed to inspect workflow-agent source ${input.sourceId}.`,
          cause,
        }),
      ),
    );
    if (exists) {
      return yield* Effect.fail(
        extensionSourceEditError({
          operation: input.operation,
          reason: "invalid-input",
          sourceId: input.sourceId,
          message: `Workflow-agent source already exists: ${input.sourceId}`,
        }),
      );
    }
    const directory = path.dirname(input.sourcePath);
    const uuid = yield* crypto.randomUUIDv4.pipe(
      Effect.mapError((cause) =>
        extensionSourceEditError({
          operation: input.operation,
          reason: "execution-failed",
          sourceId: input.sourceId,
          message: `Failed to allocate workflow-agent source temp path ${input.sourceId}.`,
          cause,
        }),
      ),
    );
    const tempPath = path.join(directory, `.${uuid}.tmp`);
    yield* fs.makeDirectory(directory, { recursive: true }).pipe(
      Effect.andThen(fs.writeFileString(tempPath, input.sourceText, { flag: "wx" })),
      Effect.mapError((cause) =>
        extensionSourceEditError({
          operation: input.operation,
          reason: "execution-failed",
          sourceId: input.sourceId,
          message: `Failed to create workflow-agent source ${input.sourceId}.`,
          cause,
        }),
      ),
    );
    yield* Effect.gen(function* () {
      yield* fs.link(tempPath, input.sourcePath).pipe(
        Effect.mapError((cause) =>
          extensionSourceEditError({
            operation: input.operation,
            reason: "invalid-input",
            sourceId: input.sourceId,
            message: `Workflow-agent source already exists or could not be published: ${input.sourceId}`,
            cause,
          }),
        ),
      );
    }).pipe(Effect.ensuring(fs.remove(tempPath, { force: true }).pipe(Effect.ignore)));
  });
}

function normalizeWorkflowAgentDisplayName(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly displayName: string;
}): Effect.Effect<string, ExtensionError> {
  const displayName = input.displayName.trim();
  return displayName.length > 0
    ? Effect.succeed(displayName)
    : Effect.fail(
        extensionSourceEditError({
          operation: input.operation,
          reason: "invalid-input",
          sourceId: input.sourceId,
          message: `Workflow-agent source ${input.sourceId} requires a non-blank display name.`,
        }),
      );
}

interface EditableMinimalInstructionSource {
  readonly path: AbsolutePath;
  readonly fallbackText: string;
  readonly readOnly?: boolean;
  readonly materializeBuiltinId?: string;
}

export type ExtensionOwnedSourceAddress =
  | { readonly kind: "minimal" }
  | { readonly kind: "instruction"; readonly name: string }
  | { readonly kind: "script"; readonly relativePath: string }
  | { readonly kind: "generated-instruction"; readonly relativePath: string }
  | { readonly kind: "svvyx-source" }
  | { readonly kind: "command-schema" }
  | { readonly kind: "native-tool-schema" }
  | { readonly kind: "typescript-api-declaration" };

export function extensionOwnedSourceId(
  extensionId: string,
  address: ExtensionOwnedSourceAddress,
): string {
  if (!extensionId || extensionId.includes("#")) {
    throw new Error(`Invalid extension source identity: ${extensionId}`);
  }
  const suffix =
    address.kind === "minimal" ||
    address.kind === "svvyx-source" ||
    address.kind === "command-schema" ||
    address.kind === "native-tool-schema" ||
    address.kind === "typescript-api-declaration"
      ? address.kind
      : `${address.kind}/${encodeURIComponent(
          address.kind === "instruction" ? address.name : address.relativePath,
        )}`;
  return `${extensionId}#${suffix}`;
}

function resolveEditableMinimalInstructionSource(
  operation: string,
  input: Pick<OpenExtensionSourceEditInput, "sourceKind" | "sourceId">,
): Effect.Effect<
  EditableMinimalInstructionSource,
  ExtensionError,
  FileSystem.FileSystem | Path.Path | ExtensionSourceRootsPort | PackagedExtensionTemplatesPort
> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const roots = yield* (yield* ExtensionSourceRootsPort).roots();
    const templates = yield* (yield* PackagedExtensionTemplatesPort).roots();
    const extensionsRoot = path.resolve(roots.extensionsRoot);
    const workflowsRoot = path.resolve(roots.workflowsSourceRoot);
    const sourceAddress =
      input.sourceKind === "builtin-extension" || input.sourceKind === "user-extension"
        ? parseExtensionOwnedSourceId(input.sourceId)
        : null;
    const sourceId = yield* validateSourceIdSegment(
      operation,
      sourceAddress?.extensionId ?? input.sourceId,
    );

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
        if (!sourceAddress) {
          return yield* invalidExtensionSourceAddress(operation, input.sourceId);
        }
        const liveSourceRoot = path.resolve(extensionsRoot, "sources", "builtin", sourceId);
        const liveManifest = path.resolve(liveSourceRoot, "manifest.json");
        const liveExists = yield* (yield* FileSystem.FileSystem).exists(liveManifest).pipe(
          Effect.mapError((cause) =>
            extensionSourceEditError({
              operation,
              reason: "execution-failed",
              sourceId,
              message: `Failed to inspect builtin extension source ${sourceId}.`,
              cause,
            }),
          ),
        );
        const sourceRoot = liveExists
          ? liveSourceRoot
          : path.resolve(templates.builtinExtensionsRoot, sourceId);
        yield* validateManifestSourceAddress({
          operation,
          sourceId,
          sourceRoot,
          address: sourceAddress.address,
          builtin: extension,
        });
        return yield* resolveExtensionOwnedSourceAddress({
          operation,
          sourceId,
          sourceRoot,
          extensionsRoot,
          address: sourceAddress.address,
          builtin: extension,
          ...(liveExists ? {} : { materializeBuiltinId: sourceId }),
        });
      }
      case "user-extension": {
        if (!sourceAddress) {
          return yield* invalidExtensionSourceAddress(operation, input.sourceId);
        }
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
        yield* validateManifestSourceAddress({
          operation,
          sourceId,
          sourceRoot,
          address: sourceAddress.address,
        });
        return yield* resolveExtensionOwnedSourceAddress({
          operation,
          sourceId,
          sourceRoot,
          extensionsRoot,
          address: sourceAddress.address,
        });
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

function parseExtensionOwnedSourceId(sourceId: string): {
  readonly extensionId: string;
  readonly address: ExtensionOwnedSourceAddress;
} | null {
  const separator = sourceId.indexOf("#");
  if (separator <= 0) return null;
  const extensionId = sourceId.slice(0, separator);
  const suffix = sourceId.slice(separator + 1);
  if (
    suffix === "minimal" ||
    suffix === "svvyx-source" ||
    suffix === "command-schema" ||
    suffix === "native-tool-schema" ||
    suffix === "typescript-api-declaration"
  ) {
    return { extensionId, address: { kind: suffix } };
  }
  for (const kind of ["instruction", "script", "generated-instruction"] as const) {
    const prefix = `${kind}/`;
    if (!suffix.startsWith(prefix)) continue;
    try {
      const encoded = suffix.slice(prefix.length);
      const value = decodeURIComponent(encoded);
      if (encodeURIComponent(value) !== encoded || !isCanonicalRelativeSourceIdentity(value)) {
        return null;
      }
      return {
        extensionId,
        address: kind === "instruction" ? { kind, name: value } : { kind, relativePath: value },
      };
    } catch {
      return null;
    }
  }
  return null;
}

function isCanonicalRelativeSourceIdentity(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function invalidExtensionSourceAddress(
  operation: string,
  sourceId: string,
): Effect.Effect<never, ExtensionError> {
  return Effect.fail(
    extensionSourceEditError({
      operation,
      reason: "invalid-input",
      sourceId,
      message: `Extension source address is invalid: ${sourceId}`,
    }),
  );
}

function validateManifestSourceAddress(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly sourceRoot: string;
  readonly address: ExtensionOwnedSourceAddress;
  readonly builtin?: NonNullable<ReturnType<typeof getExtensionRecord>>;
}): Effect.Effect<void, ExtensionError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const manifestPath = path.resolve(input.sourceRoot, "manifest.json");
    const exists = yield* fs.exists(manifestPath).pipe(
      Effect.mapError((cause) =>
        extensionSourceEditError({
          operation: input.operation,
          reason: "execution-failed",
          sourceId: input.sourceId,
          message: `Failed to inspect builtin extension manifest: ${input.sourceId}`,
          cause,
        }),
      ),
    );
    if (!exists) return yield* invalidExtensionSourceAddress(input.operation, input.sourceId);
    const text = yield* fs.readFileString(manifestPath).pipe(
      Effect.mapError((cause) =>
        extensionSourceEditError({
          operation: input.operation,
          reason: "execution-failed",
          sourceId: input.sourceId,
          message: `Failed to read builtin extension manifest: ${input.sourceId}`,
          cause,
        }),
      ),
    );
    const manifest = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (cause) =>
        extensionSourceEditError({
          operation: input.operation,
          reason: "invalid-input",
          sourceId: input.sourceId,
          message: `Builtin extension manifest is invalid: ${input.sourceId}`,
          cause,
        }),
    });
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      return yield* invalidExtensionSourceAddress(input.operation, input.sourceId);
    }
    const record = manifest as Record<string, unknown>;
    const instructionFiles = Array.isArray(record.instructionFiles)
      ? record.instructionFiles.flatMap((entry) =>
          entry &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          typeof (entry as Record<string, unknown>).file === "string"
            ? [(entry as Record<string, unknown>).file as string]
            : [],
        )
      : (input.builtin?.instructionFiles ?? []).map((entry) => entry.file);
    const generatedInstructions = Array.isArray(record.generatedInstructions)
      ? record.generatedInstructions.flatMap((entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry)
            ? [entry as Record<string, unknown>]
            : [],
        )
      : (input.builtin?.generatedInstructions ?? []);
    const generatedOutputs = new Set(
      generatedInstructions.flatMap((entry) =>
        typeof entry.output === "string" ? [entry.output] : [],
      ),
    );
    const admitted = (() => {
      switch (input.address.kind) {
        case "minimal":
          return true;
        case "instruction":
          return (
            instructionFiles.includes(input.address.name) &&
            !generatedOutputs.has(`instructions/full/${input.address.name}`)
          );
        case "script": {
          const relativePath = input.address.relativePath;
          return generatedInstructions.some((entry) => entry.script === relativePath);
        }
        case "generated-instruction":
          return generatedOutputs.has(input.address.relativePath);
        case "svvyx-source":
        case "command-schema":
          return record.interface === "svvyx";
        case "native-tool-schema":
          return record.interface === "native_tool";
        case "typescript-api-declaration":
          return (
            (typeof record.typescriptApiEnabled === "boolean"
              ? record.typescriptApiEnabled
              : input.builtin?.typescriptApiEnabled) === true
          );
      }
    })();
    if (!admitted) return yield* invalidExtensionSourceAddress(input.operation, input.sourceId);
  });
}

function resolveExtensionOwnedSourceAddress(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly sourceRoot: string;
  readonly extensionsRoot: string;
  readonly address: ExtensionOwnedSourceAddress;
  readonly builtin?: ReturnType<typeof getExtensionRecord>;
  readonly materializeBuiltinId?: string;
}): Effect.Effect<EditableMinimalInstructionSource, ExtensionError, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const address = input.address;
    let root = input.sourceRoot;
    let relativePath: string;
    let fallbackText = "";
    let readOnly = false;
    switch (address.kind) {
      case "minimal":
        relativePath = path.join("instructions", "minimal.mdx");
        fallbackText = input.builtin ? `${input.builtin.minimalLoadingHint}\n` : "";
        readOnly = input.builtin?.id === "extension-loading";
        break;
      case "instruction":
        if (path.basename(address.name) !== address.name) {
          return yield* invalidExtensionSourceAddress(input.operation, input.sourceId);
        }
        relativePath = path.join("instructions", "full", address.name);
        break;
      case "script":
        if (!address.relativePath.startsWith("scripts/") || !address.relativePath.endsWith(".ts")) {
          return yield* invalidExtensionSourceAddress(input.operation, input.sourceId);
        }
        relativePath = address.relativePath;
        break;
      case "generated-instruction":
        if (
          !address.relativePath.startsWith("instructions/full/") ||
          !address.relativePath.endsWith(".md")
        ) {
          return yield* invalidExtensionSourceAddress(input.operation, input.sourceId);
        }
        relativePath = address.relativePath;
        readOnly = true;
        break;
      case "svvyx-source":
        relativePath = path.join("source", "index.ts");
        break;
      case "command-schema":
        root = path.resolve(
          input.extensionsRoot,
          "builds",
          "extensions",
          input.sourceId,
          "current",
        );
        relativePath = "commands.json";
        readOnly = true;
        break;
      case "native-tool-schema":
        root = path.resolve(
          input.extensionsRoot,
          "builds",
          "extensions",
          input.sourceId,
          "current",
        );
        relativePath = "native-tool-schema.json";
        readOnly = true;
        break;
      case "typescript-api-declaration":
        root = path.resolve(
          input.extensionsRoot,
          "builds",
          "extensions",
          input.sourceId,
          "current",
        );
        relativePath = "index.d.ts";
        readOnly = true;
        break;
    }
    const sourcePath = yield* containedPath({
      operation: input.operation,
      sourceId: input.sourceId,
      root,
      candidate: path.resolve(root, relativePath),
    });
    return {
      path: sourcePath,
      fallbackText,
      ...(readOnly ? { readOnly: true } : {}),
      ...(input.materializeBuiltinId ? { materializeBuiltinId: input.materializeBuiltinId } : {}),
    };
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
      if (editableSource.readOnly || !editableSource.fallbackText) {
        return yield* Effect.fail(
          extensionSourceEditError({
            operation: "extensions.sources.read-file-backed-text",
            reason: "not-found",
            message: `Extension source does not exist: ${editableSource.path}`,
          }),
        );
      }
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
