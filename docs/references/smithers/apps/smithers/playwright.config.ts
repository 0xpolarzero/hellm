import { defineConfig, devices } from "@playwright/test";

/**
 * Real-backend e2e configuration for the Smithers PWA.
 *
 * The webServer array boots live local services so specs drive the UI against
 * real network paths with no route mocking:
 *
 *   1. cerebrasUpstream.ts: deterministic OpenAI-compatible SSE upstream.
 *   2. workerHost.ts: the real Cloudflare Worker, pointed at local upstreams.
 *   3. gatewayFixture.tsx: a real Smithers gateway with a completed custom UI.
 *   4. fakePlueHost.ts: deterministic Plue/jjhub auth and platform fixtures.
 *   5. vite: the main app origin, proxying API traffic through the Worker.
 *   6. vite: a second Plue-harness app origin, proxying directly to fake Plue.
 *
 * Every port is env-configurable so parallel runs can offset the whole stack.
 */

const testPort = process.env.SMITHERS_TEST_PORT || "5275";
const workerPort = process.env.SMITHERS_WORKER_TEST_PORT || "5276";
const upstreamPort = process.env.SMITHERS_UPSTREAM_TEST_PORT || "5277";
const gatewayPort = process.env.SMITHERS_GATEWAY_TEST_PORT || "5278";
const plueFixturePort = process.env.SMITHERS_PLUE_TEST_PORT || "5279";
const authFixturePort = process.env.SMITHERS_AUTH_TEST_PORT || "5280";
const fakePlueAuthPort = process.env.SMITHERS_FAKE_PLUE_TEST_PORT || "5290";
const fakePluePlatformPort = process.env.SMITHERS_FAKE_PLUE_PLATFORM_TEST_PORT || "5291";
const plueHarnessPort = process.env.SMITHERS_PLUE_HARNESS_TEST_PORT || "5292";

const workerUrl = `http://127.0.0.1:${workerPort}`;
const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const plueFixtureUrl = `http://127.0.0.1:${plueFixturePort}`;
const authFixtureUrl = `http://127.0.0.1:${authFixturePort}`;
const fakePlueAuthUrl = `http://127.0.0.1:${fakePlueAuthPort}`;
const fakePluePlatformUrl = `http://127.0.0.1:${fakePluePlatformPort}`;

function onboardedOrigin(origin: string) {
  return {
    origin,
    localStorage: [
      {
        name: "smithers.onboarding",
        value: JSON.stringify({ state: { completed: true }, version: 0 }),
      },
    ],
  };
}

/**
 * Seed the first-run onboarding flag as completed for test origins, so the
 * onboarding overlay does not cover the rest of the suite. The onboarding spec
 * overrides this with empty storage to drive the real first run.
 */
const onboardedStorageState = {
  cookies: [],
  origins: [
    onboardedOrigin(`http://127.0.0.1:${testPort}`),
    onboardedOrigin(`http://127.0.0.1:${plueHarnessPort}`),
  ],
};

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "line" : "html",
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    trace: "on-first-retry",
    storageState: onboardedStorageState,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `bun tests/fixtures/cerebrasUpstream.ts`,
      url: `${upstreamUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { SMITHERS_UPSTREAM_PORT: upstreamPort },
    },
    {
      command: `bun tests/fixtures/workerHost.ts`,
      url: `${workerUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        SMITHERS_WORKER_PORT: workerPort,
        CEREBRAS_BASE_URL: `${upstreamUrl}/v1`,
        // Split config: AUTH (identity + /api/user/keys + /api/auth/*) and GO
        // (Plue REST: /api/user/<sub>, /api/repos/*, /api/notifications, ...)
        // target distinct fixture origins. This exercises the Worker's
        // platform-user-subpath precedence.
        AUTH_API_BASE_URL: authFixtureUrl,
        GO_API_BASE_URL: plueFixtureUrl,
      },
    },
    {
      command: `bun tests/fixtures/authFixture.ts`,
      url: `${authFixtureUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { SMITHERS_AUTH_PORT: authFixturePort },
    },
    {
      command: `bun tests/fixtures/plueFixture.ts`,
      url: `${plueFixtureUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { SMITHERS_PLUE_PORT: plueFixturePort },
    },
    {
      command: `bun tests/fixtures/gatewayFixture.tsx`,
      url: `${gatewayUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { SMITHERS_GATEWAY_PORT: gatewayPort },
    },
    {
      command: `bun tests/fixtures/fakePlueHost.ts`,
      url: `${fakePlueAuthUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { FAKE_PLUE_PORT: fakePlueAuthPort, FAKE_PLUE_SERVICE_LABEL: "auth" },
    },
    {
      command: `bun tests/fixtures/fakePlueHost.ts`,
      url: `${fakePluePlatformUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { FAKE_PLUE_PORT: fakePluePlatformPort, FAKE_PLUE_SERVICE_LABEL: "platform" },
    },
    {
      command: `vite --host 127.0.0.1 --port ${testPort} --strictPort`,
      port: parseInt(testPort, 10),
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        SMITHERS_CHAT_PROXY_TARGET: workerUrl,
        SMITHERS_GATEWAY_PROXY_TARGET: gatewayUrl,
        SMITHERS_PLATFORM_PROXY_TARGET: workerUrl,
      },
    },
    {
      command: `vite --host 127.0.0.1 --port ${plueHarnessPort} --strictPort`,
      port: parseInt(plueHarnessPort, 10),
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        SMITHERS_CHAT_PROXY_TARGET: workerUrl,
        SMITHERS_GATEWAY_PROXY_TARGET: gatewayUrl,
        SMITHERS_AUTH_PROXY_TARGET: fakePlueAuthUrl,
        SMITHERS_PLATFORM_PROXY_TARGET: fakePluePlatformUrl,
        VITE_SMITHERS_E2E_TEST_HOOKS: "1",
      },
    },
  ],
});
