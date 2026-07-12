import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { DEFAULT_WORKFLOW_AGENT_SOURCE_IDS, ExtensionStatePort } from "@svvy/core";
import type {
  AbsolutePath,
  CommandId,
  DefaultWorkflowAgentSourceId,
  ExtensionError,
  ExtensionId,
  NativeToolHandlerLookupInput,
  PromptExecutionContext,
  SurfacePiSessionId,
  ThreadId,
  ToolCallId,
  TurnId,
  WorkflowAgentSourceExportName,
  WorkflowTaskAttemptId,
  WorkspaceId,
  WorkspaceSessionId,
} from "@svvy/core";
import { Extensions, layer, makeExtensions, type ExtensionsService } from "./extensions-service";
import {
  layerExtensionSourceRootsPort,
  type ExtensionSourceRootsPort,
} from "./extension-source-roots-port";
import {
  layerGeneratedPackageRootPort,
  type GeneratedPackageRootPort,
} from "./generated-package-root-port";
import {
  layerPackagedExtensionTemplatesPort,
  type PackagedExtensionTemplatesPort,
} from "./packaged-extension-templates-port";
import {
  layerWorkspaceSourceLinkPort,
  type WorkspaceSourceLinkPort,
} from "./workspace-source-link-port";
import type { GeneratedExtensionExportDiscoveryServices } from "./generated-extensions-package";
import { extensionOwnedSourceId } from "./source-edit-sessions";

function nativeToolLookup(input: {
  toolName: string;
  actorKind?: NativeToolHandlerLookupInput["actorKind"];
  loadedExtensionIds?: readonly string[];
  availableExtensionIds?: readonly string[];
}): NativeToolHandlerLookupInput {
  const actorKind = input.actorKind ?? "orchestrator";
  const loadedExtensionIds = input.loadedExtensionIds ?? ["extension-loading"];
  const availableExtensionIds = input.availableExtensionIds ?? [];
  const actorBinding = {
    actorKind,
    loadedExtensionIds: loadedExtensionIds as readonly ExtensionId[],
    availableExtensionIds: availableExtensionIds as readonly ExtensionId[],
    unavailableExtensionIds: [] as readonly ExtensionId[],
    instructionOrder: loadedExtensionIds as readonly ExtensionId[],
    source: "surface-binding",
  } satisfies NativeToolHandlerLookupInput["actorBinding"];
  const baseTarget = {
    workspaceSessionId: "wsess_extensions_service_handler_lookup" as WorkspaceSessionId,
    surfacePiSessionId: "pi_extensions_service_handler_lookup" as SurfacePiSessionId,
  };
  const target =
    actorKind === "handler"
      ? {
          kind: "handler" as const,
          ...baseTarget,
          threadId: "thread_extensions_service_handler_lookup" as ThreadId,
        }
      : actorKind === "workflow-task"
        ? {
            kind: "workflow-task" as const,
            ...baseTarget,
            workflowTaskAttemptId:
              "task_attempt_extensions_service_handler_lookup" as WorkflowTaskAttemptId,
          }
        : {
            kind: "orchestrator" as const,
            ...baseTarget,
          };
  return {
    actorKind,
    actorBinding,
    target,
    extensionUsageSource: "surface-binding",
    toolName: input.toolName,
  };
}

function makeTestExtensions(): Effect.Effect<ExtensionsService, ExtensionError> {
  return provideGeneratedPackagePlatform(makeExtensions());
}

function makeSourceEditHarness(
  harnessOptions: {
    readonly publishRaceContents?: string;
    readonly unreadablePaths?: readonly string[];
  } = {},
): {
  readonly extensionsRoot: AbsolutePath;
  readonly packagedExtensionsRoot: AbsolutePath;
  readonly workflowsSourceRoot: AbsolutePath;
  readonly layer: Layer.Layer<Extensions>;
  readonly readFile: (path: string) => string | null;
  readonly writeFile: (path: string, contents: string) => void;
} {
  const files = new Map<string, string>();
  const unreadablePaths = new Set(harnessOptions.unreadablePaths ?? []);
  const directories = new Set<string>(["/", "/extensions-test", "/workflows-test"]);
  const fileSystem = {
    exists: (path: string) => Effect.succeed(files.has(path) || directories.has(path)),
    stat: (path: string) =>
      files.has(path)
        ? Effect.succeed({ type: "File" } as FileSystem.File.Info)
        : directories.has(path)
          ? Effect.succeed({ type: "Directory" } as FileSystem.File.Info)
          : Effect.die(new Error(`Missing path: ${path}`)),
    readFileString: (path: string) =>
      unreadablePaths.has(path)
        ? Effect.fail(new Error(`Unreadable file: ${path}`))
        : files.has(path)
          ? Effect.succeed(files.get(path) ?? "")
          : Effect.die(new Error(`Missing file: ${path}`)),
    readDirectory: (path: string) =>
      Effect.succeed(sourceEditReadDirectoryNames(path, files, directories)),
    makeDirectory: (path: string) =>
      Effect.sync(() => {
        addSourceEditDirectoryChain(directories, path);
      }),
    link: (fromPath: string, toPath: string) =>
      Effect.try({
        try: () => {
          const contents = files.get(fromPath);
          if (contents === undefined) throw new Error(`Missing file: ${fromPath}`);
          if (harnessOptions.publishRaceContents !== undefined && !files.has(toPath)) {
            files.set(toPath, harnessOptions.publishRaceContents);
          }
          if (files.has(toPath)) throw new Error(`File exists: ${toPath}`);
          files.set(toPath, contents);
        },
        catch: (cause) => cause,
      }),
    remove: (path: string) =>
      Effect.sync(() => {
        if (!files.delete(path)) {
          throw new Error(`Missing file: ${path}`);
        }
      }),
    writeFileString: (path: string, contents: string, options?: { readonly flag?: string }) =>
      Effect.sync(() => {
        if (options?.flag?.includes("x") && files.has(path)) {
          throw new Error(`File exists: ${path}`);
        }
        addSourceEditDirectoryChain(directories, sourceEditDirnamePath(path));
        files.set(path, contents);
      }),
    rename: (fromPath: string, toPath: string) =>
      Effect.sync(() => {
        const contents = files.get(fromPath);
        if (contents === undefined) {
          throw new Error(`Missing file: ${fromPath}`);
        }
        addSourceEditDirectoryChain(directories, sourceEditDirnamePath(toPath));
        files.delete(fromPath);
        files.set(toPath, contents);
      }),
  } as unknown as FileSystem.FileSystem;
  const pathService = {
    sep: "/",
    basename: (input: string) => input.split("/").filter(Boolean).at(-1) ?? "",
    dirname: sourceEditDirnamePath,
    join: joinSourceEditPathSegments,
    resolve: (...segments: readonly string[]) =>
      normalizeSourceEditPath(joinSourceEditPathSegments(...segments)),
  } as unknown as Path.Path;
  const crypto = Crypto.make({
    digest: (_algorithm, data) => Effect.succeed(data),
    randomBytes: (size) => new Uint8Array(size).fill(1),
  });
  const extensionsRoot = "/extensions-test" as AbsolutePath;
  const packagedExtensionsRoot = "/packaged-extensions-test" as AbsolutePath;
  const workflowsSourceRoot = "/workflows-test" as AbsolutePath;
  const extensionState = {
    records: {
      readSourceFingerprint: () => Effect.succeed(null),
    },
    dependencies: {
      isApproved: () => Effect.succeed(false),
      readReadiness: () => Effect.succeed(null),
    },
  };
  const extensionSourceRootsLayer = layerExtensionSourceRootsPort({
    extensionsRoot,
    workflowsSourceRoot,
  });
  const packagedTemplatesLayer = layerPackagedExtensionTemplatesPort({
    builtinExtensionsRoot: packagedExtensionsRoot,
  });
  const generatedPackageRootLayer = layerGeneratedPackageRootPort({
    extensionsPackageRoot: "/generated/extensions-package-test" as AbsolutePath,
    workflowsPackageRoot: "/generated/workflows-package-test" as AbsolutePath,
    coreTypeContractPackageRoot: "/generated/core-type-contract-package-test" as AbsolutePath,
  });
  const workspaceSourceLinkLayer = layerWorkspaceSourceLinkPort({
    generatedPackageLinkPath: () =>
      Effect.succeed("/workspace/.smithers/node_modules/@svvyx/extensions" as AbsolutePath),
  });

  return {
    extensionsRoot,
    packagedExtensionsRoot,
    workflowsSourceRoot,
    layer: Layer.effect(
      Extensions,
      makeExtensions().pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, pathService),
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(ExtensionStatePort, extensionState),
        Effect.provide(extensionSourceRootsLayer),
        Effect.provide(packagedTemplatesLayer),
        Effect.provide(generatedPackageRootLayer),
        Effect.provide(workspaceSourceLinkLayer),
      ),
    ),
    readFile: (filePath) => files.get(filePath) ?? null,
    writeFile: (filePath, contents) => {
      addSourceEditDirectoryChain(directories, sourceEditDirnamePath(filePath));
      files.set(filePath, contents);
    },
  };
}

function joinSourceEditPathSegments(...segments: readonly string[]): string {
  return normalizeSourceEditPath(segments.join("/"));
}

function normalizeSourceEditPath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}` || (absolute ? "/" : ".");
}

function sourceEditDirnamePath(path: string): string {
  const normalized = normalizeSourceEditPath(path);
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return "/";
  }
  return normalized.slice(0, index);
}

function addSourceEditDirectoryChain(directories: Set<string>, path: string): void {
  let current = normalizeSourceEditPath(path);
  const pending: string[] = [];
  while (current && !directories.has(current)) {
    pending.push(current);
    current = sourceEditDirnamePath(current);
  }
  for (const directory of pending.toReversed()) {
    directories.add(directory);
  }
}

function sourceEditReadDirectoryNames(
  path: string,
  files: ReadonlyMap<string, string>,
  directories: ReadonlySet<string>,
): string[] {
  const prefix = `${normalizeSourceEditPath(path).replace(/\/$/, "")}/`;
  const names = new Set<string>();
  for (const candidate of [...files.keys(), ...directories]) {
    if (!candidate.startsWith(prefix)) continue;
    const child = candidate.slice(prefix.length).split("/")[0];
    if (child) names.add(child);
  }
  return [...names].toSorted();
}

function extensionIds(ids: readonly string[]): readonly ExtensionId[] {
  return ids as unknown as readonly ExtensionId[];
}

function workflowAgentSourceText(
  sourceId: string,
  input: {
    readonly label?: string;
    readonly instructions?: string;
    readonly overrides?: Readonly<Record<string, "loaded" | "available" | "unavailable">>;
    readonly extensionOrder?: readonly string[];
  } = {},
): string {
  return `${JSON.stringify(
    {
      id: sourceId,
      label: input.label ?? sourceId,
      provider: "zai",
      model: "glm-5-turbo",
      reasoning: { effort: "medium" },
      instructions: input.instructions ?? `Instructions for ${sourceId}.`,
      overrides: input.overrides ?? {},
      extensionOrder: input.extensionOrder ?? [],
    },
    null,
    2,
  )}\n`;
}

function packagedWorkflowAgentSourceText(sourceId: DefaultWorkflowAgentSourceId): string {
  const labels: Record<DefaultWorkflowAgentSourceId, string> = {
    defaultAgent: "Default",
    explorerAgent: "Explorer",
    implementerAgent: "Implementer",
    reviewerAgent: "Reviewer",
  };
  return workflowAgentSourceText(sourceId, { label: labels[sourceId] });
}

describe("@svvy/extensions Effect service", () => {
  it.effect("lists and inspects builtin extension registry records", () =>
    Effect.gen(function* () {
      const service = yield* makeTestExtensions();

      const records = yield* service.registry.list();
      const shell = yield* service.registry.inspect({ id: "shell" });

      assert.include(
        records.map((record) => record.id),
        "shell",
      );
      assert.deepStrictEqual(
        { id: shell.id, interface: shell.interface, title: shell.title },
        {
          id: "shell",
          interface: "native_tool",
          title: "Shell",
        },
      );
    }),
  );

  it.effect(
    "builds actor-scoped execute_typescript facade declarations for loaded builtin facades",
    () =>
      Effect.gen(function* () {
        const service = yield* makeTestExtensions();

        const result = yield* service.executeTypescriptFacadeDeclarations.build({
          actorKind: "orchestrator",
          actorBinding: {
            actorKind: "orchestrator",
            loadedExtensionIds: extensionIds([
              "artifacts",
              "execute-typescript",
              "workflows",
              "web",
              "linear-user",
            ]),
            availableExtensionIds: extensionIds(["github"]),
            unavailableExtensionIds: [],
            instructionOrder: extensionIds([
              "artifacts",
              "execute-typescript",
              "workflows",
              "web",
              "linear-user",
            ]),
            source: "surface-binding",
          },
        });

        assert.deepStrictEqual(result.emittedExtensionIds.map(String), ["artifacts", "workflows"]);
        assert.include(result.text, "interface ArtifactsExtensionFacade");
        assert.include(result.text, "interface WorkflowsExtensionFacade");
        assert.include(
          result.text,
          'Run.Result<{ id: string; intent: "open_artifact_inspector"; accepted: true }>',
        );
        assert.notInclude(result.text, "linear-user");
        assert.notInclude(result.text, "@svvyx/workflows");
        assert.notInclude(result.text, "@svvyx/extensions");
        assert.notInclude(result.text, "workflow.");
        assert.notInclude(result.text, "svvyx smithers");
        assert.notInclude(result.text, "declare const svvy");
        assert.notInclude(result.text, "api.");
      }),
  );

  it.effect("omits available-only execute_typescript facade declarations", () =>
    Effect.gen(function* () {
      const service = yield* makeTestExtensions();

      const result = yield* service.executeTypescriptFacadeDeclarations.build({
        actorKind: "workflow-task",
        actorBinding: {
          actorKind: "workflow-task",
          loadedExtensionIds: extensionIds(["execute-typescript"]),
          availableExtensionIds: extensionIds(["artifacts", "workflows"]),
          unavailableExtensionIds: [],
          instructionOrder: extensionIds(["execute-typescript"]),
          source: "workflow-agent-source",
        },
      });

      assert.deepStrictEqual(result, {
        text: "",
        emittedExtensionIds: [],
      });
    }),
  );

  it.effect(
    "scans readable workflow-agent sources independently without failing on invalid rows",
    () =>
      Effect.gen(function* () {
        const sourceEditHarness = makeSourceEditHarness();
        const agentsRoot = joinSourceEditPathSegments(
          sourceEditHarness.workflowsSourceRoot,
          "agents",
        );
        sourceEditHarness.writeFile(
          joinSourceEditPathSegments(agentsRoot, "validAgent.agent.json"),
          workflowAgentSourceText("validAgent", {
            label: "Valid agent",
            extensionOrder: ["shell", "git"],
          }),
        );
        sourceEditHarness.writeFile(
          joinSourceEditPathSegments(agentsRoot, "malformedAgent.agent.json"),
          "{ not json\n",
        );
        sourceEditHarness.writeFile(
          joinSourceEditPathSegments(agentsRoot, "wrongIdAgent.agent.json"),
          workflowAgentSourceText("differentAgent"),
        );
        sourceEditHarness.writeFile(
          joinSourceEditPathSegments(agentsRoot, "invalid-name.agent.json"),
          workflowAgentSourceText("invalid-name"),
        );
        sourceEditHarness.writeFile(
          joinSourceEditPathSegments(agentsRoot, "unknownReferenceAgent.agent.json"),
          workflowAgentSourceText("unknownReferenceAgent", {
            overrides: { "missing-extension": "loaded" },
          }),
        );
        sourceEditHarness.writeFile(joinSourceEditPathSegments(agentsRoot, "ignored.json"), "{}\n");

        const observations = yield* Effect.gen(function* () {
          const extensions = yield* Extensions;
          return yield* extensions.sources.scanWorkflowAgents();
        }).pipe(Effect.provide(sourceEditHarness.layer));

        assert.deepStrictEqual(
          observations.map((observation) => observation.sourceId),
          ["invalid-name", "malformedAgent", "unknownReferenceAgent", "validAgent", "wrongIdAgent"],
        );
        const valid = observations.find((observation) => observation.sourceId === "validAgent");
        assert.strictEqual(valid?.validationStatus, "valid");
        assert.strictEqual(valid?.parameters?.label, "Valid agent");
        assert.deepStrictEqual(valid?.extensionOrder.map(String), ["shell", "git"]);
        assert.strictEqual(valid?.diagnostics.length, 0);
        assert.match(valid?.sourceVersion ?? "", /^sha256:/);
        assert.strictEqual(valid?.fingerprint, valid?.sourceVersion);
        assert.strictEqual(
          valid?.path,
          joinSourceEditPathSegments(agentsRoot, "validAgent.agent.json"),
        );
        assert.match(valid?.observedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

        for (const sourceId of [
          "invalid-name",
          "malformedAgent",
          "unknownReferenceAgent",
          "wrongIdAgent",
        ]) {
          const invalid = observations.find((observation) => observation.sourceId === sourceId);
          assert.strictEqual(invalid?.validationStatus, "invalid");
          assert.strictEqual(invalid?.parameters, null);
          assert.deepStrictEqual(invalid?.extensionOrder, []);
          assert.strictEqual(invalid?.diagnostics[0]?.code, "workflow_agent_source_invalid");
          assert.strictEqual(invalid?.diagnostics[0]?.path, invalid?.path);
        }
      }),
  );

  it.effect("projects unreadable workflow-agent sources as invalid observations", () =>
    Effect.gen(function* () {
      const unreadablePath = "/workflows-test/agents/unreadableAgent.agent.json" as AbsolutePath;
      const sourceEditHarness = makeSourceEditHarness({ unreadablePaths: [unreadablePath] });
      sourceEditHarness.writeFile(unreadablePath, workflowAgentSourceText("unreadableAgent"));

      const observations = yield* Effect.gen(function* () {
        const extensions = yield* Extensions;
        return yield* extensions.sources.scanWorkflowAgents();
      }).pipe(Effect.provide(sourceEditHarness.layer));

      assert.strictEqual(observations.length, 1);
      const observation = observations[0]!;
      assert.strictEqual(observation.sourceId, "unreadableAgent");
      assert.strictEqual(observation.path, unreadablePath);
      assert.strictEqual(observation.validationStatus, "invalid");
      assert.strictEqual(observation.parameters, null);
      assert.deepStrictEqual(observation.extensionOrder, []);
      assert.deepStrictEqual(observation.diagnostics, [
        {
          severity: "error",
          code: "workflow_agent_source_unreadable",
          message: "Workflow-agent source contents could not be read: unreadableAgent",
          path: unreadablePath,
        },
      ]);
      assert.match(observation.sourceVersion, /^unreadable:[0-9a-f]+$/);
      assert.strictEqual(observation.fingerprint, observation.sourceVersion);
    }),
  );

  it.effect("scaffolds canonical workflow-agent sources once and preserves existing edits", () =>
    Effect.gen(function* () {
      const sourceEditHarness = makeSourceEditHarness();
      for (const sourceId of DEFAULT_WORKFLOW_AGENT_SOURCE_IDS) {
        sourceEditHarness.writeFile(
          joinSourceEditPathSegments(
            sourceEditHarness.packagedExtensionsRoot,
            "workflows",
            "agents",
            `${sourceId}.agent.json`,
          ),
          packagedWorkflowAgentSourceText(sourceId),
        );
      }
      const editedExplorer = workflowAgentSourceText("explorerAgent", {
        label: "My Explorer",
        instructions: "Keep this local edit.",
      });
      const explorerPath = joinSourceEditPathSegments(
        sourceEditHarness.workflowsSourceRoot,
        "agents",
        "explorerAgent.agent.json",
      );
      sourceEditHarness.writeFile(explorerPath, editedExplorer);

      const result = yield* Effect.gen(function* () {
        const extensions = yield* Extensions;
        const first = yield* extensions.sources.scaffoldMissingWorkflowAgents();
        const second = yield* extensions.sources.scaffoldMissingWorkflowAgents();
        return { first, second };
      }).pipe(Effect.provide(sourceEditHarness.layer));

      assert.deepStrictEqual(
        result.first.created.map((record) => record.sourceId),
        ["defaultAgent", "implementerAgent", "reviewerAgent"],
      );
      assert.deepStrictEqual(
        result.first.preserved.map((record) => record.sourceId),
        ["explorerAgent"],
      );
      assert.deepStrictEqual(result.second.created, []);
      assert.deepStrictEqual(
        result.second.preserved.map((record) => record.sourceId),
        [...DEFAULT_WORKFLOW_AGENT_SOURCE_IDS],
      );
      assert.strictEqual(sourceEditHarness.readFile(explorerPath), editedExplorer);
      assert.strictEqual(
        sourceEditHarness.readFile(
          joinSourceEditPathSegments(
            sourceEditHarness.workflowsSourceRoot,
            "agents",
            "reviewerAgent.agent.json",
          ),
        ),
        packagedWorkflowAgentSourceText("reviewerAgent"),
      );
    }),
  );

  it.effect("validates every packaged workflow-agent source before scaffolding any live file", () =>
    Effect.gen(function* () {
      const sourceEditHarness = makeSourceEditHarness();
      for (const sourceId of DEFAULT_WORKFLOW_AGENT_SOURCE_IDS.filter(
        (candidate) => candidate !== "reviewerAgent",
      )) {
        sourceEditHarness.writeFile(
          joinSourceEditPathSegments(
            sourceEditHarness.packagedExtensionsRoot,
            "workflows",
            "agents",
            `${sourceId}.agent.json`,
          ),
          packagedWorkflowAgentSourceText(sourceId),
        );
      }

      const error = yield* Effect.gen(function* () {
        const extensions = yield* Extensions;
        return yield* extensions.sources.scaffoldMissingWorkflowAgents();
      }).pipe(Effect.provide(sourceEditHarness.layer), Effect.flip);

      assertExtensionError(error, {
        _tag: "ExtensionError",
        extensionId: "reviewerAgent",
        operation: "extensions.sources.scaffold-missing-workflow-agents",
        reason: "not-found",
      });
      for (const sourceId of DEFAULT_WORKFLOW_AGENT_SOURCE_IDS) {
        assert.strictEqual(
          sourceEditHarness.readFile(
            joinSourceEditPathSegments(
              sourceEditHarness.workflowsSourceRoot,
              "agents",
              `${sourceId}.agent.json`,
            ),
          ),
          null,
        );
      }
    }),
  );

  it.effect("opens and saves editable extension source sessions with file-backed CAS", () =>
    Effect.gen(function* () {
      const sourceEditHarness = makeSourceEditHarness();
      const sourceId = extensionOwnedSourceId("base-common", { kind: "minimal" });
      const result = yield* Effect.gen(function* () {
        const extensions = yield* Extensions;
        const opened = yield* extensions.sources.openEditSession({
          sourceKind: "builtin-extension",
          sourceId,
        });
        const stale = yield* extensions.sources.saveEditSession({
          sourceKind: "builtin-extension",
          sourceId,
          expectedSourceVersion: "sha256:not-current",
          text: "ignored\n",
          saveMode: "compare-and-swap",
        });
        const saved = yield* extensions.sources.saveEditSession({
          sourceKind: "builtin-extension",
          sourceId,
          expectedSourceVersion: opened.sourceVersion,
          text: "Load Base Common from the editable source file.\n",
          saveMode: "compare-and-swap",
        });
        const reopened = yield* extensions.sources.openEditSession({
          sourceKind: "builtin-extension",
          sourceId,
        });
        return { opened, stale, saved, reopened };
      }).pipe(Effect.provide(sourceEditHarness.layer));

      assert.strictEqual(
        result.opened.text,
        "Load Base Common only when shared svvy operating rules are missing.\n",
      );
      assert.strictEqual(
        result.opened.path,
        joinSourceEditPathSegments(
          sourceEditHarness.extensionsRoot,
          "sources",
          "builtin",
          "base-common",
          "instructions",
          "minimal.md",
        ) as AbsolutePath,
      );
      assert.strictEqual(result.stale.status, "stale");
      assert.strictEqual(result.saved.status, "saved");
      if (result.saved.status !== "saved") {
        throw new Error("expected source edit save to succeed");
      }
      assert.deepStrictEqual(result.saved.diagnostics, []);
      assert.strictEqual(result.saved.reconcileRequired, true);
      assert.strictEqual(result.reopened.text, "Load Base Common from the editable source file.\n");
      assert.strictEqual(
        sourceEditHarness.readFile(result.opened.path),
        "Load Base Common from the editable source file.\n",
      );
    }),
  );

  it.effect(
    "resolves canonical extension contributor identities and keeps generated records read-only",
    () =>
      Effect.gen(function* () {
        const sourceEditHarness = makeSourceEditHarness();
        const generatedPath = joinSourceEditPathSegments(
          sourceEditHarness.extensionsRoot,
          "sources",
          "builtin",
          "web",
          "instructions",
          "full",
          "010-tinyfish-cli.generated.md",
        );
        const commandSchemaPath = joinSourceEditPathSegments(
          sourceEditHarness.extensionsRoot,
          "generated",
          "extensions",
          "workflows",
          "commands.json",
        );
        sourceEditHarness.writeFile(generatedPath, "generated web guidance\n");
        sourceEditHarness.writeFile(commandSchemaPath, "{}\n");
        const generatedSourceId = extensionOwnedSourceId("web", {
          kind: "generated-instruction",
          relativePath: "instructions/full/010-tinyfish-cli.generated.md",
        });
        const commandSchemaSourceId = extensionOwnedSourceId("workflows", {
          kind: "command-schema",
        });

        const result = yield* Effect.gen(function* () {
          const extensions = yield* Extensions;
          const generated = yield* extensions.sources.openEditSession({
            sourceKind: "builtin-extension",
            sourceId: generatedSourceId,
          });
          const commandSchema = yield* extensions.sources.openEditSession({
            sourceKind: "builtin-extension",
            sourceId: commandSchemaSourceId,
          });
          const readOnly = yield* extensions.sources
            .saveEditSession({
              sourceKind: "builtin-extension",
              sourceId: generatedSourceId,
              expectedSourceVersion: generated.sourceVersion,
              text: "do not write\n",
              saveMode: "overwrite",
            })
            .pipe(Effect.flip);
          const aliases = yield* Effect.all(
            [
              "web#generated-instruction/instructions%2ffull%2f010-tinyfish-cli.generated.md",
              "web#generated-instruction/instructions%2F..%2Fmanifest.json",
            ].map((sourceId) =>
              extensions.sources
                .openEditSession({ sourceKind: "builtin-extension", sourceId })
                .pipe(Effect.flip),
            ),
          );
          const missingGenerated = yield* extensions.sources
            .openEditSession({
              sourceKind: "builtin-extension",
              sourceId: extensionOwnedSourceId("web", {
                kind: "generated-instruction",
                relativePath: "instructions/full/missing.generated.md",
              }),
            })
            .pipe(Effect.flip);
          return { generated, commandSchema, readOnly, aliases, missingGenerated };
        }).pipe(Effect.provide(sourceEditHarness.layer));

        assert.strictEqual(result.generated.path, generatedPath);
        assert.strictEqual(result.generated.text, "generated web guidance\n");
        assert.strictEqual(result.commandSchema.path, commandSchemaPath);
        assertExtensionError(result.readOnly, {
          _tag: "ExtensionError",
          reason: "read-only-source",
        });
        for (const error of result.aliases) {
          assertExtensionError(error, { _tag: "ExtensionError", reason: "invalid-input" });
        }
        assertExtensionError(result.missingGenerated, {
          _tag: "ExtensionError",
          reason: "not-found",
        });
      }),
  );

  it.effect("opens and saves workflow source edit sessions with exact file mappings", () =>
    Effect.gen(function* () {
      const sourceEditHarness = makeSourceEditHarness();
      sourceEditHarness.writeFile(
        joinSourceEditPathSegments(
          sourceEditHarness.workflowsSourceRoot,
          "agents",
          "reviewerAgent.agent.json",
        ),
        JSON.stringify(
          {
            id: "reviewerAgent",
            label: "Reviewer draft",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "medium" },
            instructions: "Review the draft.",
          },
          null,
          2,
        ),
      );
      sourceEditHarness.writeFile(
        joinSourceEditPathSegments(
          sourceEditHarness.workflowsSourceRoot,
          "prompts",
          "reviewChecklist.mdx",
        ),
        "# Draft checklist\n",
      );
      sourceEditHarness.writeFile(
        joinSourceEditPathSegments(
          sourceEditHarness.workflowsSourceRoot,
          "components",
          "summary.ts",
        ),
        "export const summary = 'draft';\n",
      );
      const seededTsxComponentPath = joinSourceEditPathSegments(
        sourceEditHarness.workflowsSourceRoot,
        "components",
        "visualCard.tsx",
      );
      sourceEditHarness.writeFile(seededTsxComponentPath, "export const visualCard = <Card />;\n");
      sourceEditHarness.writeFile(
        joinSourceEditPathSegments(
          sourceEditHarness.workflowsSourceRoot,
          "workflows",
          "reviewFlow.tsx",
        ),
        "export const reviewFlow = <Draft />;\n",
      );

      const result = yield* Effect.gen(function* () {
        const extensions = yield* Extensions;
        const agent = yield* extensions.sources.openEditSession({
          sourceKind: "workflow-agent",
          sourceId: "reviewerAgent",
        });
        const prompt = yield* extensions.sources.openEditSession({
          sourceKind: "workflow-prompt",
          sourceId: "reviewChecklist",
        });
        const component = yield* extensions.sources.openEditSession({
          sourceKind: "workflow-component",
          sourceId: "summary",
        });
        const tsxComponent = yield* extensions.sources.openEditSession({
          sourceKind: "workflow-component",
          sourceId: "visualCard",
        });
        const workflow = yield* extensions.sources.openEditSession({
          sourceKind: "workflow-workflow",
          sourceId: "reviewFlow",
        });
        const stale = yield* extensions.sources.saveEditSession({
          sourceKind: "workflow-prompt",
          sourceId: "reviewChecklist",
          expectedSourceVersion: "sha256:not-current",
          text: "# Ignored\n",
          saveMode: "compare-and-swap",
        });
        const savedAgent = yield* extensions.sources.saveEditSession({
          sourceKind: "workflow-agent",
          sourceId: "reviewerAgent",
          expectedSourceVersion: agent.sourceVersion,
          text: JSON.stringify(
            {
              id: "reviewerAgent",
              label: "Reviewer",
              provider: "openai",
              model: "gpt-5.4",
              reasoning: { effort: "high" },
              instructions: "Review the implementation.",
            },
            null,
            2,
          ),
          saveMode: "compare-and-swap",
        });
        const savedPrompt = yield* extensions.sources.saveEditSession({
          sourceKind: "workflow-prompt",
          sourceId: "reviewChecklist",
          expectedSourceVersion: prompt.sourceVersion,
          text: "# Review checklist\n",
          saveMode: "compare-and-swap",
        });
        const savedComponent = yield* extensions.sources.saveEditSession({
          sourceKind: "workflow-component",
          sourceId: "summary",
          expectedSourceVersion: component.sourceVersion,
          text: "export const summary = 'ok';\n",
          saveMode: "compare-and-swap",
        });
        const savedTsxComponent = yield* extensions.sources.saveEditSession({
          sourceKind: "workflow-component",
          sourceId: "visualCard",
          expectedSourceVersion: tsxComponent.sourceVersion,
          text: 'export const visualCard = <Card state="ready" />;\n',
          saveMode: "compare-and-swap",
        });
        const savedWorkflow = yield* extensions.sources.saveEditSession({
          sourceKind: "workflow-workflow",
          sourceId: "reviewFlow",
          expectedSourceVersion: workflow.sourceVersion,
          text: "export const reviewFlow = <Task />;\n",
          saveMode: "compare-and-swap",
        });
        return {
          agent,
          prompt,
          component,
          tsxComponent,
          workflow,
          stale,
          savedAgent,
          savedPrompt,
          savedComponent,
          savedTsxComponent,
          savedWorkflow,
        };
      }).pipe(Effect.provide(sourceEditHarness.layer));

      assert.strictEqual(
        result.agent.text,
        JSON.stringify(
          {
            id: "reviewerAgent",
            label: "Reviewer draft",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "medium" },
            instructions: "Review the draft.",
          },
          null,
          2,
        ),
      );
      assert.strictEqual(
        result.agent.path,
        joinSourceEditPathSegments(
          sourceEditHarness.workflowsSourceRoot,
          "agents",
          "reviewerAgent.agent.json",
        ) as AbsolutePath,
      );
      assert.strictEqual(
        result.prompt.path,
        joinSourceEditPathSegments(
          sourceEditHarness.workflowsSourceRoot,
          "prompts",
          "reviewChecklist.mdx",
        ) as AbsolutePath,
      );
      assert.strictEqual(
        result.component.path,
        joinSourceEditPathSegments(
          sourceEditHarness.workflowsSourceRoot,
          "components",
          "summary.ts",
        ) as AbsolutePath,
      );
      assert.strictEqual(result.tsxComponent.path, seededTsxComponentPath);
      assert.strictEqual(
        result.workflow.path,
        joinSourceEditPathSegments(
          sourceEditHarness.workflowsSourceRoot,
          "workflows",
          "reviewFlow.tsx",
        ) as AbsolutePath,
      );
      assert.strictEqual(result.stale.status, "stale");
      assert.strictEqual(result.savedAgent.status, "saved");
      assert.strictEqual(result.savedPrompt.status, "saved");
      assert.strictEqual(result.savedComponent.status, "saved");
      assert.strictEqual(result.savedTsxComponent.status, "saved");
      assert.strictEqual(result.savedWorkflow.status, "saved");
      assert.strictEqual(sourceEditHarness.readFile(result.prompt.path), "# Review checklist\n");
      assert.strictEqual(
        sourceEditHarness.readFile(result.component.path),
        "export const summary = 'ok';\n",
      );
      assert.strictEqual(
        sourceEditHarness.readFile(result.tsxComponent.path),
        'export const visualCard = <Card state="ready" />;\n',
      );
      assert.strictEqual(
        sourceEditHarness.readFile(result.workflow.path),
        "export const reviewFlow = <Task />;\n",
      );
    }),
  );

  it.effect("creates, duplicates, and deletes canonical workflow-agent sources", () =>
    Effect.gen(function* () {
      const sourceEditHarness = makeSourceEditHarness();
      sourceEditHarness.writeFile(
        joinSourceEditPathSegments(
          sourceEditHarness.extensionsRoot,
          "sources",
          "user",
          "custom-tools",
          "manifest.json",
        ),
        JSON.stringify({
          schemaVersion: 1,
          id: "custom-tools",
          interface: "svvyx",
          typescriptApiEnabled: true,
          workflowTaskAgentReferenceExportEnabled: true,
        }),
      );
      sourceEditHarness.writeFile(
        joinSourceEditPathSegments(
          sourceEditHarness.extensionsRoot,
          "sources",
          "user",
          "Malformed_Unreferenced",
          "manifest.json",
        ),
        "not json",
      );
      const reviewerPath = joinSourceEditPathSegments(
        sourceEditHarness.workflowsSourceRoot,
        "agents",
        "reviewerAgent.agent.json",
      );
      sourceEditHarness.writeFile(
        reviewerPath,
        `${JSON.stringify(
          {
            id: "reviewerAgent",
            label: "Reviewer",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "high" },
            instructions: "Review the implementation.",
            overrides: { git: "loaded", "custom-tools": "available" },
            extensionOrder: ["custom-tools", "git"],
          },
          null,
          2,
        )}\n`,
      );

      const result = yield* Effect.gen(function* () {
        const extensions = yield* Extensions;
        const created = yield* extensions.sources.createWorkflowAgent({
          draft: {
            exportName: "strictReviewer" as WorkflowAgentSourceExportName,
            displayName: "  Strict reviewer  ",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "high" },
            instructionText: "Review strictly.",
            extensionUsageOverrides: [
              { extensionId: "git" as ExtensionId, usage: "loaded" },
              { extensionId: "custom-tools" as ExtensionId, usage: "available" },
            ],
            extensionOrder: ["custom-tools" as ExtensionId, "git" as ExtensionId],
          },
          sourceOwner: "agents-pane",
        });
        const duplicated = yield* extensions.sources.duplicateWorkflowAgent({
          sourceId: "reviewerAgent" as WorkflowAgentSourceExportName,
          draftPatch: {
            exportName: "reviewerCopy" as WorkflowAgentSourceExportName,
            displayName: "  Reviewer copy  ",
            instructionText: "Review the copied task.",
          },
          sourceOwner: "headless",
        });
        const deleted = yield* extensions.sources.deleteWorkflowAgent({
          sourceId: "reviewerCopy" as WorkflowAgentSourceExportName,
          expectedSourceVersion: duplicated.session.sourceVersion,
          sourceOwner: "agents-pane",
        });
        return { created, duplicated, deleted };
      }).pipe(Effect.provide(sourceEditHarness.layer));

      assert.strictEqual(result.created.status, "created");
      assert.strictEqual(result.created.fileWriteReceipt.previousExists, false);
      assert.deepStrictEqual(JSON.parse(result.created.session.text), {
        id: "strictReviewer",
        label: "Strict reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "high" },
        instructions: "Review strictly.",
        overrides: { git: "loaded", "custom-tools": "available" },
        extensionOrder: ["custom-tools", "git"],
      });
      assert.deepStrictEqual(JSON.parse(result.duplicated.session.text), {
        id: "reviewerCopy",
        label: "Reviewer copy",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "high" },
        instructions: "Review the copied task.",
        overrides: { git: "loaded", "custom-tools": "available" },
        extensionOrder: ["custom-tools", "git"],
      });
      assert.strictEqual(result.deleted.status, "deleted");
      assert.strictEqual(sourceEditHarness.readFile(result.deleted.deletedPath), null);
      assert.strictEqual(sourceEditHarness.readFile(reviewerPath) !== null, true);
    }),
  );

  it.effect("rejects unsafe workflow-agent source lifecycle operations", () =>
    Effect.gen(function* () {
      const sourceEditHarness = makeSourceEditHarness();
      const userManifestPath = joinSourceEditPathSegments(
        sourceEditHarness.extensionsRoot,
        "sources",
        "user",
        "custom-tools",
        "manifest.json",
      );
      sourceEditHarness.writeFile(
        userManifestPath,
        JSON.stringify({
          schemaVersion: 1,
          id: "custom-tools",
          interface: "svvyx",
          typescriptApiEnabled: true,
          workflowTaskAgentReferenceExportEnabled: true,
        }),
      );
      const existingPath = joinSourceEditPathSegments(
        sourceEditHarness.workflowsSourceRoot,
        "agents",
        "existingAgent.agent.json",
      );
      sourceEditHarness.writeFile(
        existingPath,
        `${JSON.stringify({
          id: "existingAgent",
          label: "Existing",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "medium" },
          instructions: "Existing source.",
        })}\n`,
      );
      const staleReferencePath = joinSourceEditPathSegments(
        sourceEditHarness.workflowsSourceRoot,
        "agents",
        "staleReferenceAgent.agent.json",
      );
      sourceEditHarness.writeFile(
        staleReferencePath,
        `${JSON.stringify({
          id: "staleReferenceAgent",
          label: "Stale reference",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "medium" },
          instructions: "Uses a removed extension.",
          overrides: { "removed-extension": "loaded" },
        })}\n`,
      );

      const errors = yield* Effect.gen(function* () {
        const extensions = yield* Extensions;
        const opened = yield* extensions.sources.openEditSession({
          sourceKind: "workflow-agent",
          sourceId: "existingAgent",
        });
        return yield* Effect.all([
          extensions.sources
            .createWorkflowAgent({
              draft: {
                exportName: "unknownExtensionAgent" as WorkflowAgentSourceExportName,
                displayName: "Unknown extension",
                provider: "openai",
                model: "gpt-5.4",
                reasoning: { effort: "medium" },
                extensionUsageOverrides: [
                  { extensionId: "missing-extension" as ExtensionId, usage: "loaded" },
                ],
              },
              sourceOwner: "agents-pane",
            })
            .pipe(Effect.flip),
          extensions.sources
            .createWorkflowAgent({
              draft: {
                exportName: "blankLabelAgent" as WorkflowAgentSourceExportName,
                displayName: "   ",
                provider: "openai",
                model: "gpt-5.4",
                reasoning: { effort: "medium" },
              },
              sourceOwner: "agents-pane",
            })
            .pipe(Effect.flip),
          extensions.sources
            .createWorkflowAgent({
              draft: {
                exportName: "reviewerAgent" as WorkflowAgentSourceExportName,
                displayName: "Reserved reviewer",
                provider: "openai",
                model: "gpt-5.4",
                reasoning: { effort: "medium" },
              },
              sourceOwner: "agents-pane",
            })
            .pipe(Effect.flip),
          extensions.sources
            .duplicateWorkflowAgent({
              sourceId: "existingAgent" as WorkflowAgentSourceExportName,
              draftPatch: {
                exportName: "existingAgent" as WorkflowAgentSourceExportName,
              },
              sourceOwner: "headless",
            })
            .pipe(Effect.flip),
          extensions.sources
            .duplicateWorkflowAgent({
              sourceId: "existingAgent" as WorkflowAgentSourceExportName,
              draftPatch: {
                exportName: "blankDuplicateLabel" as WorkflowAgentSourceExportName,
                displayName: "   ",
              },
              sourceOwner: "headless",
            })
            .pipe(Effect.flip),
          extensions.sources
            .duplicateWorkflowAgent({
              sourceId: "staleReferenceAgent" as WorkflowAgentSourceExportName,
              draftPatch: {
                exportName: "staleReferenceCopy" as WorkflowAgentSourceExportName,
              },
              sourceOwner: "headless",
            })
            .pipe(Effect.flip),
          extensions.sources
            .saveEditSession({
              sourceKind: "workflow-agent",
              sourceId: "existingAgent",
              expectedSourceVersion: opened.sourceVersion,
              text: `${JSON.stringify({
                id: "existingAgent",
                label: "Existing",
                provider: "openai",
                model: "gpt-5.4",
                reasoning: { effort: "medium" },
                instructions: "Existing source.",
                overrides: { "missing-extension": "loaded" },
              })}\n`,
              saveMode: "compare-and-swap",
            })
            .pipe(Effect.flip),
          extensions.sources
            .deleteWorkflowAgent({
              sourceId: "existingAgent" as WorkflowAgentSourceExportName,
              expectedSourceVersion: `${opened.sourceVersion}:stale`,
              sourceOwner: "agents-pane",
            })
            .pipe(Effect.flip),
          extensions.sources
            .deleteWorkflowAgent({
              sourceId: "reviewerAgent" as WorkflowAgentSourceExportName,
              expectedSourceVersion: "sha256:any",
              sourceOwner: "agents-pane",
            })
            .pipe(Effect.flip),
        ]);
      }).pipe(Effect.provide(sourceEditHarness.layer));

      for (const error of errors) {
        assertExtensionError(error, {
          _tag: "ExtensionError",
          reason: "invalid-input",
        });
      }
      assert.strictEqual(sourceEditHarness.readFile(existingPath) !== null, true);
    }),
  );

  it.effect("does not clobber a workflow-agent source created during publication", () =>
    Effect.gen(function* () {
      const sourceEditHarness = makeSourceEditHarness({
        publishRaceContents: "externally-created\n",
      });
      const targetPath = joinSourceEditPathSegments(
        sourceEditHarness.workflowsSourceRoot,
        "agents",
        "racingAgent.agent.json",
      );

      const error = yield* Effect.gen(function* () {
        const extensions = yield* Extensions;
        return yield* extensions.sources
          .createWorkflowAgent({
            draft: {
              exportName: "racingAgent" as WorkflowAgentSourceExportName,
              displayName: "Racing agent",
              provider: "openai",
              model: "gpt-5.4",
              reasoning: { effort: "medium" },
            },
            sourceOwner: "headless",
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(sourceEditHarness.layer));

      assertExtensionError(error, {
        _tag: "ExtensionError",
        reason: "invalid-input",
      });
      assert.strictEqual(sourceEditHarness.readFile(targetPath), "externally-created\n");
    }),
  );

  it.effect("rejects missing workflow source edit sessions", () =>
    Effect.gen(function* () {
      const sourceEditHarness = makeSourceEditHarness();

      const errors = yield* Effect.gen(function* () {
        const extensions = yield* Extensions;
        return yield* Effect.all(
          [
            extensions.sources.openEditSession({
              sourceKind: "workflow-agent",
              sourceId: "missingAgent",
            }),
            extensions.sources.openEditSession({
              sourceKind: "workflow-prompt",
              sourceId: "missingPrompt",
            }),
            extensions.sources.openEditSession({
              sourceKind: "workflow-component",
              sourceId: "missingComponent",
            }),
            extensions.sources.openEditSession({
              sourceKind: "workflow-workflow",
              sourceId: "missingWorkflow",
            }),
          ].map((effect) => effect.pipe(Effect.flip)),
        );
      }).pipe(Effect.provide(sourceEditHarness.layer));

      for (const error of errors) {
        assertExtensionError(error, {
          _tag: "ExtensionError",
          operation: "extensions.sources.open-edit-session",
          reason: "not-found",
        });
      }
    }),
  );

  it.effect("resolves actor bindings and visible records through the service boundary", () =>
    Effect.gen(function* () {
      const service = yield* makeTestExtensions();

      const binding = yield* service.actorBindings.resolve({
        actor: "orchestrator",
        networkAccess: false,
      });
      const visibleRecords = yield* service.actorBindings.visibleRecords({
        actor: "orchestrator",
        loadedExtensionIds: binding.loadedExtensionIds,
        availableExtensionIds: binding.availableExtensionIds,
      });

      assert.include(binding.loadedExtensionIds, "extension-loading");
      assert.notInclude(binding.loadedExtensionIds, "web");
      assert.include(
        visibleRecords.loaded.map((record) => record.id),
        "extension-loading",
      );
    }),
  );

  it.effect("emits native tool declarations and actor-filtered command metadata", () =>
    Effect.gen(function* () {
      const service = yield* makeTestExtensions();
      const orchestratorLookup = nativeToolLookup({
        toolName: "list_extensions",
        loadedExtensionIds: ["shell", "extension-loading"],
      });

      const declarations = yield* service.nativeTools.declarations({
        actorKind: orchestratorLookup.actorKind,
        actorBinding: orchestratorLookup.actorBinding,
        requestInputVariant: "nonblocking",
      });
      const metadata = yield* service.nativeTools.metadata({
        actorKind: orchestratorLookup.actorKind,
        actorBinding: orchestratorLookup.actorBinding,
      });
      const commandMetadata = yield* service.nativeTools.metadata({
        actorKind: orchestratorLookup.actorKind,
        actorBinding: orchestratorLookup.actorBinding,
        toolName: "exec_command",
      });
      const requestInputLookup = nativeToolLookup({
        toolName: "request_user_input",
        loadedExtensionIds: ["request-user-input"],
      });
      const nonblockingRequestInput = yield* service.nativeTools.declarations({
        actorKind: requestInputLookup.actorKind,
        actorBinding: requestInputLookup.actorBinding,
        requestInputVariant: "nonblocking",
      });
      const blockingRequestInput = yield* service.nativeTools.declarations({
        actorKind: requestInputLookup.actorKind,
        actorBinding: requestInputLookup.actorBinding,
        requestInputVariant: "blocking",
      });

      assert.deepStrictEqual(
        declarations.map((declaration) => declaration.name),
        ["exec_command", "list_extensions", "load_extension", "write_stdin"],
      );
      assert.deepStrictEqual(
        metadata.map((record) => record.toolName),
        ["exec_command", "write_stdin", "list_extensions", "load_extension"],
      );
      assert.deepStrictEqual(
        {
          toolName: commandMetadata[0]?.toolName,
          extensionIds: commandMetadata[0]?.extensionIds,
        },
        {
          toolName: "exec_command",
          extensionIds: ["shell"],
        },
      );
      assert.match(nonblockingRequestInput[0]?.description ?? "", /defaults immediately/);
      assert.match(blockingRequestInput[0]?.description ?? "", /Wait for the user answers/);
      assert.notStrictEqual(
        nonblockingRequestInput[0]?.description,
        blockingRequestInput[0]?.description,
      );
    }),
  );

  it.effect("resolves native tool handlers only for loaded actor bindings", () =>
    Effect.gen(function* () {
      const service = yield* makeTestExtensions();

      const listHandler = yield* service.nativeTools.handler(
        nativeToolLookup({ toolName: "list_extensions" }),
      );
      const loadHandler = yield* service.nativeTools.handler(
        nativeToolLookup({ toolName: "load_extension" }),
      );
      const requestInputHandler = yield* service.nativeTools.handler(
        nativeToolLookup({
          toolName: "request_user_input",
          loadedExtensionIds: ["request-user-input"],
        }),
      );
      const handlerRequestInputHandler = yield* service.nativeTools.handler(
        nativeToolLookup({
          toolName: "request_user_input",
          actorKind: "handler",
          loadedExtensionIds: ["request-user-input"],
        }),
      );
      const missing = yield* service.nativeTools
        .handler(nativeToolLookup({ toolName: "missing_tool" }))
        .pipe(Effect.flip);
      const availableButUnloaded = yield* service.nativeTools
        .handler(
          nativeToolLookup({
            toolName: "request_user_input",
            loadedExtensionIds: ["extension-loading"],
            availableExtensionIds: ["request-user-input"],
          }),
        )
        .pipe(Effect.flip);
      const wrongActor = yield* service.nativeTools
        .handler(
          nativeToolLookup({
            toolName: "thread_start",
            actorKind: "handler",
            loadedExtensionIds: ["thread-orchestration"],
          }),
        )
        .pipe(Effect.flip);
      const declaredHandlerTool = yield* service.nativeTools
        .handler(
          nativeToolLookup({
            toolName: "thread_report",
            actorKind: "handler",
            loadedExtensionIds: ["thread-handling"],
          }),
        )
        .pipe(Effect.flip);
      const declaredOrchestratorTool = yield* service.nativeTools
        .handler(
          nativeToolLookup({
            toolName: "thread_list",
            loadedExtensionIds: ["thread-orchestration"],
          }),
        )
        .pipe(Effect.flip);
      const declaredExecuteTypescriptTool = yield* service.nativeTools
        .handler(
          nativeToolLookup({
            toolName: "execute_typescript",
            loadedExtensionIds: ["execute-typescript"],
          }),
        )
        .pipe(Effect.flip);

      assert.strictEqual(typeof listHandler.invoke, "function");
      assert.strictEqual(typeof loadHandler.invoke, "function");
      assert.strictEqual(typeof requestInputHandler.invoke, "function");
      assert.strictEqual(typeof handlerRequestInputHandler.invoke, "function");
      assertExtensionError(missing, {
        _tag: "ExtensionError",
        operation: "extensions.nativeTools.handler",
        reason: "not-found",
        message: "Native tool handler does not exist: missing_tool",
      });
      assertExtensionError(availableButUnloaded, {
        _tag: "ExtensionError",
        extensionId: "request-user-input",
        operation: "extensions.nativeTools.handler",
        reason: "not-loaded",
        message: "Native tool extension is not loaded for this actor: request_user_input",
      });
      assertExtensionError(wrongActor, {
        _tag: "ExtensionError",
        operation: "extensions.nativeTools.handler",
        reason: "not-found",
        message: "Native tool is not loaded for actor handler: thread_start",
      });
      assertExtensionError(declaredHandlerTool, {
        _tag: "ExtensionError",
        extensionId: "thread-handling",
        operation: "extensions.nativeTools.handler",
        reason: "unsupported-operation",
        message:
          "Native tool handler is declared but not implemented in @svvy/extensions: thread_report",
      });
      assertExtensionError(declaredOrchestratorTool, {
        _tag: "ExtensionError",
        extensionId: "thread-orchestration",
        operation: "extensions.nativeTools.handler",
        reason: "unsupported-operation",
        message:
          "Native tool handler is declared but not implemented in @svvy/extensions: thread_list",
      });
      assertExtensionError(declaredExecuteTypescriptTool, {
        _tag: "ExtensionError",
        extensionId: "execute-typescript",
        operation: "extensions.nativeTools.handler",
        reason: "unsupported-operation",
        message:
          "Native tool handler is declared but not implemented in @svvy/extensions: execute_typescript",
      });
    }),
  );

  it.effect("invokes the list_extensions handler through the service boundary", () =>
    Effect.gen(function* () {
      const service = yield* makeTestExtensions();
      const handler = yield* service.nativeTools.handler(
        nativeToolLookup({ toolName: "list_extensions" }),
      );
      const context = {
        workspaceSessionId: "wsess_extensions_service_list_01" as WorkspaceSessionId,
        turnId: "turn_extensions_service_list_01" as TurnId,
        surfacePiSessionId: "pi_extensions_service_list_01" as SurfacePiSessionId,
        surfaceKind: "orchestrator",
        defaultEpisodeKind: "analysis",
        rootThreadId: null,
        rootEpisodeKind: "analysis",
        sessionWaitApplied: false,
        threadWasTerminalAtStart: false,
        loadedExtensionIds: ["shell"],
        availableExtensionIds: ["smithers"],
        generatedAgentContextFingerprint: "fingerprint",
        generatedAgentContextRevision: "revision",
      } satisfies PromptExecutionContext;

      const result = yield* handler.invoke({
        toolCallId: "tool_call_extensions_service_list_01" as ToolCallId,
        toolName: "list_extensions",
        arguments: {
          schemaId: "list_extensions.input",
          value: {},
        },
        context,
        actorBinding: {
          loadedExtensionIds: ["shell"],
          availableExtensionIds: ["smithers"],
        },
        command: {
          commandId: "command_extensions_service_list_01" as CommandId,
          target: {
            workspaceSessionId: context.workspaceSessionId,
            surface: "orchestrator",
            surfacePiSessionId: context.surfacePiSessionId,
          },
          turnId: context.turnId,
          approvalMode: "auto-review",
          sandbox: { snapshot: {} },
          cwd: "/tmp/svvy-extensions-service-list",
          baseEnv: {},
        },
      });

      assert.deepStrictEqual(result.result.content?.[0], {
        type: "text",
        text: "Loaded extensions: shell\nAvailable extensions: smithers",
      });
      assert.deepStrictEqual(result.result.details, {
        status: "succeeded",
        summary: "Loaded extensions: shell\nAvailable extensions: smithers",
        commandFacts: {
          loadedExtensionIds: ["shell"],
          availableExtensionIds: ["smithers"],
        },
      });
    }),
  );

  it.effect(
    "refreshes generated @svvyx/extensions package files through the service boundary",
    () =>
      Effect.gen(function* () {
        const writtenFiles = new Map<string, string>();
        const generatedPackagePath = "/generated/package";
        const service = yield* provideGeneratedPackagePlatform(makeExtensions(), writtenFiles, {
          extensionsPackageRoot: generatedPackagePath as AbsolutePath,
        });

        const result = yield* service.generatedPackages.refresh({
          packages: ["@svvyx/extensions"],
        });

        assert.strictEqual(result.packages.length, 1);
        const extensionsPackage = result.packages[0];
        assert.ok(extensionsPackage);
        assert.match(extensionsPackage.sourceFingerprint ?? "", /^svvy-fnv64-v1:[0-9a-f]{16}$/);
        assert.match(extensionsPackage.outputFingerprint ?? "", /^svvy-fnv64-v1:[0-9a-f]{16}$/);
        assert.deepStrictEqual(
          {
            packageName: extensionsPackage.packageName,
            action: extensionsPackage.action,
            manifestPath: extensionsPackage.manifestPath,
            dependencies: extensionsPackage.dependencies,
            generatedFiles: extensionsPackage.generatedFiles,
          },
          {
            packageName: "@svvyx/extensions",
            action: "written",
            manifestPath: "/generated/package/.svvy-generated-package.json" as AbsolutePath,
            dependencies: [],
            generatedFiles: [
              {
                relativePath: "package.json",
                path: "/generated/package/package.json" as AbsolutePath,
              },
              {
                relativePath: "index.ts",
                path: "/generated/package/index.ts" as AbsolutePath,
              },
              {
                relativePath: ".svvy-generated-package.json",
                path: "/generated/package/.svvy-generated-package.json" as AbsolutePath,
              },
            ],
          },
        );
        assert.match(
          result.packages[0]?.buildId ?? "",
          /^@svvyx\/extensions:svvy-fnv64-v1:[0-9a-f]{16}$/,
        );
        assert.deepStrictEqual(
          result.packages.map(({ packageName, action }) => ({ packageName, action })),
          [
            {
              packageName: "@svvyx/extensions",
              action: "written",
            },
          ],
        );
        assert.strictEqual(Object.hasOwn(result, "workspaceLinks"), false);
        assert.deepStrictEqual(
          JSON.parse(writtenFiles.get("/generated/package/package.json") ?? ""),
          {
            name: "@svvyx/extensions",
            type: "module",
            exports: {
              ".": "./index.ts",
            },
          },
        );
        const index = writtenFiles.get("/generated/package/index.ts") ?? "";
        assert.include(index, "export const Extensions = {");
        assert.include(index, '"git": {"id":"git"}');
        assert.notInclude(index, ".run");
        assert.notInclude(index, "Context.Service");
        const extensionsManifest = JSON.parse(
          writtenFiles.get("/generated/package/.svvy-generated-package.json") ?? "",
        );
        assert.strictEqual(typeof extensionsManifest.createdAt, "string");
        assert.deepStrictEqual(
          {
            schemaVersion: extensionsManifest.schemaVersion,
            packageName: extensionsManifest.packageName,
            buildId: extensionsManifest.buildId,
            sourceFingerprint: extensionsManifest.sourceFingerprint,
            outputFingerprint: extensionsManifest.outputFingerprint,
            dependencies: extensionsManifest.dependencies,
            extensionIds: extensionsManifest.extensionIds,
            generatedFiles: extensionsManifest.generatedFiles,
          },
          {
            schemaVersion: 1,
            packageName: "@svvyx/extensions",
            buildId: result.packages[0]?.buildId,
            sourceFingerprint: result.packages[0]?.sourceFingerprint,
            outputFingerprint: result.packages[0]?.outputFingerprint,
            dependencies: [],
            extensionIds: [
              "apply-patch",
              "artifacts",
              "base-common",
              "base-workflow-task",
              "cx",
              "execute-typescript",
              "extension-loading",
              "git",
              "github",
              "shell",
              "web",
            ],
            generatedFiles: ["package.json", "index.ts"],
          },
        );
      }),
  );

  it.effect("repairs interrupted generated package promotion before refresh", () =>
    Effect.gen(function* () {
      const writtenFiles = new Map<string, string>([
        ["/generated/package.previous/package.json", "old package"],
        ["/generated/package.previous/index.ts", "old index"],
      ]);
      const service = yield* provideGeneratedPackagePlatform(makeExtensions(), writtenFiles, {
        extensionsPackageRoot: "/generated/package" as AbsolutePath,
      });

      yield* service.generatedPackages.refresh({
        packages: ["@svvyx/extensions"],
      });

      assert.strictEqual(writtenFiles.has("/generated/package.previous/package.json"), false);
      assert.strictEqual(writtenFiles.has("/generated/package.previous/index.ts"), false);
      assert.include(
        writtenFiles.get("/generated/package/package.json") ?? "",
        "@svvyx/extensions",
      );
    }),
  );

  it.effect("rejects unknown generated package refresh inputs at the service boundary", () =>
    Effect.gen(function* () {
      const service = yield* provideGeneratedPackagePlatform(makeExtensions(), new Map());

      const error = yield* service.generatedPackages
        .refresh({
          packages: ["@svvyx/unknown"],
        } as never)
        .pipe(Effect.flip);

      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.operation, "extensions.generated-packages.refresh");
        assert.strictEqual(error.reason, "invalid-input");
        assert.match(error.message, /Unknown generated package: @svvyx\/unknown/);
      }
    }),
  );

  it.effect("refreshes generated @svvyx/workflows package files through the service boundary", () =>
    Effect.gen(function* () {
      const writtenFiles = new Map<string, string>();
      const sourceFiles = new Map<string, string>([
        [
          "/workflows/agents/reviewerAgent.agent.json",
          JSON.stringify(
            {
              id: "reviewerAgent",
              label: "Reviewer",
              provider: "openai",
              model: "gpt-5.4",
              reasoning: { effort: "medium" },
              instructions: "Review the implementation.",
              overrides: { git: "loaded", "apply-patch": "available" },
            },
            null,
            2,
          ),
        ],
        ["/workflows/prompts/reviewChecklist.mdx", "# Review checklist\n"],
        ["/workflows/components/summary.ts", "export const summary = 'ok';\n"],
        ["/workflows/workflows/reviewFlow.tsx", "export const reviewFlow = <Task />;\n"],
      ]);
      const service = yield* provideGeneratedPackagePlatform(
        makeExtensions(),
        writtenFiles,
        {
          extensionsPackageRoot: "/generated/extensions-package" as AbsolutePath,
          workflowsPackageRoot: "/generated/workflows-package" as AbsolutePath,
          workflowsSourceRoot: "/workflows" as AbsolutePath,
        },
        sourceFiles,
      );
      const result = yield* service.generatedPackages.refresh({
        packages: ["@svvyx/workflows"],
      });

      assert.deepStrictEqual(
        result.packages.map((record) => ({
          packageName: record.packageName,
          action: record.action,
          manifestPath: record.manifestPath,
        })),
        [
          {
            packageName: "@svvyx/extensions",
            action: "written",
            manifestPath:
              "/generated/extensions-package/.svvy-generated-package.json" as AbsolutePath,
          },
          {
            packageName: "@svvyx/workflows",
            action: "written",
            manifestPath:
              "/generated/workflows-package/.svvy-generated-package.json" as AbsolutePath,
          },
        ],
      );
      assert.match(result.packages[1]?.sourceFingerprint ?? "", /^svvy-fnv64-v1:[0-9a-f]{16}$/);
      assert.match(result.packages[1]?.outputFingerprint ?? "", /^svvy-fnv64-v1:[0-9a-f]{16}$/);
      assert.strictEqual(Object.hasOwn(result, "workspaceLinks"), false);
      assert.deepStrictEqual(result.workflowsExports as unknown, [
        {
          kind: "agent",
          namespace: "Agents",
          exportName: "reviewerAgent",
          qualifiedName: "Agents.reviewerAgent",
          sourcePath: "/workflows/agents/reviewerAgent.agent.json",
          generatedPath: "/generated/workflows-package/agents/reviewerAgent.ts",
          generatedCode: writtenFiles.get("/generated/workflows-package/agents/reviewerAgent.ts"),
          agentParameters: {
            id: "reviewerAgent",
            label: "Reviewer",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "medium" },
            instructions: "Review the implementation.",
            overrides: { git: "loaded", "apply-patch": "available" },
          },
          workflowAgentId: "reviewerAgent",
        },
        {
          kind: "component",
          namespace: "Components",
          exportName: "summary",
          qualifiedName: "Components.summary",
          sourcePath: "/workflows/components/summary.ts",
          generatedPath: "/generated/workflows-package/components/summary.ts",
          generatedCode: writtenFiles.get("/generated/workflows-package/components/summary.ts"),
          agentParameters: null,
          workflowAgentId: null,
        },
        {
          kind: "prompt",
          namespace: "Prompts",
          exportName: "reviewChecklist",
          qualifiedName: "Prompts.reviewChecklist",
          sourcePath: "/workflows/prompts/reviewChecklist.mdx",
          generatedPath: "/generated/workflows-package/prompts/reviewChecklist.ts",
          generatedCode: writtenFiles.get(
            "/generated/workflows-package/prompts/reviewChecklist.ts",
          ),
          agentParameters: null,
          workflowAgentId: null,
        },
        {
          kind: "workflow",
          namespace: "Workflows",
          exportName: "reviewFlow",
          qualifiedName: "Workflows.reviewFlow",
          sourcePath: "/workflows/workflows/reviewFlow.tsx",
          generatedPath: "/generated/workflows-package/workflows/reviewFlow.tsx",
          generatedCode: writtenFiles.get("/generated/workflows-package/workflows/reviewFlow.tsx"),
          agentParameters: null,
          workflowAgentId: null,
        },
      ]);
      const extensionsBuildId = result.packages[0]?.buildId;
      if (!extensionsBuildId) {
        throw new Error("expected generated extensions package build id");
      }
      assert.deepStrictEqual(result.packages[1]?.dependencies, [
        {
          specifier: "@svvy/core",
          importKind: "type-only",
          dependencyClass: "app-owned-type-contract",
          resolutionAuthority: "app-owned-type-contract",
          manifestDependency: "dev-type-dependency",
        },
        {
          specifier: "smithers-orchestrator",
          importKind: "type-only",
          dependencyClass: "workspace-authoring-external",
          resolutionAuthority: "workspace-smithers-package",
          manifestDependency: "ambient-declaration",
          version: "0.22.0",
        },
        {
          specifier: "@svvyx/extensions",
          importKind: "type-only",
          dependencyClass: "generated-package",
          resolutionAuthority: "generated-package-link",
          manifestDependency: "none-generated-package-link",
          buildId: extensionsBuildId,
        },
        {
          specifier: "@svvyx/extensions",
          importKind: "runtime",
          dependencyClass: "generated-package",
          resolutionAuthority: "generated-package-link",
          manifestDependency: "none-generated-package-link",
          buildId: extensionsBuildId,
        },
      ]);
      assert.deepStrictEqual(
        JSON.parse(writtenFiles.get("/generated/workflows-package/package.json") ?? ""),
        {
          name: "@svvyx/workflows",
          type: "module",
          exports: {
            ".": "./index.ts",
          },
          devDependencies: {
            "@svvy/core": "file:../core-type-contract-package",
          },
        },
      );
      assert.include(
        writtenFiles.get("/generated/workflows-package/smithers-orchestrator.ambient.d.ts"),
        'declare module "smithers-orchestrator"',
      );
      assert.match(
        writtenFiles.get("/generated/workflows-package/smithers-orchestrator.ambient.d.ts") ?? "",
        /generate: \(args: unknown\) => Promise<unknown>/,
      );
      assert.include(
        writtenFiles.get("/generated/workflows-package/index.ts"),
        'export * as Agents from "./agents";',
      );
      assert.include(
        writtenFiles.get("/generated/workflows-package/agents/index.ts"),
        "export function defineTaskAgent",
      );
      assert.include(
        writtenFiles.get("/generated/workflows-package/agents/index.ts"),
        'operation: "runTaskAgent"',
      );
      assert.include(
        writtenFiles.get("/generated/workflows-package/agents/index.ts"),
        'readRequiredEnv("SVVY_WORKFLOW_AGENT_BRIDGE_URL")',
      );
      assert.include(
        writtenFiles.get("/generated/workflows-package/agents/reviewerAgent.ts"),
        '[Extensions["apply-patch"].id]: "available"',
      );
      assert.include(
        writtenFiles.get("/generated/workflows-package/prompts/reviewChecklist.ts"),
        "Review checklist",
      );
      const generatedScaffoldSource = [...writtenFiles.entries()]
        .filter(([path]) => path.startsWith("/generated/workflows-package/"))
        .filter(([path]) => !path.includes("/components/") && !path.includes("/workflows/"))
        .map(([path, contents]) => `${path}\n${contents}`)
        .join("\n");
      for (const forbiddenPattern of [
        /@svvy\/runtime/,
        /@svvy\/state/,
        /@svvy\/sandbox/,
        /@svvy\/pi-adapter/,
        /@svvy\/desktop/,
        /@svvy\/extensions/,
        /createRuntimeFacade/,
        /executeTypescriptFacadeDeclarations/,
        /Context\.Service/,
        /ManagedRuntime/,
        /\bLayer\b/,
        /\beffect\/Metric\b/,
        /\beffect\/Logger\b/,
        /\beffect\/Tracer\b/,
        /\beffect\/unstable\/observability\b/,
        /@effect\/opentelemetry/,
        /\bMetric\./,
        /\bLogger\./,
        /\bTracer\./,
      ]) {
        assert.strictEqual(
          forbiddenPattern.test(generatedScaffoldSource),
          false,
          `generated workflow scaffold must not match ${forbiddenPattern}`,
        );
      }
      const workflowsManifest = JSON.parse(
        writtenFiles.get("/generated/workflows-package/.svvy-generated-package.json") ?? "",
      );
      assert.deepStrictEqual(
        {
          schemaVersion: workflowsManifest.schemaVersion,
          packageName: workflowsManifest.packageName,
          buildId: workflowsManifest.buildId,
          dependencies: workflowsManifest.dependencies,
        },
        {
          schemaVersion: 1,
          packageName: "@svvyx/workflows",
          buildId: result.packages[1]?.buildId,
          dependencies: result.packages[1]?.dependencies,
        },
      );
      assert.ok(Array.isArray(workflowsManifest.generatedFiles));
      for (const generatedFile of [
        "package.json",
        "index.ts",
        "agents/index.ts",
        "agents/reviewerAgent.ts",
        "prompts/reviewChecklist.ts",
      ]) {
        assert.include(workflowsManifest.generatedFiles, generatedFile);
      }
    }),
  );

  it.effect("plans generated package workspace links without applying them", () =>
    Effect.gen(function* () {
      const workflowsService = yield* provideGeneratedPackagePlatform(makeExtensions(), new Map(), {
        workflowsPackageRoot: "/generated/workflows-package" as AbsolutePath,
        workspacePackageLinks: new Map([
          [
            "workspace_extensions_service_link_01:@svvyx/workflows",
            "/repo/.smithers/node_modules/@svvyx/workflows" as AbsolutePath,
          ],
        ]),
      });
      const workflowsPlan = yield* workflowsService.generatedPackages.planWorkspaceLink({
        workspaceId: "workspace_extensions_service_link_01" as WorkspaceId,
        packageName: "@svvyx/workflows",
      });
      const extensionsService = yield* provideGeneratedPackagePlatform(
        makeExtensions(),
        new Map(),
        {
          extensionsPackageRoot: "/generated/extensions-package" as AbsolutePath,
          workspacePackageLinks: new Map([
            [
              "workspace_extensions_service_link_01:@svvyx/extensions",
              "/repo/.smithers/node_modules/@svvyx/extensions" as AbsolutePath,
            ],
          ]),
        },
      );
      const extensionsPlan = yield* extensionsService.generatedPackages.planWorkspaceLink({
        workspaceId: "workspace_extensions_service_link_01" as WorkspaceId,
        packageName: "@svvyx/extensions",
      });

      assert.deepStrictEqual(workflowsPlan, {
        workspaceId: "workspace_extensions_service_link_01" as WorkspaceId,
        packageName: "@svvyx/workflows",
        linkPath: "/repo/.smithers/node_modules/@svvyx/workflows" as AbsolutePath,
        targetPath: "/generated/workflows-package" as AbsolutePath,
        requiredParentPath: "/repo/.smithers/node_modules/@svvyx" as AbsolutePath,
        overwritePolicy: "symlink-only",
      });
      assert.deepStrictEqual(extensionsPlan, {
        workspaceId: "workspace_extensions_service_link_01" as WorkspaceId,
        packageName: "@svvyx/extensions",
        linkPath: "/repo/.smithers/node_modules/@svvyx/extensions" as AbsolutePath,
        targetPath: "/generated/extensions-package" as AbsolutePath,
        requiredParentPath: "/repo/.smithers/node_modules/@svvyx" as AbsolutePath,
        overwritePolicy: "symlink-only",
      });
    }),
  );

  it.effect("repairs interrupted generated package promotion before workspace-link planning", () =>
    Effect.gen(function* () {
      const writtenFiles = new Map<string, string>([
        ["/generated/extensions-package.previous/package.json", "old package"],
        ["/generated/extensions-package.previous/index.ts", "old index"],
      ]);
      const service = yield* provideGeneratedPackagePlatform(makeExtensions(), writtenFiles, {
        extensionsPackageRoot: "/generated/extensions-package" as AbsolutePath,
        workspacePackageLinks: new Map([
          [
            "workspace_extensions_service_link_01:@svvyx/extensions",
            "/repo/.smithers/node_modules/@svvyx/extensions" as AbsolutePath,
          ],
        ]),
      });

      const plan = yield* service.generatedPackages.planWorkspaceLink({
        workspaceId: "workspace_extensions_service_link_01" as WorkspaceId,
        packageName: "@svvyx/extensions",
      });

      assert.strictEqual(plan.targetPath, "/generated/extensions-package");
      assert.strictEqual(
        writtenFiles.get("/generated/extensions-package/package.json"),
        "old package",
      );
      assert.strictEqual(writtenFiles.get("/generated/extensions-package/index.ts"), "old index");
      assert.strictEqual(
        writtenFiles.has("/generated/extensions-package.previous/package.json"),
        false,
      );
    }),
  );

  it.effect("rejects unknown generated package workspace link inputs at the service boundary", () =>
    Effect.gen(function* () {
      const service = yield* provideGeneratedPackagePlatform(makeExtensions(), new Map());

      const error = yield* service.generatedPackages
        .planWorkspaceLink({
          workspaceId: "workspace_extensions_service_link_01" as WorkspaceId,
          packageName: "@svvyx/unknown",
        } as never)
        .pipe(Effect.flip);

      assert.strictEqual(error._tag, "ExtensionError");
      if (error._tag === "ExtensionError") {
        assert.strictEqual(error.operation, "extensions.generated-packages.plan-workspace-link");
        assert.strictEqual(error.reason, "invalid-input");
        assert.match(error.message, /Unknown generated package: @svvyx\/unknown/);
      }
    }),
  );

  it.effect("provides the service through an Effect layer", () =>
    Effect.gen(function* () {
      const toolName = yield* provideGeneratedPackagePlatform(
        Effect.gen(function* () {
          const extensions: ExtensionsService = yield* Extensions;
          const metadata = yield* extensions.nativeTools.metadata({
            actorKind: "handler",
            actorBinding: {
              actorKind: "handler",
              loadedExtensionIds: ["thread-handling" as ExtensionId],
              availableExtensionIds: [],
              unavailableExtensionIds: [],
              instructionOrder: ["thread-handling" as ExtensionId],
              source: "surface-binding",
            },
            toolName: "thread_report",
          });
          return metadata[0]?.toolName;
        }).pipe(Effect.provide(layer)),
      );

      assert.strictEqual(toolName, "thread_report");
    }),
  );
});

function assertExtensionError(
  error: unknown,
  expected: {
    readonly _tag: "ExtensionError";
    readonly extensionId?: string;
    readonly operation?: string;
    readonly reason: string;
    readonly message?: string;
  },
) {
  const extensionError = error as ExtensionError;
  assert.deepStrictEqual(
    {
      _tag: extensionError._tag,
      ...(expected.extensionId === undefined ? {} : { extensionId: extensionError.extensionId }),
      ...(expected.operation === undefined ? {} : { operation: extensionError.operation }),
      reason: extensionError.reason,
      ...(expected.message === undefined ? {} : { message: extensionError.message }),
    },
    expected,
  );
}

function provideGeneratedPackagePlatform<A, E>(
  effect: Effect.Effect<
    A,
    E,
    | GeneratedExtensionExportDiscoveryServices
    | Crypto.Crypto
    | ExtensionSourceRootsPort
    | PackagedExtensionTemplatesPort
    | GeneratedPackageRootPort
    | WorkspaceSourceLinkPort
  >,
  writtenFiles: Map<string, string> = new Map(),
  roots: Partial<{
    extensionsRoot: AbsolutePath;
    extensionsPackageRoot: AbsolutePath;
    workflowsSourceRoot: AbsolutePath;
    workflowsPackageRoot: AbsolutePath;
    coreTypeContractPackageRoot: AbsolutePath;
    workspacePackageLinks: ReadonlyMap<string, AbsolutePath>;
  }> = {},
  readableFiles: Map<string, string> = new Map(),
): Effect.Effect<A, E> {
  const directories = new Set<string>([
    "/",
    "/extensions",
    "/generated",
    "/workflows",
    "/workspaces",
  ]);
  for (const path of [...readableFiles.keys(), ...writtenFiles.keys()]) {
    addDirectoryChain(directories, dirnamePath(path));
  }
  let tempCounter = 0;

  return effect.pipe(
    Effect.provideService(FileSystem.FileSystem, {
      exists: (path: string) =>
        Effect.succeed(pathExists({ path, directories, readableFiles, writtenFiles })),
      makeDirectory: (path: string) =>
        Effect.sync(() => {
          addDirectoryChain(directories, path);
        }),
      makeTempDirectory: ({ directory = "/", prefix = "tmp-" } = {}) =>
        Effect.sync(() => {
          tempCounter += 1;
          const tempPath = joinPathSegments(directory, `${prefix}${tempCounter}`);
          addDirectoryChain(directories, tempPath);
          return tempPath;
        }),
      readDirectory: (path: string) =>
        Effect.succeed(readDirectoryNames(path, readableFiles, writtenFiles)),
      readFileString: (path: string) => {
        const contents = readableFiles.get(path);
        return contents === undefined
          ? Effect.fail(new Error("No generated package discovery file."))
          : Effect.succeed(contents);
      },
      remove: (path: string) =>
        Effect.sync(() => {
          removePath({ path, directories, writtenFiles });
        }),
      rename: (fromPath: string, toPath: string) =>
        Effect.sync(() => {
          movePath({ fromPath, toPath, directories, writtenFiles });
        }),
      stat: (path: string) => Effect.succeed(statForPath(path, readableFiles, writtenFiles)),
      writeFileString: (path: string, contents: string) =>
        Effect.sync(() => {
          addDirectoryChain(directories, dirnamePath(path));
          writtenFiles.set(path, contents);
        }),
    } as unknown as FileSystem.FileSystem),
    Effect.provideService(Path.Path, {
      basename: basenamePath,
      join: joinPathSegments,
      dirname: dirnamePath,
      relative: relativePath,
    } as unknown as Path.Path),
    Effect.provideService(
      Crypto.Crypto,
      Crypto.make({
        digest: (_algorithm, data) => Effect.succeed(data),
        randomBytes: (size) => new Uint8Array(size).fill(1),
      }),
    ),
    Effect.provideService(ExtensionStatePort, {
      records: {
        readSourceFingerprint: () => Effect.succeed(null),
      },
      dependencies: {
        isApproved: () => Effect.succeed(false),
        readReadiness: () => Effect.succeed(null),
      },
    }),
    Effect.provide(
      layerExtensionSourceRootsPort({
        extensionsRoot: roots.extensionsRoot ?? ("/extensions" as AbsolutePath),
        workflowsSourceRoot: roots.workflowsSourceRoot ?? ("/workflows" as AbsolutePath),
      }),
    ),
    Effect.provide(
      layerPackagedExtensionTemplatesPort({
        builtinExtensionsRoot: "/packaged-extensions" as AbsolutePath,
      }),
    ),
    Effect.provide(
      layerGeneratedPackageRootPort({
        extensionsPackageRoot:
          roots.extensionsPackageRoot ?? ("/generated/extensions-package" as AbsolutePath),
        workflowsPackageRoot:
          roots.workflowsPackageRoot ?? ("/generated/workflows-package" as AbsolutePath),
        coreTypeContractPackageRoot:
          roots.coreTypeContractPackageRoot ??
          ("/generated/core-type-contract-package" as AbsolutePath),
      }),
    ),
    Effect.provide(
      layerWorkspaceSourceLinkPort({
        generatedPackageLinkPath: ({ workspaceId, packageName }) => {
          const linkPath = roots.workspacePackageLinks?.get(`${workspaceId}:${packageName}`);
          return linkPath
            ? Effect.succeed(linkPath)
            : Effect.succeed(
                `/workspaces/${workspaceId}/.smithers/node_modules/${packageName}` as AbsolutePath,
              );
        },
      }),
    ),
  );
}

function joinPathSegments(...segments: readonly string[]): string {
  return segments.join("/").replaceAll(/\/+/g, "/");
}

function dirnamePath(path: string): string {
  const normalized = path.replaceAll(/\/+/g, "/");
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

function basenamePath(path: string): string {
  const normalized = path.replaceAll(/\/+/g, "/");
  const parts = normalized.split("/");
  return parts.at(-1) ?? normalized;
}

function relativePath(fromPath: string, toPath: string): string {
  const fromSegments = pathSegments(fromPath);
  const toSegments = pathSegments(toPath);
  let common = 0;
  while (
    common < fromSegments.length &&
    common < toSegments.length &&
    fromSegments[common] === toSegments[common]
  ) {
    common += 1;
  }
  return [
    ...Array.from({ length: fromSegments.length - common }, () => ".."),
    ...toSegments.slice(common),
  ].join("/");
}

function pathSegments(path: string): string[] {
  return path.replaceAll(/\/+/g, "/").split("/").filter(Boolean);
}

function readDirectoryNames(
  path: string,
  readableFiles: ReadonlyMap<string, string>,
  writtenFiles: ReadonlyMap<string, string>,
): string[] {
  const prefix = `${path.replace(/\/$/, "")}/`;
  const names = new Set<string>();
  for (const filePath of [...readableFiles.keys(), ...writtenFiles.keys()]) {
    if (!filePath.startsWith(prefix)) {
      continue;
    }
    const child = filePath.slice(prefix.length).split("/")[0];
    if (child) {
      names.add(child);
    }
  }
  return [...names].toSorted();
}

function statForPath(
  path: string,
  readableFiles: ReadonlyMap<string, string>,
  writtenFiles: ReadonlyMap<string, string>,
): { type: string } {
  if (readableFiles.has(path) || writtenFiles.has(path)) {
    return { type: "File" };
  }
  const prefix = `${path.replace(/\/$/, "")}/`;
  return [...readableFiles.keys(), ...writtenFiles.keys()].some((filePath) =>
    filePath.startsWith(prefix),
  )
    ? { type: "Directory" }
    : { type: "Other" };
}

function pathExists(input: {
  path: string;
  directories: ReadonlySet<string>;
  readableFiles: ReadonlyMap<string, string>;
  writtenFiles: ReadonlyMap<string, string>;
}): boolean {
  return (
    input.directories.has(input.path) ||
    input.readableFiles.has(input.path) ||
    input.writtenFiles.has(input.path)
  );
}

function addDirectoryChain(directories: Set<string>, path: string): void {
  const normalized = path || "/";
  if (normalized === "/") {
    directories.add("/");
    return;
  }
  let current = "";
  for (const segment of normalized.split("/").filter(Boolean)) {
    current = `${current}/${segment}`;
    directories.add(current);
  }
}

function removePath(input: {
  path: string;
  directories: Set<string>;
  writtenFiles: Map<string, string>;
}): void {
  const filePaths = Array.from(input.writtenFiles.keys()).filter(
    (filePath) => filePath === input.path || filePath.startsWith(`${input.path}/`),
  );
  const directoryPaths = Array.from(input.directories).filter(
    (directoryPath) => directoryPath === input.path || directoryPath.startsWith(`${input.path}/`),
  );

  for (const filePath of filePaths) {
    input.writtenFiles.delete(filePath);
  }
  for (const directoryPath of directoryPaths) {
    input.directories.delete(directoryPath);
  }
}

function movePath(input: {
  fromPath: string;
  toPath: string;
  directories: Set<string>;
  writtenFiles: Map<string, string>;
}): void {
  const movedFiles = [...input.writtenFiles.entries()].filter(
    ([filePath]) => filePath === input.fromPath || filePath.startsWith(`${input.fromPath}/`),
  );
  const movedDirectories = [...input.directories].filter(
    (directoryPath) =>
      directoryPath === input.fromPath || directoryPath.startsWith(`${input.fromPath}/`),
  );
  if (movedFiles.length === 0 && movedDirectories.length === 0) {
    throw new Error(`Cannot rename missing path: ${input.fromPath}`);
  }
  removePath({
    path: input.toPath,
    directories: input.directories,
    writtenFiles: input.writtenFiles,
  });
  removePath({
    path: input.fromPath,
    directories: input.directories,
    writtenFiles: input.writtenFiles,
  });
  for (const directoryPath of movedDirectories) {
    input.directories.add(`${input.toPath}${directoryPath.slice(input.fromPath.length)}`);
  }
  for (const [filePath, contents] of movedFiles) {
    input.writtenFiles.set(`${input.toPath}${filePath.slice(input.fromPath.length)}`, contents);
  }
  addDirectoryChain(input.directories, dirnamePath(input.toPath));
}
