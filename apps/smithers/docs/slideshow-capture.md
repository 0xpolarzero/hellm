# Slideshow capture pipeline

A Playwright-driven harness that runs the local Smithers PWA, visits every major
feature surface, and emits a deterministic slideshow artifact (Markdown + static
HTML) with screenshots and a one-paragraph summary per feature, plus a pointer
to the Playwright spec that proves the surface works.

Lives entirely under `apps/smithers/scripts/capture/` (driver, manifest,
generator, tests) and writes its output under `apps/smithers/docs/slideshow/`.
Nothing else in the app changes — selectors and routes already exist for the
Playwright e2e suite, and the capture re-uses them.

## Files

| Path                                                   | Purpose                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `scripts/capture/surfaces.ts`                          | Manifest: every feature, how to reach it, what to wait for, what proves it. |
| `scripts/capture/capture.ts`                           | Playwright driver. Plans shots, opens contexts, writes PNGs + manifest.    |
| `scripts/capture/generateSlideshow.ts`                 | Reads `manifest.json` → writes `SLIDESHOW.md` + `slideshow.html`.          |
| `scripts/capture/capture.test.ts`                      | Bun unit tests for the planner, seed-script, and preflight check.          |
| `docs/slideshow/manifest.json`                         | Live capture report (run params + per-shot status). Tracked in git.        |
| `docs/slideshow/manifest.dry-run.json`                 | Dry-run plan (no PNGs). Written instead of `manifest.json` when `--dry-run`. |
| `docs/slideshow/SLIDESHOW.md`                          | Generated Markdown slideshow.                                              |
| `docs/slideshow/slideshow.html`                        | Generated zero-dep HTML deck (← / → to navigate; theme + device filters).   |
| `docs/slideshow/SLIDESHOW.dry-run.md`                  | Dry-run sibling, emitted when the generator reads a dry-run manifest.       |
| `docs/slideshow/slideshow.dry-run.html`                | Dry-run sibling for the HTML deck.                                          |
| `docs/slideshow/assets/`                               | PNG screenshots (`<surface>.<device>.<theme>.png`). Gitignored.             |
| `docs/slideshow/assets/motion/`                        | Motion frame sequences (`<surface>.frame-<phase-id>.png`). Gitignored.      |

## Usage

```sh
# 1. Start the app (any of these works; default base-url is :5175):
pnpm -C apps/smithers dev
# … or run the full e2e webServer fixtures and capture against :5275:
SMITHERS_CAPTURE_BASE_URL=http://127.0.0.1:5275 pnpm -C apps/smithers capture

# 2. Capture every surface (writes PNGs + manifest.json):
pnpm -C apps/smithers capture

# 3. Plan only — no browser, no PNGs, writes manifest.dry-run.json:
pnpm -C apps/smithers capture:dry

# 4. Render Markdown + HTML slideshow from the manifest:
pnpm -C apps/smithers capture:slideshow
# … or render the dry-run plan:
pnpm -C apps/smithers capture:slideshow docs/slideshow/manifest.dry-run.json
```

Single-surface debug:

```sh
pnpm -C apps/smithers capture -- --only memory
pnpm -C apps/smithers capture -- --only home,memory,timeline
```

Reduced-motion variants (adds a `.reduced` clone for motion surfaces like
`/onboarding`):

```sh
SMITHERS_CAPTURE_REDUCED_MOTION=1 pnpm -C apps/smithers capture
```

## Preflight

Live captures hit `${baseUrl}/` before launching Playwright. If the server is
unreachable (or returns 5xx) the capture aborts with an actionable error —
no half-written manifest, no orphaned browser:

```
[capture] preflight: cannot reach http://127.0.0.1:5175 (fetch failed).
Start the app first, then re-run the capture:
  pnpm -C apps/smithers dev
or point the capture at a running test server:
  SMITHERS_CAPTURE_BASE_URL=http://127.0.0.1:5275 pnpm -C apps/smithers capture
(Pass --no-preflight or SMITHERS_CAPTURE_SKIP_PREFLIGHT=1 to skip this check.)
```

Pass `--no-preflight` (or set `SMITHERS_CAPTURE_SKIP_PREFLIGHT=1`) when the
target server doesn't serve `GET /` with a fast 2xx — e.g. a remote staging
URL behind auth — and rely on the per-shot timeouts instead. Dry-runs skip
the preflight entirely.

## What gets captured

Every surface produces three baseline shots (light desktop, dark desktop, light
mobile @ 390×844) unless the manifest opts out (`mobile: false`, `dark: false`).
Motion surfaces additionally write a small frame sequence into `assets/motion/`
that the slideshow renders inline, captioned by phase id.

### Surfaces (current)

Routes — `/`, `/store`, `/askme`, `/runs`, `/approvals`, `/agents`, `/memory`,
`/prompts`, `/scores`, `/crons`, `/issues`, `/tickets`, `/landings`, `/vcs`,
`/palette`, `/login`.

Slash-driven — `/logs` (logs canvas), `/timeline` (time-travel scrubber). Each
auto-launches a run from the home composer.

Motion — first-run onboarding. The driver removes the persisted
`smithers.onboarding` flag for this surface only and visits `/`, so the splash
overlay appears the way a brand-new visitor sees it. The motion sequence then
drives the overlay forward through three named phases:

| Phase id   | Wait selector                                                   | Setup |
| ---------- | ---------------------------------------------------------------- | ----- |
| `intro`    | `.ob-intro .ob-mark`                                             | —     |
| `welcome`  | `[role="dialog"][aria-label="Welcome to Smithers"] .ob-goal-input` | click `.ob-begin` |
| `build`    | `.ob-graph .node-title`                                          | fill the goal field, click `.ob-goal-send` |

Adding a new feature means appending one entry to `SURFACES` in
`scripts/capture/surfaces.ts`. The unit tests verify uniqueness, route shape,
that every entry has a description + validation note, and that motion phases
declare unique ids and a wait selector.

## Corner cases

- **Long labels** — the manifest is data, so adding a surface variant with a
  long-label fixture (e.g. `id: "agents-long-labels"`) is a one-line change.
- **Empty / error states** — surfaces own their empty-state markup (see e.g.
  `apps/smithers/src/scores/ScoresCanvas.tsx` → `data-testid="scores-empty"`).
  The driver already lands on the empty state when no run exists for the
  workspace.
- **Reduced motion** — opt in with `SMITHERS_CAPTURE_REDUCED_MOTION=1`. The
  driver emulates `prefers-reduced-motion: reduce` AND sets a CSS hook
  (`<html data-reduced-motion>`) so styles can branch on either signal.
- **Dark / light themes** — every shot writes the real persisted preferences
  blob (`localStorage["smithers.prefs"] = {state:{theme,layout},version:0}`)
  before the page paints, and pairs it with Playwright's `colorScheme`
  emulation. The pre-paint script in `index.html` reads the same key, so the
  app boots into the requested theme with no flash.
- **Mobile viewport (390×844)** — captured for every surface unless opted out.
- **Capture failure** — a shot that throws is recorded in `manifest.json` with
  `status: "failed"` and surfaced in the deck as a placeholder card, so
  regressions are loud, not silent. The script exits non-zero when any shot
  fails so CI fails the job.
- **Dry-run vs live outputs** — `--dry-run` writes a separate
  `manifest.dry-run.json` (and the generator writes
  `SLIDESHOW.dry-run.md` + `slideshow.dry-run.html`) so iterating on the plan
  never clobbers the committed live deck.

## Asset / git policy

- `docs/slideshow/assets/.gitignore` ignores every `*.png` and `motion/*.png`,
  so binary screenshots stay out of git history. The Markdown deck still
  references them by relative path; re-run the capture to repopulate.
- `manifest.json`, `SLIDESHOW.md`, `slideshow.html` ARE tracked — they're the
  canonical record of the last live capture and the entry point for reviewers.
- `manifest.dry-run.json`, `SLIDESHOW.dry-run.md`, `slideshow.dry-run.html` are
  also gitignored so transient dry-runs don't surface as accidental diffs.

## Generated HTML deck

`slideshow.html` is single-file, framework-free, and ships with:

- Sticky top bar with a nav strip (click a surface name to jump).
- ← / → and PageDown / PageUp keyboard navigation.
- IntersectionObserver-driven nav highlighting that follows the active slide.
- Working **Theme** (All / Light / Dark) and **Device** (All / Desktop / Mobile)
  filter buttons that toggle which shots are visible. Selecting *Dark + Mobile*
  hides everything but the dark-mobile variants across every surface.
- Motion frames rendered as captioned tiles by phase id.

## Validation evidence

Every slide cites the Playwright spec that proves the surface works. The full
mapping lives in the manifest's `validation` field. The slideshow generator
embeds it as the `**Validation:**` line on each slide.

Running the validation suite:

```sh
pnpm -C apps/smithers e2e
```

Running just the slideshow planner tests:

```sh
pnpm -C apps/smithers test scripts/capture/capture.test.ts
```

## Implementation notes

- The driver uses dynamic `import("playwright")` so `--dry-run` works without
  Playwright on the path (useful in linting envs).
- Output paths are resolved relative to `apps/smithers/` (the package root),
  so the script works whether invoked from the repo root or the package dir.
- The HTML deck is single-file and ships with no JS frameworks; it loads
  images lazily and uses `IntersectionObserver` for nav highlighting.
- `manifest.json` is the source of truth: re-running the generator after a
  partial capture produces a deck that mixes captured shots with placeholders
  for the rest, instead of failing outright.
- The seed script writes the real persisted shape under `smithers.prefs`
  (matching `apps/smithers/src/app/preferencesStore.ts`) plus
  `smithers.onboarding`. Drop the in-page hook (`data-theme`) and the
  Playwright `colorScheme` emulation both converge on the same theme.
