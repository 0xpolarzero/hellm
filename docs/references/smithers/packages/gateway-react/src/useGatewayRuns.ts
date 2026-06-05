import type { ListRunsRequest } from "@smithers-orchestrator/gateway/rpc";
import { useGatewayRpc } from "./useGatewayRpc.ts";

export function useGatewayRuns(params: ListRunsRequest = {}) {
  return useGatewayRpc("listRuns", params);
}
