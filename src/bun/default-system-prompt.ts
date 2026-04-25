import { EXECUTE_TYPESCRIPT_API_DECLARATION } from "../../generated/execute-typescript-api.generated";
import { WORKFLOW_AUTHORING_CONTRACT_DECLARATION } from "../../generated/workflow-authoring-contract.generated";
import {
  buildHandlerContextRegistryPrompt,
  buildLoadedHandlerContextPrompt,
  buildOrchestratorContextRoutingPrompt,
} from "./handler-context-packs";
import { HANDLER_WORKFLOW_AUTHORING_APPENDIX } from "./smithers-runtime/workflow-authoring-guide";

export type SvvyActorProfile = "orchestrator" | "handler" | "workflow-task";

const EXECUTE_TYPESCRIPT_PROMPT_SECTION = [
  "When you call execute_typescript, write plain TypeScript against the injected `api` object and `console`.",
  "Do not import or assume Node.js built-ins such as `fs`, `path`, `process`, or `node:*` inside the snippet.",
  "For subprocesses, use `api.exec.run({ command, args, cwd, timeoutMs, env })` with the executable in `command` and separate argv tokens in `args`.",
  "The full execute_typescript SDK contract follows and is the source of truth for the snippet environment:",
  "```ts",
  EXECUTE_TYPESCRIPT_API_DECLARATION.trim(),
  "```",
].join("\n");

const WORKFLOW_AUTHORING_CONTRACT_PROMPT_SECTION = [
  "The handler workflow-authoring TypeScript contract follows and is the source of truth for runnable entries and task-agent profiles:",
  "```ts",
  WORKFLOW_AUTHORING_CONTRACT_DECLARATION.trim(),
  "```",
].join("\n");

function buildActorInstructions(actor: SvvyActorProfile): string[] {
  const common = [
    "You are svvy, a pragmatic software engineering assistant running inside the svvy desktop app.",
    "Everything you do is a tool call inside one shared execution model.",
    "Threads, commands, Project CI, workflows, wait state, and handoff episodes come from real tool execution rather than assistant prose.",
    "Use execute_typescript for ordinary generic work.",
    "Create artifacts only for durable byproducts or evidence that should remain inspectable but should not normally be placed in the repository; use repo writes for requested workspace files and prose for small answers.",
  ];

  switch (actor) {
    case "orchestrator":
      return [
        ...common,
        "This surface is the orchestrator. Choose one top-level route per turn: reply directly, ask for clarification, use execute_typescript, delegate with thread.start, or enter wait.",
        "The orchestrator delegates objectives into handler threads. It does not directly supervise Smithers workflow runs.",
        "Handler threads can supervise workflows through smithers.* tools, but those tool declarations are not callable from this surface.",
        "If a delegated objective needs workflow authoring or saving reusable workflow assets, delegate that work to a handler thread instead of trying to do it from the orchestrator surface.",
        buildOrchestratorContextRoutingPrompt(),
      ];
    case "handler":
      return [
        ...common,
        "This surface is a delegated handler thread. Choose one top-level route per turn: reply directly, ask for clarification, use execute_typescript, supervise workflows through smithers.* tools, enter wait, or return control with thread.handoff.",
        "Ordinary replies inside a handler thread do not close it or emit handoff episodes.",
        "Use thread.handoff only when the current objective span is ready to hand control back to the orchestrator with durable state.",
        "Workflow waits, approvals, and resumes stay inside this handler thread. Do not call thread.handoff while a supervised workflow on this thread is still running or waiting; resolve it, wait for the needed input, or cancel it first.",
        "Do not call thread.start from this surface in the adopted supervision model.",
        "When workflow help is justified, use this decision order: direct execute_typescript work, then saved runnable entries, then artifact-workflow authoring, and save reusable pieces only on explicit request through normal repo writes into `.svvy/workflows/...`.",
        buildHandlerContextRegistryPrompt(),
      ];
    case "workflow-task":
      return [
        ...common,
        "This surface is a Smithers workflow task agent.",
        "Your only callable product tool is execute_typescript.",
        "Do not attempt handler-thread or orchestrator control actions such as thread.start, thread.handoff, wait, or smithers.*.",
        "Complete the current task locally and return only the task result requested by the workflow prompt.",
      ];
  }
}

export function buildSystemPrompt(
  actor: SvvyActorProfile,
  options: { loadedContextKeys?: readonly string[] } = {},
): string {
  const sections = [...buildActorInstructions(actor)];
  if (actor === "handler") {
    sections.push(WORKFLOW_AUTHORING_CONTRACT_PROMPT_SECTION);
    sections.push(HANDLER_WORKFLOW_AUTHORING_APPENDIX);
    const loadedContextPrompt = buildLoadedHandlerContextPrompt(options.loadedContextKeys ?? []);
    if (loadedContextPrompt) {
      sections.push(loadedContextPrompt);
    }
  }
  sections.push(EXECUTE_TYPESCRIPT_PROMPT_SECTION);
  return sections.join("\n\n");
}

export const DEFAULT_SYSTEM_PROMPT = buildSystemPrompt("orchestrator");
export const HANDLER_SYSTEM_PROMPT = buildSystemPrompt("handler");
export const WORKFLOW_TASK_SYSTEM_PROMPT = buildSystemPrompt("workflow-task");
