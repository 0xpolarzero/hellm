import type { FormEvent } from "react";
import { GOAL_SUGGESTIONS } from "./onboardingScript";
import { useOnboardingStore } from "./onboardingStore";

/**
 * The first inline form Smithers hands you in the conversation: one question,
 * with one-tap suggestion chips (including "I'm not sure yet", which takes the
 * recommended default). It is store-backed, so there's no component state. Once
 * the goal is submitted the card locks to a compact summary of the answer, the
 * way a sent form reads in a chat.
 */
export function OnboardingGoalCard() {
  const step = useOnboardingStore((state) => state.step);
  const goal = useOnboardingStore((state) => state.draft.goal);
  const setGoal = useOnboardingStore((state) => state.setGoal);
  const submitGoal = useOnboardingStore((state) => state.submitGoal);
  const skip = useOnboardingStore((state) => state.skip);

  if (step !== "welcome") {
    return (
      <div className="ob-card ob-card--locked">
        <span className="ob-answer-label">You asked for</span>
        <span className="ob-answer">{goal.trim() || "a starter workflow"}</span>
      </div>
    );
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submitGoal(goal);
  };

  return (
    <div className="ob-card">
      <form className="ob-goal" onSubmit={onSubmit}>
        <input
          aria-label="What would you like a workflow to do?"
          autoFocus
          className="ob-goal-input"
          placeholder="e.g. ship the new billing page"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
        />
        <button className="ob-goal-send" type="submit">
          Continue →
        </button>
      </form>

      <div className="ob-suggestions">
        {GOAL_SUGGESTIONS.map((suggestion) => (
          <button
            className="ob-chip"
            key={suggestion}
            type="button"
            onClick={() => submitGoal(suggestion === "I'm not sure yet" ? "" : suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <button className="ob-skip-link" type="button" onClick={skip}>
        Skip setup
      </button>
    </div>
  );
}
