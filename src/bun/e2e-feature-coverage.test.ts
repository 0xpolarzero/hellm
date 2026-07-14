import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { FEATURE_E2E_COVERAGE, validateFeatureE2ECoverage } from "../../e2e/feature-coverage";

describe("e2e feature coverage inventory", () => {
  const availableTestFiles = new Set(
    FEATURE_E2E_COVERAGE.flatMap((item) => item.testFiles).filter((path) => existsSync(path)),
  );

  test("tracks every product feature exactly once with existing evidence files", () => {
    expect(validateFeatureE2ECoverage(availableTestFiles)).toEqual([]);
  });

  test("keeps every shipped feature free of named e2e lifecycle gaps", () => {
    expect(validateFeatureE2ECoverage(availableTestFiles, true)).toEqual([]);
  });
});
