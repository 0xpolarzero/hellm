Status: exploratory scratchpad. This file is not a current product spec, progress tracker, or
package-ownership source. Current behavior is defined by `docs/prd.md`, `docs/features.ts`, and
`docs/specs/**`.

- semantic diffs and merge for LLM to handle that + semantic diff viewer for reviewing:
  - https://github.com/Ataraxy-Labs/sem
  - https://github.com/Ataraxy-Labs/weave
  - https://github.com/Ataraxy-Labs/inspect
  - this can provide inspiration: https://ataraxy-labs.github.io/quiver/

- SBE button on a response or SBE mode?
  - on a question can when clicked shrink the response and show the sbe one on the right with no brain icon; this way we can always accordion back to normal answer

- research exactly what comes out from using pi (from what we're using);
  - make sure discovered AGENTS.md/CLAUDE.md/etc are represented as read-only external_instruction extension records
  - make sure we read stuff in .agents/, etc?

- figure out reliable diff tracking for both the full session and individual threads; flat changed-file lists are not enough, so we need the right snapshot/checkpoint model and likely git-backed diffing semantics

- future quality-check ideas:
  - out of current product scope unless adopted in `docs/features.ts`
  - must use handler-thread/direct-tool execution, ordinary command facts, and current Workflows
    source-library boundaries rather than a separate Project CI lane or workflow-specific renderer

- use sandboxing separate from environment
  - https://x.com/nicoalbanese10/status/2043745569278251112
  - route parent `execute_typescript` through the same approval and sandbox classification path as
    other approval-boundary commands before snippet execution
  - generated loaded-extension facade calls inside `execute_typescript` still record child command
    facts and enforce extension readiness, env, redaction, and failure semantics
  - https://github.com/vercel-labs/open-agents

- jjhub/codeplane CI orchestration is not adopted product scope. Any future cloud CI or VCS
  automation surface must be promoted into `docs/prd.md`, `docs/features.ts`,
  `docs/progress.md`, and an owning spec before implementation.

- need to figure out a way to nail observability, as in having a good idea of what is happening inside a session with a super high-level overview; both for what handler threads and workflow runs are active, what context made it into which worker, and what is the overall status
  - maybe a good starting point is to run a small model alongside the orchestrator visiting the transcript/session state at frequent intervals and appending a one-sentence high-level overview
  - show list of files read and websites visited for a session; basically everything that made it into the context
  - everything that made it into context should be on the side and appear at each message so scrolling can dynamically add each context item in a sticky way

- If a future VCS `svvyx` extension is adopted, specify its concrete loaded TypeScript facade
  separately; Git remains prompt-only in v1.

- Handler threads use `history: "isolated"` by default: the child receives only the explicit
  orchestrator handoff, referenced artifacts, and generated extension context. `history: "forked"`
  is an explicit request for a short-lived copy of the current session history when the orchestrator
  can name the product reason for broader context.

- self-improving worker recovery idea:
  - if the orchestrator judges an episode as suspicious, low-confidence, inconsistent, or otherwise weird, it could proactively spawn a reviewer handler thread
  - that reviewer would inspect the prior worker's transcript/artifacts/outputs, explain what likely went wrong, and suggest escalation to the user if it judges it is/might be an upstream issue
  - this could become a useful recovery pattern instead of treating every bad worker result as a dead end; basically agents handle suspected bugs -> suggesting an issue to open on github

- workflow status exploration:
  - any future specialized display must still project ordinary command facts, artifacts, app logs,
    and state read models rather than introducing a workflow-specific renderer

- cron job on a repo that pools for updates on selected dependencies with a short summary so we can update adap
  - especially docs/references/ so we can notice if they changed something we borrowed to something better or added a useful feature

- context usage per turn: nice UI thing to get a rough idea of how much context was used in each turn both agent and user

- ship windows/tabs:
  - workspace tabs are authoritative product scope in `docs/prd.md`, `docs/features.ts`, and
    `docs/specs/default-workspace-and-open-workspace.spec.md`; future multi-window behavior must be
    promoted into authoritative docs before implementation
  - the app should support multiple tabs, with windows only as a future unadopted candidate
  - each tab can open a workspace, including opening the same workspace in multiple tabs
  - open workspace tabs are visual selectors; duplicate tabs for the same canonical cwd share the
    same acquired runtime-owned workspace scope under the single app-owned `ManagedRuntime`, plus
    durable layout slots keyed by `(workspaceId, layoutId)`; each tab stores only its selected active
    layout id
  - this should make it convenient to move between several repos while also supporting multiple focused layouts over one repo
  - include useful keyboard shortcuts for tab navigation, tab creation, tab closing, and moving tabs between positions or windows if windows land

- /btw similar to claude code, e.g. select some agent text and quick quote and ask a question on a disposable short session (but maybe it can persist on the ui tho)

- snitch (TBD); this is one of the best features, but it makes sense to wait for the main product to be working before getting attention
  - small model running at all time alongisde your sessions, focused purely on productivity stuff
  - meaning roughly what you do when you finish a session or during a session (hey write that in AGENTS.md) or more broadly any suggestions that can help
  - this is separate but maybe not that much separate (?) from a small model running alongside a handler thread or workflow task-agent attempt surface to give frequent high-level summaries of progress
  - basically it has a session alongside every session, and it is focused purely on watching you discuss with your agent, and runs after an entire turn (user + agent) to figure out if it could help with anything, notice something redundant, weird, maybe even more broadly help with phrasing or understand stuff idk
  - it could have explicit extension/default-profile config or visible external_instruction records
    for its own guidance, even if it also helps maintain main AGENTS.md and docs/instructions
  - maybe it can be the one to decide when to run CI during agent sessions, this kind of stuff
  - this helps agents in sessions focus purely on product and not in anything-harness, so you have clear separation of concerns, and snitch suggesting stuff so you don't have to think too much about this either
  - including maybe having it help on a specific set of surfaces, e.g. its notes, todos, this kind of more user-facing stuff?

- a benefit of runtime/extension-owned command-policy contributions is that generated context and
  ambient-resource policy can enforce rules and return diagnostics/output to the agent without
  expanding conceptual surface
  - e.g. typecheck on edits to workspace `.smithers/` source or app-global Workflows source under `~/.config/svvy/workflows/`
  - candidate command-policy or CI ideas require promotion into PRD/features/progress and an owning
    spec before implementation

- "qa" step similar to ci; have an agent look at changes, figure out if there is any new/changed UI surface, test the flow itself by driving the app, take screenshots, examine the screenshots to make sure everything works and displays as expected, and return a structured output

- have agents be able to query other sessions, and discuss with them; probably just a tool that lets the agent, after it retrieved the target session, create a short-lived (or not) fork and ask it stuff
  - in our context it might just be creating a new thread from a fork of the target session and be the one talking to it

- something important to think of and consider seriously is a "design" and "drive" modes (probably there are better names to better frame it), which decide how much the orchestrator delegates to agents
  - "design" mode is the current one where orchestrator is very eager to delegate to handlers and keep only a high-level knowledge and discussions in its own context; it delegates all work and more importantly all planning to the dedicated handlers; in this case it would be better suited for high-level product work that need a very fine-grained context
  - "drive" mode might be better suited for heavily coding; orchestrator would always figure out a plan for a task before handing off work to the handler with the suggested plan/prompt; and then it would receive the handoff episode from the handler which lets it know how it went according to the plan; this way orchestrator has extensive knowledge of the plan for each task, so less product manager and more lead engineer (or whatever comparison makes sense)
  - "drive" mode might be more interesting because it makes sense for orchestrator to have a good idea of the plans for each task and be able to compound such decisions with better knowledge of what's happening under the hood (inside threads); it is more involved in the product; this also might make more sense context-management-wise because you want to leverage the discussion we're having with the orchestrator into its context for forming plans; question is what is the best balance, or in which cases each is the better balance, which kinda is what we need to nail:
    - orchestrator has full context of the discussion and previous plans/thread results when making up a new plan and gives precise tasks to handlers (drive)
    - or orchestrator is focused on high-level design and keeps implementation/details isolated from its context, with more freedom for each handler to tinker (design)
    - counter-intuitive because of bad naming, but "design" probably needs more work for better results (more need to steer handlers instead of steering orchestrator "once" and let it compound) but better upside because of more fine-grained orchestrator pollution

- saved messages; for messages that are frequently sent you can just save them and then have a picker + autocomplete proposition; avoids storing everything in AGENTS.md when something can be specific for one task that is often asked
  - that's actually commands/snippets

- we need first-class support for cross-session access, as in I have 5 agents working and I can open a new one and ask "who did x change" and it's easy for it to figure out

- use codex automatic review as default instead of full approvals

- have a main pain to see current active sessions as graph or tree, with title + first message and maybe ever-updating short overview of what's happening. It should show all sessions that have been active up to x minutes ago, with unread, wait and all kind of state shown. Show as graph for orchestrator sessions -> handler threads -> command, artifact, episode, and Smithers-observed facts
  - need to nail session visualization i.e. a convenient and intuitive way to recognize session, e.g. colors, size on (i) size of first user message (ii) context used/left (iii) complexity or kind of task (iv) tags for regognizable words in the message
  - maybe have naming agent have context on all these sessions to be able to name them/update caption based on overall context
  - opportunity to nail the file viewer as well by showing a graph-kind view with functions and stuff in relation to each other
  - filesystem as infinite canvas as well where you see all files being edited, by which session, direct view of where the attention of an agent is, highlight and attention brought to user, etc
  - can either hide older sessions or find a way to collapse them, as well as anything actually that can be expanded/collapsed into just a small rectangle of the orchestrator session

- review mode for plan and code: see plannotator.ai
  - can do convenient stuff such as click "review" on a agent message, which creates an artifact for that response that can be reviewed with comments, etc, then sent back
  - "enter review" mode where you select a chat, then do the review on the diff, comments, on code and files, etc, then send will send review to the selected (or new) chat
  - in chat anyway we want an easy way to select and "add to chat" like codex except that it adds an actual mention in the composer and we should be able to quote files and code diff as well

- https://github.com/wevm/curl.md can help for fetching pages in token-optimized markdown

- queue backlog; any item can be put in backlog and send button has a neighbor something like send to backlog (which would be command + enter)
  - backlog is like the queue except it doesn't get sent, it just stays there until it is deleted or promoted to the queue (which if there is no queue will send immediately)
  - can be useful when you have multiple questions you want to ask or multiple things to do but for each you want to discuss, you just put them in the backlog, it shows below the queue, and when one item has been discussed and is all good you can push them to the queue

- "life" pane is not adopted product scope. It requires promotion into PRD/features/progress and an
  owning spec before implementation.
  - dual code code/life
  - has a distinct set of "Agents" because it's too vastly different on extensions selection and default agent and stuff
  - otherwise extensions are shared
  - maybe workflows is distinct as well because very different use cases?
  - otherwise pretty much same usage: main orchestrator can take any input ("entry"), dispatch to a thread with correct extensions, e.g. calendar extension for calendar stuff, thread handler will do the thing, can use workflows if needed, and hand back to orchestrator; which can also take multiple entries at the same time it's built-in that this works; maybe orchestrator notifies user with a tool, maybe it's programmatic; we can have an infinite orchestrator session possibly? "dream"/consolidate every day into its own markdown file
