import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { ALL_HELLM_FEATURES } from "../../../docs/features.ts";

const MATRIX_PATH = resolve(
  import.meta.dir,
  "../../../docs/test-matrix.md",
);

describe("docs/test-matrix.md", () => {
  it("accounts for every feature in docs/features.ts exactly once and points at real test files", () => {
    const markdown = readFileSync(MATRIX_PATH, "utf8");
    const rows = markdown
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("| `"));

    const featureRows = rows.map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());

      return {
        feature: cells[0]?.replaceAll("`", "") ?? "",
        plannedFiles: cells[3] ?? "",
        status: cells[4] ?? "",
        notes: cells[5] ?? "",
      };
    });

    const featureIds = featureRows.map((row) => row.feature);
    const missing = ALL_HELLM_FEATURES.filter(
      (feature) => !featureIds.includes(feature),
    );
    const duplicates = featureIds.filter(
      (feature, index) => featureIds.indexOf(feature) !== index,
    );

    expect(missing).toEqual([]);
    expect(duplicates).toEqual([]);
    expect(featureIds).toHaveLength(ALL_HELLM_FEATURES.length);

    for (const row of featureRows) {
      expect(["executable", "pending", "deferred"]).toContain(row.status);
      expect(row.notes.length).toBeGreaterThan(0);

      const files = row.plannedFiles
        .replaceAll("`", "")
        .split(";")
        .map((file) => file.trim())
        .filter((file) => file.length > 0);

      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect(
          existsSync(resolve(import.meta.dir, "../../../", file)),
        ).toBe(true);
      }
    }
  });
});
