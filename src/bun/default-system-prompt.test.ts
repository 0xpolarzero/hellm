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
  it("embeds the generated execute_typescript API contract", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "The full execute_typescript SDK contract follows and is the source of truth",
    );
    expect(DEFAULT_SYSTEM_PROMPT).toContain(EXECUTE_TYPESCRIPT_API_DECLARATION.trim());
    expect(DEFAULT_SYSTEM_PROMPT).toContain("interface SvvyApi");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("listAssets(input?: WorkflowListAssetsInput)");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("listModels(): Promise<WorkflowModelInfo[]>");
  });

  it("explicitly steers snippets away from Node built-ins and toward api.exec.run", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Do not import or assume Node.js built-ins");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("api.exec.run({ command, args, cwd, timeoutMs, env })");
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
      "Ordinary replies inside a handler thread do not close it",
    );
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "Workflow waits, approvals, and resumes stay inside this handler thread.",
    );
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "Do not call thread.start from this surface in the adopted supervision model.",
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
    expect(HANDLER_SYSTEM_PROMPT).toContain("interface WorkflowTaskAgentProfile");
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
    expect(HANDLER_WORKFLOW_AUTHORING_APPENDIX).not.toContain("interface WorkflowTaskAgentProfile");
    expect(HANDLER_WORKFLOW_AUTHORING_APPENDIX).not.toContain("interface SvvyApi");
    expect(HANDLER_WORKFLOW_AUTHORING_APPENDIX).not.toContain(
      "listAssets(input?: WorkflowListAssetsInput)",
    );
  });

  it("injects full handler context only after that context pack is loaded", () => {
    expect(buildSystemPrompt("handler")).not.toContain("Loaded handler context pack: Project CI.");

    const handlerPrompt = buildSystemPrompt("handler", { loadedContextKeys: ["ci"] });

    expect(handlerPrompt).toContain("Loaded handler context pack: Project CI.");
    expect(handlerPrompt).toContain('productKind = "project-ci"');
    expect(handlerPrompt).toContain("resultSchema");
  });

  it("gives workflow task agents an execute_typescript-only product surface", () => {
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toBe(buildSystemPrompt("workflow-task"));
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toContain(
      "This surface is a Smithers workflow task agent.",
    );
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toContain(
      "Your only callable product tool is execute_typescript.",
    );
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toContain(
      "Do not attempt handler-thread or orchestrator control actions such as thread.start, thread.handoff, wait, or smithers.*.",
    );
  });
});
