import { describe, expect, it } from "bun:test";
import type { RendererTranscriptAssistantEntry } from "../shared/renderer-transcript";
import {
  buildContextBudgetFromUsage,
  buildSurfaceContextBudget,
  formatContextBudgetTooltip,
  getContextBudgetTone,
} from "./context-budget";

function assistantWithInput(input: number): RendererTranscriptAssistantEntry {
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

  it("projects the latest processed tokens as active context percentage", () => {
    expect(
      buildContextBudgetFromUsage({ input: 340, output: 45, cacheRead: 30, cacheWrite: 30 }, 1000),
    ).toMatchObject({
      usedTokens: 400,
      maxTokens: 1000,
      percent: 40,
      tone: "orange",
      label: "40% context",
    });
  });

  it("excludes output tokens because the meter describes prompt input pressure", () => {
    expect(
      buildContextBudgetFromUsage({ input: 20, output: 900, cacheRead: 10, cacheWrite: 5 }, 100),
    ).toMatchObject({
      usedTokens: 35,
      percent: 35,
      tone: "neutral",
    });
  });

  it("formats exact token usage for hover detail", () => {
    const budget = buildContextBudgetFromUsage(
      { input: 12345, output: 0, cacheRead: 0, cacheWrite: 0 },
      200000,
    );

    expect(budget && formatContextBudgetTooltip(budget)).toBe("12,345 / 200,000 tokens");
  });

  it("omits live surface budget until assistant input usage is known", () => {
    expect(buildSurfaceContextBudget([], { contextWindow: 200000 })).toBeNull();
    expect(
      buildSurfaceContextBudget([{ role: "user", content: "first", timestamp: Date.now() }], {
        contextWindow: 200000,
      }),
    ).toBeNull();
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
