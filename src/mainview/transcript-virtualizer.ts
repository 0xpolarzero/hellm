export interface TranscriptWindow {
  startIndex: number;
  endIndex: number;
  totalHeight: number;
}

export interface TranscriptVirtualizerOptions {
  estimatedRowHeight?: number;
  rowGapPx?: number;
  overscanPx?: number;
  bottomThresholdPx?: number;
}

class FenwickTree {
  private values: number[] = [0];

  get size(): number {
    return this.values.length - 1;
  }

  reset(size = 0): void {
    this.values = Array.from({ length: size + 1 }, () => 0);
  }

  ensureSize(size: number): void {
    if (size <= this.size) return;

    const nextValues = Array.from({ length: size + 1 }, () => 0);
    for (let index = 1; index < this.values.length; index += 1) {
      nextValues[index] = this.values[index] ?? 0;
    }
    this.values = nextValues;
  }

  add(index: number, delta: number): void {
    for (let cursor = index + 1; cursor < this.values.length; cursor += cursor & -cursor) {
      this.values[cursor] = (this.values[cursor] ?? 0) + delta;
    }
  }

  prefixSum(count: number): number {
    let total = 0;
    for (let cursor = Math.min(count, this.size); cursor > 0; cursor -= cursor & -cursor) {
      total += this.values[cursor] ?? 0;
    }
    return total;
  }

  lowerBound(target: number): number {
    if (target <= 0) return 0;
    if (this.size === 0) return 0;

    let cursor = 0;
    let sum = 0;
    let bitMask = 1;

    while (bitMask << 1 <= this.size) {
      bitMask <<= 1;
    }

    for (let step = bitMask; step !== 0; step >>= 1) {
      const next = cursor + step;
      if (next <= this.size && sum + (this.values[next] ?? 0) < target) {
        cursor = next;
        sum += this.values[next] ?? 0;
      }
    }

    return cursor;
  }
}

export class TranscriptVirtualizer {
  private count = 0;
  private readonly rowHeights: number[] = [];
  private readonly tree = new FenwickTree();
  private estimatedRowHeight: number;
  private rowGapPx: number;
  private readonly overscanPx: number;
  private readonly bottomThresholdPx: number;

  constructor(options: TranscriptVirtualizerOptions = {}) {
    this.estimatedRowHeight = options.estimatedRowHeight ?? 132;
    this.rowGapPx = options.rowGapPx ?? 16;
    this.overscanPx = options.overscanPx ?? 900;
    this.bottomThresholdPx = options.bottomThresholdPx ?? 48;
  }

  reset(): void {
    this.count = 0;
    this.rowHeights.length = 0;
    this.tree.reset();
  }

  setRowGap(rowGapPx: number): boolean {
    if (rowGapPx === this.rowGapPx) return false;
    this.rowGapPx = rowGapPx;
    this.rebuildTree();
    return true;
  }

  setItemCount(count: number): void {
    if (count < this.count) {
      this.count = Math.max(0, count);
      this.rowHeights.length = this.count;
      this.rebuildTree(this.tree.size || this.count);
      return;
    }

    if (count === this.count) return;

    if (count > this.tree.size) {
      const nextCapacity = Math.max(count, this.tree.size > 0 ? this.tree.size * 2 : 1);
      this.rebuildTree(nextCapacity);
    }

    while (this.count < count) {
      if (this.count > 0) {
        this.tree.add(this.count - 1, this.rowGapPx);
      }

      const nextIndex = this.count;
      const value = this.defaultRowHeightForIndex(nextIndex);
      this.rowHeights[nextIndex] = value;
      this.count += 1;
      this.tree.add(nextIndex, value);
    }
  }

  recordHeight(index: number, height: number): number {
    if (index < 0 || index >= this.count || !Number.isFinite(height) || height <= 0) {
      return 0;
    }

    const nextHeight = Math.round(height);
    const currentHeight = this.rowHeights[index] ?? this.defaultRowHeightForIndex(index);
    if (currentHeight === nextHeight) return 0;

    this.rowHeights[index] = nextHeight;
    const delta = nextHeight - currentHeight;
    this.tree.add(index, delta);
    return delta;
  }

  getTotalHeight(): number {
    return this.tree.prefixSum(this.count);
  }

  getOffsetForIndex(index: number): number {
    return this.tree.prefixSum(this.clampIndex(index));
  }

  getIndexAtOffset(offset: number): number {
    if (this.count === 0) return 0;
    const safeOffset = Math.max(0, offset);
    return Math.min(this.count, this.tree.lowerBound(safeOffset + 0.001));
  }

  getWindow(
    scrollTop: number,
    viewportHeight: number,
    overscanPx = this.overscanPx,
  ): TranscriptWindow {
    if (this.count === 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        totalHeight: 0,
      };
    }

    const totalHeight = this.getTotalHeight();
    const startOffset = Math.max(0, scrollTop - overscanPx);
    const endOffset = Math.max(startOffset, scrollTop + Math.max(0, viewportHeight) + overscanPx);
    const startIndex = this.getIndexAtOffset(startOffset);
    const endIndex = Math.max(
      startIndex,
      Math.min(this.count, this.getIndexAtOffset(Math.max(0, endOffset - 0.001)) + 1),
    );

    return {
      startIndex,
      endIndex,
      totalHeight,
    };
  }

  isAtBottom(
    scrollTop: number,
    viewportHeight: number,
    thresholdPx = this.bottomThresholdPx,
  ): boolean {
    const totalHeight = this.getTotalHeight();
    return totalHeight - (scrollTop + viewportHeight) <= thresholdPx;
  }

  private rebuildTree(capacity = this.tree.size || this.count): void {
    this.tree.reset(Math.max(capacity, this.count));
    for (let index = 0; index < this.count; index += 1) {
      this.tree.add(index, this.rowBlockHeight(index));
    }
  }

  private rowBlockHeight(index: number): number {
    const baseHeight = this.rowHeights[index] ?? this.defaultRowHeightForIndex(index);
    return baseHeight + (index < this.count - 1 ? this.rowGapPx : 0);
  }

  private defaultRowHeightForIndex(_index: number): number {
    return this.estimatedRowHeight;
  }

  private clampIndex(index: number): number {
    if (index <= 0) return 0;
    if (index >= this.count) return this.count;
    return index;
  }
}
