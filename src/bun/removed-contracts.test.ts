import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXECUTE_TYPESCRIPT_API_DECLARATION } from "../../generated/execute-typescript-api.generated";
import {
  DEFAULT_SYSTEM_PROMPT,
  HANDLER_SYSTEM_PROMPT,
  WORKFLOW_TASK_SYSTEM_PROMPT,
} from "./default-system-prompt";
import { createSvvyDirectTools } from "./svvy-direct-tools";
import { startThreadParamsSchema } from "./thread-start-tool";
import { BUILTIN_EXTENSIONS } from "../shared/extensions";

const REMOVED_TOOL_NAMES = [
  "thread_handoff",
  "thread_resume",
  "request_context",
  "wait",
  "runtime_current",
  "thread_handoffs",
  "smithers_run_workflow",
  "smithers_inspect_run",
  "smithers_list_runs",
  "workflow_list_assets",
  "workflow_list_models",
  "web_search",
  "web_fetch",
  "cx_overview",
  "cx_symbols",
  "cx_definition",
  "cx_references",
  "git_status",
  "github_pr",
] as const;

const REMOVED_PROMPT_FRAGMENTS = [
  "thread_handoff",
  "thread_resume",
  "request_context",
  "runtime_current",
  "thread_handoffs",
  "smithers_run_workflow",
  "smithers_* tools",
  "workflow_* discovery",
  "workflow_list_assets",
  "workflow_list_models",
  "web_search",
  "web_fetch",
  "cx_overview",
] as const;

const REMOVED_WORKFLOWS_RUNNER_COMMANDS = [
  "svvyx workflows run",
  "svvyx workflows resume",
  "svvyx workflows approve",
  "svvyx workflows inspect",
  "svvyx workflows debug",
  "svvyx workflows install",
  "svvyx workflows retrieve",
  "svvyx workflows promote",
  "svvyx workflows agents",
  "svvyx workflows components",
  "svvyx workflows prompts",
  "svvyx workflows workflows",
] as const;

describe("removed product contracts", () => {
  it("does not expose removed native direct tools or prompt-only CLI wrappers", () => {
    const tools = createSvvyDirectTools({ cwd: "/repo/svvy" }).codingTools;
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toContain("exec_command");
    expect(toolNames).toContain("write_stdin");
    expect(toolNames).toContain("apply_patch");
    for (const oldPiToolName of ["bash", "read", "grep", "find", "ls", "edit", "write"]) {
      expect(toolNames).not.toContain(oldPiToolName);
    }
    for (const removedToolName of REMOVED_TOOL_NAMES) {
      expect(toolNames).not.toContain(removedToolName);
    }
    expect(toolNames.some((toolName) => toolName.startsWith("smithers_"))).toBe(false);
    expect(toolNames.some((toolName) => toolName.startsWith("workflow_"))).toBe(false);
    expect(toolNames.some((toolName) => toolName.startsWith("web_"))).toBe(false);
    expect(toolNames.some((toolName) => toolName.startsWith("cx_"))).toBe(false);
    expect(toolNames.some((toolName) => toolName.startsWith("git_"))).toBe(false);
    expect(toolNames.some((toolName) => toolName.startsWith("github_"))).toBe(false);
  });

  it("keeps generated TypeScript snippets free of old broad API helpers", () => {
    for (const removedFragment of [
      "declare const api",
      "interface SvvyApi",
      "thread_handoff",
      "thread_resume",
      "request_context",
      "runtime_current",
      "smithers_",
      "workflow_",
      "web_search",
      "web_fetch",
      "cx_overview",
      "git_",
      "github_",
      "bash(",
    ]) {
      expect(EXECUTE_TYPESCRIPT_API_DECLARATION).not.toContain(removedFragment);
    }
  });

  it("keeps generated actor prompts free of removed wrappers and old context APIs", () => {
    for (const prompt of [
      DEFAULT_SYSTEM_PROMPT,
      HANDLER_SYSTEM_PROMPT,
      WORKFLOW_TASK_SYSTEM_PROMPT,
    ]) {
      for (const removedFragment of REMOVED_PROMPT_FRAGMENTS) {
        expect(prompt).not.toContain(removedFragment);
      }
      for (const removedCommand of REMOVED_WORKFLOWS_RUNNER_COMMANDS) {
        expect(prompt).not.toContain(removedCommand);
      }
      expect(prompt).not.toContain("Selected Web Provider");
      expect(prompt).not.toContain("Firecrawl");
    }
  });

  it("keeps Workflows guidance scoped to source-library commands, not workflow runners", () => {
    expect(HANDLER_SYSTEM_PROMPT).toContain("svvyx workflows list");
    expect(HANDLER_SYSTEM_PROMPT).toContain("svvyx workflows save");
    expect(HANDLER_SYSTEM_PROMPT).toContain("svvyx workflows build");
    expect(HANDLER_SYSTEM_PROMPT).toContain("svvyx workflows models list");
    for (const removedCommand of REMOVED_WORKFLOWS_RUNNER_COMMANDS) {
      expect(HANDLER_SYSTEM_PROMPT).not.toContain(removedCommand);
    }
  });

  it("keeps prompt-only CLI extensions as instructions instead of native or generated wrappers", () => {
    const byId = new Map(BUILTIN_EXTENSIONS.map((extension) => [extension.id, extension]));
    for (const id of ["cx", "git", "github", "web", "smithers"] as const) {
      expect(byId.get(id)).toMatchObject({
        interface: "instructions",
        typescriptApiEnabled: false,
      });
    }
    expect(byId.get("workflows")).toMatchObject({ interface: "svvyx" });
    expect(byId.get("artifacts")).toMatchObject({ interface: "svvyx" });
  });

  it("keeps thread_start on the grouped threads schema instead of the removed single-objective contract", () => {
    expect(Object.keys(startThreadParamsSchema.properties).toSorted()).toEqual([
      "threadGroupId",
      "threads",
    ]);
    expect(startThreadParamsSchema.properties).not.toHaveProperty("objective");
    expect(startThreadParamsSchema.properties).not.toHaveProperty("context");
  });

  it("does not keep obsolete implementation files for removed surfaces", () => {
    const root = join(import.meta.dir, "..", "..");
    for (const relativePath of [
      "src/bun/thread-handoff-tool.ts",
      "src/bun/thread-resume-tool.ts",
      "src/bun/request-context-tool.ts",
      "src/bun/wait-tool.ts",
      "src/bun/smithers-tools.ts",
      "src/bun/smithers-runtime/manager.ts",
      "src/bun/smithers-runtime/native-adapter.ts",
      "src/bun/smithers-runtime/workflow-registry.ts",
      "src/bun/smithers-runtime/workflow-task-agent.ts",
      "src/bun/smithers-runtime/workflow-launch-contract.ts",
      "src/bun/workflow-supervision-proof.test.ts",
      "src/bun/list-tools-tool.ts",
      "src/bun/cx-tools.ts",
      "src/bun/web-runtime/tools.ts",
      "src/bun/web-runtime/provider-contracts/firecrawl.ts",
      "src/bun/web-runtime/provider-contracts/tinyfish.ts",
      "src/bun/web-runtime/provider-prompts/firecrawl.ts",
      "src/bun/web-runtime/provider-prompts/tinyfish.ts",
      "src/bun/web-runtime/provider-registry.ts",
      "src/bun/web-runtime/providers/firecrawl.ts",
      "src/bun/web-runtime/providers/tinyfish.ts",
      "src/mainview/WorkflowInspectorPane.svelte",
      "src/mainview/WorkflowGraph.svelte",
      "src/mainview/SavedWorkflowLibraryPane.svelte",
      "src/shared/workflow-inspector.ts",
      "e2e/workflow-supervision.test.ts",
    ]) {
      expect(existsSync(join(root, relativePath))).toBe(false);
    }
  });

  it("does not keep Smithers bridge attention fields or DevTools guidance in current runtime code", () => {
    const root = join(import.meta.dir, "..", "..");
    const checkedFiles = [
      "src/bun/structured-session-state.ts",
      "src/bun/structured-session-selectors.ts",
      "src/shared/workspace-contract.ts",
      "src/bun/default-system-prompt.ts",
      "src/bun/smithers-runtime/workflow-authoring-guide.ts",
    ];
    for (const relativePath of checkedFiles) {
      const text = readFileSync(join(root, relativePath), "utf-8");
      expect(text).not.toContain("pendingAttentionSeq");
      expect(text).not.toContain("lastAttentionSeq");
      expect(text).not.toContain("pending_attention_seq");
      expect(text).not.toContain("last_attention_seq");
      expect(text).not.toContain("Smithers DevTools");
      expect(text).not.toContain("smithers devtools");
    }
  });

  it("does not bundle a stale Smithers runtime into the app package", () => {
    const root = join(import.meta.dir, "..", "..");
    const checkedFiles = [
      "package.json",
      "bun.lock",
      "electrobun.config.ts",
      "scripts/postbuild.ts",
    ];

    for (const relativePath of checkedFiles) {
      const text = readFileSync(join(root, relativePath), "utf-8");
      expect(text).not.toContain("smithers-orchestrator");
      expect(text).not.toContain("@smithers-orchestrator");
    }
    expect(existsSync(join(root, "src/types/smithers-cli-subpaths.d.ts"))).toBe(false);
  });
});
