import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { writeGeneratedExtensionsPackage } from "./generated-extensions-package";

const tempDirs: string[] = [];

describe("generated extensions package", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { force: true, recursive: true });
      }
    }
  });

  it("writes the exact @svvyx/extensions package manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-generated-extensions-"));
    tempDirs.push(root);
    const packageRoot = join(root, "package");
    mkdirSync(packageRoot, { recursive: true });

    writeGeneratedExtensionsPackage(packageRoot, new Set(["git"]));

    expect(JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))).toEqual({
      name: "@svvyx/extensions",
      type: "module",
      exports: {
        ".": "./index.ts",
      },
    });
    expect(readFileSync(join(packageRoot, "index.ts"), "utf8")).toBe(
      [
        "export type ExtensionReference<Id extends string = string> = {",
        "  readonly id: Id;",
        "};",
        "",
        "export const Extensions = {",
        '  "git": {"id":"git"},',
        "} as const satisfies Record<string, ExtensionReference>;",
        "",
        'export type ExtensionId = (typeof Extensions)[keyof typeof Extensions]["id"];',
        "",
      ].join("\n"),
    );
  });

  it("emits extension references only, not execute_typescript generated TypeScript facades", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-generated-extensions-"));
    tempDirs.push(root);
    const packageRoot = join(root, "package");

    writeGeneratedExtensionsPackage(packageRoot, new Set(["artifacts", "workflows"]));

    const index = readFileSync(join(packageRoot, "index.ts"), "utf8");
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
    const root = mkdtempSync(join(tmpdir(), "svvy-generated-extensions-"));
    tempDirs.push(root);
    const packageRoot = join(root, "package");

    writeGeneratedExtensionsPackage(packageRoot, new Set(["linear-tools", "linear_tools"]));

    const index = readFileSync(join(packageRoot, "index.ts"), "utf8");
    expect(index).toContain('"linear-tools": {"id":"linear-tools"');
    expect(index).toContain('"linear_tools": {"id":"linear_tools"');
    expect(index).not.toContain("linearTools");
    expect(index).not.toContain("linearTools2");
  });
});
