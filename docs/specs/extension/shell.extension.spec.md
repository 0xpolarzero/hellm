# Shell Extension Spec

## Status

- Date: 2026-06-03
- Status: accepted extension index; detailed execution policy remains in `docs/specs/extensions-and-tools.spec.md`
- Scope:
  - define the builtin native-tool extension that exposes `exec_command` and `write_stdin`
  - point to the current canonical `exec_command` and `write_stdin` contracts

## Extension Record

```json
{
  "id": "shell",
  "category": "builtin",
  "interface": "native_tool",
  "title": "Shell",
  "description": "Codex-like shell command execution and long-running command continuation.",
  "typescriptApiEnabled": false
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `default_loaded` |
| Handler thread | `default_loaded` |
| Workflow task agent | `default_loaded` |

## Tool Surface

The Shell extension exposes exactly:

```ts
exec_command(input)
write_stdin(input)
```

Current detailed behavior is defined in:

- `docs/specs/extensions-and-tools.spec.md`, "Shell And Patch Work"
- `docs/specs/extensions-and-tools.spec.md`, "`exec_command` Source And Lifecycle"
- `docs/specs/extensions-and-tools.spec.md`, "`write_stdin`"
- `docs/specs/extensions-and-tools.spec.md`, "Execution Policy"
- `docs/specs/live-tool-projection.spec.md`, "Command Execution Projection"

## Shell Loaded Instruction Files

The builtin Shell extension has two full instruction source files. These files are ordered by
filename under `instructions/full/`:

```text
010-shell.md
020-incur-cli-usage.md
```

The generated loaded instruction for Shell is the concatenation of those files. This split keeps
generic command execution separate from generic Incur-backed `svvyx` CLI usage.

### `010-shell.md`

This file owns generic `exec_command` and `write_stdin` guidance. Its canonical content is:

````md
# Shell

Use `exec_command` to run shell commands. Use `write_stdin` only to continue an `exec_command`
session that returned a `session_id`.

For repository inspection, prefer `rg` for text search and `rg --files` for filename search. Use
ordinary shell tools such as `sed`, `cat`, `ls`, `find`, `git show`, `nl`, and `wc` for file
inspection. Set the `workdir` field on `exec_command` instead of relying on `cd`.
````

### `020-incur-cli-usage.md`

This file owns generic usage of Incur-backed `svvyx` extension CLIs through `exec_command`.
Extension-specific instructions still own their domain command names and examples. Its canonical
content is:

````md
# Incur CLI Usage

## svvyx Extension CLIs

`svvyx` is a real app-owned CLI backed by Incur. Loaded `svvyx` extensions are ordinary shell
commands from the agent's perspective. Run them with `exec_command`:

```ts
exec_command({
  cmd: "svvyx <extension-id> <command> ...",
  workdir: "/path/to/workspace"
})
```

Agent Shell usage of `svvyx ...` happens strictly through `exec_command`. There is no parent
process command-family dispatch, parent-owned Shell shortcut, or second command model.

Use the specific loaded extension instructions for domain command names and examples. Use this
generic guidance for common Incur CLI behavior.

## Discover Commands

Use `--help` for human-readable command help:

```sh
svvyx <extension-id> --help
svvyx <extension-id> <command> --help
```

Use `--llms` for agent-readable command documentation:

```sh
svvyx <extension-id> --llms
```

It outputs Markdown skill-style documentation by default:

```md
# tool install

Install a package

## Arguments

| Name      | Type     | Required | Description             |
| --------- | -------- | -------- | ----------------------- |
| `package` | `string` | no       | Package name to install |

## Options

| Flag        | Type      | Default | Description            |
| ----------- | --------- | ------- | ---------------------- |
| `--saveDev` | `boolean` |         | Save as dev dependency |
| `--global`  | `boolean` |         | Install globally       |
```

Use `--llms --format json` for a machine-readable command manifest:

```sh
svvyx <extension-id> --llms --format json
```

```json
{
  "version": "incur.v1",
  "commands": [
    {
      "name": "install",
      "description": "Install a package",
      "schema": {
        "args": { "type": "object", "properties": { "package": { "type": "string" } } },
        "options": { "type": "object", "properties": { "saveDev": { "type": "boolean" } } },
        "output": { "type": "object", "properties": { "added": { "type": "number" } } }
      }
    }
  ]
}
```

Use `--schema` to print the JSON Schema for a specific command's arguments, environment variables,
options, and output:

```sh
svvyx <extension-id> <command> --schema
# -> args:
# ->   type: object
# ->   properties:
# ->     package:
# ->       type: string
# -> options:
# ->   type: object
# ->   properties:
# ->     saveDev:
# ->       type: boolean
```

Use `--schema --format json` for machine-readable schema output.

## Arguments And Options

Arguments are positional and options are named flags.

```sh
svvyx <extension-id> clone owner/repo main
#                          ^^^^^^^^^^ ^^^^
#                          repo       branch
```

Supported option parsing:

- `--flag value` and `--flag=value`
- `-f value` short aliases when the command defines an alias
- `--verbose` boolean flags (`true`) and `--no-verbose` (`false`)
- repeated array options such as `--label bug --label feature`
- automatic type coercion from strings to numbers and booleans
- defaults and optionality from the command schema

Example:

```sh
svvyx <extension-id> list -s closed -l 10
```

## Output

Every command returns data. Incur wraps it in a structured envelope and serializes to the requested
format.

Control format with `--format <fmt>` or `--json`:

| Flag            | Format   | Description                                  |
| --------------- | -------- | -------------------------------------------- |
| _(default)_     | TOON     | Token-efficient, about 40% fewer tokens than JSON |
| `--format json` | JSON     | `JSON.parse()`-safe                          |
| `--format yaml` | YAML     | Human-readable                               |
| `--format md`   | Markdown | Tables for docs/issues                       |

When you need to parse output reliably in the agent, prefer `--json`.

With `--full-output`, the full envelope is emitted:

```sh
svvyx <extension-id> info express --full-output
```

```text
ok: true
data:
  name: express
  version: 4.21.2
meta:
  command: info
  duration: 12ms
```

Without `--full-output`, only `data` is emitted. On errors, only the `error` block is emitted.

Use `--filter-output` to prune command output to specific keys. It supports dot notation for nested
access, array slices with `[start,end]`, and comma-separated paths.

```sh
svvyx <extension-id> users --filter-output users.name
# -> [3]: Alice,Bob,Carol

svvyx <extension-id> users --filter-output users[0,2].name
# -> users[2]{name}:
# ->   Alice
# ->   Bob
```

Use `--token-count`, `--token-limit`, and `--token-offset` to manage large outputs. Tokens are
estimated using LLM tokenization rules.

```sh
svvyx <extension-id> users --token-count
# -> 42

svvyx <extension-id> users --token-limit 20

svvyx <extension-id> users --token-offset 20 --token-limit 20
```

With `--full-output`, truncated output includes `meta.nextOffset` for programmatic pagination.

Read CTAs in success or error envelopes as suggested next commands. They are suggestions, not
automatic actions; decide whether they fit the user's goal before running them.

Incur adapts output based on whether stdout is a TTY:

| Scenario              | TTY (human)             | Non-TTY (agent/pipe) |
| --------------------- | ----------------------- | -------------------- |
| Command output        | Formatted data only     | TOON envelope        |
| Errors                | Human-readable message  | Error envelope       |
| `--help`              | Pretty help text        | Same                 |
| `--json` / `--format` | Overrides to structured | Same                 |

## Built-In Flags

| Flag             | Description                                 |
| ---------------- | ------------------------------------------- |
| `--help`, `-h`   | Show help for the CLI or a specific command |
| `--version`      | Print CLI version                           |
| `--llms`         | Output agent-readable command manifest      |
| `--json`         | Shorthand for `--format json`               |
| `--format <fmt>` | Output format: `toon`, `json`, `yaml`, `md` |
| `--full-output`  | Include full envelope (`ok`, `data`, `meta`) |

Do not use or document Incur MCP registration, HTTP serving, `cli.fetch`, Skills installation, or
CLI authoring from this Shell instruction. Extension CLI authoring belongs to Extension Managing.
````

## Notes

- `svvyx ...`, `git ...`, `gh ...`, `cx ...`, and `tinyfish ...` are ordinary shell commands when
  their corresponding instruction extensions tell an actor to use them.
- Shell does not own file editing. File edits belong to the Apply Patch extension.
- Shell does not own extension lifecycle, Git semantics, GitHub semantics, Web semantics, or workflow
  semantics.
