import { defineConfig, devices } from '@playwright/test';

/**
 * Real-backend e2e configuration. The webServer array boots the full stack so
 * specs drive the UI against live services with NO route mocking:
 *
 *   1. gatewayFixture.tsx   — a real Smithers Gateway (Bun) seeded with
 *                             deterministic runs/approvals; serves /v1/rpc.
 *   2. workspaceApiServer   — serves /__smithers_studio/api/* from seeded JJHub
 *                             / memory / scores state.
 *   3. pty-server.ts        — the real node-pty server (Node, not Bun — node-pty
 *                             is broken under Bun); serves /terminal/ws + /health.
 *   4. vite                 — the app, proxying /v1/rpc + /__smithers_studio +
 *                             /terminal/ws to the services above (same-origin).
 *
 * Every port is env-configurable so parallel runs can offset the whole stack.
 */

const testPort = process.env.SMITHERS_STUDIO_TEST_PORT || '5500';
const gatewayPort = process.env.SMITHERS_STUDIO_GATEWAY_TEST_PORT || '7400';
const workspaceApiPort = process.env.SMITHERS_STUDIO_WORKSPACE_API_TEST_PORT || '7410';
const ptyPort = process.env.PTY_SERVER_PORT || '7401';

const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const workspaceApiUrl = `http://127.0.0.1:${workspaceApiPort}`;
const ptyUrl = `http://127.0.0.1:${ptyPort}`;

export default defineConfig({
  testDir: './tests',
  // Playwright e2e specs are `*.spec.ts`. `*.test.ts` files under tests/ (e.g.
  // tests/server/pty-server.test.ts) are Bun unit tests that import `bun:*`
  // modules and must NOT be collected by the node-hosted Playwright runner.
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // Real-backend suite: every assertion waits on genuine RPC/stream content, and
  // under full local parallelism (16 workers) every viewed live run also opens a
  // real event stream to the shared seeded gateway. Give assertions headroom so
  // contention-induced latency doesn't flake a true condition — a genuinely
  // false assertion still fails, just after a longer wait.
  expect: { timeout: 15_000 },
  reporter: 'html',
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `bun tests/fixtures/gatewayFixture.tsx`,
      url: `${gatewayUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        SMITHERS_STUDIO_GATEWAY_PORT: gatewayPort,
      },
    },
    {
      command: `bun tests/fixtures/workspaceApiServer.ts`,
      url: `${workspaceApiUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        SMITHERS_STUDIO_WORKSPACE_API_PORT: workspaceApiPort,
      },
    },
    {
      // node-pty is broken under Bun — run the PTY server under node.
      command: `node scripts/pty-server.ts`,
      url: `${ptyUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PTY_SERVER_PORT: ptyPort,
      },
    },
    {
      command: `vite --host 127.0.0.1 --port ${testPort}`,
      port: parseInt(testPort),
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        SMITHERS_STUDIO_GATEWAY_PROXY_TARGET: gatewayUrl,
        SMITHERS_STUDIO_WORKSPACE_API_PROXY_TARGET: workspaceApiUrl,
        PTY_SERVER_URL: ptyUrl,
      },
    },
  ],
});
