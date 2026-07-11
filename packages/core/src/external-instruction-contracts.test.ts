import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import {
  DEFAULT_EXTERNAL_INSTRUCTIONS,
  decodeUnknownExternalInstructionsSettingsExit,
  encodeExternalInstructionsSettingsExit,
  normalizeExternalInstructionsSettings,
} from "./external-instruction-contracts";

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
});
