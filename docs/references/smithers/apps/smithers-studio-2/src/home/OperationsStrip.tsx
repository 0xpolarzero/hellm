import { useEffect, useState } from "react";
import { runsGatewayClient } from "../runs/runsGatewayClient";
import { parseApprovals, parseRunSummaries } from "../runs/parseRunPayloads";
import { useStudioStore } from "../useStudioStore";

type OperationsCounts = {
  running: number;
  waiting: number;
  pendingApproval: number;
};

const EMPTY_COUNTS: OperationsCounts = { running: 0, waiting: 0, pendingApproval: 0 };

/**
 * How often to refresh the Operations counts, in ms. Home is the WELCOME
 * altitude — this overview polls on a lighter cadence than the Runs surface's
 * 2s live poll, enough to keep "what's running now" honest without the user
 * leaving Home, but cheap enough to leave running.
 */
const OPERATIONS_POLL_MS = 5000;

/**
 * Live "what's running now" strip. Derives its counts from the same Gateway RPCs
 * the Runs surface uses (listRuns + listApprovals): `running` counts runs whose
 * lifecycle state is actively executing, `waiting` counts runs blocked on an
 * event/timer, and `pendingApproval` is the live approval-gate count. Each tile
 * deep-links into the (pre-filtered) Runs surface. Counts refresh on an interval
 * so a run that starts, blocks, or finishes while Home is open is reflected
 * without a manual reload.
 */
export function OperationsStrip() {
  const setActiveView = useStudioStore((s) => s.setActiveView);
  const [counts, setCounts] = useState<OperationsCounts>(EMPTY_COUNTS);

  useEffect(() => {
    const client = runsGatewayClient();
    let cancelled = false;

    const load = async () => {
      try {
        const [runsPayload, approvalsPayload] = await Promise.all([
          client.rpc("listRuns", {}),
          client.rpc("listApprovals", {}),
        ]);
        if (cancelled) return;
        const runs = parseRunSummaries(runsPayload);
        const approvals = parseApprovals(approvalsPayload);
        let running = 0;
        let waiting = 0;
        for (const run of runs) {
          if (run.status === "running") running += 1;
          else if (
            run.status === "waiting-approval" ||
            run.status === "waiting-event" ||
            run.status === "waiting-timer"
          ) {
            waiting += 1;
          }
        }
        setCounts({ running, waiting, pendingApproval: approvals.length });
      } catch {
        if (!cancelled) setCounts(EMPTY_COUNTS);
      }
    };

    void load();
    const id = setInterval(() => void load(), OPERATIONS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const tiles: Array<{ key: keyof OperationsCounts; label: string; tone: string }> = [
    { key: "running", label: "Running", tone: "home-op--running" },
    { key: "waiting", label: "Waiting", tone: "home-op--waiting" },
    { key: "pendingApproval", label: "Pending approval", tone: "home-op--approval" },
  ];

  return (
    <div className="home-operations" data-testid="home.operations">
      {tiles.map((tile) => (
        <button
          aria-label={`${counts[tile.key]} ${tile.label} — open Runs`}
          className={`home-op ${tile.tone}`}
          key={tile.key}
          onClick={() => setActiveView("runs")}
          type="button"
        >
          <span aria-hidden className="home-op-count">
            {counts[tile.key]}
          </span>
          <span aria-hidden className="home-op-label">
            {tile.label}
          </span>
        </button>
      ))}
    </div>
  );
}
