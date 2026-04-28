import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createSessionAgentSettingsStore } from "./session-agent-settings";

describe("session agent settings", () => {
  it("persists app-wide session defaults and seeds conventional workflow agents", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-agent-settings-"));
    const store = createSessionAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
    });

    const updated = store.setSessionAgentDefault("quickSession", {
      provider: "openai",
      model: "gpt-5.4-mini",
      reasoningEffort: "low",
      systemPrompt: "Handle short direct work.",
    });

    expect(updated.sessionAgents.quickSession).toEqual({
      provider: "openai",
      model: "gpt-5.4-mini",
      reasoningEffort: "low",
      systemPrompt: "Handle short direct work.",
    });
    expect(updated.sessionAgents.namer.provider).toBe("openai-codex");
    expect(updated.sessionAgents.namer.model).toBe("gpt-5.4-mini");
    expect(updated.sessionAgents.namer.reasoningEffort).toBe("low");

    const agentsPath = store.ensureWorkflowAgentsComponent();
    const agentsSource = readFileSync(agentsPath, "utf8");
    expect(agentsSource).toContain("@svvyAssetKind component");
    expect(agentsSource).toContain("export const explorer");
    expect(agentsSource).toContain("export const implementer");
    expect(agentsSource).toContain("export const reviewer");
    expect(agentsSource).toContain('"toolSurface": [');
    expect(agentsSource).toContain('"execute_typescript"');
  });

  it("keeps workflow agent settings synchronized with agents.ts", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-workflow-agent-settings-"));
    const store = createSessionAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
    });

    store.setWorkflowAgent("reviewer", {
      id: "reviewer",
      label: "Reviewer",
      provider: "anthropic",
      model: "claude-sonnet-4",
      reasoningEffort: "high",
      systemPrompt: "Review strictly.",
      toolSurface: ["execute_typescript"],
    });

    const agentsSource = readFileSync(
      join(root, ".svvy", "workflows", "components", "agents.ts"),
      "utf8",
    );
    expect(agentsSource).toContain('"provider": "anthropic"');
    expect(agentsSource).toContain('"model": "claude-sonnet-4"');
    expect(agentsSource).toContain('"reasoningEffort": "high"');
    expect(store.getState().workflowAgents.reviewer.systemPrompt).toBe("Review strictly.");
  });
});
