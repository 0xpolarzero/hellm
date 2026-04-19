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
    id: "true-system-prompt-channel",
    name: "True System Prompt Channel",
    status: "in-progress",
    summary:
      "Loads svvy's orchestrator and handler-thread instructions through pi's real `systemPrompt` channel, keeps reconstructed prompt bodies limited to durable surface context plus transcript material, and renders the active system prompt as expandable session metadata instead of inline transcript text.",
    sourceSpecs: ["docs/prd.md"],
  },
  {
    id: "artifacts-panel",
    name: "Artifacts Projection",
    status: "shipped",
    summary: "Presents generated artifacts in a docked preview panel.",
    sourceSpecs: ["docs/prd.md", "docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "durable-artifact-storage",
    name: "Durable Artifact Storage",
    status: "in-progress",
    summary:
      "Moves artifacts into a dedicated workspace artifact directory with SQLite metadata and path indexing, including submitted execute_typescript snippets for every attempt and workflow-related logs and exports.",
    sourceSpecs: ["docs/prd.md", "docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "execute-typescript-surface",
    name: "Execute Typescript Work Surface",
    status: "in-progress",
    summary:
      "Provides the default generic top-level work surface with observable typed api.* host capabilities, a generated JSDoc-rich SDK declaration embedded in the system prompt and reused for static checking, explicit api.exec.run, workspace-fs-style repo reads and searches, curated git command names, preflight typecheck or compile diagnostics, file-backed snippet artifacts for every attempt, and parent-first rollups over nested child command facts.",
    sourceSpecs: ["docs/prd.md", "docs/specs/execute-typescript.spec.md"],
  },
  {
    id: "handler-thread-surfaces",
    name: "Delegated Handler Thread Surfaces",
    status: "in-progress",
    summary:
      "Lets the orchestrator open pi-backed delegated handler threads as fully interactive conversation surfaces that supervise one delegated objective, stay multi-turn and directly messageable before and after handoff, can be inspected on demand without becoming the default reconciliation path, and return control to the orchestrator only through explicit `thread.handoff` calls that append ordered handoff episodes over the thread's lifetime and immediately trigger a fresh orchestrator reconciliation turn.",
    sourceSpecs: ["docs/prd.md", "docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "workflow-library",
    name: "Workflow Templates And Presets",
    status: "in-progress",
    summary:
      "Defines structural Smithers workflow templates such as `single_task`, `sequential_pipeline`, `fanout_join`, and `verification_run`, plus reusable presets and one-off authored workflows supervised by handler threads.",
    sourceSpecs: ["docs/prd.md"],
  },
  {
    id: "workflow-hooks",
    name: "Repo-Local Workflow Hooks",
    status: "in-progress",
    summary:
      "Wraps consequential workflow runs with repo-local preflight and validation hooks that can use execute_typescript without flattening workflow control into api.* helpers or bypassing handler-thread supervision.",
    sourceSpecs: ["docs/prd.md", "docs/specs/workflow-hooks.spec.md"],
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
      "Adds a workspace-scoped svvy-owned state layer above pi and Smithers with durable session, turn, thread, workflow-run, command, episode, artifact, verification, wait, and lifecycle event records, explicit surface-target identity (`workspaceSessionId`, `surfacePiSessionId`, `threadId`), and backend-driven session-sync rehydration that survives reload.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "turn-command-state",
    name: "Turn And Command State",
    status: "in-progress",
    summary:
      "Tracks every turn on the orchestrator surface and handler thread surfaces, including each turn's top-level turn decision, plus every tool call including execute_typescript snippets and nested api.* child command facts, as durable state with lifecycle status, ownership, linkage, attempts, and trace-versus-surface visibility.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-threads",
    name: "Structured Handler Threads",
    status: "in-progress",
    summary:
      "Tracks delegated handler threads as durable interactive surfaces keyed separately from workspace session containers and pi surface ids, with objective, current objective status, wait state, worktree context, and linkage to multiple workflow runs and multiple handoff episodes over the thread's lifetime.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "durable-episodes",
    name: "Durable Episodes",
    status: "in-progress",
    summary:
      "Stores reusable semantic outputs as first-class episode records, with handler threads able to emit multiple ordered handoff episodes over their lifetime through explicit `thread.handoff` calls as the semantic half of returning control to the orchestrator, including orchestrator-local episodes when substantive local work completes, while ordinary tool runs keep their own command summaries and artifacts.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "verification-state",
    name: "Structured Verification Records",
    status: "in-progress",
    summary:
      "Captures verification outcomes produced by verification-shaped workflow runs as first-class state with kind, status, summary, and timestamps that influence routing and support specialized UI.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "workflow-run-records",
    name: "Delegated Workflow Run Records",
    status: "in-progress",
    summary:
      "Stores one svvy-side record for each Smithers workflow run under a handler thread, including run identity, template or preset metadata, status, summary, timestamps, and related artifacts and command history, with lifecycle projection owned by explicit bridge or tool writes rather than read-side refresh.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-wait-state",
    name: "Session And Thread Wait State",
    status: "in-progress",
    summary:
      "Represents user and external blocking conditions explicitly through surface-local wait state and whole-session frontier wait state without inventing wait episodes or relying on transcript inference.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-summary-read-models",
    name: "Metadata-First Session Read Models",
    status: "in-progress",
    summary:
      "Derives idle, running, waiting, and error session status, counts, ordered thread ids, and compact summary data from structured wait and thread state plus artifact metadata for sidebar, navigation, and restart recovery without transcript replay, transcript-file heuristics, or live prompt overlays.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "workflow-inspector",
    name: "Workflow Inspector Surface",
    status: "in-progress",
    summary:
      "Provides a read-only live graph inspector for workflow runs, with node drill-down, template-aware presentation, and pane-based inspection.",
    sourceSpecs: ["docs/prd.md"],
  },
];
