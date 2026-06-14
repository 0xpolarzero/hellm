import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createAgentSettingsStore } from "./agent-settings-store";
import { ExtensionDependencyApprovalStore } from "./extension-dependency-approval-store";
import { createStructuredSessionStateStore } from "./structured-session-state";
import { createSvvyDirectTools } from "./svvy-direct-tools";
import {
  approveExtensionDependencyRequest,
  assertExtensionEnvOverrideTarget,
  assertExtensionEnvSecretTarget,
  assertExtensionEnvWriteValue,
  formatSvvyxExtensionsError,
  probeCliRequirement,
  readBuiltinExtensionsInventory,
  readExtensionChangeCards,
  rejectExtensionDependencyRequest,
  runSvvyxExtensionsCommand,
  setExtensionUsage,
  writeExtensionInstructionFile,
  type CliRequirementStatus,
  type SvvyxExtensionsDependencyInstaller,
} from "./svvyx-extensions-command";
import {
  formatSvvyxRuntimeError,
  redactStructuredData,
  runSvvyxRuntimeCommand,
  runSvvyxRuntimeGeneratedClientCommand,
} from "./svvyx-runtime-command";
import type { ExtensionCliRequirement } from "../shared/extensions";

const tempDirs: string[] = [];

function createSvvyDirectToolsForTest(
  options: Parameters<typeof createSvvyDirectTools>[0],
): ReturnType<typeof createSvvyDirectTools> {
  return createSvvyDirectTools({
    ...options,
    managedSandbox: options.managedSandbox ?? false,
  });
}

function readTextBlock(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find(
    (block): block is { type: "text"; text: string } => block.type === "text",
  )?.text;
  expect(text).toBeTruthy();
  return text!;
}

function parseExecStdoutJson(result: {
  content: Array<{ type: string; text?: string }>;
  details: Record<string, unknown>;
}): any {
  const output =
    typeof result.details.stdout === "string" && result.details.stdout.trim().length > 0
      ? result.details.stdout
      : typeof result.details.stderr === "string" && result.details.stderr.trim().length > 0
        ? result.details.stderr
        : readTextBlock(result);
  return JSON.parse(output);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe("svvyx extensions command", () => {
  it("creates a svvyx user extension skeleton in app-owned extension storage", async () => {
    const extensionsRoot = createTempDir();
    const result = await runSvvyxExtensionsCommand({
      command:
        'svvyx extensions create --id linear --title "Linear" --description "Linear issue and project workflow support." --interface svvyx --typescript-api true --json',
      extensionsRoot,
    });
    const output = result.output as any;
    const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
    const manifestPath = join(sourceRoot, "manifest.json");
    const instructionPath = join(sourceRoot, "instructions", "full", "010-linear.md");
    const minimalPath = join(sourceRoot, "instructions", "minimal.md");
    const sourcePath = join(sourceRoot, "source", "index.ts");

    expect(output).toMatchObject({
      ok: true,
      extension: {
        id: "linear",
        category: "user",
        interface: "svvyx",
        title: "Linear",
        description: "Linear issue and project workflow support.",
        resettable: false,
        deletable: true,
        typescriptApiEnabled: true,
        paths: {
          sourceRoot,
          manifest: manifestPath,
          instructionsFull: [
            {
              name: "010-linear.md",
              path: instructionPath,
              bypassed: false,
            },
          ],
          instructionsFullDir: join(sourceRoot, "instructions", "full"),
          instructionsMinimal: minimalPath,
          extensionSource: join(sourceRoot, "source"),
          packageJson: join(extensionsRoot, "package", "package.json"),
          lockfile: join(extensionsRoot, "package", "bun.lock"),
          generatedRoot: join(extensionsRoot, "generated", "extensions", "linear"),
          typescriptTypes: null,
          buildCurrent: join(extensionsRoot, "builds", "extensions", "linear", "current"),
        },
        usage: [
          {
            agentProfile: "default-orchestrator",
            actorKind: "orchestrator",
            state: "loaded",
            configurable: true,
          },
          {
            agentProfile: "threadHandler",
            actorKind: "handler",
            state: "unavailable",
            configurable: true,
          },
          {
            agentProfile: "explorer",
            actorKind: "workflow-task",
            state: "loaded",
            configurable: true,
          },
          {
            agentProfile: "implementer",
            actorKind: "workflow-task",
            state: "loaded",
            configurable: true,
          },
          {
            agentProfile: "reviewer",
            actorKind: "workflow-task",
            state: "loaded",
            configurable: true,
          },
        ],
        state: {
          draftChanged: true,
          buildRequired: true,
          currentBuild: null,
          ready: false,
          issues: [
            {
              code: "NO_CURRENT_BUILD",
              message: "Linear has not been built yet.",
            },
            {
              code: "BUILD_REQUIRED",
              message: "Linear must be built before it can be loaded.",
            },
          ],
        },
      },
      next: [
        "Edit source, instructions, manifest, or package.json with apply_patch.",
        "Run `svvyx extensions build linear --json`.",
      ],
    });
    expect(result.commandFacts).toEqual({
      extensionCreated: true,
      extensionId: "linear",
      extensionInterface: "svvyx",
      extensionReady: false,
      extensionSourceRoot: sourceRoot,
    });
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual({
      schemaVersion: 1,
      id: "linear",
      title: "Linear",
      description: "Linear issue and project workflow support.",
      interface: "svvyx",
      typescriptApiEnabled: true,
      instructionFiles: [
        {
          file: "010-linear.md",
          bypassed: false,
        },
      ],
    });
    expect(readFileSync(instructionPath, "utf8")).toBe("# Linear\n");
    expect(readFileSync(minimalPath, "utf8")).toBe("");
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain('import { Cli } from "incur";');
    expect(source).toContain("export default cli;");
    expect(source).not.toContain("serve(");
    expect(source).not.toContain("placeholder");
  });

  it("creates an instructions-only user extension without executable source", async () => {
    const extensionsRoot = createTempDir();
    const result = await runSvvyxExtensionsCommand({
      command:
        'svvyx extensions create --id notes --title "Notes" --description "Project notes." --interface instructions --json',
      extensionsRoot,
    });
    const output = result.output as any;
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");

    expect(output.extension).toMatchObject({
      id: "notes",
      interface: "instructions",
      typescriptApiEnabled: false,
      paths: {
        extensionSource: null,
      },
      state: {
        buildRequired: true,
        ready: false,
      },
    });
    expect(existsSync(join(sourceRoot, "source"))).toBe(false);
    expect(JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8"))).toMatchObject({
      id: "notes",
      interface: "instructions",
      typescriptApiEnabled: false,
    });
  });

  it("defaults Extension Managing storage to the app-global home config root", async () => {
    const cwd = createTempDir();
    const home = createTempDir();
    const modulePath = join(process.cwd(), "src", "bun", "svvyx-extensions-command.ts");
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        [
          `const { runSvvyxExtensionsCommand } = await import(${JSON.stringify(modulePath)});`,
          "const result = await runSvvyxExtensionsCommand({",
          '  command: \'svvyx extensions create --id scratch --title "Scratch" --description "Scratch extension." --interface instructions --json\',',
          `  cwd: ${JSON.stringify(cwd)},`,
          "});",
          "console.log(JSON.stringify(result.output));",
        ].join("\n"),
      ],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
        },
      },
    );
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout) as any;
    const extensionsRoot = join(home, ".config", "svvy", "extensions");
    const paths = result.extension.paths;
    expect(paths.sourceRoot).toBe(join(extensionsRoot, "sources", "user", "scratch"));
    expect(paths.manifest).toBe(
      join(extensionsRoot, "sources", "user", "scratch", "manifest.json"),
    );
    expect(paths.packageJson).toBe(join(extensionsRoot, "package", "package.json"));
    expect(paths.lockfile).toBe(join(extensionsRoot, "package", "bun.lock"));
    expect(paths.generatedRoot).toBe(join(extensionsRoot, "generated", "extensions", "scratch"));
    expect(paths.buildCurrent).toBe(
      join(extensionsRoot, "builds", "extensions", "scratch", "current"),
    );
    expect(existsSync(join(extensionsRoot, "sources", "user", "scratch", "manifest.json"))).toBe(
      true,
    );
    expect(existsSync(join(cwd, "sources"))).toBe(false);
  });

  it("keeps Extension Managing state under the app-global extension root", async () => {
    const cwd = createTempDir();
    const extensionsRoot = createTempDir();
    const packagedFullDir = join(cwd, "generated", "instructions", "full");
    mkdirSync(packagedFullDir, { recursive: true });
    writeFileSync(join(packagedFullDir, "010-tinyfish-cli.generated.md"), "tinyfish\n");
    mkdirSync(join(extensionsRoot, "package"), { recursive: true });
    writeFileSync(join(extensionsRoot, "package", "package.json"), "{}\n");

    const linear = await runSvvyxExtensionsCommand({
      command:
        'svvyx extensions create --id linear --title "Linear" --description "Linear issue workflow." --interface svvyx --typescript-api true --json',
      cwd,
      extensionsRoot,
    });
    await createNotesExtension(extensionsRoot);
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect web --json",
      cwd,
      extensionsRoot,
    });
    const build = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      cwd,
      extensionsRoot,
    });
    const snapshot = await runSvvyxExtensionsCommand({
      command: 'svvyx extensions snapshots save --name "Storage contract" --json',
      cwd,
      extensionsRoot,
    });
    const deleted = await runSvvyxExtensionsCommand({
      command: "svvyx extensions delete notes --json",
      cwd,
      extensionsRoot,
    });

    const linearPaths = (linear.output as any).extension.paths;
    for (const path of [
      linearPaths.sourceRoot,
      linearPaths.manifest,
      linearPaths.instructionsFullDir,
      linearPaths.instructionsMinimal,
      linearPaths.extensionSource,
      linearPaths.packageJson,
      linearPaths.lockfile,
      linearPaths.generatedRoot,
      linearPaths.buildCurrent,
      (build.output as any).build.currentPath,
      join(extensionsRoot, "sources", "builtin", "web", "manifest.json"),
      join(extensionsRoot, "trash", (deleted.output as any).trashId, "sources", "user", "notes"),
      join(extensionsRoot, "snapshots", (snapshot.output as any).snapshot.id),
    ]) {
      expect(pathIsInside(path, extensionsRoot)).toBe(true);
      expect(pathIsInside(path, cwd)).toBe(false);
    }

    expect(existsSync(join(extensionsRoot, "sources", "user", "linear", "manifest.json"))).toBe(
      true,
    );
    expect(existsSync(join(extensionsRoot, "sources", "builtin", "web", "manifest.json"))).toBe(
      true,
    );
    expect(
      existsSync(
        join(extensionsRoot, "builds", "extensions", "linear", "current", "manifest.json"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          extensionsRoot,
          "trash",
          (deleted.output as any).trashId,
          "sources",
          "user",
          "notes",
          "manifest.json",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(join(extensionsRoot, "snapshots", (snapshot.output as any).snapshot.id)),
    ).toBe(true);
    for (const workspaceLocalState of ["sources", "builds", "package", "trash", "snapshots"]) {
      expect(existsSync(join(cwd, workspaceLocalState))).toBe(false);
    }
  });

  it("inspects and builds a created user extension through the same app-owned root", async () => {
    const extensionsRoot = createTempDir();
    await runSvvyxExtensionsCommand({
      command:
        'svvyx extensions create --id linear --title "Linear" --description "Linear issue workflow." --interface svvyx --typescript-api true --json',
      extensionsRoot,
    });

    const inspectBefore = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect linear --json",
      extensionsRoot,
    });
    expect(inspectBefore.output).toMatchObject({
      ok: true,
      extension: {
        id: "linear",
        category: "user",
        interface: "svvyx",
        typescriptApiEnabled: true,
        paths: {
          sourceRoot: join(extensionsRoot, "sources", "user", "linear"),
          manifest: join(extensionsRoot, "sources", "user", "linear", "manifest.json"),
          extensionSource: join(extensionsRoot, "sources", "user", "linear", "source"),
          generatedRoot: join(extensionsRoot, "generated", "extensions", "linear"),
          typescriptTypes: join(extensionsRoot, "generated", "extensions", "linear", "types.d.ts"),
          buildCurrent: join(extensionsRoot, "builds", "extensions", "linear", "current"),
        },
        state: {
          draftChanged: true,
          buildRequired: true,
          currentBuild: null,
          ready: false,
          issues: [
            {
              code: "NO_CURRENT_BUILD",
            },
            {
              code: "BUILD_REQUIRED",
            },
          ],
        },
      },
    });

    const build = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    expect(build.output).toMatchObject({
      ok: true,
      extensionId: "linear",
      build: {
        status: "success",
        interface: "svvyx",
        currentPath: join(extensionsRoot, "builds", "extensions", "linear", "current"),
      },
      generated: {
        typescriptTypes: join(extensionsRoot, "generated", "extensions", "linear", "types.d.ts"),
        extensionsPackage: join(extensionsRoot, "generated", "package"),
      },
    });
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "linear", "current"))).toBe(
      true,
    );
    expect(
      JSON.parse(
        readFileSync(
          join(extensionsRoot, "builds", "extensions", "linear", "current", "manifest.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      schemaVersion: 1,
      extensionId: "linear",
      interface: "svvyx",
      module: "source/index.js",
      commandManifest: {
        version: "incur.v1",
        commands: [],
      },
      typescriptTypes: join(extensionsRoot, "generated", "extensions", "linear", "types.d.ts"),
      sourceFingerprint: expect.any(String),
      env: [],
      dependencies: [],
    });
    expect(
      existsSync(
        join(extensionsRoot, "builds", "extensions", "linear", "current", "source", "index.js"),
      ),
    ).toBe(true);
    expect(
      readFileSync(join(extensionsRoot, "generated", "package", "package.json"), "utf8"),
    ).toContain('"name": "@svvy/extensions"');
    const generatedExtensionsIndex = readFileSync(
      join(extensionsRoot, "generated", "package", "index.ts"),
      "utf8",
    );
    expect(generatedExtensionsIndex).toContain('"git": "git"');
    expect(generatedExtensionsIndex).toContain('"linear": "linear"');
    expect(generatedExtensionsIndex).toContain('"workflows": "workflows"');

    const inspectAfter = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect linear --json",
      extensionsRoot,
    });
    expect(inspectAfter.output).toMatchObject({
      ok: true,
      extension: {
        id: "linear",
        state: {
          draftChanged: false,
          buildRequired: false,
          currentBuild: {
            status: "ready",
          },
          ready: true,
          issues: [],
        },
      },
    });
  });

  it("restores the previous current build when generated extensions package refresh fails", async () => {
    const extensionsRoot = createTempDir();
    await runSvvyxExtensionsCommand({
      command:
        'svvyx extensions create --id linear --title "Linear" --description "Linear issue workflow." --interface svvyx --typescript-api true --json',
      extensionsRoot,
    });
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    const currentManifestPath = join(
      extensionsRoot,
      "builds",
      "extensions",
      "linear",
      "current",
      "manifest.json",
    );
    const previousManifest = readFileSync(currentManifestPath, "utf8");
    writeFileSync(
      join(extensionsRoot, "sources", "user", "linear", "source", "index.ts"),
      [
        'import { Cli } from "incur";',
        "",
        'const cli = Cli.create("linear", { description: "updated build" });',
        "export default cli;",
        "",
      ].join("\n"),
    );
    const generatedPackagePath = join(extensionsRoot, "generated", "package");
    rmSync(generatedPackagePath, { force: true, recursive: true });
    writeFileSync(generatedPackagePath, "not a directory\n");

    await expect(
      runSvvyxExtensionsCommand({
        command: "svvyx extensions build linear --json",
        extensionsRoot,
      }),
    ).rejects.toThrow();

    expect(readFileSync(currentManifestPath, "utf8")).toBe(previousManifest);
    expect(
      readFileSync(
        join(extensionsRoot, "builds", "extensions", "linear", "current", "source", "index.js"),
        "utf8",
      ),
    ).not.toContain("updated build");
  });

  it("dispatches a current svvyx build through the stable runtime with unchanged argv", async () => {
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
    writeFileSync(
      join(sourceRoot, "source", "index.ts"),
      [
        'import { Cli, z } from "incur";',
        "",
        "const cli = Cli.create('linear');",
        "cli.command('echo', {",
        "  args: z.object({ value: z.string() }),",
        "  options: z.object({ tag: z.string().default('none') }),",
        "  run(c) {",
        "    return { value: c.args.value, tag: c.options.tag };",
        "  },",
        "});",
        "",
        "export default cli;",
        "",
      ].join("\n"),
    );
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });

    const dispatched = await runSvvyxRuntimeCommand({
      command: "svvyx linear echo hello --tag urgent --json",
      extensionsRoot,
    });
    const output = dispatched.output as any;

    expect(output).toMatchObject({
      ok: true,
      extensionId: "linear",
      argv: ["echo", "hello", "--tag", "urgent", "--json"],
      exitCode: 0,
    });
    expect(JSON.parse(output.stdout)).toMatchObject({
      value: "hello",
      tag: "urgent",
    });
    expect(dispatched.commandFacts).toEqual({
      svvyxDispatch: true,
      extensionId: "linear",
      extensionArgv: ["echo", "hello", "--tag", "urgent", "--json"],
      exitCode: 0,
      runtimeReady: true,
    });
  });

  it("builds Incur command schemas into the current svvyx build manifest", async () => {
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
    writeFileSync(
      join(sourceRoot, "source", "index.ts"),
      [
        'import { Cli, z } from "incur";',
        "",
        "const cli = Cli.create('linear');",
        "cli.command('echo', {",
        "  aliases: ['say'],",
        "  description: 'Echo a value.',",
        "  args: z.object({ value: z.string() }),",
        "  options: z.object({ tag: z.string().default('none') }),",
        "  output: z.object({ value: z.string(), tag: z.string() }),",
        "  examples: [{ args: { value: 'hello' }, options: { tag: 'urgent' }, description: 'Echo hello.' }],",
        "  run(c) {",
        "    return { value: c.args.value, tag: c.options.tag };",
        "  },",
        "});",
        "cli.command('stream', {",
        "  async *run() {",
        "    yield { step: 1 };",
        "  },",
        "});",
        "",
        "export default cli;",
        "",
      ].join("\n"),
    );

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });

    const manifest = JSON.parse(
      readFileSync(
        join(extensionsRoot, "builds", "extensions", "linear", "current", "manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.commandManifest).toMatchObject({
      version: "incur.v1",
      commands: [
        {
          name: "echo",
          description: "Echo a value.",
          schema: {
            args: {
              type: "object",
              properties: {
                value: { type: "string" },
              },
              required: ["value"],
            },
            options: {
              type: "object",
              properties: {
                tag: { default: "none", type: "string" },
              },
            },
            output: {
              type: "object",
              properties: {
                value: { type: "string" },
                tag: { type: "string" },
              },
              required: ["value", "tag"],
            },
          },
          examples: [
            {
              command: "echo hello --tag urgent",
              description: "Echo hello.",
            },
          ],
        },
        {
          name: "stream",
        },
      ],
    });
    expect(
      JSON.parse(
        readFileSync(
          join(extensionsRoot, "generated", "extensions", "linear", "commands.json"),
          "utf8",
        ),
      ),
    ).toEqual(manifest.commandManifest);
    expect(manifest.typescriptTypes).toBe(
      join(extensionsRoot, "generated", "extensions", "linear", "types.d.ts"),
    );
    const typesDeclaration = readFileSync(
      join(extensionsRoot, "generated", "extensions", "linear", "types.d.ts"),
      "utf8",
    );
    expect(typesDeclaration).toContain("type LinearExtensionCommandMap");
    expect(typesDeclaration).toContain('"echo"');
    expect(typesDeclaration).toContain("args: { value: string }");
    expect(typesDeclaration).toContain("options: { tag: string }");
    expect(typesDeclaration).toContain("type LinearExtensionOutputControls");
    expect(typesDeclaration).toContain(
      "result: Run.Result<{ value: string; tag: string }, LinearExtensionCommandMap>",
    );
    expect(typesDeclaration).toContain("linear: LinearExtensionClient");
  });

  it("scaffolds and builds builtin svvyx sources with generated command schemas", async () => {
    const extensionsRoot = createTempDir();

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect artifacts --json",
      extensionsRoot,
    });
    expect(
      readFileSync(
        join(extensionsRoot, "sources", "builtin", "artifacts", "source", "index.ts"),
        "utf8",
      ),
    ).toContain("Cli.create('artifacts'");

    const artifactsBuild = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build artifacts --json",
      extensionsRoot,
    });
    expect(artifactsBuild.output).toMatchObject({
      ok: true,
      extensionId: "artifacts",
      build: {
        status: "success",
        interface: "svvyx",
        runtimeReady: true,
      },
    });
    const artifactsManifest = JSON.parse(
      readFileSync(
        join(extensionsRoot, "builds", "extensions", "artifacts", "current", "manifest.json"),
        "utf8",
      ),
    );
    expect(artifactsManifest.module).toBe("source/index.js");
    expect(
      artifactsManifest.commandManifest.commands.map((command: any) => command.name).toSorted(),
    ).toEqual(["create", "delete", "inspect", "list", "open"]);
    expect(
      JSON.parse(
        readFileSync(
          join(extensionsRoot, "generated", "extensions", "artifacts", "commands.json"),
          "utf8",
        ),
      ),
    ).toEqual(artifactsManifest.commandManifest);

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect workflows --json",
      extensionsRoot,
    });
    expect(
      readFileSync(
        join(extensionsRoot, "sources", "builtin", "workflows", "source", "index.ts"),
        "utf8",
      ),
    ).toContain("Cli.create('workflows'");

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build workflows --json",
      extensionsRoot,
    });
    const workflowsManifest = JSON.parse(
      readFileSync(
        join(extensionsRoot, "builds", "extensions", "workflows", "current", "manifest.json"),
        "utf8",
      ),
    );
    expect(workflowsManifest.module).toBe("source/index.js");
    expect(
      workflowsManifest.commandManifest.commands.map((command: any) => command.name).toSorted(),
    ).toEqual(["build", "list", "models list", "save"]);
    expect(
      JSON.parse(
        readFileSync(
          join(extensionsRoot, "generated", "extensions", "workflows", "commands.json"),
          "utf8",
        ),
      ),
    ).toEqual(workflowsManifest.commandManifest);
  });

  it("rejects svvyx runtime dispatch when current command manifest is malformed", async () => {
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    const manifestPath = join(
      extensionsRoot,
      "builds",
      "extensions",
      "linear",
      "current",
      "manifest.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.commandManifest = { version: "incur.v1", commands: "echo" };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    expect(
      formatSvvyxRuntimeError(
        await runSvvyxRuntimeCommand({
          command: "svvyx linear echo hello --json",
          extensionsRoot,
        }).catch((error) => error),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_current_build",
        message: "linear current build is invalid.",
      },
      commandFacts: {
        svvyxDispatch: true,
        extensionId: "linear",
        extensionArgv: ["echo", "hello", "--json"],
        runtimeReady: false,
        errorCode: "invalid_current_build",
        currentBuildStatus: "invalid",
      },
    });
  });

  it("injects only extension-local env values into svvyx runtime invocations", async () => {
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
    updateUserManifest(sourceRoot, {
      env: [
        {
          name: "LINEAR_TOKEN",
          required: true,
          secret: true,
          description: "Linear token.",
        },
        {
          name: "LINEAR_LABEL",
          required: false,
          secret: false,
          description: "Default label.",
          default: "triage",
        },
      ],
    });
    writeFileSync(
      join(sourceRoot, "source", "index.ts"),
      [
        'import { Cli, z } from "incur";',
        "",
        "const cli = Cli.create('linear');",
        "cli.command('whoami', {",
        "  env: z.object({",
        "    LINEAR_TOKEN: z.string(),",
        "    LINEAR_LABEL: z.string().default('fallback'),",
        "  }),",
        "  run(c) {",
        "    return { tokenLength: c.env.LINEAR_TOKEN.length, label: c.env.LINEAR_LABEL };",
        "  },",
        "});",
        "",
        "export default cli;",
        "",
      ].join("\n"),
    );
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });

    const missing = await expect(
      runSvvyxRuntimeCommand({
        command: "svvyx linear whoami --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Configure it in the Extensions pane");
    expect(missing).toBeUndefined();
    expect(
      formatSvvyxRuntimeError(
        await runSvvyxRuntimeCommand({
          command: "svvyx linear whoami --json",
          extensionsRoot,
          envValues: {
            other: {
              LINEAR_TOKEN: "wrong-extension",
            },
          },
        }).catch((error) => error),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "extension_env_missing",
        message: "linear requires LINEAR_TOKEN. Configure it in the Extensions pane.",
      },
      commandFacts: {
        svvyxDispatch: true,
        extensionId: "linear",
        extensionArgv: ["whoami", "--json"],
        runtimeReady: false,
        errorCode: "extension_env_missing",
        currentBuildStatus: "valid",
      },
    });
    expect(
      formatSvvyxRuntimeError(
        await runSvvyxRuntimeCommand({
          command: "svvyx linear whoami --json",
          extensionsRoot,
          envValues: {
            linear: {
              LINEAR_TOKEN: "plaintext-secret-value",
            },
          },
        }).catch((error) => error),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "extension_env_missing",
      },
    });

    const dispatched = await runSvvyxRuntimeCommand({
      command: "svvyx linear whoami --json",
      extensionsRoot,
      envSecretStore: createMemoryExtensionSecretStore({
        "linear:LINEAR_TOKEN": "secret-token-value",
      }),
    });
    const output = dispatched.output as any;
    expect(JSON.stringify(output)).not.toContain("secret-token-value");
    expect(JSON.parse(output.stdout)).toMatchObject({
      tokenLength: "secret-token-value".length,
      label: "triage",
    });
  });

  it("redacts secret env values from svvyx runtime stdout", async () => {
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
    updateUserManifest(sourceRoot, {
      env: [
        {
          name: "LINEAR_TOKEN",
          required: true,
          secret: true,
          description: "Linear token.",
        },
      ],
    });
    writeFileSync(
      join(sourceRoot, "source", "index.ts"),
      [
        'import { Cli, z } from "incur";',
        "",
        "const cli = Cli.create('linear');",
        "cli.command('leak', {",
        "  env: z.object({ LINEAR_TOKEN: z.string() }),",
        "  run(c) {",
        "    return { token: c.env.LINEAR_TOKEN };",
        "  },",
        "});",
        "",
        "export default cli;",
        "",
      ].join("\n"),
    );
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });

    const dispatched = await runSvvyxRuntimeCommand({
      command: "svvyx linear leak --json",
      extensionsRoot,
      envSecretStore: createMemoryExtensionSecretStore({
        "linear:LINEAR_TOKEN": "secret-token-value",
      }),
    });
    const output = dispatched.output as any;
    expect(output.stdout).toContain("[REDACTED]");
    expect(JSON.stringify(output)).not.toContain("secret-token-value");
  });

  it("redacts secret env values from svvyx runtime error messages", async () => {
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
    updateUserManifest(sourceRoot, {
      env: [
        {
          name: "LINEAR_TOKEN",
          required: true,
          secret: true,
          description: "Linear token.",
        },
      ],
    });
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    writeFileSync(
      join(extensionsRoot, "builds", "extensions", "linear", "current", "source", "index.js"),
      [
        "export default {",
        "  serve(_argv, options) {",
        "    throw new Error(`token=${options.env.LINEAR_TOKEN}`);",
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const formatted = formatSvvyxRuntimeError(
      await runSvvyxRuntimeCommand({
        command: "svvyx linear leak --json",
        extensionsRoot,
        envSecretStore: createMemoryExtensionSecretStore({
          "linear:LINEAR_TOKEN": "secret-token-value",
        }),
      }).catch((error) => error),
    );

    expect(formatted.error.message).toContain("[REDACTED]");
    expect(JSON.stringify(formatted)).not.toContain("secret-token-value");
    expect(formatted).toMatchObject({
      ok: false,
      error: {
        code: "extension_command_failed",
      },
      commandFacts: {
        extensionId: "linear",
        runtimeReady: true,
        currentBuildStatus: "valid",
      },
    });
  });

  it("rejects user svvyx runtime dispatch mixed with shell control syntax", async () => {
    expect(
      formatSvvyxRuntimeError(
        await runSvvyxRuntimeCommand({
          command: "svvyx linear --help && echo leaked",
          extensionsRoot: createTempDir(),
        }).catch((error) => error),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_argument",
        message: "svvyx extension commands must be invoked as a standalone command.",
      },
    });

    const tools = createSvvyDirectToolsForTest({
      cwd: createTempDir(),
      extensionsRoot: createTempDir(),
    }).codingTools;
    const execTool = tools.find((candidate) => candidate.name === "exec_command");
    if (!execTool) throw new Error("exec_command tool missing.");
    const result = await execTool.execute(
      "tool-extension-runtime-shell-control",
      { cmd: "svvyx linear --help && echo leaked" },
      new AbortController().signal,
      () => {},
    );
    const text = readTextBlock(result);
    expect(text).toContain("command not found: svvyx");
    expect(result.details).toMatchObject({
      stdout: "",
      exitCode: 127,
    });
    expect(text).not.toContain("leaked");
  });

  it("keeps profile usage state out of shell-level svvyx runtime dispatch", async () => {
    const agentRoot = createTempDir();
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    const agentSettingsStore = createAgentSettingsStore({
      cwd: agentRoot,
      agentDir: join(agentRoot, ".agent"),
      workflowsSourceRoot: join(agentRoot, "workflows"),
    });
    agentSettingsStore.setAgentProfile({
      ...agentSettingsStore.getState().agents.orchestrators[0]!,
      extensionUsage: {
        linear: "unavailable",
      },
    });
    const tools = createSvvyDirectToolsForTest({
      agentSettingsStore,
      cwd: agentRoot,
      extensionsRoot,
    }).codingTools;
    const execTool = tools.find((candidate) => candidate.name === "exec_command");
    if (!execTool) throw new Error("exec_command tool missing.");

    const result = await execTool.execute(
      "tool-extension-runtime-usage-state",
      { cmd: "svvyx linear --help" },
      new AbortController().signal,
      () => {},
    );
    expect(parseExecStdoutJson(result)).toMatchObject({
      ok: true,
      extensionId: "linear",
      argv: ["--help"],
      exitCode: 0,
    });
    expect(result.details).toMatchObject({ exitCode: 0 });
    expect(result.details).not.toHaveProperty("commandFacts");
  });

  it("injects app-managed non-secret env overrides through exec_command svvyx dispatch", async () => {
    const agentRoot = createTempDir();
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
    updateUserManifest(sourceRoot, {
      env: [
        {
          name: "LINEAR_API_BASE_URL",
          required: true,
          secret: false,
          description: "Linear API base URL.",
        },
        {
          name: "LINEAR_LABEL",
          required: false,
          secret: false,
          description: "Default label.",
          default: "triage",
        },
      ],
    });
    writeFileSync(
      join(sourceRoot, "source", "index.ts"),
      [
        'import { Cli, z } from "incur";',
        "",
        "const cli = Cli.create('linear');",
        "cli.command('env', {",
        "  env: z.object({",
        "    LINEAR_API_BASE_URL: z.string(),",
        "    LINEAR_LABEL: z.string().default('fallback'),",
        "  }),",
        "  run(c) {",
        "    return { baseUrl: c.env.LINEAR_API_BASE_URL, label: c.env.LINEAR_LABEL };",
        "  },",
        "});",
        "",
        "export default cli;",
        "",
      ].join("\n"),
    );
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    const agentSettingsStore = createAgentSettingsStore({
      cwd: agentRoot,
      agentDir: join(agentRoot, ".agent"),
      workflowsSourceRoot: join(agentRoot, "workflows"),
    });
    agentSettingsStore.setExtensionEnv({
      nonSecretOverrides: {
        linear: {
          LINEAR_API_BASE_URL: "https://linear.example.test",
          LINEAR_LABEL: "configured-label",
        },
      },
    });
    const execTool = createSvvyDirectToolsForTest({
      agentSettingsStore,
      cwd: agentRoot,
      extensionsRoot,
    }).codingTools.find((candidate) => candidate.name === "exec_command");
    if (!execTool) throw new Error("exec_command tool missing.");

    const result = await execTool.execute(
      "tool-extension-runtime-app-env",
      { cmd: "svvyx linear env --json" },
      new AbortController().signal,
      () => {},
    );
    const output = parseExecStdoutJson(result);
    expect(JSON.parse(output.stdout)).toEqual({
      baseUrl: "https://linear.example.test",
      label: "configured-label",
    });
    expect(result.details).toMatchObject({ exitCode: 0 });
    expect(result.details).not.toHaveProperty("commandFacts");
  });

  it("blocks dependency-backed current builds with missing package artifacts before runtime invocation", async () => {
    const extensionsRoot = createTempDir();
    const dependencyApprovalStore = new ExtensionDependencyApprovalStore({
      extensionsRoot,
      createRequestId: () => "depapr_linear",
    });
    await createLinearExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
    updateUserManifest(sourceRoot, {
      dependencies: {
        "@linear/sdk": "1.2.3",
      },
    });
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      dependencyApprovalStore,
      extensionsRoot,
    });
    dependencyApprovalStore.approveRequest("depapr_linear");
    const failedInstall = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      dependencyApprovalStore,
      dependencyInstaller: async (input) => ({
        ok: true,
        command: ["fake-bun", "install"],
        packageProject: input.packageProject,
      }),
      extensionsRoot,
    });
    expect(failedInstall.output).toMatchObject({
      ok: false,
      error: {
        code: "DEPENDENCY_INSTALL_MISSING",
        extensionId: "linear",
        missing: [{ name: "@linear/sdk", install: "missing" }],
      },
    });
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      dependencyApprovalStore,
      dependencyInstaller: createInstallingDependencyInstaller([]),
      extensionsRoot,
    });
    rmSync(join(extensionsRoot, "package", "node_modules", "@linear", "sdk"), {
      force: true,
      recursive: true,
    });

    await expect(
      runSvvyxRuntimeCommand({
        command: "svvyx linear --help",
        extensionsRoot,
      }),
    ).rejects.toThrow("dependency @linear/sdk is not installed");
    expect(
      formatSvvyxRuntimeError(
        await runSvvyxRuntimeCommand({
          command: "svvyx linear --help",
          extensionsRoot,
        }).catch((error) => error),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "dependency_install_missing",
        message: "linear dependency @linear/sdk is not installed.",
      },
      commandFacts: {
        svvyxDispatch: true,
        extensionId: "linear",
        extensionArgv: ["--help"],
        runtimeReady: false,
        errorCode: "dependency_install_missing",
        currentBuildStatus: "blocked",
      },
    });
  });

  it("rejects current-build module paths outside the current directory", async () => {
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    const manifestPath = join(
      extensionsRoot,
      "builds",
      "extensions",
      "linear",
      "current",
      "manifest.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.module = "../source/index.js";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    await expect(
      runSvvyxRuntimeCommand({
        command: "svvyx linear --help",
        extensionsRoot,
      }),
    ).rejects.toThrow("module path is invalid");
  });

  it("reports current-build import failures with dispatcher facts", async () => {
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    const manifestPath = join(
      extensionsRoot,
      "builds",
      "extensions",
      "linear",
      "current",
      "manifest.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.module = "source/missing.js";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    expect(
      formatSvvyxRuntimeError(
        await runSvvyxRuntimeCommand({
          command: "svvyx linear --help",
          extensionsRoot,
        }).catch((error) => error),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "current_build_import_failed",
        message: "linear current build CLI could not be imported.",
      },
      commandFacts: {
        svvyxDispatch: true,
        extensionId: "linear",
        extensionArgv: ["--help"],
        runtimeReady: false,
        errorCode: "current_build_import_failed",
        currentBuildStatus: "invalid",
      },
    });
  });

  it("reports extension command runtime failures with dispatcher facts", async () => {
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    writeFileSync(
      join(extensionsRoot, "builds", "extensions", "linear", "current", "source", "index.js"),
      "export default { serve() { throw new Error('linear command exploded'); } };\n",
    );

    expect(
      formatSvvyxRuntimeError(
        await runSvvyxRuntimeCommand({
          command: "svvyx linear explode --json",
          extensionsRoot,
        }).catch((error) => error),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "extension_command_failed",
        message: "linear command exploded",
      },
      commandFacts: {
        svvyxDispatch: true,
        extensionId: "linear",
        extensionArgv: ["explode", "--json"],
        runtimeReady: true,
        errorCode: "extension_command_failed",
        currentBuildStatus: "valid",
      },
    });
  });

  it("returns svvyx runtime JSON failures through exec_command", async () => {
    const cwd = createTempDir();
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    const tools = createSvvyDirectToolsForTest({
      cwd,
      extensionsRoot,
    }).codingTools;
    const execTool = tools.find((candidate) => candidate.name === "exec_command");
    if (!execTool) throw new Error("exec_command tool missing.");

    const missing = await execTool.execute(
      "tool-extension-runtime-missing-build",
      {
        cmd: "svvyx linear echo --json",
      },
      new AbortController().signal,
      () => {},
    );
    expect(parseExecStdoutJson(missing)).toEqual({
      ok: false,
      error: {
        code: "no_current_build",
        message: "linear has no current successful svvyx build.",
      },
      commandFacts: {
        svvyxDispatch: true,
        extensionId: "linear",
        extensionArgv: ["echo", "--json"],
        runtimeReady: false,
        errorCode: "no_current_build",
        currentBuildStatus: "missing",
      },
    });
    expect(missing.details).toMatchObject({ stdout: "", exitCode: 1 });
    expect(missing.details).not.toHaveProperty("commandFacts");

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    const help = await execTool.execute(
      "tool-extension-runtime-help",
      {
        cmd: "svvyx linear --help",
      },
      new AbortController().signal,
      () => {},
    );
    expect(parseExecStdoutJson(help)).toMatchObject({
      ok: true,
      extensionId: "linear",
      argv: ["--help"],
      exitCode: 0,
    });
    expect(help.details).toMatchObject({ exitCode: 0 });
    expect(help.details).not.toHaveProperty("commandFacts");
  });

  it("routes top-level svvyx dispatcher help through exec_command", async () => {
    const cwd = createTempDir();
    const execTool = createSvvyDirectToolsForTest({
      cwd,
      extensionsRoot: createTempDir(),
    }).codingTools.find((candidate) => candidate.name === "exec_command");
    if (!execTool) throw new Error("exec_command tool missing.");

    const result = await execTool.execute(
      "tool-svvyx-dispatcher-help",
      {
        cmd: "svvyx --help",
      },
      new AbortController().signal,
      () => {},
    );
    expect(parseExecStdoutJson(result)).toEqual({
      ok: true,
      usage: "svvyx <extension-id> <extension-command> ...",
      note: "Use list_extensions or svvyx extensions inspect for extension discovery.",
    });
    expect(result.details).toMatchObject({ exitCode: 0 });
    expect(result.details).not.toHaveProperty("commandFacts");
  });

  it("manages user full instruction files without editing body text", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);

    const add = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-domain-guide.md --json",
      extensionsRoot,
    });
    const addOutput = add.output as any;
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    const domainPath = join(sourceRoot, "instructions", "full", "020-domain-guide.md");
    expect(addOutput).toMatchObject({
      ok: true,
      extensionId: "notes",
      created: {
        name: "020-domain-guide.md",
        path: domainPath,
      },
      instructionsFull: [
        {
          name: "010-notes.md",
          bypassed: false,
        },
        {
          name: "020-domain-guide.md",
          bypassed: false,
        },
      ],
      buildRequired: true,
    });
    expect(readFileSync(domainPath, "utf8")).toBe("");
    expect(existsSync(join(sourceRoot, ".svvy", "changes", `${addOutput.changeId}.json`))).toBe(
      true,
    );

    const rename = await runSvvyxExtensionsCommand({
      command:
        "svvyx extensions instructions rename notes --from 020-domain-guide.md --to 030-domain-guide.md --json",
      extensionsRoot,
    });
    expect(rename.output).toMatchObject({
      ok: true,
      extensionId: "notes",
      renamed: {
        from: "020-domain-guide.md",
        to: "030-domain-guide.md",
        path: join(sourceRoot, "instructions", "full", "030-domain-guide.md"),
      },
      instructionsFull: [
        {
          name: "010-notes.md",
        },
        {
          name: "030-domain-guide.md",
        },
      ],
      buildRequired: true,
    });
    expect(existsSync(domainPath)).toBe(false);

    const configure = await runSvvyxExtensionsCommand({
      command:
        "svvyx extensions instructions configure notes --file 030-domain-guide.md --bypassed true --json",
      extensionsRoot,
    });
    expect(configure.output).toMatchObject({
      ok: true,
      changed: true,
      extensionId: "notes",
      configured: {
        file: "030-domain-guide.md",
        before: {
          bypassed: false,
        },
        after: {
          bypassed: true,
        },
      },
      instructionsFull: [
        {
          name: "010-notes.md",
          bypassed: false,
        },
        {
          name: "030-domain-guide.md",
          bypassed: true,
        },
      ],
      buildRequired: true,
    });
    expect(
      JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8")).instructionFiles,
    ).toEqual([
      {
        file: "010-notes.md",
        bypassed: false,
      },
      {
        file: "030-domain-guide.md",
        bypassed: true,
      },
    ]);

    const idempotentConfigure = await runSvvyxExtensionsCommand({
      command:
        "svvyx extensions instructions configure notes --file 030-domain-guide.md --bypassed true --json",
      extensionsRoot,
    });
    expect(idempotentConfigure.output).toMatchObject({
      ok: true,
      changed: false,
      configured: {
        before: {
          bypassed: true,
        },
        after: {
          bypassed: true,
        },
      },
      buildRequired: false,
    });
    expect(idempotentConfigure.output).not.toHaveProperty("changeId");

    const remove = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions remove notes --name 030-domain-guide.md --json",
      extensionsRoot,
    });
    expect(remove.output).toMatchObject({
      ok: true,
      extensionId: "notes",
      removed: {
        name: "030-domain-guide.md",
        path: join(sourceRoot, "instructions", "full", "030-domain-guide.md"),
        trashId: expect.stringMatching(/^trash_/),
        trashPath: expect.stringContaining((remove.output as any).removed.trashId),
      },
      instructionsFull: [
        {
          name: "010-notes.md",
          bypassed: false,
        },
      ],
      buildRequired: true,
    });
    expect(existsSync(join(sourceRoot, "instructions", "full", "030-domain-guide.md"))).toBe(false);
  });

  it("manages builtin full instruction sources without mutating packaged defaults", async () => {
    const extensionsRoot = createTempDir();
    const cwd = createTempDir();
    const packagedFullDir = join(cwd, "generated", "instructions", "full");
    mkdirSync(packagedFullDir, { recursive: true });
    const packagedTinyfish = join(packagedFullDir, "010-tinyfish-cli.generated.md");
    writeFileSync(packagedTinyfish, "packaged tinyfish instructions\n");

    const add = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add web --name 020-domain.md --json",
      cwd,
      extensionsRoot,
    });
    const sourceRoot = join(extensionsRoot, "sources", "builtin", "web");
    const fullDir = join(sourceRoot, "instructions", "full");
    expect(add.output).toMatchObject({
      ok: true,
      extensionId: "web",
      created: {
        name: "020-domain.md",
        path: join(fullDir, "020-domain.md"),
      },
      instructionsFull: [
        {
          name: "020-domain.md",
          bypassed: false,
        },
      ],
      buildRequired: true,
    });
    expect(readFileSync(join(fullDir, "010-tinyfish-cli.generated.md"), "utf8")).toBe(
      "packaged tinyfish instructions\n",
    );
    expect(readFileSync(packagedTinyfish, "utf8")).toBe("packaged tinyfish instructions\n");
    const sourceManifest = JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8"));
    expect(sourceManifest).toMatchObject({
      id: "web",
      interface: "instructions",
      instructionFiles: [
        {
          file: "010-tinyfish-cli.generated.md",
          bypassed: false,
        },
        {
          file: "020-domain.md",
          bypassed: false,
        },
      ],
    });

    const rename = await runSvvyxExtensionsCommand({
      command:
        "svvyx extensions instructions rename web --from 020-domain.md --to 030-domain.md --json",
      cwd,
      extensionsRoot,
    });
    expect(rename.output).toMatchObject({
      ok: true,
      renamed: {
        from: "020-domain.md",
        to: "030-domain.md",
      },
      buildRequired: true,
    });

    const configure = await runSvvyxExtensionsCommand({
      command:
        "svvyx extensions instructions configure web --file 010-tinyfish-cli.generated.md --bypassed true --json",
      cwd,
      extensionsRoot,
    });
    expect(configure.output).toMatchObject({
      ok: true,
      changed: true,
      configured: {
        file: "010-tinyfish-cli.generated.md",
        before: {
          bypassed: false,
        },
        after: {
          bypassed: true,
        },
      },
      buildRequired: true,
    });

    const reorder = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions reorder web --file 030-domain.md --json",
      cwd,
      extensionsRoot,
    });
    expect(reorder.output).toMatchObject({
      ok: true,
      renamed: [
        {
          from: "030-domain.md",
          to: "010-domain.md",
        },
      ],
      instructionsFull: [
        {
          name: "010-domain.md",
          bypassed: false,
        },
      ],
      buildRequired: true,
    });
    expect(readFileSync(join(fullDir, "010-tinyfish-cli.generated.md"), "utf8")).toBe(
      "packaged tinyfish instructions\n",
    );

    const remove = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions remove web --name 010-domain.md --json",
      cwd,
      extensionsRoot,
    });
    const removeChangeId = (remove.output as any).changeId;
    expect(remove.output).toMatchObject({
      ok: true,
      removed: {
        name: "010-domain.md",
      },
      buildRequired: true,
    });
    expect(existsSync(join(fullDir, "010-domain.md"))).toBe(false);

    const revertRemove = await runSvvyxExtensionsCommand({
      command: `svvyx extensions revert ${removeChangeId} --json`,
      cwd,
      extensionsRoot,
    });
    expect(revertRemove.output).toMatchObject({
      ok: true,
      revertedChangeId: removeChangeId,
      result: {
        kind: "extension_files",
        sourceChangeKind: "instructions_remove",
        extensionId: "web",
        buildRequired: false,
        autoBuild: {
          status: "success",
          currentPath: join(extensionsRoot, "builds", "extensions", "web", "current"),
          contextReady: true,
          runtimeReady: true,
        },
      },
    });
    expect(existsSync(join(fullDir, "010-domain.md"))).toBe(true);
    expect(existsSync(join(fullDir, "010-tinyfish-cli.generated.md"))).toBe(true);
    writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "custom minimal\n");

    const reset = await runSvvyxExtensionsCommand({
      command: "svvyx extensions reset web --scope instructions --json",
      cwd,
      extensionsRoot,
    });
    const resetChangeId = (reset.output as any).changeId;
    expect(reset.output).toMatchObject({
      ok: true,
      changeId: expect.stringMatching(/^chg_/),
      extensionId: "web",
      scope: "instructions",
      result: {
        resetFiles: expect.arrayContaining([
          join(fullDir, "010-domain.md"),
          join(sourceRoot, "instructions", "minimal.md"),
          join(sourceRoot, "manifest.json"),
        ]),
        buildRequired: false,
        autoBuild: {
          status: "success",
          currentPath: join(extensionsRoot, "builds", "extensions", "web", "current"),
          contextReady: true,
          runtimeReady: true,
        },
      },
    });
    expect(reset.commandFacts).toMatchObject({
      extensionReset: true,
      extensionId: "web",
      changeId: resetChangeId,
      scope: "instructions",
      extensionReady: true,
      autoBuildStatus: "success",
    });
    expect(readdirSync(fullDir).toSorted((left, right) => left.localeCompare(right))).toEqual([
      "010-tinyfish-cli.generated.md",
    ]);
    expect(readFileSync(join(fullDir, "010-tinyfish-cli.generated.md"), "utf8")).toBe(
      "packaged tinyfish instructions\n",
    );
    expect(readFileSync(join(sourceRoot, "instructions", "minimal.md"), "utf8")).toContain(
      "TinyFish",
    );
    expect(
      JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8")).instructionFiles,
    ).toEqual([
      {
        file: "010-tinyfish-cli.generated.md",
        bypassed: false,
      },
    ]);

    const revertReset = await runSvvyxExtensionsCommand({
      command: `svvyx extensions revert ${resetChangeId} --json`,
      cwd,
      extensionsRoot,
    });
    expect(revertReset.output).toMatchObject({
      ok: true,
      revertedChangeId: resetChangeId,
      result: {
        kind: "extension_files",
        sourceChangeKind: "instructions_reset",
        extensionId: "web",
        buildRequired: false,
        autoBuild: {
          status: "success",
          currentPath: join(extensionsRoot, "builds", "extensions", "web", "current"),
          contextReady: true,
          runtimeReady: true,
        },
      },
    });
    expect(readFileSync(join(sourceRoot, "instructions", "minimal.md"), "utf8")).toBe(
      "custom minimal\n",
    );
    expect(readdirSync(fullDir).toSorted((left, right) => left.localeCompare(right))).toEqual([
      "010-domain.md",
      "010-tinyfish-cli.generated.md",
    ]);
    expect(
      JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8")).instructionFiles,
    ).toEqual([
      {
        file: "010-domain.md",
        bypassed: false,
      },
      {
        file: "010-tinyfish-cli.generated.md",
        bypassed: true,
      },
    ]);

    const cliProbe = async (requirement: ExtensionCliRequirement) =>
      cliStatus(requirement, { path: "/usr/local/bin/tinyfish", status: "available" });
    const pendingInspect = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect web --json",
      cliProbe,
      cwd,
      extensionsRoot,
    });
    expect((pendingInspect.output as any).extension.state).toMatchObject({
      draftChanged: false,
      buildRequired: false,
      ready: true,
    });

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build web --json",
      cliProbe,
      cwd,
      extensionsRoot,
    });
    const builtInspect = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect web --json",
      cliProbe,
      cwd,
      extensionsRoot,
    });
    expect((builtInspect.output as any).extension.state).toMatchObject({
      draftChanged: false,
      buildRequired: false,
    });
    expect(readFileSync(packagedTinyfish, "utf8")).toBe("packaged tinyfish instructions\n");
  });

  it("reverts recorded instruction lifecycle changes exactly", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    const fullDir = join(sourceRoot, "instructions", "full");

    const add = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-domain-guide.md --json",
      extensionsRoot,
    });
    const changeId = (add.output as any).changeId;
    writeFileSync(join(fullDir, "020-domain-guide.md"), "domain body\n");

    let conflict: unknown;
    try {
      await runSvvyxExtensionsCommand({
        command: `svvyx extensions revert ${changeId} --json`,
        extensionsRoot,
      });
    } catch (error) {
      conflict = error;
    }
    expect(formatSvvyxExtensionsError(conflict)).toMatchObject({
      ok: false,
      error: {
        code: "REVERT_CONFLICT",
        conflictingPaths: [join(fullDir, "020-domain-guide.md")],
      },
    });
    expect(readFileSync(join(fullDir, "020-domain-guide.md"), "utf8")).toBe("domain body\n");
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(
      false,
    );

    writeFileSync(join(fullDir, "020-domain-guide.md"), "");
    const revert = await runSvvyxExtensionsCommand({
      command: `svvyx extensions revert ${changeId} --json`,
      extensionsRoot,
    });
    expect(revert.output).toMatchObject({
      ok: true,
      revertedChangeId: changeId,
      changeId: expect.stringMatching(/^chg_/),
      result: {
        kind: "extension_files",
        sourceChangeKind: "instructions_add",
        extensionId: "notes",
        files: [
          {
            path: join(fullDir, "020-domain-guide.md"),
            status: "reverted",
          },
          {
            path: join(sourceRoot, "manifest.json"),
            status: "reverted",
          },
        ],
        buildRequired: false,
        autoBuild: {
          status: "success",
          currentPath: join(extensionsRoot, "builds", "extensions", "notes", "current"),
          contextReady: true,
          runtimeReady: true,
        },
      },
    });
    expect(revert.commandFacts).toMatchObject({
      extensionReverted: true,
      extensionId: "notes",
      revertedChangeId: changeId,
      revertChangeId: (revert.output as any).changeId,
      revertedChangeKind: "extension_files",
      sourceChangeKind: "instructions_add",
      extensionReady: true,
      autoBuildStatus: "success",
    });
    expect(existsSync(join(fullDir, "020-domain-guide.md"))).toBe(false);
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8")).instructionFiles,
    ).toEqual([
      {
        file: "010-notes.md",
        bypassed: false,
      },
    ]);

    const configure = await runSvvyxExtensionsCommand({
      command:
        "svvyx extensions instructions configure notes --file 010-notes.md --bypassed true --json",
      extensionsRoot,
    });
    const configureChangeId = (configure.output as any).changeId;
    const configureRevert = await runSvvyxExtensionsCommand({
      command: `svvyx extensions revert ${configureChangeId} --json`,
      extensionsRoot,
    });
    expect(configureRevert.output).toMatchObject({
      ok: true,
      revertedChangeId: configureChangeId,
      result: {
        kind: "extension_files",
        sourceChangeKind: "instructions_configure",
        files: [
          {
            path: join(sourceRoot, "manifest.json"),
            status: "reverted",
          },
        ],
        buildRequired: false,
        autoBuild: {
          status: "success",
          currentPath: join(extensionsRoot, "builds", "extensions", "notes", "current"),
          contextReady: true,
          runtimeReady: true,
        },
      },
    });
    expect(
      JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8")).instructionFiles,
    ).toEqual([
      {
        file: "010-notes.md",
        bypassed: false,
      },
    ]);
  });

  it("pauses revert-triggered auto-builds on durable dependency approval requests", async () => {
    const extensionsRoot = createTempDir();
    const dependencyApprovalStore = new ExtensionDependencyApprovalStore({
      extensionsRoot,
      createRequestId: () => "depapr_revert_notes",
    });
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      dependencies: {
        "@notes/sdk": "1.2.3",
      },
    });

    const add = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-domain-guide.md --json",
      extensionsRoot,
    });
    const changeId = (add.output as any).changeId;

    const revert = await runSvvyxExtensionsCommand({
      command: `svvyx extensions revert ${changeId} --json`,
      dependencyApprovalStore,
      extensionsRoot,
    });

    expect(revert.output).toMatchObject({
      ok: true,
      revertedChangeId: changeId,
      result: {
        kind: "extension_files",
        extensionId: "notes",
        buildRequired: true,
        autoBuild: {
          status: "needs_user_confirmation",
          approvalRequestId: "depapr_revert_notes",
          blockedOperation: "revert_auto_build",
          items: [
            {
              kind: "dependency",
              name: "@notes/sdk",
              version: "1.2.3",
              packageManager: "bun",
              source: "npm",
            },
          ],
          message: "Installing these dependency identities requires user approval.",
        },
      },
    });
    expect(revert.commandFacts).toMatchObject({
      extensionReverted: true,
      extensionId: "notes",
      dependencyApprovalRequestId: "depapr_revert_notes",
      blockedOperation: "revert_auto_build",
      autoBuildStatus: "needs_user_confirmation",
      extensionReady: false,
    });
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(
      false,
    );
    expect(dependencyApprovalStore.listRequests()).toMatchObject([
      {
        requestId: "depapr_revert_notes",
        status: "pending",
        extensionIds: ["notes"],
      },
    ]);
  });

  it("keeps instruction lifecycle reverts build-required when the follow-up build is blocked", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      dependencies: {
        "@notes/sdk": "^1.2.3",
      },
    });

    const add = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-domain-guide.md --json",
      extensionsRoot,
    });
    const changeId = (add.output as any).changeId;

    const revert = await runSvvyxExtensionsCommand({
      command: `svvyx extensions revert ${changeId} --json`,
      extensionsRoot,
    });

    expect(revert.output).toMatchObject({
      ok: true,
      revertedChangeId: changeId,
      result: {
        kind: "extension_files",
        sourceChangeKind: "instructions_add",
        extensionId: "notes",
        buildRequired: true,
        autoBuild: {
          status: "blocked",
          error: {
            code: "DEPENDENCY_VERSION_NOT_EXACT",
            extensionId: "notes",
            dependency: {
              name: "@notes/sdk",
              requested: "^1.2.3",
            },
          },
        },
      },
    });
    expect(revert.commandFacts).toMatchObject({
      extensionReverted: true,
      extensionBuildOk: false,
      validationError: "DEPENDENCY_VERSION_NOT_EXACT",
      autoBuildStatus: "blocked",
      extensionReady: false,
    });
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(
      false,
    );
  });

  it("projects reversible extension changes into inventory cards", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);

    const add = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-domain-guide.md --json",
      extensionsRoot,
    });
    const changeId = (add.output as { changeId: string }).changeId;

    const cards = readExtensionChangeCards(extensionsRoot);
    expect(cards).toEqual([
      expect.objectContaining({
        id: changeId,
        extensionId: "notes",
        kind: "extension_files",
        sourceChangeKind: "instructions_add",
        title: "Instruction file added",
        description: "notes recorded instructions_add.",
        revertCommand: `svvyx extensions revert ${changeId} --json`,
        reversible: true,
      }),
    ]);

    const inventory = await readBuiltinExtensionsInventory({
      extensionsRoot,
      includeUserExtensions: true,
    });
    expect(inventory.reversibleChanges).toEqual(cards);

    const builtinOnlyInventory = await readBuiltinExtensionsInventory({ extensionsRoot });
    expect(builtinOnlyInventory.reversibleChanges).toEqual([]);
  });

  it("projects live external instruction sources into the Extensions inventory read model", async () => {
    const inventory = await readBuiltinExtensionsInventory({
      externalInstructionSources: [
        {
          id: "0:/repo/AGENTS.md",
          kind: "AGENTS.md",
          title: "AGENTS.md",
          path: "/repo/AGENTS.md",
          content: "# Repo Standards\n\nUse the repo contract.",
          contentHash: "hash-agents",
          order: 0,
          enabled: true,
          actors: ["orchestrator", "handler"],
          sourceGroup: "workspace_chain",
          readStatus: { status: "readable" },
        },
        {
          id: "1:/repo/CLAUDE.md",
          kind: "CLAUDE.md",
          title: "CLAUDE.md",
          path: "/repo/CLAUDE.md",
          content: "",
          contentHash: "",
          order: 1,
          enabled: true,
          actors: ["orchestrator"],
          sourceGroup: "workspace_chain",
          readStatus: { status: "unreadable", error: "permission denied" },
        },
      ],
    });

    expect(
      inventory.extensions.find(
        (extension) => extension.id === "external_instruction:AGENTS.md:/repo/AGENTS.md",
      ),
    ).toMatchObject({
      category: "external_instruction",
      interface: "instructions",
      loadedInstructionContributors: [
        {
          kind: "source",
          file: {
            name: "AGENTS.md",
            path: "/repo/AGENTS.md",
            content: "# Repo Standards\n\nUse the repo contract.",
            editable: false,
            bypassed: false,
          },
        },
      ],
      tooling: {
        typescriptApiStatus: "disabled",
      },
      externalInstruction: {
        path: "/repo/AGENTS.md",
        content: "# Repo Standards\n\nUse the repo contract.",
        contentHash: "hash-agents",
        readStatus: { status: "readable" },
      },
      usage: [
        expect.objectContaining({ actorKind: "orchestrator", state: "loaded" }),
        expect.objectContaining({ actorKind: "handler", state: "loaded" }),
        expect.objectContaining({ actorKind: "workflow-task", state: "unavailable" }),
      ],
    });
    expect(
      inventory.extensions.find(
        (extension) => extension.id === "external_instruction:AGENTS.md:/repo/AGENTS.md",
      )?.minimalInstruction,
    ).toBeUndefined();
    expect(
      inventory.extensions.find(
        (extension) => extension.id === "external_instruction:CLAUDE.md:/repo/CLAUDE.md",
      ),
    ).toMatchObject({
      state: {
        ready: false,
        issues: [
          {
            code: "EXTERNAL_INSTRUCTION_UNREADABLE",
            message: "permission denied",
          },
        ],
      },
    });
  });

  it("projects builtin extension inventory from prompt contributors instead of docs files", async () => {
    const extensionsRoot = createTempDir();
    const cwd = createTempDir();
    const packagedFullDir = join(cwd, "generated", "instructions", "full");
    mkdirSync(packagedFullDir, { recursive: true });
    writeFileSync(join(packagedFullDir, "010-base-common.generated.md"), "packaged base common\n");
    writeFileSync(join(packagedFullDir, "010-tinyfish-cli.generated.md"), "packaged tinyfish\n");

    let inventory = await readBuiltinExtensionsInventory({
      cwd,
      extensionsRoot,
      includeUserExtensions: true,
    });
    const baseCommon = inventory.extensions.find((extension) => extension.id === "base-common");
    const artifacts = inventory.extensions.find((extension) => extension.id === "artifacts");
    const web = inventory.extensions.find((extension) => extension.id === "web");
    const shell = inventory.extensions.find((extension) => extension.id === "shell");

    expect(baseCommon).toMatchObject({
      customized: false,
      minimalInstruction: {
        name: "minimal.md",
        editable: true,
      },
      loadedInstructionContributors: [
        {
          kind: "source",
          file: {
            name: "010-base-common.md",
            editable: true,
          },
        },
      ],
    });
    expect(baseCommon?.minimalInstruction?.content).toContain("Load Base Common");
    expect(
      baseCommon?.loadedInstructionContributors[0]?.kind === "source"
        ? baseCommon.loadedInstructionContributors[0].file.content
        : "",
    ).toContain("You are svvy");
    expect(web).toMatchObject({
      customized: false,
      loadedInstructionContributors: [
        {
          kind: "scripted",
          name: "010-tinyfish-cli.generated.md",
          bypassed: false,
          output: {
            name: "010-tinyfish-cli.generated.md",
            editable: false,
          },
        },
      ],
    });
    const webContributor = web?.loadedInstructionContributors[0];
    expect(webContributor?.kind === "scripted" ? webContributor.output.content : "").toContain(
      "TinyFish CLI",
    );
    expect(webContributor?.kind === "scripted" ? webContributor.script.name : "").toBe(
      "generate-tinyfish-cli.ts",
    );
    expect(shell).toMatchObject({
      customized: false,
      minimalInstruction: {
        editable: true,
      },
      tooling: {
        nativeToolSchema: {
          name: "tool-schema.json",
        },
        typescriptApiStatus: "disabled",
      },
    });
    expect(shell?.loadedInstructionContributors).toEqual([
      expect.objectContaining({
        kind: "source",
        file: expect.objectContaining({
          name: "010-shell.md",
          editable: true,
        }),
      }),
      expect.objectContaining({
        kind: "source",
        file: expect.objectContaining({
          name: "020-incur-cli-usage.md",
          editable: true,
        }),
      }),
    ]);
    expect(shell?.tooling.nativeToolSchema?.content).toContain('"id": "shell"');
    expect(shell?.tooling.nativeToolSchema?.content).toContain('"tools"');
    expect(shell?.tooling.nativeToolSchema?.content).toContain('"exec_command"');
    expect(shell?.tooling.nativeToolSchema?.content).toContain('"write_stdin"');
    expect(shell?.tooling.nativeToolSchema?.content).toContain('"parameters"');
    expect(artifacts).toMatchObject({
      tooling: {
        typescriptApiStatus: "emitted",
        typescriptApiDeclaration: {
          name: "artifacts.types.d.ts",
        },
      },
    });
    expect(artifacts?.tooling.typescriptApiDeclaration?.content).toContain("artifacts");
    expect(JSON.stringify(inventory.extensions)).not.toContain("docs/specs/extension");
    expect(
      baseCommon?.loadedInstructionContributors[0]?.kind === "scripted"
        ? baseCommon.loadedInstructionContributors[0].output.path
        : baseCommon?.loadedInstructionContributors[0]?.kind === "source"
          ? baseCommon.loadedInstructionContributors[0].file.path
          : "",
    ).not.toContain("docs/");
    expect(
      web?.loadedInstructionContributors[0]?.kind === "scripted"
        ? web.loadedInstructionContributors[0].output.path
        : "",
    ).not.toContain("docs/");

    const minimalPath = join(
      extensionsRoot,
      "sources",
      "builtin",
      "base-common",
      "instructions",
      "minimal.md",
    );
    writeExtensionInstructionFile({
      extensionId: "base-common",
      kind: "minimal",
      file: "minimal.md",
      content: "Custom base common hint.\n",
      baseSourceVersion: baseCommon?.minimalInstruction?.sourceVersion,
      extensionsRoot,
    });
    expect(readFileSync(minimalPath, "utf8")).toBe("Custom base common hint.\n");

    inventory = await readBuiltinExtensionsInventory({
      cwd,
      extensionsRoot,
      includeUserExtensions: true,
    });
    expect(inventory.extensions.find((extension) => extension.id === "base-common")).toMatchObject({
      customized: true,
      minimalInstruction: {
        content: "Custom base common hint.\n",
        path: minimalPath,
      },
      loadedInstructionContributors: [
        {
          kind: "source",
          file: {
            name: "010-base-common.md",
            editable: true,
          },
        },
      ],
    });
  });

  it("keeps a deleted builtin instruction deleted until reset restores it", async () => {
    const extensionsRoot = createTempDir();
    await readBuiltinExtensionsInventory({
      extensionsRoot,
      includeUserExtensions: true,
    });

    const remove = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions remove base-common --name 010-base-common.md --json",
      extensionsRoot,
    });
    expect(remove.output).toMatchObject({
      ok: true,
      extensionId: "base-common",
      removed: {
        name: "010-base-common.md",
      },
    });

    const afterRemove = await readBuiltinExtensionsInventory({
      extensionsRoot,
      includeUserExtensions: true,
    });
    const removedBaseCommon = afterRemove.extensions.find(
      (extension) => extension.id === "base-common",
    );
    expect(removedBaseCommon?.loadedInstructionContributors).toEqual([]);

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions reset base-common --scope instructions --json",
      extensionsRoot,
    });
    const afterReset = await readBuiltinExtensionsInventory({
      extensionsRoot,
      includeUserExtensions: true,
    });
    const resetBaseCommon = afterReset.extensions.find(
      (extension) => extension.id === "base-common",
    );
    expect(resetBaseCommon?.loadedInstructionContributors).toEqual([
      expect.objectContaining({
        kind: "source",
        file: expect.objectContaining({
          name: "010-base-common.md",
          bypassed: false,
        }),
      }),
    ]);
  });

  it("inspects live external instruction records without exposing editable extension lifecycle", async () => {
    const result = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect external_instruction:AGENTS.md:/repo/AGENTS.md --json",
      externalInstructionSources: [
        {
          id: "0:/repo/AGENTS.md",
          kind: "AGENTS.md",
          title: "AGENTS.md",
          path: "/repo/AGENTS.md",
          content: "# Repo Standards\n\nUse the repo contract.",
          contentHash: "hash-agents",
          order: 0,
          enabled: true,
          actors: ["orchestrator", "handler"],
          sourceGroup: "workspace_chain",
          readStatus: { status: "readable" },
        },
      ],
    });

    expect(result.output).toMatchObject({
      ok: true,
      extension: {
        id: "external_instruction:AGENTS.md:/repo/AGENTS.md",
        category: "external_instruction",
        interface: "instructions",
        resettable: false,
        deletable: false,
        typescriptApiEnabled: false,
        externalInstruction: {
          path: "/repo/AGENTS.md",
          contentHash: "hash-agents",
          enabled: true,
          actors: ["orchestrator", "handler"],
          readStatus: { status: "readable" },
        },
        paths: {
          externalInstructionFile: "/repo/AGENTS.md",
          extensionSource: null,
          manifest: null,
          sourceRoot: null,
        },
        usage: [
          expect.objectContaining({ actorKind: "orchestrator", state: "loaded" }),
          expect.objectContaining({ actorKind: "handler", state: "loaded" }),
          expect.objectContaining({ actorKind: "workflow-task", state: "unavailable" }),
        ],
      },
    });
    expect(result.commandFacts).toMatchObject({
      extensionId: "external_instruction:AGENTS.md:/repo/AGENTS.md",
      externalInstructionPath: "/repo/AGENTS.md",
      externalInstructionReadStatus: "readable",
    });
  });

  it("projects missing-env runtime blockers from instruction lifecycle revert auto-builds", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      env: [
        {
          name: "NOTES_API_KEY",
          required: true,
          secret: true,
          description: "Notes API key.",
        },
      ],
    });
    const structuredSessionStore = createStructuredSessionStateStore({
      workspace: {
        id: "/repo/svvy",
        label: "svvy",
        cwd: "/repo/svvy",
      },
    });
    structuredSessionStore.upsertPiSession({
      sessionId: "session-revert-missing-env",
      title: "Revert missing env",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      orchestratorAgentProfileId: "default-orchestrator",
      messageCount: 0,
      status: "idle",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    });

    const add = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-domain-guide.md --json",
      extensionsRoot,
    });
    const changeId = (add.output as any).changeId;
    const revert = await runSvvyxExtensionsCommand({
      command: `svvyx extensions revert ${changeId} --json`,
      extensionsRoot,
      structuredSessionStore,
    });

    expect(revert.output).toMatchObject({
      ok: true,
      result: {
        kind: "extension_files",
        buildRequired: false,
        autoBuild: {
          status: "success",
          contextReady: true,
          runtimeReady: false,
          issues: [
            {
              code: "EXTENSION_ENV_MISSING",
              message: "Notes requires NOTES_API_KEY. Configure it in the Extensions pane.",
            },
          ],
        },
      },
    });
    expect(
      structuredSessionStore.listQueuedSurfaceMessages({
        surfacePiSessionId: "session-revert-missing-env",
      }),
    ).toEqual([]);
    structuredSessionStore.close();
  });

  it("projects missing CLI failures from instruction lifecycle revert auto-builds", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      cliRequirements: [
        {
          id: "notes-cli",
          binary: "notes",
          required: true,
          version: "1.2.3",
          installCommand: "npm install -g notes-cli@{{version}}",
        },
      ],
    });

    const add = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-domain-guide.md --json",
      extensionsRoot,
    });
    const changeId = (add.output as any).changeId;
    const revert = await runSvvyxExtensionsCommand({
      command: `svvyx extensions revert ${changeId} --json`,
      extensionsRoot,
      cliProbe: (requirement) => cliStatus(requirement, { status: "missing" }),
    });

    expect(revert.output).toMatchObject({
      ok: true,
      result: {
        kind: "extension_files",
        buildRequired: true,
        autoBuild: {
          status: "blocked",
          error: {
            code: "CLI_MISSING",
            extensionId: "notes",
            cli: {
              id: "notes-cli",
              binary: "notes",
              installCommand: "npm install -g notes-cli@1.2.3",
            },
          },
        },
      },
    });
    expect(revert.commandFacts).toMatchObject({
      extensionBuildOk: false,
      cliRequirementStatus: "missing",
      cliRequirementId: "notes-cli",
      autoBuildStatus: "blocked",
      extensionReady: false,
    });
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(
      false,
    );
  });

  it("normalizes stale base prompt sources away from generated instruction metadata", async () => {
    const extensionsRoot = createTempDir();
    const sourceRoot = join(extensionsRoot, "sources", "builtin", "base-common");
    const fullDir = join(sourceRoot, "instructions", "full");
    mkdirSync(fullDir, { recursive: true });
    mkdirSync(join(sourceRoot, "instructions"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          id: "base-common",
          title: "Base Common",
          description: "Shared svvy operating instructions.",
          interface: "instructions",
          typescriptApiEnabled: false,
          instructionFiles: [{ file: "010-base-common.generated.md", bypassed: false }],
          generatedInstructions: [
            {
              output: "instructions/full/010-base-common.generated.md",
              script: "scripts/generate-api-declarations.ts",
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(
      join(fullDir, "010-base-common.generated.md"),
      "#!/usr/bin/env bun\n\nstale generator source\n",
    );
    writeFileSync(
      join(sourceRoot, "instructions", "minimal.md"),
      "Shared operating instructions are loaded automatically.\n",
    );

    const inventory = await readBuiltinExtensionsInventory({
      extensionsRoot,
      includeUserExtensions: true,
    });
    const baseCommon = inventory.extensions.find((extension) => extension.id === "base-common");

    expect(baseCommon).toMatchObject({
      customized: false,
      state: {
        ready: true,
        issues: [],
      },
      loadedInstructionContributors: [
        {
          kind: "source",
          file: {
            name: "010-base-common.md",
            editable: true,
          },
        },
      ],
    });
    expect(baseCommon?.minimalInstruction?.content).toContain("Load Base Common");
    expect(baseCommon?.loadedInstructionContributors).toHaveLength(1);
    expect(
      baseCommon?.loadedInstructionContributors.some(
        (contributor) => contributor.kind === "scripted",
      ),
    ).toBe(false);
    expect(readFileSync(join(fullDir, "010-base-common.md"), "utf8")).toContain("You are svvy");
    const manifest = JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8"));
    expect(manifest.generatedInstructions).toBeUndefined();
    expect(manifest.instructionFiles).toEqual([
      {
        file: "010-base-common.md",
        bypassed: false,
      },
    ]);
  });

  it("scaffolds and resets editable base prompt builtin sources", async () => {
    const extensionsRoot = createTempDir();
    const basePrompts = [
      {
        id: "base-common",
        file: "010-base-common.md",
        marker: "You are svvy, a pragmatic software engineering assistant",
      },
      {
        id: "base-orchestrator",
        file: "010-base-orchestrator.md",
        marker: "This surface is the orchestrator.",
      },
      {
        id: "base-handler",
        file: "010-base-handler.md",
        marker: "This surface is a delegated handler thread.",
      },
      {
        id: "base-workflow-task",
        file: "010-base-workflow-task.md",
        marker: "You are a task-scoped coding agent",
      },
    ];

    for (const basePrompt of basePrompts) {
      const inspectPrompt = await runSvvyxExtensionsCommand({
        command: `svvyx extensions inspect ${basePrompt.id} --json`,
        extensionsRoot,
      });
      const promptRoot = join(extensionsRoot, "sources", "builtin", basePrompt.id);
      const promptFile = join(promptRoot, "instructions", "full", basePrompt.file);

      expect((inspectPrompt.output as any).extension.paths.instructionsFull).toEqual([
        {
          name: basePrompt.file,
          path: promptFile,
          bypassed: false,
        },
      ]);
      expect(readFileSync(promptFile, "utf8")).toContain(basePrompt.marker);
    }

    const inspect = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect base-common --json",
      extensionsRoot,
    });
    const sourceRoot = join(extensionsRoot, "sources", "builtin", "base-common");
    const fullDir = join(sourceRoot, "instructions", "full");
    const baseFile = join(fullDir, "010-base-common.md");

    expect((inspect.output as any).extension.paths.instructionsFull).toEqual([
      {
        name: "010-base-common.md",
        path: baseFile,
        bypassed: false,
      },
    ]);
    expect(readFileSync(baseFile, "utf8")).toContain(
      "You are svvy, a pragmatic software engineering assistant",
    );
    expect(JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8"))).toMatchObject({
      id: "base-common",
      interface: "instructions",
      instructionFiles: [
        {
          file: "010-base-common.md",
          bypassed: false,
        },
      ],
    });

    writeFileSync(baseFile, "# Edited Base\n\nUse a local edit.\n");
    const reset = await runSvvyxExtensionsCommand({
      command: "svvyx extensions reset base-common --scope instructions --json",
      extensionsRoot,
    });

    expect(reset.output).toMatchObject({
      ok: true,
      extensionId: "base-common",
      scope: "instructions",
      result: {
        buildRequired: false,
        autoBuild: {
          status: "success",
          contextReady: true,
          runtimeReady: true,
        },
      },
    });
    expect(readFileSync(baseFile, "utf8")).toContain(
      "You are svvy, a pragmatic software engineering assistant",
    );
    expect(readFileSync(baseFile, "utf8")).not.toContain("Use a local edit.");
  });

  it("rejects reset for user extensions and unsupported reset scopes", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);

    expect(
      formatSvvyxExtensionsError(
        await catchError(
          runSvvyxExtensionsCommand({
            command: "svvyx extensions reset notes --scope instructions --json",
            extensionsRoot,
          }),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "NOT_BUILTIN",
        message: "Only builtin extensions can be reset to builtin defaults.",
      },
    });

    expect(
      formatSvvyxExtensionsError(
        await catchError(
          runSvvyxExtensionsCommand({
            command: "svvyx extensions reset web --scope all --json",
            extensionsRoot,
          }),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "UNSUPPORTED_RESET_SCOPE",
        message: "Only --scope instructions is currently resettable.",
      },
    });
  });

  it("projects missing CLI failures from builtin reset auto-builds", async () => {
    const extensionsRoot = createTempDir();
    const cwd = createTempDir();
    const reset = await runSvvyxExtensionsCommand({
      command: "svvyx extensions reset web --scope instructions --json",
      cwd,
      extensionsRoot,
      cliProbe: (requirement) => cliStatus(requirement, { status: "missing" }),
    });

    expect(reset.output).toMatchObject({
      ok: true,
      extensionId: "web",
      scope: "instructions",
      result: {
        buildRequired: true,
        autoBuild: {
          status: "blocked",
          error: {
            code: "CLI_MISSING",
            extensionId: "web",
            cli: {
              id: "tinyfish",
              binary: "tinyfish",
            },
          },
        },
      },
    });
    expect(reset.commandFacts).toMatchObject({
      extensionReset: true,
      extensionBuildOk: false,
      cliRequirementStatus: "missing",
      cliRequirementId: "tinyfish",
      autoBuildStatus: "blocked",
      extensionReady: false,
    });
  });

  it("pauses reset-triggered auto-builds on durable dependency approval requests", async () => {
    const extensionsRoot = createTempDir();
    const cwd = createTempDir();
    const dependencyApprovalStore = new ExtensionDependencyApprovalStore({
      extensionsRoot,
      createRequestId: () => "depapr_reset_web",
    });
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add web --name 020-domain.md --json",
      cwd,
      extensionsRoot,
    });
    const sourceManifestPath = join(extensionsRoot, "sources", "builtin", "web", "manifest.json");
    const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
    sourceManifest.dependencies = {
      "@web/runtime": "2.3.4",
    };
    writeFileSync(sourceManifestPath, JSON.stringify(sourceManifest, null, 2) + "\n");

    const reset = await runSvvyxExtensionsCommand({
      command: "svvyx extensions reset web --scope instructions --json",
      cwd,
      dependencyApprovalStore,
      extensionsRoot,
      cliProbe: (requirement) => cliStatus(requirement, { status: "available" }),
    });

    expect(reset.output).toMatchObject({
      ok: true,
      extensionId: "web",
      scope: "instructions",
      result: {
        buildRequired: true,
        autoBuild: {
          status: "needs_user_confirmation",
          approvalRequestId: "depapr_reset_web",
          blockedOperation: "build",
          items: [
            {
              kind: "dependency",
              name: "@web/runtime",
              version: "2.3.4",
              packageManager: "bun",
              source: "npm",
            },
          ],
          message: "Installing these dependency identities requires user approval.",
        },
      },
    });
    expect(reset.commandFacts).toMatchObject({
      extensionReset: true,
      extensionId: "web",
      dependencyApprovalRequestId: "depapr_reset_web",
      blockedOperation: "build",
      autoBuildStatus: "needs_user_confirmation",
      extensionReady: false,
    });
    expect(dependencyApprovalStore.listRequests()).toMatchObject([
      {
        requestId: "depapr_reset_web",
        status: "pending",
        extensionIds: ["web"],
      },
    ]);
  });

  it("deletes user extensions through trash and reverts delete changes", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");

    const deleted = await runSvvyxExtensionsCommand({
      command: "svvyx extensions delete notes --json",
      extensionsRoot,
    });
    const deleteOutput = deleted.output as any;
    expect(deleteOutput).toMatchObject({
      ok: true,
      extensionId: "notes",
      deleted: true,
    });
    expect(deleteOutput.changeId).toMatch(/^chg_/);
    expect(deleteOutput.trashId).toMatch(/^trash_/);
    const trashId = deleteOutput.trashId as string;
    expect(deleted.commandFacts).toMatchObject({
      extensionDeleted: true,
      extensionId: "notes",
      changeId: deleteOutput.changeId,
      trashId,
    });
    const trashSourceRoot = join(extensionsRoot, "trash", trashId, "sources", "user", "notes");
    expect(existsSync(sourceRoot)).toBe(false);
    expect(existsSync(join(trashSourceRoot, "manifest.json"))).toBe(true);
    await expect(
      runSvvyxExtensionsCommand({
        command: "svvyx extensions inspect notes --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Extension not found: notes");

    const restored = await runSvvyxExtensionsCommand({
      command: `svvyx extensions revert ${deleteOutput.changeId} --json`,
      extensionsRoot,
    });
    expect(restored.output).toMatchObject({
      ok: true,
      revertedChangeId: deleteOutput.changeId,
      changeId: expect.stringMatching(/^chg_/),
      result: {
        kind: "extension_delete",
        extensionId: "notes",
        restored: true,
        trashId,
        buildRequired: true,
        autoBuild: null,
      },
    });
    expect(existsSync(join(sourceRoot, "manifest.json"))).toBe(true);
    expect(existsSync(trashSourceRoot)).toBe(false);
  });

  it("rejects non-user delete and delete revert collisions", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const deleted = await runSvvyxExtensionsCommand({
      command: "svvyx extensions delete notes --json",
      extensionsRoot,
    });
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          id: "notes",
          title: "Notes",
          description: "Conflicting active source.",
          interface: "instructions",
          typescriptApiEnabled: false,
        },
        null,
        2,
      ) + "\n",
    );

    expect(
      formatSvvyxExtensionsError(
        await catchError(
          runSvvyxExtensionsCommand({
            command: `svvyx extensions revert ${(deleted.output as any).changeId} --json`,
            extensionsRoot,
          }),
        ),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "REVERT_CONFLICT",
        conflictingPaths: [sourceRoot],
      },
    });

    expect(
      formatSvvyxExtensionsError(
        await catchError(
          runSvvyxExtensionsCommand({
            command: "svvyx extensions delete web --json",
            extensionsRoot,
          }),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "BUILTIN_NOT_DELETABLE",
        message: "Builtin extensions cannot be deleted. Use reset instead.",
      },
    });
  });

  it("blocks stale svvyx runtime dispatch after deleting a built user extension", async () => {
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });

    const beforeDelete = await runSvvyxRuntimeCommand({
      command: "svvyx linear --help",
      extensionsRoot,
    });
    expect(beforeDelete.output).toMatchObject({
      ok: true,
      extensionId: "linear",
    });

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions delete linear --json",
      extensionsRoot,
    });
    expect(
      formatSvvyxRuntimeError(
        await catchError(
          runSvvyxRuntimeCommand({
            command: "svvyx linear --help",
            extensionsRoot,
          }),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "extension_not_found",
        message: "Extension not found: linear",
      },
      commandFacts: {
        svvyxDispatch: true,
        extensionId: "linear",
        extensionArgv: ["--help"],
        runtimeReady: false,
        errorCode: "extension_not_found",
        currentBuildStatus: "unknown_extension",
      },
    });
  });

  it("redacts exact secret values from generated client result data and error data", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "test-secret";
    const sourceRoot = join(extensionsRoot, "sources", "user", extensionId);
    const currentRoot = join(extensionsRoot, "builds", "extensions", extensionId, "current");
    const generatedRoot = join(extensionsRoot, "generated", "extensions", extensionId);
    mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
    mkdirSync(join(currentRoot, "source"), { recursive: true });
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "instructions", "full", "010-main.md"), "# Main\n");
    writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: extensionId,
        title: extensionId,
        description: `${extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [{ file: "010-main.md", bypassed: false }],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensionId,
        interface: "svvyx",
        module: "source/index.js",
        commandManifest: {
          version: "incur.v1",
          commands: [
            {
              name: "test",
              schema: {
                args: {
                  type: "object",
                  properties: { input: { type: "string" } },
                  required: ["input"],
                },
                output: {
                  type: "object",
                  properties: { secret: { type: "string" }, plain: { type: "string" } },
                },
              },
            },
          ],
        },
        typescriptTypes: join(generatedRoot, "types.d.ts"),
        env: [{ name: "SECRET_TOKEN", required: true, secret: true, description: "Secret token." }],
        dependencies: [],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "source", "index.js"),
      [
        'import { Cli, z } from "incur";',
        `const cli = Cli.create("${extensionId}");`,
        'cli.command("test", {',
        "  args: z.object({ input: z.string() }),",
        "  env: z.object({ SECRET_TOKEN: z.string() }),",
        "  run(c) {",
        "    return { secret: c.env.SECRET_TOKEN, plain: c.args.input };",
        "  },",
        "});",
        "export default cli;",
        "",
      ].join("\n"),
    );
    writeFileSync(join(generatedRoot, "types.d.ts"), "export {};\n");
    const repoNodeModules = join(process.cwd(), "node_modules");
    const packageRootNodeModules = join(extensionsRoot, "package", "node_modules");
    const rootNodeModules = join(extensionsRoot, "node_modules");
    mkdirSync(join(extensionsRoot, "package"), { recursive: true });
    if (!existsSync(packageRootNodeModules)) {
      symlinkSync(repoNodeModules, packageRootNodeModules);
    }
    if (!existsSync(rootNodeModules)) {
      symlinkSync(repoNodeModules, rootNodeModules);
    }

    const result = await runSvvyxRuntimeGeneratedClientCommand({
      commandId: "test",
      clientInput: { args: { input: "hello" } },
      envSecretStore: {
        get: () => "super-secret-value",
        has: () => true,
        set: () => undefined,
        remove: () => undefined,
      },
      extensionId,
      extensionsRoot,
    });

    const typedResult = result as Record<string, unknown>;
    expect(typedResult.ok).toBe(true);
    const data = typedResult.data as Record<string, unknown>;
    expect(data.secret).toBe("[REDACTED]");
    expect(data.plain).toBe("hello");
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
    const meta = typedResult.meta as Record<string, unknown>;
    expect(meta.commandFacts).toMatchObject({
      extensionId: "test-secret",
      commandId: "test",
      runtimeReady: true,
    });
  });

  it("redacts exact secret values from ClientError data and fieldErrors", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "test-secret-error";
    const sourceRoot = join(extensionsRoot, "sources", "user", extensionId);
    const currentRoot = join(extensionsRoot, "builds", "extensions", extensionId, "current");
    const generatedRoot = join(extensionsRoot, "generated", "extensions", extensionId);
    mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
    mkdirSync(join(currentRoot, "source"), { recursive: true });
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "instructions", "full", "010-main.md"), "# Main\n");
    writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: extensionId,
        title: extensionId,
        description: `${extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [{ file: "010-main.md", bypassed: false }],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensionId,
        interface: "svvyx",
        module: "source/index.js",
        commandManifest: {
          version: "incur.v1",
          commands: [
            {
              name: "test",
              schema: {
                args: {
                  type: "object",
                  properties: { input: { type: "string" } },
                  required: ["input"],
                },
              },
            },
          ],
        },
        typescriptTypes: join(generatedRoot, "types.d.ts"),
        env: [{ name: "SECRET_TOKEN", required: true, secret: true, description: "Secret token." }],
        dependencies: [],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "source", "index.js"),
      [
        'import { Cli, z } from "incur";',
        'import { Client } from "incur/client";',
        `const cli = Cli.create("${extensionId}");`,
        'cli.command("test", {',
        "  args: z.object({ input: z.string() }),",
        "  env: z.object({ SECRET_TOKEN: z.string() }),",
        "  run(c) {",
        "    throw new Client.ClientError(`failed with ${c.env.SECRET_TOKEN}`, {",
        '      code: "VALIDATION_ERROR",',
        "      data: { nested: { token: c.env.SECRET_TOKEN } },",
        '      fieldErrors: [{ path: "token", message: c.env.SECRET_TOKEN }],',
        "    });",
        "  },",
        "});",
        "export default cli;",
        "",
      ].join("\n"),
    );
    writeFileSync(join(generatedRoot, "types.d.ts"), "export {};\n");
    const repoNodeModules = join(process.cwd(), "node_modules");
    const packageRootNodeModules = join(extensionsRoot, "package", "node_modules");
    const rootNodeModules = join(extensionsRoot, "node_modules");
    mkdirSync(join(extensionsRoot, "package"), { recursive: true });
    if (!existsSync(packageRootNodeModules)) {
      symlinkSync(repoNodeModules, packageRootNodeModules);
    }
    if (!existsSync(rootNodeModules)) {
      symlinkSync(repoNodeModules, rootNodeModules);
    }

    const error = await catchError(
      runSvvyxRuntimeGeneratedClientCommand({
        commandId: "test",
        clientInput: { args: { input: "hello" } },
        envSecretStore: {
          get: () => "super-secret-value",
          has: () => true,
          set: () => undefined,
          remove: () => undefined,
        },
        extensionId,
        extensionsRoot,
      }),
    );

    expect(error instanceof Error).toBe(true);
    const typedError = error as Error & { data?: unknown; fieldErrors?: unknown; meta?: unknown };
    expect(typedError.message).not.toContain("super-secret-value");
    expect(typedError.message).toContain("[REDACTED]");
    // Incur wraps extension errors as RPC envelopes; the redacted message is the only
    // secret-bearing surface that reaches the client. The error data is the envelope itself
    // which contains the already-redacted message.
    expect(JSON.stringify(typedError)).not.toContain("super-secret-value");
  });

  it("redacts exact secret values from structured data recursively", () => {
    const declarations = [
      { name: "SECRET_TOKEN", required: true, secret: true, description: "Secret token." },
    ];
    const env = { SECRET_TOKEN: "super-secret-value" };
    const result = redactStructuredData(
      {
        ok: true,
        data: {
          nested: { token: "super-secret-value" },
          plain: "hello",
        },
        output: {
          text: "super-secret-value and hello",
        },
        meta: {
          command: "test",
          duration: "1ms",
        },
      },
      declarations,
      env,
    );
    const typedResult = result as Record<string, unknown>;
    const data = typedResult.data as Record<string, unknown>;
    expect(data.nested).toMatchObject({ token: "[REDACTED]" });
    expect(data.plain).toBe("hello");
    const output = typedResult.output as Record<string, unknown>;
    expect(output.text).toBe("[REDACTED] and hello");
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
  });

  it("redacts exact secret values from ClientError fieldErrors and data", () => {
    const declarations = [
      { name: "SECRET_TOKEN", required: true, secret: true, description: "Secret token." },
    ];
    const env = { SECRET_TOKEN: "super-secret-value" };
    const result = redactStructuredData(
      {
        code: "VALIDATION_ERROR",
        message: "failed with super-secret-value",
        data: {
          nested: { token: "super-secret-value" },
        },
        fieldErrors: [{ path: "token", message: "super-secret-value" }],
      },
      declarations,
      env,
    );
    const typedResult = result as Record<string, unknown>;
    expect(typedResult.message).toBe("failed with [REDACTED]");
    const data = typedResult.data as Record<string, unknown> | undefined;
    expect(data?.nested).toMatchObject({ token: "[REDACTED]" });
    const fieldErrors = typedResult.fieldErrors as
      | Array<{ path: string; message: string }>
      | undefined;
    expect(fieldErrors?.[0]?.message).toBe("[REDACTED]");
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
  });

  it("rejects missing command id", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "test-missing-cmd";
    const sourceRoot = join(extensionsRoot, "sources", "user", extensionId);
    const currentRoot = join(extensionsRoot, "builds", "extensions", extensionId, "current");
    const generatedRoot = join(extensionsRoot, "generated", "extensions", extensionId);
    mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
    mkdirSync(join(currentRoot, "source"), { recursive: true });
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "instructions", "full", "010-main.md"), "# Main\n");
    writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: extensionId,
        title: extensionId,
        description: `${extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [{ file: "010-main.md", bypassed: false }],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensionId,
        interface: "svvyx",
        module: "source/index.js",
        commandManifest: {
          version: "incur.v1",
          commands: [{ name: "test" }],
        },
        typescriptTypes: join(generatedRoot, "types.d.ts"),
        env: [],
        dependencies: [],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "source", "index.js"),
      [
        'import { Cli, z } from "incur";',
        `const cli = Cli.create("${extensionId}");`,
        'cli.command("test", {',
        "  args: z.object({ input: z.string() }),",
        "  run(c) {",
        "    return { ok: true, data: c.args.input };",
        "  },",
        "});",
        "export default cli;",
        "",
      ].join("\n"),
    );
    writeFileSync(join(generatedRoot, "types.d.ts"), "export {};\n");
    const repoNodeModules = join(process.cwd(), "node_modules");
    const packageRootNodeModules = join(extensionsRoot, "package", "node_modules");
    const rootNodeModules = join(extensionsRoot, "node_modules");
    mkdirSync(join(extensionsRoot, "package"), { recursive: true });
    if (!existsSync(packageRootNodeModules)) {
      symlinkSync(repoNodeModules, packageRootNodeModules);
    }
    if (!existsSync(rootNodeModules)) {
      symlinkSync(repoNodeModules, rootNodeModules);
    }

    const error = await catchError(
      runSvvyxRuntimeGeneratedClientCommand({
        commandId: "",
        clientInput: undefined,
        extensionId,
        extensionsRoot,
      }),
    );
    expect(error).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("Missing command id"),
    });
  });

  it("rejects command not in manifest", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "test-no-cmd";
    const sourceRoot = join(extensionsRoot, "sources", "user", extensionId);
    const currentRoot = join(extensionsRoot, "builds", "extensions", extensionId, "current");
    const generatedRoot = join(extensionsRoot, "generated", "extensions", extensionId);
    mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
    mkdirSync(join(currentRoot, "source"), { recursive: true });
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "instructions", "full", "010-main.md"), "# Main\n");
    writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: extensionId,
        title: extensionId,
        description: `${extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [{ file: "010-main.md", bypassed: false }],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensionId,
        interface: "svvyx",
        module: "source/index.js",
        commandManifest: {
          version: "incur.v1",
          commands: [{ name: "existing" }],
        },
        typescriptTypes: join(generatedRoot, "types.d.ts"),
        env: [],
        dependencies: [],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "source", "index.js"),
      [
        'import { Cli, z } from "incur";',
        `const cli = Cli.create("${extensionId}");`,
        'cli.command("existing", {',
        "  run(c) {",
        "    return { ok: true };",
        "  },",
        "});",
        "export default cli;",
        "",
      ].join("\n"),
    );
    writeFileSync(join(generatedRoot, "types.d.ts"), "export {};\n");
    const repoNodeModules = join(process.cwd(), "node_modules");
    const packageRootNodeModules = join(extensionsRoot, "package", "node_modules");
    const rootNodeModules = join(extensionsRoot, "node_modules");
    mkdirSync(join(extensionsRoot, "package"), { recursive: true });
    if (!existsSync(packageRootNodeModules)) {
      symlinkSync(repoNodeModules, packageRootNodeModules);
    }
    if (!existsSync(rootNodeModules)) {
      symlinkSync(repoNodeModules, rootNodeModules);
    }

    const error = await catchError(
      runSvvyxRuntimeGeneratedClientCommand({
        commandId: "nonexistent",
        clientInput: undefined,
        extensionId,
        extensionsRoot,
      }),
    );
    expect(error).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("not found in extension manifest"),
    });
  });

  it("rejects non-object input", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "test-non-obj";
    const sourceRoot = join(extensionsRoot, "sources", "user", extensionId);
    const currentRoot = join(extensionsRoot, "builds", "extensions", extensionId, "current");
    const generatedRoot = join(extensionsRoot, "generated", "extensions", extensionId);
    mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
    mkdirSync(join(currentRoot, "source"), { recursive: true });
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "instructions", "full", "010-main.md"), "# Main\n");
    writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: extensionId,
        title: extensionId,
        description: `${extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [{ file: "010-main.md", bypassed: false }],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensionId,
        interface: "svvyx",
        module: "source/index.js",
        commandManifest: {
          version: "incur.v1",
          commands: [{ name: "test" }],
        },
        typescriptTypes: join(generatedRoot, "types.d.ts"),
        env: [],
        dependencies: [],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "source", "index.js"),
      [
        'import { Cli, z } from "incur";',
        `const cli = Cli.create("${extensionId}");`,
        'cli.command("test", {',
        "  run(c) {",
        "    return { ok: true };",
        "  },",
        "});",
        "export default cli;",
        "",
      ].join("\n"),
    );
    writeFileSync(join(generatedRoot, "types.d.ts"), "export {};\n");
    const repoNodeModules = join(process.cwd(), "node_modules");
    const packageRootNodeModules = join(extensionsRoot, "package", "node_modules");
    const rootNodeModules = join(extensionsRoot, "node_modules");
    mkdirSync(join(extensionsRoot, "package"), { recursive: true });
    if (!existsSync(packageRootNodeModules)) {
      symlinkSync(repoNodeModules, packageRootNodeModules);
    }
    if (!existsSync(rootNodeModules)) {
      symlinkSync(repoNodeModules, rootNodeModules);
    }

    const error = await catchError(
      runSvvyxRuntimeGeneratedClientCommand({
        commandId: "test",
        clientInput: "not-an-object" as unknown,
        extensionId,
        extensionsRoot,
      }),
    );
    expect(error).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("Input must be an object"),
    });
  });

  it("rejects invalid selection type", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "test-bad-sel";
    const sourceRoot = join(extensionsRoot, "sources", "user", extensionId);
    const currentRoot = join(extensionsRoot, "builds", "extensions", extensionId, "current");
    const generatedRoot = join(extensionsRoot, "generated", "extensions", extensionId);
    mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
    mkdirSync(join(currentRoot, "source"), { recursive: true });
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "instructions", "full", "010-main.md"), "# Main\n");
    writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: extensionId,
        title: extensionId,
        description: `${extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [{ file: "010-main.md", bypassed: false }],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensionId,
        interface: "svvyx",
        module: "source/index.js",
        commandManifest: {
          version: "incur.v1",
          commands: [{ name: "test" }],
        },
        typescriptTypes: join(generatedRoot, "types.d.ts"),
        env: [],
        dependencies: [],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "source", "index.js"),
      [
        'import { Cli, z } from "incur";',
        `const cli = Cli.create("${extensionId}");`,
        'cli.command("test", {',
        "  run(c) {",
        "    return { ok: true };",
        "  },",
        "});",
        "export default cli;",
        "",
      ].join("\n"),
    );
    writeFileSync(join(generatedRoot, "types.d.ts"), "export {};\n");
    const repoNodeModules = join(process.cwd(), "node_modules");
    const packageRootNodeModules = join(extensionsRoot, "package", "node_modules");
    const rootNodeModules = join(extensionsRoot, "node_modules");
    mkdirSync(join(extensionsRoot, "package"), { recursive: true });
    if (!existsSync(packageRootNodeModules)) {
      symlinkSync(repoNodeModules, packageRootNodeModules);
    }
    if (!existsSync(rootNodeModules)) {
      symlinkSync(repoNodeModules, rootNodeModules);
    }

    const error = await catchError(
      runSvvyxRuntimeGeneratedClientCommand({
        commandId: "test",
        clientInput: { selection: "not-an-array" },
        extensionId,
        extensionsRoot,
      }),
    );
    expect(error).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("selection must be a non-empty string array."),
    });
  });

  it("rejects invalid outputFormat", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "test-bad-fmt";
    const sourceRoot = join(extensionsRoot, "sources", "user", extensionId);
    const currentRoot = join(extensionsRoot, "builds", "extensions", extensionId, "current");
    const generatedRoot = join(extensionsRoot, "generated", "extensions", extensionId);
    mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
    mkdirSync(join(currentRoot, "source"), { recursive: true });
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "instructions", "full", "010-main.md"), "# Main\n");
    writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: extensionId,
        title: extensionId,
        description: `${extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [{ file: "010-main.md", bypassed: false }],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensionId,
        interface: "svvyx",
        module: "source/index.js",
        commandManifest: {
          version: "incur.v1",
          commands: [{ name: "test" }],
        },
        typescriptTypes: join(generatedRoot, "types.d.ts"),
        env: [],
        dependencies: [],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "source", "index.js"),
      [
        'import { Cli, z } from "incur";',
        `const cli = Cli.create("${extensionId}");`,
        'cli.command("test", {',
        "  run(c) {",
        "    return { ok: true };",
        "  },",
        "});",
        "export default cli;",
        "",
      ].join("\n"),
    );
    writeFileSync(join(generatedRoot, "types.d.ts"), "export {};\n");
    const repoNodeModules = join(process.cwd(), "node_modules");
    const packageRootNodeModules = join(extensionsRoot, "package", "node_modules");
    const rootNodeModules = join(extensionsRoot, "node_modules");
    mkdirSync(join(extensionsRoot, "package"), { recursive: true });
    if (!existsSync(packageRootNodeModules)) {
      symlinkSync(repoNodeModules, packageRootNodeModules);
    }
    if (!existsSync(rootNodeModules)) {
      symlinkSync(repoNodeModules, rootNodeModules);
    }

    const error = await catchError(
      runSvvyxRuntimeGeneratedClientCommand({
        commandId: "test",
        clientInput: { outputFormat: "xml" },
        extensionId,
        extensionsRoot,
      }),
    );
    expect(error).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("outputFormat must be one of"),
    });
  });

  it("rejects negative token limits", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "test-neg-tokens";
    const sourceRoot = join(extensionsRoot, "sources", "user", extensionId);
    const currentRoot = join(extensionsRoot, "builds", "extensions", extensionId, "current");
    const generatedRoot = join(extensionsRoot, "generated", "extensions", extensionId);
    mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
    mkdirSync(join(currentRoot, "source"), { recursive: true });
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "instructions", "full", "010-main.md"), "# Main\n");
    writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: extensionId,
        title: extensionId,
        description: `${extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [{ file: "010-main.md", bypassed: false }],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensionId,
        interface: "svvyx",
        module: "source/index.js",
        commandManifest: {
          version: "incur.v1",
          commands: [{ name: "test" }],
        },
        typescriptTypes: join(generatedRoot, "types.d.ts"),
        env: [],
        dependencies: [],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "source", "index.js"),
      [
        'import { Cli, z } from "incur";',
        `const cli = Cli.create("${extensionId}");`,
        'cli.command("test", {',
        "  run(c) {",
        "    return { ok: true };",
        "  },",
        "});",
        "export default cli;",
        "",
      ].join("\n"),
    );
    writeFileSync(join(generatedRoot, "types.d.ts"), "export {};\n");
    const repoNodeModules = join(process.cwd(), "node_modules");
    const packageRootNodeModules = join(extensionsRoot, "package", "node_modules");
    const rootNodeModules = join(extensionsRoot, "node_modules");
    mkdirSync(join(extensionsRoot, "package"), { recursive: true });
    if (!existsSync(packageRootNodeModules)) {
      symlinkSync(repoNodeModules, packageRootNodeModules);
    }
    if (!existsSync(rootNodeModules)) {
      symlinkSync(repoNodeModules, rootNodeModules);
    }

    const error1 = await catchError(
      runSvvyxRuntimeGeneratedClientCommand({
        commandId: "test",
        clientInput: { outputTokenLimit: -1 },
        extensionId,
        extensionsRoot,
      }),
    );
    expect(error1).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("outputTokenLimit must be a non-negative integer"),
    });

    const error2 = await catchError(
      runSvvyxRuntimeGeneratedClientCommand({
        commandId: "test",
        clientInput: { outputTokenOffset: 1.5 },
        extensionId,
        extensionsRoot,
      }),
    );
    expect(error2).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("outputTokenOffset must be a non-negative integer"),
    });

    const error3 = await catchError(
      runSvvyxRuntimeGeneratedClientCommand({
        commandId: "test",
        clientInput: { outputTokenLimit: NaN },
        extensionId,
        extensionsRoot,
      }),
    );
    expect(error3).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("outputTokenLimit must be a non-negative integer"),
    });
  });

  it("rejects args on schema-less commands", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "test-no-schema-args";
    const sourceRoot = join(extensionsRoot, "sources", "user", extensionId);
    const currentRoot = join(extensionsRoot, "builds", "extensions", extensionId, "current");
    const generatedRoot = join(extensionsRoot, "generated", "extensions", extensionId);
    mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
    mkdirSync(join(currentRoot, "source"), { recursive: true });
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "instructions", "full", "010-main.md"), "# Main\n");
    writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: extensionId,
        title: extensionId,
        description: `${extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [{ file: "010-main.md", bypassed: false }],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensionId,
        interface: "svvyx",
        module: "source/index.js",
        commandManifest: {
          version: "incur.v1",
          commands: [{ name: "test" }],
        },
        typescriptTypes: join(generatedRoot, "types.d.ts"),
        env: [],
        dependencies: [],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "source", "index.js"),
      [
        'import { Cli, z } from "incur";',
        `const cli = Cli.create("${extensionId}");`,
        'cli.command("test", {',
        "  run(c) {",
        "    return { ok: true };",
        "  },",
        "});",
        "export default cli;",
        "",
      ].join("\n"),
    );
    writeFileSync(join(generatedRoot, "types.d.ts"), "export {};\n");
    const repoNodeModules = join(process.cwd(), "node_modules");
    const packageRootNodeModules = join(extensionsRoot, "package", "node_modules");
    const rootNodeModules = join(extensionsRoot, "node_modules");
    mkdirSync(join(extensionsRoot, "package"), { recursive: true });
    if (!existsSync(packageRootNodeModules)) {
      symlinkSync(repoNodeModules, packageRootNodeModules);
    }
    if (!existsSync(rootNodeModules)) {
      symlinkSync(repoNodeModules, rootNodeModules);
    }

    const error = await catchError(
      runSvvyxRuntimeGeneratedClientCommand({
        commandId: "test",
        clientInput: { args: { anything: "x" } },
        extensionId,
        extensionsRoot,
      }),
    );
    expect(error).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("Unsupported args key"),
    });
  });

  it("rejects options on schema-less commands", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "test-no-schema-opts";
    const sourceRoot = join(extensionsRoot, "sources", "user", extensionId);
    const currentRoot = join(extensionsRoot, "builds", "extensions", extensionId, "current");
    const generatedRoot = join(extensionsRoot, "generated", "extensions", extensionId);
    mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
    mkdirSync(join(currentRoot, "source"), { recursive: true });
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "instructions", "full", "010-main.md"), "# Main\n");
    writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: extensionId,
        title: extensionId,
        description: `${extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [{ file: "010-main.md", bypassed: false }],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensionId,
        interface: "svvyx",
        module: "source/index.js",
        commandManifest: {
          version: "incur.v1",
          commands: [{ name: "test" }],
        },
        typescriptTypes: join(generatedRoot, "types.d.ts"),
        env: [],
        dependencies: [],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "source", "index.js"),
      [
        'import { Cli, z } from "incur";',
        `const cli = Cli.create("${extensionId}");`,
        'cli.command("test", {',
        "  run(c) {",
        "    return { ok: true };",
        "  },",
        "});",
        "export default cli;",
        "",
      ].join("\n"),
    );
    writeFileSync(join(generatedRoot, "types.d.ts"), "export {};\n");
    const repoNodeModules = join(process.cwd(), "node_modules");
    const packageRootNodeModules = join(extensionsRoot, "package", "node_modules");
    const rootNodeModules = join(extensionsRoot, "node_modules");
    mkdirSync(join(extensionsRoot, "package"), { recursive: true });
    if (!existsSync(packageRootNodeModules)) {
      symlinkSync(repoNodeModules, packageRootNodeModules);
    }
    if (!existsSync(rootNodeModules)) {
      symlinkSync(repoNodeModules, rootNodeModules);
    }

    const error = await catchError(
      runSvvyxRuntimeGeneratedClientCommand({
        commandId: "test",
        clientInput: { options: { verbose: true } },
        extensionId,
        extensionsRoot,
      }),
    );
    expect(error).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("Unsupported options key"),
    });
  });

  it("rejects empty strings in selection", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "test-empty-sel";
    const sourceRoot = join(extensionsRoot, "sources", "user", extensionId);
    const currentRoot = join(extensionsRoot, "builds", "extensions", extensionId, "current");
    const generatedRoot = join(extensionsRoot, "generated", "extensions", extensionId);
    mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
    mkdirSync(join(currentRoot, "source"), { recursive: true });
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "instructions", "full", "010-main.md"), "# Main\n");
    writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: extensionId,
        title: extensionId,
        description: `${extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [{ file: "010-main.md", bypassed: false }],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        extensionId,
        interface: "svvyx",
        module: "source/index.js",
        commandManifest: {
          version: "incur.v1",
          commands: [{ name: "test" }],
        },
        typescriptTypes: join(generatedRoot, "types.d.ts"),
        env: [],
        dependencies: [],
      }) + "\n",
    );
    writeFileSync(
      join(currentRoot, "source", "index.js"),
      [
        'import { Cli, z } from "incur";',
        `const cli = Cli.create("${extensionId}");`,
        'cli.command("test", {',
        "  run(c) {",
        "    return { ok: true };",
        "  },",
        "});",
        "export default cli;",
        "",
      ].join("\n"),
    );
    writeFileSync(join(generatedRoot, "types.d.ts"), "export {};\n");
    const repoNodeModules = join(process.cwd(), "node_modules");
    const packageRootNodeModules = join(extensionsRoot, "package", "node_modules");
    const rootNodeModules = join(extensionsRoot, "node_modules");
    mkdirSync(join(extensionsRoot, "package"), { recursive: true });
    if (!existsSync(packageRootNodeModules)) {
      symlinkSync(repoNodeModules, packageRootNodeModules);
    }
    if (!existsSync(rootNodeModules)) {
      symlinkSync(repoNodeModules, rootNodeModules);
    }

    const error = await catchError(
      runSvvyxRuntimeGeneratedClientCommand({
        commandId: "test",
        clientInput: { selection: ["valid", ""] },
        extensionId,
        extensionsRoot,
      }),
    );
    expect(error).toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("selection must be a non-empty string array"),
    });
  });

  it("creates a default initial extension snapshot on first snapshot read", async () => {
    const extensionsRoot = createTempDir();

    const listed = await runSvvyxExtensionsCommand({
      command: "svvyx extensions snapshots list --json",
      extensionsRoot,
    });

    expect(listed.output).toEqual({
      ok: true,
      snapshots: [
        {
          id: "snap_initial",
          name: "Initial",
          extensionCount: 0,
          hasSecretState: false,
          status: "available",
        },
      ],
    });
    expect(existsSync(join(extensionsRoot, "snapshots", "snap_initial", "metadata.json"))).toBe(
      true,
    );

    await createNotesExtension(extensionsRoot);
    const loaded = await runSvvyxExtensionsCommand({
      command: "svvyx extensions snapshots load snap_initial --json",
      extensionsRoot,
    });
    expect(loaded.output).toMatchObject({
      ok: true,
      snapshotId: "snap_initial",
      restored: {
        extensions: [],
        packageState: "not_present",
        secretState: {
          status: "not_present",
        },
      },
    });
    expect(existsSync(join(extensionsRoot, "sources", "user", "notes"))).toBe(false);
  });

  it("saves, lists, renames, and deletes local extension snapshots without exposing paths", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    await createLinearExtension(extensionsRoot);
    mkdirSync(join(extensionsRoot, "package", "node_modules", "left-pad"), { recursive: true });
    writeFileSync(join(extensionsRoot, "package", "package.json"), "{}\n");
    writeFileSync(
      join(extensionsRoot, "package", "bun.lock"),
      'path = "file:/Users/example/pkg"\n',
    );
    mkdirSync(join(extensionsRoot, "generated", "extensions", "notes"), { recursive: true });
    writeFileSync(
      join(extensionsRoot, "generated", "extensions", "notes", "types.d.ts"),
      "secret\n",
    );
    mkdirSync(join(extensionsRoot, "builds", "extensions", "notes", "current"), {
      recursive: true,
    });
    writeFileSync(join(extensionsRoot, "builds", "extensions", "notes", "current", "index.js"), "");

    const saved = await runSvvyxExtensionsCommand({
      command: 'svvyx extensions snapshots save --name "First tuned" --json',
      extensionsRoot,
    });
    expect(saved.output).toMatchObject({
      ok: true,
      snapshot: {
        name: "First tuned",
        extensionCount: 2,
        hasSecretState: false,
        status: "available",
      },
    });
    const snapshotId = (saved.output as any).snapshot.id as string;
    expect(snapshotId).toMatch(/^snap_/);
    const serialized = JSON.stringify(saved.output);
    expect(serialized).not.toContain(extensionsRoot);
    expect(serialized).not.toContain("node_modules");
    expect(serialized).not.toContain("generated");
    expect(serialized).not.toContain("builds");

    const snapshotRoot = join(extensionsRoot, "snapshots", snapshotId);
    expect(existsSync(join(snapshotRoot, "sources", "user", "notes", "manifest.json"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(snapshotRoot, "registry", "state.json"), "utf8")),
    ).toMatchObject({
      schemaVersion: 1,
      userExtensions: [
        {
          id: "linear",
          title: "Linear",
          category: "user",
          interface: "svvyx",
        },
        {
          id: "notes",
          title: "Notes",
          category: "user",
          interface: "instructions",
        },
      ],
      builtinSources: [],
    });
    expect(existsSync(join(snapshotRoot, "package", "package.json"))).toBe(true);
    expect(existsSync(join(snapshotRoot, "package", "bun.lock"))).toBe(false);
    expect(existsSync(join(snapshotRoot, "package", "node_modules"))).toBe(false);
    expect(existsSync(join(snapshotRoot, "generated"))).toBe(false);
    expect(existsSync(join(snapshotRoot, "builds"))).toBe(false);

    const listed = await runSvvyxExtensionsCommand({
      command: "svvyx extensions snapshots list --json",
      extensionsRoot,
    });
    expect(listed.output).toEqual({
      ok: true,
      snapshots: [
        {
          id: snapshotId,
          name: "First tuned",
          extensionCount: 2,
          hasSecretState: false,
          status: "available",
        },
      ],
    });

    const renamed = await runSvvyxExtensionsCommand({
      command: `svvyx extensions snapshots rename ${snapshotId} --name "Strict tuned" --json`,
      extensionsRoot,
    });
    expect(renamed.output).toMatchObject({
      ok: true,
      snapshot: {
        id: snapshotId,
        name: "Strict tuned",
      },
    });

    const deleted = await runSvvyxExtensionsCommand({
      command: `svvyx extensions snapshots delete ${snapshotId} --json`,
      extensionsRoot,
    });
    expect(deleted.output).toEqual({
      ok: true,
      snapshotId,
      deleted: true,
    });
    expect(existsSync(snapshotRoot)).toBe(false);
  });

  it("loads local extension snapshots by restoring source and package state before building", async () => {
    const extensionsRoot = createTempDir();
    const agentRoot = createTempDir();
    const cwd = createTempDir();
    const packagedFullDir = join(cwd, "generated", "instructions", "full");
    mkdirSync(packagedFullDir, { recursive: true });
    writeFileSync(
      join(packagedFullDir, "010-tinyfish-cli.generated.md"),
      "packaged tinyfish instructions\n",
    );
    const agentSettingsStore = createAgentSettingsStore({
      cwd: agentRoot,
      agentDir: join(agentRoot, ".agent"),
      workflowsSourceRoot: join(agentRoot, "workflows"),
    });
    await createNotesExtension(extensionsRoot);
    await createLinearExtension(extensionsRoot);
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add web --name 020-extra.md --json",
      cwd,
      extensionsRoot,
    });
    const profile = agentSettingsStore.getState().agents.orchestrators[0]!;
    agentSettingsStore.setAgentProfile({
      ...profile,
      extensionUsage: {
        ...profile.extensionUsage,
        linear: "unavailable",
        notes: "loaded",
        web: "unavailable",
      },
    });
    await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        "svvyx extensions defaults set-usage --actor orchestrator --extension smithers --state loaded --json",
      extensionsRoot,
    });
    await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        "svvyx extensions defaults reorder --extension notes --extension smithers --extension web --json",
      extensionsRoot,
    });
    mkdirSync(join(extensionsRoot, "package"), { recursive: true });
    writeFileSync(join(extensionsRoot, "package", "package.json"), '{"dependencies":{}}\n');
    writeFileSync(join(extensionsRoot, "package", "bun.lock"), "lockfile\n");

    const saved = await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command: 'svvyx extensions snapshots save --name "Restore point" --json',
      extensionsRoot,
    });
    const snapshotId = (saved.output as any).snapshot.id as string;

    const notesRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(notesRoot, {
      title: "Changed Notes",
    });
    writeFileSync(join(notesRoot, "instructions", "full", "010-notes.md"), "# Changed\n");
    rmSync(join(extensionsRoot, "sources", "user", "linear"), { force: true, recursive: true });
    await createNotesExtensionAtId(extensionsRoot, "scratch");
    await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        "svvyx extensions defaults set-usage --actor orchestrator --extension smithers --state unavailable --json",
      extensionsRoot,
    });
    await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        "svvyx extensions defaults reorder --extension web --extension notes --extension smithers --json",
      extensionsRoot,
    });
    const structuredSessionStore = createStructuredSessionStateStore({
      workspace: {
        id: agentRoot,
        label: "svvy",
        cwd: agentRoot,
      },
    });
    structuredSessionStore.upsertPiSession({
      sessionId: "session-snapshot-loaded",
      title: "Snapshot loaded",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      orchestratorAgentProfileId: "default-orchestrator",
      generatedAgentContextFingerprint: "session-fingerprint-before-snapshot-load",
      loadedExtensionIds: ["notes", "scratch"],
      availableExtensionIds: ["linear", "scratch"],
      messageCount: 0,
      status: "idle",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    });
    structuredSessionStore.upsertPiSession({
      sessionId: "session-snapshot-usage-only",
      title: "Snapshot usage only",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      orchestratorAgentProfileId: "default-orchestrator",
      generatedAgentContextFingerprint: "session-fingerprint-before-usage-only-snapshot",
      loadedExtensionIds: ["base-common"],
      availableExtensionIds: [],
      messageCount: 0,
      status: "idle",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    });
    const turn = structuredSessionStore.startTurn({
      sessionId: "session-snapshot-loaded",
      surfacePiSessionId: "session-snapshot-loaded",
      requestSummary: "Start snapshot handler",
    });
    const thread = structuredSessionStore.createThread({
      turnId: turn.id,
      surfacePiSessionId: "thread-snapshot-loaded",
      title: "Snapshot handler",
      objective: "Use snapshot-loaded extension state.",
      generatedAgentContextFingerprint: "thread-fingerprint-before-snapshot-load",
    });
    structuredSessionStore.updateThread({
      threadId: thread.id,
      loadedExtensionIds: ["scratch"],
      availableExtensionIds: ["notes", "scratch"],
    });
    writeFileSync(
      join(extensionsRoot, "package", "package.json"),
      '{"dependencies":{"left-pad":"1.3.0"}}\n',
    );
    writeFileSync(join(extensionsRoot, "package", "bun.lock"), "changed\n");
    mkdirSync(join(extensionsRoot, "package", "node_modules", "left-pad"), { recursive: true });
    const changedProfile = agentSettingsStore.getState().agents.orchestrators[0]!;
    agentSettingsStore.setAgentProfile({
      ...changedProfile,
      extensionUsage: {
        ...changedProfile.extensionUsage,
        linear: "available",
        notes: "unavailable",
        web: "loaded",
      },
    });

    const loaded = await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command: `svvyx extensions snapshots load ${snapshotId} --json`,
      cliProbe: (requirement) => cliStatus(requirement, { status: "available" }),
      cwd,
      extensionsRoot,
      structuredSessionStore,
    });

    expect(loaded.output).toMatchObject({
      ok: true,
      snapshotId,
      restored: {
        extensions: ["linear", "notes", "web"],
        packageState: "restored",
      },
      builds: [
        {
          extensionId: "linear",
          status: "success",
          contextReady: true,
        },
        {
          extensionId: "notes",
          status: "success",
          contextReady: true,
        },
        {
          extensionId: "web",
          status: "success",
          contextReady: true,
        },
      ],
      agentContextImpact: {
        queuedUpdates: [
          {
            surfacePiSessionId: "session-snapshot-loaded",
            kind: "agent_context_refresh",
            label: "Update agent context",
            reason: "snapshot_loaded",
          },
          {
            surfacePiSessionId: "thread-snapshot-loaded",
            kind: "agent_context_refresh",
            label: "Update agent context",
            reason: "snapshot_loaded",
          },
          {
            surfacePiSessionId: "session-snapshot-usage-only",
            kind: "agent_context_refresh",
            label: "Update agent context",
            reason: "snapshot_loaded",
          },
        ],
      },
    });
    expect((loaded.output as any).restored.usageStates).toBeGreaterThan(0);
    expect(agentSettingsStore.getState().agents.orchestrators[0]?.extensionUsage).toMatchObject({
      linear: "unavailable",
      notes: "loaded",
      web: "unavailable",
    });
    expect(agentSettingsStore.getState().extensionDefaults.usage.orchestrator).toMatchObject({
      smithers: "loaded",
    });
    expect(agentSettingsStore.getState().extensionDefaults.order.slice(0, 3)).toEqual([
      "notes",
      "smithers",
      "web",
    ]);
    expect(loaded.commandFacts).toMatchObject({
      extensionSnapshotLoaded: true,
      snapshotId,
      restoredExtensionCount: 3,
      buildCount: 3,
    });
    const serializedLoad = JSON.stringify(loaded.output);
    expect(serializedLoad).not.toContain(extensionsRoot);
    expect(serializedLoad).not.toContain("builds/extensions");
    expect((loaded.output as any).builds[0]).not.toHaveProperty("currentPath");
    const sessionSnapshot = structuredSessionStore.getSessionState("session-snapshot-loaded");
    expect(sessionSnapshot.pi.loadedExtensionIds).toEqual(["notes"]);
    expect(sessionSnapshot.pi.availableExtensionIds).toEqual(["linear"]);
    expect(sessionSnapshot.threads[0]?.loadedExtensionIds).toEqual([]);
    expect(sessionSnapshot.threads[0]?.availableExtensionIds).toEqual(["notes"]);
    const usageOnlySnapshot = structuredSessionStore.getSessionState("session-snapshot-usage-only");
    expect(usageOnlySnapshot.pi.loadedExtensionIds).toEqual(["base-common"]);
    expect(usageOnlySnapshot.pi.availableExtensionIds).toEqual([]);
    expect(
      structuredSessionStore
        .listQueuedSurfaceMessages({ surfacePiSessionId: "session-snapshot-loaded" })
        .map((message) => message.kind),
    ).toEqual(["agent_context_refresh"]);
    expect(
      structuredSessionStore
        .listQueuedSurfaceMessages({ surfacePiSessionId: "thread-snapshot-loaded" })
        .map((message) => message.kind),
    ).toEqual(["agent_context_refresh"]);
    expect(
      structuredSessionStore
        .listQueuedSurfaceMessages({ surfacePiSessionId: "session-snapshot-usage-only" })
        .map((message) => message.kind),
    ).toEqual(["agent_context_refresh"]);
    expect(JSON.parse(readFileSync(join(notesRoot, "manifest.json"), "utf8"))).toMatchObject({
      title: "Notes",
    });
    expect(readFileSync(join(notesRoot, "instructions", "full", "010-notes.md"), "utf8")).toBe(
      "# Notes\n",
    );
    expect(existsSync(join(extensionsRoot, "sources", "user", "linear", "manifest.json"))).toBe(
      true,
    );
    expect(existsSync(join(extensionsRoot, "sources", "user", "scratch"))).toBe(false);
    expect(readFileSync(join(extensionsRoot, "package", "package.json"), "utf8")).toBe(
      '{"dependencies":{}}\n',
    );
    expect(readFileSync(join(extensionsRoot, "package", "bun.lock"), "utf8")).toBe("lockfile\n");
    expect(existsSync(join(extensionsRoot, "package", "node_modules", "left-pad"))).toBe(false);
  });

  it("preserves current builds and skips loaded-session refresh when snapshot replacement builds fail", async () => {
    const extensionsRoot = createTempDir();
    const structuredSessionStore = createStructuredSessionStateStore({
      workspace: {
        id: "/repo/svvy",
        label: "svvy",
        cwd: "/repo/svvy",
      },
    });
    await createLinearExtension(extensionsRoot);
    const sourcePath = join(extensionsRoot, "sources", "user", "linear", "source", "index.ts");
    const initialBuild = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    expect(initialBuild.output).toMatchObject({
      ok: true,
      build: {
        status: "success",
      },
    });
    const currentManifestPath = join(
      extensionsRoot,
      "builds",
      "extensions",
      "linear",
      "current",
      "manifest.json",
    );
    const currentManifestBefore = readFileSync(currentManifestPath, "utf8");

    writeFileSync(sourcePath, "export default {\n");
    const saved = await runSvvyxExtensionsCommand({
      command: 'svvyx extensions snapshots save --name "Broken replacement" --json',
      extensionsRoot,
    });
    const snapshotId = (saved.output as any).snapshot.id as string;
    structuredSessionStore.upsertPiSession({
      sessionId: "session-broken-snapshot",
      title: "Broken snapshot",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      orchestratorAgentProfileId: "default-orchestrator",
      generatedAgentContextFingerprint: "session-fingerprint-before-broken-snapshot",
      loadedExtensionIds: ["linear"],
      availableExtensionIds: [],
      messageCount: 0,
      status: "idle",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    });

    const loaded = await runSvvyxExtensionsCommand({
      command: `svvyx extensions snapshots load ${snapshotId} --json`,
      extensionsRoot,
      structuredSessionStore,
    });

    expect(loaded.output).toMatchObject({
      ok: false,
      status: "blocked",
      snapshotId,
      builds: [
        {
          extensionId: "linear",
          status: "blocked",
          error: {
            code: "BUILD_FAILED",
          },
        },
      ],
    });
    expect(readFileSync(currentManifestPath, "utf8")).toBe(currentManifestBefore);
    expect(
      structuredSessionStore.listQueuedSurfaceMessages({
        surfacePiSessionId: "session-broken-snapshot",
      }),
    ).toEqual([]);
  });

  it("pauses snapshot-load auto-builds on durable dependency approval requests", async () => {
    const extensionsRoot = createTempDir();
    let requestNumber = 0;
    const dependencyApprovalStore = new ExtensionDependencyApprovalStore({
      extensionsRoot,
      createRequestId: () => `depapr_snapshot_${++requestNumber}`,
    });
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      dependencies: {
        "@notes/sdk": "1.2.3",
      },
    });
    const saved = await runSvvyxExtensionsCommand({
      command: 'svvyx extensions snapshots save --name "Dependency snapshot" --json',
      extensionsRoot,
    });
    const snapshotId = (saved.output as any).snapshot.id as string;
    updateUserManifest(sourceRoot, {
      dependencies: undefined,
    });

    const loaded = await runSvvyxExtensionsCommand({
      command: `svvyx extensions snapshots load ${snapshotId} --json`,
      dependencyApprovalStore,
      extensionsRoot,
    });

    expect(loaded.output).toMatchObject({
      ok: false,
      status: "needs_user_confirmation",
      approvalRequestId: "depapr_snapshot_1",
      snapshotId,
      blockedOperation: "snapshot_load",
      items: [
        {
          kind: "dependency",
          name: "@notes/sdk",
          version: "1.2.3",
          packageManager: "bun",
          source: "npm",
        },
      ],
      message: "Installing these dependency identities requires user approval.",
    });
    expect(loaded.commandFacts).toMatchObject({
      extensionSnapshotLoaded: false,
      snapshotId,
      dependencyApprovalRequestId: "depapr_snapshot_1",
      blockedOperation: "snapshot_load",
    });
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(
      false,
    );
    expect(dependencyApprovalStore.listRequests()).toMatchObject([
      {
        requestId: "depapr_snapshot_1",
        status: "pending",
        extensionIds: ["notes"],
        identities: [
          {
            kind: "dependency",
            name: "@notes/sdk",
            version: "1.2.3",
            packageManager: "bun",
            source: "npm",
          },
        ],
      },
    ]);
    expect(dependencyApprovalStore.listBlockedOperations("depapr_snapshot_1")).toMatchObject([
      {
        requestId: "depapr_snapshot_1",
        status: "pending",
        blockedOperation: "snapshot_load",
        extensionIds: ["notes"],
        snapshotId,
      },
    ]);

    const repeated = await runSvvyxExtensionsCommand({
      command: `svvyx extensions snapshots load ${snapshotId} --json`,
      dependencyApprovalStore,
      extensionsRoot,
    });
    expect((repeated.output as any).approvalRequestId).toBe("depapr_snapshot_1");
    expect(dependencyApprovalStore.listRequests()).toHaveLength(1);

    const installCalls: Array<Parameters<SvvyxExtensionsDependencyInstaller>[0]> = [];
    const approved = await approveExtensionDependencyRequest({
      requestId: "depapr_snapshot_1",
      dependencyApprovalStore,
      dependencyInstaller: createInstallingDependencyInstaller(installCalls),
      extensionsRoot,
    });
    expect(approved.request.status).toBe("approved");
    expect(approved.resumed).toEqual([
      expect.objectContaining({
        blockedOperation: "snapshot_load",
        status: "resumed",
      }),
    ]);
    expect(installCalls).toHaveLength(1);
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(true);
    expect(dependencyApprovalStore.listBlockedOperations("depapr_snapshot_1")).toMatchObject([
      { status: "resumed" },
    ]);
  });

  it("refuses snapshot-load dependency resume when restored state changed after the pause", async () => {
    const extensionsRoot = createTempDir();
    const dependencyApprovalStore = new ExtensionDependencyApprovalStore({
      extensionsRoot,
      createRequestId: () => "depapr_snapshot_conflict",
    });
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      dependencies: {
        "@notes/sdk": "1.2.3",
      },
    });
    const saved = await runSvvyxExtensionsCommand({
      command: 'svvyx extensions snapshots save --name "Dependency snapshot" --json',
      extensionsRoot,
    });
    const snapshotId = (saved.output as any).snapshot.id as string;
    updateUserManifest(sourceRoot, {
      dependencies: undefined,
    });
    await runSvvyxExtensionsCommand({
      command: `svvyx extensions snapshots load ${snapshotId} --json`,
      dependencyApprovalStore,
      extensionsRoot,
    });
    writeFileSync(
      join(sourceRoot, "instructions", "full", "010-notes.md"),
      "Changed after snapshot approval pause.\n",
    );

    const approved = await approveExtensionDependencyRequest({
      requestId: "depapr_snapshot_conflict",
      dependencyApprovalStore,
      dependencyInstaller: createInstallingDependencyInstaller([]),
      extensionsRoot,
    });

    expect(approved.resumed).toEqual([
      expect.objectContaining({
        blockedOperation: "snapshot_load",
        status: "obsolete",
        result: {
          ok: false,
          error: {
            code: "SNAPSHOT_RESUME_CONFLICT",
            message:
              "Snapshot load dependency approval cannot resume because restored extension state changed after the pause.",
            snapshotId,
          },
        },
      }),
    ]);
    expect(readFileSync(join(sourceRoot, "instructions", "full", "010-notes.md"), "utf8")).toBe(
      "Changed after snapshot approval pause.\n",
    );
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(
      false,
    );
  });

  it("preserves local snapshot secret state without exposing secret values", async () => {
    const extensionsRoot = createTempDir();
    const envSecretStore = createMemoryExtensionSecretStore({
      "linear:LINEAR_TOKEN": "snapshot-secret-value",
    });
    await createLinearExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
    updateUserManifest(sourceRoot, {
      env: [
        {
          name: "LINEAR_TOKEN",
          required: true,
          secret: true,
          description: "Linear token.",
        },
      ],
    });

    const saved = await runSvvyxExtensionsCommand({
      command: 'svvyx extensions snapshots save --name "Secret restore" --json',
      envSecretStore,
      extensionsRoot,
    });
    expect(saved.output).toMatchObject({
      ok: true,
      snapshot: {
        hasSecretState: true,
      },
    });
    expect(JSON.stringify(saved.output)).not.toContain("snapshot-secret-value");
    expect(JSON.stringify(saved.output)).not.toContain("LINEAR_TOKEN");
    const snapshotId = (saved.output as any).snapshot.id as string;
    const savedSnapshotFiles = readSnapshotTextFiles(join(extensionsRoot, "snapshots", snapshotId));
    expect(savedSnapshotFiles.join("\n")).not.toContain("snapshot-secret-value");
    expect(savedSnapshotFiles.join("\n")).not.toContain("__snapshot__");
    expect(savedSnapshotFiles.join("\n")).not.toContain(`${snapshotId}:extension-env`);
    envSecretStore.remove({
      extensionId: "linear",
      name: "LINEAR_TOKEN",
    });
    expect(
      envSecretStore.has({
        extensionId: "linear",
        name: "LINEAR_TOKEN",
      }),
    ).toBe(false);

    const loaded = await runSvvyxExtensionsCommand({
      command: `svvyx extensions snapshots load ${snapshotId} --json`,
      envSecretStore,
      extensionsRoot,
    });

    expect(loaded.output).toMatchObject({
      ok: true,
      restored: {
        secretState: {
          status: "restored",
        },
      },
      builds: [
        {
          extensionId: "linear",
          status: "success",
          contextReady: true,
          runtimeReady: true,
        },
      ],
    });
    expect(
      envSecretStore.get({
        extensionId: "linear",
        name: "LINEAR_TOKEN",
      }),
    ).toBe("snapshot-secret-value");
    const serializedLoad = JSON.stringify(loaded.output);
    expect(serializedLoad).not.toContain("snapshot-secret-value");
    expect(serializedLoad).not.toContain("LINEAR_TOKEN");
  });

  it("routes snapshot commands through exec_command without exposing secret storage ids", async () => {
    const agentRoot = createTempDir();
    const extensionsRoot = createTempDir();
    const envSecretStore = createMemoryExtensionSecretStore({
      "linear:LINEAR_TOKEN": "direct-snapshot-secret",
    });
    await createLinearExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
    updateUserManifest(sourceRoot, {
      env: [
        {
          name: "LINEAR_TOKEN",
          required: true,
          secret: true,
          description: "Linear token.",
        },
      ],
    });

    const execTool = createSvvyDirectToolsForTest({
      cwd: agentRoot,
      extensionEnvSecretStore: envSecretStore,
      extensionsRoot,
    }).codingTools.find((candidate) => candidate.name === "exec_command");
    if (!execTool) throw new Error("exec_command tool missing.");

    const saveResult = await execTool.execute(
      "tool-extension-snapshot-secret-save",
      { cmd: 'svvyx extensions snapshots save --name "Secret direct" --json' },
      new AbortController().signal,
      () => {},
    );
    const saveText = saveResult.content.find(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )?.text;
    expect(saveText).toBeTruthy();
    const saved = JSON.parse(saveText!);
    expect(saved).toMatchObject({
      ok: true,
      snapshot: {
        hasSecretState: false,
      },
    });
    const snapshotId = saved.snapshot.id as string;
    const serializedSave = JSON.stringify(saveResult);
    expect(serializedSave).not.toContain("direct-snapshot-secret");
    expect(serializedSave).not.toContain("__snapshot__");
    expect(serializedSave).not.toContain(`${snapshotId}:extension-env`);
    const savedSnapshotFiles = readSnapshotTextFiles(join(extensionsRoot, "snapshots", snapshotId));
    expect(savedSnapshotFiles.join("\n")).not.toContain("direct-snapshot-secret");
    expect(savedSnapshotFiles.join("\n")).not.toContain("__snapshot__");
    expect(savedSnapshotFiles.join("\n")).not.toContain(`${snapshotId}:extension-env`);
    expect(
      envSecretStore.has({
        extensionId: "__snapshot__",
        name: `${snapshotId}:extension-env`,
      }),
    ).toBe(false);

    const deleteResult = await execTool.execute(
      "tool-extension-snapshot-secret-delete",
      { cmd: `svvyx extensions snapshots delete ${snapshotId} --json` },
      new AbortController().signal,
      () => {},
    );
    const deleteText = deleteResult.content.find(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )?.text;
    expect(deleteText).toBeTruthy();
    expect(JSON.parse(deleteText!)).toMatchObject({
      ok: true,
      deleted: true,
      snapshotId,
    });
    expect(
      envSecretStore.has({
        extensionId: "__snapshot__",
        name: `${snapshotId}:extension-env`,
      }),
    ).toBe(false);
    const serializedDelete = JSON.stringify(deleteResult);
    expect(serializedDelete).not.toContain("direct-snapshot-secret");
    expect(serializedDelete).not.toContain("__snapshot__");
    expect(serializedDelete).not.toContain(`${snapshotId}:extension-env`);
  });

  it("orders user instructions by filesystem basename instead of manifest order", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    const fullDir = join(sourceRoot, "instructions", "full");
    writeFileSync(join(fullDir, "030-extra.md"), "# Extra\n");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          id: "notes",
          title: "Notes",
          description: "Project notes.",
          interface: "instructions",
          typescriptApiEnabled: false,
          instructionFiles: [
            {
              file: "030-extra.md",
              bypassed: true,
            },
            {
              file: "010-notes.md",
              bypassed: false,
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );

    const inspect = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect notes --json",
      extensionsRoot,
    });
    expect((inspect.output as any).extension.paths.instructionsFull).toEqual([
      {
        name: "010-notes.md",
        path: join(fullDir, "010-notes.md"),
        bypassed: false,
      },
      {
        name: "030-extra.md",
        path: join(fullDir, "030-extra.md"),
        bypassed: true,
      },
    ]);
  });

  it("reorders user instructions with deterministic numeric prefixes and preserved content", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    const fullDir = join(sourceRoot, "instructions", "full");
    writeFileSync(join(fullDir, "020-client.md"), "client body\n");
    writeFileSync(join(fullDir, "030-domain-guide.md"), "domain body\n");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          id: "notes",
          title: "Notes",
          description: "Project notes.",
          interface: "instructions",
          typescriptApiEnabled: false,
          instructionFiles: [
            {
              file: "030-domain-guide.md",
              bypassed: true,
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );

    const reorder = await runSvvyxExtensionsCommand({
      command:
        "svvyx extensions instructions reorder notes --file 010-notes.md --file 030-domain-guide.md --file 020-client.md --json",
      extensionsRoot,
    });
    expect(reorder.output).toMatchObject({
      ok: true,
      extensionId: "notes",
      renamed: [
        {
          from: "030-domain-guide.md",
          to: "020-domain-guide.md",
        },
        {
          from: "020-client.md",
          to: "030-client.md",
        },
      ],
      instructionsFull: [
        {
          name: "010-notes.md",
          bypassed: false,
        },
        {
          name: "020-domain-guide.md",
          bypassed: true,
        },
        {
          name: "030-client.md",
          bypassed: false,
        },
      ],
      buildRequired: true,
    });
    expect(readFileSync(join(fullDir, "020-domain-guide.md"), "utf8")).toBe("domain body\n");
    expect(readFileSync(join(fullDir, "030-client.md"), "utf8")).toBe("client body\n");
    expect(
      JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8")).instructionFiles,
    ).toEqual([
      {
        file: "020-domain-guide.md",
        bypassed: true,
      },
    ]);
  });

  it("keeps current user build active while lifecycle edits require a rebuild", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
    });

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-more.md --json",
      extensionsRoot,
    });
    const inspectDirty = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect notes --json",
      extensionsRoot,
    });
    expect(inspectDirty.output).toMatchObject({
      ok: true,
      extension: {
        id: "notes",
        state: {
          draftChanged: true,
          buildRequired: true,
          currentBuild: {
            status: "ready",
          },
          lastBuild: {
            status: "success",
          },
          ready: false,
          issues: [
            {
              code: "BUILD_REQUIRED",
              message: "Notes has source changes that have not been built.",
            },
          ],
        },
      },
    });

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
    });
    const inspectReady = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect notes --json",
      extensionsRoot,
    });
    expect(inspectReady.output).toMatchObject({
      extension: {
        state: {
          draftChanged: false,
          buildRequired: false,
          currentBuild: {
            status: "ready",
          },
          ready: true,
          issues: [],
        },
      },
    });
  });

  it("reports user env readiness without exposing values and keeps missing env runtime-only", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      env: [
        {
          name: "NOTES_API_KEY",
          required: true,
          secret: true,
          description: "Notes API key.",
        },
        {
          name: "NOTES_API_BASE_URL",
          required: false,
          secret: false,
          description: "Notes API base URL.",
          default: "https://api.example.test",
        },
        {
          name: "NOTES_LABEL",
          required: false,
          secret: false,
          description: "Optional label.",
        },
      ],
    });

    const inspect = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect notes --json",
      extensionsRoot,
    });
    expect((inspect.output as any).extension.requirements.env).toEqual([
      {
        name: "NOTES_API_KEY",
        required: true,
        secret: true,
        description: "Notes API key.",
        status: "missing",
      },
      {
        name: "NOTES_API_BASE_URL",
        required: false,
        secret: false,
        description: "Notes API base URL.",
        status: "defaulted",
      },
      {
        name: "NOTES_LABEL",
        required: false,
        secret: false,
        description: "Optional label.",
        status: "optional_missing",
      },
    ]);
    const inspectJson = JSON.stringify(inspect.output);
    expect(inspectJson).not.toContain("https://api.example.test");
    expect(inspectJson).not.toContain("secretValue");
    expect(inspectJson).not.toContain("keychain");
    expect(inspectJson).not.toContain("encrypted");

    const build = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
    });
    expect(build.output).toMatchObject({
      ok: true,
      extensionId: "notes",
      build: {
        status: "success",
        contextReady: true,
        runtimeReady: false,
        currentPath: join(extensionsRoot, "builds", "extensions", "notes", "current"),
      },
      contextReady: true,
      runtimeReady: false,
      issues: [
        {
          code: "EXTENSION_ENV_MISSING",
          message: "Notes requires NOTES_API_KEY. Configure it in the Extensions pane.",
        },
      ],
    });
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(true);
    const structuredSessionStore = createStructuredSessionStateStore({
      workspace: {
        id: "/repo/svvy",
        label: "svvy",
        cwd: "/repo/svvy",
      },
    });
    structuredSessionStore.upsertPiSession({
      sessionId: "session-missing-env-build",
      title: "Missing env build",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      orchestratorAgentProfileId: "default-orchestrator",
      messageCount: 0,
      status: "idle",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    });
    const structuredBuild = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
      structuredSessionStore,
    });
    expect(structuredBuild.output).toMatchObject({
      contextReady: true,
      runtimeReady: false,
      issues: [
        {
          code: "EXTENSION_ENV_MISSING",
        },
      ],
    });
    expect(
      structuredSessionStore.listQueuedSurfaceMessages({
        surfacePiSessionId: "session-missing-env-build",
      }),
    ).toEqual([]);
    structuredSessionStore.close();
    const inspectAfterBuild = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect notes --json",
      extensionsRoot,
    });
    expect(inspectAfterBuild.output).toMatchObject({
      extension: {
        state: {
          draftChanged: false,
          buildRequired: false,
          currentBuild: {
            status: "ready",
          },
          ready: false,
          issues: [
            {
              code: "EXTENSION_ENV_MISSING",
            },
          ],
        },
      },
    });
  });

  it("reports app-managed non-secret env overrides as configured without exposing values", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      env: [
        {
          name: "NOTES_API_BASE_URL",
          required: true,
          secret: false,
          description: "Notes API base URL.",
        },
        {
          name: "NOTES_LABEL",
          required: false,
          secret: false,
          description: "Default notes label.",
          default: "triage",
        },
      ],
    });
    const agentSettingsStore = createAgentSettingsStore({
      cwd: extensionsRoot,
      agentDir: join(extensionsRoot, "settings"),
      workflowsSourceRoot: join(extensionsRoot, "workflows"),
    });
    agentSettingsStore.setExtensionEnv({
      nonSecretOverrides: {
        notes: {
          NOTES_API_BASE_URL: "https://configured.example.test",
          NOTES_LABEL: "configured-label",
        },
      },
    });

    const inspect = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect notes --json",
      extensionsRoot,
      agentSettingsStore,
    });
    expect((inspect.output as any).extension.requirements.env).toEqual([
      {
        name: "NOTES_API_BASE_URL",
        required: true,
        secret: false,
        description: "Notes API base URL.",
        status: "configured",
      },
      {
        name: "NOTES_LABEL",
        required: false,
        secret: false,
        description: "Default notes label.",
        status: "configured",
      },
    ]);
    expect(JSON.stringify(inspect.output)).not.toContain("https://configured.example.test");
    expect(JSON.stringify(inspect.output)).not.toContain("configured-label");

    const build = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
      agentSettingsStore,
    });
    expect(build.output).toMatchObject({
      ok: true,
      extensionId: "notes",
      contextReady: true,
      runtimeReady: true,
      issues: [],
      requirements: {
        env: [
          {
            name: "NOTES_API_BASE_URL",
            status: "configured",
          },
          {
            name: "NOTES_LABEL",
            status: "configured",
          },
        ],
      },
    });
    expect(JSON.stringify(build.output)).not.toContain("https://configured.example.test");
    expect(JSON.stringify(build.output)).not.toContain("configured-label");
  });

  it("reports app-managed secret env status and injects secrets only into trusted svvyx dispatch", async () => {
    const agentRoot = createTempDir();
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
    updateUserManifest(sourceRoot, {
      env: [
        {
          name: "LINEAR_TOKEN",
          required: true,
          secret: true,
          description: "Linear token.",
        },
      ],
    });
    writeFileSync(
      join(sourceRoot, "source", "index.ts"),
      [
        'import { Cli, z } from "incur";',
        "",
        "const cli = Cli.create('linear');",
        "cli.command('leak', {",
        "  env: z.object({ LINEAR_TOKEN: z.string() }),",
        "  run(c) {",
        "    return { token: c.env.LINEAR_TOKEN, tokenLength: c.env.LINEAR_TOKEN.length };",
        "  },",
        "});",
        "",
        "export default cli;",
        "",
      ].join("\n"),
    );
    const plaintextSettingsStore = createAgentSettingsStore({
      cwd: agentRoot,
      agentDir: join(agentRoot, ".agent"),
      workflowsSourceRoot: join(agentRoot, "workflows"),
    });
    plaintextSettingsStore.setExtensionEnv({
      nonSecretOverrides: {
        linear: {
          LINEAR_TOKEN: "plaintext-secret-value",
        },
      },
    });
    const plaintextInspect = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect linear --json",
      extensionsRoot,
      agentSettingsStore: plaintextSettingsStore,
    });
    expect((plaintextInspect.output as any).extension.requirements.env).toEqual([
      {
        name: "LINEAR_TOKEN",
        required: true,
        secret: true,
        description: "Linear token.",
        status: "missing",
      },
    ]);
    expect(JSON.stringify(plaintextInspect.output)).not.toContain("plaintext-secret-value");

    const envSecretStore = createMemoryExtensionSecretStore({
      "linear:LINEAR_TOKEN": "keychain-token-value",
    });
    const inspect = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect linear --json",
      extensionsRoot,
      envSecretStore,
    });
    expect((inspect.output as any).extension.requirements.env).toEqual([
      {
        name: "LINEAR_TOKEN",
        required: true,
        secret: true,
        description: "Linear token.",
        status: "configured",
      },
    ]);
    expect(JSON.stringify(inspect.output)).not.toContain("keychain-token-value");

    const build = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
      envSecretStore,
    });
    expect(build.output).toMatchObject({
      ok: true,
      runtimeReady: true,
      issues: [],
      requirements: {
        env: [
          {
            name: "LINEAR_TOKEN",
            secret: true,
            status: "configured",
          },
        ],
      },
    });
    expect(JSON.stringify(build.output)).not.toContain("keychain-token-value");

    const inventory = await readBuiltinExtensionsInventory({
      extensionsRoot,
      envSecretStore,
      includeUserExtensions: true,
    });
    expect(inventory.extensions.find((extension) => extension.id === "linear")).toMatchObject({
      id: "linear",
      category: "user",
      requirements: {
        env: [
          {
            name: "LINEAR_TOKEN",
            secret: true,
            status: "configured",
          },
        ],
      },
      state: {
        ready: true,
        issues: [],
      },
    });
    expect(JSON.stringify(inventory)).not.toContain("keychain-token-value");

    const execTool = createSvvyDirectToolsForTest({
      cwd: agentRoot,
      extensionEnvSecretStore: envSecretStore,
      extensionsRoot,
    }).codingTools.find((candidate) => candidate.name === "exec_command");
    if (!execTool) throw new Error("exec_command tool missing.");
    const result = await execTool.execute(
      "tool-extension-runtime-secret-env",
      { cmd: "svvyx linear leak --json" },
      new AbortController().signal,
      () => {},
    );
    const output = parseExecStdoutJson(result);
    expect(JSON.stringify(output)).not.toContain("keychain-token-value");
    expect(JSON.stringify(result)).not.toContain("keychain-token-value");
    expect(result.details).not.toHaveProperty("commandFacts");
  });

  it("allows app secret management only for declared secret env requirements", async () => {
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
    updateUserManifest(sourceRoot, {
      env: [
        {
          name: "LINEAR_TOKEN",
          required: true,
          secret: true,
          description: "Linear token.",
        },
        {
          name: "LINEAR_TEAM",
          required: false,
          secret: false,
          description: "Linear team.",
        },
      ],
    });

    expect(() =>
      assertExtensionEnvSecretTarget({
        extensionId: "linear",
        extensionsRoot,
        name: "LINEAR_TOKEN",
      }),
    ).not.toThrow();
    expect(
      formatSvvyxExtensionsError(
        await catchError(
          Promise.resolve().then(() =>
            assertExtensionEnvSecretTarget({
              extensionId: "linear",
              extensionsRoot,
              name: "LINEAR_TEAM",
            }),
          ),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "extension_env_not_secret",
        message: "linear LINEAR_TEAM is not managed as a secret.",
      },
    });
    expect(
      formatSvvyxExtensionsError(
        await catchError(
          Promise.resolve().then(() =>
            assertExtensionEnvSecretTarget({
              extensionId: "linear",
              extensionsRoot,
              name: "LINEAR_UNKNOWN",
            }),
          ),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "extension_env_not_declared",
        message: "linear does not declare extension env LINEAR_UNKNOWN.",
      },
    });
    expect(
      formatSvvyxExtensionsError(
        await catchError(
          Promise.resolve().then(() =>
            assertExtensionEnvSecretTarget({
              extensionId: "missing",
              extensionsRoot,
              name: "LINEAR_TOKEN",
            }),
          ),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "extension_not_found",
        message: "Extension not found: missing",
      },
    });

    expect(() =>
      assertExtensionEnvOverrideTarget({
        extensionId: "linear",
        extensionsRoot,
        name: "LINEAR_TEAM",
      }),
    ).not.toThrow();
    expect(
      formatSvvyxExtensionsError(
        await catchError(
          Promise.resolve().then(() =>
            assertExtensionEnvOverrideTarget({
              extensionId: "linear",
              extensionsRoot,
              name: "LINEAR_TOKEN",
            }),
          ),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "extension_env_is_secret",
        message: "linear LINEAR_TOKEN is managed as a secret.",
      },
    });
    expect(
      formatSvvyxExtensionsError(
        await catchError(
          Promise.resolve().then(() =>
            assertExtensionEnvOverrideTarget({
              extensionId: "linear",
              extensionsRoot,
              name: "LINEAR_UNKNOWN",
            }),
          ),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "extension_env_not_declared",
        message: "linear does not declare extension env LINEAR_UNKNOWN.",
      },
    });
    expect(
      formatSvvyxExtensionsError(
        await catchError(
          Promise.resolve().then(() =>
            assertExtensionEnvOverrideTarget({
              extensionId: "missing",
              extensionsRoot,
              name: "LINEAR_TEAM",
            }),
          ),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "extension_not_found",
        message: "Extension not found: missing",
      },
    });

    expect(
      formatSvvyxExtensionsError(
        await catchError(Promise.resolve().then(() => assertExtensionEnvWriteValue("   "))),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "extension_env_value_required",
        message: "Extension env value is required.",
      },
    });
  });

  it("blocks required user CLI requirements even when no generated instructions reference them", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      cliRequirements: [
        {
          id: "notes-cli",
          binary: "notes",
          required: true,
          version: "1.2.3",
          installCommand: "npm install -g notes-cli@{{version}}",
        },
      ],
    });

    const build = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
      cliProbe: (requirement) => cliStatus(requirement, { status: "missing" }),
    });
    expect(build.output).toMatchObject({
      ok: false,
      error: {
        code: "CLI_MISSING",
        extensionId: "notes",
        cli: {
          id: "notes-cli",
          binary: "notes",
          currentVersion: "1.2.3",
          installCommand: "npm install -g notes-cli@1.2.3",
        },
      },
    });
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(
      false,
    );
  });

  it("accepts optional CLI version commands and reports unknown versions when absent", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      cliRequirements: [
        {
          id: "notes-cli",
          binary: "notes",
          required: false,
        },
      ],
    });

    const inspect = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect notes --json",
      extensionsRoot,
      cliProbe: (requirement) =>
        cliStatus(requirement, { path: "/usr/local/bin/notes", status: "unknown" }),
    });
    expect((inspect.output as any).extension.requirements.cliRequirements).toEqual([
      cliStatus(
        {
          id: "notes-cli",
          binary: "notes",
          required: false,
        },
        { path: "/usr/local/bin/notes", status: "unknown" },
      ),
    ]);
  });

  it("projects builtin CLI readiness into the Extensions inventory read model", async () => {
    const inventory = await readBuiltinExtensionsInventory({
      cliProbe: (requirement) => {
        if (requirement.id === "tinyfish") {
          return cliStatus(requirement, { status: "missing" });
        }
        if (requirement.id === "smithers-orchestrator") {
          return cliStatus(requirement, { path: "/usr/local/bin/smithers", status: "unknown" });
        }
        if (requirement.id === "cx") {
          return cliStatus(requirement, {
            currentVersion: "0.6.0",
            detectedVersion: "0.6.0",
            latestVersion: requirement.version ?? null,
            path: "/usr/local/bin/cx",
            status: "available",
            updateAvailable: true,
            updateCommand: "cargo install cx-cli --version 0.7.1",
          });
        }
        return cliStatus(requirement, {
          path: `/usr/local/bin/${requirement.binary}`,
          status: "available",
        });
      },
    });

    const cx = inventory.extensions.find((extension) => extension.id === "cx");
    const web = inventory.extensions.find((extension) => extension.id === "web");
    const smithers = inventory.extensions.find((extension) => extension.id === "smithers");
    expect(cx?.requirements.cliRequirements).toEqual([
      expect.objectContaining({
        binary: "cx",
        currentVersion: "0.6.0",
        latestVersion: "0.7.1",
        status: "available",
        updateAvailable: true,
        updateCommand: "cargo install cx-cli --version 0.7.1",
      }),
    ]);
    expect(web?.state).toMatchObject({
      ready: false,
      issues: [{ code: "CLI_MISSING" }],
    });
    expect(web?.requirements.cliRequirements[0]).toMatchObject({
      binary: "tinyfish",
      currentVersion: "0.1.6",
      installCommand: "npm install -g @tiny-fish/cli@0.1.6",
      status: "missing",
    });
    expect(smithers?.state).toMatchObject({
      ready: false,
      issues: [{ code: "CLI_STATUS_UNKNOWN" }],
    });
    expect(smithers?.requirements.cliRequirements[0]).toMatchObject({
      binary: "smithers",
      currentVersion: null,
      path: "/usr/local/bin/smithers",
      status: "unknown",
    });
  });

  it("pauses builds with unapproved exact dependency declarations before promotion", async () => {
    const extensionsRoot = createTempDir();
    let requestNumber = 0;
    const dependencyApprovalStore = new ExtensionDependencyApprovalStore({
      extensionsRoot,
      createRequestId: () => `depapr_notes_${++requestNumber}`,
    });
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      dependencies: {
        "@notes/sdk": "1.2.3",
      },
      trustedDependencies: {
        esbuild: "0.25.4",
      },
    });

    const build = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      dependencyApprovalStore,
      extensionsRoot,
    });
    expect(build.output).toMatchObject({
      ok: false,
      status: "needs_user_confirmation",
      approvalRequestId: "depapr_notes_1",
      extensionId: "notes",
      blockedOperation: "build",
      packageProject: join(extensionsRoot, "package"),
      items: [
        {
          kind: "dependency",
          name: "@notes/sdk",
          version: "1.2.3",
          packageManager: "bun",
          source: "npm",
        },
        {
          kind: "trusted_dependency",
          name: "esbuild",
          version: "0.25.4",
          packageManager: "bun",
          source: "npm",
        },
      ],
      message: "Installing these dependency identities requires user approval.",
      requirements: {
        dependencies: [
          {
            kind: "dependency",
            name: "@notes/sdk",
            version: "1.2.3",
            approval: "needs_user_confirmation",
            approvalRequestId: "depapr_notes_1",
            integrity: null,
            install: "missing",
            resolution: null,
          },
        ],
        trustedDependencies: [
          {
            kind: "trusted_dependency",
            name: "esbuild",
            version: "0.25.4",
            approval: "needs_user_confirmation",
            approvalRequestId: "depapr_notes_1",
            integrity: null,
            install: "missing",
            resolution: null,
          },
        ],
      },
    });
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(
      false,
    );
    expect(dependencyApprovalStore.listRequests()).toMatchObject([
      {
        requestId: "depapr_notes_1",
        status: "pending",
        extensionIds: ["notes"],
        identities: [
          {
            kind: "dependency",
            name: "@notes/sdk",
            version: "1.2.3",
            packageManager: "bun",
            source: "npm",
            integrity: null,
            resolution: null,
          },
          {
            kind: "trusted_dependency",
            name: "esbuild",
            version: "0.25.4",
            packageManager: "bun",
            source: "npm",
            integrity: null,
            resolution: null,
          },
        ],
      },
    ]);

    const repeatedBuild = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      dependencyApprovalStore,
      extensionsRoot,
    });
    expect(repeatedBuild.output).toMatchObject({
      ok: false,
      status: "needs_user_confirmation",
      approvalRequestId: "depapr_notes_1",
    });
    const inspect = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect notes --json",
      dependencyApprovalStore,
      extensionsRoot,
    });
    expect((inspect.output as any).extension.requirements.trustedDependencies[0]).toMatchObject({
      approval: "needs_user_confirmation",
      approvalRequestId: "depapr_notes_1",
    });

    updateUserManifest(sourceRoot, {
      dependencies: {
        "@notes/sdk": "1.2.3",
      },
      trustedDependencies: {
        esbuild: "0.25.5",
      },
    });
    const changedPendingSet = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      dependencyApprovalStore,
      extensionsRoot,
    });
    expect(changedPendingSet.output).toMatchObject({
      ok: false,
      status: "needs_user_confirmation",
      approvalRequestId: "depapr_notes_2",
      items: [
        {
          kind: "dependency",
          name: "@notes/sdk",
          version: "1.2.3",
        },
        {
          kind: "trusted_dependency",
          name: "esbuild",
          version: "0.25.5",
        },
      ],
    });
    expect(dependencyApprovalStore.listRequests()).toMatchObject([
      {
        requestId: "depapr_notes_1",
        status: "obsolete",
        extensionIds: [],
      },
      {
        requestId: "depapr_notes_2",
        status: "pending",
        extensionIds: ["notes"],
      },
    ]);
    expect(dependencyApprovalStore.listBlockedOperations()).toMatchObject([
      {
        requestId: "depapr_notes_1",
        status: "obsolete",
        blockedOperation: "build",
      },
      {
        requestId: "depapr_notes_2",
        status: "pending",
        blockedOperation: "build",
      },
    ]);
    expect(requestNumber).toBe(2);
  });

  it("records exact dependency and trusted dependency approvals independently", async () => {
    const extensionsRoot = createTempDir();
    let requestNumber = 0;
    const dependencyApprovalStore = new ExtensionDependencyApprovalStore({
      extensionsRoot,
      createRequestId: () => `depapr_notes_${++requestNumber}`,
    });
    const installCalls: Array<Parameters<SvvyxExtensionsDependencyInstaller>[0]> = [];
    const dependencyInstaller = createInstallingDependencyInstaller(installCalls);
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      dependencies: {
        esbuild: "0.25.4",
      },
      trustedDependencies: {
        esbuild: "0.25.4",
      },
    });

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      dependencyApprovalStore,
      extensionsRoot,
    });
    dependencyApprovalStore.approveRequest("depapr_notes_1");

    const build = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      dependencyApprovalStore,
      dependencyInstaller,
      extensionsRoot,
    });
    expect(build.output).toMatchObject({
      ok: true,
      runtimeReady: true,
      requirements: {
        dependencies: [
          {
            kind: "dependency",
            name: "esbuild",
            version: "0.25.4",
            approval: "approved",
            install: "installed",
          },
        ],
        trustedDependencies: [
          {
            kind: "trusted_dependency",
            name: "esbuild",
            version: "0.25.4",
            approval: "approved",
            install: "installed",
          },
        ],
      },
      issues: [],
    });
    expect(installCalls).toMatchObject([
      {
        dependencies: [{ kind: "dependency", name: "esbuild", version: "0.25.4" }],
        trustedDependencies: [{ kind: "trusted_dependency", name: "esbuild", version: "0.25.4" }],
        packageProject: join(extensionsRoot, "package"),
      },
    ]);
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(true);

    updateUserManifest(sourceRoot, {
      dependencies: {
        esbuild: "0.25.4",
      },
      trustedDependencies: {
        esbuild: "0.25.5",
      },
    });
    const changedTrust = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      dependencyApprovalStore,
      extensionsRoot,
    });
    expect(changedTrust.output).toMatchObject({
      ok: false,
      status: "needs_user_confirmation",
      approvalRequestId: "depapr_notes_2",
      blockedOperation: "build",
      requirements: {
        dependencies: [
          {
            kind: "dependency",
            name: "esbuild",
            version: "0.25.4",
            approval: "approved",
          },
        ],
        trustedDependencies: [
          {
            kind: "trusted_dependency",
            name: "esbuild",
            version: "0.25.5",
            approval: "needs_user_confirmation",
            approvalRequestId: "depapr_notes_2",
          },
        ],
      },
    });

    updateUserManifest(sourceRoot, {
      dependencies: {
        esbuild: "0.25.4",
      },
      trustedDependencies: {},
    });
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      dependencyApprovalStore,
      dependencyInstaller,
      extensionsRoot,
    });
    expect(dependencyApprovalStore.listRequests()).toMatchObject([
      {
        requestId: "depapr_notes_1",
        status: "approved",
      },
      {
        requestId: "depapr_notes_2",
        status: "obsolete",
        extensionIds: [],
      },
    ]);
  });

  it("resumes explicit dependency-approved builds through the installer before promotion", async () => {
    const extensionsRoot = createTempDir();
    const dependencyApprovalStore = new ExtensionDependencyApprovalStore({
      extensionsRoot,
      createRequestId: () => "depapr_notes_resume",
    });
    const installCalls: Array<Parameters<SvvyxExtensionsDependencyInstaller>[0]> = [];
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      dependencies: {
        "@notes/sdk": "1.2.3",
      },
    });

    const blocked = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      dependencyApprovalStore,
      extensionsRoot,
    });
    expect(blocked.output).toMatchObject({
      ok: false,
      approvalRequestId: "depapr_notes_resume",
      blockedOperation: "build",
    });

    const approved = await approveExtensionDependencyRequest({
      requestId: "depapr_notes_resume",
      dependencyApprovalStore,
      dependencyInstaller: createInstallingDependencyInstaller(installCalls),
      extensionsRoot,
    });

    expect(approved.request.status).toBe("approved");
    expect(approved.resumed).toEqual([
      expect.objectContaining({
        blockedOperation: "build",
        status: "resumed",
        result: expect.objectContaining({
          ok: true,
          builds: [
            expect.objectContaining({
              ok: true,
              runtimeReady: true,
            }),
          ],
        }),
      }),
    ]);
    expect(installCalls).toMatchObject([
      {
        dependencies: [{ kind: "dependency", name: "@notes/sdk", version: "1.2.3" }],
        trustedDependencies: [],
      },
    ]);
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(true);
    expect(dependencyApprovalStore.listBlockedOperations("depapr_notes_resume")).toMatchObject([
      { blockedOperation: "build", status: "resumed" },
    ]);
  });

  it("writes only current approved identities into the package project before default install", async () => {
    const extensionsRoot = createTempDir();
    const fakeBin = join(extensionsRoot, "fake-bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeBun = join(fakeBin, "bun");
    writeFileSync(
      fakeBun,
      `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--cwd" ]; then
    cwd="$2"
    shift 2
    continue
  fi
  shift
done
printf '%s\\n' '["install","--cwd","'"$cwd"'","--no-progress"]' > "$cwd/install-argv.json"
mkdir -p "$cwd/node_modules/@notes/sdk" "$cwd/node_modules/esbuild"
printf '%s\\n' '{"name":"@notes/sdk","version":"1.2.3"}' > "$cwd/node_modules/@notes/sdk/package.json"
printf '%s\\n' '{"name":"esbuild","version":"0.25.4"}' > "$cwd/node_modules/esbuild/package.json"
`,
    );
    chmodSync(fakeBun, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath ?? ""}`;
    try {
      const dependencyApprovalStore = new ExtensionDependencyApprovalStore({
        extensionsRoot,
        createRequestId: () => "depapr_notes_default_install",
      });
      await createNotesExtension(extensionsRoot);
      const packageRoot = join(extensionsRoot, "package");
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, "package.json"),
        JSON.stringify(
          {
            name: "stale-package-state",
            dependencies: { "left-pad": "^1.3.0" },
            scripts: { postinstall: "echo stale" },
            trustedDependencies: ["left-pad"],
          },
          null,
          2,
        ) + "\n",
      );
      updateUserManifest(join(extensionsRoot, "sources", "user", "notes"), {
        dependencies: {
          "@notes/sdk": "1.2.3",
        },
        trustedDependencies: {
          esbuild: "0.25.4",
        },
      });

      await runSvvyxExtensionsCommand({
        command: "svvyx extensions build notes --json",
        dependencyApprovalStore,
        extensionsRoot,
      });
      dependencyApprovalStore.approveRequest("depapr_notes_default_install");
      const build = await runSvvyxExtensionsCommand({
        command: "svvyx extensions build notes --json",
        dependencyApprovalStore,
        extensionsRoot,
      });

      expect(build.output).toMatchObject({ ok: true, runtimeReady: true });
      const writtenPackageJson = JSON.parse(
        readFileSync(join(packageRoot, "package.json"), "utf8"),
      );
      expect(writtenPackageJson).toEqual({
        name: "svvy-extension-package",
        private: true,
        dependencies: {
          "@notes/sdk": "1.2.3",
          esbuild: "0.25.4",
        },
        trustedDependencies: ["esbuild"],
      });
      const installArgv = JSON.parse(readFileSync(join(packageRoot, "install-argv.json"), "utf8"));
      expect(installArgv).not.toContain("--ignore-scripts");
      expect(existsSync(join(packageRoot, "node_modules", "left-pad"))).toBe(false);
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("keeps approved identities for other current builds in the shared package install plan", async () => {
    const extensionsRoot = createTempDir();
    let requestNumber = 0;
    const dependencyApprovalStore = new ExtensionDependencyApprovalStore({
      extensionsRoot,
      createRequestId: () => `depapr_shared_${++requestNumber}`,
    });
    const installCalls: Array<Parameters<SvvyxExtensionsDependencyInstaller>[0]> = [];
    const dependencyInstaller = createInstallingDependencyInstaller(installCalls);
    await createNotesExtensionAtId(extensionsRoot, "notes");
    await createNotesExtensionAtId(extensionsRoot, "tasks");
    updateUserManifest(join(extensionsRoot, "sources", "user", "notes"), {
      dependencies: {
        "@notes/sdk": "1.2.3",
      },
    });
    updateUserManifest(join(extensionsRoot, "sources", "user", "tasks"), {
      dependencies: {
        "@tasks/sdk": "2.3.4",
      },
    });

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      dependencyApprovalStore,
      extensionsRoot,
    });
    dependencyApprovalStore.approveRequest("depapr_shared_1");
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      dependencyApprovalStore,
      dependencyInstaller,
      extensionsRoot,
    });
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build tasks --json",
      dependencyApprovalStore,
      extensionsRoot,
    });
    dependencyApprovalStore.approveRequest("depapr_shared_2");
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build tasks --json",
      dependencyApprovalStore,
      dependencyInstaller,
      extensionsRoot,
    });

    expect(installCalls).toHaveLength(2);
    expect(installCalls[1]?.dependencies).toMatchObject([
      { kind: "dependency", name: "@notes/sdk", version: "1.2.3" },
      { kind: "dependency", name: "@tasks/sdk", version: "2.3.4" },
    ]);
  });

  it("rejects dependency approval requests without installing or promoting builds", async () => {
    const extensionsRoot = createTempDir();
    const dependencyApprovalStore = new ExtensionDependencyApprovalStore({
      extensionsRoot,
      createRequestId: () => "depapr_notes_reject",
    });
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      dependencies: {
        "@notes/sdk": "1.2.3",
      },
    });

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      dependencyApprovalStore,
      extensionsRoot,
    });
    const rejected = rejectExtensionDependencyRequest({
      requestId: "depapr_notes_reject",
      dependencyApprovalStore,
      extensionsRoot,
    });

    expect(rejected.request.status).toBe("rejected");
    expect(rejected.rejectedOperations).toMatchObject([{ status: "rejected" }]);
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(
      false,
    );
    expect(existsSync(join(extensionsRoot, "package", "node_modules", "@notes", "sdk"))).toBe(
      false,
    );
  });

  it("preserves previous current builds when approved dependency install fails", async () => {
    const extensionsRoot = createTempDir();
    const dependencyApprovalStore = new ExtensionDependencyApprovalStore({
      extensionsRoot,
      createRequestId: () => "depapr_notes_install_fail",
    });
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
    });
    const currentManifest = join(
      extensionsRoot,
      "builds",
      "extensions",
      "notes",
      "current",
      "manifest.json",
    );
    const previousCurrent = readFileSync(currentManifest, "utf8");
    updateUserManifest(sourceRoot, {
      dependencies: {
        "@notes/sdk": "1.2.3",
      },
    });
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      dependencyApprovalStore,
      extensionsRoot,
    });
    dependencyApprovalStore.approveRequest("depapr_notes_install_fail");

    const failedInstall = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      dependencyApprovalStore,
      dependencyInstaller: async (input) => ({
        ok: false,
        command: ["fake-bun", "install", "--ignore-scripts"],
        error: {
          code: "DEPENDENCY_INSTALL_FAILED",
          message: "fake install failed",
          exitCode: 1,
          stderr: "network unavailable",
        },
        packageProject: input.packageProject,
      }),
      extensionsRoot,
    });

    expect(failedInstall.output).toMatchObject({
      ok: false,
      error: {
        code: "DEPENDENCY_INSTALL_FAILED",
        extensionId: "notes",
        exitCode: 1,
        stderr: "network unavailable",
      },
      requirements: {
        dependencies: [
          {
            approval: "approved",
            install: "missing",
          },
        ],
      },
    });
    expect(readFileSync(currentManifest, "utf8")).toBe(previousCurrent);
    expect(listBuildStagingDirs(extensionsRoot, "notes")).toEqual([]);
  });

  it("validates build inputs before promotion and preserves previous current builds", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    const currentManifest = join(
      extensionsRoot,
      "builds",
      "extensions",
      "notes",
      "current",
      "manifest.json",
    );
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
    });
    const previousCurrent = readFileSync(currentManifest, "utf8");

    updateUserManifest(sourceRoot, {
      dependencies: {
        "@notes/sdk": "^1.2.3",
      },
    });
    const failedDependency = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
    });
    expect(failedDependency.output).toEqual({
      ok: false,
      error: {
        code: "DEPENDENCY_VERSION_NOT_EXACT",
        message: "Dependency @notes/sdk must use an exact version before it can be installed.",
        extensionId: "notes",
        path: join(extensionsRoot, "package", "package.json"),
        dependency: {
          name: "@notes/sdk",
          requested: "^1.2.3",
        },
      },
    });
    expect(readFileSync(currentManifest, "utf8")).toBe(previousCurrent);
    expect(listBuildStagingDirs(extensionsRoot, "notes")).toEqual([]);

    updateUserManifest(sourceRoot, {
      dependencies: undefined,
      generatedInstructions: [
        {
          output: "instructions/full/020-generated.md",
          script: "scripts/generate.ts",
          versionCliRequirementId: "missing-cli",
        },
      ],
    });
    const failedGenerated = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
    });
    expect(failedGenerated.output).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_GENERATED_INSTRUCTION",
        extensionId: "notes",
        path: join(sourceRoot, "manifest.json"),
        versionCliRequirementId: "missing-cli",
      },
    });
    expect(readFileSync(currentManifest, "utf8")).toBe(previousCurrent);
    expect(listBuildStagingDirs(extensionsRoot, "notes")).toEqual([]);

    updateUserManifest(sourceRoot, {
      generatedInstructions: [
        {
          output: "instructions/full/010-notes.md",
          script: "scripts/generate.ts",
        },
      ],
    });
    const failedGeneratedCollision = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
    });
    expect(failedGeneratedCollision.output).toMatchObject({
      ok: false,
      error: {
        code: "GENERATED_INSTRUCTION_BUILD_FAILED",
        extensionId: "notes",
        script: join(sourceRoot, "scripts", "generate.ts"),
        output: join(sourceRoot, "instructions", "full", "010-notes.md"),
      },
    });
    expect(readFileSync(currentManifest, "utf8")).toBe(previousCurrent);
    expect(listBuildStagingDirs(extensionsRoot, "notes")).toEqual([]);

    updateUserManifest(sourceRoot, {
      cliRequirements: [
        {
          id: "notes-generator",
          binary: "notes-generator",
          required: false,
          versionCommand: "notes-generator --version",
        },
      ],
      generatedInstructions: [
        {
          output: "instructions/full/020-generated.md",
          script: "scripts/generate.ts",
          versionCliRequirementId: "notes-generator",
        },
      ],
    });
    const unsupportedGenerated = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
    });
    expect(unsupportedGenerated.output).toMatchObject({
      ok: false,
      error: {
        code: "GENERATED_INSTRUCTION_BUILD_FAILED",
        extensionId: "notes",
        script: join(sourceRoot, "scripts", "generate.ts"),
        output: join(sourceRoot, "instructions", "full", "020-generated.md"),
      },
    });
    expect(readFileSync(currentManifest, "utf8")).toBe(previousCurrent);
    expect(listBuildStagingDirs(extensionsRoot, "notes")).toEqual([]);
  });

  it("rejects malformed manifest optional fields instead of ignoring them", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");

    updateUserManifest(sourceRoot, {
      cliRequirements: [
        {
          id: "notes-generator",
          binary: "notes-generator",
          required: false,
          installCommand: "npm install -g notes-generator@{{version}}",
        },
      ],
    });
    expect(
      formatSvvyxExtensionsError(
        await catchError(
          runSvvyxExtensionsCommand({
            command: "svvyx extensions build notes --json",
            extensionsRoot,
          }),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_manifest",
        message: "CLI requirement installCommand uses {{version}} without version: notes-generator",
      },
    });

    updateUserManifest(sourceRoot, {
      cliRequirements: [
        {
          id: "notes-generator",
          binary: "notes-generator",
          required: false,
          version: "1.2.3",
          installCommand: "npm install -g notes-generator@{{version}}",
        },
      ],
      generatedInstructions: [
        {
          output: "instructions/full/020-generated.md",
          script: "scripts/generate.ts",
          versionCliRequirementId: 42,
        },
      ],
    });
    expect(
      formatSvvyxExtensionsError(
        await catchError(
          runSvvyxExtensionsCommand({
            command: "svvyx extensions build notes --json",
            extensionsRoot,
          }),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_manifest",
        message: "Invalid generatedInstructions entry.",
      },
    });

    updateUserManifest(sourceRoot, {
      generatedInstructions: [
        {
          output: "instructions/full/020-generated.md",
          script: "scripts/generate.ts",
        },
        {
          output: "instructions/full/020-generated.md",
          script: "scripts/generate-other.ts",
        },
      ],
    });
    expect(
      formatSvvyxExtensionsError(
        await catchError(
          runSvvyxExtensionsCommand({
            command: "svvyx extensions build notes --json",
            extensionsRoot,
          }),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_manifest",
        message: "Duplicate generated instruction output: instructions/full/020-generated.md",
      },
    });

    updateUserManifest(sourceRoot, {
      generatedInstructions: [
        {
          output: "instructions/full/020-generated.md",
          script: "scripts/generate.ts",
        },
        {
          output: "instructions/full/030-generated.md",
          script: "scripts/generate.ts",
        },
      ],
    });
    const sharedScript = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
    });
    expect(sharedScript.output).toMatchObject({
      ok: false,
      error: {
        code: "GENERATED_INSTRUCTION_BUILD_FAILED",
        extensionId: "notes",
        script: join(sourceRoot, "scripts", "generate.ts"),
        output: join(sourceRoot, "instructions", "full", "020-generated.md"),
      },
    });
  });

  it("accepts default-exported svvyx sources with non-top-level serve references only", async () => {
    const extensionsRoot = createTempDir();
    await createLinearExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
    const sourcePath = join(sourceRoot, "source", "index.ts");
    writeFileSync(
      sourcePath,
      [
        'import { Cli } from "incur";',
        "",
        "const cli = Cli.create('linear');",
        "const docs = 'do not call cli.serve() from this source';",
        "function nested() {",
        "  return helper.serve();",
        "}",
        "",
        "export default cli;",
        "",
      ].join("\n"),
    );
    const accepted = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    expect(accepted.output).toMatchObject({
      ok: true,
      extensionId: "linear",
      contextReady: true,
    });

    writeFileSync(
      sourcePath,
      [
        'import { Cli } from "incur";',
        "",
        "const cli = Cli.create('linear');",
        "cli.serve();",
        "export default cli;",
        "",
      ].join("\n"),
    );
    const rejected = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    expect(rejected.output).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_EXTENSION_SOURCE",
        extensionId: "linear",
        path: sourcePath,
      },
    });

    writeFileSync(
      sourcePath,
      [
        'import { Cli } from "incur";',
        "",
        "const cli = Cli.create('linear');",
        "void cli.serve();",
        "export default cli;",
        "",
      ].join("\n"),
    );
    const rejectedPrefixed = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build linear --json",
      extensionsRoot,
    });
    expect(rejectedPrefixed.output).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_EXTENSION_SOURCE",
        extensionId: "linear",
        path: sourcePath,
      },
    });
  });

  it("rejects invalid env defaults and instruction config during build without promotion", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      env: [
        {
          name: "NOTES_SECRET",
          required: false,
          secret: true,
          description: "Secret value.",
          default: "should-not-appear",
        },
      ],
    });

    const failedEnv = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
    });
    expect(failedEnv.output).toEqual({
      ok: false,
      error: {
        code: "INVALID_EXTENSION_ENV",
        message: "Secret env NOTES_SECRET cannot declare a default value.",
        extensionId: "notes",
        path: join(sourceRoot, "manifest.json"),
        env: {
          name: "NOTES_SECRET",
        },
      },
    });
    expect(JSON.stringify(failedEnv.output)).not.toContain("should-not-appear");
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(
      false,
    );

    updateUserManifest(sourceRoot, {
      env: undefined,
      instructionFiles: [
        {
          file: "999-missing.md",
          bypassed: true,
        },
      ],
    });
    const failedInstructionConfig = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build notes --json",
      extensionsRoot,
    });
    expect(failedInstructionConfig.output).toEqual({
      ok: false,
      error: {
        code: "INSTRUCTION_FILE_NOT_FOUND",
        message: "Instruction config references unknown file: 999-missing.md",
        extensionId: "notes",
        path: join(sourceRoot, "manifest.json"),
        instructionFile: "999-missing.md",
      },
    });
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(
      false,
    );
  });

  it("rejects invalid instruction lifecycle names, order, config, and non-editable targets", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-domain.md --json",
      extensionsRoot,
    });

    await expect(
      runSvvyxExtensionsCommand({
        command: "svvyx extensions instructions add notes --name ../bad.md --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Invalid instruction Markdown basename: ../bad.md");
    await expect(
      runSvvyxExtensionsCommand({
        command: "svvyx extensions instructions add notes --name 020-domain.md --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Instruction file already exists: 020-domain.md");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          "svvyx extensions instructions rename notes --from 020-domain.md --to 010-notes.md --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Instruction file already exists: 010-notes.md");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          "svvyx extensions instructions reorder notes --file 010-notes.md --file 010-notes.md --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Reorder must mention every current full instruction file exactly once.");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          "svvyx extensions instructions configure notes --file 020-domain.md --bypassed maybe --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("--bypassed must be true or false.");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          "svvyx extensions instructions configure notes --file 999-missing.md --bypassed true --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Instruction file not found: 999-missing.md");
    const cwd = createTempDir();
    const packagedFullDir = join(cwd, "generated", "instructions", "full");
    mkdirSync(packagedFullDir, { recursive: true });
    writeFileSync(join(packagedFullDir, "010-tinyfish-cli.generated.md"), "tinyfish\n");
    await expect(
      runSvvyxExtensionsCommand({
        command: "svvyx extensions instructions add web --name ../bad.md --json",
        cwd,
        extensionsRoot,
      }),
    ).rejects.toThrow("Invalid instruction Markdown basename: ../bad.md");
    expect(existsSync(join(extensionsRoot, "sources", "builtin", "web"))).toBe(false);
    await expect(
      runSvvyxExtensionsCommand({
        command:
          "svvyx extensions instructions reorder web --file 010-tinyfish-cli.generated.md --file 010-tinyfish-cli.generated.md --json",
        cwd,
        extensionsRoot,
      }),
    ).rejects.toThrow("Reorder must mention every current full instruction file exactly once.");
    expect(existsSync(join(extensionsRoot, "sources", "builtin", "web"))).toBe(true);
    await expect(
      runSvvyxExtensionsCommand({
        command: "svvyx extensions instructions add shell --name 030-shell-extra.md --json",
        extensionsRoot,
      }),
    ).resolves.toMatchObject({
      output: {
        ok: true,
        extensionId: "shell",
        created: {
          name: "030-shell-extra.md",
        },
      },
    });
    expect(
      existsSync(
        join(
          extensionsRoot,
          "sources",
          "builtin",
          "shell",
          "instructions",
          "full",
          "030-shell-extra.md",
        ),
      ),
    ).toBe(true);
    await expect(
      runSvvyxExtensionsCommand({
        command:
          "svvyx extensions instructions add external_instruction:AGENTS.md:/repo/AGENTS.md --name 020-web.md --json",
        extensionsRoot,
      }),
    ).rejects.toThrow(
      "External instruction records are read-only and cannot be changed through instruction lifecycle commands.",
    );
  });

  it("rejects native, builtin, duplicate, reserved, and invalid create targets", async () => {
    const extensionsRoot = createTempDir();
    mkdirSync(join(extensionsRoot, "sources", "user", "linear"), { recursive: true });
    mkdirSync(join(extensionsRoot, "sources", "user", "renamed"), { recursive: true });
    mkdirSync(join(extensionsRoot, "trash", "trashed"), { recursive: true });
    mkdirSync(join(extensionsRoot, "trash", "trash-entry", "sources", "user", "deleted"), {
      recursive: true,
    });
    mkdirSync(join(extensionsRoot, "snapshots", "restoring"), { recursive: true });
    mkdirSync(join(extensionsRoot, "snapshots", "snapshot-entry", "sources", "user", "restore"), {
      recursive: true,
    });
    writeFileSync(
      join(extensionsRoot, "sources", "user", "renamed", "manifest.json"),
      JSON.stringify({ id: "existing-manifest" }),
    );
    writeFileSync(
      join(extensionsRoot, "trash", "trash-entry", "sources", "user", "deleted", "manifest.json"),
      JSON.stringify({ id: "deleted-manifest" }),
    );
    writeFileSync(
      join(
        extensionsRoot,
        "snapshots",
        "snapshot-entry",
        "sources",
        "user",
        "restore",
        "manifest.json",
      ),
      JSON.stringify({ id: "restore-manifest" }),
    );

    await expect(
      runSvvyxExtensionsCommand({
        command:
          'svvyx extensions create --id linear --title "Linear" --description "Linear." --interface svvyx --json',
        extensionsRoot,
      }),
    ).rejects.toThrow("User extension source already exists: linear");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          'svvyx extensions create --id web --title "Web" --description "Web." --interface instructions --json',
        extensionsRoot,
      }),
    ).rejects.toThrow("Extension id already exists: web");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          'svvyx extensions create --id existing-manifest --title "Existing" --description "Existing." --interface instructions --json',
        extensionsRoot,
      }),
    ).rejects.toThrow("Extension id already exists: existing-manifest");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          'svvyx extensions create --id extensions --title "Extensions" --description "Reserved." --interface instructions --json',
        extensionsRoot,
      }),
    ).rejects.toThrow("Extension id is reserved by svvyx.");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          'svvyx extensions create --id trashed --title "Trashed" --description "Trashed." --interface instructions --json',
        extensionsRoot,
      }),
    ).rejects.toThrow("Extension id is reserved by trash: trashed");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          'svvyx extensions create --id deleted-manifest --title "Deleted" --description "Deleted." --interface instructions --json',
        extensionsRoot,
      }),
    ).rejects.toThrow("Extension id is reserved by trash: deleted-manifest");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          'svvyx extensions create --id restoring --title "Restoring" --description "Restoring." --interface instructions --json',
        extensionsRoot,
      }),
    ).rejects.toThrow("Extension id is reserved by snapshot restore state: restoring");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          'svvyx extensions create --id restore-manifest --title "Restore" --description "Restore." --interface instructions --json',
        extensionsRoot,
      }),
    ).rejects.toThrow("Extension id is reserved by snapshot restore state: restore-manifest");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          'svvyx extensions create --id Bad/Path --title "Bad" --description "Bad." --interface instructions --json',
        extensionsRoot,
      }),
    ).rejects.toThrow("Extension id must be lowercase kebab-case starting with a letter.");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          'svvyx extensions create --id native --title "Native" --description "Native." --interface native_tool --json',
        extensionsRoot,
      }),
    ).rejects.toThrow("Extension create --interface must be instructions or svvyx.");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          'svvyx extensions create --id docs --title "Docs" --description "Docs." --interface instructions --typescript-api true --json',
        extensionsRoot,
      }),
    ).rejects.toThrow("typescriptApiEnabled is valid only with interface svvyx.");
  });

  it("configures user svvyx TypeScript API generation", async () => {
    const extensionsRoot = createTempDir();
    await runSvvyxExtensionsCommand({
      command:
        'svvyx extensions create --id linear --title "Linear" --description "Linear issue workflow." --interface svvyx --typescript-api true --json',
      extensionsRoot,
    });

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions configure --extension linear --typescript-api false --json",
      extensionsRoot,
    });

    const inventory = await readBuiltinExtensionsInventory({
      extensionsRoot,
      includeUserExtensions: true,
    });
    expect(inventory.extensions.find((extension) => extension.id === "linear")).toMatchObject({
      interface: "svvyx",
      typescriptApiEnabled: false,
    });
    await expect(
      runSvvyxExtensionsCommand({
        command: "svvyx extensions configure --extension linear --typescript-api maybe --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("--typescript-api must be true or false.");
  });

  it("configures builtin svvyx TypeScript API generation through sources", async () => {
    const extensionsRoot = createTempDir();

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions configure --extension artifacts --typescript-api false --json",
      extensionsRoot,
    });

    let inventory = await readBuiltinExtensionsInventory({ extensionsRoot });
    expect(inventory.extensions.find((extension) => extension.id === "artifacts")).toMatchObject({
      interface: "svvyx",
      typescriptApiEnabled: false,
      tooling: {
        typescriptApiStatus: "disabled",
      },
    });

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions configure --extension artifacts --typescript-api true --json",
      extensionsRoot,
    });

    inventory = await readBuiltinExtensionsInventory({ extensionsRoot });
    expect(inventory.extensions.find((extension) => extension.id === "artifacts")).toMatchObject({
      interface: "svvyx",
      typescriptApiEnabled: true,
      tooling: {
        typescriptApiStatus: "emitted",
      },
    });
  });

  it("marks builtin extensions customized only after their source differs", async () => {
    const extensionsRoot = createTempDir();
    const cwd = createTempDir();
    const packagedFullDir = join(cwd, "generated", "instructions", "full");
    mkdirSync(packagedFullDir, { recursive: true });
    writeFileSync(
      join(packagedFullDir, "010-tinyfish-cli.generated.md"),
      "packaged tinyfish instructions\n",
    );

    let inventory = await readBuiltinExtensionsInventory({
      cwd,
      extensionsRoot,
      includeUserExtensions: true,
    });
    expect(inventory.extensions.find((extension) => extension.id === "web")).toMatchObject({
      customized: false,
    });

    await runSvvyxExtensionsCommand({
      command:
        "svvyx extensions instructions configure web --file 010-tinyfish-cli.generated.md --bypassed true --json",
      cwd,
      extensionsRoot,
    });

    inventory = await readBuiltinExtensionsInventory({
      cwd,
      extensionsRoot,
      includeUserExtensions: true,
    });
    expect(inventory.extensions.find((extension) => extension.id === "web")).toMatchObject({
      customized: false,
    });

    await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add web --name 020-web-notes.md --json",
      cwd,
      extensionsRoot,
    });

    inventory = await readBuiltinExtensionsInventory({
      cwd,
      extensionsRoot,
      includeUserExtensions: true,
    });
    expect(inventory.extensions.find((extension) => extension.id === "web")).toMatchObject({
      customized: true,
    });
  });

  it("inspects builtin extensions with CLI readiness, global usage, and build issues", async () => {
    const extensionsRoot = createTempDir();
    const cwd = createTempDir();
    const packagedFullDir = join(cwd, "generated", "instructions", "full");
    mkdirSync(packagedFullDir, { recursive: true });
    writeFileSync(
      join(packagedFullDir, "010-tinyfish-cli.generated.md"),
      "packaged tinyfish instructions\n",
    );
    const result = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect web --json",
      cwd,
      extensionsRoot,
      cliProbe: () => tinyfishStatus({ status: "missing" }),
    });
    const output = result.output as any;
    const sourceRoot = join(extensionsRoot, "sources", "builtin", "web");

    expect(output.ok).toBe(true);
    expect(output.extension).toMatchObject({
      id: "web",
      category: "builtin",
      interface: "instructions",
      title: "Web",
      typescriptApiEnabled: false,
      paths: {
        sourceRoot: sourceRoot,
        manifest: join(sourceRoot, "manifest.json"),
        instructionsFullDir: join(sourceRoot, "instructions", "full"),
        instructionsFull: [],
        instructionsMinimal: join(sourceRoot, "instructions", "minimal.md"),
      },
      state: {
        buildRequired: true,
        ready: false,
        issues: [
          {
            code: "CLI_MISSING",
          },
        ],
      },
    });
    expect(output.extension.requirements.cliRequirements).toEqual([
      tinyfishStatus({ status: "missing" }),
    ]);
    expect(output.extension.usage).toEqual([
      {
        actorKind: "orchestrator",
        agentProfile: "default-orchestrator",
        state: "loaded",
        configurable: true,
      },
      {
        actorKind: "handler",
        agentProfile: "threadHandler",
        state: "loaded",
        configurable: true,
      },
      {
        actorKind: "workflow-task",
        agentProfile: "explorer",
        state: "loaded",
        configurable: true,
      },
      {
        actorKind: "workflow-task",
        agentProfile: "implementer",
        state: "loaded",
        configurable: true,
      },
      {
        actorKind: "workflow-task",
        agentProfile: "reviewer",
        state: "loaded",
        configurable: true,
      },
    ]);
    expect(output.extension).not.toHaveProperty("webSearch");
    expect(output.extension).not.toHaveProperty("nativeTools");
    expect(
      readFileSync(
        join(sourceRoot, "instructions", "full", "010-tinyfish-cli.generated.md"),
        "utf8",
      ),
    ).toBe("packaged tinyfish instructions\n");
  });

  it("sets profile extension usage, records a reversible change, and queues affected surfaces", async () => {
    const extensionsRoot = createTempDir();
    const agentRoot = createTempDir();
    const agentSettingsStore = createAgentSettingsStore({
      cwd: agentRoot,
      agentDir: join(agentRoot, ".agent"),
      workflowsSourceRoot: join(agentRoot, "workflows"),
    });
    const structuredSessionStore = createStructuredSessionStateStore({
      workspace: {
        id: agentRoot,
        label: "svvy",
        cwd: agentRoot,
      },
    });
    structuredSessionStore.upsertPiSession({
      sessionId: "session-set-usage",
      title: "Set Usage",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      orchestratorAgentProfileId: "default-orchestrator",
      messageCount: 0,
      status: "idle",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    });

    const result = await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        "svvyx extensions set-usage --extension smithers --agent-profile default-orchestrator --state loaded --json",
      extensionsRoot,
      structuredSessionStore,
    });
    const output = result.output as any;

    expect(output).toMatchObject({
      ok: true,
      extensionId: "smithers",
      agentProfile: "default-orchestrator",
      before: { state: "available" },
      after: { state: "loaded" },
      agentContextImpact: {
        affectsNewTurns: true,
        activeRunsChangeAtNextSafeBoundary: true,
        queuedUpdates: [
          {
            surfacePiSessionId: "session-set-usage",
            kind: "agent_context_refresh",
            label: "Update agent context",
            reason: "extension_usage_changed",
          },
        ],
      },
    });
    expect(agentSettingsStore.getState().agents.orchestrators[0]?.extensionUsage).toMatchObject({
      smithers: "loaded",
    });
    expect(
      structuredSessionStore
        .listQueuedSurfaceMessages({ surfacePiSessionId: "session-set-usage" })
        .map((message) => message.kind),
    ).toEqual(["agent_context_refresh"]);

    const reverted = await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command: `svvyx extensions revert ${output.changeId} --json`,
      extensionsRoot,
      structuredSessionStore,
    });
    expect((reverted.output as any).result).toMatchObject({
      kind: "extension_usage",
      extensionId: "smithers",
      agentProfile: "default-orchestrator",
      after: { state: "available" },
    });
    expect(
      agentSettingsStore.getState().agents.orchestrators[0]?.extensionUsage.smithers,
    ).toBeUndefined();
    structuredSessionStore.close();
  });

  it("shares set-usage semantics with the app API helper", () => {
    const extensionsRoot = createTempDir();
    const agentRoot = createTempDir();
    const agentSettingsStore = createAgentSettingsStore({
      cwd: agentRoot,
      agentDir: join(agentRoot, ".agent"),
      workflowsSourceRoot: join(agentRoot, "workflows"),
    });
    const structuredSessionStore = createStructuredSessionStateStore({
      workspace: {
        id: agentRoot,
        label: "svvy",
        cwd: agentRoot,
      },
    });
    structuredSessionStore.upsertPiSession({
      sessionId: "session-set-usage-helper",
      title: "Set Usage Helper",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      orchestratorAgentProfileId: "default-orchestrator",
      messageCount: 0,
      status: "idle",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    });

    expect(() =>
      setExtensionUsage({
        agentSettingsStore,
        structuredSessionStore,
        extensionsRoot,
        extensionId: "extension-loading",
        agentProfile: "default-orchestrator",
        state: "unavailable",
      }),
    ).toThrow("Extension Loading is fixed loaded");

    const result = setExtensionUsage({
      agentSettingsStore,
      structuredSessionStore,
      extensionsRoot,
      extensionId: "smithers",
      agentProfile: "default-orchestrator",
      state: "loaded",
    });

    expect(result).toMatchObject({
      actor: "orchestrator",
      agentProfile: "default-orchestrator",
      output: {
        ok: true,
        extensionId: "smithers",
        agentProfile: "default-orchestrator",
        before: { state: "available" },
        after: { state: "loaded" },
      },
    });
    expect(agentSettingsStore.getState().agents.orchestrators[0]?.extensionUsage).toMatchObject({
      smithers: "loaded",
    });
    expect(
      structuredSessionStore
        .listQueuedSurfaceMessages({ surfacePiSessionId: "session-set-usage-helper" })
        .map((message) => message.kind),
    ).toEqual(["agent_context_refresh"]);

    const restored = setExtensionUsage({
      agentSettingsStore,
      structuredSessionStore,
      extensionsRoot,
      extensionId: "smithers",
      agentProfile: "default-orchestrator",
      state: "available",
    });

    expect(restored).toMatchObject({
      actor: "orchestrator",
      agentProfile: "default-orchestrator",
      output: {
        ok: true,
        extensionId: "smithers",
        agentProfile: "default-orchestrator",
        before: { state: "loaded" },
        after: { state: "available" },
      },
    });
    expect(
      agentSettingsStore.getState().agents.orchestrators[0]?.extensionUsage.smithers,
    ).toBeUndefined();
    structuredSessionStore.close();
  });

  it("sets future extension defaults without mutating existing profile overrides", async () => {
    const extensionsRoot = createTempDir();
    const agentRoot = createTempDir();
    const agentSettingsStore = createAgentSettingsStore({
      cwd: agentRoot,
      agentDir: join(agentRoot, ".agent"),
      workflowsSourceRoot: join(agentRoot, "workflows"),
    });
    const beforeProfile = agentSettingsStore.getState().agents.orchestrators[0]!;

    await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        "svvyx extensions defaults set-usage --actor orchestrator --extension smithers --state loaded --json",
      extensionsRoot,
    });
    await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        "svvyx extensions defaults set-usage --actor workflow-task --extension github --state loaded --json",
      extensionsRoot,
    });
    await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        "svvyx extensions defaults reorder --extension github --extension smithers --extension shell --json",
      extensionsRoot,
    });

    const settings = agentSettingsStore.getState();
    expect(settings.agents.orchestrators[0]?.extensionUsage).toEqual(beforeProfile.extensionUsage);
    expect(settings.extensionDefaults.usage.orchestrator).toMatchObject({
      smithers: "loaded",
    });
    expect(settings.extensionDefaults.usage["workflow-task"]).toMatchObject({
      github: "loaded",
    });
    expect(settings.extensionDefaults.order.slice(0, 3)).toEqual(["github", "smithers", "shell"]);

    const inventory = await readBuiltinExtensionsInventory({
      agentSettingsStore,
      extensionsRoot,
      includeUserExtensions: true,
    });
    expect(inventory.defaults?.usage.smithers).toContainEqual(
      expect.objectContaining({
        actorKind: "orchestrator",
        state: "loaded",
        customized: true,
      }),
    );
    expect(inventory.defaults?.order.slice(0, 3)).toEqual(["github", "smithers", "shell"]);
  });

  it("creates user prompt extensions loaded by default for future actors", async () => {
    const extensionsRoot = createTempDir();
    const agentRoot = createTempDir();
    const agentSettingsStore = createAgentSettingsStore({
      cwd: agentRoot,
      agentDir: join(agentRoot, ".agent"),
      workflowsSourceRoot: join(agentRoot, "workflows"),
    });

    await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        'svvyx extensions create --id notes --title "Notes" --description "Project notes." --interface instructions --json',
      extensionsRoot,
    });

    const defaults = agentSettingsStore.getState().extensionDefaults.usage;
    expect(defaults.orchestrator?.notes).toBe("loaded");
    expect(defaults["workflow-task"]?.notes).toBe("loaded");
    const inventory = await readBuiltinExtensionsInventory({
      agentSettingsStore,
      extensionsRoot,
      includeUserExtensions: true,
    });
    expect(inventory.defaults?.usage.notes).toEqual([
      expect.objectContaining({ actorKind: "orchestrator", state: "loaded" }),
      expect.objectContaining({ actorKind: "workflow-task", state: "loaded" }),
    ]);
  });

  it("sets workflow-agent extension usage in source records and reverts exactly", async () => {
    const extensionsRoot = createTempDir();
    const agentRoot = createTempDir();
    const workflowsSourceRoot = join(agentRoot, "workflows");
    const agentSettingsStore = createAgentSettingsStore({
      cwd: agentRoot,
      agentDir: join(agentRoot, ".agent"),
      workflowsSourceRoot,
    });

    const result = await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        "svvyx extensions set-usage --extension github --agent-profile reviewer --state loaded --json",
      extensionsRoot,
    });
    const output = result.output as any;

    expect(output).toMatchObject({
      ok: true,
      extensionId: "github",
      agentProfile: "reviewer",
      before: { state: "available" },
      after: { state: "loaded" },
      agentContextImpact: {
        affectsNewTurns: true,
        activeRunsChangeAtNextSafeBoundary: true,
        queuedUpdates: [],
      },
    });
    expect(agentSettingsStore.getState().workflowAgents.reviewer).toMatchObject({
      overrides: {
        github: "loaded",
      },
    });
    expect(
      JSON.parse(readFileSync(join(workflowsSourceRoot, "agents", "reviewer.agent.json"), "utf8")),
    ).toMatchObject({
      overrides: {
        github: "loaded",
      },
    });

    const reverted = await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command: `svvyx extensions revert ${output.changeId} --json`,
      extensionsRoot,
    });

    expect((reverted.output as any).result).toMatchObject({
      kind: "extension_usage",
      extensionId: "github",
      agentProfile: "reviewer",
      after: { state: "available" },
    });
    expect(
      agentSettingsStore.getState().workflowAgents.reviewer?.overrides?.github,
    ).toBeUndefined();
    expect(
      JSON.parse(readFileSync(join(workflowsSourceRoot, "agents", "reviewer.agent.json"), "utf8")),
    ).toMatchObject({ overrides: {} });
    expect(
      JSON.parse(readFileSync(join(workflowsSourceRoot, "agents", "reviewer.agent.json"), "utf8"))
        .overrides.github,
    ).toBeUndefined();
  });

  it("reports usage for all profiles and fixed Extension Loading metadata through inspect", async () => {
    const extensionsRoot = createTempDir();
    const agentRoot = createTempDir();
    const agentSettingsStore = createAgentSettingsStore({
      cwd: agentRoot,
      agentDir: join(agentRoot, ".agent"),
      workflowsSourceRoot: join(agentRoot, "workflows"),
    });
    agentSettingsStore.setAgentProfile({
      ...agentSettingsStore.getState().agents.orchestrators[0]!,
      id: "docs-orchestrator",
      kind: "orchestrator",
      name: "Docs orchestrator",
      extensionUsage: {
        smithers: "loaded",
      },
      builtin: false,
      locked: false,
    });
    agentSettingsStore.setWorkflowAgent("reviewer", {
      ...agentSettingsStore.getState().workflowAgents.reviewer!,
      overrides: {
        github: "loaded",
      },
    });

    const inspectedSmithers = await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command: "svvyx extensions inspect smithers --json",
      extensionsRoot,
    });
    const smithersUsage = (inspectedSmithers.output as any).extension.usage;
    expect(smithersUsage).toContainEqual(
      expect.objectContaining({
        actorKind: "orchestrator",
        agentProfile: "default-orchestrator",
        state: "available",
      }),
    );
    expect(smithersUsage).toContainEqual(
      expect.objectContaining({
        actorKind: "orchestrator",
        agentProfile: "docs-orchestrator",
        state: "loaded",
      }),
    );
    expect(smithersUsage).toContainEqual(
      expect.objectContaining({
        actorKind: "handler",
        agentProfile: "threadHandler",
        state: "loaded",
      }),
    );
    expect(smithersUsage).toContainEqual(
      expect.objectContaining({
        actorKind: "workflow-task",
        agentProfile: "reviewer",
        state: "unavailable",
      }),
    );

    const inspectedGithub = await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command: "svvyx extensions inspect github --json",
      extensionsRoot,
    });
    expect((inspectedGithub.output as any).extension.usage).toContainEqual(
      expect.objectContaining({
        actorKind: "workflow-task",
        agentProfile: "reviewer",
        state: "loaded",
      }),
    );

    const inspectedLoading = await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command: "svvyx extensions inspect extension-loading --json",
      extensionsRoot,
    });
    expect((inspectedLoading.output as any).extension.usage[0]).toMatchObject({
      configurable: false,
      fixedReason: "app_native_control",
      state: "loaded",
    });
  });

  it("rejects set-usage for fixed Extension Loading", async () => {
    const agentRoot = createTempDir();
    const agentSettingsStore = createAgentSettingsStore({
      cwd: agentRoot,
      agentDir: join(agentRoot, ".agent"),
      workflowsSourceRoot: join(agentRoot, "workflows"),
    });

    await expect(
      runSvvyxExtensionsCommand({
        agentSettingsStore,
        command:
          "svvyx extensions set-usage --extension extension-loading --agent-profile default-orchestrator --state unavailable --json",
      }),
    ).rejects.toThrow("Extension Loading is fixed loaded");
  });

  it("rejects undocumented profile aliases and accepts actor-default-unavailable overrides", async () => {
    const extensionsRoot = createTempDir();
    const agentRoot = createTempDir();
    const agentSettingsStore = createAgentSettingsStore({
      cwd: agentRoot,
      agentDir: join(agentRoot, ".agent"),
      workflowsSourceRoot: join(agentRoot, "workflows"),
    });

    await expect(
      runSvvyxExtensionsCommand({
        agentSettingsStore,
        command:
          "svvyx extensions set-usage --extension smithers --agent-profile default --state available --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Agent profile not found: default");

    const handlerOverride = await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        "svvyx extensions set-usage --extension thread-orchestration --agent-profile threadHandler --state loaded --json",
      extensionsRoot,
    });
    const workflowOverride = await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        "svvyx extensions set-usage --extension workflows --agent-profile reviewer --state loaded --json",
      extensionsRoot,
    });

    expect(handlerOverride.output).toMatchObject({
      ok: true,
      extensionId: "thread-orchestration",
      agentProfile: "threadHandler",
      after: { state: "loaded" },
    });
    expect(workflowOverride.output).toMatchObject({
      ok: true,
      extensionId: "workflows",
      agentProfile: "reviewer",
      after: { state: "loaded" },
    });
    expect(agentSettingsStore.getState().agents.special.threadHandler.extensionUsage).toMatchObject(
      {
        "thread-orchestration": "loaded",
      },
    );
    expect(agentSettingsStore.getState().workflowAgents.reviewer?.overrides).toMatchObject({
      workflows: "loaded",
    });
  });

  it("conflicts when reverting usage after later profile changes", async () => {
    const extensionsRoot = createTempDir();
    const agentRoot = createTempDir();
    const agentSettingsStore = createAgentSettingsStore({
      cwd: agentRoot,
      agentDir: join(agentRoot, ".agent"),
      workflowsSourceRoot: join(agentRoot, "workflows"),
    });
    const first = await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        "svvyx extensions set-usage --extension smithers --agent-profile default-orchestrator --state loaded --json",
      extensionsRoot,
    });
    await runSvvyxExtensionsCommand({
      agentSettingsStore,
      command:
        "svvyx extensions set-usage --extension smithers --agent-profile default-orchestrator --state unavailable --json",
      extensionsRoot,
    });

    await expect(
      runSvvyxExtensionsCommand({
        agentSettingsStore,
        command: `svvyx extensions revert ${(first.output as any).changeId} --json`,
        extensionsRoot,
      }),
    ).rejects.toThrow("cannot be reverted because usage changed after it was recorded");
  });

  it("reports updateable TinyFish versions through inspect without blocking readiness", async () => {
    const extensionsRoot = createTempDir();
    const available = tinyfishStatus({
      currentVersion: "0.1.5",
      detectedVersion: "0.1.5",
      latestVersion: "0.1.6",
      path: "/usr/local/bin/tinyfish",
      status: "available",
      updateAvailable: true,
      updateCommand: "npm install -g @tiny-fish/cli@0.1.6",
    });
    const result = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect web --json",
      cwd: "/repo/svvy",
      extensionsRoot,
      cliProbe: () => available,
    });
    const output = result.output as any;

    expect(output.extension.requirements.cliRequirements).toEqual([available]);
    expect(output.extension.state).toMatchObject({
      buildRequired: false,
      ready: true,
      currentBuild: {
        status: "ready",
      },
      issues: [],
    });
  });

  it("keeps inspect output free of internal aggregate, schema, fingerprint, and auth details", async () => {
    const extensionsRoot = createTempDir();
    const result = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect web --json",
      cwd: "/repo/svvy",
      extensionsRoot,
      cliProbe: () => tinyfishStatus({ status: "missing" }),
    });
    const serialized = JSON.stringify(result.output);

    expect(serialized).not.toContain("commandDocs");
    expect(serialized).not.toContain("toolSchemas");
    expect(serialized).not.toContain("fingerprint");
    expect(serialized).not.toContain("aggregate");
    expect(serialized).not.toContain("externalAuth");
    expect(serialized).not.toContain("authStatus");
    expect(serialized).not.toContain("secretValue");
  });

  it("fails Web build with an ordinary JSON error when TinyFish is missing", async () => {
    const cwd = createTempDir();
    const buildRoot = join(cwd, "extension-builds");
    const extensionsRoot = join(cwd, "extensions");
    const result = await runSvvyxExtensionsCommand({
      buildRoot,
      command: "svvyx extensions build web --json",
      cwd,
      extensionsRoot,
      cliProbe: () => tinyfishStatus({ status: "missing" }),
    });
    const output = result.output as any;

    expect(output).toEqual({
      ok: false,
      error: {
        code: "CLI_MISSING",
        message: "tinyfish 0.1.6 is required by web but was not found on PATH.",
        extensionId: "web",
        cli: tinyfishStatus({ status: "missing" }),
        nextSteps: [
          "Run the install command through exec_command if the user wants this CLI installed.",
          "Rerun `svvyx extensions build web --json` after installation.",
        ],
      },
    });
    expect(result.commandFacts).toEqual({
      extensionBuildOk: false,
      extensionId: "web",
      cliRequirementStatus: "missing",
      cliRequirementId: "tinyfish",
    });
    expect(existsSync(join(buildRoot, "web", "current"))).toBe(false);
  });

  it("fails generated-instruction CLI builds consistently for cx and Smithers", async () => {
    const extensionsRoot = createTempDir();
    const cxResult = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build cx --json",
      cwd: "/repo/svvy",
      extensionsRoot,
      cliProbe: (requirement) => cliStatus(requirement, { status: "missing" }),
    });
    const smithersResult = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build smithers --json",
      cwd: "/repo/svvy",
      extensionsRoot,
      cliProbe: (requirement) =>
        cliStatus(requirement, { path: "/usr/local/bin/smithers", status: "unknown" }),
    });

    expect(cxResult.output).toMatchObject({
      ok: false,
      error: {
        code: "CLI_MISSING",
        extensionId: "cx",
        cli: {
          id: "cx",
          binary: "cx",
          currentVersion: "0.7.1",
          installCommand: "cargo install cx-cli --version 0.7.1",
        },
      },
    });
    expect(smithersResult.output).toMatchObject({
      ok: false,
      error: {
        code: "CLI_STATUS_UNKNOWN",
        extensionId: "smithers",
        cli: {
          id: "smithers-orchestrator",
          binary: "smithers",
          currentVersion: null,
          path: "/usr/local/bin/smithers",
        },
      },
    });
  });

  it("fails Web build when TinyFish exists but version detection is unknown", async () => {
    const cwd = createTempDir();
    const buildRoot = join(cwd, "extension-builds");
    const extensionsRoot = join(cwd, "extensions");
    const result = await runSvvyxExtensionsCommand({
      buildRoot,
      command: "svvyx extensions build web --json",
      cwd,
      extensionsRoot,
      cliProbe: () => tinyfishStatus({ status: "unknown", path: "/usr/local/bin/tinyfish" }),
    });
    const output = result.output as any;

    expect(output.ok).toBe(false);
    expect(output.error).toMatchObject({
      code: "CLI_STATUS_UNKNOWN",
      extensionId: "web",
      message: "tinyfish is required by web, but its version could not be determined.",
      cli: {
        id: "tinyfish",
        status: "unknown",
        currentVersion: null,
        detectedVersion: null,
        path: "/usr/local/bin/tinyfish",
      },
    });
    expect(existsSync(join(buildRoot, "web", "current"))).toBe(false);
  });

  it("builds with a detected TinyFish version different from the manifest default", async () => {
    const cwd = createTempDir();
    const buildRoot = join(cwd, "extension-builds");
    const extensionsRoot = join(cwd, "extensions");
    const available = tinyfishStatus({
      currentVersion: "0.1.5",
      detectedVersion: "0.1.5",
      latestVersion: "0.1.6",
      path: "/usr/local/bin/tinyfish",
      status: "available",
      updateAvailable: true,
      updateCommand: "npm install -g @tiny-fish/cli@0.1.6",
    });
    const result = await runSvvyxExtensionsCommand({
      buildRoot,
      command: "svvyx extensions build web --json",
      cwd,
      extensionsRoot,
      cliProbe: () => available,
    });
    const output = result.output as any;

    expect(output.ok).toBe(true);
    expect(output.build).toMatchObject({
      status: "success",
      interface: "instructions",
      activated: true,
      contextReady: true,
      runtimeReady: true,
      currentPath: join(buildRoot, "web", "current"),
    });
    expect(output.requirements.cliRequirements).toEqual([available]);
    expect(output.nextSteps).toEqual([
      "Use the detected CLI for generated instructions until the user or an agent chooses to update.",
      "Run the update command through exec_command only when updating this CLI is appropriate.",
    ]);
    expect(existsSync(join(buildRoot, "web", "current"))).toBe(true);
  });

  it("keeps CLI install and update as ordinary exec_command work", async () => {
    const extensionsRoot = createTempDir();
    await expect(
      runSvvyxExtensionsCommand({
        command: "svvyx extensions install web --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Unsupported Extension Managing command: install");
    await expect(
      runSvvyxExtensionsCommand({
        command: "svvyx extensions update web --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Unsupported Extension Managing command: update");

    const missing = await runSvvyxExtensionsCommand({
      command: "svvyx extensions build web --json",
      cliProbe: () => tinyfishStatus({ status: "missing" }),
      extensionsRoot,
    });
    expect((missing.output as any).error.cli.installCommand).toBe(
      "npm install -g @tiny-fish/cli@0.1.6",
    );
    expect((missing.output as any).error.nextSteps).toContain(
      "Run the install command through exec_command if the user wants this CLI installed.",
    );

    const updateable = await runSvvyxExtensionsCommand({
      command: "svvyx extensions inspect web --json",
      cliProbe: () =>
        tinyfishStatus({
          currentVersion: "0.1.5",
          detectedVersion: "0.1.5",
          latestVersion: "0.1.6",
          path: "/usr/local/bin/tinyfish",
          status: "available",
          updateAvailable: true,
          updateCommand: "npm install -g @tiny-fish/cli@0.1.6",
        }),
      extensionsRoot,
    });
    expect((updateable.output as any).extension.requirements.cliRequirements[0].updateCommand).toBe(
      "npm install -g @tiny-fish/cli@0.1.6",
    );
  });

  it("probes PATH binaries and parses detected CLI versions", () => {
    const bin = createTempDir();
    const requirement: ExtensionCliRequirement = {
      id: "tinyfish",
      package: "@tiny-fish/cli",
      binary: "tinyfish",
      required: true,
      version: "0.1.6",
      versionCommand: "tinyfish --version",
      installCommand: "npm install -g @tiny-fish/cli@{{version}}",
    };
    writeExecutable(join(bin, "tinyfish"), "#!/bin/sh\necho tinyfish 0.1.5\n");

    expect(probeCliRequirement(requirement, { PATH: bin })).toMatchObject({
      status: "available",
      currentVersion: "0.1.5",
      detectedVersion: "0.1.5",
      latestVersion: "0.1.6",
      updateAvailable: true,
      updateCommand: "npm install -g @tiny-fish/cli@0.1.6",
      path: join(bin, "tinyfish"),
    });

    expect(probeCliRequirement(requirement, { PATH: "" })).toMatchObject({
      status: "missing",
      currentVersion: "0.1.6",
      installCommand: "npm install -g @tiny-fish/cli@0.1.6",
      path: null,
    });

    writeExecutable(join(bin, "tinyfish"), "#!/bin/sh\necho TinyFish CLI\n");
    expect(probeCliRequirement(requirement, { PATH: bin })).toMatchObject({
      status: "unknown",
      currentVersion: null,
      detectedVersion: null,
      installCommand: null,
      updateCommand: null,
      path: join(bin, "tinyfish"),
    });
  });

  it("routes Extension Managing through exec_command without adding Web native tools", async () => {
    const cwd = createTempDir();
    const buildRoot = join(cwd, "extension-builds");
    const tools = createSvvyDirectToolsForTest({
      cwd,
      extensionsBuildRoot: buildRoot,
      extensionsCliProbe: () => tinyfishStatus({ status: "missing" }),
      extensionsRoot: createTempDir(),
    }).codingTools;
    const execTool = tools.find((candidate) => candidate.name === "exec_command");
    if (!execTool) throw new Error("exec_command tool missing.");

    const result = await execTool.execute(
      "tool-extension-build-web",
      { cmd: "svvyx extensions build web --json" },
      new AbortController().signal,
      () => {},
    );
    const text = result.content.find(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )?.text;

    expect(text).toBeTruthy();
    const output = JSON.parse(text!);
    expect(output).toMatchObject({
      extensionId: "web",
    });
    expect(result.details?.commandFacts).toMatchObject({
      extensionId: "web",
    });
    expect(tools.map((tool) => tool.name)).toEqual(["exec_command", "write_stdin", "apply_patch"]);
    expect(tools.map((tool) => tool.name)).not.toContain("web_search");
    expect(tools.map((tool) => tool.name)).not.toContain("web_fetch");
    expect(existsSync(join(buildRoot, "web", "current"))).toBe(output.ok === true);
  });

  it("routes user extension create through exec_command with app-owned storage injection", async () => {
    const cwd = createTempDir();
    const extensionsRoot = createTempDir();
    const tools = createSvvyDirectToolsForTest({
      cwd,
      extensionsRoot,
    }).codingTools;
    const execTool = tools.find((candidate) => candidate.name === "exec_command");
    if (!execTool) throw new Error("exec_command tool missing.");

    const result = await execTool.execute(
      "tool-extension-create-linear",
      {
        cmd: 'svvyx extensions create --id linear --title "Linear" --description "Linear issue workflow." --interface svvyx --typescript-api true --json',
      },
      new AbortController().signal,
      () => {},
    );
    const text = result.content.find(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )?.text;

    expect(text).toBeTruthy();
    expect(JSON.parse(text!)).toMatchObject({
      ok: true,
      extension: {
        id: "linear",
        category: "user",
        interface: "svvyx",
        state: {
          ready: false,
        },
      },
    });
    expect(result.details?.commandFacts).toEqual({
      extensionCreated: true,
      extensionId: "linear",
      extensionInterface: "svvyx",
      extensionReady: false,
      extensionSourceRoot: join(extensionsRoot, "sources", "user", "linear"),
    });
    expect(existsSync(join(extensionsRoot, "sources", "user", "linear", "manifest.json"))).toBe(
      true,
    );
  });

  it("returns Extension Managing validation failures as command JSON through exec_command", async () => {
    const cwd = createTempDir();
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const tools = createSvvyDirectToolsForTest({
      cwd,
      extensionsRoot,
    }).codingTools;
    const execTool = tools.find((candidate) => candidate.name === "exec_command");
    if (!execTool) throw new Error("exec_command tool missing.");

    await expect(
      execTool.execute(
        "tool-extension-invalid-instruction",
        {
          cmd: "svvyx extensions instructions add notes --name ../bad.md --json",
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow(
      JSON.stringify({
        ok: false,
        error: {
          code: "INVALID_INSTRUCTION_FILENAME",
          message: "Invalid instruction Markdown basename: ../bad.md",
        },
      }),
    );
  });
});

function tinyfishStatus(
  overrides: Partial<CliRequirementStatus> & Pick<CliRequirementStatus, "status">,
): CliRequirementStatus {
  const status = overrides.status;
  return {
    id: "tinyfish",
    binary: "tinyfish",
    package: "@tiny-fish/cli",
    required: true,
    defaultVersion: "0.1.6",
    currentVersion:
      overrides.currentVersion ??
      (status === "missing" ? "0.1.6" : status === "available" ? "0.1.6" : null),
    latestVersion: overrides.latestVersion ?? null,
    status,
    updateAvailable: overrides.updateAvailable ?? false,
    detectedVersion:
      overrides.detectedVersion ??
      (status === "available" ? (overrides.currentVersion ?? "0.1.6") : null),
    path: overrides.path ?? null,
    versionCommand: "tinyfish --version",
    installCommand:
      overrides.installCommand ??
      (status === "missing" ? "npm install -g @tiny-fish/cli@0.1.6" : null),
    updateCommand: overrides.updateCommand ?? null,
  };
}

function cliStatus(
  requirement: ExtensionCliRequirement,
  overrides: Partial<CliRequirementStatus> & Pick<CliRequirementStatus, "status">,
): CliRequirementStatus {
  const status = overrides.status;
  const defaultVersion = requirement.version ?? null;
  return {
    id: requirement.id,
    binary: requirement.binary,
    package: requirement.package ?? null,
    required: requirement.required,
    defaultVersion,
    currentVersion:
      overrides.currentVersion ??
      (status === "missing" ? defaultVersion : status === "available" ? defaultVersion : null),
    latestVersion: overrides.latestVersion ?? null,
    status,
    updateAvailable: overrides.updateAvailable ?? false,
    detectedVersion:
      overrides.detectedVersion ??
      (status === "available" ? (overrides.currentVersion ?? defaultVersion) : null),
    path: overrides.path ?? null,
    versionCommand: requirement.versionCommand ?? null,
    installCommand:
      overrides.installCommand ??
      (status === "missing" && requirement.installCommand
        ? requirement.installCommand.replaceAll("{{version}}", defaultVersion ?? "")
        : null),
    updateCommand: overrides.updateCommand ?? null,
  };
}

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "svvy-extensions-command-"));
  tempDirs.push(dir);
  return dir;
}

function createMemoryExtensionSecretStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: ({ extensionId, name }: { extensionId: string; name: string }) =>
      values.get(`${extensionId}:${name}`),
    has: ({ extensionId, name }: { extensionId: string; name: string }) =>
      values.has(`${extensionId}:${name}`),
    set: ({ extensionId, name }: { extensionId: string; name: string }, value: string) => {
      values.set(`${extensionId}:${name}`, value);
    },
    remove: ({ extensionId, name }: { extensionId: string; name: string }) => {
      values.delete(`${extensionId}:${name}`);
    },
  };
}

function createInstallingDependencyInstaller(
  calls: Array<Parameters<SvvyxExtensionsDependencyInstaller>[0]>,
): SvvyxExtensionsDependencyInstaller {
  return async (input) => {
    calls.push({
      dependencies: input.dependencies.map((dependency) => ({ ...dependency })),
      packageProject: input.packageProject,
      trustedDependencies: input.trustedDependencies.map((dependency) => ({ ...dependency })),
    });
    for (const dependency of [...input.dependencies, ...input.trustedDependencies]) {
      const packageRoot = join(input.packageProject, "node_modules", ...dependency.name.split("/"));
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, "package.json"),
        JSON.stringify({ name: dependency.name, version: dependency.version }, null, 2) + "\n",
      );
    }
    return {
      ok: true,
      command: [
        "fake-bun",
        "install",
        ...(input.trustedDependencies.length === 0 ? ["--ignore-scripts"] : []),
      ],
      packageProject: input.packageProject,
    };
  };
}

function readSnapshotTextFiles(root: string): string[] {
  const contents: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      contents.push(...readSnapshotTextFiles(path));
    } else if (entry.isFile()) {
      contents.push(readFileSync(path, "utf8"));
    }
  }
  return contents;
}

async function createNotesExtension(extensionsRoot: string): Promise<void> {
  await createNotesExtensionAtId(extensionsRoot, "notes");
}

async function createNotesExtensionAtId(extensionsRoot: string, id: string): Promise<void> {
  await runSvvyxExtensionsCommand({
    command: `svvyx extensions create --id ${id} --title "Notes" --description "Project notes." --interface instructions --json`,
    extensionsRoot,
  });
}

async function createLinearExtension(extensionsRoot: string): Promise<void> {
  await runSvvyxExtensionsCommand({
    command:
      'svvyx extensions create --id linear --title "Linear" --description "Linear issue workflow." --interface svvyx --typescript-api true --json',
    extensionsRoot,
  });
}

function updateUserManifest(sourceRoot: string, patch: Record<string, unknown>): void {
  const manifestPath = join(sourceRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete manifest[key];
    } else {
      manifest[key] = value;
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

function listBuildStagingDirs(extensionsRoot: string, extensionId: string): string[] {
  const stagingRoot = join(extensionsRoot, "builds", "extensions", extensionId, "staging");
  if (!existsSync(stagingRoot)) {
    return [];
  }
  return readdirSync(stagingRoot).toSorted((left, right) => left.localeCompare(right));
}

function pathIsInside(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("/"));
}

function writeExecutable(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected command to fail.");
}
