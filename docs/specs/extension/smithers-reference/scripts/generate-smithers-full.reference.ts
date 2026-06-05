#!/usr/bin/env bun

import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

type SmithersDocsFullJson = {
  url: string;
  content: string;
};

type Args = {
  output: string;
  version: string;
};

const bannedHeadings = [
  "## Always Run with `bunx`",
  "## Install the Agent Skill",
  "## Tools & sandboxing",
  "## Coherent task with tools",
  "## Per-agent least-privilege tools",
  "## Side-effect tools with idempotency",
  "# Smithers Integrations",
] as const;

const requiredMarkers = [
  "# Smithers",
  "## How It Works",
  "## JSX API",
  "## CLI",
  "# Smithers Events",
  "smithers init",
  "smithers up",
  "smithers inspect",
  "smithers logs",
  "smithers approve",
  "docs-full",
] as const;

const forbiddenMarkers = [
  "bunx smithers-orchestrator",
  "bunx --package smithers-orchestrator",
  "bunx smithers",
  "Always Run with",
  "Do **not** install Smithers globally",
  "do **not** use the bare `smithers`",
  "bare name `smithers` is a different package",
  "npm rm -g smithers-orchestrator",
  "Install the Agent Skill",
  "~/.claude/skills/smithers",
  "curl -fsSL https://smithers.sh/llms-full.txt",
  "smithers ask",
  "smithers-orchestrator/tools",
  "defineTool",
  "getDefinedToolMetadata",
  "Five built-in tools",
  "tools: { read",
  "tools: { write",
  "tools={[bash]}",
  "## Built-in Tools",
  "## read",
  "## write",
  "## edit",
  "## grep",
  "## bash",
  "## Using Tools with Agents",
  "CLI Agents",
  "SDK Agents",
  "CodexAgent",
  "AmpAgent",
  "Ecosystem",
  "Publishing Workflow Packs",
  "PI Integration",
  "@smithers-orchestrator/pi-plugin",
  "PI as Workflow Agent",
  "PI Server Client",
  "Hybrid: PI Extensibility + Smithers Orchestration",
] as const;

const parseArgs = (argv: string[]): Args => {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "Usage: bun <script> --output <absolute-output-path> --version <exact-version>",
      );
    }
    args.set(key.slice(2), value);
  }

  const output = args.get("output");
  const version = args.get("version");
  if (!output || !output.startsWith("/")) {
    throw new Error("--output must be an absolute path");
  }
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("--version must be an exact semver version such as 0.22.0");
  }
  return { output, version };
};

const run = async (command: string[], description: string): Promise<string> => {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${description} failed with exit ${exitCode}: ${stderr || stdout}`);
  }
  return stdout;
};

const headingLevel = (line: string): number | null => {
  const match = /^(#{1,6})\s+/.exec(line);
  return match ? match[1].length : null;
};

const removeSection = (markdown: string, heading: string): string => {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return markdown;
  }

  const level = headingLevel(lines[start]);
  if (!level) {
    throw new Error(`Configured heading is not a Markdown heading: ${heading}`);
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const nextLevel = headingLevel(lines[index]);
    if (nextLevel !== null && nextLevel <= level) {
      end = index;
      break;
    }
  }

  lines.splice(start, end - start);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
};

const transform = (content: string): string => {
  let output = content.replace(/\r\n/g, "\n");

  for (const heading of bannedHeadings) {
    output = removeSection(output, heading);
  }

  output = output.replaceAll("bunx smithers-orchestrator", "smithers");
  output =
    output
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n";
  return output;
};

const validateMarkers = (output: string, upstream: string): void => {
  if (output.length >= upstream.length * 0.9) {
    throw new Error(
      "transformed output did not shrink enough; banned sections may still be present",
    );
  }

  for (const marker of requiredMarkers) {
    if (!output.includes(marker)) {
      throw new Error(`transformed output is missing required marker: ${marker}`);
    }
  }

  for (const marker of forbiddenMarkers) {
    if (output.includes(marker)) {
      throw new Error(`transformed output still contains forbidden marker: ${marker}`);
    }
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs(Bun.argv.slice(2));
  const detectedVersion = (await run(["smithers", "--version"], "smithers --version")).trim();
  if (detectedVersion !== args.version) {
    throw new Error(`smithers version mismatch: expected ${args.version}, got ${detectedVersion}`);
  }

  const jsonText = await run(["smithers", "docs-full", "--json"], "smithers docs-full --json");
  const parsed = JSON.parse(jsonText) as Partial<SmithersDocsFullJson>;
  if (typeof parsed.url !== "string" || typeof parsed.content !== "string") {
    throw new Error("smithers docs-full --json must return { url, content }");
  }

  const expectedUrl = `https://raw.githubusercontent.com/smithersai/smithers/v${args.version}/docs/llms-full.txt`;
  if (parsed.url !== expectedUrl) {
    throw new Error(`docs URL mismatch: expected ${expectedUrl}, got ${parsed.url}`);
  }
  if (
    !parsed.content.startsWith("# Smithers — full documentation") ||
    parsed.content.length < 200_000
  ) {
    throw new Error("upstream docs-full content does not look like the full Smithers docs bundle");
  }

  const output = transform(parsed.content);
  validateMarkers(output, parsed.content);

  const tempPath = `${args.output}.tmp`;
  await mkdir(dirname(args.output), { recursive: true });
  await Bun.write(tempPath, output);
  await rename(tempPath, args.output);
};

await main();
