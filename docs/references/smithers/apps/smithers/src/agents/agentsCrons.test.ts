import { describe, expect, test } from "bun:test";
import { AGENTS, type Agent } from "./agents";
import { SEEDED_CRONS, type Cron } from "../crons/crons";

/**
 * Catalog invariants for the agents + crons cards. These two arrays are static
 * fixtures the slash cards (/agents, /crons) render straight through, so the
 * tests here guard the shape the card components rely on: non-empty, unique
 * ids, and every entry well-formed. No DOM — just the data contract.
 */

/** A non-empty string is the baseline for every display field. */
function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

describe("AGENTS catalog", () => {
  test("is non-empty", () => {
    expect(AGENTS.length).toBeGreaterThan(0);
  });

  test("ids are unique", () => {
    const ids = AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every entry is well-formed", () => {
    for (const agent of AGENTS) {
      expect(nonEmptyString(agent.id)).toBe(true);
      expect(nonEmptyString(agent.name)).toBe(true);
      expect(nonEmptyString(agent.initials)).toBe(true);
      expect(nonEmptyString(agent.detail)).toBe(true);
      // color is a hex swatch the card paints behind the initials.
      expect(agent.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      // available is the status flag — strictly boolean, no truthy stand-ins.
      expect(typeof agent.available).toBe("boolean");
      // auth is optional, but when present it must be a real label.
      if (agent.auth !== undefined) expect(nonEmptyString(agent.auth)).toBe(true);
    }
  });

  test("unavailable agents omit an auth label (nothing to authenticate yet)", () => {
    for (const agent of AGENTS.filter((a) => !a.available)) {
      expect(agent.auth).toBeUndefined();
    }
  });
});

describe("SEEDED_CRONS catalog", () => {
  test("is non-empty", () => {
    expect(SEEDED_CRONS.length).toBeGreaterThan(0);
  });

  test("ids are unique", () => {
    const ids = SEEDED_CRONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every entry is well-formed", () => {
    for (const cron of SEEDED_CRONS) {
      expect(nonEmptyString(cron.id)).toBe(true);
      expect(nonEmptyString(cron.name)).toBe(true);
      expect(nonEmptyString(cron.workflowPath)).toBe(true);
      expect(nonEmptyString(cron.nextHint)).toBe(true);
      // enabled is the status flag — strictly boolean, no truthy stand-ins.
      expect(typeof cron.enabled).toBe("boolean");
      // pattern is a 5-field cron schedule (min hour dom mon dow).
      expect(cron.pattern.trim().split(/\s+/)).toHaveLength(5);
    }
  });
});

// Compile-time guard: the arrays satisfy their declared element types. If a
// field is renamed/removed, this stops compiling before the runtime checks run.
const _agents: Agent[] = AGENTS;
const _crons: Cron[] = SEEDED_CRONS;
void _agents;
void _crons;
