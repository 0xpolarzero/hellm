/**
 * A single node in the raw DevTools snapshot tree returned by the gateway
 * `getDevToolsSnapshot` RPC. Structurally mirrors the orchestrator's
 * `@smithers-orchestrator/protocol` DevToolsNode; redeclared locally so the app
 * owns its own wire contract and never couples to an undeclared package.
 *
 * This is the SHARED contract: both the developer DevTools surface and the Runs
 * surface read their node tree from `getDevToolsSnapshot`, so the type lives in
 * one place rather than being duplicated per surface.
 */
export type DevToolsNode = {
  id: number;
  type: string;
  name: string;
  props: Record<string, unknown>;
  task?: {
    nodeId: string;
    kind: "agent" | "compute" | "static";
    agent?: string;
    label?: string;
    outputTableName?: string;
    iteration?: number;
  };
  children: DevToolsNode[];
  depth: number;
};
