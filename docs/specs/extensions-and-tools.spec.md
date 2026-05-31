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

### Extension Built Revision

Extension source edits create draft state.

A successful build creates a new active built revision containing:

- manifest
- full and minimal instructions
- CLI entrypoint or native runtime binding metadata
- generated command docs
- generated command schemas
- generated TypeScript command types when enabled
- dependency graph metadata
- env requirements
- content hashes

Failed builds do not replace the previous active revision.

### Surface Binding

At turn start, an actor surface resolves its agent profile, actor kind, extension usage states, and
active extension revisions into one generated surface.

An active turn keeps using the surface that existed when that turn started. Extensions must not swap
under a running model turn.

The next turn uses the latest successful active extension revisions unless the product later adopts
old-revision pinning. The desired UX from the session is simple: use the latest successful build,
avoid noisy warnings, and only warn when the visible generated instructions, docs, tool schemas, or
types are stale relative to the surface that will be used.

If only internal implementation changed and the generated actor-facing surface did not, no stale
prompt warning is needed.

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
- build/reload controls when source changed
- readonly generated command overview
- readonly generated TypeScript API overview
- readonly list of agent profiles using the extension and their usage state
- links back to the relevant Agent pane rows
- reset control for shipped extensions
- delete control only for user-created extensions

Agent-made extension edits should not be hidden. They should render as rich tool-use UI showing the
files or fields changed, generated surface changes, build result, dependency changes, and a simple
revert action where possible.

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
extension built revision
        -> per actor/profile resolution
actor-scoped aggregate svvyx CLI
        -> shell usage and execute_typescript MemoryClient usage
```

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

Actions that alter app state but are not shell commands should usually execute directly through the
intended product tool, then show high-quality UI for understanding and reverting the change.

Examples:

- changing extension instructions
- changing extension enablement
- creating an extension
- editing app-owned configuration that is safe to revert

Instead of stopping for user approval like many agent apps, `svvy` should visualize the tool use and
offer simple revert where practical.

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
| Extension/profile edits through Extension Manager | Directly done with rich visualization and revert. |
| Dependency install or dependency-changing build | Blocked pending explicit user confirmation. |
| Secret entry or update | User-only UI action; never agent-readable. |
| Safe app-state edits | Directly done with convenient revert where practical. |

## Dependency Lifecycle

Extensions live in an app-global extension project by default.

The session also mentioned a root `.svvy` extension project while thinking through dependency
storage. The later preference was app-global because extensions are not inherently workspace
opinionated. Treat workspace-root extension storage as unresolved, not adopted.

The app should maintain package and lock metadata for extension builds.

Rules:

- dependency versions must be exact
- if a dependency spec is not exact, `svvy` may resolve the latest exact version but must ask the
  user before writing, installing, or building with it
- dependency install never happens without explicit user confirmation
- the UI must show added, removed, and changed dependencies before confirmation
- the confirmation must explain that install may run package lifecycle scripts unless those scripts
  are disabled by the implementation
- `svvy` tracks `package.json` hash, lockfile hash, and dependency graph diff
- if the lockfile or dependency list changes outside `svvy`, the app asks the user to validate the
  dependency state before using it
- failed install or build leaves the previous active extension build untouched
- manual handling is allowed by opening the relevant package file in the external editor

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
| Extension Managing | Incur-backed shipped extension with native app bridge where needed | inspect, create, edit, build, reset, and revert extensions and agent extension selections | available | available | unavailable |
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
- extension editing
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
- Decide exactly how old extension revisions are retained, if at all, beyond the previous active
  build needed for rollback after failed builds.
- Decide where runtime standards are configured after the Context pane is removed or absorbed.
- Decide whether workspace-scoped extensions exist.
- Decide whether user-authored and installed extensions are v1 behavior, or whether v1 is limited
  to first-party plus app-managed authoring.
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
