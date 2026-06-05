import { useState } from "react";
import type { ApprovalSummary } from "./runState";
import { useRunActions } from "./useRunActions";

/**
 * The inline approval gate, shown inside the inspector when the selected node
 * has a pending approval. This is the de-spaceshipping move: a time-sensitive
 * gate is resolved in place, in the same pane that shows the node — never in a
 * separate Approvals view. Approve/Deny post submitApproval, then refresh.
 */
export function ApprovalGate(props: {
  approval: ApprovalSummary;
  onResolved: () => void;
}) {
  const { approval, onResolved } = props;
  const actions = useRunActions();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const decide = async (approved: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      await actions.submitApproval({
        runId: approval.runId,
        nodeId: approval.nodeId,
        iteration: approval.iteration,
        approved,
        note: note.trim() || undefined,
      });
      onResolved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="runs-gate"
      data-testid="runs.approvalGate"
      role="region"
      aria-label="Approval required"
    >
      <div className="runs-gate-header">
        <span className="runs-gate-badge">Approval required</span>
        <span className="runs-gate-title">{approval.requestTitle ?? approval.nodeId}</span>
      </div>
      {approval.requestSummary ? (
        <p className="runs-gate-summary">{approval.requestSummary}</p>
      ) : null}
      <input
        className="runs-gate-note"
        type="text"
        placeholder="Add a note (optional)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        disabled={busy}
        data-testid="runs.approvalGate.note"
      />
      {error ? <p className="runs-gate-error">{error}</p> : null}
      <div className="runs-gate-actions">
        <button
          type="button"
          className="runs-gate-approve"
          disabled={busy}
          data-testid="runs.approvalGate.approve"
          onClick={() => void decide(true)}
        >
          Approve
        </button>
        <button
          type="button"
          className="runs-gate-deny"
          disabled={busy}
          data-testid="runs.approvalGate.deny"
          onClick={() => void decide(false)}
        >
          Deny
        </button>
      </div>
    </div>
  );
}
