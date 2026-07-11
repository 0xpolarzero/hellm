import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  getSessionPreview,
  getSessionTitle,
  projectWorkspaceSessionSummary,
  projectWorkspaceSessionSummaryFromInfo,
} from "./session-projection";

function userMessage(text: string, timestamp = Date.now()): AgentMessage {
  return {
    role: "user",
    timestamp,
    content: [{ type: "text", text }],
  };
}

function assistantMessage(
  text: string,
  stopReason: "stop" | "error" = "stop",
  timestamp = Date.now(),
): AgentMessage {
  return {
    role: "assistant",
    timestamp,
    api: "openai-responses",
    provider: "openai",
    model: "gpt-4o",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    content: [{ type: "text", text }],
  };
}

function assistantThinkingMessage(thinking: string, timestamp = Date.now()): AgentMessage {
  return {
    ...assistantMessage("", "stop", timestamp),
    content: [{ type: "thinking", thinking }],
  } as unknown as AgentMessage;
}

describe("session projection", () => {
  it("prefers explicit names over generated titles", () => {
    expect(
      getSessionTitle({
        name: "Refactor queue handling",
        firstMessage: "ignored",
        messages: [userMessage("ignored")],
      }),
    ).toBe("Refactor queue handling");
  });

  it("falls back to the first user message and then New orchestrator", () => {
    expect(
      getSessionTitle({
        firstMessage: "",
        messages: [userMessage("Trace the parser regression and fix it.")],
      }),
    ).toBe("Trace the parser regression and fix it.");
    expect(
      getSessionTitle({
        firstMessage: "",
        messages: [],
      }),
    ).toBe("New orchestrator");
  });

  it("uses the latest user message for the preview", () => {
    expect(
      getSessionPreview({
        firstMessage: "fallback",
        messages: [
          userMessage("first"),
          assistantMessage("latest assistant reply"),
          userMessage("latest user request"),
        ],
      }),
    ).toBe("latest user request");
  });

  it("does not expose assistant thinking in the preview", () => {
    expect(
      getSessionPreview({
        firstMessage: "fallback",
        messages: [
          userMessage("fork from this request"),
          assistantThinkingMessage("private reasoning that should not appear"),
        ],
      }),
    ).toBe("fork from this request");
  });

  it("leaves the preview empty before the first turn", () => {
    expect(getSessionPreview({ firstMessage: "", messages: [] })).toBe("");
  });

  it("builds summaries with stable metadata", () => {
    const summary = projectWorkspaceSessionSummary({
      id: "session-1",
      name: undefined,
      firstMessage: "",
      createdAt: new Date("2026-04-10T10:00:00.000Z"),
      updatedAt: new Date("2026-04-10T10:05:00.000Z"),
      messageCount: 2,
      messages: [
        userMessage("Investigate"),
        assistantMessage("Done", "stop", Date.parse("2026-04-10T10:06:00.000Z")),
      ],
      provider: "openai",
      modelId: "gpt-4o",
      thinkingLevel: "high",
    });

    expect(summary.title).toBe("Investigate");
    expect(summary.preview).toBe("Investigate");
    expect(summary).not.toHaveProperty("sessionFile");
    expect(summary).not.toHaveProperty("parentSessionId");
    expect(summary).not.toHaveProperty("parentSessionFile");
    expect(summary.status).toBe("idle");
    expect(summary.updatedAt).toBe("2026-04-10T10:06:00.000Z");
  });

  it("does not infer session status from transcript stop reasons", () => {
    const summary = projectWorkspaceSessionSummary({
      id: "session-error-like",
      name: undefined,
      firstMessage: "",
      createdAt: new Date("2026-04-10T10:00:00.000Z"),
      updatedAt: new Date("2026-04-10T10:05:00.000Z"),
      messageCount: 2,
      messages: [
        userMessage("Investigate the failing workflow."),
        assistantMessage("The workflow failed.", "error", Date.parse("2026-04-10T10:06:00.000Z")),
      ],
      provider: "openai",
      modelId: "gpt-4o",
      thinkingLevel: "medium",
    });

    expect(summary.status).toBe("idle");
    expect(summary.preview).toBe("Investigate the failing workflow.");
  });

  it("projects inactive session summaries from metadata only", () => {
    const summary = projectWorkspaceSessionSummaryFromInfo({
      id: "session-2",
      name: undefined,
      firstMessage: "Trace the parser regression and fix it.",
      created: "2026-04-10T10:00:00.000Z",
      modified: "2026-04-10T10:05:00.000Z",
      messageCount: 2,
      parentSessionPath: "/tmp/2026-04-10T09-00-00_session-parent.jsonl",
    });

    expect(summary).toEqual({
      id: "session-2",
      parentSessionId: "session-parent",
      title: "Trace the parser regression and fix it.",
      preview: "Trace the parser regression and fix it.",
      createdAt: "2026-04-10T10:00:00.000Z",
      updatedAt: "2026-04-10T10:05:00.000Z",
      messageCount: 2,
      status: "idle",
      isPinned: false,
      pinnedAt: null,
      isArchived: false,
      archivedAt: null,
      isUnread: false,
      unreadAt: null,
      unreadReason: null,
      lastReadAt: null,
    });
  });
});
