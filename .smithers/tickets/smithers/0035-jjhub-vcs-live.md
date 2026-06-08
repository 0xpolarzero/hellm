# jjhub parity: jj VCS live (changes / operations / stacks) + tickets

Part of the jjhub parity effort. Full detail: `.smithers/plans/jjhub-parity.md`
(Phase 3). The `vcs/` and `tickets/` surfaces exist today on seed data only.

## Problem

`vcs/` (working-tree status/staging/commit/bookmarks) and `tickets/` render
entirely from local seed data. jjhub has the full jj surface: a change list,
change detail + diff, operation log (undo history), stacks, protected bookmarks,
commit status. None of it is live, and there is no jj_vcs client yet.

## Goal

Promote the realized `vcs/` shell to a live jj surface and add the change log,
operation log, and stacks. Wire `tickets/` to real `.smithers/tickets` files.

## Scope

- New jjhub client functions for `jj_vcs.go` (list changes, change diff/files/
  conflicts, file-at-change, bookmarks CRUD, operation log) and `stacks.go`.
- OR a gateway VCS compute-node workflow for the run-context case (see
  `reference_smithers_compute_nodes`) — pick per `backendStore` mode.
- Extend `vcs/` with change-list + change-detail canvases; reuse the richer
  `diff/DiffCanvas.tsx` for change diffs.
- Add an operations-log canvas; bookmarks create/delete.
- `tickets/` reads real `.smithers/tickets` via the repo contents API.

## Blocks / open

- `reach=unknown`: the run-context vcs path depends on a gateway compute-node
  workflow actually round-tripping real `git`/`jj` status/log/diff. Validate
  before committing estimates. `vcsStore` currently posts a chat line for
  commit/push, it does not execute.

## Acceptance

- [ ] Change list + detail + per-file diff render from a real backend.
- [ ] Operation log paginates.
- [ ] Bookmarks list + create + delete.
- [ ] `tickets/` reads real `.smithers/tickets`; seed stays offline.
