import { describe, expect, it } from "bun:test";
import {
  CX_SKILL_INSTRUCTIONS,
  TINYFISH_CLI_INSTRUCTIONS,
} from "../../generated/cli-instructions.generated";
import {
  CX_SKILL_GENERATOR_CONTRACT,
  validateCxIndexEntry,
  validateCxSkillMarkdown,
} from "../../scripts/generate-cx-skill";
import {
  buildTinyFishMarkdownFromPackage,
  TINYFISH_GENERATOR_CONTRACT,
  validateTinyFishGeneratedMarkdown,
  validateTinyFishPackageMetadata,
} from "../../scripts/generate-tinyfish-cli";
import { buildGeneratedAgentContextEntries, buildSystemPrompt } from "./default-system-prompt";

describe("generated CLI instruction builders", () => {
  it("validates the committed cx skill as upstream-only generated content", () => {
    validateCxSkillMarkdown(CX_SKILL_INSTRUCTIONS);

    expect(CX_SKILL_INSTRUCTIONS).toContain("Read tool");
    expect(CX_SKILL_INSTRUCTIONS).toContain("Edit tool");
    expect(CX_SKILL_INSTRUCTIONS).toContain("cx overview PATH");
    expect(CX_SKILL_INSTRUCTIONS).toContain("cx references --name NAME");
    for (const phrase of CX_SKILL_GENERATOR_CONTRACT.forbiddenPhrases) {
      expect(CX_SKILL_INSTRUCTIONS).not.toContain(phrase);
    }
  });

  it("validates cx sparse-index identity and rejects stale artifact metadata", () => {
    const validLine = JSON.stringify({
      name: CX_SKILL_GENERATOR_CONTRACT.packageName,
      vers: CX_SKILL_GENERATOR_CONTRACT.version,
      cksum: CX_SKILL_GENERATOR_CONTRACT.checksum,
      yanked: false,
    });

    expect(validateCxIndexEntry(`${validLine}\n`)).toMatchObject({
      name: "cx-cli",
      vers: "0.7.1",
      cksum: CX_SKILL_GENERATOR_CONTRACT.checksum,
      yanked: false,
    });
    expect(() =>
      validateCxIndexEntry(`${validLine.replace(CX_SKILL_GENERATOR_CONTRACT.checksum, "bad")}\n`),
    ).toThrow("Unexpected cx-cli checksum");
    expect(() =>
      validateCxIndexEntry(`${validLine.replace('"yanked":false', '"yanked":true')}\n`),
    ).toThrow("is yanked");
  });

  it("validates the committed TinyFish instructions and forbidden phrase removals", () => {
    validateTinyFishGeneratedMarkdown(TINYFISH_CLI_INSTRUCTIONS);

    expect(TINYFISH_CLI_INSTRUCTIONS).toContain("# TinyFish CLI");
    expect(TINYFISH_CLI_INSTRUCTIONS).toContain("tinyfish auth login");
    expect(TINYFISH_CLI_INSTRUCTIONS).toContain("tinyfish auth status");
    expect(TINYFISH_CLI_INSTRUCTIONS).toContain("tinyfish search query");
    expect(TINYFISH_CLI_INSTRUCTIONS).toContain("tinyfish fetch content get");
    expect(TINYFISH_CLI_INSTRUCTIONS).toContain("tinyfish agent batch run --input runs.csv");
    for (const phrase of TINYFISH_GENERATOR_CONTRACT.forbiddenPhrases) {
      expect(TINYFISH_CLI_INSTRUCTIONS).not.toContain(phrase);
    }
  });

  it("validates TinyFish npm metadata and rejects mutable or mismatched package identity", () => {
    const metadata = {
      name: TINYFISH_GENERATOR_CONTRACT.packageName,
      version: TINYFISH_GENERATOR_CONTRACT.version,
      dist: {
        tarball: TINYFISH_GENERATOR_CONTRACT.tarball,
        shasum: TINYFISH_GENERATOR_CONTRACT.shasum,
        integrity: TINYFISH_GENERATOR_CONTRACT.integrity,
      },
      engines: { node: TINYFISH_GENERATOR_CONTRACT.nodeRequirement },
      bin: { tinyfish: "dist/index.js" },
    };

    expect(() => validateTinyFishPackageMetadata(metadata)).not.toThrow();
    expect(() =>
      validateTinyFishPackageMetadata({
        ...metadata,
        version: "latest",
      }),
    ).toThrow("Unexpected TinyFish package version");
    expect(() =>
      validateTinyFishPackageMetadata({
        ...metadata,
        dist: { ...metadata.dist, shasum: "bad" },
      }),
    ).toThrow("Unexpected TinyFish shasum");
  });

  it("builds TinyFish Markdown from package inputs while stripping forbidden sections", () => {
    const metadata = {
      name: TINYFISH_GENERATOR_CONTRACT.packageName,
      version: TINYFISH_GENERATOR_CONTRACT.version,
      dist: {
        tarball: TINYFISH_GENERATOR_CONTRACT.tarball,
        shasum: TINYFISH_GENERATOR_CONTRACT.shasum,
        integrity: TINYFISH_GENERATOR_CONTRACT.integrity,
      },
      engines: { node: TINYFISH_GENERATOR_CONTRACT.nodeRequirement },
      bin: { tinyfish: "dist/index.js" },
    };
    const markdown = buildTinyFishMarkdownFromPackage({
      metadata,
      packageJson: JSON.stringify(metadata),
      readme: [
        "# TinyFish CLI",
        "",
        "## Installation",
        "npm install -g @tiny-fish/cli",
        "",
        "## Authentication",
        "tinyfish auth login",
        "export TINYFISH_API_KEY=sk-tinyfish-example",
        "",
        "## Usage",
        'tinyfish agent run "Find pricing" --url https://example.com',
        'tinyfish search query "agentql pricing"',
        "tinyfish fetch content get https://agentql.com",
        "tinyfish browser session create",
        "",
        "## CI/CD",
        "sk-tinyfish-should-not-ship",
      ].join("\n"),
      indexJs:
        "registerAuth(program); registerSearch(program); registerFetch(program); registerBrowser(program);",
      authJs: '.command("status").command("logout")',
      searchJs: '.command("query").option("--location <value>").option("--language <value>")',
      fetchJs:
        '.command("get").argument("<urls...>").option("--format <format>").option("--links").option("--image-links")',
      runJs: '.command("run")',
      batchJs: '.command("batch")',
      browserJs: '.command("session")',
      claudeConfigJs: "TINYFISH_PERMISSION CLAUDE_MD_MARKER TINYFISH_WEBFETCH_HOOK",
    });

    validateTinyFishGeneratedMarkdown(markdown);
    expect(markdown).toContain("tinyfish agent batch run --input runs.csv");
    expect(markdown).not.toContain("npm install -g @tiny-fish/cli");
    expect(markdown).not.toContain("sk-tinyfish-");
  });

  it("includes generated instruction content only in loaded and eligible actor context", () => {
    expect(buildSystemPrompt("handler")).toContain(CX_SKILL_INSTRUCTIONS.trim());
    expect(buildSystemPrompt("handler")).toContain(TINYFISH_CLI_INSTRUCTIONS.trim());

    const withoutWeb = buildSystemPrompt("handler", { networkAccess: false });
    expect(withoutWeb).toContain(CX_SKILL_INSTRUCTIONS.trim());
    expect(withoutWeb).not.toContain(TINYFISH_CLI_INSTRUCTIONS.trim());

    const generatedEntries = buildGeneratedAgentContextEntries("handler", createTestState(), {
      networkAccess: false,
    });
    expect(generatedEntries.map((entry) => entry.id)).not.toContain("web-context");
  });
});

function createTestState() {
  return {
    version: 1 as const,
    revision: 0,
    updatedAt: "2026-06-09T00:00:00.000Z",
    instructionBlocks: {},
    actorRecipes: {
      orchestrator: {
        actor: "orchestrator" as const,
        instructionBlockIds: [],
        generatedSectionIds: [],
      },
      handler: {
        actor: "handler" as const,
        instructionBlockIds: [],
        generatedSectionIds: [],
      },
      "workflow-task": {
        actor: "workflow-task" as const,
        instructionBlockIds: [],
        generatedSectionIds: [],
      },
    },
  };
}
