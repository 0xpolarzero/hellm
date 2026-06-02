# Extension Managing Spec

## Status

- Date: 2026-06-01
- Status: accepted working spec extracted from `docs/specs/extensions-and-tools.spec.md`
- Scope of this document:
  - define the shipped Extension Managing extension surface
  - define which extension changes happen through normal files and `apply_patch`
  - define which extension changes happen through lifecycle/product-state commands
  - define the `svvyx extensions ...` command API

This spec covers the Extension Managing extension only. The broader extension architecture,
extension loading model, actor defaults, `svvyx` mounting model, shell policy, dependencies, and
secrets are defined in `docs/specs/extensions-and-tools.spec.md`.

## Product Role

Extension Managing is a shipped extension for managing extension definitions and extension usage.

It combines the earlier "Extension Manager" and "Incur Authoring" ideas. There is no separate Incur
Authoring extension unless the product intentionally splits this capability later.

Default availability:

| Actor kind | State |
| --- | --- |
| Orchestrator | available |
| Handler | available |
| Workflow task agent | unavailable |

It is available rather than default-loaded for ordinary orchestrators and handlers because most
coding work should not receive extension-authoring instructions and commands by default. An agent
can request it when the user asks to inspect, create, edit, build, reset, delete, revert, or
configure extensions.

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
- extension usage state changes
- shipped extension reset
- user-extension delete
- extension change revert
- extension snapshot save/load/rename/delete when exposed to agents

Extension Managing must not introduce custom `patch`, `write`, `set-instructions`, or
content-returning commands. Native `apply_patch` is the patching tool.

`inspect` returns relevant resource paths; it does not need an `editable`/`readonly` path taxonomy.
The Extension Managing instructions define what may be edited:

- extension source files
- extension instruction files
- extension manifest files
- the shared extension `package/package.json`

These paths must not be edited by agents:

- `package/bun.lock`
- generated TypeScript declarations
- aggregate cache files
- build output directories
- `node_modules`
- trash
- snapshots
- packaged shipped defaults

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

Workspace-local extensions do not exist in v1. Extension files are app-owned files, not workspace
files. They are still normal filesystem paths so agents can inspect them through shell commands and
edit editable paths through `apply_patch`.

This storage root intentionally does not reuse pi's `~/.pi/agent/extensions/` or project-local
`.pi/extensions/` discovery paths, and it does not reuse Smithers `.smithers/` workflow or hot-reload
directories. Those systems remain runtime references; `svvy` owns extension source, generated
aggregate cache, dependency state, and build output under `~/.config/svvy/extensions/`.

Editable file-backed content includes:

- manifest-like editable metadata
- full instructions
- minimal instructions
- Incur CLI source code
- the shared extension `package/package.json` when dependency state needs manual adjustment

Generated files are returned for inspection and prompt-generation traceability, but they are
read-only from the agent's point of view. They are regenerated by `build`.

Database or product-state storage includes:

- extension registry records
- category: `shipped`, `user`, or `external_instruction`
- interface: `native_tool`, `svvyx`, or `instructions`
- current build status and extension context fingerprints as internal activation state, not as a
  user-facing rollback surface
- usage state per agent profile
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

Shipped extensions have packaged defaults plus editable overlays:

- shipped extensions are non-deletable
- shipped extensions are resettable
- shipped defaults live in packaged app resources and are read-only
- shipped title, description, instructions, and optional editable extension source are editable by
  materializing or updating app-owned overlay files under `sources/builtin-overlays/<id>/`
- shipped generated files, native runtime implementation, and app-owned bridge code are read-only and
  cannot be edited through Extension Managing
- `inspect` materializes shipped overlay files before returning editable paths so shell inspection and
  `apply_patch` work normally
- `reset` restores shipped defaults by removing or replacing the overlay for the selected scope

External instruction records are a separate category:

- external instructions use `category: "external_instruction"` and `interface: "instructions"`
- source content lives in external files such as `AGENTS.md` or `CLAUDE.md`
- Extension Managing may inspect their metadata and usage state but must not expose their source
  files as editable extension paths
- reset restores only `svvy` usage/settings or shipped metadata overlays, not the external file
- delete is unavailable

User extensions are ordinary app-owned extension directories:

- user extension source lives under `sources/user/<id>/`
- `source/` exists only for extensions with editable executable source; prompt-only extensions omit
  it or return `source: null` from `inspect`
- user extensions are deletable
- user extensions are not resettable to shipped defaults
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
- Only a successful ready generated agent context can enqueue or apply `agent_context_refresh`.
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
  category: "shipped" | "user" | "external_instruction";
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

type ExtensionUsageState = {
  actorKind: "orchestrator" | "handler" | "workflow_agent";
  state: "default_loaded" | "available" | "unavailable";
};

type InspectExtensionRequirements = {
  externalBinaries: Array<{
    name: string;
    status: "available" | "missing" | "unknown";
  }>;
  env: Array<{
    name: string;
    required: boolean;
    secret: boolean;
    description: string;
    status: "configured" | "missing" | "defaulted" | "optional_missing";
  }>;
  dependencies: ExtensionDependencyRequirement[];
  trustedCliDependencies: TrustedCliDependencyRequirement[];
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
    source: "npm" | "cargo" | "github-release" | "git-scm-release" | "bundled_app_resource";
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
    | "EXTERNAL_BINARY_MISSING"
    | "EXTERNAL_BINARY_UNKNOWN"
    | "EXTERNAL_CLI_AUTH_MISSING"
    | "EXTERNAL_CLI_AUTH_INSUFFICIENT"
    | "EXTERNAL_CLI_AUTH_UNKNOWN";
  message: string;
};
```

`usage` is the global agent/profile usage configuration for the inspected extension. It is useful in
Extension Managing because the command is a management surface. Native `list_extensions` must not
return `usage`; it returns only the current actor's `state.binding`.

Inspect uses the same requirement-readiness semantics as native `list_extensions`.
`requirements.externalBinaries[].status` is limited to `"available"`, `"missing"`, or `"unknown"`
for local binary presence. It must not encode CLI account authentication, OAuth state, token scopes,
remote service reachability, timestamps, account names, usernames, or host credentials. Known CLI
auth blockers, such as missing or insufficient GitHub CLI auth for `gh`, are represented only by
coarse `state.ready: false` plus `state.issues` codes when the app already knows them. Extension
Managing must not add a separate `externalAuth` or `authStatus` field, run login flows, mutate
credentials, contact remotes only to improve status labels, or watch arbitrary failed agent shell
commands to update inspect readiness.

For prompt-only Git and GitHub, unknown `git`, `gh`, or `gh` auth status is advisory and must not
block inspect readiness or generated prompt loading. Known status can be displayed through
`requirements.externalBinaries`, `requirements.trustedCliDependencies`, and `state.issues`, but the
GitHub prompt still tells agents to report missing CLI binaries through the app-managed trusted CLI
dependency flow and to offer auth guidance only after an actual `gh` command fails.

Prompt-only shipped example:

```json
{
  "ok": true,
  "extension": {
    "id": "github",
    "category": "shipped",
    "interface": "instructions",
    "title": "GitHub",
    "description": "Conservative GitHub CLI guidance for issues, pull requests, review comments, Actions checks, publishing, and PR wrap-up.",
    "resettable": true,
    "deletable": false,
    "typescriptApiEnabled": false,
    "paths": {
      "sourceRoot": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/github",
      "manifest": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/github/manifest.json",
      "instructionsFull": "/Users/example/.config/svvy/extensions/sources/builtin-overlays/github/instructions/full.md",
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
        "actorKind": "orchestrator",
        "state": "default_loaded"
      },
      {
        "actorKind": "handler",
        "state": "default_loaded"
      },
      {
        "actorKind": "workflow_agent",
        "state": "available"
      }
    ],
    "requirements": {
      "externalBinaries": [
        {
          "name": "git",
          "status": "available"
        },
        {
          "name": "gh",
          "status": "available"
        }
      ],
      "env": [],
      "dependencies": [],
      "trustedCliDependencies": [
        {
          "id": "git",
          "binary": "git",
          "status": "available",
          "detectedVersion": "2.54.0",
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
          "status": "available",
          "detectedVersion": "2.93.0",
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

Incur-backed shipped example:

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
    "usage": [
      {
        "actorKind": "orchestrator",
        "state": "unavailable"
      },
      {
        "actorKind": "handler",
        "state": "default_loaded"
      },
      {
        "actorKind": "workflow_agent",
        "state": "unavailable"
      }
    ],
    "requirements": {
      "externalBinaries": [],
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
      "trustedCliDependencies": [],
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
| `--interface` | yes | `instructions` or `svvyx`. `native_tool` is reserved for shipped app-owned extensions and cannot be created through Extension Managing. |
| `--typescript-api` | no | Boolean. Defaults to `false`. |
| `--json` | no | Return machine-readable JSON. |

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
      "instructionsFull": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full.md",
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
        "actorKind": "orchestrator",
        "state": "available"
      },
      {
        "actorKind": "handler",
        "state": "available"
      },
      {
        "actorKind": "workflow_agent",
        "state": "unavailable"
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

Successful builds always activate the new generated extension context for future extension resolution. There is
no separate user-facing activation command and no user-facing build rollback command. A build writes
to `builds/extensions/<id>/staging/<build-run-id>/` while it is running; after validation succeeds,
`svvy` atomically replaces `builds/extensions/<id>/current/` with that staged output. Failed or
blocked builds must not replace `current/`.

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
    "currentPath": "/Users/example/.config/svvy/extensions/builds/extensions/github/current"
  },
  "requirements": {
    "env": []
  },
  "ready": true,
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
  "ready": false,
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

Failed builds must leave the current mounted extension command set untouched. The failed staging
directory is discarded unless retained only long enough to surface diagnostics for that build
attempt; it is not a preserved build artifact or rollback target.

Failed installs must leave the current mounted extension command set untouched. `package.json` remains as
the user's or agent's requested dependency state. `bun.lock` may have changed only if Bun reached the
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
- failed install or build leaves `builds/extensions/<id>/current/` and any existing mounted runtime
  command set untouched
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
  binding or mount an extension into a session
- rejecting a request marks that pending request rejected, updates every referencing pane and
  conversation tool card, leaves `buildRequired: true`, and leaves the current mounted command set
  unchanged
- rejection does not create a permanent deny rule; a later explicit build or refresh may create a new
  approval request if the same unapproved identities are still required
- unanswered approval requests remain pending and visible until approved, rejected, or made obsolete
  by later source/package changes that no longer require the same identities

Dependency approval is not the Codex-like shell approval path. It is a product-state approval ledger
for exact dependency and trusted dependency identities. It must not be sent to the auto-reviewer as a
generic policy fact, must not grant shell approval, must not grant a command-prefix rule, and must not
mount or load an extension by itself. If an agent runs `svvyx extensions build <id> --json` and that
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

Use case: restore a shipped extension back to shipped defaults.

```bash
svvyx extensions reset <id> --scope instructions --json
```

Parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `<id>` | yes | Stable extension id. |
| `--scope` | yes | `metadata`, `instructions`, `source`, `usage`, or `all`. |
| `--json` | no | Return machine-readable JSON. |

Example output:

```json
{
  "ok": true,
  "changeId": "chg_174",
  "extensionId": "github",
  "scope": "instructions",
  "result": {
    "resetFiles": [
      "/Users/example/.config/svvy/extensions/sources/builtin-overlays/github/instructions/full.md",
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
    "message": "Only shipped extensions can be reset to shipped defaults."
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

Shipped-extension error:

```json
{
  "ok": false,
  "error": {
    "code": "SHIPPED_NOT_DELETABLE",
    "message": "Shipped extensions cannot be deleted. Use reset instead."
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
        "path": "/Users/example/.config/svvy/extensions/sources/user/linear/instructions/full.md",
        "status": "reverted"
      }
    ],
    "buildRequired": false,
    "autoBuild": {
      "status": "success",
      "currentPath": "/Users/example/.config/svvy/extensions/builds/extensions/linear/current",
      "ready": true
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

Snapshot payload includes:

- user extension source files and manifests
- shipped overlay files
- extension registry/config/settings
- agent/profile extension usage states
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
`buildRequired: true` for affected extensions, and leaves current mounted extension command sets
unchanged.

Snapshot dependency approvals follow the same separation as build dependency approvals: they are not
auto-review/user shell approvals, do not enter ordinary auto-review payloads, and do not affect
runtime approval state for `exec_command`, `apply_patch`, `svvyx`, or workflow task-agent tool calls.

Loading a snapshot must leave current mounted extension command sets in place until replacement builds
succeed. If a snapshot removes an extension that an existing session had loaded or available, that
session drops the missing extension exactly as it would after extension deletion and then receives an
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
      "ready": true
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

## Open Questions

- The exact `manifest.json` schema is not yet finalized. It should be generated or documented from
  the implementation contract rather than maintained as loose prose.
- The exact generated TypeScript declaration shape depends on the final Incur public surface.
