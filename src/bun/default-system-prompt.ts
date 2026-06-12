import { readFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { WORKFLOW_AUTHORING_CONTRACT_DECLARATION } from "../../generated/workflow-authoring-contract.generated";
import {
  SMITHERS_CORE_INSTRUCTIONS,
  SMITHERS_MEMORY_INSTRUCTIONS,
} from "../../generated/smithers-instructions.generated";
import type { SvvyActorKind } from "./actor-capabilities";
import { buildCxPromptContext } from "./cx-runtime/prompt-context";
import { buildExecuteTypescriptApiDeclaration } from "./execute-typescript-api-declaration";
import {
  HANDLER_WORKFLOW_AUTHORING_APPENDIX,
  SMITHERS_SVVY_BOUNDARY_APPENDIX,
} from "./smithers-runtime/workflow-authoring-guide";
import { buildWebPromptContext } from "./web-runtime/prompt-context";
import {
  getExtensionRecord,
  resolveActorExtensionState,
  type ExtensionRecord,
} from "../shared/extensions";
import type { RequestUserInputSettings } from "../shared/agent-settings";
import type {
  GeneratedAgentContextActorRecipe,
  GeneratedAgentContextEntry,
  GeneratedAgentContextSectionId,
  GeneratedAgentContextInstructionBlock,
  GeneratedAgentContextExternalSource,
  GeneratedAgentContextState,
} from "../shared/generated-agent-context";

export function buildExecuteTypescriptBasePromptSection(actor: SvvyActorKind): string {
  const compositionUses =
    actor === "handler"
      ? "batching, looping, filtering, aggregation, or structured extension-client composition"
      : "batching, looping, filtering, aggregation, or structured extension-client composition";
  return [
    "Loaded native extension: Execute TypeScript.",
    "",
    `Use execute_typescript only when a small TypeScript program is genuinely useful for ${compositionUses}.`,
    "When you call execute_typescript, write plain TypeScript against actor-local generated `extensions` clients and `console`.",
    "Do not import or assume Node.js built-ins such as `fs`, `path`, `process`, or `node:*` inside the snippet.",
    "Do not use or assume a broad `api` helper, global `svvy`, prompt-only extension clients, Smithers clients, or Workflows runner clients.",
    "Do not use execute_typescript for ordinary reads, edits, writes, or simple command runs; call Shell, Apply Patch, or other direct tools instead.",
  ].join("\n");
}

export const EXECUTE_TYPESCRIPT_INCUR_CLIENT_PROMPT_SECTION = [
  "Loaded Execute TypeScript guidance: Incur generated clients.",
  "",
  'Use generated extension clients through `extensions["<extensionId>"].run(commandId, input)`.',
  "Dot access is valid only for identifier-safe extension ids, such as `extensions.artifacts.run(...)`.",
  "Import public Incur types from `incur/client` when needed; do not invent internal client APIs.",
].join("\n");

export function buildExecuteTypescriptPromptSection(
  actor: SvvyActorKind,
  options: {
    extensionsRoot?: string;
    loadedExtensionIds?: readonly string[];
    loadedExtensionRecords?: readonly ExtensionRecord[];
    workflowsExtensionsGeneratedPackagePath?: string;
    workflowsGeneratedPackagePath?: string;
  } = {},
): string {
  return [
    buildExecuteTypescriptBasePromptSection(actor),
    EXECUTE_TYPESCRIPT_INCUR_CLIENT_PROMPT_SECTION,
    "The execute_typescript contract follows and is the source of truth for the snippet environment:",
    "```ts",
    buildExecuteTypescriptApiDeclaration(actor, {
      extensionsRoot: options.extensionsRoot,
      loadedExtensionIds: options.loadedExtensionIds,
      loadedExtensionRecords: options.loadedExtensionRecords,
      workflowsExtensionsGeneratedPackagePath: options.workflowsExtensionsGeneratedPackagePath,
      workflowsGeneratedPackagePath: options.workflowsGeneratedPackagePath,
    }),
    "```",
  ].join("\n");
}

const WORKFLOW_AUTHORING_CONTRACT_PROMPT_SECTION = [
  "The handler workflow-authoring TypeScript contract follows and is the source of truth for reusable app-global Workflows agent parameter records:",
  "```ts",
  WORKFLOW_AUTHORING_CONTRACT_DECLARATION.trim(),
  "```",
].join("\n\n");

export const BASE_COMMON_INSTRUCTIONS = [
  "You are svvy, a pragmatic software engineering assistant running inside the svvy desktop app.",
  "Everything you do is a tool call inside one shared execution model.",
  "Threads, commands, waits, and episodes come from real tool execution and structured state rather than assistant prose.",
  "Inspect repository facts before making structural assumptions, and prefer existing project patterns over new abstractions.",
  "Keep edits narrowly scoped to the requested behavior. Avoid unrelated refactors, renames, formatting churn, or metadata changes unless they are required to finish safely.",
  "Treat the worktree as shared user state. Do not revert, overwrite, rename, clean up, or otherwise erase changes you did not make unless the user explicitly asks.",
  "Validate proportionally to risk: use focused checks for touched behavior when practical, broaden checks for shared contracts or user-facing flows, and say plainly when validation is skipped or blocked.",
  "When asked for review, use a code-review stance: lead with concrete, actionable bugs or regressions, include tight file and line evidence, and avoid filling the review with style preferences.",
  "Use the available direct tools for ordinary repository work. Use the `cx` CLI through Shell for semantic code navigation before reading whole files when cx can cover the language.",
  "When multiple tool calls are independent, issue them together in the same assistant message so pi can run them in parallel; use sequential calls only when a later call depends on an earlier result.",
  "Use Shell for repository inspection and command execution, Apply Patch for targeted source edits, and Execute TypeScript only when typed composition is genuinely useful.",
  "For file exploration through Shell, prefer `rg` for text search and `rg --files` for filename search before falling back to ordinary commands such as `sed`, `cat`, `ls`, `find`, `git show`, `nl`, and `wc`.",
  "Use list_extensions when you need to inspect the loaded and available extension records for the current actor.",
  "Use the actor-local thread tools when delegated thread state matters.",
  "Do not expect runtime, thread, episode, queue, or workflow state to be repeated in user messages.",
  "Create artifacts only for durable byproducts or evidence that should remain inspectable but should not normally be placed in the repository; use Apply Patch for requested workspace source files and prose for small answers.",
].join("\n\n");

export const BASE_ORCHESTRATOR_INSTRUCTIONS = [
  "This surface is the orchestrator. Choose one top-level route per turn: reply directly, ask for clarification with request_user_input, use direct tools, use execute_typescript for typed composition, delegate with thread_start, send thread_followup, request a report, or reconcile thread_report notifications.",
  "The orchestrator delegates objectives into handler threads. Smithers execution, inspection, approval, and resume behavior happens only through official Smithers CLI commands in handler Shell tool calls.",
  "No Smithers wrapper tool declarations are callable from this surface.",
  "When delegating with thread_start, normally omit history so it defaults to isolated and write a compact objective with durable paths and accepted decisions.",
  "Call thread_start with one threads[] item for ordinary delegation. Use multiple threads[] items only for separate user-visible handler conversations where the user is invested in each workstream, each objective may need direct follow-up, or the workstreams are clearly independent conversations.",
  'Use history: "forked" only when the user explicitly asks to fork/continue/share current conversation context, unresolved design nuance would be materially lossy to restate, several approaches need the exact same conversational starting point, or a compact objective would lose critical user intent.',
  'Do not use history: "forked" for ordinary implementation, source-driven research, test fixing, code review, security review, independent critique, verification, durable-file-specified tasks, or stale/speculative transcript contexts.',
  "Use thread_list and thread_episodes before thread_followup({ activate: true }) when an existing concluded handler thread may already have the right context for follow-up work.",
  "If a delegated objective needs workflow authoring or saving reusable workflow assets, delegate that work to a handler thread instead of trying to do it from the orchestrator surface.",
].join("\n\n");

export const BASE_HANDLER_INSTRUCTIONS = [
  "This surface is a delegated handler thread. Choose one top-level route per turn: reply directly, ask for clarification with request_user_input, use direct tools, use execute_typescript for typed composition, use Smithers CLI commands through Shell, enter local wait state, or emit an update/conclusion with thread_report.",
  "Ordinary replies inside a handler thread do not close it or emit episodes.",
  "Use thread_report with outcome only when the current objective is ready to conclude with durable state.",
  "Workflow waits, approvals, and resumes stay inside this handler thread until the handler decides to report an update or conclusion.",
  "Do not call thread_start from this surface in the adopted supervision model.",
  "Use thread_current when the current objective, wait state, loaded extensions, available extensions, or prior thread report state matters.",
  "Do not infer current workflow details from generated actor instructions; inspect Smithers state with official Smithers CLI commands when workflow state matters.",
].join("\n\n");

export const BASE_WORKFLOW_TASK_INSTRUCTIONS = [
  "You are a task-scoped coding agent running inside one Smithers workflow task attempt.",
  "Use the available task-local tools to complete the task described by the workflow.",
  "Work only within the task root or worktree provided by the workflow runtime.",
].join("\n");

const CX_CONTEXT_BODY = buildCxPromptContext();

export const SHELL_BASE_CONTEXT_BODY = [
  "Loaded native extension: Shell.",
  "",
  "Use exec_command to run shell commands. Use write_stdin only to continue an exec_command session that returned a session_id.",
  "For repository inspection, prefer rg for text search and rg --files for filename search. Set workdir on exec_command instead of relying on cd.",
].join("\n");

export const SHELL_INCUR_CLI_CONTEXT_BODY = [
  "Loaded Shell guidance: Incur CLI Usage.",
  "",
  "Loaded svvyx extensions are ordinary shell commands. Run them with exec_command as svvyx <extension-id> <command> ... .",
  "Use --help for human-readable command help and --llms or --llms --format json for agent-readable command documentation.",
  "Use the specific loaded extension instructions for domain command names and examples.",
].join("\n");

const APPLY_PATCH_CONTEXT_BODY = [
  "Loaded native extension: Apply Patch.",
  "",
  "Use apply_patch for targeted source edits. It is not a shell and cannot run commands or continue processes.",
].join("\n");

const GIT_CONTEXT_BODY = [
  "Loaded prompt-only extension: Git.",
  "",
  "Use git through ordinary Shell commands for repository status, diffs, branches, staging, commits, and history. There are no native git_* tools, no svvyx git commands, and no generated Git TypeScript clients.",
].join("\n");

const GITHUB_CONTEXT_BODY = [
  "Loaded prompt-only extension: GitHub.",
  "",
  "Use gh through ordinary Shell commands for GitHub issues, pull requests, reviews, Actions, publishing, and wrap-up. There are no native github_* tools, no svvyx github commands, and no generated GitHub TypeScript clients.",
].join("\n");

const EXTENSION_LOADING_CONTEXT_BODY = [
  "Loaded native extension: Extension Loading.",
  "",
  "Use list_extensions to inspect the current actor's loaded and available extensions. Use load_extension only to load an available ready extension into this actor session.",
].join("\n");

const EXTENSION_MANAGING_CONTEXT_BODY = [
  "Loaded native extension: Extension Managing.",
  "",
  "Use extension-management commands only for app-owned extension source, build, snapshot, readiness, and inspection work.",
  "Do not treat Extension Managing as actor-local runtime capability loading; use Extension Loading for actor-local list_extensions and load_extension work.",
].join("\n");

const REQUEST_USER_INPUT_NONBLOCKING_CONTEXT_BODY = [
  "Loaded native extension: Request User Input.",
  "",
  "Use `request_user_input` only for user decisions that could materially steer the work and where you can choose a conservative default now.",
  "Ask one to three short questions. For each question, provide a concise `title` for the side panel. Use either exactly two or three options with exactly one `recommended: true`, or a freeform `defaultAnswer`.",
  "Continue with the returned answer. If a later `request_user_input.answer` message arrives, treat it as a normal queued answer follow-up and reassess only if it materially changes the work.",
].join("\n");

const REQUEST_USER_INPUT_BLOCKING_CONTEXT_BODY = [
  "Loaded native extension: Request User Input.",
  "",
  "Use `request_user_input` only when the answer is required before proceeding safely.",
  "Ask one to three short questions. For each question, provide a concise `title` for the side panel. Use either exactly two or three options with exactly one `recommended: true`, or a freeform `defaultAnswer`, because the configured timeout may fall back to that default.",
  'When the tool returns, continue with the returned answer. If the answer is marked `answeredBy: "timeout_default"`, treat it as a fallback, not confirmed user preference.',
].join("\n");

const THREAD_ORCHESTRATION_CONTEXT_BODY = [
  "Loaded native extension: Thread Orchestration.",
  "",
  "Use thread_start for delegated handler objectives, thread_followup for exact thread or group follow-up, thread_request_report for one-handler updates, and thread_list/thread_episodes when handler state matters.",
].join("\n");

const THREAD_HANDLING_CONTEXT_BODY = [
  "Loaded native extension: Thread Handling.",
  "",
  "Use thread_current and thread_group to inspect this handler context, thread_episodes for durable report history, and thread_report for intermediate updates or conclusions.",
].join("\n");

const ARTIFACTS_COMMAND_CONTRACTS = [
  {
    id: "create",
    shell:
      "svvyx artifacts create --name <filename-with-extension> [--immutable] [--mime-type <mime>] --json",
    summary: "creates an empty artifact file with the exact stored filename",
    typescript:
      'await extensions.artifacts.run("create", { options: { name, immutable, mimeType } });',
  },
  {
    id: "create",
    shell:
      "svvyx artifacts create --path <file> [--name <filename-with-extension>] [--immutable] [--mime-type <mime>] --json",
    summary: "copies one existing file into artifact storage",
    typescript:
      'await extensions.artifacts.run("create", { options: { path, name, immutable, mimeType } });',
  },
  {
    id: "inspect",
    shell: "svvyx artifacts inspect --id <artifact_id> --json",
    summary: "returns artifact metadata and path without file contents",
    typescript: 'await extensions.artifacts.run("inspect", { options: { id } });',
  },
  {
    id: "list",
    shell: "svvyx artifacts list [--thread-id <thread_id>] [--limit <n>] --json",
    summary: "lists active artifacts for the current session or handler thread",
    typescript: 'await extensions.artifacts.run("list", { options: { threadId, limit } });',
  },
  {
    id: "open",
    shell: "svvyx artifacts open --id <artifact_id> --json",
    summary: "opens or focuses the product artifact inspector",
    typescript: 'await extensions.artifacts.run("open", { options: { id } });',
  },
  {
    id: "delete",
    shell: "svvyx artifacts delete --id <artifact_id> --json",
    summary: "tombstones the artifact record and removes the file when present",
    typescript: 'await extensions.artifacts.run("delete", { options: { id } });',
  },
] as const;

const ARTIFACTS_CONTEXT_BODY = buildArtifactsContextBody();

function buildArtifactsContextBody(): string {
  return [
    "Loaded extension: Artifacts.",
    "",
    "Use artifacts only for durable session files such as screenshots, logs, traces, reports, generated previews, and handoff notes. Do not use artifacts for ordinary repository files the user asked you to create or edit.",
    "Run Artifacts through exec_command with JSON output:",
    ...ARTIFACTS_COMMAND_CONTRACTS.map((command) => `- \`${command.shell}\` ${command.summary}.`),
    "When writing TypeScript inside execute_typescript, prefer the generated client:",
    "```ts",
    ...ARTIFACTS_COMMAND_CONTRACTS.map((command) => command.typescript),
    "```",
    "Artifacts create does not support `--kind`, inline content, implicit extension defaults, path-like names, or compatibility aliases such as artifact_write_text.",
  ].join("\n");
}

const SMITHERS_ORCHESTRATOR_CONTEXT_BODY = [
  "Loaded always-on prompt context: Smithers workflow routing.",
  "",
  "Handler threads use official Smithers CLI commands through Shell for workflow work. The orchestrator knows this capability exists, but it does not receive `smithers_*` tool declarations or product workflow wrappers.",
  "",
  "When work requires workflow execution, workflow authoring, or workflow inspection, delegate a bounded objective to a handler thread with `thread_start`. Use `thread_followup({ activate: true })` when a concluded handler thread already has the right delegated context for follow-up work.",
].join("\n");

const SMITHERS_HANDLER_CONTEXT_BODY = [
  "Loaded prompt-only extension: Smithers CLI workflow authoring.",
  "",
  "Handler threads use official Smithers CLI commands through Shell against workspace `.smithers/` source. Smithers adds no native tools, no generated TypeScript clients, and no product workflow wrapper tools.",
  "",
  "Use `smithers init`, `smithers workflow run`, `smithers ps`, and `smithers inspect` as ordinary shell commands when Smithers work is the right unit.",
  "",
  "When the delegated objective has an important update, call `thread_report`. Include `outcome` only when the current handler objective is concluded.",
].join("\n");

const SMITHERS_WORKFLOW_TASK_CONTEXT_BODY = [
  "Loaded always-on prompt context: Smithers task-agent boundary.",
  "",
  "Smithers owns task lifecycle, retries, validation, approval gates, and workflow state whenever an official Smithers workflow invokes a task agent.",
].join("\n");

function buildCommonInstructions(actor: SvvyActorKind): string[] {
  const common = BASE_COMMON_INSTRUCTIONS.split("\n\n");
  if (actor !== "workflow-task") {
    return common;
  }
  return common.filter(
    (instruction) =>
      !instruction.includes("thread report episodes") &&
      !instruction.includes("thread_list") &&
      !instruction.includes("runtime, thread, report, or workflow state"),
  );
}

export function createDefaultGeneratedAgentContextState(
  now = new Date().toISOString(),
  revision = 1,
): GeneratedAgentContextState {
  const globalScope = { appGlobal: true, workspaceKeys: [] };
  const instructionBlocks: Record<string, GeneratedAgentContextInstructionBlock> = {
    common: {
      id: "common",
      title: "Common svvy Instructions",
      summary: "Shared behavior for all svvy prompt actors.",
      body: BASE_COMMON_INSTRUCTIONS,
      enabled: true,
      scope: globalScope,
      actor: "common",
      default: true,
    },
    orchestrator: {
      id: "orchestrator",
      title: "Orchestrator Instructions",
      summary: "Main strategic surface behavior and delegation routing.",
      body: BASE_ORCHESTRATOR_INSTRUCTIONS,
      enabled: true,
      scope: globalScope,
      actor: "orchestrator",
      default: true,
    },
    handler: {
      id: "handler",
      title: "Handler Thread Instructions",
      summary: "Delegated handler-thread behavior and workflow supervision rules.",
      body: BASE_HANDLER_INSTRUCTIONS,
      enabled: true,
      scope: globalScope,
      actor: "handler",
      default: true,
    },
    "workflow-task": {
      id: "workflow-task",
      title: "Workflow Task-Agent Instructions",
      summary: "Task-local workflow agent boundaries.",
      body: BASE_WORKFLOW_TASK_INSTRUCTIONS,
      enabled: true,
      scope: globalScope,
      actor: "workflow-task",
      default: true,
    },
  };

  return {
    version: 1,
    revision,
    updatedAt: now,
    instructionBlocks,
    actorRecipes: {
      orchestrator: {
        actor: "orchestrator",
        instructionBlockIds: ["common", "orchestrator"],
        generatedSectionIds: ["web-context", "execute-typescript"],
      },
      handler: {
        actor: "handler",
        instructionBlockIds: ["common", "handler"],
        generatedSectionIds: [
          "web-context",
          "smithers-core",
          "smithers-memory",
          "smithers-svvy-boundary",
          "workflow-authoring-contract",
          "handler-workflow-authoring-appendix",
          "execute-typescript",
        ],
      },
      "workflow-task": {
        actor: "workflow-task",
        instructionBlockIds: ["common", "workflow-task"],
        generatedSectionIds: ["web-context", "execute-typescript"],
      },
    },
  };
}

function getFallbackRecipe(actor: SvvyActorKind): GeneratedAgentContextActorRecipe {
  return createDefaultGeneratedAgentContextState().actorRecipes[actor];
}

function getEnabledInstructionBlock(
  state: GeneratedAgentContextState,
  id: string,
  workspaceKey?: string,
): GeneratedAgentContextInstructionBlock | null {
  const block = state.instructionBlocks[id];
  return block?.enabled && isPromptBlockActive(block.scope, workspaceKey) ? block : null;
}

function isPromptBlockActive(
  scope: { appGlobal: boolean; workspaceKeys: readonly string[] },
  workspaceKey?: string,
): boolean {
  return scope.appGlobal || (!!workspaceKey && scope.workspaceKeys.includes(workspaceKey));
}

export function buildSystemPromptFromLibrary(
  actor: SvvyActorKind,
  state: GeneratedAgentContextState,
  options: {
    loadedExtensionIds?: readonly string[];
    loadedExtensionRecords?: readonly ExtensionRecord[];
    availableExtensionIds?: readonly string[];
    availableExtensionRecords?: readonly ExtensionRecord[];
    extensionsRoot?: string;
    externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
    networkAccess?: boolean;
    workspaceKey?: string;
    requestUserInputSettings?: RequestUserInputSettings;
  } = {},
): string {
  return buildSystemPromptFromExtensionState(actor, {
    ...options,
    generatedAgentContextState: state,
    workspaceKey: options.workspaceKey,
  });
}

export function buildGeneratedAgentContextEntries(
  actor: SvvyActorKind,
  state: GeneratedAgentContextState,
  options: {
    loadedExtensionIds?: readonly string[];
    loadedExtensionRecords?: readonly ExtensionRecord[];
    availableExtensionIds?: readonly string[];
    availableExtensionRecords?: readonly ExtensionRecord[];
    extensionsRoot?: string;
    networkAccess?: boolean;
  } = {},
): GeneratedAgentContextEntry[] {
  if (
    options.loadedExtensionIds ||
    options.availableExtensionIds ||
    options.networkAccess === false
  ) {
    return buildGeneratedEntriesFromExtensionState(actor, options);
  }

  const recipe = state.actorRecipes[actor] ?? getFallbackRecipe(actor);
  return recipe.generatedSectionIds
    .map((id) => buildGeneratedAgentContextEntry(actor, id, options))
    .filter((entry): entry is GeneratedAgentContextEntry => Boolean(entry));
}

function buildGeneratedAgentContextEntry(
  actor: SvvyActorKind,
  id: GeneratedAgentContextSectionId,
  options: {
    loadedExtensionIds?: readonly string[];
    loadedExtensionRecords?: readonly ExtensionRecord[];
    extensionsRoot?: string;
  },
): GeneratedAgentContextEntry | null {
  if (id === "web-context") {
    return {
      id,
      title: "Web Context",
      source: "generated/instructions/full/010-tinyfish-cli.generated.md",
      sourcePath: "generated/instructions/full/010-tinyfish-cli.generated.md",
      content: buildWebPromptContext(actor),
    };
  }
  if (id === "smithers-core" && actor === "handler") {
    return {
      id,
      title: "Smithers Core Instructions",
      source: "generated/smithers-instructions.generated.ts",
      sourcePath: "generated/smithers-instructions.generated.ts",
      content: SMITHERS_CORE_INSTRUCTIONS,
    };
  }
  if (id === "smithers-memory" && actor === "handler") {
    return {
      id,
      title: "Smithers Memory Instructions",
      source: "generated/smithers-instructions.generated.ts",
      sourcePath: "generated/smithers-instructions.generated.ts",
      content: SMITHERS_MEMORY_INSTRUCTIONS,
    };
  }
  if (id === "smithers-svvy-boundary" && actor === "handler") {
    return {
      id,
      title: "Smithers svvy Boundary",
      source: "src/bun/smithers-runtime/workflow-authoring-guide.ts",
      sourcePath: "src/bun/smithers-runtime/workflow-authoring-guide.ts",
      content: SMITHERS_SVVY_BOUNDARY_APPENDIX,
    };
  }
  if (id === "workflow-authoring-contract" && actor === "handler") {
    return {
      id,
      title: "Workflow Authoring Contract",
      source: "generated/workflow-authoring-contract.generated.ts",
      sourcePath: "generated/workflow-authoring-contract.generated.ts",
      content: WORKFLOW_AUTHORING_CONTRACT_PROMPT_SECTION,
    };
  }
  if (id === "handler-workflow-authoring-appendix" && actor === "handler") {
    return {
      id,
      title: "Handler Workflow Authoring Appendix",
      source: "src/bun/smithers-runtime/workflow-authoring-guide.ts",
      sourcePath: "src/bun/smithers-runtime/workflow-authoring-guide.ts",
      content: HANDLER_WORKFLOW_AUTHORING_APPENDIX,
    };
  }
  if (id === "execute-typescript") {
    return {
      id,
      title: "Execute Typescript",
      source: "generated/execute-typescript-api.generated.ts",
      sourcePath: "generated/execute-typescript-api.generated.ts",
      content: buildExecuteTypescriptPromptSection(actor, {
        extensionsRoot: options.extensionsRoot,
        loadedExtensionIds: options.loadedExtensionIds,
        loadedExtensionRecords: options.loadedExtensionRecords,
      }),
    };
  }
  return null;
}

export function buildSystemPrompt(
  actor: SvvyActorKind,
  options: {
    loadedExtensionIds?: readonly string[];
    loadedExtensionRecords?: readonly ExtensionRecord[];
    availableExtensionIds?: readonly string[];
    availableExtensionRecords?: readonly ExtensionRecord[];
    extensionsRoot?: string;
    externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
    networkAccess?: boolean;
    generatedAgentContextState?: GeneratedAgentContextState;
    workspaceKey?: string;
    requestUserInputSettings?: RequestUserInputSettings;
  } = {},
): string {
  if (options.generatedAgentContextState) {
    return buildSystemPromptFromLibrary(actor, options.generatedAgentContextState, options);
  }
  return buildSystemPromptFromExtensionState(actor, options);
}

function buildSystemPromptFromExtensionState(
  actor: SvvyActorKind,
  options: {
    loadedExtensionIds?: readonly string[];
    loadedExtensionRecords?: readonly ExtensionRecord[];
    availableExtensionIds?: readonly string[];
    availableExtensionRecords?: readonly ExtensionRecord[];
    extensionsRoot?: string;
    externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
    networkAccess?: boolean;
    generatedAgentContextState?: GeneratedAgentContextState;
    workspaceKey?: string;
    requestUserInputSettings?: RequestUserInputSettings;
  } = {},
): string {
  const extensionState = resolvePromptExtensionState(actor, options);
  const loadedInstructionSections = buildLoadedInstructionSections(
    extensionState.loadedExtensionIds,
    options.loadedExtensionRecords ?? [],
  );
  const sections: string[] = [];
  const pushLoadedInstructionSection = (id: string): boolean => {
    const section = loadedInstructionSections.get(id);
    if (!section) return false;
    sections.push(section);
    loadedInstructionSections.delete(id);
    return true;
  };

  const externalInstructions = buildExternalInstructionSections(
    actor,
    options.externalInstructionSources ?? [],
  );
  let externalInstructionsInserted = false;
  const insertExternalInstructions = () => {
    if (!externalInstructions || externalInstructionsInserted) return;
    sections.push(externalInstructions);
    externalInstructionsInserted = true;
  };
  for (const [index, id] of extensionState.loadedExtensionIds.entries()) {
    sections.push(
      ...buildLoadedExtensionPromptSections({
        actor,
        extensionId: id,
        extensionState,
        externalInstructions,
        loadedInstructionSections,
        options,
        pushLoadedInstructionSection,
      }),
    );
    const nextId = extensionState.loadedExtensionIds[index + 1];
    if (id.startsWith("base-") && !nextId?.startsWith("base-")) {
      insertExternalInstructions();
    }
  }
  insertExternalInstructions();
  const availablePrompt = buildAvailableExtensionHints(
    extensionState.availableExtensionIds,
    options.availableExtensionRecords ?? [],
  );
  if (availablePrompt) {
    sections.push(availablePrompt);
  }
  return sections.join("\n\n");
}

function buildLoadedExtensionPromptSections(input: {
  actor: SvvyActorKind;
  extensionId: string;
  extensionState: { loadedExtensionIds: string[]; availableExtensionIds: string[] };
  externalInstructions: string | null;
  loadedInstructionSections: Map<string, string>;
  options: NonNullable<Parameters<typeof buildSystemPromptFromExtensionState>[1]>;
  pushLoadedInstructionSection: (id: string) => boolean;
}): string[] {
  const { actor, extensionId, options } = input;
  if (extensionId === "base-common") {
    if (input.pushLoadedInstructionSection(extensionId)) return [];
    const body = getLibraryInstructionBody(options, "common");
    return body ? body.split("\n\n") : buildCommonInstructions(actor);
  }
  if (extensionId === "base-orchestrator" && actor === "orchestrator") {
    if (input.pushLoadedInstructionSection(extensionId)) return [];
    return getActorInstructionBody(options, actor, BASE_ORCHESTRATOR_INSTRUCTIONS);
  }
  if (extensionId === "base-handler" && actor === "handler") {
    if (input.pushLoadedInstructionSection(extensionId)) return [];
    return getActorInstructionBody(options, actor, BASE_HANDLER_INSTRUCTIONS);
  }
  if (extensionId === "base-workflow-task" && actor === "workflow-task") {
    if (input.pushLoadedInstructionSection(extensionId)) return [];
    return getActorInstructionBody(options, actor, BASE_WORKFLOW_TASK_INSTRUCTIONS);
  }
  if (extensionId.startsWith("external_instruction:")) {
    return input.externalInstructions ? [input.externalInstructions] : [];
  }
  if (extensionId === "cx") {
    return [CX_CONTEXT_BODY];
  }
  if (extensionId === "shell") {
    return [SHELL_BASE_CONTEXT_BODY, SHELL_INCUR_CLI_CONTEXT_BODY];
  }
  if (extensionId === "apply-patch") {
    return [APPLY_PATCH_CONTEXT_BODY];
  }
  if (extensionId === "git") {
    return [GIT_CONTEXT_BODY];
  }
  if (extensionId === "github") {
    return [GITHUB_CONTEXT_BODY];
  }
  if (extensionId === "extension-loading") {
    return [EXTENSION_LOADING_CONTEXT_BODY];
  }
  if (extensionId === "extension-managing") {
    return [EXTENSION_MANAGING_CONTEXT_BODY];
  }
  if (extensionId === "request-user-input") {
    return [buildRequestUserInputContextBody(options.requestUserInputSettings)];
  }
  if (extensionId === "thread-orchestration") {
    return [THREAD_ORCHESTRATION_CONTEXT_BODY];
  }
  if (extensionId === "thread-handling") {
    return [THREAD_HANDLING_CONTEXT_BODY];
  }
  if (extensionId === "artifacts") {
    return [ARTIFACTS_CONTEXT_BODY];
  }
  if (extensionId === "smithers") {
    if (actor === "handler") {
      return [
        SMITHERS_HANDLER_CONTEXT_BODY,
        SMITHERS_CORE_INSTRUCTIONS,
        SMITHERS_SVVY_BOUNDARY_APPENDIX,
      ];
    }
    if (actor === "workflow-task") {
      return [SMITHERS_WORKFLOW_TASK_CONTEXT_BODY];
    }
    return [SMITHERS_ORCHESTRATOR_CONTEXT_BODY];
  }
  if (extensionId === "web") {
    return [buildWebPromptContext(actor)];
  }
  if (extensionId === "workflows") {
    return [WORKFLOW_AUTHORING_CONTRACT_PROMPT_SECTION, HANDLER_WORKFLOW_AUTHORING_APPENDIX];
  }
  if (extensionId === "execute-typescript") {
    return [
      buildExecuteTypescriptPromptSection(actor, {
        extensionsRoot: options.extensionsRoot,
        loadedExtensionIds: input.extensionState.loadedExtensionIds,
        loadedExtensionRecords: options.loadedExtensionRecords,
      }),
    ];
  }
  if (input.pushLoadedInstructionSection(extensionId)) return [];
  const record = getExtensionRecord(extensionId);
  const section = record ? buildLoadedInstructionSection(record) : null;
  if (section) return [section];
  return [];
}

function buildRequestUserInputContextBody(settings?: RequestUserInputSettings): string {
  return settings?.mode === "blocking"
    ? REQUEST_USER_INPUT_BLOCKING_CONTEXT_BODY
    : REQUEST_USER_INPUT_NONBLOCKING_CONTEXT_BODY;
}

function getActorInstructionBody(
  options: { generatedAgentContextState?: GeneratedAgentContextState; workspaceKey?: string },
  actor: SvvyActorKind,
  fallback: string,
): string[] {
  return (getLibraryInstructionBody(options, actor) ?? fallback).split("\n\n");
}

function buildExternalInstructionSections(
  actor: SvvyActorKind,
  sources: readonly GeneratedAgentContextExternalSource[],
): string | null {
  const sections = sources
    .filter(
      (source) =>
        source.enabled && source.readStatus.status === "readable" && source.actors.includes(actor),
    )
    .map((source) => {
      const content = source.content.trim();
      if (!content) return null;
      return [`External instruction: ${source.path}`, "", content].join("\n");
    })
    .filter((section): section is string => Boolean(section));
  if (sections.length === 0) {
    return null;
  }
  return ["Loaded external_instruction records:", ...sections].join("\n\n");
}

function buildLoadedInstructionSections(
  loadedExtensionIds: readonly string[],
  loadedExtensionRecords: readonly ExtensionRecord[],
): Map<string, string> {
  const recordsById = new Map(loadedExtensionRecords.map((record) => [record.id, record]));
  const sections = new Map<string, string>();
  for (const id of loadedExtensionIds) {
    if (hasBundledLoadedPromptSection(id)) continue;
    const record = recordsById.get(id);
    if (!record) continue;
    const section = buildLoadedInstructionSection(record);
    if (section) sections.set(record.id, section);
  }
  return sections;
}

function buildLoadedInstructionSection(record: ExtensionRecord): string | null {
  if (
    isBasePromptExtensionId(record.id) &&
    record.instructionSourceFiles.length === 1 &&
    record.instructionSourceFiles[0]?.endsWith("src/bun/default-system-prompt.ts")
  ) {
    return null;
  }
  const bypassedFiles = new Set(
    (record.instructionFiles ?? []).filter((file) => file.bypassed).map((file) => file.file),
  );
  const fileSections = record.instructionSourceFiles
    .map((file) => (isAbsolute(file) ? file : resolve(file)))
    .filter((file) => !bypassedFiles.has(file) && !bypassedFiles.has(basename(file)))
    .map((file) => {
      const content = readFileSync(file, "utf8").trim();
      if (!content) return null;
      return [`Instruction file: ${basename(file)}`, "", content].join("\n");
    })
    .filter((section): section is string => Boolean(section));
  if (fileSections.length === 0) return null;
  return [`Loaded extension: ${record.title}.`, ...fileSections].join("\n\n");
}

function isBasePromptExtensionId(id: string): boolean {
  return (
    id === "base-common" ||
    id === "base-orchestrator" ||
    id === "base-handler" ||
    id === "base-workflow-task"
  );
}

function hasBundledLoadedPromptSection(id: string): boolean {
  return (
    id === "cx" ||
    id === "shell" ||
    id === "apply-patch" ||
    id === "git" ||
    id === "github" ||
    id === "extension-loading" ||
    id === "extension-managing" ||
    id === "request-user-input" ||
    id === "thread-orchestration" ||
    id === "thread-handling" ||
    id === "artifacts" ||
    id === "smithers" ||
    id === "web" ||
    id === "workflows" ||
    id === "execute-typescript"
  );
}

function getLibraryInstructionBody(
  options: { generatedAgentContextState?: GeneratedAgentContextState; workspaceKey?: string },
  id: string,
): string | null {
  if (!options.generatedAgentContextState) {
    return null;
  }
  return (
    getEnabledInstructionBlock(options.generatedAgentContextState, id, options.workspaceKey)
      ?.body ?? null
  );
}

function buildGeneratedEntriesFromExtensionState(
  actor: SvvyActorKind,
  options: {
    loadedExtensionIds?: readonly string[];
    loadedExtensionRecords?: readonly ExtensionRecord[];
    availableExtensionIds?: readonly string[];
    availableExtensionRecords?: readonly ExtensionRecord[];
    extensionsRoot?: string;
    networkAccess?: boolean;
  } = {},
): GeneratedAgentContextEntry[] {
  const extensionState = resolvePromptExtensionState(actor, options);
  const loaded = new Set(extensionState.loadedExtensionIds);
  const entries: GeneratedAgentContextEntry[] = [];
  if (loaded.has("web")) {
    entries.push({
      id: "web-context",
      title: "Web Context",
      source: "generated/instructions/full/010-tinyfish-cli.generated.md",
      sourcePath: "generated/instructions/full/010-tinyfish-cli.generated.md",
      content: buildWebPromptContext(actor),
    });
  }
  if (loaded.has("smithers") && actor === "handler") {
    entries.push({
      id: "smithers-core",
      title: "Smithers Core Instructions",
      source: "generated/smithers-instructions.generated.ts",
      sourcePath: "generated/smithers-instructions.generated.ts",
      content: SMITHERS_CORE_INSTRUCTIONS,
    });
    entries.push({
      id: "smithers-memory",
      title: "Smithers Memory Instructions",
      source: "generated/smithers-instructions.generated.ts",
      sourcePath: "generated/smithers-instructions.generated.ts",
      content: SMITHERS_MEMORY_INSTRUCTIONS,
    });
    entries.push({
      id: "smithers-svvy-boundary",
      title: "Smithers svvy Boundary",
      source: "src/bun/smithers-runtime/workflow-authoring-guide.ts",
      sourcePath: "src/bun/smithers-runtime/workflow-authoring-guide.ts",
      content: SMITHERS_SVVY_BOUNDARY_APPENDIX,
    });
  }
  if (loaded.has("workflows")) {
    entries.push({
      id: "workflow-authoring-contract",
      title: "Workflow Authoring Contract",
      source: "generated/workflow-authoring-contract.generated.ts",
      sourcePath: "generated/workflow-authoring-contract.generated.ts",
      content: WORKFLOW_AUTHORING_CONTRACT_PROMPT_SECTION,
    });
    entries.push({
      id: "handler-workflow-authoring-appendix",
      title: "Handler Workflow Authoring Appendix",
      source: "src/bun/smithers-runtime/workflow-authoring-guide.ts",
      sourcePath: "src/bun/smithers-runtime/workflow-authoring-guide.ts",
      content: HANDLER_WORKFLOW_AUTHORING_APPENDIX,
    });
  }
  if (loaded.has("execute-typescript")) {
    entries.push({
      id: "execute-typescript",
      title: "Execute Typescript",
      source: "generated/execute-typescript-api.generated.ts",
      sourcePath: "generated/execute-typescript-api.generated.ts",
      content: buildExecuteTypescriptPromptSection(actor, {
        extensionsRoot: options.extensionsRoot,
        loadedExtensionIds: extensionState.loadedExtensionIds,
        loadedExtensionRecords: options.loadedExtensionRecords,
      }),
    });
  }
  return entries;
}

function resolvePromptExtensionState(
  actor: SvvyActorKind,
  options: {
    loadedExtensionIds?: readonly string[];
    availableExtensionIds?: readonly string[];
    networkAccess?: boolean;
  },
): { loadedExtensionIds: string[]; availableExtensionIds: string[] } {
  if (options.loadedExtensionIds || options.availableExtensionIds) {
    const filterUnavailable = (ids: readonly string[]): string[] =>
      ids.filter((id) => !(id === "web" && options.networkAccess === false));
    return {
      loadedExtensionIds: filterUnavailable(options.loadedExtensionIds ?? []),
      availableExtensionIds: filterUnavailable(options.availableExtensionIds ?? []),
    };
  }
  return resolveActorExtensionState({
    actor,
    networkAccess: options.networkAccess,
  });
}

function buildAvailableExtensionHints(
  availableExtensionIds: readonly string[],
  availableExtensionRecords: readonly ExtensionRecord[] = [],
): string | null {
  const recordsById = new Map(availableExtensionRecords.map((record) => [record.id, record]));
  const available = availableExtensionIds
    .map((id) => recordsById.get(id) ?? getExtensionRecord(id))
    .filter((record): record is ExtensionRecord => Boolean(record))
    .filter((record) => record.minimalLoadingHint.trim().length > 0)
    .map((record) => `- ${record.id}: ${record.minimalLoadingHint}`);
  if (available.length === 0) {
    return null;
  }
  return [
    "Available extensions:",
    ...available,
    "Use load_extension only when one of these ready extensions is needed for the current actor session.",
  ].join("\n");
}

export const DEFAULT_SYSTEM_PROMPT = buildSystemPrompt("orchestrator");
export const HANDLER_SYSTEM_PROMPT = buildSystemPrompt("handler");
export const WORKFLOW_TASK_SYSTEM_PROMPT = buildSystemPrompt("workflow-task");
