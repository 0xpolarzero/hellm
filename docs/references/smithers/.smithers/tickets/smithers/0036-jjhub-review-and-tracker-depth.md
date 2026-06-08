# jjhub parity: review + tracker depth (landings PR review, issues comments/metadata)

Part of the jjhub parity effort. Full detail: `.smithers/plans/jjhub-parity.md`
(Phases 4–6). Issues and landings list-views are already wired to live jjhub
(seed fallback); this deepens them from list to full detail.

## Problem

Issues and landings hydrate their LISTS from jjhub, but the detail experiences
are shallow: landings have no reviews thread, inline comments, conflicts tab, or
real land queue; issues have no comments, and labels/milestones/reactions/
events/dependencies are missing entirely.

## Goal

Bring the two already-wired surfaces up to jjhub's detail depth.

## Scope

### Landings (Phase 4)
- Conversation tab: reviews list + submit (approve/request-changes/comment),
  dismiss, inline comments (path/line).
- Conflicts tab + conflict gating; per-change/per-file diff grouping (reuse
  `diff/`); Land with real queue position + task id; close/reopen; pagination.
- Fill the create form (source bookmark + change_ids). Map detail-only fields the
  list mapper currently defaults (diff/checks/reviewStatus).

### Issues (Phases 5–6)
- Comments list/add/edit/delete; assignee/label/milestone edit on an issue.
- Labels CRUD + Milestones CRUD consoles; reactions, events timeline,
  dependencies (blocked-by), pin/unpin, artifacts.

## Blocks

- Needs a reachable jjhub origin to verify detail endpoints against real data.
- Artifacts add an object-storage slice (defer if needed).

## Acceptance

- [ ] Landing detail: reviews thread + inline comments + conflicts + real Land.
- [ ] Issue detail: comments + editable assignee/label/milestone.
- [ ] Labels + milestones consoles CRUD against the backend.
- [ ] Offline keeps the seed detail, no crash.
