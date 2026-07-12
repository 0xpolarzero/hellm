import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { discoverExternalInstructionSources } from "./external-instructions";

describe("external instruction discovery", () => {
  it("discovers workspace-chain files from filesystem root toward the workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-external-instructions-"));
    const parent = join(root, "parent");
    const workspace = join(parent, "workspace");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "root rules");
    writeFileSync(join(parent, "AGENTS.md"), "parent rules");
    writeFileSync(join(workspace, "AGENTS.md"), "workspace rules");

    const sources = discoverExternalInstructionSources({ cwd: workspace });

    expect(sources.map((source) => source.content)).toEqual([
      "root rules",
      "parent rules",
      "workspace rules",
    ]);
    expect(sources.map((source) => source.order)).toEqual([0, 1, 2]);
  });

  it("discovers paired CLAUDE.md as disabled while lone CLAUDE.md stays enabled", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-external-instructions-"));
    const parent = join(root, "parent");
    const workspace = join(parent, "workspace");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(parent, "AGENTS.md"), "agents rules");
    writeFileSync(join(parent, "CLAUDE.md"), "claude paired rules");
    writeFileSync(join(workspace, "CLAUDE.md"), "claude workspace rules");

    const sources = discoverExternalInstructionSources({ cwd: workspace });

    expect(sources.map((source) => [source.kind, source.content, source.enabled])).toEqual([
      ["AGENTS.md", "agents rules", true],
      ["CLAUDE.md", "claude paired rules", false],
      ["CLAUDE.md", "claude workspace rules", true],
    ]);
  });

  it("checks global roots before workspace-chain files and only reads direct child files", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-external-instructions-"));
    const globalRoot = join(root, "global");
    const nested = join(globalRoot, "nested");
    const workspace = join(root, "workspace");
    mkdirSync(nested, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(globalRoot, "AGENTS.md"), "global rules");
    writeFileSync(join(nested, "AGENTS.md"), "nested should not load");
    writeFileSync(join(workspace, "AGENTS.md"), "workspace rules");

    const sources = discoverExternalInstructionSources({
      cwd: workspace,
      globalRoots: [globalRoot],
    });

    expect(sources.map((source) => source.content)).toEqual(["global rules", "workspace rules"]);
    expect(sources.some((source) => source.path.includes("nested"))).toBe(false);
  });

  it("applies global root state and persisted global file controls", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-external-instructions-"));
    const disabledGlobal = join(root, "disabled-global");
    const customGlobal = join(root, "custom-global");
    const workspace = join(root, "workspace");
    mkdirSync(disabledGlobal, { recursive: true });
    mkdirSync(customGlobal, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(disabledGlobal, "AGENTS.md"), "disabled global rules");
    writeFileSync(join(customGlobal, "AGENTS.md"), "custom global rules");

    const sources = discoverExternalInstructionSources({
      cwd: workspace,
      settings: {
        globalRoots: [
          {
            id: "disabled",
            kind: "builtin",
            label: "Disabled",
            path: disabledGlobal,
            enabled: false,
          },
          {
            id: "custom",
            kind: "custom",
            label: "Custom",
            path: customGlobal,
            enabled: true,
          },
        ],
        globalControls: {
          [join(customGlobal, "AGENTS.md")]: {
            enabled: true,
            actors: ["handler"],
          },
        },
        workspaceControls: {},
      },
      workspaceKey: workspace,
    });

    expect(sources.map((source) => source.content)).toEqual(["custom global rules"]);
    expect(sources[0]).toMatchObject({
      actors: ["handler"],
      rootId: "custom",
      rootLabel: "Custom",
      sourceGroup: "custom_global_root",
    });
  });

  it("applies workspace-specific file controls without leaking between workspace keys", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-external-instructions-"));
    const workspace = join(root, "workspace");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "AGENTS.md"), "workspace rules");

    const disabled = discoverExternalInstructionSources({
      cwd: workspace,
      settings: {
        globalRoots: [],
        globalControls: {},
        workspaceControls: {
          "workspace-a": {
            [join(workspace, "AGENTS.md")]: {
              enabled: false,
              actors: ["orchestrator"],
            },
          },
        },
      },
      workspaceKey: "workspace-a",
    });
    const defaulted = discoverExternalInstructionSources({
      cwd: workspace,
      settings: {
        globalRoots: [],
        globalControls: {},
        workspaceControls: {},
      },
      workspaceKey: "workspace-b",
    });

    expect(disabled[0]).toMatchObject({
      enabled: false,
      actors: ["orchestrator"],
      sourceGroup: "workspace_chain",
    });
    expect(defaulted[0]).toMatchObject({
      enabled: true,
      actors: ["orchestrator", "handler", "workflow-task"],
    });
  });

  it("composes external instructions only for selected actors", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-external-instructions-"));
    const workspace = join(root, "workspace");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "AGENTS.md"), "handler-only rules");
    const sources = discoverExternalInstructionSources({
      cwd: workspace,
      settings: {
        globalRoots: [],
        globalControls: {},
        workspaceControls: {
          [workspace]: {
            [join(workspace, "AGENTS.md")]: {
              enabled: true,
              actors: ["handler"],
            },
          },
        },
      },
      workspaceKey: workspace,
    });

    expect(sources).toEqual([
      expect.objectContaining({ content: "handler-only rules", actors: ["handler"] }),
    ]);
  });
});
