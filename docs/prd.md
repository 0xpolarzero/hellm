# Product Requirements Document

## Title

Build a Slate-like coding agent and TUI by starting from pi coding agent primitives.

## Status

- Date: 2026-04-08
- Status: Initial planning document
- Repository purpose: this repo starts as a docs-first planning repo so another agent can continue the work with fresh context

## Why This Document Exists

This document is meant to be sufficient context for a fresh agent entering this repository with no prior chat history.

The goal is not to build "a coding agent" in the abstract. The goal is to build something as close as possible to Slate's publicly visible strengths while starting from pi coding agent as the substrate.

This document captures:

- what we are trying to build
- what we think is special about Slate
- what is explicitly public versus inferred
- what parts of pi should be kept
- what must be added
- what must be avoided
- what order implementation should happen in

## Executive Summary

We want to build a coding agent and terminal UI that feels much closer to Slate than to stock pi.

We are not trying to copy Slate's branding, nor claim access to Slate internals that are not public. We are trying to reproduce the core publicly described behavior:

- one main orchestrator owning strategy and integration
- short-lived bounded worker executions instead of persistent role agents
- structured compressed outputs called episodes
- episode reuse as input to later work
- adaptive decomposition instead of rigid task trees
- strong headless and programmatic control surfaces
- strong session, workspace, and worktree support
- strong verification and integration-testing behavior

The key thesis is:

Slate appears to be good not because it is "just scripts", but because it combines a scriptable/programmatic harness with a disciplined orchestration model:

- bounded worker actions
- frequent synchronization
- reusable structured outputs
- adaptive strategy updates
- expressive tools
- long-running stateful sessions

Our plan should therefore preserve pi's strong runtime and UI primitives, but add a new orchestration layer above them until the system behaves like Slate.

## Short Version

Keep from pi:

- `pi-agent-core` evented tool-calling runtime
- pi TUI/editor primitives
- sessions and branching history
- RPC/JSON programmatic integration
- extensions, skills, prompt templates, AGENTS loading
- provider/model abstraction

Add on top:

- orchestrator runtime
- bounded worker threads
- episode data model
- episode composition and reconciliation
- model slot routing
- skill routing
- workflow / scripting / server control plane
- thread-aware TUI
- verification subsystem
- worktree-aware sessions

Avoid:

- persistent planner/implementer/reviewer stacks
- rigid task trees
- stale markdown plans as the main execution structure
- message-only subagent handoffs
- making compaction the main memory strategy

## Starting Point: pi Coding Agent

As of the referenced `pi-mono` codebase and docs:

- pi is described as a minimal terminal coding harness.
- pi explicitly says it "ships with powerful defaults but skips features like sub agents and plan mode."
- pi already has:
  - a stateful agent runtime with tool execution and event streaming
  - TUI primitives
  - interactive, print/JSON, and RPC modes
  - sessions stored as JSONL with branching
  - compaction
  - extensions
  - skills
  - prompt templates
  - AGENTS.md loading
  - model/provider abstraction
  - steering and follow-up message queues

This makes pi an excellent substrate. It is already modular and evented, but it is intentionally minimal at the orchestration layer. That is the gap this project exists to close.

## What Is Special About Slate

### Publicly Explicit

Based on Slate's public architecture post and docs, the distinctive ideas are:

- Slate uses one central orchestrator for strategy and integration.
- Slate does not present persistent role-based subagents as the core abstraction.
- Slate uses bounded worker threads that execute one action sequence and then return control.
- Each thread returns an `episode`, a compressed representation of the durable outcomes of that bounded work.
- Episodes can be used as inputs to later work.
- Slate argues that bounded synchronization is the key to balancing speed, adaptability, and long-horizon execution.
- Slate argues against rigid task trees, stale markdown plans, and message-passing-only subagents as primary architecture.
- Slate exposes strong scriptable/programmatic surfaces such as headless JSONL mode, server mode, and a workflow JSON input.

### Strong Inference

These are not stated as exact implementation details, but are reasonable conclusions from the public material:

- A large part of Slate's product quality likely comes from combining a programmable harness with orchestration discipline, not from UI polish alone.
- Slate likely routes work differently by task type, because its public config exposes separate model slots for main, subagent, search, and reasoning.
- Slate likely relies heavily on artifacts and structured intermediate outputs, not just prose summaries.
- Slate likely feels strong because it retains adaptability while still externalizing bounded units of work.

### Not Public / Must Not Be Assumed

The following are not public enough to claim as fact:

- Slate's exact internal DSL syntax
- Slate's exact episode schema
- Slate's exact scheduler policy
- Slate's exact reconciliation algorithm
- Slate's exact hidden prompt architecture

This project should therefore copy public behavior and principles, not invent false certainty about hidden internals.

## Product Goal

Build a coding agent and TUI that:

- starts from pi's runtime and UI foundations
- introduces a first-class orchestrator / thread / episode model
- supports long-horizon software tasks with better adaptability than stock pi
- is usable both interactively and programmatically
- makes orchestration visible in the interface
- preserves high expressivity of tools
- makes verification first-class

## Non-Goals

This project is not trying to:

- clone Slate visually
- claim full Slate parity immediately
- depend on private Slate internals
- build a generic multi-agent roleplay system
- optimize for benchmark gimmicks at the expense of developer experience
- build only a chat UI wrapper around pi

## Core Product Principles

### 1. The Orchestrator Owns Strategy

One main runtime owns:

- task interpretation
- decomposition decisions
- worker spawning
- reconciliation
- final user-facing decisions

It is the single source of truth for strategy.

### 2. Workers Are Bounded, Not Role-Based

Workers are:

- short-lived
- general-purpose
- given one bounded action sequence
- stopped at a clear completion boundary

Workers are not:

- permanent planner agents
- permanent reviewer agents
- long-lived autonomous side conversations

### 3. Episodes Are First-Class

Workers should not return "a summary" as plain chat text.

They should return a structured episode containing only durable value:

- findings
- artifacts
- changed files
- verification results
- unresolved issues
- enough provenance for reuse

### 4. Synchronize Frequently

The system should prefer:

- short bounded worker runs
- fast returns to the orchestrator
- reevaluation after new information

The system should avoid:

- committing to long brittle action chains
- waiting too long to surface state
- requiring the orchestrator to reconstruct reality from long prose responses

### 5. Decompose Adaptively

Decomposition should emerge from the task and current state.

Do not force every task into:

- a fixed planner -> implementer -> reviewer pipeline
- a rigid task tree
- a mandatory upfront plan that then goes stale

### 6. Use Expressive, Stepwise Tools

The harness must support highly expressive operations with feedback after each meaningful step.

The system should prefer:

- shell
- file search
- file reads
- targeted edits
- verification commands
- browser or external integrations where needed

The system should avoid:

- one-shot fire-and-forget scripts as the main execution model
- low-expressivity tool sets that force awkward behavior

### 7. Verification Is Part Of The Main Loop

Verification is not a cleanup step.

The runtime should make it natural to:

- run tests
- run builds
- inspect failures
- capture verification artifacts
- loop back into the orchestrator with structured verification outcomes

## Target Architecture

At a high level:

1. A main orchestrator receives the user goal.
2. It decides whether to act directly or spawn one or more bounded workers.
3. Each worker gets a tightly scoped objective, context, allowed tools, and a completion condition.
4. Each worker executes and returns an episode.
5. The orchestrator reconciles episodes, updates strategy, and either finishes or dispatches new work.

### Main Subsystems

- Orchestrator runtime
- Worker thread runtime
- Episode storage and composition
- Session and worktree manager
- Verification subsystem
- TUI orchestration interface
- Headless / workflow / server control plane
- Skills and context routing
- Model routing

## Recommended Repo Shape

This repository is docs-first right now, but the implementation should likely evolve toward something like:

```text
docs/
  prd.md
packages/
  core/              # low-level runtime integration with pi-agent-core
  orchestrator/      # orchestration logic, thread lifecycle, episode model
  session/           # session, branching, worktree, artifact persistence
  server/            # JSONL + HTTP control plane
  tui/               # Slate-like TUI shell and orchestration views
  verification/      # normalized build/test/manual verification layer
```

Exact package boundaries can change, but the orchestrator and episode model should not be buried inside random UI code.

## Detailed Functional Requirements

### A. Orchestrator Runtime

Must implement:

- central planning and reconciliation loop
- dynamic decision to act directly or delegate
- worker spawning with explicit bounded inputs
- merge logic for completed episodes
- policy for parallelizing only independent work
- strategy updates when new information invalidates prior assumptions

Important:

- The orchestrator should remain the source of truth.
- It should be cheap to re-enter after each worker finishes.
- It should reason over compact structured data, not giant replayed transcripts.

Avoid:

- persistent agent hierarchies
- unbounded worker autonomy
- requiring every task to become a tree before execution can begin

### B. Worker Threads

A worker thread should represent one bounded action stream.

Each worker input should include:

- objective
- task type
- allowed tools
- workspace scope
- relevant files and artifacts
- relevant skills
- expected outputs
- completion condition
- optional file ownership hints

Each worker output must become an episode.

Workers may be:

- execute workers
- search / retrieval workers
- reasoning-heavy workers

These are routing distinctions, not permanent identities.

### C. Episode Model

Episodes are the core synchronization unit.

An episode should capture durable outcomes only.

Recommended shape:

```ts
type EpisodeStatus =
  | "completed"
  | "completed_with_issues"
  | "blocked"
  | "failed"
  | "canceled";

interface EpisodeArtifactRef {
  id: string;
  kind: "file" | "diff" | "log" | "test-report" | "screenshot" | "web-result" | "note";
  path?: string;
  description: string;
}

interface EpisodeVerification {
  kind: "build" | "test" | "lint" | "manual" | "integration";
  status: "passed" | "failed" | "skipped" | "unknown";
  summary: string;
  artifactIds: string[];
}

interface Episode {
  id: string;
  threadId: string;
  objective: string;
  status: EpisodeStatus;
  conclusions: string[];
  changedFiles: string[];
  artifacts: EpisodeArtifactRef[];
  verification: EpisodeVerification[];
  unresolvedIssues: string[];
  followUpSuggestions: string[];
  startedAt: string;
  completedAt: string;
  inputEpisodeIds: string[];
}
```

Important:

- Episodes should be composable.
- Later workers should consume episode references, not full thread transcripts by default.
- Human-readable summaries are useful, but they are not the primary data model.

### D. Session Model

Pi already has branchable JSONL sessions. Keep that, but extend it.

A session should eventually contain:

- user and assistant message history
- orchestrator state changes
- thread lifecycle events
- episodes
- artifacts
- verification events
- worktree association

The session model should evolve from:

- message tree

to:

- message tree + thread graph + episode graph

Important:

- session replay should reconstruct orchestration state
- crash recovery should be possible
- resumed sessions must know what workers finished, what is stale, and what still needs reconciliation

### E. Worktree-Aware Context

Worktree support should become first-class.

The system should support:

- branch-specific session contexts
- switching between worktrees without losing relevant history
- binding a session to a worktree root
- launching new worktree sessions for alternate implementations

Why this matters:

- worktree separation is a practical way to isolate implementation branches
- it prevents context and filesystem state from drifting apart

### F. Model Routing

The system should support separate model slots at minimum for:

- main orchestrator
- execute worker
- search worker
- reasoning worker

Why:

- different tasks need different cost / latency / capability tradeoffs
- public Slate config already suggests this is important

Avoid:

- treating all work as same-model work
- burying routing in prompts only

### G. Skill Routing

Pi already has skills and extensions. Keep them, but add better routing.

Requirements:

- orchestrator can determine relevant skills for a worker
- worker gets only the skills relevant to its bounded task
- skills should be activatable and deactivatable per context

Avoid:

- blindly loading every skill everywhere
- making skill selection a purely manual user burden

### H. Verification Subsystem

Verification should be standardized, not just shell output floating in chat.

Requirements:

- capture build/test/lint/manual verification as structured records
- attach artifacts such as logs and reports
- propagate verification outcomes into episode objects
- make verification easy to trigger from orchestrator decisions

Important:

- verification should inform the next orchestration step automatically
- verification failures should become first-class unresolved issues

### I. TUI Requirements

The TUI must become orchestration-aware.

It should not remain only:

- chat transcript
- editor
- footer

It should add views for:

- active threads
- completed episodes
- current orchestration state
- queued / blocked work
- verification status
- artifacts
- worktree / session context

Recommended TUI surfaces:

- chat pane
- threads pane
- episode inspector
- verification panel
- artifacts panel
- session/worktree switcher

Important UX requirement:

- users must be able to understand what the system is doing without reading raw logs

### J. Commands And Control Plane

The system should expose strong non-TUI control surfaces.

Minimum required:

- JSONL streaming mode
- headless one-shot mode
- workflow file input
- RPC or HTTP server mode

Recommended future commands:

- `/threads`
- `/episodes`
- `/workflow`
- `/verify`
- `/reconcile`
- `/worktree`

Why:

- scriptability is part of Slate's appeal
- agents that only work inside a manual TUI are less composable

### K. Workflow Input

We should implement a first-class workflow input format early.

At minimum:

- initial prompt
- todo list
- optional constraints
- optional success criteria
- optional allowed tools
- optional verification requirements

This is not meant to become a rigid task tree. It is a control-plane seed for the orchestrator.

Recommended initial shape:

```json
{
  "prompt": "Implement X safely in this repository.",
  "todos": [
    { "id": "docs", "description": "Read current architecture docs", "status": "pending" },
    { "id": "tests", "description": "Run the relevant tests", "status": "pending" }
  ],
  "constraints": [
    "Do not modify deployment config",
    "Prefer local verification over inference"
  ]
}
```

## What To Keep From Pi

- `pi-agent-core` as the low-level tool-calling engine
- event streaming
- steering/follow-up behavior
- session persistence
- branchable session tree
- RPC mode
- extension and skill loading
- model/provider abstraction
- TUI primitives and editor

## What To Change In Pi

- add a new orchestrator layer above the single-agent loop
- stop treating the conversation transcript as the only source of state
- add structured threads and episodes
- add explicit reconciliation
- add worker routing by task type
- expose orchestration in the TUI
- make workflow/server/headless operation first-class product behavior

## What To Build First

### Phase 0: Docs And Design Lock

Deliverables:

- this PRD
- data model drafts for thread and episode
- decision on initial repo/package layout

### Phase 1: Orchestrator MVP

Deliverables:

- orchestrator runtime above pi
- ability to spawn one bounded worker
- worker returns episode
- orchestrator consumes episode and continues

Success condition:

- system can delegate one bounded task and reconcile the result without pretending the worker is a full persistent subagent

### Phase 2: Session And Episode Persistence

Deliverables:

- thread and episode persistence in sessions
- resume support
- artifact references

Success condition:

- restart / resume can reconstruct orchestration state

### Phase 3: Thread-Aware TUI

Deliverables:

- threads panel
- episode inspector
- verification status display

Success condition:

- user can see what is happening without reading raw logs

### Phase 4: Parallel Independent Workers

Deliverables:

- support multiple independent worker runs
- stale result reconciliation rules
- file ownership / write-scope support

Success condition:

- independent search or disjoint implementation work can run in parallel safely

### Phase 5: Workflow And Headless Control Plane

Deliverables:

- `--workflow`
- JSONL input/output
- structured headless run behavior

Success condition:

- orchestrator can be driven from automation, not only the TUI

### Phase 6: Server Mode

Deliverables:

- HTTP or RPC server around the orchestrator runtime
- remote client attachment

Success condition:

- TUI and runtime can be separated cleanly

### Phase 7: Worktree-Native Sessions

Deliverables:

- branch/worktree-specific session mapping
- commands and UI for switching

Success condition:

- alternate implementations can be explored without context pollution

### Phase 8: Verification Hardening

Deliverables:

- normalized verification artifacts
- verification policies
- better manual integration testing support

Success condition:

- verification meaningfully shapes orchestration and not just chat output

## Important Things To Do

- Keep one orchestrator as source of truth.
- Make worker runs short and bounded.
- Make episode output structured and reusable.
- Make synchronization frequent.
- Keep tools expressive and stepwise.
- Make orchestration visible in the UI.
- Preserve scriptability and remote control.
- Preserve pi's extensibility instead of hardcoding everything.
- Make verification part of the main loop.
- Keep explicit public Slate facts separate from inferred design choices.

## Important Things To Avoid

- Do not build a planner/implementer/reviewer bureaucracy.
- Do not let workers become long-lived side conversations.
- Do not pass full history into every worker by default.
- Do not use compaction as the main memory strategy.
- Do not over-decompose tasks into rigid trees.
- Do not force upfront decomposition when the task is still revealing itself.
- Do not treat scripts as the whole product. Scriptability matters, but orchestration discipline matters more.
- Do not optimize TUI visuals before runtime behavior.
- Do not hide thread state or reconciliation decisions from the user.
- Do not claim exact Slate parity where the public evidence does not support it.

## Acceptance Criteria

The project is on the right track when all of the following are true:

- The system no longer feels like a single chat loop with tools.
- The user can see active workstreams and episode outputs clearly.
- The orchestrator can spawn bounded workers and use their results programmatically.
- Episodes are reusable inputs to later work.
- Headless / JSONL / workflow modes are real and useful.
- Worktree and session state stay aligned.
- Verification outcomes are structured and visible.
- The runtime remains flexible and adaptive, rather than turning into a rigid workflow engine.

## Open Questions

- Should implementation begin by vendoring pi packages into this repo, or by depending on them externally first?
- Should the first server transport stay close to pi RPC, or jump directly to HTTP?
- Should episode storage live inline inside session files or in a sidecar artifact store with references?
- How much of compaction should be kept once episodes exist?
- What is the minimal TUI change that makes orchestration understandable without overhauling everything?

## Recommended Next Step For The Next Agent

The next agent should not start by polishing UI.

The next agent should:

1. Turn this PRD into a more concrete technical design.
2. Decide the package layout and whether to vendor or depend on pi.
3. Specify exact thread and episode schemas.
4. Specify the orchestrator loop and spawn/reconcile policy.
5. Define the first workflow JSON shape and first headless API.
6. Only then begin implementation.

## Research Notes

### Slate Sources Consulted

- Random Labs blog post: `Slate: moving beyond ReAct and RLM`
- Random Labs docs:
  - basics
  - workspace setup
  - configuration
  - skills
- public npm package metadata and CLI help for `@randomlabs/slatecli`

Observed publicly exposed Slate capabilities include:

- headless JSONL mode
- structured input/output modes
- server mode
- workflow JSON input
- multiple model slots
- skills routed into subagents
- worktree/session support

### pi Sources Consulted

- `pi-mono` README
- `packages/coding-agent/README.md`
- `packages/agent/README.md`
- source tree for `packages/coding-agent` and `packages/tui`

### Key External References

- Slate architecture post: https://randomlabs.ai/blog/slate
- Slate basics docs: https://docs.randomlabs.ai/using-slate
- Slate workspace setup docs: https://docs.randomlabs.ai/en/using-slate/workspace_setup
- Slate configuration docs: https://docs.randomlabs.ai/en/using-slate/configuration
- Slate skills docs: https://docs.randomlabs.ai/en/using-slate/skills
- pi-mono repo: https://github.com/badlogic/pi-mono

## Final Instruction To Future Agents

Do not reinterpret this repo as a generic coding-agent playground.

The mission is specific:

- start from pi coding agent
- move it toward Slate's publicly visible architectural strengths
- preserve flexibility and expressivity
- avoid rigid agent bureaucracy
- make orchestration and verification first-class

