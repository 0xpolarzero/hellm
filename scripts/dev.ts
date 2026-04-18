const DEV_SERVER_URL = process.env.SVVY_VITE_DEV_SERVER_URL ?? "http://localhost:5173";
const DEV_SERVER_WAIT_TIMEOUT_MS = 15_000;
const DEV_SERVER_POLL_INTERVAL_MS = 250;

const VITE_DEV_COMMAND = [process.execPath, "x", "vite", "--port", "5173"];
const VITE_BUILD_COMMAND = [process.execPath, "x", "vite", "build"];
const ELECTROBUN_DEV_COMMAND = [process.execPath, "x", "electrobun", "dev", "--watch"];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isDevServerReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDevServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isDevServerReady(url)) {
      return;
    }
    await sleep(DEV_SERVER_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for the Vite dev server at ${url}.`);
}

async function runChecked(command: string[], env = process.env): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: process.cwd(),
    env,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(`Command failed (${code}): ${command.join(" ")}`);
  }
}

let shuttingDown = false;
let viteProcess: Bun.Subprocess | null = null;
let appProcess: Bun.Subprocess | null = null;

function killProcess(process: Bun.Subprocess | null, signal: NodeJS.Signals): void {
  if (!process) return;
  try {
    process.kill(signal);
  } catch {
    // Ignore already-exited children during shutdown.
  }
}

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  killProcess(appProcess, signal);
  killProcess(viteProcess, signal);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => shutdown(signal));
}

try {
  const workspaceCwd = process.cwd();

  viteProcess = Bun.spawn(VITE_DEV_COMMAND, {
    cwd: workspaceCwd,
    env: process.env,
    stdio: ["inherit", "inherit", "inherit"],
  });

  console.log(`Waiting for Vite dev server at ${DEV_SERVER_URL}...`);
  await waitForDevServer(DEV_SERVER_URL, DEV_SERVER_WAIT_TIMEOUT_MS);

  await runChecked(VITE_BUILD_COMMAND);

  appProcess = Bun.spawn(ELECTROBUN_DEV_COMMAND, {
    cwd: workspaceCwd,
    env: {
      ...process.env,
      SVVY_VITE_DEV_SERVER: "wait",
      SVVY_WORKSPACE_CWD: workspaceCwd,
    },
    stdio: ["inherit", "inherit", "inherit"],
  });

  const viteExitPromise = viteProcess.exited.then((code) => ({ code, process: "vite" as const }));
  const appExitPromise = appProcess.exited.then((code) => ({ code, process: "app" as const }));
  const result = await Promise.race([viteExitPromise, appExitPromise]);

  if (!shuttingDown) {
    shuttingDown = true;
    if (result.process === "app") {
      killProcess(viteProcess, "SIGTERM");
    } else {
      killProcess(appProcess, "SIGTERM");
    }
  }

  process.exit(result.code);
} catch (error) {
  shutdown("SIGTERM");
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
