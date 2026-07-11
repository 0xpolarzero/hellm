import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { buildSystemPrompt } from "./default-system-prompt";
import { createGeneratedAgentContextStore } from "./generated-agent-context-store";

const tempDirs: string[] = [];

function createTempAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "svvy-generated-agent-context-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("generated agent context store", () => {
  it("seeds app-wide JSON with the current default prompt composition", () => {
    const store = createGeneratedAgentContextStore({ agentDir: createTempAgentDir() });
    const state = store.getState();

    expect(state.revision).toBe(1);
    expect(buildSystemPrompt("orchestrator", { generatedAgentContextState: state })).toBe(
      buildSystemPrompt("orchestrator"),
    );
    expect(buildSystemPrompt("handler", { generatedAgentContextState: state })).toBe(
      buildSystemPrompt("handler"),
    );
  });

  it("reloads an existing generated context file for prompt composition", () => {
    const agentDir = createTempAgentDir();
    const persisted = structuredClone(createGeneratedAgentContextStore({ agentDir }).getState());
    persisted.revision = 7;
    persisted.instructionBlocks.common!.body = "Persisted generated context marker.";
    writeFileSync(
      join(agentDir, "generated-agent-context.json"),
      `${JSON.stringify(persisted, null, 2)}\n`,
    );

    const reloaded = createGeneratedAgentContextStore({ agentDir }).getState();

    expect(reloaded.revision).toBe(7);
    expect(buildSystemPrompt("orchestrator", { generatedAgentContextState: reloaded })).toContain(
      "Persisted generated context marker.",
    );
  });

  it("does not expose the removed prompt library contract names", () => {
    const oldSharedModule = new URL("../shared/prompt-library.ts", import.meta.url);
    const oldStoreModule = new URL("./prompt-library-store.ts", import.meta.url);
    const contractSource = readFileSync(
      new URL("../shared/workspace-contract.ts", import.meta.url),
      "utf8",
    );
    const rendererRuntimeSource = readFileSync(
      new URL("../mainview/chat-runtime.ts", import.meta.url),
      "utf8",
    );
    const bunRuntimeSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const storeSource = readFileSync(
      new URL("./generated-agent-context-store.ts", import.meta.url),
      "utf8",
    );
    const catalogSource = readFileSync(new URL("./session-catalog.ts", import.meta.url), "utf8");

    expect(existsSync(oldSharedModule)).toBe(false);
    expect(existsSync(oldStoreModule)).toBe(false);
    for (const source of [
      contractSource,
      rendererRuntimeSource,
      bunRuntimeSource,
      storeSource,
      catalogSource,
    ]) {
      expect(source).not.toContain("PromptLibrary");
      expect(source).not.toContain("promptLibrary");
      expect(source).not.toContain("Prompt library");
      expect(source).not.toContain("prompt library");
      expect(source).not.toContain("Context library");
      expect(source).not.toContain("context library");
      expect(source).not.toContain("context-library");
      expect(source).not.toContain("getPromptLibrary");
      expect(source).not.toContain("updatePromptLibrary");
      expect(source).not.toContain("resetPromptLibrary");
    }
  });
});
