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
