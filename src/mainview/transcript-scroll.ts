export const TRANSCRIPT_STICK_TO_BOTTOM_THRESHOLD_PX = 24;

export interface TranscriptScrollBehaviorInput {
  animated: boolean;
  reducedMotion: boolean;
}

export interface TranscriptRestoreInput<T> {
  anchorId: string | null;
  offsetPx: number;
  rows: readonly T[];
  getRowKey: (row: T) => string;
}

export type TranscriptRestoreTarget =
  | { kind: "anchor"; index: number }
  | { kind: "offset"; offsetPx: number };

export function getTranscriptNativeScrollBehavior(
  input: TranscriptScrollBehaviorInput,
): ScrollBehavior {
  return input.animated && !input.reducedMotion ? "smooth" : "auto";
}

export function resolveTranscriptRestoreTarget<T>(
  input: TranscriptRestoreInput<T>,
): TranscriptRestoreTarget {
  const anchorIndex = input.anchorId
    ? input.rows.findIndex((row) => input.getRowKey(row) === input.anchorId)
    : -1;

  if (anchorIndex >= 0) {
    return { kind: "anchor", index: anchorIndex };
  }

  return { kind: "offset", offsetPx: Math.max(0, input.offsetPx) };
}
