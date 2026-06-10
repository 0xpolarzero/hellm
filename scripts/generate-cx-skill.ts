#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export const CX_SKILL_GENERATOR_CONTRACT = {
  packageName: "cx-cli",
  version: "0.7.1",
  sparseIndexUrl: "https://index.crates.io/cx/-c/cx-cli",
  crateUrl: "https://static.crates.io/crates/cx-cli/cx-cli-0.7.1.crate",
  checksum: "956f63dd7eba71378917dc82932e2e9106dd12d7a4bdd3244b507c11b5954cf1",
  requiredMarkers: [
    "# cx",
    "Semantic Code Navigation",
    "Quick reference",
    "cx overview",
    "cx symbols",
    "cx definition",
    "cx references",
    "cx lang list",
    "cx lang add",
    "Aliases",
    "Kinds",
    "Key patterns",
    "Pagination",
    "Missing grammars",
    "Read tool",
    "Edit tool",
  ],
  forbiddenPhrases: ["svvyx cx", "cx_overview", "extensions.cx", "api.cx", "prompt-only"],
} as const;

type CxIndexEntry = {
  name: string;
  vers: string;
  cksum: string;
  yanked: boolean;
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
  if (version !== CX_SKILL_GENERATOR_CONTRACT.version) {
    throw new Error(
      `--version must be exactly ${CX_SKILL_GENERATOR_CONTRACT.version}; received ${version || "<empty>"}.`,
    );
  }
  return { output, version };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function validateCxIndexEntry(sparseIndexContents: string): CxIndexEntry {
  const entries = sparseIndexContents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CxIndexEntry);
  const entry = entries.find(
    (candidate) =>
      candidate.name === CX_SKILL_GENERATOR_CONTRACT.packageName &&
      candidate.vers === CX_SKILL_GENERATOR_CONTRACT.version,
  );
  if (!entry) {
    throw new Error(
      `Missing sparse-index entry for ${CX_SKILL_GENERATOR_CONTRACT.packageName}@${CX_SKILL_GENERATOR_CONTRACT.version}.`,
    );
  }
  if (entry.yanked) {
    throw new Error(`${CX_SKILL_GENERATOR_CONTRACT.packageName}@${entry.vers} is yanked.`);
  }
  if (entry.cksum !== CX_SKILL_GENERATOR_CONTRACT.checksum) {
    throw new Error(
      `Unexpected cx-cli checksum ${entry.cksum}; expected ${CX_SKILL_GENERATOR_CONTRACT.checksum}.`,
    );
  }
  return entry;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function extractTarFile(archivePath: string, innerPath: string): string {
  const result = Bun.spawnSync({
    cmd: ["tar", "-xOf", archivePath, innerPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const stderr = Buffer.from(result.stderr).toString("utf8").trim();
    throw new Error(`Failed to extract ${innerPath} from crate: ${stderr}`);
  }
  return Buffer.from(result.stdout).toString("utf8");
}

export function validateCxSkillMarkdown(markdown: string): void {
  if (!markdown.trim()) {
    throw new Error("Generated cx skill Markdown is empty.");
  }
  for (const marker of CX_SKILL_GENERATOR_CONTRACT.requiredMarkers) {
    if (!markdown.includes(marker)) {
      throw new Error(`Generated cx skill Markdown is missing marker: ${marker}`);
    }
  }
  for (const phrase of CX_SKILL_GENERATOR_CONTRACT.forbiddenPhrases) {
    if (markdown.includes(phrase)) {
      throw new Error(`Generated cx skill Markdown contains forbidden phrase: ${phrase}`);
    }
  }
}

export function extractCxSkillFromCrate(crateBytes: Uint8Array): string {
  const digest = sha256Hex(crateBytes);
  if (digest !== CX_SKILL_GENERATOR_CONTRACT.checksum) {
    throw new Error(
      `Unexpected cx-cli crate checksum ${digest}; expected ${CX_SKILL_GENERATOR_CONTRACT.checksum}.`,
    );
  }

  const tempDir = mkdtempSync(join(tmpdir(), "svvy-cx-skill-"));
  const cratePath = join(tempDir, "cx-cli.crate");
  try {
    writeFileSync(cratePath, crateBytes);
    const prefix = `${CX_SKILL_GENERATOR_CONTRACT.packageName}-${CX_SKILL_GENERATOR_CONTRACT.version}`;
    const cargoToml = extractTarFile(cratePath, `${prefix}/Cargo.toml`);
    const mainRs = extractTarFile(cratePath, `${prefix}/src/main.rs`);
    const skill = extractTarFile(cratePath, `${prefix}/src/skill.md`);

    for (const marker of [
      'name = "cx-cli"',
      'version = "0.7.1"',
      "[[bin]]",
      'name = "cx"',
      'path = "src/main.rs"',
    ]) {
      if (!cargoToml.includes(marker)) {
        throw new Error(`cx-cli Cargo.toml is missing marker: ${marker}`);
      }
    }
    for (const marker of ['#[command(name = "cx"', "Commands::Skill", 'include_str!("skill.md")']) {
      if (!mainRs.includes(marker)) {
        throw new Error(`cx-cli src/main.rs is missing marker: ${marker}`);
      }
    }

    validateCxSkillMarkdown(skill);
    return skill;
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
  const sparseIndex = await fetchText(CX_SKILL_GENERATOR_CONTRACT.sparseIndexUrl);
  validateCxIndexEntry(sparseIndex);
  const crateBytes = await fetchBytes(CX_SKILL_GENERATOR_CONTRACT.crateUrl);
  const skill = extractCxSkillFromCrate(crateBytes);
  writeAtomically(output, skill);
  console.log(
    `Generated cx skill instructions from ${CX_SKILL_GENERATOR_CONTRACT.packageName}@${CX_SKILL_GENERATOR_CONTRACT.version}.`,
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
