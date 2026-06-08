/**
 * Visual capture pipeline for the Smithers PWA.
 *
 * Drives the real local app via Playwright, visits every surface in
 * {@link SURFACES}, and writes deterministic screenshots (and short frame
 * sequences for motion entries) for the slideshow generator.
 *
 * Usage:
 *   bun apps/smithers/scripts/capture/capture.ts          — real run, writes PNGs
 *   bun apps/smithers/scripts/capture/capture.ts --dry-run — plan only, no browser
 *   bun apps/smithers/scripts/capture/capture.ts --base-url http://127.0.0.1:5175
 *
 * Env:
 *   SMITHERS_CAPTURE_BASE_URL    base URL of a running dev or preview server
 *   SMITHERS_CAPTURE_OUT_DIR     output directory (default: apps/smithers/docs/slideshow/assets)
 *   SMITHERS_CAPTURE_DRY_RUN     set non-empty for a no-browser plan
 *   SMITHERS_CAPTURE_REDUCED_MOTION  set non-empty to also capture reduced-motion variants
 *
 * The script never overwrites unrelated files. Live captures write
 * `manifest.json` (the source of truth the generator consumes by default).
 * Dry-runs write `manifest.dry-run.json` instead so iterating on the plan
 * never clobbers tracked, real-capture state.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  DEFAULT_VARIANTS,
  type CaptureVariant,
  type DeviceVariant,
  type MotionPhase,
  type SurfaceEntry,
  type ThemeVariant,
  SURFACES,
} from "./surfaces";

type CliFlags = {
  dryRun: boolean;
  baseUrl: string;
  outDir: string;
  reducedMotion: boolean;
  surfaceFilter: Set<string> | null;
  skipPreflight: boolean;
};

/**
 * Default output path is resolved relative to the apps/smithers root (the
 * package directory two levels above this script). This keeps the same path
 * whether the script is launched from the repo root (`bun apps/smithers/...`)
 * or from inside `apps/smithers` (`pnpm capture`).
 */
const APP_ROOT = resolve(new URL(".", import.meta.url).pathname, "..", "..");
const OUTPUT_DEFAULT = resolve(APP_ROOT, "docs/slideshow/assets");

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    dryRun:
      argv.includes("--dry-run") ||
      argv.includes("-n") ||
      Boolean(process.env.SMITHERS_CAPTURE_DRY_RUN),
    baseUrl:
      pickArg(argv, "--base-url") ||
      process.env.SMITHERS_CAPTURE_BASE_URL ||
      "http://127.0.0.1:5175",
    outDir:
      pickArg(argv, "--out-dir") ||
      process.env.SMITHERS_CAPTURE_OUT_DIR ||
      OUTPUT_DEFAULT,
    reducedMotion: Boolean(process.env.SMITHERS_CAPTURE_REDUCED_MOTION),
    surfaceFilter: null,
    skipPreflight:
      argv.includes("--no-preflight") ||
      Boolean(process.env.SMITHERS_CAPTURE_SKIP_PREFLIGHT),
  };
  const only = pickArg(argv, "--only");
  if (only) flags.surfaceFilter = new Set(only.split(","));
  return flags;
}

function pickArg(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
}

type PlannedShot = {
  id: string;
  surfaceId: string;
  title: string;
  variant: CaptureVariant & { reducedMotion?: boolean };
  filename: string;
  description: string;
  validation: string;
  motionPhases?: Array<{ id: string; label: string; filename: string }>;
};

export function planShots(surfaces: SurfaceEntry[], reducedMotion: boolean): PlannedShot[] {
  const shots: PlannedShot[] = [];
  for (const surface of surfaces) {
    const variants = expandVariants(surface, reducedMotion);
    for (const variant of variants) {
      const captureMotion =
        surface.motion && variant.device === "desktop" && variant.theme === "light";
      shots.push({
        id: `${surface.id}-${variant.theme}-${variant.device}${variant.reducedMotion ? "-reduced" : ""}`,
        surfaceId: surface.id,
        title: surface.title,
        variant,
        filename: `${surface.id}.${variant.device}.${variant.theme}${variant.reducedMotion ? ".reduced" : ""}.png`,
        description: surface.description,
        validation: surface.validation,
        motionPhases: captureMotion
          ? surface.motion!.phases.map((phase) => ({
              id: phase.id,
              label: phase.label,
              filename: `motion/${surface.id}.frame-${phase.id}.png`,
            }))
          : undefined,
      });
    }
  }
  return shots;
}

function expandVariants(
  surface: SurfaceEntry,
  reducedMotion: boolean,
): Array<CaptureVariant & { reducedMotion?: boolean }> {
  const base = DEFAULT_VARIANTS.filter((v) => {
    if (surface.mobile === false && v.device === "mobile") return false;
    if (surface.dark === false && v.theme === "dark") return false;
    return true;
  });
  if (!reducedMotion) return base;
  // Add reduced-motion clones of the desktop light variant for motion surfaces.
  if (!surface.motion) return base;
  return [
    ...base,
    { theme: "light", device: "desktop", reducedMotion: true },
  ];
}

type CaptureReport = {
  baseUrl: string;
  outDir: string;
  startedAt: number;
  finishedAt: number;
  dryRun: boolean;
  shots: Array<{
    id: string;
    surfaceId: string;
    title: string;
    filename: string;
    status: "captured" | "skipped" | "failed";
    error?: string;
    motionFrames?: Array<{ id: string; label: string; path: string }>;
    bytes?: number;
    variant: CaptureVariant & { reducedMotion?: boolean };
    description: string;
    validation: string;
  }>;
};

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/**
 * Manifests live next to the assets directory. Dry-runs target a separate
 * `manifest.dry-run.json` so iterating on the plan never clobbers the tracked
 * live `manifest.json` (which the generator and committed SLIDESHOW.md read).
 */
export function manifestPathFor(outDir: string, dryRun: boolean): string {
  const file = dryRun ? "manifest.dry-run.json" : "manifest.json";
  return resolve(outDir, "..", file);
}

async function writeReport(outDir: string, report: CaptureReport): Promise<void> {
  const manifestPath = manifestPathFor(outDir, report.dryRun);
  await ensureDir(dirname(manifestPath));
  await writeFile(manifestPath, JSON.stringify(report, null, 2) + "\n");
}

/** Map a device variant to a Playwright viewport. */
function viewportFor(device: DeviceVariant): { width: number; height: number } {
  return device === "mobile"
    ? { width: 390, height: 844 } // iPhone 14
    : { width: 1440, height: 900 }; // MacBook-ish
}

/**
 * Build the document-init seed for a given variant. Exposed for tests so the
 * shape is asserted, not assumed.
 *
 * - Writes the persisted preferences zustand blob under `smithers.prefs` so the
 *   in-page pre-paint script (`index.html`) resolves the theme without a flash,
 *   and the `usePreferencesStore` rehydrates to the requested theme.
 * - Writes the persisted onboarding flag under `smithers.onboarding` for every
 *   surface except the onboarding one itself (where it must be missing so the
 *   overlay appears for a real first-run capture).
 * - Pins `data-theme` on `<html>` as a belt-and-braces hook for CSS that
 *   branches on the attribute (the preferences store does the same after
 *   hydration; both writes converge on the same value).
 * - When `reducedMotion` is requested, sets `data-reduced-motion` so any CSS
 *   that opts in via the attribute matches the Playwright `prefers-reduced-motion`
 *   emulation.
 */
export function buildSeedScript(
  theme: ThemeVariant,
  reducedMotion: boolean,
  surfaceId: string,
): string {
  const seedOnboarding = surfaceId !== "onboarding";
  const prefsBlob = JSON.stringify({
    state: { theme, layout: "normal" },
    version: 0,
  });
  const onboardingBlob = JSON.stringify({ state: { completed: true }, version: 0 });
  const onboardingStatement = seedOnboarding
    ? `localStorage.setItem('smithers.onboarding', ${JSON.stringify(onboardingBlob)});`
    : `localStorage.removeItem('smithers.onboarding');`;
  // The init script runs immediately on document creation — `documentElement`
  // may not exist yet, so anything that touches the DOM is deferred to
  // DOMContentLoaded. localStorage IS available immediately, so the persisted
  // blobs land before React's first hydration read.
  return `
    (() => {
      try { localStorage.setItem('smithers.prefs', ${JSON.stringify(prefsBlob)}); } catch (e) {}
      try { ${onboardingStatement} } catch (e) {}
      function applyAttrs() {
        try {
          var html = document.documentElement;
          if (!html) return;
          html.setAttribute('data-theme', ${JSON.stringify(theme)});
          if (${reducedMotion ? "true" : "false"}) {
            html.setAttribute('data-reduced-motion', 'true');
          }
        } catch (e) {}
      }
      if (document.documentElement) {
        applyAttrs();
      } else {
        document.addEventListener('DOMContentLoaded', applyAttrs, { once: true });
      }
    })();
  `;
}

type AnyPage = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  evaluate: (fn: string | ((arg?: unknown) => unknown), arg?: unknown) => Promise<unknown>;
  setViewportSize: (size: { width: number; height: number }) => Promise<void>;
  emulateMedia: (opts: { reducedMotion?: "reduce" | "no-preference"; colorScheme?: "light" | "dark" }) => Promise<void>;
  addInitScript: (script: string) => Promise<void>;
  waitForSelector: (sel: string, opts?: { timeout?: number; state?: string }) => Promise<unknown>;
  waitForURL: (predicate: (url: URL) => boolean, opts?: { timeout?: number }) => Promise<unknown>;
  screenshot: (opts: { path: string; fullPage?: boolean }) => Promise<Buffer>;
  locator: (selector: string) => {
    fill: (v: string) => Promise<unknown>;
    press: (k: string) => Promise<unknown>;
    click: () => Promise<unknown>;
    first: () => unknown;
  };
  getByRole: (role: string, opts?: { name?: string }) => {
    fill: (v: string) => Promise<unknown>;
    press: (k: string) => Promise<unknown>;
    click: () => Promise<unknown>;
  };
  close: () => Promise<void>;
};

type AnyBrowser = {
  newContext: (opts: {
    viewport: { width: number; height: number };
    deviceScaleFactor?: number;
    colorScheme?: "light" | "dark";
    reducedMotion?: "reduce" | "no-preference";
  }) => Promise<{
    newPage: () => Promise<AnyPage>;
    addInitScript: (script: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
  close: () => Promise<void>;
};

/**
 * Hit baseUrl/ before launching Playwright. Returns null on success, or an
 * actionable error message if the dev/preview server isn't running.
 *
 * Exposed for tests so we can assert the failure message verbatim.
 */
export async function preflightBaseUrl(
  baseUrl: string,
  fetcher: (url: string, opts?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }> = fetch,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetcher(baseUrl, { signal: ctrl.signal });
    if (res.ok || res.status < 500) return null;
    return [
      `[capture] preflight: ${baseUrl} responded with ${res.status}.`,
      `Start the app first, then re-run the capture:`,
      `  pnpm -C apps/smithers dev`,
      `or point the capture at a running test server:`,
      `  SMITHERS_CAPTURE_BASE_URL=http://127.0.0.1:5275 pnpm -C apps/smithers capture`,
    ].join("\n");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [
      `[capture] preflight: cannot reach ${baseUrl} (${reason}).`,
      `Start the app first, then re-run the capture:`,
      `  pnpm -C apps/smithers dev`,
      `or point the capture at a running test server:`,
      `  SMITHERS_CAPTURE_BASE_URL=http://127.0.0.1:5275 pnpm -C apps/smithers capture`,
      `(Pass --no-preflight or SMITHERS_CAPTURE_SKIP_PREFLIGHT=1 to skip this check.)`,
    ].join("\n");
  } finally {
    clearTimeout(timer);
  }
}

async function runCapture(flags: CliFlags): Promise<CaptureReport> {
  const startedAt = Date.now();
  const surfaces = flags.surfaceFilter
    ? SURFACES.filter((s) => flags.surfaceFilter!.has(s.id))
    : SURFACES;
  const planned = planShots(surfaces, flags.reducedMotion);

  if (flags.dryRun) {
    return {
      baseUrl: flags.baseUrl,
      outDir: flags.outDir,
      startedAt,
      finishedAt: Date.now(),
      dryRun: true,
      shots: planned.map((p) => ({
        id: p.id,
        surfaceId: p.surfaceId,
        title: p.title,
        filename: p.filename,
        status: "skipped",
        variant: p.variant,
        description: p.description,
        validation: p.validation,
        motionFrames: p.motionPhases?.map((m) => ({
          id: m.id,
          label: m.label,
          path: m.filename,
        })),
      })),
    };
  }

  if (!flags.skipPreflight) {
    const preflight = await preflightBaseUrl(flags.baseUrl);
    if (preflight) throw new Error(preflight);
  }

  await ensureDir(flags.outDir);

  // Lazy-require so --dry-run works without playwright installed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = await import("playwright");
  const browser = (await chromium.launch()) as unknown as AnyBrowser;
  const report: CaptureReport = {
    baseUrl: flags.baseUrl,
    outDir: flags.outDir,
    startedAt,
    finishedAt: 0,
    dryRun: false,
    shots: [],
  };

  for (const surface of surfaces) {
    for (const variant of expandVariants(surface, flags.reducedMotion)) {
      const shot = {
        id: `${surface.id}-${variant.theme}-${variant.device}${variant.reducedMotion ? "-reduced" : ""}`,
        surfaceId: surface.id,
        title: surface.title,
        filename: `${surface.id}.${variant.device}.${variant.theme}${variant.reducedMotion ? ".reduced" : ""}.png`,
        description: surface.description,
        validation: surface.validation,
        variant,
      };
      try {
        const result = await captureShot(browser, flags, surface, variant);
        report.shots.push({
          ...shot,
          status: "captured",
          bytes: result.bytes,
          motionFrames: result.motionFrames,
        });
      } catch (error) {
        report.shots.push({
          ...shot,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await browser.close();
  report.finishedAt = Date.now();
  return report;
}

async function captureShot(
  browser: AnyBrowser,
  flags: CliFlags,
  surface: SurfaceEntry,
  variant: CaptureVariant & { reducedMotion?: boolean },
): Promise<{ bytes: number; motionFrames?: Array<{ id: string; label: string; path: string }> }> {
  const viewport = viewportFor(variant.device);
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: variant.theme,
    reducedMotion: variant.reducedMotion ? "reduce" : "no-preference",
  });
  await context.addInitScript(buildSeedScript(variant.theme, !!variant.reducedMotion, surface.id));
  const page = await context.newPage();

  try {
    await navigateToSurface(page, flags.baseUrl, surface);
    if (surface.waitFor) {
      await page.waitForSelector(surface.waitFor, { timeout: 8000 });
    }
    // Allow one paint after wait.
    await page.evaluate("new Promise(r => requestAnimationFrame(() => r(undefined)))");

    const filename = `${surface.id}.${variant.device}.${variant.theme}${variant.reducedMotion ? ".reduced" : ""}.png`;
    const path = join(flags.outDir, filename);
    await ensureDir(dirname(path));
    const buffer = await page.screenshot({ path, fullPage: false });

    let motionFrames: Array<{ id: string; label: string; path: string }> | undefined;
    if (surface.motion && variant.device === "desktop" && variant.theme === "light") {
      motionFrames = await captureMotion(page, surface, flags.outDir);
    }
    return { bytes: buffer.length ?? 0, motionFrames };
  } finally {
    await page.close();
    await context.close();
  }
}

async function captureMotion(
  page: AnyPage,
  surface: SurfaceEntry,
  outDir: string,
): Promise<Array<{ id: string; label: string; path: string }>> {
  const frames: Array<{ id: string; label: string; path: string }> = [];
  const frameDir = join(outDir, "motion");
  await ensureDir(frameDir);
  for (const phase of surface.motion!.phases) {
    await runPhaseSteps(page, phase);
    await page.waitForSelector(phase.waitFor, { timeout: 8000 });
    await page.evaluate("new Promise(r => requestAnimationFrame(() => r(undefined)))");
    const frameName = `${surface.id}.frame-${phase.id}.png`;
    const framePath = join(frameDir, frameName);
    await page.screenshot({ path: framePath, fullPage: false });
    frames.push({ id: phase.id, label: phase.label, path: `motion/${frameName}` });
  }
  return frames;
}

async function runPhaseSteps(page: AnyPage, phase: MotionPhase): Promise<void> {
  for (const step of phase.steps ?? []) {
    if (step.do === "goto") {
      // Phase steps don't navigate; goto is only valid as a top-level step.
      // Treat as a no-op to keep types clean without throwing mid-capture.
      continue;
    }
    if (step.do === "fill") {
      await page.locator(step.selector).fill(step.value);
    } else if (step.do === "press") {
      await page.locator(step.selector).press(step.key);
    } else if (step.do === "click") {
      await page.locator(step.selector).click();
    } else if (step.do === "wait") {
      await page.waitForSelector(step.selector, { timeout: 8000 });
    }
  }
}

async function navigateToSurface(
  page: AnyPage,
  baseUrl: string,
  surface: SurfaceEntry,
): Promise<void> {
  const cap = surface.capture;
  if (cap.kind === "route") {
    await page.goto(`${baseUrl}${cap.path}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    return;
  }
  if (cap.kind === "slash") {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
    const input = page.getByRole("textbox", { name: "Message Smithers" });
    await input.fill(cap.command);
    await input.press("Enter");
    if (cap.expectPath) {
      const expected = cap.expectPath;
      await page.waitForURL((url) => expected.test(url.pathname), { timeout: 8000 });
    }
    return;
  }
  // kind === "steps"
  for (const step of cap.steps) {
    if (step.do === "goto") {
      await page.goto(`${baseUrl}${step.path}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    } else if (step.do === "fill") {
      await page.locator(step.selector).fill(step.value);
    } else if (step.do === "press") {
      await page.locator(step.selector).press(step.key);
    } else if (step.do === "click") {
      await page.locator(step.selector).click();
    } else if (step.do === "wait") {
      await page.waitForSelector(step.selector, { timeout: 8000 });
    }
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const report = await runCapture(flags);
  await writeReport(flags.outDir, report);
  const captured = report.shots.filter((s) => s.status === "captured").length;
  const failed = report.shots.filter((s) => s.status === "failed").length;
  const planned = report.shots.length;
  const manifestPath = manifestPathFor(flags.outDir, report.dryRun);
  if (report.dryRun) {
    console.log(
      `[capture] dry-run planned ${planned} shot(s) across ${new Set(report.shots.map((s) => s.surfaceId)).size} surface(s); manifest at ${manifestPath}`,
    );
  } else {
    console.log(
      `[capture] ${captured}/${planned} captured, ${failed} failed; manifest at ${manifestPath}`,
    );
  }
  if (failed > 0 && !flags.dryRun) process.exitCode = 1;
}

const isMain =
  // bun: import.meta.main, node ESM: compare paths
  // @ts-expect-error bun extension
  (typeof import.meta !== "undefined" && import.meta.main) ||
  (typeof process !== "undefined" &&
    process.argv[1] &&
    (process.argv[1].endsWith("capture.ts") || process.argv[1].endsWith("capture.js")));

if (isMain) {
  main().catch((error) => {
    console.error("[capture] fatal:", error.message ?? error);
    process.exit(1);
  });
}
