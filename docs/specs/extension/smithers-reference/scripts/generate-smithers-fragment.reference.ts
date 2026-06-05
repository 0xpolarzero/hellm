#!/usr/bin/env bun

import { mkdir, rename } from "node:fs/promises";
import { basename, dirname } from "node:path";

type SmithersDocsFullJson = {
  url: string;
  content: string;
};

type Args = {
  output: string;
  version: string;
};

type FragmentSpec = {
  heading: string;
  minLength: number;
  bannedHeadings?: readonly string[];
  requiredMarkers: readonly string[];
};

const outputFragments: Record<string, FragmentSpec> = {
  "010-smithers-core.generated.md": {
    heading: "# Smithers",
    minLength: 150_000,
    bannedHeadings: [
      "## After Installation",
      "## Always Run with `bunx`",
      "## Install the Agent Skill",
      "## Tools & sandboxing",
      "## Coherent task with tools",
      "## Per-agent least-privilege tools",
      "## Side-effect tools with idempotency",
      "## Package Configuration",
      "## Binary",
      "## Subpath Exports",
      "## Workspace Packages",
      "## TypeScript Configuration",
      "## Bun Configuration",
      "## npm Scripts",
      "## Hijack handoff",
    ],
    requiredMarkers: [
      "# Smithers",
      "## How It Works",
      "## JSX API",
      "## CLI",
      "smithers init",
      "smithers up",
      "smithers inspect",
      "smithers logs",
      "smithers approve",
      "docs-full",
    ],
  },
  "020-smithers-observability.generated.md": {
    heading: "# Smithers Observability",
    minLength: 20_000,
    bannedHeadings: ["## Tool surface"],
    requiredMarkers: [
      "# Smithers Observability",
      "## HTTP Server",
      "## Serve Mode",
      "## Gateway",
      "/metrics",
      "/events",
    ],
  },
  "030-smithers-events.generated.md": {
    heading: "# Smithers Events",
    minLength: 8_000,
    requiredMarkers: ["# Smithers Events", "SmithersEvent", "smithers events"],
  },
  "040-smithers-memory.generated.md": {
    heading: "# Smithers Memory",
    minLength: 2_000,
    requiredMarkers: ["# Smithers Memory", "createMemoryStore", "memory list"],
  },
};

const fullBundleRequiredHeadings = [
  "# Smithers",
  "# Smithers Memory",
  "# Smithers OpenAPI Tools",
  "# Smithers Observability",
  "# Smithers Effect API",
  "# Smithers Integrations",
  "# Smithers Events",
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
  "# Smithers OpenAPI Tools",
  "# Smithers Effect API",
  "# Smithers Integrations",
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
  if (!outputFragments[basename(output)]) {
    throw new Error(`unsupported Smithers generated output basename: ${basename(output)}`);
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

const extractFragments = (content: string): Map<string, string> => {
  const normalized = content.replace(/\r\n/g, "\n");
  const parts = normalized.split(
    "\n\n===============================================================================\n\n",
  );
  const fragments = new Map<string, string>();

  for (const part of parts) {
    const trimmed = part.trim();
    for (const heading of fullBundleRequiredHeadings) {
      if (trimmed.startsWith(`${heading}\n`)) {
        fragments.set(heading, `${trimmed}\n`);
      }
    }
  }

  const first = parts[0] ?? "";
  const coreStart = first.indexOf("\n# Smithers\n\n> Smithers");
  if (coreStart !== -1) {
    fragments.set("# Smithers", `${first.slice(coreStart + 1).trim()}\n`);
  }

  return fragments;
};

const transform = (content: string, spec: FragmentSpec): string => {
  const fragments = extractFragments(content);
  let output = fragments.get(spec.heading);
  if (!output) {
    throw new Error(`upstream docs-full content is missing fragment ${spec.heading}`);
  }

  for (const heading of spec.bannedHeadings ?? []) {
    output = removeSection(output, heading);
  }

  return (
    output
      .replaceAll("bunx smithers-orchestrator", "smithers")
      .replaceAll("bunx smithers", "smithers")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
};

const validateMarkers = (output: string, spec: FragmentSpec): void => {
  if (!output.startsWith(spec.heading)) {
    throw new Error(`transformed output must start with ${spec.heading}`);
  }
  if (output.length < spec.minLength) {
    throw new Error(`transformed output for ${spec.heading} is implausibly small`);
  }

  for (const marker of spec.requiredMarkers) {
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

const validateFullBundle = (content: string): void => {
  if (!content.startsWith("# Smithers — full documentation") || content.length < 200_000) {
    throw new Error("upstream docs-full content does not look like the full Smithers docs bundle");
  }
  for (const heading of fullBundleRequiredHeadings) {
    if (!content.includes(heading)) {
      throw new Error(
        `upstream docs-full content is missing expected fragment heading: ${heading}`,
      );
    }
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs(Bun.argv.slice(2));
  const spec = outputFragments[basename(args.output)];
  if (!spec) {
    throw new Error(`unsupported Smithers generated output basename: ${basename(args.output)}`);
  }

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

  validateFullBundle(parsed.content);
  const output = transform(parsed.content, spec);
  validateMarkers(output, spec);

  const tempPath = `${args.output}.tmp`;
  await mkdir(dirname(args.output), { recursive: true });
  await Bun.write(tempPath, output);
  await rename(tempPath, args.output);
};

await main();
