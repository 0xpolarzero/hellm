import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  buildSystemPrompt,
  createDefaultGeneratedAgentContextState,
} from "./default-system-prompt";
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

  it("persists updates and reset restores the seeded default", () => {
    const agentDir = createTempAgentDir();
    const store = createGeneratedAgentContextStore({ agentDir });
    const state = store.getState();
    const updated = structuredClone(state);
    updated.instructionBlocks.common!.body = "Use the persisted generated agent context.";

    const saved = store.updateState(updated);
    expect(saved.revision).toBe(2);
    expect(buildSystemPrompt("orchestrator", { generatedAgentContextState: saved })).toContain(
      "Use the persisted generated agent context.",
    );

    const reloaded = createGeneratedAgentContextStore({ agentDir });
    expect(reloaded.getState().instructionBlocks.common!.body).toBe(
      "Use the persisted generated agent context.",
    );

    const reset = store.resetState();
    expect(reset).toEqual(
      createDefaultGeneratedAgentContextState(reset.updatedAt, saved.revision + 1),
    );
    expect(buildSystemPrompt("orchestrator", { generatedAgentContextState: reset })).toBe(
      buildSystemPrompt("orchestrator"),
    );
  });

  it("creates, renames, and restores named snapshots", () => {
    const agentDir = createTempAgentDir();
    const store = createGeneratedAgentContextStore({ agentDir });
    const initial = store.getState();
    const changed = structuredClone(initial);
    changed.instructionBlocks.common!.body = "Snapshot this instruction.";
    const saved = store.updateState(changed);

    const snapshot = store.createSnapshot("Stable prompt");
    expect(snapshot.name).toBe("Stable prompt");
    expect(snapshot.revision).toBe(saved.revision);
    expect(store.listSnapshots()).toEqual([snapshot]);

    const renamed = store.renameSnapshot(snapshot.id, "Release prompt");
    expect(renamed.name).toBe("Release prompt");
    expect(store.listSnapshots()[0]?.name).toBe("Release prompt");

    const next = structuredClone(saved);
    next.instructionBlocks.common!.body = "A later autosaved edit.";
    store.updateState(next);

    const restored = store.restoreSnapshot(snapshot.id);
    expect(restored.revision).toBe(4);
    expect(restored.instructionBlocks.common!.body).toBe("Snapshot this instruction.");

    const reloaded = createGeneratedAgentContextStore({ agentDir });
    expect(reloaded.listSnapshots()[0]?.name).toBe("Release prompt");
    expect(reloaded.getState().instructionBlocks.common!.body).toBe("Snapshot this instruction.");
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
