import { useGatewayRpc } from "./useGatewayRpc.ts";

export function useGatewayNodeOutput(params: {
  runId: string | undefined;
  nodeId: string | undefined;
  iteration?: number;
}) {
  return useGatewayRpc(
    "getNodeOutput",
    {
      runId: params.runId ?? "",
      nodeId: params.nodeId ?? "",
      ...(typeof params.iteration === "number" ? { iteration: params.iteration } : {}),
    },
    {
      enabled: Boolean(params.runId && params.nodeId),
      deps: [params.runId, params.nodeId, params.iteration],
    },
  );
}
