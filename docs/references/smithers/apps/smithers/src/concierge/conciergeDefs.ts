import type { Edge } from "@xyflow/react";
import { workflowToFlow, type WorkflowSpec } from "../askme/workflowFlow";

/**
 * The Concierge workflow as a static diagram: an incoming request is classified,
 * the available context is inventoried, then a grilling loop clarifies intent
 * before routing branches to backpressure shaping, an approval gate, an execution
 * loop, a report, and a final context extraction. Mirrors the real concierge
 * pipeline (classify → inventory → grill → route → backpressure → approve →
 * execute → report → extract).
 */
const CONCIERGE_SPEC: WorkflowSpec = {
  name: "concierge",
  description: "Triage, clarify, and route an incoming request through the context-engineering pipeline.",
  nodes: [
    {
      id: "classify",
      label: "Classify",
      kind: "signal",
      output: "request kind",
      dependsOn: [],
    },
    {
      id: "inventory",
      label: "Inventory Context",
      kind: "compute",
      output: "context inventory",
      dependsOn: ["classify"],
    },
    {
      id: "grill",
      label: "Grill Loop",
      kind: "loop",
      output: "clarified intent",
      dependsOn: ["inventory"],
    },
    {
      id: "route",
      label: "Route",
      kind: "branch",
      output: "workflow route",
      dependsOn: ["grill"],
    },
    {
      id: "backpressure",
      label: "Backpressure",
      kind: "compute",
      output: "shaped load",
      dependsOn: ["route"],
    },
    {
      id: "approve",
      label: "Approval Gate",
      kind: "approval",
      output: "approval decision",
      dependsOn: ["backpressure"],
    },
    {
      id: "execute",
      label: "Execute Loop",
      kind: "loop",
      output: "execution result",
      dependsOn: ["approve"],
    },
    {
      id: "report",
      label: "Report",
      kind: "compute",
      output: "run report",
      dependsOn: ["execute"],
    },
    {
      id: "extract",
      label: "Extract Context",
      kind: "merge",
      output: "extracted context",
      dependsOn: ["report"],
    },
  ],
};

const flow = workflowToFlow(CONCIERGE_SPEC);

/** The grilling loop-back edge — added on top of the linear dagre layout. */
const grillLoopBack: Edge = {
  id: "grill->grill-loop",
  source: "grill",
  target: "grill",
  type: "smoothstep",
  animated: true,
  label: "not clear",
  style: { stroke: "#6d56d8" },
  labelStyle: { fill: "#6d56d8", fontSize: 11, fontWeight: 600 },
};

/** The execution loop-back edge — added on top of the linear dagre layout. */
const executeLoopBack: Edge = {
  id: "execute->execute-loop",
  source: "execute",
  target: "execute",
  type: "smoothstep",
  animated: true,
  label: "more work",
  style: { stroke: "#6d56d8" },
  labelStyle: { fill: "#6d56d8", fontSize: 11, fontWeight: 600 },
};

export const CONCIERGE_NODES = flow.nodes;
export const CONCIERGE_EDGES: Edge[] = [...flow.edges, grillLoopBack, executeLoopBack];
