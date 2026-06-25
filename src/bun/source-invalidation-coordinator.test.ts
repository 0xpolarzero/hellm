import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  buildAppGlobalSourceWatchInputs,
  buildWorkspaceSourceWatchInputs,
  type SourceInvalidationHost,
} from "@svvy/runtime/bootstrap";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("source invalidation coordinator", () => {
  it("keeps generated Workflows output outside watched source inputs", () => {
    const root = tempRoot("source-inputs");
    const appInputs = buildAppGlobalSourceWatchInputs({
      extensionsRoot: join(root, "extensions"),
      host: testHost(root),
      workflowsSourceRoot: join(root, "workflows"),
    });
    const workspaceInputs = buildWorkspaceSourceWatchInputs({
      cwd: join(root, "workspace"),
      host: testHost(root),
    });
    const inputs = [...appInputs, ...workspaceInputs];

    expect(inputs.some((input) => input.path.includes("/workflows/generated/"))).toBe(false);
    expect(inputs).toContainEqual(
      expect.objectContaining({
        domain: "workflows",
        kind: "directory",
        path: join(root, "workflows", "agents"),
      }),
    );
    expect(inputs.some((input) => input.path.endsWith("agent-settings.json"))).toBe(false);
    expect(inputs.some((input) => input.path.endsWith("snippets.json"))).toBe(false);
    expect(inputs).toContainEqual(
      expect.objectContaining({
        domain: "host_snippets",
        kind: "directory",
        path: join(root, "workspace", ".claude", "commands"),
      }),
    );
  });

  it("splits app-global and workspace source input planning by owner", () => {
    const root = tempRoot("split-source-inputs");
    const host = testHost(root);
    const appInputs = buildAppGlobalSourceWatchInputs({
      extensionsRoot: join(root, "extensions"),
      host,
      workflowsSourceRoot: join(root, "workflows"),
    });
    const workspaceInputs = buildWorkspaceSourceWatchInputs({
      cwd: join(root, "workspace"),
      host,
    });

    expect(new Set(appInputs.map((input) => input.domain))).toEqual(
      new Set(["extensions", "workflows"]),
    );
    expect(appInputs.some((input) => input.domain === "host_snippets")).toBe(false);
    expect(appInputs.some((input) => input.domain === "external_instructions")).toBe(false);
    expect(new Set(workspaceInputs.map((input) => input.domain))).toEqual(
      new Set(["external_instructions", "host_snippets"]),
    );
    expect(workspaceInputs.some((input) => input.domain === "extensions")).toBe(false);
    expect(workspaceInputs.some((input) => input.domain === "workflows")).toBe(false);
  });

  it("adds external instruction candidates for workspace ancestors and configured global roots", () => {
    const root = tempRoot("external-inputs");
    const workspace = join(root, "a", "b");
    const global = join(root, "global");
    const inputs = buildWorkspaceSourceWatchInputs({
      cwd: workspace,
      externalInstructions: {
        globalRoots: [
          {
            enabled: true,
            path: global,
          },
        ],
      },
      host: testHost(root),
    });

    expect(inputs).toContainEqual(
      expect.objectContaining({
        domain: "external_instructions",
        kind: "file",
        path: join(global, "AGENTS.md"),
      }),
    );
    expect(inputs).toContainEqual(
      expect.objectContaining({
        domain: "external_instructions",
        kind: "file",
        path: join(workspace, "CLAUDE.md"),
      }),
    );
  });
});

function testHost(homeDir: string): SourceInvalidationHost {
  return {
    homeDir,
    path: {
      dirname,
      join,
      resolve,
    },
    fileSystem: {
      exists: existsSync,
      isDirectory: (path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      },
      isFile: (path) => {
        try {
          return statSync(path).isFile();
        } catch {
          return false;
        }
      },
      readDirectory: (path) =>
        readdirSync(path, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory()
            ? ("directory" as const)
            : entry.isFile()
              ? ("file" as const)
              : ("other" as const),
        })),
      readFileString: (path) => readFileSync(path, "utf8"),
    },
    hashStrings: (parts) => {
      const hash = createHash("sha256");
      for (const part of parts) {
        hash.update(part);
        hash.update("\0");
      }
      return hash.digest("hex");
    },
    watch: () => ({ close: () => undefined }),
  };
}

function tempRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `svvy-${name}-`));
  tempDirs.push(root);
  return root;
}
