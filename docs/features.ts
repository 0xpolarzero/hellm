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
      "Loads svvy's orchestrator and handler-thread instructions through pi's real `systemPrompt` channel, keeps reconstructed prompt bodies limited to durable surface context plus transcript material, slices generated capability declarations by actor so each surface sees only its own callable API, and renders the active system prompt as expandable surface metadata instead of inline transcript text.",
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
      "Lets the orchestrator open pi-backed delegated handler threads as fully interactive conversation surfaces that supervise one delegated objective, stay multi-turn and directly messageable before and after handoff, distinguish handler-active, workflow-active, waiting, troubleshooting, and completed thread states, reject `thread.handoff` while the thread still owns a running or waiting workflow run for the current span, route workflow attention back to the owning handler surface rather than the focused pane, can be inspected on demand without becoming the default reconciliation path, and return control to the orchestrator only through explicit `thread.handoff` calls that append ordered handoff episodes over the thread's lifetime and immediately trigger a fresh orchestrator reconciliation turn.",
    sourceSpecs: ["docs/prd.md", "docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "smithers-tool-surface",
    name: "Smithers-Native Tool Surface",
    status: "in-progress",
    summary:
      "Exposes Smithers-native semantic workflow control and inspection tools through the Bun bridge for handler-thread surfaces, with one generated launch tool per discoverable runnable entry under `smithers.run_workflow.<workflow_id>` derived from the entry's real TypeScript or Zod launch schema, `smithers.list_workflows` returning compiled contract metadata together with `sourceScope`, `entryPath`, and mandatory grouped asset refs, `smithers.list_runs` returning workspace-global compact run summaries enriched with svvy `sessionId` and `threadId` ownership when known, and the rest of the handler-thread surface preserving official Smithers names such as `get_run`, `watch_run`, `explain_run`, `list_pending_approvals`, `resolve_approval`, `get_node_detail`, `list_artifacts`, `get_chat_transcript`, `get_run_events`, `runs.cancel`, `signals.send`, `frames.list`, `getDevToolsSnapshot`, and `streamDevTools` instead of inventing a parallel svvy `workflow.*` abstraction, while preserving transport and invocation metadata in command facts and avoiding any dependency on the repo authoring workspace under `workflows/`.",
    sourceSpecs: ["docs/prd.md", "docs/specs/workflow-supervision.spec.md"],
  },
  {
    id: "workflow-task-agent-profile",
    name: "Workflow Task Agent Profile",
    status: "in-progress",
    summary:
      "Defines lower-level Smithers workflow task agents as a separate actor class beneath handler threads, using a PI-backed svvy task profile by default with task-local instructions and `execute_typescript` as the default adopted task tool surface, while keeping approval and hijack as Smithers runtime controls rather than ordinary task-agent tools.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/workflow-supervision.spec.md",
      "docs/specs/execute-typescript.spec.md",
    ],
  },
  {
    id: "workflow-library",
    name: "Workflow Authoring And Artifact Workflows",
    status: "in-progress",
    summary:
      "Centers workflow execution around authored artifact workflows stored under `.svvy/artifacts/workflows/`, with workflow-writing actors receiving an injected authoring guide plus curated examples, authoring through reusable definitions, prompts, components, and agent-profile assets, and launching concrete saved or artifact entries through the Smithers-native runtime surface.",
    sourceSpecs: ["docs/prd.md", "docs/specs/workflow-library.spec.md"],
  },
  {
    id: "saved-workflow-library",
    name: "Workspace Saved Workflow Library",
    status: "in-progress",
    summary:
      "Stores reusable workflow source assets under `.svvy/workflows/definitions`, `prompts`, and `components`, stores launchable saved entries under `.svvy/workflows/entries`, compiles discovery metadata for assets from JSDoc and MDX frontmatter, treats agent profiles as discoverable component assets, lets workflow-writing actors list and read saved assets through the `execute_typescript` host SDK, and promotes selected reusable definitions, prompts, components, or entries out of artifact workflows into the saved library only on explicit save.",
    sourceSpecs: ["docs/prd.md", "docs/specs/workflow-library.spec.md"],
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
      "Supports creating, listing, switching, renaming, forking, and deleting multiple pi-backed session containers from one workspace window.",
    sourceSpecs: ["docs/specs/multi-session-support.spec.md"],
  },
  {
    id: "multi-surface-runtime",
    name: "Multi-Surface Live Runtime",
    status: "in-progress",
    summary:
      "Separates durable workspace state from live surface runtimes and pane layout state, manages live pi surfaces in a shared registry keyed by `surfacePiSessionId`, gives each surface its own prompt lock and model or reasoning lifecycle, supports explicit open and close semantics, and lets multiple panes attach to the same surface without duplicating the underlying runtime.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/multi-session-support.spec.md",
      "docs/specs/structured-session-state.spec.md",
    ],
  },
  {
    id: "structured-session-state",
    name: "Structured Session State Overlay",
    status: "in-progress",
    summary:
      "Adds a workspace-scoped svvy-owned state layer above pi and Smithers with durable session, turn, thread, workflow-run, command, episode, artifact, verification, wait, and lifecycle event records, explicit surface-target identity (`workspaceSessionId`, `surfacePiSessionId`, `threadId`), workspace-level metadata projection that survives reload, and live-surface transcript updates kept separate from durable workspace read models.",
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
      "Tracks delegated handler threads as durable interactive surfaces keyed separately from workspace session containers and pi surface ids, with objective, handler-attention status, wait state, worktree context, and linkage to multiple workflow runs and multiple handoff episodes over the thread's lifetime without flattening workflow outcome into thread terminal state.",
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
      "Stores one svvy-side record for each Smithers workflow run under a handler thread, including run identity, workflow source, runnable entry path plus saved-entry linkage when relevant, normalized status, raw Smithers status, wait kind, reconnect cursor, pending-versus-delivered handler-attention cursors, heartbeat freshness, lineage, summary, timestamps, and related artifacts and command history, with lifecycle projection owned by explicit bridge-event writes, Smithers tool-boundary writes, and reconnect or bootstrap control-plane writes, plus idempotent terminal replay handling so duplicate terminal snapshots do not reopen a completed thread or redeliver handler attention.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-wait-state",
    name: "Session And Thread Wait State",
    status: "in-progress",
    summary:
      "Represents handler-owned and workflow-owned blocking conditions explicitly through surface-local wait state and whole-session frontier wait state, preserving whether a wait came from user input, approval, signal, timer, or other external dependency without inventing wait episodes or relying on transcript inference.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-summary-read-models",
    name: "Metadata-First Session Read Models",
    status: "in-progress",
    summary:
      "Derives idle, running, waiting, and error session status, counts, ordered thread ids, pending attention, and compact summary data from structured wait, handler-attention state, workflow-run state, and artifact metadata for workspace navigation and restart recovery without transcript replay, transcript-file heuristics, or any global active-surface overlay.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "workflow-inspector",
    name: "Workflow Inspector Surface",
    status: "in-progress",
    summary:
      "Provides a read-only live graph inspector for workflow runs, with snapshot-plus-delta graph streaming, blocker diagnosis, node drill-down, transcript and artifact inspection, and pane-based inspection without forcing the orchestrator to absorb raw workflow history.",
    sourceSpecs: ["docs/prd.md", "docs/specs/workflow-supervision.spec.md"],
  },
];
