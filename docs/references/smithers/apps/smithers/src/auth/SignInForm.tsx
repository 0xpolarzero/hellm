import type { FormEvent } from "react";
import { useAuthStore } from "./authStore";
import { authProviderSelectionEnabled } from "./authClient";

/**
 * The sign-in panel — provider buttons, optional email/token forms. Shared by
 * the full-page {@link LoginPage} route (used for 401 redirects) and the
 * {@link SignInModal} overlay, so the two never drift. The caller owns the
 * destination: `redirect` is where OAuth returns to, and `onTokenSuccess` runs
 * after a token login validates (close the modal, or navigate the page).
 */
export function SignInForm({
  redirect,
  onTokenSuccess,
  onClose,
}: {
  redirect: string;
  onTokenSuccess: () => void;
  onClose?: () => void;
}) {
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const email = useAuthStore((state) => state.signInEmail);
  const token = useAuthStore((state) => state.signInToken);
  const submitting = useAuthStore((state) => state.signInSubmitting);
  const setEmail = useAuthStore((state) => state.setSignInEmail);
  const setToken = useAuthStore((state) => state.setSignInToken);
  const signInWithProvider = useAuthStore((state) => state.signInWithProvider);
  const submitSignInEmail = useAuthStore((state) => state.submitSignInEmail);
  const submitSignInToken = useAuthStore((state) => state.submitSignInToken);
  const refreshUser = useAuthStore((state) => state.refreshUser);

  const canSelectProvider = authProviderSelectionEnabled();

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    submitSignInEmail(redirect);
  };

  const submitToken = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await submitSignInToken();
    if (ok) {
      onTokenSuccess();
    }
  };

  return (
    <div className="login-panel">
      {onClose ? (
        <button className="signin-close" type="button" aria-label="Close sign in" onClick={onClose}>
          ✕
        </button>
      ) : null}
      <header className="login-head">
        <span className="login-mark">S</span>
        <div>
          <h1>Sign in to Smithers</h1>
          <p>Use the same Plue identity for remote sandboxes and gateway runs.</p>
        </div>
      </header>

      {error ? <div className="login-error">{error}</div> : null}

      {canSelectProvider ? (
        <div className="login-actions">
          <button
            className="login-provider"
            type="button"
            onClick={() => signInWithProvider("google", { redirect })}
          >
            <span className="provider-icon">G</span>
            <span>Continue with Google</span>
          </button>
          <button
            className="login-provider"
            type="button"
            onClick={() => signInWithProvider("github", { redirect })}
          >
            <span className="provider-icon">GH</span>
            <span>Continue with GitHub</span>
          </button>
        </div>
      ) : (
        <div className="login-actions">
          <button
            className="login-provider"
            type="button"
            onClick={() => signInWithProvider("email", { redirect })}
          >
            <span className="provider-icon">SSO</span>
            <span>Continue with SSO</span>
          </button>
        </div>
      )}

      {canSelectProvider ? (
        <form className="login-form" onSubmit={submitEmail}>
          <label htmlFor="login-email">Email</label>
          <div className="login-row">
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              placeholder="you@example.com"
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <button type="submit" disabled={submitting !== null || !email.trim()}>
              {submitting === "email" ? "Opening" : "Continue"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="login-divider">or use an access token</div>

      <form className="login-form" onSubmit={submitToken}>
        <label htmlFor="login-token">Token</label>
        <div className="login-row">
          <input
            id="login-token"
            type="password"
            autoComplete="current-password"
            value={token}
            placeholder="smithers_..."
            onChange={(event) => setToken(event.currentTarget.value)}
          />
          <button type="submit" disabled={submitting !== null || !token.trim()}>
            {submitting === "token" || status === "checking" ? "Checking" : "Connect"}
          </button>
        </div>
      </form>

      <button className="login-secondary" type="button" onClick={() => void refreshUser()}>
        I already signed in
      </button>
    </div>
  );
}
