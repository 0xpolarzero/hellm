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

export function normalizeExternalInstructionsSettings(
  input: ExternalInstructionsSettings | undefined,
): ExternalInstructionsSettings {
  const rootsById = new Map(
    (input?.globalRoots ?? []).map(
      (root) => [typeof root.id === "string" ? root.id.trim() : "", root] as const,
    ),
  );
  const globalRoots: ExternalInstructionGlobalRootSetting[] = [
    ...DEFAULT_EXTERNAL_INSTRUCTION_GLOBAL_ROOTS.map((root) => {
      const configured = rootsById.get(root.id);
      return {
        ...root,
        path:
          typeof configured?.path === "string" && configured.path.trim()
            ? configured.path.trim()
            : root.path,
        enabled: typeof configured?.enabled === "boolean" ? configured.enabled : root.enabled,
      };
    }),
    ...(input?.globalRoots ?? [])
      .filter((root) => root.kind === "custom")
      .map((root) => ({
        id: typeof root.id === "string" ? root.id.trim() : "",
        kind: "custom" as const,
        label: typeof root.label === "string" && root.label.trim() ? root.label.trim() : "Custom",
        path: typeof root.path === "string" ? root.path.trim() : "",
        enabled: root.enabled !== false,
      }))
      .filter((root) => root.id && root.path),
  ];
  const normalizeControls = (
    controls: Record<string, ExternalInstructionControl> | undefined,
  ): Record<string, ExternalInstructionControl> =>
    Object.fromEntries(
      Object.entries(controls ?? {})
        .map(([rawPath, control]) => {
          const allowedActors = new Set<ExternalInstructionActor>(
            DEFAULT_EXTERNAL_INSTRUCTION_ACTORS,
          );
          const actors = Array.isArray(control?.actors)
            ? control.actors.filter((actor): actor is ExternalInstructionActor =>
                allowedActors.has(actor as ExternalInstructionActor),
              )
            : [];
          return [
            rawPath.trim(),
            {
              enabled: control?.enabled !== false,
              actors: [...new Set(actors)].toSorted(),
            },
          ] as const;
        })
        .filter(([path]) => Boolean(path)),
    );

  return {
    globalRoots,
    globalControls: normalizeControls(input?.globalControls),
    workspaceControls: Object.fromEntries(
      Object.entries(input?.workspaceControls ?? {})
        .map(
          ([rawWorkspaceKey, controls]) =>
            [rawWorkspaceKey.trim(), normalizeControls(controls)] as const,
        )
        .filter(([workspaceKey]) => Boolean(workspaceKey)),
    ),
  };
}

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
