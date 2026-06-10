#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  generateSmithersCoreInstructions,
  generateSmithersMemoryInstructions,
} from "../src/bun/smithers-runtime/smithers-instruction-generator";

const args = parseArgs(process.argv.slice(2));
const version = args.version ?? "0.22.0";
const output = args.output;

if (!output) {
  fail("Missing required --output <path>.");
}

if (version !== "0.22.0") {
  fail(`Unsupported smithers-orchestrator version: ${version}`);
}

const docsPath = join(
  import.meta.dir,
  "..",
  "docs",
  "vendor",
  "smithers",
  `smithers-${version}.llms-full.txt`,
);

if (!existsSync(docsPath)) {
  fail(`Pinned Smithers docs not found: ${docsPath}`);
}

const docs = readFileSync(docsPath, "utf8");
const outputBasename = basename(output);
const content =
  outputBasename === "010-smithers-core.generated.md"
    ? generateSmithersCoreInstructions(docs)
    : outputBasename === "040-smithers-memory.generated.md"
      ? generateSmithersMemoryInstructions(docs)
      : null;

if (!content) {
  fail(
    "Unsupported Smithers generated fragment output. Expected 010-smithers-core.generated.md or 040-smithers-memory.generated.md.",
  );
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${content.trimEnd()}\n`);

function parseArgs(rawArgs: string[]): { output?: string; version?: string } {
  const parsed: { output?: string; version?: string } = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--output") {
      parsed.output = rawArgs[++index];
    } else if (arg === "--version") {
      parsed.version = rawArgs[++index];
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
