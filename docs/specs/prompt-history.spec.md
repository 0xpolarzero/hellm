# Prompt History Spec

## Status

- Date: 2026-04-10
- Status: adopted UX direction for prompt history recall
- Scope of this document:
  - define the expected prompt-history behavior for the `svvy` composer
  - capture the external interaction patterns that informed the design
  - make explicit what is adopted now versus what is intentionally deferred

## Purpose

`svvy` needs prompt recall that feels natural to developers coming from shells and coding-agent CLIs.

The feature should let a user:

- recall previous sent prompts with the keyboard
- edit and resend prior prompts quickly
- preserve an unsent draft while browsing history
- reuse prompt history across multiple sessions in the same workspace

The goal is not just "add arrow key history". The goal is to make prompt recall feel unsurprising in a multiline coding composer.

## Product Fit

The PRD defines:

- workspaces as the durable local repository context
- sessions as user-facing containers within a workspace
- long-lived coding flows with safe resume and visible state

Source:

- `docs/prd.md`

### Decision

Prompt history should be treated as a workspace-level interaction affordance, not a single-session-only detail.

That means:

- sessions remain the main conversation containers
- prompt history is shared across sessions in the same workspace
- prompt history is not global across unrelated repositories by default

## Reading Rules

This document uses three labels:

- `Fact`: directly supported by a cited source
- `Decision`: adopted `svvy` behavior
- `Deferred`: intentionally not part of the first implementation

## Adopted Decisions

The adopted `svvy` direction is:

- `Up` and `Down` recall previously sent prompts
- history navigation activates only at multiline boundaries
- the composer preserves the user's unsent draft while browsing history
- history is shared across sessions within the same workspace
- history is not shared across different workspaces by default
- non-empty user prompts are recorded when the user explicitly submits them, including failed and provider-blocked attempts
- explicit history search is a separate capability and should not be overloaded onto plain arrow navigation

Nothing below should be read as leaving those points open.

## External Interaction Patterns

## Readline / Bash

### Fact

GNU Readline and Bash define:

- `previous-history`: move back through history, often bound to the up arrow key
- `next-history`: move forward through history, often bound to the down arrow key
- `end-of-history`: move to the line currently being entered
- `reverse-search-history`: `Ctrl+R`

Sources:

- [Commands For History](https://www.gnu.org/software/bash/manual/html_node/Commands-For-History.html)
- [Searching](https://www.gnu.org/software/bash/manual/html_node/Searching.html)

### Decision

`svvy` should preserve the canonical history model:

- `Up` means older entry
- `Down` means newer entry
- moving "past the newest history item" returns to the user's live draft
- `Ctrl+R` is the right future path for history search

## Claude Code

### Fact

Claude Code documents:

- `Up/Down arrows`: navigate command history and recall previous inputs
- `Ctrl+R`: reverse search command history

Claude Code also defines `--continue` as loading the most recent conversation in the current directory.

Sources:

- [Interactive mode](https://code.claude.com/docs/en/interactive-mode)
- [CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-reference)

### Decision

For `svvy`, the relevant pattern is:

- prompt recall belongs in the input surface itself
- search is separate from basic recall
- workspace or directory context is the right default boundary for persistence

The CLI `--continue` behavior is not identical to prompt history, but it supports the same higher-level product expectation: current work is naturally organized around the current project context rather than a machine-wide global stream.

## Gemini CLI

### Fact

Gemini CLI documents:

- `Up Arrow` / `Down Arrow`: navigate prompt history when the cursor is at the top or bottom of a single-line input
- sessions and history are project-specific, keyed by project root

Sources:

- [Gemini CLI keyboard shortcuts](https://geminicli.com/docs/reference/keyboard-shortcuts/)
- [Session management](https://geminicli.com/docs/cli/session-management/)

### Decision

This strongly supports the `svvy` direction:

- boundary-aware arrow navigation in the composer
- project or workspace-scoped persistence rather than global persistence

`svvy` uses a multiline composer, so the activation boundary is the start or end of the draft buffer rather than merely the first or last logical line.

## fish shell

### Fact

fish documents:

- command history is stored on disk
- `Up` and `Down` move backward and forward through history
- if the current command line is not empty when starting history search, only matching commands are shown

Source:

- [fish interactive use](https://fishshell.com/docs/current/interactive)

### Decision

The useful lesson from fish is not that plain arrow recall must do filtered search in `svvy`.

The useful lesson is:

- persistent history across sessions is expected
- search and recall are related but separable behaviors

For `svvy`, filtered search on plain arrows is not adopted in v1.

## Adopted Behavior

## History Scope

### Decision

Prompt history is scoped to a workspace.

A workspace is the effective repository root or equivalent workspace identity already used by `svvy`.

Implications:

- all sessions in the same workspace share one prompt history
- a new session in the same workspace can recall prompts sent in earlier sessions
- switching to another workspace uses a different prompt history
- there is no default machine-global prompt history across unrelated repos

## What Gets Stored

### Decision

The first implementation stores only prompts that are:

- user-authored
- explicitly submitted
- non-empty after trimming for submit validation

The stored value is the exact submitted text.

Recommended metadata:

- `text`
- `sentAt`
- `workspaceId`
- `sessionId`

### Decision

Failed sends and provider-blocked sends should still create history entries.

### Decision

The first implementation should preserve chronological history, including duplicates.

If a user sends the same prompt twice, both sends remain recallable in order.

## Arrow Key Activation Rules

### Decision

`Up` history recall activates only when all of the following are true:

- the composer has focus
- there is no active text selection
- the caret is at the first character position in the draft
- no higher-priority UI surface is consuming arrows, such as an open picker or dialog

Otherwise `Up` keeps its normal caret movement behavior.

### Decision

`Down` history recall activates only when all of the following are true:

- the composer has focus
- there is no active text selection
- the caret is at the last character position in the draft
- no higher-priority UI surface is consuming arrows

Otherwise `Down` keeps its normal caret movement behavior.

### Decision

The boundary test should be based on the absolute caret position in the text content, not on visual wrapping or logical line boundaries.

## Entering History Navigation

### Decision

When the user first enters prompt-history navigation from a live draft:

- the current draft is captured as the temporary draft snapshot
- the composer switches into history-navigation mode
- the newest stored prompt becomes the first recalled entry

This applies whether the live draft is empty or non-empty.

## Moving Through History

### Decision

While in history-navigation mode:

- `Up` moves to older entries
- `Down` moves to newer entries

### Decision

When the user moves forward past the newest stored history entry:

- history-navigation mode ends
- the preserved temporary draft is restored exactly

This is the multiline-composer equivalent of Readline's "current line being entered".

### Decision

If there is no older or newer entry in the requested direction, the composer should do nothing rather than wrap around.

## Editing Recalled Entries

### Decision

A recalled history entry becomes ordinary editable text in the composer buffer.

The user may:

- modify it
- partially replace it
- send it as a new prompt

### Decision

Edits made while viewing a recalled entry are transient unless the user sends that edited text.

Navigating away from a modified recalled entry should not mutate the stored historical entry.

## Sending While Browsing History

### Decision

If the user sends a recalled or edited recalled prompt:

- the current buffer is submitted
- on successful send, that submitted text becomes the newest history entry
- history-navigation mode ends
- the composer returns to the normal empty-draft state after send

### Decision

If send fails before the runtime accepts the prompt:

- the exact buffer should be restored
- the user's browsing state should remain recoverable rather than silently discarded

The implementation may restore the text buffer first and then either:

- return to history-navigation mode at the same entry
- or return to normal editing mode with the same text

The critical requirement is that no user-authored text is lost.

## Search

### Decision

Prompt history search is a separate feature from plain arrow recall.

The intended future binding is:

- `Ctrl+R`: reverse search through prompt history

### Deferred

The first implementation does not need:

- incremental reverse search
- fuzzy search
- prefix-filtered arrow recall
- a visible history browser UI

## Multi-Session Behavior

### Decision

Prompt history is shared across sessions in the same workspace.

This is the adopted behavior, not a possible future option.

Examples:

- a prompt sent in Session A for repo `foo/` is recallable in Session B for repo `foo/`
- a prompt sent in repo `foo/` is not recallable by default in repo `bar/`

### Decision

Session transcripts remain session-specific even though prompt history is workspace-shared.

This spec does not change transcript ownership or session semantics.

## Persistence Expectations

### Decision

Prompt history should be persisted locally so it survives app restarts.

### Decision

The persistence boundary should match workspace identity.

The exact storage backend is an implementation detail and is not specified here.

### Deferred

This spec does not define:

- retention limits
- export or import
- sync across machines
- encryption or redaction policy
- private mode

Those may be specified separately later.

## Non-Goals

This feature is not trying to:

- replace session resume with prompt recall
- merge all prompt history across all repositories by default
- overload plain `Up` and `Down` with fuzzy or semantic history search
- preserve in-progress edits to historical entries as durable state without an explicit send
- create a separate prompt-history UI before keyboard behavior is correct

## Implementation Guidance

### Decision

The implementation should be split conceptually into two layers:

- transient composer navigation state
- persistent workspace-scoped prompt history storage

The persistent store should not live only inside the current session's in-memory message list.

### Decision

The composer should receive a linear history view that is already filtered to the current workspace.

This keeps the keyboard logic simple and avoids coupling the composer to session-loading policy.

## Open Details

These points are intentionally left open:

- the exact workspace identity key
- the exact local storage format and file location
- whether duplicate compaction should ever exist as an optional setting
- whether "private" or "do not persist this prompt" modes should exist
- whether future reverse search should be inline, modal, or popover-based
