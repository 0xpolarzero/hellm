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

- figure out reliable diff tracking for both the full session and individual threads; `changedFiles` is not enough, so we need the right snapshot/checkpoint model and likely git-backed diffing semantics

- nice moat but need to nail it:
  - CI as a verification check on every session
  - basically same as github workflows on push except it's smithers workflows
  - need to figure out when it's sensible to run so it doesn't bloat the machine; in a vm it would solve it but the (remote) vm is something we need to figure out separately; or manual runs? kinda defeats the purpose
  - do we onboard? like special session to figure out CI where AI guides you through?

- use sandboxing separate from environment 
  - https://x.com/nicoalbanese10/status/2043745569278251112

- integration with jjhub/codeplane would make sense, for instance:
  - every time a piece of work in a session is done and orchestrator considers we run CI workflow, it takes a jj snapshot and executes the CI on jjhub/codeplane
  - we don't git commit anymore (or maybe git mode/automatic—jj—mode) where orchestrator decides when to snapshot and push to run ci in cloud

- show list of files read and websites visited for a session; basically everything that made it into the context
