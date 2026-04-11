- don't expose usual model and reasoning selectors; rather select model+reasoning for various agents (orchestrator, explorer, implementer, reviewer)
- add a few ways to create a chat with normal chat (orchestrator is best model) or quick chat (uses codex-spark or like quick and dumb model)

- context progress bar at the bottom of a session that goes orange as we approach and red as we enter dumb zone
- ideally we have good enough observability and UX to show this intuitively for subagents and agents that are part of smithers workflows as well

- @ to mention files/folders

- ability to split panes easily to follow multiple sessions (by dragging or click split); in addition to highlighted active threads in the nav would show a small icon that indicates where this tab is (left, right, top, bottom, top-left, etc; probably 4 is enough to start); currently focused one would have a clear highlight
- folders to sort sessions

- small model to name session on first message

- bigger lift but would be nice to have a dedicated workflows panel where we can visualize workflows in a graph-like interface + modify them + create workflows with AI with dedicated smithers skills and reference workflows pulled into context

- needs to be very clear that the slate subagents (episodes) thing is always valid, e.g. when creating smithers workflow it spans subagent with smithers “skill” (roughly skill, a ton of excellent workflow examples); we always load such context only inside dedicated subagent for which we can be looser on context; orchestrator only has the system prompt and knows about workflows; kinda the skill premise but we never bloat orchestrator with that
