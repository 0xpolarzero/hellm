# Git Extension Spec

## Status

- Date: 2026-06-03
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

Git exposes no native `git_*` tools, no `svvyx git`, and no generated TypeScript client.

Agents use:

```bash
git ...
```

through `exec_command`.

Current detailed behavior and loaded instructions are defined in
`docs/specs/extensions-and-tools.spec.md`, "Git Extension".
