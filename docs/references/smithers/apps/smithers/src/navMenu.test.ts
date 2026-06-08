import { describe, expect, test } from "bun:test";
import { NAV_LINKS } from "./navMenu";

/**
 * Registry invariants for the command menu's "Go to" section. NAV_LINKS is pure
 * data like COMMANDS, so we assert the contract CommandMenu leans on: a non-empty
 * list, stable unique ids, a human label on every entry, and a surface every link
 * carries (which `openSurface` routes). The surface kinds covered here are the
 * navigable canvas surfaces — no run-scoped ones (inspector/diff/logs/timeline)
 * and no mode views (those live in COMMANDS).
 */

const NAVIGABLE_KINDS = new Set([
  "runs",
  "vcs",
  "issues",
  "tickets",
  "approvals",
  "agents",
  "memory",
  "prompts",
  "scores",
  "crons",
  "landings",
]);

describe("NAV_LINKS", () => {
  test("is a non-empty list", () => {
    expect(NAV_LINKS.length).toBeGreaterThan(0);
  });

  test("every entry has a non-empty label and a surface", () => {
    for (const link of NAV_LINKS) {
      expect(typeof link.label).toBe("string");
      expect(link.label.length).toBeGreaterThan(0);
      expect(link.surface).toBeDefined();
      expect(typeof link.surface.kind).toBe("string");
    }
  });

  test("ids are unique", () => {
    const ids = NAV_LINKS.map((link) => link.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every surface is a navigable canvas surface", () => {
    for (const link of NAV_LINKS) {
      expect(NAVIGABLE_KINDS.has(link.surface.kind)).toBe(true);
    }
  });
});
