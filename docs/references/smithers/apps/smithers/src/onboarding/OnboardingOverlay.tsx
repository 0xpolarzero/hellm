import { SmithersIntro } from "./SmithersIntro";
import { useOnboardingStore } from "./onboardingStore";

/**
 * The first-run splash. It is full-bleed only for the opening (`intro`) and its
 * hand-off (`lift`): the mark draws on, then flies to the corner while the
 * backdrop dissolves to reveal the conversation underneath. Past the lift,
 * onboarding lives entirely in the chat (the goal and build cards), so this
 * renders nothing.
 */
export function OnboardingOverlay() {
  const step = useOnboardingStore((state) => state.step);

  if (step !== "intro" && step !== "lift") {
    return null;
  }

  const className =
    step === "lift"
      ? "ob-overlay ob-overlay--intro ob-overlay--lift"
      : "ob-overlay ob-overlay--intro";

  return (
    <div className={className}>
      <SmithersIntro lifting={step === "lift"} />
    </div>
  );
}
