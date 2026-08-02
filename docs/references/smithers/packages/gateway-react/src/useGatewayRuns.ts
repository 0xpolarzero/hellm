import type { ListRunsRequest } from "@smthrs/gateway/rpc";
import { useGatewayRpc } from "./useGatewayRpc.ts";

export function useGatewayRuns(params: ListRunsRequest = {}) {
  return useGatewayRpc("listRuns", params);
}
