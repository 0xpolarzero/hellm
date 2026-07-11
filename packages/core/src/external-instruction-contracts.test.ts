import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import {
  DEFAULT_EXTERNAL_INSTRUCTIONS,
  decodeUnknownExternalInstructionsSettingsExit,
  encodeExternalInstructionsSettingsExit,
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
});
