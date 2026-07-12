import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { CommandId } from "./ids";

export const SvvyxWorkflowsRuntimeRequestSchema = Schema.Struct({
  operation: Schema.Literal("build"),
  input: Schema.Struct({ sourceCommandId: Schema.optionalKey(CommandId) }),
});
export type SvvyxWorkflowsRuntimeRequest = typeof SvvyxWorkflowsRuntimeRequestSchema.Type;

export const SvvyxWorkflowsRuntimeIntentSchema = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  kind: Schema.Literal("workflows.runtime_request"),
  request: SvvyxWorkflowsRuntimeRequestSchema,
});
export type SvvyxWorkflowsRuntimeIntent = typeof SvvyxWorkflowsRuntimeIntentSchema.Type;

export const SvvyxWorkflowsRuntimeResponseSchema = Schema.Struct({
  output: Schema.Json,
  commandFacts: Schema.Record(Schema.String, Schema.Json),
});
export type SvvyxWorkflowsRuntimeResponse = typeof SvvyxWorkflowsRuntimeResponseSchema.Type;

export const decodeUnknownSvvyxWorkflowsRuntimeIntentExit = Schema.decodeUnknownExit(
  SvvyxWorkflowsRuntimeIntentSchema,
  strictBoundaryParseOptions,
);
