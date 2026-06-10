import {
  isOptionalPromptContextKey,
  type OptionalPromptContextKey,
  type OptionalPromptContextMetadata,
  type PromptContextActor,
} from "../shared/prompt-context";
import { buildCxPromptContext } from "./cx-runtime/prompt-context";
import { buildWebPromptContext } from "./web-runtime/prompt-context";

export type { OptionalPromptContextKey, PromptContextActor } from "../shared/prompt-context";

export interface OptionalPromptContext extends OptionalPromptContextMetadata {
  prompt: string;
}

const SMITHERS_ORCHESTRATOR_CONTEXT_PROMPT = [
  "Loaded always-on prompt context: Smithers workflow routing.",
  "",
  "Handler threads use official Smithers CLI commands through Shell for workflow work. The orchestrator knows this capability exists, but it does not receive `smithers_*` tool declarations or product workflow wrappers.",
  "",
  "When work requires workflow execution, workflow authoring, or workflow inspection, delegate a bounded objective to a handler thread with `thread_start`. Use `thread_followup({ activate: true })` when a concluded handler thread already has the right delegated context for follow-up work.",
].join("\n");

const SMITHERS_HANDLER_CONTEXT_PROMPT = [
  "Loaded prompt-only extension: Smithers CLI workflow authoring.",
  "",
  "Handler threads use official Smithers CLI commands through Shell against workspace `.smithers/` source. Smithers adds no native tools, no generated TypeScript clients, and no product workflow wrapper tools.",
  "",
  "Use `smithers init`, `smithers workflow run`, `smithers ps`, and `smithers inspect` as ordinary shell commands when Smithers work is the right unit.",
  "",
  "Use `svvyx workflows list`, `svvyx workflows save`, `svvyx workflows build`, and `svvyx workflows models list` only for reusable app-global Workflows source-library operations.",
  "",
  "When the delegated objective has an important update, call `thread_report`. Include `outcome` only when the current handler objective is concluded.",
].join("\n");

const SMITHERS_WORKFLOW_TASK_CONTEXT_PROMPT = [
  "Loaded always-on prompt context: Smithers task-agent boundary.",
  "",
  "Smithers owns task lifecycle, retries, validation, approval gates, and workflow state whenever an official Smithers workflow invokes a task agent.",
].join("\n");

export const OPTIONAL_PROMPT_CONTEXTS: Record<OptionalPromptContextKey, OptionalPromptContext> = {};

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
  const context = OPTIONAL_PROMPT_CONTEXTS[key];
  if (!context) {
    throw new Error(`Unknown prompt context key: ${key}`);
  }
  return context;
}

export function buildAlwaysLoadedPromptContext(
  actor: PromptContextActor,
  options: { networkAccess?: boolean } = {},
): string {
  const sections = [buildCxPromptContext()];
  if (actor === "orchestrator") {
    sections.push(SMITHERS_ORCHESTRATOR_CONTEXT_PROMPT);
  } else if (actor === "handler") {
    sections.push(SMITHERS_HANDLER_CONTEXT_PROMPT);
  } else {
    sections.push(SMITHERS_WORKFLOW_TASK_CONTEXT_PROMPT);
  }
  if (options.networkAccess !== false) {
    sections.push(buildWebPromptContext(actor));
  }
  return sections.join("\n\n");
}

export function buildOptionalPromptContextRegistryPrompt(): string {
  return [
    "Available optional prompt context keys:",
    "- No optional prompt context keys are part of the current product surface.",
  ].join("\n");
}

export function buildOrchestratorContextRoutingPrompt(): string {
  return [
    "Optional prompt context routing:",
    "No optional prompt context keys are part of the current product surface. Delegate workflow authoring with `thread_start({ threads: [...] })` when a handler thread is the correct unit.",
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
