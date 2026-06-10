import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

describe("live tool projection renderer source contract", () => {
  it("renders command rollups through neutral tool cards instead of workflow cards", async () => {
    const transcriptSource = await readFile(
      new URL("./ChatTranscript.svelte", import.meta.url),
      "utf8",
    );

    expect(transcriptSource).toContain("commandRollupTranscript(");
    expect(transcriptSource).toContain("command.command.outputEvents");
    expect(transcriptSource).toContain("command.command.progressEvents");
    expect(transcriptSource).toContain("command.command.diagnostics");
    expect(transcriptSource).toContain("command.command.artifacts");
    expect(transcriptSource).toContain("command.command.arguments");
    expect(transcriptSource).toContain("command.command.facts");
    expect(transcriptSource).toContain("<ToolCallCard");
    expect(transcriptSource).toContain("toolCall={commandRollupTranscript(row.block)}");
    expect(transcriptSource).not.toContain("<WorkflowCard");
    expect(transcriptSource).not.toContain("workflow={commandRollupTranscript");
  });
});
