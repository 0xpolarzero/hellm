import { spawnSync } from "node:child_process";

export type ExtensionEnvSecretKey = {
  extensionId: string;
  name: string;
};

export type ExtensionEnvSecretStore = {
  get(key: ExtensionEnvSecretKey): string | undefined;
  has(key: ExtensionEnvSecretKey): boolean;
  set(key: ExtensionEnvSecretKey, value: string): void;
  remove(key: ExtensionEnvSecretKey): void;
};

const KEYCHAIN_SERVICE = "svvy-extension-env";

type SecurityResult = { status: number; stdout: string; stderr: string };
type SecurityRunner = (args: string[], input?: string) => SecurityResult;

export function createMacOsKeychainExtensionEnvSecretStore(
  options: { runSecurity?: SecurityRunner } = {},
): ExtensionEnvSecretStore {
  const run = options.runSecurity ?? runSecurity;
  return {
    get: (key) => {
      const result = run([
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        keychainAccount(key),
        "-w",
      ]);
      if (result.status !== 0) {
        return undefined;
      }
      return result.stdout.replace(/\n$/, "");
    },
    has: (key) => {
      const result = run([
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        keychainAccount(key),
      ]);
      return result.status === 0;
    },
    set: (key, value) => {
      const result = run(
        ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", keychainAccount(key), "-w"],
        `${value}\n`,
      );
      if (result.status !== 0) {
        throw new Error(result.stderr.trim() || "Unable to store extension env secret.");
      }
    },
    remove: (key) => {
      const result = run([
        "delete-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        keychainAccount(key),
      ]);
      if (result.status !== 0 && !/could not be found/i.test(result.stderr)) {
        throw new Error(result.stderr.trim() || "Unable to remove extension env secret.");
      }
    },
  };
}

function keychainAccount(key: ExtensionEnvSecretKey): string {
  return `${key.extensionId}:${key.name}`;
}

function runSecurity(args: string[], input?: string): SecurityResult {
  if (process.platform !== "darwin") {
    throw new Error("Extension env secret storage requires macOS Keychain.");
  }
  const result = spawnSync("/usr/bin/security", args, {
    encoding: "utf8",
    input,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
