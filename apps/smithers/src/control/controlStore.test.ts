import { registerHappyDomForTests } from "../test/registerHappyDom";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

type AgentDirective = { tool: string; args?: Record<string, unknown>; reason?: string };

beforeAll(() => {
  registerHappyDomForTests();
});

async function freshStore() {
  const mod = await import("./controlStore");
  mod.useControlStore.setState({ controller: "user", pendingControl: null });
  return mod.useControlStore;
}

describe("controlStore — approval gate", () => {
  beforeEach(async () => {
    const useStore = await freshStore();
    useStore.setState({ controller: "user", pendingControl: null });
  });

  test("requestControl opens a pending gate while the user is in control", async () => {
    const useStore = await freshStore();
    useStore.getState().requestControl("Fix typo");
    const pending = useStore.getState().pendingControl;
    expect(pending?.reason).toBe("Fix typo");
    expect(pending?.actions).toEqual([]);
  });

  test("requestControl is a no-op once the agent already drives", async () => {
    const useStore = await freshStore();
    useStore.setState({ controller: "agent" });
    useStore.getState().requestControl("Anything");
    expect(useStore.getState().pendingControl).toBe(null);
  });

  test("processReply queues real actions plus reason while user holds control", async () => {
    const useStore = await freshStore();
    const directives: AgentDirective[] = [
      { tool: "requestControl", reason: "Switch theme" },
      { tool: "unknownButQueued", args: { value: 1 } },
    ];
    useStore.getState().processReply(directives);
    const pending = useStore.getState().pendingControl;
    expect(pending?.reason).toBe("Switch theme");
    expect(pending?.actions).toHaveLength(1);
    expect(pending?.actions[0]?.tool).toBe("unknownButQueued");
  });

  test("processReply ignores a reply with only control toggles and no actions", async () => {
    const useStore = await freshStore();
    useStore.getState().processReply([{ tool: "releaseControl" }]);
    expect(useStore.getState().pendingControl).toBe(null);
    expect(useStore.getState().controller).toBe("user");
  });

  test("grantControl flips controller to agent and clears the gate", async () => {
    const useStore = await freshStore();
    useStore.setState({
      pendingControl: { reason: "do it", actions: [{ tool: "noop" }] },
    });
    useStore.getState().grantControl();
    expect(useStore.getState().controller).toBe("agent");
    expect(useStore.getState().pendingControl).toBe(null);
  });

  test("denyControl clears the gate but leaves the user in control", async () => {
    const useStore = await freshStore();
    useStore.setState({ pendingControl: { reason: "do it", actions: [] } });
    useStore.getState().denyControl();
    expect(useStore.getState().pendingControl).toBe(null);
    expect(useStore.getState().controller).toBe("user");
  });

  test("releaseControl hands the wheel back and discards any gate", async () => {
    const useStore = await freshStore();
    useStore.setState({
      controller: "agent",
      pendingControl: { reason: "x", actions: [] },
    });
    useStore.getState().releaseControl();
    expect(useStore.getState().controller).toBe("user");
    expect(useStore.getState().pendingControl).toBe(null);
  });

  test("processReply honors a self-release directive while the agent drives", async () => {
    const useStore = await freshStore();
    useStore.setState({ controller: "agent" });
    useStore.getState().processReply([
      { tool: "noopAction" },
      { tool: "releaseControl" },
      { tool: "wouldBeSkipped" },
    ]);
    expect(useStore.getState().controller).toBe("user");
  });

  test("processReply with empty directives does nothing", async () => {
    const useStore = await freshStore();
    useStore.getState().processReply([]);
    expect(useStore.getState().pendingControl).toBe(null);
  });

  test("controller transitions mirror onto document.documentElement.dataset", async () => {
    const useStore = await freshStore();
    expect(document.documentElement.dataset.controller).toBe("user");
    useStore.setState({ controller: "agent" });
    expect(document.documentElement.dataset.controller).toBe("agent");
    useStore.setState({ controller: "user" });
    expect(document.documentElement.dataset.controller).toBe("user");
  });
});
