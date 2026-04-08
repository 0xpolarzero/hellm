import { spawnSync } from "node:child_process";

export interface BunModuleRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runBunModule(input: {
  entryPath: string;
  cwd: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  stdin?: string;
}): BunModuleRunResult {
  const bunBinary = Bun.which("bun") ?? process.execPath;
  const result = spawnSync(bunBinary, [input.entryPath, ...(input.args ?? [])], {
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
