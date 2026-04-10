export interface PromptHistoryEntry {
  text: string;
  sentAt: number;
  workspaceId: string;
  sessionId?: string;
}

export interface PromptHistoryNavigationState {
  activeIndex: number | null;
  draftSnapshot: string | null;
}

export type PromptHistoryDirection = "older" | "newer";

export interface PromptHistoryNavigationResult {
  changed: boolean;
  nextDraft: string;
  nextState: PromptHistoryNavigationState;
}

export interface PromptHistoryActivationOptions {
  direction: PromptHistoryDirection;
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  higherPriorityUiActive?: boolean;
}

export function createPromptHistoryNavigationState(): PromptHistoryNavigationState {
  return {
    activeIndex: null,
    draftSnapshot: null,
  };
}

export function shouldActivatePromptHistoryNavigation({
  direction,
  value,
  selectionStart,
  selectionEnd,
  higherPriorityUiActive = false,
}: PromptHistoryActivationOptions): boolean {
  if (higherPriorityUiActive) return false;
  if (selectionStart === null || selectionEnd === null) return false;
  if (selectionStart !== selectionEnd) return false;

  return direction === "older"
    ? isCaretAtDraftStart(value, selectionStart)
    : isCaretAtDraftEnd(value, selectionStart);
}

export function navigatePromptHistory(
  entries: readonly PromptHistoryEntry[],
  state: PromptHistoryNavigationState,
  draft: string,
  direction: PromptHistoryDirection,
): PromptHistoryNavigationResult {
  if (entries.length === 0) {
    return {
      changed: false,
      nextDraft: draft,
      nextState: state,
    };
  }

  const newestIndex = entries.length - 1;
  const activeIndex = normalizeActiveIndex(state.activeIndex, newestIndex);

  if (direction === "older") {
    if (activeIndex === null) {
      const newestEntry = entries[newestIndex]!;
      return {
        changed: true,
        nextDraft: newestEntry.text,
        nextState: {
          activeIndex: newestIndex,
          draftSnapshot: draft,
        },
      };
    }

    if (activeIndex === 0) {
      return {
        changed: false,
        nextDraft: draft,
        nextState: state,
      };
    }

    const olderEntry = entries[activeIndex - 1]!;
    return {
      changed: true,
      nextDraft: olderEntry.text,
      nextState: {
        activeIndex: activeIndex - 1,
        draftSnapshot: state.draftSnapshot,
      },
    };
  }

  if (activeIndex === null) {
    return {
      changed: false,
      nextDraft: draft,
      nextState: state,
    };
  }

  if (activeIndex === newestIndex) {
    return {
      changed: true,
      nextDraft: state.draftSnapshot ?? "",
      nextState: createPromptHistoryNavigationState(),
    };
  }

  const newerEntry = entries[activeIndex + 1]!;
  return {
    changed: true,
    nextDraft: newerEntry.text,
    nextState: {
      activeIndex: activeIndex + 1,
      draftSnapshot: state.draftSnapshot,
    },
  };
}

export function isCaretAtDraftStart(value: string, caretPosition: number): boolean {
  return clampCaretPosition(value, caretPosition) === 0;
}

export function isCaretAtDraftEnd(value: string, caretPosition: number): boolean {
  return clampCaretPosition(value, caretPosition) === value.length;
}

function clampCaretPosition(value: string, caretPosition: number): number {
  return Math.max(0, Math.min(caretPosition, value.length));
}

function normalizeActiveIndex(activeIndex: number | null, newestIndex: number): number | null {
  if (activeIndex === null) return null;
  if (activeIndex < 0 || activeIndex > newestIndex) return null;
  return activeIndex;
}
