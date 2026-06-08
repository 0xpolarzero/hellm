import { getLoginRedirectTarget } from "./authClient";
import { SignInForm } from "./SignInForm";

/**
 * The full-page sign-in route. The explicit "Sign in" button opens the
 * {@link SignInModal} overlay instead; this route survives for hard auth
 * redirects (a 401 calls `handleAuthRequired`, which navigates here) and direct
 * `/login?redirect=...` deep links, where a full page is the right shape.
 */
export function LoginPage() {
  const redirect = getLoginRedirectTarget();
  return (
    <section className="login-page">
      <SignInForm
        redirect={redirect}
        onTokenSuccess={() => {
          window.location.href = redirect;
        }}
      />
    </section>
  );
}
