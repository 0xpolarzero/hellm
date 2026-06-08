import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useChatStore } from "../chat/chatStore";
import { useNotificationsStore } from "../notifications/notificationsStore";
import { useWorkflowsStore } from "../store/workflowsStore";
import {
  DEFAULT_DRAFT,
  TEMPLATES,
  draftForGoal,
  draftToName,
  draftToStarter,
  type TemplateId,
  type WorkflowDraft,
} from "./createWorkflowFlow";
import { WELCOME_LINES, goalResponse } from "./onboardingScript";

/**
 * The phases of the first run, in order.
 * - `intro`  — the full-bleed splash, the mark drawing itself on.
 * - `lift`   — the splash dissolving: the mark flies to the corner while the
 *              real conversation is seeded behind it.
 * - `welcome`/`build`/`done` — onboarding now lives *in the chat*. There is no
 *   overlay; the steps just say which inline card is the live one.
 */
export type OnboardingStep = "intro" | "lift" | "welcome" | "build" | "done";

type OnboardingState = {
  /** Whether onboarding has run. The only persisted field. */
  completed: boolean;
  step: OnboardingStep;
  /** The workflow being assembled in the build step. */
  draft: WorkflowDraft;

  /** Leave the splash: start the fly-to-corner and seed the conversation.
   *  Idempotent — the splash can fire its animation-end more than once. */
  enterLift: () => void;
  /** The fly-to-corner has landed: drop the overlay, hand off to the chat. */
  enterChat: () => void;
  /** Track the goal box as the user types it (the live, uncommitted value). */
  setGoal: (goal: string) => void;
  /** Commit the goal, classify it, and reply with the proposed build card. */
  submitGoal: (goal: string) => void;

  pickTemplate: (templateId: TemplateId) => void;
  toggleApproval: () => void;
  toggleLoop: () => void;
  setName: (name: string) => void;

  /** Commit the draft: install it, prime the composer, and finish. */
  createWorkflow: () => void;
  /** End onboarding without creating anything. */
  skip: () => void;
  /** Mark the first run done. */
  complete: () => void;
  /** Replay onboarding from the top (dogfooding, e2e, the /onboarding slash). */
  reset: () => void;
};

/** Pacing of the scripted reveal — assistant lines drop in one at a time. */
const LINE_GAP_MS = 340;
/** Backstop that hands off to the chat even if the fly animation-end is missed. */
const LIFT_MS = 900;

// Pending timers for the staggered reveal and the lift handoff. Module-level (not
// React state) so a plain action can schedule them and `reset` can cancel them —
// the prescribed pattern for time in this app: timers live by the store, never in
// an effect.
let scriptTimers: ReturnType<typeof setTimeout>[] = [];
function clearTimers(): void {
  for (const id of scriptTimers) {
    clearTimeout(id);
  }
  scriptTimers = [];
}
function later(ms: number, run: () => void): void {
  scriptTimers.push(setTimeout(run, ms));
}

/** Post the assistant's scripted lines one at a time, then run `tail` (the card). */
function streamLines(texts: string[], tail: () => void): void {
  const chat = useChatStore.getState();
  texts.forEach((text, index) => {
    if (index === 0) {
      chat.say(text);
    } else {
      later(index * LINE_GAP_MS, () => useChatStore.getState().say(text));
    }
  });
  later(texts.length * LINE_GAP_MS, tail);
}

/**
 * Onboarding on a split medium: `completed` persists to localStorage (so the
 * first run happens once), while `step` and `draft` are transient and reset on
 * reload. `partialize` keeps the persisted blob to just the flag. There are no
 * effects — the splash advances on an animation-end event, and the conversation
 * is driven straight into the live chat store from these actions.
 */
export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      completed: false,
      step: "intro",
      draft: DEFAULT_DRAFT,

      enterLift: () => {
        if (get().step !== "intro") {
          return;
        }
        clearTimers();
        set({ step: "lift" });
        // Seed the conversation *now*, behind the dissolving splash, so the chat
        // is already alive when the overlay clears. The greeting and the goal
        // card stream in as the mark flies to the corner.
        streamLines(
          WELCOME_LINES.map((line) => line.text),
          () => useChatStore.getState().postCard({ kind: "onboardingGoal" }),
        );
        // Hand off when the fly lands; the overlay also calls enterChat on its
        // animation-end, whichever fires first wins (this is the backstop).
        later(LIFT_MS, () => get().enterChat());
      },

      enterChat: () => {
        if (get().step === "lift") {
          set({ step: "welcome" });
        }
      },

      setGoal: (goal) => set((state) => ({ draft: { ...state.draft, goal } })),

      submitGoal: (goal) => {
        const draft = draftForGoal(goal);
        set({ draft, step: "build" });
        streamLines(
          goalResponse(draft).map((line) => line.text),
          () => useChatStore.getState().postCard({ kind: "onboardingBuild" }),
        );
      },

      pickTemplate: (templateId) =>
        set((state) => ({
          draft: {
            ...state.draft,
            templateId,
            // A read-only template has nothing to loop; don't carry a stale toggle.
            withLoop: TEMPLATES[templateId].loop ? state.draft.withLoop : false,
            name: state.draft.name || draftToName({ ...state.draft, templateId }),
          },
        })),

      toggleApproval: () =>
        set((state) => ({ draft: { ...state.draft, withApproval: !state.draft.withApproval } })),

      toggleLoop: () =>
        set((state) => ({ draft: { ...state.draft, withLoop: !state.draft.withLoop } })),

      setName: (name) => set((state) => ({ draft: { ...state.draft, name } })),

      createWorkflow: () => {
        const draft = get().draft;
        const template = TEMPLATES[draft.templateId];
        const name = draft.name || draftToName(draft);
        // Install the matched workflow so it's ready in the store, and prime the
        // composer with the user's own words so their first real action is one
        // keystroke away. Both reuse the live app stores — onboarding lands the
        // user inside the product, not on a dead end.
        useWorkflowsStore.getState().install(template.installId);
        useChatStore.getState().fill(draftToStarter(draft));
        useChatStore
          .getState()
          .say(`Created ${name}. It's in your store and waiting in the composer — hit send when you're ready.`);
        useNotificationsStore.getState().notify({
          title: `Created ${name}`,
          detail: "Ready in your composer and the store.",
          kind: "transient",
        });
        get().complete();
      },

      skip: () => {
        if (get().step === "build" || get().step === "welcome") {
          useChatStore
            .getState()
            .say("No problem — explore on your own. I'm one message away whenever you want to build something.");
        }
        get().complete();
      },

      complete: () => set({ completed: true, step: "done" }),

      reset: () => {
        clearTimers();
        useChatStore.getState().clear();
        set({ completed: false, step: "intro", draft: DEFAULT_DRAFT });
      },
    }),
    {
      name: "smithers.onboarding",
      partialize: (state) => ({ completed: state.completed }),
    },
  ),
);
