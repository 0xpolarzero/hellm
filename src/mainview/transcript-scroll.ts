export const TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX = 24;
export const TRANSCRIPT_SCROLL_TO_BOTTOM_DURATION_MS = 260;

export interface TranscriptUserScrollInput {
  clientHeight: number;
  currentAnchorIndex: number;
  getIndexAtOffset: (offset: number) => number;
  scrollHeight: number;
  scrollTop: number;
  shouldVirtualize: boolean;
  thresholdPx?: number;
}

export interface TranscriptUserScrollState {
  anchorIndex: number;
  autoScroll: boolean;
  stickToBottom: boolean;
}

export interface TranscriptMeasurementAdjustmentInput {
  anchorIndex: number;
  index: number;
  stickToBottom: boolean;
}

export interface TranscriptDistanceFromBottomInput {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

export interface TranscriptViewportResizeInput {
  nextClientHeight: number;
  previousClientHeight: number;
  scrollTop: number;
  stickToBottom: boolean;
}

export function getTranscriptDistanceFromBottom(input: TranscriptDistanceFromBottomInput): number {
  return Math.max(0, input.scrollHeight - input.scrollTop - input.clientHeight);
}

export function easeTranscriptScrollToBottom(progress: number): number {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  return 1 - (1 - clampedProgress) ** 3;
}

export function deriveTranscriptScrollTopForViewportResize(
  input: TranscriptViewportResizeInput,
): number | null {
  if (input.stickToBottom || input.previousClientHeight <= 0 || input.nextClientHeight <= 0) {
    return null;
  }
  const heightDelta = input.previousClientHeight - input.nextClientHeight;
  if (heightDelta === 0) return null;
  return Math.max(0, input.scrollTop + heightDelta);
}

export function deriveTranscriptUserScrollState(
  input: TranscriptUserScrollInput,
): TranscriptUserScrollState {
  const thresholdPx = input.thresholdPx ?? TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX;
  const distanceFromBottom = getTranscriptDistanceFromBottom(input);
  const stickToBottom = distanceFromBottom <= thresholdPx;

  return {
    stickToBottom,
    autoScroll: stickToBottom,
    anchorIndex:
      !stickToBottom && input.shouldVirtualize
        ? input.getIndexAtOffset(input.scrollTop)
        : input.currentAnchorIndex,
  };
}

export function shouldAdjustTranscriptScrollForMeasuredItem(
  input: TranscriptMeasurementAdjustmentInput,
): boolean {
  return !input.stickToBottom && input.index < input.anchorIndex;
}
