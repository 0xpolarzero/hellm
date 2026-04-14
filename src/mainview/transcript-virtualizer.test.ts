import { describe, expect, it } from "bun:test";
import { TranscriptVirtualizer } from "./transcript-virtualizer";

describe("transcript virtualizer", () => {
  it("computes a window with overscan and measured row heights", () => {
    const virtualizer = new TranscriptVirtualizer({
      estimatedRowHeight: 100,
      rowGapPx: 16,
      overscanPx: 40,
    });

    virtualizer.setItemCount(5);
    virtualizer.recordHeight(0, 80);
    virtualizer.recordHeight(1, 120);
    virtualizer.recordHeight(2, 60);

    expect(virtualizer.getOffsetForIndex(0)).toBe(0);
    expect(virtualizer.getOffsetForIndex(1)).toBe(96);
    expect(virtualizer.getOffsetForIndex(2)).toBe(232);

    const window = virtualizer.getWindow(110, 120);

    expect(window).toEqual({
      startIndex: 0,
      endIndex: 3,
      totalHeight: 524,
    });
  });

  it("preserves offset calculations when new rows append after measured content", () => {
    const virtualizer = new TranscriptVirtualizer({
      estimatedRowHeight: 100,
      rowGapPx: 10,
      overscanPx: 25,
    });

    virtualizer.setItemCount(3);
    virtualizer.recordHeight(0, 90);
    virtualizer.recordHeight(1, 130);

    expect(virtualizer.getTotalHeight()).toBe(340);
    expect(virtualizer.getIndexAtOffset(220)).toBe(1);

    virtualizer.setItemCount(5);

    expect(virtualizer.getTotalHeight()).toBe(560);
    expect(virtualizer.getOffsetForIndex(3)).toBe(350);
    expect(virtualizer.isAtBottom(320, 220)).toBe(true);
  });

  it("rebuilds when row gaps change", () => {
    const virtualizer = new TranscriptVirtualizer({
      estimatedRowHeight: 80,
      rowGapPx: 8,
    });

    virtualizer.setItemCount(2);
    virtualizer.recordHeight(0, 50);
    virtualizer.recordHeight(1, 70);

    expect(virtualizer.getTotalHeight()).toBe(128);
    expect(virtualizer.setRowGap(20)).toBe(true);
    expect(virtualizer.getTotalHeight()).toBe(140);
    expect(virtualizer.getOffsetForIndex(1)).toBe(50 + 20);
  });
});
