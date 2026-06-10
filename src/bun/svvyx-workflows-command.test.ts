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
import type { ExtensionCliRequirement } from "../shared/extensions";

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
});

describe("svvyx workflows build", () => {
  it("forwards Extension CLI probe failures and stops before workflow-agent validation", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "workflows-source");
    const generatedPackagePath = join(root, "generated", "workflows-package");
    const extensionsGeneratedPackagePath = join(root, "generated", "extensions-package");
    const extensionsRoot = join(root, "extensions");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeUserSvvyxExtension({
      cliRequirements: [
        {
          id: "needs-cli",
          binary: "needs-cli",
          package: "needs-cli",
          required: true,
          version: "1.2.3",
          installCommand: "npm install -g needs-cli@1.2.3",
        },
      ],
      extensionId: "needs-cli",
      extensionsRoot,
    });
    writeFileSync(
      join(sourceRoot, "agents", "reviewerAgent.agent.json"),
      JSON.stringify(
        {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: "Review CLI-gated extension references.",
          extensions: ["needs-cli", "missing-workflow-extension"],
        },
        null,
        2,
      ),
    );

    const probedRequirements: string[] = [];
    try {
      await runSvvyxWorkflowsCommand({
        command: "svvyx workflows build --json",
        extensionsCliProbe: (requirement) => {
          probedRequirements.push(requirement.id);
          return {
            id: requirement.id,
            binary: requirement.binary,
            package: requirement.package ?? null,
            required: requirement.required,
            defaultVersion: requirement.version ?? null,
            currentVersion: null,
            latestVersion: null,
            status: "missing",
            updateAvailable: false,
            detectedVersion: null,
            path: null,
            versionCommand: requirement.versionCommand ?? null,
            installCommand: requirement.installCommand ?? null,
            updateCommand: null,
          };
        },
        extensionsGeneratedPackagePath,
        extensionsRoot,
        generatedPackagePath,
        readModelCatalog: () => [modelChoice()],
        sourceRoot,
      });
    } catch (error) {
      const output = formatSvvyxWorkflowsError(error);
      expect(probedRequirements).toEqual(["needs-cli"]);
      expect(output.error.code).toBe("build_failed");
      expect(output.error.diagnostics).toEqual([
        expect.objectContaining({
          code: "extension_build_failed",
          exportName: "needs-cli",
          message: "needs-cli 1.2.3 is required by needs-cli but was not found on PATH.",
        }),
      ]);
      expect(output.error.diagnostics?.map((diagnostic) => diagnostic.message)).not.toContain(
        "Workflow agent reviewerAgent references unavailable extension missing-workflow-extension.",
      );
      expect(existsSync(generatedPackagePath)).toBe(false);
      expect(existsSync(extensionsGeneratedPackagePath)).toBe(false);
      return;
    }
    throw new Error("Expected Workflows build to fail on missing Extension CLI.");
  });
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "svvy-workflows-command-"));
  tempDirs.push(dir);
  return dir;
}

function writeUserSvvyxExtension(input: {
  cliRequirements?: ExtensionCliRequirement[];
  extensionId: string;
  extensionsRoot: string;
}): void {
  const sourceRoot = join(input.extensionsRoot, "sources", "user", input.extensionId);
  mkdirSync(join(sourceRoot, "source"), { recursive: true });
  writeFileSync(
    join(sourceRoot, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: input.extensionId,
        title: input.extensionId,
        description: `${input.extensionId} extension`,
        interface: "svvyx",
        typescriptApiEnabled: true,
        instructionFiles: [],
        ...(input.cliRequirements ? { cliRequirements: input.cliRequirements } : {}),
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(sourceRoot, "source", "index.ts"),
    [
      'import { Cli, z } from "incur";',
      "",
      `const cli = Cli.create(${JSON.stringify(input.extensionId)});`,
      'cli.command("issues.list", {',
      "  output: z.object({ ok: z.boolean() }),",
      "  run() {",
      "    return { ok: true };",
      "  },",
      "});",
      "",
      "export default cli;",
      "",
    ].join("\n"),
  );
}
