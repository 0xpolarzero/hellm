import { StatusPill } from "../cards/StatusPill";
import type { RunNode } from "../runs/Run";
import { useGatewayStore } from "./gatewayStore";

/**
 * The native inspector's right pane for a gateway run: the selected node's
 * identity, status, and output. Output is fetched lazily on selection (see
 * GatewayRunInspector's `onSelect`) and cached in the gateway store, so this
 * component only reads — `undefined` means "not requested", `null` means
 * "fetched but empty".
 */
export function GatewayNodeDetail({
  runId,
  node,
}: {
  runId: string;
  node: RunNode;
}) {
  const key = `${runId}::${node.id}`;
  const requested = useGatewayStore((state) => key in state.outputs);
  const output = useGatewayStore((state) => state.outputs[key]);

  return (
    <div className="gw-node-detail" data-testid="gateway-node-detail">
      <div className="gw-node-head">
        <span className="gw-node-name">{node.name}</span>
        <StatusPill status={node.status} />
      </div>
      <div className="gw-node-section">
        <span className="gw-node-label">Output</span>
        {!requested ? (
          <p className="gw-node-muted">Select this node to load its output.</p>
        ) : output === null || output === undefined ? (
          <p className="gw-node-muted">No output for this node.</p>
        ) : (
          <pre className="gw-node-output" data-testid="gateway-node-output">
            {JSON.stringify(output, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
