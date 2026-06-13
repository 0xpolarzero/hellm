# GitHub Extension Spec

## Status

- Date: 2026-06-05
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
  "typescriptApiEnabled": false,
  "cliRequirements": [
    {
      "id": "git",
      "binary": "git",
      "required": true,
      "versionCommand": "git --version"
    },
    {
      "id": "gh",
      "binary": "gh",
      "required": true,
      "versionCommand": "gh --version"
    }
  ]
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `loaded` |
| Handler thread | `loaded` |
| Workflow task agent | `available` |

## Tool Surface

GitHub exposes no native `github_*` tools, no `svvyx github`, and no generated TypeScript client.

Agents use:

```bash
gh ...
```

through `exec_command`. GitHub intentionally has no pinned `gh` version in v1 because the builtin
guidance is generic GitHub CLI behavior rather than a version-specific generated instruction bundle.

Current detailed behavior and loaded instructions are defined in
`docs/specs/extensions-and-tools.spec.md`, "GitHub Extension".
