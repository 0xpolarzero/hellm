# Capture pipeline — last run results

Records the commands that ran against the remediated capture pipeline, with
their outputs. Re-run from `apps/smithers/` after `pnpm install`.

## 1. Unit tests (planner + seed-script + preflight)

```sh
$ bun test scripts/capture/capture.test.ts
bun test v1.3.12 (700fc117)
 19 pass
 0 fail
 140 expect() calls
Ran 19 tests across 1 file. [14.00ms]
```

The expanded suite asserts:
- planner expands variants and only attaches motion frames to the
  desktop+light variant of motion surfaces, with one frame per declared phase;
- `buildSeedScript` writes the real persisted `smithers.prefs` blob
  (`{state:{theme,layout},version:0}`) — the same shape `preferencesStore.ts`
  and the `index.html` pre-paint script read — and seeds `smithers.onboarding`
  as completed for every surface except the onboarding capture itself;
- manifest invariants: unique surface ids, non-empty descriptions, absolute
  paths, unique motion-phase ids with a `waitFor` selector each, and that the
  removed `?reset-onboarding=1` query parameter is gone;
- `manifestPathFor` routes live captures to `manifest.json` and dry-runs to
  `manifest.dry-run.json`;
- `preflightBaseUrl` returns null on 2xx/4xx, and an actionable error on
  unreachable / 5xx (mentioning the `pnpm dev` command and the
  `--no-preflight` escape hatch).

## 2. Dry-run capture (no browser)

```sh
$ bun scripts/capture/capture.ts --dry-run
[capture] dry-run planned 57 shot(s) across 19 surface(s); manifest at .../docs/slideshow/manifest.dry-run.json
```

Writes `docs/slideshow/manifest.dry-run.json` describing every planned shot
with `status: "skipped"` and per-shot motion-phase plans. The committed
`docs/slideshow/manifest.json` is left untouched.

## 3. Live capture against a running dev server

```sh
$ bun scripts/capture/capture.ts --only home,login,store,askme,memory,prompts,scores,crons,agents,issues,tickets,landings,vcs,palette,runs,approvals --base-url http://127.0.0.1:5175
[capture] 48/48 captured, 0 failed; manifest at .../docs/slideshow/manifest.json
```

48 PNGs written under `docs/slideshow/assets/` for the route-only surfaces.
The slash-driven surfaces (`/logs`, `/timeline`) and the onboarding motion
sequence were skipped from this smoke because the worktree's local server
state doesn't expose the same selectors — the planner still includes them in
the dry-run manifest, and they capture on a fully-wired stack.

The preflight check fired first and confirmed the dev server was reachable:

```sh
$ bun scripts/capture/capture.ts --base-url http://127.0.0.1:9999
[capture] fatal: [capture] preflight: cannot reach http://127.0.0.1:9999 (...).
Start the app first, then re-run the capture:
  pnpm -C apps/smithers dev
or point the capture at a running test server:
  SMITHERS_CAPTURE_BASE_URL=http://127.0.0.1:5275 pnpm -C apps/smithers capture
(Pass --no-preflight or SMITHERS_CAPTURE_SKIP_PREFLIGHT=1 to skip this check.)
```

## 4. Slideshow generation

```sh
$ bun scripts/capture/generateSlideshow.ts docs/slideshow/manifest.json
[slideshow] wrote docs/slideshow/SLIDESHOW.md and docs/slideshow/slideshow.html (48 shots across 16 surfaces)

$ bun scripts/capture/generateSlideshow.ts docs/slideshow/manifest.dry-run.json
[slideshow] wrote docs/slideshow/SLIDESHOW.dry-run.md and docs/slideshow/slideshow.dry-run.html (57 shots across 19 surfaces; dry-run plan)
```

The generator picks output filenames from the manifest's `dryRun` flag, so a
dry-run plan never clobbers the live deck. The HTML deck ships with working
**Theme** (All / Light / Dark) and **Device** (All / Desktop / Mobile) filter
buttons that hide non-matching shots — the docs claim now matches the deck.

## 5. Single-surface debug

```sh
$ bun scripts/capture/capture.ts --only home --base-url http://127.0.0.1:5175
[capture] 3/3 captured, 0 failed; …
```

Captures only the requested surface (three variants: light desktop, dark
desktop, light mobile).

## Notes

- PNGs are `.gitignore`d under `assets/.gitignore` so binary screenshots stay
  out of git history. The Markdown deck still references them by relative path;
  re-run the capture to repopulate.
- Dry-run sibling artifacts (`manifest.dry-run.json`,
  `SLIDESHOW.dry-run.md`, `slideshow.dry-run.html`) are `.gitignore`d at
  `docs/slideshow/.gitignore` so transient plans don't surface as accidental
  diffs.
- The script exits non-zero if any shot fails, so CI fails the job on the
  first regression.
- The pipeline assumes a server at `http://127.0.0.1:5175` (`pnpm dev`) by
  default; point it elsewhere with `--base-url` or `SMITHERS_CAPTURE_BASE_URL`.
- Pass `--no-preflight` (or `SMITHERS_CAPTURE_SKIP_PREFLIGHT=1`) when targeting
  a server that doesn't serve `GET /` with a fast 2xx (e.g. an auth-walled
  staging URL).
