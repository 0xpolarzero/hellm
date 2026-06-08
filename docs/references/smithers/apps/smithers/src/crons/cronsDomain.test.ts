import { describe, expect, test } from "bun:test";
import {
  createCron,
  deleteCron,
  describeCron,
  isValidWorkflowPath,
  nameFromWorkflowPath,
  SEEDED_CRONS,
  shortHash,
  sortCrons,
  summarizeCrons,
  toggleCron,
  toneForCronEnabled,
  validateCreate,
  validateCronPattern,
} from "./crons";

/**
 * Pure domain tests for the triggers surface: the cron-pattern + workflow-path
 * validation, the next-run hint, and the create/toggle/delete reducers the card
 * and canvas lean on. No DOM, no store.
 */

describe("summarizeCrons", () => {
  test("enabled + disabled equals total", () => {
    const s = summarizeCrons(SEEDED_CRONS);
    expect(s.total).toBe(SEEDED_CRONS.length);
    expect(s.enabled + s.disabled).toBe(s.total);
    expect(s.enabled).toBeGreaterThan(0);
    expect(s.disabled).toBeGreaterThan(0);
  });
});

describe("toneForCronEnabled", () => {
  test("enabled is ok, disabled is idle", () => {
    expect(toneForCronEnabled(true)).toBe("tone-ok");
    expect(toneForCronEnabled(false)).toBe("tone-idle");
  });
});

describe("sortCrons", () => {
  test("puts enabled before disabled and is a fresh array", () => {
    const sorted = sortCrons(SEEDED_CRONS);
    expect(sorted).not.toBe(SEEDED_CRONS);
    const firstDisabled = sorted.findIndex((c) => !c.enabled);
    const lastEnabled = sorted.map((c) => c.enabled).lastIndexOf(true);
    // Every enabled row precedes every disabled row.
    if (firstDisabled !== -1) expect(lastEnabled).toBeLessThan(firstDisabled);
  });

  test("orders same-enabled rows by id descending", () => {
    const sorted = sortCrons([
      { id: "cron-a", name: "a", pattern: "0 0 * * *", workflowPath: "a.tsx", enabled: true, nextHint: "" },
      { id: "cron-c", name: "c", pattern: "0 0 * * *", workflowPath: "c.tsx", enabled: true, nextHint: "" },
      { id: "cron-b", name: "b", pattern: "0 0 * * *", workflowPath: "b.tsx", enabled: true, nextHint: "" },
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["cron-c", "cron-b", "cron-a"]);
  });

  test("does not mutate the input", () => {
    const before = SEEDED_CRONS.map((c) => c.id);
    sortCrons(SEEDED_CRONS);
    expect(SEEDED_CRONS.map((c) => c.id)).toEqual(before);
  });
});

describe("shortHash", () => {
  test("is deterministic and 8 hex chars", () => {
    expect(shortHash("0 3 * * *|x.tsx")).toBe(shortHash("0 3 * * *|x.tsx"));
    expect(shortHash("a")).toMatch(/^[0-9a-f]{8}$/);
  });

  test("differs for different inputs", () => {
    expect(shortHash("a")).not.toBe(shortHash("b"));
  });
});

describe("validateCronPattern", () => {
  test("accepts the seeded patterns", () => {
    for (const cron of SEEDED_CRONS) {
      expect(validateCronPattern(cron.pattern)).toBe(true);
    }
  });

  test("accepts star, step, range, and comma forms", () => {
    expect(validateCronPattern("* * * * *")).toBe(true);
    expect(validateCronPattern("*/15 * * * *")).toBe(true);
    expect(validateCronPattern("0 9 * * 1")).toBe(true);
    expect(validateCronPattern("0 0 1-15 * *")).toBe(true);
    expect(validateCronPattern("0 0,12 * * *")).toBe(true);
    expect(validateCronPattern("30 8 1,15 6 1-5")).toBe(true);
  });

  test("rejects wrong field counts", () => {
    expect(validateCronPattern("* * * *")).toBe(false);
    expect(validateCronPattern("* * * * * *")).toBe(false);
    expect(validateCronPattern("")).toBe(false);
  });

  test("rejects out-of-range and malformed fields", () => {
    expect(validateCronPattern("60 * * * *")).toBe(false); // minute max 59
    expect(validateCronPattern("0 24 * * *")).toBe(false); // hour max 23
    expect(validateCronPattern("0 0 0 * *")).toBe(false); // dom min 1
    expect(validateCronPattern("0 0 * 13 *")).toBe(false); // month max 12
    expect(validateCronPattern("0 0 * * 7")).toBe(false); // dow max 6
    expect(validateCronPattern("a b c d e")).toBe(false);
    expect(validateCronPattern("0 0 5-1 * *")).toBe(false); // reversed range
    expect(validateCronPattern("*/0 * * * *")).toBe(false); // step must be >= 1
  });

  test("ignores surrounding whitespace", () => {
    expect(validateCronPattern("  0 3 * * *  ")).toBe(true);
  });
});

describe("isValidWorkflowPath", () => {
  test("accepts .ts and .tsx files", () => {
    expect(isValidWorkflowPath(".smithers/workflows/x.tsx")).toBe(true);
    expect(isValidWorkflowPath("foo/bar.ts")).toBe(true);
  });

  test("rejects empty and non-workflow extensions", () => {
    expect(isValidWorkflowPath("")).toBe(false);
    expect(isValidWorkflowPath("   ")).toBe(false);
    expect(isValidWorkflowPath("x.js")).toBe(false);
    expect(isValidWorkflowPath("x")).toBe(false);
  });
});

describe("validateCreate", () => {
  test("null when both fields are valid", () => {
    expect(validateCreate("0 3 * * *", ".smithers/workflows/x.tsx")).toBeNull();
  });

  test("required messages in precedence order", () => {
    expect(validateCreate("", "")).toBe("Cron pattern and workflow path are required.");
    expect(validateCreate("", "x.tsx")).toBe("Cron pattern is required.");
    expect(validateCreate("0 3 * * *", "")).toBe("Workflow path is required.");
  });

  test("syntactic messages after the required checks", () => {
    expect(validateCreate("nope", "x.tsx")).toBe("Not a valid 5-field cron pattern.");
    expect(validateCreate("0 3 * * *", "x.js")).toBe("Workflow path must be a .ts/.tsx file.");
  });

  test("trims before checking", () => {
    expect(validateCreate("  0 3 * * *  ", "  x.tsx  ")).toBeNull();
  });
});

describe("describeCron", () => {
  test("renders the documented examples", () => {
    expect(describeCron("0 3 * * *")).toBe("Daily at 03:00");
    expect(describeCron("0 9 * * 1")).toBe("Mondays at 09:00");
    expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
  });

  test("handles hourly and singular-minute forms", () => {
    expect(describeCron("0 * * * *")).toBe("Hourly, on the hour");
    expect(describeCron("*/1 * * * *")).toBe("Every 1 minute");
  });

  test("falls back to the pattern for unrecognized shapes", () => {
    expect(describeCron("0 0 1 * *")).toBe("0 0 1 * *");
    expect(describeCron("not a pattern")).toBe("not a pattern");
  });
});

describe("nameFromWorkflowPath", () => {
  test("strips the directory and extension", () => {
    expect(nameFromWorkflowPath(".smithers/workflows/nightly.tsx")).toBe("nightly");
    expect(nameFromWorkflowPath("retro.ts")).toBe("retro");
  });

  test("falls back to a name when the base is empty", () => {
    expect(nameFromWorkflowPath(".tsx")).toBe("trigger");
  });
});

describe("createCron", () => {
  test("prepends a fresh enabled trigger with a hashed id", () => {
    const { crons, created } = createCron(SEEDED_CRONS, {
      pattern: "0 6 * * *",
      workflowPath: ".smithers/workflows/morning.tsx",
    });
    expect(created.id).toBe(`cron-${shortHash("0 6 * * *|.smithers/workflows/morning.tsx")}`);
    expect(created.name).toBe("morning");
    expect(created.enabled).toBe(true);
    expect(created.nextHint).toBe("Daily at 06:00");
    expect(crons[0]).toBe(created);
    expect(crons.length).toBe(SEEDED_CRONS.length + 1);
  });

  test("trims the draft and does not mutate the input", () => {
    const before = SEEDED_CRONS.length;
    const { created } = createCron(SEEDED_CRONS, {
      pattern: "  0 6 * * *  ",
      workflowPath: "  x.tsx  ",
    });
    expect(created.pattern).toBe("0 6 * * *");
    expect(created.workflowPath).toBe("x.tsx");
    expect(SEEDED_CRONS.length).toBe(before);
  });
});

describe("toggleCron", () => {
  test("flips one trigger immutably", () => {
    const target = SEEDED_CRONS.find((c) => c.enabled)!;
    const next = toggleCron(SEEDED_CRONS, target.id);
    expect(next).not.toBe(SEEDED_CRONS);
    expect(next.find((c) => c.id === target.id)!.enabled).toBe(false);
    expect(SEEDED_CRONS.find((c) => c.id === target.id)!.enabled).toBe(true);
  });

  test("toggling twice round-trips", () => {
    const target = SEEDED_CRONS[0];
    const once = toggleCron(SEEDED_CRONS, target.id);
    const twice = toggleCron(once, target.id);
    expect(twice.find((c) => c.id === target.id)!.enabled).toBe(target.enabled);
  });
});

describe("deleteCron", () => {
  test("removes the matching trigger immutably", () => {
    const target = SEEDED_CRONS[0];
    const next = deleteCron(SEEDED_CRONS, target.id);
    expect(next).not.toBe(SEEDED_CRONS);
    expect(next.find((c) => c.id === target.id)).toBeUndefined();
    expect(next.length).toBe(SEEDED_CRONS.length - 1);
    expect(SEEDED_CRONS.length).toBe(SEEDED_CRONS.length);
  });

  test("is a no-op for an unknown id", () => {
    const next = deleteCron(SEEDED_CRONS, "cron-does-not-exist");
    expect(next.length).toBe(SEEDED_CRONS.length);
  });
});
