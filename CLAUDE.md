# CLAUDE.md

Guidance for Claude Code (and any AI agent) working in this repository.

## Branching & commits

- **Always work directly on `main`.** Do not create feature branches unless the
  user *explicitly* asks you to. Commit and push to `main`.
- **Atomic commits.** One logical change per commit — a feature and its test can
  go together, but unrelated changes get separate commits. Never bundle
  unrelated work into one commit.
- **Emoji + Conventional Commits.** Every commit message starts with an emoji,
  then a conventional-commit subject. Examples:
  - `✨ feat(cli): add \`smithers ui\` command`
  - `🐛 fix(studio): live-run events for detached runs`
  - `✅ test(server): gateway shared-DB run attribution`
  - `♻️ refactor(runs): batch live-event frame application`
  - `🔒 fix(gateway): reject cross-origin PTY upgrades`
  - `📝 docs: …`  ·  `🔧 chore: …`  ·  `🙈 chore: gitignore …`
- End commit messages with the `Co-Authored-By` trailer when authored by an agent.
- Push to `origin` (`github.com/smithersai/smithers`) `main` unless told otherwise.

## Verify before you push

`main` is shared. Before committing/pushing, keep the gate green:
- `pnpm typecheck` (per package / app)
- relevant `bun test` suites (packages use `bun test`; studio unit = `pnpm -C apps/smithers-studio-2 test:unit`)
- `pnpm -C apps/smithers-studio-2 exec playwright test` for studio e2e (real-backend, no mocks)

## No mocks

Product code and e2e tests must use real backends/data — no `mockGateway`, no
`page.route`/`routeWebSocket` data fabrication, no hardcoded/fallback stand-ins.
Fixtures may be real servers seeded with deterministic data; deliberate
failure-injection against a real fault path is acceptable. See
`apps/smithers-studio-2` for the real-gateway + real-workspace-API dev wiring
(`bun dev` boots real backends; the e2e fixtures are opt-in via
`SMITHERS_DEV_USE_FIXTURES=1`).
