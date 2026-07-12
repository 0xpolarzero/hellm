import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  AgentModelSelectionError,
  assertAgentModelSelection,
  formatSvvyxWorkflowsError,
  runSvvyxWorkflowsCommand,
  type SvvyxWorkflowsModelChoice,
} from "./svvyx-workflows-command";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

function modelChoice(
  overrides: Partial<SvvyxWorkflowsModelChoice> = {},
): SvvyxWorkflowsModelChoice {
  return {
    providerId: "openai",
    modelId: "gpt-5.4",
    providerAuthenticated: true,
    authSource: "oauth",
    supportedReasoning: ["off", "low", "medium", "high"],
    capabilities: {
      reasoning: true,
      vision: true,
      toolCalling: true,
    },
    ...overrides,
  };
}

describe("agent model selection validation", () => {
  it("accepts an authenticated pi-normalized model and supported reasoning level", () => {
    expect(
      assertAgentModelSelection(
        { providerId: "openai", modelId: "gpt-5.4", reasoningEffort: "medium" },
        [modelChoice()],
      ),
    ).toMatchObject({
      providerId: "openai",
      modelId: "gpt-5.4",
      providerAuthenticated: true,
    });
  });

  it("rejects models outside the pi-normalized catalog", () => {
    expect(() =>
      assertAgentModelSelection(
        { providerId: "openai", modelId: "missing-model", reasoningEffort: "medium" },
        [modelChoice()],
      ),
    ).toThrow(AgentModelSelectionError);

    try {
      assertAgentModelSelection(
        { providerId: "openai", modelId: "missing-model", reasoningEffort: "medium" },
        [modelChoice()],
      );
    } catch (error) {
      expect(error).toBeInstanceOf(AgentModelSelectionError);
      expect((error as AgentModelSelectionError).code).toBe("invalid_agent_model");
    }
  });

  it("rejects unsupported reasoning levels and exposes allowed values", () => {
    try {
      assertAgentModelSelection(
        { providerId: "openai", modelId: "gpt-5.4", reasoningEffort: "xhigh" },
        [modelChoice({ supportedReasoning: ["low", "medium"] })],
      );
    } catch (error) {
      expect(error).toBeInstanceOf(AgentModelSelectionError);
      expect((error as AgentModelSelectionError).code).toBe("invalid_agent_reasoning");
      expect((error as AgentModelSelectionError).supportedReasoning).toEqual(["low", "medium"]);
      return;
    }
    throw new Error("Expected unsupported reasoning level to fail.");
  });

  it("rejects unauthenticated provider models", () => {
    try {
      assertAgentModelSelection(
        { providerId: "anthropic", modelId: "claude-sonnet-4", reasoningEffort: "medium" },
        [
          modelChoice({
            providerId: "anthropic",
            modelId: "claude-sonnet-4",
            providerAuthenticated: false,
            authSource: "missing",
          }),
        ],
      );
    } catch (error) {
      expect(error).toBeInstanceOf(AgentModelSelectionError);
      expect((error as AgentModelSelectionError).code).toBe("invalid_agent_provider_auth");
      return;
    }
    throw new Error("Expected unauthenticated provider model to fail.");
  });

  it("rejects OAuth-backed models when the provider is connected but unusable", () => {
    try {
      assertAgentModelSelection(
        { providerId: "openai-codex", modelId: "gpt-5.4-mini", reasoningEffort: "low" },
        [
          modelChoice({
            providerId: "openai-codex",
            modelId: "gpt-5.4-mini",
            providerAuthenticated: false,
            authSource: "oauth",
            supportedReasoning: ["low", "medium"],
          }),
        ],
      );
    } catch (error) {
      expect(error).toBeInstanceOf(AgentModelSelectionError);
      expect((error as AgentModelSelectionError).code).toBe("invalid_agent_provider_auth");
      return;
    }
    throw new Error("Expected unusable OAuth-backed provider model to fail.");
  });
});

describe("svvyx workflows build", () => {
  it("awaits the parent Runtime generated-package request and returns its committed response", async () => {
    const requests: unknown[] = [];
    const result = await runSvvyxWorkflowsCommand({
      command: "svvyx workflows build --json",
      sourceCommandId: "command-workflows-build",
      requestWorkflowsRuntime: async (request) => {
        requests.push(request);
        return {
          output: { ok: true, items: [{ exportName: "reviewerAgent" }] },
          commandFacts: { workflowBuildOk: true, workflowExportCount: 1 },
        };
      },
    });
    expect(requests).toEqual([
      {
        operation: "build",
        input: { sourceCommandId: "command-workflows-build" },
      },
    ]);
    expect(result.commandFacts).toEqual({ workflowBuildOk: true, workflowExportCount: 1 });
  });
});

describe("svvyx workflows save", () => {
  it("fails closed before writing workflow-agent source without runtime authority", async () => {
    const cwd = createTempDir();
    const sourceRoot = join(cwd, "workflow-source");
    const authoringRoot = join(cwd, ".smithers", "workflows");
    const fromPath = join(authoringRoot, "reviewer.ts");
    mkdirSync(authoringRoot, { recursive: true });
    writeFileSync(
      fromPath,
      [
        "export const reviewer = Agents.defineTaskAgent({",
        '  id: "sourceReviewer",',
        '  label: "Reviewer",',
        '  provider: "openai",',
        '  model: "gpt-5.4",',
        '  reasoning: { effort: "medium" },',
        '  instructions: "Review strictly.",',
        '  overrides: { shell: "loaded" },',
        "});",
      ].join("\n"),
    );

    await expect(
      runSvvyxWorkflowsCommand({
        command:
          "svvyx workflows save --from .smithers/workflows/reviewer.ts --kind agent --export reviewer --as reviewerAgent --json",
        cwd,
        sourceRoot,
      }),
    ).rejects.toThrow("runtime-owned source edit authority");
    expect(existsSync(join(sourceRoot, "agents", "reviewerAgent.agent.json"))).toBe(false);
  });
});

describe("svvyx workflows unsupported runner and control verbs", () => {
  const unsupportedCommands = [
    "svvyx workflows run --json",
    "svvyx workflows resume --json",
    "svvyx workflows approve --json",
    "svvyx workflows inspect --json",
    "svvyx workflows debug --json",
    "svvyx workflows cancel --json",
    "svvyx workflows status --json",
    "svvyx workflows logs --json",
    "svvyx workflows retry --json",
    "svvyx workflows start --json",
    "svvyx workflows stop --json",
    "svvyx workflows pause --json",
    "svvyx workflows continue --json",
    "svvyx workflows install --json",
    "svvyx workflows retrieve --json",
    "svvyx workflows promote --json",
  ] as const;

  for (const command of unsupportedCommands) {
    it(`rejects ${command}`, async () => {
      try {
        await runSvvyxWorkflowsCommand({ command });
      } catch (error) {
        const output = formatSvvyxWorkflowsError(error);
        expect(output.error.code).toBe("unsupported_command");
        expect(output.error.message).toContain("Unsupported Workflows command:");
        return;
      }
      throw new Error(`Expected ${command} to be rejected.`);
    });
  }

  it("rejects unsupported models subcommands", async () => {
    try {
      await runSvvyxWorkflowsCommand({ command: "svvyx workflows models run --json" });
    } catch (error) {
      const output = formatSvvyxWorkflowsError(error);
      expect(output.error.code).toBe("unsupported_command");
      expect(output.error.message).toBe("Unsupported Workflows models command: run");
      return;
    }
    throw new Error("Expected models runner command to be rejected.");
  });
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "svvy-workflows-command-"));
  tempDirs.push(dir);
  return dir;
}
