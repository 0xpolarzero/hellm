import { estimateTokenCount } from "tokenx";

export type TokenCountAccuracy = "estimated";

export interface PromptTokenCount {
  tokens: number;
  accuracy: TokenCountAccuracy;
}

export function countPromptTokens(input: {
  provider: string;
  model: string;
  text: string;
}): PromptTokenCount {
  void input.provider;
  void input.model;
  return {
    tokens: estimateTokenCount(input.text),
    accuracy: "estimated",
  };
}
