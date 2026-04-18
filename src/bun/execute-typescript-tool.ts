import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "@sinclair/typebox";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { inspect } from "node:util";
import * as ts from "typescript";
import { EXECUTE_TYPESCRIPT_API_DECLARATION } from "./generated/execute-typescript-api.generated";
import type {
  GitCommitSummary,
  GitFileChange,
  RepoGrepMatch,
  RepoStat,
  SvvyApi,
  SvvyConsole,
  WebFetchTextResult,
  WebSearchResult,
} from "./execute-typescript-api-contract";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type {
  StructuredCommandExecutor,
  StructuredCommandVisibility,
  StructuredEpisodeKind,
  StructuredSessionStateStore,
} from "./structured-session-state";

export const EXECUTE_TYPESCRIPT_TOOL_NAME = "execute_typescript";

export type StructuredDiagnostic = {
  severity: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
};

export type ExecuteTypescriptInput = {
  typescriptCode: string;
};

export type ExecuteTypescriptResult = {
  success: boolean;
  result?: unknown;
  logs?: string[];
  error?: {
    message: string;
    name?: string;
    stage?: "compile" | "typecheck" | "runtime";
    diagnostics?: StructuredDiagnostic[];
    line?: number;
  };
};

export type ExecuteTypescriptRunCommandInput = {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
};

export type ExecuteTypescriptRunCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ExecuteTypescriptWebSearchResult = WebSearchResult;

export type ExecuteTypescriptWebFetchResult = WebFetchTextResult;

export const executeTypescriptParamsSchema = Type.Object(
  {
    typescriptCode: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ExecuteTypescriptParams = Static<typeof executeTypescriptParamsSchema>;

const EXECUTE_TYPESCRIPT_DESCRIPTION = [
  "Run a bounded TypeScript program against the injected typed api.* host SDK.",
  "Use this as the default generic work surface for ordinary repository, git, web, artifact, and explicit api.exec.run work.",
  "Inside the snippet, use the injected api object instead of Node.js built-ins such as fs, path, process, or node:* imports.",
  "The runtime persists the submitted snippet before execution, typechecks before running, and records nested api.* calls as child commands.",
].join(" ");

const EXECUTE_TYPESCRIPT_SUMMARY = "Execute bounded TypeScript against the injected api.* SDK.";
const API_DECLARATIONS_FILE = "svvy-api.d.ts";
const SOURCE_FILE = "execute-typescript.ts";
const WRAPPER_PREFIX = "export default async function __svvy(api: SvvyApi, console: SvvyConsole) {";
const WRAPPER_SUFFIX = "}";
const WRAPPER_LINE_OFFSET = 1;

type ExecuteTypescriptContext = {
  sessionId: string;
  turnId: string;
  threadId: string;
  promptText: string;
  rootEpisodeKind: StructuredEpisodeKind;
  executor?: StructuredCommandExecutor;
  visibility?: StructuredCommandVisibility;
};

type ExecuteTypescriptToolOptions = {
  cwd: string;
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
  runCommand?: (
    input: ExecuteTypescriptRunCommandInput,
  ) => Promise<ExecuteTypescriptRunCommandResult>;
  webSearch?: (input: {
    query: string;
    maxResults?: number;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebSearchResult>;
  fetchText?: (input: {
    url: string;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebFetchResult>;
};

type ExecuteTypescriptRepoStat = RepoStat;
type ExecuteTypescriptRepoGrepMatch = RepoGrepMatch;
type ExecuteTypescriptGitFileChange = GitFileChange;
type ExecuteTypescriptGitCommitSummary = GitCommitSummary;
type ExecuteTypescriptApi = SvvyApi;

type ExecuteTypescriptCommandFacts = Record<string, unknown>;

type ExecuteTypescriptChildActivity = {
  toolName: string;
  visibility: StructuredCommandVisibility;
  status: "succeeded" | "failed";
  summary: string;
  facts: ExecuteTypescriptCommandFacts | null;
};

type ExecuteTypescriptChildCallResult<T> = {
  value: T;
  summary?: string;
  facts?: ExecuteTypescriptCommandFacts | null;
  status?: "succeeded" | "failed";
  error?: string | null;
  visibility?: StructuredCommandVisibility;
};

export function createExecuteTypescriptTool(
  options: ExecuteTypescriptToolOptions,
): AgentTool<typeof executeTypescriptParamsSchema, ExecuteTypescriptResult> {
  return {
    label: "Code Mode",
    name: EXECUTE_TYPESCRIPT_TOOL_NAME,
    description: EXECUTE_TYPESCRIPT_DESCRIPTION,
    parameters: executeTypescriptParamsSchema,
    execute: async (_toolCallId, params, signal) => {
      const runtime = options.runtime.current;
      if (!runtime) {
        throw new Error(`${EXECUTE_TYPESCRIPT_TOOL_NAME} can only run during an active prompt.`);
      }

      const result = await runExecuteTypescript({
        cwd: options.cwd,
        store: options.store,
        signal,
        typescriptCode: params.typescriptCode,
        context: {
          sessionId: runtime.sessionId,
          turnId: runtime.turnId,
          threadId: runtime.rootThreadId,
          promptText: runtime.promptText,
          rootEpisodeKind: runtime.rootEpisodeKind,
        },
        runCommand: options.runCommand,
        webSearch: options.webSearch,
        fetchText: options.fetchText,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
        details: result,
      };
    },
  };
}

async function runExecuteTypescript(input: {
  cwd: string;
  store: StructuredSessionStateStore;
  signal?: AbortSignal;
  typescriptCode: string;
  context: ExecuteTypescriptContext;
  runCommand?: (
    input: ExecuteTypescriptRunCommandInput,
  ) => Promise<ExecuteTypescriptRunCommandResult>;
  webSearch?: (input: {
    query: string;
    maxResults?: number;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebSearchResult>;
  fetchText?: (input: {
    url: string;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebFetchResult>;
}): Promise<ExecuteTypescriptResult> {
  const parentCommand = input.store.createCommand({
    turnId: input.context.turnId,
    threadId: input.context.threadId,
    toolName: EXECUTE_TYPESCRIPT_TOOL_NAME,
    executor: input.context.executor ?? "orchestrator",
    visibility: input.context.visibility ?? "summary",
    title: "Run execute_typescript",
    summary: EXECUTE_TYPESCRIPT_SUMMARY,
  });
  input.store.startCommand(parentCommand.id);
  const snippetArtifact = input.store.createArtifact({
    sourceCommandId: parentCommand.id,
    kind: "text",
    name: "execute-typescript.ts",
    content: input.typescriptCode,
  });

  const preflight = compileAndTypecheck(input.typescriptCode);
  if (preflight.errors.length > 0) {
    const diagnosticsArtifact = input.store.createArtifact({
      sourceCommandId: parentCommand.id,
      kind: "json",
      name: "execute-typescript.diagnostics.json",
      content: JSON.stringify(preflight.errors, null, 2),
    });
    const errorMessage = preflight.errors[0]?.message ?? "Static diagnostics blocked execution.";
    input.store.finishCommand({
      commandId: parentCommand.id,
      status: "failed",
      summary: errorMessage,
      facts: {
        diagnosticsCount: preflight.errors.length,
        snippetArtifactId: snippetArtifact.id,
        diagnosticsArtifactId: diagnosticsArtifact.id,
      },
      error: errorMessage,
    });
    const result: ExecuteTypescriptResult = {
      success: false,
      error: {
        message: errorMessage,
        stage: preflight.stage,
        diagnostics: preflight.errors,
      },
    };
    createResultEpisode({
      store: input.store,
      threadId: input.context.threadId,
      sourceCommandId: parentCommand.id,
      kind: "analysis",
      result,
      promptText: input.context.promptText,
      rootEpisodeKind: input.context.rootEpisodeKind,
    });
    return result;
  }

  const logs: string[] = [];
  const childActivity: ExecuteTypescriptChildActivity[] = [];
  try {
    const api = createExecuteTypescriptApi({
      cwd: input.cwd,
      store: input.store,
      turnId: input.context.turnId,
      threadId: input.context.threadId,
      parentCommandId: parentCommand.id,
      signal: input.signal,
      runCommand: input.runCommand ?? defaultRunCommand,
      webSearch: input.webSearch ?? defaultWebSearch,
      fetchText: input.fetchText ?? defaultFetchText,
      recordChildActivity(activity) {
        childActivity.push(activity);
      },
    });
    const resultValue = await runCompiledSnippet(preflight.javascript, api, logs);
    const logsArtifact =
      logs.length > 0
        ? input.store.createArtifact({
            sourceCommandId: parentCommand.id,
            kind: "log",
            name: "execute-typescript.logs.log",
            content: logs.join("\n"),
          })
        : null;
    const parentRollup = buildExecuteTypescriptParentRollup({
      childActivity,
      snippetArtifactId: snippetArtifact.id,
      logsArtifactId: logsArtifact?.id,
    });
    input.store.finishCommand({
      commandId: parentCommand.id,
      status: "succeeded",
      summary: parentRollup.summary ?? summarizeResult(resultValue),
      facts: parentRollup.facts,
    });

    const result: ExecuteTypescriptResult = {
      success: true,
      result: resultValue,
      logs: logs.length > 0 ? logs : undefined,
    };
    createResultEpisode({
      store: input.store,
      threadId: input.context.threadId,
      sourceCommandId: parentCommand.id,
      kind: input.context.rootEpisodeKind,
      result,
      promptText: input.context.promptText,
      rootEpisodeKind: input.context.rootEpisodeKind,
    });
    return result;
  } catch (error) {
    const logsArtifact =
      logs.length > 0
        ? input.store.createArtifact({
            sourceCommandId: parentCommand.id,
            kind: "log",
            name: "execute-typescript.logs.log",
            content: logs.join("\n"),
          })
        : null;
    const message =
      error instanceof Error ? error.message : "execute_typescript failed at runtime.";
    const parentRollup = buildExecuteTypescriptParentRollup({
      childActivity,
      snippetArtifactId: snippetArtifact.id,
      logsArtifactId: logsArtifact?.id,
    });
    input.store.finishCommand({
      commandId: parentCommand.id,
      status: "failed",
      summary: message,
      facts: parentRollup.facts,
      error: message,
    });
    const result: ExecuteTypescriptResult = {
      success: false,
      logs: logs.length > 0 ? logs : undefined,
      error: {
        message,
        name: error instanceof Error ? error.name : undefined,
        stage: "runtime",
        line: getRuntimeErrorLine(error),
      },
    };
    createResultEpisode({
      store: input.store,
      threadId: input.context.threadId,
      sourceCommandId: parentCommand.id,
      kind: "analysis",
      result,
      promptText: input.context.promptText,
      rootEpisodeKind: input.context.rootEpisodeKind,
    });
    return result;
  }
}

function createResultEpisode(input: {
  store: StructuredSessionStateStore;
  threadId: string;
  sourceCommandId: string;
  kind: StructuredEpisodeKind;
  result: ExecuteTypescriptResult;
  promptText: string;
  rootEpisodeKind: StructuredEpisodeKind;
}): void {
  const title = input.result.success
    ? summarizePrompt(input.promptText)
    : "execute_typescript failed";
  const summary = input.result.success
    ? summarizeResult(input.result.result)
    : (input.result.error?.message ?? "execute_typescript failed.");
  const body = input.result.success
    ? JSON.stringify(
        {
          success: true,
          result: input.result.result ?? null,
          logs: input.result.logs ?? [],
        },
        null,
        2,
      )
    : JSON.stringify(
        {
          success: false,
          error: input.result.error ?? null,
          logs: input.result.logs ?? [],
        },
        null,
        2,
      );

  input.store.createEpisode({
    threadId: null,
    sourceCommandId: input.sourceCommandId,
    kind: input.result.success ? input.kind : "analysis",
    title,
    summary,
    body,
  });
}

function compileAndTypecheck(typescriptCode: string): {
  javascript: string;
  errors: StructuredDiagnostic[];
  warnings: StructuredDiagnostic[];
  stage: "compile" | "typecheck";
} {
  const wrappedSource = [WRAPPER_PREFIX, typescriptCode, WRAPPER_SUFFIX].join("\n");
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    lib: ["lib.es2022.d.ts"],
  };
  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const sourceFiles = new Map<string, string>([
    [SOURCE_FILE, wrappedSource],
    [API_DECLARATIONS_FILE, EXECUTE_TYPESCRIPT_API_DECLARATION],
  ]);

  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists(fileName) {
      return sourceFiles.has(fileName) || defaultHost.fileExists(fileName);
    },
    readFile(fileName) {
      return sourceFiles.get(fileName) ?? defaultHost.readFile(fileName);
    },
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      const contents = sourceFiles.get(fileName);
      if (contents !== undefined) {
        return ts.createSourceFile(fileName, contents, languageVersion, true);
      }
      return defaultHost.getSourceFile(
        fileName,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
    },
    writeFile() {},
  };

  const program = ts.createProgram([SOURCE_FILE, API_DECLARATIONS_FILE], compilerOptions, host);
  const syntactic = program
    .getSyntacticDiagnostics(program.getSourceFile(SOURCE_FILE))
    .map((diagnostic) => mapDiagnostic(diagnostic));
  const semantic = program
    .getSemanticDiagnostics(program.getSourceFile(SOURCE_FILE))
    .map((diagnostic) => mapDiagnostic(diagnostic));
  const optionsDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName !== SOURCE_FILE)
    .map((diagnostic) => mapDiagnostic(diagnostic));
  const diagnostics = [...syntactic, ...semantic, ...optionsDiagnostics];
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const stage = syntactic.some((diagnostic) => diagnostic.severity === "error")
    ? "compile"
    : "typecheck";

  const javascript = ts.transpileModule(wrappedSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    fileName: SOURCE_FILE,
  }).outputText;

  return {
    javascript,
    errors,
    warnings,
    stage,
  };
}

function mapDiagnostic(diagnostic: ts.Diagnostic): StructuredDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const severity = diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "error";
  let line: number | undefined;
  let column: number | undefined;
  if (diagnostic.file && diagnostic.start !== undefined) {
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    line = Math.max(position.line + 1 - WRAPPER_LINE_OFFSET, 1);
    column = position.character + 1;
  }

  return {
    severity,
    message,
    file: diagnostic.file ? basename(diagnostic.file.fileName) : undefined,
    line,
    column,
    code: diagnostic.code ? String(diagnostic.code) : undefined,
  };
}

async function runCompiledSnippet(
  javascript: string,
  api: ExecuteTypescriptApi,
  logs: string[],
): Promise<unknown> {
  type CompiledSnippetModuleExports = {
    default?: (api: ExecuteTypescriptApi, console: SvvyConsole) => Promise<unknown>;
  };
  type CompiledSnippetModule = {
    exports: CompiledSnippetModuleExports;
  };
  const module: CompiledSnippetModule = {
    exports: {},
  };
  const execute = new Function("module", "exports", javascript) as (
    module: CompiledSnippetModule,
    exports: CompiledSnippetModuleExports,
  ) => void;
  execute(module, module.exports);
  if (typeof module.exports.default !== "function") {
    throw new Error("execute_typescript did not produce an executable function.");
  }
  return await module.exports.default(api, createCapturedConsole(logs));
}

function createCapturedConsole(logs: string[]): SvvyConsole {
  const append = (...args: unknown[]) => {
    logs.push(args.map(formatConsoleValue).join(" "));
  };
  return {
    log: append,
    info: append,
    warn: append,
    error: append,
  };
}

function formatConsoleValue(value: unknown): string {
  return typeof value === "string" ? value : inspect(value, { depth: 5, breakLength: Infinity });
}

function createExecuteTypescriptApi(input: {
  cwd: string;
  store: StructuredSessionStateStore;
  turnId: string;
  threadId: string;
  parentCommandId: string;
  signal?: AbortSignal;
  runCommand: (
    input: ExecuteTypescriptRunCommandInput,
  ) => Promise<ExecuteTypescriptRunCommandResult>;
  webSearch: (input: {
    query: string;
    maxResults?: number;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebSearchResult>;
  fetchText: (input: {
    url: string;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebFetchResult>;
  recordChildActivity: (activity: ExecuteTypescriptChildActivity) => void;
}): ExecuteTypescriptApi {
  const call = async <T>(config: {
    toolName: string;
    title: string;
    summary: string;
    visibility?: StructuredCommandVisibility;
    run: (commandId: string) => Promise<ExecuteTypescriptChildCallResult<T>>;
  }): Promise<T> => {
    const command = input.store.createCommand({
      turnId: input.turnId,
      threadId: input.threadId,
      parentCommandId: input.parentCommandId,
      toolName: config.toolName,
      executor: "execute_typescript",
      visibility: config.visibility ?? "trace",
      title: config.title,
      summary: config.summary,
    });
    input.store.startCommand(command.id);
    try {
      const outcome = await config.run(command.id);
      const status = outcome.status ?? "succeeded";
      const visibility = outcome.visibility ?? config.visibility ?? "trace";
      const summary =
        outcome.summary ?? `${config.toolName} ${status === "succeeded" ? "succeeded" : "failed"}.`;
      const error = status === "failed" ? (outcome.error ?? summary) : null;
      input.store.finishCommand({
        commandId: command.id,
        status,
        visibility,
        summary,
        facts: outcome.facts ?? null,
        error,
      });
      input.recordChildActivity({
        toolName: config.toolName,
        visibility,
        status,
        summary,
        facts: outcome.facts ?? null,
      });
      return outcome.value;
    } catch (error) {
      const message = error instanceof Error ? error.message : `${config.toolName} failed.`;
      input.store.finishCommand({
        commandId: command.id,
        status: "failed",
        visibility: "summary",
        summary: message,
        error: message,
      });
      input.recordChildActivity({
        toolName: config.toolName,
        visibility: "summary",
        status: "failed",
        summary: message,
        facts: null,
      });
      throw error;
    }
  };

  const runGit = async (args: string[]): Promise<ExecuteTypescriptRunCommandResult> =>
    await input.runCommand({
      command: "git",
      args,
      cwd: input.cwd,
      signal: input.signal,
    });

  return {
    repo: {
      readFile: (params) =>
        call({
          toolName: "repo.readFile",
          title: "Read file",
          summary: `Read ${params.path}`,
          run: async () => {
            const filePath = resolveWorkspacePath(input.cwd, params.path);
            const path = normalizeWorkspaceRelativePath(input.cwd, filePath);
            const text = readFileSync(filePath, "utf8");
            return {
              value: { path, text },
              facts: { path, bytesRead: byteLength(text) },
              summary: `Read ${path}.`,
            };
          },
        }),
      readFiles: (params) =>
        call({
          toolName: "repo.readFiles",
          title: "Read files",
          summary: `Read ${params.paths.length} files`,
          run: async () => {
            const files = params.paths.map((path) => {
              const filePath = resolveWorkspacePath(input.cwd, path);
              const text = readFileSync(filePath, "utf8");
              return {
                path: normalizeWorkspaceRelativePath(input.cwd, filePath),
                text,
              };
            });
            return {
              value: { files },
              facts: {
                paths: files.map((file) => file.path),
                fileCount: files.length,
                totalBytesRead: files.reduce((total, file) => total + byteLength(file.text), 0),
              },
              summary: `Read ${pluralize(files.length, "file")}.`,
            };
          },
        }),
      readJson: <T>(params: { path: string }) =>
        call({
          toolName: "repo.readJson",
          title: "Read JSON",
          summary: `Read JSON from ${params.path}`,
          run: async () => {
            const filePath = resolveWorkspacePath(input.cwd, params.path);
            const path = normalizeWorkspaceRelativePath(input.cwd, filePath);
            return {
              value: {
                path,
                value: JSON.parse(readFileSync(filePath, "utf8")) as T,
              },
              facts: { path },
              summary: `Read JSON from ${path}.`,
            };
          },
        }),
      writeFile: (params) =>
        call({
          toolName: "repo.writeFile",
          title: "Write file",
          summary: `Write ${params.path}`,
          visibility: "summary",
          run: async () => {
            const filePath = resolveWorkspacePath(input.cwd, params.path);
            if (params.createDirectories) {
              mkdirSync(dirname(filePath), { recursive: true });
            }
            writeFileSync(filePath, params.text, "utf8");
            const path = normalizeWorkspaceRelativePath(input.cwd, filePath);
            const bytesWritten = byteLength(params.text);
            return {
              value: { path, bytes: bytesWritten },
              facts: { path, bytesWritten },
              summary: `Wrote ${path}.`,
            };
          },
        }),
      writeJson: <T>(params: {
        path: string;
        value: T;
        pretty?: boolean;
        createDirectories?: boolean;
      }) =>
        call({
          toolName: "repo.writeJson",
          title: "Write JSON",
          summary: `Write JSON to ${params.path}`,
          visibility: "summary",
          run: async () => {
            const filePath = resolveWorkspacePath(input.cwd, params.path);
            if (params.createDirectories) {
              mkdirSync(dirname(filePath), { recursive: true });
            }
            const text = JSON.stringify(
              params.value,
              null,
              params.pretty === false ? undefined : 2,
            );
            writeFileSync(filePath, text, "utf8");
            const path = normalizeWorkspaceRelativePath(input.cwd, filePath);
            const bytesWritten = byteLength(text);
            return {
              value: { path, bytes: bytesWritten },
              facts: { path, bytesWritten },
              summary: `Wrote JSON to ${path}.`,
            };
          },
        }),
      unlink: (params) =>
        call<{ path: string; deleted: boolean }>({
          toolName: "repo.unlink",
          title: "Delete path",
          summary: `Delete ${params.path}`,
          visibility: "summary",
          run: async () => {
            const filePath = resolveWorkspacePath(input.cwd, params.path);
            const path = normalizeWorkspaceRelativePath(input.cwd, filePath);
            if (!existsSync(filePath)) {
              return {
                value: { path, deleted: false },
                facts: { path, deleted: false },
                summary: `${path} did not exist.`,
              };
            }
            const stats = statSync(filePath);
            if (stats.isDirectory()) {
              rmSync(filePath, { force: true, recursive: true });
            } else {
              unlinkSync(filePath);
            }
            return {
              value: { path, deleted: true },
              facts: { path, deleted: true },
              summary: `Deleted ${path}.`,
            };
          },
        }),
      stat: (params) =>
        call<ExecuteTypescriptRepoStat>({
          toolName: "repo.stat",
          title: "Stat path",
          summary: `Stat ${params.path}`,
          run: async () => {
            const filePath = resolveWorkspacePath(input.cwd, params.path);
            const path = normalizeWorkspaceRelativePath(input.cwd, filePath);
            if (!existsSync(filePath)) {
              return {
                value: { path, exists: false, kind: "missing" },
                facts: { path, exists: false, kind: "missing" },
                summary: `${path} is missing.`,
              };
            }
            const stats = statSync(filePath);
            const kind = stats.isDirectory() ? "directory" : "file";
            return {
              value: { path, exists: true, kind, sizeBytes: stats.size },
              facts: { path, exists: true, kind, sizeBytes: stats.size },
              summary: `${path} is a ${kind}.`,
            };
          },
        }),
      glob: (params) =>
        call({
          toolName: "repo.glob",
          title: "Glob workspace paths",
          summary: `Glob ${params.pattern}`,
          run: async () => {
            const scanRoot = params.cwd ? resolveWorkspacePath(input.cwd, params.cwd) : input.cwd;
            const glob = new Bun.Glob(params.pattern.trim() || "**/*");
            const paths: string[] = [];
            for await (const path of glob.scan({
              cwd: scanRoot,
              onlyFiles: params.includeDirectories !== true,
            })) {
              paths.push(normalizeWorkspaceRelativePath(input.cwd, resolve(scanRoot, path)));
              if (paths.length >= (params.maxResults ?? 200)) {
                break;
              }
            }
            const cwd = params.cwd
              ? normalizeWorkspaceRelativePath(input.cwd, scanRoot)
              : undefined;
            return {
              value: { paths: paths.toSorted() },
              facts: {
                pattern: params.pattern,
                resultCount: paths.length,
                ...(cwd ? { cwd } : {}),
              },
              summary: `Matched ${pluralize(paths.length, "path")}.`,
            };
          },
        }),
      grep: (params) =>
        call({
          toolName: "repo.grep",
          title: "Search text",
          summary: `Search for ${params.pattern}`,
          run: async () => {
            const glob = new Bun.Glob(params.glob?.trim() || "**/*");
            const matcher = createRepoTextMatcher(params.pattern, {
              caseSensitive: params.caseSensitive === true,
              regex: params.regex === true,
            });
            const matches: ExecuteTypescriptRepoGrepMatch[] = [];
            const matchedPaths = new Set<string>();
            for await (const path of glob.scan({ cwd: input.cwd, onlyFiles: true })) {
              const filePath = resolve(input.cwd, path);
              const contents = readFileSync(filePath, "utf8");
              const lines = contents.split(/\r?\n/);
              for (let index = 0; index < lines.length; index += 1) {
                const line = lines[index];
                if (line === undefined || !matcher(line)) {
                  continue;
                }
                matches.push({ path, line: index + 1, text: line });
                matchedPaths.add(path);
                if (matches.length >= (params.maxResults ?? 50)) {
                  return {
                    value: { matches },
                    facts: {
                      pattern: params.pattern,
                      ...(params.glob ? { glob: params.glob } : {}),
                      matchCount: matches.length,
                      pathCount: matchedPaths.size,
                    },
                    summary: `Found ${pluralize(matches.length, "match")}.`,
                  };
                }
              }
            }
            return {
              value: { matches },
              facts: {
                pattern: params.pattern,
                ...(params.glob ? { glob: params.glob } : {}),
                matchCount: matches.length,
                pathCount: matchedPaths.size,
              },
              summary: `Found ${pluralize(matches.length, "match")}.`,
            };
          },
        }),
    },
    git: {
      status: (params) =>
        call({
          toolName: "git.status",
          title: "Git status",
          summary: "Inspect git status",
          run: async () => {
            const result = await runGit([
              "status",
              "--porcelain=v2",
              "--branch",
              "--untracked-files=all",
              ...(params?.paths?.length ? ["--", ...params.paths] : []),
            ]);
            const status = parseGitStatusPorcelainV2(result.stdout);
            return {
              value: status,
              facts: {
                ...(status.branch ? { branch: status.branch } : {}),
                changedFileCount: status.files.length,
                ...(typeof status.ahead === "number" ? { ahead: status.ahead } : {}),
                ...(typeof status.behind === "number" ? { behind: status.behind } : {}),
              },
              summary: status.branch
                ? `Git status on ${status.branch} with ${pluralize(status.files.length, "changed file")}.`
                : `Git status returned ${pluralize(status.files.length, "changed file")}.`,
            };
          },
        }),
      diff: (params) =>
        call({
          toolName: "git.diff",
          title: "Git diff",
          summary: "Read git diff",
          run: async () => {
            const args = ["diff"];
            if (params?.cached) {
              args.push("--cached");
            }
            if (params?.baseRef && params?.headRef) {
              args.push(params.baseRef, params.headRef);
            } else if (params?.baseRef) {
              args.push(params.baseRef);
            } else if (params?.headRef) {
              args.push(params.headRef);
            }
            if (params?.paths?.length) {
              args.push("--", ...params.paths);
            }
            const result = await runGit(args);
            return {
              value: { text: result.stdout },
              facts: {
                ...(params?.paths?.length ? { paths: params.paths } : {}),
                cached: params?.cached === true,
                ...(params?.baseRef ? { baseRef: params.baseRef } : {}),
                ...(params?.headRef ? { headRef: params.headRef } : {}),
                diffBytes: byteLength(result.stdout),
              },
              summary: `Read ${byteLength(result.stdout)} bytes of diff output.`,
            };
          },
        }),
      log: (params) =>
        call<{ commits: ExecuteTypescriptGitCommitSummary[] }>({
          toolName: "git.log",
          title: "Git log",
          summary: "Read recent commits",
          run: async () => {
            const limit = params?.limit ?? 10;
            const result = await runGit([
              "log",
              "--format=%H%x1f%s%x1f%an%x1f%aI",
              "-n",
              String(limit),
              ...(params?.ref ? [params.ref] : []),
            ]);
            const commits = result.stdout
              .split(/\r?\n/)
              .filter(Boolean)
              .map<ExecuteTypescriptGitCommitSummary>((line) => {
                const [sha = "", subject = "", author, authoredAt] = line.split("\u001f");
                return { sha, subject, author, authoredAt };
              });
            return {
              value: { commits },
              facts: {
                ...(params?.ref ? { ref: params.ref } : {}),
                limit,
                commitCount: commits.length,
              },
              summary: `Loaded ${pluralize(commits.length, "commit")}.`,
            };
          },
        }),
      show: (params) =>
        call({
          toolName: "git.show",
          title: "Show git object",
          summary: `Show ${params.ref}`,
          run: async () => {
            const result = await runGit(
              params.path
                ? ["show", `${params.ref}:${params.path}`]
                : ["show", "--format=medium", "--no-patch", params.ref],
            );
            return {
              value: { text: result.stdout },
              facts: {
                ref: params.ref,
                ...(params.path ? { path: params.path } : {}),
                bytesRead: byteLength(result.stdout),
              },
              summary: params.path
                ? `Read ${params.path} at ${params.ref}.`
                : `Read ${byteLength(result.stdout)} bytes from ${params.ref}.`,
            };
          },
        }),
      branch: (params) =>
        call<{
          current?: string;
          branches: Array<{ name: string; current: boolean; upstream?: string }>;
        }>({
          toolName: "git.branch",
          title: "List branches",
          summary: "Inspect branches",
          run: async () => {
            const result = await runGit([
              "branch",
              ...(params?.all ? ["--all"] : []),
              "--format=%(HEAD)%x1f%(refname:short)%x1f%(upstream:short)",
            ]);
            const branches = result.stdout
              .split(/\r?\n/)
              .filter(Boolean)
              .flatMap((line) => {
                const [head, name, upstream] = line.split("\u001f");
                if (!name) {
                  return [];
                }
                return {
                  name,
                  current: head?.trim() === "*",
                  upstream: upstream || undefined,
                };
              });
            const current = branches.find((branch) => branch.current)?.name;
            return {
              value: { current, branches },
              facts: {
                ...(current ? { current } : {}),
                branchCount: branches.length,
              },
              summary: current
                ? `Current branch is ${current}.`
                : `Loaded ${pluralize(branches.length, "branch")}.`,
            };
          },
        }),
      mergeBase: (params) =>
        call({
          toolName: "git.mergeBase",
          title: "Merge base",
          summary: `Find merge base for ${params.baseRef} and ${params.headRef}`,
          run: async () => {
            const result = await runGit(["merge-base", params.baseRef, params.headRef]);
            const sha = result.stdout.trim();
            return {
              value: { sha: sha || undefined },
              facts: {
                baseRef: params.baseRef,
                headRef: params.headRef,
                ...(sha ? { sha } : {}),
              },
              summary: sha
                ? `Merge base is ${sha}.`
                : `No merge base for ${params.baseRef} and ${params.headRef}.`,
            };
          },
        }),
      fetch: (params) =>
        call({
          toolName: "git.fetch",
          title: "Git fetch",
          summary: "Fetch from remote",
          visibility: "summary",
          run: async () => {
            const result = await runGit([
              "fetch",
              ...(params?.prune ? ["--prune"] : []),
              ...(params?.remote ? [params.remote] : []),
              ...(params?.refspecs ?? []),
            ]);
            return buildGitCommandOutcome(
              result,
              {
                ...(params?.remote ? { remote: params.remote } : {}),
                refspecCount: params?.refspecs?.length ?? 0,
                prune: params?.prune === true,
              },
              "Fetched from remote.",
            );
          },
        }),
      pull: (params) =>
        call({
          toolName: "git.pull",
          title: "Git pull",
          summary: "Pull from remote",
          visibility: "summary",
          run: async () => {
            const result = await runGit([
              "pull",
              ...(params?.rebase ? ["--rebase"] : []),
              ...(params?.remote ? [params.remote] : []),
              ...(params?.branch ? [params.branch] : []),
            ]);
            return buildGitCommandOutcome(
              result,
              {
                ...(params?.remote ? { remote: params.remote } : {}),
                ...(params?.branch ? { branch: params.branch } : {}),
                rebase: params?.rebase === true,
              },
              "Pulled from remote.",
            );
          },
        }),
      push: (params) =>
        call({
          toolName: "git.push",
          title: "Git push",
          summary: "Push to remote",
          visibility: "summary",
          run: async () => {
            const result = await runGit([
              "push",
              ...(params?.setUpstream ? ["--set-upstream"] : []),
              ...(params?.forceWithLease ? ["--force-with-lease"] : []),
              ...(params?.tags ? ["--tags"] : []),
              ...(params?.remote ? [params.remote] : []),
              ...(params?.branch ? [params.branch] : []),
            ]);
            return buildGitCommandOutcome(
              result,
              {
                ...(params?.remote ? { remote: params.remote } : {}),
                ...(params?.branch ? { branch: params.branch } : {}),
                setUpstream: params?.setUpstream === true,
                forceWithLease: params?.forceWithLease === true,
                tags: params?.tags === true,
              },
              "Pushed to remote.",
            );
          },
        }),
      add: (params) =>
        call({
          toolName: "git.add",
          title: "Git add",
          summary: "Stage changes",
          visibility: "summary",
          run: async () => {
            const result = await runGit([
              "add",
              ...(params.all ? ["--all"] : []),
              ...(params.update ? ["--update"] : []),
              ...(params.paths?.length ? params.paths : []),
            ]);
            return buildGitCommandOutcome(
              result,
              {
                ...(params.paths?.length ? { paths: params.paths } : {}),
                all: params.all === true,
                update: params.update === true,
              },
              "Staged changes.",
            );
          },
        }),
      commit: (params) =>
        call({
          toolName: "git.commit",
          title: "Git commit",
          summary: "Create commit",
          visibility: "summary",
          run: async () => {
            const result = await runGit([
              "commit",
              ...(params.all ? ["--all"] : []),
              ...(params.allowEmpty ? ["--allow-empty"] : []),
              ...(params.amend ? ["--amend"] : []),
              "-m",
              params.message,
            ]);
            const sha =
              result.exitCode === 0
                ? (await runGit(["rev-parse", "HEAD"])).stdout.trim() || undefined
                : undefined;
            return buildGitCommandOutcome(
              { ...result, sha },
              {
                messageSummary: summarizeGitMessage(params.message),
                ...(sha ? { sha } : {}),
                all: params.all === true,
                allowEmpty: params.allowEmpty === true,
                amend: params.amend === true,
              },
              sha ? `Committed ${sha.slice(0, 7)}.` : "Committed changes.",
            );
          },
        }),
      switch: (params) =>
        call({
          toolName: "git.switch",
          title: "Git switch",
          summary: `Switch to ${params.branch}`,
          visibility: "summary",
          run: async () => {
            const result = await runGit([
              "switch",
              ...(params.create ? ["-c"] : []),
              params.branch,
              ...(params.startPoint ? [params.startPoint] : []),
            ]);
            return buildGitCommandOutcome(
              result,
              {
                branch: params.branch,
                create: params.create === true,
                ...(params.startPoint ? { startPoint: params.startPoint } : {}),
              },
              `Switched to ${params.branch}.`,
            );
          },
        }),
      checkout: (params) =>
        call({
          toolName: "git.checkout",
          title: "Git checkout",
          summary: "Checkout git ref or paths",
          visibility: "summary",
          run: async () => {
            const args = ["checkout"];
            if (params.createBranch) {
              args.push("-b", params.createBranch);
              if (params.ref) {
                args.push(params.ref);
              }
            } else if (params.ref) {
              args.push(params.ref);
            }
            if (params.paths?.length) {
              args.push("--", ...params.paths);
            }
            if (args.length === 1) {
              throw new Error("git.checkout requires ref, paths, or createBranch.");
            }
            const result = await runGit(args);
            return buildGitCommandOutcome(
              result,
              {
                ...(params.ref ? { ref: params.ref } : {}),
                ...(params.paths?.length ? { paths: params.paths } : {}),
                ...(params.createBranch ? { createBranch: params.createBranch } : {}),
              },
              "Checked out git state.",
            );
          },
        }),
      restore: (params) =>
        call({
          toolName: "git.restore",
          title: "Git restore",
          summary: "Restore tracked paths",
          visibility: "summary",
          run: async () => {
            const worktree = params.worktree ?? params.staged !== true;
            const result = await runGit([
              "restore",
              ...(params.source ? ["--source", params.source] : []),
              ...(params.staged ? ["--staged"] : []),
              ...(worktree ? ["--worktree"] : []),
              "--",
              ...params.paths,
            ]);
            return buildGitCommandOutcome(
              result,
              {
                paths: params.paths,
                ...(params.source ? { source: params.source } : {}),
                staged: params.staged === true,
                worktree,
              },
              "Restored tracked paths.",
            );
          },
        }),
      rebase: (params) =>
        call({
          toolName: "git.rebase",
          title: "Git rebase",
          summary: "Run git rebase",
          visibility: "summary",
          run: async () => {
            let mode = "start";
            const args = ["rebase"];
            if (params.continue) {
              mode = "continue";
              args.push("--continue");
            } else if (params.abort) {
              mode = "abort";
              args.push("--abort");
            } else {
              if (params.upstream) {
                args.push(params.upstream);
              }
              if (params.branch) {
                args.push(params.branch);
              }
            }
            const result = await runGit(args);
            return buildGitCommandOutcome(
              result,
              {
                ...(params.upstream ? { upstream: params.upstream } : {}),
                ...(params.branch ? { branch: params.branch } : {}),
                mode,
              },
              `Rebase ${mode} completed.`,
            );
          },
        }),
      cherryPick: (params) =>
        call({
          toolName: "git.cherryPick",
          title: "Git cherry-pick",
          summary: "Run git cherry-pick",
          visibility: "summary",
          run: async () => {
            let mode = "start";
            const args = ["cherry-pick"];
            if (params.continue) {
              mode = "continue";
              args.push("--continue");
            } else if (params.abort) {
              mode = "abort";
              args.push("--abort");
            } else {
              if (params.noCommit) {
                args.push("--no-commit");
              }
              args.push(...(params.commits ?? []));
            }
            const result = await runGit(args);
            return buildGitCommandOutcome(
              result,
              {
                commitCount: params.commits?.length ?? 0,
                noCommit: params.noCommit === true,
                mode,
              },
              `Cherry-pick ${mode} completed.`,
            );
          },
        }),
      stash: (params) =>
        call({
          toolName: "git.stash",
          title: "Git stash",
          summary: "Run git stash",
          visibility:
            params?.subcommand === "list" || params?.subcommand === "show" ? "trace" : "summary",
          run: async () => {
            const subcommand = params?.subcommand ?? "push";
            const args = ["stash", subcommand];
            if (subcommand === "push") {
              if (params?.message) {
                args.push("-m", params.message);
              }
              if (params?.includeUntracked) {
                args.push("--include-untracked");
              }
            } else if (params?.stash) {
              args.push(params.stash);
            }
            const result = await runGit(args);
            return buildGitCommandOutcome(
              result,
              {
                subcommand,
                ...(params?.stash ? { stash: params.stash } : {}),
                ...(params?.message ? { message: params.message } : {}),
              },
              `Stash ${subcommand} completed.`,
              subcommand === "list" || subcommand === "show" ? "trace" : "summary",
            );
          },
        }),
      tag: (params) =>
        call({
          toolName: "git.tag",
          title: "Git tag",
          summary: "Run git tag",
          visibility: params?.list ? "trace" : "summary",
          run: async () => {
            const args = ["tag"];
            if (params?.list) {
              args.push("--list");
              if (params.pattern) {
                args.push(params.pattern);
              }
            } else if (params?.delete) {
              if (!params.name) {
                throw new Error("git.tag delete requires a tag name.");
              }
              args.push("-d", params.name);
            } else {
              if (!params?.name) {
                throw new Error("git.tag create requires a tag name.");
              }
              if (params.annotate) {
                args.push("-a");
              }
              if (params.message ?? params.annotate) {
                args.push("-m", params.message ?? params.name);
              }
              args.push(params.name);
              if (params.target) {
                args.push(params.target);
              }
            }
            const result = await runGit(args);
            return buildGitCommandOutcome(
              result,
              {
                ...(params?.name ? { name: params.name } : {}),
                ...(params?.target ? { target: params.target } : {}),
                annotate: params?.annotate === true,
                delete: params?.delete === true,
                list: params?.list === true,
                ...(params?.pattern ? { pattern: params.pattern } : {}),
              },
              "Tag command completed.",
              params?.list ? "trace" : "summary",
            );
          },
        }),
    },
    exec: {
      run: (params) =>
        call({
          toolName: "exec.run",
          title: "Run command",
          summary: `Run ${params.command}`,
          run: async () => {
            const cwd = params.cwd ? resolveWorkspacePath(input.cwd, params.cwd) : input.cwd;
            const value = await input.runCommand({
              ...params,
              cwd,
              signal: input.signal,
            });
            const failureSummary = summarizeCommandFailure(params.command, value);
            return {
              value,
              facts: {
                command: params.command,
                args: params.args ?? [],
                cwd: normalizeWorkspaceRelativePath(input.cwd, cwd),
                ...(typeof params.timeoutMs === "number" ? { timeoutMs: params.timeoutMs } : {}),
                exitCode: value.exitCode,
                stdoutBytes: byteLength(value.stdout),
                stderrBytes: byteLength(value.stderr),
              },
              status: value.exitCode === 0 ? "succeeded" : "failed",
              visibility: value.exitCode === 0 ? "trace" : "summary",
              summary:
                value.exitCode === 0 ? `${params.command} exited with code 0.` : failureSummary,
              error: value.exitCode === 0 ? null : failureSummary,
            };
          },
        }),
    },
    artifact: {
      writeText: (params) =>
        call({
          toolName: "artifact.writeText",
          title: "Write artifact",
          summary: `Write artifact ${params.name}`,
          visibility: "summary",
          run: async (commandId) => {
            const artifact = input.store.createArtifact({
              sourceCommandId: commandId,
              kind: "text",
              name: params.name,
              content: params.text,
            });
            return {
              value: { artifactId: artifact.id, path: artifact.path ?? "" },
              facts: {
                artifactId: artifact.id,
                name: params.name,
                path: artifact.path ?? "",
                bytesWritten: byteLength(params.text),
              },
              summary: `Created artifact ${params.name}.`,
            };
          },
        }),
      writeJson: <T>(params: { name: string; value: T; pretty?: boolean }) =>
        call({
          toolName: "artifact.writeJson",
          title: "Write JSON artifact",
          summary: `Write JSON artifact ${params.name}`,
          visibility: "summary",
          run: async (commandId) => {
            const text = JSON.stringify(
              params.value,
              null,
              params.pretty === false ? undefined : 2,
            );
            const artifact = input.store.createArtifact({
              sourceCommandId: commandId,
              kind: "json",
              name: params.name,
              content: text,
            });
            return {
              value: { artifactId: artifact.id, path: artifact.path ?? "" },
              facts: {
                artifactId: artifact.id,
                name: params.name,
                path: artifact.path ?? "",
                bytesWritten: byteLength(text),
              },
              summary: `Created JSON artifact ${params.name}.`,
            };
          },
        }),
      attachFile: (params) =>
        call({
          toolName: "artifact.attachFile",
          title: "Attach file artifact",
          summary: `Attach ${params.path}`,
          visibility: "summary",
          run: async (commandId) => {
            const filePath = resolveWorkspacePath(input.cwd, params.path);
            const name = params.name?.trim() || basename(filePath);
            const artifact = input.store.createArtifact({
              sourceCommandId: commandId,
              kind: "file",
              name,
              path: filePath,
            });
            return {
              value: { artifactId: artifact.id, path: artifact.path ?? "" },
              facts: {
                artifactId: artifact.id,
                name,
                path: artifact.path ?? "",
              },
              summary: `Attached artifact ${name}.`,
            };
          },
        }),
    },
    web: {
      search: (params) =>
        call({
          toolName: "web.search",
          title: "Web search",
          summary: `Search the web for ${params.query}`,
          run: async () => {
            const value = await input.webSearch({
              query: params.query,
              maxResults: params.maxResults,
              signal: input.signal,
            });
            return {
              value,
              facts: {
                query: params.query,
                resultCount: value.results.length,
              },
              summary: `Found ${pluralize(value.results.length, "web result")}.`,
            };
          },
        }),
      fetchText: (params) =>
        call({
          toolName: "web.fetchText",
          title: "Fetch URL",
          summary: `Fetch ${params.url}`,
          run: async () => {
            const value = await input.fetchText({
              url: params.url,
              signal: input.signal,
            });
            return {
              value,
              facts: {
                url: params.url,
                bytesRead: byteLength(value.text),
              },
              summary: `Fetched ${params.url}.`,
            };
          },
        }),
    },
  };
}

function resolveWorkspacePath(cwd: string, path: string): string {
  const resolved = resolve(cwd, path);
  const normalizedCwd = `${cwd}${cwd.endsWith("/") ? "" : "/"}`;
  if (resolved !== cwd && !resolved.startsWith(normalizedCwd)) {
    throw new Error(`Path ${path} escapes the workspace root.`);
  }
  return resolved;
}

function normalizeWorkspaceRelativePath(cwd: string, path: string): string {
  const relativePath = relative(cwd, path);
  return relativePath === "" ? "." : relativePath;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function createRepoTextMatcher(
  pattern: string,
  options: { caseSensitive: boolean; regex: boolean },
): (text: string) => boolean {
  if (options.regex) {
    const regex = new RegExp(pattern, options.caseSensitive ? "" : "i");
    return (text) => regex.test(text);
  }
  if (options.caseSensitive) {
    return (text) => text.includes(pattern);
  }
  const loweredPattern = pattern.toLowerCase();
  return (text) => text.toLowerCase().includes(loweredPattern);
}

function summarizeResult(value: unknown): string {
  if (value === undefined) {
    return "execute_typescript completed successfully.";
  }
  const preview = JSON.stringify(value);
  if (!preview) {
    return "execute_typescript completed successfully.";
  }
  return preview.length <= 160 ? preview : `${preview.slice(0, 159).trimEnd()}…`;
}

function summarizePrompt(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "execute_typescript";
  }
  return collapsed.length <= 72 ? collapsed : `${collapsed.slice(0, 71).trimEnd()}…`;
}

function parseGitStatusPorcelainV2(output: string): {
  branch?: string;
  ahead?: number;
  behind?: number;
  files: ExecuteTypescriptGitFileChange[];
} {
  let branch: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  const files: ExecuteTypescriptGitFileChange[] = [];

  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim();
      branch = head && head !== "(detached)" ? head : undefined;
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }
    const parsed = parseGitStatusEntryV2(line);
    if (parsed) {
      files.push(parsed);
    }
  }

  return {
    branch,
    ahead,
    behind,
    files,
  };
}

function parseGitStatusEntryV2(line: string): ExecuteTypescriptGitFileChange | null {
  if (line.startsWith("? ")) {
    return {
      path: line.slice(2).trim(),
      change: "untracked",
    };
  }
  if (line.startsWith("1 ")) {
    const fields = line.split(" ");
    return {
      path: fields.slice(8).join(" ").trim(),
      change: mapGitStatusChange(fields[1] ?? ""),
    };
  }
  if (line.startsWith("2 ")) {
    const tabIndex = line.indexOf("\t");
    if (tabIndex === -1) {
      return null;
    }
    const [path, previousPath] = line.slice(tabIndex + 1).split("\t");
    return {
      path: path?.trim() ?? "",
      previousPath: previousPath?.trim() || undefined,
      change: "renamed",
    };
  }
  return null;
}

function mapGitStatusChange(code: string): ExecuteTypescriptGitFileChange["change"] {
  if (code.includes("?")) {
    return "untracked";
  }
  if (code.includes("R") || code.includes("C")) {
    return "renamed";
  }
  if (code.includes("A")) {
    return "added";
  }
  if (code.includes("D")) {
    return "deleted";
  }
  return "modified";
}

function buildGitCommandOutcome<T extends ExecuteTypescriptRunCommandResult>(
  value: T,
  facts: ExecuteTypescriptCommandFacts,
  successSummary: string,
  visibility: StructuredCommandVisibility = "summary",
): ExecuteTypescriptChildCallResult<T> {
  const status = value.exitCode === 0 ? "succeeded" : "failed";
  const failureSummary = summarizeCommandFailure("git", value);
  return {
    value,
    facts,
    status,
    visibility: status === "failed" ? "summary" : visibility,
    summary: status === "succeeded" ? successSummary : failureSummary,
    error: status === "succeeded" ? null : failureSummary,
  };
}

function summarizeCommandFailure(
  commandLabel: string,
  result: ExecuteTypescriptRunCommandResult,
): string {
  const detail = firstNonEmptyLine(result.stderr) ?? firstNonEmptyLine(result.stdout);
  return detail
    ? `${commandLabel} failed: ${detail}`
    : `${commandLabel} failed with exit code ${result.exitCode}.`;
}

function summarizeGitMessage(message: string): string {
  const firstLine = firstNonEmptyLine(message) ?? "commit";
  return firstLine.length <= 72 ? firstLine : `${firstLine.slice(0, 71).trimEnd()}…`;
}

function firstNonEmptyLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function readFactNumber(
  facts: ExecuteTypescriptCommandFacts | null,
  key: string,
): number | undefined {
  const value = facts?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readFactString(
  facts: ExecuteTypescriptCommandFacts | null,
  key: string,
): string | undefined {
  const value = facts?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildExecuteTypescriptParentRollup(input: {
  childActivity: ExecuteTypescriptChildActivity[];
  snippetArtifactId: string;
  logsArtifactId?: string;
}): {
  summary?: string;
  facts: ExecuteTypescriptCommandFacts;
} {
  let repoReadCount = 0;
  let repoWriteCount = 0;
  let artifactCount = 0;
  let subprocessCount = 0;
  let subprocessFailureCount = 0;
  let grepMatchCount = 0;
  let grepPathCount = 0;
  let webSearchCount = 0;
  let webFetchCount = 0;
  let gitBranch: string | undefined;
  let gitChangedFileCount: number | undefined;
  let lastCommitSha: string | undefined;
  let pushedTarget: string | undefined;
  const gitActions = new Set<string>();
  const artifactIds: string[] = [];

  for (const activity of input.childActivity) {
    switch (activity.toolName) {
      case "repo.readFile":
        repoReadCount += 1;
        break;
      case "repo.readFiles":
        repoReadCount += readFactNumber(activity.facts, "fileCount") ?? 0;
        break;
      case "repo.readJson":
        repoReadCount += 1;
        break;
      case "repo.writeFile":
      case "repo.writeJson":
        repoWriteCount += 1;
        break;
      case "repo.unlink":
        if (activity.facts?.deleted === true) {
          repoWriteCount += 1;
        }
        break;
      case "repo.grep":
        grepMatchCount += readFactNumber(activity.facts, "matchCount") ?? 0;
        grepPathCount += readFactNumber(activity.facts, "pathCount") ?? 0;
        break;
      case "artifact.writeText":
      case "artifact.writeJson":
      case "artifact.attachFile": {
        artifactCount += 1;
        const artifactId = readFactString(activity.facts, "artifactId");
        if (artifactId) {
          artifactIds.push(artifactId);
        }
        break;
      }
      case "exec.run":
        subprocessCount += 1;
        if (activity.status === "failed") {
          subprocessFailureCount += 1;
        }
        break;
      case "git.status":
        gitBranch = readFactString(activity.facts, "branch") ?? gitBranch;
        gitChangedFileCount =
          readFactNumber(activity.facts, "changedFileCount") ?? gitChangedFileCount;
        break;
      case "git.fetch":
      case "git.pull":
      case "git.add":
      case "git.switch":
      case "git.checkout":
      case "git.restore":
      case "git.rebase":
      case "git.cherryPick":
        gitActions.add(activity.toolName.slice(4));
        break;
      case "git.push": {
        const remote = readFactString(activity.facts, "remote");
        const branch = readFactString(activity.facts, "branch");
        pushedTarget = [remote, branch].filter(Boolean).join("/") || pushedTarget;
        gitActions.add("push");
        break;
      }
      case "git.commit":
        lastCommitSha = readFactString(activity.facts, "sha") ?? lastCommitSha;
        gitActions.add("commit");
        break;
      case "git.stash": {
        const subcommand = readFactString(activity.facts, "subcommand");
        if (subcommand && subcommand !== "list" && subcommand !== "show") {
          gitActions.add(`stash ${subcommand}`);
        }
        break;
      }
      case "git.tag":
        if (activity.facts?.list !== true) {
          gitActions.add(activity.facts?.delete === true ? "tag delete" : "tag");
        }
        break;
      case "web.search":
        webSearchCount += 1;
        break;
      case "web.fetchText":
        webFetchCount += 1;
        break;
      default:
        break;
    }
  }

  const summaryParts: string[] = [];
  if (repoReadCount > 0) {
    summaryParts.push(`Read ${pluralize(repoReadCount, "file")}`);
  }
  if (grepMatchCount > 0 || grepPathCount > 0) {
    summaryParts.push(
      `Searched ${pluralize(grepPathCount, "file")} and found ${pluralize(grepMatchCount, "match")}`,
    );
  }
  if (repoWriteCount > 0) {
    summaryParts.push(`Wrote ${pluralize(repoWriteCount, "file")}`);
  }
  if (artifactCount > 0) {
    summaryParts.push(`Created ${pluralize(artifactCount, "artifact")}`);
  }
  if (subprocessCount > 0) {
    summaryParts.push(
      subprocessFailureCount > 0
        ? `Ran ${pluralize(subprocessCount, "subprocess")} (${subprocessFailureCount} failed)`
        : `Ran ${pluralize(subprocessCount, "subprocess")}`,
    );
  }
  if (lastCommitSha && pushedTarget) {
    summaryParts.push(`Git: committed ${lastCommitSha.slice(0, 7)} and pushed ${pushedTarget}`);
  } else if (gitActions.size > 0) {
    summaryParts.push(`Git: ${Array.from(gitActions).join(", ")}`);
  } else if (gitBranch || typeof gitChangedFileCount === "number") {
    const details = [
      gitBranch ? `branch ${gitBranch}` : null,
      typeof gitChangedFileCount === "number"
        ? `${pluralize(gitChangedFileCount, "changed file")}`
        : null,
    ].filter(Boolean);
    if (details.length > 0) {
      summaryParts.push(`Git: ${details.join(", ")}`);
    }
  }
  if (webSearchCount > 0) {
    summaryParts.push(`Searched the web ${webSearchCount} time${webSearchCount === 1 ? "" : "s"}`);
  }
  if (webFetchCount > 0) {
    summaryParts.push(`Fetched ${pluralize(webFetchCount, "page")}`);
  }
  if (summaryParts.length === 0 && input.childActivity.length > 0) {
    summaryParts.push(`Ran ${pluralize(input.childActivity.length, "api call")}`);
  }

  return {
    summary: summaryParts.length > 0 ? summaryParts.join(". ") : undefined,
    facts: {
      snippetArtifactId: input.snippetArtifactId,
      ...(input.logsArtifactId ? { logsArtifactId: input.logsArtifactId } : {}),
      childCommandCount: input.childActivity.length,
      failedChildCommandCount: input.childActivity.filter(
        (activity) => activity.status === "failed",
      ).length,
      repoReadCount,
      repoWriteCount,
      artifactCount,
      subprocessCount,
      subprocessFailureCount,
      grepMatchCount,
      grepPathCount,
      webSearchCount,
      webFetchCount,
      ...(artifactIds.length > 0 ? { artifactIds } : {}),
      ...(gitBranch ? { gitBranch } : {}),
      ...(typeof gitChangedFileCount === "number" ? { gitChangedFileCount } : {}),
      ...(lastCommitSha ? { lastCommitSha } : {}),
      ...(pushedTarget ? { pushedTarget } : {}),
      ...(gitActions.size > 0 ? { gitActions: Array.from(gitActions) } : {}),
    },
  };
}

async function defaultRunCommand(
  input: ExecuteTypescriptRunCommandInput,
): Promise<ExecuteTypescriptRunCommandResult> {
  const proc = Bun.spawn({
    cmd: [input.command, ...(input.args ?? [])],
    cwd: input.cwd,
    env: {
      ...process.env,
      ...input.env,
    },
    stdout: "pipe",
    stderr: "pipe",
    signal: input.signal,
  });
  const timeout =
    typeof input.timeoutMs === "number" && input.timeoutMs > 0
      ? setTimeout(() => proc.kill(), input.timeoutMs)
      : null;
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      exitCode,
      stdout,
      stderr,
    };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function defaultFetchText(input: {
  url: string;
  signal?: AbortSignal;
}): Promise<ExecuteTypescriptWebFetchResult> {
  const response = await fetch(input.url, {
    signal: input.signal,
  });
  return {
    url: input.url,
    text: await response.text(),
  };
}

async function defaultWebSearch(input: {
  query: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<ExecuteTypescriptWebSearchResult> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;
  const response = await fetch(url, {
    signal: input.signal,
    headers: {
      "user-agent": "svvy/0.0.1",
    },
  });
  const html = await response.text();
  const matches = Array.from(
    html.matchAll(
      /result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?result__snippet">([\s\S]*?)<\/a>/g,
    ),
  ).slice(0, input.maxResults ?? 5);
  return {
    results: matches.map((match) => ({
      url: match[1] ?? "",
      title: stripHtml(match[2] ?? ""),
      snippet: stripHtml(match[3] ?? ""),
    })),
  };
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getRuntimeErrorLine(error: unknown): number | undefined {
  if (!(error instanceof Error) || !error.stack) {
    return undefined;
  }
  const match = error.stack.match(/execute-typescript\.ts:(\d+):(\d+)/);
  if (!match) {
    return undefined;
  }
  const line = Number(match[1]);
  return Number.isFinite(line) ? line : undefined;
}
