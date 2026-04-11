const DEV_SERVER_URL = process.env.HELLM_VITE_DEV_SERVER_URL ?? "http://localhost:5173";
const DEV_SERVER_WAIT_TIMEOUT_MS = 15_000;
const DEV_SERVER_POLL_INTERVAL_MS = 250;

type DevMode = "hmr" | "watch";

function parseMode(argv: string[]): DevMode {
  const arg = argv.find((value) => value.startsWith("--mode="));
  if (arg === "--mode=hmr") return "hmr";
  if (arg === "--mode=watch") return "watch";
  throw new Error('Expected "--mode=hmr" or "--mode=watch".');
}

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

const mode = parseMode(process.argv.slice(2));
if (mode === "hmr") {
  console.log(`Waiting for Vite dev server at ${DEV_SERVER_URL}...`);
  await waitForDevServer(DEV_SERVER_URL, DEV_SERVER_WAIT_TIMEOUT_MS);
}

const child = Bun.spawn([process.execPath, "run", "dev:watch:base"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HELLM_VITE_DEV_SERVER: mode === "hmr" ? "wait" : "off",
  },
  stdio: ["inherit", "inherit", "inherit"],
});

const forwardSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
for (const signal of forwardSignals) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

process.exit(await child.exited);
