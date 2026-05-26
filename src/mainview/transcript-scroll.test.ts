import { describe, expect, it } from "bun:test";
import {
  getTranscriptNativeScrollBehavior,
  resolveTranscriptRestoreTarget,
} from "./transcript-scroll";

describe("transcript scroll policy", () => {
  it("uses native smooth scrolling only when animation is requested and motion is allowed", () => {
    expect(getTranscriptNativeScrollBehavior({ animated: true, reducedMotion: false })).toBe(
      "smooth",
    );
    expect(getTranscriptNativeScrollBehavior({ animated: true, reducedMotion: true })).toBe("auto");
    expect(getTranscriptNativeScrollBehavior({ animated: false, reducedMotion: false })).toBe(
      "auto",
    );
  });

  it("restores by transcript anchor id when the row still exists", () => {
    const rows = [{ key: "one" }, { key: "two" }, { key: "three" }];

    expect(
      resolveTranscriptRestoreTarget({
        anchorId: "two",
        offsetPx: 420,
        rows,
        getRowKey: (row) => row.key,
      }),
    ).toEqual({ kind: "anchor", index: 1 });
  });

  it("falls back to the raw offset when the anchor is absent", () => {
    const rows = [{ key: "one" }];

    expect(
      resolveTranscriptRestoreTarget({
        anchorId: "missing",
        offsetPx: 420,
        rows,
        getRowKey: (row) => row.key,
      }),
    ).toEqual({ kind: "offset", offsetPx: 420 });
  });

  it("clamps restored raw offsets to the scrollable range floor", () => {
    expect(
      resolveTranscriptRestoreTarget({
        anchorId: null,
        offsetPx: -12,
        rows: [],
        getRowKey: (row: { key: string }) => row.key,
      }),
    ).toEqual({ kind: "offset", offsetPx: 0 });
  });
});
