# GitHub Extension Spec

## Status

- Date: 2026-06-05
- Status: accepted builtin prompt-only extension; loaded instruction source is editable MDX under
  the builtin extension source root
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

GitHub exposes no native `github_*` tools, no `svvyx github`, and no generated
`execute_typescript` facade.

Agents use:

```bash
gh ...
```

through `exec_command`. GitHub intentionally has no pinned `gh` version because the builtin
guidance is generic GitHub CLI behavior rather than a version-specific generated instruction bundle.

Detailed behavior, loaded instructions, and package ownership are defined across:

- `docs/specs/extensions-and-tools.spec.md`, "Builtin Extensions"
- `docs/specs/package-architecture/extensions.spec.md`, "Prompt-Only CLI Guidance"
