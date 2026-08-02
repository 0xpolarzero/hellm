import type { ListWorkflowsRequest } from "@smthrs/gateway/rpc";
import { useGatewayRpc } from "./useGatewayRpc.ts";

export function useGatewayWorkflows(params: ListWorkflowsRequest = {}) {
  return useGatewayRpc("listWorkflows", params);
}
