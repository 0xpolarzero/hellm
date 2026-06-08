import { useOnboardingStore } from "../onboarding/onboardingStore";
import { SmithersMark } from "./SmithersMark";
import "./cornerLogo.css";

/**
 * The persistent Smithers mark in the top-right corner — the app's logo once
 * you're in. It stays hidden through the first-run splash (`intro`/`lift`),
 * where the big animated mark is the only logo, then pops into place exactly as
 * the splash mark flies up and dissolves, so the brand reads as "landing" in the
 * corner. For a returning user (already onboarded) it's simply always there.
 */
export function CornerLogo() {
  const completed = useOnboardingStore((state) => state.completed);
  const step = useOnboardingStore((state) => state.step);
  const shown = completed || (step !== "intro" && step !== "lift");

  return (
    <div
      className={shown ? "corner-logo is-shown" : "corner-logo"}
      role="img"
      aria-label="Smithers"
    >
      <SmithersMark part="corner-logo" aria-hidden="true" />
    </div>
  );
}
