import * as Schema from "effect/Schema";

import { MessageId, SurfacePiSessionId } from "./ids";

export const PiSessionRefSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
});
export type PiSessionRef = typeof PiSessionRefSchema.Type;

export const PiHistoryEntryRefSchema = Schema.Struct({
  session: PiSessionRefSchema,
  entryId: Schema.String,
  messageId: Schema.optionalKey(MessageId),
});
export type PiHistoryEntryRef = typeof PiHistoryEntryRefSchema.Type;
