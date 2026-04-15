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
    summary:
      "Runs svvy as a native desktop coding app with a Bun-side pi host and renderer shell.",
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
      "Adds a workspace-scoped svvy-owned session overlay above pi and Smithers with mirrored session metadata, SQLite-oriented persistence, append-only lifecycle events, and explicit runtime-driven writes for threads, verification, workflow projection, dependency blocking, and whole-session waiting that survive reload.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-threads",
    name: "Structured Session Threads",
    status: "in-progress",
    summary:
      "Tracks direct, verification, and workflow workstreams as durable threads with objective, running/completed/failed/waiting status, blocked reason, structured blockedOn cause, and timestamps.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "thread-results",
    name: "Per-Thread Durable Results",
    status: "in-progress",
    summary:
      "Stores one durable semantic result per thread, with analysis, change, verification, workflow, and clarification summaries for orchestrator reuse and inspection; workflow threads keep waiting reasons in blocked/waiting state and emit their single durable result only at terminal completion or failure.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "verification-state",
    name: "Structured Verification Records",
    status: "in-progress",
    summary:
      "Captures thread-linked verification runs as first-class state with kind, passed/failed/cancelled outcome, summary, optional command, and timestamps that influence routing.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "workflow-projections",
    name: "Delegated Workflow Projections",
    status: "in-progress",
    summary:
      "Projects one top-level orchestrator-authored, milestone-based Smithers workflow run per workflow thread into session state with run id, workflow name, running/completed/failed/waiting status, milestone-or-gate summary, and lifecycle timestamps.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-waiting-state",
    name: "Session Waiting State",
    status: "in-progress",
    summary:
      "Represents clarification and external-prerequisite pauses explicitly through session-level waiting ownership and resume conditions, while keeping waits on child threads or parallel subwork in per-thread blockedOn state.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-summary-projections",
    name: "Metadata-First Session Summaries",
    status: "in-progress",
    summary:
      "Derives idle/running/waiting/error session status, counts, thread status buckets, and thread detail reads from structured state for sidebar, navigation, and restart recovery without transcript replay, including the rule that dependency-blocked threads can coexist with a running session.",
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
