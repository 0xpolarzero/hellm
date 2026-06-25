export type SandboxDenialInput = {
  exitCode: number | null;
  managedSandbox: boolean;
  stderr: string;
  stdout: string;
};

export type SandboxDenialFacts = {
  sandboxDenied: true;
  sandboxEngine: "macos-seatbelt";
};

export function sandboxDenialFacts(input: SandboxDenialInput): SandboxDenialFacts | {} {
  if (!isSandboxDenialOutput(input)) {
    return {};
  }
  return {
    sandboxDenied: true,
    sandboxEngine: "macos-seatbelt",
  };
}

export function isSandboxDenialOutput(input: SandboxDenialInput): boolean {
  if (!input.managedSandbox || input.exitCode === 0 || input.exitCode === 127) {
    return false;
  }
  const combined = joinOutput(input);
  const normalized = combined.toLowerCase();
  if (!hasSandboxHelperOriginMarker(combined)) {
    return false;
  }
  if (/\b(command not found|parse error|syntax error)\b/.test(normalized)) {
    return false;
  }
  return (
    normalized.includes("sandbox-exec: sandbox_apply:") ||
    normalized.includes("operation not permitted") ||
    normalized.includes("permission denied") ||
    normalized.includes("read-only file system") ||
    normalized.includes("failed to write file") ||
    normalized.includes("deny(")
  );
}

export function isSandboxHelperBootstrapFailure(output: string): boolean {
  return output.toLowerCase().includes("sandbox-exec: sandbox_apply:");
}

function joinOutput(input: { stderr: string; stdout: string }): string {
  return `${input.stdout}\n${input.stderr}`;
}

function hasSandboxHelperOriginMarker(output: string): boolean {
  return output.includes("sandbox-exec:") || /^Sandbox:/m.test(output);
}
