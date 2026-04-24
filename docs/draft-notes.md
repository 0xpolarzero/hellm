- semantic diffs and merge for LLM to handle that + semantic diff viewer for reviewing:
  - https://github.com/Ataraxy-Labs/sem
  - https://github.com/Ataraxy-Labs/weave
  - https://github.com/Ataraxy-Labs/inspect
  - this can provide inspiration: https://ataraxy-labs.github.io/quiver/

- SBE button on a response or SBE mode?
  - on a question can when clicked shrink the response and show the sbe one on the right with no brain icon; this way we can always accordion back to normal answer

- research exactly what comes out from using pi (from what we're using);
  - make sure we read AGENTS.md/CLAUDE.md/etc from repo, root
  - make sure we read stuff in .agents/, etc?

- figure out reliable diff tracking for both the full session and individual threads; flat changed-file lists are not enough, so we need the right snapshot/checkpoint model and likely git-backed diffing semantics

- nice moat but need to nail it:
  - Project CI as a dedicated check lane for every session
  - basically same as github workflows on push except it's smithers workflows
  - likely needs a CI onboarding flow for a new workspace where the AI guides the user through setting up the workspace's CI workflow
  - that onboarding should end with a reusable workflow configuration for that workspace rather than a one-off conversation artifact
  - the execution model should stay the same as everything else: it runs on a thread through a workflow, not through a separate CI engine
  - the difference should mostly be UI and automation: easier setup, better default triggers, and more purpose-built CI displays
  - need to figure out when it's sensible to run so it doesn't bloat the machine; in a vm it would solve it but the (remote) vm is something we need to figure out separately
  - should support both automatic post-work runs and manual runs from a clearer UX surface

- use sandboxing separate from environment 
  - https://x.com/nicoalbanese10/status/2043745569278251112
  - keep the initial `execute_typescript` implementation unsandboxed; sandboxing should be a later hardening layer around the same `execute_typescript` and `api.*` contract, not a different execution model
  - https://github.com/vercel-labs/open-agents

- integration with jjhub/codeplane would make sense, for instance:
  - every time a piece of work in a session is done and orchestrator considers we run CI workflow, it takes a jj snapshot and executes the CI on jjhub/codeplane
  - we don't git commit anymore (or maybe git mode/automatic—jj—mode) where orchestrator decides when to snapshot and push to run ci in cloud

- need to figure out a way to nail observability, as in having a good idea of what is happening inside a session with a super high-level overview; both for what handler threads and workflow runs are active, what context made it into which worker, and what is the overall status
  - maybe a good starting point is to run a small model alongside the orchestrator visiting the transcript/session state at frequent intervals and appending a one-sentence high-level overview
  - show list of files read and websites visited for a session; basically everything that made it into the context

- write javascript tools api in Effect internally

- use jj instead of git inside api.*

- handler-thread context mode needs an explicit design pass:
  - maybe a handler thread can be spawned either with fresh context (only the orchestrator handoff) or full context (a short-lived fork of the current session context/history)
  - this might be useful when a worker needs broader discussion history or shared assumptions instead of a tightly scoped handoff
  - need to decide whether this is actually worth the extra context cost and ambiguity
  - if we keep it, the orchestrator needs a clear policy for when to choose fresh-context versus full-context delegation

- self-improving worker recovery idea:
  - if the orchestrator judges an episode as suspicious, low-confidence, inconsistent, or otherwise weird, it could proactively spawn a reviewer workflow
  - that reviewer would inspect the prior worker's transcript/artifacts/outputs, explain what likely went wrong, and suggest escalation to the user if it judges it is/might be an upstream issue
  - this could become a useful recovery pattern instead of treating every bad worker result as a dead end; basically agents handle suspected bugs -> suggesting an issue to open on github

- workflow-category-specific UI:
  - some workflow categories may justify specialized UI treatment instead of a generic workflow card
  - Project CI is the obvious first example because build/test/lint state often wants purpose-built display and progress semantics

- cron job on a repo that pools for updates on selected dependencies with a short summary so we can update adap
  - especially docs/references/ so we can notice if they changed something we borrowed to something better or added a useful feature

- context usage per turn: nice UI thing to get a rough idea of how much context was used in each turn both agent and user

- /btw similar to claude code, e.g. select some agent text and quick quote and ask a question on a disposable short session (but maybe it can persist on the ui tho)

- snitch (TBD); this is one of the best features, but it makes sense to wait for the main product to be working before getting attention
  - small model running at all time alongisde your sessions, focused purely on productivity stuff
  - meaning roughly what you do when you finish a session or during a session (hey write that in AGENTS.md) or more broadly any suggestions that can help
  - this is separate but maybe not that much separate (?) from the small model running alongside a workflow to give frequent high-level summaries of progress
  - basically it has a session alongside every session, and it is focused purely on watching you discuss with your agent, and runs after an entire turn (user + agent) to figure out if it could help with anything, notice something redundant, weird, maybe even more broadly help with phrasing or understand stuff idk
  - it could have its own AGENTS.md, even tho it would for instance help maintain main AGENTS.md and docs/instructions, but it would also have its own AGENTS.md with instructions, maybe its memory, basically its own docs surface only reachable by itself and hidden from other agents
  - maybe it can be the one to decide when to run CI during agent sessions, this kind of stuff
  - this helps agents in sessions focus purely on product and not in anything-harness, so you have clear separation of concerns, and snitch suggesting stuff so you don't have to think too much about this either
  - including maybe having it help on a specific set of surfaces, e.g. its notes, todos, this kind of more user-facing stuff?

- a benefit of our api inside execute_typescript is that we can add hooks and programatically enforce rules, which will automatically run and return back diagnostics/output to the agent, without expanding conceptual surface for the agent to remember to use special tools or whatever
  - e.g. typecheck on editing workflows (writeFile/writeJson inside .svvy/workflows/)
  - e.g. run CI on git commit/push
