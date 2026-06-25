import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";

import {
  decodeRuntimeClientSubmissionMetadata,
  decodeRuntimeClientSubmissionMetadataExit,
  normalizeRuntimeClientSubmissionMetadata,
  runtimeClientSubmissionLogDetails,
  summarizeRuntimePromptMessagesForTelemetry,
} from "./runtime-submit";

describe("@svvy/core runtime submit contracts", () => {
  it("normalizes client submission metadata for stable runtime logging", () => {
    expect(
      normalizeRuntimeClientSubmissionMetadata({
        submissionId: " submit-1 ",
        correlationId: " correlation-1 ",
        clientRequestId: "",
        source: "x".repeat(120),
        submittedAt: "2026-06-18T10:00:00.000Z",
        sequence: 4,
      }),
    ).toEqual({
      submissionId: "submit-1",
      correlationId: "correlation-1",
      source: "x".repeat(96),
      submittedAt: "2026-06-18T10:00:00.000Z",
      sequence: 4,
    });
  });

  it("maps normalized metadata to app-log detail keys", () => {
    expect(
      runtimeClientSubmissionLogDetails({
        submissionId: "submit-1",
        correlationId: "correlation-1",
        source: "composer",
        sequence: 2,
      }),
    ).toEqual({
      clientSubmissionId: "submit-1",
      clientCorrelationId: "correlation-1",
      clientSubmissionSource: "composer",
      clientSubmissionSequence: 2,
    });
  });

  it("summarizes prompt message telemetry without depending on pi types", () => {
    expect(
      summarizeRuntimePromptMessagesForTelemetry([
        { role: "system", content: "ignored" },
        { role: "user", content: "hello" },
        {
          role: "user",
          content: [
            { type: "text", text: "more" },
            { type: "text", text: " " },
            { type: "image" },
            { type: "tool-result", value: 1 },
          ],
        },
      ]),
    ).toEqual({
      messageCount: 3,
      userMessageCount: 2,
      textBlockCount: 2,
      imageCount: 1,
    });
  });

  it("exposes an Effect schema decoder for boundary payloads", () => {
    expect(
      decodeRuntimeClientSubmissionMetadata({
        submissionId: "submit-1",
        sequence: 1,
      }),
    ).toEqual({
      submissionId: "submit-1",
      sequence: 1,
    });
  });

  it("exposes an Exit decoder for non-Effect bridge edges", () => {
    const success = decodeRuntimeClientSubmissionMetadataExit({
      submissionId: "submit-1",
      source: "desktop",
    });
    expect(Exit.isSuccess(success)).toBe(true);
    if (Exit.isSuccess(success)) {
      expect(success.value.source).toBe("desktop");
    }

    expect(
      Exit.isFailure(decodeRuntimeClientSubmissionMetadataExit({ panelId: "renderer-only" })),
    ).toBe(true);
  });

  it("rejects renderer-local metadata fields", () => {
    expect(() =>
      decodeRuntimeClientSubmissionMetadata({
        submissionId: "submit-1",
        panelId: "primary",
      }),
    ).toThrow();
  });
});
