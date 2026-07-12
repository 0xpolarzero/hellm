import { describe, expect, it } from "bun:test";

describe("legacy sync seam", () => {
  it("keeps all retired renderer sync channels out of the desktop contract", async () => {
    const contractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();
    const indexSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const runtimeSource = await Bun.file(`${import.meta.dir}/../mainview/chat-runtime.ts`).text();

    for (const source of [contractSource, indexSource, runtimeSource]) {
      expect(source).not.toContain("sendArtifactOpen");
      expect(source).not.toContain("sendSurfaceSync");
      expect(source).not.toContain("sendWorkspaceSync");
    }

    expect(contractSource).not.toContain("sendAppMenuAction");
    expect(indexSource).not.toContain("sendAppMenuAction");
    expect(runtimeSource).not.toContain("sendAppMenuAction");
    expect(contractSource).not.toContain("sendAppLogUpdate");
    expect(indexSource).not.toContain("sendAppLogUpdate");
    expect(runtimeSource).not.toContain("sendAppLogUpdate");
    expect(contractSource).not.toContain("sendExtensionCliRequirementActionUpdate");
    expect(indexSource).not.toContain("sendExtensionCliRequirementActionUpdate");
    expect(runtimeSource).not.toContain("sendExtensionCliRequirementActionUpdate");
  });
});
