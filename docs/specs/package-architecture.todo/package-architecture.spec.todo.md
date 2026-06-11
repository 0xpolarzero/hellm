# Package Architecture Spec Todo

## Status

- Date: 2026-06-11
- Status: future architecture todo
- Scope: package-oriented architecture for making `svvy` a reusable runtime plus desktop UI

This spec defines the target package split for the future architecture refactor.

It is a `.todo` spec because the current authoritative product specs still describe the shipped
single-app implementation and current generated package names. When this future is accepted, the
affected PRD sections and feature inventory must be rewritten to this target design.

## Goal

`svvy` should be a vertically integrated desktop app on top of a small set of reusable packages.
Another app should be able to reuse the runtime, state model, sandbox, pi adapter, and extension
system with a different UI.

The package split must stay intuitive:

- public `@svvy/*` packages are for app developers building with `svvy`
- generated `@svvyx/*` packages are for agents and Smithers workflow source
- builtin capabilities that agents experience as tools, prompt guidance, or commands live under the
  extension system
- implementation areas that are not independently useful outside extensions remain source folders,
  not public packages

## Public Package Set

The target public packages are exactly:

| Package | Spec | Purpose |
| --- | --- | --- |
| `@svvy/contracts` | `contracts.spec.todo.md` | Shared stable contracts, ids, schemas, and event/read-model types. |
| `@svvy/state` | `state.spec.todo.md` | Durable product state, projections, settings, logs, and persistence. |
| `@svvy/sandbox` | `sandbox.spec.todo.md` | Filesystem/network policy and sandbox helper integration. |
| `@svvy/pi-host` | `pi-host.spec.todo.md` | Thin pi adapter for sessions, system prompts, turns, and model metadata. |
| `@svvy/extensions` | `extensions.spec.todo.md` | Extension system plus builtin capability catalog. |
| `@svvy/runtime` | `runtime.spec.todo.md` | Shared orchestration kernel for sessions, surfaces, turns, queues, and extension routing. |
| `@svvy/desktop` | `desktop.spec.todo.md` | Electrobun/Svelte desktop UI over runtime and state. |

Do not create public packages for the following in this refactor:

- `@svvy/tools`
- `@svvy/request-input`
- `@svvy/threading`
- `@svvy/workflows`
- `@svvy/workflow-library`
- `@svvy/artifacts`
- `@svvy/snippets`
- `@svvy/logs`
- `@svvy/observability`
- `@svvy/settings`
- `@svvy/workspaces`
- `@svvy/agent-context`
- `@svvy/extension-library`
- `@svvy/smithers`

Those are source folders or subdomains inside the public packages listed above.

## Generated Package Set

The generated agent/workflow-author packages are:

| Generated package | Spec | Purpose |
| --- | --- | --- |
| `@svvyx/workflows` | `generated-packages.spec.todo.md` | Generated reusable workflow assets for Smithers source. |
| `@svvyx/extensions` | `generated-packages.spec.todo.md` | Generated extension references for workflow task-agent parameter records. |

`@svvyx/*` packages are local generated packages, not published reusable SDKs.

This target design intentionally renames the current generated `@svvy/workflows` and
`@svvy/extensions` packages to `@svvyx/workflows` and `@svvyx/extensions`. The public `@svvy/*`
namespace stays available for reusable developer packages.

## Dependency Graph

Arrows mean "imports or depends on".

```mermaid
graph TD
  desktop["@svvy/desktop"]
  runtime["@svvy/runtime"]
  extensions["@svvy/extensions"]
  pi["@svvy/pi-host"]
  sandbox["@svvy/sandbox"]
  state["@svvy/state"]
  contracts["@svvy/contracts"]

  desktop --> runtime
  desktop --> state
  desktop --> contracts

  runtime --> extensions
  runtime --> pi
  runtime --> sandbox
  runtime --> state
  runtime --> contracts

  extensions --> sandbox
  extensions --> state
  extensions --> contracts

  pi --> contracts

  sandbox --> contracts

  state --> contracts
```

## Source Folder Map

The public package list is intentionally small. The following product domains still need strong
internal module boundaries, but they are not public packages in this target design:

```text
@svvy/extensions/src/
  shell/
  apply-patch/
  execute-typescript/
  extension-loading/
  extension-managing/
  request-input/
  thread-orchestration/
  thread-handling/
  artifacts/
  workflows/
  smithers/
  web/
  cx/
  git/
  github/
  external-instructions/
  base-prompts/
  generated-clients/
  svvyx/

@svvy/runtime/src/
  workspaces/
  worktrees/
  sessions/
  surfaces/
  queues/
  turns/
  title-jobs/
  prompt-refresh/
  recovery/

@svvy/state/src/
  settings/
  providers/
  sessions/
  workspaces/
  worktrees/
  commands/
  threads/
  artifacts/
  artifact-files/
  snippets/
  request-input/
  logs/
  generated-packages/
  read-models/
```

These folders can later become packages only after there is a real non-extension or non-runtime
consumer. Until then, splitting them would make the architecture less intuitive.

## Composition Model

The desktop app and other consumers compose the runtime explicitly:

```ts
import { createStateStore } from "@svvy/state";
import { createSandbox } from "@svvy/sandbox";
import { createPiHost } from "@svvy/pi-host";
import { createExtensions } from "@svvy/extensions";
import { createRuntime } from "@svvy/runtime";

const state = createStateStore({ databasePath, secretStore });
const sandbox = createSandbox({ policySource: state.sandboxPolicyPort() });
const pi = createPiHost({ providers, auth: state.providerAuthPort() });
const extensions = createExtensions({
  state: state.extensionStatePort(),
  artifactStore: state.artifactFileStorePort(),
  sandbox,
});

const runtime = createRuntime({
  state: state.runtimeStatePort(),
  sandbox,
  pi,
  extensions,
});
```

The exact factory names are illustrative. The architectural requirement is that packages compose
through explicit inputs and ports, not hidden globals, renderer singletons, ambient pi state, source
checkout paths, or implicit global package resolution.

## Extension Principle

If agents experience a capability as a model-callable tool, prompt-only guidance, `svvyx` command
family, or generated `execute_typescript` client, it belongs in `@svvy/extensions`.

That includes:

- Shell
- Apply Patch
- Execute TypeScript
- Extension Loading
- Extension Managing
- Request User Input
- Thread Orchestration
- Thread Handling
- Artifacts
- Workflows
- Smithers
- Web
- cx
- Git
- GitHub
- External Instructions
- Base actor prompts

The package architecture refactor must not create separate public packages for those builtin
extension domains unless an independent non-extension consumer is proven later.

## Smithers And Workflows Boundary

Smithers and Workflows remain separate extensions.

The Smithers extension is the existing generated Smithers instruction extension surface. This
architecture refactor does not redesign, expand, or reinterpret Smithers instruction content. If a
future change needs different Smithers guidance, that change belongs in the existing Smithers
extension spec and generation pipeline, not in the package architecture spec.

The Workflows extension is the reusable asset/source-library extension. It owns guidance and command
surface for saving, listing, building, and reusing app-global workflow assets. It is separate from
the Smithers extension and must not rely on Smithers guidance to teach Workflows-specific imports or
commands.

The Workflows extension remains a source-library capability. It does not run, resume, approve,
inspect, or debug active Smithers workflows.

If current Smithers guidance contains reusable Workflows import guidance, the package architecture
implementation must narrowly remove that Workflows-owned guidance from Smithers and relocate it to
the Workflows extension. That is the only Smithers instruction-content change in scope here; it must
not introduce new Smithers guidance or redesign generated Smithers instructions.

## Generated Package Naming

Agents and workflow source should import generated assets from `@svvyx/*` packages:

```ts
import { Agents, Components, Prompts, Workflows } from "@svvyx/workflows";
import { Extensions } from "@svvyx/extensions";
```

Inside `execute_typescript`, loaded extension clients remain an actor-scoped runtime object:

```ts
extensions.artifacts.run("inspect", { args: { artifactId } });
extensions.workflows.run("list", { options: { json: true } });
```

That `extensions` object is not a package import and is not the same thing as generated
`@svvyx/extensions`.

## Non-Goals

- Do not create a public `@svvy/workflows` package in this refactor.
- Do not create a public `@svvy/artifacts` package in this refactor.
- Do not create a public `@svvy/tools` package in this refactor.
- Do not create a public `@svvy/request-input` package in this refactor.
- Do not create a public `@svvy/threading` package in this refactor.
- Do not create a public Smithers package in this refactor.
- Do not introduce a standalone custom shell, readline loop, or alternate TUI stack outside pi.
- Do not use repo-root `workflows/` as shipped product runtime architecture.
- Do not keep compatibility aliases for the old generated package names when this future design
  lands.

## Migration Requirements

When this future design is implemented:

- rewrite package imports in generated workflow source from `@svvy/workflows` to `@svvyx/workflows`
- rewrite generated workflow-agent extension references from `@svvy/extensions` to
  `@svvyx/extensions`
- update Workflows extension guidance to teach `@svvyx/workflows` and `@svvyx/extensions`
- move any existing Workflows import/source-library guidance out of Smithers specs or generators and
  into Workflows extension guidance
- keep new Smithers extension guidance out of the Workflows import story
- update `execute_typescript` import allowlists for generated packages
- update workspace `.smithers/node_modules` link creation and repair
- delete or invalidate stale workspace `.smithers/node_modules/@svvy/workflows` and generated
  `.smithers/node_modules/@svvy/extensions` links so old imports cannot keep working accidentally
- update generated package read models and Workflows pane labels
- update docs, tests, and generated declaration fixtures together
- remove old generated package names rather than preserving aliases

## Acceptance Criteria

- A non-desktop app can use `@svvy/runtime` with its own UI.
- A UI can render authoritative read models and command facts without owning product lifecycle rules.
- All model-callable capabilities are extension records in `@svvy/extensions`.
- `@svvy/extensions` hosts the builtin extension catalog without splitting builtin domains into
  premature public packages.
- Generated agent/workflow packages use the `@svvyx/*` namespace.
- Smithers extension instruction content remains governed by the existing Smithers extension specs.
- Workflows extension guidance is separate from Smithers guidance.
- Smithers workflow execution remains official CLI usage through Shell in handler threads.
- `execute_typescript` keeps actor-scoped loaded-extension clients only for loaded callable
  TypeScript clients.
- Package boundaries avoid cycles and avoid hidden singleton coupling.
- Old generated package links are removed, not retained as compatibility aliases.
