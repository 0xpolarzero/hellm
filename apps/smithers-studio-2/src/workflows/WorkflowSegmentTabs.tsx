import { WORKFLOW_SEGMENTS, type WorkflowSegment } from "./WorkflowSegment";

/**
 * The Local / Remote / Prompts / Schedules segmented control. These are SEGMENTS
 * inside the Workflows surface, not separate nav rows (.smithers/specs/UX.md).
 */
export function WorkflowSegmentTabs({
  active,
  onSelect,
}: {
  active: WorkflowSegment;
  onSelect: (segment: WorkflowSegment) => void;
}) {
  return (
    <div className="wf-segments" role="tablist" aria-label="Workflow segments">
      {WORKFLOW_SEGMENTS.map((segment) => {
        const selected = segment.id === active;
        return (
          <button
            key={segment.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`wf-segment${selected ? " wf-segment--active" : ""}`}
            data-testid={`wf.segment.${segment.id}`}
            onClick={() => onSelect(segment.id)}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
