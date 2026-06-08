# Onboarding

The first run. A new visitor lands on an empty app and has no idea what
Smithers is, what a workflow is, or where to start. Onboarding answers all
three by walking them through building their first workflow — and it teaches by
doing, inside the real product.

This doc is the contract. The code in `src/onboarding/` implements it.

## What the user sees

1. **The mark draws itself.** A full-screen splash plays the Smithers brand
   animation: the magnifying-glass ring strokes on, the search stem follows in
   brand green, the wordmark rises. It reads as a product opening, not a loading
   spinner. A "Get started" button is always present; the splash also advances
   on its own when the animation settles.

2. **Smithers introduces itself.** A short, guided conversation: who Smithers
   is, what a workflow is (a graph of steps — agents, checks, approvals — that
   runs durably and resumes after failure), and one question: *what do you want
   to build?* Every question carries a recommended answer, the same rule the
   grill-me interview follows. If the user is unsure, Smithers recommends a
   default workflow and explains why.

3. **You build a workflow.** From the goal, Smithers proposes a real workflow —
   a node graph rendered live in the same `WorkflowGraph` the rest of the app
   uses. The user refines it with a couple of plain-language toggles (pause for
   my approval, loop until it passes), names it, and creates it.

4. **You land in the app, ready.** Creating the workflow installs it into the
   Workflow Store and drops the user into chat with a starter prompt built from
   their own words. Onboarding records that it ran and never interrupts again.

At any point "Skip for now" ends onboarding and marks it done.

## Why an overlay, not a route

Onboarding is a one-time gate, the same shape as a toast or the control-request
dialog: chrome the shell renders over the app, not a place you navigate to. So
it is **not** a `View` and adds no route. `OnboardingGate` mounts once in
`AppShell` and renders the overlay only while onboarding is unfinished. This
keeps it out of the URL and the Back stack (a first run is not deep-linkable),
and it keeps onboarding decoupled from the routing layer — which matters because
several features share that layer.

The overlay sits above the normal shell. It does **not** render over the
`login` view: a remote-mode sign-in comes first, then onboarding runs once the
user is in the app.

## State

Two concerns, one store (`onboardingStore`), split by what persists:

| Field | Medium | Holds |
| --- | --- | --- |
| `completed` | local (persisted) | whether the first run has happened |
| `step` | ephemeral | `intro` → `welcome` → `build` → `done` |
| `draft` | ephemeral | the workflow being assembled (goal, template, toggles, name) |

`persist` keeps only `completed` (via `partialize`); the in-progress step and
draft are transient and reset on reload. The flag hydrates synchronously from
`localStorage`, so a returning user never sees a flash of the splash.

No `useState`, no `useEffect` — the project rule. The splash advances on the
animation's `animationend` (or the button), both of which call the idempotent
`enterWelcome()`. Nothing schedules a timer in a component.

## The metaworkflow: Create a Workflow

The heart of onboarding is a meta-workflow — a guided flow whose output is a
runnable workflow. It mirrors how Smithers itself works: sharpen the goal, shape
a plan, gate it, run it.

```
goal ─▶ shape ─▶ refine ─▶ name & create
```

- **goal** — "In one line, what should this workflow do?" Free text. Empty or
  "I'm not sure" is a valid answer: it selects the recommended default.

- **shape** — `classifyIntent(goal)` picks a starter template, and
  `proposeWorkflow(draft)` turns the draft into a `WorkflowSpec` (the same type
  the askme graph uses). The graph renders immediately, so the abstract word
  "workflow" becomes a concrete picture the moment the user has a goal.

  | The goal mentions… | Template | Teaches |
  | --- | --- | --- |
  | review, audit, a PR or diff | `review` | agent → merge |
  | research, investigate, compare | `research` | fan-out → synthesize |
  | a bug, something broken/failing | `debug` | compute → agent → compute |
  | build, implement, add, refactor | `implement` | agent → review |
  | *anything else, or unsure* | `research-plan-implement` (default) | the full shape: research → plan → approve → implement → review |

  The default is the richest template on purpose: it shows the most node kinds,
  so a user who doesn't know what they want still learns what a workflow can be.

- **refine** — two toggles, each mapped to one node kind so the user learns the
  vocabulary by flipping it:
  - *Pause for my approval* adds/removes an `approval` node before the work.
  - *Loop until it passes* adds/removes a loop-back edge from review to the work.

- **name & create** — the name defaults to one derived from the goal.
  "Create workflow" commits the draft: installs the matched workflow id into
  `workflowsStore`, fills the composer with `draftToStarter(draft)`, raises a
  toast, and calls `complete()`.

`createWorkflowFlow.ts` holds this as pure functions — `classifyIntent`,
`proposeWorkflow`, `draftToName`, `draftToStarter`, and the template table — so
the mapping is unit-tested without a DOM, the way `workflowFlow.ts` is.

## Offline by design

Onboarding never depends on the chat backend. The intro, the explanations, the
recommendation, and the proposed graph are all deterministic and local, so the
first run completes with no network. The streamed model is a later enrichment,
not a prerequisite; the seam for it is `onboardingScript.ts`.

## Re-running it

`onboardingStore.reset()` clears the flag and returns to `intro` — exposed
through the `/onboarding` slash command for dogfooding and e2e. Clearing the
`smithers.onboarding` localStorage key has the same effect on next load.

## Files

```
onboarding/
  onboardingStore.ts      first-run flag + step machine + draft (the contract above)
  createWorkflowFlow.ts   pure: templates, classifyIntent, proposeWorkflow, draftTo*
  onboardingScript.ts     pure: the copy — intro lines, the workflow explainer, recommend()
  OnboardingGate.tsx      mounts the overlay while !completed (mounted in AppShell)
  OnboardingOverlay.tsx   orchestrates the three phases
  SmithersIntro.tsx       the animated brand splash
  WelcomeStep.tsx         the AI intro + the goal question
  WorkflowBuilder.tsx     the live graph + refine toggles + name + create
  onboarding.css          all styling, colocated to stay out of the shared styles.css
```
