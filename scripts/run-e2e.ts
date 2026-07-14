import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadElectrobunE2EConfig, resolveDefaultConfigPath } from "electrobun-e2e";
import electrobunConfig from "../electrobun.config";

const DEFAULT_MACHINE_NAME = "svvy-e2e";
const DEFAULT_MACHINE_ARCH = "arm64";
const DEFAULT_REMOTE_WORKSPACE = "$HOME/code/svvy";
const EVIDENCE_DIRECTORY_NAME = "e2e-results";
export const ORBSTACK_START_TIMEOUT_MS = 40_000;
export const ORBSTACK_SETUP_MARKER_PATH = "$HOME/.svvy-electrobun-e2e-setup-v2";
const ORBSTACK_SETUP_MARKER_NAME = ".svvy-electrobun-e2e-setup-v2";

export type E2EMachineArch = "amd64" | "arm64";

export interface E2ESetupManifest {
  readonly schemaVersion: 2;
  readonly machineArch: E2EMachineArch;
  readonly machineImage: string;
  readonly bunVersion: string;
  readonly extraAptPackages: string[];
}

export interface E2ERunSettings {
  forwardedArgs: string[];
  hostProjectDir: string;
  machineArch: E2EMachineArch;
  machineName: string;
  remoteWorkspace: string;
  runId: string;
}

type E2ERunnerProcess = {
  readonly exited: Promise<number>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  kill(signal?: NodeJS.Signals | number): void;
};

export interface E2ERunDependencies {
  collectRemoteRuntimeMetadata?: typeof collectRemoteRuntimeMetadata;
  cleanupRemoteRun?: typeof cleanupRemoteRun;
  ensureOrbStackRunning?: typeof ensureOrbStackRunning;
  ensureOrbStackSetup?: typeof ensureOrbStackSetup;
  spawnRunner?: (command: string[], settings: E2ERunSettings) => E2ERunnerProcess;
  syncEvidence?: typeof syncEvidence;
}

export interface E2ERemoteRuntimeMetadata {
  artifacts: Record<string, string>;
  guestArch: string;
  runnerBunRevision: string;
  runnerBunVersion: string;
}

export function buildRemoteRunCleanupScript(settings: E2ERunSettings): string {
  return `set -uo pipefail
expand_path() {
  local raw_path="$1"
  case "$raw_path" in
    '$HOME'/*) printf '%s\\n' "$HOME/\${raw_path#\\$HOME/}" ;;
    '~'/*) printf '%s\\n' "$HOME/\${raw_path#~/}" ;;
    *) printf '%s\\n' "$raw_path" ;;
  esac
}

run_marker=${shellQuote(`SVVY_E2E_RUN_ID=${settings.runId}`)}
workspace_dir="$(expand_path ${shellQuote(settings.remoteWorkspace)})"
cleanup_pid="$$"
matching_pids=()

for environment_path in /proc/[0-9]*/environ; do
  pid="\${environment_path#/proc/}"
  pid="\${pid%/environ}"
  if [[ "$pid" == "$cleanup_pid" ]] || [[ ! "$pid" =~ ^[1-9][0-9]*$ ]]; then
    continue
  fi
  if cat "$environment_path" 2>/dev/null | tr '\\0' '\\n' | grep -Fxq "$run_marker"; then
    matching_pids+=("$pid")
  fi
done

if [[ "\${#matching_pids[@]}" -gt 0 ]]; then
  kill -TERM "\${matching_pids[@]}" 2>/dev/null || true
  kill -KILL "\${matching_pids[@]}" 2>/dev/null || true
fi

rm -rf "$workspace_dir/${EVIDENCE_DIRECTORY_NAME}/${settings.runId}/active-launches"
printf 'SVVY_E2E_REMOTE_CLEANUP matched=%d\\n' "\${#matching_pids[@]}"
`;
}

async function cleanupRemoteRun(
  settings: E2ERunSettings,
): Promise<{ exitCode: number; output: string }> {
  return await readRemoteScript(settings.machineName, buildRemoteRunCleanupScript(settings));
}

export function parseRemoteRuntimeMetadata(output: string): E2ERemoteRuntimeMetadata {
  const fields = new Map<string, string>();
  for (const line of output.trim().split("\n")) {
    const separator = line.indexOf("\t");
    if (separator < 1) continue;
    fields.set(line.slice(0, separator), line.slice(separator + 1));
  }

  const guestArch = fields.get("guestArch");
  const runnerBunRevision = fields.get("runnerBunRevision");
  const runnerBunVersion = fields.get("runnerBunVersion");
  if (!guestArch || !runnerBunRevision || !runnerBunVersion) {
    throw new Error(`Incomplete OrbStack runtime metadata: ${JSON.stringify(output)}`);
  }

  return {
    guestArch,
    runnerBunRevision,
    runnerBunVersion,
    artifacts: Object.fromEntries(
      [...fields]
        .filter(([key]) => key.startsWith("artifact:"))
        .map(([key, value]) => [key.slice("artifact:".length), value]),
    ),
  };
}

async function collectRemoteRuntimeMetadata(
  settings: E2ERunSettings,
): Promise<E2ERemoteRuntimeMetadata> {
  const buildArch = settings.machineArch === "arm64" ? "arm64" : "x64";
  const script = `set -euo pipefail
expand_path() {
  local raw_path="$1"
  case "$raw_path" in
    '$HOME'/*) printf '%s\\n' "$HOME/\${raw_path#\\$HOME/}" ;;
    '~'/*) printf '%s\\n' "$HOME/\${raw_path#~/}" ;;
    *) printf '%s\\n' "$raw_path" ;;
  esac
}

export PATH="$HOME/.bun/bin:$PATH"
workspace_dir="$(expand_path ${shellQuote(settings.remoteWorkspace)})"
bin_dir="$workspace_dir/build/dev-linux-${buildArch}/svvy-dev/bin"
printf 'guestArch\\t%s\\n' "$(uname -m)"
printf 'runnerBunRevision\\t%s\\n' "$(bun --revision)"
printf 'runnerBunVersion\\t%s\\n' "$(bun --version)"
for artifact_name in launcher bun libNativeWrapper.so libcef.so; do
  artifact_path="$bin_dir/$artifact_name"
  if [[ -e "$artifact_path" ]]; then
    printf 'artifact:%s\\t%s\\n' "$artifact_name" "$(file -Lb "$artifact_path")"
  else
    printf 'artifact:%s\\tmissing\\n' "$artifact_name"
  fi
done
`;
  const result = await readRemoteScript(settings.machineName, script);
  if (result.exitCode !== 0) {
    throw new Error(`Could not collect OrbStack runtime metadata: ${result.output}`);
  }
  return parseRemoteRuntimeMetadata(result.output);
}

export function createE2ERunId(now = new Date()): string {
  return `${now.toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
}

export function e2eRunnerSignalForAttempt(
  requestedSignal: NodeJS.Signals,
  signalAttempt: number,
): NodeJS.Signals {
  if (signalAttempt >= 3) return "SIGKILL";
  if (signalAttempt === 2) return "SIGTERM";
  return requestedSignal;
}

export function resolveE2ERunSettings(
  forwardedArgs = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  hostProjectDir = process.cwd(),
): E2ERunSettings {
  return {
    forwardedArgs,
    hostProjectDir,
    machineArch: resolveE2EMachineArch(env.ELECTROBUN_E2E_ORB_ARCH?.trim() || DEFAULT_MACHINE_ARCH),
    machineName: env.ELECTROBUN_E2E_ORB_MACHINE?.trim() || DEFAULT_MACHINE_NAME,
    remoteWorkspace: env.ELECTROBUN_E2E_ORB_WORKSPACE?.trim() || DEFAULT_REMOTE_WORKSPACE,
    runId: env.SVVY_E2E_RUN_ID?.trim() || createE2ERunId(),
  };
}

export function resolveE2EMachineArch(value: string): E2EMachineArch {
  switch (value.toLowerCase()) {
    case "arm64":
    case "aarch64":
      return "arm64";
    case "amd64":
    case "x64":
    case "x86_64":
      return "amd64";
    default:
      throw new Error(
        `Unsupported OrbStack e2e architecture ${JSON.stringify(value)}; expected arm64 or amd64.`,
      );
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildEvidenceSyncScript(settings: E2ERunSettings): string {
  const hostEvidenceDir = `/mnt/mac${join(settings.hostProjectDir, EVIDENCE_DIRECTORY_NAME)}`;

  return `set -euo pipefail
expand_path() {
  local raw_path="$1"
  case "$raw_path" in
    '$HOME'/*) printf '%s\\n' "$HOME/\${raw_path#\\$HOME/}" ;;
    '~'/*) printf '%s\\n' "$HOME/\${raw_path#~/}" ;;
    *) printf '%s\\n' "$raw_path" ;;
  esac
}

workspace_dir="$(expand_path ${shellQuote(settings.remoteWorkspace)})"
source_dir="$workspace_dir/${EVIDENCE_DIRECTORY_NAME}"
host_dir=${shellQuote(hostEvidenceDir)}
mkdir -p "$host_dir"
if [[ -d "$source_dir" ]]; then
  rsync -a "$source_dir/" "$host_dir/"
fi
`;
}

export function orbStackIsRunning(statusOutput: string): boolean {
  return /\brunning\b/i.test(statusOutput) && !/\b(?:not running|stopped)\b/i.test(statusOutput);
}

export function orbStackUnavailableGuidance(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CODEX_SANDBOX !== undefined) {
    return [
      "Codex's default sandbox cannot access OrbStack's Unix control socket.",
      "If this run was not explicitly granted sandbox escalation/full access, re-run",
      "`bun run test:e2e` with that access; approving the",
      "`bun run test:e2e` command prefix when offered keeps future runs low-friction.",
    ].join(" ");
  }
  return "Start OrbStack, confirm `orb status` reports Running, then rerun `bun run test:e2e`.";
}

async function readCommand(command: string[]): Promise<{
  exitCode: number;
  output: string;
}> {
  const process = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}${stderr}`.trim() };
}

async function readRemoteScript(
  machineName: string,
  script: string,
): Promise<{ exitCode: number; output: string }> {
  const proc = Bun.spawn(["orb", "-m", machineName, "bash", "-s"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(script);
  proc.stdin.end();
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}${stderr}`.trim() };
}

export function createE2ESetupManifest(input: {
  machineArch: E2EMachineArch;
  machineImage: string;
  bunVersion: string;
  extraAptPackages: string[];
}): E2ESetupManifest {
  return {
    schemaVersion: 2,
    machineArch: input.machineArch,
    machineImage: input.machineImage,
    bunVersion: input.bunVersion,
    extraAptPackages: [...new Set(input.extraAptPackages.map((value) => value.trim()))]
      .filter(Boolean)
      .toSorted(),
  };
}

function setupManifestText(manifest: E2ESetupManifest): string {
  return JSON.stringify(manifest);
}

export function buildOrbStackSetupProbeScript(manifest: E2ESetupManifest): string {
  const expected = setupManifestText(manifest);
  const packages = manifest.extraAptPackages.map(shellQuote).join(" ");
  return `set -euo pipefail
export PATH="$HOME/.bun/bin:$PATH"
marker="$HOME/${ORBSTACK_SETUP_MARKER_NAME}"
expected=${shellQuote(expected)}
expected_arch=${shellQuote(manifest.machineArch === "arm64" ? "aarch64" : "x86_64")}
if [[ ! -f "$marker" ]]; then
  echo 'SVVY_E2E_SETUP_REQUIRED marker-missing'
  exit 0
fi
if [[ "$(cat "$marker")" != "$expected" ]]; then
  echo 'SVVY_E2E_SETUP_REQUIRED manifest-drift'
  exit 0
fi
if [[ "$(uname -m)" != "$expected_arch" ]]; then
  echo "SVVY_E2E_SETUP_REQUIRED architecture-drift:$(uname -m):$expected_arch"
  exit 0
fi
for package_name in ${packages}; do
  if ! dpkg-query -W -f='\${Status}' "$package_name" 2>/dev/null | grep -q 'install ok installed'; then
    echo "SVVY_E2E_SETUP_REQUIRED package-missing:$package_name"
    exit 0
  fi
done
if ! command -v bun >/dev/null 2>&1; then
  echo 'SVVY_E2E_SETUP_REQUIRED bun-drift'
  exit 0
fi
if [[ ${shellQuote(manifest.bunVersion)} == "canary" ]]; then
  if [[ "$(bun --revision)" != *-canary.* ]]; then
    echo 'SVVY_E2E_SETUP_REQUIRED bun-drift'
    exit 0
  fi
elif [[ "$(bun --version)" != ${shellQuote(manifest.bunVersion)} ]]; then
  echo 'SVVY_E2E_SETUP_REQUIRED bun-drift'
  exit 0
fi
echo 'SVVY_E2E_SETUP_READY'
`;
}

export function buildOrbStackSetupMarkerScript(manifest: E2ESetupManifest): string {
  return `set -euo pipefail
marker="$HOME/${ORBSTACK_SETUP_MARKER_NAME}"
mkdir -p "$(dirname "$marker")"
printf '%s' ${shellQuote(setupManifestText(manifest))} > "$marker"
`;
}

async function runOfficialSetup(
  settings: E2ERunSettings,
  report: (message: string) => Promise<void>,
): Promise<void> {
  const processHandle = Bun.spawn(
    [process.execPath, "x", "electrobun-e2e", "setup", "--config", "./electrobun-e2e.config.ts"],
    {
      cwd: settings.hostProjectDir,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ]);
  const output = [stdout, stderr].filter(Boolean).join("\n");
  if (output) await report(`${output}${output.endsWith("\n") ? "" : "\n"}`);
  if (exitCode !== 0) {
    throw new Error(`electrobun-e2e setup failed with exit code ${exitCode}.`);
  }
}

async function ensureOrbStackSetup(
  report: (message: string) => Promise<void>,
  settings: E2ERunSettings,
): Promise<boolean> {
  const configPath = resolveDefaultConfigPath(settings.hostProjectDir);
  if (!existsSync(configPath)) {
    // Injected runner tests and embedders may intentionally omit the shared config.
    // The real `bun run test:e2e` entrypoint always runs from a configured checkout.
    return true;
  }
  try {
    const config = await loadElectrobunE2EConfig(configPath, settings.hostProjectDir);
    const manifest = createE2ESetupManifest(config);
    const probe = await readRemoteScript(
      settings.machineName,
      buildOrbStackSetupProbeScript(manifest),
    ).catch((error) => ({
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    }));

    if (probe.exitCode === 0 && probe.output.includes("SVVY_E2E_SETUP_READY")) {
      await report("OrbStack e2e machine setup is current.\n");
      return true;
    }

    const reason = probe.output || "machine unavailable";
    await report(
      `OrbStack e2e machine setup requires repair (${reason}); running official electrobun-e2e setup...\n`,
    );
    await runOfficialSetup(settings, report);
    const marker = await readRemoteScript(
      settings.machineName,
      buildOrbStackSetupMarkerScript(manifest),
    );
    if (marker.exitCode !== 0) {
      throw new Error(`Could not record OrbStack e2e setup manifest: ${marker.output}`);
    }
    await report("OrbStack e2e machine setup repaired.\n");
    return true;
  } catch (error) {
    await report(
      `OrbStack e2e machine setup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return false;
  }
}

async function ensureOrbStackRunning(report: (message: string) => Promise<void>): Promise<boolean> {
  if (!Bun.which("orb")) {
    await report("OrbStack CLI is unavailable; install OrbStack before running desktop e2e.\n");
    return false;
  }

  const initialStatus = await readCommand(["orb", "status"]).catch(() => ({
    exitCode: 1,
    output: "",
  }));
  if (initialStatus.exitCode === 0 && orbStackIsRunning(initialStatus.output)) return true;
  if (process.platform !== "darwin" || !Bun.which("open")) {
    await report(
      `OrbStack is not running and cannot be started automatically on this host. ${orbStackUnavailableGuidance()}\n`,
    );
    return false;
  }

  await report("Starting OrbStack for the isolated e2e lane...\n");
  const launched = await readCommand(["open", "-gj", "-a", "OrbStack"]).catch((error) => ({
    exitCode: 1,
    output: error instanceof Error ? error.message : String(error),
  }));
  if (launched.exitCode !== 0) {
    await report(
      `Could not launch OrbStack automatically: ${launched.output}\n${orbStackUnavailableGuidance()}\n`,
    );
    return false;
  }

  const deadline = Date.now() + ORBSTACK_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await readCommand(["orb", "status"]).catch(() => ({
      exitCode: 1,
      output: "",
    }));
    if (status.exitCode === 0 && orbStackIsRunning(status.output)) {
      await report("OrbStack is ready.\n");
      return true;
    }
    await Bun.sleep(250);
  }
  await report(
    `OrbStack did not report ready within ${ORBSTACK_START_TIMEOUT_MS / 1_000}s; aborting before the desktop runner. ${orbStackUnavailableGuidance()}\n`,
  );
  return false;
}

async function teeStream(
  stream: ReadableStream<Uint8Array>,
  destination: {
    write(chunk: Uint8Array): number | Promise<number>;
  },
  terminal: NodeJS.WriteStream,
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await destination.write(value);
      terminal.write(value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function syncEvidence(settings: E2ERunSettings): Promise<{
  error?: string;
  stderr: string;
  stdout: string;
}> {
  const script = buildEvidenceSyncScript(settings);
  const proc = Bun.spawn(["orb", "-m", settings.machineName, "bash", "-s"], {
    cwd: settings.hostProjectDir,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(script);
  proc.stdin.end();

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return {
    stdout,
    stderr,
    ...(exitCode === 0
      ? {}
      : { error: `Evidence sync failed on ${settings.machineName} with exit code ${exitCode}.` }),
  };
}

export async function runE2E(
  settings = resolveE2ERunSettings(),
  dependencies: E2ERunDependencies = {},
): Promise<number> {
  const startedAt = new Date();
  const hostRunDir = join(settings.hostProjectDir, EVIDENCE_DIRECTORY_NAME, settings.runId);
  await mkdir(hostRunDir, { recursive: true });

  const command = [
    process.execPath,
    "x",
    "electrobun-e2e",
    "run",
    "--config",
    "./electrobun-e2e.config.ts",
    ...settings.forwardedArgs,
  ];

  const stdoutWriter = Bun.file(join(hostRunDir, "runner.stdout.log")).writer();
  const stderrWriter = Bun.file(join(hostRunDir, "runner.stderr.log")).writer();
  const reportPreflight = async (message: string): Promise<void> => {
    const bytes = new TextEncoder().encode(message);
    await stdoutWriter.write(bytes);
    process.stdout.write(bytes);
  };
  const ensureReady = dependencies.ensureOrbStackRunning ?? ensureOrbStackRunning;
  const ensureSetup = dependencies.ensureOrbStackSetup ?? ensureOrbStackSetup;
  const spawnRunner =
    dependencies.spawnRunner ??
    ((runnerCommand: string[], runnerSettings: E2ERunSettings): E2ERunnerProcess =>
      Bun.spawn(runnerCommand, {
        cwd: runnerSettings.hostProjectDir,
        env: {
          ...process.env,
          SVVY_E2E_RUN_ID: runnerSettings.runId,
        },
        stdout: "pipe",
        stderr: "pipe",
      }));
  const syncRunEvidence = dependencies.syncEvidence ?? syncEvidence;
  const cleanupRun = dependencies.cleanupRemoteRun ?? cleanupRemoteRun;
  const collectRuntimeMetadata =
    dependencies.collectRemoteRuntimeMetadata ?? collectRemoteRuntimeMetadata;
  let orbStackReady = false;
  let orbStackSetupReady = false;
  let interrupted = false;
  let child: E2ERunnerProcess | null = null;
  let exitCode = 1;
  let infrastructureError: { message: string; name: string } | undefined;
  let runnerStarted = false;
  let remoteRuntime: E2ERemoteRuntimeMetadata | { error: string } | null = null;
  let signalAttempts = 0;
  const forwardSignal = (signal: NodeJS.Signals) => {
    interrupted = true;
    signalAttempts += 1;
    try {
      child?.kill(e2eRunnerSignalForAttempt(signal, signalAttempts));
    } catch {
      // The child may have settled between signal delivery and forwarding.
    }
  };
  const forwardSigint = () => forwardSignal("SIGINT");
  const forwardSigterm = () => forwardSignal("SIGTERM");
  try {
    orbStackReady = await ensureReady(reportPreflight);
    if (orbStackReady) {
      orbStackSetupReady = await ensureSetup(reportPreflight, settings);
    }
    if (orbStackReady && orbStackSetupReady) {
      child = spawnRunner(command, settings);
      runnerStarted = true;
      process.on("SIGINT", forwardSigint);
      process.on("SIGTERM", forwardSigterm);
      const runnerTasks = [
        child.exited,
        teeStream(child.stdout, stdoutWriter, process.stdout),
        teeStream(child.stderr, stderrWriter, process.stderr),
      ] as const;
      try {
        [exitCode] = await Promise.all(runnerTasks);
      } catch (error) {
        try {
          child.kill("SIGTERM");
        } catch {
          // A spawn/transport failure can race the child process exit.
        }
        await Promise.allSettled(runnerTasks);
        throw error;
      }
    }
  } catch (error) {
    infrastructureError = {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    };
    const message = `E2E runner infrastructure failure: ${infrastructureError.message}\n`;
    process.stderr.write(message);
    await Promise.resolve(stderrWriter.write(new TextEncoder().encode(message))).catch(
      () => undefined,
    );
  } finally {
    process.removeListener("SIGINT", forwardSigint);
    process.removeListener("SIGTERM", forwardSigterm);
    await Promise.allSettled([stdoutWriter.end(), stderrWriter.end()]);
  }

  if (orbStackReady && runnerStarted) {
    remoteRuntime = await collectRuntimeMetadata(settings).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  const remoteCleanup =
    orbStackReady && runnerStarted
      ? await cleanupRun(settings).catch((error) => ({
          exitCode: 1,
          output: error instanceof Error ? error.message : String(error),
        }))
      : { exitCode: 0, output: "Skipped because the nested runner did not start." };
  if (remoteCleanup.output) {
    const message = `${remoteCleanup.output}${remoteCleanup.output.endsWith("\n") ? "" : "\n"}`;
    if (remoteCleanup.exitCode === 0) process.stdout.write(message);
    else process.stderr.write(message);
  }

  const evidenceSync = orbStackReady
    ? await syncRunEvidence(settings).catch((error) => ({
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : String(error),
      }))
    : {
        stdout: "",
        stderr: "",
        error: "Skipped because the OrbStack preflight failed.",
      };
  if (evidenceSync.stdout) process.stdout.write(evidenceSync.stdout);
  if (evidenceSync.stderr) process.stderr.write(evidenceSync.stderr);
  if (evidenceSync.error && orbStackReady) process.stderr.write(`${evidenceSync.error}\n`);

  const finishedAt = new Date();
  const packageJson = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
    dependencies?: Record<string, string>;
  };
  const configuredE2E = existsSync(resolveDefaultConfigPath(settings.hostProjectDir))
    ? await loadElectrobunE2EConfig(
        resolveDefaultConfigPath(settings.hostProjectDir),
        settings.hostProjectDir,
      ).catch(() => null)
    : null;
  await writeFile(
    join(hostRunDir, "run.json"),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        runId: settings.runId,
        command,
        forwardedArgs: settings.forwardedArgs,
        machineArch: settings.machineArch,
        machineName: settings.machineName,
        remoteWorkspace: settings.remoteWorkspace,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        exitCode,
        interrupted,
        environment: {
          host: {
            arch: process.arch,
            platform: process.platform,
          },
          requested: {
            machineArch: settings.machineArch,
            machineImage: configuredE2E?.machineImage ?? null,
            machineName: settings.machineName,
          },
          observed: remoteRuntime,
          app: {
            electrobunVersion: packageJson.dependencies?.electrobun ?? null,
            embeddedBunVersion: electrobunConfig.build.bunVersion,
            linuxBundleCEF: electrobunConfig.build.linux?.bundleCEF ?? false,
            linuxRenderer: electrobunConfig.build.linux?.bundleCEF ? "cef" : "native",
          },
        },
        remoteCleanup,
        preflight: {
          orbStackReady,
          orbStackSetupReady,
        },
        evidenceSync,
        ...(infrastructureError ? { infrastructureError } : {}),
      },
      null,
      2,
    )}\n`,
  );

  const relativeRunDir = join(EVIDENCE_DIRECTORY_NAME, settings.runId);
  process.stdout.write(`E2E evidence: ${relativeRunDir}\n`);
  return exitCode;
}

if (import.meta.main) {
  const exitCode = await runE2E();
  process.exit(exitCode);
}
