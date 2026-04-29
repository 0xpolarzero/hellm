import { describe, expect, it } from "bun:test";
import {
  CONSTRAINED_DESKTOP_MAX_WIDTH,
  DESKTOP_SPLIT_BREAKPOINT,
  getViewportClass,
  NARROW_SHELL_MAX_WIDTH,
  shouldUseDesktopInspectorSplit,
  shouldUseNarrowShell,
} from "./responsive-layout";

describe("getViewportClass", () => {
  it("classifies the artifact-derived narrow shell below 768px", () => {
    expect(getViewportClass(320)).toBe("narrow");
    expect(getViewportClass(NARROW_SHELL_MAX_WIDTH)).toBe("narrow");
    expect(shouldUseNarrowShell(640)).toBe(true);
  });

  it("classifies constrained desktop between narrow and split desktop", () => {
    expect(getViewportClass(NARROW_SHELL_MAX_WIDTH + 1)).toBe("constrained-desktop");
    expect(getViewportClass(CONSTRAINED_DESKTOP_MAX_WIDTH)).toBe("constrained-desktop");
    expect(shouldUseNarrowShell(900)).toBe(false);
  });

  it("classifies full desktop at the inspector split breakpoint", () => {
    expect(getViewportClass(DESKTOP_SPLIT_BREAKPOINT)).toBe("full-desktop");
    expect(getViewportClass(1600)).toBe("full-desktop");
    expect(shouldUseDesktopInspectorSplit(DESKTOP_SPLIT_BREAKPOINT)).toBe(true);
    expect(shouldUseDesktopInspectorSplit(CONSTRAINED_DESKTOP_MAX_WIDTH)).toBe(false);
  });
});
