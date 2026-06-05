# Smithers Extension Spec

## Status

- Date: 2026-06-05
- Status: accepted extension surface direction
- Scope:
  - centralize the current Smithers extension record
  - resolve Smithers as a first-party native tool extension, not an Incur-backed `svvyx` extension
  - define the versioned Smithers CLI requirement and generated instruction source/transform
  - point to the existing workflow supervision and workflow library specs

This document is the source of truth for the builtin Smithers extension record, generated Smithers
instruction source/transform, and handler-thread agent-facing Smithers boundary. Detailed workflow run
behavior remains in the workflow supervision and workflow library specs.

## Extension Record

```json
{
  "id": "smithers",
  "category": "builtin",
  "interface": "native_tool",
  "title": "Smithers",
  "description": "Smithers-native workflow run, inspection, supervision, approval, signal, transcript, and artifact controls.",
  "typescriptApiEnabled": false,
  "cliRequirements": [
    {
      "id": "smithers-orchestrator",
      "binary": "smithers",
      "required": true,
      "version": "0.22.0",
      "versionCommand": "smithers --version",
      "installCommand": "npm install -g smithers-orchestrator@{{version}}"
    }
  ],
  "generatedInstructions": [
    {
      "output": "instructions/full/010-smithers-full.generated.md",
      "script": "scripts/generate-smithers-full.ts",
      "versionCliRequirementId": "smithers-orchestrator"
    }
  ]
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `unavailable` |
| Handler thread | `default_loaded` |
| Workflow task agent | `unavailable` |

## Current Intended Surface

The Smithers extension is the handler-thread workflow-supervision capability. It should preserve
Smithers-native names instead of inventing a parallel `workflow_*` abstraction.

The declared Smithers CLI requirement supports version-specific generated instructions plus
operator, supervision, and authoring tasks. It gives the generated instruction script an
exact-version upstream documentation source through the global required `smithers` binary. In the
current adopted product surface, handler threads supervise workflow runs through native
`smithers_*` tools by default. The generated instruction transform must still preserve concrete
Smithers CLI supervision commands because they are the canonical Smithers operation vocabulary and
may become the direct handler-facing surface in a later design revision. This spec does not make that
later surface change.

Agent-visible tools use the `smithers_*` namespace. When the underlying Smithers operation uses a
dotted or camelCase name, the model-facing tool name is the snake_case `smithers_` form while final
command facts preserve the raw Smithers operation name.

Currently referenced model-facing controls include:

```ts
smithers_run_workflow({ workflowId, input, runId? })
smithers_list_workflows({ workflowId?, productKind? })
smithers_list_runs(...)
smithers_get_run(...)
smithers_watch_run(...)
smithers_explain_run(...)
smithers_list_pending_approvals(...)
smithers_resolve_approval(...)
smithers_get_node_detail(...)
smithers_list_artifacts(...)
smithers_get_chat_transcript(...)
smithers_get_run_events(...)
smithers_runs_cancel(...)
smithers_signals_send(...)
smithers_frames_list(...)
smithers_get_devtools_snapshot(...)
smithers_stream_devtools(...)
```

## Generated Instruction Source And Transform

The generated Smithers instruction file is:

```text
instructions/full/010-smithers-full.generated.md
```

In this path, `full` means the extension's full loaded-instruction tier in `svvy`; it does not mean
the file is a verbatim copy of Smithers' upstream `llms-full.txt`.

The separate svvy-specific Smithers guidance file is:

```text
instructions/full/020-smithers-svvy-boundary.md
```

That file is hand-authored and ordered after the generated file. It must carry only positive
svvy-owned product-boundary guidance that is not sourced from upstream Smithers docs. It must not
describe obsolete or temporary `svvy` Smithers tool surfaces, must not correct contradictions left
inside `010-smithers-full.generated.md`, and must not restate which upstream sections were removed.
The generator must delete confusing upstream sections before the generated file is loaded.

The editable generator script is:

```text
scripts/generate-smithers-full.ts
```

Extension Managing invokes the script with the shared generated-instruction command contract:

```bash
bun scripts/generate-smithers-full.ts \
  --output /absolute/path/to/instructions/full/010-smithers-full.generated.md \
  --version 0.22.0
```

This docs repository also contains a concrete reference implementation of the generator transform
and the svvy-specific instruction file:

```text
docs/specs/extension/smithers-reference/scripts/generate-smithers-full.reference.ts
docs/specs/extension/smithers-reference/instructions/full/020-smithers-svvy-boundary.md
```

Those files are reference artifacts for this spec. The shipped extension still uses the script and
instruction paths declared above.

The script must derive the upstream source Markdown from the exact installed `smithers` binary that
satisfies the `smithers-orchestrator` CLI requirement for the version passed through `--version`. It
must not read `docs/vendor/smithers/`, the `docs/references/smithers` checkout,
`https://smithers.sh/llms-full.txt`, repo-root `workflows/`, or any source-checkout-relative
Smithers authoring paths.

`docs/references/smithers` remains a fallback reference for Smithers runtime behavior when product
specs leave a runtime question ambiguous. It is not authoritative for generated instruction source
selection, and the version-matched CLI docs command wins if that reference subtree still describes
older latest-doc behavior.

For `smithers-orchestrator@0.22.0`, the upstream source commands are:

```bash
smithers --version
smithers docs-full --json
```

`smithers --version` must print exactly the declared `--version`. `smithers docs-full --json` must
then return the docs for that installed CLI version. The generator must not invoke `bunx
smithers-orchestrator`, `bunx smithers`, `curl`, mutable docs URLs, or source-checkout paths to
source generated instructions.

`smithers docs-full --json` returns JSON shaped as:

```ts
type SmithersDocsFullJson = {
  url: string;
  content: string;
};
```

For `--version 0.22.0`, `url` must be exactly:

```text
https://raw.githubusercontent.com/smithersai/smithers/v0.22.0/docs/llms-full.txt
```

The Smithers docs command owns source resolution for the installed CLI version:

- when packaged current-version docs are available, Smithers reads the `llms-full.txt` shipped with
  that CLI package
- when packaged current-version docs are not available, Smithers may fetch the version-pinned raw
  GitHub URL for the same package version
- `--docs-version <version>` exists for manual Smithers CLI use, but the `svvy` generator must not
  use it because `svvy` has already required and verified the exact installed CLI version
- `--latest` fetches the mutable `https://smithers.sh/llms-full.txt` docs site output and must never
  be used by the `svvy` generator
- `--latest` and `--docs-version` are mutually exclusive in Smithers and are irrelevant to the
  generated instruction script

The generated file must be a deterministic, filtered Smithers instruction file derived from the
validated upstream `content` field. It must not be a verbatim copy of the upstream full
documentation followed by a corrective `svvy` note. Product-incorrect or high-confusion upstream
sections must be deleted from the generated output. Prefer deletion over rewriting; svvy-specific
guidance belongs in the separate hand-authored instruction file
`instructions/full/020-smithers-svvy-boundary.md`.

The generated output should remain version-specific Smithers documentation. The transform is mostly
mechanical: remove banned sections, replace upstream `bunx smithers-orchestrator` command prefixes
with `smithers`, and validate that the retained output still includes core Smithers workflow,
runtime, CLI, supervision, observability, and event material.

### Transform Policy

Keep upstream material that a `svvy` handler or workflow author needs in order to use Smithers
correctly:

- concise Smithers overview and mental model
- workflow authoring fundamentals: JSX tree, render loop, `ctx`, task modes, control flow,
  unidirectional outputs, approvals, durability/resume, snapshots/fork, caching, retry, and common
  gotchas
- JSX/component reference for workflow construction, including task, sequence, parallel, branch,
  loop, approval, wait, timer, sandbox, subflow, worktree, supervisor, review/kanban-style helper,
  and other runtime components
- recipes that teach concrete workflow authoring patterns
- CLI command syntax for running, listing, inspecting, watching/logging, approving, resuming,
  cancelling, forking, replaying, diffing, evaluating, serving, and debugging Smithers workflows
- programmatic runtime references that handler-authored workflow code may need, including
  `runWorkflow`, run state, events, observability, Gateway, MCP/server surfaces, memory, OpenAPI
  tools, Effect API, and typed API references when they are directly useful for workflow authoring
  or inspection
- warnings, option names, exit codes, schema shapes, and version-specific command syntax from the
  retained upstream sections

Remove upstream material that is confusing or actively wrong for `svvy`'s intended agent boundary:

- the entire `## Always Run with \`bunx\`` section, including warnings against global install or bare
  `smithers`
- `## Install the Agent Skill`
- mutable docs-site reading advice and `smithers ask` / docs-helper advice
- Smithers Integrations material for SDK/CLI agent wiring and external-agent ecosystems:
  `# Smithers Integrations`, `## Integrations`, `## Pattern 1: Pass tools to an SDK agent`,
  `## Pattern 2: Pass a skill / plugin / MCP config to a CLI agent`, `## CLI Agents`,
  `## SDK Agents`, `## Built-in Tools`, `## defineTool`, `## read`, `## write`, `## edit`,
  `## grep`, `## bash`, `## Using Tools with Agents`, `## Common External Tools`, `## Ecosystem`,
  `## PI Integration`, and all subsections below those headings until `# Smithers Events`
- workflow-authoring recipes that are only examples of Smithers SDK tool wiring:
  `## Coherent task with tools`, `## Per-agent least-privilege tools`, and
  `## Side-effect tools with idempotency`

Keep Smithers intended project setup for now, including `smithers init`, `.smithers/` scaffolding,
workflow packs, starters, templates, and workflow authoring. The workflows design is still being
reworked, and the generated Smithers instructions should stay close to intended Smithers usage until
the product explicitly resolves a different workflow layout.

Edit retained upstream material only mechanically:

- replace every `bunx smithers-orchestrator` command prefix with `smithers`
- remove the `Always Run with \`bunx\`` section rather than rewriting it
- remove tool/agent-integration sections rather than rewriting them into svvy guidance
- do not rewrite retained Smithers CLI supervision commands away; examples should use direct
  `smithers` commands such as `smithers ps`, `smithers inspect <run-id>`, `smithers logs <run-id>`,
  `smithers approve ...`, `smithers up ... --resume true`, `smithers cancel ...`,
  `smithers events ...`, `smithers timeline ...`, `smithers diff ...`, `smithers fork ...`, and
  `smithers replay ...`

The transform must not remove Smithers CLI supervision commands merely because the current product
surface also exposes `smithers_*` native tools. The current native-tool surface and any future
direct-CLI surface both depend on the same Smithers operation concepts, so command syntax is useful
agent knowledge.

## Generator Validation

`scripts/generate-smithers-full.ts` must be deterministic for one exact Smithers version and fail
closed when upstream docs cannot be proven to match that version or when the filtered output cannot
be proven to match the transform policy above.

The script must validate:

- `--output` is present, absolute, writable by the build process, and points to the declared
  generated Markdown output
- `--version` is present and is an exact semver version from `versionCliRequirementId:
  "smithers-orchestrator"`
- `smithers --version` exits successfully and prints exactly the declared version
- `smithers docs-full --json` exits successfully and is the only upstream source command
- the source command exits successfully and prints valid JSON with only the expected top-level
  contract fields needed by the generator: `url` and `content`
- `url` equals `https://raw.githubusercontent.com/smithersai/smithers/v0.22.0/docs/llms-full.txt`
  for version `0.22.0`, with the version substituted for future exact versions
- upstream `content` is non-empty, starts with `# Smithers — full documentation`, includes
  `Package: smithers-orchestrator`, and includes core Smithers sections and command references such
  as `## Smithers`, CLI, workflow/runtime, components, observability, event, and type/reference
  material
- `content` is large enough to plausibly be the full bundle rather than a concise index; for
  `0.22.0`, the packaged `llms-full.txt` is roughly 336 KB, so a tiny response is invalid
- the transformed output is non-empty, starts with a Smithers heading, retains concrete `smithers`
  CLI examples, and includes workflow authoring/runtime, component, CLI
  supervision, observability, event, and type/reference material selected by the transform policy
- the transformed output is materially smaller than the upstream full bundle and does not include
  removed sections such as `Always Run with \`bunx\``, Agent Skill installation, `ask` docs-helper
  guidance, Smithers SDK/CLI agent wiring, built-in tools, `defineTool`, ecosystem, or PI
  integration
- every retained or generated replacement paragraph is deterministic for the input content and
  exact version; no date/time, latest-version, registry-latest, local path, or machine-specific text
  may be emitted

The script must reject generated output containing obsolete source-boundary phrases or product
surfaces that must not appear in Smithers instructions:

- `docs/vendor/smithers`
- `smithers-0.22.0.llms-full.txt`
- `svvyx smithers`
- `bunx smithers-orchestrator`
- `Always Run with \`bunx\``
- `Do **not** install Smithers globally`
- `do **not** use the bare \`smithers\``
- `smithers docs-full --latest`
- `smithers docs --latest`
- `https://smithers.sh/llms-full.txt`
- `docs/references/smithers`
- `Install the Agent Skill`
- `smithers ask`
- `defineTool`
- `## Built-in Tools`
- `## read`
- `## write`
- `## edit`
- `## grep`
- `## bash`
- `## Using Tools with Agents`
- `# Smithers Integrations`
- `## CLI Agents`
- `## SDK Agents`
- `## Ecosystem`
- `## PI Integration`

The script must require generated output containing retained Smithers usage markers:

- `smithers init`
- `smithers up`
- `smithers inspect`
- `smithers logs`
- `smithers approve`
- `docs-full`
- `# Smithers`
- `## How It Works`
- `## JSX API`
- `## CLI`
- `# Smithers Events`

The script must not call:

- `bunx smithers-orchestrator docs-full --latest`
- `bunx smithers-orchestrator docs --latest`
- `bunx smithers-orchestrator docs-full --docs-version ...`
- `bunx smithers-orchestrator docs-full --json`
- `bunx smithers docs-full --json`
- `smithers docs-full --latest`
- `smithers docs --latest`
- `smithers docs-full --docs-version ...`
- `curl https://smithers.sh/llms-full.txt`
- any command under repo-root `workflows/`

On failure, the script must:

- exit nonzero
- leave no partial generated output at `--output`, or write to a temporary sibling and atomically
  replace the output only after all validation passes
- print concise diagnostics naming the failed command or failed validation
- not fall back to mutable latest docs, stale vendored files, `docs/references/smithers`, or a
  source-checkout-relative Smithers repo

## Version Update Process

Updating the Smithers version shipped by `svvy` is a deliberate product update:

1. Change the Smithers CLI requirement exact version in this extension manifest.
2. Ensure that the released `smithers-orchestrator` CLI for that version supports
   `smithers docs-full --json` and returns the matching `v<version>/docs/llms-full.txt` URL.
3. Run `svvyx extensions build smithers --json`; build checks the exact CLI requirement before the
   generator runs.
4. Inspect the generated `010-smithers-full.generated.md` diff as filtered version-specific Smithers
   instruction content.
5. Update the transform policy or script only if upstream headings changed, the filtered content
   lost required Smithers command/runtime material, or retained upstream wording became misleading
   for `svvy`.
6. Update workflow supervision or workflow library specs only when Smithers runtime/API behavior
   changed, not merely because upstream prose changed.

## Extension Managing And Build Behavior

- `svvyx extensions build smithers --json` fails if the declared Smithers CLI requirement is
  missing, `smithers --version` does not report exactly the declared `smithers-orchestrator`
  version, or if required CLI status cannot be determined.
- The agent may run the concrete install command returned by `inspect` or `build` through
  `exec_command`, where the normal approval flow applies, then rerun build.
- The generated instruction output is read-only to agents. Agents edit
  `scripts/generate-smithers-full.ts` or the manifest, then rerun build.
- Build must not treat the repo-root `workflows/` authoring workspace, `workflows/node_modules`,
  `workflows/smithers.db`, or source-checkout-relative Smithers paths as part of the shipped
  Smithers extension instruction source.

## Testing

Required doc/extension tests:

- Smithers is represented as `category: "builtin"` and `interface: "native_tool"`.
- Smithers declares a required exact CLI requirement for `smithers-orchestrator@0.22.0`, binary
  `smithers`, with version command `smithers --version`.
- Smithers declares `generatedInstructions` with output
  `instructions/full/010-smithers-full.generated.md`, script `scripts/generate-smithers-full.ts`,
  and `versionCliRequirementId: "smithers-orchestrator"`.
- Generated Smithers output is produced from `smithers docs-full --json` after validating
  `smithers --version`.
- Generated Smithers output is filtered and rewritten according to this spec's transform policy; it
  is not byte-for-byte upstream full docs and is not upstream full docs plus a corrective appendix.
- Generated Smithers output keeps concrete workflow authoring, runtime, component, CLI supervision,
  observability, event, and type/reference material needed by handlers and workflow authors.
- Generated Smithers output removes `Always Run with \`bunx\``, Agent Skill installation, docs-helper,
  ecosystem, PI integration, and Smithers SDK/CLI agent/tool material including `defineTool`,
  built-in tools, `read`, `write`, `edit`, `grep`, and `bash`.
- Generated Smithers output preserves direct Smithers CLI supervision commands using the global
  `smithers <command>` shape when those commands are retained.
- Generated Smithers output keeps Smithers init, `.smithers/` scaffolding, workflow packs, starters,
  templates, and normal Smithers workflow authoring/setup material.
- The loaded Smithers full instruction set includes the generated file followed by
  `instructions/full/020-smithers-svvy-boundary.md`; the second file contains only positive
  svvy-specific boundary guidance that is not derived from upstream Smithers docs, does not mention
  removed upstream sections, and does not describe current or obsolete `svvy` Smithers tool
  abstractions.
- Build fails rather than falling back when the `smithers` docs command fails, returns invalid
  JSON, returns a nonmatching version URL, returns implausibly small upstream source content, or
  produces transformed output that fails the keep/remove/rewrite validation checks.
- Build never fetches `https://smithers.sh/llms-full.txt` and never passes `--latest`.
- Generated Smithers output contains no `docs/vendor/smithers`, `smithers-0.22.0.llms-full.txt`,
  or `svvyx smithers`
  wording.

## Notes

- Exact input/output schemas are not centralized in this file yet.
- Smithers is not an Incur-backed `svvyx` extension. Handler-thread agent-facing workflow control is
  exposed as first-party `smithers_*` tools through the Bun-owned Smithers bridge.
- Workflow run behavior is currently defined in `docs/specs/workflow-supervision.spec.md`.
- Workflow authoring and saved entry behavior is currently defined in
  `docs/specs/workflow-library.spec.md`.
- This file is canonical for the Smithers extension record and generated instruction
  source/transform. Exact model-facing Smithers tool input/output schemas remain split with the
  workflow supervision spec until they are centralized here.

## Invariants

- Smithers remains a first-party native-tool extension, not an Incur-backed `svvyx` extension.
- Handler threads supervise workflows through native `smithers_*` tools by default in the current
  adopted surface, while retained direct Smithers CLI supervision commands remain useful
  version-specific Smithers knowledge.
- The generated Smithers instruction output comes from exact-version upstream Smithers docs fetched
  through the exact installed global `smithers` CLI with `smithers docs-full --json`.
- The generated Smithers full instruction output does not come from `docs/vendor/smithers`,
  `docs/references/smithers`, `https://smithers.sh/llms-full.txt`, or repo-root `workflows/`.
- `smithers docs-full --latest` is never used for generated instruction builds.
- `010-smithers-full.generated.md` is a deterministic filtered Smithers instruction file, not a
  verbatim upstream full-doc dump and not a full-doc dump plus later correction.
- Product-incorrect setup, auth, agent-tool, and workflow-location assumptions are removed or
  mechanically rewritten in the generated output instead of being contradicted by a separate
  instruction file.
