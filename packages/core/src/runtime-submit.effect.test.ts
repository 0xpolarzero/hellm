import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { RuntimeClientSubmissionId } from "./ids";
import {
  unsafeDecodeRuntimeClientSubmissionMetadataSyncForTestsAndBootstrap,
  decodeUnknownRuntimeClientSubmissionMetadataExit,
  decodeUnknownRuntimeClientSubmissionEffect,
  decodeUnknownRuntimeClientSubmissionExit,
  decodeUnknownRuntimeClientSubmissionInputEffect,
  decodeUnknownRuntimeClientSubmissionInputExit,
  normalizeRuntimeClientSubmissionMetadata,
  runtimeClientSubmissionLogDetails,
  RuntimePromptTelemetrySummarySchema,
  summarizeRuntimePromptMessagesForTelemetry,
} from "./runtime-submit";

describe("@svvy/core runtime submit contracts", () => {
  it("normalizes client submission metadata for stable runtime logging", () => {
    assert.deepStrictEqual(
      normalizeRuntimeClientSubmissionMetadata({
        submissionId: " submit-1 ",
        correlationId: " correlation-1 ",
        clientRequestId: "",
        source: "x".repeat(120),
        submittedAt: "2026-06-18T10:00:00.000Z",
        sequence: 4,
      }),
      {
        submissionId: "submit-1",
        correlationId: "correlation-1",
        source: "x".repeat(96),
        submittedAt: "2026-06-18T10:00:00.000Z",
        sequence: 4,
      },
    );
  });

  it("maps normalized metadata to app-log detail keys", () => {
    assert.deepStrictEqual(
      runtimeClientSubmissionLogDetails({
        submissionId: "submit-1",
        correlationId: "correlation-1",
        source: "composer",
        sequence: 2,
      }),
      {
        clientSubmissionId: "submit-1",
        clientCorrelationId: "correlation-1",
        clientSubmissionSource: "composer",
        clientSubmissionSequence: 2,
      },
    );
  });

  it("summarizes prompt message telemetry without depending on pi types", () => {
    assert.deepStrictEqual(
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
      {
        messageCount: 3,
        userMessageCount: 2,
        textBlockCount: 2,
        imageCount: 1,
      },
    );
  });

  it("decodes persisted prompt telemetry summaries through a public schema", () => {
    assert.deepStrictEqual(
      Schema.decodeUnknownSync(RuntimePromptTelemetrySummarySchema)({
        messageCount: 3,
        userMessageCount: 2,
        textBlockCount: 2,
        imageCount: 1,
      }),
      {
        messageCount: 3,
        userMessageCount: 2,
        textBlockCount: 2,
        imageCount: 1,
      },
    );
    assert.throws(() =>
      Schema.decodeUnknownSync(RuntimePromptTelemetrySummarySchema)({
        messageCount: -1,
        userMessageCount: 2,
        textBlockCount: 2,
        imageCount: 1,
      }),
    );
  });

  it.effect("exposes Effect decoders for the wire and internal runtime shapes", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* decodeUnknownRuntimeClientSubmissionInputEffect({
          submissionId: "submit-1",
          sequence: 1,
        }),
        {
          submissionId: "submit-1" as RuntimeClientSubmissionId,
          sequence: 1,
        },
      );
      assert.deepStrictEqual(
        yield* decodeUnknownRuntimeClientSubmissionEffect({
          submissionId: "submit-1",
          sequence: 1,
        }),
        {
          submissionId: "submit-1" as RuntimeClientSubmissionId,
          sequence: 1,
        },
      );
    }),
  );

  it("exposes Exit decoders for the wire and internal runtime shapes", () => {
    assert.strictEqual(
      Exit.isSuccess(
        decodeUnknownRuntimeClientSubmissionInputExit({
          submissionId: "submit-1",
          source: "desktop",
        }),
      ),
      true,
    );
    assert.strictEqual(
      Exit.isSuccess(
        decodeUnknownRuntimeClientSubmissionExit({ submissionId: "submit-1", source: "desktop" }),
      ),
      true,
    );
  });

  it("exposes metadata helpers as the runtime submission input contract shape", () => {
    assert.deepStrictEqual(
      unsafeDecodeRuntimeClientSubmissionMetadataSyncForTestsAndBootstrap({
        submissionId: "submit-1",
        sequence: 1,
      }),
      {
        submissionId: "submit-1" as RuntimeClientSubmissionId,
        sequence: 1,
      },
    );
    assert.strictEqual(
      Exit.isSuccess(
        decodeUnknownRuntimeClientSubmissionMetadataExit({ submissionId: "submit-1" }),
      ),
      true,
    );
  });

  it("rejects renderer-local metadata fields", () => {
    assert.throws(() =>
      unsafeDecodeRuntimeClientSubmissionMetadataSyncForTestsAndBootstrap({
        submissionId: "submit-1",
        panelId: "primary",
      }),
    );
  });
});
