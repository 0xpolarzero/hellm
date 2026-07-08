import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  ExtensionStatePort,
  type AbsolutePath,
  type ExtensionDependencyApprovalIdentity,
} from "@svvy/core";
import {
  generatedExtensionExportIds,
  generatedExtensionExportIdsFromHost,
  generatedExtensionReferenceExpression,
  generatedExtensionsPackageContents,
  generatedExtensionsPackageContentsFromHost,
  GENERATED_PACKAGE_EVIDENCE_MANIFEST,
  renderGeneratedExtensionsPackageFiles,
  renderGeneratedExtensionsPackageIndex,
  renderGeneratedExtensionsPackageJson,
  writeGeneratedExtensionsPackage,
  type GeneratedExtensionDependencyDeclaration,
  type GeneratedExtensionExportDiscoveryServices,
  type GeneratedExtensionExportDiscoveryHost,
} from "./generated-extensions-package";

describe("generated extensions package", () => {
  it("renders the exact @svvyx/extensions package manifest", () => {
    assert.deepStrictEqual(JSON.parse(renderGeneratedExtensionsPackageJson()), {
      name: "@svvyx/extensions",
      type: "module",
      exports: {
        ".": "./index.ts",
      },
    });
  });

  it("emits extension references only, not execute_typescript generated TypeScript facades", () => {
    const index = renderGeneratedExtensionsPackageIndex(["artifacts", "workflows"]);

    assert.include(index, "export const Extensions = {");
    assert.include(index, '"artifacts": {"id":"artifacts"}');
    assert.include(index, '"workflows": {"id":"workflows"}');
    assert.notInclude(index, "slug");
    assert.notInclude(index, "name");
    assert.notInclude(index, "kind");
    assert.notInclude(index, "workflowTaskAgentUsage");
    assert.notInclude(index, ".run");
    assert.notInclude(index, "createExtensionsFacade");
    assert.notInclude(index, "executeTypescriptFacadeDeclarations");
    assert.notInclude(index, "nativeTools");
    assert.notInclude(index, "Context.Service");
    assert.notInclude(index, "Layer");
    assert.notInclude(index, "ManagedRuntime");
  });

  it("uses canonical extension ids as keys instead of generated aliases", () => {
    const index = renderGeneratedExtensionsPackageIndex(["linear-tools", "linear_tools"]);

    assert.include(index, '"linear-tools": {"id":"linear-tools"');
    assert.include(index, '"linear_tools": {"id":"linear_tools"');
    assert.notInclude(index, "linearTools");
    assert.notInclude(index, "linearTools2");
  });

  it("renders package files in write order", () => {
    const files = renderGeneratedExtensionsPackageFiles(new Set(["git"]));

    assert.deepStrictEqual(
      files.map((file) => file.relativePath),
      ["package.json", "index.ts", GENERATED_PACKAGE_EVIDENCE_MANIFEST],
    );
    assert.strictEqual(files[0]?.contents, renderGeneratedExtensionsPackageJson());
    assert.strictEqual(files[1]?.contents, renderGeneratedExtensionsPackageIndex(["git"]));
    const manifest = JSON.parse(files[2]?.contents ?? "");
    assert.deepStrictEqual(
      {
        schemaVersion: manifest.schemaVersion,
        packageName: manifest.packageName,
        extensionIds: manifest.extensionIds,
        generatedFiles: manifest.generatedFiles,
        dependencies: manifest.dependencies,
        createdAt: manifest.createdAt,
      },
      {
        schemaVersion: 1,
        packageName: "@svvyx/extensions",
        extensionIds: ["git"],
        generatedFiles: ["package.json", "index.ts"],
        dependencies: [],
        createdAt: "1970-01-01T00:00:00.000Z",
      },
    );
  });

  it("renders build evidence in the generated-package manifest separately from package.json", () => {
    const manifest = JSON.parse(
      renderGeneratedExtensionsPackageFiles(["workflows", "git"], {
        dependencies: [],
      }).find((file) => file.relativePath === GENERATED_PACKAGE_EVIDENCE_MANIFEST)?.contents ?? "",
    );

    assert.match(manifest.buildId, /^@svvyx\/extensions:svvy-fnv64-v1:[0-9a-f]{16}$/);
    assert.match(manifest.sourceFingerprint, /^svvy-fnv64-v1:[0-9a-f]{16}$/);
    assert.match(manifest.outputFingerprint, /^svvy-fnv64-v1:[0-9a-f]{16}$/);
    assert.deepStrictEqual(
      {
        schemaVersion: manifest.schemaVersion,
        packageName: manifest.packageName,
        dependencies: manifest.dependencies,
        createdAt: manifest.createdAt,
        extensionIds: manifest.extensionIds,
        generatedFiles: manifest.generatedFiles,
      },
      {
        schemaVersion: 1,
        packageName: "@svvyx/extensions",
        dependencies: [],
        createdAt: "1970-01-01T00:00:00.000Z",
        extensionIds: ["git", "workflows"],
        generatedFiles: ["package.json", "index.ts"],
      },
    );
  });

  it("renders extension reference expressions for identifier-safe and quoted ids", () => {
    assert.strictEqual(generatedExtensionReferenceExpression("git"), "Extensions.git.id");
    assert.strictEqual(
      generatedExtensionReferenceExpression("apply-patch"),
      'Extensions["apply-patch"].id',
    );
  });

  it.effect("discovers builtin ids and ready user svvyx extension references", () =>
    Effect.gen(function* () {
      const root = "/extensions" as AbsolutePath;
      const dependency = {
        kind: "dependency",
        name: "@scope/tool",
        version: "1.2.3",
      } as const;
      const blockedDependency = {
        kind: "dependency",
        name: "@scope/blocked",
        version: "1.0.0",
      } as const;
      const services = fakeDiscoveryServices({
        directories: {
          "/extensions/sources/user": ["ready", "stale", "blocked"],
        },
        jsonObjects: {
          "/extensions/sources/user/ready/manifest.json": sourceManifest("ready"),
          "/extensions/sources/user/stale/manifest.json": sourceManifest("stale"),
          "/extensions/sources/user/blocked/manifest.json": sourceManifest("blocked"),
          "/extensions/builds/extensions/ready/current/manifest.json": buildManifest({
            dependency,
            extensionId: "ready",
            sourceFingerprint: "source-ready",
          }),
          "/extensions/builds/extensions/stale/current/manifest.json": buildManifest({
            dependency,
            extensionId: "stale",
            sourceFingerprint: "old",
          }),
          "/extensions/builds/extensions/blocked/current/manifest.json": buildManifest({
            dependency: blockedDependency,
            extensionId: "blocked",
            sourceFingerprint: "source-blocked",
          }),
          "/extensions/package/node_modules/@scope/tool/package.json": {
            name: "@scope/tool",
            version: "1.2.3",
          },
        },
        approvedDependencies: [dependency],
        fingerprints: {
          "/extensions/sources/user/ready": "source-ready",
          "/extensions/sources/user/stale": "source-stale",
          "/extensions/sources/user/blocked": "source-blocked",
        },
      });

      assert.deepStrictEqual(
        [
          ...(yield* runDiscovery(
            generatedExtensionExportIds({ builtinExtensionIds: ["git"], extensionsRoot: root }),
            services,
          )),
        ],
        ["git", "ready"],
      );
    }),
  );

  it("discovers the same generated references through the non-Effect host boundary", () => {
    const root = "/extensions" as AbsolutePath;
    const dependency = {
      kind: "dependency",
      name: "@scope/tool",
      version: "1.2.3",
    } as const;
    const input = {
      directories: {
        "/extensions/sources/user": ["ready", "stale"],
      },
      jsonObjects: {
        "/extensions/sources/user/ready/manifest.json": sourceManifest("ready"),
        "/extensions/sources/user/stale/manifest.json": sourceManifest("stale"),
        "/extensions/builds/extensions/ready/current/manifest.json": buildManifest({
          dependency,
          extensionId: "ready",
          sourceFingerprint: "source-ready",
        }),
        "/extensions/builds/extensions/stale/current/manifest.json": buildManifest({
          dependency,
          extensionId: "stale",
          sourceFingerprint: "old",
        }),
        "/extensions/package/node_modules/@scope/tool/package.json": {
          name: "@scope/tool",
          version: "1.2.3",
        },
      },
      approvedDependencies: [dependency],
      fingerprints: {
        "/extensions/sources/user/ready": "source-ready",
        "/extensions/sources/user/stale": "source-stale",
      },
    };

    assert.deepStrictEqual(
      [
        ...generatedExtensionExportIdsFromHost(
          { builtinExtensionIds: ["git"], extensionsRoot: root },
          fakeDiscoveryHost(input),
        ),
      ],
      ["git", "ready"],
    );
    const hostContents = generatedExtensionsPackageContentsFromHost(
      { builtinExtensionIds: ["git"], extensionsRoot: root },
      fakeDiscoveryHost(input),
    );
    assert.deepStrictEqual(hostContents.dependencies, []);
    assert.deepStrictEqual(
      hostContents.files,
      renderGeneratedExtensionsPackageFiles(["git", "ready"], {
        dependencies: [],
        sourceFingerprintParts: ["git\u0000builtin:git", "ready\u0000source-ready"],
      }),
    );

    const changedSourceContents = generatedExtensionsPackageContentsFromHost(
      { builtinExtensionIds: ["git"], extensionsRoot: root },
      fakeDiscoveryHost({
        ...input,
        fingerprints: {
          "/extensions/sources/user/ready": "source-ready-v2",
          "/extensions/sources/user/stale": "source-stale",
        },
        jsonObjects: {
          ...input.jsonObjects,
          "/extensions/builds/extensions/ready/current/manifest.json": buildManifest({
            dependency,
            extensionId: "ready",
            sourceFingerprint: "source-ready-v2",
          }),
        },
      }),
    );
    assert.notStrictEqual(
      changedSourceContents.evidence.sourceFingerprint,
      hostContents.evidence.sourceFingerprint,
    );
  });

  it.effect("defaults builtin references to workflow-task-safe ids", () =>
    Effect.gen(function* () {
      const services = fakeDiscoveryServices({
        directories: {
          "/extensions/sources/user": [],
        },
        jsonObjects: {},
        approvedDependencies: [],
        fingerprints: {},
      });

      assert.deepStrictEqual(
        [
          ...(yield* runDiscovery(
            generatedExtensionExportIds({ extensionsRoot: "/extensions" as AbsolutePath }),
            services,
          )),
        ],
        [
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
      );
    }),
  );

  it.effect("builds generated package contents from package-owned reference discovery", () =>
    Effect.gen(function* () {
      const services = fakeDiscoveryServices({
        directories: {
          "/extensions/sources/user": [],
        },
        jsonObjects: {},
        approvedDependencies: [],
        fingerprints: {},
      });

      const contents = yield* runDiscovery(
        generatedExtensionsPackageContents({
          builtinExtensionIds: ["workflows", "git"],
          extensionsRoot: "/extensions" as AbsolutePath,
        }),
        services,
      );

      assert.deepStrictEqual(contents.extensionIds, ["git", "workflows"]);
      assert.deepStrictEqual(contents.dependencies, []);
      assert.deepStrictEqual(
        contents.files,
        renderGeneratedExtensionsPackageFiles(["git", "workflows"]),
      );
    }),
  );

  it.effect("replaces generated package contents only after every staged file writes", () =>
    Effect.gen(function* () {
      const services = fakeGeneratedPackageWriteServices({
        initialFiles: {
          "/generated/@svvyx/extensions/package.json": "old package",
          "/generated/@svvyx/extensions/index.ts": "old index",
        },
      });

      const result = yield* runGeneratedPackageWrite(
        writeGeneratedExtensionsPackage({
          generatedPackagePath: "/generated/@svvyx/extensions" as AbsolutePath,
          extensionExportIds: ["git"],
          createdAt: "2026-06-25T00:00:00.000Z" as never,
        }),
        services,
      );

      assert.deepStrictEqual(
        result.generatedFiles.map((file) => file.relativePath),
        ["package.json", "index.ts", GENERATED_PACKAGE_EVIDENCE_MANIFEST],
      );
      assert.include(
        services.readFile("/generated/@svvyx/extensions/package.json"),
        '"name": "@svvyx/extensions"',
      );
      assert.include(
        services.readFile("/generated/@svvyx/extensions/index.ts"),
        '"git": {"id":"git"}',
      );
      assert.include(
        services.readFile("/generated/@svvyx/extensions/.svvy-generated-package.json"),
        '"extensionIds": [',
      );
      assert.strictEqual(services.hasStagedPath(), false);
    }),
  );

  it.effect("leaves the live generated package untouched when a staged write fails", () =>
    Effect.gen(function* () {
      const services = fakeGeneratedPackageWriteServices({
        failWriteRelativePath: "index.ts",
        initialFiles: {
          "/generated/@svvyx/extensions/package.json": "old package",
          "/generated/@svvyx/extensions/index.ts": "old index",
        },
      });

      const exit = yield* runGeneratedPackageWrite(
        writeGeneratedExtensionsPackage({
          generatedPackagePath: "/generated/@svvyx/extensions" as AbsolutePath,
          extensionExportIds: ["git"],
          createdAt: "2026-06-25T00:00:00.000Z" as never,
        }),
        services,
      ).pipe(Effect.exit);

      assert.strictEqual(Exit.isFailure(exit), true);
      assert.include(String(exit), "Injected staged write failure");
      assert.strictEqual(
        services.readFile("/generated/@svvyx/extensions/package.json"),
        "old package",
      );
      assert.strictEqual(services.readFile("/generated/@svvyx/extensions/index.ts"), "old index");
      assert.strictEqual(
        services.readFile("/generated/@svvyx/extensions/.svvy-generated-package.json"),
        null,
      );
      assert.strictEqual(services.hasStagedPath(), false);
    }),
  );

  it.effect("restores the live generated package when promotion fails after backup", () =>
    Effect.gen(function* () {
      const services = fakeGeneratedPackageWriteServices({
        failNextPromotionToPath: "/generated/@svvyx/extensions",
        initialFiles: {
          "/generated/@svvyx/extensions/package.json": "old package",
          "/generated/@svvyx/extensions/index.ts": "old index",
        },
      });

      const exit = yield* runGeneratedPackageWrite(
        writeGeneratedExtensionsPackage({
          generatedPackagePath: "/generated/@svvyx/extensions" as AbsolutePath,
          extensionExportIds: ["git"],
          createdAt: "2026-06-25T00:00:00.000Z" as never,
        }),
        services,
      ).pipe(Effect.exit);

      assert.strictEqual(Exit.isFailure(exit), true);
      assert.include(String(exit), "Injected generated package promotion failure");
      assert.strictEqual(
        services.readFile("/generated/@svvyx/extensions/package.json"),
        "old package",
      );
      assert.strictEqual(services.readFile("/generated/@svvyx/extensions/index.ts"), "old index");
      assert.strictEqual(
        services.readFile("/generated/@svvyx/extensions/.svvy-generated-package.json"),
        null,
      );
      assert.strictEqual(services.hasStagedPath(), false);
    }),
  );

  it.effect("excludes user svvyx extensions with invalid command manifests", () =>
    Effect.gen(function* () {
      const dependency = {
        kind: "dependency",
        name: "tool",
        version: "1.0.0",
      } as const;
      const input = {
        directories: {
          "/extensions/sources/user": ["invalid"],
        },
        jsonObjects: {
          "/extensions/sources/user/invalid/manifest.json": sourceManifest("invalid"),
          "/extensions/builds/extensions/invalid/current/manifest.json": {
            ...buildManifest({
              dependency,
              extensionId: "invalid",
              sourceFingerprint: "source-invalid",
            }),
            commandManifest: {
              version: "incur.v1",
              commands: [{ name: "run", aliases: [123] }],
            },
          },
          "/extensions/package/node_modules/tool/package.json": {
            name: "tool",
            version: "1.0.0",
          },
        },
        approvedDependencies: [dependency],
        fingerprints: {
          "/extensions/sources/user/invalid": "source-invalid",
        },
      };
      const services = fakeDiscoveryServices(input);

      assert.deepStrictEqual(
        [
          ...(yield* runDiscovery(
            generatedExtensionExportIds({
              builtinExtensionIds: [],
              extensionsRoot: "/extensions" as AbsolutePath,
            }),
            services,
          )),
        ],
        [],
      );
      assert.deepStrictEqual(
        [
          ...generatedExtensionExportIdsFromHost(
            {
              builtinExtensionIds: [],
              extensionsRoot: "/extensions" as AbsolutePath,
            },
            fakeDiscoveryHost(input),
          ),
        ],
        [],
      );
    }),
  );

  it.effect(
    "excludes user svvyx extensions that do not explicitly opt into workflow task-agent reference exports",
    () =>
      Effect.gen(function* () {
        const dependency = {
          kind: "dependency",
          name: "tool",
          version: "1.0.0",
        } as const;
        const manifest = sourceManifest("not-opted-in");
        delete manifest.workflowTaskAgentReferenceExportEnabled;
        const input = {
          directories: {
            "/extensions/sources/user": ["not-opted-in"],
          },
          jsonObjects: {
            "/extensions/sources/user/not-opted-in/manifest.json": manifest,
            "/extensions/builds/extensions/not-opted-in/current/manifest.json": buildManifest({
              dependency,
              extensionId: "not-opted-in",
              sourceFingerprint: "source-not-opted-in",
            }),
            "/extensions/package/node_modules/tool/package.json": {
              name: "tool",
              version: "1.0.0",
            },
          },
          approvedDependencies: [dependency],
          fingerprints: {
            "/extensions/sources/user/not-opted-in": "source-not-opted-in",
          },
        };
        const services = fakeDiscoveryServices(input);

        assert.deepStrictEqual(
          [
            ...(yield* runDiscovery(
              generatedExtensionExportIds({
                builtinExtensionIds: [],
                extensionsRoot: "/extensions" as AbsolutePath,
              }),
              services,
            )),
          ],
          [],
        );
        assert.deepStrictEqual(
          [
            ...generatedExtensionExportIdsFromHost(
              {
                builtinExtensionIds: [],
                extensionsRoot: "/extensions" as AbsolutePath,
              },
              fakeDiscoveryHost(input),
            ),
          ],
          [],
        );
      }),
  );
});

function sourceManifest(extensionId: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: extensionId,
    interface: "svvyx",
    typescriptApiEnabled: true,
    workflowTaskAgentReferenceExportEnabled: true,
  };
}

function buildManifest(input: {
  dependency: GeneratedExtensionDependencyDeclaration;
  extensionId: string;
  sourceFingerprint: string;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    extensionId: input.extensionId,
    interface: "svvyx",
    module: "index.ts",
    typescriptTypes: `/extensions/generated/extensions/${input.extensionId}/types.d.ts`,
    commandManifest: {
      version: "incur.v1",
      commands: [{ name: "run" }],
    },
    sourceFingerprint: input.sourceFingerprint,
    dependencies: [input.dependency],
  };
}

function runDiscovery<A>(
  effect: Effect.Effect<A, unknown, GeneratedExtensionExportDiscoveryServices>,
  services: ReturnType<typeof fakeDiscoveryServices>,
): Effect.Effect<A, unknown> {
  return effect.pipe(
    Effect.provideService(FileSystem.FileSystem, services.fileSystem),
    Effect.provideService(Path.Path, services.path),
    Effect.provideService(ExtensionStatePort, services.extensionState),
  );
}

function runGeneratedPackageWrite<A>(
  effect: Effect.Effect<A, unknown, FileSystem.FileSystem | Path.Path>,
  services: ReturnType<typeof fakeGeneratedPackageWriteServices>,
): Effect.Effect<A, unknown> {
  return effect.pipe(
    Effect.provideService(FileSystem.FileSystem, services.fileSystem),
    Effect.provideService(Path.Path, services.path),
  );
}

function fakeDiscoveryServices(input: {
  directories: Record<string, readonly string[]>;
  jsonObjects: Record<string, Record<string, unknown>>;
  approvedDependencies: readonly GeneratedExtensionDependencyDeclaration[];
  fingerprints: Record<string, string>;
}) {
  const directoryPaths = new Set(Object.keys(input.directories));
  for (const [parentPath, children] of Object.entries(input.directories)) {
    for (const child of children) {
      directoryPaths.add(joinPathSegments(parentPath, child));
    }
  }
  return {
    fileSystem: {
      readDirectory: (path: string) => Effect.succeed([...(input.directories[path] ?? [])]),
      stat: (path: string) =>
        Effect.succeed({
          type: directoryPaths.has(path) ? "Directory" : "File",
        }),
      readFileString: (path: string) => {
        const jsonObject = input.jsonObjects[path];
        if (!jsonObject) {
          return Effect.fail(new Error(`Missing fake JSON object: ${path}`));
        }
        return Effect.succeed(JSON.stringify(jsonObject));
      },
    } as unknown as FileSystem.FileSystem,
    path: {
      join: (...segments: readonly string[]) => segments.join("/").replaceAll(/\/+/g, "/"),
    } as unknown as Path.Path,
    extensionState: {
      records: {
        readSourceFingerprint: ({ sourceRoot }: { readonly sourceRoot: AbsolutePath }) =>
          Effect.succeed(input.fingerprints[sourceRoot] ?? null),
      },
      dependencies: {
        isApproved: ({
          dependency,
        }: {
          readonly dependency: ExtensionDependencyApprovalIdentity;
        }) =>
          Effect.succeed(
            input.approvedDependencies.some(
              (approved) =>
                approved.kind === dependency.kind &&
                dependency.packageManager === "bun" &&
                dependency.source === "npm" &&
                approved.name === dependency.name &&
                approved.version === dependency.version &&
                dependency.integrity === null &&
                dependency.resolution === null,
            ),
          ),
        readReadiness: () => Effect.succeed(null),
      },
    },
  };
}

function fakeDiscoveryHost(input: {
  directories: Record<string, readonly string[]>;
  jsonObjects: Record<string, Record<string, unknown>>;
  approvedDependencies: readonly GeneratedExtensionDependencyDeclaration[];
  fingerprints: Record<string, string>;
}): GeneratedExtensionExportDiscoveryHost {
  const directoryPaths = new Set(Object.keys(input.directories));
  for (const [parentPath, children] of Object.entries(input.directories)) {
    for (const child of children) {
      directoryPaths.add(joinPathSegments(parentPath, child));
    }
  }
  return {
    isDependencyApproved: (dependency) =>
      input.approvedDependencies.some(
        (approved) =>
          approved.kind === dependency.kind &&
          dependency.packageManager === "bun" &&
          dependency.source === "npm" &&
          approved.name === dependency.name &&
          approved.version === dependency.version &&
          dependency.integrity === null &&
          dependency.resolution === null,
      ),
    join: joinPathSegments,
    readDirectory: (path) => input.directories[path] ?? [],
    readFileString: (path) => {
      const jsonObject = input.jsonObjects[path];
      return jsonObject ? JSON.stringify(jsonObject) : null;
    },
    sourceFingerprint: (sourceRoot) => input.fingerprints[sourceRoot] ?? null,
    statType: (path) => (directoryPaths.has(path) ? "Directory" : "File"),
  };
}

function joinPathSegments(...segments: readonly string[]): string {
  return segments.join("/").replaceAll(/\/+/g, "/");
}

function fakeGeneratedPackageWriteServices(input: {
  initialFiles: Record<string, string>;
  failWriteRelativePath?: string;
  failNextPromotionToPath?: string;
}) {
  const files = new Map(Object.entries(input.initialFiles));
  const directories = new Set<string>(["/", "/generated", "/generated/@svvyx"]);
  for (const filePath of files.keys()) {
    addDirectoryChain(directories, dirnamePath(filePath));
  }
  let tempCounter = 0;
  let promotionFailureInjected = false;

  const movePath = (fromPath: string, toPath: string) => {
    if (!pathExists(files, directories, fromPath)) {
      throw new Error(`Cannot rename missing path: ${fromPath}`);
    }
    const movedFiles = [...files.entries()].filter(
      ([filePath]) => filePath === fromPath || filePath.startsWith(`${fromPath}/`),
    );
    const movedDirectories = [...directories].filter(
      (directoryPath) => directoryPath === fromPath || directoryPath.startsWith(`${fromPath}/`),
    );
    removePath(files, directories, toPath);
    removePath(files, directories, fromPath);
    for (const directoryPath of movedDirectories) {
      directories.add(`${toPath}${directoryPath.slice(fromPath.length)}`);
    }
    for (const [filePath, contents] of movedFiles) {
      files.set(`${toPath}${filePath.slice(fromPath.length)}`, contents);
    }
    addDirectoryChain(directories, dirnamePath(toPath));
  };

  return {
    fileSystem: {
      exists: (path: string) => Effect.succeed(pathExists(files, directories, path)),
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
      remove: (path: string) =>
        Effect.sync(() => {
          removePath(files, directories, path);
        }),
      rename: (fromPath: string, toPath: string) =>
        Effect.sync(() => {
          if (
            input.failNextPromotionToPath === toPath &&
            fromPath.includes("/.svvy-") &&
            !promotionFailureInjected
          ) {
            promotionFailureInjected = true;
            throw new Error("Injected generated package promotion failure");
          }
          movePath(fromPath, toPath);
        }),
      writeFileString: (path: string, contents: string) =>
        Effect.sync(() => {
          if (input.failWriteRelativePath && path.endsWith(`/${input.failWriteRelativePath}`)) {
            throw new Error("Injected staged write failure");
          }
          addDirectoryChain(directories, dirnamePath(path));
          files.set(path, contents);
        }),
    } as unknown as FileSystem.FileSystem,
    path: {
      basename: basenamePath,
      dirname: dirnamePath,
      join: joinPathSegments,
    } as unknown as Path.Path,
    hasStagedPath: () => [...directories].some((path) => path.includes("/.svvy-")),
    readFile: (path: string) => files.get(path) ?? null,
  };
}

function pathExists(files: Map<string, string>, directories: Set<string>, path: string): boolean {
  return files.has(path) || directories.has(path);
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

function removePath(files: Map<string, string>, directories: Set<string>, path: string): void {
  const filePaths = Array.from(files.keys()).filter(
    (filePath) => filePath === path || filePath.startsWith(`${path}/`),
  );
  const directoryPaths = Array.from(directories).filter(
    (directoryPath) => directoryPath === path || directoryPath.startsWith(`${path}/`),
  );

  for (const filePath of filePaths) {
    files.delete(filePath);
  }
  for (const directoryPath of directoryPaths) {
    directories.delete(directoryPath);
  }
}

function dirnamePath(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) {
    return "/";
  }
  return path.slice(0, index);
}

function basenamePath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}
