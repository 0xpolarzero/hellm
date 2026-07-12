#!/usr/bin/env bun

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2)
  args.set(process.argv[index]!, process.argv[index + 1]!);
const output = args.get("--output");
if (!output) throw new Error("Missing --output.");
if (args.get("--version") !== "0.1.6") throw new Error("Expected pinned TinyFish version 0.1.6.");
const canonical = new URL("../instructions/full/010-tinyfish-cli.generated.md", import.meta.url);
await Bun.write(output, await Bun.file(canonical).text());
