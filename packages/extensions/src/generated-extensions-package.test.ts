import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
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
import { runTestEffect } from "./effect.test-support";

describe("generated extensions package", () => {
  it("renders the exact @svvyx/extensions package manifest", () => {
    expect(JSON.parse(renderGeneratedExtensionsPackageJson())).toEqual({
      name: "@svvyx/extensions",
      type: "module",
      exports: {
        ".": "./index.ts",
      },
    });
  });

  it("emits extension references only, not execute_typescript generated TypeScript facades", () => {
    const index = renderGeneratedExtensionsPackageIndex(["artifacts", "workflows"]);

    expect(index).toContain("export const Extensions = {");
    expect(index).toContain('"artifacts": {"id":"artifacts"}');
    expect(index).toContain('"workflows": {"id":"workflows"}');
    expect(index).not.toContain("slug");
    expect(index).not.toContain("name");
    expect(index).not.toContain("kind");
    expect(index).not.toContain("workflowTaskAgentUsage");
    expect(index).not.toContain(".run");
    expect(index).not.toContain("createExtensionsFacade");
    expect(index).not.toContain("executeTypescriptFacadeDeclarations");
    expect(index).not.toContain("nativeTools");
    expect(index).not.toContain("Context.Service");
    expect(index).not.toContain("Layer");
    expect(index).not.toContain("ManagedRuntime");
  });

  it("uses canonical extension ids as keys instead of generated aliases", () => {
    const index = renderGeneratedExtensionsPackageIndex(["linear-tools", "linear_tools"]);

    expect(index).toContain('"linear-tools": {"id":"linear-tools"');
    expect(index).toContain('"linear_tools": {"id":"linear_tools"');
    expect(index).not.toContain("linearTools");
    expect(index).not.toContain("linearTools2");
  });

  it("renders package files in write order", () => {
    const files = renderGeneratedExtensionsPackageFiles(new Set(["git"]));

    expect(files.map((file) => file.relativePath)).toEqual([
      "package.json",
      "index.ts",
      GENERATED_PACKAGE_EVIDENCE_MANIFEST,
    ]);
    expect(files[0]?.contents).toBe(renderGeneratedExtensionsPackageJson());
    expect(files[1]?.contents).toBe(renderGeneratedExtensionsPackageIndex(["git"]));
    expect(JSON.parse(files[2]?.contents ?? "")).toMatchObject({
      schemaVersion: 1,
      packageName: "@svvyx/extensions",
      extensionIds: ["git"],
      generatedFiles: ["package.json", "index.ts"],
      dependencies: [],
      createdAt: "1970-01-01T00:00:00.000Z",
    });
  });

  it("renders build evidence in the generated-package manifest separately from package.json", () => {
    const manifest = JSON.parse(
      renderGeneratedExtensionsPackageFiles(["workflows", "git"], {
        dependencies: [
          {
            kind: "package",
            name: "@scope/tool",
            resolution: "package-manager",
            version: "1.2.3",
          },
        ],
      }).find((file) => file.relativePath === GENERATED_PACKAGE_EVIDENCE_MANIFEST)?.contents ?? "",
    );

    expect(manifest).toEqual({
      schemaVersion: 1,
      packageName: "@svvyx/extensions",
      buildId: expect.stringMatching(/^@svvyx\/extensions:svvy-fnv64-v1:[0-9a-f]{16}$/),
      sourceFingerprint: expect.stringMatching(/^svvy-fnv64-v1:[0-9a-f]{16}$/),
      outputFingerprint: expect.stringMatching(/^svvy-fnv64-v1:[0-9a-f]{16}$/),
      dependencies: [
        {
          kind: "package",
          name: "@scope/tool",
          resolution: "package-manager",
          version: "1.2.3",
        },
      ],
      createdAt: "1970-01-01T00:00:00.000Z",
      extensionIds: ["git", "workflows"],
      generatedFiles: ["package.json", "index.ts"],
    });
  });

  it("renders extension reference expressions for identifier-safe and quoted ids", () => {
    expect(generatedExtensionReferenceExpression("git")).toBe("Extensions.git.id");
    expect(generatedExtensionReferenceExpression("apply-patch")).toBe(
      'Extensions["apply-patch"].id',
    );
  });

  it("discovers builtin ids and ready user svvyx extension references", async () => {
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

    expect([
      ...(await runDiscovery(
        generatedExtensionExportIds({ builtinExtensionIds: ["git"], extensionsRoot: root }),
        services,
      )),
    ]).toEqual(["git", "ready"]);
  });

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

    expect([
      ...generatedExtensionExportIdsFromHost(
        { builtinExtensionIds: ["git"], extensionsRoot: root },
        fakeDiscoveryHost(input),
      ),
    ]).toEqual(["git", "ready"]);
    const hostContents = generatedExtensionsPackageContentsFromHost(
      { builtinExtensionIds: ["git"], extensionsRoot: root },
      fakeDiscoveryHost(input),
    );
    expect(hostContents.dependencies).toEqual([
      {
        kind: "package",
        name: "@scope/tool",
        resolution: "package-manager",
        version: "1.2.3",
      },
    ]);
    expect(hostContents.files).toEqual(
      renderGeneratedExtensionsPackageFiles(["git", "ready"], {
        dependencies: [
          {
            kind: "package",
            name: "@scope/tool",
            resolution: "package-manager",
            version: "1.2.3",
          },
        ],
      }),
    );
  });

  it("defaults builtin references to workflow-task-safe ids", async () => {
    const services = fakeDiscoveryServices({
      directories: {
        "/extensions/sources/user": [],
      },
      jsonObjects: {},
      approvedDependencies: [],
      fingerprints: {},
    });

    expect([
      ...(await runDiscovery(
        generatedExtensionExportIds({ extensionsRoot: "/extensions" as AbsolutePath }),
        services,
      )),
    ]).toEqual([
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
    ]);
  });

  it("builds generated package contents from package-owned reference discovery", async () => {
    const services = fakeDiscoveryServices({
      directories: {
        "/extensions/sources/user": [],
      },
      jsonObjects: {},
      approvedDependencies: [],
      fingerprints: {},
    });

    const contents = await runDiscovery(
      generatedExtensionsPackageContents({
        builtinExtensionIds: ["workflows", "git"],
        extensionsRoot: "/extensions" as AbsolutePath,
      }),
      services,
    );

    expect(contents.extensionIds).toEqual(["git", "workflows"]);
    expect(contents.dependencies).toEqual([]);
    expect(contents.files).toEqual(renderGeneratedExtensionsPackageFiles(["git", "workflows"]));
  });

  it("replaces generated package contents only after every staged file writes", async () => {
    const services = fakeGeneratedPackageWriteServices({
      initialFiles: {
        "/generated/@svvyx/extensions/package.json": "old package",
        "/generated/@svvyx/extensions/index.ts": "old index",
      },
    });

    const result = await runGeneratedPackageWrite(
      writeGeneratedExtensionsPackage({
        generatedPackagePath: "/generated/@svvyx/extensions" as AbsolutePath,
        extensionExportIds: ["git"],
        createdAt: "2026-06-25T00:00:00.000Z" as never,
      }),
      services,
    );

    expect(result.generatedFiles.map((file) => file.relativePath)).toEqual([
      "package.json",
      "index.ts",
      GENERATED_PACKAGE_EVIDENCE_MANIFEST,
    ]);
    expect(services.readFile("/generated/@svvyx/extensions/package.json")).toContain(
      '"name": "@svvyx/extensions"',
    );
    expect(services.readFile("/generated/@svvyx/extensions/index.ts")).toContain(
      '"git": {"id":"git"}',
    );
    expect(
      services.readFile("/generated/@svvyx/extensions/.svvy-generated-package.json"),
    ).toContain('"extensionIds": [');
    expect(services.hasStagedPath()).toBe(false);
  });

  it("leaves the live generated package untouched when a staged write fails", async () => {
    const services = fakeGeneratedPackageWriteServices({
      failWriteRelativePath: "index.ts",
      initialFiles: {
        "/generated/@svvyx/extensions/package.json": "old package",
        "/generated/@svvyx/extensions/index.ts": "old index",
      },
    });

    await expect(
      runGeneratedPackageWrite(
        writeGeneratedExtensionsPackage({
          generatedPackagePath: "/generated/@svvyx/extensions" as AbsolutePath,
          extensionExportIds: ["git"],
          createdAt: "2026-06-25T00:00:00.000Z" as never,
        }),
        services,
      ),
    ).rejects.toThrow("Injected staged write failure");

    expect(services.readFile("/generated/@svvyx/extensions/package.json")).toBe("old package");
    expect(services.readFile("/generated/@svvyx/extensions/index.ts")).toBe("old index");
    expect(services.readFile("/generated/@svvyx/extensions/.svvy-generated-package.json")).toBe(
      null,
    );
    expect(services.hasStagedPath()).toBe(false);
  });

  it("excludes user svvyx extensions with invalid command manifests", async () => {
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

    expect([
      ...(await runDiscovery(
        generatedExtensionExportIds({
          builtinExtensionIds: [],
          extensionsRoot: "/extensions" as AbsolutePath,
        }),
        services,
      )),
    ]).toEqual([]);
    expect([
      ...generatedExtensionExportIdsFromHost(
        {
          builtinExtensionIds: [],
          extensionsRoot: "/extensions" as AbsolutePath,
        },
        fakeDiscoveryHost(input),
      ),
    ]).toEqual([]);
  });

  it("excludes user svvyx extensions that do not explicitly opt into workflow task-agent reference exports", async () => {
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

    expect([
      ...(await runDiscovery(
        generatedExtensionExportIds({
          builtinExtensionIds: [],
          extensionsRoot: "/extensions" as AbsolutePath,
        }),
        services,
      )),
    ]).toEqual([]);
    expect([
      ...generatedExtensionExportIdsFromHost(
        {
          builtinExtensionIds: [],
          extensionsRoot: "/extensions" as AbsolutePath,
        },
        fakeDiscoveryHost(input),
      ),
    ]).toEqual([]);
  });
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
): Promise<A> {
  return runTestEffect(
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, services.fileSystem),
      Effect.provideService(Path.Path, services.path),
      Effect.provideService(ExtensionStatePort, services.extensionState),
    ),
  );
}

function runGeneratedPackageWrite<A>(
  effect: Effect.Effect<A, unknown, FileSystem.FileSystem | Path.Path>,
  services: ReturnType<typeof fakeGeneratedPackageWriteServices>,
): Promise<A> {
  return runTestEffect(
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, services.fileSystem),
      Effect.provideService(Path.Path, services.path),
    ),
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
}) {
  const files = new Map(Object.entries(input.initialFiles));
  const directories = new Set<string>(["/", "/generated", "/generated/@svvyx"]);
  for (const filePath of files.keys()) {
    addDirectoryChain(directories, dirnamePath(filePath));
  }
  let tempCounter = 0;

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
