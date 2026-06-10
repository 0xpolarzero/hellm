#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export const TINYFISH_GENERATOR_CONTRACT = {
  packageName: "@tiny-fish/cli",
  version: "0.1.6",
  registryUrl: "https://registry.npmjs.org/@tiny-fish%2fcli/0.1.6",
  tarball: "https://registry.npmjs.org/@tiny-fish/cli/-/cli-0.1.6.tgz",
  shasum: "30ac4045babb5cdb852177f0d47b9d8a2a0a733f",
  integrity:
    "sha512-0rpi8XywJN7J/JquUxwf8++cvxNsbmhg+BoMlw0VIArQjC1L7P0opgTnB5GYYKKSYNRiOFM2G+Sn8SN3EH4uMQ==",
  nodeRequirement: ">=24.0.0",
  requiredPackageFiles: [
    "package/README.md",
    "package/package.json",
    "package/dist/index.js",
    "package/dist/commands/search.js",
    "package/dist/commands/fetch.js",
    "package/dist/commands/run.js",
    "package/dist/commands/batch.js",
    "package/dist/commands/browser.js",
    "package/dist/lib/claude-config.js",
  ],
  requiredGeneratedMarkers: [
    "# TinyFish CLI",
    "tinyfish auth",
    "tinyfish search query",
    "tinyfish fetch content get",
    "tinyfish agent run",
    "tinyfish agent batch",
    "tinyfish browser session create",
  ],
  forbiddenPhrases: [
    "npm install -g @tiny-fish/cli",
    "tinyfish config-claude",
    "WebSearch",
    "WebFetch",
    "CLAUDE.md",
    "Claude Code is now configured",
    "svvyx web",
    "web_search",
    "web_fetch",
    "extensions.web",
    "sk-tinyfish-",
  ],
} as const;

type TinyFishPackageMetadata = {
  name: string;
  version: string;
  dist?: {
    tarball?: string;
    shasum?: string;
    integrity?: string;
  };
  engines?: {
    node?: string;
  };
  bin?: Record<string, string>;
};

type TinyFishPackageInputs = {
  metadata: TinyFishPackageMetadata;
  readme: string;
  packageJson: string;
  indexJs: string;
  authJs: string;
  searchJs: string;
  fetchJs: string;
  runJs: string;
  batchJs: string;
  browserJs: string;
  claudeConfigJs: string;
};

function parseArgs(args: readonly string[]): { output: string; version: string } {
  let output = "";
  let version = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") {
      output = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--version") {
      version = args[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!output) {
    throw new Error("Missing required --output <absolute-output-path> argument.");
  }
  if (!output.startsWith("/")) {
    throw new Error("--output must be an absolute path.");
  }
  if (version !== TINYFISH_GENERATOR_CONTRACT.version) {
    throw new Error(
      `--version must be exactly ${TINYFISH_GENERATOR_CONTRACT.version}; received ${version || "<empty>"}.`,
    );
  }
  return { output, version };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function validateTinyFishPackageMetadata(metadata: TinyFishPackageMetadata): void {
  if (metadata.name !== TINYFISH_GENERATOR_CONTRACT.packageName) {
    throw new Error(`Unexpected TinyFish package name: ${metadata.name}`);
  }
  if (metadata.version !== TINYFISH_GENERATOR_CONTRACT.version) {
    throw new Error(`Unexpected TinyFish package version: ${metadata.version}`);
  }
  if (metadata.dist?.tarball !== TINYFISH_GENERATOR_CONTRACT.tarball) {
    throw new Error(`Unexpected TinyFish tarball URL: ${metadata.dist?.tarball ?? "<missing>"}`);
  }
  if (metadata.dist?.shasum !== TINYFISH_GENERATOR_CONTRACT.shasum) {
    throw new Error(`Unexpected TinyFish shasum: ${metadata.dist?.shasum ?? "<missing>"}`);
  }
  if (metadata.dist?.integrity !== TINYFISH_GENERATOR_CONTRACT.integrity) {
    throw new Error(`Unexpected TinyFish integrity: ${metadata.dist?.integrity ?? "<missing>"}`);
  }
  if (metadata.engines?.node !== TINYFISH_GENERATOR_CONTRACT.nodeRequirement) {
    throw new Error(
      `Unexpected TinyFish Node requirement: ${metadata.engines?.node ?? "<missing>"}`,
    );
  }
  if (metadata.bin?.tinyfish !== "dist/index.js" && metadata.bin?.tinyfish !== "./dist/index.js") {
    throw new Error("TinyFish package does not expose the tinyfish binary at dist/index.js.");
  }
}

function verifyTarball(bytes: Uint8Array): void {
  const sha1 = createHash("sha1").update(bytes).digest("hex");
  if (sha1 !== TINYFISH_GENERATOR_CONTRACT.shasum) {
    throw new Error(`Unexpected TinyFish tarball sha1 ${sha1}.`);
  }
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (integrity !== TINYFISH_GENERATOR_CONTRACT.integrity) {
    throw new Error(`Unexpected TinyFish tarball integrity ${integrity}.`);
  }
}

function extractTarFile(archivePath: string, innerPath: string): string {
  const result = Bun.spawnSync({
    cmd: ["tar", "-xOf", archivePath, innerPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const stderr = Buffer.from(result.stderr).toString("utf8").trim();
    throw new Error(`Failed to extract ${innerPath} from TinyFish package: ${stderr}`);
  }
  return Buffer.from(result.stdout).toString("utf8");
}

function listTarFiles(archivePath: string): string[] {
  const result = Bun.spawnSync({
    cmd: ["tar", "-tzf", archivePath],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const stderr = Buffer.from(result.stderr).toString("utf8").trim();
    throw new Error(`Failed to list TinyFish package files: ${stderr}`);
  }
  return Buffer.from(result.stdout).toString("utf8").split("\n").filter(Boolean);
}

function requireSourceMarker(source: string, marker: string, label: string): void {
  if (!source.includes(marker)) {
    throw new Error(`TinyFish ${label} is missing marker: ${marker}`);
  }
}

function sanitizeReadme(readme: string): string {
  const lines: string[] = [];
  let skipping = false;

  for (const line of readme.split("\n")) {
    const heading = line.match(/^##\s+(.+)$/)?.[1]?.trim();
    if (heading) {
      skipping = heading === "Installation" || heading === "CI/CD";
    }
    if (skipping) {
      continue;
    }
    if (
      line.includes("npm install") ||
      line.includes("sk-tinyfish-") ||
      line.includes("Or set via environment variable") ||
      line.includes("MCP tool") ||
      line.includes("MCP token") ||
      line.includes("<mcp_run_id>")
    ) {
      continue;
    }
    lines.push(line);
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validateTinyFishGeneratedMarkdown(markdown: string): void {
  if (!markdown.trim()) {
    throw new Error("Generated TinyFish Markdown is empty.");
  }
  for (const marker of TINYFISH_GENERATOR_CONTRACT.requiredGeneratedMarkers) {
    if (!markdown.includes(marker)) {
      throw new Error(`Generated TinyFish Markdown is missing marker: ${marker}`);
    }
  }
  for (const phrase of TINYFISH_GENERATOR_CONTRACT.forbiddenPhrases) {
    if (markdown.includes(phrase)) {
      throw new Error(`Generated TinyFish Markdown contains forbidden phrase: ${phrase}`);
    }
  }
}

export function buildTinyFishMarkdownFromPackage(inputs: TinyFishPackageInputs): string {
  validateTinyFishPackageMetadata(inputs.metadata);
  const packageJson = JSON.parse(inputs.packageJson) as TinyFishPackageMetadata;
  validateTinyFishPackageMetadata({
    ...inputs.metadata,
    name: packageJson.name,
    version: packageJson.version,
    engines: packageJson.engines,
    bin: packageJson.bin,
  });

  for (const [source, marker, label] of [
    [inputs.indexJs, "registerAuth(program)", "dist/index.js"],
    [inputs.indexJs, "registerSearch(program)", "dist/index.js"],
    [inputs.indexJs, "registerFetch(program)", "dist/index.js"],
    [inputs.indexJs, "registerBrowser(program)", "dist/index.js"],
    [inputs.authJs, '.command("status")', "auth.js"],
    [inputs.authJs, '.command("logout")', "auth.js"],
    [inputs.searchJs, '.command("query")', "search.js"],
    [inputs.searchJs, '.option("--location <value>"', "search.js"],
    [inputs.searchJs, '.option("--language <value>"', "search.js"],
    [inputs.fetchJs, '.command("get")', "fetch.js"],
    [inputs.fetchJs, '.argument("<urls...>"', "fetch.js"],
    [inputs.fetchJs, '.option("--format <format>"', "fetch.js"],
    [inputs.fetchJs, '.option("--links"', "fetch.js"],
    [inputs.fetchJs, '.option("--image-links"', "fetch.js"],
    [inputs.runJs, '.command("run")', "run.js"],
    [inputs.batchJs, '.command("batch")', "batch.js"],
    [inputs.browserJs, '.command("session")', "browser.js"],
    [inputs.claudeConfigJs, "TINYFISH_PERMISSION", "claude-config.js"],
    [inputs.claudeConfigJs, "CLAUDE_MD_MARKER", "claude-config.js"],
    [inputs.claudeConfigJs, "TINYFISH_WEBFETCH_HOOK", "claude-config.js"],
  ] as const) {
    requireSourceMarker(source, marker, label);
  }

  const markdown = [
    sanitizeReadme(inputs.readme),
    "",
    "## Auth Status And Logout",
    "",
    "```bash",
    "tinyfish auth status",
    "tinyfish auth status --pretty",
    "tinyfish auth logout",
    "```",
    "",
    "## Batch Agent Automation",
    "",
    "```bash",
    "tinyfish agent batch run --input runs.csv",
    "tinyfish agent batch list",
    "tinyfish agent batch get <batch_id>",
    "tinyfish agent batch cancel <batch_id>",
    "```",
  ].join("\n");

  validateTinyFishGeneratedMarkdown(markdown);
  return `${markdown.trim()}\n`;
}

export function extractTinyFishPackageInputs(
  metadata: TinyFishPackageMetadata,
  tarballBytes: Uint8Array,
): TinyFishPackageInputs {
  validateTinyFishPackageMetadata(metadata);
  verifyTarball(tarballBytes);

  const tempDir = mkdtempSync(join(tmpdir(), "svvy-tinyfish-cli-"));
  const tarballPath = join(tempDir, "tinyfish-cli.tgz");
  try {
    writeFileSync(tarballPath, tarballBytes);
    const files = new Set(listTarFiles(tarballPath));
    for (const file of TINYFISH_GENERATOR_CONTRACT.requiredPackageFiles) {
      if (!files.has(file)) {
        throw new Error(`TinyFish package is missing required file: ${file}`);
      }
    }
    return {
      metadata,
      readme: extractTarFile(tarballPath, "package/README.md"),
      packageJson: extractTarFile(tarballPath, "package/package.json"),
      indexJs: extractTarFile(tarballPath, "package/dist/index.js"),
      authJs: extractTarFile(tarballPath, "package/dist/commands/auth.js"),
      searchJs: extractTarFile(tarballPath, "package/dist/commands/search.js"),
      fetchJs: extractTarFile(tarballPath, "package/dist/commands/fetch.js"),
      runJs: extractTarFile(tarballPath, "package/dist/commands/run.js"),
      batchJs: extractTarFile(tarballPath, "package/dist/commands/batch.js"),
      browserJs: extractTarFile(tarballPath, "package/dist/commands/browser.js"),
      claudeConfigJs: extractTarFile(tarballPath, "package/dist/lib/claude-config.js"),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeAtomically(output: string, contents: string): void {
  const tempPath = join(
    dirname(output),
    `.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  writeFileSync(tempPath, contents, "utf8");
  renameSync(tempPath, output);
}

async function main(): Promise<void> {
  const { output } = parseArgs(Bun.argv.slice(2));
  const metadata = await fetchJson<TinyFishPackageMetadata>(
    TINYFISH_GENERATOR_CONTRACT.registryUrl,
  );
  validateTinyFishPackageMetadata(metadata);
  const tarballBytes = await fetchBytes(TINYFISH_GENERATOR_CONTRACT.tarball);
  const inputs = extractTinyFishPackageInputs(metadata, tarballBytes);
  const markdown = buildTinyFishMarkdownFromPackage(inputs);
  writeAtomically(output, markdown);
  console.log(
    `Generated TinyFish CLI instructions from ${TINYFISH_GENERATOR_CONTRACT.packageName}@${TINYFISH_GENERATOR_CONTRACT.version}.`,
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
