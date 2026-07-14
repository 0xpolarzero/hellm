import { describe, expect, test } from "bun:test";
import {
  detectCuaDriver,
  INSPECT_APP_STARTUP_TIMEOUT_MS,
  isStartupFailureLine,
  parseBridgeMetadataLine,
  parseInspectAppArgs,
  probeCuaDriver,
  renderBrowserToolsGuidance,
  renderInspectAppHelp,
  resolveInspectionProcessEnv,
  terminateInspectionProcessTree,
} from "../../scripts/inspect-app";

describe("inspect app script", () => {
  test("bounds bridge startup so a broken dev lane cannot hang forever", () => {
    expect(INSPECT_APP_STARTUP_TIMEOUT_MS).toBe(120_000);
  });

  test("bounds graceful and forced process-tree shutdown even if exit never settles", async () => {
    const signals: NodeJS.Signals[] = [];
    const neverExits = new Promise<number>(() => {});

    await terminateInspectionProcessTree(
      {
        pid: 42,
        exited: neverExits,
        kill() {},
      },
      0,
      0,
      (_child, signal) => signals.push(signal),
    );

    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("does not force a process tree that settles after the graceful request", async () => {
    const signals: NodeJS.Signals[] = [];
    let settleExit!: (code: number) => void;
    const exited = new Promise<number>((resolve) => {
      settleExit = resolve;
    });

    await terminateInspectionProcessTree(
      {
        pid: 42,
        exited,
        kill() {},
      },
      100,
      0,
      (_child, signal) => {
        signals.push(signal);
        settleExit(0);
      },
    );

    expect(signals).toEqual(["SIGTERM"]);
  });

  test("defaults the startup workspace to cwd and creates no explicit HOME option", () => {
    expect(parseInspectAppArgs([], "/workspace/project")).toEqual({
      workspace: "/workspace/project",
      home: null,
      keepHome: false,
      stubProvider: false,
      help: false,
    });
  });

  test("isolates app state without hiding the host Rust toolchain", () => {
    expect(
      resolveInspectionProcessEnv("/tmp/isolated-home", {
        HOME: "/Users/operator",
        PATH: "/tools/bin",
      }),
    ).toEqual({
      HOME: "/tmp/isolated-home",
      PATH: "/tools/bin",
      CARGO_HOME: "/Users/operator/.cargo",
      RUSTUP_HOME: "/Users/operator/.rustup",
    });
    expect(
      resolveInspectionProcessEnv("/tmp/isolated-home", {
        HOME: "/Users/operator",
        CARGO_HOME: "/toolchains/cargo",
        RUSTUP_HOME: "/toolchains/rustup",
      }),
    ).toMatchObject({
      HOME: "/tmp/isolated-home",
      CARGO_HOME: "/toolchains/cargo",
      RUSTUP_HOME: "/toolchains/rustup",
    });
  });

  test("parses explicit workspace, HOME, retention, and help options", () => {
    expect(
      parseInspectAppArgs(
        [
          "--workspace",
          "../target",
          "--home=./saved-home",
          "--keep-home",
          "--stub-provider",
          "--help",
        ],
        "/workspace/project",
      ),
    ).toEqual({
      workspace: "/workspace/target",
      home: "/workspace/project/saved-home",
      keepHome: true,
      stubProvider: true,
      help: true,
    });
  });

  test("rejects unknown, missing, empty, and duplicate options", () => {
    expect(() => parseInspectAppArgs(["--wat"])).toThrow("Unknown argument: --wat");
    expect(() => parseInspectAppArgs(["--workspace"])).toThrow("--workspace requires a path");
    expect(() => parseInspectAppArgs(["--home="])).toThrow("--home requires a non-empty path");
    expect(() => parseInspectAppArgs(["--home", "one", "--home", "two"])).toThrow(
      "--home may only be provided once",
    );
  });

  test("parses the bridge metadata line even when dev output prefixes it", () => {
    expect(parseBridgeMetadataLine("ordinary dev output")).toBeNull();
    expect(
      parseBridgeMetadataLine(
        'app | svvy bridge: {"appId":"svvy-dev-42","bridgeUrl":"http://127.0.0.1:59042"}',
      ),
    ).toEqual({
      appId: "svvy-dev-42",
      bridgeUrl: "http://127.0.0.1:59042",
    });
    expect(parseBridgeMetadataLine('svvy bridge: {"appId":"svvy","bridgeUrl":null}')).toEqual({
      appId: "svvy",
      bridgeUrl: null,
    });
  });

  test("recognizes an authoritative pre-bridge startup failure without waiting for timeout", () => {
    expect(isStartupFailureLine("svvy desktop startup failed RuntimeStartupError: broken")).toBe(
      true,
    );
    expect(isStartupFailureLine("svvy desktop app started")).toBe(false);
  });

  test("fails clearly for malformed bridge metadata", () => {
    expect(() => parseBridgeMetadataLine("svvy bridge: nope")).toThrow("not valid JSON");
    expect(() => parseBridgeMetadataLine('svvy bridge: {"bridgeUrl":null}')).toThrow(
      "non-empty appId",
    );
    expect(() => parseBridgeMetadataLine('svvy bridge: {"appId":"svvy"}')).toThrow(
      "requires bridgeUrl",
    );
    expect(() => parseBridgeMetadataLine('svvy bridge: {"appId":"svvy","bridgeUrl":""}')).toThrow(
      "non-empty string or null",
    );
  });

  test("renders runnable URL-targeted inspection and page-driving guidance", () => {
    const guidance = renderBrowserToolsGuidance(
      {
        appId: "svvy-dev",
        bridgeUrl: "http://127.0.0.1:59001",
      },
      null,
      { stubProvider: true },
    );

    expect(guidance).toContain(
      "bunx electrobun-browser-tools doctor --url 'http://127.0.0.1:59001' --json",
    );
    expect(guidance).toContain("electrobun-browser-tools status --url");
    expect(guidance).toContain("electrobun-browser-tools tree --url");
    expect(guidance).toContain("electrobun-browser-tools layout snapshot --url");
    expect(guidance).toContain("--summary --json");
    expect(guidance).toContain("electrobun-browser-tools state list --url");
    expect(guidance).toContain("electrobun-browser-tools state get surfaces --url");
    expect(guidance).toContain("electrobun-browser-tools state get sessions --url");
    expect(guidance).toContain("electrobun-browser-tools events summary --url");
    expect(guidance).toContain("electrobun-browser-tools logs summary --url");
    expect(guidance).toContain("electrobun-browser-tools logs tail --url");
    expect(guidance).toContain("electrobun-browser-tools errors list --url");
    expect(guidance).toContain("electrobun-browser-tools network summary --url");
    expect(guidance).toContain("electrobun-browser-tools perf summary --url");
    expect(guidance).toContain("electrobun-browser-tools page resolve role:button --url");
    expect(guidance).toContain("electrobun-browser-tools page snapshot --url");
    expect(guidance).toContain("electrobun-browser-tools page url --url");
    expect(guidance).toContain("Credential-free live prompt smoke:");
    expect(guidance).toContain("page click 'role:button:Create a new orchestrator'");
    expect(guidance).toContain("page fill role:textbox");
    expect(guidance).toContain("page click 'role:button:Send'");
    expect(guidance).toContain("page wait-for 'text:Live inspection response'");
    expect(guidance).toContain("page screenshot --url");
    expect(guidance).toContain("press Ctrl+C");
    expect(guidance).not.toContain("--app");
    expect(guidance).toContain("CuaDriver: unavailable in PATH");
  });

  test("detects and reports CuaDriver without installing or approximating it", () => {
    const probed: string[] = [];
    const executable = detectCuaDriver((candidate) => {
      probed.push(candidate);
      return candidate === "cua-driver" ? "/tools/cua-driver" : null;
    });

    expect(executable).toBe("/tools/cua-driver");
    expect(probed).toEqual(["cua-driver"]);
    expect(detectCuaDriver(() => null)).toBeNull();
  });

  test("reports CuaDriver as ready only after a real native-window probe", async () => {
    const ready = await probeCuaDriver(
      "/tools/cua-driver",
      async () => ({
        exitCode: 0,
        stdout: '{"windows":[{"pid":42}]}',
      }),
      { CODEX_SANDBOX: "seatbelt" },
    );
    expect(ready).toEqual({
      executable: "/tools/cua-driver",
      ready: true,
      sandboxRestricted: false,
      detail: "1 native window(s) visible",
    });
    expect(renderBrowserToolsGuidance({ appId: "svvy", bridgeUrl: null }, ready)).toContain(
      "CuaDriver: ready at /tools/cua-driver",
    );

    const unavailable = await probeCuaDriver(
      "/tools/cua-driver",
      async () => ({
        exitCode: 0,
        stdout: '{"windows":[]}',
      }),
      {},
    );
    expect(unavailable).toMatchObject({ ready: false });
    expect(renderBrowserToolsGuidance({ appId: "svvy", bridgeUrl: null }, unavailable)).toContain(
      "installed at /tools/cua-driver, but unavailable",
    );
  });

  test("hands a sandbox-restricted CuaDriver probe off to an explicit host command", async () => {
    const restricted = await probeCuaDriver(
      "/tools/cua-driver",
      async () => ({
        exitCode: 0,
        stdout: '{"current_space_id":0,"windows":[]}',
      }),
      { CODEX_SANDBOX: "seatbelt" },
    );

    expect(restricted).toEqual({
      executable: "/tools/cua-driver",
      ready: false,
      sandboxRestricted: true,
      detail: "host probe required; sandboxed window probe returned no native windows",
    });

    const guidance = renderBrowserToolsGuidance({ appId: "svvy", bridgeUrl: null }, restricted);
    expect(guidance).toContain("sandbox-restricted");
    expect(guidance).toContain("host probe required");
    expect(guidance).toContain(
      "CuaDriver host probe: authorize this read-only command outside the Codex sandbox: '/tools/cua-driver' call list_windows '{}' --compact",
    );
    expect(guidance).not.toContain("but unavailable");
    expect(guidance).not.toContain("cua-driver doctor");
    expect(guidance).not.toContain("cua-driver stop");
    expect(guidance).not.toContain("cua-driver config reset");
  });

  test("falls back to the registered app id and documents all launcher options", () => {
    const guidance = renderBrowserToolsGuidance({ appId: "svvy's dev", bridgeUrl: null });
    expect(guidance).toContain("--app 'svvy'\"'\"'s dev'");
    expect(guidance).not.toContain("--url");

    const help = renderInspectAppHelp();
    expect(help).toContain("--workspace <path>");
    expect(help).toContain("--home <path>");
    expect(help).toContain("--keep-home");
    expect(help).toContain("--stub-provider");
    expect(help).toContain("--help");
  });
});
