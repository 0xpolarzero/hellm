import * as Schema from "effect/Schema";
import {
  RequestInputQuestionRequestSchema,
  RequestUserInputResolvedAnswerSchema,
  strictBoundaryParseOptions,
} from "@svvy/core";

export const RequestUserInputInputSchema = Schema.Struct({
  questions: Schema.Array(RequestInputQuestionRequestSchema).pipe(
    Schema.check(Schema.isLengthBetween(1, 3)),
  ),
});

export type RequestUserInputInput = typeof RequestUserInputInputSchema.Type;

export const RequestUserInputResultSchema = Schema.Struct({
  answers: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      question: Schema.String,
      answer: RequestUserInputResolvedAnswerSchema,
      answeredBy: Schema.Literals(["user", "default", "timeout_default"]),
    }),
  ),
});

export type RequestUserInputResult = typeof RequestUserInputResultSchema.Type;

export const decodeRequestUserInputInput = Schema.decodeUnknownSync(
  RequestUserInputInputSchema,
  strictBoundaryParseOptions,
);
export const decodeRequestUserInputInputExit = Schema.decodeUnknownExit(
  RequestUserInputInputSchema,
  strictBoundaryParseOptions,
);
export const decodeRequestUserInputInputEffect = Schema.decodeUnknownEffect(
  RequestUserInputInputSchema,
  strictBoundaryParseOptions,
);
export const decodeRequestUserInputResult = Schema.decodeUnknownSync(
  RequestUserInputResultSchema,
  strictBoundaryParseOptions,
);
export const decodeRequestUserInputResultExit = Schema.decodeUnknownExit(
  RequestUserInputResultSchema,
  strictBoundaryParseOptions,
);
export const decodeRequestUserInputResultEffect = Schema.decodeUnknownEffect(
  RequestUserInputResultSchema,
  strictBoundaryParseOptions,
);
