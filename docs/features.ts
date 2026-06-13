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
    summary:
      "Runs svvy as a native desktop coding app with a Bun-side pi host and renderer shell, including a svvy-owned default workspace runtime used when no user workspace tabs restore, plus renderer-runtime warm read-model snapshots that feed static panes synchronously and update open panes immediately when app-global or workspace-keyed state changes.",
    sourceSpecs: ["docs/prd.md", "docs/specs/default-workspace-and-open-workspace.spec.md"],
  },
  {
    id: "source-invalidation",
    name: "Source Invalidation And File-Backed State",
    status: "in-progress",
    summary:
      "Runs one backend-owned source invalidation coordinator for file-backed product inputs, using watcher events only as hints that trigger debounced and periodically reconciled deterministic source fingerprints; watches app-global agent settings, Workflows source, Extensions source, external instruction candidates, and managed/discovered snippet roots while excluding generated outputs and workspace package links; rebuilds or rereads the smallest affected state, keeps the last ready generated output active when validation fails, surfaces source diagnostics through app logs/read models, refreshes renderer warm caches through backend-authored updates, queues normal durable `agent_context_refresh` work for open surfaces whose prompt binding fingerprint changes, and protects editable file-backed drafts with shared source-version compare-and-swap saves plus explicit keep-editing, discard-local, and overwrite-external conflict actions.",
    sourceSpecs: ["docs/prd.md", "docs/specs/source-invalidation.spec.md"],
  },
  {
    id: "provider-auth",
    name: "Provider Auth And Settings",
    status: "shipped",
    summary:
      "Manages app-global model provider keys, OAuth-backed access, icon-only provider key/OAuth/remove controls with tooltip explanations and inline remove confirmation, and a General settings surface for app appearance (`system`, `light`, or `dark`), the user's preferred external editor, the durable artifact directory, approval mode, default-on network access, and default-off ambient agent resource categories with backend-authoritative app-global persistence, while leaving pi-backed agent profile configuration to the Agents pane, Web-specific TinyFish CLI auth to TinyFish CLI commands, and workspace-affecting operations on explicit `workspaceId`-routed requests.",
    sourceSpecs: ["docs/prd.md"],
  },
  {
    id: "true-system-prompt-channel",
    name: "True System Prompt Channel",
    status: "in-progress",
    summary:
      "Loads svvy's orchestrator, handler-thread, and workflow task-agent instructions through pi's real `systemPrompt` channel from the bound generated agent context, ignores pi `SYSTEM.md` and `APPEND_SYSTEM.md` prompt replacement or append files, preserves discovered `AGENTS.md` and `CLAUDE.md` files as read-only `external_instruction` extension records in the prompt path, sends new user input as real pi user messages without flattened transcript reconstruction or hidden durable state prose, slices generated capability declarations by actor so each surface sees only its own callable API, renders the active system prompt as expandable surface metadata instead of inline transcript text, fingerprints the exact generated agent context each surface received, and automatically applies ready agent context updates through durable `agent_context_refresh` queue work before later prompt-bearing turns or at the next safe active-run boundary.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/queued-messages.spec.md",
    ],
  },
  {
    id: "ambient-agent-resources",
    name: "Ambient Agent Resources",
    status: "in-progress",
    summary:
      "Defines provider-neutral ambient coding-agent resource categories for callable capabilities, executable extensions and packages, skills, prompt templates, commands, hooks, UI resources, provider/model adapters, credentials, execution policy, and runtime state; persists an app-global default-off category ledger in General settings; preserves plain external instruction files such as `AGENTS.md` and `CLAUDE.md` as visible generated agent context through read-only extension records while keeping behavior-changing ambient resources disabled by default; and requires users to opt in by settings-scoped host, workspace, target agent/profile configuration, category, and source before those resources can affect prompts, generated API declarations, command routing, UI, provider/auth behavior, or execution policy.",
    sourceSpecs: ["docs/prd.md", "docs/specs/ambient-agent-resources-baseline.spec.md"],
  },
  {
    id: "snippets",
    name: "Snippets Prompt Macros",
    status: "in-progress",
    summary:
      "Defines product-owned Snippets as explicit user-inserted prompt macros, with managed and read-only discovered Markdown records, a Snippets pane, composer `@` picker insertion, argument placeholders, editable expansion before send, transcript provenance metadata, and host runtime prompt-template or slash-command expansion kept disabled so snippets never grant tools, change actor capability, alter generated agent context, or add command guidance.",
    sourceSpecs: ["docs/specs/snippets.spec.md"],
  },
  {
    id: "extension-env-secrets",
    name: "Extension Env And Secrets",
    status: "in-progress",
    summary:
      "Defines app-global extension env declarations and app-managed values keyed by `(extensionId, envName)`, with user-only secret entry/update/removal, encrypted local secret storage, local Extension Managing snapshot secret-state preservation with coarse status only, non-secret manifest defaults plus app-level overrides, status-only agent inspection through `list_extensions` and Extension Managing, build-time declaration validation separate from ready state, invocation-local explicit-env injection into only the specific Incur `svvyx` command or generated extension-client invocation, and redaction across prompts, generated docs, tool output, logs, artifacts, transcripts, and snapshots while deferring egress-proxy credential boundaries.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/extension/svvyx-incur-runtime.spec.md",
      "docs/specs/extension/extension_managing.extension.spec.md",
      "docs/specs/extension/execute_typescript.extension.spec.md",
      "docs/todo.md",
    ],
  },
  {
    id: "artifacts-projection",
    name: "Artifacts Projection",
    status: "shipped",
    summary:
      "Presents generated artifacts as explicit Dockview artifact inspector panes keyed by durable artifact identity, with visible HTML previews isolated in sandboxed iframes that grant script execution only without same-origin, navigation, popup, form, or parent/app escape permissions.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extension/artifacts.extension.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/workspace-navigation-core-projection.spec.md",
    ],
  },
  {
    id: "durable-artifact-storage",
    name: "Durable Artifact Storage And Artifacts Extension API",
    status: "in-progress",
    summary:
      "Stores artifacts in the configured artifact directory, defaulting to `~/.config/svvy/artifacts`, with per-session artifact directories that are writable to the owning session, an `immutable/` child directory that remains read-only to ordinary command execution, SQLite metadata with exact stored filename, immutable flag, path indexing, MIME type, byte size, digest, created/deleted lifecycle fields, source-command/thread/workflow linkage, submitted `execute_typescript` source for every attempt, workflow-related logs and exports, durable handoff documents intended to be read, reassessed, or modified by later agents without inheriting full conversation context, and a builtin Artifacts `svvyx` extension whose concrete `create`, `inspect`, `list`, `open`, and `delete` command family supports empty artifact creation through exact `--name <filename.ext>`, copying through `--path` with optional exact rename, and `--immutable`, available through `svvyx artifacts ...` and the generated Incur-compatible `extensions.artifacts.run(...)` TypeScript client when loaded.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extension/artifacts.extension.spec.md",
      "docs/specs/structured-session-state.spec.md",
    ],
  },
  {
    id: "execute-typescript-surface",
    name: "Direct Tools And Execute TypeScript",
    status: "in-progress",
    summary:
      'Provides Codex-like native Shell, Apply Patch, and Execute TypeScript extensions as the default coding-agent work interface, with `exec_command`, `write_stdin`, `apply_patch`, and `execute_typescript` carrying command lifecycle, long-running session, streamed command output, structured patch/file-change previews, patch facts, and Codex-like approval-boundary decisions that are distinct from filesystem and network sandbox enforcement; packages macOS sandboxing through an app-owned native helper that invokes `/usr/bin/sandbox-exec` and preserves Codex-derived filesystem policy semantics including `Read`, `Write`, and `None` entries, most-specific path precedence, equal-specific `None > Write > Read` precedence, writable roots with read-only subpaths, protected metadata carveouts, network allow/deny, full-access sandbox omission, sandbox-denial reporting, and fail-closed profile generation; exposes simple execution settings for `approvalMode` (`auto-review`, `user`, or `full-access`) and default-on `networkAccess`, treats `svvyx ...` as ordinary Shell `exec_command` input to the real app-owned Incur CLI, and splits Shell loaded instructions into base command execution guidance plus separate Incur-backed `svvyx` CLI usage guidance; keeps `execute_typescript` as an actor-local TypeScript composition tool whose entire runtime is launched through the same approval and sandbox execution lane before submitted TypeScript runs, with app `networkAccess` and managed sandbox settings applied, concrete generated package paths wired for builtin clients, loaded instructions split between base TypeScript execution guidance and separate Incur generated-client usage guidance, and the only generated extension abstraction an actor-scoped `extensions` object containing available builtin Artifacts and Workflows clients shaped as `extensions["<id>"].run(commandId, input)`, with dot access allowed only for identifier-safe ids, imports from `incur`, `incur/client`, `@svvy/extensions`, and `@svvy/workflows` when available through the generated contract, generated command map types only for emitted clients, no user `svvyx` generated clients until sandboxed generated-client execution exists, no global `svvy` client, no broad injected `api` helpers, no local Incur actions or generated-client internals in agent-facing snippets, and no cx generated clients in v1; allows TypeScript to assemble policy, launch approved and sandboxed runtime work, validate product contracts, and project results, but not to enforce filesystem or network sandbox policy with TypeScript-only validation or cleanup substitutes; preserves arbitrary TypeScript side effects as opaque unless they go through app-owned client boundaries; produces preflight typecheck or compile diagnostics when available, stores file-backed source artifacts for every attempt, and rolls generated-client child command facts under the parent.',
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/live-tool-projection.spec.md",
      "docs/specs/extension/shell.extension.spec.md",
      "docs/specs/extension/apply_patch.extension.spec.md",
      "docs/specs/extension/execute_typescript.extension.spec.md",
      "docs/specs/extension/svvyx-incur-runtime.spec.md",
    ],
  },
  {
    id: "live-tool-projection",
    name: "Live Tool Projection",
    status: "in-progress",
    summary:
      "Uses a Codex-like turn item model for live tool rendering: show the tool card as soon as the tool name is known, stream large argument snapshots before runtime execution, render `apply_patch` as structured file-change snapshots rather than many tiny patch calls, stream `exec_command` output and runtime progress through durable command events, nest `execute_typescript` generated-client child commands under the parent, and keep `svvyx ...` and prompt-only CLIs such as Smithers as command-family projections over `exec_command` without a workflow-specific renderer.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/live-tool-projection.spec.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/structured-session-state.spec.md",
    ],
  },
  {
    id: "request-user-input",
    name: "Request User Input Extension",
    status: "in-progress",
    summary:
      "Defines Request User Input as a builtin native dual-variant extension for orchestrator and handler-thread user clarification, exposing one `request_user_input` tool whose active nonblocking or blocking variant controls loaded instructions, schema descriptions, and runtime behavior; requires agent-authored question titles, one to three questions, Codex-like two to three choice options with exactly one `recommended: true` or a freeform `defaultAnswer`; generates request/question/option ids internally; shows answerable questions in a side panel; defaults to nonblocking behavior that immediately returns the recommended/default answer and later delivers user answers through highest-priority durable queue work; supports blocking behavior with a default-enabled five-minute timeout that falls back to the default answer; and keeps tool results free of mode, timer, UI availability, and internal id fields.",
    sourceSpecs: [
      "docs/specs/extension/request_user_input.extension.spec.md",
      "docs/specs/queued-messages.spec.md",
      "docs/specs/live-tool-projection.spec.md",
      "docs/specs/extensions-and-tools.spec.md",
    ],
  },
  {
    id: "extension-cli-requirements",
    name: "Extension CLI Requirements",
    status: "in-progress",
    summary:
      "Lets extensions declare required global PATH CLIs with a binary name, optional package name, default target version, version-check command, and reusable exact-version install/update command template; reports missing, unknown, available, detected version, current version, latest version, and update-available state through Extension Managing inspect/build and the Extensions UI; makes build fail with ordinary structured errors when required CLI presence or version status is missing or unknown while using the detected installed version when one is available; keeps CLI installation and updates as ordinary `exec_command` work where `approvalMode` selects auto-review, user approval, or full-access behavior before execution, and approved commands run under managed sandbox/network policy unless full-access omits it; uses default versioned requirements for `cx-cli@0.7.1`, `smithers-orchestrator@0.22.0` exposing binary `smithers`, and `@tiny-fish/cli@0.1.6`; and keeps Git and GitHub CLI requirements unversioned because their builtin instructions are not pinned to a specific CLI release.",
    sourceSpecs: [
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/extension/git.extension.spec.md",
      "docs/specs/extension/github.extension.spec.md",
      "docs/specs/extension/cx.extension.spec.md",
      "docs/specs/extension/web.extension.spec.md",
      "docs/specs/extension/extension_managing.extension.spec.md",
    ],
  },
  {
    id: "web-tool-surface",
    name: "Prompt-Only TinyFish Web Extension",
    status: "in-progress",
    summary:
      "Defines Web as a builtin loaded by default prompt-only extension while `networkAccess` is enabled, disables Web through normal extension binding when network access is off, generates TinyFish CLI instructions from selected exact-version `@tiny-fish/cli` npm package artifacts, declares a default-target `tinyfish` CLI requirement with a reusable exact-version install/update template, teaches agents to authenticate the official TinyFish CLI and use `tinyfish search query` plus `tinyfish fetch content get` through ordinary shell commands, explicitly omits mutable TinyFish skill URLs as generated sources, `web_search`, `web_fetch`, `svvyx web`, generated Web TypeScript clients, Firecrawl, Web Provider settings, and svvy-owned TinyFish key storage, and tells agents to redirect large TinyFish JSON output to files when useful because the tested CLI writes search and fetch results to stdout by default.",
    sourceSpecs: [
      "docs/specs/extension/web.extension.spec.md",
      "docs/specs/extensions-and-tools.spec.md",
    ],
  },
  {
    id: "handler-thread-surfaces",
    name: "Delegated Handler Thread Surfaces",
    status: "in-progress",
    summary:
      "Lets the orchestrator open pi-backed delegated handler threads as fully interactive conversation surfaces that own delegated objectives, with one shared native implementation exposed as `thread-orchestration` for orchestrators (`thread_start`, `thread_followup`, `thread_list`, `thread_episodes`, `thread_request_report`) and `thread-handling` for handlers (`thread_current`, `thread_group`, `thread_report`, `thread_episodes`) while workflow task agents receive neither extension by default; `thread_start` takes a required `threads[]` array, normally with one item, creates or appends to one durable `threadGroupId`, defaults each item's `history` to `isolated`, allows explicit `forked` starts only for conservative continuity cases, allows multiple items only for separate user-visible handler conversations, and optionally applies each item's `overrides` map over the `threadHandler` profile with `loaded`, `available`, or `unavailable` states; the thread API keeps handler-thread UI titles outside agent results, leaves threads multi-turn and directly messageable before and after objective conclusion, exposes group identity, lets the orchestrator send corrections or later work through `thread_followup`, request one-handler updates through `thread_request_report`, lets handlers emit intermediate update episodes or sibling-forwarding requests through `thread_report`, and returns control to the orchestrator only through explicit `thread_report` calls with `outcome` that append ordered conclusion episodes and schedule typed orchestrator reconciliation notifications.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
      "docs/specs/structured-session-state.spec.md",
    ],
  },
  {
    id: "agents-and-extensions",
    name: "Agents And Extensions Prompt Composition",
    status: "in-progress",
    summary:
      "Defines prompt composition around Agents and Extensions: agent profiles own model/reasoning, actor kind defaults, sparse per-extension usage overrides selected from compact Agents-pane Loaded/Available/Off icon controls, underlines overridden extension names consistently in compact and expanded rows, exposes an icon-only tooltiped action for overridden orchestrator and workflow task-agent rows in compact menus and immediately before expanded Loaded/Available/Off controls to make that row state the future actor default, and links each row to the matching Extensions inventory record. Normal builtin and user extensions share one composable base: editable minimal instruction source except fixed always-loaded Extension Loading may omit it, zero or more loaded instruction contributors, editable Markdown loaded contributors, scripted loaded contributors made from editable TypeScript generators plus read-only last generated Markdown output and regenerate/build action, per-contributor skip state, remove-to-trash behavior for editable source contributors, optional CLI requirements, optional native tool schema, optional `svvyx` command source plus generated command schema, optional generated TypeScript API declaration, local editable sources under `~/.config/svvy/extensions/sources/...` with packaged builtin defaults used only for scaffold/reset, editable `svvyx` `source/index.ts`, generated `commands.json` command schema, optional generated `execute_typescript` API declaration, backend-derived customized tags, inventory filters, reset/delete controls, and requirement readiness surfaced through `list_extensions` and Extension Managing inspection. Direct builtin prompt text, including base prompts and native-tool guidance, is exposed as editable loaded source contributors rather than fake generated output; scripted contributors are reserved for extensions with a real generator/source pair such as cx, Web, or Smithers. External instruction records are separate read-only discovered instruction inputs with no minimal hint or source lifecycle. Extension defaults are future-facing profile policy for newly created orchestrator sessions and workflow task-agent attempts; the singleton handler profile stays owned by Agents and can still be customized there. New user extensions start loaded by default for new orchestrators and workflow task agents unless the user changes their per-actor defaults before use, and existing surfaces change only through the normal generated-context fingerprint refresh flow. Extension snapshots include a default saved Initial baseline when no local snapshots exist, and user snapshots remain local restore points for source, package, usage, ordered contributors, skip/default state, generated-contributor source/output state, customized tags, and coarse secret-state preservation. Base actor prompts are builtin instruction-only extensions: `base-common` is loaded by default for every adopted actor kind, while `base-orchestrator`, `base-handler`, and `base-workflow-task` are loaded by default by the corresponding default profile; other actor-specific behavior is modeled as separate extension ids rather than actor-conditional loaded text inside one extension. The shared native thread-control implementation is exposed as two builtin agent-facing extension records: `thread-orchestration` loaded by default only for orchestrators and `thread-handling` loaded by default only for handler threads. Generated context previews show loaded base instruction extensions, non-skipped loaded contributors, active extension-row token estimates in an aligned column with available rows showing available-prompt estimates plus would-be loaded-prompt estimates in parentheses and Off rows omitted from token counting, workflow-agent inline instruction live token estimates on expanded source-file metadata rows, total generated prompt token estimates in expanded Agents rows that include the current workflow-agent inline instruction draft when present, native tool declarations, loaded svvyx guidance, and emitted generated TypeScript client declarations; workflow-agent autosave keeps unrelated row controls visually stable instead of using transient saving state as broad disabled styling; Incur-backed extensions are built behind one stable app-owned `svvyx <extension-id> ...` CLI, with usage state controlling generated guidance while generated clients are emitted only for TypeScript-API-enabled `svvyx` extensions safe for the target actor, and dependency-backed build readiness uses an app-global approval ledger keyed by exact dependency and trusted-dependency identities rather than shell approval, resumes blocked build and snapshot-load install work after approval, installs from a controlled app-owned package plan with lifecycle scripts disabled unless the exact trusted identity is approved, and validates exact installed package artifacts before runtime use; builtin prompt-only cx guidance is loaded by default for all adopted agent kinds and teaches official `cx` CLI use through `exec_command`, builtin prompt-only Git guidance is loaded by default for all agent kinds, builtin prompt-only GitHub guidance is loaded by default for orchestrators and handler threads and available for workflow task agents, these prompt-only CLI extensions use ordinary shell commands without wrapper tools or generated clients, and new surfaces bind to the latest ready generated agent context while existing surfaces receive durable `Update agent context` work when their fingerprint differs.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/extension/svvyx-incur-runtime.spec.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
      "docs/specs/extension/extension_managing.extension.spec.md",
      "docs/specs/extension/web.extension.spec.md",
      "docs/specs/extension/cx.extension.spec.md",
      "docs/specs/extension/git.extension.spec.md",
      "docs/specs/extension/github.extension.spec.md",
      "docs/specs/extension/external_instructions.extension.spec.md",
      "docs/specs/extension/extension_loading.extension.spec.md",
      "docs/specs/extension/artifacts.extension.spec.md",
      "docs/specs/structured-session-state.spec.md",
    ],
  },
  {
    id: "smithers-cli-guidance",
    name: "Prompt-Only Smithers CLI Guidance",
    status: "in-progress",
    summary:
      "Defines Smithers as a builtin prompt-only extension for handler-thread workflow authoring, generated from the current Extension Managing-selected Smithers documentation version with a small svvy boundary appendix; agents use the checked global `smithers` CLI binary through Shell against workspace `.smithers/` packages, upstream `bunx smithers-orchestrator` examples are rewritten to `smithers`, TypeScript source still imports from package `smithers-orchestrator`, reusable svvy values are imported from `@svvy/workflows`, and agents do not receive product workflow wrapper tools, native Smithers bridge tools, generated Smithers TypeScript clients, or workspace-local svvy workflow source guidance.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extension/smithers.extension.spec.md",
      "docs/specs/workflow-library.spec.md",
    ],
  },
  {
    id: "workflow-task-agent-parameters",
    name: "Reusable Workflow Task-Agent Parameters",
    status: "in-progress",
    summary:
      "Represents reusable Smithers task-agent configuration as structured `TaskAgentParameters` records under `~/.config/svvy/workflows/agents`, generated as `Agents.*` exports in `@svvy/workflows`, with `Agents.defineTaskAgent` and `Agents.TaskAgentParameters` also exported under the same namespace; Agents-pane edits and `svvyx workflows save --kind agent` write the same structured source, and build validates provider/model/reasoning plus sparse extension usage overrides against pi-normalized provider metadata and generated `@svvy/extensions` instead of accepting freeform agent code.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/workflow-library.spec.md",
      "docs/specs/extension/workflows.extension.spec.md",
    ],
  },
  {
    id: "context-budget-observability",
    name: "Context Budget Observability",
    status: "shipped",
    summary:
      "Shows active context usage as a percentage of the current model's maximum for orchestrator surfaces, handler-thread surfaces, workflow task-agent attempts, and individual assistant messages, with neutral below 40%, orange from 40%, red from 60%, decimal percentages, and hover details so context pressure is visible without treating any single percentage as a universal model failure point.",
    sourceSpecs: ["docs/prd.md", "docs/specs/context-budget-observability.spec.md"],
  },
  {
    id: "workflows-extension",
    name: "Workflows Source Library Extension",
    status: "in-progress",
    summary:
      "Provides the builtin Incur-backed `svvyx workflows ...` command family for app-global reusable Smithers source: `list` reports generated export names and source/generated paths, `save` copies or extracts reusable agents, prompts, components, or workflows from a workspace path with strict overwrite handling and automatic build, `build` first builds Extensions and generated `@svvy/extensions`, then validates Workflows source and generates `@svvy/workflows`, and `models list` reports pi-backed provider/model/reasoning options for task-agent parameter authoring; it never runs, resumes, approves, or inspects active Smithers workflows.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/workflow-library.spec.md",
      "docs/specs/extension/workflows.extension.spec.md",
    ],
  },
  {
    id: "saved-workflows-generated-surface",
    name: "Saved Workflows Generated Surface",
    status: "shipped",
    summary:
      "Surfaces the latest successful generated `@svvy/workflows` package in a read-only Workflows pane with namespace, export name, qualified name, generated code, generated-file link, and source-file link for `Agents`, `Components`, `Prompts`, and `Workflows`; `Agents.*` rows also show the generated parameter object and a human UI link into the Agents pane for customization.",
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
    id: "queued-surface-messages",
    name: "Queued Surface Messages",
    status: "in-progress",
    summary:
      "Lets a user, orchestrator, or backend coordinator submit prompt-bearing and surface-control work to an orchestrator or handler-thread surface by placing it in a durable FIFO queue owned by the target `surfacePiSessionId`; ordinary sends, idle sends, `thread_followup` requests, initial handler starts, report requests, thread report notifications, request-user-input answers, and agent context refreshes all go through the queue manager, while a row-level `Steer` action promotes a durable row to the front for ordered next-turn delivery rather than injecting a direct pi steering prompt; queued items are claimed atomically by one shared queue runner per `surfacePiSessionId`, active-surface follow-ups stay visible as editable queued rows until claimed, idle-surface items are claimed before renderer-visible queued state so their first visible state is pending or active work, committed user transcript messages expose copy plus edit-and-resend with a visible transcript highlight for the message under edit and a draft-replacement warning before overwriting non-empty composer input, then move the same pi surface back to the original message's parent state before continuing from the edited message, queue rows remain structured product state until delivered, survive panel focus changes and duplicated panels, write user prompt history once at queue time only for user messages, and stay recoverable across restart, cancellation, restore-to-composer, and pre-accept delivery failure.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/queued-messages.spec.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
    ],
  },
  {
    id: "composer-mention-links",
    name: "Composer Mention Links",
    status: "shipped",
    summary:
      "Lets the composer autocomplete indexed workspace files and folders after `@` as ordinary inline `@path` text, attach picker/drop/paste files as removable chip-only attachments without mutating textarea text, render sent file, folder, and image attachments as transcript tiles without visible attachment-provenance prose, pass attachment paths through tagged agent-facing metadata, send images to pi as image content blocks while warning when model metadata does not list image input, and render sent transcript mentions as actionable workspace links that reveal files, open folders, and visibly mark missing paths without eager file reads, folder expansion, or a special context-target model.",
    sourceSpecs: ["docs/specs/composer-mention-links.spec.md", "docs/progress.md"],
  },
  {
    id: "assistant-markdown-rendering",
    name: "Assistant Markdown Rendering",
    status: "shipped",
    summary:
      "Renders streamed assistant transcript Markdown inside a TanStack Virtual transcript surface with compact prose spacing, reliable list markers, GitHub-style tables and task lists, syntax-highlighted fenced code blocks with copy actions, inline and display math through KaTeX, Mermaid diagrams rendered as SVG with source copy fallback, escaped raw HTML so assistant output cannot inject executable markup, muted collapsed-by-default reasoning blocks that render visible reasoning text as Markdown rather than preformatted code, variable-height row measurement, pane-local scroll restoration, and bottom-following only while the user is pinned there; live assistant output preserves each provider/runtime stream packet as a visible update through compact ordered stream patches, while full surface snapshots are reserved for baseline, recovery, and settled-state sync; active assistant work shows a durable elapsed clock in the composer, and completed assistant transcript messages show the persisted turn duration from structured turn start and finish timestamps.",
    sourceSpecs: ["docs/prd.md"],
  },
  {
    id: "workspace-navigation-core-projection",
    name: "Workspace Navigation And Core Projection",
    status: "shipped",
    summary:
      "Keeps each workspace tab navigable with pinned, regular Sessions, and Archived session groups in a shared sidebar band between creation/search actions and reference panes; each group uses the same collapsible accordion header style, keeps its own independently scrollable and resizable space, persists collapsed state and size across restart, and keeps Archived collapsed by default. It also provides durable session-level unread dots that appear when assistant turns finish outside the focused pane surface and clear on session-pane focus or explicit mark-read action, layered sidebar rows where orchestrator session state and handler-thread state stay local to their owning rows, session row context menus for mark read or unread, pin, rename, archive, and a menu-local Confirm delete action, normal session-row clicks that open in the focused Dockview panel with Cmd-click opening a new pane, compact running indicators, tone-aware open-pane highlighting, context-budget rails for open orchestrator and handler rows, a sidebar footer that shows the current git branch with a branch icon and opens a local-branch switcher when the workspace is a git repo, compact thread artifact blocks backed by durable artifact records, and restart restoration for stable Dockview panel bindings, static inspector pane targets, focus, panel-local scroll, display preferences, durable composer drafts, and session-group layout while deliberately excluding transient UI, transcript selections, and stale live stream state.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/pane-layout.spec.md",
      "docs/specs/workspace-navigation-core-projection.spec.md",
      "docs/specs/multi-session-support.spec.md",
      "docs/specs/structured-session-state.spec.md",
    ],
  },
  {
    id: "command-palette",
    name: "Command Palette And Quick Open",
    status: "in-progress",
    summary:
      "Defines a VS Code-like shared palette where `Cmd+Shift+P` opens the same input as `Cmd+P` with `>` prefilled, those launcher chords remain available while text inputs are focused and switch the focused palette between command and quick-open modes when it is already open, the leading `>` live-switches quick-open search into command/action mode, command mode discovers and executes product actions through existing session, surface, orchestrator, handler-thread, Dockview panel, settings, Agents profile routing, Extensions routing, and read-only Workflows visibility, including profile-specific New orchestrator actions, a product shortcut registry backed by TanStack Hotkeys owns scoped renderer dispatch, input policy, and shared shortcut display, sidebar shell actions reveal compact shortcut hints instantly on hover or focus, New orchestrator uses `Cmd+N` for the focused pane and `Cmd+Shift+N` for a new pane, Logs, Agents, Extensions, and Workflows open from `Cmd+Shift+1/2/3/4` in sidebar order, icon-only or ambiguous action controls show faster delayed explanatory tooltips with consistent keycap chips, open-session results show visually distinct kind badges across orchestrator and handler-thread categories, `Cmd+P` opens reserved file quick-open mode with disabled or empty results until file surfaces are part of the product contract, `cmdk-sv` is the intended Svelte UI primitive, and unmatched non-empty command-mode text creates a normal new orchestrator initial prompt without the `>` prefix or a parallel runtime, shell, terminal loop, or workflow abstraction.",
    sourceSpecs: ["docs/prd.md", "docs/specs/command-palette.spec.md"],
  },
  {
    id: "agent-profiles",
    name: "Agents Pane And Agent Profiles",
    status: "in-progress",
    summary:
      "Provides an Agents pane between Logs and Extensions that owns app-wide orchestrator profiles, the delegated-handler `threadHandler` profile, and workflow-agent profiles, persists provider, model, reasoning, extension usage selections, per-profile extension instruction order, and profile metadata as app-global settings, uses builtin `base-*` instruction extensions for base role prompts, prevents orchestrator and handler-thread profiles from carrying profile-local instruction text, prepends workflow-agent row instructions as the only non-extension instruction input before that workflow task agent's generated extension context, lets users create or duplicate additional orchestrator and workflow-agent profiles, deletes user-created profiles through an inline single-confirm action, drives the New orchestrator picker order and profile badges from the orchestrator-profile order, keeps the default orchestrator profile locked, first, non-draggable, and non-deletable while still allowing settings edits, keeps the default Explorer, Implementer, and Reviewer workflow agents non-deletable while still allowing edits and duplication, autosaves workflow-agent instruction textarea edits after a short debounce with an icon-only unsaved/saving/saved/failed state inside the textarea while preserving saved source whitespace and trimming only during prompt composition, links each workflow-agent row to its exact `.agent.json` source file and shows a live inline-instruction token estimate beside that link only when the row is expanded, lets profile-backed orchestrator sessions optionally save composer model and reasoning changes back to their profile for future sessions, uses internal title-naming settings for top-level session titles and handler-thread titles derived from delegated objectives without exposing title naming as a special profile, uses the delegated-handler `threadHandler` profile for delegated handler-thread surfaces with partial extension-state overrides available through `thread_start.threads[].overrides`, shows expanded orchestrator, handler, and workflow-agent profiles as one extension list with usage controls, open-extension links, aligned active extension-row token estimates, available-row available-prompt estimates with loaded-prompt estimates in parentheses, expandable generated instruction text, Off rows at the end without token counts, drag-only active-row ordering animation, stable in-place Loaded/Available/Off state updates, reset-selection/reset-order actions, and the total generated prompt token estimate beside those reset controls while including the current workflow-agent inline instruction draft, exposes focused-surface agent summaries in pane chrome, and uses direct-saving profile editors with connected-provider model dropdowns plus selected-model reasoning dropdowns derived from pi's normalized model metadata and runtime thinking controls rather than svvy-owned provider/model special cases.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/workflow-library.spec.md",
      "docs/specs/command-palette.spec.md",
    ],
  },
  {
    id: "multi-session-support",
    name: "Multi-Session Workspace Navigation",
    status: "shipped",
    summary:
      "Supports creating, listing, switching, renaming, forking, pinning, archiving, and confirmed context-menu deletion for multiple pi-backed session containers from one workspace window, with archive serving as the normal hide action while preserving session history, live provisional titles from the first orchestrator composer draft or first user message until the durable one-shot namer title lands, top-level session auto-titling owned by a durable namer flow that starts concurrently with the first orchestrator turn, the namer settings prompt as the sole naming instruction, manual rename blocked while title generation is pending or running, titles frozen after manual rename or the first successful generated title, and delegated handler titles owned by the same namer flow over the handler objective rather than by an orchestrator-supplied title.",
    sourceSpecs: ["docs/specs/multi-session-support.spec.md"],
  },
  {
    id: "multi-surface-runtime",
    name: "Multi-Surface Live Runtime",
    status: "in-progress",
    summary:
      "Separates integrated app-chrome workspace tabs, shared durable workspace state, live surface runtimes, and Dockview-backed user workspace layout slots, using one backend workspace runtime per canonical cwd with explicit `workspaceId` routing for every workspace-scoped request and sync event, never active workspace routing; keeps workspace tabs as chrome state that select `workspaceId` plus active layout id instead of owning durable layouts; opens a real svvy-owned default workspace tab with exactly one `Open Workspace` pane when no user workspace tabs restore; lets `Open Workspace` retarget the current visual tab, `New Tab` create another default workspace tab with exactly one `Open Workspace` pane and no durable layout slots, and `Open Workspace in New Tab` create a selected user workspace tab; allows opening the same cwd in multiple visual workspace tabs that share the same runtime, session catalog, pi sessions, structured state, prompt queues, handler threads, app logs, workspace read models, saved Workflows generated-state visibility, and fixed durable layout slots keyed by `(workspaceId, layoutId)`; keeps workspace tabs left-aligned at the start of the main chrome, horizontally scrollable when crowded, draggable for user reordering, durably restored in user-defined order, and paired with compact icon controls plus colored running, unread, waiting, and error count badges shown only above zero with hover context; uses Dockview core for panels, groups, tabs, tab groups, splitters, drag/drop overlays, edge groups, floating groups, popouts, and serialized layout restore inside fixed user workspace layout slots A, B, and C pinned at the far right while svvy stores panel-to-surface bindings and panel-local metadata in those slots; keeps empty user workspace layout slots muted but selectable, manages live pi surfaces in a shared registry keyed by `surfacePiSessionId`, gives each surface its own prompt lock, model or reasoning lifecycle, pending user message, queued follow-up messages, and surface-owned live assistant stream state, supports explicit open and close semantics, sidebar panel-location indicators, compact thread projections, and lets zero, one, or multiple panels attach to the same streaming surface without duplicating or cancelling the underlying runtime while keeping panel-local scroll independent per panel.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/default-workspace-and-open-workspace.spec.md",
      "docs/specs/multi-session-support.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/pane-layout.spec.md",
      "docs/specs/workspace-navigation-core-projection.spec.md",
    ],
  },
  {
    id: "workspace-runtime-recovery",
    name: "Workspace Runtime Recovery Coordinator",
    status: "in-progress",
    summary:
      "Defines one backend-owned recovery coordinator per acquired workspace runtime, with duplicate same-cwd tabs sharing recovery state, app-wide auth/preferences kept outside workspace recovery, durable scheduler records with transactional claims and idempotency keys for prompts, queues, initial handler starts, thread report notifications, report requests, request-user-input records and answer queue items, waits, title jobs, Workflows build/link refresh, and recovery observability, while renderer layout restore remains only a consumer of backend snapshots.",
    sourceSpecs: ["docs/specs/workspace-runtime-recovery.spec.md"],
  },
  {
    id: "structured-session-state",
    name: "Structured Session State Overlay",
    status: "in-progress",
    summary:
      "Adds a workspace-scoped svvy-owned product state layer above pi with durable session, surface composer draft, turn, handler thread, command, episode, artifact, saved Workflows generated metadata, attention, and lifecycle projection records, explicit surface-target identity (`workspaceSessionId`, `surfacePiSessionId`, `threadId`), and workspace-level metadata projection that survives reload while leaving live-surface transcript updates separate from durable workspace read models.",
    sourceSpecs: [
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
    ],
  },
  {
    id: "turn-command-state",
    name: "Turn And Command State",
    status: "in-progress",
    summary:
      "Tracks every turn on the orchestrator surface and handler thread surfaces, including each turn's top-level turn decision, plus every tool call including execute_typescript snippets, request_user_input calls, and generated-client child command facts, as durable state with lifecycle status, ownership, linkage, attempts, trace-versus-surface visibility, and ordered command projection events for output, progress, patch/file-change snapshots, approvals, request-user-input waiting, generic waits, child links, workspace diff updates, and terminal facts.",
    sourceSpecs: [
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/live-tool-projection.spec.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
    ],
  },
  {
    id: "session-threads",
    name: "Structured Handler Threads",
    status: "in-progress",
    summary:
      "Tracks delegated handler threads as durable interactive surfaces keyed separately from workspace session containers and pi surface ids, with durable thread-group topology, objective, objective state, worktree context, explicit orchestrator follow-up and re-engagement of concluded objectives through `thread_followup({ activate: true })`, pending report requests, and multiple update or conclusion episodes over the thread's lifetime without flattening delegated-work outcome into thread objective state.",
    sourceSpecs: [
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
    ],
  },
  {
    id: "durable-episodes",
    name: "Durable Episodes",
    status: "in-progress",
    summary:
      "Stores reusable semantic outputs as first-class episode records, with handler threads able to emit multiple ordered update or conclusion episodes over their lifetime through explicit `thread_report` calls whose conclusion success boundary is durable episode recording plus objective-state conclusion, including orchestrator-local episodes when substantive local work completes, while ordinary tool runs keep their own command summaries and artifacts.",
    sourceSpecs: [
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
    ],
  },
  {
    id: "session-wait-state",
    name: "Session Wait And User Input State",
    status: "in-progress",
    summary:
      "Represents handler-owned blocking conditions and request-user-input clarification records explicitly through surface-local request/wait state and whole-session frontier state, preserving the product meaning of user input, approval, or other external dependency while requiring user clarification waits to point at real request-user-input records.",
    sourceSpecs: [
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/extension/request_user_input.extension.spec.md",
    ],
  },
  {
    id: "session-summary-read-models",
    name: "Metadata-First Session Read Models",
    status: "in-progress",
    summary:
      "Derives orchestrator-local idle, running, waiting, and error session status, pinned and archived navigation fields, row-local handler-thread projections, pending attention, saved Workflows generated-state visibility, and compact summary data from structured state for workspace navigation and restart recovery without rolling child handler lifecycle state into the parent session row, transcript replay, transcript-file heuristics, or any global active-surface overlay.",
    sourceSpecs: [
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/workspace-navigation-core-projection.spec.md",
    ],
  },
  {
    id: "app-logs-surface",
    name: "App Logs Surface",
    status: "shipped",
    summary:
      "Provides workspace-scoped product observability through structured, redacted, persisted app logs with monotonic sequence numbers, unread state, live renderer updates, a sidebar Logs entry with compact action-worthy unread badges for warning and error logs only, and a dense Dockview logs pane with TanStack Virtual long-scroll rendering, native end anchoring, older-page loading, level/source/search filtering, mark-read behavior, explicit Live/Frozen tail control, smooth explicit jump-to-latest with reduced-motion fallback, expandable details, normalized errors, stack traces, and related session, surface, thread, workflow, task, command, and artifact ids without making logs canonical product state.",
    sourceSpecs: ["docs/specs/app-logs.spec.md"],
  },
];
