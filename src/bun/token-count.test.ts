import { describe, expect, it } from "bun:test";
import { countPromptTokens } from "./token-count";

describe("countPromptTokens", () => {
  it("returns a tokenx-backed prompt token estimate", () => {
    const tokenCount = countPromptTokens({
      provider: "openai",
      model: "gpt-5",
      text: "Use the loaded extension instructions before answering.",
    });

    expect(tokenCount.accuracy).toBe("estimated");
    expect(tokenCount.tokens).toBeGreaterThan(0);
  });
});
