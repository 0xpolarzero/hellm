import { afterEach, describe, expect, it } from "bun:test";
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

import {
  formatSvvyxRuntimeError,
  redactStructuredData,
  runSvvyxRuntimeCommand,
  runSvvyxRuntimeGeneratedClientCommand,
  type SvvyxRuntimeExtensionPlan,
} from "./svvyx-runtime-command";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe("svvyx runtime command", () => {
  it("rejects extension dispatch mixed with shell control syntax", async () => {
    const error = await runSvvyxRuntimeCommand({
      command: "svvyx linear --help && echo leaked",
      extensionsRoot: createTempDir(),
    }).catch((cause) => cause);

    expect(formatSvvyxRuntimeError(error)).toMatchObject({
      ok: false,
      error: {
        code: "invalid_argument",
        message: "svvyx extension commands must be invoked as a standalone command.",
      },
    });
  });

  it("dispatches a verified current Runtime build", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "dispatch-proof";
    const { plan } = writeRuntimeBuildFixture({ extensionId, extensionsRoot });

    const result = await runSvvyxRuntimeCommand({
      command: `svvyx ${extensionId} ping`,
      extensionsRoot,
      extensionRuntimePlans: [plan],
    });

    expect(result.output).toMatchObject({
      ok: true,
      extensionId,
      argv: ["ping"],
      exitCode: 0,
    });
    expect((result.output as { stdout: string }).stdout).toContain("pong");
    expect(result.commandFacts).toMatchObject({
      svvyxDispatch: true,
      extensionId,
      runtimeReady: true,
    });
  });

  it("rejects stale plans and tampered generated-file evidence before dispatch", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "dispatch-evidence";
    const { currentRoot, plan } = writeRuntimeBuildFixture({ extensionId, extensionsRoot });

    const staleError = await runSvvyxRuntimeCommand({
      command: `svvyx ${extensionId} ping`,
      extensionsRoot,
      extensionRuntimePlans: [{ ...plan, sourceFingerprint: `sha256:${"9".repeat(64)}` }],
    }).catch((cause) => cause);
    expect(formatSvvyxRuntimeError(staleError)).toMatchObject({
      ok: false,
      error: {
        code: "stale_current_build",
        message: `${extensionId} current build does not match the committed extension plan.`,
      },
      commandFacts: {
        errorCode: "stale_current_build",
        runtimeReady: false,
      },
    });

    writeFileSync(join(currentRoot, "runtime", "index.js"), "export default null;\n");
    const tamperedError = await runSvvyxRuntimeCommand({
      command: `svvyx ${extensionId} ping`,
      extensionsRoot,
      extensionRuntimePlans: [plan],
    }).catch((cause) => cause);
    expect(formatSvvyxRuntimeError(tamperedError)).toMatchObject({
      ok: false,
      error: {
        code: "invalid_current_build",
        message: `${extensionId} build evidence is invalid.`,
      },
      commandFacts: {
        currentBuildStatus: "invalid",
        runtimeReady: false,
      },
    });
  });

  it("rejects a verified build whose command manifest is invalid", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "invalid-manifest";
    const { plan } = writeRuntimeBuildFixture({
      commandManifest: { version: "not-incur", commands: [] },
      extensionId,
      extensionsRoot,
    });

    const error = await runSvvyxRuntimeCommand({
      command: `svvyx ${extensionId} ping`,
      extensionsRoot,
      extensionRuntimePlans: [plan],
    }).catch((cause) => cause);

    expect(formatSvvyxRuntimeError(error)).toMatchObject({
      ok: false,
      error: {
        code: "invalid_current_build",
        message: `${extensionId} current build command manifest is invalid.`,
      },
    });
  });

  it("rejects invalid generated facade command inputs", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "input-validation";
    const { plan } = writeRuntimeBuildFixture({
      commandManifest: generatedClientCommandManifest(),
      extensionId,
      extensionsRoot,
    });
    const base = {
      extensionId,
      extensionsRoot,
      extensionRuntimePlans: [plan],
    } as const;
    const cases: Array<{
      commandId: string;
      clientInput?: unknown;
      message: string;
    }> = [
      { commandId: "", message: "Missing command id." },
      { commandId: "missing", message: "Command missing not found in extension manifest." },
      { commandId: "test", clientInput: "bad", message: "Input must be an object." },
      {
        commandId: "test",
        clientInput: { selection: "bad" },
        message: "selection must be a non-empty string array.",
      },
      {
        commandId: "test",
        clientInput: { selection: [""] },
        message: "selection must be a non-empty string array.",
      },
      {
        commandId: "test",
        clientInput: { outputFormat: "xml" },
        message: "outputFormat must be one of: toon, json, yaml, md, jsonl.",
      },
      {
        commandId: "test",
        clientInput: { outputTokenLimit: -1 },
        message: "outputTokenLimit must be a non-negative integer.",
      },
      {
        commandId: "test",
        clientInput: { args: { unknown: true } },
        message: "Unsupported args key: unknown",
      },
      {
        commandId: "test",
        clientInput: { options: { unknown: true } },
        message: "Unsupported options key: unknown",
      },
      {
        commandId: "test",
        clientInput: { unexpected: true },
        message: "Unsupported generated runtime facade input key: unexpected",
      },
    ];

    for (const testCase of cases) {
      const error = await runSvvyxRuntimeGeneratedClientCommand({
        ...base,
        commandId: testCase.commandId,
        clientInput: testCase.clientInput,
      }).catch((cause) => cause);
      expect(formatSvvyxRuntimeError(error)).toMatchObject({
        ok: false,
        error: { code: "invalid_argument", message: testCase.message },
      });
    }
  });

  it("redacts exact secret values from generated facade result data", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "secret-result";
    const { plan } = writeRuntimeBuildFixture({
      commandManifest: generatedClientCommandManifest(),
      env: [
        {
          name: "SECRET_TOKEN",
          required: true,
          secret: true,
          description: "Secret token.",
          hasDefault: false,
        },
      ],
      extensionId,
      extensionsRoot,
      moduleSource: generatedClientModule(extensionId, "result"),
    });
    const secret = "super-secret-value";

    const result = (await runSvvyxRuntimeGeneratedClientCommand({
      commandId: "test",
      clientInput: { args: { input: "hello" } },
      envSecretStore: secretStore(secret),
      extensionId,
      extensionsRoot,
      extensionRuntimePlans: [plan],
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: true,
      data: { secret: "[REDACTED]", plain: "hello" },
      meta: {
        commandFacts: {
          extensionId,
          commandId: "test",
          runtimeReady: true,
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("redacts exact secret values from generated facade ClientErrors", async () => {
    const extensionsRoot = createTempDir();
    const extensionId = "secret-error";
    const { plan } = writeRuntimeBuildFixture({
      commandManifest: generatedClientCommandManifest(),
      env: [
        {
          name: "SECRET_TOKEN",
          required: true,
          secret: true,
          description: "Secret token.",
          hasDefault: false,
        },
      ],
      extensionId,
      extensionsRoot,
      moduleSource: generatedClientModule(extensionId, "error"),
    });
    const secret = "super-secret-value";

    const error = (await runSvvyxRuntimeGeneratedClientCommand({
      commandId: "test",
      clientInput: { args: { input: "hello" } },
      envSecretStore: secretStore(secret),
      extensionId,
      extensionsRoot,
      extensionRuntimePlans: [plan],
    }).catch((cause) => cause)) as Error & {
      data?: unknown;
      error?: unknown;
      fieldErrors?: unknown;
      shortMessage?: string;
    };

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("[REDACTED]");
    expect(error.message).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(error.data) ?? "").not.toContain(secret);
    expect(JSON.stringify(error.error) ?? "").not.toContain(secret);
    expect(JSON.stringify(error.fieldErrors) ?? "").not.toContain(secret);
    expect(error.shortMessage ?? "").not.toContain(secret);
  });

  it("redacts secret values recursively in structured output", () => {
    const secret = "super-secret-value";
    const result = redactStructuredData(
      {
        message: `failed with ${secret}`,
        data: { nested: { token: secret }, plain: "hello" },
        fieldErrors: [{ path: "token", message: secret }],
      },
      [
        {
          name: "SECRET_TOKEN",
          required: true,
          secret: true,
          description: "Secret token.",
          hasDefault: false,
        },
      ],
      { SECRET_TOKEN: secret },
    );

    expect(result).toEqual({
      message: "failed with [REDACTED]",
      data: { nested: { token: "[REDACTED]" }, plain: "hello" },
      fieldErrors: [{ path: "token", message: "[REDACTED]" }],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

function createTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "svvy-runtime-command-"));
  tempDirs.push(path);
  return path;
}

function writeRuntimeBuildFixture(input: {
  commandManifest?: unknown;
  env?: SvvyxRuntimeExtensionPlan["env"];
  extensionId: string;
  extensionsRoot: string;
  moduleSource?: string;
}): {
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
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(join(currentRoot, "runtime"), { recursive: true });
  writeFileSync(
    join(sourceRoot, "manifest.json"),
    `${JSON.stringify({ schemaVersion: 1, id: input.extensionId })}\n`,
  );
  writeFileSync(
    join(currentRoot, "runtime", "index.js"),
    input.moduleSource ??
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
    `${JSON.stringify(
      input.commandManifest ?? {
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
      },
    )}\n`,
  );
  const generatedFiles = [
    { role: "runtime-module" as const, relativePath: "runtime/index.js" },
    { role: "command-manifest" as const, relativePath: "commands.json" },
  ].map((file) => {
    const content = readFileSync(join(currentRoot, file.relativePath));
    return {
      ...file,
      contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      byteSize: content.byteLength,
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
      builtAt: "2026-07-13T00:00:00.000Z",
    })}\n`,
  );
  const nodeModules = join(input.extensionsRoot, "node_modules");
  if (!existsSync(nodeModules)) {
    symlinkSync(join(process.cwd(), "node_modules"), nodeModules);
  }
  return {
    currentRoot,
    plan: {
      extensionId: input.extensionId,
      interfaceKind: "svvyx",
      sourceFingerprint,
      env: input.env ?? [],
      dependencies: [],
    },
  };
}

function generatedClientCommandManifest(): unknown {
  return {
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
          options: {
            type: "object",
            properties: { verbose: { type: "boolean" } },
          },
          output: {
            type: "object",
            properties: { secret: { type: "string" }, plain: { type: "string" } },
          },
        },
      },
    ],
  };
}

function generatedClientModule(extensionId: string, behavior: "error" | "result"): string {
  return [
    'import { Cli, z } from "incur";',
    ...(behavior === "error" ? ['import { Client } from "incur/client";'] : []),
    `const cli = Cli.create(${JSON.stringify(extensionId)});`,
    'cli.command("test", {',
    "  args: z.object({ input: z.string() }),",
    "  options: z.object({ verbose: z.boolean().optional() }),",
    "  env: z.object({ SECRET_TOKEN: z.string() }),",
    "  run(c) {",
    ...(behavior === "error"
      ? [
          "    throw new Client.ClientError(`failed with ${c.env.SECRET_TOKEN}`, {",
          '      code: "VALIDATION_ERROR",',
          "      data: { nested: { token: c.env.SECRET_TOKEN } },",
          '      fieldErrors: [{ path: "token", message: c.env.SECRET_TOKEN }],',
          "    });",
        ]
      : ["    return { secret: c.env.SECRET_TOKEN, plain: c.args.input };"]),
    "  },",
    "});",
    "export default cli;",
    "",
  ].join("\n");
}

function secretStore(secret: string) {
  return {
    get: () => secret,
    has: () => true,
    set: () => undefined,
    remove: () => undefined,
  };
}
