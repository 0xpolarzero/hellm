# Git Extension Spec

## Status

- Date: 2026-06-05
- Status: accepted extension index; loaded instruction text remains in `docs/specs/extensions-and-tools.spec.md`
- Scope:
  - define Git as a builtin prompt-only extension
  - keep `git` usage on ordinary shell commands through the Shell extension

## Extension Record

```json
{
  "id": "git",
  "category": "builtin",
  "interface": "instructions",
  "title": "Git",
  "description": "Conservative Git CLI guidance for repository inspection, staging, commits, branches, and diffs.",
  "typescriptApiEnabled": false,
  "cliRequirements": [
    {
      "id": "git",
      "binary": "git",
      "required": true,
      "versionCommand": "git --version"
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

## Tool Surface

Git exposes no native `git_*` tools, no `svvyx git`, and no generated `execute_typescript` facade.

Agents use:

```bash
git ...
```

through `exec_command`. Git intentionally has no pinned version because the builtin guidance is
generic Git behavior rather than a version-specific generated instruction bundle.

Detailed behavior, loaded instructions, and package ownership are defined across:

- `docs/specs/extensions-and-tools.spec.md`, "Builtin Extensions"
- `docs/specs/package-architecture/extensions.spec.md`, "Prompt-Only CLI Guidance"
