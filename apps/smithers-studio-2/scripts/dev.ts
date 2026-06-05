import { createServer } from "node:net";
import { exit } from "node:process";

type ManagedProcess = { name: string; process: Bun.Subprocess<"ignore", "pipe", "pipe"> };

// `bun dev` boots the REAL backends by default. The Gateway (server/) serves
// /health + the /rpc JSON-RPC surface for Runs + Developer by binding a Gateway
// adapter to the workspace's real smithers.db, and the Workspace API (server/)
// serves /__smithers_studio/api/* by calling the real Smithers packages and
// local CLIs (jj/jjhub, the SQLite store, the agent runtime). Both operate on
// the workspace at SMITHERS_STUDIO_WORKSPACE (default: the repo root). The
// Playwright e2e fixtures (tests/fixtures/*) serve deterministic, SEEDED DEMO
// data and are opt-in: set SMITHERS_DEV_USE_FIXTURES=1 to boot them instead
// (e.g. to dogfood the seeded surfaces the e2e suite asserts on).
const APP_DIR = "apps/smithers-studio-2";
const useFixtures = process.env.SMITHERS_DEV_USE_FIXTURES === "1";
// The workspace the real backend operates on. Defaults to the monorepo root so
// `bun dev` comes up populated against this repo's real .smithers + smithers.db.
const workspaceRoot = process.env.SMITHERS_STUDIO_WORKSPACE ?? process.cwd();
const host = process.env.SMITHERS_STUDIO_2_HOST ?? "127.0.0.1";
const gatewayStartPort = numberFromEnv("SMITHERS_GATEWAY_PORT", 7331);
const workspaceApiStartPort = numberFromEnv("SMITHERS_WORKSPACE_API_PORT", 7410);
const ptyStartPort = numberFromEnv("SMITHERS_PTY_PORT", 7342);
const uiStartPort = numberFromEnv("SMITHERS_STUDIO_2_PORT", 5190);
const children: ManagedProcess[] = [];
let shuttingDown = false;

function numberFromEnv(key: string, fallback: number) {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error(`${key} must be a TCP port number.`);
  return parsed;
}

async function isPortFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

async function findOpenPort(startPort: number) {
  for (let port = startPort; port <= startPort + 50; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No open port found from ${startPort} to ${startPort + 50}.`);
}

async function pipeStream(name: string, stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffered = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffered.trim()) console.log(`[${name}] ${buffered.trimEnd()}`);
      return;
    }
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) console.log(`[${name}] ${line}`);
  }
}

function spawnManaged(name: string, command: string[], env: Record<string, string> = {}, cwd = process.cwd()) {
  const child = {
    name,
    process: Bun.spawn(command, { cwd, env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" }),
  };
  children.push(child);
  void pipeStream(name, child.process.stdout);
  void pipeStream(name, child.process.stderr);
  void child.process.exited.then((code) => {
    if (!shuttingDown) {
      console.error(`[dev] ${name} exited with code ${code}. Stopping dev stack.`);
      void shutdown(code || 1);
    }
  });
}

async function waitForHttpOk(url: string, timeoutMs = 20_000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? ` (${lastError})` : ""}.`);
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.toReversed()) {
    if (child.process.exitCode === null) child.process.kill("SIGTERM");
  }
  await Promise.allSettled(children.map((child) => child.process.exited));
  exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`[dev] Received ${signal}. Stopping dev stack.`);
    void shutdown(0);
  });
}

async function main() {
  const gatewayPort = await findOpenPort(gatewayStartPort);
  const workspaceApiPort = await findOpenPort(workspaceApiStartPort);
  const ptyPort = await findOpenPort(ptyStartPort);
  const uiPort = await findOpenPort(uiStartPort);
  const gatewayUrl = `http://${host}:${gatewayPort}`;
  const workspaceApiUrl = `http://${host}:${workspaceApiPort}`;
  const ptyUrl = `http://${host}:${ptyPort}`;
  const uiUrl = `http://${host}:${uiPort}`;

  // Smithers Gateway (serves /health + the /rpc JSON-RPC surface for Runs +
  // Developer). Default: the REAL Gateway (server/) bound to the real workspace
  // smithers.db, surfacing the workspace's real runs with NO seeded data. Opt-in:
  // SMITHERS_DEV_USE_FIXTURES=1 swaps in the seeded e2e fixture, which inline-
  // defines demo workflows and executes deterministic studio-* runs/gates.
  if (useFixtures) {
    console.log(`[dev] Starting Smithers Gateway (e2e fixture, seeded demo runs) on ${gatewayUrl}`);
    spawnManaged("gateway", ["bun", "tests/fixtures/gatewayFixture.tsx"], {
      SMITHERS_STUDIO_GATEWAY_PORT: String(gatewayPort),
    }, APP_DIR);
  } else {
    console.log(`[dev] Starting Smithers Gateway (real backend) on ${gatewayUrl}`);
    spawnManaged("gateway", ["bun", "server/startGatewayServer.ts"], {
      SMITHERS_STUDIO_GATEWAY_PORT: String(gatewayPort),
      SMITHERS_STUDIO_WORKSPACE: workspaceRoot,
    }, APP_DIR);
  }
  await waitForHttpOk(`${gatewayUrl}/health`, 60_000);

  // Workspace-API server (serves /__smithers_studio/api/* for Home recents,
  // Workflows, Issues, Landings, Workspaces, Memory, Scores, SQL, Logs, Chat).
  // Default: the REAL backend (server/) against the real workspace. Opt-in:
  // SMITHERS_DEV_USE_FIXTURES=1 swaps in the seeded e2e fixture.
  if (useFixtures) {
    console.log(`[dev] Starting Workspace API (e2e fixture, seeded demo data) on ${workspaceApiUrl}`);
    spawnManaged("workspace-api", ["bun", "tests/fixtures/workspaceApiServer.ts"], {
      SMITHERS_STUDIO_WORKSPACE_API_PORT: String(workspaceApiPort),
    }, APP_DIR);
  } else {
    console.log(`[dev] Starting Workspace API (real backend) on ${workspaceApiUrl}`);
    spawnManaged("workspace-api", ["bun", "server/startWorkspaceApiServer.ts"], {
      SMITHERS_STUDIO_WORKSPACE_API_PORT: String(workspaceApiPort),
      SMITHERS_STUDIO_WORKSPACE: workspaceRoot,
    }, APP_DIR);
  }
  await waitForHttpOk(`${workspaceApiUrl}/health`);

  console.log(`[dev] Starting PTY Server on ${ptyUrl}`);
  // Run the PTY server under Node, not Bun: node-pty's native read loop closes
  // the PTY fd before any data is delivered under Bun (zero-byte reads, ioctl
  // EBADF on resize), so the terminal would attach but show no output.
  spawnManaged("pty", ["node", "scripts/pty-server.ts"], {
    PTY_SERVER_HOST: host,
    PTY_SERVER_PORT: String(ptyPort),
  }, APP_DIR);
  await waitForHttpOk(`${ptyUrl}/health`);

  // Vite serves the UI same-origin and proxies each backend (the clients call
  // location.origin, so the proxy targets are how the browser reaches them).
  console.log(`[dev] Starting Smithers Studio 2 on ${uiUrl}`);
  spawnManaged("studio-2", ["node", "node_modules/vite/bin/vite.js", "--host", host, "--port", String(uiPort), "--strictPort"], {
    SMITHERS_STUDIO_GATEWAY_PROXY_TARGET: gatewayUrl,
    SMITHERS_STUDIO_WORKSPACE_API_PROXY_TARGET: workspaceApiUrl,
    PTY_SERVER_URL: ptyUrl,
  }, APP_DIR);
  await waitForHttpOk(uiUrl);

  console.log("");
  console.log(`[dev] Studio 2:      ${uiUrl}`);
  console.log(`[dev] Gateway:       ${gatewayUrl}`);
  console.log(`[dev] Workspace API: ${workspaceApiUrl}`);
  console.log(`[dev] PTY:           ${ptyUrl}`);
  if (useFixtures) {
    console.log("[dev] Backends: e2e fixtures (seeded demo runs + demo data). Press Ctrl+C to stop.");
  } else {
    console.log(`[dev] Backends: real Gateway + Workspace API against ${workspaceRoot}. Press Ctrl+C to stop.`);
    console.log("[dev] (Set SMITHERS_DEV_USE_FIXTURES=1 to boot the seeded e2e fixtures instead.)");
  }
  await Promise.race(children.map((child) => child.process.exited));
}

main().catch((error) => {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  void shutdown(1);
});
