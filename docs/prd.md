# Product Requirements Document

## Title

Ship `svvy` as an Electrobun desktop coding app with a pi-backed runtime, a visible `svvy` orchestrator, pi-backed delegated handler threads, and Smithers-backed workflow execution.

## Status

- Date: 2026-04-22
- Status: target product PRD
- Scope: this document defines the intended shipped product

## Product Summary

`svvy` is a desktop coding agent for working inside real repositories with visible orchestration instead of one opaque chat loop.

The product combines:

- an Electrobun desktop shell
- a pi-backed interactive runtime and session substrate
- a `svvy` orchestrator that owns strategy, routing, and final decisions
- pi-backed delegated handler threads for bounded delegated objectives
- Smithers workflow authoring and execution through direct official Smithers CLI usage inside handler threads
- an app-global Workflows source library that generates reusable `@svvy/workflows` imports
- first-class threads, commands, episodes, artifacts, saved Workflows visibility, and worktree awareness
- live Codex-like tool projection for streamed tool arguments, command output, patch previews,
  approvals, waits, and final command facts
- first-class workspace app logs for structured, redacted, live product observability
- a VS Code-like shared palette shell where `>` switches quick-open search into command/action mode without creating a second runtime

The intended feel is closer to Slate than to stock pi:

- one strategic brain
- bounded delegated work instead of persistent role agents
- reusable structured outputs instead of transcript-only memory
- direct inspection of delegated work when needed without bloating the orchestrator by default
- safe pause and resume across interactive orchestrator and handler-thread surfaces

## Product Goals

The shipped product must let a user:

- open a local repository in a native desktop app and work in long-lived coding sessions
- keep important sessions visible through pinning, move archived sessions into a single collapsed archive without deleting their history, and expose a confirmed hard-delete action only from the session row context menu
- understand what the system is doing without reconstructing state from raw logs
- inspect structured app logs with unread counts, filters, virtualized long-scroll browsing, explicit Live/Frozen tail behavior, redacted details, normalized errors, and related product links when app behavior needs attention
- inspect durable outputs from each meaningful unit of work
- delegate bounded work while keeping top-level strategy and state visible
- talk directly inside delegated thread surfaces when that work needs clarification or follow-up
- queue follow-up user messages against a running orchestrator or handler-thread surface without creating a concurrent turn, losing the prompt, or retargeting it to another surface
- copy or edit any committed user message in an orchestrator or handler-thread transcript, see which committed message is currently being edited, receive a warning before replacing an existing composer draft, then send the revised text by moving the same pi surface back to that message's parent state and continuing normally from the edited message
- author Smithers workflows in workspace `.smithers/` packages
- save reusable agents, prompts, components, and workflows into the app-global Workflows source library and discover generated exports later
- use `Cmd+Shift+P` to open the shared palette with `>` prefilled for product actions, and `Cmd+P` to open the same palette as the reserved file quick-open entry point
- pause and resume safely when user input or an external prerequisite is required
- keep session context and worktree context aligned
- use the same execution model from both the desktop app and headless automation surfaces

## Product Principles

### 1. One Strategic Brain

The main orchestrator owns:

- request interpretation
- context loading
- deciding whether work can be answered locally or needs delegation
- spawning delegated handler threads
- reconciling final thread outcomes
- final user-facing decisions in the main orchestrator surface

No worker or handler thread becomes the source of truth for overall strategy.

### 2. One Execution Model

`svvy` does not have separate product execution engines for direct work, delegated work, and waiting.

It has one shared execution model:

```text
message -> target surface -> turn -> tool call -> command -> handler -> events -> structured state -> UI
```

The target surface may be:

- the main orchestrator surface
- a delegated handler thread surface

Everything the agent does is still driven through turns, tools, runtime handlers, and durable state.

Tool use must project live through the same execution model. When a model starts a tool call, the UI
should render the correct tool item immediately, update large arguments progressively while they are
being generated, stream runtime output or progress while the handler runs, and then settle the card
from the authoritative final command facts. `apply_patch` uses a Codex-like structured file-change
projection with patch snapshots; `exec_command` uses command output deltas; `execute_typescript`
uses source, diagnostic, runtime, and child-command projection. This is not achieved by asking the
agent to split coherent work into many tiny tool calls.

Before any target surface runs a turn through pi:

- `svvy` must compose that surface's actor prompt from the current generated agent context and load the resulting instructions through pi's real `systemPrompt` channel
- `svvy` must ignore pi prompt replacement and append files such as `.pi/SYSTEM.md` and `APPEND_SYSTEM.md`, while preserving discovered `AGENTS.md` and `CLAUDE.md` files as read-only `external_instruction` extension records in the actual prompt path
- the submitted prompt body is the real new user message for that surface; `svvy` does not repair or advance a surface by flattening prior messages into role-labelled transcript prose
- committed conversation history stays in pi's session history, while runtime, thread, episode, report-request, and workflow state stays in structured state and targeted tools
- the UI should project the active system prompt as expandable surface metadata rather than as inline transcript prose, and should warn when a surface is bound to an older prompt revision than current settings
- each surface must receive only the generated tool declarations and SDK blocks present in that surface's resolved extension binding and native runtime surface
- each surface may receive compact knowledge about what another surface commonly does, but it must not receive that other surface's full callable API block just for awareness
- handler threads may start with a product-filtered inherited-history section from the orchestrator
  when `thread_start.threads[].history` is `forked`. That inherited-history section is delivered as
  a product-authored context block inside the handler's first prompt-bearing start item for
  reproducibility. It is not reconstructed as separate prior handler turns, not written into the
  handler system prompt, and not shared pi transcript state. It does not create shared tools or
  continuing access to orchestrator-only callable surfaces.

Ambient coding-agent resources are default-off unless explicitly enabled through `svvy` settings. This applies to pi resources such as extensions, skills, prompt templates, themes, packages, slash commands, hooks, provider adapters, credentials, and execution-policy settings, and to equivalent resources exposed by other coding-agent hosts. This default-off rule applies to imported or host-ambient resources, not to app-owned builtin extensions whose default usage is explicitly defined in product specs and profile settings. The current builtin prompt-only defaults are cx and Git default-loaded for all adopted agent kinds, Web default-loaded for all adopted agent kinds only while `networkAccess` is enabled, GitHub default-loaded for orchestrators and handler threads while available for workflow task agents, and Smithers default-loaded for handler threads as prompt-only official CLI guidance. The builtin Workflows extension is default-loaded for handler threads as the app-owned `svvyx workflows ...` source-library command family. `svvy` preserves plain external instruction files such as discovered `AGENTS.md` and `CLAUDE.md` as visible generated agent context through read-only extension records, but behavior-changing ambient resources must be enabled by category, source, host, workspace, and target agent/profile configuration before they can affect prompts, tools, commands, UI, provider behavior, auth, or execution policy. Enabled callable resources must still appear in the resolved generated API block for the exact actor session or task attempt that may call them.

Extension env values are app-managed per extension in v1. Secret values are keyed by `(extensionId, envName)`, entered only through user-owned app UI, stored encrypted by the app or OS keychain, injected only into the specific trusted extension runtime invocation that needs them, and never exposed to agents through prompts, generated docs, tool output, logs, artifacts, transcripts, global pi env, global shell env, or `execute_typescript` snippet env. Agent-facing extension inspection may report only declaration metadata and missing/configured readiness. Workspace-scoped extension env values and egress-proxy credential boundaries are not part of v1.

Agents and Extensions are the user-facing source of reusable prompt material and capability composition. Agent profiles contain actor kind, model/reasoning, sparse extension usage overrides for values that differ from the resolved actor/profile defaults, and an optional per-profile extension instruction order. Each Agents-pane extension usage row links to the matching record in the Extensions inventory. Expanded orchestrator, handler, and workflow task-agent profile rows show one extension list with name, description, usage controls, extension link, expandable generated instruction text, Off rows moved to the end, active rows draggable into the order their instructions enter the generated actor context, and actor-level reset controls for default extension selection and default instruction order. Workflow-agent rows use the same compact profile bar affordances as orchestrator rows for model/reasoning, extension usage, duplication, deletion, and creation, while keeping their individual instruction textarea and adding a link to the underlying `.agent.json` source file. The default Explorer, Implementer, and Reviewer workflow agents are builtin defaults that may be edited and duplicated but not deleted. Base actor prompts are builtin instruction-only extensions: `base-common` is default-loaded for all adopted actor kinds, while `base-orchestrator`, `base-handler`, and `base-workflow-task` are default-loaded by the corresponding default agent profile. Extensions contain builtin, user, and external_instruction records with ordered full loaded instruction source files, per-file skip config for selected instruction files that should remain visible but not load, minimal loading hints, generated previews, and category-specific reset/delete behavior. The ordered full instruction files are an editing convenience; generated actor contexts receive one concatenated loaded instruction block per loaded extension from that extension's non-skipped full instruction files, including loaded base instruction extensions. External instruction records show discovered files such as `AGENTS.md` and `CLAUDE.md` as read-only generated-context inputs with open-external-file controls. New orchestrator sessions, handler threads, and workflow task agents bind to the latest ready generated agent context. Existing surfaces store the generated agent context fingerprint they received and automatically update to the latest ready generated agent context at the next safe boundary when that fingerprint changes.

The default actor-specific generated context split is:

- the orchestrator prompt knows that workflow action normally belongs in a delegated handler thread; Smithers and Workflows are available to orchestrators but not default-loaded in the default orchestrator profile
- a handler-thread prompt receives prompt-only Smithers CLI guidance, the Workflows `svvyx` command family, `load_extension`, `list_extensions`, `request_user_input`, `thread_current`, `thread_group`, `thread_report`, `thread_episodes`, direct tools, and `execute_typescript` for typed composition by default; `thread_start` is not part of the default adopted handler model
- the orchestrator prompt receives `request_user_input`, `thread_start`, `thread_followup`,
  `thread_list`, `thread_episodes`, and `thread_request_report` so user clarification,
  delegated-thread state, durable thread groups, durable episodes, handler follow-ups, handler
  reactivation, and handler status requests are handled through focused tools instead of prompt
  stuffing
- a workflow-task-agent prompt receives task-local instructions and task-local callable declarations; in the default adopted workflow-agent profile it receives Extension Loading, task-local direct tools, and `execute_typescript`, while Smithers, Workflows, Extension Managing, and broad handler/orchestrator controls are not default-loaded
- a workflow-task-agent runtime must not load ambient pi built-in tools, extensions, skills, prompt templates, themes, commands, hooks, provider adapters, or equivalent host resources unless the user enables that exact resource category and source for workflow task agents
- user-configured extension usage overrides remain the source of truth for loaded, available, and unavailable extensions; setting an extension back to the resolved actor/profile default removes the stored override, and Extension Loading is the only fixed always-loaded extension control
- Smithers execution is not exposed through native `svvy` workflow wrappers. Agents run official Smithers CLI commands through Shell, and those shell commands project as normal command-family `exec_command` work.

### 3. Handler Threads Are The Delegation Unit

The orchestrator does not delegate directly to raw Smithers runs.

It delegates to a pi-backed handler thread.

A handler thread is:

- a normal interactive conversation surface
- backed by its own pi session/runtime state
- responsible for one delegated objective
- allowed to receive direct user messages just like the main orchestrator surface
- responsible for supervising the entire workflow lifecycle for that objective

The orchestrator usually talks to the user about:

- why a handler thread was created
- what objective it owns
- the final outcome returned by that thread

The detailed clarification and repair loop for that delegated objective normally happens inside the handler thread itself.

### 4. Smithers Workflows Use Smithers Directly

Smithers is the workflow runtime and authoring model.

`svvy` does not hide Smithers behind a product-specific workflow-control abstraction. Agents that need to initialize, author, run, resume, inspect, approve, or debug Smithers workflows use the official Smithers CLI through the normal Shell extension.

The repo-root `workflows/` package is not the shipped product workflow runtime.

It is an authoring workspace used to build and maintain `svvy` itself. Shipped product behavior must work without a source checkout and must not depend on repo-local authoring assets such as `workflows/node_modules/.bin/smithers`, `workflows/smithers.db`, or source-relative paths under repo-root `workflows/`.

Workspace-local Smithers authoring lives in:

```text
<workspace>/.smithers/
```

This is the only workspace workflow source location.

The handler thread remains the normal delegated surface for workflow work because it owns the delegated objective and can use Shell, Apply Patch, Smithers prompt guidance, and the Workflows extension together.

### 5. Reusable Workflows Are App-Global Source Plus Generated Imports

Reusable workflow material is app-global, not workspace-local.

Editable reusable source lives under:

```text
~/.config/svvy/workflows/
  agents/
  prompts/
  components/
  workflows/
  generated/
```

The editable source directories are:

- `agents/` for structured `.agent.json` task-agent parameter records
- `prompts/` for direct MDX prompt assets
- `components/` for direct TypeScript or TSX Smithers components and helpers
- `workflows/` for direct TSX reusable workflow modules

`generated/` is build output outside the safe writable boundary. Agents and auto-review must treat direct edits to generated Workflows output as invalid. The correct edit path is to change source and rebuild, or to use `svvyx workflows save`.

`svvyx workflows build` produces a generated Bun/TypeScript package:

```text
~/.config/svvy/workflows/generated/package/
```

The generated package name is `@svvy/workflows`. The root public API exports only:

```ts
import { Agents, Components, Prompts, Workflows } from "@svvy/workflows";
```

Reusable values are accessed through those namespaces, for example `Agents.defaultAgent`, `Components.SomeComponent`, `Prompts.somePrompt`, and `Workflows.someWorkflow`. `Agents.defineTaskAgent` and type `Agents.TaskAgentParameters` also live under `Agents.*` so agent usage stays uniform.

When the app opens or prepares a workspace with `.smithers/`, it idempotently links the generated package into:

```text
<workspace>/.smithers/node_modules/@svvy/workflows
```

This link is internal package-resolution plumbing, not a user-facing command and not an editable workspace copy. The app must not rely on ambient global package resolution, `NODE_PATH`, parent repository `node_modules`, or a source-checkout-relative package path.

The Workflows extension is the only app-owned command surface for this source library:

```bash
svvyx workflows list [--kind agent|prompt|component|workflow] --json
svvyx workflows save --from <path> --kind agent|prompt|component|workflow [--export <name>] --as <exportName> [--overwrite] --json
svvyx workflows build --json
svvyx workflows models list --json
```

It is not a Smithers runner. There is no `install`, `retrieve`, `promote`, kind-specific list subcommand, or product workflow wrapper command.

`svvyx workflows list` returns mechanically available export identity and paths only. It must not infer titles, summaries, usefulness, or recommendations.

`svvyx workflows save` copies or extracts reusable source into `~/.config/svvy/workflows/`. It fails if it would overwrite an existing source item unless `--overwrite` is present. A successful save immediately runs the full build pipeline.

`svvyx workflows build` first builds and validates Extensions, generates or refreshes `@svvy/extensions`, validates Workflows source, validates workflow-agent provider/model/reasoning and extension references, generates `@svvy/workflows`, and refreshes workspace package links.

`svvyx workflows models list --json` returns provider/model/reasoning choices from the same pi-normalized provider metadata and auth state used by the Agents pane. Build-time validation must fail explicitly when an agent parameter record names a provider/model/reasoning combination or extension reference that is not available under that registry. It must not silently clamp, rewrite, or defer those errors to runtime.

### 6. Direct Tools And `execute_typescript`

Direct tools are the default coding-agent work surface for bounded repository work.

Direct tools cover:

- semantic code navigation through the prompt-only `cx` CLI extension, using `exec_command` to run
  official `cx` commands
- file inspection and text search through `exec_command`
- visual inspection of local image files through the image-capable file inspection path when enabled
- inspecting repository and git state
- generating artifacts
- running bounded host commands through `exec_command`
- continuing long-running host commands through `write_stdin`
- editing files through `apply_patch`
- handler-owned discovery of generated Workflows exports and workflow-agent provider/model/reasoning choices through `svvyx workflows ...`
- listing the currently bound callable capability set

When a model needs several independent tool results, the prompt should tell it to issue those tool calls together so pi's parallel tool execution can run them concurrently. Sequential tool calls should be reserved for cases where the later call depends on the earlier result.

The prompt-only `cx` extension is the preferred code-navigation guidance when the language is
supported. It does not add native `cx_*` tools, `svvyx cx`, or generated TypeScript clients. Agents
run the official CLI through `exec_command`. The normal inspection ladder is:

```text
cx overview -> cx symbols -> cx definition / cx references -> exec_command with rg/sed/cat/ls/find
```

The builtin cx instructions are default-loaded for orchestrators, handler threads, and workflow task
agents. The cx extension declares an exact CLI requirement and a reusable install-command template.
If the `cx` binary is missing or the installed version does not match the declared version,
extension build fails with an ordinary structured error. Agents may then run the concrete install
command returned by inspect/build through `exec_command` when that is appropriate for the user's
request; that command is submitted as ordinary `exec_command`: runtime approval is evaluated first
according to `approvalMode`, and an approved subprocess runs under the managed filesystem and network
sandbox policy unless `approvalMode` is `full-access`.

`execute_typescript` is available when typed control flow is the right unit of work.

The Shell and `execute_typescript` native-tool instructions keep generic runtime guidance separate
from Incur-specific guidance: Shell has one base command-execution instruction file and one separate
Incur-backed `svvyx` CLI usage file, while `execute_typescript` has one base TypeScript execution
instruction file and one separate Incur generated-client usage file.

That includes:

- batching loaded-extension calls
- looping over many structured extension results
- filtering and aggregating already available structured output
- producing durable artifact evidence from composed results

Inside `execute_typescript`, the runtime exposes an actor-specific generated `extensions` object.

`extensions` contains only loaded TypeScript-enabled builtin clients that are callable by the
current actor, such as Artifacts and Workflows. User `svvyx` generated clients are hidden and
unavailable until sandboxed generated-client execution exists. If the actor has loaded builtin
clients `artifacts` and `workflows`, the generated declarations and instructions include only
`extensions.artifacts` and `extensions.workflows` plus those clients' command types and
command-specific guidance. There is no global `svvy` client and no broad injected `api` helper
surface.

Generated extension clients use the Incur-compatible shape
`extensions.<extensionId>.run(commandId, input)`. Agents may import public types and errors from
`incur/client`, including `Client.ClientError`, inside snippets. The emitted generated clients are
real TypeScript clients backed by app-owned generated packages; they are not rewritten into shell
`svvyx` calls in docs or prompts, and they do not expose local Incur actions or current-build
internals to agent-authored snippets.

The default orchestrator `execute_typescript` extension set does not include the Workflows generated client,
Smithers runtime control, or any `workflow` or `smithers` namespace. Workflow action from the
orchestrator normally goes through `thread_start` into a handler thread.

The default workflow task-agent `execute_typescript` extension set includes only task-local loaded
extension clients. It does not include Workflows source-library clients, Smithers runtime control, or
handler/orchestrator control clients.

File edits use `apply_patch`. The patch target set is validated against the managed filesystem policy
before file effects begin, and the file effects must run through the same Codex-derived sandbox-aware
filesystem execution model as Shell subprocesses rather than relying on TypeScript preflight plus an
unsandboxed host patch process. The policy includes read-only subpaths, protected metadata carveouts,
generated-output boundaries, and the explicit `full-access` sandbox omission.

Every submitted snippet is persisted as a file-backed artifact in the configured artifact directory,
and the runtime must compile or typecheck the snippet before execution.

Structured diagnostics must be produced, and invalid snippets must not run.

The top-level `execute_typescript` tool call goes through the same approval-boundary flow as other
approval-gated native actions before the snippet runtime starts, and that approved runtime is then
constrained by the same managed filesystem and network sandbox policy as other direct execution
surfaces unless full-access policy omits sandboxing. TypeScript code may assemble execution policy,
launch approved and sandboxed runtime work, validate product contracts, call generated Incur clients,
and project results. It must not be described as enforcing filesystem or network sandbox policy with
TypeScript-only validation, cleanup, or compensation substitutes. Generated extension-client calls
inside an approved snippet are recorded as child commands and enforce extension readiness, env
injection, redaction, product-state validation, and failure semantics, but they are not the first
approval gate for arbitrary TypeScript execution.

The approval boundary is not the sandbox. Approval allows or denies starting the tool action;
sandbox policy constrains filesystem and network effects after execution begins.

Live rendering for `execute_typescript` follows the shared tool projection model: the source argument
may stream into a code preview, the persisted source artifact and typecheck diagnostics are runtime
progress, generated-client calls appear as nested child commands, and the final parent command facts
remain authoritative.

### 7. Native Control Tools Stay Small And Explicit

Some actions are not ordinary generic work because they change product-level control flow or the
current actor's generated extension binding.

Those actions stay as `svvy`-native control tools:

- `thread_start`
- `thread_followup`
- `thread_request_report`
- `load_extension`
- `list_extensions`
- `thread_current`
- `thread_group`
- `thread_report`
- `thread_list`
- `thread_episodes`
- `request_user_input`

These are still tool calls.

Native control tools use the same live projection model as direct coding tools. Tool cards appear
when the tool name is known, large freeform arguments such as thread objectives, reports, and user
input questions may stream into previews, and final thread ids, report request ids, episode ids,
loaded extension ids, request-input answers, wait state, and errors come from runtime command facts.

The concrete thread-control and thread-inspection APIs are defined in
`docs/specs/extension/thread_managing.extension.spec.md`.

`list_extensions` is a native read-only actor-local inspection tool. It reports only the current
actor's loaded and available extension records and never exposes unavailable extension details,
secret values, generated context fingerprints, aggregate cache keys, or global profile usage state.

`load_extension` is a native control tool. It loads an available, ready extension into the current
actor session, refreshes the same-turn tool declarations, loaded `svvyx` command guidance,
generated TypeScript declarations, and generated agent context binding, and records an
`Agent context updated` product event. It does not build extensions, request dependency approval,
configure env values, or mutate agent profile defaults.

Prompt-only Web guidance is different from a native Web tool surface.

The builtin Web extension is a default-loaded prompt-only extension that teaches agents to use the
official TinyFish CLI through ordinary shell commands. It does not add `web_search`, `web_fetch`,
`svvyx web`, generated Web TypeScript clients, or app-owned Web Provider settings. TinyFish owns CLI
install, auth, search, fetch, browser-backed research, and command output behavior. `svvy` only owns
whether the Web instructions are included in the actor's generated agent context.

The execution setting `networkAccess` defaults to true. When `networkAccess` is false, the Web
extension is disabled through normal extension binding, which means TinyFish prompt guidance is not
included for orchestrators, handler threads, or workflow task agents.

Ordinary Shell `exec_command` remains available when `networkAccess` is false, but approved
subprocesses run with network egress denied by the managed sandbox unless `approvalMode` is
`full-access`, where the OS sandbox profile is omitted.

The orchestrator may provide per-handler creation-time extension overrides when the delegated
objective should begin with a non-default extension state. `thread_start` owns that creation-time
override on each `threads[]` item and starts normal handler threads with the default handler runtime
shape plus the requested extension binding before each first turn. `thread_start` always returns a
durable `threadGroupId` at top level; individual returned thread rows do not repeat it. Exact input,
and output are defined in `docs/specs/extension/thread_managing.extension.spec.md`.

Smithers and Workflows are different from native control tools.

Smithers is prompt-only official CLI guidance. It adds no native tools and no generated TypeScript client. Agents use Smithers by running official Smithers CLI commands through Shell as ordinary `exec_command` command-family work.

Workflows is an Incur-backed `svvyx` extension for reusable source-library operations. Agents access it by running `svvyx workflows ...` through Shell as ordinary `exec_command` command-family work, or through loaded generated `execute_typescript` clients when available. It exposes `list`, `save`, `build`, and `models list`. It does not run, resume, approve, inspect, or debug Smithers workflows.

The default orchestrator context should know that workflow action normally belongs in a delegated handler thread, but ordinary orchestrator profiles do not default-load Smithers or Workflows. The default handler context knows that the orchestrator can delegate and reconcile thread episodes, but `thread_start` is not part of the ordinary handler profile unless nested delegation is explicitly adopted as product behavior.

A workflow task agent should know only its task-local instructions and task-local tools. It must not receive Smithers, Workflows, handler controls, or orchestrator controls by default.

The intended use of the native control subset is:

- the orchestrator normally uses `thread_start` with one `threads[]` item to open one delegated
  handler thread for ordinary delegation
- `thread_start.threads[].history` defaults to `"isolated"`, meaning the handler starts without
  inherited orchestrator conversation history and receives only handler prompt, handler tools,
  handler extension binding, and delegated objective; this is the normal mode because ordinary
  coding-agent delegation is more reliable when the handler receives a compact task packet instead
  of inherited chat
- the orchestrator uses `history: "forked"` only when the user explicitly asks to fork, continue, or
  share the current conversation context; when the delegated work continues unresolved design
  discussion whose important nuance is not captured in durable files; when re-explaining the
  background would be materially lossy; or when the point is to try multiple approaches from the
  exact same conversational starting point
- the orchestrator does not use `history: "forked"` for ordinary implementation, source-driven
  research, test fixing, code review, security review, independent critique, verification, tasks
  already specified by durable files, specs, tests, handoff docs, or objective text, or conversations
  that include stale plans, speculative reasoning, rejected alternatives, or likely bias
- the orchestrator uses multiple `thread_start.threads[]` items only for separate user-visible
  handler conversations where the user is invested in each workstream, each objective may need
  direct follow-up, or the workstreams are clearly independent conversations
- every `thread_start` creates or appends to a durable thread group; the orchestrator may pass a
  prior `threadGroupId` to add later related handler threads to that group
- the orchestrator uses `thread_followup` to send corrections, clarifications, or later
  instructions to existing handler threads by exact `threadIds` or by one `threadGroupId`
- the orchestrator uses `thread_followup({ activate: true })` when a handler thread whose current
  objective is concluded already has the right delegated context for follow-up work; active targets
  receiving the same follow-up keep their current objective
- the orchestrator uses `thread_request_report` when it needs an explicit update episode from one
  handler without changing that handler's objective
- a handler thread may use `thread_group` to inspect the current thread group and sibling objective
  summaries when that topology is materially relevant to the current objective; thread groups are
  topology and addressing only, not shared memory or peer messaging
- a handler thread uses `thread_report` without `outcome` to emit an intermediate update episode when it has important information for the orchestrator
- a handler thread that wants a correction, decision, or useful finding forwarded to sibling threads
  uses `thread_report` without `outcome` to ask the orchestrator to forward it; the orchestrator
  decides whether to send a `thread_followup` to the target `threadGroupId` or exact `threadIds`
- a handler thread uses `thread_report` with `outcome` to conclude the current objective when it has delivered, failed, or explicitly closed the delegated work; the tool call succeeds when `svvy` records the durable conclusion episode and marks the current objective concluded
- after a durable episode is recorded, `svvy` creates a typed orchestrator queue item so the orchestrator can reconcile the recorded episode in surface-queue order; cancelling or deleting that notification does not roll back the episode or return a tool error to the handler
- a handler thread uses official Smithers CLI commands through Shell for Smithers execution and uses `svvyx workflows ...` only for reusable Workflows source-library operations
- any interactive orchestrator or handler-thread surface may use `request_user_input` when it needs user clarification and can provide an explicit default answer

### 8. Sessions Contain Many Interactive Surfaces

A session is the durable user-facing container for:

- the main orchestrator conversation
- delegated handler thread conversations
- turns
- command history
- episodes
- artifacts
- wait state

The main orchestrator surface and a handler thread surface are intentionally similar interaction surfaces:

- both can receive direct user messages
- both can stream model responses
- both can call tools
- both can be opened in panes

The difference is responsibility, not UI class:

- the orchestrator owns strategy
- a handler thread owns one delegated objective

### 9. Thread Episodes And Persistent Handler Surfaces

Episodes are the main reusable semantic outputs.

In the adopted delegated model:

- a handler thread may author Smithers source, run official Smithers CLI commands, and repair its delegated work internally
- a handler thread may wait, resume, rerun commands, and ask for clarification internally
- ordinary handler-thread replies stay inside the thread and do not emit durable episodes unless the handler calls `thread_report`
- a handler thread may emit an intermediate update episode with `thread_report` without concluding the current objective
- a handler thread may be idle between turns while still remaining open, owned, and ready for direct follow-up
- a handler thread returns control to the orchestrator by explicitly calling `thread_report` with an `outcome`, which marks the current objective concluded and emits a conclusion episode
- the thread surface remains open for later inspection, direct follow-up chat, and explicitly
  reactivated work in that same delegated context

That lifecycle boundary is the thread's concluded objective state plus the conclusion episode it emits.

Tool calls may still produce command summaries, traces, and artifacts.

Those are not episodes.

The episode should be:

- durable
- human-readable
- compact enough to reuse later
- semantically richer than raw logs

The machine-readable lifecycle state that drives routing belongs in turn and thread records, not in a large bespoke episode schema.

### 10. Detailed Execution Internals Stay Available But Not Default

The orchestrator should normally reason from:

- the handler thread objective
- the thread's objective state
- the latest episode emitted by that thread

It must still be able to inspect the underlying handler thread, artifacts, command traces, and workspace Smithers source when needed.

That is an escape hatch, not the default reconciliation path.

### 11. Context Is A Scarce Resource

The system should preserve strategic context in the orchestrator, spend local context deliberately inside handler threads, and externalize whatever does not need to stay in the active model window.

Every pi-backed agent surface should expose its active context-budget usage as a percentage of that surface's active model maximum. This applies separately to orchestrator surfaces, handler-thread surfaces, and workflow task-agent attempts. The UI should make context pressure visible without implying that every model fails at one exact percentage: neutral is below 40%, orange starts at 40%, and red starts at 60%. These warning bands are an operational policy for when the user or agent should compact, summarize, hand off, or start a fresh surface.

In practice that means:

- useful results are compressed into final thread episodes and artifacts instead of dragging full transcripts forward
- delegated work can proceed inside a handler thread without forcing the orchestrator to absorb every internal command or workflow detail
- repeatable structure is pushed into saved Workflows agents, prompts, components, workflows, and `execute_typescript` instead of repeatedly re-derived in prose
- raw model reasoning is reserved for ambiguity, synthesis, prioritization, and recovery

### 12. Codex-Like Execution Policy

`svvy` uses Codex-like approval boundaries with automatic review by default, plus explicit user and
full-access modes.

In practice that means:

- normal trusted local coding work proceeds without turning every command into a user approval prompt
- all `exec_command`, `svvyx ...`, `apply_patch`, and `execute_typescript` boundary decisions are
  enforced by the runtime, not by model memory
- `approvalMode: "auto-review"` routes approval-boundary requests to the automatic reviewer
- `approvalMode: "user"` blocks the exact tool call on an actor-local user approval request
- `approvalMode: "full-access"` omits the approval boundary and managed OS sandbox
  enforcement for direct tools; if `networkAccess` is false, Web prompt guidance stays disabled, but
  Shell egress denial depends on the omitted sandbox profile and is not enforced for full-access
- approval and sandboxing remain separate: approval decides whether a tool action may start, while
  the sandbox decides where that approved subprocess may read, write, and use network access
- `svvyx` is a real app-owned CLI that uses Incur; agent Shell usage of `svvyx ...` happens only as
  ordinary `exec_command` input to that CLI and projects through the same Shell command model as
  other subprocess work
- `execute_typescript` is a TypeScript composition tool; builtin Artifacts and Workflows generated
  clients are available through typed TypeScript clients, user `svvyx` generated clients remain
  unavailable until sandboxed generated-client execution exists, and the whole TypeScript runtime is
  launched through the same approval and sandbox execution lane as other direct execution surfaces
- macOS managed sandboxing uses a packaged, app-owned Codex-derived native helper that applies
  Codex filesystem policy semantics through `/usr/bin/sandbox-exec`, including `Read`, `Write`, and
  `None` entries, most-specific path precedence, equal-specific `None > Write > Read` precedence,
  writable roots with read-only subpaths, protected `.git`, `.agents`, and `.codex` metadata
  carveouts, default read access, explicit writable roots for the workspace, active artifact mutable
  directory, `/tmp`, and `$TMPDIR`, and fail-closed profile generation
- Codex-style sandbox denial must be reported as sandbox denial; `svvy` must not silently retry
  without sandboxing unless the active approval mode explicitly permits full-access/escalation
- `networkAccess` defaults to true; disabling it restricts network access and disables the Web extension
- extension package dependency installation remains an explicit user-confirmation flow because it
  can download and execute third-party code
- extension-declared CLI install or update commands are ordinary `exec_command` calls after a
  missing or unknown required CLI requirement is reported, or after the UI/agent chooses to update an
  available CLI from its detected version; `approvalMode` decides whether auto-review, user approval,
  or full-access handling applies before the concrete shell command can proceed
- ambiguity is handled through clarification and waiting states when the agent needs user intent, not through hidden approval gates
- delegated handler threads and workflow task agents may pause on actor-local execution-permission approvals only when `approvalMode` is `user`; Smithers workflow approvals remain Smithers workflow state

## Product Ownership Boundaries

### Electrobun

Electrobun owns:

- the native desktop shell
- windowing
- packaging
- app lifecycle
- OS integration

### pi

`pi` owns:

- the interactive runtime seam
- the base tool loop substrate
- the session substrate
- supported extension and runtime hooks
- core provider-facing agent runtime behavior
- the backing conversation runtime for both the main orchestrator surface and delegated handler thread surfaces

`svvy` must extend or project through pi's runtime and extension APIs.

It must not replace pi with a second agent shell.

### svvy

`svvy` owns:

- product behavior above the pi seam
- the orchestrator
- delegated handler thread creation and supervision policy
- session, turn, queued-message, thread, command, episode, artifact, saved Workflows, and wait models
- reconciliation
- workspace-runtime restart and crash recovery coordination for `svvy`-owned product work
- desktop UI product semantics
- read models and selectors that drive the app

### Smithers

Smithers owns:

- workflow execution invoked by agents through official Smithers CLI commands
- durable multi-step workflow state inside Smithers
- retries, loops, branches, and internal workflow state
- worktree-isolated execution when delegated work requires it

Smithers is not:

- the top-level product shell
- the orchestrator
- the main conversation substrate
- the owner of session-level routing decisions

## Product Model

### Workspace

A workspace is the local repository context the app is attached to.

It includes:

- repository root
- current branch or VCS state
- available worktrees
- discovered `AGENTS.md` and `CLAUDE.md` external instruction sources

The desktop shell presents open workspaces as compact tabs inside the app chrome, integrated with the sidebar and workspace control row rather than as a separate top toolbar. Workspace tabs are left-aligned at the start of the main workspace chrome, scroll horizontally when the open tab set exceeds the available space, and can be dragged to reorder them. Workspace tab order is durable workspace-shell chrome state and restores across app restart. A workspace tab is a visual selector for one workspace runtime and one active layout slot id. The canonical workspace runtime, durable workspace state, and durable user workspace layouts belong to the workspace context, not to the visual tab: the session catalog, path index, app logs, live surface registry, pi sessions, structured state, prompt queues, handler threads, workspace read models, saved Workflows generated-state visibility, and initialized `A`/`B`/`C` layout snapshots are shared by duplicate tabs for the same canonical cwd. Duplicate same-cwd tabs may choose different active layout ids, but they do not own separate durable layout documents or separate panel-local restore state for the same `(workspaceId, layoutId)`. Opening the app with no restored user workspace tabs creates a real svvy-owned default workspace tab whose first focused surface is exactly one `Open Workspace` pane, so normal chat, Context, Logs, command palette, and sessions remain usable before a user chooses a repository. Default workspace tabs have no durable layout slots; any pane changes made inside a default workspace tab are ephemeral and are not restored as workspace layout state. `Open Workspace` retargets the current visual tab to the chosen user workspace, `New Tab` creates another default workspace tab with exactly one `Open Workspace` pane, and `Open Workspace in New Tab` creates a new visual tab for the chosen user workspace. Opening an already-open repository in a new tab creates a separate visual workspace tab for the same cwd instead of focusing the existing tab, without creating an independent workspace runtime, independent session catalog, isolated durable workspace state, or another durable layout owner.

Each workspace tab summarizes that workspace's session-level running, unread, waiting, and error counts from the shared durable workspace read models for its cwd. Count badges render only when their value is greater than zero, stay in the stable running, unread, waiting, error order, use status color instead of icons, and expose title or tooltip context on hover. Workspace open and close controls are compact icon controls with accessible labels. Workspace-scoped backend requests and renderer sync events carry an explicit `workspaceId` for the shared workspace runtime and, when layout state is involved, an explicit `layoutId` chosen by the tab. The backend must not route user work through a process-global active cwd, treat cwd alone as the runtime id, or treat duplicate same-cwd tabs as separate durable workspaces or separate durable layout owners.

The sidebar footer shows the current checked-out branch with a branch icon when the workspace is inside a git repository. That branch affordance opens a compact local-branch menu and switches branches through a workspace-scoped Bun RPC using normal git semantics. If the workspace is not a git repository or no branch is checked out, the footer falls back to the workspace label with the workspace icon and does not expose a branch switcher.

Each user workspace has three fixed durable layout slots: `A`, `B`, and `C`, keyed by `(workspaceId, layoutId)`. These are not user-named layouts. The slots render as compact controls pinned at the far right of the same chrome row as the workspace tabs and status controls. Selecting a layout slot changes the active layout id on the current tab and swaps to that workspace's durable Dockview layout snapshot for the selected slot. Empty slots remain selectable and render muted, not disabled, so the user can start a new layout from scratch. Duplicate same-cwd tabs share the same three durable layout slots while each tab records only its selected active layout id; changing slot `A` in one tab changes the same `(workspaceId, "A")` layout that another tab would see when it selects `A`.

### Session Container

A session is the top-level durable product container for one orchestrator-led line of work.

It contains:

- one main orchestrator surface
- zero or more delegated handler thread surfaces
- durable state across those surfaces

The session container is durable workspace state.

It is not the live runtime slot for whichever surface happens to be open in the UI.

Session navigation metadata is part of durable workspace state.

The adopted navigation model is deliberately small:

- pinned sessions, regular Sessions, and archived sessions appear as three fixed sidebar groups between the orchestrator actions and Logs, Agents, Extensions, and Workflows
- each group is collapsible, independently scrollable, vertically resizable, and persists its collapsed state and size per workspace
- archived sessions move into one Archived group, and Archived is collapsed by default
- the Archived group is the only archive-style grouping
- arbitrary user-created session folders are not part of the product model
- archiving hides a session from the active list without deleting pi session data, structured state, artifacts, threads, or episodes
- sessions track durable unread state when an assistant turn finishes outside the currently focused pane surface, show that state as a small dot in place of the session timestamp in the sidebar, and clear it when a pane for that session receives focus
- normal session-row clicks open the session in the focused Dockview panel, while `Cmd`-click opens the session in a new pane even when the clicked session is already active
- session rows expose a context menu with Mark as Unread, Pin or Unpin, Rename, and Archive or Unarchive actions while keeping normal row selection as the primary navigation behavior
- each top-level session row represents the orchestrator layer only; child handler state must not make the session row appear running, waiting, or broken
- delegated handler threads appear as nested rows under their parent session
- sidebar subtitles are row-local relevance signals: orchestrator rows show orchestrator-local waits, commands, turns, or explicit thread episode summaries; handler rows show handler-local waits, active commands, and recent delegated-work summaries; `error` is reserved for row-local unrecoverable state that needs user action

### Surface Identity

The product carries four different identifiers and they are not interchangeable:

- `workspaceSessionId`: the durable top-level session container id used for storage, summaries, navigation, and restart recovery
- `surfacePiSessionId`: the pi session id for the currently addressed interactive surface
- `threadId`: the durable handler-thread record id for the delegated objective; it exists only when the target surface is a handler thread
- `panelId`: the Dockview panel identity that points at a surface without becoming that surface's runtime identity

Rules:

- backend RPC calls and backend-to-renderer surface payloads must carry an explicit surface target rather than overloading `session.id`
- `session.id` inside session summaries means `workspaceSessionId`
- `workspaceSessionId` and `surfacePiSessionId` are distinct contract fields even when two values happen to match
- `panelId` must never be used as a session id, surface id, or thread id

### Live Surface Runtime

Each interactive pi surface is managed as its own live runtime object keyed by `surfacePiSessionId`.

That live runtime owns:

- the live transcript snapshot
- streaming state
- provider, model, and reasoning settings
- the resolved system prompt
- the current prompt execution context
- one prompt lock for that surface
- a surface-local durable queue manager for prompt-bearing and control work, with blocked follow-ups waiting for the prompt lock to release

Live surface runtime is separate from both durable workspace state and Dockview layout state.

Streaming state belongs to the live surface runtime, not to a Dockview panel or renderer prompt
request. A surface may keep streaming with zero, one, or many attached panels, and a panel opened
mid-stream renders the committed transcript, pending user message, and current assistant stream from
the surface snapshot.

Queued surface work is structured product state, not committed transcript history until a prompt-bearing item is delivered as the next real user message for the same `surfacePiSessionId`. If the user submits from a composer while the target surface is idle, `svvy` still durably enqueues the message, but the queue manager atomically claims it before publishing renderer-visible queued state, so the first visible state is pending or active work. If the target surface is already running, `svvy` queues that message for the same surface, keeps the active turn undisturbed, and starts the next normal turn only after the current turn settles or is cancelled. Ordinary composer submit is queue-managed delivery; the explicit queued-row `Steer` action promotes a durable row ahead of ordinary queued user messages for the next safe delivery boundary. It does not inject a pi-only steering fast path. A steered row remains visible in a locked state until the queue runner claims it or `svvy` restores it after rejection. Thread report notifications, report requests, and agent-context refresh control work use the same surface queue so they are ordered with user messages. An `agent_context_refresh` row labelled `Update agent context` updates the surface's generated agent context binding before later prompt-bearing items run, without creating transcript content or prompt history. Queued work survives panel changes and duplicated panel views because it belongs to the surface, not to a Dockview panel.

### Dockview Panel And Layout State

Dockview panel and layout state is UI state.

It owns:

- which Dockview panel shows which surface
- the Dockview layout document, including groups, tabs, split sizes, edge groups, floating groups, and popout groups
- panel focus
- panel-local scroll and inspector state
- svvy panel metadata keyed by Dockview panel id

Dockview panels are not live runtimes.

If two Dockview panels show the same surface, they share one underlying live surface runtime.

Users may split, dock, tab, drag, resize, close, float, and pop out panels as their workspace requires. Dockview owns the layout interaction mechanics, including drag/drop overlays and splitter behavior. The renderer is responsible for applying svvy product policy, practical minimum panel sizes, and explicit close behavior around Dockview events.

The durable layout stores Dockview serialized layout state plus svvy panel metadata. Window resize preserves the Dockview layout intent without changing surface bindings or live runtime ownership.

User workspace layout persistence is slot-based and keyed by `(workspaceId, layoutId)`. Slots `A`, `B`, and `C` each store their own Dockview serialized layout, panel metadata, focused panel, compact surface state, and panel-local state. The selected slot autosaves after meaningful pane changes. A slot is considered initialized once it contains a bound product surface; uninitialized slots are shown with muted chrome but remain fully selectable. Workspace tabs store only chrome state such as tab order, selected `workspaceId`, and active layout id. Default workspace tabs do not persist Dockview layout slots; a newly created default workspace tab always starts with one `Open Workspace` pane, and any later pane changes in that tab are ephemeral.

### Orchestrator Surface

The main orchestrator surface is the default conversation the user starts in.

It is responsible for:

- understanding the user's objective
- deciding whether local action is enough or a handler thread should be spawned
- tracking which delegated objectives exist
- receiving thread episodes from handler threads when they report updates or return control
- deciding what to say next in the main conversation

### Handler Thread

A handler thread is a delegated interactive surface backed by pi.

It owns:

- one delegated objective
- the workflow selection or authoring path for that objective
- the internal clarification loop for that objective
- zero or more update or conclusion episodes emitted to the orchestrator over that thread's lifetime

Each handler thread should have:

- a title
- an objective
- its own direct conversation history after creation, plus optional product-filtered inherited
  orchestrator history when started with `history: "forked"`
- durable objective state
- loaded and available extension ids, when specialized product guidance or capability has been preloaded or loaded during the session
- zero or more thread episodes

Available extension ids describe reusable product knowledge loaded into actor prompts by default or requested on demand, such as Workflows source-library guidance.

The current handler objective, current `threadGroupId`, pending report requests, and latest episode summary are exposed to the handler through `thread_current`. The orchestrator inspects delegated thread rows through `thread_list`, filters those rows by `threadGroupId` when it needs a related group, requests handler updates through `thread_request_report`, sends follow-ups through `thread_followup`, and reads exact durable episode bodies through `thread_episodes`. Handlers can inspect their current group and sibling objective summaries through `thread_group`, and can read their own durable episodes through `thread_episodes`. These read tools do not include transcripts, command details, or Smithers internals; handlers use Shell and artifacts when execution details matter.

Agent profiles describe the provider, model, reasoning level, extension usage selections, and callable policy used by pi-backed product agents. Base role instructions are selected through builtin `base-*` instruction extensions rather than stored as profile-local prompt blobs. The Agents pane is the product-owned profile surface. It appears in the sidebar between Logs and Extensions, and owns orchestrator profiles, the special handler-thread profile, and workflow-agent profiles rather than burying model behavior in general settings.

The app owns these app-wide agent profile settings:

- the default orchestrator profile for normal New orchestrator creation; it is locked, non-draggable, non-deletable, and always present in the picker
- `threadHandler` for delegated handler-thread surfaces created by `thread_start`
- workflow-agent profiles for Smithers task-agent attempts and generated workflow-agent components

The app also owns internal title-naming settings for one-shot top-level session and handler-thread title generation, seeded to `openai-codex`/`gpt-5.4-mini` with low reasoning effort. Those settings are not exposed as a special Agents-pane profile.

User-created orchestrator profiles are ordered in the Agents pane. That order drives the New orchestrator picker order and visible profile badges on created orchestrator surfaces. The default orchestrator profile remains first and cannot be reordered, deleted, or converted into a user profile. Deleting a user-created profile uses an inline single-confirm action that cancels on outside click or Escape. All top-level session creation uses orchestrator profiles, with no separate session mode switch in the product model.

Session records persist the orchestrator profile selected at creation time, the profile snapshot that was active at creation time, and the generated agent context fingerprint used by the orchestrator surface. All top-level sessions are orchestrator sessions created through New orchestrator or equivalent command-palette prompt fallback.

Handler threads use the `threadHandler` special profile. Each `thread_start.threads[]` item may pass
creation-time extension overrides as a partial override over that profile's extension usage states.
Extensions remain separate product knowledge and capability records; they do not carry model,
reasoning, or prompt-selection settings.

The Agents pane edits app-global agent profiles, including orchestrator profiles, `threadHandler`, and workflow-agent profiles. General settings edit app-global model provider credentials, app appearance (`system`, `light`, or `dark` with `system` as the default), the user's preferred external editor for opening workspace source files from read-only product surfaces, and the artifact directory used for durable session artifact files. The artifact directory defaults to `~/.config/svvy/artifacts` and remains app-owned configuration rather than an agent-supplied command argument. Provider rows use icon-only key, OAuth, and remove controls with explanatory tooltips; remove uses an inline single-confirm action. Web-specific TinyFish CLI auth is owned by TinyFish CLI commands such as `tinyfish auth login`, `tinyfish auth set`, and `tinyfish auth status`, not by `svvy` General settings. Extension definitions, extension instructions, external instruction controls, and generated context previews are edited or inspected in the Extensions pane rather than buried in general settings. Complex settings and configuration editors use TanStack Form for renderer form state where they need validation, dirty state, field-level errors, submit pending state, reset/cancel behavior, and async save errors, while Bun-side settings validation and normalization remain authoritative. Agent profile changes save directly from the setting control rather than through a separate save button. Agent model selection is a constrained picker over models from currently connected providers, and reasoning selection is constrained to the levels supported by the selected model, matching the interactive session controls rather than accepting freeform provider, model, or reasoning text. An orchestrator profile may either keep composer model and reasoning changes local to each session or let sessions using that profile save those composer changes back to the profile for future sessions. The source of truth for provider/model capability metadata is pi's normalized model registry and runtime APIs: `svvy` does not maintain separate provider-specific reasoning tables, Codex reasoning special cases, or request-shape mappings. Visible reasoning output is whatever pi normalizes into assistant `thinking` blocks; for providers such as OpenAI Codex this is a reasoning summary when the provider streams one, not raw chain-of-thought, and encrypted continuation-only reasoning with no visible summary must be labelled unavailable rather than redacted.

Workflow-agent profiles are app-global Agents-pane profiles backed by the same structured source
records generated as `Agents.*` exports in `@svvy/workflows`. UI edits and agent saves both write
that source shape and trigger a Workflows build.

### Agents And Extensions

Agents and Extensions are the app-owned prompt and capability configuration surface for orchestrator, handler-thread, and workflow task-agent prompts.

Agents own:

- profile display name
- actor kind
- provider/model and reasoning defaults
- default-loaded base instruction extensions
- per-extension usage state: `default_loaded`, `available`, or `unavailable`, except fixed
  app-native controls such as Extension Loading
- per-profile extension instruction order, edited by dragging active expanded-profile extension rows
- expandable per-extension generated instruction previews for that profile

Extensions own:

- builtin, user, and external_instruction categories
- ordered full loaded instruction source files that generate one loaded instruction block
- minimal available instructions
- native tool, svvyx, or instructions-only interface
- generated TypeScript client declarations for emitted builtin clients; user client declarations
  remain disabled until sandboxed generated-client execution exists
- env and dependency readiness
- category-appropriate reset/delete behavior
- read-only usage views showing which agents use the extension

Artifacts is a builtin `svvyx` extension with generated TypeScript clients. Its model-callable API is
the `svvyx artifacts ...` command family, with `create`, `inspect`, `list`, `open`, and `delete`
commands defined in `docs/specs/extension/artifacts.extension.spec.md`.

External instruction records represent files such as `AGENTS.md` and `CLAUDE.md`. They appear in the Extensions pane as a distinct read-only category, use the same per-agent usage states as other extensions, show path/content/order in generated-context previews, and provide an open-external-file action. Resetting an external instruction record changes only `svvy` settings or metadata overlays; it never overwrites the external file.

Generated agent context bindings store loaded extension ids, available extension ids, external instruction content/order, native tool declarations, loaded svvyx guidance, emitted generated TypeScript client declarations, current-build context references, and generated agent context fingerprint for sessions, handler threads, and workflow task-agent attempts.

New top-level sessions, handler threads, and workflow task agents always use the latest context-ready generated agent context from Agents, Extensions, generated contracts, and current external instructions. Existing surfaces store the generated agent context fingerprint they received. When the current context-ready generated context fingerprint differs from the bound fingerprint, `svvy` automatically queues or applies `agent_context_refresh` work labelled `Update agent context`. If the surface is idle, the update is claimed before the next prompt-bearing item runs. If the surface is active, the update is visible in the queue until it applies at the next safe `refreshRunContext` boundary or before the next prompt-bearing item. On success, the affected session records `Agent context updated` with details of what changed. The visible surface identity and transcript stay continuous even if the internal managed pi runtime must be recreated to load the fresh `systemPrompt`.

Top-level session titles are generated through an explicit durable title-generation flow. Before the first turn is submitted, the visible default session title follows the beginning of the live composer draft for that session's orchestrator surface. When the first real user turn starts in a top-level session, the app records a pending title-generation job and runs the configured `namer` agent concurrently with the orchestrator turn; until that generated title lands, the visible title continues to use the first user message summary. The orchestrator must not wait for the namer, and the namer must not wait for the orchestrator response. The namer settings prompt is the title-generation instruction; the one-shot user prompt sent to that agent contains only the first user message context to title, not another naming instruction or extracted keyword list. While that job is pending or running, manual session rename is blocked for that session so the generated title and a user rename cannot race. The generated title is persisted once, auto-title generation stops after that first successful generation, and a manual rename permanently freezes future auto-titling for the session. Handler-thread titles are generated by the same configured `namer` agent from the orchestrator-supplied `thread_start` objective; the orchestrator does not receive or supply a separate handler title field.

### Workflows Source Library

The Workflows source library is app-global reusable Smithers authoring source.

It lives under `~/.config/svvy/workflows/` and has exactly these editable source kinds:

- `agents/`: structured `.agent.json` task-agent parameter records
- `prompts/`: direct MDX prompt assets
- `components/`: direct TypeScript or TSX Smithers components and helpers
- `workflows/`: direct TSX reusable workflow modules

The `generated/` child is read-only build output outside the safe writable boundary. Agents must not edit it directly.

`svvyx workflows save` is the promotion path from workspace-authored `.smithers/` files into app-global reusable source. `svvyx workflows build` is the repair and refresh path after source edits. Both are ordinary Shell commands from the agent's perspective.

Workflow-agent records are parameter objects, not arbitrary executable agent source. They are saved as structured data so the Agents pane and Workflows build share one source of truth. UI edits in the Agents pane and agent edits through `svvyx workflows save` both write the same source shape and trigger the same build. The Agents pane can create and duplicate workflow-agent records, delete user-created workflow-agent records through the same inline confirmation pattern as orchestrator profiles, and open the exact `.agent.json` source file for each record. The default Explorer, Implementer, and Reviewer records are seeded source records and remain non-deletable defaults.

The generated `@svvy/workflows` package exports only namespace objects:

- `Agents`
- `Components`
- `Prompts`
- `Workflows`

The generated package may attach internal non-enumerable metadata to exported values so the app can map generated exports back to source files and Agents-pane records. That metadata is not part of the agent-facing public API, must not alter normal import usage, and must not appear as public fields, public declarations, public docs, or examples.

### Workflows Pane

The Workflows pane is read-only visibility into the latest successful generated `@svvy/workflows` package.

It is generated-source visibility only. It is not a workflow runner or source editor.

For each generated export in `Agents`, `Components`, `Prompts`, and `Workflows`, it shows:

- kind
- namespace
- export name
- qualified name
- read-only generated code
- link to the generated file
- link to the source file

For `Agents.*` exports, the pane also shows the generated task-agent parameter object and provides a primary human action that opens the corresponding record in the Agents pane for customization. Agents themselves do not use that UI link; agents use `svvyx workflows ...` and source files.

The Workflows pane refreshes after successful `svvyx workflows build` and after UI edits that trigger a build. It may use internal build metadata for source/generated links, but it must not expose that metadata as an agent-facing contract.

### Turn

A turn is one request boundary inside one interactive surface.

That means:

- the main orchestrator surface has turns
- each handler thread surface has its own turns

Turns exist because a user or system message opened a real unit of work in one surface.

Each turn should also persist that surface's top-level turn decision so session-level routing and delegated supervision do not need to be reconstructed from transcript prose or low-level command sequences.

### Episode

An episode is the durable semantic output reused later by the orchestrator or shown to the user.

For delegated handler threads, a thread episode should capture:

- the delegated objective
- what was concluded or delivered
- what mattered semantically
- enough detail for the orchestrator to continue without reopening full logs by default

It is created when the handler thread explicitly calls `thread_report`. Calling `thread_report`
without `outcome` creates an intermediate update episode. Calling it with `outcome` creates a
conclusion episode and concludes the current objective.

Artifacts and detailed traces do not need to be flattened into the episode body.

They remain inspectable through durable links and thread history.

### Artifact

Artifacts are durable session files produced by commands and related execution.

They live under the `svvy` artifact area rather than as normal project source. They are for outputs that should remain inspectable but should not normally be committed into the user's repository tree as product code, source docs, configuration, tests, or assets.

Examples:

- diffs
- logs
- retained test output, JUnit XML, coverage summaries, or other test-run evidence when the output is worth preserving beyond a compact command summary
- submitted `execute_typescript` source snippets, including failed attempts
- screenshots
- generated audit, benchmark, inspection, or workflow-authoring reports that are evidence of agent work rather than requested repository files
- implementation plans, review notes, and other session-local planning or review documents
- bounded handoff documents intended to be read, reassessed, or modified by another agent without
  inheriting the full conversation that produced them
- exported Smithers or Workflows details

A normal repository file edited by the agent is not automatically an artifact.

If the user asks for a file to be created in the repository, that file is workspace state, not an artifact. If the information is small enough to answer in prose, it belongs in the transcript or command summary, not in an artifact file.

Agents should create artifacts only for durable session outputs, evidence, previews, logs, reports,
screenshots, review files, or large payloads that need later inspection and should not normally be
placed in the repository.

For explicit artifact creation, the agent either calls `svvyx artifacts create --name
<filename-with-extension> --json` to create a new empty mutable artifact file, or calls `svvyx
artifacts create --path <file> [--name <filename-with-extension>] --json` to copy one existing source
file into the configured artifact store. `--name` is the exact stored filename and must include the
extension. `--immutable` stores the artifact under the session `immutable/` artifact directory.
`svvy` creates the durable artifact record and links it to the current session, thread, and source command from the runtime boundary. For copied artifacts, the source
path is not the artifact.

Artifact files live under `<artifactDir>/<sessionId>/`. Ordinary command execution may write only the
current session artifact directory and must treat `<artifactDir>/<sessionId>/immutable/` as read-only.
That immutable boundary is enforced by the managed filesystem policy, not by OS-level file flags.

Artifact projection should show durable work outputs linked to threads and commands before relying on transcript reconstruction.

Visible HTML artifact previews must render inside sandboxed iframes. Script-capable previews may grant `allow-scripts`, but the sandbox policy must not include `allow-same-origin`, top navigation, popups, form submission, or other parent/app escape permissions.

Artifacts are thread- and command-addressable first.

Agent-facing artifact listing defaults to the current thread or session and may filter by thread id.
Command-addressed artifact lookup remains a product selector and inspector concern rather than a
primary `svvyx artifacts list` flag.

Episode and read-model projections must not depend on transcript parsing.

### Worktree

Worktree awareness remains first-class.

At minimum:

- a handler thread may be associated with a worktree
- Smithers CLI commands run from the current workspace or selected worktree according to normal Shell execution context
- delegated work should default to the current branch and current worktree rather than spawning worktrees automatically
- the UI must make the active worktree legible

## Execution Model

### High-Level Flow

Every user request that can start immediately goes through one orchestrator-controlled product loop:

1. load current workspace, session, thread, episode, artifact, saved Workflows, and wait context
2. identify the target surface of the message
3. drain any earlier queued `agent_context_refresh` control item for the target surface, refreshing the generated agent context binding before prompt-bearing work
4. compose that surface's actor prompt from its bound generated agent context, including loaded base instruction extensions, loaded capability extension instructions, available extension loading hints, external instruction files, native tool declarations, loaded svvyx guidance, and generated TypeScript client declarations, then load it into pi's true `systemPrompt` channel before sending the new user message
5. open a new turn for that surface
6. let that surface choose and persist its top-level turn decision, then decide its next tool call or direct response
7. execute tools through the correct runtime handler
8. record commands, events, artifacts, and wait state
9. update structured state
10. emit explicit workspace-state updates whenever durable summaries or read models change
11. emit explicit surface-state updates whenever one live surface transcript or runtime snapshot changes
12. render updated workspace and Dockview panel surfaces by joining those updates with panel bindings

Read APIs and renderer code must not compensate for missing lifecycle writes with polling, transcript parsing, or inferred repair logic.

If the target surface already has an active prompt lock, the composer submit does not enter this flow immediately. It creates a surface-local queued-message record and waits for the same `surfacePiSessionId` to become available. Delivery of that queued message then enters the normal flow as a real user message and normal turn for that surface.

Committed user transcript messages expose a copy action for their visible text and a separate edit
action. When the user edits a committed user transcript message, the selected transcript message
stays visibly marked while its text is loaded into the composer. If the composer already contains
text or attachments, `svvy` opens an app dialog warning that the edit will replace the current draft
before continuing. The edited send targets the same `surfacePiSessionId` and uses pi's session tree
semantics to move the active surface leaf to the parent of the original user message before
submitting the revised user message. The original branch remains historical session data, and the
visible live surface continues from the edited message branch. This is not a fork, queued-message
restore, transcript rewrite, or hidden prose reconstruction.

### Main Orchestrator Loop

When the target surface is the main orchestrator:

1. understand the new request in the context of existing durable state
2. decide and persist whether the request can be handled locally or needs delegation
3. if local:
   - answer directly
   - or use `execute_typescript`
   - or ask for clarification
4. if delegated:
   - call `thread_start` with one `threads[]` item for ordinary delegation, or multiple items only
     for separate user-visible handler conversations that should share one durable thread group
   - delegate each objective to a handler thread
   - omit `history` for the default isolated mode
   - set `history: "forked"` only when conversational continuity is explicitly requested, materially
     necessary and cannot be captured cleanly in a compact objective or durable handoff file, or
     required to try multiple approaches from the exact same conversational starting point
5. when a handler thread emits an episode, reconcile the typed `thread_report` notification against durable state: thread durable state plus the latest episode
6. if the orchestrator needs status while the handler remains active or interactable, call `thread_request_report` and reconcile the resulting episode when the handler answers
7. if later work belongs in the same delegated context after the objective is concluded, call
   `thread_followup({ activate: true })` with exact `threadIds` or one `threadGroupId` instead of
   starting an unrelated replacement thread
8. if a handler asks the orchestrator to forward a correction or finding to siblings, decide whether
   the request is strategically valid and, if so, use `thread_followup` with the relevant
   `threadGroupId` or exact `threadIds`

### Handler Thread Loop

When the target surface is a handler thread:

1. understand the delegated objective and current thread state
2. decide and persist whether to:
   - reply directly inside the thread
   - use `execute_typescript`
   - request optional product guidance or capability through `load_extension`
   - inspect current group topology and sibling objective summaries through `thread_group` when that context materially helps the current objective
   - inspect generated Workflows exports through `svvyx workflows list`
   - inspect workflow-agent model options through `svvyx workflows models list`
   - edit workspace `.smithers/` source through ordinary coding tools
   - run official Smithers CLI commands through Shell
   - save reusable agents, prompts, components, or workflows through `svvyx workflows save`
   - rebuild reusable Workflows source through `svvyx workflows build`
   - ask the user for clarification through `request_user_input`
   - enter a runtime waiting state because of blocking request input, command approval, or another external dependency
   - emit an important intermediate update with `thread_report`
   - ask the orchestrator through `thread_report` to forward a correction or finding to sibling threads when direct sibling messaging is not available and group-wide coordination is needed
   - conclude the current objective with `thread_report` and `outcome`
3. continue local tool, Smithers CLI, and source-library work until the objective is truly finished
4. when appropriate, return control to the orchestrator by explicitly calling `thread_report` with `outcome`

When conclusion through `thread_report` succeeds, the ownership boundary has crossed because the durable conclusion episode and concluded objective state have been recorded. The orchestrator receives a typed `thread_report` notification in its ordered surface queue and should reconcile that recorded state in a fresh orchestrator turn. Intermediate update episodes use the same notification path without concluding the objective. If the orchestrator is already active, the notification waits in the same ordered surface queue as user follow-up messages.

If a thread already handed control back earlier:

- a direct follow-up question may be answered inside that same thread without reopening the orchestrator loop
- explicit orchestrator re-engagement through `thread_followup({ activate: true })` may move the concluded thread back to an active objective state for a new objective span
- each return to the orchestrator should produce another conclusion episode

### Clarification And Waiting

Waiting is local surface or workflow state, not a thread-control API status.

Two common cases matter:

- the main orchestrator surface needs clarification before it can decide how to proceed
- a handler thread needs clarification while supervising a delegated objective

In the adopted delegated model:

- if an orchestrator or handler thread needs clarification, it uses `request_user_input`
- the default `request_user_input` variant is nonblocking: the agent supplies a recommended/default answer, the tool immediately returns that default, and later user answers are delivered through the owning surface queue with priority over ordinary user messages
- the user may switch the builtin Request User Input extension into blocking mode; in that variant the same tool waits until the user answers or the five-minute default timer supplies the default answer
- if a handler thread needs clarification, it asks inside that thread
- the user's reply goes back to that same thread surface
- the orchestrator does not need to intermediate that clarification by default

There is no separate "wait episode" for delegated handler threads.

Blocking request input, execution approvals, and external dependencies may still project as waiting
state. The wait belongs in the owning surface until runnable work resumes or the handler thread
eventually emits another update or conclusion episode.

### Failures And Recovery

Command or Smithers CLI failure does not immediately return control to the orchestrator unless the handler thread decides it cannot repair the delegated objective confidently.

The intended behavior is:

- a command or Smithers CLI operation fails
- the handler thread works through repair locally
- the handler thread may inspect artifacts, inspect Smithers state through official CLI commands, edit `.smithers/` source, repair inputs, rerun commands, ask the user, or explicitly close the objective
- only explicit handler reports are returned to the orchestrator by default: update episodes or a conclusion episode plus concluded objective state

## UI And Surface Model

### Session Navigation

The session sidebar is workspace navigation, not a general folder manager.

It should show:

- pinned sessions first
- remaining sessions by recency under Sessions
- one Archived group for archived sessions
- handler thread rows nested under the session that owns them

Pinned, Sessions, and Archived use the same accordion header treatment. Each group owns a scrollable, vertically resizable space. The Archived group is collapsed by default, and group collapsed state and sizes are persisted per workspace.

Archiving is reversible and non-destructive. It must not delete durable session, thread, episode, artifact, or transcript data.

Session sidebar state is layered. Handler-local waits and active handler turns do not automatically change the parent session row's status or subtitle. Delegated-work repair is handler-owned local work, not parent-session error. `error` is reserved for row-local unrecoverable state that needs user action. The orchestrator row updates from explicit orchestrator-owned state and explicit `thread_report` reconciliation events.

Active row subtitles blink only for agent work that is currently running, not for waiting or error rows. If a row is doing agent work but has no useful subtitle to surface, it shows only a compact blinking ellipsis. Rows that are open in Dockview use local border/background treatment instead of a text badge, and that treatment follows the row's waiting or error tone. Open orchestrator and handler rows also show a compact context-budget rail along the bottom of the row.

### Command Palette And Quick Open

`svvy` should expose a VS Code-like shared palette model as a first-class shell capability.

The palette has one shell, one input, and one result interaction model. The leading `>` input prefix selects command mode. `Cmd+Shift+P` opens the shared palette with `>` already inserted, and command mode discovers and executes product actions, including New orchestrator creation and session switching, session pin/archive actions, opening focused session/thread/artifact/Workflows surfaces, handler-thread surfaces, pane and layout actions when panes exist, settings and Agents profile actions when those features exist, and future product actions as they are added.

`Cmd+P` opens the same shared palette with an empty input for reserved file quick-open mode. File
quick-open has disabled or empty results until file surfaces are part of the product contract.
Typing `>` into the quick-open input switches the already-open palette into command mode, and
deleting the prefix switches it back to quick-open behavior.

The command palette UI should use `cmdk-sv` from `https://www.cmdk-sv.com/` as the Svelte command menu primitive. Its docs describe it as a "fast, composable, unstyled command menu for Svelte." `cmdk-sv` is the renderer menu primitive, not the source of product routing, runtime behavior, or command semantics.

The command palette is a prefix-driven shell/action surface within the shared palette. It is not an alternate execution engine, standalone shell, custom terminal loop, readline loop, alternate TUI stack, or parallel workflow abstraction. Palette actions route into the existing product model: sessions, panes, surfaces, orchestrator and handler turns, durable state, settings, Workflows visibility, and Agents profiles.

Shell action controls that expose command-palette, quick-open, New orchestrator, sidebar, or pane actions use the product shortcut registry for user feedback and dispatch metadata. The registry owns stable shortcut action ids, labels, platform chords, compact and readable display strings, scope, input-typing policy, availability, and command routing metadata. TanStack Hotkeys is the renderer binding primitive that subscribes scoped shortcuts and applies the registry input policy; it is not the source of product command semantics. App launcher and shell command chords such as `Cmd+Shift+P`, `Cmd+P`, `Cmd+N` for New orchestrator in the focused pane, `Cmd+Shift+N` for New orchestrator in a new pane, sidebar toggle, `Cmd+Shift+1` for Logs, `Cmd+Shift+2` for Agents, `Cmd+Shift+3` for Context, and `Cmd+Shift+4` for Workflows remain available while workspace text inputs such as the composer are focused. Explicit labeled sidebar actions reveal compact in-button shortcuts immediately on hover or focus; the New orchestrator control also shows a delayed tooltip that explains click, `Cmd+N`, `Cmd`-click, `Cmd+Shift+N` placement, and profile-picker behavior. Icon-only or ambiguous controls may show explanatory action tooltips after 500 ms and include the readable shortcut when one exists. Native browser `title` tooltips are not the product feedback layer for these controls. Command palette and quick-open launchers live in the sidebar rather than duplicated in the top-right workspace chrome.

When the shared palette is in command mode and the text after `>` does not match an existing command
or action, pressing Enter creates a New orchestrator session and uses the text after `>` as the
initial prompt. That prompt enters the normal orchestrator turn model; it does not skip system
prompt loading, prompt history, structured turn state, or live surface runtime ownership. Text
entered without the leading `>` remains quick-open search text and does not create prompt sessions.

The default command-palette behavior is defined before choosing a Dockview target as normal current workspace and session routing. Once Dockview layout exists, placement rules belong to the pane-layout spec: command palette results that open sessions or surfaces default to a new Dockview panel, and `Cmd+Enter` opens into the currently focused panel.

### Surface Projection

`svvy` uses a Dockview-backed multi-pane desktop layout where:

- the main orchestrator surface can be opened in a Dockview panel
- a handler thread surface can be opened in a Dockview panel
- artifact, Workflows, Context, and related inspector surfaces can be opened in Dockview panels, tab groups, edge groups, floating groups, or popout groups when valid

The main orchestrator surface and a handler thread surface should use the same core interactive UI model:

- transcript
- composer
- tool activity
- artifacts
- status

Assistant transcript messages render Markdown suitable for coding-agent output, including compact prose, lists, tables, fenced code with syntax highlighting and copy actions, inline and block math, Mermaid diagrams, and escaped raw HTML rather than executable HTML. Long transcript surfaces use TanStack Virtual over system metadata, semantic projection cards, durable messages, tool rows, and active streaming rows so variable-height content preserves pane-local scroll anchors while following the bottom only when the user is pinned there. Live assistant output preserves each provider/runtime stream packet as a visible update, but the bridge sends compact ordered stream patches instead of full surface snapshots for every packet; full snapshots remain the baseline, recovery, and settled-state mechanism.

Message targeting is simple:

- sending a message from a panel sends it to the surface shown in that panel
- if the panel shows the orchestrator, the message goes to the orchestrator
- if the panel shows a handler thread, the message goes to that handler thread

This is shared surface behavior, not a thread-specific exception.

Projection ownership is equally simple:

- the backend owns durable workspace projection and live surface runtime ownership
- Dockview owns layout mechanics and serialized layout state
- the renderer owns panel bindings, panel focus projection, and panel-local view state
- the renderer listens for explicit workspace updates and surface updates, then joins them locally
- the renderer does not poll read APIs, inspect transcript files, or infer lifecycle changes from transcript mutations
- workspace-scoped backend requests and sync events route by explicit `workspaceId`, never by active workspace, focused panel, or current tab

Panel and surface semantics are:

- opening a Dockview panel attaches that panel to a surface
- closing a panel detaches that panel without deleting durable state
- closing the last owner of a surface releases that live surface runtime cleanly
- more than one panel may attach to the same surface
- duplicated panels share one underlying live surface state but may keep independent scroll position
- split, resize, close, tab reorder, panel/group drag/drop placement, Dockview focus, bindings, Dockview layout JSON, edge-group state, floating/popout state, and panel-local state persist across restart
- user workspace active layout choices and all initialized `A`/`B`/`C` layout snapshots keyed by `(workspaceId, layoutId)` persist across restart
On restart, the workspace shell should restore useful stable UI state:

- pinned and archived session state
- Archived group collapsed state
- open Dockview panels and panel-to-surface bindings
- focused panel
- panel-local scroll and display preferences
- explicit static inspector pane targets when the target still exists

It should not restore transient menus or popovers, unsaved inline edits outside the composer, selected transcript text, temporary search highlights, or stale live stream and tool-running state.

Composer draft text and chip-only attachments are durable surface state rather than transient UI restore state. They are saved live against the owning `surfacePiSessionId`, survive closing the surface and restarting the app, and clear only when submitted or explicitly emptied.

Backend recovery is separate from workspace shell UI restore. Each acquired workspace runtime owns one durable recovery coordinator for that workspace's sessions, pi surfaces, queues, initial handler starts, thread report notification delivery, report requests, waits, title jobs, and recovery observability. The coordinator uses durable owner scopes, idempotency keys, and transactional claims rather than active workspace, focused tab, focused panel, process cwd, or renderer state. App-global startup and workspace-tab restore decide which runtimes exist; they do not drain workspace queues or repair workspace product work directly.

## Product Outcomes

The design is successful when:

- the orchestrator remains strategically informed without being bloated by delegated-work internals
- delegated work happens inside handler threads that feel like real interactive surfaces
- Smithers workflow work uses official Smithers CLI commands and workspace `.smithers/` source without `svvy` wrappers
- reusable workflow material is saved once under `~/.config/svvy/workflows/` and consumed through generated `@svvy/workflows` namespace imports
- handler threads can repair, clarify, and rerun commands internally before returning control
- handed-back threads remain open for follow-up chat and explicit reactivation in the same delegated
  context
- the user can understand the current state of sessions, threads, and saved generated Workflows from durable state
- meaningful delegated work terminates in reusable episodes instead of transcript archaeology
- pi remains the runtime substrate and Smithers remains the workflow engine rather than replacing the product shell
