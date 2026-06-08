# Smithers — feature validation slideshow

Generated from a capture run against `http://127.0.0.1:5175` (live, 16 surfaces, 48 shots).

Every section describes one feature, shows desktop + mobile + dark
variants when available, and links to the Playwright spec that proves it.

## Index

- [Home — composer & hero](#home)
- [Workflow store](#store)
- [Ask Me](#askme)
- [Runs list](#runs)
- [Approvals queue](#approvals)
- [Agents & providers](#agents)
- [Memory](#memory)
- [Prompts](#prompts)
- [Scores](#scores)
- [Crons](#crons)
- [Issues](#issues)
- [Tickets](#tickets)
- [Landings](#landings)
- [Changes (VCS)](#vcs)
- [Palette](#palette)
- [Sign in](#login)

## Home — composer & hero
<a id="home"></a>

Centered chat-first shell. The composer is the entry point for every feature; slash commands open cards or canvases without leaving home.

**Validation.** tests/e2e/smoke.spec.ts — boots without uncaught errors; composer + hero render.

![Home — composer & hero — light · desktop](assets/home.desktop.light.png)

![Home — composer & hero — dark · desktop](assets/home.desktop.dark.png)

![Home — composer & hero — light · mobile](assets/home.mobile.light.png)

## Workflow store
<a id="store"></a>

Browse and pick from the workflow app store. Each card opens a workflow editor or launches a run.

**Validation.** tests/e2e/store.spec.ts — store route renders the catalog and lets users open a workflow.

![Workflow store — light · desktop](assets/store.desktop.light.png)

![Workflow store — dark · desktop](assets/store.desktop.dark.png)

![Workflow store — light · mobile](assets/store.mobile.light.png)

## Ask Me
<a id="askme"></a>

Reverse interview: Smithers grills you to sharpen an idea before you commit to a workflow.

**Validation.** tests/e2e/askme.spec.ts — opens askme route and walks through the grill prompts.

![Ask Me — light · desktop](assets/askme.desktop.light.png)

![Ask Me — dark · desktop](assets/askme.desktop.dark.png)

![Ask Me — light · mobile](assets/askme.mobile.light.png)

## Runs list
<a id="runs"></a>

Every recent workflow execution. Each row drills into the run inspector, logs, timeline, diff, and changes.

**Validation.** tests/e2e/surfaces.spec.ts — `/runs` surface renders rows; row navigation lands on the inspector.

![Runs list — light · desktop](assets/runs.desktop.light.png)

![Runs list — dark · desktop](assets/runs.desktop.dark.png)

![Runs list — light · mobile](assets/runs.mobile.light.png)

## Approvals queue
<a id="approvals"></a>

Pending human-gate approvals across runs. Approve/deny inline; live-updated via the gateway.

**Validation.** tests/e2e/approvals.spec.ts — pending gates list and approve/deny actions work.

![Approvals queue — light · desktop](assets/approvals.desktop.light.png)

![Approvals queue — dark · desktop](assets/approvals.desktop.dark.png)

![Approvals queue — light · mobile](assets/approvals.mobile.light.png)

## Agents & providers
<a id="agents"></a>

Registry of every agent the workspace can talk to. Each row shows availability and the underlying provider.

**Validation.** tests/e2e/featureCards.spec.ts → /agents card — provider availability counts match the catalog.

![Agents & providers — light · desktop](assets/agents.desktop.light.png)

![Agents & providers — dark · desktop](assets/agents.desktop.dark.png)

![Agents & providers — light · mobile](assets/agents.mobile.light.png)

## Memory
<a id="memory"></a>

Cross-run memory facts with namespaces, recall search, and per-fact detail panes.

**Validation.** tests/e2e/featureCards.spec.ts → /memory card — recall hits the seeded fact set.

![Memory — light · desktop](assets/memory.desktop.light.png)

![Memory — dark · desktop](assets/memory.desktop.dark.png)

![Memory — light · mobile](assets/memory.mobile.light.png)

## Prompts
<a id="prompts"></a>

All prompt templates in the workspace, sourced from PROMPT_TEMPLATES with their imports inlined.

**Validation.** tests/e2e/featureCards.spec.ts → /prompts card — templates render with imports.

![Prompts — light · desktop](assets/prompts.desktop.light.png)

![Prompts — dark · desktop](assets/prompts.desktop.dark.png)

![Prompts — light · mobile](assets/prompts.mobile.light.png)

## Scores
<a id="scores"></a>

Scorer dashboard. Summary, metrics, and recent reports tabs; empty-state when nothing has run.

**Validation.** tests/e2e/featureCards.spec.ts → /scores card — score report rows render.

![Scores — light · desktop](assets/scores.desktop.light.png)

![Scores — dark · desktop](assets/scores.desktop.dark.png)

![Scores — light · mobile](assets/scores.mobile.light.png)

## Crons
<a id="crons"></a>

Scheduled triggers. Each cron summary is derived from SEEDED_CRONS — adding a cron updates the list.

**Validation.** tests/e2e/featureCards.spec.ts → /crons card — sorted cron summary lines up.

![Crons — light · desktop](assets/crons.desktop.light.png)

![Crons — dark · desktop](assets/crons.desktop.dark.png)

![Crons — light · mobile](assets/crons.mobile.light.png)

## Issues
<a id="issues"></a>

Code-host issues mocked from the vcs template. Filter by state/labels; opens detail in a side rev.

**Validation.** tests/e2e/reviewSurfaces.spec.ts — `/issues` renders and filters correctly.

![Issues — light · desktop](assets/issues.desktop.light.png)

![Issues — dark · desktop](assets/issues.desktop.dark.png)

![Issues — light · mobile](assets/issues.mobile.light.png)

## Tickets
<a id="tickets"></a>

Linear-style ticket queue with status pills and assignee chips. Drills into a ticket detail view.

**Validation.** tests/e2e/reviewSurfaces.spec.ts — `/tickets` rows render with status pills.

![Tickets — light · desktop](assets/tickets.desktop.light.png)

![Tickets — dark · desktop](assets/tickets.desktop.dark.png)

![Tickets — light · mobile](assets/tickets.mobile.light.png)

## Landings
<a id="landings"></a>

Pull-request landings feed. Filter by repo / state; preview the changed surface.

**Validation.** tests/e2e/reviewSurfaces.spec.ts — `/landings` filter segment toggles state.

![Landings — light · desktop](assets/landings.desktop.light.png)

![Landings — dark · desktop](assets/landings.desktop.dark.png)

![Landings — light · mobile](assets/landings.mobile.light.png)

## Changes (VCS)
<a id="vcs"></a>

Working-tree changes across the project, grouped by repo. Pairs with the diff viewer.

**Validation.** tests/e2e/diffVcs.spec.ts — `/vcs` lists changed files; opens the diff.

![Changes (VCS) — light · desktop](assets/vcs.desktop.light.png)

![Changes (VCS) — dark · desktop](assets/vcs.desktop.dark.png)

![Changes (VCS) — light · mobile](assets/vcs.mobile.light.png)

## Palette
<a id="palette"></a>

Command palette modal hosted as a route. Keyboard-first launcher for any feature.

**Validation.** tests/e2e/featureCards.spec.ts → palette — opens the palette modal from /palette.

![Palette — light · desktop](assets/palette.desktop.light.png)

![Palette — dark · desktop](assets/palette.desktop.dark.png)

![Palette — light · mobile](assets/palette.mobile.light.png)

## Sign in
<a id="login"></a>

Sign-in page. Used when entering the remote-mode wiring; otherwise the app runs fully local.

**Validation.** tests/e2e/signIn.spec.ts — login form mounts and validates basic input.

![Sign in — light · desktop](assets/login.desktop.light.png)

![Sign in — dark · desktop](assets/login.desktop.dark.png)

![Sign in — light · mobile](assets/login.mobile.light.png)

---

## Corner cases covered

- Long labels — feature manifest entries with `-long` suffix flex the layout.
- Empty / error states — surfaces seed deterministic empty data when no run exists.
- Reduced motion — enable with `SMITHERS_CAPTURE_REDUCED_MOTION=1`; emits a `.reduced` variant.
- Dark / light themes — both captured for every surface unless explicitly opted out.
- Mobile viewport (390×844) — captured for every surface unless explicitly opted out.
- Capture failure — surfaces that fail are kept in the manifest with `status: "failed"` and surfaced in the deck as placeholders, never silently dropped.
