export type FeatureStatus = "shipped" | "in-progress";

export interface ProductFeature {
  id: string;
  name: string;
  status: FeatureStatus;
  summary: string;
  sourceSpecs: string[];
}

export const PRODUCT_FEATURES: ProductFeature[] = [
  {
    id: "desktop-shell",
    name: "Electrobun Desktop Shell",
    status: "shipped",
    summary: "Runs svvy as a native desktop coding app with a Bun-side pi host and renderer shell.",
    sourceSpecs: ["docs/prd.md"],
  },
  {
    id: "provider-auth",
    name: "Provider Auth And Settings",
    status: "shipped",
    summary: "Manages provider keys and OAuth-backed access through the desktop settings surface.",
    sourceSpecs: ["docs/prd.md"],
  },
  {
    id: "artifacts-panel",
    name: "Artifacts Projection",
    status: "shipped",
    summary:
      "Reconstructs generated artifacts from the transcript and presents them in a docked preview panel.",
    sourceSpecs: ["docs/prd.md"],
  },
  {
    id: "prompt-history",
    name: "Workspace Prompt History",
    status: "shipped",
    summary:
      "Stores non-empty submitted prompts per workspace, including failed and provider-blocked attempts, and exposes shell-like recall in the composer.",
    sourceSpecs: ["docs/specs/prompt-history.spec.md"],
  },
  {
    id: "multi-session-support",
    name: "Multi-Session Workspace Navigation",
    status: "shipped",
    summary:
      "Supports creating, listing, switching, renaming, forking, and deleting multiple pi-backed sessions from one workspace window.",
    sourceSpecs: ["docs/specs/multi-session-support.spec.md"],
  },
  {
    id: "structured-session-state",
    name: "Structured Session State Overlay",
    status: "in-progress",
    summary:
      "Adds a workspace-scoped svvy-owned state layer above pi and Smithers with durable session, turn, thread, command, episode, verification, workflow, artifact, wait, and lifecycle event records that survive reload.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "turn-command-state",
    name: "Turn And Command State",
    status: "in-progress",
    summary:
      "Tracks each user turn and every tool call as durable state with status, executor ownership, parent-child linkage, attempts, and trace-versus-surface visibility.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-threads",
    name: "Structured Session Threads",
    status: "in-progress",
    summary:
      "Tracks task, workflow, and verification work items as durable threads with parent-child linkage, objective, lifecycle status, dependency waits, user or external waits, and timestamps.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "durable-episodes",
    name: "Durable Episodes",
    status: "in-progress",
    summary:
      "Stores reusable semantic outputs as first-class episode records with kind, summary, body, source command linkage, and artifact references for orchestrator reuse and user inspection.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "verification-state",
    name: "Structured Verification Records",
    status: "in-progress",
    summary:
      "Captures command-linked verification runs as first-class state with kind, passed/failed/cancelled outcome, summary, optional command, and timestamps that influence routing.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "workflow-records",
    name: "Delegated Workflow Records",
    status: "in-progress",
    summary:
      "Stores one top-level svvy-side record for each delegated Smithers workflow with source command linkage, run id, workflow name, running/waiting/completed/failed/cancelled status, summary, and lifecycle timestamps.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-wait-state",
    name: "Session Wait State",
    status: "in-progress",
    summary:
      "Represents user and external blocking conditions explicitly through thread-local wait state and whole-session wait state, while keeping internal dependency waits on thread dependency links instead of conflating them with product pause behavior.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-summary-read-models",
    name: "Metadata-First Session Read Models",
    status: "in-progress",
    summary:
      "Derives idle/running/waiting/error session status, counts, visible thread ordering, and compact summary data from structured state for sidebar, navigation, and restart recovery without transcript replay.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "workflow-inspector",
    name: "Workflow Inspector Surface",
    status: "in-progress",
    summary:
      "Provides a read-only live graph inspector for delegated workflow runs, with node drill-down and pane-based inspection.",
    sourceSpecs: ["docs/prd.md"],
  },
];
