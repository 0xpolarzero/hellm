# Extensions And Tools Spec

## Status

- Date: 2026-05-31
- Status: working product spec from session `019e4bb1-5117-73c3-94b0-372f1905b2ea`
- Scope of this document:
  - define the extension and tool architecture discussed in that session
  - preserve user-pointed decisions and unresolved questions from the discussion
  - define the relationship between Agents, Extensions, actors, profiles, native tools, Incur CLIs, `svvyx`, `execute_typescript`, shell policy, dependencies, and secrets
  - record rejected side ideas so they are not accidentally folded into this feature

This document is intentionally not finished. It is the durable working spec for the design thread.
Future discussion should edit this document directly as decisions are refined.

Related specs:

- `docs/specs/extension-managing.spec.md` defines the Extension Managing extension and its
  `svvyx extensions ...` lifecycle API.

The current PRD and feature inventory still describe the older Context Library, direct-tool, and
`execute_typescript api.*` model. This spec records the newer direction discussed in the session.
When this direction is adopted for implementation, `docs/prd.md`, `docs/features.ts`,
`docs/progress.md`, and the affected prompt, ambient-resource, and execute-typescript specs must be
rewritten to match it.

## Product Intent

`svvy` should stop treating context packs, skills, tools, snippets, and generated prompt blocks as
separate fuzzy concepts.

The product should expose a first-class Extensions model:

- Agents choose model, reasoning, base instructions, and extension composition.
- Extensions define agent capabilities.
- Actor kinds define hard runtime ceilings.
- Generated prompt text, generated CLI help, generated TypeScript types, and actual callable
  runtime surfaces are all derived from the same actor-scoped extension resolution.

The goal is a conservative coding-agent tool model for ordinary coding work, close to Codex and
other strong coding agents, while making `svvy` opinionated where it has product-specific leverage:
actor-scoped capability composition, explicit generated surfaces, extension loading, extension
authoring, encrypted app-managed secrets, rich tool-use visualization, and reversible app-state
changes.

## Explicitly Rejected Or Deferred Ideas From The Session

The session started with several broader ideas. These are not part of this spec unless reintroduced
explicitly later.

- A separate always-on router or manager agent above the orchestrator is not adopted here.
- A Smithers-heavy architecture where Smithers owns all session, subagent, router, and projection
  state is not adopted here.
- Automatic session compaction as a special supervisor or workflow is separate future work.
- Snippets, command-like macros, and user-invoked prompt macros are not part of this feature.
- Incur MCP and Incur skills are not adopted as the runtime integration. `svvy` owns the bridge.

## Core Terminology

### Tool

A tool is a callable model-facing operation.

In the extension architecture, a tool belongs to either:

- a loaded extension
- a small native control surface that the actor kind is allowed to call

The word "tool" should not be used for plain prompt text, profile settings, or runtime standards.

### Instruction

An instruction is prompt text.

Instructions may live in an agent profile, a loaded extension, an available extension's minimal
loading hint, or generated runtime standards. Instructions do not grant capability by themselves.

### Runtime Standard

A runtime standard is an external standards file such as `AGENTS.md` or `CLAUDE.md`.

Runtime standards are neither extensions nor editable prompt blocks, but they must still appear in
the generated-context preview for the agent surface that receives them.

### Snippet

A snippet is an explicit user-inserted prompt macro or command-like macro.

Snippets are not part of this spec. They must not secretly grant tools or change actor capability.

### Actor Kind

An actor kind is a hard runtime role and capability ceiling.

Adopted actor kinds remain:

- orchestrator
- handler thread
- workflow task agent

An actor kind is not an editable user preset. It determines the maximum set of controls the runtime
may ever expose. A user profile cannot turn a workflow task agent into an orchestrator by selecting
more extensions.

### Agent Profile

An agent profile is the user-facing configurable preset in the Agents pane.

It contains:

- display name
- actor kind
- provider/model choice
- reasoning level
- customizable base instructions
- extension usage selections
- generated context and generated runtime-surface previews

The UI may present this whole object as an "agent", but implementation must keep `actorKind` as a
locked field.

### Base Instructions

Base instructions are role-level and tool-agnostic.

Examples:

- "You are the orchestrator."
- "Own strategy and final decisions."
- "Respect repository instructions."
- "Be concise and rigorous."

The base prompt should not contain detailed guidance for shell, patching, Smithers, cx, web, CI,
Incur, or any specific tool. Tool-specific instructions come from built-in or Incur-backed
extensions.

### Extension

An extension is a packaged agent capability.

An extension can be prompt-only, or it can include executable tools. It is the product unit that
replaces the fuzzy "context pack as skill as tool bundle" idea.

Each extension has:

- stable id
- title
- description
- full loaded instructions
- minimal available instructions
- optional Incur CLI source or native runtime binding
- optional TypeScript API enablement
- generated CLI/tool overview
- generated TypeScript API overview
- dependency and env requirements when relevant
- readonly usage view showing which agents use it and whether each usage is default-loaded or
  available
- reset behavior when it is shipped by `svvy`

Extensions are app-global by default. Workspace-specific capability should usually be modeled as an
agent profile that selects a custom extension set, not as hidden workspace mutation of a global
extension. Workspace-scoped extensions remain a future decision.

### Extension Usage State

For each agent profile and actor kind, an extension can be:

- `default_loaded`
- `available`
- `unavailable`

`default_loaded` means:

- full instructions are included in the actor prompt
- the extension is mounted in the actor-scoped `svvyx` CLI if it has commands
- generated command docs are included
- generated TypeScript command types are included when TypeScript API is enabled
- the runtime allows the actor to invoke that extension through the supported execution paths

`available` means:

- only minimal instructions are included
- the minimal instructions explain when and why the extension should be loaded
- the extension is not mounted in `svvyx`
- the extension has no CLI presence
- its command docs and TypeScript types are not included
- the actor may request it through the explicit loading mechanism if the actor kind allows it

`unavailable` means:

- no instructions are included
- no awareness is included
- the extension cannot be requested by `@extension` or `request_extension`
- no generated CLI, docs, types, or runtime surface are exposed

The prompt is advisory only. The runtime must enforce the same state. Generated prompt text and
actual callable surfaces must match.

A native `list_extensions` tool should let the agent inspect:

- currently loaded extensions and their loaded surface summaries
- available extensions that can be requested and their minimal instructions

`list_extensions` must not expose unavailable extensions or command details for available-but-not-
loaded extensions.

### Shipped Extension

A shipped extension is provided by `svvy` by default.

Shipped extensions are:

- enabled by default where appropriate
- non-deletable
- resettable to shipped state
- configurable per agent as default-loaded, available, or unavailable when the actor kind allows it
- allowed to have editable instructions unless the runtime surface itself is generated and read-only

This supersedes the earlier "locked built-ins are non-editable" phrasing in the session. The latest
resolution is: shipped built-ins are non-deletable and resettable, but their instructions and
agent-level enablement can be customized. Generated schemas and app runtime code remain read-only.

Shipped/default is one axis. Runtime implementation is another axis. A shipped extension can be
native-runtime, Incur-backed, or prompt-only.

### Native Runtime Extension

A native runtime extension is an extension whose executable behavior is implemented by `svvy`, pi,
or another app-owned bridge rather than by editable Incur CLI source.

Native runtime extensions are still represented as extensions for composition, instructions,
profile selection, and generated preview.

Native runtime/schema source is app-owned and not edited as Incur source.

### Incur-Backed Extension

An Incur-backed extension defines executable tools as a `wevm/incur` CLI.

The relevant local reference from the session is the checked-out fork at:

- `/Users/polarzero/code/wevm/incur`
- `/Users/polarzero/code/wevm/incur/SKILL.md`
- `/Users/polarzero/code/wevm/incur/skills/incur-typescript-client/SKILL.md`

The session referenced a branch that exposes the TypeScript client surface needed by `svvy`. The app
must verify the exact branch and APIs before implementation.

The branch observed during the session audit was `typed-client-public-surface`; implementation must
still re-verify that this is the correct branch and that its API has not changed.

`svvy` does not expose Incur directly as MCP or as Incur skills. Incur is the source contract and
execution framework for extension CLIs. `svvy` owns actor-scoped mounting, prompt generation,
runtime policy, command facts, UI projection, dependency review, secret injection, and tool-use
visualization.

### Prompt-Only Extension

A prompt-only extension has no CLI runtime.

It still uses the same usage states:

- full instructions when default-loaded
- minimal load guidance when available
- nothing when unavailable

Prompt-only extensions are useful for domain guidance that does not need executable tools.

### Extension Active Build

Extension source edits create draft state.

A successful build creates new active build metadata containing:

- manifest
- full and minimal instructions
- CLI entrypoint or native runtime binding metadata
- generated command docs
- generated command schemas
- generated TypeScript command types when enabled
- dependency graph metadata
- env requirements
- content hashes

Failed builds do not replace the previous active build.

The active build id and hashes are internal state for atomic activation, stale detection, crash
recovery, and diagnostics. They are not user-facing version history, not a rollback surface, and not
something the agent should normally reason about. Product UI should show practical state such as
`Ready`, `Build required`, `Needs dependency approval`, `Build failed`, and `Last built`, not raw
build ids.

### Extension Source Storage

Extensions are app-global in v1. Workspace-local extensions do not exist in v1.

The app-owned extension root is:

```text
~/.config/svvy/extensions/
```

This root is ordinary filesystem storage. Commands such as `svvyx extensions inspect <id> --json`
return absolute paths under this root so agents can inspect them with shell tools and edit editable
source files with `apply_patch`.

Directory layout:

```text
~/.config/svvy/extensions/
  sources/
    user/<extension-id>/
    builtin-overlays/<extension-id>/
  generated/
    extensions/<extension-id>/
    aggregates/<aggregate-hash>/
  builds/
    extensions/<extension-id>/<build-id>/
  package/
    package.json
    bun.lock
    node_modules/
  trash/<trash-id>/
  snapshots/<snapshot-id>/
```

Ownership:

- `sources/user/<id>/` contains editable user extension manifests, instructions, and source.
- `sources/builtin-overlays/<id>/` contains editable overlay files for shipped builtin extensions.
- shipped builtin defaults live in packaged app resources and are read-only.
- `inspect` materializes builtin overlay files before returning editable paths, so normal shell
  inspection and `apply_patch` work even when the user has not edited that builtin before.
- `generated/extensions/<id>/` contains read-only generated command docs, TypeScript declarations,
  and tool schemas for that extension.
- `builds/extensions/<id>/<build-id>/` contains immutable internal build output for that extension.
- `generated/aggregates/<aggregate-hash>/` contains cached actor/session aggregate surfaces derived
  from loaded and available extension sets plus active build hashes.
- `package/` is the single app-global Bun project used for extension dependency installation and
  lockfile state.
- `trash/` stores deleted user extensions for Extension Managing revert.
- `snapshots/` stores user-named extension snapshots and their encrypted secret snapshot material
  where applicable.

Generated files and build outputs are separated from editable source. Agents may inspect generated
paths for traceability, but generated and build paths are not editable source paths.

### Surface Binding

Each session or workflow task-agent attempt stores a durable extension binding:

- actor kind
- selected agent profile or task-agent config identity
- loaded extension ids
- available extension ids
- active build hashes used for those extensions
- aggregate hash for generated prompt text, command docs, tool schemas, and TypeScript declarations

New sessions derive `loadedExtensions` and `availableExtensions` from the agent profile defaults or
from explicit creation-time overrides. `request_extension` mutates only the current session binding by
moving the requested extension from `availableExtensions` to `loadedExtensions`; it never mutates the
global agent profile.

The build unit is an extension. The aggregate generated surface is cached by actor kind, loaded
extension set, available extension set, and active build hashes. It is not built per visual surface.
Two sessions with the same resolved binding share the same aggregate cache. A session that loads an
additional extension gets a different binding and aggregate hash.

When an extension changes and a successful build activates:

- the previous active build remains usable until the new build is complete and atomically activated
- sessions whose loaded or available set contains that extension are marked stale
- inactive sessions refresh through backend preflight before their next prompt-bearing work runs, not
  when a pane is visually opened
- active sessions receive a front-of-queue `extension_binding_refresh` control item for durable
  recovery and apply the new binding at the next safe model boundary when the active pi run reaches
  the `refreshRunContext` hook
- already emitted tool calls finish against the tool set that produced them
- no empty aggregate or missing `svvyx` surface may be exposed between builds

`extension_binding_refresh` is the explicit surface-control work item for extension binding changes.
It updates loaded/available extension binding, generated instructions, generated command docs,
generated TypeScript declarations, tool schemas, and mounted `svvyx` runtime surfaces. It does not
send text to pi, create transcript content, or write prompt history.

If only internal implementation changed and the generated actor-facing surface did not, no stale
surface warning or refresh is needed.

### Active Run Context Refresh

The local pi reference shows that active pi runs snapshot `systemPrompt`, messages, and tools at run
start. Steering and follow-up add user messages; they do not replace the run's system prompt or tool
list. `transformContext` can transform messages only.

The required pi patch is a small active-run context hook, named `refreshRunContext`:

```ts
type RunContextRefresh = {
  systemPrompt?: string;
  tools?: AgentTool[];
};

refreshRunContext?: (
  context: AgentContext,
  signal?: AbortSignal
) => Promise<RunContextRefresh | undefined>;
```

pi must call this hook after pending steering messages are appended and before the next provider call
is started. If the hook returns `systemPrompt` or `tools`, pi replaces the current run context before
calling the model. Because pi also executes tool calls through the same current run context, the next
assistant response and the tool calls it emits stay aligned.

`svvy` uses this hook for orchestrator sessions, handler-thread sessions, and PI-backed workflow
task-agent attempts. All three use `@mariozechner/pi-coding-agent` sessions. Workflow task agents
are task-attempt-scoped rather than long-lived interactive surfaces, but they use the same active-run
refresh mechanism.

This hook is the correct mechanism for automatic instruction/tool updates during active work. It must
not be modeled as a steering message such as "system prompt changed, keep working", because that
would add transcript content and would not replace the run's actual system prompt or tools.

## Panes

The session's later direction is two configuration panes:

```text
Agents
Extensions
```

This conflicts with the current PRD's `Agents`, `Context`, and `Workflows` sidebar model. The final
sidebar and pane plan must be reconciled before implementation.

### Agents Pane

The Agents pane owns agent profiles and actor composition.

It should show:

- orchestrator profiles
- special profiles such as the handler-thread profile
- future workflow task-agent profiles when exposed
- model selection
- reasoning selection
- base instructions
- extension selections
- extension state badges
- generated context/runtime preview for the selected agent

The extension selector should support multi-selection with a state per extension:

- default-loaded
- available
- unavailable

The pane should link from generated prompt/runtime previews to the extension records that generated
them.

### Extensions Pane

The Extensions pane owns capability definitions.

Each extension detail view should include:

- title
- description
- full loaded instructions textarea
- minimal available instructions textarea
- optional editable Incur CLI source for non-native extensions
- TypeScript API enablement control
- dependency status
- env/secrets requirement status
- Build required indicator and explicit build control when editable extension files changed
- readonly generated command overview
- readonly generated TypeScript API overview
- readonly list of agent profiles using the extension and their usage state
- links back to the relevant Agent pane rows
- reset control for shipped extensions
- delete control only for user-created extensions

Agent-made extension edits should not be hidden. Successful `apply_patch` calls touching app-owned
extension files should render as rich tool-use UI showing the changed files, Build required state,
and one revert action for the whole patch. `svvy` must not automatically build after ordinary agent
file edits because an agent may edit several files in sequence; the agent should run the explicit
Extension Managing build command after the edit batch is complete. When a user clicks Revert on a
change card, `svvy` should restore that recorded change, emit a visible conversation event, and
automatically attempt one follow-up build if the revert leaves the extension build-required.

## Extension Loading

Extensions can enter a surface in three ways.

### Agent Profile Defaults

The persistent profile config decides default-loaded, available, and unavailable extension sets for
new turns.

### Direct `@extension` Mention

The user can mention an available extension directly.

When a prompt contains an explicit extension mention, `svvy` should load that extension before the
model call for that user message when the extension is available for that actor.

The model should then see the full loaded extension instructions and the updated generated runtime
surface for that turn.

If the extension is unavailable for that actor kind or profile, `svvy` must fail clearly and explain
that the agent configuration must be changed. It must not silently override unavailable capability.

### `request_extension`

`request_extension` is a native control tool.

It lets an actor request an extension that is available but not loaded.

The load is current-session only. It updates the calling session's durable extension binding and
does not change the agent profile's default-loaded, available, or unavailable states.

On success, it should:

- verify the extension is available for that actor
- use the latest successful build if it is valid
- build only if source changed or no active build exists
- block for dependency approval before any dependency install or build that requires it
- mount the extension in the actor-scoped `svvyx` surface
- update the TypeScript command surface for later `execute_typescript` calls in the same turn
- return the full instructions and generated usage summary

The session resolved that same-turn loading is desirable. After `request_extension` returns, later
shell/CLI or `execute_typescript` calls in the same turn should be able to use the newly loaded
extension.

Same-turn loading starts only after `request_extension` succeeds. If dependency approval, install,
build, secret setup, or validation blocks the load, the extension remains available-but-not-loaded
and contributes only its loading hint.

## Incur And `svvyx`

### Incur Role

Incur provides:

- typed CLI definition
- command schemas
- generated docs
- generated `Commands` types
- typed client use through `MemoryClient`

Incur does not itself give the model tools. The model can use an Incur command only through a
runtime path that `svvy` exposes, such as shell, a narrower CLI runner, or `execute_typescript`.

### Actor-Scoped Aggregate CLI

`svvy` should build one actor-scoped aggregate CLI for loaded extensions.

The command shape is:

```text
svvyx <extension-id> <command> ...
```

Rules:

- extension ids are stable and globally unique
- command names need only be unique inside an extension namespace
- `svvyx --help` shows only currently loaded extensions for the actor
- `svvyx --help` is not an available-extension catalog
- generated command docs include only currently loaded extensions
- generated `Commands` types include only currently loaded extensions
- available-but-not-loaded extensions contribute only minimal loading guidance
- unavailable extensions contribute nothing
- prompt/type/tool hashes derive from the resolved actor surface

The product should not build one global root CLI containing every extension, because that leaks
unavailable capabilities through `--help`, docs, and types.

The product should also avoid exposing every extension as an unrelated standalone global CLI,
because that makes discovery and typed composition messy.

### Extension Source To Runtime Flow

```text
extension source CLI per extension
        -> build
extension active build
        -> per actor/profile resolution
actor-scoped aggregate svvyx CLI
        -> shell usage and execute_typescript MemoryClient usage
```

Smithers hot reload is not the primary extension refresh mechanism. It reloads workflow build
functions for a running Smithers workflow so future workflow rendering or task attempts can pick up
workflow source changes. App-global extension source, dependency, generated-surface, and session
binding refresh are owned by `svvy`.

## `execute_typescript`

The session's desired direction replaces the current hand-built `api.*` surface.

`execute_typescript` remains a native direct tool, but inside the snippet the agent should receive:

- a preconfigured actor-scoped Incur `MemoryClient`
- generated `Commands` types for the currently loaded aggregate `svvyx` CLI
- minimal Incur client usage instructions
- no separate hand-built `api.*` object for normal extension commands

The exact injected names are not decided. The intended shape is:

- one provided client with `svvy` defaults already applied
- access to the actor-scoped command type surface
- access to relevant Incur client or command types when needed
- room for the agent to pass per-call options or create a different client over the same loaded CLI
  when the Incur API supports that cleanly

The TypeScript API is controlled per extension. If an extension has TypeScript API disabled, it can
still be callable through `svvyx` when loaded, but its generated `Commands` types and client helpers
are not included in code mode.

The session noted that Incur's generated command types are useful for both CLI documentation and
TypeScript client usage. Implementation must verify the exact Incur API shape from the local fork.

## Native Tool Classification

Remaining decisions here are `svvy` product choices. Codex reference facts are evidence, not an
instruction to clone Codex blindly.

The design goal is:

- stay conservative and close to Codex or other strong coding agents for basic coding tools
- be opinionated only where `svvy` adds product-specific improvements

### Codex Facts From Local Reference

- Codex core model-visible coding tooling appears to be shell/exec plus `apply_patch`, not a broad
  model-visible read/write/edit family.
- Codex has additional app filesystem RPCs, but those are not the same as core model-visible coding
  tools.
- Codex approval/review is broader than shell-only.
- Codex `ApprovalsReviewer` routes approval requests to `user`, `auto_review`, or
  `guardian_subagent`; `auto_review` is reviewer routing for approval requests, not a blanket
  statement that every tool call is reviewed.
- Codex Guardian review action types include `command`, `execve`, `applyPatch`, `networkAccess`,
  `mcpToolCall`, and `requestPermissions`.
- Codex `AskForApproval` supports several policies, including `untrusted`, `on-failure`,
  `on-request`, granular switches, and `never`.
- Shell commands go through exec policy first, which can skip approval, require approval, or forbid
  the command depending on policy, sandbox, rules, and risk.
- `strict_auto_review` exists in Codex as a stricter path that can route even skipped tool approval
  requirements through Guardian, which confirms blanket review is a separate stricter behavior from
  ordinary approval-boundary routing.

### Current Proposed Split

The resolved native direct tool set includes:

- shell or a shell-backed execution substrate
- `execute_typescript`
- `apply_patch`
- `request_extension`
- `list_extensions`
- product control tools such as `thread_start`, `thread_resume`, `thread_handoff`, `wait`,
  `runtime_current`, `thread_current`, `thread_list`, and `thread_handoffs`
- artifact tools, because artifacts are `svvy` product state

The latest session direction treats extension CLIs as actor-scoped `svvyx` commands available
through shell and through the Incur `MemoryClient` inside `execute_typescript`.

The latest session direction treats these as intended Incur-backed or extension-backed capabilities
unless later implementation research proves a better native route:

- cx
- Smithers controls

### Ordinary Filesystem Work

Read, search, and list operations should follow Codex's ordinary coding-agent model: use shell
commands such as `rg`, `rg --files`, `sed`, `cat`, `ls`, `find`, `git show`, `nl`, and `wc`.

General `read`, `grep`, `find`, `ls`, `edit`, and `write` are not part of the resolved native
model-visible tool set. If any are added later, they need a concrete product reason beyond ordinary
repo work.

The Filesystem extension instructions should be adapted from:

- `docs/references/codex/codex-rs/core/gpt_5_2_prompt.md`
- `docs/references/codex/codex-rs/core/gpt_5_codex_prompt.md`
- `docs/references/codex/codex-rs/core/src/tools/handlers/shell_spec.rs`

Relevant source-backed rules:

- prefer `rg` for text search and `rg --files` for filename search
- use ordinary shell tools for file inspection
- set the shell tool working directory instead of relying on `cd`
- parallelize independent reads, searches, and listings through separate tool calls where possible

`svvy` should not copy pi's native `read`, `grep`, `find`, and `ls` preference for this feature,
because this extension map intentionally follows Codex's shell-first model.

### Apply Patch Source And Policy

The `apply_patch` tool should copy or adapt Codex's freeform patch surface, grammar, parser, and
safety shape.

Reference sources:

- `docs/references/codex/codex-rs/apply-patch/apply_patch_tool_instructions.md`
- `docs/references/codex/codex-rs/core/src/tools/handlers/apply_patch.lark`
- `docs/references/codex/codex-rs/core/src/tools/handlers/apply_patch_spec.rs`
- `docs/references/codex/codex-rs/apply-patch/src/parser.rs`
- `docs/references/codex/codex-rs/apply-patch/src/lib.rs`
- `docs/references/codex/codex-rs/core/src/safety.rs`
- `docs/references/codex/codex-rs/protocol/src/permissions.rs`

Policy:

- direct when every touched source path and move destination is inside the active session workspace
  or another explicit writable root
- auto-reviewed when a patch would write outside the active session workspace or explicit writable
  roots
- rejected when the active policy forbids the required write escalation
- read-only carveouts such as VCS or app config metadata must be respected even when nested under an
  otherwise writable root

Even native runtime capabilities are represented as extensions for instructions, profile
composition, generated preview, and enablement. The distinction is runtime implementation, not
whether they appear in the Extensions model.

## Shell, CLI Access, And Security

Shell is the actual primitive that allows an agent to execute `svvyx` commands.

If an actor has general shell access, extension availability is not a complete security boundary.
An agent can still try to run programs or files outside the mounted `svvyx` surface.

Therefore:

- extension availability controls what `svvy` teaches, mounts, types, previews, and supports
- shell policy controls actual execution risk
- unavailable extensions must not be mounted in `svvyx`
- attempts to bypass `svvyx` should be evaluated by shell execution policy

Because general shell is available, extension availability should not be modeled as a perfect
sandbox. The practical boundary is:

- loaded extension commands are present in actor-scoped `svvyx`
- available extensions can be discovered and requested, but have no CLI presence
- unavailable extensions are omitted from prompt, docs, types, and `svvyx`
- arbitrary shell remains governed by the same Codex-like execution policy as other shell commands

## Execution Policy

The resolved policy direction is that `svvy` should use the same approval-boundary policy shape as
Codex, with auto-review as the only reviewer for actions that require approval.

### Codex Reference Facts

Local Codex reference audit found:

- Codex's core model-visible coding surface appears closer to shell/exec plus `apply_patch` than to
  a broad family of model-visible read/write/edit tools, even though the Codex app also has
  filesystem RPCs for app-server behavior.
- Codex separates "which actions require approval" from "who reviews the approval."
- Codex `ApprovalsReviewer` can be `user`, `auto_review`, or `guardian_subagent`. Its generated
  documentation says `auto_review` routes approval requests to a carefully prompted subagent that
  gathers context and applies a risk-based decision framework.
- Codex `AskForApproval` has multiple policies: `untrusted`, `on-failure`, `on-request`,
  granular approval switches, and `never`.
- Codex Guardian review action types include command, execve, applyPatch, networkAccess,
  mcpToolCall, and requestPermissions.
- Codex exec policy can skip approval for allowed or known-safe commands depending on policy and
  sandbox state, prompt for risky/boundary-crossing commands, or forbid commands when prompting is
  disabled.
- Codex has a stricter auto-review path that can route skipped tool approvals through Guardian, but
  that is distinct from ordinary Codex approval-boundary behavior.

Useful local reference files:

- `docs/references/codex/codex-rs/app-server-protocol/schema/typescript/v2/ApprovalsReviewer.ts`
- `docs/references/codex/codex-rs/app-server-protocol/schema/typescript/v2/AskForApproval.ts`
- `docs/references/codex/codex-rs/app-server-protocol/schema/typescript/v2/GuardianApprovalReviewAction.ts`
- `docs/references/codex/codex-rs/core/src/guardian/review.rs`
- `docs/references/codex/codex-rs/core/src/exec_policy.rs`
- `docs/references/codex/codex-rs/core/src/tools/handlers/shell.rs`
- `docs/references/codex/codex-rs/core/src/tools/orchestrator.rs`
- `docs/references/codex/codex-rs/core/src/apply_patch.rs`
- `docs/references/codex/codex-rs/protocol/src/protocol.rs`
- `docs/references/codex/codex-rs/protocol/src/config_types.rs`
- `docs/references/codex/codex-rs/core/src/safety.rs`

Therefore, Codex parity does not mean "every shell command is auto-reviewed." It means an approval
policy decides when an action crosses a review boundary, and `auto_review` can be the reviewer for
those approval requests.

`svvy` should follow that shape instead of inventing a blanket "review every shell command" policy.

The `svvy` implementation should model direct-tool execution around Codex's
`ExecApprovalRequirement` shape:

- `Skip`
- `NeedsApproval`
- `Forbidden`

Approval state must stay scoped to the owning actor surface or workflow task attempt. Handler
thread approval state must not leak into the orchestrator, and workflow task approval state must not
leak outside the Smithers attempt that owns it.

### Product-State Mutations With Revert

Actions that alter Extension Managing state but are not shell commands should execute directly
through the intended product tool, then show high-quality UI for understanding and reverting the
change when the change has an exact inverse.

Examples:

- changing extension instructions, source, or manifest files through `apply_patch`
- changing extension usage through `svvyx extensions set-usage`
- resetting a builtin extension through `svvyx extensions reset`
- deleting a user extension through `svvyx extensions delete`

Instead of stopping for user approval like many agent apps, `svvy` should visualize the tool use and
offer simple revert for those exact changes.

The revert contract is intentionally narrow:

- file edits, including instruction edits, source edits, and manifest metadata edits, are reverted per
  recorded `apply_patch` change; there is no separate custom edit/write surface
- `set-usage`, `reset`, and `delete` are command-level revertable
- `create` is not shown as revertable; the UI can show Delete for the created user extension
- build activation is not a user-facing rollback surface; active build metadata is internal only
- runtime calls resolve the current active build at execution time, but already emitted tool calls
  finish against the tool set that produced them
- app-managed extension trash exists only so a delete change can be reverted from its change card or
  history
- dependency installs, secret entry/update/removal, external shell side effects, and ordinary repo
  file edits are not reverted by Extension Managing
- `svvy` should use app-owned change records and patch/preimage data for extension revert, not git

### Action Classes

The policy should classify actions as:

- directly done
- auto-reviewed
- directly done with convenient revert
- blocked pending explicit user confirmation

Dependency installation remains in the explicit-confirmation class, because package installs can
download and execute third-party code.

Working assignment:

| Operation | Policy class |
| --- | --- |
| General shell command | Codex-like approval-boundary policy; auto-review is the reviewer when approval is required. |
| `svvyx ...` invoked through general shell | Inherits shell policy. |
| `apply_patch` | Direct inside the session workspace; auto-reviewed when it would write outside the session workspace; rejected when outside policy. |
| `request_extension` | Direct native control when the extension is available; clear failure when unavailable. |
| Extension file edits through `apply_patch` | Directly done with rich visualization, Build required indicator, and per-change revert; no auto-build after ordinary agent edits. |
| User/product-triggered source or config changes | May immediately request a build; dependency approval is still checked only at install time. |
| Extension usage/reset/delete through Extension Managing | Directly done with rich visualization and command-level revert. |
| Extension creation | Directly done with rich visualization and a Delete action, not a revert action. |
| Extension revert | Directly done with one automatic follow-up build when the revert leaves the extension build-required; UI button reverts also emit a visible conversation event. |
| Dependency install with unapproved exact dependency identities | Blocked pending explicit user confirmation. |
| Secret entry or update | User-only UI action; never agent-readable. |

## Dependency Lifecycle

Extensions live in the app-global extension project. Workspace-root extension storage is not adopted
for v1.

The app maintains one package project and lockfile for extension builds under
`~/.config/svvy/extensions/package/`.

Rules:

- dependency versions must be exact
- if a dependency spec is not exact, `svvy` may resolve the latest exact version but must ask the
  user before writing, installing, or building with it
- dependency approval is checked at install time, not when files are edited
- approval is keyed by exact dependency identity: package name, exact version, package manager or
  resolved source, and integrity or resolution metadata when available
- already-approved exact dependency identities do not require repeated approval
- new package versions, changed package sources, or changed integrity/resolution metadata require
  approval before install proceeds
- dependency install proceeds without prompting only when every dependency identity that would be
  installed has already been approved
- the UI must show unapproved added or changed dependency identities before confirmation
- the confirmation must explain that install may run package lifecycle scripts unless those scripts
  are disabled by the implementation
- `svvy` tracks `package.json` hash, lockfile hash, and dependency graph diff
- if the lockfile or dependency list changes outside `svvy`, the app validates the dependency diff
  against the approval ledger and asks only for unapproved dependency identities before using it
- failed install or build leaves the previous active extension build untouched
- manual handling is allowed by opening the relevant package file in the external editor

All source/config mutations feed the same build pipeline:

```text
files changed
  -> build required
  -> validate source, manifest, package metadata, and lockfile
  -> maybe install
  -> maybe ask approval for unapproved dependency identities
  -> build
  -> atomically activate only after success
```

The origin of the file change is irrelevant to dependency approval. Direct user edits, agent
`apply_patch`, Extension Managing commands, and snapshot restore all use the same build/install
approval rules. The only difference is scheduling: ordinary agent patch batches do not automatically
request build, while user/product actions may request build immediately.

The package and lockfile are durable dependency truth. They are not disposable generated artifacts.
`node_modules`, compiled extension builds, aggregate generated outputs, and runtime caches are
rebuildable artifacts and are not snapshot payload.

The same dependency problem will later apply to TypeScript workflows. The session explicitly noted
that the workflow design should borrow the extension dependency policy when workflow dependency
management is discussed.

## Secrets And Environment Variables

The session resolved that `svvy` should manage extension secrets explicitly rather than leaving them
to chat or plain files.

Extensions declare env requirements:

- name
- required or optional
- secret or non-secret
- description
- allowed source, such as app secret store, workspace env, or inherited process env

The user enters secret values through `svvy` UI.

Secret lifecycle:

1. Extension declares required and optional env vars.
2. Extensions pane shows missing and configured values without revealing secret contents.
3. User enters secret values in app UI.
4. `svvy` stores secrets encrypted through the app secret store or OS keychain.
5. When `svvyx` or the `execute_typescript` MemoryClient runs, `svvy` injects the required env vars
   programmatically.
6. Secret values never appear in prompts, generated docs, tool output, logs, artifacts, transcripts,
   or agent-readable files.
7. Known secret values are redacted from command output if they leak.
8. Missing secrets return structured errors such as "`GITHUB_TOKEN` is missing", not requests to
   paste tokens into chat.

User-named extension snapshots may include secret material only if it remains fully encrypted or
keychain-backed and never becomes agent-readable. Snapshot export or cross-machine restore needs a
separate security decision before secret material can leave the local app trust boundary.

## Extension Snapshots

The Extensions surface keeps the useful preset behavior from the previous Context pane: users can
save and load named snapshots of extension source and settings.

Snapshot payload includes:

- user extension source files and manifests
- builtin overlay files
- extension registry/config/settings
- agent/profile extension usage states
- package and lockfile state needed to reproduce exact dependencies
- encrypted local secret material or non-agent-readable secret references, subject to the secrets
  rules above

Snapshot payload excludes:

- `node_modules`
- compiled extension build outputs
- generated extension docs, schemas, and TypeScript declarations
- generated aggregate surfaces
- runtime build caches

Loading a snapshot is a user-first product action. It restores the snapshot's source/config/package
state, then immediately requests build for affected extensions. The build path uses the normal
validate/install/approval/build/activate pipeline. If dependency approval is needed, loading pauses at
that approval point; the previous active builds remain usable until the new builds succeed.

Snapshot restore does not get special dependency rules. It changes files and package state, then the
normal install boundary checks the approved dependency ledger. If a snapshot removes an extension
that an existing session had loaded or available, that session drops the missing extension just as it
would after extension deletion and then refreshes its binding.

The key product improvement is that agents can use configured secrets without being able to read
them. `svvy` also knows exactly which values to redact because they were entered through the app.

## Built-In Extension Set

This is the resolved built-in extension map from the discussion so far. "Built-in" here means
shipped by `svvy`, non-deletable, resettable, and configurable per agent usage state.

| Extension | Runtime kind | Included tools or surface | Orchestrator | Handler | Workflow agent |
| --- | --- | --- | --- | --- | --- |
| Filesystem | Native | `shell`, `apply_patch`, shell/filesystem instructions, `svvyx` access through shell | default loaded | default loaded | default loaded |
| Code Mode | Native | `execute_typescript` with actor-scoped Incur `MemoryClient` over loaded extensions | default loaded | default loaded | default loaded |
| Extension Loading | Native | `list_extensions`, `request_extension` | default loaded | default loaded | default loaded |
| Extension Managing | Incur-backed shipped extension with native app bridge where needed | `svvyx extensions ...` lifecycle commands for inspect, create, build, usage state, reset, delete, and revert; content edits use returned file paths plus native `apply_patch` | available | available | unavailable |
| cx | Incur-backed or extension-backed shipped extension | codebase/product navigation and cx controls | available | available | available |
| Smithers | Incur-backed shipped extension | workflow run/list/inspect/resume/signal/transcript controls | unavailable | default loaded | unavailable |
| Web | Native/provider-backed or extension-backed shipped extension | web/search/fetch/browser-like research capability | default loaded | default loaded | default loaded |
| Git | Prompt-only shipped extension | Git shell guidance; no wrapper CLI by default | default loaded | default loaded | default loaded |
| GitHub | Prompt-only shipped extension | GitHub/`gh` CLI guidance; no wrapper CLI by default | default loaded | default loaded | default loaded |
| Project CI | Empty todo extension for now | No tools or prompt content yet | unavailable | unavailable | unavailable |

The Git and GitHub extensions should not wrap `git` or `gh` by default. Agents can use the ordinary
shell and command help. The app should still check whether `git` and `gh` are available and show a
simple checkmark or error in the Extensions UI for transparency.

The Git and GitHub prompt-only instructions should adapt:

- Codex dirty-worktree and destructive-git safeguards from
  `docs/references/codex/codex-rs/core/gpt_5_codex_prompt.md` and
  `docs/references/codex/codex-rs/core/gpt_5_2_prompt.md`
- pi GitHub CLI usage patterns from `docs/references/pi-mono/AGENTS.md`
- pi PR/issue/wrap-up prompt patterns from `docs/references/pi-mono/.pi/prompts/`

These extensions should teach shell use of `git` and `gh`; they should not introduce a parallel
semantic `git.*` or `github.*` model tool surface by default.

Extension Managing combines the earlier separate "Extension Manager" and "Incur Extension
Authoring" ideas. There is no separate Incur Authoring extension unless this gets split again later.
Its detailed command surface is defined in `docs/specs/extension-managing.spec.md`.

Project CI is kept as a named placeholder only. It should stay unavailable for all actor kinds until
its value and surface are defined.

## Workflow Agent Extension Model

Workflow agents use the same extension system as orchestrators and handlers, but their defaults and
authoring surface have a separate workflow-agent path.

Resolved model:

- `svvy` has internal default extension settings used when creating a new workflow agent profile.
- A workflow agent profile appears in the Agents pane and can be customized like other agent
  profiles.
- Customization includes extension usage states.
- A handler can customize workflow agent profiles when it has the Extension Managing extension
  enabled.
- Each workflow agent profile that exists in the Agents pane exports a typed workflow-authoring
  component from a convenient generated import location.
- The exported component is rebuilt whenever the workflow agent profile settings change.
- TypeScript workflows import and use that component to run that configured workflow agent.
- When the component is used without extension overrides, it uses the workflow agent profile's
  configured extension settings.
- The component should accept an optional extension override prop so a workflow step can replace the
  workflow agent profile's configured extension settings for that invocation.
- The workflow authoring extension must document this component model and the extension override
  API.

The workflow-agent component extension override API is:

```ts
MyWorkflowAgent({
  prompt: "...",
  extensions: {
    filesystem: "default_loaded",
    codeMode: "default_loaded",
    github: "available",
    web: "unavailable",
  },
});
```

Rules:

- `extensions` is optional.
- When omitted, the component uses the workflow agent profile's configured extension settings.
- When provided, `extensions` replaces the workflow agent profile's extension settings entirely for
  that invocation.
- Object keys are generated, typed extension ids.
- Values are typed extension usage states: `default_loaded`, `available`, or `unavailable`.
- Any extension id omitted from the object is `unavailable` for that invocation.
- The generated type must prevent unknown extension ids and invalid usage states.

## Context Packs And Runtime Standards

The session direction is to remove standalone Context Packs as a product concept or absorb them into
extensions.

The old "Context" concept becomes part of agent composition:

- base instructions live on agent profiles
- actor-specific generated context is visible from Agents
- extension instructions and generated surfaces are visible from Extensions and linked from Agents
- available extensions provide minimal prompt hints instead of separate context-pack trigger prose

Runtime standards such as `AGENTS.md` and `CLAUDE.md` still need a visible generated-context story.
The session stated that the Agents pane should show a readonly list of generated material that made
it into the agent context, including generated runtime standards.

This conflicts with the current Context pane specs, where runtime standards are shown in Context.
The final implementation spec must reconcile where runtime standards are configured, previewed, and
scoped.

## Direct Mentions And Triggering

Direct `@extension` mention is adopted as explicit user intent.

Fuzzy trigger words were discussed early, but they should not mutate the user message with hidden
instructions. If trigger matching is ever added, it should produce structured metadata or a visible
suggestion, not hidden prose stuffed into the prompt.

Available extensions should include minimal instructions that explain when to load them. The model
may then call `request_extension` when useful.

## User And Agent App-Modification Tools

Agents may need to act on the app itself when the user asks to manage capabilities.

The app-modification surface should be an extension, not special ambient authority:

- extension inspection
- extension creation
- extension file discovery for edits through native `apply_patch`
- extension build
- extension revert
- agent profile extension selection

This capability must not be default-loaded into ordinary coding agents unless the user profile
explicitly chooses that. It should usually be available so the agent can request it when the user
asks to work on extensions or settings.

## Generated Surface Invariants

For every actor turn, `svvy` must be able to show exactly what the agent received.

The generated view should include:

- base instructions
- loaded extension full instructions
- available extension minimal instructions
- runtime standards that reached the actor
- mounted `svvyx` extension list
- generated command docs
- generated TypeScript command types
- native tool declarations
- unavailable extensions omitted entirely

The generated surface is actor-specific. There is no universal `SvvyApi`, universal command list, or
one-size-fits-all prompt.

## Open Research And Decisions

The following are unresolved from the session and should be settled before implementation:

- Review Codex app and CLI auto-review prompts and policy more deeply before adapting exact
  prompts, even though the local reference already shows approval-boundary semantics rather than
  blanket shell review.
- Define the exact local version of Codex-like approval-boundary semantics for shell.
- Define how far `svvy` should extend auto-review beyond shell for MCP or extension bridge calls,
  network access, hooks, and permission-like flows.
- Decide whether general shell is exposed to every actor kind or only to actor kinds/profiles that
  explicitly select it.
- Decide which non-shell native tools participate in auto-review versus rich revert-only UI or
  hybrid policy.
- Define what information the auto-reviewer receives: actor kind, agent profile, loaded extensions,
  available extension names and summaries for policy context, unavailable extension ids if needed
  for bypass detection, current loaded `svvyx` surface, cwd, command/action JSON, relevant
  read-only filesystem state, and recent conversation state.
- Decide retention and pruning for generated build artifacts after active build changes. Extension
  change/revert history itself is retained indefinitely for now and is not implemented with git.
- Decide where runtime standards are configured after the Context pane is removed or absorbed.
- Define the first real version of Project CI as an extension. It is currently a placeholder with no
  actor availability.
- Decide the exact generated TypeScript contract once the local Incur fork API is verified.
- Decide the exact customization boundary for shipped extensions across title, description,
  instructions, source, generated schemas, and runtime code.
- Decide how dependency lifecycle scripts are disabled, sandboxed, or clearly warned about during
  dependency confirmation.
- Define exact naming and collision rules for extension ids and subcommand namespaces.
- Define the exact generated prompt/tool/type hash model for stale surface detection.

## Product Docs That Must Change If Adopted

Adopting this spec materially changes current source-of-truth docs.

Required updates include:

- `docs/prd.md`: replace Context Library and hand-built direct-tool framing with Agents plus
  Extensions where appropriate.
- `docs/features.ts`: add or revise feature inventory entries for Extensions, actor-scoped `svvyx`,
  extension-managed `execute_typescript`, extension secrets, and auto-review execution policy.
- `docs/progress.md`: add POC and implementation roadmap items before production work.
- `docs/specs/prompt-library.spec.md`: either retire, split, or rewrite around Agents and
  Extensions.
- `docs/specs/ambient-agent-resources-baseline.spec.md`: reconcile ambient-resource default-off
  policy with explicit extension installation and enablement.
- `docs/specs/execute-typescript.spec.md`: replace hand-built `api.*` with the Incur
  `MemoryClient` direction if adopted.
- `docs/specs/project-ci.spec.md`: clarify Project CI as an extension/domain layer over Smithers.
- `docs/specs/workflow-library.spec.md`: later reuse the extension dependency policy for workflow
  TypeScript dependencies.
