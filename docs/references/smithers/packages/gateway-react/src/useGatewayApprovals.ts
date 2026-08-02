import type { ListApprovalsRequest } from "@smthrs/gateway/rpc";
import { useGatewayRpc } from "./useGatewayRpc.ts";

export function useGatewayApprovals(params: ListApprovalsRequest = {}) {
  return useGatewayRpc("listApprovals", params);
}
