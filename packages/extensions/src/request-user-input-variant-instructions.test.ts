import { describe, expect, it } from "bun:test";

import { getRequestUserInputVariantInstructions } from "./request-user-input-variant-instructions";

describe("request-user-input variant instructions", () => {
  it("returns the exact packaged nonblocking variant asset", () => {
    expect(getRequestUserInputVariantInstructions("nonblocking")).toContain(
      "Continue with the returned answer.",
    );
    expect(getRequestUserInputVariantInstructions("nonblocking")).toContain(
      "normal queued answer follow-up",
    );
    expect(getRequestUserInputVariantInstructions("nonblocking")).not.toContain(
      'answeredBy: "timeout_default"',
    );
  });

  it("returns the exact packaged blocking variant asset", () => {
    expect(getRequestUserInputVariantInstructions("blocking")).toContain(
      "answer is required before proceeding safely",
    );
    expect(getRequestUserInputVariantInstructions("blocking")).toContain(
      'answeredBy: "timeout_default"',
    );
    expect(getRequestUserInputVariantInstructions("blocking")).not.toContain(
      "normal queued answer follow-up",
    );
  });
});
