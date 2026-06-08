import { currentRedirectPath } from "./authClient";
import { useAuthStore } from "./authStore";
import { SignInForm } from "./SignInForm";
import "./auth.css";

/**
 * The sign-in overlay. The "Sign in" chip opens this instead of navigating to
 * the /login page, so the user keeps their place. Provider login still leaves
 * for the OAuth authorize URL and returns to the current path; token login
 * validates in place and just closes the modal. Backdrop click closes. Renders
 * nothing when closed.
 */
export function SignInModal() {
  const open = useAuthStore((state) => state.signInOpen);
  const status = useAuthStore((state) => state.status);
  const closeSignIn = useAuthStore((state) => state.closeSignIn);

  // Once signed in (token login, or the "I already signed in" recheck) there is
  // nothing left to do — drop the overlay so the user lands back on their page.
  if (!open || status === "signed-in") {
    return null;
  }

  return (
    <div className="signin-backdrop" role="presentation" onClick={closeSignIn}>
      <div
        className="signin-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Sign in to Smithers"
        onClick={(event) => event.stopPropagation()}
      >
        <SignInForm redirect={currentRedirectPath()} onTokenSuccess={closeSignIn} onClose={closeSignIn} />
      </div>
    </div>
  );
}
