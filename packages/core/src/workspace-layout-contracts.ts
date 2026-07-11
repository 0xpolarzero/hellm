import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import {
  AbsolutePath,
  AgentProfileId,
  ArtifactId,
  CommandId,
  ExtensionId,
  IsoDateTimeStringSchema,
  JsonValue,
  NonNegativeSafeIntegerSchema,
  SurfacePiSessionId,
  ThreadId,
  WorkflowTaskAttemptId,
  WorkspaceId,
  WorkspacePaneId,
  WorkspaceSessionId,
  WorkspaceTabId,
} from "./ids";

export const WorkspaceLayoutSlotIdSchema = Schema.Literals(["A", "B", "C"]);
export type WorkspaceLayoutSlotId = typeof WorkspaceLayoutSlotIdSchema.Type;

export const WorkspaceKindSchema = Schema.Literals(["default", "user"]);
export type WorkspaceKind = typeof WorkspaceKindSchema.Type;

const NonEmptyStringSchema = Schema.String.check(Schema.isPattern(/\S/));

export const WorkspaceTabRecordSchema = Schema.Struct({
  workspaceTabId: WorkspaceTabId,
  workspaceId: WorkspaceId,
  cwd: AbsolutePath,
  workspaceLabel: NonEmptyStringSchema,
  kind: WorkspaceKindSchema,
  openedAt: IsoDateTimeStringSchema,
  activeLayoutId: WorkspaceLayoutSlotIdSchema,
});
export type WorkspaceTabRecord = typeof WorkspaceTabRecordSchema.Type;

const WorkspaceChromeReadModelFieldsSchema = Schema.Struct({
  activeWorkspaceTabId: Schema.NullOr(WorkspaceTabId),
  tabs: Schema.Array(WorkspaceTabRecordSchema),
  knownWorkspaces: Schema.Array(WorkspaceTabRecordSchema),
});
type WorkspaceChromeReadModelFields = typeof WorkspaceChromeReadModelFieldsSchema.Type;

const WorkspaceChromeInvariant = Schema.makeFilter(
  (input: WorkspaceChromeReadModelFields) => {
    const openIds = input.tabs.map((tab) => tab.workspaceTabId);
    if (new Set(openIds).size !== openIds.length) {
      return { path: ["tabs"], issue: "workspace tab ids must be unique" };
    }
    const knownIds = input.knownWorkspaces.map((tab) => tab.workspaceTabId);
    if (new Set(knownIds).size !== knownIds.length) {
      return { path: ["knownWorkspaces"], issue: "known workspace tab ids must be unique" };
    }
    if (input.activeWorkspaceTabId !== null && !openIds.includes(input.activeWorkspaceTabId)) {
      return {
        path: ["activeWorkspaceTabId"],
        issue: "active workspace tab id must identify an open tab",
      };
    }
    return true;
  },
  { expected: "coherent workspace chrome tab identity" },
);

export const WorkspaceChromeReadModelSchema = WorkspaceChromeReadModelFieldsSchema.pipe(
  Schema.check(WorkspaceChromeInvariant),
);
export type WorkspaceChromeReadModel = typeof WorkspaceChromeReadModelSchema.Type;

export const WorkspacePaneTargetSchema = Schema.Union([
  Schema.Struct({
    surface: Schema.Literal("orchestrator"),
    workspaceSessionId: WorkspaceSessionId,
    surfacePiSessionId: SurfacePiSessionId,
  }),
  Schema.Struct({
    surface: Schema.Literal("handler"),
    workspaceSessionId: WorkspaceSessionId,
    surfacePiSessionId: SurfacePiSessionId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    surface: Schema.Literal("command"),
    workspaceSessionId: WorkspaceSessionId,
    commandId: CommandId,
  }),
  Schema.Struct({
    surface: Schema.Literal("workflow-task-attempt"),
    workspaceSessionId: WorkspaceSessionId,
    workflowTaskAttemptId: WorkflowTaskAttemptId,
  }),
  Schema.Struct({
    surface: Schema.Literal("artifact"),
    workspaceSessionId: WorkspaceSessionId,
    artifactId: ArtifactId,
  }),
  Schema.Struct({ surface: Schema.Literal("workflows") }),
  Schema.Struct({
    surface: Schema.Literal("agents"),
    targetAgentProfileId: Schema.optionalKey(AgentProfileId),
    view: Schema.optionalKey(Schema.Literals(["profiles", "generated-context-preview"])),
  }),
  Schema.Struct({
    surface: Schema.Literal("extensions"),
    targetExtensionId: Schema.optionalKey(ExtensionId),
    view: Schema.optionalKey(Schema.Literals(["inventory", "generated-context-preview"])),
  }),
  Schema.Struct({ surface: Schema.Literal("snippets") }),
  Schema.Struct({ surface: Schema.Literal("settings") }),
  Schema.Struct({
    surface: Schema.Literal("app-logs"),
    workspaceSessionId: Schema.optionalKey(WorkspaceSessionId),
  }),
  Schema.Struct({ surface: Schema.Literal("open-workspace") }),
]);
export type WorkspacePaneTarget = typeof WorkspacePaneTargetSchema.Type;

const FiniteNumberSchema = Schema.Number.check(Schema.isFinite());
const PositiveFiniteNumberSchema = FiniteNumberSchema.check(Schema.isGreaterThan(0));

export const WorkspacePaneLocalStateSchema = Schema.Struct({
  scroll: Schema.NullOr(
    Schema.Struct({
      transcriptAnchorId: Schema.NullOr(Schema.String),
      offsetPx: FiniteNumberSchema,
    }),
  ),
  timelineDensity: Schema.Literals(["compact", "comfortable"]),
});
export type WorkspacePaneLocalState = typeof WorkspacePaneLocalStateSchema.Type;

export const WorkspacePaneFallbackChromeKindSchema = Schema.Literals([
  "orchestrator",
  "handler-thread",
  "artifact",
  "workflows",
  "agents",
  "extensions",
  "snippets",
  "settings",
  "app-logs",
  "open-workspace",
  "command",
  "workflow-task-attempt",
]);
export type WorkspacePaneFallbackChromeKind = typeof WorkspacePaneFallbackChromeKindSchema.Type;

export const WorkspacePaneFallbackChromeSchema = Schema.Struct({
  title: NonEmptyStringSchema,
  subtitle: Schema.NullOr(Schema.String),
  kind: WorkspacePaneFallbackChromeKindSchema,
});
export type WorkspacePaneFallbackChrome = typeof WorkspacePaneFallbackChromeSchema.Type;

export const WorkspacePanePlacementSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("split"),
    referencePanelId: WorkspacePaneId,
    direction: Schema.Literals(["left", "right", "above", "below"]),
    size: Schema.optionalKey(FiniteNumberSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("tab"),
    groupId: Schema.String,
    index: Schema.optionalKey(NonNegativeSafeIntegerSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("edge"),
    direction: Schema.Literals(["left", "right", "above", "below"]),
    size: Schema.optionalKey(FiniteNumberSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("floating"),
    box: Schema.optionalKey(
      Schema.Struct({
        x: FiniteNumberSchema,
        y: FiniteNumberSchema,
        width: PositiveFiniteNumberSchema,
        height: PositiveFiniteNumberSchema,
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("popout"),
    box: Schema.optionalKey(
      Schema.Struct({
        left: FiniteNumberSchema,
        top: FiniteNumberSchema,
        width: PositiveFiniteNumberSchema,
        height: PositiveFiniteNumberSchema,
      }),
    ),
  }),
]);
export type WorkspacePanePlacement = typeof WorkspacePanePlacementSchema.Type;

const WorkspacePaneCommonFields = {
  paneId: WorkspacePaneId,
  target: WorkspacePaneTargetSchema,
  localState: WorkspacePaneLocalStateSchema,
  placement: Schema.NullOr(WorkspacePanePlacementSchema),
};

export const WorkspacePaneRecordSchema = Schema.Union([
  Schema.Struct({
    ...WorkspacePaneCommonFields,
    fallbackChrome: Schema.Null,
    restore: Schema.Struct({ kind: Schema.Literal("ready") }),
  }),
  Schema.Struct({
    ...WorkspacePaneCommonFields,
    fallbackChrome: WorkspacePaneFallbackChromeSchema,
    restore: Schema.Struct({
      kind: Schema.Literal("unavailable"),
      reason: NonEmptyStringSchema,
      lastKnownLocationLabel: Schema.NullOr(NonEmptyStringSchema),
    }),
  }),
]);
export type WorkspacePaneRecord = typeof WorkspacePaneRecordSchema.Type;

export const CompactWorkspaceSurfaceSchema = Schema.Struct({
  kind: Schema.Literal("compact-thread"),
  workspaceSessionId: WorkspaceSessionId,
  threadId: ThreadId,
  panelId: Schema.NullOr(WorkspacePaneId),
  density: Schema.Literals(["compact", "comfortable"]),
});
export type CompactWorkspaceSurface = typeof CompactWorkspaceSurfaceSchema.Type;

const WorkspaceLayoutSlotContentFields = {
  dockviewJson: Schema.NullOr(JsonValue),
  panes: Schema.Array(WorkspacePaneRecordSchema),
  compactSurfaces: Schema.Array(CompactWorkspaceSurfaceSchema),
  focusedPaneId: Schema.NullOr(WorkspacePaneId),
};

export const WorkspaceLayoutSlotContentSchema = Schema.Struct(WorkspaceLayoutSlotContentFields);
export type WorkspaceLayoutSlotContent = typeof WorkspaceLayoutSlotContentSchema.Type;

export const WorkspaceLayoutSlotContentInvariant = Schema.makeFilter(
  (input: WorkspaceLayoutSlotContent) => {
    const paneIds = input.panes.map((pane) => pane.paneId);
    const uniquePaneIds = new Set(paneIds);
    if (uniquePaneIds.size !== paneIds.length) {
      return { path: ["panes"], issue: "workspace pane ids must be unique within a slot" };
    }
    if (input.focusedPaneId !== null && !uniquePaneIds.has(input.focusedPaneId)) {
      return {
        path: ["focusedPaneId"],
        issue: "focused pane id must identify a pane in the slot",
      };
    }
    const missingCompactPane = input.compactSurfaces.find(
      (surface) => surface.panelId !== null && !uniquePaneIds.has(surface.panelId),
    );
    if (missingCompactPane) {
      return {
        path: ["compactSurfaces"],
        issue: "compact surface panel id must identify a pane in the slot",
      };
    }
    return true;
  },
  { expected: "coherent workspace layout slot pane identity" },
);

export const CheckedWorkspaceLayoutSlotContentSchema = WorkspaceLayoutSlotContentSchema.pipe(
  Schema.check(WorkspaceLayoutSlotContentInvariant),
);

const WorkspaceLayoutSlotReadModelFieldsSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  layoutId: WorkspaceLayoutSlotIdSchema,
  initialized: Schema.Boolean,
  ...WorkspaceLayoutSlotContentFields,
  updatedAt: IsoDateTimeStringSchema,
});

export const WorkspaceLayoutSlotReadModelSchema = WorkspaceLayoutSlotReadModelFieldsSchema.pipe(
  Schema.check(WorkspaceLayoutSlotContentInvariant),
);
export type WorkspaceLayoutSlotReadModel = typeof WorkspaceLayoutSlotReadModelSchema.Type;

const WorkspaceLayoutReadModelFieldsSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  slots: Schema.Array(WorkspaceLayoutSlotReadModelSchema),
});
type WorkspaceLayoutReadModelFields = typeof WorkspaceLayoutReadModelFieldsSchema.Type;

const WorkspaceLayoutInvariant = Schema.makeFilter(
  (input: WorkspaceLayoutReadModelFields) => {
    const slotIds = input.slots.map((slot) => slot.layoutId);
    if (
      input.slots.length !== 3 ||
      !(["A", "B", "C"] as const).every((layoutId) => slotIds.includes(layoutId))
    ) {
      return {
        path: ["slots"],
        issue: "workspace layout must contain exactly one A, B, and C slot",
      };
    }
    if (input.slots.some((slot) => slot.workspaceId !== input.workspaceId)) {
      return {
        path: ["slots"],
        issue: "every workspace layout slot must belong to the read-model workspace",
      };
    }
    return true;
  },
  { expected: "one coherent A/B/C workspace layout slot set" },
);

export const WorkspaceLayoutReadModelSchema = WorkspaceLayoutReadModelFieldsSchema.pipe(
  Schema.check(WorkspaceLayoutInvariant),
);
export type WorkspaceLayoutReadModel = typeof WorkspaceLayoutReadModelSchema.Type;

export const decodeUnknownWorkspaceChromeReadModelExit = Schema.decodeUnknownExit(
  WorkspaceChromeReadModelSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownWorkspaceChromeReadModelEffect = Schema.decodeUnknownEffect(
  WorkspaceChromeReadModelSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkspaceChromeReadModelExit = Schema.encodeExit(
  WorkspaceChromeReadModelSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkspaceChromeReadModelEffect = Schema.encodeEffect(
  WorkspaceChromeReadModelSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownWorkspacePaneRecordExit = Schema.decodeUnknownExit(
  WorkspacePaneRecordSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownWorkspacePaneRecordEffect = Schema.decodeUnknownEffect(
  WorkspacePaneRecordSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkspacePaneRecordExit = Schema.encodeExit(
  WorkspacePaneRecordSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkspacePaneRecordEffect = Schema.encodeEffect(
  WorkspacePaneRecordSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownWorkspaceLayoutSlotReadModelExit = Schema.decodeUnknownExit(
  WorkspaceLayoutSlotReadModelSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownWorkspaceLayoutSlotReadModelEffect = Schema.decodeUnknownEffect(
  WorkspaceLayoutSlotReadModelSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkspaceLayoutSlotReadModelExit = Schema.encodeExit(
  WorkspaceLayoutSlotReadModelSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkspaceLayoutSlotReadModelEffect = Schema.encodeEffect(
  WorkspaceLayoutSlotReadModelSchema,
  strictBoundaryParseOptions,
);

export const decodeUnknownWorkspaceLayoutReadModelExit = Schema.decodeUnknownExit(
  WorkspaceLayoutReadModelSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownWorkspaceLayoutReadModelEffect = Schema.decodeUnknownEffect(
  WorkspaceLayoutReadModelSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkspaceLayoutReadModelExit = Schema.encodeExit(
  WorkspaceLayoutReadModelSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkspaceLayoutReadModelEffect = Schema.encodeEffect(
  WorkspaceLayoutReadModelSchema,
  strictBoundaryParseOptions,
);
