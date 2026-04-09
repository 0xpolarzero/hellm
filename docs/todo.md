# TODO Drafts

This file is a parking lot for draft ideas, references, and possible features we may want to add to the PRD or implement later.

Items here are intentionally provisional. They are not committed product requirements. Once we decide to adopt something, it should be promoted into `docs/prd.md` and, if it changes the real product surface, reflected in `docs/features.ts`.

## Candidate Workflow Hooks

- Related precedent: [claude-md-compiler](https://github.com/AbdelStark/claude-md-compiler) compiles structured repo workflow policy into versioned artifacts and enforcement hooks. That is directionally close to what we may want for repo-local `hellm` workflow hooks.
- We could add two workflow hook features that are well documented so they are easy to add to a project with the help of the agent, where you could declare:
  - a validation step that is part of a Smithers workflow and gets injected at the end of every workflow run; ideally this would also support a prompt explaining what to do when validation fails
  - a preflight step that can do anything, for instance aggregate context; it could also work dynamically with variables, scripts, and prompting, and this step would be injected at the beginning of every workflow and into the context of the first orchestrator agent
- This makes a lot of sense because we use workflows for anything that writes to the repo, so effectively any task that does repo modification, heavy work, or other consequential execution could have preflight and validation baked in.
- These hooks could live in a repo-local `.hellm/` config folder.

## Execute Typescript / Code Mode Implementation

- Implement the adopted `execute_typescript` architecture specified in `docs/execute-typescript-spec.md`.
- Ship the TanStack-style tool contract first:
  - `execute_typescript({ typescriptCode })`
  - structured `{ success, result, logs, error }` output
- Ship QuickJS as the initial runtime.
- Generate flat `external_*` type stubs and prompt context for the selected host tools.
- Add the first host tool set for:
  - repo and filesystem operations
  - local git read and metadata operations
  - verification operations
  - artifact writing
- Wire code mode into:
  - the direct path
  - Smithers-backed delegated work
- Capture code-mode events and traces into episodes and artifacts.
- Keep sandbox work explicitly out of scope until we have practical implementation experience.
