import type { AnimationEvent } from "react";
import { SmithersMark } from "../app/SmithersMark";
import { useOnboardingStore } from "./onboardingStore";

/**
 * The opening splash: the Smithers mark draws itself (the ring strokes on, then
 * the search stem in brand green), the wordmark rises, and a "Get started"
 * button appears. It advances on the wordmark's animation-end (so it
 * auto-continues once the mark has settled) and on the button.
 *
 * On `lifting` the mark zooms up toward the top-right corner and the backdrop
 * dissolves, so the persistent corner logo and the freshly-seeded chat take its
 * place. When that fly lands (its animation-end), we hand off to the chat —
 * `enterChat` also has a timer backstop in the store in case the event is
 * missed (e.g. reduced motion).
 */
export function SmithersIntro({ lifting }: { lifting: boolean }) {
  const enterLift = useOnboardingStore((state) => state.enterLift);
  const enterChat = useOnboardingStore((state) => state.enterChat);

  const onMarkAnimationEnd = (event: AnimationEvent<SVGSVGElement>): void => {
    // Only the fly hands off; ignore the draw-on/entrance animations.
    if (event.animationName.startsWith("ob-fly")) {
      enterChat();
    }
  };

  return (
    <div className={lifting ? "ob-intro is-lifting" : "ob-intro"}>
      <div className="ob-glow" aria-hidden="true" />
      <SmithersMark
        part="ob-mark"
        className="ob-mark"
        role="img"
        aria-label="Smithers"
        onAnimationEnd={onMarkAnimationEnd}
      />
      <div className="ob-wordmark" onAnimationEnd={enterLift}>
        Smithers
      </div>
      <p className="ob-tagline">Durable agents, from a single sentence.</p>
      <button className="btn-brand ob-begin" type="button" onClick={enterLift}>
        Get started
      </button>
    </div>
  );
}
