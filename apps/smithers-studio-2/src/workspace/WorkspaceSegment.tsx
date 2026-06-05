export type WorkspaceSegmentId = "terminal" | "chat";

/**
 * Segmented control that swaps the Workspace pane between the existing Ghostty
 * terminal and the agent chat. Visual contract per docs/DESIGN.md: pill radius,
 * accent fill on the selected segment, quiet otherwise.
 */
export function WorkspaceSegment({
  value,
  onChange,
}: {
  value: WorkspaceSegmentId;
  onChange: (id: WorkspaceSegmentId) => void;
}) {
  return (
    <div aria-label="Workspace mode" className="ws-segment" role="tablist">
      {SEGMENTS.map((segment) => {
        const selected = segment.id === value;
        return (
          <button
            aria-selected={selected}
            className={selected ? "ws-segment-btn ws-segment-btn--active" : "ws-segment-btn"}
            data-testid={`ws-segment-${segment.id}`}
            key={segment.id}
            onClick={() => onChange(segment.id)}
            role="tab"
            type="button"
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}

const SEGMENTS: ReadonlyArray<{ id: WorkspaceSegmentId; label: string }> = [
  { id: "terminal", label: "Terminal" },
  { id: "chat", label: "Chat" },
];
