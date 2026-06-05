import { useCallback, useMemo } from "react";
import { runsGatewayClient } from "./runsGatewayClient";

/**
 * Mutating run/approval actions, bound to the surface's Gateway client. Each
 * action posts an RPC and lets the caller refresh the affected reads; this hook
 * deliberately holds no state so multiple panes can share it cheaply.
 */
export function useRunActions() {
  const client = runsGatewayClient();

  const cancelRun = useCallback((runId: string) => client.rpc("cancelRun", { runId }), [client]);
  const resumeRun = useCallback((runId: string) => client.rpc("resumeRun", { runId }), [client]);
  const rewindRun = useCallback(
    (runId: string, frameNo: number) => client.rpc("rewindRun", { runId, frameNo, confirm: true }),
    [client],
  );
  const submitApproval = useCallback(
    (params: { runId: string; nodeId: string; iteration?: number; approved: boolean; note?: string }) =>
      client.rpc("submitApproval", {
        runId: params.runId,
        nodeId: params.nodeId,
        ...(typeof params.iteration === "number" ? { iteration: params.iteration } : {}),
        decision: {
          approved: params.approved,
          ...(params.note ? { note: params.note } : {}),
        },
      }),
    [client],
  );

  return useMemo(
    () => ({ cancelRun, resumeRun, rewindRun, submitApproval }),
    [cancelRun, resumeRun, rewindRun, submitApproval],
  );
}
