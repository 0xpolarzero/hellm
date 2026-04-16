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
});
