/**
 * Per docs/UX.md, Workflows merges prompts + triggers/schedules in as SEGMENTS
 * (not separate nav rows). These are the four segment ids; the order here is the
 * order the tabs render in.
 */
export type WorkflowSegment = "local" | "remote" | "prompts" | "schedules";

export const WORKFLOW_SEGMENTS: ReadonlyArray<{ id: WorkflowSegment; label: string }> = [
  { id: "local", label: "Local" },
  { id: "remote", label: "Remote" },
  { id: "prompts", label: "Prompts" },
  { id: "schedules", label: "Schedules" },
];
