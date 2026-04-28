# Context Budget Observability

`svvy` shows active model-context pressure for every pi-backed agent surface that can carry autonomous work.

## Scope

Context budget applies to:

- orchestrator surfaces
- handler-thread surfaces
- workflow task-agent attempts

Workflow-run inspector surfaces are not independent model contexts. They show workflow state and link to task-agent attempts, but they do not get their own context budget unless a selected task-agent attempt is opened as its own surface.

## Metric

The context-budget metric is:

```text
latest prompt input tokens / active model max context tokens
```

The numerator is the latest assistant response's prompt input token count for the surface. Historical cumulative token usage is not used for the budget, because the budget describes the current model window, not lifetime spend.

The denominator is the active model's declared context window. If either side is unknown, the UI omits the meter instead of guessing.

## Thresholds

- neutral: below 40%
- orange: 40% through 59%
- red: 60% and above

Orange means the surface is in the conservative context-degradation warning band. Red means summarization, handoff, compaction, or a fresh surface should be considered.

These thresholds are product policy. They are not a claim that every model fails at an exact percentage.

Public long-context research identifies position-dependent degradation and weaker use of information in the middle of long inputs, but it does not establish a universal context-fill percentage where all models become unreliable. `svvy` uses the 40% and 60% thresholds as conservative operating bands for coding-agent work.

## Surfaces

Focused orchestrator and handler-thread panes show a full-width context bar beneath the composer text input.

Unfocused open orchestrator and handler-thread panes show a compact bottom-edge context indicator.

Workflow task-agent panes show the task attempt's context budget in the task-agent surface summary when the attempt has recorded usage and model-window data.

## Persistence

Interactive orchestrator and handler-thread panes derive the meter from live pi surface messages and the active model.

Workflow task-agent attempts persist context-budget source values in the attempt metadata so completed task-agent surfaces can be inspected later without replaying a pi session.
