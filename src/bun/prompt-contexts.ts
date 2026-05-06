import {
  OPTIONAL_PROMPT_CONTEXT_METADATA,
  isOptionalPromptContextKey,
  type OptionalPromptContextKey,
  type OptionalPromptContextMetadata,
  type PromptContextActor,
} from "../shared/prompt-context";

export type { OptionalPromptContextKey, PromptContextActor } from "../shared/prompt-context";

export interface OptionalPromptContext extends OptionalPromptContextMetadata {
  prompt: string;
}

const CX_CONTEXT_PROMPT = [
  "Loaded always-on prompt context: cx semantic code navigation.",
  "",
  "cx is the semantic code-navigation layer for repository inspection. Prefer cx for structural exploration before reading full files when cx can cover the language.",
  "",
  "Use this escalation order for code navigation:",
  "- `cx.overview` for a directory or file table of contents.",
  "- `cx.symbols` to search project symbols by kind, name glob, or file.",
  "- `cx.definition` to inspect a symbol body without reading the full file.",
  "- `cx.references` to find callers and usage sites.",
  "- `cx.lang.list` when you need to check whether a grammar is available or installed.",
  "- `cx.lang.add` when a relevant grammar is available but missing and semantic navigation would materially help the task.",
  "- `read`, `grep`, `find`, or `ls` when semantic navigation is insufficient, when raw text is required, or when cx cannot cover the target language.",
  "",
  "cx command behavior:",
  "- `cx.overview` accepts a path and can include full per-file detail for directories.",
  "- `cx.symbols` supports `kind`, `name`, `file`, pagination, and JSON output through the native tool result.",
  "- `cx.definition` supports `name`, `kind`, `from`, pagination, and `maxLines` for large bodies.",
  "- `cx.references` supports `name`, `file`, `unique`, pagination, and JSON output through the native tool result.",
  "- `cx.lang.list`, `cx.lang.add`, `cx.lang.remove`, `cx.cache.path`, and `cx.cache.clean` manage grammars and cache state.",
  "",
  "Use top-level `cx.*` tools for ordinary semantic navigation. Inside `execute_typescript`, use only the read-only `api.cx.*` subset when TypeScript control flow is needed for batching or aggregation.",
].join("\n");

const SMITHERS_ORCHESTRATOR_CONTEXT_PROMPT = [
  "Loaded always-on prompt context: Smithers workflow routing.",
  "",
  "Handler threads supervise Smithers workflow runs. The orchestrator knows this capability exists, but it does not receive `smithers.*` tool declarations.",
  "",
  "When work requires workflow execution, workflow authoring, workflow inspection, or Project CI workflow operation, delegate a bounded objective to a handler thread with `thread.start`.",
].join("\n");

const SMITHERS_HANDLER_CONTEXT_PROMPT = [
  "Loaded always-on prompt context: Smithers workflow supervision.",
  "",
  "Handler threads supervise Smithers workflow runs through native `smithers.*` tools. Use direct tools for simple repository work, then saved runnable entries, then artifact workflow authoring when a workflow graph is the right unit of work.",
  "",
  "Use `smithers.list_workflows` to discover runnable saved and artifact entries. Use `smithers.run_workflow({ workflowId, input, runId? })` to launch or resume a run after validating launch input against the returned contract.",
  "",
  "Use Smithers inspection and control tools for supervision: `smithers.get_run`, `smithers.watch_run`, `smithers.explain_run`, `smithers.list_pending_approvals`, `smithers.resolve_approval`, `smithers.get_node_detail`, `smithers.list_artifacts`, `smithers.get_chat_transcript`, `smithers.get_run_events`, `smithers.runs.cancel`, `smithers.signals.send`, `smithers.frames.list`, `smithers.getDevToolsSnapshot`, and `smithers.streamDevTools`.",
  "",
  "Workflow waits, approvals, retries, repairs, and resumptions stay inside the supervising handler thread. Call `thread.handoff` only after the current objective span is no longer running or waiting on an owned workflow run.",
].join("\n");

const SMITHERS_WORKFLOW_TASK_CONTEXT_PROMPT = [
  "Loaded always-on prompt context: Smithers task-agent boundary.",
  "",
  "This workflow task agent runs inside one Smithers task attempt. Smithers owns the task lifecycle, retries, validation, approval gates, and workflow state around this task.",
  "",
  "Complete the task with task-local tools. Do not attempt handler-thread or workflow-control operations such as `thread.start`, `thread.handoff`, `wait`, `request_context`, or `smithers.*`.",
].join("\n");

const CI_CONTEXT_PROMPT = [
  "Loaded optional prompt context: Project CI.",
  "",
  "Project CI is svvy's dedicated product lane for repeatable repository confidence checks. It uses normal handler-thread execution with this prompt context loaded.",
  "",
  "When configuring or modifying Project CI:",
  "- Inspect real repository facts first, including package scripts, lockfiles, task runners, existing CI files, Makefiles, README guidance, and test configuration.",
  "- Ask the user when the durable confidence policy is ambiguous.",
  "- Write reusable Project CI workflow assets only under `.svvy/workflows/{definitions,prompts,components,entries}/ci/`.",
  "- The conventional saved entry path is `.svvy/workflows/entries/ci/project-ci.tsx` and the conventional workflow id is `project_ci`.",
  '- CI entries are normal Smithers runnable saved entries. They must export `productKind = "project-ci" as const` and a `resultSchema`.',
  "- The entry's terminal output must validate against `resultSchema` and must contain a Project CI result with `status`, `summary`, and stable `checks`.",
  "- Use stable `checkId` values such as `typecheck`, `unit_tests`, `eslint`, `build`, `integration`, `docs`, or repository-specific ids.",
  "- Use open check `kind` strings; recommended kinds are `typecheck`, `test`, `lint`, `build`, `integration`, `docs`, and `manual`.",
  "- After writing saved workflow files, rely on the returned saved-workflow validation feedback and keep editing until the final saved workflow state validates cleanly.",
  '- Confirm the entry appears through `smithers.list_workflows({ productKind: "project-ci" })`, then run it with `smithers.run_workflow`.',
  "",
  "Project CI recording rules are strict:",
  '- Project CI records are created only from entries declaring `productKind = "project-ci"`.',
  "- The terminal output must directly validate against the entry's declared `resultSchema`.",
  "- Never infer CI state from logs, command names, labels, filenames, node output, final prose, or arbitrary workflow output.",
  "- Invalid or missing result output is a CI troubleshooting state.",
].join("\n");

export const OPTIONAL_PROMPT_CONTEXTS: Record<OptionalPromptContextKey, OptionalPromptContext> = {
  ci: {
    ...OPTIONAL_PROMPT_CONTEXT_METADATA.ci,
    prompt: CI_CONTEXT_PROMPT,
  },
};

export function validateOptionalPromptContextKeys(
  keys: readonly string[],
): OptionalPromptContextKey[] {
  const validKeys: OptionalPromptContextKey[] = [];
  const seen = new Set<OptionalPromptContextKey>();
  for (const key of keys) {
    if (!isOptionalPromptContextKey(key)) {
      throw new Error(`Unknown prompt context key: ${key}`);
    }
    if (!seen.has(key)) {
      seen.add(key);
      validKeys.push(key);
    }
  }
  return validKeys;
}

export function getOptionalPromptContext(key: OptionalPromptContextKey): OptionalPromptContext {
  return OPTIONAL_PROMPT_CONTEXTS[key];
}

export function buildAlwaysLoadedPromptContext(actor: PromptContextActor): string {
  const sections = [CX_CONTEXT_PROMPT];
  if (actor === "orchestrator") {
    sections.push(SMITHERS_ORCHESTRATOR_CONTEXT_PROMPT);
  } else if (actor === "handler") {
    sections.push(SMITHERS_HANDLER_CONTEXT_PROMPT);
  } else {
    sections.push(SMITHERS_WORKFLOW_TASK_CONTEXT_PROMPT);
  }
  return sections.join("\n\n");
}

export function buildOptionalPromptContextRegistryPrompt(): string {
  return [
    "Available optional prompt context keys:",
    '- `ci`: Project CI authoring guidance. If Project CI only needs to be run, discover configured CI entries with `smithers.list_workflows({ productKind: "project-ci" })` and run one through `smithers.run_workflow`. If Project CI needs to be configured or modified, call `request_context({ keys: ["ci"] })` before authoring CI assets.',
  ].join("\n");
}

export function buildOrchestratorContextRoutingPrompt(): string {
  return [
    "Optional prompt context routing:",
    '- `ci` is available for Project CI authoring. When a delegated objective clearly needs Project CI configuration or modification from the first handler turn, pass `context: ["ci"]` to `thread.start`.',
  ].join("\n");
}

export function buildLoadedOptionalPromptContextPrompt(
  keys: readonly string[],
): string | undefined {
  const validKeys = validateOptionalPromptContextKeys(keys);
  if (validKeys.length === 0) {
    return undefined;
  }

  return validKeys.map((key) => getOptionalPromptContext(key).prompt).join("\n\n");
}
