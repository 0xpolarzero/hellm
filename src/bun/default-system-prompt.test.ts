import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  buildGeneratedAgentContextEntries,
  buildSystemPrompt,
  createDefaultGeneratedAgentContextState,
  DEFAULT_SYSTEM_PROMPT,
  HANDLER_SYSTEM_PROMPT,
  WORKFLOW_TASK_SYSTEM_PROMPT,
} from "./default-system-prompt";
import { EXECUTE_TYPESCRIPT_API_DECLARATION } from "../../generated/execute-typescript-api.generated";
import {
  SMITHERS_CORE_INSTRUCTIONS,
  SMITHERS_MEMORY_INSTRUCTIONS,
} from "../../generated/smithers-instructions.generated";
import { WORKFLOW_AUTHORING_CONTRACT_DECLARATION } from "../../generated/workflow-authoring-contract.generated";
import {
  CX_SKILL_INSTRUCTIONS,
  TINYFISH_CLI_INSTRUCTIONS,
} from "../../generated/cli-instructions.generated";
import { buildExecuteTypescriptApiDeclaration } from "./execute-typescript-api-declaration";
import {
  HANDLER_WORKFLOW_AUTHORING_APPENDIX,
  SMITHERS_MEMORY_FRAGMENT,
  SMITHERS_SVVY_BOUNDARY_APPENDIX,
} from "./smithers-runtime/workflow-authoring-guide";
import { getExtensionRecord, type ExtensionRecord } from "../shared/extensions";

describe("default system prompt", () => {
  it("puts core coding-agent operating policy into every coding surface", () => {
    for (const prompt of [
      DEFAULT_SYSTEM_PROMPT,
      HANDLER_SYSTEM_PROMPT,
      WORKFLOW_TASK_SYSTEM_PROMPT,
    ]) {
      expect(prompt).toContain("Inspect repository facts before making structural assumptions");
      expect(prompt).toContain("Keep edits narrowly scoped to the requested behavior");
      expect(prompt).toContain("Treat the worktree as shared user state");
      expect(prompt).toContain("Do not revert, overwrite, rename, clean up");
      expect(prompt).toContain("Validate proportionally to risk");
      expect(prompt).toContain("When asked for review, use a code-review stance");
      expect(prompt).toContain("Use the `cx` CLI through Shell");
      expect(prompt).toContain("Use Shell for repository inspection and command execution");
      expect(prompt).toContain("Apply Patch for targeted source edits");
      expect(prompt).toContain("rg --files");
      expect(prompt).toContain("pi can run them in parallel");
      expect(prompt).not.toContain("Use edit for targeted changes");
      expect(prompt).not.toContain("Prefer read, grep, find, and ls over bash");
      expect(prompt).not.toContain("Use read for visual inspection");
      expect(prompt).not.toContain("use write/edit for requested workspace files");
      expect(prompt).toContain("Use list_extensions when you need to inspect");
    }
  });

  it("assembles resolved extension instruction files and minimal loading hints", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-prompt-extension-"));
    try {
      const keepFile = join(root, "010-notes.md");
      const bypassedFile = join(root, "020-draft.md");
      writeFileSync(keepFile, "# Notes\n\nUse the notes workspace.");
      writeFileSync(bypassedFile, "# Draft\n\nDo not load this bypassed draft.");

      const loadedRecord: ExtensionRecord = {
        id: "notes",
        category: "user",
        interface: "instructions",
        title: "Notes",
        description: "User-authored note guidance.",
        instructionSourceFiles: [keepFile, bypassedFile],
        minimalLoadingHint: "Load Notes when workspace notes matter.",
        typescriptApiEnabled: false,
        envReadiness: "not_required",
        dependencyReadiness: "not_required",
        instructionFiles: [
          { file: "010-notes.md", bypassed: false },
          { file: "020-draft.md", bypassed: true },
        ],
        resetBehavior: "user_reset",
        deleteBehavior: "trash_allowed",
      };
      const availableRecord: ExtensionRecord = {
        ...loadedRecord,
        id: "linear",
        title: "Linear",
        description: "Linear workspace guidance.",
        instructionSourceFiles: [],
        minimalLoadingHint: "Load Linear when issue tracker context is needed.",
      };

      const prompt = buildSystemPrompt("orchestrator", {
        loadedExtensionIds: ["base-common", "notes"],
        loadedExtensionRecords: [loadedRecord],
        availableExtensionIds: ["linear"],
        availableExtensionRecords: [availableRecord],
      });

      expect(prompt).toContain("Loaded extension: Notes.");
      expect(prompt).toContain("Instruction file: 010-notes.md");
      expect(prompt).toContain("Use the notes workspace.");
      expect(prompt).not.toContain("Do not load this bypassed draft.");
      expect(prompt).toContain("- linear: Load Linear when issue tracker context is needed.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads builtin extension instruction text from the extension record without actor gating", () => {
    const extensionManaging = getExtensionRecord("extension-managing");
    const workflows = getExtensionRecord("workflows");
    expect(extensionManaging).not.toBeNull();
    expect(workflows).not.toBeNull();

    const extensionManagingPrompt = buildSystemPrompt("orchestrator", {
      loadedExtensionIds: ["extension-managing"],
      loadedExtensionRecords: [extensionManaging!],
    });
    expect(extensionManagingPrompt).toContain("Loaded native extension: Extension Managing.");
    expect(extensionManagingPrompt).toContain("app-owned extension source");

    const orchestratorWorkflowsPrompt = buildSystemPrompt("orchestrator", {
      loadedExtensionIds: ["workflows"],
      loadedExtensionRecords: [workflows!],
    });
    const handlerWorkflowsPrompt = buildSystemPrompt("handler", {
      loadedExtensionIds: ["workflows"],
      loadedExtensionRecords: [workflows!],
    });
    expect(orchestratorWorkflowsPrompt).toContain(WORKFLOW_AUTHORING_CONTRACT_DECLARATION.trim());
    expect(orchestratorWorkflowsPrompt).toContain(HANDLER_WORKFLOW_AUTHORING_APPENDIX);
    expect(handlerWorkflowsPrompt).toContain(WORKFLOW_AUTHORING_CONTRACT_DECLARATION.trim());
    expect(handlerWorkflowsPrompt).toContain(HANDLER_WORKFLOW_AUTHORING_APPENDIX);
  });

  it("preserves resolved extension order in the generated prompt", () => {
    const gitBeforeCx = buildSystemPrompt("orchestrator", {
      loadedExtensionIds: ["git", "cx"],
      availableExtensionIds: [],
    });
    const cxBeforeGit = buildSystemPrompt("orchestrator", {
      loadedExtensionIds: ["cx", "git"],
      availableExtensionIds: [],
    });

    expect(gitBeforeCx.indexOf("Loaded prompt-only extension: Git.")).toBeLessThan(
      gitBeforeCx.indexOf("Loaded extension: cx semantic code navigation."),
    );
    expect(cxBeforeGit.indexOf("Loaded extension: cx semantic code navigation.")).toBeLessThan(
      cxBeforeGit.indexOf("Loaded prompt-only extension: Git."),
    );
  });

  it("uses editable base instruction extension files instead of fallback prompt bodies", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-base-extension-"));
    try {
      const baseFile = join(root, "010-base-common.generated.md");
      writeFileSync(baseFile, "# Edited Base\n\nUse the edited base prompt.");

      const prompt = buildSystemPrompt("orchestrator", {
        loadedExtensionIds: ["base-common", "base-orchestrator"],
        loadedExtensionRecords: [
          {
            id: "base-common",
            category: "builtin",
            interface: "instructions",
            title: "Base Common",
            description: "Shared svvy operating instructions.",
            instructionSourceFiles: [baseFile],
            minimalLoadingHint: "Shared operating instructions are loaded automatically.",
            typescriptApiEnabled: false,
            envReadiness: "not_required",
            dependencyReadiness: "not_required",
            generatedInstructions: [
              {
                output: "instructions/full/010-base-common.generated.md",
                script: "scripts/generate-api-declarations.ts",
              },
            ],
            resetBehavior: "builtin_reset",
            deleteBehavior: "not_allowed",
          },
        ],
      });

      expect(prompt).toContain("Loaded extension: Base Common.");
      expect(prompt).toContain("Instruction file: 010-base-common.generated.md");
      expect(prompt).toContain("Use the edited base prompt.");
      expect(prompt).not.toContain("You are svvy, a pragmatic software engineering assistant");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("embeds the actor-scoped execute_typescript API contract", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "The execute_typescript contract follows and is the source of truth",
    );
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Loaded native extension: Execute TypeScript.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "Loaded Execute TypeScript guidance: Incur generated clients.",
    );
    expect(DEFAULT_SYSTEM_PROMPT).toContain('extensions["<extensionId>"].run(commandId, input)');
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Dot access is valid only for identifier-safe");
    expect(DEFAULT_SYSTEM_PROMPT).toContain(EXECUTE_TYPESCRIPT_API_DECLARATION.trim());
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("interface ActiveWebSearchInput");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("site?: string");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("interface LoadedExtensionsClient");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("declare const extensions: LoadedExtensionsClient");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("interface SvvyApi");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("list_assets(");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("list_models(): Promise<ToolResult");
    expect(EXECUTE_TYPESCRIPT_API_DECLARATION).not.toContain("cx_");
    expect(EXECUTE_TYPESCRIPT_API_DECLARATION).not.toContain("web_");
    expect(EXECUTE_TYPESCRIPT_API_DECLARATION).not.toContain("workflow_");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Do not use or assume a broad `api` helper");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("prompt-only extension clients");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("api.cx_*");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("api.web_*");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("api.workflow_*");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Use TinyFish through ordinary Shell commands");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("bash-backed inspection");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Loaded extension: cx semantic code navigation.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain(CX_SKILL_INSTRUCTIONS.trim());
    expect(DEFAULT_SYSTEM_PROMPT).toContain("`cx overview`");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("cx symbols [--kind K]");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("cx definition --name NAME");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("cx references --name NAME");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Read tool");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Edit tool");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain(
      "`read`, `grep`, `find`, or `ls` when semantic navigation is insufficient",
    );
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Available extensions:");
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "- smithers: Use official Smithers CLI commands through Shell for workspace .smithers work.",
    );
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain(
      "Loaded always-on prompt context: Smithers workflow routing.",
    );
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("providerModelSummary");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("toolsetSummary");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("subtype?: string");

    expect(WORKFLOW_TASK_SYSTEM_PROMPT).not.toContain("list_assets(");
    expect(buildExecuteTypescriptApiDeclaration("orchestrator")).not.toContain("list_assets(");
    expect(buildExecuteTypescriptApiDeclaration("handler")).not.toContain("list_assets(");
    expect(buildExecuteTypescriptApiDeclaration("workflow-task")).not.toContain("list_assets(");
  });

  it("omits loaded user svvyx generated declarations from actor context", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-prompt-extension-types-"));
    try {
      const currentRoot = join(root, "builds", "extensions", "linear", "current");
      const generatedRoot = join(root, "generated", "extensions", "linear");
      mkdirSync(currentRoot, { recursive: true });
      mkdirSync(generatedRoot, { recursive: true });
      writeFileSync(
        join(currentRoot, "manifest.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            extensionId: "linear",
            interface: "svvyx",
            module: "source/index.js",
            commandManifest: {
              version: "incur.v1",
              commands: [{ name: "issues.list" }],
            },
            typescriptTypes: join(generatedRoot, "types.d.ts"),
            env: [],
            dependencies: [],
          },
          null,
          2,
        ) + "\n",
      );
      writeFileSync(
        join(generatedRoot, "types.d.ts"),
        "interface LoadedExtensionsClient { staleGeneratedFile: { run(): never } }",
      );
      const loadedRecord: ExtensionRecord = {
        id: "linear",
        category: "user",
        interface: "svvyx",
        title: "Linear",
        description: "Linear generated client.",
        instructionSourceFiles: [],
        minimalLoadingHint: "",
        typescriptApiEnabled: true,
        envReadiness: "not_required",
        dependencyReadiness: "not_required",
        resetBehavior: "user_reset",
        deleteBehavior: "trash_allowed",
      };

      const prompt = buildSystemPrompt("orchestrator", {
        extensionsRoot: root,
        loadedExtensionIds: ["base-common", "execute-typescript", "linear"],
        loadedExtensionRecords: [loadedRecord],
      });

      expect(prompt).not.toContain("linear: LinearExtensionClient");
      expect(prompt).not.toContain('"issues.list"');
      expect(prompt).not.toContain("staleGeneratedFile");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("explicitly steers snippets away from Node built-ins and broad helper APIs", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Do not import or assume Node.js built-ins");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("actor-local generated `extensions` clients");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("bash(input:");
  });

  it("keeps Execute TypeScript base guidance separate from generated-client guidance", () => {
    const baseIndex = DEFAULT_SYSTEM_PROMPT.indexOf("Loaded native extension: Execute TypeScript.");
    const clientIndex = DEFAULT_SYSTEM_PROMPT.indexOf(
      "Loaded Execute TypeScript guidance: Incur generated clients.",
    );
    const declarationIndex = DEFAULT_SYSTEM_PROMPT.indexOf(
      "The execute_typescript contract follows",
    );

    expect(baseIndex).toBeGreaterThan(-1);
    expect(clientIndex).toBeGreaterThan(baseIndex);
    expect(declarationIndex).toBeGreaterThan(clientIndex);
    expect(DEFAULT_SYSTEM_PROMPT.slice(baseIndex, clientIndex)).toContain(
      "Do not import or assume Node.js built-ins",
    );
    expect(DEFAULT_SYSTEM_PROMPT.slice(baseIndex, clientIndex)).not.toContain(
      'extensions["<extensionId>"].run',
    );
    expect(DEFAULT_SYSTEM_PROMPT.slice(clientIndex, declarationIndex)).toContain(
      'extensions["<extensionId>"].run(commandId, input)',
    );
  });

  it("describes the grounded Artifacts command surface without old direct tools", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Loaded extension: Artifacts.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "svvyx artifacts create --name <filename-with-extension>",
    );
    expect(DEFAULT_SYSTEM_PROMPT).toContain("svvyx artifacts create --path <file>");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("svvyx artifacts inspect --id <artifact_id> --json");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("svvyx artifacts open --id <artifact_id> --json");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("svvyx artifacts delete --id <artifact_id> --json");
    expect(DEFAULT_SYSTEM_PROMPT).toContain('extensions.artifacts.run("create"');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('extensions.artifacts.run("open"');
    expect(DEFAULT_SYSTEM_PROMPT).toContain("does not support `--kind`, inline content");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("artifact_write_text(");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("artifact_write_json(");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("artifact_attach_file(");
  });

  it("describes the adopted orchestrator and handler-thread tool split", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toBe(buildSystemPrompt("orchestrator"));
    expect(DEFAULT_SYSTEM_PROMPT).toContain("delegate with thread_start");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("thread_followup({ activate: true })");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("thread_resume");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain('context: ["ci"]');
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "The orchestrator delegates objectives into handler threads.",
    );
    expect(DEFAULT_SYSTEM_PROMPT).toContain("normally omit history so it defaults to isolated");
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "Call thread_start with one threads[] item for ordinary delegation",
    );
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "Use multiple threads[] items only for separate user-visible handler conversations",
    );
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      'Use history: "forked" only when the user explicitly asks to fork/continue/share current conversation context',
    );
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      'Do not use history: "forked" for ordinary implementation, source-driven research, test fixing, code review, security review, independent critique, verification',
    );
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("thread_handoff");

    expect(HANDLER_SYSTEM_PROMPT).toBe(buildSystemPrompt("handler"));
    expect(HANDLER_SYSTEM_PROMPT).toContain("emit an update/conclusion with thread_report");
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "Loaded prompt-only extension: Smithers CLI workflow authoring.",
    );
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "Workflow waits, approvals, and resumes stay inside this handler thread until the handler decides to report an update or conclusion.",
    );
    expect(HANDLER_SYSTEM_PROMPT).toContain("smithers init");
    expect(HANDLER_SYSTEM_PROMPT).toContain("smithers workflow run");
    expect(HANDLER_SYSTEM_PROMPT).toContain("smithers ps");
    expect(HANDLER_SYSTEM_PROMPT).toContain("smithers inspect");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("bunx smithers-orchestrator");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("bunx smithers ");
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "Do not call thread_start from this surface in the adopted supervision model.",
    );
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("thread_resume");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("thread_handoff");
    expect(HANDLER_SYSTEM_PROMPT).toContain("workspace `.smithers/` source");
    expect(HANDLER_SYSTEM_PROMPT).toContain("@svvy/workflows");
    expect(HANDLER_SYSTEM_PROMPT).toContain("Workflow authoring guide for handler threads:");
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "The handler workflow-authoring TypeScript contract follows",
    );
    expect(HANDLER_SYSTEM_PROMPT).toContain(WORKFLOW_AUTHORING_CONTRACT_DECLARATION.trim());
    expect(HANDLER_SYSTEM_PROMPT).not.toContain(".svvy/artifacts/workflows");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("request_context");
    expect(EXECUTE_TYPESCRIPT_API_DECLARATION).not.toContain("request_context");
    expect(EXECUTE_TYPESCRIPT_API_DECLARATION).not.toContain("workflow:");
  });

  it("composes loaded extension guidance from actor-local extension ids", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Loaded native extension: Shell.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Use exec_command to run shell commands.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Use write_stdin only to continue");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Loaded Shell guidance: Incur CLI Usage.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Loaded svvyx extensions are ordinary shell commands.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("--llms --format json");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Loaded native extension: Apply Patch.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Loaded prompt-only extension: Git.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Loaded prompt-only extension: GitHub.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Loaded native extension: Extension Loading.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Loaded native extension: Request User Input.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Loaded native extension: Thread Orchestration.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Loaded extension: Artifacts.");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("svvyx artifacts create");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("artifact_write_text(");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("Loaded native extension: Thread Handling.");

    expect(HANDLER_SYSTEM_PROMPT).toContain("Loaded native extension: Thread Handling.");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("Loaded native extension: Thread Orchestration.");

    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toContain("Loaded native extension: Shell.");
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toContain("Loaded extension: Artifacts.");
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).not.toContain(
      "Loaded native extension: Request User Input.",
    );
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).not.toContain("Loaded native extension: Thread Handling.");
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).not.toContain(
      "Loaded native extension: Thread Orchestration.",
    );
  });

  it("uses only the active Request User Input variant instructions", () => {
    const nonblockingPrompt = buildSystemPrompt("orchestrator", {
      requestUserInputSettings: {
        mode: "nonblocking",
        blockingTimeout: {
          enabled: true,
          durationMs: 300_000,
        },
      },
    });
    expect(nonblockingPrompt).toContain("where you can choose a conservative default now");
    expect(nonblockingPrompt).toContain("later `request_user_input.answer` message");
    expect(nonblockingPrompt).not.toContain("only when the answer is required before proceeding");
    expect(nonblockingPrompt).not.toContain("timeout_default");

    const blockingPrompt = buildSystemPrompt("orchestrator", {
      requestUserInputSettings: {
        mode: "blocking",
        blockingTimeout: {
          enabled: true,
          durationMs: 300_000,
        },
      },
    });
    expect(blockingPrompt).toContain("only when the answer is required before proceeding");
    expect(blockingPrompt).toContain("configured timeout may fall back");
    expect(blockingPrompt).toContain('answeredBy: "timeout_default"');
    expect(blockingPrompt).not.toContain("later `request_user_input.answer` message");
  });

  it("keeps Shell base command guidance separate from Incur svvyx CLI guidance", () => {
    const shellIndex = DEFAULT_SYSTEM_PROMPT.indexOf("Loaded native extension: Shell.");
    const incurIndex = DEFAULT_SYSTEM_PROMPT.indexOf("Loaded Shell guidance: Incur CLI Usage.");
    const applyPatchIndex = DEFAULT_SYSTEM_PROMPT.indexOf("Loaded native extension: Apply Patch.");

    expect(shellIndex).toBeGreaterThan(-1);
    expect(incurIndex).toBeGreaterThan(shellIndex);
    expect(applyPatchIndex).toBeGreaterThan(incurIndex);
    expect(DEFAULT_SYSTEM_PROMPT.slice(shellIndex, incurIndex)).toContain(
      "Use exec_command to run shell commands.",
    );
    expect(DEFAULT_SYSTEM_PROMPT.slice(shellIndex, incurIndex)).not.toContain(
      "svvyx <extension-id>",
    );
    expect(DEFAULT_SYSTEM_PROMPT.slice(incurIndex, applyPatchIndex)).toContain(
      "svvyx <extension-id> <command>",
    );
  });

  it("places external instruction records inside generated actor context before loaded extension guidance", () => {
    const prompt = buildSystemPrompt("orchestrator", {
      externalInstructionSources: [
        {
          id: "0:/repo/AGENTS.md",
          kind: "AGENTS.md",
          title: "AGENTS.md",
          path: "/repo/AGENTS.md",
          content: "# Repo Standards\n\nUse repo rules.",
          contentHash: "abc123",
          order: 0,
          enabled: true,
          actors: ["orchestrator", "handler", "workflow-task"],
          sourceGroup: "workspace_chain",
          readStatus: { status: "readable" },
        },
        {
          id: "1:/repo/CLAUDE.md",
          kind: "CLAUDE.md",
          title: "CLAUDE.md",
          path: "/repo/CLAUDE.md",
          content: "# Disabled Standards\n\nDo not include.",
          contentHash: "def456",
          order: 1,
          enabled: false,
          actors: ["orchestrator", "handler", "workflow-task"],
          sourceGroup: "workspace_chain",
          readStatus: { status: "readable" },
        },
      ],
    });

    const commonIndex = prompt.indexOf("You are svvy, a pragmatic software engineering assistant");
    const externalIndex = prompt.indexOf("Loaded external_instruction records:");
    const shellIndex = prompt.indexOf("Loaded native extension: Shell.");
    const declarationIndex = prompt.indexOf("The execute_typescript contract follows");

    expect(commonIndex).toBeGreaterThanOrEqual(0);
    expect(externalIndex).toBeGreaterThan(commonIndex);
    expect(shellIndex).toBeGreaterThan(externalIndex);
    expect(declarationIndex).toBeGreaterThan(shellIndex);
    expect(prompt).toContain("External instruction: /repo/AGENTS.md");
    expect(prompt).toContain("# Repo Standards\n\nUse repo rules.");
    expect(prompt).not.toContain("Disabled Standards");
    expect(prompt).not.toContain("# Project Context");
  });

  it("keeps Web prompt-only with no app-owned provider settings", () => {
    const prompt = buildSystemPrompt("orchestrator");
    expect(prompt).toContain("Loaded extension: Web.");
    expect(prompt).toContain(TINYFISH_CLI_INSTRUCTIONS.trim());
    expect(prompt).toContain("tinyfish auth status");
    expect(prompt).toContain("tinyfish auth login");
    expect(prompt).toContain("tinyfish auth set");
    expect(prompt).toContain("tinyfish auth logout");
    expect(prompt).toContain("tinyfish search query");
    expect(prompt).toContain("tinyfish fetch content get");
    expect(prompt).toContain("tinyfish agent run");
    expect(prompt).toContain("tinyfish browser session create");
    expect(prompt).toContain("file when useful instead of flooding the transcript");
    expect(prompt).toContain("untrusted external content");
    expect(prompt).toContain("Cite source URLs");
    expect(prompt).not.toContain("workspace or artifact file");
    expect(prompt).not.toContain("npm install -g @tiny-fish/cli");
    expect(prompt).not.toContain("sk-tinyfish-");
    expect(prompt).not.toContain("interface ActiveWebSearchInput");
    expect(prompt).not.toContain("web_search");
    expect(prompt).not.toContain("web_fetch");
    expect(prompt).not.toContain("site?: string");
    expect(prompt).not.toContain("Selected Web Provider");
    expect(prompt).not.toContain("Firecrawl");
    expect(EXECUTE_TYPESCRIPT_API_DECLARATION).not.toContain("web_search");
    expect(EXECUTE_TYPESCRIPT_API_DECLARATION).not.toContain("web_fetch");
    expect(EXECUTE_TYPESCRIPT_API_DECLARATION).not.toContain("tinyfish");
  });

  it("omits Web guidance when network access is disabled", () => {
    const prompt = buildSystemPrompt("orchestrator", { networkAccess: false });

    expect(prompt).not.toContain("Loaded extension: Web.");
    expect(prompt).not.toContain("# TinyFish CLI");
    expect(prompt).not.toContain("tinyfish search query");
    expect(prompt).not.toContain("- web:");

    const explicitPrompt = buildSystemPrompt("orchestrator", {
      loadedExtensionIds: ["web", "shell"],
      networkAccess: false,
    });

    expect(explicitPrompt).toContain("Loaded native extension: Shell.");
    expect(explicitPrompt).not.toContain("Loaded extension: Web.");
    expect(explicitPrompt).not.toContain("tinyfish search query");
  });

  it("injects generated workflow authoring contracts only into handler prompts", () => {
    expect(HANDLER_SYSTEM_PROMPT).toContain("namespace Agents");
    expect(HANDLER_SYSTEM_PROMPT).toContain("interface TaskAgentParameters");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("interface WorkflowAgentParameters");
    expect(HANDLER_SYSTEM_PROMPT).toContain("function defineTaskAgent");
    expect(HANDLER_SYSTEM_PROMPT).toContain("createSmithers");
    expect(HANDLER_SYSTEM_PROMPT).toContain("smithers workflow run");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("bunx smithers-orchestrator");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("bunx smithers ");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("createRunnableEntry");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("interface RunnableWorkflowEntryModule");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("declare function defineTaskAgent");

    expect(DEFAULT_SYSTEM_PROMPT).not.toContain(WORKFLOW_AUTHORING_CONTRACT_DECLARATION.trim());
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).not.toContain(
      WORKFLOW_AUTHORING_CONTRACT_DECLARATION.trim(),
    );
    expect(HANDLER_WORKFLOW_AUTHORING_APPENDIX).not.toContain("interface TaskAgentParameters");
    expect(HANDLER_WORKFLOW_AUTHORING_APPENDIX).not.toContain("interface SvvyApi");
    expect(HANDLER_WORKFLOW_AUTHORING_APPENDIX).not.toContain("workflow_list_assets");
    expect(HANDLER_WORKFLOW_AUTHORING_APPENDIX).not.toContain("smithers_run_workflow");
    expect(HANDLER_WORKFLOW_AUTHORING_APPENDIX).not.toContain("toolSurface");
    expect(WORKFLOW_AUTHORING_CONTRACT_DECLARATION).not.toContain("cx_overview");
    expect(WORKFLOW_AUTHORING_CONTRACT_DECLARATION).not.toContain("web_search");
  });

  it("generates Smithers handler guidance from pinned docs plus the svvy boundary", () => {
    expect(HANDLER_SYSTEM_PROMPT).toContain(SMITHERS_CORE_INSTRUCTIONS.trim());
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "Generated Smithers core instructions from smithers-orchestrator@0.22.0 official docs.",
    );
    expect(HANDLER_SYSTEM_PROMPT).toContain("smithers init");
    expect(HANDLER_SYSTEM_PROMPT).toContain("smithers workflow run implement");
    expect(HANDLER_SYSTEM_PROMPT).toContain("smithers ps");
    expect(HANDLER_SYSTEM_PROMPT).toContain("smithers inspect <run-id>");
    expect(HANDLER_SYSTEM_PROMPT).toContain("smithers approve <run-id>");
    expect(HANDLER_SYSTEM_PROMPT).toContain("smithers up workflow.tsx --run-id <id> --resume true");
    expect(HANDLER_SYSTEM_PROMPT).toContain("`.smithers/package.json`");
    expect(HANDLER_SYSTEM_PROMPT).toContain("Local workflow project manifest with");
    expect(HANDLER_SYSTEM_PROMPT).toContain("Workflows are JSX trees");
    expect(HANDLER_SYSTEM_PROMPT).toContain("The render loop in detail");
    expect(HANDLER_SYSTEM_PROMPT).toContain("Validated outputs are written");
    expect(HANDLER_SYSTEM_PROMPT).toContain("task IDs must be stable");
    expect(HANDLER_SYSTEM_PROMPT).toContain("Zod");
    expect(HANDLER_SYSTEM_PROMPT).toContain("svvy Smithers boundary for handler threads");
    expect(HANDLER_SYSTEM_PROMPT).toContain("Use the checked `smithers` CLI binary through Shell");
    expect(HANDLER_SYSTEM_PROMPT).toContain(
      "Import reusable svvy workflow material from `@svvy/workflows`",
    );
    expect(HANDLER_SYSTEM_PROMPT).toContain("svvyx workflows models list --json");
    expect(HANDLER_SYSTEM_PROMPT).toContain("svvyx workflows save");
    expect(HANDLER_SYSTEM_PROMPT).toContain("Generated Workflows output is read-only");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("repo-root `workflows/`");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("repo-root workflows");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("workflows/node_modules/.bin/smithers");

    const smithersOnlyPrompt = buildSystemPrompt("handler", {
      loadedExtensionIds: ["smithers"],
    });
    expect(smithersOnlyPrompt).toContain(SMITHERS_CORE_INSTRUCTIONS.trim());
    expect(smithersOnlyPrompt).toContain(SMITHERS_SVVY_BOUNDARY_APPENDIX);
    expect(smithersOnlyPrompt).not.toContain(
      "The handler workflow-authoring TypeScript contract follows",
    );
    expect(smithersOnlyPrompt).not.toContain("Workflow authoring guide for handler threads:");
    expect(smithersOnlyPrompt).not.toContain("Generated Smithers memory instructions");
  });

  it("keeps excluded Smithers fragments and memory out of default handler guidance", () => {
    for (const forbidden of [
      "bunx smithers-orchestrator",
      "bunx smithers ",
      "Gateway",
      "MCP",
      "HTTP",
      "OpenTelemetry",
      "DevTools",
      "event-stream",
      "OpenAPI",
      "Effect",
      "agent skill",
      "product workflow wrapper",
    ]) {
      expect(SMITHERS_CORE_INSTRUCTIONS).not.toContain(forbidden);
      expect(HANDLER_WORKFLOW_AUTHORING_APPENDIX).not.toContain(forbidden);
    }
    expect(SMITHERS_MEMORY_FRAGMENT).toBe(SMITHERS_MEMORY_INSTRUCTIONS);
    expect(SMITHERS_MEMORY_FRAGMENT).toContain("Generated Smithers memory instructions");
    expect(SMITHERS_MEMORY_FRAGMENT).toContain("bypassed by default");
    expect(SMITHERS_MEMORY_FRAGMENT).toContain("Memory is **state that survives across runs**");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("Generated Smithers memory instructions");
    expect(HANDLER_SYSTEM_PROMPT).not.toContain("Memory is **state that survives across runs**");
  });

  it("projects generated agent context entries with concrete content and editor sources", () => {
    const state = createDefaultGeneratedAgentContextState();
    const handlerEntries = buildGeneratedAgentContextEntries("handler", state);

    expect(handlerEntries.map((entry) => entry.id)).toEqual([
      "web-context",
      "smithers-core",
      "smithers-memory",
      "smithers-svvy-boundary",
      "workflow-authoring-contract",
      "handler-workflow-authoring-appendix",
      "execute-typescript",
    ]);
    expect(handlerEntries.every((entry) => entry.content.trim().length > 0)).toBe(true);
    expect(handlerEntries.find((entry) => entry.id === "web-context")?.sourcePath).toBe(
      "generated/instructions/full/010-tinyfish-cli.generated.md",
    );
    expect(
      handlerEntries.find((entry) => entry.id === "workflow-authoring-contract")?.content,
    ).toContain(WORKFLOW_AUTHORING_CONTRACT_DECLARATION.trim());
    expect(handlerEntries.find((entry) => entry.id === "smithers-core")?.content).toBe(
      SMITHERS_CORE_INSTRUCTIONS,
    );
    expect(handlerEntries.find((entry) => entry.id === "smithers-memory")?.content).toBe(
      SMITHERS_MEMORY_INSTRUCTIONS,
    );
    expect(handlerEntries.find((entry) => entry.id === "smithers-svvy-boundary")?.content).toBe(
      SMITHERS_SVVY_BOUNDARY_APPENDIX,
    );
    expect(handlerEntries.find((entry) => entry.id === "smithers-memory")?.content).toContain(
      "bypassed by default",
    );
    expect(
      handlerEntries.find((entry) => entry.id === "smithers-svvy-boundary")?.content,
    ).toContain("@svvy/workflows");
    expect(handlerEntries.find((entry) => entry.id === "smithers-memory")?.sourcePath).toBe(
      "generated/smithers-instructions.generated.ts",
    );
    expect(handlerEntries.find((entry) => entry.id === "smithers-svvy-boundary")?.sourcePath).toBe(
      "src/bun/smithers-runtime/workflow-authoring-guide.ts",
    );
    expect(buildGeneratedAgentContextEntries("handler", state).map((entry) => entry.id)).toEqual([
      "web-context",
      "smithers-core",
      "smithers-memory",
      "smithers-svvy-boundary",
      "workflow-authoring-contract",
      "handler-workflow-authoring-appendix",
      "execute-typescript",
    ]);
  });

  it("gives workflow task agents a direct-tool product surface plus code mode", () => {
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toBe(buildSystemPrompt("workflow-task"));
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toContain(
      "You are a task-scoped coding agent running inside one Smithers workflow task attempt.",
    );
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toContain(
      "Use the available task-local tools to complete the task described by the workflow.",
    );
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).toContain(
      "Work only within the task root or worktree provided by the workflow runtime.",
    );
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).not.toContain("thread_start");
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).not.toContain("thread_handoff");
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).not.toContain("thread_report");
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).not.toContain("request_context");
    expect(WORKFLOW_TASK_SYSTEM_PROMPT).not.toContain("smithers_*");
  });
});
