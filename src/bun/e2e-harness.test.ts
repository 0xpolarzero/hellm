import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertGracefulAppQuitObserved,
  assertLinuxCefRendererIsLoaded,
  assertNoElectrobunRendererProfileFailure,
  assertNoElectrobunRuntimePortCollision,
  assertPiNativeClipboardAddonIsAbsent,
  listAppProcessTree,
  requestGracefulAppQuit,
  restorePreparedHomeDir,
  runWithSvvyApp,
  snapshotPreparedHomeDir,
  waitForAppReady,
  type SvvyApp,
} from "../../e2e/harness";

function fakeApp(close: () => Promise<void>, stdout: string[] = []): SvvyApp {
  return { close, stdout } as unknown as SvvyApp;
}

describe("e2e harness lifecycle", () => {
  test("replays only durable prepared-home state and rebuilds disposable runtime roots", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "svvy-prepared-home-"));
    try {
      await Promise.all(
        [".config/svvy", ".local/share/svvy", ".state/svvy", ".cache/cef", ".tmp"].map((path) =>
          mkdir(join(homeDir, path), { recursive: true }),
        ),
      );
      await Promise.all([
        writeFile(join(homeDir, ".config/svvy/settings.json"), "prepared-config"),
        writeFile(join(homeDir, ".local/share/svvy/data.json"), "prepared-data"),
        writeFile(join(homeDir, ".state/svvy/state.json"), "prepared-state"),
        writeFile(join(homeDir, ".cache/cef/ephemeral"), "discard-me"),
        writeFile(join(homeDir, ".tmp/ephemeral"), "discard-me"),
        symlink(join(homeDir, ".config/svvy/settings.json"), join(homeDir, ".config/svvy/link")),
      ]);

      await snapshotPreparedHomeDir(homeDir);
      await Promise.all([
        writeFile(join(homeDir, ".config/svvy/settings.json"), "mutated-config"),
        writeFile(join(homeDir, ".cache/cef/after-launch"), "discard-me"),
        writeFile(join(homeDir, ".tmp/after-launch"), "discard-me"),
      ]);
      await restorePreparedHomeDir(homeDir);

      expect(await readFile(join(homeDir, ".config/svvy/settings.json"), "utf8")).toBe(
        "prepared-config",
      );
      expect(await readFile(join(homeDir, ".local/share/svvy/data.json"), "utf8")).toBe(
        "prepared-data",
      );
      expect(await readFile(join(homeDir, ".state/svvy/state.json"), "utf8")).toBe(
        "prepared-state",
      );
      expect(await readdir(join(homeDir, ".cache"))).toEqual([]);
      expect(await readdir(join(homeDir, ".tmp"))).toEqual([]);
      expect(await readdir(join(homeDir, ".config/svvy"))).toEqual(["settings.json"]);
    } finally {
      await rm(homeDir, { force: true, recursive: true });
    }
  });

  test("tracks the full isolated launch tree including siblings off known ancestors", async () => {
    if (process.platform !== "linux") return;

    const procFiles = new Map([
      ["/proc/42/status", "PPid:\t41\n"],
      ["/proc/41/status", "PPid:\t40\n"],
      ["/proc/40/status", "PPid:\t10\n"],
      ["/proc/40/task/40/children", "41 50\n"],
      ["/proc/41/task/41/children", "42\n"],
      ["/proc/42/task/42/children", "43 44\n"],
      ["/proc/43/task/43/children", ""],
      ["/proc/44/task/44/children", ""],
      ["/proc/50/task/50/children", "51\n"],
      ["/proc/51/task/51/children", ""],
    ]);

    expect(
      await listAppProcessTree(42, {
        readProcFile: async (path) => procFiles.get(path) ?? "",
        testProcessPid: 10,
      }),
    ).toEqual([40, 41, 42, 43, 44, 50, 51]);
  });

  test("requests trusted app quit before waiting for the process exit postcondition", async () => {
    const calls: string[] = [];
    const alive = new Set([40, 42, 43]);
    const evidence = await requestGracefulAppQuit(
      {
        doctor: async () => {
          calls.push("doctor");
          return { app: { pid: 42 } } as never;
        },
        requestQuit: async () => {
          calls.push("request-quit");
          return {
            requestId: "quit-1",
            requested: true,
            requestedAt: "2026-07-13T00:00:00.000Z",
          };
        },
      },
      {
        isProcessAlive: (pid) => alive.has(pid),
        listTrackedPids: async () => [40, 42, 43],
        now: () => 0,
        timeoutMs: 100,
        wait: async (milliseconds) => {
          calls.push(`wait:${milliseconds}`);
          alive.clear();
        },
      },
    );

    expect(calls).toEqual(["doctor", "request-quit", "wait:50"]);
    expect(evidence).toEqual({
      exitPostcondition: "observed",
      pid: 42,
      remainingPids: [],
      request: {
        requestId: "quit-1",
        requested: true,
        requestedAt: "2026-07-13T00:00:00.000Z",
      },
      trackedPids: [40, 42, 43],
    });
  });

  test("still requests trusted app quit when PID discovery is unavailable", async () => {
    let quitRequests = 0;
    const evidence = await requestGracefulAppQuit({
      doctor: async () => {
        throw new Error("doctor unavailable");
      },
      requestQuit: async () => {
        quitRequests += 1;
        return {
          requestId: "quit-2",
          requested: true,
          requestedAt: "2026-07-13T00:00:01.000Z",
        };
      },
    });

    expect(quitRequests).toBe(1);
    expect(evidence).toMatchObject({
      exitPostcondition: "unavailable",
      pid: null,
      remainingPids: [],
      request: { requestId: "quit-2", requested: true },
      trackedPids: [],
    });
  });

  test("retains an explicit failed graceful-request receipt for launcher fallback", async () => {
    const evidence = await requestGracefulAppQuit(
      {
        doctor: async () => ({ app: { pid: 43 } }) as never,
        requestQuit: async () => {
          throw new Error("quit bridge unavailable");
        },
      },
      {
        isProcessAlive: () => true,
        listTrackedPids: async () => [43, 44],
      },
    );

    expect(evidence).toEqual({
      exitPostcondition: "deadline-exceeded",
      pid: 43,
      remainingPids: [43, 44],
      request: { error: "quit bridge unavailable", requested: false },
      trackedPids: [43, 44],
    });
    expect(() => assertGracefulAppQuitObserved(evidence)).toThrow(
      "did not complete app-owned graceful shutdown",
    );
  });

  test("accepts only an observed app-owned graceful shutdown receipt", () => {
    expect(() =>
      assertGracefulAppQuitObserved({
        exitPostcondition: "observed",
        pid: 42,
        remainingPids: [],
        request: {
          requestId: "quit-observed",
          requested: true,
          requestedAt: "2026-07-13T00:00:00.000Z",
        },
        trackedPids: [40, 42, 43],
      }),
    ).not.toThrow();
  });

  test("uses the buffered app.ready event as the single startup barrier", async () => {
    const calls: string[] = [];
    await waitForAppReady({
      eventsWait: async (eventName, options) => {
        calls.push(`event:${eventName}:${options?.timeout}`);
        return {
          matched: true,
          event: {
            eventId: "event-ready",
            eventName: "app.ready",
            timestamp: "2026-07-13T00:00:00.000Z",
          },
          timeoutMs: options?.timeout ?? 0,
          criteria: { eventName },
        };
      },
      stateGet: async (namespace) => {
        calls.push(`state:${namespace}`);
        return {
          namespace: "workspace",
          value: { activeWorkspaceId: "workspace-ready" },
          updatedAt: "2026-07-13T00:00:00.000Z",
        };
      },
    });

    expect(calls).toEqual(["event:app.ready:40000", "state:workspace"]);
  });

  test("fails once when app.ready is unavailable instead of polling DOM", async () => {
    let stateReads = 0;
    await expect(
      waitForAppReady({
        eventsWait: async (eventName, options) => ({
          matched: false,
          event: null,
          timeoutMs: options?.timeout ?? 0,
          criteria: { eventName },
        }),
        stateGet: async () => {
          stateReads += 1;
          throw new Error("state should not be read");
        },
      }),
    ).rejects.toThrow("Timed out waiting for the authoritative svvy app.ready event.");
    expect(stateReads).toBe(0);
  });

  test("returns the callback result and closes exactly once", async () => {
    let closeCount = 0;
    const app = fakeApp(async () => {
      closeCount += 1;
    });

    await expect(
      runWithSvvyApp(
        app,
        async () => "result",
        async () => {
          throw new Error("diagnostics must not run for success");
        },
      ),
    ).resolves.toBe("result");
    expect(closeCount).toBe(1);
  });

  test("captures before close and rethrows the exact original value", async () => {
    const events: string[] = [];
    const original = new Error("original failure");
    const app = fakeApp(async () => {
      events.push("close");
    });

    let caught: unknown;
    try {
      await runWithSvvyApp(
        app,
        async () => {
          events.push("callback");
          throw original;
        },
        async (_capturedApp, capturedError) => {
          expect(_capturedApp).toBe(app);
          expect(capturedError).toBe(original);
          events.push("diagnostics");
          return "/evidence/failure";
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(original);
    expect(events).toEqual(["callback", "diagnostics", "close"]);
  });

  test("diagnostic and cleanup failures cannot replace the original test failure", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined);
    const original = new Error("original failure");
    const app = fakeApp(async () => {
      throw new Error("cleanup failure");
    });

    let caught: unknown;
    try {
      await runWithSvvyApp(
        app,
        async () => {
          throw original;
        },
        async () => {
          throw new Error("diagnostics failure");
        },
      );
    } catch (error) {
      caught = error;
    } finally {
      consoleError.mockRestore();
    }

    expect(caught).toBe(original);
  });

  test("rejects a second Electrobun runtime from launcher stdout", async () => {
    expect(() =>
      assertNoElectrobunRuntimePortCollision(
        fakeApp(
          async () => undefined,
          ["Server started at http://localhost:50000", "Port 50000 in use, trying next port..."],
        ),
      ),
    ).toThrow("initialized more than one Electrobun runtime");
  });

  test("rejects a failed persistent CEF profile from launcher stdout", () => {
    expect(() =>
      assertNoElectrobunRendererProfileFailure(
        fakeApp(
          async () => undefined,
          [
            "[CEF] Using path: /home/test/.cache/dev.polarzero.svvy/dev/CEF",
            "Cannot create profile at path /home/test/.cache/dev.polarzero.svvy/dev/CEF/partitions/default",
          ],
        ),
      ),
    ).toThrow("could not initialize its persistent renderer profile");
  });

  test("rejects an eagerly loaded optional pi native clipboard addon", () => {
    expect(() =>
      assertPiNativeClipboardAddonIsAbsent(
        "7f000000-7f001000 r-xp 00000000 00:00 0 /app/node_modules/@mariozechner/clipboard-linux-arm64-gnu/clipboard.node",
      ),
    ).toThrow("eagerly loaded its optional native clipboard addon");
    expect(() =>
      assertPiNativeClipboardAddonIsAbsent(
        "7f000000-7f001000 r-xp 00000000 00:00 0 /app/node_modules/electrobun/libNativeWrapper.so",
      ),
    ).not.toThrow();
  });

  test("requires the validated packaged CEF renderer on Linux", () => {
    expect(() =>
      assertLinuxCefRendererIsLoaded(
        "7f000000-7f001000 r-xp 00000000 00:00 0 /app/svvy-dev/bin/cef/libcef.so",
      ),
    ).not.toThrow();
    expect(() =>
      assertLinuxCefRendererIsLoaded(
        "7f000000-7f001000 r-xp 00000000 00:00 0 /usr/lib/libwebkit2gtk-4.1.so",
      ),
    ).toThrow("must not fall back to WebKitGTK");
  });

  test("captures a runtime collision before closing an otherwise successful test app", async () => {
    const events: string[] = [];
    const app = fakeApp(async () => {
      events.push("close");
    }, ["Port 50000 in use, trying next port..."]);

    await expect(
      runWithSvvyApp(
        app,
        async () => {
          events.push("callback");
        },
        async (_app, error) => {
          expect(error).toBeInstanceOf(Error);
          events.push("diagnostics");
          return "/evidence/runtime-collision";
        },
      ),
    ).rejects.toThrow("initialized more than one Electrobun runtime");
    expect(events).toEqual(["callback", "diagnostics", "close"]);
  });
});
