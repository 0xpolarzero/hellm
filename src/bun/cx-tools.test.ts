import { describe, expect, it } from "bun:test";
import { createCxTools, type CxRunner } from "./cx-tools";

describe("cx tools", () => {
  it("exposes the full native cx tool surface", () => {
    const tools = createCxTools({ cwd: "/workspace", runner: createRunner() });

    expect(tools.map((tool) => tool.name)).toEqual([
      "cx.overview",
      "cx.symbols",
      "cx.definition",
      "cx.references",
      "cx.lang.list",
      "cx.lang.add",
      "cx.lang.remove",
      "cx.cache.path",
      "cx.cache.clean",
    ]);
  });

  it("runs cx commands through the wrapped runner and returns structured details", async () => {
    const calls: string[][] = [];
    const tools = createCxTools({
      cwd: "/workspace",
      runner: createRunner((args) => {
        calls.push(args);
        return { stdout: JSON.stringify([{ file: "src/index.ts", name: "main" }]) };
      }),
    });

    const result = await getTool(tools, "cx.symbols").execute("tool-call-1", {
      kind: "function",
      name: "ma*",
      limit: 5,
    });

    expect(calls).toEqual([
      ["symbols", "--kind", "function", "--name", "ma*", "--limit", "5", "--json"],
    ]);
    expect(result.details).toMatchObject({
      command: ["cx", "symbols", "--kind", "function", "--name", "ma*", "--limit", "5", "--json"],
      exitCode: 0,
      json: [{ file: "src/index.ts", name: "main" }],
    });
  });

  it("surfaces cx failures as tool errors", async () => {
    const tools = createCxTools({
      cwd: "/workspace",
      runner: createRunner(() => ({ exitCode: 2, stderr: "missing grammar" })),
    });

    await expect(getTool(tools, "cx.overview").execute("tool-call-1", {})).rejects.toThrow(
      "missing grammar",
    );
  });
});

function getTool(tools: ReturnType<typeof createCxTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }
  return tool;
}

function createRunner(
  handler: (args: string[]) => Partial<Awaited<ReturnType<CxRunner>>> = () => ({}),
): CxRunner {
  return async ({ args }) => {
    const result = handler(args);
    return {
      command: ["cx", ...args],
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      json: result.json ?? (result.stdout ? JSON.parse(result.stdout) : null),
    };
  };
}
