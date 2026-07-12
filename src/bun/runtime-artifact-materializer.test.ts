import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRuntimeArtifactPreviewContent } from "./runtime-artifact-materializer";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("runtime artifact preview content", () => {
  it("reads an existing artifact and reports a missing backing file without inventing content", () => {
    const directory = mkdtempSync(join(tmpdir(), "svvy-artifact-preview-"));
    temporaryDirectories.push(directory);
    const artifactPath = join(directory, "preview.md");
    writeFileSync(artifactPath, "# Preview\n");

    expect(readRuntimeArtifactPreviewContent(artifactPath)).toEqual({
      missingFile: false,
      content: "# Preview\n",
    });
    expect(readRuntimeArtifactPreviewContent(join(directory, "missing.md"))).toEqual({
      missingFile: true,
      content: "",
    });
  });
});
