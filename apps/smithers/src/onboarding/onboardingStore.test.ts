import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useChatStore } from "../chat/chatStore";
import { classifyIntent } from "./createWorkflowFlow";
import { useOnboardingStore } from "./onboardingStore";

/**
 * The onboarding step machine. Drives the store's actions directly (no React)
 * and asserts the transitions plus the chat side effects the flow now relies on:
 * onboarding *is* the conversation, so each transition seeds the chat store with
 * the assistant's lines and the inline cards. createWorkflow's effects on the
 * workflows store are covered where that store lives; here we exercise the
 * navigation between phases, the draft edits, and what lands in the chat.
 */

beforeEach(() => {
  useOnboardingStore.getState().reset();
});

afterEach(() => {
  // reset() schedules staggered-reveal timers; clear the chat after each test so
  // a late line can't bleed into the next test's assertions.
  useChatStore.getState().clear();
});

describe("onboarding step machine", () => {
  test("starts on the splash, not yet completed", () => {
    const state = useOnboardingStore.getState();
    expect(state.step).toBe("intro");
    expect(state.completed).toBe(false);
  });

  test("enterLift leaves the splash, seeds the chat, and is idempotent", () => {
    const { enterLift } = useOnboardingStore.getState();
    enterLift();
    expect(useOnboardingStore.getState().step).toBe("lift");
    // The greeting's first line is posted immediately (the rest stagger in).
    const messages = useChatStore.getState().messages;
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]?.role).toBe("assistant");

    // Firing again (the animation-end can repeat) does not bounce the step.
    enterLift();
    expect(useOnboardingStore.getState().step).toBe("lift");
  });

  test("enterChat hands the splash off to the live conversation", () => {
    const store = useOnboardingStore.getState();
    store.enterLift();
    store.enterChat();
    expect(useOnboardingStore.getState().step).toBe("welcome");
    // enterChat only acts on the lift; calling it from welcome is inert.
    store.enterChat();
    expect(useOnboardingStore.getState().step).toBe("welcome");
  });

  test("submitGoal classifies the goal, moves to the builder, and replies in chat", () => {
    useOnboardingStore.getState().submitGoal("review my open PR");
    const { step, draft } = useOnboardingStore.getState();
    expect(step).toBe("build");
    expect(draft.goal).toBe("review my open PR");
    expect(draft.templateId).toBe(classifyIntent("review my open PR"));

    // Smithers' reply opens immediately; the rest of the lines and the build
    // card stream in on a stagger (their delivery is covered by the e2e flow).
    const messages = useChatStore.getState().messages;
    expect(messages.at(-1)?.role).toBe("assistant");
    expect(messages.at(-1)?.text).toContain("review my open PR");
  });

  test("an empty goal still advances, on the recommended default", () => {
    useOnboardingStore.getState().submitGoal("");
    const { step, draft } = useOnboardingStore.getState();
    expect(step).toBe("build");
    expect(draft.templateId).toBe("research-plan-implement");
  });

  test("setGoal tracks the live box without reclassifying", () => {
    const before = useOnboardingStore.getState().draft.templateId;
    useOnboardingStore.getState().setGoal("review this");
    const { draft } = useOnboardingStore.getState();
    expect(draft.goal).toBe("review this");
    // Live typing only updates text; classification waits for submit.
    expect(draft.templateId).toBe(before);
  });

  test("refine toggles flip the draft", () => {
    const store = useOnboardingStore.getState();
    store.submitGoal("implement a feature");
    const start = useOnboardingStore.getState().draft.withApproval;
    store.toggleApproval();
    expect(useOnboardingStore.getState().draft.withApproval).toBe(!start);
    store.toggleLoop();
    expect(useOnboardingStore.getState().draft.withLoop).toBe(true);
  });

  test("pickTemplate switches the shape", () => {
    const store = useOnboardingStore.getState();
    store.submitGoal("implement a feature");
    store.pickTemplate("debug");
    expect(useOnboardingStore.getState().draft.templateId).toBe("debug");
  });

  test("skip and complete finish the first run", () => {
    useOnboardingStore.getState().skip();
    expect(useOnboardingStore.getState().completed).toBe(true);
    expect(useOnboardingStore.getState().step).toBe("done");

    useOnboardingStore.getState().reset();
    expect(useOnboardingStore.getState().completed).toBe(false);

    useOnboardingStore.getState().complete();
    expect(useOnboardingStore.getState().completed).toBe(true);
  });

  test("reset clears the conversation so a replay starts clean", () => {
    useOnboardingStore.getState().enterLift();
    expect(useChatStore.getState().messages.length).toBeGreaterThan(0);
    useOnboardingStore.getState().reset();
    expect(useChatStore.getState().messages.length).toBe(0);
    expect(useOnboardingStore.getState().step).toBe("intro");
  });
});
