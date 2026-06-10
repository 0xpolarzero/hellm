import { describe, expect, it } from "bun:test";
import {
  buildAlwaysLoadedPromptContext,
  buildLoadedOptionalPromptContextPrompt,
  buildOptionalPromptContextRegistryPrompt,
  buildOrchestratorContextRoutingPrompt,
  validateOptionalPromptContextKeys,
} from "./prompt-contexts";

describe("prompt contexts", () => {
  it("rejects removed optional prompt context keys", () => {
    expect(validateOptionalPromptContextKeys([])).toEqual([]);
    expect(() => validateOptionalPromptContextKeys(["ci"])).toThrow(
      "Unknown prompt context key: ci",
    );
    expect(() => validateOptionalPromptContextKeys(["qa"])).toThrow(
      "Unknown prompt context key: qa",
    );
  });

  it("defines always-loaded cx and Smithers context by actor", () => {
    expect(buildAlwaysLoadedPromptContext("orchestrator")).toContain(
      "Loaded extension: cx semantic code navigation.",
    );
    expect(buildAlwaysLoadedPromptContext("orchestrator")).toContain(
      "Loaded always-on prompt context: Smithers workflow routing.",
    );
    expect(buildAlwaysLoadedPromptContext("orchestrator")).toContain(
      "thread_followup({ activate: true })",
    );
    expect(buildAlwaysLoadedPromptContext("handler")).toContain(
      "Loaded prompt-only extension: Smithers CLI workflow authoring.",
    );
    expect(buildAlwaysLoadedPromptContext("workflow-task")).toContain(
      "Loaded always-on prompt context: Smithers task-agent boundary.",
    );
    expect(buildAlwaysLoadedPromptContext("handler")).toContain("cx overview");
    expect(buildAlwaysLoadedPromptContext("handler")).toContain("cx symbols");
    expect(buildAlwaysLoadedPromptContext("handler")).toContain("cx definition");
    expect(buildAlwaysLoadedPromptContext("handler")).toContain("cx references");
    expect(buildAlwaysLoadedPromptContext("handler")).toContain("Read tool");
    expect(buildAlwaysLoadedPromptContext("handler")).toContain("Edit tool");
    expect(buildAlwaysLoadedPromptContext("handler")).toContain(
      "If cx reports a missing grammar, install with `cx lang add <lang>`.",
    );
    expect(buildAlwaysLoadedPromptContext("handler")).not.toContain("cx_overview");
    expect(buildAlwaysLoadedPromptContext("handler")).not.toContain("svvyx cx");
    expect(buildAlwaysLoadedPromptContext("handler")).toContain(
      "use official Smithers CLI commands through Shell",
    );
    expect(buildAlwaysLoadedPromptContext("handler")).toContain("smithers init");
    expect(buildAlwaysLoadedPromptContext("handler")).toContain("smithers workflow run");
    expect(buildAlwaysLoadedPromptContext("handler")).toContain("smithers ps");
    expect(buildAlwaysLoadedPromptContext("handler")).toContain("smithers inspect");
    expect(buildAlwaysLoadedPromptContext("handler")).not.toContain("bunx smithers-orchestrator");
    expect(buildAlwaysLoadedPromptContext("handler")).not.toContain("bunx smithers ");
    expect(buildAlwaysLoadedPromptContext("handler")).toContain(
      "Use `svvyx workflows list`, `svvyx workflows save`, `svvyx workflows build`, and `svvyx workflows models list` only for reusable app-global Workflows source-library operations.",
    );
    expect(buildAlwaysLoadedPromptContext("handler")).not.toContain("smithers_run_workflow");
    expect(buildAlwaysLoadedPromptContext("handler")).not.toContain("api.cx_*");
  });

  it("does not route optional prompt context through removed request_context", () => {
    expect(buildOrchestratorContextRoutingPrompt()).toContain(
      "No optional prompt context keys are part of the current product surface.",
    );
    expect(buildOrchestratorContextRoutingPrompt()).not.toContain("Project CI");
    expect(buildOptionalPromptContextRegistryPrompt()).toContain(
      "No optional prompt context keys are part of the current product surface.",
    );

    const unloaded = buildLoadedOptionalPromptContextPrompt([]);

    expect(unloaded).toBeUndefined();
    expect(() => buildLoadedOptionalPromptContextPrompt(["ci"])).toThrow(
      "Unknown prompt context key: ci",
    );
  });

  it("keeps Web as bounded TinyFish shell guidance with raw output by default", () => {
    const prompt = buildAlwaysLoadedPromptContext("orchestrator");

    expect(prompt).toContain("Loaded extension: Web.");
    expect(prompt).toContain("# TinyFish CLI");
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
    expect(prompt).not.toContain("web_search");
    expect(prompt).not.toContain("web_fetch");
    expect(prompt).not.toContain("Firecrawl");
  });

  it("omits Web from always-loaded context when network access is disabled", () => {
    const prompt = buildAlwaysLoadedPromptContext("orchestrator", { networkAccess: false });

    expect(prompt).toContain("Loaded extension: cx semantic code navigation.");
    expect(prompt).not.toContain("Loaded extension: Web.");
    expect(prompt).not.toContain("# TinyFish CLI");
    expect(prompt).not.toContain("tinyfish search query");
  });
});
