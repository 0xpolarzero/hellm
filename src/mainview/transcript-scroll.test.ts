import { describe, expect, it } from "bun:test";
import {
  compensateTranscriptScrollForMeasuredRow,
  deriveTranscriptUserScrollState,
} from "./transcript-scroll";

describe("transcript scroll policy", () => {
  it("keeps auto-scroll enabled near the bottom without rewriting the current anchor", () => {
    const state = deriveTranscriptUserScrollState({
      scrollTop: 489,
      scrollHeight: 900,
      clientHeight: 400,
      shouldVirtualize: true,
      currentAnchorIndex: 14,
      getIndexAtOffset: () => 99,
    });

    expect(state).toEqual({
      stickToBottom: true,
      autoScroll: true,
      anchorIndex: 14,
    });
  });

  it("captures a new anchor when the user scrolls away from the bottom", () => {
    const state = deriveTranscriptUserScrollState({
      scrollTop: 180,
      scrollHeight: 900,
      clientHeight: 400,
      shouldVirtualize: true,
      currentAnchorIndex: 14,
      getIndexAtOffset: (offset) => Math.floor(offset / 12),
    });

    expect(state).toEqual({
      stickToBottom: false,
      autoScroll: false,
      anchorIndex: 15,
    });
  });

  it("compensates scroll position for measured rows above the anchor", () => {
    const firstCompensation = compensateTranscriptScrollForMeasuredRow({
      scrollTop: 960,
      delta: 24,
      index: 5,
      anchorIndex: 18,
      stickToBottom: false,
    });
    const secondCompensation = compensateTranscriptScrollForMeasuredRow({
      scrollTop: firstCompensation ?? 0,
      delta: -10,
      index: 9,
      anchorIndex: 18,
      stickToBottom: false,
    });

    expect(firstCompensation).toBe(984);
    expect(secondCompensation).toBe(974);
  });

  it("ignores measurement churn at or below the anchor and while pinned to bottom", () => {
    expect(
      compensateTranscriptScrollForMeasuredRow({
        scrollTop: 960,
        delta: 24,
        index: 18,
        anchorIndex: 18,
        stickToBottom: false,
      }),
    ).toBeNull();

    expect(
      compensateTranscriptScrollForMeasuredRow({
        scrollTop: 960,
        delta: 24,
        index: 5,
        anchorIndex: 18,
        stickToBottom: true,
      }),
    ).toBeNull();
  });
});
