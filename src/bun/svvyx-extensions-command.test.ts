import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertExtensionEnvOverrideTarget,
  assertExtensionEnvSecretTarget,
  assertExtensionEnvWriteValue,
  formatSvvyxExtensionsError,
  resolveExtensionRecord,
  resolveExtensionRecords,
  validateExtensionBuildInput,
} from "./svvyx-extensions-command";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe("Extension Managing record and env helpers", () => {
  it("resolves user source records without granting source mutation authority", () => {
    const extensionsRoot = createUserExtensionFixture();

    expect(resolveExtensionRecord("linear", extensionsRoot)).toMatchObject({
      id: "linear",
      category: "user",
      interface: "svvyx",
      title: "Linear",
      typescriptApiEnabled: true,
      envReadiness: "missing",
      sourceRoot: join(extensionsRoot, "sources", "user", "linear"),
    });
    expect(
      resolveExtensionRecords(["linear", "missing"], extensionsRoot).map(({ id }) => id),
    ).toEqual(["linear"]);
  });

  it("validates secret and non-secret env targets from resolved records", () => {
    const extensionsRoot = createUserExtensionFixture();

    expect(() =>
      assertExtensionEnvSecretTarget({
        extensionId: "linear",
        extensionsRoot,
        envName: "LINEAR_API_KEY",
      }),
    ).not.toThrow();
    expect(() =>
      assertExtensionEnvOverrideTarget({
        extensionId: "linear",
        extensionsRoot,
        envName: "LINEAR_API_BASE_URL",
      }),
    ).not.toThrow();
    expect(
      formatSvvyxExtensionsError(
        catchError(() =>
          assertExtensionEnvSecretTarget({
            extensionId: "linear",
            extensionsRoot,
            envName: "LINEAR_API_BASE_URL",
          }),
        ),
      ),
    ).toMatchObject({ error: { code: "extension_env_not_secret" } });
    expect(
      formatSvvyxExtensionsError(
        catchError(() =>
          assertExtensionEnvOverrideTarget({
            extensionId: "linear",
            extensionsRoot,
            envName: "LINEAR_API_KEY",
          }),
        ),
      ),
    ).toMatchObject({ error: { code: "extension_env_is_secret" } });
  });

  it("rejects empty app-managed env values", () => {
    expect(() => assertExtensionEnvWriteValue("token")).not.toThrow();
    expect(() => assertExtensionEnvWriteValue("   ")).toThrow("Extension env value is required.");
  });

  it("accepts a valid user extension build input", () => {
    const extensionsRoot = createUserExtensionFixture();
    const extension = resolveExtensionRecord("linear", extensionsRoot);
    expect(extension).not.toBeNull();

    expect(validateExtensionBuildInput(extension!, extensionsRoot)).toBeNull();
  });

  it("reports invalid instruction, dependency, env, and generated-instruction metadata", () => {
    const extensionsRoot = createUserExtensionFixture();
    const extension = resolveExtensionRecord("linear", extensionsRoot);
    expect(extension).not.toBeNull();
    const base = extension!;

    expect(
      validateExtensionBuildInput(
        { ...base, instructionFiles: [{ file: "missing.mdx", bypassed: false }] },
        extensionsRoot,
      ),
    ).toMatchObject({ error: { code: "INSTRUCTION_FILE_NOT_FOUND" } });
    expect(
      validateExtensionBuildInput(
        { ...base, dependencies: [{ kind: "dependency", name: "incur", version: "^0.2.0" }] },
        extensionsRoot,
      ),
    ).toMatchObject({ error: { code: "DEPENDENCY_VERSION_NOT_EXACT" } });
    expect(
      validateExtensionBuildInput(
        {
          ...base,
          envDeclarations: [
            {
              name: "SECRET_TOKEN",
              required: true,
              secret: true,
              description: "Secret token.",
              default: "must-not-be-stored",
            },
          ],
        },
        extensionsRoot,
      ),
    ).toMatchObject({ error: { code: "INVALID_EXTENSION_ENV" } });
    expect(
      validateExtensionBuildInput(
        {
          ...base,
          generatedInstructions: [
            {
              output: "../escaped.mdx",
              script: "scripts/generate.ts",
            },
          ],
        },
        extensionsRoot,
      ),
    ).toMatchObject({ error: { code: "INVALID_GENERATED_INSTRUCTION" } });
  });

  it("requires svvyx source to default-export without serving at module scope", () => {
    const extensionsRoot = createUserExtensionFixture();
    const extension = resolveExtensionRecord("linear", extensionsRoot);
    expect(extension).not.toBeNull();
    const sourcePath = join(extensionsRoot, "sources", "user", "linear", "source", "index.ts");

    writeFileSync(sourcePath, "export const cli = {};\n");
    expect(validateExtensionBuildInput(extension!, extensionsRoot)).toMatchObject({
      error: { code: "INVALID_EXTENSION_SOURCE" },
    });

    writeFileSync(
      sourcePath,
      [
        'import { Cli } from "incur";',
        'const cli = Cli.create("linear");',
        "cli.serve(process.argv.slice(2));",
        "export default cli;",
        "",
      ].join("\n"),
    );
    expect(validateExtensionBuildInput(extension!, extensionsRoot)).toMatchObject({
      error: {
        code: "INVALID_EXTENSION_SOURCE",
        message: "linear source must not call serve at top level.",
      },
    });
  });
});

function createUserExtensionFixture(): string {
  const extensionsRoot = mkdtempSync(join(tmpdir(), "svvy-extension-record-"));
  tempDirs.push(extensionsRoot);
  const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
  mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
  mkdirSync(join(sourceRoot, "source"), { recursive: true });
  writeFileSync(join(sourceRoot, "instructions", "full", "010-linear.mdx"), "# Linear\n");
  writeFileSync(join(sourceRoot, "instructions", "minimal.mdx"), "Linear integration.\n");
  writeFileSync(
    join(sourceRoot, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      id: "linear",
      title: "Linear",
      description: "Linear issue integration.",
      interface: "svvyx",
      typescriptApiEnabled: true,
      instructionFiles: [{ file: "010-linear.mdx", bypassed: false }],
      env: [
        {
          name: "LINEAR_API_KEY",
          required: true,
          secret: true,
          description: "Linear API key.",
        },
        {
          name: "LINEAR_API_BASE_URL",
          required: false,
          secret: false,
          description: "Linear API base URL.",
          default: "https://api.linear.app",
        },
      ],
    })}\n`,
  );
  writeFileSync(
    join(sourceRoot, "source", "index.ts"),
    [
      'import { Cli } from "incur";',
      'const cli = Cli.create("linear");',
      "export default cli;",
      "",
    ].join("\n"),
  );
  return extensionsRoot;
}

function catchError(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected helper to throw.");
}
