# Product Requirements Document

## Title

Ship `svvy` as an Electrobun desktop coding app with a pi-backed runtime, a visible `svvy`
orchestrator, pi-backed delegated handler threads, official Smithers CLI workflow execution, and a
runtime-owned task-agent bridge.

## Status

- Date: 2026-04-22
- Status: active product PRD
- Scope: this document defines the intended shipped product

## Product Summary

`svvy` is a desktop coding agent for working inside real repositories with visible orchestration instead of one opaque chat loop.

The product combines:

- an Electrobun desktop shell
- a pi-backed interactive runtime and session substrate
- a reusable package architecture whose non-UI packages can be driven programmatically without the desktop UI
- a `svvy` orchestrator that owns strategy, routing, and final decisions
- pi-backed delegated handler threads for bounded delegated objectives
- Smithers workflow authoring and execution through direct official Smithers CLI usage inside handler threads
- an app-global Workflows source library that generates reusable `@svvyx/workflows` imports
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
- inspect structured app logs with unread counts, filters, virtualized long-scroll browsing with stable scroll position during live updates, viewport-based read marking, redacted details, normalized errors, and related product links when app behavior needs attention
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
message submit -> durable queue commit -> queue wake/claim -> prompt defaults/binding read -> required generated-context refresh -> turn record commit -> pi stream -> streamed tool intent -> accepted tool call -> runtime command envelope -> extension handler -> ExtensionRuntimeOperation processing -> runtime_effect application / execution_plan execution -> state commit -> runtime notification/live patch -> UI refetch or stream rebaseline -> recovery scan
```

The target surface may be:

- the main orchestrator surface
- a delegated handler thread surface
- a workflow task-agent attempt surface created by the Smithers task-agent bridge

Everything the agent does is still driven through turns, tools, runtime handlers, and durable state.

The same execution model is available programmatically. Product runtime behavior lives below the UI
in reusable packages:

- `@svvy/core` defines shared ids, schemas, typed errors, read-model shapes, command fact envelopes,
  native-tool declaration shapes, typed runtime notification and stream-event contract shapes,
  `RuntimeEffectRequest` and `ExtensionExecutionPlan` contracts, schema-backed DTO codecs, and
  data-only function-style `Context.Service<PortIdentifier, PortService>(...)` port tags/contracts.
- `@svvy/state` owns SQLite-backed product state, transactions, projections, settings, app logs,
  generated package facts, queue rows, command facts, extension secret metadata/references and
  readiness rows, artifact metadata, redacted provider auth status rows, persisted pi session
  references, and the concrete Effect layers that implement
  the core-owned state ports. Runtime, extensions, pi-adapter, and sandbox consume only narrow
  core-owned state ports; desktop, browser-tool, and headless bridge edges consume approved state
  read facades and command facades supplied by app bootstrap. No consumer imports `StateStore`,
  repositories, SQL helpers, transaction helpers, migration helpers, table helpers, SQLite
  implementation details, or restricted structured-session wiring subpaths except product app
  bootstrap and state tests.
- `@svvy/sandbox` turns immutable policy snapshots into filesystem/network launch constraints and
  sandbox-denial classification. Its package root exposes the sandbox Effect service, root layer,
  and sandbox-owned contracts. Runtime-owned launch paths acquire scoped launch facts through the
  package-private `RuntimeLaunchPolicyService`, which delegates to `Sandbox.buildLaunchPolicy(...)`
  over the state-backed `SandboxPolicySource` plus app/bootstrap-supplied packaged helper and host
  support ports. App-entry modules may compose sandbox layers and provide host support, but do not
  synthesize sandbox policy, assemble helper argv, or own Shell/Apply Patch/Execute TypeScript
  launch semantics.
- `@svvy/pi-adapter` adapts pi sessions, true `systemPrompt` delivery, turns, model metadata, helper
  jobs, redacted model availability from `ProviderAuthStatusStatePort`, live credential snapshots
  from `ProviderAuthPort`, exact provider-auth missing/expired/refresh-failed errors, and pi event
  streams into `svvy` contracts without leaking pi-native objects. Its public package root exports
  only the `PiAdapter` Effect service and `layer`; the restricted public subpaths are
  `@svvy/pi-adapter/session` and `@svvy/pi-adapter/messages` for app-bootstrap catalog binding.
  `@svvy/pi-adapter` does not expose a Promise facade or desktop/headless event subscription API.
- `@svvy/extensions` owns extension source, builtin capability records, package-owned
  prompt/instruction assets, workflow prompt source contributors, generated actor context,
  MDX/source prompt and instruction contributors, native tool metadata and handlers, request-input
  question validation and default-answer derivation, `svvyx` dispatch, generated
  `execute_typescript` facade declarations, and generated `@svvyx/workflows` /
  `@svvyx/extensions` package production. Extension handlers
  return one model-facing tool result plus ordered `ExtensionRuntimeOperation` items wrapping closed
  `RuntimeEffectRequest` values or immutable `ExtensionExecutionPlan` values; they do not write product state,
  publish runtime events, own durable command sessions, or execute runtime-owned
  subprocess/file/approval work directly. Those generated packages are not reusable SDKs and are not
  `execute_typescript` runtime facades.
  Extension generated-package refresh writes files and returns build evidence only. Runtime
  separately asks `@svvy/extensions` for an immutable workspace-link plan for each targeted
  workspace/package pair, then applies that plan. Extensions never mutate workspace
  `.smithers/node_modules/@svvyx/*`, write generated-package state facts directly, or emit
  runtime/read-model notifications.
- `@svvy/runtime` owns prompt submission, queue claiming, turn execution, prompt refresh,
  handler-thread lifecycle, `thread_start` durable handler-thread creation, first-turn queue
  insertion, accepted native-tool execution, native-tool approval admission and waiting,
  extension handler invocation,
  `RuntimeEffectRequest` application, immutable execution-plan execution, request-input record
  creation, request-input waiting, timeout completion, the request-input answer API, answer
  recording, nonblocking queued answer delivery, generated-package refresh scheduling, source
  invalidation committed-scan event application, recovery, title jobs, command tracking, and
  runtime event publication. Runtime schedules and applies generated-package link repair, writes
  and commits generated-package facts through core-owned state ports implemented by `@svvy/state`,
  and turns after-commit descriptors into typed runtime notifications.
- `@svvy/desktop` is one consumer of the runtime through app/bootstrap. It sends runtime requests
  through renderer-safe facades, receives renderer-safe notifications that app/bootstrap derives by
  subscribing to runtime events, refetches read models from state, and renders the result.
  App/bootstrap owns runtime event subscription, sequencing, buffering, and fanout to renderer
  bridges. Desktop imports only renderer-safe runtime facade plus state read/command facades
  injected by app bootstrap; it does not create ManagedRuntimes, import package-private services,
  subscribe to package-private runtime services directly, or own queue, prompt, state, recovery, or
  generated-package semantics.

Non-UI packages use Effect v4 services and layers for package-to-package composition, scoped
resource lifetimes, typed errors, streams, schedules, queues, subprocesses, and test layers. App
bootstrap composes the package layers once, creates exactly one app-owned `ManagedRuntime` per
healthy app-runtime instance, disposes the current runtime before constructing its successor, awaits
`managedRuntime.context()` and the runtime-owned startup readiness effect before exposing facades,
and owns final shutdown preparation plus disposal. Desktop, browser tools, and headless automation
use small Promise, callback, and closeable `AsyncIterable` subscription facades over that scoped
app-bootstrap runtime;
those facades do not contain queue claiming, prompt dispatch, tool execution, state mutation, or
recovery policy. No package, renderer module, or request handler creates a package-level runtime or
per-request layer graph.
The active Effect authority is the installed `effect@4.0.0-beta.84` stack named by
`docs/specs/package-architecture/effect-v4.spec.md`; reference snapshots are not API authority
without installed-export coverage. Host environment reads are authority-bearing app/host edge work:
package code consumes typed config or host ports supplied by app/bootstrap, and generated packages,
extensions, runtime, state, desktop, and renderer modules do not read ambient process env for
product authority except where an owning package spec names the exact app-edge config reader.

Effect service/layer behavior is promoted only when the implementation method is covered by the
dedicated `bun run test:effect` lane using `@effect/vitest`; `bun run check` already runs both
`test:unit` and `test:effect` before lint, format, and production build. Package-boundary checks
keep Effect service/layer tests out of the Bun unit lane except for SQLite-backed `@svvy/state`
tests that directly or transitively depend on the active `bun:sqlite` adapter. Those state tests
stay in the Bun unit lane while that adapter is active, still test Effect-returning APIs, and still
avoid manual runtime creation except for the named state facade test harness that proves the
JavaScript facade edge over an explicitly supplied test `ManagedRuntime`. That exception is not
production app/bootstrap behavior. Pure schema, pure contract, generated-boundary, and
package-boundary tests may remain in `test:unit`.

The package API shape is explicit:

- each package exports exactly the service tags, named layers, root layers, and facades named by its
  package spec; `@svvy/state` intentionally exposes state ports, read facades, command facades, and
  layers instead of one public umbrella state service
- `@svvy/runtime` exports `Runtime`, `Runtime.layer`, `layer`, and `createRuntimeFacade(...)`;
  `Runtime` is the product service class implemented as an Effect v4 `Context.Service` selector,
  not an Effect runtime execution value. `Runtime.layer` is the package-owned production layer that
  provides the `Runtime` service, runtime startup readiness, runtime shutdown preparation, and the
  core-owned `StateCommandPostCommitNotificationPort` through runtime-owned internal services. The
  public `@svvy/runtime/bootstrap` subpath is limited to runtime app-composition primitives named by
  the runtime spec: runtime-layer config schemas/helpers, Bun platform composition, startup
  readiness and shutdown helpers, and primitive host-port tags for prompt cancellation, surface
  queue wake, command stdin/control, provider-auth/model lookup, generated-context refresh,
  generated-package refresh, and source invalidation scan. These bootstrap ports adapt app/host
  capabilities into the already owned app runtime; runtime still owns queue policy, command
  lifecycle, source scheduling, generated-package repair, event publication, accepted-tool
  execution, recovery, and request/approval semantics. The Smithers task-agent
  loopback bridge is an app-bootstrap binding around the runtime-owned authenticated `runTaskAgent`
  path, not a public bootstrap export. Runtime semantic ports, accepted tool helpers, wait
  registries, source coordinators, queue dispatchers, generated-package repair helpers, runtime
  scope services, and app/browser/headless facade adapters are not public bootstrap exports.
  The public `@svvy/runtime/accepted-native-tool-execution` subpath is the only app-bootstrap
  adapter for accepted native-tool execution, including direct-tool approval admission. It exports Promise functions that take the already
  acquired app-owned `ManagedRuntime` and run the package-private accepted native-tool service
  inside that runtime; it does not export the service tag, service interface, layer, dispatcher,
  extension handler, runtime-effect applier, or a desktop/headless facade group.
  The public `@svvy/runtime/app-log-commit-notification-adapter` subpath is the only app-bootstrap
  adapter for a real committed append observed through a state-owned app-log facade subscription.
  App/bootstrap supplies only the owning app-global scope or `workspaceId`; the package-private
  runtime service constructs the fixed `appLogs` invalidation and publishes it through the runtime
  event bus. The adapter accepts no raw descriptor, read-model name, event, receipt, renderer target,
  or retry instruction and does not add a `Runtime`/facade group.
  The public `@svvy/runtime/committed-state-invalidation-adapter` subpath is the narrow
  app-bootstrap session-catalog edge for exact `afterCommit` descriptors returned by the named
  state-owned catalog mutation adapter after a concrete structured-session write commits. Runtime
  publishes those unchanged descriptors through its event bus. Catalog writes retain unaccepted
  descriptor batches for retry or consumer rebaseline, and publication failure never reports the
  committed write as rolled back. Renderer, desktop, browser-tool, headless, extension, and
  generated-package callers cannot invoke this adapter or supply descriptors.
  The public `@svvy/runtime/source-invalidation-coordinator-adapter` subpath is the only
  app-bootstrap adapter for runtime-owned source-invalidation coordinator handles. It exports the
  handle type, handle options type, and `createRuntimeSourceInvalidationCoordinatorHandle(...)`
  factory used by app/bootstrap source-root and workspace-scope binding code; it does not export the
  coordinator service/tag/layer, watcher tables, source policy, state writers, descriptor
  publishers, generated refresh services, or a desktop/headless facade group.
- `RuntimeEffectRequest` and `ExtensionExecutionPlan` are closed core algebras wrapped in
  `ExtensionRuntimeOperation` items returned by extension handlers; runtime applies effect requests
  and executes plans only inside runtime-owned ordered lanes
- public facades expose the same named groups as the runtime service, such as
  `runtime.workspaces.acquire(...)`, `runtime.surfaces.open(...)`,
  `runtime.messages.submit(...)`, `runtime.messages.abort(...)`, `runtime.queues.steer(...)`,
  `runtime.commands.writeStdin(...)`, `runtime.commands.cancel(...)`,
  `runtime.approvals.answer(...)`, `runtime.requestInput.answer(...)`,
  `runtime.sourceEdits.open(...)`, `runtime.sourceInvalidation.applyCommittedScanEvent(...)`,
  `runtime.events.subscribe(...)`, and `runtime.close()`; facade calls use the runtime-owned
  normalized error contract, call options for edge cancellation/metadata, and closeable
  subscription handles. Callers never submit raw `RuntimeEffectRequest` envelopes
- the authenticated `runTaskAgent` workflow task-agent bridge is not a general public facade group;
  runtime owns one command-scoped loopback endpoint and injects its URL/token only into eligible
  Smithers task-agent command environments

The public composer/runtime message API accepts a user-messageable orchestrator or handler target,
one new user message, delivery intent, and optional client submission metadata. Callers do not
submit pi message arrays, `systemPrompt` content, generated-context previews, extension id lists,
renderer transcript state, UI snapshots, or workflow task-agent attempt targets. Runtime reads
durable surface state, model settings, prompt bindings, extension usage, and queue state from
`@svvy/state`; sends the new user text through `@svvy/pi-adapter`; and publishes typed notification
events. Internal runtime-owned queue contracts cover Smithers task-agent bridge work and
runtime/coordinator control rows that target workflow task-agent attempts. Consumers refetch
authoritative read models after notifications instead of treating runtime events as durable state
snapshots.

Tool use must project live through the same execution model. When a model starts a tool call, the UI
renders the correct execution-span card immediately, updates large arguments progressively while
they are being generated, streams runtime output or progress while the handler runs, and then settles
the span from the authoritative final command facts. The collapsed span answers what ran, where it
acted, what state it reached, how long it took, and the useful outcome. The expanded span shows
nearby semantic sections such as accepted arguments, command target, file changes, diagnostics,
progress, grouped stdout/stderr, and child commands, while the card exposes linked artifact actions
when artifacts exist. The inspector remains the
full trace/debugger for raw command lifecycle events, complete output, facts, snapshots, and artifacts. `apply_patch`
uses a Codex-like structured file-change projection with patch snapshots; `exec_command` uses
grouped command output deltas; `execute_typescript` uses source, diagnostic, runtime, and
child-command projection. This is not achieved by asking the agent to split coherent work into many
tiny tool calls.

Before any target surface runs a turn through pi:

- `svvy` must compose that surface's actor prompt from the current generated agent context and load the resulting instructions through pi's real `systemPrompt` channel
- `svvy` must ignore pi prompt replacement and append files such as `.pi/SYSTEM.md` and `APPEND_SYSTEM.md`, while preserving discovered `AGENTS.md` and `CLAUDE.md` files as read-only `external_instruction` records in the actual prompt path
- the submitted prompt body is the real new user message for that surface; `svvy` does not repair or advance a surface by flattening prior messages into role-labelled transcript prose
- committed conversation history stays in pi's session history, while runtime, thread, episode,
  report-request, and svvy-observed workflow facts stay in structured state and targeted tools;
  Smithers workflow graph execution and workflow/run state remain Smithers-owned
- the UI should project the active system prompt as expandable surface metadata rather than as inline transcript prose, and should warn when a surface is bound to an older prompt revision than current settings
- each surface must receive only the generated tool declarations and `execute_typescript` facade declarations present in that surface's resolved extension binding and native runtime surface
- each surface may receive compact knowledge about what another surface commonly does, but it must not receive that other surface's full callable API block just for awareness
- handler threads may start with a product-filtered inherited-history section from the orchestrator
  when `thread_start.threads[].history` is `forked`. That inherited-history section is delivered as
  a product-authored context block inside the handler's first prompt-bearing start item for
  reproducibility. It is not reconstructed as separate prior handler turns, not written into the
  handler system prompt, and not shared pi transcript state. It does not create shared tools or
  continuing access to orchestrator-only callable surfaces.

Ambient coding-agent resources are default-off unless explicitly enabled through `svvy` settings. This applies to pi resources such as extensions, skills, prompt templates, themes, packages, slash commands, hooks, provider adapters, credentials, and execution-policy settings, and to equivalent resources exposed by other coding-agent hosts. This default-off rule applies to imported or host-ambient resources, not to app-owned builtin extensions whose default usage is explicitly defined in product specs and profile settings. The current builtin prompt-only defaults are cx and Git loaded by default for all adopted agent kinds, Web loaded by default for all adopted agent kinds only while `networkAccess` is enabled, GitHub loaded by default for orchestrators and handler threads while available for workflow task agents, and Smithers loaded by default for handler threads as prompt-only official CLI guidance. The builtin Workflows extension is loaded by default for handler threads as the app-owned `svvyx workflows ...` source-library command family. `svvy` preserves plain external instruction files such as discovered `AGENTS.md` and `CLAUDE.md` as visible generated agent context through read-only external instruction records, but behavior-changing ambient resources must be enabled by category, source, host, workspace, and target agent/profile configuration before they can affect prompts, tools, commands, UI, provider behavior, auth, or execution policy. Enabled callable resources must still appear in the resolved generated declaration block for the exact actor session or task attempt that may call them.

Extension env values are app-managed per extension. Secret values are keyed by `(extensionId, envName)`, entered only through user-owned app UI, stored as encrypted or OS-protected material in the host secret store under state-generated references, injected only into the specific trusted extension runtime invocation that needs them, and never exposed to agents through prompts, generated docs, tool output, logs, artifacts, transcripts, global pi env, global shell env, or `execute_typescript` snippet env. `@svvy/state` stores only secret references, metadata, readiness/status rows, and redacted revision facts in SQLite while its user-entry command facades coordinate host secret-store writes/removals through the core-owned mutation-only `SecretStoreMutationPort`; trusted invocation paths resolve values through the read/resolve `SecretStorePort`. Agent-facing extension inspection may report only declaration metadata and missing/configured readiness. Workspace-scoped extension env values and egress-proxy credential boundaries are not shipped product behavior.

Agents and Extensions are the user-facing source of reusable prompt material and capability composition. Agent profiles contain actor kind, model/reasoning, sparse extension usage overrides for values that differ from the resolved actor/profile defaults, and an optional per-profile extension instruction order. Actor prompts do not accept profile-local instruction blobs: orchestrators and handler threads receive instructions only from their resolved extensions and external instruction records. The only non-extension instruction input is a workflow-agent row's individual instruction textarea, and that text is prepended ahead of the workflow task-agent generated extension context. Each Agents-pane extension usage row links to the matching record in the Extensions inventory. The composer footer exposes the same extension usage control beside model and reasoning so an active orchestrator or handler-thread surface can request a runtime/state-backed update to its bound loaded/available/unavailable extension state; orchestrator surfaces using a profile with Follow composer enabled save composer extension changes back to that profile in the same way as composer model and reasoning changes. Expanded orchestrator, handler, and workflow task-agent profile rows show one extension list with name, description, usage controls, extension link, active-row generated token estimates in an aligned column, available-row estimates for the available prompt plus the would-be loaded prompt in parentheses, expandable generated instruction text, Off rows moved to the end without token counts, active rows draggable into the order their instructions enter the generated actor context, drag-only movement animation, stable in-place Loaded/Available/Off UI state updates, underlined extension names for true usage overrides, a tooltiped icon button for overridden orchestrator and workflow task-agent rows that appears in compact menus and immediately before expanded Loaded/Available/Off UI controls to promote the row's current state to the default for newly created surfaces of that actor kind, and actor-level reset controls for default extension selection and default instruction order with the total generated prompt token estimate on that toolbar. Workflow-agent rows use the same compact profile bar affordances as orchestrator rows for model/reasoning, extension usage, duplication, deletion, and creation, while keeping their individual instruction textarea, autosaving textarea edits with an icon-only unsaved/saving/saved state inside the input without dimming unrelated row controls, showing that inline instruction's live token estimate on the source-file metadata line only when the row is expanded, adding a link to the underlying `.agent.json` source file, and including the current inline instruction draft in the expanded total prompt estimate. Workflow-agent `.agent.json` edits use shared file-backed edit-session conflict control: each editor save carries the source version it was based on, source-owner saves compare that version against the current file and `@svvy/state` source-version row, stale saves stop autosync and show a warning icon without replacing the local draft, and the warning opens three tooltiped actions to keep editing, discard local changes in favor of the external file, or explicitly overwrite the external file. The default Explorer, Implementer, and Reviewer workflow agents are builtin defaults that may be edited and duplicated but not deleted.

Every normal builtin or user extension has the same composable shape: an editable minimal MDX instruction source used as its available/loading hint (except fixed always-loaded Extension Loading, which may omit it), zero or more loaded instruction contributors, optional CLI requirements, optional native tool schema, optional `svvyx` command source plus generated command schema, generated `execute_typescript` facade declarations only for app-owned builtin TypeScript-enabled `svvyx` extensions, reset/delete behavior, customized tags, inventory filters, and readiness state. Loaded instruction contributors are either editable MDX source files or scripted instruction contributors. A scripted instruction contributor is one editable TypeScript generator source paired with the read-only generated Markdown/plain prompt output from the last successful generation, plus a regenerate action that runs the extension build path. Direct builtin prompt text, including base actor prompts and native-tool guidance, is exposed as editable MDX loaded source contributors rather than generated-script output. Generated Markdown/plain prompt text is never an independent top-level source type: users and agents customize the MDX source file, generator script, manifest, extension source, CLI requirement, or package state, then regenerate/build. Loaded generated actor context receives one concatenated plain prompt-text block per loaded extension from non-bypassed loaded contributors after MDX/generator output is compiled.

Normal builtin and user extension sources are real local files under `~/.config/svvy/extensions/sources/...`: builtin sources live under `sources/builtin/<id>/`, user sources under `sources/user/<id>/`. Packaged app defaults are read-only templates used only to scaffold missing builtin source and to reset builtin source back to its default state. For normal source-backed `svvyx` extensions, `source/index.ts` is the editable command source; `commands.json` is generated build output that enters generated prompt/tool context. App-owned builtin command namespaces may instead expose a read-only generated command contract from product code when their runtime is implemented directly by `svvy`. Extension Managing is that kind of app-owned builtin `svvyx` namespace: it is reached through Shell as `svvyx extensions ...`, has no native tool schema, and has no editable runtime `source/index.ts`. Generated `execute_typescript` facade declarations are separate generated artifacts for app-owned builtin TypeScript-enabled `svvyx` extensions; they expose typed injected facades through `execute_typescript` and are not command schemas. User `svvyx` extensions do not contribute generated `execute_typescript` facades.

External instruction records are deliberately separate from normal extensions. Discovered files such as `AGENTS.md` and `CLAUDE.md` are read-only external instruction inputs owned outside `svvy`; they have no minimal hint, no editable source lifecycle, no scripted contributors, no reset/delete lifecycle, and only expose file content, read status, and actor enablement controls. Base actor prompts are normal builtin instruction extensions: `base-common` is loaded by default for all adopted actor kinds, while `base-orchestrator`, `base-handler`, and `base-workflow-task` are loaded by default by the corresponding default profile. Other extension default usage is profile policy for subsequently created orchestrator sessions and workflow task-agent attempts only; the singleton handler profile remains owned by Agents and can still be customized there. Changing defaults must not rewrite the bound generated context of an existing surface except through the normal out-of-date fingerprint refresh flow. Extension loaded instruction text is actor-agnostic; actor-specific behavior is represented by separate extension records, such as `base-orchestrator` versus `base-handler` or `thread-orchestration` versus `thread-handling`, and profile defaults decide which actor loads each extension. New user extensions start in the loaded default state for new orchestrators and workflow task agents unless the user changes their per-actor defaults before use. Extension snapshots include a saved Initial baseline when no local snapshots exist, while user-named snapshots preserve local source, package, usage, ordered contributors, bypass/default state, customized tags, generated-contributor source/output state, and coarse secret-state restore points. New orchestrator sessions, handler threads, and workflow task agents bind to the latest ready generated agent context. Existing surfaces store the generated agent context fingerprint they received and refresh at the next safe pre-dispatch boundary only when their checked-by-default update-before-next-turn intent is enabled; opted-out surfaces keep running with their bound context and remain visibly stale.

File-backed source inputs refresh through `@svvy/runtime` source invalidation coordinators, not
through renderer panes. One app-global coordinator watches Workflows and Extensions source roots,
performs app-global generated-package refresh, wakes link repair for acquired workspace runtime
scopes, and records repair-needed facts plus recovery work for unopened workspaces. One workspace
coordinator per acquired workspace watches external instruction
candidates and discovered read-only host snippet Markdown sources for that workspace. Low-level file
watcher events are only hints that schedule deterministic fingerprint scans; source fingerprints,
validation results, generated build facts, and state commits are authoritative. App-global agent
settings, profile settings, and managed svvy snippets are DB/product-state-backed writes owned by
`@svvy/state`; they are not watched as file-backed sources and they do not enter runtime through
public raw invalidation descriptors. Coordinators never watch generated output such as generated
`@svvyx/workflows` output, generated `@svvyx/extensions` output, extension build directories, or
workspace `.smithers/node_modules/@svvyx/*` links as triggers. App-global generated-package refresh
must not run once per workspace runtime scope;
workspace runtime scopes repair only their own package links after the app-global generated-package facts
commit.

When a source fingerprint changes, runtime reconciles the smallest affected file-backed source state:
workflow-agent source records are reread and validated by `@svvy/extensions`; runtime schedules
app-global generated-package refresh, rebuilding `@svvyx/extensions` when extension references
change and then rebuilding `@svvyx/workflows`; extension source refreshes inventory and generated
declarations and triggers Workflows validation when needed; external instruction changes refresh
Extensions inventory rows, generated-context previews, and current aggregate fingerprints. When a
DB-backed product write commits, `@svvy/state` commits the facts in the same transaction and returns
internal `afterCommit` descriptors to the runtime-owned publication boundary. Runtime maps those
committed descriptors to typed read-model invalidation notifications. App/bootstrap sequences,
buffers, and fans out renderer-safe notifications; consumers refetch read models from state.
Public runtime facades never accept a raw `StateInvalidationDescriptor`, and state does not publish
runtime events directly. Existing open surface bindings are not rewritten by invalidation. Invalid or
unreadable file-backed source is surfaced as diagnostics while the previous ready generated output
remains active. Existing surfaces become stale only when their bound
generated-context fingerprint differs from the current fingerprint, and opted-in stale surfaces
refresh at the next safe pre-dispatch boundary.

The default actor-specific generated context split is:

- the orchestrator prompt knows that workflow action normally belongs in a delegated handler thread; Smithers and Workflows are available to orchestrators but not loaded by default in the default orchestrator profile
- a handler-thread prompt receives prompt-only Smithers CLI guidance, the Workflows `svvyx` command family, `load_extension`, `list_extensions`, `request_user_input`, `thread_current`, `thread_group`, `thread_report`, `thread_episodes`, direct tools, and `execute_typescript` for typed composition by default; `thread_start` is not part of the default adopted handler model
- the orchestrator prompt receives `request_user_input`, `thread_start`, `thread_followup`,
  `thread_list`, `thread_episodes`, and `thread_request_report` so user clarification,
  delegated-thread state, durable thread groups, durable episodes, handler follow-ups, handler
  reactivation, and handler status requests are handled through focused tools instead of prompt
  stuffing
- a workflow-task-agent prompt receives task-local instructions and task-local callable declarations;
  in the default adopted workflow-agent parameter record it receives Extension Loading, prompt-only
  cx and Git guidance, prompt-only Web guidance while network access is enabled, task-local direct
  tools, and `execute_typescript`, while Smithers, Workflows, Extension Managing, GitHub
  loaded-by-default behavior, and broad handler/orchestrator controls are not loaded by default
- a workflow-task-agent runtime must not load ambient pi built-in tools, extensions, skills, prompt templates, themes, commands, hooks, provider adapters, or equivalent host resources unless the user enables that exact resource category and source for workflow task agents
- user-configured extension usage overrides remain the source of truth for loaded, available, and unavailable extensions; setting an extension back to the resolved actor/profile default removes the stored override, and Extension Loading is the only fixed always-loaded extension control
- Smithers execution uses official Smithers CLI commands through Shell; those shell commands project
  as normal command-family `exec_command` work. `svvyx workflows ...` is reserved for reusable
  source-library operations and generated `@svvyx/workflows` imports.

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
```

The editable source directories are:

- `agents/` for structured `.agent.json` task-agent parameter records
- `prompts/` for reusable workflow MDX prompt source contributors managed by `@svvy/extensions`
- `components/` for direct TypeScript or TSX Smithers components and helpers
- `workflows/` for direct TSX reusable workflow modules

Generated package roots are app-owned read-only output roots resolved through the
`@svvy/extensions` package-owned `GeneratedPackageRootPort`, separate from the Workflows source tree.
Agents and auto-review must treat direct edits to generated Workflows output as invalid. The correct
edit path is to change source and rebuild, or to use `svvyx workflows save`. Runtime grants
generated-root writes only to explicit app-owned generated-package build/link refresh work; approval
decisions never infer generated-root write access from command-string inspection.

`svvyx workflows build` requests runtime-owned generated-package refresh for both canonical
generated packages, `@svvyx/extensions` and `@svvyx/workflows`. Their app-owned generated roots are
resolved through the `@svvy/extensions` package-owned `GeneratedPackageRootPort`; product code and
docs must not derive those roots from `~/.config/svvy/workflows`.

The generated Workflows source-library package name is `@svvyx/workflows`. Its agent-facing
generated export surface contains only namespace objects `Agents`, `Components`, `Prompts`, and
`Workflows`. Generated package values do not carry app metadata, runtime facades, Effect services, or
source ownership.

Persistent reusable workflow source must not import the generated `@svvyx/workflows` package it
will later produce. `@svvy/extensions` validates reusable workflow imports before writing generated
output: app-owned type-contract imports, Smithers authoring imports, and generated-package-link
imports are allowed only in the exact source contexts named by the generated-package spec, while
self-imports from persistent Workflows source fail closed with diagnostics and keep the previous
ready generated package active. Generated `@svvyx/workflows` type evidence comes from a
declaration-only app-owned core type-contract package recorded as
`manifestDependency: "dev-type-dependency"` / `"app-owned-type-contract"`. Generated packages must
not depend on repo-root `packages/core`, workspace-protocol core packages, registry `@svvy/core`, or
runtime imports.

```ts
import { Agents, Components, Prompts, Workflows } from "@svvyx/workflows";
```

Reusable values are accessed through those namespaces, for example `Agents.defaultAgent`, `Agents.reviewerAgent`, `Agents.implementerAgent`, `Agents.explorerAgent`, `Components.SomeComponent`, `Prompts.somePrompt`, and `Workflows.someWorkflow`. `Agents.*` generated agent exports are persisted `TaskAgentParametersSource` records from `~/.config/svvy/workflows/agents/*.agent.json`. `Agents.defineTaskAgent` and type `Agents.TaskAgentParametersSource` also live under `Agents.*` so agent usage stays uniform.

Smithers task usage passes the generated parameter record into `Agents.defineTaskAgent`, which returns the Smithers-compatible `AgentLike` value intended for `<Task agent={...}>`:

```tsx
import { Task } from "smithers-orchestrator";
import { Agents } from "@svvyx/workflows";

const reviewer = Agents.defineTaskAgent(Agents.reviewerAgent);

export default (
  <Task id="review" agent={reviewer}>
    Review the diff.
  </Task>
);
```

Direct parameters are also valid when the workflow source owns the task-agent configuration:

```tsx
import { Task } from "smithers-orchestrator";
import { Agents } from "@svvyx/workflows";

const explorer = Agents.defineTaskAgent({
  id: "explore",
  label: "Explorer",
  provider: "openai",
  model: "<model-id-from-pi-metadata>",
  reasoning: { effort: "medium" },
  instructions: "Explore the requested area and return concise findings.",
});

export default (
  <Task id="explore" agent={explorer}>
    Map the relevant code paths.
  </Task>
);
```

The returned `AgentLike` runs through a narrow authenticated workflow task-agent bridge back into
the `svvy` app process. Official Smithers CLI workflow code runs in a child process and Smithers
continues to own workflow graph execution, task scheduling, and workflow/run state. App/bootstrap
binds the local command-scoped loopback route for `POST /runTaskAgent`; that transport binding is not the
generated-package runtime-service adapter. `@svvy/runtime` owns the authenticated `runTaskAgent`
bridge operation semantics: decoded token-lineage authorization,
workflow-task-attempt surface creation, queueing, command facts, recovery, notifications, and pi
turn orchestration. `@svvy/state` owns durable command facts, task-attempt surface facts, recovery
facts, read-model projections, and CLI-observed Smithers facts. `@svvy/pi-adapter` owns the pi
session creation and turn adaptation used by each task-agent call. Sandbox policy and approval facts
flow through the same runtime/state command path as other handler-thread commands. Model ids shown in
workflow snippets are non-authoritative examples; shipped defaults and validation come exclusively
from pi-normalized provider/model metadata.

The bridge is scoped to one operation, `runTaskAgent`, and its command-scoped bridge environment is
injected only into handler-thread `exec_command` child environments that have an active structured
source command id. The injection is not based on Smithers command-string parsing, binary shadowing,
or a user-facing `svvy` command. It carries an unguessable app-owned auth token plus the local bridge
endpoint, the owning `workspaceSessionId`, and the source `exec_command` id as `sourceCommandId`.
Generated `@svvyx/workflows` code sends `RunTaskAgentSourceInput`, a plain source DTO carrying the
task-agent parameters, required Smithers task-attempt identity
`{ runId, nodeId, iteration, attempt }`, optional observed Smithers context `{ run, node, rootDir }`,
exactly one prompt source as either a prompt string or a non-empty user/assistant message list,
`workspaceSessionId`, and `sourceCommandId`. Runtime enforces configured bridge request and response
byte limits, validates that source DTO into the branded
`RunTaskAgentInput` before token authorization, durable idempotency, state writes, command facts, or
pi orchestration. The bridge result contract is
`{ text: string; usage?: JsonValue; output?: JsonValue }`; `output` is present only when structured
task output exists. Multiple task agents may call
the bridge concurrently; each call is bound to one workflow-task-attempt surface. The bridge exposes
no arbitrary app RPC, shell, settings, orchestrator, handler-thread, or workflow-control operations
and does not duplicate Smithers workflow/run state.

When the app opens or prepares a workspace with `.smithers/`, it idempotently links both generated
packages into the workspace-local Smithers package-resolution root:

```text
<workspace>/.smithers/node_modules/@svvyx/workflows
<workspace>/.smithers/node_modules/@svvyx/extensions
```

These links are internal package-resolution plumbing, not user-facing commands and not editable
workspace copies. The app must not rely on ambient global package resolution, `NODE_PATH`, parent
repository `node_modules`, or a source-checkout-relative package path.

The Workflows extension is the only app-owned command surface for this source library:

```bash
svvyx workflows list [--kind agent|prompt|component|workflow] --json
svvyx workflows save --from <path> --kind agent|prompt|component|workflow [--export <name>] --as <exportName> [--overwrite] --json
svvyx workflows build --json
svvyx workflows models list --json
```

It is not a Smithers runner. There is no `install`, `retrieve`, `promote`, kind-specific list
subcommand, or product command for Smithers workflow execution.

`svvyx workflows list` returns mechanically available export identity and paths only. It must not infer titles, summaries, usefulness, or recommendations.

`svvyx workflows save` copies or extracts reusable source into `~/.config/svvy/workflows/`. It
fails if it would overwrite an existing source item unless `--overwrite` is present. A successful
save returns a model-facing command result; the handler result also carries one ordered
`ExtensionRuntimeOperation` wrapping a `generated_packages.refresh` `RuntimeEffectRequest`. Runtime
applies that operation in the generated-package lane before the saved item is import-ready.

`svvyx workflows build` returns a model-facing command result plus one ordered
`ExtensionRuntimeOperation` wrapping `generated_packages.refresh` for both canonical packages.
`@svvy/runtime` applies that closed request in the runtime-owned generated-package refresh lane,
calls `Extensions.generatedPackages.refresh(...)`, records generated-package facts through state
ports after atomic output replacement, and only then schedules workspace-link repair for acquired
workspaces. The Workflows extension command itself does not build generated roots, record state
facts, apply workspace links, or publish invalidations.

`svvyx workflows models list --json` returns provider/model/reasoning choices from the same pi-normalized provider metadata and usable auth state used by the Agents pane. Expired OAuth and OAuth whose refresh failed remains visible as connected credential state but is not usable model auth. Build-time validation must fail explicitly when an agent parameter record names a provider/model/reasoning combination or extension reference that is not available under that registry. It must not silently clamp, rewrite, or defer those errors to runtime.

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
supported. It does not add native `cx_*` tools, `svvyx cx`, or generated TypeScript facades. Agents
run the official CLI through `exec_command`. The normal inspection ladder is:

```text
cx overview -> cx symbols -> cx definition / cx references -> exec_command with rg/sed/cat/ls/find
```

The builtin cx instructions are loaded by default for orchestrators, handler threads, and workflow task
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
instruction file and one separate Incur facade usage file.

That includes:

- batching loaded-extension calls
- looping over many structured extension results
- filtering and aggregating already available structured output
- producing durable artifact evidence from composed results

Inside `execute_typescript`, the runtime exposes an actor-specific injected `extensions` object.

`extensions` contains only loaded TypeScript-enabled builtin app-owned generated TypeScript facades
that are callable by the current actor, such as Artifacts and Workflows. User `svvyx` extensions do
not contribute `execute_typescript` facades. If the actor has loaded builtin facades
`artifacts` and `workflows`, the generated declarations and instructions include only
`extensions.artifacts` and `extensions.workflows` plus those facades' command types and
command-specific guidance. There is no global `svvy` client and no broad injected `api` helper
surface.

Injected extension facades use the Incur-compatible shape
`extensions.<extensionId>.run(extensionCommandId, input)`. The `extensionCommandId` is the
extension's Incur command path, not a durable product `CommandId`. Agents may import public types
and errors from `incur/client`, including `Client.ClientError`, inside snippets. These facades are
generated TypeScript facades backed by `@svvy/extensions` handlers and `@svvy/runtime` command
recording. They are not package imports, not generated `@svvyx/extensions` references, not rewritten
into shell `svvyx` calls in docs or prompts, and they do not expose local Incur actions or
extension build internals to agent-authored snippets.

The default orchestrator `execute_typescript` extension set does not include the Workflows generated TypeScript facade,
Smithers runtime control, or any `workflow` or `smithers` namespace. Workflow action from the
orchestrator normally goes through `thread_start` into a handler thread.

The default workflow task-agent `execute_typescript` extension set includes only task-local loaded
extension facades. It does not include Workflows source-library facades, Smithers runtime control, or
handler/orchestrator control facades.

File edits use `apply_patch`. The patch target set is validated against the managed filesystem policy
before file effects begin, and the file effects must run through the same Codex-derived sandbox-aware
filesystem execution model as Shell subprocesses rather than relying on TypeScript preflight plus an
unsandboxed host patch process. The policy includes read-only subpaths, protected metadata carveouts,
generated-output boundaries, and the explicit `full-access` sandbox omission.

Every submitted snippet is persisted as an artifact file in the configured artifact directory with
DB-backed artifact metadata and command facts in `@svvy/state`, and the runtime must compile or
typecheck the snippet before execution.

Structured diagnostics must be produced, and invalid snippets must not run.

The top-level `execute_typescript` tool call goes through the same approval-boundary flow as other
approval-gated native actions before the snippet runtime starts, and that approved runtime is then
constrained by the same managed filesystem and network sandbox policy as other direct execution
surfaces unless full-access policy omits sandboxing. TypeScript code may assemble execution policy,
launch approved and sandboxed runtime work, validate product contracts, call injected TypeScript facades,
and project results. It must not be described as enforcing filesystem or network sandbox policy with
TypeScript-only validation, cleanup, or compensation substitutes. Extension facade calls
inside an approved snippet are recorded as child commands and enforce extension readiness, env
injection, redaction, product-state validation, and failure semantics, but they are not the first
approval gate for arbitrary TypeScript execution.

The approval boundary is not the sandbox. Approval allows or denies starting the tool action;
sandbox policy constrains filesystem and network effects after execution begins.

Live rendering for `execute_typescript` follows the shared tool projection model: the source argument
may stream into a code preview, the persisted source artifact and typecheck diagnostics are runtime
progress, extension facade calls appear as nested child commands, and the final parent command facts
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

`load_extension` is a native control tool. It records that an available, ready extension is loaded
for the current actor session and schedules the next safe pre-dispatch refresh of tool declarations,
loaded `svvyx` command guidance, generated TypeScript declarations, and generated agent context
binding. The current model turn records request/fact outcomes, but active pi tool declarations do
not mutate mid-turn. The refresh commits generated-context binding facts through state ports and
emits typed runtime events before the next prompt-bearing dispatch that uses the updated binding;
app/bootstrap fans those events out as renderer-safe read-model invalidations. It does not build
extensions, request dependency approval, configure env values, or mutate agent profile defaults.

Prompt-only Web guidance is different from a native Web tool surface.

The builtin Web extension is a loaded by default prompt-only extension that teaches agents to use the
official TinyFish CLI through ordinary shell commands. It does not add `web_search`, `web_fetch`,
`svvyx web`, generated Web TypeScript facades, or app-owned Web Provider settings. TinyFish owns CLI
install, auth, search, fetch, browser-backed research, and command output behavior. `svvy` only owns
whether the Web instructions are included in the actor's generated agent context.

The execution setting `networkAccess` defaults to true. When `networkAccess` is false, the Web
extension is disabled through normal extension binding, which means TinyFish prompt guidance is not
included for orchestrators, handler threads, or workflow task agents.

Ordinary Shell `exec_command` remains available when `networkAccess` is false, but approved
subprocesses run with network egress denied by the managed sandbox unless `approvalMode` is
`full-access`, where the OS sandbox profile is omitted.

The orchestrator may provide per-handler creation-time extension overrides when the delegated
objective should begin with a non-default extension state. `thread_start` accepts that
creation-time override on each `threads[]` item. The extension handler validates the request and
returns a runtime operation; `@svvy/runtime` creates the durable handler thread through core-owned
state ports, binds the requested handler generated context, and queues the first prompt-bearing
start item. Exact input and output are defined in
`docs/specs/extension/thread_managing.extension.spec.md`.

Smithers and Workflows are different from native control tools.

Smithers is prompt-only official CLI guidance. It adds no native tools and no generated
`execute_typescript` facade. Agents use Smithers by running official Smithers CLI commands through
Shell as ordinary `exec_command` command-family work.

Workflows is an Incur-backed `svvyx` extension for reusable source-library operations. Agents access
it by running `svvyx workflows ...` through Shell as ordinary `exec_command` command-family work, or
through loaded `execute_typescript` TypeScript facades when available. It exposes `list`, `save`,
`build`, and `models list`. It does not run, resume, approve, inspect, or debug Smithers workflows.

The default orchestrator context should know that workflow action normally belongs in a delegated handler thread, but ordinary orchestrator profiles do not load by default Smithers or Workflows. The default handler context knows that the orchestrator can delegate and reconcile thread episodes, but `thread_start` is not part of the ordinary handler profile unless nested delegation is explicitly adopted as product behavior.

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
- when `history` is `"forked"`, runtime materializes a product-filtered inherited-history block only
  into the handler's first prompt-bearing start item. It is not stored as handler prior turns, not
  injected into the handler system prompt, and not shared as pi transcript state
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
- `execute_typescript` is a TypeScript composition tool; builtin Artifacts and Workflows injected
  generated TypeScript extension facades are available through typed declarations, user `svvyx`
  extensions do not contribute `execute_typescript` facades, and the whole TypeScript runtime is
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
- The product exposes no public runtime facade for extension-declared CLI install or update
  commands. User-clicked Install or Update controls in the Extensions UI remain unavailable;
  agent-initiated installs are ordinary Shell work with explicit user confirmation,
  command/readiness lifecycle, cancellation, shutdown, recovery, and tests handled by the
  Shell/runtime path
- ambiguity is handled through clarification and waiting states when the agent needs user intent, not through hidden approval gates
- delegated handler threads and workflow task agents may pause on actor-local execution-permission approvals only when `approvalMode` is `user`; Smithers workflow approvals invoked through official CLI commands are persisted as CLI-observed product-visible Smithers facts linked to commands and workflow task-attempt surfaces in `@svvy/state`

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

The desktop shell presents open workspaces as compact tabs inside the app chrome, integrated with the sidebar and workspace control row rather than as a separate top toolbar. Workspace tabs are left-aligned at the start of the main workspace chrome, scroll horizontally when the open tab set exceeds the available space, and can be dragged to reorder them. Workspace tab order is durable workspace-shell chrome state and restores across app restart. A workspace tab is a visual selector for one workspace runtime scope and one active layout slot id. The canonical workspace runtime scope, durable workspace state, and durable workspace layouts belong to the workspace context, not to the visual tab: session navigation read models, path index, app logs, live surface registry, pi sessions, structured state, prompt queues, handler threads, workspace read models, generated Workflows export read models projected from generated-package facts, and initialized `A`/`B`/`C` layout snapshots are shared by duplicate tabs for the same canonical cwd. Duplicate same-cwd tabs may choose different active layout ids, but they do not own separate durable layout documents or separate panel-local restore state for the same `(workspaceId, layoutId)`. Opening the app with no restored user workspace tabs creates a real svvy-owned default workspace tab, so normal chat, Logs, Agents, Extensions, Workflows, command palette, and sessions remain usable before a user chooses a repository. The default workspace uses the same durable layout slots as any other workspace; its only layout exception is that an empty selected default-workspace slot is seeded with exactly one `Open Workspace` pane instead of staying blank. `Open Workspace` retargets the current visual tab to the chosen user workspace, `New Tab` creates another default workspace tab using the default workspace's selected durable layout slot, and `Open Workspace in New Tab` creates a new visual tab for the chosen user workspace. Opening an already-open repository in a new tab creates a separate visual workspace tab for the same cwd instead of focusing the existing tab, without creating an independent workspace runtime scope, independent session navigation model, isolated durable workspace state, or another durable layout owner.

Each workspace tab summarizes that workspace's session-level running, unread, waiting, and error counts from the shared durable workspace read models for its cwd. Count badges render only when their value is greater than zero, stay in the stable running, unread, waiting, error order, use status color instead of icons, and expose title or tooltip context on hover. Workspace open and close controls are compact icon controls with accessible labels. Workspace-scoped runtime/state facade requests and typed notifications carry an explicit `workspaceId` for the shared workspace runtime scope and, when layout state is involved, an explicit `layoutId` chosen by the tab, except for APIs whose target, workspace session id, surface id, command id, or queue id already identifies the workspace and is validated through `@svvy/state` before mutation. `@svvy/runtime` must not route user work through a process-global active cwd, treat cwd alone as the runtime id, or treat duplicate same-cwd tabs as separate durable workspaces or separate durable layout owners.

The sidebar footer shows the current checked-out branch with a branch icon when the workspace is inside a git repository. That branch affordance opens a compact local-branch menu and switches branches through a workspace-scoped runtime request using normal git semantics. If the workspace is not a git repository or no branch is checked out, the footer falls back to the workspace label with the workspace icon and does not expose a branch switcher.

Each workspace has three fixed durable layout slots: `A`, `B`, and `C`, keyed by `(workspaceId, layoutId)`. These are not user-named layouts. The slots render as compact controls pinned at the far right of the same chrome row as the workspace tabs and status controls. Selecting a layout slot changes the active layout id on the current tab and swaps to that workspace's durable Dockview layout snapshot for the selected slot. Empty slots remain selectable and render muted, not disabled, so the user can start a new layout from scratch. In the default workspace only, opening an empty selected slot creates one `Open Workspace` pane. Duplicate same-cwd tabs share the same three durable layout slots while each tab records only its selected active layout id; changing slot `A` in one tab changes the same `(workspaceId, "A")` layout that another tab would see when it selects `A`.

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

- runtime facade calls and runtime-to-renderer surface payloads must carry an explicit surface target rather than overloading `session.id`
- `session.id` inside session summaries means `workspaceSessionId`
- `workspaceSessionId` and `surfacePiSessionId` are distinct contract fields even when two values happen to match
- `panelId` must never be used as a session id, surface id, or thread id

### Live Surface Runtime

Each interactive pi surface is managed as its own live runtime object keyed by `surfacePiSessionId`.

That live runtime owns:

- scoped live surface resources
- streaming state
- provider, model, and reasoning settings
- the resolved system prompt
- the current prompt execution context
- one prompt lock for that surface
- a surface-local durable queue manager for prompt-bearing and control work, with blocked follow-ups waiting for the prompt lock to release

Durable messages, transcript read models, command facts, and surface records live in `@svvy/state`.
Desktop may apply transient ordered stream patches, but live surface runtime scope is separate from both
durable workspace state and Dockview layout state.

Streaming state belongs to the live surface runtime scope, not to a Dockview panel or renderer prompt
request. A surface may keep streaming with zero, one, or many attached panels, and a panel opened
mid-stream renders the committed transcript, pending user message, and current assistant stream from
the surface read-model sync.

Queued surface work is structured product state, not committed transcript history until a
prompt-bearing item is delivered as the next real user message for the same `surfacePiSessionId`.
Runtime queue acceptance is the only ordinary composer send boundary: the renderer submits target
surface, one new user message, delivery intent, and optional client metadata, then leaves renderer
composer state and prompt history unchanged until `@svvy/runtime` validates the target, durably
creates the queued user message through `@svvy/state`, clears the durable composer draft, and emits
a typed runtime event from committed after-commit descriptors. App/bootstrap fans that event out as
renderer-safe notifications. The renderer clears visible composer state after refetching the
authoritative composer and queue read models. Runtime acceptance also invalidates any older delayed
renderer draft persistence so stale pre-send text cannot be written back after runtime clears the
draft. If runtime acceptance fails, the renderer keeps the draft and writes no prompt history. If a
post-acceptance local prompt-history refresh fails, the send remains accepted and the failure is
logged as a separate non-blocking renderer refresh failure. If the user submits from a composer
while the target surface is idle, `svvy` still durably enqueues the message, emits runtime events
after commit, and wakes the queue dispatcher; insertion and claim are separate committed
transitions, and the UI learns whether the row is queued, dispatching, pending, or active by
refetching authoritative read models after renderer-safe notifications. If the target surface is
already running, `svvy` queues that message for the same surface, keeps the active turn undisturbed,
and starts the next normal turn only after the current turn settles or is cancelled. Ordinary
composer submit is queue-managed delivery; the explicit queued-row `Steer` action promotes a durable
row ahead of ordinary queued user messages for the next safe delivery boundary. It does not inject a
pi-only steering fast path. A steered row remains visible in a locked state until the queue
dispatcher claims it, the user removes or restores it before delivery, or delivery fails into
queue-row-local failed state. Thread report notifications and report requests use the same surface
queue so they are ordered with user messages. Generated-context refresh is not a visible queue row:
before dispatching prompt-bearing work, `@svvy/runtime` compares the surface's bound fingerprint
with the current fingerprint and refreshes first when the surface's checked-by-default
`update before next turn` intent is enabled. Queued work survives panel changes and duplicated panel
views because it belongs to the surface, not to a Dockview panel.

### Dockview Panel And Layout State

Dockview panel and layout state is UI state.

It owns:

- which Dockview panel shows which surface
- the Dockview layout document, including groups, tabs, split sizes, edge groups, floating groups, and popout groups
- panel focus
- panel-local scroll and inspector state
- svvy panel metadata keyed by Dockview panel id

Dockview panels are not live runtimes.

If two Dockview panels show the same surface, they share one underlying live surface runtime scope.

Users may split, dock, tab, drag, resize, close, float, and pop out panels as their workspace requires. Dockview owns the layout interaction mechanics, including drag/drop overlays and splitter behavior. The renderer is responsible for applying svvy product policy, practical minimum panel sizes, and explicit close behavior around Dockview events.

The durable layout stores Dockview serialized layout state plus svvy panel metadata. Window resize preserves the Dockview layout intent without changing surface bindings or live runtime ownership.

Workspace layout persistence is slot-based and keyed by `(workspaceId, layoutId)`. Slots `A`, `B`, and `C` each store their own Dockview serialized layout, panel metadata, focused panel, compact surface state, and panel-local state. The selected slot autosaves after meaningful pane changes. A slot is considered initialized once it contains a bound product surface; uninitialized slots are shown with muted chrome but remain fully selectable. Workspace tabs store only chrome state such as tab order, selected `workspaceId`, and active layout id. Default workspace tabs persist Dockview layout slots exactly like user workspace tabs; a selected default-workspace slot with no Dockview panels is initialized with one `Open Workspace` pane.

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

Orchestrator profiles and the `threadHandler` profile are app-global DB/product-state records
persisted by `@svvy/state`. They describe the provider, model, reasoning level, extension usage
selections, and callable policy used by pi-backed product agents. Base role instructions are builtin
`@svvy/extensions` MDX/source instruction contributors selected by profile usage state rather than profile-local
prompt blobs. Orchestrator and handler-thread profiles have no custom instruction field.
Workflow-agent rows are app-global Agents-pane records whose editable provider, model, reasoning,
instructions, and extension-usage source of truth is the corresponding
`~/.config/svvy/workflows/agents/*.agent.json` file. `@svvy/state` stores only source-version,
fingerprint, diagnostics, generated metadata, links, and read-model/index facts for those rows.
Workflow-agent row instructions are the only workflow-agent-local instruction text and are prepended
before that workflow task agent's generated extension context. The Agents pane appears in the
sidebar between Logs and Extensions and renders/edits orchestrator profiles, the special
handler-thread profile, and workflow-agent parameter records through state/runtime facades rather than
burying model behavior in general settings.

The app owns these app-wide agent profile settings:

- the default orchestrator profile for normal New orchestrator creation; it is locked, non-draggable, non-deletable, and always present in the picker
- `threadHandler` for delegated handler-thread surfaces created by `thread_start`
- workflow-agent parameter records for Smithers task-agent attempts and generated workflow-agent components

The app also owns internal title-naming settings for one-shot top-level session and handler-thread title generation, seeded to `openai-codex`/`gpt-5.4-mini` with low reasoning effort. Those settings are not exposed as a special Agents-pane profile.

User-created orchestrator profiles are ordered in the Agents pane. That order drives the New orchestrator picker order and visible profile badges on created orchestrator surfaces. The default orchestrator profile remains first and cannot be reordered, deleted, or converted into a user profile. Deleting a user-created profile uses an inline single-confirm action that cancels on outside click or Escape. All top-level session creation uses orchestrator profiles, with no separate session mode switch in the product model.

Session records persist the orchestrator profile selected at creation time, the profile snapshot that was active at creation time, and the generated agent context fingerprint used by the orchestrator surface. All top-level sessions are orchestrator sessions created through New orchestrator or equivalent unmatched command-mode text from the command palette.

Handler threads use the `threadHandler` special profile. Each `thread_start.threads[]` item may pass
creation-time `overrides` as a partial map over that profile's extension usage states.
Extensions remain separate product knowledge and capability records; they do not carry model,
reasoning, or prompt-selection settings.

The Agents pane edits app-global agent profiles, including orchestrator profiles and `threadHandler`, plus workflow-agent parameter records. General settings edit app-global model provider credentials, app appearance (`system`, `light`, or `dark` with `system` as the default), the user's preferred external editor for opening workspace source files from read-only product surfaces, and the artifact directory used for durable session artifact files. The artifact directory defaults to `~/.config/svvy/artifacts` and remains app-owned configuration rather than an agent-supplied command argument. Provider rows use icon-only key, OAuth, and remove controls with explanatory tooltips; remove uses an inline single-confirm action. OAuth credential rows expose exact health from stored expiry and refresh results: healthy OAuth is usable until its provider-supplied expiry, expired OAuth attempts refresh at auth-summary and send boundaries, and refresh failure is stored as explicit connected-but-unusable state that requires reconnect before the provider can appear as usable model auth or enter pi runtime auth storage. Web-specific TinyFish CLI auth is owned by TinyFish CLI commands such as `tinyfish auth login`, `tinyfish auth set`, and `tinyfish auth status`, not by `svvy` General settings. Extension definitions, extension instructions, external instruction controls, and generated context previews are edited or inspected in the Extensions pane rather than buried in general settings. Complex settings and configuration editors use TanStack Form for renderer form state where they need validation, dirty state, field-level errors, submit pending state, reset/cancel behavior, and async save errors, while `@svvy/state` validation and normalization remain authoritative. Agent profile and workflow-agent parameter changes save directly from the setting control rather than through a separate save button. Workflow-agent instruction textarea edits autosave after a short debounce and show their unsaved, saving, saved, or failed state as a small icon inside the textarea instead of exposing Save or Reset buttons; the saved textarea source preserves user-entered whitespace, and trimming happens only when that source is composed into injected prompt text. Agent model selection is a constrained picker over models from currently usable providers, and reasoning selection is constrained to the levels supported by the selected model, matching the interactive session controls rather than accepting freeform provider, model, or reasoning text. An orchestrator profile may either keep composer model, reasoning, and extension usage changes local to each session or let sessions using that profile save those composer changes back to the profile for newly created sessions using that profile. The source of truth for provider/model capability metadata is pi's normalized model registry and runtime APIs: `svvy` does not maintain separate provider-specific reasoning tables, Codex reasoning special cases, or request-shape mappings. Visible reasoning output is whatever pi normalizes into assistant `thinking` blocks; for providers such as OpenAI Codex this is a reasoning summary when the provider streams one, not raw chain-of-thought, and encrypted continuation-only reasoning with no visible summary must be labelled unavailable rather than redacted.

Workflow-agent parameter records are app-global Agents-pane rows backed by the same structured file-backed
source records generated as `Agents.*` exports in `@svvyx/workflows`. UI edits submit versioned
workflow-agent source edit requests through the app-bootstrap runtime facade. `@svvy/runtime` uses
the extension-owned source contract, asks `@svvy/extensions` to validate and write the source
through source services, and commits source-version, fingerprint, and diagnostic facts through
runtime-facing `@svvy/state` ports. Runtime then schedules generated-package refresh;
generated-package facts commit only after that refresh succeeds. Panes refresh only from committed
`@svvy/state` read models and generated-package facts.

### Agents And Extensions

Agents and Extensions are the app-owned prompt and capability configuration surfaces for
orchestrator, handler-thread, and workflow task-agent prompts. `@svvy/state` owns persisted profile
rows, `@svvy/extensions` resolves profile extension usage/order into generated actor context, and
`@svvy/desktop` renders the editor controls through the runtime facade plus state read/command
facades injected by app bootstrap.

Agent profile records contain:

- profile display name
- actor kind
- provider/model and reasoning defaults
- loaded base instruction extensions
- per-extension usage state: `loaded`, `available`, or `unavailable`, except fixed
  app-native controls such as Extension Loading
- per-profile extension instruction order, edited by dragging active expanded-profile extension rows
- expandable per-extension generated instruction previews for that profile, with tokenx-backed
  estimates in an aligned column on active extension rows, available rows showing the available
  prompt estimate plus the would-be loaded prompt estimate in parentheses, no token count on Off
  rows, expanded workflow-agent inline instruction text showing a live estimate beside its source
  file link, and the total generated prompt estimate shown beside the expanded row's reset controls
  while including the current workflow-agent inline instruction draft

Extensions own:

- builtin, user, and external_instruction categories
- ordered full loaded instruction source files that generate one loaded instruction block, with the
  displayed default order matching the generated prompt order
- editable instruction file order, per-file bypass state, and remove-to-trash behavior for editable
  instruction files
- minimal available instructions
- native tool, svvyx, or instructions-only interface
- generated `execute_typescript` facade declarations for emitted `svvyx` facades, controlled by the
  extension's TypeScript API setting and limited to facade execution that is safe for
  the target actor
- env and dependency readiness
- `@svvy/extensions`-derived customized tags for builtin and user extension source records plus inventory filters for all records,
  prompt-only records, native tools, and svvyx extensions
- category-appropriate reset/delete behavior
- read-only usage views showing which agents use the extension

Artifacts is a builtin `svvyx` extension with generated TypeScript facade declarations. Its model-callable API is
the `svvyx artifacts ...` command family, with `create`, `inspect`, `list`, `open`, and `delete`
commands defined in `docs/specs/extension/artifacts.extension.spec.md`.

External instruction records represent files such as `AGENTS.md` and `CLAUDE.md`. They appear in the
Extensions pane as a distinct read-only category, use enabled/disabled plus selected actor kinds
rather than normal extension loaded/available/unavailable usage states, show path/content/order in
generated-context previews, and provide an open-external-file action. Resetting an external
instruction record changes only `svvy` settings metadata; it never overwrites the external file.

`unavailable` is the configured Off state for an extension in a resolved actor/profile binding, not
a hard actor boundary by itself. Configurability is not blocked merely because an extension's default
state is `unavailable`; normal usage controls may move configurable extensions between loaded,
available, and unavailable for a target actor/profile. Extension Loading remains the fixed
always-loaded control.

Generated agent context bindings store loaded extension ids, available extension ids, external
instruction identity/order/read-status metadata, declaration ids/refs, generated-package readiness
refs, current-build context refs, hashes/digests, source fingerprints, and generated agent context
fingerprints for sessions, handler threads, and workflow task-agent attempts. Prompt bodies,
generated svvyx guidance, native tool declaration bodies, and generated `execute_typescript` facade
declaration bodies remain file-backed/package-generated inputs used during generated context
composition and are not duplicated into product state. External instruction file bodies remain
file-backed inputs used during generated context composition and may be shown through the
external-instruction inventory/read-model surface; prompt execution context and subprocess
environment context carry only metadata and never duplicate those file bodies.

New top-level sessions, handler threads, and workflow task agents always use the latest context-ready generated agent context from Agents, Extensions, generated native-tool and `execute_typescript` declarations, generated package facts, and current external instructions. Existing surfaces store the generated agent context fingerprint they received. A surface is stale only when its bound fingerprint differs from the current fingerprint. Stale surfaces show “Extensions changed and will require system prompt to refresh.” with a checked-by-default durable checkbox labelled “Update before next turn.” Before any prompt-bearing item dispatches, `@svvy/runtime` recomputes the current fingerprint; if it still differs and the checkbox is enabled, runtime refreshes the binding first, commits generated-context binding facts through state ports, and emits typed runtime events that app/bootstrap fans out as renderer-safe read-model invalidations. If the checkbox is disabled, the prompt runs with the bound context and the stale banner remains visible. Active turns are never refreshed mid-turn; the same pre-dispatch rule applies to the next prompt-bearing item. The visible surface identity and transcript stay continuous even if the pi surface/session managed through `@svvy/pi-adapter` must be recreated to load the fresh `systemPrompt`.

Top-level session titles are generated through an explicit durable title-generation flow. Before the first turn is submitted, the visible default session title follows the beginning of the live composer draft for that session's orchestrator surface. When the first real user turn starts in a top-level session, the app records a pending title-generation job and runs the configured `namer` agent concurrently with the orchestrator turn; until that generated title lands, the visible title continues to use the first user message summary. The orchestrator must not wait for the namer, and the namer must not wait for the orchestrator response. The namer settings prompt is the title-generation instruction; the one-shot user prompt sent to that agent contains only the first user message context to title, not another naming instruction or extracted keyword list. While that job is pending or running, manual session rename is blocked for that session so the generated title and a user rename cannot race. The generated title is persisted once, auto-title generation stops after that first successful generation, and a manual rename permanently freezes future auto-titling for the session. Handler-thread titles are generated by the same configured `namer` agent from the orchestrator-supplied `thread_start` objective; the orchestrator does not receive or supply a separate handler title field.

### Workflows Source Library

The Workflows source library is app-global reusable Smithers authoring source.

It lives under `~/.config/svvy/workflows/` and has exactly these editable source kinds:

- `agents/`: structured `.agent.json` task-agent parameter records
- `prompts/`: reusable workflow MDX prompt source contributors managed by `@svvy/extensions`
- `components/`: direct TypeScript or TSX Smithers components and helpers
- `workflows/`: direct TSX reusable workflow modules

Generated package output is app-owned read-only build output resolved through the `@svvy/extensions`
package-owned `GeneratedPackageRootPort`, separate from this source tree. Agents must not edit
generated roots directly.

`svvyx workflows save` copies or extracts workspace-authored `.smithers/` files into app-global reusable source. `svvyx workflows build` requests deterministic generated-package refresh after source edits. Both are ordinary Shell commands from the agent's perspective.

Workflow-agent records are parameter objects, not arbitrary executable agent source. They are saved
as structured data so the Agents pane and Workflows build share one source of truth. UI edits in the
Agents pane and agent edits through `svvyx workflows save` both enter the same versioned source-edit
and generated-package refresh path. The Agents pane can create and duplicate workflow-agent records,
delete user-created workflow-agent records through the same inline confirmation pattern as
orchestrator profiles, and open the exact `.agent.json` source file for each record. The default
Explorer, Implementer, and Reviewer records are seeded source records and remain non-deletable
defaults.

The generated `@svvyx/workflows` package exports only namespace objects:

- `Agents`
- `Components`
- `Prompts`
- `Workflows`

The generated package export values do not carry app metadata. Source-file mapping, Agents-pane
records, generated-package facts, and read-model metadata live in `@svvy/state` and
`@svvy/extensions` outputs, not in generated `@svvyx/workflows` runtime values.

### Workflows Pane

The Workflows pane is read-only visibility into the latest successful generated `@svvyx/workflows` package.

It is generated-package visibility only. It is not a workflow runner or source editor.

For each generated export in `Agents`, `Components`, `Prompts`, and `Workflows`, it shows:

- kind
- namespace
- export name
- qualified name
- read-only generated code
- link to the generated file
- link to the source file

For `Agents.*` exports, the pane also shows the generated task-agent parameter object and provides a primary human action that opens the corresponding record in the Agents pane for customization. Agents themselves do not use that UI link; agents use `svvyx workflows ...` and source files.

The Workflows pane refreshes after successful generated-package facts commit for `@svvyx/workflows`,
whether the refresh was caused by `svvyx workflows build`, a UI source edit, or runtime recovery. It
may use internal build metadata for source/generated links, but it must not expose that metadata as
an agent-facing contract.

### Turn

A turn is one request boundary inside one interactive surface.

That means:

- the main orchestrator surface has turns
- each handler thread surface has its own turns
- each workflow task-agent attempt surface has its own turns

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

Artifacts are durable session files produced by commands and related execution. Runtime owns the
file-backed byte materialization, deletion, digest calculation, and recovery; state owns the
DB-backed metadata, lifecycle, stored-path, byte-size, digest, immutable, and linkage facts.

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
extension. `--immutable` stores the artifact under the owning durable workspace session's
`immutable/` artifact directory. Runtime creates or copies the artifact bytes, computes byte-size and
digest facts, then commits the durable artifact record through state and links it to the current
workspace session, thread, and source command from the runtime boundary. For copied artifacts, the
source path is not the artifact.

Artifact files live under `<artifactDir>/<workspaceSessionId>/`. Ordinary command execution may
write only the mutable artifact directory for the owning durable workspace session and must treat
`<artifactDir>/<workspaceSessionId>/immutable/` as read-only. That immutable boundary is enforced by
the managed filesystem policy, not by OS-level file flags.

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

Every user request that can start immediately goes through one surface-owned runtime flow:

1. load current workspace, session, thread, episode, artifact, saved Workflows, and wait context
2. identify the target surface of the message
3. compare the target surface's bound generated-context fingerprint with the current fingerprint, and refresh the binding before prompt-bearing work only when the surface's update-before-next-turn intent is enabled
4. compose that surface's actor prompt from its bound generated agent context, including loaded base instruction extensions, loaded capability extension instructions, available extension loading hints, external instruction files, native tool declarations, loaded svvyx guidance, and generated `execute_typescript` facade declarations, then load it into pi's true `systemPrompt` channel before sending the new user message
5. open a new turn for that surface
6. let that surface choose and persist its top-level turn decision, then decide its next tool call or direct response
7. route accepted model tool calls through `@svvy/runtime` to the matching `@svvy/extensions`
   handler, with runtime-owned accepted-tool execution allocating command envelopes and receiving an
   `ExtensionHandlerResult` whose runtime-owned work is carried in
   `operations?: readonly ExtensionRuntimeOperation[]`
8. process returned `ExtensionRuntimeOperation` items in `@svvy/runtime`; runtime applies
   `runtime_effect` items, executes `execution_plan` items, publishes typed read-model invalidation
   notifications derived from committed `afterCommit` descriptors, and owns lifecycle policy,
   command writes, queue writes, waits, Effect-managed timeouts/schedules, and state-port calls
   For `thread_start`, the returned operation is applied only by `@svvy/runtime`: runtime allocates
   thread/group state, binds the handler generated context, records history mode, creates the first
   start queue item, and publishes typed invalidations after commit.
9. record command/projection facts, artifacts, and wait facts through structured state
10. update state-backed read models
11. publish typed read-model invalidation notifications after durable state changes
12. publish `surface.stream` patches with a target-local stream sequence for live assistant output while the surface is active
13. render updated workspace and Dockview panel surfaces by refetching read models and applying
    transient stream patches through panel bindings

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
- the default `request_user_input` variant is nonblocking: the extension validates questions and
  returns default answers plus one ordered `ExtensionRuntimeOperation` item wrapping a
  `request_input.create` `RuntimeEffectRequest`; runtime creates the durable request, completes the
  command with those defaults, and later accepts user answers through `runtime.requestInput.answer`;
  in nonblocking mode that API records the answer and may create a `request_user_input_answer` row
  for the owning surface. Answer rows outrank ordinary `user_message` rows and remain FIFO among
  answer rows; row-level `Steer` is still the separate highest-priority next-delivery action.
- the user may switch the builtin Request User Input extension into blocking mode; in that variant
  the extension returns the same ordered `ExtensionRuntimeOperation` item and runtime waits through
  an Effect-managed timeout until the user answers or, after five minutes, resolves with the default
  answer
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
- the handler thread may inspect artifacts, inspect product-visible CLI/bridge-observed Smithers workflow/run/task-attempt facts persisted by `@svvy/state`, use official Smithers CLI commands for execution evidence and repair, edit `.smithers/` source, repair inputs, rerun commands, ask the user, or explicitly close the objective
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

The palette has one shell, one input, and one result interaction model. The leading `>` input prefix selects command mode. `Cmd+Shift+P` opens the shared palette with `>` already inserted, and command mode discovers and executes product actions, including New orchestrator creation and session switching, session pin/archive actions, opening focused session/thread/artifact/Workflows surfaces, handler-thread surfaces, pane and layout actions when panes exist, settings and Agents profile actions when those features exist, and all product actions registered in the command/action registry.

`Cmd+P` opens the same shared palette with an empty input for reserved file quick-open mode. File
quick-open has disabled or empty results until file surfaces are part of the product contract.
Typing `>` into the quick-open input switches the already-open palette into command mode, and
deleting the prefix switches it back to quick-open behavior.

The command palette UI should use `cmdk-sv` from `https://www.cmdk-sv.com/` as the Svelte command menu primitive. Its docs describe it as a "fast, composable, unstyled command menu for Svelte." `cmdk-sv` is the renderer menu primitive, not the source of product routing, runtime behavior, or command semantics.

The command palette is a prefix-driven shell/action surface within the shared palette. It is not an alternate execution engine, standalone shell, custom terminal loop, readline loop, alternate TUI stack, or parallel workflow abstraction. Palette actions route into the existing product model: sessions, panes, surfaces, orchestrator and handler turns, durable state, settings, Workflows visibility, and Agents profiles.

App action controls that expose command-palette, quick-open, New orchestrator, sidebar, or pane actions use the product shortcut registry for user feedback and dispatch metadata. The registry owns stable shortcut action ids, labels, platform chords, compact and readable display strings, scope, input-typing policy, availability, and command routing metadata. TanStack Hotkeys is the renderer binding primitive that subscribes scoped shortcuts and applies the registry input policy; it is not the source of product command semantics. App launcher and product action chords such as `Cmd+Shift+P`, `Cmd+P`, `Cmd+N` for New orchestrator in the focused pane, `Cmd+Shift+N` for New orchestrator in a new pane, sidebar toggle, `Cmd+Shift+1` for Logs, `Cmd+Shift+2` for Agents, `Cmd+Shift+3` for Extensions, and `Cmd+Shift+4` for Workflows remain available while workspace text inputs such as the composer are focused. Explicit labeled sidebar actions reveal compact in-button shortcuts immediately on hover or focus; the New orchestrator control also shows a delayed tooltip that explains click, `Cmd+N`, `Cmd`-click, `Cmd+Shift+N` placement, and profile-picker behavior. Icon-only or ambiguous controls may show explanatory action tooltips after 500 ms and include the readable shortcut when one exists. Native browser `title` tooltips are not the product feedback layer for these controls. Command palette and quick-open launchers live in the sidebar rather than duplicated in the top-right workspace chrome.

When the shared palette is in command mode and the text after `>` does not match an existing command
or action, pressing Enter creates a New orchestrator session and uses the text after `>` as the
initial prompt. That prompt enters the normal orchestrator turn model; it does not skip system
prompt loading, prompt history, structured turn state, or live surface runtime scope ownership. Text
entered without the leading `>` remains quick-open search text and does not create prompt sessions.

The default command-palette behavior is defined before choosing a Dockview target as normal current workspace and session routing. Once Dockview layout exists, placement rules belong to the pane-layout spec: command palette results that open sessions or surfaces default to a new Dockview panel, and `Cmd+Enter` opens into the currently focused panel.

### Surface Projection

`svvy` uses a Dockview-backed multi-pane desktop layout where:

- the main orchestrator surface can be opened in a Dockview panel
- a handler thread surface can be opened in a Dockview panel
- artifact, command inspector, Logs, Agents, Extensions, Workflows, Settings, and related static or inspector surfaces can be opened in Dockview panels, tab groups, edge groups, floating groups, or popout groups when valid

The main orchestrator surface and a handler thread surface should use the same core interactive UI model:

- transcript
- composer
- tool activity
- artifacts
- status

Assistant transcript messages render Markdown suitable for coding-agent output, including compact prose, lists, tables, fenced code with syntax highlighting and copy actions, inline and block math, Mermaid diagrams, and escaped raw HTML rather than executable HTML. Long transcript surfaces use TanStack Virtual over system metadata, semantic projection cards, durable messages, tool rows, and active streaming rows so variable-height content preserves pane-local scroll anchors while following the bottom only when the user is pinned there. Tool cards render as execution spans from structured command records: collapsed spans show action, target, status, duration, compact counts, useful outcome, and linked artifact actions when artifacts exist; expanded spans show bounded semantic sections for accepted arguments, command target, file changes, diagnostics, progress, grouped stdout/stderr, and child commands; the inspector remains the full debugger for raw facts, snapshots, and complete output. Matched raw tool-result rows collapse into the tool call instead of creating duplicate transcript cards. Handler-thread cards keep objective, current activity, latest report, and counts as separate fields rather than replacing the objective with report text. Live assistant output preserves each provider/runtime stream packet as a visible update, but the bridge sends compact ordered stream patches instead of full surface read-model syncs for every packet; baseline, recovery, and settled views come from `@svvy/state` read-model fetches.

Message targeting is simple:

- sending a message from a panel sends it to the surface shown in that panel
- if the panel shows the orchestrator, the message goes to the orchestrator
- if the panel shows a handler thread, the message goes to that handler thread

This is shared surface behavior, not a thread-specific exception.

Projection ownership is equally simple:

- `@svvy/runtime` owns durable workspace lifecycle coordination and live surface runtime scope ownership
- Dockview owns layout mechanics and serialized layout state
- `@svvy/state` owns the authoritative read-model projections for app-global state such as app preferences, provider auth summaries, model choices, agent settings, and generated Workflows exports
- `@svvy/state` owns the authoritative workspace-keyed read-model projections for workspace state such as app logs, extension inventory projections, external instruction sources, and snippets
- `@svvy/state` owns persisted layout JSON, panel metadata, and panel-to-surface bindings
- `@svvy/desktop` holds renderer-local non-authoritative warm caches of those read models so panes can render synchronously and then refetch after app-bridged typed invalidations
- Dockview panes synchronously render from those warm read-model caches when they open, refresh through the runtime facade plus state read/command facades in the background, and update immediately when another open pane or app-bridged runtime notification invalidates the same read model
- the renderer owns transient Dockview projection, focus, drag/drop, scroll, and panel-local view state such as selected rows, filters, and expanded sections
- the renderer listens for app-bridged typed read-model invalidation notifications and `surface.stream` patches, then joins them locally through read-model caches and panel bindings
- the renderer does not poll read APIs on every pane open, inspect transcript files, or infer lifecycle changes from transcript mutations
- workspace-scoped runtime requests and sync events route by explicit `workspaceId`, never by active workspace, focused panel, or current tab

Panel and surface semantics are:

- opening a Dockview panel attaches that panel to a surface
- closing a panel detaches that panel without deleting durable state
- closing the last owner of a surface releases that live surface runtime scope cleanly
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

`@svvy/runtime` recovery is separate from workspace shell UI restore. Each acquired workspace runtime scope owns one durable recovery coordinator for that workspace's sessions, pi surfaces, queues, initial handler starts, thread report notification delivery, report requests, waits, title jobs, and recovery observability. The coordinator uses durable owner scopes, idempotency keys, and transactional claims rather than active workspace, focused tab, focused panel, process cwd, or renderer state. App-global startup and workspace-tab restore decide which workspace runtime scopes exist; they do not drain workspace queues or repair workspace product work directly.

## Product Outcomes

The design is successful when:

- the orchestrator remains strategically informed without being bloated by delegated-work internals
- delegated work happens inside handler threads that feel like real interactive surfaces
- Smithers workflow work uses official Smithers CLI commands and workspace `.smithers/` source while
  reusable source-library work uses `svvyx workflows ...`
- reusable workflow material is saved once under `~/.config/svvy/workflows/` and consumed through generated `@svvyx/workflows` namespace imports
- handler threads can repair, clarify, and rerun commands internally before returning control
- handed-back threads remain open for follow-up chat and explicit reactivation in the same delegated
  context
- the user can understand the current state of sessions, threads, and saved generated Workflows from durable state
- meaningful delegated work terminates in reusable episodes instead of transcript archaeology
- pi remains the runtime substrate and Smithers remains the workflow engine rather than replacing the product shell
