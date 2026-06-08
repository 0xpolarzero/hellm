import { OnboardingOverlay } from "./OnboardingOverlay";
import { useOnboardingStore } from "./onboardingStore";
// All onboarding styling, colocated here so it injects globally without editing
// the shared styles.css (the same pattern as featureCards.css and gateway.css).
import "./onboarding.css";

/**
 * The first-run gate. Mounted once in the shell, it renders the onboarding
 * overlay until the run is complete, then nothing. The `completed` flag hydrates
 * synchronously from localStorage, so a returning user never sees a flash.
 */
export function OnboardingGate() {
  const completed = useOnboardingStore((state) => state.completed);
  if (completed) {
    return null;
  }
  return <OnboardingOverlay />;
}
