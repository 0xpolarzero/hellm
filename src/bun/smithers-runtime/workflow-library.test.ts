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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
import { createWorkflowAgentId } from "../../mainview/agent-profile-ids";

const tempDirs: string[] = [];
const IMPORT_PATTERN =
  /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|export\s+(?:type\s+)?[^'"]*?\s+from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

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
        '  reasoning: { effort: "medium" },',
        '  instructions: "Review strictly.",',
        '  overrides: { [Extensions.git.id]: "loaded" },',
        "} satisfies Agents.TaskAgentParametersSource;",
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
        reasoning: { effort: "medium" },
        instructions: "Review strictly.",
        overrides: { git: "loaded" },
      },
    });
  });

  it("builds @svvyx/workflows from app-global source with namespace-only root exports", async () => {
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
          reasoning: { effort: "medium" },
          instructions: "Review strictly.",
          overrides: { shell: "loaded" },
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
    expect(JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))).toEqual({
      name: "@svvyx/workflows",
      type: "module",
      exports: {
        ".": "./index.ts",
      },
    });
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
    expect(
      generatedPackageRuntimeImportViolations(packageRoot, {
        allowedGeneratedPackages: new Set(["@svvy/core", "@svvyx/extensions"]),
      }),
    ).toEqual([]);
    const agentsIndex = readFileSync(join(packageRoot, "agents", "index.ts"), "utf8");
    expect(agentsIndex).toContain(
      'import type { RunTaskAgentError, RunTaskAgentResult, RunTaskAgentSourceInput } from "@svvy/core";',
    );
    expect(agentsIndex).not.toContain("unsafeDecodeRunTaskAgentInputSyncForTestsAndBootstrap");
    expect(agentsIndex).not.toContain("decodeUnknownRunTaskAgentInput");
    expect(agentsIndex).not.toContain("decodeUnknownRunTaskAgentSourceInput");
    expect(agentsIndex).toContain('import type { AgentLike } from "smithers-orchestrator";');
    expect(agentsIndex).not.toContain("@mariozechner/pi-agent-core");
    expect(agentsIndex).toContain(
      'export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";',
    );
    expect(agentsIndex).toContain("export type ReasoningSelection = { effort: ReasoningEffort };");
    expect(agentsIndex).toContain("export interface TaskAgentParametersSource");
    expect(agentsIndex).toContain("  id: string;");
    expect(agentsIndex).toContain("  reasoning: ReasoningSelection;");
    expect(agentsIndex).toContain(
      "export function defineTaskAgent<T extends TaskAgentParametersSource>(parameters: T): AgentLike",
    );
    expect(agentsIndex).toContain(
      "async function callTaskAgentBridge(parameters: TaskAgentParametersSource, rawArgs: unknown): Promise<RunTaskAgentResult>",
    );
    expect(agentsIndex).toContain("SVVY_WORKFLOW_AGENT_BRIDGE_URL");
    expect(agentsIndex).toContain("SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN");
    expect(agentsIndex).toContain("SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID");
    expect(agentsIndex).toContain("SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID");
    expect(agentsIndex).toContain("SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS");
    expect(agentsIndex).toContain('operation: "runTaskAgent"');
    expect(agentsIndex).toContain("taskIdentity: readSmithersTaskIdentity(args)");
    expect(agentsIndex).toContain("...(smithersContext ? { smithersContext } : {})");
    expect(agentsIndex).toContain("    promptSource,");
    expect(agentsIndex).not.toContain("...(promptSource ? { promptSource } : {})");
    expect(agentsIndex).toContain(
      'throw new Error("svvy workflow task-agent requires exactly one prompt source: provide either prompt or messages.");',
    );
    expect(agentsIndex).toContain("} as RunTaskAgentSourceInput;");
    for (const forbidden of [
      "surfacePiSessionId",
      "workflowTaskAttemptId",
      "generatedAgentContextFingerprint",
      "queueItemId",
      "commandFacts",
      "runtimeEffects",
      "extensionExecutionPlan",
      "systemPrompt",
    ]) {
      expect(agentsIndex).not.toContain(forbidden);
    }
    expect(agentsIndex).toContain('return { kind: "prompt", prompt: args.prompt };');
    expect(agentsIndex).toContain(
      'return { kind: "messages", messages: normalizeBridgeMessages(args.messages) };',
    );
    expect(agentsIndex).toContain("rootDir?: unknown;");
    expect(agentsIndex).toContain("resumeSession?: unknown;");
    expect(agentsIndex).toContain("continueSession?: unknown;");
    expect(agentsIndex).toContain("taskContext?: unknown;");
    expect(agentsIndex).toContain("run?: unknown;");
    expect(agentsIndex).toContain("node?: unknown;");
    expect(agentsIndex).toContain("iteration?: unknown;");
    expect(agentsIndex).toContain("attempt?: unknown;");
    expect(agentsIndex).toContain("smithersRunId");
    expect(agentsIndex).toContain("nodeId");
    expect(agentsIndex).toContain("maxOutputBytes?: unknown;");
    expect(agentsIndex).not.toContain("copySerializableGenerateFields");
    expect(agentsIndex).not.toContain("copySmithersIdentityFields");
    expect(agentsIndex).not.toContain("supportsNativeStructuredOutput");
    expect(readFileSync(join(packageRoot, "agents", "index.ts"), "utf8")).toContain(
      'export { reviewerAgent } from "./reviewerAgent";',
    );
    const reviewerAgentSource = readFileSync(
      join(packageRoot, "agents", "reviewerAgent.ts"),
      "utf8",
    );
    expect(reviewerAgentSource).toContain("satisfies TaskAgentParametersSource");
    expect(reviewerAgentSource).not.toContain("defineTaskAgent");
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

  it("turns generated agent parameter records into bridge-backed AgentLike values", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    const extensionsPackageRoot = join(root, "generated", "extensions-package");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "agents", "reviewerAgent.agent.json"),
      JSON.stringify(
        {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "medium" },
          instructions: "Review bridge payloads.",
          overrides: { shell: "available" },
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
    });
    expect(build.ok).toBe(true);
    linkPackageForGeneratedImport({
      packageRoot,
      packageName: "@svvyx/extensions",
      targetPath: extensionsPackageRoot,
    });
    linkPackageForGeneratedImport({
      packageRoot,
      packageName: "@svvy/core",
      targetPath: join(import.meta.dir, "..", "..", "..", "packages", "core"),
    });

    const received: unknown[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = ((requestInfo: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(requestInfo, init);
      expect(request.method).toBe("POST");
      expect(request.headers.get("authorization")).toBe("Bearer bridge-token");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return request.json().then((body) => {
        received.push(body);
        return Response.json({ text: "review complete", usage: { outputTokens: 7 } });
      });
    }) as typeof fetch;
    const previousEnv = snapshotBridgeEnv();
    process.env.SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN = "bridge-token";
    process.env.SVVY_WORKFLOW_AGENT_BRIDGE_URL = "http://svvy-workflow-agent-bridge.test/run";
    process.env.SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID = "command-workflow-001";
    process.env.SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID = "workspace-session-001";
    process.env.SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS = "2500";

    try {
      const workflows = await import(`${pathToFileURL(join(packageRoot, "index.ts")).href}?bridge`);
      const agent = workflows.Agents.defineTaskAgent(workflows.Agents.reviewerAgent);

      expect(workflows.Agents.reviewerAgent).toMatchObject({
        id: "reviewerAgent",
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
      });
      expect(workflows.Agents.reviewerAgent).not.toHaveProperty("generate");
      expect(agent).toMatchObject({ id: "reviewerAgent" });
      expect(typeof agent.generate).toBe("function");

      await expect(agent.generate({})).rejects.toThrow(
        "svvy workflow task-agent requires exactly one prompt source",
      );
      await expect(agent.generate({ prompt: "Review this patch.", messages: [] })).rejects.toThrow(
        "svvy workflow task-agent requires exactly one prompt source",
      );

      await expect(
        agent.generate({
          prompt: "Review this patch.",
          rootDir: "/workspace/project",
          taskContext: { taskId: "task-review" },
          run: { id: "run-001" },
          node: { id: "node-review" },
          iteration: { index: 2 },
          attempt: { index: 1 },
          onEvent: () => {},
          onStdout: () => {},
        }),
      ).resolves.toEqual({ text: "review complete", usage: { outputTokens: 7 } });
    } finally {
      restoreBridgeEnv(previousEnv);
      globalThis.fetch = previousFetch;
    }

    expect(received).toEqual([
      {
        operation: "runTaskAgent",
        agent: {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "medium" },
          instructions: "Review bridge payloads.",
          overrides: { shell: "available" },
        },
        workspaceSessionId: "workspace-session-001",
        sourceCommandId: "command-workflow-001",
        taskIdentity: {
          runId: "run-001",
          nodeId: "node-review",
          iteration: 2,
          attempt: 1,
        },
        smithersContext: {
          rootDir: "/workspace/project",
          run: { id: "run-001" },
          node: { id: "node-review" },
        },
        promptSource: {
          kind: "prompt",
          prompt: "Review this patch.",
        },
      },
    ]);
  });

  it("reports clear generated AgentLike bridge errors for missing env and bridge failures", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    const extensionsPackageRoot = join(root, "generated", "extensions-package");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    writeFileSync(
      join(sourceRoot, "agents", "reviewerAgent.agent.json"),
      JSON.stringify(
        {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "medium" },
          instructions: "Review bridge failures.",
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
    });
    expect(build.ok).toBe(true);
    linkPackageForGeneratedImport({
      packageRoot,
      packageName: "@svvyx/extensions",
      targetPath: extensionsPackageRoot,
    });
    linkPackageForGeneratedImport({
      packageRoot,
      packageName: "@svvy/core",
      targetPath: join(import.meta.dir, "..", "..", "..", "packages", "core"),
    });
    const workflows = await import(`${pathToFileURL(join(packageRoot, "index.ts")).href}?errors`);
    const agent = workflows.Agents.defineTaskAgent(workflows.Agents.reviewerAgent);
    const previousEnv = snapshotBridgeEnv();
    delete process.env.SVVY_WORKFLOW_AGENT_BRIDGE_URL;

    await expect(agent.generate({ prompt: "missing env" })).rejects.toThrow(
      "Missing required svvy workflow task-agent bridge env var: SVVY_WORKFLOW_AGENT_BRIDGE_URL",
    );

    const previousFetch = globalThis.fetch;
    globalThis.fetch = (() => new Response("{not json")) as unknown as typeof fetch;
    process.env.SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN = "bridge-token";
    process.env.SVVY_WORKFLOW_AGENT_BRIDGE_URL = "http://svvy-workflow-agent-bridge.test/run";
    process.env.SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID = "command-workflow-001";
    process.env.SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID = "workspace-session-001";
    process.env.SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS = "not-a-number";
    try {
      await expect(agent.generate({ prompt: "bad timeout" })).rejects.toThrow(
        "Invalid svvy workflow task-agent bridge env var: SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS must be a positive integer.",
      );

      process.env.SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS = "1000";
      await expect(agent.generate({ prompt: "bad response" })).rejects.toThrow(
        "Malformed svvy workflow task-agent bridge response",
      );

      globalThis.fetch = (() =>
        Response.json(
          {
            error: "task_attempt_failed",
            message: "Task failed.",
            retryable: true,
          },
          { status: 500 },
        )) as unknown as typeof fetch;
      await expect(agent.generate({ prompt: "failed response" })).rejects.toThrow(
        "svvy workflow task-agent bridge rejected runTaskAgent (500 task_attempt_failed): Task failed.",
      );
    } finally {
      restoreBridgeEnv(previousEnv);
      globalThis.fetch = previousFetch;
    }
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
    const linkPath = join(workspaceCwd, ".smithers", "node_modules", "@svvyx", "workflows");
    const extensionsLinkPath = join(
      workspaceCwd,
      ".smithers",
      "node_modules",
      "@svvyx",
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
          reasoning: { effort: "xhigh" },
          instructions: "Review strictly.",
          overrides: { "missing-extension": "loaded" },
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
          reasoning: { effort: "xhigh" },
          instructions: "Review strictly.",
          overrides: { shell: "loaded" },
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
          reasoning: { effort: "medium" },
          instructions: "Review strictly.",
          overrides: { shell: "loaded" },
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

  it("accepts duplicated workflow-agent ids generated by the Agents pane", async () => {
    const root = createTempDir();
    const sourceRoot = join(root, "source");
    const packageRoot = join(root, "generated", "package");
    mkdirSync(join(sourceRoot, "agents"), { recursive: true });
    const duplicateId = createWorkflowAgentId("Explorer copy", [
      "explorer",
      "implementer",
      "reviewer",
    ]);
    writeFileSync(
      join(sourceRoot, "agents", `${duplicateId}.agent.json`),
      JSON.stringify(
        {
          id: duplicateId,
          label: "Explorer copy",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "medium" },
          instructions: "Explore the requested area.",
          overrides: {},
          extensionOrder: [],
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

    expect(duplicateId).toBe("explorerCopy");
    expect(build.ok).toBe(true);
    expect(build.diagnostics).toEqual([]);
    expect(build.items.map((item) => item.qualifiedName)).toContain("Agents.explorerCopy");
    expect(readFileSync(join(packageRoot, "agents", "index.ts"), "utf8")).toContain(
      'export { explorerCopy } from "./explorerCopy";',
    );
  });

  it("fails builds on unauthenticated providers and unknown extension overrides", async () => {
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
          reasoning: { effort: "medium" },
          instructions: "Review strictly.",
          overrides: { "missing-workflow-extension": "loaded" },
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

  it("generates and links @svvyx/extensions for workflow agent extension references", async () => {
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
          reasoning: { effort: "medium" },
          instructions: "Review strictly.",
          overrides: { git: "loaded", github: "loaded" },
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
    expect(JSON.parse(readFileSync(join(extensionsPackageRoot, "package.json"), "utf8"))).toEqual({
      name: "@svvyx/extensions",
      type: "module",
      exports: {
        ".": "./index.ts",
      },
    });
    const extensionsIndex = readFileSync(join(extensionsPackageRoot, "index.ts"), "utf8");
    expect(extensionsIndex).toContain('"git": {"id":"git"');
    expect(extensionsIndex).toContain('"github": {"id":"github"');
    expect(generatedPackageRuntimeImportViolations(extensionsPackageRoot)).toEqual([]);
    const generatedAgent = readFileSync(join(packageRoot, "agents", "reviewerAgent.ts"), "utf8");
    expect(generatedAgent).toContain('import { Extensions } from "@svvyx/extensions";');
    expect(generatedAgent).toContain("Extensions.git.id");
    expect(generatedAgent).toContain("Extensions.github.id");
    expect(generatedAgent).not.toContain('Extensions["workflows"]');
    expect(generatedAgent).not.toContain('"extensions"');
    const generatedAgentsIndex = readFileSync(join(packageRoot, "agents", "index.ts"), "utf8");
    expect(generatedAgentsIndex).toContain('import type { ExtensionId } from "@svvyx/extensions";');
    expect(generatedAgentsIndex).toContain("export type TaskAgentExtensionId = ExtensionId;");
    expect(
      generatedPackageRuntimeImportViolations(packageRoot, {
        allowedGeneratedPackages: new Set(["@svvy/core", "@svvyx/extensions"]),
      }),
    ).toEqual([]);
    expect(build.items[0]?.agentParameters?.overrides).toEqual({
      git: "loaded",
      github: "loaded",
    });
    const readModel = await readWorkflowsGeneratedReadModel(packageRoot, { sourceRoot });
    expect(readModel.items[0]?.agentParameters?.overrides).toEqual({
      git: "loaded",
      github: "loaded",
    });
    expect(
      readlinkSync(join(workspaceCwd, ".smithers", "node_modules", "@svvyx", "workflows")),
    ).toBe(packageRoot);
    expect(
      readlinkSync(join(workspaceCwd, ".smithers", "node_modules", "@svvyx", "extensions")),
    ).toBe(extensionsPackageRoot);
  });

  it("derives workflow-agent generated extensions from source overrides", async () => {
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
          reasoning: { effort: "medium" },
          instructions: "Review the implementation.",
          overrides: {
            github: "loaded",
            git: "available",
            shell: "unavailable",
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
    expect(build.items[0]?.agentParameters?.overrides).toEqual({
      github: "loaded",
      git: "available",
      shell: "unavailable",
    });
    const generatedAgent = readFileSync(
      join(generatedPackagePath, "agents", "reviewerAgent.ts"),
      "utf8",
    );
    expect(generatedAgent).toContain("Extensions.github.id");
    expect(generatedAgent).toContain("Extensions.git.id");
    expect(generatedAgent).toContain("Extensions.shell.id");
    expect(generatedAgent).not.toContain("extensionUsage");
  });

  it("includes ready user svvyx TypeScript extensions in @svvyx/extensions", async () => {
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
          reasoning: { effort: "medium" },
          instructions: "Review strict Linear context.",
          overrides: { git: "loaded", "linear-tools": "loaded" },
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
    expect(extensionsIndex).toContain('"git": {"id":"git"');
    expect(extensionsIndex).toContain('"linear-tools": {"id":"linear-tools"');
    const generatedAgent = readFileSync(join(packageRoot, "agents", "reviewerAgent.ts"), "utf8");
    expect(generatedAgent).toContain("Extensions.git.id");
    expect(generatedAgent).toContain('Extensions["linear-tools"].id');
    expect(build.items[0]?.agentParameters?.overrides).toEqual({
      git: "loaded",
      "linear-tools": "loaded",
    });
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
          reasoning: { effort: "medium" },
          instructions: "Review dependency-backed extension references.",
          overrides: { "installed-api": "loaded" },
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
    expect(extensionIds).toContain('"installed-api": {"id":"installed-api"');
    const generatedAgent = readFileSync(join(packageRoot, "agents", "reviewerAgent.ts"), "utf8");
    expect(generatedAgent).toContain('Extensions["installed-api"].id');
    expect(build.items[0]?.agentParameters?.overrides).toEqual({ "installed-api": "loaded" });
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
          reasoning: { effort: "medium" },
          instructions: "Review unapproved dependency-backed extension references.",
          overrides: { "unapproved-api": "loaded" },
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
          reasoning: { effort: "medium" },
          instructions: "Review rebuilt extension references.",
          overrides: { "unbuilt-api": "loaded", "stale-api": "loaded" },
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
    expect(extensionsIndex).toContain('"stale-api": {"id":"stale-api"');
    expect(extensionsIndex).toContain('"unbuilt-api": {"id":"unbuilt-api"');
    const generatedAgent = readFileSync(join(packageRoot, "agents", "reviewerAgent.ts"), "utf8");
    expect(generatedAgent).toContain('Extensions["stale-api"].id');
    expect(generatedAgent).toContain('Extensions["unbuilt-api"].id');
    expect(build.items[0]?.agentParameters?.overrides).toEqual({
      "unbuilt-api": "loaded",
      "stale-api": "loaded",
    });
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
          reasoning: { effort: "medium" },
          instructions: "Review broken extension context.",
          overrides: { "missing-workflow-extension": "loaded" },
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
          reasoning: { effort: "medium" },
          instructions: "Review extension preflight ordering.",
          overrides: { "buildable-api": "loaded", "missing-workflow-extension": "loaded" },
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
          reasoning: { effort: "medium" },
          instructions: "Review unavailable extension references.",
          overrides: {
            "blocked-api": "loaded",
            "mismatched-api": "loaded",
            "instructions-only": "loaded",
            "deleted-api": "loaded",
          },
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
          reasoning: { effort: "low" },
          instructions: "Handle the task.",
          overrides: { shell: "loaded" },
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
        '  reasoning: { effort: "medium" },',
        '  instructions: "Review strictly.",',
        '  overrides: { [Extensions.git.id]: "loaded", [Extensions["apply-patch"].id]: "available" },',
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
        '  reasoning: { effort: "medium" },',
        '  instructions: "Review strictly.",',
        '  overrides: { shell: "loaded" },',
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
        'import { Agents } from "@svvyx/workflows";',
        "export const importedReviewer = Agents.defineTaskAgent({",
        '  id: "importedReviewer",',
        '  label: "Imported Reviewer",',
        '  provider: "openai",',
        '  model: "gpt-5.4",',
        '  reasoning: { effort: "medium" },',
        '  instructions: "Review from imported helper.",',
        '  overrides: { [Extensions.git.id]: "loaded" },',
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
        '  reasoning: { effort: "medium" },',
        '  instructions: "Do not extract local helpers.",',
        '  overrides: { [Extensions.git.id]: "loaded" },',
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
        '  reasoning: { effort: "medium" },',
        '  instructions: "Do not extract other namespaces.",',
        '  overrides: { [Extensions.git.id]: "loaded" },',
        "});",
      ].join("\n"),
    );
    const legacyExtensionReferencePath = join(root, "legacy-extension-reference-agent.ts");
    writeFileSync(
      legacyExtensionReferencePath,
      [
        "export const legacyReviewer = Agents.defineTaskAgent({",
        '  id: "legacyReviewer",',
        '  label: "Legacy Reviewer",',
        '  provider: "openai",',
        '  model: "gpt-5.4",',
        '  reasoning: { effort: "medium" },',
        '  instructions: "Reject legacy extension references.",',
        '  overrides: { [Extensions["git"]]: "loaded" },',
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
        reasoning: { effort: "medium" },
        instructions: "Review strictly.",
        overrides: {
          git: "loaded",
          "apply-patch": "available",
        },
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
        reasoning: { effort: "medium" },
        instructions: "Review from imported helper.",
        overrides: { git: "loaded" },
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
    expect(() =>
      extractWorkflowAgentParametersFromSource({ path: legacyExtensionReferencePath }),
    ).toThrow("static property names");
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
        workflowTaskAgentReferenceExportEnabled:
          interfaceKind === "svvyx" && input.typescriptApiEnabled ? true : undefined,
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

function linkPackageForGeneratedImport(input: {
  packageRoot: string;
  packageName: string;
  targetPath: string;
}): void {
  const linkPath = join(input.packageRoot, "node_modules", ...input.packageName.split("/"));
  mkdirSync(join(linkPath, ".."), { recursive: true });
  symlinkSync(input.targetPath, linkPath);
}

function snapshotBridgeEnv(): Record<string, string | undefined> {
  return {
    SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN: process.env.SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN,
    SVVY_WORKFLOW_AGENT_BRIDGE_URL: process.env.SVVY_WORKFLOW_AGENT_BRIDGE_URL,
    SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS: process.env.SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS,
    SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID: process.env.SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID,
    SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID: process.env.SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID,
  };
}

function restoreBridgeEnv(snapshot: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
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

function generatedPackageRuntimeImportViolations(
  packageRoot: string,
  options: { allowedGeneratedPackages?: ReadonlySet<string> } = {},
): string[] {
  return listGeneratedTypeScriptFiles(packageRoot).flatMap((file) =>
    readImports(file)
      .filter((specifier) => {
        if (specifier.startsWith(".") || specifier.startsWith("node:")) {
          return false;
        }
        if (options.allowedGeneratedPackages?.has(specifier)) {
          return false;
        }
        return (
          specifier.startsWith("@svvy/") ||
          specifier.startsWith("@svvyx/") ||
          specifier === "effect" ||
          specifier.startsWith("effect/") ||
          specifier.includes("/src/")
        );
      })
      .map((specifier) => `${file.slice(packageRoot.length + 1)} -> ${specifier}`),
  );
}

function readImports(path: string): string[] {
  const source = readFileSync(path, "utf8");
  return Array.from(
    source.matchAll(IMPORT_PATTERN),
    (match) => match[1] ?? match[2] ?? match[3] ?? match[4],
  ).filter((specifier): specifier is string => Boolean(specifier));
}

function listGeneratedTypeScriptFiles(root: string): string[] {
  return listBuildInputFiles(root).filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"));
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
