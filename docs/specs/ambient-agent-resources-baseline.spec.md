# Ambient Agent Resources Baseline Spec

## Status

- Date: 2026-05-19
- Status: working baseline for ambient agent resource handling
- Scope of this document:
  - define `svvy`-owned external instruction discovery
  - define ignored native prompt replacement files
  - define disabled ambient callable capabilities
  - define disabled runtime extensions and packages
  - define disabled ambient skills
  - explicitly defer prompt macros and snippets
  - define disabled ambient commands and hooks
  - define host UI and interaction resources as unsupported
  - define provider and model adapters as app-owned
  - define credentials and auth state as app-owned
  - define execution policy as app-owned
  - define ambient runtime state import as unsupported
  - define the pi opt-outs needed for orchestrator, handler-thread, and workflow task-agent surfaces

This is the narrow baseline. It intentionally does not design general settings UI for extensions,
skills, packages, host plugins, MCP imports, provider adapters, credentials, themes, prompt macros,
or execution policy. Other integrations can become separate first-class integrations later if there
is demand.

## Product Intent

`svvy` owns the actor contract.

Host-discovered resources must not silently change what an actor sees, what tools it can call, what
commands exist, or what prompt text reaches the model. For the baseline, `svvy` keeps only the pieces
we actually want:

- `svvy` discovers and controls plain `AGENTS.md` and `CLAUDE.md` external instruction files.
- `svvy` ignores native prompt replacement files.
- `svvy` ignores ambient tools, extensions, packages, and skills.
- `svvy` registers actor tools through its own product-owned tool registry.
- `svvy` does not discover or expand host prompt macros in this design.

The goal is not a large permission system. The goal is a small, deterministic surface that does not
surprise us.

## Actor Coverage

The baseline applies to every pi-backed `svvy` actor:

- orchestrator
- handler thread
- workflow task agent

No agent profile enables ambient host resources by default. If a future product agent family is
added, its default profile starts from the same ambient-resource default-off rule.

## 1. External Instructions

External instructions are the only ambient-looking prompt files that `svvy` supports in the
baseline.

Supported filenames:

- `AGENTS.md`
- `CLAUDE.md`

They are external read-only Markdown files. They are not editable `svvy` base instructions or
managed extension source. `svvy` controls only whether and where the file is used.

### Discovery Sources

`svvy` discovers external instructions from two source groups.

#### Global Roots

Global roots are app-level configurable directories.

The builtin global roots are the root configuration directories where supported coding-agent hosts
normally store global standards:

- pi
- Codex
- Claude

The exact platform paths are implementation-owned, but they must be shown plainly in settings.

Users can:

- enable or disable each builtin root
- add custom root directories with a directory picker
- remove custom roots
- reset the root list to the builtin default state

For each enabled global root, `svvy` checks direct child files only:

- `<root>/AGENTS.md`
- `<root>/CLAUDE.md`

#### Workspace Chain

For the selected workspace, `svvy` checks the workspace directory and each ancestor directory up to
filesystem root.

For each directory in that chain, `svvy` checks direct child files only:

- `<directory>/AGENTS.md`
- `<directory>/CLAUDE.md`

This is ancestor-chain discovery, not recursive discovery. `svvy` must not search arbitrary
descendants such as `<root>/**/AGENTS.md`.

### Default Enablement

`svvy` discovers both `AGENTS.md` and `CLAUDE.md` when both exist.

When both files exist in the same directory:

- `AGENTS.md` is enabled by default
- `CLAUDE.md` is disabled by default

When only one supported file exists in a directory:

- that file is enabled by default

Defaults apply only when a file has no persisted user control record yet. Once the user changes a
file's enablement or actor selection, the persisted user choice wins.

### Ordering

External instructions are composed in deterministic order:

1. global-root files, ordered by configured root order
2. workspace-chain files, ordered from filesystem root toward the workspace directory
3. within the same directory, `AGENTS.md` before `CLAUDE.md`

This keeps broad instructions before more specific workspace instructions.

### Extensions UI

External instructions appear in the Extensions pane as read-only records with category
`external_instruction`:

```text
Extensions
- shipped
- user
- external_instruction
```

`external_instruction` is its own category. It is not folded into shipped native built-ins, user
extensions, editable base instructions, or prompt-only shipped extensions.

Each external instruction row shows:

- global root management
- live discovered files for the selected workspace
- source group: builtin global root, custom global root, or workspace chain
- absolute path
- read status
- read-only live content
- content hash
- enabled checkbox
- actor chips for orchestrator, handler, and workflow task agent
- external-editor action

External instructions do not support:

- editing content inside `svvy`
- renaming the file
- deleting the file
- content reset
- `builtin` or `edited` badges used by editable prompt blocks

### Persistence

External instruction persistence has two layers.

App-global settings store:

- builtin root enabled states
- custom root paths
- custom root enabled states
- controls for files discovered under global roots

Workspace-specific settings store:

- controls for workspace-chain files

Workspace-chain controls are keyed by:

```text
workspace key + canonical file path
```

They are visible and active only for that workspace. If the user wants an ancestor directory to behave
as a global root across workspaces, they can add that directory to the global roots list explicitly.

For each controlled file, `svvy` persists the same per-agent usage controls used by other
extensions:

```ts
type ExternalInstructionActor = "orchestrator" | "handler" | "workflow-task";

type ExternalInstructionControl = {
  enabled: boolean;
  actors: ExternalInstructionActor[];
};
```

The file content itself is not copied into editable extension or agent-profile state. `svvy` reads
live content from disk for previews and generated agent context composition, and computes a content
hash.

Unreadable files remain visible with a read error and are excluded from prompt composition until they
can be read again.

### Agent Context Composition

Only enabled, actor-selected, readable external instructions are included.

The adopted generated agent context order is:

1. selected base instructions
2. enabled external_instruction records
3. loaded extension instructions and command guidance
4. generated actor-specific tool declarations and TypeScript declarations

Generated actor-specific declarations remain last so exact tool declarations and generated contracts
stay close to the end of the system prompt.

### Agent Context Freshness

External instructions participate in normal generated agent context freshness.

Settings changes create a new generated agent context fingerprint:

- root list changes
- root enabled state changes
- external instruction enabled state changes
- external instruction actor selection changes

File changes can alter the generated agent context fingerprint even when no settings revision changed:

- file content changes
- file appears
- file disappears
- file read status changes

Existing surfaces store the generated agent context fingerprint they received. If current external
instructions or resolved generated context output differ from the bound generated agent context, the
normal automatic `agent_context_refresh` flow applies. External instruction changes do not use a
separate manual warning or update flow.

### Pi Standards Opt-Out

Pi currently has its own standards discovery. It checks `AGENTS.md` and `CLAUDE.md` through
`getAgentsFiles()`, and its current helper chooses only the first matching candidate per directory.

`svvy` does not use pi's standards as source of truth for external instructions.

For every pi-backed `svvy` actor, the pi resource loader must receive:

```ts
agentsFilesOverride: () => ({ agentsFiles: [] });
```

External instructions reach the model only through the `svvy`-composed system prompt.

## 2. Native Prompt Replacement

Native prompt replacement means host-specific files that replace or append the system prompt outside
`svvy`'s generated agent context model.

For pi, this includes:

- `SYSTEM.md`
- `.pi/SYSTEM.md`
- `APPEND_SYSTEM.md`
- `.pi/APPEND_SYSTEM.md`

Baseline decision:

- ignore them completely
- do not import them
- do not show them as a supported compatibility surface
- do not let pi append or replace prompt text with them

Rationale: pi compatibility is not important enough to support this behavior. The product should
focus on explicit `svvy` prompts and practical compatibility with Codex and Claude-style standards.

For every pi-backed `svvy` actor, the resource loader must receive:

```ts
systemPromptOverride: () => svvyComposedActorPrompt,
appendSystemPromptOverride: () => []
```

## 3. Callable Capabilities

Callable capabilities are functions the model can call.

Examples:

- `exec_command`
- `write_stdin`
- `apply_patch`
- `thread_start`
- `smithers_run_workflow`
- `execute_typescript`
- MCP tools
- extension-provided tools
- host built-in tools

Baseline decision:

- callable capabilities are product-owned
- actors receive only tools explicitly registered by `svvy`
- ambient host tools are ignored
- no hidden tools are allowed

Actor surfaces stay split:

- orchestrator gets orchestrator tools
- handler thread gets handler tools, including Smithers tools
- workflow task agent gets task-local tools

Generated tool declarations must match the actual actor tool registry.

Pi risk:

- pi extensions can register tools and commands
- pi default tools can exist if selected through pi's normal tool declaration path

Baseline pi rule:

- create sessions with pi built-in tools disabled
- pass only `svvy`-owned `customTools`
- keep extension resources disabled so no extension tools can appear
- keep generated declarations derived from the `svvy` registry, not pi discovery

## 4. Runtime Extensions And Packages

Runtime extensions and packages are executable code bundles that can change agent behavior.

Examples:

- pi extensions
- pi packages
- Codex plugins
- MCP server packages
- Claude Desktop extension or server packages
- any package that can register tools, commands, hooks, UI, providers, prompt assets, or skills

Difference from callable capabilities:

- the package/extension is the installed code bundle
- the callable capability is a tool/function it may register

Baseline decision:

- ignore runtime extensions and packages completely
- do not scan package directories for behavior
- do not execute package code for discovery
- do not expose package-provided tools, prompts, skills, themes, commands, hooks, UI, or providers
- do not build package enable/disable UI yet

Future support must be a first-class `svvy` integration with explicit install and enablement UX.

Pi risk:

- pi auto-discovers project and global extension directories
- pi settings can list `packages`, `extensions`, `skills`, `prompts`, and `themes`
- pi packages can contribute multiple resource categories
- extension factories passed through the SDK can load inline extensions
- `extendResources()` can add extension-provided skill, prompt, and theme paths after reload

Baseline pi rule:

```ts
noExtensions: true,
noSkills: true,
noPromptTemplates: true,
noThemes: true,
additionalExtensionPaths: [],
additionalSkillPaths: [],
additionalPromptTemplatePaths: [],
additionalThemePaths: [],
extensionFactories: [],
```

`svvy` must not call `extendResources()` with ambient skill, prompt, or theme paths for actor
surfaces.

Because pi's `no*` flags still allow explicit temporary or additional paths, `svvy` must keep those
path arrays empty for baseline actors.

## 5. Skills

Skills are instruction bundles a host can expose to the agent on demand.

They may include:

- metadata
- `SKILL.md`
- references
- scripts
- assets
- dependencies

Examples:

- pi skills
- Codex skills
- Claude-style skills
- repo-local `.agents/skills`
- global user skills

Baseline decision:

- ignore ambient skills
- do not expose skill metadata to actors
- do not add skill descriptions to prompts
- do not register `/skill:name` commands
- do not execute or suggest skill scripts
- do not import skills into Extensions or generated agent context automatically

Future support should be explicit, likely as an import or enable flow that shows the source path and
exact included files.

Pi risk:

- pi loads skills by default from `~/.pi/agent/skills`, `~/.agents/skills`, `.pi/skills`, and
  ancestor `.agents/skills`
- pi packages and settings can add skills
- pi adds available skill metadata to the system prompt when skills are loaded
- pi registers skills as `/skill:name` commands by default
- pi expands `/skill:name` prompts into full skill content

Baseline pi rule:

```ts
noSkills: true,
additionalSkillPaths: [],
```

Since pi slash-command lists include loaded skills, keeping `getSkills().skills` empty also prevents
skill commands from being exposed.

## 6. Prompt Macros And Snippets

Snippets are product-owned prompt macros specified in `docs/specs/snippets.spec.md`.

They are not part of the Extensions capability model. They do not grant tools, mount commands, change
generated declarations, or alter generated agent context.

Baseline decision:

- keep host prompt-template and command runtimes disabled
- let `svvy` own any Snippet discovery, editing, insertion, argument substitution, and expansion
- do not let prompt-macro metadata grant tools, commands, hooks, model selection, provider behavior,
  generated declarations, generated agent context, execution policy, or UI behavior

For pi-backed actors:

- keep `noPromptTemplates: true`
- keep `additionalPromptTemplatePaths: []`
- keep `promptsOverride: () => ({ prompts: [], diagnostics: [] })`
- submit user text with pi prompt-template and slash-command expansion disabled when that option is
  available

Claude and Codex runtimes are not invoked for prompt macro discovery or expansion. `svvy` reads
supported Markdown files directly when the Snippets feature is implemented.

## 7. Commands And Hooks

Commands are runtime actions registered by a host or extension.

Hooks are automatic lifecycle handlers that run before, during, or after agent events such as prompt
submission, tool calls, session start, compaction, provider requests, or shutdown.

They are different from prompt macros, which are deferred in this design. Commands and hooks can
execute code, route work, mutate input, block operations, modify tool
  arguments, modify tool results, inject context, or change UI/runtime behavior.

Examples:

- pi extension slash commands
- pi extension `pi.on(...)` event handlers
- pi input, tool-call, tool-result, user-bash, provider-request, and session lifecycle handlers
- Claude hook configuration under supported settings files
- Codex hook configuration such as `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`,
  `PreCompact`, `PostCompact`, `PermissionRequest`, and `Stop`
- plugin-provided commands or hooks
- MCP prompt or command-like host entries

Baseline decision:

- disable all ambient host commands and hooks
- do not list ambient commands in the composer, command palette, or `@` picker
- do not execute host slash commands
- do not run host lifecycle hooks
- do not let hooks transform user input
- do not let hooks add hidden generated agent context
- do not let hooks mutate tool arguments or tool results
- do not let hooks approve, block, or reroute `svvy` tool calls
- do not let hook metadata grant tools, permissions, provider behavior, UI behavior, or execution
  policy

`svvy` product commands remain allowed because they are product-owned. Examples include command
palette actions, pane actions, sidebar actions, session actions, and explicit workflow or Smithers
actions routed through `svvy` tools.

Future support for host commands or hooks must be a separate first-class integration. It must show the
source, lifecycle event, command text or handler identity, trust state, affected agent/profile
configuration, and exact behavior surface before anything can run.

### Pi Commands And Hooks Opt-Out

Pi commands and hooks come from extensions, skills, and prompt templates:

- extension commands execute custom TypeScript command handlers
- extension event handlers subscribe with `pi.on(...)`
- skill commands appear as `/skill:name`
- prompt templates appear as slash commands
- input hooks can transform or handle user input before the model sees it
- tool hooks can block calls or mutate tool arguments and results
- user-bash hooks can replace bash execution behavior

Baseline pi rule:

- keep `noExtensions: true`
- keep `noSkills: true`
- keep `noPromptTemplates: true`
- keep all additional extension, skill, and prompt-template paths empty
- keep all resource overrides empty
- submit user text with host command and prompt-template expansion disabled when available

Because pi hooks are executable extension behavior, disabling extensions is the primary control. The
empty skills and prompt-template surfaces prevent host slash commands from appearing as a secondary
command path.

### Claude And Codex Commands And Hooks Opt-Out

`svvy` does not read Claude command Markdown files as prompt macros and must not invoke Claude Code's
command runtime.

`svvy` must not load or execute Claude or Codex hook configuration. This includes command hooks,
prompt hooks, agent hooks, plugin hooks, managed hook layers, and any hook state or trust records from
host config.

Reading hook configuration is not part of the baseline.

## 8. UI And Interaction Resources

UI and interaction resources are host-owned assets or settings that change how a host interface looks
or behaves.

Examples:

- pi themes
- pi extension UI components
- pi keybindings or TUI interaction changes
- Codex plugin UI contributions
- Claude or Codex interface settings
- custom status bars, footers, widgets, overlays, panes, renderers, or editor replacements

Baseline decision:

- do not support host UI and interaction resources
- do not discover them for display
- do not import them
- do not execute or render them
- do not map them into `svvy` settings
- do not expose an enable flow for them

This category is irrelevant to the product baseline. `svvy` owns its desktop UI, command palette,
composer, panes, keybindings, themes, and interaction model.

Pi-specific rule:

- keep `noThemes: true`
- keep `additionalThemePaths: []`
- keep `themesOverride: () => ({ themes: [], diagnostics: [] })`
- keep `noExtensions: true` so extension-provided UI cannot load

Future support is not planned. If the product ever wants theme or keybinding customization, it should
be designed as native `svvy` settings rather than host compatibility.

## 9. Provider And Model Adapters

Provider and model adapters are host-owned configuration or executable code that changes available
model backends, model metadata, model routing, provider behavior, or reasoning settings.

Examples:

- custom provider adapters
- model registry files
- model aliases
- context-window metadata
- model capability metadata
- fallback or provider routing rules
- host-specific reasoning settings
- provider extensions that add model backends

Baseline decision:

- `svvy` owns which provider credentials, actor defaults, and model selections are enabled for the
  product
- pi owns the normalized provider adapter implementation and built-in model metadata that `svvy`
  uses for capability checks such as reasoning support, supported thinking levels, context-window
  size, output-token limits, and image input support
- do not import provider settings from Codex, Claude, plugins, MCP configs, or host package manifests
- do not load ambient host provider adapters
- do not apply ambient host fallback, routing, retry, or reasoning settings
- do not let extensions or packages add provider backends unless a user explicitly enables that
  resource category and source

This category is already covered by `svvy` provider auth and settings plus pi's explicit model
registry and stream normalization surface. Supported provider choices and auth readiness come from
`svvy` product state. Model lists, reasoning controls, supported thinking levels, context-window
metadata, modality metadata, and provider request quirks come from pi's normalized `Model` metadata
and pi runtime APIs rather than a parallel `svvy` provider/model table.

Future support should be an explicit import or native provider integration, not ambient host
compatibility.

Pi-specific rule:

- keep `noExtensions: true` so provider extensions cannot load
- ignore pi user provider settings, retry/fallback settings, and shell/runtime settings for actor
  construction
- consume pi's explicit built-in model registry and normalized runtime stream events as the provider
  capability source of truth
- pass provider, model, reasoning, agent-family defaults, and resolved extension binding from `svvy`
  settings into pi session creation
  explicitly

## 10. Credentials And Auth State

Credentials and auth state are secrets or identity material used to access providers, tools, MCP
servers, cloud services, or host accounts.

Examples:

- API keys
- OAuth tokens
- provider auth files
- MCP auth state
- host credential stores
- environment-variable auth resolvers
- shell commands that resolve secrets
- cloud/session auth inherited from another coding agent

Baseline decision:

- `svvy` owns credentials and auth state
- do not import credentials from pi, Codex, Claude, MCP configs, plugins, packages, or host auth files
- do not execute shell commands or environment resolvers to obtain secrets from host config
- do not reuse host OAuth sessions implicitly
- do not read MCP auth state from host-managed configs
- do not allow extensions, packages, hooks, or provider adapters to supply credentials

Supported provider readiness must come from `svvy` settings and product-owned auth integrations.
Settings UI must distinguish between credentials stored by `svvy` and any future explicit integration
that intentionally connects to an existing host credential.

Future support for using an existing host login or credential store must be a deliberate provider auth
integration with clear provenance and user confirmation. It must not be discovered by file presence.

Pi-specific rule:

- ignore pi provider auth files and settings for `svvy` actors
- ignore pi environment-variable or shell-command auth resolution from host config
- pass only `svvy`-owned provider credentials into the provider adapter used for the actor request

## 11. Execution Policy

Execution policy is the set of rules that decides what an actor or runtime is allowed to do and under
which constraints.

Examples:

- filesystem sandboxing
- network access
- approval policy
- command allowlists and denylists
- shell execution behavior
- timeouts
- retries
- concurrency
- worktree isolation
- permission prompts
- safety gates
- tool approval or blocking rules

Baseline decision:

- `svvy` owns execution policy
- do not inherit execution policy from pi, Codex, Claude, MCP configs, plugins, packages, hooks, or
  host settings files
- do not import host command allowlists or denylists
- do not import host sandbox or approval settings
- do not import host retry, timeout, network, shell, concurrency, or permission settings
- do not let host hooks or extensions act as policy gates
- do not let external instructions or future prompt assets change execution policy

Actor execution policy must come from `svvy` product settings, actor contracts, Smithers run
configuration where applicable, and product-owned tool registries.

Adding a host config file must not silently change whether shell commands are allowed, whether network
is enabled, whether approvals are required, which directories are writable, which tools can run, or
which commands are blocked.

Resolved `svvy` execution policy:

- normal direct tool execution uses the Codex-like `exec_command`, `write_stdin`, and `apply_patch`
  surface defined in `docs/specs/extensions-and-tools.spec.md`
- on macOS, managed filesystem sandboxing uses `/usr/bin/sandbox-exec` with vendored or ported Codex
  Seatbelt policy generation and SBPL templates packaged with the app
- the default managed filesystem policy follows Codex workspace-write semantics: broad reads, writes
  to workspace roots and configured writable roots, writes to `/tmp` and `$TMPDIR` unless excluded,
  and protected metadata carveouts such as `.git`, `.agents`, and `.codex`
- the user-facing execution settings are `approvalMode` and `networkAccess`, not imported host
  sandbox modes
- `approvalMode` is `auto-review`, `user`, or `full-access`
- `auto-review` and `user` both use Codex-like runtime classification and sandboxing; they differ only
  in whether approval-boundary requests are resolved by the reviewer model or by a pending user
  approval
- `full-access` maps to no approval boundary and disabled managed filesystem permissions
- `networkAccess` defaults to true; when false, outbound network access is restricted and the shipped
  Web extension is disabled through normal extension binding
- workflow task agents use this same execution policy for task-local shell, patch, network, parent
  `execute_typescript`, and generated loaded-extension client boundaries, scoped to the owning
  Smithers task attempt

Pi-specific rule:

- ignore pi shell, retry, compaction, message-delivery, approval, and UI/runtime policy settings for
  actor construction
- keep ambient extensions disabled so extension policy gates cannot load
- route all runnable tool behavior through `svvy` tools and `svvy` execution policy

## 12. Runtime State Resources

Runtime state resources are durable or live state records owned by a runtime.

Examples:

- pi session ids and session histories
- Codex thread ids
- Claude session state
- queued messages
- compaction state
- approval state
- tool-call facts
- workflow run ids
- artifacts and logs
- cwd and workspace bindings
- resume handles

Baseline decision:

- `svvy` owns product runtime state
- `svvy` may reference state it created intentionally, such as pi sessions backing `svvy` surfaces or
  Smithers runs started by `svvy`
- `svvy` may attach to runtime state only through an explicit product flow
- do not import unrelated host sessions, threads, histories, queues, approvals, compactions,
  artifacts, logs, or resume handles just because they exist on disk
- do not merge host runtime state into `svvy` session state automatically
- do not infer actor ownership from ambient host state
- do not use heuristic scans of host runtime state to bind workflow attempts, sessions, or threads

The product-owned rule is simple: state belongs to the system that produced it, and `svvy` stores only
the facts it needs to project, resume, or supervise product-owned work. External runtime state is not
ambient context.

Pi-specific rule:

- use only pi sessions created or explicitly adopted by `svvy`
- do not import arbitrary pi session history from host session directories
- do not let pi session state decide actor type, workspace ownership, tools, generated agent context
  bindings, or
  workflow ownership

Smithers-specific rule:

- use Smithers run state only for product-owned workflow runs and explicitly attached runs
- bind workflow task attempts by exact persisted identifiers, not by scanning recent runtime state

## Required Pi Resource Loader Shape

Every pi-backed `svvy` actor resource loader must use the default-deny shape below.

```ts
new DefaultResourceLoader({
  cwd,
  agentDir,
  settingsManager,

  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,

  additionalExtensionPaths: [],
  additionalSkillPaths: [],
  additionalPromptTemplatePaths: [],
  additionalThemePaths: [],
  extensionFactories: [],

  agentsFilesOverride: () => ({ agentsFiles: [] }),
  systemPromptOverride: () => svvyComposedActorPrompt,
  appendSystemPromptOverride: () => [],

  extensionsOverride: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  skillsOverride: () => ({ skills: [], diagnostics: [] }),
  promptsOverride: () => ({ prompts: [], diagnostics: [] }),
  themesOverride: () => ({ themes: [], diagnostics: [] }),
});
```

The override functions are belt-and-suspenders. The important invariant is that pi reports no loaded
extensions, skills, prompt templates, themes, or agent files for `svvy` actor surfaces, and that the
only prompt text comes from `svvy`.

## Current Implementation Checkpoints

When implementing this baseline, audit every `DefaultResourceLoader` and `createAgentSession` call.

Required checks:

- orchestrator loader uses the default-deny shape
- handler-thread loader uses the default-deny shape
- workflow task-agent loader uses the default-deny shape
- sessions use pi's built-in-tool suppression path and do not inherit pi default tools
- sessions pass only `svvy`-owned `customTools`
- no actor loader passes additional resource paths
- no actor loader passes extension factories
- no actor surface calls `extendResources()` with ambient paths
- generated prompt previews and generated tool declarations come from `svvy` state, not pi resource
  discovery
- composer sends user text to pi with host prompt-template and slash-command expansion disabled
- Snippets discovery reads supported Markdown files directly and does not use pi's prompt-template
  registry as the source of truth
- no host commands or lifecycle hooks are loaded, listed, trusted, or executed
- no host UI resources, themes, keybindings, renderer components, or interaction resources are
  loaded, listed, mapped, or rendered
- no ambient host provider settings, provider adapters, routing rules, fallback rules, or reasoning
  settings are loaded or applied; pi's explicit built-in model registry and stream adapters remain
  the normalized provider capability layer used by `svvy`
- no host credentials, OAuth sessions, MCP auth state, environment resolvers, shell secret resolvers,
  or host auth files are imported or used implicitly
- no host execution policy, sandbox policy, approval policy, command policy, network policy, timeout,
  retry, shell, concurrency, or permission setting is imported or applied
- no unrelated host sessions, threads, queues, approvals, compactions, artifacts, logs, resume
  handles, or runtime histories are imported or attached implicitly

## Non-Goals

- Do not support pi `SYSTEM.md` or `APPEND_SYSTEM.md`.
- Do not auto-load pi, Codex, Claude, or MCP skills.
- Do not auto-load pi extensions or packages.
- Do not let host runtimes auto-load or expand prompt templates.
- Do not discover Codex skills as prompt macros.
- Do not execute Claude command bash preambles.
- Do not auto-load themes.
- Do not support host UI resources, host themes, host keybindings, host widgets, host renderers, or
  host editor replacements.
- Do not import ambient host provider/model settings, provider adapters, fallback rules, or reasoning
  settings. Use pi's explicit built-in model registry and normalized stream adapters for provider
  capability metadata and request-shape quirks.
- Do not import host credentials, OAuth tokens, provider auth files, MCP auth state, environment
  resolvers, or shell-command secret resolvers.
- Do not import host execution policy, sandbox settings, approval settings, command allowlists or
  denylists, retry settings, timeout settings, network settings, shell settings, concurrency settings,
  or permission gates.
- Do not import unrelated host runtime state, sessions, histories, queued messages, approvals,
  compactions, artifacts, logs, workflow runs, or resume handles.
- Do not auto-start MCP servers from host configs.
- Do not create a general marketplace or enable/disable UI for packages.
- Do not expose ambient host commands, plugin commands, extension commands, skill commands, or MCP
  prompts.
- Do not load or execute pi, Claude, Codex, plugin, MCP, or managed hook configuration.
- Do not treat this baseline as a final design for future explicit integrations.

## Acceptance Criteria

- Adding `AGENTS.md` and `CLAUDE.md` under a configured external-instruction root shows both files, with
  only `AGENTS.md` enabled by default when both are in the same directory.
- Adding `AGENTS.md` and `CLAUDE.md` in a workspace ancestor shows both files as
  `external_instruction` extension records, with controls persisted only for that workspace.
- Adding `.pi/SYSTEM.md` or `.pi/APPEND_SYSTEM.md` does not change any `svvy` actor prompt.
- Adding a pi skill under global or project skill directories does not add skill metadata to any
  `svvy` actor prompt.
- Adding a pi skill does not add `/skill:name` to any `svvy` command surface.
- Adding a pi extension does not add tools, commands, hooks, or UI behavior to any `svvy` actor.
- Adding a pi package does not add extensions, skills, prompts, themes, tools, commands, hooks, or UI
  behavior to any `svvy` actor.
- Adding pi prompt templates does not add prompt text, slash commands, or generated agent context to
  any `svvy` actor by itself.
- Adding a Claude command under a supported command path does not add a command or generated agent
  context to any `svvy` actor.
- Supported pi prompt templates and Claude command Markdown files may appear as read-only Snippets
  only through the product-owned Snippets discovery path.
- Prompt macro metadata such as `allowed-tools` and `model` does not grant tools or change actor
  model selection.
- Claude bash pre-execution syntax, MCP prompts, plugin commands, extension commands, and skill
  commands are not executed or emulated as prompt macros.
- Adding a pi extension command does not add a command to any `svvy` command surface.
- Adding a pi extension event handler does not transform prompts, intercept tools, mutate results, or
  change UI/runtime behavior.
- Adding Claude or Codex hook configuration does not run hooks before prompts, before tools, after
  tools, during compaction, on session start, on stop, or during permission requests.
- Adding pi themes, extension UI, keybindings, renderer components, or host UI settings does not
  change any `svvy` UI surface.
- Adding host provider adapters, model registry files, or provider routing settings does not change
  available `svvy` providers, models, reasoning controls, actor defaults, or request routing.
- Adding host credential files, OAuth sessions, MCP auth state, environment auth resolvers, or
  shell-command secret resolvers does not make any provider or MCP server ready in `svvy`.
- Adding host execution policy files or settings does not change `svvy` sandboxing, approvals,
  network access, tool permissions, shell behavior, command policy, retries, timeouts, concurrency, or
  worktree behavior.
- Adding unrelated host session, thread, queue, compaction, approval, artifact, log, workflow-run, or
  resume state does not attach it to any `svvy` surface.
- Every pi-backed actor receives only `svvy`-registered tools and `svvy`-composed prompt text.
