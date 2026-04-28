# Command Palette And Quick Open Spec

## Status

- Date: 2026-04-27
- Status: adopted direction for Section 9 command palette and quick open
- Scope of this document:
  - define the product-level command palette and quick-open surfaces
  - define keyboard shortcuts and fallback prompt behavior
  - define the command/action registry model
  - define command search, matching, and execution routing semantics
  - define how the palette relates to sessions, Project CI, handler threads, workflow inspectors, saved workflow library browsing, panes, settings, agent settings, and future product actions

## Purpose

The command palette is the shell-level action surface for `svvy`.

It gives users a VS Code-like way to discover and execute product actions without turning those actions into a second runtime. `Cmd+Shift+P` opens the all-actions command palette. `Cmd+P` opens a file quick-open palette, which is intentionally a placeholder until file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces exist.

The palette invokes existing product behavior. It routes into sessions, panes, surfaces, orchestrator and handler turns, Smithers-native tools, Project CI projection, saved workflow library browsing, durable state, settings, and agent settings. It must not become an alternate execution engine, standalone shell, custom terminal loop, readline loop, or parallel workflow abstraction.

## Source Boundaries

Public Slate facts and `svvy` product choices must stay separate.

- Public Slate facts may inform the expected feel of fast action discovery and visible orchestration.
- PRD inferences define the `svvy` product direction: pi-backed surfaces, one strategic orchestrator, delegated handler threads, and Smithers-backed workflow supervision.
- This spec defines `svvy` implementation-level product choices for command discovery and routing. It is not evidence about Slate internals.

## Non-Goals

The command palette does not implement:

- a standalone terminal, custom shell, readline loop, or alternate TUI stack outside pi
- a second command execution runtime
- a parallel workflow registry or `workflow.*` abstraction
- direct Smithers execution from the shell outside the owning handler-thread model
- direct Project CI execution outside normal orchestrator or handler-thread routing
- file quick-open results before file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces exist
- pane-placement semantics as core palette behavior; pane-specific placement belongs to `docs/specs/pane-layout.spec.md`

## UI Primitive

When implemented, the command palette UI should use `cmdk-sv` from `https://www.cmdk-sv.com/` as the Svelte command menu primitive. Its docs describe it as a "fast, composable, unstyled command menu for Svelte."

The intended use is as a fast, unstyled, composable command menu foundation. `svvy` still owns product semantics, command registry shape, search metadata, routing, telemetry, state updates, keyboard dispatch, and styling.

`cmdk-sv` is a renderer UI primitive, not a product action registry, runtime engine, or source of command semantics.

## Keyboard Shortcuts

`Cmd+Shift+P` opens the all-actions command palette.

The all-actions palette discovers and executes product actions, including:

- create a new session
- open or switch to existing session-like targets, including orchestrator sessions, handler-thread sessions, and workflow task-agent projection sessions
- pin, unpin, archive, and unarchive sessions
- open focused session, thread, workflow, artifact, and Project CI surfaces
- run or configure Project CI through normal orchestrator or handler-thread routing
- open handler thread surfaces
- open workflow inspector-related surfaces
- open the read-only saved workflow library surface
- pane and layout actions once pane layout exists
- settings and agent-setting actions when those features exist
- future product actions as they are added

`Cmd+P` opens file quick-open.

For now, file quick-open is intentionally a no-op placeholder:

- the UI may open an empty quick-open palette or show an unavailable state
- it must not fabricate file, editor, or diagnostics surfaces
- it must not browse files through an ad hoc shell or terminal path
- it becomes actionable only after dedicated file-navigation primitives are designed

## Command Registry And Action Model

The command registry is the product-owned index of discoverable actions.

Each command should have a stable action id, label, optional aliases, category, availability state, optional shortcut display, and a typed execution handler that routes into existing product behavior.

Representative shape:

```ts
type CommandAction = {
  id: string;
  label: string;
  category:
    | "session"
    | "surface"
    | "project-ci"
    | "handler-thread"
    | "workflow-inspector"
    | "workflow-library"
    | "pane"
    | "settings"
    | "agent-settings";
  aliases: string[];
  shortcut: string | null;
  availability: CommandAvailability;
  execute: CommandExecutionTarget;
  badge?: string;
};

type CommandAvailability =
  | { kind: "available" }
  | { kind: "disabled"; reason: string }
  | { kind: "hidden" };

type CommandExecutionTarget =
  | { kind: "create-session"; initialPrompt?: string }
  | { kind: "open-session"; workspaceSessionId: string }
  | { kind: "open-workflow-task-attempt"; workspaceSessionId: string; workflowTaskAttemptId: string }
  | { kind: "update-session-navigation"; workspaceSessionId: string; action: "pin" | "unpin" | "archive" | "unarchive" }
  | { kind: "open-surface"; surface: CommandSurfaceTarget }
  | { kind: "start-orchestrator-turn"; workspaceSessionId: string; prompt: string }
  | { kind: "start-handler-turn"; workspaceSessionId: string; threadId: string; prompt: string }
  | { kind: "open-settings"; target: string }
  | { kind: "pane-action"; action: string };
```

The registry should be generated or assembled from product-owned action definitions rather than hand-maintained loose prose. As features add product actions, they should add command entries through the same registry model.

## Search And Matching

Command search should match across:

- command label
- aliases
- category
- relevant target names, such as session title, thread title, workflow label, artifact title, or Project CI status label

Search order should prefer exact and prefix matches before fuzzy matches. Disabled commands may be visible when they explain why an action is unavailable. Hidden commands should not appear.

Search is discovery and selection. It does not parse arbitrary typed text into shell commands.

## Execution And Routing

Command execution routes into the existing product model.

Rules:

- session creation creates a normal durable workspace session and orchestrator surface
- session switching uses existing workspace navigation state
- session pin, unpin, archive, and unarchive use existing durable navigation fields
- `Open Session` results cover orchestrator, handler-thread, and workflow task-agent projection categories and must show a visible kind badge for the category
- opening an orchestrator session or handler-thread session uses normal live surface open behavior
- opening a workflow task-agent projection session opens the existing workflow task-attempt inspector unless a future product decision promotes task agents to live interactive pane surfaces
- Project CI run and configuration commands route through ordinary orchestrator or handler-thread turns
- handler-thread actions target existing handler-thread surfaces or create handler work through `thread.start` only when the orchestrator model calls for delegation
- workflow inspector actions open inspection surfaces over durable workflow-run state and Smithers-native inspection APIs
- Smithers operations remain handler-thread tools exposed under the `smithers.*` surface; the palette must not introduce a parallel `workflow.*` command system
- settings and agent-setting commands open or update the product-owned settings surfaces when those features exist

The command palette does not execute repository commands directly. Repository work still flows through pi-backed surfaces, normal turns, `execute_typescript`, handler threads, and Smithers-backed workflows.

## Fallback Prompt Behavior

When `Cmd+Shift+P` is open and the typed text does not match an existing command or action, pressing Enter creates a new session and uses the typed text as that session's initial prompt.

Rules:

- empty or whitespace-only text must not create a new session
- matched commands execute the selected command instead of creating a prompt session
- unmatched text creates a normal top-level session container with a main orchestrator surface
- the initial prompt enters the orchestrator through the normal turn model
- the fallback must not bypass prompt history, structured turn state, system prompt loading, or live surface runtime ownership

## Quick Open Placeholder

`Cmd+P` is reserved for file quick-open.

Until file surfaces exist, quick-open has placeholder semantics:

- it may open a quick-open UI shell
- it may show that file quick-open is not available yet
- pressing Enter on arbitrary text must not create a session
- it must not search files through an unowned execution path
- it must not create file editor, diagnostics, or typecheck records before those product surfaces exist

## Relationship To Panes

The core command palette section defines default behavior in pre-pane terms: commands use the product's normal current workspace and session routing.

Pane-specific placement behavior belongs to `docs/specs/pane-layout.spec.md`. Once pane layout exists, command palette results that open sessions or surfaces default to opening in a new pane, while `Cmd+Enter` from the command palette opens the selected command or result into the currently focused pane.

## Relationship To Product Areas

Sessions:

- the palette exposes new session, switch session, open session, pin, unpin, archive, and unarchive actions
- fallback unmatched text creates a normal session with an initial orchestrator prompt

Project CI:

- the palette may expose run and configure actions
- those actions route through normal orchestrator or handler-thread behavior
- the palette does not create a CI-specific orchestrator, CI-specific runtime, setup launcher, or direct workflow execution path

Handler threads:

- the palette can open existing handler-thread surfaces
- commands that need new delegated work still route through the orchestrator and `thread.start`

Workflow inspectors:

- the palette can open workflow inspector-related surfaces over durable workflow-run state
- workflow inspection remains separate from orchestrator reconciliation by default

Panes:

- the palette can expose pane and layout actions once pane layout exists
- pane placement and focused-pane replacement behavior are defined by the pane-layout spec

Settings and agent settings:

- the palette exposes ordinary session creation and quick-session creation as distinct actions
- the palette can expose settings, provider, session-agent, and workflow-agent actions when those features exist
- these actions open or update product-owned settings surfaces

Future product actions:

- new product actions should become discoverable through the same command registry when they are useful from the shell
- command entries should point to existing product operations rather than creating parallel action paths

## Invariants

- `Cmd+Shift+P` is the all-actions command palette.
- `Cmd+P` is file quick-open.
- File quick-open is a placeholder until file-oriented surfaces exist.
- The command palette uses `cmdk-sv` as the intended Svelte UI primitive when implemented.
- The command registry is product-owned.
- Commands route into existing product models and durable state.
- Unmatched non-empty `Cmd+Shift+P` text creates a new session initial prompt.
- The palette is not an execution engine.
- The palette is not a standalone shell, terminal, readline loop, or alternate TUI stack.
- The palette does not invent a parallel workflow abstraction.
- Project CI actions route through normal orchestrator or handler-thread behavior.
- Smithers execution remains owned by handler threads through Smithers-native tools.
- Pane-specific placement behavior is defined by the pane-layout spec.

## Relationship To Other Specs

- `docs/prd.md` defines the product-level command palette and quick-open behavior.
- `docs/specs/pane-layout.spec.md` defines pane-specific placement for command palette results once pane layout exists.
- `docs/specs/workspace-navigation-core-projection.spec.md` defines the session navigation and surface projection state that command actions operate on.
- `docs/specs/multi-session-support.spec.md` defines the existing multi-session primitives used by session commands.
- `docs/specs/structured-session-state.spec.md` defines session, thread, workflow-run, artifact, Project CI, and turn records that command actions reference.
- `docs/specs/project-ci.spec.md` defines Project CI routing and projection.
- `docs/specs/workflow-supervision.spec.md` defines Smithers-backed workflow supervision and workflow inspector behavior.

## Product Outcomes

This design is successful when:

- users can discover and execute product actions from `Cmd+Shift+P`
- `Cmd+P` is reserved for future file quick-open behavior without implying file surfaces that do not exist
- unmatched palette text starts a normal new session prompt
- command results use existing sessions, surfaces, orchestrator and handler routing, durable state, and pane semantics
- implementation can use `cmdk-sv` for the Svelte menu UI without delegating product semantics to the UI library
