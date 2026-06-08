import type { ChangeEvent } from "react";
import { usePreferencesStore } from "../app/preferencesStore";
import { WorkflowGraph } from "../askme/WorkflowGraph";
import { CONCIERGE_EDGES, CONCIERGE_NODES } from "./conciergeDefs";
import { useConciergeStore } from "./conciergeStore";
import { runContextDoctor } from "./contextDoctor";
import { recommendWorkflows } from "./workflowRouter";
import type { ContextContract } from "./contextContract";

/**
 * The Context Engineering Console (`/concierge`): a five-panel surface that turns
 * a raw workflow script into a structured {@link ContextContract}, then renders
 * the readiness scorecard and routed-workflow recommendations the contract
 * implies. The contract is held entirely in {@link useConciergeStore}; there is
 * no live gateway yet, so panels read and (locally) edit the store. The "Start"
 * action commits the draft script and leaves the contract for a future chat
 * stream to populate (see the TODO in {@link onStart}).
 */
export function ConciergeConsole() {
  const theme = usePreferencesStore((state) => state.theme);
  const script = useConciergeStore((state) => state.script);
  const setScript = useConciergeStore((state) => state.setScript);
  const contract = useConciergeStore((state) => state.contract);

  // The textarea is committed to the store on Start (and live-bound for typing).
  const onScriptChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setScript(event.target.value);
  };

  const onStart = (): void => {
    // Commit the current draft as the console's script.
    setScript(script);
    // TODO: kick off the concierge chat stream here; as it interviews the user it
    // should call useConciergeStore.patchContract(...) to populate the contract.
    // Until that gateway exists the contract is seeded/edited locally.
  };

  return (
    <div className="concierge">
      <div className="concierge-inner">
        <header className="concierge-header">
          <h1 className="concierge-title">Context Engineering Console</h1>
          <p className="concierge-subtitle">
            Turn a raw script into a context contract: state the goal, resolve the
            open questions, then route to the right workflow with the readiness
            checks satisfied.
          </p>
        </header>

        <div className="concierge-grid">
          <ScriptPanel script={script} onChange={onScriptChange} onStart={onStart} />
          <ContractPanel contract={contract} />
          <QuestionsPanel contract={contract} />
          <WorkflowPanel theme={theme} />
          <EvidencePanel contract={contract} />
        </div>
      </div>
    </div>
  );
}

/** Panel 1 — Script: the raw request, with a Start action that commits it. */
function ScriptPanel({
  script,
  onChange,
  onStart,
}: {
  script: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onStart: () => void;
}) {
  return (
    <section className="concierge-panel concierge-panel--script">
      <h2 className="concierge-panel-title">Script</h2>
      <p className="concierge-panel-hint">
        Describe the task in your own words. Start hands it to the concierge.
      </p>
      <textarea
        className="concierge-script"
        placeholder="e.g. Investigate the failing checkout flow and fix the root cause…"
        value={script}
        onChange={onChange}
      />
      <button
        className="concierge-start"
        disabled={script.trim() === ""}
        type="button"
        onClick={onStart}
      >
        Start →
      </button>
    </section>
  );
}

/** A titled bullet list, or a muted fallback line when the list is empty. */
function FieldList({
  label,
  items,
  empty,
}: {
  label: string;
  items: string[];
  empty: string;
}) {
  return (
    <div className="concierge-field">
      <span className="concierge-field-label">{label}</span>
      {items.length === 0 ? (
        <span className="concierge-field-empty">{empty}</span>
      ) : (
        <ul className="concierge-field-list">
          {items.map((item, index) => (
            <li key={`${label}-${index}`}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Panel 2 — Context Contract: the agreed goal, scope, inputs, outputs, memory. */
function ContractPanel({ contract }: { contract: ContextContract }) {
  const inputs = contract.inputs.map(
    (input) => `${input.name} (${input.source ?? "unsourced"})`,
  );
  return (
    <section className="concierge-panel concierge-panel--contract">
      <h2 className="concierge-panel-title">Context Contract</h2>
      <div className="concierge-field">
        <span className="concierge-field-label">Goal</span>
        <span className={contract.goal.trim() === "" ? "concierge-field-empty" : "concierge-field-value"}>
          {contract.goal.trim() === "" ? "No goal stated yet." : contract.goal}
        </span>
      </div>
      <div className="concierge-field">
        <span className="concierge-field-label">Scope</span>
        <span className={contract.scope.trim() === "" ? "concierge-field-empty" : "concierge-field-value"}>
          {contract.scope.trim() === "" ? "No scope stated yet." : contract.scope}
        </span>
      </div>
      <FieldList label="Non-goals" items={contract.nonGoals} empty="No non-goals." />
      <FieldList label="Assumptions" items={contract.assumptions} empty="No assumptions." />
      <FieldList label="Inputs" items={inputs} empty="No inputs declared." />
      <FieldList label="Outputs" items={contract.outputs} empty="No outputs declared." />
      <FieldList label="Tools" items={contract.tools} empty="No tools declared." />
      <FieldList label="Skills" items={contract.skills} empty="No skills declared." />
    </section>
  );
}

/** Panel 3 — Questions: decisions made and the questions still open or deferred. */
function QuestionsPanel({ contract }: { contract: ContextContract }) {
  return (
    <section className="concierge-panel concierge-panel--questions">
      <h2 className="concierge-panel-title">Questions</h2>
      <FieldList label="Decisions" items={contract.decisions} empty="No decisions recorded." />
      <FieldList label="Open questions" items={contract.openQuestions} empty="None open." />
      <FieldList
        label="Deferred questions"
        items={contract.deferredQuestions}
        empty="None deferred."
      />
    </section>
  );
}

/** Panel 4 — Workflow: the static concierge pipeline graph. */
function WorkflowPanel({ theme }: { theme: "light" | "dark" }) {
  return (
    <section className="concierge-panel concierge-panel--workflow">
      <h2 className="concierge-panel-title">Workflow</h2>
      <div className="concierge-graph">
        <WorkflowGraph nodes={CONCIERGE_NODES} edges={CONCIERGE_EDGES} theme={theme} />
      </div>
    </section>
  );
}

/** Panel 5 — Evidence: the doctor scorecard plus routed-workflow recommendations. */
function EvidencePanel({ contract }: { contract: ContextContract }) {
  const issues = runContextDoctor(contract);
  const recommendations = recommendWorkflows(contract);
  return (
    <section className="concierge-panel concierge-panel--evidence">
      <h2 className="concierge-panel-title">Evidence</h2>

      <div className="concierge-field">
        <span className="concierge-field-label">Readiness checks</span>
        <ul className="concierge-doctor">
          {issues.map((issue) => (
            <li className={`concierge-issue concierge-issue--${issue.severity}`} key={issue.check}>
              <span className="concierge-issue-severity">{issue.severity}</span>
              <span className="concierge-issue-message">{issue.message}</span>
              {issue.detail !== undefined ? (
                <span className="concierge-issue-detail">{issue.detail}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="concierge-field">
        <span className="concierge-field-label">Recommended workflows</span>
        {recommendations.length === 0 ? (
          <span className="concierge-field-empty">
            No recommendations yet — state a goal to route the work.
          </span>
        ) : (
          <ul className="concierge-recs">
            {recommendations.map((rec) => (
              <li className="concierge-rec" key={rec.workflow}>
                <span className="concierge-rec-head">
                  <span className="concierge-rec-name">{rec.workflow}</span>
                  <span className="concierge-rec-score">{rec.score}</span>
                </span>
                <span className="concierge-rec-reason">{rec.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
