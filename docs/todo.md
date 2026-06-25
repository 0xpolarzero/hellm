# Product Follow-Ups

This file tracks unresolved product follow-ups that are not yet adopted into the PRD, feature
inventory, or active specs.

It is not a general backlog and it is not an authoritative product spec. A follow-up becomes product
surface only after `docs/prd.md`, `docs/features.ts`, and the owning spec define the resolved
behavior.

## Extension Secret Egress Proxy

Status: open follow-up, not adopted v1 product scope.

Current v1 boundary: extension secrets use trusted invocation-local injection as specified in
`docs/prd.md` and `docs/specs/extensions-and-tools.spec.md`.

Question: whether a later extension-authenticated network boundary should require an
`iron-proxy`-style egress and credential-injection boundary so raw secrets do not enter extension
process environments.

Reference: `docs/specs/extensions-and-tools.spec.md`.

## Extension-Scoped Command Visualization

Status: open follow-up, not adopted v1 product scope.

Current v1 boundary: authoritative action capture comes from svvy-owned tool and command
boundaries. Arbitrary shell commands and arbitrary TypeScript side effects remain opaque except for
process lifecycle, output, approvals, running-session state, and observed workspace changes after
the fact.

Question: whether the UI should add Codex-style best-effort command parsing. Builtin
extensions can contribute internal visualization rules for the commands or CLIs they own, such as
cx, git, GitHub CLI, Smithers, Extension Managing, TinyFish CLI commands, and other non-arbitrary
command families. Enable an extension's visualization contributions only when that extension is
enabled for the session, and present parsed shell actions as display hints rather than syscall-level
truth. Git and GitHub milestones must come from actual command records, parsed `git` or `gh`
command output, GitHub API output, and observed workspace state; do not introduce hidden
assistant-authored Markdown directives for staging, commits, pushes, or pull request creation.

Reference: `docs/specs/extensions-and-tools.spec.md`.
