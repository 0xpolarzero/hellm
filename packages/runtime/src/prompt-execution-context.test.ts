import { describe, expect, it } from "bun:test";
import { createPromptExecutionContext } from "./prompt-execution-context";

describe("prompt execution context", () => {
  it("strips external instruction content from prompt runtime metadata", () => {
    const context = createPromptExecutionContext({
      workspaceSessionId: "workspace-session-1",
      turnId: "turn-1",
      surfacePiSessionId: "pi-session-1",
      generatedAgentContextFingerprint: "fingerprint-1",
      generatedAgentContextRevision: "1",
      externalInstructionSources: [
        {
          id: "0:/repo/AGENTS.md",
          kind: "AGENTS.md",
          title: "AGENTS.md",
          path: "/repo/AGENTS.md",
          content: "secret instruction body",
          contentHash: "hash-agents",
          order: 0,
          enabled: true,
          actors: ["orchestrator", "handler"],
          sourceGroup: "workspace_chain",
          readStatus: { status: "readable" },
        },
      ],
    });

    expect(context.externalInstructionSources).toEqual([
      {
        id: "0:/repo/AGENTS.md",
        kind: "AGENTS.md",
        title: "AGENTS.md",
        path: "/repo/AGENTS.md",
        contentHash: "hash-agents",
        order: 0,
        enabled: true,
        actors: ["orchestrator", "handler"],
        sourceGroup: "workspace_chain",
        readStatus: { status: "readable" },
      },
    ]);
    expect(JSON.stringify(context)).not.toContain("secret instruction body");
    expect(context.externalInstructionSources?.[0]).not.toHaveProperty("content");
  });
});
