import { spawnSync } from "node:child_process";

export interface BunModuleRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runProcess(input: {
  cwd: string;
  args: string[];
  env?: Record<string, string | undefined>;
  stdin?: string;
}): BunModuleRunResult {
  const bunBinary = Bun.which("bun") ?? process.execPath;
  const result = spawnSync(bunBinary, input.args, {
    cwd: input.cwd,
    env: {
      ...process.env,
      ...input.env,
    },
    input: input.stdin,
    encoding: "utf8",
  });

  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function runBunModule(input: {
  entryPath: string;
  cwd: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  stdin?: string;
}): BunModuleRunResult {
  return runProcess({
    cwd: input.cwd,
    args: [input.entryPath, ...(input.args ?? [])],
    env: input.env,
    stdin: input.stdin,
  });
}

export function runBunScript(input: {
  cwd: string;
  script: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  stdin?: string;
}): BunModuleRunResult {
  return runProcess({
    cwd: input.cwd,
    args: ["run", input.script, ...(input.args ?? [])],
    env: input.env,
    stdin: input.stdin,
  });
}

export function runBunCommand(input: {
  cwd: string;
  args: string[];
  env?: Record<string, string | undefined>;
  stdin?: string;
}): BunModuleRunResult {
  return runProcess({
    cwd: input.cwd,
    args: input.args,
    env: input.env,
    stdin: input.stdin,
  });
}
