# AGENTS

- Read `docs/prd.md` before doing any work.
- This repo exists to turn pi coding agent into a Slate-like orchestrated coding agent and TUI.
- Use `docs/references/pi-mono` as the default local reference when reasoning about pi code, APIs, architecture, or behavior.
- Use `docs/references/smithers` as the default local reference when reasoning about Smithers code, APIs, architecture, or behavior.
- Prefer these local references over memory or vague external summaries when questions involve these tools or libraries.
- Keep one main orchestrator responsible for strategy, integration, and final decisions.
- Use subagents heavily for bounded, independent work; default to delegating concrete side tasks when they can run in parallel or reduce main-thread load.
- Use subagents as short-lived general workers, not persistent role-based agents.
- Give each subagent one bounded action sequence with clear inputs and a clear completion boundary.
- Have subagents return durable outcomes, not just chat summaries: conclusions, artifacts, verification, and unresolved issues.
- Reuse subagent outputs as inputs to later work instead of passing full histories around.
- Decompose work adaptively; avoid rigid task trees, stale plans, and message-only handoffs.
- Parallelize only independent workstreams, then reconcile their results in the main thread.
- Use Conventional Commits.
- Treat explicit public Slate facts and PRD inferences separately.
- Do not treat Smithers source as evidence of Slate internals; keep public Slate facts, PRD inferences, and Smithers-derived ideas clearly separated.
- Update `docs/prd.md` whenever architecture, scope, or priorities change materially.
