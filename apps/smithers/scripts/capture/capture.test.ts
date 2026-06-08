/**
 * Unit tests for the capture planner, seed-script builder, and preflight
 * check. These run under `bun test` (the same runner the rest of apps/smithers
 * uses) and don't touch a browser — they verify that the manifest expands into
 * the right shots, that variants are filtered correctly per-surface, that the
 * seed script writes the same persisted shape the app reads, and that the
 * preflight check fails with an actionable message when the dev server is
 * unreachable.
 */
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { buildSeedScript, manifestPathFor, planShots, preflightBaseUrl } from "./capture";
import { resolveManifestPath } from "./generateSlideshow";
import { SURFACES, type SurfaceEntry } from "./surfaces";

describe("planShots", () => {
  it("expands every surface into three baseline variants", () => {
    const surface: SurfaceEntry = SURFACES.find((s) => s.id === "home")!;
    const plan = planShots([surface], false);
    expect(plan).toHaveLength(3); // light desktop, dark desktop, light mobile
    expect(new Set(plan.map((p) => `${p.variant.theme}-${p.variant.device}`))).toEqual(
      new Set(["light-desktop", "dark-desktop", "light-mobile"]),
    );
  });

  it("drops mobile when a surface opts out", () => {
    const synth: SurfaceEntry = {
      ...(SURFACES[0] as SurfaceEntry),
      id: "synth-no-mobile",
      mobile: false,
    };
    const plan = planShots([synth], false);
    expect(plan.every((p) => p.variant.device !== "mobile")).toBe(true);
  });

  it("drops dark when a surface opts out", () => {
    const synth: SurfaceEntry = {
      ...(SURFACES[0] as SurfaceEntry),
      id: "synth-no-dark",
      dark: false,
    };
    const plan = planShots([synth], false);
    expect(plan.every((p) => p.variant.theme !== "dark")).toBe(true);
  });

  it("adds a reduced-motion clone only for motion surfaces when opted in", () => {
    const onboarding = SURFACES.find((s) => s.id === "onboarding")!;
    expect(onboarding.motion).toBeDefined();
    const off = planShots([onboarding], false);
    const on = planShots([onboarding], true);
    expect(on.length).toBe(off.length + 1);
    expect(on.some((p) => p.variant.reducedMotion === true)).toBe(true);
    // A non-motion surface never gains a reduced-motion clone, even with the flag.
    const home = SURFACES.find((s) => s.id === "home")!;
    const homeOn = planShots([home], true);
    expect(homeOn.some((p) => p.variant.reducedMotion === true)).toBe(false);
  });

  it("gives every shot a unique filename across the full manifest", () => {
    const plan = planShots(SURFACES, true);
    const names = plan.map((p) => p.filename);
    expect(new Set(names).size).toBe(names.length);
  });

  it("only attaches motion frames to the desktop+light variant of a motion surface", () => {
    const onboarding = SURFACES.find((s) => s.id === "onboarding")!;
    const plan = planShots([onboarding], true);
    const withMotion = plan.filter((p) => p.motionPhases && p.motionPhases.length);
    // Desktop-light (baseline) AND desktop-light-reduced both get the phase plan,
    // so the deck can render either as a sequence. Dark + mobile do not.
    expect(withMotion.length).toBeGreaterThanOrEqual(1);
    for (const shot of withMotion) {
      expect(shot.variant.theme).toBe("light");
      expect(shot.variant.device).toBe("desktop");
    }
    // The frames map 1:1 onto the declared phases.
    const phases = onboarding.motion!.phases.map((p) => p.id);
    for (const shot of withMotion) {
      expect(shot.motionPhases!.map((m) => m.id)).toEqual(phases);
      for (const m of shot.motionPhases!) {
        expect(m.filename).toBe(`motion/${onboarding.id}.frame-${m.id}.png`);
      }
    }
  });
});

describe("buildSeedScript", () => {
  it("writes the real persisted preferences shape under smithers.prefs", () => {
    const script = buildSeedScript("dark", false, "home");
    // The persist middleware reads { state: { theme, layout }, version }.
    // The pre-paint script in index.html relies on the same blob to resolve
    // the theme before React boots, so the key + nested shape both matter.
    expect(script).toContain("'smithers.prefs'");
    expect(script).toContain('\\"state\\":{\\"theme\\":\\"dark\\"');
    expect(script).toContain('\\"layout\\":\\"normal\\"');
    expect(script).toContain('\\"version\\":0');
    // Belt-and-braces: data-theme is set so CSS that branches on the attribute
    // matches the persisted theme immediately.
    expect(script).toContain('setAttribute(\'data-theme\', "dark")');
  });

  it("reflects the requested theme in both the prefs blob and data-theme", () => {
    const light = buildSeedScript("light", false, "home");
    const dark = buildSeedScript("dark", false, "home");
    expect(light).toContain('\\"theme\\":\\"light\\"');
    expect(light).toContain('setAttribute(\'data-theme\', "light")');
    expect(dark).toContain('\\"theme\\":\\"dark\\"');
    expect(dark).toContain('setAttribute(\'data-theme\', "dark")');
  });

  it("seeds onboarding as completed for every surface except onboarding itself", () => {
    const home = buildSeedScript("light", false, "home");
    expect(home).toContain("setItem('smithers.onboarding'");
    expect(home).toContain('\\"completed\\":true');

    const onboarding = buildSeedScript("light", false, "onboarding");
    expect(onboarding).toContain("removeItem('smithers.onboarding')");
    expect(onboarding).not.toContain("setItem('smithers.onboarding'");
  });

  it("sets data-reduced-motion only when the variant opts in", () => {
    const off = buildSeedScript("light", false, "onboarding");
    const on = buildSeedScript("light", true, "onboarding");
    // The gate is a static `if (true)` / `if (false)` so the inert branch
    // never runs in the page even though the literal string is present.
    expect(off).toContain("if (false) {");
    expect(off).not.toContain("if (true) {");
    expect(on).toContain("if (true) {");
    expect(on).toContain("setAttribute('data-reduced-motion', 'true')");
  });
});

describe("surface manifest invariants", () => {
  it("uses unique surface ids", () => {
    const ids = SURFACES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every surface has a non-empty description and validation note", () => {
    for (const surface of SURFACES) {
      expect(surface.description.length).toBeGreaterThan(0);
      expect(surface.validation.length).toBeGreaterThan(0);
    }
  });

  it("every kind: route entry uses an absolute path", () => {
    for (const surface of SURFACES) {
      if (surface.capture.kind === "route") {
        expect(surface.capture.path.startsWith("/")).toBe(true);
      }
    }
  });

  it("motion surfaces declare at least one phase with a wait selector", () => {
    for (const surface of SURFACES) {
      if (!surface.motion) continue;
      expect(surface.motion.phases.length).toBeGreaterThan(0);
      const phaseIds = new Set<string>();
      for (const phase of surface.motion.phases) {
        expect(phase.waitFor.length).toBeGreaterThan(0);
        expect(phase.id.length).toBeGreaterThan(0);
        expect(phase.label.length).toBeGreaterThan(0);
        expect(phaseIds.has(phase.id)).toBe(false);
        phaseIds.add(phase.id);
      }
    }
  });

  it("does not reference the removed ?reset-onboarding query parameter", () => {
    for (const surface of SURFACES) {
      const blob = JSON.stringify(surface);
      expect(blob).not.toContain("reset-onboarding");
    }
  });
});

describe("manifestPathFor", () => {
  it("targets manifest.json for live captures and manifest.dry-run.json for plans", () => {
    const live = manifestPathFor("/tmp/slideshow/assets", false);
    const dry = manifestPathFor("/tmp/slideshow/assets", true);
    expect(live.endsWith("/manifest.json")).toBe(true);
    expect(dry.endsWith("/manifest.dry-run.json")).toBe(true);
    // Both sit at the parent of `assets/` so the generator can read either.
    expect(live).not.toContain("/assets/manifest.json");
    expect(dry).not.toContain("/assets/manifest.dry-run.json");
  });
});

describe("resolveManifestPath", () => {
  it("prefers the dry-run manifest when it is the latest default artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smithers-slideshow-"));
    try {
      const live = join(dir, "manifest.json");
      const dry = join(dir, "manifest.dry-run.json");
      await writeFile(live, "{}\n");
      await writeFile(dry, "{}\n");
      await utimes(live, new Date(1_000), new Date(1_000));
      await utimes(dry, new Date(2_000), new Date(2_000));

      expect(resolveManifestPath(undefined, { baseDir: dir })).toBe(dry);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps explicit paths and explicit dry-run preference deterministic", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smithers-slideshow-"));
    try {
      const live = join(dir, "manifest.json");
      const dry = join(dir, "manifest.dry-run.json");
      await writeFile(live, "{}\n");
      await writeFile(dry, "{}\n");
      await utimes(live, new Date(2_000), new Date(2_000));
      await utimes(dry, new Date(1_000), new Date(1_000));

      expect(resolveManifestPath(undefined, { baseDir: dir })).toBe(live);
      expect(resolveManifestPath(undefined, { baseDir: dir, preferDryRun: true })).toBe(dry);
      expect(resolveManifestPath("/custom/manifest.json", { baseDir: dir })).toBe("/custom/manifest.json");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("preflightBaseUrl", () => {
  it("returns null when the server answers 2xx/3xx/4xx", async () => {
    const ok = await preflightBaseUrl("http://example.test/", async () => ({ ok: true, status: 200 }));
    expect(ok).toBe(null);
    const notFound = await preflightBaseUrl("http://example.test/", async () => ({ ok: false, status: 404 }));
    expect(notFound).toBe(null);
  });

  it("returns an actionable message when the server is unreachable", async () => {
    const msg = await preflightBaseUrl("http://example.test/", async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(msg).not.toBe(null);
    expect(msg).toContain("cannot reach http://example.test/");
    expect(msg).toContain("pnpm -C apps/smithers dev");
    expect(msg).toContain("SMITHERS_CAPTURE_BASE_URL");
    expect(msg).toContain("--no-preflight");
  });

  it("returns an actionable message on a 5xx response", async () => {
    const msg = await preflightBaseUrl("http://example.test/", async () => ({ ok: false, status: 503 }));
    expect(msg).not.toBe(null);
    expect(msg).toContain("responded with 503");
    expect(msg).toContain("pnpm -C apps/smithers dev");
  });
});
