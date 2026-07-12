import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePackagedExtensionTemplatesRoot } from "./packaged-extension-templates";

describe("packaged extension templates", () => {
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
