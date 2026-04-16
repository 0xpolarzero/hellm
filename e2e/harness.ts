import { Page } from "electrobun-browser-tools";
import {
  createIsolatedHomeDir,
  createJsonBridgeMetadataParser,
  ensureElectrobunBuilt,
  launchElectrobunApp,
  resolveElectrobunWorkspaceDir,
  withElectrobunApp,
  type LaunchedElectrobunApp,
} from "electrobun-e2e";

const PROJECT_DIR = process.cwd();
const APP_WORKSPACE_DIR = resolveElectrobunWorkspaceDir(PROJECT_DIR);
const FALLBACK_APP_ID = "svvy";
const FALLBACK_APP_READY_PATTERN = /^svvy desktop app started$/;

const parseBridgeMetadata = (() => {
  const parseJsonBridgeMetadata = createJsonBridgeMetadataParser("svvy bridge:");

  return (line: string) => {
    const metadata = parseJsonBridgeMetadata(line);
    if (metadata) {
      return metadata;
    }

    if (FALLBACK_APP_READY_PATTERN.test(line)) {
      return {
        appId: FALLBACK_APP_ID,
        bridgeUrl: null,
      };
    }

    return null;
  };
})();

const BRIDGE_METADATA = {
  metadataLabel: "svvy bridge metadata",
  parseLine: parseBridgeMetadata,
  processLabel: "svvy",
  startupTimeoutMs: 45_000,
} as const;

export const ROOT_WORKSPACE_DIR = APP_WORKSPACE_DIR;
export const PROJECT_ROOT_DIR = PROJECT_DIR;

export type SvvyApp = LaunchedElectrobunApp;

export interface SvvyAppLaunchOptions {
  beforeLaunch?: (context: {
    homeDir: string;
    runtimeEnv: NodeJS.ProcessEnv;
    workspaceDir: string;
  }) => Promise<void> | void;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  workspaceDir?: string;
}

export function ensureBuilt(): Promise<void> {
  return ensureElectrobunBuilt({ projectRoot: PROJECT_DIR });
}

export async function createHomeDir(prefix = "svvy-e2e-home-"): Promise<string> {
  return await createIsolatedHomeDir(prefix);
}

export async function withSvvyApp<T>(
  options: SvvyAppLaunchOptions,
  fn: (app: SvvyApp) => Promise<T>,
): Promise<T>;
export async function withSvvyApp<T>(fn: (app: SvvyApp) => Promise<T>): Promise<T>;
export async function withSvvyApp<T>(
  optionsOrFn: SvvyAppLaunchOptions | ((app: SvvyApp) => Promise<T>),
  maybeFn?: (app: SvvyApp) => Promise<T>,
): Promise<T> {
  const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
  const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
  if (!fn) {
    throw new Error("withSvvyApp requires a test callback.");
  }

  return await withElectrobunApp(createLaunchOptions(options), fn);
}

export async function launchSvvyApp(options: SvvyAppLaunchOptions = {}): Promise<SvvyApp> {
  return await launchElectrobunApp(createLaunchOptions(options));
}

function createLaunchOptions(options: SvvyAppLaunchOptions) {
  const workspaceDir = options.workspaceDir ?? APP_WORKSPACE_DIR;

  return {
    beforeLaunch: options.beforeLaunch,
    bridgeMetadata: BRIDGE_METADATA,
    env: options.env,
    homeDir: options.homeDir,
    projectRoot: PROJECT_DIR,
    ready: async ({ page }: { page: Page }) => {
      await waitForWorkspaceChrome(page);
    },
    retryLabel: "launchSvvyApp",
    workspaceDir,
  } as const;
}

async function waitForWorkspaceChrome(page: Page): Promise<void> {
  const deadline = Date.now() + 40_000;

  while (Date.now() < deadline) {
    try {
      if (await page.getByRole("button", { name: "Open settings" }).isVisible()) {
        return;
      }

      const startupFailed = page.getByText("Startup failed").first();
      if (await startupFailed.isVisible()) {
        const bootstrapText = (await page.locator(".ui-surface").textContent())
          ?.replace(/\s+/g, " ")
          .trim();
        throw new Error(`svvy renderer bootstrap failed: ${bootstrapText ?? "Startup failed"}`);
      }
    } catch (error) {
      if (!isTransientBridgeBootstrapError(error)) {
        throw error;
      }
    }

    await Bun.sleep(100);
  }

  throw new Error("Timed out waiting for svvy workspace chrome.");
}

function isTransientBridgeBootstrapError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("unable to connect. is the computer able to access the url?") ||
    message.includes("bridge request timed out")
  );
}

export function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
