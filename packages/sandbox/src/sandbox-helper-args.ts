import type { FileSystemSandboxPolicy } from "./filesystem-sandbox-policy";

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
    args.push(
      "--entry",
      entry.access,
      entry.path,
      entry.recursive === false ? "false" : "true",
      entry.protectedMetadataNames?.join(",") ?? "",
    );
  }
  args.push("--", ...input.command);
  return args;
}
