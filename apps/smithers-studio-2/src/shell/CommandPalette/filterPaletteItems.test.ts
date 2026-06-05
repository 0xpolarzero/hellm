import { describe, expect, test } from "bun:test";
import { filterPaletteItems } from "./filterPaletteItems";
import type { PaletteItem } from "./PaletteItem";

/**
 * Real unit tests for the palette filter — pure function, real PaletteItem
 * inputs. Verifies prefix-mode scoping (> -> Commands only; / @ ? -> nothing;
 * default -> all surfaces) layered with the free-text match.
 */

function item(overrides: Partial<PaletteItem> & { id: string }): PaletteItem {
  return {
    section: overrides.section ?? "Navigate",
    title: overrides.title ?? overrides.id,
    subtitle: overrides.subtitle ?? "",
    icon: overrides.icon ?? "",
    run: overrides.run ?? (() => {}),
    ...overrides,
  };
}

const ITEMS: PaletteItem[] = [
  item({ id: "cmd-approve", section: "Commands", title: "Approve gate", subtitle: "approve the pending gate" }),
  item({ id: "cmd-cancel", section: "Commands", title: "Cancel run" }),
  item({ id: "nav-runs", section: "Navigate", title: "Runs", subtitle: "open the runs surface" }),
  item({ id: "nav-workspace", section: "Navigate", title: "Workspace" }),
];

const ids = (rows: PaletteItem[]) => rows.map((r) => r.id);

describe("filterPaletteItems mode scoping", () => {
  test("'>' command mode returns only the Commands section", () => {
    expect(ids(filterPaletteItems(ITEMS, ">"))).toEqual(["cmd-approve", "cmd-cancel"]);
  });

  test("default mode returns every surface + command", () => {
    expect(ids(filterPaletteItems(ITEMS, ""))).toEqual([
      "cmd-approve",
      "cmd-cancel",
      "nav-runs",
      "nav-workspace",
    ]);
  });

  test("'/' workflow, '@' file, and '?' ask prefixes match nothing", () => {
    expect(filterPaletteItems(ITEMS, "/ship")).toEqual([]);
    expect(filterPaletteItems(ITEMS, "@file")).toEqual([]);
    expect(filterPaletteItems(ITEMS, "?why")).toEqual([]);
  });
});

describe("filterPaletteItems text match", () => {
  test("default mode free-text matches title/subtitle/section case-insensitively", () => {
    expect(ids(filterPaletteItems(ITEMS, "runs"))).toEqual(["nav-runs"]);
    expect(ids(filterPaletteItems(ITEMS, "RUNS"))).toEqual(["nav-runs"]);
  });

  test("subtitle text is searchable", () => {
    expect(ids(filterPaletteItems(ITEMS, "pending gate"))).toEqual(["cmd-approve"]);
  });

  test("command mode applies text match within the Commands section only", () => {
    expect(ids(filterPaletteItems(ITEMS, ">cancel"))).toEqual(["cmd-cancel"]);
    // "Runs" is a Navigate item, so command mode never returns it even on a match.
    expect(filterPaletteItems(ITEMS, ">runs")).toEqual([]);
  });

  test("no match yields an empty list", () => {
    expect(filterPaletteItems(ITEMS, "nonexistent-xyz")).toEqual([]);
  });
});
