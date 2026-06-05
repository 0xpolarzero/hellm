# cx Extension Spec

## Status

- Date: 2026-06-05
- Status: authoritative product spec
- Scope:
  - define the builtin cx extension boundary
  - define cx as prompt-only direct CLI guidance
  - define the exact cx CLI commands agents may use through `exec_command`
  - define the versioned cx CLI requirement used by build/readiness checks
  - reject native `cx_*` tools, `svvyx cx`, and generated cx TypeScript clients for v1

This document is the source of truth for the resolved cx extension direction.

Related specs:

- `docs/specs/extensions-and-tools.spec.md` defines the general extension architecture, prompt-only
  extensions, CLI requirements, shell policy, generated agent context, and
  `execute_typescript`.
- `docs/specs/extension/extension_managing.extension.spec.md` defines how builtin extension instructions are inspected,
  overlaid, reset, and built when extension content is editable.

## Product Intent

`svvy` should give coding agents a semantic code-navigation ladder without creating another
product-owned editing, filesystem, shell, or TypeScript SDK surface.

The resolved cx v1 model is:

- `cx` is a builtin extension.
- `cx` uses `interface: "instructions"`.
- `cx` is prompt-only.
- `cx` is default-loaded for all adopted actor kinds.
- `cx` teaches agents to use the official `cx` CLI directly through `exec_command`.
- `svvy` does not expose `cx_overview`, `cx_symbols`, `cx_definition`, `cx_references`,
  `cx_lang_list`, `cx_lang_add`, `cx_lang_remove`, `cx_cache_path`, or `cx_cache_clean` as native
  model tools.
- `svvy` does not expose `svvyx cx`.
- `svvy` does not expose `api.cx_*`, `extensions.cx.*`, or any generated cx TypeScript client in
  v1.
- `svvy` does not wrap cx in an Incur CLI or expose Incur to agents for cx.

This is intentional. cx already has a small agent-facing CLI and an agent-facing `cx skill`
instruction. The obvious product boundary is to ship that instruction as a prompt-only extension and
let agents run `cx` through the normal shell command tool.

## Extension Record

The builtin cx extension record is:

```json
{
  "id": "cx",
  "category": "builtin",
  "interface": "instructions",
  "title": "cx",
  "description": "Use the cx CLI for semantic code navigation before raw file reads.",
  "typescriptApiEnabled": false,
  "cliRequirements": [
    {
      "id": "cx",
      "binary": "cx",
      "required": true,
      "version": "0.7.1",
      "versionCommand": "cx --version",
      "installCommand": "cargo install cx-cli --version {{version}}"
    }
  ]
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `default_loaded` |
| Handler thread | `default_loaded` |
| Workflow task agent | `default_loaded` |

The cx extension being default-loaded means the generated actor prompt includes the loaded cx
instructions. It does not mean any additional native tool, `svvyx` namespace, or generated
TypeScript client is registered.

## CLI Requirement

`cx` is a versioned CLI requirement because the builtin instructions are vendored from
`cx-cli@0.7.1` output.

The builtin CLI requirement declaration is:

```json
{
  "id": "cx",
  "binary": "cx",
  "required": true,
  "version": "0.7.1",
  "versionCommand": "cx --version",
  "installCommand": "cargo install cx-cli --version {{version}}"
}
```

The package identity was verified from the upstream `Cargo.toml` for `ind-igo/cx`, where the package
name is `cx-cli`, version is `0.7.1`, and the binary name is `cx`.

CLI requirement behavior is defined in `docs/specs/extensions-and-tools.spec.md`. Missing or
wrong-version `cx` must not cause the prompt-only cx extension instructions to disappear from
generated actor context. `svvyx extensions build cx --json` fails if `cx` is missing or the detected
version is not exactly `0.7.1`, or if required CLI status cannot be determined. The agent may run
the concrete install command returned by `inspect` or `build` through `exec_command`, where the
normal approval and sandbox flow applies, and then rerun build.

## Instruction Source

The loaded cx instructions must be vendored from cx-owned guidance, not hand-rewritten from memory.

Primary source:

- `https://github.com/ind-igo/cx`
- `cx skill` from `cx-cli@0.7.1`

The builtin default instructions should be a vendored copy of `cx skill`, with a small `svvy`-owned
preface or appendix allowed only for product integration facts that are not part of the cx skill
itself.

The allowed `svvy` appendix is limited to:

- the extension is prompt-only and exposes no `svvy` cx tools
- agents use cx through `exec_command`
- `apply_patch` remains the editing surface
- if `cx` is missing, the wrong version, or unknown, agents should inspect the extension's CLI
  requirement and run the returned concrete install command through `exec_command` only when
  installing is appropriate for the user's request
- `execute_typescript` has no cx SDK in v1

The `svvy` appendix must not:

- add native `cx_*` tool names
- add `svvyx cx` commands
- add generated TypeScript clients
- invent cx CLI flags or behavior not present in `cx --help`, command help, or `cx skill`
- teach ad hoc `cargo install`, Homebrew, curl installers, or other installer commands beyond the
  declared `installCommand`

Updating the vendored cx instructions is a deliberate product update. The update process is:

1. Inspect the current cx-owned `cx skill` output and CLI help.
2. Inspect the currently published package identity and version.
3. Update the vendored instructions.
4. Update tests or docs that depend on the changed instruction surface.
5. Ship the resolved product wording.

`svvy` must not fetch cx instructions dynamically at runtime.

### Vendored cx Skill Text

The `cx skill` output for `cx-cli@0.7.1` is:

~~~md
# cx - Semantic Code Navigation

Prefer cx over reading files. Escalate: overview -> symbols -> definition/references -> Read tool.

## Quick reference

```
cx overview PATH                                    file or directory table of contents
cx overview DIR --full                              directory overview with ranges + signatures
cx symbols [--kind K] [--name GLOB] [--file PATH]   search symbols project-wide
cx symbols --kinds [--file PATH]                     list distinct kinds with counts
cx definition --name NAME [--from PATH] [--kind K]  get a function/type body
cx references --name NAME [--file PATH] [--context]  usages grouped by file; --context exact lines
cx lang list                                         show supported languages
cx lang add LANG [LANG...]                           install language grammars

Global: --no-tests (exclude test files/symbols), --json, --limit N, --offset N, --all
```

Aliases: `cx o`, `cx s`, `cx d`, `cx r`

Kinds: fn, struct, enum, trait, type, const, class, interface, module, event, heading

## Key patterns

- Start with `cx overview .`, drill into subdirectories - cheaper than ls + reading files
- `cx definition --name X` gives exact text for Edit tool's `old_string` without reading the whole file
- `cx references --name X` groups hits by file; add `--context` only when exact source lines are needed
- After context compression, use `cx overview` / `cx definition` to re-orient - don't re-read full files
- Check signatures for `pub`/`export` to identify public API without reading the file

## Pagination

Default limits: definition 3, symbols 100, references 50. When truncated, stderr shows:

```
cx: 3/32 definitions for "X" | --from PATH to narrow | --offset 3 for more | --all
```

`--offset N` pages forward, `--all` bypasses, `--limit N` overrides. Narrow with `--from`/`--file`/`--kind` before paging.

JSON: paginated -> `{total, offset, limit, results: [...]}`, non-paginated -> bare array.

## Missing grammars

If cx reports a missing grammar, install with `cx lang add <lang>`. Run `cx lang list` to see what's installed.
~~~

When this text is included in generated actor context, `svvy` may replace "Read tool" with
"raw file reads through `exec_command`" and "Edit tool" with "`apply_patch`" so the instruction names
match the `svvy` runtime. The command reference and usage ladder must remain cx-owned.

`cx lang add`, `cx lang remove`, and cache-management commands mutate cx-owned grammar/support
state. They are permitted ordinary `exec_command` work under the active shell approval and sandbox
policy, and they are not the cx CLI requirement install. Installing or upgrading the `cx` binary
uses the concrete install command returned by inspect/build through ordinary `exec_command`.

## cx CLI Command Surface

Agents may call these cx commands through `exec_command` when the cx extension is loaded:

```bash
cx overview PATH
cx overview DIR --full
cx symbols --kind K
cx symbols --name GLOB
cx symbols --file PATH
cx symbols --kinds
cx definition --name NAME
cx definition --name NAME --from PATH
cx definition --name NAME --kind K
cx definition --name NAME --max-lines N
cx references --name NAME
cx references --name NAME --file PATH
cx references --name NAME --context
cx lang list
cx lang add LANG [LANG...]
cx lang remove LANG [LANG...]
cx cache path
cx cache clean
```

Global options:

```bash
--root PATH
--json
--limit N
--offset N
--all
--no-tests
```

Aliases:

```bash
cx o
cx s
cx d
cx r
```

The normal `svvy` inspection ladder is:

```text
cx overview -> cx symbols -> cx definition / cx references -> exec_command with rg/sed/cat/ls/find
```

Use raw shell inspection when:

- cx does not support the language or file type
- raw text, exact surrounding context, generated files, config files, or non-code files are needed
- a command failure, missing grammar, or parse limitation makes cx insufficient
- the agent is verifying exact file content before a patch

Use `apply_patch` for edits. cx does not edit files.

## Product Boundary

cx may inspect:

- project-level semantic overviews
- file-level symbol tables
- symbol search results
- symbol definitions
- symbol references
- installed and supported language grammars
- cx cache location

cx may mutate only cx-owned local support state:

- install language grammars with `cx lang add`
- remove language grammars with `cx lang remove`
- clean the cx index cache with `cx cache clean`

cx must not inspect or mutate `svvy` product state:

- sessions
- handler threads
- workflow runs
- app panes
- Dockview layout
- generated agent context bindings
- extension usage state
- extension source or build state
- provider settings
- secrets
- app logs

cx must not mutate repository source files, git state, or workflow assets. Those operations remain
ordinary shell/git/`apply_patch`/Smithers operations according to their own extension boundaries.

## `execute_typescript`

cx has no generated TypeScript SDK in v1.

The following generated clients are explicitly not part of the intended product surface:

- `api.cx_*`
- `extensions.cx.*`

This is a deliberate simplification. A cx TypeScript SDK would reintroduce a wrapper surface around a
small CLI and raise command-fact, child-command, caching, env, and install-boundary questions that
ordinary coding-agent behavior does not need.

If a future product decision adopts a cx TypeScript client, it must be specified separately with a
concrete repeated use case, exact generated API, command-fact recording rules, and actor-specific
availability. Until then, agents use `cx` through `exec_command`.

## Testing

Required doc/extension tests:

- cx is represented as `category: "builtin"` and `interface: "instructions"`.
- cx is default-loaded for orchestrator, handler-thread, and workflow task-agent actors.
- Generated actor context includes the vendored `cx skill` guidance plus only the bounded `svvy`
  appendix.
- Generated actor context does not include native `cx_*` tool declarations.
- Generated actor context does not include `svvyx cx` guidance.
- Generated `execute_typescript` declarations do not include cx clients.
- cx declares `cx-cli@0.7.1` as a CLI requirement with binary `cx`.
- Missing cx does not remove the prompt-only cx extension from generated actor context.
- cx instructions do not contain agent-run install commands.

Optional live verification:

- install the declared cx CLI requirement when it is missing or the wrong version
- run `cx --version`
- run `cx skill`
- run `cx lang list`
- run `cx overview .`
- run `cx symbols --kinds --json`
- update this spec and the vendored instructions if cx-owned behavior changes materially

## Invariants

- cx v1 is a prompt-only builtin extension.
- cx v1 is default-loaded for all adopted actor kinds.
- cx v1 teaches direct use of the official `cx` CLI through `exec_command`.
- cx v1 does not expose native `cx_*` tools.
- cx v1 does not expose `svvyx cx`.
- cx v1 does not expose generated cx TypeScript clients.
- cx v1 does not expose an Incur wrapper to agents.
- cx v1 does not create a custom editing or writing surface.
- cx v1 does not own product navigation or product state.
- cx v1 depends on declared CLI requirement resolution for missing binaries, not
  agent-run installation instructions.
