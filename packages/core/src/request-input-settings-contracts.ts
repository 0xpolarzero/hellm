import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { PositiveDurationMsSchema } from "./ids";

export const RequestInputVariantSchema = Schema.Literals(["nonblocking", "blocking"]);
export type RequestInputVariant = typeof RequestInputVariantSchema.Type;

export const RequestInputBlockingTimeoutSettingsSchema = Schema.Struct({
  enabled: Schema.Boolean,
  durationMs: PositiveDurationMsSchema,
});
export type RequestInputBlockingTimeoutSettings =
  typeof RequestInputBlockingTimeoutSettingsSchema.Type;

export const RequestInputSettingsSchema = Schema.Struct({
  mode: RequestInputVariantSchema,
  blockingTimeout: RequestInputBlockingTimeoutSettingsSchema,
});
export type RequestInputSettings = typeof RequestInputSettingsSchema.Type;

export const SetRequestInputVariantInputSchema = Schema.Struct({
  mode: RequestInputVariantSchema,
});
export type SetRequestInputVariantInput = typeof SetRequestInputVariantInputSchema.Type;
export const SetRequestInputVariantResultSchema = RequestInputSettingsSchema;
export type SetRequestInputVariantResult = RequestInputSettings;

export const SetRequestInputBlockingTimeoutInputSchema = RequestInputBlockingTimeoutSettingsSchema;
export type SetRequestInputBlockingTimeoutInput =
  typeof SetRequestInputBlockingTimeoutInputSchema.Type;
export const SetRequestInputBlockingTimeoutResultSchema = RequestInputSettingsSchema;
export type SetRequestInputBlockingTimeoutResult = RequestInputSettings;

export const decodeUnknownRequestInputSettingsExit = Schema.decodeUnknownExit(
  RequestInputSettingsSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRequestInputSettingsEffect = Schema.decodeUnknownEffect(
  RequestInputSettingsSchema,
  strictBoundaryParseOptions,
);
export const encodeRequestInputSettingsExit = Schema.encodeExit(
  RequestInputSettingsSchema,
  strictBoundaryParseOptions,
);
export const encodeRequestInputSettingsEffect = Schema.encodeEffect(
  RequestInputSettingsSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSetRequestInputVariantInputExit = Schema.decodeUnknownExit(
  SetRequestInputVariantInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetRequestInputVariantInputEffect = Schema.decodeUnknownEffect(
  SetRequestInputVariantInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetRequestInputVariantInputExit = Schema.encodeExit(
  SetRequestInputVariantInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetRequestInputVariantInputEffect = Schema.encodeEffect(
  SetRequestInputVariantInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetRequestInputVariantResultExit = Schema.decodeUnknownExit(
  SetRequestInputVariantResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetRequestInputVariantResultEffect = Schema.decodeUnknownEffect(
  SetRequestInputVariantResultSchema,
  strictBoundaryParseOptions,
);
export const encodeSetRequestInputVariantResultExit = Schema.encodeExit(
  SetRequestInputVariantResultSchema,
  strictBoundaryParseOptions,
);
export const encodeSetRequestInputVariantResultEffect = Schema.encodeEffect(
  SetRequestInputVariantResultSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownSetRequestInputBlockingTimeoutInputExit = Schema.decodeUnknownExit(
  SetRequestInputBlockingTimeoutInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetRequestInputBlockingTimeoutInputEffect = Schema.decodeUnknownEffect(
  SetRequestInputBlockingTimeoutInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetRequestInputBlockingTimeoutInputExit = Schema.encodeExit(
  SetRequestInputBlockingTimeoutInputSchema,
  strictBoundaryParseOptions,
);
export const encodeSetRequestInputBlockingTimeoutInputEffect = Schema.encodeEffect(
  SetRequestInputBlockingTimeoutInputSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetRequestInputBlockingTimeoutResultExit = Schema.decodeUnknownExit(
  SetRequestInputBlockingTimeoutResultSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSetRequestInputBlockingTimeoutResultEffect = Schema.decodeUnknownEffect(
  SetRequestInputBlockingTimeoutResultSchema,
  strictBoundaryParseOptions,
);
export const encodeSetRequestInputBlockingTimeoutResultExit = Schema.encodeExit(
  SetRequestInputBlockingTimeoutResultSchema,
  strictBoundaryParseOptions,
);
export const encodeSetRequestInputBlockingTimeoutResultEffect = Schema.encodeEffect(
  SetRequestInputBlockingTimeoutResultSchema,
  strictBoundaryParseOptions,
);
