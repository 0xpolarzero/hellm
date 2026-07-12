import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AbsolutePath } from "@svvy/core";

export interface ResolvePackagedExtensionTemplatesRootOptions {
  readonly explicitRoot?: string;
  readonly cwd?: string;
  readonly executablePath?: string;
  readonly moduleDirectory?: string;
}

export function resolvePackagedExtensionTemplatesRoot(
  options: ResolvePackagedExtensionTemplatesRootOptions = {},
): AbsolutePath {
  const cwd = options.cwd ?? process.cwd();
  const executablePath = options.executablePath ?? process.execPath;
  const moduleDirectory = options.moduleDirectory ?? import.meta.dir;
  const candidates = [
    options.explicitRoot,
    join(dirname(executablePath), "generated", "extensions", "builtin"),
    join(dirname(executablePath), "..", "MacOS", "generated", "extensions", "builtin"),
    resolve(moduleDirectory, "..", "..", "packages", "extensions", "src", "builtin"),
    resolve(cwd, "packages", "extensions", "src", "builtin"),
  ].filter((candidate): candidate is string => typeof candidate === "string");
  const uniqueCandidates = new Set(candidates);

  for (const candidate of uniqueCandidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return resolve(candidate) as AbsolutePath;
    }
  }

  throw new Error(
    `Packaged extension templates are unavailable. Checked: ${Array.from(uniqueCandidates).join(", ")}`,
  );
}
