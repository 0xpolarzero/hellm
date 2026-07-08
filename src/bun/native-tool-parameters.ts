import type { NativeToolDeclaration } from "@svvy/core";

/**
 * Cast a typebox JSON Schema object into the product `NativeToolDeclaration.parameters`
 * JSON value. Native tool parameter schemas in `src/bun` are authored as typebox
 * `Type.Object(...)` schemas so `Static<typeof schema>` can derive the typed handler
 * params, but the `NativeToolDeclaration.parameters` contract is a normalized JSON
 * Schema object (`Json`). The typebox `TObject` is structurally that JSON Schema
 * object; this helper marks the JSON-boundary projection.
 */
export function nativeToolParameters(schema: unknown): NativeToolDeclaration["parameters"] {
  return schema as NativeToolDeclaration["parameters"];
}
