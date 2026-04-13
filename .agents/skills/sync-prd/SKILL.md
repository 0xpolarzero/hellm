---
name: sync-prd
description: Manually sync a fully resolved note from docs/draft-notes.md into docs/prd.md and docs/progress.md, then remove the absorbed draft note and commit the docs change. Use only when explicitly invoking this workflow.
disable-model-invocation: true
argument-hint: optional note topic to prioritize first
---

# Sync PRD

## Trigger

Use this skill only via `/skill:sync-prd`.

Do not auto-load it from note mentions, PRD mentions, or generic docs-edit requests.

## Goal

Turn rough notes in [docs/draft-notes.md](../../../docs/draft-notes.md) into durable product docs, one resolved point at a time.

## Required Reads

Before doing any real work, read these files in this order:

1. [docs/prd.md](../../../docs/prd.md)
2. [docs/features.ts](../../../docs/features.ts)
3. [docs/progress.md](../../../docs/progress.md)
4. [docs/draft-notes.md](../../../docs/draft-notes.md)
5. [../sbe/SKILL.md](../sbe/SKILL.md)

If the selected note touches a specific subsystem or prior spec, read only the additional local docs needed to remove ambiguity.

## Working Rules

- Treat each top-level bullet in `docs/draft-notes.md` as one draft point unless the structure clearly implies separate independent points.
- Re-rank the remaining draft points before each round.
- Do not edit `docs/prd.md`, `docs/progress.md`, or `docs/features.ts` until the current point is fully specified with no material ambiguity.
- Finish one resolved draft point per commit.
- Keep working through the queue until `docs/draft-notes.md` is empty or the user stops.
- Respect a dirty worktree. Never stage or revert unrelated user changes.

## Order The Queue

Choose the next point in this priority order unless the user explicitly overrides it:

1. Foundational decisions that constrain later product behavior or documentation.
2. Points that unblock or reshape other draft points.
3. Points that map cleanly onto existing PRD and progress sections.
4. Smaller points that can land cleanly without hidden dependencies.
5. Inspiration, research backlog, or later-stage ideas.

If the user passed an argument when invoking the skill, use it as a tie-breaker or as an explicit priority if it does not create a dependency problem.

When you report the queue, keep it short: name the current point, mention why it comes next, then move into clarification.

## Clarification Loop

For the chosen point:

1. Extract the unresolved product decisions.
2. Ask only the minimum questions needed to make the point spec-ready.
3. Use the `sbe` skill's style for those questions: short, plain, direct, and low-jargon.
4. Prefer one compact batch of questions over a long interview.
5. If the answer is still ambiguous, ask the next narrow follow-up instead of guessing.
6. Separate hard requirements from nice-to-haves and later ideas.
7. Stop and keep asking questions until all material ambiguity is gone.

Material ambiguity means any missing answer that would change:

- where the decision belongs in the PRD
- user-visible behavior or constraints
- scope, priority, or ship phase
- the concrete checklist items needed in `docs/progress.md`

## Integrating A Resolved Point

Once the point is fully specified:

1. Update [docs/prd.md](../../../docs/prd.md) in the exact section that owns the behavior. Do not append loose notes at the bottom.
2. Update [docs/progress.md](../../../docs/progress.md) in the closest roadmap section with small, landable checklist items.
3. Update [docs/features.ts](../../../docs/features.ts) if the resolved point adds, removes, renames, splits, merges, or materially changes a product feature or its source spec mapping.
4. Remove only the resolved note from [docs/draft-notes.md](../../../docs/draft-notes.md).
5. If one top-level note actually contains multiple independent ideas, split it cleanly and delete only the part that was fully absorbed.
6. Re-read the edited sections to make sure `prd.md`, `progress.md`, and `features.ts` agree.

If the target docs already contain overlapping unrelated edits you cannot safely reconcile, stop and ask the user before changing them.

## Commit Workflow

After the docs for the current point are updated:

1. Review the diff for only the files touched by this point.
2. Stage only those files.
3. Commit with a Conventional Commit message.

Default commit format:

```text
docs: sync prd for <short-topic>
```

After the commit lands, re-read `docs/draft-notes.md`, re-rank the remaining points, and move to the next one unless the user stops.
