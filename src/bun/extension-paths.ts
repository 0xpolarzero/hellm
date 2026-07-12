import { join, resolve } from "node:path";
import { homedir } from "node:os";

export function extensionsRootForAgentDir(agentDir: string): string {
  return resolve(join(agentDir, "extensions"));
}

export function workflowsSourceRoot(): string {
  return join(homedir(), ".config", "svvy", "workflows");
}

export function workflowsGeneratedPackagePath(): string {
  return join(workflowsSourceRoot(), "generated", "package");
}

export function extensionsGeneratedPackagePath(
  options: {
    extensionsGeneratedPackagePath?: string;
    extensionsRoot?: string;
    generatedPackagePath?: string;
  } = {},
): string {
  if (options.extensionsGeneratedPackagePath) return options.extensionsGeneratedPackagePath;
  if (options.extensionsRoot) return join(options.extensionsRoot, "generated", "package");
  if (options.generatedPackagePath) {
    return join(resolve(options.generatedPackagePath, ".."), "extensions-package");
  }
  return join(homedir(), ".config", "svvy", "extensions", "generated", "package");
}
