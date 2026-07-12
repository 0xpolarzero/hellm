import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import {
  DEFAULT_EXTERNAL_INSTRUCTIONS,
  decodeUnknownExternalInstructionScanInputExit,
  decodeUnknownExternalInstructionsSettingsExit,
  encodeExternalInstructionScanResultExit,
  encodeExternalInstructionsSettingsExit,
  normalizeExternalInstructionsSettings,
} from "./external-instruction-contracts";
import type { AbsolutePath, ExternalInstructionSourceId, WorkspaceId } from "./ids";

describe("external instruction settings contracts", () => {
  it("round-trips the exact default settings contract", () => {
    const decoded = decodeUnknownExternalInstructionsSettingsExit(DEFAULT_EXTERNAL_INSTRUCTIONS);

    expect(Exit.isSuccess(decoded)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(encodeExternalInstructionsSettingsExit(decoded.value)).toEqual(decoded);
    }
  });

  it("rejects unknown fields and invalid actor controls", () => {
    expect(
      Exit.isFailure(
        decodeUnknownExternalInstructionsSettingsExit({
          ...DEFAULT_EXTERNAL_INSTRUCTIONS,
          rendererPreview: true,
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownExternalInstructionsSettingsExit({
          ...DEFAULT_EXTERNAL_INSTRUCTIONS,
          globalControls: {
            "source-01": {
              enabled: true,
              actors: ["orchestrator", "unsupported-actor"],
            },
          },
        }),
      ),
    ).toBe(true);
  });

  it("canonicalizes builtin roots, paths, workspace keys, and actor order once", () => {
    const normalized = normalizeExternalInstructionsSettings({
      globalRoots: [
        {
          id: "codex",
          kind: "builtin",
          label: "ignored",
          path: "  /tmp/codex  ",
          enabled: true,
        },
        {
          id: "  team-docs  ",
          kind: "custom",
          label: "  Team docs  ",
          path: "  /tmp/team-docs  ",
          enabled: true,
        },
      ],
      globalControls: {
        "  /tmp/team-docs/AGENTS.md  ": {
          enabled: true,
          actors: ["workflow-task", "orchestrator", "workflow-task"],
        },
      },
      workspaceControls: {
        "  workspace-one  ": {
          "  /workspace/CLAUDE.md  ": {
            enabled: false,
            actors: ["handler", "orchestrator"],
          },
        },
      },
    });

    expect(normalized).toEqual({
      globalRoots: [
        DEFAULT_EXTERNAL_INSTRUCTIONS.globalRoots[0]!,
        { ...DEFAULT_EXTERNAL_INSTRUCTIONS.globalRoots[1]!, path: "/tmp/codex", enabled: true },
        DEFAULT_EXTERNAL_INSTRUCTIONS.globalRoots[2]!,
        {
          id: "team-docs",
          kind: "custom",
          label: "Team docs",
          path: "/tmp/team-docs",
          enabled: true,
        },
      ],
      globalControls: {
        "/tmp/team-docs/AGENTS.md": {
          enabled: true,
          actors: ["orchestrator", "workflow-task"],
        },
      },
      workspaceControls: {
        "workspace-one": {
          "/workspace/CLAUDE.md": {
            enabled: false,
            actors: ["handler", "orchestrator"],
          },
        },
      },
    });
    expect(normalizeExternalInstructionsSettings(normalized)).toEqual(normalized);
  });

  it("round-trips split source observations and content without path-shaped identity", () => {
    const sourceId = "external_instruction_01" as ExternalInstructionSourceId;
    const encoded = encodeExternalInstructionScanResultExit({
      sources: [
        {
          id: sourceId,
          source: { sourceKind: "external-instruction", sourceId },
          fileName: "AGENTS.md",
          title: "AGENTS.md",
          canonicalPath: "/repo/AGENTS.md" as AbsolutePath,
          sourceGroup: "workspace_chain",
          order: 0,
          enabled: true,
          eligibleActors: ["orchestrator"],
          readOnly: true,
          contentHash: "sha256:content",
          fingerprint: "sha256:fingerprint",
          readStatus: { status: "readable" },
        },
      ],
      contents: [{ sourceId, content: "rules" }],
      diagnostics: [],
    });
    expect(Exit.isSuccess(encoded)).toBe(true);
  });

  it("rejects renderer-like scan fields and invalid observation ordering", () => {
    expect(
      Exit.isFailure(
        decodeUnknownExternalInstructionScanInputExit({
          workspaceId: "workspace_01" as WorkspaceId,
          workspaceRoot: "/repo" as AbsolutePath,
          cwd: "/repo" as AbsolutePath,
          homeDirectory: "/home/test" as AbsolutePath,
          settings: DEFAULT_EXTERNAL_INSTRUCTIONS,
          rendererPath: "/tmp/untrusted",
        }),
      ),
    ).toBe(true);
    const sourceId = "external_instruction_01" as ExternalInstructionSourceId;
    expect(
      Exit.isFailure(
        encodeExternalInstructionScanResultExit({
          sources: [
            {
              id: sourceId,
              source: { sourceKind: "external-instruction", sourceId },
              fileName: "AGENTS.md",
              title: "AGENTS.md",
              canonicalPath: "/repo/AGENTS.md" as AbsolutePath,
              sourceGroup: "workspace_chain",
              order: -1 as never,
              enabled: true,
              eligibleActors: ["orchestrator"],
              readOnly: true,
              contentHash: "sha256:content",
              fingerprint: "sha256:fingerprint",
              readStatus: { status: "readable" },
            },
          ],
          contents: [],
          diagnostics: [],
        }),
      ),
    ).toBe(true);
  });
});
