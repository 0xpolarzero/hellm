import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import electrobunE2EConfig from "../../electrobun-e2e.config";

const harnessSource = readFileSync(join(import.meta.dir, "..", "..", "e2e", "harness.ts"), "utf8");

describe("e2e harness launch isolation", () => {
  test("keeps e2e sources inside the normal root typecheck", async () => {
    const tsconfig = await Bun.file(`${import.meta.dir}/../../tsconfig.json`).json();

    expect(tsconfig.include).toContain("e2e/**/*.ts");
  });

  test("rebuilds the OrbStack app when extracted package sources change", async () => {
    const configSource = await Bun.file(`${import.meta.dir}/../../electrobun-e2e.config.ts`).text();

    expect(configSource).toContain('"packages"');
    expect(configSource).toContain('"patches"');
    expect(configSource).toContain('"bun.lock"');
  });

  test("retains pre-bridge state and enables native backtraces without launch retries", async () => {
    const configSource = await Bun.file(`${import.meta.dir}/../../electrobun-e2e.config.ts`).text();
    const runnerSource = await Bun.file(`${import.meta.dir}/../../scripts/run-e2e-tests.sh`).text();
    const buildSource = await Bun.file(`${import.meta.dir}/../../scripts/build-e2e-app.ts`).text();
    const launcherSource = await Bun.file(
      `${import.meta.dir}/../../scripts/launch-e2e-app.sh`,
    ).text();

    expect(electrobunE2EConfig.extraAptPackages).toEqual(
      expect.arrayContaining(["file", "gdb", "libnspr4", "libnss3", "scrot", "xdotool"]),
    );
    expect(configSource).toContain('machineArch: "arm64"');
    expect(configSource).toContain('testCommand: ["bash", "scripts/run-e2e-tests.sh"]');
    expect(configSource).toContain('ELECTROBUN_E2E_LAUNCH_RETRIES: "0"');
    expect(runnerSource).toContain("ulimit -c unlimited");
    expect(runnerSource).toContain("native-cores");
    expect(runnerSource).toContain("thread apply all bt full");
    expect(runnerSource).toContain("info proc exe");
    expect(runnerSource).toContain("Resolved exact core executable from command");
    expect(runnerSource.indexOf('"$bin_dir/bun"')).toBeLessThan(
      runnerSource.indexOf('"$bin_dir/bun Helper"'),
    );
    expect(runnerSource).toContain("info registers");
    expect(runnerSource).toContain("x/16i $pc-32");
    expect(runnerSource).toContain("core file may not match specified executable file");
    expect(runnerSource).toContain("native crash core(s); failing the e2e run");
    expect(runnerSource.indexOf("mapfile -t core_paths")).toBeLessThan(
      runnerSource.indexOf('if [[ "${#core_paths[@]}" -gt 0 ]]'),
    );
    expect(runnerSource).toContain('if [[ "$backtrace_valid" -eq 1 ]]');
    expect(runnerSource).not.toContain("retry");
    expect(runnerSource).toContain("run_test_file");
    expect(launcherSource).toContain("dbus-run-session");
    expect(launcherSource).toContain("xvfb-run -a");
    expect(launcherSource).toContain("SVVY_E2E_NATIVE_SESSION_METADATA");
    expect(launcherSource).toContain("setpriv --pdeathsig TERM");
    expect(runnerSource).toContain("trap cleanup_active_launches EXIT");
    expect(runnerSource).toContain("trap 'exit 130' HUP INT TERM");
    expect(runnerSource).toContain("collect_launch_tree");
    expect(runnerSource).toContain('if [[ "$evidence_root" != /* ]]');
    expect(runnerSource).toContain('evidence_root="$PWD/$evidence_root"');
    expect(runnerSource).toContain('export SVVY_E2E_EVIDENCE_DIR="$evidence_root"');
    expect(buildSource).toContain('NODE_ENV: "production"');
    expect(harnessSource).toContain('"scripts", "launch-e2e-app.sh"');
    expect(harnessSource).toContain("await assertPiNativeClipboardAddonIsLazy(readyApp.driver)");
    expect(harnessSource).toContain("assertNoElectrobunRendererProfileFailure(readyApp)");
    expect(harnessSource).toContain("assertLinuxCefRendererIsLoaded(processMaps)");
    expect(harnessSource).toContain('join(executableDir, "cef", "libcef.so")');
    expect(harnessSource).toContain("`/proc/${doctor.app.pid}/maps`");
  });

  test("keeps prepared-home state across launcher metadata attempts", () => {
    const launchStart = harnessSource.indexOf("export async function launchSvvyApp");
    const launchEnd = harnessSource.indexOf("function adoptReadyDriver", launchStart);
    const launchSource = harnessSource.slice(launchStart, launchEnd);
    const optionsCreation = launchSource.indexOf("const launchOptions = createLaunchOptions");
    const launchAttempt = launchSource.indexOf("const app = await launchElectrobunApp");

    expect(launchStart).toBeGreaterThanOrEqual(0);
    expect(launchEnd).toBeGreaterThan(launchStart);
    expect(optionsCreation).toBeGreaterThanOrEqual(0);
    expect(launchAttempt).toBeGreaterThan(optionsCreation);
    expect(launchSource).toContain("launchElectrobunApp(launchOptions)");
    expect(launchSource).not.toContain("withLocalLaunchRetries");
    expect(harnessSource).toContain("const preparedHomeDirs = new Set<string>();");
    expect(harnessSource).toContain("await restorePreparedHomeDir(context.homeDir);");
    expect(harnessSource).toContain('new Set([".config", ".local", ".state"])');
    expect(harnessSource).toContain('[".cache", ".tmp"]');
    expect(harnessSource).toContain("candidate.isDirectory() || candidate.isFile()");
  });

  test("requests app-owned graceful quit before launcher fallback cleanup", () => {
    const adoptionStart = harnessSource.indexOf("function adoptReadyDriver");
    const adoptionEnd = harnessSource.indexOf("function getPreparedHomeSnapshotDir", adoptionStart);
    const closeSource = harnessSource.slice(adoptionStart, adoptionEnd);

    expect(closeSource.indexOf("requestGracefulAppQuit(driver)")).toBeGreaterThanOrEqual(0);
    expect(closeSource.indexOf("requestGracefulAppQuit(driver)")).toBeLessThan(
      closeSource.indexOf("closeLaunchedApp()"),
    );
    expect(closeSource.indexOf("closeLaunchedApp()")).toBeLessThan(
      closeSource.indexOf("assertGracefulAppQuitObserved(gracefulQuit)"),
    );
    expect(closeSource).not.toContain("await driver.close().catch");
    expect(closeSource).toContain('? "deadline-exceeded" : "observed"');
    expect(closeSource).toContain('exitPostcondition: "deadline-exceeded"');
  });
});
