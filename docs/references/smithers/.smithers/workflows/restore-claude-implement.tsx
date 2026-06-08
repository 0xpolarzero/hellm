// smithers-source: user
// smithers-display-name: Restore Claude Implement Agents
/** @jsxImportSource smithers-orchestrator */
import { createSmithers } from "smithers-orchestrator";
import { z } from "zod/v4";

const restoreSchema = z.object({
  filePath: z.string(),
  restored: z.boolean(),
  message: z.string(),
});

const { Workflow, Task, smithers, outputs } = createSmithers({
  restore: restoreSchema,
});

export default smithers(() => (
  <Workflow name="restore-claude-implement">
    <Task id="restore" output={outputs.restore}>
      {async () => {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");

        const workflowPath = path.resolve(process.cwd(), ".smithers/workflows/implement-codex-gemini.tsx");
        const source = await fs.readFile(workflowPath, "utf8");
        const codexGemini = "const codexGeminiOnly = [providers.codex, providers.codex1, providers.gemini1];";
        const withClaude =
          "const codexGeminiOnly = [providers.codex, providers.codex1, providers.gemini1, providers.claude, providers.claudeSonnet];";

        if (source.includes(withClaude)) {
          return {
            filePath: workflowPath,
            restored: false,
            message: "Claude providers were already present.",
          };
        }

        if (!source.includes(codexGemini)) {
          throw new Error("Expected Codex/Gemini provider list was not found.");
        }

        await fs.writeFile(workflowPath, source.replace(codexGemini, withClaude));
        return {
          filePath: workflowPath,
          restored: true,
          message: "Added Claude providers back to implement-codex-gemini.",
        };
      }}
    </Task>
  </Workflow>
));
