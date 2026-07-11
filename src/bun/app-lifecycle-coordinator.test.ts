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

  it("awaits terminal scope closure before preparation and bootstrap-owned disposal", async () => {
    const coordinator = new AppLifecycleCoordinator();
    const calls: string[] = [];
    const closeStarted = createDeferred<void>();
    const allowClose = createDeferred<void>();
    coordinator.markReady();

    const shutdown = coordinator.shutdown(
      "app-shutdown",
      async () => {
        calls.push("close-scopes:start");
        closeStarted.resolve();
        await allowClose.promise;
        calls.push("close-scopes:done");
      },
      async () => {
        calls.push("prepare");
      },
      async () => {
        calls.push("dispose");
      },
    );

    await closeStarted.promise;
    expect(calls).toEqual(["close-scopes:start"]);
    expect(() => coordinator.assertAccepting("rpc.during-shutdown")).toThrow(RuntimeContractError);
    try {
      coordinator.assertAccepting("rpc.during-shutdown");
    } catch (error) {
      expect(error).toMatchObject({
        operation: "rpc.during-shutdown",
        reason: "runtime-shutdown",
      });
    }

    allowClose.resolve();
    await expect(shutdown).resolves.toEqual({ state: "closed", reason: "app-shutdown" });
    expect(calls).toEqual(["close-scopes:start", "close-scopes:done", "prepare", "dispose"]);
  });

  it("keeps app-shutdown and runtime-restart terminal receipts distinct and idempotent", async () => {
    for (const reason of ["app-shutdown", "runtime-restart"] as const) {
      const coordinator = new AppLifecycleCoordinator();
      let scopeClosures = 0;
      coordinator.markReady();

      const shutdown = () =>
        coordinator.shutdown(
          reason,
          async () => {
            scopeClosures += 1;
          },
          async () => {},
          async () => {},
        );

      await expect(Promise.all([shutdown(), shutdown()])).resolves.toEqual([
        { state: "closed", reason },
        { state: "closed", reason },
      ]);
      expect(scopeClosures).toBe(1);
    }
  });

  it("still prepares and disposes when scope closure fails", async () => {
    const coordinator = new AppLifecycleCoordinator();
    const calls: string[] = [];
    const closeError = new Error("scope close failed");
    coordinator.markReady();

    const shutdown = coordinator.shutdown(
      "app-shutdown",
      async () => {
        calls.push("close-scopes");
        throw closeError;
      },
      async () => {
        calls.push("prepare");
      },
      async () => {
        calls.push("dispose");
      },
    );

    await expect(shutdown).rejects.toBe(closeError);
    expect(calls).toEqual(["close-scopes", "prepare", "dispose"]);
    expect(coordinator.getState()).toBe("closed");
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
