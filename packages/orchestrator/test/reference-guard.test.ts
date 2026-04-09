import { describe, expect, it } from "bun:test";
import {
  assertReferencesPopulated,
  checkReferences,
  warnIfReferencesMissing,
} from "@hellm/test-support";

describe("reference guard check", () => {
  it("warns when pi-mono and smithers local references are not populated", () => {
    const { allPopulated, references } = checkReferences();
    const strictMode = process.env.HELLM_REQUIRE_REFERENCES === "1";

    if (!allPopulated && !strictMode) {
      warnIfReferencesMissing();
      const missing = references.filter((ref) => !ref.populated);
      expect(missing.length).toBeGreaterThan(0);
      for (const ref of missing) {
        expect(ref.fileCount).toBe(0);
      }
    } else {
      if (strictMode) {
        assertReferencesPopulated();
      }
      for (const ref of references) {
        expect(ref.populated).toBe(true);
        expect(ref.fileCount).toBeGreaterThan(0);
      }
    }
  });
});
