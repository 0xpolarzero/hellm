import { describe, expect, it } from "bun:test";
import {
  buildAlwaysLoadedPromptContext,
  buildLoadedOptionalPromptContextPrompt,
  buildOptionalPromptContextRegistryPrompt,
  buildOrchestratorContextRoutingPrompt,
  getOptionalPromptContext,
  validateOptionalPromptContextKeys,
} from "./prompt-contexts";

describe("prompt contexts", () => {
  it("deduplicates and validates optional prompt context keys", () => {
    expect(validateOptionalPromptContextKeys(["ci", "ci"])).toEqual(["ci"]);
    expect(() => validateOptionalPromptContextKeys(["qa"])).toThrow(
      "Unknown prompt context key: qa",
    );
  });

  it("defines always-loaded cx and Smithers context by actor", () => {
    expect(buildAlwaysLoadedPromptContext("orchestrator")).toContain(
      "Loaded always-on prompt context: cx semantic code navigation.",
    );
    expect(buildAlwaysLoadedPromptContext("orchestrator")).toContain(
      "Loaded always-on prompt context: Smithers workflow routing.",
    );
    expect(buildAlwaysLoadedPromptContext("handler")).toContain(
      "Loaded always-on prompt context: Smithers workflow supervision.",
    );
    expect(buildAlwaysLoadedPromptContext("workflow-task")).toContain(
      "Loaded always-on prompt context: Smithers task-agent boundary.",
    );
    expect(buildAlwaysLoadedPromptContext("handler")).toContain("cx.overview");
    expect(buildAlwaysLoadedPromptContext("handler")).toContain("api.cx.*");
  });

  it("defines Project CI as optional handler-only guidance", () => {
    const context = getOptionalPromptContext("ci");

    expect(context).toMatchObject({
      key: "ci",
      title: "Project CI",
      allowedActors: ["handler"],
    });
    expect(context.prompt).toContain('productKind = "project-ci"');
    expect(context.prompt).toContain("resultSchema");
    expect(context.prompt).toContain("conventional saved entry path");
    expect(context.prompt).toContain("Never infer CI state from logs");
  });

  it("separates compact routing facts from loaded optional prompt context", () => {
    expect(buildOrchestratorContextRoutingPrompt()).toContain('context: ["ci"]');
    expect(buildOptionalPromptContextRegistryPrompt()).toContain(
      'request_context({ keys: ["ci"] })',
    );

    const unloaded = buildLoadedOptionalPromptContextPrompt([]);
    const loaded = buildLoadedOptionalPromptContextPrompt(["ci"]);

    expect(unloaded).toBeUndefined();
    expect(loaded).toContain("Loaded optional prompt context: Project CI.");
    expect(loaded).toContain('smithers.list_workflows({ productKind: "project-ci" })');
  });
});
