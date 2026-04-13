---
name: feature-poc
description: Create a single-file, executable proof of concept for a proposed feature, architecture change, state model, workflow, or runtime lifecycle. Use when the user wants a runnable POC that is easy to read with zero prior context, prefers inline types and top-down structure, minimizes abstraction and scrolling, and is intended to be reviewed and refined collaboratively after the first draft.
---

# Feature POC

## Goal

Turn a proposed piece of work into the smallest runnable proof that makes the design obvious.

Default outcome:

- one file
- executable
- easy to read top to bottom
- understandable without prior context
- structured for follow-up refinement with the user

## Repo Context

Before creating the POC, read these in order when they are relevant:

1. [docs/prd.md](../../../docs/prd.md)
2. [docs/features.ts](../../../docs/features.ts)
3. the closest spec or progress entry for the work

If the request is tightly scoped and those files do not materially affect the behavior being proved, keep additional reading minimal.

If there is an existing spec for the same work, treat the POC and spec as one artifact under active refinement:

- keep the spec in sync whenever the POC changes materially
- update the spec during refinement, not only at the end
- make the spec describe the current adopted model directly
- do not let the spec drift behind the POC

## Default Location

Unless the user asks for a different location, place the POC in:

- `docs/pocs/<topic>.poc.ts`

Keep it in a single file unless the user explicitly asks for a multi-file prototype or a single file would make the result harder to review.

## What The POC Must Prove

A valid feature POC should prove the design in code, not merely describe it.

By default, it should demonstrate:

- the main state shape or core model
- the key lifecycle or flow
- the important write operations
- the important read or selector surfaces
- persistence and reload if resume or durability are part of the design

If the proposed work is UI- or rendering-heavy rather than state-heavy, prove the same idea through the smallest runnable interactive flow.

## Authoring Rules

Optimize for first-time readability.

Prefer:

- one main state shape
- inline types near their use
- one small runtime class or a few small functions
- top-down file structure
- short comments that explain why each section exists
- one `runPoc()` entrypoint that walks the full lifecycle in order
- one direct-run block that prints the proof in the order a reviewer should read it

Avoid:

- production-grade layering
- many tiny named types that force scrolling
- version fields unless the proof truly needs them
- legacy or migration handling unless the user explicitly wants that covered
- speculative completeness
- placeholder code that does not really prove the flow
- historical or comparative framing such as "removed", "old design", "previous version", or "we changed X to Y" in the POC or spec unless the user explicitly asks for migration history
- changelog-style writing; write the current model, not the story of how it evolved

## Default File Structure

When no better structure is obvious, use this order:

1. file-level comment explaining what the POC is proving
2. one main state shape or core model
3. small helper types only when they reduce confusion
4. one tiny runtime that mutates and reads the model
5. one `runPoc()` function showing the lifecycle in order
6. one `if (import.meta.main)` block that runs the POC and prints the important outputs

## Lifecycle Expectations

The `runPoc()` flow should usually make the lifecycle obvious in order:

1. start from the pre-change or pre-structured baseline
2. enable or enter the proposed model
3. run the key work paths
4. show the projected outputs a UI or orchestrator would actually consume
5. persist and reload when durability matters

Do not hide the lifecycle behind excessive helper indirection.

## Readability Standard

Write the file so a reviewer with no prior understanding can answer:

- what exists in the model
- who owns what
- what happens first, next, and last
- what becomes durable
- what the important read surfaces are
- what is intentionally out of scope

If the reader has to jump around to understand the core idea, simplify the file.

## Collaboration Rule

Treat the first POC as a draft for discussion.

That means:

- choose clarity over cleverness
- make naming easy to react to
- leave comments where the user is likely to challenge the model
- keep the structure easy to edit during follow-up discussion
- prefer explicit tradeoffs over hiding them
- if the user refines the model, update the spec and POC together so they stay aligned
- keep both artifacts written as the current truth, not as historical commentary about previous iterations

## Output Standard

When the POC runs, print only the most useful views.

Usually print:

- initial view
- final view
- one or two key projected reads
- reloaded view when persistence matters

The output should make it obvious that the design works.

## Final Check

Before finishing, verify:

- the POC is runnable
- the POC is still a single file unless the user asked otherwise
- the lifecycle is obvious from top to bottom
- the important types are close to where they are used
- the runtime actually proves the design
- the artifact is clearly a POC, not half-hidden production code
- any related spec is in sync with the POC
- neither the POC nor the spec reads like a changelog
