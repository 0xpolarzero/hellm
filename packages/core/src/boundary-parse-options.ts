import type * as SchemaAST from "effect/SchemaAST";

export const strictBoundaryParseOptions = {
  onExcessProperty: "error",
  errors: "all",
} satisfies SchemaAST.ParseOptions;

export function isPublicSchemaAnnotationKey(key: string): boolean {
  void key;
  return false;
}
