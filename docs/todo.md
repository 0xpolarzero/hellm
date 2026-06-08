# Open Follow-Ups

This file tracks accepted follow-up decisions that are not yet represented as completed product work.

It is not a general backlog and it does not include source-only audit addendum notes that we have not discussed yet.

## Later After The Audit

### AUD-001 - Host Execution Sandboxing

Status: adopted in resolved execution-policy design.

Decision: host command execution through `exec_command`, `svvyx ...` through `exec_command`,
`apply_patch`, and workflow task-agent direct tools use the Codex-like execution policy defined in
`docs/specs/extensions-and-tools.spec.md`: macOS managed sandboxing through `/usr/bin/sandbox-exec`
with vendored or ported Codex Seatbelt policy generation, default-on `networkAccess`, and approval
modes `auto-review`, `user`, and `full-access`.

Follow-up: implement the shared runtime policy and exact confinement strategy for arbitrary
`execute_typescript` snippets that do not go through generated loaded-extension clients. The
top-level `execute_typescript` action itself must use the same approval-boundary path as other
approval-gated native actions before execution.

Reference: `docs/codebase-audit-issue-research.md`, AUD-001.

### AUD-019 - Ambient Agent Resources

Status: pending.

Decision: do not remove all native host resources outright. Behavior-changing ambient resources should be disabled by default and enabled only through explicit settings.

Follow-up: implement the provider-neutral Ambient Agent Resources model from `docs/specs/ambient-agent-resources-baseline.spec.md`, including categories such as extensions/packages, skills, prompt templates, commands, hooks, UI resources, provider/model adapters, credentials, and execution-policy resources.

Reference: `docs/codebase-audit-issue-research.md`, AUD-019.

### Extension Secret Egress Proxy

Status: pending.

Decision: v1 extension secrets use trusted extension invocation without a proxy boundary.

Follow-up: evaluate an `iron-proxy`-style egress and credential-injection boundary so extensions can make authenticated network calls without raw secrets entering the extension process environment.

Reference: `docs/specs/extensions-and-tools.spec.md`.

### Extension-Scoped Command Visualization

Status: pending.

Decision: authoritative action capture comes from svvy-owned tool and command boundaries. Arbitrary shell commands and arbitrary TypeScript side effects remain opaque except for process lifecycle, output, approvals, running-session state, and observed workspace changes after the fact.

Follow-up: improve UI visualization with Codex-style best-effort command parsing. Builtin extensions can contribute internal visualization rules for the commands or CLIs they own, such as cx, git, GitHub CLI, Smithers, Extension Managing, TinyFish CLI commands, and other non-arbitrary command families. Enable an extension's visualization contributions only when that extension is enabled for the session, and present parsed shell actions as display hints rather than syscall-level truth. Git and GitHub milestones must come from actual command records, parsed `git` or `gh` command output, GitHub API output, and observed workspace state; do not introduce hidden assistant-authored Markdown directives for staging, commits, pushes, or pull request creation.

Reference: `docs/specs/extensions-and-tools.spec.md`.

## Not Decided Follow-Ups

The "Source-Only Highlights Requiring Follow-Up" section in `docs/codebase-audit-issue-research.md` is not copied here because we have not reviewed those items one by one. They are preserved in the audit document as untriaged source-audit input, not as accepted follow-up work.
