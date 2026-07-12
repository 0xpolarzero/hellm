import { describe, expect, it } from "bun:test";

const REMAINING_LEGACY_SYNC_CHANNELS = [
  {
    channel: "sendAppMenuAction",
    retiresInIncrement: 10,
    reason: "legacy workspace, session, sidebar, and surface menu routes retire in increment 10",
  },
] as const;

describe("legacy sync seam", () => {
  it("pins remaining legacy renderer sync channels to their retirement increment", async () => {
    const contractSource = await Bun.file(
      `${import.meta.dir}/../shared/workspace-contract.ts`,
    ).text();
    const indexSource = await Bun.file(`${import.meta.dir}/index.ts`).text();
    const runtimeSource = await Bun.file(`${import.meta.dir}/../mainview/chat-runtime.ts`).text();

    for (const source of [contractSource, indexSource, runtimeSource]) {
      expect(source).toContain("sendArtifactOpen");
      expect(source).not.toContain("sendSurfaceSync");
      expect(source).not.toContain("sendWorkspaceSync");
    }

    for (const entry of REMAINING_LEGACY_SYNC_CHANNELS) {
      expect(entry.retiresInIncrement).toBe(10);
      expect(contractSource).toContain(entry.channel);
      expect(indexSource).toContain(entry.channel);
      expect(runtimeSource).toContain(entry.channel);
    }

    expect(contractSource).not.toContain("sendAppLogUpdate");
    expect(indexSource).not.toContain("sendAppLogUpdate");
    expect(runtimeSource).not.toContain("sendAppLogUpdate");
    expect(contractSource).not.toContain("sendExtensionCliRequirementActionUpdate");
    expect(indexSource).not.toContain("sendExtensionCliRequirementActionUpdate");
    expect(runtimeSource).not.toContain("sendExtensionCliRequirementActionUpdate");
  });
});
