import { describe, expect, it } from "bun:test";
import {
  buildHandlerContextRegistryPrompt,
  buildLoadedHandlerContextPrompt,
  buildOrchestratorContextRoutingPrompt,
  getHandlerContextPack,
  validateHandlerContextKeys,
} from "./handler-context-packs";

describe("handler context packs", () => {
  it("deduplicates and validates typed context keys", () => {
    expect(validateHandlerContextKeys(["ci", "ci"])).toEqual(["ci"]);
    expect(() => validateHandlerContextKeys(["qa"])).toThrow("Unknown handler context key: qa");
  });

  it("defines the Project CI pack as handler-only guidance", () => {
    const pack = getHandlerContextPack("ci");

    expect(pack).toMatchObject({
      key: "ci",
      title: "Project CI",
      allowedActors: ["handler"],
    });
    expect(pack.prompt).toContain('productKind = "project-ci"');
    expect(pack.prompt).toContain("resultSchema");
    expect(pack.prompt).toContain("conventional saved entry path");
    expect(pack.prompt).toContain("does not ship or auto-create");
    expect(pack.prompt).toContain("Never infer CI state from logs");
  });

  it("separates compact routing facts from loaded handler context", () => {
    expect(buildOrchestratorContextRoutingPrompt()).toContain('context: ["ci"]');
    expect(buildHandlerContextRegistryPrompt()).toContain('request_context({ keys: ["ci"] })');

    const unloaded = buildLoadedHandlerContextPrompt([]);
    const loaded = buildLoadedHandlerContextPrompt(["ci"]);

    expect(unloaded).toBeUndefined();
    expect(loaded).toContain("Loaded handler context pack: Project CI.");
    expect(loaded).toContain('smithers.list_workflows({ productKind: "project-ci" })');
  });
});
