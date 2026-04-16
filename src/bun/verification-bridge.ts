import type { StructuredVerificationStatus } from "./structured-session-state";

export const VERIFICATION_KINDS = ["test", "lint", "build", "typecheck", "integration"] as const;

export type VerificationKind = (typeof VERIFICATION_KINDS)[number];
export type VerificationCommand = readonly [string, ...string[]];

export interface VerificationRunnerInput {
  command: VerificationCommand;
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface VerificationRunnerLaunchFailure {
  launched: false;
  error: Error;
}

export interface VerificationRunnerSuccess {
  launched: true;
  exitCode: number;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  signal?: string;
}

export type VerificationRunnerResult = VerificationRunnerLaunchFailure | VerificationRunnerSuccess;

export type VerificationRunner = (
  input: VerificationRunnerInput,
) => Promise<VerificationRunnerResult>;

export interface RunVerificationBridgeInput {
  command: VerificationCommand;
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  runner?: VerificationRunner;
}

export type RunVerificationBridgeResult = VerificationRunnerResult;

export function createBunVerificationRunner(): VerificationRunner {
  return async (input) => {
    let proc: ReturnType<typeof Bun.spawn> | null = null;
    const command = resolveSpawnCommand(input.command);

    try {
      proc = Bun.spawn(command, {
        cwd: input.cwd,
        env: {
          ...process.env,
          ...input.env,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      return {
        launched: false,
        error: toError(error),
      };
    }

    const child = proc;
    const abortHandler = input.signal
      ? () => {
          try {
            child.kill();
          } catch {
            // The process may already be gone.
          }
        }
      : null;

    if (input.signal) {
      if (abortHandler && input.signal.aborted) {
        abortHandler();
      } else {
        input.signal.addEventListener("abort", abortHandler!, { once: true });
      }
    }

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        child.stdout instanceof ReadableStream
          ? new Response(child.stdout).text()
          : Promise.resolve(""),
        child.stderr instanceof ReadableStream
          ? new Response(child.stderr).text()
          : Promise.resolve(""),
        child.exited,
      ]);

      return {
        launched: true,
        exitCode,
        stdout,
        stderr,
        cancelled: input.signal?.aborted ?? false,
        signal: input.signal?.aborted ? "SIGTERM" : undefined,
      };
    } finally {
      if (input.signal && abortHandler) {
        input.signal.removeEventListener("abort", abortHandler);
      }
    }
  };
}

export async function runVerificationBridge(
  input: RunVerificationBridgeInput,
): Promise<RunVerificationBridgeResult> {
  const runner = input.runner ?? createBunVerificationRunner();
  return runner({
    command: input.command,
    cwd: input.cwd,
    env: input.env,
    signal: input.signal,
  });
}

export function buildVerificationSummary(
  kind: VerificationKind,
  status: StructuredVerificationStatus,
  exitCode: number,
): string {
  switch (status) {
    case "passed":
      return `${kind} verification passed.`;
    case "failed":
      return `${kind} verification failed (exit ${exitCode}).`;
    case "cancelled":
      return `${kind} verification cancelled.`;
  }
}

export function formatVerificationBody(input: {
  kind: VerificationKind;
  command: string;
  status: StructuredVerificationStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  launched: boolean;
  cancelled?: boolean;
  signal?: string;
}): string {
  const parts = [
    `kind: ${input.kind}`,
    `command: ${input.command}`,
    `status: ${input.status}`,
    `launched: ${input.launched ? "yes" : "no"}`,
  ];

  if (input.exitCode !== null) {
    parts.push(`exitCode: ${input.exitCode}`);
  }

  if (input.cancelled) {
    parts.push("cancelled: yes");
  }

  if (input.signal) {
    parts.push(`signal: ${input.signal}`);
  }

  parts.push(
    "",
    "stdout:",
    input.stdout.trim() ? input.stdout.trimEnd() : "<empty>",
    "",
    "stderr:",
    input.stderr.trim() ? input.stderr.trimEnd() : "<empty>",
  );

  return parts.join("\n");
}

export function displayCommand(command: VerificationCommand): string {
  return command.join(" ");
}

function resolveSpawnCommand(command: VerificationCommand): string[] {
  const [binary, ...args] = command;
  return [binary === "bun" ? process.execPath : binary, ...args];
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  return new Error(typeof value === "string" ? value : "Verification runner failed.");
}
