import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";

export const ExternalInstructionActorSchema = Schema.Literals([
  "orchestrator",
  "handler",
  "workflow-task",
]);
export type ExternalInstructionActor = typeof ExternalInstructionActorSchema.Type;

export const ExternalInstructionGlobalRootKindSchema = Schema.Literals(["builtin", "custom"]);
export type ExternalInstructionGlobalRootKind = typeof ExternalInstructionGlobalRootKindSchema.Type;

export interface ExternalInstructionGlobalRootSetting {
  id: string;
  kind: ExternalInstructionGlobalRootKind;
  label: string;
  path: string;
  enabled: boolean;
}

export const ExternalInstructionGlobalRootSettingSchema = Schema.Struct({
  id: Schema.String,
  kind: ExternalInstructionGlobalRootKindSchema,
  label: Schema.String,
  path: Schema.String,
  enabled: Schema.Boolean,
}) as Schema.Codec<ExternalInstructionGlobalRootSetting>;

export interface ExternalInstructionControl {
  enabled: boolean;
  actors: ExternalInstructionActor[];
}

export const ExternalInstructionControlSchema = Schema.Struct({
  enabled: Schema.Boolean,
  actors: Schema.Array(ExternalInstructionActorSchema),
}) as unknown as Schema.Codec<ExternalInstructionControl>;

const ExternalInstructionControlsSchema = Schema.Record(
  Schema.String,
  ExternalInstructionControlSchema,
);

export interface ExternalInstructionsSettings {
  globalRoots: ExternalInstructionGlobalRootSetting[];
  globalControls: Record<string, ExternalInstructionControl>;
  workspaceControls: Record<string, Record<string, ExternalInstructionControl>>;
}

export const ExternalInstructionsSettingsSchema = Schema.Struct({
  globalRoots: Schema.Array(ExternalInstructionGlobalRootSettingSchema),
  globalControls: ExternalInstructionControlsSchema,
  workspaceControls: Schema.Record(Schema.String, ExternalInstructionControlsSchema),
}) as unknown as Schema.Codec<ExternalInstructionsSettings>;

export const DEFAULT_EXTERNAL_INSTRUCTION_ACTORS = [
  "orchestrator",
  "handler",
  "workflow-task",
] as const satisfies readonly ExternalInstructionActor[];

export const DEFAULT_EXTERNAL_INSTRUCTION_GLOBAL_ROOTS = [
  {
    id: "pi",
    kind: "builtin",
    label: "pi",
    path: "~/.config/pi",
    enabled: false,
  },
  {
    id: "codex",
    kind: "builtin",
    label: "Codex",
    path: "~/.codex",
    enabled: false,
  },
  {
    id: "claude",
    kind: "builtin",
    label: "Claude",
    path: "~/.claude",
    enabled: false,
  },
] as const satisfies readonly ExternalInstructionGlobalRootSetting[];

export const DEFAULT_EXTERNAL_INSTRUCTIONS = {
  globalRoots: DEFAULT_EXTERNAL_INSTRUCTION_GLOBAL_ROOTS.map((root) => ({ ...root })),
  globalControls: {},
  workspaceControls: {},
} satisfies ExternalInstructionsSettings;

export const decodeUnknownExternalInstructionsSettingsExit = Schema.decodeUnknownExit(
  ExternalInstructionsSettingsSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownExternalInstructionsSettingsEffect = Schema.decodeUnknownEffect(
  ExternalInstructionsSettingsSchema,
  strictBoundaryParseOptions,
);
export const encodeExternalInstructionsSettingsExit = Schema.encodeExit(
  ExternalInstructionsSettingsSchema,
  strictBoundaryParseOptions,
);
export const encodeExternalInstructionsSettingsEffect = Schema.encodeEffect(
  ExternalInstructionsSettingsSchema,
  strictBoundaryParseOptions,
);
