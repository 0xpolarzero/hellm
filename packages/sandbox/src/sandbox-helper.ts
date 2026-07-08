import { accessSync, constants, statSync } from "node:fs";
import { dirname, join } from "node:path";
export { buildSandboxHelperArgs } from "./sandbox-helper-args";

const HELPER_NAME = "svvy-sandbox-helper";

export function resolveSandboxHelperPath(input: {
  configuredPath?: string;
  executablePath: string;
  candidatePaths?: readonly string[];
}): string {
  if (input.configuredPath) {
    if (isUsableHelperCandidate(input.configuredPath)) {
      return input.configuredPath;
    }
    throw new Error(
      `Managed sandboxing requires executable ${HELPER_NAME} at ${input.configuredPath}.`,
    );
  }

  const candidates = [
    join(dirname(input.executablePath), HELPER_NAME),
    ...(input.candidatePaths ?? []),
  ];

  const existing = candidates.find((candidate) => isUsableHelperCandidate(candidate));
  if (existing) {
    return existing;
  }

  throw new Error(`Managed sandboxing requires packaged ${HELPER_NAME}.`);
}

function isUsableHelperCandidate(candidate: string): boolean {
  try {
    const stat = statSync(candidate);
    if (!stat.isFile()) {
      return false;
    }
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
