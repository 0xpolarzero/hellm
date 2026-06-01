# Deferred Follow-Ups

This file tracks audit-review decisions that we intentionally parked for later so they are not lost while the current audit discussion continues.

It is not a general backlog and it does not include source-only audit addendum notes that we have not discussed yet.

## Later After The Audit

### AUD-001 - Host Execution Sandboxing

Status: deferred.

Decision: no sandboxing for now. Treat `execute_typescript` and bash as trusted local coding-agent capabilities during the current product pass.

Later follow-up: design one shared host-execution confinement model that covers both `execute_typescript` and bash if/when `svvy` needs to treat agent code or shell commands as untrusted.

Reference: `docs/codebase-audit-issue-research.md`, AUD-001.

### AUD-019 - Ambient Agent Resources

Status: adopted for later implementation.

Decision: do not remove all native host resources outright. Behavior-changing ambient resources should be disabled by default and enabled only through explicit settings.

Later follow-up: implement the provider-neutral Ambient Agent Resources model from `docs/specs/ambient-agent-resources-baseline.spec.md`, including categories such as extensions/packages, skills, prompt templates, commands, hooks, UI resources, provider/model adapters, credentials, and execution-policy resources.

Reference: `docs/codebase-audit-issue-research.md`, AUD-019.

### Extension Secret Egress Proxy

Status: deferred.

Decision: do not require a proxy boundary for v1 extension secrets. Treat extension code as trusted not to intentionally log or exfiltrate configured secret values during the current product pass.

Later follow-up: evaluate an `iron-proxy`-style egress and credential-injection boundary so extensions can make authenticated network calls without raw secrets entering the extension process environment.

Reference: `docs/specs/extensions-and-tools.spec.md`.

## Not Decided Follow-Ups

The "Source-Only Highlights Requiring Follow-Up" section in `docs/codebase-audit-issue-research.md` is not copied here because we have not reviewed those items one by one. They are preserved in the audit document as untriaged source-audit input, not as accepted follow-up work.
