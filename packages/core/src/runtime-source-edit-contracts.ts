import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { AbsolutePath, CommandId } from "./ids";

export const ExtensionSourceKindSchema = Schema.Literals([
  "builtin-extension",
  "user-extension",
  "workflow-agent",
  "workflow-prompt",
  "workflow-component",
  "workflow-workflow",
]);

export type ExtensionSourceKind = typeof ExtensionSourceKindSchema.Type;

export const SourceDiagnosticSchema = Schema.Struct({
  severity: Schema.Literals(["error", "warning", "info"]),
  message: Schema.String,
  code: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(AbsolutePath),
  line: Schema.optionalKey(Schema.Number),
  column: Schema.optionalKey(Schema.Number),
});

export type SourceDiagnostic = typeof SourceDiagnosticSchema.Type;

export const OpenExtensionSourceEditInputSchema = Schema.Struct({
  sourceKind: ExtensionSourceKindSchema,
  sourceId: Schema.String,
});

export type OpenExtensionSourceEditInput = typeof OpenExtensionSourceEditInputSchema.Type;

export const SourceEditSessionSchema = Schema.Struct({
  sourceKind: ExtensionSourceKindSchema,
  sourceId: Schema.String,
  path: AbsolutePath,
  sourceVersion: Schema.String,
  fingerprint: Schema.String,
  text: Schema.String,
  diagnostics: Schema.Array(SourceDiagnosticSchema),
});

export type SourceEditSession = typeof SourceEditSessionSchema.Type;

export const SaveExtensionSourceEditInputSchema = Schema.Struct({
  sourceKind: ExtensionSourceKindSchema,
  sourceId: Schema.String,
  expectedSourceVersion: Schema.String,
  text: Schema.String,
  saveMode: Schema.Literals(["compare-and-swap", "overwrite"]),
  sourceCommandId: Schema.optionalKey(CommandId),
});

export type SaveExtensionSourceEditInput = typeof SaveExtensionSourceEditInputSchema.Type;

export const SourceEditSaveResultSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("saved"),
    sourceVersion: Schema.String,
    fingerprint: Schema.String,
    diagnostics: Schema.Array(SourceDiagnosticSchema),
    reconcileRequired: Schema.Boolean,
  }),
  Schema.Struct({
    status: Schema.Literal("stale"),
    current: SourceEditSessionSchema,
  }),
]);

export type SourceEditSaveResult =
  | {
      readonly status: "saved";
      readonly sourceVersion: string;
      readonly fingerprint: string;
      readonly diagnostics: readonly SourceDiagnostic[];
      readonly reconcileRequired: boolean;
    }
  | {
      readonly status: "stale";
      readonly current: SourceEditSession;
    };

export const decodeOpenExtensionSourceEditInput = Schema.decodeUnknownSync(
  OpenExtensionSourceEditInputSchema,
  strictBoundaryParseOptions,
);
export const decodeOpenExtensionSourceEditInputExit = Schema.decodeUnknownExit(
  OpenExtensionSourceEditInputSchema,
  strictBoundaryParseOptions,
);
export const decodeOpenExtensionSourceEditInputEffect = Schema.decodeUnknownEffect(
  OpenExtensionSourceEditInputSchema,
  strictBoundaryParseOptions,
);
export const decodeSourceEditSession = Schema.decodeUnknownSync(
  SourceEditSessionSchema,
  strictBoundaryParseOptions,
);
export const decodeSourceEditSessionExit = Schema.decodeUnknownExit(
  SourceEditSessionSchema,
  strictBoundaryParseOptions,
);
export const decodeSourceEditSessionEffect = Schema.decodeUnknownEffect(
  SourceEditSessionSchema,
  strictBoundaryParseOptions,
);
export const decodeSaveExtensionSourceEditInput = Schema.decodeUnknownSync(
  SaveExtensionSourceEditInputSchema,
  strictBoundaryParseOptions,
);
export const decodeSaveExtensionSourceEditInputExit = Schema.decodeUnknownExit(
  SaveExtensionSourceEditInputSchema,
  strictBoundaryParseOptions,
);
export const decodeSaveExtensionSourceEditInputEffect = Schema.decodeUnknownEffect(
  SaveExtensionSourceEditInputSchema,
  strictBoundaryParseOptions,
);
export const decodeSourceEditSaveResult = Schema.decodeUnknownSync(
  SourceEditSaveResultSchema,
  strictBoundaryParseOptions,
);
export const decodeSourceEditSaveResultExit = Schema.decodeUnknownExit(
  SourceEditSaveResultSchema,
  strictBoundaryParseOptions,
);
export const decodeSourceEditSaveResultEffect = Schema.decodeUnknownEffect(
  SourceEditSaveResultSchema,
  strictBoundaryParseOptions,
);
