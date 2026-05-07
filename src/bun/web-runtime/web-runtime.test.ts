import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createWebProvider } from "./provider-registry";
import { buildWebPromptContext } from "./prompt-context";
import { createWebTools } from "./tools";

describe("web runtime", () => {
  it("resolves provider readiness without leaking API keys into prompt context", () => {
    const local = createWebProvider({ provider: "local" });
    expect(local.checkReady().ready).toBe(true);

    const tinyfish = createWebProvider({ provider: "tinyfish" });
    expect(tinyfish.checkReady()).toMatchObject({
      ready: false,
      providerId: "tinyfish",
      missingRequirement: "TinyFish API key",
    });

    const configured = createWebProvider(
      { provider: "firecrawl" },
      { firecrawlApiKey: "fc-secret-value" },
    );
    const prompt = buildWebPromptContext("orchestrator", configured);
    expect(prompt).toContain("Selected Web Provider: Firecrawl");
    expect(prompt).toContain("web.fetch");
    expect(prompt).toContain("artifact-backed");
    expect(prompt).not.toContain("fc-secret-value");
  });

  it("does not register hosted provider tools until required keys exist", () => {
    const unavailable = createWebTools({
      cwd: mkdtempSync(join(tmpdir(), "svvy-web-unavailable-")),
      runtime: { current: null },
      provider: createWebProvider({ provider: "tinyfish" }),
      store: { createArtifact: () => ({ id: "artifact" }) },
    });
    expect(unavailable.map((tool) => tool.name)).toEqual([]);

    const available = createWebTools({
      cwd: mkdtempSync(join(tmpdir(), "svvy-web-available-")),
      runtime: { current: null },
      provider: createWebProvider({ provider: "firecrawl" }, { firecrawlApiKey: "fc-key" }),
      store: { createArtifact: () => ({ id: "artifact" }) },
    });
    expect(available.map((tool) => tool.name)).toEqual(["web.search", "web.fetch"]);
    expect(JSON.stringify(available[0]?.parameters)).toContain("scrapeOptions");
  });

  it("local fetch writes artifact-backed output and rejects private URLs", async () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-web-fetch-"));
    const artifacts: Array<{ id: string; path: string; content: string }> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("<html><title>Example</title><main>Hello world</main></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    try {
      const tools = createWebTools({
        cwd: root,
        runtime: { current: null },
        provider: createWebProvider({ provider: "local" }),
        store: {
          createArtifact(input) {
            const id = `artifact-${artifacts.length + 1}`;
            const path = join(root, `${id}-${input.name}`);
            writeFileSync(path, input.content ?? "");
            artifacts.push({ id, path, content: input.content ?? "" });
            return { id, path };
          },
        },
      });
      const fetchTool = tools.find((tool) => tool.name === "web.fetch");
      expect(fetchTool).toBeTruthy();
      const result = await fetchTool!.execute("structured-command:web-command", {
        url: "https://example.com/docs",
      });
      expect(result.details.status).toBe("succeeded");
      expect(result.details.artifacts?.[0]?.path).toContain("web-fetch");
      expect(result.content[0]?.type).toBe("text");
      expect((result.content[0] as { text: string }).text).not.toContain("Hello world");
      expect(readFileSync(result.details.artifacts![0]!.path, "utf8")).toContain("Hello world");
      expect(result.details.commandFacts).toMatchObject({
        providerId: "local",
        toolName: "web.fetch",
        metadataArtifactId: "artifact-2",
      });

      const rejected = await fetchTool!.execute("structured-command:web-command-2", {
        url: "http://127.0.0.1:3000",
      });
      expect(rejected.details.status).toBe("failed");
      expect(rejected.details.error?.category).toBe("invalid_url");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
