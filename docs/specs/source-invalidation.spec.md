# Source Invalidation And File-Backed Inputs Spec

## Status

- Date: 2026-06-12
- Status: authoritative product spec

## Scope

This spec defines how `svvy` observes file-backed source inputs and refreshes derived product state.
It covers app-global Workflows and Extensions source roots, workspace external-instruction
candidates, discovered read-only host snippet sources, and state-backed read models consumed by
desktop and non-desktop callers. Orchestrator and thread-handler profile settings plus managed
snippets are DB-backed product state in `@svvy/state`, not watched file-backed source.
Workflow-task agent parameter records under `~/.config/svvy/workflows/agents/*.agent.json` are
file-backed Workflows source.

## Core Model

File-system events are invalidation hints only. They are never treated as authoritative state.

`@svvy/runtime` owns scoped source invalidation coordinator lifecycles:

- `app-global`: one coordinator per app bootstrap watches
  `~/.config/svvy/workflows/{agents,prompts,components,workflows}/**`,
  `~/.config/svvy/extensions/sources/{user,builtin}/**`, and
  `~/.config/svvy/extensions/package/package.json`; performs app-global generated-package refresh;
  writes app-scoped source/build facts through core-owned state ports implemented by
  `@svvy/state`; and fans out workspace-link repair to acquired workspace runtimes. It excludes
  generated outputs, build directories, workspace links, trash, snapshots, and other non-source
  evidence.
- `workspace`: one coordinator per acquired workspace runtime watches workspace external-instruction
  candidates and discovered host snippet sources for that workspace only.

App-global generated-package refresh must not run once per workspace runtime. Workspace runtimes may
enqueue link-repair work for their own `.smithers/node_modules/@svvyx/*` links after an app-global
package build commits.

Workspace-link repair follows committed generated-package facts:

- If a workspace runtime is acquired when an app-global generated package build commits, runtime
  wakes that workspace runtime's link-repair worker after generated-package facts commit.
  Workspace-link facts are written by the separate repair worker.
- If a workspace is not acquired, runtime writes a workspace-link fact requiring repair and, when
  required for scheduling, `workspace_generated_package_link_repair` recovery work through
  core-owned state ports. The next acquisition of that workspace runtime reads those facts and
  repairs links before exposing Workflows-generated imports as ready for that workspace.
- If a workspace is released while repair is in progress, the scoped repair fiber is interrupted,
  the current link fact remains non-ready or recovery-pending, and the next workspace acquisition
  resumes from state. A partially written workspace link is not treated as ready until the link
  status fact commits.
- App-global package build and workspace link repair are separate operations. Runtime never rebuilds
  app-global generated packages because one workspace link needs repair.

Each coordinator:

- watches source inputs through runtime-owned coordinator policy using an app/bootstrap-provided
  host file-watcher adapter; renderer and app-entry lifecycle code do not own invalidation
- coalesces raw events with a short debounce
- periodically reconciles source fingerprints as a backstop for missed watcher events
- fingerprints deterministic source inputs by path and file content
- commits source fingerprints, diagnostics, generated-package facts, and state facts that drive
  read-model projection through core-owned state ports
- receives `StateMutationResult.afterCommit` descriptors from committed runtime-facing state-port
  transactions
- treats `StateCommandsFacade` receipts as caller-facing command outputs only; runtime-owned
  follow-up work is scheduled only from committed after-commit descriptors accepted by the runtime
  invalidation boundary
- maps descriptor-backed changes to runtime-owned follow-up work
- publishes typed read-model invalidation notifications only after transaction commit
- records app-log facts only through state app-log ports/facades when a product event requires
  durable observability

Only the app-global runtime coordinator schedules app-global generated-package refresh. Runtime
applies that refresh by invoking the `@svvy/extensions` generated-package service for validation and
file production, then commits generated-package facts through `@svvy/state`. Workspace coordinators
watch only workspace-scoped external instruction and host-snippet sources and never schedule
app-global generated-package builds.

Coordinator schedules are deterministic Effect schedules:

| Schedule                  | Default                                                                                                                                                                                                                         | Scope                        | Rule                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| startup reconcile         | immediate on coordinator acquisition                                                                                                                                                                                            | app-global and workspace     | must complete or record diagnostics/recovery before the coordinator reports ready                                      |
| watcher debounce          | 250 ms after the latest accepted hint, maximum coalescing latency 2 s                                                                                                                                                           | per coordinator and domain   | coalesces duplicate/editor-save events into one deterministic scan                                                     |
| periodic reconcile        | every 60 s while the coordinator is acquired                                                                                                                                                                                    | per coordinator              | scans all domains owned by that coordinator as a missed-event backstop                                                 |
| failed scan retry         | `Schedule.exponential("500 millis").pipe(Schedule.modifyDelay((_, delay) => Effect.succeed(Duration.min(delay, Duration.seconds(10)))), Schedule.bothLeft(Schedule.recurs(5)))`; retries only typed transient IO/build failures | per failed domain scan/build | `recurs(5)` means five follow-up attempts after the initial failed scan; final failure records recovery row/diagnostic |
| manual/recovery reconcile | immediate, outside watcher debounce                                                                                                                                                                                             | requested scope/domain       | runs through the same fingerprint/build/write/event path as scheduled scans                                            |

Tests use Effect `TestClock` to advance debounce, periodic reconcile, timeout, and retry schedules.
Runtime source invalidation code must not use raw timers or host time for these schedules.

Path hints are canonicalized before they affect work:

- Watcher coordinators store the watched root with each `FileSystem.watch(root)` stream. Raw
  watcher event paths are resolved against that root before canonicalization because platform
  backends may emit paths relative to the watched directory. A raw `WatchEvent.path` is never
  promoted directly into a public `SourceInvalidationHint`.
- Runtime resolves the hint path through the platform filesystem/path service, normalizes separators,
  resolves `.` and `..`, and compares the canonical path against the allowed source roots for the
  hinted scope/domain.
- Symlink targets are resolved for containment checks. A source symlink that points outside the
  allowed root is treated as an invalid source diagnostic, not as permission to watch or fingerprint
  outside the domain.
- Case handling follows the canonical path service result for the host filesystem; fingerprint keys
  use the canonical path string returned by that service.
- Temporary editor files, package manager temp files, generated output paths, trash/snapshot paths,
  and workspace `.smithers/node_modules/@svvyx/*` links are ignored as direct work triggers. If the
  ignored path is under a watched root and the event might represent an atomic save, runtime
  schedules the parent domain scan rather than trusting that path.
- A hint outside the allowed roots for its scope/domain is rejected with a typed runtime contract
  error when submitted through the public API. Raw watcher events outside the configured roots are
  ignored because they never become public `SourceInvalidationHint` values.

For editable file-backed domains, the source file remains the editable truth. `@svvy/state`
source-version, fingerprint, diagnostic, and read-model rows are indexes over that file-backed truth
and compare-and-swap baselines, not replacement content stores. For DB/product-state-backed domains,
the committed `@svvy/state` transaction is the source of truth and no file watcher participates.

DB/product-state-backed writes return after-commit invalidation descriptors from the state command
that commits the product write. `@svvy/state` does not publish runtime/app events. Runtime receives
those committed descriptors and maps each one to follow-up work:

| After-commit descriptor                                                                       | Follow-up work                                                                                                      | Surface freshness                                                                                                |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| app preferences, approval mode, network access, artifact directory, ambient resource settings | refetch Settings/General read models; recompute generated context only when prompt/capability policy inputs changed | mark surfaces stale only when the generated-context fingerprint changes                                          |
| provider auth/model metadata                                                                  | refetch provider/model read models; refresh pi-adapter model availability snapshots                                 | do not mark prompt context stale unless actor model selection becomes invalid and state records a binding change |
| agent profile defaults or extension usage/order                                               | recompute affected actor generated-context fingerprints and Agents/Extensions read models                           | mark existing surfaces stale by fingerprint mismatch; do not rewrite active bindings mid-turn                    |
| surface-specific composer extension/model/reasoning binding                                   | recompute that surface's generated-context fingerprint and surface read models                                      | mark that surface stale when current fingerprint differs                                                         |
| managed svvy snippets                                                                         | refetch Snippets pane and composer picker read models                                                               | no generated-context stale marking                                                                               |
| extension env/secret readiness                                                                | refetch Extensions readiness and affected generated declarations/readiness read models                              | mark surfaces stale only when callable declaration availability or generated context changes                     |

Generic app/workspace invalidation descriptors are not enough to run prompt or generated-package
work. The state command that commits the write must return specific after-commit descriptors naming
the affected model, ids, workspace, surface, profile, extension, or snippet scope; runtime publishes
the corresponding typed notifications only after commit.

Renderer panes do not watch files and do not infer source freshness. They subscribe to
`@svvy/runtime` notifications and refetch the affected `@svvy/state` read models.

Editable file-backed panes additionally use edit-session conflict control. Each editable snapshot
includes the source version it was loaded from, and each save is a compare-and-swap against the
current `@svvy/state` source-version row plus the source owner's current file fingerprint. If the
source changed outside the editor after the draft's base version, the save is rejected as a
conflict, the local dirty draft remains mounted, and the editor stops autosaving that draft until
the user explicitly chooses to keep editing, discard the local draft, or overwrite the external
source.

## Watched Source Domains

### Orchestrator And Handler Profile Settings

Orchestrator and thread-handler profile settings are DB-backed product state in `@svvy/state`, not
watched file-backed source. State writes that affect profile defaults, extension usage/order,
provider/model/reasoning, or prompt bindings return after-commit descriptors for app/workspace
read-model invalidations and affected generated-context freshness. Runtime publishes the
notifications and marks affected surfaces stale by generated-context fingerprint mismatch. There is
no `~/.config/svvy/pi/agent-settings.json` source watcher in the product contract.

Workflow-task agent parameter records are different: `~/.config/svvy/workflows/agents/*.agent.json`
is file-backed Workflows source and is handled by the Workflows source invalidation lane below.

### Workflows Source

Sources:

```text
~/.config/svvy/workflows/agents/*.agent.json
~/.config/svvy/workflows/prompts/**
~/.config/svvy/workflows/components/**
~/.config/svvy/workflows/workflows/**
```

When Workflows source changes, the runtime-owned source invalidation coordinator rereads
workflow-agent parameter records, asks `@svvy/extensions` to validate file-backed source, and
schedules app-global generated-package refresh through `@svvy/runtime`. Runtime invokes the
`@svvy/extensions` generated-package service to rebuild `@svvyx/extensions` when required and then
`@svvyx/workflows`; after generated-package facts commit, runtime schedules workspace-link repair for
affected acquired workspace runtimes. Runtime recomputes current generated-context fingerprints,
commits affected read-model/freshness facts through core-owned state ports, receives
after-commit descriptors, publishes the corresponding typed notifications, and marks affected open
surfaces stale by bound/current fingerprint mismatch. `@svvy/runtime` refreshes opted-in stale
surfaces before the next prompt-bearing dispatch.

### Extensions Source

Sources:

```text
~/.config/svvy/extensions/sources/user/**
~/.config/svvy/extensions/sources/builtin/**
~/.config/svvy/extensions/package/package.json
```

Invalidation refreshes extension inventory readiness and rebuilds extension-generated outputs through
the `@svvy/extensions` build/generated-package services. Explicit `svvyx extensions` and
`svvyx workflows build` commands enter the same runtime-owned command and generated-package refresh
lane. Extension command handlers return pre-commit model-facing results plus ordered
`ExtensionRuntimeOperation` values wrapping closed declarative refresh requests. They do not emit
durable command facts directly and do not apply workspace links. Runtime applies accepted refresh
requests, commits affected generated-context, declaration, read-model, generated-package, and
freshness facts through core-owned state ports, receives after-commit descriptors, publishes the
corresponding typed notifications, and marks affected open surfaces stale by bound/current
fingerprint mismatch. `@svvy/runtime` refreshes opted-in stale surfaces before the next
prompt-bearing dispatch.

### External Instructions

Sources:

```text
<workspace ancestor>/AGENTS.md
<workspace ancestor>/CLAUDE.md
<configured global root>/AGENTS.md
<configured global root>/CLAUDE.md
```

Invalidation rediscovers readable/unreadable external instruction candidates, asks
`@svvy/extensions` to validate actor usage and render generated-context contributions, persists
state facts through core-owned state ports implemented by `@svvy/state`, recomputes current
aggregate fingerprints, receives after-commit descriptors for typed read-model invalidations, and
lets runtime mark affected open surfaces stale by bound/current fingerprint mismatch.
Existing open surface bindings are not rewritten by invalidation. `@svvy/runtime` refreshes opted-in
stale surfaces before the next prompt-bearing dispatch.

### Snippets

Managed `svvy` snippets are DB-backed `@svvy/state` records. Managed create, edit, rename, delete,
and enablement changes are state transactions that return after-commit descriptors for Snippets pane
and composer picker invalidations; runtime publishes the corresponding notifications after commit.

The file watcher only fingerprints discovered read-only host Markdown sources:

Sources:

```text
~/.claude/commands/**/*.md
<workspace>/.claude/commands/**/*.md
~/.pi/agent/prompts/*.md
<workspace>/.pi/prompts/*.md
```

Invalidation refreshes the Snippets pane and composer snippet picker read model. Snippets do not
change generated agent context or grant capabilities.

## Non-Source Outputs

Generated outputs are never watched as triggers:

```text
<GeneratedPackageRootPort-resolved @svvyx/workflows root>/**
<GeneratedPackageRootPort-resolved @svvyx/extensions root>/**
~/.config/svvy/extensions/generated/**
~/.config/svvy/extensions/builds/**
<workspace>/.smithers/node_modules/@svvyx/**
<workspace>/.svvy/generated/**
```

Writes to these paths are build results. Watching them would create self-triggering rebuild loops
and would allow generated output/build facts to masquerade as editable source.

## Recompute Rules

Each invalidation batch runs in this order:

1. Re-read source inputs.
2. Validate source contracts.
3. Rebuild generated packages only for domains that require generated output.
4. Keep the last ready generated package active if a rebuild fails.
5. Surface diagnostics through app logs and relevant read models.
6. Publish invalidations for affected read models so renderer read-model caches can refetch from
   state.
7. Mark open surfaces stale by generated-context fingerprint mismatch; opted-in surfaces refresh
   automatically before their next prompt-bearing dispatch.

The same ordering applies to explicit generated-package refresh requests such as
`svvyx workflows build`, startup reconcile, and runtime recovery work. A refresh request must reread
the relevant file-backed source in the same batch before validating or emitting generated files.
Previously recorded source fingerprint rows are comparison inputs and previous-ready evidence; they
are not proof that current filesystem contents have already been observed for the requested build.

Path-to-work matrix:

| Changed source                                                                       | Source owner                                                                                                             | Refresh work                                                                                                  | Generated package work                                                                                                                                       | Read-model invalidations                                                                    | Surface stale scope                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Workflows `agents/*.agent.json`                                                      | `@svvy/extensions` Workflows source service                                                                              | reread and validate task-agent parameters, extension override references, provider/model/reasoning selections | rebuild `@svvyx/extensions` only if extension reference exports changed, then rebuild `@svvyx/workflows` agent exports                                       | Agents workflow-agent rows, Workflows library, generated package facts, diagnostics         | workflow-task parameter records and any surface whose generated context includes affected workflow-agent metadata |
| Workflows prompts/components/workflows source                                        | `@svvy/extensions` Workflows source service                                                                              | reread, validate, and update source metadata/diagnostics                                                      | rebuild `@svvyx/workflows`; rebuild `@svvyx/extensions` first only when validation needs newer extension reference exports                                   | Workflows library, generated package facts, diagnostics                                     | surfaces only when generated actor context or workflow-agent prompt metadata fingerprint changes                  |
| Extension instruction MDX or scripted contributor source                             | `@svvy/extensions` extension source service                                                                              | compile/render contributor, recompute extension prompt and actor generated-context fingerprints               | refresh generated declarations only if callable/facade metadata changed; rebuild `@svvyx/extensions` when generated extension references changed             | Extensions inventory, Agents generated context previews, diagnostics                        | surfaces loading that extension and opted into refresh                                                            |
| Extension command source, manifest, dependency, env declaration, or package metadata | `@svvy/extensions` extension source/build service                                                                        | rebuild extension outputs/readiness, generated command schema, facade declarations, env/dependency readiness  | rebuild `@svvyx/extensions`; rebuild dependent `@svvyx/workflows` when workflow-agent validation or generated agent exports depend on changed extension refs | Extensions inventory, command/declaration read models, generated package facts, diagnostics | surfaces whose callable declarations or loaded context changed                                                    |
| External `AGENTS.md` / `CLAUDE.md`                                                   | `@svvy/extensions` external-instruction service                                                                          | rediscover, read/diagnose, fingerprint, and update external instruction records                               | none                                                                                                                                                         | Extensions external-instruction rows, generated context previews, diagnostics               | surfaces in that workspace whose generated context includes that instruction                                      |
| Discovered read-only host snippet Markdown                                           | external host Markdown file; runtime coordinates scanning and `@svvy/state` persists discovered snippet projection facts | rediscover, read/diagnose, fingerprint, and update discovered snippet records                                 | none                                                                                                                                                         | Snippets pane and composer picker                                                           | none                                                                                                              |

`@svvyx/workflows` refreshes pin validation to the committed `@svvyx/extensions` build id when it
depends on generated extension references. A Workflows build that validated against an older
`@svvyx/extensions` build is not current after extension reference exports change.

Invalid source must not be silently skipped or interpreted as deletion. If a source file exists but
is unreadable or invalid, the product reports that state and keeps the previous ready generated
output active until source becomes valid again.

Deletion is distinct from invalid or unreadable source:

- Deleting an editable source that represents a removable record marks that source record deleted or
  unavailable, records a deletion source version/fingerprint fact, removes it from generated outputs
  on the next successful build, and publishes the same read-model invalidations as an explicit
  product delete command would publish.
- Deleting a required builtin/default source records a missing-source diagnostic and keeps the last
  ready generated output active until the source is reset or restored.
- Deleting a discovered read-only external instruction or host snippet removes or marks that
  discovered record unavailable according to its read model and recomputes aggregate fingerprints.
- Deleting generated output is never source deletion. Runtime records generated-output diagnostics
  or link-repair facts and rebuilds/repairs from source; it does not infer source removal from
  missing generated files.

Editable source saves must never silently overwrite a file whose current source version differs
from the draft's base version. Explicit overwrite is a separate user action and is the only path
that may replace an externally changed source file from a stale draft.

## Reliability Requirements

The runtime source watcher must tolerate:

- editor atomic saves that write a temporary file and rename it over the target
- missing files and directories that appear later
- duplicate low-level events
- file systems that drop or coalesce events
- recursive directory additions and removals
- app-global source changes while multiple workspace tabs share the same runtime

Correctness comes from deterministic fingerprint scans and periodic reconciliation, not from raw
event names or file names.

## Related Specs

- `docs/prd.md`
- `docs/features.ts`
- `docs/specs/extensions-and-tools.spec.md`
- `docs/specs/workflow-library.spec.md`
- `docs/specs/snippets.spec.md`
- `docs/specs/structured-session-state.spec.md`
