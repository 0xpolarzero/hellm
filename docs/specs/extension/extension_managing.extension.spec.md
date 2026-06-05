# Extension Managing Spec

## Status

- Date: 2026-06-05
- Status: accepted working spec extracted from `docs/specs/extensions-and-tools.spec.md`
- Scope of this document:
  - define the builtin Extension Managing extension surface
  - define which extension source discovery happens through Extension Managing
  - define which extension content changes happen through normal files and `apply_patch`
  - define which extension changes happen through lifecycle/product-state commands
  - define the `svvyx extensions ...` command API

This spec covers the Extension Managing extension only. The broader extension architecture,
extension loading model, actor defaults, `svvyx` dispatcher/runtime model, shell policy,
dependencies, and secrets are defined in `docs/specs/extensions-and-tools.spec.md` and
`docs/specs/extension/svvyx-incur-runtime.spec.md`.

Live rendering for `svvyx extensions ...` commands is defined in
`docs/specs/live-tool-projection.spec.md`. Those commands remain ordinary `exec_command`
invocations; Extension Managing does not gain a separate model-facing tool surface.

## Product Role

Extension Managing is a builtin extension for managing extension definitions and extension usage.

It owns extension lifecycle, source discovery, builds, package dependency approvals, usage-state
commands, snapshot commands, and full-instruction source-file lifecycle commands. It does not own
text-editing commands for instruction or source bodies and does not provide a separate command for
installing CLI requirements. Authoring-facing Incur guidance belongs to this
extension's loaded instructions, but the internal runtime plumbing for making built Incur CLIs
callable belongs to
`docs/specs/extension/svvyx-incur-runtime.spec.md`.

Default usage state:

| Actor kind | State |
| --- | --- |
| Orchestrator | available |
| Handler | available |
| Workflow task agent | unavailable |

It is available rather than default-loaded for ordinary orchestrators and handlers because most
coding work should not receive extension-authoring instructions and commands by default. An agent
can request it when the user asks to inspect, create, edit, build, reset, delete, revert, or
configure extensions. These are defaults, not actor-kind restrictions: an agent profile may be
configured to make Extension Managing `default_loaded`, `available`, or `unavailable`.

## Ownership Boundary

Extension Managing is a registry and lifecycle surface. It is not a text editing API.

File content changes use the normal coding-agent editing path:

1. Run `svvyx extensions inspect <id> --json`.
2. Read the returned file paths with ordinary shell tools.
3. Edit source files, instruction files, manifest files, or the shared extension `package.json` with
   native `apply_patch`.
4. Run `svvyx extensions build <id> --json` after the intended file-edit batch is complete.

`svvy` must not automatically build after ordinary agent `apply_patch` edits. Agents often edit
several extension files in sequence, and building after each patch would be noisy and wasteful.
Instead, app-owned extension file changes mark the extension `buildRequired: true`, the UI shows a
clear Build required indicator, and the Extension Managing instructions tell the agent to run
`build` after it finishes the edit batch.

Product-state changes use Extension Managing commands:

- extension creation
- extension build
- generated instruction regeneration as part of extension build
- full-instruction source file add, remove, rename, and reorder operations
- extension usage state changes
- builtin extension reset
- user-extension delete
- extension change revert
- extension snapshot save/load/rename/delete when exposed to agents

Extension Managing must not introduce custom `patch`, `write`, `set-instructions`, or
content-returning commands. Native `apply_patch` is the patching tool.
Instruction-file lifecycle commands create, remove, rename, or reorder files; they do not carry
instruction body text. Agents edit instruction bodies through `apply_patch`, and the UI may edit
instruction bodies through its direct editor.

UI editor saves are still file-backed source changes. A UI save to an extension instruction,
manifest, source, or editable package file must write the same app-owned source path that
`inspect` returns, record preimage/change data for one reversible change card, set
`draftChanged: true`, set `buildRequired: true` when the saved file affects generated context or
runtime build output, and use the same reset/revert/build pipeline as agent `apply_patch` edits.
The UI must not store editor text as hidden prompt state outside these files.

`inspect` returns relevant resource paths; it does not need an `editable`/`readonly` path taxonomy.
The Extension Managing instructions define what may be edited:

- extension source files
- hand-authored extension instruction files
- extension generated-instruction TypeScript scripts under `scripts/`
- extension manifest files
- the shared extension `package/package.json`

These paths must not be edited by agents:

- generated instruction output files under `instructions/full/`
- `package/bun.lock`
- generated TypeScript declarations
- aggregate cache files
- build output directories
- `node_modules`
- trash
- snapshots
- packaged builtin defaults

`bun.lock` is durable dependency state and may be returned for inspection, but it is never an editing
target. Requested dependency changes are made in extension manifests, extension source inputs, or the
shared extension `package.json`; build/install then validates or regenerates the lockfile.

## Storage Model

Extension content that an agent may inspect or edit should be represented as ordinary files.

The app-owned extension root is:

```text
~/.config/svvy/extensions/
```

Directory layout:

```text
~/.config/svvy/extensions/
  sources/
    user/<extension-id>/
      manifest.json
      instructions/
        full/
          010-overview.md
          020-generated.generated.md
          030-domain-guide.md
        minimal.md
      scripts/
        generate-docs.ts
      source/
    builtin-overlays/<extension-id>/
      manifest.json
      instructions/
        full/
          010-overview.md
          020-generated.generated.md
          030-domain-guide.md
        minimal.md
      scripts/
        generate-docs.ts
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

Workspace-local extensions do not exist in v1. Extension files are app-owned files, not workspace
files. They are still normal filesystem paths so agents can inspect them through shell commands and
edit editable paths through `apply_patch`.

This storage root intentionally does not reuse pi's `~/.pi/agent/extensions/` or project-local
`.pi/extensions/` discovery paths, and it does not reuse Smithers `.smithers/` workflow or hot-reload
directories. Those systems remain runtime references; `svvy` owns extension source, generated
aggregate cache, dependency state, and build output under `~/.config/svvy/extensions/`.

Editable file-backed content includes:

- manifest-like editable metadata
- ordered hand-authored full instruction source files under `instructions/full/`
- generated instruction declarations in `manifest.json` and generated Markdown outputs under
  `instructions/full/`
- editable generated-instruction TypeScript scripts under `scripts/`
- minimal instructions
- extension command source code for `svvyx` extensions
- the shared extension `package/package.json` when dependency state needs manual adjustment

Generated files are returned for inspection and prompt-generation traceability, but they are
read-only from the agent's point of view. They are regenerated by `build`.

### Editable Manifest Schema

Editable extension metadata lives in `manifest.json`.

V1 manifest files must be JSON objects with this minimum schema:

```ts
type ExtensionManifestV1 = {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  interface: "instructions" | "svvyx";
  typescriptApiEnabled?: boolean;
  env?: ExtensionManifestEnv[];
  cliRequirements?: ExtensionManifestCliRequirement[];
  instructionFiles?: ExtensionManifestInstructionFile[];
  generatedInstructions?: ExtensionManifestGeneratedInstruction[];
  dependencies?: Record<string, string>;
  trustedDependencies?: Record<string, string>;
};

type ExtensionManifestEnv = {
  name: string;
  required: boolean;
  secret: boolean;
  description: string;
  default?: string;
};

type ExtensionManifestCliRequirement = {
  id: string;
  binary: string;
  required: boolean;
  version?: string;
  versionCommand?: string;
  installCommand?: string;
};

type ExtensionManifestInstructionFile = {
  file: string;
  bypassed: boolean;
};

type ExtensionManifestGeneratedInstruction = {
  output: string;
  script: string;
  versionCliRequirementId?: string;
};
```

Rules:

- `native_tool` manifests are app-owned builtin implementation records and cannot be created through
  `svvyx extensions create`; builtin native-tool overlays may still expose editable title,
  description, and instructions through app-owned overlay storage.
- `id` must match the extension id used in the registry path and command arguments.
- `interface: "svvyx"` requires editable executable source under `source/`.
- `interface: "instructions"` must not expose editable executable source.
- `typescriptApiEnabled` defaults to `false`.
- `typescriptApiEnabled: true` is valid only with `interface: "svvyx"`; native-tool and
  instruction-only extensions must keep it `false`.
- `dependencies` and `trustedDependencies` use exact package versions only. Ranges, tags, and
  floating versions are build validation errors.
- Env declarations follow the architecture-wide env schema in
  `docs/specs/extensions-and-tools.spec.md`; `default` is allowed only when `secret: false`.
- `cliRequirements` declare shell CLIs required or inspected by the extension. `version` is exact
  when present, and `installCommand` may use `{{version}}` only when `version` is present.
- manifest `installCommand` is a reusable template; inspect and build-error output return a concrete
  install command with the current declared version substituted.
- `instructionFiles` configures individual Markdown files under `instructions/full/`. It does not
  define ordering; ordering remains the lexicographic directory listing. Missing files have
  `bypassed: false`.
- `generatedInstructions` declare build-generated Markdown files under `instructions/full/` and
  editable TypeScript generator scripts under `scripts/`. Build runs generation; there is no separate
  `instructions generate` command.
- Full instruction file ordering is not stored in the manifest in v1. The source of truth is the
  lexicographic directory listing under `instructions/full/`.
- Additional implementation-private manifest fields are allowed only if build preserves them and
  they do not alter the actor-facing contract without being added to this spec.

### Instruction Source Files

An extension's loaded full instruction is assembled from zero or more ordered Markdown source files
under:

```text
instructions/full/*.md
```

This is a source-editing convenience for the Extensions UI and the Extension Managing extension. It
does not mean the model receives an array-valued instruction. The generated actor context receives
one loaded instruction block for the extension, produced by concatenating the ordered full
instruction files with stable file-boundary headings or equivalent internal separators.

Full instruction files are ordered lexicographically by filename. Builtin defaults and generated
user skeletons should use zero-padded numeric prefixes, for example:

```text
010-svvyx-extension-managing.md
020-incur-cli-authoring.md
030-domain-guide.md
```

The ordering rule is deliberately file-system-visible so agents can understand it from `inspect`
output and ordinary shell inspection. Extension Managing may still expose convenience commands and UI
controls for add, remove, rename, and reorder. Reorder may be implemented by renaming files to new
numeric prefixes. Those lifecycle operations mark the extension `buildRequired: true`.

Individual full instruction files may be configured as `bypassed` through `manifest.json` or
equivalent app-owned builtin overlay config. Bypassed files remain in the ordered source set, remain
visible in `inspect`, and are still generated by build when they are generated outputs, but they are
skipped when loaded full instructions are concatenated for actor prompts.

The v1 source of truth for full-instruction ordering is the directory listing, not a manifest field.
Build validation must reject unreadable files under `instructions/full/` that would otherwise be
included, and must warn on non-Markdown files in that directory when they look accidental. Build
validation must reject duplicate `instructionFiles` config entries and config entries that reference
unknown files. If a future manifest adds explicit instruction ordering metadata, missing referenced
files and duplicate logical entries must be build errors, and this spec must be updated before that
metadata becomes authoritative.

Minimal instructions remain a single concise loading-hint file:

```text
instructions/minimal.md
```

Available-but-not-loaded extensions expose only minimal instructions and the minimal instruction
path through `list_extensions`. Full instruction files are exposed through `list_extensions` only
after the extension is loaded, and through `svvyx extensions inspect` when Extension Managing is
loaded.

Database or product-state storage includes:

- extension registry records
- category: `builtin`, `user`, or `external_instruction`
- interface: `native_tool`, `svvyx`, or `instructions`
- current build status and extension context fingerprints as internal activation state, not as a
  user-facing rollback surface
- usage state per agent profile
- instruction-file config such as `bypassed`
- per-session loaded and available extension bindings
- build status
- requirement status
- dependency approval ledger for approved dependency identities and approved trusted dependency
  identities
- pending dependency approval records that can be referenced by app panes and conversation tool cards
- change/revert history
- user-named snapshots

If implementation stores editable data in a database, Extension Managing must still expose a
materialized editable file path for any content an agent is expected to change. Agents should not
have to use a DB-specific write command to edit extension instructions or metadata.

Builtin extensions have packaged defaults plus editable overlays:

- builtin extensions are non-deletable
- builtin extensions are resettable
- builtin defaults live in packaged app resources and are read-only
- builtin title, description, instructions, and optional editable extension source are editable by
  materializing or updating app-owned overlay files under `sources/builtin-overlays/<id>/`
- builtin generated files, native runtime implementation, and app-owned bridge code are read-only and
  cannot be edited through Extension Managing
- `inspect` materializes builtin overlay files before returning editable paths so shell inspection and
  `apply_patch` work normally
- `reset` restores builtin defaults by removing or replacing the overlay for the selected scope

External instruction records are a separate category:

- external instructions use `category: "external_instruction"` and `interface: "instructions"`
- source content lives in external files such as `AGENTS.md` or `CLAUDE.md`
- Extension Managing may inspect their metadata and usage state but must not expose their source
  files as editable extension paths
- reset restores only `svvy` usage/settings or builtin metadata overlays, not the external file
- delete is unavailable

User extensions are ordinary app-owned extension directories:

- user extension source lives under `sources/user/<id>/`
- `source/` exists only for extensions with editable executable source; prompt-only extensions omit
  it or return `source: null` from `inspect`
- user extensions are deletable
- user extensions are not resettable to builtin defaults
- deletion moves the extension into app-managed trash so the delete change can be reverted

Generated extension files live under `generated/extensions/<id>/`. In the normal agent-facing
contract this directory contains generated TypeScript declarations when TypeScript API is enabled;
generated command help is obtained from the loaded `svvyx` namespace itself. Generated agent context
aggregates live in the disposable cache under `generated/aggregates/`. Current build output lives
under `builds/extensions/<id>/current/`; `builds/extensions/<id>/staging/<build-run-id>/` exists only
while a build is running and is atomically promoted over `current/` after a successful build. There
is no preserved build-history directory, no user-facing build rollback, and no build-retention or
pruning policy because only the current build is kept.

Generated agent context aggregates use a real lightweight cache:

- `generated/aggregates/index.sqlite` stores cache metadata.
- each index row stores at minimum `cacheKey`, `actorKind`, ordered `loadedExtensionIds`, ordered
  `availableExtensionIds`, `extensionContextFingerprints`, `agentContextFormatVersion`,
  `externalInstructionsFingerprint`, `agentContextFingerprint`, `createdAt`, `lastUsedAt`, and
  `sizeBytes`
- `generated/aggregates/blobs/<aggregate-cache-key>/` stores the generated prompt, loaded `svvyx`
  command guidance, TypeScript declarations, native tool schemas, and a blob manifest.
- each blob manifest stores the same cache key inputs plus per-file hashes for `prompt.md`,
  `svvyx-guidance.md`, `commands.d.ts`, and `native-tool-schemas.json`
- the cache key is derived from resolved actor-facing inputs: actor kind, loaded extension ids,
  available extension ids, each extension's current extension context fingerprint, agent-context
  format version, and external-instruction fingerprint when external instructions are part of the
  actor prompt
- cache hits must validate the indexed blob exists and matches the blob manifest before use
- cache misses or corrupt blobs regenerate into a temporary directory and atomically promote into
  `blobs/<aggregate-cache-key>/`
- session bindings store only the aggregate cache key and can regenerate the aggregate when the cache
  entry is missing
- aggregate cache deletion is always safe; it must never be treated as deleting product history
- aggregate cache pruning is based only on cache mechanics and must not encode product semantics; the
  v1 default cache budget is 256 MiB total under `generated/aggregates/blobs/`, with entries unused
  for 30 days eligible for eviction, and least-recently-used eviction applied when the byte budget is
  exceeded

Generated paths, aggregate cache paths, build paths, `package/bun.lock`, `node_modules`, trash, and
snapshots are inspectable when useful, but they are not editable source.

Inspectable snapshot paths must not contain raw secret values, agent-readable encrypted secret blobs,
keychain item identifiers, or value-correlating secret metadata. Snapshot commands may report that
secret state was preserved or restored, but only as coarse status.

The single app-global Bun package project lives under `package/`. `package.json` is editable
dependency request state. `bun.lock` is inspectable lock state and is not an editing target.
`node_modules` is install output and is not part of extension snapshots.

`svvy` should not use git to implement extension revert. App-owned extension files may live outside a
repository, and the product only needs local app-history reversibility. `svvy` records structured
change records for lifecycle commands and records patch/preimage data for app-owned extension files
touched by `apply_patch`. Those records are retained indefinitely for now.

## Change History And Revert Contract

Extension revert is intentionally narrow and obvious.

Revert is exposed as a UI button on a reversible change card and as
`svvyx extensions revert <change-id> --json`. The UI may also show the same reversible changes in
extension change history, but app-managed trash does not need a standalone browser or management
surface.

Revertability:

| Change kind | Revert behavior |
| --- | --- |
| Agent `apply_patch` touching app-owned extension files | Revert the whole recorded change, not individual files. |
| `instructions add`, `instructions remove`, `instructions rename`, `instructions reorder` | Restore the previous full instruction file set and filenames recorded by that lifecycle change. |
| `instructions configure` | Restore the previous instruction-file config recorded by that lifecycle change. |
| `set-usage` | Restore the previous usage state for that extension/profile pair. |
| `reset` | Restore the pre-reset files and usage/product state recorded by that reset change. |
| `delete` | Restore the extension directory from app-managed trash and restore its registry state. |
| `create` | No revert affordance; the UI may show Delete for the created extension. |
| `build` | No user-facing rollback or activation command. Build status may be shown as indicators only; the current build is replaced atomically after success. |
| Dependency install | No rollback promise. Reverting source, manifest, or package changes can make dependency identities disappear for future builds, but package caches, Bun lifecycle-script effects, and installed artifacts are not reverted. |
| Secret entry, update, or removal | Not agent-readable and not part of Extension Managing revert. |
| External shell side effects | Not reverted by Extension Managing. |

File-level revert rules:

- `svvy` records one reversible file-change card per successful `apply_patch` call that touches
  app-owned extension files.
- Source edits, instruction edits, and manifest/metadata edits are the same class: app-owned file
  changes.
- Revert is per change card. The UI does not need per-file revert inside a multi-file patch.
- Revert must fail clearly if any target file has changed in a way that prevents exact patch/preimage
  reversal. It must not attempt a fuzzy merge or best-effort repair.
- A failed revert returns the conflicting paths and leaves files unchanged.
- A successful file revert marks the extension `buildRequired: true` before the follow-up build
  attempt.

Build behavior:

- Ordinary agent file edits do not auto-build.
- User/product-triggered source or config changes may auto-build immediately after the action. This
  includes revert, reset when it changes build inputs, and loading a snapshot.
- Auto-builds use the same `build` implementation and dependency approval gate as a normal explicit
  build.
- If an auto-build needs dependency approval, it pauses on a durable dependency approval request.
- App-level auto-build approvals appear as standalone blocking items in the Extensions surface or
  shared app attention pane.
- Auto-build results must be surfaced as normal conversation/tool output when the action occurred
  during an agent-visible conversation, so the active agent can observe the new extension state.
- Dependency approval is checked at install time, not based on whether the change came from
  `apply_patch`, direct user editing, reset, revert, or snapshot restore.
- Build, dependency approval, missing required env, install failure, validation failure, and startup
  rebuild failure are build/readiness states. They happen before any `Update agent context` work is
  queued. They must not create failed `agent_context_refresh` rows.
- Only a successful context-ready generated agent context can enqueue or apply
  `agent_context_refresh`. Runtime readiness blockers such as missing required env values block load
  or invocation, not generated context activation.
- After a successful build changes an extension context fingerprint, affected sessions and workflow
  task-agent attempts receive automatic `agent_context_refresh` work according to
  `docs/specs/extensions-and-tools.spec.md` and `docs/specs/queued-messages.spec.md`.

Conversation-visible UI events:

- When the user clicks a revert button, `svvy` records a visible product event in the owning
  conversation, such as `User reverted extension file change chg_188 for linear.`
- The subsequent build or dependency-confirmation result is shown as a normal tool/product output.
- When a dependency approval is shared between an app pane and a conversation tool card, approving or
  rejecting it in either place updates the other projection of the same durable request.
- Revert must not be hidden as renderer-only state, because the active agent needs to know that the
  extension files and generated agent context may change after the follow-up build succeeds.
- If an agent directly runs `svvyx extensions revert <change-id> --json`, the command result and
  revert-triggered build output are already visible tool output, so no synthetic user-event message is
  needed.

## Command Namespace

Extension Managing commands are available through the loaded extension's CLI namespace:

```bash
svvyx extensions <command> ...
```

This namespace exists only when the Extension Managing extension is loaded. It is separate from the
native `list_extensions` tool:

- `list_extensions` answers what the current actor has loaded or can load.
- `svvyx extensions ...` manages extension definitions and usage.

## Extension Managing Loaded Instruction Files

The builtin Extension Managing extension has two full instruction source files. These files are
ordered by filename under `instructions/full/`:

```text
010-svvyx-extension-managing.md
020-incur-cli-authoring.md
```

The generated loaded instruction for Extension Managing is the concatenation of those files. This
split is an authoring and UI convenience only. The model should not be told that it is receiving an
array of instructions.

### `010-svvyx-extension-managing.md`

This file is `svvy`-owned wrapper guidance. Its canonical content is:

````md
# svvyx Extension Managing

Use Extension Managing when creating, inspecting, editing, building, or configuring svvy extensions.

Normal workflow:

```sh
svvyx extensions inspect <extension-id> --json
```

Read the returned editable paths. Edit extension source, manifest, instruction files, or package.json with `apply_patch`.

After the edit batch is complete:

```sh
svvyx extensions build <extension-id> --json
```

Do not build after every small edit. Build after the intended set of edits is done.

svvyx extension command source is an Incur CLI module.

The module should default-export the CLI:

```ts
export default cli
```

Do not call `cli.serve()` from the extension module. svvy invokes the default-exported CLI through
the stable `svvyx` dispatcher.

Declare app-managed env through Incur env schemas and read it from command or middleware context as
`c.env`.

Do not read app-managed secrets from `process.env.MY_SECRET`. svvy injects env explicitly through
Incur and does not mutate `process.env`.

Missing required env is a runtime readiness issue. Declare env requirements clearly, but do not ask
users to paste secrets into chat.
````

This wrapper file must not include a list of non-existent tools or rejected product concepts. That
negative inventory belongs to product specs, not loaded agent instructions.

### `020-incur-cli-authoring.md`

The instruction content is:

````md
# Incur CLI Authoring

Incur is the TypeScript framework used for `svvyx` extension CLIs. It builds CLIs for agents and
human consumption with strictly typed schemas for arguments and options, structured output envelopes,
token-aware output controls, and agent-readable command documentation.

Use this guidance when creating or editing a `svvyx` extension's Incur CLI.

In `svvyx` extension source, default-export the CLI. Do not call `cli.serve()` in the module. svvy
invokes the default-exported CLI through the stable `svvyx` dispatcher.

Declare app-managed env through Incur env schemas and read it from command or middleware context as
`c.env`. Do not read app-managed secrets from `process.env.MY_SECRET`. svvy injects env explicitly
through Incur and does not mutate `process.env`.

Missing required env is a runtime readiness issue. Declare env requirements clearly, but do not ask
users to paste secrets into chat.

## Quick Start

```ts
import { Cli, z } from "incur";

const cli = Cli.create("greet", {
  description: "A greeting CLI",
  args: z.object({
    name: z.string().describe("Name to greet"),
  }),
  run({ args }) {
    return { message: `hello ${args.name}` };
  },
});

export default cli;
```

```sh
svvyx greet world
# -> message: hello world
```

## Creating A CLI

`Cli.create()` is the entry point. It has two modes.

### Single-command CLI

Pass `run` to create a CLI with no subcommands:

```ts
const cli = Cli.create("tool", {
  description: "Does one thing",
  args: z.object({ file: z.string() }),
  run({ args, options }) {
    return { processed: args.file };
  },
});

export default cli;
```

### Router CLI

Omit `run` to create a CLI that registers subcommands via `.command()`:

```ts
const cli = Cli.create("gh", {
  version: "1.0.0",
  description: "GitHub CLI",
});

cli.command("status", {
  description: "Show repo status",
  run() {
    return { clean: true };
  },
});

export default cli;
```

## Commands

### Registering Commands

```ts
cli.command("install", {
  description: "Install a package",
  args: z.object({
    package: z.string().optional().describe("Package name"),
  }),
  options: z.object({
    saveDev: z.boolean().optional().describe("Save as dev dependency"),
    global: z.boolean().optional().describe("Install globally"),
  }),
  alias: { saveDev: "D", global: "g" },
  output: z.object({
    added: z.number(),
    packages: z.number(),
  }),
  examples: [
    { args: { package: "express" }, description: "Install a package" },
    {
      args: { package: "vitest" },
      options: { saveDev: true },
      description: "Install as dev dependency",
    },
  ],
  run({ args, options }) {
    return { added: 1, packages: 451 };
  },
});
```

`.command()` is chainable:

```ts
cli
  .command("ping", { run: () => ({ pong: true }) })
  .command("version", { run: () => ({ version: "1.0.0" }) });
```

### Subcommand Groups

Create a sub-CLI and mount it as a command group:

```ts
const cli = Cli.create("gh", { description: "GitHub CLI" });

const pr = Cli.create("pr", { description: "Pull request commands" });

pr.command("list", {
  description: "List pull requests",
  options: z.object({
    state: z.enum(["open", "closed", "all"]).default("open"),
  }),
  run({ options }) {
    return { prs: [], state: options.state };
  },
});

pr.command("view", {
  description: "View a pull request",
  args: z.object({ number: z.number() }),
  run({ args }) {
    return { number: args.number, title: "Fix bug" };
  },
});

cli.command(pr);

export default cli;
```

```sh
svvyx gh pr list --state closed
svvyx gh pr view 42
```

Groups nest arbitrarily:

```ts
const cli = Cli.create("gh", { description: "GitHub CLI" });
const pr = Cli.create("pr", { description: "Pull requests" });
const review = Cli.create("review", { description: "Review commands" });

review.command("approve", { run: () => ({ approved: true }) });
pr.command(review);
cli.command(pr);
// -> svvyx gh pr review approve
```

## Arguments & Options

All schemas use Zod. Arguments are positional, assigned by schema key order. Options are named flags.

### Arguments

```ts
args: z.object({
  repo: z.string().describe("Repository in owner/repo format"),
  branch: z.string().optional().describe("Branch name"),
});
```

```sh
svvyx git-tools clone owner/repo main
#                      ^^^^^^^^^^ ^^^^
#                      repo       branch
```

### Options

```ts
options: z.object({
  state: z.enum(["open", "closed"]).default("open").describe("Filter by state"),
  limit: z.number().default(30).describe("Max results"),
  label: z.array(z.string()).optional().describe("Filter by labels"),
  verbose: z.boolean().optional().describe("Show details"),
});
```

Supported parsing:

- `--flag value` and `--flag=value`
- `-f value` short aliases, via `alias`
- `--verbose` boolean flags (`true`), `--no-verbose` (`false`)
- `--label bug --label feature` array options
- automatic type coercion from strings to numbers and booleans
- defaults from `.default()`, optionality from `.optional()`

### Aliases

```ts
alias: { state: "s", limit: "l" };
```

```sh
svvyx tool list -s closed -l 10
```

### Deprecated Options

Mark options as deprecated with `.meta({ deprecated: true })`. Deprecated options show
`[deprecated]` in `--help`, `**Deprecated.**` in skill docs, `deprecated: true` in JSON Schema, and
emit a stderr warning in TTY mode.

```ts
options: z.object({
  zone: z.string().optional().describe("Availability zone").meta({ deprecated: true }),
  region: z.string().optional().describe("Target region"),
});
```

### Environment Variables

Declare env in the CLI and read app-managed values from `c.env`:

```ts
const cli = Cli.create("gh-tools", {
  env: z.object({
    GH_TOKEN: z.string().describe("GitHub token configured in svvy"),
  }),
});

cli.command("status", {
  run(c) {
    return { authenticated: Boolean(c.env.GH_TOKEN) };
  },
});
```

Do not read app-managed secrets from `process.env`.

### Usage Patterns

Define alternative usage patterns to show in `--help` instead of the auto-generated synopsis:

```ts
Cli.create("curl.md", {
  args: z.object({ url: z.string() }),
  options: z.object({ objective: z.string().optional() }),
  usage: [
    { args: { url: true } },
    { args: { url: true }, options: { objective: true } },
    { prefix: "cat file.txt |", suffix: "| head" },
  ],
  run({ args }) {
    return { content: "..." };
  },
});
```

Renders in help as:

```text
Usage: curl.md <url>
       curl.md <url> --objective <objective>
       cat file.txt | curl.md | head
```

Each usage entry supports:

| Property  | Type                         | Description                                      |
| --------- | ---------------------------- | ------------------------------------------------ |
| `args`    | `Partial<Record<key, true>>` | Argument keys to include as `<key>` placeholders |
| `options` | `Partial<Record<key, true>>` | Option keys to include as `--key <key>` flags    |
| `prefix`  | `string`                     | Text prepended before the command, e.g. piping   |
| `suffix`  | `string`                     | Text appended after the command                  |

Both `args` and `options` are strictly typed from the Zod schemas. Usage patterns also work on
subcommands via `.command()`.

## Output Schema

Every command returns data. Incur wraps it in a structured envelope at runtime. Define `output` to
declare the return shape:

```ts
cli.command("info", {
  output: z.object({
    name: z.string(),
    version: z.string(),
  }),
  run() {
    return { name: "express", version: "4.21.2" };
  },
});
```

When `output` is provided, TypeScript enforces that `run()` returns the correct shape.

## Run Context

### `agent` Boolean

The `run` context includes `agent`, which is true when stdout is not a TTY and false when running in
a terminal:

```ts
cli.command("deploy", {
  run(c) {
    if (!c.agent) console.log("Deploying...");
    return { status: "ok" };
  },
});
```

### `ok()` And `error()` Helpers

Use the context helpers for explicit result control:

```ts
run(c) {
  const item = await db.find(c.args.id);
  if (!item) {
    return c.error({
      code: "NOT_FOUND",
      message: `Item ${c.args.id} not found`,
      retryable: false,
    });
  }
  return c.ok(item);
}
```

### CTAs

Suggest next commands to guide agents on success:

```ts
run(c) {
  const result = { id: 42, name: c.args.name };
  return c.ok(result, {
    cta: {
      description: "Suggested commands:",
      commands: [
        { command: "get", args: { id: 42 }, description: "View the item" },
        "list",
      ],
    },
  });
}
```

Or on errors, to help agents self-correct:

```ts
run(c) {
  if (!c.env.GH_TOKEN) {
    return c.error({
      code: "NOT_AUTHENTICATED",
      message: "GitHub token not configured.",
      retryable: true,
      cta: {
        description: "Configure GitHub auth in svvy settings.",
        commands: [
          { command: "status", description: "Check extension readiness" },
        ],
      },
    });
  }
  // ...
}
```

## Examples

### Typed Examples On Commands

```ts
cli.command("deploy", {
  args: z.object({ env: z.enum(["staging", "production"]) }),
  options: z.object({ force: z.boolean().optional() }),
  examples: [
    { args: { env: "staging" }, description: "Deploy to staging" },
    { args: { env: "production" }, options: { force: true }, description: "Force deploy to prod" },
  ],
  run({ args }) {
    return { deployed: args.env };
  },
});
```

Examples appear in `--help` output and generated skill files.

### Hints

```ts
cli.command("publish", {
  hint: "Requires NPM_TOKEN to be configured in svvy.",
  // ...
});
```

Hints are displayed after examples in help output and included in skill files.

### Output Policy

Control whether output data is displayed to humans. `"all"` shows output to everyone.
`"agent-only"` suppresses data in human/TTY mode while still returning it via `--json`, `--format`,
or `--full-output`.

```ts
cli.command("deploy", {
  outputPolicy: "agent-only",
  run() {
    return { id: "deploy-123", url: "https://staging.example.com" };
  },
});
```

Set on a group or root CLI to inherit across children. Children can override.

## Middleware

Register composable before/after hooks with `cli.use()`. Middleware executes in registration order,
onion-style. Each calls `await next()` to proceed.

```ts
const cli = Cli.create("deploy-cli", { description: "Deploy tools" })
  .use(async (c, next) => {
    const start = Date.now();
    await next();
    console.log(`took ${Date.now() - start}ms`);
  })
  .command("deploy", {
    run() {
      return { deployed: true };
    },
  });
```

Middleware on a sub-CLI applies only to its commands. Per-command middleware runs after root and
group middleware, and only for that command.

### Vars: Typed Dependency Injection

Declare a `vars` schema on `create()` to inject typed variables. Middleware sets them with `c.set()`;
handlers read them via `c.var`. Use `.default()` for vars that do not need middleware.

```ts
const cli = Cli.create("my-cli", {
  description: "My CLI",
  vars: z.object({
    user: z.custom<{ id: string; name: string }>(),
    requestId: z.string(),
    debug: z.boolean().default(false),
  }),
});

cli.use(async (c, next) => {
  c.set("user", await authenticate());
  c.set("requestId", crypto.randomUUID());
  await next();
});

cli.command("whoami", {
  run(c) {
    return { user: c.var.user, requestId: c.var.requestId, debug: c.var.debug };
  },
});
```

Middleware does not run for built-in commands such as `--help` and `--llms`.

## Streaming

Use `async *run` to stream chunks incrementally. Yield objects for structured data or plain strings
for text:

```ts
cli.command("logs", {
  description: "Tail logs",
  async *run() {
    yield "connecting...";
    yield "streaming logs";
    yield "done";
  },
});
```

Each yielded value is written as a line in human/TOON mode. With `--format jsonl`, each chunk becomes
`{"type":"chunk","data":"..."}`. You can also yield objects:

```ts
async *run() {
  yield { progress: 50 };
  yield { progress: 100 };
}
```

Use `ok()` or `error()` as the return value to attach CTAs or signal failure:

```ts
async *run({ ok }) {
  yield { step: 1 };
  yield { step: 2 };
  return ok(undefined, { cta: { commands: ["status"] } });
}
```

## Full svvyx Extension Example

```ts
import { Cli, z } from "incur";

const cli = Cli.create("npm", {
  version: "10.9.2",
  description: "The package manager for JavaScript.",
});

cli.command("install", {
  description: "Install a package",
  args: z.object({
    package: z.string().optional().describe("Package name to install"),
  }),
  options: z.object({
    saveDev: z.boolean().optional().describe("Save as dev dependency"),
    global: z.boolean().optional().describe("Install globally"),
  }),
  alias: { saveDev: "D", global: "g" },
  output: z.object({
    added: z.number().describe("Number of packages added"),
    packages: z.number().describe("Total packages"),
  }),
  examples: [
    { args: { package: "express" }, description: "Install a package" },
    {
      args: { package: "vitest" },
      options: { saveDev: true },
      description: "Install as dev dependency",
    },
  ],
  run({ args }) {
    if (!args.package) return { added: 120, packages: 450 };
    return { added: 1, packages: 451 };
  },
});

cli.command("outdated", {
  description: "Check for outdated packages",
  options: z.object({
    global: z.boolean().describe("Check global packages"),
  }),
  alias: { global: "g" },
  output: z.object({
    packages: z.array(
      z.object({
        name: z.string(),
        current: z.string(),
        wanted: z.string(),
        latest: z.string(),
      }),
    ),
  }),
  run() {
    return {
      packages: [{ name: "express", current: "4.18.0", wanted: "4.21.2", latest: "4.21.2" }],
    };
  },
});

export default cli;
```

Always `export default cli` so svvy can import the extension CLI and run it through `svvyx`.
````

## Common Output Rules

Every command should support `--json`.

JSON results use this shape:

```json
{
  "ok": true
}
```

Errors use:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message."
  }
}
```

Command outputs should return paths and state, not full file contents.

Path outputs should be a flat map of relevant resources. They must not imply that every returned path
is editable. Extension Managing instructions and app policy define which paths may be edited.

Env requirement output must use the architecture-wide redacted status model from
`docs/specs/extensions-and-tools.spec.md`. Agent-facing command output may show env name, required
flag, secret flag, description, and status. It must not show env values, value previews, masked
values, hashes, fingerprints, keychain ids, storage paths, created timestamps, updated timestamps, or
last-used timestamps.

Build and inspect output may show coarse current-context and last-build status. It must not expose
internal fingerprints, internal content hashes, build timestamps, install timestamps, generated
aggregate cache keys, or aggregate cache paths as part of ordinary agent-facing JSON. Internal
activation state may still store fingerprints, hashes, and timestamps for cache validation,
agent-context drift detection, and diagnostics.

`inspect` is a loaded Extension Managing command, so it may show global agent/profile `usage` state
for the inspected extension. That is different from native `list_extensions`, which is ordinary
actor-local capability discovery and must omit unavailable extension details entirely.

`inspect` and `list_extensions` must not expose ordinary agent-facing `commandDocs` or `toolSchemas`
paths. For loaded `svvyx` extensions, command documentation is discovered through
`svvyx <extension-id> --llms`, `svvyx <extension-id> --llms-full`, command `--help`, and command
`--schema`. If implementation keeps internal generated docs or schema files for prompt assembly,
validation, UI traceability, or cache mechanics, those paths are not part of the normal JSON
contract.

Common lifecycle error codes:

| Code | Meaning |
| --- | --- |
| `INSTRUCTIONS_NOT_EDITABLE` | The target extension has no editable app-owned instruction storage for the requested instruction-file lifecycle command. |
| `EXTERNAL_INSTRUCTION_READONLY` | The target is an `external_instruction` record whose source file is outside Extension Managing ownership. |
| `INVALID_INSTRUCTION_FILENAME` | A requested instruction basename is not an accepted Markdown basename under `instructions/full/`. |
| `INSTRUCTION_FILE_EXISTS` | A requested target basename already exists. |
| `INSTRUCTION_FILE_NOT_FOUND` | A requested source basename is not a current full instruction file. |
| `INVALID_INSTRUCTION_CONFIG` | A requested instruction-file config value is not valid for the setting being changed. |
| `INVALID_INSTRUCTION_ORDER` | A reorder request omitted, duplicated, or named an unknown full instruction file. |
| `INSTRUCTION_RENAME_COLLISION` | A lifecycle command cannot complete without a case-sensitive or case-insensitive filename collision. |

## `inspect`

Use case: understand an extension and find the files to inspect or edit.

```bash
svvyx extensions inspect <id> --json
```

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `<id>` | yes | Stable extension id. |
| `--json` | no | Return machine-readable JSON. |

JSON shape:

```ts
type InspectExtensionResult = {
  ok: true;
  extension: InspectExtension;
};

type InspectExtension = {
  id: string;
  category: "builtin" | "user" | "external_instruction";
  interface: "native_tool" | "svvyx" | "instructions";
  title: string;
  description: string;
  resettable: boolean;
  deletable: boolean;
  typescriptApiEnabled: boolean;
  paths: InspectExtensionPaths;
  usage: ExtensionUsageState[];
  requirements: InspectExtensionRequirements;
  state: InspectExtensionState;
};

type InspectExtensionPaths = {
  sourceRoot: string | null;
  manifest: string | null;
  instructionsFull: InspectInstructionFile[];
  instructionsFullDir: string | null;
  instructionsMinimal: string | null;
  externalInstructionFile: string | null;
  extensionSource: string | null;
  packageJson: string | null;
  lockfile: string | null;
  generatedRoot: string | null;
  typescriptTypes: string | null;
  buildCurrent: string | null;
};

type InspectInstructionFile = {
  name: string;
  path: string;
  bypassed: boolean;
  generated?: {
    script: string;
    output: string;
  };
};

type ExtensionUsageState = {
  actorKind: "orchestrator" | "handler" | "workflow-task";
  agentProfile: string;
  state: "default_loaded" | "available" | "unavailable";
  configurable: boolean;
  fixedReason?: "app_native_control";
};

type InspectExtensionRequirements = {
  cliRequirements: CliRequirementStatus[];
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

type CliRequirementStatus = {
  id: string;
  binary: string;
  required: boolean;
  version: string | null;
  status: "available" | "missing" | "wrong_version" | "unknown";
  detectedVersion: string | null;
  path: string | null;
  versionCommand: string | null;
  installCommand: string | null;
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

type InspectExtensionState = {
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
    | "CLI_MISSING"
    | "CLI_WRONG_VERSION"
    | "CLI_STATUS_UNKNOWN"
    | "EXTERNAL_CLI_AUTH_MISSING"
    | "EXTERNAL_CLI_AUTH_INSUFFICIENT"
    | "EXTERNAL_CLI_AUTH_UNKNOWN";
  message: string;
};
```

`CliRequirementStatus.installCommand` is directly runnable through `exec_command` when non-null. The
manifest stores the reusable template; inspect and build-error output resolve `{{version}}` before
returning the status object.

`usage` is the global agent/profile usage configuration for the inspected extension. It is useful in
Extension Managing because the command is a management surface. Native `list_extensions` must not
return `usage`; it returns only the current actor's `state.binding`.

Inspect uses the same requirement-readiness semantics as native `list_extensions`.
`requirements.cliRequirements[].status` is limited to `"available"`, `"missing"`,
`"wrong_version"`, or `"unknown"`. It reports shell binary presence and exact version matching only.
It must not encode CLI account authentication, OAuth state, token scopes, remote service
reachability, timestamps, account names, usernames, or host credentials. Known CLI auth blockers,
such as missing or insufficient GitHub CLI auth for `gh`, are represented only by coarse
`state.ready: false` plus `state.issues` codes when the app already knows them. Extension Managing
must not add a separate `externalAuth` or `authStatus` field, run login flows, mutate credentials,
contact remotes only to improve status labels, or watch arbitrary failed agent shell commands to
update inspect readiness.

For prompt-only Git and GitHub, unknown `git`, `gh`, or `gh` auth status is advisory and must not
block inspect readiness or generated prompt loading. Known status can be displayed through
`requirements.cliRequirements` and `state.issues`, but the GitHub prompt still tells agents to offer
auth guidance only after an actual `gh` command fails.

Prompt-only builtin example:

```json
{
  "ok": true,
  "extension": {
    "id": "github",
    "category": "builtin",
    "interface": "instructions",
    "title": "GitHub",
    "description": "Conservative GitHub CLI guidance for issues, pull requests, review comments, Actions checks, publishing, and PR wrap-up.",
    "resettable": true,
    "deletable": false,
    "typescriptApiEnabled": false,
    "paths": {
      "sourceRoot": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/github",
      "manifest": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/github/manifest.json",
      "instructionsFull": [
        {
          "name": "010-github.md",
          "path": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/github/instructions/full/010-github.md",
          "bypassed": false
        }
      ],
      "instructionsFullDir": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/github/instructions/full",
      "instructionsMinimal": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/github/instructions/minimal.md",
      "externalInstructionFile": null,
      "extensionSource": null,
      "packageJson": "/Users/example/.config/svvy/extensions/package/package.json",
      "lockfile": "/Users/example/.config/svvy/extensions/package/bun.lock",
      "generatedRoot": null,
      "typescriptTypes": null,
      "buildCurrent": "/Users/example/.config/svvy/extensions/builds/extensions/github/current"
    },
    "usage": [
      {
        "agentProfile": "default-orchestrator",
        "actorKind": "orchestrator",
        "state": "default_loaded",
        "configurable": true
      },
      {
        "agentProfile": "threadHandler",
        "actorKind": "handler",
        "state": "default_loaded",
        "configurable": true
      },
      {
        "agentProfile": "reviewer",
        "actorKind": "workflow-task",
        "state": "available",
        "configurable": true
      }
    ],
    "requirements": {
      "cliRequirements": [
        {
          "id": "git",
          "binary": "git",
          "required": true,
          "version": null,
          "status": "available",
          "detectedVersion": "2.54.0",
          "path": "/usr/bin/git",
          "versionCommand": "git --version",
          "installCommand": null
        },
        {
          "id": "gh",
          "binary": "gh",
          "required": true,
          "version": null,
          "status": "available",
          "detectedVersion": "2.93.0",
          "path": "/opt/homebrew/bin/gh",
          "versionCommand": "gh --version",
          "installCommand": null
        }
      ],
      "env": [],
      "dependencies": [],
      "trustedDependencies": []
    },
    "state": {
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

Incur-backed user example:

```json
{
  "ok": true,
  "extension": {
    "id": "linear",
    "category": "user",
    "interface": "svvyx",
    "title": "Linear",
    "description": "Linear issue and project workflow support.",
    "resettable": false,
    "deletable": true,
    "typescriptApiEnabled": true,
    "paths": {
      "sourceRoot": "/Users/example/.config/svvy/extensions/sources/user/linear",
      "manifest": "/Users/example/.config/svvy/extensions/sources/user/linear/manifest.json",
      "instructionsFull": [
        {
          "name": "010-linear.md",
          "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/010-linear.md",
          "bypassed": false
        }
      ],
      "instructionsFullDir": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full",
      "instructionsMinimal": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/minimal.md",
      "externalInstructionFile": null,
      "extensionSource": "/Users/example/.config/svvy/extensions/sources/user/linear/source",
      "packageJson": "/Users/example/.config/svvy/extensions/package/package.json",
      "lockfile": "/Users/example/.config/svvy/extensions/package/bun.lock",
      "generatedRoot": "/Users/example/.config/svvy/extensions/generated/extensions/linear",
      "typescriptTypes": "/Users/example/.config/svvy/extensions/generated/extensions/linear/types.d.ts",
      "buildCurrent": "/Users/example/.config/svvy/extensions/builds/extensions/linear/current"
    },
    "usage": [
      {
        "agentProfile": "default-orchestrator",
        "actorKind": "orchestrator",
        "state": "unavailable",
        "configurable": true
      },
      {
        "agentProfile": "threadHandler",
        "actorKind": "handler",
        "state": "default_loaded",
        "configurable": true
      },
      {
        "agentProfile": "reviewer",
        "actorKind": "workflow-task",
        "state": "unavailable",
        "configurable": true
      }
    ],
    "requirements": {
      "cliRequirements": [],
      "env": [
        {
          "name": "SMITHERS_API_KEY",
          "required": true,
          "secret": true,
          "description": "Smithers API key used by hosted workflow commands.",
          "status": "missing"
        },
        {
          "name": "SMITHERS_API_BASE_URL",
          "required": false,
          "secret": false,
          "description": "Smithers API base URL.",
          "status": "defaulted"
        }
      ],
      "dependencies": [
        {
          "kind": "dependency",
          "name": "@smithers/sdk",
          "version": "1.2.3",
          "packageManager": "bun",
          "source": "npm",
          "approval": "approved",
          "install": "installed"
        }
      ],
      "trustedDependencies": []
    },
    "state": {
      "draftChanged": true,
      "buildRequired": true,
      "currentBuild": {
        "status": "ready"
      },
      "lastBuild": {
        "status": "success"
      },
      "ready": false,
      "issues": [
        {
          "code": "EXTENSION_ENV_MISSING",
          "message": "Smithers requires SMITHERS_API_KEY. Configure it in the Extensions pane."
        },
        {
          "code": "BUILD_REQUIRED",
          "message": "Smithers has source changes that must be built before a replacement context can activate."
        }
      ]
    }
  }
}
```

## `create`

Use case: create a new user extension skeleton with editable files.

```bash
svvyx extensions create \
  --id linear \
  --title "Linear" \
  --description "Linear issue and project workflow support." \
  --interface svvyx \
  --typescript-api true \
  --json
```

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `--id` | yes | Stable extension id. |
| `--title` | yes | User-facing title. |
| `--description` | yes | Short user-facing description. |
| `--interface` | yes | `instructions` or `svvyx`. `native_tool` is reserved for app-owned builtin extensions and cannot be created through Extension Managing. |
| `--typescript-api` | no | Boolean. Defaults to `false`. |
| `--json` | no | Return machine-readable JSON. |

`--id` must satisfy the architecture-wide extension id rules in
`docs/specs/extensions-and-tools.spec.md`. It must not collide with a builtin extension, existing
user extension, external instruction record, deleted extension still in trash, pending snapshot
restore target, native control namespace, or other reserved `svvyx` namespace.

`create` must create:

- `manifest.json`
- `instructions/full/010-<extension-id>.md`
- `instructions/minimal.md`
- `source/` only when `--interface svvyx`

The generated full instruction file may be empty or contain only a short neutral Markdown heading. It
must not invent domain-specific guidance or placeholder prose. The generated `svvyx` source skeleton
must default-export an Incur CLI and must not call `cli.serve()` at top level.

Example output:

```json
{
  "ok": true,
  "extension": {
    "id": "linear",
    "category": "user",
    "interface": "svvyx",
    "title": "Linear",
    "description": "Linear issue and project workflow support.",
    "resettable": false,
    "deletable": true,
    "typescriptApiEnabled": true,
    "paths": {
      "sourceRoot": "/Users/example/.config/svvy/extensions/sources/user/linear",
      "manifest": "/Users/example/.config/svvy/extensions/sources/user/linear/manifest.json",
      "instructionsFull": [
        {
          "name": "010-linear.md",
          "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/010-linear.md",
          "bypassed": false
        }
      ],
      "instructionsFullDir": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full",
      "instructionsMinimal": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/minimal.md",
      "externalInstructionFile": null,
      "extensionSource": "/Users/example/.config/svvy/extensions/sources/user/linear/source",
      "packageJson": "/Users/example/.config/svvy/extensions/package/package.json",
      "lockfile": "/Users/example/.config/svvy/extensions/package/bun.lock",
      "generatedRoot": "/Users/example/.config/svvy/extensions/generated/extensions/linear",
      "typescriptTypes": null,
      "buildCurrent": "/Users/example/.config/svvy/extensions/builds/extensions/linear/current"
    },
    "usage": [
      {
        "agentProfile": "default-orchestrator",
        "actorKind": "orchestrator",
        "state": "available",
        "configurable": true
      },
      {
        "agentProfile": "threadHandler",
        "actorKind": "handler",
        "state": "available",
        "configurable": true
      },
      {
        "agentProfile": "reviewer",
        "actorKind": "workflow-task",
        "state": "unavailable",
        "configurable": true
      }
    ],
    "state": {
      "draftChanged": true,
      "buildRequired": true,
      "currentBuild": null,
      "ready": false,
      "issues": [
        {
          "code": "NO_CURRENT_BUILD",
          "message": "Linear has not been built yet."
        },
        {
          "code": "BUILD_REQUIRED",
          "message": "Linear must be built before it can be loaded."
        }
      ]
    }
  },
  "next": [
    "Edit source, instructions, manifest, or package.json with apply_patch.",
    "Run `svvyx extensions build linear --json`."
  ]
}
```

## Full Instruction File Lifecycle Commands

Use case: add, remove, rename, reorder, or configure source files under `instructions/full/` without
inventing a text-editing API.

These commands operate only on full loaded instruction source files and their file-level config. They
do not edit file body content. After creating or renaming a file, agents edit the returned path with
native `apply_patch`.

All file names are relative basenames under the extension's `instructions/full/` directory.
Accepted names must:

- end in `.md`
- not contain `/`, `\`, `..`, a NUL byte, or platform-reserved path syntax
- not contain `,`
- not collide with an existing full instruction file unless the command explicitly replaces by
  remove then add in separate changes

Applicability:

- user extensions may use these commands when they have app-owned instruction storage
- builtin extensions may use these commands only through app-owned overlay materialization under
  `sources/builtin-overlays/<id>/`
- builtin packaged defaults must never be mutated directly
- removing or renaming a builtin default instruction file records an overlay tombstone or equivalent
  overlay metadata so reset can restore the packaged file set
- prompt-only, `svvyx`, and native-tool builtin extensions may all use these commands if they have
  editable app-owned instruction overlays
- `external_instruction` records must reject these commands because their source files are external
  and read-only from Extension Managing
- any extension record without editable app-owned instruction storage must reject these commands with
  `INSTRUCTIONS_NOT_EDITABLE`

All successful lifecycle commands that change source files or instruction-file config:

- record a reversible file-level Extension Managing change
- set `draftChanged: true`
- set `buildRequired: true`
- leave the current successful build active until the next successful `build`
- return the updated ordered `instructionsFull` array and `instructionsFullDir`

Instruction-file config currently contains one setting: `bypassed`. A bypassed file remains present
under `instructions/full/`, appears in `inspect`, may be generated by build, and may be read by an
agent, but it is skipped when `svvy` concatenates loaded full instructions for actor prompts.
Bypassing a file is not the same as removing it and is not the same as setting the whole extension to
`available` or `unavailable`.

### `instructions add`

```bash
svvyx extensions instructions add <id> --name 020-domain-guide.md --json
```

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `<id>` | yes | Stable extension id. |
| `--name` | yes | New Markdown basename under `instructions/full/`. |
| `--json` | no | Return machine-readable JSON. |

Result:

```json
{
  "ok": true,
  "changeId": "chg_220",
  "extensionId": "linear",
  "created": {
    "name": "020-domain-guide.md",
    "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/020-domain-guide.md"
  },
  "instructionsFullDir": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full",
  "instructionsFull": [
    {
      "name": "010-linear.md",
      "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/010-linear.md",
      "bypassed": false
    },
    {
      "name": "020-domain-guide.md",
      "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/020-domain-guide.md",
      "bypassed": false
    }
  ],
  "buildRequired": true
}
```

The created file should contain a minimal Markdown heading or be empty. It must not contain generated
placeholder instruction prose that could accidentally be loaded as product guidance.

### `instructions rename`

```bash
svvyx extensions instructions rename <id> --from 020-domain-guide.md --to 030-domain-guide.md --json
```

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `<id>` | yes | Stable extension id. |
| `--from` | yes | Existing Markdown basename under `instructions/full/`. |
| `--to` | yes | New Markdown basename under `instructions/full/`. |
| `--json` | no | Return machine-readable JSON. |

Result:

```json
{
  "ok": true,
  "changeId": "chg_221",
  "extensionId": "linear",
  "renamed": {
    "from": "020-domain-guide.md",
    "to": "030-domain-guide.md",
    "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/030-domain-guide.md"
  },
  "instructionsFullDir": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full",
  "instructionsFull": [
    {
      "name": "010-linear.md",
      "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/010-linear.md",
      "bypassed": false
    },
    {
      "name": "030-domain-guide.md",
      "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/030-domain-guide.md",
      "bypassed": false
    }
  ],
  "buildRequired": true
}
```

### `instructions remove`

```bash
svvyx extensions instructions remove <id> --name 030-domain-guide.md --json
```

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `<id>` | yes | Stable extension id. |
| `--name` | yes | Existing Markdown basename under `instructions/full/`. |
| `--json` | no | Return machine-readable JSON. |

Result:

```json
{
  "ok": true,
  "changeId": "chg_222",
  "extensionId": "linear",
  "removed": {
    "name": "030-domain-guide.md",
    "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/030-domain-guide.md"
  },
  "instructionsFullDir": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full",
  "instructionsFull": [
    {
      "name": "010-linear.md",
      "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/010-linear.md",
      "bypassed": false
    }
  ],
  "buildRequired": true
}
```

Removing the last full instruction file, or configuring every full instruction file as bypassed, is
allowed only if the extension genuinely has no loaded instruction prose. The build still validates
that a loaded extension with no effective full instruction files has either native tools, `svvyx`
command guidance, or an intentionally empty full-instruction set.

### `instructions reorder`

```bash
svvyx extensions instructions reorder <id> \
  --file 010-linear.md \
  --file 030-client.md \
  --file 020-domain-guide.md \
  --json
```

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `<id>` | yes | Stable extension id. |
| `--file` | yes | Repeat once for every current full instruction basename, in desired order. |
| `--json` | no | Return machine-readable JSON. |

Result:

```json
{
  "ok": true,
  "changeId": "chg_223",
  "extensionId": "linear",
  "renamed": [
    {
      "from": "030-client.md",
      "to": "020-client.md"
    },
    {
      "from": "020-domain-guide.md",
      "to": "030-domain-guide.md"
    }
  ],
  "instructionsFullDir": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full",
  "instructionsFull": [
    {
      "name": "010-linear.md",
      "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/010-linear.md",
      "bypassed": false
    },
    {
      "name": "020-client.md",
      "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/020-client.md",
      "bypassed": false
    },
    {
      "name": "030-domain-guide.md",
      "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/030-domain-guide.md",
      "bypassed": false
    }
  ],
  "buildRequired": true
}
```

`reorder` implements ordering by renaming numeric prefixes. It must preserve each file's content.
The target name is deterministic:

1. Assign prefixes `010`, `020`, `030`, and so on in the requested order.
2. For each source basename, remove one existing leading numeric prefix matching
   `/^[0-9]+-/` if present.
3. Write the target basename as `<new-prefix>-<remaining-basename>`.

For example, `030-client.md` in the second position becomes `020-client.md`, and
`domain-guide.md` in the third position becomes `030-domain-guide.md`.

Rename safety:

- prefix width is exactly three digits in v1
- prefix step is exactly ten in v1
- case-insensitive collisions must be detected before any rename, because the app must behave safely
  on case-insensitive filesystems
- the implementation must use an atomic two-phase rename plan through temporary names inside the same
  `instructions/full/` directory
- if any temporary or final target would collide, the command fails before changing files
- the command must reject orders that omit a current file, mention an unknown file, mention a file
  more than once, or cannot be represented by the deterministic renaming algorithm above

### `instructions configure`

```bash
svvyx extensions instructions configure <id> \
  --file 040-smithers-memory.generated.md \
  --bypassed false \
  --json
```

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `<id>` | yes | Stable extension id. |
| `--file` | yes | Existing Markdown basename under `instructions/full/`. |
| `--bypassed` | yes | Exact boolean string `true` or `false`. |
| `--json` | no | Return machine-readable JSON. |

Result when the value changes:

```json
{
  "ok": true,
  "changed": true,
  "changeId": "chg_224",
  "extensionId": "smithers",
  "configured": {
    "file": "040-smithers-memory.generated.md",
    "before": {
      "bypassed": true
    },
    "after": {
      "bypassed": false
    }
  },
  "instructionsFullDir": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/smithers/instructions/full",
  "instructionsFull": [
    {
      "name": "010-smithers-core.generated.md",
      "path": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/smithers/instructions/full/010-smithers-core.generated.md",
      "bypassed": false
    },
    {
      "name": "040-smithers-memory.generated.md",
      "path": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/smithers/instructions/full/040-smithers-memory.generated.md",
      "bypassed": false
    }
  ],
  "buildRequired": true
}
```

Result when the value is already set:

```json
{
  "ok": true,
  "changed": false,
  "extensionId": "smithers",
  "configured": {
    "file": "040-smithers-memory.generated.md",
    "before": {
      "bypassed": false
    },
    "after": {
      "bypassed": false
    }
  },
  "buildRequired": false
}
```

Rules:

- `configure` must not edit file content, rename files, generate files, or run build.
- `configure` must reject unknown files with `INSTRUCTION_FILE_NOT_FOUND`.
- `configure` must reject non-boolean `--bypassed` values with `INVALID_INSTRUCTION_CONFIG`.
- for builtin extensions, `configure` writes app-owned overlay metadata and never mutates packaged
  defaults directly
- for user extensions, `configure` writes the extension's editable `manifest.json` or equivalent
  app-owned config file
- if the requested value equals the current value, the command is idempotent: it returns
  `changed: false`, records no reversible change, leaves `buildRequired` unchanged, and does not queue
  follow-up work
- if the value changes, the command records a reversible change, sets `draftChanged: true`, sets
  `buildRequired: true`, and leaves existing generated contexts active until the next successful
  `build`
- after the next successful build, changed bypass state affects generated-context fingerprints and
  queues affected sessions for safe-boundary `agent_context_refresh`

## `build`

Use case: validate files, regenerate derived extension context, and activate the new successful build.

```bash
svvyx extensions build <id> --json
```

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `<id>` | yes | Stable extension id. |
| `--json` | no | Return machine-readable JSON. |

Successful builds always activate the new generated extension context for future extension
resolution. There is no separate user-facing activation command and no user-facing build rollback
command. A build writes to `builds/extensions/<id>/staging/<build-run-id>/` while it is running;
after validation succeeds, `svvy` atomically replaces `builds/extensions/<id>/current/` with that
staged output. Failed or blocked builds must not replace `current/`.

Build results split context readiness from runtime readiness:

- `contextReady` means the extension source, instructions, manifest, generated docs, command
  manifest, and generated TypeScript declaration inputs are valid enough to become the current
  generated extension context and affect extension context fingerprints.
- `runtimeReady` means all runtime prerequisites for loading or invoking the extension are satisfied,
  including required app-managed env values and required installed dependencies or external binaries.
- A successful build with `contextReady: true` and `runtimeReady: false` still activates the new
  generated context and may enqueue `agent_context_refresh` for affected bindings. The affected
  actor may see updated instructions, declarations, and readiness issues, but runtime invocation or
  `load_extension` still fails until the runtime blocker is resolved.

Env values are not build inputs. A build validates env declarations and reports readiness, but it
must not fail only because a required env value is missing. Missing required env blocks extension
load or invocation through runtime command paths, not source validation or generated context
activation.

Prompt-only success example:

```json
{
  "ok": true,
  "extensionId": "github",
  "build": {
    "status": "success",
    "interface": "instructions",
    "activated": true,
    "contextReady": true,
    "runtimeReady": true,
    "currentPath": "/Users/example/.config/svvy/extensions/builds/extensions/github/current"
  },
  "requirements": {
    "env": []
  },
  "contextReady": true,
  "runtimeReady": true,
  "issues": [],
  "generated": {
    "typescriptTypes": null
  }
}
```

Incur-backed success example:

```json
{
  "ok": true,
  "extensionId": "linear",
  "build": {
    "status": "success",
    "interface": "svvyx",
    "activated": true,
    "contextReady": true,
    "runtimeReady": false,
    "currentPath": "/Users/example/.config/svvy/extensions/builds/extensions/linear/current"
  },
  "requirements": {
    "env": [
      {
        "name": "LINEAR_API_KEY",
        "required": true,
        "secret": true,
        "description": "Linear API key used by Linear commands.",
        "status": "missing"
      },
      {
        "name": "LINEAR_API_BASE_URL",
        "required": false,
        "secret": false,
        "description": "Linear API base URL.",
        "status": "defaulted"
      }
    ]
  },
  "contextReady": true,
  "runtimeReady": false,
  "issues": [
    {
      "code": "EXTENSION_ENV_MISSING",
      "message": "Linear requires LINEAR_API_KEY. Configure it in the Extensions pane."
    }
  ],
  "commands": [
    {
      "name": "issues.list",
      "summary": "List Linear issues matching filters."
    },
    {
      "name": "issues.update",
      "summary": "Update a Linear issue."
    }
  ],
  "generated": {
    "typescriptTypes": "/Users/example/.config/svvy/extensions/generated/extensions/linear/types.d.ts"
  }
}
```

CLI requirement failures:

`svvyx extensions build <id> --json` checks required CLI requirements before package dependency
installation and before generated instruction scripts run. If a required CLI is missing or has the
wrong exact version, or if required CLI status cannot be determined, build fails with an ordinary
JSON error. It must not create a dependency approval request, must not run the declared install
command, and must not leave a blocked build that can resume automatically. The agent or user can run
the returned install command through
`exec_command` and then rerun build.

Missing CLI example:

```json
{
  "ok": false,
  "error": {
    "code": "CLI_MISSING",
    "message": "tinyfish 0.1.6 is required by web but was not found on PATH.",
    "extensionId": "web",
    "cli": {
      "id": "tinyfish",
      "binary": "tinyfish",
      "required": true,
      "version": "0.1.6",
      "detectedVersion": null,
      "path": null,
      "versionCommand": "tinyfish --version",
      "installCommand": "npm install -g @tiny-fish/cli@0.1.6"
    },
    "nextSteps": [
      "Run the install command through exec_command if the user wants this CLI installed.",
      "Rerun `svvyx extensions build web --json` after installation."
    ]
  }
}
```

Wrong-version CLI example:

```json
{
  "ok": false,
  "error": {
    "code": "CLI_WRONG_VERSION",
    "message": "tinyfish 0.1.6 is required by web, but tinyfish 0.1.5 was found.",
    "extensionId": "web",
    "cli": {
      "id": "tinyfish",
      "binary": "tinyfish",
      "required": true,
      "version": "0.1.6",
      "detectedVersion": "0.1.5",
      "path": "/usr/local/bin/tinyfish",
      "versionCommand": "tinyfish --version",
      "installCommand": "npm install -g @tiny-fish/cli@0.1.6"
    },
    "nextSteps": [
      "Run the install command through exec_command if the user wants to replace or upgrade this CLI.",
      "Rerun `svvyx extensions build web --json` after installation."
    ]
  }
}
```

Dependency confirmation example:

```json
{
  "ok": false,
  "status": "needs_user_confirmation",
  "approvalRequestId": "depapr_42",
  "extensionId": "linear",
  "blockedOperation": "build",
  "packageProject": "/Users/example/.config/svvy/extensions/package",
  "items": [
    {
      "kind": "dependency",
      "name": "@linear/sdk",
      "version": "12.4.0",
      "packageManager": "bun",
      "source": "npm",
      "integrity": "sha512-..."
    },
    {
      "kind": "trusted_dependency",
      "name": "esbuild",
      "version": "0.25.4",
      "packageManager": "bun",
      "source": "npm",
      "integrity": "sha512-..."
    }
  ],
  "message": "Installing these dependency identities requires user approval."
}
```

Failed builds must leave the current successful build untouched. The failed staging directory is
discarded unless retained only long enough to surface diagnostics for that build attempt; it is not a
preserved build artifact or rollback target.

Failed installs must leave the current successful build untouched. `package.json` remains as the
user's or agent's requested dependency state. `bun.lock` may have changed only if Bun reached the
lockfile write step before failure; after any failed, interrupted, or externally modified install,
the next startup, refresh, or build must validate `package.json`, `bun.lock`, installed artifacts,
and the approval ledger before using that dependency state. A stale or inconsistent lockfile is a
validation problem to report, not a reason to use best-effort dependency state.

When a build succeeds, `buildRequired` becomes `false`. When the build is blocked by dependency
approval, fails validation, or fails during install/build, `buildRequired` remains `true` and the UI
continues to show Build required.

Dependency identity and approval rules:

- approval is checked only at the install boundary
- every dependency approval is for a concrete dependency identity, never for a package name alone
- an npm dependency identity is keyed by `kind: "dependency"`, package manager, source, package name,
  exact version, and integrity or resolution metadata when available
- a trusted lifecycle-script approval is keyed by `kind: "trusted_dependency"`, package manager,
  source, package name, exact version, and integrity or resolution metadata when available
- dependency specs must be exact before install or build can proceed
- non-exact specs such as ranges, tags, `latest`, `^12.4.0`, or `~12.4.0` fail validation with a
  clear error; `svvy` must not resolve them to latest, rewrite them automatically, install them, or
  build with them
- dependencies that have already been approved at the exact dependency identity do not require
  repeated approval
- trusted dependencies that have already been approved at the exact trusted dependency identity do
  not require repeated approval
- new versions, changed sources, changed package manager identity, or changed integrity/resolution
  metadata require approval before install proceeds
- dependency install proceeds without prompting only when every dependency identity and trusted
  dependency identity that would be installed or trusted has already been approved
- direct user edits, agent edits, reset, revert, delete restore, and snapshot restore all use the
  same build/install approval pipeline
- failed install or build leaves `builds/extensions/<id>/current/` untouched
- extension installs must not rely on Bun's default trusted npm allowlist as product policy
- dependency lifecycle scripts are disabled unless the exact `trusted_dependency` identity has been
  approved in `svvy`
- changes to `trustedDependencies` in `package.json` are dependency state and must be surfaced in the
  same dependency approval diff as added, removed, or changed trusted dependency identities
- Bun's `trustedDependencies` package field is name-based, but `svvy` approval is not; `svvy` must
  resolve each trusted package name to the exact trusted dependency identity before scripts can run
- root `package.json` lifecycle scripts are not an extension build mechanism; extension builds are
  driven by `svvyx extensions build`, not by package lifecycle hooks
- non-npm dependency sources such as `file:`, `link:`, `git:`, and `github:` must resolve to a
  concrete source identity before install; lifecycle-script trust for those sources still requires
  explicit trusted dependency approval before scripts can run
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

Dependency approval UI:

- if startup, refresh, snapshot load, or another app-level operation needs dependency approval before
  a conversation owns the build, the pending approval appears as a standalone blocking item in the
  Extensions surface or shared app attention pane
- if an agent-visible command such as `svvyx extensions build <id> --json` needs dependency approval,
  the command result appears as a tool card requiring approval in that conversation
- both UI placements point at the same durable approval request when they are blocked on the same
  unresolved dependency identities
- approving a request records the listed dependency and trusted dependency identities in the approval
  ledger and updates every pane, conversation tool card, and blocked operation that references that
  request
- approval resumes blocked app-level build work and any still-pending conversation tool card whose
  blocked operation is an install/build for the same approval request; it does not create a new actor
  binding or expose new generated extension guidance to a session
- rejecting a request marks that pending request rejected, updates every referencing pane and
  conversation tool card, leaves `buildRequired: true`, and leaves the current build unchanged
- rejection does not create a permanent deny rule; a later explicit build or refresh may create a new
  approval request if the same unapproved identities are still required
- unanswered approval requests remain pending and visible until approved, rejected, or made obsolete
  by later source/package changes that no longer require the same identities

Dependency approval is not the Codex-like shell approval path. It is a product-state approval ledger
for exact dependency and trusted dependency identities. It must not be sent to the auto-reviewer as a
generic policy fact, must not grant shell approval, must not grant a command-prefix rule, and must not
load an extension or expose generated extension guidance by itself. If an agent runs
`svvyx extensions build <id> --json` and that
build reaches dependency approval, the command result references the durable dependency approval
request; the blocked install/build resumes only after that dependency request is approved.

The normal build pipeline is:

```text
files changed
  -> build required
  -> validate source, manifest, package metadata, and lockfile
  -> maybe ask approval for unapproved dependency or trusted dependency identities
  -> maybe install
  -> build
  -> atomically activate only after success
```

Validation errors use ordinary error output and do not create approval requests. Example:

```json
{
  "ok": false,
  "error": {
    "code": "DEPENDENCY_VERSION_NOT_EXACT",
    "message": "Dependency @linear/sdk must use an exact version before it can be installed.",
    "path": "/Users/example/.config/svvy/extensions/package/package.json",
    "dependency": {
      "name": "@linear/sdk",
      "requested": "^12.4.0"
    }
  }
}
```

## `set-usage`

Use case: change whether an extension is loaded, available, or unavailable for an agent profile.

Any actor session with the Extension Managing extension loaded may change extension usage for any
agent profile, not only the profile currently bound to that actor session. This is a profile
management command. It mutates the target agent profile's persistent extension usage state and may
enqueue `agent_context_refresh` work for existing sessions or task attempts that are bound to the
affected profile and whose generated agent context fingerprint changes.

`set-usage` must not mutate the calling session's current loaded/available binding directly. If the
calling session is also affected by the profile change, it receives the same generated-context
refresh path as any other affected session. Agents that want to load an available extension into the
current binding use `load_extension`; agents that want to change profile defaults use
`svvyx extensions set-usage`.

Fixed app-native control extensions cannot be changed by `set-usage`. In v1, Extension Loading is
fixed `default_loaded` and attempts to set it to any state must fail with a clear error.

```bash
svvyx extensions set-usage \
  --extension linear \
  --agent-profile threadHandler \
  --state available \
  --json
```

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `--extension` | yes | Stable extension id. |
| `--agent-profile` | yes | Agent profile id. |
| `--state` | yes | `default_loaded`, `available`, or `unavailable`. |
| `--json` | no | Return machine-readable JSON. |

Example output:

```json
{
  "ok": true,
  "changeId": "chg_173",
  "extensionId": "linear",
  "agentProfile": "threadHandler",
  "before": {
    "state": "unavailable"
  },
  "after": {
    "state": "available"
  },
  "agentContextImpact": {
    "affectsNewTurns": true,
    "activeRunsChangeAtNextSafeBoundary": true,
    "queuedUpdates": [
      {
        "surfacePiSessionId": "thread_8HD2",
        "kind": "agent_context_refresh",
        "label": "Update agent context",
        "reason": "extension_usage_changed"
      }
    ]
  }
}
```

## `reset`

Use case: restore a builtin extension back to builtin defaults.

```bash
svvyx extensions reset <id> --scope instructions --json
```

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `<id>` | yes | Stable extension id. |
| `--scope` | yes | `metadata`, `instructions`, `source`, `usage`, or `all`. |
| `--json` | no | Return machine-readable JSON. |

For `--scope instructions`, reset applies to the complete instruction source set:

- the builtin `instructions/full/*.md` file set is restored exactly
- overlay-added full instruction files are removed
- overlay-removed builtin full instruction files are restored
- renamed full instruction files are restored to builtin names
- builtin instruction-file config, including `bypassed`, is restored exactly
- `instructions/minimal.md` is restored

Example output:

```json
{
  "ok": true,
  "changeId": "chg_174",
  "extensionId": "github",
  "scope": "instructions",
  "result": {
    "resetFiles": [
      "/Users/example/.config/svvy/extensions/sources/builtin-overlays/github/instructions/full/010-github.md",
      "/Users/example/.config/svvy/extensions/sources/builtin-overlays/github/instructions/minimal.md"
    ],
    "buildRequired": true
  }
}
```

`reset` records a reversible command-level change. When reset is triggered by the user or another
product action and changes files or generated context inputs, it immediately requests the normal
build pipeline. If the build needs dependency approval, it creates or reuses the durable dependency
approval request and pauses before install. Ordinary agent file edits still do not auto-build.

User-extension error:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_BUILTIN",
    "message": "Only builtin extensions can be reset to builtin defaults."
  }
}
```

## `delete`

Use case: delete a user-created extension.

```bash
svvyx extensions delete <id> --json
```

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `<id>` | yes | Stable extension id. |
| `--json` | no | Return machine-readable JSON. |

Example output:

```json
{
  "ok": true,
  "changeId": "chg_175",
  "extensionId": "linear",
  "deleted": true,
  "trashId": "trash_42"
}
```

Delete moves the extension into app-managed trash and records a reversible command-level change.
Trash is reachable only through the delete change card or change history; the product does not need
a standalone trash browser.

Builtin-extension error:

```json
{
  "ok": false,
  "error": {
    "code": "BUILTIN_NOT_DELETABLE",
    "message": "Builtin extensions cannot be deleted. Use reset instead."
  }
}
```

## `revert`

Use case: undo a reversible extension change.

```bash
svvyx extensions revert <change-id> --json
```

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `<change-id>` | yes | Previous reversible Extension Managing or extension-file change id. |
| `--json` | no | Return machine-readable JSON. |

Usage revert example:

```json
{
  "ok": true,
  "revertedChangeId": "chg_173",
  "changeId": "chg_176",
  "result": {
    "kind": "extension_usage",
    "extensionId": "linear",
    "agentProfile": "threadHandler",
    "before": {
      "state": "available"
    },
    "after": {
      "state": "unavailable"
    }
  }
}
```

File-change revert example:

```json
{
  "ok": true,
  "revertedChangeId": "chg_188",
  "changeId": "chg_210",
  "result": {
    "kind": "extension_files",
    "extensionId": "linear",
    "files": [
      {
        "path": "/Users/example/.config/svvy/extensions/sources/user/linear/source/index.ts",
        "status": "reverted"
      },
      {
        "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full/010-linear.md",
        "status": "reverted"
      }
    ],
    "buildRequired": false,
    "autoBuild": {
      "status": "success",
      "currentPath": "/Users/example/.config/svvy/extensions/builds/extensions/linear/current",
      "contextReady": true,
      "runtimeReady": true
    }
  },
  "conversationEvent": {
    "message": "User reverted extension file change chg_188 for linear."
  }
}
```

Dependency approval during revert-triggered auto-build:

```json
{
  "ok": true,
  "revertedChangeId": "chg_188",
  "changeId": "chg_210",
  "result": {
    "kind": "extension_files",
    "extensionId": "linear",
    "files": [
      {
        "path": "/Users/example/.config/svvy/extensions/sources/user/linear/source/index.ts",
        "status": "reverted"
      }
    ],
    "buildRequired": true,
    "autoBuild": {
      "status": "needs_user_confirmation",
      "approvalRequestId": "depapr_42",
      "blockedOperation": "revert_auto_build",
      "items": [
        {
          "kind": "dependency",
          "name": "@linear/sdk",
          "version": "12.4.0",
          "packageManager": "bun",
          "source": "npm",
          "integrity": "sha512-..."
        }
      ],
      "message": "Installing these dependency identities requires user approval."
    }
  }
}
```

Delete revert example:

```json
{
  "ok": true,
  "revertedChangeId": "chg_175",
  "changeId": "chg_211",
  "result": {
    "kind": "extension_delete",
    "extensionId": "linear",
    "restored": true,
    "trashId": "trash_42",
    "buildRequired": false,
    "autoBuild": null
  }
}
```

Conflict error:

```json
{
  "ok": false,
  "error": {
    "code": "REVERT_CONFLICT",
    "message": "The change cannot be reverted because one or more files changed since it was recorded.",
    "conflictingPaths": [
      "/Users/example/.config/svvy/extensions/sources/user/linear/source/index.ts"
    ]
  }
}
```

## Snapshots

Use case: save and restore named extension presets from the Extensions surface.

Snapshot operations are user-first product actions. They may also be exposed through Extension
Managing commands so an agent can inspect or apply them when the user asks, but snapshot content is
not an agent-readable dump of secrets. Snapshots are local-only in v1. Exporting snapshots,
importing snapshots on another machine, and cross-machine secret restore are not product concerns
and are unsupported.

Command shape:

```bash
svvyx extensions snapshots list --json
svvyx extensions snapshots save --name "Linear tuned" --json
svvyx extensions snapshots load <snapshot-id> --json
svvyx extensions snapshots rename <snapshot-id> --name "Linear strict" --json
svvyx extensions snapshots delete <snapshot-id> --json
```

Snapshot ids are app-generated stable ids. Agents may pass only ids returned by
`svvyx extensions snapshots list --json` or by a prior snapshot command result.

`list` result:

```json
{
  "ok": true,
  "snapshots": [
    {
      "id": "snap_2026_06_01_linear_tuned",
      "name": "Linear tuned",
      "extensionCount": 2,
      "hasSecretState": true,
      "status": "available"
    }
  ]
}
```

`save` result:

```json
{
  "ok": true,
  "snapshot": {
    "id": "snap_2026_06_01_linear_tuned",
    "name": "Linear tuned",
    "extensionCount": 2,
    "hasSecretState": true,
    "status": "available"
  }
}
```

`rename` result:

```json
{
  "ok": true,
  "snapshot": {
    "id": "snap_2026_06_01_linear_tuned",
    "name": "Linear strict",
    "extensionCount": 2,
    "hasSecretState": true,
    "status": "available"
  }
}
```

`delete` result:

```json
{
  "ok": true,
  "snapshotId": "snap_2026_06_01_linear_tuned",
  "deleted": true
}
```

Snapshot command output must not include raw snapshot file paths by default. If a diagnostic path is
needed for an app-owned support workflow, it must still not expose raw secret values, encrypted
secret blobs, keychain item ids, generated aggregate cache paths, or build output paths.

Snapshot payload includes:

- user extension source files and manifests
- builtin overlay files
- extension registry/config/settings
- agent/profile extension usage states
- instruction-file config such as `bypassed`
- package and lockfile state needed to reproduce exact dependency identities
- non-agent-readable links to app-managed local secret snapshot state, subject to the secret storage
  policy

Snapshot payload excludes:

- `node_modules`
- current and staging compiled extension build outputs
- generated TypeScript declarations
- generated aggregate cache blobs
- runtime build caches
- agent-readable encrypted secret blobs, raw secret values, keychain item identifiers, and
  value-correlating secret metadata

Loading a snapshot restores source/config/package state and immediately requests builds for affected
extensions. If dependency install is needed, the normal install-boundary dependency approval ledger is
checked. If all dependency and trusted dependency identities are already approved, install proceeds
without prompting. If at least one dependency or trusted dependency identity is unapproved, loading
creates or reuses the durable pending approval request for those identities and pauses before
install/build continues. Approving the request records the listed identities and resumes the blocked
snapshot build work. Rejecting it marks the snapshot load's build work blocked, leaves
`buildRequired: true` for affected extensions, and leaves current builds unchanged.

Snapshot dependency approvals follow the same separation as build dependency approvals: they are not
auto-review/user shell approvals, do not enter ordinary auto-review payloads, and do not affect
runtime approval state for `exec_command`, `apply_patch`, `svvyx`, or workflow task-agent tool calls.

Loading a snapshot must leave current builds in place until replacement builds succeed. If a
snapshot removes an extension that an existing session had loaded or available, that session drops
the missing extension exactly as it would after extension deletion and then receives an
`agent_context_refresh`.

Load success example:

```json
{
  "ok": true,
  "snapshotId": "snap_2026_06_01_linear_tuned",
  "restored": {
    "extensions": ["linear", "github"],
    "usageStates": 7,
    "packageState": "restored"
  },
  "builds": [
    {
      "extensionId": "linear",
      "status": "success",
      "currentPath": "/Users/example/.config/svvy/extensions/builds/extensions/linear/current",
      "contextReady": true,
      "runtimeReady": true
    }
  ],
  "agentContextImpact": {
    "queuedUpdates": [
      {
        "surfacePiSessionId": "thread_8HD2",
        "kind": "agent_context_refresh",
        "label": "Update agent context",
        "reason": "snapshot_loaded"
      }
    ]
  }
}
```

Load paused for dependency approval example:

```json
{
  "ok": false,
  "status": "needs_user_confirmation",
  "approvalRequestId": "depapr_84",
  "snapshotId": "snap_2026_06_01_linear_tuned",
  "blockedOperation": "snapshot_load",
  "items": [
    {
      "kind": "dependency",
      "name": "@linear/sdk",
      "version": "12.4.0",
      "packageManager": "bun",
      "source": "npm",
      "integrity": "sha512-..."
    }
  ],
  "message": "Installing these dependency identities requires user approval."
}
```
