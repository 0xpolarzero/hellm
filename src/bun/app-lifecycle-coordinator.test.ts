import { describe, expect, it } from "bun:test";
import { RuntimeContractError } from "@svvy/core";
import { AppLifecycleCoordinator } from "./app-lifecycle-coordinator";

describe("AppLifecycleCoordinator", () => {
  it("exposes no accepting surface during startup failure", () => {
    const coordinator = new AppLifecycleCoordinator();
    const startupError = new Error("startup failed");

    coordinator.markStartupFailed(startupError);

    expect(() => coordinator.assertAccepting("rpc.call")).toThrow(RuntimeContractError);
    try {
      coordinator.assertAccepting("rpc.call");
    } catch (error) {
      expect(error).toMatchObject({
        operation: "rpc.call",
        reason: "startup-failed",
        cause: startupError,
      });
    }
  });

  it("runs shutdown once and rejects new calls with typed shutdown errors", async () => {
    const coordinator = new AppLifecycleCoordinator();
    const calls: string[] = [];
    coordinator.markReady();

    const first = coordinator.shutdown(
      "app-shutdown",
      async () => {
        calls.push("close-scopes");
      },
      async () => {
        calls.push("prepare");
      },
      async () => {
        calls.push("dispose");
      },
    );
    const second = coordinator.shutdown(
      "app-shutdown",
      async () => {
        calls.push("close-scopes-again");
      },
      async () => {
        calls.push("prepare-again");
      },
      async () => {
        calls.push("dispose-again");
      },
    );

    expect(() => coordinator.assertAccepting("rpc.call")).toThrow(RuntimeContractError);
    await expect(first).resolves.toEqual({ state: "closed", reason: "app-shutdown" });
    await expect(second).resolves.toEqual({ state: "closed", reason: "app-shutdown" });
    expect(calls).toEqual(["close-scopes", "prepare", "dispose"]);
  });
});
