import { describe, expect, it } from "bun:test";
import {
  buildSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
  HANDLER_SYSTEM_PROMPT,
  WORKFLOW_TASK_SYSTEM_PROMPT,
} from "./default-system-prompt";
import { EXECUTE_TYPESCRIPT_API_DECLARATION } from "../../generated/execute-typescript-api.generated";
import { WORKFLOW_AUTHORING_CONTRACT_DECLARATION } from "../../generated/workflow-authoring-contract.generated";
import { HANDLER_WORKFLOW_AUTHORING_APPENDIX } from "./smithers-runtime/workflow-authoring-guide";

describe("default system prompt", () => {
  it("puts core coding-agent operating policy into every coding surface", () => {
    for (const prompt of [
      DEFAULT_SYSTEM_PROMPT,
      HANDLER_SYSTEM_PROMPT,
      WORKFLOW_TASK_SYSTEM_PROMPT,
    ]) {
      expect(prompt).toContain("Inspect repository facts before making structural assumptions");
      expect(prompt).toContain("Keep edits narrowly scoped to the requested behavior");
      expect(prompt).toContain("Treat the worktree as shared user state");
      expect(prompt).toContain("Do not revert, overwrite, rename, clean up");
      expect(prompt).toContain("Validate proportionally to risk");
      expect(prompt).toContain("When asked for review, use a code-review stance");
      expect(prompt).toContain("Use cx.* for semantic code navigation");
      expect(prompt).toContain("use cx.lang.list and cx.lang.add");
      expect(prompt).toContain("use bash when the work actually requires a shell command");
    }
  });

  it("embeds the generated execute_typescript API contract", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "The execute_typescript contract follows and is the source of truth",
    );
    expect(DEFAULT_SYSTEM_PROMPT).toContain(EXECUTE_TYPESCRIPT_API_DECLARATION.trim());
    expect(DEFAULT_SYSTEM_PROMPT).toContain("interface SvvyApi");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("list_assets(");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("list_models(): Promise<ToolResult");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("api.cx");
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "Loaded always-on prompt context: cx semantic code navigation.",
    );
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "Loaded always-on prompt context: Smithers workflow routing.",
    );
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("providerModelSummary");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("toolsetSummary");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("subtype?: string");
  });

  it("explicitly steers snippets away from Node built-ins and toward duplicated direct tools", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Do not import or assume Node.js built-ins");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("bash(input:");
  });

  it("describes the adopted orchestrator and handler-thread tool split", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toBe(buildSystemPrompt("orchestrator"));
    expect(DEFAULT_SYSTEM_PROMPT).toContain("delegate with thread.start");
    expect(DEFAULT_SYSTEM_PROMPT).toContain('context: ["ci"]');
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "Handler threads can supervise workflows through smithers.* tools",
    );
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("return control with thread.handoff");

    expect(HANDLER_SYSTEM_PROMPT).toBe(buildSystemPrompt("handler"));
    expect(HANDLER_SYSTEM_PROMPT).toContain("return control with thread.handoff");
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "Loaded always-on prompt context: Smithers workflow supervision.",
    );
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "Ordinary replies inside a handler thread do not close it",
    );
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "Workflow waits, approvals, and resumes stay inside this handler thread.",
    );
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "Do not call thread.start from this surface in the adopted supervision model.",
    );
    expect(HANDLER_SYSTEM_PROMPT).toContain(".svvy/workflows/components/agents.ts");
    expect(HANDLER_SYSTEM_PROMPT).toContain("explorer");
    expect(HANDLER_SYSTEM_PROMPT).toContain("implementer");
    expect(HANDLER_SYSTEM_PROMPT).toContain("reviewer");
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "define a task-specific agent in the artifact workflow",
    );
    expect(HANDLER_SYSTEM_PROMPT).toContain("Workflow authoring guide for handler threads:");
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "The handler workflow-authoring TypeScript contract follows",
    );
    expect(HANDLER_SYSTEM_PROMPT).toContain(WORKFLOW_AUTHORING_CONTRACT_DECLARATION.trim());
    expect(HANDLER_SYSTEM_PROMPT).toContain(".svvy/artifacts/workflows/<artifact_workflow_id>/");
    expect(HANDLER_SYSTEM_PROMPT).toContain('request_context({ keys: ["ci"] })');
    expect(EXECUTE_TYPESCRIPT_API_DECLARATION).not.toContain("request_context");
  });

  it("injects generated workflow authoring contracts only into handler prompts", () => {
    expect(HANDLER_SYSTEM_PROMPT).toContain("interface RunnableWorkflowEntryModule");
    expect(HANDLER_SYSTEM_PROMPT).toContain("interface WorkflowTaskAgentConfig");
    expect(HANDLER_SYSTEM_PROMPT).toContain("type SvvyWorkflowTaskAgent = AgentLike");
    expect(HANDLER_SYSTEM_PROMPT).toContain("createSmithers");
    expect(HANDLER_SYSTEM_PROMPT).toContain("launchSchema");
    expect(HANDLER_SYSTEM_PROMPT).toContain("createRunnableEntry");
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      'import type { AgentLike } from "smithers-orchestrator";',
    );

    expect(DEFAULT_SYSTEM_PROMPT).not.toContain(WORKFLOW_AUTHORING_CONTRACT_DECLARATION.trim());
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).not.toContain(
      WORKFLOW_AUTHORING_CONTRACT_DECLARATION.trim(),
    );
    expect(HANDLER_WORKFLOW_AUTHORING_APPENDIX).not.toContain("interface WorkflowTaskAgentConfig");
    expect(HANDLER_WORKFLOW_AUTHORING_APPENDIX).not.toContain("interface SvvyApi");
    expect(HANDLER_WORKFLOW_AUTHORING_APPENDIX).toContain("workflow.list_assets");
  });

  it("injects optional prompt context only after that context is loaded", () => {
    expect(buildSystemPrompt("handler")).not.toContain(
      "Loaded optional prompt context: Project CI.",
    );

    const handlerPrompt = buildSystemPrompt("handler", { loadedContextKeys: ["ci"] });

    expect(handlerPrompt).toContain("Loaded optional prompt context: Project CI.");
    expect(handlerPrompt).toContain('productKind = "project-ci"');
    expect(handlerPrompt).toContain("resultSchema");
  });

  it("gives workflow task agents a direct-tool product surface plus code mode", () => {
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toBe(buildSystemPrompt("workflow-task"));
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toContain(
      "This surface is a Smithers workflow task agent.",
    );
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toContain(
      "Use the task-local direct tools for repository work and execute_typescript only for typed composition.",
    );
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toContain(
      "Do not attempt handler-thread or orchestrator control actions such as thread.start, thread.handoff, wait, request_context, or smithers.*.",
    );
  });
});
