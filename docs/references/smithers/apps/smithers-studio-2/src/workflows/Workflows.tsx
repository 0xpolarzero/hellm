import { useMemo, useState } from "react";
import "./workflows.css";
import { useStudioStore } from "../useStudioStore";
import type { WorkflowSegment } from "./WorkflowSegment";
import { WorkflowSegmentTabs } from "./WorkflowSegmentTabs";
import { WorkflowList } from "./WorkflowList";
import { WorkflowDetail } from "./WorkflowDetail";
import { useWorkflowList } from "./useWorkflowList";
import { useWorkflowLaunchHandoff } from "./workflowLaunchHandoff";

/**
 * Workflows surface. Browse a list of launchable things across four SEGMENTS
 * (Local / Remote / Prompts / Schedules — prompts and triggers/schedules merged
 * in per docs/UX.md), view a selected workflow's source/summary, and LAUNCH it
 * with arguments. Launching creates a run, stores the new run id in this folder's
 * handoff slice, and routes to the Runs surface with that run selected — without
 * touching useStudioStore beyond the shared setActiveView entrypoint.
 */
export function Workflows() {
  const [segment, setSegment] = useState<WorkflowSegment>("local");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { entries, loading, error } = useWorkflowList(segment);
  const setActiveView = useStudioStore((state) => state.setActiveView);
  const setPendingRun = useWorkflowLaunchHandoff((state) => state.setPendingRun);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.key === selectedKey) ?? null,
    [entries, selectedKey],
  );

  const handleSegment = (next: WorkflowSegment) => {
    setSegment(next);
    setSelectedKey(null);
  };

  const handleLaunched = (runId: string, workflowKey: string) => {
    setPendingRun(runId, workflowKey);
    setActiveView("runs");
  };

  return (
    <section className="wf-surface" data-testid="view.workflows">
      <header className="wf-header">
        <h2 className="wf-title">Workflows</h2>
        <WorkflowSegmentTabs active={segment} onSelect={handleSegment} />
      </header>
      <div className="wf-body">
        <aside className="wf-list-pane" data-testid="wf.list.pane">
          <WorkflowList
            entries={entries}
            loading={loading}
            error={error}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
        </aside>
        <div className="wf-detail-pane" data-testid="wf.detail.pane">
          <WorkflowDetail entry={selectedEntry} onLaunched={handleLaunched} />
        </div>
      </div>
    </section>
  );
}
