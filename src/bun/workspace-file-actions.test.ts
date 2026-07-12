import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  importWorkspaceComposerAttachments,
  materializeSelectedWorkspaceAttachments,
  resolveWorkspacePathTarget,
} from "./workspace-file-actions";

const tempDirs: string[] = [];

function tempDir(label: string): string {
  const path = mkdtempSync(join(tmpdir(), `svvy-${label}-`));
  tempDirs.push(path);
  return path;
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("workspace file app actions", () => {
  it("materializes workspace paths and imports external files under user-input attachments", () => {
    const cwd = tempDir("workspace-file-actions");
    const external = tempDir("workspace-file-actions-external");
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "inside.txt"), "inside");
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    writeFileSync(join(external, "outside.png"), imageBytes);
    const missing = join(external, "missing.txt");

    const result = materializeSelectedWorkspaceAttachments({
      cwd,
      selectedPaths: [
        join(cwd, "src"),
        join(cwd, "src", "inside.txt"),
        join(external, "outside.png"),
        missing,
      ],
    });

    expect(result.skippedPaths).toEqual([missing]);
    expect(result.attachments[0]).toMatchObject({
      kind: "folder",
      name: "src",
      path: "src",
      workspaceRelativePath: "src",
    });
    expect(result.attachments[1]).toMatchObject({
      kind: "file",
      name: "inside.txt",
      path: "src/inside.txt",
      workspaceRelativePath: "src/inside.txt",
      sizeBytes: 6,
    });
    const imported = result.attachments[2];
    expect(imported).toMatchObject({
      kind: "image",
      name: "outside.png",
      mimeType: "image/png",
      sizeBytes: imageBytes.byteLength,
      dataBase64: imageBytes.toString("base64"),
    });
    expect(imported?.workspaceRelativePath).toMatch(
      /^\.svvy\/attachments\/user-input\/.+-outside\.png$/,
    );
    expect(readFileSync(join(cwd, imported?.workspaceRelativePath ?? ""))).toEqual(imageBytes);
  });

  it("imports encoded attachments and reports only failed input names", () => {
    const cwd = tempDir("workspace-import-actions");
    const bytes = Buffer.from("image");
    const result = importWorkspaceComposerAttachments({
      cwd,
      attachments: [
        { name: "my image.png", mimeType: "image/png", dataBase64: bytes.toString("base64") },
        { name: "bad/name.txt", dataBase64: "dGV4dA==" },
      ],
    });

    expect(result.skippedPaths).toEqual([]);
    expect(result.attachments[0]).toMatchObject({
      kind: "image",
      name: "my-image.png",
      mimeType: "image/png",
      dataBase64: bytes.toString("base64"),
    });
    expect(result.attachments[1]).toMatchObject({
      kind: "file",
      name: "bad-name.txt",
      mimeType: "application/octet-stream",
      dataBase64: undefined,
    });
  });

  it("resolves only existing targets contained by the authoritative workspace root", () => {
    const cwd = tempDir("workspace-path-target");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs", "guide.md"), "guide");

    expect(resolveWorkspacePathTarget({ cwd, workspaceRelativePath: "@docs" })).toEqual({
      kind: "folder",
      absolutePath: join(cwd, "docs"),
    });
    expect(resolveWorkspacePathTarget({ cwd, workspaceRelativePath: "docs/guide.md" })).toEqual({
      kind: "file",
      absolutePath: join(cwd, "docs", "guide.md"),
    });
    for (const workspaceRelativePath of [
      "",
      "/etc/passwd",
      "../outside",
      "docs/missing.md",
      "bad\0path",
    ]) {
      expect(resolveWorkspacePathTarget({ cwd, workspaceRelativePath })).toEqual({
        kind: "missing",
      });
    }
  });
});
