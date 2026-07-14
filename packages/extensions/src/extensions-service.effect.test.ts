import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { DEFAULT_WORKFLOW_AGENT_SOURCE_IDS, ExtensionStatePort } from "@svvy/core";
import type {
  AbsolutePath,
  BuildExtensionInput,
  CommandId,
  DefaultWorkflowAgentSourceId,
  ExtensionError,
  ExtensionId,
  ExtensionRegistryObservationResult,
  ExtensionSourceFingerprint,
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
  ExtensionSnapshotSourceRestorePlanId,
  ExtensionSnapshotId,
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
import { ExtensionCliRequirementProbePort } from "./extension-cli-requirement-probe-port";
import { ExtensionBuildProcessPort } from "./extension-build-process-port";
import {
  APP_NATIVE_SVVYX_METADATA,
  appNativeSvvyxMetadataFingerprintInput,
} from "./svvyx-build-metadata";
import { BUILTIN_EXTENSIONS, type ExtensionRecord } from "./extension-records";

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

const snapshotCaptureInput = {
  capturedAt: "2026-07-12T10:00:00.000Z",
  actorSettings: [],
  profileSettings: [],
  nonSecretEnvOverrideScopes: [],
  nonSecretEnvOverrides: [],
  secretTargets: [],
} as const;

function makeSourceEditHarness(
  harnessOptions: {
    readonly publishRaceContents?: string;
    readonly symbolicLinkPaths?: readonly string[];
    readonly unreadablePaths?: readonly string[];
    readonly failRenameToOnce?: string;
    readonly interruptRenameToOnce?: string;
    readonly buildProcess?: (
      plan: import("@svvy/core").ExtensionBuildProcessPlan,
      files: Map<string, string>,
    ) => import("@svvy/core").ExtensionBuildProcessEvidence;
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
  const symbolicLinkPaths = new Set(harnessOptions.symbolicLinkPaths ?? []);
  const directories = new Set<string>(["/", "/extensions-test", "/workflows-test"]);
  let renameFailurePending = harnessOptions.failRenameToOnce !== undefined;
  let renameInterruptionPending = harnessOptions.interruptRenameToOnce !== undefined;
  const fileSystem = {
    exists: (path: string) => Effect.succeed(files.has(path) || directories.has(path)),
    readLink: (path: string) =>
      symbolicLinkPaths.has(path)
        ? Effect.succeed("/outside")
        : Effect.fail(new Error(`Not a symbolic link: ${path}`)),
    stat: (path: string) =>
      symbolicLinkPaths.has(path)
        ? Effect.succeed({ type: "SymbolicLink" } as FileSystem.File.Info)
        : files.has(path)
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
    readFile: (path: string) =>
      files.has(path)
        ? Effect.succeed(new TextEncoder().encode(files.get(path) ?? ""))
        : Effect.die(new Error(`Missing file: ${path}`)),
    readDirectory: (path: string) =>
      Effect.succeed(sourceEditReadDirectoryNames(path, files, directories)),
    realPath: (path: string) =>
      symbolicLinkPaths.has(path) ? Effect.succeed("/outside") : Effect.succeed(path),
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
    remove: (path: string, options?: { readonly force?: boolean; readonly recursive?: boolean }) =>
      Effect.sync(() => {
        const existed = files.has(path) || directories.has(path);
        removePath({ path, directories, writtenFiles: files });
        if (!existed && !options?.force) throw new Error(`Missing file: ${path}`);
      }),
    writeFileString: (path: string, contents: string, options?: { readonly flag?: string }) =>
      Effect.sync(() => {
        if (options?.flag?.includes("x") && files.has(path)) {
          throw new Error(`File exists: ${path}`);
        }
        addSourceEditDirectoryChain(directories, sourceEditDirnamePath(path));
        files.set(path, contents);
      }),
    writeFile: (path: string, contents: Uint8Array) =>
      Effect.sync(() => {
        addSourceEditDirectoryChain(directories, sourceEditDirnamePath(path));
        files.set(path, new TextDecoder().decode(contents));
      }),
    rename: (fromPath: string, toPath: string) =>
      renameInterruptionPending && toPath === harnessOptions.interruptRenameToOnce
        ? Effect.sync(() => {
            renameInterruptionPending = false;
          }).pipe(Effect.andThen(Effect.interrupt))
        : Effect.sync(() => {
            if (renameFailurePending && toPath === harnessOptions.failRenameToOnce) {
              renameFailurePending = false;
              throw new Error(`Injected rename failure: ${toPath}`);
            }
            movePath({ fromPath, toPath, directories, writtenFiles: files });
          }),
  } as unknown as FileSystem.FileSystem;
  const pathService = {
    sep: "/",
    basename: (input: string) => input.split("/").filter(Boolean).at(-1) ?? "",
    dirname: sourceEditDirnamePath,
    join: joinSourceEditPathSegments,
    resolve: (...segments: readonly string[]) =>
      normalizeSourceEditPath(joinSourceEditPathSegments(...segments)),
    relative: (from: string, to: string) => {
      const fromParts = normalizeSourceEditPath(from).split("/").filter(Boolean);
      const toParts = normalizeSourceEditPath(to).split("/").filter(Boolean);
      while (fromParts[0] === toParts[0]) {
        fromParts.shift();
        toParts.shift();
      }
      return [...fromParts.map(() => ".."), ...toParts].join("/");
    },
    isAbsolute: (input: string) => input.startsWith("/"),
  } as unknown as Path.Path;
  const crypto = Crypto.make({
    digest: (_algorithm, data) => Effect.succeed(testDigestBytes(data)),
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
        Effect.provideService(ExtensionCliRequirementProbePort, {
          probe: () => Effect.succeed({ status: "missing" }),
        }),
        Effect.provideService(ExtensionBuildProcessPort, {
          run: (plan) =>
            Effect.succeed(
              harnessOptions.buildProcess?.(plan, files) ?? {
                status: "failed",
                stage: "validation",
              },
            ),
        }),
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

function seedPackagedBuiltinTemplates(harness: ReturnType<typeof makeSourceEditHarness>): void {
  for (const builtinRecord of BUILTIN_EXTENSIONS) {
    const builtin: ExtensionRecord = builtinRecord;
    const generatedInstructions = builtin.generatedInstructions ?? [];
    const instructionFiles = generatedInstructions.map((entry) => ({
      file: entry.output.split("/").at(-1)!,
      bypassed: false,
    }));
    harness.writeFile(
      `${harness.packagedExtensionsRoot}/${builtin.id}/manifest.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          id: builtin.id,
          interface: builtin.interface,
          title: builtin.title,
          description: builtin.description,
          typescriptApiEnabled: builtin.typescriptApiEnabled,
          instructionFiles,
          ...(generatedInstructions.length > 0 ? { generatedInstructions } : {}),
          ...(builtin.cliRequirements ? { cliRequirements: builtin.cliRequirements } : {}),
        },
        null,
        2,
      )}\n`,
    );
    harness.writeFile(
      `${harness.packagedExtensionsRoot}/${builtin.id}/instructions/minimal.mdx`,
      `packaged minimal ${builtin.id}\n`,
    );
    for (const entry of generatedInstructions) {
      harness.writeFile(
        `${harness.packagedExtensionsRoot}/${builtin.id}/${entry.script}`,
        `export const extensionId = ${JSON.stringify(builtin.id)};\n`,
      );
      harness.writeFile(
        `${harness.packagedExtensionsRoot}/${builtin.id}/${entry.output}`,
        `generated ${builtin.id}\n`,
      );
    }
  }
}

describe("@svvy/extensions Effect service", () => {
  it.effect(
    "scaffolds every missing source-backed builtin once and preserves customized sources",
    () => {
      const harness = makeSourceEditHarness();
      seedPackagedBuiltinTemplates(harness);
      const customManifest = `${JSON.stringify({
        schemaVersion: 1,
        id: "base-common",
        interface: "instructions",
        title: "Base Common",
        description: "Customized shared instructions.",
        typescriptApiEnabled: false,
        instructionFiles: [],
        customField: { preserved: true },
      })}\n`;
      const customMinimal = "customized base common bytes\n";
      harness.writeFile(
        `${harness.extensionsRoot}/sources/builtin/base-common/manifest.json`,
        customManifest,
      );
      harness.writeFile(
        `${harness.extensionsRoot}/sources/builtin/base-common/instructions/minimal.mdx`,
        customMinimal,
      );

      return Effect.gen(function* () {
        const extensions = yield* Extensions;
        const sourceBackedIds = BUILTIN_EXTENSIONS.filter(
          (builtin) => !APP_NATIVE_SVVYX_METADATA.has(builtin.id),
        ).map((builtin) => builtin.id);
        const appNativeIds = BUILTIN_EXTENSIONS.filter((builtin) =>
          APP_NATIVE_SVVYX_METADATA.has(builtin.id),
        ).map((builtin) => builtin.id);
        const first = yield* extensions.builtin.scaffoldMissing();

        assert.deepStrictEqual(
          first.materializedExtensionIds.map(String),
          sourceBackedIds.filter((extensionId) => extensionId !== "base-common"),
        );
        assert.deepStrictEqual(first.existingExtensionIds.map(String), ["base-common"]);
        assert.deepStrictEqual(first.appNativeExtensionIds.map(String), appNativeIds);
        for (const extensionId of sourceBackedIds) {
          assert.isNotNull(
            harness.readFile(
              `${harness.extensionsRoot}/sources/builtin/${extensionId}/manifest.json`,
            ),
          );
        }
        for (const extensionId of appNativeIds) {
          assert.isNull(
            harness.readFile(
              `${harness.extensionsRoot}/sources/builtin/${extensionId}/manifest.json`,
            ),
          );
        }
        assert.strictEqual(
          harness.readFile(`${harness.extensionsRoot}/sources/builtin/base-common/manifest.json`),
          customManifest,
        );
        assert.strictEqual(
          harness.readFile(
            `${harness.extensionsRoot}/sources/builtin/base-common/instructions/minimal.mdx`,
          ),
          customMinimal,
        );

        const second = yield* extensions.builtin.scaffoldMissing();
        assert.deepStrictEqual(second.materializedExtensionIds, []);
        assert.deepStrictEqual(second.existingExtensionIds.map(String), sourceBackedIds);
        assert.deepStrictEqual(second.appNativeExtensionIds.map(String), appNativeIds);

        const registry = yield* extensions.registry.observe();
        assert.deepStrictEqual(
          registry.observations
            .filter((observation) => observation.category === "builtin")
            .flatMap((observation) =>
              observation.materializationPlan === null ? [] : [observation.extensionId],
            ),
          [],
        );
      }).pipe(Effect.provide(harness.layer));
    },
  );

  it.effect("rejects a partial live builtin root before materializing any source", () => {
    const harness = makeSourceEditHarness();
    seedPackagedBuiltinTemplates(harness);
    harness.writeFile(
      `${harness.extensionsRoot}/sources/builtin/smithers/partial.txt`,
      "ambiguous partial source\n",
    );
    return Effect.gen(function* () {
      const error = yield* (yield* Extensions).builtin.scaffoldMissing().pipe(Effect.flip);
      assertExtensionError(error, {
        _tag: "ExtensionError",
        extensionId: "smithers",
        operation: "extensions.builtin.scaffoldMissing",
        reason: "invalid-input",
      });
      assert.isNull(
        harness.readFile(`${harness.extensionsRoot}/sources/builtin/base-common/manifest.json`),
      );
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("rejects an unavailable packaged builtin root with a typed error", () => {
    const harness = makeSourceEditHarness();
    return Effect.gen(function* () {
      const error = yield* (yield* Extensions).builtin.scaffoldMissing().pipe(Effect.flip);
      assertExtensionError(error, {
        _tag: "ExtensionError",
        operation: "extensions.builtin.scaffoldMissing",
        reason: "not-found",
      });
    }).pipe(Effect.provide(harness.layer));
  });

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

  it.effect("exposes CLI readiness refresh through the Extensions service", () =>
    Effect.gen(function* () {
      const service = yield* makeTestExtensions();
      const registryObservation = yield* service.registry.observe();

      const result = yield* service.dependencies.refreshReadiness({ registryObservation });

      assert.strictEqual(
        result.registryAggregateFingerprint,
        registryObservation.aggregateFingerprint,
      );
      assert.isAbove(result.readiness.length, 0);
      assert.strictEqual(
        result.readiness.find((item) => item.requirementId === "cx")?.status,
        "missing",
      );
    }),
  );

  it.effect(
    "observes a deterministic app-global builtin registry without unsafe pristine refs",
    () =>
      Effect.gen(function* () {
        const harness = makeSourceEditHarness();
        const first = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).registry.observe();
        }).pipe(Effect.provide(harness.layer));
        const second = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).registry.observe();
        }).pipe(Effect.provide(harness.layer));

        assert.strictEqual(first.aggregateFingerprint, second.aggregateFingerprint);
        const shell = first.observations.find((item) => item.extensionId === "shell");
        assert.strictEqual(shell?.capabilities.materializationRequired, true);
        assert.strictEqual(shell?.buildRequirement, "not-required");
        assert.deepStrictEqual(shell?.usagePolicy, {
          canonicalOrder: 4,
          baselineUsage: {
            orchestrator: "loaded",
            handler: "loaded",
            "workflow-task": "loaded",
          },
          networkAccess: "not-required",
          configurable: true,
          fixedReason: null,
        });
        assert.deepStrictEqual(
          first.observations.find((item) => item.extensionId === "extension-loading")?.usagePolicy,
          {
            canonicalOrder: 7,
            baselineUsage: {
              orchestrator: "loaded",
              handler: "loaded",
              "workflow-task": "loaded",
            },
            networkAccess: "not-required",
            configurable: false,
            fixedReason:
              "Extension Loading is fixed always-loaded so actors can inspect and load available extensions.",
          },
        );
        assert.strictEqual(
          first.observations.find((item) => item.extensionId === "web")?.usagePolicy.networkAccess,
          "required",
        );
        assert.deepStrictEqual(
          shell?.contributors.map((item) => [item.kind, item.source?.sourceId]),
          [["minimal", extensionOwnedSourceId("shell", { kind: "minimal" })]],
        );
        assert.strictEqual(
          shell?.contributors.every((item) => !item.openable),
          true,
        );
        assert.deepStrictEqual(
          shell?.tooling.map((item) => [item.kind, item.openable, item.source?.sourceId]),
          [
            [
              "native-tool-schema",
              false,
              extensionOwnedSourceId("shell", { kind: "native-tool-schema" }),
            ],
          ],
        );
      }),
  );

  it.effect("canonically observes user manifests, declarations, contributors, and tooling", () =>
    Effect.gen(function* () {
      const harness = makeSourceEditHarness();
      const root = `${harness.extensionsRoot}/sources/user/linear`;
      harness.writeFile(
        `${root}/manifest.json`,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            id: "linear",
            interface: "svvyx",
            title: "Linear",
            description: "Manage Linear issues.",
            typescriptApiEnabled: true,
            instructionFiles: [
              { file: "010-linear.mdx", bypassed: false },
              { file: "020-docs.md", bypassed: true },
            ],
            generatedInstructions: [
              { script: "scripts/generate-docs.ts", output: "instructions/full/020-docs.md" },
            ],
            cliRequirements: [
              {
                id: "linear-cli",
                binary: "linear",
                required: true,
                package: "@example/linear-cli",
                version: "1.2.3",
                versionCommand: "linear --version",
                installCommand: "bun add -g @example/linear-cli@{{version}}",
                nodeRequirement: ">=22",
              },
            ],
            env: [
              {
                name: "LINEAR_TOKEN",
                required: true,
                secret: true,
                description: "Linear API token.",
              },
            ],
            dependencies: { "@linear/sdk": "4.0.0" },
            trustedDependencies: { sharp: "0.34.0" },
          },
          null,
          2,
        )}\n`,
      );
      harness.writeFile(`${root}/instructions/minimal.mdx`, "Load Linear when needed.\n");
      harness.writeFile(`${root}/instructions/full/010-linear.mdx`, "# Linear\n");
      harness.writeFile(`${root}/scripts/generate-docs.ts`, "export {};\n");
      harness.writeFile(`${root}/instructions/full/020-docs.md`, "# Generated docs\n");
      harness.writeFile(`${root}/source/index.ts`, "export default {};\n");

      const result = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).registry.observe();
      }).pipe(Effect.provide(harness.layer));
      const linear = result.observations.find((item) => item.extensionId === "linear");

      assert.strictEqual(linear?.category, "user");
      assert.deepStrictEqual(linear?.usagePolicy, {
        canonicalOrder: 19,
        baselineUsage: {
          orchestrator: "loaded",
          handler: "unavailable",
          "workflow-task": "loaded",
        },
        networkAccess: "not-required",
        configurable: true,
        fixedReason: null,
      });
      assert.strictEqual(linear?.capabilities.materializationRequired, false);
      assert.deepStrictEqual(
        linear?.contributors.map((item) => [item.kind, item.name, item.editable]),
        [
          ["minimal", "minimal.mdx", true],
          ["instruction", "010-linear.mdx", true],
          ["script", "scripts/generate-docs.ts", true],
          ["generated-instruction", "instructions/full/020-docs.md", false],
        ],
      );
      assert.deepStrictEqual(
        linear?.contributors.map((item) => item.bypassed),
        [false, false, true, true],
      );
      assert.deepStrictEqual(linear?.cliDeclarations[0], {
        id: "linear-cli",
        requirementFingerprint: linear!.cliDeclarations[0]!.requirementFingerprint,
        binary: "linear",
        package: "@example/linear-cli",
        required: true,
        defaultVersion: "1.2.3",
        versionCommand: "linear --version",
        installCommand: "bun add -g @example/linear-cli@{{version}}",
        nodeRequirement: ">=22",
      });
      assert.isNotEmpty(linear?.cliDeclarations[0]?.requirementFingerprint ?? "");
      const firstRequirementFingerprint = linear!.cliDeclarations[0]!.requirementFingerprint;
      const firstSourceFingerprint = linear!.sourceFingerprint;
      harness.writeFile(`${root}/instructions/full/020-docs.md`, "# Regenerated docs\n");
      const regenerated = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).registry.observe();
      }).pipe(Effect.provide(harness.layer));
      assert.strictEqual(
        regenerated.observations.find((item) => item.extensionId === "linear")?.sourceFingerprint,
        firstSourceFingerprint,
      );
      harness.writeFile(`${root}/scripts/generate-docs.ts`, "export const changed = true;\n");
      const generatorChanged = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).registry.observe();
      }).pipe(Effect.provide(harness.layer));
      assert.notStrictEqual(
        generatorChanged.observations.find((item) => item.extensionId === "linear")
          ?.sourceFingerprint,
        firstSourceFingerprint,
      );
      const changedManifest = JSON.parse(harness.readFile(`${root}/manifest.json`)!) as {
        cliRequirements: Array<{ version: string }>;
      };
      changedManifest.cliRequirements[0]!.version = "1.2.4";
      harness.writeFile(`${root}/manifest.json`, `${JSON.stringify(changedManifest, null, 2)}\n`);
      const changed = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).registry.observe();
      }).pipe(Effect.provide(harness.layer));
      assert.notStrictEqual(
        changed.observations.find((item) => item.extensionId === "linear")?.cliDeclarations[0]
          ?.requirementFingerprint,
        firstRequirementFingerprint,
      );
      assert.deepStrictEqual(
        linear?.dependencyDeclarations.map((item) => [item.kind, item.name, item.version]),
        [
          ["dependency", "@linear/sdk", "4.0.0"],
          ["trusted_dependency", "sharp", "0.34.0"],
        ],
      );
      assert.strictEqual(
        linear?.tooling.find((item) => item.kind === "svvyx-source")?.source?.sourceId,
        extensionOwnedSourceId("linear", { kind: "svvyx-source" }),
      );
      assert.strictEqual(
        linear?.tooling.find((item) => item.kind === "command-schema")?.openable,
        false,
      );
      assert.strictEqual(
        linear?.tooling.find((item) => item.kind === "command-schema")?.source?.sourceId,
        extensionOwnedSourceId("linear", { kind: "command-schema" }),
      );
      assert.strictEqual(
        linear?.tooling.find((item) => item.kind === "typescript-api-declaration")?.source
          ?.sourceId,
        extensionOwnedSourceId("linear", { kind: "typescript-api-declaration" }),
      );
    }),
  );

  it.effect(
    "preserves packaged builtin contributor order and detects live customization by bytes",
    () =>
      Effect.gen(function* () {
        const harness = makeSourceEditHarness();
        const manifest = `${JSON.stringify(
          {
            schemaVersion: 1,
            id: "cx",
            interface: "instructions",
            title: "cx",
            description: "Prompt-only semantic code navigation CLI guidance.",
            instructionFiles: [
              { file: "005-overview.md", bypassed: false },
              { file: "010-cx-skill.generated.md", bypassed: true },
            ],
            generatedInstructions: [
              {
                output: "instructions/full/010-cx-skill.generated.md",
                script: "scripts/generate-cx-skill.ts",
              },
            ],
          },
          null,
          2,
        )}\n`;
        const files = new Map([
          ["manifest.json", manifest],
          ["instructions/minimal.mdx", "Use cx when needed.\n"],
          ["instructions/full/005-overview.md", "# Overview\n"],
          ["instructions/full/010-cx-skill.generated.md", "# Generated cx skill\n"],
          ["scripts/generate-cx-skill.ts", "export {};\n"],
        ]);
        const packagedRoot = `${harness.packagedExtensionsRoot}/cx`;
        for (const [filePath, contents] of files) {
          harness.writeFile(`${packagedRoot}/${filePath}`, contents);
        }

        const pristine = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).registry.observe();
        }).pipe(Effect.provide(harness.layer));
        const pristineCx = pristine.observations.find((item) => item.extensionId === "cx");
        assert.strictEqual(pristineCx?.customized, false);
        assert.deepStrictEqual(pristineCx?.materializationPlan, {
          kind: "scaffold-builtin",
          extensionId: "cx",
        });
        assert.deepStrictEqual(
          pristineCx?.contributors.map((item) => [
            item.kind,
            item.name,
            item.bypassed,
            item.requiresMaterialization,
          ]),
          [
            ["minimal", "minimal.mdx", false, true],
            ["instruction", "005-overview.md", false, true],
            ["script", "scripts/generate-cx-skill.ts", true, true],
            ["generated-instruction", "instructions/full/010-cx-skill.generated.md", true, true],
          ],
        );
        assert.strictEqual(
          pristineCx?.contributors.every((item) => !item.openable),
          true,
        );

        const liveRoot = `${harness.extensionsRoot}/sources/builtin/cx`;
        for (const [filePath, contents] of files) {
          harness.writeFile(`${liveRoot}/${filePath}`, contents);
        }
        const unchanged = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).registry.observe();
        }).pipe(Effect.provide(harness.layer));
        assert.strictEqual(
          unchanged.observations.find((item) => item.extensionId === "cx")?.customized,
          false,
        );

        harness.writeFile(`${liveRoot}/instructions/full/005-overview.md`, "# Customized\n");
        const customized = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).registry.observe();
        }).pipe(Effect.provide(harness.layer));
        assert.strictEqual(
          customized.observations.find((item) => item.extensionId === "cx")?.customized,
          true,
        );
      }),
  );

  it.effect(
    "opens pristine packaged builtin source and scaffolds the full template on first CAS save",
    () =>
      Effect.gen(function* () {
        const harness = makeSourceEditHarness();
        const packagedRoot = `${harness.packagedExtensionsRoot}/git`;
        harness.writeFile(
          `${packagedRoot}/manifest.json`,
          `${JSON.stringify({
            schemaVersion: 1,
            id: "git",
            interface: "instructions",
            title: "Git",
            description: "Prompt-only Git CLI guidance.",
            instructionFiles: [{ file: "010-git.md", bypassed: false }],
          })}\n`,
        );
        harness.writeFile(`${packagedRoot}/instructions/minimal.mdx`, "Use git when needed.\n");
        harness.writeFile(`${packagedRoot}/instructions/full/010-git.md`, "# Git\n");
        harness.writeFile(`${packagedRoot}/assets/kept.txt`, "whole template\n");
        const source = {
          sourceKind: "builtin-extension" as const,
          sourceId: extensionOwnedSourceId("git", {
            kind: "instruction",
            name: "010-git.md",
          }),
        };
        const opened = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).sources.openEditSession(source);
        }).pipe(Effect.provide(harness.layer));
        assert.strictEqual(opened.text, "# Git\n");
        assert.strictEqual(
          harness.readFile(`${harness.extensionsRoot}/sources/builtin/git/manifest.json`),
          null,
        );
        const saved = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).sources.saveEditSession({
            ...source,
            expectedSourceVersion: opened.sourceVersion,
            text: "# Customized Git\n",
            saveMode: "compare-and-swap",
          });
        }).pipe(Effect.provide(harness.layer));
        assert.strictEqual(saved.status, "saved");
        assert.strictEqual(
          harness.readFile(
            `${harness.extensionsRoot}/sources/builtin/git/instructions/full/010-git.md`,
          ),
          "# Customized Git\n",
        );
        assert.strictEqual(
          harness.readFile(`${harness.extensionsRoot}/sources/builtin/git/assets/kept.txt`),
          "whole template\n",
        );
      }),
  );

  it.effect("opens Extension Loading minimal context as an internal read-only source", () =>
    Effect.gen(function* () {
      const harness = makeSourceEditHarness();
      const packagedRoot = `${harness.packagedExtensionsRoot}/extension-loading`;
      harness.writeFile(
        `${packagedRoot}/manifest.json`,
        JSON.stringify({
          schemaVersion: 1,
          id: "extension-loading",
          interface: "instructions",
          title: "Extension Loading",
          description: "Actor-local extension loading guidance.",
          instructionFiles: [],
        }),
      );
      harness.writeFile(
        `${packagedRoot}/instructions/minimal.mdx`,
        "Inspect ready extensions before loading them.\n",
      );
      const source = {
        sourceKind: "builtin-extension" as const,
        sourceId: extensionOwnedSourceId("extension-loading", { kind: "minimal" }),
      };
      const result = yield* Effect.gen(function* () {
        const extensions = yield* Extensions;
        const opened = yield* extensions.sources.openEditSession(source);
        const saveError = yield* extensions.sources
          .saveEditSession({
            ...source,
            expectedSourceVersion: opened.sourceVersion,
            text: "Do not customize.\n",
            saveMode: "compare-and-swap",
          })
          .pipe(Effect.flip);
        return { opened, saveError };
      }).pipe(Effect.provide(harness.layer));

      assert.strictEqual(result.opened.text, "Inspect ready extensions before loading them.\n");
      assertExtensionError(result.saveError, {
        _tag: "ExtensionError",
        reason: "read-only-source",
      });
      assert.strictEqual(
        harness.readFile(
          `${harness.extensionsRoot}/sources/builtin/extension-loading/manifest.json`,
        ),
        null,
      );
    }),
  );

  it.effect("rejects a stale packaged builtin CAS without materializing", () =>
    Effect.gen(function* () {
      const harness = makeSourceEditHarness();
      const packagedRoot = `${harness.packagedExtensionsRoot}/git`;
      harness.writeFile(
        `${packagedRoot}/manifest.json`,
        JSON.stringify({
          schemaVersion: 1,
          id: "git",
          interface: "instructions",
          title: "Git",
          description: "Prompt-only Git CLI guidance.",
          instructionFiles: [{ file: "010-git.md", bypassed: false }],
        }),
      );
      harness.writeFile(`${packagedRoot}/instructions/minimal.mdx`, "Use git.\n");
      harness.writeFile(`${packagedRoot}/instructions/full/010-git.md`, "# Git v1\n");
      const source = {
        sourceKind: "builtin-extension" as const,
        sourceId: extensionOwnedSourceId("git", {
          kind: "instruction",
          name: "010-git.md",
        }),
      };
      const opened = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).sources.openEditSession(source);
      }).pipe(Effect.provide(harness.layer));
      harness.writeFile(`${packagedRoot}/instructions/full/010-git.md`, "# Git v2\n");
      const stale = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).sources.saveEditSession({
          ...source,
          expectedSourceVersion: opened.sourceVersion,
          text: "# Local edit\n",
          saveMode: "compare-and-swap",
        });
      }).pipe(Effect.provide(harness.layer));
      assert.strictEqual(stale.status, "stale");
      assert.strictEqual(
        harness.readFile(`${harness.extensionsRoot}/sources/builtin/git/manifest.json`),
        null,
      );
    }),
  );

  it.effect("rejects fabricated builtin roles and partial live roots", () =>
    Effect.gen(function* () {
      const harness = makeSourceEditHarness();
      const packagedRoot = `${harness.packagedExtensionsRoot}/git`;
      harness.writeFile(
        `${packagedRoot}/manifest.json`,
        JSON.stringify({
          schemaVersion: 1,
          id: "git",
          interface: "instructions",
          title: "Git",
          description: "Prompt-only Git CLI guidance.",
          instructionFiles: [{ file: "010-git.md", bypassed: false }],
        }),
      );
      harness.writeFile(`${packagedRoot}/instructions/minimal.mdx`, "Use git.\n");
      harness.writeFile(`${packagedRoot}/instructions/full/010-git.md`, "# Git\n");
      const fabricatedExit = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).sources.openEditSession({
          sourceKind: "builtin-extension",
          sourceId: extensionOwnedSourceId("git", {
            kind: "instruction",
            name: "999-fabricated.md",
          }),
        });
      }).pipe(Effect.provide(harness.layer), Effect.exit);
      assert.strictEqual(fabricatedExit._tag, "Failure");

      const source = {
        sourceKind: "builtin-extension" as const,
        sourceId: extensionOwnedSourceId("git", {
          kind: "instruction",
          name: "010-git.md",
        }),
      };
      const opened = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).sources.openEditSession(source);
      }).pipe(Effect.provide(harness.layer));
      harness.writeFile(`${harness.extensionsRoot}/sources/builtin/git/partial.txt`, "partial\n");
      const saveExit = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).sources.saveEditSession({
          ...source,
          expectedSourceVersion: opened.sourceVersion,
          text: "# Local\n",
          saveMode: "compare-and-swap",
        });
      }).pipe(Effect.provide(harness.layer), Effect.exit);
      assert.strictEqual(saveExit._tag, "Failure");
      assert.strictEqual(
        harness.readFile(`${harness.extensionsRoot}/sources/builtin/git/manifest.json`),
        null,
      );
    }),
  );

  it.effect("rejects fabricated user extension source identities", () =>
    Effect.gen(function* () {
      const harness = makeSourceEditHarness();
      const root = `${harness.extensionsRoot}/sources/user/notes`;
      harness.writeFile(
        `${root}/manifest.json`,
        JSON.stringify({
          schemaVersion: 1,
          id: "notes",
          interface: "instructions",
          title: "Notes",
          description: "Notes guidance.",
          instructionFiles: [{ file: "010-notes.md", bypassed: false }],
        }),
      );
      harness.writeFile(`${root}/instructions/minimal.mdx`, "Use notes.\n");
      harness.writeFile(`${root}/instructions/full/010-notes.md`, "# Notes\n");
      const exit = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).sources.openEditSession({
          sourceKind: "user-extension",
          sourceId: extensionOwnedSourceId("notes", {
            kind: "instruction",
            name: "999-fabricated.md",
          }),
        });
      }).pipe(Effect.provide(harness.layer), Effect.exit);
      assert.strictEqual(exit._tag, "Failure");
    }),
  );

  it.effect("rejects nested symbolic-link boundaries in user source", () =>
    Effect.gen(function* () {
      const root = "/extensions-test/sources/user/linked";
      const harness = makeSourceEditHarness({
        symbolicLinkPaths: [`${root}/instructions`],
      });
      harness.writeFile(
        `${root}/manifest.json`,
        JSON.stringify({
          schemaVersion: 1,
          id: "linked",
          interface: "instructions",
          title: "Linked",
          description: "Invalid linked source.",
          instructionFiles: [{ file: "010-linked.md", bypassed: false }],
        }),
      );
      harness.writeFile(`${root}/instructions/minimal.mdx`, "Linked.\n");
      harness.writeFile(`${root}/instructions/full/010-linked.md`, "# Linked\n");
      const exit = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).registry.observe();
      }).pipe(Effect.provide(harness.layer), Effect.exit);
      assert.strictEqual(exit._tag, "Failure");
    }),
  );

  it.effect("rejects malformed manifests and duplicate contributor source identities", () =>
    Effect.gen(function* () {
      const malformed = makeSourceEditHarness();
      const malformedRoot = `${malformed.extensionsRoot}/sources/user/bad`;
      malformed.writeFile(
        `${malformedRoot}/manifest.json`,
        JSON.stringify({
          schemaVersion: 1,
          id: "bad",
          interface: "instructions",
          title: "Bad",
          description: "Bad duplicate manifest.",
          instructionFiles: [
            { file: "010-bad.md", bypassed: false },
            { file: "010-bad.md", bypassed: true },
          ],
        }),
      );
      malformed.writeFile(`${malformedRoot}/instructions/full/010-bad.md`, "bad\n");
      const malformedExit = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).registry.observe();
      }).pipe(Effect.provide(malformed.layer), Effect.exit);
      assert.strictEqual(malformedExit._tag, "Failure");

      const duplicateSource = makeSourceEditHarness();
      const duplicateRoot = `${duplicateSource.extensionsRoot}/sources/user/generated`;
      duplicateSource.writeFile(
        `${duplicateRoot}/manifest.json`,
        JSON.stringify({
          schemaVersion: 1,
          id: "generated",
          interface: "instructions",
          title: "Generated",
          description: "Duplicate script source.",
          generatedInstructions: [
            { script: "scripts/docs.ts", output: "instructions/full/010-a.md" },
            { script: "scripts/docs.ts", output: "instructions/full/020-b.md" },
          ],
        }),
      );
      duplicateSource.writeFile(`${duplicateRoot}/scripts/docs.ts`, "export {};\n");
      const duplicateExit = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).registry.observe();
      }).pipe(Effect.provide(duplicateSource.layer), Effect.exit);
      assert.strictEqual(duplicateExit._tag, "Failure");
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
      const packagedRoot = `${sourceEditHarness.packagedExtensionsRoot}/base-common`;
      sourceEditHarness.writeFile(
        `${packagedRoot}/manifest.json`,
        JSON.stringify({
          schemaVersion: 1,
          id: "base-common",
          interface: "instructions",
          title: "Base Common",
          description: "Shared svvy operating instructions.",
          instructionFiles: [],
        }),
      );
      sourceEditHarness.writeFile(
        `${packagedRoot}/instructions/minimal.mdx`,
        "Load Base Common only when shared svvy operating rules are missing.\n",
      );
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
          sourceEditHarness.packagedExtensionsRoot,
          "base-common",
          "instructions",
          "minimal.mdx",
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
        sourceEditHarness.readFile(
          joinSourceEditPathSegments(
            sourceEditHarness.extensionsRoot,
            "sources",
            "builtin",
            "base-common",
            "instructions",
            "minimal.mdx",
          ),
        ),
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
          "builds",
          "extensions",
          "workflows",
          "current",
          "commands.json",
        );
        const nativeToolSchemaPath = joinSourceEditPathSegments(
          sourceEditHarness.extensionsRoot,
          "builds",
          "extensions",
          "shell",
          "current",
          "native-tool-schema.json",
        );
        const typescriptDeclarationPath = joinSourceEditPathSegments(
          sourceEditHarness.extensionsRoot,
          "builds",
          "extensions",
          "workflows",
          "current",
          "index.d.ts",
        );
        sourceEditHarness.writeFile(generatedPath, "generated web guidance\n");
        sourceEditHarness.writeFile(commandSchemaPath, "{}\n");
        sourceEditHarness.writeFile(nativeToolSchemaPath, '{"name":"shell"}\n');
        sourceEditHarness.writeFile(typescriptDeclarationPath, "export {};\n");
        sourceEditHarness.writeFile(
          joinSourceEditPathSegments(
            sourceEditHarness.packagedExtensionsRoot,
            "shell",
            "manifest.json",
          ),
          JSON.stringify({
            schemaVersion: 1,
            id: "shell",
            interface: "native_tool",
          }),
        );
        sourceEditHarness.writeFile(
          joinSourceEditPathSegments(
            sourceEditHarness.extensionsRoot,
            "sources",
            "builtin",
            "web",
            "manifest.json",
          ),
          JSON.stringify({
            schemaVersion: 1,
            id: "web",
            interface: "instructions",
            instructionFiles: [{ file: "010-tinyfish-cli.generated.md", bypassed: false }],
            generatedInstructions: [
              {
                output: "instructions/full/010-tinyfish-cli.generated.md",
                script: "scripts/generate-tinyfish-cli.ts",
              },
            ],
          }),
        );
        sourceEditHarness.writeFile(
          joinSourceEditPathSegments(
            sourceEditHarness.packagedExtensionsRoot,
            "workflows",
            "manifest.json",
          ),
          JSON.stringify({
            schemaVersion: 1,
            id: "workflows",
            interface: "svvyx",
          }),
        );
        const generatedSourceId = extensionOwnedSourceId("web", {
          kind: "generated-instruction",
          relativePath: "instructions/full/010-tinyfish-cli.generated.md",
        });
        const commandSchemaSourceId = extensionOwnedSourceId("workflows", {
          kind: "command-schema",
        });
        const nativeToolSchemaSourceId = extensionOwnedSourceId("shell", {
          kind: "native-tool-schema",
        });
        const typescriptDeclarationSourceId = extensionOwnedSourceId("workflows", {
          kind: "typescript-api-declaration",
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
          const nativeToolSchema = yield* extensions.sources.openEditSession({
            sourceKind: "builtin-extension",
            sourceId: nativeToolSchemaSourceId,
          });
          const typescriptDeclaration = yield* extensions.sources.openEditSession({
            sourceKind: "builtin-extension",
            sourceId: typescriptDeclarationSourceId,
          });
          const generatedOutputWrites = yield* Effect.all(
            [nativeToolSchema, typescriptDeclaration].map((session) =>
              extensions.sources
                .saveEditSession({
                  sourceKind: "builtin-extension",
                  sourceId: session.sourceId,
                  expectedSourceVersion: session.sourceVersion,
                  text: "do not write\n",
                  saveMode: "overwrite",
                })
                .pipe(Effect.flip),
            ),
          );
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
          return {
            generated,
            commandSchema,
            nativeToolSchema,
            typescriptDeclaration,
            generatedOutputWrites,
            readOnly,
            aliases,
            missingGenerated,
          };
        }).pipe(Effect.provide(sourceEditHarness.layer));

        assert.strictEqual(result.generated.path, generatedPath);
        assert.strictEqual(result.generated.text, "generated web guidance\n");
        assert.strictEqual(result.commandSchema.path, commandSchemaPath);
        assert.strictEqual(result.nativeToolSchema.path, nativeToolSchemaPath);
        assert.strictEqual(result.nativeToolSchema.text, '{"name":"shell"}\n');
        assert.strictEqual(result.typescriptDeclaration.path, typescriptDeclarationPath);
        assert.strictEqual(result.typescriptDeclaration.text, "export {};\n");
        for (const error of result.generatedOutputWrites) {
          assertExtensionError(error, { _tag: "ExtensionError", reason: "read-only-source" });
        }
        assertExtensionError(result.readOnly, {
          _tag: "ExtensionError",
          reason: "read-only-source",
        });
        for (const error of result.aliases) {
          assertExtensionError(error, { _tag: "ExtensionError", reason: "invalid-input" });
        }
        assertExtensionError(result.missingGenerated, {
          _tag: "ExtensionError",
          reason: "invalid-input",
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

  it.effect("observes validated current builds from canonical non-generated source inputs", () =>
    Effect.gen(function* () {
      const harness = makeSourceEditHarness();
      const sourceRoot = `${harness.extensionsRoot}/sources/user/buildable`;
      const currentRoot = `${harness.extensionsRoot}/builds/extensions/buildable/current`;
      const manifestText = '{"schemaVersion":1,"id":"buildable","interface":"svvyx"}\n';
      const minimalText = "Minimal source\n";
      const runtimeSource = "export const run = true;\n";
      harness.writeFile(`${sourceRoot}/manifest.json`, manifestText);
      harness.writeFile(`${sourceRoot}/instructions/minimal.mdx`, minimalText);
      harness.writeFile(`${sourceRoot}/instructions/full/generated.md`, "generated v1\n");
      harness.writeFile(`${sourceRoot}/source/index.ts`, runtimeSource);

      const sourceFingerprint = testEvidenceFingerprint("svvy-extension-source-v1", [
        ["manifest", "manifest.json", testSha256(manifestText)],
        ["minimal-instruction", "instructions/minimal.mdx", testSha256(minimalText)],
        ["source-file", "source/index.ts", testSha256(runtimeSource)],
      ]);
      const generatedText = "Generated context\n";
      const generatedEvidence = [
        ["minimal-instruction", "context.md", testSha256(generatedText)],
      ] as const;
      const outputFingerprint = testEvidenceFingerprint(
        "svvy-extension-output-v1",
        generatedEvidence,
      );
      const contextFingerprint = testEvidenceFingerprint(
        "svvy-extension-context-v1",
        generatedEvidence,
      );
      harness.writeFile(`${currentRoot}/context.md`, generatedText);
      const currentManifest = {
        schemaVersion: 1,
        buildId: `extension-build:buildable:${outputFingerprint.slice("sha256:".length)}`,
        extensionId: "buildable",
        interfaceKind: "svvyx",
        sourceFingerprint,
        contextFingerprint,
        outputFingerprint,
        contextReady: true,
        generatedFiles: [
          {
            role: "minimal-instruction",
            relativePath: "context.md",
            contentHash: testSha256(generatedText),
            byteSize: new TextEncoder().encode(generatedText).byteLength,
          },
        ],
        builtAt: "2026-07-12T10:00:00.000Z",
      };
      harness.writeFile(`${currentRoot}/manifest.json`, JSON.stringify(currentManifest));
      const registryObservation = {
        aggregateFingerprint: "registry-fingerprint-does-not-author-build-source-evidence",
        observations: [
          {
            extensionId: "buildable" as ExtensionId,
            category: "user",
            interfaceKind: "svvyx",
            svvyxImplementation: {
              kind: "source-runtime",
              sourceRelativePath: "source/index.ts",
            },
            buildRequirement: "required",
            usagePolicy: {
              canonicalOrder: 19,
              baselineUsage: {
                orchestrator: "loaded",
                handler: "unavailable",
                "workflow-task": "loaded",
              },
              networkAccess: "not-required",
              configurable: true,
              fixedReason: null,
            },
            title: "Buildable",
            description: "Build observation fixture",
            customized: true,
            materializationPlan: null,
            capabilities: {
              resettable: false,
              deletable: true,
              typescriptApiEnabled: false,
              materializationRequired: false,
            },
            contributors: [
              {
                kind: "minimal",
                name: "minimal.mdx",
                bypassed: false,
                editable: true,
                openable: true,
                requiresMaterialization: false,
              },
            ],
            tooling: [],
            cliDeclarations: [],
            envDeclarations: [],
            dependencyDeclarations: [],
            sourceFingerprint: "registry-owned-fingerprint",
            diagnostics: [],
          },
        ],
        diagnostics: [],
      } satisfies ExtensionRegistryObservationResult;

      const first = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).builds.observeCurrent({ registryObservation });
      }).pipe(Effect.provide(harness.layer));
      harness.writeFile(`${sourceRoot}/instructions/full/generated.md`, "generated v2\n");
      const second = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).builds.observeCurrent({ registryObservation });
      }).pipe(Effect.provide(harness.layer));
      harness.writeFile(`${sourceRoot}/source/index.ts`, "export const run = false;\n");
      const stale = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).builds.observeCurrent({ registryObservation });
      }).pipe(Effect.provide(harness.layer));
      harness.writeFile(`${sourceRoot}/source/index.ts`, runtimeSource);
      harness.writeFile(`${currentRoot}/context.md`, "tampered output\n");
      const invalid = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).builds.observeCurrent({ registryObservation });
      }).pipe(Effect.provide(harness.layer));
      harness.writeFile(`${currentRoot}/context.md`, generatedText);
      harness.writeFile(
        `${currentRoot}/manifest.json`,
        JSON.stringify({ ...currentManifest, interfaceKind: "instructions" }),
      );
      const identityInvalid = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).builds.observeCurrent({ registryObservation });
      }).pipe(Effect.provide(harness.layer));
      harness.writeFile(
        `${currentRoot}/manifest.json`,
        JSON.stringify({
          ...currentManifest,
          generatedFiles: [
            { ...currentManifest.generatedFiles[0], relativePath: "../escaped-context.md" },
          ],
        }),
      );
      const pathInvalid = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).builds.observeCurrent({ registryObservation });
      }).pipe(Effect.provide(harness.layer));

      assert.strictEqual(first.observations[0]?.currentBuildStatus, "current");
      assert.strictEqual(first.observations[0]?.sourceFingerprint, sourceFingerprint);
      assert.strictEqual(second.observations[0]?.sourceFingerprint, sourceFingerprint);
      assert.notStrictEqual(first.observations[0]?.sourceFingerprint, "registry-owned-fingerprint");
      assert.strictEqual(stale.observations[0]?.currentBuildStatus, "stale");
      assert.notStrictEqual(stale.observations[0]?.sourceFingerprint, sourceFingerprint);
      assert.strictEqual(invalid.observations[0]?.currentBuildStatus, "invalid");
      assert.strictEqual(identityInvalid.observations[0]?.currentBuildStatus, "invalid");
      assert.strictEqual(pathInvalid.observations[0]?.currentBuildStatus, "invalid");
    }),
  );

  it.effect(
    "sorts build observations and keeps app-native tools outside build-required state",
    () =>
      Effect.gen(function* () {
        const harness = makeSourceEditHarness();
        const observation = (input: {
          extensionId: string;
          interfaceKind: "native_tool" | "svvyx";
          buildRequirement: "required" | "not-required";
        }) => ({
          extensionId: input.extensionId as ExtensionId,
          category: "builtin" as const,
          interfaceKind: input.interfaceKind,
          svvyxImplementation:
            input.interfaceKind === "svvyx"
              ? ({ kind: "source-runtime", sourceRelativePath: "source/index.ts" } as const)
              : null,
          buildRequirement: input.buildRequirement,
          usagePolicy: {
            canonicalOrder: input.extensionId === "a-native" ? 0 : 1,
            baselineUsage: {
              orchestrator: input.extensionId === "a-native" ? "loaded" : "unavailable",
              handler: input.extensionId === "a-native" ? "loaded" : "unavailable",
              "workflow-task": input.extensionId === "a-native" ? "loaded" : "unavailable",
            } as const,
            networkAccess: "not-required" as const,
            configurable: true,
            fixedReason: null,
          },
          title: input.extensionId,
          description: `${input.extensionId} fixture`,
          customized: false,
          materializationPlan: {
            kind: "scaffold-builtin" as const,
            extensionId: input.extensionId as ExtensionId,
          },
          capabilities: {
            resettable: true,
            deletable: false,
            typescriptApiEnabled: false,
            materializationRequired: true,
          },
          contributors: [],
          tooling: [],
          cliDeclarations: [],
          envDeclarations: [],
          dependencyDeclarations: [],
          sourceFingerprint: "registry-fingerprint",
          diagnostics: [],
        });
        const result = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).builds.observeCurrent({
            registryObservation: {
              aggregateFingerprint: "registry-order-fixture",
              observations: [
                observation({
                  extensionId: "z-buildable",
                  interfaceKind: "svvyx",
                  buildRequirement: "required",
                }),
                observation({
                  extensionId: "a-native",
                  interfaceKind: "native_tool",
                  buildRequirement: "not-required",
                }),
              ],
              diagnostics: [],
            },
          });
        }).pipe(Effect.provide(harness.layer));

        assert.deepStrictEqual(
          result.observations.map((item) => item.extensionId),
          ["a-native", "z-buildable"],
        );
        assert.strictEqual(result.observations[0]?.currentBuildStatus, "not-required");
        assert.strictEqual(result.observations[0]?.buildRequired, false);
        assert.strictEqual(result.observations[1]?.currentBuildStatus, "missing");
        assert.strictEqual(result.observations[1]?.buildRequired, true);
      }),
  );

  it.effect("builds one canonical source and promotes validated staged evidence", () =>
    Effect.gen(function* () {
      const harness = makeSourceEditHarness({
        buildProcess: (plan, files) => {
          assert.deepStrictEqual(plan.generators[0]?.argv.slice(-2), ["--version", "1.2.3"]);
          const outputs = plan.expectedProcessOutputs.map((output) => {
            const contents = `${output.role}:${output.relativePath}\n`;
            files.set(`${plan.stagingRoot}/${output.relativePath}`, contents);
            return {
              ...output,
              contentHash: testSha256(contents),
              byteSize: new TextEncoder().encode(contents).byteLength,
            };
          });
          return {
            status: "completed",
            exitCode: 0,
            stdout: "",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
            stagedFiles: outputs,
            commandManifest: null,
          };
        },
      });
      const sourceRoot = `${harness.extensionsRoot}/sources/user/buildable`;
      harness.writeFile(`${sourceRoot}/manifest.json`, "{}\n");
      harness.writeFile(`${sourceRoot}/instructions/minimal.mdx`, "Buildable\n");
      harness.writeFile(`${sourceRoot}/scripts/generate.ts`, "export {};\n");
      const registryObservation = {
        aggregateFingerprint: "registry-build-fixture",
        observations: [
          {
            extensionId: "buildable" as ExtensionId,
            category: "user",
            interfaceKind: "instructions",
            svvyxImplementation: null,
            buildRequirement: "required",
            usagePolicy: {
              canonicalOrder: 19,
              baselineUsage: {
                orchestrator: "loaded",
                handler: "unavailable",
                "workflow-task": "loaded",
              },
              networkAccess: "not-required",
              configurable: true,
              fixedReason: null,
            },
            title: "Buildable",
            description: "Build execution fixture",
            customized: true,
            materializationPlan: null,
            capabilities: {
              resettable: false,
              deletable: true,
              typescriptApiEnabled: false,
              materializationRequired: false,
            },
            contributors: [
              {
                kind: "minimal",
                name: "minimal.mdx",
                bypassed: false,
                editable: true,
                openable: true,
                requiresMaterialization: false,
              },
              {
                kind: "script",
                name: "scripts/generate.ts",
                bypassed: false,
                editable: true,
                openable: true,
                requiresMaterialization: false,
                versionCliRequirementId: "builder",
              },
              {
                kind: "generated-instruction",
                name: "instructions/full/generated.md",
                bypassed: false,
                editable: false,
                openable: true,
                requiresMaterialization: false,
              },
            ],
            tooling: [],
            cliDeclarations: [
              {
                id: "builder",
                requirementFingerprint: "builder-fingerprint",
                binary: "builder",
                package: null,
                required: true,
                defaultVersion: "1.2.3",
                versionCommand: "builder --version",
                installCommand: null,
                nodeRequirement: null,
              },
            ],
            envDeclarations: [],
            dependencyDeclarations: [],
            sourceFingerprint: "registry-source-fingerprint",
            diagnostics: [],
          },
        ],
        diagnostics: [],
      } satisfies ExtensionRegistryObservationResult;
      const observed = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).builds.observeCurrent({ registryObservation });
      }).pipe(Effect.provide(harness.layer));
      const sourceObservation = observed.observations[0]!;
      const result = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).builds.build({
          extensionId: "buildable" as ExtensionId,
          registryObservation,
          sourceObservation,
          builtAt:
            "2026-07-12T10:00:00.000Z" as import("@svvy/core").BuildExtensionInput["builtAt"],
        });
      }).pipe(Effect.provide(harness.layer));

      assert.strictEqual(result.manifest.extensionId, "buildable");
      assert.strictEqual(result.manifest.generatedFiles.length, 2);
      assert.ok(
        harness.readFile(
          `${harness.extensionsRoot}/builds/extensions/buildable/current/manifest.json`,
        ),
      );
    }),
  );

  it.effect(
    "builds an app-native svvyx extension from package metadata without source runtime",
    () =>
      Effect.gen(function* () {
        const harness = makeSourceEditHarness({
          buildProcess: () => ({
            status: "completed",
            exitCode: 0,
            stdout: "",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
            stagedFiles: [],
            commandManifest: null,
          }),
        });
        const metadata = APP_NATIVE_SVVYX_METADATA.get("artifacts")!;
        harness.writeFile(
          `${harness.packagedExtensionsRoot}/artifacts/instructions/minimal.mdx`,
          `${metadata.minimalInstruction}\n`,
        );
        const sourceFingerprint = `sha256:${"a".repeat(64)}` as ExtensionSourceFingerprint;
        const registryObservation: ExtensionRegistryObservationResult = {
          aggregateFingerprint: "registry-app-native-fixture",
          observations: [
            {
              extensionId: "artifacts" as ExtensionId,
              category: "builtin",
              interfaceKind: "svvyx",
              svvyxImplementation: {
                kind: "app-native",
                namespace: metadata.namespace,
                metadataFingerprint: testSha256(appNativeSvvyxMetadataFingerprintInput(metadata)),
              },
              buildRequirement: "required",
              usagePolicy: {
                canonicalOrder: 18,
                baselineUsage: {
                  orchestrator: "available",
                  handler: "available",
                  "workflow-task": "available",
                },
                networkAccess: "not-required",
                configurable: true,
                fixedReason: null,
              },
              title: "Artifacts",
              description: "Durable artifacts.",
              customized: false,
              materializationPlan: null,
              capabilities: {
                resettable: false,
                deletable: false,
                typescriptApiEnabled: true,
                materializationRequired: false,
              },
              contributors: [],
              tooling: [
                {
                  kind: "command-schema",
                  name: "commands.json",
                  openable: false,
                  requiresMaterialization: false,
                },
                {
                  kind: "typescript-api-declaration",
                  name: "index.d.ts",
                  openable: false,
                  requiresMaterialization: false,
                },
              ],
              cliDeclarations: [],
              envDeclarations: [],
              dependencyDeclarations: [],
              sourceFingerprint,
              diagnostics: [],
            },
          ],
          diagnostics: [],
        };
        const result = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).builds.build({
            extensionId: "artifacts" as ExtensionId,
            registryObservation,
            sourceObservation: {
              extensionId: "artifacts" as ExtensionId,
              category: "builtin",
              buildRequirement: "required",
              sourceStatus: "materialized",
              sourceFingerprint,
              currentBuildStatus: "missing",
              currentBuild: null,
              buildRequired: true,
              diagnostics: [],
            },
            builtAt: "2026-07-12T10:00:00.000Z" as BuildExtensionInput["builtAt"],
          });
        }).pipe(Effect.provide(harness.layer));

        assert.deepStrictEqual(
          result.manifest.generatedFiles.map(({ role }) => role),
          ["command-manifest", "minimal-instruction", "typescript-declaration"],
        );
        assert.match(
          harness.readFile(
            `${harness.extensionsRoot}/builds/extensions/artifacts/current/commands.json`,
          )!,
          /"create"/,
        );
        const staleRegistryObservation: ExtensionRegistryObservationResult = {
          ...registryObservation,
          observations: registryObservation.observations.map((entry) => ({
            ...entry,
            svvyxImplementation:
              entry.svvyxImplementation?.kind === "app-native"
                ? {
                    ...entry.svvyxImplementation,
                    metadataFingerprint: `sha256:${"b".repeat(64)}`,
                  }
                : entry.svvyxImplementation,
          })),
        };
        const stale = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).builds
            .build({
              extensionId: "artifacts" as ExtensionId,
              registryObservation: staleRegistryObservation,
              sourceObservation: {
                extensionId: "artifacts" as ExtensionId,
                category: "builtin",
                buildRequirement: "required",
                sourceStatus: "materialized",
                sourceFingerprint,
                currentBuildStatus: "missing",
                currentBuild: null,
                buildRequired: true,
                diagnostics: [],
              },
              builtAt: "2026-07-12T10:00:01.000Z" as BuildExtensionInput["builtAt"],
            })
            .pipe(Effect.flip);
        }).pipe(Effect.provide(harness.layer));
        assertExtensionError(stale, {
          _tag: "ExtensionError",
          reason: "invalid-input",
          message: "App-native svvyx metadata fingerprint is stale.",
        });
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
  it.effect("captures only canonical materialized source files and exact supplied state", () =>
    Effect.gen(function* () {
      const harness = makeSourceEditHarness();
      harness.writeFile(
        `${harness.extensionsRoot}/sources/user/demo/manifest.json`,
        JSON.stringify({ id: "demo" }),
      );
      harness.writeFile(
        `${harness.extensionsRoot}/sources/user/demo/instructions/minimal.mdx`,
        "hello",
      );
      harness.writeFile(`${harness.extensionsRoot}/sources/user/demo/package.json`, "excluded");
      harness.writeFile(`${harness.extensionsRoot}/package/package.json`, '{"dependencies":{}}');
      harness.writeFile(`${harness.extensionsRoot}/package/bun.lock`, "lock-state");
      harness.writeFile(
        `${harness.extensionsRoot}/package/node_modules/ignored/index.js`,
        "ignored",
      );
      const payload = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.captureSourcePayload(
          snapshotCaptureInput as never,
        );
      }).pipe(Effect.provide(harness.layer));
      assert.deepStrictEqual(
        payload.sources.map((source) => String(source.extensionId)),
        ["demo"],
      );
      assert.deepStrictEqual(
        payload.sources[0]?.files.map((file) => file.relativePath),
        ["instructions/minimal.mdx", "manifest.json"],
      );
      assert.deepStrictEqual(
        payload.packageFiles.map((file) => file.relativePath),
        ["bun.lock", "package.json"],
      );
      assert.deepStrictEqual(payload.actorSettings, snapshotCaptureInput.actorSettings);
    }),
  );

  it.effect("rejects source symlinks and corrupt restore payload files", () =>
    Effect.gen(function* () {
      const linked = makeSourceEditHarness({
        symbolicLinkPaths: ["/extensions-test/sources/user/demo/instructions/link.mdx"],
      });
      linked.writeFile(
        `${linked.extensionsRoot}/sources/user/demo/manifest.json`,
        JSON.stringify({ id: "demo" }),
      );
      linked.writeFile(
        `${linked.extensionsRoot}/sources/user/demo/instructions/link.mdx`,
        "linked",
      );
      const captureExit = yield* Effect.exit(
        Effect.gen(function* () {
          return yield* (yield* Extensions).snapshots.captureSourcePayload(
            snapshotCaptureInput as never,
          );
        }).pipe(Effect.provide(linked.layer)),
      );
      assert.strictEqual(captureExit._tag, "Failure");

      const harness = makeSourceEditHarness();
      harness.writeFile(
        `${harness.extensionsRoot}/sources/user/demo/manifest.json`,
        JSON.stringify({ id: "demo" }),
      );
      const payload = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.captureSourcePayload(
          snapshotCaptureInput as never,
        );
      }).pipe(Effect.provide(harness.layer));
      const corrupted = {
        ...payload,
        sources: payload.sources.map((source) => ({
          ...source,
          files: source.files.map((file) => ({
            ...file,
            contentHash: `sha256:${"f".repeat(64)}`,
          })),
        })),
      } as typeof payload;
      const prepareExit = yield* Effect.exit(
        Effect.gen(function* () {
          return yield* (yield* Extensions).snapshots.prepareSourceRestore({
            planId:
              "extension-snapshot-source-restore:corrupt" as ExtensionSnapshotSourceRestorePlanId,
            snapshotId: "extension-snapshot:corrupt" as ExtensionSnapshotId,
            payload: corrupted,
          });
        }).pipe(Effect.provide(harness.layer)),
      );
      assert.strictEqual(prepareExit._tag, "Failure");
    }),
  );

  it.effect("rejects duplicate capture ids and emits canonical category, id, and path order", () =>
    Effect.gen(function* () {
      const duplicate = makeSourceEditHarness();
      duplicate.writeFile(
        `${duplicate.extensionsRoot}/sources/builtin/same/manifest.json`,
        JSON.stringify({ id: "same" }),
      );
      duplicate.writeFile(
        `${duplicate.extensionsRoot}/sources/user/same/manifest.json`,
        JSON.stringify({ id: "same" }),
      );
      const duplicateExit = yield* Effect.exit(
        Effect.gen(function* () {
          return yield* (yield* Extensions).snapshots.captureSourcePayload(
            snapshotCaptureInput as never,
          );
        }).pipe(Effect.provide(duplicate.layer)),
      );
      assert.strictEqual(duplicateExit._tag, "Failure");

      const harness = makeSourceEditHarness();
      harness.writeFile(
        `${harness.extensionsRoot}/sources/user/alpha/manifest.json`,
        JSON.stringify({ id: "alpha" }),
      );
      harness.writeFile(`${harness.extensionsRoot}/sources/user/alpha/z.txt`, "z");
      harness.writeFile(`${harness.extensionsRoot}/sources/user/alpha/a.txt`, "a");
      harness.writeFile(
        `${harness.extensionsRoot}/sources/builtin/zeta/manifest.json`,
        JSON.stringify({ id: "zeta" }),
      );
      const payload = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.captureSourcePayload(
          snapshotCaptureInput as never,
        );
      }).pipe(Effect.provide(harness.layer));
      assert.deepStrictEqual(
        payload.sources.map((source) => `${source.category}:${source.extensionId}`),
        ["builtin:zeta", "user:alpha"],
      );
      assert.deepStrictEqual(
        payload.sources[1]?.files.map((file) => file.relativePath),
        ["a.txt", "manifest.json", "z.txt"],
      );
    }),
  );

  it.effect("rejects oversized restore payload declarations before staging", () =>
    Effect.gen(function* () {
      const harness = makeSourceEditHarness();
      harness.writeFile(
        `${harness.extensionsRoot}/sources/user/demo/manifest.json`,
        JSON.stringify({ id: "demo" }),
      );
      const payload = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.captureSourcePayload(
          snapshotCaptureInput as never,
        );
      }).pipe(Effect.provide(harness.layer));
      const oversized = {
        ...payload,
        sources: payload.sources.map((source) => ({
          ...source,
          files: source.files.map((file) => ({ ...file, byteSize: 8 * 1024 * 1024 + 1 })),
        })),
      } as typeof payload;
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          return yield* (yield* Extensions).snapshots.prepareSourceRestore({
            planId:
              "extension-snapshot-source-restore:oversized" as ExtensionSnapshotSourceRestorePlanId,
            snapshotId: "extension-snapshot:oversized" as ExtensionSnapshotId,
            payload: oversized,
          });
        }).pipe(Effect.provide(harness.layer)),
      );
      assert.strictEqual(exit._tag, "Failure");
      assert.strictEqual(
        harness.readFile(`${harness.extensionsRoot}/.svvy/snapshot-restore/oversized/payload.json`),
        null,
      );
      const manifest = payload.sources[0]!.files[0]!;
      const aggregateOversized = {
        ...payload,
        sources: payload.sources.map((source) => ({
          ...source,
          files: [
            ...Array.from({ length: 9 }, (_, index) => ({
              ...manifest,
              relativePath: `${String(index).padStart(3, "0")}.txt`,
              byteSize: 8 * 1024 * 1024,
            })),
            manifest,
          ],
        })),
      } as typeof payload;
      const aggregateExit = yield* Effect.exit(
        Effect.gen(function* () {
          return yield* (yield* Extensions).snapshots.prepareSourceRestore({
            planId:
              "extension-snapshot-source-restore:aggregate-oversized" as ExtensionSnapshotSourceRestorePlanId,
            snapshotId: "extension-snapshot:aggregate-oversized" as ExtensionSnapshotId,
            payload: aggregateOversized,
          });
        }).pipe(Effect.provide(harness.layer)),
      );
      assert.strictEqual(aggregateExit._tag, "Failure");
      assert.strictEqual(
        harness.readFile(
          `${harness.extensionsRoot}/.svvy/snapshot-restore/aggregate-oversized/payload.json`,
        ),
        null,
      );
    }),
  );

  it.effect("finalizes restore staging idempotently and refuses an active journal", () =>
    Effect.gen(function* () {
      const harness = makeSourceEditHarness();
      harness.writeFile(
        `${harness.extensionsRoot}/sources/user/demo/manifest.json`,
        JSON.stringify({ id: "demo" }),
      );
      const payload = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.captureSourcePayload(
          snapshotCaptureInput as never,
        );
      }).pipe(Effect.provide(harness.layer));
      const planId =
        "extension-snapshot-source-restore:finalize" as ExtensionSnapshotSourceRestorePlanId;
      yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.prepareSourceRestore({
          planId,
          snapshotId: "extension-snapshot:finalize" as ExtensionSnapshotId,
          payload,
        });
      }).pipe(Effect.provide(harness.layer));
      harness.writeFile(
        `${harness.extensionsRoot}/.svvy/snapshot-restore/finalize/journal.json`,
        JSON.stringify({ schemaVersion: 1, phase: "prepared" }),
      );
      const active = yield* Effect.exit(
        Effect.gen(function* () {
          return yield* (yield* Extensions).snapshots.finalizeSourceRestore({ planId });
        }).pipe(Effect.provide(harness.layer)),
      );
      assert.strictEqual(active._tag, "Failure");

      const cleanPlanId =
        "extension-snapshot-source-restore:clean-finalize" as ExtensionSnapshotSourceRestorePlanId;
      yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.prepareSourceRestore({
          planId: cleanPlanId,
          snapshotId: "extension-snapshot:clean-finalize" as ExtensionSnapshotId,
          payload,
        });
      }).pipe(Effect.provide(harness.layer));
      const removed = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.finalizeSourceRestore({
          planId: cleanPlanId,
        });
      }).pipe(Effect.provide(harness.layer));
      assert.strictEqual(removed.outcome, "removed");
      const missing = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.finalizeSourceRestore({
          planId: cleanPlanId,
        });
      }).pipe(Effect.provide(harness.layer));
      assert.strictEqual(missing.outcome, "missing");
    }),
  );

  it.effect(
    "rolls back an atomic source promotion failure and can apply the durable plan again",
    () =>
      Effect.gen(function* () {
        const harness = makeSourceEditHarness({
          failRenameToOnce: "/extensions-test/sources/builtin",
        });
        harness.writeFile(
          `${harness.extensionsRoot}/sources/builtin/demo/manifest.json`,
          JSON.stringify({ id: "demo", version: "old" }),
        );
        const payload = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).snapshots.captureSourcePayload(
            snapshotCaptureInput as never,
          );
        }).pipe(Effect.provide(harness.layer));
        const changed = {
          ...payload,
          sources: payload.sources.map((source) => ({
            ...source,
            files: source.files.map((file) =>
              file.relativePath === "manifest.json"
                ? (() => {
                    const bytes = new TextEncoder().encode(
                      JSON.stringify({ id: "demo", version: "new" }),
                    );
                    return {
                      ...file,
                      contentBase64: btoa(String.fromCharCode(...bytes)),
                      contentHash: `sha256:${Array.from(testDigestBytes(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
                      byteSize: bytes.byteLength,
                    };
                  })()
                : file,
            ),
          })),
        } as typeof payload;
        const plan = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).snapshots.prepareSourceRestore({
            planId:
              "extension-snapshot-source-restore:retry" as ExtensionSnapshotSourceRestorePlanId,
            snapshotId: "extension-snapshot:retry" as ExtensionSnapshotId,
            payload: changed,
          });
        }).pipe(Effect.provide(harness.layer));
        const first = yield* Effect.exit(
          Effect.gen(function* () {
            return yield* (yield* Extensions).snapshots.applySourceRestore({ plan });
          }).pipe(Effect.provide(harness.layer)),
        );
        assert.strictEqual(first._tag, "Failure");
        assert.match(
          harness.readFile(`${harness.extensionsRoot}/sources/builtin/demo/manifest.json`)!,
          /old/,
        );
        const receipt = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).snapshots.applySourceRestore({ plan });
        }).pipe(Effect.provide(harness.layer));
        assert.strictEqual(receipt.outcome, "applied");
        assert.match(
          harness.readFile(`${harness.extensionsRoot}/sources/builtin/demo/manifest.json`)!,
          /new/,
        );
      }),
  );

  it.effect(
    "rolls back interruption and recovers the prepared plan through a reopened service",
    () =>
      Effect.gen(function* () {
        const harness = makeSourceEditHarness({
          interruptRenameToOnce: "/extensions-test/sources/builtin",
        });
        harness.writeFile(
          `${harness.extensionsRoot}/sources/builtin/demo/manifest.json`,
          JSON.stringify({ id: "demo" }),
        );
        const payload = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).snapshots.captureSourcePayload(
            snapshotCaptureInput as never,
          );
        }).pipe(Effect.provide(harness.layer));
        const plan = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).snapshots.prepareSourceRestore({
            planId:
              "extension-snapshot-source-restore:interrupted" as ExtensionSnapshotSourceRestorePlanId,
            snapshotId: "extension-snapshot:interrupted" as ExtensionSnapshotId,
            payload,
          });
        }).pipe(Effect.provide(harness.layer));
        const interrupted = yield* Effect.exit(
          Effect.gen(function* () {
            return yield* (yield* Extensions).snapshots.applySourceRestore({ plan });
          }).pipe(Effect.provide(harness.layer)),
        );
        assert.strictEqual(interrupted._tag, "Failure");
        assert.ok(harness.readFile(`${harness.extensionsRoot}/sources/builtin/demo/manifest.json`));
        const recovered = yield* Effect.gen(function* () {
          return yield* (yield* Extensions).snapshots.applySourceRestore({ plan });
        }).pipe(Effect.provide(harness.layer));
        assert.strictEqual(recovered.outcome, "applied");
      }),
  );

  it.effect("restores shared package state and replays a committed promotion idempotently", () =>
    Effect.gen(function* () {
      const harness = makeSourceEditHarness();
      harness.writeFile(
        `${harness.extensionsRoot}/sources/user/demo/manifest.json`,
        JSON.stringify({ id: "demo" }),
      );
      harness.writeFile(`${harness.extensionsRoot}/package/package.json`, '{"version":"before"}');
      harness.writeFile(`${harness.extensionsRoot}/package/bun.lock`, "before-lock");
      const payload = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.captureSourcePayload(
          snapshotCaptureInput as never,
        );
      }).pipe(Effect.provide(harness.layer));
      harness.writeFile(
        `${harness.extensionsRoot}/sources/user/removed/manifest.json`,
        JSON.stringify({ id: "removed" }),
      );
      harness.writeFile(`${harness.extensionsRoot}/package/package.json`, '{"version":"after"}');
      harness.writeFile(`${harness.extensionsRoot}/package/bun.lock`, "after-lock");
      harness.writeFile(`${harness.extensionsRoot}/package/node_modules/transient/index.js`, "x");
      const plan = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.prepareSourceRestore({
          planId:
            "extension-snapshot-source-restore:package-replay" as ExtensionSnapshotSourceRestorePlanId,
          snapshotId: "extension-snapshot:package-replay" as ExtensionSnapshotId,
          payload,
        });
      }).pipe(Effect.provide(harness.layer));
      const applied = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.applySourceRestore({ plan });
      }).pipe(Effect.provide(harness.layer));
      assert.strictEqual(applied.outcome, "applied");
      assert.deepStrictEqual(applied.removedUserExtensionIds.map(String), ["removed"]);
      assert.strictEqual(
        harness.readFile(`${harness.extensionsRoot}/package/package.json`),
        '{"version":"before"}',
      );
      assert.strictEqual(
        harness.readFile(`${harness.extensionsRoot}/package/bun.lock`),
        "before-lock",
      );
      assert.strictEqual(
        harness.readFile(`${harness.extensionsRoot}/package/node_modules/transient/index.js`),
        null,
      );
      const reopenedPlan = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.prepareSourceRestore({
          planId: plan.planId,
          snapshotId: plan.snapshotId,
          payload,
        });
      }).pipe(Effect.provide(harness.layer));
      const replayed = yield* Effect.gen(function* () {
        return yield* (yield* Extensions).snapshots.applySourceRestore({ plan: reopenedPlan });
      }).pipe(Effect.provide(harness.layer));
      assert.strictEqual(replayed.outcome, "recovered");
      assert.deepStrictEqual(replayed.removedUserExtensionIds.map(String), ["removed"]);
    }),
  );
});

function testSha256(value: string): string {
  return `sha256:${Array.from(testDigestBytes(new TextEncoder().encode(value)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function testDigestBytes(data: Uint8Array): Uint8Array {
  const digest = new Uint8Array(32);
  for (let index = 0; index < data.length; index += 1) {
    digest[index % digest.length] = (digest[index % digest.length]! * 33 + data[index]!) & 0xff;
  }
  return digest;
}

function testEvidenceFingerprint(
  domain: string,
  entries: readonly (readonly [role: string, relativePath: string, contentHash: string])[],
): string {
  const framed = [domain, ...entries.flatMap((entry) => entry)]
    .map((part) => `${new TextEncoder().encode(part).byteLength}:${part}`)
    .join("");
  return testSha256(framed);
}

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
    | ExtensionBuildProcessPort
    | ExtensionCliRequirementProbePort
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
      resolve: (...segments: readonly string[]) => resolvePath(...segments),
    } as unknown as Path.Path),
    Effect.provideService(
      Crypto.Crypto,
      Crypto.make({
        digest: (_algorithm, data) => Effect.succeed(testDigestBytes(data)),
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
    Effect.provideService(ExtensionCliRequirementProbePort, {
      probe: () => Effect.succeed({ status: "missing" }),
    }),
    Effect.provideService(ExtensionBuildProcessPort, {
      run: () => Effect.succeed({ status: "failed", stage: "spawn" }),
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

function resolvePath(...segments: readonly string[]): string {
  const resolved: string[] = [];
  for (const segment of segments.join("/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return `/${resolved.join("/")}`;
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
