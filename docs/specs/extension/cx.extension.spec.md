# cx Extension Spec

## Status

- Date: 2026-06-05
- Status: authoritative product spec
- Scope:
  - define the builtin cx extension boundary
  - define cx as prompt-only direct CLI guidance
  - define the exact cx CLI commands agents may use as shell commands
  - define the versioned cx CLI requirement used by build/readiness checks
  - define the generated upstream cx skill instruction source and script contract
  - reject native `cx_*` tools, `svvyx cx`, and generated cx TypeScript clients for v1

This document is the source of truth for the resolved cx extension direction.

Related specs:

- `docs/specs/extensions-and-tools.spec.md` defines the general extension architecture, prompt-only
  extensions, CLI requirements, generated instruction files, shell policy, generated agent context,
  and `execute_typescript`.
- `docs/specs/extension/extension_managing.extension.spec.md` defines how builtin extension
  instructions are inspected, overlaid, reset, and built when extension content is editable.

## Product Intent

`svvy` should give coding agents a semantic code-navigation ladder without creating another
product-owned editing, filesystem, shell, or TypeScript SDK surface.

The resolved cx v1 model is:

- `cx` is a builtin extension.
- `cx` uses `interface: "instructions"`.
- `cx` is prompt-only.
- `cx` is loaded by default for all adopted actor kinds.
- `cx` teaches the official `cx` CLI by loading the generated upstream `cx skill` instructions.
- `svvy` does not expose `cx_overview`, `cx_symbols`, `cx_definition`, `cx_references`,
  `cx_lang_list`, `cx_lang_add`, `cx_lang_remove`, `cx_cache_path`, or `cx_cache_clean` as native
  model tools.
- `svvy` does not expose `svvyx cx`.
- `svvy` does not expose `api.cx_*`, `extensions.cx.*`, or any generated cx TypeScript client in
  v1.
- `svvy` does not wrap cx in an Incur CLI or expose Incur to agents for cx.

These product-boundary statements are specification and test requirements. They are not themselves
agent-facing cx instruction text. The agent-facing generated cx skill file teaches official cx CLI
usage only and does not list product-boundary inventory or implementation-only surfaces.

cx already has a small agent-facing CLI and an agent-facing `cx skill` instruction. The product
boundary is to load that upstream skill as a generated instruction file and let the normal shell
runtime execute `cx` commands when an agent chooses to use cx.

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
      "package": "cx-cli",
      "binary": "cx",
      "required": true,
      "version": "0.7.1",
      "versionCommand": "cx --version",
      "installCommand": "cargo install cx-cli --version {{version}}"
    }
  ],
  "generatedInstructions": [
    {
      "output": "instructions/full/010-cx-skill.generated.md",
      "script": "scripts/generate-cx-skill.ts",
      "versionCliRequirementId": "cx"
    }
  ]
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `loaded` |
| Handler thread | `loaded` |
| Workflow task agent | `loaded` |

The cx extension being loaded by default means the generated actor prompt includes the loaded cx
instructions. It does not mean any additional native tool, `svvyx` namespace, or generated
TypeScript client is registered.

## CLI Requirement

`cx` is a versioned CLI requirement because the builtin cx instructions are generated from the
versioned `cx-cli` package artifact.

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
unknown `cx` must not cause the prompt-only cx extension instructions to disappear from generated
actor context. When `cx` is installed, build detects the global PATH binary version and passes that
detected version to the generated instruction script. A detected version different from the manifest
default is still available and is shown as updateable UI state rather than as a hard build blocker.
`svvyx extensions build cx --json` fails if `cx` is missing or required CLI status cannot be
determined. The agent may run the concrete install or update command returned by `inspect` or
`build` through the normal shell command path only when installing or upgrading the cx binary is
appropriate for the user's request, then rerun build so the detected version state is refreshed from
the actual binary.

The generated instruction script does not need the `cx` binary to be installed. It reads the
versioned package artifact directly for the version supplied by Extension Managing. If `cx` is
installed, that supplied version is the detected CLI version. If `cx` is missing, the supplied
version remains the manifest default for install guidance and UI state, but build fails before
running the generator because required CLI readiness is missing.

## Instruction Files

cx full instructions are an ordered file set under `instructions/full/`.

The generated upstream skill file is:

```text
instructions/full/010-cx-skill.generated.md
```

It is generated by:

```text
scripts/generate-cx-skill.ts
```

The generated file must contain only the upstream cx skill Markdown extracted from the exact
versioned `cx-cli` package artifact. It must not append, prepend, or interleave `svvy`-owned product
boundary notes.

If `svvy` later needs cx-specific local runtime guidance, that guidance must be placed in a separate
hand-authored instruction file that sorts after the generated upstream skill, for example:

```text
instructions/full/020-cx-svvy-usage.md
```

No such hand-authored cx usage file is required by this spec. Hand-authored cx guidance, when
present, must be positive, actionable runtime guidance only.

## Upstream Skill Source

The authoritative source for the generated cx skill is the version-pinned crates.io package
artifact, not the GitHub default branch, a mutable README, the locally installed `cx` binary, or a
hand-copied Markdown block.

For `cx-cli@0.7.1`, the source artifact is:

```text
https://static.crates.io/crates/cx-cli/cx-cli-0.7.1.crate
```

The generated Markdown is extracted from:

```text
cx-cli-0.7.1/src/skill.md
```

The crates.io sparse-index entry for the current version is read from:

```text
https://index.crates.io/cx/-c/cx-cli
```

For `0.7.1`, the sparse-index entry must contain:

```json
{
  "name": "cx-cli",
  "vers": "0.7.1",
  "cksum": "956f63dd7eba71378917dc82932e2e9106dd12d7a4bdd3244b507c11b5954cf1",
  "yanked": false
}
```

The sparse-index JSON contains additional dependency fields. The generator should validate the
fields above and may ignore unrelated fields.

The package artifact should also be checked for these identity markers:

- `Cargo.toml` package name is `cx-cli`
- `Cargo.toml` package version equals the requested exact version
- `Cargo.toml` has a binary named `cx`
- `src/main.rs` implements the `skill` command by printing the embedded `skill.md` content

A pinned GitHub commit for `ind-igo/cx` may be used only as a secondary cross-check. It is not the
primary generated-instruction source because the released crates.io artifact is the package actually
identified by the CLI requirement.

## Generated Script Contract

The cx generated instruction script must be TypeScript:

```text
scripts/generate-cx-skill.ts
```

Extension build invokes it through the shared generated-instruction command shape:

```text
bun scripts/generate-cx-skill.ts --output <absolute-output-path> --version <exact-version>
```

For the current cx extension, build resolves the `--version` value from:

```json
"versionCliRequirementId": "cx"
```

That id refers to the cx CLI requirement declaration whose `version` is currently `0.7.1`.

The script must:

1. Require `--output`.
2. Require `--version`.
3. Reject non-exact version values such as ranges, tags, `latest`, empty strings, or versions with
   leading comparison operators.
4. Read the crates.io sparse-index entry for `cx-cli`.
5. Select the entry whose `vers` exactly equals `--version`.
6. Fail if no matching sparse-index entry exists.
7. Fail if the matching entry is yanked.
8. Download `https://static.crates.io/crates/cx-cli/cx-cli-<version>.crate`.
9. Verify the downloaded artifact SHA-256 exactly matches the sparse-index `cksum`.
10. Extract `cx-cli-<version>/Cargo.toml`, `cx-cli-<version>/src/main.rs`, and
    `cx-cli-<version>/src/skill.md`.
11. Validate the package identity markers listed in this spec.
12. Validate that `src/skill.md` is non-empty UTF-8 Markdown.
13. Validate that `src/skill.md` contains the required upstream content markers listed below.
14. Write the extracted `src/skill.md` bytes to `--output`.

The script must not:

- run `cargo install`
- run the local `cx` binary
- run `cx skill` as its primary source
- read from the GitHub default branch as its primary source
- fetch the latest package version
- ignore the supplied `--version` in favor of probing a local binary
- normalize upstream wording, punctuation, headings, or arrows
- replace `Read tool`
- replace `Edit tool`
- append `svvy` product-boundary notes
- mention `svvyx cx`, native `cx_*` tools, generated cx clients, or `prompt-only` in the generated
  Markdown
- write outside `--output`

The script should write to a temporary file in the destination directory and then atomically replace
`--output` after all validation passes. If any step fails, the script must exit non-zero and must not
leave a partially generated Markdown file at `--output`.

Stdout is diagnostic build output only. The generated Markdown content must be written to
`--output`.

The script needs network access unless the `.crate` artifact and sparse-index entry are vendored or
provided through a future packaged-app cache. It must not fetch cx instructions dynamically during
actor prompt generation or at runtime. Fetching is a generated-instruction build step only.

## Generated Output Validation

For `cx-cli@0.7.1`, the generated output must contain these upstream markers:

```text
# cx
Semantic Code Navigation
Quick reference
cx overview
cx symbols
cx definition
cx references
cx lang list
cx lang add
Aliases
Kinds
Key patterns
Pagination
Missing grammars
```

For `cx-cli@0.7.1`, the generated output must preserve upstream generic tool wording:

```text
Read tool
Edit tool
```

Those phrases are cx-owned generic coding-agent wording. cx does not provide tools with those names.
The generated upstream skill file must not rewrite them to `svvy`-specific tool names. If local
runtime clarification becomes necessary, it belongs in a separate hand-authored cx instruction file.

For `cx-cli@0.7.1`, the generated output must not contain `svvy` product-boundary prose, including:

```text
svvyx cx
cx_overview
extensions.cx
api.cx
prompt-only
```

## Updating cx Instructions

Updating the generated cx instructions is a deliberate product update. The update process is:

1. Change the cx CLI requirement version in this spec and the builtin cx manifest source.
2. Keep `versionCliRequirementId: "cx"` so the generator receives that exact declared version.
3. Run `scripts/generate-cx-skill.ts` for the new exact version.
4. Verify the sparse-index checksum, yanked status, package identity, and extracted `src/skill.md`
   markers.
5. Inspect the generated diff as upstream cx-owned instruction changes.
6. Update tests that depend on changed cx command syntax or skill wording.
7. Update this spec only for product-contract changes, not merely to paste the generated Markdown.

Do not update generated cx instructions from:

- `latest`
- the GitHub default branch
- a copied chat answer
- a local `cx` binary whose version was not provided by the manifest's exact CLI requirement
- a rewritten or summarized version of the upstream skill

## cx CLI Command Surface

The cx extension permits these official cx CLI commands as shell commands when the cx extension is
loaded:

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

`cx lang add`, `cx lang remove`, and cache-management commands mutate cx-owned grammar/support
state. They are permitted ordinary shell-command work under the active shell approval and sandbox
policy, and they are not the cx CLI requirement install. Installing or upgrading the `cx` binary
uses the concrete install command returned by inspect/build through the normal shell command path.

cx does not edit files. File edits remain ordinary editing work through the direct editing surface
available to the actor.

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
- app panes
- Dockview layout
- generated agent context bindings
- extension usage state
- extension source or build state
- provider settings
- secrets
- app logs

cx must not mutate repository source files, git state, or workflow assets. Those operations remain
ordinary shell, git, editing, or Smithers operations according to their own extension boundaries.

This product-boundary section is normative implementation guidance and test guidance. Its negative
statements must not be copied into the generated upstream cx skill file. They should appear in
agent-facing cx instruction files only when there is a concrete, user-relevant behavior to prevent.

## `execute_typescript`

cx has no generated TypeScript SDK in v1.

The following generated clients are explicitly not part of the intended product surface:

- `api.cx_*`
- `extensions.cx.*`

cx has no generated TypeScript SDK in v1 because the product surface is prompt-only official CLI
guidance.

If a future product decision adopts a cx TypeScript client, it must be specified separately with a
concrete repeated use case, exact generated API, command-fact recording rules, and actor-specific
availability. Until then, cx remains direct CLI guidance.

## Testing

Required doc/extension tests:

- cx is represented as `category: "builtin"` and `interface: "instructions"`.
- cx is loaded by default for orchestrator, handler-thread, and workflow task-agent actors.
- cx declares `cx-cli@0.7.1` as a CLI requirement with binary `cx`.
- cx declares `instructions/full/010-cx-skill.generated.md` as a generated instruction file.
- cx declares `scripts/generate-cx-skill.ts` as the generated instruction script.
- cx generated instruction declaration uses `versionCliRequirementId: "cx"`.
- `scripts/generate-cx-skill.ts` is invoked as
  `bun <script.ts> --output <absolute-output-path> --version 0.7.1`.
- the generated cx skill file is read-only to agents and regenerated by extension build.
- the generated cx skill file is byte-for-byte identical to `cx-cli-0.7.1/src/skill.md` extracted
  from the verified crates.io artifact.
- the generated cx skill file contains no `svvy` appendix, preface, product-boundary note, or
  generated-client guidance.
- the generated cx skill file preserves upstream `Read tool` and `Edit tool` wording.
- the generated cx skill file does not contain `svvyx cx`, `cx_overview`, `extensions.cx`,
  `api.cx`, or `prompt-only`.
- Generated actor context includes the generated upstream cx skill guidance when cx is loaded.
- Generated actor context does not include native `cx_*` tool declarations.
- Generated actor context does not include `svvyx cx` guidance.
- Generated `execute_typescript` declarations do not include cx clients.
- Missing cx does not remove the prompt-only cx extension from generated actor context.
- cx instructions do not contain agent-facing commands to install the `cx` binary. The only binary
  install command is the concrete CLI requirement install command returned by inspect/build.

Optional live verification:

- install the declared cx CLI requirement when it is missing or the wrong version
- run `cx --version`
- run `cx skill`
- compare `cx skill` output with the generated upstream skill file
- run `cx lang list`
- run `cx overview .`
- run `cx symbols --kinds --json`
- update this spec and the generated instructions if cx-owned behavior changes materially

## Invariants

- cx v1 is a prompt-only builtin extension.
- cx v1 is loaded by default for all adopted actor kinds.
- cx v1 loads the official upstream `cx skill` content from a versioned crates.io artifact.
- cx v1 uses `scripts/generate-cx-skill.ts` to generate
  `instructions/full/010-cx-skill.generated.md`.
- cx v1 does not rewrite upstream `Read tool` or `Edit tool` wording in the generated skill file.
- cx v1 keeps `svvy` product-boundary notes out of the generated upstream skill file.
- cx v1 does not expose native `cx_*` tools.
- cx v1 does not expose `svvyx cx`.
- cx v1 does not expose generated cx TypeScript clients.
- cx v1 does not expose an Incur wrapper to agents.
- cx v1 does not create a custom editing or writing surface.
- cx v1 does not own product navigation or product state.
- cx v1 depends on declared CLI requirement resolution for missing binaries, not agent-facing
  binary installation instructions.
