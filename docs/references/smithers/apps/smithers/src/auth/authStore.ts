import { create } from "zustand";
import {
  authFetch,
  clearLocalAuth,
  consumePostLoginRedirect,
  getGatewayBaseUrl,
  hasStoredToken,
  parseAuthUser,
  providerAuthorizeUrl,
  rememberPostLoginRedirect,
  setGatewayBaseUrl as persistGatewayBaseUrl,
  setStoredToken,
  type AuthProvider,
  type AuthUser,
} from "./authClient";

export type AuthStatus = "unknown" | "checking" | "signed-in" | "signed-out";

type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  hasToken: boolean;
  gatewayBaseUrl: string;
  signInOpen: boolean;
  // Sign-in form fields live here, not in component useState, per the app's
  // zustand-only rule (state-and-routing.md). Shared by SignInForm in both the
  // modal and the /login page.
  signInEmail: string;
  signInToken: string;
  signInSubmitting: "token" | "email" | null;
  bootstrap: () => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
  signInWithProvider: (provider: AuthProvider, options?: { email?: string; redirect?: string }) => void;
  signInWithToken: (token: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setGatewayBaseUrl: (baseUrl: string) => void;
  openSignIn: () => void;
  closeSignIn: () => void;
  setSignInEmail: (email: string) => void;
  setSignInToken: (token: string) => void;
  submitSignInEmail: (redirect: string) => void;
  submitSignInToken: () => Promise<boolean>;
};

function redirectAfterOAuthIfNeeded(user: AuthUser | null): void {
  if (!user || typeof window === "undefined") return;
  const redirect = consumePostLoginRedirect();
  if (!redirect || redirect === window.location.pathname) return;
  window.location.replace(redirect);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "unknown",
  user: null,
  error: null,
  hasToken: hasStoredToken(),
  gatewayBaseUrl: getGatewayBaseUrl(),
  signInOpen: false,
  signInEmail: "",
  signInToken: "",
  signInSubmitting: null,

  bootstrap: async () => {
    if (get().status === "checking") return;
    await get().refreshUser();
  },

  refreshUser: async () => {
    set({ status: "checking", error: null, hasToken: hasStoredToken() });
    try {
      const response = await authFetch("/api/user");
      if (!response.ok) {
        set({
          status: "signed-out",
          user: null,
          hasToken: hasStoredToken(),
          error: response.status === 404 ? null : `Auth check failed (${response.status})`,
        });
        return null;
      }
      const user = parseAuthUser(await response.json());
      if (!user) {
        set({ status: "signed-out", user: null, error: "Auth response did not include a user." });
        return null;
      }
      set({ status: "signed-in", user, hasToken: hasStoredToken(), error: null });
      redirectAfterOAuthIfNeeded(user);
      return user;
    } catch (error) {
      set({
        status: "signed-out",
        user: null,
        hasToken: hasStoredToken(),
        error: error instanceof Error ? error.message : "Auth check failed.",
      });
      return null;
    }
  },

  signInWithProvider: (provider, options = {}) => {
    rememberPostLoginRedirect(options.redirect);
    window.location.href = providerAuthorizeUrl(provider, options);
  },

  signInWithToken: async (token) => {
    if (!setStoredToken(token)) {
      set({ error: "Browser storage is unavailable." });
      return false;
    }
    const user = await get().refreshUser();
    if (!user) {
      clearLocalAuth();
      set({ hasToken: false, status: "signed-out", user: null, error: "Invalid token." });
      return false;
    }
    return true;
  },

  logout: async () => {
    try {
      await authFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Best-effort logout: always clear local state.
    }
    clearLocalAuth();
    set({ status: "signed-out", user: null, hasToken: false, error: null });
  },

  setGatewayBaseUrl: (baseUrl) => {
    persistGatewayBaseUrl(baseUrl);
    set({ gatewayBaseUrl: getGatewayBaseUrl() });
  },

  // Reset the form on open so a reopened modal starts clean (mirrors the old
  // per-mount useState).
  openSignIn: () =>
    set({ signInOpen: true, error: null, signInEmail: "", signInToken: "", signInSubmitting: null }),
  closeSignIn: () => set({ signInOpen: false }),

  setSignInEmail: (signInEmail) => set({ signInEmail }),
  setSignInToken: (signInToken) => set({ signInToken }),

  submitSignInEmail: (redirect) => {
    set({ signInSubmitting: "email" });
    get().signInWithProvider("email", { email: get().signInEmail, redirect });
  },

  submitSignInToken: async () => {
    const token = get().signInToken.trim();
    if (!token) return false;
    set({ signInSubmitting: "token" });
    const ok = await get().signInWithToken(token);
    set({ signInSubmitting: null });
    return ok;
  },
}));
