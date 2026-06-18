import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

describe("live tool projection renderer source contract", () => {
  it("renders command rollups through neutral tool cards instead of workflow cards", async () => {
    const transcriptSource = await readFile(
      new URL("./ChatTranscript.svelte", import.meta.url),
      "utf8",
    );
    const projectionSource = await readFile(
      new URL("./tool-card-projection.ts", import.meta.url),
      "utf8",
    );

    expect(transcriptSource).toContain("commandRollupTranscript(");
    expect(transcriptSource).toContain("commandToolCall(command");
    expect(transcriptSource).toContain("projectCommandToolCall(command)");
    expect(projectionSource).toContain("command.outputEvents");
    expect(projectionSource).toContain("command.progressEvents");
    expect(projectionSource).toContain("command.diagnostics");
    expect(projectionSource).toContain("command.artifacts");
    expect(projectionSource).toContain("command.argumentSnapshots");
    expect(projectionSource).toContain("command.facts");
    expect(projectionSource).toContain("sections");
    expect(projectionSource).toContain("TRANSCRIPT_SECTION_LIMIT");
    expect(transcriptSource).toContain("<ToolCallCard");
    expect(transcriptSource).toContain("toolCall={commandRollupTranscript(row.block)}");
    expect(transcriptSource).toContain("oninspect={onInspectCommand}");
    expect(transcriptSource).not.toContain("<WorkflowCard");
    expect(transcriptSource).not.toContain("workflow={commandRollupTranscript");
  });
});
