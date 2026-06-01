# Context Library Spec

## Status

- Date: 2026-05-15
- Status: adopted product contract
- Scope of this document:
  - define the Context pane
  - define reusable instruction blocks
  - define reusable context packs
  - define actor prompt recipes
  - define generated prompt parts inside actor recipes
  - define read-only runtime standards sources shown in Context
  - define app-global and workspace-scoped prompt blocks
  - define internal prompt revision binding and user-named snapshots
  - define generated agent context drift detection and automatic update behavior
  - define the sidebar reference-pane order

## Purpose

`svvy` should make its prompt system explicit, editable, and recoverable without reducing it to one giant raw system-prompt textarea.

The product model is:

```text
Context = editable Context Library + generated contracts + read-only runtime standards
```

The user manages reusable prompt material in the editable Context Library. Actor prompts are aggregates assembled from that material plus generated tool or schema contracts. Pi-discovered runtime standards sources are shown in the same read-only generated-context area as generated prompt parts, but they are not edited, snapshotted, or rediscovered by svvy. New orchestrator sessions always use the latest context library revision and current runtime standards fingerprints. Existing sessions bind to the exact generated agent context they received, then automatically refresh to the latest ready generated agent context at the next safe boundary when that context changes. Raw revision counters are internal and are not shown as primary Context pane UI.

## Product Principles

- Context customization is a first-class product surface, not hidden inside agent profile settings.
- The Context pane organizes similar material together. Actors are recipes, not the primary authoring unit.
- Instruction blocks and context packs are ordinary editable records with names, bodies, actor settings, enabled state, scope, custom-record delete actions, and reset behavior.
- Shipped defaults are protected from deletion but not editing. Reset actions restore their shipped state.
- Generated prompt parts are visible inside actor recipes but are not edited as normal text blocks.
- Runtime standards sources loaded by pi are visible as read-only generated-context material with file name, path, content, order, and an external-editor action.
- Scope is explicit. Blocks are app-global by default, but each block can be limited to selected previously opened workspaces.
- The app records exactly which prompt revision, runtime standards fingerprints, and generated
  agent context fingerprint each session, handler thread, and workflow task agent used.
- The user can explicitly save named snapshots and restore them later without relying on autosave history.
- The UI shows generated agent context update work when an existing surface is waiting to apply
  changed prompt material, generated contracts, extension context, or runtime standards.
- Updating an existing surface to the latest ready generated agent context is automatic and happens
  at the next safe boundary: before the next prompt-bearing turn when idle, or through pi's
  `refreshRunContext` hook when active. Already-issued tool calls finish under the context that
  produced them.

## Terminology

### Context Library

The current editable prompt configuration.

It contains:

- instruction blocks
- context packs
- actor recipe settings
- shipped default records
- user-created records
- scope settings
- enabled states
- generated prompt-part references

### Runtime Standards Source

A read-only agent standards file discovered by pi's resource loader and appended to the actual agent prompt as project context.

Adopted runtime standards sources:

- `AGENTS.md`
- `CLAUDE.md`

Runtime standards sources are not Context Library records. They are not user-editable from the Context pane, not saved in user-named Context snapshots, and not discovered through svvy's own file search. svvy asks pi's loaded resource state which standards files it found, displays the exact loaded content in the actor aggregate's generated-context area, stores the exact bound content and hash for each surface, and uses those hashes in prompt drift checks.

`svvy` does not use pi prompt replacement or append files. Pi `SYSTEM.md` and `APPEND_SYSTEM.md` files are ignored by svvy sessions, handler threads, and workflow task agents.

### Internal Prompt Revision

A monotonically increasing internal version of the context library used for binding sessions, handler threads, and workflow task agents to the prompt state that was current when they started.

New orchestrator sessions, handler threads, and workflow task agents bind to a prompt revision so the product can explain what prompt shape they used later.

### User Snapshot

A named, user-created copy of the current Context Library state.

Snapshots are for recovery and experimentation. They are created explicitly from the Context pane navigation, can be loaded later, and can be renamed. Loading a snapshot makes that snapshot's state the current Context Library state and creates a new internal revision.

### Instruction Block

A reusable piece of written instruction text.

Examples:

- `Common Engineering Instructions`
- `Orchestrator Role`
- `Handler Role`
- `Workflow Task Role`
- user-created style, planning, validation, review, or project-policy instructions

Instruction blocks are included directly in actor prompts according to their actor inclusion selector.

### Context Pack

A reusable knowledge module that can be loaded by default for actors and can also be requested by tools or future workflows when a task needs it.

Examples:

- `Code Navigation`
- `Smithers Routing`
- `Smithers Supervision`
- `Workflow Task Boundary`
- `Project CI`
- `Web Tools`
- user-created domain, framework, company-policy, or workflow-specific knowledge packs

Context packs are conceptually distinct from instruction blocks because they represent modular product or domain knowledge rather than general behavioral instructions.

### Actor Recipe

The assembled prompt shape for one actor class.

Adopted actor classes:

- orchestrator
- handler
- workflow task agent

An actor recipe includes:

- all enabled instruction blocks that include that actor
- all enabled context packs default-loaded for that actor
- generated prompt parts for that actor

### Generated Prompt Part

Prompt text generated from source contracts, tool registries, or runtime settings.

Examples:

- actor-specific callable tool declarations
- `execute_typescript` API declaration
- workflow authoring TypeScript contract
- generated provider-backed web contract details

Generated prompt parts appear in the actor aggregate view as scrollable code previews containing the exact generated text that would be inserted for the current workspace settings. Each generated row opens a generated context file under `.svvy/generated/context-library/...` so the link works from packaged builds without a source checkout and reflects dynamic settings-derived prompt text. They are not edited through normal instruction or context-pack text editors.

## Sidebar

The workspace sidebar includes:

```text
Logs
Agents
Context
Workflows
```

`Agents` opens the app-wide agent profile pane. It sits between Logs and Context so model/profile selection is adjacent to prompt composition without owning reusable prompt text.

`Workflows` opens the Workflows library surface. The label reflects that the surface presents saved workflow assets plus artifact workflow groups.

The `Context` entry opens the Context pane.

## Context Pane Structure

The Context pane has three primary sections:

```text
Instructions
Context Packs
Actors
```

The pane uses a dense workbench layout:

- a compact section selector
- a searchable list for the selected section
- a detail/editor area for the selected record
- stable action locations for create, delete, reset, compare, navigation, and autosave status
- explicit snapshot creation, loading, and rename controls docked in the Context pane header beside the pane chrome actions

The Context pane must not rely on modal-first flows. Inline editing and progressive disclosure are preferred.

## Instructions Section

The Instructions section manages instruction blocks.

### Instruction Block Fields

Each instruction block has:

```ts
type PromptActor = "orchestrator" | "handler" | "workflow-task";

type PromptBlockScope = {
  appGlobal: boolean;
  workspaceKeys: string[];
};

type InstructionBlock = {
  id: string;
  kind: "instruction";
  name: string;
  body: string;
  enabled: boolean;
  actors: PromptActor[];
  scope: PromptBlockScope;
  origin: "shipped" | "user";
  defaultSnapshot: null | {
    name: string;
    body: string;
    enabled: boolean;
    actors: PromptActor[];
    scope: PromptBlockScope;
  };
  createdAt: string;
  updatedAt: string;
};
```

`origin` controls deletion. Builtin shipped records remain editable, scopeable, disableable, and resettable, but only custom user-created records can be deleted.

### Default Instruction Blocks

The shipped context library seeds these instruction blocks:

- `Common Engineering Instructions`
  - actors: orchestrator, handler, workflow task
- `Orchestrator Role`
  - actors: orchestrator
- `Handler Role`
  - actors: handler
- `Workflow Task Role`
  - actors: workflow task

These defaults replace the current hardcoded actor-instruction sections. They remain editable but not deletable.

### Instruction List Controls

The Instructions section supports:

- search by name and body
- filter by actor inclusion
- filter by enabled or disabled
- filter by `Builtin`, `Edited`, and `User-created`
- row-level enabled checkboxes beneath each row's builtin, edited, or custom badge
- `New Instruction`

The actor filter shows blocks used by selected actors. It is a filter, not a category split.

### Instruction Detail Controls

Every instruction block supports:

- edit name
- edit body
- enable or disable from the instruction row checkbox
- select included actors through checkbox chips
- set scope below actor inclusion through an App global checkbox and disabled-when-global workspace multi-select combobox, with a caption that says either every workspace applies or `Applies in n workspaces`
- debounced text autosave with visible dirty, saving, saved-at, and failed-save states
- immediate persistence for enabled, scope, and actor inclusion controls
- delete when the block is custom, with inline confirmation
- reset this block to its shipped default when the block has a default snapshot, with inline confirmation
- compare with default when the block has a default snapshot and differs from it

Delete is available only for custom instruction blocks.

When an instruction is disabled, its detail pane shows an inline warning that it will not be injected into the system prompt.

When disabling a shipped block, or removing an actor from one, the UI shows inline warning copy near the action:

```text
This changes shipped prompt guidance. Reset this block to restore it.
```

Resetting a block requires inline confirmation because it discards the current prompt text and state for that block.

### Instruction Block Reset

Instruction reset is scoped to the selected instruction block.

It must:

- restore the shipped name
- restore the shipped body
- restore the shipped enabled state
- restore the shipped actor selections
- restore the shipped scope

The inline confirmation copy should be explicit:

```text
This restores this instruction to its shipped prompt text, enabled state, scope, and actor settings.
```

The Context pane does not expose a global reset-all control for instructions.

## Context Packs Section

The Context Packs section manages context-pack blocks.

Context packs have the same general editability as instruction blocks, but their actor controls mean "loaded by default" rather than "included as an instruction".

### Context Pack Fields

```ts
type ContextPack = {
  id: string;
  kind: "context-pack";
  name: string;
  body: string;
  enabled: boolean;
  defaultLoadedActors: PromptActor[];
  requestableByActors: PromptActor[];
  scope: PromptBlockScope;
  origin: "shipped" | "user";
  defaultSnapshot: null | {
    name: string;
    body: string;
    enabled: boolean;
    defaultLoadedActors: PromptActor[];
    requestableByActors: PromptActor[];
    scope: PromptBlockScope;
  };
  createdAt: string;
  updatedAt: string;
};
```

`defaultLoadedActors` controls which actors receive the context pack by default.

`requestableByActors` controls which actors can request the context pack through product mechanisms such as `thread_start({ context })`, `request_context`, or future workflow-level prompt-context loading.

The MVP may expose `requestableByActors` as read-only if the current runtime only supports handler-side context requests. The data model should still account for it so the UI language stays true:

```text
Switches control which actors receive this pack by default. Requestable actors can load the pack later when a task needs it.
```

### Default Context Packs

The shipped context library seeds context packs corresponding to today's prompt-context behavior:

- `Code Navigation`
  - default-loaded actors: orchestrator, handler, workflow task
  - requestable actors: none in MVP
- `Smithers Routing`
  - default-loaded actors: orchestrator
  - requestable actors: none in MVP
- `Smithers Supervision`
  - default-loaded actors: handler
  - requestable actors: none in MVP
- `Workflow Task Boundary`
  - default-loaded actors: workflow task
  - requestable actors: none in MVP
- `Web Tools`
  - default-loaded actors: orchestrator, handler, workflow task
  - requestable actors: none in MVP
- `Project CI`
  - default-loaded actors: none
  - requestable actors: handler

There is no `Required` or `Optional` category in the Context pane.

Default context packs are editable, scopeable, and disableable, but not deletable. Shipped defaults can be restored through reset.

### Context Pack List Controls

The Context Packs section supports:

- search by name and body
- filter by actor default-loaded state
- filter by requestable actor
- filter by enabled or disabled
- filter by `Builtin`, `Edited`, and `User-created`
- row-level enabled checkboxes beneath each row's builtin, edited, or custom badge
- `New Context Pack`

### Context Pack Detail Controls

Every context pack supports:

- edit name
- edit body
- enable or disable from the context-pack row checkbox
- default-loaded actors through checkbox chips
- requestable actor selectors where supported
- set scope below actor inclusion, with a caption explaining whether the pack applies in every workspace or only selected workspaces
- debounced text autosave with visible dirty, saving, saved-at, and failed-save states
- immediate persistence for enabled, scope, default-loaded actor, and requestable actor controls
- delete when the pack is custom
- reset this block to its shipped default when the block has a default snapshot
- compare with default when the block has a default snapshot and differs from it

Default-loaded actor controls use the same checkbox chip pattern as instruction inclusion controls. The detail pane shows an `Actors` group with the actor checkbox chips first and a caption below explaining that instructions are injected into the system prompt for selected actors, while context packs are always loaded for selected actors and can still be requested on the fly by other actors when needed.

Scope controls live in a separate `Scope` group below actor controls. It shows the `App global` checkbox first, then a workspace multi-select combobox, then a caption. When App global is off, the caption is exactly the selected workspace count: `Applies in n workspaces`.

When a context pack is disabled, its detail pane shows an inline warning that it will not be injected into the system prompt.

When disabling or removing a default-loaded actor from a shipped context pack, the UI shows inline warning copy:

```text
This may remove product guidance from selected actors. Reset this block to restore it.
```

### Context Pack Reset

Context-pack reset is scoped to the selected context pack.

It restores the shipped name, body, enabled state, default-loaded actor checkbox chips, requestable actor selectors, and scope for that one pack. The Context pane does not expose a global reset-all control for context packs.

## Block Scope

Every instruction block and context pack has a Scope control.

Default:

```text
[x] App-global
Workspaces: disabled combobox
```

When `App-global` is enabled:

- the block applies in every workspace
- the workspace combobox is disabled
- any selected workspace list is retained but inactive

When `App-global` is disabled:

- the workspace combobox becomes active
- the user can select or unselect one or more workspaces
- the block applies only in selected workspaces

### Workspace Combobox

The workspace combobox lists every workspace that has ever been opened by the app.

Each option shows:

- workspace display name or folder basename
- full path as secondary text
- optional last-opened metadata when available

The combobox supports:

- multi-select
- search
- retaining selections while disabled

The stored workspace value is the workspace `cwd`, not a workspace tab or view id, because duplicate same-cwd tabs are visual views over the same workspace runtime and durable workspace state. The app persists a known-workspaces list from opened workspace tabs so closed-but-previously-opened workspaces remain selectable.

### Inactive Workspace-Scoped Blocks

When the current workspace is not selected by a workspace-scoped block:

- the block remains visible in the Context pane
- the block shows a muted `Not active here` chip
- the actor aggregate view for the current workspace excludes it by default
- the actor aggregate view offers `Show inactive blocks`

This keeps the Context pane a global management surface while keeping actor recipes honest for the current workspace.

## Actors Section

The Actors section is the aggregate view.

It is not the primary authoring surface for instructions or context packs.

For each actor, the UI shows a recipe:

```text
Orchestrator

Instructions
- Common Engineering Instructions
- Orchestrator Role

Context Packs Loaded By Default
- Code Navigation
- Smithers Routing
- Web Tools

Generated
- Orchestrator tool declarations
- execute_typescript API
- AGENTS.md
- CLAUDE.md
```

```text
Handler

Instructions
- Common Engineering Instructions
- Handler Role

Context Packs Loaded By Default
- Code Navigation
- Smithers Supervision
- Web Tools

Requestable Context Packs
- Project CI

Generated
- Handler tool declarations
- Smithers tool declarations
- execute_typescript API
- workflow authoring contract
- AGENTS.md
- CLAUDE.md
```

```text
Workflow Task

Instructions
- Common Engineering Instructions
- Workflow Task Role

Context Packs Loaded By Default
- Code Navigation
- Workflow Task Boundary
- Web Tools

Generated
- Workflow task tool declarations
- execute_typescript API
- AGENTS.md
- CLAUDE.md
```

Rows have actions:

- instruction row: open that instruction block in the right detail pane
- context-pack row: open that context pack in the right detail pane
- generated row: view the actual generated or runtime standards text in a scrollable code block, copy generated text when applicable, and open the generated context file or pi-discovered standards file in the configured editor

The Actors section supports:

- actor selector
- current workspace composition
- `Show inactive blocks`
- `Preview actor prompt`
- `Copy actor prompt`
- `Compare with default`
- `Reset actor composition`

`Reset actor composition` restores actor inclusion/default-loaded checkbox chips for that actor to shipped defaults while leaving block body text alone. Full body reset belongs to each block's own reset control.

## Generated Prompt Parts

Generated prompt parts are baked into actor recipes instead of living in a separate top-level section.

Generated rows must show:

- label
- source type
- used-by actor
- scrollable generated text code block
- copy action
- source navigation to the full generated context file

Generated rows must not replace the generated content with generic explanatory copy. If a generated recipe slot resolves to no prompt text for the current workspace state, the actor aggregate omits that generated row until runtime state makes it concrete.

The product may later add advanced generated-part override support, but it is not part of this adopted baseline.

## Prompt Composition

For a given workspace and actor, prompt composition is deterministic.

The composition order is:

1. enabled active instruction blocks ordered by stable library order
2. enabled active context packs default-loaded for the actor ordered by stable library order
3. generated actor-specific prompt parts ordered by product contract
4. pi-discovered runtime standards sources appended by pi in its project-context order

Stable library order is user-visible and reorderable after MVP. Until reorder UI exists, shipped defaults and creation order define the order.

Instruction and context-pack names should appear as section headings in composed previews. The raw pi system prompt may omit extra UI-only provenance wrappers if the runtime needs a compact prompt, but the preview must preserve provenance. Runtime standards preview rows must reflect the exact content pi loaded, not an independently scanned approximation.

## Internal Revisions And User Snapshots

Every prompt-library save increments an internal revision number. The raw counter is not user-facing Context pane copy; it exists so surfaces can bind to the exact prompt state they used and so generated agent context drift can be computed.

```ts
type PromptRevision = {
  id: string;
  createdAt: string;
  libraryHash: string;
  instructionBlocks: InstructionBlock[];
  contextPacks: ContextPack[];
  actorRecipeSettings: ActorRecipeSettings;
  generatedPartRefs: GeneratedPromptPartRef[];
};
```

`libraryHash` is a canonical hash of revision content excluding volatile timestamps.

The product does not expose autosave revision history as the recovery UI. Instead, the user explicitly creates named snapshots.

```ts
type PromptLibrarySnapshot = {
  id: string;
  name: string;
  createdAt: string;
  state: PromptLibraryState;
};
```

The Context pane has no redundant title header. Snapshot controls live in the Dockview pane header beside the normal pane duplicate and close actions:

- save-snapshot button
- popover with a preselected readable timestamp-style name
- input text selected by default so the user can immediately replace it
- confirmation button to save the snapshot
- snapshot combobox listing saved snapshots
- loading a snapshot by choosing it from the combobox
- rename button for the selected snapshot

The snapshot combobox is also a current-state indicator:

- when the current Context Library content matches a saved snapshot, the combobox displays that snapshot name
- when the current Context Library content does not match any saved snapshot, the combobox displays a special current-state label rather than implying a saved snapshot is active
- when there are no saved snapshots, the combobox displays an empty-snapshot label

The match is based on Context Library content: instruction blocks, context packs, actor recipes, enabled states, actor selections, and scopes. Volatile revision numbers and timestamps must not decide whether the current Context matches a saved snapshot.

Loading a snapshot replaces the current Context Library state and increments the internal revision. It does not mutate the saved snapshot.

## Surface Prompt Binding

New surfaces always bind to the latest internal prompt revision.

### Top-Level Session

When a new orchestrator session is created, persist:

```ts
type SessionPromptBinding = {
  promptRevisionId: string;
  actor: "orchestrator";
  boundExternalSourceHashes: string[];
  resolvedPromptHash: string;
  resolvedPromptTextArtifactId: string | null;
  boundAt: string;
};
```

### Handler Thread

When a handler thread is created, persist:

```ts
type ThreadPromptBinding = {
  promptRevisionId: string;
  actor: "handler";
  boundExternalSourceHashes: string[];
  resolvedPromptHash: string;
  resolvedPromptTextArtifactId: string | null;
  boundAt: string;
};
```

### Workflow Task Agent

When a workflow task agent attempt is created, persist:

```ts
type WorkflowTaskPromptBinding = {
  promptRevisionId: string;
  actor: "workflow-task";
  boundExternalSourceHashes: string[];
  resolvedPromptHash: string;
  resolvedPromptTextArtifactId: string | null;
  boundAt: string;
};
```

The `resolvedPromptHash` records the exact prompt text used at the binding point.

`boundExternalSourceHashes` records the ordered runtime standards content hashes used at the binding point.

The optional `resolvedPromptTextArtifactId` allows later inspection without depending on reconstructing an old generated contract from current code. The implementation may store the prompt text in structured prompt-revision tables instead of an artifact, but the product must preserve enough information to display what was used.

Workflow task-agent prompt configuration is an overlay, not a replacement. If a workflow task-agent config supplies a custom prompt, `svvy` appends it under a task-agent override section after the generated svvy workflow-task base prompt. The base prompt remains mandatory because it carries the task-local actor contract, generated callable API, Smithers ownership boundaries, and runtime standards binding.

The task-attempt generated agent context binding is written to
`workflowTaskAttempt.meta.agentContextBinding` when the task-local runtime first binds the exact
Smithers attempt identity. That binding must be keyed by Smithers
`(runId, nodeId, iteration, attempt)`, not by resume-handle recency or transcript inference.

## New orchestrator Invariant

Every new top-level orchestrator session, handler thread, and workflow task agent must use the latest applicable prompt revision at creation time.

This applies to:

- New orchestrator sessions created from the sidebar
- sessions created from command palette unmatched command-mode text
- forked sessions
- delegated handler threads from `thread_start`
- workflow task-agent attempts created by Smithers supervision

Forking a session creates a new orchestrator session that uses the latest prompt revision by default unless a future explicit "preserve old prompt revision" action is introduced.

## Existing Surface Behavior

Existing surfaces keep their currently bound generated agent context until a ready replacement
generated agent context is applied through `agent_context_refresh`.

The app must not silently mutate an existing surface's system prompt in the middle of already-issued
tool work. It may automatically apply a ready generated agent context at the next safe model
boundary.

`request_context` changes future handler prompt inputs by explicit agent action. Loading optional
context writes durable thread context keys and changes the generated agent context fingerprint for
that handler. `svvy` then enqueues or applies `agent_context_refresh` through the same automatic
path used for prompt-library edits, extension changes, generated contract changes, and runtime
standards changes.

When the current ready generated agent context differs from the bound generated agent context on an
existing surface, `svvy` automatically enqueues `agent_context_refresh`. If the surface is idle, the
update is durably enqueued and claimed before the next prompt-bearing item runs. If the surface is
active, the queue shows a special control row:

```text
Update agent context
```

The row is ordered with other surface queue work. It is not sent to pi, does not create
model-authored transcript text, and does not write prompt history.

Workflow task-agent attempts use the same generated agent context fingerprint model, but they may
show queued or applied update metadata in their inspector or summary because task attempts are not
ordinary long-lived chat surfaces.

## Difference Detection

The product detects out-of-date generated agent context using one resolved comparison:

```ts
surface.agentContextFingerprint !== computeCurrentAgentContextFingerprint(actor, workspace)
```

The generated agent context fingerprint includes:

- exact resolved prompt-library material for that actor
- generated prompt parts and tool/schema contracts
- loaded and available extension context fingerprints
- runtime standards content, order, addition, and removal
- generated-agent-context format version

Prompt-library revision ids and runtime standards fingerprints remain useful internal inputs and
diagnostics, but user-facing update behavior is based on the generated agent context fingerprint.
There is no normal out-of-date warning or explicit user-clicked update button in the resolved
Extensions design.

## View Changes And Update Details

The expanded details for a queued or applied agent context update show a grouped semantic diff.

Default diff view is semantic:

```text
Instructions
- Common Engineering Instructions changed
- Handler Role disabled
- New instruction: Review Strictness

Context Packs
- Project CI edited
- Web Tools disabled for Handler

Actors
- Orchestrator now includes Planning Style

Generated
- execute_typescript API declaration changed

Runtime Standards
- AGENTS.md changed
- CLAUDE.md removed
```

Raw text diff is available as a secondary view.

The semantic diff should group changes by:

- instruction blocks
- context packs
- actor recipe settings
- generated prompt parts
- runtime standards sources
- scope changes
- enabled or disabled state
- actor inclusion/default-loaded changes

The raw generated text diff is available as a secondary diagnostic view.

## Automatic Update

`agent_context_refresh` binds the surface to the latest ready generated agent context through the
same durable surface queue used for user follow-up messages and handler handoffs.

`agent_context_refresh` is a surface-local control item:

- it belongs to one `surfacePiSessionId`
- it is ordered with other surface queue items
- it does not send text to pi
- it does not create transcript content
- it does not write prompt history
- delivery means the generated agent context binding was applied

Rules:

- if the surface has active work or earlier queued work, the update is queued and applies in order
  or at the next pi `refreshRunContext` safe boundary
- if the surface is idle and has no queued work, the update is durably enqueued and atomically claimed before any transient queue row can render
- if user messages or handler handoffs are already queued, `agent_context_refresh` runs in its queue order before later prompt-bearing items
- the next user turn or handler handoff delivered after the refresh uses the latest generated agent context
- the update records a structured lifecycle event
- no prompt-bearing item may pass a required queued agent context refresh unless the user explicitly
  cancels that refresh

The visible surface identity, transcript, structured turns, thread state, workflow state, and queued
items stay attached to the same `surfacePiSessionId`. If pi requires a fresh internal managed session
to load a new `systemPrompt`, `svvy` recreates and rebinds that managed runtime behind the same
product surface.

Lifecycle event:

```ts
{
  kind: "agent_context.updated";
  surfacePiSessionId: string;
  actor: PromptActor;
  previousPromptRevisionId: string;
  nextPromptRevisionId: string;
  previousAgentContextFingerprint: string;
  nextAgentContextFingerprint: string;
  changedCategories: Array<
    | "base_instructions"
    | "loaded_extension_instructions"
    | "available_extension_instructions"
    | "extension_commands"
    | "native_tools"
    | "generated_types"
    | "runtime_standards"
  >;
  changedExtensionIds: string[];
  changedRuntimeStandards: string[];
}
```

The event renders as collapsible product metadata:

```text
Agent context updated
```

The expanded details show what changed. They must not mention other sessions or threads that may
also need or have applied a similar update.

## Cancelled Or Failed Update

While an `agent_context_refresh` item is queued, the queue row label is `Update agent context`.
Cancelling the queued update leaves the old generated agent context bound. If the current context is
still out of date and no refresh is queued, active, or applying, the surface shows a sticky
affordance:

```text
Agent context is out of date
```

with a `Queue update` action.

If `agent_context_refresh` itself fails after a ready generated context exists, the failure is an
internal product error. The affected surface records a user-only product event:

```text
Agent context update failed
```

The event includes a stable app log/error id and actions `Retry` and `Cancel update`. Build,
dependency approval, missing env, install failure, validation failure, and startup rebuild failure
are not agent-context update failures and must not create failed `Update agent context` rows.

The product should preserve the ability to re-open the diff from surface metadata.

## Context Pane Warnings

The Context pane should use inline warnings for actions that affect shipped defaults:

- disabling a shipped instruction or context pack
- deleting a custom instruction or context pack
- removing an actor from a shipped instruction
- turning off default loading for a shipped context pack
- resetting a shipped instruction or context pack

Reset and custom-delete actions use inline confirmation on the row. The Context pane does not expose broad reset-all actions.

## Storage Ownership

Context library state is app-owned settings state with workspace-scoped activation rules.

It is not stored in pi transcript history.

Prompt bindings are structured session state because they describe what a session, thread, or workflow task attempt used.

Prompt revisions are durable app state. They must survive app restart and must be available when a historical session is inspected.

### Workspace Routing

Context Library requests that evaluate or mutate workspace-affecting state must carry the target `workspaceId` explicitly. This includes instruction and context-pack edits, scope changes, actor aggregate reads, generated-context previews, runtime standards projection, snapshot creation and loading, agent-context freshness checks, and agent-context update actions when the result depends on workspace-scoped activation or workspace-derived generated parts.

The backend must resolve these requests from the supplied `workspaceId`, not from the active workspace, focused tab, focused Dockview panel, or active runtime. A background handler or orchestrator surface may keep running in one workspace while another workspace is focused, so active workspace state is not a valid routing key.

The app may keep Context Library records as app-owned settings with workspace-scoped activation metadata, but workspace-specific projection of those records is a workspace-scoped operation. The renderer must preserve `workspaceId` through debounced text autosaves, immediate checkbox/chip/scope persistence, reset actions, delete actions, snapshot actions, actor aggregate reads, and generated-context/open-in-editor actions.

## Relationship To Agent Profiles

Agent profiles continue to own:

- provider
- model
- reasoning level
- namer prompt
- default orchestrator profile settings
- handler-thread special profile settings

The Context pane owns reusable prompt material used by orchestrator, handler, and workflow task-agent prompt composition.

Per-session or per-thread agent profile prompt suffixes should be represented as prompt-library-compatible override blocks when possible so they appear in actor recipes and revision diffs. Until that lands, actor aggregate views must still show those suffixes as included prompt parts.

Workflow-agent and extension-provided profile settings are future work. When adopted, they should integrate with the Agents pane or Workflows library without treating repo-root `workflows/` as shipped product runtime state.

## Relationship To Prompt Context Requests

Context packs replace the hard conceptual split between "always-loaded prompt context" and "optional prompt context" in the UI.

Runtime mechanics still distinguish:

- context packs loaded by default for actors
- context packs requestable by actors later

For MVP, existing `thread_start({ context: ["ci"] })` and handler-side `request_context({ keys: ["ci"] })` map to the `Project CI` context pack.

The Context pane must make this clear:

```text
Switches control default loading. Requestable packs can be loaded later when a task needs them.
```

## Relationship To The Active System Prompt Transcript Row

The active system prompt transcript row remains useful, but it should become an exact surface metadata projection rather than the only prompt-inspection experience.

When a surface prompt differs from current prompt settings, the transcript metadata area should link to:

- the prompt diff
- the Context pane actor recipe
- system-prompt update action

## UX Invariants

- The user can add, edit, delete, disable, scope, and reset custom instruction blocks.
- The user can add, edit, delete, disable, scope, and reset custom context packs.
- Builtin blocks are editable, disableable, scopeable, and resettable, but not deletable.
- Reset is scoped to one selected block and requires inline confirmation.
- Edited shipped blocks are marked `Edited`, not `Builtin`.
- Builtin and edited badges are compact, muted metadata.
- Blocks are app-global by default.
- Workspace-scoped blocks remain visible even when inactive in the current workspace.
- Actor aggregate views are recipes, not the primary editing surface.
- Generated prompt parts are visible inside actor recipes.
- Runtime standards sources are visible in the generated-context area, read-only, openable in the configured external editor, and not editable through the Context pane.
- Pi `SYSTEM.md` and `APPEND_SYSTEM.md` files do not participate in svvy prompt composition.
- New orchestrator sessions use the latest ready generated agent context.
- Existing sessions automatically queue or apply `agent_context_refresh` when their generated agent
  context fingerprint differs from the current ready context.
- Existing sessions expose a sticky `Agent context is out of date` / `Queue update` affordance only
  after the user cancels a queued update while drift still exists.

## Implementation Phases

### Phase 1: Read Model And Navigation

- Keep the sidebar reference-pane order as Logs, Agents, Context, and Workflows.
- Add the Context pane with `Instructions`, `Context Packs`, and `Actors`.
- Project current hardcoded instruction and context material as structured builtin blocks.
- Show generated prompt parts and pi-discovered runtime standards sources inside actor recipes.

### Phase 2: Editable Library

- Persist instruction blocks.
- Persist context packs.
- Add app-global and workspace-scoped block controls.
- Add create, edit, custom-record delete, reset, compare, and filters.
- Compose actor prompts from persisted blocks plus generated parts.

### Phase 3: Snapshots, Revisions, And Bindings

- Persist internal prompt revisions and user-named snapshots.
- Add Context pane snapshot creation, loading, and rename controls.
- Bind new orchestrator sessions, handler threads, and workflow task agents to the latest ready
  generated agent context.
- Store generated agent context fingerprints and inspectable prompt text.
- Store runtime standards fingerprints in generated agent context bindings.
- Show queued, cancelled, applied, and failed generated agent context update states on existing
  surfaces.
- Add grouped semantic diff and raw text diff.
- Add automatic `agent_context_refresh` queue integration.

### Phase 4: Runtime Integration Completion

- Route `thread_start({ context })` and `request_context` through requestable context packs.
- Show requested context packs in handler-thread metadata.
- Ensure generated contract and tool-declaration changes enqueue agent context refreshes when they
  alter exact generated context output.
- Ensure runtime standards content, order, addition, and removal enqueue agent context refreshes when
  they alter exact generated context output.
- Add representative unit and integration coverage for composition, scope filtering, runtime
  standards projection, revision binding, automatic agent context refresh, reset, and actor aggregate
  projection.

## Open Non-Goals

- In-app editing of generated tool contracts is not part of this spec.
- Per-keystroke revision history is not required.
- A marketplace or sharing format for prompt packs is not required.
- Prompt A/B testing is not required.
- Prompt changes should not rewrite historical pi transcripts.
- Runtime standards source editing is done in the workspace files, not inside the Context pane.
