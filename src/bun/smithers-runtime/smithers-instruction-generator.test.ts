import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SMITHERS_CORE_INSTRUCTIONS,
  SMITHERS_MEMORY_INSTRUCTIONS,
} from "../../../generated/smithers-instructions.generated";
import {
  generateSmithersCoreInstructions,
  generateSmithersMemoryInstructions,
} from "./smithers-instruction-generator";

const projectRoot = join(import.meta.dir, "..", "..", "..");
const smithersDocs = readFileSync(
  join(projectRoot, "docs", "vendor", "smithers", "smithers-0.22.0.llms-full.txt"),
  "utf8",
);

describe("Smithers instruction generator", () => {
  it("regenerates the checked Smithers core and memory fragments from the pinned docs", () => {
    expect(generateSmithersCoreInstructions(smithersDocs)).toBe(SMITHERS_CORE_INSTRUCTIONS);
    expect(generateSmithersMemoryInstructions(smithersDocs)).toBe(SMITHERS_MEMORY_INSTRUCTIONS);
  });

  it("keeps current svvy Smithers prompt boundaries while preserving official concepts", () => {
    expect(SMITHERS_CORE_INSTRUCTIONS).toContain("bunx smithers-orchestrator init");
    expect(SMITHERS_CORE_INSTRUCTIONS).toContain("bunx smithers-orchestrator workflow run");
    expect(SMITHERS_CORE_INSTRUCTIONS).toContain("bunx smithers-orchestrator ps");
    expect(SMITHERS_CORE_INSTRUCTIONS).toContain("bunx smithers-orchestrator inspect");
    expect(SMITHERS_CORE_INSTRUCTIONS).toContain("`.smithers/package.json`");
    expect(SMITHERS_CORE_INSTRUCTIONS).toContain("Workflows are JSX trees");
    expect(SMITHERS_CORE_INSTRUCTIONS).toContain("The render loop in detail");
    expect(SMITHERS_CORE_INSTRUCTIONS).toContain("Validated outputs");
    expect(SMITHERS_CORE_INSTRUCTIONS).toContain("bunx smithers-orchestrator approve <run-id>");
    expect(SMITHERS_CORE_INSTRUCTIONS).toContain("task IDs must be stable");
    expect(SMITHERS_MEMORY_INSTRUCTIONS).toContain("bypassed by default");

    for (const forbidden of [
      "bunx smithers ",
      "smithers init",
      "smithers workflow run",
      "smithers ps",
      "smithers inspect",
      "Gateway",
      "MCP",
      "HTTP",
      "OpenTelemetry",
      "DevTools",
      "event-stream",
      "OpenAPI",
      "Effect",
      "agent skill",
      "product workflow wrapper",
      "workflow.*",
      "svvyx smithers",
      "package-level runtime creation",
      "per-request Effect layer graphs",
    ]) {
      expect(SMITHERS_CORE_INSTRUCTIONS).not.toContain(forbidden);
    }
  });

  it("emits manifest-declared Markdown fragments through the standalone generator script", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "svvy-smithers-fragment-"));
    try {
      const coreOutput = join(tempDir, "010-smithers-core.generated.md");
      const memoryOutput = join(tempDir, "040-smithers-memory.generated.md");

      for (const output of [coreOutput, memoryOutput]) {
        const result = Bun.spawnSync({
          cmd: [
            "bun",
            "scripts/generate-smithers-fragment.ts",
            "--output",
            output,
            "--version",
            "0.22.0",
          ],
          cwd: projectRoot,
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(result.exitCode).toBe(0);
      }

      expect(readFileSync(coreOutput, "utf8").trim()).toBe(SMITHERS_CORE_INSTRUCTIONS.trim());
      expect(readFileSync(memoryOutput, "utf8").trim()).toBe(SMITHERS_MEMORY_INSTRUCTIONS.trim());
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
