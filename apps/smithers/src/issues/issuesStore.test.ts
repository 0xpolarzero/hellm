import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearPlatformBaseUrlForTesting,
  withPlatformBaseUrlForTesting,
} from "../jjhub/platformBaseUrl";
import { SEEDED_ISSUES } from "./issues";
import { useIssuesStore } from "./issuesStore";

/**
 * Unit coverage for `useIssuesStore.hydrateFromPlatform` — the seam that
 * promotes the issues card from seeded mode to live Plue when a platform base
 * URL is configured. Each test drives the real zustand store and either runs
 * without a base URL (no-op path) or against a real `Bun.serve` fixture (live
 * path), then asserts the resulting store snapshot.
 *
 * The store carries module-level state so we reset it between tests, and the
 * platform base-URL override is scoped via `withPlatformBaseUrlForTesting` so a
 * fixture that throws can never leak the override into the next test.
 */

type Server = { origin: string; stop: () => void };

function startFixture(
  fetch: (request: Request) => Response | Promise<Response>,
): Server {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch });
  return {
    origin: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

const initialState = useIssuesStore.getState();

beforeEach(() => {
  // Reset the store so each test starts from the seeded backlog with no
  // selection and the idle hydration status.
  useIssuesStore.setState({
    ...initialState,
    issues: SEEDED_ISSUES,
    selectedId: null,
    filter: "open",
    creating: false,
    draftTitle: "",
    draftBody: "",
    hydrationStatus: "idle",
    hydrationError: null,
    hydrationSource: "seed",
  });
});

afterEach(() => {
  // Belt-and-suspenders: even though `withPlatformBaseUrlForTesting` already
  // cleans up, an exception path before the `await` would leave the override
  // set. Clear after every test, no matter what.
  clearPlatformBaseUrlForTesting();
});

const PLATFORM_ISSUE = {
  id: 901,
  number: 12,
  title: "Live from Plue",
  body: "Pulled over the typed client.",
  state: "open",
  html_url: "https://jjhub.example/acme/widgets/issues/12",
  labels: [{ name: "live", color: "00ff66" }],
  assignees: [{ id: 5, username: "ada", avatar_url: "" }],
  user: { id: 5, username: "ada", avatar_url: "" },
  comments: 2,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-02T00:00:00Z",
  closed_at: null,
};

describe("hydrateFromPlatform", () => {
  test("with no base URL configured, marks ok+seed and leaves issues alone", async () => {
    // No platform URL set → the live path is dormant and the store keeps the
    // seeded backlog. This is the offline/dev default.
    const { hydrateFromPlatform } = useIssuesStore.getState();
    await hydrateFromPlatform("acme", "widgets");

    const state = useIssuesStore.getState();
    expect(state.issues).toBe(SEEDED_ISSUES);
    expect(state.hydrationStatus).toBe("ok");
    expect(state.hydrationSource).toBe("seed");
    expect(state.hydrationError).toBe(null);
  });

  test("on a successful response, replaces the seeded list with platform issues", async () => {
    const fixture = startFixture((request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/api/repos/acme/widgets/issues");
      // The store asks for both states with a generous limit; assert it so a
      // future drift in the store args is caught here.
      expect(url.searchParams.get("state")).toBe("all");
      expect(url.searchParams.get("limit")).toBe("30");
      return new Response(JSON.stringify([PLATFORM_ISSUE]), {
        headers: { "content-type": "application/json" },
      });
    });

    try {
      await withPlatformBaseUrlForTesting(fixture.origin, async () => {
        await useIssuesStore.getState().hydrateFromPlatform("acme", "widgets");
      });
    } finally {
      fixture.stop();
    }

    const state = useIssuesStore.getState();
    expect(state.hydrationStatus).toBe("ok");
    expect(state.hydrationSource).toBe("platform");
    expect(state.hydrationError).toBe(null);
    expect(state.issues).toHaveLength(1);
    expect(state.issues[0]?.number).toBe(12);
    expect(state.issues[0]?.title).toBe("Live from Plue");
    expect(state.issues[0]?.labels).toEqual(["live"]);
    expect(state.issues[0]?.assignees).toEqual(["ada"]);
    expect(state.issues[0]?.commentCount).toBe(2);
    // Selection is reset so a stale id from the seeded list can't survive.
    expect(state.selectedId).toBe(null);
  });

  test("a PlatformError leaves the existing issues in place and surfaces the message", async () => {
    const fixture = startFixture(
      () =>
        new Response(
          JSON.stringify({ error: { code: "forbidden", message: "denied" } }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    );

    try {
      await withPlatformBaseUrlForTesting(fixture.origin, async () => {
        await useIssuesStore.getState().hydrateFromPlatform("acme", "widgets");
      });
    } finally {
      fixture.stop();
    }

    const state = useIssuesStore.getState();
    expect(state.hydrationStatus).toBe("error");
    expect(state.hydrationError).toBe("denied");
    // The seeded list is preserved on error — a 403 must not blank the UI.
    expect(state.issues).toBe(SEEDED_ISSUES);
    expect(state.hydrationSource).toBe("seed");
  });

  test("selectRepoContext sets the context and triggers hydration", async () => {
    const fixture = startFixture(
      () =>
        new Response(JSON.stringify([PLATFORM_ISSUE]), {
          headers: { "content-type": "application/json" },
        }),
    );

    try {
      await withPlatformBaseUrlForTesting(fixture.origin, async () => {
        await useIssuesStore.getState().selectRepoContext("acme", "widgets");
      });
    } finally {
      fixture.stop();
    }

    const state = useIssuesStore.getState();
    expect(state.repoContext).toEqual({ owner: "acme", repo: "widgets" });
    expect(state.hydrationSource).toBe("platform");
    expect(state.issues[0]?.title).toBe("Live from Plue");
  });

  test("when the AbortSignal aborts after the fetch, store state is left untouched", async () => {
    // Drive an abort *after* the response has come back but before the store
    // is mutated. The store must observe `signal.aborted` and short-circuit
    // both the success and the error paths.
    let resolveResponse: (() => void) | null = null;
    const fixture = startFixture(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = () =>
            resolve(
              new Response(JSON.stringify([PLATFORM_ISSUE]), {
                headers: { "content-type": "application/json" },
              }),
            );
        }),
    );

    try {
      const controller = new AbortController();
      await withPlatformBaseUrlForTesting(fixture.origin, async () => {
        const promise = useIssuesStore
          .getState()
          .hydrateFromPlatform("acme", "widgets", controller.signal);
        // Loading status is set synchronously before the await.
        expect(useIssuesStore.getState().hydrationStatus).toBe("loading");
        // Abort, then release the fixture so the store sees signal.aborted.
        controller.abort();
        resolveResponse?.();
        await promise;
      });
    } finally {
      fixture.stop();
    }

    const state = useIssuesStore.getState();
    // The store left `loading` set (no mutation after abort) and didn't swap
    // the seeded issues in nor record an error.
    expect(state.hydrationStatus).toBe("loading");
    expect(state.hydrationError).toBe(null);
    expect(state.issues).toBe(SEEDED_ISSUES);
  });
});
