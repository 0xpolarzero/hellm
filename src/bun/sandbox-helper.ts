import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FileSystemSandboxPolicy } from "./filesystem-sandbox-policy";

const HELPER_NAME = "svvy-sandbox-helper";

export function resolveSandboxHelperPath(): string {
  const configured = process.env.SVVY_SANDBOX_HELPER_PATH;
  if (configured) {
    if (existsSync(configured)) {
      return configured;
    }
    throw new Error(`Managed sandboxing requires existing ${HELPER_NAME} at ${configured}.`);
  }

  const candidates = [
    join(dirname(process.execPath), HELPER_NAME),
    join(process.cwd(), "build", "native", HELPER_NAME),
    join(import.meta.dir, "..", "..", "build", "native", HELPER_NAME),
  ];

  const existing = candidates.find((candidate) => existsSync(candidate));
  if (existing) {
    return existing;
  }

  throw new Error(`Managed sandboxing requires packaged ${HELPER_NAME}.`);
}

export function buildSandboxHelperArgs(input: {
  command: readonly string[];
  cwd: string;
  fileSystemPolicy: FileSystemSandboxPolicy;
  includePlatformDefaults?: boolean;
  networkAccess: boolean;
}): string[] {
  const args = [
    "--cwd",
    input.cwd,
    "--fs-kind",
    input.fileSystemPolicy.kind,
    "--network",
    input.networkAccess ? "enabled" : "restricted",
  ];
  if (input.includePlatformDefaults === true) {
    args.push("--include-platform-defaults");
  }
  for (const entry of input.fileSystemPolicy.entries) {
    args.push("--entry", entry.access, entry.path, entry.protectedMetadataNames?.join(",") ?? "");
  }
  args.push("--", ...input.command);
  return args;
}
