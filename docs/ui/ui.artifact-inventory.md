# Replit UI Artifact Inventory

This document inventories the Replit artifact UI under `frontend-replit/artifacts/svvy` for the Svelte UI port.

The inventory treats the artifact as a visual and interaction source only. Production `svvy` UI remains Svelte under `src/mainview` and must keep consuming the existing runtime controllers, workspace read models, pi-backed surfaces, Smithers projections, and settings contracts.

Live inspection was performed against the artifact Vite app at `http://localhost:5177` on 2026-04-28. Static screenshots under `docs/ui/ui.reference-screenshots/` provide the desktop reference geometry. Live inspection covered focus, hover-supported surfaces, selected states, local state transitions, streaming cursor, pulsing status dots, tab changes, workflow node selection, composer expansion, waiting reply enablement, and settings/theme behavior.

## Inventory Boundary

Visual source facts:

- Dense dark workbench layout, compact typography, status colors, spacing, borders, row treatments, cards, pane chrome, artifact previews, and local motion are valid source inputs for the Svelte port.
- React routes, mock data, local component boundaries, Wouter navigation, Radix/shadcn primitives, and fixture-only state names are not production architecture.
- Replit route variants such as `/session/active`, `/session/waiting`, and `/session/failed` are fixture states of one production session surface, not product routes to recreate.
- Source labels that say "subagent" are artifact vocabulary. Production language should distinguish delegated handler threads from workflow task-agent attempts.
- The graph-oriented workflow screen is a visual reference only. Production `svvy` workflow inspection remains tree-first.

Production ownership facts:

- `src/mainview` owns Svelte presentation.
- `src/mainview/chat-runtime.ts`, `src/mainview/pane-layout.ts`, and `src/mainview/chat-storage.ts` own renderer runtime and pane state.
- `src/shared/workspace-contract.ts` owns renderer-facing read-model contracts.
- `src/bun/structured-session-state.ts`, `src/bun/structured-session-selectors.ts`, and `src/bun/session-projection.ts` own durable state and read-model derivation.
- pi owns orchestrator and handler-thread transcript/runtime surfaces.
- Smithers owns workflow execution; `svvy` projects Smithers state through explicit read models and inspectors.

## Route And Screen Inventory

| Route or screen | Screenshot | Source | Classification | Purpose and major layout regions | Visible states and live interactions | Fixture or mock data | Likely product mapping |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | `docs/ui/ui.reference-screenshots/01-workspace-launcher.png` | `frontend-replit/artifacts/svvy/src/pages/WorkspaceLauncher.tsx` | Fixture-only visual state, possible future workspace entry surface | Minimal top bar with `svvy`, theme and settings icons, centered workspace list, primary `Open repository`, secondary `New session`, recent workspaces, recent sessions, and session folder cards | Rows hover with card background and chevron emphasis. Workspace and recent-session rows navigate to `/session`; folder cards navigate to `/session/multipane`; `New session` navigates to `/new`; settings navigates to `/settings/auth`; theme toggles root theme state | `recentWorkspaces`, `mockSessions`, `mockFolderGroups` | If product adds a workspace launcher, use this density and row treatment. Current workspace/session data should come from app workspace state, not the artifact arrays. Session folders should not become product folders because PRD navigation allows pinned and archived groups only |
| `/new` | `docs/ui/ui.reference-screenshots/02-new-session.png` | `frontend-replit/artifacts/svvy/src/pages/NewSession.tsx`, `AppShell.tsx`, `BottomComposer.tsx`, `NavRail.tsx` | Production-like surface with fixture-only behavior | Full app shell with sidebar, dense top chrome, bottom composer, centered new-session entry, dumb-session alternative, prompt shortcut, and recent sessions | The primary new-session action opens an orchestrator session; the dumb-session alternative opens a dumb orchestrator session; resume is visual-only. Prompt Enter or send button navigates to `/session/active` when non-empty. Prompt input uses focus-within orange ring. Bottom composer exists independently and expands on focus | `mockSessions`; hardcoded worktree and zero budget | Map to production create-session flow, dumb-orchestrator/default-session agent settings, prompt history, and focused orchestrator creation. Do not port route-only mode navigation or "Full power, all agents" copy as behavior |
| `/session` | `docs/ui/ui.reference-screenshots/03-session-default.png` | `frontend-replit/artifacts/svvy/src/pages/MainSession.tsx` with `variant="default"` and `PaneSplitShell.tsx` | Production surface visual source | Main orchestrator surface in the workbench shell: sidebar, header with title/status/worktree/context budget/pane layout/model summary/inspector toggle, transcript lane, thread cards, episode, verification card, workflow card, bottom composer | Thread cards expand/collapse with Framer Motion. Thread and workflow cards can open local panes through `usePanes`. Artifact chips open local artifact/diff panes. Composer expands on focus. Status dots pulse for running states | `userMessages`, `orchestratorMessages`, `mockThreads[0..1]`, `mockSubagents`, `mockEpisodes`, `mockVerification`, `mockWorkflowRun` | Map to `ChatWorkspace.svelte`, `ChatTranscript.svelte`, `ChatComposer.svelte`, handler-thread summaries, command rollups, episodes, artifacts, Project CI/verification projections, and workflow-run summaries |
| `/session/active` | `docs/ui/ui.reference-screenshots/04-session-active.png` | `MainSession.tsx` with `variant="active"` | Fixture-only live/running visual state of the production session surface | Same regions as `/session`, with higher context budget, running thread progress, reviewer subagent row, streaming orchestrator message, streaming bottom status, stop button | Live inspection confirmed composer focus expansion, seeded mention chips, stop button in place of send, pulsing running badges/dots, blinking stream cursor, and streaming status row. Context bar and thread progress use CSS transitions | Same session mocks plus `mockSubagents[1]`; hardcoded streaming text; hardcoded "68% context used" | Map to live pi surface streaming state, pending tool calls, abort/stop action, context-budget read model, and workflow/task activity. Do not hardcode streaming copy or context percentages |
| `/session/waiting` | `docs/ui/ui.reference-screenshots/05-session-waiting.png` | `MainSession.tsx` with `variant="waiting"`, `WaitingCard.tsx` | Fixture-only wait state of the production session surface | Same shell and transcript, but first thread is waiting and a bottom waiting-for-input card asks a clarification question with inline reply | Live inspection confirmed reply button is disabled until text is entered, input gains focus, Enter calls the optional `onReply`, and "Skip and continue" is a visual button. Waiting dot pulses amber | `mockThreads[2]`, hardcoded waiting question and context | Map to handler or orchestrator wait state from structured session state. Reply must target the owning surface, not a generic route. Skip behavior needs product semantics before porting |
| `/session/failed` | `docs/ui/ui.reference-screenshots/06-session-failed.png` | `MainSession.tsx` with `variant="failed"`, `FailedCard.tsx` | Fixture-only failure state of the production session surface | Same shell and transcript, but session badge and context budget show failure pressure; verification card is replaced by a red failed card with error snippet and actions | Failure state uses red border-left, red status badge, monospace snippet, `View full report`, `Retry`, and `Override` buttons. Buttons are visual unless callbacks are supplied | `mockVerificationFailed`, hardcoded error snippet | Map failures to command, turn, workflow-run, task-attempt, or Project CI read models. "Override" is not a PRD product action and should not be ported without an explicit product decision |
| `/session/inspector` | `docs/ui/ui.reference-screenshots/07-session-inspector.png` | `MainSession.tsx` with `variant="inspector"`, `RightInspector.tsx` | Production-like inspector visual source over fixture data | Adds a right docked inspector to the main workbench with tabs for Thread, Episode, Artifact, Workflow, and Verification | Source opens/closes inspector with Framer Motion width and opacity animation. Tabs use local active state. The desktop screenshot shows the thread tab. In the constrained live viewport the dock was offscreen, but route/source confirm tab states and animation | `mockThreads[0]`, `mockEpisodes[0]`, `mockArtifacts[0]`, `mockPaneSurfaces`, `mockVerification` | Map to existing Svelte related inspectors, thread inspector, command inspector, artifact preview, workflow inspector, and Project CI detail. Do not port a single omniscient inspector if production surfaces already have separate read-model ownership |
| `/session/multipane` | `docs/ui/ui.reference-screenshots/08-session-multipane.png` | `MultiPanePage.tsx`, `PaneGrid.tsx` | Fixture-only visual state for pane layout | Fixed 3x3 grid with colored borders by pane type, occupied/empty panes, pane coordinates, expand and close icons, empty add-surface cells, bottom streaming composer | Empty cells hover; expand buttons navigate to route fixtures; close buttons are visual. Running session, workflow, and subagent dots pulse. No real drag/drop or persistent resize exists in this route | `defaultPanes`, `mockPaneSurfaces`, hardcoded grid coordinates and labels | Use pane density, empty-state styling, coordinate badges, and colored pane focus as visual inputs. Production pane ownership stays in `src/mainview/pane-layout.ts` and `ChatWorkspace.svelte` with persisted user-driven layout |
| `/session/subagent` | `docs/ui/ui.reference-screenshots/09-session-subagent.png` | `SubagentPane.tsx` | Fixture-only visual source for task-agent or delegated work detail | Full shell with subagent header, live-output terminal-like pre block, file-read/file-written sidebar, and action bar | Shows blinking stream cursor at the end of live output. `Interrupt` and `Expand context` buttons hover but do not act. File lists are static and use basenames | `liveOutput`, `filesRead`, hardcoded model `haiku`, token count, elapsed, and worktree | Do not recreate "subagent" as a product route. Use the visual language for workflow task-agent attempt inspectors or handler-thread detail surfaces backed by workflow/task command and artifact read models |
| `/workflow` | `docs/ui/ui.reference-screenshots/10-workflow-inspector-source-graph.png` | `WorkflowInspectorPage.tsx`, `WorkflowGraph.tsx` | Non-portable artifact-only graph source | App shell with workflow header and a manually positioned graph of workflow nodes and SVG edges | Live inspection confirmed click-to-select node details, active node orange outline/glow, pulsing active dot, disabled-looking waiting nodes, green completed edges, orange active edge, and detail drawer with objective/latest output/elapsed/worktree | `mockWorkflowRun`, `mockWorkflowNodes`, `mockWorkflowEdges`, fixed `x`/`y` graph coordinates | Production workflow inspector remains tree-first. Reuse status colors, compact node/card density, detail drawer treatment, and edge/status semantics only where they fit the tree-first Svelte inspector |
| `/artifacts` | `docs/ui/ui.reference-screenshots/11-artifacts-browser.png` | `ArtifactBrowserPage.tsx`, `ArtifactBrowser.tsx`, `DiffViewer.tsx` | Production surface visual source with fixture content | App shell with artifacts header, grouped artifact tree, selected artifact row, preview/raw/metadata tabs, diff/log/json/empty previews | Live inspection confirmed tab selection and selected row treatment. Diff view uses sticky-like header, monospace table rows, blue hunk/header rows, green additions, red removals, thin scrollbars | `mockArtifacts`, `fakeDiff`, `LogPreview`, `JsonPreview` | Map to durable artifact records and previews from `WorkspaceCommandArtifactLink` and artifact preview contracts. Do not rely on transcript-local artifact reconstruction or fake preview strings |
| `/settings/auth` | `docs/ui/ui.reference-screenshots/12-settings-auth.png` | `SettingsAuth.tsx` | Production-like settings visual source with fake providers | Settings shell with left nav, provider rows, OAuth connection rows, and environment-backed credential rows | Live inspection confirmed settings route renders provider rows and nav selection. Buttons hover but are visual-only. Theme button toggles `svvy-theme` localStorage and root dark class through shared hook | `providers`, `oauthConnections`, `envCreds`, hardcoded masked key, username, local Ollama URL | Map to provider auth settings, model discovery, stored provider state, OAuth state, environment credential detection, and destructive confirmation where required. Do not port fake provider state or direct credential strings |
| `/settings/profiles` | `docs/ui/ui.reference-screenshots/13-settings-profiles.png` | `SettingsProfiles.tsx` | Production-like settings visual source with fake runtime profiles | Settings shell with profile cards, model badges, reasoning badges, max token/provider/temperature/budget metadata, edit/duplicate buttons, and new-profile button | Cards hover by border change. Buttons are visual-only. Nav item selection is route-local | `mockRuntimeProfiles`, hardcoded profile override notice | Map to session-agent settings and conventional workflow-agent settings. Preserve production model picker and reasoning constraints instead of freeform fixture profile metadata |
| Unknown route fallback | `docs/ui/ui.reference-screenshots/14-not-found.png` | Inline fallback in `App.tsx`; unused `frontend-replit/artifacts/svvy/src/pages/not-found.tsx` also exists | Non-portable artifact-only source | Centered 404 text and orange link to launcher | Link hover changes orange tone and navigates to `/` | None | Use only as a minimal error/unknown route visual reference if production needs it. Do not preserve duplicate unused not-found implementation |
| `/narrow` | No screenshot in reference set | `NarrowShell.tsx` | Source-only responsive sketch, intentionally not required for screenshot capture | Collapsed nav rail, compact header, thread/workflow cards, bottom composer, and explanatory narrow-shell text | Uses collapsed `NavRail`, normal cards, and composer; no route-specific live behavior beyond static layout | `mockThreads`, `mockSubagents`, `mockWorkflowRun` | Inform responsive behavior only. The narrow screenshot requirement was removed, and production narrow behavior should be derived during the responsive pass rather than porting this route |
| `frontend-replit/artifacts/svvy/src/pages/not-found.tsx` | None | `frontend-replit/artifacts/svvy/src/pages/not-found.tsx` | Unused source file | Separate not-found component not wired by `App.tsx` | Not reachable through the configured router | None | Ignore unless a later cleanup of the artifact source itself is requested |

## Component Inventory

### Shell Chrome

| Component | Responsibility | Product mapping |
| --- | --- | --- |
| `frontend-replit/artifacts/svvy/src/components/svvy/AppShell.tsx` | Simple shell around `NavRail`, header chrome, `BottomComposer`, and optional `RightInspector`; local collapsed and inspector state | Styling input for `ChatWorkspace.svelte`. Runtime behavior maps to Svelte surface controllers, pane bindings, and settings/prompt state |
| `frontend-replit/artifacts/svvy/src/components/svvy/PaneSplitShell.tsx` | Production-like shell using `react-resizable-panels` plus `PanesProvider`; supports up to two local detail panes beside the session pane | Visual input for pane chrome and resize handles. Ownership maps to `src/mainview/pane-layout.ts`, `chat-runtime.ts`, and `ChatWorkspace.svelte` |
| `frontend-replit/artifacts/svvy/src/pages/WorkspaceLauncher.tsx` | Standalone workspace launcher with recent workspace/session/folder fixtures | Possible future visual reference. Current production launcher behavior must be app/workspace owned |
| `frontend-replit/artifacts/svvy/src/pages/SettingsAuth.tsx` and `SettingsProfiles.tsx` settings layouts | Duplicate settings shells with left nav and top back/theme controls | Styling input for `src/mainview/Settings.svelte`; avoid duplicating layout logic |

### Sidebar And Session Navigation

| Component | Responsibility | Product mapping |
| --- | --- | --- |
| `frontend-replit/artifacts/svvy/src/components/svvy/NavRail.tsx` | Full/collapsed session rail; workspace header; new-session dropdown, folder chips, active/recent/archived/workflows/episodes/open-surfaces sections, settings/theme footer | Maps visually to `SessionSidebar.svelte` and `SessionListItem.svelte`. Product data maps to `WorkspaceSessionNavigationReadModel`; do not port artifact folders as product folders |
| `frontend-replit/artifacts/svvy/src/components/svvy/SessionRow.tsx` | Compact row with status dot, title, preview, time, model badge, pane location, selected background | Maps to `SessionListItem.svelte`; likely needs reusable dense row, status dot, model badge, and pane-location badge primitives |
| `frontend-replit/artifacts/svvy/src/components/svvy/StatusBadge.tsx` | Status badge and dot for `running`, `active`, `done`, `verified`, `waiting`, `blocked`, `failed`, `idle`; running and active pulse | Maps to production status badge primitives. Product status vocabulary is richer than this fixture enum |
| `frontend-replit/artifacts/svvy/src/components/svvy/ModelBadge.tsx` | Short model/provider chip display | Maps to focused surface agent summaries and settings model chips |

### Pane Chrome

| Component | Responsibility | Product mapping |
| --- | --- | --- |
| `frontend-replit/artifacts/svvy/src/components/svvy/PaneSplitShell.tsx` | Header, panel group, detail pane headers, close buttons, resizer, composer dock, inspector dock | Visual source for production pane chrome, but data and persistence stay in Svelte pane layout |
| `frontend-replit/artifacts/svvy/src/components/svvy/PaneGrid.tsx` | Static 3x3 fixture grid with colored pane borders, coordinates, empty cells, expand and close affordances | Styling source for pane overview/empty cells. Not a production layout engine |
| `frontend-replit/artifacts/svvy/src/hooks/usePanes.tsx` | Local React pane state, `openPane`, `closePane`, `replacePane`; caps additional panes at two; IDs with `Date.now()` | Non-portable. Production pane state is renderer-local but persisted through Svelte layout storage and stable pane IDs |
| `frontend-replit/artifacts/svvy/src/components/svvy/panes/*.tsx` | Pane-specific content for thread, workflow, artifact, subagent | Visual source for secondary pane density, tabs, headers, and sidebars |

### Composer

| Component | Responsibility | Product mapping |
| --- | --- | --- |
| `frontend-replit/artifacts/svvy/src/components/svvy/BottomComposer.tsx` | Compact/expanded composer; focus-to-expand; local text state; Enter-to-send; stop/send button; static mention chips; context budget; runtime profile accordion; streaming status row | Maps visually to `ChatComposer.svelte`. Production behavior already owns prompt history, mention autocomplete, prompt locking, abort, target surface, model picker, and reasoning controls |
| `frontend-replit/artifacts/svvy/src/components/svvy/MentionChip.tsx` | Orange file/folder mention chip with remove button | Maps to Svelte mention chips, but selected mentions must come from composer mention contracts and serialize as plain `@path` text |
| `frontend-replit/artifacts/svvy/src/components/svvy/ContextBudgetBar.tsx` | Thin context usage bar with 70 and 90 percent thresholds | Needs product correction. PRD policy is neutral below 40, orange from 40, red from 60 |

### Transcript And Messages

| Component | Responsibility | Product mapping |
| --- | --- | --- |
| Inline `UserMessage` and `OrchestratorMessage` in `MainSession.tsx` | User bubble and orchestrator prose/bullets | Maps to `ChatTranscript.svelte` and `conversation-projection.ts`; transcript must remain pi-backed |
| `frontend-replit/artifacts/svvy/src/components/svvy/ThreadCard.tsx` | Expandable delegated-thread card with status, progress, subagent rows, worktree, elapsed, model, open-pane action | Maps to `WorkspaceHandlerThreadSummary`, handler inspector, and thread surface opening |
| `frontend-replit/artifacts/svvy/src/components/svvy/WorkflowCard.tsx` | Compact workflow run card with step dots and current step | Maps to workflow-run summaries and workflow inspector opening |
| `frontend-replit/artifacts/svvy/src/components/svvy/EpisodeCard.tsx` | Handoff-like semantic output with verified/review badge and artifact chips | Maps to durable episodes and handler handoff episodes |
| `frontend-replit/artifacts/svvy/src/components/svvy/VerificationCard.tsx` | Build/test/lint result card with report link | Maps either to Project CI check projection or explicit command/verification result records, depending on source data |
| `frontend-replit/artifacts/svvy/src/components/svvy/WaitingCard.tsx` | Clarification/wait card with inline reply | Maps to surface wait state; reply target must be the owning orchestrator or handler surface |
| `frontend-replit/artifacts/svvy/src/components/svvy/FailedCard.tsx` | Failure card with error snippet and action buttons | Maps to command, workflow, task-attempt, turn, or CI failure projection. "Override" is not product-approved |

### Delegation And Task Detail

| Component | Responsibility | Product mapping |
| --- | --- | --- |
| `frontend-replit/artifacts/svvy/src/components/svvy/SubagentCard.tsx` | Compact agent/task row with icon by type, status dot, token count, model, and pane opener | Visual source for workflow task-attempt summaries. Rename production labels away from generic "subagent" where appropriate |
| `frontend-replit/artifacts/svvy/src/pages/SubagentPane.tsx` | Route-level live task output with file read/write sidebar | Visual source for task-attempt inspector or handler detail, not a production route |
| `frontend-replit/artifacts/svvy/src/components/svvy/panes/SubagentPaneContent.tsx` | Pane content with output, read/written files, and interrupt/add-context buttons | Maps to task-attempt inspector read models and command/artifact links |

### Workflow, Inspector, And Artifact Surfaces

| Component | Responsibility | Product mapping |
| --- | --- | --- |
| `frontend-replit/artifacts/svvy/src/components/svvy/RightInspector.tsx` | Docked inspector with tabs for thread, episode, artifact, workflow, and verification | Visual source for inspector tabs/sections. Production inspectors are backed by separate Svelte read models |
| `frontend-replit/artifacts/svvy/src/components/svvy/WorkflowGraph.tsx` | Manually positioned SVG graph with click-select nodes and detail drawer | Non-portable graph structure. Reuse status color, compact node details, and active/waiting visual semantics for tree-first inspector |
| `frontend-replit/artifacts/svvy/src/components/svvy/ArtifactBrowser.tsx` | Grouped artifact tree, preview/raw/metadata tabs, selected row, diff/log/json/empty previews | Maps to durable artifact browser/panel and artifact preview contracts |
| `frontend-replit/artifacts/svvy/src/components/svvy/ArtifactChip.tsx` | Clickable artifact chip that opens artifact or diff pane | Maps to artifact links from command/thread/workflow/episode projections |
| `frontend-replit/artifacts/svvy/src/components/svvy/DiffViewer.tsx` | Monospace diff table over hardcoded diff lines | Visual source for diff preview. Real diff content must come from artifact records |

### Command Palette

The artifact has no routed or live command palette behavior. `frontend-replit/artifacts/svvy/src/components/ui/command.tsx` wraps the React `cmdk` package, but no svvy-specific page imports it.

Production command palette behavior already maps to `src/mainview/CommandPalette.svelte` and `src/mainview/command-palette.ts`, using `cmdk-sv` and svvy command routing. The Replit artifact provides no command list treatment beyond the generic primitive.

### Settings And Auth

| Component | Responsibility | Product mapping |
| --- | --- | --- |
| `frontend-replit/artifacts/svvy/src/pages/SettingsAuth.tsx` | Provider rows, OAuth connection rows, env-backed credential rows, settings nav | Maps visually to provider settings. Production must preserve provider auth synchronization, model discovery, validation, and confirmation policies |
| `frontend-replit/artifacts/svvy/src/pages/SettingsProfiles.tsx` | Runtime profile cards with model/reasoning/provider/temperature/budget metadata | Maps visually to session-agent and workflow-agent settings. Production settings are not freeform fixture profiles |

### Primitives And Tokens

| Source | Responsibility | Product mapping |
| --- | --- | --- |
| `frontend-replit/artifacts/svvy/src/index.css` | Tailwind v4 tokens; Inter and JetBrains Mono; dark and light CSS variables; radii; focus ring; pulse and blink keyframes; diff colors; thin scrollbars; hover-elevate helpers | Source for token extraction into `src/mainview/app.css`, corrected against PRD semantics |
| `frontend-replit/artifacts/svvy/src/components/ui/*.tsx` | Broad shadcn/Radix primitives, many unused by svvy artifact routes | Styling reference only. Production should use Svelte primitives under `src/mainview/ui` |
| `frontend-replit/artifacts/svvy/src/hooks/useTheme.tsx` | Theme persisted in `localStorage["svvy-theme"]`; toggles root `.dark` class | Visual behavior reference. Production theme ownership should stay in Svelte settings/app shell |

## Interaction Inventory

### Clicks And Navigation

- Workspace launcher rows navigate to fixture sessions; only row treatments and target affordances are source facts.
- `New session`, `New dumb session`, settings, back-to-session, and route nav buttons use Wouter locations, not product routing.
- Session rows navigate to fixture variants based on hardcoded IDs in `getSessionPath`.
- Sidebar section headers expand/collapse local React state for active, recent, archived, workflows, and episodes.
- Thread card chevrons and titles toggle local expansion.
- Thread card open-pane buttons call `usePanes().openPane("thread", ...)`.
- Workflow cards open local workflow panes and are keyboard-activatable with Enter.
- Artifact chips call `openPane("diff" | "artifact", ...)`.
- Workflow graph nodes select/deselect local node detail state.
- Artifact browser rows select local artifact state; preview/raw/metadata tabs change local tab state.
- Settings edit/revoke/connect/disconnect/new/edit/duplicate buttons are visual-only unless a callback is supplied by the component, which route pages do not do.

### Keyboard Behavior

- New-session prompt Enter navigates to `/session/active` when the local prompt is non-empty.
- Bottom composer Enter calls `handleSend`; Shift+Enter preserves a newline. In the route fixtures no `onSend` is supplied, so it clears only when integrated by a parent.
- Waiting card Enter calls `onReply` when text exists; route fixtures do not supply the callback.
- Workflow and subagent cards expose `role="button"` and Enter handlers.
- The artifact does not implement `Cmd+Shift+P`, `Cmd+P`, command matching, quick-open, or a command-palette route.
- The generic shadcn sidebar primitive includes a `Cmd/Ctrl+B` sidebar shortcut, but svvy artifact routes do not use that primitive.

### Focus States

- Global `:focus-visible` is a 2 px orange ring with 1 px offset.
- Inputs use `focus-within:border-ring` or `focus:border-ring`.
- Live inspection confirmed the bottom composer expands when its textarea receives focus.
- Live inspection confirmed the waiting reply input becomes active and enables `Reply` when non-empty.
- Many icon-only buttons rely on the global focus ring and `title` attributes rather than bespoke accessible names.

### Hover States

- Primary orange buttons darken from orange 500 to orange 600.
- Secondary buttons and rows use muted/card background lifts and border color changes.
- Sidebar row hover raises text contrast and often background opacity.
- Workspace rows reveal stronger chevron color on group hover.
- Thread/pane/artifact action icons are muted until hover.
- Workflow graph nodes use `hover:brightness-110`.
- Pane resize handles in `PaneSplitShell` turn orange on hover and stronger orange while active.
- Artifact chips reduce opacity on hover.

### Active And Selected States

- Active session row uses a muted background plus an orange left rail and status dot.
- Header session status uses status badges with pulsing dots for running/active.
- Context budget bar color depends on fixture thresholds.
- Artifact browser selected row uses `bg-secondary text-foreground`.
- Tabs use `bg-secondary text-foreground`.
- Workflow selected node gets a `ring-1 ring-ring`.
- Multi-pane route uses border color by pane type and orange/purple/blue/cyan tones for focused-looking panes, but focus is fixture-only.

### Drag And Resize

- `PaneSplitShell` uses `react-resizable-panels` for horizontal resize of dynamic detail panes.
- The resize handle is a 1 px border line with a 4 px interaction area and orange hover/active feedback.
- Production Svelte already owns pane geometry, drag/drop placement, restart persistence, and pane focus. The artifact `PaneGrid` does not implement real dragging, span editing, or close behavior.

### Composer Behavior

- Compact state shows `@`, one-line textarea, model chip, context bar, expand toggle, and send/stop button.
- Focus expands to show seeded mention chips, add-context button, three-line textarea, status bar with workspace/session/worktree chips, context bar, runtime profile accordion, mention resolution rows, and streaming status if active.
- Mention chips are seeded from `mockMentionTargets`; there is no autocomplete in the artifact.
- Profile accordion lists `mockRuntimeProfiles`.
- Streaming state replaces send with a red stop button and adds "Orchestrator is working..." with pulsing dot.
- Production must keep existing prompt history, mention autocomplete, prompt locks, cancellation, target surface, and model/reasoning controls.

### Sidebar Behavior

- Full rail width is 15 rem; collapsed rail width is 3 rem.
- Collapse/expand changes header content, action buttons, and footer controls through local state.
- Active, recent, archived, workflows, and episodes sections use local expanded state.
- Open surfaces are static and always expanded.
- Theme toggle persists local storage and updates the root class.
- Product sidebar must use pinned/active/archived navigation read models, not Replit folder groups.

### Pane Behavior

- `usePanes.openPane` appends up to two detail panes; when full, it drops all but the first old detail pane and appends the new pane.
- Detail pane IDs are timestamp-based and not stable.
- Detail pane close removes the pane from local state.
- Pane headers show type-specific icon color and title.
- The session pane, detail panes, right inspector, and bottom composer all remain in one shell.
- Production must preserve stable pane IDs, surface bindings, duplicated surface attachment, pane-local scroll, focus, and restart restoration.

### Inspector Behavior

- `RightInspector` starts on the Thread tab and animates width from 0 to 320 px with 0.18 s duration.
- Tabs are local state and can switch between thread, episode, artifact, workflow, and verification detail.
- Thread inspector shows changed files, conclusions, unresolved issues, follow-up suggestions, and provenance.
- Episode inspector shows artifacts, verification, and provenance.
- Artifact inspector embeds a mini diff preview and an `Open in pane` button.
- Workflow inspector panel lists progress and pane surfaces.
- Verification panel lists checks, artifacts, and a durable state summary.
- Production should keep these as visual section patterns over existing specific inspector read models.

### Settings Behavior

- Settings nav has route-local selection.
- Provider rows distinguish connected versus disconnected states with emerald icons/badges or muted circles.
- Destructive auth actions are visually red but no confirmation exists in the artifact.
- Environment-backed credential rows show found/not-found badges and an amber warning panel.
- Runtime profile cards show model, reasoning, provider, max tokens, temperature, and budget metadata.
- Production destructive auth actions still need action-time confirmations and real RPC-backed persistence.

### Animated And Live-State Details

- `.pulse-dot` runs a 1.4 s infinite ease-in-out opacity and scale animation.
- `.stream-cursor::after` renders `▋` with a 1 s step-start blink.
- Thread progress and context budget bars use width transitions; context budget uses 500 ms.
- Thread expand/collapse uses Framer Motion height animation with 0.15 s duration.
- Right inspector uses Framer Motion width and opacity animation with 0.18 s duration.
- Radix popovers/dropdowns/tooltips in unused UI primitives include short fade/zoom/slide animations.
- No reduced-motion branch was found in the artifact.

## Mock-Only Assumptions

| Mock or hardcoded source | Source facts | Production owner |
| --- | --- | --- |
| `mockWorkspace` | Hardcodes `~/code/auth-service`, `auth-service`, and `feat/oauth-provider` | Workspace/app state and VCS read model |
| `mockSessions` | Six sessions with IDs `s1` to `s6`, statuses, branch, folder, pane, model, activeAgents, budgetPercent, currentExecutor, waitingReason, worktree | `WorkspaceSessionSummary`, `WorkspaceSessionNavigationReadModel`, structured session selectors |
| `mockFolderGroups` | Arbitrary groups: Current focus, Recent wins, CI hardening, Backlog | Non-product artifact assumption. PRD supports pinned active sessions and one Archived group, not arbitrary folders |
| `mockThreads` | Three threads with title, objective, status, progress, changed files, conclusions, unresolved issues, follow-up suggestions, blocked reason, verification summary | `WorkspaceHandlerThreadSummary`, `WorkspaceHandlerThreadInspector`, structured thread records |
| `mockSubagents` | Implementer/reviewer/explorer rows with token counts and model labels | Workflow task-attempt summaries, handler thread activity, command rollups. Do not create a generic product "subagent" entity |
| `mockWorkflowRun` | One running `auth-refactor-ci` run with `run_j4k2m9`, 3/8 steps, current step `run-tests` | Workflow-run records projected from Smithers bridge state |
| `mockWorkflowNodes` and `mockWorkflowEdges` | Fixed graph nodes with absolute `x`/`y`, type/status/objective/latestOutput, SVG edge dependencies | Smithers workflow inspector tree and event snapshots. Graph coordinates are non-portable |
| `mockEpisodes` | One verified auth middleware episode with artifact links | Durable episode records, especially handler `thread.handoff` episodes |
| `mockVerification` and `mockVerificationFailed` | Build/test/lint summaries, counts, snippets, artifacts | Project CI lane when declared by CI entries, or explicit command/verification read models. Do not infer from arbitrary transcript text |
| `mockArtifacts` | Eight artifacts across three sessions with fake names, sizes, ages, types, and thread IDs | Durable artifact metadata/indexes and artifact preview APIs |
| `mockRuntimeProfiles` | Orchestrator, Dumb, Explorer, Implementer, Reviewer, Workflow-writer, Namer profiles with Claude/OpenAI model names and cost metadata | Session-agent settings and workflow-agent settings. Production model lists come from connected providers |
| `mockPaneSurfaces` and `defaultPanes` | Static pane labels and coordinates such as `[1,1]`, `[2,3]`, and fixed 3x3 spans | Renderer pane layout state and pane-to-surface bindings |
| `mockMentionTargets` | Three workspace paths and resolved absolute paths | Workspace path index, composer mention contracts, and sent text serialization |
| `recentWorkspaces` | Four fake local repos, branches, recency, session counts | Optional workspace launcher/recent workspace state, not current product runtime evidence |
| `providers`, `oauthConnections`, `envCreds` | Fake provider auth state, masked keys, connected username, env var presence | Provider auth settings, OAuth state, credential discovery, model discovery |
| `userMessages` and `orchestratorMessages` | Static prompt and assistant response with bullets | pi transcript and `conversation-projection.ts` |
| `liveOutput`, `liveOutputMap`, `filesReadMap`, `filesWrittenMap` | Static task output and file lists | Workflow task-attempt transcript, command child facts, artifacts, and file-operation summaries |
| `fakeDiff`, `LogPreview`, `JsonPreview` | Static diff/log/json payloads | Durable artifact preview content |
| `statusConfig`, `nodeStatusBorder`, `nodeStatusGlow`, `typeColors`, `reasoningBadge` | Fixture-local color semantics | Product status token mapping to sessions, turns, commands, threads, workflow runs, waits, Project CI, provider auth, artifacts, and context budget |
| `ContextBudgetBar` thresholds | Green below 70, orange at 70, red at 90 | PRD policy: neutral below 40, orange from 40, red from 60 |
| `/session/*` route variants | Separate URLs for default, active, waiting, failed, inspector | Fixture routes only. Production state comes from read models on one surface |
| `useTheme` localStorage key | `svvy-theme` toggles root `.dark` | Production theme settings if adopted; avoid conflicting storage semantics |

## Visual Language To Reuse

Density:

- Desktop shell is compact and information-dense.
- Headers are 36 to 40 px high.
- Rows usually use 8 to 12 px vertical padding.
- Cards use 4 px radius and 1 px borders.
- The layout favors dense lists, docked panels, and restrained status color rather than large marketing panels.

Typography:

- Source uses Inter for UI text and JetBrains Mono for metadata, badges, paths, times, IDs, and labels.
- Most UI copy sits between 9 px and 13 px.
- Section labels are uppercase monospace with wide tracking.
- Transcript body uses compact 13 px text with relaxed line-height.
- Metadata chips and pane coordinates are monospace and intentionally small.

Color and status semantics:

- Orange is the primary accent and running/active state.
- Emerald marks done, verified, passed, and connected.
- Amber marks waiting, blocked, and warnings.
- Red marks failed and destructive actions.
- Blue/cyan/purple/yellow differentiate artifact and agent/task types.
- Muted slate text carries secondary metadata.
- Dark mode is the primary reference; light mode exists but feels less complete in constrained live inspection.

Spacing and borders:

- Use 1 px borders heavily instead of shadow-heavy elevation.
- Left border accents identify thread, verification, waiting, and failure cards.
- Panels separate by border lines and thin scrollbars.
- Empty pane states use dashed or faint borders.

Elevation:

- Elevation is minimal. Most visual depth comes from borders, subtle background shifts, and hover overlays.
- The source defines hover-elevate helpers but svvy-specific routes mostly use Tailwind hover backgrounds and borders.

Motion:

- Motion is short and functional: pulse dots, streaming cursor, width/height expansion, progress bar transitions, and hover color transitions.
- No source reduced-motion handling was found, so the Svelte port must add reduced-motion handling during the accessibility pass.

Dark and light behavior:

- Dark tokens define the core workbench look.
- Light tokens exist in `index.css`, and live inspection showed the settings surface can render in light mode after theme state changes.
- Production should ensure both modes are complete if theme switching remains user-facing.

## Source UI Weaknesses And Mismatches

- The artifact is entirely fixture-driven. No pi, Smithers, Electrobun IPC, WebSocket/EventSource, fetch, or workspace API behavior was found.
- React and Wouter route boundaries are not production boundaries.
- The source uses arbitrary session folders, but the PRD navigation model only supports pinned active sessions plus one collapsed Archived group.
- Many labels say "subagent"; production needs handler-thread and workflow task-agent terminology.
- `/workflow` is graph-oriented, while production workflow inspection is tree-first.
- Context budget colors conflict with the PRD thresholds.
- Command palette behavior is absent from the artifact, despite production having a command palette.
- Several settings and failure actions are visual-only and would require product semantics and confirmations before porting.
- `FailedCard` includes an `Override` action that is not in the PRD product model.
- `PaneGrid` is a static visual sketch, not the production pane layout engine.
- `usePanes` uses timestamp IDs, no persistence, and a two-detail-pane cap.
- `RightInspector` combines many domains into one generic dock, while production has specific inspector surfaces and read models.
- `/narrow` exists in source without a reference screenshot; the removed narrow screenshot requirement should not be reintroduced.
- The artifact includes broad shadcn/Radix primitives, most of which are unused and not portable to Svelte.
- A source typecheck run by the read-only source inventory found an existing artifact error in `components/ui/sidebar.tsx`; this does not affect production because that primitive is unused by routed svvy artifact screens.

## Porting Implications

- Build Svelte primitives around the visual language first: dense rows, pane chrome, status badges, metadata chips, section headers, tabs, icon buttons, artifact chips, and inspector sections.
- Keep production behavior in Svelte controllers and shared contracts. Do not port React local state models.
- Treat every screenshot state as a fixture coverage target, not a route target.
- Use the artifact's status colors only after mapping them to product statuses and PRD thresholds.
- Convert "subagent" visuals into either handler-thread summaries or workflow task-attempt summaries based on the production read model.
- Keep workflow inspector tree-first and translate graph node visual semantics into tree rows/details where useful.
- The artifact browser is one of the strongest reusable surfaces, but it needs durable artifact records and robust missing-file/large-log states from production contracts.
- The composer visual density is useful, but the current Svelte composer already owns richer behavior. Restyle, do not replace.
- The settings surfaces provide row and badge treatments, but production must preserve real provider state, model discovery, settings persistence, and confirmation policies.
- Command palette styling cannot be sourced from the Replit artifact because the artifact has no svvy command palette implementation.

## Follow-Up Items For [docs/ui/ui.progress.md](ui.progress.md)

The closest roadmap sections should track these follow-ups:

- In Source UI Foundation, reconcile context-budget color thresholds with PRD policy before porting the artifact token system.
- In Handler Threads And Delegation Projection, normalize artifact "subagent" vocabulary into handler-thread and workflow task-agent surfaces.
- In Workflow, Artifact, And Command Inspectors, document the tree-first workflow inspector adaptation before any graph-inspired visual work.
- In Command Palette And Quick Open, note that the Replit artifact has no command-palette behavior and production Svelte/cmdk-sv remains the source of command semantics.
