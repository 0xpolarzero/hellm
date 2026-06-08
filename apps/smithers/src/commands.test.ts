import { describe, expect, test } from "bun:test";
import { COMMANDS, type CommandId } from "./commands";

/**
 * Registry invariants for the command pill. COMMANDS is pure data with no store
 * or router imports (that's the point of the file), so we assert the contract the
 * CommandMenu leans on: a non-empty list, stable unique ids, a human label on
 * every entry, and the four top-level views present and accounted for.
 */

describe("COMMANDS", () => {
  test("is a non-empty list", () => {
    expect(COMMANDS.length).toBeGreaterThan(0);
  });

  test("every entry has a non-empty label and hint", () => {
    for (const command of COMMANDS) {
      expect(typeof command.label).toBe("string");
      expect(command.label.length).toBeGreaterThan(0);
      expect(typeof command.hint).toBe("string");
      expect(command.hint.length).toBeGreaterThan(0);
    }
  });

  test("ids are unique", () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("exposes exactly the four top-level view ids", () => {
    const expected: CommandId[] = ["chat", "askme", "store", "concierge"];
    expect(new Set(COMMANDS.map((command) => command.id))).toEqual(new Set(expected));
  });
});
