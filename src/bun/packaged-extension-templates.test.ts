import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_EXTENSIONS, BUILTIN_EXTENSION_IDS } from "@svvy/extensions";
import { resolvePackagedExtensionTemplatesRoot } from "./packaged-extension-templates";

describe("packaged extension templates", () => {
  it("has one complete explicit template for every builtin id", () => {
    const root = join(import.meta.dir, "../../packages/extensions/src/builtin");
    expect(
      readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .toSorted(),
    ).toEqual([...BUILTIN_EXTENSION_IDS].toSorted());
    for (const builtin of BUILTIN_EXTENSIONS) {
      const template = join(root, builtin.id);
      const manifest = JSON.parse(readFileSync(join(template, "manifest.json"), "utf8")) as {
        schemaVersion: number;
        id: string;
        interface: string;
        title: string;
        description: string;
        typescriptApiEnabled: boolean;
        instructionFiles: Array<{ file: string; bypassed: boolean }>;
      };
      expect(manifest).toMatchObject({
        schemaVersion: 1,
        id: builtin.id,
        interface: builtin.interface,
        title: builtin.title,
        description: builtin.description,
        typescriptApiEnabled: builtin.typescriptApiEnabled,
      });
      expect(readFileSync(join(template, "instructions/minimal.mdx"), "utf8").trim()).toBe(
        builtin.minimalLoadingHint,
      );
      expect(manifest.instructionFiles.some((entry) => entry.file.endsWith(".mdx"))).toBe(true);
      for (const instruction of manifest.instructionFiles) {
        expect(existsSync(join(template, "instructions/full", instruction.file))).toBe(true);
      }
    }
  });

  it("keeps generated outputs, local scripts, and pinned versions coherent", () => {
    const root = join(import.meta.dir, "../../packages/extensions/src/builtin");
    for (const id of ["cx", "web", "smithers"] as const) {
      const template = join(root, id);
      const manifest = JSON.parse(readFileSync(join(template, "manifest.json"), "utf8")) as {
        cliRequirements: Array<{ id: string; version?: string }>;
        generatedInstructions: Array<{
          output: string;
          script: string;
          versionCliRequirementId: string;
        }>;
      };
      for (const generated of manifest.generatedInstructions) {
        const requirement = manifest.cliRequirements.find(
          (item) => item.id === generated.versionCliRequirementId,
        );
        expect(requirement?.version).toBeTruthy();
        expect(existsSync(join(template, generated.output))).toBe(true);
        expect(readFileSync(join(template, generated.script), "utf8")).toContain(
          requirement!.version!,
        );
      }
    }
  });

  it("keeps app-native templates source-free", () => {
    const root = join(import.meta.dir, "../../packages/extensions/src/builtin");
    for (const id of ["extension-managing", "workflows", "artifacts"]) {
      expect(existsSync(join(root, id, "source/index.ts"))).toBe(false);
    }
  });

  it("postbuild copies the package-owned builtin tree into the app resource directory", async () => {
    const source = await Bun.file(`${import.meta.dir}/../../scripts/postbuild.ts`).text();
    expect(source).toContain('"packages", "extensions", "src", "builtin"');
    expect(source).toContain('"MacOS", "generated", "extensions", "builtin"');
    expect(source.match(/copyPackagedExtensionTemplates\(\);/g)).toHaveLength(2);
  });

  it("prefers the explicit app-owned resource root", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-packaged-extension-templates-"));
    const explicitRoot = join(root, "explicit");
    const packagedRoot = join(root, "MacOS", "generated", "extensions", "builtin");
    mkdirSync(explicitRoot, { recursive: true });
    mkdirSync(packagedRoot, { recursive: true });
    try {
      expect(
        resolvePackagedExtensionTemplatesRoot({
          explicitRoot,
          executablePath: join(root, "MacOS", "svvy"),
          moduleDirectory: join(root, "Resources", "app", "src", "bun"),
          cwd: root,
        }),
      ).toBe(explicitRoot as never);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("resolves the packaged-app resource beside the executable", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-packaged-extension-resource-"));
    const packagedRoot = join(root, "MacOS", "generated", "extensions", "builtin");
    mkdirSync(packagedRoot, { recursive: true });
    try {
      expect(
        resolvePackagedExtensionTemplatesRoot({
          executablePath: join(root, "MacOS", "svvy"),
          moduleDirectory: join(root, "Resources", "app", "src", "bun"),
          cwd: join(root, "workspace"),
        }),
      ).toBe(packagedRoot as never);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("resolves the packaged-app resource from the Linux bin launcher", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-packaged-extension-linux-resource-"));
    const packagedRoot = join(root, "MacOS", "generated", "extensions", "builtin");
    mkdirSync(packagedRoot, { recursive: true });
    try {
      expect(
        resolvePackagedExtensionTemplatesRoot({
          executablePath: join(root, "bin", "bun"),
          moduleDirectory: join(root, "Resources", "app", "bun"),
          cwd: join(root, "workspace"),
        }),
      ).toBe(packagedRoot as never);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("fails closed when neither packaged nor development assets exist", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-missing-extension-resource-"));
    try {
      expect(() =>
        resolvePackagedExtensionTemplatesRoot({
          executablePath: join(root, "MacOS", "svvy"),
          moduleDirectory: join(root, "Resources", "app", "src", "bun"),
          cwd: join(root, "workspace"),
        }),
      ).toThrow("Packaged extension templates are unavailable");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
