import { describe, expect, it } from "bun:test";
import {
  deriveTranscriptScrollTopForViewportResize,
  deriveTranscriptUserScrollState,
  easeTranscriptScrollToBottom,
  getTranscriptDistanceFromBottom,
  shouldAdjustTranscriptScrollForMeasuredItem,
} from "./transcript-scroll";

describe("transcript scroll policy", () => {
  it("keeps auto-scroll enabled near the bottom without rewriting the current anchor", () => {
    const state = deriveTranscriptUserScrollState({
      scrollTop: 476,
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

  it("uses Codex-style bottom distance semantics for the pinned threshold", () => {
    expect(
      getTranscriptDistanceFromBottom({
        scrollTop: 476,
        scrollHeight: 900,
        clientHeight: 400,
      }),
    ).toBe(24);

    expect(
      deriveTranscriptUserScrollState({
        scrollTop: 476,
        scrollHeight: 900,
        clientHeight: 400,
        shouldVirtualize: true,
        currentAnchorIndex: 14,
        getIndexAtOffset: () => 99,
      }).stickToBottom,
    ).toBe(true);

    expect(
      deriveTranscriptUserScrollState({
        scrollTop: 475,
        scrollHeight: 900,
        clientHeight: 400,
        shouldVirtualize: true,
        currentAnchorIndex: 14,
        getIndexAtOffset: () => 99,
      }).stickToBottom,
    ).toBe(false);
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

  it("lets TanStack adjust scroll only for measured rows above the current anchor", () => {
    expect(
      shouldAdjustTranscriptScrollForMeasuredItem({
        index: 5,
        anchorIndex: 18,
        stickToBottom: false,
      }),
    ).toBe(true);
  });

  it("ignores measurement churn at or below the anchor and while pinned to bottom", () => {
    expect(
      shouldAdjustTranscriptScrollForMeasuredItem({
        index: 18,
        anchorIndex: 18,
        stickToBottom: false,
      }),
    ).toBe(false);

    expect(
      shouldAdjustTranscriptScrollForMeasuredItem({
        index: 5,
        anchorIndex: 18,
        stickToBottom: true,
      }),
    ).toBe(false);
  });

  it("preserves bottom distance when the viewport resizes away from the bottom", () => {
    expect(
      deriveTranscriptScrollTopForViewportResize({
        scrollTop: 320,
        previousClientHeight: 500,
        nextClientHeight: 440,
        stickToBottom: false,
      }),
    ).toBe(380);

    expect(
      deriveTranscriptScrollTopForViewportResize({
        scrollTop: 320,
        previousClientHeight: 500,
        nextClientHeight: 440,
        stickToBottom: true,
      }),
    ).toBeNull();
  });

  it("uses a monotonic cubic ease-out for programmatic scroll-to-bottom motion", () => {
    expect(easeTranscriptScrollToBottom(0)).toBe(0);
    expect(easeTranscriptScrollToBottom(1)).toBe(1);
    expect(easeTranscriptScrollToBottom(0.5)).toBeGreaterThan(0.5);
    expect(easeTranscriptScrollToBottom(0.75)).toBeGreaterThan(easeTranscriptScrollToBottom(0.5));
  });
});
