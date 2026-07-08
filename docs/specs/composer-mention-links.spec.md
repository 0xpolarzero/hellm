# Composer Mention Links Spec

## Scope

This document defines `@` file and folder mentions as a composer path-link convenience, not as
prompt-side context attachments.

It defines composer behavior, transcript behavior, path opening, and product requirements for
composer mention links. Persistence contracts for metadata live in `@svvy/core`/`@svvy/state`;
`@svvy/runtime` owns submitted-message materialization and `@svvy/pi-adapter` owns final pi
content-block conversion.

## Purpose

`svvy` needs a fast way for users to point at workspace files and folders without typing fragile paths by hand.

The feature should let a user:

- type `@` in the composer and autocomplete workspace files and folders
- select a target and insert it as normal editable `@path` text
- send the message with the mentioned path preserved as normal user-visible text
- see the sent mention rendered in the transcript as a clickable workspace path link

The goal is path-entry ergonomics, not automatic context loading.

## Product Fit

The PRD defines `svvy` as a coding app where the agent works inside real repositories through visible orchestrator and handler-thread surfaces.

The existing execution model already gives agents ordinary file inspection through Shell
`exec_command`, prompt-only `cx` guidance when loaded, and file edits through `apply_patch`.
Mentions should complement that model by making paths easier for the user to enter, while leaving
file-reading behavior to the agent's ordinary tool use.

Sources:

- `docs/prd.md`
- `docs/features.ts`
- `docs/optimizations.md`

## Reading Rules

This document uses three labels:

- `Fact`: directly supported by a cited source
- `Decision`: adopted `svvy` behavior
- `Out of scope`: unsupported by this spec

## Adopted Decisions

The adopted `svvy` direction is:

- `@` mentions are composer UI shortcuts for inserting workspace path links.
- Mentions support files and folders.
- Selecting an `@` result inserts normal editable `@path` text into the textarea. It does not create an attachment chip.
- Paperclip picker selections, dropped files, and pasted files create removable attachment chips above the composer. They do not mutate textarea text.
- Paperclip picker selections, dropped files, and pasted files submit typed attachment metadata
  through the runtime message facade while creating removable renderer-visible chips above the
  composer. `@svvy/state` persists submitted-message attachment metadata for composer and
  transcript rendering. `@svvy/runtime` and `@svvy/pi-adapter` decide model-facing delivery,
  including path metadata and image content blocks.
- When model metadata does not list image input, the composer keeps the chip visible and warns that
  the provider may ignore or reject the image attachment.
- Sent mentions render in the conversation as actionable workspace path links.
- The agent-facing message remains ordinary user text containing the path.
- Mentions do not inject file contents into the prompt.
- Mentions do not inject folder contents, folder summaries, or symbolic context-target blocks into the prompt.
- Mentions do not create a separate agent context model.
- Mentions are not used as proof that the agent read a file.
- Read provenance should come from the files the agent actually reads through Shell, `cx`, or other
  tool calls during its turn.
- Workspace path discovery for autocomplete should be indexed or cached; the renderer must not scan the workspace tree on every keypress.
- Transcript links must perform a real path action. Existing files should reveal in the OS file browser, existing folders should open, and missing paths should render as unavailable links. A dead anchor or no-op click is not complete.

Nothing below should be read as leaving those points open.

## Non-Goals

Section 13 must not ship:

- automatic file-content inclusion for mentioned files
- recursive folder expansion
- prompt-body context attachments derived from mentions
- a `contextTargets` prompt execution contract
- folder condensation or folder summary generation
- hidden agent instructions that force the agent to read mentioned files
- special orchestrator or handler-thread behavior for mentioned paths
- context budget accounting based on mentions

Those require separate product specs.

## External Interaction Patterns

## Claude Code

### Fact

Claude Code documents `@` references for files and directories. It describes single-file references, directory references, and multiple file references in one message.

Claude Code's documented behavior includes:

- `@path` as a fast way to reference files or directories
- directory references that provide a directory listing
- tips that file paths can be relative or absolute

Sources:

- [Claude Code common workflows](https://code.claude.com/docs/en/common-workflows)
- [Give Claude context: CLAUDE.md and better prompts](https://support.claude.com/en/articles/14553240-give-claude-context-claude-md-and-better-prompts)

### Decision

`svvy` adopts the user-facing ergonomics of `@path` but not Claude Code's automatic context-loading semantics for this feature.

For `svvy`, a mention means:

- the user selected a path accurately
- the message contains that path
- the transcript can render it as a link

It does not mean:

- the path has been read
- the contents have been included
- the prompt builder should expand anything

## Cursor

### Fact

Cursor documents file and folder references in AI input boxes, file search after typing `@`, path previews for disambiguation, drag-and-drop file context, and folder navigation.

Cursor also documents optional full-folder-content behavior and automatic condensation for large files and folders.

Sources:

- [Cursor @Files & Folders](https://docs.cursor.com/context/%40-symbols/%40-folders)
- [Cursor @Files](https://docs.cursor.com/context/%40-symbols/%40-files)

### Decision

`svvy` should adopt the picker ergonomics:

- searchable files and folders
- clear path disambiguation for duplicate basenames
- folder/file visual distinction

`svvy` should not adopt full-folder-content behavior in section 13.

## VS Code Copilot

### Fact

VS Code Copilot documents workspace context mechanisms such as semantic search, text search, grep, file search, usages, directory structure, symbols, selected text, conversation history, and manual context references.

It also documents that semantic search requires an index and that workspace indexing skips irrelevant files such as some temporary outputs and binary files.

Source:

- [VS Code Copilot workspace context](https://code.visualstudio.com/docs/copilot/reference/workspace-context)

### Decision

`svvy` should keep path mention autocomplete and agent context retrieval as separate concerns.

The composer picker needs a fast workspace path index. The agent still decides what to inspect using normal tools after reading the user's message.

## UX Contract

## Triggering

### Decision

The composer opens the mention picker when:

- the user types `@` at a token boundary
- the caret remains inside the active mention query
- no higher-priority composer UI is active

The picker should close when:

- the user presses `Escape`
- the user sends the message
- the active query is deleted
- the caret moves outside the active query
- the user clicks outside the picker

Prompt-history arrow navigation and mention-picker arrow navigation must not conflict. When the mention picker is open, `ArrowUp`, `ArrowDown`, and `Enter` belong to the picker.

## Searching

### Decision

The picker searches indexed workspace-relative file and folder paths.

Results should prefer:

- direct basename matches
- closer path matches
- shorter paths when otherwise tied
- stable ordering for deterministic keyboard use

Duplicate basenames must show enough parent path to distinguish targets.

## Selection

### Decision

Selecting a result inserts a mention for the target path.

The draft remains normal editable text from the user's perspective. Inline mention selections stay in the textarea as `@path` text.

This keeps the feature a path-link shortcut and avoids introducing a rich-text composer model.

## Chips

### Decision

A composer attachment chip should show:

- whether the target is a file or folder
- the target basename
- enough path context to disambiguate when needed
- a remove control

Attachment chips are created only by the paperclip picker, drag/drop, or paste. The `@` mention
picker never creates attachment chips and never serializes structured attachment metadata.

Removing a chip removes only that structured attachment from composer state. It never rewrites textarea mention text.

## Sending

### Decision

On send, mentions serialize into ordinary user message text that includes the workspace-relative path.

Valid agent-facing text examples:

```text
Please inspect @docs/progress.md.
```

```text
Compare @src/mainview/ChatComposer.svelte with @src/mainview/prompt-history.ts.
```

```text
Look at the runtime, desktop bridge, and state package contracts before changing the bridge.
```

## Transcript Rendering

### Decision

Sent mentions render as actionable workspace path links.

File links reveal the file in the OS file browser. Folder links open the folder in the OS file browser. Missing paths render with unavailable styling and do not claim to open.

The transcript link action is native path navigation, not an in-app file editor. Dedicated file
surfaces can use the same link identity without changing message semantics.

## Agent Contract

### Decision

The agent receives inline mentions as ordinary user text.

If the user says:

```text
Please inspect @docs/progress.md.
```

then the agent may choose to read `docs/progress.md` through normal tool use. The mention itself
does not cause any read.

This preserves a clean provenance model:

- mentioned paths show what the user pointed at
- tool reads show what the agent actually inspected

## Persistence Contract

### Decision

The persisted sent message text is the durable record for composer mentions.

Composer attachment state is durable submitted-message metadata and transcript tile input. File and
folder attachment chips persist tagged path metadata only; they do not trigger prompt expansion,
file reads, folder expansion, or a context-target contract. Image attachment chips persist the same
metadata and may also contribute runtime-delivered image content blocks for vision-capable models.
State persists attachment metadata only; delivery behavior belongs to runtime and pi-adapter.

Agent-visible attachment metadata must lead with the readable workspace-relative path, not the
attachment display name. If an attachment was imported from outside the workspace, the metadata
points only at the copied `.svvy/attachments/user-input/...` path and does not expose or suggest the
original absolute source path.

The transcript renderer recognizes `@workspace/path` text in user messages and renders matching paths as workspace links. It also recognizes tagged composer attachment metadata and renders it as file, folder, and image tiles instead of visible prompt prose.

## Path Resolution

### Decision

Mention targets are workspace-relative paths at selection time.

The app should preserve the originally sent visible path text even if the file or folder later moves or is deleted.

If a transcript link points to a missing path, the renderer should show it as a missing workspace link rather than rewriting the historical message.

## Workspace Index

### Decision

The mention picker should use a workspace path index or cache.

The mention picker uses runtime-owned workspace path discovery exposed to the renderer through
app/bootstrap-provided read facades. The renderer may request activation through bootstrap-provided
facades and searches only a non-authoritative warm cache of the returned path list; it refreshes
after renderer-safe invalidations and never traverses workspace files directly.

The implementation must not traverse the full workspace tree on every keypress.

The index should prefer existing repository listing and ignore behavior where available, so generated files, dependency folders, and ignored paths do not dominate results.

### Out Of Scope

This spec does not define:

- file-system watcher invalidation
- semantic ranking
- symbol-level mentions
- recently opened or recently read path boosts
- drag-and-drop file insertion
- file quick-open integration
- in-app file preview or editor routing from transcript links

## Accessibility And Keyboard Behavior

### Decision

The picker should be keyboard accessible:

- `ArrowDown`: next result
- `ArrowUp`: previous result
- `Enter`: select result
- `Escape`: close picker
- `Tab`: may select the highlighted result if that does not conflict with existing composer focus behavior

The picker should expose listbox-style semantics in the renderer.

Chips should have accessible labels and removable controls.

## Testing Requirements

### Decision

Tests should cover:

- active `@query` detection at the caret
- picker open and close behavior
- path filtering and deterministic ranking
- duplicate basename disambiguation
- keyboard selection
- mouse selection
- picker/drop/paste attachment chip rendering
- attachment chip removal
- mention send serialization into ordinary text without chip-only attachments
- transcript attachment rendering for sent files, folders, and images without visible attachment-provenance prose
- image attachment warning for models whose metadata does not list image input
- transcript rendering as workspace links
- transcript link click routes to a concrete workspace path action
- missing transcript links are visibly unavailable and do not no-op as if they worked
- missing target rendering after restart
- no file read on send
- no folder expansion on send
- no generated agent context-target injection for orchestrator or handler-thread surfaces

The most important regression test is that sending a mention does not alter generated agent context.

## Progress Mapping

### Decision

Section 13 in `docs/progress.md` is Composer Mention Links.

All Section 13 progress items are required for the feature to count as complete:

- indexed `@` autocomplete for workspace files and folders
- editable `@path` mention text
- ordinary user-text serialization
- actionable transcript links for existing files and folders
- visibly unavailable transcript links for missing paths
- agent-neutral behavior with no prompt injection, no eager file reads, no folder expansion, and no context-target contract
