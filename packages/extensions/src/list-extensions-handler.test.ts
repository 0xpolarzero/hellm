import { describe, expect, it } from "bun:test";
import { listExtensionsForActor } from "./list-extensions-handler";

describe("list_extensions handler", () => {
  it("builds actor-local visible extension details without unavailable records", () => {
    const details = listExtensionsForActor({
      actor: "orchestrator",
      loadedExtensionIds: ["shell"],
      availableExtensionIds: ["smithers"],
      externalInstructionSources: [
        {
          id: "external_instructions_project",
          kind: "AGENTS.md",
          path: "/tmp/svvy/instructions.md",
          title: "Project instructions",
          enabled: true,
          actors: ["orchestrator"],
          readStatus: { status: "readable" },
        },
      ],
    });

    expect(details.loaded.map((extension) => extension.id)).toEqual([
      "shell",
      "external_instruction:AGENTS.md:/tmp/svvy/instructions.md",
    ]);
    expect(details.available.map((extension) => extension.id)).toEqual(["smithers"]);
    expect(details.available[0]).not.toHaveProperty("instructionSourceFiles");
  });
});
