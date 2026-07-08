import * as Schema from "effect/Schema";
import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { IsoDateTimeStringSchema } from "./ids";

export type WorkspaceSessionNavigationSectionId = "pinned" | "active" | "archived";
export const WorkspaceSessionNavigationSectionIdSchema = Schema.Literals([
  "pinned",
  "active",
  "archived",
]);

export const WorkspaceSessionNavigationSectionStateSchema = Schema.Struct({
  collapsed: Schema.Boolean,
  sizePx: Schema.Number,
});
export type WorkspaceSessionNavigationSectionState =
  typeof WorkspaceSessionNavigationSectionStateSchema.Encoded;

export const WorkspaceSessionNavigationSummarySchema = Schema.Struct({
  isPinned: Schema.Boolean,
  pinnedAt: Schema.NullOr(IsoDateTimeStringSchema),
  isArchived: Schema.Boolean,
  archivedAt: Schema.NullOr(IsoDateTimeStringSchema),
  updatedAt: IsoDateTimeStringSchema,
});
export type WorkspaceSessionNavigationSummary =
  typeof WorkspaceSessionNavigationSummarySchema.Encoded;

export interface WorkspaceSessionNavigationReadModel<
  Session extends WorkspaceSessionNavigationSummary = WorkspaceSessionNavigationSummary,
> {
  pinnedSessions: Session[];
  activeSessions: Session[];
  sections: Record<WorkspaceSessionNavigationSectionId, WorkspaceSessionNavigationSectionState>;
  archived: {
    collapsed: boolean;
    sessions: Session[];
  };
}
export const WorkspaceSessionNavigationReadModelSchema = Schema.Struct({
  pinnedSessions: Schema.Array(WorkspaceSessionNavigationSummarySchema),
  activeSessions: Schema.Array(WorkspaceSessionNavigationSummarySchema),
  sections: Schema.Struct({
    pinned: WorkspaceSessionNavigationSectionStateSchema,
    active: WorkspaceSessionNavigationSectionStateSchema,
    archived: WorkspaceSessionNavigationSectionStateSchema,
  }),
  archived: Schema.Struct({
    collapsed: Schema.Boolean,
    sessions: Schema.Array(WorkspaceSessionNavigationSummarySchema),
  }),
});

export const decodeUnknownWorkspaceSessionNavigationReadModelExit = Schema.decodeUnknownExit(
  WorkspaceSessionNavigationReadModelSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownWorkspaceSessionNavigationReadModelEffect = Schema.decodeUnknownEffect(
  WorkspaceSessionNavigationReadModelSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkspaceSessionNavigationReadModelExit = Schema.encodeExit(
  WorkspaceSessionNavigationReadModelSchema,
  strictBoundaryParseOptions,
);
export const encodeWorkspaceSessionNavigationReadModelEffect = Schema.encodeEffect(
  WorkspaceSessionNavigationReadModelSchema,
  strictBoundaryParseOptions,
);
