# GitHub Extension Spec

## Status

- Date: 2026-06-03
- Status: accepted extension index; loaded instruction text remains in `docs/specs/extensions-and-tools.spec.md`
- Scope:
  - define GitHub as a builtin prompt-only extension
  - keep GitHub work on ordinary `gh` CLI commands through the Shell extension

## Extension Record

```json
{
  "id": "github",
  "category": "builtin",
  "interface": "instructions",
  "title": "GitHub",
  "description": "Conservative GitHub CLI guidance for issues, pull requests, reviews, Actions, publishing, and wrap-up.",
  "typescriptApiEnabled": false
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `default_loaded` |
| Handler thread | `default_loaded` |
| Workflow task agent | `available` |

## Tool Surface

GitHub exposes no native `github_*` tools, no `svvyx github`, and no generated TypeScript client.

Agents use:

```bash
gh ...
```

through `exec_command`.

Current detailed behavior and loaded instructions are defined in
`docs/specs/extensions-and-tools.spec.md`, "GitHub Extension".
