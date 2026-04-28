import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import {
  buildContextBudgetFromUsage,
  buildSurfaceContextBudget,
  getContextBudgetTone,
} from "./context-budget";

function assistantWithInput(input: number): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: "test",
    provider: "openai",
    model: "gpt-test",
    timestamp: Date.now(),
    stopReason: "stop",
    usage: {
      input,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: input + 1,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
  };
}

describe("context budget", () => {
  it("uses the adopted neutral, orange, and red thresholds", () => {
    expect(getContextBudgetTone(39)).toBe("neutral");
    expect(getContextBudgetTone(40)).toBe("orange");
    expect(getContextBudgetTone(59)).toBe("orange");
    expect(getContextBudgetTone(60)).toBe("red");
  });

  it("projects the latest prompt input as active context percentage", () => {
    expect(
      buildContextBudgetFromUsage({ input: 40, cacheRead: 30, cacheWrite: 30 }, 100),
    ).toMatchObject({
      usedTokens: 40,
      maxTokens: 100,
      percent: 40,
      tone: "orange",
    });
  });

  it("uses the latest assistant usage for a live surface", () => {
    const budget = buildSurfaceContextBudget(
      [
        { role: "user", content: "first", timestamp: Date.now() },
        assistantWithInput(20),
        { role: "user", content: "second", timestamp: Date.now() },
        assistantWithInput(60),
      ],
      { contextWindow: 100 },
    );

    expect(budget).toMatchObject({
      usedTokens: 60,
      percent: 60,
      tone: "red",
    });
  });
});
