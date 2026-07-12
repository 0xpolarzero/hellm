import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as Effect from "effect/Effect";
import {
  createAgentProfileMutationStore,
  type AgentProfileAuthoritySnapshot,
  type AgentProfileMutationStore,
} from "./agent-profile-mutation-store";
import { runtimeExtensionContextImpactStateFacadeFromStore } from "@svvy/state/structured-session-adapters";
import { createStructuredSessionStateStore } from "@svvy/state/structured-session-state";
import { createSvvyDirectTools } from "./svvy-direct-tools";
import {
  assertExtensionEnvOverrideTarget,
  assertExtensionEnvSecretTarget,
  assertExtensionEnvWriteValue,
  formatSvvyxExtensionsError,
  resolveExtensionRecord,
  runSvvyxExtensionsCommand as runSvvyxExtensionsCommandWithoutTestAuthority,
} from "./svvyx-extensions-command";
import {
  formatSvvyxRuntimeError,
  redactStructuredData,
  runSvvyxRuntimeCommand,
  runSvvyxRuntimeGeneratedClientCommand as runSvvyxRuntimeGeneratedClientCommandWithCurrentBuild,
  type SvvyxRuntimeExtensionPlan,
} from "./svvyx-runtime-command";
import type {
  AgentProfileId,
  ExtensionUsageState,
  NativeToolResult,
  WorkspaceId,
} from "@svvy/core";
import { finalizeExtensionSourceMutation, layerExtensionSourceRootsPort } from "@svvy/extensions";
import { createPackageBackedExtensionLifecycleAdapter } from "./extension-lifecycle-authority";
import { resolvePackagedExtensionTemplatesRoot } from "./packaged-extension-templates";

const tempDirs: string[] = [];
const runtimeFixturePlans = new Map<string, SvvyxRuntimeExtensionPlan>();
const TEST_ORCHESTRATOR_AGENT_PROFILE_ID = "default-orchestrator" as AgentProfileId;
const TEST_PROFILE_TIMESTAMP = "2026-06-09T00:00:00.000Z";

type TestAgentProfileFixtureInput = {
  actorDefaults?: Partial<
    Record<
      "orchestrator" | "workflow-task",
      {
        extensionUsage?: Record<string, ExtensionUsageState>;
        extensionOrder?: string[];
      }
    >
  >;
  additionalOrchestrators?: Array<{
    id: string;
    name: string;
    extensionUsage?: Record<string, ExtensionUsageState>;
  }>;
  orchestratorExtensionUsage?: Record<string, ExtensionUsageState>;
  threadHandlerExtensionUsage?: Record<string, ExtensionUsageState>;
  workflowOverrides?: Record<string, Record<string, ExtensionUsageState>>;
};

function createTestAgentProfileSnapshot(
  input: TestAgentProfileFixtureInput = {},
): AgentProfileAuthoritySnapshot {
  const configuredProfiles = [
    {
      profileId: "thread-handler",
      actor: "handler" as const,
      name: "Thread handler",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      reasoning: { effort: "medium" },
      followComposer: false,
      extensionUsage: input.threadHandlerExtensionUsage ?? {},
      extensionOrder: [],
      position: 0,
      updatedAt: TEST_PROFILE_TIMESTAMP,
      builtin: true,
      locked: true,
      deletable: false,
    },
    {
      profileId: "default-orchestrator",
      actor: "orchestrator" as const,
      name: "Default orchestrator",
      providerId: "openai",
      modelId: "gpt-5.4",
      reasoning: { effort: "medium" },
      followComposer: false,
      extensionUsage: input.orchestratorExtensionUsage ?? {},
      extensionOrder: [],
      position: 0,
      updatedAt: TEST_PROFILE_TIMESTAMP,
      builtin: true,
      locked: true,
      deletable: false,
    },
    ...(input.additionalOrchestrators ?? []).map((profile, position) => ({
      profileId: profile.id,
      actor: "orchestrator" as const,
      name: profile.name,
      providerId: "openai",
      modelId: "gpt-5.4",
      reasoning: { effort: "medium" },
      followComposer: false,
      extensionUsage: profile.extensionUsage ?? {},
      extensionOrder: [],
      position: position + 1,
      updatedAt: TEST_PROFILE_TIMESTAMP,
      builtin: false,
      locked: false,
      deletable: true,
    })),
  ];
  const workflowAgents = ["explorer", "implementer", "reviewer"].map((sourceId) => ({
    sourceId,
    path: `/test/workflows/agents/${sourceId}.agent.json`,
    sourceVersion: `sha256:${sourceId}:v1`,
    fingerprint: `sha256:${sourceId}:v1`,
    validationStatus: "valid" as const,
    diagnostics: [],
    parameters: {
      id: sourceId,
      label: sourceId[0]!.toUpperCase() + sourceId.slice(1),
      provider: "openai",
      model: "gpt-5.4-mini",
      reasoning: { effort: "medium" },
      instructions: `Act as the ${sourceId}.`,
      overrides: input.workflowOverrides?.[sourceId] ?? {},
    },
    extensionOrder: [],
    observedAt: TEST_PROFILE_TIMESTAMP,
    updatedAt: TEST_PROFILE_TIMESTAMP,
    builtin: true,
    deletable: false,
  }));
  return {
    configuredProfiles,
    workflowAgents,
    actorExtensionDefaults: (["orchestrator", "workflow-task"] as const).map((actor) => ({
      actor,
      extensionUsage: input.actorDefaults?.[actor]?.extensionUsage ?? {},
      extensionOrder: input.actorDefaults?.[actor]?.extensionOrder ?? [],
      updatedAt: TEST_PROFILE_TIMESTAMP,
    })),
  } as unknown as AgentProfileAuthoritySnapshot;
}

function createTestAgentProfileStore(
  input: TestAgentProfileFixtureInput = {},
): AgentProfileMutationStore {
  return createAgentProfileMutationStore({
    snapshot: createTestAgentProfileSnapshot(input),
    networkAccess: true,
  });
}

function runSvvyxExtensionsCommand(
  input: Omit<Parameters<typeof runSvvyxExtensionsCommandWithoutTestAuthority>[0], "lifecycle"> &
    Partial<Pick<Parameters<typeof runSvvyxExtensionsCommandWithoutTestAuthority>[0], "lifecycle">>,
): ReturnType<typeof runSvvyxExtensionsCommandWithoutTestAuthority> {
  const extensionsRoot = input.extensionsRoot ?? createTempDir();
  return runSvvyxExtensionsCommandWithoutTestAuthority({
    ...input,
    agentProfileStore: input.agentProfileStore ?? createTestAgentProfileStore(),
    extensionsRoot,
    workspaceId: (input.workspaceId ?? "workspace-test") as WorkspaceId,
    lifecycle:
      input.lifecycle ??
      createPackageBackedExtensionLifecycleAdapter({
        extensionsRoot,
        onRuntimeEffectRequest: () => {},
        packagedExtensionTemplatesRoot: resolvePackagedExtensionTemplatesRoot({ cwd: input.cwd }),
      }),
  });
}

async function runSvvyxRuntimeGeneratedClientCommand(
  input: Parameters<typeof runSvvyxRuntimeGeneratedClientCommandWithCurrentBuild>[0],
): ReturnType<typeof runSvvyxRuntimeGeneratedClientCommandWithCurrentBuild> {
  const currentRoot = join(
    input.extensionsRoot!,
    "builds",
    "extensions",
    input.extensionId,
    "current",
  );
  const raw = JSON.parse(readFileSync(join(currentRoot, "manifest.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const existingPlan = runtimeFixturePlans.get(currentRoot);
  if (raw.interfaceKind === "svvyx" && existingPlan) {
    return runSvvyxRuntimeGeneratedClientCommandWithCurrentBuild({
      ...input,
      extensionRuntimePlans: [existingPlan],
    });
  }
  const legacy = raw as unknown as {
    module: string;
    commandManifest: unknown;
    env: Array<{
      name: string;
      required: boolean;
      secret: boolean;
      description: string;
      default?: string;
    }>;
    dependencies: Array<{
      kind: "dependency" | "trusted_dependency";
      name: string;
      version: string;
    }>;
  };
  const commandText = `${JSON.stringify(legacy.commandManifest, null, 2)}\n`;
  writeFileSync(join(currentRoot, "commands.json"), commandText);
  const evidence = [
    { role: "runtime-module" as const, relativePath: legacy.module },
    { role: "command-manifest" as const, relativePath: "commands.json" },
  ].map((file) => {
    const bytes = readFileSync(join(currentRoot, file.relativePath));
    return {
      ...file,
      contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      byteSize: bytes.byteLength,
    };
  });
  const sourceFingerprint = `sha256:${"1".repeat(64)}`;
  writeFileSync(
    join(currentRoot, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      buildId: `extension-build:${input.extensionId}:${"2".repeat(64)}`,
      extensionId: input.extensionId,
      interfaceKind: "svvyx",
      sourceFingerprint,
      contextFingerprint: `sha256:${"3".repeat(64)}`,
      outputFingerprint: `sha256:${"4".repeat(64)}`,
      contextReady: true,
      generatedFiles: evidence,
      builtAt: "2026-07-12T00:00:00.000Z",
    })}\n`,
  );
  const plan: SvvyxRuntimeExtensionPlan = {
    extensionId: input.extensionId,
    interfaceKind: "svvyx",
    sourceFingerprint,
    env: legacy.env.map((entry) => ({
      name: entry.name,
      required: entry.required,
      secret: entry.secret,
      description: entry.description,
      hasDefault: entry.default !== undefined,
    })),
    dependencies: legacy.dependencies,
  };
  runtimeFixturePlans.set(currentRoot, plan);
  return runSvvyxRuntimeGeneratedClientCommandWithCurrentBuild({
    ...input,
    extensionRuntimePlans: [plan],
  });
}

function writeStrictRuntimeBuildFixture(input: { extensionId: string; extensionsRoot: string }): {
  currentRoot: string;
  plan: SvvyxRuntimeExtensionPlan;
} {
  const sourceFingerprint = `sha256:${"1".repeat(64)}`;
  const sourceRoot = join(input.extensionsRoot, "sources", "user", input.extensionId);
  const currentRoot = join(
    input.extensionsRoot,
    "builds",
    "extensions",
    input.extensionId,
    "current",
  );
  mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
  mkdirSync(join(currentRoot, "runtime"), { recursive: true });
  writeFileSync(
    join(sourceRoot, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      id: input.extensionId,
      title: input.extensionId,
      description: `${input.extensionId} extension`,
      interface: "svvyx",
      typescriptApiEnabled: true,
      instructionFiles: [],
    })}\n`,
  );
  writeFileSync(
    join(currentRoot, "runtime", "index.js"),
    [
      'import { Cli } from "incur";',
      `const cli = Cli.create(${JSON.stringify(input.extensionId)});`,
      'cli.command("ping", { run() { return { pong: true }; } });',
      "export default cli;",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(currentRoot, "commands.json"),
    `${JSON.stringify({
      version: "incur.v1",
      commands: [
        {
          name: "ping",
          schema: {
            output: {
              type: "object",
              properties: { pong: { type: "boolean" } },
              required: ["pong"],
            },
          },
        },
      ],
    })}\n`,
  );
  const generatedFiles = [
    { role: "runtime-module" as const, relativePath: "runtime/index.js" },
    { role: "command-manifest" as const, relativePath: "commands.json" },
  ].map((file) => {
    const bytes = readFileSync(join(currentRoot, file.relativePath));
    return {
      ...file,
      contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      byteSize: bytes.byteLength,
    };
  });
  writeFileSync(
    join(currentRoot, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      buildId: `extension-build:${input.extensionId}:${"2".repeat(64)}`,
      extensionId: input.extensionId,
      interfaceKind: "svvyx",
      sourceFingerprint,
      contextFingerprint: `sha256:${"3".repeat(64)}`,
      outputFingerprint: `sha256:${"4".repeat(64)}`,
      contextReady: true,
      generatedFiles,
      builtAt: "2026-07-12T00:00:00.000Z",
    })}\n`,
  );
  const repoNodeModules = join(process.cwd(), "node_modules");
  const rootNodeModules = join(input.extensionsRoot, "node_modules");
  if (!existsSync(rootNodeModules)) symlinkSync(repoNodeModules, rootNodeModules);
  return {
    currentRoot,
    plan: {
      extensionId: input.extensionId,
      interfaceKind: "svvyx",
      sourceFingerprint,
      env: [],
      dependencies: [],
    },
  };
}

async function retainLifecycleMutationForTest(
  extensionsRoot: string,
  mutationId: Parameters<typeof finalizeExtensionSourceMutation>[0],
): Promise<void> {
  await Effect.runPromise(
    finalizeExtensionSourceMutation(mutationId).pipe(
      Effect.provide(BunFileSystem.layer),
      Effect.provide(BunPath.layer),
      Effect.provide(
        layerExtensionSourceRootsPort({
          extensionsRoot: extensionsRoot as never,
          workflowsSourceRoot: extensionsRoot as never,
        }),
      ),
    ),
  );
}

function createSvvyDirectToolsForTest(
  options: Parameters<typeof createSvvyDirectTools>[0],
): ReturnType<typeof createSvvyDirectTools> {
  return createSvvyDirectTools({
    ...options,
    applyExtensionLifecycleRuntimeEffect:
      options.applyExtensionLifecycleRuntimeEffect ?? (async () => {}),
    managedSandbox: options.managedSandbox ?? false,
  });
}

function readTextBlock(result: Pick<NativeToolResult, "content">): string {
  const text = (result.content ?? []).find(
    (block): block is { readonly type: "text"; readonly text: string } => block.type === "text",
  )?.text;
  expect(text).toBeTruthy();
  return text!;
}

function parseExecStdoutJson(result: NativeToolResult): any {
  const details = result.details as unknown as Record<string, unknown> | undefined;
  const output =
    typeof details?.stdout === "string" && details.stdout.trim().length > 0
      ? details!.stdout
      : typeof details?.stderr === "string" && details.stderr.trim().length > 0
        ? details.stderr
        : readTextBlock(result);
  return JSON.parse(output);
}

afterEach(() => {
  runtimeFixturePlans.clear();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe("svvyx extensions command", () => {
  it("does not expose the unsupported standalone defaults command", async () => {
    await expect(
      runSvvyxExtensionsCommand({
        command: "svvyx extensions defaults reset-order --json",
      }),
    ).rejects.toMatchObject({ code: "unsupported_command" });
  });

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
    const instructionPath = join(sourceRoot, "instructions", "full", "010-linear.mdx");
    const minimalPath = join(sourceRoot, "instructions", "minimal.mdx");
    expect(output).toMatchObject({
      ok: true,
      receipt: {
        action: "created",
        extensionId: "linear",
        changed: true,
        mutationId: expect.stringMatching(/^extension-source-mutation:linear:/),
      },
    });
    expect(result.commandFacts).toMatchObject({
      extensionCreated: true,
      extensionId: "linear",
      extensionMutationId: output.receipt.mutationId,
    });
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toMatchObject({
      id: "linear",
      interface: "svvyx",
      typescriptApiEnabled: true,
      instructionFiles: [{ file: "010-linear.mdx", bypassed: false }],
    });
    expect(readFileSync(instructionPath, "utf8")).toBe("# Linear\n");
    expect(readFileSync(minimalPath, "utf8")).toBe("");
    expect(readFileSync(join(sourceRoot, "source", "index.ts"), "utf8")).toContain(
      "export default cli;",
    );
  });

  it("creates an instructions-only user extension without executable source", async () => {
    const extensionsRoot = createTempDir();
    const result = await runSvvyxExtensionsCommand({
      command:
        'svvyx extensions create --id notes --title "Notes" --description "Project notes." --interface instructions --json',
      extensionsRoot,
    });
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    expect(result.output).toMatchObject({
      ok: true,
      receipt: { action: "created", extensionId: "notes", changed: true },
    });
    expect(existsSync(join(sourceRoot, "source"))).toBe(false);
    expect(JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8"))).toMatchObject({
      id: "notes",
      interface: "instructions",
      typescriptApiEnabled: false,
      instructionFiles: [{ file: "010-notes.mdx", bypassed: false }],
    });
  });

  it("defaults Extension Managing storage to the app-global home config root", async () => {
    const cwd = createTempDir();
    const home = createTempDir();
    const modulePath = join(process.cwd(), "src", "bun", "svvyx-extensions-command.ts");
    const lifecycleModulePath = join(
      process.cwd(),
      "src",
      "bun",
      "extension-lifecycle-authority.ts",
    );
    const templatesModulePath = join(
      process.cwd(),
      "src",
      "bun",
      "packaged-extension-templates.ts",
    );
    const extensionsRoot = join(home, ".config", "svvy", "extensions");
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        [
          `const { runSvvyxExtensionsCommand } = await import(${JSON.stringify(modulePath)});`,
          `const { createPackageBackedExtensionLifecycleAdapter } = await import(${JSON.stringify(lifecycleModulePath)});`,
          `const { resolvePackagedExtensionTemplatesRoot } = await import(${JSON.stringify(templatesModulePath)});`,
          `const extensionsRoot = ${JSON.stringify(extensionsRoot)};`,
          "const result = await runSvvyxExtensionsCommand({",
          '  command: \'svvyx extensions create --id scratch --title "Scratch" --description "Scratch extension." --interface instructions --json\',',
          `  cwd: ${JSON.stringify(cwd)},`,
          "  extensionsRoot,",
          "  lifecycle: createPackageBackedExtensionLifecycleAdapter({ extensionsRoot, onRuntimeEffectRequest: () => {}, packagedExtensionTemplatesRoot: resolvePackagedExtensionTemplatesRoot() }),",
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
    expect(result).toMatchObject({
      ok: true,
      receipt: { action: "created", extensionId: "scratch", changed: true },
    });
    expect(existsSync(join(extensionsRoot, "sources", "user", "scratch", "manifest.json"))).toBe(
      true,
    );
    expect(existsSync(join(cwd, "sources"))).toBe(false);
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
    expect(result.details!).toMatchObject({
      stdout: "",
      exitCode: 127,
    });
    expect(text).not.toContain("leaked");
  });

  it("dispatches a verified current Runtime build through the signed exec_command path", async () => {
    const cwd = createTempDir();
    const extensionsRoot = createTempDir();
    const extensionId = "dispatch-proof";
    const { plan } = writeStrictRuntimeBuildFixture({ extensionId, extensionsRoot });
    const execTool = createSvvyDirectToolsForTest({
      cwd,
      extensionsRoot,
      extensionsRuntimePlans: () => [plan],
    }).codingTools.find((candidate) => candidate.name === "exec_command");
    if (!execTool) throw new Error("exec_command tool missing.");

    const result = await execTool.execute(
      "tool-extension-runtime-current-build",
      { cmd: `svvyx ${extensionId} ping` },
      new AbortController().signal,
      () => {},
    );
    const output = parseExecStdoutJson(result);

    expect(output).toMatchObject({
      ok: true,
      extensionId,
      argv: ["ping"],
      exitCode: 0,
    });
    expect(output.stdout).toContain("pong");
  });

  it("rejects stale plans and tampered generated-file evidence before Runtime dispatch", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "dispatch-evidence";
    const { currentRoot, plan } = writeStrictRuntimeBuildFixture({ extensionId, extensionsRoot });

    expect(
      formatSvvyxRuntimeError(
        await runSvvyxRuntimeCommand({
          command: `svvyx ${extensionId} ping`,
          extensionsRoot,
          extensionRuntimePlans: [{ ...plan, sourceFingerprint: `sha256:${"9".repeat(64)}` }],
        }).catch((error) => error),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "stale_current_build",
        message: `${extensionId} current build does not match the committed extension plan.`,
      },
    });

    writeFileSync(join(currentRoot, "runtime", "index.js"), "export default null;\n");
    expect(
      formatSvvyxRuntimeError(
        await runSvvyxRuntimeCommand({
          command: `svvyx ${extensionId} ping`,
          extensionsRoot,
          extensionRuntimePlans: [plan],
        }).catch((error) => error),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_current_build",
        message: `${extensionId} build evidence is invalid.`,
      },
    });
  });

  it("manages user full instruction files without editing body text", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);

    const add = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-domain-guide.mdx --json",
      extensionsRoot,
    });
    const addOutput = add.output as any;
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    const domainPath = join(sourceRoot, "instructions", "full", "020-domain-guide.mdx");
    expect(addOutput).toMatchObject({
      ok: true,
      receipt: {
        action: "instruction-added",
        extensionId: "notes",
        name: "020-domain-guide.mdx",
        changed: true,
        mutationId: expect.stringMatching(/^extension-source-mutation:notes:/),
      },
    });
    expect(readFileSync(domainPath, "utf8")).toBe("");

    const rename = await runSvvyxExtensionsCommand({
      command:
        "svvyx extensions instructions rename notes --from 020-domain-guide.mdx --to 030-domain-guide.mdx --json",
      extensionsRoot,
    });
    expect(rename.output).toMatchObject({
      ok: true,
      receipt: {
        action: "instruction-renamed",
        extensionId: "notes",
        from: "020-domain-guide.mdx",
        to: "030-domain-guide.mdx",
        changed: true,
      },
    });
    expect(existsSync(domainPath)).toBe(false);

    const configure = await runSvvyxExtensionsCommand({
      command:
        "svvyx extensions instructions configure notes --file 030-domain-guide.mdx --bypassed true --json",
      extensionsRoot,
    });
    expect(configure.output).toMatchObject({
      ok: true,
      receipt: {
        action: "instruction-configured",
        extensionId: "notes",
        name: "030-domain-guide.mdx",
        bypassed: true,
        changed: true,
      },
    });
    expect(
      JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8")).instructionFiles,
    ).toEqual([
      {
        file: "010-notes.mdx",
        bypassed: false,
      },
      {
        file: "030-domain-guide.mdx",
        bypassed: true,
      },
    ]);

    const idempotentConfigure = await runSvvyxExtensionsCommand({
      command:
        "svvyx extensions instructions configure notes --file 030-domain-guide.mdx --bypassed true --json",
      extensionsRoot,
    });
    expect(idempotentConfigure.output).toMatchObject({
      ok: true,
      receipt: {
        action: "instruction-configured",
        name: "030-domain-guide.mdx",
        bypassed: true,
        changed: false,
        mutationId: null,
      },
    });

    const remove = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions remove notes --name 030-domain-guide.mdx --json",
      extensionsRoot,
    });
    expect(remove.output).toMatchObject({
      ok: true,
      receipt: {
        action: "instruction-removed",
        extensionId: "notes",
        name: "030-domain-guide.mdx",
        changed: true,
      },
    });
    expect(existsSync(join(sourceRoot, "instructions", "full", "030-domain-guide.mdx"))).toBe(
      false,
    );
  });

  it("reverts recorded instruction lifecycle changes exactly", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    const fullDir = join(sourceRoot, "instructions", "full");

    const add = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-domain-guide.mdx --json",
      extensionsRoot,
    });
    const changeId = (add.output as any).receipt.mutationId;
    await retainLifecycleMutationForTest(extensionsRoot, changeId);
    await retainLifecycleMutationForTest(extensionsRoot, changeId);
    writeFileSync(join(fullDir, "020-domain-guide.mdx"), "domain body\n");

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
        message: "Extension source changed after the target lifecycle mutation.",
      },
    });
    expect(readFileSync(join(fullDir, "020-domain-guide.mdx"), "utf8")).toBe("domain body\n");
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(
      false,
    );

    writeFileSync(join(fullDir, "020-domain-guide.mdx"), "");
    const revert = await runSvvyxExtensionsCommand({
      command: `svvyx extensions revert ${changeId} --json`,
      extensionsRoot,
    });
    expect(revert.output).toMatchObject({
      ok: true,
      receipt: {
        action: "mutation-reverted",
        revertedMutationId: changeId,
        extensionId: "notes",
        mutationId: expect.stringMatching(/^extension-source-mutation:notes:/),
        changed: true,
      },
      automaticBuild: {
        status: "not-started",
        failureReason: "unknown",
      },
    });
    expect(revert.commandFacts).toMatchObject({
      extensionReverted: true,
      extensionId: "notes",
      revertedExtensionMutationId: changeId,
      extensionMutationId: (revert.output as any).receipt.mutationId,
      automaticBuildStatus: "not-started",
    });
    expect(existsSync(join(fullDir, "020-domain-guide.mdx"))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8")).instructionFiles,
    ).toEqual([
      {
        file: "010-notes.mdx",
        bypassed: false,
      },
    ]);

    const configure = await runSvvyxExtensionsCommand({
      command:
        "svvyx extensions instructions configure notes --file 010-notes.mdx --bypassed true --json",
      extensionsRoot,
    });
    const configureChangeId = (configure.output as any).receipt.mutationId;
    await retainLifecycleMutationForTest(extensionsRoot, configureChangeId);
    const configureRevert = await runSvvyxExtensionsCommand({
      command: `svvyx extensions revert ${configureChangeId} --json`,
      extensionsRoot,
    });
    expect(configureRevert.output).toMatchObject({
      ok: true,
      receipt: {
        action: "mutation-reverted",
        revertedMutationId: configureChangeId,
        extensionId: "notes",
        changed: true,
      },
    });
    expect(
      JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8")).instructionFiles,
    ).toEqual([
      {
        file: "010-notes.mdx",
        bypassed: false,
      },
    ]);
  });

  it("leaves package-backed revert build validation to Runtime authority", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    updateUserManifest(sourceRoot, {
      dependencies: {
        "@notes/sdk": "^1.2.3",
      },
    });

    const add = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-domain-guide.mdx --json",
      extensionsRoot,
    });
    const changeId = (add.output as any).receipt.mutationId;
    await retainLifecycleMutationForTest(extensionsRoot, changeId);

    const revert = await runSvvyxExtensionsCommand({
      command: `svvyx extensions revert ${changeId} --json`,
      extensionsRoot,
    });

    expect(revert.output).toMatchObject({
      ok: true,
      receipt: {
        action: "mutation-reverted",
        revertedMutationId: changeId,
        extensionId: "notes",
        changed: true,
      },
      automaticBuild: {
        status: "not-started",
        failureReason: "unknown",
      },
    });
    expect(revert.commandFacts).toMatchObject({
      extensionReverted: true,
      automaticBuildStatus: "not-started",
    });
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "notes", "current"))).toBe(
      false,
    );
  });

  it("defers missing-env readiness to Runtime after package-backed revert", async () => {
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
      orchestratorAgentProfileId: TEST_ORCHESTRATOR_AGENT_PROFILE_ID,
      messageCount: 0,
      status: "idle",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    });

    const add = await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-domain-guide.mdx --json",
      extensionsRoot,
    });
    const changeId = (add.output as any).receipt.mutationId;
    await retainLifecycleMutationForTest(extensionsRoot, changeId);
    const revert = await runSvvyxExtensionsCommand({
      command: `svvyx extensions revert ${changeId} --json`,
      extensionsRoot,
      extensionContextImpactState:
        runtimeExtensionContextImpactStateFacadeFromStore(structuredSessionStore),
    });

    expect(revert.output).toMatchObject({
      ok: true,
      receipt: {
        action: "mutation-reverted",
        revertedMutationId: changeId,
        extensionId: "notes",
      },
      automaticBuild: {
        status: "not-started",
        failureReason: "unknown",
      },
    });
    expect(
      structuredSessionStore.listQueuedSurfaceMessages({
        surfacePiSessionId: "session-revert-missing-env",
      }),
    ).toEqual([]);
    structuredSessionStore.close();
  });

  it("rejects invalid materialized builtin source without rewriting it", async () => {
    const extensionsRoot = createTempDir();
    await materializeBuiltinSourceForTest(extensionsRoot, "base-common");
    const sourceRoot = join(extensionsRoot, "sources", "builtin", "base-common");
    const manifestPath = join(sourceRoot, "manifest.json");
    const invalidManifest = {
      ...JSON.parse(readFileSync(manifestPath, "utf8")),
      interface: "svvyx",
    };
    const invalidBytes = `${JSON.stringify(invalidManifest, null, 2)}\n`;
    writeFileSync(manifestPath, invalidBytes);

    expect(() => resolveExtensionRecord("base-common", extensionsRoot)).toThrow(
      "Builtin source interface must match packaged extension: base-common",
    );
    expect(readFileSync(manifestPath, "utf8")).toBe(invalidBytes);
    expect(
      existsSync(
        join(extensionsRoot, "builds", "extensions", "base-common", "current", "manifest.json"),
      ),
    ).toBe(false);
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
        code: "internal_error",
        message: "Only builtin extensions can be reset.",
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

  it("rejects non-user delete and delete revert collisions", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const deleted = await runSvvyxExtensionsCommand({
      command: "svvyx extensions delete notes --json",
      extensionsRoot,
    });
    const mutationId = (deleted.output as any).receipt.mutationId as Parameters<
      typeof retainLifecycleMutationForTest
    >[1];
    await retainLifecycleMutationForTest(extensionsRoot, mutationId);
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
            command: `svvyx extensions revert ${mutationId} --json`,
            extensionsRoot,
          }),
        ),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "internal_error",
        message: `Extension source already exists and blocks delete revert: ${sourceRoot}`,
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
        code: "internal_error",
        message: "Only user extensions can be deleted.",
      },
    });
  });

  it("redacts exact secret values from generated runtime facade result data and error data", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "test-secret";
    const sourceRoot = join(extensionsRoot, "sources", "user", extensionId);
    const currentRoot = join(extensionsRoot, "builds", "extensions", extensionId, "current");
    const generatedRoot = join(extensionsRoot, "generated", "extensions", extensionId);
    mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
    mkdirSync(join(currentRoot, "source"), { recursive: true });
    mkdirSync(generatedRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "instructions", "full", "010-main.mdx"), "# Main\n");
    writeFileSync(join(sourceRoot, "instructions", "minimal.mdx"), "");
    writeFileSync(
      join(sourceRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: extensionId,
        title: extensionId,
        description: `${extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [{ file: "010-main.mdx", bypassed: false }],
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
      {
        name: "SECRET_TOKEN",
        required: true,
        secret: true,
        description: "Secret token.",
        hasDefault: false,
      },
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
      {
        name: "SECRET_TOKEN",
        required: true,
        secret: true,
        description: "Secret token.",
        hasDefault: false,
      },
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

  it("reorders user instructions with deterministic numeric prefixes and preserved content", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
    const fullDir = join(sourceRoot, "instructions", "full");
    writeFileSync(join(fullDir, "020-client.mdx"), "client body\n");
    writeFileSync(join(fullDir, "030-domain-guide.mdx"), "domain body\n");
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
              file: "010-notes.mdx",
              bypassed: false,
            },
            {
              file: "020-client.mdx",
              bypassed: false,
            },
            {
              file: "030-domain-guide.mdx",
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
        "svvyx extensions instructions reorder notes --file 010-notes.mdx --file 030-domain-guide.mdx --file 020-client.mdx --json",
      extensionsRoot,
    });
    expect(reorder.output).toMatchObject({
      ok: true,
      receipt: {
        action: "instructions-reordered",
        extensionId: "notes",
        order: ["010-notes.mdx", "020-domain-guide.mdx", "030-client.mdx"],
        changed: true,
      },
    });
    expect(readFileSync(join(fullDir, "020-domain-guide.mdx"), "utf8")).toBe("domain body\n");
    expect(readFileSync(join(fullDir, "030-client.mdx"), "utf8")).toBe("client body\n");
    expect(
      JSON.parse(readFileSync(join(sourceRoot, "manifest.json"), "utf8")).instructionFiles,
    ).toEqual([
      {
        file: "010-notes.mdx",
        bypassed: false,
      },
      {
        file: "020-domain-guide.mdx",
        bypassed: true,
      },
      {
        file: "030-client.mdx",
        bypassed: false,
      },
    ]);
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
        envName: "LINEAR_TOKEN",
      }),
    ).not.toThrow();
    expect(
      formatSvvyxExtensionsError(
        await catchError(
          Promise.resolve().then(() =>
            assertExtensionEnvSecretTarget({
              extensionId: "linear",
              extensionsRoot,
              envName: "LINEAR_TEAM",
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
              envName: "LINEAR_UNKNOWN",
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
              envName: "LINEAR_TOKEN",
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
        envName: "LINEAR_TEAM",
      }),
    ).not.toThrow();
    expect(
      formatSvvyxExtensionsError(
        await catchError(
          Promise.resolve().then(() =>
            assertExtensionEnvOverrideTarget({
              extensionId: "linear",
              extensionsRoot,
              envName: "LINEAR_TOKEN",
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
              envName: "LINEAR_UNKNOWN",
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
              envName: "LINEAR_TEAM",
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

  it("rejects invalid instruction lifecycle names, order, config, and non-editable targets", async () => {
    const extensionsRoot = createTempDir();
    await createNotesExtension(extensionsRoot);
    await runSvvyxExtensionsCommand({
      command: "svvyx extensions instructions add notes --name 020-domain.mdx --json",
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
        command: "svvyx extensions instructions add notes --name 020-domain.mdx --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Instruction file already exists: 020-domain.mdx");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          "svvyx extensions instructions rename notes --from 020-domain.mdx --to 010-notes.mdx --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Instruction file already exists: 010-notes.mdx");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          "svvyx extensions instructions reorder notes --file 010-notes.mdx --file 010-notes.mdx --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Reorder must mention every editable instruction file exactly once.");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          "svvyx extensions instructions configure notes --file 020-domain.mdx --bypassed maybe --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("--bypassed must be true or false.");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          "svvyx extensions instructions configure notes --file 999-missing.mdx --bypassed true --json",
        extensionsRoot,
      }),
    ).rejects.toThrow("Instruction file does not exist: 999-missing.mdx");
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
    ).rejects.toThrow(
      "Generated instruction outputs are read-only and cannot be changed through instruction lifecycle commands.",
    );
    expect(existsSync(join(extensionsRoot, "sources", "builtin", "web"))).toBe(false);
    await expect(
      runSvvyxExtensionsCommand({
        command: "svvyx extensions instructions add shell --name 030-shell-extra.mdx --json",
        extensionsRoot,
      }),
    ).resolves.toMatchObject({
      output: {
        ok: true,
        receipt: {
          action: "instruction-added",
          extensionId: "shell",
          name: "030-shell-extra.mdx",
          changed: true,
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
          "030-shell-extra.mdx",
        ),
      ),
    ).toBe(true);
    await expect(
      runSvvyxExtensionsCommand({
        command:
          "svvyx extensions instructions add external_instruction:AGENTS.md:/repo/AGENTS.md --name 020-web.mdx --json",
        extensionsRoot,
      }),
    ).rejects.toThrow(
      "External instruction records are read-only and cannot be changed through instruction lifecycle commands.",
    );
  });

  it("rejects native, builtin, duplicate, reserved, and invalid create targets", async () => {
    const extensionsRoot = createTempDir();
    mkdirSync(join(extensionsRoot, "sources", "user", "linear"), { recursive: true });
    mkdirSync(join(extensionsRoot, ".svvy", "trash", "mutation-trashed"), {
      recursive: true,
    });
    mkdirSync(join(extensionsRoot, ".svvy", "trash", "mutation-deleted-manifest"), {
      recursive: true,
    });

    await expect(
      runSvvyxExtensionsCommand({
        command:
          'svvyx extensions create --id linear --title "Linear" --description "Linear." --interface svvyx --json',
        extensionsRoot,
      }),
    ).rejects.toThrow("Extension id already exists: linear");
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
    ).rejects.toThrow("Extension id remains reserved by trash: trashed");
    await expect(
      runSvvyxExtensionsCommand({
        command:
          'svvyx extensions create --id deleted-manifest --title "Deleted" --description "Deleted." --interface instructions --json',
        extensionsRoot,
      }),
    ).rejects.toThrow("Extension id remains reserved by trash: deleted-manifest");
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
    const text = (result.content ?? []).find(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )?.text;

    expect(text).toBeTruthy();
    expect(JSON.parse(text!)).toMatchObject({
      ok: true,
      receipt: {
        action: "created",
        extensionId: "linear",
        changed: true,
      },
    });
    expect(result.details?.commandFacts).toMatchObject({
      extensionCreated: true,
      extensionId: "linear",
      extensionMutationId: expect.stringMatching(/^extension-source-mutation:linear:/),
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

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "svvy-extensions-command-"));
  tempDirs.push(dir);
  return dir;
}

async function materializeBuiltinSourceForTest(
  extensionsRoot: string,
  extensionId: string,
): Promise<void> {
  const lifecycle = createPackageBackedExtensionLifecycleAdapter({
    extensionsRoot,
    onRuntimeEffectRequest: () => {},
    packagedExtensionTemplatesRoot: resolvePackagedExtensionTemplatesRoot(),
  });
  const added = await lifecycle.addInstruction({
    extensionId: extensionId as never,
    name: "999-test-materialization.mdx" as never,
  });
  await lifecycle.removeInstruction({
    extensionId: extensionId as never,
    name: added.name,
  });
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

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected command to fail.");
}
