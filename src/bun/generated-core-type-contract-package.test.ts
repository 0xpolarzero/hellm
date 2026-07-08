import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  materializeGeneratedCoreTypeContractPackage,
  renderGeneratedCoreTypeContractPackageFiles,
} from "./generated-core-type-contract-package";

const tempDirs: string[] = [];

describe("generated core type-contract package", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { force: true, recursive: true });
      }
    }
  });

  it("renders a declaration-only @svvy/core package for workflow task-agent bridge types", () => {
    const files = renderGeneratedCoreTypeContractPackageFiles();
    const packageJson = JSON.parse(
      files.find((file) => file.relativePath === "package.json")?.contents ?? "{}",
    );
    const index = files.find((file) => file.relativePath === "index.d.ts")?.contents ?? "";

    expect(files.map((file) => file.relativePath).toSorted()).toEqual([
      "index.d.ts",
      "package.json",
    ]);
    expect(packageJson).toEqual({
      name: "@svvy/core",
      private: true,
      type: "module",
      types: "./index.d.ts",
      exports: {
        ".": {
          types: "./index.d.ts",
        },
      },
    });
    expect(index).toContain("export interface RunTaskAgentSourceInput");
    expect(index).toContain("export interface RunTaskAgentResult");
    expect(index).toContain("export type RunTaskAgentPromptSource");
    expect(index).toContain("export interface RunTaskAgentError");
    expect(index).not.toMatch(/\bimport\b|export\s+.*\s+from\b/);
    expect(index).not.toMatch(
      /\b(ExtensionId|WorkspaceId|RuntimeEffectRequest|ExtensionExecutionPlan|Context\.Service|Schema\.)\b/,
    );
    expect(packageJson).not.toHaveProperty("dependencies");
    expect(packageJson).not.toHaveProperty("devDependencies");
    expect(packageJson).not.toHaveProperty("peerDependencies");
    expect(packageJson).not.toHaveProperty("scripts");
  });

  it("materializes the package at the exact app-owned root", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-core-type-contract-"));
    tempDirs.push(root);
    const packageRoot = join(root, "contract-package");

    materializeGeneratedCoreTypeContractPackage(packageRoot);

    expect(existsSync(join(packageRoot, "package.json"))).toBe(true);
    expect(existsSync(join(packageRoot, "index.d.ts"))).toBe(true);
    expect(readFileSync(join(packageRoot, "index.d.ts"), "utf8")).toContain(
      "RunTaskAgentSourceInput",
    );
  });
});
