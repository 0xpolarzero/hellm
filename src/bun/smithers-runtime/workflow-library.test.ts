import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { ExtensionDependencyApprovalStore } from "../extension-dependency-approval-store";
import {
  buildWorkflowsGeneratedPackage,
  ensureExtensionsPackageLink,
  ensureWorkflowsPackageLink,
  extractWorkflowAgentParametersFromSource,
  extractWorkflowSourceExportItem,
  getExtensionsGeneratedPackagePath,
  getWorkflowsGeneratedPackagePath,
  getWorkflowsSourceRoot,
  readWorkflowsGeneratedReadModel,
} from "./workflow-library";
import type { SvvyxWorkflowsModelChoice } from "../svvyx-workflows-command";

const tempDirs: string[] = [];

describe("Workflows generated read model", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { force: true, recursive: true });
      }
    }
  });

  it("uses app-global package roots instead of source-checkout workflow assets", () => {
    const projectRoot = join(import.meta.dir, "..", "..", "..");
    const repoWorkflowsRoot = join(projectRoot, "workflows");
    const sourceRoot = getWorkflowsSourceRoot();
    const packageRoot = getWorkflowsGeneratedPackagePath();
    const extensionsPackageRoot = getExtensionsGeneratedPackagePath();

    expect(sourceRoot).toEndWith(join(".config", "svvy", "workflows"));
    expect(packageRoot).toBe(join(sourceRoot, "generated", "package"));
    expect(extensionsPackageRoot).toEndWith(
      join(".config", "svvy", "extensions", "generated", "package"),
    );
    expect(sourceRoot).not.toBe(repoWorkflowsRoot);
    expect(packageRoot).not.toContain(repoWorkflowsRoot);
    expect(extensionsPackageRoot).not.toContain(repoWorkflowsRoot);
  });

  it("surfaces generated namespace exports with source links and agent parameters", async () => {
    const root = createTempDir();
    const packageRoot = join(root, "generated", "package");
    mkdirSync(join(packageRoot, "agents"), { recursive: true });
    mkdirSync(join(packageRoot, "components"), { recursive: true });

    writeFileSync(
      join(packageRoot, "agents", "reviewerAgent.ts"),
      [
        "export const reviewerAgent = {",
        '  id: "reviewerAgent",',
        '  label: "Reviewer",',
        '  provider: "openai",',
        '  model: "gpt-5.4",',
        '  reasoningEffort: "medium",',
        '  instructions: "Review strictly.",',
        '  extensions: ["git"],',
        "} satisfies Agents.TaskAgentParameters;",
      ].join("\n"),
    );
    writeFileSync(
      join(packageRoot, "agents", "index.ts"),
      [
        'export { reviewerAgent } from "./reviewerAgent";',
        "export function defineTaskAgent() { return null; }",
      ].join("\n"),
    );
    writeFileSync(
      join(packageRoot, "components", "ReviewPanel.tsx"),
      "export function ReviewPanel() { return null; }\n",
    );

    const model = await readWorkflowsGeneratedReadModel(packageRoot, {
      sourceRoot: join(root, "source"),
    });

    expect(model.counts).toEqual({
      agent: 1,
      component: 1,
      prompt: 0,
      workflow: 0,
    });
    expect(model.items.map((item) => item.qualifiedName)).toEqual([
      "Agents.reviewerAgent",
      "Components.ReviewPanel",
    ]);
    expect(model.items[0]).toMatchObject({
      kind: "agent",
      namespace: "Agents",
      exportName: "reviewerAgent",
      qualifiedName: "Agents.reviewerAgent",
      sourcePath: join(root, "source", "agents", "reviewerAgent.agent.json"),
      generatedPath: join(packageRoot, "agents", "reviewerAgent.ts"),
      agentProfileId: "reviewerAgent",
      agentParameters: {
        id: "reviewerAgent",
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        instructions: "Review strictly.",
        extensions: ["git"],
      },
    });
  });

  it("builds @svvy/workflows from app-global source with namespace-only root exports", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    mkdirSync(join(sourceRoot, "components"), { recursive: true });
    mkdirSync(join(sourceRoot, "prompts"), { recursive: true });
    mkdirSync(join(sourceRoot, "workflows"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "agents", "reviewerAgent.agent.json"),
      JSON.stringify(
        {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: "Review strictly.",
          extensions: ["shell"],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(sourceRoot, "components", "ReviewPanel.tsx"),
      "export function ReviewPanel() { return null; }\n",
    );
    writeFileSync(join(sourceRoot, "prompts", "ReviewPrompt.mdx"), "# Review\n");
    writeFileSync(
      join(sourceRoot, "workflows", "ReviewWorkflow.tsx"),
      "export function ReviewWorkflow() { return null; }\n",
    );

    const build = await buildWorkflowsGeneratedPackage({
      generatedPackagePath: packageRoot,
      modelCatalog: [modelChoice()],
      sourceRoot,
    });

    expect(build.ok).toBe(true);
    expect(readFileSync(join(packageRoot, "index.ts"), "utf8")).toBe(
      [
        'export * as Agents from "./agents";',
        'export * as Components from "./components";',
        'export * as Prompts from "./prompts";',
        'export * as Workflows from "./workflows";',
        "",
      ].join("\n"),
    );
    expect(readFileSync(join(packageRoot, "index.ts"), "utf8")).not.toContain("reviewerAgent");
    expect(existsSync(join(packageRoot, ".svvy-workflows-manifest.json"))).toBe(true);
    for (const publicPath of [
      join(packageRoot, "index.ts"),
      join(packageRoot, "agents", "index.ts"),
      join(packageRoot, "agents", "reviewerAgent.ts"),
      join(packageRoot, "components", "ReviewPanel.tsx"),
      join(packageRoot, "prompts", "ReviewPrompt.ts"),
      join(packageRoot, "workflows", "ReviewWorkflow.tsx"),
    ]) {
      const publicCode = readFileSync(publicPath, "utf8");
      expect(publicCode).not.toContain("__exports");
      expect(publicCode).not.toContain("sourcePath");
      expect(publicCode).not.toContain("generatedPath");
      expect(publicCode).not.toContain(".svvy-workflows-manifest");
    }
    const agentsIndex = readFileSync(join(packageRoot, "agents", "index.ts"), "utf8");
    expect(agentsIndex).toContain("export interface TaskAgentParameters");
    expect(agentsIndex).toContain("  id: string;");
    expect(agentsIndex).toContain("export function defineTaskAgent<T extends TaskAgentParameters>");
    expect(readFileSync(join(packageRoot, "agents", "index.ts"), "utf8")).toContain(
      'export { reviewerAgent } from "./reviewerAgent";',
    );
    expect(existsSync(join(packageRoot, "components", "ReviewPanel.tsx"))).toBe(true);
    expect(existsSync(join(packageRoot, "prompts", "ReviewPrompt.ts"))).toBe(true);
    expect(existsSync(join(packageRoot, "workflows", "ReviewWorkflow.tsx"))).toBe(true);

    const model = await readWorkflowsGeneratedReadModel(packageRoot, { sourceRoot });
    expect(model.items.map((item) => item.qualifiedName)).toEqual([
      "Agents.reviewerAgent",
      "Components.ReviewPanel",
      "Prompts.ReviewPrompt",
      "Workflows.ReviewWorkflow",
    ]);
    expect(model.items.find((item) => item.qualifiedName === "Prompts.ReviewPrompt")).toMatchObject(
      {
        sourcePath: join(sourceRoot, "prompts", "ReviewPrompt.mdx"),
        generatedPath: join(packageRoot, "prompts", "ReviewPrompt.ts"),
      },
    );
  });

  it("links generated Workflows packages into Smithers workspaces without replacing non-symlinks", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const workspaceCwd = join(root, "workspace");
    const packageRoot = join(root, "generated", "package");
    const extensionsPackageRoot = join(root, "generated", "extensions-package");
    mkdirSync(join(sourceRoot, "prompts"), { recursive: true });
    mkdirSync(join(workspaceCwd, ".smithers"), { recursive: true });
    writeFileSync(join(sourceRoot, "prompts", "ReviewPrompt.mdx"), "# Review\n");

    const build = await buildWorkflowsGeneratedPackage({
      extensionsGeneratedPackagePath: extensionsPackageRoot,
      generatedPackagePath: packageRoot,
      modelCatalog: [],
      sourceRoot,
      workspaceCwds: [workspaceCwd],
    });
    const linkPath = join(workspaceCwd, ".smithers", "node_modules", "@svvy", "workflows");
    const extensionsLinkPath = join(
      workspaceCwd,
      ".smithers",
      "node_modules",
      "@svvy",
      "extensions",
    );

    expect(build.linkedWorkspaces).toEqual([workspaceCwd]);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkPath)).toBe(packageRoot);
    expect(lstatSync(extensionsLinkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(extensionsLinkPath)).toBe(extensionsPackageRoot);

    rmSync(linkPath);
    mkdirSync(linkPath);
    expect(() =>
      ensureWorkflowsPackageLink({ generatedPackagePath: packageRoot, workspaceCwd }),
    ).toThrow("Cannot replace non-symlink");

    rmSync(extensionsLinkPath);
    mkdirSync(extensionsLinkPath);
    expect(() =>
      ensureExtensionsPackageLink({
        extensionsGeneratedPackagePath: extensionsPackageRoot,
        generatedPackagePath: packageRoot,
        workspaceCwd,
      }),
    ).toThrow("Cannot replace non-symlink");
  });

  it("fails builds on invalid workflow-agent model, reasoning, and extension references", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "agents", "badAgent.agent.json"),
      JSON.stringify(
        {
          id: "badAgent",
          label: "Bad Agent",
          provider: "openai",
          model: "missing-model",
          reasoningEffort: "xhigh",
          instructions: "Review strictly.",
          extensions: ["missing-extension"],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(sourceRoot, "agents", "badReasoningAgent.agent.json"),
      JSON.stringify(
        {
          id: "badReasoningAgent",
          label: "Bad Reasoning Agent",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "xhigh",
          instructions: "Review strictly.",
          extensions: ["shell"],
        },
        null,
        2,
      ),
    );

    const build = await buildWorkflowsGeneratedPackage({
      generatedPackagePath: packageRoot,
      modelCatalog: [modelChoice()],
      sourceRoot,
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics.map((diagnostic) => diagnostic.code).toSorted()).toEqual(
      ["invalid_agent_model", "invalid_agent_reasoning", "invalid_agent_extension"].toSorted(),
    );
    expect(existsSync(packageRoot)).toBe(false);
  });

  it("fails builds when workflow-agent ids diverge from generated Agents export names", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "agents", "reviewerAgent.agent.json"),
      JSON.stringify(
        {
          id: "strictReviewer",
          label: "Strict Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: "Review strictly.",
          extensions: ["shell"],
        },
        null,
        2,
      ),
    );

    const build = await buildWorkflowsGeneratedPackage({
      generatedPackagePath: packageRoot,
      modelCatalog: [modelChoice()],
      sourceRoot,
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "invalid_agent_parameters",
        exportName: "reviewerAgent",
        message: "Workflow agent reviewerAgent id must match its source filename.",
      }),
    );
    expect(existsSync(packageRoot)).toBe(false);
  });

  it("fails builds on unauthenticated providers and workflow-task-unavailable extensions", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "agents", "blockedAgent.agent.json"),
      JSON.stringify(
        {
          id: "blockedAgent",
          label: "Blocked Agent",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: "Review strictly.",
          extensions: ["workflows"],
        },
        null,
        2,
      ),
    );

    const build = await buildWorkflowsGeneratedPackage({
      generatedPackagePath: packageRoot,
      modelCatalog: [{ ...modelChoice(), providerAuthenticated: false }],
      sourceRoot,
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "invalid_agent_provider_auth",
      "invalid_agent_extension",
    ]);
  });

  it("generates and links @svvy/extensions for workflow agent extension references", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    const extensionsPackageRoot = join(root, "generated", "extensions-package");
    const workspaceCwd = join(root, "workspace");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    mkdirSync(join(workspaceCwd, ".smithers"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "agents", "reviewerAgent.agent.json"),
      JSON.stringify(
        {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: "Review strictly.",
          extensions: ["git", "github"],
        },
        null,
        2,
      ),
    );

    const build = await buildWorkflowsGeneratedPackage({
      extensionsGeneratedPackagePath: extensionsPackageRoot,
      generatedPackagePath: packageRoot,
      modelCatalog: [modelChoice()],
      sourceRoot,
      workspaceCwds: [workspaceCwd],
    });

    expect(build.ok).toBe(true);
    expect(readFileSync(join(extensionsPackageRoot, "package.json"), "utf8")).toContain(
      '"name": "@svvy/extensions"',
    );
    const extensionsIndex = readFileSync(join(extensionsPackageRoot, "index.ts"), "utf8");
    expect(extensionsIndex).toContain('"git": "git"');
    expect(extensionsIndex).toContain('"github": "github"');
    expect(extensionsIndex).not.toContain('"workflows": "workflows"');
    const generatedAgent = readFileSync(join(packageRoot, "agents", "reviewerAgent.ts"), "utf8");
    expect(generatedAgent).toContain('import { Extensions } from "@svvy/extensions";');
    expect(generatedAgent).toContain('Extensions["git"]');
    expect(generatedAgent).toContain('Extensions["github"]');
    expect(generatedAgent).not.toContain('"extensions": [\n    "git"');
    const generatedAgentsIndex = readFileSync(join(packageRoot, "agents", "index.ts"), "utf8");
    expect(generatedAgentsIndex).toContain('import type { ExtensionId } from "@svvy/extensions";');
    expect(generatedAgentsIndex).toContain("export type TaskAgentExtensionId = ExtensionId;");
    expect(build.items[0]?.agentParameters?.extensions).toEqual(["git", "github"]);
    const readModel = await readWorkflowsGeneratedReadModel(packageRoot, { sourceRoot });
    expect(readModel.items[0]?.agentParameters?.extensions).toEqual(["git", "github"]);
    expect(
      readlinkSync(join(workspaceCwd, ".smithers", "node_modules", "@svvy", "workflows")),
    ).toBe(packageRoot);
    expect(
      readlinkSync(join(workspaceCwd, ".smithers", "node_modules", "@svvy", "extensions")),
    ).toBe(extensionsPackageRoot);
  });

  it("derives workflow-agent generated extensions from tri-state source usage", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const generatedPackagePath = join(root, "generated", "workflows-package");
    const extensionsPackageRoot = join(root, "generated", "extensions-package");
    const workspaceCwd = join(root, "workspace");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    mkdirSync(join(workspaceCwd, ".smithers"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "agents", "reviewerAgent.agent.json"),
      JSON.stringify(
        {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: "Review the implementation.",
          extensions: ["workflows"],
          extensionUsage: {
            github: "default_loaded",
            git: "available",
            workflows: "default_loaded",
          },
        },
        null,
        2,
      ),
    );

    const build = await buildWorkflowsGeneratedPackage({
      sourceRoot,
      generatedPackagePath,
      extensionsGeneratedPackagePath: extensionsPackageRoot,
      modelCatalog: [modelChoice()],
      workspaceCwds: [workspaceCwd],
    });

    expect(build.ok).toBe(true);
    expect(build.items[0]?.agentParameters?.extensions).toEqual(["github"]);
    const generatedAgent = readFileSync(
      join(generatedPackagePath, "agents", "reviewerAgent.ts"),
      "utf8",
    );
    expect(generatedAgent).toContain('Extensions["github"]');
    expect(generatedAgent).not.toContain("Extensions.workflows");
    expect(generatedAgent).not.toContain("extensionUsage");
  });

  it("includes ready user svvyx TypeScript extensions in @svvy/extensions", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    const extensionsPackageRoot = join(root, "generated", "extensions-package");
    const extensionsRoot = join(root, "extensions");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeReadyUserExtension({
      extensionsRoot,
      extensionId: "linear-tools",
      typescriptApiEnabled: true,
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
          instructions: "Review strict Linear context.",
          extensions: ["git", "linear-tools"],
        },
        null,
        2,
      ),
    );

    const build = await buildWorkflowsGeneratedPackage({
      extensionsGeneratedPackagePath: extensionsPackageRoot,
      extensionsRoot,
      generatedPackagePath: packageRoot,
      modelCatalog: [modelChoice()],
      sourceRoot,
    });

    expect(build.ok).toBe(true);
    const extensionsIndex = readFileSync(join(extensionsPackageRoot, "index.ts"), "utf8");
    expect(extensionsIndex).toContain('"git": "git"');
    expect(extensionsIndex).toContain('"linear-tools": "linear-tools"');
    const generatedAgent = readFileSync(join(packageRoot, "agents", "reviewerAgent.ts"), "utf8");
    expect(generatedAgent).toContain('Extensions["git"]');
    expect(generatedAgent).toContain('Extensions["linear-tools"]');
    expect(build.items[0]?.agentParameters?.extensions).toEqual(["git", "linear-tools"]);
  });

  it("includes dependency-backed user svvyx extensions after exact package artifacts are installed", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    const extensionsPackageRoot = join(root, "generated", "extensions-package");
    const extensionsRoot = join(root, "extensions");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeReadyUserExtension({
      extensionsRoot,
      extensionId: "installed-api",
      dependencies: [{ kind: "dependency", name: "@notes/sdk", version: "1.2.3" }],
      typescriptApiEnabled: true,
    });
    writeInstalledExtensionPackage(extensionsRoot, "@notes/sdk", "1.2.3");
    approveExtensionDependency(extensionsRoot, {
      kind: "dependency",
      name: "@notes/sdk",
      version: "1.2.3",
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
          instructions: "Review dependency-backed extension references.",
          extensions: ["installed-api"],
        },
        null,
        2,
      ),
    );

    const build = await buildWorkflowsGeneratedPackage({
      extensionsGeneratedPackagePath: extensionsPackageRoot,
      extensionsRoot,
      generatedPackagePath: packageRoot,
      modelCatalog: [modelChoice()],
      sourceRoot,
    });

    expect(build.ok).toBe(true);
    const extensionIds = readFileSync(join(extensionsPackageRoot, "index.ts"), "utf8");
    expect(extensionIds).toContain('"installed-api": "installed-api"');
    const generatedAgent = readFileSync(join(packageRoot, "agents", "reviewerAgent.ts"), "utf8");
    expect(generatedAgent).toContain('Extensions["installed-api"]');
    expect(build.items[0]?.agentParameters?.extensions).toEqual(["installed-api"]);
  });

  it("rejects dependency-backed user svvyx extensions with exact artifacts but no approval ledger entry", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    const extensionsPackageRoot = join(root, "generated", "extensions-package");
    const extensionsRoot = join(root, "extensions");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeReadyUserExtension({
      extensionsRoot,
      extensionId: "unapproved-api",
      dependencies: [{ kind: "dependency", name: "@notes/sdk", version: "1.2.3" }],
      typescriptApiEnabled: true,
    });
    writeInstalledExtensionPackage(extensionsRoot, "@notes/sdk", "1.2.3");
    writeFileSync(
      join(sourceRoot, "agents", "reviewerAgent.agent.json"),
      JSON.stringify(
        {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: "Review unapproved dependency-backed extension references.",
          extensions: ["unapproved-api"],
        },
        null,
        2,
      ),
    );

    const build = await buildWorkflowsGeneratedPackage({
      extensionsGeneratedPackagePath: extensionsPackageRoot,
      extensionsRoot,
      generatedPackagePath: packageRoot,
      modelCatalog: [modelChoice()],
      sourceRoot,
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Workflow agent reviewerAgent references unavailable extension unapproved-api.",
    ]);
    expect(existsSync(join(extensionsPackageRoot, "index.ts"))).toBe(false);
  });

  it("rebuilds stale and unbuilt user svvyx TypeScript extensions before workflow validation", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    const extensionsPackageRoot = join(root, "generated", "extensions-package");
    const extensionsRoot = join(root, "extensions");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeReadyUserExtension({
      extensionsRoot,
      extensionId: "unbuilt-api",
      currentBuild: false,
      typescriptApiEnabled: true,
    });
    writeReadyUserExtension({
      extensionsRoot,
      extensionId: "stale-api",
      typescriptApiEnabled: true,
    });
    writeFileSync(
      join(extensionsRoot, "sources", "user", "stale-api", "instructions.md"),
      "changed after build\n",
    );
    writeFileSync(
      join(sourceRoot, "agents", "reviewerAgent.agent.json"),
      JSON.stringify(
        {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: "Review rebuilt extension references.",
          extensions: ["unbuilt-api", "stale-api"],
        },
        null,
        2,
      ),
    );

    const build = await buildWorkflowsGeneratedPackage({
      extensionsGeneratedPackagePath: extensionsPackageRoot,
      extensionsRoot,
      generatedPackagePath: packageRoot,
      modelCatalog: [modelChoice()],
      sourceRoot,
    });

    expect(build.ok).toBe(true);
    expect(build.diagnostics).toEqual([]);
    const extensionsIndex = readFileSync(join(extensionsPackageRoot, "index.ts"), "utf8");
    expect(extensionsIndex).toContain('"stale-api": "stale-api"');
    expect(extensionsIndex).toContain('"unbuilt-api": "unbuilt-api"');
    const generatedAgent = readFileSync(join(packageRoot, "agents", "reviewerAgent.ts"), "utf8");
    expect(generatedAgent).toContain('Extensions["stale-api"]');
    expect(generatedAgent).toContain('Extensions["unbuilt-api"]');
    expect(build.items[0]?.agentParameters?.extensions).toEqual(["unbuilt-api", "stale-api"]);
  });

  it("fails before workflow-agent validation when user extension build inputs are invalid", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    const extensionsPackageRoot = join(root, "generated", "extensions-package");
    const extensionsRoot = join(root, "extensions");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeReadyUserExtension({
      extensionsRoot,
      extensionId: "broken-api",
      typescriptApiEnabled: true,
    });
    writeFileSync(
      join(extensionsRoot, "sources", "user", "broken-api", "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          id: "broken-api",
          title: "broken-api",
          description: "broken-api extension",
          interface: "svvyx",
          typescriptApiEnabled: true,
          instructionFiles: [{ file: "missing.md", bypassed: false }],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(sourceRoot, "agents", "reviewerAgent.agent.json"),
      JSON.stringify(
        {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: "Review broken extension context.",
          extensions: ["missing-workflow-extension"],
        },
        null,
        2,
      ),
    );

    const build = await buildWorkflowsGeneratedPackage({
      extensionsGeneratedPackagePath: extensionsPackageRoot,
      extensionsRoot,
      generatedPackagePath: packageRoot,
      modelCatalog: [modelChoice()],
      sourceRoot,
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toEqual([
      expect.objectContaining({
        code: "invalid_extension_source",
        exportName: "broken-api",
        message: "Instruction config references unknown file: missing.md",
      }),
    ]);
    expect(build.diagnostics.map((diagnostic) => diagnostic.message)).not.toContain(
      "Workflow agent reviewerAgent references unavailable extension missing-workflow-extension.",
    );
    expect(existsSync(join(extensionsPackageRoot, "index.ts"))).toBe(false);
    expect(existsSync(packageRoot)).toBe(false);
  });

  it("validates all user extension sources before rebuilding dirty extensions", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    const extensionsPackageRoot = join(root, "generated", "extensions-package");
    const extensionsRoot = join(root, "extensions");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeReadyUserExtension({
      extensionsRoot,
      extensionId: "buildable-api",
      currentBuild: false,
      typescriptApiEnabled: true,
    });
    writeReadyUserExtension({
      extensionsRoot,
      extensionId: "broken-api",
      typescriptApiEnabled: true,
    });
    writeFileSync(
      join(extensionsRoot, "sources", "user", "broken-api", "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          id: "broken-api",
          title: "broken-api",
          description: "broken-api extension",
          interface: "svvyx",
          typescriptApiEnabled: true,
          instructionFiles: [{ file: "missing.md", bypassed: false }],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(sourceRoot, "agents", "reviewerAgent.agent.json"),
      JSON.stringify(
        {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: "Review extension preflight ordering.",
          extensions: ["buildable-api", "missing-workflow-extension"],
        },
        null,
        2,
      ),
    );

    const build = await buildWorkflowsGeneratedPackage({
      extensionsGeneratedPackagePath: extensionsPackageRoot,
      extensionsRoot,
      generatedPackagePath: packageRoot,
      modelCatalog: [modelChoice()],
      sourceRoot,
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toEqual([
      expect.objectContaining({
        code: "invalid_extension_source",
        exportName: "broken-api",
        message: "Instruction config references unknown file: missing.md",
      }),
    ]);
    expect(existsSync(join(extensionsRoot, "builds", "extensions", "buildable-api"))).toBe(false);
    expect(build.diagnostics.map((diagnostic) => diagnostic.message)).not.toContain(
      "Workflow agent reviewerAgent references unavailable extension missing-workflow-extension.",
    );
    expect(existsSync(join(extensionsPackageRoot, "index.ts"))).toBe(false);
    expect(existsSync(packageRoot)).toBe(false);
  });

  it("still rejects dependency-blocked and non-exportable user extension references after extension preflight", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    const extensionsPackageRoot = join(root, "generated", "extensions-package");
    const extensionsRoot = join(root, "extensions");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeReadyUserExtension({
      extensionsRoot,
      extensionId: "blocked-api",
      dependencies: [{ kind: "dependency", name: "left-pad", version: "1.3.0" }],
      typescriptApiEnabled: true,
    });
    writeReadyUserExtension({
      extensionsRoot,
      extensionId: "mismatched-api",
      dependencies: [{ kind: "trusted_dependency", name: "esbuild", version: "0.25.4" }],
      typescriptApiEnabled: true,
    });
    writeInstalledExtensionPackage(extensionsRoot, "esbuild", "0.25.3");
    approveExtensionDependency(extensionsRoot, {
      kind: "trusted_dependency",
      name: "esbuild",
      version: "0.25.4",
    });
    writeReadyUserExtension({
      extensionsRoot,
      extensionId: "instructions-only",
      interfaceKind: "instructions",
      typescriptApiEnabled: false,
    });
    writeCurrentBuildOnly({
      extensionsRoot,
      extensionId: "deleted-api",
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
          instructions: "Review unavailable extension references.",
          extensions: ["blocked-api", "mismatched-api", "instructions-only", "deleted-api"],
        },
        null,
        2,
      ),
    );

    const build = await buildWorkflowsGeneratedPackage({
      extensionsGeneratedPackagePath: extensionsPackageRoot,
      extensionsRoot,
      generatedPackagePath: packageRoot,
      modelCatalog: [modelChoice()],
      sourceRoot,
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Workflow agent reviewerAgent references unavailable extension blocked-api.",
      "Workflow agent reviewerAgent references unavailable extension mismatched-api.",
      "Workflow agent reviewerAgent references unavailable extension instructions-only.",
      "Workflow agent reviewerAgent references unavailable extension deleted-api.",
    ]);
    expect(existsSync(join(extensionsPackageRoot, "index.ts"))).toBe(false);
  });

  it("statically extracts defineTaskAgent parameters and rejects dynamic values", () => {
    const root = createTempDir();
    const sourceRoot = join(root, "workflow-source");
    const staticPath = join(root, "agents.ts");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "agents", "defaultAgent.agent.json"),
      JSON.stringify(
        {
          id: "defaultAgent",
          label: "Default",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "low",
          instructions: "Handle the task.",
          extensions: ["shell"],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      staticPath,
      [
        "export const reviewer = Agents.defineTaskAgent({",
        "  ...Agents.defaultAgent,",
        '  id: "reviewerAgent",',
        '  label: "Reviewer",',
        '  reasoningEffort: "medium",',
        '  instructions: "Review strictly.",',
        '  extensions: [Extensions.git, Extensions["apply-patch"]],',
        "});",
      ].join("\n"),
    );
    const dynamicPath = join(root, "dynamic.ts");
    writeFileSync(
      dynamicPath,
      [
        'const model = "gpt-5.4";',
        "export const reviewer = Agents.defineTaskAgent({",
        '  id: "reviewerAgent",',
        '  label: "Reviewer",',
        '  provider: "openai",',
        "  model,",
        '  reasoningEffort: "medium",',
        '  instructions: "Review strictly.",',
        '  extensions: ["shell"],',
        "});",
      ].join("\n"),
    );

    const unresolvedSpreadPath = join(root, "unresolved-spread.ts");
    writeFileSync(
      unresolvedSpreadPath,
      [
        "const base = {};",
        "export const reviewer = Agents.defineTaskAgent({",
        "  ...base,",
        '  id: "reviewerAgent",',
        "});",
      ].join("\n"),
    );

    const importedDefineTaskAgentPath = join(root, "imported-define-task-agent.ts");
    writeFileSync(
      importedDefineTaskAgentPath,
      [
        'import { defineTaskAgent } from "@svvy/workflows";',
        "export const importedReviewer = defineTaskAgent({",
        '  id: "importedReviewer",',
        '  label: "Imported Reviewer",',
        '  provider: "openai",',
        '  model: "gpt-5.4",',
        '  reasoningEffort: "medium",',
        '  instructions: "Review from imported helper.",',
        "  extensions: [Extensions.git],",
        "});",
      ].join("\n"),
    );

    const localDefineTaskAgentPath = join(root, "local-define-task-agent.ts");
    writeFileSync(
      localDefineTaskAgentPath,
      [
        "function defineTaskAgent(parameters: unknown) { return parameters; }",
        "export const localReviewer = defineTaskAgent({",
        '  id: "localReviewer",',
        '  label: "Local Reviewer",',
        '  provider: "openai",',
        '  model: "gpt-5.4",',
        '  reasoningEffort: "medium",',
        '  instructions: "Do not extract local helpers.",',
        "  extensions: [Extensions.git],",
        "});",
      ].join("\n"),
    );

    const otherNamespacePath = join(root, "other-namespace-agent.ts");
    writeFileSync(
      otherNamespacePath,
      [
        "const Other = Agents;",
        "export const otherReviewer = Other.defineTaskAgent({",
        '  id: "otherReviewer",',
        '  label: "Other Reviewer",',
        '  provider: "openai",',
        '  model: "gpt-5.4",',
        '  reasoningEffort: "medium",',
        '  instructions: "Do not extract other namespaces.",',
        "  extensions: [Extensions.git],",
        "});",
      ].join("\n"),
    );

    expect(extractWorkflowAgentParametersFromSource({ path: staticPath, sourceRoot })).toEqual({
      exportName: "reviewer",
      parameters: {
        id: "reviewerAgent",
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        instructions: "Review strictly.",
        extensions: ["git", "apply-patch"],
      },
    });
    expect(
      extractWorkflowAgentParametersFromSource({ path: importedDefineTaskAgentPath, sourceRoot }),
    ).toEqual({
      exportName: "importedReviewer",
      parameters: {
        id: "importedReviewer",
        label: "Imported Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        instructions: "Review from imported helper.",
        extensions: ["git"],
      },
    });
    expect(() => extractWorkflowAgentParametersFromSource({ path: dynamicPath })).toThrow(
      "static property assignments",
    );
    expect(() =>
      extractWorkflowAgentParametersFromSource({ path: unresolvedSpreadPath, sourceRoot }),
    ).toThrow("unresolved spread");
    expect(() =>
      extractWorkflowAgentParametersFromSource({ path: localDefineTaskAgentPath, sourceRoot }),
    ).toThrow("No static defineTaskAgent export found.");
    expect(() =>
      extractWorkflowAgentParametersFromSource({ path: otherNamespacePath, sourceRoot }),
    ).toThrow("No static defineTaskAgent export found.");
  });

  it("extracts one selected component export and rejects unsafe sibling runtime declarations", () => {
    const root = createTempDir();
    const sourceRoot = join(root, "workflow-source");
    const componentPath = join(root, "components.tsx");
    writeFileSync(
      componentPath,
      [
        'import { Button } from "@example/ui";',
        "export type Tone = 'strict' | 'soft';",
        "export function ReviewPanel() {",
        "  return <Button>Review</Button>;",
        "}",
        "",
      ].join("\n"),
    );

    const extracted = extractWorkflowSourceExportItem({
      exportName: "SavedReviewPanel",
      fromPath: componentPath,
      kind: "component",
      sourceExportName: "ReviewPanel",
      sourceRoot,
    });

    const saved = readFileSync(extracted.sourcePath, "utf8");
    expect(saved).toContain('import { Button } from "@example/ui";');
    expect(saved).toContain("type Tone");
    expect(saved).toContain("export function SavedReviewPanel()");
    expect(saved).not.toContain("export function ReviewPanel()");

    const unsafePath = join(root, "unsafe-components.tsx");
    writeFileSync(
      unsafePath,
      [
        "const label = 'Review';",
        "export function ReviewPanel() {",
        "  return <span>{label}</span>;",
        "}",
        "",
      ].join("\n"),
    );

    expect(() =>
      extractWorkflowSourceExportItem({
        exportName: "UnsafeReviewPanel",
        fromPath: unsafePath,
        kind: "component",
        sourceExportName: "ReviewPanel",
        sourceRoot,
      }),
    ).toThrow("cannot be extracted safely");
    expect(existsSync(join(sourceRoot, "components", "UnsafeReviewPanel.tsx"))).toBe(false);

    const relativeImportPath = join(root, "relative-import-components.tsx");
    writeFileSync(
      relativeImportPath,
      [
        'import { Button } from "./ui";',
        "export function ReviewPanel() {",
        "  return <Button>Review</Button>;",
        "}",
        "",
      ].join("\n"),
    );

    expect(() =>
      extractWorkflowSourceExportItem({
        exportName: "RelativeReviewPanel",
        fromPath: relativeImportPath,
        kind: "component",
        sourceExportName: "ReviewPanel",
        sourceRoot,
      }),
    ).toThrow("relative imports change meaning");
    expect(existsSync(join(sourceRoot, "components", "RelativeReviewPanel.tsx"))).toBe(false);

    const selfReferencePath = join(root, "recursive-workflow.tsx");
    writeFileSync(
      selfReferencePath,
      ["export async function ReviewWorkflow() {", "  return ReviewWorkflow;", "}", ""].join("\n"),
    );

    expect(() =>
      extractWorkflowSourceExportItem({
        exportName: "SavedRecursiveWorkflow",
        fromPath: selfReferencePath,
        kind: "workflow",
        sourceExportName: "ReviewWorkflow",
        sourceRoot,
      }),
    ).toThrow("references itself");
    expect(existsSync(join(sourceRoot, "workflows", "SavedRecursiveWorkflow.tsx"))).toBe(false);

    const defaultExportPath = join(root, "default-workflow.tsx");
    writeFileSync(
      defaultExportPath,
      ["export default async function ReviewWorkflow() {", "  return null;", "}", ""].join("\n"),
    );

    expect(() =>
      extractWorkflowSourceExportItem({
        exportName: "SavedDefaultWorkflow",
        fromPath: defaultExportPath,
        kind: "workflow",
        sourceExportName: "ReviewWorkflow",
        sourceRoot,
      }),
    ).toThrow("not a default export");
    expect(existsSync(join(sourceRoot, "workflows", "SavedDefaultWorkflow.tsx"))).toBe(false);

    const workflowPath = join(root, "workflows.tsx");
    writeFileSync(
      workflowPath,
      ["export async function ReviewWorkflow() {", "  return null;", "}", ""].join("\n"),
    );

    const extractedWorkflow = extractWorkflowSourceExportItem({
      exportName: "SavedReviewWorkflow",
      fromPath: workflowPath,
      kind: "workflow",
      sourceExportName: "ReviewWorkflow",
      sourceRoot,
    });

    expect(extractedWorkflow.sourcePath).toBe(
      join(sourceRoot, "workflows", "SavedReviewWorkflow.tsx"),
    );
    expect(readFileSync(extractedWorkflow.sourcePath, "utf8")).toContain(
      "export async function SavedReviewWorkflow()",
    );
  });
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "svvy-workflows-generated-"));
  tempDirs.push(dir);
  return dir;
}

function modelChoice(): SvvyxWorkflowsModelChoice {
  return {
    providerId: "openai",
    modelId: "gpt-5.4",
    providerAuthenticated: true,
    authSource: "oauth" as const,
    supportedReasoning: ["off", "low", "medium", "high"],
    capabilities: {
      reasoning: true,
      vision: true,
      toolCalling: true,
    },
  };
}

function writeReadyUserExtension(input: {
  extensionsRoot: string;
  extensionId: string;
  currentBuild?: boolean;
  dependencies?: Array<{
    kind: "dependency" | "trusted_dependency";
    name: string;
    version: string;
  }>;
  interfaceKind?: "instructions" | "svvyx";
  typescriptApiEnabled: boolean;
}): void {
  const interfaceKind = input.interfaceKind ?? "svvyx";
  const sourceRoot = join(input.extensionsRoot, "sources", "user", input.extensionId);
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(
    join(sourceRoot, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: input.extensionId,
        title: input.extensionId,
        description: `${input.extensionId} extension`,
        interface: interfaceKind,
        typescriptApiEnabled: input.typescriptApiEnabled,
        instructionFiles: [],
      },
      null,
      2,
    ),
  );
  if (interfaceKind === "svvyx") {
    mkdirSync(join(sourceRoot, "source"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "source", "index.ts"),
      [
        'import { Cli, z } from "incur";',
        "",
        `const cli = Cli.create(${JSON.stringify(input.extensionId)});`,
        `cli.command(${JSON.stringify("issues.list")}, {`,
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
  if (input.currentBuild ?? true) {
    writeCurrentBuildOnly({
      dependencies: input.dependencies,
      extensionsRoot: input.extensionsRoot,
      extensionId: input.extensionId,
      interfaceKind,
    });
  }
}

function writeCurrentBuildOnly(input: {
  dependencies?: Array<{
    kind: "dependency" | "trusted_dependency";
    name: string;
    version: string;
  }>;
  extensionsRoot: string;
  extensionId: string;
  interfaceKind?: "instructions" | "svvyx";
}): void {
  const currentRoot = join(
    input.extensionsRoot,
    "builds",
    "extensions",
    input.extensionId,
    "current",
  );
  mkdirSync(currentRoot, { recursive: true });
  const sourceFingerprint = sourceBuildFingerprint(
    join(input.extensionsRoot, "sources", "user", input.extensionId),
  );
  writeFileSync(
    join(currentRoot, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        extensionId: input.extensionId,
        interface: input.interfaceKind ?? "svvyx",
        module: input.interfaceKind === "instructions" ? null : "source/index.js",
        commandManifest:
          input.interfaceKind === "instructions"
            ? null
            : {
                version: "incur.v1",
                commands: [{ name: "issues.list" }],
              },
        typescriptTypes:
          input.interfaceKind === "instructions"
            ? null
            : join(
                input.extensionsRoot,
                "generated",
                "extensions",
                input.extensionId,
                "types.d.ts",
              ),
        ...(sourceFingerprint ? { sourceFingerprint } : {}),
        env: [],
        dependencies: input.dependencies ?? [],
      },
      null,
      2,
    ),
  );
}

function writeInstalledExtensionPackage(
  extensionsRoot: string,
  packageName: string,
  packageVersion: string,
): void {
  const packageRoot = join(extensionsRoot, "package", "node_modules", ...packageName.split("/"));
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: packageName, version: packageVersion }, null, 2),
  );
}

function approveExtensionDependency(
  extensionsRoot: string,
  dependency: { kind: "dependency" | "trusted_dependency"; name: string; version: string },
): void {
  const dependencyApprovalStore = new ExtensionDependencyApprovalStore({ extensionsRoot });
  const request = dependencyApprovalStore.findOrCreatePendingRequest({
    extensionId: "test-extension",
    identities: [
      {
        kind: dependency.kind,
        packageManager: "bun",
        source: "npm",
        name: dependency.name,
        version: dependency.version,
        integrity: null,
        resolution: null,
      },
    ],
  });
  if (request) {
    dependencyApprovalStore.approveRequest(request.requestId);
  }
}

function sourceBuildFingerprint(sourceRoot: string): string | null {
  if (!existsSync(sourceRoot)) {
    return null;
  }
  const files = listBuildInputFiles(sourceRoot);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.slice(sourceRoot.length + 1));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listBuildInputFiles(root: string): string[] {
  const files: string[] = [];
  const pending: string[] = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === ".svvy") {
        continue;
      }
      const path = join(current, entry);
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (stat.isFile()) {
        files.push(path);
      }
    }
  }
  return files.toSorted((left, right) => left.localeCompare(right));
}
