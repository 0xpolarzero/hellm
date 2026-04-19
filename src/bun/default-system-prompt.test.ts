import { describe, expect, it } from "bun:test";
import { DEFAULT_SYSTEM_PROMPT } from "./default-system-prompt";
import { EXECUTE_TYPESCRIPT_API_DECLARATION } from "./generated/execute-typescript-api.generated";

describe("default system prompt", () => {
  it("embeds the generated execute_typescript API contract", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "The full execute_typescript SDK contract follows and is the source of truth",
    );
    expect(DEFAULT_SYSTEM_PROMPT).toContain(EXECUTE_TYPESCRIPT_API_DECLARATION.trim());
    expect(DEFAULT_SYSTEM_PROMPT).toContain("interface SvvyApi");
  });

  it("explicitly steers snippets away from Node built-ins and toward api.exec.run", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Do not import or assume Node.js built-ins");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("api.exec.run({ command, args, cwd, timeoutMs, env })");
  });

  it("describes the orchestrator and handler-thread tool split", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("thread.start");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("thread.handoff");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("workflow.start and workflow.resume");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Inside handler threads");
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "Ordinary replies inside a handler thread do not close it",
    );
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "immediately opens an orchestrator reconciliation turn",
    );
  });

  it("steers verification toward workflow templates", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Verification is workflow-shaped execution");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("workflow templates or presets");
  });
});
