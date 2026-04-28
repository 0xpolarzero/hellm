# svvy UI Design System

This document defines the resolved visual system for the Svelte renderer. The Replit artifact under `frontend-replit/artifacts/svvy` is the source for density, tokens, and live-state treatments; production behavior and data still come from svvy read models and runtime contracts.

## Visual Character

svvy uses a dense desktop workbench language: compact panes, narrow rows, muted surfaces, low elevation, restrained borders, and orange only where focus, live work, or primary action needs attention. The UI should feel closer to an editor shell than a marketing app.

Dark mode is the primary reference state. Light mode must keep the same contrast relationships and density, but with softer borders and lighter panels. The renderer exposes both through CSS variables in `src/mainview/app.css` rather than Tailwind classes.

## Typography

- Sans text uses Inter with system fallbacks. Use it for shell chrome, transcript prose, cards, settings forms, buttons, labels, and command entries.
- Monospace text uses JetBrains Mono with standard mono fallbacks. Use it for paths, model labels, status badges, metadata chips, token counts, command names, snippets, logs, diff previews, and compact technical facts.
- Dense UI rows use 11-13 px equivalent sizing with tight line-height and no negative letter spacing.
- Transcript prose may use a larger 14-15 px equivalent with relaxed line-height so long agent output remains readable.
- Metadata and badges use tabular numerals where percentages, counts, or elapsed times can change.

## Color Tokens

The renderer token layer mirrors the artifact color roles while preserving svvy product semantics:

- `--ui-bg`, `--ui-shell`, `--ui-surface`, `--ui-panel`, and `--ui-code` define the background stack.
- `--ui-text-primary`, `--ui-text-secondary`, and `--ui-text-tertiary` define the text hierarchy.
- `--ui-border-soft`, `--ui-border-strong`, and `--ui-border-accent` define low-contrast workbench separators and orange emphasis.
- `--ui-accent` is the artifact orange, used for primary actions, active selection rails, focus rings, streaming cursors, live progress, and pane resize affordances.
- `--ui-success`, `--ui-warning`, `--ui-danger`, and `--ui-info` define semantic status families with matching soft backgrounds.

Do not introduce unrelated one-off hue families for product state unless a new semantic state needs them. Prefer extending the semantic tokens first.

## Context Budget

The artifact used generic green/orange/red thresholds at 70% and 90%. svvy uses the PRD policy:

- neutral below 40%
- orange from 40%
- red from 60%

Neutral context budget should be visually quiet, not celebratory green. Orange means rising pressure. Red means high pressure. These thresholds are implemented in `src/shared/context-budget.ts` and styled through `tone-neutral`, `tone-orange`, and `tone-red` classes.

## Status Semantics

Use these color mappings consistently across sessions, surfaces, handler threads, workflow runs, commands, waits, Project CI, provider auth, and context pressure:

- Running, active, streaming, retrying, primary progress: orange, with pulse only while live.
- Completed, verified, connected, passed, clean: emerald/success.
- Waiting, blocked, needs input, approval pending, disconnected but recoverable: amber/warning.
- Failed, invalid, destructive, cancelled by error, missing required provider: red/danger.
- Idle, archived, unavailable, inactive, placeholder, no-op: neutral.
- Informational metadata, selected non-live technical state: blue/info only when neutral text is insufficient.

Handler-thread vocabulary must use handler-thread and workflow task-agent labels rather than the artifact's generic "subagent" wording.

## Spacing, Borders, Radius, And Elevation

- The base spacing scale is compact: 4, 7, 10, 14, 18, and 24 px equivalents.
- Dense rows should land around 28-34 px high unless the content requires multiple lines.
- Pane headers and toolbars should stay tighter than content cards.
- Border radius follows the artifact: 2 px, 3 px, 4 px, and 6 px equivalents. Avoid pill shapes except tiny dots, progress tracks, and intentional chips.
- Elevation is subtle. Prefer a one-pixel border plus a small shadow; reserve stronger shadows for dialogs, popovers, and active overlays.

## Focus And Interaction

- Keyboard focus uses a 2 px orange ring with 1 px offset or the equivalent `--ui-focus-ring` shadow.
- Hover states should raise contrast through border or background changes, not large movement.
- Pane resize handles use low-contrast separators that turn orange on hover or active drag.
- Selected rows use a muted background plus an orange left rail or border when the selection is primary.
- Icon-only controls need accessible names or titles and must keep stable dimensions.

## Motion

Motion is functional and short:

- Status dots pulse at 1.4 s while running or active.
- Streaming cursors blink at 1 s with an orange block cursor.
- Progress and context bars transition width around 500 ms.
- Pane focus, hover, resize, and command palette entry transitions should stay in the 150-180 ms range.
- Expand/collapse motion should be brief and preserve scroll position.
- `prefers-reduced-motion: reduce` must effectively disable animation and transitions.

## Component Extraction Targets

The next UI sections should extract primitives for buttons, icon buttons, badges, dense rows, section headers, pane headers, dividers, keyboard hints, status badges, metadata chips, resize handles, focus states, hover states, disabled states, empty states, error states, and loading states. Those primitives should consume the tokens in `src/mainview/app.css` instead of copying artifact Tailwind class strings.
