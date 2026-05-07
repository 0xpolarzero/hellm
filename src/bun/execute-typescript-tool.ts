import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "@sinclair/typebox";
import { basename } from "node:path";
import { inspect } from "node:util";
import * as ts from "typescript";
import { createCxTools } from "./cx-tools";
import { buildExecuteTypescriptApiDeclaration } from "./execute-typescript-api-declaration";
import type { SvvyApi, SvvyConsole } from "./execute-typescript-api-contract";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import { createWorkflowLibrary, type WorkflowLibrary } from "./smithers-runtime/workflow-library";
import { createSvvyDirectTools } from "./svvy-direct-tools";
import type { WebProvider } from "./web-runtime/contracts";
import { createUnavailableWebToolInvoker } from "./web-runtime/tools";
import { createWebProvider } from "./web-runtime/provider-registry";
import type {
  StructuredArtifactKind,
  StructuredCommandExecutor,
  StructuredCommandStatus,
  StructuredCommandVisibility,
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

export const executeTypescriptParamsSchema = Type.Object(
  {
    typescriptCode: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ExecuteTypescriptParams = Static<typeof executeTypescriptParamsSchema>;

const EXECUTE_TYPESCRIPT_DESCRIPTION = [
  "Run a bounded TypeScript program against a small duplicate subset of direct svvy tools.",
  "Use this only when TypeScript control flow is needed for batching, looping, filtering, aggregation, workflow discovery, bash-backed inspection, or artifact evidence.",
  "Inside the snippet, use the injected api object instead of Node.js built-ins such as fs, path, process, or node:* imports.",
  "The runtime persists the submitted snippet before execution, typechecks before running, and records nested api tool calls as child commands.",
].join(" ");

const EXECUTE_TYPESCRIPT_SUMMARY = "Execute bounded TypeScript against duplicated direct tools.";
const API_DECLARATIONS_FILE = "svvy-api.d.ts";
const SOURCE_FILE = "execute-typescript.ts";
const WRAPPER_PREFIX = "export default async function __svvy(api: SvvyApi, console: SvvyConsole) {";
const WRAPPER_SUFFIX = "}";
const WRAPPER_LINE_OFFSET = 1;

type ExecuteTypescriptContext = {
  turnId?: string | null;
  workflowTaskAttemptId?: string | null;
  surfacePiSessionId: string;
  threadId: string | null;
  workflowRunId?: string | null;
  executor?: StructuredCommandExecutor;
  visibility?: StructuredCommandVisibility;
};

type CapturedConsoleLevel = "log" | "info" | "warn" | "error";

export interface ExecuteTypescriptCommandStore {
  createCommand(input: {
    turnId?: string | null;
    workflowTaskAttemptId?: string | null;
    surfacePiSessionId?: string;
    threadId?: string | null;
    workflowRunId?: string | null;
    parentCommandId?: string | null;
    toolName: string;
    executor: StructuredCommandExecutor;
    visibility: StructuredCommandVisibility;
    title: string;
    summary: string;
    facts?: Record<string, unknown> | null;
    attempts?: number;
  }): {
    id: string;
  };
  startCommand(commandId: string): unknown;
  finishCommand(input: {
    commandId: string;
    status: Extract<StructuredCommandStatus, "waiting" | "succeeded" | "failed" | "cancelled">;
    visibility?: StructuredCommandVisibility;
    summary?: string;
    facts?: Record<string, unknown> | null;
    error?: string | null;
  }): unknown;
  createArtifact(input: {
    sessionId?: string | null;
    threadId?: string | null;
    workflowRunId?: string | null;
    workflowTaskAttemptId?: string | null;
    sourceCommandId?: string | null;
    kind: StructuredArtifactKind;
    name?: string;
    path?: string;
    content?: string;
  }): {
    id: string;
    path?: string;
  };
}

type ExecuteTypescriptToolOptions = {
  cwd: string;
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
  workflowLibrary?: WorkflowLibrary;
  webProvider?: WebProvider;
};

type ExecuteTypescriptApi = SvvyApi;
type CxApiToolResult = Awaited<ReturnType<ExecuteTypescriptApi["cx"]["overview"]>>;

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

      options.store.setTurnDecision({
        turnId: runtime.turnId,
        decision: "execute_typescript",
        onlyIfPending: true,
      });
      ensureRunnableSurfaceThread(options.store, runtime.sessionId, runtime.rootThreadId);

      const result = await runExecuteTypescript({
        cwd: options.cwd,
        store: options.store,
        signal,
        typescriptCode: params.typescriptCode,
        context: {
          turnId: runtime.turnId,
          surfacePiSessionId: runtime.surfacePiSessionId,
          threadId: runtime.surfaceKind === "handler" ? runtime.rootThreadId : null,
          executor: runtime.surfaceKind === "handler" ? "handler" : "orchestrator",
        },
        workflowLibrary: options.workflowLibrary,
        webProvider: options.webProvider,
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

function ensureRunnableSurfaceThread(
  store: StructuredSessionStateStore,
  sessionId: string,
  threadId: string | null,
): void {
  if (!threadId) {
    return;
  }
  const thread = store.getSessionState(sessionId).threads.find((entry) => entry.id === threadId);
  if (!thread) {
    return;
  }

  if (thread.status === "running-handler" && thread.wait === null) {
    return;
  }

  store.updateThread({
    threadId,
    status: "running-handler",
    wait: null,
  });
}

export async function runExecuteTypescript(input: {
  cwd: string;
  store: ExecuteTypescriptCommandStore;
  signal?: AbortSignal;
  typescriptCode: string;
  context: ExecuteTypescriptContext;
  workflowLibrary?: WorkflowLibrary;
  webProvider?: WebProvider;
}): Promise<ExecuteTypescriptResult> {
  const parentCommand = input.store.createCommand({
    turnId: input.context.turnId ?? null,
    workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? null,
    surfacePiSessionId: input.context.surfacePiSessionId,
    threadId: input.context.threadId,
    workflowRunId: input.context.workflowRunId ?? null,
    toolName: EXECUTE_TYPESCRIPT_TOOL_NAME,
    executor: input.context.executor ?? "orchestrator",
    visibility: input.context.visibility ?? "summary",
    title: "Run execute_typescript",
    summary: EXECUTE_TYPESCRIPT_SUMMARY,
  });
  input.store.startCommand(parentCommand.id);
  const snippetArtifact = input.store.createArtifact({
    workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? null,
    sourceCommandId: parentCommand.id,
    kind: "text",
    name: "execute-typescript.ts",
    content: input.typescriptCode,
  });

  const preflight = compileAndTypecheck(input.typescriptCode, input.webProvider);
  if (preflight.errors.length > 0) {
    const diagnosticsArtifact = input.store.createArtifact({
      workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? null,
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
    return result;
  }

  const logs: string[] = [];
  const childActivity: ExecuteTypescriptChildActivity[] = [];
  try {
    const api = createExecuteTypescriptApi({
      cwd: input.cwd,
      store: input.store,
      surfacePiSessionId: input.context.surfacePiSessionId,
      turnId: input.context.turnId ?? null,
      workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? null,
      threadId: input.context.threadId,
      workflowRunId: input.context.workflowRunId ?? null,
      parentCommandId: parentCommand.id,
      signal: input.signal,
      workflowLibrary: input.workflowLibrary ?? createWorkflowLibrary(input.cwd),
      webProvider: input.webProvider,
      emitConsole(level, ...args) {
        appendCapturedConsoleLine(logs, level, ...args);
      },
      recordChildActivity(activity) {
        childActivity.push(activity);
      },
    });
    const resultValue = await runCompiledSnippet(preflight.javascript, api, logs);
    const logsArtifact =
      logs.length > 0
        ? input.store.createArtifact({
            workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? null,
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
    return result;
  } catch (error) {
    const logsArtifact =
      logs.length > 0
        ? input.store.createArtifact({
            workflowTaskAttemptId: input.context.workflowTaskAttemptId ?? null,
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
    return result;
  }
}

function compileAndTypecheck(
  typescriptCode: string,
  webProvider?: WebProvider,
): {
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
    [API_DECLARATIONS_FILE, buildExecuteTypescriptApiDeclaration(webProvider)],
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
  const append = (level: CapturedConsoleLevel, ...args: unknown[]) => {
    appendCapturedConsoleLine(logs, level, ...args);
  };
  return {
    log: (...args) => append("log", ...args),
    info: (...args) => append("info", ...args),
    warn: (...args) => append("warn", ...args),
    error: (...args) => append("error", ...args),
  };
}

function formatConsoleValue(value: unknown): string {
  return typeof value === "string" ? value : inspect(value, { depth: 5, breakLength: Infinity });
}

function appendCapturedConsoleLine(
  logs: string[],
  level: CapturedConsoleLevel,
  ...args: unknown[]
): void {
  const text = args.map(formatConsoleValue).join(" ");
  if (!text) {
    return;
  }
  const prefix = level === "error" ? "[error] " : level === "warn" ? "[warn] " : "";
  logs.push(`${prefix}${text}`);
}

function createExecuteTypescriptApi(input: {
  cwd: string;
  store: ExecuteTypescriptCommandStore;
  surfacePiSessionId: string;
  turnId?: string | null;
  workflowTaskAttemptId?: string | null;
  threadId: string | null;
  workflowRunId?: string | null;
  parentCommandId: string;
  signal?: AbortSignal;
  workflowLibrary: WorkflowLibrary;
  webProvider?: WebProvider;
  emitConsole: (level: CapturedConsoleLevel, ...args: unknown[]) => void;
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
      turnId: input.turnId ?? null,
      workflowTaskAttemptId: input.workflowTaskAttemptId ?? null,
      surfacePiSessionId: input.surfacePiSessionId,
      threadId: input.threadId,
      workflowRunId: input.workflowRunId ?? null,
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

  const invokeTool = async <T>(inputTool: {
    tool: AgentTool<any>;
    params: unknown;
    title: string;
    summary: string;
    visibility?: StructuredCommandVisibility;
    facts?: (result: T) => ExecuteTypescriptCommandFacts | null;
  }): Promise<T> =>
    await call<T>({
      toolName: inputTool.tool.name,
      title: inputTool.title,
      summary: inputTool.summary,
      visibility: inputTool.visibility,
      run: async (commandId) => {
        const value = (await inputTool.tool.execute(
          commandId,
          inputTool.params as never,
          input.signal,
        )) as T;
        return {
          value,
          facts: inputTool.facts?.(value) ?? null,
          summary: summarizeDirectToolResult(inputTool.tool.name, value),
        };
      },
    });

  const directTools = createSvvyDirectTools({
    cwd: input.cwd,
    runtime: { current: null },
    store: input.store,
    workflowLibrary: input.workflowLibrary,
    webProvider: input.webProvider ?? createWebProvider({ provider: "local" }),
  });
  const cxTools = createCxTools({ cwd: input.cwd });
  const toolByName = new Map(
    [
      ...cxTools,
      ...directTools.codingTools,
      ...directTools.artifactTools,
      ...directTools.workflowTools,
      ...directTools.webTools,
    ].map((tool) => [tool.name, tool] as const),
  );
  const activeWebProvider = input.webProvider ?? createWebProvider({ provider: "local" });
  const unavailableWeb = createUnavailableWebToolInvoker(activeWebProvider);
  const getTool = (name: string): AgentTool<any> => {
    const tool = toolByName.get(name);
    if (!tool) {
      throw new Error(`Code mode tool ${name} is not available.`);
    }
    return tool;
  };

  return {
    read: (params) =>
      invokeTool({
        tool: getTool("read"),
        params,
        title: "Read file",
        summary: `Read ${params.path}`,
        facts: () => ({ path: params.path, offset: params.offset, limit: params.limit }),
      }),
    grep: (params) =>
      invokeTool({
        tool: getTool("grep"),
        params,
        title: "Search text",
        summary: `Search for ${params.pattern}`,
        facts: () => ({
          pattern: params.pattern,
          path: params.path,
          glob: params.glob,
          limit: params.limit,
        }),
      }),
    find: (params) =>
      invokeTool({
        tool: getTool("find"),
        params,
        title: "Find files",
        summary: `Find ${params.pattern}`,
        facts: () => ({ pattern: params.pattern, path: params.path, limit: params.limit }),
      }),
    ls: (params) =>
      invokeTool({
        tool: getTool("ls"),
        params,
        title: "List directory",
        summary: `List ${params.path ?? "."}`,
        facts: () => ({ path: params.path ?? ".", limit: params.limit }),
      }),
    bash: (params) =>
      invokeTool({
        tool: getTool("bash"),
        params,
        title: "Run bash",
        summary: `Run ${params.command}`,
        visibility: "summary",
        facts: () => ({ command: params.command, timeout: params.timeout }),
      }),
    cx: {
      overview: (params = {}) =>
        invokeTool<CxApiToolResult>({
          tool: getTool("cx.overview"),
          params,
          title: "cx overview",
          summary: `cx overview ${params.path ?? "."}`,
          facts: readCxFacts,
        }),
      symbols: (params = {}) =>
        invokeTool<CxApiToolResult>({
          tool: getTool("cx.symbols"),
          params,
          title: "cx symbols",
          summary: "cx symbols",
          facts: readCxFacts,
        }),
      definition: (params) =>
        invokeTool<CxApiToolResult>({
          tool: getTool("cx.definition"),
          params,
          title: "cx definition",
          summary: `cx definition ${params.name}`,
          facts: readCxFacts,
        }),
      references: (params) =>
        invokeTool<CxApiToolResult>({
          tool: getTool("cx.references"),
          params,
          title: "cx references",
          summary: `cx references ${params.name}`,
          facts: readCxFacts,
        }),
      lang: {
        list: () =>
          invokeTool<CxApiToolResult>({
            tool: getTool("cx.lang.list"),
            params: {},
            title: "cx lang list",
            summary: "cx lang list",
            facts: readCxFacts,
          }),
      },
      cache: {
        path: () =>
          invokeTool<CxApiToolResult>({
            tool: getTool("cx.cache.path"),
            params: {},
            title: "cx cache path",
            summary: "cx cache path",
            facts: readCxFacts,
          }),
      },
    },
    artifact: {
      write_text: (params) =>
        invokeTool({
          tool: getTool("artifact.write_text"),
          params,
          title: "Write artifact",
          summary: `Write artifact ${params.name}`,
          visibility: "summary",
          facts: (result) => readToolResultDetails(result),
        }),
      write_json: (params) =>
        invokeTool({
          tool: getTool("artifact.write_json"),
          params,
          title: "Write JSON artifact",
          summary: `Write JSON artifact ${params.name}`,
          visibility: "summary",
          facts: (result) => readToolResultDetails(result),
        }),
      attach_file: (params) =>
        invokeTool({
          tool: getTool("artifact.attach_file"),
          params,
          title: "Attach artifact",
          summary: `Attach ${params.path}`,
          visibility: "summary",
          facts: (result) => readToolResultDetails(result),
        }),
    },
    workflow: {
      list_assets: (params = {}) =>
        invokeTool({
          tool: getTool("workflow.list_assets"),
          params,
          title: "List workflow assets",
          summary: "List workflow assets",
          facts: (result) => {
            const details = readToolResultDetails(result);
            const assets = Array.isArray(details.assets) ? details.assets : [];
            return { assetCount: assets.length };
          },
        }),
      list_models: () =>
        invokeTool({
          tool: getTool("workflow.list_models"),
          params: {},
          title: "List workflow models",
          summary: "List workflow models",
          facts: (result) => {
            const details = readToolResultDetails(result);
            const models = Array.isArray(details.models) ? details.models : [];
            return { modelCount: models.length };
          },
        }),
    },
    web: {
      search: (params) => {
        const tool = toolByName.get("web.search");
        if (!tool && unavailableWeb) {
          return call({
            toolName: "web.search",
            title: "Web search",
            summary: "Web search unavailable",
            run: async () => {
              const value = unavailableWeb("web.search") as Awaited<
                ReturnType<ExecuteTypescriptApi["web"]["search"]>
              >;
              return {
                value,
                status: "failed",
                summary: value.content
                  .filter((entry) => entry.type === "text")
                  .map((entry) => entry.text)
                  .join("\n"),
                facts: readToolResultDetails(value),
              };
            },
          });
        }
        return invokeTool({
          tool: getTool("web.search"),
          params,
          title: "Web search",
          summary: `Web search ${"query" in params ? params.query : ""}`.trim(),
          facts: (result) => readCommandFacts(result),
        });
      },
      fetch: (params) => {
        const tool = toolByName.get("web.fetch");
        if (!tool && unavailableWeb) {
          return call({
            toolName: "web.fetch",
            title: "Web fetch",
            summary: "Web fetch unavailable",
            visibility: "summary",
            run: async () => {
              const value = unavailableWeb("web.fetch") as Awaited<
                ReturnType<ExecuteTypescriptApi["web"]["fetch"]>
              >;
              return {
                value,
                status: "failed",
                summary: value.content
                  .filter((entry) => entry.type === "text")
                  .map((entry) => entry.text)
                  .join("\n"),
                facts: readToolResultDetails(value),
              };
            },
          });
        }
        return invokeTool({
          tool: getTool("web.fetch"),
          params,
          title: "Web fetch",
          summary: `Web fetch ${"url" in params ? params.url : ""}`.trim(),
          visibility: "summary",
          facts: (result) => readCommandFacts(result),
        });
      },
    },
  };
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

function summarizeDirectToolResult(toolName: string, value: unknown): string {
  if (!value || typeof value !== "object") {
    return `${toolName} completed successfully.`;
  }
  const content = "content" in value ? (value as { content?: unknown }).content : undefined;
  if (!Array.isArray(content)) {
    return `${toolName} completed successfully.`;
  }
  const text = content
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      return "type" in entry &&
        (entry as { type?: unknown }).type === "text" &&
        typeof (entry as { text?: unknown }).text === "string"
        ? [(entry as { text: string }).text]
        : [];
    })
    .join("\n")
    .trim();
  return text || `${toolName} completed successfully.`;
}

function readToolResultDetails(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || !("details" in value)) {
    return {};
  }
  const details = (value as { details?: unknown }).details;
  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : {};
}

function readCommandFacts(value: unknown): ExecuteTypescriptCommandFacts | null {
  const details = readToolResultDetails(value);
  const facts = details.commandFacts;
  return facts && typeof facts === "object" && !Array.isArray(facts)
    ? (facts as ExecuteTypescriptCommandFacts)
    : details;
}

function readCxFacts(result: unknown): ExecuteTypescriptCommandFacts {
  const details = readToolResultDetails(result);
  const json = details.json;
  const resultCount = Array.isArray(json)
    ? json.length
    : json && typeof json === "object" && Array.isArray((json as { results?: unknown }).results)
      ? (json as { results: unknown[] }).results.length
      : undefined;
  return {
    command: details.command,
    exitCode: details.exitCode,
    ...(typeof resultCount === "number" ? { resultCount } : {}),
  };
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
  let readCount = 0;
  let searchCount = 0;
  let artifactCount = 0;
  let bashCount = 0;
  let bashFailureCount = 0;
  let cxCount = 0;
  let workflowAssetCount = 0;
  let workflowModelCount = 0;
  const artifactIds: string[] = [];

  for (const activity of input.childActivity) {
    switch (activity.toolName) {
      case "read":
      case "ls":
        readCount += 1;
        break;
      case "grep":
      case "find":
        searchCount += 1;
        break;
      case "artifact.write_text":
      case "artifact.write_json":
      case "artifact.attach_file": {
        artifactCount += 1;
        const artifactId = readFactString(activity.facts, "artifactId");
        if (artifactId) {
          artifactIds.push(artifactId);
        }
        break;
      }
      case "bash":
        bashCount += 1;
        if (activity.status === "failed") {
          bashFailureCount += 1;
        }
        break;
      case "cx.overview":
      case "cx.symbols":
      case "cx.definition":
      case "cx.references":
      case "cx.lang.list":
      case "cx.cache.path":
        cxCount += 1;
        break;
      case "workflow.list_assets":
        workflowAssetCount += readFactNumber(activity.facts, "assetCount") ?? 0;
        break;
      case "workflow.list_models":
        workflowModelCount += readFactNumber(activity.facts, "modelCount") ?? 0;
        break;
      default:
        break;
    }
  }

  const summaryParts: string[] = [];
  if (readCount > 0) {
    summaryParts.push(`Read ${pluralize(readCount, "tool result")}`);
  }
  if (searchCount > 0) {
    summaryParts.push(`Ran ${pluralize(searchCount, "search")}`);
  }
  if (artifactCount > 0) {
    summaryParts.push(`Created ${pluralize(artifactCount, "artifact")}`);
  }
  if (bashCount > 0) {
    summaryParts.push(
      bashFailureCount > 0
        ? `Ran ${pluralize(bashCount, "bash command")} (${bashFailureCount} failed)`
        : `Ran ${pluralize(bashCount, "bash command")}`,
    );
  }
  if (cxCount > 0) {
    summaryParts.push(`Ran ${pluralize(cxCount, "cx navigation call")}`);
  }
  if (workflowAssetCount > 0) {
    summaryParts.push(`Discovered ${pluralize(workflowAssetCount, "workflow asset")}`);
  }
  if (workflowModelCount > 0) {
    summaryParts.push(`Listed ${pluralize(workflowModelCount, "workflow model")}`);
  }
  if (summaryParts.length === 0 && input.childActivity.length > 0) {
    summaryParts.push(`Ran ${pluralize(input.childActivity.length, "tool call")}`);
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
      readCount,
      searchCount,
      artifactCount,
      bashCount,
      bashFailureCount,
      cxCount,
      workflowAssetCount,
      workflowModelCount,
      ...(artifactIds.length > 0 ? { artifactIds } : {}),
    },
  };
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
