/**
 * Slideshow generator. Reads {@link manifestPath} from the capture run and
 * emits two artifacts beside it:
 *
 *   - SLIDESHOW.md  Markdown summary (one section per surface, with embedded
 *                   screenshots, descriptions, and the test that proves it).
 *   - slideshow.html  Self-contained, zero-dependency HTML deck with prev/next
 *                   navigation, working theme + device filter toggles, and
 *                   motion frame sequences captioned by phase id.
 *
 * Designed to be safe to run even when the capture script ran in `--dry-run`
 * mode: the manifest still describes every planned slide, and the generator
 * substitutes a placeholder card for any shot that has no PNG on disk. A
 * dry-run manifest (`manifest.dry-run.json`) produces sibling
 * `SLIDESHOW.dry-run.md` + `slideshow.dry-run.html` artifacts so it never
 * clobbers the live deck.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

type MotionFrame =
  | { id: string; label: string; path: string }
  | string;

type Shot = {
  id: string;
  surfaceId: string;
  title: string;
  filename: string;
  status: "captured" | "skipped" | "failed";
  error?: string;
  motionFrames?: MotionFrame[];
  bytes?: number;
  variant: { theme: "light" | "dark"; device: "desktop" | "mobile"; reducedMotion?: boolean };
  description: string;
  validation: string;
};

type Manifest = {
  baseUrl: string;
  outDir: string;
  startedAt: number;
  finishedAt: number;
  dryRun: boolean;
  shots: Shot[];
};

const APP_ROOT = resolve(new URL(".", import.meta.url).pathname, "..", "..");
const MANIFEST_DEFAULT_DIR = resolve(APP_ROOT, "docs/slideshow");

type Slide = {
  surfaceId: string;
  title: string;
  description: string;
  validation: string;
  shots: Shot[];
};

function groupBySurface(manifest: Manifest): Slide[] {
  const order: string[] = [];
  const bucket = new Map<string, Slide>();
  for (const shot of manifest.shots) {
    let slide = bucket.get(shot.surfaceId);
    if (!slide) {
      slide = {
        surfaceId: shot.surfaceId,
        title: shot.title,
        description: shot.description,
        validation: shot.validation,
        shots: [],
      };
      bucket.set(shot.surfaceId, slide);
      order.push(shot.surfaceId);
    }
    slide.shots.push(shot);
  }
  return order.map((id) => bucket.get(id)!);
}

function variantLabel(shot: Shot): string {
  const parts = [shot.variant.theme, shot.variant.device];
  if (shot.variant.reducedMotion) parts.push("reduced-motion");
  return parts.join(" · ");
}

function statusBadge(shot: Shot): string {
  if (shot.status === "captured") return "✓ captured";
  if (shot.status === "failed") return `✗ failed: ${shot.error ?? "unknown"}`;
  return "· planned";
}

function frameInfo(frame: MotionFrame): { path: string; label: string; id: string } {
  if (typeof frame === "string") {
    return { path: frame, label: basename(frame, ".png"), id: basename(frame, ".png") };
  }
  return { path: frame.path, label: frame.label, id: frame.id };
}

function relForMd(outDir: string, mdPath: string, filename: string): string {
  const abs = resolve(outDir, filename);
  return relative(dirname(mdPath), abs).split("\\").join("/");
}

export function renderMarkdown(manifest: Manifest, mdPath: string): string {
  const slides = groupBySurface(manifest);
  const lines: string[] = [];
  lines.push("# Smithers — feature validation slideshow");
  lines.push("");
  lines.push(
    `Generated from a capture run against \`${manifest.baseUrl}\` (` +
      (manifest.dryRun ? "dry-run plan" : "live") +
      `, ${slides.length} surfaces, ${manifest.shots.length} shots).`,
  );
  lines.push("");
  lines.push("Every section describes one feature, shows desktop + mobile + dark");
  lines.push("variants when available, and links to the Playwright spec that proves it.");
  lines.push("");
  lines.push("## Index");
  lines.push("");
  for (const slide of slides) {
    lines.push(`- [${slide.title}](#${slide.surfaceId})`);
  }
  lines.push("");
  for (const slide of slides) {
    lines.push(`## ${slide.title}`);
    lines.push(`<a id="${slide.surfaceId}"></a>`);
    lines.push("");
    lines.push(slide.description);
    lines.push("");
    lines.push(`**Validation.** ${slide.validation}`);
    lines.push("");
    for (const shot of slide.shots) {
      const rel = relForMd(manifest.outDir, mdPath, shot.filename);
      const captured = shot.status === "captured" && existsSync(resolve(manifest.outDir, shot.filename));
      if (captured) {
        lines.push(`![${slide.title} — ${variantLabel(shot)}](${rel})`);
      } else {
        lines.push(`> _${variantLabel(shot)} — ${statusBadge(shot)}_`);
      }
      lines.push("");
    }
    if (slide.shots.some((s) => s.motionFrames && s.motionFrames.length)) {
      lines.push("Motion frames (interaction sequence):");
      for (const shot of slide.shots) {
        for (const frame of shot.motionFrames ?? []) {
          const info = frameInfo(frame);
          const rel = relForMd(manifest.outDir, mdPath, info.path);
          lines.push(`- ![${info.label}](${rel}) — _${info.label}_`);
        }
      }
      lines.push("");
    }
  }
  lines.push("---");
  lines.push("");
  lines.push("## Corner cases covered");
  lines.push("");
  lines.push("- Long labels — feature manifest entries with `-long` suffix flex the layout.");
  lines.push("- Empty / error states — surfaces seed deterministic empty data when no run exists.");
  lines.push("- Reduced motion — enable with `SMITHERS_CAPTURE_REDUCED_MOTION=1`; emits a `.reduced` variant.");
  lines.push("- Dark / light themes — both captured for every surface unless explicitly opted out.");
  lines.push("- Mobile viewport (390×844) — captured for every surface unless explicitly opted out.");
  lines.push("- Capture failure — surfaces that fail are kept in the manifest with `status: \"failed\"` and surfaced in the deck as placeholders, never silently dropped.");
  lines.push("");
  return lines.join("\n");
}

export function renderHtml(manifest: Manifest, htmlPath: string): string {
  const slides = groupBySurface(manifest);
  const enc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const slideHtml = slides
    .map((slide, i) => {
      const shotsHtml = slide.shots
        .map((shot) => {
          const captured =
            shot.status === "captured" && existsSync(resolve(manifest.outDir, shot.filename));
          const rel = relForMd(manifest.outDir, htmlPath, shot.filename);
          const motion =
            shot.motionFrames && shot.motionFrames.length
              ? `<div class="motion"><strong>motion:</strong> ` +
                shot.motionFrames
                  .map((f) => {
                    const info = frameInfo(f);
                    const src = enc(relForMd(manifest.outDir, htmlPath, info.path));
                    return `<figure class="motion-frame"><img src="${src}" alt="${enc(info.label)}"><figcaption>${enc(info.label)}</figcaption></figure>`;
                  })
                  .join("") +
                `</div>`
              : "";
          const dataAttrs = `data-theme="${enc(shot.variant.theme)}" data-device="${enc(shot.variant.device)}"`;
          if (captured) {
            return `<figure class="shot ${shot.variant.theme} ${shot.variant.device}" ${dataAttrs}>
              <img loading="lazy" src="${enc(rel)}" alt="${enc(slide.title)} — ${enc(variantLabel(shot))}">
              <figcaption>${enc(variantLabel(shot))}</figcaption>
              ${motion}
            </figure>`;
          }
          return `<figure class="shot placeholder ${shot.variant.theme} ${shot.variant.device}" ${dataAttrs}>
            <div class="ph">${enc(variantLabel(shot))} — ${enc(statusBadge(shot))}</div>
          </figure>`;
        })
        .join("\n");
      return `<section class="slide" data-index="${i}" id="${enc(slide.surfaceId)}">
        <header>
          <h2>${enc(slide.title)}</h2>
          <p class="desc">${enc(slide.description)}</p>
          <p class="val"><strong>Validation:</strong> ${enc(slide.validation)}</p>
        </header>
        <div class="shots">${shotsHtml}</div>
      </section>`;
    })
    .join("\n");
  const navHtml = slides
    .map((s, i) => `<a href="#${enc(s.surfaceId)}" data-jump="${i}">${enc(s.title)}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Smithers — feature validation slideshow</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root {
    --bg: #0d1117; --fg: #f1f5f9; --muted: #94a3b8;
    --card: #161b22; --border: #30363d; --accent: #6d56d8;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f8fafc; --fg:#0f172a; --muted:#475569; --card:#fff; --border:#e2e8f0; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--fg); }
  header.top { position: sticky; top: 0; z-index: 5; padding: 12px 16px; background: var(--card); border-bottom: 1px solid var(--border); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  header.top h1 { font-size: 16px; margin: 0; }
  header.top nav { display: flex; gap: 8px; flex-wrap: wrap; overflow-x: auto; max-width: 60vw; }
  header.top nav a { color: var(--muted); text-decoration: none; padding: 4px 8px; border-radius: 6px; }
  header.top nav a:hover, header.top nav a.active { color: var(--fg); background: var(--bg); }
  .filters { display: flex; gap: 6px; align-items: center; margin-left: auto; }
  .filters .group { display: inline-flex; gap: 4px; padding: 2px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
  .filters button { font: inherit; color: var(--muted); background: transparent; border: 0; padding: 4px 10px; border-radius: 6px; cursor: pointer; }
  .filters button[aria-pressed="true"] { background: var(--card); color: var(--fg); }
  .filters .label { font-size: 12px; color: var(--muted); margin-right: 4px; }
  main { padding: 16px; max-width: 1200px; margin: 0 auto; }
  section.slide { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin: 16px 0; }
  section.slide h2 { margin: 0 0 8px; font-size: 20px; }
  section.slide .desc { color: var(--fg); margin: 0 0 6px; }
  section.slide .val { color: var(--muted); margin: 0 0 16px; font-size: 13px; }
  .shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  .shot { margin: 0; border: 1px solid var(--border); border-radius: 8px; padding: 8px; background: var(--bg); }
  .shot img { width: 100%; height: auto; display: block; border-radius: 4px; }
  .shot figcaption { font-size: 12px; color: var(--muted); margin-top: 6px; text-align: center; }
  .shot.placeholder { display: grid; place-items: center; min-height: 180px; color: var(--muted); border-style: dashed; }
  .shot.placeholder .ph { font-size: 13px; text-align: center; padding: 12px; }
  .shot[hidden] { display: none; }
  .motion { margin-top: 8px; display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 6px; }
  .motion strong { grid-column: 1 / -1; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .motion-frame { margin: 0; }
  .motion-frame img { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 4px; display: block; }
  .motion-frame figcaption { font-size: 10px; color: var(--muted); text-align: center; margin-top: 2px; }
  footer { padding: 24px 16px; text-align: center; color: var(--muted); font-size: 12px; }
  .keys { color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header class="top">
  <h1>Smithers — feature validation slideshow</h1>
  <nav>${navHtml}</nav>
  <span class="keys">← / → to navigate</span>
  <div class="filters" role="toolbar" aria-label="Slide filters">
    <span class="label">Theme</span>
    <div class="group" data-filter="theme">
      <button type="button" data-value="all" aria-pressed="true">All</button>
      <button type="button" data-value="light" aria-pressed="false">Light</button>
      <button type="button" data-value="dark" aria-pressed="false">Dark</button>
    </div>
    <span class="label">Device</span>
    <div class="group" data-filter="device">
      <button type="button" data-value="all" aria-pressed="true">All</button>
      <button type="button" data-value="desktop" aria-pressed="false">Desktop</button>
      <button type="button" data-value="mobile" aria-pressed="false">Mobile</button>
    </div>
  </div>
</header>
<main>${slideHtml}</main>
<footer>
  ${slides.length} surfaces · captured against <code>${enc(manifest.baseUrl)}</code>
  ${manifest.dryRun ? " · <strong>dry-run plan</strong> (no images)" : ""}
</footer>
<script>
  // Keyboard prev/next between slides.
  const slides = Array.from(document.querySelectorAll('section.slide'));
  let active = 0;
  function go(i) {
    active = Math.max(0, Math.min(slides.length - 1, i));
    slides[active].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(active + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(active - 1); }
  });
  // Track which slide is in view to highlight the nav link.
  const links = Array.from(document.querySelectorAll('header.top nav a'));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const idx = slides.indexOf(e.target);
        if (idx >= 0) {
          active = idx;
          links.forEach((l, i) => l.classList.toggle('active', i === idx));
        }
      }
    }
  }, { threshold: 0.4 });
  slides.forEach((s) => io.observe(s));
  // Theme + device filter toggles — hide shots that do not match the
  // selected combination. "all" matches anything.
  const state = { theme: 'all', device: 'all' };
  function apply() {
    document.querySelectorAll('.shot').forEach((el) => {
      const theme = el.getAttribute('data-theme');
      const device = el.getAttribute('data-device');
      const matchTheme = state.theme === 'all' || theme === state.theme;
      const matchDevice = state.device === 'all' || device === state.device;
      if (matchTheme && matchDevice) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    });
  }
  document.querySelectorAll('.filters .group').forEach((group) => {
    const kind = group.getAttribute('data-filter');
    group.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
      state[kind] = btn.getAttribute('data-value');
      apply();
    });
  });
</script>
</body>
</html>
`;
}

/**
 * Pick the manifest path matching the current capture mode. Live captures
 * default to `manifest.json`; dry-runs default to `manifest.dry-run.json`.
 * An explicit argument always wins. When no flag is provided, prefer the
 * dry-run manifest if it exists and is newer than the live manifest, which is
 * what `capture:dry` produces immediately before slideshow generation.
 */
export function resolveManifestPath(
  arg: string | undefined,
  options: { baseDir?: string; preferDryRun?: boolean } = {},
): string {
  if (arg) return arg;
  const baseDir = options.baseDir ?? MANIFEST_DEFAULT_DIR;
  const liveDefault = join(baseDir, "manifest.json");
  const dryRunDefault = join(baseDir, "manifest.dry-run.json");
  if (options.preferDryRun || Boolean(process.env.SMITHERS_CAPTURE_DRY_RUN)) {
    return dryRunDefault;
  }
  if (existsSync(dryRunDefault)) {
    if (!existsSync(liveDefault)) return dryRunDefault;
    if (statSync(dryRunDefault).mtimeMs >= statSync(liveDefault).mtimeMs) {
      return dryRunDefault;
    }
  }
  return liveDefault;
}

/**
 * Pick output filenames for the markdown + html artifacts. Dry-run manifests
 * write to `SLIDESHOW.dry-run.md` / `slideshow.dry-run.html` so they never
 * clobber the committed live deck.
 */
function outputPathsFor(manifestPath: string, dryRun: boolean): { mdPath: string; htmlPath: string } {
  const dir = dirname(manifestPath);
  if (dryRun) {
    return {
      mdPath: join(dir, "SLIDESHOW.dry-run.md"),
      htmlPath: join(dir, "slideshow.dry-run.html"),
    };
  }
  return {
    mdPath: join(dir, "SLIDESHOW.md"),
    htmlPath: join(dir, "slideshow.html"),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const preferDryRun = args.includes("--dry-run") || args.includes("-n");
  const manifestArg = args.find((arg) => arg !== "--dry-run" && arg !== "-n");
  const manifestPath = resolveManifestPath(manifestArg, { preferDryRun });
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as Manifest;

  const { mdPath, htmlPath } = outputPathsFor(manifestPath, manifest.dryRun);
  await writeFile(mdPath, renderMarkdown(manifest, mdPath));
  await writeFile(htmlPath, renderHtml(manifest, htmlPath));
  console.log(
    `[slideshow] wrote ${mdPath} and ${htmlPath} (` +
      `${manifest.shots.length} shots across ${new Set(manifest.shots.map((s) => s.surfaceId)).size} surfaces` +
      (manifest.dryRun ? "; dry-run plan" : "") +
      `)`,
  );
}

const isMain =
  // @ts-expect-error bun extension
  (typeof import.meta !== "undefined" && import.meta.main) ||
  (typeof process !== "undefined" &&
    process.argv[1] &&
    (process.argv[1].endsWith("generateSlideshow.ts") || process.argv[1].endsWith("generateSlideshow.js")));

if (isMain) {
  main().catch((error) => {
    console.error("[slideshow] fatal:", error);
    process.exit(1);
  });
}
