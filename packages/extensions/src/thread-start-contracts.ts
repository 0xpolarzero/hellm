import * as Schema from "effect/Schema";
import { ExtensionUsageStateSchema, ThreadGroupId, strictBoundaryParseOptions } from "@svvy/core";

const ThreadStartOverridesSchema = Schema.Record(
  Schema.String.check(Schema.isNonEmpty()),
  ExtensionUsageStateSchema,
);

export const ThreadStartItemInputSchema = Schema.Struct({
  objective: Schema.String.check(Schema.isNonEmpty()),
  history: Schema.optionalKey(Schema.Literals(["isolated", "forked"])),
  overrides: Schema.optionalKey(ThreadStartOverridesSchema),
});

export type ThreadStartItemInput = typeof ThreadStartItemInputSchema.Type;

export const ThreadStartInputSchema = Schema.Struct({
  threadGroupId: Schema.optionalKey(ThreadGroupId),
  threads: Schema.Array(ThreadStartItemInputSchema).check(Schema.isNonEmpty()),
});

export type ThreadStartInput = typeof ThreadStartInputSchema.Type;

export const decodeThreadStartInputExit = Schema.decodeUnknownExit(
  ThreadStartInputSchema,
  strictBoundaryParseOptions,
);
export const decodeThreadStartInputEffect = Schema.decodeUnknownEffect(
  ThreadStartInputSchema,
  strictBoundaryParseOptions,
);
