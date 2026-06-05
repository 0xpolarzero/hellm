import type { ListApprovalsRequest } from "@smithers-orchestrator/gateway/rpc";
import { useGatewayRpc } from "./useGatewayRpc.ts";

export function useGatewayApprovals(params: ListApprovalsRequest = {}) {
  return useGatewayRpc("listApprovals", params);
}
