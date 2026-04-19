import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  getSessionParentId,
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

  it("falls back to the first user message and then New Session", () => {
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
    ).toBe("New Session");
  });

  it("uses the latest visible message for the preview", () => {
    expect(
      getSessionPreview({
        firstMessage: "fallback",
        messages: [userMessage("first"), assistantMessage("latest assistant reply")],
      }),
    ).toBe("latest assistant reply");
  });

  it("projects parent session ids from persisted paths", () => {
    expect(getSessionParentId("/tmp/sessions/2026-04-10T10-00-00.000Z_abcd-1234.jsonl")).toBe(
      "abcd-1234",
    );
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
      sessionFile: "/tmp/session-1.jsonl",
      parentSessionFile: "/tmp/session-0.jsonl",
      provider: "openai",
      modelId: "gpt-4o",
      thinkingLevel: "high",
    });

    expect(summary.title).toBe("Investigate");
    expect(summary.preview).toBe("Done");
    expect(summary.parentSessionId).toBeUndefined();
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
      sessionFile: "/tmp/session-error-like.jsonl",
      parentSessionFile: undefined,
      provider: "openai",
      modelId: "gpt-4o",
      thinkingLevel: "medium",
    });

    expect(summary.status).toBe("idle");
    expect(summary.preview).toBe("The workflow failed.");
  });

  it("projects inactive session summaries from metadata only", () => {
    const summary = projectWorkspaceSessionSummaryFromInfo({
      id: "session-2",
      name: undefined,
      firstMessage: "Trace the parser regression and fix it.",
      created: "2026-04-10T10:00:00.000Z",
      modified: "2026-04-10T10:05:00.000Z",
      messageCount: 2,
      path: "/tmp/session-2.jsonl",
    });

    expect(summary).toEqual({
      id: "session-2",
      title: "Trace the parser regression and fix it.",
      preview: "Trace the parser regression and fix it.",
      createdAt: "2026-04-10T10:00:00.000Z",
      updatedAt: "2026-04-10T10:05:00.000Z",
      messageCount: 2,
      status: "idle",
      sessionFile: "/tmp/session-2.jsonl",
      parentSessionId: undefined,
      parentSessionFile: undefined,
    });
  });
});
