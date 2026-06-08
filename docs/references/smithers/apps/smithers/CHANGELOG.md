# Changelog — apps/smithers

## Unreleased

### Added

- **jjhub typed clients** (`src/jjhub/{repos,issues,landings,workspaces,notifications}.ts`).
  Each module exports listing helpers with cursor pagination
  (`list*` + `listAll*`), single-record accessors, mutation helpers
  (`createIssue`, `updateIssue`, `markAllNotificationsRead`), and tolerant
  parsers that skip malformed rows. Every helper throws `PlatformError`
  (carrying `status` and the jjhub `code`) on non-2xx.
- **Issues hydrateFromPlatform**: opt-in real-Plue hydration from
  `useIssuesStore.hydrateFromPlatform(owner, repo)`. A no-op when no platform
  base URL is configured, so offline/dev mode keeps the seeded backlog.
- **Worker platform user-subpath precedence** (`src/worker.ts`).
  `/api/user/{repos,readable-repos,workspaces,orgs,starred,issues,landings,
  notifications,subscriptions,following,followers,searches}` route to
  `GO_API_BASE_URL` when set, otherwise fall back to `AUTH_API_BASE_URL`
  (monolith). `/api/user` (identity singleton) and `/api/user/keys` /
  `/api/user/settings/*` keep going to auth.
- **Test seam** `setPlatformBaseUrlForTesting` so unit tests can point the
  client at a `Bun.serve` fixture without a DOM.

### Changed

- Worker dispatcher reorders so platform user-subpaths win over the auth proxy
  in the split-config case.
- Platform proxy explicitly extends to `/api/issues`, `/api/landings`,
  `/api/workspaces` (in addition to the existing repos/orgs/search/etc.).

### Remediated (review-nokimi-plue-bridge-20260607)

- **Live Plue path is no longer dormant**: `IssuesCanvas` now renders a
  repo-context selector when a platform base URL is configured; the user
  picks `owner/repo` and `selectRepoContext` → `hydrateFromPlatform` runs
  against real Plue. Without a base URL the selector is hidden and the
  seeded backlog stays put.
- **parseRepo tolerates string / UUID ids**: `Repo.id` is now `string`;
  the parser accepts number or string and normalizes via `String(id)`.
  UUID rows used to be silently dropped.
- **parseLinkCursor tolerates unquoted rel values** (`rel=next`,
  `rel="next"`). RFC 8288 permits both; some upstreams emit unquoted.
- **Helper consolidation**: `readPlatformJson` + `platformErrorFromBody`
  promoted to `platformJson.ts`. Five near-identical copies across the
  typed clients are now one shared definition; drift here used to be
  the most likely source of parser divergence.
- **Test override leaks**: `withPlatformBaseUrlForTesting(value, fn)`
  scopes the override so a thrown fixture cannot leak the global into
  the next test.
- **`hydrateFromPlatform` unit coverage** in `issuesStore.test.ts`:
  no-base-URL no-op, success → platform source, `PlatformError`,
  `AbortSignal` short-circuit, `selectRepoContext` round-trip.
- **Split-config browser e2e** (`tests/e2e/splitConfig.spec.ts`): a new
  `authFixture` distinct from `plueFixture`, each stamping a `source`
  field on its identity body so the Worker's AUTH ≠ GO routing is
  asserted end-to-end through a real browser.
- **Workspaces / notifications wiring**: docs spell out which clients
  are wired today (issues) and which are explicitly deferred
  (repos/landings/workspaces/notifications), so an "unwired client"
  isn't read as dead code.

### Verified

- `pnpm -C apps/smithers test` — 531 unit pass / 0 fail (532 incl. 1
  pre-existing skip).
- `pnpm -C apps/smithers typecheck` — clean on every file touched
  here. One pre-existing `runLogsRoute → logs/LogsCanvas` error
  survives on main; it's unrelated and not touched by this slice.
- `CI=1 pnpm -C apps/smithers exec playwright test
  tests/e2e/splitConfig.spec.ts tests/e2e/plueBridge.spec.ts
  --reporter=line --workers=1` — 7 passed.
