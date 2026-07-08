import type { RuntimeSourceWatchInput } from "@svvy/runtime/bootstrap";

export interface ExternalInstructionRootInput {
  enabled: boolean;
  path: string;
}

export interface ExternalInstructionsWatchSettings {
  globalRoots?: readonly ExternalInstructionRootInput[];
}

interface SourceWatchPathHost {
  homeDir: string;
  path: {
    dirname(path: string): string;
    join(...parts: string[]): string;
    resolve(path: string): string;
  };
}

export function buildAppGlobalSourceWatchInputs(input: {
  extensionsRoot: string;
  host: Pick<SourceWatchPathHost, "path">;
  workflowsSourceRoot: string;
}): RuntimeSourceWatchInput[] {
  const { host } = input;
  return [
    ...["agents", "prompts", "components", "workflows"].map(
      (directory): RuntimeSourceWatchInput => ({
        domain: "workflows",
        kind: "directory",
        path: host.path.join(input.workflowsSourceRoot, directory),
        recursive: true,
      }),
    ),
    {
      domain: "extensions",
      fingerprintChildDirectories: true,
      kind: "directory",
      path: host.path.join(input.extensionsRoot, "sources", "user"),
      recursive: true,
    },
    {
      domain: "extensions",
      fingerprintChildDirectories: true,
      kind: "directory",
      path: host.path.join(input.extensionsRoot, "sources", "builtin"),
      recursive: true,
    },
    {
      domain: "extensions",
      kind: "file",
      path: host.path.join(input.extensionsRoot, "package", "package.json"),
    },
  ];
}

export function buildWorkspaceSourceWatchInputs(input: {
  cwd: string;
  externalInstructions?: ExternalInstructionsWatchSettings;
  host: SourceWatchPathHost;
}): RuntimeSourceWatchInput[] {
  const { host } = input;
  return [
    {
      domain: "host_snippets",
      kind: "directory",
      path: host.path.join(host.homeDir, ".claude", "commands"),
      recursive: true,
      includeExtensions: [".md"],
    },
    {
      domain: "host_snippets",
      kind: "directory",
      path: host.path.join(host.homeDir, ".pi", "agent", "prompts"),
      includeExtensions: [".md"],
    },
    {
      domain: "host_snippets",
      kind: "directory",
      path: host.path.join(input.cwd, ".claude", "commands"),
      recursive: true,
      includeExtensions: [".md"],
    },
    {
      domain: "host_snippets",
      kind: "directory",
      path: host.path.join(input.cwd, ".pi", "prompts"),
      includeExtensions: [".md"],
    },
    ...externalInstructionInputs(input.cwd, input.externalInstructions, host),
  ];
}

function externalInstructionInputs(
  cwd: string,
  settings: ExternalInstructionsWatchSettings | undefined,
  host: SourceWatchPathHost,
): RuntimeSourceWatchInput[] {
  const inputs: RuntimeSourceWatchInput[] = [];
  const globalRoots = settings?.globalRoots ?? [];
  for (const root of globalRoots) {
    if (!root.enabled) continue;
    inputs.push(...externalInstructionDirectoryInputs(root.path, host));
  }
  let current = host.path.resolve(cwd);
  while (true) {
    inputs.push(...externalInstructionDirectoryInputs(current, host));
    const parent = host.path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return inputs;
}

function externalInstructionDirectoryInputs(
  directory: string,
  host: SourceWatchPathHost,
): RuntimeSourceWatchInput[] {
  return ["AGENTS.md", "CLAUDE.md"].map((fileName) => ({
    domain: "external_instructions",
    kind: "file",
    path: host.path.join(expandHome(directory, host), fileName),
    watchWhenMissing: false,
  }));
}

function expandHome(path: string, host: SourceWatchPathHost): string {
  return path === "~" || path.startsWith("~/") ? host.path.join(host.homeDir, path.slice(2)) : path;
}
