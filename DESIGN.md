# svvy UI Design System

This document defines the resolved visual system for the Svelte renderer. The Replit artifact under `frontend-replit/artifacts/svvy` is the source for density, tokens, and live-state treatments; production behavior and data still come from svvy read models and runtime contracts.

## Visual Character

svvy uses a dense desktop workbench language: compact panes, narrow rows, muted surfaces, low elevation, restrained borders, and orange only where focus, live work, or primary action needs attention. The UI should feel closer to an editor shell than a marketing app.

The dark interface uses graphite neutrals with only a slight warm tint. It should not read as navy, slate-blue, or a blue monochrome stack. Blue is reserved for waiting and informational state, so pane chrome, tabs, sidebars, and neutral panels should stay in the graphite family.

Legacy Tailwind and shadcn-compatible aliases such as `--background`, `--card`, `--sidebar`, `--muted`, and `--border` must follow the same graphite direction so older utility-backed surfaces do not reintroduce blue chrome.

Dark mode is the primary reference state. Light mode must keep the same contrast relationships and density, but with softer borders and lighter panels. The renderer exposes both through CSS variables in `src/mainview/app.css` rather than Tailwind classes.

## Typography

- Sans text follows the Codex variable path, `var(--vscode-font-family, var(--font-sans-default))`, with `--font-sans-default` set to `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, and `sans-serif`; base text uses Codex's `430` weight. Use it for shell chrome, transcript prose, cards, settings forms, buttons, labels, and command entries.
- Monospace text follows the Codex variable path, `var(--vscode-editor-font-family, var(--font-mono-default))`, with `--font-mono-default` set to `ui-monospace`, `"SFMono-Regular"`, `"SF Mono"`, `Menlo`, `Consolas`, `"Liberation Mono"`, and `monospace`. Use it for paths, model labels, status badges, metadata chips, token counts, command names, snippets, logs, diff previews, and compact technical facts.
- Font weights follow the Codex scale: `430` for inherited base text, `500` for subtle labels and metadata, `600` for interactive emphasis and headings, and `700` only for rare strong emphasis such as counters, keyboard hints, and critical labels.
- Font sizes follow the Codex compact scale: `--text-xs` is `11px`, `--text-sm` is `12px`, `--text-base` is `14px`, `--text-lg` is `16px`, and heading tokens start at `18px`.
- Dense UI rows use 11-13 px equivalent sizing with tight line-height and no negative letter spacing.
- Transcript prose may use a larger 14-15 px equivalent with relaxed line-height so long agent output remains readable.
- Metadata and badges use tabular numerals where percentages, counts, or elapsed times can change.

## Color Tokens

The renderer token layer mirrors the artifact color roles while preserving svvy product semantics:

- `--ui-bg`, `--ui-shell`, `--ui-surface`, `--ui-panel`, and `--ui-code` define the graphite background stack with enough contrast between app shell, pane chrome, and content panels to avoid a single washed layer.
- `--ui-text-primary`, `--ui-text-secondary`, and `--ui-text-tertiary` define a warm-neutral text hierarchy, not a blue-tinted one.
- `--ui-border-soft`, `--ui-border-strong`, and `--ui-border-accent` define low-contrast graphite separators and orange emphasis.
- `--ui-accent` is the artifact orange, used for primary actions, active selection rails, focus rings, streaming cursors, live progress, and pane resize affordances.
- `--ui-success`, `--ui-warning`, `--ui-danger`, and `--ui-info` define semantic status families with matching soft backgrounds; waiting-specific UI uses `--ui-status-waiting` and `--ui-status-waiting-soft`, which resolve to the blue info family.

Do not introduce unrelated one-off hue families for product state unless a new semantic state needs them. Prefer extending the semantic tokens first.

## Context Budget

The artifact used generic green/orange/red thresholds at 70% and 90%. svvy uses the PRD policy:

- neutral below 40%
- orange from 40%
- red from 60%

Neutral context budget should be visually quiet, not celebratory green. Orange means rising pressure. Red means high pressure. These thresholds are implemented in `src/shared/context-budget.ts` and styled through `tone-neutral`, `tone-orange`, and `tone-red` classes.

## Status Semantics

Use these color mappings consistently across sessions, surfaces, handler threads, workflow runs, commands, waits, provider auth, and context pressure:

- Running, active, streaming, retrying, primary progress: orange, with pulse only while live.
- Completed, verified, connected, passed, clean: emerald/success.
- Waiting, blocked, needs input, approval pending, disconnected but recoverable: blue/waiting.
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
