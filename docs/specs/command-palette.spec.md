# Command Palette And Quick Open Spec

## Status

- Date: 2026-04-27
- Status: adopted direction for Section 9 command palette and quick open
- Scope of this document:
  - define the product-level unified palette surface for command mode and quick-open search mode
  - define keyboard shortcuts and fallback prompt behavior
  - define the command/action registry model
  - define the shortcut registry and TanStack Hotkeys dispatch boundary
  - define prefix-driven command search, matching, and execution routing semantics
  - define how the palette relates to sessions, Project CI, handler threads, workflow inspectors, Workflows library browsing, Agents profile browsing, Extensions browsing, generated agent-context preview actions, Dockview panels, settings, and future product actions

## Purpose

The palette is the shell-level action and search surface for `svvy`.

It gives users a VS Code-like way to discover and execute product actions without turning those actions into a second runtime. There is one shared palette shell, one input, and one result interaction model. Command behavior is selected by the input prefix: `>` means command mode. `Cmd+Shift+P` opens the shared palette with `>` already inserted, while `Cmd+P` opens the same shared palette with an empty input for file quick-open search mode, which is intentionally a placeholder until file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces exist.

The palette invokes existing product behavior. It routes into sessions, Dockview panels, surfaces, orchestrator and handler turns, Smithers-native tools, Project CI projection, Workflows library browsing, Agents profile browsing, Extensions browsing, generated agent-context preview actions, durable state, and settings. It must not become an alternate execution engine, standalone shell, custom terminal loop, readline loop, or parallel workflow abstraction.

## Source Boundaries

Public Slate facts and `svvy` product choices must stay separate.

- Public Slate facts may inform the expected feel of fast action discovery and visible orchestration.
- PRD inferences define the `svvy` product direction: pi-backed surfaces, one strategic orchestrator, delegated handler threads, and Smithers-backed workflow supervision.
- This spec defines `svvy` implementation-level product choices for command discovery and routing. It is not evidence about Slate internals.

## Non-Goals

The command palette does not implement:

- a standalone terminal, custom shell, readline loop, or alternate TUI stack outside pi
- a second command execution runtime
- a parallel workflow registry or `workflow_*` abstraction
- direct Smithers execution from the shell outside the owning handler-thread model
- direct Project CI execution outside normal orchestrator or handler-thread routing
- file quick-open results before file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces exist
- Dockview placement semantics as core palette behavior; panel-specific placement belongs to `docs/specs/pane-layout.spec.md`

## UI Primitive

When implemented, the palette UI should use `cmdk-sv` from `https://www.cmdk-sv.com/` as the Svelte command menu primitive. Its docs describe it as a "fast, composable, unstyled command menu for Svelte."

The intended use is as a fast, unstyled, composable command menu foundation. `svvy` still owns product semantics, command registry shape, search metadata, routing, telemetry, state updates, keyboard dispatch, and styling.

`cmdk-sv` is a renderer UI primitive, not a product action registry, runtime engine, or source of command semantics.

## Keyboard Shortcuts

`Cmd+Shift+P` opens the shared palette with the input value seeded to `>`. If the palette is already open, the same chord switches the focused palette input to command mode and seeds `>`.

All palette, sidebar, pane, and action shortcuts come from the product shortcut registry. Shortcut definitions are not duplicated in palette rendering, tooltip rendering, app menu accelerators, or Svelte component event handlers.

With that prefix present, the palette discovers and executes product actions, including:

- create a New orchestrator session
- open or switch to existing session-like targets, including orchestrator sessions, handler-thread sessions, and workflow task-agent projection sessions
- pin, unpin, archive, and unarchive sessions
- open focused session, thread, workflow, artifact, and Project CI surfaces
- run or configure Project CI through normal orchestrator or handler-thread routing
- open handler thread surfaces
- open workflow inspector-related surfaces
- open the read-only Workflows library surface
- open Extensions surfaces and generated agent-context previews
- Dockview panel and layout actions once Dockview layout exists
- settings and Agents profile actions when those features exist
- future product actions as they are added

`Cmd+P` opens the same shared palette with an empty input. If the palette is already open, the same chord switches the focused palette input to quick-open mode and clears the command prefix.

For now, file quick-open is intentionally a no-op placeholder:

- the UI may show a quick-open unavailable state while the input does not start with `>`
- it must not fabricate file, editor, or diagnostics surfaces
- it must not browse files through an ad hoc shell or terminal path
- it becomes actionable only after dedicated file-navigation primitives are designed

Typing `>` into the quick-open input switches the already-open palette into command mode. Deleting the leading `>` switches it back to quick-open search mode. This prefix is the mode switch; there must not be two separate palette implementations with duplicated matching, rendering, keyboard handling, history, or result plumbing.

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
    | "extensions"
    | "generated-agent-context"
    | "pane"
    | "settings"
    | "agents";
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
  | {
      kind: "open-workflow-task-attempt";
      workspaceSessionId: string;
      workflowTaskAttemptId: string;
    }
  | {
      kind: "update-session-navigation";
      workspaceSessionId: string;
      action: "pin" | "unpin" | "archive" | "unarchive";
    }
  | { kind: "open-surface"; surface: CommandSurfaceTarget }
  | { kind: "start-orchestrator-turn"; workspaceSessionId: string; prompt: string }
  | { kind: "start-handler-turn"; workspaceSessionId: string; threadId: string; prompt: string }
  | { kind: "open-settings"; target: string }
  | { kind: "pane-action"; action: string };
```

The registry should be generated or assembled from product-owned action definitions rather than hand-maintained loose prose. As features add product actions, they should add command entries through the same registry model.

## Shortcut Registry And Hotkey Dispatch

The shortcut registry is the product-owned source of keyboard behavior metadata.

Each shortcut has a stable action id, label, TanStack hotkey chord, compact display string, readable display string, optional Electrobun app-menu accelerator, scope, input-typing policy, availability, and optional command action linkage.

Scopes include:

- `global`
- `workspace-shell`
- `focused-pane`
- `dialog`
- `input`

The registry decides whether a shortcut may fire while the user is typing. App launcher and shell command chords, including `Cmd+Shift+P`, `Cmd+P`, `Cmd+N` for New orchestrator in the focused pane, `Cmd+Shift+N` for New orchestrator in a new pane, sidebar toggle, `Cmd+Shift+1` for Logs, `Cmd+Shift+2` for Agents, `Cmd+Shift+3` for Extensions, and `Cmd+Shift+4` for Workflows, are intentionally available while workspace text inputs such as the composer are focused because they are command chords rather than text editing keystrokes. Text-editing-like shortcuts are suppressed inside text inputs, textareas, selects, and contenteditable regions unless the shortcut is explicitly input-local or dialog-local, such as composer Enter, palette Enter, or dialog Escape.

TanStack Hotkeys owns renderer keyboard subscription, chord matching, scoped attachment, conflict handling, and input suppression. It does not own product semantics. Hotkey callbacks dispatch product actions through the shortcut registry and command/action registry rather than executing unrelated product behavior directly.

Electrobun app-menu accelerators are generated from the same shortcut registry entries as renderer hotkeys, so menu shortcuts, sidebar hints, command palette hints, and tooltip keycaps stay aligned.

## Search And Matching

When the input starts with `>`, command search uses the text after the prefix and should match across:

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
- handler-thread actions target existing handler-thread surfaces or create handler work through `thread_start` only when the orchestrator model calls for delegation
- workflow inspector actions open inspection surfaces over durable workflow-run state and Smithers-native inspection APIs
- Smithers operations remain handler-thread tools exposed under the `smithers_*` surface; the palette must not introduce a parallel `workflow_*` command system
- settings and Agents profile commands open or update the product-owned settings surfaces when those features exist

The command palette does not execute repository commands directly. Repository work still flows through pi-backed surfaces, normal turns, `execute_typescript`, handler threads, and Smithers-backed workflows.

## Fallback Prompt Behavior

When the shared palette is in command mode and the text after `>` does not match an existing command or action, pressing Enter creates a New orchestrator session and uses the text after `>` as that session's initial prompt.

Rules:

- empty or whitespace-only text must not create a new orchestrator session
- matched commands execute the selected command instead of creating a prompt session
- unmatched command-mode text creates a normal top-level session container with a main orchestrator surface
- the initial prompt enters the orchestrator through the normal turn model
- the fallback must not bypass prompt history, structured turn state, system prompt loading, or live surface runtime ownership
- quick-open search mode text, meaning input without the leading `>`, must not create a prompt session while file quick-open is still a placeholder

## Quick Open Placeholder

`Cmd+P` is reserved for file quick-open and opens the shared palette without a prefix.

Until file surfaces exist, quick-open has placeholder semantics:

- it may open a quick-open UI shell
- it may show that file quick-open is not available yet
- pressing Enter on arbitrary text must not create a session
- typing `>` immediately switches the same UI into command mode
- it must not search files through an unowned execution path
- it must not create file editor, diagnostics, or typecheck records before those product surfaces exist

## Relationship To Dockview Panels

The core command palette section defines default behavior before choosing a Dockview target: commands use the product's normal current workspace and session routing.

Dockview placement behavior belongs to `docs/specs/pane-layout.spec.md`. Command palette results that open sessions or surfaces default to opening in a new Dockview panel, while `Cmd+Enter` from the command palette opens the selected command or result into the currently focused Dockview panel.

## Action Feedback And Shortcut Hints

Command-related action controls use two distinct feedback layers:

- an instant in-control shortcut hint for controls with a direct keybinding
- a delayed explanatory tooltip that appears after 500 ms of hover or keyboard focus

The instant hint uses the compact display shortcut from the product shortcut registry, such as `⌘N`. It belongs inside the action control and appears immediately on hover or focus without resizing the control. For the sidebar New orchestrator control, the delayed tooltip also explains click, `Cmd+N`, `Cmd`-click, `Cmd+Shift+N` placement, and profile-picker behavior because the same control supports focused-pane and new-pane creation from the ordered orchestrator profile list. For other explicit labeled sidebar actions such as command palette and quick open, the instant hint is usually sufficient and those actions do not also need an explanatory tooltip.

The delayed tooltip uses the readable shortcut form from the same registry, such as `Cmd+N`, when a shortcut exists, but renders it with the same segmented keycap treatment as compact hints. It explains icon-only or ambiguous actions rather than repeating obvious sidebar labels. Native browser `title` tooltips must not be used for these product action buttons because their delay, styling, and shortcut rendering are browser-controlled.

Action tooltips render in the app's top-level overlay layer, clamp to the visible window bounds, and choose a side appropriate to the control's chrome context so sidebar, titlebar, Dockview, and composer controls are not clipped by pane or scroll containers.

Controls without keybindings may still use the delayed tooltip when the icon or compact label is not self-explanatory. Tooltips are local UI feedback only; they must not create durable session, command, log, workflow, or telemetry records.

## Relationship To Product Areas

Sessions:

- the palette exposes New orchestrator, switch session, open session, pin, unpin, archive, and unarchive actions
- fallback unmatched command-mode text creates a normal orchestrator session with an initial orchestrator prompt

Project CI:

- the palette may expose run and configure actions
- those actions route through normal orchestrator or handler-thread behavior
- the palette does not create a CI-specific orchestrator, CI-specific runtime, setup launcher, or direct workflow execution path

Handler threads:

- the palette can open existing handler-thread surfaces
- commands that need new delegated work still route through the orchestrator and `thread_start`

Workflow inspectors:

- the palette can open workflow inspector-related surfaces over durable workflow-run state
- workflow inspection remains separate from orchestrator reconciliation by default

Dockview panels:

- the palette can expose panel and layout actions once Dockview layout exists
- panel placement and focused-panel replacement behavior are defined by the pane-layout spec

Settings and Agents:

- the palette exposes New orchestrator actions backed by ordered orchestrator profiles and carries the selected `agentProfileId` into normal session creation
- the palette can expose settings, provider, Agents profile, and future extension or workflow-agent actions when those features exist
- these actions open or update product-owned settings surfaces

Future product actions:

- new product actions should become discoverable through the same command registry when they are useful from the shell
- command entries should point to existing product operations rather than creating parallel action paths

## Invariants

- `Cmd+Shift+P` opens the shared palette with `>` prefilled.
- `Cmd+P` opens the shared palette with an empty input for file quick-open search mode.
- `Cmd+Shift+1`, `Cmd+Shift+2`, `Cmd+Shift+3`, and `Cmd+Shift+4` open Logs, Agents, Extensions, and Workflows in sidebar order while preserving plain `Cmd+1/2/3/4` for future pane or tab switching.
- The leading `>` is the only command-mode switch; adding or removing it changes live behavior in the same UI.
- File quick-open is a placeholder until file-oriented surfaces exist.
- The palette uses `cmdk-sv` as the intended Svelte UI primitive when implemented.
- The command registry is product-owned.
- Product action buttons use the product shortcut registry for shortcut hints and avoid native browser `title` tooltips; command-palette and quick-open launchers live in the sidebar rather than duplicated in the top-right workspace chrome.
- TanStack Hotkeys is the renderer dispatch primitive and is not the source of product command semantics.
- Commands route into existing product models and durable state.
- Unmatched non-empty command-mode text after `>` creates a New orchestrator initial prompt.
- Non-command quick-open text must not create a session while quick-open is a placeholder.
- The palette is not an execution engine.
- The palette is not a standalone shell, terminal, readline loop, or alternate TUI stack.
- The palette does not invent a parallel workflow abstraction.
- Project CI actions route through normal orchestrator or handler-thread behavior.
- Smithers execution remains owned by handler threads through Smithers-native tools.
- Dockview placement behavior is defined by the pane-layout spec.

## Relationship To Other Specs

- `docs/prd.md` defines the product-level unified palette, command-prefix, and quick-open behavior.
- `docs/specs/pane-layout.spec.md` defines Dockview placement for command palette results once Dockview layout exists.
- `docs/specs/workspace-navigation-core-projection.spec.md` defines the session navigation and surface projection state that command actions operate on.
- `docs/specs/multi-session-support.spec.md` defines the existing multi-session primitives used by session commands.
- `docs/specs/structured-session-state.spec.md` defines session, thread, workflow-run, artifact, Project CI, and turn records that command actions reference.
- `docs/specs/project-ci.spec.md` defines Project CI routing and projection.
- `docs/specs/workflow-supervision.spec.md` defines Smithers-backed workflow supervision and workflow inspector behavior.

## Product Outcomes

This design is successful when:

- users can discover and execute product actions from `Cmd+Shift+P` or by typing `>` into the shared palette
- `Cmd+P` is reserved for future file quick-open behavior without implying file surfaces that do not exist
- unmatched command-mode text starts a normal New orchestrator prompt without including the leading `>` in the prompt
- command results use existing sessions, surfaces, orchestrator and handler routing, durable state, and Dockview panel semantics
- implementation can use `cmdk-sv` for the Svelte menu UI without delegating product semantics to the UI library
