import { describe, expect, it } from "bun:test";
import {
  createPromptHistoryNavigationState,
  isCaretAtDraftEnd,
  isCaretAtDraftStart,
  navigatePromptHistory,
  shouldActivatePromptHistoryNavigation,
  type PromptHistoryEntry,
} from "./prompt-history";

const HISTORY: PromptHistoryEntry[] = [
  { text: "first", sentAt: 1, workspaceId: "repo" },
  { text: "second\nentry", sentAt: 2, workspaceId: "repo" },
  { text: "third", sentAt: 3, workspaceId: "repo" },
];

describe("prompt history navigation", () => {
  it("captures the live draft when entering history with arrow up", () => {
    const result = navigatePromptHistory(
      HISTORY,
      createPromptHistoryNavigationState(),
      "draft in progress",
      "older",
    );

    expect(result.changed).toBe(true);
    expect(result.nextDraft).toBe("third");
    expect(result.nextState).toEqual({
      activeIndex: 2,
      draftSnapshot: "draft in progress",
    });
  });

  it("moves through older entries and does not wrap past the oldest entry", () => {
    const firstStep = navigatePromptHistory(
      HISTORY,
      createPromptHistoryNavigationState(),
      "",
      "older",
    );
    const secondStep = navigatePromptHistory(
      HISTORY,
      firstStep.nextState,
      firstStep.nextDraft,
      "older",
    );
    const thirdStep = navigatePromptHistory(
      HISTORY,
      secondStep.nextState,
      secondStep.nextDraft,
      "older",
    );
    const noWrapStep = navigatePromptHistory(
      HISTORY,
      thirdStep.nextState,
      thirdStep.nextDraft,
      "older",
    );

    expect(secondStep.nextDraft).toBe("second\nentry");
    expect(thirdStep.nextDraft).toBe("first");
    expect(noWrapStep.changed).toBe(false);
    expect(noWrapStep.nextDraft).toBe("first");
  });

  it("restores the preserved draft when moving forward past the newest entry", () => {
    const entered = navigatePromptHistory(
      HISTORY,
      createPromptHistoryNavigationState(),
      "live draft",
      "older",
    );
    const restored = navigatePromptHistory(HISTORY, entered.nextState, entered.nextDraft, "newer");

    expect(restored.changed).toBe(true);
    expect(restored.nextDraft).toBe("live draft");
    expect(restored.nextState).toEqual(createPromptHistoryNavigationState());
  });

  it("replays stored history text even after the current recalled buffer was edited", () => {
    const entered = navigatePromptHistory(
      HISTORY,
      createPromptHistoryNavigationState(),
      "",
      "older",
    );
    const movedOlder = navigatePromptHistory(
      HISTORY,
      entered.nextState,
      "third but edited",
      "older",
    );

    expect(movedOlder.nextDraft).toBe("second\nentry");
    expect(movedOlder.nextState).toEqual({
      activeIndex: 1,
      draftSnapshot: "",
    });
  });
});

describe("prompt history activation rules", () => {
  it("activates only at the absolute start or end of the draft", () => {
    expect(isCaretAtDraftStart("single line", 0)).toBe(true);
    expect(isCaretAtDraftStart("single line", 1)).toBe(false);
    expect(isCaretAtDraftEnd("top\nbottom", "top\nbottom".length)).toBe(true);
    expect(isCaretAtDraftEnd("top\nbottom", 6)).toBe(false);
  });

  it("requires a collapsed selection and the right boundary for arrow activation", () => {
    expect(
      shouldActivatePromptHistoryNavigation({
        direction: "older",
        value: "top\nbottom",
        selectionStart: 0,
        selectionEnd: 0,
      }),
    ).toBe(true);
    expect(
      shouldActivatePromptHistoryNavigation({
        direction: "newer",
        value: "top\nbottom",
        selectionStart: "top\nbottom".length,
        selectionEnd: "top\nbottom".length,
      }),
    ).toBe(true);
    expect(
      shouldActivatePromptHistoryNavigation({
        direction: "older",
        value: "top\nbottom",
        selectionStart: 1,
        selectionEnd: 1,
      }),
    ).toBe(false);
    expect(
      shouldActivatePromptHistoryNavigation({
        direction: "newer",
        value: "top\nbottom",
        selectionStart: 6,
        selectionEnd: 6,
      }),
    ).toBe(false);
  });

  it("does not activate while another UI surface owns arrow keys", () => {
    expect(
      shouldActivatePromptHistoryNavigation({
        direction: "older",
        value: "",
        selectionStart: 0,
        selectionEnd: 0,
        higherPriorityUiActive: true,
      }),
    ).toBe(false);
  });
});
