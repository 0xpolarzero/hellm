import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { RuntimeClientSubmissionSchema, type RuntimeClientSubmission } from "./runtime-contracts";

export { RuntimeContractError } from "./errors";

export const RuntimeClientSubmissionMetadataSchema = RuntimeClientSubmissionSchema;

export type RuntimeClientSubmissionMetadata = RuntimeClientSubmission;

export const decodeRuntimeClientSubmissionMetadata = Schema.decodeUnknownSync(
  RuntimeClientSubmissionMetadataSchema,
  strictBoundaryParseOptions,
);

export const decodeRuntimeClientSubmissionMetadataExit = Schema.decodeUnknownExit(
  RuntimeClientSubmissionMetadataSchema,
  strictBoundaryParseOptions,
);

export const decodeRuntimeClientSubmissionMetadataEffect = Schema.decodeUnknownEffect(
  RuntimeClientSubmissionMetadataSchema,
  strictBoundaryParseOptions,
);

export interface RuntimePromptTelemetryMessage {
  readonly role: string;
  readonly content: string | readonly RuntimePromptTelemetryContentBlock[] | null | undefined;
}

export type RuntimePromptTelemetryContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image" }
  | { readonly type: string; readonly [key: string]: unknown };

export interface RuntimePromptTelemetrySummary {
  readonly messageCount: number;
  readonly userMessageCount: number;
  readonly textBlockCount: number;
  readonly imageCount: number;
}

function telemetryString(value: unknown, maxLength = 256): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, maxLength);
}

function telemetryNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function normalizeRuntimeClientSubmissionMetadata(
  metadata: RuntimeClientSubmissionMetadata | undefined,
): RuntimeClientSubmissionMetadata | undefined {
  if (!metadata) {
    return undefined;
  }
  const submissionId = telemetryString(metadata.submissionId);
  const correlationId = telemetryString(metadata.correlationId);
  const clientRequestId = telemetryString(metadata.clientRequestId);
  const source = telemetryString(metadata.source, 96);
  const submittedAt = telemetryString(metadata.submittedAt, 64);
  const sequence = telemetryNumber(metadata.sequence);
  const normalized: RuntimeClientSubmissionMetadata = {
    ...(submissionId ? { submissionId } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(clientRequestId ? { clientRequestId } : {}),
    ...(source ? { source } : {}),
    ...(submittedAt ? { submittedAt } : {}),
    ...(sequence !== undefined ? { sequence } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function runtimeClientSubmissionLogDetails(
  metadata: RuntimeClientSubmissionMetadata | undefined,
): Record<string, unknown> {
  const normalized = normalizeRuntimeClientSubmissionMetadata(metadata);
  if (!normalized) {
    return {};
  }
  return {
    ...(normalized.submissionId ? { clientSubmissionId: normalized.submissionId } : {}),
    ...(normalized.correlationId ? { clientCorrelationId: normalized.correlationId } : {}),
    ...(normalized.clientRequestId ? { clientRequestId: normalized.clientRequestId } : {}),
    ...(normalized.source ? { clientSubmissionSource: normalized.source } : {}),
    ...(normalized.submittedAt ? { clientSubmittedAt: normalized.submittedAt } : {}),
    ...(normalized.sequence !== undefined ? { clientSubmissionSequence: normalized.sequence } : {}),
  };
}

export function summarizeRuntimePromptMessagesForTelemetry(
  messages: readonly RuntimePromptTelemetryMessage[],
): RuntimePromptTelemetrySummary {
  let userMessageCount = 0;
  let textBlockCount = 0;
  let imageCount = 0;
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    userMessageCount += 1;
    if (typeof message.content === "string") {
      if (message.content.trim()) {
        textBlockCount += 1;
      }
      continue;
    }
    if (!Array.isArray(message.content)) {
      continue;
    }
    for (const block of message.content) {
      if (block.type === "text") {
        if (block.text.trim()) {
          textBlockCount += 1;
        }
      } else if (block.type === "image") {
        imageCount += 1;
      }
    }
  }
  return {
    messageCount: messages.length,
    userMessageCount,
    textBlockCount,
    imageCount,
  };
}

export function isRuntimePromptTelemetrySummary(
  value: unknown,
): value is RuntimePromptTelemetrySummary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RuntimePromptTelemetrySummary>;
  return (
    telemetryNumber(candidate.messageCount) !== undefined &&
    telemetryNumber(candidate.userMessageCount) !== undefined &&
    telemetryNumber(candidate.textBlockCount) !== undefined &&
    telemetryNumber(candidate.imageCount) !== undefined
  );
}
