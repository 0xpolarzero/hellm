import { describe, expect, it } from "bun:test";
import {
  clampSidebarWidth,
  getMaxSidebarWidth,
  isSidebarToggleShortcut,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "./sidebar-layout";

describe("getMaxSidebarWidth", () => {
  it("caps the sidebar against the viewport ratio on narrow windows", () => {
    expect(getMaxSidebarWidth(700)).toBe(294);
  });

  it("never grows beyond the desktop max width", () => {
    expect(getMaxSidebarWidth(1800)).toBe(MAX_SIDEBAR_WIDTH);
  });
});

describe("clampSidebarWidth", () => {
  it("does not allow widths below the minimum", () => {
    expect(clampSidebarWidth(120, 1400)).toBe(MIN_SIDEBAR_WIDTH);
  });

  it("does not allow widths above the viewport-aware maximum", () => {
    expect(clampSidebarWidth(900, 760)).toBe(getMaxSidebarWidth(760));
  });
});

describe("isSidebarToggleShortcut", () => {
  it("matches Cmd/Ctrl+B", () => {
    expect(
      isSidebarToggleShortcut({
        defaultPrevented: false,
        altKey: false,
        metaKey: true,
        ctrlKey: false,
        key: "b",
      } as KeyboardEvent),
    ).toBe(true);

    expect(
      isSidebarToggleShortcut({
        defaultPrevented: false,
        altKey: false,
        metaKey: false,
        ctrlKey: true,
        key: "B",
      } as KeyboardEvent),
    ).toBe(true);
  });

  it("rejects prevented, alt-modified, and unrelated shortcuts", () => {
    expect(
      isSidebarToggleShortcut({
        defaultPrevented: true,
        altKey: false,
        metaKey: true,
        ctrlKey: false,
        key: "b",
      } as KeyboardEvent),
    ).toBe(false);

    expect(
      isSidebarToggleShortcut({
        defaultPrevented: false,
        altKey: true,
        metaKey: true,
        ctrlKey: false,
        key: "b",
      } as KeyboardEvent),
    ).toBe(false);

    expect(
      isSidebarToggleShortcut({
        defaultPrevented: false,
        altKey: false,
        metaKey: true,
        ctrlKey: false,
        key: "k",
      } as KeyboardEvent),
    ).toBe(false);
  });
});
