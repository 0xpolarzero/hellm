import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ExtensionStatePort } from "@svvy/core";
import type {
  AbsolutePath,
  CommandId,
  PromptExecutionContext,
  SurfacePiSessionId,
  ToolCallId,
  TurnId,
  WorkspaceId,
  WorkspaceSessionId,
} from "@svvy/core";
import {
  Extensions,
  layerExtensions,
  makeExtensions,
  type ExtensionsService,
} from "./extensions-service";
import {
  layerExtensionSourceRootsPort,
  type ExtensionSourceRootsPort,
} from "./extension-source-roots-port";
import {
  layerGeneratedPackageRootPort,
  type GeneratedPackageRootPort,
} from "./generated-package-root-port";
import {
  layerWorkspaceSourceLinkPort,
  type WorkspaceSourceLinkPort,
} from "./workspace-source-link-port";
import type { GeneratedExtensionExportDiscoveryServices } from "./generated-extensions-package";
import { runTestEffect } from "./effect.test-support";

describe("@svvy/extensions Effect service", () => {
  it("lists and inspects builtin extension registry records", async () => {
    const service = await runTestEffect(makeExtensions());

    const records = await runTestEffect(service.registry.list());
    const shell = await runTestEffect(service.registry.inspect({ id: "shell" }));

    expect(records.map((record) => record.id)).toContain("shell");
    expect(shell).toMatchObject({
      id: "shell",
      interface: "native_tool",
      title: "Shell",
    });
  });

  it("resolves actor bindings and visible records through the service boundary", async () => {
    const service = await runTestEffect(makeExtensions());

    const binding = await runTestEffect(
      service.actorBindings.resolve({
        actor: "orchestrator",
        networkAccess: false,
      }),
    );
    const visibleRecords = await runTestEffect(
      service.actorBindings.visibleRecords({
        actor: "orchestrator",
        loadedExtensionIds: binding.loadedExtensionIds,
        availableExtensionIds: binding.availableExtensionIds,
      }),
    );

    expect(binding.loadedExtensionIds).toContain("extension-loading");
    expect(binding.loadedExtensionIds).not.toContain("web");
    expect(visibleRecords.loaded.map((record) => record.id)).toContain("extension-loading");
  });

  it("emits native tool schema documents and command metadata", async () => {
    const service = await runTestEffect(makeExtensions());

    const schemasJson = await runTestEffect(
      service.nativeTools.schemasJson({
        records: [
          {
            id: "shell",
            title: "Shell",
            description: "Command execution.",
            category: "builtin",
            interface: "native_tool",
          },
          {
            id: "workflows",
            title: "Workflows",
            description: "Reusable workflows.",
            category: "builtin",
            interface: "svvyx",
          },
        ],
      }),
    );
    const commandMetadata = await runTestEffect(
      service.nativeTools.getCommandMetadata({ toolName: "exec_command" }),
    );

    expect(JSON.parse(schemasJson).nativeTools.map((entry: { id: string }) => entry.id)).toEqual([
      "shell",
    ]);
    expect(commandMetadata).toMatchObject({
      toolName: "exec_command",
      extensionIds: ["shell"],
    });
  });

  it("resolves native tool handlers by tool name", async () => {
    const service = await runTestEffect(makeExtensions());

    const listHandler = await runTestEffect(
      service.nativeTools.handler({ toolName: "list_extensions" }),
    );
    const loadHandler = await runTestEffect(
      service.nativeTools.handler({ toolName: "load_extension" }),
    );
    const handler = await runTestEffect(
      service.nativeTools.handler({ toolName: "request_user_input" }),
    );
    const missing = await runTestEffect(
      service.nativeTools.handler({ toolName: "missing_tool" }).pipe(Effect.flip),
    );

    expect(listHandler.invoke).toBeFunction();
    expect(loadHandler.invoke).toBeFunction();
    expect(handler.invoke).toBeFunction();
    expect(missing).toMatchObject({
      _tag: "ExtensionError",
      operation: "extensions.native-tools.handler",
      reason: "not-found",
      message: "Native tool handler does not exist: missing_tool",
    });
  });

  it("invokes the list_extensions handler through the service boundary", async () => {
    const service = await runTestEffect(makeExtensions());
    const handler = await runTestEffect(
      service.nativeTools.handler({ toolName: "list_extensions" }),
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

    const result = await runTestEffect(
      handler.invoke({
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
      }),
    );

    expect(result.result.content?.[0]).toEqual({
      type: "text",
      text: "Loaded extensions: shell\nAvailable extensions: smithers",
    });
    expect(result.result.details).toMatchObject({
      status: "succeeded",
      summary: "Loaded extensions: shell\nAvailable extensions: smithers",
      commandFacts: {
        loadedExtensionIds: ["shell"],
        availableExtensionIds: ["smithers"],
      },
    });
  });

  it("fails with ExtensionError when a native tool schema is missing", async () => {
    const service = await runTestEffect(makeExtensions());

    const error = await runTestEffect(
      service.nativeTools
        .schemaJsonForExtension({
          extension: {
            id: "missing-native-tool",
            title: "Missing",
            description: "Missing schema.",
            category: "test",
            interface: "native_tool",
          },
        })
        .pipe(Effect.flip),
    );

    expect(error).toMatchObject({
      _tag: "ExtensionError",
      extensionId: "missing-native-tool",
      operation: "extensions.native-tools.schema-json-for-extension",
      reason: "not-found",
    });
  });

  it("refreshes generated @svvyx/extensions package files through the service boundary", async () => {
    const writtenFiles = new Map<string, string>();
    const generatedPackagePath = "/generated/package";
    const service = await runTestEffect(makeExtensions());

    const result = await runTestEffect(
      provideGeneratedPackagePlatform(
        service.generatedPackages.refresh({
          packages: ["@svvyx/extensions"],
        }),
        writtenFiles,
        { extensionsPackageRoot: generatedPackagePath as AbsolutePath },
      ),
    );

    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]).toMatchObject({
      packageName: "@svvyx/extensions",
      action: "written",
      manifestPath: "/generated/package/.svvy-generated-package.json" as AbsolutePath,
      sourceFingerprint: expect.stringMatching(/^svvy-fnv64-v1:[0-9a-f]{16}$/),
      outputFingerprint: expect.stringMatching(/^svvy-fnv64-v1:[0-9a-f]{16}$/),
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
    });
    expect(result.packages[0]?.buildId).toMatch(/^@svvyx\/extensions:svvy-fnv64-v1:[0-9a-f]{16}$/);
    expect(result).toMatchObject({
      packages: [
        {
          packageName: "@svvyx/extensions",
          action: "written",
        },
      ],
    });
    expect(result).not.toHaveProperty("workspaceLinks");
    expect(JSON.parse(writtenFiles.get("/generated/package/package.json") ?? "")).toEqual({
      name: "@svvyx/extensions",
      type: "module",
      exports: {
        ".": "./index.ts",
      },
    });
    const index = writtenFiles.get("/generated/package/index.ts") ?? "";
    expect(index).toContain("export const Extensions = {");
    expect(index).toContain('"git": {"id":"git"}');
    expect(index).not.toContain(".run");
    expect(index).not.toContain("Context.Service");
    expect(
      JSON.parse(writtenFiles.get("/generated/package/.svvy-generated-package.json") ?? ""),
    ).toMatchObject({
      schemaVersion: 1,
      packageName: "@svvyx/extensions",
      buildId: result.packages[0]?.buildId,
      sourceFingerprint: result.packages[0]?.sourceFingerprint,
      outputFingerprint: result.packages[0]?.outputFingerprint,
      dependencies: [],
      createdAt: expect.any(String),
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
    });
  });

  it("refreshes generated @svvyx/workflows package files through the service boundary", async () => {
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
    const service = await runTestEffect(makeExtensions());

    const result = await runTestEffect(
      provideGeneratedPackagePlatform(
        service.generatedPackages.refresh({
          packages: ["@svvyx/workflows"],
        }),
        writtenFiles,
        {
          extensionsPackageRoot: "/generated/extensions-package" as AbsolutePath,
          workflowsPackageRoot: "/generated/workflows-package" as AbsolutePath,
          workflowsSourceRoot: "/workflows" as AbsolutePath,
        },
        sourceFiles,
      ),
    );

    expect(result.packages).toMatchObject([
      {
        packageName: "@svvyx/extensions",
        action: "written",
      },
      {
        packageName: "@svvyx/workflows",
        action: "written",
        manifestPath: "/generated/workflows-package/.svvy-generated-package.json" as AbsolutePath,
        sourceFingerprint: expect.stringMatching(/^svvy-fnv64-v1:[0-9a-f]{16}$/),
        outputFingerprint: expect.stringMatching(/^svvy-fnv64-v1:[0-9a-f]{16}$/),
      },
    ]);
    expect(result).not.toHaveProperty("workspaceLinks");
    const extensionsBuildId = result.packages[0]?.buildId;
    if (!extensionsBuildId) {
      throw new Error("expected generated extensions package build id");
    }
    expect(result.packages[1]?.dependencies).toEqual([
      {
        kind: "package",
        name: "@svvy/core",
        resolution: "app-owned-package",
        version: "workspace",
      },
      {
        kind: "generated-package",
        name: "@svvyx/extensions",
        buildId: extensionsBuildId,
        resolution: "generated-package-link",
      },
    ]);
    expect(JSON.parse(writtenFiles.get("/generated/workflows-package/package.json") ?? "")).toEqual(
      {
        name: "@svvyx/workflows",
        type: "module",
        exports: {
          ".": "./index.ts",
        },
      },
    );
    expect(writtenFiles.get("/generated/workflows-package/index.ts")).toContain(
      'export * as Agents from "./agents";',
    );
    expect(writtenFiles.get("/generated/workflows-package/agents/index.ts")).toContain(
      "export function defineTaskAgent",
    );
    expect(writtenFiles.get("/generated/workflows-package/agents/index.ts")).toContain(
      'operation: "runTaskAgent"',
    );
    expect(writtenFiles.get("/generated/workflows-package/agents/index.ts")).toContain(
      'readRequiredEnv("SVVY_WORKFLOW_AGENT_BRIDGE_URL")',
    );
    expect(writtenFiles.get("/generated/workflows-package/agents/reviewerAgent.ts")).toContain(
      '[Extensions["apply-patch"].id]: "available"',
    );
    expect(writtenFiles.get("/generated/workflows-package/prompts/reviewChecklist.ts")).toContain(
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
      expect(generatedScaffoldSource).not.toMatch(forbiddenPattern);
    }
    expect(
      JSON.parse(
        writtenFiles.get("/generated/workflows-package/.svvy-generated-package.json") ?? "",
      ),
    ).toMatchObject({
      schemaVersion: 1,
      packageName: "@svvyx/workflows",
      buildId: result.packages[1]?.buildId,
      dependencies: result.packages[1]?.dependencies,
      generatedFiles: expect.arrayContaining([
        "package.json",
        "index.ts",
        "agents/index.ts",
        "agents/reviewerAgent.ts",
        "prompts/reviewChecklist.ts",
      ]),
    });
  });

  it("plans generated package workspace links without applying them", async () => {
    const service = await runTestEffect(makeExtensions());

    const workflowsPlan = await runTestEffect(
      provideGeneratedPackagePlatform(
        service.generatedPackages.planWorkspaceLink({
          workspaceId: "workspace_extensions_service_link_01" as WorkspaceId,
          packageName: "@svvyx/workflows",
        }),
        new Map(),
        {
          workflowsPackageRoot: "/generated/workflows-package" as AbsolutePath,
          workspacePackageLinks: new Map([
            [
              "workspace_extensions_service_link_01:@svvyx/workflows",
              "/repo/.smithers/node_modules/@svvyx/workflows" as AbsolutePath,
            ],
          ]),
        },
      ),
    );
    const extensionsPlan = await runTestEffect(
      provideGeneratedPackagePlatform(
        service.generatedPackages.planWorkspaceLink({
          workspaceId: "workspace_extensions_service_link_01" as WorkspaceId,
          packageName: "@svvyx/extensions",
        }),
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
      ),
    );

    expect(workflowsPlan).toEqual({
      workspaceId: "workspace_extensions_service_link_01" as WorkspaceId,
      packageName: "@svvyx/workflows",
      linkPath: "/repo/.smithers/node_modules/@svvyx/workflows" as AbsolutePath,
      targetPath: "/generated/workflows-package" as AbsolutePath,
      requiredParentPath: "/repo/.smithers/node_modules/@svvyx" as AbsolutePath,
      overwritePolicy: "symlink-only",
    });
    expect(extensionsPlan).toEqual({
      workspaceId: "workspace_extensions_service_link_01" as WorkspaceId,
      packageName: "@svvyx/extensions",
      linkPath: "/repo/.smithers/node_modules/@svvyx/extensions" as AbsolutePath,
      targetPath: "/generated/extensions-package" as AbsolutePath,
      requiredParentPath: "/repo/.smithers/node_modules/@svvyx" as AbsolutePath,
      overwritePolicy: "symlink-only",
    });
  });

  it("provides the service through an Effect layer", async () => {
    const toolName = await runTestEffect(
      Effect.gen(function* () {
        const extensions: ExtensionsService = yield* Extensions;
        const metadata = yield* extensions.nativeTools.getCommandMetadata({
          toolName: "thread_report",
        });
        return metadata?.toolName;
      }).pipe(Effect.provide(layerExtensions)),
    );

    expect(toolName).toBe("thread_report");
  });
});

function provideGeneratedPackagePlatform<A, E>(
  effect: Effect.Effect<
    A,
    E,
    | GeneratedExtensionExportDiscoveryServices
    | ExtensionSourceRootsPort
    | GeneratedPackageRootPort
    | WorkspaceSourceLinkPort
  >,
  writtenFiles: Map<string, string> = new Map(),
  roots: Partial<{
    extensionsRoot: AbsolutePath;
    extensionsPackageRoot: AbsolutePath;
    workflowsSourceRoot: AbsolutePath;
    workflowsPackageRoot: AbsolutePath;
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
    } as unknown as Path.Path),
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
      layerGeneratedPackageRootPort({
        extensionsPackageRoot:
          roots.extensionsPackageRoot ?? ("/generated/extensions-package" as AbsolutePath),
        workflowsPackageRoot:
          roots.workflowsPackageRoot ?? ("/generated/workflows-package" as AbsolutePath),
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
