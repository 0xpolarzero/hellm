import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  type AbsolutePath,
  DEFAULT_WORKFLOW_AGENT_SOURCE_IDS,
  decodeUnknownTaskAgentParametersSourceEffect,
  type DefaultWorkflowAgentSourceId,
  ExtensionError as CoreExtensionError,
  type ExtensionError,
  type ExtensionId,
  type ScaffoldMissingWorkflowAgentSourcesResult,
  type SourceDiagnostic,
  type TaskAgentParametersSource,
  type WorkflowAgentSourceObservation,
  type WorkflowAgentSourceScaffoldRecord,
  WorkflowAgentSourceExportNameSchema,
} from "@svvy/core";
import { ExtensionSourceRootsPort } from "./extension-source-roots-port";
import { BUILTIN_EXTENSIONS } from "./extension-records";
import { PackagedExtensionTemplatesPort } from "./packaged-extension-templates-port";

const defaultWorkflowAgentSourceIds = new Set<string>(DEFAULT_WORKFLOW_AGENT_SOURCE_IDS);
const decodeWorkflowAgentSourceExportNameEffect = Schema.decodeUnknownEffect(
  WorkflowAgentSourceExportNameSchema,
);

export interface ParsedWorkflowAgentSource {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly agent: TaskAgentParametersSource;
  readonly extensionOrder: readonly ExtensionId[];
}

export function isDefaultWorkflowAgentSourceId(
  sourceId: string,
): sourceId is DefaultWorkflowAgentSourceId {
  return defaultWorkflowAgentSourceIds.has(sourceId);
}

export function decodeWorkflowAgentSourceText(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly sourceText: string;
}): Effect.Effect<ParsedWorkflowAgentSource, ExtensionError> {
  return Effect.gen(function* () {
    yield* decodeWorkflowAgentSourceExportNameEffect(input.sourceId).pipe(
      Effect.mapError((cause) =>
        workflowAgentSourceError({
          operation: input.operation,
          reason: "invalid-input",
          sourceId: input.sourceId,
          message: `Workflow-agent source filename is not a valid export name: ${input.sourceId}`,
          cause,
        }),
      ),
    );
    const raw = yield* Effect.try({
      try: () => {
        const parsed = JSON.parse(input.sourceText) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Workflow-agent source must contain a JSON object.");
        }
        return parsed as Record<string, unknown>;
      },
      catch: (cause) =>
        workflowAgentSourceError({
          operation: input.operation,
          reason: "invalid-input",
          sourceId: input.sourceId,
          message: `Workflow-agent source is not valid JSON: ${input.sourceId}`,
          cause,
        }),
    });
    const { extensionOrder: rawExtensionOrder, ...parameters } = raw;
    const extensionOrder = yield* decodeWorkflowAgentExtensionOrder({
      operation: input.operation,
      sourceId: input.sourceId,
      value: rawExtensionOrder,
    });
    const agent = yield* decodeUnknownTaskAgentParametersSourceEffect(parameters).pipe(
      Effect.mapError((cause) =>
        workflowAgentSourceError({
          operation: input.operation,
          reason: "invalid-input",
          sourceId: input.sourceId,
          message: `Workflow-agent source must match TaskAgentParametersSource: ${input.sourceId}`,
          cause,
        }),
      ),
    );
    if (agent.id !== input.sourceId) {
      return yield* Effect.fail(
        workflowAgentSourceError({
          operation: input.operation,
          reason: "invalid-input",
          sourceId: input.sourceId,
          message: `Workflow-agent source id must match its filename: ${input.sourceId}`,
        }),
      );
    }
    return { raw, agent, extensionOrder };
  });
}

export function workflowAgentExtensionReferences(
  input: Pick<ParsedWorkflowAgentSource, "agent" | "extensionOrder">,
): readonly string[] {
  return [...Object.keys(input.agent.overrides ?? {}), ...input.extensionOrder];
}

export function validateWorkflowAgentExtensionReferences(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly extensionIds: readonly string[];
}): Effect.Effect<
  void,
  ExtensionError,
  FileSystem.FileSystem | Path.Path | ExtensionSourceRootsPort
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const roots = yield* (yield* ExtensionSourceRootsPort).roots();
    const builtinIds = new Set<string>(BUILTIN_EXTENSIONS.map((extension) => extension.id));
    const userSourceRoot = path.resolve(roots.extensionsRoot, "sources", "user");
    for (const extensionId of [...new Set(input.extensionIds)].toSorted()) {
      if (builtinIds.has(extensionId)) continue;
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(extensionId) || extensionId === "extensions") {
        return yield* Effect.fail(
          workflowAgentSourceError({
            operation: input.operation,
            reason: "invalid-input",
            sourceId: input.sourceId,
            message: `Workflow-agent source ${input.sourceId} references an invalid extension id: ${extensionId}`,
          }),
        );
      }
      const sourceRoot = path.join(userSourceRoot, extensionId);
      const sourceExists = yield* fs.exists(sourceRoot).pipe(
        Effect.mapError((cause) =>
          workflowAgentSourceError({
            operation: input.operation,
            reason: "execution-failed",
            sourceId: input.sourceId,
            message: `Failed to inspect referenced user extension source ${extensionId}.`,
            cause,
          }),
        ),
      );
      if (!sourceExists) {
        return yield* Effect.fail(
          workflowAgentSourceError({
            operation: input.operation,
            reason: "invalid-input",
            sourceId: input.sourceId,
            message: `Workflow-agent source ${input.sourceId} references unknown extension id: ${extensionId}`,
          }),
        );
      }
      const stat = yield* fs.stat(sourceRoot).pipe(
        Effect.mapError((cause) =>
          workflowAgentSourceError({
            operation: input.operation,
            reason: "execution-failed",
            sourceId: input.sourceId,
            message: `Failed to inspect referenced user extension source ${extensionId}.`,
            cause,
          }),
        ),
      );
      if (stat.type !== "Directory") {
        return yield* Effect.fail(
          workflowAgentSourceError({
            operation: input.operation,
            reason: "invalid-input",
            sourceId: input.sourceId,
            message: `Referenced user extension source is not a directory: ${extensionId}`,
          }),
        );
      }
      const manifestPath = path.join(sourceRoot, "manifest.json");
      const manifestExists = yield* fs.exists(manifestPath).pipe(
        Effect.mapError((cause) =>
          workflowAgentSourceError({
            operation: input.operation,
            reason: "execution-failed",
            sourceId: input.sourceId,
            message: `Failed to inspect referenced user extension manifest ${extensionId}.`,
            cause,
          }),
        ),
      );
      if (!manifestExists) {
        return yield* Effect.fail(
          workflowAgentSourceError({
            operation: input.operation,
            reason: "invalid-input",
            sourceId: input.sourceId,
            message: `Referenced user extension source has no manifest: ${extensionId}`,
          }),
        );
      }
      const manifestText = yield* fs.readFileString(manifestPath).pipe(
        Effect.mapError((cause) =>
          workflowAgentSourceError({
            operation: input.operation,
            reason: "execution-failed",
            sourceId: input.sourceId,
            message: `Failed to read referenced user extension manifest ${extensionId}.`,
            cause,
          }),
        ),
      );
      const manifest = yield* parseJsonObject({
        operation: input.operation,
        sourceId: extensionId,
        sourceText: manifestText,
        label: "user extension manifest",
      });
      if (
        manifest.schemaVersion !== 1 ||
        manifest.id !== extensionId ||
        manifest.interface !== "svvyx" ||
        manifest.typescriptApiEnabled !== true ||
        manifest.workflowTaskAgentReferenceExportEnabled !== true
      ) {
        return yield* Effect.fail(
          workflowAgentSourceError({
            operation: input.operation,
            reason: "invalid-input",
            sourceId: input.sourceId,
            message: `User extension source is not eligible for workflow-agent references: ${extensionId}`,
          }),
        );
      }
    }
  });
}

export function scanWorkflowAgentSources(): Effect.Effect<
  readonly WorkflowAgentSourceObservation[],
  ExtensionError,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto | ExtensionSourceRootsPort
> {
  const operation = "extensions.sources.scan-workflow-agents";
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sourceRoots = yield* (yield* ExtensionSourceRootsPort).roots();
    const agentsRoot = path.resolve(sourceRoots.workflowsSourceRoot, "agents");
    const exists = yield* fs.exists(agentsRoot).pipe(
      Effect.mapError((cause) =>
        workflowAgentSourceError({
          operation,
          reason: "execution-failed",
          message: `Failed to inspect workflow-agent source root: ${agentsRoot}`,
          cause,
        }),
      ),
    );
    if (!exists) return [];
    const entries = yield* fs.readDirectory(agentsRoot).pipe(
      Effect.mapError((cause) =>
        workflowAgentSourceError({
          operation,
          reason: "execution-failed",
          message: `Failed to list workflow-agent source root: ${agentsRoot}`,
          cause,
        }),
      ),
    );
    const observedAt = DateTime.formatIso(
      yield* DateTime.now,
    ) as WorkflowAgentSourceObservation["observedAt"];
    const observations = yield* Effect.forEach(
      entries.filter((entry) => entry.endsWith(".agent.json")).toSorted(),
      (entry) =>
        observeWorkflowAgentSource({
          operation,
          sourceId: entry.slice(0, -".agent.json".length),
          sourcePath: path.join(agentsRoot, entry) as AbsolutePath,
          observedAt,
        }),
    );
    return observations.filter(
      (observation): observation is WorkflowAgentSourceObservation => observation !== null,
    );
  });
}

export function scaffoldMissingWorkflowAgentSources(): Effect.Effect<
  ScaffoldMissingWorkflowAgentSourcesResult,
  ExtensionError,
  FileSystem.FileSystem | Path.Path | ExtensionSourceRootsPort | PackagedExtensionTemplatesPort
> {
  const operation = "extensions.sources.scaffold-missing-workflow-agents";
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sourceRoots = yield* (yield* ExtensionSourceRootsPort).roots();
    const templateRoots = yield* (yield* PackagedExtensionTemplatesPort).roots();
    const packagedAgentsRoot = path.resolve(
      templateRoots.builtinExtensionsRoot,
      "workflows",
      "agents",
    );
    const liveAgentsRoot = path.resolve(sourceRoots.workflowsSourceRoot, "agents");
    const templates = yield* Effect.forEach(DEFAULT_WORKFLOW_AGENT_SOURCE_IDS, (sourceId) =>
      readPackagedWorkflowAgentTemplate({
        fs,
        operation,
        path,
        packagedAgentsRoot,
        sourceId,
      }),
    );
    yield* fs.makeDirectory(liveAgentsRoot, { recursive: true }).pipe(
      Effect.mapError((cause) =>
        workflowAgentSourceError({
          operation,
          reason: "execution-failed",
          message: `Failed to create workflow-agent source root: ${liveAgentsRoot}`,
          cause,
        }),
      ),
    );
    const created: WorkflowAgentSourceScaffoldRecord[] = [];
    const preserved: WorkflowAgentSourceScaffoldRecord[] = [];
    for (const template of templates) {
      const targetPath = path.join(
        liveAgentsRoot,
        `${template.sourceId}.agent.json`,
      ) as AbsolutePath;
      const targetExists = yield* fs.exists(targetPath).pipe(
        Effect.mapError((cause) =>
          workflowAgentSourceError({
            operation,
            reason: "execution-failed",
            sourceId: template.sourceId,
            message: `Failed to inspect workflow-agent source target: ${targetPath}`,
            cause,
          }),
        ),
      );
      if (targetExists) {
        preserved.push({ sourceId: template.sourceId, path: targetPath });
        continue;
      }
      const outcome = yield* fs.writeFileString(targetPath, template.text, { flag: "wx" }).pipe(
        Effect.as("created" as const),
        Effect.catch((writeCause) =>
          fs.exists(targetPath).pipe(
            Effect.mapError((inspectCause) =>
              workflowAgentSourceError({
                operation,
                reason: "execution-failed",
                sourceId: template.sourceId,
                message: `Failed to inspect raced workflow-agent source target: ${targetPath}`,
                cause: inspectCause,
              }),
            ),
            Effect.flatMap((publishedByRace) =>
              publishedByRace
                ? Effect.succeed("preserved" as const)
                : Effect.fail(
                    workflowAgentSourceError({
                      operation,
                      reason: "execution-failed",
                      sourceId: template.sourceId,
                      message: `Failed to scaffold workflow-agent source: ${targetPath}`,
                      cause: writeCause,
                    }),
                  ),
            ),
          ),
        ),
      );
      (outcome === "created" ? created : preserved).push({
        sourceId: template.sourceId,
        path: targetPath,
      });
    }
    return { created, preserved };
  });
}

function decodeWorkflowAgentExtensionOrder(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly value: unknown;
}): Effect.Effect<readonly ExtensionId[], ExtensionError> {
  if (input.value === undefined) return Effect.succeed([]);
  if (
    !Array.isArray(input.value) ||
    input.value.some((extensionId) => typeof extensionId !== "string") ||
    new Set(input.value).size !== input.value.length
  ) {
    return Effect.fail(
      workflowAgentSourceError({
        operation: input.operation,
        reason: "invalid-input",
        sourceId: input.sourceId,
        message: `Workflow-agent source has invalid extensionOrder: ${input.sourceId}`,
      }),
    );
  }
  return Effect.succeed(input.value as readonly ExtensionId[]);
}

function observeWorkflowAgentSource(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly sourcePath: AbsolutePath;
  readonly observedAt: WorkflowAgentSourceObservation["observedAt"];
}): Effect.Effect<
  WorkflowAgentSourceObservation | null,
  ExtensionError,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto | ExtensionSourceRootsPort
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stat = yield* fs.stat(input.sourcePath).pipe(
      Effect.map((value) => ({ status: "read" as const, value })),
      Effect.catch(() => Effect.succeed({ status: "unreadable" as const })),
    );
    if (stat.status === "unreadable") {
      return yield* unreadableWorkflowAgentObservation({
        ...input,
        reason: "stat-failed",
        message: `Workflow-agent source metadata could not be read: ${input.sourceId}`,
      });
    }
    if (stat.value.type !== "File") {
      return yield* unreadableWorkflowAgentObservation({
        ...input,
        reason: `not-a-file:${stat.value.type}`,
        message: `Workflow-agent source is not a readable file: ${input.sourceId}`,
      });
    }
    const text = yield* fs.readFileString(input.sourcePath).pipe(
      Effect.map((value) => ({ status: "read" as const, value })),
      Effect.catch(() => Effect.succeed({ status: "unreadable" as const })),
    );
    if (text.status === "unreadable") {
      return yield* unreadableWorkflowAgentObservation({
        ...input,
        reason: "read-failed",
        message: `Workflow-agent source contents could not be read: ${input.sourceId}`,
      });
    }
    const sourceVersion = yield* workflowAgentSourceVersionFromText(text.value);
    const validation = yield* decodeWorkflowAgentSourceText({
      operation: input.operation,
      sourceId: input.sourceId,
      sourceText: text.value,
    }).pipe(
      Effect.flatMap((source) =>
        validateWorkflowAgentExtensionReferences({
          operation: input.operation,
          sourceId: input.sourceId,
          extensionIds: workflowAgentExtensionReferences(source),
        }).pipe(Effect.as(source)),
      ),
      Effect.map((source) => ({ status: "valid" as const, source })),
      Effect.catch((error) => Effect.succeed({ status: "invalid" as const, error })),
    );
    const parsed =
      validation.status === "valid"
        ? {
            validationStatus: "valid" as const,
            diagnostics: [] as readonly SourceDiagnostic[],
            parameters: validation.source.agent,
            extensionOrder: validation.source.extensionOrder,
          }
        : {
            validationStatus: "invalid" as const,
            diagnostics: [
              {
                severity: "error" as const,
                code: "workflow_agent_source_invalid",
                message: validation.error.message,
                path: input.sourcePath,
              },
            ] satisfies readonly SourceDiagnostic[],
            parameters: null,
            extensionOrder: [] as readonly ExtensionId[],
          };
    return {
      sourceId: input.sourceId,
      path: input.sourcePath,
      sourceVersion,
      fingerprint: sourceVersion,
      ...parsed,
      observedAt: input.observedAt,
    };
  });
}

function unreadableWorkflowAgentObservation(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly sourcePath: AbsolutePath;
  readonly observedAt: WorkflowAgentSourceObservation["observedAt"];
  readonly reason: string;
  readonly message: string;
}): Effect.Effect<WorkflowAgentSourceObservation, ExtensionError, Crypto.Crypto> {
  return Effect.gen(function* () {
    const digest = yield* workflowAgentSourceVersionFromText(
      `unreadable-workflow-agent-source\n${input.sourcePath}\n${input.reason}`,
    );
    const sourceVersion = `unreadable:${digest.slice("sha256:".length)}`;
    return {
      sourceId: input.sourceId,
      path: input.sourcePath,
      sourceVersion,
      fingerprint: sourceVersion,
      validationStatus: "invalid",
      diagnostics: [
        {
          severity: "error",
          code: "workflow_agent_source_unreadable",
          message: input.message,
          path: input.sourcePath,
        },
      ],
      parameters: null,
      extensionOrder: [],
      observedAt: input.observedAt,
    };
  });
}

function readPackagedWorkflowAgentTemplate(input: {
  readonly fs: FileSystem.FileSystem;
  readonly operation: string;
  readonly path: Path.Path;
  readonly packagedAgentsRoot: string;
  readonly sourceId: DefaultWorkflowAgentSourceId;
}): Effect.Effect<
  { readonly sourceId: DefaultWorkflowAgentSourceId; readonly text: string },
  ExtensionError
> {
  return Effect.gen(function* () {
    const templatePath = input.path.join(
      input.packagedAgentsRoot,
      `${input.sourceId}.agent.json`,
    ) as AbsolutePath;
    const exists = yield* input.fs.exists(templatePath).pipe(
      Effect.mapError((cause) =>
        workflowAgentSourceError({
          operation: input.operation,
          reason: "execution-failed",
          sourceId: input.sourceId,
          message: `Failed to inspect packaged workflow-agent source: ${templatePath}`,
          cause,
        }),
      ),
    );
    if (!exists) {
      return yield* Effect.fail(
        workflowAgentSourceError({
          operation: input.operation,
          reason: "not-found",
          sourceId: input.sourceId,
          message: `Packaged workflow-agent source is missing: ${templatePath}`,
        }),
      );
    }
    const stat = yield* input.fs.stat(templatePath).pipe(
      Effect.mapError((cause) =>
        workflowAgentSourceError({
          operation: input.operation,
          reason: "execution-failed",
          sourceId: input.sourceId,
          message: `Failed to stat packaged workflow-agent source: ${templatePath}`,
          cause,
        }),
      ),
    );
    if (stat.type !== "File") {
      return yield* Effect.fail(
        workflowAgentSourceError({
          operation: input.operation,
          reason: "invalid-input",
          sourceId: input.sourceId,
          message: `Packaged workflow-agent source is not a file: ${templatePath}`,
        }),
      );
    }
    const text = yield* input.fs.readFileString(templatePath).pipe(
      Effect.mapError((cause) =>
        workflowAgentSourceError({
          operation: input.operation,
          reason: "execution-failed",
          sourceId: input.sourceId,
          message: `Failed to read packaged workflow-agent source: ${templatePath}`,
          cause,
        }),
      ),
    );
    yield* decodeWorkflowAgentSourceText({
      operation: input.operation,
      sourceId: input.sourceId,
      sourceText: text,
    });
    return { sourceId: input.sourceId, text };
  });
}

function workflowAgentSourceVersionFromText(
  text: string,
): Effect.Effect<string, ExtensionError, Crypto.Crypto> {
  return Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode(text)).pipe(
      Effect.mapError((cause) =>
        workflowAgentSourceError({
          operation: "extensions.sources.scan-workflow-agents",
          reason: "execution-failed",
          message: "Failed to hash workflow-agent source text.",
          cause,
        }),
      ),
    );
    return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  });
}

function parseJsonObject(input: {
  readonly operation: string;
  readonly sourceId: string;
  readonly sourceText: string;
  readonly label: string;
}): Effect.Effect<Record<string, unknown>, ExtensionError> {
  return Effect.try({
    try: () => {
      const parsed = JSON.parse(input.sourceText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${input.label} must contain a JSON object.`);
      }
      return parsed as Record<string, unknown>;
    },
    catch: (cause) =>
      workflowAgentSourceError({
        operation: input.operation,
        reason: "invalid-input",
        sourceId: input.sourceId,
        message: `Failed to parse ${input.label} for ${input.sourceId}.`,
        cause,
      }),
  });
}

function workflowAgentSourceError(input: {
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
