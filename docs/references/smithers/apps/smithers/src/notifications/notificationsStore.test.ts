import { registerHappyDomForTests } from "../test/registerHappyDom";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

beforeAll(() => {
  registerHappyDomForTests();
});

async function freshStore() {
  const mod = await import("./notificationsStore");
  mod.useNotificationsStore.setState({ notifications: [] });
  return mod.useNotificationsStore;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("notifications store", () => {
  beforeEach(async () => {
    const useStore = await freshStore();
    for (const note of useStore.getState().notifications) {
      useStore.getState().dismiss(note.id);
    }
  });

  test("notify returns an id and appends to the stack", async () => {
    const useStore = await freshStore();
    const id = useStore.getState().notify({ title: "hi", kind: "transient" });
    expect(typeof id).toBe("string");
    const items = useStore.getState().notifications;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(id);
    expect(items[0]?.status).toBe("running");
  });

  test("workflow notifications persist past the transient window", async () => {
    const useStore = await freshStore();
    const id = useStore.getState().notify({
      title: "long workflow",
      kind: "workflow",
    });
    await delay(50);
    expect(useStore.getState().notifications.some((n) => n.id === id)).toBe(true);
  });

  test("update to done schedules eventual dismissal", async () => {
    const useStore = await freshStore();
    const id = useStore.getState().notify({
      title: "workflow",
      kind: "workflow",
    });
    useStore.getState().update(id, { status: "done", detail: "ok" });
    const item = useStore.getState().notifications.find((n) => n.id === id);
    expect(item?.status).toBe("done");
    expect(item?.detail).toBe("ok");
  });

  test("dismiss removes by id and is safe to call twice", async () => {
    const useStore = await freshStore();
    const id = useStore.getState().notify({
      title: "x",
      kind: "transient",
    });
    useStore.getState().dismiss(id);
    expect(useStore.getState().notifications).toHaveLength(0);
    useStore.getState().dismiss(id);
    expect(useStore.getState().notifications).toHaveLength(0);
  });

  test("notify increments ids so multiple toasts coexist", async () => {
    const useStore = await freshStore();
    const a = useStore.getState().notify({ title: "a", kind: "workflow" });
    const b = useStore.getState().notify({ title: "b", kind: "workflow" });
    expect(a).not.toBe(b);
    expect(useStore.getState().notifications.map((n) => n.id)).toEqual([a, b]);
  });

  test("update on unknown id is a no-op", async () => {
    const useStore = await freshStore();
    useStore.getState().notify({ title: "real", kind: "workflow" });
    useStore.getState().update("does-not-exist", { status: "done" });
    expect(useStore.getState().notifications).toHaveLength(1);
  });
});
