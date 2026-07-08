import * as Schema from "effect/Schema";
import { AbsolutePath, PositiveDurationMsSchema } from "@svvy/core";

export const StateLayerConfigSchema = Schema.Struct({
  databasePath: AbsolutePath,
  artifactRoot: AbsolutePath,
  busyTimeoutMs: PositiveDurationMsSchema,
  sandboxPolicy: Schema.optionalKey(
    Schema.Struct({
      generatedOutputRoots: Schema.optionalKey(Schema.Array(AbsolutePath)),
      extensionDependencyRoots: Schema.optionalKey(Schema.Array(AbsolutePath)),
      temporaryRoots: Schema.optionalKey(Schema.Array(AbsolutePath)),
    }),
  ),
});
export type StateLayerConfig = typeof StateLayerConfigSchema.Type;
