# Extensions And Tools Spec

## Status

- Date: 2026-06-02
- Status: authoritative product spec
- Scope of this document:
  - define the extension and tool architecture for `svvy`
  - define the relationship between Agents, Extensions, actors, profiles, native tools, Incur CLIs, `svvyx`, `execute_typescript`, shell policy, dependencies, and secrets
  - define the app-managed trusted CLI dependency registry used by shipped prompt-only CLI
    extensions
  - define the rejected and deferred ideas that must not be folded into this feature without a new product decision

This document is the source of truth for the resolved Extensions and native tool direction.
Related product docs must stay synchronized with this model.

Related specs:

- `docs/specs/extension-managing.spec.md` defines the Extension Managing extension and its
  `svvyx extensions ...` lifecycle API.
- `docs/specs/cx-tools.spec.md` defines the shipped prompt-only cx extension and its direct CLI
  boundary.
- `docs/specs/web-tools.spec.md` defines the shipped prompt-only Web extension and TinyFish CLI
  boundary.

The generated-context terminology in this document is intentional:

- **Agent context** means the exact generated prompt, external instructions, native tool declarations,
  loaded-extension command documentation, generated TypeScript declarations, and actor-scoped
  `svvyx` command binding that one actor receives.
- **Agent context fingerprint** means the canonical digest of that actor-facing generated context.
- **Extension context fingerprint** means the canonical digest of one extension's actor-facing
  current build output.
- **Surface** should be reserved for an interactive product target, pane, or pi-backed session. It
  must not be used as shorthand for generated prompt/tool/type content.

## Product Intent

`svvy` exposes reusable agent guidance and callable capability through explicit product-owned
models.

The product should expose a first-class Extensions model:

- Agents choose model, reasoning, base instructions, and extension composition.
- Extensions define agent capabilities.
- Actor kinds define hard runtime ceilings.
- Generated prompt text, generated CLI help, generated TypeScript types, and actual callable
  runtime surfaces are all derived from the same actor-scoped extension resolution.

The goal is a conservative coding-agent tool model for ordinary coding work, close to Codex and
other strong coding agents, while making `svvy` opinionated where it has product-specific leverage:
actor-scoped capability composition, explicit generated agent contexts, extension loading, extension
authoring, encrypted app-managed secrets, rich tool-use visualization, and reversible app-state
changes.

## Explicitly Rejected Or Deferred Ideas

These are not part of this spec unless reintroduced explicitly later.

- A separate always-on router or manager agent above the orchestrator is not adopted.
- A Smithers-heavy architecture where Smithers owns all session, subagent, router, and projection
  state is not adopted.
- Automatic session compaction as a special supervisor or workflow is separate future work.
- Snippets, command-like macros, and user-invoked prompt macros are not part of this feature.
- Incur MCP and Incur skills are not adopted as the runtime integration. `svvy` owns the bridge.
- Native `cx_*` tools, `svvyx cx`, generated cx TypeScript clients, and an Incur wrapper for cx are
  not adopted in v1. cx is a prompt-only direct CLI extension.
- An `iron-proxy`-style egress boundary and credential proxy is deferred. It remains a possible
  hardening improvement for secret-bearing network tools, but v1 assumes editable extension code is
  trusted not to intentionally log or exfiltrate configured secret values.

## Core Terminology

### Tool

A tool is a callable model-facing operation.

In the extension architecture, a tool belongs to either:

- a loaded extension
- a small native control surface that the actor kind is allowed to call

The word "tool" should not be used for plain prompt text, profile settings, or external
instructions.

### Instruction

An instruction is prompt text.

Instructions may live in an agent profile, a loaded extension, an available extension's minimal
loading hint, or an external instruction record. Instructions do not grant capability by themselves.

### External Instruction

An external instruction is a read-only instruction source discovered outside `svvy` extension
storage, such as a repository `AGENTS.md` file or `CLAUDE.md` file.

External instructions appear in Extensions as `external_instruction` records. They use the same
per-agent usage states as other extensions, but their content is not owned by `svvy`:

- the UI may show the file content in generated-context previews
- the UI may offer an `Open external file` action
- agents cannot edit the file through Extension Managing
- reset restores `svvy` usage/settings state only and never overwrites the external file
- deletion is unavailable

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
Incur, or any specific tool. Tool-specific instructions come from shipped, user, or external
instruction extensions.

### Extension

An extension is a packaged agent capability.

An extension can be prompt-only, or it can include executable tools. It is the product unit for
reusable agent capability.

Each extension has:

- stable id
- category: `shipped`, `user`, or `external_instruction`
- title
- description
- full loaded instructions
- minimal available instructions
- an agent-facing interface: `native_tool`, `svvyx`, or `instructions`
- optional TypeScript API enablement
- generated TypeScript API overview when TypeScript API is enabled
- dependency and env requirements when relevant
- trusted CLI dependency references when the extension teaches a direct external CLI
- readonly usage view showing which agents use it and whether each usage is default-loaded or
  available
- reset behavior when it is shipped by `svvy` or when it is an external instruction usage setting

Extensions are app-global by default. Workspace-specific capability should usually be modeled as an
agent profile that selects a custom extension set, not as hidden workspace mutation of a global
extension. Workspace-scoped extensions remain a future decision.

`category` is the UI and agent-facing source category:

| Category | Meaning |
| --- | --- |
| `shipped` | Provided by `svvy`, non-deletable, resettable to shipped settings or shipped overlay content. This includes native tool extensions, shipped `svvyx` extensions, and shipped prompt-only extensions. |
| `user` | Created by the user, deletable, not resettable to shipped defaults. |
| `external_instruction` | Discovered from an external file such as `AGENTS.md` or `CLAUDE.md`, read-only in `svvy`, non-deletable, and resettable only at the `svvy` usage/settings layer. |

`category` is separate from `interface`. For example, Filesystem is
`{ category: "shipped", interface: "native_tool" }`, Git is
`{ category: "shipped", interface: "instructions" }`, and a discovered `AGENTS.md` record is
`{ category: "external_instruction", interface: "instructions" }`.

### Extension Usage State

For each agent profile and actor kind, an extension can be:

- `default_loaded`
- `available`
- `unavailable`

`default_loaded` means:

- full instructions are included in the actor prompt
- the extension is mounted in the actor-scoped `svvyx` CLI if it has commands
- loaded `svvyx` command guidance is included when the extension exposes `svvyx` commands
- generated TypeScript command types are included when TypeScript API is enabled
- the runtime allows the actor to invoke that extension through the supported execution paths

`available` means:

- only minimal instructions are included
- the minimal instructions explain when and why the extension should be loaded
- the extension is not mounted in `svvyx`
- the extension has no CLI presence
- its `svvyx` command guidance and TypeScript types are not included
- the actor may load it through the explicit loading mechanism if the actor kind allows it

`unavailable` means:

- no instructions are included
- no awareness is included
- the extension cannot be loaded by `load_extension`
- no generated CLI, `svvyx` guidance, types, or runtime surface are exposed

The prompt is advisory only. The runtime must enforce the same state. Generated prompt text and
actual callable surfaces must match.

### Extension Interface

`interface` is the agent-facing way to use an extension, not the implementation language or storage
kind.

Allowed values:

| Value | Meaning |
| --- | --- |
| `native_tool` | The extension contributes one or more native model tools that are already declared in the actor's native tool declarations when loaded. |
| `svvyx` | The extension contributes commands under the actor-scoped aggregate CLI as `svvyx <extension-id> ...` when loaded. |
| `instructions` | The extension contributes prompt instructions only. It does not add native tools, `svvyx` commands, or TypeScript command types. |

The old `runtimeKind` field is not part of agent-facing JSON. Implementation may still internally
distinguish native code, Incur-backed source, or prompt-only storage, but agent-facing tools and
commands report only `interface`.

### `list_extensions`

`list_extensions` is a native, read-only, actor-scoped tool. It is always scoped to the current
session or workflow task-agent attempt. It is not `svvyx extensions list`, and it must not manage
extension definitions, source files, usage settings, builds, resets, deletes, reverts, snapshots, or
secret values.

Input:

```json
{
  "state": "loaded",
  "extensionId": "smithers",
  "query": "workflow"
}
```

All input fields are optional.

| Field | Type | Description |
| --- | --- | --- |
| `state` | `"loaded" | "available"` | Optional result subset. Omitted means return both loaded and available arrays. |
| `extensionId` | string | Optional exact extension id filter over the actor-visible loaded and available extension sets. |
| `query` | string | Optional case-insensitive substring search over actor-visible `id`, `title`, `description`, and available `minimalInstructions`. |

`list_extensions` must not echo actor identity, session id, or filters in its result. The current
actor is implicit in the tool binding. If an agent needs actor or runtime identity, it should use the
appropriate runtime inspection tool rather than `list_extensions`.

Result:

```ts
type ListExtensionsResult = {
  ok: true;
  loaded: LoadedExtensionForCurrentActor[];
  available: AvailableExtensionForCurrentActor[];
};
```

If `state` filters one side out, the omitted side is returned as an empty array. If `extensionId`
names an extension that is unknown or unavailable to the current actor, both arrays are empty.
Returning an empty result must not reveal whether the id is unknown, unavailable by actor kind,
unavailable by profile, deleted, disabled, or hidden by policy.

Loaded extension objects use the same top-level fields as `svvyx extensions inspect <id> --json`
except `usage`, plus session-context state:

```ts
type LoadedExtensionForCurrentActor = {
  id: string;
  category: "shipped" | "user" | "external_instruction";
  interface: "native_tool" | "svvyx" | "instructions";
  title: string;
  description: string;
  resettable: boolean;
  deletable: boolean;
  typescriptApiEnabled: boolean;
  paths: ExtensionPathsForLoadedExtension;
  requirements: ExtensionRequirements;
  state: ExtensionStateForCurrentActor & { binding: "loaded" };
};
```

Available extension objects intentionally expose less than loaded extensions:

```ts
type AvailableExtensionForCurrentActor = {
  id: string;
  category: "shipped" | "user" | "external_instruction";
  interface: "native_tool" | "svvyx" | "instructions";
  title: string;
  description: string;
  resettable: boolean;
  deletable: boolean;
  typescriptApiEnabled: boolean;
  minimalInstructions: string;
  paths: {
    instructionsMinimal: string | null;
    externalInstructionFile: string | null;
  };
  requirements: ExtensionRequirements;
  state: ExtensionStateForCurrentActor & { binding: "available" };
};
```

Shared shapes used above:

```ts
type ExtensionPathsForLoadedExtension = {
  sourceRoot: string | null;
  manifest: string | null;
  instructionsFull: string | null;
  instructionsMinimal: string | null;
  externalInstructionFile: string | null;
  extensionSource: string | null;
  packageJson: string | null;
  lockfile: string | null;
  generatedRoot: string | null;
  typescriptTypes: string | null;
  buildCurrent: string | null;
};

type ExtensionRequirements = {
  externalBinaries: Array<{
    name: string;
    status: "available" | "missing" | "unknown";
  }>;
  trustedCliDependencies: TrustedCliDependencyRequirement[];
  env: Array<{
    name: string;
    required: boolean;
    secret: boolean;
    description: string;
    status: "configured" | "missing" | "defaulted" | "optional_missing";
  }>;
  dependencies: ExtensionDependencyRequirement[];
  trustedDependencies: ExtensionDependencyRequirement[];
};

type TrustedCliDependencyRequirement = {
  id: string;
  binary: string;
  status: "available" | "missing" | "unknown";
  detectedVersion: string | null;
  install: {
    package: string;
    version: string;
    source:
      | "cargo"
      | "npm"
      | "github-release"
      | "git-scm-release"
      | "bundled_app_resource";
    approval: "not_required_when_user_binary_exists" | "needs_user_confirmation" | "approved";
    install: "installed" | "not_installed" | "unknown";
  };
};

type ExtensionDependencyRequirement = {
  kind: "dependency" | "trusted_dependency";
  name: string;
  version: string;
  packageManager: "bun";
  source: "npm";
  approval: "approved" | "needs_user_confirmation" | "unknown";
  install: "installed" | "missing" | "unknown";
};

type ExtensionStateForCurrentActor = {
  draftChanged: boolean;
  buildRequired: boolean;
  currentBuild: null | {
    status: "ready" | "missing" | "invalid";
  };
  lastBuild?: {
    status: "success" | "failed" | "blocked" | "never";
  };
  ready: boolean;
  issues: ExtensionIssue[];
};

type ExtensionIssue = {
  code:
    | "EXTENSION_ENV_MISSING"
    | "DEPENDENCY_APPROVAL_REQUIRED"
    | "DEPENDENCY_MISSING"
    | "BUILD_REQUIRED"
    | "BUILD_FAILED"
    | "NO_CURRENT_BUILD"
    | "CURRENT_BUILD_INVALID"
    | "EXTERNAL_BINARY_MISSING"
    | "EXTERNAL_BINARY_UNKNOWN"
    | "EXTERNAL_CLI_AUTH_MISSING"
    | "EXTERNAL_CLI_AUTH_INSUFFICIENT"
    | "EXTERNAL_CLI_AUTH_UNKNOWN";
  message: string;
};
```

`currentBuild.status` reports whether the current generated build for the extension is readable and
structurally valid, not whether all runtime requirements are satisfied. `ready` is the final
agent-actionable answer after combining build state, dependency/install state, env status, required
external binary status, known blocking external CLI auth status, and the current actor binding.
`lastBuild` may be omitted only when the implementation has no build attempt record yet; if present,
it must be coarse status only and must not include timestamps or build ids.

`state.binding` is session-contextual. It reports whether this exact actor session currently has the
extension loaded or only available. It replaces global usage data for `list_extensions`; global
agent/profile usage state belongs to Extension Managing `inspect`.

`state.ready` is also session-contextual:

- for `binding: "loaded"`, `ready: true` means the actor can use the loaded extension now
- for `binding: "available"`, `ready: true` means `load_extension({ "extensionId": id })` is
  expected to succeed without user/build/dependency/env intervention

`state.ready: false` must be accompanied by one or more `state.issues` entries with concrete,
agent-actionable messages. Missing required env values must direct the user to configure values in
the app UI; they must not ask the user to paste a secret into chat.

`externalBinaries` reports only whether declared local command-line binaries are known to be present.
It must not encode account authentication, OAuth state, token scopes, remote service reachability, or
last-check timestamps. If an extension depends on a local CLI account state, such as GitHub CLI
authentication for `gh`, that readiness is represented only through coarse `state.ready` and
`state.issues` values when the app already knows the status. Do not add an `externalAuth`,
`authStatus`, token-scope, account-name, username, or host credential field to the normal
agent-facing requirements shape.

`trustedCliDependencies` reports app-managed trusted CLI dependencies referenced by the extension.
This is separate from extension build dependencies and from Bun's `trustedDependencies` package
field. A trusted CLI dependency is a concrete binary that an extension teaches agents to use through
ordinary shell commands. Each record must have an exact package, exact version, source kind, and
binary name. Version ranges, floating tags such as `latest`, branch names, mutable URLs, and
unpinned package-manager installs are not valid trusted CLI dependency records.

Trusted CLI dependency status is local and bounded:

- `status` reports whether the binary is available from the actor's command environment or from the
  app-managed install location.
- `detectedVersion` may be `null` when version detection is unavailable or too expensive.
- a user-owned binary on PATH is usable even when its version differs from the app-managed install
  version, unless a separate product policy later requires stricter validation for that dependency
- when the binary is missing, `install` reports whether the exact app-managed dependency is already
  installed or needs user confirmation
- installing a trusted CLI dependency is user-confirmed app behavior, not an agent shell task

For prompt-only direct CLI extensions, missing trusted CLI dependencies do not make the extension
instructions unavailable. The generated prompt should still include the extension's instructions so
the agent understands the intended capability. The app should surface missing trusted CLI dependency
attention through its normal confirmation UI. Agents should not be instructed to run package-manager,
curl, Homebrew, Cargo, npm, or GitHub release install commands for shipped trusted CLI dependencies.
If a command fails because the binary is missing, the agent should report that the app-managed
trusted CLI dependency is unavailable and ask the user to enable or install it through the app.

The shipped trusted CLI dependency registry is:

| Id | Binary | Package | Version | Source | Used by |
| --- | --- | --- | --- | --- | --- |
| `cx` | `cx` | `cx-cli` | `0.7.1` | `cargo` | cx prompt-only extension |
| `tinyfish` | `tinyfish` | `@tiny-fish/cli` | `0.1.6` | `npm` | Web prompt-only extension |
| `git` | `git` | `git` | `2.54.0` | `git-scm-release` | Git and GitHub prompt-only extensions |
| `gh` | `gh` | `gh` | `2.93.0` | `github-release` | GitHub prompt-only extension |

Registry entries are app-owned release decisions. Updating any `version`, `source`, package id, or
binary name is a product change that must update this table, the owning extension spec, generated
extension metadata tests, and any packaged installer logic together. The app must never silently
substitute a newer trusted CLI dependency because a package manager reports a newer release.

For prompt-only instruction extensions, declared external binaries are advisory unless the extension
explicitly says a binary is required before instructions can load. The shipped Git and GitHub
extensions must still load their prompt guidance when `git`, `gh`, or `gh` auth is unknown. Unknown
GitHub CLI auth must not make the prompt-only GitHub extension not ready. Known missing or
insufficient `gh` auth may be shown as an issue when the app already knows it, but the agent-facing
GitHub instructions still trigger auth guidance only after an actual `gh` command fails.
Use `EXTERNAL_CLI_AUTH_UNKNOWN` only when auth uncertainty blocks a concrete extension runtime
invocation; do not use it to block prompt-only GitHub guidance.

Requirement freshness is intentionally bounded. Startup refresh, explicit extension refresh,
`list_extensions`, and Extension Managing `inspect` may run cheap local checks for declared
requirements. They must not install packages, mutate auth state, run `gh auth login`, contact remote
services only to improve a label, or observe arbitrary failed agent shell commands to update
extension readiness. If a requirement status cannot be known from a cheap local check, report
`unknown` and include an actionable issue only when that uncertainty blocks readiness.

Loaded extension `paths` may include source/edit paths and generated TypeScript declaration paths
because loaded extensions are already visible to the actor. For `category: "external_instruction"`,
app-owned source paths are `null` and `externalInstructionFile` points at the read-only external
file. Available extension `paths` must include only `instructionsMinimal` and
`externalInstructionFile`; those paths are pointers to already visible minimal/source metadata, not
permission to inspect full instructions or edit the extension through `list_extensions`.

`list_extensions` must never expose:

- unavailable extension ids, titles, descriptions, minimal instructions, counts, or reasons
- full instructions for available-but-not-loaded extensions
- source/edit paths for available-but-not-loaded extensions other than `paths.instructionsMinimal`
- generated TypeScript types for available-but-not-loaded extensions
- command docs, command lists, command schemas, `--llms-full` output, or tool schemas for
  available-but-not-loaded extensions
- env values, previews, masked values, hashes, fingerprints, keychain ids, storage paths, or
  timestamps
- extension context fingerprints, generated agent context fingerprints, aggregate cache keys, build
  ids, build timestamps, or staging paths

Loaded `svvyx` extension command documentation is discovered through the loaded CLI itself, for
example:

```bash
svvyx <extension-id> --llms
svvyx <extension-id> --llms-full
svvyx <extension-id> <command> --help
svvyx <extension-id> <command> --schema
```

`list_extensions` and `svvyx extensions inspect` must not expose ordinary agent-facing
`commandDocs` or `toolSchemas` file paths. If implementation keeps internal generated docs or schema
files for prompt assembly, validation, UI traceability, or cache mechanics, those paths are not part
of the normal agent-facing list/inspect JSON contract.

Example:

```json
{
  "ok": true,
  "loaded": [
    {
      "id": "smithers",
      "category": "shipped",
      "interface": "svvyx",
      "title": "Smithers",
      "description": "Workflow supervision commands for handler threads.",
      "resettable": true,
      "deletable": false,
      "typescriptApiEnabled": true,
      "paths": {
        "sourceRoot": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/smithers",
        "manifest": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/smithers/manifest.json",
        "instructionsFull": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/smithers/instructions/full.md",
        "instructionsMinimal": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/smithers/instructions/minimal.md",
        "externalInstructionFile": null,
        "extensionSource": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/smithers/source",
        "packageJson": "/Users/example/.config/svvy/extensions/package/package.json",
        "lockfile": "/Users/example/.config/svvy/extensions/package/bun.lock",
        "generatedRoot": "/Users/example/.config/svvy/extensions/generated/extensions/smithers",
        "typescriptTypes": "/Users/example/.config/svvy/extensions/generated/extensions/smithers/types.d.ts",
        "buildCurrent": "/Users/example/.config/svvy/extensions/builds/extensions/smithers/current"
      },
      "requirements": {
        "externalBinaries": [],
        "env": [],
        "dependencies": [],
        "trustedCliDependencies": [],
        "trustedDependencies": []
      },
      "state": {
        "binding": "loaded",
        "draftChanged": false,
        "buildRequired": false,
        "currentBuild": {
          "status": "ready"
        },
        "lastBuild": {
          "status": "success"
        },
        "ready": true,
        "issues": []
      }
    }
  ],
  "available": [
    {
      "id": "extension-managing",
      "category": "shipped",
      "interface": "svvyx",
      "title": "Extension Managing",
      "description": "Manage extension definitions, builds, usage state, reset, delete, and revert.",
      "resettable": true,
      "deletable": false,
      "typescriptApiEnabled": true,
      "minimalInstructions": "Load this only when the user asks to inspect, create, edit, build, reset, delete, revert, or configure svvy extensions.",
      "paths": {
        "instructionsMinimal": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/extension-managing/instructions/minimal.md",
        "externalInstructionFile": null
      },
      "requirements": {
        "externalBinaries": [],
        "env": [],
        "dependencies": [],
        "trustedCliDependencies": [],
        "trustedDependencies": []
      },
      "state": {
        "binding": "available",
        "draftChanged": false,
        "buildRequired": false,
        "currentBuild": {
          "status": "ready"
        },
        "lastBuild": {
          "status": "success"
        },
        "ready": true,
        "issues": []
      }
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
- allowed to have editable title, description, instructions, and optional editable extension source
  overlays when those files exist

Shipped extensions are non-deletable and resettable, but their title, description, instructions,
editable extension source, and agent-level enablement can be customized through overlay files when
those files exist. Generated native tool schemas, native runtime implementation, app-owned bridge
code, and external instruction source files remain read-only.

Category is one axis. Agent-facing interface is another axis. A shipped extension can expose native
tools, an actor-scoped `svvyx` namespace, or instructions only. External instruction records always
use `category: "external_instruction"` and `interface: "instructions"`.

### Native Tool Extension

A native tool extension is an extension whose executable behavior is implemented by `svvy`, pi, or
another app-owned bridge and exposed as native model tools when loaded.

Native tool extensions still use `interface: "native_tool"` in agent-facing JSON and are represented
as extensions for composition, instructions, profile selection, and generated preview.

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
visualization. Incur-backed extensions use `interface: "svvyx"` in agent-facing JSON.

### Prompt-Only And External Instruction Extensions

A prompt-only extension has no CLI runtime and uses `interface: "instructions"` in agent-facing JSON.

It still uses the same usage states:

- full instructions when default-loaded
- minimal load guidance when available
- nothing when unavailable

Prompt-only extensions are useful for domain guidance that does not need executable tools.

External instructions are prompt-only extension records whose source content lives outside `svvy`
extension storage. Examples include repository `AGENTS.md`, `CLAUDE.md`, and future plain external
instruction files discovered from supported hosts.

Rules:

- external instructions use `category: "external_instruction"` and `interface: "instructions"`
- the same `default_loaded`, `available`, and `unavailable` usage states apply per agent profile
- when default-loaded, exact external file content is included in the generated prompt in the
  configured order
- when available, only minimal source/availability guidance is included; the full external file
  content is not included until loaded
- when unavailable, the actor receives no prompt awareness of that external instruction
- content is read-only from `svvy`; editing happens by opening the external file in the configured
  editor or by ordinary user repository editing outside Extension Managing
- Extension Managing must not return external instruction files as editable extension source paths
- reset restores `svvy` usage/settings and any shipped metadata overlay for the external instruction
  record, not the external file content
- external instruction records are non-deletable by Extension Managing; disabling them uses the
  normal per-agent `unavailable` state

### Extension Current Build

Extension source edits create draft state.

A successful build atomically replaces the extension's current build. The current build contains:

- manifest
- full and minimal instructions
- CLI entrypoint or native runtime binding metadata
- generated TypeScript command types when enabled
- dependency graph metadata
- env requirements
- external binary requirements
- internal content hashes stored in product state or non-agent-readable build metadata

Env requirements in build output are declaration metadata and readiness status only. Current build
artifacts, generated TypeScript declarations, aggregate cache blobs, and agent-facing build output
must not contain env values, secret values, secret hashes, secret previews, secret storage
identifiers, value timestamps, extension context fingerprints, generated agent context fingerprints,
aggregate cache keys, build ids, build timestamps, install timestamps, or internal content hashes.
Internal hashes are activation/cache state only; they must not be written into agent-readable
build-current files, used as secret fingerprints, or displayed as env status.

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
      types.d.ts
    aggregates/
      index.sqlite
      blobs/<aggregate-cache-key>/
        manifest.json
        prompt.md
        svvyx-guidance.md
        commands.d.ts
        native-tool-schemas.json
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
- `sources/builtin-overlays/<id>/` contains editable overlay files for shipped extension title,
  description, instructions, and optional editable extension source.
- `source/` exists only for extensions with editable executable source; prompt-only extensions omit
  it or return `source: null` from `inspect`.
- shipped defaults live in packaged app resources and are read-only.
- `inspect` materializes shipped overlay files before returning editable paths, so normal shell
  inspection and `apply_patch` work even when the user has not edited that shipped extension before.
- `generated/extensions/<id>/` contains read-only generated TypeScript declarations for that
  extension when TypeScript API is enabled.
- `builds/extensions/<id>/current/` contains the current built runtime surface for that extension.
- `builds/extensions/<id>/staging/<build-run-id>/` is temporary output for a running build and is
  atomically promoted over `current/` only after success.
- `generated/aggregates/` contains a real disposable cache for generated agent contexts.
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

Native runtime implementation, generated TypeScript declarations, internal native tool schemas, and
app-owned bridge code for shipped extensions are read-only. A shipped extension can still be
customized by editing its overlay title, description, instructions, and optional editable extension
source, and those overlay edits remain resettable to packaged defaults.

Generated agent context aggregates use a lightweight cache rather than ad hoc directories:

- `generated/aggregates/index.sqlite` stores cache metadata.
- each index row stores at minimum `cacheKey`, `actorKind`, ordered `loadedExtensionIds`, ordered
  `availableExtensionIds`, `extensionContextFingerprints`, `agentContextFormatVersion`,
  `externalInstructionsFingerprint`, `agentContextFingerprint`, `createdAt`, `lastUsedAt`, and
  `sizeBytes`
- `generated/aggregates/blobs/<aggregate-cache-key>/` stores the generated prompt, loaded `svvyx`
  command guidance, TypeScript declarations, native tool schemas, and a blob manifest.
- each blob manifest stores the same cache key inputs plus per-file hashes for `prompt.md`,
  `svvyx-guidance.md`, `commands.d.ts`, and `native-tool-schemas.json`
- the cache key is derived from the resolved actor-facing inputs: actor kind, loaded extension ids,
  available extension ids, each extension's current extension context fingerprint, agent-context
  format version, and external-instruction fingerprint when external instructions are part of the
  actor prompt
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

### Agent Context Binding

Each session or workflow task-agent attempt stores a durable agent context binding:

- actor kind
- selected agent profile or task-agent config identity
- loaded extension ids
- available extension ids
- current extension context fingerprints used for those extensions
- aggregate cache key for generated prompt text, loaded `svvyx` command guidance, native tool
  schemas, and TypeScript declarations
- external instruction fingerprint when external instructions reached the actor
- generated agent context fingerprint
- bound time

New sessions derive `loadedExtensions` and `availableExtensions` from the agent profile defaults or
from explicit creation-time overrides. `load_extension` mutates only the current session binding by
moving the requested extension from `availableExtensions` to `loadedExtensions`; it never mutates the
global agent profile.

The build unit is an extension. The generated agent context aggregate is cached by actor kind,
loaded extension set, available extension set, current extension context fingerprints, agent-context
format version, and external-instruction fingerprint. It is not built per visual pane. Two sessions
with the same resolved binding share the same aggregate cache entry. A session that loads an
additional extension gets a different binding, aggregate cache key, and generated agent context
fingerprint.

When an extension changes and a successful build activates:

- the current mounted extension command set remains usable until the staging build is complete and
  atomically replaces `builds/extensions/<id>/current/`
- sessions whose loaded or available set contains that extension enqueue `agent_context_refresh`
  control work when the new generated agent context fingerprint differs from their bound fingerprint
- inactive sessions apply the queued `agent_context_refresh` through backend preflight immediately
  before their next prompt-bearing work runs, not when a pane is visually opened
- active sessions show a queued `Update agent context` row and apply the new binding at the next
  safe model boundary when the active pi run reaches the `refreshRunContext` hook
- already emitted tool calls finish against the tool set that produced them
- no empty aggregate or missing `svvyx` command set may be exposed between builds

`agent_context_refresh` is the single explicit surface-control work item for generated agent context
changes. It updates the bound base instructions, loaded and available extension binding, generated
instructions, loaded `svvyx` command guidance, generated TypeScript declarations, native tool schemas,
external instructions, aggregate cache key, generated agent context fingerprint, and mounted `svvyx`
command set. It does not send text to pi, create assistant- or user-authored transcript content, or
write prompt history.

If only internal implementation changed and the generated actor-facing context did not, no agent
context refresh is needed.

When an existing session or task attempt applies an agent context refresh, `svvy` records a
user-visible product event in that same session or thread:

```text
Agent context updated
```

The event is not model-authored transcript text. Its expanded details must list the actual changed
categories, such as:

- base instructions
- loaded extension instructions
- available extension loading hints
- extensions changed by id
- native tool declarations
- loaded `svvyx` command guidance
- generated TypeScript declarations
- external instructions changed by file name

The event must not mention other sessions or threads that may also need or receive the same update.

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

The sidebar reference-pane order is:

```text
Logs
Agents
Extensions
Workflows
```

`Agents` and `Extensions` are the two configuration panes for this feature.

### Agents Pane

The Agents pane owns agent profiles and actor composition.

It should show:

- profile name and description
- orchestrator profiles
- special profiles such as the handler-thread profile
- future workflow task-agent profiles when exposed
- locked actor kind
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

- category: shipped, user, or external_instruction
- interface: native_tool, svvyx, or instructions
- title
- description
- full loaded instructions textarea
- minimal available instructions textarea
- optional editable executable source for extensions that have source-backed `svvyx` builds
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

For `external_instruction` records, the detail view may show loaded file content and an
open-external-file action, but it must not offer content editing, deletion, or content reset.

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

Extensions enter a surface in two ways.

### Agent Profile Defaults

The persistent profile config decides default-loaded, available, and unavailable extension sets for
new turns.

### `load_extension`

`load_extension` is a native control tool.

It lets an actor load an extension that is available but not loaded.

The load is current-session only. It updates the calling session's durable extension binding and
does not change the agent profile's default-loaded, available, or unavailable states.

Input:

```json
{
  "extensionId": "smithers"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `extensionId` | string | Required exact id of an extension that is currently available to this actor. |

`load_extension` is not a build, install, dependency-approval, env-entry, or management command. It
must only load an extension that is already ready for this actor. If the extension is not ready,
`load_extension` fails with actionable issues and leaves the actor binding unchanged. The agent can
then load Extension Managing, run `svvyx extensions inspect <id> --json`, run a build, or ask the
user to configure missing env values as appropriate.

On success, `load_extension` must:

- verify the extension is available for that actor
- verify the current successful build is valid when the extension has a build
- verify dependency/install/env readiness for runtime use
- mount the extension in the actor-scoped `svvyx` surface
- update the generated TypeScript client declarations for later `execute_typescript` calls in the
  same turn
- return the full instructions and the same loaded extension object shape used by `list_extensions`
- update the calling session's generated agent context binding and generated agent context
  fingerprint
- record an `Agent context updated` product event for the calling session, with details that the
  extension was loaded by `load_extension`

Same-turn loading is mandatory. After `load_extension` returns `ok: true`, later tool calls in the
same user turn may use the newly loaded native tools, `svvyx` namespace, full instructions, and
generated TypeScript clients. `svvy` must refresh the current actor's tool declarations and generated
context before the next model call in that same turn; it must not defer successful loads to a later
turn.

Success result:

```ts
type LoadExtensionResult = {
  ok: true;
  extension: LoadedExtensionForCurrentActor & {
    instructions: string;
  };
};
```

The `extension` object uses the same fields and redaction rules as a loaded entry from
`list_extensions`. The additional `instructions` field contains the full loaded instructions that
are now part of the actor context. `load_extension` must not return custom `added`, `guidance`,
`svvyxNamespaces`, `codeModeTypes`, or similar one-off buckets. Command details remain discoverable
through the loaded extension's own CLI or generated client documentation.

Example:

```json
{
  "ok": true,
  "extension": {
    "id": "smithers",
    "category": "shipped",
    "interface": "svvyx",
    "title": "Smithers",
    "description": "Workflow supervision commands for handler threads.",
    "resettable": true,
    "deletable": false,
    "typescriptApiEnabled": true,
    "instructions": "Full loaded Smithers instructions...",
    "paths": {
      "sourceRoot": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/smithers",
      "manifest": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/smithers/manifest.json",
      "instructionsFull": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/smithers/instructions/full.md",
      "instructionsMinimal": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/smithers/instructions/minimal.md",
      "externalInstructionFile": null,
      "extensionSource": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/smithers/source",
      "packageJson": "/Users/example/.config/svvy/extensions/package/package.json",
      "lockfile": "/Users/example/.config/svvy/extensions/package/bun.lock",
      "generatedRoot": "/Users/example/.config/svvy/extensions/generated/extensions/smithers",
      "typescriptTypes": "/Users/example/.config/svvy/extensions/generated/extensions/smithers/types.d.ts",
      "buildCurrent": "/Users/example/.config/svvy/extensions/builds/extensions/smithers/current"
    },
    "requirements": {
      "externalBinaries": [],
      "env": [],
      "dependencies": [],
      "trustedCliDependencies": [],
      "trustedDependencies": []
    },
    "state": {
      "binding": "loaded",
      "draftChanged": false,
      "buildRequired": false,
      "currentBuild": {
        "status": "ready"
      },
      "lastBuild": {
        "status": "success"
      },
      "ready": true,
      "issues": []
    }
  }
}
```

Failure result:

```ts
type LoadExtensionErrorResult = {
  ok: false;
  error: {
    code:
      | "EXTENSION_NOT_AVAILABLE"
      | "EXTENSION_NOT_READY"
      | "EXTENSION_ENV_MISSING"
      | "DEPENDENCY_APPROVAL_REQUIRED"
      | "DEPENDENCY_MISSING"
      | "BUILD_REQUIRED"
      | "BUILD_FAILED"
      | "NO_CURRENT_BUILD"
      | "CURRENT_BUILD_INVALID";
    message: string;
    extensionId: string;
    issues?: ExtensionIssue[];
    missingEnv?: ExtensionRequirements["env"];
  };
};
```

If dependency approval, dependency install, build, missing required env, or validation would be
needed before runtime use, `load_extension` returns `ok: false`. It must not create dependency
approval requests, run install, run build, mutate the actor binding, or mount a partial extension.

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
- typed client inputs for generated `svvy` and extension clients when useful

Incur does not itself give the model tools. The model can use an Incur command only through a
runtime path that `svvy` exposes, such as `exec_command`, a narrower CLI runner, or
`execute_typescript`.

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
- loaded `svvyx` command guidance includes only currently loaded extensions
- generated `Commands` types include only currently loaded extensions
- available-but-not-loaded extensions contribute only minimal loading guidance
- unavailable extensions contribute nothing
- prompt/type/tool fingerprints derive from the resolved generated agent context

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
        -> exec_command usage and generated execute_typescript client usage
```

Smithers hot reload is not the primary extension refresh mechanism. It reloads workflow build
functions for a running Smithers workflow so future workflow rendering or task attempts can pick up
workflow source changes. App-global extension source, dependency, generated agent context, and session
binding refresh are owned by `svvy`.

## `execute_typescript`

`execute_typescript` remains a native direct tool for actor-local TypeScript composition.

The resolved model is:

- the snippet may run ordinary TypeScript
- generated `svvy` and loaded-extension clients are the preferred way to call `svvy` capabilities
  from TypeScript
- generated clients are actor-scoped and extension-scoped
- generated clients expose only capabilities that are currently loaded and allowed for the actor
- no broad hand-written helper surface for ordinary repository primitives is part of the final
  spec
- arbitrary TypeScript side effects that do not go through generated clients are treated as opaque
  process behavior for UI capture and policy

The TypeScript API is controlled per extension. If an extension has TypeScript API disabled, it can
still be callable through `svvyx` when loaded, but generated TypeScript client helpers for that
extension are not included in `execute_typescript`.

Generated clients should be built from the same source contracts as the loaded extension runtime:

- native tool schemas for loaded native tool extensions
- `svvyx`/Incur command schemas for loaded `svvyx` extensions
- app-owned control contracts for loaded native control tools

Prompt-only extensions do not contribute generated TypeScript clients. In particular, the shipped
Web extension is prompt-only TinyFish CLI guidance and does not expose generated Web clients.

Implementation may use Incur's typed client machinery where it is the best source contract for an
extension CLI. That is an implementation detail; the agent-facing contract is generated
actor-scoped TypeScript clients, not an exposed generic Incur client requirement.

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

### Resolved Split

The resolved native direct tool set includes:

- `exec_command`
- `write_stdin`
- `execute_typescript`
- `apply_patch`
- `load_extension`
- `list_extensions`
- product control tools such as `thread_start`, `thread_resume`, `thread_handoff`, `wait`,
  `runtime_current`, `thread_current`, `thread_list`, and `thread_handoffs`
- artifact tools, because artifacts are `svvy` product state

`svvyx` extensions expose actor-scoped CLI commands through `exec_command` and may expose generated
TypeScript clients inside `execute_typescript` when `typescriptApiEnabled` is true.

Prompt-only direct CLI extensions do not expose `svvyx` commands or generated TypeScript clients.
They contribute instructions for using the official external CLI through `exec_command`.

Under the resolved shipped extension map, cx is prompt-only direct CLI guidance and Smithers controls
are a shipped `svvyx` extension plus Smithers-native bridge tools where specified.

### Ordinary Filesystem Work

Read, search, and list operations should follow Codex's ordinary coding-agent model: use shell
commands such as `rg`, `rg --files`, `sed`, `cat`, `ls`, `find`, `git show`, `nl`, and `wc`.

General `read`, `grep`, `find`, `ls`, `edit`, and `write` are not part of the resolved native
model-visible tool set. If any are added later, they need a concrete product reason beyond ordinary
repo work.

The Filesystem native extension exposes exactly the Codex-like command/edit primitives:

- `exec_command` starts a command in a PTY or non-PTY process and returns output, exit status, or a
  `session_id` for a still-running process
- `write_stdin` sends bytes to an existing running `exec_command` session or polls it for more
  output
- `apply_patch` applies structured file edits through Codex's freeform patch grammar

There is no separate model-facing tool named `shell`, `bash`, `read`, `write`, `edit`, `grep`,
`find`, or `ls` in this resolved surface. The user-facing and agent-facing command execution tool is
`exec_command`.

The Filesystem extension instructions should be adapted from:

- `docs/references/codex/codex-rs/core/gpt_5_2_prompt.md`
- `docs/references/codex/codex-rs/core/gpt_5_codex_prompt.md`
- `docs/references/codex/codex-rs/core/src/tools/handlers/shell_spec.rs`

Relevant source-backed rules:

- prefer `rg` for text search and `rg --files` for filename search
- use ordinary shell tools for file inspection
- set the shell tool working directory instead of relying on `cd`
- parallelize independent reads, searches, and listings through separate tool calls where possible
- use `write_stdin` only for processes that returned a `session_id`
- use `apply_patch` for file edits instead of creating custom write/edit APIs

`svvy` should not copy pi's native `read`, `grep`, `find`, and `ls` preference for this feature,
because this extension map intentionally follows Codex's shell-first model.

### `exec_command` Source And Lifecycle

`exec_command` should borrow Codex's unified exec shape and prompt guidance.

Tool name:

```text
exec_command
```

Description:

```text
Runs a command in a PTY, returning output or a session ID for ongoing interaction.
```

Input:

```ts
type ExecCommandInput = {
  cmd: string;
  workdir?: string;
  shell?: string;
  tty?: boolean;
  login?: boolean;
  yield_time_ms?: number;
  max_output_tokens?: number;
  sandbox_permissions?: "use_default" | "require_escalated" | "with_additional_permissions";
  additional_permissions?: {
    network?: { enabled: boolean };
    file_system?: {
      read?: string[];
      write?: string[];
    };
  };
  justification?: string;
  prefix_rule?: string[];
};
```

Parameter rules:

- `cmd` is required.
- `workdir` defaults to the current turn cwd.
- `shell` defaults to the user's default shell.
- `tty` defaults to `false`; `true` allocates an interactive PTY.
- `login` is included only when the runtime supports shell login mode.
- `yield_time_ms` controls how long the tool waits before yielding output.
- `max_output_tokens` controls the response output budget.
- `sandbox_permissions` uses Codex's vocabulary, but `svvy` does not expose a separate
  user-facing `sandbox_mode` setting.
- `justification` is meaningful only with `sandbox_permissions: "require_escalated"` and should be a
  short user-facing approval question.
- `prefix_rule` is meaningful only with `sandbox_permissions: "require_escalated"` and proposes a
  reusable approved command prefix such as `["npm", "run", "dev"]`.
- `additional_permissions` is meaningful only with `sandbox_permissions:
  "with_additional_permissions"` and requests scoped filesystem or network permission without
  requesting fully unsandboxed execution.

Result shape:

```ts
type ExecCommandResult = {
  chunk_id?: string;
  wall_time_seconds: number;
  exit_code?: number | null;
  session_id?: number;
  original_token_count?: number;
  output: string;
};
```

Lifecycle:

- short-lived commands return output and `exit_code`; they do not return `session_id`
- commands still running after the yield window return current output plus `session_id`
- `session_id` is the model-facing name for the stored process id
- the process can outlive the first tool call
- the UI must show a running command card for live sessions and include a user Kill control
- killing a running command sends the runtime's normal termination signal and records the
  termination as command lifecycle output
- already-running sessions stay scoped to the owning actor surface or workflow task attempt
- unknown or already-cleaned-up `session_id` values return a clear error

Codex details worth preserving unless implementation constraints force a change:

- `yield_time_ms` defaults to `10000`
- `max_output_tokens` defaults to `10000`
- output is capped around 1 MiB before model-response truncation
- initial `exec_command` yield waits are clamped between a small minimum and a maximum around 30s
- `write_stdin` empty polls wait longer than non-empty writes
- output is streamed to UI events and also returned as a bounded tool response snapshot
- long-running process entries are pruned by a bounded process manager, preferring old exited
  processes before live recent ones
- Codex uses a maximum of 64 remembered unified exec processes; `svvy` should use the same number
  unless implementation testing shows it is too high for local resource use

### `write_stdin`

`write_stdin` is only for continuing an `exec_command` session that returned `session_id`.

Tool name:

```text
write_stdin
```

Description:

```text
Writes characters to an existing unified exec session and returns recent output.
```

Input:

```ts
type WriteStdinInput = {
  session_id: number;
  chars?: string;
  yield_time_ms?: number;
  max_output_tokens?: number;
};
```

Rules:

- `session_id` is required.
- `chars` defaults to the empty string.
- empty `chars` means poll for recent output.
- non-empty `chars` writes those bytes to the process stdin, then collects recent output.
- non-empty writes are valid only for TTY sessions; non-TTY sessions return a stdin-closed error.
- Ctrl-C is sent as `"\u0003"`.
- `write_stdin` is not a second shell and cannot start a new process.
- `yield_time_ms` defaults to `250` before runtime clamping.
- empty polls are clamped to at least `5000ms`.
- non-empty writes are capped around `30000ms`.

Result shape is the same as `exec_command`.

### Shell Action Visualization

Codex-style command parsing is UI visualization, not authoritative side-effect capture.

`svvy` should parse common shell commands to display likely actions, such as:

- `cat`, `sed -n`, `head`, `tail`, and `nl` as likely file reads
- `rg` and `grep` as searches
- `ls`, `find`, and `tree` as listings

These parsed actions are best-effort display hints. They must not be used as security truth,
approval truth, exact read tracking, or revert provenance. Arbitrary shell commands, scripts,
package managers, build systems, and child processes remain opaque except for command lifecycle,
output, approvals, running-session state, and observed workspace changes after the fact.

Codex collapses a parsed command display to unknown when any parsed segment is unknown. `svvy`
should borrow that conservative display behavior: mixed known/unknown shell pipelines must not show
only the known part as if the full command was understood.

Extension-scoped command visualization contributions for cx, git, GitHub CLI, Smithers, Extension
Managing, TinyFish CLI commands, and other known command families are optional display
improvements. If implemented, they must parse actual `exec_command` input and output at the command
boundary. They must not rely on hidden assistant-authored Markdown directives such as
`git-create-pr`, `git-push`, or similar milestone markers. A pull request creation fact is a GitHub
CLI or API event, not a git operation. In v1, authoritative capture comes only from `svvy`-owned tool
and command boundaries.

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
  `package/bun.lock`, `package/node_modules/`, trash, snapshots, and packaged shipped defaults are
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

The resolved policy direction is that `svvy` should use Codex's approval-boundary pattern, with
`auto_review` as the only implemented reviewer for actions that require approval.

### Codex Reference Facts

Local Codex reference audit found:

- Codex's core model-visible coding surface appears closer to shell/exec plus `apply_patch` than to
  a broad family of model-visible read/write/edit tools, even though the Codex app also has
  filesystem RPCs for app-server behavior.
- Codex separates "which actions require approval" from "who reviews the approval."
- Codex `ApprovalsReviewer` can be `user`, `auto_review`, or `guardian_subagent`, but `svvy` v1
  implements only `auto_review` as a product reviewer.
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

There is no user-facing `sandbox_mode` setting in this spec. The agent and user do not choose among
`read-only`, `workspace-write`, or `danger-full-access` modes. Runtime guardrails may still exist
internally, and relevant tools may accept Codex-like `sandbox_permissions`, but the product settings
surface exposes approval/review behavior rather than a separate sandbox-mode concept.

`sandbox_permissions` is a per-action request:

- `use_default` means run under the current normal runtime guardrails.
- `require_escalated` means request approval to run outside the normal guardrails.
- `with_additional_permissions` means request scoped extra filesystem or network permissions without
  asking for fully unrestricted execution.

`justification` and `prefix_rule` are valid only for `require_escalated`. `prefix_rule` proposes a
reusable command-prefix approval and must be narrow enough to be safe. Destructive commands must not
receive persistent prefix rules.

`with_additional_permissions` uses the same approval-boundary flow as `require_escalated`: policy
classifies the request as skipped, approval-required, or forbidden; if approval is required,
`auto_review` is the reviewer. Approval grants only the requested scoped permissions for the
configured approval scope. It must not imply a reusable command-prefix approval, must not bypass the
normal runtime guardrails entirely, and must not mount unavailable extensions or expose new prompt
capabilities.

The `svvy` implementation should model direct-tool execution around Codex's
`ExecApprovalRequirement` shape:

- `Skip`
- `NeedsApproval`
- `Forbidden`

Approval state must stay scoped to the owning actor surface or workflow task attempt. Handler
thread approval state must not leak into the orchestrator, and workflow task approval state must not
leak outside the Smithers attempt that owns it.

`auto_review` runs only at approval boundaries unless a later spec explicitly adopts a stricter
review mode. It is not a guarantee that every command is reviewed. If auto-review times out, fails
to produce parseable output, or otherwise fails, the approval request fails closed.

The reviewer implementation should borrow Codex Guardian's containment posture:

- the reviewer receives a bounded description of the planned action and relevant context
- the reviewer does not receive write tools
- the reviewer runs with read-only product access needed for risk evaluation
- the reviewer cannot approve by mutating state directly; it returns a decision to the owning
  approval flow
- `guardian_subagent` is not a product-facing reviewer name in `svvy`
- `strict_auto_review` is not part of v1; if adopted later, it must be specified as a separate
  stricter mode, not conflated with ordinary `auto_review`

Dependency install approval is a separate product-state approval class. It is keyed to exact
dependency identities and exact trusted dependency identities in the app-global extension package
project, so the same pending request may be referenced by an app pane and by one or more
conversation tool cards. Sharing that dependency approval record does not grant shell approval,
runtime tool approval, or actor capability outside the blocked dependency install/build operation.

### Action Capture And UI Truth

`svvy` distinguishes authoritative capture from inferred visualization.

Authoritative capture comes from boundaries `svvy` owns:

- native tool calls such as `exec_command`, `write_stdin`, `apply_patch`, `list_extensions`, and
  `load_extension`
- app-owned control tools such as handler/thread/runtime controls
- loaded extension invocations through actor-scoped `svvyx`
- generated TypeScript client calls that invoke `svvy` or loaded extension commands
- Extension Managing lifecycle commands
- dependency approval records
- generated agent context refresh records
- `apply_patch` file-change records and exact extension-file revert preimages

Arbitrary shell and arbitrary TypeScript side effects are not authoritative capture surfaces. For
those, `svvy` records:

- command or snippet source
- cwd or task root
- owning actor surface or task attempt
- lifecycle status
- output chunks and bounded result output
- exit code or termination
- approvals and approval decisions
- running `session_id` when applicable
- observed workspace changes after the fact when the workspace state can be compared

`svvy` must not claim exact arbitrary reads, writes, network requests, or child process behavior
unless that fact came through an owned boundary. Codex-style command parsing and extension-scoped
visualization rules are display hints only. They may make the UI easier to scan, but they are not
security policy, not approval evidence by themselves, and not revert provenance.

Assistant-authored Markdown must not be treated as an authoritative action boundary for Git or
GitHub work. `svvy` should not adopt Codex App-style hidden final-response directives for staging,
committing, pushing, or pull request creation. The product can render those milestones from actual
command records, parsed `git`/`gh` commands, GitHub API results, and observed workspace state instead.

### Product-State Mutations With Revert

Actions that alter Extension Managing state but are not shell commands should execute directly
through the intended product tool, then show high-quality UI for understanding and reverting the
change when the change has an exact inverse.

Examples:

- changing extension instructions, source, or manifest files through `apply_patch`
- changing extension usage through `svvyx extensions set-usage`
- resetting a shipped extension through `svvyx extensions reset`
- deleting a user extension through `svvyx extensions delete`

Instead of stopping for user approval like many agent apps, `svvy` should visualize the tool use and
offer simple revert for those exact changes.

The revert contract is intentionally narrow:

- file edits, including instruction edits, source edits, and manifest metadata edits, are reverted per
  recorded `apply_patch` change; there is no separate custom edit/write surface
- `set-usage`, `reset`, and `delete` are command-level revertable
- `create` is not shown as revertable; the UI can show Delete for the created user extension
- build activation is not a user-facing rollback surface; current build status and extension context
  fingerprints are internal activation state
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
| `exec_command` | Codex-like approval-boundary policy; auto-review is the reviewer when approval is required. |
| `write_stdin` | Continues an existing running `exec_command` session; inherits the owning session/process policy and records lifecycle output. |
| `svvyx ...` invoked through `exec_command` | Inherits `exec_command` policy. |
| `apply_patch` | Direct inside the session workspace or allowed extension editing paths; auto-reviewed when it would write outside those roots; rejected when outside policy. |
| `load_extension` | Direct native control only when the extension is available and ready; clear failure when unavailable or not ready. It does not build, install, request dependency approval, or mutate the binding on failure. |
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
  command set untouched
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
- agent-visible build work shows the same approval as a tool card requiring approval in the owning
  conversation
- both placements reference one durable approval request when they are blocked on the same unresolved
  dependency identities
- approving a request records the listed dependency and trusted dependency identities in the approval
  ledger and updates every pane, conversation tool card, and blocked operation that references it
- approval resumes blocked app-level build work and any still-pending conversation tool card whose
  blocked operation is an install/build for the same approval request; it does not create a new
  actor binding or mount an extension into a session
- rejecting a request marks that pending request rejected, updates every referencing pane and
  conversation tool card, leaves `buildRequired: true`, and leaves the current mounted command set
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
- are not exposed through `svvyx extensions ...`, `list_extensions`, generated prompt text, loaded
  `svvyx` command guidance, generated TypeScript declarations, generated native tool schemas,
  `svvyx --help`, or `execute_typescript` declarations

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
  "ready": true
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

When `execute_typescript` uses a generated loaded-extension client, the same extension-specific env
map is supplied only to the invoked extension command. The broader `execute_typescript` snippet
environment, pi runtime process, actor command environment, and other loaded extensions must not
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
  ready state before the next extension invocation

The safe base env may include ordinary process values required for execution, but it must not include
extension secrets from app storage. If the host process itself has unrelated secret values in its
environment, `svvy` should prefer a minimal allowlisted base env for extension commands so unrelated
host secrets are not inherited accidentally.

### Missing Values

Build does not require env values. A build validates env declarations and generated extension context, but it
does not need to call the remote service or possess secrets.

Missing required env values block runtime use, not source compilation. Specifically:

- `svvyx extensions build <id> --json` may succeed while reporting `ready: false`.
- `list_extensions` and `svvyx extensions inspect <id> --json` report missing/configured status.
- `load_extension` fails with `EXTENSION_ENV_MISSING` when loading would mount an executable
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
- loaded `svvyx` command guidance
- generated TypeScript declarations
- generated native tool schemas
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
  env, generated type declarations, generated native tool schemas, or generated help text

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

The Extensions pane lets users save and load named snapshots of extension source and settings.

Snapshot payload includes:

- user extension source files and manifests
- shipped overlay files
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
identities. Current mounted extension command sets remain usable until the replacement builds succeed.
Approving the request records those identities and resumes the blocked install/build work. Rejecting
the request leaves affected extensions build-required and leaves current mounted extension command sets
unchanged.

Snapshot restore does not get special dependency rules. It changes files and package state, then the
normal install boundary checks the approved dependency ledger. It must not resolve non-exact package
specs to latest or silently accept unapproved trusted dependency identities. If a snapshot removes an
extension that an existing session had loaded or available, that session drops the missing extension
just as it would after extension deletion and then refreshes its binding.

The key product improvement is that agents can use configured secrets without being able to read
them. `svvy` also knows exactly which values to redact because they were entered through the app.

## Prompt-Only Git And GitHub Extensions

Git and GitHub are shipped prompt-only extensions. They provide reusable coding-agent guidance for
ordinary shell use of mature local CLIs. They must not introduce native model tools, `svvyx`
commands, generated TypeScript clients, custom edit/write surfaces, custom staging APIs, or a
parallel semantic `git.*` or `github.*` abstraction by default.

The product reason is straightforward:

- `git` and GitHub CLI already provide the operational surface agents need.
- `exec_command` records command lifecycle, output, approvals, running sessions, and observed
  workspace changes.
- `apply_patch` remains the editing surface for file changes.
- command parsing and command facts can support UI visualization without inventing a second API.
- prompt-only instructions are enough to express conservative coding-agent behavior and safety
  policy.

Git is default-loaded for every adopted actor kind. GitHub is default-loaded for orchestrators and
handler threads, and available for workflow task agents. Workflow task agents may load GitHub only
when the task objective explicitly requires GitHub issues, pull requests, reviews, Actions, or other
GitHub work. GitHub remains available, not unavailable, for workflow task agents so a task whose
contract explicitly names GitHub can request it through the normal extension-loading path.

Git and GitHub also participate in the app-managed trusted CLI dependency registry. The shipped
records are:

```ts
const gitTrustedCliDependency = {
  id: "git",
  binary: "git",
  package: "git",
  version: "2.54.0",
  source: "git-scm-release",
  upstream: "https://git-scm.com/",
};

const ghTrustedCliDependency = {
  id: "gh",
  binary: "gh",
  package: "gh",
  version: "2.93.0",
  source: "github-release",
  upstream: "https://github.com/cli/cli",
};
```

The same rule applies to every trusted CLI dependency: if the user already has the binary, use it;
if the binary is missing, the app may offer to install exactly the pinned version through the normal
confirmation UI; agents do not receive install commands.

### Git Extension

Extension metadata:

```json
{
  "id": "git",
  "category": "shipped",
  "interface": "instructions",
  "title": "Git",
  "description": "Conservative git CLI guidance for repository inspection, dirty worktrees, staging, commits, branches, and destructive-command safety.",
  "typescriptApiEnabled": false,
  "requirements": {
    "externalBinaries": [{ "name": "git", "status": "unknown" }],
    "env": [],
    "dependencies": [],
    "trustedCliDependencies": [
      {
        "id": "git",
        "binary": "git",
        "status": "unknown",
        "detectedVersion": null,
        "install": {
          "package": "git",
          "version": "2.54.0",
          "source": "git-scm-release",
          "approval": "not_required_when_user_binary_exists",
          "install": "not_installed"
        }
      }
    ],
    "trustedDependencies": []
  }
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | default_loaded |
| Handler thread | default_loaded |
| Workflow task agent | default_loaded |

Full loaded instructions:

```md
# Git

Use ordinary `git` commands through the shell for repository inspection and user-requested
version-control work.

Before changing git state, inspect scope with `git status -sb` and, when relevant, `git diff` plus
`git diff --staged`.

Dirty worktree rules:
- You may be in a dirty worktree.
- Never revert, overwrite, remove, stage, or commit changes you did not make unless the user
  explicitly asks.
- If unrelated changes exist, keep them separate. Use explicit pathspecs for staging and commits.
- If changes in a file you need to edit overlap with user changes, inspect the file carefully and
  preserve their work.

Safe inspection commands include:
- `git status -sb`
- `git diff`
- `git diff --staged`
- `git log --oneline --decorate -n 20`
- `git show <rev>`
- `git branch --show-current`
- `git remote -v`

Do not run destructive git commands unless the user explicitly requested that exact operation or
approved it after you explained the consequence. This includes:
- `git reset --hard`
- `git clean`
- `git checkout -- <path>`
- `git restore <path>` or `git restore .`
- `git rebase`, `git merge`, or `git pull` when conflicts or history changes are plausible
- force pushes except `--force-with-lease` after explicit approval

Staging and commits:
- Do not commit unless the user asks for a commit or a publish flow.
- Stage only intended files. Prefer `git add <path>...`; use `git add -A` only when the whole
  worktree is confirmed in scope.
- Before committing, review `git diff --staged`.
- Follow repository commit conventions when discoverable from instructions or recent history.
- Use Conventional Commits when the repository or user requests it.
- After a successful commit, report the commit hash and summarize what was committed.

When a requested git operation is blocked by missing identity, auth, conflicts, detached HEAD,
protected branch, or unrelated worktree changes, stop and explain the blocker with the exact command
output summary.
```

Minimal available instructions are normally not shown because Git is default-loaded for all adopted
actor kinds. If a custom profile makes Git only available, use:

```md
Load Git when the task requires repository inspection, staging, commits, branch work, history, or
dirty-worktree reasoning. Use ordinary `git` commands through the shell; this extension adds no
tools.
```

### GitHub Extension

Extension metadata:

```json
{
  "id": "github",
  "category": "shipped",
  "interface": "instructions",
  "title": "GitHub",
  "description": "Conservative GitHub CLI guidance for issues, pull requests, review comments, Actions checks, publishing, and PR wrap-up.",
  "typescriptApiEnabled": false,
  "requirements": {
    "externalBinaries": [
      { "name": "git", "status": "unknown" },
      { "name": "gh", "status": "unknown" }
    ],
    "env": [],
    "dependencies": [],
    "trustedCliDependencies": [
      {
        "id": "git",
        "binary": "git",
        "status": "unknown",
        "detectedVersion": null,
        "install": {
          "package": "git",
          "version": "2.54.0",
          "source": "git-scm-release",
          "approval": "not_required_when_user_binary_exists",
          "install": "not_installed"
        }
      },
      {
        "id": "gh",
        "binary": "gh",
        "status": "unknown",
        "detectedVersion": null,
        "install": {
          "package": "gh",
          "version": "2.93.0",
          "source": "github-release",
          "approval": "not_required_when_user_binary_exists",
          "install": "not_installed"
        }
      }
    ],
    "trustedDependencies": []
  }
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | default_loaded |
| Handler thread | default_loaded |
| Workflow task agent | available |

Full loaded instructions:

```md
# GitHub

Use the GitHub CLI `gh` through the shell for GitHub issue, pull request, review, and Actions
workflows. Do not create GitHub-specific wrapper tools by default.

Setup and auth:
- Use `gh` directly when the task requires GitHub CLI behavior.
- Do not run preflight availability or auth checks before ordinary `gh` use.
- If a `gh` command fails because `gh` is missing, report that the app-managed trusted CLI
  dependency is unavailable and ask the user to enable or install it through the app.
- If a `gh` command fails because authentication or scopes are missing, ask the user to run
  `gh auth login` and retry only after they confirm.

PR and issue inspection:
- Resolve the repo from local git when possible: `gh repo view --json nameWithOwner,defaultBranchRef`.
- Resolve the current branch PR with `gh pr view --json number,url,title,headRefName,baseRefName,state`.
- Inspect PRs with `gh pr view <pr> --json title,body,author,state,mergeable,reviewDecision,statusCheckRollup,files,commits,comments,reviews,url`.
- Inspect issues with `gh issue view <issue> --json title,body,author,state,labels,comments,url`.

PR creation and publishing:
- Do not push or create a PR unless the user asks.
- Before push or PR creation, inspect `git status -sb`, current branch, remote, and staged diff.
- Push with tracking: `git push -u origin $(git branch --show-current)`.
- Default to draft PRs unless the user explicitly asks for ready-for-review.
- Prefer `gh pr create --draft --fill --head "$(git branch --show-current)"`; use `--base <branch>`
  when requested or when the default branch is known.
- Write multiline PR bodies to a temp file and pass `--body-file <path>`.

Review comments and replies:
- Do not post comments, resolve review threads, request reviews, approve, close, merge, or submit a
  PR review unless the user explicitly asks for that write action.
- Draft comment text locally first when the wording matters.
- For review-thread work, prefer thread-aware reads via `gh api graphql` because flat comment
  listings can miss resolved, outdated, or threaded state.
- Separate actionable requested changes from approvals, duplicates, resolved threads, outdated
  comments, and informational notes.
- If comments conflict or are ambiguous, ask before editing or posting.

CI and checks:
- Use `gh pr checks <pr> --json name,state,bucket,link,startedAt,completedAt,workflow`.
- For GitHub Actions failures, inspect runs with
  `gh run view <run-id> --json name,workflowName,conclusion,status,url,event,headBranch,headSha` and
  logs with `gh run view <run-id> --log`.
- Treat external CI providers as report-only unless the user asks to investigate them.

Wrap-up behavior:
- For PR work, summarize branch, commit or commits, PR URL, checks run, unresolved review items, and
  residual risk.
- Never imply a GitHub write happened unless the command succeeded.
```

Minimal available instructions for workflow task agents and custom available-only profiles:

```md
Load GitHub only when the task objective explicitly requires GitHub issues, pull requests, review
comments, Actions checks, or other GitHub work. Use ordinary `gh` commands through the shell; this
extension adds no tools and should not be loaded for generic repository coding.
```

## Shipped Extension Set

This is the resolved shipped extension map from the discussion so far. `category: "shipped"` means
provided by `svvy`, non-deletable, resettable, and configurable per agent usage state. External
instruction records use `category: "external_instruction"` and the same usage-state controls, but
their source files are read-only external inputs.

| Extension | Category | Interface | Included tools or capability | Orchestrator | Handler | Workflow agent |
| --- | --- | --- | --- | --- | --- | --- |
| Filesystem | shipped | native_tool | `exec_command`, `write_stdin`, `apply_patch`, Codex-like filesystem/shell instructions, and `svvyx` access through `exec_command` | default_loaded | default_loaded | default_loaded |
| Execute TypeScript | shipped | native_tool | `execute_typescript` with generated `svvy` and loaded-extension clients as the preferred TypeScript interface | default_loaded | default_loaded | default_loaded |
| Extension Loading | shipped | native_tool | `list_extensions`, `load_extension` | default_loaded | default_loaded | default_loaded |
| Extension Managing | shipped | svvyx | `svvyx extensions ...` lifecycle commands for inspect, create, build, usage state, reset, delete, and revert; content edits use returned file paths plus native `apply_patch` | available | available | unavailable |
| cx | shipped | instructions | official cx CLI semantic code-navigation guidance through `exec_command`; no native `cx_*`, `svvyx cx`, generated TypeScript client, product navigation, or product-state controls | default_loaded | default_loaded | default_loaded |
| Smithers | shipped | svvyx | workflow run/list/inspect/resume/signal/transcript controls | unavailable | default_loaded | unavailable |
| Web | shipped | instructions | TinyFish CLI search/fetch/browser guidance through ordinary shell commands; no `svvy` Web tools, `svvyx web` commands, generated Web TypeScript clients, Web Provider settings, or `svvy`-owned TinyFish key storage | default_loaded | default_loaded | default_loaded |
| Git | shipped | instructions | Git shell guidance for dirty worktrees, staging, commits, branch/history inspection, and destructive-command safety; no wrapper CLI or generated TypeScript client by default | default_loaded | default_loaded | default_loaded |
| GitHub | shipped | instructions | GitHub/`gh` CLI guidance for issues, PRs, review comments, Actions, publishing, and wrap-up; no wrapper CLI or generated TypeScript client by default | default_loaded | default_loaded | available |
| External Instructions | external_instruction | instructions | read-only external instruction files such as `AGENTS.md` and `CLAUDE.md`, surfaced with open-external-file controls | default_loaded | default_loaded | default_loaded |
| Project CI | shipped | instructions | Project CI authoring guidance for defining and maintaining CI workflow lanes; no tools by default | available | available | unavailable |

The Git and GitHub extensions must not wrap `git` or `gh` by default. Agents use ordinary shell
commands and command help. App-owned startup, extension refresh, `list_extensions`, and Extension
Managing `inspect` paths may refresh declared `externalBinaries` status for `git` and `gh`, and may
report known CLI auth blockers through `state.ready` and `state.issues`. That app-owned status
refresh is not an instruction for agents to run `gh --version`, `gh auth status`, or any other
availability/auth preflight. The app must not add a separate auth-status field, run login flows,
mutate credentials, or watch arbitrary failed agent shell commands to update extension readiness.

The Git and GitHub prompt-only instructions adapt:

- Codex dirty-worktree and destructive-git safeguards from
  `docs/references/codex/codex-rs/core/gpt_5_codex_prompt.md` and
  `docs/references/codex/codex-rs/core/gpt_5_2_prompt.md`
- GitHub CLI usage patterns from local Codex and pi-adjacent GitHub skill references

These extensions teach shell use of `git` and `gh`; they do not introduce a parallel semantic
`git.*` or `github.*` model interface by default.

Extension Managing combines the earlier separate "Extension Manager" and "Incur Extension
Authoring" ideas. There is no separate Incur Authoring extension unless this gets split again later.
Its detailed command surface is defined in `docs/specs/extension-managing.spec.md`.

Project CI is a shipped prompt-only extension. It is available to orchestrators and handlers so
`thread_start` can preload it for CI-authoring objectives and handlers can load it with
`load_extension({ extensionId: "project-ci" })` when CI definition work appears after delegation.
Running existing Project CI workflow entries does not require loading this extension; the Smithers
extension owns runtime workflow supervision.

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

## External Instructions

- base instructions live on agent profiles
- actor-specific generated context is visible from Agents
- extension instructions and generated agent contexts are visible from Extensions and linked from Agents
- available extensions provide minimal prompt hints for session-local loading decisions

External instruction files such as `AGENTS.md` and `CLAUDE.md` are represented as
`category: "external_instruction"` extension records.

Rules:

- they appear in Extensions under a distinct External Instructions category, not as shipped
  extensions and not as user extensions
- they use the same per-agent `default_loaded`, `available`, and `unavailable` controls as all other
  extensions
- they are prompt-only and always use `interface: "instructions"`
- their source files are read-only in `svvy`
- the extension detail view shows path, discovered source, inclusion order, current content, and an
  `Open external file` action
- reset affects only `svvy` usage/settings and any `svvy` metadata overlay; it must not overwrite,
  truncate, regenerate, or delete the external file
- generated-context previews show the exact external instruction content that reached the actor
- generated-context fingerprints include exact content, source metadata visible to the actor, and
  ordering
- external file changes detected outside `svvy` update readiness/fingerprints through the same
  generated context refresh pipeline as extension changes

## Triggering

Direct `@extension` mention is not part of the adopted loading mechanism in this spec. The adopted
agent-side loading mechanism is `load_extension`; the adopted user-side mechanism is per-agent
extension usage configuration.

Fuzzy trigger words were discussed early, but they must not mutate the user message with hidden
instructions. If trigger matching is ever added, it should produce structured metadata or a visible
suggestion, not hidden prose stuffed into the prompt.

Available extensions should include minimal instructions that explain when to load them. The model
may then call `load_extension` when useful.

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

## Generated Agent Context Invariants

For every actor turn, `svvy` must be able to show exactly what the agent received.

The generated view should include:

- base instructions
- loaded extension full instructions
- available extension minimal instructions
- external instructions that reached the actor
- mounted `svvyx` extension list
- loaded `svvyx` command guidance
- generated TypeScript declarations for `svvy` and loaded-extension clients
- native tool declarations
- unavailable extensions omitted entirely

The generated agent context is actor-specific. There is no universal `SvvyApi`, universal command
list, or one-size-fits-all prompt.

### Extension Context Fingerprint

Each extension's current successful build has an internal extension context fingerprint.

This fingerprint hashes only actor-facing extension contract data:

- stable extension id
- interface
- title and description when those fields can appear in generated context, generated docs, or
  agent-facing command output
- TypeScript API enabled flag
- full loaded instructions
- minimal available instructions
- command manifest for executable extensions, including command ids, command paths, descriptions,
  aliases when exposed, argument schemas, option schemas, output schemas, examples, deprecation
  markers, and streaming markers
- loaded `svvyx` command guidance bytes
- generated TypeScript client declaration bytes when TypeScript API is enabled
- generated native tool schema bytes
- env declaration metadata that may be shown to the agent: env name, required flag, secret flag,
  short description, defaulted/configured/missing status shape, and ready/issue status shape
- extension-context fingerprint format version

The extension context fingerprint must not include:

- implementation source bytes when the generated actor-facing contract is unchanged
- staging build output
- failed build output
- build ids
- build timestamps
- install timestamps
- dependency install state when generated actor-facing output is unchanged
- dependency cache paths
- secret values
- secret previews
- secret hashes or fingerprints
- keychain or account ids
- storage paths
- value-created, value-updated, or value-last-used timestamps
- generated aggregate cache paths

Build succeeds before context drift is evaluated. Missing required env values, dependency approvals,
install failures, build validation failures, and startup rebuild failures are extension
build/readiness states, not agent context update failures. They must not create failed
`Update agent context` queue rows.

### Agent Context Fingerprint

Each bound session or workflow task-agent attempt stores one generated agent context fingerprint.

The fingerprint hashes exactly the generated context that can affect the next model call or
actor-scoped extension invocation:

- actor kind
- selected agent profile or task-agent config identity only when it affects generated context
- exact resolved base instructions
- ordered loaded extension ids
- each loaded extension's current successful extension context fingerprint
- exact loaded extension full instructions in generated order
- ordered available extension ids
- each available extension's current successful extension context fingerprint
- exact available extension minimal instructions in generated order
- native tool declarations visible to that actor, including names, descriptions, JSON schemas, and
  actor availability
- mounted `svvyx` extension namespace list for loaded extensions
- loaded `svvyx` command guidance included for loaded extensions
- generated TypeScript declarations included for `execute_typescript`, `svvy` clients, and loaded
  extension clients
- generated native tool schema files included in the actor context
- external instructions that reached the actor, including exact content, order, additions/removals,
  and visible source metadata when that metadata appears in generated context
- agent-context fingerprint format version

The agent context fingerprint must not include:

- provider
- model
- reasoning or thinking level
- profile display name
- profile display order
- approval policy settings
- visual pane state
- transcript content
- queued user messages
- unbuilt draft extension source changes
- failed or staging extension builds
- build timestamps
- install timestamps
- dependency install state when generated context is unchanged
- secret/env values or any value-correlating secret metadata
- cache paths and volatile aggregate blob paths

### Drift Detection And Automatic Update

`svvy` detects generated agent context drift by comparing the bound session or task-attempt
fingerprint with the current resolved fingerprint for that same actor and binding:

```ts
bound.agentContextFingerprint !== current.agentContextFingerprint
```

If they differ and no `agent_context_refresh` item is queued, claimed, or actively applying for that
target, `svvy` enqueues `agent_context_refresh` automatically. The user is not asked to approve
normal generated context drift, and ordinary drift does not show a manual update button.

Refresh timing is strict:

- if the target is idle, the update is durably enqueued and claimed before the next prompt-bearing
  item runs; it may never appear as a visible queue row
- if the target is active, the queue shows a special `Update agent context` row until the update is
  claimed or applied
- if the active pi run reaches `refreshRunContext` before the current turn settles, `svvy` applies
  the ready generated context at that safe model boundary
- if there is no active-run safe boundary before settlement, the queued update applies before the
  next prompt-bearing item
- already-issued tool calls finish against the agent context that produced them
- no prompt-bearing item may pass a required queued agent context refresh unless the user explicitly
  cancels that refresh

`agent_context_refresh` may only be enqueued for a ready generated context. If required extension
builds or ready-state checks are blocked or failed, the existing context remains bound and the
blocker is reported through the build/readiness path instead.

### Queue And Event Behavior

The visible queue row label is:

```text
Update agent context
```

The row is a control item, not agent input. It is not editable, not steerable, and not restorable to
the composer. It can be cancelled only while queued and unclaimed. Cancelling leaves the old agent
context bound. If the context is still out of date and no refresh is queued, active, or applying, the
surface shows a sticky affordance:

```text
Agent context is out of date
```

with a `Queue update` action.

On success, `svvy` records a user-visible product event in the affected session or thread only:

```text
Agent context updated
```

Expanded details must identify what changed. They must not mention other sessions or threads that
may also have pending or applied updates.

If the update itself fails after a ready generated context exists, that is an internal product error.
The affected session or thread records a user-only product event:

```text
Agent context update failed
```

The event details include a brief internal-error message and a stable log/error id. The available
actions are `Retry` and `Cancel update`. `Retry` reclaims or re-enqueues the same context refresh for
that target. `Cancel update` leaves the old context bound and exposes the sticky `Agent context is
out of date` / `Queue update` affordance while drift still exists. The same failure also appends an
app log entry. It must not be presented as an extension build failure, dependency approval, missing
secret, or agent-fixable source problem.

## Open Research And Decisions

The following are unresolved from the session and should be settled before implementation:

- Review Codex app and CLI auto-review prompts and policy more deeply before adapting exact
  prompts, even though the local reference already shows approval-boundary semantics rather than
  blanket shell review.
- Define the exact local version of Codex-like approval-boundary semantics for shell.
- Define how far `svvy` should extend auto-review beyond `exec_command` and `apply_patch` for
  extension bridge calls, provider network access, hooks, and permission-like flows.
- Define what information the auto-reviewer receives: actor kind, agent profile, loaded extensions,
  available extension names and summaries for policy context, unavailable extension ids if needed
  for bypass detection, current loaded `svvyx` surface, cwd, command/action JSON, relevant
  read-only filesystem state, and recent conversation state.
- Define the first real version of Project CI as an extension. It is currently a placeholder with no
  actor availability.
- Define the exact generated TypeScript client contract once the local Incur fork API and native
  client-generation strategy are verified.
- Define exact naming and collision rules for extension ids and subcommand namespaces.

## Related Product Docs

Related source-of-truth docs are:

- `docs/prd.md`
- `docs/features.ts`
- `docs/progress.md`
- `docs/specs/extension-managing.spec.md`
- `docs/specs/ambient-agent-resources-baseline.spec.md`
- `docs/specs/execute-typescript.spec.md`
- `docs/specs/project-ci.spec.md`
- `docs/specs/workflow-library.spec.md`
