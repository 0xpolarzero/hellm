import { registerHappyDomForTests } from "../test/registerHappyDom";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetAuthRedirectForTests } from "./authClient";

beforeAll(() => {
  registerHappyDomForTests();
});

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response> | Response;

const originalFetch = globalThis.fetch;

function installFetch(handler: FetchHandler): { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls };
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

async function freshStore() {
  const mod = await import("./authStore");
  mod.useAuthStore.setState({
    status: "unknown",
    user: null,
    error: null,
    hasToken: false,
    signInOpen: false,
  });
  return mod.useAuthStore;
}

describe("authStore — Plue auth proxy paths", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  afterEach(() => {
    restoreFetch();
    resetAuthRedirectForTests();
  });

  test("signInWithToken stores token and refreshes user on valid response", async () => {
    installFetch(async (url) => {
      if (url === "/api/user") {
        return new Response(
          JSON.stringify({ id: 7, username: "will", display_name: "Will" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not-found", { status: 404 });
    });
    const useStore = await freshStore();

    const ok = await useStore.getState().signInWithToken("test-token");
    expect(ok).toBe(true);
    const state = useStore.getState();
    expect(state.status).toBe("signed-in");
    expect(state.user?.id).toBe("7");
    expect(state.user?.username).toBe("will");
    expect(state.hasToken).toBe(true);
    expect(state.error).toBe(null);
  });

  test("signInWithToken rejects empty/whitespace tokens before any fetch", async () => {
    const { calls } = installFetch(async () => new Response("", { status: 500 }));
    const useStore = await freshStore();

    const ok = await useStore.getState().signInWithToken("    ");
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(useStore.getState().error).toContain("Browser storage");
  });

  test("signInWithToken clears state when /api/user rejects the token", async () => {
    installFetch(async (url) => {
      if (url === "/api/user") return new Response("nope", { status: 401 });
      return new Response("", { status: 200 });
    });
    const useStore = await freshStore();

    // 401 triggers handleAuthRequired which redirects in real browsers; happy-dom
    // does not throw on assign, so this is safe to call.
    const ok = await useStore.getState().signInWithToken("bad-token");
    expect(ok).toBe(false);
    const state = useStore.getState();
    expect(state.status).toBe("signed-out");
    expect(state.user).toBe(null);
    expect(state.hasToken).toBe(false);
  });

  test("refreshUser treats 404 as 'no Plue session' without surfacing an error", async () => {
    installFetch(async () => new Response("nope", { status: 404 }));
    const useStore = await freshStore();

    const user = await useStore.getState().refreshUser();
    expect(user).toBe(null);
    const state = useStore.getState();
    expect(state.status).toBe("signed-out");
    expect(state.user).toBe(null);
    expect(state.error).toBe(null);
  });

  test("refreshUser surfaces non-404 status with a message", async () => {
    installFetch(async () => new Response("boom", { status: 502 }));
    const useStore = await freshStore();

    await useStore.getState().refreshUser();
    expect(useStore.getState().error).toContain("502");
  });

  test("refreshUser captures network errors", async () => {
    installFetch(async () => {
      throw new Error("offline");
    });
    const useStore = await freshStore();

    await useStore.getState().refreshUser();
    expect(useStore.getState().status).toBe("signed-out");
    expect(useStore.getState().error).toBe("offline");
  });

  test("logout clears state even when the Plue logout endpoint errors", async () => {
    installFetch(async () => {
      throw new Error("network down");
    });
    const useStore = await freshStore();
    useStore.setState({
      status: "signed-in",
      user: {
        id: "1",
        username: "u",
        displayName: "U",
        email: "u@u.test",
        avatarUrl: "",
        isAdmin: false,
      },
      hasToken: true,
    });

    await useStore.getState().logout();
    const state = useStore.getState();
    expect(state.status).toBe("signed-out");
    expect(state.user).toBe(null);
    expect(state.hasToken).toBe(false);
  });

  test("openSignIn / closeSignIn toggle the modal flag and clear error on open", async () => {
    const useStore = await freshStore();
    useStore.setState({ error: "old" });
    useStore.getState().openSignIn();
    expect(useStore.getState().signInOpen).toBe(true);
    expect(useStore.getState().error).toBe(null);
    useStore.getState().closeSignIn();
    expect(useStore.getState().signInOpen).toBe(false);
  });
});
