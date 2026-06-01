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
- An `iron-proxy`-style egress boundary and credential proxy is deferred. It remains a possible
  hardening improvement for secret-bearing network tools, but v1 assumes editable extension code is
  trusted not to intentionally log or exfiltrate configured secret values.

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

`list_extensions` also reports env requirement readiness for loaded and available extensions, using
the same redacted status model as Extension Managing. It may show an env declaration's name,
required flag, secret flag, short description, and status. It must never show the value, a preview,
a hash, a keychain/account id, a storage path, a set/update timestamp, or any other value-correlating
metadata.

Example:

```json
{
  "loaded": [
    {
      "id": "linear",
      "title": "Linear",
      "runtimeKind": "incur_cli",
      "summary": "Linear issue and project workflow support.",
      "env": [
        {
          "name": "LINEAR_API_KEY",
          "required": true,
          "secret": true,
          "description": "Linear API key used by Linear commands.",
          "status": "configured"
        },
        {
          "name": "LINEAR_API_BASE_URL",
          "required": false,
          "secret": false,
          "description": "Linear API base URL.",
          "status": "defaulted"
        }
      ],
      "runtimeReady": true
    }
  ],
  "available": [
    {
      "id": "github",
      "title": "GitHub",
      "minimalInstructions": "Load this when the user asks for GitHub-specific workflow guidance.",
      "env": [],
      "runtimeReady": true
    }
  ]
}
```

### Shipped Extension

A shipped extension is provided by `svvy` by default.

Shipped extensions are:

- enabled by default where appropriate
- non-deletable
- resettable to shipped state
- configurable per agent as default-loaded, available, or unavailable when the actor kind allows it
- allowed to have editable title, description, instructions, and Incur source overlays when those
  files exist

This supersedes the earlier "locked built-ins are non-editable" phrasing in the session. The latest
resolution is: shipped built-ins are non-deletable and resettable, but their title, description,
instructions, editable Incur source, and agent-level enablement can be customized through overlay
files. Generated schemas, native runtime implementation, and app-owned bridge code remain read-only.

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

### Extension Current Build

Extension source edits create draft state.

A successful build atomically replaces the extension's current build. The current build contains:

- manifest
- full and minimal instructions
- CLI entrypoint or native runtime binding metadata
- generated command docs
- generated command schemas
- generated TypeScript command types when enabled
- dependency graph metadata
- env requirements
- content hashes

Env requirements in build output are declaration metadata and readiness status only. Current build
artifacts, generated docs, generated schemas, generated TypeScript declarations, aggregate cache
blobs, and agent-facing build output must not contain env values, secret values, secret hashes,
secret previews, secret storage identifiers, or value timestamps. Content hashes are internal
activation/cache state and must not be used as secret fingerprints or displayed as env status.

Builds write into `builds/extensions/<id>/staging/<build-run-id>/` while they are running. After a
build validates successfully, `svvy` atomically replaces `builds/extensions/<id>/current/` with that
staged output. Failed, cancelled, or dependency-blocked builds do not replace `current/`; their
staging output is discarded unless retained only long enough to surface diagnostics for that build
attempt.

There is no preserved build history, no user-facing build id, no build rollback command, and no
build-retention or pruning policy. `svvy` keeps only the current build plus any temporary staging
build currently in progress. Product UI should show practical state such as `Ready`, `Build
required`, `Needs dependency approval`, `Build failed`, and `Last built`.

A dependency-blocked build is blocked on exact dependency identities or exact trusted dependency
identities, not on package names alone. The existing current build and any already-mounted runtime
surface stay usable until the replacement build succeeds. Rejection or failed install leaves
`buildRequired: true` and does not mutate the current build.

### Extension Source Storage

Extensions are app-global in v1. Workspace-local extensions do not exist in v1.

This is an intentional `svvy` product boundary. pi supports global and project-local extension
discovery through paths such as `~/.pi/agent/extensions/` and `.pi/extensions/`, and Smithers has its
own project-local `.smithers/` workflow/runtime conventions. `svvy` v1 does not inherit those
storage locations for extension source, generated aggregate cache, dependency state, or build output.
pi and Smithers remain references for runtime behavior, not owners of `svvy` extension storage.

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
      manifest.json
      instructions/
        full.md
        minimal.md
      source/
    builtin-overlays/<extension-id>/
      manifest.json
      instructions/
        full.md
        minimal.md
      source/
  generated/
    extensions/<extension-id>/
      commands.md
      types.d.ts
      tool-schemas.json
    aggregates/
      index.sqlite
      blobs/<aggregate-cache-key>/
        manifest.json
        prompt.md
        command-docs.md
        commands.d.ts
        tool-schemas.json
  builds/
    extensions/<extension-id>/
      current/
      staging/<build-run-id>/
  package/
    package.json
    bun.lock
    node_modules/
  trash/<trash-id>/
  snapshots/<snapshot-id>/
```

Ownership:

- `sources/user/<id>/` contains editable user extension manifests, instructions, and source.
- `sources/builtin-overlays/<id>/` contains editable overlay files for shipped builtin extension
  title, description, instructions, and Incur source.
- `source/` exists only for extensions with editable executable source; prompt-only extensions omit
  it or return `source: null` from `inspect`.
- shipped builtin defaults live in packaged app resources and are read-only.
- `inspect` materializes builtin overlay files before returning editable paths, so normal shell
  inspection and `apply_patch` work even when the user has not edited that builtin before.
- `generated/extensions/<id>/` contains read-only generated command docs, TypeScript declarations,
  and tool schemas for that extension.
- `builds/extensions/<id>/current/` contains the current built runtime surface for that extension.
- `builds/extensions/<id>/staging/<build-run-id>/` is temporary output for a running build and is
  atomically promoted over `current/` only after success.
- `generated/aggregates/` contains a real disposable cache for actor/session aggregate surfaces.
- `package/` is the single app-global Bun project used for extension dependency installation and
  lockfile state.
- `package/package.json` is editable dependency request state.
- `package/bun.lock` is inspectable lock state and is not an editing target for agents.
- `trash/` stores deleted user extensions for Extension Managing revert.
- `snapshots/` stores local-only user-named extension snapshots; secret payloads or local keychain
  references are kept in non-agent-readable app secret storage, not as agent-inspectable files.

Generated files, build outputs, `package/bun.lock`, `node_modules`, trash, and snapshots are
separated from editable source. Agents may inspect those paths for traceability, but they are not
editing targets. Agents may edit extension source files, instruction files, manifest files, and the
shared extension `package/package.json` through the normal shell plus `apply_patch` path.

Generated schemas, native runtime implementation, and app-owned bridge code for shipped extensions
are read-only. A shipped builtin can still be customized by editing its overlay title, description,
instructions, and Incur source, and those overlay edits remain resettable to packaged defaults.

Aggregate surfaces use a lightweight cache rather than ad hoc directories:

- `generated/aggregates/index.sqlite` stores cache metadata.
- each index row stores at minimum `cacheKey`, `actorKind`, ordered `loadedExtensionIds`, ordered
  `availableExtensionIds`, `extensionSurfaceHashes`, `generatedSurfaceVersion`,
  `runtimeStandardsHash`, `createdAt`, `lastUsedAt`, and `sizeBytes`
- `generated/aggregates/blobs/<aggregate-cache-key>/` stores the generated prompt, command docs,
  TypeScript declarations, tool schemas, and a blob manifest.
- each blob manifest stores the same cache key inputs plus per-file hashes for `prompt.md`,
  `command-docs.md`, `commands.d.ts`, and `tool-schemas.json`
- the cache key is derived from the resolved actor-facing inputs: actor kind, loaded extension ids,
  available extension ids, each extension's current surface hash, generated-surface format version,
  and runtime standards hash when runtime standards are part of the actor prompt
- cache hits must verify the indexed blob exists and matches the blob manifest before use
- cache misses or corrupt blobs regenerate into a temporary directory and atomically promote into
  `blobs/<aggregate-cache-key>/`
- session bindings store only the aggregate cache key and can regenerate the aggregate when the cache
  entry is missing
- aggregate cache deletion is always safe and must never be treated as deleting product history
- aggregate pruning is based only on cache mechanics and must not encode product semantics; the v1
  default cache budget is 256 MiB total under `generated/aggregates/blobs/`, with entries unused for
  30 days eligible for eviction, and least-recently-used eviction applied when the byte budget is
  exceeded

### Surface Binding

Each session or workflow task-agent attempt stores a durable extension binding:

- actor kind
- selected agent profile or task-agent config identity
- loaded extension ids
- available extension ids
- current surface hashes used for those extensions
- aggregate cache key for generated prompt text, command docs, tool schemas, and TypeScript
  declarations

New sessions derive `loadedExtensions` and `availableExtensions` from the agent profile defaults or
from explicit creation-time overrides. `request_extension` mutates only the current session binding by
moving the requested extension from `availableExtensions` to `loadedExtensions`; it never mutates the
global agent profile.

The build unit is an extension. The aggregate generated surface is cached by actor kind, loaded
extension set, available extension set, current surface hashes, generated-surface format version, and
runtime standards hash. It is not built per visual surface. Two sessions with the same resolved
binding share the same aggregate cache entry. A session that loads an additional extension gets a
different binding and aggregate cache key.

When an extension changes and a successful build activates:

- the current mounted extension surface remains usable until the staging build is complete and
  atomically replaces `builds/extensions/<id>/current/`
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
- optional editable Incur CLI source for Incur-backed user extensions and Incur-backed builtin
  overlays
- TypeScript API enablement control
- dependency status
- env/secrets requirement status
- pending dependency approval status when install/build is blocked
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

If startup, refresh, snapshot load, or another app-level operation needs dependency approval before a
conversation owns the blocked build, the Extensions pane or shared app attention pane shows a
standalone blocking item. If an agent-visible command such as `svvyx extensions build <id> --json`
needs the same approval, the conversation shows a tool card for the same durable approval request.
Approving or rejecting the request from either projection updates every other projection.

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
- use the current successful build if it is valid
- build only if source changed or no current build exists
- block for dependency approval before any dependency or trusted dependency install that requires it
- mount the extension in the actor-scoped `svvyx` surface
- update the TypeScript command surface for later `execute_typescript` calls in the same turn
- return the full instructions and generated usage summary

The session resolved that same-turn loading is desirable. After `request_extension` returns, later
shell/CLI or `execute_typescript` calls in the same turn should be able to use the newly loaded
extension.

Same-turn loading starts only after `request_extension` succeeds. If dependency approval, install,
build, missing required env, or validation blocks the load, the extension remains
available-but-not-loaded and contributes only its loading hint. A dependency-blocked
`request_extension` creates or reuses the same durable approval request that an app-pane build would
use for the same unresolved dependency identities. If the `request_extension` tool call is still
pending on that approval, approval resumes the blocked install/build/load for that actor and returns
the normal successful `request_extension` result after the extension is mounted. If no actor-scoped
`request_extension` call is still pending, approval only records the dependency identities and
resumes or unblocks app-level build work; it must not mount the extension into any actor session. A
later actor that wants the extension must call `request_extension` again.

A missing required env value is not an approval request and cannot be resolved by the agent. The
native load result must name only the missing env declarations and direct the user to configure them
in the app UI:

```json
{
  "ok": false,
  "error": {
    "code": "EXTENSION_ENV_MISSING",
    "message": "Linear cannot be loaded because one required env value is missing.",
    "extensionId": "linear",
    "missingEnv": [
      {
        "name": "LINEAR_API_KEY",
        "required": true,
        "secret": true,
        "description": "Linear API key used by Linear commands."
      }
    ]
  }
}
```

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
extension current build
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
- editable extension source paths returned by `svvyx extensions inspect <id> --json` are explicit
  writable roots only under `~/.config/svvy/extensions/sources/user/<id>/` and
  `~/.config/svvy/extensions/sources/builtin-overlays/<id>/`
- the exact shared dependency request file returned as `packageJson` by
  `svvyx extensions inspect <id> --json` is an explicit writable file when an agent or user needs
  to add, remove, or change a direct dependency or trusted dependency request
- generated extension outputs, aggregate cache blobs, build `current/` and `staging/` directories,
  `package/bun.lock`, `package/node_modules/`, trash, snapshots, and packaged builtin defaults are
  not editable roots
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

Dependency install approval is a separate product-state approval class. It is keyed to exact
dependency identities and exact trusted dependency identities in the app-global extension package
project, so the same pending request may be referenced by an app pane and by one or more
conversation tool cards. Sharing that dependency approval record does not grant shell approval,
runtime tool approval, or actor capability outside the blocked dependency install/build operation.

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
- build activation is not a user-facing rollback surface; current build status and surface hashes are
  internal activation state
- runtime calls resolve the current build at execution time, but already emitted tool calls finish
  against the mounted tool set that produced them
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
| `apply_patch` | Direct inside the session workspace or allowed extension editing paths; auto-reviewed when it would write outside those roots; rejected when outside policy. |
| `request_extension` | Direct native control when the extension is available; clear failure when unavailable. |
| Extension file edits through `apply_patch` | Directly done with rich visualization, Build required indicator, and per-change revert; no auto-build after ordinary agent edits. |
| User/product-triggered source or config changes | May immediately request a build; dependency approval is still checked only at install time. |
| Extension usage/reset/delete through Extension Managing | Directly done with rich visualization and command-level revert. |
| Extension creation | Directly done with rich visualization and a Delete action, not a revert action. |
| Extension revert | Directly done with one automatic follow-up build when the revert leaves the extension build-required; UI button reverts also emit a visible conversation event. |
| Dependency install with unapproved exact dependency or trusted dependency identities | Blocked pending explicit user confirmation through a durable dependency approval request shared by relevant app-pane and conversation projections. |
| Secret entry, update, or removal | User-only UI action; never agent-readable and never agent-writable. |

## Dependency Lifecycle

Extensions live in the app-global extension project. Workspace-root extension storage is not adopted
for v1.

The app maintains one package project and lockfile for extension builds under
`~/.config/svvy/extensions/package/`.

Rules:

- dependency approval is checked at install time, not when files are edited
- approval is always keyed by exact dependency identity, never by package name alone
- an npm dependency identity is keyed by `kind: "dependency"`, package manager, source, package name,
  exact version, and integrity or resolution metadata when available
- a trusted lifecycle-script identity is keyed by `kind: "trusted_dependency"`, package manager,
  source, package name, exact version, and integrity or resolution metadata when available
- dependency specs must be exact before install or build can proceed
- non-exact specs such as ranges, tags, `latest`, `^12.4.0`, or `~12.4.0` fail validation with a
  clear error; `svvy` must not resolve them to latest, rewrite them automatically, install them, or
  build with them
- already-approved exact dependency identities do not require repeated approval
- already-approved exact trusted dependency identities do not require repeated approval
- new package versions, changed package sources, changed package manager identity, or changed
  integrity/resolution metadata require approval before install proceeds
- dependency install proceeds without prompting only when every dependency identity and trusted
  dependency identity that would be installed or trusted has already been approved
- the UI must show unapproved added or changed dependency identities and trusted dependency
  identities before confirmation
- extension installs must not rely on Bun's default trusted npm allowlist as product policy
- dependency lifecycle scripts are disabled unless the exact trusted dependency identity has been
  approved in `svvy`
- root package lifecycle scripts are not an extension build mechanism; extension builds are driven by
  `svvyx extensions build`, not by `package.json` lifecycle hooks
- non-npm dependency sources such as `file:`, `link:`, `git:`, and `github:` must resolve to a
  concrete source identity before install; lifecycle-script trust for those sources still requires
  explicit trusted dependency approval before scripts can run
- any change to `trustedDependencies` is dependency state and must be surfaced in the same dependency
  approval diff as added, removed, or changed trusted dependency identities
- Bun's `trustedDependencies` package field is name-based, but `svvy` approval is not; `svvy` must
  resolve each trusted package name to the exact trusted dependency identity before scripts can run
- `svvy` tracks `package.json` hash, lockfile hash, and dependency graph diff
- if the lockfile or dependency list changes outside `svvy`, the app validates the dependency diff
  against the approval ledger and asks only for unapproved dependency or trusted dependency identities
  before using it
- failed install or build leaves `builds/extensions/<id>/current/` and the current mounted extension
  surface untouched
- after any failed, interrupted, or externally modified install, the next startup, refresh, or build
  must validate `package.json`, `bun.lock`, installed artifacts, and the approval ledger before using
  that dependency state
- `package/package.json` is editable request state and may be changed by users or agents
- `package/bun.lock` is inspectable lock state and is not an editing target
- manual dependency handling is allowed by opening the relevant package file in the external editor
- approval covers the dependency identities the user is visibly installing or trusting; transitive
  dependency tree entries may be displayed for inspection but are not remembered as approvals unless
  they are also direct dependency or trusted dependency identities

Dependency availability checks without install:

- `inspect`, startup refresh, and extension refresh may read manifests, `package.json`, `bun.lock`,
  `node_modules`, build state, and the approval ledger
- these checks must not install packages, compile extension source, rewrite `package.json`, rewrite
  `bun.lock`, resolve `latest`, or make network requests only to improve a status label
- if status cannot be known without install or build, the status must be reported as a concrete
  blocked or unknown state with the reason
- missing installed artifacts are reported as `install: "missing"` and leave the current successful
  build, if any, untouched until the build/install pipeline succeeds

Dependency approval UX:

- app-level startup, refresh, snapshot load, or build work shows dependency approval as a standalone
  blocking item in the Extensions surface or shared app attention pane
- agent-visible build or load work shows the same approval as a tool card requiring approval in the
  owning conversation
- both placements reference one durable approval request when they are blocked on the same unresolved
  dependency identities
- approving a request records the listed dependency and trusted dependency identities in the approval
  ledger and updates every pane, conversation tool card, and blocked operation that references it
- approval resumes blocked app-level build work and any still-pending conversation tool card whose
  blocked operation is an install/build/load for the same approval request; it does not create a new
  actor binding or mount an extension into a session unless that still-pending actor-scoped load is
  the blocked operation being resumed
- rejecting a request marks that pending request rejected, updates every referencing pane and
  conversation tool card, leaves `buildRequired: true`, and leaves the current mounted surface
  unchanged
- rejection does not create a permanent deny rule; a later explicit build or refresh may create a new
  approval request if the same unapproved identities are still required
- unanswered approval requests remain pending and visible until approved, rejected, or made obsolete
  by later source/package changes that no longer require the same identities

All source/config mutations feed the same build pipeline:

```text
files changed
  -> build required
  -> validate source, manifest, package metadata, and lockfile
  -> maybe ask approval for unapproved dependency or trusted dependency identities
  -> maybe install
  -> build
  -> atomically activate only after success
```

The origin of the file change is irrelevant to dependency approval. Direct user edits, agent
`apply_patch`, Extension Managing commands, and snapshot restore all use the same build/install
approval rules. The only difference is scheduling: ordinary agent patch batches do not automatically
request build, while user/product actions may request build immediately.

The package and lockfile are durable dependency state. They are not disposable generated artifacts.
`node_modules`, temporary staging builds, generated extension outputs, aggregate cache blobs, and
runtime caches are rebuildable artifacts and are not snapshot payload. The current build under
`builds/extensions/<id>/current/` is also derived from source and package state; snapshots restore the
source/package state and then rebuild rather than storing compiled build output.

The same dependency problem will later apply to TypeScript workflows. The session explicitly noted
that the workflow design should borrow the extension dependency policy when workflow dependency
management is discussed.

## Secrets And Environment Variables

The resolved v1 model is intentionally simple:

- extensions are app-global
- env declarations are part of the app-global extension manifest/current build
- env values are app-global per extension
- each stored value is keyed by `(extensionId, envName)`
- there is no `workspaceId`, `valueScope`, `defaultScope`, `source`, source list, or inherited-env
  selection in v1
- agents can observe declaration metadata and readiness status only
- agents cannot read, write, update, delete, export, import, or snapshot raw secret values
- `svvy` may inject raw secret values into trusted extension runtime processes in v1
- raw secret injection is deliberately limited to the exact extension invocation that needs it

The v1 trust assumption is that editable extension code is trusted not to intentionally log,
exfiltrate, or transform configured secret values. A future egress proxy can remove that assumption,
but it is not a v1 requirement.

### Env Declaration Schema

Editable extension manifests declare env requirements under `env`.

Each item has exactly these fields in v1:

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `name` | yes | string | Environment variable name. Must be unique within this extension's manifest. |
| `required` | yes | boolean | Whether the extension's runtime is unusable until a value is available. |
| `secret` | yes | boolean | Whether the value is sensitive and must be encrypted, redacted, and hidden from agents. |
| `description` | yes | string | User-facing explanation of what the value is for. |
| `default` | no | string | Optional manifest default for non-secret env only. Forbidden when `secret: true`. |

No other env declaration fields are accepted in v1. In particular:

- no workspace-scoped env values
- no per-agent, per-profile, per-session, or per-actor env values
- no inherited shell environment selection
- no `.env` file source
- no source priority list
- no broad categories such as `source`, `sources`, `valueScopes`, or `defaultScope`
- no agent-editable secret value reference

Example:

```json
{
  "env": [
    {
      "name": "LINEAR_API_KEY",
      "required": true,
      "secret": true,
      "description": "Linear API key used by Linear commands."
    },
    {
      "name": "LINEAR_API_BASE_URL",
      "required": false,
      "secret": false,
      "description": "Linear API base URL.",
      "default": "https://api.linear.app"
    }
  ]
}
```

Validation rules:

- `name` must be a valid environment variable name for every supported runtime.
- duplicate names inside one extension are invalid.
- `default` is allowed only when `secret: false`.
- a required non-secret env without `default` must be configured by the user before runtime use.
- an optional env without value or default is omitted from runtime injection.
- a manifest may change env declarations; stale stored values whose `envName` is no longer declared
  remain app-managed secret state but are not injected, not shown to agents, and should be surfaced to
  the user in the Extensions pane as removable orphaned values.

### Value Storage

The value key is exactly:

```ts
type ExtensionEnvValueKey = {
  extensionId: string;
  envName: string;
};
```

This key is intentionally not just `envName`. Two extensions that declare `GITHUB_TOKEN` receive
separate values unless the user copies the same value into both extension settings. `svvy` must not
implicitly share, alias, deduplicate, or globally reuse secrets across extensions by name.

Secret values:

- are entered, updated, and removed only through app UI or another user-owned native settings flow
- are stored encrypted through the app-managed local secret store, OS keychain, or equivalent
  encrypted app storage
- are never stored in extension source files, generated files, build output, aggregate caches,
  snapshots readable by agents, prompt revisions, transcripts, tool results, artifacts, logs, or
  shell history
- are not exposed through `svvyx extensions ...`, `list_extensions`, generated prompt text, generated
  command docs, generated TypeScript declarations, generated schemas, `svvyx --help`, or
  `execute_typescript` declarations

Non-secret values:

- use the same `(extensionId, envName)` identity
- may have a manifest default
- may have an app-level user override
- may be displayed to the user in the Extensions pane
- should still be omitted from ordinary agent-facing status output unless the output explicitly needs
  non-secret configuration detail; the default agent-facing shape is status, not value

### Status Vocabulary

Agent-visible status uses this closed vocabulary:

| Status | Meaning |
| --- | --- |
| `configured` | A user-provided app value exists for this `(extensionId, envName)`. |
| `defaulted` | No user value exists, but the non-secret manifest declaration has a `default`. |
| `missing` | No value is available and the declaration is required. |
| `optional_missing` | No value is available and the declaration is optional. |

`configured` never implies that the agent can see, inspect, hash, compare, or copy the value.

Example status block:

```json
{
  "env": [
    {
      "name": "LINEAR_API_KEY",
      "required": true,
      "secret": true,
      "description": "Linear API key used by Linear commands.",
      "status": "configured"
    },
    {
      "name": "LINEAR_API_BASE_URL",
      "required": false,
      "secret": false,
      "description": "Linear API base URL.",
      "status": "defaulted"
    }
  ],
  "runtimeReady": true
}
```

Forbidden status fields include:

- `value`
- `preview`
- `maskedValue`
- `lastFour`
- `hash`
- `fingerprint`
- `keychainId`
- `storagePath`
- `createdAt`
- `updatedAt`
- `lastUsedAt`

The UI may keep richer local metadata for human account management, but agent-facing tools and
agent-readable generated files must not expose it.

### Runtime Injection

Runtime env injection is narrow and process-local.

When a loaded extension command runs through actor-scoped `svvyx`, `svvy` builds an env map for that
specific extension command process:

1. start from the safe base process env required for the command runner
2. add non-secret manifest defaults
3. overlay app-level non-secret user values for that extension
4. overlay app-managed secret values for that extension
5. run the command
6. discard the per-invocation env map

When `execute_typescript` uses the actor-scoped Incur `MemoryClient`, the same extension-specific
env map is supplied only to the invoked extension command. The broader `execute_typescript` snippet
environment, pi runtime process, actor shell environment, and other loaded extensions must not
receive that extension's secret values.

Runtime injection rules:

- raw secret values are never placed in the global pi process env
- raw secret values are never placed in the default shell env for an actor
- raw secret values are never placed in the default `execute_typescript` snippet env
- one extension's env values are never injected into another extension's command process
- available-but-not-loaded extensions receive no runtime env because they have no mounted runtime
  surface
- prompt-only extensions never receive runtime env
- already emitted tool calls finish with the env map for the mounted tool set that produced them
- if an env declaration changes after a session binding is created, the binding refresh must update
  runtime readiness before the next extension invocation

The safe base env may include ordinary process values required for execution, but it must not include
extension secrets from app storage. If the host process itself has unrelated secret values in its
environment, `svvy` should prefer a minimal allowlisted base env for extension commands so unrelated
host secrets are not inherited accidentally.

### Missing Values

Build does not require env values. A build validates env declarations and generated surfaces, but it
does not need to call the remote service or possess secrets.

Missing required env values block runtime use, not source compilation. Specifically:

- `svvyx extensions build <id> --json` may succeed while reporting `runtimeReady: false`.
- `list_extensions` and `svvyx extensions inspect <id> --json` report missing/configured status.
- `request_extension` fails with `EXTENSION_ENV_MISSING` when loading would mount an executable
  extension with missing required env.
- an already loaded extension command fails with `EXTENSION_ENV_MISSING` if a required value was
  removed after the actor binding was created.
- an optional missing value is omitted from the env map and must not block load or invocation.

Missing-secret errors must never ask the user to paste a token into chat. The message should tell the
user to configure the value in the Extensions pane or app settings.

Runtime failure example:

```json
{
  "ok": false,
  "error": {
    "code": "EXTENSION_ENV_MISSING",
    "message": "Linear requires LINEAR_API_KEY. Configure it in the Extensions pane.",
    "extensionId": "linear",
    "missingEnv": [
      {
        "name": "LINEAR_API_KEY",
        "required": true,
        "secret": true,
        "description": "Linear API key used by Linear commands."
      }
    ]
  }
}
```

### Redaction And Outputs

`svvy` knows the app-managed secret values and must redact them if they appear in any app-visible or
agent-visible output.

Redaction applies to:

- extension command stdout and stderr
- `svvyx` JSON output
- `execute_typescript` result text
- command facts
- app logs
- error details
- tool cards
- generated artifacts
- transcript text
- generated prompt previews
- generated command docs
- generated TypeScript declarations
- generated tool schemas
- snapshot inspection output

Redaction is a last-resort containment measure, not permission for extension code to print secrets.
The intended v1 behavior is still that trusted extension code does not intentionally reveal them.

Rules:

- exact known secret values are replaced before persistence or agent display.
- redaction replacement text is `[REDACTED:extension-env:<extensionId>:<envName>]`.
- if the same secret value is configured for multiple extension env keys, redaction may use the first
  matching key in deterministic extension id/name order; it must not reveal that multiple keys share
  the same value.
- redaction must run before writing command output to durable artifacts, logs, transcript rows, or
  command-fact records.
- output truncation must happen after redaction, not before, so a secret cannot survive because it
  crossed a chunk boundary.
- binary output that cannot be safely scanned is treated as untrusted; if produced by a
  secret-bearing extension command, it must be stored only when the product has a binary-safe
  redaction policy or else replaced with a clear redacted artifact placeholder.

### What Agents Can Never Read Or Do

Agents can never:

- read raw secret values
- request a reveal, preview, hash, fingerprint, or last-four display of a secret
- set, update, delete, import, export, or copy secret values through tools
- write secret values into extension source, manifest files, generated docs, prompt text, snapshots,
  artifacts, or chat as a supported flow
- choose the storage source for a secret
- choose a workspace, session, actor, profile, or inherited shell scope for a v1 extension env value
- ask `svvy` to inject one extension's env value into another extension
- receive extension secrets through pi runtime env, global shell env, `execute_typescript` snippet
  env, generated type declarations, generated schemas, or generated help text

Agents may:

- see that a declaration exists
- see whether it is required
- see whether it is secret
- see the declaration description
- see status from the closed vocabulary above
- tell the user that a required value is missing and must be configured in the app UI

### Snapshots

User-named extension snapshots are local-only in v1. They may preserve extension secret state only by
recording non-agent-readable app secret storage state outside the inspectable snapshot file tree.
Snapshot files, Extension Managing command output, generated files, artifacts, and transcript output
must not contain encrypted secret blobs, raw secret values, keychain item identifiers, or
value-correlating secret metadata.

Snapshot export, importing snapshots on another machine, portable passphrase-based secret restore,
and cross-machine secret decryption are unsupported in v1.

### Deferred Egress Proxy

Research confirmed that `iron-proxy` can provide default-deny egress and boundary credential
rewriting for untrusted workloads. That model is deferred in `docs/todo.md` and is not part of v1.

The v1 spec therefore does not include egress declarations, credential proxy modes, proxy tokens,
CA lifecycle, or network-policy enforcement for extension secrets.

## Extension Snapshots

The Extensions surface keeps the useful preset behavior from the previous Context pane: users can
save and load named snapshots of extension source and settings.

Snapshot payload includes:

- user extension source files and manifests
- builtin overlay files
- extension registry/config/settings
- agent/profile extension usage states
- package and lockfile state needed to reproduce exact dependency identities
- non-agent-readable links to app-managed local secret snapshot state, subject to the secrets rules
  above

Snapshot payload excludes:

- `node_modules`
- current and staging compiled extension build outputs
- generated extension docs, schemas, and TypeScript declarations
- generated aggregate cache blobs
- runtime build caches
- agent-readable encrypted secret blobs, raw secret values, keychain item identifiers, and
  value-correlating secret metadata

Loading a snapshot is a user-first product action. It restores the snapshot's source/config/package
state, then immediately requests build for affected extensions. The build path uses the normal
validate/install/approval/build/activate pipeline. If dependency approval is needed, loading pauses on
the shared durable dependency approval request for the exact dependency and trusted dependency
identities. Current mounted extension surfaces remain usable until the replacement builds succeed.
Approving the request records those identities and resumes the blocked install/build work. Rejecting
the request leaves affected extensions build-required and leaves current mounted extension surfaces
unchanged.

Snapshot restore does not get special dependency rules. It changes files and package state, then the
normal install boundary checks the approved dependency ledger. It must not resolve non-exact package
specs to latest or silently accept unapproved trusted dependency identities. If a snapshot removes an
extension that an existing session had loaded or available, that session drops the missing extension
just as it would after extension deletion and then refreshes its binding.

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
- Decide where runtime standards are configured after the Context pane is removed or absorbed.
- Define the first real version of Project CI as an extension. It is currently a placeholder with no
  actor availability.
- Decide the exact generated TypeScript contract once the local Incur fork API is verified.
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
