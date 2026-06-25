import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { AbsolutePath, GeneratedPackageBuildId } from "@svvy/core";
import { refreshGeneratedWorkflowsPackage } from "./generated-workflows-package";
import { runTestEffect } from "./effect.test-support";

const generatedWorkflowsSpecifier = ["@svvyx", "workflows"].join("/");
const generatedExtensionsSpecifier = ["@svvyx", "extensions"].join("/");
const runtimeSpecifier = ["@svvy", "runtime"].join("/");
const effectSpecifier = ["effect", "Effect"].join("/");
const platformBunSpecifier = ["@effect", "platform-bun"].join("/");

describe("generated workflows package", () => {
  it("rejects persistent workflow source that self-imports the generated workflows package", async () => {
    const services = fakeWorkflowPackageServices({
      sources: {
        "/workflows/workflows/review.tsx": [
          "import { Agents } ",
          "from ",
          JSON.stringify(generatedWorkflowsSpecifier),
          ";\n",
        ].join(""),
      },
    });

    await expect(refreshWithServices(services)).rejects.toMatchObject({
      _tag: "ExtensionError",
      reason: "invalid-input",
    });
    expect(services.readFile("/generated/@svvyx/workflows/index.ts")).toBe(null);
  });

  it("rejects persistent workflow source that imports product or Effect packages", async () => {
    const services = fakeWorkflowPackageServices({
      sources: {
        "/workflows/components/bad.ts": [
          ["import * as Effect ", "from ", JSON.stringify(effectSpecifier), ";"].join(""),
          ["export type { Runtime } ", "from ", JSON.stringify(runtimeSpecifier), ";"].join(""),
          ["const lazy = () => ", "import", "(", JSON.stringify(platformBunSpecifier), ");"].join(
            "",
          ),
          "",
        ].join("\n"),
      },
    });

    await expect(refreshWithServices(services)).rejects.toMatchObject({
      _tag: "ExtensionError",
      reason: "invalid-input",
    });
    expect(services.readFile("/generated/@svvyx/workflows/index.ts")).toBe(null);
  });

  it("allows workflow source to import generated extension references", async () => {
    const services = fakeWorkflowPackageServices({
      sources: {
        "/workflows/workflows/review.tsx": [
          [
            "import { Extensions } ",
            "from ",
            JSON.stringify(generatedExtensionsSpecifier),
            ";",
          ].join(""),
          "export const reviewWorkflow = Extensions.git.id;",
          "",
        ].join("\n"),
      },
    });

    await refreshWithServices(services);

    expect(services.readFile("/generated/@svvyx/workflows/workflows/review.tsx")).toContain(
      generatedExtensionsSpecifier,
    );
    expect(services.readFile("/generated/@svvyx/workflows/agents/index.ts")).toContain(
      'export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";',
    );
    expect(services.readFile("/generated/@svvyx/workflows/agents/index.ts")).toContain(
      'throw new Error("svvy workflow task-agent requires exactly one prompt source: provide either prompt or messages.");',
    );
    expect(services.readFile("/generated/@svvyx/workflows/agents/index.ts")).toContain(
      "    promptSource,",
    );
    expect(services.readFile("/generated/@svvyx/workflows/agents/index.ts")).not.toContain(
      "...(promptSource ? { promptSource } : {})",
    );
    expect(services.readFile("/generated/@svvyx/workflows/index.ts")).toContain(
      'export * as Workflows from "./workflows";',
    );
  });
});

function refreshWithServices(
  services: ReturnType<typeof fakeWorkflowPackageServices>,
): Promise<unknown> {
  return runTestEffect(
    refreshGeneratedWorkflowsPackage({
      generatedPackagePath: "/generated/@svvyx/workflows" as AbsolutePath,
      workflowsSourceRoot: "/workflows" as AbsolutePath,
      extensionsBuildId:
        "@svvyx/extensions:svvy-fnv64-v1:0000000000000001" as GeneratedPackageBuildId,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, services.fileSystem),
      Effect.provideService(Path.Path, services.path),
    ),
  );
}

function fakeWorkflowPackageServices(input: { sources: Record<string, string> }) {
  const files = new Map(Object.entries(input.sources));
  const directories = new Set<string>(["/", "/workflows", "/generated", "/generated/@svvyx"]);
  for (const filePath of files.keys()) {
    addDirectoryChain(directories, dirnamePath(filePath));
  }
  let tempCounter = 0;

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
      readDirectory: (path: string) =>
        Effect.succeed([
          ...new Set(
            [...files.keys()].flatMap((filePath) => directChildName(path, filePath) ?? []),
          ),
        ]),
      readFileString: (path: string) =>
        files.has(path)
          ? Effect.succeed(files.get(path) ?? "")
          : Effect.fail(new Error(`Missing fake file: ${path}`)),
      remove: (path: string) =>
        Effect.sync(() => {
          removePath(files, directories, path);
        }),
      rename: (fromPath: string, toPath: string) =>
        Effect.sync(() => {
          movePath(files, directories, fromPath, toPath);
        }),
      stat: (path: string) =>
        pathExists(files, directories, path)
          ? Effect.succeed({ type: files.has(path) ? "File" : "Directory" })
          : Effect.fail(new Error(`Missing fake path: ${path}`)),
      writeFileString: (path: string, contents: string) =>
        Effect.sync(() => {
          addDirectoryChain(directories, dirnamePath(path));
          files.set(path, contents);
        }),
    } as unknown as FileSystem.FileSystem,
    path: {
      basename: basenamePath,
      dirname: dirnamePath,
      join: joinPathSegments,
    } as unknown as Path.Path,
    readFile: (path: string) => files.get(path) ?? null,
  };
}

function directChildName(parentPath: string, filePath: string): string[] {
  const prefix = parentPath.endsWith("/") ? parentPath : `${parentPath}/`;
  if (!filePath.startsWith(prefix)) {
    return [];
  }
  const rest = filePath.slice(prefix.length);
  return rest.includes("/") ? [] : [rest];
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

function movePath(
  files: Map<string, string>,
  directories: Set<string>,
  fromPath: string,
  toPath: string,
): void {
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
}

function joinPathSegments(...segments: readonly string[]): string {
  return segments.join("/").replaceAll(/\/+/g, "/");
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
