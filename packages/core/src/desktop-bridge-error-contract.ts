import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { BoundaryIssueSchema, type BoundaryIssue } from "./errors";
import { CommandId, RuntimeClientRequestId } from "./ids";
import {
  PromptTargetSchema,
  RuntimeClientSubmissionInputSchema,
  RuntimeSubmittedAttachmentSchema,
} from "./runtime-contracts";

export const DesktopBridgeErrorReasonSchema = Schema.Literals([
  "invalid-input",
  "invalid-panel-binding",
  "state-facade-failed",
  "runtime-facade-failed",
  "renderer-disconnected",
  "desktop-shutdown",
]);
export type DesktopBridgeErrorReason = typeof DesktopBridgeErrorReasonSchema.Type;

export const DesktopBridgeErrorContractSchema = Schema.Struct({
  operation: Schema.String,
  reason: DesktopBridgeErrorReasonSchema,
  message: Schema.String,
  issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
  cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
});
export type DesktopBridgeErrorContract = typeof DesktopBridgeErrorContractSchema.Type;

export const decodeUnknownDesktopBridgeErrorContractExit = Schema.decodeUnknownExit(
  DesktopBridgeErrorContractSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownDesktopBridgeErrorContractEffect = Schema.decodeUnknownEffect(
  DesktopBridgeErrorContractSchema,
  strictBoundaryParseOptions,
);
export const encodeDesktopBridgeErrorContractExit = Schema.encodeExit(
  DesktopBridgeErrorContractSchema,
  strictBoundaryParseOptions,
);
export const encodeDesktopBridgeErrorContractEffect = Schema.encodeEffect(
  DesktopBridgeErrorContractSchema,
  strictBoundaryParseOptions,
);

const encodeDesktopBridgeDefect = Schema.encodeUnknownSync(
  Schema.Defect({ excludeCause: true }),
  strictBoundaryParseOptions,
);

export const DesktopSubmitPromptRequestSchema = Schema.Struct({
  panelId: Schema.String,
  target: PromptTargetSchema,
  text: Schema.String,
  attachments: Schema.optionalKey(Schema.Array(RuntimeSubmittedAttachmentSchema)),
  clientRequestId: RuntimeClientRequestId,
});
export type DesktopSubmitPromptRequest = typeof DesktopSubmitPromptRequestSchema.Type;

export const DesktopWriteCommandStdinRequestSchema = Schema.Struct({
  commandId: CommandId,
  text: Schema.String,
  clientSubmission: Schema.optionalKey(RuntimeClientSubmissionInputSchema),
});
export type DesktopWriteCommandStdinRequest = typeof DesktopWriteCommandStdinRequestSchema.Type;

export const decodeUnknownDesktopSubmitPromptRequestExit = Schema.decodeUnknownExit(
  DesktopSubmitPromptRequestSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownDesktopWriteCommandStdinRequestExit = Schema.decodeUnknownExit(
  DesktopWriteCommandStdinRequestSchema,
  strictBoundaryParseOptions,
);

export function normalizeDesktopBridgeErrorContract(input: {
  readonly operation: string;
  readonly reason: DesktopBridgeErrorReason;
  readonly message: string;
  readonly issues?: readonly BoundaryIssue[];
  readonly cause?: unknown;
}): DesktopBridgeErrorContract {
  const candidate = {
    operation: input.operation,
    reason: input.reason,
    message: input.message,
    ...(input.issues ? { issues: input.issues } : {}),
    ...(input.cause !== undefined ? { cause: encodeDesktopBridgeDefect(input.cause) } : {}),
  };
  const decoded = decodeUnknownDesktopBridgeErrorContractExit(candidate);
  if (Exit.isSuccess(decoded)) {
    return decoded.value;
  }
  return {
    operation: input.operation,
    reason: input.reason,
    message: input.message,
  };
}
