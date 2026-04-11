import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  deriveSessionStatus,
  getSessionParentId,
  getSessionPreview,
  getSessionTitle,
  projectWorkspaceSessionSummary,
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

  it("derives status from the active stream or latest failure", () => {
    expect(deriveSessionStatus({ messages: [], isActive: true, isStreaming: true })).toBe(
      "running",
    );
    expect(
      deriveSessionStatus({
        messages: [userMessage("hi"), assistantMessage("failed", "error")],
        isActive: false,
        isStreaming: false,
      }),
    ).toBe("error");
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
      isActive: false,
      isStreaming: false,
    });

    expect(summary.title).toBe("Investigate");
    expect(summary.preview).toBe("Done");
    expect(summary.parentSessionId).toBeUndefined();
    expect(summary.status).toBe("idle");
    expect(summary.updatedAt).toBe("2026-04-10T10:06:00.000Z");
  });
});
