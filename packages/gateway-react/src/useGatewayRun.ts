import { useGatewayRpc } from "./useGatewayRpc.ts";

export function useGatewayRun(runId: string | undefined) {
  return useGatewayRpc("getRun", { runId: runId ?? "" }, { enabled: Boolean(runId), deps: [runId] });
}
