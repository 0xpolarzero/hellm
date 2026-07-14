import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AbsolutePath, ExtensionBuildProcessPlan, ExtensionId } from "@svvy/core";
import { runExtensionBuildProcess } from "./extension-build-process";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("extension build process host", () => {
  it("stages static source outputs, runs generators sequentially, and returns byte evidence", async () => {
    const fixture = makeFixture();
    writeSource(fixture, "instructions/minimal.md", "minimal\n");
    writeSource(
      fixture,
      "scripts/first.ts",
      [
        'import { writeFileSync } from "node:fs";',
        'writeFileSync(process.argv[3]!, `first:${process.env.ALLOWED ?? "missing"}\\n`);',
      ].join("\n"),
    );
    writeSource(
      fixture,
      "scripts/second.ts",
      [
        'import { readFileSync, writeFileSync } from "node:fs";',
        'if (readFileSync(process.argv[4]!, "utf8") !== "first:yes\\n") process.exit(9);',
        'writeFileSync(process.argv[3]!, "second\\n");',
      ].join("\n"),
    );
    const first = join(fixture.stagingRoot, "instructions/full/first.md");
    const second = join(fixture.stagingRoot, "instructions/full/second.md");
    const evidence = await runExtensionBuildProcess(
      plan(fixture, {
        generators: [
          {
            scriptPath: join(fixture.sourceRoot, "scripts/first.ts") as AbsolutePath,
            outputPath: first as AbsolutePath,
            argv: ["--output", first],
          },
          {
            scriptPath: join(fixture.sourceRoot, "scripts/second.ts") as AbsolutePath,
            outputPath: second as AbsolutePath,
            argv: ["--output", second, first],
          },
        ],
        expectedProcessOutputs: [
          { role: "full-instruction", relativePath: "instructions/full/first.md" },
          { role: "full-instruction", relativePath: "instructions/full/second.md" },
        ],
      }),
      { executable: process.execPath, env: { ALLOWED: "yes" } },
    );

    expect(evidence.status).toBe("completed");
    if (evidence.status !== "completed") throw new Error("Expected completed evidence.");
    expect(evidence.exitCode).toBe(0);
    expect(evidence.stagedFiles.map(({ relativePath }) => relativePath)).toEqual([
      "instructions/full/first.md",
      "instructions/full/second.md",
    ]);
    expect(readFileSync(first, "utf8")).toBe("first:yes\n");
  });

  it("rejects missing, duplicate, and undeclared expected output inputs", async () => {
    const fixture = makeFixture();
    const output = join(fixture.stagingRoot, "generated.md") as AbsolutePath;
    writeSource(fixture, "generate.ts", 'await Bun.write(process.argv[3]!, "ok\\n");\n');
    const base = plan(fixture, {
      generators: [
        {
          scriptPath: join(fixture.sourceRoot, "generate.ts") as AbsolutePath,
          outputPath: output,
          argv: ["--output", output],
        },
      ],
      expectedProcessOutputs: [{ role: "full-instruction", relativePath: "other.md" }],
    });
    expect(await runExtensionBuildProcess(base, { executable: process.execPath, env: {} })).toEqual(
      {
        status: "failed",
        stage: "validation",
      },
    );
    expect(
      await runExtensionBuildProcess(
        plan(fixture, {
          expectedProcessOutputs: [
            { role: "minimal-instruction", relativePath: "missing.md" },
            { role: "full-instruction", relativePath: "missing.md" },
          ],
        }),
        { executable: process.execPath, env: {} },
      ),
    ).toEqual({ status: "failed", stage: "validation" });
  });

  it("rejects undeclared files left in the staging tree", async () => {
    const fixture = makeFixture();
    const output = join(fixture.stagingRoot, "generated.md") as AbsolutePath;
    writeSource(
      fixture,
      "generate.ts",
      'await Bun.write(process.argv[3]!, "ok\\n"); await Bun.write(`${process.argv[3]}.extra`, "undeclared\\n");\n',
    );
    expect(
      await runExtensionBuildProcess(
        plan(fixture, {
          generators: [
            {
              scriptPath: join(fixture.sourceRoot, "generate.ts") as AbsolutePath,
              outputPath: output,
              argv: ["--output", output],
            },
          ],
          expectedProcessOutputs: [{ role: "full-instruction", relativePath: "generated.md" }],
        }),
        { executable: process.execPath, env: {} },
      ),
    ).toEqual({ status: "failed", stage: "output-verification" });
  });

  it("accepts a staging root reached through a filesystem alias", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "svvy-extension-build-alias-")));
    tempDirs.push(root);
    const canonicalRoot = join(root, "canonical");
    const aliasedRoot = join(root, "alias");
    mkdirSync(canonicalRoot, { recursive: true });
    symlinkSync(canonicalRoot, aliasedRoot, "dir");
    const fixture = {
      sourceRoot: join(aliasedRoot, "source"),
      stagingRoot: join(aliasedRoot, "staging"),
    };
    mkdirSync(fixture.sourceRoot, { recursive: true });
    mkdirSync(fixture.stagingRoot, { recursive: true });
    writeSource(fixture, "generate.ts", 'await Bun.write(process.argv[3]!, "ok\\n");\n');
    const output = join(fixture.stagingRoot, "generated.md") as AbsolutePath;

    const evidence = await runExtensionBuildProcess(
      plan(fixture, {
        generators: [
          {
            scriptPath: join(fixture.sourceRoot, "generate.ts") as AbsolutePath,
            outputPath: output,
            argv: ["--output", output],
          },
        ],
        expectedProcessOutputs: [{ role: "full-instruction", relativePath: "generated.md" }],
      }),
      { executable: process.execPath, env: {} },
    );

    expect(evidence.status).toBe("completed");
    expect(readFileSync(output, "utf8")).toBe("ok\n");
  });

  it("caps aggregate output and times out the operation", async () => {
    const fixture = makeFixture();
    const output = join(fixture.stagingRoot, "generated.md") as AbsolutePath;
    writeSource(
      fixture,
      "generate.ts",
      'process.stdout.write("abcdefgh"); process.stderr.write("12345678"); await Bun.write(process.argv[3]!, "ok\\n");\n',
    );
    const completed = await runExtensionBuildProcess(
      plan(fixture, {
        generators: [
          {
            scriptPath: join(fixture.sourceRoot, "generate.ts") as AbsolutePath,
            outputPath: output,
            argv: ["--output", output],
          },
        ],
        expectedProcessOutputs: [{ role: "full-instruction", relativePath: "generated.md" }],
        maxStdoutBytes: 4,
        maxStderrBytes: 3,
      }),
      { executable: process.execPath, env: {} },
    );
    expect(completed).toMatchObject({
      status: "completed",
      stdout: "abcd",
      stderr: "123",
      stdoutTruncated: true,
      stderrTruncated: true,
    });

    writeSource(fixture, "slow.ts", "setInterval(() => {}, 1000);\n");
    expect(
      await runExtensionBuildProcess(
        plan(fixture, {
          generators: [
            {
              scriptPath: join(fixture.sourceRoot, "slow.ts") as AbsolutePath,
              outputPath: output,
              argv: ["--output", output],
            },
          ],
          expectedProcessOutputs: [{ role: "full-instruction", relativePath: "generated.md" }],
          timeoutMs: 20,
        }),
        { executable: process.execPath, env: {} },
      ),
    ).toEqual({ status: "timed-out" });
  });

  it("bundles a source svvyx runtime and extracts its bounded command manifest in the child", async () => {
    const fixture = makeFixture();
    writeSource(
      fixture,
      "source/index.ts",
      [
        'import { Cli, z } from "incur";',
        'const cli = Cli.create("demo");',
        'cli.command("echo", { options: z.object({ value: z.string() }), output: z.object({ value: z.string() }), run: ({ options }) => ({ value: options.value }) });',
        "export default cli;",
      ].join("\n"),
    );
    const runtimeOutputPath = join(fixture.stagingRoot, "runtime/index.js") as AbsolutePath;
    const evidence = await runExtensionBuildProcess(
      plan(fixture, {
        expectedProcessOutputs: [{ role: "runtime-module", relativePath: "runtime/index.js" }],
        svvyxRuntime: {
          sourcePath: join(fixture.sourceRoot, "source/index.ts") as AbsolutePath,
          runtimeOutputPath,
        },
      }),
      { executable: process.execPath, env: {} },
    );

    expect(evidence.status).toBe("completed");
    if (evidence.status !== "completed") throw new Error("Expected completed runtime build.");
    expect(evidence.commandManifest?.commands.map(({ name }) => name)).toEqual(["echo"]);
    expect(evidence.stagedFiles.map(({ relativePath }) => relativePath)).toEqual([
      "runtime/index.js",
    ]);
  });
});

function makeFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "svvy-extension-build-")));
  tempDirs.push(root);
  const sourceRoot = join(root, "source");
  const stagingRoot = join(root, "staging");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(stagingRoot, { recursive: true });
  return { sourceRoot, stagingRoot };
}

function writeSource(fixture: ReturnType<typeof makeFixture>, relativePath: string, text: string) {
  const path = join(fixture.sourceRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function plan(
  fixture: ReturnType<typeof makeFixture>,
  overrides: Partial<ExtensionBuildProcessPlan> = {},
): ExtensionBuildProcessPlan {
  return {
    extensionId: "test-extension" as ExtensionId,
    sourceRoot: fixture.sourceRoot as AbsolutePath,
    stagingRoot: fixture.stagingRoot as AbsolutePath,
    generators: [],
    expectedProcessOutputs: [],
    svvyxRuntime: null,
    timeoutMs: 1_000,
    maxStdoutBytes: 16_384,
    maxStderrBytes: 16_384,
    ...overrides,
  };
}
