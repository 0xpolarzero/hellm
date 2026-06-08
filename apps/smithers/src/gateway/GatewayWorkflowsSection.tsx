import { openSurface } from "../app/navigation";
import { StatusPill } from "../cards/StatusPill";
import { useGatewayStore } from "./gatewayStore";
import "./gateway.css";

/**
 * The Store's "Live workflows" section: the workflows on a connected gateway
 * that ship a custom UI, each with its recent runs. Launch a run or open one to
 * land on the gateway run inspector — where the custom UI ⇄ native toggle lives.
 *
 * Renders nothing unless a gateway is reachable or explicitly rejected auth, so
 * the gateway-less deployed PWA stays quiet while remote mode can explain why
 * live workflows did not load.
 */
export function GatewayWorkflowsSection() {
  const status = useGatewayStore((state) => state.status);
  const workflows = useGatewayStore((state) => state.workflows);
  const runs = useGatewayStore((state) => state.runs);
  const launch = useGatewayStore((state) => state.launch);

  if (status !== "online" && status !== "connecting" && status !== "unauthorized") {
    return null;
  }

  const launchAndOpen = (workflowKey: string): void => {
    void launch(workflowKey).then((runId) => {
      if (runId) {
        openSurface({ kind: "gatewayRun", runId, workflowKey });
      }
    });
  };

  return (
    <section className="gw-live" data-testid="gateway-live">
      <div className="gw-live-head">
        <h2 className="gw-live-title">Live workflows</h2>
        <span className="gw-live-status">{status}</span>
      </div>

      {workflows.length === 0 ? (
        <p className="gw-live-empty">
          {status === "connecting"
            ? "Connecting to gateway..."
            : status === "unauthorized"
              ? "Sign in or provide a gateway token to access live workflows."
              : "No workflows with a custom UI on the gateway."}
        </p>
      ) : (
        workflows.map((workflow) => {
          const workflowRuns = runs.filter(
            (run) => run.workflowKey === workflow.key,
          );
          return (
            <div
              className="gw-wf-card"
              key={workflow.key}
              data-testid={`gateway-wf-${workflow.key}`}
            >
              <div className="gw-wf-head">
                <div>
                  <div className="gw-wf-name">{workflow.readableName}</div>
                  {workflow.description ? (
                    <p className="gw-wf-desc">{workflow.description}</p>
                  ) : null}
                </div>
                <button
                  className="gw-btn gw-btn-primary"
                  type="button"
                  onClick={() => launchAndOpen(workflow.key)}
                >
                  Launch
                </button>
              </div>

              {workflowRuns.map((run) => (
                <div className="gw-run-row" key={run.runId}>
                  <span className="gw-run-id">{run.runId}</span>
                  <StatusPill status={run.status} />
                  <button
                    className="gw-btn"
                    type="button"
                    data-testid={`gateway-open-${run.runId}`}
                    onClick={() =>
                      openSurface({
                        kind: "gatewayRun",
                        runId: run.runId,
                        workflowKey: workflow.key,
                      })
                    }
                  >
                    Open →
                  </button>
                </div>
              ))}
            </div>
          );
        })
      )}
    </section>
  );
}
