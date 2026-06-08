# jjhub parity: repos list + dashboard + source browser

Part of the jjhub parity effort. Full detail: `.smithers/plans/jjhub-parity.md`
(Phase 2). The jjhub client `jjhub/repos.ts` already exists.

## Problem

The new UI has no repositories surface at all: no repo list, no repo
dashboard/overview, no source-tree browser, no file viewer, no create-repo. This
is the front door of code hosting and the entry point for every repo-scoped
surface.

## Goal

Browse and create repositories; read the source tree and file contents at a ref.

## Scope

- New domain `repos/`: `repos.ts`, `ReposCard.tsx` (repo picker), `reposStore.ts`,
  `RepoDashboardCanvas.tsx`, `SourceBrowserCanvas.tsx`, `NewRepositoryCard.tsx`,
  `runRepoRoute.tsx`, `reposDomain.test.ts`.
- Wire `reposStore` to `jjhub/repos.ts` (list user repos, get repo, contents at
  ref, refs); the dashboard reuses existing run/approval/issue/landing cards for
  recent activity (no 25-tab dashboard — explicit anti-goal).
- Source browser: a canvas with a ref `<select>`; selecting a file swaps to a
  file-content view (base64 decode).
- Add `repo`/`source` surface kinds + route patterns + `CardView` cases.

## Blocks / sequencing

- Depends on the owner/repo route vocabulary (0031).
- Needs a reachable jjhub origin to verify against real data (no dev backend yet).

## Acceptance

- [ ] List the signed-in user's repos; create a repo.
- [ ] Repo dashboard shows stat tiles + clone URL + recent activity cards.
- [ ] Browse the source tree at a ref and view file contents.
- [ ] Offline/dev keeps a seed or empty state, no crash.
