import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildOrbStackSetupMarkerScript,
  buildOrbStackSetupProbeScript,
  buildEvidenceSyncScript,
  buildRemoteRunCleanupScript,
  createE2ESetupManifest,
  createE2ERunId,
  e2eRunnerSignalForAttempt,
  ORBSTACK_START_TIMEOUT_MS,
  orbStackIsRunning,
  orbStackUnavailableGuidance,
  parseRemoteRuntimeMetadata,
  resolveE2ERunSettings,
  runE2E,
} from "../../scripts/run-e2e";

describe("run-e2e operator wrapper", () => {
  test("creates filesystem-safe stable run ids", () => {
    expect(createE2ERunId(new Date("2026-07-13T10:11:12.345Z"))).toMatch(
      /^2026-07-13T10-11-12-345Z-\d+$/,
    );
  });

  test("escalates repeated operator cancellation without bypassing cleanup", () => {
    expect(e2eRunnerSignalForAttempt("SIGINT", 1)).toBe("SIGINT");
    expect(e2eRunnerSignalForAttempt("SIGINT", 2)).toBe("SIGTERM");
    expect(e2eRunnerSignalForAttempt("SIGINT", 3)).toBe("SIGKILL");
  });

  test("resolves explicit machine, workspace, and run identity", () => {
    expect(
      resolveE2ERunSettings(
        ["e2e/svvy-smoke.test.ts"],
        {
          ELECTROBUN_E2E_ORB_MACHINE: "custom-machine",
          ELECTROBUN_E2E_ORB_WORKSPACE: "$HOME/code/custom",
          SVVY_E2E_RUN_ID: "run-123",
        },
        "/Users/example/project",
      ),
    ).toEqual({
      forwardedArgs: ["e2e/svvy-smoke.test.ts"],
      hostProjectDir: "/Users/example/project",
      machineArch: "arm64",
      machineName: "custom-machine",
      remoteWorkspace: "$HOME/code/custom",
      runId: "run-123",
    });
  });

  test("builds a remote-to-host evidence sync without hard-coded user paths", () => {
    const script = buildEvidenceSyncScript({
      forwardedArgs: [],
      hostProjectDir: "/Users/example/My Project",
      machineArch: "arm64",
      machineName: "svvy-e2e",
      remoteWorkspace: "$HOME/code/svvy",
      runId: "run-123",
    });

    expect(script).toContain('source_dir="$workspace_dir/e2e-results"');
    expect(script).toContain("'/mnt/mac/Users/example/My Project/e2e-results'");
    expect(script).toContain("rsync -a");
    expect(script).not.toContain("polarzero");
  });

  test("builds exact run-scoped remote cleanup for interrupted native processes", () => {
    const script = buildRemoteRunCleanupScript({
      forwardedArgs: [],
      hostProjectDir: "/Users/example/project",
      machineArch: "arm64",
      machineName: "svvy-e2e",
      remoteWorkspace: "$HOME/code/svvy",
      runId: "run-123",
    });

    expect(script).toContain("SVVY_E2E_RUN_ID=run-123");
    expect(script).toContain("/proc/[0-9]*/environ");
    expect(script).toContain('kill -TERM "${matching_pids[@]}"');
    expect(script).toContain('kill -KILL "${matching_pids[@]}"');
    expect(script).toContain('rm -rf "$workspace_dir/e2e-results/run-123/active-launches"');
  });

  test("normalizes the setup manifest so config order does not trigger apt setup", () => {
    expect(
      createE2ESetupManifest({
        machineArch: "arm64",
        machineImage: "ubuntu:24.04",
        bunVersion: "1.3.14",
        extraAptPackages: ["xdotool", " scrot ", "xdotool", ""],
      }),
    ).toEqual({
      schemaVersion: 2,
      machineArch: "arm64",
      machineImage: "ubuntu:24.04",
      bunVersion: "1.3.14",
      extraAptPackages: ["scrot", "xdotool"],
    });
  });

  test("parses observed guest, runner, and packaged binary identities", () => {
    expect(
      parseRemoteRuntimeMetadata(
        [
          "guestArch\taarch64",
          "runnerBunRevision\t1.3.10+fixture",
          "runnerBunVersion\t1.3.10",
          "artifact:launcher\tELF 64-bit LSB pie executable, ARM aarch64",
          "artifact:libcef.so\tELF 64-bit LSB shared object, ARM aarch64",
        ].join("\n"),
      ),
    ).toEqual({
      guestArch: "aarch64",
      runnerBunRevision: "1.3.10+fixture",
      runnerBunVersion: "1.3.10",
      artifacts: {
        launcher: "ELF 64-bit LSB pie executable, ARM aarch64",
        "libcef.so": "ELF 64-bit LSB shared object, ARM aarch64",
      },
    });
  });

  test("probes the remote setup manifest and declared packages", () => {
    const manifest = createE2ESetupManifest({
      machineArch: "arm64",
      machineImage: "ubuntu:24.04",
      bunVersion: "1.3.14",
      extraAptPackages: ["xdotool", "scrot"],
    });
    const probe = buildOrbStackSetupProbeScript(manifest);
    expect(probe).toContain('export PATH="$HOME/.bun/bin:$PATH"');
    expect(probe).toContain("SVVY_E2E_SETUP_REQUIRED manifest-drift");
    expect(probe).toContain("SVVY_E2E_SETUP_REQUIRED architecture-drift");
    expect(probe).toContain("dpkg-query");
    expect(probe).toContain("xdotool");
    expect(probe).toContain("scrot");
    expect(probe).toContain("SVVY_E2E_SETUP_READY");
    expect(buildOrbStackSetupMarkerScript(manifest)).toContain("svvy-electrobun-e2e-setup-v2");
    expect(buildOrbStackSetupMarkerScript(manifest)).toContain('marker="$HOME/');
  });

  test("probes a rolling canary by revision instead of a misleading semver", () => {
    const probe = buildOrbStackSetupProbeScript(
      createE2ESetupManifest({
        machineArch: "arm64",
        machineImage: "ubuntu:24.04",
        bunVersion: "canary",
        extraAptPackages: [],
      }),
    );

    expect(probe).toContain("[[ 'canary' == \"canary\" ]]");
    expect(probe).toContain('"$(bun --revision)" != *-canary.*');
  });

  test("recognizes OrbStack readiness without mistaking stopped output for ready", () => {
    expect(ORBSTACK_START_TIMEOUT_MS).toBe(40_000);
    expect(orbStackIsRunning("Running")).toBe(true);
    expect(orbStackIsRunning("Status: running")).toBe(true);
    expect(orbStackIsRunning("Stopped")).toBe(false);
    expect(orbStackIsRunning("OrbStack is not running")).toBe(false);
  });

  test("explains the Codex sandbox boundary without exposing its marker value", () => {
    const guidance = orbStackUnavailableGuidance({ CODEX_SANDBOX: "private-marker-value" });

    expect(guidance).toContain("Codex's default sandbox");
    expect(guidance).toContain("OrbStack's Unix control socket");
    expect(guidance).toContain("sandbox escalation/full access");
    expect(guidance).toContain("`bun run test:e2e` command prefix");
    expect(guidance).not.toContain("private-marker-value");
    expect(orbStackUnavailableGuidance({})).toBe(
      "Start OrbStack, confirm `orb status` reports Running, then rerun `bun run test:e2e`.",
    );
  });

  test("records a preflight failure without starting the nested runner", async () => {
    const hostProjectDir = await mkdtemp(join(tmpdir(), "svvy-e2e-preflight-"));
    const runId = "missing-orb-preflight";

    try {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, "../../scripts/run-e2e.ts")],
        {
          cwd: hostProjectDir,
          env: {
            ...process.env,
            PATH: "",
            SVVY_E2E_RUN_ID: runId,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toContain("OrbStack CLI is unavailable");
      expect(stdout).toContain(`E2E evidence: e2e-results/${runId}`);
      expect(stderr).toBe("");
      expect(
        JSON.parse(await readFile(join(hostProjectDir, "e2e-results", runId, "run.json"), "utf8")),
      ).toMatchObject({
        exitCode: 1,
        interrupted: false,
        preflight: { orbStackReady: false },
        evidenceSync: {
          error: "Skipped because the OrbStack preflight failed.",
        },
      });
    } finally {
      await rm(hostProjectDir, { force: true, recursive: true });
    }
  });

  test("records and syncs evidence when the nested runner cannot spawn", async () => {
    const hostProjectDir = await mkdtemp(join(tmpdir(), "svvy-e2e-runner-failure-"));
    const runId = "runner-spawn-failure";
    let evidenceSyncCalls = 0;

    try {
      const exitCode = await runE2E(
        {
          forwardedArgs: ["e2e/svvy-smoke.test.ts"],
          hostProjectDir,
          machineArch: "arm64",
          machineName: "svvy-e2e",
          remoteWorkspace: "$HOME/code/svvy",
          runId,
        },
        {
          ensureOrbStackRunning: async () => true,
          spawnRunner: () => {
            throw new TypeError("Injected nested runner spawn failure.");
          },
          syncEvidence: async () => {
            evidenceSyncCalls += 1;
            return { stdout: "synced injected evidence\n", stderr: "" };
          },
        },
      );

      expect(exitCode).toBe(1);
      expect(evidenceSyncCalls).toBe(1);
      expect(
        JSON.parse(await readFile(join(hostProjectDir, "e2e-results", runId, "run.json"), "utf8")),
      ).toMatchObject({
        exitCode: 1,
        interrupted: false,
        preflight: { orbStackReady: true },
        evidenceSync: { stdout: "synced injected evidence\n", stderr: "" },
        infrastructureError: {
          name: "TypeError",
          message: "Injected nested runner spawn failure.",
        },
      });
      expect(
        await readFile(join(hostProjectDir, "e2e-results", runId, "runner.stderr.log"), "utf8"),
      ).toContain("Injected nested runner spawn failure.");
    } finally {
      await rm(hostProjectDir, { force: true, recursive: true });
    }
  });

  test("does not launch the nested runner when machine setup repair fails", async () => {
    const hostProjectDir = await mkdtemp(join(tmpdir(), "svvy-e2e-setup-failure-"));
    const runId = "setup-failure";
    let spawnCalls = 0;
    let evidenceSyncCalls = 0;

    try {
      const exitCode = await runE2E(
        {
          forwardedArgs: [],
          hostProjectDir,
          machineArch: "arm64",
          machineName: "svvy-e2e",
          remoteWorkspace: "$HOME/code/svvy",
          runId,
        },
        {
          ensureOrbStackRunning: async () => true,
          ensureOrbStackSetup: async (report) => {
            await report("setup unavailable\n");
            return false;
          },
          spawnRunner: () => {
            spawnCalls += 1;
            throw new Error("runner should not start");
          },
          syncEvidence: async () => {
            evidenceSyncCalls += 1;
            return { stdout: "synced\n", stderr: "" };
          },
        },
      );

      expect(exitCode).toBe(1);
      expect(spawnCalls).toBe(0);
      expect(evidenceSyncCalls).toBe(1);
      expect(
        JSON.parse(await readFile(join(hostProjectDir, "e2e-results", runId, "run.json"), "utf8")),
      ).toMatchObject({
        preflight: { orbStackReady: true, orbStackSetupReady: false },
        evidenceSync: { stdout: "synced\n" },
      });
      expect(
        await readFile(join(hostProjectDir, "e2e-results", runId, "runner.stdout.log"), "utf8"),
      ).toContain("setup unavailable");
    } finally {
      await rm(hostProjectDir, { force: true, recursive: true });
    }
  });
});
