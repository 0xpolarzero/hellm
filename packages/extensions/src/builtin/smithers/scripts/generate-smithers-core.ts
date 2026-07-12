#!/usr/bin/env bun

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2)
  args.set(process.argv[index]!, process.argv[index + 1]!);
const output = args.get("--output");
if (!output) throw new Error("Missing --output.");
if (args.get("--version") !== "0.22.0") throw new Error("Expected pinned Smithers version 0.22.0.");
await Bun.write(
  output,
  await Bun.file(
    new URL("../instructions/full/010-smithers-core.generated.md", import.meta.url),
  ).text(),
);
