import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export type GeneratedCoreTypeContractPackageFile = {
  readonly relativePath: string;
  readonly contents: string;
};

export function getCoreTypeContractPackagePath(): string {
  return join(homedir(), ".config", "svvy", "generated", "core-type-contract-package");
}

export function renderGeneratedCoreTypeContractPackageFiles(): readonly GeneratedCoreTypeContractPackageFile[] {
  return [
    {
      relativePath: "package.json",
      contents: JSON.stringify(
        {
          name: "@svvy/core",
          private: true,
          type: "module",
          types: "./index.d.ts",
          exports: {
            ".": {
              types: "./index.d.ts",
            },
          },
        },
        null,
        2,
      ),
    },
    {
      relativePath: "index.d.ts",
      contents: [
        'export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";',
        "export interface ReasoningSelection {",
        "  effort: ReasoningEffort;",
        "}",
        "",
        'export type ExtensionUsageState = "loaded" | "available" | "unavailable";',
        "",
        "export type SmithersObservedJson =",
        "  | null",
        "  | boolean",
        "  | number",
        "  | string",
        "  | readonly SmithersObservedJson[]",
        "  | { readonly [key: string]: SmithersObservedJson };",
        "",
        "export interface RunTaskAgentMessage {",
        '  role: "user" | "assistant";',
        "  text: string;",
        "}",
        "",
        'export type RunTaskAgentOperation = "runTaskAgent";',
        "",
        "export interface TaskAgentParametersSource {",
        "  id: string;",
        "  label: string;",
        "  provider: string;",
        "  model: string;",
        "  reasoning: ReasoningSelection;",
        "  instructions: string;",
        "  overrides?: Partial<Record<string, ExtensionUsageState>>;",
        "}",
        "",
        "export interface SmithersTaskSourceContextSnapshot {",
        "  run?: SmithersObservedJson;",
        "  node?: SmithersObservedJson;",
        "  rootDir?: string;",
        "}",
        "",
        "export interface SmithersTaskAttemptIdentity {",
        "  runId: string;",
        "  nodeId: string;",
        "  iteration: number;",
        "  attempt: number;",
        "}",
        "",
        "export type RunTaskAgentPromptSource =",
        '  | { kind: "prompt"; prompt: string }',
        '  | { kind: "messages"; messages: readonly RunTaskAgentMessage[] };',
        "",
        "export interface RunTaskAgentSourceInput {",
        "  operation: RunTaskAgentOperation;",
        "  bridgeRequestId?: string;",
        "  agent: TaskAgentParametersSource;",
        "  taskIdentity: SmithersTaskAttemptIdentity;",
        "  smithersContext?: SmithersTaskSourceContextSnapshot;",
        "  promptSource: RunTaskAgentPromptSource;",
        "  workspaceSessionId: string;",
        "  sourceCommandId: string;",
        "}",
        "",
        "export interface RunTaskAgentResult {",
        "  text: string;",
        "  usage?: SmithersObservedJson;",
        "  output?: SmithersObservedJson;",
        "}",
        "",
        "export type RunTaskAgentErrorCode =",
        '  | "unauthorized"',
        '  | "forbidden"',
        '  | "invalid_request"',
        '  | "payload_too_large"',
        '  | "bridge_request_conflict"',
        '  | "source_command_not_found"',
        '  | "source_command_not_handler_owned"',
        '  | "source_command_terminal"',
        '  | "task_attempt_cancelled"',
        '  | "task_attempt_failed";',
        "",
        "export interface RunTaskAgentError {",
        "  error: RunTaskAgentErrorCode;",
        "  message: string;",
        "  retryable: boolean;",
        "  requestId?: string;",
        "  workspaceSessionId?: string;",
        "  sourceCommandId?: string;",
        "  taskAttemptId?: string;",
        "}",
        "",
      ].join("\n"),
    },
  ];
}

export function materializeGeneratedCoreTypeContractPackage(packageRoot: string): void {
  replaceDirectory(packageRoot, renderGeneratedCoreTypeContractPackageFiles());
}

function replaceDirectory(
  packageRoot: string,
  files: readonly GeneratedCoreTypeContractPackageFile[],
): void {
  const parentPath = dirname(packageRoot);
  mkdirSync(parentPath, { recursive: true });
  const tempPath = mkdtempSync(join(parentPath, `.svvy-${basename(packageRoot)}-`));
  const backupPath = `${tempPath}.previous`;
  let tempMoved = false;
  try {
    for (const file of files) {
      validateRelativePath(file.relativePath);
      const targetPath = join(tempPath, file.relativePath);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, file.contents);
    }
    try {
      renameSync(packageRoot, backupPath);
    } catch {
      // No live directory to preserve.
    }
    renameSync(tempPath, packageRoot);
    tempMoved = true;
    rmSync(backupPath, { force: true, recursive: true });
  } catch (error) {
    if (tempMoved) {
      throw error;
    }
    rmSync(tempPath, { force: true, recursive: true });
    try {
      renameSync(backupPath, packageRoot);
    } catch {
      // If backup restore is unnecessary or impossible, surface the original failure.
    }
    throw error;
  }
}

function validateRelativePath(relativePath: string): void {
  const segments = relativePath.split(/[\\/]+/u);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(relativePath) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`Generated core type-contract file path must be relative: ${relativePath}`);
  }
}
