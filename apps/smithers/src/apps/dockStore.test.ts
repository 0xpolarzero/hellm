import { registerHappyDomForTests } from "../test/registerHappyDom";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

// The dock store persists to localStorage; give it a DOM so persistence is a
// real path under test rather than a no-op.
beforeAll(() => {
  registerHappyDomForTests();
});

describe("dock store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("registerActive adds an app and is idempotent", async () => {
    const { useDockStore } = await import("./dockStore");
    useDockStore.setState({ openAppIds: [] });

    useDockStore.getState().registerActive("git");
    useDockStore.getState().registerActive("git");
    expect(useDockStore.getState().openAppIds).toEqual(["git"]);

    useDockStore.getState().registerActive("issues");
    expect(useDockStore.getState().openAppIds).toEqual(["git", "issues"]);
  });

  test("closeApp removes one app and leaves the rest in order", async () => {
    const { useDockStore } = await import("./dockStore");
    useDockStore.setState({ openAppIds: ["git", "issues", "runs"] });

    useDockStore.getState().closeApp("issues");
    expect(useDockStore.getState().openAppIds).toEqual(["git", "runs"]);
  });

  test("open apps persist to localStorage", async () => {
    const { useDockStore } = await import("./dockStore");
    useDockStore.setState({ openAppIds: [] });
    useDockStore.getState().registerActive("memory");

    const raw = window.localStorage.getItem("smithers.dock");
    expect(raw).toContain("memory");
  });
});
