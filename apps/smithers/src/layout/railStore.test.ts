import { registerHappyDomForTests } from "../test/registerHappyDom";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

beforeAll(() => {
  registerHappyDomForTests();
});

type StubElement = {
  setPointerCapture: (id: number) => void;
  releasePointerCapture: (id: number) => void;
  hasPointerCapture: (id: number) => boolean;
  _captured: Set<number>;
};

function stubElement(): StubElement {
  const captured = new Set<number>();
  return {
    _captured: captured,
    setPointerCapture: (id) => {
      captured.add(id);
    },
    releasePointerCapture: (id) => {
      captured.delete(id);
    },
    hasPointerCapture: (id) => captured.has(id),
  };
}

function pointerEvent(target: StubElement, clientX: number, id = 1) {
  return {
    pointerId: id,
    clientX,
    currentTarget: target,
    preventDefault: () => {},
  } as unknown as React.PointerEvent<HTMLElement>;
}

async function freshStore() {
  const mod = await import("./railStore");
  mod.useRailStore.setState({
    width: 320,
    collapsed: false,
    resizing: false,
    lastOpenWidth: 320,
  });
  return mod.useRailStore;
}

describe("railStore — drag resize math", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("onResizeMove clamps to MIN when drag is below RAIL_MIN but above COLLAPSE_AT", async () => {
    const useStore = await freshStore();
    const el = stubElement();
    useStore.getState().onResizeStart(pointerEvent(el, 200));
    useStore.getState().onResizeMove(pointerEvent(el, 200));
    expect(useStore.getState().width).toBe(260);
    expect(useStore.getState().collapsed).toBe(false);
    expect(useStore.getState().lastOpenWidth).toBe(260);
  });

  test("onResizeMove clamps to MAX when drag exceeds RAIL_MAX", async () => {
    const useStore = await freshStore();
    const el = stubElement();
    useStore.getState().onResizeStart(pointerEvent(el, 900));
    useStore.getState().onResizeMove(pointerEvent(el, 900));
    expect(useStore.getState().width).toBe(560);
  });

  test("onResizeMove snaps collapsed=true below COLLAPSE_AT and does not change width", async () => {
    const useStore = await freshStore();
    const el = stubElement();
    useStore.getState().onResizeStart(pointerEvent(el, 100));
    useStore.getState().onResizeMove(pointerEvent(el, 100));
    expect(useStore.getState().collapsed).toBe(true);
    expect(useStore.getState().width).toBe(320);
  });

  test("onResizeMove ignored without a captured pointer (stray hover)", async () => {
    const useStore = await freshStore();
    const el = stubElement();
    useStore.getState().onResizeMove(pointerEvent(el, 400));
    expect(useStore.getState().width).toBe(320);
  });

  test("onResizeEnd releases the pointer and clears resizing", async () => {
    const useStore = await freshStore();
    const el = stubElement();
    useStore.getState().onResizeStart(pointerEvent(el, 400));
    expect(useStore.getState().resizing).toBe(true);
    expect(el._captured.has(1)).toBe(true);
    useStore.getState().onResizeEnd(pointerEvent(el, 400));
    expect(useStore.getState().resizing).toBe(false);
    expect(el._captured.has(1)).toBe(false);
  });

  test("expand sets collapsed=false", async () => {
    const useStore = await freshStore();
    useStore.setState({ collapsed: true });
    useStore.getState().expand();
    expect(useStore.getState().collapsed).toBe(false);
  });

  test("persisted state is width + collapsed only (no transient resizing flag)", async () => {
    const useStore = await freshStore();
    const el = stubElement();
    useStore.getState().onResizeStart(pointerEvent(el, 400));
    useStore.getState().onResizeMove(pointerEvent(el, 400));
    useStore.getState().onResizeEnd(pointerEvent(el, 400));

    const raw = window.localStorage.getItem("smithers.rail");
    expect(raw).not.toBe(null);
    const parsed = JSON.parse(raw as string);
    expect(parsed.state).toEqual({ width: 400, collapsed: false });
  });
});
