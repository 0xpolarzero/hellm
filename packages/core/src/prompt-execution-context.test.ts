import { describe, expect, it } from "bun:test";
import { unsafeDecodePromptExecutionContextSyncForTestsAndBootstrap } from "./prompt-execution-context";

describe("prompt execution context contracts", () => {
  it("rejects external instruction content at the core contract boundary", () => {
    expect(() =>
      unsafeDecodePromptExecutionContextSyncForTestsAndBootstrap({
        ...validPromptExecutionContext(),
        externalInstructionSources: [
          {
            ...validExternalInstructionSource(),
            content: "secret instruction body",
          },
        ],
      }),
    ).toThrow();
  });

  it("decodes prompt execution context data without runtime-only construction behavior", () => {
    const context = unsafeDecodePromptExecutionContextSyncForTestsAndBootstrap({
      ...validPromptExecutionContext(),
      externalInstructionSources: [validExternalInstructionSource()],
    });

    expect(context.externalInstructionSources).toEqual([validExternalInstructionSource()]);
  });
});

function validPromptExecutionContext() {
  return {
    workspaceSessionId: "workspace-session-1",
    turnId: "turn-1",
    workflowTaskAttemptId: null,
    workflowRunId: null,
    surfacePiSessionId: "pi-session-1",
    threadId: null,
    surfaceKind: "orchestrator",
    defaultEpisodeKind: "change",
    rootThreadId: null,
    rootEpisodeKind: "change",
    sessionWaitApplied: false,
    threadWasTerminalAtStart: false,
    loadedExtensionIds: [],
    availableExtensionIds: [],
    generatedAgentContextFingerprint: "fingerprint-1",
    generatedAgentContextRevision: "1",
    suppressPendingWorkflowAttentionDelivery: false,
    queueItemId: null,
  } as const;
}

function validExternalInstructionSource() {
  return {
    id: "0:/repo/AGENTS.md",
    kind: "AGENTS.md",
    title: "AGENTS.md",
    path: "/repo/AGENTS.md",
    contentHash: "hash-agents",
    order: 0,
    enabled: true,
    actors: ["orchestrator", "handler"] as const,
    sourceGroup: "workspace_chain",
    readStatus: { status: "readable" },
  } as const;
}
